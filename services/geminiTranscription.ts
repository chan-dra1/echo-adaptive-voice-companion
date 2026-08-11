/**
 * geminiTranscription.ts
 *
 * Shared audio-to-text helper, extracted from meetingCaptureService.ts (its
 * behavior/prompt is byte-identical to what meeting mode has always used —
 * this is a pure lift, not a rewrite, so meeting mode's already-verified
 * transcription behavior is unchanged). services/dictationService.ts uses
 * the same function.
 *
 * Direct Gemini generateContent call — NOT llmRouter.chat(). llmRouter's
 * chooseProvider() can land on echoCloud (30 msg/day cap) or any provider
 * the user has set as default; transcription must always go straight to
 * Gemini with the user's own key, deterministically, regardless of what
 * they've picked for text chat.
 */
import { getKeyFor } from './llmRouter';

export async function transcribeAudio(audioBase64: string, mimeType: string): Promise<string> {
    const key = getKeyFor('gemini');
    if (!key) throw new Error('No Gemini key available for transcription.');
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: 'Transcribe this audio verbatim. Output ONLY the spoken words, no commentary, no timestamps. If there is no speech, output nothing.' },
                        { inlineData: { mimeType, data: audioBase64 } },
                    ],
                }],
                generationConfig: { temperature: 0, maxOutputTokens: 2048 },
            }),
        },
    );
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Transcription request failed (${res.status}): ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}
