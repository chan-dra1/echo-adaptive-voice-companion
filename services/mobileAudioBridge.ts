/**
 * mobileAudioBridge.ts
 *
 * Mobile / native audio session helpers: visibility resume, optional silent
 * keepalive for iOS audio session, Capacitor bridge registration.
 */

import { wakeLockService } from './wakeLockService';

type AudioCtxPair = { input?: AudioContext | null; output?: AudioContext | null };

let keepaliveOsc: OscillatorNode | null = null;
let keepaliveGain: GainNode | null = null;
let visibilityBound = false;
let ctxPair: AudioCtxPair = {};

export function isNativeShell(): boolean {
  try {
    // Capacitor injects this when wrapped as a native app
    return !!(window as any).Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}

export async function resumeAudioContexts(pair?: AudioCtxPair): Promise<void> {
  const input = pair?.input ?? ctxPair.input;
  const output = pair?.output ?? ctxPair.output;
  for (const ctx of [input, output]) {
    if (ctx && ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (e) {
        console.warn('[mobileAudioBridge] resume failed:', e);
      }
    }
  }
}

export function registerAudioContexts(pair: AudioCtxPair): void {
  ctxPair = pair;
}

/** Near-silent oscillator keeps the WebAudio session alive on iOS during hands-free. */
export function startAudioKeepalive(outputCtx: AudioContext | null): void {
  stopAudioKeepalive();
  if (!outputCtx) return;
  try {
    keepaliveOsc = outputCtx.createOscillator();
    keepaliveGain = outputCtx.createGain();
    keepaliveGain.gain.value = 0.0001;
    keepaliveOsc.connect(keepaliveGain);
    keepaliveGain.connect(outputCtx.destination);
    keepaliveOsc.start();
  } catch (e) {
    console.warn('[mobileAudioBridge] keepalive start failed:', e);
  }
}

export function stopAudioKeepalive(): void {
  try {
    keepaliveOsc?.stop();
  } catch { /* ignore */ }
  keepaliveOsc?.disconnect();
  keepaliveGain?.disconnect();
  keepaliveOsc = null;
  keepaliveGain = null;
}

export function initMobileAudioBridge(onVisible?: () => void): void {
  if (visibilityBound || typeof document === 'undefined') return;
  visibilityBound = true;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void resumeAudioContexts();
      void wakeLockService.acquire({ useNativeBridge: isNativeShell() });
      onVisible?.();
      try {
        window.dispatchEvent(new CustomEvent('echo:app-visible'));
      } catch { /* ignore */ }
    }
  });

  // Lazy-load Capacitor bridge module if present (no hard dep)
  if (isNativeShell()) {
    import('../mobile/capacitorBridge')
      .then((m) => m.registerCapacitorWakeBridge())
      .catch(() => { /* optional */ });
  }
}

export const mobileAudioBridge = {
  isNativeShell,
  resumeAudioContexts,
  registerAudioContexts,
  startAudioKeepalive,
  stopAudioKeepalive,
  initMobileAudioBridge,
};
