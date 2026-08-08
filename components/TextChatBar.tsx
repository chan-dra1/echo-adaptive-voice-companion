import React, { useState, useRef, useEffect } from 'react';
import { Send, Loader2, MessageSquareText, X } from 'lucide-react';
import { echoChatService, ChatTurn } from '../services/echoChatService';
import { chooseProvider, hasKeyFor } from '../services/llmRouter';
import { getActiveConversationId, getConversation } from '../services/conversationService';

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

    // Synchronize local messages history with parent-provided session history
    useEffect(() => {
        if (isOpen || embedded) {
            // Retrieve current conversation from the global active conversation.
            // MUST go through conversationService, not raw localStorage — the
            // 'echo_conversations' key is stored ENCRYPTED (cryptoService's
            // setCached/persist write ciphertext under an "EVG1:" prefix), so
            // a direct `JSON.parse(localStorage.getItem(...))` here reliably
            // threw "Unexpected token 'E' ... EVG1:..." and crashed the whole
            // app into the ErrorBoundary fallback for any returning user with
            // saved chat history — which looked like "Echo stopped responding"
            // even though nothing about the actual chat/voice pipeline was
            // broken; the app just never finished mounting.
            const activeId = getActiveConversationId();
            if (activeId) {
                const activeConvo = getConversation(activeId);
                if (activeConvo && Array.isArray(activeConvo.messages)) {
                    const mapped = activeConvo.messages.map((m: any) => ({
                        role: m.role === 'ai' ? 'assistant' : 'user',
                        content: m.text
                    }));
                    setMessages(mapped);
                }
            }
        }
    }, [isOpen, embedded]);

    useEffect(() => {
        if (isOpen || embedded) {
            setTimeout(() => inputRef.current?.focus(), 150);
        }
    }, [isOpen, embedded]);

    const handleSend = async () => {
        const text = input.trim();
        if (!text || isLoading) return;

        const provider = chooseProvider();
        if (!hasKeyFor(provider)) {
            onApiKeyMissing();
            return;
        }

        setInput('');
        setError(null);
        const userTurn: ChatTurn = { role: 'user', content: text };
        setMessages(prev => [...prev, userTurn]);
        onNewMessage('user', text);
        setIsLoading(true);

        // Placeholder bubble — filled in live as tokens stream in. Tool-
        // resolution hops (if any) happen silently before text starts
        // arriving here; the "thinking" indicator covers that gap.
        setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

        try {
            const reply = await echoChatService.sendMessage(provider, '', text, (delta) => {
                setMessages(prev => {
                    const next = [...prev];
                    const last = next[next.length - 1];
                    if (last?.role === 'assistant') {
                        next[next.length - 1] = { ...last, content: last.content + delta };
                    }
                    return next;
                });
            });
            // Reconcile with the resolved reply — a tool hop can produce a
            // final answer that differs from whatever streamed in earlier.
            setMessages(prev => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: reply };
                return next;
            });
            onNewMessage('assistant', reply);
        } catch (e: any) {
            setMessages(prev => prev.slice(0, -1)); // drop the empty placeholder bubble
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
            <div className="flex flex-col border-t border-[var(--border-dim)] bg-[rgba(1,7,3,0.92)] backdrop-blur-md p-4">
                {error && (
                    <p className="text-[var(--accent-red)] text-xs text-center font-mono bg-[rgba(255,59,92,0.08)] border border-[rgba(255,59,92,0.25)] rounded-md px-3 py-2 mb-2">
                        ⚠ {error}
                    </p>
                )}
                <div className="flex items-center gap-2 bg-[#010502] rounded-md px-3 py-3 border border-[var(--border-dim)] focus-within:border-[var(--border-green)] focus-within:shadow-[var(--glow-green-sm)] transition-all">
                    <span className="font-mono text-[var(--accent-green)] text-glow-green select-none text-sm" aria-hidden="true">❯</span>
                    <input
                        ref={inputRef}
                        type="text"
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Message Echo text AI..."
                        className="flex-1 bg-transparent font-mono text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] text-sm outline-none"
                        style={{ caretColor: 'var(--accent-green)' }}
                        disabled={isLoading}
                    />
                    <button
                        onClick={handleSend}
                        disabled={!input.trim() || isLoading}
                        className="p-2 rounded bg-[rgba(0,255,65,0.1)] text-[var(--accent-green)] border border-[rgba(0,255,65,0.3)] hover:bg-[rgba(0,255,65,0.18)] hover:shadow-[var(--glow-green-sm)] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                        aria-label="Send text message"
                    >
                        {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <>
            {/* Chat panel — fixed above the pill when open */}
            {isOpen && (
                <div
                    className="fixed bottom-[12.5rem] md:bottom-[15rem] left-1/2 -translate-x-1/2 z-40 w-full max-w-2xl px-4 pointer-events-auto"
                    style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
                >
                <div className="term-window animate-phosphor-in flex flex-col overflow-hidden"
                    style={{ maxHeight: '50vh' }}>
                    {/* Header */}
                    <div className="term-titlebar">
                        <span className="term-dots" aria-hidden="true" />
                        <MessageSquareText size={14} className="text-[var(--accent-green)]" aria-hidden="true" />
                        <span className="text-glow-green">ECHO://TEXT_LINK</span>
                        <button
                            onClick={() => setIsOpen(false)}
                            className="ml-auto p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--accent-green)] hover:bg-[rgba(0,255,65,0.08)] transition-colors"
                            aria-label="Close chat"
                        >
                            <X size={16} />
                        </button>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 min-h-[120px]">
                        {messages.length === 0 && (
                            <p className="text-center text-[var(--text-tertiary)] font-mono text-sm mt-4">
                                &gt; Start a conversation with Echo
                            </p>
                        )}
                        {messages.filter(msg => msg.content).map((msg, i) => (
                            <div
                                key={i}
                                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                            >
                                <div
                                    className={`max-w-[80%] rounded-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap font-ui text-[var(--text-primary)] ${msg.role === 'user'
                                        ? 'bg-[rgba(87,255,176,0.08)] border border-[rgba(87,255,176,0.3)]'
                                        : 'bg-[rgba(0,255,65,0.06)] border border-[var(--border-dim)]'
                                        }`}
                                >
                                    {msg.content}
                                </div>
                            </div>
                        ))}
                        {isLoading && !messages[messages.length - 1]?.content && (
                            <div className="flex justify-start">
                                <div className="bg-[rgba(0,255,65,0.06)] border border-[var(--border-dim)] rounded-md px-4 py-2.5 flex items-center gap-2">
                                    <Loader2 size={14} className="animate-spin text-[var(--accent-green)]" />
                                    <span className="text-[var(--text-secondary)] font-mono text-sm">Echo is thinking…</span>
                                </div>
                            </div>
                        )}
                        {error && (
                            <p className="text-[var(--accent-red)] text-xs text-center font-mono bg-[rgba(255,59,92,0.08)] border border-[rgba(255,59,92,0.25)] rounded-md px-3 py-2">
                                ⚠ {error}
                            </p>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Divider */}
                    <div className="border-t border-[var(--border-subtle)]" />

                    {/* Input row inside panel */}
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-[#010502]">
                        <span className="font-mono text-[var(--accent-green)] text-glow-green select-none text-sm" aria-hidden="true">❯</span>
                        <input
                            ref={inputRef}
                            type="text"
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Message Echo…"
                            className="flex-1 bg-transparent font-mono text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] text-sm outline-none"
                            style={{ caretColor: 'var(--accent-green)' }}
                        />
                        <button
                            onClick={handleSend}
                            disabled={!input.trim() || isLoading}
                            className="p-2 rounded bg-[rgba(0,255,65,0.1)] text-[var(--accent-green)] border border-[rgba(0,255,65,0.3)] hover:bg-[rgba(0,255,65,0.18)] hover:shadow-[var(--glow-green-sm)] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                            aria-label="Send message"
                        >
                            <Send size={16} />
                        </button>
                    </div>
                </div>
                </div>
            )}

            {/* Pill — just above the mic bar; only the button receives clicks */}
            <div className="absolute bottom-[10.5rem] md:bottom-[12.75rem] left-1/2 -translate-x-1/2 z-40 pointer-events-none">
                <button
                    onClick={() => setIsOpen(prev => !prev)}
                    className={`pointer-events-auto flex items-center gap-2 px-4 py-2 rounded border backdrop-blur-md transition-all duration-300 text-xs md:text-sm font-mono uppercase tracking-widest shadow-lg ${isOpen
                        ? 'bg-[rgba(0,255,65,0.12)] border-[rgba(0,255,65,0.45)] text-[var(--accent-green)] shadow-[var(--glow-green-sm)] text-glow-green'
                        : 'bg-[rgba(1,7,3,0.7)] border-[var(--border-dim)] text-[var(--text-secondary)] hover:text-[var(--accent-green)] hover:border-[var(--border-green)]'
                        }`}
                    aria-label={isOpen ? 'Close text chat' : 'Open text chat'}
                    aria-expanded={isOpen}
                >
                    <MessageSquareText size={15} />
                    <span>Text Chat</span>
                </button>
            </div>
        </>
    );
}
