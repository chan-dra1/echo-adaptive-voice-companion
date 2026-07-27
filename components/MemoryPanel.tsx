import React, { useCallback, useState, useEffect } from 'react';
import { MemoryItem } from '../types';
import { Trash2, Database, Plus, X, Edit2, Download, Check, Sparkles, BrainCircuit } from 'lucide-react';
import { saveMemory, deleteMemory } from '../services/memoryService';
import { summaryService } from '../services/summaryService';
import { getHistory } from '../services/chatHistoryService';
import { useToast } from '../hooks/useToast';
import Tooltip from './Tooltip';
import Button from './Button';

interface MemoryPanelProps {
  memories: MemoryItem[];
  onUpdate: () => void;
  onClose: () => void;
}

const MemoryPanel: React.FC<MemoryPanelProps> = ({ memories, onUpdate, onClose }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [activeTab, setActiveTab] = useState<'facts' | 'summaries'>('facts');
  const [summaries, setSummaries] = useState<any[]>([]);
  const { success, error, info } = useToast();

  useEffect(() => {
    loadSummaries();
  }, []);

  const loadSummaries = async () => {
    const recents = await summaryService.getRecentSummaries();
    setSummaries(recents);
  };

  const handleSummarizeNow = async () => {
    const history = getHistory();
    if (history.length < 5) {
      info("Not enough chat history to summarize yet.");
      return;
    }

    info("Analyzing conversation patterns...");
    const summary = await summaryService.summarizeSession(history);
    if (summary) {
      success("Conversation summarized and archived!");
      loadSummaries();
    } else {
      error("Failed to generate summary.");
    }
  };

  const handleDelete = useCallback((id: string) => {
    if (window.confirm('Are you sure you want to delete this memory?')) {
      deleteMemory(id);
      onUpdate();
    }
  }, [onUpdate]);

  const handleAdd = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (newKey.trim() && newValue.trim()) {
      saveMemory(newKey.trim(), newValue.trim());
      setNewKey('');
      setNewValue('');
      setIsAdding(false);
      onUpdate();
    }
  }, [newKey, newValue, onUpdate]);

  const handleEdit = useCallback((memory: MemoryItem) => {
    setEditingId(memory.id);
    setNewKey(memory.key);
    setNewValue(memory.value);
    setIsAdding(true);
    setActiveTab('facts');
  }, []);

  const handleUpdate = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (editingId && newKey.trim() && newValue.trim()) {
      deleteMemory(editingId);
      saveMemory(newKey.trim(), newValue.trim());
      setNewKey('');
      setNewValue('');
      setIsAdding(false);
      setEditingId(null);
      onUpdate();
    }
  }, [editingId, newKey, newValue, onUpdate]);

  const handleExport = useCallback(() => {
    const exportData = memories.map(mem => ({
      key: mem.key,
      value: mem.value,
      timestamp: new Date(mem.timestamp).toISOString(),
    }));

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `echo-memories-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [memories]);

  const handleCancel = useCallback(() => {
    setIsAdding(false);
    setEditingId(null);
    setNewKey('');
    setNewValue('');
  }, []);

  return (
    <div className="term-window h-full flex flex-col w-full sm:w-80 max-w-full font-mono animate-phosphor-in" role="region" aria-label="Memory panel">
      <div className="term-titlebar">
        <span className="term-dots" />
        <span className="flex-1 font-[var(--font-term)] uppercase tracking-[0.2em] text-xs flex items-center gap-2" style={{ color: 'var(--accent-green)' }}>
          <Database size={14} aria-hidden="true" />
          MEMORY_BANK.SYS
        </span>
        <Tooltip content="Close panel">
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-[rgba(0,255,65,0.1)] rounded transition-colors text-[var(--text-tertiary)] hover:text-[var(--accent-green)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-green)]"
            aria-label="Close memory panel"
          >
            <X size={18} />
          </button>
        </Tooltip>
      </div>

      <div className="px-4 pt-3 pb-2 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-dim)' }}>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('facts')}
            className={`text-[10px] px-2 py-1 rounded font-mono uppercase tracking-widest transition-colors ${activeTab === 'facts' ? 'bg-[rgba(0,255,65,0.15)] text-[var(--accent-green)] border border-[var(--border-green)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] border border-transparent'}`}
          >FACTS</button>
          <button
            onClick={() => setActiveTab('summaries')}
            className={`text-[10px] px-2 py-1 rounded font-mono uppercase tracking-widest transition-colors ${activeTab === 'summaries' ? 'bg-[rgba(0,255,65,0.15)] text-[var(--accent-green)] border border-[var(--border-green)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] border border-transparent'}`}
          >LTM</button>
        </div>

        <div className="flex items-center gap-1">
          {memories.length > 0 && activeTab === 'facts' && (
            <Tooltip content="Export memories">
              <button
                onClick={handleExport}
                className="p-2 hover:bg-[rgba(0,255,65,0.1)] rounded transition-colors text-[var(--text-tertiary)] hover:text-[var(--accent-green)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-green)]"
                aria-label="Export memories"
              >
                <Download size={16} />
              </button>
            </Tooltip>
          )}
          {activeTab === 'facts' && (
            <Tooltip content={isAdding ? "Cancel" : "Add memory"}>
              <button
                onClick={() => {
                  if (isAdding) {
                    handleCancel();
                  } else {
                    setIsAdding(true);
                  }
                }}
                className="p-2 hover:bg-[rgba(0,255,65,0.1)] rounded transition-colors text-[var(--text-tertiary)] hover:text-[var(--accent-green)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-green)]"
                aria-label={isAdding ? "Cancel adding memory" : "Add new memory"}
                aria-pressed={isAdding}
              >
                {isAdding ? <X size={20} /> : <Plus size={20} />}
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {activeTab === 'summaries' ? (
        <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
          <div className="text-center mb-4">
            <Button onClick={handleSummarizeNow} size="sm" variant="secondary" icon={Sparkles} className="w-full">
              Analyze & Summarize Session
            </Button>
            <p className="text-[10px] text-[var(--text-tertiary)] mt-2">Compresses current chat into long-term memory.</p>
          </div>

          {summaries.length === 0 ? (
            <div className="text-center text-[var(--text-tertiary)] text-xs mt-8">
              <BrainCircuit size={32} className="mx-auto mb-2 opacity-20" />
              <p className="opacity-50">No long-term memories yet.</p>
            </div>
          ) : (
            summaries.map((s) => (
              <div key={s.id} className="bg-[rgba(0,255,65,0.04)] p-3 rounded-lg border border-[var(--border-dim)] hover:border-[var(--border-green)] transition-colors">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: 'var(--accent-green)', opacity: 0.8 }}>{new Date(s.timestamp).toLocaleDateString()}</span>
                </div>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">{s.summary}</p>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
          {isAdding && (
            <form onSubmit={editingId ? handleUpdate : handleAdd} className="bg-[rgba(0,255,65,0.03)] p-3 rounded-lg border border-[var(--border-green)] space-y-2 mb-4">
              <div>
                <label htmlFor="memory-key" className="block text-[10px] text-[var(--text-tertiary)] mb-1 uppercase tracking-wider">
                  {editingId ? 'Edit Key' : 'Key'}
                </label>
                <input
                  id="memory-key"
                  type="text"
                  placeholder="e.g., 'nickname', 'favorite_food'"
                  className="w-full bg-black/20 border border-[var(--border-dim)] rounded px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus-visible:border-[var(--accent-green)] focus-visible:ring-1 focus-visible:ring-[var(--accent-green)]"
                  value={newKey}
                  onChange={e => setNewKey(e.target.value)}
                  autoFocus
                  required
                  aria-required="true"
                />
              </div>
              <div>
                <label htmlFor="memory-value" className="block text-[10px] text-[var(--text-tertiary)] mb-1 uppercase tracking-wider">
                  {editingId ? 'Edit Value' : 'Value'}
                </label>
                <textarea
                  id="memory-value"
                  placeholder="e.g., 'Alex', 'Pizza'"
                  className="w-full bg-black/20 border border-[var(--border-dim)] rounded px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus-visible:border-[var(--accent-green)] focus-visible:ring-1 focus-visible:ring-[var(--accent-green)] resize-none"
                  rows={3}
                  value={newValue}
                  onChange={e => setNewValue(e.target.value)}
                  required
                  aria-required="true"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" onClick={handleCancel} variant="ghost" size="sm">
                  Cancel
                </Button>
                <Button type="submit" variant="primary" size="sm" icon={editingId ? Check : Plus}>
                  {editingId ? 'Update' : 'Save'}
                </Button>
              </div>
            </form>
          )}

          {memories.length === 0 ? (
            <div className="text-center text-[var(--text-tertiary)] text-sm mt-10" role="status">
              <Database size={48} className="mx-auto mb-4 opacity-20" />
              <p className="mb-2 opacity-50">No memories recorded yet.</p>
              <p className="text-xs opacity-40">"Echo" will learn about you as you speak.</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsAdding(true)}
                icon={Plus}
                className="mt-4"
              >
                Add Your First Memory
              </Button>
            </div>
          ) : (
            memories.slice().reverse().map((item) => (
              <div
                key={item.id}
                className="group bg-[rgba(0,255,65,0.04)] rounded-lg p-3 hover:bg-[rgba(0,255,65,0.07)] transition-all border border-[var(--border-dim)] hover:border-[var(--border-green)]"
              >
                <div className="flex justify-between items-start mb-1">
                  <span className="text-xs font-mono uppercase tracking-wider opacity-80" style={{ color: 'var(--accent-green)' }}>
                    {item.key}
                  </span>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Tooltip content="Edit memory">
                      <button
                        onClick={() => handleEdit(item)}
                        className="text-[var(--text-tertiary)] hover:text-[var(--accent-green)] p-1 rounded hover:bg-[rgba(0,255,65,0.06)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-green)]"
                        aria-label={`Edit memory: ${item.key}`}
                      >
                        <Edit2 size={14} />
                      </button>
                    </Tooltip>
                    <Tooltip content="Delete memory">
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="text-[var(--text-tertiary)] hover:text-[var(--accent-red)] p-1 rounded hover:bg-[rgba(0,255,65,0.06)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-red)]"
                        aria-label={`Delete memory: ${item.key}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </Tooltip>
                  </div>
                </div>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-sans break-words">{item.value}</p>
                <time className="text-[10px] text-[var(--text-tertiary)] mt-2 block text-right font-mono" dateTime={new Date(item.timestamp).toISOString()}>
                  {new Date(item.timestamp).toLocaleDateString()}
                </time>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default React.memo(MemoryPanel);
