/**
 * CompanionPanel.tsx
 *
 * The heart of the companion experience — a beautiful side panel showing:
 *  - Today's personalized briefing (greeting, quote, schedule overview)
 *  - Habits with streaks and one-tap completion
 *  - Active goals with progress bars
 *  - Quick mood check-in
 *  - Companion mode selector
 *  - Deadline guardian status
 *  - Ambient mode controls
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
    getCompanionState,
    saveCompanionState,
    COMPANION_MODES,
    CompanionMode,
} from '../services/companionPersonaService';
import {
    getHabits,
    completeHabit,
    getPendingHabitsToday,
    getCompletedHabitsToday,
    getActiveGoals,
    addCheckIn,
    getLatestMood,
    generateDailyBriefing,
    getCachedBriefing,
    MoodLevel,
    Habit,
    Goal,
} from '../services/lifeCoachService';
import {
    getActiveDeadlinePlans,
    getDaysLeft,
} from '../services/deadlineGuardianService';
import {
    ambientModeService,
    getAmbientConfig,
    saveAmbientConfig,
    AMBIENT_STATUS_LABELS,
    AMBIENT_STATUS_COLORS,
    BACKGROUND_LIMITATIONS,
} from '../services/ambientModeService';
import {
    Heart, Target, Calendar, Zap, CheckCircle, Circle,
    Flame, Star, ChevronDown, ChevronUp, Volume2, VolumeX,
    Clock, AlertTriangle, Smile, Meh, Frown, X, Info,
} from 'lucide-react';

interface Props {
    onClose: () => void;
}

export default function CompanionPanel({ onClose }: Props) {
    const [tab, setTab] = useState<'briefing' | 'habits' | 'goals' | 'settings'>('briefing');
    const [habits, setHabits] = useState(getHabits());
    const [goals, setGoals] = useState(getActiveGoals());
    const [deadlines, setDeadlines] = useState(getActiveDeadlinePlans());
    const [companionState, setCompanionState] = useState(getCompanionState());
    const [briefing, setBriefing] = useState(() => getCachedBriefing() || generateDailyBriefing(getActiveDeadlinePlans().map(d => ({ title: d.title, daysLeft: d.daysLeft }))));
    const [moodLogged, setMoodLogged] = useState(false);
    const [ambientStatus, setAmbientStatus] = useState(ambientModeService.currentStatus);
    const [showBackgroundInfo, setShowBackgroundInfo] = useState(false);
    const [completingId, setCompletingId] = useState<string | null>(null);

    const refresh = useCallback(() => {
        setHabits(getHabits());
        setGoals(getActiveGoals());
        setDeadlines(getActiveDeadlinePlans());
        setCompanionState(getCompanionState());
    }, []);

    useEffect(() => {
        const onAmbient = (e: Event) => setAmbientStatus((e as CustomEvent).detail);
        window.addEventListener('ambient:status-change', onAmbient);
        return () => window.removeEventListener('ambient:status-change', onAmbient);
    }, []);

    const handleCompleteHabit = async (id: string) => {
        setCompletingId(id);
        setTimeout(() => {
            completeHabit(id);
            setHabits(getHabits());
            setCompletingId(null);
        }, 300);
    };

    const handleMood = (mood: MoodLevel) => {
        addCheckIn(mood);
        setMoodLogged(true);
        // Refresh briefing with mood context
        setBriefing(generateDailyBriefing(deadlines.map(d => ({ title: d.title, daysLeft: d.daysLeft }))));
    };

    const handleCompanionMode = (mode: CompanionMode) => {
        saveCompanionState({ mode });
        setCompanionState(getCompanionState());
    };

    const toggleAmbientMode = () => {
        const config = getAmbientConfig();
        const newEnabled = !config.enabled;
        saveAmbientConfig({ enabled: newEnabled });
        ambientModeService.setEnabled(newEnabled);
        setAmbientStatus(ambientModeService.currentStatus);
    };

    const pendingHabits = getPendingHabitsToday();
    const completedHabits = getCompletedHabitsToday();
    const latestMood = getLatestMood();

    const moodEmoji: Record<MoodLevel, string> = { 1: '😞', 2: '😕', 3: '😐', 4: '🙂', 5: '😄' };
    const moodLabel: Record<MoodLevel, string> = { 1: 'Awful', 2: 'Rough', 3: 'Okay', 4: 'Good', 5: 'Amazing' };

    return (
        <div className="flex flex-col h-full bg-gray-900 text-white">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                <div className="flex items-center gap-2">
                    <Heart size={18} className="text-pink-400" />
                    <span className="font-semibold text-sm">Companion</span>
                    {companionState.streakDays > 0 && (
                        <span className="flex items-center gap-1 bg-orange-500/20 text-orange-300 text-xs px-2 py-0.5 rounded-full">
                            <Flame size={10} /> {companionState.streakDays}d
                        </span>
                    )}
                </div>
                <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
                    <X size={16} />
                </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-800 text-xs">
                {(['briefing', 'habits', 'goals', 'settings'] as const).map(t => (
                    <button key={t} onClick={() => setTab(t)} className={`flex-1 py-2.5 capitalize transition-colors ${tab === t ? 'text-green-400 border-b-2 border-green-400' : 'text-gray-500 hover:text-gray-300'}`}>
                        {t}
                        {t === 'habits' && pendingHabits.length > 0 && (
                            <span className="ml-1 bg-green-600 text-white text-xs rounded-full w-4 h-4 inline-flex items-center justify-center">{pendingHabits.length}</span>
                        )}
                        {t === 'goals' && goals.length > 0 && (
                            <span className="ml-1 text-gray-600">({goals.length})</span>
                        )}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">

                {/* ── BRIEFING TAB ── */}
                {tab === 'briefing' && (
                    <>
                        {/* Greeting */}
                        <div className="bg-gradient-to-br from-green-900/30 to-teal-900/30 rounded-xl p-4 border border-green-500/20">
                            <p className="text-green-300 font-medium text-sm">{briefing.greeting}</p>
                            {briefing.streakNote && <p className="text-orange-300 text-xs mt-1">{briefing.streakNote}</p>}
                            <p className="text-gray-400 text-xs mt-2 italic">{briefing.motivationalQuote}</p>
                        </div>

                        {/* Mood check-in */}
                        {!moodLogged && !latestMood && (
                            <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                                <p className="text-gray-300 text-sm font-medium mb-3">How are you feeling right now?</p>
                                <div className="flex justify-between">
                                    {([1, 2, 3, 4, 5] as MoodLevel[]).map(m => (
                                        <button key={m} onClick={() => handleMood(m)} className="flex flex-col items-center gap-1 hover:scale-110 transition-transform">
                                            <span className="text-xl">{moodEmoji[m]}</span>
                                            <span className="text-gray-500 text-xs">{moodLabel[m]}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {moodLogged && (
                            <div className="bg-teal-900/20 rounded-xl p-3 border border-teal-500/20 text-teal-300 text-xs text-center">
                                ✓ Mood logged — I'll keep this in mind today.
                            </div>
                        )}

                        {/* Today's habits snapshot */}
                        {(pendingHabits.length > 0 || completedHabits.length > 0) && (
                            <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                                <p className="text-gray-300 text-sm font-medium mb-2">Today's habits</p>
                                <div className="space-y-1.5">
                                    {completedHabits.map(h => (
                                        <div key={h.id} className="flex items-center gap-2 text-xs text-gray-500 line-through">
                                            <CheckCircle size={12} className="text-green-500 flex-shrink-0" />
                                            {h.icon} {h.name}
                                            {h.streak > 1 && <span className="text-orange-400 not-italic no-underline ml-auto">🔥 {h.streak}</span>}
                                        </div>
                                    ))}
                                    {pendingHabits.slice(0, 3).map(h => (
                                        <div key={h.id} className="flex items-center gap-2 text-xs text-gray-300">
                                            <Circle size={12} className="text-gray-600 flex-shrink-0" />
                                            {h.icon} {h.name}
                                        </div>
                                    ))}
                                    {pendingHabits.length > 3 && <p className="text-gray-600 text-xs">+{pendingHabits.length - 3} more — see Habits tab</p>}
                                </div>
                            </div>
                        )}

                        {/* Deadlines */}
                        {deadlines.length > 0 && (
                            <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                                <p className="text-gray-300 text-sm font-medium mb-2 flex items-center gap-1.5"><AlertTriangle size={14} className="text-yellow-400" /> Upcoming deadlines</p>
                                <div className="space-y-2">
                                    {deadlines.slice(0, 3).map(d => (
                                        <div key={d.taskId} className="flex items-center justify-between text-xs">
                                            <span className="text-gray-300 truncate flex-1 mr-2">{d.title}</span>
                                            <span className={`flex-shrink-0 font-medium ${d.daysLeft === 0 ? 'text-red-400' : d.daysLeft <= 2 ? 'text-orange-400' : d.daysLeft <= 5 ? 'text-yellow-400' : 'text-gray-400'}`}>
                                                {d.daysLeft === 0 ? 'TODAY' : d.daysLeft === 1 ? 'Tomorrow' : `${d.daysLeft}d left`}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Mood context */}
                        {briefing.moodContext && (
                            <p className="text-gray-500 text-xs px-1 italic">{briefing.moodContext}</p>
                        )}
                    </>
                )}

                {/* ── HABITS TAB ── */}
                {tab === 'habits' && (
                    <>
                        {habits.filter(h => h.active).length === 0 ? (
                            <div className="text-center py-8 text-gray-500 text-sm">
                                <div className="text-4xl mb-3">✅</div>
                                No habits yet. Ask Echo to add some, or go through setup.
                            </div>
                        ) : (
                            <>
                                {pendingHabits.length > 0 && (
                                    <div>
                                        <p className="text-gray-400 text-xs uppercase tracking-wide font-medium mb-2">Still to do today</p>
                                        <div className="space-y-2">
                                            {pendingHabits.map(h => (
                                                <div key={h.id}>
                                                    <HabitCard habit={h} done={false} completing={completingId === h.id} onComplete={() => handleCompleteHabit(h.id)} />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {completedHabits.length > 0 && (
                                    <div className="mt-4">
                                        <p className="text-gray-400 text-xs uppercase tracking-wide font-medium mb-2">Done today 🎉</p>
                                        <div className="space-y-2">
                                            {completedHabits.map(h => (
                                                <div key={h.id}>
                                                    <HabitCard habit={h} done={true} completing={false} onComplete={() => {}} />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </>
                )}

                {/* ── GOALS TAB ── */}
                {tab === 'goals' && (
                    <>
                        {goals.length === 0 ? (
                            <div className="text-center py-8 text-gray-500 text-sm">
                                <div className="text-4xl mb-3">🎯</div>
                                No active goals. Tell Echo your goal and it'll be tracked here.
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {goals.map(g => (
                                    <div key={g.id}>
                                        <GoalCard goal={g} />
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}

                {/* ── SETTINGS TAB ── */}
                {tab === 'settings' && (
                    <>
                        {/* Companion Mode */}
                        <div>
                            <p className="text-gray-400 text-xs uppercase tracking-wide font-medium mb-2">Companion style</p>
                            <div className="space-y-1.5">
                                {COMPANION_MODES.map(m => (
                                    <button key={m.id} onClick={() => handleCompanionMode(m.id)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${companionState.mode === m.id ? 'border-green-500 bg-green-500/10' : 'border-gray-700 hover:border-gray-600'}`}>
                                        <span className="text-lg">{m.emoji}</span>
                                        <div className="flex-1 min-w-0">
                                            <div className={`text-xs font-medium ${companionState.mode === m.id ? 'text-green-300' : 'text-gray-300'}`}>{m.label}</div>
                                            <div className="text-gray-600 text-xs truncate">{m.description}</div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Ambient Mode */}
                        <div className="mt-4">
                            <p className="text-gray-400 text-xs uppercase tracking-wide font-medium mb-2">Ambient / Social Pause</p>
                            <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-gray-300 text-sm">Ambient listening mode</p>
                                        <p className={`text-xs mt-0.5 ${AMBIENT_STATUS_COLORS[ambientStatus]}`}>{AMBIENT_STATUS_LABELS[ambientStatus]}</p>
                                    </div>
                                    <button
                                        onClick={toggleAmbientMode}
                                        className={`relative w-11 h-6 rounded-full transition-colors ${getAmbientConfig().enabled ? 'bg-green-600' : 'bg-gray-700'}`}
                                    >
                                        <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${getAmbientConfig().enabled ? 'left-6' : 'left-1'}`} />
                                    </button>
                                </div>
                                {getAmbientConfig().enabled && (
                                    <p className="text-gray-500 text-xs">
                                        Echo listens but stays silent. Say <span className="text-green-400 font-mono">"Echo"</span> or <span className="text-green-400 font-mono">"Hey Echo"</span> to activate. Say <span className="text-gray-400 font-mono">"Echo go quiet"</span> to pause all responses.
                                    </p>
                                )}
                                <button onClick={() => setShowBackgroundInfo(v => !v)} className="flex items-center gap-1.5 text-gray-500 hover:text-gray-300 text-xs transition-colors">
                                    <Info size={12} /> Background / screen-off info {showBackgroundInfo ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                                </button>
                                {showBackgroundInfo && (
                                    <div className="text-gray-500 text-xs space-y-1.5 border-t border-gray-700 pt-2 mt-1">
                                        <p><span className="text-blue-400">Android:</span> {BACKGROUND_LIMITATIONS.android}</p>
                                        <p><span className="text-gray-400">iPhone:</span> {BACKGROUND_LIMITATIONS.ios}</p>
                                        <p><span className="text-green-400">PWA:</span> {BACKGROUND_LIMITATIONS.pwa}</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* User name */}
                        <div className="mt-4">
                            <p className="text-gray-400 text-xs uppercase tracking-wide font-medium mb-2">Your profile</p>
                            <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-gray-500 text-xs w-24">Your name</span>
                                    <input
                                        defaultValue={companionState.userName}
                                        onBlur={e => saveCompanionState({ userName: e.target.value })}
                                        placeholder="Not set"
                                        className="flex-1 bg-gray-800 border border-gray-700 focus:border-green-500 rounded-lg px-3 py-1.5 text-white text-xs outline-none"
                                    />
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-gray-500 text-xs w-24">Streak</span>
                                    <span className="text-orange-300 text-xs">{companionState.streakDays > 0 ? `🔥 ${companionState.streakDays} days in a row` : 'No streak yet'}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-gray-500 text-xs w-24">Sessions</span>
                                    <span className="text-gray-400 text-xs">{companionState.totalSessions} total</span>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function HabitCard({ habit, done, completing, onComplete }: { habit: Habit; done: boolean; completing: boolean; onComplete: () => void }) {
    return (
        <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all ${done ? 'border-green-500/20 bg-green-500/5 opacity-60' : 'border-gray-700 bg-gray-800/40 hover:border-gray-600'}`}>
            <button onClick={onComplete} disabled={done || completing} className={`flex-shrink-0 transition-transform ${completing ? 'scale-125' : 'hover:scale-110'}`}>
                {done ? <CheckCircle size={18} className="text-green-500" /> : <Circle size={18} className="text-gray-600" />}
            </button>
            <span className="text-base">{habit.icon}</span>
            <span className={`text-sm flex-1 ${done ? 'line-through text-gray-500' : 'text-gray-200'}`}>{habit.name}</span>
            {habit.streak > 0 && (
                <span className="flex items-center gap-0.5 text-xs text-orange-300">
                    <Flame size={11} /> {habit.streak}
                </span>
            )}
        </div>
    );
}

function GoalCard({ goal }: { goal: Goal }) {
    const daysLeft = goal.deadline ? getDaysLeft(goal.deadline) : null;
    const completedMilestones = goal.milestones.filter(m => m.completed).length;

    return (
        <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
            <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1 min-w-0">
                    <p className="text-gray-200 text-sm font-medium truncate">{goal.title}</p>
                    {goal.why && <p className="text-gray-500 text-xs mt-0.5 italic truncate">"{goal.why}"</p>}
                </div>
                {daysLeft !== null && (
                    <span className={`text-xs flex-shrink-0 px-2 py-0.5 rounded-full ${daysLeft <= 3 ? 'bg-red-500/20 text-red-300' : daysLeft <= 7 ? 'bg-yellow-500/20 text-yellow-300' : 'bg-gray-700 text-gray-400'}`}>
                        {daysLeft === 0 ? 'Today' : `${daysLeft}d`}
                    </span>
                )}
            </div>
            {/* Progress bar */}
            <div className="space-y-1">
                <div className="flex justify-between text-xs text-gray-500">
                    <span>{goal.milestones.length > 0 ? `${completedMilestones}/${goal.milestones.length} milestones` : 'Progress'}</span>
                    <span className="text-green-400 font-medium">{goal.progress}%</span>
                </div>
                <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-gradient-to-r from-green-500 to-teal-400 rounded-full transition-all duration-500"
                        style={{ width: `${goal.progress}%` }}
                    />
                </div>
            </div>
        </div>
    );
}
