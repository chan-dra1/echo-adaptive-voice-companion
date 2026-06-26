/**
 * SkillsVaultPanel.tsx
 *
 * Full-featured skills management panel with three tabs:
 *   - Installed: lists all static and dynamic skills with stats
 *   - Community: browse/install skills from a configured registry URL
 *   - Share: export skill JSON, import from JSON/URL
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    X, Trash2, Download, Copy, Check, RefreshCw, AlertTriangle, Upload,
} from 'lucide-react';
import { DynamicSkill, dynamicSkillService } from '../services/dynamicSkillService';
import { agentSkillService, ToolDefinition } from '../services/agentSkillService';
import { skillRegistryService, CommunitySkill } from '../services/skillRegistryService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = 'installed' | 'community' | 'share';

interface DegradedBanner {
    id: string;
    name: string;
}

interface SkillsVaultPanelProps {
    onClose?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function successRate(ds: DynamicSkill): string {
    const usage = ds.usageCount ?? 0;
    if (usage === 0) return 'No usage yet';
    const ok = ds.successCount ?? 0;
    const pct = Math.round((ok / usage) * 100);
    return `${ok}/${usage} ok (${pct}%)`;
}

function fmtDate(epoch: number): string {
    return new Date(epoch).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
    });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
    const tabs: { key: Tab; label: string }[] = [
        { key: 'installed', label: 'Installed' },
        { key: 'community', label: 'Community' },
        { key: 'share', label: 'Share' },
    ];
    return (
        <div className="flex border-b border-[#00ff41]/15">
            {tabs.map(t => (
                <button
                    key={t.key}
                    onClick={() => onChange(t.key)}
                    className={[
                        'px-5 py-3 text-xs font-mono uppercase tracking-widest transition-colors',
                        active === t.key
                            ? 'text-[#00ff41] border-b-2 border-[#00ff41] -mb-px'
                            : 'text-[#00ff41]/50 hover:text-[#00ff41]/80',
                    ].join(' ')}
                >
                    {t.label}
                </button>
            ))}
        </div>
    );
}

interface SkillCardProps {
    key?: React.Key;
    name: string;
    description: string;
    tags?: string[];
    badge?: React.ReactNode;
    stats?: string;
    version?: number;
    onDelete?: () => void;
}

function SkillCard({
    name,
    description,
    tags,
    badge,
    stats,
    version,
    onDelete,
}: SkillCardProps) {
    return (
        <div className="bg-[#00ff41]/5 border border-[#00ff41]/15 rounded-xl p-3 hover:border-[#00ff41]/30 transition-colors">
            <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[#00ff41] text-sm font-semibold truncate">{name}</span>
                        {version !== undefined && (
                            <span className="text-[9px] px-1.5 py-0.5 bg-[#00ff41]/10 border border-[#00ff41]/20 rounded text-[#00ff41]/70">
                                v{version}
                            </span>
                        )}
                        {badge}
                    </div>
                    <p className="text-[#00ff41]/60 text-xs mt-1 line-clamp-2">{description}</p>
                    {tags && tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                            {tags.map(tag => (
                                <span
                                    key={tag}
                                    className="text-[9px] px-1.5 py-0.5 bg-[#00ff41]/10 border border-[#00ff41]/20 rounded text-[#00ff41]/60"
                                >
                                    {tag}
                                </span>
                            ))}
                        </div>
                    )}
                    {stats && (
                        <div className="text-[10px] text-[#00ff41]/40 mt-1 font-mono">{stats}</div>
                    )}
                </div>
                {onDelete && (
                    <button
                        onClick={onDelete}
                        title="Delete skill"
                        className="flex-shrink-0 p-1.5 text-red-400 hover:text-red-300 transition-colors"
                    >
                        <Trash2 size={14} />
                    </button>
                )}
            </div>
        </div>
    );
}

function EmptyState({ message }: { message: string }) {
    return (
        <div className="flex flex-col items-center justify-center py-12 text-[#00ff41]/30 font-mono text-xs text-center">
            <div className="text-2xl mb-2">∅</div>
            <div>{message}</div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Installed Tab
// ---------------------------------------------------------------------------

function InstalledTab({
    dynamicSkills,
    onDelete,
    degraded,
}: {
    dynamicSkills: DynamicSkill[];
    onDelete: (id: string) => void;
    degraded: DegradedBanner | null;
}) {
    // Collect static skill tool names (those not from dynamic skills)
    const dynToolNames = new Set(dynamicSkills.map(ds => ds.schema?.name).filter(Boolean));
    const staticTools: ToolDefinition[] = agentSkillService
        .getTools()
        .filter(t => t && t.name && !dynToolNames.has(t.name));

    return (
        <div className="space-y-3">
            {degraded && (
                <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-300 font-mono">
                    <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                    <span>
                        Skill <strong>{degraded.name}</strong> is failing often. Say &ldquo;Echo, improve the{' '}
                        {degraded.name} skill&rdquo; to fix it.
                    </span>
                </div>
            )}

            {dynamicSkills.length === 0 && staticTools.length === 0 && (
                <EmptyState message="No skills installed yet." />
            )}

            {dynamicSkills.length > 0 && (
                <div>
                    <div className="text-[10px] uppercase tracking-widest text-[#00ff41]/40 mb-2 font-mono">
                        Dynamic Skills ({dynamicSkills.length})
                    </div>
                    <div className="space-y-2">
                        {dynamicSkills.map(ds => (
                            <SkillCard
                                key={ds.id}
                                name={ds.name}
                                description={ds.description}
                                tags={ds.tags}
                                version={ds.version ?? 1}
                                stats={`${successRate(ds)}${ds.lastUsed ? ` · last used ${fmtDate(ds.lastUsed)}` : ''} · created ${fmtDate(ds.createdAt)}`}
                                onDelete={() => onDelete(ds.id)}
                            />
                        ))}
                    </div>
                </div>
            )}

            {staticTools.length > 0 && (
                <div>
                    <div className="text-[10px] uppercase tracking-widest text-[#00ff41]/40 mb-2 font-mono mt-4">
                        Built-in Skills ({staticTools.length})
                    </div>
                    <div className="space-y-2">
                        {staticTools.map(t => (
                            <SkillCard
                                key={t.name}
                                name={t.name ?? ''}
                                description={t.description ?? ''}
                                badge={
                                    <span className="text-[9px] px-1.5 py-0.5 bg-[#00ff41]/10 border border-[#00ff41]/15 rounded text-[#00ff41]/40">
                                        built-in
                                    </span>
                                }
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Community Tab
// ---------------------------------------------------------------------------

function CommunityTab({ installedDynamic }: { installedDynamic: DynamicSkill[] }) {
    const [url, setUrl] = useState(() => skillRegistryService.getRegistryUrl());
    const [skills, setSkills] = useState<CommunitySkill[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
    const [installingId, setInstallingId] = useState<string | null>(null);
    const hasFetched = useRef(false);

    // Track installed skills by id and name
    useEffect(() => {
        const ids = new Set<string>();
        for (const ds of installedDynamic) {
            ids.add(ds.id);
            ids.add(ds.name);
        }
        setInstalledIds(ids);
    }, [installedDynamic]);

    const saveUrl = () => {
        skillRegistryService.setRegistryUrl(url.trim());
        skillRegistryService.clearCache();
        hasFetched.current = false;
    };

    const fetchSkills = useCallback(async () => {
        if (!skillRegistryService.getRegistryUrl()) return;
        setLoading(true);
        setError(null);
        try {
            const data = await skillRegistryService.fetchCommunitySkills();
            setSkills(data);
        } catch {
            setError('Failed to fetch skills from registry.');
        } finally {
            setLoading(false);
        }
    }, []);

    // Auto-fetch on first render if URL is set
    useEffect(() => {
        if (!hasFetched.current && skillRegistryService.getRegistryUrl()) {
            hasFetched.current = true;
            fetchSkills();
        }
    }, [fetchSkills]);

    const handleRefresh = () => {
        skillRegistryService.clearCache();
        fetchSkills();
    };

    const handleInstall = async (cs: CommunitySkill) => {
        setInstallingId(cs.id);
        try {
            const json = JSON.stringify(cs);
            await skillRegistryService.importSkillJSON(json);
            setInstalledIds(prev => new Set([...prev, cs.id, cs.name]));
        } catch (e: any) {
            setError(`Install failed: ${e?.message || String(e)}`);
        } finally {
            setInstallingId(null);
        }
    };

    const registryUrl = skillRegistryService.getRegistryUrl();

    return (
        <div className="space-y-4">
            {/* URL row */}
            <div className="flex gap-2">
                <input
                    type="url"
                    value={url}
                    onChange={e => setUrl(e.target.value)}
                    placeholder="https://example.com/skills.json"
                    className="flex-1 bg-black/50 border border-[#00ff41]/20 rounded-lg px-3 py-2 text-xs font-mono text-[#00ff41] placeholder-[#00ff41]/25 focus:outline-none focus:border-[#00ff41]/50"
                />
                <button
                    onClick={() => { saveUrl(); fetchSkills(); }}
                    className="px-3 py-2 bg-[#00ff41]/15 border border-[#00ff41]/30 text-[#00ff41] rounded-lg text-xs font-mono hover:bg-[#00ff41]/25 transition-colors"
                >
                    Set
                </button>
                <button
                    onClick={handleRefresh}
                    title="Refresh"
                    className="p-2 border border-[#00ff41]/20 rounded-lg text-[#00ff41]/60 hover:text-[#00ff41] hover:border-[#00ff41]/40 transition-colors"
                >
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {error && (
                <div className="text-xs text-red-400 font-mono px-1">{error}</div>
            )}

            {!registryUrl && (
                <EmptyState message="No registry URL configured. Enter a URL above to browse community skills." />
            )}

            {registryUrl && !loading && skills.length === 0 && !error && (
                <EmptyState message="No skills found. Refresh to try again." />
            )}

            {loading && (
                <div className="text-[#00ff41]/40 text-xs font-mono text-center py-8">
                    Loading skills…
                </div>
            )}

            {skills.length > 0 && (
                <div className="space-y-2">
                    {skills.map(cs => {
                        const isInstalled = installedIds.has(cs.id) || installedIds.has(cs.name);
                        const isInstalling = installingId === cs.id;
                        return (
                            <div
                                key={cs.id}
                                className="bg-[#00ff41]/5 border border-[#00ff41]/15 rounded-xl p-3 hover:border-[#00ff41]/30 transition-colors"
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-[#00ff41] text-sm font-semibold truncate">{cs.name}</span>
                                            <span className="text-[9px] px-1.5 py-0.5 bg-[#00ff41]/10 border border-[#00ff41]/20 rounded text-[#00ff41]/60">
                                                v{cs.version}
                                            </span>
                                        </div>
                                        <p className="text-[#00ff41]/60 text-xs mt-1 line-clamp-2">{cs.description}</p>
                                        {cs.tags && cs.tags.length > 0 && (
                                            <div className="flex flex-wrap gap-1 mt-1.5">
                                                {cs.tags.map(tag => (
                                                    <span key={tag} className="text-[9px] px-1.5 py-0.5 bg-[#00ff41]/10 border border-[#00ff41]/20 rounded text-[#00ff41]/60">
                                                        {tag}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                        <div className="text-[10px] text-[#00ff41]/35 font-mono mt-1">
                                            by {cs.author} · {cs.downloadCount} downloads
                                        </div>
                                    </div>
                                    <div className="flex-shrink-0">
                                        {isInstalled ? (
                                            <span className="text-[10px] px-2 py-1 bg-[#00ff41]/10 border border-[#00ff41]/20 rounded text-[#00ff41]/60 font-mono">
                                                Installed
                                            </span>
                                        ) : (
                                            <button
                                                onClick={() => handleInstall(cs)}
                                                disabled={isInstalling}
                                                className="flex items-center gap-1 px-2 py-1 bg-[#00ff41]/15 border border-[#00ff41]/30 text-[#00ff41] rounded text-[10px] font-mono hover:bg-[#00ff41]/25 transition-colors disabled:opacity-50"
                                            >
                                                {isInstalling ? (
                                                    <RefreshCw size={10} className="animate-spin" />
                                                ) : (
                                                    <Download size={10} />
                                                )}
                                                Install
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Share Tab
// ---------------------------------------------------------------------------

function ShareTab({ dynamicSkills }: { dynamicSkills: DynamicSkill[] }) {
    const [selected, setSelected] = useState<DynamicSkill | null>(null);
    const [copied, setCopied] = useState(false);
    const [importJson, setImportJson] = useState('');
    const [importUrl, setImportUrl] = useState('');
    const [importStatus, setImportStatus] = useState<string | null>(null);
    const [importError, setImportError] = useState<string | null>(null);
    const [importing, setImporting] = useState(false);

    const exportedJson = selected ? skillRegistryService.exportSkillJSON(selected) : '';

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(exportedJson);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            /* ignore clipboard errors */
        }
    };

    const handleImportJson = async () => {
        if (!importJson.trim()) return;
        setImporting(true);
        setImportStatus(null);
        setImportError(null);
        try {
            const ds = await skillRegistryService.importSkillJSON(importJson.trim());
            setImportStatus(`Imported skill: "${ds.name}"`);
            setImportJson('');
        } catch (e: any) {
            setImportError(e?.message || String(e));
        } finally {
            setImporting(false);
        }
    };

    const handleImportUrl = async () => {
        if (!importUrl.trim()) return;
        setImporting(true);
        setImportStatus(null);
        setImportError(null);
        try {
            const ds = await skillRegistryService.importFromURL(importUrl.trim());
            setImportStatus(`Imported skill: "${ds.name}"`);
            setImportUrl('');
        } catch (e: any) {
            setImportError(e?.message || String(e));
        } finally {
            setImporting(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Export section */}
            <div>
                <div className="text-[10px] uppercase tracking-widest text-[#00ff41]/50 mb-2 font-mono">
                    Export a Skill
                </div>
                {dynamicSkills.length === 0 ? (
                    <EmptyState message="No dynamic skills to export." />
                ) : (
                    <div className="space-y-2">
                        {dynamicSkills.map(ds => (
                            <button
                                key={ds.id}
                                onClick={() => setSelected(selected?.id === ds.id ? null : ds)}
                                className={[
                                    'w-full text-left px-3 py-2 rounded-xl border font-mono text-xs transition-colors',
                                    selected?.id === ds.id
                                        ? 'bg-[#00ff41]/15 border-[#00ff41]/50 text-[#00ff41]'
                                        : 'bg-[#00ff41]/5 border-[#00ff41]/15 text-[#00ff41]/70 hover:border-[#00ff41]/30',
                                ].join(' ')}
                            >
                                {ds.name}
                            </button>
                        ))}
                    </div>
                )}

                {selected && (
                    <div className="mt-3">
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] text-[#00ff41]/40 font-mono uppercase tracking-widest">
                                JSON for {selected.name}
                            </span>
                            <button
                                onClick={handleCopy}
                                className="flex items-center gap-1 px-2 py-1 bg-[#00ff41]/10 border border-[#00ff41]/20 text-[#00ff41]/70 hover:text-[#00ff41] rounded text-[10px] font-mono transition-colors"
                            >
                                {copied ? <Check size={10} /> : <Copy size={10} />}
                                {copied ? 'Copied!' : 'Copy JSON'}
                            </button>
                        </div>
                        <pre className="bg-black/60 border border-[#00ff41]/15 rounded-xl p-3 text-[10px] text-[#00ff41]/60 font-mono overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
                            {exportedJson}
                        </pre>
                    </div>
                )}

                <div className="mt-3 p-3 bg-[#00ff41]/5 border border-[#00ff41]/10 rounded-xl text-[10px] text-[#00ff41]/40 font-mono space-y-1">
                    <div className="text-[#00ff41]/60 font-semibold mb-1">Tips</div>
                    <div>Share this JSON with others so they can import it.</div>
                    <div>Or host it at a URL and add it to your Community registry.</div>
                    <div>A registry JSON file is an array of skill objects: <code>[{'{'}...{'}'}, ...]</code></div>
                </div>
            </div>

            {/* Import section */}
            <div>
                <div className="text-[10px] uppercase tracking-widest text-[#00ff41]/50 mb-2 font-mono">
                    Import a Skill
                </div>

                {importStatus && (
                    <div className="flex items-center gap-2 p-2 mb-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-400 font-mono">
                        <Check size={12} /> {importStatus}
                    </div>
                )}
                {importError && (
                    <div className="flex items-center gap-2 p-2 mb-2 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400 font-mono">
                        <AlertTriangle size={12} /> {importError}
                    </div>
                )}

                <div className="space-y-2">
                    <textarea
                        value={importJson}
                        onChange={e => setImportJson(e.target.value)}
                        placeholder="Paste skill JSON here…"
                        rows={5}
                        className="w-full bg-black/50 border border-[#00ff41]/20 rounded-xl px-3 py-2 text-[11px] font-mono text-[#00ff41] placeholder-[#00ff41]/25 focus:outline-none focus:border-[#00ff41]/50 resize-y"
                    />
                    <button
                        onClick={handleImportJson}
                        disabled={importing || !importJson.trim()}
                        className="flex items-center gap-2 px-3 py-2 bg-[#00ff41]/15 border border-[#00ff41]/30 text-[#00ff41] rounded-lg text-xs font-mono hover:bg-[#00ff41]/25 transition-colors disabled:opacity-40"
                    >
                        <Upload size={12} /> Import from JSON
                    </button>
                </div>

                <div className="mt-4 space-y-2">
                    <div className="text-[10px] text-[#00ff41]/40 font-mono uppercase tracking-widest">
                        Or import from a URL
                    </div>
                    <div className="flex gap-2">
                        <input
                            type="url"
                            value={importUrl}
                            onChange={e => setImportUrl(e.target.value)}
                            placeholder="https://example.com/my-skill.json"
                            className="flex-1 bg-black/50 border border-[#00ff41]/20 rounded-lg px-3 py-2 text-xs font-mono text-[#00ff41] placeholder-[#00ff41]/25 focus:outline-none focus:border-[#00ff41]/50"
                        />
                        <button
                            onClick={handleImportUrl}
                            disabled={importing || !importUrl.trim()}
                            className="px-3 py-2 bg-[#00ff41]/15 border border-[#00ff41]/30 text-[#00ff41] rounded-lg text-xs font-mono hover:bg-[#00ff41]/25 transition-colors disabled:opacity-40"
                        >
                            {importing ? <RefreshCw size={12} className="animate-spin" /> : 'Import'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

const SkillsVaultPanel: React.FC<SkillsVaultPanelProps> = ({ onClose }) => {
    const [activeTab, setActiveTab] = useState<Tab>('installed');
    const [dynamicSkills, setDynamicSkills] = useState<DynamicSkill[]>([]);
    const [degraded, setDegraded] = useState<DegradedBanner | null>(null);

    // Load dynamic skills initially and on agentSkillService change
    const reload = useCallback(async () => {
        const skills = await dynamicSkillService.list();
        setDynamicSkills(skills);
    }, []);

    useEffect(() => {
        reload();
        const unsub = agentSkillService.onChange(reload);
        return unsub;
    }, [reload]);

    // Listen for degraded skill events
    useEffect(() => {
        const handler = (e: Event) => {
            const { id, name } = (e as CustomEvent<{ id: string; name: string }>).detail;
            setDegraded({ id, name });
        };
        window.addEventListener('echo:skill:degraded', handler);
        return () => window.removeEventListener('echo:skill:degraded', handler);
    }, []);

    const handleDelete = async (id: string) => {
        await dynamicSkillService.delete(id);
        if (degraded?.id === id) setDegraded(null);
        await reload();
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            {/* Backdrop */}
            <div className="fixed inset-0 bg-black/80 backdrop-blur-xl" onClick={onClose} />

            {/* Panel */}
            <div className="relative w-full max-w-2xl bg-black/95 border border-[#00ff41]/20 rounded-2xl shadow-2xl max-h-[90dvh] flex flex-col font-mono text-[#00ff41] overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-5 pt-5 pb-3">
                    <div>
                        <h2 className="text-base font-semibold tracking-widest uppercase">Skills Vault</h2>
                        <p className="text-[10px] text-[#00ff41]/50 uppercase tracking-widest mt-0.5">
                            {dynamicSkills.length} dynamic · manage capabilities
                        </p>
                    </div>
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="p-2 text-[#00ff41]/50 hover:text-[#00ff41] transition-colors"
                        >
                            <X size={18} />
                        </button>
                    )}
                </div>

                {/* Tab bar */}
                <TabBar active={activeTab} onChange={setActiveTab} />

                {/* Tab content */}
                <div className="flex-1 overflow-y-auto p-5">
                    {activeTab === 'installed' && (
                        <InstalledTab
                            dynamicSkills={dynamicSkills}
                            onDelete={handleDelete}
                            degraded={degraded}
                        />
                    )}
                    {activeTab === 'community' && (
                        <CommunityTab installedDynamic={dynamicSkills} />
                    )}
                    {activeTab === 'share' && (
                        <ShareTab dynamicSkills={dynamicSkills} />
                    )}
                </div>
            </div>
        </div>
    );
};

export default SkillsVaultPanel;
