import { FunctionDeclaration, Type } from '@google/genai';
import { Skill } from '../services/agentSkillService';

interface SearchResult {
    title: string;
    url: string;
    snippet: string;
}

async function ddgSearch(query: string, max: number): Promise<SearchResult[]> {
    try {
        const url =
            `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&t=echo-agent`;
        const res = await fetch(url);
        if (!res.ok) return [];
        const data = await res.json();
        const out: SearchResult[] = [];

        if (data.AbstractText) {
            out.push({ title: data.Heading || query, url: data.AbstractURL || '', snippet: data.AbstractText });
        }

        const candidates = [...(data.RelatedTopics || []), ...(data.Results || [])];
        for (const t of candidates) {
            if (out.length >= max) break;
            const item = t.Topics ? t.Topics[0] : t;
            if (!item?.Text) continue;
            out.push({ title: item.Text.slice(0, 80), url: item.FirstURL || '', snippet: item.Text });
        }

        return out.slice(0, max);
    } catch {
        return [];
    }
}

async function tavilySearch(query: string, apiKey: string, max: number): Promise<SearchResult[]> {
    try {
        const res = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: apiKey, query, max_results: max }),
        });
        if (!res.ok) return [];
        const data = await res.json();
        return ((data.results || []) as any[]).slice(0, max).map(r => ({
            title: r.title || '',
            url: r.url || '',
            snippet: r.content || r.snippet || '',
        }));
    } catch {
        return [];
    }
}

const searchWebDeclaration: FunctionDeclaration = {
    name: 'search_web',
    description:
        'Search the web for current information — news, facts, documentation, prices, scores, or any real-time data beyond training knowledge. Returns titles, URLs, and summaries. Google Search grounding is built-in for quick lookups; use this tool when you need explicit structured results to reason over.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            query: {
                type: Type.STRING,
                description: 'The search query. Be specific for better results. Example: "Python 3.13 new features", "Apple stock price today"',
            },
            num_results: {
                type: Type.NUMBER,
                description: 'Number of results to return (1–10, default 5).',
            },
        },
        required: ['query'],
    },
};

export const searchSkill: Skill = {
    name: 'searchSkill',
    description: 'Web search via DuckDuckGo (keyless) or Tavily API (if echo_tavily_key is set in localStorage).',
    tools: [searchWebDeclaration],

    execute: async (toolName: string, args: any) => {
        if (toolName !== 'search_web') return { error: `Unknown tool: ${toolName}` };

        const query = String(args.query || '').trim();
        if (!query) return { error: 'No query provided.' };

        const max = Math.min(10, Math.max(1, Number(args.num_results) || 5));
        const tavilyKey = localStorage.getItem('echo_tavily_key')?.trim() || '';

        const results = tavilyKey
            ? await tavilySearch(query, tavilyKey, max)
            : await ddgSearch(query, max);

        if (!results.length) {
            return { results: [], note: 'No results found. Try rephrasing your search.' };
        }

        return { query, results, source: tavilyKey ? 'tavily' : 'duckduckgo', count: results.length };
    },
};

export default searchSkill;
