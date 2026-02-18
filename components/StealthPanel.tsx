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
        <div className="fixed top-20 right-4 w-80 bg-black/80 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl z-50 flex flex-col max-h-[600px] animate-slide-in-right">
            {/* Header */}
            <div className="p-3 border-b border-white/10 flex items-center justify-between handle cursor-move">
                <div className="flex items-center gap-2 text-emerald-400">
                    <Ghost size={16} />
                    <span className="text-xs font-mono font-bold tracking-wider">GHOST_MODE</span>
                </div>
                <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
                    <X size={16} />
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-3 space-y-4 scrollbar-hide">
                {relevantMessages.map((msg) => (
                    <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                        <div
                            className={`max-w-[95%] rounded-lg px-3 py-2 text-xs leading-relaxed group relative ${msg.role === 'user'
                                ? 'bg-white/5 text-gray-400'
                                : 'bg-emerald-900/20 border border-emerald-500/20 text-emerald-100'
                                }`}
                        >
                            {msg.text}

                            {/* Copy Button for Assistant responses */}
                            {msg.role === 'assistant' && (
                                <button
                                    onClick={() => handleCopy(msg.text, msg.id)}
                                    className="absolute -right-6 top-0 opacity-0 group-hover:opacity-100 transition-opacity text-gray-500 hover:text-white"
                                    title="Copy to clipboard"
                                >
                                    {copiedId === msg.id ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                                </button>
                            )}
                        </div>
                    </div>
                ))}

                {isThinking && (
                    <div className="flex items-center gap-2 text-xs text-emerald-500/50 animate-pulse px-2">
                        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                        <span>Ghost Active (Listening)...</span>
                    </div>
                )}
                <div ref={bottomRef} />
            </div>

            {/* Footer Status */}
            <div className="p-2 border-t border-white/10 bg-white/5 rounded-b-xl flex items-center justify-between text-[10px] text-gray-500">
                <span>Mic + System Audio Active</span>
                <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></span>
                    LIVE
                </span>
            </div>
        </div>
    );
};

export default StealthPanel;
