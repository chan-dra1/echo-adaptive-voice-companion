import { FunctionDeclaration, Type } from '@google/genai';
import { Skill } from '../services/agentSkillService';
import { coreAdd, isCoreConnected } from '../services/echoCoreSync';

/**
 * inboxSkill — the "Inbox Agent" for Echo. An Intercom/Superhuman-style email
 * assistant that triages an inbox, drafts replies, summarizes threads, and
 * (when possible) sends.
 *
 * IMPORTANT: these tools have NO direct LLM access. Echo (Gemini) is the writer
 * and reader — it produces the prose (reply bodies, thread summaries) and calls
 * these tools to STRUCTURE, PERSIST, and SEND. triage_emails is a pure scoring
 * function; draft_reply / summarize_thread persist agent-written text to the
 * Mission Dashboard (Echo Core drafts); send_reply ships email via Resend.
 */

const RESEND_KEY = 'echo_resend_key';

// Keyword buckets used by the pure triage scorer.
const HIGH_KEYWORDS = [
    'urgent', 'asap', 'immediately', 'invoice', 'payment', 'overdue', 'deadline',
    'action required', 'action needed', 'meeting', 'interview', 'contract', 'signature',
    'sign', 'expires', 'final notice', 'past due', 'security', 'reset your password',
    'time-sensitive', 'time sensitive', 'reply needed', 'response needed', 'please respond',
];

const LOW_KEYWORDS = [
    'newsletter', 'unsubscribe', 'promotion', 'promo', 'sale', 'discount', 'coupon',
    'deal', 'offer', 'digest', 'no-reply', 'noreply', 'do not reply', 'webinar',
    'marketing', 'survey', 'social', 'notification', 'weekly update', '% off',
];

const triageEmailsDeclaration: FunctionDeclaration = {
    name: 'triage_emails',
    description:
        'Triage a batch of inbox emails and rank them by urgency — the first thing the Inbox Agent does when it ' +
        'opens a mailbox. This is a PURE, offline scoring function (no network): pass the emails you have read and ' +
        'it scores each one with keyword heuristics, assigning a priority (high/normal/low), a suggested next action ' +
        '("Reply today", "Review", "Archive/skip"), and a short reason. Returns the list sorted high→low plus counts ' +
        'per bucket so you can tell the user "you have 3 high-priority emails" and decide which to draft replies to.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            emails: {
                type: Type.ARRAY,
                description: 'The emails to triage. Each item is one inbox message you have read.',
                items: {
                    type: Type.OBJECT,
                    properties: {
                        from: {
                            type: Type.STRING,
                            description: 'Sender name and/or email address.',
                        },
                        subject: {
                            type: Type.STRING,
                            description: 'The email subject line.',
                        },
                        snippet: {
                            type: Type.STRING,
                            description: 'A short snippet/preview of the email body.',
                        },
                    },
                    required: ['from', 'subject'],
                },
            },
        },
        required: ['emails'],
    },
};

const draftReplyDeclaration: FunctionDeclaration = {
    name: 'draft_reply',
    description:
        'Save a reply YOU wrote to a specific email as a draft on the Mission Dashboard — without sending it. THIS is ' +
        'how a proposed reply reaches the user for review (Superhuman-style "draft, then send"). Write the full reply ' +
        'prose yourself and pass it in `reply_body`; this tool persists it to Echo Core drafts. Use this for anything ' +
        'the user should approve before it goes out. To actually send, call send_reply.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            to: {
                type: Type.STRING,
                description: 'Recipient email address the reply is addressed to.',
            },
            subject: {
                type: Type.STRING,
                description: 'Subject line for the reply. If omitted, "Re: <original_subject>" is used.',
            },
            reply_body: {
                type: Type.STRING,
                description: 'The full reply text YOU wrote (the actual prose to save). Required.',
            },
            original_subject: {
                type: Type.STRING,
                description: 'The subject of the email being replied to (used to build a "Re:" subject if subject is omitted).',
            },
            tone: {
                type: Type.STRING,
                description: "Optional tone label for context (e.g. 'friendly', 'formal', 'concise'). Stored with the draft.",
            },
        },
        required: ['to', 'reply_body'],
    },
};

const sendReplyDeclaration: FunctionDeclaration = {
    name: 'send_reply',
    description:
        'Send an email reply immediately via the Resend API. Use this only once the user has approved the reply (or ' +
        'explicitly asked you to send) — for review-first flows use draft_reply. Requires a Resend API key (saved as ' +
        'echo_resend_key in settings, or pass api_key). NOTE: a browser may block Resend with a CORS error, so running ' +
        'this from Echo Core / a mission is the reliable send path; in the browser, prefer draft_reply and let Core send.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            to: {
                type: Type.STRING,
                description: 'Recipient email address (or comma-separated list for multiple recipients).',
            },
            subject: {
                type: Type.STRING,
                description: 'Email subject line.',
            },
            body: {
                type: Type.STRING,
                description: 'The reply body. Use HTML for rich formatting (e.g. <p>Hi</p>) or plain text.',
            },
            from: {
                type: Type.STRING,
                description: 'Sender address. Default: "Echo <onboarding@resend.dev>" (Resend\'s shared test domain). For production use your verified domain.',
            },
            is_html: {
                type: Type.BOOLEAN,
                description: 'Whether body is HTML (true) or plain text (false). Default: auto-detect based on < tags.',
            },
            api_key: {
                type: Type.STRING,
                description: 'Resend API key (optional if echo_resend_key is saved in settings).',
            },
        },
        required: ['to', 'subject', 'body'],
    },
};

const summarizeThreadDeclaration: FunctionDeclaration = {
    name: 'summarize_thread',
    description:
        'Save a summary YOU wrote of an email thread/conversation to the Mission Dashboard. The Inbox Agent uses this ' +
        'to capture "what this thread is about + open questions + decisions" so the user can catch up at a glance. ' +
        'Read the thread, write the summary yourself, and pass it in `summary`; this tool persists it to Echo Core drafts.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            title: {
                type: Type.STRING,
                description: 'A short title for the thread (e.g. the subject or "Thread: pricing negotiation with Acme").',
            },
            summary: {
                type: Type.STRING,
                description: 'The full thread summary YOU wrote (the actual prose to save). Required.',
            },
        },
        required: ['title', 'summary'],
    },
};

function scoreEmail(email: any): { priority: 'high' | 'normal' | 'low'; suggestedAction: string; reason: string } {
    const hay = [email?.from, email?.subject, email?.snippet]
        .map((v) => String(v || '').toLowerCase())
        .join(' \n ');

    const highHits = HIGH_KEYWORDS.filter((k) => hay.includes(k));
    const lowHits = LOW_KEYWORDS.filter((k) => hay.includes(k));

    if (highHits.length > 0) {
        return {
            priority: 'high',
            suggestedAction: 'Reply today',
            reason: `Matched urgent signals: ${highHits.slice(0, 3).join(', ')}.`,
        };
    }
    if (lowHits.length > 0) {
        return {
            priority: 'low',
            suggestedAction: 'Archive/skip',
            reason: `Looks like bulk/marketing mail: ${lowHits.slice(0, 3).join(', ')}.`,
        };
    }
    return {
        priority: 'normal',
        suggestedAction: 'Review',
        reason: 'No urgent or low-priority signals detected — needs a quick look.',
    };
}

export const inboxSkill: Skill = {
    name: 'inboxSkill',
    description:
        'Inbox Agent — triage and reply to email, an Intercom/Superhuman-style assistant. YOU read and write the prose; ' +
        'these tools structure, persist, and send it. Use triage_emails to rank an inbox by urgency, draft_reply to ' +
        'save proposed replies for review, summarize_thread to capture a conversation, and send_reply to ship an ' +
        'approved reply via Resend.',
    tools: [
        triageEmailsDeclaration,
        draftReplyDeclaration,
        sendReplyDeclaration,
        summarizeThreadDeclaration,
    ],

    execute: async (toolName: string, args: any) => {
        if (toolName === 'triage_emails') {
            const emails: any[] = Array.isArray(args.emails) ? args.emails : [];
            if (!emails.length) {
                return { error: 'triage_emails requires a non-empty `emails` array.' };
            }

            const RANK: Record<string, number> = { high: 0, normal: 1, low: 2 };
            const triaged = emails.map((e) => {
                const { priority, suggestedAction, reason } = scoreEmail(e);
                return {
                    from: String(e?.from || ''),
                    subject: String(e?.subject || ''),
                    priority,
                    suggestedAction,
                    reason,
                };
            });

            triaged.sort((a, b) => RANK[a.priority] - RANK[b.priority]);

            const counts = {
                high: triaged.filter((t) => t.priority === 'high').length,
                normal: triaged.filter((t) => t.priority === 'normal').length,
                low: triaged.filter((t) => t.priority === 'low').length,
            };

            return { triaged, counts };
        }

        if (toolName === 'draft_reply') {
            const to = String(args.to || '').trim();
            const replyBody = String(args.reply_body || '');
            if (!to) {
                return { error: 'draft_reply requires a `to` recipient.' };
            }
            if (!replyBody.trim()) {
                return { error: 'draft_reply requires a non-empty `reply_body` (the reply prose to save).' };
            }

            const originalSubject = String(args.original_subject || '').trim();
            const subject = String(args.subject || '').trim() || `Re: ${originalSubject}`.trim();
            const tone = String(args.tone || '').trim() || undefined;

            coreAdd('drafts', {
                kind: 'email-reply',
                title: subject,
                content: replyBody,
                source: 'inbox-agent',
                to,
                tone,
            });

            const savedToDashboard = isCoreConnected();
            return {
                success: true,
                savedToDashboard,
                message: savedToDashboard
                    ? `Saved reply to ${to} ("${subject}") to the Mission Dashboard for review. Call send_reply to send it.`
                    : `Queued reply to ${to} ("${subject}") — Echo Core is offline, so it will not appear on the dashboard until reconnected.`,
            };
        }

        if (toolName === 'send_reply') {
            const key = String(args.api_key || localStorage.getItem(RESEND_KEY) || '').trim();
            if (!key) {
                return {
                    error: 'No Resend API key configured. Get a free key at resend.com, then say "save my Resend key: re_..."',
                };
            }

            const to = String(args.to || '').trim();
            const subject = String(args.subject || '').trim();
            const body = String(args.body || '').trim();

            if (!to) return { error: 'No recipient email address provided.' };
            if (!subject) return { error: 'No email subject provided.' };
            if (!body) return { error: 'No email body provided.' };

            const isHtml = args.is_html ?? body.includes('<');
            const payload: Record<string, any> = {
                from: String(args.from || 'Echo <onboarding@resend.dev>'),
                to: to.includes(',') ? to.split(',').map((s: string) => s.trim()) : to,
                subject,
            };

            if (isHtml) {
                payload.html = body;
            } else {
                payload.text = body;
            }

            const res = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${key}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                const detail = await res.text().catch(() => '');
                return { error: `Resend API error ${res.status}: ${detail.slice(0, 200)}` };
            }

            const data = await res.json();
            return {
                success: true,
                ...data,
                message: `Reply sent to ${to} with subject "${subject}".`,
            };
        }

        if (toolName === 'summarize_thread') {
            const title = String(args.title || '').trim();
            const summary = String(args.summary || '');
            if (!title) {
                return { error: 'summarize_thread requires a `title`.' };
            }
            if (!summary.trim()) {
                return { error: 'summarize_thread requires a non-empty `summary` (the summary prose to save).' };
            }

            coreAdd('drafts', {
                kind: 'email-summary',
                title,
                content: summary,
                source: 'inbox-agent',
            });

            return { success: true, savedToDashboard: isCoreConnected() };
        }

        return { error: `Unknown tool: ${toolName}` };
    },
};

export default inboxSkill;
