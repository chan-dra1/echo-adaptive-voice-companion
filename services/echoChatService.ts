/**
 * EchoChatService - Text-mode chat that delegates routing & provider
 * fan-out to llmRouter. System prompt construction is delegated to
 * modelContextBuilder so live audio + text share the same memory/style
 * pipeline (with cloud `local_only` filtering).
 *
 * Runs a bounded tool-call loop: if the model requests a skill (via the
 * same agentSkillService registry the voice/Live path uses), it's executed
 * and the result fed back for a follow-up turn, up to MAX_TOOL_HOPS times,
 * before returning final text.
 *
 * Three cost/scale mechanisms layer on top of that loop:
 *   1. Prompt caching  — the stable slice of the system prompt is marked so
 *      providers can cache it instead of reprocessing it every turn.
 *   2. Tool search     — past ~40 registered skills, full schemas are replaced
 *      by a compact directory + search/call meta-tools (see toolSearchService).
 *   3. Compaction      — long histories are summarized instead of growing
 *      without bound until the context window blows.
 */
import { archiveService } from './archiveService';
import { chat, chatStream, chooseProvider, LlmProvider, LlmMessage, LlmToolDef, destinationFor } from './llmRouter';
import { buildSystemContext } from './modelContextBuilder';
import { agentSkillService } from './agentSkillService';
import {
    shouldUseToolSearch,
    buildToolDirectory,
    TOOL_SEARCH_META_TOOLS,
    isToolSearchMetaTool,
    executeToolSearchMetaTool,
} from './toolSearchService';
import { spawnSubAgentToolDeclaration, executeSpawnSubAgentTool } from './subAgentService';

export interface ChatTurn {
    role: 'user' | 'assistant';
    content: string;
}

/**
 * Cap on tool round-trips per user message, so a confused model can't loop
 * forever. Kept deliberately tight — this is on the interactive latency path.
 * In tool-search mode two of these hops are spent on search→call, so the cap
 * is raised there (see effectiveHopCap) to leave the same room for real work.
 */
const MAX_TOOL_HOPS = 4;
const MAX_TOOL_HOPS_SEARCH_MODE = 6;

/**
 * Compaction thresholds. Character-based rather than a real tokenizer: this
 * only needs to decide *when* to summarize, and ~4 chars/token is close enough
 * for that. Pulling in a tokenizer for a threshold check isn't worth the bundle.
 */
const COMPACT_TRIGGER_CHARS = 32_000;   // ≈8k tokens of history
const KEEP_RECENT_TURNS = 6;            // most recent turns always survive verbatim

class EchoChatService {
    private history: ChatTurn[] = [];
    private currentSessionId: string | null = null;
    /** Rolling summary of turns already compacted away. */
    private compactedSummary = '';

    private getSessionId(): string {
        if (!this.currentSessionId) {
            this.currentSessionId = `session_${Date.now()}`;
        }
        return this.currentSessionId;
    }

    private historyChars(): number {
        return this.history.reduce((n, t) => n + t.content.length, 0);
    }

    /**
     * Summarize the oldest turns into `compactedSummary` and drop them from
     * history, keeping the most recent turns verbatim.
     *
     * Uses a cheap, non-streaming, tool-less call on the same provider — the
     * summary is throwaway plumbing, not user-facing output, so it shouldn't
     * pay for tools or a strong model. Failure is non-fatal: if the summarizer
     * errors we keep the full history rather than silently losing context, and
     * simply try again next turn.
     */
    private async compactIfNeeded(provider: LlmProvider): Promise<void> {
        if (this.historyChars() < COMPACT_TRIGGER_CHARS) return;
        if (this.history.length <= KEEP_RECENT_TURNS) return;

        const olderTurns = this.history.slice(0, this.history.length - KEEP_RECENT_TURNS);
        const recentTurns = this.history.slice(this.history.length - KEEP_RECENT_TURNS);

        const transcript = olderTurns
            .map(t => `${t.role === 'user' ? 'User' : 'Echo'}: ${t.content}`)
            .join('\n');

        const prompt =
            (this.compactedSummary
                ? `Existing summary of even earlier conversation:\n${this.compactedSummary}\n\n`
                : '') +
            `Conversation to fold into that summary:\n${transcript}\n\n` +
            `Write an updated summary of the whole conversation so far. Preserve: ` +
            `facts about the user, decisions made, open questions, task state, and any ` +
            `commitments Echo made. Drop pleasantries and redundancy. Be dense and factual.`;

        try {
            const { text } = await chat({
                provider,
                temperature: 0.3,
                maxTokens: 1024,
                messages: [
                    { role: 'system', content: 'You compress conversation history for an AI assistant. Output only the summary.' },
                    { role: 'user', content: prompt },
                ],
            });
            if (text?.trim()) {
                this.compactedSummary = text.trim();
                this.history = recentTurns;
                console.log(`[EchoChatService] compacted ${olderTurns.length} turns → ${this.compactedSummary.length} chars`);
            }
        } catch (e) {
            console.warn('[EchoChatService] compaction failed, keeping full history:', e);
        }
    }

    /** Route a tool call to the right executor. */
    private async dispatchTool(name: string, args: any): Promise<any> {
        if (isToolSearchMetaTool(name)) return executeToolSearchMetaTool(name, args);
        if (name === spawnSubAgentToolDeclaration.name) return executeSpawnSubAgentTool(name, args);
        return agentSkillService.executeTool(name, args);
    }

    /**
     * Send a message and get the assistant reply. The legacy two-arg call
     * site (provider, apiKey, message) is still supported but both keys are
     * now resolved by llmRouter from localStorage.
     *
     * Pass onToken to stream the reply incrementally — gemini and the
     * OpenAI-compat providers stream real tokens; others flush the full text
     * as one chunk. Streaming applies to the final text-generating turn only;
     * tool-resolution hops are non-streaming by nature.
     */
    async sendMessage(
        provider: string | LlmProvider,
        _apiKey: string,
        userMessage: string,
        onToken?: (delta: string) => void,
    ): Promise<string> {
        const chosen = chooseProvider(provider as LlmProvider);

        // Compact BEFORE appending the new turn so this message is never the
        // one summarized away.
        await this.compactIfNeeded(chosen);

        this.history.push({ role: 'user', content: userMessage });
        archiveService.saveConversation(this.getSessionId(), this.history).catch(() => { });

        const { systemInstruction, cacheableSystemPrefix } = buildSystemContext({
            destination: destinationFor(chosen),
            provider: chosen,
        });

        const allTools = agentSkillService.getTools();
        const useSearch = shouldUseToolSearch(allTools.length);

        // In search mode the registry moves from schemas → a directory line in
        // the system prompt, so it rides inside the cacheable prefix instead of
        // being re-sent as structured tool JSON on every request.
        const directory = useSearch ? buildToolDirectory(allTools) : '';
        const stablePrefix = cacheableSystemPrefix + directory;
        const summaryBlock = this.compactedSummary
            ? `\n\n[EARLIER CONVERSATION SUMMARY]\n${this.compactedSummary}`
            : '';
        // Summary sits after the cacheable prefix: it changes when compaction
        // fires, and must not invalidate the stable region.
        const fullSystem = stablePrefix + summaryBlock + systemInstruction.slice(cacheableSystemPrefix.length);

        const tools: LlmToolDef[] = useSearch
            ? [...TOOL_SEARCH_META_TOOLS, spawnSubAgentToolDeclaration]
            : [...allTools, spawnSubAgentToolDeclaration];

        const messages: LlmMessage[] = [
            { role: 'system', content: fullSystem },
            ...this.history.map(t => ({ role: t.role, content: t.content }) as LlmMessage),
        ];

        const hopCap = useSearch ? MAX_TOOL_HOPS_SEARCH_MODE : MAX_TOOL_HOPS;

        try {
            let finalText = '';
            for (let hop = 0; hop < hopCap; hop++) {
                const isLastPossibleHop = hop === hopCap - 1;
                const req = {
                    messages,
                    provider: chosen,
                    temperature: 0.8,
                    // On the final hop, withhold tools entirely. Otherwise the
                    // model can spend its last turn requesting another call we
                    // have no budget to execute, returning tool calls and no
                    // text — which surfaced to the user as the bare string
                    // "No response." Removing tools forces a text answer, so a
                    // hop-capped turn degrades into "here's what I found so
                    // far" instead of an apparent failure.
                    tools: isLastPossibleHop ? undefined : tools,
                    cacheableSystemPrefix: stablePrefix,
                };
                const result = onToken
                    ? await chatStream(req, onToken)
                    : await chat(req);

                if (result.toolCalls?.length && !isLastPossibleHop) {
                    messages.push({ role: 'assistant', content: result.text, toolCalls: result.toolCalls });
                    for (const tc of result.toolCalls) {
                        const toolResult = await this.dispatchTool(tc.name, tc.args)
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

            console.log(`[EchoChatService] ${chosen} → ${finalText.length} chars (toolSearch=${useSearch}, tools=${allTools.length})`);
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
        this.compactedSummary = '';
        this.currentSessionId = null;
    }
}

export const echoChatService = new EchoChatService();
