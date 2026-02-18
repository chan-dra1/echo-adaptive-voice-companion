import { FunctionDeclaration } from "@google/genai";

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: Record<string, any>;
        required?: string[];
    };
}

export interface Skill {
    name: string;
    description: string;
    tools: ToolDefinition[];
    execute: (toolName: string, args: any) => Promise<any>;
}

class AgentSkillService {
    private skills: Map<string, Skill> = new Map();

    constructor() {
        // Auto-register skills here if needed, or allow external registration
    }

    registerSkill(skill: Skill) {
        if (this.skills.has(skill.name)) {
            console.warn(`Skill ${skill.name} is already registered. Overwriting.`);
        }
        this.skills.set(skill.name, skill);
        console.log(`[AgentSkillService] Registered skill: ${skill.name}`);
    }

    getTools(): ToolDefinition[] {
        const allTools: ToolDefinition[] = [];
        for (const skill of this.skills.values()) {
            allTools.push(...skill.tools);
        }
        return allTools;
    }

    async executeTool(toolName: string, args: any): Promise<any> {
        for (const skill of this.skills.values()) {
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
