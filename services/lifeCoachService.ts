/**
 * lifeCoachService.ts
 *
 * The life-coach layer of Echo's companion system.
 * Manages:
 *  - Habits (daily/weekly with streaks)
 *  - Goals (with milestones and progress)
 *  - Daily briefings (morning summary of tasks, habits, deadlines + motivational note)
 *  - Emotional check-ins (scheduled throughout the day)
 *  - Motivational quotes pool
 */

import { getCached, setCached } from './cryptoService';
import { getCompanionState } from './companionPersonaService';

// ─── Habit ───────────────────────────────────────────────────────────────────

export type HabitCategory = 'health' | 'learning' | 'social' | 'productivity' | 'mindfulness' | 'custom';
export type HabitFrequency = 'daily' | 'weekly';

export interface Habit {
    id: string;
    name: string;
    category: HabitCategory;
    frequency: HabitFrequency;
    streak: number;
    bestStreak: number;
    lastCompleted: string | null;  // YYYY-MM-DD
    completedDates: string[];       // YYYY-MM-DD[]
    createdAt: number;
    reminderTime?: string;          // "HH:MM"
    icon: string;
    active: boolean;
}

// ─── Goal ────────────────────────────────────────────────────────────────────

export interface GoalMilestone {
    id: string;
    title: string;
    completed: boolean;
    completedAt?: number;
}

export type GoalStatus = 'active' | 'completed' | 'paused';

export interface Goal {
    id: string;
    title: string;
    why: string;           // the deep "why" — keeps you motivated
    category: string;
    deadline?: string;     // YYYY-MM-DD
    milestones: GoalMilestone[];
    progress: number;      // 0–100
    status: GoalStatus;
    createdAt: number;
    updatedAt: number;
    notes: string;
}

// ─── Check-in ────────────────────────────────────────────────────────────────

export type MoodLevel = 1 | 2 | 3 | 4 | 5; // 1=awful 5=amazing

export interface CheckIn {
    id: string;
    date: string;          // YYYY-MM-DD
    mood: MoodLevel;
    note: string;
    timestamp: number;
}

// ─── Daily Briefing ──────────────────────────────────────────────────────────

export interface DailyBriefing {
    date: string;
    greeting: string;
    motivationalQuote: string;
    habitsToComplete: string[];      // habit names not yet done today
    habitsCompleted: string[];       // already done today
    upcomingDeadlines: Array<{ title: string; daysLeft: number }>;
    moodContext: string;             // based on recent check-ins
    streakNote: string;
    generatedAt: number;
}

// ─── Storage Keys ─────────────────────────────────────────────────────────────

const HABITS_KEY   = 'echo_habits';
const GOALS_KEY    = 'echo_goals';
const CHECKINS_KEY = 'echo_checkins';
const BRIEFING_KEY = 'echo_daily_briefing';

// ─── Motivational quotes (built-in pool) ──────────────────────────────────────

const QUOTES = [
    { text: "You don't have to be great to start, but you have to start to be great.", author: "Zig Ziglar" },
    { text: "Progress, not perfection.", author: "Unknown" },
    { text: "Small consistent actions compound into extraordinary results.", author: "James Clear" },
    { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
    { text: "Done is better than perfect.", author: "Sheryl Sandberg" },
    { text: "You are allowed to be both a masterpiece and a work in progress.", author: "Sophia Bush" },
    { text: "Rest if you must, but don't you quit.", author: "Edgar A. Guest" },
    { text: "Your future self is watching you right now through your memories.", author: "Unknown" },
    { text: "The person who moved the mountain began by carrying away small stones.", author: "Chinese Proverb" },
    { text: "You have been assigned this mountain to show others it can be moved.", author: "Unknown" },
    { text: "Be proud of how far you've come, not just how far you need to go.", author: "Unknown" },
    { text: "Discipline is choosing between what you want now and what you want most.", author: "Unknown" },
    { text: "It always seems impossible until it is done.", author: "Nelson Mandela" },
    { text: "Fall seven times, stand up eight.", author: "Japanese Proverb" },
    { text: "The only way out is through.", author: "Robert Frost" },
];

export function getRandomQuote(): { text: string; author: string } {
    return QUOTES[Math.floor(Math.random() * QUOTES.length)];
}

// ─── Habit CRUD ───────────────────────────────────────────────────────────────

export function getHabits(): Habit[] {
    return getCached<Habit[]>(HABITS_KEY, []);
}

export function saveHabits(habits: Habit[]): void {
    setCached(HABITS_KEY, habits);
}

export function addHabit(input: Omit<Habit, 'id' | 'streak' | 'bestStreak' | 'completedDates' | 'createdAt' | 'active'>): Habit {
    const habits = getHabits();
    const habit: Habit = {
        ...input,
        id: crypto.randomUUID(),
        streak: 0,
        bestStreak: 0,
        completedDates: [],
        createdAt: Date.now(),
        active: true,
    };
    habits.push(habit);
    saveHabits(habits);
    return habit;
}

export function completeHabit(id: string): Habit | null {
    const habits = getHabits();
    const idx = habits.findIndex(h => h.id === id);
    if (idx < 0) return null;

    const today = new Date().toLocaleDateString('en-CA');
    const h = { ...habits[idx] };

    if (h.completedDates.includes(today)) return h; // already done

    const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');
    h.streak = (h.lastCompleted === yesterday || h.lastCompleted === today) ? h.streak + 1 : 1;
    h.bestStreak = Math.max(h.streak, h.bestStreak);
    h.lastCompleted = today;
    h.completedDates = [...h.completedDates.slice(-364), today]; // keep 1 year

    habits[idx] = h;
    saveHabits(habits);
    return h;
}

export function updateHabit(id: string, patch: Partial<Habit>): void {
    const habits = getHabits();
    const idx = habits.findIndex(h => h.id === id);
    if (idx < 0) return;
    habits[idx] = { ...habits[idx], ...patch };
    saveHabits(habits);
}

export function deleteHabit(id: string): void {
    saveHabits(getHabits().filter(h => h.id !== id));
}

/** Returns habits that haven't been completed today. */
export function getPendingHabitsToday(): Habit[] {
    const today = new Date().toLocaleDateString('en-CA');
    return getHabits().filter(h => h.active && h.frequency === 'daily' && h.lastCompleted !== today);
}

/** Returns habits completed today. */
export function getCompletedHabitsToday(): Habit[] {
    const today = new Date().toLocaleDateString('en-CA');
    return getHabits().filter(h => h.lastCompleted === today);
}

// ─── Goal CRUD ────────────────────────────────────────────────────────────────

export function getGoals(): Goal[] {
    return getCached<Goal[]>(GOALS_KEY, []);
}

export function saveGoals(goals: Goal[]): void {
    setCached(GOALS_KEY, goals);
}

export function addGoal(input: Omit<Goal, 'id' | 'createdAt' | 'updatedAt' | 'progress' | 'status'>): Goal {
    const goals = getGoals();
    const goal: Goal = {
        ...input,
        id: crypto.randomUUID(),
        progress: 0,
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
    goals.push(goal);
    saveGoals(goals);
    return goal;
}

export function updateGoal(id: string, patch: Partial<Goal>): void {
    const goals = getGoals();
    const idx = goals.findIndex(g => g.id === id);
    if (idx < 0) return;
    goals[idx] = { ...goals[idx], ...patch, updatedAt: Date.now() };
    // Auto-compute progress from milestones
    const g = goals[idx];
    if (g.milestones.length > 0) {
        const done = g.milestones.filter(m => m.completed).length;
        goals[idx].progress = Math.round((done / g.milestones.length) * 100);
    }
    saveGoals(goals);
}

export function completeMilestone(goalId: string, milestoneId: string): void {
    const goals = getGoals();
    const idx = goals.findIndex(g => g.id === goalId);
    if (idx < 0) return;
    const mIdx = goals[idx].milestones.findIndex(m => m.id === milestoneId);
    if (mIdx < 0) return;
    goals[idx].milestones[mIdx] = { ...goals[idx].milestones[mIdx], completed: true, completedAt: Date.now() };
    updateGoal(goalId, { milestones: goals[idx].milestones });
}

export function deleteGoal(id: string): void {
    saveGoals(getGoals().filter(g => g.id !== id));
}

export function getActiveGoals(): Goal[] {
    return getGoals().filter(g => g.status === 'active');
}

// ─── Check-in ────────────────────────────────────────────────────────────────

export function getCheckIns(): CheckIn[] {
    return getCached<CheckIn[]>(CHECKINS_KEY, []);
}

export function addCheckIn(mood: MoodLevel, note: string = ''): CheckIn {
    const checkIns = getCheckIns();
    const ci: CheckIn = {
        id: crypto.randomUUID(),
        date: new Date().toLocaleDateString('en-CA'),
        mood,
        note,
        timestamp: Date.now(),
    };
    checkIns.push(ci);
    // Keep last 90 days
    const cutoff = Date.now() - 90 * 86400000;
    setCached(CHECKINS_KEY, checkIns.filter(c => c.timestamp >= cutoff));
    return ci;
}

export function getLatestMood(): MoodLevel | null {
    const cis = getCheckIns();
    if (cis.length === 0) return null;
    return cis[cis.length - 1].mood;
}

export function getAverageMoodThisWeek(): number {
    const cis = getCheckIns();
    const cutoff = Date.now() - 7 * 86400000;
    const week = cis.filter(c => c.timestamp >= cutoff);
    if (week.length === 0) return 3;
    return week.reduce((sum, c) => sum + c.mood, 0) / week.length;
}

// ─── Daily Briefing ──────────────────────────────────────────────────────────

export function generateDailyBriefing(upcomingDeadlines: Array<{ title: string; daysLeft: number }> = []): DailyBriefing {
    const state = getCompanionState();
    const today = new Date().toLocaleDateString('en-CA');
    const quote = getRandomQuote();

    const pendingHabits = getPendingHabitsToday().map(h => h.name);
    const completedHabits = getCompletedHabitsToday().map(h => h.name);
    const avgMood = getAverageMoodThisWeek();

    let moodContext = '';
    if (avgMood >= 4) moodContext = "You've been in great spirits this week — keep that energy!";
    else if (avgMood >= 3) moodContext = "You've been doing okay — one step at a time.";
    else if (avgMood >= 2) moodContext = "It's been a tough week. Be kind to yourself today.";
    else moodContext = "Things have been hard lately. I'm here with you. Let's take it slow.";

    const streakNote = state.streakDays >= 7
        ? `🔥 ${state.streakDays}-day streak! You keep showing up — that's everything.`
        : state.streakDays >= 3
        ? `⚡ ${state.streakDays} days in a row. Building something real here.`
        : state.streakDays === 1
        ? `Welcome back! Every day you show up counts.`
        : '';

    const name = state.userName || '';
    const greeting = name
        ? `Good ${getTimeOfDay()}, ${name}!`
        : `Good ${getTimeOfDay()}!`;

    const briefing: DailyBriefing = {
        date: today,
        greeting,
        motivationalQuote: `"${quote.text}" — ${quote.author}`,
        habitsToComplete: pendingHabits,
        habitsCompleted: completedHabits,
        upcomingDeadlines,
        moodContext,
        streakNote,
        generatedAt: Date.now(),
    };

    setCached(BRIEFING_KEY, briefing);
    return briefing;
}

export function getCachedBriefing(): DailyBriefing | null {
    const b = getCached<DailyBriefing | null>(BRIEFING_KEY, null);
    if (!b) return null;
    // Invalidate if older than 4 hours
    if (Date.now() - b.generatedAt > 4 * 3600 * 1000) return null;
    return b;
}

function getTimeOfDay(): string {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) return 'morning';
    if (h >= 12 && h < 17) return 'afternoon';
    if (h >= 17 && h < 22) return 'evening';
    return 'night';
}

// ─── Summary string for system context ───────────────────────────────────────

export function buildLifeCoachContext(): string {
    const habits = getHabits().filter(h => h.active);
    const goals = getActiveGoals();
    const latestMood = getLatestMood();

    const parts: string[] = [];

    if (habits.length > 0) {
        const pendingToday = getPendingHabitsToday();
        parts.push(`[HABITS]\nTracking ${habits.length} habit(s). Today pending: ${pendingToday.map(h => h.name).join(', ') || 'none — all done!'}\nStreak leaders: ${habits.sort((a, b) => b.streak - a.streak).slice(0, 3).map(h => `${h.name} (${h.streak} day streak)`).join(', ')}`);
    }

    if (goals.length > 0) {
        parts.push(`[GOALS]\n${goals.map(g => `- ${g.title} (${g.progress}% done${g.deadline ? `, due ${g.deadline}` : ''}): "${g.why}"`).join('\n')}`);
    }

    if (latestMood !== null) {
        const moodLabels = { 1: 'awful', 2: 'rough', 3: 'okay', 4: 'good', 5: 'amazing' };
        parts.push(`[MOOD]\nUser's latest check-in: feeling ${moodLabels[latestMood]} (${latestMood}/5). Average this week: ${getAverageMoodThisWeek().toFixed(1)}/5.`);
    }

    return parts.join('\n\n');
}

// ─── Default habits suggestions ───────────────────────────────────────────────

export const HABIT_TEMPLATES: Array<Omit<Habit, 'id' | 'streak' | 'bestStreak' | 'completedDates' | 'createdAt' | 'active' | 'lastCompleted'>> = [
    { name: 'Morning Water', category: 'health', frequency: 'daily', icon: '💧', reminderTime: '07:00' },
    { name: 'Exercise', category: 'health', frequency: 'daily', icon: '🏃', reminderTime: '07:30' },
    { name: 'Read 10 pages', category: 'learning', frequency: 'daily', icon: '📖', reminderTime: '21:00' },
    { name: 'Meditate', category: 'mindfulness', frequency: 'daily', icon: '🧘', reminderTime: '08:00' },
    { name: 'No social media before 10am', category: 'productivity', frequency: 'daily', icon: '📵' },
    { name: 'Journaling', category: 'mindfulness', frequency: 'daily', icon: '✍️', reminderTime: '22:00' },
    { name: 'Gratitude (3 things)', category: 'mindfulness', frequency: 'daily', icon: '🙏', reminderTime: '21:30' },
    { name: 'Weekly review', category: 'productivity', frequency: 'weekly', icon: '📊' },
];
