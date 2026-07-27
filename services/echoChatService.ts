/**
 * EchoChatService - Text-mode chat that delegates routing & provider
 * fan-out to llmRouter. System prompt construction is delegated to
 * modelContextBuilder so live audio + text share the same memory/style
 * pipeline (with cloud `local_only` filtering).
 *
 * Runs a bounded tool-call loop: if the model requests a skill (via the
 * same agentSkillService registry the voice/Live path uses), it's executed
 * and the result fed back for a follow-up turn, up to MAX_TOOL_HOPS times,
 * before returning final text. This is what lets text chat actually invoke
 * skills instead of only talking about them.
 */
import { archiveService } from './archiveService';
import { chat, chatStream, chooseProvider, LlmProvider, LlmMessage, destinationFor } from './llmRouter';
import { buildSystemContext } from './modelContextBuilder';
import { agentSkillService } from './agentSkillService';

export interface ChatTurn {
    role: 'user' | 'assistant';
    content: string;
}

/** Cap on tool round-trips per user message, so a confused model can't loop forever. */
const MAX_TOOL_HOPS = 4;

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
     *
     * Pass onToken to stream the reply incrementally — gemini and the
     * OpenAI-compat providers (groq/openrouter/openai/mistral) stream real
     * tokens; other providers flush the full text as one chunk (see
     * llmRouter.chatStream for details). Streaming only applies to the
     * final text-generating turn — tool-resolution hops are non-streaming
     * by nature (there's no text to show until the tool result comes back).
     */
    async sendMessage(
        provider: string | LlmProvider,
        _apiKey: string,
        userMessage: string,
        onToken?: (delta: string) => void,
    ): Promise<string> {
        this.history.push({ role: 'user', content: userMessage });
        archiveService.saveConversation(this.getSessionId(), this.history).catch(() => { });

        const chosen = chooseProvider(provider as LlmProvider);
        const { systemInstruction } = buildSystemContext({
            destination: destinationFor(chosen),
            provider: chosen,
        });

        const tools = agentSkillService.getTools();
        const messages: LlmMessage[] = [
            { role: 'system', content: systemInstruction },
            ...this.history.map(t => ({ role: t.role, content: t.content }) as LlmMessage),
        ];

        try {
            let finalText = '';
            for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
                const isLastPossibleHop = hop === MAX_TOOL_HOPS - 1;
                const result = onToken
                    ? await chatStream({ messages, provider: chosen, temperature: 0.8, tools }, onToken)
                    : await chat({ messages, provider: chosen, temperature: 0.8, tools });

                if (result.toolCalls?.length && !isLastPossibleHop) {
                    messages.push({ role: 'assistant', content: result.text, toolCalls: result.toolCalls });
                    for (const tc of result.toolCalls) {
                        const toolResult = await agentSkillService
                            .executeTool(tc.name, tc.args)
                            .catch((e: any) => ({ error: e?.message || 'Tool execution failed' }));
                        messages.push({
                            role: 'tool',
                            content: JSON.stringify(toolResult),
                            toolCallId: tc.id,
                            name: tc.name,
                        });
                    }
                    continue;
                }
                finalText = result.text;
                break;
            }

            console.log(`[EchoChatService] ${chosen} → ${finalText.length} chars`);
            const reply = finalText || 'No response.';
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
