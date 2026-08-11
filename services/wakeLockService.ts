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

// Refcounted by holder key — e.g. 'voice' and 'meeting' can each hold the
// lock independently. Without this, a voice session's idle-out (or hard-cap)
// calling release() unconditionally would drop a concurrently-running
// meeting recording's wake lock too (and vice versa). The underlying
// OS/browser lock is engaged whenever this set is non-empty and released
// only when the last holder releases.
const holders = new Set<string>();

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
    if (holders.size === 0) return; // nothing currently needs the lock held
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

/**
 * `key` identifies the caller holding the lock (e.g. 'voice', 'meeting').
 * Re-calling acquire() with a key that's already held is a safe no-op — the
 * underlying lock is only actually (re-)requested on a 0→1 transition, so a
 * repeated acquire (e.g. mobileAudioBridge's visibilitychange re-acquire)
 * never double-counts a holder.
 */
export async function acquire(key: string, options: WakeLockOptions = {}): Promise<boolean> {
    const wasEmpty = holders.size === 0;
    holders.add(key);
    ensureVisibilityHandler();

    if (!wasEmpty) return isHeld(); // another holder already has the lock engaged

    activeOptions = options;
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

/** Releasing a key that isn't currently held (already released, or never
 *  acquired) is a safe no-op — it does NOT touch the underlying lock while
 *  other holders remain. */
export async function release(key: string): Promise<void> {
    holders.delete(key);
    if (holders.size > 0) return; // other holders still need the lock

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
