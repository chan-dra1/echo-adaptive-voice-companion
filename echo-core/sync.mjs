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
import { exec as _exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { postToSocial, saveSocialCreds, connectedPlatforms } from './socialPoster.mjs';

const execP = promisify(_exec);
const HOME = os.homedir();

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

                    case 'exec': {
                        const id = msg.id;
                        const cmd = String(msg.command || '').trim();
                        if (!cmd) { send(ws, { type: 'exec_result', id, ok: false, error: 'Empty command.' }); break; }
                        // Block clearly destructive patterns
                        const BLOCKED_EXEC = [
                            /rm\s+-rf?\s*\/(?:\s|$)/i, /\bdd\s+if=/i, /mkfs\b/i,
                            /:\(\)\s*\{.*\};\s*:/,      />\s*\/dev\/sd/i, /sudo\s+rm\s+-rf/i,
                            /\bshutdown\b/i,            /\breboot\b/i,   /\bhalt\b/i,
                        ];
                        if (BLOCKED_EXEC.some(p => p.test(cmd))) {
                            send(ws, { type: 'exec_result', id, ok: false, error: 'Blocked: potentially destructive command.' });
                            break;
                        }
                        if (opts.onExecLog) opts.onExecLog(cmd);
                        try {
                            const { stdout, stderr } = await execP(cmd, { timeout: 15_000, maxBuffer: 2 * 1024 * 1024 });
                            send(ws, { type: 'exec_result', id, ok: true, stdout: (stdout || '').slice(0, 6000), stderr: (stderr || '').slice(0, 1000), exitCode: 0 });
                        } catch (e) {
                            send(ws, { type: 'exec_result', id, ok: false, stdout: (e.stdout || '').slice(0, 2000), stderr: (e.stderr || e.message || '').slice(0, 1000), exitCode: e.code ?? 1 });
                        }
                        break;
                    }

                    case 'read_file': {
                        const id = msg.id;
                        const fp = path.resolve(String(msg.path || '').replace(/^~/, HOME));
                        if (!fp.startsWith(HOME)) {
                            send(ws, { type: 'read_file_result', id, ok: false, error: 'Access denied: only files under home directory.' });
                            break;
                        }
                        const SENSITIVE = [/\.env$/i, /\.key$/i, /\.pem$/i, /id_rsa/i, /id_ed25519/i, /\.token$/i];
                        if (SENSITIVE.some(p => p.test(path.basename(fp)))) {
                            send(ws, { type: 'read_file_result', id, ok: false, error: 'Access denied: sensitive file type.' });
                            break;
                        }
                        try {
                            const content = await readFile(fp, 'utf8');
                            send(ws, { type: 'read_file_result', id, ok: true, content: content.slice(0, 50_000), truncated: content.length > 50_000 });
                        } catch (e) {
                            send(ws, { type: 'read_file_result', id, ok: false, error: e.message });
                        }
                        break;
                    }

                    case 'write_file': {
                        const id = msg.id;
                        const fp = path.resolve(String(msg.path || '').replace(/^~/, HOME));
                        const ALLOWED_WRITE = [
                            path.join(HOME, 'Desktop'), path.join(HOME, 'Documents'),
                            path.join(HOME, 'Downloads'), '/tmp', path.join(HOME, 'echo-projects'),
                        ];
                        if (!ALLOWED_WRITE.some(d => fp.startsWith(d))) {
                            send(ws, { type: 'write_file_result', id, ok: false, error: 'Access denied. Writes allowed only in: Desktop, Documents, Downloads, /tmp, ~/echo-projects.' });
                            break;
                        }
                        try {
                            await writeFile(fp, String(msg.content || ''), 'utf8');
                            if (opts.onWriteLog) opts.onWriteLog(fp);
                            send(ws, { type: 'write_file_result', id, ok: true, path: fp });
                        } catch (e) {
                            send(ws, { type: 'write_file_result', id, ok: false, error: e.message });
                        }
                        break;
                    }

                    case 'list_dir': {
                        const id = msg.id;
                        const dp = path.resolve(String(msg.path || HOME).replace(/^~/, HOME));
                        if (!dp.startsWith(HOME) && !dp.startsWith('/tmp')) {
                            send(ws, { type: 'list_dir_result', id, ok: false, error: 'Access denied.' });
                            break;
                        }
                        try {
                            const entries = await readdir(dp, { withFileTypes: true });
                            const items = entries.slice(0, 300).map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }));
                            send(ws, { type: 'list_dir_result', id, ok: true, path: dp, items });
                        } catch (e) {
                            send(ws, { type: 'list_dir_result', id, ok: false, error: e.message });
                        }
                        break;
                    }

                    case 'list_missions': {
                        const id = msg.id;
                        try {
                            const missions = opts.missionRunner ? await opts.missionRunner.list() : [];
                            send(ws, { type: 'list_missions_result', id, ok: true, missions });
                        } catch (e) {
                            send(ws, { type: 'list_missions_result', id, ok: false, error: e.message });
                        }
                        break;
                    }

                    case 'run_mission_now': {
                        const id = msg.id;
                        if (!opts.missionRunner) {
                            send(ws, { type: 'run_mission_result', id, ok: false, error: 'Mission runner not initialized.' });
                            break;
                        }
                        try {
                            const result = await opts.missionRunner.runById(String(msg.missionId || ''));
                            send(ws, { type: 'run_mission_result', id, ok: true, result });
                        } catch (e) {
                            send(ws, { type: 'run_mission_result', id, ok: false, error: e.message });
                        }
                        break;
                    }

                    case 'list_mission_results': {
                        const id = msg.id;
                        try {
                            const results = opts.missionRunner ? await opts.missionRunner.results() : [];
                            send(ws, { type: 'list_mission_results_result', id, ok: true, results });
                        } catch (e) {
                            send(ws, { type: 'list_mission_results_result', id, ok: false, error: e.message });
                        }
                        break;
                    }

                    case 'save_mission': {
                        const id = msg.id;
                        if (!opts.missionRunner) { send(ws, { type: 'save_mission_result', id, ok: false, error: 'Mission runner not initialized.' }); break; }
                        try {
                            const mission = await opts.missionRunner.save(msg.mission || {});
                            send(ws, { type: 'save_mission_result', id, ok: true, mission });
                        } catch (e) {
                            send(ws, { type: 'save_mission_result', id, ok: false, error: e.message });
                        }
                        break;
                    }

                    case 'delete_mission': {
                        const id = msg.id;
                        if (!opts.missionRunner) { send(ws, { type: 'delete_mission_result', id, ok: false, error: 'Mission runner not initialized.' }); break; }
                        try {
                            const missions = await opts.missionRunner.remove(String(msg.missionId || ''));
                            send(ws, { type: 'delete_mission_result', id, ok: true, missions });
                        } catch (e) {
                            send(ws, { type: 'delete_mission_result', id, ok: false, error: e.message });
                        }
                        break;
                    }

                    case 'toggle_mission': {
                        const id = msg.id;
                        if (!opts.missionRunner) { send(ws, { type: 'toggle_mission_result', id, ok: false, error: 'Mission runner not initialized.' }); break; }
                        try {
                            const mission = await opts.missionRunner.toggle(String(msg.missionId || ''), msg.enabled);
                            send(ws, { type: 'toggle_mission_result', id, ok: true, mission });
                        } catch (e) {
                            send(ws, { type: 'toggle_mission_result', id, ok: false, error: e.message });
                        }
                        break;
                    }

                    case 'social_post': {
                        const id = msg.id;
                        try {
                            const out = await postToSocial(
                                msg.platforms || 'all',
                                { text: msg.text, link: msg.link, imageUrl: msg.image_url },
                                msg.creds || {}
                            );
                            if (opts.onSocialLog) opts.onSocialLog(out);
                            send(ws, { type: 'social_post_result', id, ok: true, ...out });
                        } catch (e) {
                            send(ws, { type: 'social_post_result', id, ok: false, error: e.message });
                        }
                        break;
                    }

                    case 'save_social_creds': {
                        const id = msg.id;
                        try {
                            await saveSocialCreds(msg.creds || {});
                            const connected = await connectedPlatforms();
                            send(ws, { type: 'save_social_creds_result', id, ok: true, connected });
                        } catch (e) {
                            send(ws, { type: 'save_social_creds_result', id, ok: false, error: e.message });
                        }
                        break;
                    }

                    case 'list_social_accounts': {
                        const id = msg.id;
                        try {
                            const connected = await connectedPlatforms();
                            send(ws, { type: 'list_social_accounts_result', id, ok: true, connected });
                        } catch (e) {
                            send(ws, { type: 'list_social_accounts_result', id, ok: false, error: e.message });
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
