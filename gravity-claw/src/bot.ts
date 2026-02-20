/**
 * bot.ts — grammy Telegram bot setup and message routing.
 *
 * SECURITY: Every handler checks isAllowed() before processing.
 * Unauthorized senders are silently dropped — no reply, no log of their content.
 */
import { Bot } from "grammy";
import { config, isAllowed } from "./config.js";
import { processMessage } from "./agent.js";
import { clearHistory } from "./db.js";

export const bot = new Bot(config.telegramToken);

// ── Handlers ──────────────────────────────────────────────────────────────────

bot.command("start", async (ctx) => {
    const userId = ctx.from?.id;
    if (!isAllowed(userId)) return; // Silent drop

    await ctx.reply(
        "⚡ Gravity Claw online.\n\nSend me any message and I'll respond via Claude.\nYour conversation history is persisted securely on disk."
    );
});

bot.command("reset", async (ctx) => {
    const userId = ctx.from?.id;
    if (!isAllowed(userId)) return;

    if (userId !== undefined) {
        clearHistory(userId);
    }
    await ctx.reply("🔄 Persistent memory wiped. Starting fresh.");
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

    // Pass the minimal context (history is now handled by agent/db)
    const reply = await processMessage({ userId: userId! }, userText);

    await ctx.reply(reply);
});

// Log any unhandled errors to console — do not crash the process
bot.catch((err) => {
    console.error("[Bot] Unhandled error:", err.message);
});
