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
import { App as CapacitorApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
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

/**
 * Without this, Android's default behavior on the hardware/gesture back
 * button is to finish the Activity immediately — there's no WebView
 * navigation history to fall back on since Echo is a client-rendered SPA
 * with no real route pushes, so any open panel (chat, settings, a Power
 * Tools panel, ...) makes back exit the whole app instead of closing it.
 * `closeTopPanel` is App.tsx's own priority cascade (the same one ESC
 * already drives) — this just gives the OS back button the same hook,
 * and only lets Android's default (minimize/exit) behavior proceed when
 * nothing is open to close.
 */
export function registerCapacitorBackButton(closeTopPanel: () => boolean): void {
  if (!Capacitor.isNativePlatform()) return;

  CapacitorApp.addListener('backButton', () => {
    if (closeTopPanel()) return;
    // Nothing was open — minimize rather than kill the process, matching
    // standard Android app behavior (most apps don't exit on back, they
    // background) and avoiding an abrupt teardown of an active voice session.
    CapacitorApp.minimizeApp().catch(() => { /* no-op on unsupported platforms */ });
  });

  console.info('[capacitorBridge] hardware back-button handler registered (@capacitor/app)');
}

/**
 * Prevents the WebView from drawing under the status bar (the bug seen on
 * a real device: the ECHO wordmark and status pill overlapped the clock/
 * battery icons). `overlay:false` tells Android to reserve the status bar's
 * height instead of treating it as transparent chrome the page draws
 * through — the simpler, more reliable fix compared to relying on
 * `env(safe-area-inset-top)` in the WebView, which isn't populated without
 * this plugin.
 */
export async function initCapacitorStatusBar(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setStyle({ style: Style.Dark }); // light icons, matches Echo's dark background
    await StatusBar.setBackgroundColor({ color: '#071309' }); // src/index.css --bg-base
  } catch (e) {
    console.warn('[capacitorBridge] status bar init failed:', e);
  }
}
