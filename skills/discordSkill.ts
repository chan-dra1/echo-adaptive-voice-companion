import { FunctionDeclaration, Type } from '@google/genai';
import { Skill } from '../services/agentSkillService';

const WEBHOOK_KEY = 'echo_discord_webhook';

function getWebhook(provided?: string): string {
    return (provided || localStorage.getItem(WEBHOOK_KEY) || '').trim();
}

const sendMessageDeclaration: FunctionDeclaration = {
    name: 'send_discord_message',
    description:
        'Send a message or rich embed to a Discord channel via webhook. Use this to post updates, share mission results, send alerts, or notify a team. Requires a webhook URL stored via set_discord_webhook or passed directly.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            message: {
                type: Type.STRING,
                description: 'The message text to send (plain text, or embed description if title is set).',
            },
            title: {
                type: Type.STRING,
                description: 'Optional embed title. If set, sends a rich embed card instead of plain text.',
            },
            color: {
                type: Type.NUMBER,
                description: 'Embed color as decimal integer. Examples: 5763719=green, 15548997=red, 3447003=blue, 16776960=yellow. Default: 5763719.',
            },
            username: {
                type: Type.STRING,
                description: 'Override the bot display name (default: "Echo").',
            },
            webhook_url: {
                type: Type.STRING,
                description: 'Discord webhook URL (optional if already saved via set_discord_webhook).',
            },
        },
        required: ['message'],
    },
};

const setWebhookDeclaration: FunctionDeclaration = {
    name: 'set_discord_webhook',
    description:
        'Save a Discord webhook URL so Echo can post to Discord in the future without needing the URL each time. Get a webhook from: Discord channel → Edit Channel → Integrations → Webhooks → New Webhook → Copy Webhook URL.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            webhook_url: {
                type: Type.STRING,
                description: 'The full Discord webhook URL (starts with https://discord.com/api/webhooks/).',
            },
        },
        required: ['webhook_url'],
    },
};

export const discordSkill: Skill = {
    name: 'discordSkill',
    description: 'Send messages and embeds to Discord channels via webhook. Supports rich embeds with titles and colors.',
    tools: [sendMessageDeclaration, setWebhookDeclaration],

    execute: async (toolName: string, args: any) => {
        if (toolName === 'set_discord_webhook') {
            const url = String(args.webhook_url || '').trim();
            if (!url.includes('discord.com/api/webhooks/') && !url.includes('discordapp.com/api/webhooks/')) {
                return { error: 'Invalid Discord webhook URL. Must be a URL from discord.com/api/webhooks/' };
            }
            localStorage.setItem(WEBHOOK_KEY, url);
            return { success: true, saved: true, message: 'Discord webhook saved. Echo will use this for future Discord messages.' };
        }

        if (toolName === 'send_discord_message') {
            const webhook = getWebhook(args.webhook_url);
            if (!webhook) {
                return {
                    error: 'No Discord webhook configured. Ask the user to share their webhook URL and call set_discord_webhook first.',
                };
            }

            const useEmbed = Boolean(args.title);
            const body: Record<string, any> = {
                username: String(args.username || 'Echo'),
            };

            if (useEmbed) {
                body.embeds = [{
                    title: String(args.title),
                    description: String(args.message || ''),
                    color: Number(args.color) || 5763719,
                    footer: { text: '⬡ Sent by Echo' },
                    timestamp: new Date().toISOString(),
                }];
            } else {
                body.content = String(args.message || '');
            }

            const res = await fetch(webhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const detail = await res.text().catch(() => '');
                return { error: `Discord returned ${res.status}: ${detail.slice(0, 200)}` };
            }

            return { success: true, message: `Message sent to Discord${useEmbed ? ' as embed' : ''}.` };
        }

        return { error: `Unknown tool: ${toolName}` };
    },
};

export default discordSkill;
