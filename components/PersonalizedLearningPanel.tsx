import React, { useState, useEffect } from 'react';
import { Brain, Download, Upload, Trash2, Lock, TrendingUp, MessageCircle, Zap, X } from 'lucide-react';
import Tooltip from './Tooltip';
import { personalizedLearning } from '../services/personalizedLearningService';

interface PersonalizedLearningPanelProps {
  onClose: () => void;
  onApplyPersonalization: (prompt: string) => void;
}

const PersonalizedLearningPanel: React.FC<PersonalizedLearningPanelProps> = ({
  onClose,
  onApplyPersonalization,
}) => {
  const [stats, setStats] = useState<any>(null);
  const [isActive, setIsActive] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = () => {
    const statistics = personalizedLearning.getStatistics();
    setStats(statistics);
  };

  const handleActivate = () => {
    const prompt = personalizedLearning.generatePersonalizedPrompt();
    onApplyPersonalization(prompt);
    setIsActive(true);
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const data = await personalizedLearning.exportData();
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `echo-personality-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const text = await file.text();
        await personalizedLearning.importData(text);
        loadStats();
      }
    };
    input.click();
  };

  const handleClear = async () => {
    if (window.confirm('Are you sure? This will delete all learned data about your communication style. This cannot be undone.')) {
      await personalizedLearning.clearAllData();
      loadStats();
      setIsActive(false);
    }
  };

  const formatPersonalityBar = (value: number, label: string) => {
    const percentage = (value / 10) * 100;
    return (
      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-[var(--text-tertiary)] uppercase tracking-wider">{label}</span>
          <span className="text-[var(--accent-green)] font-mono">{value.toFixed(1)}/10</span>
        </div>
        <div className="w-full bg-[rgba(0,255,65,0.06)] rounded-full h-2 overflow-hidden border border-[var(--border-dim)]">
          <div
            className="h-full bg-gradient-to-r from-[var(--accent-green)] to-[var(--accent-cyan)] transition-all duration-500"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="term-window h-full flex flex-col font-mono animate-phosphor-in">
      {/* Header */}
      <div className="term-titlebar">
        <span className="term-dots" />
        <span className="flex-1 font-[var(--font-term)] uppercase tracking-[0.2em] text-xs flex items-center gap-2" style={{ color: 'var(--accent-green)' }}>
          <Brain size={14} aria-hidden="true" />
          LEARNING.SYS
        </span>
        <Tooltip content="Close panel">
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-[rgba(0,255,65,0.1)] rounded transition-colors text-[var(--text-tertiary)] hover:text-[var(--accent-green)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-green)]"
            aria-label="Close panel"
          >
            <X size={18} />
          </button>
        </Tooltip>
      </div>

      <div className="p-6 pb-2">
        <p className="text-xs text-[var(--text-tertiary)]">Learns how YOU communicate</p>

        {/* Privacy Notice */}
        <div className="flex items-start gap-2 p-3 bg-[rgba(0,255,65,0.08)] border border-[var(--border-green)] rounded-lg mt-4">
          <Lock size={16} className="text-[var(--accent-green)] flex-shrink-0 mt-0.5" />
          <div className="text-xs text-[var(--text-secondary)]">
            <strong className="text-[var(--accent-green)]">100% Private:</strong> All learning happens locally on YOUR device. Nothing is sent to servers.
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 pt-2 space-y-6">
        {/* Learning Stats */}
        {stats && (
          <>
            {/* Overview */}
            <div className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2">
                <TrendingUp size={16} className="text-[var(--accent-green)]" />
                Learning Progress
              </h3>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 bg-[rgba(0,255,65,0.04)] rounded-lg border border-[var(--border-dim)]">
                  <div className="text-2xl font-bold text-[var(--accent-green)]">
                    {stats.totalPatterns}
                  </div>
                  <div className="text-xs text-[var(--text-tertiary)] mt-1 uppercase tracking-wider">Conversations Analyzed</div>
                </div>

                <div className="p-4 bg-[rgba(0,255,65,0.04)] rounded-lg border border-[var(--border-dim)]">
                  <div className="text-2xl font-bold text-[var(--accent-cyan)]">
                    {stats.uniqueWords}
                  </div>
                  <div className="text-xs text-[var(--text-tertiary)] mt-1 uppercase tracking-wider">Unique Words Learned</div>
                </div>
              </div>
            </div>

            {/* Personality Profile */}
            {stats.personalityScore && (
              <div className="space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2">
                  <MessageCircle size={16} className="text-[var(--accent-green)]" />
                  Your Communication Style
                </h3>

                <div className="p-4 bg-[rgba(0,255,65,0.04)] rounded-lg border border-[var(--border-dim)] space-y-4">
                  {formatPersonalityBar(
                    stats.personalityScore.formality,
                    'Formality (0=Casual, 10=Professional)'
                  )}
                  {formatPersonalityBar(
                    stats.personalityScore.verbosity,
                    'Detail Level (0=Brief, 10=Detailed)'
                  )}
                  {formatPersonalityBar(
                    stats.personalityScore.emotional,
                    'Expressiveness (0=Reserved, 10=Expressive)'
                  )}
                </div>
              </div>
            )}

            {/* Common Phrases */}
            {stats.commonPhrases && stats.commonPhrases.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2">
                  <Zap size={16} className="text-[var(--accent-green)]" />
                  Your Frequent Phrases
                </h3>

                <div className="flex flex-wrap gap-2">
                  {stats.commonPhrases.slice(0, 8).map((phrase: string, index: number) => (
                    <span
                      key={index}
                      className="px-3 py-1.5 bg-[rgba(0,255,65,0.08)] border border-[var(--border-green)] rounded text-xs text-[var(--accent-green)]"
                    >
                      "{phrase}"
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* No Data State */}
        {stats && stats.totalPatterns === 0 && (
          <div className="text-center py-12 space-y-4">
            <Brain size={64} className="mx-auto text-[var(--text-tertiary)] opacity-50" />
            <div>
              <p className="text-[var(--text-tertiary)] mb-2">No learning data yet</p>
              <p className="text-sm text-[var(--text-tertiary)] opacity-70">
                Start having conversations and the AI will learn your communication style automatically.
              </p>
            </div>
          </div>
        )}

        {/* How It Works */}
        <div className="p-4 bg-[rgba(87,255,176,0.06)] border border-[var(--accent-cyan)]/30 rounded-lg space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-widest text-[var(--accent-cyan)]">How It Works:</h4>
          <ul className="text-xs text-[var(--text-secondary)] space-y-1">
            <li>• AI listens to how YOU speak</li>
            <li>• Learns your vocabulary, tone, and style</li>
            <li>• Starts responding like YOU would</li>
            <li>• Everything stored locally on your device</li>
            <li>• The more you talk, the better it learns</li>
          </ul>
        </div>
      </div>

      {/* Actions */}
      <div className="p-6 border-t space-y-3" style={{ borderColor: 'var(--border-dim)' }}>
        <button
          onClick={handleActivate}
          disabled={stats && stats.totalPatterns === 0}
          className="btn-term solid w-full flex items-center justify-center gap-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Brain size={16} />
          {isActive ? '✓ Personalization Active' : 'Activate Personalized AI'}
        </button>

        <div className="grid grid-cols-3 gap-2">
          <Tooltip content="Export your learned data">
            <button
              onClick={handleExport}
              disabled={!stats || stats.totalPatterns === 0 || isExporting}
              className="btn-term ghost flex items-center justify-center gap-1.5 text-xs py-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download size={14} />
              {isExporting ? '...' : 'Export'}
            </button>
          </Tooltip>

          <Tooltip content="Import learned data">
            <button
              onClick={handleImport}
              className="btn-term ghost flex items-center justify-center gap-1.5 text-xs py-2"
            >
              <Upload size={14} />
              Import
            </button>
          </Tooltip>

          <Tooltip content="Clear all learned data">
            <button
              onClick={handleClear}
              disabled={!stats || stats.totalPatterns === 0}
              className="btn-term ghost flex items-center justify-center gap-1.5 text-xs py-2 text-[var(--accent-red)] border-[var(--accent-red)]/40 hover:border-[var(--accent-red)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trash2 size={14} />
              Clear
            </button>
          </Tooltip>
        </div>

        {isActive && (
          <p className="text-xs text-center text-[var(--text-tertiary)] italic">
            AI is now responding in your communication style
          </p>
        )}
      </div>
    </div>
  );
};

export default PersonalizedLearningPanel;
