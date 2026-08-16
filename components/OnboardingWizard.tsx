/**
 * OnboardingWizard.tsx — Matrix terminal system-initialization sequence.
 *
 * Black screen, green phosphor text that types line-by-line.
 * 7 steps collected (profile + free AI key hookup), all saved locally.
 */
import React, { useState, useEffect, useRef } from 'react';
import { saveOnboardingMemory, saveCompanionState, COMPANION_MODES, CompanionMode } from '../services/companionPersonaService';
import { addHabit, addGoal, HABIT_TEMPLATES } from '../services/lifeCoachService';
import { testApiKey, detectProviderFromKey, LlmProvider } from '../services/llmRouter';
import DecodeText from './fx/DecodeText';

interface Props {
    onComplete: () => void;
    onSkip?: () => void;
    /** Opens the "What Echo can do" capability-discovery panel (components/ExplorePanel.tsx). */
    onExplore?: () => void;
}

/** A handful of concrete prompts spanning different capability categories,
 *  shown once on the completion screen — see ExplorePanel.tsx for the full
 *  browsable list this links out to. */
const TRY_THESE = [
    '🗓️  "Plan my week"',
    '📱  "Post this update to social media for me"',
    '🎥  "Join my next meeting and take notes"',
    '⌨️  "Turn on dictation so I can type anywhere by voice"',
];

// ── STEPS ────────────────────────────────────────────────────────────────────
type StepType = 'text' | 'choice' | 'multiChoice' | 'apiKey';

/** Where each provider's key lives in localStorage (mirrors llmRouter). */
const PROVIDER_STORAGE_KEYS: Partial<Record<LlmProvider, string>> = {
    gemini: 'echo_api_key',
    groq: 'echo_groq_key',
    openrouter: 'echo_openrouter_key',
    openai: 'echo_openai_key',
    anthropic: 'echo_anthropic_key',
    mistral: 'echo_mistral_key',
    huggingface: 'echo_hf_key',
};

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
            'Plain words: private. Nothing gets uploaded. No account needed.',
        ],
        question: 'What should I call you?',
        placeholder: 'Your name…',
        type: 'text',
        key: 'userName',
    },
    {
        id: 'style',
        boot: ['SCANNING PERSONALITY MATRIX…', 'No wrong answers — pick whatever feels most like you:'],
        question: 'What is your work style?',
        type: 'choice',
        key: 'workStyle',
        choices: ['🎯  Deep focus blocks', '⚡  Short intense sprints', '🌊  Go with the flow', '🗂️  Strict schedule'],
    },
    {
        id: 'goal',
        boot: ['LOADING GOAL TRACKING MODULE…', 'Let\'s anchor your primary mission — big or small, your call.'],
        question: 'What is your biggest goal right now?',
        placeholder: 'e.g. Get fit, launch my shop, learn Spanish…',
        type: 'text',
        key: 'primaryGoal',
    },
    {
        id: 'habits',
        boot: ['HABIT ENGINE READY…', 'Tap any you\'d like me to help you keep up (or none):'],
        question: 'Pick daily habits to build:',
        type: 'multiChoice',
        key: 'habits',
        choices: HABIT_TEMPLATES.map(h => `${h.icon}  ${h.name}`),
    },
    {
        id: 'schedule',
        boot: ['CHRONOS MODULE ACTIVE…', 'Understanding your daily rhythm.'],
        question: 'When do you usually wake up?',
        placeholder: 'e.g. 7:00 am',
        type: 'text',
        key: 'wakeTime',
        subQuestion: 'Bedtime?',
        subKey: 'bedTime',
        subPlaceholder: 'e.g. 11:00 pm',
    },
    {
        id: 'persona',
        boot: ['COMPANION PERSONA SELECTION…', 'Choose how I speak to you (you can change this anytime):'],
        question: 'What role should I play?',
        type: 'choice',
        key: 'companionMode',
        choices: COMPANION_MODES.map(m => `${m.emoji}  ${m.label}  —  ${m.description}`),
        choiceValues: COMPANION_MODES.map(m => m.id),
    },
    {
        id: 'brain',
        boot: [
            'FINAL STEP — CONNECT AI BRAIN…',
            'Echo thinks using Google\'s free AI.',
            'You just need one free key — it takes about 60 seconds.',
            'No credit card. The key is saved on this device only.',
        ],
        question: 'Connect your AI brain:',
        type: 'apiKey',
        key: 'apiKey',
    },
];

/** Plain-English instructions shown on the CONNECT AI BRAIN step. */
const KEY_INSTRUCTIONS = [
    '1. Tap the button below — it opens Google\'s key page in a new tab.',
    '2. Sign in with your Google account.',
    '3. Click "Create API key".',
    '4. Copy the key, come back here, and paste it below.',
];

// ── Main component ────────────────────────────────────────────────────────────
export default function OnboardingWizard({ onComplete, onSkip, onExplore }: Props) {
    const [stepIdx, setStepIdx]       = useState(0);
    const [bootLine, setBootLine]     = useState(0);
    const [showInput, setShowInput]   = useState(false);
    const [answers, setAnswers]       = useState<Record<string, string>>({});
    const [multiSel, setMultiSel]     = useState<number[]>([]);
    const [value, setValue]           = useState('');
    const [subValue, setSubValue]     = useState('');
    const [history, setHistory]       = useState<string[]>([]);
    const [finished, setFinished]     = useState(false);
    const autoAdvanceRef = useRef<number | null>(null);
    // ── AI-key step state ──
    const [keyStatus, setKeyStatus]   = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle');
    const [keyMessage, setKeyMessage] = useState('');
    const [keyProvider, setKeyProvider] = useState<LlmProvider | null>(null);
    const [keySaved, setKeySaved]     = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);
    const inputRef  = useRef<HTMLInputElement>(null);
    const debounceRef    = useRef<number | null>(null);
    const validateSeqRef = useRef(0);

    const step = STEPS[stepIdx];

    // Animate boot lines one at a time
    useEffect(() => {
        setBootLine(0);
        setShowInput(false);
        setValue('');
        setSubValue('');
        setMultiSel([]);
        setKeyStatus('idle');
        setKeyMessage('');
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

    // Clear any pending key-validation debounce / completion auto-advance on unmount
    useEffect(() => () => {
        if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
        if (autoAdvanceRef.current !== null) window.clearTimeout(autoAdvanceRef.current);
    }, []);

    // ── AI-key validation ────────────────────────────────────────────────────
    const validateKey = async (trimmed: string) => {
        const detected = detectProviderFromKey(trimmed);
        const looksLikeGemini = trimmed.startsWith('AIza') && trimmed.length > 30;
        const provider: LlmProvider | null = detected ?? (looksLikeGemini ? 'gemini' : null);

        if (!provider) {
            setKeyStatus('invalid');
            setKeyMessage('That doesn\'t look like a key yet. Google keys start with "AIza…" — make sure you copied the whole thing.');
            return;
        }
        if (provider === 'gemini' && trimmed.length <= 30) {
            setKeyStatus('invalid');
            setKeyMessage('That key looks too short — copy the whole thing and paste again.');
            return;
        }

        const seq = ++validateSeqRef.current;
        setKeyStatus('validating');
        setKeyMessage('');
        try {
            const res = await testApiKey(provider, trimmed);
            if (seq !== validateSeqRef.current) return; // a newer paste superseded this check
            if (res.ok) {
                localStorage.setItem(PROVIDER_STORAGE_KEYS[provider] ?? 'echo_api_key', trimmed);
                setKeyProvider(provider);
                setKeyMessage(res.message);
                setKeyStatus('valid');
                setKeySaved(true);
            } else {
                setKeyStatus('invalid');
                setKeyMessage(res.message);
            }
        } catch {
            if (seq !== validateSeqRef.current) return;
            setKeyStatus('invalid');
            setKeyMessage('Couldn\'t reach the internet to check the key. Try again in a moment.');
        }
    };

    const handleKeyChange = (raw: string) => {
        setValue(raw);
        setKeyStatus('idle');
        setKeyMessage('');
        if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
        const trimmed = raw.trim();
        if (!trimmed) return;
        debounceRef.current = window.setTimeout(() => { void validateKey(trimmed); }, 450);
    };

    const skipKeyStep = () => {
        setHistory(h => [
            ...h,
            '',
            ...step.boot.slice(0, bootLine),
            `?: ${step.question}`,
            '> (skipped — you can add a key later in Settings)',
        ]);
        commitAndFinish({ ...answers });
    };

    const advance = () => {
        // Never confirm this step with an unvalidated key — validate or skip.
        if (step.type === 'apiKey' && keyStatus !== 'valid') return;

        const newAns = { ...answers };

        if (step.type === 'multiChoice') {
            const names = multiSel.map(i => HABIT_TEMPLATES[i]?.name ?? '');
            newAns[step.key] = names.join(', ');
        } else if (step.type === 'choice' && step.choiceValues) {
            // value holds the label string; find its index
            const idx = (step.choices ?? []).indexOf(value);
            newAns[step.key] = idx >= 0 ? (step.choiceValues[idx] ?? value) : value;
        } else if (step.type === 'apiKey') {
            newAns[step.key] = 'connected'; // never store the raw key in answers
        } else {
            newAns[step.key] = value.trim();
        }
        if (step.subKey) newAns[step.subKey] = subValue.trim();

        setAnswers(newAns);

        const echoLine = step.type === 'multiChoice'
            ? `> ${multiSel.map(i => HABIT_TEMPLATES[i]?.name).join(', ') || '(skipped)'}`
            : step.type === 'apiKey'
                ? '> ✓ AI BRAIN ONLINE'
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

        autoAdvanceRef.current = window.setTimeout(onComplete, 5200);
    };

    /** Either CTA on the completion screen — cancels the auto-advance timer
     *  so it can't also fire onComplete a second time right after. */
    const finishNow = (explore: boolean) => {
        if (autoAdvanceRef.current !== null) {
            window.clearTimeout(autoAdvanceRef.current);
            autoAdvanceRef.current = null;
        }
        if (explore && onExplore) onExplore();
        else onComplete();
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
    const greenBright = 'var(--accent-green)';

    return (
        <div
            className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden sm:p-6"
            style={{ background: 'var(--bg-base)', fontFamily: 'var(--font-term)' }}
        >
            <style>{`
                .ow-input { caret-color: var(--accent-green); }
                .ow-input::placeholder { color: rgba(0,255,65,0.28); }
                .ow-input:focus { text-shadow: 0 0 8px rgba(0,255,65,0.45); }
            `}</style>

            <div className="term-window animate-phosphor-in flex flex-col w-full h-full max-w-4xl">
                {/* Titlebar */}
                <div className="term-titlebar flex-shrink-0">
                    <span className="term-dots" />
                    <DecodeText text="ECHO://INIT — SYSTEM INITIALIZATION" speed={16} />
                    <div className="ml-auto flex items-center gap-4">
                        {/* Step progress blocks */}
                        <span aria-hidden="true" style={{ fontSize: 11, letterSpacing: '0.2em', whiteSpace: 'nowrap' }}>
                            {STEPS.map((_, i) => (
                                <span key={i} style={{
                                    color: i <= stepIdx ? greenBright : 'rgba(0,255,65,0.18)',
                                    textShadow: i <= stepIdx ? `0 0 6px ${greenBright}` : 'none',
                                    transition: 'all 0.4s',
                                }}>{i <= stepIdx ? '▮' : '▯'}</span>
                            ))}
                        </span>
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
                            className="btn-term ghost"
                            style={{ padding: '4px 10px', fontSize: 10 }}
                        >SKIP</button>
                    </div>
                </div>

                {/* Terminal scroll area */}
                <div
                    className="flex-1 overflow-y-auto px-8 py-6"
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
                            ❯ <DecodeText text={step.question} speed={22} />
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
                                        className="ow-input flex-1 bg-transparent outline-none"
                                        style={{
                                            color: greenBright, fontSize: 13,
                                            border: 'none',
                                            fontFamily: 'inherit',
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
                                            className="ow-input flex-1 bg-transparent outline-none"
                                            style={{ color: greenBright, fontSize: 13, border: 'none', fontFamily: 'inherit' }}
                                        />
                                    </div>
                                )}
                            </div>
                        )}

                        {/* AI-key step */}
                        {step.type === 'apiKey' && (
                            <div style={{ marginLeft: 16, marginBottom: 12 }}>
                                {KEY_INSTRUCTIONS.map((line, i) => (
                                    <div key={i} style={{ color: greenMid, fontSize: 12, lineHeight: '1.9' }}>
                                        {line}
                                    </div>
                                ))}

                                <a
                                    href="https://aistudio.google.com/apikey"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn-term solid"
                                    style={{
                                        display: 'inline-flex',
                                        margin: '16px 0',
                                        textDecoration: 'none',
                                    }}
                                >
                                    GET MY FREE KEY →
                                </a>

                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{ color: greenBright }}>$</span>
                                    <input
                                        ref={inputRef}
                                        type={keyStatus === 'valid' ? 'password' : 'text'}
                                        value={value}
                                        onChange={e => handleKeyChange(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter' && keyStatus === 'valid') advance(); }}
                                        placeholder="Paste your key here…"
                                        autoComplete="off"
                                        spellCheck={false}
                                        className="ow-input flex-1 bg-transparent outline-none"
                                        style={{
                                            color: greenBright, fontSize: 13,
                                            border: 'none',
                                            fontFamily: 'inherit',
                                        }}
                                    />
                                </div>

                                {/* Live validation status */}
                                {keyStatus === 'validating' && (
                                    <div style={{ color: greenMid, fontSize: 12, marginTop: 10 }}>
                                        VALIDATING KEY…
                                    </div>
                                )}
                                {keyStatus === 'valid' && (
                                    <div style={{ color: greenBright, fontSize: 12, marginTop: 10, textShadow: `0 0 8px ${greenBright}` }}>
                                        ✓ AI BRAIN ONLINE{keyProvider && keyProvider !== 'gemini' ? ` (${keyProvider.toUpperCase()} KEY)` : ''} — {keyMessage}
                                    </div>
                                )}
                                {keyStatus === 'invalid' && (
                                    <div style={{ color: 'var(--accent-red)', fontSize: 12, marginTop: 10 }}>
                                        ✗ {keyMessage}
                                    </div>
                                )}

                                <button
                                    onClick={skipKeyStep}
                                    className="btn-term ghost"
                                    style={{ display: 'inline-flex', marginTop: 18, padding: '6px 14px', fontSize: 11 }}
                                >
                                    SKIP — I'LL DO THIS LATER
                                </button>
                            </div>
                        )}

                        {/* Confirm button */}
                        <button
                            onClick={advance}
                            disabled={step.type === 'apiKey' && keyStatus !== 'valid'}
                            className="btn-term"
                            style={{
                                marginTop: 20,
                                fontSize: 11,
                                cursor: step.type === 'apiKey' && keyStatus !== 'valid' ? 'not-allowed' : 'pointer',
                                opacity: step.type === 'apiKey' && keyStatus !== 'valid' ? 0.35 : 1,
                            }}
                        >
                            CONFIRM ↵ ENTER
                        </button>
                    </div>
                )}

                {/* Completion */}
                {finished && (
                    <div style={{ marginTop: 24 }}>
                        <div style={{ color: 'rgba(0,255,65,0.15)', fontSize: 11, lineHeight: '1.9' }}>
                            {'─'.repeat(46)}
                        </div>
                        <div style={{ color: greenBright, fontSize: 13, lineHeight: '1.9', textShadow: `0 0 12px ${greenBright}`, letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className="status-dot green" /> [OK] INITIALIZATION COMPLETE.
                        </div>
                        <div style={{ color: greenMid, fontSize: 13, lineHeight: '1.9', letterSpacing: '0.05em' }}>
                            [OK] Memory encrypted and stored locally.
                        </div>
                        {keySaved && (
                            <div style={{ color: greenBright, fontSize: 13, lineHeight: '1.9', textShadow: `0 0 12px ${greenBright}`, letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span className="status-dot green" /> [OK] AI BRAIN: CONNECTED
                            </div>
                        )}
                        <div style={{ color: greenMid, fontSize: 13, lineHeight: '1.9', letterSpacing: '0.05em' }}>
                            Echo is online. Your companion is ready.
                        </div>
                        {!keySaved && (
                            <div style={{
                                color: 'var(--accent-amber)',
                                fontSize: 12,
                                lineHeight: '1.9',
                                marginTop: 8,
                                letterSpacing: '0.05em',
                                textShadow: '0 0 8px rgba(255,179,0,0.5)',
                                display: 'flex', alignItems: 'center', gap: 8,
                            }}>
                                <span className="status-dot amber" /> [WARN] no AI key connected — Echo can't think yet. Add one anytime in Settings.
                            </div>
                        )}
                        <div style={{
                            marginTop: 24, textAlign: 'center',
                            color: greenBright, fontSize: 22,
                            textShadow: `0 0 20px ${greenBright}, 0 0 40px ${greenBright}`,
                            letterSpacing: '0.4em',
                        }}>
                            ◉ ONLINE
                        </div>

                        {/* A few concrete things to try — answers "what can this
                            actually do?" right when it matters most, links out
                            to the full ExplorePanel rather than duplicating it. */}
                        <div style={{ marginTop: 32, maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>
                            <p style={{ color: greenMid, fontSize: 11, letterSpacing: '0.15em', marginBottom: 10, textAlign: 'center' }}>
                                A FEW THINGS YOU CAN TRY RIGHT NOW
                            </p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {TRY_THESE.map((line, i) => (
                                    <div key={i} style={{ color: greenBright, fontSize: 13, lineHeight: '1.6', textAlign: 'center' }}>
                                        {line}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                            <button
                                onClick={() => finishNow(false)}
                                className="btn-term solid"
                                style={{ padding: '10px 28px', fontSize: 12 }}
                            >
                                START TALKING →
                            </button>
                            {onExplore && (
                                <button
                                    onClick={() => finishNow(true)}
                                    className="btn-term ghost"
                                    style={{ padding: '6px 16px', fontSize: 11 }}
                                >
                                    See everything Echo can do →
                                </button>
                            )}
                        </div>
                    </div>
                )}

                <div ref={bottomRef} style={{ height: 40 }} />
                </div>
            </div>
        </div>
    );
}
