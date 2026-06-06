/**
 * capacitorBridge.ts
 *
 * Optional native bridge hooks when Echo is wrapped with Capacitor.
 * Safe to import dynamically — no @capacitor/* packages required at build time.
 */

import { wakeLockService, NativeWakeLockBridge } from '../services/wakeLockService';

export function registerCapacitorWakeBridge(): void {
  try {
    const Cap = (window as any).Capacitor;
    if (!Cap?.isNativePlatform?.()) return;

    const bridge: NativeWakeLockBridge = {
      isSupported: () => true,
      acquire: async () => {
        // @capacitor-community/keep-awake or similar — wire when plugin is installed
        const KeepAwake = Cap.Plugins?.KeepAwake;
        if (KeepAwake?.keepAwake) await KeepAwake.keepAwake();
      },
      release: async () => {
        const KeepAwake = Cap.Plugins?.KeepAwake;
        if (KeepAwake?.allowSleep) await KeepAwake.allowSleep();
      },
    };

    wakeLockService.registerNativeBridge(bridge);
    console.info('[capacitorBridge] native wake bridge registered');
  } catch (e) {
    console.warn('[capacitorBridge] registration failed:', e);
  }
}

/** Call after Capacitor app bootstrap for background audio (document in mobile/README). */
export function notifyNativeBackgroundAudio(desired: boolean): void {
  try {
    const Cap = (window as any).Capacitor;
    const bg = Cap?.Plugins?.BackgroundMode;
    if (!bg) return;
    if (desired && bg.enable) void bg.enable();
    else if (!desired && bg.disable) void bg.disable();
  } catch { /* plugin not installed */ }
}
