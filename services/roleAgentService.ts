/**
 * Named specialist roles for background work.
 *
 * Chat remains the strategist (short hop budget). Slow work is assigned to
 * one of four roles with a locked tool list — cheaper and safer than handing
 * a sub-agent the full skill registry.
 *
 * Overnight Echo Core jobs write the same receipt shape so the companion
 * briefing can show "what happened" instead of only a quote.
 */

import { FunctionDeclaration } from '@google/genai';
import { getCached, setCached } from './cryptoService';
import { coreAdd, getCoreSnapshot, isCoreConnected } from './echoCoreSync';
import { notify } from './notificationService';

export const ROLE_IDS = ['researcher', 'operator', 'outreach', 'companion'] as const;
export type RoleId = (typeof ROLE_IDS)[number];

export const ROLE_HOP_CAP = 12;

const RECEIPTS_KEY = 'echo_night_receipts';
const MAX_RECEIPTS = 80;

export interface RoleDef {
    id: RoleId;
    label: string;
    tools: readonly string[];
    prompt: string;
}

export interface WorkReceipt {
    id: string;
    role: RoleId;
    title: string;
    summary: string;
    source: 'chat' | 'core';
    status: 'done' | 'failed';
    createdAt: number;
}

export const ROLES: Record<RoleId, RoleDef> = {
    researcher: {
        id: 'researcher',
        label: 'Researcher',
        tools: ['search_web', 'read_webpage', 'browse_website', 'map_website', 'screenshot_page'],
        prompt:
            'You are Echo\'s Researcher. Search and read the web. Do not send email, ' +
            'post socially, or touch the filesystem. Return a short sourced brief.',
    },
    operator: {
        id: 'operator',
        label: 'Operator',
        tools: [
            'run_terminal_command', 'read_file', 'write_file', 'edit_file', 'list_directory',
            'list_github_repos', 'get_github_issue', 'search_github_code',
        ],
        prompt:
            'You are Echo\'s Operator. Files, shell, and GitHub only. No outbound mail or ' +
            'social posts. Prefer the smallest change that finishes the task. Report paths and commands used.',
    },
    outreach: {
        id: 'outreach',
        label: 'Outreach',
        tools: [
            'send_email', 'post_to_social', 'post_tweet', 'send_discord_message',
            'create_outreach_campaign', 'send_outreach_campaign', 'list_outreach_campaigns',
            'find_leads', 'schedule_social_post', 'list_social_accounts',
            'save_draft', 'list_drafts', 'get_draft',
        ],
        prompt:
            'You are Echo\'s Outreach agent. Draft and send only what the task explicitly ' +
            'authorizes. If sending is not clearly requested, save a draft instead. Report what was sent vs drafted.',
    },
    companion: {
        id: 'companion',
        label: 'Companion',
        tools: [
            'set_reminder', 'add_task', 'update_task', 'complete_task', 'list_tasks',
            'get_task_action_plan', 'request_task_research', 'search_knowledge_base',
            'list_documents',
        ],
        prompt:
            'You are Echo\'s Companion. Habits, tasks, reminders, and memory — not code, ' +
            'not outreach. Be concrete. Finish with what changed for the user today.',
    },
};

export function isRoleId(value: unknown): value is RoleId {
    return typeof value === 'string' && (ROLE_IDS as readonly string[]).includes(value);
}

export function filterToolsForRole(all: FunctionDeclaration[], role: RoleId): FunctionDeclaration[] {
    const allow = new Set(ROLES[role].tools);
    return all.filter(t => t?.name && allow.has(t.name));
}

export function roleAllowsTool(role: RoleId, toolName: string): boolean {
    return (ROLES[role].tools as readonly string[]).includes(toolName);
}

export function buildRoleSystemPrompt(role: RoleId): string {
    return (
        ROLES[role].prompt +
        ' Complete the assigned task autonomously. The user only sees your final message — ' +
        'make it self-contained. Do not claim you used a tool you do not have.'
    );
}

/** Injected into the main chat system prompt so the strategist delegates by role. */
export function buildRoleCrewInstruction(): string {
    return (
        `[ROLE CREW]\n` +
        `You are the strategist. For slow or multi-step work, call spawn_sub_agent WITH a role:\n` +
        `- researcher — web search and reading\n` +
        `- operator — files, shell, GitHub\n` +
        `- outreach — email, social, drafts, campaigns\n` +
        `- companion — tasks, reminders, knowledge\n` +
        `Do not spawn an unscoped sub-agent when a role fits. Tell the user which role you assigned. ` +
        `Do not wait for it — results land in the Companion briefing as overnight/work receipts.`
    );
}

export function overnightCutoff(now = Date.now()): number {
    const d = new Date(now);
    // "Overnight" = since 18:00 local yesterday (or 18:00 today if it's after 6pm).
    const six = new Date(d);
    six.setHours(18, 0, 0, 0);
    if (d.getHours() < 18) six.setDate(six.getDate() - 1);
    return six.getTime();
}

export function loadReceipts(): WorkReceipt[] {
    const raw = getCached<WorkReceipt[]>(RECEIPTS_KEY, []);
    return Array.isArray(raw) ? raw : [];
}

function persistReceipts(list: WorkReceipt[]): void {
    setCached(RECEIPTS_KEY, list.slice(0, MAX_RECEIPTS));
}

export function recordReceipt(partial: Omit<WorkReceipt, 'id' | 'createdAt'> & { id?: string; createdAt?: number }): WorkReceipt {
    const receipt: WorkReceipt = {
        id: partial.id || `rc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        createdAt: partial.createdAt || Date.now(),
        role: partial.role,
        title: partial.title.slice(0, 120),
        summary: partial.summary.slice(0, 800),
        source: partial.source,
        status: partial.status,
    };
    const next = [receipt, ...loadReceipts().filter(r => r.id !== receipt.id)].slice(0, MAX_RECEIPTS);
    persistReceipts(next);
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('echo:receipt:added', { detail: { receipt } }));
        // Notify here (not just from CompanionPanel's listener) so this
        // fires even if the panel isn't open/mounted — background work
        // finishing is exactly the case where the user isn't looking at it.
        void notify({ title: `${ROLES[receipt.role].label} finished`, body: receipt.title });
    }
    if (receipt.source === 'chat' && isCoreConnected()) {
        try { coreAdd('receipts', receipt); } catch { /* Core may be an older build */ }
    }
    return receipt;
}

/** Vault receipts plus any Core receipts the dashboard already synced. */
export function getOvernightReceipts(now = Date.now()): WorkReceipt[] {
    const cutoff = overnightCutoff(now);
    const fromVault = loadReceipts().filter(r => r.createdAt >= cutoff);
    const fromCore = ((getCoreSnapshot().receipts || []) as WorkReceipt[])
        .filter(r => r && r.createdAt >= cutoff && isRoleId(r.role));
    const seen = new Set<string>();
    const merged: WorkReceipt[] = [];
    for (const r of [...fromVault, ...fromCore].sort((a, b) => b.createdAt - a.createdAt)) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        merged.push(r);
    }
    return merged.slice(0, 12);
}
