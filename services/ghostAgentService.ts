import { ToolDefinition } from "./agentSkillService";

const API_URL = 'http://localhost:8000';

export interface FileSystemNode {
    path: string;
    type: 'file' | 'directory';
}

export interface GhostAgentService {
    isAvailable: () => Promise<boolean>;
    listFiles: (path?: string) => Promise<string[]>;
    readFile: (path: string) => Promise<string>;
    writeFile: (path: string, content: string) => Promise<{ status: string; path: string }>;
    execCommand: (command: string, cwd?: string) => Promise<{ stdout: string; stderr: string; returncode: number }>;
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

    async execCommand(command: string, cwd?: string): Promise<{ stdout: string; stderr: string; returncode: number }> {
        const res = await fetch(`${API_URL}/system/exec`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command, cwd })
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
        description: "List all files in the project. Use this to understand the project structure.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "Path to list (defaults to root)" }
            }
        }
    },
    {
        name: "read_file",
        description: "Read the content of a specific file. Use this to inspect code.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "Relative path to the file" }
            },
            required: ["path"]
        }
    },
    {
        name: "write_file",
        description: "Write content to a file. Use this to create or update code.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "Relative path to the file" },
                content: { type: "string", description: "The full content to write" }
            },
            required: ["path", "content"]
        }
    },
    {
        name: "run_command",
        description: "Execute a shell command. Use this to run tests, install packages, or build.",
        parameters: {
            type: "object",
            properties: {
                command: { type: "string", description: "Shell command to execute" },
                cwd: { type: "string", description: "Working directory (optional)" }
            },
            required: ["command"]
        }
    }
];
