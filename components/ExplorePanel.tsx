/**
 * ExplorePanel.tsx
 *
 * "What can Echo do?" — a plain-language, browsable map of every built-in
 * capability, grouped into categories a non-technical user recognizes.
 * Visible in both Simple and Advanced mode (the single biggest gap found in
 * the pre-launch UX audit: nothing else in the app explains what Echo can
 * actually do). Tool counts per category are read live from
 * agentSkillService.getTools() so they never drift from what's really
 * registered; the category groupings and example prompts themselves are a
 * curated, hand-written layer on top since raw tool names ("browser_click",
 * "list_page_elements") aren't something a new user should ever see.
 */

import React, { useMemo, useState } from 'react';
import {
    X, Search, ListChecks, Mail, Briefcase, Megaphone, PenLine, Globe,
    FolderCog, Calculator, Image as ImageIcon, LifeBuoy, ArrowUpRight,
} from 'lucide-react';
import { agentSkillService } from '../services/agentSkillService';

interface ExplorePanelProps {
    onClose: () => void;
    onTryPrompt: (text: string) => void;
}

interface Category {
    key: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    title: string;
    blurb: string;
    examples: string[];
    /** Tool names this category covers, used only to compute a live count. */
    toolNames: string[];
}

const CATEGORIES: Category[] = [
    {
        key: 'tasks',
        icon: ListChecks,
        title: 'Get things done',
        blurb: 'Track tasks, plan your day, and set up things that run automatically in the background.',
        examples: [
            'Add a task to finish the client proposal by Friday',
            "What should I work on today?",
            'Post my Instagram caption every Monday at 9am, automatically',
        ],
        toolNames: [
            'add_task', 'update_task', 'complete_task', 'delete_task', 'list_tasks',
            'set_task_aggressiveness', 'get_task_action_plan', 'request_task_research',
            'ingest_project_context', 'generate_execution_plan', 'generate_daily_schedule',
            'list_projects', 'update_project_status', 'create_automation', 'list_automations',
            'toggle_automation', 'delete_automation', 'run_automation_now', 'run_mission',
        ],
    },
    {
        key: 'meetings',
        icon: Mail,
        title: 'Meetings & email',
        blurb: 'Join calls and take notes, triage a full inbox, and draft replies for you to approve.',
        examples: [
            'Join this call and take notes',
            'Summarize my last 10 unread emails',
            'Draft a reply to this email for me to review',
        ],
        toolNames: [
            'save_meeting_notes', 'meeting_template', 'list_meeting_action_items',
            'triage_emails', 'draft_reply', 'send_reply', 'summarize_thread',
        ],
    },
    {
        key: 'career',
        icon: Briefcase,
        title: 'Career & job hunt',
        blurb: 'Tailor your resume to a listing, track applications, prep for interviews, and generate a private AI headshot from your camera (Power Tools → Headshot Studio).',
        examples: [
            'Find remote product manager jobs',
            'Tailor my resume for this job posting',
            'Prep me for a behavioral interview',
        ],
        toolNames: [
            'get_base_resume', 'tailor_resume', 'evaluate_ats_score', 'search_jobs',
            'score_job_fit', 'tailor_resume_for_job', 'run_job_apply_pipeline',
            'list_saved_jobs', 'mark_job_applied', 'save_cover_letter', 'track_application',
            'update_application_status', 'list_applications', 'interview_prep',
        ],
    },
    {
        key: 'social',
        icon: Megaphone,
        title: 'Social media & outreach',
        blurb: 'Post to multiple platforms at once, run cold-email campaigns, and find leads.',
        examples: [
            'Post this update to Twitter and LinkedIn',
            'Write a cold outreach campaign for local dentists',
            'Find leads for my SaaS product',
        ],
        toolNames: [
            'post_to_social', 'save_social_credentials', 'list_social_accounts',
            'schedule_social_post', 'post_tweet', 'save_twitter_credentials',
            'get_twitter_profile', 'send_discord_message', 'set_discord_webhook',
            'send_email', 'save_resend_key', 'create_outreach_campaign',
            'send_outreach_campaign', 'list_outreach_campaigns', 'find_leads', 'save_lead',
            'validate_email', 'enrich_company', 'check_domain',
        ],
    },
    {
        key: 'content',
        icon: PenLine,
        title: 'Content & marketing',
        blurb: 'Plan content calendars, get SEO ideas, and turn one piece into many.',
        examples: [
            "Give me an SEO content brief for 'home coffee roasting'",
            'Plan a 2-week content calendar for my newsletter',
            'Repurpose this article into 5 social posts',
        ],
        toolNames: [
            'generate_marketing_plan', 'seo_content_brief', 'save_content', 'repurpose_plan',
            'content_calendar', 'keyword_ideas', 'serp_snapshot', 'content_brief',
        ],
    },
    {
        key: 'research',
        icon: Globe,
        title: 'Research & the web',
        blurb: 'Search the web, read articles, and summarize videos — with sources.',
        examples: [
            "What's the latest news on the Fed rate decision?",
            'Summarize this YouTube video',
            'Read this article and give me the key points',
        ],
        toolNames: [
            'search_web', 'read_webpage', 'browse_website', 'map_website', 'screenshot_page',
            'browser_navigate', 'browser_read_page', 'browser_screenshot', 'browser_click',
            'browser_fill', 'search_knowledge_base', 'list_documents', 'extract_video_metadata',
            'summarize_media', 'describe_current_screen',
        ],
    },
    {
        key: 'files',
        icon: FolderCog,
        title: 'Files & your computer',
        blurb: 'Read and write files, generate documents, and run commands — with your permission.',
        examples: [
            'List the files in my Downloads folder',
            'Create a PDF report from this data',
            'Find every mention of "invoice" in my project files',
        ],
        toolNames: [
            'list_files', 'read_file', 'write_file', 'edit_file', 'list_directory',
            'run_terminal_command', 'generate_file', 'list_github_repos', 'get_github_issue',
            'search_github_code',
        ],
    },
    {
        key: 'math',
        icon: Calculator,
        title: 'Money & math',
        blurb: 'Quick calculations, unit conversions, and betting-odds math — instantly, no spreadsheet.',
        examples: [
            "What's 15% of $284?",
            'Convert 5 miles to kilometers',
            "What's the expected value of a $50 bet at +150 odds?",
        ],
        toolNames: [
            'calc', 'convert_units', 'stats', 'parse_and_compute', 'convert_odds',
            'implied_probability', 'remove_vig', 'arbitrage_check', 'kelly_fraction',
            'expected_value', 'hedge_calc',
        ],
    },
    {
        key: 'creative',
        icon: ImageIcon,
        title: 'Images & storefront',
        blurb: 'Generate images from a description using your existing Gemini key — no extra setup — and build a simple page to sell your work.',
        examples: [
            'Generate an image of a cozy coffee shop logo',
            'Build me a storefront page for my digital products',
        ],
        toolNames: [
            'save_image_api_key', 'generate_image', 'list_image_providers', 'save_storefront',
            'generate_storefront_html', 'preview_storefront',
        ],
    },
    {
        key: 'support',
        icon: LifeBuoy,
        title: 'Customer support',
        blurb: 'Build a support knowledge base and answer customer questions automatically.',
        examples: [
            'Add this Q&A to my support knowledge base',
            'Export a FAQ widget I can paste into my website',
        ],
        toolNames: [
            'save_support_kb', 'answer_support_question', 'list_support_kb',
            'export_support_widget',
        ],
    },
];

export default function ExplorePanel({ onClose, onTryPrompt }: ExplorePanelProps) {
    const [query, setQuery] = useState('');

    const liveToolNames = useMemo(() => {
        try {
            return new Set(agentSkillService.getTools().map(t => t.name));
        } catch {
            return new Set<string>();
        }
    }, []);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return CATEGORIES;
        return CATEGORIES
            .map(c => ({
                ...c,
                examples: c.examples.filter(e => e.toLowerCase().includes(q)),
            }))
            .filter(c =>
                c.title.toLowerCase().includes(q) ||
                c.blurb.toLowerCase().includes(q) ||
                c.examples.length > 0,
            )
            .map(c => (c.examples.length > 0 ? c : { ...c, examples: CATEGORIES.find(o => o.key === c.key)!.examples }));
    }, [query]);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-black/80 backdrop-blur-xl transition-opacity" onClick={onClose} />

            <div className="relative w-full max-w-2xl term-window animate-phosphor-in max-h-[90dvh] flex flex-col">
                <div className="term-titlebar justify-between shrink-0 relative z-10">
                    <div className="flex items-center gap-3 min-w-0">
                        <span className="term-dots" />
                        <span className="truncate">What Echo can do</span>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Close explore panel"
                        className="p-1.5 rounded border border-[var(--border-dim)] bg-[rgba(0,255,65,0.04)] text-[var(--text-tertiary)] hover:text-[var(--accent-green)] hover:border-[var(--border-green)] transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className="relative z-10 p-4 pb-0 shrink-0">
                    <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                        <input
                            type="text"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Search what Echo can help with…"
                            className="w-full pl-9 pr-3 py-2 rounded-lg text-sm bg-[rgba(0,255,65,0.03)] border border-[var(--border-dim)] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none focus:border-[var(--border-green)] transition-colors"
                        />
                    </div>
                </div>

                <div className="relative z-10 overflow-y-auto scrollbar-hide p-4 space-y-3">
                    {filtered.length === 0 && (
                        <p className="text-sm text-[var(--text-tertiary)] text-center py-8">
                            No matches — try a different word, or just ask Echo directly.
                        </p>
                    )}
                    {filtered.map(cat => {
                        const Icon = cat.icon;
                        const count = cat.toolNames.filter(n => liveToolNames.has(n)).length;
                        return (
                            <div
                                key={cat.key}
                                className="rounded-lg border border-[var(--border-dim)] bg-[rgba(0,255,65,0.02)] p-3.5"
                            >
                                <div className="flex items-start gap-3">
                                    <div className="mt-0.5 shrink-0 w-8 h-8 rounded-md flex items-center justify-center bg-[rgba(0,255,65,0.06)] border border-[var(--border-dim)]">
                                        <Icon size={16} className="text-[var(--accent-green)]" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between gap-2">
                                            <h3 className="text-sm font-medium text-[var(--text-primary)]">{cat.title}</h3>
                                            {count > 0 && (
                                                <span className="shrink-0 text-[10px] font-mono text-[var(--text-tertiary)]">
                                                    {count} {count === 1 ? 'tool' : 'tools'}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-[var(--text-secondary)] mt-0.5 leading-relaxed">
                                            {cat.blurb}
                                        </p>
                                        <div className="mt-2.5 flex flex-col gap-1.5">
                                            {cat.examples.map((ex, i) => (
                                                <button
                                                    key={i}
                                                    onClick={() => { onTryPrompt(ex); onClose(); }}
                                                    className="group flex items-center gap-1.5 text-left text-xs text-[var(--text-secondary)] hover:text-[var(--accent-green)] transition-colors"
                                                >
                                                    <span className="truncate">"{ex}"</span>
                                                    <ArrowUpRight size={11} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
