import { FunctionDeclaration, Type } from '@google/genai';
import { Skill } from '../services/agentSkillService';
import { coreAdd, coreWriteFile, isCoreConnected } from '../services/echoCoreSync';

/**
 * meetingSkill — Meeting Copilot (Tier 2). The "Otter / Fireflies killer".
 *
 * Echo (the LLM) listens to or reads a meeting transcript, then calls these
 * tools to STRUCTURE and PERSIST the outcome: a clean notes doc saved to the
 * dashboard, action items turned into real tasks, and an optional exported
 * markdown file. The summarization itself is done by the agent; these tools
 * handle the scaffolding + persistence (same pattern as contentSkill).
 */

const TASKS_KEY = 'echo_meeting_tasks';

function slugify(s: string): string {
    return (s || 'meeting').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'meeting';
}

const saveNotesDeclaration: FunctionDeclaration = {
    name: 'save_meeting_notes',
    description:
        'Save structured meeting notes produced by Echo from a transcript or live discussion. Persists a clean notes document to the dashboard, turns each action item into a tracked task, and can export a markdown file. Call this after you (the agent) have summarized the meeting. This is the Otter/Fireflies killer.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            title: { type: Type.STRING, description: 'Meeting title (e.g. "Q3 Planning — 2026-06-26").' },
            summary: { type: Type.STRING, description: 'A concise prose summary of what was discussed and decided.' },
            action_items: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Action items. Prefix with an owner if known, e.g. "Alex: send the deck by Friday".' },
            decisions: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Key decisions made.' },
            participants: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Attendee names (optional).' },
            transcript: { type: Type.STRING, description: 'Full raw transcript to archive (optional).' },
            export_to_file: { type: Type.BOOLEAN, description: 'Also write a markdown file to ~/Desktop (default false).' },
        },
        required: ['title', 'summary'],
    },
};

const templateDeclaration: FunctionDeclaration = {
    name: 'meeting_template',
    description:
        'Return a structured note-taking template for a given meeting type (standup, 1:1, planning, retro, client call, interview). Use it to organize notes before or during a meeting; fill the sections, then call save_meeting_notes.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            meeting_type: { type: Type.STRING, description: 'standup | one_on_one | planning | retro | client_call | interview | general' },
        },
    },
};

const listActionsDeclaration: FunctionDeclaration = {
    name: 'list_meeting_action_items',
    description: 'List the open action items captured from past meetings (the local task log).',
    parameters: { type: Type.OBJECT, properties: {} },
};

const TEMPLATES: Record<string, string[]> = {
    standup: ['Yesterday', 'Today', 'Blockers'],
    one_on_one: ['Wins since last time', 'Challenges', 'Feedback (both ways)', 'Career / growth', 'Action items'],
    planning: ['Goals for the period', 'Scope / priorities', 'Owners', 'Risks', 'Timeline', 'Action items'],
    retro: ['What went well', 'What didn’t', 'What to try next', 'Action items'],
    client_call: ['Attendees', 'Client goals', 'Discussion', 'Commitments made', 'Next steps', 'Follow-up date'],
    interview: ['Candidate', 'Role', 'Strengths', 'Concerns', 'Technical signal', 'Recommendation'],
    general: ['Agenda', 'Discussion', 'Decisions', 'Action items', 'Next steps'],
};

function buildMarkdown(args: any): string {
    const lines = [`# ${args.title}`, ''];
    if (Array.isArray(args.participants) && args.participants.length) lines.push(`**Participants:** ${args.participants.join(', ')}`, '');
    lines.push('## Summary', args.summary || '', '');
    if (Array.isArray(args.decisions) && args.decisions.length) {
        lines.push('## Decisions');
        args.decisions.forEach((d: string) => lines.push(`- ${d}`));
        lines.push('');
    }
    if (Array.isArray(args.action_items) && args.action_items.length) {
        lines.push('## Action Items');
        args.action_items.forEach((a: string) => lines.push(`- [ ] ${a}`));
        lines.push('');
    }
    if (args.transcript) lines.push('## Transcript', '', args.transcript);
    return lines.join('\n');
}

export const meetingSkill: Skill = {
    name: 'meetingSkill',
    description: 'Meeting Copilot — turn a transcript or live discussion into clean notes, tracked action items, and an exportable doc. Replaces Otter/Fireflies.',
    tools: [saveNotesDeclaration, templateDeclaration, listActionsDeclaration],

    execute: async (toolName: string, args: any) => {
        if (toolName === 'meeting_template') {
            const type = String(args.meeting_type || 'general').toLowerCase();
            const sections = TEMPLATES[type] || TEMPLATES.general;
            return { meeting_type: type, sections, hint: 'Fill each section, then call save_meeting_notes with summary + action_items + decisions.' };
        }

        if (toolName === 'list_meeting_action_items') {
            try {
                const items = JSON.parse(localStorage.getItem(TASKS_KEY) || '[]');
                return { actionItems: items, count: items.length };
            } catch { return { actionItems: [], count: 0 }; }
        }

        if (toolName === 'save_meeting_notes') {
            if (!args.title || !args.summary) return { error: 'save_meeting_notes needs at least title and summary.' };
            const md = buildMarkdown(args);
            const actionItems: string[] = Array.isArray(args.action_items) ? args.action_items : [];

            // 1) Save the notes doc to the dashboard (Core drafts) — no-op if offline.
            try { coreAdd('drafts', { kind: 'meeting', title: String(args.title), content: md, source: 'meeting-copilot' }); } catch { /* offline */ }

            // 2) Turn action items into tracked tasks — Core 'tasks' collection + local log.
            for (const text of actionItems) {
                try { coreAdd('tasks', { text, done: false, source: 'meeting', meeting: String(args.title) }); } catch { /* offline */ }
            }
            try {
                const existing = JSON.parse(localStorage.getItem(TASKS_KEY) || '[]');
                const stamped = actionItems.map(text => ({ text, meeting: String(args.title), done: false }));
                localStorage.setItem(TASKS_KEY, JSON.stringify([...existing, ...stamped]));
            } catch { /* quota */ }

            // 3) Optional file export via Core.
            let file: string | null = null;
            if (args.export_to_file) {
                try {
                    const r = await coreWriteFile(`~/Desktop/${slugify(args.title)}.md`, md);
                    file = r?.path || null;
                } catch { file = null; }
            }

            return {
                success: true,
                savedToDashboard: isCoreConnected(),
                actionItemsTracked: actionItems.length,
                file,
                message: `Meeting "${args.title}" saved${actionItems.length ? ` with ${actionItems.length} action item(s) as tasks` : ''}${file ? ` and exported to ${file}` : ''}.`,
            };
        }

        return { error: `Unknown tool: ${toolName}` };
    },
};

export default meetingSkill;
