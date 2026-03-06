import React, { useState, useRef, useEffect } from 'react';
import { Send, Loader2, MessageSquareText, X } from 'lucide-react';
import { echoChatService, ChatTurn } from '../services/echoChatService';

interface TextChatBarProps {
    onApiKeyMissing: () => void;
    onNewMessage: (role: 'user' | 'assistant', text: string) => void;
    embedded?: boolean;
}

export default function TextChatBar({ onApiKeyMissing, onNewMessage, embedded = false }: TextChatBarProps) {
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<ChatTurn[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen && !embedded) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, isOpen, embedded]);

    useEffect(() => {
        if (isOpen || embedded) {
            setTimeout(() => inputRef.current?.focus(), 150);
        }
    }, [isOpen, embedded]);

    const handleSend = async () => {
        const text = input.trim();
        if (!text || isLoading) return;

        // Determine which provider and key to use
        const provider = localStorage.getItem('echo_llm_provider') || 'gemini';
        let apiKey = '';
        if (provider === 'gemini') apiKey = localStorage.getItem('echo_api_key') || '';
        else if (provider === 'openai') apiKey = localStorage.getItem('echo_openai_key') || '';
        else if (provider === 'anthropic') apiKey = localStorage.getItem('echo_anthropic_key') || '';
        else if (provider === 'groq') apiKey = localStorage.getItem('echo_groq_key') || '';
        else if (provider === 'nvidia') apiKey = localStorage.getItem('echo_nvidia_key') || '';
        else if (provider === 'openrouter') apiKey = localStorage.getItem('echo_openrouter_key') || '';
        else apiKey = localStorage.getItem('echo_api_key') || ''; // fallback

        if (!apiKey) {
            onApiKeyMissing();
            return;
        }

        setInput('');
        setError(null);
        const userTurn: ChatTurn = { role: 'user', content: text };
        setMessages(prev => [...prev, userTurn]);
        onNewMessage('user', text);
        setIsLoading(true);

        try {
            const reply = await echoChatService.sendMessage(provider, apiKey, text);
            const aiTurn: ChatTurn = { role: 'assistant', content: reply };
            setMessages(prev => [...prev, aiTurn]);
            onNewMessage('assistant', reply);
        } catch (e: any) {
            setError(e.message || 'Failed to get response');
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    if (embedded) {
        return (
            <div className="flex flex-col border-t border-white/10 bg-echo-surface/90 backdrop-blur-md p-4">
                {error && (
                    <p className="text-red-400 text-xs text-center bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-2">
                        ⚠ {error}
                    </p>
                )}
                <div className="flex items-center gap-2 bg-black/40 rounded-xl px-4 py-3 border border-white/5 focus-within:border-echo-primary/50 transition-colors">
                    <input
                        ref={inputRef}
                        type="text"
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Message Echo text AI..."
                        className="flex-1 bg-transparent text-white placeholder-gray-500 text-sm outline-none"
                        disabled={isLoading}
                    />
                    <button
                        onClick={handleSend}
                        disabled={!input.trim() || isLoading}
                        className="p-2 rounded-lg bg-[#00ff88]/15 text-[#00ff88] hover:bg-[#00ff88]/25 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                        aria-label="Send text message"
                    >
                        {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed bottom-36 left-1/2 -translate-x-1/2 z-40 w-full max-w-2xl px-4">
            {/* Chat panel — slides up when open */}
            {isOpen && (
                <div className="mb-3 bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
                    style={{ maxHeight: '55vh' }}>
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                        <div className="flex items-center gap-2">
                            <MessageSquareText size={16} className="text-[#00ff88]" />
                            <span className="text-sm font-semibold text-white/80">Chat with Echo</span>
                        </div>
                        <button
                            onClick={() => setIsOpen(false)}
                            className="text-gray-500 hover:text-white transition-colors"
                            aria-label="Close chat"
                        >
                            <X size={16} />
                        </button>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 min-h-[120px]">
                        {messages.length === 0 && (
                            <p className="text-center text-gray-600 text-sm mt-4">
                                Start a conversation with Echo
                            </p>
                        )}
                        {messages.map((msg, i) => (
                            <div
                                key={i}
                                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                            >
                                <div
                                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${msg.role === 'user'
                                        ? 'bg-[#00ff88]/15 text-white border border-[#00ff88]/20'
                                        : 'bg-white/5 text-gray-200 border border-white/8'
                                        }`}
                                >
                                    {msg.content}
                                </div>
                            </div>
                        ))}
                        {isLoading && (
                            <div className="flex justify-start">
                                <div className="bg-white/5 border border-white/8 rounded-2xl px-4 py-2.5 flex items-center gap-2">
                                    <Loader2 size={14} className="animate-spin text-[#00ff88]" />
                                    <span className="text-gray-400 text-sm">Echo is thinking…</span>
                                </div>
                            </div>
                        )}
                        {error && (
                            <p className="text-red-400 text-xs text-center bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                                ⚠ {error}
                            </p>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Divider */}
                    <div className="border-t border-white/5" />

                    {/* Input row inside panel */}
                    <div className="flex items-center gap-2 px-3 py-2.5">
                        <input
                            ref={inputRef}
                            type="text"
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Message Echo…"
                            className="flex-1 bg-transparent text-white placeholder-gray-500 text-sm outline-none"
                        />
                        <button
                            onClick={handleSend}
                            disabled={!input.trim() || isLoading}
                            className="p-2 rounded-xl bg-[#00ff88]/15 text-[#00ff88] hover:bg-[#00ff88]/25 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                            aria-label="Send message"
                        >
                            <Send size={16} />
                        </button>
                    </div>
                </div>
            )}

            {/* Pill toggle button */}
            <div className="flex justify-center">
                <button
                    onClick={() => setIsOpen(prev => !prev)}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-full border backdrop-blur-md transition-all duration-300 text-sm font-medium shadow-lg ${isOpen
                        ? 'bg-[#00ff88]/20 border-[#00ff88]/40 text-[#00ff88] shadow-[0_0_20px_rgba(0,255,136,0.15)]'
                        : 'bg-black/30 border-white/10 text-gray-400 hover:text-white hover:border-white/20'
                        }`}
                    aria-label={isOpen ? 'Close text chat' : 'Open text chat'}
                    aria-expanded={isOpen}
                >
                    <MessageSquareText size={15} />
                    <span>Text Chat</span>
                </button>
            </div>
        </div>
    );
}
