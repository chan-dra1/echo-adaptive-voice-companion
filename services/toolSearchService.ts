/**
 * toolSearchService.ts
 *
 * Solves prompt-prefix bloat from a large skill registry.
 *
 * THE PROBLEM: Echo registers ~100 skills. Passing every FunctionDeclaration
 * on every turn costs roughly 150-250 tokens each — call it 15-25k tokens of
 * schema *before the user has said anything*. That's paid on every message,
 * it crowds the context window, and it grows linearly with each new skill.
 *
 * THE FIX (pattern borrowed from OpenClaw's "Tool Search"): stop sending the
 * schemas. Send a compact `name: description` directory instead — ~15 tokens
 * per skill, an order of magnitude smaller — plus two meta-tools the model
 * uses to drill in:
 *
 *   search_tools(query)        → full schemas for the best-matching skills
 *   call_tool(tool_name, args) → execute one by name
 *
 * TRADE-OFF, STATED PLAINLY: this costs up to two extra round trips (search →
 * call) on turns that use a tool, in exchange for a much smaller constant
 * prompt cost on *every* turn. That's a bad trade for a small registry and a
 * good one for a large one, so it is threshold-gated (see
 * shouldUseToolSearch): small registries keep the direct fast path, and only
 * once the schema tax dominates do we switch. Latency matters here — Echo is
 * a voice product — so the threshold is deliberately not aggressive.
 *
 * Matching is plain keyword scoring, not an LLM call and not embeddings:
 * it must be instant, free, and deterministic, and tool names/descriptions are
 * short enough that lexical overlap works well.
 */
import { FunctionDeclaration, Type } from '@google/genai';
import { agentSkillService, ToolDefinition } from './agentSkillService';

/**
 * Registry size at which the schema tax outweighs the extra hops.
 * Below this, sending everything directly is both cheaper and faster.
 */
export const TOOL_SEARCH_THRESHOLD = 40;

/** How many full schemas one search returns. Enough to cover near-ties without
 *  re-bloating the very prompt we're trying to shrink. */
const DEFAULT_SEARCH_LIMIT = 5;
const MAX_SEARCH_LIMIT = 12;

export function shouldUseToolSearch(toolCount: number): boolean {
    return toolCount >= TOOL_SEARCH_THRESHOLD;
}

/**
 * Compact directory injected into the system prompt in place of full schemas.
 * Deliberately terse and stable in ordering — it sits inside the cacheable
 * system prefix, so byte-stability across turns is what makes it cheap.
 */
export function buildToolDirectory(tools: ToolDefinition[]): string {
    if (!tools.length) return '';
    const lines = tools
        .filter(t => t?.name)
        .map(t => `- ${t.name}: ${(t.description || '').split('\n')[0].slice(0, 140)}`)
        .sort(); // stable ordering → stable prefix → cache hits
    return (
        `\n\n[AVAILABLE TOOLS — ${lines.length} total]\n` +
        `You cannot call these directly by name. To use one: first call search_tools ` +
        `with a short description of what you need to get its exact parameter schema, ` +
        `then call call_tool with that schema's arguments. If nothing here fits, say so ` +
        `or propose a new skill — do not invent a tool name.\n` +
        lines.join('\n')
    );
}

/** Lexical relevance score of a tool against a query. Higher is better. */
function scoreTool(tool: ToolDefinition, queryTokens: string[]): number {
    const name = (tool.name || '').toLowerCase();
    const desc = (tool.description || '').toLowerCase();
    let score = 0;
    for (const tok of queryTokens) {
        if (!tok) continue;
        // Name matches are far stronger evidence than description matches.
        if (name === tok) score += 100;
        else if (name.includes(tok)) score += 25;
        if (desc.includes(tok)) score += 5;
    }
    return score;
}

export function searchTools(query: string, limit = DEFAULT_SEARCH_LIMIT): ToolDefinition[] {
    const all = agentSkillService.getTools();
    const queryTokens = String(query || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(t => t.length > 1);

    if (!queryTokens.length) return all.slice(0, limit);

    const scored = all
        .map(tool => ({ tool, score: scoreTool(tool, queryTokens) }))
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score);

    const capped = Math.min(Math.max(1, limit), MAX_SEARCH_LIMIT);
    return scored.slice(0, capped).map(s => s.tool);
}

/* ─────────────── Meta-tool declarations ─────────────── */

export const searchToolsDeclaration: FunctionDeclaration = {
    name: 'search_tools',
    description:
        'Find the exact parameter schema for tools that can do a given job. ' +
        'Call this FIRST whenever you need to perform an action, before call_tool. ' +
        'Pass a short natural-language description of the task (e.g. "post to twitter", ' +
        '"read a github issue"), not a guessed tool name.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            query: {
                type: Type.STRING,
                description: 'Short description of the capability you need.',
            },
            limit: {
                type: Type.NUMBER,
                description: `Max schemas to return (default ${DEFAULT_SEARCH_LIMIT}, max ${MAX_SEARCH_LIMIT}).`,
            },
        },
        required: ['query'],
    },
};

export const callToolDeclaration: FunctionDeclaration = {
    name: 'call_tool',
    description:
        'Execute a tool by name. You must have retrieved its schema via search_tools ' +
        'first so the arguments match exactly — do not guess argument names.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            tool_name: {
                type: Type.STRING,
                description: 'Exact tool name as returned by search_tools.',
            },
            args: {
                type: Type.STRING,
                description:
                    'JSON object string of arguments matching the tool schema, e.g. {"city":"SF"}. ' +
                    'Use {} for a tool that takes no arguments.',
            },
        },
        required: ['tool_name', 'args'],
    },
};

export const TOOL_SEARCH_META_TOOLS: FunctionDeclaration[] = [
    searchToolsDeclaration,
    callToolDeclaration,
];

const META_TOOL_NAMES = new Set(TOOL_SEARCH_META_TOOLS.map(t => t.name));

export function isToolSearchMetaTool(name: string): boolean {
    return META_TOOL_NAMES.has(name);
}

/**
 * Handle a meta-tool call. Returns the payload to feed back to the model as
 * the tool result.
 *
 * Errors are returned as data rather than thrown: a bad tool name or malformed
 * args is something the model can see and correct on the next hop, and that
 * self-correction is much more useful than blowing up the whole turn.
 */
export async function executeToolSearchMetaTool(toolName: string, args: any): Promise<any> {
    if (toolName === 'search_tools') {
        const matches = searchTools(args?.query || '', args?.limit);
        if (!matches.length) {
            return {
                matches: [],
                note: 'No tool matched that query. Echo may not have this capability yet — ' +
                    'consider propose_new_skill, or tell the user plainly that you cannot do it.',
            };
        }
        // Full schemas, so the very next hop can call_tool correctly.
        return { matches };
    }

    if (toolName === 'call_tool') {
        const name = args?.tool_name;
        if (!name) return { error: 'call_tool requires tool_name.' };

        let parsedArgs: any = {};
        const raw = args?.args;
        if (typeof raw === 'string' && raw.trim()) {
            try {
                parsedArgs = JSON.parse(raw);
            } catch {
                return { error: `args was not valid JSON: ${raw.slice(0, 200)}. Pass a JSON object string.` };
            }
        } else if (raw && typeof raw === 'object') {
            parsedArgs = raw; // some providers hand back an object despite the STRING schema
        }

        if (META_TOOL_NAMES.has(name)) {
            return { error: `${name} is a meta-tool and cannot be invoked through call_tool.` };
        }

        try {
            return await agentSkillService.executeTool(name, parsedArgs);
        } catch (e: any) {
            return { error: e?.message || `Tool ${name} failed.` };
        }
    }

    return { error: `Unknown meta-tool: ${toolName}` };
}
