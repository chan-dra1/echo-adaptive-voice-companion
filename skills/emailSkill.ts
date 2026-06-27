import { FunctionDeclaration, Type } from '@google/genai';
import { Skill } from '../services/agentSkillService';

const RESEND_KEY = 'echo_resend_key';

const sendEmailDeclaration: FunctionDeclaration = {
    name: 'send_email',
    description:
        'Send an email via Resend API. Can send plain text or HTML emails. Use for: sending reports, outreach emails, notifications, summaries, alerts, or any automated email. Requires a Resend API key (set echo_resend_key in settings or pass api_key directly). Get a free key at resend.com — 3,000 emails/month free.',
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
                description: 'Email body content. Use HTML for rich formatting (e.g. <h1>Title</h1><p>Content</p>) or plain text.',
            },
            from: {
                type: Type.STRING,
                description: 'Sender address. Default: "Echo <onboarding@resend.dev>" (Resend\'s shared domain for testing). For production, use your verified domain.',
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

const saveResendKeyDeclaration: FunctionDeclaration = {
    name: 'save_resend_key',
    description:
        'Save a Resend API key for future email sending. Get your free key at resend.com. Once saved, Echo can send emails autonomously without needing the key each time.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            api_key: {
                type: Type.STRING,
                description: 'Your Resend API key (starts with re_).',
            },
        },
        required: ['api_key'],
    },
};

export const emailSkill: Skill = {
    name: 'emailSkill',
    description: 'Send emails via Resend API. Supports plain text and HTML. Free tier: 3,000 emails/month.',
    tools: [sendEmailDeclaration, saveResendKeyDeclaration],

    execute: async (toolName: string, args: any) => {
        if (toolName === 'save_resend_key') {
            const key = String(args.api_key || '').trim();
            if (!key.startsWith('re_')) return { error: 'Invalid Resend API key. Must start with re_' };
            localStorage.setItem(RESEND_KEY, key);
            return { success: true, message: 'Resend API key saved. Echo can now send emails autonomously.' };
        }

        if (toolName === 'send_email') {
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
                return { error: `Resend API error ${res.status}: ${detail.slice(0, 300)}` };
            }

            const data = await res.json();
            return {
                success: true,
                id: data.id,
                message: `Email sent to ${to} with subject "${subject}".`,
            };
        }

        return { error: `Unknown tool: ${toolName}` };
    },
};

export default emailSkill;
