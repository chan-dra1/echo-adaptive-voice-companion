/**
 * nightShift.mjs — overnight specialist jobs for Echo Core.
 *
 * Runs once per night (default 02:00 local). Writes receipts into the shared
 * store so the companion briefing can show what actually happened — not a quote.
 *
 * Roles:
 *   companion  — deterministic: open tasks, reminders, drafts
 *   researcher — search + short LLM digest from those tasks
 *   operator / outreach — idle receipts only (no unattended shell or sends)
 *
 * Disable with ECHO_NIGHT_SHIFT=0. Manual: /nightshift in the Core REPL.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();
const CORE_DIR = path.join(HOME, '.echo-core');
const STATE_FILE = path.join(CORE_DIR, 'night-shift.json');
const DEFAULT_CRON = '0 2 * * *';

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
        && cronField(hr, d.getHours())
        && cronField(dom, d.getDate())
        && cronField(mon, d.getMonth() + 1)
        && cronField(dow, d.getDay());
}

function todayKey(d = new Date()) {
    return d.toISOString().slice(0, 10);
}

async function loadState() {
    try {
        return JSON.parse(await readFile(STATE_FILE, 'utf8'));
    } catch {
        return { enabled: true, cron: DEFAULT_CRON, lastRunDay: null, lastRunAt: 0 };
    }
}

async function saveState(state) {
    await mkdir(CORE_DIR, { recursive: true });
    await writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function addReceipt(store, { role, title, summary, status = 'done' }) {
    const day = todayKey();
    const id = `ns_${day}_${role}`;
    const patch = {
        role,
        title,
        summary: String(summary || '').slice(0, 800),
        source: 'core',
        status,
        createdAt: Date.now(),
    };
    if (store.get('receipts', id)) return store.update('receipts', id, patch);
    return store.add('receipts', { id, ...patch });
}

function pickResearchQuery(store, tasks) {
    const open = (typeof tasks?.list === 'function' ? tasks.list() : store.all('tasks'))
        .filter(t => !t.done);
    const top = open[0];
    if (top?.text) return String(top.text).slice(0, 120);
    const mem = store.all('memories').slice(-1)[0];
    if (mem?.text) return String(mem.text).slice(0, 120);
    return 'notable news a personal assistant should brief someone on this morning';
}

async function runCompanion(store, tasks) {
    const taskLine = tasks?.summaryLine?.() || '';
    const reminders = store.all('schedules').filter(j => j.kind === 'reminder' && j.enabled !== false);
    const drafts = store.all('drafts');
    const parts = [];
    if (taskLine) parts.push(taskLine);
    else parts.push('No open tasks.');
    parts.push(reminders.length
        ? `${reminders.length} reminder${reminders.length === 1 ? '' : 's'} on the books.`
        : 'No reminders scheduled.');
    if (drafts.length) parts.push(`${drafts.length} draft${drafts.length === 1 ? '' : 's'} waiting.`);
    addReceipt(store, {
        role: 'companion',
        title: 'Overnight companion check',
        summary: parts.join(' '),
    });
}

async function runResearcher(store, llm, research, tasks) {
    const query = pickResearchQuery(store, tasks);
    let hits = [];
    try {
        hits = await research.search(query, { max: 5 });
    } catch (e) {
        addReceipt(store, {
            role: 'researcher',
            title: 'Overnight research',
            summary: `Search failed: ${e.message}`,
            status: 'failed',
        });
        return;
    }
    const sourceLines = (hits || []).slice(0, 5)
        .map(h => `- ${h.title}: ${(h.snippet || '').slice(0, 140)}${h.url ? ` (${h.url})` : ''}`)
        .join('\n');
    let summary = sourceLines || `No search hits for "${query}".`;
    if (llm && sourceLines) {
        try {
            const r = await llm.chat({
                system: 'You write a 4-bullet morning research brief. Cite sources by title. No fluff.',
                messages: [{ role: 'user', content: `Query: ${query}\n\nResults:\n${sourceLines}` }],
            });
            if (r?.text?.trim()) summary = r.text.trim().slice(0, 800);
        } catch {
            /* keep raw hits */
        }
    }
    addReceipt(store, {
        role: 'researcher',
        title: `Research: ${query.slice(0, 60)}`,
        summary,
    });
}

async function runIdleRoles(store) {
    addReceipt(store, {
        role: 'operator',
        title: 'Operator idle',
        summary: 'No overnight file or shell jobs were queued. Assign operator work from chat to run next.',
    });
    addReceipt(store, {
        role: 'outreach',
        title: 'Outreach idle',
        summary: 'Nothing was emailed or posted overnight. Drafts stay drafts until you authorize a send.',
    });
}

export async function runNightShift({ store, llm, hub, research, tasks, C }) {
    await runCompanion(store, tasks);
    await runResearcher(store, llm, research, tasks);
    await runIdleRoles(store);

    const receipts = store.all('receipts').filter(r => String(r.id || '').startsWith(`ns_${todayKey()}_`));
    const line = receipts.map(r => `${r.role}: ${r.title}`).join(' · ') || 'night shift complete';
    process.stdout.write(`\n${C?.cyn || ''}☾ night shift${C?.rst || ''}: ${line}\n${C?.grn || ''}echo>${C?.rst || ''} `);
    hub?.notify?.('Night shift', line);
    hub?.broadcast?.({ type: 'nightshift_complete', day: todayKey(), count: receipts.length });
    return receipts;
}

export function startNightShift({ store, llm, hub, research, tasks, C }) {
    if (process.env.ECHO_NIGHT_SHIFT === '0') {
        console.log(`  ${C?.dim || ''}night shift off (ECHO_NIGHT_SHIFT=0)${C?.rst || ''}`);
        return { runNow: async () => [], stop: () => {} };
    }

    const fired = new Set();

    const tick = async () => {
        const state = await loadState();
        if (state.enabled === false) return;
        const cron = state.cron || DEFAULT_CRON;
        const now = new Date();
        const day = todayKey(now);
        const minuteKey = `${day}-${now.getHours()}-${now.getMinutes()}`;

        const due = cronMatches(cron, now);
        const missed = now.getHours() > 2 && state.lastRunDay !== day;
        if (!due && !missed) return;
        if (fired.has(minuteKey) || state.lastRunDay === day) return;
        fired.add(minuteKey);
        if (fired.size > 200) fired.clear();

        try {
            await runNightShift({ store, llm, hub, research, tasks, C });
            await saveState({ ...state, cron, lastRunDay: day, lastRunAt: Date.now() });
        } catch (e) {
            process.stderr.write(`[nightShift] failed: ${e.message}\n`);
        }
    };

    tick();
    const interval = setInterval(tick, 60_000);

    return {
        runNow: async () => {
            const state = await loadState();
            const receipts = await runNightShift({ store, llm, hub, research, tasks, C });
            await saveState({ ...state, lastRunDay: todayKey(), lastRunAt: Date.now() });
            return receipts;
        },
        stop: () => clearInterval(interval),
    };
}
