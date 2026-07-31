/**
 * modelContextBuilder.ts
 *
 * Single source of truth for the system instruction sent to ANY model
 * (Gemini Live or text-mode providers). Centralizing this guarantees the
 * `local_only` filter is applied consistently when the destination is a
 * remote cloud provider, and that style-mirroring + personalization land
 * in both pipelines.
 */

import { ECHO_SYSTEM_INSTRUCTION } from '../constants';
import { getMemories } from './memoryService';
import { buildKnowledgeContext } from './conversationService';
import { getCached } from './cryptoService';
import { getCompanionModeInstruction, getPersonalityInstruction } from './companionPersonaService';
import { buildLifeCoachContext } from './lifeCoachService';
import { buildDeadlineContext } from './deadlineGuardianService';
import { buildMonthPlanContext } from './monthlyPlannerService';
import { formatRagContext } from './ragService';

// Cache the last RAG context so we can inject it synchronously.
// ragService.query() is async — callers set this before buildSystemContext().
let _pendingRagContext = '';
export function setRagContext(ctx: string): void { _pendingRagContext = ctx; }
export function clearRagContext(): void { _pendingRagContext = ''; }

const STYLE_EXAMPLES_KEY = 'echo_style_examples';

export type ContextDestination = 'cloud' | 'local';

export interface BuildContextOptions {
    /** Where this context is going. Cloud → filter local_only memories. */
    destination: ContextDestination;
    /** Provider id, for logging only. */
    provider?: string;
    /** Additional system instruction to append (e.g. mode-specific). */
    extraInstructions?: string;
    /** If false, skip personalized learning + knowledge contexts. */
    includeKnowledge?: boolean;
}

export interface BuildContextResult {
    systemInstruction: string;
    /**
     * The leading slice of `systemInstruction` that is stable across turns
     * within a session (identity, persona, memories, goals, style). Always a
     * literal prefix of `systemInstruction`.
     *
     * Providers that support prompt caching mark the boundary here so this
     * chunk is billed/processed once instead of re-sent every turn. Everything
     * after it (currently RAG hits, which are recomputed per query) is the
     * volatile tail and must stay outside the cached region — caching a block
     * that changes every turn is worse than not caching at all, since each
     * miss still pays the cache-write premium.
     */
    cacheableSystemPrefix: string;
    /** Counts of what got included — for local debug log only. */
    debug: {
        memoryCount: number;
        memoryFiltered: number;
        knowledgeIncluded: boolean;
        styleExamplesIncluded: boolean;
        destination: ContextDestination;
        provider?: string;
        /** Chars in the cacheable prefix vs the volatile tail — useful for tuning. */
        stableChars: number;
        volatileChars: number;
    };
}

function getStyleExamples(): string[] {
    const arr = getCached<string[]>(STYLE_EXAMPLES_KEY, []);
    return Array.isArray(arr) ? arr.filter(s => typeof s === 'string' && s.trim().length > 0) : [];
}

/**
 * Build the full system instruction. The caller controls whether knowledge
 * snippets are appended — for Gemini Live we usually want them in; for
 * one-off tool reasoning calls (router) we may want to keep the prompt
 * lean.
 */
export function buildSystemContext(opts: BuildContextOptions): BuildContextResult {
    const memories = getMemories();
    const safe = opts.destination === 'cloud'
        ? memories.filter(m => (m.sensitivity || 'cloud_ok') !== 'local_only')
        : memories;

    const filteredOut = memories.length - safe.length;

    let memContext = '';
    if (safe.length > 0) {
        memContext = `\n\n[LONG TERM MEMORY]\n` +
            safe.map(m => `- ${m.key}: ${m.value}`).join('\n');
    }

    const knowledge = opts.includeKnowledge === false ? '' : buildKnowledgeContext();
    const examples = getStyleExamples();
    const styleBlock = examples.length > 0
        ? `\n\n[USER VOICE / STYLE EXAMPLES]\nWhen replying, mirror the user's tone, vocabulary, sentence length and energy. Use these examples as a calibration reference (do not parrot them):\n` +
        examples.map((e, i) => `Example ${i + 1}: "${e.trim()}"`).join('\n')
        : '';

    const extra = opts.extraInstructions ? `\n\n${opts.extraInstructions}` : '';

    // Companion persona — always local (contains personal data)
    const companionInstruction = `\n\n[COMPANION PERSONA]\n${getCompanionModeInstruction()}\n${getPersonalityInstruction()}`;

    // Life coach context (habits, goals, mood) — local_only equivalent, never filter
    const lifeCoachCtx = buildLifeCoachContext();
    const lifeCoachBlock = lifeCoachCtx ? `\n\n${lifeCoachCtx}` : '';

    // Deadline guardian — critical context
    const deadlineCtx = buildDeadlineContext();
    const deadlineBlock = deadlineCtx ? `\n\n${deadlineCtx}` : '';

    // Month plan — current month's mission + weekly targets
    const monthPlanCtx = buildMonthPlanContext();
    const monthPlanBlock = monthPlanCtx ? `\n\n${monthPlanCtx}` : '';

    // RAG retrieved knowledge (set async before connect via setRagContext)
    const ragBlock = _pendingRagContext
        ? `\n\n${_pendingRagContext}`
        : '';

    // ORDER MATTERS FOR PROMPT CACHING. Everything stable within a session goes
    // first and forms the cacheable prefix; the volatile RAG block goes LAST.
    //
    // This is a deliberate reorder: ragBlock used to sit in the middle (before
    // styleBlock/extra), which meant a per-query RAG change shifted every byte
    // after it and made the whole prompt uncacheable. Semantically the model
    // treats these as labelled sections either way, so tail-positioning the
    // retrieved snippets costs nothing and buys a large stable prefix.
    const cacheableSystemPrefix =
        ECHO_SYSTEM_INSTRUCTION +
        companionInstruction +
        memContext +
        lifeCoachBlock +
        deadlineBlock +
        monthPlanBlock +
        knowledge +
        styleBlock +
        extra;

    const systemInstruction = cacheableSystemPrefix + ragBlock;

    const debug = {
        memoryCount: safe.length,
        memoryFiltered: filteredOut,
        knowledgeIncluded: !!knowledge && opts.includeKnowledge !== false,
        styleExamplesIncluded: examples.length > 0,
        destination: opts.destination,
        provider: opts.provider,
        stableChars: cacheableSystemPrefix.length,
        volatileChars: ragBlock.length,
    };

    if (filteredOut > 0) {
        console.log(`[modelContext] Excluded ${filteredOut} local_only memories from ${opts.destination} destination (${opts.provider || 'unknown provider'}).`);
    }

    return { systemInstruction, cacheableSystemPrefix, debug };
}

export function getStyleExamplesPublic(): string[] {
    return getStyleExamples();
}
