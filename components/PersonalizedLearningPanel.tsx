import React, { useState, useEffect } from 'react';
import { Brain, Download, Upload, Trash2, Lock, TrendingUp, MessageCircle, Zap } from 'lucide-react';
import Button from './Button';
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
          <span className="text-gray-400">{label}</span>
          <span className="text-echo-primary font-mono">{value.toFixed(1)}/10</span>
        </div>
        <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-echo-primary to-echo-accent transition-all duration-500"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-echo-surface/95 backdrop-blur-xl border-l border-white/10 shadow-2xl">
      {/* Header */}
      <div className="p-6 border-b border-white/10">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-echo-primary/20 to-echo-accent/20 rounded-xl flex items-center justify-center">
              <Brain size={20} className="text-echo-primary" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Personal AI Learning</h2>
              <p className="text-xs text-gray-400">Learns how YOU communicate</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-2 rounded-lg hover:bg-white/5 transition-colors"
            aria-label="Close panel"
          >
            <Trash2 size={20} />
          </button>
        </div>

        {/* Privacy Notice */}
        <div className="flex items-start gap-2 p-3 bg-green-500/10 border border-green-500/30 rounded-lg mt-4">
          <Lock size={16} className="text-green-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-green-200">
            <strong>100% Private:</strong> All learning happens locally on YOUR device. Nothing is sent to servers.
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Learning Stats */}
        {stats && (
          <>
            {/* Overview */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <TrendingUp size={16} className="text-echo-primary" />
                Learning Progress
              </h3>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 bg-white/5 rounded-lg border border-white/10">
                  <div className="text-2xl font-bold text-echo-primary">
                    {stats.totalPatterns}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">Conversations Analyzed</div>
                </div>

                <div className="p-4 bg-white/5 rounded-lg border border-white/10">
                  <div className="text-2xl font-bold text-echo-accent">
                    {stats.uniqueWords}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">Unique Words Learned</div>
                </div>
              </div>
            </div>

            {/* Personality Profile */}
            {stats.personalityScore && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <MessageCircle size={16} className="text-echo-primary" />
                  Your Communication Style
                </h3>

                <div className="p-4 bg-white/5 rounded-lg border border-white/10 space-y-4">
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
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Zap size={16} className="text-echo-primary" />
                  Your Frequent Phrases
                </h3>

                <div className="flex flex-wrap gap-2">
                  {stats.commonPhrases.slice(0, 8).map((phrase: string, index: number) => (
                    <span
                      key={index}
                      className="px-3 py-1.5 bg-echo-primary/10 border border-echo-primary/30 rounded-full text-xs text-echo-primary"
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
            <Brain size={64} className="mx-auto text-gray-600 opacity-50" />
            <div>
              <p className="text-gray-400 mb-2">No learning data yet</p>
              <p className="text-sm text-gray-500">
                Start having conversations and the AI will learn your communication style automatically.
              </p>
            </div>
          </div>
        )}

        {/* How It Works */}
        <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg space-y-2">
          <h4 className="text-sm font-semibold text-blue-300">How It Works:</h4>
          <ul className="text-xs text-blue-200 space-y-1">
            <li>• AI listens to how YOU speak</li>
            <li>• Learns your vocabulary, tone, and style</li>
            <li>• Starts responding like YOU would</li>
            <li>• Everything stored locally on your device</li>
            <li>• The more you talk, the better it learns</li>
          </ul>
        </div>
      </div>

      {/* Actions */}
      <div className="p-6 border-t border-white/10 space-y-3">
        <Button
          variant={isActive ? 'success' : 'primary'}
          size="lg"
          fullWidth
          onClick={handleActivate}
          icon={Brain}
          disabled={stats && stats.totalPatterns === 0}
        >
          {isActive ? '✓ Personalization Active' : 'Activate Personalized AI'}
        </Button>

        <div className="grid grid-cols-3 gap-2">
          <Tooltip content="Export your learned data">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleExport}
              icon={Download}
              loading={isExporting}
              disabled={!stats || stats.totalPatterns === 0}
            >
              Export
            </Button>
          </Tooltip>

          <Tooltip content="Import learned data">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleImport}
              icon={Upload}
            >
              Import
            </Button>
          </Tooltip>

          <Tooltip content="Clear all learned data">
            <Button
              variant="danger"
              size="sm"
              onClick={handleClear}
              icon={Trash2}
              disabled={!stats || stats.totalPatterns === 0}
            >
              Clear
            </Button>
          </Tooltip>
        </div>

        {isActive && (
          <p className="text-xs text-center text-gray-500 italic">
            AI is now responding in your communication style
          </p>
        )}
      </div>
    </div>
  );
};

export default PersonalizedLearningPanel;
