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
const HA_CONFIG_FILE = path.join(CONFIG_DIR, 'ha-config.json');
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

    /** List the immediate subfolders of ~/EchoProjects (each is a "project"). */
    async list_projects() {
        const root = path.join(os.homedir(), 'EchoProjects');
        if (!fs.existsSync(root)) return { root, projects: [] };
        const projects = fs.readdirSync(root, { withFileTypes: true })
            .filter(e => e.isDirectory())
            .map(e => {
                const p = path.join(root, e.name);
                return { name: e.name, path: p, sizeKB: Math.round(dirSize(p) / 1024) };
            });
        return { root, projects };
    },

    /**
     * Read every (text) file under a folder inside the workspace, returning
     * {path, content}[] so the browser can bundle them into a downloadable zip.
     * Jailed to the workspace; binary/oversized files are skipped.
     */
    async read_dir_files({ path: p, maxFiles, maxTotalBytes }) {
        const abs = resolveSafePath(p);
        if (!fs.existsSync(abs)) throw new Error(`Path not found: ${p}`);
        const fileCap = Math.min(maxFiles || 200, 400);
        const byteCap = Math.min(maxTotalBytes || 4 * 1024 * 1024, 8 * 1024 * 1024);
        const out = [];
        let total = 0;
        const stack = [abs];
        while (stack.length && out.length < fileCap) {
            const d = stack.pop();
            let entries;
            try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
            for (const e of entries) {
                if (out.length >= fileCap || total >= byteCap) break;
                if (e.name === '.git' || e.name === 'node_modules') continue;
                const fp = path.join(d, e.name);
                if (e.isDirectory()) { stack.push(fp); continue; }
                let st; try { st = fs.statSync(fp); } catch { continue; }
                if (st.size > 1024 * 1024) continue;
                let content; try { content = fs.readFileSync(fp, 'utf8'); } catch { continue; }
                if (/[\u0000]/.test(content)) continue; // skip binary
                total += content.length;
                out.push({ path: path.relative(abs, fp), content });
            }
        }
        return { base: abs, files: out, count: out.length };
    },

    /**
     * Clone a PUBLIC GitHub/GitLab repo for read-only learning. Hard-gated:
     *  - host must be github.com or gitlab.com (no arbitrary git servers)
     *  - URL must not carry credentials (user:pass@) or be an SSH/git URL
     *  - cloned with credential helpers DISABLED + no terminal prompt, so a
     *    private repo simply fails to clone (we never touch the user's
     *    secured/private repositories)
     *  - shallow (--depth 1), into ~/EchoSkillsLab, with a hard size cap
     */
    async clone_repo({ url }) {
        const gate = validateRepoUrl(url);
        if (!gate.ok) throw new Error(gate.reason);

        fs.mkdirSync(SKILLS_LAB, { recursive: true });
        const dir = path.join(SKILLS_LAB, gate.slug);
        // fresh clone each time
        fs.rmSync(dir, { recursive: true, force: true });

        // Anonymous, non-interactive clone — private repos cannot succeed.
        const cmd = `git -c credential.helper= -c core.askPass=true clone --depth 1 --single-branch ${shq(gate.cloneUrl)} ${shq(dir)}`;
        const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/usr/bin/false', GCM_INTERACTIVE: 'never' };

        const res = await new Promise((resolve) => {
            exec(cmd, { timeout: 90_000, maxBuffer: 4 * 1024 * 1024, env, shell: '/bin/zsh' },
                (err, stdout, stderr) => resolve({ err, stdout, stderr }));
        });
        if (res.err) {
            fs.rmSync(dir, { recursive: true, force: true });
            const msg = (res.stderr || '').toLowerCase();
            if (msg.includes('authentication') || msg.includes('could not read') || msg.includes('terminal prompts disabled') || msg.includes('permission denied') || msg.includes('fatal: repository') || msg.includes('not found')) {
                throw new Error('Repository is private, gated, or does not exist. Echo only learns from PUBLIC open-source repositories.');
            }
            throw new Error(`Clone failed: ${cap(res.stderr || res.err.message).slice(0, 400)}`);
        }

        // Size guard
        const size = dirSize(dir);
        if (size > 80 * 1024 * 1024) {
            fs.rmSync(dir, { recursive: true, force: true });
            throw new Error(`Repo too large (${Math.round(size / 1e6)} MB). Limit is 80 MB for safety/performance.`);
        }
        return { repoPath: dir, slug: gate.slug, sizeMB: +(size / 1e6).toFixed(1) };
    },

    /**
     * Walk a cloned repo, redact any secrets, run a malware heuristic scan,
     * and return a safety verdict plus de-secreted code excerpts that are
     * safe to send to the model for learning. Secrets NEVER leave this host.
     */
    async scan_repo({ slug, maxFiles, maxBytes }) {
        if (!slug || /[^\w.-]/.test(slug)) throw new Error('Invalid slug.');
        const root = path.join(SKILLS_LAB, slug);
        if (!fs.existsSync(root)) throw new Error('Repo not cloned. Call clone_repo first.');

        const fileCap = Math.min(maxFiles || 40, 80);
        const byteCap = Math.min(maxBytes || 90_000, 150_000);
        const files = walkCode(root, fileCap);

        const reasons = [];
        let secretsFound = 0;
        let usedBytes = 0;
        const excerpts = [];

        for (const f of files) {
            let txt;
            try { txt = fs.readFileSync(f.abs, 'utf8'); } catch { continue; }
            if (/[\u0000]/.test(txt)) continue; // binary file

            // malware heuristics
            for (const m of MALWARE_PATTERNS) {
                if (m.re.test(txt)) reasons.push(`${m.label} in ${f.rel}`);
            }
            // secret detection + redaction
            let redacted = txt;
            for (const s of SECRET_PATTERNS) {
                redacted = redacted.replace(s, (match) => { secretsFound++; return '[REDACTED_SECRET]'; });
            }
            if (usedBytes < byteCap) {
                const slice = redacted.slice(0, Math.min(6_000, byteCap - usedBytes));
                usedBytes += slice.length;
                excerpts.push({ path: f.rel, code: slice });
            }
        }

        const safe = reasons.length === 0;
        return {
            slug,
            safe,
            verdict: safe
                ? (secretsFound > 0
                    ? `SAFE to learn. ${secretsFound} secret-like string(s) were found and REDACTED before this reached you — do not ask for them.`
                    : 'SAFE to learn. No malware patterns and no secrets detected.')
                : `UNSAFE — refused. Suspicious patterns: ${[...new Set(reasons)].slice(0, 6).join('; ')}. Do NOT learn from this repo.`,
            reasons: [...new Set(reasons)],
            secretsRedacted: secretsFound,
            filesScanned: files.length,
            excerpts: safe ? excerpts : [],
        };
    },
    /* ── Home Assistant tools ── */

    async ha_configure({ url, token }) {
        if (!url || !token) throw new Error('Both url and token are required.');
        try { new URL(url); } catch { throw new Error('Invalid URL. Example: http://homeassistant.local:8123'); }
        const config = { url: url.replace(/\/$/, ''), token };
        fs.writeFileSync(HA_CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
        // Test connection — fail gracefully so config is still saved
        try {
            const info = await haFetch('/api/');
            return { saved: true, haVersion: info?.version || 'unknown', message: `Connected to Home Assistant ${info?.version || ''}. Ready to control your home.` };
        } catch (e) {
            return { saved: true, warning: `Config saved but test connection failed: ${e.message}. Verify your URL and token.` };
        }
    },

    async ha_get_state({ entity_id }) {
        if (!entity_id) throw new Error('entity_id is required.');
        const s = await haFetch(`/api/states/${entity_id}`);
        return {
            entity_id: s.entity_id,
            state: s.state,
            attributes: s.attributes,
            last_changed: s.last_changed,
            friendly_name: s.attributes?.friendly_name || entity_id,
        };
    },

    async ha_call_service({ domain, service, entity_id, data }) {
        if (!domain || !service) throw new Error('domain and service are required.');
        const body = { ...(data || {}), ...(entity_id ? { entity_id } : {}) };
        const result = await haFetch(`/api/services/${domain}/${service}`, { method: 'POST', body });
        const states = (Array.isArray(result) ? result : []).map(s => ({ entity_id: s.entity_id, state: s.state }));
        return { success: true, domain, service, entity_id: entity_id || null, affectedStates: states };
    },

    async ha_list_entities({ domain_filter } = {}) {
        const all = await haFetch('/api/states');
        const filtered = domain_filter
            ? all.filter(s => s.entity_id.startsWith(`${domain_filter}.`))
            : all;
        const entities = filtered.slice(0, 200).map(s => ({
            entity_id: s.entity_id,
            state: s.state,
            friendly_name: s.attributes?.friendly_name || '',
            domain: s.entity_id.split('.')[0],
        }));
        return { total: filtered.length, shown: entities.length, entities };
    },

    async ha_get_camera_snapshot({ entity_id }) {
        if (!entity_id) throw new Error('entity_id is required.');
        const cfg = readHaConfig();
        const res = await fetch(`${cfg.url}/api/camera_proxy/${entity_id}`, {
            headers: { Authorization: `Bearer ${cfg.token}` },
        });
        if (!res.ok) throw new Error(`Camera snapshot failed (${res.status}). Check the entity_id and that the camera is online.`);
        const buf = await res.arrayBuffer();
        const base64 = Buffer.from(buf).toString('base64');
        return {
            entity_id,
            base64,
            contentType: res.headers.get('content-type') || 'image/jpeg',
            sizeKB: Math.round(buf.byteLength / 1024),
        };
    },
};

/* ── Home Assistant helpers ── */

function readHaConfig() {
    if (!fs.existsSync(HA_CONFIG_FILE)) {
        throw new Error('Home Assistant not configured. Ask Echo to run ha_configure with your HA URL and long-lived access token first.');
    }
    return JSON.parse(fs.readFileSync(HA_CONFIG_FILE, 'utf8'));
}

async function haFetch(apiPath, { method = 'GET', body } = {}) {
    const cfg = readHaConfig();
    const opts = { method, headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(`${cfg.url}${apiPath}`, opts);
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`HA API ${res.status}${txt ? ': ' + txt.slice(0, 200) : ''}`);
    }
    return res.json();
}

/* ── repo safety helpers ── */
const SKILLS_LAB = path.join(os.homedir(), 'EchoSkillsLab');
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function validateRepoUrl(url) {
    if (typeof url !== 'string' || !url) return { ok: false, reason: 'No URL provided.' };
    if (/[@]/.test(url.split('/').slice(0, 3).join('/'))) return { ok: false, reason: 'Credentialed URLs are not allowed.' };
    let u;
    try { u = new URL(url); } catch { return { ok: false, reason: 'Invalid URL.' }; }
    if (u.protocol !== 'https:') return { ok: false, reason: 'Only https:// repos are allowed (no SSH/git).' };
    const host = u.hostname.toLowerCase();
    if (host !== 'github.com' && host !== 'gitlab.com') {
        return { ok: false, reason: 'Only public github.com / gitlab.com repos are allowed.' };
    }
    const parts = u.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (parts.length < 2 || parts.some(p => p === '..' || p === '')) return { ok: false, reason: 'URL must be host/owner/repo.' };
    const owner = parts[0], repo = parts[1].replace(/\.git$/, '');
    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return { ok: false, reason: 'Invalid owner/repo name.' };
    return { ok: true, slug: `${owner}__${repo}`, cloneUrl: `https://${host}/${owner}/${repo}.git` };
}

function dirSize(dir) {
    let total = 0;
    const stack = [dir];
    while (stack.length) {
        const d = stack.pop();
        let entries;
        try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
        for (const e of entries) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) stack.push(p);
            else { try { total += fs.statSync(p).size; } catch {} }
        }
    }
    return total;
}

const CODE_EXT = new Set(['.js','.ts','.tsx','.jsx','.mjs','.cjs','.py','.go','.rs','.java','.rb','.c','.h','.cpp','.cc','.cs','.php','.swift','.kt','.sh','.json','.md','.txt','.yml','.yaml','.toml']);
const SKIP_DIR = new Set(['.git','node_modules','vendor','dist','build','.next','target','__pycache__','.venv','venv','bin','obj']);

function walkCode(root, cap) {
    const out = [];
    const stack = [root];
    while (stack.length && out.length < cap) {
        const d = stack.pop();
        let entries;
        try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
        for (const e of entries) {
            if (out.length >= cap) break;
            if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) stack.push(path.join(d, e.name)); continue; }
            const ext = path.extname(e.name).toLowerCase();
            if (!CODE_EXT.has(ext)) continue;
            const abs = path.join(d, e.name);
            try { if (fs.statSync(abs).size > 200 * 1024) continue; } catch { continue; }
            out.push({ abs, rel: path.relative(root, abs) });
        }
    }
    return out;
}

const SECRET_PATTERNS = [
    /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
    /AKIA[0-9A-Z]{16}/g,
    /AIza[0-9A-Za-z\-_]{35}/g,
    /xox[baprs]-[0-9A-Za-z-]{10,}/g,
    /gh[pousr]_[0-9A-Za-z]{36,}/g,
    /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    /(?:api[_-]?key|secret|token|passwd|password|client[_-]?secret|access[_-]?token)\s*[:=]\s*['"][^'"\n]{12,}['"]/gi,
    /sk-[A-Za-z0-9]{20,}/g,
];

const MALWARE_PATTERNS = [
    { label: 'reverse shell', re: /bash\s+-i\s*>?&?\s*\/dev\/tcp\//i },
    { label: 'netcat exec', re: /\bnc\b[^\n]*\s-e\s/i },
    { label: 'crypto miner', re: /stratum\+tcp:|xmrig|coinhive|cryptonight|minerd|\bnicehash\b/i },
    { label: 'curl|wget piped to shell', re: /(curl|wget)\s[^\n|]*\|\s*(sh|bash|zsh|python3?|node)\b/i },
    { label: 'eval of decoded payload', re: /(eval|exec|child_process)[\s\S]{0,40}(atob|Buffer\.from|base64\.b64decode)\s*\(/i },
    { label: 'obfuscated base64 blob', re: /['"][A-Za-z0-9+/]{600,}={0,2}['"]/ },
    { label: 'remote code download to disk+run', re: /(curl|wget|Invoke-WebRequest)[\s\S]{0,80}(chmod\s+\+x|\.\/|Start-Process)/i },
    { label: 'os.system shell exec of input', re: /os\.system\(\s*[^)]*input\s*\(/i },
];

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
