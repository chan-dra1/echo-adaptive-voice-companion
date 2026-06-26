import { FunctionDeclaration, Type } from '@google/genai';
import { Skill } from '../services/agentSkillService';
import { isCoreConnected, coreReadFile, coreWriteFile, coreListDir } from '../services/echoCoreSync';

const OFFLINE_MSG =
    'Echo Core not connected — file access requires Echo Core running locally.\n' +
    'Start: cd echo-core && ECHO_HEADLESS=1 nohup node echo.mjs > /tmp/echo-core.log 2>&1 & disown';

const readFileDeclaration: FunctionDeclaration = {
    name: 'read_file',
    description:
        'Read the text contents of a file on this Mac. Only files inside the home directory are accessible. Returns the file content as a string (truncated at 50 KB). Use for reading code, configs, notes, logs, etc.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            path: {
                type: Type.STRING,
                description: 'Absolute or ~ path to the file. Example: "~/Desktop/notes.txt", "/Users/you/project/README.md"',
            },
        },
        required: ['path'],
    },
};

const writeFileDeclaration: FunctionDeclaration = {
    name: 'write_file',
    description:
        'Write text content to a file on this Mac, creating it if it does not exist or overwriting it if it does. Allowed directories: Desktop, Documents, Downloads, /tmp, ~/echo-projects.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            path: {
                type: Type.STRING,
                description: 'Path to write to. Example: "~/Desktop/output.txt", "/tmp/result.json"',
            },
            content: {
                type: Type.STRING,
                description: 'The text content to write into the file.',
            },
        },
        required: ['path', 'content'],
    },
};

const listDirDeclaration: FunctionDeclaration = {
    name: 'list_directory',
    description:
        'List files and folders in a directory on this Mac. Returns names and types (file/dir). Defaults to the home directory if no path is given.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            path: {
                type: Type.STRING,
                description: 'Directory path to list. Omit or use "~" for home directory.',
            },
        },
    },
};

export const fileSystemSkill: Skill = {
    name: 'fileSystemSkill',
    description: 'Read, write, and list files on the local Mac filesystem via Echo Core.',
    tools: [readFileDeclaration, writeFileDeclaration, listDirDeclaration],

    execute: async (toolName: string, args: any) => {
        if (!isCoreConnected()) return { error: OFFLINE_MSG };

        if (toolName === 'read_file') {
            const p = String(args.path || '').trim();
            if (!p) return { error: 'No path provided.' };
            const result = await coreReadFile(p);
            if (!result.ok) return { error: result.error || 'Could not read file.' };
            return { path: p, content: result.content, truncated: result.truncated ?? false };
        }

        if (toolName === 'write_file') {
            const p = String(args.path || '').trim();
            const content = String(args.content ?? '');
            if (!p) return { error: 'No path provided.' };
            const result = await coreWriteFile(p, content);
            if (!result.ok) return { error: result.error || 'Could not write file.' };
            return { success: true, path: result.path };
        }

        if (toolName === 'list_directory') {
            const p = String(args.path || '~').trim();
            const result = await coreListDir(p);
            if (!result.ok) return { error: result.error || 'Could not list directory.' };
            return { path: result.path, items: result.items, count: result.items?.length ?? 0 };
        }

        return { error: `Unknown tool: ${toolName}` };
    },
};

export default fileSystemSkill;
