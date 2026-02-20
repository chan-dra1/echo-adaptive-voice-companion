/**
 * tools/index.ts — The Agentic Tools definitions and execution dispatcher.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { searchMemory } from "../db.js";

export const tools: Anthropic.Tool[] = [
    {
        name: "search_memory",
        description: "Search your past conversation history with this user. Useful for recalling facts, previous topics, or user preferences.",
        input_schema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "The keyword or phrase to search for in past messages.",
                }
            },
            required: ["query"],
        }
    },
    {
        name: "get_time",
        description: "Returns the current local date and time of the system you are running on.",
        input_schema: {
            type: "object",
            properties: {},
        }
    }
];

/**
 * Dispatcher to execute the tool requested by the LLM.
 */
export async function executeTool(name: string, input: any, userId: number): Promise<string> {
    console.log(`[Agent:Tool] Executing ${name} with`, input);

    try {
        switch (name) {
            case "search_memory":
                const results = searchMemory(userId, input.query);
                return results.length > 0
                    ? JSON.stringify(results)
                    : "No matching memories found for that query.";
            case "get_time":
                return new Date().toLocaleString();
            default:
                return `Error: Unknown tool ${name}`;
        }
    } catch (e: any) {
        console.error(`[Agent:Tool] Error executing ${name}:`, e.message);
        return `Error executing tool: ${e.message}`;
    }
}
