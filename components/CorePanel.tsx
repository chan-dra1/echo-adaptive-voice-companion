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
                className="relative w-full max-w-md h-full bg-black border-l border-[#00E5FF]/25 shadow-2xl flex flex-col font-mono text-white animate-[slideIn_0.25s_ease]"
                onClick={e => e.stopPropagation()}
                style={{ boxShadow: '0 0 60px rgba(0,229,255,0.12)' }}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                    <div className="flex items-center gap-2">
                        <Cpu size={18} style={{ color: 'var(--c-cyan)' }} />
                        <div>
                            <div className="text-sm tracking-[0.3em] uppercase">Mission Control</div>
                            <div className="text-[10px] text-white/40 uppercase tracking-widest">
                                {coreOn ? 'Echo Core · live' : 'Echo Core offline'}
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        <button onClick={refresh} className="p-1.5 rounded hover:bg-white/10" title="Refresh">
                            <RefreshCw size={15} style={{ color: 'var(--c-cyan)' }} />
                        </button>
                        <button onClick={onClose} className="p-1.5 rounded hover:bg-white/10"><X size={16} /></button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-white/10">
                    {TABS.map(t => (
                        <button key={t.id} onClick={() => setTab(t.id)}
                            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] tracking-widest uppercase transition border-b-2 ${tab === t.id ? 'border-[#00E5FF] text-[#00E5FF] bg-[#00E5FF]/5' : 'border-transparent text-white/45 hover:text-white/70'}`}>
                            {t.icon}{t.label}{typeof t.n === 'number' && <span className="opacity-50">({t.n})</span>}
                        </button>
                    ))}
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
                    {!coreOn && tab !== 'cameras' && (
                        <div className="text-center text-white/40 text-xs py-10 px-6 leading-relaxed">
                            <Cpu size={28} className="mx-auto mb-3 opacity-40" />
                            Echo Core isn't connected. Start the terminal brain and pair it via
                            <span className="text-[#00E5FF]"> ⌘K → Connect Echo Core</span> to manage reminders and memory here.
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
            <div className="mb-3 p-3 rounded-lg bg-white/[0.03] border border-white/8 space-y-2">
                <input
                    value={reminderText}
                    onChange={e => setReminderText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') onAdd(); }}
                    placeholder="Remind me to…"
                    className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white/90 placeholder-white/30 focus:outline-none focus:border-[#00E5FF]/50"
                />
                <div className="flex items-center gap-2">
                    <input
                        value={reminderTime}
                        onChange={e => setReminderTime(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') onAdd(); }}
                        placeholder="HH:MM (daily)"
                        className="flex-1 bg-black/40 border border-white/10 rounded-md px-3 py-2 text-xs text-white/90 placeholder-white/30 focus:outline-none focus:border-[#00E5FF]/50"
                    />
                    <button
                        onClick={onAdd}
                        disabled={!reminderText.trim()}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-[#00E5FF]/12 border border-[#00E5FF]/40 text-[#00E5FF] hover:bg-[#00E5FF]/20 disabled:opacity-30 transition text-[11px] tracking-widest uppercase"
                    >
                        <Plus size={13} /> Add reminder
                    </button>
                </div>
            </div>

            {schedules.length === 0 ? (
                <div className="text-center text-white/35 text-xs py-12 px-6 leading-relaxed">
                    <Bell size={28} className="mx-auto mb-3 opacity-40" />
                    No reminders or briefings yet.
                </div>
            ) : (
                schedules.map((s) => (
                    <div key={s.id} className="group relative p-3 rounded-lg bg-white/[0.03] border border-white/8 hover:border-[#00E5FF]/30 transition">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                                <div className="text-sm text-white/90 break-words">{scheduleLabel(s)}</div>
                                <div className="text-[10px] text-[#00E5FF]/70 uppercase tracking-widest mt-1 flex items-center gap-1">
                                    <Clock size={11} /> {describeWhen(s.when)}
                                </div>
                            </div>
                            <button
                                onClick={() => onCancel(s.id)}
                                className="p-2 rounded-md bg-white/5 border border-white/10 text-white/50 hover:bg-red-500/15 hover:border-red-400/40 hover:text-red-300 transition flex-shrink-0"
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
            <div className="mb-3 p-3 rounded-lg bg-white/[0.03] border border-white/8 flex items-center gap-2">
                <input
                    value={memoryText}
                    onChange={e => setMemoryText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') onAdd(); }}
                    placeholder="Something Echo should remember…"
                    className="flex-1 bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white/90 placeholder-white/30 focus:outline-none focus:border-[#00E5FF]/50"
                />
                <button
                    onClick={onAdd}
                    disabled={!memoryText.trim()}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-[#00E5FF]/12 border border-[#00E5FF]/40 text-[#00E5FF] hover:bg-[#00E5FF]/20 disabled:opacity-30 transition text-[11px] tracking-widest uppercase"
                >
                    <Plus size={13} /> Remember
                </button>
            </div>

            {memories.length === 0 ? (
                <div className="text-center text-white/35 text-xs py-12 px-6 leading-relaxed">
                    <Brain size={28} className="mx-auto mb-3 opacity-40" />
                    Nothing memorized yet. Add a fact and Echo will keep it.
                </div>
            ) : (
                memories.map((m) => (
                    <div key={m.id} className="group relative p-3 rounded-lg bg-white/[0.03] border border-white/8 hover:border-[#00E5FF]/30 transition">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1 text-sm text-white/90 break-words leading-snug">
                                {m.text || m.note || '(memory)'}
                            </div>
                            <button
                                onClick={() => onForget(m.id)}
                                className="p-2 rounded-md bg-white/5 border border-white/10 text-white/50 hover:bg-red-500/15 hover:border-red-400/40 hover:text-red-300 transition flex-shrink-0"
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
            <div className="text-center text-white/40 text-xs py-10 px-6 leading-relaxed">
                <Camera size={28} className="mx-auto mb-3 opacity-40" />
                Live cameras need a Home Assistant connection through Echo Hands.<br />
                Start the Echo Hands daemon and connect Home Assistant
                (<span className="text-[#00E5FF]">⌘K → Connect Echo Hands</span>), then ask Echo to
                "configure home assistant".
            </div>
        );
    }

    return (
        <>
            <div className="mb-3 flex items-center justify-between">
                <div className="text-[10px] text-white/40 uppercase tracking-widest">
                    {entities.length} camera{entities.length === 1 ? '' : 's'}
                </div>
                <button
                    onClick={loadEntities}
                    disabled={loading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/5 border border-white/10 hover:bg-white/10 text-[11px] tracking-widest uppercase text-white/70 transition disabled:opacity-40"
                >
                    <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Reload list
                </button>
            </div>

            {error && (
                <div className="text-center text-amber-300/80 text-xs py-6 px-6 leading-relaxed">
                    {error}
                </div>
            )}

            {!error && entities.length === 0 && !loading && (
                <div className="text-center text-white/35 text-xs py-10 px-6">
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
        <div className="mb-3 rounded-lg bg-white/[0.03] border border-white/8 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/8">
                <div className="text-xs text-white/80 capitalize truncate flex items-center gap-1.5">
                    <Camera size={13} style={{ color: 'var(--c-cyan)' }} /> {friendly}
                </div>
                <button
                    onClick={refresh}
                    disabled={loading}
                    className="p-1.5 rounded hover:bg-white/10 disabled:opacity-40"
                    title="Refresh snapshot"
                >
                    <RefreshCw size={13} className={loading ? 'animate-spin' : ''} style={{ color: 'var(--c-cyan)' }} />
                </button>
            </div>
            <div className="relative aspect-video bg-black/60 flex items-center justify-center">
                {src && <img src={src} alt={friendly} className="w-full h-full object-cover" />}
                {!src && loading && (
                    <div className="text-white/40 text-[11px] tracking-widest uppercase animate-pulse">Loading…</div>
                )}
                {!src && !loading && error && (
                    <div className="text-amber-300/70 text-[11px] px-4 text-center">{error}</div>
                )}
            </div>
        </div>
    );
}
