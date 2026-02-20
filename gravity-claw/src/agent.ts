/**
 * agent.ts — The core Claude agentic loop.
 *
 * Level 1: Basic single-turn conversation with persistent session history.
 * Level 4 will add: tool definitions, tool execution loop, MCP integration.
 */
import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import type { AgentContext } from "./types.js";

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

/** Claude model to use. claude-3-5-haiku is fast & cost-efficient for chat. */
const MODEL = "claude-3-5-haiku-20241022";

/** Maximum tokens in a single response. */
const MAX_TOKENS = 1024;

/** System prompt — defines Gravity Claw's personality and rules. */
const SYSTEM_PROMPT = `You are Gravity Claw, a lean, intelligent personal AI assistant.
You run locally on your owner's machine and communicate exclusively through Telegram.
You are direct, precise, and helpful. You have a slightly dry wit.
You never make up facts. When you don't know something, you say so.
You are speaking to your owner — the only person who can reach you.`;

/**
 * Process a user message and return the assistant's reply.
 * Mutates ctx.history to maintain conversation continuity within a session.
 */
export async function processMessage(
    ctx: AgentContext,
    userText: string
): Promise<string> {
    // Append the new user turn
    ctx.history.push({ role: "user", content: userText });

    try {
        const response = await anthropic.messages.create({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            system: SYSTEM_PROMPT,
            messages: ctx.history,
        });

        // Extract text content from the response
        const assistantMessage = response.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("\n");

        // Append assistant turn to history for multi-turn continuity
        ctx.history.push({ role: "assistant", content: assistantMessage });

        return assistantMessage;
    } catch (error) {
        // Remove the failed user turn so history stays consistent
        ctx.history.pop();

        const message =
            error instanceof Error ? error.message : "Unknown error from Claude";
        console.error("[Agent] Claude API error:", message);
        return `⚠️ Error reaching Claude: ${message}`;
    }
}
