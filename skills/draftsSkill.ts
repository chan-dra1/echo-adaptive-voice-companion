/**
 * draftsSkill.ts — "respond-type" skills.
 *
 * Echo drafts replies, emails, posts, messages, and bios on request, then
 * SAVES them so the user can grab them later (they're lazy to type — that's
 * the whole point). Pure-local + optional file export via the Hands daemon.
 *
 * Tools:
 *   - save_draft   persist a drafted piece of writing (encrypted at rest)
 *   - list_drafts  list saved drafts (titles, kind, when)
 *   - get_draft    retrieve a full draft by id
 *
 * Storage: cryptoService cached key 'echo_drafts' (AES-GCM encrypted like the
 * rest of the vault). When Echo Hands is connected, also writes a .md file to
 * ~/EchoProjects/drafts so it's grabbable from the file system.
 */

import { FunctionDeclaration, Type } from '@google/genai';
import { Skill } from '../services/agentSkillService';
import { getCached, setCached } from '../services/cryptoService';
import { handsCall, isHandsConnected } from '../services/handsBridgeService';

const KEY = 'echo_drafts';

interface Draft {
    id: string;
    kind: string;     // 'reply' | 'email' | 'post' | 'message' | 'bio' | ...
    title: string;
    content: string;
    createdAt: number;
}

function load(): Draft[] {
    try { return getCached<Draft[]>(KEY, []); } catch { return []; }
}
function save(list: Draft[]) {
    try { setCached(KEY, list.slice(-200)); } catch { /* vault locked */ }
}

const saveDraftDecl: FunctionDeclaration = {
    name: 'save_draft',
    description:
        'Save a piece of writing you drafted for the user (an email, a reply, a social post, a message, a bio, etc.) ' +
        'so they can grab it later. Call this AFTER you compose the text, whenever the user asks you to write/draft/reply ' +
        'to something. Pass the full final text.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            kind: { type: Type.STRING, description: "Type of writing: 'reply', 'email', 'post', 'message', 'bio', 'caption', 'other'." },
            title: { type: Type.STRING, description: 'Short label so the user can find it later.' },
            content: { type: Type.STRING, description: 'The full drafted text.' },
        },
        required: ['title', 'content'],
    },
};

const listDraftsDecl: FunctionDeclaration = {
    name: 'list_drafts',
    description: 'List the user\'s saved drafts (most recent first).',
    parameters: { type: Type.OBJECT, properties: {} },
};

const getDraftDecl: FunctionDeclaration = {
    name: 'get_draft',
    description: 'Retrieve the full text of a saved draft by its id (from list_drafts).',
    parameters: {
        type: Type.OBJECT,
        properties: { id: { type: Type.STRING, description: 'Draft id.' } },
        required: ['id'],
    },
};

export const draftsSkill: Skill = {
    name: 'draftsSkill',
    description: 'Draft and save replies, emails, posts, messages and bios for the user to grab later.',
    tools: [saveDraftDecl, listDraftsDecl, getDraftDecl],
    execute: async (toolName, args) => {
        try {
            switch (toolName) {
                case 'save_draft': {
                    const content = String(args?.content ?? '').trim();
                    if (!content) return { error: 'content is required.' };
                    const draft: Draft = {
                        id: `d_${Date.now().toString(36)}`,
                        kind: String(args?.kind || 'other'),
                        title: String(args?.title || 'Untitled draft').slice(0, 120),
                        content,
                        createdAt: Date.now(),
                    };
                    const list = load();
                    list.push(draft);
                    save(list);

                    let file: string | null = null;
                    if (isHandsConnected()) {
                        const slug = draft.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || draft.id;
                        try {
                            const res = await handsCall('write_file', {
                                path: `~/EchoProjects/drafts/${slug}-${draft.id}.md`,
                                content: `# ${draft.title}\n_(${draft.kind} · ${new Date(draft.createdAt).toLocaleString()})_\n\n${draft.content}\n`,
                            });
                            file = res?.path || null;
                        } catch { /* in-memory only */ }
                    }
                    return {
                        ok: true, id: draft.id, file,
                        note: file ? `Draft saved (also written to ${file}).` : 'Draft saved. Connect Echo Hands to also export drafts as files.',
                    };
                }
                case 'list_drafts': {
                    const list = load().slice().reverse();
                    return {
                        count: list.length,
                        drafts: list.map(d => ({ id: d.id, kind: d.kind, title: d.title, createdAt: d.createdAt, preview: d.content.slice(0, 100) })),
                    };
                }
                case 'get_draft': {
                    const d = load().find(x => x.id === args?.id);
                    return d ? { draft: d } : { error: `No draft with id ${args?.id}` };
                }
                default:
                    return { error: `Tool not found: ${toolName}` };
            }
        } catch (e: any) {
            return { error: e?.message || String(e) };
        }
    },
};

export default draftsSkill;
