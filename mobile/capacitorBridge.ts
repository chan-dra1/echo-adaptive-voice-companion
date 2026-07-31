/**
 * capacitorBridge.ts
 *
 * Native bridge hooks for Echo running inside the Capacitor iOS/Android
 * shell (see capacitor.config.ts, ios/, android/). Safe to import
 * unconditionally on web too — `Capacitor.isNativePlatform()` is false
 * there, so every function below becomes a no-op.
 *
 * This replaces an older version of this file (deleted along with the rest
 * of the native project when Echo went web-only-PWA, restored when that
 * decision was reversed — see memory/capacitor-native-rebuild) that
 * referenced `Cap.Plugins?.KeepAwake` speculatively, without the plugin
 * actually being installed. That version silently did nothing on native
 * platforms (Cap.Plugins.KeepAwake was always undefined) while looking like
 * working code. This version imports @capacitor-community/keep-awake for
 * real, so it's either genuinely wired or fails loudly at build time.
 */
import { Capacitor } from '@capacitor/core';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { wakeLockService, NativeWakeLockBridge } from '../services/wakeLockService';

/**
 * Registers the native wake-lock bridge with wakeLockService's existing
 * extension point (services/wakeLockService.ts registerNativeBridge). Web
 * already has its own Wake Lock API path; this only takes effect when
 * Capacitor reports a native platform.
 */
export function registerCapacitorWakeBridge(): void {
  if (!Capacitor.isNativePlatform()) return;

  const bridge: NativeWakeLockBridge = {
    isSupported: () => true,
    acquire: async () => {
      try {
        await KeepAwake.keepAwake();
      } catch (e) {
        console.warn('[capacitorBridge] keepAwake failed:', e);
      }
    },
    release: async () => {
      try {
        await KeepAwake.allowSleep();
      } catch (e) {
        console.warn('[capacitorBridge] allowSleep failed:', e);
      }
    },
  };

  wakeLockService.registerNativeBridge(bridge);
  console.info('[capacitorBridge] native wake-lock bridge registered (@capacitor-community/keep-awake)');
}
