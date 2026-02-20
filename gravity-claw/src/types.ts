/**
 * types.ts — Shared TypeScript types for Gravity Claw.
 * Keep this minimal — only what is shared across modules.
 */
import type Anthropic from "@anthropic-ai/sdk";

/** A single turn in the conversation — mirrors Claude's message format. */
export type Message = Anthropic.MessageParam;

/** Per-user agent state passed around the system. */
export interface AgentContext {
    /** Telegram user ID of the owner (already verified as allowed by bot.ts). */
    userId: number;
    /** Running conversation history for this session (in-memory, Level 2 adds persistence). */
    history: Message[];
}
