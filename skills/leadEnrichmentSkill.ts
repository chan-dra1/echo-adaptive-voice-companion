import { FunctionDeclaration, Type } from '@google/genai';
import { Skill } from '../services/agentSkillService';

// localStorage key for persisted leads
const LEADS_KEY = 'echo_leads';

// ─── Tool declarations ────────────────────────────────────────────────────────

const validateEmailDeclaration: FunctionDeclaration = {
    name: 'validate_email',
    description:
        'Validate an email address by checking syntax and performing a live MX record lookup via ' +
        'DNS-over-HTTPS (dns.google). No API key needed. Returns syntax validity, MX existence, ' +
        'a deliverability guess, and raw MX records.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            email: {
                type: Type.STRING,
                description: 'The email address to validate. Example: "user@example.com"',
            },
        },
        required: ['email'],
    },
};

const enrichCompanyDeclaration: FunctionDeclaration = {
    name: 'enrich_company',
    description:
        'Enrich a company domain using only public, keyless data sources: DNS-over-HTTPS for ' +
        'existence, and Microlink (microlink.io) for open-graph metadata (title, description, logo). ' +
        'No private, credentialed, or paid APIs are used. Replaces expensive enrichment SaaS for ' +
        'basic lead qualification.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            domain: {
                type: Type.STRING,
                description: 'The company domain to enrich. Example: "stripe.com"',
            },
        },
        required: ['domain'],
    },
};

const checkDomainDeclaration: FunctionDeclaration = {
    name: 'check_domain',
    description:
        'Check DNS health of a domain by looking up A, MX, and TXT records in parallel via ' +
        'DNS-over-HTTPS (dns.google). Useful for qualifying whether a domain is real and mail-enabled.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            domain: {
                type: Type.STRING,
                description: 'The domain to check. Example: "acme.io"',
            },
        },
        required: ['domain'],
    },
};

const saveLeadDeclaration: FunctionDeclaration = {
    name: 'save_lead',
    description:
        'Save a qualified lead to local storage (key: echo_leads) as a JSON array entry. ' +
        'Returns the assigned ID and running total. Data stays on-device; nothing is sent externally.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            name: {
                type: Type.STRING,
                description: "Lead's full name.",
            },
            email: {
                type: Type.STRING,
                description: "Lead's email address.",
            },
            company: {
                type: Type.STRING,
                description: "Lead's company name or domain.",
            },
            notes: {
                type: Type.STRING,
                description: 'Optional free-text notes about the lead.',
            },
        },
        required: ['name', 'email', 'company'],
    },
};

// ─── Helper types ─────────────────────────────────────────────────────────────

interface DnsResponse {
    Answer?: { name: string; type: number; TTL: number; data: string }[];
    Status: number;
}

interface Lead {
    id: string;
    name: string;
    email: string;
    company: string;
    notes?: string;
    saved_at: string;
}

// ─── Helper functions ─────────────────────────────────────────────────────────

async function dnsLookup(name: string, type: string): Promise<DnsResponse> {
    const url = `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`DNS lookup failed: ${res.status}`);
    return res.json() as Promise<DnsResponse>;
}

// ─── Skill definition ─────────────────────────────────────────────────────────

const leadEnrichmentSkill: Skill = {
    name: 'lead_enrichment',
    description:
        'Lead validation and enrichment using only public data sources — no API keys, no ' +
        'paid subscriptions. Validates emails (syntax + MX), enriches company domains (DNS + ' +
        'Microlink open-graph metadata), audits DNS health, and saves leads to local storage. ' +
        'Replaces tools like 1Lookup ($223k MRR SaaS) for early-stage lead qualification pipelines.',
    tools: [
        validateEmailDeclaration,
        enrichCompanyDeclaration,
        checkDomainDeclaration,
        saveLeadDeclaration,
    ],

    execute: async (toolName: string, args: any): Promise<any> => {
        // Defensive guard: @google/genai types fc.args as optional — protect against undefined
        const a = (args && typeof args === 'object') ? args : {};

        switch (toolName) {

            // ── validate_email ────────────────────────────────────────────────
            case 'validate_email': {
                const email = String(a.email || '').trim();
                if (!email) return { error: 'No email provided.' };

                // 1. Syntax check
                const syntaxRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                const valid_syntax = syntaxRegex.test(email);

                const atIdx = email.lastIndexOf('@');
                const domain = atIdx !== -1 ? email.slice(atIdx + 1).toLowerCase() : '';

                if (!domain) {
                    return { email, valid_syntax: false, has_mx: false, deliverable_guess: false, domain: '', mx_records: [] };
                }

                // 2. MX record lookup via DNS-over-HTTPS (no API key, CORS-safe)
                let has_mx = false;
                let mx_records: string[] = [];
                try {
                    const mxData = await dnsLookup(domain, 'MX');
                    // Filter RFC 7505 null-MX records ("0 .") — they explicitly declare no mail accepted
                    const realMx = (mxData.Answer || []).filter(r => !/^0\s+\.?\s*$/.test(r.data.trim()));
                    has_mx = realMx.length > 0;
                    mx_records = realMx.map(r => r.data);
                } catch {
                    // Network error — treat as unknown but don't crash
                    has_mx = false;
                }

                const deliverable_guess = valid_syntax && has_mx;

                return { email, valid_syntax, has_mx, deliverable_guess, domain, mx_records };
            }

            // ── enrich_company ────────────────────────────────────────────────
            case 'enrich_company': {
                // SECURITY NOTE: Only public data sources used here.
                // No private APIs, credentialed endpoints, or gated data.
                // Normalize: strip protocol, www., path, query, port
                const rawDomain = String(a.domain || '').trim().toLowerCase();
                const domain = rawDomain
                    .replace(/^https?:\/\//, '')
                    .replace(/^www\./, '')
                    .split('/')[0].split('?')[0].split('#')[0]
                    .replace(/:\d+$/, '').replace(/\.$/, '');
                if (!domain) return { error: 'No domain provided.' };

                // 1. DNS A-record check for existence
                let online = false;
                try {
                    const aData = await dnsLookup(domain, 'A');
                    online = Array.isArray(aData.Answer) && aData.Answer.length > 0;
                } catch {
                    online = false;
                }

                // 2. Microlink — free, CORS-friendly, public metadata scraper
                let title: string | null = null;
                let description: string | null = null;
                let logo: string | null = null;
                let publisher: string | null = null;

                try {
                    const mlUrl = `https://api.microlink.io/?url=${encodeURIComponent(`https://${domain}`)}`;
                    const mlRes = await fetch(mlUrl, { headers: { Accept: 'application/json' } });
                    if (mlRes.ok) {
                        const mlData: any = await mlRes.json();
                        if (mlData?.status === 'success' && mlData?.data) {
                            const d = mlData.data;
                            title = d.title ?? null;
                            description = d.description ?? null;
                            logo = d.logo?.url ?? null;
                            publisher = d.publisher ?? null;
                        }
                    }
                } catch {
                    // Microlink unavailable — continue with DNS-only result
                }

                return {
                    domain,
                    online,
                    title,
                    description,
                    logo,
                    publisher,
                    source: 'public',
                    note: 'Data sourced from public DNS and open-graph metadata only. No private or credentialed sources used.',
                };
            }

            // ── check_domain ──────────────────────────────────────────────────
            case 'check_domain': {
                const rawD = String(a.domain || '').trim().toLowerCase();
                const domain = rawD
                    .replace(/^https?:\/\//, '')
                    .replace(/^www\./, '')
                    .split('/')[0].split('?')[0].split('#')[0]
                    .replace(/:\d+$/, '').replace(/\.$/, '');
                if (!domain) return { error: 'No domain provided.' };

                // Run A, MX, TXT lookups in parallel
                const [aResult, mxResult, txtResult] = await Promise.allSettled([
                    dnsLookup(domain, 'A'),
                    dnsLookup(domain, 'MX'),
                    dnsLookup(domain, 'TXT'),
                ]);

                const aAnswers   = aResult.status   === 'fulfilled' ? (aResult.value.Answer   || []) : [];
                const mxAnswers  = mxResult.status  === 'fulfilled' ? (mxResult.value.Answer  || []) : [];
                const txtAnswers = txtResult.status === 'fulfilled' ? (txtResult.value.Answer || []) : [];

                // Filter RFC 7505 null-MX records ("0 .") before reporting has_mx
                const realMxAnswers = mxAnswers.filter(r => !/^0\s+\.?\s*$/.test(r.data.trim()));
                const has_a   = aAnswers.length > 0;
                const has_mx  = realMxAnswers.length > 0;
                const has_txt = txtAnswers.length > 0;

                return {
                    domain,
                    has_a,
                    has_mx,
                    has_txt,
                    records: {
                        a:   aAnswers.map(r => r.data),
                        mx:  realMxAnswers.map(r => r.data),
                        txt: txtAnswers.map(r => r.data),
                    },
                };
            }

            // ── save_lead ─────────────────────────────────────────────────────
            case 'save_lead': {
                const name    = String(a.name    || '').trim();
                const email   = String(a.email   || '').trim();
                const company = String(a.company || '').trim();
                const notes   = a.notes ? String(a.notes).trim() : undefined;

                if (!name || !email || !company) {
                    return { error: 'name, email, and company are all required.' };
                }

                let leads: Lead[] = [];
                try {
                    const raw = localStorage.getItem(LEADS_KEY);
                    if (raw) leads = JSON.parse(raw) as Lead[];
                } catch {
                    leads = [];
                }

                const newLead: Lead = {
                    id: `lead_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                    name,
                    email,
                    company,
                    ...(notes ? { notes } : {}),
                    saved_at: new Date().toISOString(),
                };

                leads.push(newLead);

                try {
                    localStorage.setItem(LEADS_KEY, JSON.stringify(leads));
                } catch (err) {
                    return { error: `Failed to save lead: ${String(err)}` };
                }

                return { saved: true, id: newLead.id, total_leads: leads.length };
            }

            default:
                return { error: `Unknown tool: ${toolName}` };
        }
    },
};

export default leadEnrichmentSkill;
