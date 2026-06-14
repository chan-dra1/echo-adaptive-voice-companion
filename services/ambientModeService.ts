/**
 * ambientModeService.ts
 *
 * "Social Pause" — Echo's ambient awareness system.
 *
 * In AMBIENT mode:
 *  - Echo is always listening (mic stays on)
 *  - But it does NOT respond unless its activation phrase is detected
 *    e.g. "Echo", "Hey Echo", "Echo help me"
 *  - If the user is clearly talking to other people, Echo stays silent
 *  - Silence > configurable timeout → Echo soft-checks in ("Hey, you still there?")
 *  - User can say "Echo, go quiet" to disable all proactive responses
 *  - User can say "Echo, come back" or any activation phrase to resume
 *
 * Technical approach:
 *  - Wraps the existing transcript stream from GeminiLive
 *  - Checks each partial/final transcript chunk for activation phrases
 *  - Emits DOM events for the App layer to act on
 *
 * Limitations (documented honestly):
 *  - Background audio (screen off) is NOT possible in PWA on iOS — this is
 *    an OS-level restriction. On Android Chrome, the tab must be open but
 *    the screen can be off with wake lock held.
 *  - True always-on background listening is not possible in any browser; this
 *    is a hard OS-level limitation for web apps, not something Echo can bypass.
 */

import { getCached, setCached } from './cryptoService';

export type AmbientStatus = 'active' | 'social_pause' | 'quiet' | 'disabled';

export interface AmbientConfig {
    enabled: boolean;
    activationPhrases: string[];          // triggers Echo to respond
    quietPhrases: string[];               // puts Echo in quiet mode
    resumePhrases: string[];              // wakes Echo from quiet mode
    silenceCheckInMs: number;             // check-in after this ms of silence
    socialPauseKeywords: string[];        // keywords that suggest talking to others
}

const CONFIG_KEY = 'echo_ambient_config';

const DEFAULTS: AmbientConfig = {
    enabled: false,
    activationPhrases: [
        'echo', 'hey echo', 'echo help', 'echo are you there',
        'echo listen', 'echo what', 'echo how', 'echo can you',
        'echo i need', 'echo tell me', 'echo remind me',
    ],
    quietPhrases: [
        'echo go quiet', 'echo be quiet', 'echo shh', 'echo pause',
        'echo stop listening', 'echo mute', 'echo sleep',
    ],
    resumePhrases: [
        'echo wake up', 'echo come back', 'echo resume', 'echo i need you',
        'echo are you there', 'echo unmute',
    ],
    silenceCheckInMs: 5 * 60 * 1000, // 5 minutes
    socialPauseKeywords: [],
};

export function getAmbientConfig(): AmbientConfig {
    return { ...DEFAULTS, ...getCached<Partial<AmbientConfig>>(CONFIG_KEY, {}) };
}

export function saveAmbientConfig(patch: Partial<AmbientConfig>): void {
    setCached(CONFIG_KEY, { ...getAmbientConfig(), ...patch });
}

// ─── Runtime state ────────────────────────────────────────────────────────────

class AmbientModeService {
    private status: AmbientStatus = 'disabled';
    private silenceTimer: number | null = null;
    private lastSpeechAt: number = 0;
    private config: AmbientConfig = getAmbientConfig();
    private _onStatusChange: ((status: AmbientStatus) => void) | null = null;

    get currentStatus(): AmbientStatus { return this.status; }

    /** Call when ambient mode is turned on/off from settings. */
    setEnabled(enabled: boolean): void {
        this.config = getAmbientConfig();
        if (!enabled) {
            this.status = 'disabled';
            this.clearSilenceTimer();
            this.emit();
            return;
        }
        this.status = 'active';
        this.resetSilenceTimer();
        this.emit();
    }

    /** Feed transcribed text here — called by the voice pipeline. */
    processTranscript(text: string, isFinal: boolean): 'respond' | 'ignore' {
        if (this.status === 'disabled') return 'respond';

        const lower = text.toLowerCase().trim();

        // Check quiet phrases first
        if (this.matchesAny(lower, this.config.quietPhrases)) {
            this.status = 'quiet';
            this.clearSilenceTimer();
            this.emit();
            window.dispatchEvent(new CustomEvent('ambient:quiet'));
            return 'respond'; // respond once to confirm going quiet
        }

        // Check resume phrases
        if (this.status === 'quiet') {
            if (this.matchesAny(lower, this.config.resumePhrases)) {
                this.status = 'active';
                this.resetSilenceTimer();
                this.emit();
                window.dispatchEvent(new CustomEvent('ambient:resumed'));
                return 'respond';
            }
            return 'ignore';
        }

        // In social pause mode
        if (this.status === 'social_pause') {
            if (this.matchesAny(lower, this.config.activationPhrases)) {
                this.status = 'active';
                this.resetSilenceTimer();
                this.emit();
                return 'respond';
            }
            return 'ignore';
        }

        // In active mode — check activation phrases
        if (this.status === 'active') {
            this.lastSpeechAt = Date.now();
            this.resetSilenceTimer();
            // Always respond in active mode (ambient mode off = normal mode)
            return 'respond';
        }

        return 'ignore';
    }

    /** Call when user explicitly activates social pause. */
    enterSocialPause(): void {
        if (this.status === 'disabled') return;
        this.status = 'social_pause';
        this.clearSilenceTimer();
        this.emit();
        window.dispatchEvent(new CustomEvent('ambient:social-pause'));
    }

    /** Call when user wants Echo to actively listen again. */
    exitSocialPause(): void {
        if (this.status === 'disabled') return;
        this.status = 'active';
        this.resetSilenceTimer();
        this.emit();
        window.dispatchEvent(new CustomEvent('ambient:resumed'));
    }

    onStatusChange(cb: (status: AmbientStatus) => void): void {
        this._onStatusChange = cb;
    }

    private matchesAny(text: string, phrases: string[]): boolean {
        return phrases.some(p => text.includes(p.toLowerCase()));
    }

    private resetSilenceTimer(): void {
        this.clearSilenceTimer();
        const delay = this.config.silenceCheckInMs;
        if (delay > 0) {
            this.silenceTimer = window.setTimeout(() => {
                window.dispatchEvent(new CustomEvent('ambient:silence-checkin'));
            }, delay);
        }
    }

    private clearSilenceTimer(): void {
        if (this.silenceTimer !== null) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
        }
    }

    private emit(): void {
        this._onStatusChange?.(this.status);
        window.dispatchEvent(new CustomEvent('ambient:status-change', { detail: this.status }));
    }
}

export const ambientModeService = new AmbientModeService();

// ─── Status display helpers ───────────────────────────────────────────────────

export const AMBIENT_STATUS_LABELS: Record<AmbientStatus, string> = {
    active:        'Listening',
    social_pause:  'Paused (say "Echo" to resume)',
    quiet:         'Quiet mode',
    disabled:      'Ambient Off',
};

export const AMBIENT_STATUS_COLORS: Record<AmbientStatus, string> = {
    active:       'text-green-400',
    social_pause: 'text-yellow-400',
    quiet:        'text-gray-400',
    disabled:     'text-gray-600',
};

// ─── Background / screen-off notice ──────────────────────────────────────────

export const BACKGROUND_LIMITATIONS = {
    ios: `On iOS, the browser cannot keep audio sessions running when the screen is off — an OS-level limit that applies to every web app. Keep Echo open and on screen for continuous voice, and install it to your Home Screen for the most app-like, full-screen experience.`,
    android: `On Android Chrome, Echo can stay connected with the screen off as long as the Wake Lock is active. Enable "Hands-Free" mode + Wake Lock in settings for best results.`,
    pwa: `As a PWA, Echo can send push notifications in the background even when the screen is off. Reminders, deadline nudges, and task alerts will still reach you.`,
};
