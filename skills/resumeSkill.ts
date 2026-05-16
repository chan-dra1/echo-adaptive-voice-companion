import { FunctionDeclaration, Type } from "@google/genai";
import { Skill } from "../services/agentSkillService";

export const getBaseResumeToolDeclaration: FunctionDeclaration = {
    name: "get_base_resume",
    description: "Retrieve the user's base resume from their secure local Vault. Use this when the user asks you to tailor or generate a resume for a specific job."
};

export const resumeSkill: Skill = {
    name: "resumeSkill",
    description: "Retrieves the user's base resume from their local Vault for tailoring.",
    tools: [getBaseResumeToolDeclaration],

    execute: async (toolName: string, _args: any): Promise<any> => {
        if (toolName !== "get_base_resume") {
            return { error: `Tool not found: ${toolName}` };
        }

        try {
            const baseResume = localStorage.getItem('echo_base_resume');
            if (!baseResume || baseResume.trim() === '') {
                return "The user has not saved a base resume in their Vault. Please ask the user to open the Settings Vault and paste their base resume in the 'Career Node' section.";
            }
            return `[USER BASE RESUME START]\n${baseResume}\n[USER BASE RESUME END]\n\nYou can use this information to draft a tailored resume.`;
        } catch (error) {
            return `Failed to retrieve base resume: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
};

export default resumeSkill;
