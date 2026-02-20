/**
 * index.ts — Gravity Claw entry point.
 *
 * Boots the Telegram bot using long-polling.
 * No web server. No exposed ports. No webhooks.
 */
import "dotenv/config";
import { bot } from "./bot.js";

console.log("⚡ Gravity Claw starting...");

// Graceful shutdown on CTRL+C or process termination
process.once("SIGINT", () => {
    console.log("\n[Index] Shutting down gracefully...");
    void bot.stop();
});
process.once("SIGTERM", () => {
    console.log("[Index] SIGTERM received. Shutting down...");
    void bot.stop();
});

// Start long-polling — this is the ONLY network connection: outbound to Telegram API.
// No ports are opened on your machine.
await bot.start({
    onStart: (botInfo) => {
        console.log(`✅ Gravity Claw is running as @${botInfo.username}`);
        console.log("   Listening for messages via long-polling...");
        console.log("   Press CTRL+C to stop.\n");
    },
});
