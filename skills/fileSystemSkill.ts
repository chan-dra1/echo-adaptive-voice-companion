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

const editFileDeclaration: FunctionDeclaration = {
    name: 'edit_file',
    description:
        'Make a precise, targeted change to an EXISTING file by replacing one exact snippet of text with another — without rewriting the whole file. Prefer this over write_file whenever modifying an existing file rather than creating a new one: write_file requires you to reconstruct and resend the entire file content, which is slow, expensive, and error-prone for anything beyond a few lines. old_string must match the file exactly (including whitespace/indentation) and must be unique in the file unless replace_all is set — call read_file first and copy the exact text from its result. Allowed directories: same as write_file (Desktop, Documents, Downloads, /tmp, ~/echo-projects).',
    parameters: {
        type: Type.OBJECT,
        properties: {
            path: {
                type: Type.STRING,
                description: 'Path to the file to edit. Example: "~/echo-projects/app.py"',
            },
            old_string: {
                type: Type.STRING,
                description: 'The exact text to find and replace, copied verbatim (including whitespace) from a prior read_file result. Must be unique in the file unless replace_all is true.',
            },
            new_string: {
                type: Type.STRING,
                description: 'The text to replace old_string with.',
            },
            replace_all: {
                type: Type.BOOLEAN,
                description: 'If true, replace every occurrence of old_string instead of requiring exactly one match. Default false.',
            },
        },
        required: ['path', 'old_string', 'new_string'],
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
    tools: [readFileDeclaration, writeFileDeclaration, editFileDeclaration, listDirDeclaration],

    execute: async (toolName: string, args: any) => {
        if (!isCoreConnected()) return { error: OFFLINE_MSG };

        if (toolName === 'read_file') {
            const p = String(args.path || '').trim();
            if (!p) return { error: 'No path provided.' };
            const result = await coreReadFile(p);
            if (!result.ok) return { error: result.error || 'Could not read file.' };
            return { path: p, content: result.content, truncated: result.truncated ?? false };
        }

        if (toolName === 'edit_file') {
            const p = String(args.path || '').trim();
            const oldStr = String(args.old_string ?? '');
            const newStr = String(args.new_string ?? '');
            const replaceAll = args.replace_all === true;
            if (!p) return { error: 'No path provided.' };
            if (!oldStr) return { error: 'old_string cannot be empty — use write_file to create a new file.' };

            const readResult = await coreReadFile(p);
            if (!readResult.ok) return { error: readResult.error || 'Could not read file.' };
            // A truncated read means we don't have the whole file — writing
            // back a "full" reconstruction from a partial read would silently
            // discard everything past the truncation point.
            if (readResult.truncated) {
                return { error: 'File is too large to edit safely (read was truncated at 50 KB). Use write_file with the complete new content instead.' };
            }

            const content = readResult.content || '';
            const occurrences = content.split(oldStr).length - 1;
            if (occurrences === 0) {
                return { error: 'old_string was not found in the file. Copy it exactly from a read_file result — whitespace and indentation must match precisely.' };
            }
            if (occurrences > 1 && !replaceAll) {
                return { error: `old_string appears ${occurrences} times in the file — it must be unique, or pass replace_all: true to replace every occurrence. Add more surrounding context to old_string to make it unique.` };
            }

            const newContent = replaceAll ? content.split(oldStr).join(newStr) : content.replace(oldStr, newStr);
            const writeResult = await coreWriteFile(p, newContent);
            if (!writeResult.ok) return { error: writeResult.error || 'Could not write file.' };
            return { success: true, path: writeResult.path, occurrencesReplaced: replaceAll ? occurrences : 1 };
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
