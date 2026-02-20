/**
 * voice.ts — Audio pipelines for Gravity Claw.
 *
 * Uses OpenAI Whisper (faster/cheaper than Claude's native audio for now)
 * for transcription, and ElevenLabs Turbo V2.5 for generation.
 */
import OpenAI from "openai";
import { ElevenLabsClient } from "elevenlabs";
import { config } from "./config.js";
import { Readable } from "node:stream";

const openai = new OpenAI({ apiKey: config.openaiApiKey });
const elevenlabs = new ElevenLabsClient({ apiKey: config.elevenlabsApiKey });

/**
 * Utility to convert an in-memory Buffer into a stream with a filename.
 * OpenAI's Node SDK requires this to accept buffers as files.
 */
function bufferToStream(buffer: Buffer, filename: string) {
    const stream = Readable.from(buffer) as any;
    stream.path = filename;
    return stream;
}

/**
 * Transcribe Telegram voice notes (OGG/OPUS) to text using Whisper.
 */
export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
    try {
        const fileStream = bufferToStream(audioBuffer, "voice.ogg");
        const response = await openai.audio.transcriptions.create({
            file: fileStream,
            model: "whisper-1",
            language: "en", // Hardcoded to English for speed, could be configurable
        });
        return response.text;
    } catch (err: any) {
        console.error("[Voice] Whisper transcription failed:", err.message);
        throw new Error("I couldn't hear that clearly. Could you try typing it?");
    }
}

/**
 * Generate speech from text using ElevenLabs Turbo v2.5.
 * Returns an audio Buffer ready to send back to Telegram.
 */
export async function generateSpeech(text: string): Promise<Buffer> {
    try {
        const audioStream = await elevenlabs.generate({
            voice: config.elevenlabsVoiceId,
            text: text,
            model_id: "eleven_turbo_v2_5", // Extremely fast
            output_format: "mp3_44100_128",
        });

        // Read the stream into a single Buffer
        const chunks: Buffer[] = [];
        for await (const chunk of audioStream) {
            chunks.push(Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
    } catch (err: any) {
        console.error("[Voice] ElevenLabs synthesis failed:", err.message);
        throw new Error("I tried to speak, but lost my voice. Reading this text is the best I can do for now.");
    }
}
