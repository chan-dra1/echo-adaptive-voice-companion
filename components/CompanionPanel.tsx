/**
 * CompanionPanel.tsx — VIKI-style holographic companion dashboard.
 * Slides up from bottom as a full-screen HUD overlay.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
    getCompanionState, saveCompanionState,
    COMPANION_MODES, CompanionMode,
} from '../services/companionPersonaService';
import {
    getHabits, completeHabit, getPendingHabitsToday, getCompletedHabitsToday,
    getActiveGoals, addCheckIn, getLatestMood,
    generateDailyBriefing, getCachedBriefing,
    MoodLevel, Habit, Goal,
} from '../services/lifeCoachService';
import { getActiveDeadlinePlans, getDaysLeft } from '../services/deadlineGuardianService';
import {
    ambientModeService, getAmbientConfig, saveAmbientConfig,
    AMBIENT_STATUS_LABELS, AMBIENT_STATUS_COLORS, BACKGROUND_LIMITATIONS,
} from '../services/ambientModeService';
import HUDCard, { HUDDivider, HUDRow } from './HUDCard';
import { Heart, Flame, CheckCircle, Circle, AlertTriangle, X, ChevronDown, Info, ChevronUp } from 'lucide-react';

interface Props { onClose: () => void; }

type Tab = 'briefing' | 'habits' | 'goals' | 'settings';

const MOOD_EMOJI: Record<MoodLevel, string> = { 1:'😞', 2:'😕', 3:'😐', 4:'🙂', 5:'😄' };
const MOOD_LABEL: Record<MoodLevel, string> = { 1:'Awful', 2:'Rough', 3:'Okay', 4:'Good', 5:'Amazing' };
const MOOD_COLOR: Record<MoodLevel, string> = {
    1:'rgba(255,48,64,0.6)', 2:'rgba(255,120,0,0.6)', 3:'rgba(255,179,0,0.6)',
    4:'rgba(0,229,255,0.6)', 5:'rgba(0,255,65,0.6)',
};

export default function CompanionPanel({ onClose }: Props) {
    const [tab, setTab] = useState<Tab>('briefing');
    const [habits, setHabits] = useState(getHabits());
    const [goals,  setGoals]  = useState(getActiveGoals());
    const [deadlines, setDeadlines] = useState(getActiveDeadlinePlans());
    const [cs, setCs] = useState(getCompanionState());
    const [briefing, setBriefing] = useState(
        () => getCachedBriefing() || generateDailyBriefing(getActiveDeadlinePlans().map(d => ({ title: d.title, daysLeft: d.daysLeft })))
    );
    const [moodDone, setMoodDone]  = useState(false);
    const [ambientStatus, setAmbientStatus] = useState(ambientModeService.currentStatus);
    const [showBgInfo, setShowBgInfo] = useState(false);
    const [completing, setCompleting] = useState<string|null>(null);

    useEffect(() => {
        const fn = (e: Event) => setAmbientStatus((e as CustomEvent).detail);
        window.addEventListener('ambient:status-change', fn);
        return () => window.removeEventListener('ambient:status-change', fn);
    }, []);

    const doCompleteHabit = (id: string) => {
        setCompleting(id);
        setTimeout(() => { completeHabit(id); setHabits(getHabits()); setCompleting(null); }, 300);
    };
    const doMood = (m: MoodLevel) => {
        addCheckIn(m);
        setMoodDone(true);
        setBriefing(generateDailyBriefing(deadlines.map(d => ({ title: d.title, daysLeft: d.daysLeft }))));
    };
    const setMode = (mode: CompanionMode) => { saveCompanionState({ mode }); setCs(getCompanionState()); };
    const toggleAmbient = () => {
        const cfg = getAmbientConfig();
        saveAmbientConfig({ enabled: !cfg.enabled });
        ambientModeService.setEnabled(!cfg.enabled);
        setAmbientStatus(ambientModeService.currentStatus);
    };

    const pending   = getPendingHabitsToday();
    const completed = getCompletedHabitsToday();
    const latestMood = getLatestMood();

    const TABS: Tab[] = ['briefing','habits','goals','settings'];
    const TAB_COLORS: Record<Tab,string> = {
        briefing:'var(--c-cyan)', habits:'var(--c-green)', goals:'var(--c-pink)', settings:'var(--c-amber)',
    };

    return (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'rgba(0,8,16,0.97)', backdropFilter: 'blur(20px)' }}>
            {/* Scan beam */}
            <div className="scan-beam" style={{ top: 0 }} />

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--b-cyan)' }}>
                <div className="flex items-center gap-3">
                    <Heart size={20} style={{ color: 'var(--c-pink)', filter: 'drop-shadow(0 0 6px var(--c-pink))' }} />
                    <span className="font-hud text-sm tracking-widest text-glow-cyan" style={{ color: 'var(--c-cyan)' }}>
                        COMPANION SYSTEM
                    </span>
                    {cs.streakDays > 0 && (
                        <div
                            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono-hud"
                            style={{ background: 'rgba(255,120,0,0.15)', border: '1px solid rgba(255,120,0,0.3)', color: '#FF8C00' }}
                        >
                            <Flame size={10} /> {cs.streakDays}D STREAK
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    <span className="font-mono-hud text-[10px] text-white/30 uppercase tracking-wider">
                        {cs.userName || 'USER'} · SESSION {cs.totalSessions}
                    </span>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
                        <X size={16} style={{ color: 'var(--c-cyan)' }} />
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex px-6 pt-4 gap-2">
                {TABS.map(t => (
                    <button
                        key={t}
                        onClick={() => setTab(t)}
                        className="flex-1 py-2 rounded-lg font-hud text-[9px] tracking-widest uppercase transition-all"
                        style={{
                            background: tab === t ? `${TAB_COLORS[t]}18` : 'transparent',
                            border: `1px solid ${tab === t ? TAB_COLORS[t] : 'rgba(255,255,255,0.06)'}`,
                            color: tab === t ? TAB_COLORS[t] : 'rgba(255,255,255,0.35)',
                            boxShadow: tab === t ? `0 0 10px ${TAB_COLORS[t]}33` : 'none',
                            textShadow: tab === t ? `0 0 8px ${TAB_COLORS[t]}` : 'none',
                        }}
                    >
                        {t}
                        {t === 'habits' && pending.length > 0 && (
                            <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full text-[8px]"
                                style={{ background: 'var(--c-green)', color: '#000' }}>
                                {pending.length}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto scrollbar-hide px-6 py-4 space-y-4">

                {/* ── BRIEFING ── */}
                {tab === 'briefing' && (
                    <>
                        <HUDCard variant="cyan" label="DAILY BRIEFING" status="cyan" statusText="LIVE" scanBeam>
                            <p className="text-[var(--c-cyan)] font-medium text-sm leading-relaxed">{briefing.greeting}</p>
                            {briefing.streakNote && (
                                <p className="mt-1.5 font-mono-hud text-xs" style={{ color: '#FF8C00' }}>{briefing.streakNote}</p>
                            )}
                            <HUDDivider />
                            <p className="text-white/50 text-xs italic leading-relaxed">{briefing.motivationalQuote}</p>
                        </HUDCard>

                        {/* Mood */}
                        {!moodDone && !latestMood && (
                            <HUDCard variant="pink" label="EMOTIONAL STATUS">
                                <p className="text-white/70 text-sm mb-4">How are you feeling right now?</p>
                                <div className="flex justify-between">
                                    {([1,2,3,4,5] as MoodLevel[]).map(m => (
                                        <button
                                            key={m} onClick={() => doMood(m)}
                                            className="flex flex-col items-center gap-1.5 group"
                                        >
                                            <div
                                                className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl transition-all group-hover:scale-110"
                                                style={{ background: MOOD_COLOR[m], border: `1px solid ${MOOD_COLOR[m]}` }}
                                            >
                                                {MOOD_EMOJI[m]}
                                            </div>
                                            <span className="font-mono-hud text-[9px] text-white/40 uppercase">{MOOD_LABEL[m]}</span>
                                        </button>
                                    ))}
                                </div>
                            </HUDCard>
                        )}
                        {moodDone && (
                            <div className="text-center py-2 font-mono-hud text-[11px]" style={{ color: 'var(--c-green)' }}>
                                ◉ MOOD LOGGED — CONTEXT UPDATED
                            </div>
                        )}

                        {/* Habits snapshot */}
                        {(pending.length > 0 || completed.length > 0) && (
                            <HUDCard variant="green" label="HABIT STATUS">
                                <div className="space-y-2">
                                    {completed.map(h => (
                                        <div key={h.id} className="flex items-center gap-2 opacity-50">
                                            <CheckCircle size={12} style={{ color: 'var(--c-green)', flexShrink: 0 }} />
                                            <span className="text-xs line-through text-white/40">{h.icon} {h.name}</span>
                                            {h.streak > 1 && (
                                                <span className="ml-auto font-mono-hud text-[10px]" style={{ color: '#FF8C00' }}>
                                                    🔥{h.streak}
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                    {pending.slice(0,4).map(h => (
                                        <div key={h.id} className="flex items-center gap-2">
                                            <Circle size={12} className="text-white/30 flex-shrink-0" />
                                            <span className="text-xs text-white/70">{h.icon} {h.name}</span>
                                        </div>
                                    ))}
                                    {pending.length > 4 && (
                                        <p className="font-mono-hud text-[10px] text-white/30">+{pending.length-4} MORE → HABITS TAB</p>
                                    )}
                                </div>
                            </HUDCard>
                        )}

                        {/* Deadlines */}
                        {deadlines.length > 0 && (
                            <HUDCard variant="amber" label="DEADLINE GUARDIAN">
                                {deadlines.slice(0,3).map(d => (
                                    <div key={d.taskId} className="flex items-center justify-between py-1.5">
                                        <span className="text-xs text-white/70 truncate flex-1 mr-3">{d.title}</span>
                                        <span
                                            className="font-hud text-[9px] tracking-wider flex-shrink-0"
                                            style={{
                                                color: d.daysLeft === 0 ? 'var(--c-red)' : d.daysLeft <= 2 ? 'var(--c-amber)' : 'var(--c-cyan)',
                                                textShadow: `0 0 8px currentColor`,
                                            }}
                                        >
                                            {d.daysLeft === 0 ? 'TODAY' : d.daysLeft === 1 ? 'TOMORROW' : `T-${d.daysLeft}D`}
                                        </span>
                                    </div>
                                ))}
                            </HUDCard>
                        )}

                        {briefing.moodContext && (
                            <p className="font-mono-hud text-[11px] text-white/30 px-1 italic">{briefing.moodContext}</p>
                        )}
                    </>
                )}

                {/* ── HABITS ── */}
                {tab === 'habits' && (
                    <>
                        {habits.filter(h=>h.active).length === 0 ? (
                            <div className="text-center py-16">
                                <div className="text-5xl mb-4">✅</div>
                                <p className="font-mono-hud text-[11px] text-white/30">NO HABITS TRACKED YET</p>
                                <p className="text-xs text-white/20 mt-1">Tell Echo to add a habit</p>
                            </div>
                        ) : (
                            <>
                                {pending.length > 0 && (
                                    <div>
                                        <p className="font-hud text-[9px] tracking-widest text-white/30 uppercase mb-3">PENDING TODAY</p>
                                        <div className="space-y-2">
                                            {pending.map(h => <HabitRow key={h.id} habit={h} done={false} completing={completing===h.id} onComplete={()=>doCompleteHabit(h.id)} />)}
                                        </div>
                                    </div>
                                )}
                                {completed.length > 0 && (
                                    <div className="mt-5">
                                        <p className="font-hud text-[9px] tracking-widest text-white/30 uppercase mb-3">COMPLETED TODAY</p>
                                        <div className="space-y-2">
                                            {completed.map(h => <HabitRow key={h.id} habit={h} done completed={true} completing={false} onComplete={()=>{}} />)}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </>
                )}

                {/* ── GOALS ── */}
                {tab === 'goals' && (
                    <>
                        {goals.length === 0 ? (
                            <div className="text-center py-16">
                                <div className="text-5xl mb-4">🎯</div>
                                <p className="font-mono-hud text-[11px] text-white/30">NO ACTIVE GOALS</p>
                                <p className="text-xs text-white/20 mt-1">Tell Echo your goal to track it here</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {goals.map(g => <GoalRow key={g.id} goal={g} />)}
                            </div>
                        )}
                    </>
                )}

                {/* ── SETTINGS ── */}
                {tab === 'settings' && (
                    <>
                        <HUDCard variant="cyan" label="COMPANION MODE">
                            <div className="grid grid-cols-1 gap-2">
                                {COMPANION_MODES.map(m => (
                                    <button
                                        key={m.id} onClick={() => setMode(m.id)}
                                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-left"
                                        style={{
                                            background: cs.mode === m.id ? 'rgba(0,229,255,0.08)' : 'transparent',
                                            border: `1px solid ${cs.mode === m.id ? 'var(--c-cyan)' : 'rgba(255,255,255,0.06)'}`,
                                            boxShadow: cs.mode === m.id ? 'var(--glow-cyan)' : 'none',
                                        }}
                                    >
                                        <span className="text-xl">{m.emoji}</span>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-medium" style={{ color: cs.mode===m.id ? 'var(--c-cyan)' : 'rgba(255,255,255,0.7)' }}>
                                                {m.label}
                                            </p>
                                            <p className="font-mono-hud text-[10px] text-white/30 truncate">{m.description}</p>
                                        </div>
                                        {cs.mode === m.id && <span className="status-dot cyan flex-shrink-0" />}
                                    </button>
                                ))}
                            </div>
                        </HUDCard>

                        <HUDCard variant="green" label="AMBIENT LISTENING">
                            <div className="flex items-center justify-between mb-3">
                                <div>
                                    <p className="text-sm text-white/80">Social Pause Mode</p>
                                    <p className="font-mono-hud text-[10px] mt-0.5" style={{ color: 'var(--c-green)' }}>
                                        {AMBIENT_STATUS_LABELS[ambientStatus].toUpperCase()}
                                    </p>
                                </div>
                                <button
                                    onClick={toggleAmbient}
                                    className="relative w-12 h-6 rounded-full transition-all"
                                    style={{
                                        background: getAmbientConfig().enabled ? 'var(--c-green)' : 'rgba(255,255,255,0.1)',
                                        boxShadow: getAmbientConfig().enabled ? '0 0 10px var(--c-green)' : 'none',
                                    }}
                                >
                                    <div
                                        className="absolute top-1 w-4 h-4 rounded-full bg-white transition-transform"
                                        style={{ left: getAmbientConfig().enabled ? 28 : 4 }}
                                    />
                                </button>
                            </div>
                            {getAmbientConfig().enabled && (
                                <p className="font-mono-hud text-[10px] text-white/40 leading-relaxed">
                                    Say <span style={{color:'var(--c-cyan)'}}>«ECHO»</span> to activate · <span style={{color:'var(--c-amber)'}}>«ECHO GO QUIET»</span> to pause
                                </p>
                            )}
                            <button onClick={()=>setShowBgInfo(v=>!v)} className="flex items-center gap-1.5 mt-3 font-mono-hud text-[10px] text-white/30 hover:text-white/50 transition-colors">
                                <Info size={10} /> BACKGROUND / SCREEN-OFF INFO {showBgInfo ? <ChevronUp size={10}/> : <ChevronDown size={10}/>}
                            </button>
                            {showBgInfo && (
                                <div className="mt-2 space-y-2 border-t pt-2" style={{borderColor:'var(--b-cyan)'}}>
                                    {[
                                        { label:'ANDROID', text: BACKGROUND_LIMITATIONS.android, color:'var(--c-green)' },
                                        { label:'IOS',     text: BACKGROUND_LIMITATIONS.ios,     color:'rgba(255,255,255,0.4)' },
                                        { label:'PWA',     text: BACKGROUND_LIMITATIONS.pwa,     color:'var(--c-cyan)' },
                                    ].map(({label,text,color}) => (
                                        <div key={label}>
                                            <span className="font-hud text-[8px]" style={{color}}>{label}</span>
                                            <p className="font-mono-hud text-[10px] text-white/30 mt-0.5 leading-relaxed">{text}</p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </HUDCard>

                        <HUDCard variant="pink" label="USER PROFILE">
                            <div className="space-y-1">
                                <HUDRow label="NAME"     value={cs.userName || '—'} valueClass="text-[var(--c-cyan)]" />
                                <HUDRow label="STREAK"   value={cs.streakDays > 0 ? `🔥 ${cs.streakDays} DAYS` : '—'} valueClass="text-orange-400" />
                                <HUDRow label="SESSIONS" value={`${cs.totalSessions}`} valueClass="text-white/60" />
                                <HUDRow label="MODE"     value={cs.mode.toUpperCase()} valueClass="text-[var(--c-pink)]" />
                            </div>
                            <div className="mt-3">
                                <input
                                    defaultValue={cs.userName}
                                    onBlur={e => saveCompanionState({ userName: e.target.value })}
                                    placeholder="Set your name…"
                                    className="w-full bg-transparent border-b font-mono-hud text-xs text-white/70 outline-none py-1 placeholder:text-white/20"
                                    style={{ borderColor: 'var(--b-cyan)' }}
                                />
                            </div>
                        </HUDCard>
                    </>
                )}
            </div>
        </div>
    );
}

/* ── Sub-rows ─────────────────────────────────────────────────────────────── */

function HabitRow({ habit, done, completing, onComplete }: { habit: Habit; done: boolean; completing: boolean; onComplete: () => void; completed?: boolean }) {
    return (
        <div
            className="flex items-center gap-3 px-4 py-3 rounded-lg transition-all"
            style={{
                background: done ? 'rgba(0,255,65,0.04)' : 'rgba(0,15,35,0.6)',
                border: `1px solid ${done ? 'rgba(0,255,65,0.12)' : 'rgba(0,229,255,0.1)'}`,
                opacity: done ? 0.55 : 1,
            }}
        >
            <button
                onClick={onComplete} disabled={done || completing}
                className="flex-shrink-0 transition-transform hover:scale-110"
                style={{ transform: completing ? 'scale(1.3)' : undefined }}
            >
                {done
                    ? <CheckCircle size={18} style={{ color: 'var(--c-green)', filter: 'drop-shadow(0 0 4px var(--c-green))' }} />
                    : <Circle size={18} className="text-white/20" />
                }
            </button>
            <span className="text-lg">{habit.icon}</span>
            <span className={`text-sm flex-1 ${done ? 'line-through text-white/30' : 'text-white/80'}`}>{habit.name}</span>
            {habit.streak > 0 && (
                <span className="font-mono-hud text-[10px] flex items-center gap-0.5" style={{ color: '#FF8C00' }}>
                    <Flame size={10} /> {habit.streak}
                </span>
            )}
        </div>
    );
}

function GoalRow({ goal }: { goal: Goal }) {
    const daysLeft = goal.deadline ? getDaysLeft(goal.deadline) : null;
    const done = goal.milestones.filter(m => m.completed).length;
    return (
        <div
            className="p-4 rounded-lg"
            style={{ background: 'rgba(0,15,35,0.7)', border: '1px solid rgba(255,107,157,0.15)' }}
        >
            <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white/90 truncate">{goal.title}</p>
                    {goal.why && <p className="font-mono-hud text-[10px] text-white/35 mt-0.5 italic truncate">"{goal.why}"</p>}
                </div>
                {daysLeft !== null && (
                    <span
                        className="font-hud text-[9px] flex-shrink-0 px-2 py-0.5 rounded-full"
                        style={{
                            background: daysLeft <= 3 ? 'rgba(255,48,64,0.15)' : daysLeft <= 7 ? 'rgba(255,179,0,0.15)' : 'rgba(0,229,255,0.1)',
                            border: `1px solid ${daysLeft <= 3 ? 'var(--c-red)' : daysLeft <= 7 ? 'var(--c-amber)' : 'var(--c-cyan)'}44`,
                            color: daysLeft <= 3 ? 'var(--c-red)' : daysLeft <= 7 ? 'var(--c-amber)' : 'var(--c-cyan)',
                        }}
                    >
                        {daysLeft === 0 ? 'TODAY' : `T-${daysLeft}D`}
                    </span>
                )}
            </div>
            <div className="space-y-1">
                <div className="flex justify-between font-mono-hud text-[10px] text-white/30">
                    <span>{goal.milestones.length > 0 ? `${done}/${goal.milestones.length} MILESTONES` : 'PROGRESS'}</span>
                    <span style={{ color: 'var(--c-pink)' }}>{goal.progress}%</span>
                </div>
                <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                            width: `${goal.progress}%`,
                            background: 'linear-gradient(90deg, var(--c-pink), var(--c-cyan))',
                            boxShadow: '0 0 8px var(--c-pink)',
                        }}
                    />
                </div>
            </div>
        </div>
    );
}
