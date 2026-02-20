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
import { tools, executeTool } from "./tools/index.js";

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
You are speaking to your owner — the only person who can reach you.
When a user asks about the past, use your search_memory tool to recall it.`;

/**
 * Process a user message and return the assistant's reply.
 * Handles the Agentic Tool Loop (max 5 iterations).
 */
export async function processMessage(
    ctx: AgentContext,
    userText: string
): Promise<string> {
    // 1. Fetch recent context from database (e.g., last 20 messages)
    const recentHistory = getRecentContext(ctx.userId, 20);

    // 2. We build the active memory for this run
    let currentMessages: Message[] = [
        ...recentHistory,
        { role: "user", content: userText }
    ];

    let iteration = 0;
    const MAX_ITERATIONS = 5; // Safety fallback

    try {
        while (iteration < MAX_ITERATIONS) {
            iteration++;
            console.log(`[Agent] Iteration ${iteration}...`);

            const response = await anthropic.messages.create({
                model: MODEL,
                max_tokens: MAX_TOKENS,
                system: SYSTEM_PROMPT,
                messages: currentMessages,
                tools: tools,
            });

            // If Claude decided to use a tool
            if (response.stop_reason === "tool_use") {
                // Record Claude's tool_use commands in the active message history
                currentMessages.push({ role: "assistant", content: response.content });

                // We must map the tool executions into a single user turn containing tool_results
                const toolResults: any[] = [];

                for (const block of response.content) {
                    if (block.type === "tool_use") {
                        const resultText = await executeTool(block.name, block.input, ctx.userId);
                        toolResults.push({
                            type: "tool_result",
                            tool_use_id: block.id,
                            content: resultText,
                        });
                    }
                }

                // Feed the tool results back into the model in the next loop Iteration
                currentMessages.push({ role: "user", content: toolResults });

                // Continue loop...

            } else {
                // The loop is done — Claude produced a final text response.
                const assistantMessageText = response.content
                    .filter((block) => block.type === "text")
                    .map((block) => block.text)
                    .join("\n");

                // 3. Persist the *initial start* and *final end* to the permanent DB
                // We do not save intermediate tool thoughts to the long-term DB to keep it clean.
                addMessage(ctx.userId, "user", userText);
                addMessage(ctx.userId, "assistant", assistantMessageText);

                return assistantMessageText;
            }
        }

        return "⚠️ I had to stop thinking because I hit my maximum loop iterations.";

    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Unknown error from Claude";
        console.error("[Agent] API error:", message);
        return `⚠️ Error reaching Claude: ${message}`;
    }
}
