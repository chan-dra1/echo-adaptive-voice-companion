import { FunctionDeclaration, Type } from '@google/genai';
import { Skill } from '../services/agentSkillService';

/**
 * seoSkill — "SEO Intelligence" for Echo. A lightweight Ahrefs/Semrush alternative.
 *
 * HONEST SCOPE: this skill does keyword IDEATION and pulls a PUBLIC SERP snapshot.
 * It is NOT a paid backlink/search-volume index like Ahrefs or Semrush — Echo has
 * no private ranking, volume, difficulty, or backlink data (that is a hard project
 * rule). What it CAN do:
 *   - keyword_ideas   : deterministically expand a seed into grouped keyword ideas
 *                       (questions, commercial, informational, long-tails). No network.
 *   - serp_snapshot   : fetch the keyless DuckDuckGo Instant Answer API to show the
 *                       public competitive landscape for a keyword (not exhaustive
 *                       ranking data, no volume/difficulty metrics).
 *   - content_brief   : produce a structured SEO content brief (scaffold) that Echo
 *                       then writes against. No network.
 */

interface SerpResult {
    title: string;
    snippet: string;
    url: string;
}

const COMMERCIAL_MODIFIERS = ['best', 'top', 'free', 'vs', 'alternative', 'pricing', 'review', 'tools'];
const INFORMATIONAL_MODIFIERS = ['tutorial', 'for beginners', 'examples', 'how to', '2026'];
const ALL_MODIFIERS = [
    'best', 'top', 'free', 'vs', 'alternative', 'pricing', 'review',
    'tutorial', 'for beginners', '2026', 'tools', 'examples', 'how to',
];
const QUESTION_PREFIXES = ['who', 'what', 'why', 'when', 'how', 'is', 'best way to'];
const COMMERCIAL_SIGNALS = ['buy', 'best', 'price', 'pricing', 'vs', 'cheap', 'deal', 'discount', 'review', 'alternative', 'top'];

function uniq(arr: string[]): string[] {
    return Array.from(new Set(arr.map(s => s.trim()).filter(Boolean)));
}

const keywordIdeasDeclaration: FunctionDeclaration = {
    name: 'keyword_ideas',
    description:
        'Expand a seed keyword into grouped keyword IDEAS for SEO planning. This is deterministic ideation — it does ' +
        'NOT call the network and does NOT return real search volume, keyword difficulty, or traffic estimates (Echo ' +
        'has no private SEO index — this is a lightweight Ahrefs/Semrush alternative, not a paid data product). ' +
        'Returns question-style keywords, commercial/buyer-intent variants, informational variants, and long-tail ' +
        'phrases you can prioritize and write content around.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            seed: {
                type: Type.STRING,
                description: 'The seed keyword/topic to expand (e.g. "running shoes", "email marketing").',
            },
            intent: {
                type: Type.STRING,
                description: "Optional hint about desired intent: 'commercial', 'informational', or 'all'. Defaults to 'all'.",
            },
        },
        required: ['seed'],
    },
};

const serpSnapshotDeclaration: FunctionDeclaration = {
    name: 'serp_snapshot',
    description:
        'Fetch a PUBLIC SERP snapshot for a keyword using the keyless DuckDuckGo Instant Answer API. Returns a small ' +
        'set of {title, snippet, url} results so you can eyeball the competitive landscape (who is ranking / what ' +
        'angles exist). HONEST LIMITS: this is NOT exhaustive ranking data, carries NO search-volume or difficulty ' +
        'metrics, and is not a substitute for a paid SERP index — it is a quick competitive read.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            keyword: {
                type: Type.STRING,
                description: 'The keyword/query to snapshot the public SERP for.',
            },
            num_results: {
                type: Type.NUMBER,
                description: 'How many results to return (1–10, default 5).',
            },
        },
        required: ['keyword'],
    },
};

const contentBriefDeclaration: FunctionDeclaration = {
    name: 'content_brief',
    description:
        'Generate a structured SEO content brief (scaffold) for a target keyword that YOU then write against. This is ' +
        'a planning tool — it does NOT write the article and uses NO network. It returns a suggested title, a target ' +
        'word count, an inferred search intent, a ~7-section H2 outline, People-Also-Ask style questions to answer, ' +
        'related keyword variants, a meta-description, and internal-linking ideas.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            keyword: {
                type: Type.STRING,
                description: 'The primary target keyword to build the brief around (e.g. "email marketing").',
            },
            audience: {
                type: Type.STRING,
                description: 'Optional target audience (e.g. "small business owners"). Defaults to "a general audience".',
            },
        },
        required: ['keyword'],
    },
};

async function ddgSerp(keyword: string, max: number): Promise<{ results: SerpResult[] } | { error: string }> {
    let res: Response;
    try {
        const url =
            `https://api.duckduckgo.com/?q=${encodeURIComponent(keyword)}&format=json&no_html=1&no_redirect=1&t=echo-seo`;
        res = await fetch(url);
    } catch (err: any) {
        return { error: `SERP fetch failed: ${(err?.message || String(err)).slice(0, 200)}` };
    }
    if (!res.ok) {
        let body = '';
        try { body = await res.text(); } catch { /* ignore */ }
        return { error: `SERP fetch failed (HTTP ${res.status}): ${body.slice(0, 200)}` };
    }

    let data: any;
    try {
        data = await res.json();
    } catch (err: any) {
        return { error: `SERP parse failed: ${(err?.message || String(err)).slice(0, 200)}` };
    }

    const out: SerpResult[] = [];
    if (data.AbstractText) {
        out.push({ title: data.Heading || keyword, snippet: data.AbstractText, url: data.AbstractURL || '' });
    }

    const candidates = [...(data.RelatedTopics || []), ...(data.Results || [])];
    for (const t of candidates) {
        if (out.length >= max) break;
        const item = t && t.Topics ? t.Topics[0] : t;
        if (!item || !item.Text) continue;
        out.push({ title: String(item.Text).slice(0, 80), snippet: String(item.Text), url: item.FirstURL || '' });
    }

    return { results: out.slice(0, max) };
}

export const seoSkill: Skill = {
    name: 'seoSkill',
    description:
        'SEO Intelligence — keyword ideas, SERP snapshots, and content briefs. A lightweight Ahrefs/Semrush ' +
        'alternative (no private volume/difficulty/backlink data — keyword ideation plus a public SERP read). ' +
        'Use keyword_ideas to brainstorm groupings, serp_snapshot to scan the public competitive landscape, and ' +
        'content_brief to scaffold an article you then write.',
    tools: [
        keywordIdeasDeclaration,
        serpSnapshotDeclaration,
        contentBriefDeclaration,
    ],

    execute: async (toolName: string, args: any) => {
        if (toolName === 'keyword_ideas') {
            const seed = String(args.seed || '').trim();
            if (!seed) {
                return { error: 'keyword_ideas requires a non-empty `seed`.' };
            }
            const intent = String(args.intent || 'all').trim().toLowerCase();

            const questions = uniq(QUESTION_PREFIXES.map(p => `${p} ${seed}`));

            const modifiers = uniq(ALL_MODIFIERS.map(m =>
                m === 'vs' || m === 'alternative'
                    ? `${seed} ${m}`
                    : m === 'how to'
                        ? `how to ${seed}`
                        : m.endsWith('for beginners') || /\d/.test(m)
                            ? `${seed} ${m}`
                            : `${m} ${seed}`,
            ));

            const commercial = uniq(COMMERCIAL_MODIFIERS.map(m =>
                m === 'vs' || m === 'alternative' || m === 'pricing' || m === 'review' || m === 'tools'
                    ? `${seed} ${m}`
                    : `${m} ${seed}`,
            ));

            const informational = uniq(INFORMATIONAL_MODIFIERS.map(m =>
                m === 'how to'
                    ? `how to ${seed}`
                    : m === 'tutorial' || m === 'examples'
                        ? `${seed} ${m}`
                        : `${seed} ${m}`,
            )).concat([`what is ${seed}`, `how does ${seed} work`]);

            const longTails = uniq([
                `best ${seed} for beginners`,
                `how to choose ${seed}`,
                `${seed} vs alternatives`,
                `cheap ${seed} that work`,
                `${seed} tips and tricks`,
            ]);

            const all = uniq([...questions, ...modifiers, ...commercial, ...informational, ...longTails]);

            return {
                seed,
                intent: intent === 'commercial' || intent === 'informational' ? intent : 'all',
                questions,
                commercial: uniq(commercial),
                informational: uniq(informational),
                longTails,
                count: all.length,
                note: 'Keyword ideation only — no real search-volume or difficulty data (not a paid SEO index).',
            };
        }

        if (toolName === 'serp_snapshot') {
            const keyword = String(args.keyword || '').trim();
            if (!keyword) {
                return { error: 'serp_snapshot requires a non-empty `keyword`.' };
            }
            const max = Math.min(10, Math.max(1, Number(args.num_results) || 5));

            const snap = await ddgSerp(keyword, max);
            if ('error' in snap) {
                return { error: snap.error };
            }

            return {
                keyword,
                results: snap.results,
                count: snap.results.length,
                note: 'Public SERP snapshot — competitive landscape, not exhaustive ranking data.',
            };
        }

        if (toolName === 'content_brief') {
            const keyword = String(args.keyword || '').trim();
            if (!keyword) {
                return { error: 'content_brief requires a non-empty `keyword`.' };
            }
            const audience = String(args.audience || '').trim() || 'a general audience';

            const lower = keyword.toLowerCase();
            const searchIntent = COMMERCIAL_SIGNALS.some(sig => lower.includes(sig))
                ? 'commercial'
                : 'informational';

            const outline = [
                `What is ${keyword}?`,
                `Why ${keyword} matters`,
                `How to get started with ${keyword}`,
                `${keyword} best practices`,
                `Common ${keyword} mistakes to avoid`,
                `Tools & resources for ${keyword}`,
                `${keyword} FAQ`,
            ];

            const questionsToAnswer = [
                `What is ${keyword}?`,
                `How does ${keyword} work?`,
                `Is ${keyword} worth it?`,
                `How much does ${keyword} cost?`,
                `What are the best alternatives to ${keyword}?`,
            ];

            const relatedKeywords = [
                `${keyword} guide`,
                `${keyword} tips`,
                `best ${keyword}`,
                `how to ${keyword}`,
                `${keyword} for beginners`,
                `${keyword} examples`,
                `${keyword} alternatives`,
            ];

            return {
                keyword,
                audience,
                suggestedTitle:
                    searchIntent === 'commercial'
                        ? `Best ${keyword}: A Buyer's Guide for ${audience}`
                        : `${keyword} — The Complete Guide`,
                targetWordCount: 1500,
                searchIntent,
                outline,
                questionsToAnswer,
                relatedKeywords,
                metaDescription:
                    searchIntent === 'commercial'
                        ? `Compare the best ${keyword} options for ${audience}. See pricing, reviews, and top alternatives to pick the right one.`
                        : `Learn everything about ${keyword} in this complete guide for ${audience}. Best practices, tips, and tools to get started today.`,
                internalLinkIdeas: [
                    `Link the "What is ${keyword}?" section to a glossary or pillar page.`,
                    `Cross-link related how-to articles from "How to get started with ${keyword}".`,
                    `Add a contextual link to a product or comparison page near the CTA.`,
                ],
            };
        }

        return { error: `Unknown tool: ${toolName}` };
    },
};

export default seoSkill;
