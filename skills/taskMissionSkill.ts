import { FunctionDeclaration, Type } from '@google/genai';
import { Skill } from '../services/agentSkillService';
import { taskMissionService } from '../services/taskMissionService';

const addTaskTool: FunctionDeclaration = {
    name: 'add_task',
    description: 'Add a mission task the user wants to finish.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            dueAt: { type: Type.STRING },
            priority: { type: Type.NUMBER, description: '1-5, where 5 is critical.' },
            tags: { type: Type.ARRAY, items: { type: Type.STRING } },
            folderId: { type: Type.STRING },
            aggressivenessLevel: { type: Type.NUMBER, description: '1-5 reminder intensity.' },
            cloudOk: { type: Type.BOOLEAN, description: 'Allow full cloud research context.' },
        },
        required: ['title'],
    },
};

const updateTaskTool: FunctionDeclaration = {
    name: 'update_task',
    description: 'Update a mission task.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            taskId: { type: Type.STRING },
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            dueAt: { type: Type.STRING },
            priority: { type: Type.NUMBER },
            status: { type: Type.STRING },
            tags: { type: Type.ARRAY, items: { type: Type.STRING } },
            folderId: { type: Type.STRING },
            aggressivenessLevel: { type: Type.NUMBER },
            cloudOk: { type: Type.BOOLEAN },
        },
        required: ['taskId'],
    },
};

const completeTaskTool: FunctionDeclaration = {
    name: 'complete_task',
    description: 'Mark a task as completed and stop nudges.',
    parameters: {
        type: Type.OBJECT,
        properties: { taskId: { type: Type.STRING } },
        required: ['taskId'],
    },
};

const deleteTaskTool: FunctionDeclaration = {
    name: 'delete_task',
    description: 'Delete a task permanently.',
    parameters: {
        type: Type.OBJECT,
        properties: { taskId: { type: Type.STRING } },
        required: ['taskId'],
    },
};

const listTasksTool: FunctionDeclaration = {
    name: 'list_tasks',
    description: 'List current mission tasks.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            status: { type: Type.STRING, description: 'Optional status filter.' },
            limit: { type: Type.NUMBER },
        },
    },
};

const setAggroTool: FunctionDeclaration = {
    name: 'set_task_aggressiveness',
    description: 'Set task reminder aggressiveness from 1 to 5.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            taskId: { type: Type.STRING },
            level: { type: Type.NUMBER },
        },
        required: ['taskId', 'level'],
    },
};

const getPlanTool: FunctionDeclaration = {
    name: 'get_task_action_plan',
    description: 'Generate concise next steps to finish a task.',
    parameters: {
        type: Type.OBJECT,
        properties: { taskId: { type: Type.STRING } },
        required: ['taskId'],
    },
};

const researchTool: FunctionDeclaration = {
    name: 'request_task_research',
    description: 'Generate privacy-filtered task research brief.',
    parameters: {
        type: Type.OBJECT,
        properties: { taskId: { type: Type.STRING } },
        required: ['taskId'],
    },
};

function terseTask(task: any) {
    return {
        id: task.id,
        title: task.title,
        status: task.status,
        dueAt: task.dueAt || null,
        priority: task.priority,
        aggressivenessLevel: task.aggressivenessLevel,
        nextNudgeAt: task.nextNudgeAt || null,
        nudgeCount: task.nudgeCount,
        folderId: task.folderId || null,
    };
}

const taskMissionSkill: Skill = {
    name: 'taskMissionSkill',
    description: 'Stores mission tasks, escalation reminders, action plans, and privacy-safe research.',
    tools: [
        addTaskTool,
        updateTaskTool,
        completeTaskTool,
        deleteTaskTool,
        listTasksTool,
        setAggroTool,
        getPlanTool,
        researchTool,
    ],
    execute: async (toolName: string, args: any): Promise<any> => {
        switch (toolName) {
            case 'add_task': {
                const task = taskMissionService.createTask(args || {});
                return { ok: true, task: terseTask(task) };
            }
            case 'update_task': {
                const { taskId, ...patch } = args || {};
                const task = taskMissionService.updateTask(taskId, patch);
                if (!task) return { ok: false, error: 'task_not_found' };
                return { ok: true, task: terseTask(task) };
            }
            case 'complete_task': {
                const task = taskMissionService.completeTask(args?.taskId);
                if (!task) return { ok: false, error: 'task_not_found' };
                return { ok: true, task: terseTask(task) };
            }
            case 'delete_task': {
                const deleted = taskMissionService.deleteTask(args?.taskId);
                return { ok: deleted };
            }
            case 'list_tasks': {
                const status = args?.status;
                const limit = Math.max(1, Math.min(Number(args?.limit || 20), 100));
                const tasks = taskMissionService
                    .listTasks()
                    .filter((task) => !status || task.status === status)
                    .slice(0, limit)
                    .map(terseTask);
                return { ok: true, count: tasks.length, tasks };
            }
            case 'set_task_aggressiveness': {
                const task = taskMissionService.setTaskAggressiveness(args?.taskId, Number(args?.level));
                if (!task) return { ok: false, error: 'task_not_found' };
                return { ok: true, task: terseTask(task) };
            }
            case 'get_task_action_plan': {
                const plan = await taskMissionService.getActionPlan(args?.taskId);
                return { ok: true, taskId: plan.taskId, steps: plan.steps };
            }
            case 'request_task_research': {
                const research = await taskMissionService.getResearchBrief(args?.taskId);
                return {
                    ok: true,
                    taskId: research.taskId,
                    brief: research.brief,
                    cloudAllowed: research.cloudAllowed,
                    redactions: research.redactions,
                    model: research.model,
                    provider: research.provider,
                };
            }
            default:
                return { ok: false, error: 'tool_not_found' };
        }
    },
};

export default taskMissionSkill;
