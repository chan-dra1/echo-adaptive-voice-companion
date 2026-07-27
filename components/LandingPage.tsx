import React from 'react';
import { Mic, Layers, Rocket, ShieldCheck, ArrowRight } from 'lucide-react';
import MatrixRain from './MatrixRain';
import DecodeText from './fx/DecodeText';

// LandingPage — full-screen pre-onboarding landing page.
// First thing a stranger sees. Sells Echo in 5 seconds, funnels to onGetStarted().
// Self-contained: scoped `lp-` keyframes, CSS vars from src/index.css, no new deps.

interface LandingPageProps {
    onGetStarted: () => void;
}

const ACCENT = '#00ff41';

const FEATURES: { icon: React.ReactNode; tag: string; title: string; body: string }[] = [
    {
        icon: <Mic size={22} strokeWidth={1.75} />,
        tag: 'VOICE.SYS',
        title: 'Voice-first companion',
        body: 'Talk naturally, in real time. Echo listens, answers out loud, and remembers you between conversations.',
    },
    {
        icon: <Layers size={22} strokeWidth={1.75} />,
        tag: 'SKILLS×40',
        title: '40+ built-in skills',
        body: 'Email, social posts, research, content, lead finding, image generation and more — ready out of the box.',
    },
    {
        icon: <Rocket size={22} strokeWidth={1.75} />,
        tag: 'MISSIONS.D',
        title: 'Autonomous missions',
        body: 'Hand Echo a goal and a schedule. Missions run on their own and report back when the work is done.',
    },
    {
        icon: <ShieldCheck size={22} strokeWidth={1.75} />,
        tag: 'PRIVACY.LOCK',
        title: 'Private by design',
        body: 'No account, no server. Your keys and memory are stored locally on your device, encrypted.',
    },
];

const STEPS: { step: string; title: string; body: string }[] = [
    {
        step: '1',
        title: 'Say hello',
        body: 'Open Echo and start talking. That’s it.',
    },
    {
        step: '2',
        title: 'Connect your free Google AI key',
        body: 'Takes about 60 seconds — we walk you through every step.',
    },
    {
        step: '3',
        title: 'Echo gets to work',
        body: 'Ask for anything: research, content, outreach, automations.',
    },
];

const LandingPage: React.FC<LandingPageProps> = ({ onGetStarted }) => {
    return (
        <div
            className="fixed inset-0 z-50 overflow-y-auto overflow-x-hidden"
            style={{
                background: 'var(--bg-base)',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-ui)',
                WebkitOverflowScrolling: 'touch',
            }}
        >
            <style>{`
                @keyframes lp-fade-up {
                    from { opacity: 0; transform: translateY(22px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
                @keyframes lp-glow-pulse {
                    0%, 100% { box-shadow: 0 0 24px rgba(0, 255, 65, 0.28), 0 0 64px rgba(0, 255, 65, 0.10); }
                    50%      { box-shadow: 0 0 36px rgba(0, 255, 65, 0.45), 0 0 96px rgba(0, 255, 65, 0.18); }
                }
                @keyframes lp-orb-breathe {
                    0%, 100% { transform: scale(1);    opacity: 0.85; }
                    50%      { transform: scale(1.08); opacity: 1; }
                }
                @keyframes lp-ring-spin {
                    from { transform: rotate(0deg); }
                    to   { transform: rotate(360deg); }
                }
                .lp-reveal {
                    opacity: 0;
                    animation: lp-fade-up 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                }
                .lp-cta {
                    animation: lp-glow-pulse 3.2s ease-in-out infinite;
                    transition: filter 0.18s ease, box-shadow 0.18s ease;
                }
                .lp-cta:hover  { filter: brightness(1.1); }
                .lp-cta:active { filter: brightness(0.95); }
                .lp-card {
                    transition: border-color 0.25s ease, box-shadow 0.25s ease;
                }
                .lp-card:hover {
                    border-color: rgba(0, 255, 65, 0.55) !important;
                    box-shadow:
                        0 0 0 1px rgba(0, 255, 65, 0.08),
                        0 16px 48px rgba(0, 0, 0, 0.75),
                        0 0 24px rgba(0, 255, 65, 0.18),
                        inset 0 0 60px rgba(0, 255, 65, 0.05) !important;
                }
                @media (prefers-reduced-motion: reduce) {
                    .lp-reveal { animation: none; opacity: 1; }
                    .lp-cta, .lp-orb-core, .lp-orb-ring { animation: none !important; }
                    .lp-rain-scrim ~ * .animate-phosphor-in,
                    .animate-phosphor-in { animation: none !important; }
                }
            `}</style>

            {/* ---- Digital rain backdrop + readability scrim ---- */}
            <div className="pointer-events-none fixed inset-0" aria-hidden="true">
                <MatrixRain />
                <div
                    className="lp-rain-scrim absolute inset-0"
                    style={{
                        background:
                            'radial-gradient(ellipse 58% 62% at 50% 34%, rgba(1, 5, 2, 0.94), rgba(1, 5, 2, 0.62) 62%, rgba(1, 5, 2, 0.18) 100%),' +
                            'linear-gradient(to bottom, rgba(1, 5, 2, 0.35), rgba(1, 5, 2, 0.15) 40%, rgba(1, 5, 2, 0.55) 100%)',
                    }}
                />
                <div
                    className="absolute inset-0"
                    style={{
                        background:
                            'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(0, 255, 65, 0.07), transparent 60%)',
                    }}
                />
            </div>

            <div className="relative z-10 mx-auto flex min-h-full w-full max-w-6xl flex-col px-5 sm:px-8">
                {/* ---- Top bar ---- */}
                <header
                    className="lp-reveal flex items-center justify-between py-6"
                    style={{ animationDelay: '0.05s' }}
                >
                    <div className="flex items-center gap-3">
                        <span
                            className="glitch text-sm font-semibold tracking-[0.3em]"
                            data-text="ECHO"
                            style={{
                                fontFamily: 'var(--font-term)',
                                color: 'var(--text-primary)',
                                textShadow: '0 0 12px rgba(0, 255, 65, 0.4)',
                            }}
                        >
                            ECHO
                        </span>
                        <span
                            className="hidden items-center gap-2 rounded-sm px-2.5 py-1 text-[10px] tracking-[0.22em] sm:inline-flex"
                            style={{
                                fontFamily: 'var(--font-term)',
                                color: 'var(--text-secondary)',
                                border: '1px solid var(--border-dim)',
                                background: 'rgba(0, 255, 65, 0.04)',
                            }}
                        >
                            <span className="status-dot green" />
                            SYS.ONLINE
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={onGetStarted}
                        className="btn-term ghost px-4 py-1.5 text-xs"
                    >
                        Get Started
                    </button>
                </header>

                {/* ---- Hero ---- */}
                <main className="flex flex-1 flex-col items-center pb-8 pt-10 text-center sm:pt-16">
                    <div
                        className="lp-reveal mb-6 inline-flex items-center gap-2 rounded-sm px-3.5 py-1.5 text-[11px] uppercase"
                        style={{
                            animationDelay: '0.1s',
                            border: '1px solid var(--border-dim)',
                            color: ACCENT,
                            background: 'rgba(0, 255, 65, 0.05)',
                            fontFamily: 'var(--font-term)',
                            letterSpacing: '0.22em',
                            textShadow: '0 0 8px rgba(0, 255, 65, 0.35)',
                        }}
                    >
                        <span className="status-dot green" />
                        PRIVATE &middot; LOCAL-FIRST &middot; FREE
                    </div>

                    {/* Voice orb — pure phosphor green */}
                    <div
                        className="lp-reveal relative mb-8 h-24 w-24 sm:h-28 sm:w-28"
                        style={{ animationDelay: '0.15s' }}
                        aria-hidden="true"
                    >
                        <div
                            className="lp-orb-ring absolute inset-0 rounded-full"
                            style={{
                                border: '1px solid rgba(0, 255, 65, 0.25)',
                                borderTopColor: 'rgba(0, 255, 65, 0.75)',
                                animation: 'lp-ring-spin 6s linear infinite',
                            }}
                        />
                        <div
                            className="lp-orb-ring absolute inset-2 rounded-full"
                            style={{
                                border: '1px solid rgba(0, 255, 65, 0.14)',
                                borderBottomColor: 'rgba(0, 255, 65, 0.5)',
                                animation: 'lp-ring-spin 9s linear infinite reverse',
                            }}
                        />
                        <div
                            className="lp-orb-core absolute inset-5 rounded-full"
                            style={{
                                background: `radial-gradient(circle at 35% 30%, rgba(190, 255, 210, 0.95), ${ACCENT} 45%, rgba(0, 70, 20, 0.9))`,
                                boxShadow: '0 0 32px rgba(0, 255, 65, 0.5), 0 0 80px rgba(0, 255, 65, 0.18)',
                                animation: 'lp-orb-breathe 3.6s ease-in-out infinite',
                            }}
                        />
                    </div>

                    <h1
                        className="lp-reveal glitch text-5xl font-bold tracking-[0.18em] sm:text-7xl"
                        data-text="ECHO"
                        style={{
                            animationDelay: '0.2s',
                            fontFamily: 'var(--font-term)',
                            color: 'var(--text-primary)',
                            textShadow:
                                '0 0 18px rgba(0, 255, 65, 0.55), 0 0 70px rgba(0, 255, 65, 0.25)',
                        }}
                    >
                        ECHO
                    </h1>

                    <div
                        className="lp-reveal mt-5 max-w-2xl text-base font-medium leading-snug sm:text-xl"
                        style={{
                            animationDelay: '0.28s',
                            color: ACCENT,
                            fontFamily: 'var(--font-term)',
                            letterSpacing: '0.06em',
                            textShadow: '0 0 10px rgba(0, 255, 65, 0.4)',
                        }}
                    >
                        <DecodeText
                            className="cursor-blink"
                            text="> Your personal AI that actually gets things done."
                            speed={22}
                            delay={500}
                        />
                    </div>

                    <p
                        className="lp-reveal mt-4 max-w-lg text-sm leading-relaxed sm:text-base"
                        style={{
                            animationDelay: '0.36s',
                            color: 'var(--text-secondary)',
                            fontFamily: 'var(--font-ui)',
                        }}
                    >
                        Echo talks with you by voice, learns your goals, and runs missions
                        autonomously &mdash; with 40+ built-in skills ready out of the box.
                    </p>

                    <button
                        type="button"
                        onClick={onGetStarted}
                        className="lp-reveal lp-cta btn-term solid mt-9 px-8 py-3.5 text-base sm:px-10"
                        style={{ animationDelay: '0.44s' }}
                    >
                        Get Started &mdash; Free
                        <ArrowRight size={18} strokeWidth={2.5} />
                    </button>

                    <p
                        className="lp-reveal mt-4 text-xs sm:text-[13px]"
                        style={{
                            animationDelay: '0.52s',
                            color: 'var(--text-tertiary)',
                            fontFamily: 'var(--font-term)',
                            letterSpacing: '0.08em',
                        }}
                    >
                        No account needed. Runs in your browser. Your data never leaves your device.
                    </p>
                </main>

                {/* ---- Feature cards ---- */}
                <section
                    className="lp-reveal grid grid-cols-1 gap-4 pb-16 pt-8 sm:grid-cols-2 lg:grid-cols-4"
                    style={{ animationDelay: '0.6s' }}
                    aria-label="Features"
                >
                    {FEATURES.map((f) => (
                        <div key={f.title} className="lp-card term-window animate-phosphor-in">
                            <div className="term-titlebar">
                                <span className="term-dots" />
                                {f.tag}
                            </div>
                            <div className="p-5">
                                <div
                                    className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded"
                                    style={{
                                        color: ACCENT,
                                        background: 'rgba(0, 255, 65, 0.07)',
                                        border: '1px solid var(--border-green)',
                                    }}
                                >
                                    {f.icon}
                                </div>
                                <h3
                                    className="mb-1.5 text-sm font-semibold"
                                    style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-ui)' }}
                                >
                                    {f.title}
                                </h3>
                                <p
                                    className="text-xs leading-relaxed"
                                    style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-ui)' }}
                                >
                                    {f.body}
                                </p>
                            </div>
                        </div>
                    ))}
                </section>

                {/* ---- How it works ---- */}
                <section className="lp-reveal pb-16" style={{ animationDelay: '0.7s' }} aria-label="How it works">
                    <p
                        className="mb-6 text-center text-[11px] tracking-[0.25em]"
                        style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-term)' }}
                    >
                        // HOW IT WORKS
                    </p>
                    <div className="term-window animate-phosphor-in">
                        <div className="term-titlebar">
                            <span className="term-dots" />
                            ECHO://BOOT_SEQ
                        </div>
                        <div className="flex flex-col items-stretch gap-1 p-3 sm:flex-row sm:gap-0 sm:p-2">
                            {STEPS.map((s, i) => (
                                <React.Fragment key={s.step}>
                                    <div className="flex-1 p-3 text-left">
                                        <p
                                            className="text-xs sm:text-[13px]"
                                            style={{
                                                fontFamily: 'var(--font-term)',
                                                letterSpacing: '0.06em',
                                                color: 'var(--text-primary)',
                                            }}
                                        >
                                            <span
                                                style={{
                                                    color: ACCENT,
                                                    textShadow: '0 0 8px rgba(0, 255, 65, 0.5)',
                                                }}
                                            >
                                                ${' '}
                                            </span>
                                            <span style={{ color: ACCENT }}>step {s.step}</span>
                                            <span style={{ color: 'var(--text-tertiary)' }}> — </span>
                                            <span style={{ textTransform: 'lowercase' }}>{s.title}</span>
                                        </p>
                                        <p
                                            className="mt-1.5 pl-4 text-xs leading-relaxed"
                                            style={{
                                                color: 'var(--text-secondary)',
                                                fontFamily: 'var(--font-ui)',
                                            }}
                                        >
                                            {s.body}
                                        </p>
                                    </div>
                                    {i < STEPS.length - 1 && (
                                        <div
                                            className="hidden items-center px-1 sm:flex"
                                            aria-hidden="true"
                                            style={{
                                                color: 'var(--text-tertiary)',
                                                fontFamily: 'var(--font-term)',
                                                fontSize: '16px',
                                            }}
                                        >
                                            »
                                        </div>
                                    )}
                                </React.Fragment>
                            ))}
                        </div>
                    </div>
                </section>

                {/* ---- Footer ---- */}
                <footer
                    className="lp-reveal pb-10 text-center"
                    style={{ animationDelay: '0.8s' }}
                >
                    <p
                        className="text-[11px]"
                        style={{
                            color: 'var(--text-tertiary)',
                            fontFamily: 'var(--font-term)',
                            letterSpacing: '0.1em',
                        }}
                    >
                        // Free forever for the core app &mdash; bring your own free Google AI key.
                    </p>
                </footer>
            </div>
        </div>
    );
};

export default LandingPage;
