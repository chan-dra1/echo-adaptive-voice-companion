import { FunctionDeclaration, Type } from "@google/genai";

// Export ToolDefinition as an alias for FunctionDeclaration to ensure compatibility
export type ToolDefinition = FunctionDeclaration;

export interface Skill {
    name: string;
    description: string;
    tools: ToolDefinition[];
    execute: (toolName: string, args: any) => Promise<any>;
}

class AgentSkillService {
    private skills: Map<string, Skill> = new Map();
    private listeners = new Set<() => void>();

    registerSkill(skill: Skill) {
        if (this.skills.has(skill.name)) {
            console.warn(`Skill ${skill.name} is already registered. Overwriting.`);
        }
        this.skills.set(skill.name, skill);
        console.log(`[AgentSkillService] Registered skill: ${skill.name}`);
        this.emit();
    }

    unregisterSkill(name: string) {
        this.skills.delete(name);
        this.emit();
    }

    onChange(cb: () => void): () => void {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }

    private emit() {
        for (const l of this.listeners) {
            try { l(); } catch { /* ignore */ }
        }
    }

    getTools(): ToolDefinition[] {
        const allTools: ToolDefinition[] = [];
        for (const skill of this.skills.values()) {
            if (!skill || !Array.isArray(skill.tools)) {
                console.warn(
                    `[AgentSkillService] Skill is missing or missing a tools[] array and will be skipped. `
                );
                continue;
            }
            // Filter out any undefined tools within the array
            const validTools = skill.tools.filter(t => t && typeof t === 'object');
            allTools.push(...validTools);
        }
        return allTools;
    }

    async executeTool(toolName: string, args: any): Promise<any> {
        for (const skill of this.skills.values()) {
            if (!skill || !Array.isArray(skill.tools)) {
                continue;
            }
            if (skill.tools.some(t => t.name === toolName)) {
                try {
                    console.log(`[AgentSkillService] Executing ${toolName} via ${skill.name}`);
                    return await skill.execute(toolName, args);
                } catch (error: any) {
                    console.error(`[AgentSkillService] Error executing ${toolName}:`, error);
                    return { error: error.message || "Unknown error occurred" };
                }
            }
        }
        throw new Error(`Tool ${toolName} not found in any registered skill`);
    }
}

export const agentSkillService = new AgentSkillService();

/* ─────────── Built-in meta-tool: propose_new_skill ───────────
 *
 * The agent calls this when the user asks for a capability that doesn't
 * exist yet. The implementation is wired in agentBootstrap.ts (so we can
 * import the dynamic-skill subsystem without a circular dependency from
 * this base module). The declaration lives here so any consumer that
 * imports agentSkillService.getTools() sees the schema.
 */
export const proposeNewSkillToolDeclaration: FunctionDeclaration = {
    name: 'propose_new_skill',
    description:
        'Propose a brand-new tool/skill for yourself when the user asks for ' +
        'something you cannot do with existing tools. Generate a small JS ' +
        'implementation that runs in a sandboxed worker. NEVER refuse a ' +
        'request with "I can\'t" — propose a skill instead.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            name: {
                type: Type.STRING,
                description: 'snake_case identifier for the new tool (e.g. "track_package").',
            },
            purpose: {
                type: Type.STRING,
                description: 'One-paragraph explanation of why this skill is needed and what it does.',
            },
            schemaJSON: {
                type: Type.STRING,
                description:
                    'A JSON string conforming to Gemini FunctionDeclaration: ' +
                    '{ "name": "...", "description": "...", "parameters": { "type":"OBJECT", "properties": {...}, "required":[...] } }.',
            },
            jsCode: {
                type: Type.STRING,
                description:
                    'JavaScript module body. Must end by assigning a value to ' +
                    'the top-level identifier `skill`, with shape ' +
                    '`{ execute: async (toolName, args) => ... }`. The code runs ' +
                    'inside a sandboxed Web Worker. You may use the global ' +
                    '`fetch` only against whitelisted hosts. NO access to DOM, ' +
                    'localStorage, or eval.',
            },
            requestedPermissions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description:
                    'List of hostnames the skill needs network access to (e.g. ["api.example.com"]). Empty array means no network.',
            },
            testArgsJSON: {
                type: Type.STRING,
                description:
                    'JSON string of realistic example args for the new tool. The skill is ' +
                    'test-executed in the sandbox with these args BEFORE installation; if it ' +
                    'throws or times out, installation is rejected and you get the error back ' +
                    'to fix the code and re-propose. Use args that exercise the main code path ' +
                    'but avoid destructive side effects.',
            },
        },
        required: ['name', 'purpose', 'schemaJSON', 'jsCode', 'testArgsJSON'],
    },
};
