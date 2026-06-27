/**
 * MissionDashboard.tsx — View and trigger Echo's autonomous scheduled missions.
 *
 * Three tabs:
 *   Missions  — list all missions from ~/.echo-core/missions.json with Run Now button
 *   Running   — live feed of mission_start / mission_step / mission_complete events
 *   History   — last 100 completed mission results
 *
 * Requires Echo Core to be running (:8770). Falls back gracefully if offline.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    isCoreConnected,
    coreListMissions,
    coreTriggerMission,
    coreListMissionResults,
} from '../services/echoCoreSync';

// ── Types ────────────────────────────────────────────────────────────────────

interface Mission {
    id: string;
    name: string;
    description?: string;
    cron: string;
    enabled: boolean;
    steps: { tool: string; description?: string; args?: any }[];
}

interface StepLog {
    step: number;
    tool: string;
    description?: string;
    ok: boolean;
    result: any;
    durationMs: number;
}

interface MissionResult {
    id: string;
    missionId: string;
    name: string;
    completedAt: number;
    succeeded: number;
    total: number;
    log: StepLog[];
}

interface LiveMission {
    missionId: string;
    name: string;
    totalSteps: number;
    startedAt: number;
    steps: { step: number; tool: string; ok?: boolean; result?: any; durationMs?: number }[];
    done?: boolean;
    succeeded?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function cronLabel(expr: string) {
    if (!expr) return 'manual';
    const p = expr.split(/\s+/);
    if (p.length !== 5) return expr;
    const [min, hr, , , dow] = p;
    if (dow === '1' && min === '0') return `Every Monday at ${hr}:00`;
    if (dow === '*' && min === '0') return `Daily at ${hr}:00`;
    if (hr === '*') return `Every ${min.startsWith('*/') ? min.slice(2) : min}m`;
    return expr;
}

function relTime(ms: number) {
    const s = Math.floor((Date.now() - ms) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
}

function toolColor(tool: string) {
    const map: Record<string, string> = {
        search_web: 'text-blue-400',
        ask_echo: 'text-purple-400',
        run_terminal_command: 'text-yellow-400',
        send_discord_message: 'text-indigo-400',
        send_email: 'text-pink-400',
        post_tweet: 'text-sky-400',
        read_file: 'text-green-400',
        write_file: 'text-emerald-400',
        http_request: 'text-orange-400',
    };
    return map[tool] || 'text-gray-400';
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StepBadge({ step }: { step: { tool: string; ok?: boolean; result?: any; durationMs?: number } }) {
    const [open, setOpen] = useState(false);
    const statusIcon = step.ok === undefined ? '⏳' : step.ok ? '✓' : '✗';
    const statusColor = step.ok === undefined ? 'text-gray-400' : step.ok ? 'text-green-400' : 'text-red-400';
    return (
        <div className="border border-white/10 rounded-lg overflow-hidden">
            <button
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-white/5 transition-colors"
            >
                <span className="flex items-center gap-2">
                    <span className={statusColor}>{statusIcon}</span>
                    <span className={toolColor(step.tool)}>{step.tool}</span>
                </span>
                <span className="flex items-center gap-2 text-gray-500 text-xs">
                    {step.durationMs !== undefined && <span>{step.durationMs}ms</span>}
                    <span>{open ? '▲' : '▼'}</span>
                </span>
            </button>
            {open && step.result && (
                <pre className="text-xs px-3 pb-3 text-gray-400 overflow-auto max-h-40 bg-black/30">
                    {typeof step.result === 'string' ? step.result : JSON.stringify(step.result, null, 2)}
                </pre>
            )}
        </div>
    );
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

function MissionsTab() {
    const [missions, setMissions] = useState<Mission[]>([]);
    const [loading, setLoading] = useState(true);
    const [triggering, setTriggering] = useState<string | null>(null);
    const [toast, setToast] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        const r = await coreListMissions();
        if (r.ok && r.missions) setMissions(r.missions as Mission[]);
        setLoading(false);
    }, []);

    useEffect(() => {
        if (isCoreConnected()) load();
        const h = () => load();
        window.addEventListener('echocore:status', h);
        return () => window.removeEventListener('echocore:status', h);
    }, [load]);

    const runNow = async (m: Mission) => {
        setTriggering(m.id);
        setToast(null);
        const r = await coreTriggerMission(m.id);
        setTriggering(null);
        setToast(r.ok ? `✓ "${m.name}" completed` : `✗ ${r.error || 'failed'}`);
        setTimeout(() => setToast(null), 4000);
    };

    if (!isCoreConnected()) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                <div className="text-4xl mb-3">🔌</div>
                <p className="text-sm">Echo Core not connected.</p>
                <p className="text-xs mt-1">Start it with <code className="text-green-400">node echo-core/echo.mjs</code> and pair via ⌘K.</p>
            </div>
        );
    }

    if (loading) return <div className="py-12 text-center text-gray-500 text-sm">Loading missions…</div>;

    if (missions.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                <div className="text-4xl mb-3">🤖</div>
                <p className="text-sm">No missions yet.</p>
                <p className="text-xs mt-1">Edit <code className="text-green-400">~/.echo-core/missions.json</code> to add one.</p>
            </div>
        );
    }

    return (
        <div className="space-y-3 p-4">
            {toast && (
                <div className={`text-xs px-3 py-2 rounded-lg ${toast.startsWith('✓') ? 'bg-green-900/40 text-green-300' : 'bg-red-900/40 text-red-300'}`}>
                    {toast}
                </div>
            )}
            {missions.map(m => (
                <div key={m.id} className={`rounded-xl border p-4 transition-all ${m.enabled ? 'border-white/10 bg-white/3' : 'border-white/5 bg-white/1 opacity-60'}`}>
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-white text-sm">{m.name}</span>
                                {!m.enabled && <span className="text-xs text-yellow-500 bg-yellow-900/30 px-2 py-0.5 rounded-full">disabled</span>}
                                <span className="text-xs text-gray-500">{cronLabel(m.cron)}</span>
                            </div>
                            {m.description && <p className="text-xs text-gray-400 mt-1">{m.description}</p>}
                            <div className="flex flex-wrap gap-1 mt-2">
                                {m.steps.map((s, i) => (
                                    <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded bg-white/5 ${toolColor(s.tool)}`}>{s.tool}</span>
                                ))}
                            </div>
                        </div>
                        <button
                            onClick={() => runNow(m)}
                            disabled={triggering === m.id}
                            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-green-600/20 text-green-400 border border-green-600/30 hover:bg-green-600/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {triggering === m.id ? (
                                <><span className="animate-spin inline-block w-3 h-3 border-2 border-green-400 border-t-transparent rounded-full"></span> Running</>
                            ) : (
                                <>▶ Run now</>
                            )}
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}

function RunningTab({ live }: { live: LiveMission[] }) {
    if (live.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                <div className="text-4xl mb-3">⚡</div>
                <p className="text-sm">No missions running right now.</p>
                <p className="text-xs mt-1">Triggered missions appear here live.</p>
            </div>
        );
    }
    return (
        <div className="space-y-4 p-4">
            {[...live].reverse().map(m => (
                <div key={m.missionId} className="rounded-xl border border-white/10 bg-white/3 p-4">
                    <div className="flex items-center justify-between mb-3">
                        <div>
                            <span className="font-medium text-white text-sm">{m.name}</span>
                            <span className="text-gray-500 text-xs ml-2">{m.steps.length}/{m.totalSteps} steps</span>
                        </div>
                        {m.done ? (
                            <span className={`text-xs px-2 py-0.5 rounded-full ${m.succeeded === m.totalSteps ? 'bg-green-900/40 text-green-300' : 'bg-yellow-900/40 text-yellow-300'}`}>
                                {m.succeeded === m.totalSteps ? '✓ done' : `⚠ ${m.succeeded}/${m.totalSteps} ok`}
                            </span>
                        ) : (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-900/40 text-blue-300 flex items-center gap-1">
                                <span className="animate-spin inline-block w-2.5 h-2.5 border-2 border-blue-300 border-t-transparent rounded-full"></span>
                                running
                            </span>
                        )}
                    </div>
                    <div className="space-y-1.5">
                        {m.steps.map((s, i) => <StepBadge key={i} step={s} />)}
                    </div>
                </div>
            ))}
        </div>
    );
}

function HistoryTab() {
    const [results, setResults] = useState<MissionResult[]>([]);
    const [loading, setLoading] = useState(true);
    const [expanded, setExpanded] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        const r = await coreListMissionResults();
        if (r.ok && r.results) setResults(r.results as MissionResult[]);
        setLoading(false);
    }, []);

    useEffect(() => {
        if (isCoreConnected()) load();
        const h = (e: Event) => { if ((e as CustomEvent).detail?.missionId) load(); };
        window.addEventListener('echocore:mission_complete', h);
        return () => window.removeEventListener('echocore:mission_complete', h);
    }, [load]);

    if (!isCoreConnected()) return <div className="py-12 text-center text-gray-500 text-sm">Echo Core not connected.</div>;
    if (loading) return <div className="py-12 text-center text-gray-500 text-sm">Loading history…</div>;
    if (results.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                <div className="text-4xl mb-3">📋</div>
                <p className="text-sm">No mission history yet.</p>
            </div>
        );
    }

    return (
        <div className="space-y-2 p-4">
            {results.map(r => (
                <div key={r.id} className="rounded-xl border border-white/8 overflow-hidden">
                    <button
                        onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/3 transition-colors"
                    >
                        <div className="flex items-center gap-3 min-w-0">
                            <span className={r.succeeded === r.total ? 'text-green-400' : 'text-yellow-400'}>
                                {r.succeeded === r.total ? '✓' : '⚠'}
                            </span>
                            <span className="text-sm text-white font-medium truncate">{r.name}</span>
                            <span className="text-xs text-gray-500 shrink-0">{r.succeeded}/{r.total}</span>
                        </div>
                        <span className="text-xs text-gray-500 shrink-0 ml-2">{relTime(r.completedAt)}</span>
                    </button>
                    {expanded === r.id && (
                        <div className="px-4 pb-4 space-y-1.5 border-t border-white/8 pt-3">
                            {r.log.map((l, i) => <StepBadge key={i} step={l} />)}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MissionDashboard({ onClose }: { onClose?: () => void } = {}) {
    const [tab, setTab] = useState<'missions' | 'running' | 'history'>('missions');
    const [live, setLive] = useState<LiveMission[]>([]);
    const liveRef = useRef<LiveMission[]>([]);

    useEffect(() => {
        const onStart = (e: Event) => {
            const d = (e as CustomEvent).detail;
            const m: LiveMission = { missionId: d.missionId, name: d.name, totalSteps: d.totalSteps, startedAt: d.startedAt, steps: [] };
            liveRef.current = [...liveRef.current.filter(x => x.missionId !== d.missionId), m].slice(-10);
            setLive([...liveRef.current]);
        };
        const onStep = (e: Event) => {
            const d = (e as CustomEvent).detail;
            liveRef.current = liveRef.current.map(m => {
                if (m.missionId !== d.missionId) return m;
                const existingIdx = m.steps.findIndex(s => s.step === d.step);
                const updated = { step: d.step, tool: d.tool, ok: d.ok, result: d.result, durationMs: d.durationMs };
                const newSteps = existingIdx >= 0
                    ? m.steps.map((s, i) => i === existingIdx ? updated : s)
                    : [...m.steps, updated];
                return { ...m, steps: newSteps };
            });
            setLive([...liveRef.current]);
        };
        const onComplete = (e: Event) => {
            const d = (e as CustomEvent).detail;
            liveRef.current = liveRef.current.map(m =>
                m.missionId === d.missionId ? { ...m, done: true, succeeded: d.succeeded } : m
            );
            setLive([...liveRef.current]);
            // Switch to history tab after a short delay so user can see completion
            setTimeout(() => setTab('history'), 2000);
        };
        window.addEventListener('echocore:mission_start', onStart);
        window.addEventListener('echocore:mission_step', onStep);
        window.addEventListener('echocore:mission_complete', onComplete);
        return () => {
            window.removeEventListener('echocore:mission_start', onStart);
            window.removeEventListener('echocore:mission_step', onStep);
            window.removeEventListener('echocore:mission_complete', onComplete);
        };
    }, []);

    const tabs = [
        { id: 'missions', label: '🤖 Missions' },
        { id: 'running', label: `⚡ Running${live.filter(m => !m.done).length ? ` (${live.filter(m => !m.done).length})` : ''}` },
        { id: 'history', label: '📋 History' },
    ] as const;

    return (
        <div className="flex flex-col h-full bg-black/20 rounded-2xl border border-white/10 overflow-hidden">
            {/* Header */}
            <div className="px-4 pt-4 pb-0">
                <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
                    <h2 className="text-white font-semibold text-sm">Autonomous Missions</h2>
                    <span className="text-xs text-gray-500 ml-auto">powered by Echo Core</span>
                    {onClose && <button onClick={onClose} className="text-gray-500 hover:text-white text-sm ml-1">✕</button>}
                </div>
                {/* Tab bar */}
                <div className="flex gap-1 border-b border-white/10">
                    {tabs.map(t => (
                        <button
                            key={t.id}
                            onClick={() => setTab(t.id)}
                            className={`px-3 py-2 text-xs font-medium rounded-t-lg transition-colors ${tab === t.id ? 'bg-white/8 text-white border-b-2 border-green-400' : 'text-gray-400 hover:text-gray-200'}`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
                {tab === 'missions' && <MissionsTab />}
                {tab === 'running' && <RunningTab live={live} />}
                {tab === 'history' && <HistoryTab />}
            </div>
        </div>
    );
}
