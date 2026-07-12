/**
 * uiModeService.ts
 *
 * Simple / Advanced UI mode for Echo.
 *
 * Phase-1 launch targets non-technical users, so by default they get a clean,
 * voice-first app. Power users can flip to Advanced in the Settings Vault
 * ("Interface" section) and keep every panel.
 *
 * SIMPLE mode hides (the actual hiding happens in App.tsx):
 *  - Automation Hub
 *  - Mission Dashboard
 *  - Skills Vault (✨ button)
 *  - Ghost mode
 *  - Stealth mode
 *  - Vault Organizer
 *  - Echo Core status chrome
 * What remains: voice, chat, and memory — the essentials.
 *
 * First-run resolution (no stored value yet):
 *  - If the user already has any provider API key in localStorage, they are an
 *    existing power user → 'advanced'.
 *  - Otherwise → 'simple'.
 *  The resolved value is persisted immediately so it stays stable.
 *
 * Change notification: setUiMode() dispatches a window CustomEvent
 * 'echo:ui-mode-changed' with detail { mode } — subscribe via subscribeUiMode().
 */

export type UiMode = 'simple' | 'advanced';

const STORAGE_KEY = 'echo_ui_mode';
const CHANGE_EVENT = 'echo:ui-mode-changed';

/** Provider key slots — presence of any of these marks an existing power user. */
const PROVIDER_KEY_NAMES = [
    'echo_api_key',
    'echo_openai_key',
    'echo_groq_key',
    'echo_openrouter_key',
    'echo_mistral_key',
    'echo_anthropic_key',
    'echo_hf_key',
];

function isUiMode(value: unknown): value is UiMode {
    return value === 'simple' || value === 'advanced';
}

/**
 * Current UI mode. If nothing is stored yet (first run after this feature
 * shipped), infer it: existing users with any provider key → 'advanced',
 * fresh installs → 'simple'. The inferred value is persisted so the answer
 * is stable across sessions.
 */
export function getUiMode(): UiMode {
    if (typeof window === 'undefined') return 'simple';
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (isUiMode(stored)) return stored;

        const isExistingPowerUser = PROVIDER_KEY_NAMES.some(
            k => !!localStorage.getItem(k)
        );
        const resolved: UiMode = isExistingPowerUser ? 'advanced' : 'simple';
        localStorage.setItem(STORAGE_KEY, resolved);
        return resolved;
    } catch {
        return 'simple';
    }
}

/** Shorthand: is every panel visible? */
export function isAdvancedMode(): boolean {
    return getUiMode() === 'advanced';
}

/** Persist the mode and notify listeners (window event 'echo:ui-mode-changed'). */
export function setUiMode(mode: UiMode): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(STORAGE_KEY, mode);
    } catch {
        // localStorage unavailable (private mode / quota) — still notify UI
    }
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { mode } }));
}

/**
 * Subscribe to mode changes. Returns an unsubscribe function.
 *
 *   useEffect(() => subscribeUiMode(setMode), []);
 */
export function subscribeUiMode(cb: (mode: UiMode) => void): () => void {
    if (typeof window === 'undefined') return () => {};
    const handler = (e: Event) => {
        const mode = (e as CustomEvent<{ mode: UiMode }>).detail?.mode;
        if (isUiMode(mode)) cb(mode);
    };
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
}
