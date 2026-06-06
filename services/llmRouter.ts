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
 */

export type LlmProvider =
    | 'gemini'
    | 'groq'
    | 'openrouter'
    | 'openai'
    | 'anthropic'
    | 'mistral'
    | 'huggingface';

export interface LlmMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface LlmChatOptions {
    messages: LlmMessage[];
    provider?: LlmProvider;
    model?: string;
    temperature?: number;
    /** Request structured JSON output if the provider supports it. */
    json?: boolean;
    maxTokens?: number;
}

export interface LlmChatResult {
    text: string;
    provider: LlmProvider;
    model: string;
}

const KEY_BY_PROVIDER: Record<LlmProvider, string> = {
    gemini: 'echo_api_key',
    groq: 'echo_groq_key',
    openrouter: 'echo_openrouter_key',
    openai: 'echo_openai_key',
    anthropic: 'echo_anthropic_key',
    mistral: 'echo_mistral_key',
    huggingface: 'echo_hf_key',
};

const DEFAULT_MODEL: Record<LlmProvider, string> = {
    gemini: 'gemini-2.5-flash',
    groq: 'llama-3.1-8b-instant',
    openrouter: 'meta-llama/llama-3.1-8b-instruct:free',
    openai: 'gpt-4o-mini',
    anthropic: 'claude-3-5-sonnet-20241022',
    mistral: 'mistral-small-latest',
    huggingface: 'meta-llama/Llama-3.1-8B-Instruct',
};

/** Order of preference when no explicit provider is set: prefer FREE first. */
const FREE_PREFERENCE_ORDER: LlmProvider[] = [
    'groq',
    'openrouter',
    'gemini',
    'mistral',
    'huggingface',
    'openai',
    'anthropic',
];

export function hasKeyFor(provider: LlmProvider): boolean {
    return !!localStorage.getItem(KEY_BY_PROVIDER[provider]);
}

export function getKeyFor(provider: LlmProvider): string {
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
export function destinationFor(_provider: LlmProvider): 'cloud' | 'local' {
    return 'cloud';
}

/** Main entry point — async unified chat. */
export async function chat(opts: LlmChatOptions): Promise<LlmChatResult> {
    const provider = chooseProvider(opts.provider);
    const apiKey = getKeyFor(provider);
    if (!apiKey) {
        throw new Error(`No API key configured for provider "${provider}". Open the Vault to add one.`);
    }
    const model = opts.model || DEFAULT_MODEL[provider];
    const text = await callProvider(provider, apiKey, model, opts);
    return { text, provider, model };
}

async function callProvider(
    provider: LlmProvider,
    apiKey: string,
    model: string,
    opts: LlmChatOptions,
): Promise<string> {
    switch (provider) {
        case 'gemini':
            return callGemini(apiKey, model, opts);
        case 'groq':
            return callOpenAiCompat(
                'https://api.groq.com/openai/v1/chat/completions',
                apiKey, model, opts,
            );
        case 'openrouter':
            return callOpenAiCompat(
                'https://openrouter.ai/api/v1/chat/completions',
                apiKey, model, opts,
                {
                    'HTTP-Referer': window.location.origin,
                    'X-Title': 'Echo Personal Companion',
                },
            );
        case 'openai':
            return callOpenAiCompat(
                'https://api.openai.com/v1/chat/completions',
                apiKey, model, opts,
            );
        case 'mistral':
            return callOpenAiCompat(
                'https://api.mistral.ai/v1/chat/completions',
                apiKey, model, opts,
            );
        case 'anthropic':
            return callAnthropic(apiKey, model, opts);
        case 'huggingface':
            return callHuggingFace(apiKey, model, opts);
    }
}

async function callOpenAiCompat(
    url: string,
    apiKey: string,
    model: string,
    opts: LlmChatOptions,
    extraHeaders: Record<string, string> = {},
): Promise<string> {
    const body: any = {
        model,
        messages: opts.messages,
        temperature: opts.temperature ?? 0.7,
    };
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    if (opts.json) body.response_format = { type: 'json_object' };

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
    return data.choices?.[0]?.message?.content || '';
}

async function callGemini(apiKey: string, model: string, opts: LlmChatOptions): Promise<string> {
    // Split system instruction out
    const sys = opts.messages.find(m => m.role === 'system');
    const rest = opts.messages.filter(m => m.role !== 'system');
    const contents = rest.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
    }));

    const body: any = {
        contents,
        generationConfig: {
            temperature: opts.temperature ?? 0.7,
            maxOutputTokens: opts.maxTokens ?? 2048,
        },
    };
    if (sys?.content) body.system_instruction = { parts: [{ text: sys.content }] };
    if (opts.json) body.generationConfig.responseMimeType = 'application/json';

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `Gemini error (${res.status})`);
    }
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function callAnthropic(apiKey: string, model: string, opts: LlmChatOptions): Promise<string> {
    const sys = opts.messages.find(m => m.role === 'system');
    const rest = opts.messages.filter(m => m.role !== 'system')
        .map(m => ({ role: m.role, content: m.content }));

    const body = {
        model,
        max_tokens: opts.maxTokens ?? 2048,
        temperature: opts.temperature ?? 0.7,
        system: sys?.content || '',
        messages: rest,
    };
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
    return data?.content?.[0]?.text || '';
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
