/**
 * projectModeService.ts — "build me a website and put it live", by voice.
 *
 * Gemini generates the project files in a single tool call; we write them
 * through the Hands daemon in one shot (jailed to ~/EchoProjects/<name>),
 * then deploy with git + gh + vercel CLIs that the user has logged into.
 *
 * Tools exposed to Gemini Live (only when the Hands daemon is connected):
 *   project_scaffold — write all files for a new/updated project (1 confirm)
 *   project_deploy   — push to GitHub and/or deploy to Vercel (1 confirm)
 *   project_list     — list existing Echo projects (no confirm)
 *
 * Deploy prerequisites (one-time, user's terminal):
 *   gh auth login         (GitHub CLI)
 *   npm i -g vercel && vercel login
 */

import type { FunctionDeclaration } from '@google/genai';
import { Type } from '@google/genai';
import { handsCall, isHandsConnected } from './handsBridgeService';

const sh = (s: string) => s.replace(/'/g, `'\\''`);

export const PROJECT_TOOLS: FunctionDeclaration[] = [
    {
        name: 'project_scaffold',
        description: 'Create or update a website/app project on the user\'s computer. Provide ALL files with full content in one call (HTML/CSS/JS/config). Files are written under ~/EchoProjects/<name>. Use for "build me a website/app/page" requests. Keep projects static (HTML/CSS/JS) or simple npm-based; include a package.json only if a build step is truly needed.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                name: { type: Type.STRING, description: 'Short project slug, e.g. "coffee-landing".' },
                description: { type: Type.STRING, description: 'One-line summary of what was built (told back to the user).' },
                files: {
                    type: Type.ARRAY,
                    description: 'Every file of the project with complete content.',
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            path: { type: Type.STRING, description: 'Relative path, e.g. "index.html" or "css/style.css".' },
                            content: { type: Type.STRING, description: 'Full file content.' },
                        },
                        required: ['path', 'content'],
                    },
                },
            },
            required: ['name', 'files'],
        },
    },
    {
        name: 'project_deploy',
        description: 'Publish an EchoProjects project: create/push a GitHub repo and/or deploy live to Vercel. Returns the live URL. Call after project_scaffold, or on an existing project.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                name: { type: Type.STRING, description: 'Project slug used in project_scaffold.' },
                target: { type: Type.STRING, description: '"github", "vercel", or "both" (default "both").' },
                private: { type: Type.BOOLEAN, description: 'Make the GitHub repo private (default true).' },
            },
            required: ['name'],
        },
    },
    {
        name: 'project_list',
        description: 'List the user\'s existing Echo projects (in ~/EchoProjects).',
        parameters: { type: Type.OBJECT, properties: {} },
    },
];

export function getProjectTools(): FunctionDeclaration[] {
    return isHandsConnected() ? PROJECT_TOOLS : [];
}

export function isProjectTool(name: string): boolean {
    return name === 'project_scaffold' || name === 'project_deploy' || name === 'project_list';
}

export async function executeProjectTool(name: string, args: Record<string, any>): Promise<{ result?: any; error?: string }> {
    try {
        switch (name) {
            case 'project_scaffold': {
                const files = (args.files || []) as { path: string; content: string }[];
                const summary = files.map(f => `  ${f.path} (${f.content.length} chars)`).join('\n');
                const ok = window.confirm(`Echo wants to create project "${args.name}" in ~/EchoProjects with ${files.length} files:\n\n${summary.slice(0, 800)}\n\nAllow?`);
                if (!ok) return { error: 'User declined the project scaffold.' };
                const result = await handsCall('create_project', { name: args.name, files });
                window.dispatchEvent(new CustomEvent('project:scaffolded', { detail: { name: args.name, ...result } }));
                return { result: { ...result, note: 'Files written. Offer to deploy with project_deploy.' } };
            }

            case 'project_deploy': {
                const target = (args.target || 'both') as string;
                const isPrivate = args.private !== false;
                const ok = window.confirm(`Echo wants to deploy "${args.name}" → ${target} (repo: ${isPrivate ? 'private' : 'public'}).\nThis runs git/gh/vercel on your machine. Allow?`);
                if (!ok) return { error: 'User declined the deploy.' };

                const dir = `~/EchoProjects/${sh(String(args.name))}`;
                const steps: string[] = [
                    `cd ${dir}`,
                    `git init -q 2>/dev/null; git add -A`,
                    `git -c user.name=Echo -c user.email=echo@local commit -q -m "echo: scaffold ${sh(String(args.name))}" --allow-empty`,
                ];
                if (target === 'github' || target === 'both') {
                    steps.push(`(gh repo view ${sh(String(args.name))} >/dev/null 2>&1 && git push -u origin HEAD 2>&1) || gh repo create ${sh(String(args.name))} ${isPrivate ? '--private' : '--public'} --source=. --push 2>&1`);
                }
                if (target === 'vercel' || target === 'both') {
                    steps.push(`vercel --prod --yes 2>&1 | tail -5`);
                }
                const out = await handsCall('run_command', { command: steps.join(' && ') });

                // Surface the live URL if vercel printed one
                const urlMatch = String(out.stdout || '').match(/https:\/\/[^\s]+\.vercel\.app/);
                return {
                    result: {
                        exitCode: out.exitCode,
                        liveUrl: urlMatch?.[0] || null,
                        log: (out.stdout || '') + (out.stderr ? `\nSTDERR: ${out.stderr}` : ''),
                        note: out.exitCode === 0
                            ? 'Deployed. Tell the user the live URL out loud.'
                            : 'Deploy failed — read the log, fix the issue (e.g. gh/vercel not logged in) and tell the user exactly what to run.',
                    },
                };
            }

            case 'project_list': {
                const out = await handsCall('run_command', { command: 'ls -1 ~/EchoProjects 2>/dev/null || echo "(no projects yet)"' });
                return { result: { projects: out.stdout.trim().split('\n').filter(Boolean) } };
            }

            default:
                return { error: `Unknown project tool: ${name}` };
        }
    } catch (e: any) {
        return { error: e?.message || 'Project tool failed' };
    }
}
