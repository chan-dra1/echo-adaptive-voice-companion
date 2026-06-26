/**
 * RAGPanel.tsx — Knowledge Vault UI
 *
 * Lets the user:
 *  1. See all ingested documents / memory sources
 *  2. Upload new documents (PDF, TXT, MD, code files)
 *  3. Test the retrieval with a live search
 *  4. Delete individual sources
 *  5. See embedding model load status
 *
 * Design: VIKI-style cyan HUD panel (same language as CompanionPanel).
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    getAllSources, deleteSource, getChunkCount, clearAllRag,
    ingestText, query as ragQuery, formatRagContext,
    RagSource, RetrievedChunk, ChunkSource,
} from '../services/ragService';
import { getEmbeddingStatus, onEmbeddingStatusChange, warmEmbeddingModel } from '../services/embeddingService';
import HUDCard, { HUDDivider, HUDRow } from './HUDCard';
import { X, Upload, Search, Trash2, Database, FileText, Brain, MessageSquare, Zap, AlertTriangle, CheckCircle, Loader } from 'lucide-react';

interface Props { onClose: () => void; }

type Tab = 'sources' | 'search' | 'ingest';

const TYPE_ICON: Record<ChunkSource, React.ReactNode> = {
    document:     <FileText size={12} />,
    conversation: <MessageSquare size={12} />,
    memory:       <Brain size={12} />,
    note:         <FileText size={12} />,
    web:          <Zap size={12} />,
};
const TYPE_COLOR: Record<ChunkSource, string> = {
    document:     'var(--c-cyan)',
    conversation: 'var(--c-green)',
    memory:       'var(--c-pink)',
    note:         'var(--c-amber)',
    web:          '#A064FF',
};

function fmtSize(chars: number): string {
    if (chars < 1000) return `${chars} chars`;
    if (chars < 1_000_000) return `${(chars / 1000).toFixed(1)}K chars`;
    return `${(chars / 1_000_000).toFixed(2)}M chars`;
}
function fmtDate(ts: number): string {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function RAGPanel({ onClose }: Props) {
    const [tab, setTab]           = useState<Tab>('sources');
    const [sources, setSources]   = useState<RagSource[]>([]);
    const [chunkCount, setChunkCount] = useState(0);
    const [modelStatus, setModelStatus] = useState(getEmbeddingStatus());

    // Search tab
    const [searchQ, setSearchQ]   = useState('');
    const [searching, setSearching] = useState(false);
    const [results, setResults]   = useState<RetrievedChunk[]>([]);
    const [searchDone, setSearchDone] = useState(false);

    // Ingest tab
    const [ingestText_,  setIngestText_]  = useState('');
    const [ingestTitle,  setIngestTitle]  = useState('');
    const [ingestType,   setIngestType]   = useState<ChunkSource>('document');
    const [ingesting,    setIngesting]    = useState(false);
    const [ingestProgress, setIngestProgress] = useState<{done:number;total:number}|null>(null);
    const [ingestDone,   setIngestDone]   = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const reload = useCallback(async () => {
        setSources(await getAllSources());
        setChunkCount(await getChunkCount());
    }, []);

    useEffect(() => {
        reload();
        warmEmbeddingModel();
        const unsub = onEmbeddingStatusChange(setModelStatus);
        return unsub;
    }, []);

    const handleDelete = async (id: string) => {
        await deleteSource(id);
        reload();
    };

    const handleSearch = async () => {
        if (!searchQ.trim()) return;
        setSearching(true);
        setSearchDone(false);
        try {
            const r = await ragQuery(searchQ, { topK: 6, threshold: 0.25 });
            setResults(r);
            setSearchDone(true);
        } finally {
            setSearching(false);
        }
    };

    const handleIngestText = async () => {
        if (!ingestText_.trim() || !ingestTitle.trim()) return;
        setIngesting(true);
        setIngestDone(false);
        setIngestProgress(null);
        try {
            await ingestText(ingestText_, {
                title: ingestTitle,
                type: ingestType,
                onProgress: (done, total) => setIngestProgress({ done, total }),
            });
            setIngestDone(true);
            setIngestText_('');
            setIngestTitle('');
            await reload();
        } finally {
            setIngesting(false);
            setIngestProgress(null);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setIngesting(true);
        setIngestDone(false);
        setIngestProgress(null);
        try {
            const text = await readFileAsText(file);
            await ingestText(text, {
                title: file.name,
                type: 'document',
                onProgress: (done, total) => setIngestProgress({ done, total }),
            });
            setIngestDone(true);
            await reload();
        } catch (err) {
            console.error('[RAGPanel] file ingest failed:', err);
        } finally {
            setIngesting(false);
            setIngestProgress(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const TABS: Tab[] = ['sources', 'search', 'ingest'];
    const TAB_COLORS: Record<Tab, string> = {
        sources: 'var(--c-cyan)',
        search:  'var(--c-green)',
        ingest:  'var(--c-amber)',
    };

    return (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'rgba(0,8,16,0.97)', backdropFilter: 'blur(20px)' }}>
            <div className="scan-beam" style={{ top: 0 }} />

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0" style={{ borderColor: 'var(--b-cyan)' }}>
                <div className="flex items-center gap-3">
                    <Database size={18} style={{ color: 'var(--c-cyan)', filter: 'drop-shadow(0 0 6px var(--c-cyan))' }} />
                    <span className="font-hud text-sm tracking-widest text-glow-cyan" style={{ color: 'var(--c-cyan)' }}>
                        KNOWLEDGE VAULT  //  RAG
                    </span>
                </div>
                <div className="flex items-center gap-4">
                    <ModelStatusBadge status={modelStatus} />
                    <div className="font-mono-hud text-[10px] text-white/30">
                        {chunkCount} chunks · {sources.length} sources
                    </div>
                    <button onClick={onClose}><X size={16} style={{ color: 'var(--c-cyan)' }} /></button>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex px-6 pt-4 gap-2 flex-shrink-0">
                {TABS.map(t => (
                    <button key={t} onClick={() => setTab(t)}
                        className="flex-1 py-2 rounded-lg font-hud text-[9px] tracking-widest uppercase transition-all"
                        style={{
                            background: tab === t ? `${TAB_COLORS[t]}18` : 'transparent',
                            border: `1px solid ${tab === t ? TAB_COLORS[t] : 'rgba(255,255,255,0.06)'}`,
                            color: tab === t ? TAB_COLORS[t] : 'rgba(255,255,255,0.35)',
                            boxShadow: tab === t ? `0 0 10px ${TAB_COLORS[t]}33` : 'none',
                            textShadow: tab === t ? `0 0 8px ${TAB_COLORS[t]}` : 'none',
                        }}>
                        {t}
                    </button>
                ))}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4" style={{ scrollbarWidth: 'none' }}>

                {/* ── SOURCES ── */}
                {tab === 'sources' && (
                    <>
                        {sources.length === 0 ? (
                            <div className="text-center py-16">
                                <Database size={40} className="mx-auto mb-4 opacity-20" style={{ color: 'var(--c-cyan)' }} />
                                <p className="font-mono-hud text-[11px] text-white/30">KNOWLEDGE VAULT IS EMPTY</p>
                                <p className="text-xs text-white/20 mt-1">Go to Ingest tab to add documents</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {sources.map(s => <SourceRow key={s.id} source={s} onDelete={() => handleDelete(s.id)} />)}
                            </div>
                        )}

                        {sources.length > 0 && (
                            <HUDCard variant="amber" label="VAULT STATS">
                                <HUDRow label="TOTAL SOURCES"  value={`${sources.length}`} valueClass="text-[var(--c-cyan)]" />
                                <HUDRow label="TOTAL CHUNKS"   value={`${chunkCount}`} valueClass="text-[var(--c-cyan)]" />
                                <HUDRow label="DOCUMENTS"      value={`${sources.filter(s=>s.type==='document').length}`} valueClass="text-white/60" />
                                <HUDRow label="CONVERSATIONS"  value={`${sources.filter(s=>s.type==='conversation').length}`} valueClass="text-white/60" />
                                <HUDRow label="MEMORIES"       value={`${sources.filter(s=>s.type==='memory').length}`} valueClass="text-white/60" />
                                <HUDDivider />
                                <button
                                    onClick={async () => { if (confirm('Clear ALL knowledge? This cannot be undone.')) { await clearAllRag(); reload(); } }}
                                    className="w-full py-2 rounded-lg font-hud text-[9px] tracking-widest transition-all"
                                    style={{ border: '1px solid rgba(255,48,64,0.3)', color: 'var(--c-red)' }}
                                >
                                    CLEAR ALL KNOWLEDGE
                                </button>
                            </HUDCard>
                        )}
                    </>
                )}

                {/* ── SEARCH ── */}
                {tab === 'search' && (
                    <>
                        <HUDCard variant="green" label="SEMANTIC SEARCH">
                            <p className="text-xs text-white/50 mb-3 leading-relaxed">
                                Test what Echo will retrieve for a question. Uses the same pipeline as live responses.
                            </p>
                            <div className="flex gap-2">
                                <input
                                    value={searchQ}
                                    onChange={e => setSearchQ(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleSearch()}
                                    placeholder="Ask anything…"
                                    className="flex-1 bg-transparent text-sm text-white/80 outline-none py-2 px-3 rounded-lg border placeholder:text-white/20"
                                    style={{ borderColor: 'rgba(0,255,65,0.25)' }}
                                />
                                <button
                                    onClick={handleSearch}
                                    disabled={searching || !searchQ.trim()}
                                    className="px-4 py-2 rounded-lg font-hud text-[9px] tracking-widest flex items-center gap-2 transition-all"
                                    style={{
                                        background: 'rgba(0,255,65,0.1)',
                                        border: '1px solid rgba(0,255,65,0.4)',
                                        color: 'var(--c-green)',
                                    }}
                                >
                                    {searching ? <Loader size={12} className="animate-spin" /> : <Search size={12} />}
                                    {searching ? 'SEARCHING' : 'SEARCH'}
                                </button>
                            </div>
                        </HUDCard>

                        {searchDone && results.length === 0 && (
                            <div className="text-center py-8">
                                <p className="font-mono-hud text-[11px] text-white/30">NO RELEVANT CHUNKS FOUND</p>
                                <p className="text-xs text-white/20 mt-1">Try a different query or lower the threshold</p>
                            </div>
                        )}

                        {results.map((r, i) => (
                            <div key={r.chunk.id} className="p-4 rounded-xl space-y-2"
                                style={{ background: 'rgba(0,15,35,0.7)', border: `1px solid ${TYPE_COLOR[r.source.type]}22` }}>
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span style={{ color: TYPE_COLOR[r.source.type] }}>{TYPE_ICON[r.source.type]}</span>
                                        <span className="font-mono-hud text-[10px] text-white/50 truncate">{r.source.title}</span>
                                    </div>
                                    <ScoreBar score={r.score} />
                                </div>
                                <p className="text-xs text-white/70 leading-relaxed line-clamp-4">{r.chunk.text}</p>
                                <p className="font-mono-hud text-[9px] text-white/25">
                                    CHUNK {r.chunk.chunkIndex} · {fmtDate(r.chunk.addedAt)}
                                </p>
                            </div>
                        ))}

                        {results.length > 0 && (
                            <HUDCard variant="cyan" label="WHAT ECHO WOULD SEE">
                                <pre className="text-[10px] text-white/40 font-mono-hud whitespace-pre-wrap leading-relaxed">
                                    {formatRagContext(results).slice(0, 600)}…
                                </pre>
                            </HUDCard>
                        )}
                    </>
                )}

                {/* ── INGEST ── */}
                {tab === 'ingest' && (
                    <>
                        {/* File upload */}
                        <HUDCard variant="amber" label="UPLOAD FILE" scanBeam>
                            <p className="text-xs text-white/50 mb-3 leading-relaxed">
                                Drop a PDF, TXT, MD, or code file. Echo will chunk and embed it — stored locally, never sent anywhere.
                            </p>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".txt,.md,.pdf,.ts,.tsx,.js,.jsx,.py,.json,.csv,.html,.css"
                                onChange={handleFileUpload}
                                className="hidden"
                            />
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                disabled={ingesting}
                                className="w-full py-4 rounded-xl flex items-center justify-center gap-3 transition-all"
                                style={{
                                    border: '2px dashed rgba(255,179,0,0.3)',
                                    background: 'rgba(255,179,0,0.04)',
                                    color: 'rgba(255,179,0,0.7)',
                                }}
                            >
                                <Upload size={16} />
                                <span className="font-hud text-[10px] tracking-widest">
                                    {ingesting ? 'PROCESSING…' : 'CLICK TO UPLOAD FILE'}
                                </span>
                            </button>
                            {ingestProgress && (
                                <div className="mt-3">
                                    <div className="flex justify-between font-mono-hud text-[10px] text-white/40 mb-1">
                                        <span>EMBEDDING CHUNKS</span>
                                        <span>{ingestProgress.done}/{ingestProgress.total}</span>
                                    </div>
                                    <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                                        <div
                                            className="h-full rounded-full transition-all"
                                            style={{
                                                width: `${(ingestProgress.done / ingestProgress.total) * 100}%`,
                                                background: 'linear-gradient(90deg, var(--c-amber), var(--c-cyan))',
                                            }}
                                        />
                                    </div>
                                </div>
                            )}
                        </HUDCard>

                        {/* Manual text ingest */}
                        <HUDCard variant="cyan" label="PASTE TEXT">
                            <div className="space-y-3">
                                <div>
                                    <label className="font-hud text-[9px] tracking-widest text-white/40 block mb-1">TITLE</label>
                                    <input
                                        value={ingestTitle}
                                        onChange={e => setIngestTitle(e.target.value)}
                                        placeholder="e.g. Machine Learning Notes, My Resume…"
                                        className="w-full bg-transparent text-sm text-white/80 outline-none py-1.5 border-b placeholder:text-white/20"
                                        style={{ borderColor: 'var(--b-cyan)' }}
                                    />
                                </div>
                                <div>
                                    <label className="font-hud text-[9px] tracking-widest text-white/40 block mb-1">TYPE</label>
                                    <div className="flex gap-2 flex-wrap">
                                        {(['document','note','memory','web'] as ChunkSource[]).map(t => (
                                            <button key={t} onClick={() => setIngestType(t)}
                                                className="px-3 py-1 rounded-full font-hud text-[8px] tracking-widest transition-all"
                                                style={{
                                                    background: ingestType === t ? `${TYPE_COLOR[t]}18` : 'transparent',
                                                    border: `1px solid ${ingestType === t ? TYPE_COLOR[t] : 'rgba(255,255,255,0.1)'}`,
                                                    color: ingestType === t ? TYPE_COLOR[t] : 'rgba(255,255,255,0.3)',
                                                }}>
                                                {t.toUpperCase()}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <label className="font-hud text-[9px] tracking-widest text-white/40 block mb-1">CONTENT</label>
                                    <textarea
                                        value={ingestText_}
                                        onChange={e => setIngestText_(e.target.value)}
                                        rows={6}
                                        placeholder="Paste your text here…"
                                        className="w-full bg-transparent text-xs text-white/70 outline-none resize-none p-2 rounded-lg border placeholder:text-white/20"
                                        style={{ borderColor: 'rgba(0,229,255,0.15)' }}
                                    />
                                    <p className="font-mono-hud text-[10px] text-white/25 mt-1">
                                        {ingestText_.length.toLocaleString()} chars · ~{Math.ceil(ingestText_.length / 600)} chunks
                                    </p>
                                </div>
                                <button
                                    onClick={handleIngestText}
                                    disabled={ingesting || !ingestText_.trim() || !ingestTitle.trim()}
                                    className="w-full py-3 rounded-xl font-hud text-[10px] tracking-widest flex items-center justify-center gap-2 transition-all"
                                    style={{
                                        background: (!ingesting && ingestText_.trim() && ingestTitle.trim()) ? 'rgba(0,229,255,0.1)' : 'transparent',
                                        border: `1px solid ${(!ingesting && ingestText_.trim() && ingestTitle.trim()) ? 'var(--c-cyan)' : 'rgba(255,255,255,0.08)'}`,
                                        color: (!ingesting && ingestText_.trim() && ingestTitle.trim()) ? 'var(--c-cyan)' : 'rgba(255,255,255,0.2)',
                                    }}
                                >
                                    {ingesting
                                        ? <><Loader size={12} className="animate-spin" /> EMBEDDING {ingestProgress ? `${ingestProgress.done}/${ingestProgress.total}` : '…'}</>
                                        : <><Database size={12} /> INGEST INTO VAULT</>
                                    }
                                </button>
                                {ingestDone && (
                                    <div className="flex items-center gap-2 font-mono-hud text-[10px]" style={{ color: 'var(--c-green)' }}>
                                        <CheckCircle size={12} /> SUCCESSFULLY ADDED TO VAULT
                                    </div>
                                )}
                            </div>
                        </HUDCard>

                        {/* How it works */}
                        <HUDCard variant="purple" label="HOW RAG WORKS">
                            <div className="space-y-2 text-xs text-white/40 leading-relaxed">
                                <p>1. Your text is split into ~600-char overlapping <span style={{color:'var(--c-cyan)'}}>chunks</span>.</p>
                                <p>2. Each chunk is converted to a 384-number <span style={{color:'var(--c-cyan)'}}>embedding vector</span> by a model running entirely in your browser (WebAssembly, no server).</p>
                                <p>3. Vectors are stored in <span style={{color:'var(--c-cyan)'}}>IndexedDB</span> on this device — never uploaded.</p>
                                <p>4. When you talk to Echo, your message is also embedded and the <span style={{color:'var(--c-green)'}}>top-5 most similar chunks</span> are retrieved and injected into the prompt automatically.</p>
                                <p>5. Echo answers with knowledge <span style={{color:'var(--c-green)'}}>from your personal vault</span> — not just from its training data.</p>
                            </div>
                        </HUDCard>
                    </>
                )}
            </div>
        </div>
    );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SourceRow({ source, onDelete }: { source: RagSource; onDelete: () => void | Promise<void>; key?: any }) {
    const [expanded, setExpanded] = useState(false);
    const col = TYPE_COLOR[source.type];
    return (
        <div
            className="p-3 rounded-xl cursor-pointer transition-all"
            style={{ background: 'rgba(0,15,35,0.6)', border: `1px solid ${col}18` }}
            onClick={() => setExpanded(v => !v)}
        >
            <div className="flex items-center gap-3">
                <span style={{ color: col, flexShrink: 0 }}>{TYPE_ICON[source.type]}</span>
                <div className="flex-1 min-w-0">
                    <p className="text-sm text-white/80 truncate">{source.title}</p>
                    <p className="font-mono-hud text-[10px] text-white/30 mt-0.5">
                        {source.chunkCount} chunks · {fmtSize(source.sizeChars)} · {fmtDate(source.addedAt)}
                    </p>
                </div>
                <span className="font-hud text-[8px] px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: `${col}15`, border: `1px solid ${col}33`, color: col }}>
                    {source.type.toUpperCase()}
                </span>
                <button
                    onClick={e => { e.stopPropagation(); onDelete(); }}
                    className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors flex-shrink-0"
                >
                    <Trash2 size={12} style={{ color: 'var(--c-red)' }} />
                </button>
            </div>
            {expanded && (
                <p className="mt-2 text-xs text-white/35 italic leading-relaxed pt-2 border-t" style={{ borderColor: `${col}15` }}>
                    "{source.preview}…"
                </p>
            )}
        </div>
    );
}

function ScoreBar({ score }: { score: number }) {
    const pct   = Math.round(score * 100);
    const color = score >= 0.75 ? 'var(--c-green)' : score >= 0.50 ? 'var(--c-cyan)' : 'var(--c-amber)';
    return (
        <div className="flex items-center gap-2 flex-shrink-0">
            <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color, boxShadow: `0 0 4px ${color}` }} />
            </div>
            <span className="font-hud text-[9px]" style={{ color }}>{pct}%</span>
        </div>
    );
}

function ModelStatusBadge({ status }: { status: string }) {
    const configs: Record<string, { label: string; color: string; dot: string }> = {
        idle:    { label: 'MODEL IDLE',    color: 'rgba(255,255,255,0.3)', dot: 'white' },
        loading: { label: 'LOADING MODEL', color: 'var(--c-amber)',        dot: 'amber' },
        ready:   { label: 'MODEL READY',   color: 'var(--c-green)',        dot: 'green' },
        error:   { label: 'MODEL ERROR',   color: 'var(--c-red)',          dot: 'red' },
    };
    const cfg = configs[status] || configs.idle;
    return (
        <div className="flex items-center gap-1.5">
            <span className={`status-dot ${cfg.dot}`} />
            <span className="font-mono-hud text-[9px] tracking-wider" style={{ color: cfg.color }}>{cfg.label}</span>
        </div>
    );
}

// ── File reader helper ─────────────────────────────────────────────────────────

async function readFileAsText(file: File): Promise<string> {
    // PDF: use pdfjs-dist (already in package.json)
    if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
            'pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url
        ).toString();
        const buffer    = await file.arrayBuffer();
        const pdf       = await pdfjsLib.getDocument({ data: buffer }).promise;
        const pages: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
            const page    = await pdf.getPage(i);
            const content = await page.getTextContent();
            pages.push(content.items.map((it: any) => it.str).join(' '));
        }
        return pages.join('\n\n');
    }

    // Everything else: plain text
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsText(file);
    });
}
