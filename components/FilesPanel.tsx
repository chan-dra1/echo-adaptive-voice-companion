import React, { useEffect, useState } from 'react';
import { X, FileText, Megaphone, FolderGit2, Download, Package, RefreshCw, Inbox } from 'lucide-react';
import {
    getDrafts, getCampaigns, listProjects,
    draftToMarkdown, draftFilename, campaignFilename, downloadText,
    downloadAllDrafts, downloadAllCampaigns, downloadEverything,
    getProjectFiles, downloadZip,
    type DraftItem, type ProjectInfo,
} from '../services/artifactsService';
import type { StoredCampaign } from '../services/campaignStudioService';
import { isHandsConnected, handsCall } from '../services/handsBridgeService';
import { isCoreConnected, getCoreDrafts, getCoreCampaigns } from '../services/echoCoreSync';

interface Props { onClose: () => void; }

type Tab = 'drafts' | 'campaigns' | 'projects';

export default function FilesPanel({ onClose }: Props) {
    const [tab, setTab] = useState<Tab>('drafts');
    const [drafts, setDrafts] = useState<DraftItem[]>([]);
    const [campaigns, setCampaigns] = useState<StoredCampaign[]>([]);
    const [projects, setProjects] = useState<ProjectInfo[]>([]);
    const [busy, setBusy] = useState(false);
    const handsOn = isHandsConnected();

    const refresh = async () => {
        // Merge browser-stored artifacts with any created in the terminal (Echo Core).
        const coreDrafts = isCoreConnected() ? getCoreDrafts() : [];
        const coreCampaigns = isCoreConnected() ? getCoreCampaigns() : [];
        const mergeById = (a: any[], b: any[]) => {
            const seen = new Set(a.map(x => x.id));
            return [...a, ...b.filter(x => !seen.has(x.id))];
        };
        setDrafts(mergeById(getDrafts(), coreDrafts).sort((a, b) => b.createdAt - a.createdAt));
        setCampaigns(mergeById(getCampaigns(), coreCampaigns).sort((a, b) => b.createdAt - a.createdAt));
        if (handsOn) setProjects(await listProjects());
    };
    useEffect(() => {
        refresh();
        const onCoreChange = () => refresh();
        window.addEventListener('echocore:change', onCoreChange);
        window.addEventListener('echocore:snapshot', onCoreChange);
        return () => {
            window.removeEventListener('echocore:change', onCoreChange);
            window.removeEventListener('echocore:snapshot', onCoreChange);
        };
        /* eslint-disable-next-line */
    }, []);

    const counts = { drafts: drafts.length, campaigns: campaigns.length, projects: projects.length };
    const total = counts.drafts + counts.campaigns + counts.projects;

    const wrap = async (fn: () => any | Promise<any>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

    const TABS: { id: Tab; label: string; icon: React.ReactNode; n: number }[] = [
        { id: 'drafts', label: 'Drafts', icon: <FileText size={14} />, n: counts.drafts },
        { id: 'campaigns', label: 'Campaigns', icon: <Megaphone size={14} />, n: counts.campaigns },
        { id: 'projects', label: 'Projects', icon: <FolderGit2 size={14} />, n: counts.projects },
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
                    <Package size={16} style={{ color: 'var(--accent-cyan)' }} aria-hidden="true" />
                    <div className="flex-1">
                        <div className="text-xs tracking-[0.25em] uppercase" style={{ color: 'var(--accent-cyan)' }}>FILES.DIR</div>
                        <div className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest">{total} artifact{total === 1 ? '' : 's'} · everything Echo made</div>
                    </div>
                    <button onClick={() => wrap(refresh)} className="p-1.5 rounded hover:bg-[rgba(87,255,176,0.1)]" title="Refresh">
                        <RefreshCw size={15} className={busy ? 'animate-spin' : ''} style={{ color: 'var(--accent-cyan)' }} />
                    </button>
                    <button onClick={onClose} className="p-1.5 rounded hover:bg-[rgba(87,255,176,0.1)] text-[var(--text-tertiary)] hover:text-[var(--accent-cyan)]" aria-label="Close files panel"><X size={16} /></button>
                </div>

                {/* Download-all bar */}
                <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--border-dim)' }}>
                    <button
                        disabled={busy || total === 0}
                        onClick={() => wrap(async () => { const n = await downloadEverything(); if (!n) alert('Nothing to download yet.'); })}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[rgba(87,255,176,0.1)] border border-[var(--accent-cyan)]/40 hover:bg-[rgba(87,255,176,0.18)] disabled:opacity-30 transition text-xs tracking-widest uppercase"
                        style={{ color: 'var(--accent-cyan)' }}
                    >
                        <Package size={14} /> Download Everything (.zip)
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b" style={{ borderColor: 'var(--border-dim)' }}>
                    {TABS.map(t => (
                        <button key={t.id} onClick={() => setTab(t.id)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] tracking-widest uppercase transition border-b-2"
                            style={tab === t.id ? { borderColor: 'var(--accent-cyan)', color: 'var(--accent-cyan)', background: 'rgba(87,255,176,0.05)' } : { borderColor: 'transparent', color: 'var(--text-tertiary)' }}>
                            {t.icon}{t.label}<span className="opacity-50">({t.n})</span>
                        </button>
                    ))}
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
                    {tab === 'drafts' && (
                        <Section
                            empty={drafts.length === 0}
                            emptyText="No drafts yet. Ask Echo to draft a reply, email or post."
                            bulk={drafts.length > 1 ? () => downloadAllDrafts() : undefined}
                            bulkLabel="Download all drafts (.zip)"
                        >
                            {drafts.map(d => (
                                <Row key={d.id}
                                    title={d.title}
                                    sub={`${d.kind} · ${new Date(d.createdAt).toLocaleDateString()}`}
                                    preview={d.content}
                                    onDownload={() => downloadText(draftFilename(d), draftToMarkdown(d))}
                                />
                            ))}
                        </Section>
                    )}

                    {tab === 'campaigns' && (
                        <Section
                            empty={campaigns.length === 0}
                            emptyText="No campaigns yet. Ask Echo for UGC / content campaign ideas."
                            bulk={campaigns.length > 1 ? () => downloadAllCampaigns() : undefined}
                            bulkLabel="Download all campaigns (.zip)"
                        >
                            {campaigns.map(c => (
                                <Row key={c.id}
                                    title={c.brand}
                                    sub={`campaign · ${new Date(c.createdAt).toLocaleDateString()}`}
                                    preview={c.markdown}
                                    onDownload={() => downloadText(campaignFilename(c), c.markdown)}
                                />
                            ))}
                        </Section>
                    )}

                    {tab === 'projects' && (
                        !handsOn ? (
                            <div className="text-center text-[var(--text-tertiary)] text-xs py-10 px-6 leading-relaxed">
                                <FolderGit2 size={28} className="mx-auto mb-3 opacity-40" />
                                Projects live as real files in <span style={{ color: 'var(--accent-cyan)' }}>~/EchoProjects</span>.<br />
                                Start the Echo Hands daemon (⌘K → Connect Echo Hands) to list and download them here.
                            </div>
                        ) : (
                            <Section empty={projects.length === 0} emptyText="No projects built yet. Ask Echo to build a website.">
                                {projects.map(p => (
                                    <Row key={p.name}
                                        title={p.name}
                                        sub={`project · ${p.sizeKB} KB`}
                                        preview={p.path}
                                        onDownload={async () => {
                                            const files = await getProjectFiles(p.name);
                                            if (files.length) downloadZip(`${p.name}.zip`, files);
                                            else alert('No readable files in this project.');
                                        }}
                                        secondary={{
                                            label: 'Open in Finder',
                                            onClick: () => handsCall('run_command', { command: `open ${JSON.stringify(p.path)}` }).catch(() => {}),
                                        }}
                                    />
                                ))}
                            </Section>
                        )
                    )}
                </div>
            </div>
            <style>{`@keyframes slideIn { from { transform: translateX(30px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }`}</style>
        </div>
    );
}

function Section({ children, empty, emptyText, bulk, bulkLabel }: {
    children: React.ReactNode; empty: boolean; emptyText: string; bulk?: () => void; bulkLabel?: string;
}) {
    if (empty) {
        return (
            <div className="text-center text-[var(--text-tertiary)] text-xs py-12 px-6 leading-relaxed">
                <Inbox size={28} className="mx-auto mb-3 opacity-40" />
                {emptyText}
            </div>
        );
    }
    return (
        <>
            {bulk && (
                <button onClick={bulk}
                    className="w-full mb-2 flex items-center justify-center gap-2 px-3 py-1.5 rounded-md bg-[rgba(0,255,65,0.04)] border border-[var(--border-dim)] hover:bg-[rgba(0,255,65,0.08)] text-[11px] tracking-widest uppercase text-[var(--text-secondary)] transition">
                    <Download size={12} /> {bulkLabel}
                </button>
            )}
            {children}
        </>
    );
}

function Row({ title, sub, preview, onDownload, secondary }: {
    key?: any;
    title: string; sub: string; preview: string; onDownload: () => void | Promise<void>;
    secondary?: { label: string; onClick: () => void | Promise<any> };
}) {
    return (
        <div className="group relative p-3 rounded-lg bg-[rgba(0,255,65,0.03)] border border-[var(--border-dim)] hover:border-[var(--accent-cyan)]/30 transition">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="text-sm text-[var(--text-primary)] truncate">{title}</div>
                    <div className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest mt-0.5">{sub}</div>
                    <div className="text-[11px] text-[var(--text-tertiary)] mt-1.5 line-clamp-2 leading-snug">{preview.slice(0, 140)}</div>
                </div>
                <div className="flex flex-col gap-1 flex-shrink-0">
                    <button onClick={onDownload}
                        className="p-2 rounded-md bg-[rgba(87,255,176,0.08)] border border-[var(--accent-cyan)]/30 hover:bg-[rgba(87,255,176,0.16)] transition"
                        style={{ color: 'var(--accent-cyan)' }}
                        title="Download">
                        <Download size={14} />
                    </button>
                    {secondary && (
                        <button onClick={secondary.onClick}
                            className="p-2 rounded-md bg-[rgba(0,255,65,0.04)] border border-[var(--border-dim)] text-[var(--text-tertiary)] hover:bg-[rgba(0,255,65,0.08)] transition text-[9px]"
                            title={secondary.label}>
                            <FolderGit2 size={13} />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
