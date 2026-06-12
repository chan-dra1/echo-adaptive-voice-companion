/**
 * featureTicketService.ts — Echo's self-improvement loop.
 *
 * When the user asks for something beyond what a runtime skill can do
 * (needs core app changes — new UI, new service, native capability),
 * Echo drafts a feature ticket. Tickets are always stored locally
 * (encrypted); if the Hands daemon is connected, Echo also offers to
 * file it as a GitHub issue on the Echo repo via `gh issue create`
 * — after the user confirms.
 *
 * The dev (or Claude Code) then implements the good ones, ships a PWA
 * update, and every device picks it up: Echo proposes → user approves →
 * the app evolves.
 */

import type { FunctionDeclaration } from '@google/genai';
import { Type } from '@google/genai';
import { getCached, setCached } from './cryptoService';
import { handsCall, isHandsConnected } from './handsBridgeService';

const TICKETS_KEY = 'echo_feature_tickets';
const REPO_PATH_KEY = 'echo_repo_path';

export interface FeatureTicket {
    id: string;
    title: string;
    userAsk: string;        // what the user literally asked for
    whyItFailed: string;    // why current tools couldn't do it
    proposal: string;       // Echo's sketch of how the feature could work
    createdAt: number;
    filed: boolean;         // whether a GitHub issue was created
    issueUrl?: string;
}

export function getTickets(): FeatureTicket[] {
    return getCached<FeatureTicket[]>(TICKETS_KEY, []);
}

function saveTickets(tickets: FeatureTicket[]): void {
    setCached(TICKETS_KEY, tickets);
}

export function getRepoPath(): string {
    return localStorage.getItem(REPO_PATH_KEY) || '~/Desktop/echo---adaptive-voice-companion';
}

export const TICKET_TOOLS: FunctionDeclaration[] = [
    {
        name: 'raise_feature_ticket',
        description: 'File a feature ticket when the user asks for something that needs CORE APP changes — beyond what propose_new_skill (sandboxed JS) or hands tools can do (e.g. new UI panels, native mobile capabilities, new integrations needing app code). First tell the user you cannot do it yet but will log it for the next Echo update, then call this. Do NOT use for things a dynamic skill could solve — try propose_new_skill first.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                title: { type: Type.STRING, description: 'Short imperative title, e.g. "Add calendar two-way sync".' },
                userAsk: { type: Type.STRING, description: 'What the user asked for, near-verbatim.' },
                whyItFailed: { type: Type.STRING, description: 'Why existing tools/skills cannot do this.' },
                proposal: { type: Type.STRING, description: 'Your sketch of how the feature could be implemented in the Echo codebase.' },
            },
            required: ['title', 'userAsk', 'whyItFailed', 'proposal'],
        },
    },
    {
        name: 'list_feature_tickets',
        description: 'List feature tickets Echo has raised so far (to discuss status or avoid duplicates).',
        parameters: { type: Type.OBJECT, properties: {} },
    },
];

export function isTicketTool(name: string): boolean {
    return name === 'raise_feature_ticket' || name === 'list_feature_tickets';
}

export async function executeTicketTool(name: string, args: Record<string, any>): Promise<{ result?: any; error?: string }> {
    try {
        if (name === 'list_feature_tickets') {
            const tickets = getTickets();
            return {
                result: tickets.length
                    ? tickets.map(t => ({ title: t.title, createdAt: new Date(t.createdAt).toISOString().slice(0, 10), filed: t.filed, issueUrl: t.issueUrl }))
                    : { note: 'No feature tickets yet.' },
            };
        }

        if (name === 'raise_feature_ticket') {
            const tickets = getTickets();
            // Dedupe on near-identical titles
            const dup = tickets.find(t => t.title.toLowerCase().trim() === String(args.title).toLowerCase().trim());
            if (dup) {
                return { result: { saved: false, note: `A ticket with this title already exists (${dup.filed ? 'filed: ' + dup.issueUrl : 'stored locally'}). Tell the user it is already on the list.` } };
            }

            const ticket: FeatureTicket = {
                id: crypto.randomUUID(),
                title: String(args.title),
                userAsk: String(args.userAsk),
                whyItFailed: String(args.whyItFailed),
                proposal: String(args.proposal),
                createdAt: Date.now(),
                filed: false,
            };

            // Try to file on GitHub through Hands (with user confirmation)
            if (isHandsConnected()) {
                const ok = window.confirm(`Echo wants to file a GitHub issue on the Echo repo:\n\n"${ticket.title}"\n\nAllow?`);
                if (ok) {
                    const body = [
                        `**User asked:** ${ticket.userAsk}`,
                        ``,
                        `**Why Echo couldn't do it:** ${ticket.whyItFailed}`,
                        ``,
                        `**Echo's proposal:**`,
                        ticket.proposal,
                        ``,
                        `---`,
                        `_Auto-raised by Echo's feature ticket pipeline on ${new Date().toISOString().slice(0, 10)}._`,
                    ].join('\n');
                    const esc = (s: string) => s.replace(/'/g, `'\\''`);
                    const out = await handsCall('run_command', {
                        command: `cd ${getRepoPath()} && gh issue create --title '${esc(ticket.title)}' --body '${esc(body)}' --label enhancement 2>&1 || gh issue create --title '${esc(ticket.title)}' --body '${esc(body)}' 2>&1`,
                    });
                    const url = String(out.stdout || '').match(/https:\/\/github\.com\/\S+\/issues\/\d+/)?.[0];
                    if (url) {
                        ticket.filed = true;
                        ticket.issueUrl = url;
                    }
                }
            }

            tickets.push(ticket);
            saveTickets(tickets);
            window.dispatchEvent(new CustomEvent('ticket:raised', { detail: ticket }));

            return {
                result: {
                    saved: true,
                    filed: ticket.filed,
                    issueUrl: ticket.issueUrl || null,
                    note: ticket.filed
                        ? `Ticket filed on GitHub: ${ticket.issueUrl}. Tell the user it will land in a future Echo update.`
                        : 'Ticket stored locally. It will be filed to GitHub next time the Hands daemon is connected, or reviewed manually. Tell the user it is logged.',
                },
            };
        }

        return { error: `Unknown ticket tool: ${name}` };
    } catch (e: any) {
        return { error: e?.message || 'Ticket tool failed' };
    }
}
