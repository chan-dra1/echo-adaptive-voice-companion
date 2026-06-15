/**
 * tasks.mjs — a lightweight to-do list for the terminal brain.
 *
 * Tasks live in the shared 'tasks' collection (so they also appear in the
 * dashboard and survive restarts). Each task is plain text with an optional
 * due date and a priority flag, both teased out of the raw text the user
 * typed — "call bank tomorrow", "file taxes by friday", "pay rent in 3 days !".
 *
 * Due-date parsing reuses the scheduler's parseWhen()/describeWhen() so the
 * vocabulary ("tomorrow", "in 3 days", "8am", "every day") stays consistent
 * with reminders. Detection is best-effort: we try the trailing words of the
 * text and keep the longest tail that parses, otherwise the task is undated.
 */

import { parseWhen, describeWhen } from './scheduler.mjs';

const PRIORITY_WORDS = /\b(urgent|asap|important|critical|priority)\b/i;

/**
 * Try to peel a due-date phrase off the end of `text`.
 * Returns { text:<cleaned>, due:<when|null> }. Best-effort and never throws.
 */
function extractDue(text, now = Date.now()) {
    const words = text.split(/\s+/).filter(Boolean);
    // try progressively longer trailing tails (up to 4 words) — keep the
    // longest one that parses into a real `when`, so "in 3 days" beats "days".
    let best = null;
    const maxTail = Math.min(4, words.length);
    for (let n = 1; n <= maxTail; n++) {
        let tail = words.slice(words.length - n).join(' ');
        // strip a leading connector the user wrote before the time ("by friday",
        // "on monday", "due tomorrow", "at 8am") so parseWhen sees a bare phrase.
        const phrase = tail.replace(/^(by|on|due|at)\s+/i, '');
        const when = parseWhen(phrase, now);
        if (when) best = { n, when };
    }
    if (!best) return { text: text.trim(), due: null };
    const cleaned = words.slice(0, words.length - best.n).join(' ')
        .replace(/\s+(by|on|due|at)\s*$/i, '')   // drop a dangling connector
        .trim();
    return { text: cleaned || text.trim(), due: best.when };
}

/** Sort key for a task's due date: once.at ascending, everything else last. */
function dueKey(task) {
    const w = task.due;
    if (w && w.kind === 'once') return w.at;
    return Infinity; // daily / no-due sink to the bottom
}

/** True if a once-due task falls on today's calendar date. */
function isDueToday(task, now = Date.now()) {
    const w = task.due;
    if (!w || w.kind !== 'once') return false;
    return new Date(w.at).toDateString() === new Date(now).toDateString();
}

export function createTasks(store) {
    return {
        /**
         * Add a task. Pulls an optional due date off the end of the text and
         * flags priority when it contains '!' or words like 'urgent'/'asap'.
         * Returns the stored task. Throws only when the text is empty.
         */
        add(text) {
            const raw = String(text || '').trim();
            if (!raw) throw new Error('Nothing to add — a task needs some text.');
            const priority = raw.includes('!') || PRIORITY_WORDS.test(raw);
            // strip priority markers before due-date extraction so a trailing
            // '!' doesn't pollute the time phrase.
            const withoutMarks = raw.replace(/!+/g, ' ').replace(PRIORITY_WORDS, ' ')
                .replace(/\s+/g, ' ').trim();
            const { text: clean, due } = extractDue(withoutMarks || raw);
            return store.add('tasks', {
                text: clean || withoutMarks || raw,
                due: due || null,
                done: false,
                priority,
            });
        },

        /**
         * List tasks, sorted: open before done, then by due date (soonest
         * once.at first; daily/undated last), priority first within a bucket.
         * Pass { includeDone:true } to keep completed tasks in the result.
         */
        list({ includeDone = false } = {}) {
            let tasks = store.all('tasks');
            if (!includeDone) tasks = tasks.filter(t => !t.done);
            return tasks.sort((a, b) => {
                // open tasks before done tasks
                if (!!a.done !== !!b.done) return a.done ? 1 : -1;
                // soonest due first
                const da = dueKey(a), db = dueKey(b);
                if (da !== db) return da - db;
                // priority first within the same due bucket
                if (!!a.priority !== !!b.priority) return a.priority ? -1 : 1;
                // stable-ish fallback: oldest first
                return (a.createdAt || 0) - (b.createdAt || 0);
            });
        },

        get(id) { return store.get('tasks', id); },

        /** Mark a task done. Returns the updated task or null if not found. */
        complete(id) {
            return store.update('tasks', id, { done: true, completedAt: Date.now() });
        },

        remove(id) { return store.remove('tasks', id); },

        /** Remove every completed task. Returns the count removed. */
        clear() {
            let removed = 0;
            for (const t of store.all('tasks')) {
                if (t.done && store.remove('tasks', t.id)) removed++;
            }
            return removed;
        },

        /**
         * One-line briefing summary, e.g. "3 open tasks, 1 due today: file
         * taxes." Returns '' when there are no open tasks.
         */
        summaryLine() {
            const open = store.all('tasks').filter(t => !t.done);
            if (!open.length) return '';
            const now = Date.now();
            const dueToday = open.filter(t => isDueToday(t, now));
            const parts = [`${open.length} open task${open.length === 1 ? '' : 's'}`];
            if (dueToday.length) {
                const names = dueToday.map(t => t.text).join(', ');
                parts.push(`${dueToday.length} due today: ${names}`);
            } else {
                // surface the next dated task as gentle context.
                const next = this.list()[0];
                if (next && next.due) parts.push(`next: ${next.text} (${describeWhen(next.due)})`);
            }
            return parts.join(', ') + '.';
        },
    };
}

/* ── self-test (fake in-memory store; never touches the real encrypted file) ── */
if (import.meta.url === `file://${process.argv[1]}`) {
    const store = {
        _d: { tasks: [] },
        all(c) { return this._d[c].slice(); },
        get(c, id) { return this._d[c].find(t => t.id === id); },
        add(c, i) { const x = { id: 't' + (this._d[c].length + 1), createdAt: Date.now(), ...i }; this._d[c].push(x); return x; },
        update(c, id, p) { const x = this._d[c].find(t => t.id === id); Object.assign(x, p); return x; },
        remove(c, id) { const b = this._d[c].length; this._d[c] = this._d[c].filter(t => t.id !== id); return b !== this._d[c].length; },
    };

    const tasks = createTasks(store);

    console.log('— add (plain, no due) —');
    console.log(tasks.add('water the plants'));

    console.log('\n— add (with due: tomorrow) —');
    console.log(tasks.add('call bank tomorrow'));

    console.log('\n— add (with due: by friday) —');
    console.log(tasks.add('file taxes by friday'));

    console.log('\n— add (relative due: in 3 days) —');
    console.log(tasks.add('pay rent in 3 days'));

    console.log('\n— add (priority via "!" + due today via "8am") —');
    const urgent = tasks.add('email landlord at 8am !');
    console.log(urgent);

    console.log('\n— add (priority via "urgent") —');
    console.log(tasks.add('urgent: renew passport'));

    console.log('\n— list (open only) —');
    console.log(tasks.list().map(t => ({ id: t.id, text: t.text, due: t.due && describeWhen(t.due), priority: t.priority, done: t.done })));

    console.log('\n— complete the first task —');
    console.log(tasks.complete(store._d.tasks[0].id));

    console.log('\n— list (includeDone) —');
    console.log(tasks.list({ includeDone: true }).map(t => ({ id: t.id, text: t.text, done: t.done })));

    console.log('\n— summaryLine —');
    console.log(JSON.stringify(tasks.summaryLine()));

    console.log('\n— clear (remove done) —');
    console.log('removed:', tasks.clear(), '· remaining:', store._d.tasks.length);

    console.log('\n— add empty (should throw) —');
    try { tasks.add('   '); console.log('NO THROW (bad)'); }
    catch (e) { console.log('threw as expected:', e.message); }
}
