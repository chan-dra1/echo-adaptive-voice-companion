/**
 * bot.ts — grammy Telegram bot setup and message routing.
 *
 * SECURITY: Every handler checks isAllowed() before processing.
 * Unauthorized senders are silently dropped — no reply, no log of their content.
 */
import { Bot } from "grammy";
import { config, isAllowed } from "./config.js";
import { processMessage } from "./agent.js";
import type { AgentContext } from "./types.js";

export const bot = new Bot(config.telegramToken);

/**
 * In-memory session store: userId → AgentContext
 * Level 2 will replace this with SQLite persistence.
 */
const sessions = new Map<number, AgentContext>();

function getOrCreateSession(userId: number): AgentContext {
    if (!sessions.has(userId)) {
        sessions.set(userId, { userId, history: [] });
    }
    // Non-null assertion is safe: we just set it above
    return sessions.get(userId)!;
}

// ── Handlers ──────────────────────────────────────────────────────────────────

bot.command("start", async (ctx) => {
    const userId = ctx.from?.id;
    if (!isAllowed(userId)) return; // Silent drop

    await ctx.reply(
        "⚡ Gravity Claw online.\n\nSend me any message and I'll respond via Claude.\nYour conversation history is kept within this session."
    );
});

bot.command("reset", async (ctx) => {
    const userId = ctx.from?.id;
    if (!isAllowed(userId)) return;

    if (userId !== undefined) {
        sessions.delete(userId);
    }
    await ctx.reply("🔄 Session reset. Fresh conversation started.");
});

bot.on("message:text", async (ctx) => {
    const userId = ctx.from?.id;
    if (!isAllowed(userId)) {
        // SECURITY: Log only the fact that an unauthorized attempt occurred, not the content.
        console.warn(`[Bot] Ignoring unauthorized user ID: ${userId ?? "unknown"}`);
        return;
    }

    const userText = ctx.message.text;

    // Show typing indicator while Claude thinks
    await ctx.replyWithChatAction("typing");

    const session = getOrCreateSession(userId!);
    const reply = await processMessage(session, userText);

    await ctx.reply(reply);
});

// Log any unhandled errors to console — do not crash the process
bot.catch((err) => {
    console.error("[Bot] Unhandled error:", err.message);
});
