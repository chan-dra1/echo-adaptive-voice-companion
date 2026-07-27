import React, { useEffect, useRef } from 'react';
import { ChatMessage } from '../types';
import { Ghost, X, Copy, Check } from 'lucide-react';

interface StealthPanelProps {
    history: ChatMessage[];
    isThinking?: boolean;
    onClose: () => void;
}

const StealthPanel: React.FC<StealthPanelProps> = ({ history, isThinking, onClose }) => {
    const bottomRef = useRef<HTMLDivElement>(null);
    const [copiedId, setCopiedId] = React.useState<string | null>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [history, isThinking]);

    const handleCopy = (text: string, id: string) => {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    // Filter only assistant messages for stealth mode to reduce clutter
    // or maybe show both but styled minimally? Let's show both but very compact.
    const relevantMessages = history.slice(-5); // Only show last 5 messages for focus

    return (
        <div className="term-window fixed top-20 right-4 w-80 z-50 flex flex-col max-h-[600px] animate-phosphor-in" style={{ borderColor: 'var(--accent-cyan)' }}>
            {/* Header */}
            <div className="term-titlebar handle cursor-move" style={{ color: 'var(--accent-cyan)' }}>
                <span className="term-dots" />
                <div className="flex items-center gap-2 flex-1" style={{ color: 'var(--accent-cyan)' }}>
                    <Ghost size={14} aria-hidden="true" />
                    <span className="text-xs font-[var(--font-term)] font-bold tracking-[0.2em] uppercase">GHOST.MODE</span>
                </div>
                <button onClick={onClose} className="text-[var(--text-tertiary)] hover:text-[var(--accent-cyan)] transition-colors" aria-label="Close ghost mode panel">
                    <X size={16} />
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-3 space-y-4 scrollbar-hide" style={{ background: 'rgba(1,7,3,0.92)' }}>
                {relevantMessages.map((msg) => (
                    <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                        <div
                            className={`max-w-[95%] px-3 py-2 text-xs leading-relaxed group relative font-mono ${msg.role === 'user'
                                ? 'bg-[rgba(0,255,65,0.04)] text-[var(--text-tertiary)] border border-[var(--border-dim)]'
                                : 'border text-[var(--text-primary)]'
                                }`}
                            style={msg.role === 'assistant' ? { background: 'rgba(43,217,107,0.08)', borderColor: 'var(--accent-purple)' } : undefined}
                        >
                            {msg.text}

                            {/* Copy Button for Assistant responses */}
                            {msg.role === 'assistant' && (
                                <button
                                    onClick={() => handleCopy(msg.text, msg.id)}
                                    className="absolute -right-6 top-0 opacity-0 group-hover:opacity-100 transition-opacity text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                                    title="Copy to clipboard"
                                >
                                    {copiedId === msg.id ? <Check size={12} style={{ color: 'var(--accent-cyan)' }} /> : <Copy size={12} />}
                                </button>
                            )}
                        </div>
                    </div>
                ))}

                {isThinking && (
                    <div className="flex items-center gap-2 text-xs animate-pulse px-2 font-mono uppercase tracking-widest" style={{ color: 'var(--accent-cyan)', opacity: 0.6 }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent-cyan)' }}></span>
                        <span>Ghost active (listening)...</span>
                    </div>
                )}
                <div ref={bottomRef} />
            </div>

            {/* Footer Status */}
            <div className="p-2 border-t flex items-center justify-between text-[10px] font-mono uppercase tracking-widest" style={{ borderColor: 'var(--border-dim)', background: 'rgba(0,255,65,0.03)', color: 'var(--text-tertiary)' }}>
                <span>Mic + System Audio Active</span>
                <span className="flex items-center gap-1" style={{ color: 'var(--accent-red)' }}>
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--accent-red)' }}></span>
                    LIVE
                </span>
            </div>
        </div>
    );
};

export default StealthPanel;
