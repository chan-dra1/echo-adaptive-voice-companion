// MOBILE-AGENT: Session lifecycle / idle / silence / hard-cap timers.
//
// Owns the "should this Live session end?" policy so the UI doesn't have to
// litter setTimeouts everywhere. Emits DOM events on `window`:
//   - 'lifecycle:idle'      (no user activity for `idleTimeoutMs`)
//   - 'lifecycle:silence'   (no mic input above threshold for `silenceTimeoutMs`)
//   - 'lifecycle:hard-cap'  (session has run for `hardCapMs`)
//
// The actual disconnect is left to the App layer so it can choose to show
// a toast, call into GeminiLiveService.disconnect(), etc.

export type LifecycleReason = 'idle' | 'silence' | 'hard-cap';

export interface SessionLifecycleConfig {
    idleTimeoutMs: number;       // default 5 min
    hardCapMs: number;           // default 30 min
    silenceTimeoutMs: number;    // default 90s
    /** Hands-free mode doubles the silence tolerance. */
    handsFree: boolean;
}

const LS = {
    idle: 'echo_idle_timeout_ms',
    hardCap: 'echo_hard_cap_ms',
    silence: 'echo_silence_timeout_ms',
    handsFree: 'echo_hands_free',
};

const DEFAULTS: SessionLifecycleConfig = {
    idleTimeoutMs: 5 * 60 * 1000,
    hardCapMs: 30 * 60 * 1000,
    silenceTimeoutMs: 90 * 1000,
    handsFree: false,
};

function readNum(key: string, fallback: number): number {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        const n = parseInt(raw, 10);
        return Number.isFinite(n) && n > 0 ? n : fallback;
    } catch { return fallback; }
}

function readBool(key: string, fallback: boolean): boolean {
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) return fallback;
        return raw === '1' || raw === 'true';
    } catch { return fallback; }
}

export function loadLifecycleConfig(): SessionLifecycleConfig {
    return {
        idleTimeoutMs: readNum(LS.idle, DEFAULTS.idleTimeoutMs),
        hardCapMs: readNum(LS.hardCap, DEFAULTS.hardCapMs),
        silenceTimeoutMs: readNum(LS.silence, DEFAULTS.silenceTimeoutMs),
        handsFree: readBool(LS.handsFree, DEFAULTS.handsFree),
    };
}

export function saveLifecycleConfig(patch: Partial<SessionLifecycleConfig>): SessionLifecycleConfig {
    const next = { ...loadLifecycleConfig(), ...patch };
    try {
        localStorage.setItem(LS.idle, String(next.idleTimeoutMs));
        localStorage.setItem(LS.hardCap, String(next.hardCapMs));
        localStorage.setItem(LS.silence, String(next.silenceTimeoutMs));
        localStorage.setItem(LS.handsFree, next.handsFree ? '1' : '0');
    } catch { /* ignore */ }
    return next;
}

class SessionLifecycleService {
    private config: SessionLifecycleConfig = loadLifecycleConfig();
    private idleTimer: number | null = null;
    private silenceTimer: number | null = null;
    private hardCapTimer: number | null = null;
    private startedAt = 0;
    private lastActivityAt = 0;
    private lastAudioActivityAt = 0;
    private running = false;

    public start(): void {
        this.config = loadLifecycleConfig();
        this.stop();
        this.running = true;
        const now = Date.now();
        this.startedAt = now;
        this.lastActivityAt = now;
        this.lastAudioActivityAt = now;
        this.scheduleIdle();
        this.scheduleSilence();
        this.scheduleHardCap();
    }

    public stop(): void {
        this.running = false;
        if (this.idleTimer != null) { window.clearTimeout(this.idleTimer); this.idleTimer = null; }
        if (this.silenceTimer != null) { window.clearTimeout(this.silenceTimer); this.silenceTimer = null; }
        if (this.hardCapTimer != null) { window.clearTimeout(this.hardCapTimer); this.hardCapTimer = null; }
    }

    /** Generic activity (text input, tool call, button press). */
    public noteActivity(): void {
        if (!this.running) return;
        this.lastActivityAt = Date.now();
        this.scheduleIdle();
    }

    /** Audio frame from mic considered "user audio" (above VAD threshold). */
    public noteAudioActivity(): void {
        if (!this.running) return;
        const now = Date.now();
        this.lastActivityAt = now;
        this.lastAudioActivityAt = now;
        this.scheduleIdle();
        this.scheduleSilence();
    }

    public setHandsFree(handsFree: boolean): void {
        this.config = saveLifecycleConfig({ handsFree });
        if (this.running) this.scheduleSilence();
    }

    public getConfig(): SessionLifecycleConfig {
        return { ...this.config };
    }

    public update(patch: Partial<SessionLifecycleConfig>): SessionLifecycleConfig {
        this.config = saveLifecycleConfig(patch);
        if (this.running) {
            this.scheduleIdle();
            this.scheduleSilence();
            this.scheduleHardCap();
        }
        return this.getConfig();
    }

    private scheduleIdle(): void {
        if (this.idleTimer != null) window.clearTimeout(this.idleTimer);
        const delay = Math.max(1000, this.config.idleTimeoutMs);
        this.idleTimer = window.setTimeout(() => this.fire('idle'), delay);
    }

    private scheduleSilence(): void {
        if (this.silenceTimer != null) window.clearTimeout(this.silenceTimer);
        const base = Math.max(5000, this.config.silenceTimeoutMs);
        const delay = this.config.handsFree ? base * 2 : base;
        this.silenceTimer = window.setTimeout(() => this.fire('silence'), delay);
    }

    private scheduleHardCap(): void {
        if (this.hardCapTimer != null) window.clearTimeout(this.hardCapTimer);
        const elapsed = Date.now() - this.startedAt;
        const remaining = Math.max(1000, this.config.hardCapMs - elapsed);
        this.hardCapTimer = window.setTimeout(() => this.fire('hard-cap'), remaining);
    }

    private fire(reason: LifecycleReason): void {
        if (!this.running) return;
        try {
            window.dispatchEvent(new CustomEvent(`lifecycle:${reason}`, {
                detail: {
                    reason,
                    startedAt: this.startedAt,
                    lastActivityAt: this.lastActivityAt,
                    lastAudioActivityAt: this.lastAudioActivityAt,
                },
            }));
        } catch (e) {
            console.warn('[sessionLifecycleService] dispatch failed:', e);
        }
        this.stop();
    }
}

export const sessionLifecycleService = new SessionLifecycleService();
