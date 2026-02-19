import { Type } from "@google/genai";
import { ToolDefinition } from "./agentSkillService";

// ... (API_URL, interfaces, implementation omitted/unchanged) ...

// Tool Definitions for Gemini
export const GHOST_TOOLS: ToolDefinition[] = [
    {
        name: "list_files",
        description: "List all files in the project. Use this to understand the project structure.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                path: { type: Type.STRING, description: "Path to list (defaults to root)" }
            }
        }
    },
    {
        name: "read_file",
        description: "Read the content of a specific file. Use this to inspect code.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                path: { type: Type.STRING, description: "Relative path to the file" }
            },
            required: ["path"]
        }
    },
    {
        name: "write_file",
        description: "Write content to a file. Use this to create or update code.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                path: { type: Type.STRING, description: "Relative path to the file" },
                content: { type: Type.STRING, description: "The full content to write" }
            },
            required: ["path", "content"]
        }
    },
    {
        name: "run_command",
        description: "Execute a shell command. Use this to run tests, install packages, or build.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                command: { type: Type.STRING, description: "Shell command to execute" },
                cwd: { type: Type.STRING, description: "Working directory (optional)" }
            },
            required: ["command"]
        }
    }
];
