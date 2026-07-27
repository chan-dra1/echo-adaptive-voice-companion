/**
 * SingPanel.tsx — Echo Singing Studio
 *
 * Slides in from the right. Lets the user enter a topic, pick musical
 * settings, then generates lyrics via LLM and synthesizes them via Bark
 * (if HF key is available) or plays Web Audio chord accompaniment as fallback.
 */
import React, { useState, useRef, useCallback } from 'react';
import { X, Music, Play, Square, Loader2, ChevronDown } from 'lucide-react';
import {
    DEFAULT_SING_CONFIG, MUSICAL_KEYS, MUSIC_STYLES, BARK_VOICES,
    generateLyrics, buildSingSession, playSingSession,
    type SingConfig, type SingSession,
} from '../services/singingSynthesisService';

interface Props {
    onClose: () => void;
}

type Phase = 'idle' | 'writing' | 'synthesizing' | 'playing' | 'error';

// ── Small select wrapper ──────────────────────────────────────────────────────
function Sel<T extends string>({
    value, options, onChange, label,
}: {
    value: T;
    options: readonly T[] | { id: string; label: string }[];
    onChange: (v: T) => void;
    label: string;
}) {
    const isObjArr = typeof options[0] === 'object';
    return (
        <div className="flex flex-col gap-0.5">
            <span className="text-[9px] text-[var(--text-tertiary)] uppercase tracking-widest font-hud">{label}</span>
            <div className="relative">
                <select
                    value={value}
                    onChange={e => onChange(e.target.value as T)}
                    className="appearance-none w-full bg-[rgba(0,255,65,0.05)] border border-[var(--border-dim)] text-[var(--text-primary)] text-xs rounded-lg px-2 py-1.5 pr-6 font-hud focus:outline-none focus:border-[rgba(0,255,65,0.40)]"
                >
                    {isObjArr
                        ? (options as { id: string; label: string }[]).map(o => (
                            <option key={o.id} value={o.id}>{o.label}</option>
                        ))
                        : (options as readonly string[]).map(o => (
                            <option key={o} value={o}>{o}</option>
                        ))
                    }
                </select>
                <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] pointer-events-none" />
            </div>
        </div>
    );
}

// ── Lyrics display ────────────────────────────────────────────────────────────
function LyricsDisplay({ lyrics, playing }: { lyrics: string; playing: boolean }) {
    if (!lyrics) return null;
    const sections = lyrics.split(/(?=\[)/g).filter(Boolean);
    return (
        <div className="mt-3 space-y-3 overflow-y-auto max-h-64 pr-1 scrollbar-thin scrollbar-thumb-[rgba(0,255,65,0.12)]">
            {sections.map((sec, i) => {
                const [header, ...lines] = sec.split('\n');
                return (
                    <div key={i}>
                        <div className="text-[9px] text-[rgba(0,255,65,0.50)] font-hud tracking-widest mb-1">
                            {header.replace(/[\[\]]/g, '').toUpperCase()}
                        </div>
                        <div className={`space-y-0.5 border-l border-[var(--border-dim)] pl-2 transition-colors ${playing ? 'border-[rgba(0,255,65,0.30)]' : ''}`}>
                            {lines.filter(l => l.trim()).map((line, j) => (
                                <p key={j} className="text-[var(--text-secondary)] text-[11px] font-hud leading-relaxed">{line.trim()}</p>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ── Main panel ───────────────────────────────────────────────────────────────
export default function SingPanel({ onClose }: Props) {
    const [config, setConfig] = useState<SingConfig>(DEFAULT_SING_CONFIG);
    const [topic, setTopic] = useState('');
    const [phase, setPhase] = useState<Phase>('idle');
    const [statusMsg, setStatusMsg] = useState('');
    const [session, setSession] = useState<SingSession | null>(null);
    const [errMsg, setErrMsg] = useState('');

    const audioCtxRef = useRef<AudioContext | null>(null);
    const stopRef = useRef<(() => void) | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    const cfg = <K extends keyof SingConfig>(k: K, v: SingConfig[K]) =>
        setConfig(prev => ({ ...prev, [k]: v }));

    const getCtx = () => {
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
            audioCtxRef.current = new AudioContext();
        }
        if (audioCtxRef.current.state === 'suspended') {
            audioCtxRef.current.resume();
        }
        return audioCtxRef.current;
    };

    const stop = useCallback(() => {
        abortRef.current?.abort();
        stopRef.current?.();
        stopRef.current = null;
        setPhase('idle');
        setStatusMsg('');
    }, []);

    const handleSing = useCallback(async () => {
        if (!topic.trim() || phase !== 'idle') return;
        setPhase('writing');
        setErrMsg('');
        setSession(null);
        setStatusMsg('Writing lyrics…');

        const abort = new AbortController();
        abortRef.current = abort;

        try {
            const lyrics = await generateLyrics(topic.trim(), config);
            if (abort.signal.aborted) return;

            setPhase('synthesizing');
            const hfKey = localStorage.getItem('echo_hf_key');
            const ctx = getCtx();

            const built = await buildSingSession(
                lyrics, config, hfKey, ctx,
                (msg) => setStatusMsg(msg),
                abort.signal,
            );
            if (abort.signal.aborted) return;

            setSession(built);

            if (built.mode === 'webaudio' && !hfKey) {
                setStatusMsg('Playing with Web Audio (add HF API key in Settings for Bark vocals)');
            } else if (built.error) {
                setStatusMsg('Bark unavailable — playing chord accompaniment');
            } else {
                setStatusMsg('Playing…');
            }

            setPhase('playing');
            const stopFn = playSingSession(built, config, ctx);
            stopRef.current = stopFn;

            // Auto-reset when vocal buffer ends
            if (built.vocalBuffer) {
                const dur = built.vocalBuffer.duration * 1000 + 500;
                setTimeout(() => {
                    if (!abort.signal.aborted) setPhase('idle');
                }, dur);
            }

        } catch (e: unknown) {
            if ((e as Error).name === 'AbortError') return;
            setErrMsg((e as Error).message ?? 'Unknown error');
            setPhase('error');
        }
    }, [topic, config, phase]);

    const isLoading = phase === 'writing' || phase === 'synthesizing';
    const isPlaying = phase === 'playing';

    return (
        <div className="term-window h-full flex flex-col w-full max-w-full font-mono animate-phosphor-in" role="region" aria-label="Sing panel">
            {/* Header */}
            <div className="term-titlebar justify-between shrink-0">
                <div className="flex items-center gap-2">
                    <span className="term-dots" />
                    <Music size={14} className="text-[var(--accent-green)]" />
                    <span className="font-hud text-sm text-[var(--accent-green2)] tracking-wider">SING.SYS</span>
                </div>
                <button
                    onClick={onClose}
                    className="p-1 rounded-lg hover:bg-[rgba(0,255,65,0.08)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
                >
                    <X size={14} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
                {/* Topic input */}
                <div>
                    <label className="text-[9px] text-[var(--text-tertiary)] uppercase tracking-widest font-hud">Topic / Theme</label>
                    <input
                        type="text"
                        value={topic}
                        onChange={e => setTopic(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSing()}
                        placeholder="e.g. the cosmos, rainy nights, hope…"
                        className="mt-1 w-full bg-[rgba(0,255,65,0.05)] border border-[var(--border-dim)] text-[var(--text-primary)] text-xs rounded-lg px-3 py-2 font-hud placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[rgba(0,255,65,0.40)] transition-colors"
                        disabled={isLoading || isPlaying}
                    />
                </div>

                {/* Controls grid */}
                <div className="grid grid-cols-2 gap-2">
                    <Sel label="Key" value={config.key} options={MUSICAL_KEYS} onChange={v => cfg('key', v)} />
                    <div className="flex flex-col gap-0.5">
                        <span className="text-[9px] text-[var(--text-tertiary)] uppercase tracking-widest font-hud">Mode</span>
                        <div className="flex gap-1 mt-0.5">
                            {(['major','minor'] as const).map(m => (
                                <button
                                    key={m}
                                    onClick={() => cfg('mode', m)}
                                    className={`flex-1 text-[10px] py-1.5 rounded-lg border transition-all font-hud uppercase tracking-widest ${config.mode === m ? 'border-[rgba(0,255,65,0.50)] bg-[rgba(0,255,65,0.10)] text-[var(--accent-green)] text-glow-green' : 'border-[var(--border-dim)] text-[var(--text-tertiary)] hover:border-[var(--border-base)]'}`}
                                >
                                    {m}
                                </button>
                            ))}
                        </div>
                    </div>
                    <Sel label="Style" value={config.style} options={MUSIC_STYLES} onChange={v => cfg('style', v)} />
                    <Sel label="Voice" value={config.voicePreset} options={BARK_VOICES} onChange={v => cfg('voicePreset', v)} />
                </div>

                {/* BPM slider */}
                <div>
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-[9px] text-[var(--text-tertiary)] uppercase tracking-widest font-hud">Tempo</span>
                        <span className="text-[10px] text-[rgba(0,255,65,0.70)] font-hud">{config.bpm} BPM</span>
                    </div>
                    <input
                        type="range"
                        min={60} max={180} step={5}
                        value={config.bpm}
                        onChange={e => cfg('bpm', Number(e.target.value))}
                        className="w-full h-1 accent-[var(--accent-green)] cursor-pointer"
                    />
                    <div className="flex justify-between text-[8px] text-[var(--text-tertiary)] font-hud mt-0.5">
                        <span>60</span><span>180</span>
                    </div>
                </div>

                {/* Accompaniment toggle */}
                <label className="flex items-center gap-2 cursor-pointer">
                    <div
                        onClick={() => cfg('withAccompaniment', !config.withAccompaniment)}
                        className={`w-8 h-4 rounded-full transition-colors relative ${config.withAccompaniment ? 'bg-[rgba(0,255,65,0.40)]' : 'bg-[rgba(0,255,65,0.10)]'}`}
                    >
                        <div className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${config.withAccompaniment ? 'left-4 bg-[var(--accent-green)]' : 'left-0.5 bg-[rgba(0,255,65,0.40)]'}`} />
                    </div>
                    <span className="text-[11px] text-[var(--text-secondary)] font-hud">Instrumental accompaniment</span>
                </label>

                <div className="h-px bg-[rgba(0,255,65,0.06)]" />

                {/* Action button */}
                {isPlaying ? (
                    <button
                        onClick={stop}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[rgba(255,59,92,0.12)] border border-[rgba(255,59,92,0.35)] text-[var(--accent-red)] text-sm font-hud uppercase tracking-widest hover:bg-[rgba(255,59,92,0.2)] transition-all"
                    >
                        <Square size={14} /> Stop
                    </button>
                ) : (
                    <button
                        onClick={handleSing}
                        disabled={!topic.trim() || isLoading}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[rgba(0,255,65,0.10)] border border-[rgba(0,255,65,0.30)] text-[var(--accent-green)] text-glow-green text-sm font-hud uppercase tracking-widest hover:bg-[rgba(0,255,65,0.20)] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                        {isLoading
                            ? <><Loader2 size={14} className="animate-spin" /> {statusMsg || 'Working…'}</>
                            : <><Music size={14} /> Sing This</>
                        }
                    </button>
                )}

                {/* Status */}
                {isPlaying && statusMsg && (
                    <p className="text-[10px] text-[rgba(0,255,65,0.50)] font-hud text-center animate-pulse">{statusMsg}</p>
                )}

                {/* Error */}
                {phase === 'error' && (
                    <div className="text-[10px] text-[rgba(255,59,92,0.85)] font-hud bg-[rgba(255,59,92,0.08)] border border-[rgba(255,59,92,0.25)] rounded-lg px-3 py-2">
                        {errMsg}
                    </div>
                )}

                {/* HF key hint */}
                {!localStorage.getItem('echo_hf_key') && (
                    <p className="text-[9px] text-[var(--text-tertiary)] font-hud text-center leading-relaxed">
                        Add a HuggingFace API key in Settings for Bark vocal synthesis.
                        <br />Works without it — chord accompaniment plays instead.
                    </p>
                )}

                {/* Lyrics */}
                {session && <LyricsDisplay lyrics={session.lyrics} playing={isPlaying} />}
            </div>
        </div>
    );
}
