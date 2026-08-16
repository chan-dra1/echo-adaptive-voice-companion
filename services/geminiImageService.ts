/**
 * geminiImageService.ts
 *
 * Thin wrapper around @google/genai's image-output Gemini model
 * (gemini-2.5-flash-image). Reuses the same Gemini key already saved from
 * onboarding (localStorage 'echo_api_key') — unlike mediaStudioSkill.ts's
 * OpenAI/Stability/Together providers, this calls Google's API directly
 * from the browser (no CORS block, no Echo Core dependency).
 *
 * Supports image-conditioned generation (pass `inputImages` — e.g. a
 * reference photo for Headshot Studio) as well as plain text-to-image.
 */

import { GoogleGenAI, Modality } from '@google/genai';

const GEMINI_KEY_STORAGE = 'echo_api_key';
const IMAGE_MODEL = 'gemini-2.5-flash-image';

export function getGeminiKey(): string {
    try { return localStorage.getItem(GEMINI_KEY_STORAGE) || ''; } catch { return ''; }
}

export function hasGeminiKey(): boolean {
    return !!getGeminiKey();
}

export interface GeminiImageInput {
    /** base64-encoded image data (no "data:" prefix). */
    data: string;
    mimeType: string;
}

export interface GeminiImageResult {
    /** base64-encoded image data (no "data:" prefix). */
    imageBase64: string;
    mimeType: string;
    /** Any accompanying text Gemini returned alongside the image. */
    text?: string;
}

/**
 * Generate or edit an image via Gemini. Pass `inputImages` for
 * image-conditioned generation (e.g. "turn this photo into a professional
 * headshot"); omit for pure text-to-image.
 */
export async function generateGeminiImage(
    prompt: string,
    inputImages: GeminiImageInput[] = [],
): Promise<GeminiImageResult> {
    const apiKey = getGeminiKey();
    if (!apiKey) {
        throw new Error('No Gemini key saved yet. Add one in Settings — the same free key already used for chat and voice.');
    }

    const ai = new GoogleGenAI({ apiKey });
    const parts: any[] = [{ text: prompt }];
    for (const img of inputImages) {
        parts.push({ inlineData: { data: img.data, mimeType: img.mimeType } });
    }

    const response = await ai.models.generateContent({
        model: IMAGE_MODEL,
        contents: [{ role: 'user', parts }],
        config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
    });

    const candidateParts = response.candidates?.[0]?.content?.parts || [];
    let imageBase64: string | undefined;
    let mimeType = 'image/png';
    let text: string | undefined;

    for (const part of candidateParts) {
        if (part.inlineData?.data) {
            imageBase64 = part.inlineData.data;
            mimeType = part.inlineData.mimeType || mimeType;
        } else if (part.text) {
            text = text ? `${text}\n${part.text}` : part.text;
        }
    }

    if (!imageBase64) {
        throw new Error(text || 'Gemini did not return an image for that prompt — try rephrasing it.');
    }
    return { imageBase64, mimeType, text };
}
