// MOBILE-AGENT: thin wake-lock wrapper.
//
// Web/PWA path: uses the standard Screen Wake Lock API
//   (https://developer.mozilla.org/docs/Web/API/Screen_Wake_Lock_API).
// Optional native bridge: if a host environment ever registers one via
//   `registerNativeBridge`, calls are forwarded to it when `useNativeBridge`
//   is set. Unused in this pure web build — kept as a harmless extension point.

export interface WakeLockOptions {
    /** Opt-in to a registered native bridge, if one exists. Unused on web. */
    useNativeBridge?: boolean;
}

export interface NativeWakeLockBridge {
    acquire(): Promise<void>;
    release(): Promise<void>;
    isSupported(): boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWakeLockSentinel = any;

let sentinel: AnyWakeLockSentinel = null;
let visibilityHandlerAttached = false;
let nativeBridge: NativeWakeLockBridge | null = null;
let activeOptions: WakeLockOptions = {};

export function registerNativeBridge(bridge: NativeWakeLockBridge): void {
    nativeBridge = bridge;
}

export function isSupported(): boolean {
    if (nativeBridge && activeOptions.useNativeBridge) {
        try { return nativeBridge.isSupported(); } catch { /* fallthrough */ }
    }
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

async function acquireBrowser(): Promise<boolean> {
    if (!('wakeLock' in navigator)) return false;
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sentinel = await (navigator as any).wakeLock.request('screen');
        sentinel?.addEventListener?.('release', () => {
            // No-op: the visibilitychange handler will re-acquire if needed.
        });
        return true;
    } catch (e) {
        console.warn('[wakeLockService] acquire failed:', e);
        sentinel = null;
        return false;
    }
}

async function reacquireIfNeeded(): Promise<void> {
    if (document.visibilityState !== 'visible') return;
    if (sentinel && !sentinel.released) return;
    await acquireBrowser();
}

function ensureVisibilityHandler(): void {
    if (visibilityHandlerAttached) return;
    if (typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', () => {
        // When the user returns to the tab/app, try to re-acquire.
        void reacquireIfNeeded();
    });
    visibilityHandlerAttached = true;
}

export async function acquire(options: WakeLockOptions = {}): Promise<boolean> {
    activeOptions = options;
    ensureVisibilityHandler();
    if (options.useNativeBridge && nativeBridge) {
        try {
            await nativeBridge.acquire();
            return true;
        } catch (e) {
            console.warn('[wakeLockService] native bridge acquire failed, falling back:', e);
        }
    }
    return acquireBrowser();
}

export async function release(): Promise<void> {
    if (activeOptions.useNativeBridge && nativeBridge) {
        try { await nativeBridge.release(); } catch (e) { console.warn('[wakeLockService] native release:', e); }
    }
    if (sentinel) {
        try { await sentinel.release(); } catch { /* ignore */ }
        sentinel = null;
    }
}

export function isHeld(): boolean {
    return !!sentinel && !sentinel.released;
}

export const wakeLockService = {
    acquire,
    release,
    isHeld,
    isSupported,
    registerNativeBridge,
};
