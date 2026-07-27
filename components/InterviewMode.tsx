import React, { useState } from 'react';
import { Ghost, User, Settings } from 'lucide-react';
import Tooltip from './Tooltip';

interface GhostModeProps {
  onActivate: (config: GhostConfig) => void;
  isActive: boolean;
}

export interface GhostConfig {
  style: 'casual' | 'professional' | 'technical';
  allowInterruptions: boolean;
  useFillerWords: boolean;
  emotionalResponses: boolean;
  conversationMemory: boolean;
}

export type InterviewConfig = GhostConfig;

const GhostMode: React.FC<GhostModeProps> = ({ onActivate, isActive }) => {
  const [config, setConfig] = useState<GhostConfig>({
    style: 'professional',
    allowInterruptions: true,
    useFillerWords: true,
    emotionalResponses: true,
    conversationMemory: true,
  });

  const handleActivate = () => {
    onActivate(config);
  };

  const features: Array<{
    key: keyof Pick<GhostConfig, 'allowInterruptions' | 'useFillerWords' | 'emotionalResponses' | 'conversationMemory'>;
    label: string;
    tooltip: string;
  }> = [
    { key: 'allowInterruptions', label: 'Allow Interruptions', tooltip: 'AI will stop speaking when you interrupt, like a real person' },
    { key: 'useFillerWords', label: 'Natural Filler Words', tooltip: "AI uses natural speech like 'hmm', 'ah', 'well...'" },
    { key: 'emotionalResponses', label: 'Emotional Responses', tooltip: "AI responds with emotions: 'Wow!', 'Interesting!', etc." },
    { key: 'conversationMemory', label: 'Conversation Memory', tooltip: 'AI remembers what it was saying before interruption' },
  ];

  return (
    <div className="term-window font-mono animate-phosphor-in">
      <div className="term-titlebar">
        <span className="term-dots" />
        <span className="flex-1 font-[var(--font-term)] uppercase tracking-[0.2em] text-xs flex items-center gap-2" style={{ color: 'var(--accent-green)' }}>
          <Ghost size={14} aria-hidden="true" />
          INTERVIEW.SIM
        </span>
      </div>

      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Ghost size={24} className="text-[var(--accent-green)]" />
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--text-primary)]">Ghost Mode</h3>
            <p className="text-xs text-[var(--text-tertiary)]">Configure assistant persona and behavior</p>
          </div>
        </div>

        {/* Ghost Persona */}
        <div className="space-y-3">
          <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Assistant Persona</label>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Assistant persona">
            {(['casual', 'professional', 'technical'] as const).map((style) => (
              <button
                key={style}
                type="button"
                role="radio"
                aria-checked={config.style === style}
                onClick={() => setConfig({ ...config, style })}
                className={`text-left p-3 rounded-lg border transition-all font-mono ${config.style === style
                  ? 'bg-[rgba(0,255,65,0.14)] border-[var(--accent-green)] text-[var(--accent-green)] shadow-[var(--glow-green-sm)]'
                  : 'bg-transparent border-[var(--border-dim)] text-[var(--text-tertiary)] hover:border-[var(--border-green)] hover:text-[var(--text-secondary)]'
                  }`}
              >
                <span className={`block text-xs font-bold uppercase tracking-wider ${config.style === style ? 'text-glow-green' : ''}`}>
                  {config.style === style ? '✓ ' : ''}{style.charAt(0).toUpperCase() + style.slice(1)}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Conversation Features */}
        <div className="space-y-3">
          <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Conversation Features</label>

          {features.map((f) => (
            <Tooltip key={f.key} content={f.tooltip}>
              <label className="flex items-center justify-between p-3 rounded-lg bg-[rgba(0,255,65,0.04)] border border-[var(--border-dim)] hover:bg-[rgba(0,255,65,0.07)] hover:border-[var(--border-green)] transition-colors cursor-pointer">
                <span className="text-xs text-[var(--text-secondary)] uppercase tracking-wider">{f.label}</span>
                <input
                  type="checkbox"
                  checked={config[f.key]}
                  onChange={(e) => setConfig({ ...config, [f.key]: e.target.checked })}
                  className="w-5 h-5 rounded bg-black/20 border-[var(--border-dim)] text-[var(--accent-green)] focus:ring-2 focus:ring-[var(--accent-green)]"
                />
              </label>
            </Tooltip>
          ))}
        </div>

        <button
          onClick={handleActivate}
          className="btn-term solid w-full flex items-center justify-center gap-2 text-sm"
        >
          {isActive ? <Settings size={16} /> : <User size={16} />}
          {isActive ? 'Update Ghost Mode' : 'Activate Ghost Mode'}
        </button>

        {isActive && (
          <div className="p-4 bg-[rgba(0,255,65,0.1)] border border-[var(--border-green)] rounded-lg">
            <p className="text-xs text-[var(--accent-green)] text-center uppercase tracking-wider">
              ✓ Ghost Mode Active — AI will respond naturally
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default GhostMode;
