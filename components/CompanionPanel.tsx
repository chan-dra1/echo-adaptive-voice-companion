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
    Clock, AlertTriangle, Smile, Meh, Frown, X, Info, Brain,
} from 'lucide-react';

interface Props {
    onClose: () => void;
    onOpenPersonalizedLearning?: () => void;
}

export default function CompanionPanel({ onClose, onOpenPersonalizedLearning }: Props) {
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
        <div className="term-window flex flex-col h-full font-mono animate-phosphor-in">
            {/* Header */}
            <div className="term-titlebar">
                <span className="term-dots" />
                <div className="flex items-center gap-2 flex-1" style={{ color: 'var(--accent-pink)' }}>
                    <Heart size={16} aria-hidden="true" />
                    <span className="font-[var(--font-term)] uppercase tracking-[0.2em] text-xs">COMPANION.LINK</span>
                    {companionState.streakDays > 0 && (
                        <span className="flex items-center gap-1 bg-[rgba(255,200,87,0.12)] border border-[var(--accent-pink)]/40 text-[var(--accent-pink)] text-[10px] px-2 py-0.5 rounded uppercase tracking-wider">
                            <Flame size={10} /> {companionState.streakDays}d
                        </span>
                    )}
                </div>
                <button onClick={onClose} className="text-[var(--text-tertiary)] hover:text-[var(--accent-green)] transition-colors" aria-label="Close companion panel">
                    <X size={16} />
                </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b text-xs font-mono uppercase tracking-widest" style={{ borderColor: 'var(--border-dim)' }}>
                {(['briefing', 'habits', 'goals', 'settings'] as const).map(t => (
                    <button key={t} onClick={() => setTab(t)} className={`flex-1 py-2.5 transition-colors ${tab === t ? 'border-b-2' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] border-b-2 border-transparent'}`} style={tab === t ? { color: 'var(--accent-green)', borderColor: 'var(--accent-green)' } : undefined}>
                        {t}
                        {t === 'habits' && pendingHabits.length > 0 && (
                            <span className="ml-1 bg-[var(--accent-green)] text-black text-[10px] rounded w-4 h-4 inline-flex items-center justify-center">{pendingHabits.length}</span>
                        )}
                        {t === 'goals' && goals.length > 0 && (
                            <span className="ml-1 text-[var(--text-tertiary)]">({goals.length})</span>
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
                        <div className="rounded-xl p-4 border" style={{ background: 'linear-gradient(135deg, rgba(0,255,65,0.08), rgba(43,217,107,0.06))', borderColor: 'var(--border-green)' }}>
                            <p className="font-medium text-sm" style={{ color: 'var(--accent-green)' }}>{briefing.greeting}</p>
                            {briefing.streakNote && <p className="text-xs mt-1" style={{ color: 'var(--accent-pink)' }}>{briefing.streakNote}</p>}
                            <p className="text-[var(--text-tertiary)] text-xs mt-2 italic">{briefing.motivationalQuote}</p>
                        </div>

                        {/* Mood check-in */}
                        {!moodLogged && !latestMood && (
                            <div className="bg-[rgba(0,255,65,0.03)] rounded-xl p-4 border border-[var(--border-dim)]">
                                <p className="text-[var(--text-secondary)] text-sm font-medium mb-3">How are you feeling right now?</p>
                                <div className="flex justify-between">
                                    {([1, 2, 3, 4, 5] as MoodLevel[]).map(m => (
                                        <button key={m} onClick={() => handleMood(m)} className="flex flex-col items-center gap-1 hover:scale-110 transition-transform">
                                            <span className="text-xl">{moodEmoji[m]}</span>
                                            <span className="text-[var(--text-tertiary)] text-xs">{moodLabel[m]}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {moodLogged && (
                            <div className="rounded-xl p-3 border text-xs text-center" style={{ background: 'rgba(87,255,176,0.08)', borderColor: 'var(--accent-cyan)', color: 'var(--accent-cyan)' }}>
                                ✓ Mood logged — I'll keep this in mind today.
                            </div>
                        )}

                        {/* Today's habits snapshot */}
                        {(pendingHabits.length > 0 || completedHabits.length > 0) && (
                            <div className="bg-[rgba(0,255,65,0.03)] rounded-xl p-4 border border-[var(--border-dim)]">
                                <p className="text-[var(--text-secondary)] text-sm font-medium mb-2">Today's habits</p>
                                <div className="space-y-1.5">
                                    {completedHabits.map(h => (
                                        <div key={h.id} className="flex items-center gap-2 text-xs text-[var(--text-tertiary)] line-through">
                                            <CheckCircle size={12} className="flex-shrink-0" style={{ color: 'var(--accent-green)' }} />
                                            {h.icon} {h.name}
                                            {h.streak > 1 && <span className="not-italic no-underline ml-auto" style={{ color: 'var(--accent-pink)' }}>🔥 {h.streak}</span>}
                                        </div>
                                    ))}
                                    {pendingHabits.slice(0, 3).map(h => (
                                        <div key={h.id} className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                                            <Circle size={12} className="text-[var(--text-tertiary)] flex-shrink-0" />
                                            {h.icon} {h.name}
                                        </div>
                                    ))}
                                    {pendingHabits.length > 3 && <p className="text-[var(--text-tertiary)] text-xs">+{pendingHabits.length - 3} more — see Habits tab</p>}
                                </div>
                            </div>
                        )}

                        {/* Deadlines */}
                        {deadlines.length > 0 && (
                            <div className="bg-[rgba(0,255,65,0.03)] rounded-xl p-4 border border-[var(--border-dim)]">
                                <p className="text-[var(--text-secondary)] text-sm font-medium mb-2 flex items-center gap-1.5"><AlertTriangle size={14} style={{ color: 'var(--accent-amber)' }} /> Upcoming deadlines</p>
                                <div className="space-y-2">
                                    {deadlines.slice(0, 3).map(d => (
                                        <div key={d.taskId} className="flex items-center justify-between text-xs">
                                            <span className="text-[var(--text-secondary)] truncate flex-1 mr-2">{d.title}</span>
                                            <span className="flex-shrink-0 font-medium" style={{ color: d.daysLeft === 0 ? 'var(--accent-red)' : d.daysLeft <= 2 ? 'var(--accent-pink)' : d.daysLeft <= 5 ? 'var(--accent-amber)' : 'var(--text-tertiary)' }}>
                                                {d.daysLeft === 0 ? 'TODAY' : d.daysLeft === 1 ? 'Tomorrow' : `${d.daysLeft}d left`}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Mood context */}
                        {briefing.moodContext && (
                            <p className="text-[var(--text-tertiary)] text-xs px-1 italic">{briefing.moodContext}</p>
                        )}
                    </>
                )}

                {/* ── HABITS TAB ── */}
                {tab === 'habits' && (
                    <>
                        {habits.filter(h => h.active).length === 0 ? (
                            <div className="text-center py-8 text-[var(--text-tertiary)] text-sm">
                                <div className="text-4xl mb-3">✅</div>
                                No habits yet. Ask Echo to add some, or go through setup.
                            </div>
                        ) : (
                            <>
                                {pendingHabits.length > 0 && (
                                    <div>
                                        <p className="text-[var(--text-tertiary)] text-xs uppercase tracking-wide font-medium mb-2">Still to do today</p>
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
                                        <p className="text-[var(--text-tertiary)] text-xs uppercase tracking-wide font-medium mb-2">Done today 🎉</p>
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
                            <div className="text-center py-8 text-[var(--text-tertiary)] text-sm">
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
                            <p className="text-[var(--text-tertiary)] text-xs uppercase tracking-wide font-medium mb-2">Companion style</p>
                            <div className="space-y-1.5">
                                {COMPANION_MODES.map(m => (
                                    <button key={m.id} onClick={() => handleCompanionMode(m.id)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${companionState.mode === m.id ? 'bg-[rgba(0,255,65,0.08)]' : 'border-[var(--border-dim)] hover:border-[var(--border-base)]'}`} style={companionState.mode === m.id ? { borderColor: 'var(--accent-green)' } : undefined}>
                                        <span className="text-lg">{m.emoji}</span>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-xs font-medium" style={{ color: companionState.mode === m.id ? 'var(--accent-green)' : 'var(--text-secondary)' }}>{m.label}</div>
                                            <div className="text-[var(--text-tertiary)] text-xs truncate">{m.description}</div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Ambient Mode */}
                        <div className="mt-4">
                            <p className="text-[var(--text-tertiary)] text-xs uppercase tracking-wide font-medium mb-2">Ambient / Social Pause</p>
                            <div className="bg-[rgba(0,255,65,0.03)] rounded-xl p-4 border border-[var(--border-dim)] space-y-3">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-[var(--text-secondary)] text-sm">Ambient listening mode</p>
                                        <p className={`text-xs mt-0.5 ${AMBIENT_STATUS_COLORS[ambientStatus]}`}>{AMBIENT_STATUS_LABELS[ambientStatus]}</p>
                                    </div>
                                    <button
                                        onClick={toggleAmbientMode}
                                        className="relative w-11 h-6 rounded-full transition-colors"
                                        style={{ background: getAmbientConfig().enabled ? 'var(--accent-green)' : 'var(--surface-2)' }}
                                    >
                                        <div className={`absolute top-1 w-4 h-4 rounded-full bg-black transition-transform ${getAmbientConfig().enabled ? 'left-6' : 'left-1'}`} />
                                    </button>
                                </div>
                                {getAmbientConfig().enabled && (
                                    <p className="text-[var(--text-tertiary)] text-xs">
                                        Echo listens but stays silent. Say <span className="font-mono" style={{ color: 'var(--accent-green)' }}>"Echo"</span> or <span className="font-mono" style={{ color: 'var(--accent-green)' }}>"Hey Echo"</span> to activate. Say <span className="text-[var(--text-secondary)] font-mono">"Echo go quiet"</span> to pause all responses.
                                    </p>
                                )}
                                <button onClick={() => setShowBackgroundInfo(v => !v)} className="flex items-center gap-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] text-xs transition-colors">
                                    <Info size={12} /> Background / screen-off info {showBackgroundInfo ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                                </button>
                                {showBackgroundInfo && (
                                    <div className="text-[var(--text-tertiary)] text-xs space-y-1.5 border-t pt-2 mt-1" style={{ borderColor: 'var(--border-dim)' }}>
                                        <p><span style={{ color: 'var(--accent-cyan)' }}>Android:</span> {BACKGROUND_LIMITATIONS.android}</p>
                                        <p><span className="text-[var(--text-secondary)]">iPhone:</span> {BACKGROUND_LIMITATIONS.ios}</p>
                                        <p><span style={{ color: 'var(--accent-green)' }}>PWA:</span> {BACKGROUND_LIMITATIONS.pwa}</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* User name */}
                        <div className="mt-4">
                            <p className="text-[var(--text-tertiary)] text-xs uppercase tracking-wide font-medium mb-2">Your profile</p>
                            <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-[var(--text-tertiary)] text-xs w-24">Your name</span>
                                    <input
                                        defaultValue={companionState.userName}
                                        onBlur={e => saveCompanionState({ userName: e.target.value })}
                                        placeholder="Not set"
                                        className="flex-1 bg-[var(--surface-1)] border border-[var(--border-dim)] focus:border-[var(--accent-green)] rounded-lg px-3 py-1.5 text-[var(--text-primary)] text-xs outline-none"
                                    />
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[var(--text-tertiary)] text-xs w-24">Streak</span>
                                    <span className="text-xs" style={{ color: 'var(--accent-pink)' }}>{companionState.streakDays > 0 ? `🔥 ${companionState.streakDays} days in a row` : 'No streak yet'}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[var(--text-tertiary)] text-xs w-24">Sessions</span>
                                    <span className="text-[var(--text-secondary)] text-xs">{companionState.totalSessions} total</span>
                                </div>
                            </div>
                        </div>

                        {/* Personalized Learning */}
                        {onOpenPersonalizedLearning && (
                            <div className="mt-4">
                                <p className="text-[var(--text-tertiary)] text-xs uppercase tracking-wide font-medium mb-2">Personalization</p>
                                <button
                                    onClick={onOpenPersonalizedLearning}
                                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[var(--border-dim)] hover:border-[var(--border-base)] text-left transition-colors"
                                >
                                    <Brain size={16} className="text-[var(--accent-green)]" />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-medium text-[var(--text-secondary)]">Learn my communication style</div>
                                        <div className="text-[var(--text-tertiary)] text-xs truncate">Echo starts sounding more like you, from your conversations</div>
                                    </div>
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function HabitCard({ habit, done, completing, onComplete }: { habit: Habit; done: boolean; completing: boolean; onComplete: () => void }) {
    return (
        <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all ${done ? 'opacity-60' : 'border-[var(--border-dim)] bg-[rgba(0,255,65,0.03)] hover:border-[var(--border-base)]'}`} style={done ? { borderColor: 'var(--border-green)', background: 'rgba(0,255,65,0.05)' } : undefined}>
            <button onClick={onComplete} disabled={done || completing} className={`flex-shrink-0 transition-transform ${completing ? 'scale-125' : 'hover:scale-110'}`}>
                {done ? <CheckCircle size={18} style={{ color: 'var(--accent-green)' }} /> : <Circle size={18} className="text-[var(--text-tertiary)]" />}
            </button>
            <span className="text-base">{habit.icon}</span>
            <span className={`text-sm flex-1 ${done ? 'line-through text-[var(--text-tertiary)]' : 'text-[var(--text-secondary)]'}`}>{habit.name}</span>
            {habit.streak > 0 && (
                <span className="flex items-center gap-0.5 text-xs" style={{ color: 'var(--accent-pink)' }}>
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
        <div className="bg-[rgba(0,255,65,0.03)] rounded-xl p-4 border border-[var(--border-dim)]">
            <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1 min-w-0">
                    <p className="text-[var(--text-secondary)] text-sm font-medium truncate">{goal.title}</p>
                    {goal.why && <p className="text-[var(--text-tertiary)] text-xs mt-0.5 italic truncate">"{goal.why}"</p>}
                </div>
                {daysLeft !== null && (
                    <span className="text-xs flex-shrink-0 px-2 py-0.5 rounded" style={{
                        background: daysLeft <= 3 ? 'rgba(255,59,92,0.15)' : daysLeft <= 7 ? 'rgba(255,179,0,0.15)' : 'var(--surface-2)',
                        color: daysLeft <= 3 ? 'var(--accent-red)' : daysLeft <= 7 ? 'var(--accent-amber)' : 'var(--text-tertiary)',
                    }}>
                        {daysLeft === 0 ? 'Today' : `${daysLeft}d`}
                    </span>
                )}
            </div>
            {/* Progress bar */}
            <div className="space-y-1">
                <div className="flex justify-between text-xs text-[var(--text-tertiary)]">
                    <span>{goal.milestones.length > 0 ? `${completedMilestones}/${goal.milestones.length} milestones` : 'Progress'}</span>
                    <span className="font-medium" style={{ color: 'var(--accent-green)' }}>{goal.progress}%</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                    <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${goal.progress}%`, background: 'linear-gradient(90deg, var(--accent-green), var(--accent-cyan))' }}
                    />
                </div>
            </div>
        </div>
    );
}
















































