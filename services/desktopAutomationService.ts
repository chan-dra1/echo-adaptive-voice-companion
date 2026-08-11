/**
 * desktopAutomationService.ts
 *
 * Thin typed wrapper around the window.echoDesktop surface added for
 * system-wide dictation + selection-read (electron/preload.js,
 * electron/globalInput.js). Centralizes the `(window as any).echoDesktop`
 * casts and Electron-only guards in one place instead of each of
 * SettingsVault.tsx / App.tsx / dictationService.ts reimplementing them —
 * mirrors how the rest of the app funnels platform concerns through a
 * services/*.ts singleton rather than touching `window` directly in
 * components.
 */

export interface AccessibilityStatus {
    granted: boolean;
}

export interface HotkeyAccelerators {
    dictation: string;
    selectionRead: string;
}

export interface HotkeyRegistrationResult {
    dictation: boolean;
    selectionRead: boolean;
}

export interface InjectTextResult {
    ok: boolean;
    error?: string;
}

function echoDesktop(): any {
    return (typeof window !== 'undefined' ? (window as any).echoDesktop : undefined);
}

/** True only inside the Electron desktop shell — every function below is a
 *  no-op (or resolves to a "not available" shape) anywhere else. */
export function isElectronDesktop(): boolean {
    return !!echoDesktop();
}

export async function getAccessibilityStatus(): Promise<AccessibilityStatus> {
    const bridge = echoDesktop();
    if (!bridge) return { granted: false };
    try {
        return await bridge.getAccessibilityStatus();
    } catch {
        return { granted: false };
    }
}

/** Triggers the native macOS permission prompt on first call — only call
 *  this from an explicit user action (a "Grant Permission" button), never
 *  automatically, so the OS dialog doesn't ambush someone who hasn't asked
 *  for this feature yet. */
export async function requestAccessibilityPermission(): Promise<AccessibilityStatus> {
    const bridge = echoDesktop();
    if (!bridge) return { granted: false };
    try {
        return await bridge.requestAccessibilityPermission();
    } catch {
        return { granted: false };
    }
}

export function openAccessibilitySettings(): void {
    echoDesktop()?.openAccessibilitySettings?.();
}

export function relaunchApp(): void {
    echoDesktop()?.relaunch?.();
}

export async function registerHotkeys(accelerators: HotkeyAccelerators): Promise<HotkeyRegistrationResult> {
    const bridge = echoDesktop();
    if (!bridge) return { dictation: false, selectionRead: false };
    try {
        return await bridge.registerHotkeys(accelerators);
    } catch {
        return { dictation: false, selectionRead: false };
    }
}

export async function injectText(text: string): Promise<InjectTextResult> {
    const bridge = echoDesktop();
    if (!bridge) return { ok: false, error: 'Not running in the Echo desktop app.' };
    try {
        return await bridge.injectText(text);
    } catch (e: any) {
        return { ok: false, error: e?.message || String(e) };
    }
}

export function setDictationActive(active: boolean): void {
    echoDesktop()?.setDictationActive?.(active);
}

export function onDictationHotkey(callback: () => void): () => void {
    const unsub = echoDesktop()?.onDictationHotkey?.(callback);
    return unsub || (() => { });
}

export function onSelectionCaptured(callback: (payload: { text: string }) => void): () => void {
    const unsub = echoDesktop()?.onSelectionCaptured?.(callback);
    return unsub || (() => { });
}

export const desktopAutomationService = {
    isElectronDesktop,
    getAccessibilityStatus,
    requestAccessibilityPermission,
    openAccessibilitySettings,
    relaunchApp,
    registerHotkeys,
    injectText,
    setDictationActive,
    onDictationHotkey,
    onSelectionCaptured,
};
