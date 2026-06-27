import { FunctionDeclaration, Type } from '@google/genai';
import { Skill } from '../services/agentSkillService';
import {
    isCoreConnected,
    coreSocialPost,
    coreSaveSocialCreds,
    coreListSocialAccounts,
    coreSaveMission,
} from '../services/echoCoreSync';

/**
 * socialSkill — Social Autopilot. One tool to post to every network.
 *
 * Posting runs server-side through Echo Core (socialPoster.mjs) so it isn't
 * blocked by browser CORS. When Core is offline, a few CORS-friendly networks
 * (Bluesky, Mastodon, Discord) still work via direct browser fetch as a
 * fallback; the rest report that Core is required.
 *
 * Credentials are kept in localStorage (echo_social_creds) AND mirrored to
 * Core so autonomous scheduled missions can post while the browser is closed.
 */

const CREDS_KEY = 'echo_social_creds';

const ALL_PLATFORMS = ['bluesky', 'mastodon', 'twitter', 'linkedin', 'threads', 'facebook', 'discord'];
const BROWSER_OK = new Set(['bluesky', 'mastodon', 'discord']); // CORS-friendly offline fallback

function getAllCreds(): Record<string, any> {
    try { return JSON.parse(localStorage.getItem(CREDS_KEY) || '{}'); } catch { return {}; }
}
function setPlatformCreds(platform: string, creds: Record<string, any>) {
    const all = getAllCreds();
    all[platform] = { ...(all[platform] || {}), ...creds };
    localStorage.setItem(CREDS_KEY, JSON.stringify(all));
    return all;
}

// ── Browser-side fallback posters (only for CORS-friendly networks) ───────────

async function browserBluesky(text: string, c: any) {
    const identifier = c.handle || c.identifier;
    const password = c.app_password || c.password;
    if (!identifier || !password) return { platform: 'bluesky', ok: false, error: 'Needs handle + app_password.' };
    const sess = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
    });
    if (!sess.ok) return { platform: 'bluesky', ok: false, error: `auth ${sess.status}` };
    const s = await sess.json();
    const res = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
        method: 'POST', headers: { Authorization: `Bearer ${s.accessJwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: s.did, collection: 'app.bsky.feed.post', record: { $type: 'app.bsky.feed.post', text: text.slice(0, 300), createdAt: new Date().toISOString() } }),
    });
    if (!res.ok) return { platform: 'bluesky', ok: false, error: `post ${res.status}` };
    const d = await res.json();
    const rkey = (d.uri || '').split('/').pop();
    return { platform: 'bluesky', ok: true, url: rkey ? `https://bsky.app/profile/${identifier}/post/${rkey}` : undefined };
}

async function browserMastodon(text: string, c: any) {
    const instance = (c.instance || '').replace(/\/$/, '');
    const token = c.token || c.access_token;
    if (!instance || !token) return { platform: 'mastodon', ok: false, error: 'Needs instance + token.' };
    const res = await fetch(`${instance}/api/v1/statuses`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: text.slice(0, 500) }),
    });
    if (!res.ok) return { platform: 'mastodon', ok: false, error: `${res.status}` };
    const d = await res.json();
    return { platform: 'mastodon', ok: true, url: d.url };
}

async function browserDiscord(text: string, c: any) {
    const webhook = c.webhook || c.webhook_url || localStorage.getItem('echo_discord_webhook');
    if (!webhook) return { platform: 'discord', ok: false, error: 'Needs webhook URL.' };
    const res = await fetch(webhook, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'Echo', content: text.slice(0, 2000) }),
    });
    return res.ok ? { platform: 'discord', ok: true } : { platform: 'discord', ok: false, error: `${res.status}` };
}

async function browserPost(platforms: string[], text: string): Promise<any> {
    const creds = getAllCreds();
    const results: any[] = [];
    for (const p of platforms) {
        const c = creds[p] || {};
        if (p === 'bluesky') results.push(await browserBluesky(text, c).catch(e => ({ platform: p, ok: false, error: e.message })));
        else if (p === 'mastodon') results.push(await browserMastodon(text, c).catch(e => ({ platform: p, ok: false, error: e.message })));
        else if (p === 'discord') results.push(await browserDiscord(text, c).catch(e => ({ platform: p, ok: false, error: e.message })));
        else results.push({ platform: p, ok: false, error: 'Echo Core required for this platform (CORS). Start Echo Core to post here.' });
    }
    const succeeded = results.filter(r => r.ok).length;
    return { success: succeeded > 0, succeeded, failed: results.length - succeeded, results };
}

// ── Tool declarations ─────────────────────────────────────────────────────────

const postDeclaration: FunctionDeclaration = {
    name: 'post_to_social',
    description:
        'Post a message to one or many social networks at once (Bluesky, Mastodon, Twitter/X, LinkedIn, Threads, Facebook, Discord). This is the Social Autopilot — use it to publish announcements, updates, threads, or repurposed content everywhere simultaneously. Posting runs through Echo Core so it works even where browsers are normally blocked. Connect accounts first with save_social_credentials.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            platforms: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Platforms to post to: any of bluesky, mastodon, twitter, linkedin, threads, facebook, discord. Use ["all"] to post to every connected account.',
            },
            text: { type: Type.STRING, description: 'The post text. Will be auto-truncated per platform (e.g. 280 for Twitter).' },
            link: { type: Type.STRING, description: 'Optional URL appended to the post.' },
            image_url: { type: Type.STRING, description: 'Optional image URL (where the platform supports it).' },
        },
        required: ['platforms', 'text'],
    },
};

const saveCredsDeclaration: FunctionDeclaration = {
    name: 'save_social_credentials',
    description:
        'Connect a social account so Echo can post to it. Stores credentials locally and mirrors them to Echo Core for autonomous posting. Required fields per platform — bluesky: handle, app_password (from bsky.app → Settings → App Passwords). mastodon: instance, token. twitter: access_token (OAuth2 user token). linkedin: access_token, urn. threads: user_id, access_token. facebook: page_id, access_token. discord: webhook.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            platform: { type: Type.STRING, description: 'One of: bluesky, mastodon, twitter, linkedin, threads, facebook, discord.' },
            handle: { type: Type.STRING, description: 'Bluesky handle (e.g. you.bsky.social).' },
            app_password: { type: Type.STRING, description: 'Bluesky app password (xxxx-xxxx-xxxx-xxxx).' },
            instance: { type: Type.STRING, description: 'Mastodon instance URL (e.g. https://mastodon.social).' },
            token: { type: Type.STRING, description: 'Mastodon access token.' },
            access_token: { type: Type.STRING, description: 'OAuth access token (twitter/linkedin/threads/facebook).' },
            urn: { type: Type.STRING, description: 'LinkedIn author URN (urn:li:person:XXXX).' },
            user_id: { type: Type.STRING, description: 'Threads user id.' },
            page_id: { type: Type.STRING, description: 'Facebook page id.' },
            webhook: { type: Type.STRING, description: 'Discord webhook URL.' },
        },
        required: ['platform'],
    },
};

const listAccountsDeclaration: FunctionDeclaration = {
    name: 'list_social_accounts',
    description: 'List which social platforms currently have credentials connected and ready to post.',
    parameters: { type: Type.OBJECT, properties: {} },
};

const scheduleDeclaration: FunctionDeclaration = {
    name: 'schedule_social_post',
    description:
        'Schedule a social post to publish automatically on a recurring schedule via Echo Core missions (works while the browser is closed). Creates an autonomous mission. Use for daily updates, recurring promos, scheduled announcements.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            name: { type: Type.STRING, description: 'A name for this scheduled post (e.g. "Daily build-in-public update").' },
            platforms: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Platforms to post to, or ["all"].' },
            text: { type: Type.STRING, description: 'The post text to publish each time.' },
            cron: { type: Type.STRING, description: 'Cron schedule "min hour dom month dow". e.g. "0 9 * * *" = daily 9am, "0 12 * * 1" = Mondays noon.' },
        },
        required: ['name', 'platforms', 'text', 'cron'],
    },
};

// ── Skill ─────────────────────────────────────────────────────────────────────

function normalizePlatforms(input: any): string[] {
    if (input === 'all' || (Array.isArray(input) && input.includes('all'))) return [...ALL_PLATFORMS];
    if (Array.isArray(input)) return input.map(p => String(p).toLowerCase());
    if (typeof input === 'string') return [input.toLowerCase()];
    return [];
}

export const socialSkill: Skill = {
    name: 'socialSkill',
    description: 'Social Autopilot — post to Bluesky, Mastodon, Twitter/X, LinkedIn, Threads, Facebook, and Discord from one place; connect accounts; and schedule recurring posts. Replaces Buffer/Hootsuite/Postiz.',
    tools: [postDeclaration, saveCredsDeclaration, listAccountsDeclaration, scheduleDeclaration],

    execute: async (toolName: string, args: any) => {
        if (toolName === 'save_social_credentials') {
            const platform = String(args.platform || '').toLowerCase();
            if (!ALL_PLATFORMS.includes(platform)) {
                return { error: `Unknown platform "${platform}". Supported: ${ALL_PLATFORMS.join(', ')}.` };
            }
            const { platform: _p, ...fields } = args;
            const creds = Object.fromEntries(Object.entries(fields).filter(([, v]) => v != null && v !== ''));
            setPlatformCreds(platform, creds);
            // Mirror to Core for autonomous missions (fire-and-forget).
            if (isCoreConnected()) { coreSaveSocialCreds({ [platform]: creds }).catch(() => {}); }
            return { success: true, platform, message: `${platform} connected. Echo can now post there${isCoreConnected() ? ' (synced to Core for autonomous posting)' : ''}.` };
        }

        if (toolName === 'list_social_accounts') {
            const local = Object.keys(getAllCreds());
            if (isCoreConnected()) {
                const r = await coreListSocialAccounts();
                if (r.ok) return { connected: r.connected, source: 'core', localOnly: local.filter(p => !(r.connected || []).includes(p)) };
            }
            return { connected: local, source: 'local', note: isCoreConnected() ? undefined : 'Echo Core offline — autonomous posting unavailable until it connects.' };
        }

        if (toolName === 'post_to_social') {
            const platforms = normalizePlatforms(args.platforms);
            const text = String(args.text || '').trim();
            if (!text) return { error: 'No post text provided.' };
            if (!platforms.length) return { error: 'No platforms specified. Use e.g. ["twitter","bluesky"] or ["all"].' };

            if (isCoreConnected()) {
                const r = await coreSocialPost(platforms, { text, link: args.link, image_url: args.image_url }, getAllCreds());
                if (r.ok) {
                    return { success: true, succeeded: r.succeeded, failed: r.failed, results: r.results, message: `Posted to ${r.succeeded}/${(r.results || []).length} platform(s).` };
                }
                return { error: r.error || 'Core post failed.' };
            }

            // Offline fallback — only CORS-friendly networks
            const friendly = platforms.filter(p => BROWSER_OK.has(p));
            const blocked = platforms.filter(p => !BROWSER_OK.has(p));
            if (!friendly.length) {
                return { error: `Echo Core is offline. ${blocked.join(', ')} need Core to post (browser CORS). Start Echo Core, or post to Bluesky/Mastodon/Discord which work offline.` };
            }
            const out = await browserPost(friendly, args.link ? `${text}\n\n${args.link}` : text);
            if (blocked.length) out.note = `Skipped ${blocked.join(', ')} — start Echo Core to post there.`;
            return out;
        }

        if (toolName === 'schedule_social_post') {
            if (!isCoreConnected()) {
                return { error: 'Scheduling requires Echo Core (it runs missions while the browser is closed). Start Echo Core and pair it first.' };
            }
            const platforms = normalizePlatforms(args.platforms);
            const mission = {
                name: String(args.name || 'Scheduled social post'),
                description: `Auto-post to ${platforms.join(', ')}`,
                cron: String(args.cron || ''),
                enabled: true,
                steps: [{ tool: 'post_to_social', description: `Post to ${platforms.join(', ')}`, args: { platforms, text: String(args.text || '') } }],
            };
            const r = await coreSaveMission(mission);
            if (r.ok) return { success: true, missionId: r.mission?.id, message: `Scheduled "${mission.name}" (${mission.cron}). It will post to ${platforms.join(', ')} automatically.` };
            return { error: r.error || 'Failed to schedule.' };
        }

        return { error: `Unknown tool: ${toolName}` };
    },
};

export default socialSkill;
