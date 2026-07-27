/**
 * SocialComposer.tsx — Social Autopilot UI.
 *
 * Compose once, post everywhere. Pick connected platforms, write a post, and
 * publish now or schedule it as an autonomous Echo Core mission. Includes an
 * account-connection panel that mirrors credentials to Core for posting while
 * the browser is closed.
 *
 * Replaces Buffer / Hootsuite / Postiz.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
    isCoreConnected,
    coreSocialPost,
    coreSaveSocialCreds,
    coreListSocialAccounts,
    coreSaveMission,
    SocialPostResult,
} from '../services/echoCoreSync';

const CREDS_KEY = 'echo_social_creds';

interface PlatformDef {
    id: string;
    name: string;
    icon: string;
    color: string;
    limit: number;
    fields: { key: string; label: string; placeholder: string }[];
}

// Platform brand colors are kept as literal identity marks (data, not chrome) —
// used only as the fill on a *selected* platform chip.
const PLATFORMS: PlatformDef[] = [
    { id: 'bluesky', name: 'Bluesky', icon: '🦋', color: '#0085ff', limit: 300, fields: [
        { key: 'handle', label: 'Handle', placeholder: 'you.bsky.social' },
        { key: 'app_password', label: 'App Password', placeholder: 'xxxx-xxxx-xxxx-xxxx' },
    ] },
    { id: 'mastodon', name: 'Mastodon', icon: '🐘', color: '#6364ff', limit: 500, fields: [
        { key: 'instance', label: 'Instance URL', placeholder: 'https://mastodon.social' },
        { key: 'token', label: 'Access Token', placeholder: 'token…' },
    ] },
    { id: 'twitter', name: 'Twitter / X', icon: '𝕏', color: '#1d9bf0', limit: 280, fields: [
        { key: 'access_token', label: 'OAuth2 Access Token', placeholder: 'user access token…' },
    ] },
    { id: 'linkedin', name: 'LinkedIn', icon: '💼', color: '#0a66c2', limit: 3000, fields: [
        { key: 'access_token', label: 'Access Token', placeholder: 'token…' },
        { key: 'urn', label: 'Author URN', placeholder: 'urn:li:person:XXXX' },
    ] },
    { id: 'threads', name: 'Threads', icon: '🧵', color: '#999', limit: 500, fields: [
        { key: 'user_id', label: 'User ID', placeholder: '178414…' },
        { key: 'access_token', label: 'Access Token', placeholder: 'token…' },
    ] },
    { id: 'facebook', name: 'Facebook', icon: '👍', color: '#1877f2', limit: 5000, fields: [
        { key: 'page_id', label: 'Page ID', placeholder: '102…' },
        { key: 'access_token', label: 'Page Access Token', placeholder: 'token…' },
    ] },
    { id: 'discord', name: 'Discord', icon: '🎮', color: '#5865f2', limit: 2000, fields: [
        { key: 'webhook', label: 'Webhook URL', placeholder: 'https://discord.com/api/webhooks/…' },
    ] },
];

function getCreds(): Record<string, any> {
    try { return JSON.parse(localStorage.getItem(CREDS_KEY) || '{}'); } catch { return {}; }
}
function saveCreds(all: Record<string, any>) { localStorage.setItem(CREDS_KEY, JSON.stringify(all)); }

const CRON_PRESETS = [
    { label: 'Daily 9am', value: '0 9 * * *' },
    { label: 'Daily 6pm', value: '0 18 * * *' },
    { label: 'Weekdays 8am', value: '0 8 * * 1-5' },
    { label: 'Mondays noon', value: '0 12 * * 1' },
    { label: 'Every 6 hours', value: '0 */6 * * *' },
];

export default function SocialComposer({ onClose }: { onClose?: () => void } = {}) {
    const [text, setText] = useState('');
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [connected, setConnected] = useState<Set<string>>(new Set());
    const [posting, setPosting] = useState(false);
    const [result, setResult] = useState<SocialPostResult | null>(null);
    const [connectPanel, setConnectPanel] = useState<string | null>(null);
    const [credDraft, setCredDraft] = useState<Record<string, string>>({});
    const [scheduleMode, setScheduleMode] = useState(false);
    const [cron, setCron] = useState('0 9 * * *');
    const [scheduleName, setScheduleName] = useState('');
    const [toast, setToast] = useState<string | null>(null);

    const refreshConnected = useCallback(async () => {
        const local = new Set(Object.keys(getCreds()).filter(p => Object.keys(getCreds()[p] || {}).length));
        if (isCoreConnected()) {
            const r = await coreListSocialAccounts();
            if (r.ok && r.connected) r.connected.forEach(p => local.add(p));
        }
        setConnected(local);
    }, []);

    useEffect(() => {
        refreshConnected();
        const h = () => refreshConnected();
        window.addEventListener('echocore:status', h);
        return () => window.removeEventListener('echocore:status', h);
    }, [refreshConnected]);

    const toggle = (id: string) => {
        if (!connected.has(id)) { setConnectPanel(id); return; }
        setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    };

    const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 4000); };

    const doPost = async () => {
        if (!text.trim() || selected.size === 0) return;
        setPosting(true); setResult(null);
        const r = await coreSocialPost([...selected], { text }, getCreds());
        setPosting(false);
        setResult(r);
        if (r.ok && r.succeeded) { flash(`[OK] Posted to ${r.succeeded} platform(s)`); setText(''); }
    };

    const doSchedule = async () => {
        if (!text.trim() || selected.size === 0 || !cron.trim()) return;
        if (!isCoreConnected()) { flash('[FAIL] Echo Core required to schedule'); return; }
        setPosting(true);
        const r = await coreSaveMission({
            name: scheduleName || `Social post → ${[...selected].join(', ')}`,
            description: `Auto-post to ${[...selected].join(', ')}`,
            cron, enabled: true,
            steps: [{ tool: 'post_to_social', description: 'Scheduled social post', args: { platforms: [...selected], text } }],
        });
        setPosting(false);
        if (r.ok) { flash(`[OK] Scheduled (${cron})`); setText(''); setScheduleMode(false); }
        else flash(`[FAIL] ${r.error || 'Failed to schedule'}`);
    };

    const saveConnection = async () => {
        if (!connectPanel) return;
        const platform = connectPanel;
        const fields = Object.fromEntries(Object.entries(credDraft).filter(([, v]) => v?.trim()));
        const all = getCreds();
        all[platform] = { ...(all[platform] || {}), ...fields };
        saveCreds(all);
        if (isCoreConnected()) await coreSaveSocialCreds({ [platform]: fields });
        setConnectPanel(null); setCredDraft({});
        await refreshConnected();
        flash(`[OK] ${platform} connected`);
    };

    const minLimit = selected.size
        ? Math.min(...[...selected].map(id => PLATFORMS.find(p => p.id === id)?.limit || 9999))
        : 9999;
    const over = text.length > minLimit;

    return (
        <div className="term-window animate-phosphor-in flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="term-titlebar justify-between">
                <div className="flex items-center gap-2.5">
                    <span className="term-dots" />
                    <span>SOCIAL.NET</span>
                    <span className="text-[9px] tracking-[0.2em] text-[var(--text-tertiary)] normal-case">
                        {connected.size}/{PLATFORMS.length} CONNECTED
                    </span>
                </div>
                {onClose && (
                    <button onClick={onClose} className="p-1 text-[var(--text-tertiary)] hover:text-[var(--accent-green)] transition-colors">✕</button>
                )}
            </div>

            {toast && (
                <div className={`mx-4 mt-3 text-xs font-hud uppercase tracking-[0.15em] px-3 py-2 rounded border ${
                    toast.startsWith('[OK]')
                        ? 'bg-[rgba(0,255,65,0.08)] border-[var(--border-green)] text-[var(--accent-green)]'
                        : 'bg-[rgba(255,59,92,0.08)] border-[rgba(255,59,92,0.35)] text-[var(--accent-red)]'
                }`}>{toast}</div>
            )}

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Platform chips */}
                <div className="flex flex-wrap gap-2">
                    {PLATFORMS.map(p => {
                        const isConnected = connected.has(p.id);
                        const isSelected = selected.has(p.id);
                        return (
                            <button
                                key={p.id}
                                onClick={() => toggle(p.id)}
                                title={isConnected ? `Toggle ${p.name}` : `Connect ${p.name}`}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-hud uppercase tracking-[0.1em] border transition-all ${
                                    isSelected
                                        ? 'border-transparent text-black shadow-[0_0_10px_rgba(0,255,65,0.15)]'
                                        : isConnected
                                            ? 'border-[var(--border-dim)] text-[var(--text-secondary)] hover:border-[var(--border-green)]'
                                            : 'border-dashed border-[var(--border-dim)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                                }`}
                                style={isSelected ? { background: p.color } : undefined}
                            >
                                <span>{p.icon}</span>
                                <span>{p.name}</span>
                                {!isConnected && <span className="text-[9px] opacity-70">+ connect</span>}
                                {isConnected && !isSelected && <span className="status-dot green" />}
                            </button>
                        );
                    })}
                </div>

                {/* Connect panel */}
                {connectPanel && (() => {
                    const p = PLATFORMS.find(x => x.id === connectPanel)!;
                    return (
                        <div className="rounded-lg border border-[var(--border-green)] bg-[rgba(0,255,65,0.04)] p-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-hud uppercase tracking-[0.1em] text-[var(--text-primary)]">{p.icon} Connect {p.name}</span>
                                <button onClick={() => { setConnectPanel(null); setCredDraft({}); }} className="text-[var(--text-tertiary)] hover:text-[var(--accent-green)] text-xs">✕</button>
                            </div>
                            {p.fields.map(f => (
                                <input
                                    key={f.key}
                                    type={f.key.includes('password') || f.key.includes('token') ? 'password' : 'text'}
                                    placeholder={`${f.label} — ${f.placeholder}`}
                                    value={credDraft[f.key] || ''}
                                    onChange={e => setCredDraft(d => ({ ...d, [f.key]: e.target.value }))}
                                    className="w-full px-3 py-2 text-sm font-hud rounded bg-black/60 border border-[var(--border-dim)] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:border-[var(--border-green)] outline-none"
                                />
                            ))}
                            <button onClick={saveConnection} className="btn-term solid w-full py-2 text-xs">Save connection</button>
                        </div>
                    );
                })()}

                {/* Composer */}
                <div className="relative">
                    <textarea
                        value={text}
                        onChange={e => setText(e.target.value)}
                        placeholder="What do you want to post everywhere?"
                        rows={5}
                        className="w-full px-4 py-3 text-sm rounded-lg bg-black/50 border border-[var(--border-dim)] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:border-[var(--border-green)] outline-none resize-none"
                    />
                    {selected.size > 0 && (
                        <span className={`absolute bottom-3 right-3 text-xs font-hud ${over ? 'text-[var(--accent-red)]' : 'text-[var(--text-tertiary)]'}`}>
                            {text.length}/{minLimit}
                        </span>
                    )}
                </div>

                {/* Schedule controls */}
                {scheduleMode && (
                    <div className="rounded-lg border border-[var(--border-dim)] bg-[rgba(0,255,65,0.03)] p-3 space-y-2">
                        <input
                            value={scheduleName}
                            onChange={e => setScheduleName(e.target.value)}
                            placeholder="Schedule name (optional)"
                            className="w-full px-3 py-2 text-sm font-hud rounded bg-black/60 border border-[var(--border-dim)] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none focus:border-[var(--border-green)]"
                        />
                        <div className="flex flex-wrap gap-1.5">
                            {CRON_PRESETS.map(c => (
                                <button
                                    key={c.value}
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
                            className="w-full px-3 py-1.5 text-xs font-hud rounded bg-black/60 border border-[var(--border-dim)] text-[var(--text-secondary)] outline-none focus:border-[var(--border-green)]"
                        />
                    </div>
                )}

                {/* Results */}
                {result?.results && (
                    <div className="space-y-1.5">
                        {result.results.map((r, i) => (
                            <div key={i} className={`flex items-center justify-between text-xs font-hud px-3 py-2 rounded border ${r.ok ? 'bg-[rgba(0,255,65,0.06)] border-[var(--border-green)] text-[var(--accent-green)]' : 'bg-[rgba(255,59,92,0.06)] border-[rgba(255,59,92,0.3)] text-[var(--accent-red)]'}`}>
                                <span>{r.ok ? '[OK]' : '[FAIL]'} {r.platform}</span>
                                {r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="underline opacity-80 hover:opacity-100">view</a> : <span className="opacity-70">{r.error}</span>}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Action bar */}
            <div className="px-4 py-3 border-t border-[rgba(0,255,65,0.14)] flex items-center gap-2">
                <button
                    onClick={() => setScheduleMode(s => !s)}
                    className={`px-3 py-2 text-[11px] font-hud uppercase tracking-[0.15em] rounded border transition-colors ${scheduleMode ? 'border-[var(--border-green)] bg-[rgba(0,255,65,0.1)] text-[var(--accent-green)]' : 'border-[var(--border-dim)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'}`}
                >
                    ⏱ Schedule
                </button>
                <button
                    onClick={scheduleMode ? doSchedule : doPost}
                    disabled={posting || over || !text.trim() || selected.size === 0}
                    className="btn-term solid flex-1 py-2 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {posting ? '…' : scheduleMode ? `Schedule to ${selected.size} platform${selected.size === 1 ? '' : 's'}` : `Post now to ${selected.size} platform${selected.size === 1 ? '' : 's'}`}
                </button>
            </div>

            {!isCoreConnected() && (
                <div className="px-4 py-2 text-[10px] font-hud uppercase tracking-[0.1em] text-[var(--accent-amber)] bg-[rgba(255,179,0,0.06)] border-t border-[rgba(255,179,0,0.2)]">
                    ⚡ Echo Core offline — only Bluesky, Mastodon &amp; Discord can post. Start Core for all platforms + scheduling.
                </div>
            )}
        </div>
    );
}
