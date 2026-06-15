/**
 * research.mjs — read-only web research for the terminal brain.
 *
 * Keyless by default: DuckDuckGo's Instant Answer API for a quick result, with
 * the DuckDuckGo HTML endpoint as an organic-results fallback. If TAVILY_API_KEY
 * is set we prefer Tavily's search API. fetchReadable() pulls plain text from a
 * page so answer() can hand a little context to the LLM and synthesize a short,
 * sourced answer.
 *
 * Everything degrades gracefully: network errors, non-2xx, or missing model all
 * return [] / null / a friendly { text, sources } object — nothing throws out.
 * Read-only HTTP only (GETs, plus a POST to the Tavily search endpoint).
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** fetch with an AbortController timeout; resolves null on any failure. */
async function fetchWithTimeout(url, opts = {}, timeoutMs = 8000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...opts, signal: ctrl.signal });
        if (!res.ok) return null;
        return res;
    } catch { return null; } finally { clearTimeout(t); }
}

/** Minimal HTML-entity decode for the handful we actually hit. */
function decodeEntities(s) {
    return String(s || '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return ''; } });
}

/** Strip every tag from a fragment and tidy whitespace → plain text. */
function stripTags(s) {
    return decodeEntities(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** DuckDuckGo Instant Answer API — fast, keyless. Returns [] on miss. */
async function searchDdgInstant(query, max) {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`;
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': UA } });
    if (!res) return [];
    let data;
    try { data = await res.json(); } catch { return []; }
    const out = [];

    if (data?.AbstractText) {
        out.push({
            title: data.Heading || query,
            url: data.AbstractURL || '',
            snippet: data.AbstractText,
        });
    }

    const walk = (topics) => {
        for (const t of topics || []) {
            if (out.length >= max) break;
            if (Array.isArray(t?.Topics)) { walk(t.Topics); continue; }
            if (t?.FirstURL && t?.Text) {
                out.push({
                    title: t.Text.split(' - ')[0] || t.Text,
                    url: t.FirstURL,
                    snippet: t.Text,
                });
            }
        }
    };
    walk(data?.RelatedTopics);

    return out.slice(0, max);
}

/** DuckDuckGo HTML endpoint — organic results parsed via regex. [] on miss. */
async function searchDdgHtml(query, max) {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': UA } });
    if (!res) return [];
    let html;
    try { html = await res.text(); } catch { return []; }

    const out = [];
    const seen = new Set();
    // Each organic result anchor: <a ... class="result__a" href="...">title</a>
    const anchorRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    // Snippets: <a ... class="result__snippet" ...>snippet</a>
    const snippetRe = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;

    const snippets = [];
    let sm;
    while ((sm = snippetRe.exec(html)) !== null) snippets.push(stripTags(sm[1]));

    let am, i = 0;
    while ((am = anchorRe.exec(html)) !== null) {
        let href = decodeEntities(am[1]);
        // DDG wraps results in a redirect: //duckduckgo.com/l/?uddg=<encoded>
        const m = href.match(/[?&]uddg=([^&]+)/);
        if (m) { try { href = decodeURIComponent(m[1]); } catch { /* keep as-is */ } }
        const title = stripTags(am[2]);
        if (!href || !title || seen.has(href)) { i++; continue; }
        seen.add(href);
        out.push({ title, url: href, snippet: snippets[i] || '' });
        i++;
        if (out.length >= max) break;
    }
    return out;
}

/** Tavily search API (preferred when TAVILY_API_KEY is set). [] on miss. */
async function searchTavily(query, max) {
    const res = await fetchWithTimeout('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, max_results: max }),
    });
    if (!res) return [];
    let data;
    try { data = await res.json(); } catch { return []; }
    return (data?.results || []).slice(0, max).map(r => ({
        title: r.title || query,
        url: r.url || '',
        snippet: r.content || '',
    }));
}

/**
 * search(query, { max = 5 }) → [{ title, url, snippet }]. Never throws.
 * Prefers Tavily when keyed; otherwise DDG Instant Answer, then DDG HTML.
 */
export async function search(query, { max = 5 } = {}) {
    const q = String(query || '').trim();
    if (!q) return [];
    try {
        if (process.env.TAVILY_API_KEY) {
            const tav = await searchTavily(q, max);
            if (tav.length) return tav;
        }
        const instant = await searchDdgInstant(q, max);
        if (instant.length) return instant;
        return await searchDdgHtml(q, max);
    } catch { return []; }
}

/**
 * fetchReadable(url) → plain readable text from a page, ~8000 chars max.
 * Read-only GET. Returns null on any failure.
 */
export async function fetchReadable(url) {
    const u = String(url || '').trim();
    if (!/^https?:\/\//i.test(u)) return null;
    const res = await fetchWithTimeout(u, { headers: { 'User-Agent': UA } }, 8000);
    if (!res) return null;
    let html;
    try { html = await res.text(); } catch { return null; }
    try {
        const text = html
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<head[\s\S]*?<\/head>/gi, ' ')
            .replace(/<!--[\s\S]*?-->/g, ' ')
            .replace(/<[^>]+>/g, ' ');
        const clean = decodeEntities(text).replace(/\s+/g, ' ').trim();
        return clean ? clean.slice(0, 8000) : null;
    } catch { return null; }
}

/**
 * answer(query, llm) → { text, sources: [{ title, url }] }.
 * Searches, reads the top 1–2 hits, then asks the LLM to synthesize a short
 * sourced answer. Degrades to a friendly object if there's no model or no hits.
 */
export async function answer(query, llm) {
    const q = String(query || '').trim();
    if (!q) return { text: 'Ask me to research something specific.', sources: [] };

    const results = await search(q, { max: 5 });
    if (!results.length) {
        return {
            text: `I couldn't find any web results for "${q}" right now — the search may be offline or blocked.`,
            sources: [],
        };
    }

    const sources = results.map(r => ({ title: r.title, url: r.url }));

    if (!llm || typeof llm.chat !== 'function') {
        // No model: hand back what search gave us, formatted plainly.
        const text = results.map(r => `• ${r.title}${r.snippet ? ` — ${r.snippet}` : ''}`).join('\n');
        return { text: text || `Found ${results.length} results for "${q}".`, sources };
    }

    // Pull readable text from the top 1–2 results for grounding.
    const pages = [];
    for (const r of results.slice(0, 2)) {
        if (!r.url) continue;
        const body = await fetchReadable(r.url);
        if (body) pages.push(`### ${r.title} (${r.url})\n${body.slice(0, 4000)}`);
    }

    const context = pages.length
        ? `\n\nHere are excerpts from the top search results:\n\n${pages.join('\n\n')}`
        : `\n\nHere are the search result snippets:\n\n${results.map(r => `- ${r.title}: ${r.snippet}`).join('\n')}`;

    const system = 'You are a concise research assistant. Using ONLY the provided web excerpts, ' +
        'answer the user\'s question in a few clear sentences. If the excerpts do not contain the ' +
        'answer, say so plainly. Do not invent facts or cite sources not provided.';

    try {
        const { text } = await llm.chat({
            system,
            messages: [{ role: 'user', content: `${q}${context}` }],
        });
        const clean = String(text || '').trim();
        return { text: clean || `Found ${results.length} results for "${q}", but couldn't summarize them.`, sources };
    } catch {
        // Model failed — still return the raw results so the user gets something.
        const text = results.map(r => `• ${r.title}${r.snippet ? ` — ${r.snippet}` : ''}`).join('\n');
        return { text, sources };
    }
}

// --- standalone self-test: `node echo-core/research.mjs` ---------------------
if (import.meta.url === `file://${process.argv[1]}`) {
    (async () => {
        const q = 'latest mars rover news';
        console.log(`research.mjs self-test → search(${JSON.stringify(q)})\n`);
        const results = await search(q);
        if (!results.length) {
            console.log('No results (offline or blocked) — degraded gracefully, no crash.');
        } else {
            for (const r of results) {
                console.log(`• ${r.title}\n  ${r.url}\n  ${(r.snippet || '').slice(0, 160)}\n`);
            }
        }
    })();
}
