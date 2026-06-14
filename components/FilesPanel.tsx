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
        setDrafts(getDrafts());
        setCampaigns(getCampaigns());
        if (handsOn) setProjects(await listProjects());
    };
    useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

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
                className="relative w-full max-w-md h-full bg-black border-l border-[#00E5FF]/25 shadow-2xl flex flex-col font-mono text-white animate-[slideIn_0.25s_ease]"
                onClick={e => e.stopPropagation()}
                style={{ boxShadow: '0 0 60px rgba(0,229,255,0.12)' }}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                    <div className="flex items-center gap-2">
                        <Package size={18} style={{ color: 'var(--c-cyan)' }} />
                        <div>
                            <div className="text-sm tracking-[0.3em] uppercase">Echo Files</div>
                            <div className="text-[10px] text-white/40 uppercase tracking-widest">{total} artifact{total === 1 ? '' : 's'} · everything Echo made</div>
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        <button onClick={() => wrap(refresh)} className="p-1.5 rounded hover:bg-white/10" title="Refresh">
                            <RefreshCw size={15} className={busy ? 'animate-spin' : ''} style={{ color: 'var(--c-cyan)' }} />
                        </button>
                        <button onClick={onClose} className="p-1.5 rounded hover:bg-white/10"><X size={16} /></button>
                    </div>
                </div>

                {/* Download-all bar */}
                <div className="px-5 py-3 border-b border-white/10 flex items-center gap-2">
                    <button
                        disabled={busy || total === 0}
                        onClick={() => wrap(async () => { const n = await downloadEverything(); if (!n) alert('Nothing to download yet.'); })}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[#00E5FF]/12 border border-[#00E5FF]/40 text-[#00E5FF] hover:bg-[#00E5FF]/20 disabled:opacity-30 transition text-xs tracking-widest uppercase"
                    >
                        <Package size={14} /> Download Everything (.zip)
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-white/10">
                    {TABS.map(t => (
                        <button key={t.id} onClick={() => setTab(t.id)}
                            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] tracking-widest uppercase transition border-b-2 ${tab === t.id ? 'border-[#00E5FF] text-[#00E5FF] bg-[#00E5FF]/5' : 'border-transparent text-white/45 hover:text-white/70'}`}>
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
                            <div className="text-center text-white/40 text-xs py-10 px-6 leading-relaxed">
                                <FolderGit2 size={28} className="mx-auto mb-3 opacity-40" />
                                Projects live as real files in <span className="text-[#00E5FF]">~/EchoProjects</span>.<br />
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
            <div className="text-center text-white/35 text-xs py-12 px-6 leading-relaxed">
                <Inbox size={28} className="mx-auto mb-3 opacity-40" />
                {emptyText}
            </div>
        );
    }
    return (
        <>
            {bulk && (
                <button onClick={bulk}
                    className="w-full mb-2 flex items-center justify-center gap-2 px-3 py-1.5 rounded-md bg-white/5 border border-white/10 hover:bg-white/10 text-[11px] tracking-widest uppercase text-white/70 transition">
                    <Download size={12} /> {bulkLabel}
                </button>
            )}
            {children}
        </>
    );
}

function Row({ title, sub, preview, onDownload, secondary }: {
    title: string; sub: string; preview: string; onDownload: () => void;
    secondary?: { label: string; onClick: () => void };
}) {
    return (
        <div className="group relative p-3 rounded-lg bg-white/[0.03] border border-white/8 hover:border-[#00E5FF]/30 transition">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="text-sm text-white/90 truncate">{title}</div>
                    <div className="text-[10px] text-white/40 uppercase tracking-widest mt-0.5">{sub}</div>
                    <div className="text-[11px] text-white/35 mt-1.5 line-clamp-2 leading-snug">{preview.slice(0, 140)}</div>
                </div>
                <div className="flex flex-col gap-1 flex-shrink-0">
                    <button onClick={onDownload}
                        className="p-2 rounded-md bg-[#00E5FF]/10 border border-[#00E5FF]/30 text-[#00E5FF] hover:bg-[#00E5FF]/20 transition"
                        title="Download">
                        <Download size={14} />
                    </button>
                    {secondary && (
                        <button onClick={secondary.onClick}
                            className="p-2 rounded-md bg-white/5 border border-white/10 text-white/50 hover:bg-white/10 transition text-[9px]"
                            title={secondary.label}>
                            <FolderGit2 size={13} />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
