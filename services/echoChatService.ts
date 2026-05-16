/**
 * EchoChatService - Text-mode chat that delegates routing & provider
 * fan-out to llmRouter. System prompt construction is delegated to
 * modelContextBuilder so live audio + text share the same memory/style
 * pipeline (with cloud `local_only` filtering).
 */
import { archiveService } from './archiveService';
import { chat, chooseProvider, LlmProvider, LlmMessage, destinationFor } from './llmRouter';
import { buildSystemContext } from './modelContextBuilder';

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

    /**
     * Send a message and get the assistant reply. The legacy two-arg call
     * site (provider, apiKey, message) is still supported but both keys are
     * now resolved by llmRouter from localStorage.
     */
    async sendMessage(provider: string | LlmProvider, _apiKey: string, userMessage: string): Promise<string> {
        this.history.push({ role: 'user', content: userMessage });
        archiveService.saveConversation(this.getSessionId(), this.history).catch(() => { });

        const chosen = chooseProvider(provider as LlmProvider);
        const { systemInstruction } = buildSystemContext({
            destination: destinationFor(chosen),
            provider: chosen,
        });

        const messages: LlmMessage[] = [
            { role: 'system', content: systemInstruction },
            ...this.history.map(t => ({ role: t.role, content: t.content }) as LlmMessage),
        ];

        try {
            const { text, provider: usedProvider, model } = await chat({
                messages,
                provider: chosen,
                temperature: 0.8,
            });
            console.log(`[EchoChatService] ${usedProvider}/${model} → ${text.length} chars`);
            const reply = text || 'No response.';
            this.history.push({ role: 'assistant', content: reply });
            archiveService.saveConversation(this.getSessionId(), this.history).catch(() => { });
            return reply;
        } catch (error) {
            throw error;
        }
    }

    clearHistory() {
        this.history = [];
        this.currentSessionId = null;
    }
}

export const echoChatService = new EchoChatService();
