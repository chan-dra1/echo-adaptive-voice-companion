import React, { useEffect, useState } from 'react';
import { Bot, X, XCircle } from 'lucide-react';
import { subAgentService, SubAgentRun, SubAgentStatus } from '../services/subAgentService';

interface SubAgentPanelProps {
    onClose: () => void;
}

const STATUS_STYLE: Record<SubAgentStatus, { color: string; label: string; dot: string }> = {
    running: { color: 'var(--accent-cyan)', label: 'RUNNING', dot: 'cyan' },
    done: { color: 'var(--accent-green)', label: 'DONE', dot: 'green' },
    failed: { color: 'var(--accent-red)', label: 'FAILED', dot: 'red' },
    timeout: { color: 'var(--accent-red)', label: 'TIMEOUT', dot: 'red' },
    cancelled: { color: 'var(--text-tertiary)', label: 'CANCELLED', dot: 'white' },
};

function elapsed(run: SubAgentRun): string {
    const end = run.finishedAt ?? Date.now();
    const secs = Math.max(0, Math.round((end - run.createdAt) / 1000));
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

const SubAgentPanel: React.FC<SubAgentPanelProps> = ({ onClose }) => {
    const [runs, setRuns] = useState<SubAgentRun[]>(() => subAgentService.list());
    // Elapsed-time display for running rows needs its own tick — the registry
    // only re-emits on real state changes (start/finish), not every second.
    const [, forceTick] = useState(0);

    useEffect(() => subAgentService.onChange(setRuns), []);

    useEffect(() => {
        if (!runs.some(r => r.status === 'running')) return;
        const id = setInterval(() => forceTick(t => t + 1), 1000);
        return () => clearInterval(id);
    }, [runs]);

    const runningCount = runs.filter(r => r.status === 'running').length;

    return (
        <div
            className="term-window fixed top-20 left-4 right-4 w-auto md:left-auto md:w-96 z-50 flex flex-col max-h-[70vh] animate-phosphor-in"
            style={{ borderColor: 'var(--accent-cyan)' }}
        >
            <div className="term-titlebar" style={{ color: 'var(--accent-cyan)' }}>
                <span className="term-dots" />
                <div className="flex items-center gap-2 flex-1" style={{ color: 'var(--accent-cyan)' }}>
                    <Bot size={14} aria-hidden="true" />
                    <span className="text-xs font-[var(--font-term)] font-bold tracking-[0.2em] uppercase">
                        SUB-AGENTS{runningCount > 0 ? ` (${runningCount} RUNNING)` : ''}
                    </span>
                </div>
                <button
                    onClick={onClose}
                    className="text-[var(--text-tertiary)] hover:text-[var(--accent-cyan)] transition-colors"
                    aria-label="Close sub-agents panel"
                >
                    <X size={16} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2 scrollbar-hide" style={{ background: 'rgba(1,7,3,0.92)' }}>
                {runs.length === 0 && (
                    <p className="text-xs text-[var(--text-tertiary)] font-mono text-center py-6">
                        &gt; No background tasks yet.
                        <br />
                        Echo delegates slow, multi-step work here instead of
                        blocking the conversation — nothing to show until it does.
                    </p>
                )}

                {runs.map(run => {
                    const style = STATUS_STYLE[run.status];
                    return (
                        <div
                            key={run.id}
                            className="p-2.5 rounded-lg border text-xs font-mono"
                            style={{ borderColor: 'var(--border-dim)', background: 'rgba(0,255,65,0.03)' }}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                    <span className={`status-dot ${style.dot}`} aria-hidden="true" />
                                    <span
                                        className="uppercase tracking-wider font-bold flex-shrink-0"
                                        style={{ color: style.color }}
                                    >
                                        [{style.label}]
                                    </span>
                                    <span className="text-[var(--text-primary)] truncate">{run.label}</span>
                                </div>
                                {run.role && (
                                    <span className="flex-shrink-0 uppercase tracking-wider text-[10px]" style={{ color: 'var(--accent-cyan)' }}>
                                        {run.role}
                                    </span>
                                )}
                                {run.status === 'running' && (
                                    <button
                                        onClick={() => subAgentService.cancel(run.id)}
                                        className="flex-shrink-0 flex items-center gap-1 text-[var(--accent-red)] hover:text-glow-green transition-colors"
                                        style={{ textShadow: 'none' }}
                                        aria-label={`Cancel sub-agent: ${run.label}`}
                                        title="Cancel"
                                    >
                                        <XCircle size={14} />
                                    </button>
                                )}
                            </div>

                            <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--text-tertiary)]">
                                <span>{elapsed(run)}</span>
                                <span>&middot;</span>
                                <span>{run.hopsUsed} hop{run.hopsUsed === 1 ? '' : 's'}</span>
                                <span>&middot;</span>
                                <span>{run.contextMode}</span>
                                {run.depth > 0 && (
                                    <>
                                        <span>&middot;</span>
                                        <span>depth {run.depth}</span>
                                    </>
                                )}
                            </div>

                            {run.status === 'done' && run.result && (
                                <p className="mt-1.5 text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap line-clamp-4">
                                    {run.result}
                                </p>
                            )}
                            {(run.status === 'failed' || run.status === 'timeout') && run.error && (
                                <p className="mt-1.5 text-[var(--accent-red)] leading-relaxed">{run.error}</p>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default SubAgentPanel;
