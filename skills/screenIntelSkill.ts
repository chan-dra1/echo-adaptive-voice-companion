/**
 * screenIntelSkill.ts
 *
 * Screen-share intelligence. The Gemini Live model already sees screen frames
 * (App.tsx → geminiLiveService → 2 FPS captureAndSendFrame). This skill
 * orchestrates intent + fetches richer metadata for known platforms (YouTube,
 * TikTok, X/Twitter, Reels, Vimeo, generic web pages).
 *
 * Tools:
 *   - describe_current_screen   intent hint for visual reasoning on latest frames
 *   - extract_video_metadata    oEmbed + page-scrape for known video/social URLs
 *   - summarize_media           LLM TL;DR from URL or transcript (cheap model via costPolicy)
 *
 * No new dependencies. CORS proxy = api.allorigins.win (already used by webSkill).
 */

import { FunctionDeclaration, Type } from "@google/genai";
import { Skill, agentSkillService } from "../services/agentSkillService";
import { chat as llmChat, hasKeyFor } from "../services/llmRouter";
import { pickCheapModel, tokenBudget, temperatureFor } from "../services/costPolicy";
import { responseCache } from "../services/responseCache";

// ─────────────────────────────────────────────────────────────────────────────
// Screen-share state signal (set from App.tsx on toggle).
// The skill uses it to confirm to the agent that vision is available.
// ─────────────────────────────────────────────────────────────────────────────

let screenShareActive = false;
export function setScreenShareActive(active: boolean) {
    screenShareActive = active;
}
export function isScreenShareActive() {
    return screenShareActive;
}

/**
 * Event the skill fires when extract_video_metadata succeeds.
 * App.tsx listens and shows a short SCREEN_READ_LINK badge.
 */
export interface ScreenReadEventDetail {
    source: string;
    title?: string;
    url: string;
}
export const SCREEN_READ_EVENT = "echo:screen-read";
function dispatchScreenRead(detail: ScreenReadEventDetail) {
    try {
        if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent<ScreenReadEventDetail>(SCREEN_READ_EVENT, { detail }));
        }
    } catch { /* no-op */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Networking helpers
// ─────────────────────────────────────────────────────────────────────────────

const PROXY = "https://api.allorigins.win/raw?url=";
const PROXY_JSON = "https://api.allorigins.win/get?url=";

async function fetchWithTimeout(url: string, ms = 8000, init?: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
        return await fetch(url, { ...(init || {}), signal: ctrl.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function fetchTextRetry(url: string, ms = 8000, retries = 1): Promise<string> {
    let lastErr: any;
    for (let i = 0; i <= retries; i++) {
        try {
            const r = await fetchWithTimeout(url, ms);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return await r.text();
        } catch (e) {
            lastErr = e;
        }
    }
    throw lastErr || new Error("fetch failed");
}

async function fetchJsonRetry<T = any>(url: string, ms = 8000, retries = 1): Promise<T> {
    let lastErr: any;
    for (let i = 0; i <= retries; i++) {
        try {
            const r = await fetchWithTimeout(url, ms);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return await r.json();
        } catch (e) {
            lastErr = e;
        }
    }
    throw lastErr || new Error("fetch failed");
}

// ─────────────────────────────────────────────────────────────────────────────
// URL detection
// ─────────────────────────────────────────────────────────────────────────────

type Source = "youtube" | "tiktok" | "twitter" | "instagram" | "vimeo" | "generic";

function detectSource(url: string): Source {
    try {
        const u = new URL(url);
        const host = u.hostname.replace(/^www\./, "").toLowerCase();
        if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be" || host.endsWith(".youtube.com")) return "youtube";
        if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
        if (host === "twitter.com" || host === "x.com" || host.endsWith(".twitter.com") || host.endsWith(".x.com")) return "twitter";
        if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
        if (host === "vimeo.com" || host.endsWith(".vimeo.com")) return "vimeo";
        return "generic";
    } catch {
        return "generic";
    }
}

function extractOgTags(html: string): Record<string, string> {
    const tags: Record<string, string> = {};
    const re = /<meta[^>]+(property|name)\s*=\s*["']([^"']+)["'][^>]+content\s*=\s*["']([^"']*)["'][^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
        const key = m[2].toLowerCase();
        if (!(key in tags)) tags[key] = decodeHtmlEntities(m[3]);
    }
    // Also handle reversed attribute order
    const re2 = /<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+(property|name)\s*=\s*["']([^"']+)["'][^>]*>/gi;
    while ((m = re2.exec(html)) !== null) {
        const key = m[3].toLowerCase();
        if (!(key in tags)) tags[key] = decodeHtmlEntities(m[1]);
    }
    return tags;
}

function decodeHtmlEntities(s: string): string {
    return s
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&#(\d+);/g, (_, n) => {
            try { return String.fromCodePoint(Number(n)); } catch { return ""; }
        });
}

function stripTags(html: string): string {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function youtubeId(url: string): string | null {
    try {
        const u = new URL(url);
        if (u.hostname.includes("youtu.be")) return u.pathname.slice(1).split("/")[0] || null;
        if (u.searchParams.get("v")) return u.searchParams.get("v");
        const m = u.pathname.match(/\/(?:embed|shorts|live)\/([\w-]{6,})/);
        if (m) return m[1];
        return null;
    } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-source extractors
// ─────────────────────────────────────────────────────────────────────────────

async function extractYouTube(url: string): Promise<any> {
    const out: any = { source: "youtube", url };
    const errors: string[] = [];
    const id = youtubeId(url);

    // oEmbed (CORS-friendly)
    try {
        const oeUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
        const oe = await fetchJsonRetry(oeUrl, 6000, 1);
        out.title = oe?.title;
        out.author = oe?.author_name;
        out.thumbnail = oe?.thumbnail_url;
    } catch (e: any) {
        errors.push(`oembed: ${e?.message || e}`);
    }

    // Watch page via CORS proxy → shortDescription, lengthSeconds, captionTracks
    try {
        const pageUrl = id ? `https://www.youtube.com/watch?v=${id}` : url;
        const html = await fetchTextRetry(PROXY + encodeURIComponent(pageUrl), 9000, 1);

        const desc = html.match(/"shortDescription":"((?:\\.|[^"\\])*)"/);
        if (desc) {
            try { out.description = JSON.parse(`"${desc[1]}"`); } catch { out.description = desc[1]; }
        }
        const len = html.match(/"lengthSeconds":"(\d+)"/);
        if (len) out.durationSec = Number(len[1]);

        const tracksMatch = html.match(/"captionTracks":(\[[\s\S]*?\])/);
        if (tracksMatch) {
            try {
                const raw = tracksMatch[1].replace(/\\u0026/g, "&");
                const tracks = JSON.parse(raw);
                if (Array.isArray(tracks) && tracks.length) {
                    out.captions_available = tracks.map((t: any) => ({
                        lang: t.languageCode,
                        name: t.name?.simpleText || t.name?.runs?.[0]?.text,
                        kind: t.kind,
                    }));
                    const first = tracks.find((t: any) => t.languageCode === "en") || tracks[0];
                    if (first?.baseUrl) {
                        try {
                            const capXml = await fetchTextRetry(PROXY + encodeURIComponent(first.baseUrl), 9000, 1);
                            out.transcript = xmlCaptionsToText(capXml).slice(0, 20000);
                        } catch (e: any) {
                            errors.push(`captions: ${e?.message || e}`);
                        }
                    }
                }
            } catch (e: any) {
                errors.push(`captions parse: ${e?.message || e}`);
            }
        }
    } catch (e: any) {
        errors.push(`watch page: ${e?.message || e}`);
    }

    if (errors.length) out.partial_errors = errors;
    out.raw = { id };
    return out;
}

function xmlCaptionsToText(xml: string): string {
    const out: string[] = [];
    const re = /<(?:p|text)[^>]*>([\s\S]*?)<\/(?:p|text)>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
        const text = decodeHtmlEntities(stripTags(m[1])).trim();
        if (text) out.push(text);
    }
    return out.join(" ").replace(/\s+/g, " ").trim();
}

async function extractTikTok(url: string): Promise<any> {
    const out: any = { source: "tiktok", url };
    const errors: string[] = [];
    try {
        const oeUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
        const oe = await fetchJsonRetry(oeUrl, 6000, 1);
        out.title = oe?.title;
        out.author = oe?.author_name;
        out.thumbnail = oe?.thumbnail_url;
        out.description = oe?.title;
        out.raw = oe;
    } catch (e: any) {
        errors.push(`oembed: ${e?.message || e}`);
    }
    // Optional richer scrape via proxy
    try {
        const html = await fetchTextRetry(PROXY + encodeURIComponent(url), 9000, 1);
        const og = extractOgTags(html);
        if (!out.title && og["og:title"]) out.title = og["og:title"];
        if (og["og:description"]) out.description = og["og:description"];
        if (og["og:video"]) out.video_url = og["og:video"];
        if (!out.thumbnail && og["og:image"]) out.thumbnail = og["og:image"];
    } catch (e: any) {
        errors.push(`page: ${e?.message || e}`);
    }
    if (errors.length) out.partial_errors = errors;
    return out;
}

async function extractTwitter(url: string): Promise<any> {
    const out: any = { source: "twitter", url };
    const errors: string[] = [];
    try {
        const oeUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=1`;
        const oe = await fetchJsonRetry(oeUrl, 6000, 1);
        out.title = oe?.author_name ? `Post by ${oe.author_name}` : undefined;
        out.author = oe?.author_name;
        if (oe?.html) out.description = stripTags(oe.html);
        out.raw = oe;
    } catch (e: any) {
        errors.push(`oembed: ${e?.message || e}`);
    }
    if (errors.length) out.partial_errors = errors;
    return out;
}

async function extractInstagram(url: string): Promise<any> {
    const out: any = { source: "instagram", url };
    const errors: string[] = [];
    try {
        const html = await fetchTextRetry(PROXY + encodeURIComponent(url), 9000, 1);
        const og = extractOgTags(html);
        out.title = og["og:title"];
        out.description = og["og:description"];
        out.thumbnail = og["og:image"];
        if (og["og:video"]) out.video_url = og["og:video"];
        out.raw = { og_count: Object.keys(og).length };
    } catch (e: any) {
        errors.push(`page: ${e?.message || e}`);
    }
    out.note = "Instagram metadata is limited without an API token; relying on OpenGraph tags.";
    if (errors.length) out.partial_errors = errors;
    return out;
}

async function extractVimeo(url: string): Promise<any> {
    const out: any = { source: "vimeo", url };
    const errors: string[] = [];
    try {
        const oeUrl = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`;
        const oe = await fetchJsonRetry(oeUrl, 6000, 1);
        out.title = oe?.title;
        out.author = oe?.author_name;
        out.thumbnail = oe?.thumbnail_url;
        out.description = oe?.description;
        out.durationSec = oe?.duration;
        out.raw = oe;
    } catch (e: any) {
        errors.push(`oembed: ${e?.message || e}`);
    }
    if (errors.length) out.partial_errors = errors;
    return out;
}

async function extractGeneric(url: string): Promise<any> {
    const out: any = { source: "generic", url };
    try {
        // Reuse webSkill via agentSkillService so we don't duplicate fetch logic.
        const res = await agentSkillService.executeTool("read_webpage", { url });
        const text = typeof res === "string" ? res : (res?.text || JSON.stringify(res));
        out.body_text = text.slice(0, 20000);
        // Also try OG tags from a separate raw fetch
        try {
            const html = await fetchTextRetry(PROXY + encodeURIComponent(url), 9000, 1);
            const og = extractOgTags(html);
            out.title = og["og:title"] || og["twitter:title"];
            out.description = og["og:description"] || og["twitter:description"];
            out.thumbnail = og["og:image"] || og["twitter:image"];
        } catch { /* og fetch optional */ }
    } catch (e: any) {
        out.error = `Failed to read page: ${e?.message || e}`;
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Summarize via cheapest available LLM (cached)
// ─────────────────────────────────────────────────────────────────────────────

async function summarizeMedia(opts: { url?: string; transcript?: string; focus?: string }): Promise<any> {
    const { url, transcript, focus } = opts;
    let material = transcript || "";
    let resolvedUrl = url;

    if (!material && url) {
        const meta = await extractByUrl(url);
        material = meta?.transcript || meta?.description || meta?.body_text || meta?.title || "";
        if (!material) {
            return {
                error: "No transcript / description available to summarize.",
                metadata: meta,
            };
        }
        resolvedUrl = url;
    }

    if (!material) {
        return { error: "Provide either a url or a transcript to summarize." };
    }

    const cacheKey = `media_summary:${resolvedUrl || ("h:" + djb2(material))}:${focus || ""}`;
    const cached = responseCache.get(cacheKey);
    if (cached) {
        try { return JSON.parse(cached); } catch { /* fall through */ }
    }

    const pick = pickCheapModel("summarize");
    if (!hasKeyFor(pick.provider)) {
        // No keys configured anywhere — return the raw material instead of failing.
        return {
            summary: null,
            note: "No LLM key available; returning raw material for caller to summarize.",
            material: material.slice(0, 4000),
        };
    }

    const focusLine = focus ? `Reader focus: ${focus}.` : "";
    const sys = "You are a concise multimedia summarizer. Output ONLY valid JSON with keys: tldr (string), bullets (array of 5 strings), key_timestamps (array of {time,note} — empty if no timestamps), takeaways (array of strings). No markdown.";
    const user = `${focusLine}\nSource: ${resolvedUrl || "transcript"}\n\nMATERIAL:\n${material.slice(0, 12000)}`;

    try {
        const result = await llmChat({
            provider: pick.provider,
            model: pick.model,
            messages: [
                { role: "system", content: sys },
                { role: "user", content: user },
            ],
            json: true,
            temperature: temperatureFor("summarize"),
            maxTokens: tokenBudget("summarize"),
        });
        let parsed: any = null;
        try { parsed = JSON.parse(result.text); } catch { /* keep raw */ }
        const out = {
            url: resolvedUrl,
            focus,
            provider: result.provider,
            model: result.model,
            summary: parsed || { tldr: result.text, bullets: [], key_timestamps: [], takeaways: [] },
        };
        responseCache.set(cacheKey, JSON.stringify(out), 10 * 60 * 1000);
        return out;
    } catch (e: any) {
        return { error: `Summarize failed: ${e?.message || e}` };
    }
}

function djb2(s: string): string {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
    return (h >>> 0).toString(36);
}

async function extractByUrl(url: string): Promise<any> {
    if (!url || typeof url !== "string") throw new Error("Invalid url");
    const src = detectSource(url);
    let meta: any;
    switch (src) {
        case "youtube": meta = await extractYouTube(url); break;
        case "tiktok": meta = await extractTikTok(url); break;
        case "twitter": meta = await extractTwitter(url); break;
        case "instagram": meta = await extractInstagram(url); break;
        case "vimeo": meta = await extractVimeo(url); break;
        default: meta = await extractGeneric(url); break;
    }
    if (meta && !meta.error) {
        dispatchScreenRead({ source: meta.source || src, title: meta.title, url });
    }
    return meta;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool declarations
// ─────────────────────────────────────────────────────────────────────────────

const describeCurrentScreenDecl: FunctionDeclaration = {
    name: "describe_current_screen",
    description: "Use this when the user is screen-sharing and asks about what is on screen (e.g. 'what's this reel about', 'summarize this video', 'read this article'). Returns an instruction string telling YOU to describe the latest image frame(s) you can already see in this conversation. Combine with extract_video_metadata if a URL is identifiable.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            focus: { type: Type.STRING, description: "Optional focus, e.g. 'caption', 'people on screen', 'code', 'product price'." },
        },
    },
};

const extractVideoMetadataDecl: FunctionDeclaration = {
    name: "extract_video_metadata",
    description: "Fetch title/author/description/duration/captions for a video or social post URL. Supports YouTube, TikTok, X/Twitter, Instagram Reels, Vimeo, and a generic web-page fallback (OpenGraph). YouTube returns transcript when captions are available.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            url: { type: Type.STRING, description: "The URL to a video / reel / short / post." },
        },
        required: ["url"],
    },
};

const summarizeMediaDecl: FunctionDeclaration = {
    name: "summarize_media",
    description: "Produce a structured TL;DR (bullets, key timestamps, takeaways) from a URL or a raw transcript using a cheap LLM. Cached for 10 minutes per (url|hash(transcript), focus).",
    parameters: {
        type: Type.OBJECT,
        properties: {
            url: { type: Type.STRING, description: "Optional URL. If provided, extracts metadata/transcript first." },
            transcript: { type: Type.STRING, description: "Optional raw transcript/text to summarize directly." },
            focus: { type: Type.STRING, description: "Optional focus, e.g. 'main argument', 'tutorial steps'." },
        },
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Skill
// ─────────────────────────────────────────────────────────────────────────────

export const screenIntelSkill: Skill = {
    name: "screenIntelSkill",
    description: "Screen-share intelligence: describe what's on screen using vision + fetch richer metadata/transcripts for known video/social URLs, and summarize them cheaply.",
    tools: [describeCurrentScreenDecl, extractVideoMetadataDecl, summarizeMediaDecl],
    execute: async (toolName, args) => {
        try {
            switch (toolName) {
                case "describe_current_screen": {
                    const focus = args?.focus ? String(args.focus) : undefined;
                    const focusClause = focus ? ` focused on ${focus}` : "";
                    return {
                        screen_share_active: isScreenShareActive(),
                        instruction:
                            `Use the latest image frame in this conversation to answer in 3-5 short bullets${focusClause}. ` +
                            `Describe exactly what is visible (UI, text, captions, product, post content) — do NOT invent details. ` +
                            `If you can identify a URL on screen, also call extract_video_metadata and summarize_media for richer captions/transcript-based answers, then combine vision + metadata.`,
                    };
                }
                case "extract_video_metadata": {
                    const url = String(args?.url ?? "");
                    if (!url) return { error: "url is required" };
                    return await extractByUrl(url);
                }
                case "summarize_media": {
                    return await summarizeMedia({
                        url: args?.url ? String(args.url) : undefined,
                        transcript: args?.transcript ? String(args.transcript) : undefined,
                        focus: args?.focus ? String(args.focus) : undefined,
                    });
                }
                default:
                    return { error: `Tool not found: ${toolName}` };
            }
        } catch (e: any) {
            return { error: e?.message || String(e) };
        }
    },
};

export default screenIntelSkill;
