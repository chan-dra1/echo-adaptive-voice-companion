import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ChatMessage } from '../types';
import { MessageSquare, Trash2, Sparkles, X, Copy, Download, Check } from 'lucide-react';
import { clearHistory } from '../services/chatHistoryService';
import Tooltip from './Tooltip';
import Button from './Button';

interface ChatPanelProps {
  history: ChatMessage[];
  onHistoryClear?: () => void;
  isThinking?: boolean;
  onClose: () => void;
}

const ChatPanel: React.FC<ChatPanelProps> = ({ history, onHistoryClear, isThinking, onClose }) => {
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
    <div className="h-full flex flex-col bg-echo-surface/90 border-r border-white/10 backdrop-blur-md w-96 max-w-full shadow-2xl" role="region" aria-label="Chat history">
      <div className="p-4 border-b border-white/10 flex items-center justify-between">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <MessageSquare size={18} className="text-echo-primary" aria-hidden="true" />
            <h2 className="text-lg font-mono font-semibold text-white">TRANSCRIPT</h2>
          </div>
          {isThinking && (
            <div className="flex items-center gap-1.5 mt-1 animate-pulse" role="status" aria-live="polite">
              <Sparkles size={10} className="text-echo-accent" aria-hidden="true" />
              <span className="text-[10px] text-echo-accent font-mono tracking-widest uppercase">ECHO PROCESSING...</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {history.length > 0 && (
            <>
              <Tooltip content="Export chat history">
                <button
                  onClick={handleExport}
                  className="text-gray-400 hover:text-white p-2 rounded-md hover:bg-white/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-echo-primary"
                  aria-label="Export chat history"
                >
                  <Download size={16} />
                </button>
              </Tooltip>
              <Tooltip content="Clear all history">
                <button
                  onClick={handleClear}
                  className="text-gray-400 hover:text-red-400 p-2 rounded-md hover:bg-white/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
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
              className="text-gray-400 hover:text-white p-2 rounded-md hover:bg-white/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              aria-label="Close chat panel"
            >
              <X size={20} />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-hide">
        {history.length === 0 ? (
          <div className="text-center text-gray-500 text-sm mt-10" role="status">
            <MessageSquare size={48} className="mx-auto mb-4 opacity-20" />
            <p className="opacity-40 mb-2">Conversation history empty.</p>
            <p className="text-xs opacity-30">Start a conversation by connecting and speaking.</p>
          </div>
        ) : (
          history.map((msg) => (
            <div
              key={msg.id}
              className={`group flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div className="relative">
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${msg.role === 'user'
                    ? 'bg-echo-primary/20 border border-echo-primary/30 text-white rounded-br-none'
                    : 'bg-white/5 border border-white/10 text-gray-200 rounded-bl-none'
                    }`}
                >
                  {msg.text}
                </div>
                <Tooltip content={copiedId === msg.id ? "Copied!" : "Copy message"}>
                  <button
                    onClick={() => handleCopy(msg.text, msg.id)}
                    className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-echo-surface border border-white/10 p-1.5 rounded-lg hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-echo-primary"
                    aria-label={`Copy ${msg.role === 'user' ? 'your' : 'Echo\'s'} message`}
                  >
                    {copiedId === msg.id ? (
                      <Check size={14} className="text-green-400" />
                    ) : (
                      <Copy size={14} className="text-gray-400" />
                    )}
                  </button>
                </Tooltip>
              </div>
              <div className="flex items-center gap-1 mt-1 px-1">
                <span className="text-[10px] text-gray-500 font-mono uppercase">
                  {msg.role === 'user' ? 'You' : 'Echo'}
                </span>
                <span className="text-[10px] text-gray-600" aria-hidden="true">•</span>
                <time className="text-[10px] text-gray-600 font-mono" dateTime={new Date(msg.timestamp).toISOString()}>
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </time>
              </div>
            </div>
          ))
        )}

        {/* Thinking Indicator Bubble */}
        {isThinking && (
          <div className="flex flex-col items-start animate-fade-in">
            <div className="bg-white/5 border border-white/10 rounded-2xl rounded-bl-none px-4 py-3">
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-echo-primary rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                <span className="w-1.5 h-1.5 bg-echo-primary rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                <span className="w-1.5 h-1.5 bg-echo-primary rounded-full animate-bounce"></span>
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
};

export default React.memo(ChatPanel);
