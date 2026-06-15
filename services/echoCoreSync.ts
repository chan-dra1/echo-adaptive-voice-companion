/**
 * echoCoreSync.ts — web dashboard ↔ Echo Core sync client.
 *
 * Connects the React app to the Echo Core daemon's sync hub (sync.mjs) so the
 * dashboard and the terminal share one live state. On connect it pulls the
 * full snapshot; thereafter it applies every incremental change and re-emits
 * it as a window event the UI can react to. The app can also push artifacts
 * back to Core (so a draft made in the web shows up in the terminal).
 *
 * Graceful degradation: if Core isn't running (e.g. you only use the PWA),
 * this stays silent and the app works exactly as before.
 *
 * Window events:
 *   'echocore:status'  detail { connected }
 *   'echocore:change'  detail { collection, op, item }
 *   'echocore:snapshot' detail { snapshot }
 *   'echocore:speak'   detail { text }   (terminal said something → voice it)
 *   'echocore:notify'  detail { title, text }  (a reminder/briefing fired)
 */

const CORE_URL = 'ws://127.0.0.1:8770';
const TOKEN_KEY = 'echo_core_token';
const RECONNECT_MS = 15_000;

type Snapshot = Record<string, any[]>;

let ws: WebSocket | null = null;
let connected = false;
let snapshot: Snapshot = {};
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function emit(name: string, detail: any) { window.dispatchEvent(new CustomEvent(name, { detail })); }

export function isCoreConnected(): boolean { return connected; }
export function hasCoreToken(): boolean { return !!localStorage.getItem(TOKEN_KEY); }
export function getCoreSnapshot(): Snapshot { return snapshot; }
export function getCoreDrafts(): any[] { return snapshot.drafts || []; }
export function getCoreCampaigns(): any[] { return snapshot.campaigns || []; }
export function getCoreSchedules(): any[] { return snapshot.schedules || []; }
export function getCoreMemories(): any[] { return snapshot.memories || []; }

export function setCoreToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token.trim());
    connectCore();
}

export function forgetCore(): void {
    localStorage.removeItem(TOKEN_KEY);
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    ws?.close();
    ws = null;
    connected = false;
    snapshot = {};
    emit('echocore:status', { connected: false });
}

export function connectCore(): void {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token || connected || (ws && ws.readyState === WebSocket.CONNECTING)) return;

    try { ws = new WebSocket(CORE_URL); } catch { scheduleReconnect(); return; }

    ws.onopen = () => ws?.send(JSON.stringify({ type: 'auth', token }));

    ws.onmessage = (ev) => {
        let msg: any;
        try { msg = JSON.parse(ev.data); } catch { return; }

        switch (msg.type) {
            case 'auth_ok':
                connected = true;
                snapshot = msg.snapshot || {};
                emit('echocore:status', { connected: true });
                emit('echocore:snapshot', { snapshot });
                break;
            case 'auth_failed':
                console.warn('[core] token rejected — re-pair via ⌘K → Connect Echo Core');
                break;
            case 'snapshot':
                snapshot = msg.snapshot || {};
                emit('echocore:snapshot', { snapshot });
                break;
            case 'change': {
                const { collection, op, item } = msg;
                if (!snapshot[collection]) snapshot[collection] = [];
                if (op === 'add') snapshot[collection] = [...snapshot[collection], item];
                else if (op === 'remove') snapshot[collection] = snapshot[collection].filter((x: any) => x.id !== item.id);
                emit('echocore:change', { collection, op, item });
                break;
            }
            case 'speak':
                emit('echocore:speak', { text: msg.text });
                break;
            case 'notify':
                emit('echocore:notify', { title: msg.title, text: msg.text });
                break;
        }
    };

    ws.onclose = () => {
        const was = connected;
        connected = false;
        ws = null;
        if (was) emit('echocore:status', { connected: false });
        scheduleReconnect();
    };
    ws.onerror = () => { /* onclose follows */ };
}

function scheduleReconnect() {
    if (reconnectTimer || !localStorage.getItem(TOKEN_KEY)) return;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connectCore(); }, RECONNECT_MS);
}

/** Push an artifact to Core so it appears in the terminal too. No-op if offline. */
export function coreAdd(collection: string, item: any): void {
    if (connected && ws) ws.send(JSON.stringify({ type: 'add', collection, item }));
}

/** Remove an item from a Core collection by id. Core broadcasts the change. No-op if offline. */
export function coreRemove(collection: string, id: string): void {
    if (connected && ws) ws.send(JSON.stringify({ type: 'remove', collection, id }));
}

/** Create a schedule (reminder/briefing) in Core. `spec` is the schedule item (e.g. { text, when }). */
export function coreAddSchedule(spec: any): void {
    coreAdd('schedules', spec);
}

/** Remember something in Core's long-term memory. */
export function coreAddMemory(text: string): void {
    const t = text.trim();
    if (t) coreAdd('memories', { text: t });
}

/**
 * Mirror a spoken voice turn (from the web's Gemini Live session) to Core so
 * the terminal sees the same conversation live. No-op if Core isn't paired.
 */
export function corePushVoiceTurn(role: 'user' | 'assistant', text: string): void {
    if (connected && ws && text.trim()) ws.send(JSON.stringify({ type: 'voice_turn', role, text: text.trim() }));
}

/** Ask the terminal brain to run a task (used later for unified voice). */
export function coreAsk(text: string): Promise<{ ok: boolean; text: string; provider?: string }> {
    return new Promise((resolve) => {
        if (!connected || !ws) return resolve({ ok: false, text: 'Echo Core not connected.' });
        const id = `a_${Date.now().toString(36)}`;
        const onMsg = (ev: MessageEvent) => {
            let m: any; try { m = JSON.parse(ev.data); } catch { return; }
            if (m.type === 'ask_result' && m.id === id) {
                ws?.removeEventListener('message', onMsg);
                resolve({ ok: m.ok, text: m.text, provider: m.provider });
            }
        };
        ws.addEventListener('message', onMsg);
        ws.send(JSON.stringify({ type: 'ask', id, text }));
    });
}
