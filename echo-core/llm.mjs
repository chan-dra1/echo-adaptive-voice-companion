/**
 * llm.mjs — Echo Core task brain (Node port of the web app's llmRouter).
 *
 * Mirrors services/llmRouter.ts: pluggable providers, BYO-key, free-first
 * preference, with Ollama as the zero-config default so the terminal works
 * offline out of the box. On quota exhaustion (429) it auto-fails-over to the
 * next available provider, and only reports an error when everything is out.
 *
 * Keys are read from env vars first, then from the encrypted store's
 * 'memories' collection under keys like 'apikey:openrouter' (so the web Vault
 * and the terminal share one config). Ollama needs no key.
 *
 * chat({ messages, system, provider? }) → { text, provider, model }
 */

const PROVIDERS = {
    ollama:     { env: null,                  needsKey: false, model: 'llama3' },
    groq:       { env: 'GROQ_API_KEY',        needsKey: true,  model: 'llama-3.1-8b-instant' },
    openrouter: { env: 'OPENROUTER_API_KEY',  needsKey: true,  model: 'meta-llama/llama-3.1-8b-instruct:free' },
    openai:     { env: 'OPENAI_API_KEY',      needsKey: true,  model: 'gpt-4o-mini' },
    mistral:    { env: 'MISTRAL_API_KEY',     needsKey: true,  model: 'mistral-small-latest' },
    anthropic:  { env: 'ANTHROPIC_API_KEY',   needsKey: true,  model: 'claude-3-5-sonnet-20241022' },
};

// Free / local first.
const PREFERENCE = ['ollama', 'groq', 'openrouter', 'mistral', 'openai', 'anthropic'];

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';

export function createLLM(store) {
    /** Resolve a provider's key from env → store('memories' apikey:<p>). */
    function keyFor(provider) {
        const cfg = PROVIDERS[provider];
        if (!cfg.needsKey) return 'local';
        if (cfg.env && process.env[cfg.env]) return process.env[cfg.env];
        const rec = store?.all('memories').find(m => m.key === `apikey:${provider}`);
        return rec?.value || '';
    }

    function available(provider) {
        if (provider === 'ollama') return true; // assume local; call will verify
        return !!keyFor(provider);
    }

    function listAvailable() {
        return PREFERENCE.filter(available);
    }

    async function callOllama(messages, model) {
        const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: model || PROVIDERS.ollama.model, messages, stream: false }),
        });
        if (!res.ok) {
            const t = await res.text().catch(() => '');
            const e = new Error(`Ollama error (${res.status}): ${t.slice(0, 200)}`);
            e.code = res.status;
            throw e;
        }
        const data = await res.json();
        return data?.message?.content || '';
    }

    async function callOpenAICompat(provider, messages, model, key) {
        const base = provider === 'groq' ? 'https://api.groq.com/openai/v1'
            : provider === 'openrouter' ? 'https://openrouter.ai/api/v1'
            : provider === 'mistral' ? 'https://api.mistral.ai/v1'
            : (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1');
        const res = await fetch(`${base}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({ model, messages, temperature: 0.7 }),
        });
        if (!res.ok) {
            const t = await res.text().catch(() => '');
            const e = new Error(`${provider} error (${res.status}): ${t.slice(0, 200)}`);
            e.code = res.status;
            throw e;
        }
        const data = await res.json();
        return data?.choices?.[0]?.message?.content || '';
    }

    async function callAnthropic(messages, model, key) {
        const system = messages.find(m => m.role === 'system')?.content;
        const turns = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model, max_tokens: 2048, system, messages: turns }),
        });
        if (!res.ok) {
            const t = await res.text().catch(() => '');
            const e = new Error(`anthropic error (${res.status}): ${t.slice(0, 200)}`);
            e.code = res.status;
            throw e;
        }
        const data = await res.json();
        return data?.content?.[0]?.text || '';
    }

    async function callProvider(provider, messages) {
        const cfg = PROVIDERS[provider];
        const model = cfg.model;
        if (provider === 'ollama') return { text: await callOllama(messages, model), model };
        const key = keyFor(provider);
        if (!key) { const e = new Error(`No key for ${provider}`); e.code = 'NOKEY'; throw e; }
        if (provider === 'anthropic') return { text: await callAnthropic(messages, model, key), model };
        return { text: await callOpenAICompat(provider, messages, model, key), model };
    }

    /**
     * chat — tries the preferred provider, then fails over through the
     * free-first list on exhaustion/error. Throws only if all fail.
     */
    async function chat({ messages, system, provider }) {
        const msgs = system ? [{ role: 'system', content: system }, ...messages] : messages;

        const order = provider
            ? [provider, ...PREFERENCE.filter(p => p !== provider)]
            : PREFERENCE.slice();

        const errors = [];
        for (const p of order) {
            // skip cloud providers with no key (but always try ollama)
            if (p !== 'ollama' && !keyFor(p)) continue;
            try {
                const { text, model } = await callProvider(p, msgs);
                if (text && text.trim()) return { text, provider: p, model };
                errors.push(`${p}: empty response`);
            } catch (e) {
                const exhausted = e.code === 429 || /quota|rate.?limit|exhaust/i.test(e.message || '');
                errors.push(`${p}: ${e.message}${exhausted ? ' [EXHAUSTED → trying next]' : ''}`);
                // ollama connection refused → not installed/running; keep going
                continue;
            }
        }
        const hint = listAvailable().length <= 1
            ? ' (Only Ollama is configured — is it installed and running? `ollama serve` + `ollama pull llama3`. Or add a cloud key in the Vault.)'
            : '';
        throw new Error(`All task providers failed.${hint}\n` + errors.map(e => '  • ' + e).join('\n'));
    }

    return { chat, listAvailable, keyFor, providers: Object.keys(PROVIDERS) };
}
