import { FunctionDeclaration, Type } from '@google/genai';
import { Skill } from '../services/agentSkillService';

const RESEND_KEY = 'echo_resend_key';
const CAMPAIGNS_KEY = 'echo_outreach_campaigns';

interface OutreachContact {
    email: string;
    name?: string;
    company?: string;
    role?: string;
}

interface SentRecord {
    email: string;
    success: boolean;
    id?: string;
    error?: string;
}

interface OutreachCampaign {
    id: string;
    name: string;
    contacts: OutreachContact[];
    subject_template: string;
    body_template: string;
    createdAt: string;
    status: 'draft' | 'sent';
    sent: SentRecord[];
    stats: { total: number; sent: number; failed: number };
}

function loadCampaigns(): OutreachCampaign[] {
    try {
        const raw = localStorage.getItem(CAMPAIGNS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveCampaigns(campaigns: OutreachCampaign[]): void {
    localStorage.setItem(CAMPAIGNS_KEY, JSON.stringify(campaigns));
}

function applyTemplate(template: string, contact: OutreachContact): string {
    return String(template || '')
        .replace(/\{\{\s*name\s*\}\}/gi, contact.name || '')
        .replace(/\{\{\s*company\s*\}\}/gi, contact.company || '')
        .replace(/\{\{\s*role\s*\}\}/gi, contact.role || '');
}

const createOutreachCampaignDeclaration: FunctionDeclaration = {
    name: 'create_outreach_campaign',
    description:
        'Create a cold-email / outreach campaign (drip sequence) for sales prospecting and lead gen — an Instantly/Apollo-style workflow. Stores a reusable campaign of personalized emails locally as a draft so it can be reviewed and sent later with send_outreach_campaign. Subject and body templates may include {{name}}, {{company}}, and {{role}} placeholders that get filled in per contact. Use for: cold outreach, sales sequences, investor/partner outreach, recruiting, or any personalized batch email.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            name: {
                type: Type.STRING,
                description: 'A short name for the campaign (e.g. "Q3 SaaS founders cold outreach").',
            },
            contacts: {
                type: Type.ARRAY,
                description: 'List of prospects to email. Each contact needs at minimum an email; name, company and role are optional but power personalization.',
                items: {
                    type: Type.OBJECT,
                    properties: {
                        email: { type: Type.STRING, description: 'Recipient email address (required).' },
                        name: { type: Type.STRING, description: 'Contact name (optional, fills {{name}}).' },
                        company: { type: Type.STRING, description: 'Contact company (optional, fills {{company}}).' },
                        role: { type: Type.STRING, description: 'Contact role/title (optional, fills {{role}}).' },
                    },
                    required: ['email'],
                },
            },
            subject_template: {
                type: Type.STRING,
                description: 'Subject line template. May contain {{name}}, {{company}}, {{role}} placeholders (e.g. "Quick idea for {{company}}").',
            },
            body_template: {
                type: Type.STRING,
                description: 'Email body template. May contain {{name}}, {{company}}, {{role}} placeholders. Use HTML for rich formatting (e.g. <p>Hi {{name}}</p>) or plain text.',
            },
        },
        required: ['name', 'contacts', 'subject_template', 'body_template'],
    },
};

const sendOutreachCampaignDeclaration: FunctionDeclaration = {
    name: 'send_outreach_campaign',
    description:
        'Send a previously created outreach campaign via the Resend API — blasts the personalized cold emails to every contact in the campaign. Substitutes {{name}}/{{company}}/{{role}} per recipient, sends one email each, and records per-contact delivery results. Requires a Resend API key (set echo_resend_key in settings or pass api_key directly). Use limit to send only the first N (good for a test batch). Note: for large volumes (hundreds+ of contacts) prefer running through Echo Core, which avoids browser CORS and rate limits.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            campaign_id: {
                type: Type.STRING,
                description: 'The id of the campaign to send (from create_outreach_campaign or list_outreach_campaigns).',
            },
            api_key: {
                type: Type.STRING,
                description: 'Resend API key (optional if echo_resend_key is saved in settings).',
            },
            from: {
                type: Type.STRING,
                description: 'Sender address. Default: "Echo <onboarding@resend.dev>" (Resend\'s shared testing domain). For production, use your verified domain.',
            },
            limit: {
                type: Type.NUMBER,
                description: 'Optional. Only send to the first N contacts (e.g. 5 for a test batch). Default: send to all contacts.',
            },
        },
        required: ['campaign_id'],
    },
};

const listOutreachCampaignsDeclaration: FunctionDeclaration = {
    name: 'list_outreach_campaigns',
    description:
        'List all saved outreach campaigns with their id, name, status (draft/sent), stats (total/sent/failed) and creation time. Use to see what cold-email campaigns exist before sending or to report progress. Returns a summary only — not the full contact lists.',
    parameters: {
        type: Type.OBJECT,
        properties: {},
    },
};

const findLeadsDeclaration: FunctionDeclaration = {
    name: 'find_leads',
    description:
        'Discover public leads / prospects for cold outreach using the keyless DuckDuckGo Instant Answer API. Finds public company and person info (websites, descriptions, links) to seed a campaign — for example "B2B SaaS startups in Berlin" or "Acme Corp marketing director". Returns titles, snippets and URLs to research, NOT private contact databases or verified emails. Echo must never scrape gated, private, or login-walled data; always verify and obtain contact details ethically before reaching out.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            query: {
                type: Type.STRING,
                description: 'Search query describing the leads to find (e.g. "fintech startups San Francisco", "VP Engineering Stripe").',
            },
            num_results: {
                type: Type.NUMBER,
                description: 'Max number of leads to return. Default: 5.',
            },
        },
        required: ['query'],
    },
};

export const outreachSkill: Skill = {
    name: 'outreachSkill',
    description:
        'Cold-email / outreach automation (an Instantly/Apollo killer): build personalized campaigns, send them via Resend, track stats, and discover public leads. Free tier via Resend: 3,000 emails/month.',
    tools: [
        createOutreachCampaignDeclaration,
        sendOutreachCampaignDeclaration,
        listOutreachCampaignsDeclaration,
        findLeadsDeclaration,
    ],

    execute: async (toolName: string, args: any) => {
        if (toolName === 'create_outreach_campaign') {
            const name = String(args.name || '').trim();
            if (!name) return { error: 'No campaign name provided.' };

            const rawContacts = Array.isArray(args.contacts) ? args.contacts : [];
            const contacts: OutreachContact[] = rawContacts
                .map((c: any) => ({
                    email: String(c?.email || '').trim(),
                    name: c?.name ? String(c.name).trim() : undefined,
                    company: c?.company ? String(c.company).trim() : undefined,
                    role: c?.role ? String(c.role).trim() : undefined,
                }))
                .filter((c: OutreachContact) => c.email);

            if (contacts.length === 0) {
                return { error: 'No valid contacts provided. Each contact needs at least an email address.' };
            }

            const subject_template = String(args.subject_template || '').trim();
            const body_template = String(args.body_template || '').trim();
            if (!subject_template) return { error: 'No subject_template provided.' };
            if (!body_template) return { error: 'No body_template provided.' };

            const campaign: OutreachCampaign = {
                id: crypto.randomUUID(),
                name,
                contacts,
                subject_template,
                body_template,
                createdAt: new Date().toISOString(),
                status: 'draft',
                sent: [],
                stats: { total: contacts.length, sent: 0, failed: 0 },
            };

            const campaigns = loadCampaigns();
            campaigns.push(campaign);
            saveCampaigns(campaigns);

            return {
                success: true,
                campaignId: campaign.id,
                total: contacts.length,
                message: `Outreach campaign "${name}" created as a draft with ${contacts.length} contact(s). Send it with send_outreach_campaign (campaign_id: ${campaign.id}).`,
            };
        }

        if (toolName === 'send_outreach_campaign') {
            const campaignId = String(args.campaign_id || '').trim();
            if (!campaignId) return { error: 'No campaign_id provided.' };

            const campaigns = loadCampaigns();
            const idx = campaigns.findIndex((c) => c.id === campaignId);
            if (idx === -1) return { error: `Campaign not found: ${campaignId}. Use list_outreach_campaigns to see available campaigns.` };

            const key = String(args.api_key || localStorage.getItem(RESEND_KEY) || '').trim();
            if (!key) {
                return {
                    error: 'No Resend API key configured. Get a free key at resend.com, then say "save my Resend key: re_..."',
                };
            }

            const campaign = campaigns[idx];
            const from = String(args.from || 'Echo <onboarding@resend.dev>');
            const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : undefined;
            const targets = limit ? campaign.contacts.slice(0, limit) : campaign.contacts;

            const results: SentRecord[] = [];
            let sent = 0;
            let failed = 0;

            for (const contact of targets) {
                try {
                    const subject = applyTemplate(campaign.subject_template, contact);
                    const body = applyTemplate(campaign.body_template, contact);
                    const isHtml = body.includes('<');

                    const payload: Record<string, any> = {
                        from,
                        to: contact.email,
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
                        const errMsg = `Resend API error ${res.status}: ${detail.slice(0, 200)}`;
                        results.push({ email: contact.email, success: false, error: errMsg });
                        failed++;
                        continue;
                    }

                    const data = await res.json();
                    results.push({ email: contact.email, success: true, id: data.id });
                    sent++;
                } catch (e: any) {
                    results.push({ email: contact.email, success: false, error: String(e?.message || e).slice(0, 200) });
                    failed++;
                }
            }

            campaign.sent = results;
            campaign.status = 'sent';
            campaign.stats = { total: campaign.contacts.length, sent, failed };
            campaigns[idx] = campaign;
            saveCampaigns(campaigns);

            return {
                success: failed === 0,
                sent,
                failed,
                results,
                message: `Campaign "${campaign.name}": ${sent} sent, ${failed} failed (of ${targets.length} attempted).`,
            };
        }

        if (toolName === 'list_outreach_campaigns') {
            const campaigns = loadCampaigns();
            return {
                campaigns: campaigns.map((c) => ({
                    id: c.id,
                    name: c.name,
                    status: c.status,
                    stats: c.stats,
                    createdAt: c.createdAt,
                })),
                count: campaigns.length,
            };
        }

        if (toolName === 'find_leads') {
            const query = String(args.query || '').trim();
            if (!query) return { error: 'No search query provided.' };

            const numResults = typeof args.num_results === 'number' && args.num_results > 0 ? Math.floor(args.num_results) : 5;

            const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&no_redirect=1&t=echo-outreach`;
            const res = await fetch(url);
            if (!res.ok) {
                const detail = await res.text().catch(() => '');
                return { error: `DuckDuckGo API error ${res.status}: ${detail.slice(0, 200)}` };
            }

            const data = await res.json().catch(() => null);
            if (!data) return { error: 'Failed to parse DuckDuckGo response.' };

            const leads: Array<{ title: string; snippet: string; url: string }> = [];
            const collect = (topics: any[]) => {
                if (!Array.isArray(topics)) return;
                for (const t of topics) {
                    if (leads.length >= numResults) break;
                    if (t && Array.isArray(t.Topics)) {
                        collect(t.Topics);
                        continue;
                    }
                    const text = String(t?.Text || '').trim();
                    const href = String(t?.FirstURL || '').trim();
                    if (!text && !href) continue;
                    leads.push({
                        title: text ? text.split(' - ')[0] : href,
                        snippet: text,
                        url: href,
                    });
                }
            };

            collect(data.RelatedTopics);
            if (leads.length < numResults) collect(data.Results);

            return {
                query,
                leads: leads.slice(0, numResults),
                count: Math.min(leads.length, numResults),
                note: 'Public web results — verify contacts before outreach.',
            };
        }

        return { error: `Unknown tool: ${toolName}` };
    },
};

export default outreachSkill;
