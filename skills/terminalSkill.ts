import { FunctionDeclaration, Type } from '@google/genai';
import { Skill } from '../services/agentSkillService';
import { isCoreConnected, coreExec } from '../services/echoCoreSync';

const BLOCKED = [
    /rm\s+-rf?\s*\/(?:\s|$)/i,
    /\bdd\s+if=/i,
    /mkfs\b/i,
    /:\(\)\s*\{.*\};\s*:/,
    />\s*\/dev\/sd/i,
    /sudo\s+rm\s+-rf/i,
    /\bshutdown\b/i,
    /\breboot\b/i,
    /\bhalt\b/i,
];

function isSafe(cmd: string): boolean {
    return !BLOCKED.some(p => p.test(cmd));
}

const runCommandDeclaration: FunctionDeclaration = {
    name: 'run_terminal_command',
    description:
        'Execute a shell command on this Mac and return its stdout/stderr output. Use for: listing files, reading configs, running scripts, git operations, system info, checking processes, running tests, installing packages. Requires Echo Core to be running locally.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            command: {
                type: Type.STRING,
                description:
                    'The shell command to execute. Examples: "ls -la ~/Desktop", "cat package.json", "git log --oneline -5", "node --version", "ps aux | grep node", "npm test"',
            },
        },
        required: ['command'],
    },
};

export const terminalSkill: Skill = {
    name: 'terminalSkill',
    description: 'Run shell commands on this Mac via Echo Core.',
    tools: [runCommandDeclaration],

    execute: async (toolName: string, args: any) => {
        if (toolName !== 'run_terminal_command') return { error: `Unknown tool: ${toolName}` };

        const cmd = String(args.command || '').trim();
        if (!cmd) return { error: 'No command provided.' };

        if (!isSafe(cmd)) {
            return { error: 'Command blocked — looks potentially destructive. Rephrase with a safer alternative.' };
        }

        if (!isCoreConnected()) {
            return {
                error: 'Echo Core is offline. Start it with:\n  cd echo-core && ECHO_HEADLESS=1 nohup node echo.mjs > /tmp/echo-core.log 2>&1 & disown',
            };
        }

        const result = await coreExec(cmd);

        if (!result.ok) {
            return { error: result.error || 'Command failed', stderr: result.stderr, exitCode: result.exitCode };
        }

        const parts = [result.stdout?.trim(), result.stderr?.trim()].filter(Boolean);
        const output = parts.join('\n\n--- stderr ---\n') || '(no output)';
        return { success: true, output, exitCode: result.exitCode ?? 0 };
    },
};

export default terminalSkill;
