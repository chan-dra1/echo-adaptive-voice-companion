/**
 * conversationPolicyService.ts
 *
 * Decides when Echo should speak, duck, defer (user on a call / listening to
 * something else), or accept a barge-in — without hard-coding logic in the
 * audio loop.
 */

export type InterruptMode = 'polite' | 'balanced' | 'eager';

export type InterruptAction =
  | { type: 'none' }
  | { type: 'duck'; gain: number; reason: string }
  | { type: 'barge_in'; reason: string }
  | { type: 'defer_output'; reason: 'external_audio' | 'ambient_busy' }
  | { type: 'resume_output' };

export interface PolicyFrameInput {
  userRms: number;
  outputRms: number;
  aiSpeaking: boolean;
  userSpeechActive: boolean;
  deferOutput: boolean;
}

const LS_MODE = 'echo_interrupt_mode';

const MODE_DEFAULTS: Record<
  InterruptMode,
  { bargeThreshold: number; bargeFrames: number; duckGain: number; ambientLow: number; ambientHigh: number }
> = {
  polite: {
    bargeThreshold: 0.035,
    bargeFrames: 6,
    duckGain: 0.15,
    ambientLow: 0.014,
    ambientHigh: 0.055,
  },
  balanced: {
    bargeThreshold: 0.025,
    bargeFrames: 3,
    duckGain: 0.2,
    ambientLow: 0.012,
    ambientHigh: 0.06,
  },
  eager: {
    bargeThreshold: 0.018,
    bargeFrames: 1,
    duckGain: 0.35,
    ambientLow: 0.01,
    ambientHigh: 0.07,
  },
};

export function loadInterruptMode(): InterruptMode {
  try {
    const raw = localStorage.getItem(LS_MODE);
    if (raw === 'polite' || raw === 'balanced' || raw === 'eager') return raw;
  } catch { /* ignore */ }
  return 'balanced';
}

export function saveInterruptMode(mode: InterruptMode): void {
  try {
    localStorage.setItem(LS_MODE, mode);
  } catch { /* ignore */ }
}

export function cycleInterruptMode(current?: InterruptMode): InterruptMode {
  const order: InterruptMode[] = ['polite', 'balanced', 'eager'];
  const idx = order.indexOf(current ?? loadInterruptMode());
  const next = order[(idx + 1) % order.length];
  saveInterruptMode(next);
  return next;
}

export function interruptModeLabel(mode: InterruptMode): string {
  switch (mode) {
    case 'polite': return 'Polite — waits, rarely interrupts you';
    case 'balanced': return 'Balanced — ducks then responds';
    case 'eager': return 'Eager — quick barge-in';
  }
}

class ConversationPolicyService {
  private mode: InterruptMode = loadInterruptMode();
  private bargeFrameCount = 0;
  private ambientFrameCount = 0;
  private quietFrameCount = 0;

  setMode(mode: InterruptMode): void {
    this.mode = mode;
    saveInterruptMode(mode);
    this.reset();
  }

  getMode(): InterruptMode {
    return this.mode;
  }

  reset(): void {
    this.bargeFrameCount = 0;
    this.ambientFrameCount = 0;
    this.quietFrameCount = 0;
  }

  evaluate(frame: PolicyFrameInput): InterruptAction {
    const cfg = MODE_DEFAULTS[this.mode];
    const { userRms, aiSpeaking, userSpeechActive, deferOutput } = frame;

    // User clearly talking over Echo → barge-in path
    if (aiSpeaking && userRms > cfg.bargeThreshold) {
      this.bargeFrameCount++;
      this.quietFrameCount = 0;
      if (this.bargeFrameCount >= cfg.bargeFrames) {
        this.bargeFrameCount = 0;
        return { type: 'barge_in', reason: 'user_speech_over_ai' };
      }
      if (this.bargeFrameCount === 1) {
        return { type: 'duck', gain: cfg.duckGain, reason: 'user_may_interrupt' };
      }
      return { type: 'none' };
    }

    this.bargeFrameCount = 0;

    // Ambient / call / listening-to-something: mic energy but not directed speech
    const ambientLikely =
      !userSpeechActive &&
      userRms >= cfg.ambientLow &&
      userRms <= cfg.ambientHigh;

    if (ambientLikely) {
      this.ambientFrameCount++;
      this.quietFrameCount = 0;
      if (this.ambientFrameCount >= 20) {
        return { type: 'defer_output', reason: 'ambient_busy' };
      }
      if (aiSpeaking && this.ambientFrameCount >= 8) {
        return { type: 'duck', gain: 0.08, reason: 'ambient_duck' };
      }
    } else if (userRms < cfg.ambientLow * 0.8) {
      this.ambientFrameCount = Math.max(0, this.ambientFrameCount - 1);
      this.quietFrameCount++;
      if (deferOutput && this.quietFrameCount >= 12) {
        this.quietFrameCount = 0;
        this.ambientFrameCount = 0;
        return { type: 'resume_output' };
      }
    } else {
      this.quietFrameCount = 0;
    }

    if (deferOutput && !ambientLikely) {
      return { type: 'none' };
    }

    return { type: 'none' };
  }
}

export const conversationPolicyService = new ConversationPolicyService();
