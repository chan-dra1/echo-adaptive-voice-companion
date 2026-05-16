import { FunctionDeclaration, Type } from "@google/genai";
import { Skill } from "../services/agentSkillService";
import { reminderService } from "../services/reminderService";

export const reminderToolDeclaration: FunctionDeclaration = {
    name: "set_reminder",
    description: "Set a reminder or notification for the user. Use this when the user asks to be reminded of something or wants to set a task.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            title: {
                type: Type.STRING,
                description: "The title of the reminder (e.g., 'Meeting with Sarah').",
            },
            time: {
                type: Type.STRING,
                description: "The time for the reminder (ISO format, e.g. '2025-12-12T15:00' or relative like 'in 5 minutes').",
            },
            description: {
                type: Type.STRING,
                description: "Optional details about the reminder.",
            },
            recurring: {
                type: Type.STRING,
                description: "Optional recurrence: 'daily', 'weekly' or 'monthly'.",
            },
        },
        required: ["title", "time"],
    },
};

export const reminderSkill: Skill = {
    name: "reminderSkill",
    description: "Manages reminders and task notifications (encrypted, persistent).",
    tools: [reminderToolDeclaration],

    execute: async (name: string, args: any): Promise<any> => {
        if (name !== "set_reminder") return { error: "Tool not found" };
        const { title, time, description, recurring } = args;
        try {
            const r = await reminderService.create({
                title,
                time,
                description,
                recurring: recurring
                    ? { frequency: recurring as 'daily' | 'weekly' | 'monthly' }
                    : undefined,
            });
            return { result: `Reminder set: "${title}" for ${r.time}`, id: r.id };
        } catch (e) {
            return { error: `Failed to set reminder: ${(e as Error).message}` };
        }
    },
};

export default reminderSkill;
