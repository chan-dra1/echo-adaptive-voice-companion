/**
 * reminderService.ts
 *
 * Single source of truth for reminders & background tasks. Persists
 * encrypted via cryptoService. Reschedules pending reminders on app
 * boot. Fires both `Notification` API + an in-app `echo-reminder`
 * CustomEvent that the App.tsx toast listener already listens for.
 */

import { getCached, setCached } from './cryptoService';

const REMINDERS_KEY = 'echo_reminders';
const BG_TASKS_KEY = 'echo_background_tasks';

export interface Reminder {
    id: string;
    title: string;
    description?: string;
    /** ISO timestamp the reminder should fire. */
    time: string;
    recurring?: {
        frequency: 'daily' | 'weekly' | 'monthly' | 'custom';
        days?: string[];
    };
    status: 'active' | 'completed' | 'cancelled';
    createdAt: number;
}

export interface BackgroundTask {
    id: string;
    task: string;
    scheduledTime: string;
    action?: string;
    status: 'scheduled' | 'completed' | 'cancelled';
    createdAt: number;
}

const timers = new Map<string, number>();

function getReminders(): Reminder[] {
    return getCached<Reminder[]>(REMINDERS_KEY, []);
}

function saveReminders(items: Reminder[]) {
    setCached(REMINDERS_KEY, items);
}

function getBackgroundTasks(): BackgroundTask[] {
    return getCached<BackgroundTask[]>(BG_TASKS_KEY, []);
}

function saveBackgroundTasks(items: BackgroundTask[]) {
    setCached(BG_TASKS_KEY, items);
}

/** Parse a relative time string like "in 5 minutes" → ms-until-fire. */
function parseTimeToDelay(time: string): number {
    const lower = time.toLowerCase().trim();
    const rel = lower.match(/in\s+(\d+)\s*(second|minute|hour|day)/);
    if (rel) {
        const n = parseInt(rel[1], 10);
        const unit = rel[2];
        const mult: Record<string, number> = {
            second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000,
        };
        return n * (mult[unit] || 60_000);
    }
    // Fall back to absolute ISO/date parse
    const t = Date.parse(time);
    if (Number.isFinite(t)) return t - Date.now();
    return 0;
}

function resolveFireTime(time: string): string {
    const d = Date.parse(time);
    if (Number.isFinite(d)) return new Date(d).toISOString();
    const delay = parseTimeToDelay(time);
    return new Date(Date.now() + Math.max(0, delay)).toISOString();
}

function fireReminder(r: Reminder) {
    try {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(r.title, {
                body: r.description || 'Reminder from Echo',
                icon: '/logo192.png',
                tag: r.id,
            });
        }
    } catch { /* notification API not available — toast still fires */ }

    window.dispatchEvent(new CustomEvent('echo-reminder', { detail: r }));
}

function scheduleReminder(r: Reminder) {
    if (r.status !== 'active') return;
    const fireAt = Date.parse(r.time);
    if (!Number.isFinite(fireAt)) return;
    const delay = fireAt - Date.now();
    if (delay <= 0) {
        // fire immediately + mark done
        fireReminder(r);
        completeReminder(r.id);
        return;
    }
    // setTimeout has a 32-bit max ≈ 24.8 days. Clamp + reschedule pattern.
    const cappedDelay = Math.min(delay, 2 ** 31 - 1);
    const handle = window.setTimeout(() => {
        const current = getReminders().find(x => x.id === r.id);
        if (!current || current.status !== 'active') return;
        if (Date.now() >= Date.parse(current.time)) {
            fireReminder(current);
            if (current.recurring) {
                advanceRecurring(current);
            } else {
                completeReminder(current.id);
            }
        } else {
            scheduleReminder(current);
        }
    }, cappedDelay);
    timers.set(r.id, handle);
}

function advanceRecurring(r: Reminder) {
    const next = new Date(r.time);
    switch (r.recurring?.frequency) {
        case 'daily': next.setDate(next.getDate() + 1); break;
        case 'weekly': next.setDate(next.getDate() + 7); break;
        case 'monthly': next.setMonth(next.getMonth() + 1); break;
        default: next.setDate(next.getDate() + 1); break;
    }
    const all = getReminders();
    const idx = all.findIndex(x => x.id === r.id);
    if (idx >= 0) {
        all[idx] = { ...all[idx], time: next.toISOString() };
        saveReminders(all);
        scheduleReminder(all[idx]);
    }
}

function completeReminder(id: string) {
    const all = getReminders();
    const idx = all.findIndex(x => x.id === id);
    if (idx >= 0) {
        all[idx] = { ...all[idx], status: 'completed' };
        saveReminders(all);
    }
    const h = timers.get(id);
    if (h !== undefined) {
        clearTimeout(h);
        timers.delete(id);
    }
}

/* ─────────── Public API ─────────── */

export const reminderService = {
    list(): Reminder[] { return getReminders(); },

    async create(input: { title: string; time: string; description?: string; recurring?: Reminder['recurring']; }): Promise<Reminder> {
        if ('Notification' in window && Notification.permission === 'default') {
            try { await Notification.requestPermission(); } catch { /* ignore */ }
        }
        const r: Reminder = {
            id: crypto.randomUUID(),
            title: input.title,
            description: input.description,
            time: resolveFireTime(input.time),
            recurring: input.recurring,
            status: 'active',
            createdAt: Date.now(),
        };
        const all = getReminders();
        all.push(r);
        saveReminders(all);
        scheduleReminder(r);
        return r;
    },

    cancel(id: string): void {
        const all = getReminders();
        const idx = all.findIndex(x => x.id === id);
        if (idx < 0) return;
        all[idx] = { ...all[idx], status: 'cancelled' };
        saveReminders(all);
        const h = timers.get(id);
        if (h !== undefined) {
            clearTimeout(h);
            timers.delete(id);
        }
    },

    /** Reschedule all active reminders. Call on boot. */
    rehydrate(): void {
        timers.forEach(h => clearTimeout(h));
        timers.clear();
        for (const r of getReminders()) {
            if (r.status === 'active') scheduleReminder(r);
        }
    },

    /* Background tasks (encrypted via crypto cache) */
    listTasks(): BackgroundTask[] { return getBackgroundTasks(); },

    createTask(input: { task: string; scheduledTime: string; action?: string; }): BackgroundTask {
        const t: BackgroundTask = {
            id: crypto.randomUUID(),
            task: input.task,
            scheduledTime: resolveFireTime(input.scheduledTime),
            action: input.action,
            status: 'scheduled',
            createdAt: Date.now(),
        };
        const all = getBackgroundTasks();
        all.push(t);
        saveBackgroundTasks(all);
        return t;
    },
};
