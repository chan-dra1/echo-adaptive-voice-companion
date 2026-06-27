/**
 * socialPoster.mjs — One server-side posting layer for every social platform.
 *
 * Runs inside Echo Core (Node.js), so it sidesteps the browser CORS walls that
 * block Twitter/LinkedIn/Threads/Facebook from the web app. Both the web
 * dashboard (via the sync hub's `social_post` action) and autonomous missions
 * (via the missionRunner `post_to_social` step) call through here, so there's a
 * single source of truth for how each network is posted to.
 *
 * Supported: bluesky · mastodon · twitter/x · linkedin · threads · facebook · discord
 *
 * Credentials live in ~/.echo-core/social.json (per platform). The web can push
 * them there via save_social_credentials, OR pass them inline per request
 * (inline creds win). Autonomous missions read straight from the file.
 *
 * social.json shape:
 * {
 *   "twitter":  { "access_token": "..." },
 *   "bluesky":  { "handle": "you.bsky.social", "app_password": "xxxx-xxxx-xxxx-xxxx" },
 *   "mastodon": { "instance": "https://mastodon.social", "token": "..." },
 *   "linkedin": { "access_token": "...", "urn": "urn:li:person:XXXX" },
 *   "threads":  { "user_id": "...", "access_token": "..." },
 *   "facebook": { "page_id": "...", "access_token": "..." },
 *   "discord":  { "webhook": "https://discord.com/api/webhooks/..." }
 * }
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();
const CORE_DIR = path.join(HOME, '.echo-core');
const SOCIAL_FILE = path.join(CORE_DIR, 'social.json');

export const SOCIAL_PLATFORMS = ['bluesky', 'mastodon', 'twitter', 'linkedin', 'threads', 'facebook', 'discord'];

// ── Credential storage ────────────────────────────────────────────────────────

export async function loadSocialCreds() {
    try {
        return JSON.parse(await readFile(SOCIAL_FILE, 'utf8'));
    } catch {
        return {};
    }
}

/** Merge a partial creds object into social.json (deep per-platform merge). */
export async function saveSocialCreds(partial) {
    await mkdir(CORE_DIR, { recursive: true });
    const current = await loadSocialCreds();
    const merged = { ...current };
    for (const [platform, creds] of Object.entries(partial || {})) {
        merged[platform] = { ...(current[platform] || {}), ...creds };
    }
    await writeFile(SOCIAL_FILE, JSON.stringify(merged, null, 2), { mode: 0o600 });
    return merged;
}

/** Which platforms currently have credentials configured. */
export async function connectedPlatforms() {
    const creds = await loadSocialCreds();
    return SOCIAL_PLATFORMS.filter(p => creds[p] && Object.keys(creds[p]).length > 0);
}

// ── Per-platform posters ──────────────────────────────────────────────────────
// Each returns { ok, url?, id?, error? }

async function postBluesky(text, creds) {
    const identifier = creds.handle || creds.identifier;
    const password = creds.app_password || creds.password;
    if (!identifier || !password) return { ok: false, error: 'Bluesky needs handle + app_password.' };

    const sessRes = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
    });
    if (!sessRes.ok) return { ok: false, error: `Bluesky auth ${sessRes.status}: ${(await sessRes.text()).slice(0, 150)}` };
    const sess = await sessRes.json();

    const record = {
        $type: 'app.bsky.feed.post',
        text: text.slice(0, 300),
        createdAt: new Date().toISOString(),
    };
    const postRes = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
        method: 'POST',
        headers: { Authorization: `Bearer ${sess.accessJwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: sess.did, collection: 'app.bsky.feed.post', record }),
    });
    if (!postRes.ok) return { ok: false, error: `Bluesky post ${postRes.status}: ${(await postRes.text()).slice(0, 150)}` };
    const data = await postRes.json();
    const rkey = (data.uri || '').split('/').pop();
    return { ok: true, id: data.uri, url: rkey ? `https://bsky.app/profile/${identifier}/post/${rkey}` : undefined };
}

async function postMastodon(text, creds) {
    const instance = (creds.instance || '').replace(/\/$/, '');
    const token = creds.token || creds.access_token;
    if (!instance || !token) return { ok: false, error: 'Mastodon needs instance + token.' };
    const res = await fetch(`${instance}/api/v1/statuses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: text.slice(0, 500) }),
    });
    if (!res.ok) return { ok: false, error: `Mastodon ${res.status}: ${(await res.text()).slice(0, 150)}` };
    const data = await res.json();
    return { ok: true, id: data.id, url: data.url };
}

async function postTwitter(text, creds) {
    const token = creds.access_token || creds.token;
    if (!token) return { ok: false, error: 'Twitter needs access_token (OAuth 2.0 user token).' };
    const res = await fetch('https://api.twitter.com/2/tweets', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.slice(0, 280) }),
    });
    if (!res.ok) return { ok: false, error: `Twitter ${res.status}: ${(await res.text()).slice(0, 150)}` };
    const data = await res.json();
    const id = data?.data?.id;
    return { ok: true, id, url: id ? `https://twitter.com/i/web/status/${id}` : undefined };
}

async function postLinkedIn(text, creds) {
    const token = creds.access_token || creds.token;
    const urn = creds.urn || creds.author;
    if (!token || !urn) return { ok: false, error: 'LinkedIn needs access_token + urn (urn:li:person:XXXX).' };
    const body = {
        author: urn,
        lifecycleState: 'PUBLISHED',
        specificContent: {
            'com.linkedin.ugc.ShareContent': {
                shareCommentary: { text: text.slice(0, 3000) },
                shareMediaCategory: 'NONE',
            },
        },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    };
    const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, error: `LinkedIn ${res.status}: ${(await res.text()).slice(0, 150)}` };
    const id = res.headers.get('x-restli-id') || (await res.json().catch(() => ({})))?.id;
    return { ok: true, id, url: id ? `https://www.linkedin.com/feed/update/${id}` : undefined };
}

async function postThreads(text, creds) {
    const userId = creds.user_id;
    const token = creds.access_token || creds.token;
    if (!userId || !token) return { ok: false, error: 'Threads needs user_id + access_token.' };
    // Step 1: create a text container
    const createUrl = `https://graph.threads.net/v1.0/${userId}/threads?media_type=TEXT&text=${encodeURIComponent(text.slice(0, 500))}&access_token=${encodeURIComponent(token)}`;
    const createRes = await fetch(createUrl, { method: 'POST' });
    if (!createRes.ok) return { ok: false, error: `Threads create ${createRes.status}: ${(await createRes.text()).slice(0, 150)}` };
    const { id: creationId } = await createRes.json();
    // Step 2: publish it
    const pubUrl = `https://graph.threads.net/v1.0/${userId}/threads_publish?creation_id=${creationId}&access_token=${encodeURIComponent(token)}`;
    const pubRes = await fetch(pubUrl, { method: 'POST' });
    if (!pubRes.ok) return { ok: false, error: `Threads publish ${pubRes.status}: ${(await pubRes.text()).slice(0, 150)}` };
    const data = await pubRes.json();
    return { ok: true, id: data.id };
}

async function postFacebook(text, creds) {
    const pageId = creds.page_id;
    const token = creds.access_token || creds.page_token || creds.token;
    if (!pageId || !token) return { ok: false, error: 'Facebook needs page_id + access_token (page token).' };
    const url = `https://graph.facebook.com/${pageId}/feed`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, access_token: token }),
    });
    if (!res.ok) return { ok: false, error: `Facebook ${res.status}: ${(await res.text()).slice(0, 150)}` };
    const data = await res.json();
    return { ok: true, id: data.id, url: data.id ? `https://facebook.com/${data.id}` : undefined };
}

async function postDiscord(text, creds) {
    const webhook = creds.webhook || creds.webhook_url;
    if (!webhook) return { ok: false, error: 'Discord needs a webhook URL.' };
    const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'Echo', content: text.slice(0, 2000) }),
    });
    return res.ok ? { ok: true } : { ok: false, error: `Discord ${res.status}: ${(await res.text()).slice(0, 150)}` };
}

const POSTERS = {
    bluesky: postBluesky,
    mastodon: postMastodon,
    twitter: postTwitter,
    x: postTwitter,
    linkedin: postLinkedIn,
    threads: postThreads,
    facebook: postFacebook,
    discord: postDiscord,
};

// ── Public: post to one or many platforms ─────────────────────────────────────

/**
 * @param platforms  array of platform names, or 'all' (= every platform with creds)
 * @param content    { text, link?, imageUrl? }
 * @param inlineCreds optional { platform: {…} } overrides (from web localStorage)
 */
export async function postToSocial(platforms, content, inlineCreds = {}) {
    const fileCreds = await loadSocialCreds();
    let text = String(content.text || '').trim();
    if (content.link) text += `\n\n${content.link}`;

    let targets;
    if (platforms === 'all' || (Array.isArray(platforms) && platforms.includes('all'))) {
        const have = new Set([...Object.keys(fileCreds), ...Object.keys(inlineCreds)]);
        targets = SOCIAL_PLATFORMS.filter(p => have.has(p));
    } else {
        targets = (Array.isArray(platforms) ? platforms : [platforms]).map(p => String(p).toLowerCase());
    }

    if (!targets.length) return { results: [], succeeded: 0, failed: 0, error: 'No platforms specified or connected.' };

    const results = [];
    for (const platform of targets) {
        const poster = POSTERS[platform];
        if (!poster) { results.push({ platform, ok: false, error: `Unsupported platform: ${platform}` }); continue; }
        const creds = { ...(fileCreds[platform] || {}), ...(inlineCreds[platform] || {}) };
        try {
            const r = await poster(text, creds);
            results.push({ platform, ...r });
        } catch (e) {
            results.push({ platform, ok: false, error: e.message });
        }
    }

    const succeeded = results.filter(r => r.ok).length;
    return { results, succeeded, failed: results.length - succeeded };
}
