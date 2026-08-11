import React, { useState, useEffect } from 'react';
import {
    X, Lock, Key, Check, AlertTriangle, Github, Globe, Cpu, User, FileText,
    Zap, Sparkles, MessageSquare, SlidersHorizontal, Keyboard, ShieldCheck,
    ShieldAlert, RefreshCw,
} from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { changePassphrase, getVaultMode } from '../services/cryptoService';
import { getCached, setCached } from '../services/cryptoService';
import { hasKeyFor, chooseProvider, LlmProvider, detectProviderFromKey } from '../services/llmRouter';
import { getUiMode, setUiMode, UiMode } from '../services/uiModeService';
import { echoCloudAuthService } from '../services/echoCloudAuthService';
import { LIVE_MODEL_OPTIONS, getLiveModelName, setLiveModelName } from '../constants';
import { Cloud } from 'lucide-react';
import { desktopAutomationService, HotkeyAccelerators } from '../services/desktopAutomationService';

interface SettingsVaultProps {
    isOpen: boolean;
    onClose: () => void;
    onSaved?: () => void;
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
];

const DEFAULT_HOTKEYS: HotkeyAccelerators = {
    dictation: 'CommandOrControl+Shift+D',
    selectionRead: 'CommandOrControl+Shift+R',
};

/** Converts a captured keydown into an Electron accelerator string (e.g.
 *  "CommandOrControl+Shift+D"). Returns null while only modifier keys have
 *  been pressed so far — the recorder keeps listening until a real key
 *  arrives alongside at least one modifier (a bare unmodified key as a
 *  global hotkey would swallow every ordinary keystroke system-wide). */
function formatAccelerator(e: KeyboardEvent): string | null {
    if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) return null;
    const parts: string[] = [];
    if (e.metaKey || e.ctrlKey) parts.push('CommandOrControl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');
    if (parts.length === 0) return null;

    const specialKeys: Record<string, string> = {
        ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc',
    };
    const key = e.key.length === 1 ? e.key.toUpperCase() : (specialKeys[e.key] || e.key);
    parts.push(key);
    return parts.join('+');
}

function HotkeyRecorder({
    label, value, onChange, errorText,
}: {
    label: string;
    value: string;
    onChange: (accelerator: string) => void;
    errorText?: string | null;
}) {
    const [recording, setRecording] = useState(false);

    useEffect(() => {
        if (!recording) return;
        const handler = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.key === 'Escape') { setRecording(false); return; } // cancel, keep the existing binding
            const accelerator = formatAccelerator(e);
            if (!accelerator) return; // still just modifiers — keep listening
            setRecording(false);
            onChange(accelerator);
        };
        // Capture phase — this must win over any other key handler in the
        // app (e.g. the Escape-closes-settings listener) while recording.
        window.addEventListener('keydown', handler, true);
        return () => window.removeEventListener('keydown', handler, true);
    }, [recording, onChange]);

    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-secondary)]">{label}</span>
                <button
                    type="button"
                    onClick={() => setRecording(true)}
                    className={`font-mono text-[11px] px-2.5 py-1 rounded border transition-colors ${recording
                        ? 'border-[var(--accent-amber)] text-[var(--accent-amber)] animate-pulse'
                        : 'border-[var(--border-dim)] text-[var(--text-primary)] hover:border-[var(--border-green)]'
                        }`}
                >
                    {recording ? 'Press keys…' : value}
                </button>
            </div>
            {errorText && (
                <div className="text-[10px] text-[var(--accent-red)] flex items-center gap-1 font-mono">
                    <AlertTriangle size={10} />
                    <span>{errorText}</span>
                </div>
            )}
        </div>
    );
}

/* ── Terminal styling primitives (styling only) ─────────────────── */

const SECTION_CLS = 'space-y-2 p-3 bg-[rgba(0,255,65,0.04)] border border-[var(--border-dim)] rounded-lg';
const INPUT_CLS = 'sv-input w-full rounded-lg text-xs px-3 py-2';

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
    return (
        <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">
            <span className="text-[var(--accent-green)]">{icon}</span>
            <span><span className="text-[var(--accent-green)] opacity-70">&gt; </span>{children}</span>
        </span>
    );
}

export default function SettingsVault({ isOpen, onClose, onSaved }: SettingsVaultProps) {
    const { success, error } = useToast();

    // Existing simple keys
    const [githubToken, setGithubToken] = useState('');
    const [serpApiKey, setSerpApiKey] = useState('');
    const [baseResume, setBaseResume] = useState('');

    // Multi-provider keys
    const [providerKeys, setProviderKeys] = useState<Record<string, string>>({});
    const [defaultBrain, setDefaultBrain] = useState<LlmProvider>('gemini');

    // Interface mode (applies immediately, independent of the Save button)
    const [uiMode, setUiModeState] = useState<UiMode>('simple');

    // Echo Cloud (Stage 1) — sign-in state applies immediately, no Save needed.
    const [cloudEmail, setCloudEmail] = useState('');
    const [cloudSending, setCloudSending] = useState(false);
    const [cloudMessage, setCloudMessage] = useState<{ ok: boolean; text: string } | null>(null);
    const [cloudSignedIn, setCloudSignedIn] = useState(false);
    const [cloudUserEmail, setCloudUserEmail] = useState<string | null>(null);

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

    // System-wide dictation + selection-read (Electron desktop only).
    // Hotkeys apply immediately on change (like UI mode / Echo Cloud
    // sign-in above) — a global hotkey needs an immediate main-process
    // round-trip regardless, so gating it behind the page's "Save & Apply"
    // button would just mean a stale registration until Save is clicked.
    const isDesktop = desktopAutomationService.isElectronDesktop();
    const [hotkeys, setHotkeys] = useState<HotkeyAccelerators>(DEFAULT_HOTKEYS);
    const [hotkeyErrors, setHotkeyErrors] = useState<{ dictation?: string; selectionRead?: string }>({});
    const [accessibilityGranted, setAccessibilityGranted] = useState<boolean | null>(null);
    const [accessibilityChecking, setAccessibilityChecking] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setGithubToken(localStorage.getItem('echo_github_token') || '');
        setSerpApiKey(localStorage.getItem('VITE_SERP_API_KEY') || '');
        setBaseResume(localStorage.getItem('echo_base_resume') || '');
        setUiModeState(getUiMode());
        const savedBrain = (localStorage.getItem('echo_default_brain') as LlmProvider) || 'gemini';
        setDefaultBrain(hasKeyFor(savedBrain) ? savedBrain : chooseProvider());
        setYoloMode(localStorage.getItem('echo_yolo_mode') === 'true');
        setTranslationMode(localStorage.getItem('echo_translation_mode') === 'true');
        setStealthMode(localStorage.getItem('echo_stealth_mode') === 'true');
        setGhostActive(localStorage.getItem('echo_ghost_active') === 'true');

        const pk: Record<string, string> = {};
        for (const p of PROVIDERS) {
            pk[p.id] = localStorage.getItem(p.storageKey) || '';
        }
        setProviderKeys(pk);

        const examples = getCached<string[]>('echo_style_examples', []);
        setStyleExamples(Array.isArray(examples) ? examples.join('\n\n---\n\n') : '');

        if (isDesktop) {
            const savedHotkeys = getCached<HotkeyAccelerators>('echo_hotkey_config', DEFAULT_HOTKEYS);
            setHotkeys(savedHotkeys && savedHotkeys.dictation && savedHotkeys.selectionRead ? savedHotkeys : DEFAULT_HOTKEYS);
            setHotkeyErrors({});
            setAccessibilityChecking(true);
            desktopAutomationService.getAccessibilityStatus()
                .then(s => setAccessibilityGranted(s.granted))
                .finally(() => setAccessibilityChecking(false));
        }
    }, [isOpen, isDesktop]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    useEffect(() => {
        const sync = () => {
            setCloudSignedIn(echoCloudAuthService.isSignedIn());
            setCloudUserEmail(echoCloudAuthService.getCurrentEmail());
        };
        sync();
        return echoCloudAuthService.onChange(sync);
    }, []);

    const handleCloudSignIn = async () => {
        setCloudSending(true);
        setCloudMessage(null);
        const result = await echoCloudAuthService.sendMagicLink(cloudEmail);
        setCloudMessage({ ok: result.ok, text: result.message });
        setCloudSending(false);
    };

    const handleCloudSignOut = async () => {
        await echoCloudAuthService.signOut();
        setCloudMessage(null);
        setCloudEmail('');
    };

    const handleSave = async () => {
        try {
            if (githubToken) localStorage.setItem('echo_github_token', githubToken);
            if (serpApiKey) localStorage.setItem('VITE_SERP_API_KEY', serpApiKey);
            if (baseResume) localStorage.setItem('echo_base_resume', baseResume);

            for (const p of PROVIDERS) {
                const val = providerKeys[p.id] || '';
                if (val) localStorage.setItem(p.storageKey, val);
                else localStorage.removeItem(p.storageKey);
            }

            // Back-compat with App.tsx hasAnyApiKey()
            if (providerKeys.gemini) localStorage.setItem('echo_api_key', providerKeys.gemini.trim());

            const brainToSave = hasKeyFor(defaultBrain) ? defaultBrain : chooseProvider();
            localStorage.setItem('echo_default_brain', brainToSave);
            localStorage.setItem('echo_llm_provider', brainToSave); // legacy alias
            localStorage.setItem('echo_yolo_mode', String(yoloMode));
            localStorage.setItem('echo_translation_mode', String(translationMode));
            localStorage.setItem('echo_stealth_mode', String(stealthMode));
            localStorage.setItem('echo_ghost_active', String(ghostActive));

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
            onSaved?.();
            onClose();
        } catch (e) {
            error('Failed to save settings');
        }
    };

    const handleUiModeChange = (mode: UiMode) => {
        setUiModeState(mode);
        setUiMode(mode); // persists + notifies App immediately — no Save needed
    };

    const handleClear = (key: string, providerId?: LlmProvider) => {
        localStorage.removeItem(key);
        if (providerId) {
            setProviderKeys(prev => ({ ...prev, [providerId]: '' }));
        }
        if (key === 'echo_github_token') setGithubToken('');
        if (key === 'VITE_SERP_API_KEY') setSerpApiKey('');
        success('Key cleared');
    };

    const handleHotkeyChange = async (which: 'dictation' | 'selectionRead', accelerator: string) => {
        const next = { ...hotkeys, [which]: accelerator };
        const result = await desktopAutomationService.registerHotkeys(next);
        if (!result[which]) {
            // Don't persist or apply a binding the OS rejected (e.g. already
            // claimed by another app) — keep the previous working value.
            setHotkeyErrors(prev => ({ ...prev, [which]: 'Could not register — already in use by another app?' }));
            return;
        }
        setHotkeyErrors(prev => ({ ...prev, [which]: undefined }));
        setHotkeys(next);
        setCached('echo_hotkey_config', next);
        success(`${which === 'dictation' ? 'Dictation' : 'Selection-read'} hotkey updated.`);
    };

    const handleGrantAccessibility = async () => {
        const result = await desktopAutomationService.requestAccessibilityPermission();
        setAccessibilityGranted(result.granted);
        if (result.granted) {
            success('Accessibility permission granted.');
        } else {
            error('Not granted yet — check System Settings, then try again.');
        }
    };

    if (!isOpen) return null;

    const vaultMode = getVaultMode();

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <style>{`
                .sv-input {
                    font-family: var(--font-term);
                    background: rgba(0, 255, 65, 0.03);
                    border: 1px solid var(--border-dim);
                    color: var(--text-primary);
                    caret-color: var(--accent-green);
                    outline: none;
                    transition: border-color 0.15s ease, box-shadow 0.15s ease;
                }
                .sv-input::placeholder { color: var(--text-tertiary); }
                .sv-input:focus {
                    border-color: var(--accent-green);
                    box-shadow: var(--glow-green-sm);
                }
                .sv-check { accent-color: var(--accent-green); }
            `}</style>
            <div className="fixed inset-0 bg-black/80 backdrop-blur-xl transition-opacity" onClick={onClose} />

            <div className="relative w-full max-w-md term-window animate-phosphor-in max-h-[90dvh] flex flex-col">
                {/* Titlebar */}
                <div className="term-titlebar justify-between shrink-0 relative z-10">
                    <div className="flex items-center gap-3 min-w-0">
                        <span className="term-dots" />
                        <span className="truncate">ECHO://SETTINGS — VAULT_SECURE</span>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded border border-[var(--border-dim)] bg-[rgba(0,255,65,0.04)] text-[var(--text-tertiary)] hover:text-[var(--accent-green)] hover:border-[var(--border-green)] transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className="relative z-10 overflow-y-auto scrollbar-hide p-5 space-y-5 font-mono">
                    {/* Vault mode status line */}
                    <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-[var(--text-tertiary)]">
                        <span className="text-[var(--accent-green)]">[OK]</span>{' '}
                        MODE: {vaultMode === 'passphrase' ? 'PASSPHRASE' : vaultMode === 'auto' ? 'QUICK (RANDOM KEY)' : 'LOCKED'}
                    </p>

                    <div className={SECTION_CLS}>
                        <div className="flex items-center gap-2 mb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--accent-green)] text-glow-green">
                            <AlertTriangle size={14} className="text-[var(--accent-green)]" />
                            <span>&gt; LOCAL ONLY</span>
                        </div>
                        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                            All keys, memory and reminders are encrypted with AES-GCM 256 in your browser.
                            Set a passphrase below for stronger security than the default random-key "Quick Mode".
                        </p>
                    </div>

                    {/* Interface mode */}
                    <div className={SECTION_CLS}>
                        <label>
                            <SectionTitle icon={<SlidersHorizontal size={14} />}>Interface</SectionTitle>
                        </label>
                        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Interface mode">
                            {([
                                { mode: 'simple' as UiMode, title: 'Simple', desc: 'the essentials: voice, chat, memory' },
                                { mode: 'advanced' as UiMode, title: 'Advanced', desc: 'missions, automations, skill vault, developer tools' },
                            ]).map(opt => (
                                <button
                                    key={opt.mode}
                                    type="button"
                                    role="radio"
                                    aria-checked={uiMode === opt.mode}
                                    onClick={() => handleUiModeChange(opt.mode)}
                                    className={`text-left p-3 rounded-lg border transition-all font-mono ${
                                        uiMode === opt.mode
                                            ? 'bg-[rgba(0,255,65,0.14)] border-[var(--accent-green)] text-[var(--accent-green)] shadow-[var(--glow-green-sm)]'
                                            : 'bg-transparent border-[var(--border-dim)] text-[var(--text-tertiary)] hover:border-[var(--border-green)] hover:text-[var(--text-secondary)]'
                                    }`}
                                >
                                    <span className={`block text-xs font-bold uppercase tracking-wider ${uiMode === opt.mode ? 'text-glow-green' : ''}`}>
                                        {uiMode === opt.mode ? '✓ ' : ''}{opt.title}
                                    </span>
                                    <span className={`block text-[10px] mt-1 leading-snug ${uiMode === opt.mode ? 'text-[var(--text-secondary)]' : 'text-[var(--text-tertiary)]'}`}>
                                        {opt.desc}
                                    </span>
                                </button>
                            ))}
                        </div>
                        <p className="text-[10px] text-[var(--text-tertiary)]">
                            Applies instantly — no save needed. You can switch back any time.
                        </p>
                    </div>

                    {/* Echo Cloud (Stage 1) */}
                    {echoCloudAuthService.isConfigured() && (
                        <div className={SECTION_CLS}>
                            <SectionTitle icon={<Cloud size={14} />}>Echo Cloud (beta)</SectionTitle>
                            {cloudSignedIn ? (
                                <div className="space-y-2">
                                    <p className="text-xs text-[var(--text-secondary)]">
                                        Signed in as <span className="text-[var(--accent-green)]">{cloudUserEmail}</span>. No key needed — a limited number of free Cloud messages/day, no setup.
                                    </p>
                                    <button
                                        onClick={handleCloudSignOut}
                                        className="btn-term ghost text-[11px] px-3 py-1.5"
                                    >
                                        Sign out
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <p className="text-[10px] text-[var(--text-tertiary)]">
                                        No API key required — sign in with your email for a small number of free messages/day on us.
                                    </p>
                                    <div className="flex gap-2">
                                        <input
                                            type="email"
                                            value={cloudEmail}
                                            onChange={(e) => setCloudEmail(e.target.value)}
                                            placeholder="you@example.com"
                                            className={INPUT_CLS + ' flex-1'}
                                            disabled={cloudSending}
                                        />
                                        <button
                                            onClick={handleCloudSignIn}
                                            disabled={cloudSending || !cloudEmail.trim()}
                                            className="btn-term text-[11px] px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            {cloudSending ? 'Sending…' : 'Send link'}
                                        </button>
                                    </div>
                                    {cloudMessage && (
                                        <p className={`text-[10px] ${cloudMessage.ok ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
                                            {cloudMessage.ok ? '[OK] ' : '[ERR] '}{cloudMessage.text}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Default brain */}
                    <div className="space-y-2">
                        <label>
                            <SectionTitle icon={<Cpu size={14} />}>Default "Text Brain" provider</SectionTitle>
                        </label>
                        <select
                            value={defaultBrain}
                            onChange={(e) => setDefaultBrain(e.target.value as LlmProvider)}
                            className="sv-input w-full rounded-lg px-4 py-3 pr-10 text-sm cursor-pointer"
                            style={{ WebkitAppearance: 'none', MozAppearance: 'none', appearance: 'none' } as React.CSSProperties}
                        >
                            {cloudSignedIn && (
                                <option value="echoCloud">Echo Cloud (beta, no key needed)  ✓</option>
                            )}
                            {PROVIDERS.map(p => (
                                <option key={p.id} value={p.id}>
                                    {p.label}{p.free ? ' (free tier available)' : ''}
                                    {hasKeyFor(p.id) ? '  ✓' : ''}
                                </option>
                            ))}
                        </select>
                        <p className="text-[10px] text-[var(--text-tertiary)]">
                            Live voice always uses Gemini (only provider with Live audio). This setting drives text chat + tool/skill reasoning.
                        </p>
                    </div>

                    {/* Provider keys */}
                    <div className="space-y-3">
                        <label>
                            <SectionTitle icon={<Key size={14} />}>Provider API Keys</SectionTitle>
                        </label>
                        {PROVIDERS.map(p => (
                            <div key={p.id} className="space-y-1">
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-[var(--text-secondary)]">{p.label}</span>
                                    {p.free && (
                                        <span className="text-[9px] uppercase tracking-widest text-[var(--accent-green)] border border-[var(--border-green)] px-1.5 py-0.5 rounded">
                                            free tier
                                        </span>
                                    )}
                                </div>
                                <div className="relative group">
                                    <input
                                        type="password"
                                        value={providerKeys[p.id] || ''}
                                        onChange={(e) => setProviderKeys(prev => ({ ...prev, [p.id]: e.target.value }))}
                                        placeholder={p.placeholder}
                                        className="sv-input w-full rounded-lg pl-3 pr-8 py-2 text-xs"
                                    />
                                    {providerKeys[p.id] && (
                                        <button
                                            onClick={() => handleClear(p.storageKey, p.id)}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--accent-red)]"
                                            type="button"
                                        >
                                            <X size={12} />
                                        </button>
                                    )}
                                </div>
                                {(() => {
                                    const keyVal = providerKeys[p.id] || '';
                                    if (!keyVal) return null;
                                    const detected = detectProviderFromKey(keyVal);
                                    if (detected && detected !== p.id) {
                                        return (
                                            <div className="text-[10px] text-[var(--accent-red)] mt-0.5 flex items-center gap-1 font-mono">
                                                <AlertTriangle size={10} />
                                                <span>[ERR] Format matches {PROVIDERS.find(pr => pr.id === detected)?.label || detected} key!</span>
                                            </div>
                                        );
                                    }
                                    if (p.id === 'gemini' && !keyVal.startsWith('AIzaSy') && !keyVal.startsWith('AQ.')) {
                                        return (
                                            <div className="text-[10px] text-[var(--accent-amber)] mt-0.5 flex items-center gap-1 font-mono">
                                                <AlertTriangle size={10} />
                                                <span>[WARN] Should start with AIzaSy or AQ.</span>
                                            </div>
                                        );
                                    }
                                    if (p.id === 'openai' && !keyVal.startsWith('sk-')) {
                                        return (
                                            <div className="text-[10px] text-[var(--accent-amber)] mt-0.5 flex items-center gap-1 font-mono">
                                                <AlertTriangle size={10} />
                                                <span>[WARN] Should start with sk-</span>
                                            </div>
                                        );
                                    }
                                    return null;
                                })()}
                            </div>
                        ))}
                    </div>

                    {/* System-wide dictation + selection-read (Electron desktop only) */}
                    {isDesktop && (
                        <div className={SECTION_CLS}>
                            <label>
                                <SectionTitle icon={<Keyboard size={14} />}>System-Wide Dictation</SectionTitle>
                            </label>
                            <p className="text-[10px] text-[var(--text-tertiary)]">
                                Global hotkeys work even when Echo isn't focused — dictate into any app, or grab
                                whatever's selected elsewhere and send it to Echo as context.
                            </p>

                            <HotkeyRecorder
                                label="Dictation (start/stop)"
                                value={hotkeys.dictation}
                                onChange={(accel) => void handleHotkeyChange('dictation', accel)}
                                errorText={hotkeyErrors.dictation}
                            />
                            <HotkeyRecorder
                                label="Read Selection"
                                value={hotkeys.selectionRead}
                                onChange={(accel) => void handleHotkeyChange('selectionRead', accel)}
                                errorText={hotkeyErrors.selectionRead}
                            />

                            <div className="pt-2 mt-1 border-t border-[var(--border-subtle)] space-y-2">
                                {accessibilityChecking ? (
                                    <p className="text-[11px] text-[var(--text-tertiary)] font-mono">Checking Accessibility permission…</p>
                                ) : accessibilityGranted ? (
                                    <p className="text-[11px] font-mono flex items-center gap-1.5 text-[var(--accent-green)]">
                                        <ShieldCheck size={12} /> Accessibility permission granted
                                    </p>
                                ) : (
                                    <div className="space-y-1.5">
                                        <p className="text-[11px] font-mono flex items-center gap-1.5 text-[var(--accent-amber)]">
                                            <ShieldAlert size={12} /> Accessibility permission not granted
                                        </p>
                                        <p className="text-[10px] text-[var(--text-tertiary)] leading-relaxed">
                                            Required for typing/reading selections in other apps. macOS may need Echo
                                            restarted after you grant it in System Settings.
                                        </p>
                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                onClick={() => void handleGrantAccessibility()}
                                                className="btn-term ghost text-[11px] px-3 py-1.5"
                                            >
                                                Grant Permission
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => desktopAutomationService.openAccessibilitySettings()}
                                                className="btn-term ghost text-[11px] px-3 py-1.5"
                                            >
                                                Open System Settings
                                            </button>
                                        </div>
                                    </div>
                                )}
                                <button
                                    type="button"
                                    onClick={() => desktopAutomationService.relaunchApp()}
                                    className="flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)] hover:text-[var(--accent-green)] transition-colors font-mono"
                                >
                                    <RefreshCw size={11} /> Restart Echo
                                </button>
                            </div>
                        </div>
                    )}

                    {/* YOLO toggle — warning amber */}
                    <div className="space-y-2 p-3 bg-[rgba(255,179,0,0.05)] border border-[rgba(255,179,0,0.25)] rounded-lg">
                        <label className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--accent-amber)]">
                            <span className="flex items-center gap-2">
                                <Zap size={14} /> <span>&gt; Auto-approve new skills (YOLO)</span>
                            </span>
                            <input
                                type="checkbox"
                                checked={yoloMode}
                                onChange={e => setYoloMode(e.target.checked)}
                                className="w-5 h-5 rounded"
                                style={{ accentColor: 'var(--accent-amber)' }}
                            />
                        </label>
                        <p className="text-[10px] text-[rgba(255,179,0,0.6)]">
                            When Echo proposes a brand-new skill at runtime, install it without asking.
                            Convenient for personal use, but skips the safety review.
                        </p>
                    </div>

                    {/* Mode toggles */}
                    <div className={SECTION_CLS}>
                        <label className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-2 text-[var(--text-secondary)]">
                                <Globe size={14} className="text-[var(--accent-green)]" /> Translation mode
                            </span>
                            <input
                                type="checkbox"
                                checked={translationMode}
                                onChange={e => setTranslationMode(e.target.checked)}
                                className="sv-check w-4 h-4"
                            />
                        </label>
                        <label className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-2 text-[var(--text-secondary)]">
                                <Sparkles size={14} className="text-[var(--accent-green)]" /> Stealth (Ghost-listen system audio)
                            </span>
                            <input
                                type="checkbox"
                                checked={stealthMode}
                                onChange={e => setStealthMode(e.target.checked)}
                                className="sv-check w-4 h-4"
                            />
                        </label>
                        <label className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-2 text-[var(--text-secondary)]">
                                <User size={14} className="text-[var(--accent-green)]" /> Apply Ghost persona on connect
                            </span>
                            <input
                                type="checkbox"
                                checked={ghostActive}
                                onChange={e => setGhostActive(e.target.checked)}
                                className="sv-check w-4 h-4"
                            />
                        </label>
                    </div>

                    {/* Mobile voice */}
                    <div className={SECTION_CLS}>
                        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--accent-cyan)]">
                            <span className="opacity-70">&gt; </span>Mobile voice
                        </p>
                        <label className="block text-xs text-[var(--text-secondary)]">
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
                                className="sv-input mt-1 w-full rounded-lg px-2 py-2 text-xs"
                            >
                                <option value="polite">Polite — rarely talks over you</option>
                                <option value="balanced">Balanced</option>
                                <option value="eager">Eager — quick barge-in</option>
                            </select>
                        </label>
                        <label className="block text-xs text-[var(--text-secondary)] mt-2">
                            Live voice model
                            <select
                                defaultValue={getLiveModelName()}
                                onChange={(e) => setLiveModelName(e.target.value)}
                                className="sv-input mt-1 w-full rounded-lg px-2 py-2 text-xs"
                            >
                                {LIVE_MODEL_OPTIONS.map((m) => (
                                    <option key={m.id} value={m.id}>
                                        {m.label} — {m.note}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <p className="text-[10px] text-[var(--text-tertiary)]">
                            AI Studio Flash Live only (low cost). Disconnect and reconnect after changing. Hands-free + native app required for mic while screen locked.
                        </p>
                    </div>

                    {/* Style examples */}
                    <div className={SECTION_CLS}>
                        <label>
                            <SectionTitle icon={<MessageSquare size={14} />}>Your voice — style examples</SectionTitle>
                        </label>
                        <p className="text-[10px] text-[var(--text-tertiary)]">
                            Paste 2–3 short messages in your own voice (separate them with a blank line and <code>---</code>).
                            Echo will mirror this tone in replies.
                        </p>
                        <textarea
                            value={styleExamples}
                            onChange={e => setStyleExamples(e.target.value)}
                            placeholder={"Example 1...\n\n---\n\nExample 2..."}
                            className="sv-input w-full rounded-lg p-2 text-xs h-28 resize-y"
                        />
                    </div>

                    {/* Passphrase change */}
                    <div className={SECTION_CLS}>
                        <label>
                            <SectionTitle icon={<Lock size={14} />}>Change vault passphrase</SectionTitle>
                        </label>
                        <p className="text-[10px] text-[var(--text-tertiary)]">
                            Leave "old passphrase" empty if you've been using Quick Mode.
                        </p>
                        <input
                            type="password"
                            placeholder="Old passphrase (optional)"
                            value={oldPassphrase}
                            onChange={e => setOldPassphrase(e.target.value)}
                            className={INPUT_CLS}
                        />
                        <input
                            type="password"
                            placeholder="New passphrase"
                            value={newPassphrase}
                            onChange={e => setNewPassphrase(e.target.value)}
                            className={INPUT_CLS}
                        />
                        <input
                            type="password"
                            placeholder="Confirm new passphrase"
                            value={confirmPassphrase}
                            onChange={e => setConfirmPassphrase(e.target.value)}
                            className={INPUT_CLS}
                        />
                    </div>

                    {/* Existing — GitHub + Serp */}
                    <div className="space-y-3">
                        <label>
                            <SectionTitle icon={<Github size={14} />}>GitHub Personal Access Token</SectionTitle>
                        </label>
                        <input
                            type="password"
                            value={githubToken}
                            onChange={(e) => setGithubToken(e.target.value)}
                            placeholder="ghp_xxxxxxxxxxxx"
                            className={INPUT_CLS}
                        />
                        <label>
                            <SectionTitle icon={<Globe size={14} />}>SerpAPI Key (Web Search)</SectionTitle>
                        </label>
                        <input
                            type="password"
                            value={serpApiKey}
                            onChange={(e) => setSerpApiKey(e.target.value)}
                            placeholder="serpapi key..."
                            className={INPUT_CLS}
                        />
                    </div>

                    {/* Base Resume */}
                    <div className={SECTION_CLS}>
                        <label>
                            <SectionTitle icon={<FileText size={14} />}>Career Node (Base Resume)</SectionTitle>
                        </label>
                        <p className="text-[10px] text-[var(--text-tertiary)]">
                            Plain-text or markdown. Echo's <code>tailor_resume</code> tool will read this.
                        </p>
                        <textarea
                            value={baseResume}
                            onChange={(e) => setBaseResume(e.target.value)}
                            placeholder="## Work Experience\n\n- Software Engineer at..."
                            className="sv-input w-full rounded-lg p-3 text-sm h-48 resize-y"
                        />
                    </div>

                    <div className="pt-2 flex gap-3">
                        <button onClick={handleSave} type="button" className="btn-term solid w-full group">
                            <Check className="group-hover:scale-110 transition-transform" size={16} />
                            Save &amp; Apply
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
