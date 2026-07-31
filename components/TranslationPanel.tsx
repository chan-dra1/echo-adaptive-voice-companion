import React, { useState, useEffect, useRef } from 'react';
import { Languages, X, ArrowRight, Check, Volume2, Globe } from 'lucide-react';
import { ChatMessage } from '../types';

interface TranslationPanelProps {
    onClose: () => void;
    history: ChatMessage[];
    isThinking: boolean;
}

const LANGUAGES = [
    { code: 'hi', name: 'Hindi' },
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
    { code: 'de', name: 'German' },
    { code: 'ja', name: 'Japanese' },
    { code: 'zh', name: 'Chinese' },
    { code: 'ru', name: 'Russian' },
    { code: 'pt', name: 'Portuguese' },
];

export default function TranslationPanel({ onClose, history, isThinking }: TranslationPanelProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [targetLang, setTargetLang] = useState('en');
    const [sourceLang, setSourceLang] = useState('auto'); // 'auto' or specific code

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [history, isThinking]);

    // Filter for assistant messages which should contain the translation format
    const translationMessages = history.filter(m => m.role === 'assistant');

    return (
        <div className="term-window fixed top-20 left-4 right-4 w-auto md:right-auto md:w-96 z-50 flex flex-col max-h-[600px] animate-slide-in-left animate-phosphor-in">
            {/* Header */}
            <div className="term-titlebar handle cursor-move !justify-between">
                <div className="flex items-center gap-2">
                    <span className="term-dots" />
                    <Globe size={14} className="text-[var(--accent-green)]" />
                    <span className="font-hud text-xs tracking-widest uppercase text-[var(--accent-green)]">TRANSLATE.SYS</span>
                </div>
                <button onClick={onClose} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors">
                    <X size={16} />
                </button>
            </div>

            {/* Language Controls */}
            <div className="p-3 bg-[rgba(0,255,65,0.04)] border-b border-[var(--border-dim)] flex items-center justify-between gap-2">
                <div className="flex-1">
                    <span className="font-hud text-[10px] uppercase tracking-widest text-[var(--text-tertiary)] block mb-1">INPUT</span>
                    <select
                        value={sourceLang}
                        onChange={(e) => setSourceLang(e.target.value)}
                        className="w-full bg-[var(--bg-base)] border border-[var(--border-dim)] rounded px-2 py-1 text-xs font-mono text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-green)]"
                    >
                        <option value="auto">Auto-Detect</option>
                        {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
                    </select>
                </div>
                <ArrowRight size={14} className="text-[var(--text-tertiary)] mt-4" />
                <div className="flex-1">
                    <span className="font-hud text-[10px] uppercase tracking-widest text-[var(--text-tertiary)] block mb-1">OUTPUT</span>
                    <select
                        value={targetLang}
                        onChange={(e) => setTargetLang(e.target.value)}
                        className="w-full bg-[var(--bg-base)] border border-[var(--border-dim)] rounded px-2 py-1 text-xs font-mono text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-green)]"
                    >
                        <option value="en">English</option>
                        {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
                    </select>
                </div>
            </div>

            {/* Content Area */}
            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[300px]"
            >
                {translationMessages.length === 0 && !isThinking && (
                    <div className="flex flex-col items-center justify-center h-full text-[var(--text-tertiary)] space-y-2 opacity-60">
                        <Languages size={40} />
                        <p className="text-xs font-mono">// Listening for foreign languages...</p>
                    </div>
                )}

                {translationMessages.map((msg, idx) => (
                    <div key={idx} className="bg-[rgba(0,255,65,0.04)] rounded-lg p-3 border border-[var(--border-dim)] space-y-2">
                        {/* We expect the model to output formatted text. For now, just render raw content.
                 Ideally, we parse the "ORIGINAL" and "TRANSLATED" parts.
             */}
                        <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                    </div>
                ))}

                {isThinking && (
                    <div className="flex items-center gap-2 text-[var(--accent-green)] text-xs font-mono animate-pulse">
                        <div className="w-1.5 h-1.5 bg-[var(--accent-green)] rounded-full animate-bounce" />
                        <div className="w-1.5 h-1.5 bg-[var(--accent-green)] rounded-full animate-bounce delay-100" />
                        <div className="w-1.5 h-1.5 bg-[var(--accent-green)] rounded-full animate-bounce delay-200" />
                        <span className="uppercase tracking-widest">Translating...</span>
                    </div>
                )}
            </div>

            {/* Footer / Status */}
            <div className="p-2 border-t border-[var(--border-dim)] bg-[var(--bg-raised)] rounded-b-xl">
                <div className="flex items-center justify-center gap-2">
                    <span className="status-dot green" />
                    <span className="font-hud text-[10px] text-[var(--accent-green)] tracking-widest uppercase">Active Listening</span>
                </div>
            </div>
        </div>
    );
}
