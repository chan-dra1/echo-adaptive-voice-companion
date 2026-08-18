/**
 * groundedSearchService.ts
 *
 * The permanent fix for "Echo says it can't answer real-time questions"
 * (prices, news, scores, current facts) — not a one-off tool per query
 * category.
 *
 * Root cause (verified against the real Gemini API, not assumed): Gemini's
 * built-in Google Search grounding (`tools: [{ googleSearch: {} }]`) gives
 * genuinely reliable, current answers to ANY real-time question — but the
 * API hard-rejects any request that combines it with function-calling
 * tools: "Built-in tools (google_search) and Function Calling cannot be
 * combined in the same request." Since Echo's whole chat/voice pipeline is
 * built on function calling (memory, tasks, reminders, everything), that
 * tool can never be added directly to the main conversation's tools array.
 *
 * The fix: run grounded search as its OWN isolated, tool-free Gemini call,
 * and hand its answer back through the existing search_web function-call
 * result — search_web itself stays a normal function the main conversation
 * can call, but its implementation is now backed by real Google Search
 * instead of DuckDuckGo's weak Instant-Answer API (which only returns data
 * for a small curated set of topics and returns nothing for most
 * real-world queries — that was the actual reason "what's the BTC price"
 * failed even in text mode, which already had search_web before this).
 */

import { GoogleGenAI } from '@google/genai';

const GEMINI_KEY_STORAGE = 'echo_api_key';
const MODEL = 'gemini-2.5-flash';

export interface GroundedSearchResult {
    answer: string;
    sources: { title: string; url: string }[];
}

export function hasGroundedSearchKey(): boolean {
    try { return !!localStorage.getItem(GEMINI_KEY_STORAGE); } catch { return false; }
}

/** Ask a real-time question and get a grounded, current answer + sources.
 *  Throws if no Gemini key is saved — callers should fall back to a
 *  keyless search backend (DuckDuckGo) in that case. */
export async function groundedSearch(query: string): Promise<GroundedSearchResult> {
    const apiKey = localStorage.getItem(GEMINI_KEY_STORAGE)?.trim();
    if (!apiKey) throw new Error('No Gemini key saved — grounded search needs one (the same free key used for chat and voice).');

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [{ text: query }] }],
        config: {
            temperature: 0.3,
            maxOutputTokens: 500,
            tools: [{ googleSearch: {} } as any],
        },
    });

    const candidate = response.candidates?.[0];
    const answer = (candidate?.content?.parts || [])
        .map((p: any) => p?.text)
        .filter(Boolean)
        .join('');

    const chunks = (candidate as any)?.groundingMetadata?.groundingChunks || [];
    const sources = chunks
        .map((c: any) => ({ title: c?.web?.title || '', url: c?.web?.uri || '' }))
        .filter((s: { title: string; url: string }) => s.title || s.url);

    if (!answer) throw new Error('Grounded search returned no answer — try rephrasing.');
    return { answer, sources };
}
