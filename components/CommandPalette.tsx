/**
 * CommandPalette.tsx — Spotlight-style global launcher.
 *
 *   • Opens via ⌘K / Ctrl+K / `/` from anywhere
 *   • Fuzzy-search across every Echo capability
 *   • Natural-language commands: "remember I love coffee" → saves a memory
 *   • Keyboard-driven: ↑/↓ to navigate, Enter to fire, Esc to close
 *   • Visual: VIKI cyan with a slow scan beam and amber accent on selection
 *
 * Designed as a SINGLE entry point — every panel in the app can be opened
 * from here so the user doesn't have to remember icon meanings.
 */
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, ChevronRight, Sparkles, Hash } from 'lucide-react';
import { saveMemory } from '../services/memoryService';

export interface Command {
    id: string;
    label: string;
    description?: string;
    icon: React.ReactNode;
    /** category for grouping */
    category: 'Navigation' | 'Action' | 'Voice' | 'Memory' | 'Practice' | 'System';
    /** keywords for fuzzy match */
    keywords?: string[];
    /** color glyph */
    color?: string;
    /** what to do when triggered */
    run: () => void | Promise<void>;
}

interface Props {
    open: boolean;
    onClose: () => void;
    commands: Command[];
}

// ── Fuzzy match scorer ────────────────────────────────────────────────────────
function fuzzyScore(text: string, query: string): number {
    if (!query) return 1;
    const t = text.toLowerCase();
    const q = query.toLowerCase();
    if (t.includes(q)) return 1 - (t.indexOf(q) / 100);

    let ti = 0, score = 0;
    for (const ch of q) {
        const idx = t.indexOf(ch, ti);
        if (idx === -1) return 0;
        score += 1 / (idx - ti + 1);
        ti = idx + 1;
    }
    return score / q.length;
}

// ── Natural-language command parsing ─────────────────────────────────────────
function parseNaturalCommand(text: string): { type: string; payload: string } | null {
    const t = text.trim().toLowerCase();
    if (!t) return null;
    if (t.startsWith('remember ') || t.startsWith('remember:'))
        return { type: 'remember', payload: text.replace(/^remember[:\s]+/i, '') };
    if (t.startsWith('add habit ') || t.startsWith('habit:'))
        return { type: 'habit', payload: text.replace(/^(add habit|habit:)\s*/i, '') };
    if (t.startsWith('add goal ') || t.startsWith('goal:'))
        return { type: 'goal', payload: text.replace(/^(add goal|goal:)\s*/i, '') };
    if (t.startsWith('note '))
        return { type: 'note', payload: text.replace(/^note\s*/i, '') };
    return null;
}

export default function CommandPalette({ open, onClose, commands }: Props) {
    const [q, setQ]               = useState('');
    const [activeIdx, setActiveIdx] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef  = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (open) {
            setQ('');
            setActiveIdx(0);
            setTimeout(() => inputRef.current?.focus(), 30);
        }
    }, [open]);

    // ── Filter + group ────────────────────────────────────────────────────────
    const filteredCommands = useMemo(() => {
        if (!q.trim()) return commands;
        const scored = commands.map(c => {
            const text = `${c.label} ${c.description || ''} ${c.category} ${(c.keywords || []).join(' ')}`;
            return { command: c, score: fuzzyScore(text, q) };
        });
        return scored.filter(s => s.score > 0.05).sort((a, b) => b.score - a.score).map(s => s.command);
    }, [q, commands]);

    const grouped = useMemo(() => {
        const map = new Map<string, Command[]>();
        for (const c of filteredCommands) {
            const list = map.get(c.category) || [];
            list.push(c);
            map.set(c.category, list);
        }
        return Array.from(map.entries());
    }, [filteredCommands]);

    const nlCommand = useMemo(() => parseNaturalCommand(q), [q]);

    const totalItems = filteredCommands.length + (nlCommand ? 1 : 0);

    // ── Keyboard nav ──────────────────────────────────────────────────────────
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIdx(i => Math.min(i + 1, totalItems - 1));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIdx(i => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') {
                e.preventDefault();
                fireActive();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, totalItems, activeIdx, nlCommand, filteredCommands]);

    useEffect(() => { setActiveIdx(0); }, [q]);

    // scroll active item into view
    useEffect(() => {
        if (!listRef.current) return;
        const active = listRef.current.querySelector('[data-active="true"]') as HTMLElement | null;
        active?.scrollIntoView({ block: 'nearest' });
    }, [activeIdx]);

    const fireActive = async () => {
        // Natural language commands are slot 0 when present
        if (nlCommand && activeIdx === 0) {
            await runNaturalCommand(nlCommand);
            onClose();
            return;
        }
        const realIdx = nlCommand ? activeIdx - 1 : activeIdx;
        const cmd = filteredCommands[realIdx];
        if (cmd) { await cmd.run(); onClose(); }
    };

    const runNaturalCommand = async (cmd: { type: string; payload: string }) => {
        if (cmd.type === 'remember') {
            const [key, ...rest] = cmd.payload.split(/[:—-]/);
            const value = rest.join(':').trim() || cmd.payload;
            saveMemory(key.trim().slice(0, 60), value, 'local_only');
            window.dispatchEvent(new CustomEvent('echo:toast', { detail: { type: 'success', message: `Remembered: ${value}` } }));
        }
        if (cmd.type === 'note') {
            saveMemory('note', cmd.payload, 'local_only');
            window.dispatchEvent(new CustomEvent('echo:toast', { detail: { type: 'success', message: 'Note saved' } }));
        }
        // habit/goal could integrate with lifeCoachService — left as v2
    };

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] px-4"
            style={{ background: 'rgba(0,5,15,0.65)', backdropFilter: 'blur(12px)' }}
            onClick={onClose}
        >
            <div
                className="w-full max-w-2xl rounded-2xl overflow-hidden relative animate-cmd-in"
                style={{
                    background: 'linear-gradient(180deg, rgba(0,15,35,0.95), rgba(0,8,20,0.95))',
                    border: '1px solid rgba(0,229,255,0.35)',
                    boxShadow: '0 0 60px rgba(0,229,255,0.25), 0 20px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
                }}
                onClick={e => e.stopPropagation()}
            >
                {/* Scan beam */}
                <div className="scan-beam" style={{ top: 0 }} />

                {/* Search bar */}
                <div className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: 'rgba(0,229,255,0.15)' }}>
                    <Search size={18} style={{ color: 'var(--c-cyan)', filter: 'drop-shadow(0 0 6px var(--c-cyan))' }} />
                    <input
                        ref={inputRef}
                        value={q}
                        onChange={e => setQ(e.target.value)}
                        placeholder="Search commands · or try 'remember I love coffee'…"
                        className="flex-1 bg-transparent outline-none text-base text-white placeholder:text-white/30"
                        style={{ caretColor: 'var(--c-cyan)' }}
                    />
                    <div className="flex items-center gap-1.5">
                        <kbd className="font-mono-hud text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(0,229,255,0.08)', border: '1px solid rgba(0,229,255,0.2)', color: 'var(--c-cyan)' }}>↑↓</kbd>
                        <kbd className="font-mono-hud text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(0,229,255,0.08)', border: '1px solid rgba(0,229,255,0.2)', color: 'var(--c-cyan)' }}>↵</kbd>
                        <kbd className="font-mono-hud text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,48,64,0.08)', border: '1px solid rgba(255,48,64,0.2)', color: 'var(--c-red)' }}>esc</kbd>
                    </div>
                </div>

                {/* Results */}
                <div ref={listRef} className="max-h-[55vh] overflow-y-auto py-2" style={{ scrollbarWidth: 'thin' }}>

                    {/* Natural language command — always at top when matched */}
                    {nlCommand && (
                        <div className="px-3 py-1">
                            <div className="font-hud text-[9px] tracking-widest text-white/30 px-3 py-1 flex items-center gap-1.5">
                                <Sparkles size={9} style={{ color: 'var(--c-amber)' }} /> NATURAL COMMAND
                            </div>
                            <CommandRow
                                active={activeIdx === 0}
                                onClick={fireActive}
                                onHover={() => setActiveIdx(0)}
                                label={`${nlCommand.type.toUpperCase()}: "${nlCommand.payload}"`}
                                description={`Saves as ${nlCommand.type === 'remember' ? 'encrypted memory (local_only)' : nlCommand.type}`}
                                icon={<Sparkles size={14} />}
                                color="var(--c-amber)"
                            />
                        </div>
                    )}

                    {/* Grouped commands */}
                    {grouped.map(([category, cmds]) => (
                        <div key={category} className="px-3 py-1">
                            <div className="font-hud text-[9px] tracking-widest text-white/30 px-3 py-1 flex items-center gap-1.5">
                                <Hash size={8} /> {category.toUpperCase()}
                            </div>
                            {cmds.map((c) => {
                                const flatIdx = filteredCommands.indexOf(c) + (nlCommand ? 1 : 0);
                                return (
                                    <CommandRow
                                        key={c.id}
                                        active={activeIdx === flatIdx}
                                        onClick={async () => { await c.run(); onClose(); }}
                                        onHover={() => setActiveIdx(flatIdx)}
                                        label={c.label}
                                        description={c.description}
                                        icon={c.icon}
                                        color={c.color || 'var(--c-cyan)'}
                                    />
                                );
                            })}
                        </div>
                    ))}

                    {filteredCommands.length === 0 && !nlCommand && (
                        <div className="text-center py-10 px-6">
                            <Search size={20} className="mx-auto mb-3 opacity-20" style={{ color: 'var(--c-cyan)' }} />
                            <p className="font-mono-hud text-[11px] text-white/40">NO COMMANDS MATCH "{q}"</p>
                            <p className="font-mono-hud text-[10px] text-white/25 mt-2">Try: <span style={{ color: 'var(--c-amber)' }}>remember I have a meeting at 3pm</span></p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-5 py-2 border-t flex items-center justify-between font-mono-hud text-[9px]" style={{ borderColor: 'rgba(0,229,255,0.1)', background: 'rgba(0,0,0,0.3)' }}>
                    <span className="text-white/30">ECHO COMMAND CENTER</span>
                    <span className="text-white/30">{filteredCommands.length + (nlCommand ? 1 : 0)} OPTIONS</span>
                </div>
            </div>
        </div>
    );
}

// ── Row ───────────────────────────────────────────────────────────────────────
function CommandRow({ active, onClick, onHover, label, description, icon, color }: {
    key?: any;
    active: boolean; onClick: () => void | Promise<void>; onHover: () => void;
    label: string; description?: string; icon: React.ReactNode; color: string;
}) {
    return (
        <div
            data-active={active}
            onClick={onClick}
            onMouseEnter={onHover}
            className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all"
            style={{
                background: active ? `${color}10` : 'transparent',
                border: `1px solid ${active ? `${color}55` : 'transparent'}`,
                boxShadow: active ? `0 0 12px ${color}22, inset 0 0 20px ${color}08` : 'none',
            }}
        >
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{
                background: active ? `${color}15` : 'rgba(255,255,255,0.04)',
                border: `1px solid ${color}33`,
                color: active ? color : 'rgba(255,255,255,0.5)',
            }}>
                {icon}
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-sm truncate" style={{ color: active ? color : 'rgba(255,255,255,0.85)', textShadow: active ? `0 0 8px ${color}66` : 'none' }}>
                    {label}
                </div>
                {description && (
                    <div className="font-mono-hud text-[10px] text-white/35 truncate mt-0.5">{description}</div>
                )}
            </div>
            {active && (
                <ChevronRight size={14} style={{ color, filter: `drop-shadow(0 0 4px ${color})` }} />
            )}
        </div>
    );
}
