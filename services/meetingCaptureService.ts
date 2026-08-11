/**
 * meetingCaptureService.ts
 *
 * Live Meeting Mode's audio engine. Deliberately, structurally isolated from
 * services/geminiLiveService.ts — ZERO imports from it, and it never calls
 * sendRealtimeInput or anything on a Live session. That isolation is a large
 * part of why this is safe to build: geminiLiveService.ts's Live socket
 * sends every audio frame unconditionally with no VAD gate (a deliberate
 * choice there — client-side gating was previously removed because it
 * caused "never replies"), fires a synthetic prompt + reply watchdog after
 * ~250ms of silence, and treats any loud input as a barge-in that cuts
 * playback. Meeting audio running through any of that would mean Echo
 * narrating over a call and getting interrupted by whoever's talking. So
 * this owns a completely separate AudioContext, a completely separate
 * getUserMedia/getDisplayMedia capture, and talks to Gemini over plain HTTP
 * generateContent — never a Live WebSocket.
 *
 * Platform reality, verified hands-on this session (not assumed from docs):
 *   - Plain browser (Chrome/Edge): getDisplayMedia offers an audio checkbox
 *     for a Chrome TAB and, on macOS 14.2+/Chrome 141+, for the ENTIRE
 *     SCREEN (system-wide via a Core Audio tap) — but NEVER for a single
 *     WINDOW. A native Zoom.app/Teams.app window's audio cannot be captured
 *     by picking "Window" — only by sharing a browser tab running the
 *     web version of the call, or by sharing the whole screen.
 *   - Electron desktop: verified via a standalone probe (real system audio,
 *     `say` speech captured, RMS 0.137, peak 1.001, WAV round-tripped
 *     correctly) that `session.setDisplayMediaRequestHandler` +
 *     `audio: 'loopback'` + the two Mac feature flags genuinely captures
 *     real system-wide audio, INCLUDING native app windows — Electron does
 *     not have the browser's Window-sharing limitation. See
 *     electron/main.js for the real (non-throwaway) wiring. This makes
 *     Electron the strongest platform for this feature, not a blocked one.
 *   - Mobile (Capacitor/iOS/Android): structurally impossible. Mobile OSes
 *     do not let an app capture another app's audio. Gated out entirely.
 */
import { encodeWav, rms, SILENCE_RMS_THRESHOLD } from './meetingAudioEncode';
import { createMeeting, updateMeeting, getMeeting, addChunk, canPersistMeetings, ChunkSpeaker, MeetingRecord } from './meetingStore';
import { hasKeyFor, chat } from './llmRouter';
import { transcribeAudio } from './geminiTranscription';
import { pickCheapModel, temperatureFor, tokenBudget } from './costPolicy';
import { setCached, getCached } from './cryptoService';
import { agentSkillService } from './agentSkillService';
import { wakeLockService } from './wakeLockService';
import type { DraftItem } from './artifactsService';

// ── Platform gate ────────────────────────────────────────────────────────

export interface PlatformCheck {
    ok: boolean;
    reason?: string;
}

function isCapacitorNative(): boolean {
    try { return !!(window as any).Capacitor?.isNativePlatform?.(); } catch { return false; }
}

function isElectronDesktop(): boolean {
    // electron/preload.js exposes this via contextBridge — see App.tsx's
    // reliance on the same global for platform branching elsewhere.
    return typeof window !== 'undefined' && !!(window as any).echoDesktop;
}

/** Call BEFORE offering the feature in the UI, and again right before
 *  starting capture (state can change between render and click). */
export function canCaptureSystemAudio(): PlatformCheck {
    if (typeof navigator === 'undefined' || typeof navigator.mediaDevices?.getDisplayMedia !== 'function') {
        return { ok: false, reason: 'This browser does not support screen/audio capture (getDisplayMedia unavailable).' };
    }
    if (isCapacitorNative()) {
        return { ok: false, reason: "Live Meeting Mode needs system-audio capture, which mobile browsers don't support. Use Echo on desktop Chrome, Edge, or the Echo desktop app." };
    }
    let coarsePointer = false;
    try { coarsePointer = window.matchMedia?.('(pointer:coarse)')?.matches ?? false; } catch { /* ignore */ }
    if (coarsePointer && !isElectronDesktop()) {
        return { ok: false, reason: 'Live Meeting Mode needs a desktop browser or the Echo desktop app.' };
    }
    return { ok: true };
}

// ── State ─────────────────────────────────────────────────────────────────

export type CaptureStatus = 'idle' | 'requesting-permission' | 'recording' | 'stopping' | 'error';

export interface CaptureState {
    status: CaptureStatus;
    meetingId: string | null;
    startedAt: number | null;
    elapsedMs: number;
    chunkCount: number;
    lastChunkSpeaker: ChunkSpeaker | null;
    lastError: string | null;
    /** Running estimate of transcription API bytes sent, for cost visibility
     *  in the UI — not billing-accurate, just a sanity signal. */
    audioBytesSent: number;
    /** Latest extraction result — mirrors the meeting record so a live panel
     *  can render straight off onChange() without a separate store query. */
    actionItems: string[];
    decisions: string[];
    openQuestions: string[];
    runningSummary: string;
    extractionCount: number;
    /** Two SEPARATE indicators, deliberately not merged into one "saved"
     *  boolean — meetingSkill's save_meeting_notes returns success:true even
     *  when Echo Core is offline (verified: its coreAdd call is a pure no-op
     *  when disconnected, but the tool doesn't check that before reporting
     *  success). Writing to echo_drafts happens app-side, synchronously with
     *  the in-memory cache, independent of Echo Core entirely — that's the
     *  one that's actually true "your notes are not lost" signal. Echo Core
     *  save is a bonus (it additionally creates tracked tasks there), not
     *  the thing that guarantees nothing was lost. */
    savedLocally: boolean;
    echoCoreSaved: boolean;
}

export interface StartCaptureOptions {
    title: string;
    /** Off by default (see design discussion) — capturing your own mic adds
     *  a second getUserMedia and a coarse per-chunk "me vs call" label, not
     *  real diarization. */
    includeMic?: boolean;
    /** Seconds of audio per transcription chunk. Sample-count driven, not
     *  setInterval — see sealChunkIfDue(). Default 25s, matching the design. */
    chunkDurationSec?: number;
}

const DEFAULT_CHUNK_DURATION_SEC = 25;
const CAPTURE_SAMPLE_RATE = 16000;
/** Hard ceiling so an accidentally-left-running capture can't run forever
 *  and rack up transcription cost unattended. Auto-finalizes at this point. */
const MAX_CAPTURE_MS = 90 * 60 * 1000; // 90 minutes

let state: CaptureState = {
    status: 'idle',
    meetingId: null,
    startedAt: null,
    elapsedMs: 0,
    chunkCount: 0,
    lastChunkSpeaker: null,
    lastError: null,
    audioBytesSent: 0,
    actionItems: [],
    decisions: [],
    openQuestions: [],
    runningSummary: '',
    extractionCount: 0,
    savedLocally: false,
    echoCoreSaved: false,
};

const listeners = new Set<(s: CaptureState) => void>();

export function onChange(cb: (s: CaptureState) => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

function emit(): void {
    const snapshot = { ...state };
    for (const l of listeners) {
        try { l(snapshot); } catch { /* ignore listener errors */ }
    }
}

function setState(patch: Partial<CaptureState>): void {
    state = { ...state, ...patch };
    emit();
}

export function getState(): CaptureState {
    return { ...state };
}

// ── Internal capture handles (module-private, not exposed in state) ────────

let ctx: AudioContext | null = null;
let sysStream: MediaStream | null = null;
let micStream: MediaStream | null = null;
let scriptProcessor: ScriptProcessorNode | null = null;
let sysAnalyser: AnalyserNode | null = null;
let micAnalyser: AnalyserNode | null = null;
let elapsedTimer: ReturnType<typeof setInterval> | null = null;

let accumulator: Float32Array[] = [];
let accumulatedSamples = 0;
let chunkIndex = 0;
let sealing = false; // in-flight guard — never seal two chunks concurrently
let currentMeetingId: string | null = null;
let currentChunkStartedAt = 0;

// ── Extraction (live action items / decisions / summary) ──────────────────
//
// Chunk-arrival-driven, not setInterval — a backgrounded tab throttles
// timers to ~1/min, but chunk sealing keeps running off the AudioContext
// clock regardless, so triggering extraction from chunk arrival means it
// keeps working exactly when setInterval-based extraction would silently
// stop. Bounded to roughly one call per 3 minutes AND only once there's
// genuinely new material, so a 60-minute meeting makes ~12-20 extraction
// calls, not one per chunk (which would be 140+ calls at 25s chunks).
const EXTRACTION_MIN_NEW_CHARS = 1500;
const EXTRACTION_MIN_INTERVAL_MS = 180_000;

let pendingTranscriptWindow: string[] = []; // new chunk texts since the last extraction
let pendingCharCount = 0;
let lastExtractionAt = 0;
let extracting = false; // in-flight guard — never overlap two extraction calls

/** Reads 0..255 average level from an analyser — cheap, used only to decide
 *  a coarse speaker label per chunk, never per-sample. */
function analyserLevel(an: AnalyserNode | null): number {
    if (!an) return 0;
    const data = new Uint8Array(an.frequencyBinCount);
    an.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    return data.length ? sum / data.length : 0;
}

export async function startCapture(opts: StartCaptureOptions): Promise<void> {
    if (state.status === 'recording' || state.status === 'requesting-permission') {
        throw new Error('A meeting capture is already in progress.');
    }
    const gate = canCaptureSystemAudio();
    if (!gate.ok) throw new Error(gate.reason);

    if (!canPersistMeetings()) {
        throw new Error('Vault is locked — cannot start a meeting recording. Unlock Echo first (this is deliberate: meeting transcripts are never written unencrypted).');
    }
    if (!hasKeyFor('gemini')) {
        throw new Error('Live Meeting Mode transcribes via Gemini and needs a Gemini API key set in Settings, regardless of your default text-chat provider.');
    }

    setState({ status: 'requesting-permission', lastError: null });

    let localSysStream: MediaStream;
    try {
        localSysStream = await navigator.mediaDevices.getDisplayMedia({
            // getDisplayMedia requires SOME video constraint even though the
            // track is discarded within milliseconds — deliberately just
            // `true`, not a detailed constraint object (see the audio note
            // below for why detailed constraints specifically are the
            // problem, not video).
            video: true,
            // DELIBERATELY plain `true`, not a detail constraint object.
            // {echoCancellation:false, noiseSuppression:false,
            // autoGainControl:false} reproducibly broke capture start in the
            // real Electron integration test ("Error starting capture" +
            // "callback was called more than once", consistent across
            // repeated runs) while the standalone loopback probe — same
            // main-process handler, plain `audio: true` — worked cleanly.
            // These are mic-processing constraints; a loopback/system-audio
            // source isn't a microphone, so Chromium trying to apply them
            // there is plausibly exactly what fails. Untested alternative if
            // this needs revisiting: apply an equivalent Web Audio
            // (post-capture) processing step instead of requesting it at
            // the constraint level.
            audio: true,
        });
    } catch (e: any) {
        setState({ status: 'error', lastError: e?.message || 'Screen/audio share was cancelled or denied.' });
        throw e;
    }

    if (localSysStream.getAudioTracks().length === 0) {
        localSysStream.getTracks().forEach((t) => t.stop());
        const msg = "No audio track in the shared source — on a browser, make sure you ticked 'Share audio' / picked a Tab or Entire Screen, not a Window (Chrome never offers audio for a single Window).";
        setState({ status: 'error', lastError: msg });
        throw new Error(msg);
    }
    localSysStream.getVideoTracks().forEach((t) => t.stop()); // never needed past this point

    let localMicStream: MediaStream | null = null;
    if (opts.includeMic) {
        try {
            localMicStream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            });
        } catch (e: any) {
            // Mic is optional — a denial here should not abort a capture the
            // user already granted screen/system-audio permission for.
            console.warn('[meetingCapture] mic inclusion denied/failed, continuing call-audio-only:', e);
        }
    }

    let meeting;
    try {
        meeting = await createMeeting(opts.title || `Meeting ${new Date().toLocaleString()}`);
    } catch (e: any) {
        localSysStream.getTracks().forEach((t) => t.stop());
        localMicStream?.getTracks().forEach((t) => t.stop());
        setState({ status: 'error', lastError: e?.message || 'Could not create meeting record.' });
        throw e;
    }

    sysStream = localSysStream;
    micStream = localMicStream;
    currentMeetingId = meeting.id;
    chunkIndex = 0;
    accumulator = [];
    accumulatedSamples = 0;
    currentChunkStartedAt = Date.now();
    // Reset extraction bookkeeping too — these are module-level, and without
    // this a stale pending window or lastExtractionAt timestamp from a
    // PREVIOUS meeting (or a failed start earlier in the same session) would
    // leak into this one, either delaying the first real extraction or
    // silently including material from an unrelated recording.
    pendingTranscriptWindow = [];
    pendingCharCount = 0;
    lastExtractionAt = 0;
    extracting = false;

    const requestedRate = CAPTURE_SAMPLE_RATE;
    ctx = new AudioContext({ sampleRate: requestedRate } as AudioContextOptions);
    const actualRate = ctx.sampleRate;
    if (actualRate !== requestedRate) {
        // Verified-necessary fallback, not a hypothetical: some browsers
        // reject a non-native sampleRate silently and just use their own.
        // The chunk-sealing math below uses this ACTUAL rate throughout, so
        // recordings stay internally consistent even when the request wasn't
        // honored — this does not "fix" the rate, it just never lies about it.
        console.warn(`[meetingCapture] requested ${requestedRate}Hz AudioContext, got ${actualRate}Hz — using actual rate for all chunk math.`);
    }

    const mixBus = ctx.createGain();
    mixBus.gain.value = 1.0;

    const sysSrc = ctx.createMediaStreamSource(sysStream);
    sysAnalyser = ctx.createAnalyser();
    sysAnalyser.fftSize = 256;
    sysSrc.connect(sysAnalyser);
    sysSrc.connect(mixBus);

    if (micStream) {
        const micSrc = ctx.createMediaStreamSource(micStream);
        micAnalyser = ctx.createAnalyser();
        micAnalyser.fftSize = 256;
        micSrc.connect(micAnalyser);
        micSrc.connect(mixBus);
    }

    scriptProcessor = ctx.createScriptProcessor(4096, 1, 1);
    mixBus.connect(scriptProcessor);
    const sink = ctx.createGain();
    sink.gain.value = 0; // silent — we never want this played back out loud
    scriptProcessor.connect(sink);
    sink.connect(ctx.destination); // required: a ScriptProcessor only fires when connected downstream

    const chunkSamples = Math.round(actualRate * (opts.chunkDurationSec ?? DEFAULT_CHUNK_DURATION_SEC));

    scriptProcessor.onaudioprocess = (e: AudioProcessingEvent) => {
        // Cheap-only work in this callback: copy the buffer and accumulate.
        // No React, no localStorage, no crypto, no JSON — see module doc.
        const data = e.inputBuffer.getChannelData(0);
        accumulator.push(new Float32Array(data));
        accumulatedSamples += data.length;

        if (accumulatedSamples >= chunkSamples && !sealing) {
            const toSeal = accumulator;
            const sealedSamples = accumulatedSamples;
            accumulator = [];
            accumulatedSamples = 0;
            const startedAt = currentChunkStartedAt;
            currentChunkStartedAt = Date.now();
            const speakerLabel = classifySpeaker();
            sealing = true;
            // Encode/transcribe/persist off the audio callback — sample-count
            // driven sealing continues to accumulate into the NEW accumulator
            // while this async work runs, so no audio is dropped waiting on it.
            queueMicrotask(() => {
                sealChunk(toSeal, sealedSamples, actualRate, speakerLabel, startedAt)
                    .catch((err) => console.error('[meetingCapture] chunk seal failed:', err))
                    .finally(() => { sealing = false; });
            });
        }
    };

    function classifySpeaker(): ChunkSpeaker {
        if (!micAnalyser) return 'call';
        const sysLevel = analyserLevel(sysAnalyser);
        const micLevel = analyserLevel(micAnalyser);
        const total = sysLevel + micLevel;
        if (total < 2) return 'unknown'; // both near-silent
        const sysShare = sysLevel / total;
        if (sysShare > 0.65) return 'call';
        if (sysShare < 0.35) return 'me';
        return 'mixed';
    }

    // Holds the lock under its own 'meeting' key, independent of any 'voice'
    // holder — see wakeLockService.ts's module doc. Without this, a screen
    // sleeping mid-meeting risks the tab being backgrounded/throttled hard
    // enough to disrupt capture; and even once held, a concurrent voice
    // session idling out must not silently drop this meeting's lock.
    try { void wakeLockService.acquire('meeting', {}); } catch { /* non-fatal */ }

    setState({
        status: 'recording',
        meetingId: meeting.id,
        startedAt: Date.now(),
        elapsedMs: 0,
        chunkCount: 0,
        lastChunkSpeaker: null,
        audioBytesSent: 0,
        // Reset every per-meeting field, not just the ones added when this
        // block was first written — without this, starting a SECOND meeting
        // right after a first one briefly shows the PREVIOUS meeting's
        // action items/summary/save-status until the new meeting's own
        // first extraction or finalize overwrites them.
        actionItems: [],
        decisions: [],
        openQuestions: [],
        runningSummary: '',
        extractionCount: 0,
        savedLocally: false,
        echoCoreSaved: false,
        lastError: null,
    });

    elapsedTimer = setInterval(() => {
        if (!state.startedAt) return;
        const elapsed = Date.now() - state.startedAt;
        setState({ elapsedMs: elapsed });
        if (elapsed >= MAX_CAPTURE_MS) {
            void stopCapture(); // hard cost ceiling — see module doc
        }
    }, 1000);
}

async function sealChunk(
    buffers: Float32Array[],
    sampleCount: number,
    sampleRate: number,
    speaker: ChunkSpeaker,
    startedAtMs: number,
): Promise<void> {
    if (!currentMeetingId) return;
    const merged = new Float32Array(sampleCount);
    let off = 0;
    for (const b of buffers) { merged.set(b, off); off += b.length; }

    const signal = rms(merged);
    const durationMs = Math.round((sampleCount / sampleRate) * 1000);
    if (signal < SILENCE_RMS_THRESHOLD) {
        // Skip transcription entirely for near-silent chunks — saves an API
        // call for dead air, which is common in real meetings.
        chunkIndex++;
        setState({ chunkCount: chunkIndex });
        return;
    }

    const wav = encodeWav(merged, sampleRate);
    const text = await transcribeAudio(wav.base64, wav.mimeType);
    if (text && text.trim()) {
        const trimmed = text.trim();
        await addChunk(currentMeetingId, chunkIndex, trimmed, speaker, startedAtMs, durationMs);
        pendingTranscriptWindow.push(trimmed);
        pendingCharCount += trimmed.length;
    }
    chunkIndex++;
    setState({ chunkCount: chunkIndex, lastChunkSpeaker: speaker, audioBytesSent: state.audioBytesSent + wav.byteLength });

    // Fire-and-forget: extraction must never block the audio pipeline (the
    // NEXT chunk keeps accumulating in the background regardless of how
    // long this takes). Errors are logged, never thrown into the caller —
    // a failed extraction should not tear down an otherwise-healthy capture.
    void maybeExtract(currentMeetingId).catch((e) => console.error('[meetingCapture] extraction failed:', e));
}

interface ExtractionResult {
    action_items?: string[];
    decisions?: string[];
    open_questions?: string[];
    running_summary?: string;
}

/** `force` bypasses the char-count/interval thresholds — used exactly once,
 *  when stopping capture, so the last few minutes of a meeting (which may
 *  be well under the normal 1500-char/3-min trigger) still gets summarized
 *  instead of silently falling below the threshold forever. Still respects
 *  the in-flight guard and the "is there anything to extract at all" check. */
async function maybeExtract(meetingId: string, force = false): Promise<void> {
    if (extracting) return;
    if (pendingCharCount === 0) return;
    if (!force) {
        if (pendingCharCount < EXTRACTION_MIN_NEW_CHARS) return;
        if (Date.now() - lastExtractionAt < EXTRACTION_MIN_INTERVAL_MS) return;
    }

    extracting = true;
    const window = pendingTranscriptWindow.join('\n');
    // Clear the pending window BEFORE the call, not after — if two chunks
    // land while this extraction is in flight, they should accumulate into
    // the NEXT window, not be silently dropped by being cleared afterward
    // and never included anywhere.
    pendingTranscriptWindow = [];
    pendingCharCount = 0;
    lastExtractionAt = Date.now();

    try {
        const modelPick = pickCheapModel('summarize');
        const priorState = JSON.stringify({
            action_items: state.actionItems,
            decisions: state.decisions,
            open_questions: state.openQuestions,
            running_summary: state.runningSummary,
        });

        // Explicit provider+model, not llmRouter's own chooseProvider default —
        // mandatory, not stylistic. Without this, chat() could land on
        // echoCloud (its proxy caps at 30 msgs/day) or whatever the user has
        // set as their default text-chat brain, silently competing with their
        // own conversations for that quota. Never resend the full transcript
        // here either — only the new window since the last extraction, plus
        // the previous JSON state — full-transcript resends would be
        // quadratic token spend over the course of an hour.
        const result = await chat({
            provider: modelPick.provider,
            model: modelPick.model,
            temperature: temperatureFor('summarize'),
            maxTokens: tokenBudget('summarize'),
            json: true,
            messages: [
                {
                    role: 'system',
                    content: 'You track a live meeting transcript incrementally. Given the prior extracted state and a new window of transcript, ' +
                        'return updated JSON: {"action_items": string[], "decisions": string[], "open_questions": string[], "running_summary": string}. ' +
                        'Merge with the prior state — keep everything still relevant, add anything new, drop anything explicitly resolved/superseded. ' +
                        'action_items should be phrased as clear tasks, prefixed with an owner name if mentioned. running_summary should be dense prose, ' +
                        'a few sentences, not a transcript recap. Output ONLY the JSON object, nothing else.',
                },
                {
                    role: 'user',
                    content: `Prior state:\n${priorState}\n\nNew transcript window:\n${window}`,
                },
            ],
        });

        const parsed: ExtractionResult = JSON.parse(result.text);
        const nextActionItems = Array.isArray(parsed.action_items) ? parsed.action_items : state.actionItems;
        const nextDecisions = Array.isArray(parsed.decisions) ? parsed.decisions : state.decisions;
        const nextOpenQuestions = Array.isArray(parsed.open_questions) ? parsed.open_questions : state.openQuestions;
        const nextSummary = typeof parsed.running_summary === 'string' ? parsed.running_summary : state.runningSummary;

        setState({
            actionItems: nextActionItems,
            decisions: nextDecisions,
            openQuestions: nextOpenQuestions,
            runningSummary: nextSummary,
            extractionCount: state.extractionCount + 1,
        });

        // Persist to the meeting record too, not just in-memory state — if
        // the tab closes mid-meeting, the last successful extraction survives
        // in the store even though the live capture state doesn't.
        await updateMeeting(meetingId, {
            actionItems: nextActionItems,
            decisions: nextDecisions,
            openQuestions: nextOpenQuestions,
            runningSummary: nextSummary,
        });
    } catch (e) {
        // A failed/malformed extraction (e.g. JSON.parse failure on a model
        // that didn't follow instructions) should not lose the transcript
        // text that was already persisted via addChunk — only the SUMMARY
        // attempt failed, not the recording. Put the window back so the
        // NEXT successful extraction still covers this material instead of
        // silently skipping it.
        pendingTranscriptWindow.unshift(window);
        pendingCharCount += window.length;
        throw e;
    } finally {
        extracting = false;
    }
}

export async function stopCapture(): Promise<void> {
    if (state.status !== 'recording') return;
    setState({ status: 'stopping' });
    try { void wakeLockService.release('meeting'); } catch { /* non-fatal */ }

    if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
    if (scriptProcessor) { scriptProcessor.onaudioprocess = null; scriptProcessor.disconnect(); scriptProcessor = null; }
    sysAnalyser?.disconnect(); sysAnalyser = null;
    micAnalyser?.disconnect(); micAnalyser = null;

    // Seal whatever's left in the accumulator, even if short of a full chunk —
    // otherwise the last <25s of a meeting is silently dropped.
    if (accumulatedSamples > 0 && ctx) {
        const finalSamples = accumulatedSamples;
        const finalBuffers = accumulator;
        accumulator = []; accumulatedSamples = 0;
        try {
            await sealChunk(finalBuffers, finalSamples, ctx.sampleRate, 'unknown', currentChunkStartedAt);
        } catch (e) {
            console.error('[meetingCapture] final chunk seal failed:', e);
        }
    }

    // Force a final extraction pass regardless of the normal 1500-char/3-min
    // thresholds — without this, the last few minutes of a meeting (often
    // well under that threshold) never gets summarized at all. sealChunk's
    // own fire-and-forget maybeExtract() call above may already be running;
    // this one is awaited so stopCapture() doesn't resolve with a stale
    // summary while an extraction is silently still in flight.
    if (currentMeetingId && pendingCharCount > 0) {
        try {
            await maybeExtract(currentMeetingId, true);
        } catch (e) {
            console.error('[meetingCapture] final extraction failed:', e);
        }
    }

    // Stop every raw track this run created — both system and mic — plus
    // close the context. Verified-necessary: the standalone probe this was
    // modeled on left tracks alive if teardown didn't explicitly walk both
    // streams (a real bug found in the codebase's OTHER, unused
    // startInterviewMode sketch, which this deliberately does not repeat).
    sysStream?.getTracks().forEach((t) => t.stop());
    micStream?.getTracks().forEach((t) => t.stop());
    sysStream = null; micStream = null;
    if (ctx) { await ctx.close().catch(() => { }); ctx = null; }

    if (currentMeetingId) {
        try {
            await updateMeeting(currentMeetingId, { status: 'done', endedAt: Date.now(), chunkCount: chunkIndex });
        } catch (e) {
            console.error('[meetingCapture] failed to finalize meeting record:', e);
        }
        await finalizeAndSave(currentMeetingId);
    }

    const finishedMeetingId = currentMeetingId;
    currentMeetingId = null;
    setState({ status: 'idle', meetingId: null, startedAt: null });
    return void finishedMeetingId;
}

function buildMeetingMarkdown(m: MeetingRecord): string {
    const lines = [`# ${m.title}`, ''];
    if (m.runningSummary) lines.push('## Summary', m.runningSummary, '');
    if (m.decisions.length) {
        lines.push('## Decisions');
        m.decisions.forEach((d) => lines.push(`- ${d}`));
        lines.push('');
    }
    if (m.actionItems.length) {
        lines.push('## Action Items');
        m.actionItems.forEach((a) => lines.push(`- [ ] ${a}`));
        lines.push('');
    }
    if (m.openQuestions.length) {
        lines.push('## Open Questions');
        m.openQuestions.forEach((q) => lines.push(`- ${q}`));
        lines.push('');
    }
    return lines.join('\n');
}

/**
 * Two independent saves, in a specific order, for a specific reason.
 *
 * 1. echo_drafts FIRST, synchronously with the in-memory cache — this is
 *    the save that's actually guaranteed. It doesn't depend on Echo Core
 *    being online, doesn't depend on network, doesn't depend on anything
 *    meetingSkill.ts does.
 * 2. meetingSkill's save_meeting_notes SECOND, best-effort — this is a
 *    bonus: when Echo Core IS online, it additionally creates real tracked
 *    tasks there from the action items. When Echo Core is offline, this
 *    call still returns {success:true} (verified: skills/meetingSkill.ts's
 *    coreAdd is a no-op when disconnected, but the tool doesn't check that
 *    before reporting success) — which is exactly why step 1 cannot depend
 *    on step 2 succeeding, and why the two get separate state flags instead
 *    of being collapsed into one "saved" boolean the UI might trust wrongly.
 */
async function finalizeAndSave(meetingId: string): Promise<void> {
    const meeting = await getMeeting(meetingId).catch(() => undefined);
    if (!meeting) {
        console.error('[meetingCapture] finalizeAndSave: meeting record not found, cannot save notes.');
        return;
    }

    let savedLocally = false;
    try {
        const draft: DraftItem = {
            id: crypto.randomUUID(),
            kind: 'meeting',
            title: meeting.title,
            content: buildMeetingMarkdown(meeting),
            createdAt: Date.now(),
        };
        const existing = getCached<DraftItem[]>('echo_drafts', []);
        setCached('echo_drafts', [...existing, draft]);
        savedLocally = true;
    } catch (e) {
        console.error('[meetingCapture] failed to save draft locally (this is the save that matters most):', e);
    }

    let echoCoreSaved = false;
    try {
        const result = await agentSkillService.executeTool('save_meeting_notes', {
            title: meeting.title,
            summary: meeting.runningSummary || '(no summary — meeting ended before the first extraction ran)',
            action_items: meeting.actionItems,
            decisions: meeting.decisions,
        });
        // Do NOT trust result.success at face value — see the module doc
        // above. isCoreConnected() (surfaced via savedToDashboard in the
        // tool's own return shape) is the real signal.
        echoCoreSaved = !!(result && !result.error && result.savedToDashboard);
    } catch (e) {
        console.warn('[meetingCapture] save_meeting_notes (Echo Core bonus path) failed, non-fatal:', e);
    }

    setState({ savedLocally, echoCoreSaved });
}
