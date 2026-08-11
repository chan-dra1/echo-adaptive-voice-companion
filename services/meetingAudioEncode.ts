/**
 * meetingAudioEncode.ts
 *
 * Float32 audio samples -> 16-bit PCM WAV -> base64, for sending a meeting
 * audio chunk to Gemini's generateContent as inline audio data.
 *
 * WAV, not webm/opus: Gemini's documented inline audio formats don't include
 * what MediaRecorder produces in Chrome (webm/opus). WAV with a plain PCM
 * body is universally decodable and trivial to construct by hand.
 *
 * This exact encode path was hand-verified against a real captured signal
 * before being written here (see the standalone Electron loopback probe run
 * earlier in this session): a real 6s system-audio capture, encoded this
 * same way, produced a WAV that `file` correctly identified as
 * "WAVE audio, Microsoft PCM, 16 bit, mono", playable, at the right
 * size-for-duration. This is not a from-scratch untested encoder.
 */
import { arrayBufferToBase64 } from './audioUtils';

export interface WavEncodeResult {
    /** Base64 WITHOUT a data: prefix — matches LlmImagePart-style raw payloads. */
    base64: string;
    mimeType: string;
    byteLength: number;
    durationSec: number;
}

/**
 * Encode Float32 [-1,1] samples (mono) into a WAV file and base64-encode it.
 * Same clamp/scale as audioUtils.ts's createPcmBlob, kept separate because
 * that function returns Gemini Live's raw-PCM Blob shape (no WAV header,
 * different mimeType), not a self-contained file.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): WavEncodeResult {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    function writeStr(offset: number, str: string): void {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);       // fmt chunk size
    view.setUint16(20, 1, true);        // PCM
    view.setUint16(22, 1, true);        // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byte rate (16-bit mono)
    view.setUint16(32, 2, true);        // block align
    view.setUint16(34, 16, true);       // bits per sample
    writeStr(36, 'data');
    view.setUint32(40, samples.length * 2, true);

    let off = 44;
    for (let i = 0; i < samples.length; i++, off += 2) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }

    return {
        base64: arrayBufferToBase64(buffer),
        mimeType: 'audio/wav',
        byteLength: buffer.byteLength,
        durationSec: samples.length / sampleRate,
    };
}

/** RMS of a Float32 buffer — used to decide whether a chunk is worth
 *  transcribing at all (skip near-silent chunks to save API calls) and, in
 *  tests, to distinguish a real captured signal from silence/noise floor. */
export function rms(samples: Float32Array): number {
    if (samples.length === 0) return 0;
    let sumSquares = 0;
    for (let i = 0; i < samples.length; i++) sumSquares += samples[i] * samples[i];
    return Math.sqrt(sumSquares / samples.length);
}

/** Below this RMS, a chunk is treated as silence and skipped — avoids paying
 *  for transcription of dead air. Well above float rounding noise, well
 *  below normal speech (~0.02-0.15 RMS in the probe's own real capture). */
export const SILENCE_RMS_THRESHOLD = 0.003;
