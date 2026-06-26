import { FunctionDeclaration, Type } from '@google/genai';
import { Skill, agentSkillService } from '../services/agentSkillService';

interface MissionStep {
    step_description?: string;
    tool: string;
    args: Record<string, any>;
}

const runMissionDeclaration: FunctionDeclaration = {
    name: 'run_mission',
    description: `Execute a multi-step autonomous mission — YOU design the plan and pass it in the steps array.
Each step calls one of your existing tools in sequence. Results chain forward via {{prev}} in args.
Available tools include: search_web, run_terminal_command, read_file, write_file, list_directory, read_webpage, calculate, send_discord_message, and all other registered tools.
EXAMPLE — "research AI news and post summary to Discord":
  step1: {tool:"search_web", args:{query:"AI news today"}}
  step2: {tool:"send_discord_message", args:{message:"Latest AI news:\n{{prev}}"}}
Returns a full execution log with each step's result, timing, and success/fail status.`,
    parameters: {
        type: Type.OBJECT,
        properties: {
            goal: {
                type: Type.STRING,
                description: 'The high-level goal of this mission (shown in the summary).',
            },
            steps: {
                type: Type.ARRAY,
                description: 'Ordered list of tool calls to execute. You design this plan — do NOT ask the user to fill it in.',
                items: {
                    type: Type.OBJECT,
                    properties: {
                        step_description: {
                            type: Type.STRING,
                            description: 'What this step does (for the execution log).',
                        },
                        tool: {
                            type: Type.STRING,
                            description: 'Exact name of the tool to call (must match an existing registered tool).',
                        },
                        args: {
                            type: Type.OBJECT,
                            description: 'Arguments for the tool. Use "{{prev}}" anywhere to inject the previous step\'s full output as a string.',
                        },
                    },
                    required: ['tool', 'args'],
                },
            },
        },
        required: ['goal', 'steps'],
    },
};

function injectPrev(args: Record<string, any>, prev: any): Record<string, any> {
    if (prev === null || prev === undefined) return args;
    const prevStr = typeof prev === 'string' ? prev : JSON.stringify(prev, null, 2);
    try {
        const escaped = prevStr.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
        const s = JSON.stringify(args).replace(/\{\{prev\}\}/g, escaped);
        return JSON.parse(s);
    } catch {
        return args;
    }
}

export const missionPlannerSkill: Skill = {
    name: 'missionPlannerSkill',
    description: 'Autonomous multi-step mission executor. Gemini writes the plan; this skill runs each tool call in sequence, chaining results forward.',
    tools: [runMissionDeclaration],

    execute: async (toolName: string, args: any) => {
        if (toolName !== 'run_mission') return { error: `Unknown tool: ${toolName}` };

        const goal = String(args.goal || '').trim();
        const steps: MissionStep[] = Array.isArray(args.steps) ? args.steps : [];

        if (!steps.length) {
            return { error: 'No steps provided. Include a steps[] array with at least one {tool, args} entry.' };
        }

        const log: Array<{
            step: number;
            tool: string;
            description: string;
            ok: boolean;
            result: any;
            durationMs: number;
        }> = [];

        let prev: any = null;

        for (let i = 0; i < steps.length; i++) {
            const s = steps[i];
            const tool = String(s.tool || '').trim();
            if (!tool) {
                log.push({ step: i + 1, tool: '(none)', description: s.step_description || '', ok: false, result: { error: 'No tool specified' }, durationMs: 0 });
                continue;
            }

            const resolvedArgs = injectPrev(s.args || {}, prev);
            const t0 = Date.now();
            let result: any;
            let ok = false;

            try {
                result = await agentSkillService.executeTool(tool, resolvedArgs);
                ok = !(result && typeof result === 'object' && 'error' in result);
                prev = result;
            } catch (e: any) {
                result = { error: e?.message || String(e) };
                prev = result;
            }

            log.push({
                step: i + 1,
                tool,
                description: s.step_description || `${tool}(...)`,
                ok,
                result,
                durationMs: Date.now() - t0,
            });
        }

        const succeeded = log.filter(l => l.ok).length;
        const failed = steps.length - succeeded;
        const totalMs = log.reduce((a, l) => a + l.durationMs, 0);

        return {
            goal,
            totalSteps: steps.length,
            succeeded,
            failed,
            totalMs,
            log,
            finalResult: prev,
            summary: `Mission "${goal}": ${succeeded}/${steps.length} steps succeeded in ${(totalMs / 1000).toFixed(1)}s.`,
        };
    },
};

export default missionPlannerSkill;
