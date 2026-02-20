/**
 * bot.ts — grammy Telegram bot setup and message routing.
 *
 * SECURITY: Every handler checks isAllowed() before processing.
 * Unauthorized senders are silently dropped — no reply, no log of their content.
 */
import { Bot, InputFile } from "grammy";
import { config, isAllowed } from "./config.js";
import { processMessage } from "./agent.js";
import { clearHistory } from "./db.js";
import { transcribeAudio, generateSpeech } from "./voice.js";

export const bot = new Bot(config.telegramToken);

// ── Handlers ──────────────────────────────────────────────────────────────────

bot.command("start", async (ctx) => {
    const userId = ctx.from?.id;
    if (!isAllowed(userId)) return; // Silent drop

    await ctx.reply(
        "⚡ Gravity Claw online.\n\nSend me any text or voice message. I will respond in kind."
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
        console.warn(`[Bot] Ignoring unauthorized user ID: ${userId ?? "unknown"}`);
        return;
    }

    const userText = ctx.message.text;
    await ctx.replyWithChatAction("typing");
    const reply = await processMessage({ userId: userId! }, userText);
    await ctx.reply(reply);
});

/**
 * Handle incoming voice messages.
 * 1. Download audio file from Telegram.
 * 2. Transcribe using Whisper.
 * 3. Send text to agent.
 * 4. Convert agent response back to speech using ElevenLabs.
 * 5. Send voice note back.
 */
bot.on("message:voice", async (ctx) => {
    const userId = ctx.from?.id;
    if (!isAllowed(userId)) return;

    try {
        await ctx.replyWithChatAction("record_voice");

        // 1. Get file path from Telegram
        const file = await ctx.getFile();
        if (!file.file_path) throw new Error("Could not get file path.");

        // 2. Download the buffer directly via REST HTTPS
        const url = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error("Failed to download voice note.");
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // 3. Transcribe audio to text
        const transcribedText = await transcribeAudio(buffer);

        // Optional: Echo what the bot heard so user can verify quality
        await ctx.reply(`🎙️ _"${transcribedText}"_`, { parse_mode: "Markdown" });

        // 4. Process through Agent
        const agentReply = await processMessage({ userId: userId! }, transcribedText);

        // 5. Generate audio response
        const audioBuffer = await generateSpeech(agentReply);

        // 6. Reply with Voice Note
        await ctx.replyWithVoice(new InputFile(audioBuffer, "response.ogg"));

    } catch (error: any) {
        console.error("[Bot] Voice processing error:", error.message);
        await ctx.reply("⚠️ Sorry, I had trouble processing that voice message.");
    }
});

// Log any unhandled errors to console — do not crash the process
bot.catch((err) => {
    console.error("[Bot] Unhandled error:", err.message);
});
