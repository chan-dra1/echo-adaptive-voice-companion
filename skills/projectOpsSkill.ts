import { FunctionDeclaration, Type } from '@google/genai';
import { Skill } from '../services/agentSkillService';
import { projectOpsService, ProjectStatus } from '../services/projectOpsService';

const ingestProjectContextTool: FunctionDeclaration = {
    name: 'ingest_project_context',
    description: 'Create or update a project with client/repo context for multi-project planning.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            name: { type: Type.STRING },
            repo_url: { type: Type.STRING },
            brief: { type: Type.STRING },
            client: { type: Type.STRING },
            due_date: { type: Type.STRING },
            tags: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['name'],
    },
};

const generateExecutionPlanTool: FunctionDeclaration = {
    name: 'generate_execution_plan',
    description: 'Generate an actionable shipping plan for a specific project with cross-project prioritization.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            project_id: { type: Type.STRING },
            horizon_days: { type: Type.NUMBER },
            focus: { type: Type.STRING },
        },
        required: ['project_id'],
    },
};

const generateDailyScheduleTool: FunctionDeclaration = {
    name: 'generate_daily_schedule',
    description: 'Create a practical day schedule across all active projects.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            date: { type: Type.STRING },
            max_hours: { type: Type.NUMBER },
            include_breaks: { type: Type.BOOLEAN },
        },
    },
};

const listProjectsTool: FunctionDeclaration = {
    name: 'list_projects',
    description: 'List tracked projects and their status.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            status: {
                type: Type.STRING,
                description: 'Optional status filter: active, blocked, on_hold, completed, archived.',
            },
        },
    },
};

const updateProjectStatusTool: FunctionDeclaration = {
    name: 'update_project_status',
    description: 'Update the status of a tracked project.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            project_id: { type: Type.STRING },
            status: { type: Type.STRING },
            notes: { type: Type.STRING },
        },
        required: ['project_id', 'status'],
    },
};

function compactProject(project: any) {
    return {
        id: project.id,
        name: project.name,
        client: project.client || '',
        status: project.status,
        due_date: project.due_date || null,
        tags: project.tags || [],
        repo_url: project.repo_url || '',
        has_repo_context: !!project.repo_context,
        updatedAt: project.updatedAt,
    };
}

const validStatuses = new Set<ProjectStatus>(['active', 'blocked', 'on_hold', 'completed', 'archived']);

const projectOpsSkill: Skill = {
    name: 'projectOpsSkill',
    description: 'Manages multiple concurrent projects, repo-aware execution plans, and daily schedules.',
    tools: [
        ingestProjectContextTool,
        generateExecutionPlanTool,
        generateDailyScheduleTool,
        listProjectsTool,
        updateProjectStatusTool,
    ],
    execute: async (toolName: string, args: any): Promise<any> => {
        switch (toolName) {
            case 'ingest_project_context': {
                const project = await projectOpsService.ingestProjectContext({
                    name: args?.name,
                    repo_url: args?.repo_url,
                    brief: args?.brief,
                    client: args?.client,
                    due_date: args?.due_date,
                    tags: args?.tags,
                    github_token: localStorage.getItem('echo_github_token') || undefined,
                });
                return { ok: true, project: compactProject(project) };
            }
            case 'generate_execution_plan': {
                const result = await projectOpsService.generateExecutionPlan({
                    project_id: args?.project_id,
                    horizon_days: Number(args?.horizon_days || 7),
                    focus: args?.focus,
                });
                return {
                    ok: !!result.project,
                    project: result.project ? compactProject(result.project) : null,
                    horizon_days: result.horizonDays,
                    cross_project_queue: result.crossProjectQueue,
                    steps: result.steps,
                };
            }
            case 'generate_daily_schedule': {
                const schedule = projectOpsService.generateDailySchedule({
                    date: args?.date,
                    max_hours: Number(args?.max_hours || 8),
                    include_breaks: args?.include_breaks !== false,
                });
                return { ok: true, ...schedule };
            }
            case 'list_projects': {
                const status = String(args?.status || '').trim() as ProjectStatus;
                const projects = projectOpsService
                    .listProjects(validStatuses.has(status) ? status : undefined)
                    .map(compactProject);
                return { ok: true, count: projects.length, projects };
            }
            case 'update_project_status': {
                const status = String(args?.status || '').trim() as ProjectStatus;
                if (!validStatuses.has(status)) {
                    return { ok: false, error: 'invalid_status' };
                }
                const project = projectOpsService.updateProjectStatus(args?.project_id, status, args?.notes);
                if (!project) return { ok: false, error: 'project_not_found' };
                return { ok: true, project: compactProject(project) };
            }
            default:
                return { ok: false, error: 'tool_not_found' };
        }
    },
};

export default projectOpsSkill;
