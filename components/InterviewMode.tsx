import React, { useState } from 'react';
import { Ghost, User, Settings } from 'lucide-react';
import Button from './Button';
import Tooltip from './Tooltip';

interface InterviewModeProps {
  onActivate: (config: InterviewConfig) => void;
  isActive: boolean;
}

export interface InterviewConfig {
  style: 'casual' | 'professional' | 'technical';
  allowInterruptions: boolean;
  useFillerWords: boolean;
  emotionalResponses: boolean;
  conversationMemory: boolean;
}

const InterviewMode: React.FC<InterviewModeProps> = ({ onActivate, isActive }) => {
  const [config, setConfig] = useState<InterviewConfig>({
    style: 'professional',
    allowInterruptions: true,
    useFillerWords: true,
    emotionalResponses: true,
    conversationMemory: true,
  });

  const handleActivate = () => {
    onActivate(config);
  };

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Ghost size={24} className="text-echo-primary" />
        <div>
          <h3 className="text-lg font-bold text-white">Ghost Mode</h3>
          <p className="text-sm text-gray-400">Configure assistant persona and behavior</p>
        </div>
      </div>

      {/* Ghost Persona */}
      <div className="space-y-3">
        <label className="block text-sm font-semibold text-white">Assistant Persona</label>
        <div className="grid grid-cols-3 gap-2">
          {(['casual', 'professional', 'technical'] as const).map((style) => (
            <button
              key={style}
              onClick={() => setConfig({ ...config, style })}
              className={`p-3 rounded-lg text-sm font-medium transition-all ${config.style === style
                  ? 'bg-echo-primary text-white'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10'
                }`}
            >
              {style.charAt(0).toUpperCase() + style.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Conversation Features */}
      <div className="space-y-3">
        <label className="block text-sm font-semibold text-white">Conversation Features</label>

        <Tooltip content="AI will stop speaking when you interrupt, like a real person">
          <label className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors cursor-pointer">
            <span className="text-sm text-gray-200">Allow Interruptions</span>
            <input
              type="checkbox"
              checked={config.allowInterruptions}
              onChange={(e) => setConfig({ ...config, allowInterruptions: e.target.checked })}
              className="w-5 h-5 rounded bg-black/20 border-white/10 text-echo-primary focus:ring-2 focus:ring-echo-primary"
            />
          </label>
        </Tooltip>

        <Tooltip content="AI uses natural speech like 'hmm', 'ah', 'well...'">
          <label className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors cursor-pointer">
            <span className="text-sm text-gray-200">Natural Filler Words</span>
            <input
              type="checkbox"
              checked={config.useFillerWords}
              onChange={(e) => setConfig({ ...config, useFillerWords: e.target.checked })}
              className="w-5 h-5 rounded bg-black/20 border-white/10 text-echo-primary focus:ring-2 focus:ring-echo-primary"
            />
          </label>
        </Tooltip>

        <Tooltip content="AI responds with emotions: 'Wow!', 'Interesting!', etc.">
          <label className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors cursor-pointer">
            <span className="text-sm text-gray-200">Emotional Responses</span>
            <input
              type="checkbox"
              checked={config.emotionalResponses}
              onChange={(e) => setConfig({ ...config, emotionalResponses: e.target.checked })}
              className="w-5 h-5 rounded bg-black/20 border-white/10 text-echo-primary focus:ring-2 focus:ring-echo-primary"
            />
          </label>
        </Tooltip>

        <Tooltip content="AI remembers what it was saying before interruption">
          <label className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors cursor-pointer">
            <span className="text-sm text-gray-200">Conversation Memory</span>
            <input
              type="checkbox"
              checked={config.conversationMemory}
              onChange={(e) => setConfig({ ...config, conversationMemory: e.target.checked })}
              className="w-5 h-5 rounded bg-black/20 border-white/10 text-echo-primary focus:ring-2 focus:ring-echo-primary"
            />
          </label>
        </Tooltip>
      </div>

      <Button
        variant="primary"
        size="lg"
        fullWidth
        onClick={handleActivate}
        icon={isActive ? Settings : User}
      >
        {isActive ? 'Update Ghost Mode' : 'Activate Ghost Mode'}
      </Button>

      {isActive && (
        <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
          <p className="text-sm text-green-400 text-center">
            ✓ Ghost Mode Active - AI will respond naturally
          </p>
        </div>
      )}
    </div>
  );
};

export default InterviewMode;
