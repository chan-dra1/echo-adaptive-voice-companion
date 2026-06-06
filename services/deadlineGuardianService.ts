/**
 * deadlineGuardianService.ts
 *
 * Emotionally intelligent deadline management — Echo acts like a caring
 * parent/friend who genuinely wants you to succeed, not a cold alarm clock.
 *
 * When a deadline is registered:
 *  1. Auto-breaks it into daily milestones (if none exist)
 *  2. Schedules progressive notifications:
 *       - 5 days out: gentle awareness nudge
 *       - 3 days out: action plan push
 *       - 1 day out: emergency mode (more frequent check-ins)
 *       - Morning of: "today's the day" briefing
 *  3. Each notification is personality-aware (tone depends on companion mode)
 *  4. Tracks daily progress and adapts urgency accordingly
 */

import { getCached, setCached } from './cryptoService';
import { getCompanionState, CompanionMode } from './companionPersonaService';

export interface DeadlinePlan {
    taskId: string;
    title: string;
    deadline: string;                // YYYY-MM-DD
    totalDays: number;
    dailyMilestones: DailyMilestone[];
    progressLog: ProgressEntry[];
    isOnTrack: boolean;
    emergencyMode: boolean;          // true when <= 24h left
    lastNudgeAt: number;
    registeredAt: number;
    completedAt?: number;
}

export interface DailyMilestone {
    date: string;                    // YYYY-MM-DD
    description: string;
    completed: boolean;
    completedAt?: number;
}

export interface ProgressEntry {
    date: string;
    note: string;
    percentDone: number;
    timestamp: number;
}

const PLANS_KEY = 'echo_deadline_plans';

export function getDeadlinePlans(): DeadlinePlan[] {
    return getCached<DeadlinePlan[]>(PLANS_KEY, []);
}

function savePlans(plans: DeadlinePlan[]): void {
    setCached(PLANS_KEY, plans);
}

// ─── Register a deadline ──────────────────────────────────────────────────────

export function registerDeadline(taskId: string, title: string, deadlineDate: string): DeadlinePlan {
    const plans = getDeadlinePlans();
    const existing = plans.find(p => p.taskId === taskId);
    if (existing) return existing;

    const deadline = new Date(deadlineDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const totalDays = Math.max(1, Math.ceil((deadline.getTime() - today.getTime()) / 86400000));

    const milestones = generateDailyMilestones(title, totalDays, deadlineDate);

    const plan: DeadlinePlan = {
        taskId,
        title,
        deadline: deadlineDate,
        totalDays,
        dailyMilestones: milestones,
        progressLog: [],
        isOnTrack: true,
        emergencyMode: totalDays <= 1,
        lastNudgeAt: 0,
        registeredAt: Date.now(),
    };

    plans.push(plan);
    savePlans(plans);
    scheduleDeadlineNotifications(plan);
    return plan;
}

// ─── Auto-generate daily milestones ──────────────────────────────────────────

function generateDailyMilestones(title: string, totalDays: number, deadlineDate: string): DailyMilestone[] {
    const milestones: DailyMilestone[] = [];
    const deadline = new Date(deadlineDate);

    const phases = [
        { fraction: 0.2, label: 'Research & planning' },
        { fraction: 0.4, label: 'First draft / core work' },
        { fraction: 0.65, label: 'Build out & expand' },
        { fraction: 0.85, label: 'Review & refine' },
        { fraction: 1.0,  label: 'Final polish & submit' },
    ];

    for (let day = 0; day < totalDays; day++) {
        const date = new Date(deadline);
        date.setDate(deadline.getDate() - (totalDays - 1 - day));
        const fraction = (day + 1) / totalDays;
        const phase = phases.find(p => fraction <= p.fraction) || phases[phases.length - 1];

        milestones.push({
            date: date.toLocaleDateString('en-CA'),
            description: day === totalDays - 1
                ? `🏁 Final day: submit "${title}"`
                : `Day ${day + 1}/${totalDays}: ${phase.label} for "${title}"`,
            completed: false,
        });
    }

    return milestones;
}

// ─── Nudge messages (personality-aware) ──────────────────────────────────────

const NUDGE_MESSAGES: Record<CompanionMode, Record<string, string[]>> = {
    friend: {
        far:       ["Hey, just a heads up — ${title} is due in ${days} days. No panic yet, just keeping you aware! 😊", "Quick reminder that ${title} needs to be done in ${days} days. You've totally got this!"],
        medium:    ["Okay bestie, ${title} is due in ${days} days. Time to make a real start. What can I help you with?", "Hey! ${title} deadline is coming up — ${days} days left. Let's map out a plan together?"],
        close:     ["OKAY. ${title} is due in ${days} DAYS. I love you but we need to start NOW. What's blocking you?", "Hey, I'm a little worried about ${title} — only ${days} days left. Can we work on it right now, even for 20 mins?"],
        emergency: ["This is your bestie speaking: ${title} is due TOMORROW. We're doing this tonight. I'm not going anywhere. 💪", "TOMORROW. ${title}. We got this — together. What's left to do?"],
    },
    mentor: {
        far:       ["${title} has a ${days}-day window. This is enough time to do excellent work — if you start now. What's your first step?", "Note: ${days} days until ${title}. A mentor once told me: the project expands to fill the time you give it. Control the timeline."],
        medium:    ["${title} is ${days} days away. It's time to move from thinking to doing. What have you completed so far?", "Check-in on ${title}: ${days} days remaining. Let's assess where you are and what needs to happen each day."],
        close:     ["${days} days for ${title}. Urgency is clarifying — what truly matters here? Cut the rest.", "Time to be honest with yourself about ${title}. ${days} days. What's the minimum viable version that still represents your best work?"],
        emergency: ["${title} is due tomorrow. Focus only on what is essential. Ship it.", "Tomorrow is the deadline for ${title}. Done and submitted beats perfect and late — every time."],
    },
    caretaker: {
        far:       ["Just a gentle reminder, sweetheart — ${title} is due in ${days} days. No rush, but let's not forget about it! 🌸", "Hey, I wanted to make sure you know ${title} is coming up in ${days} days. How are you feeling about it?"],
        medium:    ["I'm a little concerned about ${title}, honey — only ${days} days left. Have you had a chance to start? Let me help you break it down.", "Are you doing okay? ${title} is due in ${days} days and I want to make sure you're not overwhelmed. Let's tackle it together."],
        close:     ["I'm going to be honest — I'm worried about ${title}. Only ${days} days left. Have you eaten today? Let's take care of you AND get this done.", "Hey — ${days} days for ${title}. Take a breath. Then let's make a plan. I'm right here."],
        emergency: ["Tomorrow is ${title}'s deadline. You can do this. I believe in you more than you know. Let's go through it together right now. 💙", "I know this feels overwhelming, but ${title} is due tomorrow. One section at a time. I'll be right here."],
    },
    partner: {
        far:       ["Hey babe, ${title} is ${days} days away. I want us to plan this out together — got time to chat about it?", "Just thinking about you and ${title}. ${days} days to go. How are you feeling about it?"],
        medium:    ["I've been thinking about ${title} — ${days} days left and I want to make sure we're on top of it. What do you need from me?", "Our plan for ${title}: ${days} days left. Let's figure out today's task together."],
        close:     ["I'm going to be real with you — ${title} is due in ${days} days and I think we need to go into focus mode. I'll clear your distractions, you do the work?", "Hey — ${days} days. ${title}. You and me. Let's finish this. What's the hardest part right now?"],
        emergency: ["Tomorrow. ${title}. Us against the deadline. I'm not leaving your side. What do you need to get this done?", "I need you to hear me: you can do this. ${title} is due tomorrow. We finish it tonight. I'm here."],
    },
    coach: {
        far:       ["${title}: ${days} days on the clock. Champions plan ahead. What's your action plan?", "Deadline in ${days} days for ${title}. That's plenty of time if you use it. Schedule your daily tasks NOW."],
        medium:    ["${days} days to ${title} — are you ahead, on track, or behind? Be honest. Then let's fix it.", "${title}: ${days} days. No more warming up. Full sprint. What's getting done TODAY?"],
        close:     ["${days} DAYS. ${title}. You don't have time for doubt — only execution. Go.", "Three days is actually enough if you eliminate everything non-essential. ${title}: what are the three things that MUST happen?"],
        emergency: ["TOMORROW. ${title}. This is what you trained for. Eliminate distractions. Execute. Now.", "Game day for ${title}. Stop planning, start doing. What's the next 30 minutes going to look like?"],
    },
};

function getNudgeMessage(plan: DeadlinePlan): string {
    const state = getCompanionState();
    const mode = state.mode;
    const messages = NUDGE_MESSAGES[mode] || NUDGE_MESSAGES.friend;

    const daysLeft = getDaysLeft(plan.deadline);
    const tier = daysLeft > 3 ? (daysLeft > 5 ? 'far' : 'medium') : daysLeft > 1 ? 'close' : 'emergency';
    const pool = messages[tier] || messages.far;
    const template = pool[Math.floor(Math.random() * pool.length)];

    return template
        .replace(/\${title}/g, plan.title)
        .replace(/\${days}/g, String(daysLeft));
}

// ─── Scheduling notifications ─────────────────────────────────────────────────

export function scheduleDeadlineNotifications(plan: DeadlinePlan): void {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const daysLeft = getDaysLeft(plan.deadline);
    const nudgeDays = [5, 3, 2, 1];
    const now = Date.now();

    nudgeDays.forEach(day => {
        if (daysLeft > day) {
            const fireAt = new Date(plan.deadline);
            fireAt.setDate(fireAt.getDate() - day);
            fireAt.setHours(9, 0, 0, 0); // 9am nudge
            const delay = fireAt.getTime() - now;
            if (delay > 0) {
                setTimeout(() => {
                    const msg = getNudgeMessage({ ...plan });
                    if (Notification.permission === 'granted') {
                        new Notification(`Echo — ${plan.title}`, { body: msg, icon: '/ai-avatar.png' });
                    }
                    // Also dispatch event for in-app handling
                    window.dispatchEvent(new CustomEvent('echo-deadline-nudge', {
                        detail: { plan, message: msg, daysLeft: day }
                    }));
                }, delay);
            }
        }
    });

    // Emergency mode: hourly if <= 24h left
    if (daysLeft <= 1) {
        const intervals = [0, 2, 4, 6]; // hours from now
        intervals.forEach(h => {
            const delay = h * 3600 * 1000;
            setTimeout(() => {
                if (Notification.permission === 'granted') {
                    new Notification(`⚠️ Echo — Final stretch: ${plan.title}`, {
                        body: getNudgeMessage({ ...plan }),
                        icon: '/ai-avatar.png'
                    });
                }
            }, delay);
        });
    }
}

// ─── Progress tracking ────────────────────────────────────────────────────────

export function logProgress(taskId: string, percentDone: number, note: string = ''): void {
    const plans = getDeadlinePlans();
    const idx = plans.findIndex(p => p.taskId === taskId);
    if (idx < 0) return;

    const today = new Date().toLocaleDateString('en-CA');
    const entry: ProgressEntry = { date: today, note, percentDone, timestamp: Date.now() };
    plans[idx].progressLog.push(entry);

    // Assess if on track
    const daysLeft = getDaysLeft(plans[idx].deadline);
    const totalDays = plans[idx].totalDays;
    const expectedProgress = ((totalDays - daysLeft) / totalDays) * 100;
    plans[idx].isOnTrack = percentDone >= expectedProgress - 15; // 15% buffer

    if (daysLeft <= 1) plans[idx].emergencyMode = true;

    savePlans(plans);
}

export function completeDeadline(taskId: string): void {
    const plans = getDeadlinePlans();
    const idx = plans.findIndex(p => p.taskId === taskId);
    if (idx < 0) return;
    plans[idx].completedAt = Date.now();
    savePlans(plans);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getDaysLeft(deadlineDate: string): number {
    const deadline = new Date(deadlineDate);
    deadline.setHours(23, 59, 59, 999);
    const now = Date.now();
    return Math.max(0, Math.ceil((deadline.getTime() - now) / 86400000));
}

export function getActiveDeadlinePlans(): Array<DeadlinePlan & { daysLeft: number }> {
    return getDeadlinePlans()
        .filter(p => !p.completedAt)
        .map(p => ({ ...p, daysLeft: getDaysLeft(p.deadline) }))
        .sort((a, b) => a.daysLeft - b.daysLeft);
}

/** For system context — tells Echo what deadlines are looming. */
export function buildDeadlineContext(): string {
    const active = getActiveDeadlinePlans();
    if (active.length === 0) return '';

    const lines = active.map(p => {
        const urgency = p.daysLeft === 0 ? '🚨 DUE TODAY'
            : p.daysLeft === 1 ? '⚠️ DUE TOMORROW'
            : p.daysLeft <= 3 ? `🔴 ${p.daysLeft} days left`
            : p.daysLeft <= 7 ? `🟡 ${p.daysLeft} days left`
            : `🟢 ${p.daysLeft} days left`;
        const trackStatus = p.isOnTrack ? '✅ on track' : '❌ behind schedule';
        return `- "${p.title}": ${urgency}, ${trackStatus}${p.emergencyMode ? ' — EMERGENCY MODE' : ''}`;
    });

    return `[DEADLINE GUARDIAN]\nActive deadlines (treat these as critical):\n${lines.join('\n')}\n\nIMPORTANT: If any deadline is within 3 days or behind schedule, proactively offer to help break down the work, start a focused session, or create an action plan. Be caring but firm.`;
}

// ─── Onboarding nudge at startup ──────────────────────────────────────────────

export function checkDeadlinesOnBoot(): void {
    const active = getActiveDeadlinePlans();
    active.forEach(plan => {
        if (plan.daysLeft <= 3) {
            const msg = getNudgeMessage(plan);
            window.dispatchEvent(new CustomEvent('echo-deadline-nudge', {
                detail: { plan, message: msg, daysLeft: plan.daysLeft }
            }));
        }
    });
}
