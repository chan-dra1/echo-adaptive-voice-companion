import React, { useEffect, useState } from 'react';
import {
    X, Cpu, Clock, Brain, Camera, RefreshCw, Plus, Trash2, Bell,
} from 'lucide-react';
import {
    isCoreConnected, getCoreSchedules, getCoreMemories,
    coreRemove, coreAddSchedule, coreAddMemory,
} from '../services/echoCoreSync';
import { isHandsConnected, handsCall } from '../services/handsBridgeService';
import { getHaCameraSnapshot } from '../services/smartHomeService';

interface Props { onClose: () => void; }

type Tab = 'schedule' | 'memory' | 'cameras';

/** Human-readable description of a schedule's `when` spec. */
function describeWhen(when: any): string {
    if (!when || typeof when !== 'object') return 'scheduled';
    if (when.kind === 'daily') {
        const t = String(when.at || '').trim();
        return t ? `every day at ${t}` : 'every day';
    }
    if (when.kind === 'once') {
        const at = when.at;
        const d = at ? new Date(at) : null;
        if (d && !isNaN(d.getTime())) return d.toLocaleString();
        return 'one time';
    }
    return when.kind ? String(when.kind) : 'scheduled';
}

/** Best-effort label for a schedule item. */
function scheduleLabel(s: any): string {
    return s.text || s.title || s.description || s.note || '(reminder)';
}

export default function CorePanel({ onClose }: Props) {
    const [tab, setTab] = useState<Tab>('schedule');
    const [schedules, setSchedules] = useState<any[]>([]);
    const [memories, setMemories] = useState<any[]>([]);
    const [reminderText, setReminderText] = useState('');
    const [reminderTime, setReminderTime] = useState('');
    const [memoryText, setMemoryText] = useState('');
    const coreOn = isCoreConnected();

    const refresh = () => {
        setSchedules(isCoreConnected() ? [...getCoreSchedules()] : []);
        setMemories(isCoreConnected() ? [...getCoreMemories()] : []);
    };

    useEffect(() => {
        refresh();
        const onChange = () => refresh();
        window.addEventListener('echocore:change', onChange);
        window.addEventListener('echocore:snapshot', onChange);
        window.addEventListener('echocore:status', onChange);
        return () => {
            window.removeEventListener('echocore:change', onChange);
            window.removeEventListener('echocore:snapshot', onChange);
            window.removeEventListener('echocore:status', onChange);
        };
        /* eslint-disable-next-line */
    }, []);

    const addReminder = () => {
        const text = reminderText.trim();
        if (!text) return;
        // If the user gave a HH:MM time, schedule it daily; otherwise leave Core to interpret.
        const time = reminderTime.trim();
        const when = /^\d{1,2}:\d{2}$/.test(time)
            ? { kind: 'daily', at: time }
            : { kind: 'daily', at: '09:00' };
        coreAddSchedule({ text, when });
        setReminderText('');
        setReminderTime('');
    };

    const addMemory = () => {
        const text = memoryText.trim();
        if (!text) return;
        coreAddMemory(text);
        setMemoryText('');
    };

    const TABS: { id: Tab; label: string; icon: React.ReactNode; n?: number }[] = [
        { id: 'schedule', label: 'Schedule', icon: <Clock size={14} />, n: schedules.length },
        { id: 'memory', label: 'Memory', icon: <Brain size={14} />, n: memories.length },
        { id: 'cameras', label: 'Cameras', icon: <Camera size={14} /> },
    ];

    return (
        <div className="fixed inset-0 z-[65] flex items-stretch justify-end bg-black/70 backdrop-blur-sm" onClick={onClose}>
            <div
                className="term-window relative w-full max-w-md h-full shadow-2xl flex flex-col font-mono animate-[slideIn_0.25s_ease]"
                onClick={e => e.stopPropagation()}
                style={{ boxShadow: '0 0 60px rgba(87,255,176,0.10)', borderColor: 'var(--accent-cyan)' }}
            >
                {/* Header */}
                <div className="term-titlebar" style={{ color: 'var(--accent-cyan)' }}>
                    <span className="term-dots" />
                    <Cpu size={16} style={{ color: 'var(--accent-cyan)' }} aria-hidden="true" />
                    <div className="flex-1">
                        <div className="text-xs tracking-[0.25em] uppercase" style={{ color: 'var(--accent-cyan)' }}>CORE.DAEMON</div>
                        <div className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest">
                            {coreOn ? 'Echo Core · live' : 'Echo Core offline'}
                        </div>
                    </div>
                    <button onClick={refresh} className="p-1.5 rounded hover:bg-[rgba(87,255,176,0.1)]" title="Refresh">
                        <RefreshCw size={15} style={{ color: 'var(--accent-cyan)' }} />
                    </button>
                    <button onClick={onClose} className="p-1.5 rounded hover:bg-[rgba(87,255,176,0.1)] text-[var(--text-tertiary)] hover:text-[var(--accent-cyan)]" aria-label="Close core panel"><X size={16} /></button>
                </div>

                {/* Tabs */}
                <div className="flex border-b" style={{ borderColor: 'var(--border-dim)' }}>
                    {TABS.map(t => (
                        <button key={t.id} onClick={() => setTab(t.id)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] tracking-widest uppercase transition border-b-2"
                            style={tab === t.id ? { borderColor: 'var(--accent-cyan)', color: 'var(--accent-cyan)', background: 'rgba(87,255,176,0.05)' } : { borderColor: 'transparent', color: 'var(--text-tertiary)' }}>
                            {t.icon}{t.label}{typeof t.n === 'number' && <span className="opacity-50">({t.n})</span>}
                        </button>
                    ))}
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
                    {!coreOn && tab !== 'cameras' && (
                        <div className="text-center text-[var(--text-tertiary)] text-xs py-10 px-6 leading-relaxed">
                            <Cpu size={28} className="mx-auto mb-3 opacity-40" />
                            Echo Core isn't connected. Start the terminal brain and pair it via
                            <span style={{ color: 'var(--accent-cyan)' }}> ⌘K → Connect Echo Core</span> to manage reminders and memory here.
                        </div>
                    )}

                    {coreOn && tab === 'schedule' && (
                        <ScheduleTab
                            schedules={schedules}
                            reminderText={reminderText}
                            reminderTime={reminderTime}
                            setReminderText={setReminderText}
                            setReminderTime={setReminderTime}
                            onAdd={addReminder}
                            onCancel={(id) => coreRemove('schedules', id)}
                        />
                    )}

                    {coreOn && tab === 'memory' && (
                        <MemoryTab
                            memories={memories}
                            memoryText={memoryText}
                            setMemoryText={setMemoryText}
                            onAdd={addMemory}
                            onForget={(id) => coreRemove('memories', id)}
                        />
                    )}

                    {tab === 'cameras' && <CamerasTab />}
                </div>
            </div>
            <style>{`@keyframes slideIn { from { transform: translateX(30px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }`}</style>
        </div>
    );
}

/* ── Schedule tab ── */

function ScheduleTab({ schedules, reminderText, reminderTime, setReminderText, setReminderTime, onAdd, onCancel }: {
    schedules: any[];
    reminderText: string;
    reminderTime: string;
    setReminderText: (v: string) => void;
    setReminderTime: (v: string) => void;
    onAdd: () => void;
    onCancel: (id: string) => void;
}) {
    return (
        <>
            {/* Add reminder */}
            <div className="mb-3 p-3 rounded-lg bg-[rgba(0,255,65,0.03)] border border-[var(--border-dim)] space-y-2">
                <input
                    value={reminderText}
                    onChange={e => setReminderText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') onAdd(); }}
                    placeholder="Remind me to…"
                    className="w-full bg-black/40 border border-[var(--border-dim)] rounded-md px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-[var(--accent-cyan)]/50"
                />
                <div className="flex items-center gap-2">
                    <input
                        value={reminderTime}
                        onChange={e => setReminderTime(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') onAdd(); }}
                        placeholder="HH:MM (daily)"
                        className="flex-1 bg-black/40 border border-[var(--border-dim)] rounded-md px-3 py-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-[var(--accent-cyan)]/50"
                    />
                    <button
                        onClick={onAdd}
                        disabled={!reminderText.trim()}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-[rgba(87,255,176,0.1)] border border-[var(--accent-cyan)]/40 hover:bg-[rgba(87,255,176,0.18)] disabled:opacity-30 transition text-[11px] tracking-widest uppercase"
                        style={{ color: 'var(--accent-cyan)' }}
                    >
                        <Plus size={13} /> Add reminder
                    </button>
                </div>
            </div>

            {schedules.length === 0 ? (
                <div className="text-center text-[var(--text-tertiary)] text-xs py-12 px-6 leading-relaxed">
                    <Bell size={28} className="mx-auto mb-3 opacity-40" />
                    No reminders or briefings yet.
                </div>
            ) : (
                schedules.map((s) => (
                    <div key={s.id} className="group relative p-3 rounded-lg bg-[rgba(0,255,65,0.03)] border border-[var(--border-dim)] hover:border-[var(--accent-cyan)]/30 transition">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                                <div className="text-sm text-[var(--text-primary)] break-words">{scheduleLabel(s)}</div>
                                <div className="text-[10px] uppercase tracking-widest mt-1 flex items-center gap-1" style={{ color: 'var(--accent-cyan)', opacity: 0.8 }}>
                                    <Clock size={11} /> {describeWhen(s.when)}
                                </div>
                            </div>
                            <button
                                onClick={() => onCancel(s.id)}
                                className="p-2 rounded-md bg-[rgba(0,255,65,0.04)] border border-[var(--border-dim)] text-[var(--text-tertiary)] hover:bg-[rgba(255,59,92,0.12)] hover:border-[var(--accent-red)]/40 hover:text-[var(--accent-red)] transition flex-shrink-0"
                                title="Cancel reminder"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    </div>
                ))
            )}
        </>
    );
}

/* ── Memory tab ── */

function MemoryTab({ memories, memoryText, setMemoryText, onAdd, onForget }: {
    memories: any[];
    memoryText: string;
    setMemoryText: (v: string) => void;
    onAdd: () => void;
    onForget: (id: string) => void;
}) {
    return (
        <>
            <div className="mb-3 p-3 rounded-lg bg-[rgba(0,255,65,0.03)] border border-[var(--border-dim)] flex items-center gap-2">
                <input
                    value={memoryText}
                    onChange={e => setMemoryText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') onAdd(); }}
                    placeholder="Something Echo should remember…"
                    className="flex-1 bg-black/40 border border-[var(--border-dim)] rounded-md px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-[var(--accent-cyan)]/50"
                />
                <button
                    onClick={onAdd}
                    disabled={!memoryText.trim()}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-[rgba(87,255,176,0.1)] border border-[var(--accent-cyan)]/40 hover:bg-[rgba(87,255,176,0.18)] disabled:opacity-30 transition text-[11px] tracking-widest uppercase"
                    style={{ color: 'var(--accent-cyan)' }}
                >
                    <Plus size={13} /> Remember
                </button>
            </div>

            {memories.length === 0 ? (
                <div className="text-center text-[var(--text-tertiary)] text-xs py-12 px-6 leading-relaxed">
                    <Brain size={28} className="mx-auto mb-3 opacity-40" />
                    Nothing memorized yet. Add a fact and Echo will keep it.
                </div>
            ) : (
                memories.map((m) => (
                    <div key={m.id} className="group relative p-3 rounded-lg bg-[rgba(0,255,65,0.03)] border border-[var(--border-dim)] hover:border-[var(--accent-cyan)]/30 transition">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1 text-sm text-[var(--text-primary)] break-words leading-snug">
                                {m.text || m.note || '(memory)'}
                            </div>
                            <button
                                onClick={() => onForget(m.id)}
                                className="p-2 rounded-md bg-[rgba(0,255,65,0.04)] border border-[var(--border-dim)] text-[var(--text-tertiary)] hover:bg-[rgba(255,59,92,0.12)] hover:border-[var(--accent-red)]/40 hover:text-[var(--accent-red)] transition flex-shrink-0"
                                title="Forget"
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                    </div>
                ))
            )}
        </>
    );
}

/* ── Cameras tab ── */

function CamerasTab() {
    const handsOn = isHandsConnected();
    const [entities, setEntities] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadEntities = async () => {
        if (!isHandsConnected()) return;
        setLoading(true);
        setError(null);
        try {
            const res = await handsCall('ha_list_entities', { domain: 'camera' });
            // Normalize: res may be an array of ids, of objects, or wrapped under .entities.
            const raw: any[] = Array.isArray(res) ? res : (res?.entities || res?.result || []);
            const ids = raw
                .map((e: any) => (typeof e === 'string' ? e : e?.entity_id || e?.id))
                .filter((id: any): id is string => typeof id === 'string' && id.startsWith('camera.'));
            setEntities(ids);
            if (ids.length === 0) setError('No camera entities found in Home Assistant.');
        } catch (e: any) {
            setError(e?.message || 'Could not reach Home Assistant.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (handsOn) loadEntities();
        /* eslint-disable-next-line */
    }, []);

    if (!handsOn) {
        return (
            <div className="text-center text-[var(--text-tertiary)] text-xs py-10 px-6 leading-relaxed">
                <Camera size={28} className="mx-auto mb-3 opacity-40" />
                Live cameras need a Home Assistant connection through Echo Hands.<br />
                Start the Echo Hands daemon and connect Home Assistant
                (<span style={{ color: 'var(--accent-cyan)' }}>⌘K → Connect Echo Hands</span>), then ask Echo to
                "configure home assistant".
            </div>
        );
    }

    return (
        <>
            <div className="mb-3 flex items-center justify-between">
                <div className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest">
                    {entities.length} camera{entities.length === 1 ? '' : 's'}
                </div>
                <button
                    onClick={loadEntities}
                    disabled={loading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[rgba(0,255,65,0.04)] border border-[var(--border-dim)] hover:bg-[rgba(0,255,65,0.08)] text-[11px] tracking-widest uppercase text-[var(--text-secondary)] transition disabled:opacity-40"
                >
                    <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Reload list
                </button>
            </div>

            {error && (
                <div className="text-center text-xs py-6 px-6 leading-relaxed" style={{ color: 'var(--accent-amber)', opacity: 0.85 }}>
                    {error}
                </div>
            )}

            {!error && entities.length === 0 && !loading && (
                <div className="text-center text-[var(--text-tertiary)] text-xs py-10 px-6">
                    <Camera size={28} className="mx-auto mb-3 opacity-40" />
                    No cameras to show.
                </div>
            )}

            {entities.map((id) => <CameraCard key={id} entityId={id} />)}
        </>
    );
}

function CameraCard({ entityId }: { entityId: string; key?: any }) {
    const [src, setSrc] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = async () => {
        setLoading(true);
        setError(null);
        try {
            const snap = await getHaCameraSnapshot(entityId);
            if (snap?.base64) {
                setSrc(`data:${snap.contentType};base64,${snap.base64}`);
            } else {
                setError('No snapshot available.');
            }
        } catch (e: any) {
            setError(e?.message || 'Snapshot failed.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        refresh();
        /* eslint-disable-next-line */
    }, [entityId]);

    const friendly = entityId.replace(/^camera\./, '').replace(/_/g, ' ');

    return (
        <div className="mb-3 rounded-lg bg-[rgba(0,255,65,0.03)] border border-[var(--border-dim)] overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--border-dim)' }}>
                <div className="text-xs text-[var(--text-secondary)] capitalize truncate flex items-center gap-1.5">
                    <Camera size={13} style={{ color: 'var(--accent-cyan)' }} /> {friendly}
                </div>
                <button
                    onClick={refresh}
                    disabled={loading}
                    className="p-1.5 rounded hover:bg-[rgba(0,255,65,0.08)] disabled:opacity-40"
                    title="Refresh snapshot"
                >
                    <RefreshCw size={13} className={loading ? 'animate-spin' : ''} style={{ color: 'var(--accent-cyan)' }} />
                </button>
            </div>
            <div className="relative aspect-video bg-black/60 flex items-center justify-center">
                {src && <img src={src} alt={friendly} className="w-full h-full object-cover" />}
                {!src && loading && (
                    <div className="text-[var(--text-tertiary)] text-[11px] tracking-widest uppercase animate-pulse">Loading…</div>
                )}
                {!src && !loading && error && (
                    <div className="text-[11px] px-4 text-center" style={{ color: 'var(--accent-amber)', opacity: 0.75 }}>{error}</div>
                )}
            </div>
        </div>
    );
}
