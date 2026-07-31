/**
 * llmRouter.ts
 *
 * Unified multi-provider LLM client for Echo. ALL text-mode LLM calls in
 * the app should funnel through this module so we have a single place to
 * manage providers, fallbacks, keys and prompt construction.
 *
 * Providers:
 *   - gemini      (Google Gemini)            key: echo_api_key
 *   - groq        (Groq, OpenAI-compat)      key: echo_groq_key
 *   - openrouter  (OpenRouter free models)   key: echo_openrouter_key
 *   - openai      (OpenAI-compat generic)    key: echo_openai_key
 *   - anthropic   (via localhost proxy)      key: echo_anthropic_key
 *   - mistral     (Mistral La Platforme)     key: echo_mistral_key
 *   - huggingface (HF Inference API)         key: echo_hf_key
 *
 * Live voice (audio) still goes through @google/genai Live — that path is
 * Gemini-only by necessity.
 *
 * Tool-calling: gemini, anthropic, and the OpenAI-compat providers
 * (groq/openrouter/openai/mistral) accept a `tools` list and can return
 * `toolCalls` instead of (or alongside) text. huggingface/ollama ignore
 * `tools` — their APIs don't support function calling here.
 *
 * Streaming: chatStream() gives real incremental tokens for gemini and the
 * OpenAI-compat family (direct, documented SSE APIs). anthropic goes
 * through an external local proxy (not part of this repo) whose streaming
 * behavior isn't verified from here, so — along with huggingface/ollama —
 * it falls back to one non-streamed call whose full text is flushed through
 * onToken as a single chunk. Still correct, just not incremental.
 */

import type { FunctionDeclaration } from '@google/genai';
import { echoCloudAuthService } from './echoCloudAuthService';

export type LlmProvider =
    | 'gemini'
    | 'groq'
    | 'openrouter'
    | 'openai'
    | 'anthropic'
    | 'mistral'
    | 'huggingface'
    | 'ollama'
    | 'echoCloud';

/** Tool/function schema — reuses Gemini's FunctionDeclaration shape (Type enum
 *  values like "OBJECT"/"STRING") since that's what agentSkillService already
 *  produces. Other providers get it converted via toJsonSchema(). */
export type LlmToolDef = FunctionDeclaration;

export interface LlmToolCall {
    /** Provider-assigned call id (anthropic/openai need this to match tool results back up). */
    id?: string;
    name: string;
    args: any;
}

export interface LlmMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    /** On an 'assistant' message: the tool call(s) it requested. */
    toolCalls?: LlmToolCall[];
    /** On a 'tool' message: which call this is the result of. */
    toolCallId?: string;
    /** On a 'tool' message: the tool's name (gemini needs this for functionResponse). */
    name?: string;
}

export interface LlmChatOptions {
    messages: LlmMessage[];
    provider?: LlmProvider;
    model?: string;
    temperature?: number;
    /** Request structured JSON output if the provider supports it. */
    json?: boolean;
    maxTokens?: number;
    /** Tools the model may call. See module doc for provider support. */
    tools?: LlmToolDef[];
    /**
     * Optional prompt-caching hint. MUST be a literal prefix of the system
     * message's content — the stable-across-turns portion (identity, persona,
     * memories) with the volatile tail (per-query RAG hits) excluded.
     *
     * Providers differ in how much of this they can actually use:
     *   - anthropic: explicit `cache_control: ephemeral` breakpoint at the
     *     boundary. Real, largest win.
     *   - openai / groq / openrouter / mistral: automatic prefix caching
     *     server-side, no markers accepted. Benefits purely from the caller
     *     keeping the prefix byte-stable across turns; this field is a no-op
     *     on the wire but the stable ordering it implies is what matters.
     *   - gemini: 2.5 models do implicit caching on a stable prefix. Explicit
     *     `cachedContent` needs a separately-created cache resource with its
     *     own TTL/lifecycle, which is not wired up here — so this is also
     *     effectively "stable ordering helps, no marker sent".
     * Ignored entirely if it isn't actually a prefix (guards against a caller
     * silently corrupting the prompt).
     */
    cacheableSystemPrefix?: string;
}

export interface LlmChatResult {
    text: string;
    provider: LlmProvider;
    model: string;
    /** Present when the model wants to call tool(s) instead of (or before) returning final text. */
    toolCalls?: LlmToolCall[];
}

const KEY_BY_PROVIDER: Record<LlmProvider, string> = {
    gemini: 'echo_api_key',
    groq: 'echo_groq_key',
    openrouter: 'echo_openrouter_key',
    openai: 'echo_openai_key',
    anthropic: 'echo_anthropic_key',
    mistral: 'echo_mistral_key',
    huggingface: 'echo_hf_key',
    ollama: 'echo_ollama_model',
    // echoCloud has no static localStorage key — hasKeyFor/getKeyFor special-case
    // it to read from echoCloudAuthService's session instead. This entry only
    // exists to satisfy the Record<LlmProvider, string> type.
    echoCloud: 'echo_cloud_unused',
};

const DEFAULT_MODEL: Record<LlmProvider, string> = {
    gemini: 'gemini-2.5-flash',
    groq: 'llama-3.1-8b-instant',
    openrouter: 'meta-llama/llama-3.1-8b-instruct:free',
    openai: 'gpt-4o-mini',
    anthropic: 'claude-fable-5',
    mistral: 'mistral-small-latest',
    huggingface: 'meta-llama/Llama-3.1-8B-Instruct',
    ollama: 'llama3',
    // The proxy (api/cloud-chat.ts) picks the actual model server-side —
    // this label is just what shows up in LlmChatResult.model.
    echoCloud: 'echo-cloud-default',
};

/** Order of preference when no explicit provider is set: prefer FREE first. */
const FREE_PREFERENCE_ORDER: LlmProvider[] = [
    'ollama',
    'groq',
    'openrouter',
    'gemini',
    'mistral',
    'huggingface',
    'openai',
    'anthropic',
];

export function hasKeyFor(provider: LlmProvider): boolean {
    if (provider === 'ollama') return true; // Local, no API key required
    if (provider === 'echoCloud') return echoCloudAuthService.isSignedIn();
    return !!localStorage.getItem(KEY_BY_PROVIDER[provider]);
}

export function getKeyFor(provider: LlmProvider): string {
    if (provider === 'ollama') {
        return localStorage.getItem('echo_ollama_model') || 'llama3';
    }
    if (provider === 'echoCloud') {
        return echoCloudAuthService.getCurrentAccessToken();
    }
    return localStorage.getItem(KEY_BY_PROVIDER[provider]) || '';
}

/**
 * Pick a provider. Uses (in order):
 *   1. Caller-supplied `preferred`.
 *   2. User's saved default in localStorage 'echo_default_brain'.
 *   3. Free preference order, picking the first provider with a key.
 *   4. Hard fallback to 'gemini'.
 */
export function chooseProvider(preferred?: LlmProvider): LlmProvider {
    if (preferred && hasKeyFor(preferred)) return preferred;
    const saved = localStorage.getItem('echo_default_brain') as LlmProvider | null;
    if (saved && hasKeyFor(saved)) return saved;
    for (const p of FREE_PREFERENCE_ORDER) {
        if (hasKeyFor(p)) return p;
    }
    return 'gemini';
}

/** Provider classification: which destinations are remote/cloud. All current
 *  providers are cloud-hosted; this exists to make `local_only` filtering
 *  explicit and future-proof. */
export function destinationFor(provider: LlmProvider): 'cloud' | 'local' {
    if (provider === 'ollama') return 'local';
    return 'cloud';
}

/** True if the caller explicitly asked for echoCloud but isn't signed in —
 *  checked BEFORE chooseProvider(), which would otherwise silently fall back
 *  through the free-preference chain (ollama's hasKeyFor is hardcoded true)
 *  and mask "you're signed out" behind an unrelated provider's error. */
function requestedSignedOutEchoCloud(opts: LlmChatOptions): boolean {
    return opts.provider === 'echoCloud' && !echoCloudAuthService.isSignedIn();
}

/** Main entry point — async unified chat (non-streaming). */
export async function chat(opts: LlmChatOptions): Promise<LlmChatResult> {
    if (requestedSignedOutEchoCloud(opts)) {
        throw new Error('Not signed in to Echo Cloud. Open Settings → Echo Cloud and sign in.');
    }
    const provider = chooseProvider(opts.provider);
    const apiKey = getKeyFor(provider);
    if (!apiKey && provider !== 'ollama') {
        if (provider === 'echoCloud') {
            throw new Error('Not signed in to Echo Cloud. Open Settings → Echo Cloud and sign in.');
        }
        throw new Error(`No API key configured for provider "${provider}". Open the Vault to add one.`);
    }
    const model = opts.model || DEFAULT_MODEL[provider];
    const { text, toolCalls } = await callProvider(provider, apiKey, model, opts);
    return { text, provider, model, toolCalls };
}

/**
 * Streaming variant of chat(). See module doc for which providers actually
 * stream incrementally vs. flush one chunk at the end.
 */
export async function chatStream(
    opts: LlmChatOptions,
    onToken?: (delta: string) => void,
): Promise<LlmChatResult> {
    if (requestedSignedOutEchoCloud(opts)) {
        throw new Error('Not signed in to Echo Cloud. Open Settings → Echo Cloud and sign in.');
    }
    const provider = chooseProvider(opts.provider);
    const apiKey = getKeyFor(provider);
    if (!apiKey && provider !== 'ollama') {
        if (provider === 'echoCloud') {
            throw new Error('Not signed in to Echo Cloud. Open Settings → Echo Cloud and sign in.');
        }
        throw new Error(`No API key configured for provider "${provider}". Open the Vault to add one.`);
    }
    const model = opts.model || DEFAULT_MODEL[provider];

    if (provider === 'gemini') {
        const { text, toolCalls } = await streamGemini(apiKey, model, opts, onToken);
        return { text, toolCalls, provider, model };
    }
    if (provider === 'groq' || provider === 'openrouter' || provider === 'openai' || provider === 'mistral') {
        const { url, extraHeaders } = resolveOpenAiCompatTarget(provider);
        const { text, toolCalls } = await streamOpenAiCompat(url, apiKey, model, opts, onToken, extraHeaders);
        return { text, toolCalls, provider, model };
    }
    if (provider === 'echoCloud') {
        // Same relative endpoint as the non-streaming path — the proxy
        // (api/cloud-chat.ts) speaks OpenAI-compatible SSE, so the existing
        // parser handles it with no new client code.
        const { text, toolCalls } = await streamOpenAiCompat('/api/cloud-chat', apiKey, model, opts, onToken);
        return { text, toolCalls, provider, model };
    }
    // anthropic / huggingface / ollama: no verified streaming path here — one
    // non-streamed call, flushed through onToken as a single chunk.
    const { text, toolCalls } = await callProvider(provider, apiKey, model, opts);
    if (text) onToken?.(text);
    return { text, toolCalls, provider, model };
}

function resolveOpenAiCompatTarget(
    provider: 'groq' | 'openrouter' | 'openai' | 'mistral',
): { url: string; extraHeaders?: Record<string, string> } {
    switch (provider) {
        case 'groq':
            return { url: 'https://api.groq.com/openai/v1/chat/completions' };
        case 'openrouter':
            return {
                url: 'https://openrouter.ai/api/v1/chat/completions',
                extraHeaders: {
                    'HTTP-Referer': window.location.origin,
                    'X-Title': 'Echo Personal Companion',
                },
            };
        case 'openai': {
            const customBase = typeof localStorage !== 'undefined' ? localStorage.getItem('echo_openai_base')?.trim() : null;
            const targetUrl = customBase
                ? (customBase.endsWith('/') ? customBase + 'chat/completions' : customBase + '/chat/completions')
                : 'https://api.openai.com/v1/chat/completions';
            return { url: targetUrl };
        }
        case 'mistral':
            return { url: 'https://api.mistral.ai/v1/chat/completions' };
    }
}

async function callProvider(
    provider: LlmProvider,
    apiKey: string,
    model: string,
    opts: LlmChatOptions,
): Promise<{ text: string; toolCalls?: LlmToolCall[] }> {
    switch (provider) {
        case 'gemini':
            return callGemini(apiKey, model, opts);
        case 'groq':
        case 'openrouter':
        case 'openai':
        case 'mistral': {
            const { url, extraHeaders } = resolveOpenAiCompatTarget(provider);
            return callOpenAiCompat(url, apiKey, model, opts, extraHeaders);
        }
        case 'anthropic':
            return callAnthropic(apiKey, model, opts);
        case 'echoCloud':
            return callOpenAiCompat('/api/cloud-chat', apiKey, model, opts);
        case 'huggingface':
            return { text: await callHuggingFace(apiKey, model, opts) };
        case 'ollama':
            // Proxies through local Flask voice server to bypass CORS. Tools
            // aren't forwarded — the local endpoint isn't verified to support
            // OpenAI-style tool_calls.
            return callOpenAiCompat(
                'http://localhost:8000/llm/ollama',
                'no-key-needed',
                model,
                { ...opts, tools: undefined },
            );
    }
}

/**
 * Guess which provider an API key belongs to from its shape, so a key pasted
 * into the wrong field can be caught before it's saved or used. Order
 * matters: check the more specific "sk-ant-"/"sk-or-" prefixes before the
 * generic "sk-" (OpenAI) one, since those are also "sk-"-prefixed.
 */
export function detectProviderFromKey(value: string): LlmProvider | null {
    const v = value.trim();
    if (!v) return null;
    if (v.startsWith('AIzaSy') || v.startsWith('AQ.')) return 'gemini';
    if (v.startsWith('gsk_')) return 'groq';
    if (v.startsWith('sk-ant-')) return 'anthropic';
    if (v.startsWith('sk-or-')) return 'openrouter';
    if (v.startsWith('hf_')) return 'huggingface';
    if (v.startsWith('sk-')) return 'openai';
    return null; // Mistral keys have no fixed signature; Ollama isn't a key.
}

export interface ApiKeyTestResult {
    ok: boolean;
    message: string;
}

/**
 * Pre-flight check: make the cheapest possible authenticated call to confirm
 * a key actually works, before it's saved or used in a real session. Uses
 * each provider's lightest endpoint (model listing / token introspection)
 * instead of a real chat completion, so testing costs ~nothing.
 */
export async function testApiKey(provider: LlmProvider, apiKey: string): Promise<ApiKeyTestResult> {
    if (provider === 'ollama') {
        try {
            const res = await fetch('http://localhost:11434/api/tags');
            if (!res.ok) return { ok: false, message: `Ollama responded ${res.status}` };
            const data = await res.json().catch(() => ({}));
            const count = Array.isArray(data?.models) ? data.models.length : undefined;
            return { ok: true, message: count !== undefined ? `Running — ${count} model(s) pulled.` : 'Ollama is running.' };
        } catch {
            return { ok: false, message: 'Not reachable on localhost:11434. Run "ollama serve".' };
        }
    }

    const key = apiKey.trim();
    if (!key) return { ok: false, message: 'No key entered.' };

    try {
        switch (provider) {
            case 'gemini': {
                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    return { ok: false, message: err?.error?.message || `Rejected (${res.status})` };
                }
                const data = await res.json();
                return { ok: true, message: `Valid — ${data?.models?.length ?? 0} models available.` };
            }
            case 'groq':
                return await testOpenAiCompatKey('https://api.groq.com/openai/v1/models', key);
            case 'mistral':
                return await testOpenAiCompatKey('https://api.mistral.ai/v1/models', key);
            case 'openai': {
                const customBase = typeof localStorage !== 'undefined' ? localStorage.getItem('echo_openai_base')?.trim() : null;
                const base = customBase ? customBase.replace(/\/+$/, '') : 'https://api.openai.com/v1';
                return await testOpenAiCompatKey(`${base}/models`, key);
            }
            case 'openrouter': {
                // OpenRouter's /models is public even with a bad key — use the
                // key-introspection endpoint instead so a garbage key actually fails.
                const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
                    headers: { Authorization: `Bearer ${key}` },
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    return { ok: false, message: err?.error?.message || `Rejected (${res.status})` };
                }
                const data = await res.json();
                const limit = data?.data?.limit;
                return { ok: true, message: limit != null ? `Valid — limit ${limit}.` : 'Valid key.' };
            }
            case 'huggingface': {
                const res = await fetch('https://huggingface.co/api/whoami-v2', {
                    headers: { Authorization: `Bearer ${key}` },
                });
                if (!res.ok) return { ok: false, message: `Rejected (${res.status}) — check the token.` };
                const data = await res.json().catch(() => ({}));
                return { ok: true, message: `Valid — signed in as ${data?.name || 'unknown user'}.` };
            }
            case 'anthropic': {
                const res = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': key,
                        'anthropic-version': '2023-06-01',
                    },
                    body: JSON.stringify({ model: 'claude-fable-5', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
                }).catch(() => null);
                if (!res) return { ok: false, message: 'Could not reach Anthropic API — check your network.' };
                if (res.status === 401) return { ok: false, message: 'Invalid API key.' };
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    return { ok: false, message: err?.error?.message || err?.error || `Rejected (${res.status})` };
                }
                return { ok: true, message: 'Valid — Fable (claude-fable-5) key accepted.' };
            }
            default:
                return { ok: false, message: 'Unknown provider.' };
        }
    } catch (e: any) {
        return { ok: false, message: e?.message || 'Network error — could not reach the provider.' };
    }
}

async function testOpenAiCompatKey(url: string, apiKey: string): Promise<ApiKeyTestResult> {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        let msg = `Rejected (${res.status})`;
        try {
            const parsed = JSON.parse(errText);
            msg = parsed?.error?.message || parsed?.message || msg;
        } catch { /* keep generic */ }
        return { ok: false, message: msg };
    }
    const data = await res.json().catch(() => ({}));
    const count = Array.isArray(data?.data) ? data.data.length : undefined;
    return { ok: true, message: count !== undefined ? `Valid — ${count} models available.` : 'Valid key.' };
}

/** Convert a Gemini-flavored FunctionDeclaration.parameters schema (Type enum
 *  values like "OBJECT"/"STRING") into plain JSON Schema (lowercase
 *  "object"/"string") for providers that expect standard JSON Schema
 *  (Anthropic's input_schema, OpenAI-compat's function.parameters). */
function toJsonSchema(schema: any): any {
    if (!schema || typeof schema !== 'object') return schema;
    const out: any = { ...schema };
    if (typeof out.type === 'string') out.type = out.type.toLowerCase();
    if (out.properties && typeof out.properties === 'object') {
        const props: any = {};
        for (const [k, v] of Object.entries(out.properties)) props[k] = toJsonSchema(v);
        out.properties = props;
    }
    if (out.items) out.items = toJsonSchema(out.items);
    return out;
}

function safeParseJson(s: string): any {
    try { return JSON.parse(s); } catch { return { result: s }; }
}

/**
 * Validate a caching hint and split the system prompt at the boundary.
 * Returns null when there's nothing safe/useful to cache, so callers can fall
 * back to sending one plain system string.
 *
 * Refuses to split when the hint isn't a real prefix (a caller bug that would
 * otherwise silently reorder or duplicate prompt text) or when the prefix is
 * tiny — below a few hundred chars the cache-write premium outweighs the
 * saving, and providers impose their own minimum-cacheable-token floors anyway.
 */
const MIN_CACHEABLE_PREFIX_CHARS = 500;

function splitCacheablePrefix(
    fullSystem: string,
    hint: string | undefined,
): { prefix: string; rest: string } | null {
    if (!hint || !fullSystem) return null;
    if (!fullSystem.startsWith(hint)) {
        console.warn('[llmRouter] cacheableSystemPrefix is not a prefix of the system prompt — ignoring the caching hint.');
        return null;
    }
    if (hint.length < MIN_CACHEABLE_PREFIX_CHARS) return null;
    return { prefix: hint, rest: fullSystem.slice(hint.length) };
}

/** Shared LlmMessage → Gemini `contents` entry mapper (used by both the
 *  non-streaming and streaming Gemini calls so tool-turn encoding can't drift). */
function geminiContentFor(m: LlmMessage): any {
    if (m.role === 'tool') {
        return {
            role: 'function',
            parts: [{ functionResponse: { name: m.name || 'unknown_tool', response: safeParseJson(m.content) } }],
        };
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
        return {
            role: 'model',
            parts: m.toolCalls.map(tc => ({ functionCall: { name: tc.name, args: tc.args } })),
        };
    }
    return {
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
    };
}

function geminiRequestBody(opts: LlmChatOptions): any {
    const sys = opts.messages.find(m => m.role === 'system');
    const rest = opts.messages.filter(m => m.role !== 'system');
    const body: any = {
        contents: rest.map(geminiContentFor),
        generationConfig: {
            temperature: opts.temperature ?? 0.7,
            maxOutputTokens: opts.maxTokens ?? 2048,
        },
    };
    if (sys?.content) body.system_instruction = { parts: [{ text: sys.content }] };
    if (opts.json) body.generationConfig.responseMimeType = 'application/json';
    if (opts.tools?.length) body.tools = [{ functionDeclarations: opts.tools }];
    return body;
}

async function callGemini(apiKey: string, model: string, opts: LlmChatOptions): Promise<{ text: string; toolCalls?: LlmToolCall[] }> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiRequestBody(opts)),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `Gemini error (${res.status})`);
    }
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.filter((p: any) => p.text).map((p: any) => p.text).join('');
    const toolCalls: LlmToolCall[] = parts
        .filter((p: any) => p.functionCall)
        .map((p: any) => ({ name: p.functionCall.name, args: p.functionCall.args || {} }));
    return { text, toolCalls: toolCalls.length ? toolCalls : undefined };
}

async function streamGemini(
    apiKey: string,
    model: string,
    opts: LlmChatOptions,
    onToken?: (delta: string) => void,
): Promise<{ text: string; toolCalls?: LlmToolCall[] }> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiRequestBody(opts)),
    });
    if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `Gemini error (${res.status})`);
    }

    let text = '';
    const toolCalls: LlmToolCall[] = [];
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const jsonStr = trimmed.slice(5).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;
            try {
                const chunk = JSON.parse(jsonStr);
                const parts = chunk?.candidates?.[0]?.content?.parts || [];
                for (const p of parts) {
                    if (p.text) { text += p.text; onToken?.(p.text); }
                    if (p.functionCall) toolCalls.push({ name: p.functionCall.name, args: p.functionCall.args || {} });
                }
            } catch { /* skip malformed SSE chunk */ }
        }
    }
    return { text, toolCalls: toolCalls.length ? toolCalls : undefined };
}

async function callAnthropic(apiKey: string, model: string, opts: LlmChatOptions): Promise<{ text: string; toolCalls?: LlmToolCall[] }> {
    const sys = opts.messages.find(m => m.role === 'system');
    const rest = opts.messages.filter(m => m.role !== 'system');

    const messages: any[] = rest.map(m => {
        if (m.role === 'tool') {
            return {
                role: 'user',
                content: [{ type: 'tool_result', tool_use_id: m.toolCallId || '', content: m.content }],
            };
        }
        if (m.role === 'assistant' && m.toolCalls?.length) {
            const blocks: any[] = [];
            if (m.content) blocks.push({ type: 'text', text: m.content });
            for (const tc of m.toolCalls) {
                blocks.push({ type: 'tool_use', id: tc.id || `call_${Math.random().toString(36).slice(2)}`, name: tc.name, input: tc.args });
            }
            return { role: 'assistant', content: blocks };
        }
        return { role: m.role, content: m.content };
    });

    const fullSystem = sys?.content || '';
    const split = splitCacheablePrefix(fullSystem, opts.cacheableSystemPrefix);

    const body: any = {
        model,
        max_tokens: opts.maxTokens ?? 2048,
        temperature: opts.temperature ?? 0.7,
        // Anthropic accepts either a plain string or an array of text blocks.
        // The array form lets us drop an ephemeral cache breakpoint after the
        // stable prefix so it's processed once per ~5min window instead of on
        // every turn. Only the prefix block is marked; the volatile tail stays
        // uncached so a per-query RAG change can't invalidate the whole thing.
        system: split
            ? [
                { type: 'text', text: split.prefix, cache_control: { type: 'ephemeral' } },
                ...(split.rest ? [{ type: 'text', text: split.rest }] : []),
            ]
            : fullSystem,
        messages,
    };
    if (opts.tools?.length) {
        body.tools = opts.tools.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: toJsonSchema(t.parameters),
        }));
    }

    const res = await fetch('http://localhost:8000/llm/anthropic', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || err?.error || `Anthropic proxy error (${res.status})`);
    }
    const data = await res.json();
    const blocks = data?.content || [];
    const text = blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const toolCalls: LlmToolCall[] = blocks
        .filter((b: any) => b.type === 'tool_use')
        .map((b: any) => ({ id: b.id, name: b.name, args: b.input || {} }));
    return { text, toolCalls: toolCalls.length ? toolCalls : undefined };
}

/** Shared LlmMessage[] → OpenAI-compat `messages` array mapper. */
function openAiMessagesFor(msgs: LlmMessage[]): any[] {
    return msgs.map(m => {
        if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId || '', content: m.content };
        if (m.role === 'assistant' && m.toolCalls?.length) {
            return {
                role: 'assistant',
                content: m.content || null,
                tool_calls: m.toolCalls.map(tc => ({
                    id: tc.id || `call_${Math.random().toString(36).slice(2)}`,
                    type: 'function',
                    function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) },
                })),
            };
        }
        return { role: m.role, content: m.content };
    });
}

async function callOpenAiCompat(
    url: string,
    apiKey: string,
    model: string,
    opts: LlmChatOptions,
    extraHeaders: Record<string, string> = {},
): Promise<{ text: string; toolCalls?: LlmToolCall[] }> {
    const body: any = {
        model,
        messages: openAiMessagesFor(opts.messages),
        temperature: opts.temperature ?? 0.7,
    };
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    if (opts.json) body.response_format = { type: 'json_object' };
    if (opts.tools?.length) {
        body.tools = opts.tools.map(t => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: toJsonSchema(t.parameters) },
        }));
    }

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            ...extraHeaders,
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        let msg = `LLM error (${res.status})`;
        try {
            const parsed = JSON.parse(errText);
            msg = parsed?.error?.message || parsed?.message || msg;
        } catch { /* keep generic */ }
        throw new Error(msg);
    }
    const data = await res.json();
    const msg0 = data.choices?.[0]?.message;
    const text = msg0?.content || '';
    const toolCalls: LlmToolCall[] | undefined = msg0?.tool_calls?.length
        ? msg0.tool_calls.map((tc: any) => ({
            id: tc.id,
            name: tc.function?.name,
            args: safeParseJson(tc.function?.arguments || '{}'),
        }))
        : undefined;
    return { text, toolCalls };
}

async function streamOpenAiCompat(
    url: string,
    apiKey: string,
    model: string,
    opts: LlmChatOptions,
    onToken?: (delta: string) => void,
    extraHeaders: Record<string, string> = {},
): Promise<{ text: string; toolCalls?: LlmToolCall[] }> {
    const body: any = {
        model,
        messages: openAiMessagesFor(opts.messages),
        temperature: opts.temperature ?? 0.7,
        stream: true,
    };
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    if (opts.tools?.length) {
        body.tools = opts.tools.map(t => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: toJsonSchema(t.parameters) },
        }));
    }

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            ...extraHeaders,
        },
        body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => '');
        let msg = `LLM error (${res.status})`;
        try {
            const parsed = JSON.parse(errText);
            msg = parsed?.error?.message || parsed?.message || msg;
        } catch { /* keep generic */ }
        throw new Error(msg);
    }

    let text = '';
    const toolCallsAcc: Record<number, { id?: string; name: string; args: string }> = {};
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const jsonStr = trimmed.slice(5).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;
            try {
                const chunk = JSON.parse(jsonStr);
                const delta = chunk?.choices?.[0]?.delta;
                if (delta?.content) { text += delta.content; onToken?.(delta.content); }
                if (Array.isArray(delta?.tool_calls)) {
                    for (const tc of delta.tool_calls) {
                        const idx = tc.index ?? 0;
                        if (!toolCallsAcc[idx]) toolCallsAcc[idx] = { name: '', args: '' };
                        if (tc.id) toolCallsAcc[idx].id = tc.id;
                        if (tc.function?.name) toolCallsAcc[idx].name += tc.function.name;
                        if (tc.function?.arguments) toolCallsAcc[idx].args += tc.function.arguments;
                    }
                }
            } catch { /* skip malformed SSE chunk */ }
        }
    }
    const toolCalls: LlmToolCall[] = Object.values(toolCallsAcc).map(tc => ({
        id: tc.id, name: tc.name, args: safeParseJson(tc.args || '{}'),
    }));
    return { text, toolCalls: toolCalls.length ? toolCalls : undefined };
}

async function callHuggingFace(apiKey: string, model: string, opts: LlmChatOptions): Promise<string> {
    // HF Inference API expects a single string prompt. We collapse the chat
    // into Llama 3 style for the default model.
    const promptParts: string[] = [];
    for (const m of opts.messages) {
        if (m.role === 'system') {
            promptParts.push(`<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n${m.content}<|eot_id|>`);
        } else if (m.role === 'user') {
            promptParts.push(`<|start_header_id|>user<|end_header_id|>\n${m.content}<|eot_id|>`);
        } else {
            promptParts.push(`<|start_header_id|>assistant<|end_header_id|>\n${m.content}<|eot_id|>`);
        }
    }
    promptParts.push('<|start_header_id|>assistant<|end_header_id|>\n');
    const prompt = promptParts.join('');

    const res = await fetch(`https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            inputs: prompt,
            parameters: {
                temperature: opts.temperature ?? 0.7,
                max_new_tokens: opts.maxTokens ?? 1024,
                return_full_text: false,
            },
        }),
    });
    if (!res.ok) {
        const err = await res.text().catch(() => '');
        throw new Error(err || `Hugging Face error (${res.status})`);
    }
    const data = await res.json();
    if (Array.isArray(data)) return data[0]?.generated_text || '';
    return data?.generated_text || '';
}
