/**
 * companionPersonaService.ts
 *
 * Manages Echo's companion identity — the emotional intelligence layer
 * that makes Echo feel like a caring friend, mentor, caretaker, or partner
 * rather than a cold assistant.
 *
 * Tracks:
 *  - Companion mode (friend | mentor | caretaker | partner | coach)
 *  - User's name and preferences
 *  - Onboarding progress (7-day training period)
 *  - Emotional context (how is the user feeling today?)
 *  - Streak (days in a row talking to Echo — builds relationship depth)
 *  - Time-of-day awareness for greeting style
 */

import { getCached, setCached } from './cryptoService';
import { saveMemory } from './memoryService';

export type CompanionMode = 'friend' | 'mentor' | 'caretaker' | 'partner' | 'coach';

export interface CompanionState {
    mode: CompanionMode;
    userName: string;                    // how Echo addresses the user
    onboardingComplete: boolean;
    onboardingStep: number;              // 0-5
    lastCheckIn: number;                 // timestamp
    emotionalState: 'unknown' | 'great' | 'good' | 'okay' | 'stressed' | 'tired' | 'sad';
    streakDays: number;
    lastSessionDate: string;             // YYYY-MM-DD
    totalSessions: number;
    companionName: string;               // what user calls Echo (default: "Echo")
    pronouns: 'she/her' | 'he/him' | 'they/them';
    personality: {
        warmth: number;    // 1-5 (1=professional, 5=very warm)
        humor: number;     // 1-5 (1=serious, 5=playful)
        proactivity: number; // 1-5 (1=only when asked, 5=very proactive)
        formality: number; // 1-5 (1=very casual, 5=formal)
    };
}

const KEY = 'echo_companion_state';

const DEFAULTS: CompanionState = {
    mode: 'friend',
    userName: '',
    onboardingComplete: false,
    onboardingStep: 0,
    lastCheckIn: 0,
    emotionalState: 'unknown',
    streakDays: 0,
    lastSessionDate: '',
    totalSessions: 0,
    companionName: 'Echo',
    pronouns: 'she/her',
    personality: {
        warmth: 4,
        humor: 3,
        proactivity: 4,
        formality: 2,
    },
};

export function getCompanionState(): CompanionState {
    return { ...DEFAULTS, ...getCached<Partial<CompanionState>>(KEY, {}) };
}

export function saveCompanionState(patch: Partial<CompanionState>): CompanionState {
    const next = { ...getCompanionState(), ...patch };
    setCached(KEY, next);
    return next;
}

/** Call on every session start — updates streak & session count. */
export function recordSessionStart(): CompanionState {
    const state = getCompanionState();
    const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
    const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');

    let streakDays = state.streakDays;
    if (state.lastSessionDate === today) {
        // same day, no change
    } else if (state.lastSessionDate === yesterday) {
        streakDays += 1; // consecutive day
    } else if (state.lastSessionDate !== today) {
        streakDays = 1; // streak broken or first session
    }

    return saveCompanionState({
        lastSessionDate: today,
        totalSessions: state.totalSessions + 1,
        streakDays,
    });
}

/** Returns a time-aware greeting from Echo. */
export function getGreeting(state?: CompanionState): string {
    const s = state || getCompanionState();
    const hour = new Date().getHours();
    const name = s.userName ? `, ${s.userName}` : '';

    const morningGreetings = [
        `Good morning${name}! ☀️ Ready to make today count?`,
        `Morning${name}! I've been thinking about what you've got going on today.`,
        `Rise and shine${name}! Let's see what we can conquer today.`,
    ];
    const afternoonGreetings = [
        `Hey${name}! How's your afternoon going?`,
        `Hey${name}! Checking in — how are you holding up?`,
        `Hi${name}! Afternoon already — let's make the most of it.`,
    ];
    const eveningGreetings = [
        `Good evening${name}! How did your day go?`,
        `Hey${name}! Evening already — how are you feeling?`,
        `Evening${name}! Time to wind down and reflect a bit.`,
    ];
    const nightGreetings = [
        `Hey${name}, up late? I'm here if you need anything.`,
        `Still going${name}? I've got you. What do you need?`,
        `Night owl mode${name}! Let's get through this together.`,
    ];

    const list = hour >= 5 && hour < 12 ? morningGreetings
        : hour >= 12 && hour < 17 ? afternoonGreetings
        : hour >= 17 && hour < 22 ? eveningGreetings
        : nightGreetings;

    return list[Math.floor(Math.random() * list.length)];
}

/** Returns the companion mode description for the system prompt. */
export function getCompanionModeInstruction(state?: CompanionState): string {
    const s = state || getCompanionState();
    const name = s.userName || 'the user';

    const modeDescriptions: Record<CompanionMode, string> = {
        friend: `You are ${name}'s best friend. You're real, honest, warm, and funny. You celebrate their wins (even tiny ones), listen to their struggles without judgment, and sometimes roast them gently when they're procrastinating. You remember everything they've told you and bring it up naturally.`,
        mentor: `You are ${name}'s trusted mentor. You're wise, challenging, and deeply invested in their growth. You ask powerful questions, push them to think bigger, and hold them accountable — but always with care and respect.`,
        caretaker: `You are ${name}'s caretaker — like a caring parent or older sibling. You check if they've eaten, slept, taken breaks. You notice when they're stressed and offer comfort. You remind them that rest is productive too. You are firm but always loving.`,
        partner: `You are ${name}'s supportive partner. You're emotionally attuned, present, and genuinely interested in their feelings and day. You plan together, dream together, and face challenges as a team. You know their love language and adapt.`,
        coach: `You are ${name}'s personal performance coach. You're energizing, results-focused, and action-oriented. You give specific strategies, track progress obsessively, and celebrate milestones. You don't let excuses slide — you reframe them into solutions.`,
    };

    return modeDescriptions[s.mode];
}

/** Build warmth/style adjuster for system prompt. */
export function getPersonalityInstruction(state?: CompanionState): string {
    const s = state || getCompanionState();
    const p = s.personality;
    const parts: string[] = [];

    if (p.warmth >= 4) parts.push('Be very warm, caring, and emotionally present.');
    if (p.humor >= 4) parts.push('Use light humor when the moment is right.');
    if (p.proactivity >= 4) parts.push('Proactively check in, suggest next steps, and notice patterns in what the user shares.');
    if (p.formality <= 2) parts.push('Keep it casual — no stiff language, talk like a real person.');

    const streakNote = s.streakDays >= 7
        ? `You've been talking with ${s.userName || 'this user'} for ${s.streakDays} days in a row — your relationship is deep. Reference shared history naturally.`
        : s.streakDays >= 3
        ? `You're building a connection with ${s.userName || 'this user'} — ${s.streakDays} days in a row now.`
        : '';

    if (streakNote) parts.push(streakNote);

    return parts.join(' ');
}

/** Handy: save onboarding data as encrypted local_only memory. */
export function saveOnboardingMemory(key: string, value: string): void {
    saveMemory(key, value, 'local_only');
}

/** Companion modes available with display info. */
export const COMPANION_MODES: Array<{ id: CompanionMode; label: string; emoji: string; description: string }> = [
    { id: 'friend',    label: 'Best Friend',   emoji: '🤝', description: 'Warm, real, funny — calls you out lovingly' },
    { id: 'mentor',    label: 'Mentor',         emoji: '🦉', description: 'Wise guidance, powerful questions, big-picture thinking' },
    { id: 'caretaker', label: 'Caretaker',      emoji: '🫂', description: 'Checks if you\'ve slept/eaten, comfort-first approach' },
    { id: 'partner',   label: 'Life Partner',   emoji: '💙', description: 'Deeply present, plans together, knows you inside out' },
    { id: 'coach',     label: 'Performance Coach', emoji: '⚡', description: 'High-energy, results-focused, no excuses allowed' },
];
