import { FunctionDeclaration, Type } from '@google/genai';
import { Skill } from '../services/agentSkillService';
import { coreAdd, coreWriteFile, isCoreConnected } from '../services/echoCoreSync';

/**
 * contentSkill — the "content studio" for Echo. A Jasper/Copy.ai killer.
 *
 * IMPORTANT: these tools do NOT generate prose. Echo (Gemini) is the writer —
 * it produces the actual copy and then calls these tools to STRUCTURE, SAVE,
 * and EXPORT it. The brief/plan/calendar tools return repeatable scaffolds the
 * agent fills in; save_content persists agent-written copy to the dashboard and
 * optionally to a file on disk.
 */

function slugify(input: string): string {
    return String(input || 'untitled')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        || 'untitled';
}

function toISODate(d: Date): string {
    return d.toISOString().slice(0, 10);
}

const seoContentBriefDeclaration: FunctionDeclaration = {
    name: 'seo_content_brief',
    description:
        'Generate a structured SEO content brief (scaffold) for a target keyword that YOU then write against. ' +
        'This is a planning tool — it does NOT write the article. It returns a suggested title, recommended word ' +
        'count, a ~7-section H2 outline, a meta-description template, long-tail keyword variants, internal-linking ' +
        'tips, and CTA ideas. After you write the article from this brief, call save_content to persist it.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            keyword: {
                type: Type.STRING,
                description: 'The primary target keyword/topic to build the brief around (e.g. "email marketing").',
            },
            audience: {
                type: Type.STRING,
                description: 'Optional target audience for the content (e.g. "small business owners"). Defaults to "a general audience".',
            },
        },
        required: ['keyword'],
    },
};

const saveContentDeclaration: FunctionDeclaration = {
    name: 'save_content',
    description:
        'Persist a finished piece of content that YOU wrote. THIS is how content reaches the user — it saves the ' +
        'copy to the Mission Dashboard (Echo Core drafts) and, when export_to_file is true, also writes it as a ' +
        '.md file to the Desktop. Call this after writing an article, tweet, LinkedIn post, newsletter, Reddit post, ' +
        'etc. Pass the full written content in the `content` arg.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            title: {
                type: Type.STRING,
                description: 'A short title/headline for the piece. Used on the dashboard and to derive the filename.',
            },
            content: {
                type: Type.STRING,
                description: 'The full finished content you wrote (the actual prose to save).',
            },
            type: {
                type: Type.STRING,
                description: "Kind of content: 'article', 'tweet', 'linkedin', 'newsletter', 'reddit', etc. Defaults to 'article'.",
            },
            format: {
                type: Type.STRING,
                description: "Content format: 'markdown' or 'text'. Defaults to 'markdown'.",
            },
            export_to_file: {
                type: Type.BOOLEAN,
                description: 'When true, also write the content to a .md file on the Desktop (requires Echo Core connected).',
            },
            filename: {
                type: Type.STRING,
                description: 'Optional filename for the export (with or without .md). If omitted, the title is slugified.',
            },
        },
        required: ['title', 'content'],
    },
};

const repurposePlanDeclaration: FunctionDeclaration = {
    name: 'repurpose_plan',
    description:
        'Build a content-repurposing plan (scaffold) that turns one source topic into many platform-specific pieces. ' +
        'This does NOT write the pieces — it returns per-format guidance and recommended lengths telling YOU how to ' +
        'adapt the topic. Execute the plan by writing each piece, then call save_content for each one.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            source_topic: {
                type: Type.STRING,
                description: 'The source topic/idea to repurpose across formats (e.g. "how we cut churn by 30%").',
            },
            formats: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description:
                    "Target formats. Defaults to ['twitter_thread','linkedin_post','newsletter','instagram_caption','reddit_post','youtube_script'].",
            },
        },
        required: ['source_topic'],
    },
};

const contentCalendarDeclaration: FunctionDeclaration = {
    name: 'content_calendar',
    description:
        'Lay out a publishing calendar (scaffold) by distributing topics across dates. This does NOT write the content — ' +
        'it returns a dated schedule of planned topics that YOU can then write piece-by-piece (using save_content). ' +
        'Spreads topics one every `cadence_days` starting from `start_date` (or today).',
    parameters: {
        type: Type.OBJECT,
        properties: {
            topics: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'The list of topics to schedule, in the order they should be published.',
            },
            start_date: {
                type: Type.STRING,
                description: 'Optional first publish date as YYYY-MM-DD. Defaults to today.',
            },
            cadence_days: {
                type: Type.NUMBER,
                description: 'Days between each publish. Defaults to 3.',
            },
        },
        required: ['topics'],
    },
};

export const contentSkill: Skill = {
    name: 'contentSkill',
    description:
        'Content-creation studio (a Jasper/Copy.ai killer). YOU write the prose; these tools structure, save, and ' +
        'export it. Use seo_content_brief, repurpose_plan, and content_calendar to get repeatable scaffolds to fill ' +
        'in, and save_content to persist finished copy to the Mission Dashboard and (optionally) a file on disk.',
    tools: [
        seoContentBriefDeclaration,
        saveContentDeclaration,
        repurposePlanDeclaration,
        contentCalendarDeclaration,
    ],

    execute: async (toolName: string, args: any) => {
        if (toolName === 'seo_content_brief') {
            const keyword = String(args.keyword || '').trim();
            if (!keyword) {
                return { error: 'seo_content_brief requires a non-empty `keyword`.' };
            }
            const audience = String(args.audience || '').trim() || 'a general audience';

            const outline = [
                `What is ${keyword}?`,
                `Why ${keyword} matters`,
                `How to get started with ${keyword}`,
                `${keyword} best practices`,
                `Common ${keyword} mistakes to avoid`,
                `Tools & resources for ${keyword}`,
                `${keyword} FAQ`,
            ];

            const suggestedKeywords = [
                keyword,
                `${keyword} guide`,
                `${keyword} tips`,
                `best ${keyword} practices`,
                `how to ${keyword}`,
                `${keyword} for beginners`,
                `${keyword} examples`,
                `${keyword} tools`,
            ];

            return {
                keyword,
                audience,
                suggestedTitle: `${keyword} — The Complete Guide`,
                recommendedWordCount: 1500,
                outline,
                metaDescriptionTemplate: `Learn everything about ${keyword} in this complete guide for ${audience}. Discover best practices, tips, and tools to get started today.`,
                suggestedKeywords,
                internalLinkingTips: [
                    `Link the "What is ${keyword}?" section to any existing glossary or pillar page.`,
                    `Cross-link related how-to articles from the "How to get started with ${keyword}" section.`,
                    `Add a contextual link to a product or service page near the call-to-action.`,
                ],
                callToActionIdeas: [
                    `Try our ${keyword} tool free for 14 days.`,
                    `Download the ${keyword} checklist.`,
                    `Subscribe for more ${keyword} tips.`,
                ],
            };
        }

        if (toolName === 'save_content') {
            const title = String(args.title || '').trim() || 'Untitled';
            const content = String(args.content || '');
            if (!content.trim()) {
                return { error: 'save_content requires non-empty `content` (the written copy to save).' };
            }
            const type = String(args.type || 'article').trim() || 'article';
            const format = args.format === 'text' ? 'text' : 'markdown';

            // Always push to the dashboard (no-op if Core offline).
            coreAdd('drafts', { kind: type, title, content, source: 'content-studio' });

            let file: string | null = null;
            let note: string | undefined;

            if (args.export_to_file) {
                const rawName = String(args.filename || '').trim();
                const base = rawName ? rawName.replace(/\.md$/i, '') : slugify(title);
                const filename = `${base || slugify(title)}.md`;
                const path = `~/Desktop/${filename}`;
                try {
                    const res = await coreWriteFile(path, content);
                    if (res && res.error) {
                        note = `File export failed: ${res.error}`;
                    } else {
                        file = res?.path || path;
                    }
                } catch (err: any) {
                    note = `File export failed: ${err?.message || 'Echo Core not available'}`;
                }
            }

            const savedToDashboard = isCoreConnected();
            const parts = [
                savedToDashboard
                    ? `Saved "${title}" to the Mission Dashboard.`
                    : `Queued "${title}" (Echo Core offline — it will not appear on the dashboard until reconnected).`,
            ];
            if (file) parts.push(`Exported to ${file}.`);
            if (note) parts.push(note);

            return {
                success: true,
                savedToDashboard,
                file,
                note,
                message: parts.join(' '),
            };
        }

        if (toolName === 'repurpose_plan') {
            const sourceTopic = String(args.source_topic || '').trim();
            if (!sourceTopic) {
                return { error: 'repurpose_plan requires a non-empty `source_topic`.' };
            }
            const requested: string[] = Array.isArray(args.formats) && args.formats.length
                ? args.formats.map((f: any) => String(f))
                : ['twitter_thread', 'linkedin_post', 'newsletter', 'instagram_caption', 'reddit_post', 'youtube_script'];

            const GUIDANCE: Record<string, { guidance: string; recommendedLength: string }> = {
                twitter_thread: {
                    guidance: '5-8 punchy tweets. Lead with a scroll-stopping hook, one idea per tweet, keep it skimmable, end with a CTA.',
                    recommendedLength: '5-8 tweets, <280 chars each',
                },
                linkedin_post: {
                    guidance: 'Open with a bold first line, short line-broken paragraphs, a personal angle or insight, finish with a question to drive comments.',
                    recommendedLength: '150-300 words',
                },
                newsletter: {
                    guidance: 'Warm intro, one core takeaway expanded with a story or example, a few scannable bullets, then a clear next step.',
                    recommendedLength: '300-600 words',
                },
                instagram_caption: {
                    guidance: 'Hook in the first line (before the "more" cutoff), conversational tone, light emoji, a CTA, and 5-10 relevant hashtags.',
                    recommendedLength: '50-150 words + hashtags',
                },
                reddit_post: {
                    guidance: 'Authentic, non-salesy, value-first. Tell it like a real experience, invite discussion, follow subreddit etiquette — no overt promotion.',
                    recommendedLength: '200-500 words',
                },
                youtube_script: {
                    guidance: 'Hook in the first 10 seconds, intro the value, deliver in clear segments with verbal signposts, end with a subscribe/CTA outro.',
                    recommendedLength: '600-1200 words (~5-8 min)',
                },
            };

            const pieces = requested.map((format) => {
                const g = GUIDANCE[format];
                return {
                    format,
                    guidance: g
                        ? g.guidance
                        : `Adapt "${sourceTopic}" to the ${format} format: match the platform's tone, length, and audience expectations, and end with a fitting call-to-action.`,
                    recommendedLength: g ? g.recommendedLength : 'platform-appropriate',
                };
            });

            return { source_topic: sourceTopic, pieces };
        }

        if (toolName === 'content_calendar') {
            const topics: string[] = Array.isArray(args.topics) ? args.topics.map((t: any) => String(t)) : [];
            if (!topics.length) {
                return { error: 'content_calendar requires a non-empty `topics` array.' };
            }
            const cadence = Number(args.cadence_days) > 0 ? Math.floor(Number(args.cadence_days)) : 3;

            let start = new Date();
            if (args.start_date) {
                const parsed = new Date(String(args.start_date));
                if (!isNaN(parsed.getTime())) start = parsed;
            }

            const calendar = topics.map((topic, i) => {
                const d = new Date(start.getTime());
                d.setDate(d.getDate() + i * cadence);
                return { date: toISODate(d), topic, status: 'planned' as const };
            });

            return { calendar, count: calendar.length };
        }

        return { error: `Unknown tool: ${toolName}` };
    },
};

export default contentSkill;
