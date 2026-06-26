/**
 * OnboardingWizard.tsx — Matrix terminal system-initialization sequence.
 *
 * Black screen, green phosphor text that types line-by-line.
 * 6 steps collected, all saved as local_only encrypted memory.
 */
import React, { useState, useEffect, useRef } from 'react';
import { saveOnboardingMemory, saveCompanionState, COMPANION_MODES, CompanionMode } from '../services/companionPersonaService';
import { addHabit, addGoal, HABIT_TEMPLATES } from '../services/lifeCoachService';

interface Props {
    onComplete: () => void;
    onSkip?: () => void;
}

// ── STEPS ────────────────────────────────────────────────────────────────────
type StepType = 'text' | 'choice' | 'multiChoice';

interface Step {
    id: string;
    boot: string[];
    question: string;
    placeholder?: string;
    type: StepType;
    key: string;
    choices?: string[];
    choiceValues?: string[];
    subQuestion?: string;
    subKey?: string;
    subPlaceholder?: string;
}

const STEPS: Step[] = [
    {
        id: 'welcome',
        boot: [
            'ECHO COMPANION SYSTEM v2.4.1',
            'Initializing secure enclave…',
            'AES-GCM 256-bit encryption  ——  ONLINE',
            'PBKDF2 key derivation  ——  READY',
            '──────────────────────────────────────────',
            'Welcome, new companion.',
            'I need to learn who you are.',
            'All data stays on this device — encrypted.',
        ],
        question: 'What should I call you?',
        placeholder: 'Your name…',
        type: 'text',
        key: 'userName',
    },
    {
        id: 'style',
        boot: ['SCANNING PERSONALITY MATRIX…', 'Select how you prefer to work:'],
        question: 'What is your work style?',
        type: 'choice',
        key: 'workStyle',
        choices: ['🎯  Deep focus blocks', '⚡  Short intense sprints', '🌊  Go with the flow', '🗂️  Strict schedule'],
    },
    {
        id: 'goal',
        boot: ['LOADING GOAL TRACKING MODULE…', 'Let\'s anchor your primary mission.'],
        question: 'What is your biggest goal right now?',
        placeholder: 'e.g. Launch my startup by December…',
        type: 'text',
        key: 'primaryGoal',
    },
    {
        id: 'habits',
        boot: ['HABIT ENGINE READY…', 'Select habits to track daily:'],
        question: 'Pick daily habits to build:',
        type: 'multiChoice',
        key: 'habits',
        choices: HABIT_TEMPLATES.map(h => `${h.icon}  ${h.name}`),
    },
    {
        id: 'schedule',
        boot: ['CHRONOS MODULE ACTIVE…', 'Understanding your daily rhythm.'],
        question: 'When do you usually wake up?',
        placeholder: '07:00',
        type: 'text',
        key: 'wakeTime',
        subQuestion: 'Bedtime?',
        subKey: 'bedTime',
        subPlaceholder: '23:00',
    },
    {
        id: 'persona',
        boot: ['COMPANION PERSONA SELECTION…', 'Choose how I speak to you:'],
        question: 'What role should I play?',
        type: 'choice',
        key: 'companionMode',
        choices: COMPANION_MODES.map(m => `${m.emoji}  ${m.label}  —  ${m.description}`),
        choiceValues: COMPANION_MODES.map(m => m.id),
    },
];

// ── Main component ────────────────────────────────────────────────────────────
export default function OnboardingWizard({ onComplete, onSkip }: Props) {
    const [stepIdx, setStepIdx]       = useState(0);
    const [bootLine, setBootLine]     = useState(0);
    const [showInput, setShowInput]   = useState(false);
    const [answers, setAnswers]       = useState<Record<string, string>>({});
    const [multiSel, setMultiSel]     = useState<number[]>([]);
    const [value, setValue]           = useState('');
    const [subValue, setSubValue]     = useState('');
    const [history, setHistory]       = useState<string[]>([]);
    const [finished, setFinished]     = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);
    const inputRef  = useRef<HTMLInputElement>(null);

    const step = STEPS[stepIdx];

    // Animate boot lines one at a time
    useEffect(() => {
        setBootLine(0);
        setShowInput(false);
        setValue('');
        setSubValue('');
        setMultiSel([]);
        let line = 0;
        const iv = setInterval(() => {
            line++;
            setBootLine(line);
            if (line >= step.boot.length) {
                clearInterval(iv);
                setTimeout(() => setShowInput(true), 400);
            }
        }, 110);
        return () => clearInterval(iv);
    }, [stepIdx]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        if (showInput && inputRef.current) inputRef.current.focus();
    }, [bootLine, showInput, history]);

    const advance = () => {
        const newAns = { ...answers };

        if (step.type === 'multiChoice') {
            const names = multiSel.map(i => HABIT_TEMPLATES[i]?.name ?? '');
            newAns[step.key] = names.join(', ');
        } else if (step.type === 'choice' && step.choiceValues) {
            // value holds the label string; find its index
            const idx = (step.choices ?? []).indexOf(value);
            newAns[step.key] = idx >= 0 ? (step.choiceValues[idx] ?? value) : value;
        } else {
            newAns[step.key] = value.trim();
        }
        if (step.subKey) newAns[step.subKey] = subValue.trim();

        setAnswers(newAns);

        const echoLine = step.type === 'multiChoice'
            ? `> ${multiSel.map(i => HABIT_TEMPLATES[i]?.name).join(', ') || '(skipped)'}`
            : `> ${value.trim() || '(skipped)'}`;

        setHistory(h => [
            ...h,
            '',
            ...step.boot.slice(0, bootLine),
            `?: ${step.question}`,
            echoLine,
        ]);

        if (stepIdx < STEPS.length - 1) {
            setStepIdx(s => s + 1);
        } else {
            commitAndFinish(newAns);
        }
    };

    const commitAndFinish = async (ans: Record<string, string>) => {
        setFinished(true);
        const mode = (ans.companionMode || 'friend') as CompanionMode;
        saveCompanionState({ mode, userName: ans.userName, onboardingComplete: true });

        saveOnboardingMemory('userName',    ans.userName    || '');
        saveOnboardingMemory('workStyle',   ans.workStyle   || '');
        saveOnboardingMemory('primaryGoal', ans.primaryGoal || '');
        saveOnboardingMemory('wakeTime',    ans.wakeTime    || '');
        saveOnboardingMemory('bedTime',     ans.bedTime     || '');

        if (ans.habits) {
            const names = ans.habits.split(', ');
            HABIT_TEMPLATES.filter(h => names.includes(h.name))
                .forEach(h => addHabit({
                    name: h.name,
                    icon: h.icon,
                    frequency: 'daily',
                    category: h.category,
                    lastCompleted: null
                }));
        }

        if (ans.primaryGoal) {
            addGoal({
                title: ans.primaryGoal,
                category: 'personal',
                why: '',
                milestones: [],
                notes: ''
            });
        }

        setTimeout(onComplete, 2400);
    };

    const handleChoiceClick = (i: number) => {
        if (step.type === 'multiChoice') {
            setMultiSel(s => s.includes(i) ? s.filter(x=>x!==i) : [...s, i]);
        } else {
            setValue(step.choices?.[i] ?? '');
        }
    };

    const greenDim  = 'rgba(0,255,65,0.35)';
    const greenMid  = 'rgba(0,255,65,0.6)';
    const greenBright = '#00FF41';

    return (
        <div
            className="fixed inset-0 z-50 flex flex-col overflow-hidden"
            style={{ background: '#000601', fontFamily: '"Share Tech Mono", "Courier New", monospace' }}
        >
            {/* CRT scanlines */}
            <div
                className="pointer-events-none absolute inset-0 z-10"
                style={{
                    backgroundImage: 'repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,255,65,0.012) 2px,rgba(0,255,65,0.012) 4px)',
                }}
            />

            {/* Header */}
            <div
                className="flex items-center justify-between px-6 py-3 z-20 flex-shrink-0"
                style={{ borderBottom: '1px solid rgba(0,255,65,0.15)', background: 'rgba(0,255,65,0.025)' }}
            >
                <span style={{ color: greenBright, fontSize: 11, letterSpacing: '0.25em', textShadow: `0 0 8px ${greenBright}` }}>
                    ECHO // SYSTEM INITIALIZATION
                </span>
                <div className="flex items-center gap-4">
                    {/* Step bar */}
                    <div className="flex gap-1">
                        {STEPS.map((_, i) => (
                            <div key={i} style={{
                                width: 18, height: 2, borderRadius: 1,
                                background: i <= stepIdx ? greenBright : 'rgba(0,255,65,0.12)',
                                boxShadow: i <= stepIdx ? `0 0 5px ${greenBright}` : 'none',
                                transition: 'all 0.4s',
                            }} />
                        ))}
                    </div>
                    <span style={{ color: greenDim, fontSize: 10, letterSpacing: '0.15em' }}>
                        {finished ? STEPS.length : stepIdx + 1}/{STEPS.length}
                    </span>
                    <button
                        onClick={() => {
                            saveCompanionState({ onboardingComplete: true });
                            if (onSkip) {
                                onSkip();
                            } else {
                                onComplete();
                            }
                        }}
                        style={{ color: greenDim, fontSize: 10, letterSpacing: '0.15em', cursor: 'pointer' }}
                    >[SKIP]</button>
                </div>
            </div>

            {/* Terminal scroll area */}
            <div
                className="flex-1 overflow-y-auto px-8 py-6 z-20"
                style={{ scrollbarWidth: 'none' }}
            >
                {/* History */}
                {history.map((line, i) => (
                    <div key={i} style={{
                        color: line.startsWith('?:') ? greenMid : line.startsWith('>') ? greenBright : greenDim,
                        fontSize: 12, lineHeight: '1.7',
                        textShadow: line.startsWith('>') ? `0 0 6px ${greenBright}` : 'none',
                    }}>
                        {line}
                    </div>
                ))}

                {/* Separator when we have history */}
                {history.length > 0 && !finished && (
                    <div style={{ color: 'rgba(0,255,65,0.1)', fontSize: 12, margin: '12px 0' }}>
                        {'─'.repeat(58)}
                    </div>
                )}

                {/* Current boot lines */}
                {!finished && step.boot.slice(0, bootLine).map((line, i) => (
                    <div key={`b${stepIdx}-${i}`} style={{
                        color: line.includes('ONLINE') || line.includes('READY') || line.includes('ACTIVE') || line.includes('COMPLETE')
                            ? greenBright : line.startsWith('─') ? 'rgba(0,255,65,0.15)' : greenMid,
                        fontSize: 12, lineHeight: '1.7',
                        textShadow: line.includes('ONLINE') ? `0 0 8px ${greenBright}` : 'none',
                    }}>
                        {line}
                    </div>
                ))}

                {/* Input area */}
                {showInput && !finished && (
                    <div style={{ marginTop: 16 }}>
                        {/* Question */}
                        <div style={{ color: greenBright, fontSize: 13, marginBottom: 12, textShadow: `0 0 10px ${greenBright}` }}>
                            ❯ {step.question}
                        </div>

                        {/* Choices */}
                        {(step.type === 'choice' || step.type === 'multiChoice') && step.choices && (
                            <div style={{ marginLeft: 16, marginBottom: 12 }}>
                                {step.choices.map((c, i) => {
                                    const sel = step.type === 'multiChoice' ? multiSel.includes(i) : value === c;
                                    return (
                                        <button
                                            key={i} onClick={() => handleChoiceClick(i)}
                                            className="block text-left w-full"
                                            style={{
                                                color: sel ? greenBright : greenDim,
                                                fontSize: 12, lineHeight: '2',
                                                textShadow: sel ? `0 0 8px ${greenBright}` : 'none',
                                                letterSpacing: '0.05em',
                                                transition: 'all 0.15s',
                                            }}
                                        >
                                            [{sel ? 'X' : ' '}] {i + 1}. {c}
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        {/* Text input(s) */}
                        {step.type === 'text' && (
                            <div style={{ marginLeft: 16 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{ color: greenBright }}>$</span>
                                    <input
                                        ref={inputRef}
                                        value={value}
                                        onChange={e => setValue(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter' && !step.subKey) advance(); }}
                                        placeholder={step.placeholder}
                                        className="flex-1 bg-transparent outline-none"
                                        style={{
                                            color: greenBright, fontSize: 13,
                                            caretColor: greenBright,
                                            border: 'none',
                                        }}
                                    />
                                </div>
                                {step.subKey && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                                        <span style={{ color: greenBright }}>$</span>
                                        <span style={{ color: greenMid, fontSize: 12, marginRight: 8 }}>{step.subQuestion}</span>
                                        <input
                                            value={subValue}
                                            onChange={e => setSubValue(e.target.value)}
                                            onKeyDown={e => { if (e.key === 'Enter') advance(); }}
                                            placeholder={step.subPlaceholder}
                                            className="flex-1 bg-transparent outline-none"
                                            style={{ color: greenBright, fontSize: 13, caretColor: greenBright, border: 'none' }}
                                        />
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Confirm button */}
                        <button
                            onClick={advance}
                            style={{
                                marginTop: 20,
                                padding: '6px 18px',
                                border: `1px solid rgba(0,255,65,0.35)`,
                                color: greenBright,
                                fontSize: 11,
                                letterSpacing: '0.2em',
                                background: 'rgba(0,255,65,0.04)',
                                boxShadow: '0 0 10px rgba(0,255,65,0.12)',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                            }}
                        >
                            [CONFIRM] ↵ ENTER
                        </button>
                    </div>
                )}

                {/* Completion */}
                {finished && (
                    <div style={{ marginTop: 24 }}>
                        {['──────────────────────────────────────────',
                          'INITIALIZATION COMPLETE.',
                          'Memory encrypted and stored locally.',
                          'Echo is online. Your companion is ready.',
                        ].map((line, i) => (
                            <div key={i} style={{
                                color: line === 'INITIALIZATION COMPLETE.' ? greenBright : greenMid,
                                fontSize: i === 0 ? 11 : 13,
                                lineHeight: '1.9',
                                textShadow: line === 'INITIALIZATION COMPLETE.' ? `0 0 12px ${greenBright}` : 'none',
                                letterSpacing: line.includes('─') ? 0 : '0.05em',
                            }}>{line}</div>
                        ))}
                        <div style={{
                            marginTop: 24, textAlign: 'center',
                            color: greenBright, fontSize: 22,
                            textShadow: `0 0 20px ${greenBright}, 0 0 40px ${greenBright}`,
                            letterSpacing: '0.4em',
                        }}>
                            ◉ ONLINE
                        </div>
                    </div>
                )}

                <div ref={bottomRef} style={{ height: 40 }} />
            </div>
        </div>
    );
}
