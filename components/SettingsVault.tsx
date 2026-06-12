import React, { useState, useEffect } from 'react';
import {
    X, Lock, Key, Check, AlertTriangle, Github, Globe, Cpu, User, FileText,
    Zap, Sparkles, MessageSquare,
} from 'lucide-react';
import Button from './Button';
import { useToast } from '../hooks/useToast';
import { changePassphrase, getVaultMode } from '../services/cryptoService';
import { getCached, setCached } from '../services/cryptoService';
import { hasKeyFor, LlmProvider } from '../services/llmRouter';

interface SettingsVaultProps {
    isOpen: boolean;
    onClose: () => void;
}

interface ProviderRow {
    id: LlmProvider;
    label: string;
    storageKey: string;
    placeholder: string;
    free?: boolean;
}

const PROVIDERS: ProviderRow[] = [
    { id: 'gemini', label: 'Google Gemini', storageKey: 'echo_api_key', placeholder: 'AIzaSy...', free: true },
    { id: 'groq', label: 'Groq (free tier, OpenAI-compatible)', storageKey: 'echo_groq_key', placeholder: 'gsk_...', free: true },
    { id: 'openrouter', label: 'OpenRouter (many free models)', storageKey: 'echo_openrouter_key', placeholder: 'sk-or-...', free: true },
    { id: 'openai', label: 'OpenAI-compatible', storageKey: 'echo_openai_key', placeholder: 'sk-...' },
    { id: 'mistral', label: 'Mistral', storageKey: 'echo_mistral_key', placeholder: 'mst_...' },
    { id: 'huggingface', label: 'Hugging Face Inference', storageKey: 'echo_hf_key', placeholder: 'hf_...', free: true },
    { id: 'anthropic', label: 'Anthropic (via localhost proxy)', storageKey: 'echo_anthropic_key', placeholder: 'sk-ant-...' },
    { id: 'ollama', label: 'Local Ollama (completely offline & free)', storageKey: 'echo_ollama_model', placeholder: 'Model name (default: llama3)', free: true },
];

export default function SettingsVault({ isOpen, onClose }: SettingsVaultProps) {
    const { success, error } = useToast();

    // Existing simple keys
    const [githubToken, setGithubToken] = useState('');
    const [serpApiKey, setSerpApiKey] = useState('');
    const [avatarUrl, setAvatarUrl] = useState('');
    const [baseResume, setBaseResume] = useState('');
    const [openaiBaseUrl, setOpenaiBaseUrl] = useState('');

    // Multi-provider keys
    const [providerKeys, setProviderKeys] = useState<Record<string, string>>({});
    const [defaultBrain, setDefaultBrain] = useState<LlmProvider>('gemini');
    const [voiceEngine, setVoiceEngine] = useState<'gemini' | 'browser'>('gemini');

    // New toggles
    const [yoloMode, setYoloMode] = useState(false);
    const [translationMode, setTranslationMode] = useState(false);
    const [stealthMode, setStealthMode] = useState(false);
    const [ghostActive, setGhostActive] = useState(false);

    // Style mirroring
    const [styleExamples, setStyleExamples] = useState('');

    // Passphrase change
    const [oldPassphrase, setOldPassphrase] = useState('');
    const [newPassphrase, setNewPassphrase] = useState('');
    const [confirmPassphrase, setConfirmPassphrase] = useState('');

    useEffect(() => {
        if (!isOpen) return;
        setGithubToken(localStorage.getItem('echo_github_token') || '');
        setSerpApiKey(localStorage.getItem('VITE_SERP_API_KEY') || '');
        setAvatarUrl(localStorage.getItem('echo_avatar_url') || '/ai-avatar.png');
        setBaseResume(localStorage.getItem('echo_base_resume') || '');
        setDefaultBrain((localStorage.getItem('echo_default_brain') as LlmProvider) || 'gemini');
        setYoloMode(localStorage.getItem('echo_yolo_mode') === 'true');
        setTranslationMode(localStorage.getItem('echo_translation_mode') === 'true');
        setStealthMode(localStorage.getItem('echo_stealth_mode') === 'true');
        setGhostActive(localStorage.getItem('echo_ghost_active') === 'true');
        setOpenaiBaseUrl(localStorage.getItem('echo_openai_base') || '');
        setVoiceEngine((localStorage.getItem('echo_voice_engine') as 'gemini' | 'browser') || 'gemini');

        const pk: Record<string, string> = {};
        for (const p of PROVIDERS) {
            pk[p.id] = localStorage.getItem(p.storageKey) || '';
        }
        setProviderKeys(pk);

        const examples = getCached<string[]>('echo_style_examples', []);
        setStyleExamples(Array.isArray(examples) ? examples.join('\n\n---\n\n') : '');
    }, [isOpen]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    const handleSave = async () => {
        try {
            if (githubToken) localStorage.setItem('echo_github_token', githubToken);
            if (serpApiKey) localStorage.setItem('VITE_SERP_API_KEY', serpApiKey);
            if (avatarUrl) localStorage.setItem('echo_avatar_url', avatarUrl);
            if (baseResume) localStorage.setItem('echo_base_resume', baseResume);
            localStorage.setItem('echo_openai_base', openaiBaseUrl.trim());

            for (const p of PROVIDERS) {
                const val = providerKeys[p.id] || '';
                if (val) localStorage.setItem(p.storageKey, val);
                else localStorage.removeItem(p.storageKey);
            }

            // Back-compat with App.tsx hasAnyApiKey()
            if (providerKeys.gemini) localStorage.setItem('echo_api_key', providerKeys.gemini.trim());

            localStorage.setItem('echo_default_brain', defaultBrain);
            localStorage.setItem('echo_llm_provider', defaultBrain); // legacy alias
            localStorage.setItem('echo_yolo_mode', String(yoloMode));
            localStorage.setItem('echo_translation_mode', String(translationMode));
            localStorage.setItem('echo_stealth_mode', String(stealthMode));
            localStorage.setItem('echo_ghost_active', String(ghostActive));
            localStorage.setItem('echo_voice_engine', voiceEngine);

            const examples = styleExamples
                .split(/\n---\n|\n\n---\n\n/)
                .map(s => s.trim())
                .filter(Boolean)
                .slice(0, 5);
            setCached('echo_style_examples', examples);

            if (newPassphrase) {
                if (newPassphrase !== confirmPassphrase) {
                    error('New passphrases do not match.');
                    return;
                }
                try {
                    await changePassphrase(oldPassphrase || null, newPassphrase);
                    success('Passphrase updated.');
                } catch (e: any) {
                    error('Failed to change passphrase: ' + (e?.message || 'unknown'));
                    return;
                }
            }

            success('Settings saved securely.');
            onClose();
            window.location.reload();
        } catch (e) {
            error('Failed to save settings');
        }
    };

    const handleClear = (key: string, providerId?: LlmProvider) => {
        localStorage.removeItem(key);
        if (providerId) {
            setProviderKeys(prev => ({ ...prev, [providerId]: '' }));
        }
        if (key === 'echo_github_token') setGithubToken('');
        if (key === 'VITE_SERP_API_KEY') setSerpApiKey('');
        if (key === 'echo_openai_key') setOpenaiBaseUrl('');
        success('Key cleared');
    };

    if (!isOpen) return null;

    const vaultMode = getVaultMode();

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-black/80 backdrop-blur-xl transition-opacity" onClick={onClose} />

            <div className="relative w-full max-w-md bg-black border border-[#00ff41]/20 rounded-2xl shadow-[0_0_50px_rgba(0,0,0,1)] p-6 overflow-hidden max-h-[90dvh] overflow-y-auto scrollbar-hide font-mono text-[#00ff41]">
                <div className="absolute -top-24 -left-24 w-48 h-48 bg-[#00ff41]/10 blur-[80px] rounded-full" />

                {/* Header */}
                <div className="relative flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3 text-[#00ff41]">
                        <div className="p-2 bg-[#00ff41]/10 rounded-lg border border-[#00ff41]/20">
                            <Lock size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold font-mono tracking-wider uppercase">Vault_Secure</h2>
                            <p className="text-xs text-[#00ff41]/60 font-mono">
                                MODE: {vaultMode === 'passphrase' ? 'PASSPHRASE' : vaultMode === 'auto' ? 'QUICK (RANDOM KEY)' : 'LOCKED'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-3 hover:bg-[#00ff41]/10 rounded-full text-[#00ff41]/60 hover:text-[#00ff41] transition-colors bg-black/40 border border-[#00ff41]/20"
                    >
                        <X size={24} />
                    </button>
                </div>

                <div className="relative space-y-6">
                    <div className="bg-[#00ff41]/5 border border-[#00ff41]/20 rounded-lg p-4">
                        <div className="flex items-center gap-2 text-[#00ff41] mb-2 font-mono text-sm">
                            <AlertTriangle size={14} />
                            <span>LOCAL ONLY</span>
                        </div>
                        <p className="text-xs text-[#00ff41]/60 leading-relaxed">
                            All keys, memory and reminders are encrypted with AES-GCM 256 in your browser.
                            Set a passphrase below for stronger security than the default random-key "Quick Mode".
                        </p>
                    </div>

                    {/* Default brain */}
                    <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                            <Cpu size={16} />
                            <span>Default "Text Brain" provider</span>
                        </label>
                        <select
                            value={defaultBrain}
                            onChange={(e) => setDefaultBrain(e.target.value as LlmProvider)}
                            className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-3 pr-10 text-sm text-white focus:outline-none focus:border-green-500/50 focus:ring-1 focus:ring-green-500/50 transition-all font-mono cursor-pointer"
                            style={{ WebkitAppearance: 'none', MozAppearance: 'none', appearance: 'none' } as React.CSSProperties}
                        >
                            {PROVIDERS.map(p => (
                                <option key={p.id} value={p.id}>
                                    {p.label}{p.free ? ' (free tier available)' : ''}
                                    {hasKeyFor(p.id) ? '  ✓' : ''}
                                </option>
                            ))}
                        </select>
                        <p className="text-[10px] text-[#00ff41]/40">
                            Live voice always uses Gemini (only provider with Live audio). This setting drives text chat + tool/skill reasoning.
                        </p>
                    </div>

                    {/* Voice Engine */}
                    <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                            <Sparkles size={16} />
                            <span>Voice Streaming Engine</span>
                        </label>
                        <select
                            value={voiceEngine}
                            onChange={(e) => setVoiceEngine(e.target.value as 'gemini' | 'browser')}
                            className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-green-500/50 focus:ring-1 focus:ring-green-500/50 transition-all font-mono cursor-pointer"
                            style={{ WebkitAppearance: 'none', MozAppearance: 'none', appearance: 'none' } as React.CSSProperties}
                        >
                            <option value="gemini">Gemini Real-Time (Cloud, streams voice constantly)</option>
                            <option value="browser">Web Speech API (Free & Local Browser STT/TTS)</option>
                        </select>
                        <p className="text-[10px] text-[#00ff41]/40">
                            "Web Speech API" runs locally in your browser for free Speech-to-Text/Text-to-Speech and routes to your Default Text Brain (Groq, Ollama, etc.). Requires no Gemini API key!
                        </p>
                    </div>

                    {/* Provider key */}
                    {(() => {
                        const currentProvider = PROVIDERS.find(p => p.id === defaultBrain);
                        if (!currentProvider) return null;
                        return (
                            <div className="space-y-2 p-3 bg-white/5 border border-white/10 rounded-xl">
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-gray-300 font-semibold flex items-center gap-1.5">
                                        <Key size={14} className="text-[#00ff41]" />
                                        {defaultBrain === 'ollama' ? 'Ollama Configuration' : `${currentProvider.label} API Key`}
                                    </span>
                                    {currentProvider.free && (
                                        <span className="text-[9px] uppercase tracking-widest text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                                            free tier
                                        </span>
                                    )}
                                </div>

                                <div className="relative group">
                                    <input
                                        type={defaultBrain === 'ollama' ? 'text' : 'password'}
                                        value={providerKeys[defaultBrain] || ''}
                                        onChange={(e) => setProviderKeys(prev => ({ ...prev, [defaultBrain]: e.target.value }))}
                                        placeholder={currentProvider.placeholder}
                                        className="w-full bg-black/50 border border-white/10 rounded-lg pl-3 pr-8 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-green-500/50 transition-all font-mono"
                                    />
                                    {providerKeys[defaultBrain] && (
                                        <button
                                            onClick={() => handleClear(currentProvider.storageKey, defaultBrain)}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-red-400"
                                            type="button"
                                        >
                                            <X size={12} />
                                        </button>
                                    )}
                                </div>

                                {defaultBrain === 'openai' && (
                                    <div className="pt-1">
                                        <input
                                            type="text"
                                            value={openaiBaseUrl}
                                            onChange={(e) => setOpenaiBaseUrl(e.target.value)}
                                            placeholder="Custom Base URL (e.g. http://localhost:11434/v1)"
                                            className="w-full bg-black/30 border border-white/5 rounded-lg px-3 py-1.5 text-[10px] text-white placeholder-gray-600 focus:outline-none focus:border-green-500/30 transition-all font-mono"
                                        />
                                    </div>
                                )}

                                {defaultBrain === 'ollama' && (
                                    <p className="text-[10px] text-[#00ff41]/60 leading-relaxed mt-1">
                                        No API key needed. Runs locally on your machine. Ensure Ollama is running (`ollama run llama3`) and start the voice server (`python server.py`) to bypass CORS restrictions.
                                    </p>
                                )}
                            </div>
                        );
                    })()}

                    {/* YOLO toggle */}
                    <div className="space-y-2 p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                        <label className="flex items-center justify-between text-sm font-medium text-amber-300">
                            <span className="flex items-center gap-2">
                                <Zap size={16} /> Auto-approve new skills (YOLO)
                            </span>
                            <input
                                type="checkbox"
                                checked={yoloMode}
                                onChange={e => setYoloMode(e.target.checked)}
                                className="w-5 h-5 rounded"
                            />
                        </label>
                        <p className="text-[10px] text-amber-400/60">
                            When Echo proposes a brand-new skill at runtime, install it without asking.
                            Convenient for personal use, but skips the safety review.
                        </p>
                    </div>

                    {/* Mode toggles */}
                    <div className="space-y-2 p-3 bg-white/5 border border-white/10 rounded-xl">
                        <label className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-2 text-gray-300">
                                <Globe size={14} /> Translation mode
                            </span>
                            <input
                                type="checkbox"
                                checked={translationMode}
                                onChange={e => setTranslationMode(e.target.checked)}
                                className="w-4 h-4"
                            />
                        </label>
                        <label className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-2 text-gray-300">
                                <Sparkles size={14} /> Stealth (Ghost-listen system audio)
                            </span>
                            <input
                                type="checkbox"
                                checked={stealthMode}
                                onChange={e => setStealthMode(e.target.checked)}
                                className="w-4 h-4"
                            />
                        </label>
                        <label className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-2 text-gray-300">
                                <User size={14} /> Apply Ghost persona on connect
                            </span>
                            <input
                                type="checkbox"
                                checked={ghostActive}
                                onChange={e => setGhostActive(e.target.checked)}
                                className="w-4 h-4"
                            />
                        </label>
                    </div>

                    {/* Mobile voice */}
                    <div className="space-y-2 p-3 bg-cyan-500/5 border border-cyan-500/20 rounded-xl">
                        <p className="text-[10px] uppercase tracking-widest text-cyan-400/80">Mobile voice</p>
                        <label className="block text-xs text-gray-300">
                            Interrupt style
                            <select
                                value={(() => {
                                    try {
                                        const m = localStorage.getItem('echo_interrupt_mode');
                                        return m === 'polite' || m === 'eager' ? m : 'balanced';
                                    } catch { return 'balanced'; }
                                })()}
                                onChange={(e) => {
                                    const v = e.target.value as 'polite' | 'balanced' | 'eager';
                                    localStorage.setItem('echo_interrupt_mode', v);
                                }}
                                className="mt-1 w-full bg-black/50 border border-white/10 rounded-lg px-2 py-2 text-xs text-white"
                            >
                                <option value="polite">Polite — rarely talks over you</option>
                                <option value="balanced">Balanced</option>
                                <option value="eager">Eager — quick barge-in</option>
                            </select>
                        </label>
                        <label className="block text-xs text-gray-300 mt-2">
                            Live voice model
                            <select
                                defaultValue={localStorage.getItem('echo_live_model') || 'gemini-2.0-flash-exp'}
                                onChange={(e) => localStorage.setItem('echo_live_model', e.target.value)}
                                className="mt-1 w-full bg-black/50 border border-white/10 rounded-lg px-2 py-2 text-xs text-white font-mono"
                            >
                                <option value="gemini-2.0-flash-exp">gemini-2.0-flash-exp (default)</option>
                                <option value="gemini-2.5-flash-native-audio-preview-12-2025">gemini-2.5-flash-native-audio-preview-12-2025</option>
                                <option value="gemini-2.0-flash-live-preview-04-09">gemini-2.0-flash-live-preview-04-09</option>
                            </select>
                        </label>
                        <p className="text-[10px] text-cyan-400/50">
                            Hands-free + native app (Capacitor) required for mic while screen locked. See mobile/README.md.
                        </p>
                    </div>

                    {/* Style examples */}
                    <div className="space-y-2 p-3 bg-white/5 border border-white/10 rounded-xl">
                        <label className="flex items-center gap-2 text-sm font-medium text-[#00ff41]">
                            <MessageSquare size={14} /> Your voice — style examples
                        </label>
                        <p className="text-[10px] text-gray-500">
                            Paste 2–3 short messages in your own voice (separate them with a blank line and <code>---</code>).
                            Echo will mirror this tone in replies.
                        </p>
                        <textarea
                            value={styleExamples}
                            onChange={e => setStyleExamples(e.target.value)}
                            placeholder={"Example 1...\n\n---\n\nExample 2..."}
                            className="w-full bg-black/50 border border-white/10 rounded-lg p-2 text-xs h-28 resize-y font-mono"
                        />
                    </div>

                    {/* Passphrase change */}
                    <div className="space-y-2 p-3 bg-white/5 border border-white/10 rounded-xl">
                        <label className="flex items-center gap-2 text-sm font-medium text-[#00ff41]">
                            <Lock size={14} /> Change vault passphrase
                        </label>
                        <p className="text-[10px] text-gray-500">
                            Leave "old passphrase" empty if you've been using Quick Mode.
                        </p>
                        <input
                            type="password"
                            placeholder="Old passphrase (optional)"
                            value={oldPassphrase}
                            onChange={e => setOldPassphrase(e.target.value)}
                            className="w-full bg-black/50 border border-white/10 rounded-lg p-2 text-xs"
                        />
                        <input
                            type="password"
                            placeholder="New passphrase"
                            value={newPassphrase}
                            onChange={e => setNewPassphrase(e.target.value)}
                            className="w-full bg-black/50 border border-white/10 rounded-lg p-2 text-xs"
                        />
                        <input
                            type="password"
                            placeholder="Confirm new passphrase"
                            value={confirmPassphrase}
                            onChange={e => setConfirmPassphrase(e.target.value)}
                            className="w-full bg-black/50 border border-white/10 rounded-lg p-2 text-xs"
                        />
                    </div>

                    {/* Existing — GitHub + Serp */}
                    <div className="space-y-3">
                        <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                            <Github size={16} /> GitHub Personal Access Token
                        </label>
                        <input
                            type="password"
                            value={githubToken}
                            onChange={(e) => setGithubToken(e.target.value)}
                            placeholder="ghp_xxxxxxxxxxxx"
                            className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs"
                        />
                        <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                            <Globe size={16} /> SerpAPI Key (Web Search)
                        </label>
                        <input
                            type="password"
                            value={serpApiKey}
                            onChange={(e) => setSerpApiKey(e.target.value)}
                            placeholder="serpapi key..."
                            className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs"
                        />
                    </div>

                    {/* Avatar */}
                    <div className="space-y-2 p-4 bg-white/5 border border-white/10 rounded-xl">
                        <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                            <User size={16} /> AI Avatar URL
                        </label>
                        <input
                            type="text"
                            value={avatarUrl}
                            onChange={(e) => setAvatarUrl(e.target.value)}
                            placeholder="https://example.com/avatar.png"
                            className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs"
                        />
                    </div>

                    {/* Base Resume */}
                    <div className="space-y-2 p-4 bg-white/5 border border-white/10 rounded-xl">
                        <label className="flex items-center gap-2 text-sm font-medium text-[#00ff41]">
                            <FileText size={16} /> Career Node (Base Resume)
                        </label>
                        <p className="text-[10px] text-gray-500">
                            Plain-text or markdown. Echo's <code>tailor_resume</code> tool will read this.
                        </p>
                        <textarea
                            value={baseResume}
                            onChange={(e) => setBaseResume(e.target.value)}
                            placeholder="## Work Experience\n\n- Software Engineer at..."
                            className="w-full bg-black/50 border border-white/10 rounded-lg p-3 text-sm h-48 resize-y"
                        />
                    </div>

                    <div className="pt-4 flex gap-3">
                        <Button onClick={handleSave} variant="primary" className="w-full justify-center group">
                            <Check className="mr-2 group-hover:scale-110 transition-transform" size={18} />
                            Save & Reload
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
