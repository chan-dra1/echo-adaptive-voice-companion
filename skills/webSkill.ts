import { FunctionDeclaration, Type } from "@google/genai";
import { Skill } from "../services/agentSkillService";

export const readWebpageToolDeclaration: FunctionDeclaration = {
    name: "read_webpage",
    description: "Read the textual content of a webpage from a URL. Useful for reading job descriptions, articles, or documentation.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            url: { type: Type.STRING, description: "The URL of the webpage to read." }
        },
        required: ["url"]
    }
};

export const browseWebsiteToolDeclaration: FunctionDeclaration = {
    name: "browse_website",
    description:
        "Crawl a whole website starting from one URL: follows same-site links and reads the text content, headings, nav " +
        "links, and image count of each page it visits. Use this instead of read_webpage when asked to review or " +
        "understand a whole site, not just one page. IMPORTANT LIMITATION: this reads HTML/text only — it does NOT " +
        "capture visual layout, screenshots, colors, or how the page actually looks rendered. If asked about visual " +
        "design/UI look-and-feel specifically, say plainly that you can only read structure and content, not see pixels.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            url: { type: Type.STRING, description: "The starting URL to crawl." },
            maxPages: { type: Type.NUMBER, description: "Max pages to visit including the start page. Default 5, capped at 10." },
        },
        required: ["url"],
    },
};

export const mapWebsiteToolDeclaration: FunctionDeclaration = {
    name: "map_website",
    description:
        "Discover the STRUCTURE of a website — every page URL and title — WITHOUT reading full page content. " +
        "Handles large sites (hundreds of pages) cheaply by reading sitemap.xml when available, falling back to " +
        "crawling links. ALWAYS use this FIRST on a site you don't know, then pick the handful of pages that matter " +
        "and read those with browse_website. Reading 100 pages of full text directly would blow the context window; " +
        "this returns just the map so you can choose.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            url: { type: Type.STRING, description: "Any URL on the site (usually the homepage)." },
            maxUrls: { type: Type.NUMBER, description: "Max URLs to return. Default 100, capped at 500." },
        },
        required: ["url"],
    },
};

export const screenshotPageToolDeclaration: FunctionDeclaration = {
    name: "screenshot_page",
    description:
        "Capture a VISUAL screenshot of a webpage and actually look at it. Use this — not browse_website — when asked " +
        "about visual design, layout, UI/UX, colors, spacing, or 'how does this look'. browse_website only reads HTML " +
        "text and genuinely cannot see the rendering. Set width to 390 to check the mobile layout, 1280 for desktop. " +
        "Requires a screenshot provider configured in Settings (or Echo Core with a headless browser).",
    parameters: {
        type: Type.OBJECT,
        properties: {
            url: { type: Type.STRING, description: "URL of the page to capture." },
            width: { type: Type.NUMBER, description: "Viewport width px. 1280 = desktop (default), 390 = mobile." },
            fullPage: { type: Type.BOOLEAN, description: "Capture the whole scrollable page (default true) vs just the viewport." },
        },
        required: ["url"],
    },
};

export const webSkill: Skill = {
    name: "webSkill",
    description: "Fetches and extracts readable text content from webpages, single-page or whole-site crawl, plus visual screenshots.",
    tools: [readWebpageToolDeclaration, browseWebsiteToolDeclaration, mapWebsiteToolDeclaration, screenshotPageToolDeclaration],

    execute: async (toolName: string, args: any): Promise<any> => {
        if (toolName === "screenshot_page") {
            const url = String(args.url || "").trim();
            if (!url) return { error: "No url provided." };
            const { captureScreenshot } = await import("../services/screenshotService");
            const shot = await captureScreenshot({
                url,
                width: Number(args.width) || 1280,
                fullPage: args.fullPage !== false,
            });
            if (!shot.ok) return { error: shot.error };
            // The __image envelope is what the tool-loop unwraps into a real
            // multimodal message part (see echoChatService) — returning raw
            // base64 as a plain string would just be unreadable text to the model.
            return {
                __image: { data: shot.data, mimeType: shot.mimeType },
                url,
                width: Number(args.width) || 1280,
                note: `Screenshot captured via ${shot.provider}. This is the actual rendered page.`,
            };
        }

        if (toolName === "map_website") {
            const startUrl = String(args.url || "").trim();
            if (!startUrl) return { error: "No url provided." };
            const maxUrls = Math.min(Math.max(1, Number(args.maxUrls) || 100), 500);

            let origin: string;
            try { origin = new URL(startUrl).origin; } catch { return { error: "Invalid URL." }; }

            const fetchVia = async (u: string) => {
                const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(u)}`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const d = await res.json();
                return d.contents as string;
            };

            // ── Strategy 1: sitemap.xml. One request can enumerate an entire
            // large site, which link-crawling would take hundreds to do.
            const collected = new Set<string>();
            const sitemapsSeen = new Set<string>();
            const readSitemap = async (sm: string, depth = 0): Promise<void> => {
                if (depth > 2 || sitemapsSeen.has(sm) || collected.size >= maxUrls) return;
                sitemapsSeen.add(sm);
                let xml: string;
                try { xml = await fetchVia(sm); } catch { return; }
                if (!xml || !xml.includes("<")) return;
                const doc = new DOMParser().parseFromString(xml, "text/xml");
                // A sitemap index points at more sitemaps; recurse into those.
                const nested = [...doc.querySelectorAll("sitemap > loc")].map(l => l.textContent?.trim()).filter(Boolean) as string[];
                for (const n of nested) await readSitemap(n, depth + 1);
                for (const l of doc.querySelectorAll("url > loc")) {
                    const href = l.textContent?.trim();
                    if (!href) continue;
                    try { if (new URL(href).origin !== origin) continue; } catch { continue; }
                    collected.add(href.split("#")[0]);
                    if (collected.size >= maxUrls) return;
                }
            };

            for (const candidate of [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`]) {
                if (collected.size >= maxUrls) break;
                await readSitemap(candidate);
            }
            const viaSitemap = collected.size > 0;

            // ── Strategy 2: breadth-first link crawl, in parallel batches.
            if (!viaSitemap) {
                const visited = new Set<string>();
                let frontier = [startUrl];
                const CONCURRENCY = 5;
                while (frontier.length && collected.size < maxUrls) {
                    const batch = frontier.splice(0, CONCURRENCY);
                    const next: string[] = [];
                    await Promise.all(batch.map(async (u) => {
                        if (visited.has(u)) return;
                        visited.add(u);
                        let html: string;
                        try { html = await fetchVia(u); } catch { return; }
                        if (!html) return;
                        collected.add(u);
                        const doc = new DOMParser().parseFromString(html, "text/html");
                        for (const a of doc.querySelectorAll("a[href]")) {
                            const href = a.getAttribute("href");
                            if (!href) continue;
                            let abs: string;
                            try { abs = new URL(href, u).href.split("#")[0]; } catch { continue; }
                            if (new URL(abs).origin === origin && !visited.has(abs)) next.push(abs);
                        }
                    }));
                    frontier = [...new Set([...frontier, ...next])];
                }
            }

            const urls = [...collected].slice(0, maxUrls);

            // Titles are fetched only for the first slice — pulling 500 pages
            // just to label them would defeat the point of a cheap map.
            const TITLE_LIMIT = 25;
            const titles: Record<string, string> = {};
            await Promise.all(urls.slice(0, TITLE_LIMIT).map(async (u) => {
                try {
                    const html = await fetchVia(u);
                    const t = new DOMParser().parseFromString(html, "text/html").title?.trim();
                    if (t) titles[u] = t;
                } catch { /* title is best-effort */ }
            }));

            return {
                site: origin,
                discoveredVia: viaSitemap ? "sitemap.xml" : "link crawl",
                totalUrls: urls.length,
                truncated: collected.size >= maxUrls,
                titledCount: Object.keys(titles).length,
                pages: urls.map(u => ({ url: u, ...(titles[u] ? { title: titles[u] } : {}) })),
                note: urls.length > 10
                    ? `Structure only — no page content read. Pick the pages that matter and call browse_website on them (it reads up to 10 at a time).`
                    : "Structure only — no page content read.",
            };
        }

        if (toolName === "browse_website") {
            const startUrl = String(args.url || "").trim();
            if (!startUrl) return { error: "No url provided." };
            const maxPages = Math.min(Math.max(1, Number(args.maxPages) || 5), 10);

            let origin: string;
            try { origin = new URL(startUrl).origin; } catch { return { error: "Invalid URL." }; }

            const visited = new Set<string>();
            const queue = [startUrl];
            const pages: any[] = [];
            const errors: string[] = [];

            while (queue.length && pages.length < maxPages) {
                const url = queue.shift()!;
                if (visited.has(url)) continue;
                visited.add(url);

                try {
                    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
                    const res = await fetch(proxyUrl);
                    if (!res.ok) { errors.push(`${url}: HTTP ${res.status}`); continue; }
                    const data = await res.json();
                    const html = data.contents;
                    if (!html) { errors.push(`${url}: no content returned`); continue; }

                    const parser = new DOMParser();
                    const doc = parser.parseFromString(html, "text/html");

                    const title = doc.title?.trim() || url;
                    const headings = [...doc.querySelectorAll("h1, h2, h3")]
                        .map(h => `${h.tagName}: ${h.textContent?.trim()}`)
                        .filter(h => h.split(": ")[1])
                        .slice(0, 20);
                    const navLinks = [...doc.querySelectorAll("nav a")]
                        .map(a => a.textContent?.trim())
                        .filter(Boolean)
                        .slice(0, 20);
                    const imageCount = doc.querySelectorAll("img").length;

                    // Discover same-origin links BEFORE stripping the doc for text extraction.
                    if (pages.length + queue.length < maxPages * 3) {
                        for (const a of doc.querySelectorAll("a[href]")) {
                            const href = a.getAttribute("href");
                            if (!href) continue;
                            let abs: string;
                            try { abs = new URL(href, url).href.split("#")[0]; } catch { continue; }
                            if (new URL(abs).origin === origin && !visited.has(abs) && !queue.includes(abs)) {
                                queue.push(abs);
                            }
                        }
                    }

                    doc.querySelectorAll("script, style, noscript, iframe, link, meta").forEach(s => s.remove());
                    let text = (doc.body?.textContent || "").replace(/\s+/g, " ").trim();
                    if (text.length > 8000) text = text.slice(0, 8000) + "... [truncated]";

                    pages.push({ url, title, headings, navLinks, imageCount, text });
                } catch (e) {
                    errors.push(`${url}: ${e instanceof Error ? e.message : String(e)}`);
                }
            }

            return {
                startUrl,
                pagesVisited: pages.length,
                pages,
                note: "Text/structure only — no visual/screenshot capture of layout, colors, or rendered UI.",
                ...(errors.length ? { skipped: errors } : {}),
            };
        }

        if (toolName !== "read_webpage") {
            return { error: `Tool not found: ${toolName}` };
        }

        try {
            // Using allorigins as a public CORS proxy to allow fetching from a browser
            const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(args.url)}`;
            const response = await fetch(proxyUrl);

            if (!response.ok) {
                return `Error fetching URL: ${response.statusText}`;
            }

            const data = await response.json();
            const html = data.contents;

            if (!html) {
                return "Failed to extract content from the URL.";
            }

            // Simple HTML to text extraction (since this runs in the browser, we can use DOMParser)
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // Remove scripts and styles
            const scripts = doc.querySelectorAll('script, style, noscript, iframe, link, meta');
            scripts.forEach(s => s.remove());

            let text = doc.body?.textContent || "";

            text = text.replace(/\s+/g, ' ').trim();

            // Truncate if too long (to prevent exceeding token limits)
            if (text.length > 30000) {
                text = text.substring(0, 30000) + "... [Content Truncated]";
            }

            return text || "No readable text found on this page.";
        } catch (error) {
            return `Failed to read webpage: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
};

export default webSkill;
