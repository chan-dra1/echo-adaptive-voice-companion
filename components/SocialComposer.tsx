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
        if (r.ok && r.succeeded) { flash(`✓ Posted to ${r.succeeded} platform(s)`); setText(''); }
    };

    const doSchedule = async () => {
        if (!text.trim() || selected.size === 0 || !cron.trim()) return;
        if (!isCoreConnected()) { flash('✗ Echo Core required to schedule'); return; }
        setPosting(true);
        const r = await coreSaveMission({
            name: scheduleName || `Social post → ${[...selected].join(', ')}`,
            description: `Auto-post to ${[...selected].join(', ')}`,
            cron, enabled: true,
            steps: [{ tool: 'post_to_social', description: 'Scheduled social post', args: { platforms: [...selected], text } }],
        });
        setPosting(false);
        if (r.ok) { flash(`✓ Scheduled (${cron})`); setText(''); setScheduleMode(false); }
        else flash(`✗ ${r.error || 'Failed to schedule'}`);
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
        flash(`✓ ${platform} connected`);
    };

    const minLimit = selected.size
        ? Math.min(...[...selected].map(id => PLATFORMS.find(p => p.id === id)?.limit || 9999))
        : 9999;
    const over = text.length > minLimit;

    return (
        <div className="flex flex-col h-full bg-black/20 rounded-2xl border border-white/10 overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
                <span className="text-lg">📣</span>
                <h2 className="text-white font-semibold text-sm">Social Autopilot</h2>
                <span className="text-xs text-gray-500 ml-auto">{connected.size}/{PLATFORMS.length} connected</span>
                {onClose && <button onClick={onClose} className="text-gray-500 hover:text-white text-sm ml-1">✕</button>}
            </div>

            {toast && (
                <div className={`mx-4 mt-3 text-xs px-3 py-2 rounded-lg ${toast.startsWith('✓') ? 'bg-green-900/40 text-green-300' : 'bg-red-900/40 text-red-300'}`}>{toast}</div>
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
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                                    isSelected
                                        ? 'border-transparent text-white shadow-lg'
                                        : isConnected
                                            ? 'border-white/15 text-gray-300 hover:border-white/30'
                                            : 'border-dashed border-white/15 text-gray-500 hover:text-gray-300'
                                }`}
                                style={isSelected ? { background: p.color } : undefined}
                            >
                                <span>{p.icon}</span>
                                <span>{p.name}</span>
                                {!isConnected && <span className="text-[10px] opacity-70">+ connect</span>}
                                {isConnected && !isSelected && <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span>}
                            </button>
                        );
                    })}
                </div>

                {/* Connect panel */}
                {connectPanel && (() => {
                    const p = PLATFORMS.find(x => x.id === connectPanel)!;
                    return (
                        <div className="rounded-xl border border-white/15 bg-white/5 p-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-white font-medium">{p.icon} Connect {p.name}</span>
                                <button onClick={() => { setConnectPanel(null); setCredDraft({}); }} className="text-gray-500 hover:text-white text-xs">✕</button>
                            </div>
                            {p.fields.map(f => (
                                <input
                                    key={f.key}
                                    type={f.key.includes('password') || f.key.includes('token') ? 'password' : 'text'}
                                    placeholder={`${f.label} — ${f.placeholder}`}
                                    value={credDraft[f.key] || ''}
                                    onChange={e => setCredDraft(d => ({ ...d, [f.key]: e.target.value }))}
                                    className="w-full px-3 py-2 text-sm rounded-lg bg-black/30 border border-white/10 text-white placeholder-gray-600 focus:border-white/30 outline-none"
                                />
                            ))}
                            <button onClick={saveConnection} className="w-full py-2 text-sm font-medium rounded-lg bg-green-600/30 text-green-300 border border-green-600/40 hover:bg-green-600/40">Save connection</button>
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
                        className="w-full px-4 py-3 text-sm rounded-xl bg-black/30 border border-white/10 text-white placeholder-gray-600 focus:border-white/30 outline-none resize-none"
                    />
                    {selected.size > 0 && (
                        <span className={`absolute bottom-3 right-3 text-xs ${over ? 'text-red-400' : 'text-gray-500'}`}>
                            {text.length}/{minLimit}
                        </span>
                    )}
                </div>

                {/* Schedule controls */}
                {scheduleMode && (
                    <div className="rounded-xl border border-white/10 bg-white/3 p-3 space-y-2">
                        <input
                            value={scheduleName}
                            onChange={e => setScheduleName(e.target.value)}
                            placeholder="Schedule name (optional)"
                            className="w-full px-3 py-2 text-sm rounded-lg bg-black/30 border border-white/10 text-white placeholder-gray-600 outline-none"
                        />
                        <div className="flex flex-wrap gap-1.5">
                            {CRON_PRESETS.map(c => (
                                <button key={c.value} onClick={() => setCron(c.value)} className={`text-[11px] px-2 py-1 rounded-md border ${cron === c.value ? 'border-green-500/50 bg-green-900/30 text-green-300' : 'border-white/10 text-gray-400 hover:text-white'}`}>{c.label}</button>
                            ))}
                        </div>
                        <input value={cron} onChange={e => setCron(e.target.value)} className="w-full px-3 py-1.5 text-xs font-mono rounded-lg bg-black/30 border border-white/10 text-gray-300 outline-none" />
                    </div>
                )}

                {/* Results */}
                {result?.results && (
                    <div className="space-y-1.5">
                        {result.results.map((r, i) => (
                            <div key={i} className={`flex items-center justify-between text-xs px-3 py-2 rounded-lg ${r.ok ? 'bg-green-900/20 text-green-300' : 'bg-red-900/20 text-red-300'}`}>
                                <span>{r.ok ? '✓' : '✗'} {r.platform}</span>
                                {r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="underline opacity-80 hover:opacity-100">view</a> : <span className="opacity-70">{r.error}</span>}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Action bar */}
            <div className="px-4 py-3 border-t border-white/10 flex items-center gap-2">
                <button
                    onClick={() => setScheduleMode(s => !s)}
                    className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${scheduleMode ? 'border-purple-500/50 bg-purple-900/30 text-purple-300' : 'border-white/10 text-gray-400 hover:text-white'}`}
                >
                    🕐 Schedule
                </button>
                <button
                    onClick={scheduleMode ? doSchedule : doPost}
                    disabled={posting || over || !text.trim() || selected.size === 0}
                    className="flex-1 py-2 text-sm font-semibold rounded-lg bg-gradient-to-r from-green-500 to-emerald-600 text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {posting ? '…' : scheduleMode ? `Schedule to ${selected.size} platform${selected.size === 1 ? '' : 's'}` : `Post now to ${selected.size} platform${selected.size === 1 ? '' : 's'}`}
                </button>
            </div>

            {!isCoreConnected() && (
                <div className="px-4 py-2 text-[11px] text-yellow-400/80 bg-yellow-900/10 border-t border-yellow-900/20">
                    ⚡ Echo Core offline — only Bluesky, Mastodon & Discord can post. Start Core for all platforms + scheduling.
                </div>
            )}
        </div>
    );
}
