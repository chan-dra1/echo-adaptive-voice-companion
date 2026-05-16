import { getCached, setCached } from './cryptoService';
import { chat } from './llmRouter';
import { pickCheapModel, temperatureFor, tokenBudget } from './costPolicy';
import { sanitizeTaskForResearch } from './privacyPolicyService';
import { responseCache } from './responseCache';

const TASKS_KEY = 'echo_task_missions';

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface TaskMission {
    id: string;
    title: string;
    description?: string;
    dueAt?: string | null;
    priority: number; // 1 (low) -> 5 (critical)
    status: TaskStatus;
    createdAt: number;
    updatedAt: number;
    tags: string[];
    folderId?: string | null;
    aggressivenessLevel: number; // 1 -> 5
    nextNudgeAt?: string | null;
    nudgeCount: number;
    nudgeCountToday?: number;
    lastNudgeDay?: string;
    overdueNotifiedAt?: string | null;
    cloudOk?: boolean;
}

export interface TaskMissionCreateInput {
    title: string;
    description?: string;
    dueAt?: string | null;
    priority?: number;
    status?: TaskStatus;
    tags?: string[];
    folderId?: string | null;
    aggressivenessLevel?: number;
    cloudOk?: boolean;
}

type TaskMissionUpdateInput = Partial<Omit<TaskMission, 'id' | 'createdAt'>>;

interface RuntimeResumeSummary {
    missedNudges: number;
    overdueTasks: number;
}

const timers = new Map<string, number>();
let initialized = false;

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function localDayStamp(ts: number = Date.now()): string {
    return new Date(ts).toLocaleDateString('en-CA');
}

function parseDueAt(dueAt?: string | null): string | null {
    if (!dueAt) return null;
    const parsed = Date.parse(dueAt);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function listTasksRaw(): TaskMission[] {
    const tasks = getCached<TaskMission[]>(TASKS_KEY, []);
    if (!Array.isArray(tasks)) return [];
    return tasks.map((task) => ({
        ...task,
        dueAt: task.dueAt || null,
        nextNudgeAt: task.nextNudgeAt || null,
        overdueNotifiedAt: task.overdueNotifiedAt || null,
        folderId: task.folderId || null,
        tags: Array.isArray(task.tags) ? task.tags : [],
        priority: clamp(task.priority || 3, 1, 5),
        aggressivenessLevel: clamp(task.aggressivenessLevel || 3, 1, 5),
        nudgeCount: task.nudgeCount || 0,
    }));
}

function saveTasks(tasks: TaskMission[]): void {
    setCached(TASKS_KEY, tasks);
}

function isQuietHours(ts: number): boolean {
    const hour = new Date(ts).getHours();
    return hour >= 23 || hour < 7;
}

function moveToQuietEnd(ts: number): number {
    const d = new Date(ts);
    if (!isQuietHours(ts)) return ts;
    if (d.getHours() >= 23) d.setDate(d.getDate() + 1);
    d.setHours(7, 0, 0, 0);
    return d.getTime();
}

function maxNagsPerDay(task: TaskMission): number {
    return clamp(3 + task.aggressivenessLevel + Math.ceil(task.priority / 2), 3, 10);
}

function nudgeIntervalMs(task: TaskMission, now = Date.now()): number {
    const overdue = !!task.dueAt && Date.parse(task.dueAt) <= now;
    const baseMinutesByAggro: Record<number, number> = {
        1: 240,
        2: 120,
        3: 60,
        4: 30,
        5: 15,
    };
    const priorityFactor: Record<number, number> = {
        1: 1.25,
        2: 1,
        3: 0.75,
        4: 0.55,
        5: 0.4,
    };
    const base = baseMinutesByAggro[task.aggressivenessLevel] || 60;
    const intervalMinutes = base * (priorityFactor[task.priority] || 1) * (overdue ? 0.6 : 1);
    return Math.max(5, Math.round(intervalMinutes)) * 60_000;
}

function computeNextNudgeAt(task: TaskMission, now = Date.now()): string | null {
    if (task.status !== 'pending' && task.status !== 'in_progress') return null;
    const lastStamp = task.lastNudgeDay;
    const todayStamp = localDayStamp(now);
    const todayCount = lastStamp === todayStamp ? (task.nudgeCountToday || 0) : 0;
    if (todayCount >= maxNagsPerDay(task)) {
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(7, 0, 0, 0);
        return tomorrow.toISOString();
    }
    let next = now + nudgeIntervalMs(task, now);
    next = moveToQuietEnd(next);
    return new Date(next).toISOString();
}

function maybeEmitOverdue(task: TaskMission): TaskMission {
    if (!task.dueAt) return task;
    const dueTs = Date.parse(task.dueAt);
    if (!Number.isFinite(dueTs) || dueTs > Date.now()) return task;
    if (task.overdueNotifiedAt) return task;
    const nowIso = new Date().toISOString();
    window.dispatchEvent(new CustomEvent('echo-task-overdue', { detail: { task } }));
    return { ...task, overdueNotifiedAt: nowIso };
}

function applyNudgeBookkeeping(task: TaskMission): TaskMission {
    const today = localDayStamp();
    const previous = task.lastNudgeDay === today ? (task.nudgeCountToday || 0) : 0;
    const afterNudge: TaskMission = {
        ...task,
        nudgeCount: task.nudgeCount + 1,
        nudgeCountToday: previous + 1,
        lastNudgeDay: today,
        updatedAt: Date.now(),
    };
    const overdueTask = maybeEmitOverdue(afterNudge);
    return {
        ...overdueTask,
        nextNudgeAt: computeNextNudgeAt(overdueTask, Date.now()),
    };
}

function scheduleTask(taskId: string): void {
    const handle = timers.get(taskId);
    if (handle !== undefined) {
        clearTimeout(handle);
        timers.delete(taskId);
    }

    const task = listTasksRaw().find((t) => t.id === taskId);
    if (!task) return;
    if (task.status !== 'pending' && task.status !== 'in_progress') return;

    const target = task.nextNudgeAt ? Date.parse(task.nextNudgeAt) : NaN;
    const nextTarget = Number.isFinite(target) ? target : Date.now() + nudgeIntervalMs(task);
    const due = Math.max(0, Math.min(nextTarget - Date.now(), 2 ** 31 - 1));

    const timeout = window.setTimeout(async () => {
        const all = listTasksRaw();
        const idx = all.findIndex((t) => t.id === taskId);
        if (idx < 0) return;
        const current = all[idx];
        if (current.status !== 'pending' && current.status !== 'in_progress') return;
        if (isQuietHours(Date.now())) {
            current.nextNudgeAt = computeNextNudgeAt(current, Date.now());
            all[idx] = { ...current, updatedAt: Date.now() };
            saveTasks(all);
            scheduleTask(taskId);
            return;
        }

        const nextBestAction = await computeNextBestAction(current);
        window.dispatchEvent(new CustomEvent('echo-task-nudge', { detail: { task: current, nextBestAction } }));
        window.dispatchEvent(new CustomEvent('echo-reminder', {
            detail: { title: `Task mission: ${current.title}`, description: 'Progress check-in from Echo.' },
        }));

        all[idx] = applyNudgeBookkeeping(current);
        saveTasks(all);
        scheduleTask(taskId);
    }, due);

    timers.set(taskId, timeout);
}

function scheduleAll(tasks: TaskMission[]): void {
    timers.forEach((handle) => clearTimeout(handle));
    timers.clear();
    for (const task of tasks) {
        if (task.status === 'pending' || task.status === 'in_progress') {
            scheduleTask(task.id);
        }
    }
}

function summarizeTask(task: TaskMission): string {
    const due = task.dueAt ? `Due: ${new Date(task.dueAt).toLocaleString()}.` : 'No due date.';
    const desc = task.description ? task.description : 'No extra details.';
    return `${task.title}. ${desc} Priority ${task.priority}/5. ${due}`;
}

function heuristicPlan(task: TaskMission): string[] {
    const steps: string[] = [];
    steps.push(`Define the smallest next action for "${task.title}".`);
    steps.push('Block 25 focused minutes and start immediately.');
    if (task.dueAt) steps.push(`Set a checkpoint before ${new Date(task.dueAt).toLocaleString()}.`);
    steps.push('Mark progress in Echo after each milestone.');
    return steps.slice(0, 4);
}

async function computeNextBestAction(task: TaskMission): Promise<string> {
    const fallback = `Do 20 focused minutes on "${task.title}" and log progress in Echo.`;
    const isOverdue = !!task.dueAt && Date.parse(task.dueAt) <= Date.now();
    if (task.priority < 4 && !isOverdue) return fallback;

    const today = localDayStamp();
    const nudgeCountToday = task.lastNudgeDay === today ? (task.nudgeCountToday || 0) : 0;
    if (nudgeCountToday >= 3) return fallback;

    const sanitized = sanitizeTaskForResearch({
        id: task.id,
        title: task.title,
        description: task.description,
        dueAt: task.dueAt,
        priority: task.priority,
        tags: task.tags,
        cloudOk: task.cloudOk,
    });
    if (!sanitized.cloudAllowed) return fallback;

    const modelPick = pickCheapModel('tool_reason');
    const cacheKey = responseCache.makeKey({
        model: `${modelPick.provider}:${modelPick.model}`,
        tag: `next-best-action:${task.id}:${task.updatedAt}`,
        messages: [
            {
                role: 'user',
                content: `${sanitized.payload.title}\n${sanitized.payload.description || ''}\n${sanitized.payload.dueAt || ''}`,
            },
        ],
    });
    const cached = responseCache.get(cacheKey);
    if (cached) return cached;

    try {
        const result = await chat({
            provider: modelPick.provider,
            model: modelPick.model,
            temperature: temperatureFor('tool_reason'),
            maxTokens: Math.min(96, tokenBudget('tool_reason')),
            messages: [
                {
                    role: 'system',
                    content: 'Return one short next-action sentence (max 18 words). No bullet markers.',
                },
                {
                    role: 'user',
                    content: [
                        `Task: ${sanitized.payload.title}`,
                        `Description: ${sanitized.payload.description || 'n/a'}`,
                        sanitized.payload.dueAt ? `Due: ${sanitized.payload.dueAt}` : 'Due: none',
                        `Priority: ${sanitized.payload.priority}/5`,
                    ].join('\n'),
                },
            ],
        });
        const suggestion = result.text.replace(/\s+/g, ' ').trim().slice(0, 180);
        if (!suggestion) return fallback;
        responseCache.set(cacheKey, suggestion, 15 * 60 * 1000);
        return suggestion;
    } catch {
        return fallback;
    }
}

class TaskMissionService {
    initRuntimeHooks(): void {
        if (initialized) return;
        initialized = true;
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                this.handleRuntimeResume();
            }
        });
        window.addEventListener('online', () => this.handleRuntimeResume());
    }

    listTasks(): TaskMission[] {
        return listTasksRaw().sort((a, b) => b.updatedAt - a.updatedAt);
    }

    getTask(taskId: string): TaskMission | null {
        return this.listTasks().find((task) => task.id === taskId) || null;
    }

    createTask(input: TaskMissionCreateInput): TaskMission {
        const now = Date.now();
        const base: TaskMission = {
            id: crypto.randomUUID(),
            title: input.title.trim(),
            description: input.description?.trim() || '',
            dueAt: parseDueAt(input.dueAt),
            priority: clamp(input.priority ?? 3, 1, 5),
            status: input.status || 'pending',
            createdAt: now,
            updatedAt: now,
            tags: (input.tags || []).filter(Boolean).slice(0, 12),
            folderId: input.folderId || null,
            aggressivenessLevel: clamp(input.aggressivenessLevel ?? 3, 1, 5),
            nextNudgeAt: null,
            nudgeCount: 0,
            nudgeCountToday: 0,
            lastNudgeDay: localDayStamp(now),
            overdueNotifiedAt: null,
            cloudOk: input.cloudOk === true,
        };
        const task = { ...base, nextNudgeAt: computeNextNudgeAt(base, now) };
        const all = listTasksRaw();
        all.push(task);
        saveTasks(all);
        scheduleTask(task.id);
        return task;
    }

    updateTask(taskId: string, patch: TaskMissionUpdateInput): TaskMission | null {
        const all = listTasksRaw();
        const idx = all.findIndex((task) => task.id === taskId);
        if (idx < 0) return null;
        const current = all[idx];
        const merged: TaskMission = {
            ...current,
            ...patch,
            priority: clamp((patch.priority ?? current.priority), 1, 5),
            aggressivenessLevel: clamp((patch.aggressivenessLevel ?? current.aggressivenessLevel), 1, 5),
            dueAt: patch.dueAt !== undefined ? parseDueAt(patch.dueAt) : current.dueAt,
            tags: patch.tags ? patch.tags.filter(Boolean).slice(0, 12) : current.tags,
            updatedAt: Date.now(),
        };
        merged.nextNudgeAt = computeNextNudgeAt(merged, Date.now());
        all[idx] = merged;
        saveTasks(all);
        scheduleTask(taskId);
        return merged;
    }

    completeTask(taskId: string): TaskMission | null {
        return this.updateTask(taskId, {
            status: 'completed',
            nextNudgeAt: null,
        });
    }

    deleteTask(taskId: string): boolean {
        const all = listTasksRaw();
        const filtered = all.filter((task) => task.id !== taskId);
        if (filtered.length === all.length) return false;
        saveTasks(filtered);
        const timeout = timers.get(taskId);
        if (timeout !== undefined) {
            clearTimeout(timeout);
            timers.delete(taskId);
        }
        return true;
    }

    setTaskAggressiveness(taskId: string, level: number): TaskMission | null {
        return this.updateTask(taskId, { aggressivenessLevel: clamp(level, 1, 5) });
    }

    rehydrate(): void {
        const all = this.listTasks();
        const refreshed = all.map((task) => ({
            ...task,
            nextNudgeAt: computeNextNudgeAt(task, Date.now()),
        }));
        saveTasks(refreshed);
        scheduleAll(refreshed);
        this.initRuntimeHooks();
        this.handleRuntimeResume();
    }

    handleRuntimeResume(): RuntimeResumeSummary {
        const all = listTasksRaw();
        const now = Date.now();
        let missedNudges = 0;
        let overdueTasks = 0;
        const updated = all.map((task) => {
            if (task.status !== 'pending' && task.status !== 'in_progress') return task;
            const nudgeAt = task.nextNudgeAt ? Date.parse(task.nextNudgeAt) : NaN;
            const isMissed = Number.isFinite(nudgeAt) && nudgeAt <= now;
            const isOverdue = !!task.dueAt && Date.parse(task.dueAt) <= now;
            if (!isMissed) return task;
            missedNudges += 1;
            if (isOverdue) overdueTasks += 1;
            return applyNudgeBookkeeping(task);
        });
        if (missedNudges > 0) {
            saveTasks(updated);
            scheduleAll(updated);
            window.dispatchEvent(new CustomEvent('echo-task-catchup', {
                detail: {
                    missedNudges: Math.min(missedNudges, 5),
                    overdueTasks: Math.min(overdueTasks, 5),
                },
            }));
        }
        return { missedNudges, overdueTasks };
    }

    async getActionPlan(taskId: string): Promise<{ taskId: string; steps: string[] }> {
        const task = this.getTask(taskId);
        if (!task) {
            return { taskId, steps: ['Task not found.'] };
        }
        const modelPick = pickCheapModel('summarize');
        const fallback = heuristicPlan(task);
        try {
            const result = await chat({
                provider: modelPick.provider,
                model: modelPick.model,
                temperature: temperatureFor('tool_reason'),
                maxTokens: tokenBudget('summarize'),
                messages: [
                    {
                        role: 'system',
                        content: 'You are a strict productivity planner. Return 3 short actionable bullet lines.',
                    },
                    {
                        role: 'user',
                        content: summarizeTask(task),
                    },
                ],
            });
            const steps = result.text
                .split('\n')
                .map((line) => line.replace(/^[\-\d.\s]+/, '').trim())
                .filter(Boolean)
                .slice(0, 4);
            return { taskId, steps: steps.length ? steps : fallback };
        } catch {
            return { taskId, steps: fallback };
        }
    }

    async getResearchBrief(taskId: string): Promise<{
        taskId: string;
        brief: string;
        cloudAllowed: boolean;
        redactions: string[];
        model?: string;
        provider?: string;
    }> {
        const task = this.getTask(taskId);
        if (!task) {
            return {
                taskId,
                brief: 'Task not found.',
                cloudAllowed: false,
                redactions: [],
            };
        }
        const sanitized = sanitizeTaskForResearch({
            id: task.id,
            title: task.title,
            description: task.description,
            dueAt: task.dueAt,
            priority: task.priority,
            tags: task.tags,
            cloudOk: task.cloudOk,
        });

        const modelPick = pickCheapModel(task.priority >= 4 ? 'tool_reason' : 'summarize');
        const prompt = [
            `Task: ${sanitized.payload.title}`,
            `Description: ${sanitized.payload.description || 'n/a'}`,
            `Priority: ${sanitized.payload.priority}/5`,
            sanitized.payload.dueAt ? `Due: ${sanitized.payload.dueAt}` : 'Due: none',
            `Tags: ${(sanitized.payload.tags || []).join(', ') || 'none'}`,
            'Return a compact research brief: 2 bullet points + 1 suggested next query.',
        ].join('\n');

        try {
            const result = await chat({
                provider: modelPick.provider,
                model: modelPick.model,
                temperature: temperatureFor('summarize'),
                maxTokens: tokenBudget('summarize'),
                messages: [
                    {
                        role: 'system',
                        content: 'You produce concise research prep notes for task completion.',
                    },
                    { role: 'user', content: prompt },
                ],
            });

            return {
                taskId,
                brief: result.text.trim() || 'No research output.',
                cloudAllowed: sanitized.cloudAllowed,
                redactions: sanitized.redactions,
                model: modelPick.model,
                provider: modelPick.provider,
            };
        } catch (error: any) {
            return {
                taskId,
                brief: `Research unavailable right now. Suggested next step: search "${task.title}" and focus on one high-impact source.`,
                cloudAllowed: sanitized.cloudAllowed,
                redactions: sanitized.redactions,
            };
        }
    }
}

export const taskMissionService = new TaskMissionService();
