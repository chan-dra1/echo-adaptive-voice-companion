/**
 * scheduler.mjs — Echo Core's sense of time.
 *
 * This is the thing a browser PWA can't do: act on its own, on a schedule,
 * even when nobody is talking. Jobs live in the encrypted store (collection
 * 'schedules'), survive restarts, and fire through a delivery callback that
 * the host (echo.mjs) uses to speak + broadcast + notify the dashboard.
 *
 * Job shapes:
 *   { kind:'reminder', message, when:{kind:'once', at} | {kind:'daily', time} }
 *   { kind:'briefing', when:{kind:'daily', time} }   // composed at fire time
 *
 * Natural-language times handled by parseWhen():
 *   "in 10m" · "in 2h" · "8am" · "8:30 pm" · "14:30" · "noon" · "midnight"
 *   "tomorrow 9am" · "every day at 8am" · "every morning" · "daily 7:30"
 */

const DAY = 86_400_000;

/* ── time parsing ── */
function parseClock(s) {
    s = s.trim().toLowerCase();
    if (s === 'noon') return { h: 12, m: 0 };
    if (s === 'midnight') return { h: 0, m: 0 };
    const m = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    const ap = m[3];
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    return { h, m: min };
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * Parse a natural-language schedule phrase into a `when` descriptor.
 * Returns null if it can't be understood.
 */
export function parseWhen(input, now = Date.now()) {
    const s = String(input || '').trim().toLowerCase();
    if (!s) return null;

    // relative: "in 10m" / "in 2 hours" / "in 30s"
    const rel = s.match(/^in\s+(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)\b/);
    if (rel) {
        const n = parseInt(rel[1], 10);
        const u = rel[2][0];
        const ms = u === 's' ? n * 1000 : u === 'h' ? n * 3600_000 : n * 60_000;
        return { kind: 'once', at: now + ms };
    }

    // recurring daily
    const daily = /\b(every\s*day|everyday|daily|each\s*day|every\s*morning|each\s*morning|every\s*evening|every\s*night)\b/.test(s);
    if (daily) {
        let clock = parseClock(s.replace(/.*\bat\b/, '')) || parseClock(s);
        if (!clock) {
            if (/morning/.test(s)) clock = { h: 8, m: 0 };
            else if (/evening/.test(s)) clock = { h: 18, m: 0 };
            else if (/night/.test(s)) clock = { h: 21, m: 0 };
            else clock = { h: 8, m: 0 };
        }
        return { kind: 'daily', time: `${pad(clock.h)}:${pad(clock.m)}` };
    }

    // tomorrow [at] <clock>
    if (/\btomorrow\b/.test(s)) {
        const clock = parseClock(s.replace(/.*tomorrow/, '').replace(/\bat\b/, '')) || { h: 9, m: 0 };
        const d = new Date(now + DAY);
        d.setHours(clock.h, clock.m, 0, 0);
        return { kind: 'once', at: d.getTime() };
    }

    // "[in] N days" / "N weeks" [at <clock>]  (checked before bare clock so
    // "3 days" is a duration, not 3 o'clock)
    const reld = s.match(/^(?:in\s+)?(\d+)\s*(day|days|week|weeks)\b/);
    if (reld) {
        const n = parseInt(reld[1], 10) * (reld[2].startsWith('week') ? 7 : 1);
        const d = new Date(now + n * DAY);
        const clk = parseClock(s.replace(/.*\b(?:days?|weeks?)\b/, '').replace(/\bat\b/, ''));
        if (clk) d.setHours(clk.h, clk.m, 0, 0);
        return { kind: 'once', at: d.getTime() };
    }

    // weekday at the START only: "friday", "next monday", "by friday", "on tue 3pm"
    const wd = s.match(/^(?:next\s+|by\s+|on\s+|this\s+)?(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thu|friday|fri|saturday|sat)\b/);
    if (wd) {
        const WEEKDAYS = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tues: 2, tue: 2, wednesday: 3, wed: 3, thursday: 4, thurs: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };
        const target = WEEKDAYS[wd[1]];
        const base = new Date(now);
        let ahead = (target - base.getDay() + 7) % 7;
        if (ahead === 0) ahead = 7; // same weekday → the next one, not today
        const d = new Date(now);
        d.setDate(d.getDate() + ahead);
        const clk = parseClock(s.replace(wd[0], '')) || { h: 9, m: 0 };
        d.setHours(clk.h, clk.m, 0, 0);
        return { kind: 'once', at: d.getTime() };
    }

    // bare clock at the START only (so "rent in 3 days" isn't read as 3 o'clock);
    // roll to tomorrow if the time already passed today
    const cm = s.match(/^(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|noon|midnight)\b/);
    if (cm) {
        const clock = parseClock(cm[1]);
        if (clock) {
            const d = new Date(now);
            d.setHours(clock.h, clock.m, 0, 0);
            if (d.getTime() <= now) d.setTime(d.getTime() + DAY);
            return { kind: 'once', at: d.getTime() };
        }
    }
    return null;
}

const CLOCK = '(?:\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?|noon|midnight)';
const WEEKDAY = '(?:sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thu|friday|fri|saturday|sat)';
const TIME_LEAD = new RegExp(
    `^(in\\s+\\d+\\s*[a-z]+` +
    `|(?:every\\s*day|everyday|daily|each\\s*day|every\\s*morning|each\\s*morning|every\\s*evening|every\\s*night)(?:\\s+at)?(?:\\s+${CLOCK})?` +
    `|tomorrow(?:\\s+at)?(?:\\s+${CLOCK})?` +
    `|(?:next\\s+|by\\s+|on\\s+|this\\s+)?${WEEKDAY}(?:\\s+(?:at\\s+)?${CLOCK})?` +
    `|at\\s+${CLOCK}` +
    `|${CLOCK})\\b`, 'i');

/**
 * Split "8am call the dentist" → { whenPhrase:'8am', message:'call the dentist' }.
 * Strips a leading ':' / '-' / 'to' between the time and the message.
 */
export function splitReminder(text) {
    const t = String(text || '').trim();
    const m = t.match(TIME_LEAD);
    if (!m) return { whenPhrase: '', message: t };
    const whenPhrase = m[0].trim();
    const message = t.slice(m[0].length).replace(/^\s*(?::|-|—|to)\s+/i, '').trim();
    return { whenPhrase, message };
}

/** Human-friendly description of a `when`. */
export function describeWhen(when) {
    if (!when) return 'unknown';
    if (when.kind === 'daily') return `every day at ${when.time}`;
    const d = new Date(when.at);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    const t = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return sameDay ? `today ${t}` : `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} ${t}`;
}

function todayStr(d = new Date()) { return d.toISOString().slice(0, 10); }

/* ── scheduler ── */
export function createScheduler(store, { deliver, intervalMs = 30_000 } = {}) {
    let timer = null;

    function due(job, now) {
        const w = job.when;
        if (!w) return false;
        if (w.kind === 'once') return now >= w.at;
        if (w.kind === 'daily') {
            const [h, m] = w.time.split(':').map(Number);
            const slot = new Date(now); slot.setHours(h, m, 0, 0);
            return now >= slot.getTime() && job.lastFiredDate !== todayStr(new Date(now));
        }
        return false;
    }

    async function tick() {
        const now = Date.now();
        for (const job of store.all('schedules')) {
            if (job.enabled === false) continue;
            if (!due(job, now)) continue;
            try { await deliver(job); } catch (e) { console.error('[scheduler] deliver failed:', e.message); }
            if (job.when.kind === 'once') store.remove('schedules', job.id);
            else store.update('schedules', job.id, { lastFiredDate: todayStr(new Date(now)) });
        }
    }

    return {
        start() { if (!timer) { timer = setInterval(() => tick().catch(() => {}), intervalMs); timer.unref?.(); } return this; },
        stop() { if (timer) clearInterval(timer); timer = null; },
        tick, // exposed for tests / manual run

        /** Add a job from a parsed/explicit spec. Returns the stored job or throws. */
        add({ kind = 'reminder', message = '', when }) {
            if (!when) throw new Error('Could not understand the time. Try "8am", "in 10m", or "every day at 8am".');
            if (kind === 'reminder' && !message.trim()) throw new Error('A reminder needs a message.');
            return store.add('schedules', { kind, message: message.trim(), when, enabled: true });
        },

        list() {
            return store.all('schedules').sort((a, b) => {
                const ka = a.when?.kind === 'once' ? a.when.at : 0;
                const kb = b.when?.kind === 'once' ? b.when.at : 0;
                return ka - kb;
            });
        },

        remove(id) { return store.remove('schedules', id); },
    };
}
