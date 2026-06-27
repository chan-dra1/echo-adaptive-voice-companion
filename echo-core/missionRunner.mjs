/**
 * missionRunner.mjs — Autonomous scheduled mission executor for Echo Core.
 *
 * Reads ~/.echo-core/missions.json every minute and fires any mission
 * whose cron expression matches the current time. No browser needed —
 * all step tools run in pure Node.js.
 *
 * Step tools: search_web · ask_echo · run_terminal_command · read_file ·
 *             write_file · send_discord_message · send_email · post_tweet · http_request
 *
 * Results are broadcast to web clients via the sync hub and persisted to
 * ~/.echo-core/mission-results.json (capped at 100 entries).
 *
 * Cron format: five space-separated fields — minute hour day-of-month month day-of-week.
 * Each field supports "*" (any) and step syntax written as star-slash-N.
 *   Examples:
 *     "0 8 * * *"      -> every day at 08:00
 *     "0 9 * * 1"      -> every Monday at 09:00
 *     star-slash-30 in the minute field -> every 30 minutes
 */

import { readFile, writeFile } from 'node:fs/promises';
import { exec as _exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { postToSocial } from './socialPoster.mjs';

const execP = promisify(_exec);
const HOME = os.homedir();
const MISSIONS_FILE  = path.join(HOME, '.echo-core', 'missions.json');
const RESULTS_FILE   = path.join(HOME, '.echo-core', 'mission-results.json');

// ── Cron parser (min hour dom month dow) ─────────────────────────────────────

function cronField(expr, val) {
    if (expr === '*') return true;
    if (expr.startsWith('*/')) return val % parseInt(expr.slice(2), 10) === 0;
    return parseInt(expr, 10) === val;
}

function cronMatches(cronExpr, d) {
    const parts = String(cronExpr).trim().split(/\s+/);
    if (parts.length !== 5) return false;
    const [min, hr, dom, mon, dow] = parts;
    return cronField(min, d.getMinutes())
        && cronField(hr,  d.getHours())
        && cronField(dom, d.getDate())
        && cronField(mon, d.getMonth() + 1)
        && cronField(dow, d.getDay());
}

// ── {{prev}} injection ────────────────────────────────────────────────────────

function extractText(prev) {
    if (!prev || typeof prev !== 'object') return String(prev ?? '');
    if (typeof prev.response === 'string') return prev.response;
    if (typeof prev.content === 'string') return prev.content;
    if (typeof prev.stdout === 'string') return prev.stdout;
    if (typeof prev.message === 'string') return prev.message;
    if (Array.isArray(prev.results)) return prev.results.map(r => `${r.title || ''}: ${r.snippet || ''}`).join('\n');
    return JSON.stringify(prev, null, 2);
}

function injectPrev(args, prev) {
    if (prev === null || prev === undefined) return args;
    const prevStr = extractText(prev);
    try {
        const esc = prevStr
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r');
        return JSON.parse(JSON.stringify(args).replace(/\{\{prev\}\}/g, esc));
    } catch {
        return args;
    }
}

// ── Step executors ────────────────────────────────────────────────────────────

async function executeStep(tool, rawArgs, prev, { llm }) {
    const args = injectPrev(rawArgs, prev);

    switch (tool) {

        case 'search_web': {
            const q = encodeURIComponent(String(args.query || ''));
            const max = Math.min(10, Number(args.num_results) || 5);
            const res = await fetch(`https://api.duckduckgo.com/?q=${q}&format=json&no_html=1&no_redirect=1&t=echo-agent`);
            const data = await res.json();
            const results = [];
            if (data.AbstractText) results.push({ title: data.Heading || args.query, snippet: data.AbstractText, url: data.AbstractURL || '' });
            for (const t of [...(data.RelatedTopics || []), ...(data.Results || [])]) {
                if (results.length >= max) break;
                const item = t.Topics ? t.Topics[0] : t;
                if (item?.Text) results.push({ title: item.Text.slice(0, 80), snippet: item.Text, url: item.FirstURL || '' });
            }
            return { query: args.query, results };
        }

        case 'ask_echo': {
            const prompt = String(args.prompt || '');
            if (!llm) return { error: 'LLM not available.' };
            const r = await llm.chat(prompt);
            return { response: typeof r === 'string' ? r : (r?.text || JSON.stringify(r)) };
        }

        case 'run_terminal_command': {
            const cmd = String(args.command || '').trim();
            const BLOCKED = [/rm\s+-rf?\s*\/(?:\s|$)/i, /\bdd\s+if=/i, /mkfs\b/i, /\bshutdown\b/i, /\breboot\b/i, /\bhalt\b/i];
            if (BLOCKED.some(p => p.test(cmd))) return { error: 'Command blocked: potentially destructive.' };
            const { stdout, stderr } = await execP(cmd, { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
            return { stdout: (stdout || '').slice(0, 6000), stderr: (stderr || '').slice(0, 1000) };
        }

        case 'read_file': {
            const fp = String(args.path || '').replace(/^~/, HOME);
            if (!fp.startsWith(HOME)) return { error: 'Access denied: only home directory.' };
            const content = await readFile(fp, 'utf8');
            return { content: content.slice(0, 50_000), truncated: content.length > 50_000 };
        }

        case 'write_file': {
            const fp = String(args.path || '').replace(/^~/, HOME);
            const ALLOWED = [
                path.join(HOME, 'Desktop'), path.join(HOME, 'Documents'),
                path.join(HOME, 'Downloads'), '/tmp', path.join(HOME, 'echo-projects'),
            ];
            if (!ALLOWED.some(d => fp.startsWith(d))) {
                return { error: 'Write denied. Allowed: Desktop, Documents, Downloads, /tmp, ~/echo-projects.' };
            }
            await writeFile(fp, String(args.content || ''), 'utf8');
            return { success: true, path: fp };
        }

        case 'send_discord_message': {
            const wh = String(args.webhook_url || process.env.ECHO_DISCORD_WEBHOOK || '').trim();
            if (!wh) return { error: 'No Discord webhook. Set ECHO_DISCORD_WEBHOOK env var or pass webhook_url.' };
            const payload = args.title
                ? { username: args.username || 'Echo', embeds: [{ title: String(args.title), description: String(args.message || ''), color: Number(args.color) || 5763719, footer: { text: '⬡ Echo Autonomous Mission' }, timestamp: new Date().toISOString() }] }
                : { username: args.username || 'Echo', content: String(args.message || '') };
            const r = await fetch(wh, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            return r.ok ? { success: true } : { error: `Discord ${r.status}: ${(await r.text()).slice(0, 200)}` };
        }

        case 'send_email': {
            const key = String(args.api_key || process.env.RESEND_API_KEY || '').trim();
            if (!key) return { error: 'No Resend API key. Set RESEND_API_KEY env var.' };
            const body = {
                from: args.from || 'Echo <onboarding@resend.dev>',
                to: args.to,
                subject: args.subject || 'Message from Echo',
                ...(args.html || args.body?.includes('<') ? { html: args.html || args.body } : { text: args.text || args.body }),
            };
            const r = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            return r.ok ? { success: true, ...(await r.json()) } : { error: `Resend ${r.status}: ${(await r.text()).slice(0, 200)}` };
        }

        case 'post_tweet': {
            const token = String(args.access_token || process.env.TWITTER_ACCESS_TOKEN || '').trim();
            if (!token) return { error: 'No Twitter access token. Set TWITTER_ACCESS_TOKEN env var.' };
            const r = await fetch('https://api.twitter.com/2/tweets', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: String(args.text || '').slice(0, 280) }),
            });
            return r.ok ? { success: true, ...(await r.json()) } : { error: `Twitter ${r.status}: ${(await r.text()).slice(0, 200)}` };
        }

        case 'post_to_social': {
            // Cross-platform post via the shared socialPoster (reads ~/.echo-core/social.json).
            // args: { platforms: string[] | 'all', text, link?, image_url? }
            const platforms = args.platforms || 'all';
            const out = await postToSocial(platforms, { text: args.text, link: args.link, imageUrl: args.image_url });
            // Treat as an error result only if EVERY target failed, so missions chain sensibly.
            if (out.succeeded === 0 && out.failed > 0) {
                return { error: `All ${out.failed} post(s) failed`, results: out.results };
            }
            return { success: true, ...out };
        }

        case 'http_request': {
            const r = await fetch(String(args.url), {
                method: String(args.method || 'GET').toUpperCase(),
                headers: args.headers || {},
                body: args.body != null ? JSON.stringify(args.body) : undefined,
            });
            const text = await r.text();
            let json;
            try { json = JSON.parse(text); } catch { /* not JSON */ }
            return { status: r.status, ok: r.ok, body: text.slice(0, 5000), json };
        }

        default:
            return { error: `Unknown step tool: "${tool}". Supported: search_web, ask_echo, run_terminal_command, read_file, write_file, send_discord_message, send_email, post_tweet, http_request` };
    }
}

// ── Run one mission ───────────────────────────────────────────────────────────

async function runMission(mission, { llm, hub, C }) {
    const steps = Array.isArray(mission.steps) ? mission.steps : [];
    const log   = [];
    let prev    = null;

    process.stdout.write(`\n${C.cyn}🤖 mission${C.rst}: ${C.b}${mission.name}${C.rst} — ${steps.length} steps\n`);
    hub.broadcast({ type: 'mission_start', missionId: mission.id, name: mission.name, totalSteps: steps.length, startedAt: Date.now() });

    for (let i = 0; i < steps.length; i++) {
        const s    = steps[i];
        const tool = String(s.tool || '').trim();
        const t0   = Date.now();
        process.stdout.write(`  ${C.dim}[${i + 1}/${steps.length}] ${tool}${C.rst}\n`);

        let result, ok;
        try {
            result = await executeStep(tool, s.args || {}, prev, { llm });
            ok     = !(result && typeof result === 'object' && 'error' in result);
            prev   = result;
        } catch (e) {
            result = { error: e.message };
            ok     = false;
            prev   = result;
        }

        log.push({ step: i + 1, tool, description: s.description || '', ok, result, durationMs: Date.now() - t0 });
        hub.broadcast({ type: 'mission_step', missionId: mission.id, step: i + 1, tool, ok, result, durationMs: Date.now() - t0 });
    }

    const succeeded  = log.filter(l => l.ok).length;
    const completedAt = Date.now();
    const icon       = succeeded === steps.length ? C.grn + '✓' : C.yel + '⚠';
    process.stdout.write(`${icon}${C.rst} mission "${mission.name}": ${succeeded}/${steps.length} ok\n${C.grn}echo>${C.rst} `);

    const summary = { missionId: mission.id, name: mission.name, completedAt, succeeded, total: steps.length, log };
    hub.broadcast({ type: 'mission_complete', ...summary });
    hub.notify(`Mission: ${mission.name}`, `${succeeded}/${steps.length} steps succeeded.`);

    // Persist result (cap at 100)
    try {
        let results = [];
        try { results = JSON.parse(await readFile(RESULTS_FILE, 'utf8')); } catch { /* first run */ }
        results.unshift({ id: `${mission.id}_${completedAt}`, ...summary });
        await writeFile(RESULTS_FILE, JSON.stringify(results.slice(0, 100), null, 2), 'utf8');
    } catch (e) {
        process.stderr.write(`[missionRunner] persist failed: ${e.message}\n`);
    }

    return summary;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function loadMissions() {
    try {
        return JSON.parse(await readFile(MISSIONS_FILE, 'utf8'));
    } catch {
        return [];
    }
}

async function persistMissions(missions) {
    const dir = path.dirname(MISSIONS_FILE);
    try { await readFile(dir); } catch { /* dir check below */ }
    await writeFile(MISSIONS_FILE, JSON.stringify(missions, null, 2), 'utf8');
}

/** Create or update a mission by id. Returns the full mission list. */
export async function saveMission(mission) {
    if (!mission || !mission.name) throw new Error('Mission needs at least a name.');
    const missions = await loadMissions();
    const m = {
        id: mission.id || `m_${Math.abs(hashStr(mission.name + JSON.stringify(mission.steps || [])))}`,
        name: mission.name,
        description: mission.description || '',
        cron: mission.cron || '',
        enabled: mission.enabled !== false,
        steps: Array.isArray(mission.steps) ? mission.steps : [],
    };
    const idx = missions.findIndex(x => x.id === m.id);
    if (idx >= 0) missions[idx] = m; else missions.push(m);
    await persistMissions(missions);
    return m;
}

/** Remove a mission by id. Returns the remaining list. */
export async function deleteMission(id) {
    const missions = (await loadMissions()).filter(m => m.id !== id);
    await persistMissions(missions);
    return missions;
}

/** Flip a mission's enabled flag. */
export async function toggleMission(id, enabled) {
    const missions = await loadMissions();
    const m = missions.find(x => x.id === id);
    if (!m) throw new Error(`Mission not found: ${id}`);
    m.enabled = enabled !== undefined ? !!enabled : !m.enabled;
    await persistMissions(missions);
    return m;
}

// Tiny stable hash for deterministic ids (avoids Date.now/random for resume safety).
function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
    return h;
}

export async function loadMissionResults() {
    try {
        return JSON.parse(await readFile(RESULTS_FILE, 'utf8'));
    } catch {
        return [];
    }
}

export function startMissionRunner(llm, hub, C) {
    const ctx   = { llm, hub, C };
    const fired = new Map(); // de-dupe within the same minute

    const tick = async () => {
        const missions = await loadMissions();
        const now      = new Date();
        const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;

        for (const m of missions) {
            if (!m.enabled || !m.cron) continue;
            const key = `${m.id}::${minuteKey}`;
            if (fired.has(key)) continue;
            if (!cronMatches(m.cron, now)) continue;
            fired.set(key, true);
            if (fired.size > 2000) {
                // prune old keys
                const old = [...fired.keys()].slice(0, 1000);
                old.forEach(k => fired.delete(k));
            }
            runMission(m, ctx).catch(e =>
                process.stderr.write(`[missionRunner] "${m.name}" failed: ${e.message}\n`)
            );
        }
    };

    tick(); // fire once immediately on start
    const interval = setInterval(tick, 60_000);

    return {
        runById: async (id) => {
            const missions = await loadMissions();
            const m = missions.find(m => m.id === id);
            if (!m) throw new Error(`Mission not found: ${id}`);
            return runMission(m, ctx);
        },
        list:    loadMissions,
        results: loadMissionResults,
        save:    saveMission,
        remove:  deleteMission,
        toggle:  toggleMission,
        stop:    () => clearInterval(interval),
    };
}
