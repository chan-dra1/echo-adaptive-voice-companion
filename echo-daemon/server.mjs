#!/usr/bin/env node
/**
 * Echo Hands — local execution daemon.
 *
 * Gives the Echo PWA (running in the browser) real "hands" on this machine:
 * shell commands, file read/write, directory listing. The browser sandbox
 * cannot do any of this, so the PWA connects to this daemon over a
 * localhost-only WebSocket.
 *
 * Security model:
 *  - Binds to 127.0.0.1 ONLY — never reachable from the network.
 *  - Requires a random token (generated on first run, stored in
 *    ~/.echo-hands/token). The PWA must present it in the first message.
 *  - Hard denylist of catastrophic commands (rm -rf /, sudo, dd, mkfs…).
 *  - File operations restricted to $HOME by default (EH_WORKSPACE to widen).
 *  - 60s command timeout, 200 KB output cap.
 *
 * Run:  node server.mjs        (or: npm start)
 * Then paste the printed token into Echo → ⌘K → "Connect Echo Hands".
 */

import { WebSocketServer } from 'ws';
import { exec } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PORT = Number(process.env.EH_PORT || 8765);
const WORKSPACE = path.resolve(process.env.EH_WORKSPACE || os.homedir());
const CONFIG_DIR = path.join(os.homedir(), '.echo-hands');
const TOKEN_FILE = path.join(CONFIG_DIR, 'token');
const MAX_OUTPUT = 200 * 1024;
const CMD_TIMEOUT_MS = 60_000;

/* ── token ── */
function getToken() {
    if (fs.existsSync(TOKEN_FILE)) return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    const t = randomBytes(24).toString('hex');
    fs.writeFileSync(TOKEN_FILE, t, { mode: 0o600 });
    return t;
}
const TOKEN = getToken();

/* ── guardrails ── */
const DENY_PATTERNS = [
    /rm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+[/~]/i, // rm -rf / or ~
    /\bsudo\b/i,
    /\bmkfs\b/i,
    /\bdd\s+.*of=\/dev\//i,
    /\b(shutdown|reboot|halt)\b/i,
    /:\(\)\s*\{.*\};\s*:/,            // fork bomb
    /\bdiskutil\s+(erase|partition)/i,
    /\bcsrutil\b/i,
    />\s*\/dev\/(sd|disk)/i,
    /\blaunchctl\s+(unload|remove)\s+.*\b(loginwindow|kernel)\b/i,
];

function commandAllowed(cmd) {
    for (const p of DENY_PATTERNS) {
        if (p.test(cmd)) return { ok: false, reason: `Blocked by safety denylist: ${p}` };
    }
    return { ok: true };
}

function resolveSafePath(p) {
    const abs = path.resolve(WORKSPACE, p.replace(/^~\//, os.homedir() + '/'));
    if (!abs.startsWith(WORKSPACE)) {
        throw new Error(`Path outside workspace (${WORKSPACE}): ${abs}`);
    }
    return abs;
}

function cap(s) {
    if (s.length <= MAX_OUTPUT) return s;
    return s.slice(0, MAX_OUTPUT) + `\n…[truncated ${s.length - MAX_OUTPUT} bytes]`;
}

/* ── tool implementations ── */
const tools = {
    async run_command({ command, cwd }) {
        const gate = commandAllowed(command);
        if (!gate.ok) throw new Error(gate.reason);
        const workdir = cwd ? resolveSafePath(cwd) : WORKSPACE;
        return new Promise((resolve) => {
            exec(command, { cwd: workdir, timeout: CMD_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024, shell: '/bin/zsh' },
                (err, stdout, stderr) => {
                    resolve({
                        exitCode: err?.code ?? 0,
                        timedOut: err?.killed ?? false,
                        stdout: cap(stdout || ''),
                        stderr: cap(stderr || ''),
                    });
                });
        });
    },

    async read_file({ path: p, maxBytes }) {
        const abs = resolveSafePath(p);
        const stat = fs.statSync(abs);
        if (stat.size > 5 * 1024 * 1024) throw new Error(`File too large (${stat.size} bytes). Use run_command with head/grep instead.`);
        const content = fs.readFileSync(abs, 'utf8');
        const limit = Math.min(maxBytes || MAX_OUTPUT, MAX_OUTPUT);
        return { path: abs, size: stat.size, content: content.slice(0, limit) };
    },

    async write_file({ path: p, content, append }) {
        const abs = resolveSafePath(p);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        if (append) fs.appendFileSync(abs, content);
        else fs.writeFileSync(abs, content);
        return { path: abs, bytesWritten: Buffer.byteLength(content) };
    },

    async list_files({ path: p }) {
        const abs = resolveSafePath(p || '.');
        const entries = fs.readdirSync(abs, { withFileTypes: true })
            .filter(e => !e.name.startsWith('.'))
            .slice(0, 200)
            .map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }));
        return { path: abs, entries };
    },

    /**
     * Write a whole project in one call. Jailed to ~/EchoProjects/<name>.
     * files: [{ path: 'index.html', content: '...' }, ...]
     */
    async create_project({ name, files }) {
        if (!name || !/^[a-z0-9][a-z0-9-_]{0,63}$/i.test(name)) throw new Error('Invalid project name (alphanumeric/dash/underscore).');
        if (!Array.isArray(files) || files.length === 0) throw new Error('files[] required.');
        if (files.length > 60) throw new Error('Too many files (max 60 per call).');
        const root = path.join(os.homedir(), 'EchoProjects', name);
        const written = [];
        for (const f of files) {
            const abs = path.resolve(root, f.path);
            if (!abs.startsWith(root)) throw new Error(`File escapes project dir: ${f.path}`);
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, f.content ?? '');
            written.push(f.path);
        }
        return { projectPath: root, filesWritten: written };
    },

    async system_info() {
        return {
            platform: os.platform(),
            arch: os.arch(),
            hostname: os.hostname(),
            user: os.userInfo().username,
            workspace: WORKSPACE,
            uptime: os.uptime(),
            memFreeMB: Math.round(os.freemem() / 1e6),
        };
    },
};

/* ── websocket server ── */
const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT });

wss.on('connection', (ws, req) => {
    let authed = false;
    const remote = req.socket.remoteAddress;
    console.log(`[hands] connection from ${remote}`);

    ws.on('message', async (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return ws.close(1003, 'bad json'); }

        if (!authed) {
            if (msg.type === 'auth' && msg.token === TOKEN) {
                authed = true;
                ws.send(JSON.stringify({ type: 'auth_ok', tools: Object.keys(tools), workspace: WORKSPACE }));
                console.log('[hands] client authenticated');
            } else {
                ws.send(JSON.stringify({ type: 'auth_failed' }));
                ws.close(4001, 'auth failed');
            }
            return;
        }

        if (msg.type === 'call') {
            const { id, tool, args } = msg;
            const impl = tools[tool];
            try {
                if (!impl) throw new Error(`Unknown tool: ${tool}`);
                console.log(`[hands] ${tool}(${JSON.stringify(args).slice(0, 120)})`);
                const result = await impl(args || {});
                ws.send(JSON.stringify({ type: 'result', id, ok: true, result }));
            } catch (e) {
                console.warn(`[hands] ${tool} failed: ${e.message}`);
                ws.send(JSON.stringify({ type: 'result', id, ok: false, error: e.message }));
            }
        }
    });
});

console.log(`
╔══════════════════════════════════════════════════════╗
║  ECHO HANDS — local execution daemon                 ║
╠══════════════════════════════════════════════════════╣
║  Listening : ws://127.0.0.1:${PORT}                      ║
║  Workspace : ${WORKSPACE}
║                                                      ║
║  Pair with Echo:  ⌘K → "Connect Echo Hands"          ║
║  Token:                                              ║
║  ${TOKEN}
╚══════════════════════════════════════════════════════╝
`);
