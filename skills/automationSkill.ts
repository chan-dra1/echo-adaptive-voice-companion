import { FunctionDeclaration, Type } from '@google/genai';
import { Skill } from '../services/agentSkillService';
import {
    isCoreConnected,
    coreSaveMission,
    coreDeleteMission,
    coreToggleMission,
    coreListMissions,
    coreTriggerMission,
} from '../services/echoCoreSync';

/**
 * automationSkill — Automation Hub voice/agent control.
 *
 * Lets Echo build, list, toggle, run, and delete autonomous missions by voice
 * — a Zapier-style "when X, do Y" engine that runs in Echo Core even while the
 * browser is closed. Each mission is a cron trigger + an ordered list of steps,
 * where each step is one of the agent's server-side tools (search_web, ask_echo,
 * run_terminal_command, read_file, write_file, send_discord_message, send_email,
 * post_tweet, post_to_social, http_request). Steps chain with {{prev}}.
 */

const STEP_TOOLS = [
    'search_web', 'ask_echo', 'run_terminal_command', 'read_file', 'write_file',
    'send_discord_message', 'send_email', 'post_tweet', 'post_to_social', 'http_request',
];

const createDeclaration: FunctionDeclaration = {
    name: 'create_automation',
    description:
        'Create an autonomous automation (a scheduled "mission") that Echo Core runs on a cron schedule, even while the browser is closed. This is the Zapier killer. Provide the steps as a JSON array string. Each step: {"tool": one of [' +
        STEP_TOOLS.join(', ') +
        '], "args": {...}, "description": "..."}. Steps run in order; use the literal token {{prev}} inside a later step\'s args to inject the previous step\'s output. Example steps_json: \'[{"tool":"search_web","args":{"query":"AI news today"}},{"tool":"ask_echo","args":{"prompt":"Summarize in 3 bullets: {{prev}}"}},{"tool":"send_email","args":{"to":"me@x.com","subject":"Daily AI","body":"{{prev}}"}}]\'',
    parameters: {
        type: Type.OBJECT,
        properties: {
            name: { type: Type.STRING, description: 'Name of the automation, e.g. "Morning AI digest".' },
            cron: { type: Type.STRING, description: 'Cron schedule "min hour dom month dow". e.g. "0 8 * * *"=daily 8am, "*/30 * * * *"=every 30min, "0 9 * * 1"=Mondays 9am.' },
            steps_json: { type: Type.STRING, description: 'JSON array string of steps (see tool description for the shape).' },
            description: { type: Type.STRING, description: 'Optional human description of what this automation does.' },
            enabled: { type: Type.BOOLEAN, description: 'Whether it runs on schedule immediately (default true).' },
        },
        required: ['name', 'cron', 'steps_json'],
    },
};

const listDeclaration: FunctionDeclaration = {
    name: 'list_automations',
    description: 'List all autonomous automations/missions configured in Echo Core, with their schedules and enabled state.',
    parameters: { type: Type.OBJECT, properties: {} },
};

const toggleDeclaration: FunctionDeclaration = {
    name: 'toggle_automation',
    description: 'Enable or disable an automation by id. Disabled automations stay saved but do not run on schedule.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            id: { type: Type.STRING, description: 'The automation/mission id.' },
            enabled: { type: Type.BOOLEAN, description: 'true to enable, false to disable.' },
        },
        required: ['id', 'enabled'],
    },
};

const deleteDeclaration: FunctionDeclaration = {
    name: 'delete_automation',
    description: 'Permanently delete an automation/mission by id.',
    parameters: {
        type: Type.OBJECT,
        properties: { id: { type: Type.STRING, description: 'The automation/mission id to delete.' } },
        required: ['id'],
    },
};

const runNowDeclaration: FunctionDeclaration = {
    name: 'run_automation_now',
    description: 'Trigger an automation/mission to run immediately, ignoring its schedule. Useful for testing.',
    parameters: {
        type: Type.OBJECT,
        properties: { id: { type: Type.STRING, description: 'The automation/mission id to run now.' } },
        required: ['id'],
    },
};

export const automationSkill: Skill = {
    name: 'automationSkill',
    description: 'Automation Hub — create, list, toggle, run, and delete autonomous scheduled missions (a Zapier-style engine running in Echo Core). Requires Echo Core.',
    tools: [createDeclaration, listDeclaration, toggleDeclaration, deleteDeclaration, runNowDeclaration],

    execute: async (toolName: string, args: any) => {
        if (!isCoreConnected()) {
            return { error: 'Automations require Echo Core (it runs them on schedule while the browser is closed). Start Echo Core and pair it via ⌘K first.' };
        }

        if (toolName === 'create_automation') {
            let steps: any[];
            try {
                steps = JSON.parse(args.steps_json || '[]');
                if (!Array.isArray(steps)) throw new Error('steps_json must be a JSON array');
            } catch (e: any) {
                return { error: `Invalid steps_json: ${e.message}. Provide a JSON array of {tool, args} objects.` };
            }
            const bad = steps.find(s => !STEP_TOOLS.includes(s?.tool));
            if (bad) return { error: `Unknown step tool "${bad.tool}". Allowed: ${STEP_TOOLS.join(', ')}.` };

            const mission = {
                name: String(args.name || 'Automation'),
                description: String(args.description || ''),
                cron: String(args.cron || ''),
                enabled: args.enabled !== false,
                steps,
            };
            const r = await coreSaveMission(mission);
            if (r.ok) return { success: true, id: r.mission?.id, message: `Automation "${mission.name}" created (${mission.cron}). ${steps.length} step(s).` };
            return { error: r.error || 'Failed to create automation.' };
        }

        if (toolName === 'list_automations') {
            const r = await coreListMissions();
            if (!r.ok) return { error: r.error || 'Failed to list automations.' };
            const automations = (r.missions || []).map((m: any) => ({
                id: m.id, name: m.name, cron: m.cron, enabled: m.enabled, steps: (m.steps || []).length,
            }));
            return { automations, count: automations.length };
        }

        if (toolName === 'toggle_automation') {
            const r = await coreToggleMission(String(args.id), !!args.enabled);
            if (r.ok) return { success: true, message: `Automation ${args.enabled ? 'enabled' : 'disabled'}.`, mission: r.mission };
            return { error: r.error || 'Failed to toggle.' };
        }

        if (toolName === 'delete_automation') {
            const r = await coreDeleteMission(String(args.id));
            if (r.ok) return { success: true, message: 'Automation deleted.', remaining: (r.missions || []).length };
            return { error: r.error || 'Failed to delete.' };
        }

        if (toolName === 'run_automation_now') {
            const r = await coreTriggerMission(String(args.id));
            if (r.ok) return { success: true, message: 'Automation triggered.', result: r.result };
            return { error: r.error || 'Failed to run.' };
        }

        return { error: `Unknown tool: ${toolName}` };
    },
};

export default automationSkill;
