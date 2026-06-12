/**
 * handsBridgeService.ts — bridge between the Echo PWA and the local
 * "Echo Hands" daemon (echo-daemon/server.mjs).
 *
 * When the daemon is running on this machine, Echo gains real execution
 * powers: shell commands, file read/write, directory listing. When it
 * isn't (e.g. on a phone), the bridge reports offline and Gemini simply
 * doesn't get these tools — graceful degradation, same brain everywhere.
 *
 * Safety on the PWA side:
 *  - run_command / write_file require a user confirmation prompt unless
 *    the command matches the read-only allowlist (ls, cat, grep, …).
 *  - The daemon adds its own denylist + workspace jail on top.
 *
 * Events (window):
 *  - 'hands:status'  detail: { connected: boolean, workspace?: string }
 */

import type { FunctionDeclaration } from '@google/genai';
import { Type } from '@google/genai';

const DAEMON_URL = 'ws://127.0.0.1:8765';
const TOKEN_KEY = 'echo_hands_token';
const RECONNECT_MS = 15_000;
const CALL_TIMEOUT_MS = 90_000;

// Read-only command prefixes that run without a confirmation prompt.
const SAFE_CMD = /^\s*(ls|cat|head|tail|grep|rg|find|pwd|whoami|date|df|du|wc|file|stat|which|echo|uname|ps|git\s+(status|log|diff|branch|show))\b/;

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

let ws: WebSocket | null = null;
let connected = false;
let workspace = '';
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const pending = new Map<string, Pending>();
let callSeq = 0;

function emitStatus() {
    window.dispatchEvent(new CustomEvent('hands:status', { detail: { connected, workspace } }));
}

export function isHandsConnected(): boolean { return connected; }
export function getHandsWorkspace(): string { return workspace; }
export function hasHandsToken(): boolean { return !!localStorage.getItem(TOKEN_KEY); }

export function setHandsToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token.trim());
    connectHands(); // try immediately with the new token
}

export function forgetHands(): void {
    localStorage.removeItem(TOKEN_KEY);
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    ws?.close();
    ws = null;
    connected = false;
    emitStatus();
}

/** Try to connect. Silent no-op if no token saved or already connected. */
export function connectHands(): void {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token || connected || (ws && ws.readyState === WebSocket.CONNECTING)) return;

    try {
        ws = new WebSocket(DAEMON_URL);
    } catch {
        scheduleReconnect();
        return;
    }

    ws.onopen = () => ws?.send(JSON.stringify({ type: 'auth', token }));

    ws.onmessage = (ev) => {
        let msg: any;
        try { msg = JSON.parse(ev.data); } catch { return; }

        if (msg.type === 'auth_ok') {
            connected = true;
            workspace = msg.workspace || '';
            console.log(`[hands] connected — workspace: ${workspace}, tools: ${msg.tools?.join(', ')}`);
            emitStatus();
        } else if (msg.type === 'auth_failed') {
            console.warn('[hands] daemon rejected token — run the daemon and re-pair via ⌘K');
        } else if (msg.type === 'result') {
            const p = pending.get(msg.id);
            if (!p) return;
            pending.delete(msg.id);
            clearTimeout(p.timer);
            if (msg.ok) p.resolve(msg.result);
            else p.reject(new Error(msg.error || 'Daemon call failed'));
        }
    };

    ws.onclose = () => {
        const wasConnected = connected;
        connected = false;
        ws = null;
        pending.forEach(p => { clearTimeout(p.timer); p.reject(new Error('Hands daemon disconnected')); });
        pending.clear();
        if (wasConnected) emitStatus();
        scheduleReconnect();
    };
    ws.onerror = () => { /* onclose follows */ };
}

function scheduleReconnect() {
    if (reconnectTimer || !localStorage.getItem(TOKEN_KEY)) return;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connectHands(); }, RECONNECT_MS);
}

/** Generic daemon call — used by hands tools and project mode. */
export function handsCall(tool: string, args: Record<string, unknown>): Promise<any> {
    return call(tool, args);
}

function call(tool: string, args: Record<string, unknown>): Promise<any> {
    if (!connected || !ws) return Promise.reject(new Error('Echo Hands daemon is not connected. Start it with: cd echo-daemon && npm start'));
    const id = `c${++callSeq}`;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`Hands call timed out: ${tool}`));
        }, CALL_TIMEOUT_MS);
        pending.set(id, { resolve, reject, timer });
        ws!.send(JSON.stringify({ type: 'call', id, tool, args }));
    });
}

/* ── Gemini tool surface ── */

const HANDS_TOOLS: FunctionDeclaration[] = [
    {
        name: 'hands_run_command',
        description: 'Run a shell command on the user\'s computer via the Echo Hands daemon. Use for anything the browser cannot do: installing packages, git operations, running scripts, system queries. Destructive commands prompt the user for confirmation first.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                command: { type: Type.STRING, description: 'The shell command to execute (zsh).' },
                cwd: { type: Type.STRING, description: 'Optional working directory, relative to the daemon workspace (default: home).' },
            },
            required: ['command'],
        },
    },
    {
        name: 'hands_read_file',
        description: 'Read a text file from the user\'s computer (within the daemon workspace, default home directory).',
        parameters: {
            type: Type.OBJECT,
            properties: {
                path: { type: Type.STRING, description: 'File path, absolute within workspace or relative to it.' },
            },
            required: ['path'],
        },
    },
    {
        name: 'hands_write_file',
        description: 'Write or append a text file on the user\'s computer. Prompts the user for confirmation.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                path: { type: Type.STRING, description: 'Destination file path.' },
                content: { type: Type.STRING, description: 'Full text content to write.' },
                append: { type: Type.BOOLEAN, description: 'Append instead of overwrite.' },
            },
            required: ['path', 'content'],
        },
    },
    {
        name: 'hands_list_files',
        description: 'List files and folders in a directory on the user\'s computer.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                path: { type: Type.STRING, description: 'Directory path (default: workspace root).' },
            },
        },
    },
    {
        name: 'hands_system_info',
        description: 'Get basic system info about the user\'s computer (OS, hostname, memory, workspace path).',
        parameters: { type: Type.OBJECT, properties: {} },
    },
];

/** Tools to merge into the Gemini Live function declarations. Empty when daemon offline. */
export function getHandsTools(): FunctionDeclaration[] {
    return connected ? HANDS_TOOLS : [];
}

export function isHandsTool(name: string): boolean {
    return name.startsWith('hands_');
}

/**
 * Execute a hands_* tool call coming from Gemini.
 * Side-effectful calls ask the user first via confirm().
 */
export async function executeHandsTool(name: string, args: Record<string, any>): Promise<{ result?: any; error?: string }> {
    try {
        switch (name) {
            case 'hands_run_command': {
                const cmd = String(args.command || '');
                if (!SAFE_CMD.test(cmd)) {
                    const ok = window.confirm(`Echo wants to run on your computer:\n\n$ ${cmd}\n\nAllow?`);
                    if (!ok) return { error: 'User declined the command.' };
                }
                return { result: await call('run_command', { command: cmd, cwd: args.cwd }) };
            }
            case 'hands_write_file': {
                const ok = window.confirm(`Echo wants to ${args.append ? 'append to' : 'write'} file:\n\n${args.path}\n(${String(args.content || '').length} chars)\n\nAllow?`);
                if (!ok) return { error: 'User declined the file write.' };
                return { result: await call('write_file', args) };
            }
            case 'hands_read_file':
                return { result: await call('read_file', args) };
            case 'hands_list_files':
                return { result: await call('list_files', args) };
            case 'hands_system_info':
                return { result: await call('system_info', {}) };
            default:
                return { error: `Unknown hands tool: ${name}` };
        }
    } catch (e: any) {
        return { error: e?.message || 'Hands call failed' };
    }
}
