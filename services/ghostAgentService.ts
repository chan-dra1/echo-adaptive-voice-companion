import { Type } from "@google/genai";
import { ToolDefinition } from "./agentSkillService";

const API_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

export interface FileSystemNode {
    path: string;
    type: 'file' | 'directory';
}

export interface GhostAgentService {
    isAvailable: () => Promise<boolean>;
    listFiles: (path?: string) => Promise<string[]>;
    readFile: (path: string) => Promise<string>;
    writeFile: (path: string, content: string) => Promise<{ status: string; path: string }>;

}

class GhostAgentServiceImpl implements GhostAgentService {
    async isAvailable(): Promise<boolean> {
        try {
            const res = await fetch(`${API_URL}/status`);
            return res.ok;
        } catch (e) {
            return false;
        }
    }

    async listFiles(path: string = '.'): Promise<string[]> {
        const res = await fetch(`${API_URL}/fs/list`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path })
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        return data.files || [];
    }

    async readFile(path: string): Promise<string> {
        const res = await fetch(`${API_URL}/fs/read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path })
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        return data.content;
    }

    async writeFile(path: string, content: string): Promise<{ status: string; path: string }> {
        const res = await fetch(`${API_URL}/fs/write`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path, content })
        });
        if (!res.ok) throw new Error(await res.text());
        return await res.json();
    }


}

export const ghostAgent = new GhostAgentServiceImpl();

// Tool Definitions for Gemini
export const GHOST_TOOLS: ToolDefinition[] = [
    {
        name: "list_files",
        description: "List all files in the project. Use this to understand the project structure."
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

];
