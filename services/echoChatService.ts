/**
 * EchoChatService - Text chat with unified multi-provider routing
 * Supports: Gemini, OpenAI, Anthropic, Groq, NVIDIA, OpenRouter
 */
import { ECHO_SYSTEM_INSTRUCTION } from '../constants';
import { getMemories } from './memoryService';
import { archiveService } from './archiveService';
import { buildKnowledgeContext } from './conversationService';

export interface ChatTurn {
    role: 'user' | 'assistant';
    content: string;
}

class EchoChatService {
    private history: ChatTurn[] = [];
    private currentSessionId: string | null = null;

    private getSessionId(): string {
        if (!this.currentSessionId) {
            this.currentSessionId = `session_${Date.now()}`;
        }
        return this.currentSessionId;
    }

    async sendMessage(provider: string, apiKey: string, userMessage: string): Promise<string> {
        this.history.push({ role: 'user', content: userMessage });

        // Save to local disk asynchronously (will silently fail if server.py isn't running)
        archiveService.saveConversation(this.getSessionId(), this.history).catch(() => { });

        console.log(`[EchoChatService] Provider: ${provider}, Key prefix: ${apiKey.substring(0, 8)}...`);

        try {
            const reply = await this.routeRequest(provider, apiKey, userMessage);
            this.history.push({ role: 'assistant', content: reply });
            archiveService.saveConversation(this.getSessionId(), this.history).catch(() => { });
            return reply;
        } catch (error) {
            throw error;
        }
    }

    private async routeRequest(provider: string, apiKey: string, _latestMessage: string): Promise<string> {
        const memories = getMemories();
        const memContext = memories.length > 0
            ? '\n\n[LONG TERM MEMORY]\n' + memories.map(m => `${m.key}: ${m.value}`).join('\n')
            : '';
        const globalKnowledge = buildKnowledgeContext();
        const docContext = globalKnowledge.length > 0
            ? `\n\n[UPLOADED FILE KNOWLEDGE]\n${globalKnowledge}`
            : '';
        const systemInstruction = ECHO_SYSTEM_INSTRUCTION + memContext + docContext;

        console.log(`[EchoChatService] Routing to: ${provider}`);

        switch (provider) {
            case 'openai':
                return this.fetchOpenAiCompatible('https://api.openai.com/v1/chat/completions', 'gpt-4o-mini', apiKey, systemInstruction);
            case 'groq':
                return this.fetchOpenAiCompatible('https://api.groq.com/openai/v1/chat/completions', 'llama3-70b-8192', apiKey, systemInstruction);
            case 'nvidia':
                return this.fetchOpenAiCompatible('https://integrate.api.nvidia.com/v1/chat/completions', 'meta/llama-3.1-70b-instruct', apiKey, systemInstruction);
            case 'openrouter':
                return this.fetchOpenAiCompatible(
                    'https://openrouter.ai/api/v1/chat/completions',
                    'nvidia/nemotron-nano-9b-v2:free',
                    apiKey,
                    systemInstruction,
                    { 'HTTP-Referer': 'https://echo-adaptive-voice-companion.vercel.app', 'X-Title': 'Echo AI Companion' }
                );
            case 'anthropic':
                return this.fetchAnthropic(apiKey, systemInstruction);
            case 'gemini':
            default:
                return this.fetchGemini(apiKey, systemInstruction);
        }
    }

    private async fetchOpenAiCompatible(
        url: string,
        model: string,
        apiKey: string,
        systemInstruction: string,
        extraHeaders: Record<string, string> = {}
    ): Promise<string> {
        const messages = [
            { role: 'system', content: systemInstruction },
            ...this.history.map(t => ({ role: t.role, content: t.content }))
        ];

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                ...extraHeaders
            },
            body: JSON.stringify({ model, messages, temperature: 0.8 })
        });

        if (!res.ok) {
            const errText = await res.text();
            console.error(`[EchoChatService] Error from ${url}:`, errText);
            let errMsg = `API Error (${res.status})`;
            try {
                const parsed = JSON.parse(errText);
                errMsg = parsed?.error?.message || parsed?.message || errMsg;
            } catch { /* ignore */ }
            throw new Error(errMsg);
        }

        const data = await res.json();
        return data.choices?.[0]?.message?.content || 'No response.';
    }

    private async fetchAnthropic(apiKey: string, systemInstruction: string): Promise<string> {
        const messages = this.history.map(t => ({ role: t.role, content: t.content }));

        const body = {
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 2048,
            system: systemInstruction,
            messages: messages,
            temperature: 0.8
        };

        // Proxy through server.py to avoid CORS blocks
        const res = await fetch('http://localhost:8000/llm/anthropic', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey
            },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error?.message || err.error || 'Anthropic Proxy Error');
        }

        const data = await res.json();
        return data.content?.[0]?.text || 'No response.';
    }

    private async fetchGemini(apiKey: string, systemInstruction: string): Promise<string> {
        const contents = this.history.map(t => ({
            role: t.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: t.content }],
        }));

        const body: any = {
            system_instruction: { parts: [{ text: systemInstruction }] },
            contents,
            tools: [{ googleSearch: {} }],
            generationConfig: {
                temperature: 0.8,
                maxOutputTokens: 2048,
            },
        };

        const model = 'gemini-2.5-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error?.message || 'Gemini API Error');
        }

        const data = await res.json();
        return data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response.';
    }

    clearHistory() {
        this.history = [];
        this.currentSessionId = null;
    }
}

export const echoChatService = new EchoChatService();
