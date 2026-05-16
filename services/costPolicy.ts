// MOBILE-AGENT: Cost & speed policy helpers.
//
// Pure functions only — this file MUST NOT import the llm router. The other
// agent's `llmRouter.ts` will import these helpers when it's ready.
//
// Philosophy: favour FREE, fast, small models for the 90% case
// (chat / tool reasoning / summarising). Only step up to a bigger model for
// rewrite/code tasks, and only if a key for the bigger model is available.

import type { LlmProvider } from './llmRouter';

export type TaskKind = 'chat' | 'tool_reason' | 'summarize' | 'code' | 'rewrite';

export interface ModelPick {
    provider: LlmProvider;
    model: string;
    /** Why this pick was chosen (debug / observability). */
    reason: string;
}

const LS_KEY = {
    gemini: 'echo_api_key',
    groq: 'echo_groq_key',
    openrouter: 'echo_openrouter_key',
    openai: 'echo_openai_key',
    anthropic: 'echo_anthropic_key',
    mistral: 'echo_mistral_key',
    huggingface: 'echo_hf_key',
} as const;

function hasKey(provider: keyof typeof LS_KEY): boolean {
    try { return !!localStorage.getItem(LS_KEY[provider]); } catch { return false; }
}

/**
 * Pick a cheap+fast model for a given task. Prefers FREE tiers first.
 *
 * Resolution order, per task:
 *   - chat / tool_reason / summarize:
 *       groq:llama-3.1-8b-instant  →  openrouter:meta-llama/llama-3.1-8b-instruct:free
 *                                   →  gemini:gemini-2.0-flash-exp
 *   - code / rewrite:
 *       groq:llama-3.1-70b-versatile (still free tier)
 *                                   →  openrouter:qwen/qwen-2-7b-instruct:free
 *                                   →  gemini:gemini-2.0-flash-exp
 */
export function pickCheapModel(taskKind: TaskKind): ModelPick {
    const big = taskKind === 'code' || taskKind === 'rewrite';

    if (big) {
        if (hasKey('groq')) {
            return {
                provider: 'groq',
                model: 'llama-3.1-70b-versatile',
                reason: 'groq free tier, larger model for code/rewrite',
            };
        }
        if (hasKey('openrouter')) {
            return {
                provider: 'openrouter',
                model: 'qwen/qwen-2-7b-instruct:free',
                reason: 'openrouter free pool, decent code-quality',
            };
        }
        if (hasKey('gemini')) {
            return {
                provider: 'gemini',
                model: 'gemini-2.0-flash-exp',
                reason: 'gemini flash fallback',
            };
        }
        // Final fallback even if no key — caller will throw on send.
        return { provider: 'gemini', model: 'gemini-2.0-flash-exp', reason: 'no-key fallback' };
    }

    if (hasKey('groq')) {
        return {
            provider: 'groq',
            model: 'llama-3.1-8b-instant',
            reason: 'groq free tier, fastest small model',
        };
    }
    if (hasKey('openrouter')) {
        return {
            provider: 'openrouter',
            model: 'meta-llama/llama-3.1-8b-instruct:free',
            reason: 'openrouter free 8B model',
        };
    }
    if (hasKey('gemini')) {
        return {
            provider: 'gemini',
            model: 'gemini-2.0-flash-exp',
            reason: 'gemini flash fallback',
        };
    }
    return { provider: 'gemini', model: 'gemini-2.0-flash-exp', reason: 'no-key fallback' };
}

/** Soft max_tokens caps per task kind. Keep outputs short = cheaper + faster. */
export function tokenBudget(taskKind: TaskKind): number {
    switch (taskKind) {
        case 'chat': return 1024;
        case 'tool_reason': return 512;
        case 'summarize': return 768;
        case 'code': return 2048;
        case 'rewrite': return 2048;
    }
}

/** Recommended temperature per task. Lower = more deterministic + cheaper retries. */
export function temperatureFor(taskKind: TaskKind): number {
    switch (taskKind) {
        case 'chat': return 0.6;
        case 'tool_reason': return 0.1;
        case 'summarize': return 0.2;
        case 'code': return 0.2;
        case 'rewrite': return 0.4;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Context window policy: keep prompts SMALL.
// ──────────────────────────────────────────────────────────────────────────

export interface ContextMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface ContextWindowOptions {
    /** Approx max characters kept in the rolling window (≈ 4 chars/token). */
    maxChars?: number;
    /** How many of the most recent turns to always keep verbatim. */
    keepLastTurns?: number;
}

/**
 * Returns a function that trims a message history down to the last `keepLastTurns`
 * turns + an optional running-summary slot. If you pass a `summarize` callback,
 * the older messages are collapsed into a single system "Context summary".
 *
 * This is a synchronous trim; if you want to call into a model to summarise,
 * use the optional `summarize` arg.
 */
export function contextWindowPolicy(opts: ContextWindowOptions = {}) {
    const maxChars = opts.maxChars ?? 6000; // ~1500 tokens — fits even small free models
    const keepLastTurns = opts.keepLastTurns ?? 6;

    return function trim(
        messages: ContextMessage[],
        summarize?: (older: ContextMessage[]) => Promise<string> | string,
    ): Promise<ContextMessage[]> | ContextMessage[] {
        if (messages.length <= keepLastTurns + 1) return messages;

        const systemMsgs = messages.filter(m => m.role === 'system');
        const convo = messages.filter(m => m.role !== 'system');
        const tail = convo.slice(-keepLastTurns);
        const head = convo.slice(0, -keepLastTurns);

        // Character budget check on the kept slice
        const tailChars = tail.reduce((n, m) => n + m.content.length, 0);
        if (tailChars > maxChars) {
            // Truncate oldest of the tail
            while (tail.length > 1 && tail.reduce((n, m) => n + m.content.length, 0) > maxChars) {
                tail.shift();
            }
        }

        if (head.length === 0) {
            return [...systemMsgs, ...tail];
        }

        if (!summarize) {
            // Simple heuristic summary — last assistant + count of older turns.
            const note: ContextMessage = {
                role: 'system',
                content: `[Context summary: ${head.length} earlier turns elided to save tokens.]`,
            };
            return [...systemMsgs, note, ...tail];
        }

        const result = summarize(head);
        const wrap = (s: string): ContextMessage => ({
            role: 'system',
            content: `[Context summary]\n${s}`,
        });
        if (result instanceof Promise) {
            return result.then(s => [...systemMsgs, wrap(s), ...tail]);
        }
        return [...systemMsgs, wrap(result), ...tail];
    };
}

// ──────────────────────────────────────────────────────────────────────────
// System prompts — short for cheap turns, full for the Live voice session.
// ──────────────────────────────────────────────────────────────────────────

/** ~200 token system prompt for short, cheap text-only turns on small models. */
export const MICRO_SYSTEM_PROMPT = `You are Echo — a fast, terse personal AI agent.
- Be direct. No filler, no apologies, no "as an AI".
- Pure signal. Markdown only when the user clearly wants it.
- Use memory from [USER CONTEXT] as ground truth.
- If a task needs a tool, call the tool; don't narrate the tool call.
- Default to ≤ 4 sentences unless the user asks for more.`;

/** Rich system prompt — only use this on capable models where token cost is fine. */
export const FULL_SYSTEM_PROMPT = `You are Echo, the user's personal AI agent and Matrix-grade cognitive companion.
You are deeply integrated into the user's digital life — proactive, precise, and exceptionally capable.

Guidelines:
- Use [LONG TERM MEMORY] and [USER CONTEXT] as absolute ground truth.
- Aggressively save NEW facts/preferences/goals via the updateMemory tool.
- Prefer concise replies; expand only when explicitly asked.
- Use the right tool for the task (reminders, files, search, code) without narrating.
- Honest about limits: if you don't know, say so. Never fabricate.
- Be blazingly fast and conversational; you are talking to one person you know well.`;
