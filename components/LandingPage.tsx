import React from 'react';
import { Mic, Layers, Rocket, ShieldCheck, ArrowRight } from 'lucide-react';

// LandingPage — full-screen pre-onboarding landing page.
// First thing a stranger sees. Sells Echo in 5 seconds, funnels to onGetStarted().
// Self-contained: scoped `lp-` keyframes, CSS vars from src/index.css, no new deps.

interface LandingPageProps {
    onGetStarted: () => void;
}

const ACCENT = '#00ff88';

const FEATURES: { icon: React.ReactNode; title: string; body: string }[] = [
    {
        icon: <Mic size={22} strokeWidth={1.75} />,
        title: 'Voice-first companion',
        body: 'Talk naturally, in real time. Echo listens, answers out loud, and remembers you between conversations.',
    },
    {
        icon: <Layers size={22} strokeWidth={1.75} />,
        title: '40+ built-in skills',
        body: 'Email, social posts, research, content, lead finding, image generation and more — ready out of the box.',
    },
    {
        icon: <Rocket size={22} strokeWidth={1.75} />,
        title: 'Autonomous missions',
        body: 'Hand Echo a goal and a schedule. Missions run on their own and report back when the work is done.',
    },
    {
        icon: <ShieldCheck size={22} strokeWidth={1.75} />,
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
                    0%, 100% { box-shadow: 0 0 24px rgba(0, 255, 136, 0.28), 0 0 64px rgba(0, 255, 136, 0.10); }
                    50%      { box-shadow: 0 0 36px rgba(0, 255, 136, 0.45), 0 0 96px rgba(0, 255, 136, 0.18); }
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
                    transition: transform 0.18s ease, filter 0.18s ease;
                }
                .lp-cta:hover  { transform: translateY(-2px); filter: brightness(1.08); }
                .lp-cta:active { transform: translateY(0);    filter: brightness(0.95); }
                .lp-card {
                    transition: border-color 0.25s ease, transform 0.25s ease, background 0.25s ease;
                }
                .lp-card:hover {
                    border-color: var(--border-green) !important;
                    transform: translateY(-3px);
                    background: var(--bg-elevated) !important;
                }
                @media (prefers-reduced-motion: reduce) {
                    .lp-reveal { animation: none; opacity: 1; }
                    .lp-cta, .lp-orb-core, .lp-orb-ring { animation: none !important; }
                }
            `}</style>

            {/* ---- Ambient background: radial glow + faint grid ---- */}
            <div className="pointer-events-none fixed inset-0" aria-hidden="true">
                <div
                    className="absolute inset-0"
                    style={{
                        background:
                            'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(0, 255, 136, 0.09), transparent 60%),' +
                            'radial-gradient(ellipse 60% 40% at 85% 110%, rgba(0, 212, 255, 0.05), transparent 60%)',
                    }}
                />
                <div
                    className="absolute inset-0"
                    style={{
                        backgroundImage:
                            'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),' +
                            'linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)',
                        backgroundSize: '56px 56px',
                        maskImage: 'radial-gradient(ellipse 70% 60% at 50% 0%, black, transparent 75%)',
                        WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 0%, black, transparent 75%)',
                    }}
                />
            </div>

            <div className="relative mx-auto flex min-h-full w-full max-w-6xl flex-col px-5 sm:px-8">
                {/* ---- Top bar ---- */}
                <header
                    className="lp-reveal flex items-center justify-between py-6"
                    style={{ animationDelay: '0.05s' }}
                >
                    <div className="flex items-center gap-2.5">
                        <span
                            className="inline-block h-2.5 w-2.5 rounded-full"
                            style={{ background: ACCENT, boxShadow: `0 0 10px ${ACCENT}` }}
                        />
                        <span
                            className="text-sm font-semibold tracking-[0.3em]"
                            style={{ fontFamily: 'var(--font-mono)' }}
                        >
                            ECHO
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={onGetStarted}
                        className="rounded-full px-4 py-1.5 text-xs font-medium"
                        style={{
                            border: '1px solid var(--border-green)',
                            color: ACCENT,
                            background: 'rgba(0, 255, 136, 0.06)',
                            fontFamily: 'var(--font-mono)',
                        }}
                    >
                        Get Started
                    </button>
                </header>

                {/* ---- Hero ---- */}
                <main className="flex flex-1 flex-col items-center pb-8 pt-10 text-center sm:pt-16">
                    <div
                        className="lp-reveal mb-6 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[11px]"
                        style={{
                            animationDelay: '0.1s',
                            border: '1px solid var(--border-subtle)',
                            color: 'var(--text-secondary)',
                            background: 'var(--bg-raised)',
                            fontFamily: 'var(--font-mono)',
                            letterSpacing: '0.08em',
                        }}
                    >
                        <span
                            className="inline-block h-1.5 w-1.5 rounded-full"
                            style={{ background: ACCENT, boxShadow: `0 0 6px ${ACCENT}` }}
                        />
                        PRIVATE &middot; LOCAL-FIRST &middot; FREE
                    </div>

                    {/* Voice orb */}
                    <div
                        className="lp-reveal relative mb-8 h-24 w-24 sm:h-28 sm:w-28"
                        style={{ animationDelay: '0.15s' }}
                        aria-hidden="true"
                    >
                        <div
                            className="lp-orb-ring absolute inset-0 rounded-full"
                            style={{
                                border: '1px solid rgba(0, 255, 136, 0.25)',
                                borderTopColor: 'rgba(0, 255, 136, 0.75)',
                                animation: 'lp-ring-spin 6s linear infinite',
                            }}
                        />
                        <div
                            className="lp-orb-ring absolute inset-2 rounded-full"
                            style={{
                                border: '1px solid rgba(0, 212, 255, 0.18)',
                                borderBottomColor: 'rgba(0, 212, 255, 0.55)',
                                animation: 'lp-ring-spin 9s linear infinite reverse',
                            }}
                        />
                        <div
                            className="lp-orb-core absolute inset-5 rounded-full"
                            style={{
                                background: `radial-gradient(circle at 35% 30%, rgba(180, 255, 220, 0.95), ${ACCENT} 45%, rgba(0, 90, 50, 0.9))`,
                                boxShadow: `0 0 32px rgba(0, 255, 136, 0.5), 0 0 80px rgba(0, 255, 136, 0.18)`,
                                animation: 'lp-orb-breathe 3.6s ease-in-out infinite',
                            }}
                        />
                    </div>

                    <h1
                        className="lp-reveal text-5xl font-bold tracking-[0.18em] sm:text-7xl"
                        style={{
                            animationDelay: '0.2s',
                            background: `linear-gradient(180deg, #ffffff 20%, ${ACCENT} 120%)`,
                            WebkitBackgroundClip: 'text',
                            backgroundClip: 'text',
                            color: 'transparent',
                            textShadow: '0 0 60px rgba(0, 255, 136, 0.25)',
                        }}
                    >
                        ECHO
                    </h1>

                    <p
                        className="lp-reveal mt-5 max-w-xl text-2xl font-semibold leading-snug sm:text-3xl"
                        style={{ animationDelay: '0.28s', color: 'var(--text-primary)' }}
                    >
                        Your personal AI that actually gets things done.
                    </p>

                    <p
                        className="lp-reveal mt-4 max-w-lg text-sm leading-relaxed sm:text-base"
                        style={{ animationDelay: '0.36s', color: 'var(--text-secondary)' }}
                    >
                        Echo talks with you by voice, learns your goals, and runs missions
                        autonomously &mdash; with 40+ built-in skills ready out of the box.
                    </p>

                    <button
                        type="button"
                        onClick={onGetStarted}
                        className="lp-reveal lp-cta mt-9 inline-flex items-center gap-2 rounded-full px-8 py-3.5 text-base font-bold sm:px-10"
                        style={{
                            animationDelay: '0.44s',
                            background: ACCENT,
                            color: '#03140b',
                        }}
                    >
                        Get Started &mdash; Free
                        <ArrowRight size={18} strokeWidth={2.5} />
                    </button>

                    <p
                        className="lp-reveal mt-4 text-xs sm:text-[13px]"
                        style={{
                            animationDelay: '0.52s',
                            color: 'var(--text-tertiary)',
                            fontFamily: 'var(--font-mono)',
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
                        <div
                            key={f.title}
                            className="lp-card rounded-2xl p-5"
                            style={{
                                background: 'var(--bg-raised)',
                                border: '1px solid var(--border-subtle)',
                            }}
                        >
                            <div
                                className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl"
                                style={{
                                    color: ACCENT,
                                    background: 'rgba(0, 255, 136, 0.08)',
                                    border: '1px solid var(--border-green)',
                                }}
                            >
                                {f.icon}
                            </div>
                            <h3 className="mb-1.5 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                                {f.title}
                            </h3>
                            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                                {f.body}
                            </p>
                        </div>
                    ))}
                </section>

                {/* ---- How it works ---- */}
                <section className="lp-reveal pb-16" style={{ animationDelay: '0.7s' }} aria-label="How it works">
                    <p
                        className="mb-6 text-center text-[11px] tracking-[0.25em]"
                        style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
                    >
                        HOW IT WORKS
                    </p>
                    <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:gap-4">
                        {STEPS.map((s, i) => (
                            <React.Fragment key={s.step}>
                                <div
                                    className="flex flex-1 items-start gap-3.5 rounded-2xl p-4"
                                    style={{
                                        background: 'var(--bg-raised)',
                                        border: '1px solid var(--border-subtle)',
                                    }}
                                >
                                    <span
                                        className="mt-0.5 inline-flex h-7 w-7 flex-none items-center justify-center rounded-full text-xs font-bold"
                                        style={{
                                            color: ACCENT,
                                            border: '1px solid var(--border-green)',
                                            background: 'rgba(0, 255, 136, 0.07)',
                                            fontFamily: 'var(--font-mono)',
                                        }}
                                    >
                                        {s.step}
                                    </span>
                                    <div>
                                        <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                                            {s.title}
                                        </h4>
                                        <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                                            {s.body}
                                        </p>
                                    </div>
                                </div>
                                {i < STEPS.length - 1 && (
                                    <div className="hidden items-center sm:flex" aria-hidden="true">
                                        <ArrowRight size={16} style={{ color: 'var(--text-tertiary)' }} />
                                    </div>
                                )}
                            </React.Fragment>
                        ))}
                    </div>
                </section>

                {/* ---- Footer ---- */}
                <footer
                    className="lp-reveal pb-10 text-center"
                    style={{ animationDelay: '0.8s' }}
                >
                    <p
                        className="text-[11px]"
                        style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
                    >
                        Free forever for the core app &mdash; bring your own free Google AI key.
                    </p>
                </footer>
            </div>
        </div>
    );
};

export default LandingPage;
