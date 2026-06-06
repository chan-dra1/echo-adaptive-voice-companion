/**
 * OnboardingWizard.tsx
 *
 * First-run "train your AI" flow. Appears when onboarding is not complete.
 * Walks the user through 6 steps over their first session(s):
 *
 *  Step 0 – Welcome & name
 *  Step 1 – Personality & work style
 *  Step 2 – Goals & dreams
 *  Step 3 – Habits to build
 *  Step 4 – Schedule & availability
 *  Step 5 – Companion style / tone
 *
 * Everything is saved as local_only encrypted memory so Echo truly knows you.
 */

import React, { useState } from 'react';
import {
    getCompanionState,
    saveCompanionState,
    saveOnboardingMemory,
    COMPANION_MODES,
    CompanionMode,
} from '../services/companionPersonaService';
import { addHabit, HABIT_TEMPLATES } from '../services/lifeCoachService';
import { addGoal } from '../services/lifeCoachService';
import { Heart, Target, Calendar, Smile, ChevronRight, ChevronLeft, Check, X } from 'lucide-react';

interface Props {
    onComplete: () => void;
    onSkip: () => void;
}

const TOTAL_STEPS = 6;

export default function OnboardingWizard({ onComplete, onSkip }: Props) {
    const [step, setStep] = useState(0);
    const [saving, setSaving] = useState(false);

    // Step 0
    const [userName, setUserName] = useState('');
    const [companionName, setCompanionName] = useState('Echo');
    // Step 1
    const [workStyle, setWorkStyle] = useState('');
    const [personality, setPersonality] = useState('');
    const [challenges, setChallenges] = useState('');
    // Step 2
    const [goalTitle, setGoalTitle] = useState('');
    const [goalWhy, setGoalWhy] = useState('');
    const [goalDeadline, setGoalDeadline] = useState('');
    // Step 3
    const [selectedHabits, setSelectedHabits] = useState<number[]>([]);
    const [customHabit, setCustomHabit] = useState('');
    // Step 4
    const [wakeTime, setWakeTime] = useState('07:00');
    const [sleepTime, setSleepTime] = useState('23:00');
    const [workStart, setWorkStart] = useState('09:00');
    const [workEnd, setWorkEnd] = useState('18:00');
    // Step 5
    const [companionMode, setCompanionMode] = useState<CompanionMode>('friend');
    const [warmth, setWarmth] = useState(4);
    const [proactivity, setProactivity] = useState(4);
    const [humor, setHumor] = useState(3);

    const progress = ((step) / (TOTAL_STEPS - 1)) * 100;

    const next = () => {
        if (step < TOTAL_STEPS - 1) {
            saveCompanionState({ onboardingStep: step + 1 });
            setStep(s => s + 1);
        }
    };
    const back = () => setStep(s => Math.max(0, s - 1));

    const finish = async () => {
        setSaving(true);
        try {
            // Save all as encrypted local_only memory
            if (userName) {
                saveCompanionState({ userName, companionName });
                saveOnboardingMemory('user_name', userName);
                saveOnboardingMemory('companion_name', companionName);
            }
            if (workStyle) saveOnboardingMemory('work_style', workStyle);
            if (personality) saveOnboardingMemory('personality_type', personality);
            if (challenges) saveOnboardingMemory('main_challenges', challenges);
            if (goalTitle) {
                addGoal({
                    title: goalTitle,
                    why: goalWhy,
                    category: 'personal',
                    deadline: goalDeadline || undefined,
                    milestones: [],
                    notes: '',
                });
                saveOnboardingMemory('primary_goal', goalTitle);
                if (goalWhy) saveOnboardingMemory('goal_motivation', goalWhy);
            }
            // Add selected habits
            selectedHabits.forEach(i => {
                const t = HABIT_TEMPLATES[i];
                if (t) addHabit({ ...t, lastCompleted: null });
            });
            if (customHabit.trim()) {
                addHabit({ name: customHabit.trim(), category: 'custom', frequency: 'daily', icon: '⭐', lastCompleted: null });
            }
            // Schedule info
            saveOnboardingMemory('wake_time', wakeTime);
            saveOnboardingMemory('sleep_time', sleepTime);
            saveOnboardingMemory('work_hours', `${workStart} - ${workEnd}`);
            // Companion style
            saveCompanionState({
                mode: companionMode,
                onboardingComplete: true,
                onboardingStep: TOTAL_STEPS,
                personality: { warmth, proactivity, humor, formality: 6 - warmth },
            });

            onComplete();
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
            <div className="w-full max-w-lg bg-gray-900 border border-green-500/30 rounded-2xl overflow-hidden shadow-2xl shadow-green-500/10">
                {/* Header */}
                <div className="bg-gradient-to-r from-green-900/40 to-teal-900/40 px-6 py-4 flex items-center justify-between border-b border-green-500/20">
                    <div>
                        <h2 className="text-white font-bold text-lg">Let's set up your companion 🌟</h2>
                        <p className="text-green-400 text-xs mt-0.5">Step {step + 1} of {TOTAL_STEPS} — all saved locally &amp; encrypted</p>
                    </div>
                    <button onClick={onSkip} className="text-gray-500 hover:text-gray-300 transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Progress bar */}
                <div className="h-1 bg-gray-800">
                    <div
                        className="h-full bg-gradient-to-r from-green-500 to-teal-400 transition-all duration-500"
                        style={{ width: `${progress}%` }}
                    />
                </div>

                {/* Content */}
                <div className="p-6 min-h-[340px] flex flex-col">
                    {step === 0 && <StepWelcome userName={userName} setUserName={setUserName} companionName={companionName} setCompanionName={setCompanionName} />}
                    {step === 1 && <StepPersonality workStyle={workStyle} setWorkStyle={setWorkStyle} personality={personality} setPersonality={setPersonality} challenges={challenges} setChallenges={setChallenges} />}
                    {step === 2 && <StepGoals goalTitle={goalTitle} setGoalTitle={setGoalTitle} goalWhy={goalWhy} setGoalWhy={setGoalWhy} goalDeadline={goalDeadline} setGoalDeadline={setGoalDeadline} />}
                    {step === 3 && <StepHabits selectedHabits={selectedHabits} setSelectedHabits={setSelectedHabits} customHabit={customHabit} setCustomHabit={setCustomHabit} />}
                    {step === 4 && <StepSchedule wakeTime={wakeTime} setWakeTime={setWakeTime} sleepTime={sleepTime} setSleepTime={setSleepTime} workStart={workStart} setWorkStart={setWorkStart} workEnd={workEnd} setWorkEnd={setWorkEnd} />}
                    {step === 5 && <StepCompanionStyle companionMode={companionMode} setCompanionMode={setCompanionMode} warmth={warmth} setWarmth={setWarmth} proactivity={proactivity} setProactivity={setProactivity} humor={humor} setHumor={setHumor} />}
                </div>

                {/* Footer */}
                <div className="px-6 pb-6 flex items-center justify-between gap-3">
                    {step > 0 ? (
                        <button onClick={back} className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm transition-colors">
                            <ChevronLeft size={16} /> Back
                        </button>
                    ) : (
                        <button onClick={onSkip} className="text-gray-600 hover:text-gray-400 text-xs transition-colors">Skip for now</button>
                    )}

                    {step < TOTAL_STEPS - 1 ? (
                        <button onClick={next} className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors ml-auto">
                            Continue <ChevronRight size={16} />
                        </button>
                    ) : (
                        <button onClick={finish} disabled={saving} className="flex items-center gap-2 bg-gradient-to-r from-green-600 to-teal-500 hover:from-green-500 hover:to-teal-400 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-all ml-auto disabled:opacity-50">
                            {saving ? 'Saving…' : <><Check size={16} /> Start with Echo</>}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Step Components ──────────────────────────────────────────────────────────

function StepWelcome({ userName, setUserName, companionName, setCompanionName }: any) {
    return (
        <div className="flex flex-col gap-5 flex-1">
            <div>
                <div className="text-3xl mb-2">👋</div>
                <h3 className="text-white font-semibold text-xl">Hi! I'm Echo.</h3>
                <p className="text-gray-400 text-sm mt-1">I'm going to be your 24/7 companion — your guide, friend, and supporter. Let me learn a little about you so I can be genuinely helpful.</p>
            </div>
            <div className="space-y-4">
                <div>
                    <label className="text-green-400 text-xs font-medium uppercase tracking-wide block mb-1.5">What should I call you?</label>
                    <input
                        value={userName}
                        onChange={e => setUserName(e.target.value)}
                        placeholder="Your name or nickname"
                        className="w-full bg-gray-800 border border-gray-700 focus:border-green-500 rounded-lg px-4 py-2.5 text-white text-sm outline-none transition-colors"
                    />
                </div>
                <div>
                    <label className="text-green-400 text-xs font-medium uppercase tracking-wide block mb-1.5">What do you want to call me? (optional)</label>
                    <input
                        value={companionName}
                        onChange={e => setCompanionName(e.target.value)}
                        placeholder="Echo, Aria, Sol, Max…"
                        className="w-full bg-gray-800 border border-gray-700 focus:border-green-500 rounded-lg px-4 py-2.5 text-white text-sm outline-none transition-colors"
                    />
                </div>
            </div>
        </div>
    );
}

function StepPersonality({ workStyle, setWorkStyle, personality, setPersonality, challenges, setChallenges }: any) {
    const styles = ['Deep focus (few long sessions)', 'Sprint & rest (pomodoro)', 'Flexible / go with the flow', 'Morning person', 'Night owl'];
    const types = ['Introvert', 'Extrovert', 'Ambivert', 'Analytical thinker', 'Creative thinker', 'Big picture person', 'Detail oriented'];

    return (
        <div className="flex flex-col gap-5 flex-1">
            <div>
                <div className="text-3xl mb-2">🧠</div>
                <h3 className="text-white font-semibold text-lg">How do you work best?</h3>
                <p className="text-gray-400 text-sm mt-1">This helps me support your natural rhythm instead of fighting it.</p>
            </div>
            <div>
                <label className="text-green-400 text-xs font-medium uppercase tracking-wide block mb-2">Work style</label>
                <div className="flex flex-wrap gap-2">
                    {styles.map(s => (
                        <button key={s} onClick={() => setWorkStyle(s)} className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${workStyle === s ? 'border-green-500 bg-green-500/20 text-green-300' : 'border-gray-700 text-gray-400 hover:border-gray-500'}`}>{s}</button>
                    ))}
                </div>
            </div>
            <div>
                <label className="text-green-400 text-xs font-medium uppercase tracking-wide block mb-2">I'd describe myself as</label>
                <div className="flex flex-wrap gap-2">
                    {types.map(t => (
                        <button key={t} onClick={() => setPersonality(p => p === t ? '' : t)} className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${personality === t ? 'border-teal-500 bg-teal-500/20 text-teal-300' : 'border-gray-700 text-gray-400 hover:border-gray-500'}`}>{t}</button>
                    ))}
                </div>
            </div>
            <div>
                <label className="text-green-400 text-xs font-medium uppercase tracking-wide block mb-1.5">My biggest challenge is…</label>
                <input value={challenges} onChange={e => setChallenges(e.target.value)} placeholder="e.g. procrastination, staying focused, stress…" className="w-full bg-gray-800 border border-gray-700 focus:border-green-500 rounded-lg px-4 py-2.5 text-white text-sm outline-none transition-colors" />
            </div>
        </div>
    );
}

function StepGoals({ goalTitle, setGoalTitle, goalWhy, setGoalWhy, goalDeadline, setGoalDeadline }: any) {
    return (
        <div className="flex flex-col gap-5 flex-1">
            <div>
                <div className="text-3xl mb-2"><Target size={32} className="text-yellow-400" /></div>
                <h3 className="text-white font-semibold text-lg">What's your most important goal right now?</h3>
                <p className="text-gray-400 text-sm mt-1">I'll keep you on track, remind you why it matters, and celebrate every step forward.</p>
            </div>
            <div className="space-y-4">
                <div>
                    <label className="text-green-400 text-xs font-medium uppercase tracking-wide block mb-1.5">Goal</label>
                    <input value={goalTitle} onChange={e => setGoalTitle(e.target.value)} placeholder="e.g. Launch my app, lose 10kg, learn Spanish…" className="w-full bg-gray-800 border border-gray-700 focus:border-green-500 rounded-lg px-4 py-2.5 text-white text-sm outline-none transition-colors" />
                </div>
                <div>
                    <label className="text-green-400 text-xs font-medium uppercase tracking-wide block mb-1.5">Why does this matter to you? (this keeps you going)</label>
                    <textarea value={goalWhy} onChange={e => setGoalWhy(e.target.value)} placeholder="Be honest — the deeper the why, the stronger the drive…" rows={2} className="w-full bg-gray-800 border border-gray-700 focus:border-green-500 rounded-lg px-4 py-2.5 text-white text-sm outline-none transition-colors resize-none" />
                </div>
                <div>
                    <label className="text-green-400 text-xs font-medium uppercase tracking-wide block mb-1.5">Deadline (optional)</label>
                    <input type="date" value={goalDeadline} onChange={e => setGoalDeadline(e.target.value)} className="bg-gray-800 border border-gray-700 focus:border-green-500 rounded-lg px-4 py-2.5 text-white text-sm outline-none transition-colors" />
                </div>
            </div>
        </div>
    );
}

function StepHabits({ selectedHabits, setSelectedHabits, customHabit, setCustomHabit }: any) {
    const toggle = (i: number) => setSelectedHabits((prev: number[]) => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]);

    return (
        <div className="flex flex-col gap-4 flex-1">
            <div>
                <div className="text-3xl mb-2">✅</div>
                <h3 className="text-white font-semibold text-lg">Which habits do you want to build?</h3>
                <p className="text-gray-400 text-sm mt-1">I'll track your streaks and cheer you on every day.</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
                {HABIT_TEMPLATES.map((h, i) => (
                    <button key={i} onClick={() => toggle(i)} className={`flex items-center gap-2 text-left text-xs px-3 py-2.5 rounded-lg border transition-colors ${selectedHabits.includes(i) ? 'border-green-500 bg-green-500/15 text-green-300' : 'border-gray-700 text-gray-400 hover:border-gray-500'}`}>
                        <span className="text-base">{h.icon}</span>
                        <span>{h.name}</span>
                        {selectedHabits.includes(i) && <Check size={10} className="ml-auto text-green-400 flex-shrink-0" />}
                    </button>
                ))}
            </div>
            <div>
                <label className="text-green-400 text-xs font-medium uppercase tracking-wide block mb-1.5">Or add your own</label>
                <input value={customHabit} onChange={e => setCustomHabit(e.target.value)} placeholder="e.g. Practice guitar, cold shower…" className="w-full bg-gray-800 border border-gray-700 focus:border-green-500 rounded-lg px-4 py-2.5 text-white text-sm outline-none transition-colors" />
            </div>
        </div>
    );
}

function StepSchedule({ wakeTime, setWakeTime, sleepTime, setSleepTime, workStart, setWorkStart, workEnd, setWorkEnd }: any) {
    return (
        <div className="flex flex-col gap-5 flex-1">
            <div>
                <div className="text-3xl mb-2"><Calendar size={32} className="text-blue-400" /></div>
                <h3 className="text-white font-semibold text-lg">Tell me about your day</h3>
                <p className="text-gray-400 text-sm mt-1">I'll send reminders and check-ins at the right times — never when you're asleep or in deep work.</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
                {[
                    { label: '☀️ Wake up', value: wakeTime, set: setWakeTime },
                    { label: '🌙 Sleep time', value: sleepTime, set: setSleepTime },
                    { label: '💼 Work starts', value: workStart, set: setWorkStart },
                    { label: '🏠 Work ends', value: workEnd, set: setWorkEnd },
                ].map(({ label, value, set }) => (
                    <div key={label}>
                        <label className="text-gray-400 text-xs block mb-1.5">{label}</label>
                        <input type="time" value={value} onChange={e => set(e.target.value)} className="w-full bg-gray-800 border border-gray-700 focus:border-green-500 rounded-lg px-3 py-2.5 text-white text-sm outline-none transition-colors" />
                    </div>
                ))}
            </div>
            <p className="text-gray-600 text-xs">Echo will never interrupt your sleep hours or deep work blocks unless it's an emergency.</p>
        </div>
    );
}

function StepCompanionStyle({ companionMode, setCompanionMode, warmth, setWarmth, proactivity, setProactivity, humor, setHumor }: any) {
    return (
        <div className="flex flex-col gap-5 flex-1">
            <div>
                <div className="text-3xl mb-2"><Heart size={32} className="text-pink-400" /></div>
                <h3 className="text-white font-semibold text-lg">How should I show up for you?</h3>
                <p className="text-gray-400 text-sm mt-1">You can always change this later.</p>
            </div>
            <div>
                <label className="text-green-400 text-xs font-medium uppercase tracking-wide block mb-2">Companion style</label>
                <div className="grid grid-cols-1 gap-2">
                    {COMPANION_MODES.map(m => (
                        <button key={m.id} onClick={() => setCompanionMode(m.id)} className={`flex items-center gap-3 text-left px-4 py-3 rounded-xl border transition-colors ${companionMode === m.id ? 'border-green-500 bg-green-500/15' : 'border-gray-700 hover:border-gray-500'}`}>
                            <span className="text-xl">{m.emoji}</span>
                            <div>
                                <div className={`text-sm font-medium ${companionMode === m.id ? 'text-green-300' : 'text-white'}`}>{m.label}</div>
                                <div className="text-gray-500 text-xs">{m.description}</div>
                            </div>
                            {companionMode === m.id && <Check size={14} className="ml-auto text-green-400 flex-shrink-0" />}
                        </button>
                    ))}
                </div>
            </div>
            <div className="space-y-3">
                {[
                    { label: '❤️ Warmth', value: warmth, set: setWarmth, left: 'Professional', right: 'Very warm' },
                    { label: '⚡ Proactivity', value: proactivity, set: setProactivity, left: 'Only when asked', right: 'Very proactive' },
                    { label: '😄 Humor', value: humor, set: setHumor, left: 'Serious', right: 'Playful' },
                ].map(({ label, value, set, left, right }) => (
                    <div key={label}>
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-gray-400 text-xs">{label}</span>
                            <span className="text-green-400 text-xs">{value}/5</span>
                        </div>
                        <input type="range" min={1} max={5} value={value} onChange={e => set(Number(e.target.value))} className="w-full accent-green-500" />
                        <div className="flex justify-between text-gray-600 text-xs mt-0.5">
                            <span>{left}</span><span>{right}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
