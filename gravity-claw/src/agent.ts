/**
 * agent.ts — The core Claude agentic loop.
 *
 * Level 1: Basic single-turn conversation with persistent session history.
 * Level 4 will add: tool definitions, tool execution loop, MCP integration.
 */
import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import type { AgentContext, Message } from "./types.js";
import { addMessage, getRecentContext } from "./db.js";

const anthropic = new Anthropic({
    apiKey: config.openrouterApiKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
        "HTTP-Referer": "https://gravity-claw.local",
        "X-Title": "Gravity Claw"
    }
});

/** Claude model to use via OpenRouter. */
const MODEL = "anthropic/claude-3-5-haiku-20241022";

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
 * Reads conversation context from SQLite and writes the new turns to disk.
 */
export async function processMessage(
    ctx: AgentContext,
    userText: string
): Promise<string> {
    // 1. Fetch recent context from database (e.g., last 20 messages)
    const recentHistory = getRecentContext(ctx.userId, 20);

    // 2. Append the new user turn for this API request
    const messages: Message[] = [
        ...recentHistory,
        { role: "user", content: userText }
    ];

    try {
        const response = await anthropic.messages.create({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            system: SYSTEM_PROMPT,
            messages: messages,
        });

        const assistantMessage = response.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("\n");

        // 3. Persist the turn to SQLite *only after* a successful API call
        addMessage(ctx.userId, "user", userText);
        addMessage(ctx.userId, "assistant", assistantMessage);

        return assistantMessage;
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Unknown error from Claude";
        console.error("[Agent] Claude API error:", message);
        return `⚠️ Error reaching Claude: ${message}`;
    }
}
