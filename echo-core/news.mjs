/**
 * news.mjs — keyless top-headlines briefing for Echo.
 *
 * Fetches a public RSS feed (BBC News, falling back to Google News) with a
 * desktop User-Agent and parses it minimally with regex — no API key, no
 * external dependencies, read-only HTTP GET. Every function degrades to an
 * empty array / null silently on any failure (no network, bad response,
 * unparseable feed) — the briefing just omits the news line.
 */

const FEEDS = [
    'https://feeds.bbci.co.uk/news/rss.xml',
    'https://news.google.com/rss',
];

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function fetchText(url, timeoutMs = 6000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': UA },
            signal: ctrl.signal,
        });
        if (!res.ok) return null;
        return await res.text();
    } catch { return null; } finally { clearTimeout(t); }
}

function decode(s) {
    return s
        .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;|&apos;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/<[^>]+>/g, '')
        .trim();
}

function firstTitle(block) {
    const m = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return m ? decode(m[1]) : '';
}

function parseFeed(xml, max, url) {
    // Channel title sits before the first <item>; use it as the source name.
    const head = xml.split(/<item[\s>]/i)[0] || '';
    let source = firstTitle(head);
    if (!source) {
        try { source = new URL(url).hostname.replace(/^www\./, ''); } catch { source = 'News'; }
    }

    const items = [];
    const re = /<item[\s>]([\s\S]*?)<\/item>/gi;
    let m;
    while ((m = re.exec(xml)) && items.length < max) {
        const title = firstTitle(m[1]);
        if (title) items.push({ title, source });
    }
    return items;
}

/**
 * Top headlines as objects, or [] on failure.
 * @returns {Promise<Array<{ title: string, source: string }>>}
 */
export async function topHeadlines({ max = 3 } = {}) {
    for (const url of FEEDS) {
        const xml = await fetchText(url);
        if (!xml) continue;
        const items = parseFeed(xml, max, url);
        if (items.length) return items;
    }
    return [];
}

/**
 * One short spoken line with the leading headline, or null.
 * e.g. "Top story: Markets rally as inflation cools."
 */
export async function statusLine() {
    const items = await topHeadlines({ max: 1 });
    if (!items.length) return null;
    return `Top story: ${items[0].title}.`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    (async () => {
        const items = await topHeadlines();
        console.log('Headlines:', items.length ? items : '(none — degraded gracefully)');
        const line = await statusLine();
        console.log(line ?? '(news unavailable — degraded gracefully)');
    })();
}
