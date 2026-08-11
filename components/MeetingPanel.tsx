import React, { useEffect, useState } from 'react';
import { Video, X, Play, Square, Loader2 } from 'lucide-react';
import * as capture from '../services/meetingCaptureService';
import { listMeetings, MeetingRecord } from '../services/meetingStore';

interface MeetingPanelProps {
    onClose: () => void;
}

function fmtElapsed(ms: number): string {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
}

const MeetingPanel: React.FC<MeetingPanelProps> = ({ onClose }) => {
    const [state, setState] = useState(() => capture.getState());
    const [title, setTitle] = useState('');
    const [includeMic, setIncludeMic] = useState(false);
    const [pastMeetings, setPastMeetings] = useState<MeetingRecord[]>([]);
    const [startError, setStartError] = useState<string | null>(null);
    const [starting, setStarting] = useState(false);

    useEffect(() => capture.onChange(setState), []);

    // Refresh the past-meetings list whenever we land back on idle — covers
    // both "panel just opened" and "a recording just finished".
    useEffect(() => {
        if (state.status === 'idle') {
            listMeetings().then(setPastMeetings).catch(() => { });
        }
    }, [state.status]);

    // Re-checked at render (platform state can change between opens — e.g.
    // switching from desktop Chrome tab to a coarse-pointer window resize),
    // and AGAIN inside handleStart right before actually calling the
    // service, since state can also change in the gap between render and
    // click.
    const gate = capture.canCaptureSystemAudio();

    const handleStart = async () => {
        setStartError(null);
        const recheck = capture.canCaptureSystemAudio();
        if (!recheck.ok) {
            setStartError(recheck.reason || 'Live Meeting Mode is not available right now.');
            return;
        }
        setStarting(true);
        try {
            await capture.startCapture({
                title: title.trim() || `Meeting ${new Date().toLocaleString()}`,
                includeMic,
            });
        } catch (e: any) {
            setStartError(e?.message || 'Could not start capture.');
        } finally {
            setStarting(false);
        }
    };

    const handleStop = async () => {
        await capture.stopCapture();
    };

    const isRecording = state.status === 'recording' || state.status === 'stopping';
    const justFinished = state.status === 'idle' && (state.savedLocally || state.echoCoreSaved);

    return (
        <div
            className="term-window fixed top-20 left-4 right-4 w-auto md:left-auto md:w-[26rem] z-50 flex flex-col max-h-[75vh] animate-phosphor-in"
            style={{ borderColor: 'var(--accent-cyan)' }}
        >
            <div className="term-titlebar" style={{ color: 'var(--accent-cyan)' }}>
                <span className="term-dots" />
                <div className="flex items-center gap-2 flex-1" style={{ color: 'var(--accent-cyan)' }}>
                    <Video size={14} aria-hidden="true" />
                    <span className="text-xs font-[var(--font-term)] font-bold tracking-[0.2em] uppercase">
                        LIVE MEETING{isRecording ? ` — ${fmtElapsed(state.elapsedMs)}` : ''}
                    </span>
                </div>
                <button
                    onClick={onClose}
                    className="text-[var(--text-tertiary)] hover:text-[var(--accent-cyan)] transition-colors"
                    aria-label="Close meeting panel"
                >
                    <X size={16} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-hide" style={{ background: 'rgba(1,7,3,0.92)' }}>
                {!gate.ok && !isRecording && (
                    <p className="text-xs text-[var(--accent-red)] font-mono leading-relaxed p-2.5 border border-[rgba(255,59,92,0.3)] rounded-md">
                        {gate.reason}
                    </p>
                )}

                {gate.ok && !isRecording && (
                    <div className="space-y-2">
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="Meeting title (optional)"
                            className="w-full bg-[#010502] border border-[var(--border-dim)] rounded px-3 py-2 text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--border-green)]"
                        />
                        <label className="flex items-center gap-2 text-xs font-mono text-[var(--text-secondary)] cursor-pointer">
                            <input
                                type="checkbox"
                                checked={includeMic}
                                onChange={(e) => setIncludeMic(e.target.checked)}
                                className="accent-[var(--accent-green)]"
                            />
                            Include my microphone too (off = call audio only)
                        </label>
                        {startError && <p className="text-xs text-[var(--accent-red)] font-mono">⚠ {startError}</p>}
                        <button
                            onClick={handleStart}
                            disabled={starting}
                            className="w-full flex items-center justify-center gap-2 py-2 rounded bg-[rgba(0,255,65,0.1)] border border-[rgba(0,255,65,0.3)] text-[var(--accent-green)] hover:bg-[rgba(0,255,65,0.18)] disabled:opacity-40 disabled:cursor-not-allowed transition-all font-mono text-xs uppercase tracking-widest"
                        >
                            {starting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                            {starting ? 'Requesting permission…' : 'Start Recording'}
                        </button>
                        <p className="text-[10px] text-[var(--text-tertiary)] font-mono leading-relaxed">
                            You'll be asked to share a screen/tab and tick "share audio" — that's how system audio capture works, this stays local and encrypted.
                        </p>
                    </div>
                )}

                {isRecording && (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between text-[10px] font-mono text-[var(--text-tertiary)]">
                            <span>{state.chunkCount} chunk{state.chunkCount === 1 ? '' : 's'}</span>
                            <span>{(state.audioBytesSent / 1024).toFixed(0)} KB sent</span>
                            <span>{state.extractionCount} extraction{state.extractionCount === 1 ? '' : 's'}</span>
                        </div>
                        <button
                            onClick={handleStop}
                            disabled={state.status === 'stopping'}
                            className="w-full flex items-center justify-center gap-2 py-2 rounded bg-[rgba(255,59,92,0.1)] border border-[rgba(255,59,92,0.3)] text-[var(--accent-red)] hover:bg-[rgba(255,59,92,0.18)] disabled:opacity-40 disabled:cursor-not-allowed transition-all font-mono text-xs uppercase tracking-widest"
                        >
                            {state.status === 'stopping' ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />}
                            {state.status === 'stopping' ? 'Saving…' : 'Stop Recording'}
                        </button>

                        {state.runningSummary && (
                            <div className="text-xs font-mono text-[var(--text-secondary)] leading-relaxed">
                                <p className="uppercase text-[var(--text-tertiary)] tracking-wider mb-1 text-[10px]">Summary (live)</p>
                                <p>{state.runningSummary}</p>
                            </div>
                        )}
                        {state.actionItems.length > 0 && (
                            <div className="text-xs font-mono">
                                <p className="uppercase text-[var(--text-tertiary)] tracking-wider mb-1 text-[10px]">Action Items</p>
                                <ul className="space-y-1">
                                    {state.actionItems.map((a, i) => (
                                        <li key={i} className="text-[var(--text-primary)]">☐ {a}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {state.decisions.length > 0 && (
                            <div className="text-xs font-mono">
                                <p className="uppercase text-[var(--text-tertiary)] tracking-wider mb-1 text-[10px]">Decisions</p>
                                <ul className="space-y-1">
                                    {state.decisions.map((d, i) => (
                                        <li key={i} className="text-[var(--text-primary)]">• {d}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {state.chunkCount === 0 && (
                            <p className="text-[10px] text-[var(--text-tertiary)] font-mono">
                                Listening — the first chunk transcribes in ~25s.
                            </p>
                        )}
                    </div>
                )}

                {state.status === 'error' && state.lastError && (
                    <p className="text-xs text-[var(--accent-red)] font-mono">⚠ {state.lastError}</p>
                )}

                {/* Two SEPARATE indicators, deliberately never collapsed into
                    one "saved" message — see meetingCaptureService.ts's own
                    doc comment on why Echo Core reporting success even while
                    offline makes that distinction necessary here. */}
                {justFinished && (
                    <div className="text-[10px] font-mono space-y-0.5 p-2 rounded border border-[var(--border-dim)]">
                        <p className={state.savedLocally ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}>
                            {state.savedLocally ? '✓ Saved locally (encrypted)' : '✗ Local save failed'}
                        </p>
                        <p className={state.echoCoreSaved ? 'text-[var(--accent-green)]' : 'text-[var(--text-tertiary)]'}>
                            {state.echoCoreSaved ? '✓ Echo Core: tasks tracked' : 'Echo Core: offline (tasks not tracked there)'}
                        </p>
                    </div>
                )}

                {state.status === 'idle' && pastMeetings.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]">
                        <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Past Meetings</p>
                        {pastMeetings.slice(0, 10).map((m) => (
                            <div key={m.id} className="p-2 rounded border border-[var(--border-dim)] text-xs font-mono">
                                <p className="text-[var(--text-primary)] truncate">{m.title}</p>
                                <p className="text-[10px] text-[var(--text-tertiary)]">
                                    {new Date(m.startedAt).toLocaleString()} · {m.actionItems.length} action item{m.actionItems.length === 1 ? '' : 's'}
                                </p>
                            </div>
                        ))}
                    </div>
                )}

                {state.status === 'idle' && !isRecording && pastMeetings.length === 0 && gate.ok && (
                    <p className="text-xs text-[var(--text-tertiary)] font-mono text-center py-4">
                        &gt; No meetings recorded yet.
                    </p>
                )}
            </div>
        </div>
    );
};

export default MeetingPanel;
