/**
 * AutomationHub.tsx — visual "when X, do Y" builder on top of Echo Core missions.
 *
 * A Zapier-style automation builder: pick a schedule (cron) and chain steps,
 * each step being one of Echo's server-side tools. Chain results forward with
 * the {{prev}} token. Saved automations run autonomously in Echo Core even when
 * the browser is closed.
 *
 * Replaces Zapier / Make.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
    isCoreConnected,
    coreListMissions,
    coreSaveMission,
    coreDeleteMission,
    coreToggleMission,
    coreTriggerMission,
} from '../services/echoCoreSync';

interface FieldSpec { key: string; placeholder: string; type?: 'text' | 'textarea' | 'number' | 'csv'; }
interface ToolSpec { label: string; icon: string; fields: FieldSpec[]; }

const TOOL_SPECS: Record<string, ToolSpec> = {
    search_web: { label: 'Search the web', icon: '🔍', fields: [
        { key: 'query', placeholder: 'Search query' },
        { key: 'num_results', placeholder: 'Max results (default 5)', type: 'number' },
    ] },
    ask_echo: { label: 'Ask Echo (AI)', icon: '🧠', fields: [
        { key: 'prompt', placeholder: 'Prompt for the AI. Use {{prev}} to feed in the previous step.', type: 'textarea' },
    ] },
    run_terminal_command: { label: 'Run terminal command', icon: '⚡', fields: [
        { key: 'command', placeholder: 'e.g. git -C ~/project log --oneline -5' },
    ] },
    read_file: { label: 'Read file', icon: '📖', fields: [{ key: 'path', placeholder: '~/Desktop/notes.txt' }] },
    write_file: { label: 'Write file', icon: '📝', fields: [
        { key: 'path', placeholder: '~/Desktop/output.md' },
        { key: 'content', placeholder: 'Content. Use {{prev}} for the previous step output.', type: 'textarea' },
    ] },
    send_discord_message: { label: 'Send Discord message', icon: '🎮', fields: [
        { key: 'title', placeholder: 'Embed title (optional)' },
        { key: 'message', placeholder: 'Message. Use {{prev}} for previous output.', type: 'textarea' },
    ] },
    send_email: { label: 'Send email', icon: '📧', fields: [
        { key: 'to', placeholder: 'recipient@email.com' },
        { key: 'subject', placeholder: 'Subject' },
        { key: 'body', placeholder: 'Body. Use {{prev}} for previous output.', type: 'textarea' },
    ] },
    post_tweet: { label: 'Post a tweet', icon: '𝕏', fields: [{ key: 'text', placeholder: 'Tweet text. {{prev}} supported.', type: 'textarea' }] },
    post_to_social: { label: 'Post to social', icon: '📣', fields: [
        { key: 'platforms', placeholder: 'Platforms, comma-separated (e.g. twitter,bluesky) or "all"', type: 'csv' },
        { key: 'text', placeholder: 'Post text. {{prev}} supported.', type: 'textarea' },
    ] },
    http_request: { label: 'HTTP request', icon: '🌐', fields: [
        { key: 'url', placeholder: 'https://api.example.com/...' },
        { key: 'method', placeholder: 'GET / POST (default GET)' },
    ] },
};

const CRON_PRESETS = [
    { label: 'Manual only', value: '' },
    { label: 'Daily 8am', value: '0 8 * * *' },
    { label: 'Daily 6pm', value: '0 18 * * *' },
    { label: 'Weekdays 9am', value: '0 9 * * 1-5' },
    { label: 'Mondays 9am', value: '0 9 * * 1' },
    { label: 'Every 30 min', value: '*/30 * * * *' },
    { label: 'Every 6 hours', value: '0 */6 * * *' },
];

interface Mission { id: string; name: string; description?: string; cron: string; enabled: boolean; steps: any[]; }
interface DraftStep { tool: string; args: Record<string, string>; }

function cronLabel(expr: string) {
    if (!expr) return 'Manual';
    const found = CRON_PRESETS.find(c => c.value === expr);
    return found ? found.label : expr;
}

export default function AutomationHub({ onClose }: { onClose?: () => void } = {}) {
    const [missions, setMissions] = useState<Mission[]>([]);
    const [building, setBuilding] = useState(false);
    const [name, setName] = useState('');
    const [cron, setCron] = useState('0 9 * * *');
    const [steps, setSteps] = useState<DraftStep[]>([{ tool: 'search_web', args: {} }]);
    const [busy, setBusy] = useState(false);
    const [toast, setToast] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!isCoreConnected()) return;
        const r = await coreListMissions();
        if (r.ok && r.missions) setMissions(r.missions as Mission[]);
    }, []);

    useEffect(() => {
        load();
        const h = () => load();
        window.addEventListener('echocore:status', h);
        return () => window.removeEventListener('echocore:status', h);
    }, [load]);

    const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 4000); };

    const addStep = () => setSteps(s => [...s, { tool: 'ask_echo', args: {} }]);
    const removeStep = (i: number) => setSteps(s => s.filter((_, idx) => idx !== i));
    const setStepTool = (i: number, tool: string) => setSteps(s => s.map((st, idx) => idx === i ? { tool, args: {} } : st));
    const setStepArg = (i: number, key: string, val: string) =>
        setSteps(s => s.map((st, idx) => idx === i ? { ...st, args: { ...st.args, [key]: val } } : st));

    const resetBuilder = () => { setName(''); setCron('0 9 * * *'); setSteps([{ tool: 'search_web', args: {} }]); setBuilding(false); };

    const saveAutomation = async () => {
        if (!name.trim()) { flash('✗ Give it a name'); return; }
        setBusy(true);
        const builtSteps = steps.map(st => {
            const spec = TOOL_SPECS[st.tool];
            const args: Record<string, any> = {};
            for (const f of spec.fields) {
                const raw = st.args[f.key];
                if (raw == null || raw === '') continue;
                if (f.type === 'number') args[f.key] = Number(raw);
                else if (f.type === 'csv') args[f.key] = raw.split(',').map(x => x.trim()).filter(Boolean);
                else args[f.key] = raw;
            }
            return { tool: st.tool, description: spec.label, args };
        });
        const r = await coreSaveMission({ name, description: `${builtSteps.length} steps`, cron, enabled: true, steps: builtSteps });
        setBusy(false);
        if (r.ok) { flash(`[OK] Automation "${name}" saved`); resetBuilder(); load(); }
        else flash(`[FAIL] ${r.error || 'Save failed'}`);
    };

    const onToggle = async (m: Mission) => { await coreToggleMission(m.id, !m.enabled); load(); };
    const onDelete = async (m: Mission) => { await coreDeleteMission(m.id); load(); };
    const onRun = async (m: Mission) => { flash(`> Running "${m.name}"…`); const r = await coreTriggerMission(m.id); flash(r.ok ? `[OK] "${m.name}" ran` : `[FAIL] ${r.error}`); };

    if (!isCoreConnected()) {
        return (
            <div className="term-window flex flex-col items-center justify-center h-full">
                <div className="text-3xl mb-3 text-[var(--accent-green)] text-glow-green font-hud">⚡</div>
                <p className="text-sm font-hud uppercase tracking-[0.2em] text-[var(--text-secondary)]">Echo Core not connected.</p>
                <p className="text-xs mt-2 text-[var(--text-tertiary)] font-hud">
                    Automations run in Core. Start it with{' '}
                    <code className="text-[var(--accent-green)]">node echo-core/echo.mjs</code> and pair via ⌘K.
                </p>
            </div>
        );
    }

    return (
        <div className="term-window animate-phosphor-in flex flex-col h-full overflow-hidden">
            <div className="term-titlebar justify-between">
                <div className="flex items-center gap-2.5">
                    <span className="term-dots" />
                    <span>AUTOMATION.HUB</span>
                    <span className="text-[9px] tracking-[0.2em] text-[var(--text-tertiary)] normal-case">
                        {missions.length} SAVED // ZAPIER, BUT YOURS
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => building ? resetBuilder() : setBuilding(true)}
                        className="btn-term solid px-3 py-1.5 text-[11px]"
                    >
                        {building ? 'Cancel' : 'New automation'}
                    </button>
                    {onClose && (
                        <button onClick={onClose} className="p-1 text-[var(--text-tertiary)] hover:text-[var(--accent-green)] transition-colors">✕</button>
                    )}
                </div>
            </div>

            {toast && (
                <div className={`mx-4 mt-3 text-xs font-hud uppercase tracking-[0.15em] px-3 py-2 rounded border ${
                    toast.startsWith('[OK]') || toast.startsWith('>')
                        ? 'bg-[rgba(0,255,65,0.08)] border-[var(--border-green)] text-[var(--accent-green)]'
                        : 'bg-[rgba(255,59,92,0.08)] border-[rgba(255,59,92,0.35)] text-[var(--accent-red)]'
                }`}>{toast}</div>
            )}

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {/* Builder */}
                {building && (
                    <div className="rounded-lg border border-[var(--border-green)] bg-[rgba(0,255,65,0.04)] p-4 space-y-3">
                        <input
                            value={name} onChange={e => setName(e.target.value)}
                            placeholder="Automation name (e.g. Morning AI digest)"
                            className="w-full px-3 py-2 text-sm font-hud rounded bg-black/60 border border-[var(--border-dim)] text-[var(--accent-green)] placeholder-[rgba(0,255,65,0.25)] outline-none focus:border-[var(--border-green)]"
                        />

                        {/* Trigger */}
                        <div>
                            <div className="text-[10px] font-hud uppercase tracking-[0.25em] text-[var(--text-tertiary)] mb-1.5">// Trigger (when)</div>
                            <div className="flex flex-wrap gap-1.5">
                                {CRON_PRESETS.map(c => (
                                    <button
                                        key={c.label}
                                        onClick={() => setCron(c.value)}
                                        className={`text-[10px] font-hud uppercase tracking-[0.1em] px-2 py-1 rounded border transition-colors ${
                                            cron === c.value
                                                ? 'border-[var(--border-green)] bg-[rgba(0,255,65,0.12)] text-[var(--accent-green)]'
                                                : 'border-[var(--border-dim)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                                        }`}
                                    >{c.label}</button>
                                ))}
                            </div>
                            <input
                                value={cron} onChange={e => setCron(e.target.value)}
                                placeholder="cron (blank = manual)"
                                className="mt-2 w-full px-3 py-1.5 text-xs font-hud rounded bg-black/60 border border-[var(--border-dim)] text-[var(--text-secondary)] outline-none focus:border-[var(--border-green)]"
                            />
                        </div>

                        {/* Steps */}
                        <div>
                            <div className="text-[10px] font-hud uppercase tracking-[0.25em] text-[var(--text-tertiary)] mb-1.5">// Steps (do)</div>
                            <div className="space-y-2">
                                {steps.map((st, i) => {
                                    const spec = TOOL_SPECS[st.tool];
                                    return (
                                        <div key={i} className="rounded-lg border border-[var(--border-dim)] bg-black/40 p-3 space-y-2">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-hud text-[var(--text-tertiary)]">{i + 1}.</span>
                                                <select
                                                    value={st.tool}
                                                    onChange={e => setStepTool(i, e.target.value)}
                                                    className="flex-1 px-2 py-1.5 text-xs font-hud rounded bg-black/60 border border-[var(--border-dim)] text-[var(--text-primary)] outline-none focus:border-[var(--border-green)]"
                                                >
                                                    {Object.entries(TOOL_SPECS).map(([id, s]) => <option key={id} value={id}>{s.icon} {s.label}</option>)}
                                                </select>
                                                {steps.length > 1 && (
                                                    <button onClick={() => removeStep(i)} className="text-[var(--text-tertiary)] hover:text-[var(--accent-red)] text-xs px-1">✕</button>
                                                )}
                                            </div>
                                            {spec.fields.map(f => (
                                                f.type === 'textarea'
                                                    ? <textarea
                                                        key={f.key}
                                                        value={st.args[f.key] || ''}
                                                        onChange={e => setStepArg(i, f.key, e.target.value)}
                                                        placeholder={f.placeholder}
                                                        rows={2}
                                                        className="w-full px-2 py-1.5 text-xs rounded bg-black/50 border border-[var(--border-dim)] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none resize-none focus:border-[var(--border-green)]"
                                                    />
                                                    : <input
                                                        key={f.key}
                                                        value={st.args[f.key] || ''}
                                                        onChange={e => setStepArg(i, f.key, e.target.value)}
                                                        placeholder={f.placeholder}
                                                        className="w-full px-2 py-1.5 text-xs rounded bg-black/50 border border-[var(--border-dim)] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none focus:border-[var(--border-green)]"
                                                    />
                                            ))}
                                        </div>
                                    );
                                })}
                            </div>
                            <button onClick={addStep} className="mt-2 text-xs font-hud uppercase tracking-[0.15em] text-[var(--accent-green)] hover:text-glow-green">+ Add step</button>
                        </div>

                        <button onClick={saveAutomation} disabled={busy} className="btn-term solid w-full py-2 text-xs disabled:opacity-40">
                            {busy ? '…' : 'Save automation'}
                        </button>
                    </div>
                )}

                {/* Existing automations */}
                {missions.length === 0 && !building && (
                    <div className="flex flex-col items-center justify-center py-16 text-[var(--text-tertiary)]">
                        <div className="text-3xl mb-3 text-[var(--accent-green)]">🤖</div>
                        <p className="text-sm font-hud uppercase tracking-[0.15em]">No automations yet.</p>
                        <p className="text-xs mt-1 font-hud">Click "New automation" to build your first one.</p>
                    </div>
                )}
                {missions.map(m => (
                    <div key={m.id} className={`rounded-lg border p-3 transition-colors ${m.enabled ? 'border-[var(--border-dim)] bg-[rgba(0,255,65,0.03)] hover:border-[var(--border-green)]' : 'border-[var(--border-subtle)] bg-black/20 opacity-50'}`}>
                        <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-hud uppercase tracking-[0.1em] text-[var(--text-primary)] truncate">{m.name}</span>
                                    <span className="text-[10px] font-hud text-[var(--text-tertiary)] shrink-0">{cronLabel(m.cron)}</span>
                                    {!m.enabled && (
                                        <span className="text-[9px] font-hud uppercase tracking-[0.15em] px-1.5 py-0.5 rounded border border-[rgba(255,179,0,0.35)] bg-[rgba(255,179,0,0.08)] text-[var(--accent-amber)]">[PAUSED]</span>
                                    )}
                                </div>
                                <div className="flex flex-wrap gap-1 mt-1.5">
                                    {(m.steps || []).map((s: any, i: number) => (
                                        <span key={i} className="text-[10px] font-hud px-1.5 py-0.5 rounded bg-[rgba(0,255,65,0.06)] border border-[var(--border-subtle)] text-[var(--text-tertiary)]">{TOOL_SPECS[s.tool]?.icon || '•'} {s.tool}</span>
                                    ))}
                                </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                                <button onClick={() => onRun(m)} title="Run now" className="p-1.5 text-xs rounded hover:bg-[rgba(0,255,65,0.08)] text-[var(--accent-green)]">▶</button>
                                <button onClick={() => onToggle(m)} title={m.enabled ? 'Disable' : 'Enable'} className={`p-1.5 text-xs rounded hover:bg-[rgba(0,255,65,0.08)] ${m.enabled ? 'text-[var(--accent-green)]' : 'text-[var(--text-tertiary)]'}`}>
                                    <span className={`status-dot ${m.enabled ? 'green' : 'amber'}`} />
                                </button>
                                <button onClick={() => onDelete(m)} title="Delete" className="p-1.5 text-xs rounded hover:bg-[rgba(255,59,92,0.1)] text-[var(--text-tertiary)] hover:text-[var(--accent-red)]">🗑</button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
