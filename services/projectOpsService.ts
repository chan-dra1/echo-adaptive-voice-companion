import { getCached, setCached } from './cryptoService';
import { chat } from './llmRouter';
import { pickCheapModel, temperatureFor, tokenBudget } from './costPolicy';
import { repoContextService, RepoContextSummary } from './repoContextService';

const PROJECTS_KEY = 'echo_project_ops_projects';

export type ProjectStatus = 'active' | 'blocked' | 'on_hold' | 'completed' | 'archived';

export interface ProjectRecord {
    id: string;
    name: string;
    repo_url?: string;
    brief?: string;
    client?: string;
    due_date?: string | null;
    tags: string[];
    status: ProjectStatus;
    repo_context?: RepoContextSummary;
    createdAt: number;
    updatedAt: number;
}

interface IngestProjectInput {
    name: string;
    repo_url?: string;
    brief?: string;
    client?: string;
    due_date?: string;
    tags?: string[];
    github_token?: string;
}

function normalizeDate(dateLike?: string): string | null {
    if (!dateLike) return null;
    const ts = Date.parse(dateLike);
    return Number.isFinite(ts) ? new Date(ts).toISOString() : null;
}

function readProjects(): ProjectRecord[] {
    const rows = getCached<ProjectRecord[]>(PROJECTS_KEY, []);
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => ({
        ...row,
        tags: Array.isArray(row.tags) ? row.tags : [],
        status: row.status || 'active',
        due_date: row.due_date || null,
    }));
}

function saveProjects(rows: ProjectRecord[]): void {
    setCached(PROJECTS_KEY, rows);
}

function urgencyScore(project: ProjectRecord, now = Date.now()): number {
    if (!project.due_date) return 25;
    const dueMs = Date.parse(project.due_date);
    if (!Number.isFinite(dueMs)) return 25;
    const days = (dueMs - now) / 86_400_000;
    if (days <= 0) return 100;
    if (days <= 1) return 90;
    if (days <= 3) return 75;
    if (days <= 7) return 60;
    if (days <= 14) return 45;
    return 25;
}

function statusPenalty(status: ProjectStatus): number {
    if (status === 'blocked') return -15;
    if (status === 'on_hold') return -30;
    if (status === 'completed' || status === 'archived') return -1000;
    return 0;
}

function priorityScore(project: ProjectRecord): number {
    const base = urgencyScore(project);
    const repoBonus = project.repo_context ? 8 : 0;
    const statusAdj = statusPenalty(project.status);
    return base + repoBonus + statusAdj;
}

function stripBullets(text: string): string[] {
    return text
        .split('\n')
        .map((line) => line.replace(/^[\-\d).\s]+/, '').trim())
        .filter(Boolean);
}

class ProjectOpsService {
    listProjects(status?: ProjectStatus): ProjectRecord[] {
        const all = readProjects().sort((a, b) => b.updatedAt - a.updatedAt);
        return status ? all.filter((item) => item.status === status) : all;
    }

    getProject(projectId: string): ProjectRecord | null {
        return this.listProjects().find((item) => item.id === projectId) || null;
    }

    async ingestProjectContext(input: IngestProjectInput): Promise<ProjectRecord> {
        const now = Date.now();
        const projects = readProjects();
        const name = String(input.name || '').trim();
        if (!name) throw new Error('Project name is required.');

        const existingIdx = projects.findIndex((item) => {
            if (input.repo_url && item.repo_url) return item.repo_url === input.repo_url;
            return item.name.toLowerCase() === name.toLowerCase() && item.status !== 'archived';
        });

        const repoUrl = input.repo_url?.trim() || undefined;
        let repoContext: RepoContextSummary | undefined;
        if (repoUrl) {
            repoContext = await repoContextService.summarizeFromUrl(repoUrl, {
                token: input.github_token,
                includeIssues: false,
            });
        }

        if (existingIdx >= 0) {
            const updated: ProjectRecord = {
                ...projects[existingIdx],
                name,
                repo_url: repoUrl || projects[existingIdx].repo_url,
                brief: input.brief?.trim() || projects[existingIdx].brief || '',
                client: input.client?.trim() || projects[existingIdx].client || '',
                due_date: normalizeDate(input.due_date) ?? projects[existingIdx].due_date ?? null,
                tags: Array.from(new Set([...(projects[existingIdx].tags || []), ...(input.tags || [])])).slice(0, 16),
                repo_context: repoContext || projects[existingIdx].repo_context,
                status: projects[existingIdx].status || 'active',
                updatedAt: now,
            };
            projects[existingIdx] = updated;
            saveProjects(projects);
            return updated;
        }

        const created: ProjectRecord = {
            id: crypto.randomUUID(),
            name,
            repo_url: repoUrl,
            brief: input.brief?.trim() || '',
            client: input.client?.trim() || '',
            due_date: normalizeDate(input.due_date),
            tags: (input.tags || []).filter(Boolean).slice(0, 16),
            status: 'active',
            repo_context: repoContext,
            createdAt: now,
            updatedAt: now,
        };
        projects.push(created);
        saveProjects(projects);
        return created;
    }

    async generateExecutionPlan(input: {
        project_id: string;
        horizon_days?: number;
        focus?: string;
    }): Promise<{
        project: ProjectRecord | null;
        horizonDays: number;
        crossProjectQueue: Array<{ project_id: string; name: string; score: number }>;
        steps: string[];
    }> {
        const project = this.getProject(input.project_id);
        if (!project) {
            return { project: null, horizonDays: 7, crossProjectQueue: [], steps: ['Project not found.'] };
        }

        const horizon = Math.max(1, Math.min(Number(input.horizon_days || 7), 60));
        const active = this.listProjects().filter((item) => item.status === 'active' || item.status === 'blocked');
        const ranked = active
            .map((item) => ({ project_id: item.id, name: item.name, score: priorityScore(item) }))
            .sort((a, b) => b.score - a.score);

        const fallback = [
            `Define one shipping target for ${project.name} within ${horizon} days.`,
            'Break target into three milestones: setup, core delivery, client review.',
            'Reserve first deep-work block for the top blocker.',
            'Post end-of-day status update with next action.',
        ];

        try {
            const modelPick = pickCheapModel('tool_reason');
            const prompt = [
                `Project: ${project.name}`,
                project.client ? `Client: ${project.client}` : '',
                project.brief ? `Brief: ${project.brief}` : '',
                project.due_date ? `Due: ${project.due_date}` : 'Due: none',
                project.repo_context?.readmeSummary ? `Repo summary:\n${project.repo_context.readmeSummary}` : '',
                project.repo_context?.issueSummary ? `Open issues:\n${project.repo_context.issueSummary}` : '',
                `Focus: ${input.focus || 'balanced shipping'}`,
                `Horizon days: ${horizon}`,
                `Cross-project pressure:\n${ranked.slice(0, 5).map((r) => `- ${r.name} (score ${r.score})`).join('\n')}`,
                'Return 5 concise action lines only.',
            ]
                .filter(Boolean)
                .join('\n\n');

            const result = await chat({
                provider: modelPick.provider,
                model: modelPick.model,
                temperature: temperatureFor('tool_reason'),
                maxTokens: tokenBudget('summarize'),
                messages: [
                    { role: 'system', content: 'You are a project delivery planner. Keep output concise and actionable.' },
                    { role: 'user', content: prompt },
                ],
            });
            const steps = stripBullets(result.text).slice(0, 6);
            return {
                project,
                horizonDays: horizon,
                crossProjectQueue: ranked.slice(0, 6),
                steps: steps.length ? steps : fallback,
            };
        } catch {
            return {
                project,
                horizonDays: horizon,
                crossProjectQueue: ranked.slice(0, 6),
                steps: fallback,
            };
        }
    }

    generateDailySchedule(input?: {
        date?: string;
        max_hours?: number;
        include_breaks?: boolean;
    }): {
        date: string;
        maxHours: number;
        includeBreaks: boolean;
        blocks: Array<{ project_id: string; project: string; start: string; end: string; task: string }>;
    } {
        const active = this.listProjects()
            .filter((item) => item.status === 'active' || item.status === 'blocked')
            .sort((a, b) => priorityScore(b) - priorityScore(a));
        const date = input?.date ? new Date(input.date) : new Date();
        const maxHours = Math.max(1, Math.min(Number(input?.max_hours || 8), 14));
        const includeBreaks = input?.include_breaks !== false;
        const totalMinutes = maxHours * 60;
        const blockSize = 90;
        const breakSize = includeBreaks ? 15 : 0;

        const blocks: Array<{ project_id: string; project: string; start: string; end: string; task: string }> = [];
        let cursor = new Date(date);
        cursor.setHours(9, 0, 0, 0);
        let consumed = 0;
        let idx = 0;

        while (consumed + blockSize <= totalMinutes && active.length > 0) {
            const project = active[idx % active.length];
            const start = new Date(cursor);
            cursor.setMinutes(cursor.getMinutes() + blockSize);
            const end = new Date(cursor);
            blocks.push({
                project_id: project.id,
                project: project.name,
                start: start.toISOString(),
                end: end.toISOString(),
                task: `Deep work on ${project.name}${project.status === 'blocked' ? ' (unblock path first)' : ''}`,
            });
            consumed += blockSize;
            if (consumed + breakSize <= totalMinutes && breakSize > 0) {
                cursor.setMinutes(cursor.getMinutes() + breakSize);
                consumed += breakSize;
            }
            idx += 1;
        }

        return {
            date: new Date(date).toISOString().slice(0, 10),
            maxHours,
            includeBreaks,
            blocks,
        };
    }

    updateProjectStatus(projectId: string, status: ProjectStatus, notes?: string): ProjectRecord | null {
        const projects = readProjects();
        const idx = projects.findIndex((item) => item.id === projectId);
        if (idx < 0) return null;
        const current = projects[idx];
        const mergedBrief = notes ? [current.brief || '', `Status note: ${notes}`].filter(Boolean).join('\n') : current.brief;
        projects[idx] = {
            ...current,
            status,
            brief: mergedBrief,
            updatedAt: Date.now(),
        };
        saveProjects(projects);
        return projects[idx];
    }
}

export const projectOpsService = new ProjectOpsService();
