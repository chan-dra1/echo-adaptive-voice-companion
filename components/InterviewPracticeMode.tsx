/**
 * InterviewPracticeMode.tsx — VIKI amber/red themed interview room.
 *
 * Full-screen panel that turns Echo into an AI interviewer.
 * Scores answers, shows feedback, tracks session history.
 * This is a SKILL BUILDER — practice to actually get better.
 */
import React, { useState, useEffect } from 'react';
import {
    startPracticeSession, endSession, getQuestionsForSession,
    recordAnswer, getAllSessions, buildInterviewSystemPrompt,
    getActiveSession,
    InterviewType, DifficultyLevel, PracticeSession, InterviewQuestion, QuestionScore,
    INTERVIEW_TYPE_LABELS, DIFFICULTY_LABELS,
} from '../services/interviewPracticeService';
import HUDCard, { HUDDivider, HUDRow } from './HUDCard';
import { X, Mic, ChevronRight, RotateCcw, Award, Clock, CheckCircle } from 'lucide-react';

interface Props {
    onClose: () => void;
    /** Called with the system prompt override when an interview question is active */
    onSystemPromptOverride?: (prompt: string | null) => void;
}

type Screen = 'setup' | 'active' | 'feedback' | 'history';

export default function InterviewPracticeMode({ onClose, onSystemPromptOverride }: Props) {
    const [screen, setScreen] = useState<Screen>('setup');
    const [interviewType, setIType] = useState<InterviewType>('behavioral');
    const [difficulty, setDifficulty] = useState<DifficultyLevel>('mid');
    const [role, setRole] = useState('');
    const [company, setCompany] = useState('');
    const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
    const [qIdx, setQIdx] = useState(0);
    const [session, setSession] = useState<PracticeSession | null>(null);
    const [lastScore, setLastScore] = useState<QuestionScore | null>(null);
    const [showHints, setShowHints] = useState(false);
    const [history, setHistory] = useState(getAllSessions);

    const AMBER = '#FFB300';
    const RED   = '#FF3040';

    // Push/pop system prompt override when active
    useEffect(() => {
        const active = getActiveSession();
        if (screen === 'active' && active && questions[qIdx]) {
            onSystemPromptOverride?.(buildInterviewSystemPrompt(active, questions[qIdx]));
        } else {
            onSystemPromptOverride?.(null);
        }
        return () => { if (screen !== 'active') onSystemPromptOverride?.(null); };
    }, [screen, qIdx, questions]);

    const startSession = () => {
        if (!role.trim()) return;
        const sess = startPracticeSession({ type: interviewType, difficulty, role, company: company || undefined });
        const qs   = getQuestionsForSession(interviewType, difficulty, 5);
        setSession(sess);
        setQuestions(qs);
        setQIdx(0);
        setLastScore(null);
        setScreen('active');
    };

    const handleAnswerSubmit = (answer: string) => {
        if (!questions[qIdx]) return;
        const score = recordAnswer(questions[qIdx].id, questions[qIdx].text, answer);
        setLastScore(score);
        setScreen('feedback');
        onSystemPromptOverride?.(null);
    };

    const nextQuestion = () => {
        if (qIdx + 1 < questions.length) {
            setQIdx(i => i + 1);
            setLastScore(null);
            setShowHints(false);
            setScreen('active');
        } else {
            const finished = endSession();
            setSession(finished);
            setHistory(getAllSessions());
            setScreen('history');
        }
    };

    const restart = () => {
        endSession();
        setScreen('setup');
        setSession(null);
        setLastScore(null);
        setShowHints(false);
    };

    return (
        <div
            className="fixed inset-0 z-50 flex flex-col interview-theme"
            style={{ background: 'rgba(10,2,0,0.98)', backdropFilter: 'blur(20px)' }}
        >
            {/* Header */}
            <div
                className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0"
                style={{ borderColor: `${AMBER}22` }}
            >
                <div className="flex items-center gap-3">
                    <span style={{ fontSize: 20 }}>🎙️</span>
                    <div>
                        <p className="font-hud text-sm tracking-widest" style={{ color: AMBER, textShadow: `0 0 10px ${AMBER}` }}>
                            INTERVIEW PRACTICE
                        </p>
                        <p className="font-mono-hud text-[10px] text-white/30 mt-0.5">SKILL BUILDER MODE — BUILD REAL SKILLS</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {['setup','active','feedback'].includes(screen) && session && (
                        <button onClick={restart} className="font-mono-hud text-[10px] text-white/30 hover:text-white/60 flex items-center gap-1">
                            <RotateCcw size={10} /> RESTART
                        </button>
                    )}
                    <button
                        onClick={() => { setHistory(getAllSessions()); setScreen(s => s === 'history' ? (session ? 'active' : 'setup') : 'history'); }}
                        className="font-mono-hud text-[10px] px-2 py-1 rounded"
                        style={{ color: AMBER, border: `1px solid ${AMBER}33` }}
                    >HISTORY</button>
                    <button onClick={onClose}><X size={16} style={{ color: AMBER }} /></button>
                </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

                {/* ── SETUP ── */}
                {screen === 'setup' && (
                    <>
                        <HUDCard variant="amber" label="SESSION SETUP" scanBeam>
                            <p className="text-white/60 text-sm mb-4">
                                Echo will act as your interviewer — asking questions, probing your answers,
                                and giving you honest scored feedback. No cheating, just real practice.
                            </p>

                            <div className="space-y-4">
                                <div>
                                    <label className="font-hud text-[9px] tracking-widest text-white/40 block mb-2">TARGET ROLE *</label>
                                    <input
                                        value={role}
                                        onChange={e => setRole(e.target.value)}
                                        placeholder="e.g. Software Engineer, Product Manager…"
                                        className="w-full bg-transparent text-sm text-white/80 outline-none py-2 border-b placeholder:text-white/20"
                                        style={{ borderColor: `${AMBER}40` }}
                                    />
                                </div>
                                <div>
                                    <label className="font-hud text-[9px] tracking-widest text-white/40 block mb-2">COMPANY (OPTIONAL)</label>
                                    <input
                                        value={company}
                                        onChange={e => setCompany(e.target.value)}
                                        placeholder="e.g. Google, startup, your own…"
                                        className="w-full bg-transparent text-sm text-white/80 outline-none py-2 border-b placeholder:text-white/20"
                                        style={{ borderColor: `${AMBER}40` }}
                                    />
                                </div>
                            </div>
                        </HUDCard>

                        <HUDCard variant="amber" label="INTERVIEW TYPE">
                            <div className="space-y-2">
                                {(Object.keys(INTERVIEW_TYPE_LABELS) as InterviewType[]).map(t => (
                                    <button
                                        key={t} onClick={() => setIType(t)}
                                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all"
                                        style={{
                                            background: interviewType === t ? `${AMBER}12` : 'transparent',
                                            border: `1px solid ${interviewType === t ? AMBER : 'rgba(255,255,255,0.06)'}`,
                                            boxShadow: interviewType === t ? `0 0 8px ${AMBER}33` : 'none',
                                        }}
                                    >
                                        <span className="text-sm">{INTERVIEW_TYPE_LABELS[t]}</span>
                                        {interviewType === t && <span className="ml-auto status-dot amber" />}
                                    </button>
                                ))}
                            </div>
                        </HUDCard>

                        <HUDCard variant="amber" label="DIFFICULTY">
                            <div className="grid grid-cols-2 gap-2">
                                {(Object.keys(DIFFICULTY_LABELS) as DifficultyLevel[]).map(d => (
                                    <button
                                        key={d} onClick={() => setDifficulty(d)}
                                        className="py-2.5 rounded-lg font-hud text-[9px] tracking-widest transition-all"
                                        style={{
                                            background: difficulty === d ? `${AMBER}12` : 'transparent',
                                            border: `1px solid ${difficulty === d ? AMBER : 'rgba(255,255,255,0.06)'}`,
                                            color: difficulty === d ? AMBER : 'rgba(255,255,255,0.4)',
                                            boxShadow: difficulty === d ? `0 0 8px ${AMBER}33` : 'none',
                                        }}
                                    >
                                        {DIFFICULTY_LABELS[d]}
                                    </button>
                                ))}
                            </div>
                        </HUDCard>

                        <button
                            onClick={startSession}
                            disabled={!role.trim()}
                            className="w-full py-4 rounded-xl font-hud text-sm tracking-widest transition-all"
                            style={{
                                background: role.trim() ? `linear-gradient(135deg, ${AMBER}22, ${RED}11)` : 'rgba(255,255,255,0.04)',
                                border: `1px solid ${role.trim() ? AMBER : 'rgba(255,255,255,0.1)'}`,
                                color: role.trim() ? AMBER : 'rgba(255,255,255,0.2)',
                                boxShadow: role.trim() ? `0 0 20px ${AMBER}33` : 'none',
                                textShadow: role.trim() ? `0 0 10px ${AMBER}` : 'none',
                            }}
                        >
                            START INTERVIEW SESSION ▶
                        </button>
                    </>
                )}

                {/* ── ACTIVE ── */}
                {screen === 'active' && questions[qIdx] && (
                    <>
                        {/* Progress */}
                        <div className="flex items-center gap-2">
                            <div className="flex gap-1 flex-1">
                                {questions.map((_, i) => (
                                    <div key={i} className="flex-1 h-1 rounded-full" style={{
                                        background: i < qIdx ? AMBER : i === qIdx ? `${AMBER}88` : 'rgba(255,255,255,0.06)',
                                        boxShadow: i === qIdx ? `0 0 6px ${AMBER}` : 'none',
                                    }} />
                                ))}
                            </div>
                            <span className="font-mono-hud text-[10px] text-white/40">Q{qIdx+1}/{questions.length}</span>
                        </div>

                        {/* Type badge */}
                        <div className="flex items-center gap-2">
                            <span className="font-hud text-[9px] px-2 py-1 rounded-full tracking-widest"
                                style={{ background: `${AMBER}15`, border: `1px solid ${AMBER}44`, color: AMBER }}>
                                {INTERVIEW_TYPE_LABELS[questions[qIdx].type]}
                            </span>
                            <span className="font-hud text-[9px] px-2 py-1 rounded-full tracking-widest"
                                style={{ background: `${RED}10`, border: `1px solid ${RED}33`, color: RED }}>
                                {DIFFICULTY_LABELS[questions[qIdx].difficulty]}
                            </span>
                        </div>

                        {/* The question */}
                        <div
                            className="p-5 rounded-xl"
                            style={{ background: `${AMBER}08`, border: `1px solid ${AMBER}33`, boxShadow: `0 0 20px ${AMBER}18` }}
                        >
                            <p className="font-hud text-[9px] tracking-widest text-white/30 mb-3">INTERVIEWER ASK:</p>
                            <p className="text-white/90 text-base leading-relaxed" style={{ textShadow: '0 0 1px rgba(255,255,255,0.1)' }}>
                                {questions[qIdx].text}
                            </p>
                        </div>

                        {/* Hints toggle */}
                        <button
                            onClick={() => setShowHints(h => !h)}
                            className="font-mono-hud text-[10px] text-white/30 hover:text-white/50 transition-colors"
                        >
                            {showHints ? '▲ HIDE HINTS' : '▼ SHOW HINTS (won\'t affect score)'}
                        </button>

                        {showHints && (
                            <div className="space-y-1 px-3 py-2 rounded-lg" style={{ background: 'rgba(255,179,0,0.05)', border: '1px solid rgba(255,179,0,0.1)' }}>
                                {questions[qIdx].hints.map((h, i) => (
                                    <p key={i} className="font-mono-hud text-[11px] text-white/40">💡 {h}</p>
                                ))}
                            </div>
                        )}

                        {/* Echo voice call to action */}
                        <div
                            className="flex items-center gap-4 p-4 rounded-xl"
                            style={{ background: 'rgba(0,15,35,0.8)', border: '1px solid rgba(0,229,255,0.15)' }}
                        >
                            <Mic size={20} style={{ color: '#00E5FF', filter: 'drop-shadow(0 0 6px #00E5FF)', flexShrink: 0 }} />
                            <div>
                                <p className="text-sm text-white/80">Speak your answer to Echo</p>
                                <p className="font-mono-hud text-[10px] text-white/35 mt-0.5">
                                    Echo will listen, then score and coach you on your response.
                                </p>
                            </div>
                        </div>

                        {/* Manual submit for typed answer */}
                        <ManualAnswerBox onSubmit={handleAnswerSubmit} />
                    </>
                )}

                {/* ── FEEDBACK ── */}
                {screen === 'feedback' && lastScore && questions[qIdx] && (
                    <>
                        {/* Score card */}
                        <div className="text-center py-6">
                            <div className="font-hud text-5xl mb-1" style={{
                                color: lastScore.score >= 8 ? '#00FF41' : lastScore.score >= 6 ? AMBER : RED,
                                textShadow: `0 0 20px currentColor`,
                            }}>
                                {lastScore.score}/10
                            </div>
                            <p className="font-mono-hud text-[11px] text-white/30 mt-1">
                                {lastScore.score >= 8 ? '⭐ EXCELLENT' : lastScore.score >= 6 ? '✅ GOOD EFFORT' : '⚠️ NEEDS WORK'}
                            </p>
                            <p className="font-mono-hud text-[10px] text-white/20 mt-0.5">
                                <Clock size={9} className="inline mr-1" />{lastScore.timeSeconds}s
                            </p>
                        </div>

                        <HUDCard variant="green" label="STRENGTHS">
                            {lastScore.strengths.length > 0
                                ? lastScore.strengths.map((s,i) => <p key={i} className="text-xs text-white/70 py-0.5">✓ {s}</p>)
                                : <p className="text-xs text-white/40 italic">Echo will provide verbal strengths feedback</p>
                            }
                            {/* Always show exemplar points */}
                            {questions[qIdx].exemplarPoints.map((p,i) => (
                                <p key={`ep-${i}`} className="text-xs text-white/40 py-0.5 italic">◈ {p}</p>
                            ))}
                        </HUDCard>

                        <HUDCard variant="amber" label="IMPROVEMENTS">
                            {lastScore.improvements.length > 0
                                ? lastScore.improvements.map((s,i) => <p key={i} className="text-xs text-white/70 py-0.5">→ {s}</p>)
                                : <p className="text-xs text-white/40 italic">Echo will give verbal improvement tips</p>
                            }
                        </HUDCard>

                        <HUDCard variant="cyan" label="SCORING CRITERIA (REFERENCE)">
                            {questions[qIdx].scoringCriteria.map((c,i) => (
                                <p key={i} className="text-xs text-white/50 py-0.5 font-mono-hud">• {c}</p>
                            ))}
                        </HUDCard>

                        <div className="flex gap-3">
                            <button
                                onClick={() => { setScreen('active'); setLastScore(null); setShowHints(false); }}
                                className="flex-1 py-3 rounded-xl font-hud text-[10px] tracking-widest transition-all"
                                style={{ border: `1px solid ${AMBER}44`, color: AMBER }}
                            >↺ RETRY THIS Q</button>
                            <button
                                onClick={nextQuestion}
                                className="flex-1 py-3 rounded-xl font-hud text-[10px] tracking-widest flex items-center justify-center gap-2 transition-all"
                                style={{
                                    background: `${AMBER}15`, border: `1px solid ${AMBER}`,
                                    color: AMBER, boxShadow: `0 0 12px ${AMBER}33`,
                                    textShadow: `0 0 8px ${AMBER}`,
                                }}
                            >
                                {qIdx + 1 < questions.length ? 'NEXT QUESTION' : 'FINISH SESSION'}
                                <ChevronRight size={14} />
                            </button>
                        </div>
                    </>
                )}

                {/* ── HISTORY ── */}
                {screen === 'history' && (
                    <>
                        {history.length === 0 ? (
                            <div className="text-center py-16">
                                <p className="text-4xl mb-4">📋</p>
                                <p className="font-mono-hud text-[11px] text-white/30">NO SESSIONS YET</p>
                                <p className="text-xs text-white/20 mt-1">Complete a practice session to see history</p>
                            </div>
                        ) : (
                            <>
                                <p className="font-hud text-[9px] tracking-widest text-white/30">RECENT SESSIONS</p>
                                {history.slice(0, 10).map(s => (
                                    <div key={s.id} className="p-4 rounded-xl" style={{ background: 'rgba(255,179,0,0.04)', border: '1px solid rgba(255,179,0,0.12)' }}>
                                        <div className="flex items-start justify-between gap-2">
                                            <div>
                                                <p className="text-sm text-white/80">{s.role}{s.company ? ` @ ${s.company}` : ''}</p>
                                                <p className="font-mono-hud text-[10px] text-white/30 mt-0.5">
                                                    {INTERVIEW_TYPE_LABELS[s.type]} · {DIFFICULTY_LABELS[s.difficulty]} · {s.questions.length}Q
                                                </p>
                                            </div>
                                            {s.overallScore != null && (
                                                <span className="font-hud text-lg flex-shrink-0" style={{
                                                    color: s.overallScore >= 8 ? '#00FF41' : s.overallScore >= 6 ? AMBER : RED,
                                                    textShadow: '0 0 10px currentColor',
                                                }}>
                                                    {s.overallScore}/10
                                                </span>
                                            )}
                                        </div>
                                        <p className="font-mono-hud text-[10px] text-white/20 mt-2">
                                            {new Date(s.startedAt).toLocaleDateString()} {new Date(s.startedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}
                                        </p>
                                    </div>
                                ))}
                            </>
                        )}
                        <button onClick={() => setScreen('setup')} className="w-full py-3 rounded-xl font-hud text-[10px] tracking-widest transition-all mt-2"
                            style={{ border: `1px solid ${AMBER}44`, color: AMBER }}>
                            + NEW SESSION
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}

// ── Typed answer submit box ───────────────────────────────────────────────────
function ManualAnswerBox({ onSubmit }: { onSubmit: (a: string) => void }) {
    const [open, setOpen] = useState(false);
    const [text, setText] = useState('');
    if (!open) return (
        <button
            onClick={() => setOpen(true)}
            className="w-full py-2 font-mono-hud text-[10px] text-white/25 hover:text-white/50 transition-colors"
        >
            Or type your answer manually →
        </button>
    );
    return (
        <div className="space-y-2">
            <textarea
                value={text} onChange={e => setText(e.target.value)}
                rows={5}
                placeholder="Type your answer here to get scored…"
                className="w-full bg-transparent text-sm text-white/80 outline-none resize-none p-3 rounded-lg placeholder:text-white/20"
                style={{ border: '1px solid rgba(255,179,0,0.25)' }}
                autoFocus
            />
            <div className="flex gap-2">
                <button onClick={() => { setOpen(false); setText(''); }} className="flex-1 py-2 font-mono-hud text-[10px] text-white/30">CANCEL</button>
                <button
                    onClick={() => { if (text.trim()) { onSubmit(text.trim()); setOpen(false); setText(''); } }}
                    className="flex-1 py-2 rounded-lg font-hud text-[10px] tracking-widest"
                    style={{ background: 'rgba(255,179,0,0.12)', border: '1px solid rgba(255,179,0,0.4)', color: '#FFB300' }}
                >SUBMIT ANSWER</button>
            </div>
        </div>
    );
}
