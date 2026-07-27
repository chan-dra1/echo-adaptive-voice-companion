import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ChatMessage } from '../types';
import { MessageSquare, Trash2, Sparkles, X, Copy, Download, Check } from 'lucide-react';
import { clearHistory } from '../services/chatHistoryService';
import Tooltip from './Tooltip';
import Button from './Button';
import TextChatBar from './TextChatBar';

interface ChatPanelProps {
  history: ChatMessage[];
  onHistoryClear?: () => void;
  isThinking?: boolean;
  onClose: () => void;
  onApiKeyMissing?: () => void;
  onNewMessage?: (role: 'user' | 'assistant', text: string) => void;
}

const ChatPanel: React.FC<ChatPanelProps> = ({ history, onHistoryClear, isThinking, onClose, onApiKeyMissing, onNewMessage }) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, isThinking]);

  const handleClear = useCallback(() => {
    if (window.confirm("Are you sure you want to clear the conversation history? This action cannot be undone.")) {
      clearHistory();
      if (onHistoryClear) onHistoryClear();
    }
  }, [onHistoryClear]);

  const handleCopy = useCallback(async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, []);

  const handleExport = useCallback(() => {
    const exportData = history.map(msg => ({
      role: msg.role,
      text: msg.text,
      timestamp: new Date(msg.timestamp).toISOString(),
    }));

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `echo-chat-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [history]);

  return (
    <div className="term-window animate-phosphor-in h-full flex flex-col w-full sm:w-96 max-w-full rounded-none" role="region" aria-label="Chat history">
      {/* Titlebar */}
      <div className="term-titlebar">
        <span className="term-dots" aria-hidden="true" />
        <span className="text-glow-green">ECHO://SESSION</span>
        <div className="ml-auto flex items-center gap-1 tracking-normal">
          {history.length > 0 && (
            <>
              <Tooltip content="Export chat history">
                <button
                  onClick={handleExport}
                  className="p-2 rounded text-[var(--text-tertiary)] hover:text-[var(--accent-green)] hover:bg-[rgba(0,255,65,0.08)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-echo-primary"
                  aria-label="Export chat history"
                >
                  <Download size={16} />
                </button>
              </Tooltip>
              <Tooltip content="Clear all history">
                <button
                  onClick={handleClear}
                  className="p-2 rounded text-[var(--text-tertiary)] hover:text-[var(--accent-red)] hover:bg-[rgba(255,59,92,0.08)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-echo-red"
                  aria-label="Clear chat history"
                >
                  <Trash2 size={16} />
                </button>
              </Tooltip>
            </>
          )}
          <Tooltip content="Close panel">
            <button
              onClick={onClose}
              className="p-2 rounded border border-[var(--border-dim)] bg-[rgba(0,255,65,0.04)] text-[var(--text-secondary)] hover:text-[var(--accent-green)] hover:border-[var(--border-green)] hover:bg-[rgba(0,255,65,0.1)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-echo-primary"
              aria-label="Close chat panel"
            >
              <X size={18} />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Thinking status strip */}
      {isThinking && (
        <div className="flex items-center gap-1.5 px-4 py-1.5 border-b border-[var(--border-subtle)] animate-pulse" role="status" aria-live="polite">
          <Sparkles size={10} className="text-[var(--accent-cyan)]" aria-hidden="true" />
          <span className="text-[10px] text-[var(--accent-cyan)] font-mono tracking-widest uppercase">ECHO PROCESSING...</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-hide">
        {history.length === 0 ? (
          <div className="text-center text-[var(--text-tertiary)] text-sm mt-10 font-mono" role="status">
            <MessageSquare size={48} className="mx-auto mb-4 opacity-20 text-[var(--accent-green)]" />
            <p className="mb-2 tracking-widest uppercase text-[var(--text-secondary)]">&gt; SESSION LOG EMPTY</p>
            <p className="text-xs">Start a conversation by connecting and speaking.</p>
          </div>
        ) : (
          history.map((msg) => (
            <div
              key={msg.id}
              className={`group flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div className="relative">
                <div
                  className={`max-w-[85%] rounded-md px-4 py-3 text-sm leading-relaxed font-ui text-[var(--text-primary)] ${msg.role === 'user'
                    ? 'bg-[rgba(87,255,176,0.08)] border border-[rgba(87,255,176,0.3)] rounded-br-none'
                    : 'bg-[rgba(0,255,65,0.06)] border border-[var(--border-dim)] rounded-bl-none'
                    }`}
                >
                  {msg.text}
                </div>
                <Tooltip content={copiedId === msg.id ? "Copied!" : "Copy message"}>
                  <button
                    onClick={() => handleCopy(msg.text, msg.id)}
                    className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-[var(--bg-elevated)] border border-[var(--border-dim)] p-1.5 rounded hover:bg-[rgba(0,255,65,0.1)] hover:border-[var(--border-green)] focus:outline-none focus-visible:ring-2 focus-visible:ring-echo-primary"
                    aria-label={`Copy ${msg.role === 'user' ? 'your' : 'Echo\'s'} message`}
                  >
                    {copiedId === msg.id ? (
                      <Check size={14} className="text-[var(--accent-green)]" />
                    ) : (
                      <Copy size={14} className="text-[var(--text-secondary)]" />
                    )}
                  </button>
                </Tooltip>
              </div>
              <div className="flex items-center gap-1 mt-1 px-1">
                <span className={`text-[10px] font-mono tracking-widest uppercase ${msg.role === 'user' ? 'text-[var(--accent-cyan)]' : 'text-[var(--accent-green)]'}`}>
                  {msg.role === 'user' ? 'YOU>' : 'ECHO>'}
                </span>
                <span className="text-[10px] text-[var(--text-tertiary)]" aria-hidden="true">•</span>
                <time className="text-[10px] text-[var(--text-tertiary)] font-mono" dateTime={new Date(msg.timestamp).toISOString()}>
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </time>
              </div>
            </div>
          ))
        )}

        {/* Thinking Indicator Bubble */}
        {isThinking && (
          <div className="flex flex-col items-start animate-fade-in">
            <div className="bg-[rgba(0,255,65,0.06)] border border-[var(--border-dim)] rounded-md rounded-bl-none px-4 py-3">
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-[var(--accent-green)] rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                <span className="w-1.5 h-1.5 bg-[var(--accent-green)] rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                <span className="w-1.5 h-1.5 bg-[var(--accent-green)] rounded-full animate-bounce"></span>
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {onApiKeyMissing && onNewMessage && (
        <TextChatBar
          embedded
          onApiKeyMissing={onApiKeyMissing}
          onNewMessage={onNewMessage}
        />
      )}
    </div>
  );
};

export default React.memo(ChatPanel);
