/**
 * campaignStudioService.ts — UGC / content campaign generator.
 *
 * Turns a loose ask ("ideas for a UGC campaign for my coffee brand") into a
 * structured, saved deliverable: positioning, hook variations, full UGC
 * scripts with shot directions, a posting calendar, and caption/hashtag sets.
 *
 * The model fills in the creative content; this tool's job is to (a) give it
 * a rigid schema so the output is consistently structured, and (b) PERSIST
 * the result — as a markdown file under ~/EchoProjects/campaigns when the
 * Hands daemon is connected, and always into encrypted local memory so it's
 * retrievable later.
 */

import type { FunctionDeclaration } from '@google/genai';
import { Type } from '@google/genai';
import { handsCall, isHandsConnected } from './handsBridgeService';
import { saveMemory } from './memoryService';
import { getCached, setCached } from './cryptoService';

const CAMPAIGN_STORE = 'echo_campaigns';
export interface StoredCampaign { id: string; brand: string; markdown: string; createdAt: number; }

export const CAMPAIGN_TOOLS: FunctionDeclaration[] = [
    {
        name: 'campaign_studio',
        description:
            'Produce and SAVE a complete UGC/content marketing campaign. Call this when the user asks ' +
            'for campaign ideas, UGC concepts, a content plan, or social strategy. YOU generate all the ' +
            'creative content (hooks, scripts, calendar); this tool structures and saves it. Provide ' +
            'rich, specific, on-brand content — not placeholders.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                brand: { type: Type.STRING, description: 'Brand / product / creator name.' },
                audience: { type: Type.STRING, description: 'Target audience description.' },
                platform: { type: Type.STRING, description: 'Primary platform(s): TikTok, Reels, Shorts, etc.' },
                bigIdea: { type: Type.STRING, description: 'The campaign\'s core creative concept in 1-2 sentences.' },
                hooks: {
                    type: Type.ARRAY, items: { type: Type.STRING },
                    description: '8-12 scroll-stopping opening hook variations (first 3 seconds).',
                },
                scripts: {
                    type: Type.ARRAY,
                    description: '3-5 full UGC scripts.',
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            title: { type: Type.STRING },
                            durationSec: { type: Type.NUMBER, description: 'Target length in seconds.' },
                            script: { type: Type.STRING, description: 'Spoken/voiceover lines.' },
                            shots: { type: Type.STRING, description: 'Shot-by-shot visual directions.' },
                            cta: { type: Type.STRING, description: 'Call to action.' },
                        },
                        required: ['title', 'script', 'shots'],
                    },
                },
                calendar: {
                    type: Type.ARRAY,
                    description: 'A posting calendar (e.g. 2 weeks).',
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            day: { type: Type.STRING, description: 'e.g. "Day 1 (Mon)".' },
                            concept: { type: Type.STRING },
                            caption: { type: Type.STRING },
                            hashtags: { type: Type.STRING },
                        },
                        required: ['day', 'concept'],
                    },
                },
            },
            required: ['brand', 'bigIdea', 'hooks', 'scripts'],
        },
    },
];

export function isCampaignTool(name: string): boolean {
    return name === 'campaign_studio';
}

function toMarkdown(a: any): string {
    const L: string[] = [];
    L.push(`# UGC Campaign — ${a.brand}`, '');
    if (a.audience) L.push(`**Audience:** ${a.audience}`);
    if (a.platform) L.push(`**Platform:** ${a.platform}`);
    L.push('', `## Big Idea`, a.bigIdea || '', '');

    if (Array.isArray(a.hooks) && a.hooks.length) {
        L.push(`## Hooks (first 3 seconds)`);
        a.hooks.forEach((h: string, i: number) => L.push(`${i + 1}. ${h}`));
        L.push('');
    }
    if (Array.isArray(a.scripts) && a.scripts.length) {
        L.push(`## UGC Scripts`);
        a.scripts.forEach((s: any, i: number) => {
            L.push(`### ${i + 1}. ${s.title || 'Untitled'}${s.durationSec ? ` (${s.durationSec}s)` : ''}`);
            L.push(`**Script:**`, s.script || '', '');
            L.push(`**Shots:**`, s.shots || '', '');
            if (s.cta) L.push(`**CTA:** ${s.cta}`, '');
        });
    }
    if (Array.isArray(a.calendar) && a.calendar.length) {
        L.push(`## Posting Calendar`, '', `| Day | Concept | Caption | Hashtags |`, `|---|---|---|---|`);
        a.calendar.forEach((d: any) =>
            L.push(`| ${d.day || ''} | ${(d.concept || '').replace(/\|/g, '/')} | ${(d.caption || '').replace(/\|/g, '/')} | ${(d.hashtags || '').replace(/\|/g, '/')} |`));
        L.push('');
    }
    L.push('---', `_Generated by Echo · ${new Date().toLocaleString()}_`);
    return L.join('\n');
}

export async function executeCampaignTool(name: string, args: Record<string, any>): Promise<{ result?: any; error?: string }> {
    if (name !== 'campaign_studio') return { error: `Unknown tool: ${name}` };
    try {
        const md = toMarkdown(args);
        const slug = `campaign-${String(args.brand || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}-${Date.now().toString(36)}`;

        // Always save a retrievable summary into encrypted local memory.
        try {
            saveMemory(`campaign:${args.brand}`, md.slice(0, 1800), 'local_only');
        } catch { /* non-fatal */ }

        // Persist the FULL markdown to a browser store so it's downloadable
        // from the Files panel even without the Hands daemon.
        try {
            const list = getCached<StoredCampaign[]>(CAMPAIGN_STORE, []);
            list.push({ id: slug, brand: String(args.brand || 'Untitled'), markdown: md, createdAt: Date.now() });
            setCached(CAMPAIGN_STORE, list.slice(-100));
        } catch { /* vault locked */ }

        // Persist full markdown to disk when Hands is available.
        let savedPath: string | null = null;
        if (isHandsConnected()) {
            try {
                const res = await handsCall('write_file', { path: `~/EchoProjects/campaigns/${slug}.md`, content: md });
                savedPath = res?.path || null;
            } catch { /* fall through to in-memory only */ }
        }

        return {
            result: {
                saved: true,
                file: savedPath,
                savedToMemory: true,
                markdown: md,
                note: savedPath
                    ? `Campaign saved to ${savedPath}. Summarize the big idea + top 3 hooks out loud.`
                    : 'Campaign saved to local memory (start Echo Hands to also save it as a file). Summarize the big idea + top 3 hooks out loud.',
            },
        };
    } catch (e: any) {
        return { error: e?.message || 'Campaign generation failed.' };
    }
}
