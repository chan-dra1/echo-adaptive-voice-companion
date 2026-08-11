/**
 * dictationService.ts
 *
 * System-wide voice dictation — the mic-capture/VAD/transcription half of
 * the feature. The other half (simulating a paste into whatever app
 * currently has OS focus) lives in electron/globalInput.js, reached only
 * via window.echoDesktop.injectText(); this file never touches native
 * automation directly, keeping that surface small and auditable in one
 * place (see globalInput.js's own module doc).
 *
 * Deliberately NOT modeled on meetingCaptureService.ts's fixed 25s chunking
 * — that cadence is fine for a passive meeting transcript, but would feel
 * unusably laggy for "speak, then watch the words appear." Utterances are
 * segmented by voice activity instead: keep accumulating while there's
 * speech, seal once enough trailing silence has passed. Reuses
 * meetingAudioEncode.ts's WAV encoder/RMS helpers and
 * geminiTranscription.ts's shared transcription call (the same one meeting
 * mode uses) — no new audio-encoding or Gemini-calling code, only new
 * segmentation logic on top of proven pieces.
 */
import { encodeWav, rms, SILENCE_RMS_THRESHOLD } from './meetingAudioEncode';
import { transcribeAudio } from './geminiTranscription';
import { hasKeyFor } from './llmRouter';
import { isElectronDesktop, setDictationActive, injectText as injectTextViaDesktop } from './desktopAutomationService';

export interface PlatformCheck {
    ok: boolean;
    reason?: string;
}

/** Dictation only works in the Electron desktop app — the injection half
 *  fundamentally requires native OS automation that no browser sandbox or
 *  mobile OS permits. Unlike meeting mode's canCaptureSystemAudio(), there's
 *  no partial "works in a browser tab" case here at all. */
export function canUseDictation(): PlatformCheck {
    if (!isElectronDesktop()) {
        return { ok: false, reason: 'System-wide dictation is only available in the Echo desktop app.' };
    }
    if (typeof navigator === 'undefined' || typeof navigator.mediaDevices?.getUserMedia !== 'function') {
        return { ok: false, reason: 'This environment does not support microphone capture.' };
    }
    return { ok: true };
}

export type DictationStatus = 'idle' | 'starting' | 'listening' | 'error';

export interface DictationState {
    status: DictationStatus;
    startedAt: number | null;
    elapsedMs: number;
    utteranceCount: number;
    lastTranscript: string | null;
    lastInjectedAt: number | null;
    lastError: string | null;
}

let state: DictationState = {
    status: 'idle',
    startedAt: null,
    elapsedMs: 0,
    utteranceCount: 0,
    lastTranscript: null,
    lastInjectedAt: null,
    lastError: null,
};

const listeners = new Set<(s: DictationState) => void>();

export function onChange(cb: (s: DictationState) => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

function emit(): void {
    const snapshot = { ...state };
    for (const l of listeners) {
        try { l(snapshot); } catch { /* ignore listener errors */ }
    }
    // Best-effort — lets electron/globalInput.js's Tray reflect live state.
    // Never block/throw the local state machine on this.
    try { setDictationActive(snapshot.status === 'listening'); } catch { /* ignore */ }
}

function setState(patch: Partial<DictationState>): void {
    state = { ...state, ...patch };
    emit();
}

export function getState(): DictationState {
    return { ...state };
}

// ── Capture internals (module-private) ──────────────────────────────────

let ctx: AudioContext | null = null;
let micStream: MediaStream | null = null;
let scriptProcessor: ScriptProcessorNode | null = null;
let elapsedTimer: ReturnType<typeof setInterval> | null = null;

const CAPTURE_SAMPLE_RATE = 16000;

// VAD end-pointing thresholds. Tuned for "natural pause between sentences
// shouldn't cut you off, but a real stop-talking gap should seal promptly" —
// 900ms is short enough to feel responsive, long enough to survive a normal
// mid-sentence breath.
const SILENCE_HOLD_MS = 900;
// Ceiling so a stuck-open mic (e.g. background noise classified as
// borderline speech) can't run one "utterance" forever — mirrors
// meetingCaptureService.ts's MAX_CAPTURE_MS cost-ceiling philosophy, scaled
// down to a single utterance instead of a whole session.
const MAX_UTTERANCE_MS = 20_000;
// Floor below which a blip (a cough, a click) isn't worth a transcription
// API call.
const MIN_UTTERANCE_MS = 300;

let accumulator: Float32Array[] = [];
let accumulatedSamples = 0;
let hasDetectedSpeech = false;
let silenceSamplesSinceSpeech = 0;
let sealing = false; // in-flight guard — never seal two utterances concurrently

export async function startDictation(): Promise<void> {
    if (state.status === 'listening' || state.status === 'starting') {
        throw new Error('Dictation is already active.');
    }
    const gate = canUseDictation();
    if (!gate.ok) throw new Error(gate.reason);
    if (!hasKeyFor('gemini')) {
        throw new Error('Dictation transcribes via Gemini and needs a Gemini API key set in Settings.');
    }

    setState({ status: 'starting', lastError: null });

    let localMicStream: MediaStream;
    try {
        localMicStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
    } catch (e: any) {
        const msg = e?.message || 'Microphone access was denied or unavailable.';
        setState({ status: 'error', lastError: msg });
        throw new Error(msg);
    }

    micStream = localMicStream;
    accumulator = [];
    accumulatedSamples = 0;
    hasDetectedSpeech = false;
    silenceSamplesSinceSpeech = 0;
    sealing = false;

    const requestedRate = CAPTURE_SAMPLE_RATE;
    ctx = new AudioContext({ sampleRate: requestedRate } as AudioContextOptions);
    const actualRate = ctx.sampleRate;
    if (actualRate !== requestedRate) {
        // Same verified-necessary fallback as meetingCaptureService.ts — some
        // browsers silently ignore the requested rate. All sample-count math
        // below uses the ACTUAL rate throughout.
        console.warn(`[dictationService] requested ${requestedRate}Hz AudioContext, got ${actualRate}Hz — using actual rate.`);
    }

    const micSrc = ctx.createMediaStreamSource(micStream);
    scriptProcessor = ctx.createScriptProcessor(4096, 1, 1);
    micSrc.connect(scriptProcessor);
    const sink = ctx.createGain();
    sink.gain.value = 0; // silent — never played back out loud
    scriptProcessor.connect(sink);
    sink.connect(ctx.destination); // required: a ScriptProcessor only fires when connected downstream

    const maxUtteranceSamples = Math.round(actualRate * (MAX_UTTERANCE_MS / 1000));
    const silenceHoldSamples = Math.round(actualRate * (SILENCE_HOLD_MS / 1000));
    const minUtteranceSamples = Math.round(actualRate * (MIN_UTTERANCE_MS / 1000));

    scriptProcessor.onaudioprocess = (e: AudioProcessingEvent) => {
        // Cheap-only work in this callback — copy, measure, decide. No
        // network, no crypto, no heavy work — mirrors meetingCaptureService's
        // own onaudioprocess discipline.
        const data = e.inputBuffer.getChannelData(0);
        const level = rms(data);
        const isSpeech = level >= SILENCE_RMS_THRESHOLD;

        if (isSpeech) {
            hasDetectedSpeech = true;
            silenceSamplesSinceSpeech = 0;
            accumulator.push(new Float32Array(data));
            accumulatedSamples += data.length;
        } else if (hasDetectedSpeech) {
            // Trailing silence after real speech — keep accumulating through
            // the hold window so the transcript doesn't get a hard cut at
            // the exact instant speech stops, then seal once the hold
            // window elapses.
            accumulator.push(new Float32Array(data));
            accumulatedSamples += data.length;
            silenceSamplesSinceSpeech += data.length;
        }
        // else: silence before any speech has been detected — don't
        // accumulate at all, so an utterance never starts with dead air.

        const holdElapsed = hasDetectedSpeech && silenceSamplesSinceSpeech >= silenceHoldSamples;
        const hitCeiling = accumulatedSamples >= maxUtteranceSamples;

        if (hasDetectedSpeech && !sealing && (holdElapsed || hitCeiling)) {
            if (accumulatedSamples < minUtteranceSamples) {
                // Too short to bother transcribing (a click, a cough) —
                // discard and reset without an API call.
                accumulator = [];
                accumulatedSamples = 0;
                hasDetectedSpeech = false;
                silenceSamplesSinceSpeech = 0;
                return;
            }
            const toSeal = accumulator;
            const sealedSamples = accumulatedSamples;
            accumulator = [];
            accumulatedSamples = 0;
            hasDetectedSpeech = false;
            silenceSamplesSinceSpeech = 0;
            sealing = true;
            // Off the audio callback — the NEXT utterance starts
            // accumulating immediately while this transcribes/injects in
            // the background, same "never block the capture pipeline"
            // discipline as meetingCaptureService.ts's sealChunk.
            queueMicrotask(() => {
                sealUtterance(toSeal, sealedSamples, actualRate)
                    .catch((err) => console.error('[dictationService] utterance seal failed:', err))
                    .finally(() => { sealing = false; });
            });
        }
    };

    setState({
        status: 'listening',
        startedAt: Date.now(),
        elapsedMs: 0,
        utteranceCount: 0,
        lastTranscript: null,
        lastInjectedAt: null,
        lastError: null,
    });

    elapsedTimer = setInterval(() => {
        if (!state.startedAt) return;
        setState({ elapsedMs: Date.now() - state.startedAt });
    }, 1000);
}

async function sealUtterance(buffers: Float32Array[], sampleCount: number, sampleRate: number): Promise<void> {
    const merged = new Float32Array(sampleCount);
    let off = 0;
    for (const b of buffers) { merged.set(b, off); off += b.length; }

    const wav = encodeWav(merged, sampleRate);
    const text = await transcribeAudio(wav.base64, wav.mimeType);
    if (!text || !text.trim()) return; // nothing worth injecting (e.g. background noise misclassified as speech)

    const trimmed = text.trim();
    setState({ utteranceCount: state.utteranceCount + 1, lastTranscript: trimmed });

    const result = await injectTextViaDesktop(trimmed);
    if (result && !result.ok) {
        console.error('[dictationService] injectText failed:', result.error);
        setState({ lastError: result.error || 'Failed to type dictated text.' });
        return;
    }
    setState({ lastInjectedAt: Date.now() });
}

export async function stopDictation(): Promise<void> {
    if (state.status !== 'listening' && state.status !== 'starting') return;

    if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
    if (scriptProcessor) { scriptProcessor.onaudioprocess = null; scriptProcessor.disconnect(); scriptProcessor = null; }

    // Flush whatever's left in the accumulator, even if the trailing-silence
    // hold window never fully elapsed — otherwise the very last thing you
    // said before toggling off is silently dropped.
    if (hasDetectedSpeech && accumulatedSamples > 0 && ctx) {
        const finalSamples = accumulatedSamples;
        const finalBuffers = accumulator;
        accumulator = []; accumulatedSamples = 0;
        if (finalSamples >= Math.round(ctx.sampleRate * (MIN_UTTERANCE_MS / 1000))) {
            try {
                await sealUtterance(finalBuffers, finalSamples, ctx.sampleRate);
            } catch (e) {
                console.error('[dictationService] final utterance seal failed:', e);
            }
        }
    }
    hasDetectedSpeech = false;
    silenceSamplesSinceSpeech = 0;

    micStream?.getTracks().forEach((t) => t.stop());
    micStream = null;
    if (ctx) { await ctx.close().catch(() => { }); ctx = null; }

    setState({ status: 'idle', startedAt: null });
}

export async function toggleDictation(): Promise<void> {
    if (state.status === 'listening' || state.status === 'starting') {
        await stopDictation();
    } else {
        await startDictation();
    }
}

export const dictationService = {
    canUseDictation,
    onChange,
    getState,
    startDictation,
    stopDictation,
    toggleDictation,
};
