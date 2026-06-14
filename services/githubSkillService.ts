/**
 * githubSkillService.ts — "learn a skill from open-source GitHub".
 *
 * Pipeline (all gated for safety):
 *   1. github_learn_skill(url, goal)
 *      → daemon clone_repo  (PUBLIC github/gitlab only; private/credentialed
 *                            repos are hard-blocked at the daemon)
 *      → daemon scan_repo   (server-side secret REDACTION + malware scan;
 *                            secrets never reach the cloud)
 *      → if UNSAFE: refuse, return reasons. Echo will not learn from it.
 *      → if SAFE: return de-secreted reference excerpts + an instruction
 *        telling the model to STUDY the code and call `propose_new_skill`
 *        to write its OWN sandbox-safe implementation.
 *
 * Crucial safety property: the cloned repository's code is NEVER executed.
 * It is read-only reference material. The only code that ever runs is the
 * model-authored skill, which runs inside the existing Web-Worker sandbox
 * (no DOM, no eval, fetch only to an approved allowlist).
 *
 * Requires the Echo Hands daemon (to clone). On devices without it (phone),
 * this tool is simply unavailable — graceful degradation.
 */

import type { FunctionDeclaration } from '@google/genai';
import { Type } from '@google/genai';
import { handsCall, isHandsConnected } from './handsBridgeService';

export const GITHUB_SKILL_TOOLS: FunctionDeclaration[] = [
    {
        name: 'github_learn_skill',
        description:
            'Learn a new capability by studying a PUBLIC open-source GitHub/GitLab repository. ' +
            'Echo clones the public repo, scans it for secrets (redacted) and malware (refused), ' +
            'and returns safe reference code. After calling this, STUDY the returned excerpts and ' +
            'then call propose_new_skill to implement your OWN sandbox-safe version of the technique. ' +
            'Never copy secrets, never assume the repo code will be executed — reimplement it cleanly. ' +
            'Only PUBLIC repositories are allowed; private/secured repos are blocked by design.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                url: { type: Type.STRING, description: 'Public repo URL, e.g. https://github.com/owner/repo' },
                goal: { type: Type.STRING, description: 'What capability you want to extract, e.g. "parse iCal files" or "compute haversine distance".' },
            },
            required: ['url', 'goal'],
        },
    },
];

export function getGithubSkillTools(): FunctionDeclaration[] {
    return isHandsConnected() ? GITHUB_SKILL_TOOLS : [];
}

export function isGithubSkillTool(name: string): boolean {
    return name === 'github_learn_skill';
}

export async function executeGithubSkillTool(name: string, args: Record<string, any>): Promise<{ result?: any; error?: string }> {
    if (name !== 'github_learn_skill') return { error: `Unknown tool: ${name}` };
    if (!isHandsConnected()) {
        return { error: 'Learning from GitHub needs the Echo Hands daemon (to clone the repo). Start it and pair via ⌘K → Connect Echo Hands.' };
    }

    const url = String(args.url || '');
    const goal = String(args.goal || '');

    // Light confirmation — cloning a public repo is benign but user-visible.
    const ok = window.confirm(`Echo wants to learn from a public repository:\n\n${url}\n\nGoal: ${goal || '(general)'}\n\nIt will clone (read-only), scan for secrets/malware, and only learn if safe. Allow?`);
    if (!ok) return { error: 'User declined the GitHub learning request.' };

    try {
        // 1. Clone (daemon enforces public-only)
        const cloned = await handsCall('clone_repo', { url });

        // 2. Scan (daemon redacts secrets + flags malware)
        const scan = await handsCall('scan_repo', { slug: cloned.slug });

        if (!scan.safe) {
            return {
                result: {
                    learned: false,
                    safe: false,
                    verdict: scan.verdict,
                    reasons: scan.reasons,
                    instruction: 'This repository was REFUSED for safety reasons. Tell the user you will not learn from it, and suggest a different, reputable repo.',
                },
            };
        }

        // 3. Hand clean reference to the model for reimplementation
        return {
            result: {
                learned: false, // not yet — model must now write the skill
                safe: true,
                verdict: scan.verdict,
                goal,
                repo: cloned.slug,
                secretsRedacted: scan.secretsRedacted,
                filesScanned: scan.filesScanned,
                referenceExcerpts: scan.excerpts,
                instruction:
                    'This reference code is SAFE and any secrets were already redacted. ' +
                    'Study the technique relevant to the goal, then call propose_new_skill with a ' +
                    'clean, self-contained JavaScript implementation that runs in the sandbox ' +
                    '(no DOM, no eval; fetch only to hosts you declare). Do NOT paste large blocks ' +
                    'verbatim — reimplement the logic. The repo code will not be executed.',
            },
        };
    } catch (e: any) {
        return { error: e?.message || 'GitHub learning failed.' };
    }
}
