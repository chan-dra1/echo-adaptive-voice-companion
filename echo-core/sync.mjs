/**
 * sync.mjs — Echo Core sync hub.
 *
 * A localhost-only, token-authed WebSocket server that keeps every connected
 * client (the web dashboard, and any future clients) in lockstep with the
 * shared store. On connect a client receives the full snapshot; thereafter it
 * receives every incremental change. Clients may also push actions back.
 *
 * Protocol (JSON):
 *   client → { type:'auth', token }
 *   server → { type:'auth_ok', snapshot }            | { type:'auth_failed' }
 *   server → { type:'change', collection, op, item } (broadcast on every mutation)
 *   client → { type:'add', collection, item }        (create from a client)
 *   client → { type:'remove', collection, id }
 *   client → { type:'ask', id, text }                (run a task via the brain)
 *   server → { type:'ask_result', id, ok, text, provider } | { type:'speak', text }
 *
 * Shares the Echo Hands token file (~/.echo-hands/token) so one pairing
 * unlocks both Hands and Core, OR generates its own at ~/.echo-core/token.
 */

import { WebSocketServer } from 'ws';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CORE_DIR = path.join(os.homedir(), '.echo-core');
const TOKEN_FILE = path.join(CORE_DIR, 'token');

function getToken() {
    fs.mkdirSync(CORE_DIR, { recursive: true });
    if (fs.existsSync(TOKEN_FILE)) return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    const t = crypto.randomBytes(24).toString('hex');
    fs.writeFileSync(TOKEN_FILE, t, { mode: 0o600 });
    return t;
}

/**
 * @param store  the openStore() instance
 * @param opts   { port, onAsk?: async (text) => ({ text, provider }) }
 */
export function startSyncHub(store, opts = {}) {
    const port = opts.port || 8770;
    const token = getToken();
    const clients = new Set();

    const wss = new WebSocketServer({ host: '127.0.0.1', port });

    const send = (ws, obj) => { try { ws.send(JSON.stringify(obj)); } catch { /* dropped */ } };
    const broadcast = (obj) => { for (const ws of clients) if (ws.__authed) send(ws, obj); };

    // Re-broadcast every store mutation to all authed clients.
    store.on('change', (change) => broadcast({ type: 'change', ...change }));

    wss.on('connection', (ws) => {
        ws.__authed = false;
        clients.add(ws);

        ws.on('message', async (raw) => {
            let msg;
            try { msg = JSON.parse(raw.toString()); } catch { return; }

            if (!ws.__authed) {
                if (msg.type === 'auth' && msg.token === token) {
                    ws.__authed = true;
                    send(ws, { type: 'auth_ok', snapshot: store.snapshot() });
                } else {
                    send(ws, { type: 'auth_failed' });
                    ws.close(4001, 'auth failed');
                }
                return;
            }

            try {
                switch (msg.type) {
                    case 'add':
                        store.add(msg.collection, msg.item); // change event auto-broadcasts
                        break;
                    case 'remove':
                        store.remove(msg.collection, msg.id);
                        break;
                    case 'get_snapshot':
                        send(ws, { type: 'snapshot', snapshot: store.snapshot() });
                        break;
                    case 'ask':
                        if (opts.onAsk) {
                            try {
                                const r = await opts.onAsk(String(msg.text || ''));
                                send(ws, { type: 'ask_result', id: msg.id, ok: true, text: r.text, provider: r.provider });
                            } catch (e) {
                                send(ws, { type: 'ask_result', id: msg.id, ok: false, text: e.message });
                            }
                        }
                        break;
                    case 'voice_turn': {
                        // A client (web) had a spoken turn. Record it, show it in
                        // the terminal, and mirror to OTHER clients (not the sender).
                        const role = msg.role === 'assistant' ? 'assistant' : 'user';
                        const text = String(msg.text || '').trim();
                        if (text) {
                            store.add('history', { role, text, source: 'web-voice' });
                            opts.onVoiceTurn?.(role, text);
                            for (const c of clients) if (c !== ws && c.__authed) send(c, { type: 'voice_turn', role, text });
                        }
                        break;
                    }
                }
            } catch (e) {
                send(ws, { type: 'error', message: e.message });
            }
        });

        ws.on('close', () => clients.delete(ws));
        ws.on('error', () => clients.delete(ws));
    });

    return {
        port, token,
        clientCount: () => [...clients].filter(c => c.__authed).length,
        broadcast,
        /** Push a spoken/transcript line to all clients (so web can voice it). */
        speak: (text) => broadcast({ type: 'speak', text }),
        /** Push a proactive notification (fired reminder / briefing) to the dashboard. */
        notify: (title, text) => broadcast({ type: 'notify', title, text }),
        close: () => wss.close(),
    };
}
