/**
 * MissionDashboard.tsx — View and trigger Echo's autonomous scheduled missions.
 *
 * Four tabs:
 *   Missions  — list all missions from ~/.echo-core/missions.json with Run Now button
 *   Running   — live feed of mission_start / mission_step / mission_complete events
 *   History   — last 100 completed mission results
 *   Cloud     — always-on scheduled missions backed by Supabase + Gemini
 *
 * Requires Echo Core to be running (:8770) for the first three tabs.
 * Cloud tab works whenever the user is signed into Echo Cloud.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    isCoreConnected,
    coreListMissions,
    coreTriggerMission,
    coreListMissionResults,
} from '../services/echoCoreSync';
import {
    cloudMissionService,
    cronToLabel,
    PRESET_SCHEDULES,
    type CloudMission,
    type CloudMissionResult,
} from '../services/cloudMissionService';
import { echoCloudAuthService } from '../services/echoCloudAuthService';

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

// All tool tags render as neutral mono chrome — status color communicates
// pass/fail, not the tool identity.
function toolColor(_tool: string) {
    return 'text-[var(--text-secondary)]';
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StepBadge({ step }: { key?: any; step: { tool: string; ok?: boolean; result?: any; durationMs?: number } }) {
    const [open, setOpen] = useState(false);
    const statusTag = step.ok === undefined ? '[RUNNING]' : step.ok ? '[OK]' : '[FAIL]';
    const statusColor = step.ok === undefined ? 'text-[var(--accent-amber)]' : step.ok ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]';
    const dotColor = step.ok === undefined ? 'amber' : step.ok ? 'green' : 'red';
    return (
        <div className="border border-[var(--border-dim)] rounded-lg overflow-hidden">
            <button
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs font-hud hover:bg-[rgba(0,255,65,0.06)] transition-colors"
            >
                <span className="flex items-center gap-2">
                    <span className={`status-dot ${dotColor}`} />
                    <span className={`${statusColor} uppercase tracking-[0.1em]`}>{statusTag}</span>
                    <span className={`${toolColor(step.tool)} uppercase tracking-[0.1em]`}>{step.tool}</span>
                </span>
                <span className="flex items-center gap-2 text-[var(--text-tertiary)]">
                    {step.durationMs !== undefined && <span>{step.durationMs}ms</span>}
                    <span>{open ? '▲' : '▼'}</span>
                </span>
            </button>
            {open && step.result && (
                <pre className="text-[10px] px-3 pb-3 text-[var(--text-tertiary)] overflow-auto max-h-40 bg-black/50 font-hud">
                    {typeof step.result === 'string' ? step.result : JSON.stringify(step.result, null, 2)}
                </pre>
            )}
        </div>
    );
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

function MissionsTab({ onGoToCloud }: { onGoToCloud: () => void }) {
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
        setToast(r.ok ? `[OK] "${m.name}" completed` : `[FAIL] ${r.error || 'failed'}`);
        setTimeout(() => setToast(null), 4000);
    };

    if (!isCoreConnected()) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-center text-[var(--text-tertiary)] px-6">
                <div className="text-3xl mb-3 text-[var(--accent-green)]">⚡</div>
                <p className="text-sm font-hud">This device's local mission runner isn't running right now.</p>
                <p className="text-xs mt-2 max-w-[30ch]">
                    No local setup needed if you'd rather run missions in the cloud instead — they'll run on our servers even when Echo isn't open.
                </p>
                <button
                    onClick={onGoToCloud}
                    className="mt-4 text-xs font-hud uppercase tracking-[0.1em] px-4 py-2 rounded-lg border border-[var(--border-green)] text-[var(--accent-green)] hover:bg-[rgba(0,255,65,0.08)] transition-colors"
                >
                    Use Cloud Missions instead
                </button>
            </div>
        );
    }

    if (loading) return <div className="py-12 text-center text-[var(--text-tertiary)] text-xs font-hud uppercase tracking-[0.2em] cursor-blink">Loading missions</div>;

    if (missions.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-center text-[var(--text-tertiary)] px-6">
                <div className="text-3xl mb-3 text-[var(--accent-green)]">🤖</div>
                <p className="text-sm font-hud">No missions yet.</p>
                <p className="text-xs mt-2 max-w-[30ch]">
                    A mission is a goal you hand Echo, with a schedule — it runs on its own and reports back.
                </p>
                <button
                    onClick={onGoToCloud}
                    className="mt-4 text-xs font-hud uppercase tracking-[0.1em] px-4 py-2 rounded-lg border border-[var(--border-green)] text-[var(--accent-green)] hover:bg-[rgba(0,255,65,0.08)] transition-colors"
                >
                    Create your first mission
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-3 p-4">
            {toast && (
                <div className={`text-xs font-hud uppercase tracking-[0.15em] px-3 py-2 rounded border ${
                    toast.startsWith('[OK]')
                        ? 'bg-[rgba(0,255,65,0.08)] border-[var(--border-green)] text-[var(--accent-green)]'
                        : 'bg-[rgba(255,59,92,0.08)] border-[rgba(255,59,92,0.35)] text-[var(--accent-red)]'
                }`}>{toast}</div>
            )}
            {missions.map(m => (
                <div key={m.id} className={`rounded-lg border p-4 transition-colors ${m.enabled ? 'border-[var(--border-dim)] bg-[rgba(0,255,65,0.03)] hover:border-[var(--border-green)]' : 'border-[var(--border-subtle)] bg-black/20 opacity-50'}`}>
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-hud uppercase tracking-[0.1em] text-[var(--text-primary)] text-sm">{m.name}</span>
                                {!m.enabled && (
                                    <span className="text-[9px] font-hud uppercase tracking-[0.15em] text-[var(--accent-amber)] bg-[rgba(255,179,0,0.08)] border border-[rgba(255,179,0,0.35)] px-2 py-0.5 rounded">[PAUSED]</span>
                                )}
                                <span className="text-xs font-hud text-[var(--text-tertiary)]">{cronLabel(m.cron)}</span>
                            </div>
                            {m.description && <p className="text-xs text-[var(--text-secondary)] mt-1">{m.description}</p>}
                            <div className="flex flex-wrap gap-1 mt-2">
                                {m.steps.map((s, i) => (
                                    <span key={i} className={`text-[10px] font-hud uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-[rgba(0,255,65,0.06)] border border-[var(--border-subtle)] ${toolColor(s.tool)}`}>{s.tool}</span>
                                ))}
                            </div>
                        </div>
                        <button
                            onClick={() => runNow(m)}
                            disabled={triggering === m.id}
                            className="btn-term shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-[11px] disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {triggering === m.id ? (
                                <><span className="animate-spin inline-block w-3 h-3 border-2 border-[var(--accent-green)] border-t-transparent rounded-full"></span> Running</>
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
            <div className="flex flex-col items-center justify-center py-16 text-[var(--text-tertiary)]">
                <div className="text-3xl mb-3 text-[var(--accent-green)]">⚡</div>
                <p className="text-sm font-hud uppercase tracking-[0.15em]">No missions running right now.</p>
                <p className="text-xs mt-1 font-hud">Triggered missions appear here live.</p>
            </div>
        );
    }
    return (
        <div className="space-y-4 p-4">
            {[...live].reverse().map(m => (
                <div key={m.missionId} className="rounded-lg border border-[var(--border-dim)] bg-[rgba(0,255,65,0.03)] p-4">
                    <div className="flex items-center justify-between mb-3">
                        <div>
                            <span className="font-hud uppercase tracking-[0.1em] text-[var(--text-primary)] text-sm">{m.name}</span>
                            <span className="text-[var(--text-tertiary)] text-xs font-hud ml-2">{m.steps.length}/{m.totalSteps} steps</span>
                        </div>
                        {m.done ? (
                            <span className={`text-[10px] font-hud uppercase tracking-[0.15em] px-2 py-0.5 rounded border ${m.succeeded === m.totalSteps ? 'bg-[rgba(0,255,65,0.08)] border-[var(--border-green)] text-[var(--accent-green)]' : 'bg-[rgba(255,179,0,0.08)] border-[rgba(255,179,0,0.35)] text-[var(--accent-amber)]'}`}>
                                {m.succeeded === m.totalSteps ? '[OK] done' : `[WARN] ${m.succeeded}/${m.totalSteps} ok`}
                            </span>
                        ) : (
                            <span className="text-[10px] font-hud uppercase tracking-[0.15em] px-2 py-0.5 rounded border border-[var(--border-green)] bg-[rgba(0,255,65,0.08)] text-[var(--accent-green)] flex items-center gap-1">
                                <span className="animate-spin inline-block w-2.5 h-2.5 border-2 border-[var(--accent-green)] border-t-transparent rounded-full"></span>
                                [RUNNING]
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

    if (!isCoreConnected()) return <div className="py-12 text-center text-[var(--text-tertiary)] text-xs font-hud uppercase tracking-[0.15em]">Echo Core not connected.</div>;
    if (loading) return <div className="py-12 text-center text-[var(--text-tertiary)] text-xs font-hud uppercase tracking-[0.2em] cursor-blink">Loading history</div>;
    if (results.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-[var(--text-tertiary)]">
                <div className="text-3xl mb-3 text-[var(--accent-green)]">📋</div>
                <p className="text-sm font-hud uppercase tracking-[0.15em]">No mission history yet.</p>
            </div>
        );
    }

    return (
        <div className="space-y-2 p-4">
            {results.map(r => (
                <div key={r.id} className="rounded-lg border border-[var(--border-dim)] overflow-hidden">
                    <button
                        onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[rgba(0,255,65,0.05)] transition-colors"
                    >
                        <div className="flex items-center gap-3 min-w-0">
                            <span className={`text-[10px] font-hud uppercase tracking-[0.15em] ${r.succeeded === r.total ? 'text-[var(--accent-green)]' : 'text-[var(--accent-amber)]'}`}>
                                {r.succeeded === r.total ? '[OK]' : '[WARN]'}
                            </span>
                            <span className="text-sm font-hud uppercase tracking-[0.1em] text-[var(--text-primary)] truncate">{r.name}</span>
                            <span className="text-xs font-hud text-[var(--text-tertiary)] shrink-0">{r.succeeded}/{r.total}</span>
                        </div>
                        <span className="text-xs font-hud text-[var(--text-tertiary)] shrink-0 ml-2">{relTime(r.completedAt)}</span>
                    </button>
                    {expanded === r.id && (
                        <div className="px-4 pb-4 space-y-1.5 border-t border-[var(--border-subtle)] pt-3">
                            {r.log.map((l, i) => <StepBadge key={i} step={l} />)}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

// ── Cloud Missions Tab ──────────────────────────────────────────────────────

function CloudMissionsTab() {
    const [signedIn, setSignedIn]     = useState(echoCloudAuthService.isSignedIn());
    const [missions, setMissions]     = useState<CloudMission[]>([]);
    const [loading, setLoading]       = useState(true);
    const [expanded, setExpanded]     = useState<string | null>(null);
    const [results, setResults]       = useState<Record<string, CloudMissionResult[]>>({});
    const [loadingResults, setLoadingResults] = useState<string | null>(null);
    const [deleting, setDeleting]     = useState<string | null>(null);
    const [toasts, setToasts]         = useState<{ id: string; msg: string; ok: boolean }[]>([]);
    const [showForm, setShowForm]     = useState(false);
    const [formTitle, setFormTitle]   = useState('');
    const [formPrompt, setFormPrompt] = useState('');
    const [formCron, setFormCron]     = useState('0 8 * * *');
    const [formCustom, setFormCustom] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const toast = (msg: string, ok: boolean) => {
        const id = Date.now().toString();
        setToasts(t => [...t, { id, msg, ok }]);
        setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
    };

    const load = useCallback(async () => {
        setLoading(true);
        const r = await cloudMissionService.listMissions();
        if (r.ok && r.missions) setMissions(r.missions);
        setLoading(false);
    }, []);

    useEffect(() => {
        const unsub = echoCloudAuthService.onChange(() => {
            setSignedIn(echoCloudAuthService.isSignedIn());
        });
        return unsub;
    }, []);

    useEffect(() => {
        if (signedIn) load();
        else setLoading(false);
    }, [signedIn, load]);

    const loadResults = async (missionId: string) => {
        if (results[missionId]) return; // already cached
        setLoadingResults(missionId);
        const r = await cloudMissionService.getMissionResults(missionId, 5);
        if (r.ok && r.results) setResults(prev => ({ ...prev, [missionId]: r.results! }));
        setLoadingResults(null);
    };

    const toggleExpand = (id: string) => {
        const next = expanded === id ? null : id;
        setExpanded(next);
        if (next) loadResults(next);
    };

    const toggle = async (m: CloudMission) => {
        const r = await cloudMissionService.toggleMission(m.id, !m.is_active);
        if (r.ok) setMissions(ms => ms.map(x => x.id === m.id ? { ...x, is_active: !m.is_active } : x));
        else toast(r.error ?? 'Failed to toggle.', false);
    };

    const remove = async (m: CloudMission) => {
        if (deleting === m.id) {
            const r = await cloudMissionService.deleteMission(m.id);
            if (r.ok) {
                setMissions(ms => ms.filter(x => x.id !== m.id));
                toast(`"${m.title}" deleted.`, true);
            } else {
                toast(r.error ?? 'Failed to delete.', false);
            }
            setDeleting(null);
        } else {
            setDeleting(m.id);
            setTimeout(() => setDeleting(d => d === m.id ? null : d), 3000);
        }
    };

    const submit = async () => {
        if (!formTitle.trim() || !formPrompt.trim()) {
            toast('Title and prompt are required.', false);
            return;
        }
        setSubmitting(true);
        const r = await cloudMissionService.createMission(formTitle, formPrompt, formCron);
        setSubmitting(false);
        if (r.ok && r.mission) {
            setMissions(ms => [r.mission!, ...ms]);
            setShowForm(false);
            setFormTitle('');
            setFormPrompt('');
            setFormCron('0 8 * * *');
            setFormCustom(false);
            toast(`Mission "${r.mission.title}" created.`, true);
        } else {
            toast(r.error ?? 'Failed to create.', false);
        }
    };

    if (!echoCloudAuthService.isConfigured()) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-[var(--text-tertiary)] px-6 text-center">
                <div className="text-3xl mb-3">☁️</div>
                <p className="text-sm font-hud uppercase tracking-[0.15em]">Echo Cloud not configured.</p>
                <p className="text-xs mt-1 font-hud">Add Supabase env vars to enable always-on missions.</p>
            </div>
        );
    }

    if (!signedIn) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-[var(--text-tertiary)] px-6 text-center">
                <div className="text-3xl mb-3 text-[var(--accent-green)]">☁️</div>
                <p className="text-sm font-hud uppercase tracking-[0.15em]">Sign in to Echo Cloud</p>
                <p className="text-xs mt-2 font-hud text-[var(--text-secondary)] max-w-xs">
                    Cloud missions run 24/7 on our servers — even when your browser is closed.<br/>
                    Sign in via Settings → Credentials to enable.
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            {/* Toast stack */}
            <div className="absolute top-16 right-4 z-50 flex flex-col gap-1.5 pointer-events-none">
                {toasts.map(t => (
                    <div key={t.id} className={`text-[11px] font-hud uppercase tracking-[0.12em] px-3 py-2 rounded border backdrop-blur-sm ${
                        t.ok
                            ? 'bg-[rgba(0,255,65,0.12)] border-[var(--border-green)] text-[var(--accent-green)]'
                            : 'bg-[rgba(255,59,92,0.12)] border-[rgba(255,59,92,0.35)] text-[var(--accent-red)]'
                    }`}>{t.msg}</div>
                ))}
            </div>

            {/* Header row */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(0,255,65,0.1)]">
                <span className="text-[11px] font-hud uppercase tracking-[0.2em] text-[var(--text-secondary)]">
                    {missions.length} Mission{missions.length !== 1 ? 's' : ''}
                </span>
                <button
                    onClick={() => setShowForm(f => !f)}
                    className="btn-term px-3 py-1.5 text-[11px] flex items-center gap-1.5"
                >
                    {showForm ? '✕ Cancel' : '+ New Mission'}
                </button>
            </div>

            {/* Create form */}
            {showForm && (
                <div className="border-b border-[rgba(0,255,65,0.1)] p-4 bg-[rgba(0,255,65,0.02)] space-y-3">
                    <div>
                        <label className="text-[10px] font-hud uppercase tracking-[0.2em] text-[var(--text-tertiary)] block mb-1">Mission Title</label>
                        <input
                            value={formTitle}
                            onChange={e => setFormTitle(e.target.value)}
                            placeholder="e.g. Morning briefing"
                            className="w-full bg-black/40 border border-[var(--border-dim)] rounded px-3 py-2 text-sm font-hud text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:border-[var(--accent-green)] focus:outline-none"
                        />
                    </div>
                    <div>
                        <label className="text-[10px] font-hud uppercase tracking-[0.2em] text-[var(--text-tertiary)] block mb-1">What Echo should do</label>
                        <textarea
                            value={formPrompt}
                            onChange={e => setFormPrompt(e.target.value)}
                            rows={3}
                            placeholder="e.g. Give me a brief motivational message and list 3 things I should focus on today based on productivity principles."
                            className="w-full bg-black/40 border border-[var(--border-dim)] rounded px-3 py-2 text-sm font-hud text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:border-[var(--accent-green)] focus:outline-none resize-none"
                        />
                    </div>
                    <div>
                        <label className="text-[10px] font-hud uppercase tracking-[0.2em] text-[var(--text-tertiary)] block mb-1">Schedule</label>
                        {!formCustom ? (
                            <div className="flex flex-wrap gap-1.5">
                                {PRESET_SCHEDULES.map(p => (
                                    <button
                                        key={p.cron}
                                        onClick={() => setFormCron(p.cron)}
                                        className={`text-[10px] font-hud uppercase tracking-[0.1em] px-2.5 py-1.5 rounded border transition-colors ${
                                            formCron === p.cron
                                                ? 'bg-[rgba(0,255,65,0.12)] border-[var(--accent-green)] text-[var(--accent-green)]'
                                                : 'border-[var(--border-dim)] text-[var(--text-secondary)] hover:border-[var(--border-green)]'
                                        }`}
                                    >
                                        {p.label}
                                    </button>
                                ))}
                                <button
                                    onClick={() => setFormCustom(true)}
                                    className="text-[10px] font-hud uppercase tracking-[0.1em] px-2.5 py-1.5 rounded border border-[var(--border-dim)] text-[var(--text-tertiary)] hover:border-[var(--border-green)]"
                                >
                                    Custom cron…
                                </button>
                            </div>
                        ) : (
                            <div className="flex gap-2">
                                <input
                                    value={formCron}
                                    onChange={e => setFormCron(e.target.value)}
                                    placeholder="0 8 * * *"
                                    className="flex-1 bg-black/40 border border-[var(--border-dim)] rounded px-3 py-2 text-sm font-mono text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:border-[var(--accent-green)] focus:outline-none"
                                />
                                <button
                                    onClick={() => setFormCustom(false)}
                                    className="text-[10px] font-hud px-2 text-[var(--text-tertiary)] hover:text-[var(--accent-green)]"
                                >Presets</button>
                            </div>
                        )}
                        <p className="text-[9px] font-hud text-[var(--text-tertiary)] mt-1">
                            Selected: {cronToLabel(formCron)} <span className="opacity-50">[{formCron}]</span>
                        </p>
                    </div>
                    <button
                        onClick={submit}
                        disabled={submitting}
                        className="btn-term w-full py-2 text-[12px] flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        {submitting ? (
                            <><span className="animate-spin inline-block w-3 h-3 border-2 border-[var(--accent-green)] border-t-transparent rounded-full" /> Creating…</>
                        ) : '[ Create Mission ]'}
                    </button>
                </div>
            )}

            {/* Mission list */}
            <div className="flex-1 overflow-y-auto">
                {loading ? (
                    <div className="py-12 text-center text-[var(--text-tertiary)] text-xs font-hud uppercase tracking-[0.2em] cursor-blink">Loading missions</div>
                ) : missions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-[var(--text-tertiary)] text-center px-6">
                        <div className="text-3xl mb-3 text-[var(--accent-green)]">🤖</div>
                        <p className="text-sm font-hud uppercase tracking-[0.15em]">No cloud missions yet.</p>
                        <p className="text-xs mt-1 font-hud">Click "+ New Mission" to create your first always-on agent.</p>
                    </div>
                ) : (
                    <div className="space-y-2 p-4">
                        {missions.map(m => (
                            <div key={m.id} className={`rounded-lg border overflow-hidden transition-colors ${
                                m.is_active
                                    ? 'border-[var(--border-dim)] bg-[rgba(0,255,65,0.02)] hover:border-[rgba(0,255,65,0.25)]'
                                    : 'border-[var(--border-subtle)] bg-black/10 opacity-60'
                            }`}>
                                {/* Mission header */}
                                <button
                                    onClick={() => toggleExpand(m.id)}
                                    className="w-full flex items-center justify-between px-4 py-3 text-left"
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className={`status-dot ${m.is_active ? 'green' : 'amber'}`} />
                                            <span className="font-hud uppercase tracking-[0.1em] text-[var(--text-primary)] text-sm">{m.title}</span>
                                            {!m.is_active && (
                                                <span className="text-[9px] font-hud uppercase tracking-[0.15em] text-[var(--accent-amber)] bg-[rgba(255,179,0,0.08)] border border-[rgba(255,179,0,0.35)] px-1.5 py-0.5 rounded">[PAUSED]</span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-3 mt-0.5">
                                            <span className="text-[10px] font-hud text-[var(--text-tertiary)]">{cronToLabel(m.cron_expr)}</span>
                                            {m.last_run_at && (
                                                <span className="text-[10px] font-hud text-[var(--text-tertiary)]">
                                                    last: {new Date(m.last_run_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <span className="text-[var(--text-tertiary)] text-sm ml-2">{expanded === m.id ? '▲' : '▼'}</span>
                                </button>

                                {/* Expanded: controls + results */}
                                {expanded === m.id && (
                                    <div className="border-t border-[var(--border-subtle)] px-4 py-3 space-y-3">
                                        {/* Prompt preview */}
                                        <div className="bg-black/30 rounded p-2">
                                            <p className="text-[10px] font-hud uppercase tracking-[0.15em] text-[var(--text-tertiary)] mb-1">Prompt</p>
                                            <p className="text-xs text-[var(--text-secondary)] line-clamp-3">{m.prompt}</p>
                                        </div>

                                        {/* Controls */}
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <button
                                                onClick={() => toggle(m)}
                                                className={`text-[10px] font-hud uppercase tracking-[0.1em] px-2.5 py-1.5 rounded border transition-colors ${
                                                    m.is_active
                                                        ? 'border-[rgba(255,179,0,0.4)] text-[var(--accent-amber)] hover:bg-[rgba(255,179,0,0.08)]'
                                                        : 'border-[var(--border-green)] text-[var(--accent-green)] hover:bg-[rgba(0,255,65,0.08)]'
                                                }`}
                                            >
                                                {m.is_active ? '⏸ Pause' : '▶ Resume'}
                                            </button>
                                            <button
                                                onClick={() => remove(m)}
                                                className={`text-[10px] font-hud uppercase tracking-[0.1em] px-2.5 py-1.5 rounded border transition-colors ${
                                                    deleting === m.id
                                                        ? 'border-[var(--accent-red)] text-[var(--accent-red)] bg-[rgba(255,59,92,0.1)]'
                                                        : 'border-[var(--border-dim)] text-[var(--text-tertiary)] hover:border-[rgba(255,59,92,0.4)] hover:text-[var(--accent-red)]'
                                                }`}
                                            >
                                                {deleting === m.id ? '⚠ Confirm delete' : '🗑 Delete'}
                                            </button>
                                        </div>

                                        {/* Recent results */}
                                        <div>
                                            <p className="text-[10px] font-hud uppercase tracking-[0.15em] text-[var(--text-tertiary)] mb-2">Recent Outputs</p>
                                            {loadingResults === m.id ? (
                                                <div className="text-[10px] font-hud text-[var(--text-tertiary)] cursor-blink">Loading…</div>
                                            ) : !results[m.id] || results[m.id].length === 0 ? (
                                                <div className="text-[10px] font-hud text-[var(--text-tertiary)]">No runs yet — next run: {new Date(m.next_run_at).toLocaleString()}</div>
                                            ) : (
                                                <div className="space-y-2">
                                                    {results[m.id].map(r => (
                                                        <div key={r.id} className={`rounded border px-3 py-2 text-xs ${
                                                            r.status === 'error'
                                                                ? 'border-[rgba(255,59,92,0.25)] bg-[rgba(255,59,92,0.04)] text-[var(--accent-red)]'
                                                                : 'border-[var(--border-subtle)] bg-black/20 text-[var(--text-secondary)]'
                                                        }`}>
                                                            <div className="flex items-center justify-between mb-1">
                                                                <span className={`text-[9px] font-hud uppercase tracking-[0.15em] ${
                                                                    r.status === 'error' ? 'text-[var(--accent-red)]' : 'text-[var(--accent-green)]'
                                                                }`}>{r.status === 'error' ? '[ERROR]' : '[DONE]'}</span>
                                                                <span className="text-[9px] font-hud text-[var(--text-tertiary)]">
                                                                    {new Date(r.created_at).toLocaleString()}
                                                                </span>
                                                            </div>
                                                            <p className="text-[11px] leading-relaxed">
                                                                {r.status === 'error' ? r.error_msg : r.content}
                                                            </p>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MissionDashboard({ onClose }: { onClose?: () => void } = {}) {
    const [tab, setTab] = useState<'missions' | 'running' | 'history' | 'cloud'>('missions');
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
        { id: 'missions', label: 'MISSIONS' },
        { id: 'running', label: `RUNNING${live.filter(m => !m.done).length ? ` (${live.filter(m => !m.done).length})` : ''}` },
        { id: 'history', label: 'HISTORY' },
        { id: 'cloud',    label: '☁ CLOUD' },
    ] as const;

    return (
        <div className="term-window animate-phosphor-in flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="term-titlebar justify-between">
                <div className="flex items-center gap-2.5">
                    <span className="term-dots" />
                    <span>MISSIONS.CTRL</span>
                    <span className="text-[9px] tracking-[0.2em] text-[var(--text-tertiary)] normal-case">
                        powered by Echo Core
                    </span>
                </div>
                {onClose && (
                    <button onClick={onClose} className="p-1 text-[var(--text-tertiary)] hover:text-[var(--accent-green)] transition-colors">✕</button>
                )}
            </div>

            {/* Tab bar */}
            <div className="flex border-b border-[rgba(0,255,65,0.14)] px-2 pt-1">
                {tabs.map(t => (
                    <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        className={[
                            'px-4 py-2.5 text-[11px] font-hud uppercase tracking-[0.2em] transition-colors',
                            tab === t.id
                                ? 'text-[var(--accent-green)] text-glow-green border-b-2 border-[var(--accent-green)] -mb-px'
                                : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
                        ].join(' ')}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto relative">
                {tab === 'missions' && <MissionsTab onGoToCloud={() => setTab('cloud')} />}
                {tab === 'running' && <RunningTab live={live} />}
                {tab === 'history' && <HistoryTab />}
                {tab === 'cloud'   && <CloudMissionsTab />}
            </div>
        </div>
    );
}
