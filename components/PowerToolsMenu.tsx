import React from 'react';
import { X, Folder, Sparkles, Megaphone, Zap, Rocket, Bot, Ghost, Package, Languages, Ghost as GhostIcon } from 'lucide-react';
import Tooltip from './Tooltip';

interface PowerToolsMenuProps {
    onClose: () => void;
    onOpen: (which:
        | 'vault' | 'skills' | 'social' | 'automation' | 'missions'
        | 'subAgents' | 'ghostMode' | 'files'
    ) => void;
    runningSubAgents: number;
    isTranslationMode: boolean;
    onToggleTranslation: () => void;
    isStealthMode: boolean;
    onToggleStealth: () => void;
}

interface Row {
    key: Parameters<PowerToolsMenuProps['onOpen']>[0];
    icon: React.ReactNode;
    label: string;
    desc: string;
    badge?: number;
}

/**
 * A self-positioning floating launcher (same term-window pattern as
 * MeetingPanel/SubAgentPanel) that replaces 7+ flat always-visible sidebar
 * icons with a single "Power Tools" entry point — see the UI redesign plan's
 * Stage 2. Every row here just calls back into App.tsx's existing setShowX
 * handlers; this component owns no panel-open state of its own.
 */
export default function PowerToolsMenu({
    onClose, onOpen, runningSubAgents, isTranslationMode, onToggleTranslation, isStealthMode, onToggleStealth,
}: PowerToolsMenuProps) {
    const rows: Row[] = [
        { key: 'vault', icon: <Folder size={16} />, label: 'Vault Organizer', desc: 'Organize tasks, memories & docs into folders' },
        { key: 'skills', icon: <Sparkles size={16} />, label: 'Skills Vault', desc: 'Manage installed skills, discover community ones' },
        { key: 'social', icon: <Megaphone size={16} />, label: 'Social Autopilot', desc: 'Auto-post across every social network' },
        { key: 'automation', icon: <Zap size={16} />, label: 'Automation Hub', desc: 'Build and schedule automations' },
        { key: 'missions', icon: <Rocket size={16} />, label: 'Autonomous Missions', desc: 'Give Echo a goal and a schedule — it runs on its own' },
        { key: 'subAgents', icon: <Bot size={16} />, label: 'Sub-Agents', desc: 'Background agents working on your behalf', badge: runningSubAgents },
        { key: 'ghostMode', icon: <Ghost size={16} />, label: 'Ghost Mode', desc: "Configure Echo's interview/professional persona" },
        { key: 'files', icon: <Package size={16} />, label: 'Files & Drafts', desc: 'Everything Echo has made — drafts & campaigns' },
    ];

    return (
        <div
            className="term-window fixed top-20 left-4 right-4 w-auto md:right-auto md:left-20 md:w-80 z-50 flex flex-col max-h-[75vh] animate-phosphor-in"
            style={{ borderColor: 'var(--accent-cyan)' }}
        >
            <div className="term-titlebar" style={{ color: 'var(--accent-cyan)' }}>
                <span className="term-dots" />
                <div className="flex items-center gap-2 flex-1" style={{ color: 'var(--accent-cyan)' }}>
                    <Zap size={14} aria-hidden="true" />
                    <span className="text-xs font-[var(--font-term)] font-bold tracking-[0.2em] uppercase">Power Tools</span>
                </div>
                <button
                    onClick={onClose}
                    className="text-[var(--text-tertiary)] hover:text-[var(--accent-cyan)] transition-colors"
                    aria-label="Close power tools"
                >
                    <X size={16} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-hide" style={{ background: 'rgba(1,7,3,0.92)' }}>
                {rows.map((r) => (
                    <button
                        key={r.key}
                        onClick={() => onOpen(r.key)}
                        className="w-full flex items-start gap-3 p-2.5 rounded-lg text-left hover:bg-[rgba(87,255,176,0.08)] transition-colors group"
                    >
                        <span className="mt-0.5 text-[var(--text-tertiary)] group-hover:text-[var(--accent-cyan)] transition-colors relative flex-shrink-0">
                            {r.icon}
                            {!!r.badge && r.badge > 0 && (
                                <span
                                    className="absolute -top-1.5 -right-1.5 flex items-center justify-center rounded-full text-[8px] font-bold font-mono"
                                    style={{ minWidth: 12, height: 12, padding: '0 2px', background: 'var(--accent-cyan)', color: '#001505' }}
                                    aria-hidden="true"
                                >
                                    {r.badge}
                                </span>
                            )}
                        </span>
                        <span className="min-w-0">
                            <span className="block text-xs text-[var(--text-primary)] font-medium">{r.label}</span>
                            <span className="block text-[10px] text-[var(--text-tertiary)] leading-snug mt-0.5">{r.desc}</span>
                        </span>
                    </button>
                ))}

                <div className="pt-1 mt-1 border-t border-[var(--border-subtle)] space-y-1">
                    <Tooltip content="Show translated conversation alongside the original">
                        <button
                            onClick={onToggleTranslation}
                            className="w-full flex items-center justify-between gap-3 p-2.5 rounded-lg text-left hover:bg-[rgba(87,255,176,0.08)] transition-colors"
                        >
                            <span className="flex items-center gap-3">
                                <Languages size={16} className="text-[var(--text-tertiary)]" />
                                <span className="text-xs text-[var(--text-primary)] font-medium">Live Translation</span>
                            </span>
                            <span
                                className="relative w-9 h-5 rounded-full transition-colors flex-shrink-0"
                                style={{ background: isTranslationMode ? 'var(--accent-cyan)' : 'var(--surface-3)' }}
                            >
                                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-black transition-transform ${isTranslationMode ? 'left-4' : 'left-0.5'}`} />
                            </span>
                        </button>
                    </Tooltip>
                    <Tooltip content="Minimal, low-profile transcript view">
                        <button
                            onClick={onToggleStealth}
                            className="w-full flex items-center justify-between gap-3 p-2.5 rounded-lg text-left hover:bg-[rgba(87,255,176,0.08)] transition-colors"
                        >
                            <span className="flex items-center gap-3">
                                <GhostIcon size={16} className="text-[var(--text-tertiary)]" />
                                <span className="text-xs text-[var(--text-primary)] font-medium">Stealth View</span>
                            </span>
                            <span
                                className="relative w-9 h-5 rounded-full transition-colors flex-shrink-0"
                                style={{ background: isStealthMode ? 'var(--accent-cyan)' : 'var(--surface-3)' }}
                            >
                                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-black transition-transform ${isStealthMode ? 'left-4' : 'left-0.5'}`} />
                            </span>
                        </button>
                    </Tooltip>
                </div>
            </div>
        </div>
    );
}
