/**
 * EchoFrame.tsx — Iron-Man-style viewport border.
 *
 * Wraps the entire app with a holographic frame that displays vital signs
 * at each corner. The frame breathes with Echo's state.
 *
 *   ┌─ TIME / DATE / PHASE ─────────────────  STATUS / CONNECTION ─┐
 *   │                                                              │
 *   │                    [ main app content ]                      │
 *   │                                                              │
 *   └─ MOOD / STREAK ─────────────────────────  USER / VAULT ──────┘
 *
 * The frame:
 *  - Pulses with the connection status
 *  - Colors shift with circadian theme
 *  - Hides on mobile to save real-estate
 *  - All four corners have animated bracket art (::before/::after on quadrants)
 */
import React, { useEffect, useState } from 'react';
import { getCompanionState } from '../services/companionPersonaService';
import { getLatestMood } from '../services/lifeCoachService';
import { getActiveDeadlinePlans } from '../services/deadlineGuardianService';
import { getPhase, getPhaseConfig, CircadianPhase } from '../services/circadianThemeService';
import { ConnectionStatus } from '../types';
import { Wifi, WifiOff, Activity, ShieldCheck, Lock, Cpu } from 'lucide-react';

interface Props {
    status: ConnectionStatus;
    /** show even on mobile */
    mobile?: boolean;
}

function fmtTime(d: Date): string {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}
function fmtDate(d: Date): string {
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: '2-digit' }).toUpperCase();
}

const MOOD_GLYPH = ['—', '◔', '◑', '◕', '●', '✦'];
const MOOD_COLOR = ['rgba(255,255,255,0.3)', '#FF3040', '#FF8C00', '#FFB300', '#00E5FF', '#00FF41'];

export default function EchoFrame({ status, mobile = false }: Props) {
    const [now, setNow]           = useState(new Date());
    const [phase, setPhase]       = useState<CircadianPhase>(getPhase());
    const [companion]             = useState(getCompanionState());
    const [mood]                  = useState(getLatestMood());
    const [deadlines, setDeadlines] = useState(getActiveDeadlinePlans());

    useEffect(() => {
        const t = setInterval(() => {
            const d = new Date();
            setNow(d);
            const p = getPhase(d);
            setPhase(prev => (prev !== p ? p : prev));
        }, 1000);
        const d = setInterval(() => setDeadlines(getActiveDeadlinePlans()), 60_000);
        return () => { clearInterval(t); clearInterval(d); };
    }, []);

    const phaseCfg = getPhaseConfig(phase);

    const statusColor = status === ConnectionStatus.CONNECTED ? '#00FF41'
                      : status === ConnectionStatus.CONNECTING ? '#FFB300'
                      : status === ConnectionStatus.ERROR ? '#FF3040'
                      : 'rgba(255,255,255,0.4)';
    const statusLabel = status === ConnectionStatus.CONNECTED ? 'NEURAL LINK ACTIVE'
                      : status === ConnectionStatus.CONNECTING ? 'ESTABLISHING…'
                      : status === ConnectionStatus.ERROR ? 'LINK FAULT'
                      : 'STANDBY';

    const accent   = 'var(--circadian-accent, #00E5FF)';
    const closest  = deadlines.length > 0
        ? deadlines.reduce((a, b) => a.daysLeft < b.daysLeft ? a : b)
        : null;

    return (
        <div className={`echo-frame pointer-events-none ${mobile ? 'echo-frame-mobile' : ''}`} aria-hidden="true">
            {/* Outer ring glow */}
            <div className="echo-frame-glow" style={{ boxShadow: `inset 0 0 80px 4px ${statusColor}22, inset 0 0 200px 20px ${phaseCfg.glow}` }} />

            {/* Corner brackets (4) — each is an SVG */}
            {(['tl','tr','bl','br'] as const).map(corner => (
                <CornerBracket key={corner} corner={corner} color={accent} statusColor={statusColor} pulse={status === ConnectionStatus.CONNECTED} />
            ))}

            {/* Edge readout strips */}

            {/* TOP-LEFT: TIME + DATE + PHASE */}
            <div className="echo-readout echo-readout-tl">
                <div className="flex items-center gap-2">
                    <span style={{ fontSize: 10 }}>{phaseCfg.icon}</span>
                    <div>
                        <div className="font-hud text-[10px] tracking-[0.25em]" style={{ color: accent, textShadow: `0 0 8px ${accent}` }}>
                            {fmtTime(now)}
                        </div>
                        <div className="font-mono-hud text-[8px] tracking-widest text-white/40">
                            {fmtDate(now)} · {phaseCfg.label}
                        </div>
                    </div>
                </div>
            </div>

            {/* TOP-RIGHT: CONNECTION + ENCRYPTION */}
            <div className="echo-readout echo-readout-tr">
                <div className="flex items-center gap-3 justify-end">
                    <div className="text-right">
                        <div className="font-hud text-[10px] tracking-[0.25em]" style={{ color: statusColor, textShadow: `0 0 8px ${statusColor}` }}>
                            {statusLabel}
                        </div>
                        <div className="font-mono-hud text-[8px] tracking-widest text-white/40">
                            ENC: AES-GCM-256 · LOCAL
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <Lock size={9} style={{ color: 'rgba(0,255,65,0.5)' }} />
                        <Activity size={11} style={{ color: statusColor, filter: status === ConnectionStatus.CONNECTED ? `drop-shadow(0 0 4px ${statusColor})` : 'none' }} className={status === ConnectionStatus.CONNECTED ? 'animate-pulse' : ''} />
                    </div>
                </div>
            </div>

            {/* BOTTOM-LEFT: MOOD + STREAK */}
            <div className="echo-readout echo-readout-bl">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                        <span style={{ color: MOOD_COLOR[mood?.mood || 0] || 'rgba(255,255,255,0.3)', fontSize: 12, textShadow: `0 0 6px currentColor` }}>
                            {MOOD_GLYPH[mood?.mood || 0]}
                        </span>
                        <span className="font-mono-hud text-[8px] tracking-widest text-white/40">
                            MOOD
                        </span>
                    </div>
                    {companion.streakDays > 0 && (
                        <div className="flex items-center gap-1.5" style={{ borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: 12 }}>
                            <span style={{ fontSize: 10 }}>🔥</span>
                            <span className="font-hud text-[10px] tracking-widest" style={{ color: '#FF8C00', textShadow: '0 0 6px #FF8C00' }}>
                                {companion.streakDays}D
                            </span>
                        </div>
                    )}
                </div>
            </div>

            {/* BOTTOM-RIGHT: USER + DEADLINES */}
            <div className="echo-readout echo-readout-br">
                <div className="flex items-center gap-3 justify-end">
                    {closest && (
                        <div className="text-right" style={{ borderRight: '1px solid rgba(255,255,255,0.1)', paddingRight: 12 }}>
                            <div className="font-mono-hud text-[8px] tracking-widest text-white/40">
                                NEXT DEADLINE
                            </div>
                            <div className="font-hud text-[10px] tracking-widest" style={{
                                color: closest.daysLeft <= 1 ? '#FF3040' : closest.daysLeft <= 3 ? '#FFB300' : accent,
                                textShadow: `0 0 6px currentColor`,
                            }}>
                                T-{closest.daysLeft}D
                            </div>
                        </div>
                    )}
                    <div className="text-right">
                        <div className="font-hud text-[10px] tracking-[0.25em]" style={{ color: 'var(--c-pink)', textShadow: '0 0 6px var(--c-pink)' }}>
                            {(companion.userName || 'USER').toUpperCase()}
                        </div>
                        <div className="font-mono-hud text-[8px] tracking-widest text-white/40">
                            SESSION {String(companion.totalSessions).padStart(4, '0')} · {companion.mode.toUpperCase()}
                        </div>
                    </div>
                </div>
            </div>

            {/* Center top scan beam */}
            {status === ConnectionStatus.CONNECTED && (
                <div className="echo-frame-scan" style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />
            )}
        </div>
    );
}

// ── Corner bracket SVG ───────────────────────────────────────────────────────
function CornerBracket({ corner, color, statusColor, pulse }: { corner: 'tl'|'tr'|'bl'|'br'; color: string; statusColor: string; pulse: boolean }) {
    const SIZE = 50;
    const TH   = 1.5;

    // Define paths per corner
    const paths: Record<typeof corner, string> = {
        tl: `M 0 ${SIZE} L 0 14 Q 0 0 14 0 L ${SIZE} 0`,
        tr: `M 0 0 L ${SIZE - 14} 0 Q ${SIZE} 0 ${SIZE} 14 L ${SIZE} ${SIZE}`,
        bl: `M 0 0 L 0 ${SIZE - 14} Q 0 ${SIZE} 14 ${SIZE} L ${SIZE} ${SIZE}`,
        br: `M 0 ${SIZE} L ${SIZE - 14} ${SIZE} Q ${SIZE} ${SIZE} ${SIZE} ${SIZE - 14} L ${SIZE} 0`,
    };

    const positions: Record<typeof corner, React.CSSProperties> = {
        tl: { top: 8,    left: 8 },
        tr: { top: 8,    right: 8 },
        bl: { bottom: 8, left: 8 },
        br: { bottom: 8, right: 8 },
    };

    // Small accent tick
    const tickPos: Record<typeof corner, React.CSSProperties> = {
        tl: { top: 14, left: 14, width: 4, height: 4 },
        tr: { top: 14, right: 14, width: 4, height: 4 },
        bl: { bottom: 14, left: 14, width: 4, height: 4 },
        br: { bottom: 14, right: 14, width: 4, height: 4 },
    };

    return (
        <>
            <svg
                width={SIZE} height={SIZE}
                viewBox={`0 0 ${SIZE} ${SIZE}`}
                style={{ position: 'absolute', ...positions[corner], overflow: 'visible' }}
            >
                <path
                    d={paths[corner]}
                    stroke={color}
                    strokeWidth={TH}
                    fill="none"
                    strokeLinecap="round"
                    style={{ filter: `drop-shadow(0 0 4px ${color})`, opacity: 0.85 }}
                />
                {/* Inner short stroke */}
                <path
                    d={paths[corner]}
                    stroke={statusColor}
                    strokeWidth={0.5}
                    fill="none"
                    strokeDasharray="3 8"
                    style={{ filter: `drop-shadow(0 0 3px ${statusColor})`, opacity: pulse ? 0.7 : 0.3 }}
                />
            </svg>
            {/* Tick dot */}
            <div
                className={pulse ? 'animate-pulse' : ''}
                style={{
                    position: 'absolute',
                    ...tickPos[corner],
                    background: statusColor,
                    boxShadow: `0 0 6px ${statusColor}`,
                    borderRadius: '50%',
                }}
            />
        </>
    );
}
