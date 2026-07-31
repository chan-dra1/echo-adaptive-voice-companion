/**
 * subAgentService.ts
 *
 * Background sub-agent spawning for Echo, modeled on OpenClaw's
 * `sessions_spawn`: the main conversational turn (echoChatService's bounded
 * 4-hop loop, MAX_TOOL_HOPS in echoChatService.ts) stays fast and
 * voice-latency-safe, while slow/parallel/multi-step work runs in an
 * isolated background session with its own (longer) tool loop and reports
 * back via a push event instead of blocking the caller.
 *
 * Why this needs to be a separate loop from echoChatService's, not just a
 * bigger hop cap on the main one: the main loop's hop budget is a *latency*
 * budget — every hop happens while the user is waiting for Echo to speak.
 * A sub-agent has no listener waiting on it turn-by-turn, so it can afford
 * many more hops, but that budget must still be finite (see MAX_SUBAGENT_HOPS)
 * because every hop is a real, metered LLM API call.
 *
 * Safety model (this matters — these are paid API calls the user is funding):
 *   - MAX_CONCURRENT_SUBAGENTS: hard ceiling on sub-agents running at once.
 *   - MAX_SUBAGENT_HOPS: hard ceiling on tool round-trips per sub-agent run.
 *   - RUN_TIMEOUT_MS: wall-clock cap per run; a hung provider call or a
 *     model stuck alternating tool calls forever gets killed regardless of
 *     hop count.
 *   - MAX_SPAWN_DEPTH: sub-agents can be given the spawn tool themselves
 *     (agentic recursion is genuinely useful — a research sub-agent
 *     delegating sub-searches), but depth is tracked and capped so that
 *     can't fan out unboundedly. A depth-capped sub-agent simply doesn't
 *     receive the spawn tool in its own tool list, so it physically cannot
 *     request another hop of recursion — no reliance on the model
 *     "choosing" to behave.
 *
 * Context modes (cost tradeoff is the whole point of exposing this):
 *   - 'isolated' (default): the sub-agent starts from a short task-only
 *     system+user message pair. Cheapest — no parent history is replayed
 *     into every hop's token count. Right for self-contained work ("research
 *     X and summarize") where the parent conversation isn't needed.
 *   - 'fork': the caller supplies `parentContext` (a slice of the parent's
 *     LlmMessage[] history) and it's prepended verbatim. More expensive
 *     (every one of those messages is re-sent — and re-billed — on every
 *     hop of the sub-agent's own loop) but necessary when the task requires
 *     conversational context the isolated task string can't cheaply restate.
 *
 * Completion is push-based, matching the codebase's existing
 * dispatchEvent(CustomEvent) + onChange(cb) idiom (see agentSkillService.ts,
 * dynamicSkillService.ts's 'echo:skill:degraded'): subscribe via
 * subAgentService.onChange(), or listen for 'echo:subagent:completed' /
 * 'echo:subagent:failed' on window. No polling required.
 */

import { chat, LlmMessage, LlmProvider, LlmToolCall } from './llmRouter';
import { agentSkillService, ToolDefinition } from './agentSkillService';
import { FunctionDeclaration, Type } from '@google/genai';

/** Tool round-trip cap per sub-agent run. Higher than the parent's
 *  MAX_TOOL_HOPS=4 (see echoChatService.ts) because a sub-agent is off the
 *  conversational-latency path — nobody is staring at a silent mic waiting
 *  on hop #40. Raised from the original 12 to actually support real coding
 *  work delegated via spawn_sub_agent: a single debug cycle (read a file,
 *  make an edit, run a test, see it fail, fix it, re-run) alone can burn
 *  5-6 hops, and a genuine multi-file task needs several such cycles. Still
 *  a hard, finite number — a confused model can't spin forever burning API
 *  calls unattended, it just has real room to actually finish something
 *  non-trivial before hitting the wall. */
const MAX_SUBAGENT_HOPS = 40;

/** Hard ceiling on sub-agents running at the same time, across the whole
 *  app. Background work is still real, metered API traffic — an unbounded
 *  fan-out (e.g. a model that spawns one sub-agent per search result) could
 *  otherwise burn the user's quota far faster than any single conversation
 *  could. spawnSubAgent() rejects new runs once this is hit; the caller
 *  (the model) sees the rejection as a tool result and can retry later or
 *  work sequentially instead. */
const MAX_CONCURRENT_SUBAGENTS = 3;

/** Wall-clock cap per run, independent of hop count. A single hop can still
 *  hang (slow provider, dead network) even inside the hop budget, so this
 *  is a second, orthogonal backstop — whichever limit is hit first wins.
 *  Raised alongside MAX_SUBAGENT_HOPS (12→40): a 5-minute cap would make the
 *  higher hop budget mostly theoretical, since 40 real model+tool round
 *  trips plausibly take longer than that on their own. */
const RUN_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/** How many spawn-of-a-spawn levels are allowed. Depth 0 = a sub-agent
 *  spawned directly by the main conversation. A run at MAX_SPAWN_DEPTH does
 *  not get spawn_sub_agent in its own tool list (see buildToolsForDepth),
 *  so recursion is capped structurally, not just by convention. */
const MAX_SPAWN_DEPTH = 2;

export type SubAgentStatus = 'running' | 'done' | 'failed' | 'timeout' | 'cancelled';

export type SubAgentContextMode = 'isolated' | 'fork';

export interface SpawnSubAgentOptions {
    /** The task the sub-agent should complete, in natural language. Stands
     *  alone as the sub-agent's user message in 'isolated' mode, or is
     *  appended after `parentContext` in 'fork' mode. */
    task: string;
    /** 'isolated' (default) = cheap, fresh context. 'fork' = seeded with
     *  parentContext, costs more per hop. See module doc. */
    contextMode?: SubAgentContextMode;
    /** Only meaningful with contextMode: 'fork'. A slice of the parent
     *  conversation's LlmMessage[] to prepend, e.g. the last few turns. */
    parentContext?: LlmMessage[];
    /** Optional short label for display (registry / UI), independent of
     *  the full task text. Falls back to a truncated task string. */
    label?: string;
    /** Optional provider override — lets the caller run children on a
     *  cheaper model/provider than the parent conversation is using. */
    provider?: LlmProvider;
    /** Optional model override (paired with `provider`, or standalone). */
    model?: string;
    /** Internal: recursion depth. Do not set this from user-facing call
     *  sites — spawnSubAgent sets it to 0 by default and increments it for
     *  sub-agents that spawn their own children via the tool loop. */
    depth?: number;
}

export interface SubAgentRun {
    id: string;
    label: string;
    task: string;
    status: SubAgentStatus;
    contextMode: SubAgentContextMode;
    provider?: LlmProvider;
    model?: string;
    depth: number;
    hopsUsed: number;
    createdAt: number;
    finishedAt?: number;
    /** Final text result, present once status is 'done'. */
    result?: string;
    /** Error/timeout message, present once status is 'failed' | 'timeout'. */
    error?: string;
}

/** Fired on window as 'echo:subagent:started' | 'echo:subagent:completed' |
 *  'echo:subagent:failed' | 'echo:subagent:cancelled', each with
 *  `detail: { run: SubAgentRun }`, in addition to the onChange(cb) registry
 *  subscription below — matches the two-track notify idiom already used by
 *  dynamicSkillService ('echo:skill:degraded') and agentSkillService
 *  (onChange). Use whichever fits the listening code better. */
type SubAgentEventName =
    | 'echo:subagent:started'
    | 'echo:subagent:completed'
    | 'echo:subagent:failed'
    | 'echo:subagent:cancelled';

function emitWindowEvent(name: SubAgentEventName, run: SubAgentRun): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(name, { detail: { run } }));
}

class SubAgentService {
    private runs = new Map<string, SubAgentRun>();
    private cancelFlags = new Map<string, boolean>();
    private listeners = new Set<(runs: SubAgentRun[]) => void>();

    /** Subscribe to any registry change (new run, status update, completion).
     *  Returns an unsubscribe function — same shape as
     *  agentSkillService.onChange(). Callback receives a fresh snapshot
     *  array (newest-first) so consumers can render straight off it. */
    onChange(cb: (runs: SubAgentRun[]) => void): () => void {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }

    private emit(): void {
        const snapshot = this.list();
        for (const l of this.listeners) {
            try { l(snapshot); } catch { /* ignore listener errors */ }
        }
    }

    /** All known runs (running + completed + failed), newest first. The
     *  registry is in-memory only and resets on page reload by design —
     *  sub-agent runs are ephemeral background work, not persisted state. */
    list(): SubAgentRun[] {
        return Array.from(this.runs.values()).sort((a, b) => b.createdAt - a.createdAt);
    }

    get(id: string): SubAgentRun | undefined {
        return this.runs.get(id);
    }

    private countRunning(): number {
        let n = 0;
        for (const r of this.runs.values()) if (r.status === 'running') n++;
        return n;
    }

    /** Request cancellation of a running sub-agent. Cooperative: the loop
     *  checks the flag between hops, so a call already in flight to the LLM
     *  provider still finishes that one network round-trip before stopping —
     *  there's no way to abort a fetch() already awaited inside chat(). */
    cancel(id: string): boolean {
        const run = this.runs.get(id);
        if (!run || run.status !== 'running') return false;
        this.cancelFlags.set(id, true);
        return true;
    }

    /**
     * Spawn a sub-agent to run `opts.task` in the background. Returns
     * immediately with the run's id — does NOT await completion. Subscribe
     * via onChange() or the 'echo:subagent:*' window events to learn when
     * it finishes.
     *
     * Throws synchronously (before any run is registered) if the concurrent
     * cap is already at MAX_CONCURRENT_SUBAGENTS, so the caller (typically
     * the model, via executeSpawnSubAgentTool) gets an immediate, cheap
     * rejection instead of a run that's silently queued forever.
     */
    spawnSubAgent(opts: SpawnSubAgentOptions): SubAgentRun {
        if (!opts.task || !opts.task.trim()) {
            throw new Error('spawnSubAgent: task is required.');
        }
        if (this.countRunning() >= MAX_CONCURRENT_SUBAGENTS) {
            throw new Error(
                `Too many sub-agents already running (limit ${MAX_CONCURRENT_SUBAGENTS}). ` +
                `Wait for one to finish, or run this step yourself instead of delegating it.`,
            );
        }
        const depth = opts.depth ?? 0;
        if (depth > MAX_SPAWN_DEPTH) {
            throw new Error(`spawnSubAgent: max recursion depth (${MAX_SPAWN_DEPTH}) exceeded.`);
        }

        const id = crypto.randomUUID();
        const contextMode: SubAgentContextMode = opts.contextMode ?? 'isolated';
        const run: SubAgentRun = {
            id,
            label: opts.label?.trim() || truncateLabel(opts.task),
            task: opts.task,
            status: 'running',
            contextMode,
            provider: opts.provider,
            model: opts.model,
            depth,
            hopsUsed: 0,
            createdAt: Date.now(),
        };
        this.runs.set(id, run);
        this.cancelFlags.set(id, false);
        this.emit();
        emitWindowEvent('echo:subagent:started', run);

        // Fire-and-forget: intentionally not returned/awaited by the caller.
        this.executeRun(run, opts).catch(() => { /* executeRun handles its own errors */ });

        return run;
    }

    private async executeRun(run: SubAgentRun, opts: SpawnSubAgentOptions): Promise<void> {
        const timeoutController = { timedOut: false };
        const timeoutHandle = setTimeout(() => { timeoutController.timedOut = true; }, RUN_TIMEOUT_MS);

        try {
            const messages = buildInitialMessages(opts, run.contextMode);
            const tools = buildToolsForDepth(run.depth);

            let finalText = '';
            for (let hop = 0; hop < MAX_SUBAGENT_HOPS; hop++) {
                if (this.cancelFlags.get(run.id)) {
                    this.finish(run, 'cancelled', undefined, 'Cancelled by caller.');
                    return;
                }
                if (timeoutController.timedOut) {
                    this.finish(run, 'timeout', undefined, `Exceeded ${RUN_TIMEOUT_MS / 1000}s timeout.`);
                    return;
                }

                const isLastPossibleHop = hop === MAX_SUBAGENT_HOPS - 1;
                const result = await chat({
                    messages,
                    provider: opts.provider,
                    model: opts.model,
                    temperature: 0.6,
                    tools,
                });
                run.hopsUsed = hop + 1;

                if (result.toolCalls?.length && !isLastPossibleHop) {
                    messages.push({ role: 'assistant', content: result.text, toolCalls: result.toolCalls });
                    for (const tc of result.toolCalls) {
                        const toolResult = await this.executeSubAgentTool(tc, run.depth).catch((e: any) => ({
                            error: e?.message || 'Tool execution failed',
                        }));
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

            if (this.cancelFlags.get(run.id)) {
                this.finish(run, 'cancelled', undefined, 'Cancelled by caller.');
                return;
            }
            if (timeoutController.timedOut) {
                this.finish(run, 'timeout', undefined, `Exceeded ${RUN_TIMEOUT_MS / 1000}s timeout.`);
                return;
            }
            this.finish(run, 'done', finalText || '(sub-agent produced no output)');
        } catch (e: any) {
            this.finish(run, 'failed', undefined, e?.message || String(e));
        } finally {
            clearTimeout(timeoutHandle);
        }
    }

    /** A sub-agent's own tool calls go through the same agentSkillService
     *  registry as the main agent, PLUS spawn_sub_agent itself when depth
     *  allows further recursion (see buildToolsForDepth). */
    private async executeSubAgentTool(tc: LlmToolCall, depth: number): Promise<any> {
        if (tc.name === SPAWN_SUBAGENT_TOOL_NAME) {
            return executeSpawnSubAgentTool(tc.name, { ...tc.args, depth: depth + 1 });
        }
        return agentSkillService.executeTool(tc.name, tc.args);
    }

    private finish(run: SubAgentRun, status: SubAgentStatus, result?: string, error?: string): void {
        // Guard against a race where cancel/timeout and normal completion
        // both try to finalize the same run — first write wins.
        if (run.status !== 'running') return;
        run.status = status;
        run.result = result;
        run.error = error;
        run.finishedAt = Date.now();
        this.cancelFlags.delete(run.id);
        this.emit();
        if (status === 'done') emitWindowEvent('echo:subagent:completed', run);
        else if (status === 'cancelled') emitWindowEvent('echo:subagent:cancelled', run);
        else emitWindowEvent('echo:subagent:failed', run); // failed | timeout
    }
}

function truncateLabel(task: string, max = 60): string {
    const t = task.trim().replace(/\s+/g, ' ');
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/** Short, task-focused system prompt for background sub-agents. Deliberately
 *  NOT the full modelContextBuilder system context (persona/memory/skills
 *  narrative built for the conversational voice persona) — a sub-agent is a
 *  worker, not "Echo talking to the user," and keeping its system prompt
 *  small keeps every one of its (up to MAX_SUBAGENT_HOPS) hops cheap. */
function buildSubAgentSystemPrompt(depth: number): string {
    const recursionNote = depth >= MAX_SPAWN_DEPTH
        ? ''
        : ' You may delegate independent sub-steps to spawn_sub_agent if useful.';
    return (
        'You are a background worker sub-agent spawned by Echo, a personal AI ' +
        'assistant, to complete one focused task autonomously without further ' +
        'input. Use the available tools as needed, then finish with a clear, ' +
        'self-contained final answer — the user will only see your last ' +
        'message, not your intermediate steps.' + recursionNote
    );
}

function buildInitialMessages(opts: SpawnSubAgentOptions, contextMode: SubAgentContextMode): LlmMessage[] {
    const depth = opts.depth ?? 0;
    const system: LlmMessage = { role: 'system', content: buildSubAgentSystemPrompt(depth) };

    if (contextMode === 'fork' && opts.parentContext?.length) {
        // Fork mode: replay the caller-supplied context verbatim, then the
        // task as the final user turn. Every message here is re-sent (and
        // re-billed) on every subsequent hop — that's the cost this mode
        // trades for conversational continuity. See module doc.
        return [system, ...opts.parentContext, { role: 'user', content: opts.task }];
    }
    // Isolated mode (default): just the task, nothing else.
    return [system, { role: 'user', content: opts.task }];
}

/** Depth-gated tool list: only expose spawn_sub_agent to runs that still
 *  have recursion budget left (depth < MAX_SPAWN_DEPTH). This is the actual
 *  enforcement mechanism for MAX_SPAWN_DEPTH — a run at the cap physically
 *  cannot request the tool because it's not in the list handed to the model,
 *  not merely "asked not to" via a hop's system prompt. */
function buildToolsForDepth(depth: number): ToolDefinition[] {
    const base = agentSkillService.getTools();
    if (depth >= MAX_SPAWN_DEPTH) return base;
    return [...base, spawnSubAgentToolDeclaration];
}

export const subAgentService = new SubAgentService();

/* ─────────── Meta-tool: spawn_sub_agent ───────────
 *
 * Registered by the main session (see README) so the primary agent's own
 * tool loop can delegate slow/parallel work instead of doing it inline and
 * stalling the voice turn. Follows the same "declaration lives alongside
 * its handler, wiring happens elsewhere" pattern as
 * agentSkillService.proposeNewSkillToolDeclaration.
 */
const SPAWN_SUBAGENT_TOOL_NAME = 'spawn_sub_agent';

export const spawnSubAgentToolDeclaration: FunctionDeclaration = {
    name: SPAWN_SUBAGENT_TOOL_NAME,
    description:
        'Delegate a SLOW or MULTI-STEP task to a background sub-agent instead of doing it ' +
        'inline. Use this for things like: multi-source research, cross-referencing several ' +
        'facts, long document analysis, or any task that would take several tool calls and ' +
        'noticeably delay your reply to the user. Returns immediately with a run id — the ' +
        'sub-agent keeps working after your turn ends, and its result arrives later as a ' +
        'push notification (do not poll or block waiting for it in this turn; tell the user ' +
        'you\'ll follow up). Do NOT use this for anything answerable in one or two quick tool ' +
        'calls (a single lookup, a simple calculation, one file read) — spawning a sub-agent ' +
        'for trivial work is slower and more expensive than just doing it yourself right now.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            task: {
                type: Type.STRING,
                description:
                    'The full task for the sub-agent to complete autonomously, written as clear ' +
                    'self-contained instructions (it will not see this conversation unless ' +
                    'contextMode is "fork"). Include everything it needs: what to find/do, and ' +
                    'what shape the final answer should take.',
            },
            label: {
                type: Type.STRING,
                description: 'Optional short human-readable label for this run (for status/UI display).',
            },
            contextMode: {
                type: Type.STRING,
                description:
                    '"isolated" (default) = cheap, fresh context, no memory of this conversation — ' +
                    'use for self-contained tasks. "fork" = carries this conversation\'s recent ' +
                    'context into the sub-agent, costs more per step — only use when the task ' +
                    'genuinely depends on conversational context that can\'t be restated briefly in `task`.',
            },
        },
        required: ['task'],
    },
};

/**
 * Handler for the spawn_sub_agent tool call. Matches the
 * executeTool(toolName, args) shape used elsewhere (agentSkillService,
 * dynamicSkillService) so the main session can wire it in with the same
 * pattern. Returns a small JSON-able status object (not the eventual
 * result — that arrives later via the push events) so the model gets an
 * immediate, honest "it's running" tool result instead of appearing to hang.
 */
export async function executeSpawnSubAgentTool(toolName: string, args: any): Promise<any> {
    if (toolName !== SPAWN_SUBAGENT_TOOL_NAME) {
        throw new Error(`executeSpawnSubAgentTool: unexpected tool "${toolName}"`);
    }
    try {
        const run = subAgentService.spawnSubAgent({
            task: args?.task,
            label: args?.label,
            contextMode: args?.contextMode === 'fork' ? 'fork' : 'isolated',
            parentContext: Array.isArray(args?.parentContext) ? args.parentContext : undefined,
            provider: args?.provider,
            model: args?.model,
            depth: typeof args?.depth === 'number' ? args.depth : 0,
        });
        return {
            runId: run.id,
            status: run.status,
            message: `Sub-agent "${run.label}" started in the background (run ${run.id}). ` +
                `You'll be notified when it completes — do not block this turn waiting on it.`,
        };
    } catch (e: any) {
        return { error: e?.message || 'Failed to spawn sub-agent.' };
    }
}
