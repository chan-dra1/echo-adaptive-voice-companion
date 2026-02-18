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
        <div className="fixed top-20 left-4 w-96 bg-black/80 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl z-50 flex flex-col max-h-[600px] animate-slide-in-left">
            {/* Header */}
            <div className="p-4 border-b border-white/10 flex items-center justify-between handle cursor-move bg-gradient-to-r from-blue-900/20 to-purple-900/20 rounded-t-xl">
                <div className="flex items-center gap-2 text-blue-400">
                    <Globe size={18} />
                    <span className="text-sm font-mono font-bold tracking-wider">UNIVERSAL_TRANSLATOR</span>
                </div>
                <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
                    <X size={16} />
                </button>
            </div>

            {/* Language Controls */}
            <div className="p-3 bg-white/5 border-b border-white/5 flex items-center justify-between gap-2">
                <div className="flex-1">
                    <span className="text-xs text-gray-500 block mb-1">INPUT</span>
                    <select
                        value={sourceLang}
                        onChange={(e) => setSourceLang(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
                    >
                        <option value="auto">Auto-Detect</option>
                        {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
                    </select>
                </div>
                <ArrowRight size={14} className="text-gray-600 mt-4" />
                <div className="flex-1">
                    <span className="text-xs text-gray-500 block mb-1">OUTPUT</span>
                    <select
                        value={targetLang}
                        onChange={(e) => setTargetLang(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
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
                    <div className="flex flex-col items-center justify-center h-full text-gray-500 space-y-2 opacity-60">
                        <Languages size={40} />
                        <p className="text-xs">Listening for foreign languages...</p>
                    </div>
                )}

                {translationMessages.map((msg, idx) => (
                    <div key={idx} className="bg-white/5 rounded-lg p-3 border border-white/5 space-y-2">
                        {/* We expect the model to output formatted text. For now, just render raw content. 
                 Ideally, we parse the "ORIGINAL" and "TRANSLATED" parts. 
             */}
                        <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                    </div>
                ))}

                {isThinking && (
                    <div className="flex items-center gap-2 text-blue-400 text-xs animate-pulse">
                        <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" />
                        <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce delay-100" />
                        <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce delay-200" />
                        <span>Translating...</span>
                    </div>
                )}
            </div>

            {/* Footer / Status */}
            <div className="p-2 border-t border-white/5 bg-black/40 rounded-b-xl">
                <div className="flex items-center justify-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-[10px] text-green-400 font-mono tracking-widest uppercase">Active Listening</span>
                </div>
            </div>
        </div>
    );
}
