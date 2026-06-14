/**
 * singingSynthesisService.ts
 *
 * Tiered singing synthesis:
 *   Tier 1 — Bark (suno/bark via HF Inference API) for vocal synthesis
 *   Tier 1 — MusicGen (facebook/musicgen-small via HF) for instrumental
 *   Tier 2 — Web Audio chord accompaniment (always works, no API key needed)
 *
 * The service also handles lyric generation via the llmRouter.
 */

import { chat } from './llmRouter';

// ── Musical types ────────────────────────────────────────────────────────────

export const MUSICAL_KEYS = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'] as const;
export type MusicalKey = typeof MUSICAL_KEYS[number];

export const MUSIC_STYLES = ['Pop','R&B','Lo-fi','Jazz','Rock','Classical','Hip-hop','Folk'] as const;
export type MusicStyle = typeof MUSIC_STYLES[number];

export interface SingConfig {
    key: MusicalKey;
    mode: 'major' | 'minor';
    style: MusicStyle;
    bpm: number;
    voicePreset: string;
    withAccompaniment: boolean;
}

export const DEFAULT_SING_CONFIG: SingConfig = {
    key: 'C',
    mode: 'major',
    style: 'Pop',
    bpm: 100,
    voicePreset: 'v2/en_speaker_6',
    withAccompaniment: true,
};

export const BARK_VOICES = [
    { id: 'v2/en_speaker_0', label: 'Voice A' },
    { id: 'v2/en_speaker_1', label: 'Voice B' },
    { id: 'v2/en_speaker_3', label: 'Voice C' },
    { id: 'v2/en_speaker_6', label: 'Voice D' },
    { id: 'v2/en_speaker_9', label: 'Voice E' },
];

export interface SingSession {
    lyrics: string;
    vocalBuffer: AudioBuffer | null;
    accompBuffer: AudioBuffer | null;
    mode: 'bark' | 'webaudio';
    error?: string;
}

// ── Lyric generation ─────────────────────────────────────────────────────────

export function buildLyricPrompt(topic: string, config: SingConfig): string {
    return [
        `You are a professional songwriter. Write ${config.style} song lyrics for this topic: "${topic}".`,
        `Key: ${config.key} ${config.mode}. Tempo: ~${config.bpm} BPM.`,
        '',
        'Format output with exactly these section labels on their own lines, then 4 lines of lyrics each:',
        '[Verse]',
        '[Chorus]',
        '[Verse 2]',
        '[Chorus]',
        '',
        'Rules: ~8 syllables per line. No explanations, no titles, no extra text — only the labeled lyrics.',
    ].join('\n');
}

export async function generateLyrics(topic: string, config: SingConfig): Promise<string> {
    const result = await chat({
        messages: [{ role: 'user', content: buildLyricPrompt(topic, config) }],
        maxTokens: 400,
        temperature: 0.85,
    });
    return result.text.trim();
}

// ── Bark vocal synthesis ─────────────────────────────────────────────────────

function formatLyricsForBark(lyrics: string): string {
    return lyrics
        .split('\n')
        .map(l => {
            const line = l.trim();
            if (!line || line.startsWith('[')) return line;
            return `♪ ${line} ♪`;
        })
        .join('\n');
}

async function fetchWithColdRetry(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const res = await fetch(url, { ...init, signal });
        if (res.status === 503) {
            const body = await res.json().catch(() => ({}));
            const waitMs = Math.min((body.estimated_time ?? 20) * 1000, 40_000);
            await new Promise(r => setTimeout(r, waitMs + 1000));
            continue;
        }
        if (!res.ok) {
            const text = await res.text().catch(() => String(res.status));
            lastErr = new Error(`${res.status}: ${text.slice(0, 120)}`);
            break;
        }
        return res;
    }
    throw lastErr ?? new Error('HF request failed after retries');
}

export async function barkSynthesize(
    lyrics: string,
    config: SingConfig,
    hfKey: string,
    audioCtx: AudioContext,
    signal?: AbortSignal,
): Promise<AudioBuffer> {
    const formatted = formatLyricsForBark(lyrics);
    const res = await fetchWithColdRetry(
        'https://api-inference.huggingface.co/models/suno/bark',
        {
            method: 'POST',
            headers: { Authorization: `Bearer ${hfKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                inputs: formatted,
                parameters: { voice_preset: config.voicePreset },
            }),
        },
        signal,
    );
    const buf = await res.arrayBuffer();
    return audioCtx.decodeAudioData(buf);
}

// ── MusicGen accompaniment ───────────────────────────────────────────────────

export async function musicGenAccompaniment(
    config: SingConfig,
    hfKey: string,
    audioCtx: AudioContext,
    signal?: AbortSignal,
): Promise<AudioBuffer> {
    const prompt = `${config.bpm} BPM ${config.style} instrumental in ${config.key} ${config.mode}, `
        + 'professional studio quality, no vocals, melodic and warm';
    const res = await fetchWithColdRetry(
        'https://api-inference.huggingface.co/models/facebook/musicgen-small',
        {
            method: 'POST',
            headers: { Authorization: `Bearer ${hfKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ inputs: prompt, parameters: { max_new_tokens: 512 } }),
        },
        signal,
    );
    const buf = await res.arrayBuffer();
    return audioCtx.decodeAudioData(buf);
}

// ── Web Audio chord accompaniment (no API key needed) ───────────────────────

const ROOT_HZ: Record<MusicalKey, number> = {
    'C':  261.63, 'C#': 277.18, 'D':  293.66, 'D#': 311.13,
    'E':  329.63, 'F':  349.23, 'F#': 369.99, 'G':  392.00,
    'G#': 415.30, 'A':  440.00, 'A#': 466.16, 'B':  493.88,
};

const PROG: Record<string, number[][]> = {
    major: [[0,4,7], [7,11,14], [9,12,16], [5,9,12]],
    minor: [[0,3,7], [7,11,14], [8,12,15], [5,8,12]],
};

function playChord(ctx: AudioContext, intervals: number[], rootHz: number, startTime: number, dur: number): void {
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0, startTime);
    masterGain.gain.linearRampToValueAtTime(0.055, startTime + 0.08);
    masterGain.gain.setValueAtTime(0.055, startTime + dur - 0.15);
    masterGain.gain.linearRampToValueAtTime(0, startTime + dur);
    masterGain.connect(ctx.destination);

    for (const semi of intervals) {
        const freq = rootHz * Math.pow(2, semi / 12);
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        osc.connect(masterGain);
        osc.start(startTime);
        osc.stop(startTime + dur + 0.1);
    }
}

export function scheduleChordProgression(ctx: AudioContext, config: SingConfig, totalSeconds: number): void {
    const rootHz = ROOT_HZ[config.key];
    const chordDur = (60 / config.bpm) * 4;
    const chords = PROG[config.mode];
    let t = ctx.currentTime + 0.05;
    while (t < ctx.currentTime + totalSeconds) {
        for (const chord of chords) {
            if (t >= ctx.currentTime + totalSeconds) break;
            playChord(ctx, chord, rootHz, t, chordDur);
            t += chordDur;
        }
    }
}

// ── Full session builder ─────────────────────────────────────────────────────

export async function buildSingSession(
    lyrics: string,
    config: SingConfig,
    hfKey: string | null,
    audioCtx: AudioContext,
    onProgress: (msg: string) => void,
    signal?: AbortSignal,
): Promise<SingSession> {
    const session: SingSession = {
        lyrics,
        vocalBuffer: null,
        accompBuffer: null,
        mode: hfKey ? 'bark' : 'webaudio',
    };

    if (!hfKey) return session;

    onProgress('Synthesizing vocals with Bark…');
    try {
        session.vocalBuffer = await barkSynthesize(lyrics, config, hfKey, audioCtx, signal);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('[singing] Bark failed:', msg);
        session.error = msg;
        session.mode = 'webaudio';
    }

    if (config.withAccompaniment && !signal?.aborted) {
        onProgress('Generating accompaniment with MusicGen…');
        try {
            session.accompBuffer = await musicGenAccompaniment(config, hfKey, audioCtx, signal);
        } catch (e) {
            console.warn('[singing] MusicGen failed, using chord fallback:', e);
        }
    }

    return session;
}

// ── Playback ─────────────────────────────────────────────────────────────────

export function playSingSession(session: SingSession, config: SingConfig, audioCtx: AudioContext): () => void {
    const stops: Array<() => void> = [];

    const playBuffer = (buf: AudioBuffer, gain: number) => {
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        const g = audioCtx.createGain();
        g.gain.value = gain;
        src.connect(g);
        g.connect(audioCtx.destination);
        src.start();
        stops.push(() => { try { src.stop(); } catch { /* already stopped */ } });
    };

    if (session.vocalBuffer) playBuffer(session.vocalBuffer, 0.85);

    if (session.accompBuffer) {
        playBuffer(session.accompBuffer, 0.28);
    } else {
        const duration = session.vocalBuffer?.duration ?? 45;
        scheduleChordProgression(audioCtx, config, duration + 4);
    }

    return () => stops.forEach(fn => fn());
}
