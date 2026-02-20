/**
 * config.ts — Load and validate environment variables.
 * Throws at startup if any required value is missing.
 * SECURITY: Never log secrets. Never write them to files.
 */
import "dotenv/config";

function requireEnv(name: string): string {
    const val = process.env[name];
    if (!val) {
        throw new Error(`[Config] Missing required environment variable: ${name}`);
    }
    return val;
}

export const config = {
    telegramToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    openrouterApiKey: requireEnv("OPENROUTER_API_KEY"),
    openaiApiKey: process.env.OPENAI_API_KEY || "", // Make optional since OpenRouter handles main chat
    elevenlabsApiKey: process.env.ELEVENLABS_API_KEY || "",
    elevenlabsVoiceId: process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM", // Default to 'Rachel'

    // Parse as integer — Telegram user IDs are numbers
    allowedUserId: (() => {
        const raw = requireEnv("ALLOWED_TELEGRAM_USER_ID");
        const id = parseInt(raw, 10);
        if (isNaN(id)) {
            throw new Error(
                `[Config] ALLOWED_TELEGRAM_USER_ID must be a numeric Telegram user ID, got: "${raw}"`
            );
        }
        return id;
    })(),
} as const;

/**
 * Security gate: only the whitelisted user ID may interact with the bot.
 * All other senders are silently ignored — no error message is sent.
 */
export function isAllowed(userId: number | undefined): boolean {
    return userId === config.allowedUserId;
}
