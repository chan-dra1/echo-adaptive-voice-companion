/**
 * monthlyPlannerService.ts — "plan my month" by voice.
 *
 * Gemini interviews the user about the month's targets, then calls ONE
 * tool — plan_month — with the structured plan. We persist everything
 * into the existing systems so the rest of Echo (briefings, nudges,
 * streaks, deadline guardian) picks it up automatically:
 *
 *   goals     → lifeCoachService.addGoal (with milestones per week)
 *   habits    → lifeCoachService.addHabit
 *   deadlines → deadlineGuardianService.registerDeadline (auto-phases + nudges)
 *   the plan  → encrypted blob + injected into the model context
 *
 * A second tool — get_month_plan — lets Echo recall and discuss the
 * current plan in any later session.
 */

import type { FunctionDeclaration } from '@google/genai';
import { Type } from '@google/genai';
import { addGoal, addHabit, getHabits, HabitCategory, HabitFrequency } from './lifeCoachService';
import { registerDeadline, scheduleDeadlineNotifications } from './deadlineGuardianService';
import { getCached, setCached } from './cryptoService';

const PLAN_KEY = 'echo_month_plan';

export interface WeekPlan {
    week: number;            // 1-5
    theme: string;           // "Foundation", "Build momentum", ...
    targets: string[];       // concrete outcomes for the week
}

export interface MonthPlan {
    month: string;           // "2026-06"
    headline: string;        // one-line mission for the month
    weeks: WeekPlan[];
    createdAt: number;
}

export function getMonthPlan(): MonthPlan | null {
    return getCached<MonthPlan | null>(PLAN_KEY, null);
}

/** Context block for the system prompt — keeps Echo aware of the plan. */
export function buildMonthPlanContext(): string {
    const plan = getMonthPlan();
    if (!plan) return '';
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (plan.month !== currentMonth) return '';
    const dayOfMonth = now.getDate();
    const currentWeek = Math.min(Math.ceil(dayOfMonth / 7), plan.weeks.length);
    const lines = plan.weeks.map(w =>
        `${w.week === currentWeek ? '→' : ' '} Week ${w.week} — ${w.theme}: ${w.targets.join('; ')}`);
    return `MONTH PLAN (${plan.month}) — "${plan.headline}" [currently week ${currentWeek}]:\n${lines.join('\n')}`;
}

const VALID_CATEGORIES: HabitCategory[] = ['health', 'learning', 'social', 'productivity', 'mindfulness', 'custom'];

export const PLANNER_TOOLS: FunctionDeclaration[] = [
    {
        name: 'plan_month',
        description: 'Save the user\'s plan for the current month. Use AFTER interviewing the user about their targets, preferred pace and constraints. Creates goals (with weekly milestones), recurring habits, and hard deadlines in one shot. Summarize the plan back to the user out loud after saving.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                headline: { type: Type.STRING, description: 'One-line mission for the month, in the user\'s own words.' },
                weeks: {
                    type: Type.ARRAY,
                    description: 'Week-by-week breakdown (4-5 weeks).',
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            week: { type: Type.NUMBER },
                            theme: { type: Type.STRING },
                            targets: { type: Type.ARRAY, items: { type: Type.STRING } },
                        },
                        required: ['week', 'theme', 'targets'],
                    },
                },
                goals: {
                    type: Type.ARRAY,
                    description: 'Month-level goals to track with progress bars.',
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            title: { type: Type.STRING },
                            why: { type: Type.STRING, description: 'The user\'s deep motivation.' },
                            category: { type: Type.STRING },
                            milestones: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Ordered milestones, typically one per week.' },
                        },
                        required: ['title', 'why'],
                    },
                },
                habits: {
                    type: Type.ARRAY,
                    description: 'Recurring habits supporting the plan.',
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            name: { type: Type.STRING },
                            frequency: { type: Type.STRING, description: '"daily" or "weekly".' },
                            category: { type: Type.STRING, description: 'health|learning|social|productivity|mindfulness|custom' },
                            icon: { type: Type.STRING, description: 'Single emoji.' },
                        },
                        required: ['name'],
                    },
                },
                deadlines: {
                    type: Type.ARRAY,
                    description: 'Hard-dated deliverables — the deadline guardian will generate phases and nudge the user.',
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            title: { type: Type.STRING },
                            date: { type: Type.STRING, description: 'YYYY-MM-DD.' },
                        },
                        required: ['title', 'date'],
                    },
                },
            },
            required: ['headline', 'weeks'],
        },
    },
    {
        name: 'get_month_plan',
        description: 'Retrieve the user\'s saved plan for this month (headline, weekly themes/targets) to discuss progress or adjust it.',
        parameters: { type: Type.OBJECT, properties: {} },
    },
];

export function isPlannerTool(name: string): boolean {
    return name === 'plan_month' || name === 'get_month_plan';
}

export async function executePlannerTool(name: string, args: Record<string, any>): Promise<{ result?: any; error?: string }> {
    try {
        if (name === 'get_month_plan') {
            const plan = getMonthPlan();
            return { result: plan ?? { note: 'No month plan saved yet. Offer to create one.' } };
        }

        if (name === 'plan_month') {
            const now = new Date();
            const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

            const plan: MonthPlan = {
                month,
                headline: String(args.headline || 'My month'),
                weeks: (args.weeks || []).map((w: any, i: number) => ({
                    week: Number(w.week) || i + 1,
                    theme: String(w.theme || `Week ${i + 1}`),
                    targets: (w.targets || []).map(String),
                })),
                createdAt: Date.now(),
            };
            setCached(PLAN_KEY, plan);

            const created = { goals: 0, habits: 0, deadlines: 0 };

            for (const g of args.goals || []) {
                addGoal({
                    title: String(g.title),
                    why: String(g.why || ''),
                    category: String(g.category || 'personal'),
                    deadline: undefined,
                    milestones: (g.milestones || []).map((t: any, i: number) => ({
                        id: `mp_${Date.now()}_${i}`, title: String(t), completed: false,
                    })),
                    notes: `From month plan: ${plan.headline}`,
                });
                created.goals++;
            }

            const existingHabits = new Set(getHabits().map(h => h.name.toLowerCase()));
            for (const h of args.habits || []) {
                if (existingHabits.has(String(h.name).toLowerCase())) continue; // no duplicates
                const category = VALID_CATEGORIES.includes(h.category) ? h.category as HabitCategory : 'custom';
                const frequency: HabitFrequency = h.frequency === 'weekly' ? 'weekly' : 'daily';
                addHabit({ name: String(h.name), category, frequency, lastCompleted: null, icon: String(h.icon || '⭐') });
                created.habits++;
            }

            for (const d of args.deadlines || []) {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.date))) continue;
                const dPlan = registerDeadline(`mp_${Date.now()}_${created.deadlines}`, String(d.title), String(d.date));
                scheduleDeadlineNotifications(dPlan);
                created.deadlines++;
            }

            window.dispatchEvent(new CustomEvent('planner:month-saved', { detail: plan }));
            return {
                result: {
                    saved: true, month, ...created,
                    note: `Plan saved. ${created.goals} goals, ${created.habits} habits, ${created.deadlines} deadlines created. Summarize the weekly themes back to the user.`,
                },
            };
        }

        return { error: `Unknown planner tool: ${name}` };
    } catch (e: any) {
        return { error: e?.message || 'Planner tool failed' };
    }
}
