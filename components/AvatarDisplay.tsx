/**
 * AvatarDisplay.tsx — VIKI × Jarvis AI core orb.
 *
 * A fully animated holographic orb with:
 *  - 4 rotating elliptical rings (like VIKI's core sphere)
 *  - Audio-reactive glow that pulses with volume
 *  - State-driven color shifts: cyan (idle) → green (listening) → blue (thinking) → bright green (speaking)
 *  - Particle dots orbiting on the rings
 *  - Inner core sphere with state texture
 *  - PiP camera feed when camera is active
 */
import React, { useEffect, useRef, useMemo } from 'react';

interface AvatarDisplayProps {
    state: 'idle' | 'listening' | 'speaking' | 'thinking';
    volume: number; // 0–1
    cameraStream?: MediaStream | null;
    avatarUrl?: string;
}

const STATE_CONFIG = {
    idle: {
        coreColor:  'radial-gradient(circle at 40% 35%, rgba(0,229,255,0.25) 0%, rgba(0,80,160,0.15) 50%, rgba(0,20,60,0.4) 100%)',
        glow:       'rgba(0,229,255,0.35)',
        glowFar:    'rgba(0,100,200,0.12)',
        ringColor:  'rgba(0,229,255,',
        label:      'STANDBY',
        labelColor: '#00E5FF',
        dotColor:   '#00E5FF',
        speed:      1,
    },
    listening: {
        coreColor:  'radial-gradient(circle at 40% 35%, rgba(0,255,65,0.3) 0%, rgba(0,120,50,0.2) 50%, rgba(0,30,15,0.4) 100%)',
        glow:       'rgba(0,255,65,0.45)',
        glowFar:    'rgba(0,150,50,0.15)',
        ringColor:  'rgba(0,255,65,',
        label:      'LISTENING',
        labelColor: '#00FF41',
        dotColor:   '#00FF41',
        speed:      1.6,
    },
    thinking: {
        coreColor:  'radial-gradient(circle at 40% 35%, rgba(160,100,255,0.3) 0%, rgba(80,40,160,0.2) 50%, rgba(20,10,50,0.4) 100%)',
        glow:       'rgba(160,100,255,0.4)',
        glowFar:    'rgba(80,40,200,0.12)',
        ringColor:  'rgba(160,100,255,',
        label:      'PROCESSING',
        labelColor: '#A064FF',
        dotColor:   '#A064FF',
        speed:      2.2,
    },
    speaking: {
        coreColor:  'radial-gradient(circle at 40% 35%, rgba(0,255,65,0.5) 0%, rgba(0,180,80,0.3) 50%, rgba(0,60,20,0.4) 100%)',
        glow:       'rgba(0,255,65,0.65)',
        glowFar:    'rgba(0,200,80,0.2)',
        ringColor:  'rgba(0,255,65,',
        label:      'SPEAKING',
        labelColor: '#00FF41',
        dotColor:   '#00FF41',
        speed:      3,
    },
};

export default function AvatarDisplay({ state, volume, cameraStream, avatarUrl }: AvatarDisplayProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const cfg = STATE_CONFIG[state];
    const v = Math.max(0, Math.min(1, volume));

    useEffect(() => {
        if (videoRef.current && cameraStream) videoRef.current.srcObject = cameraStream;
    }, [cameraStream]);

    // Volume-driven scale for the outer glow
    const glowScale = 1 + v * 0.4;
    const glowOpacity = 0.4 + v * 0.5;

    // Ring configs: [rx%, ry%, rotation-deg, opacity, dash]
    const rings = useMemo(() => [
        { rx: 48, ry: 14, rot: 15,  op: 0.7, dur: 12, rev: false, dotAt: 0 },
        { rx: 46, ry: 18, rot: -20, op: 0.5, dur: 8,  rev: true,  dotAt: 0.25 },
        { rx: 44, ry: 22, rot: 55,  op: 0.4, dur: 16, rev: false,  dotAt: 0.6 },
        { rx: 50, ry: 10, rot: -40, op: 0.3, dur: 20, rev: true,  dotAt: 0.8 },
    ], []);

    const SIZE = 280; // orb container px
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const coreR = 80;

    return (
        <div className="relative flex flex-col items-center justify-center select-none">
            {/* Outer ambient glow layers */}
            <div
                className="absolute rounded-full pointer-events-none transition-all duration-300"
                style={{
                    width: SIZE + 120,
                    height: SIZE + 120,
                    left: '50%', top: '50%',
                    transform: `translate(-50%,-50%) scale(${glowScale})`,
                    background: `radial-gradient(circle, ${cfg.glow.replace(')', `,${glowOpacity * 0.25})`)} 0%, transparent 70%)`,
                }}
            />
            <div
                className="absolute rounded-full pointer-events-none transition-all duration-700"
                style={{
                    width: SIZE + 240,
                    height: SIZE + 240,
                    left: '50%', top: '50%',
                    transform: 'translate(-50%,-50%)',
                    background: `radial-gradient(circle, ${cfg.glowFar} 0%, transparent 65%)`,
                    opacity: 0.6 + v * 0.3,
                }}
            />

            {/* Main orb container */}
            <div
                className={`relative ${state} transition-all duration-300`}
                style={{ width: SIZE, height: SIZE }}
            >
                {/* SVG rings */}
                <svg
                    width={SIZE} height={SIZE}
                    viewBox={`0 0 ${SIZE} ${SIZE}`}
                    className="absolute inset-0"
                    style={{ overflow: 'visible' }}
                >
                    <defs>
                        {rings.map((r, i) => (
                            <filter key={i} id={`glow${i}`}>
                                <feGaussianBlur stdDeviation="2" result="blur" />
                                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                            </filter>
                        ))}
                    </defs>

                    {rings.map((r, i) => {
                        const rx = (r.rx / 100) * SIZE * 0.5;
                        const ry = (r.ry / 100) * SIZE * 0.5;
                        const animClass = r.rev
                            ? ['ring-2', 'ring-4'][i % 2]
                            : ['ring-1', 'ring-3'][i % 2];
                        const color = cfg.ringColor;
                        const opacity = r.op * (0.6 + v * 0.4);
                        const strokeW = 1 + v * 1;
                        return (
                            <g key={i} style={{ transformOrigin: `${cx}px ${cy}px`, transform: `rotate(${r.rot}deg)` }}>
                                <ellipse
                                    className={animClass}
                                    cx={cx} cy={cy} rx={rx} ry={ry}
                                    fill="none"
                                    stroke={`${color}${opacity})`}
                                    strokeWidth={strokeW}
                                    strokeDasharray={i % 2 === 0 ? 'none' : `${rx * 0.3} ${rx * 0.1}`}
                                    filter={`url(#glow${i})`}
                                />
                                {/* Orbiting dot */}
                                <circle
                                    className={animClass}
                                    r={3 + v * 2}
                                    fill={cfg.dotColor}
                                    opacity={0.9}
                                    style={{ filter: `drop-shadow(0 0 4px ${cfg.dotColor})` }}
                                >
                                    <animateMotion
                                        dur={`${r.dur / cfg.speed}s`}
                                        repeatCount="indefinite"
                                        keyPoints={`${r.dotAt};1;${r.dotAt}`}
                                        keyTimes="0;0.5;1"
                                        calcMode="linear"
                                    >
                                        <mpath xlinkHref={`#ring-path-${i}`} />
                                    </animateMotion>
                                </circle>
                                {/* Path for animateMotion */}
                                <ellipse
                                    id={`ring-path-${i}`}
                                    cx={cx} cy={cy} rx={rx} ry={ry}
                                    fill="none" stroke="none"
                                />
                            </g>
                        );
                    })}
                </svg>

                {/* Core sphere */}
                <div
                    className="absolute rounded-full transition-all duration-300"
                    style={{
                        width: coreR * 2,
                        height: coreR * 2,
                        left: '50%', top: '50%',
                        transform: `translate(-50%,-50%) scale(${1 + v * 0.08})`,
                        background: cfg.coreColor,
                        boxShadow: `0 0 ${20 + v * 40}px ${cfg.glow}, 0 0 ${60 + v * 80}px ${cfg.glowFar}, inset 0 0 30px rgba(0,0,0,0.5)`,
                        border: `1px solid ${cfg.glow.replace(')', ', 0.5)')}`,
                    }}
                >
                    {/* Inner hexagonal grid texture */}
                    <div className="absolute inset-0 rounded-full hex-bg opacity-20" />

                    {/* State indicator in core */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                        {state === 'thinking' && (
                            <div className="flex gap-1">
                                {[0, 1, 2].map(i => (
                                    <div
                                        key={i}
                                        className="w-1.5 h-1.5 rounded-full"
                                        style={{
                                            background: cfg.dotColor,
                                            boxShadow: `0 0 6px ${cfg.dotColor}`,
                                            animation: `pulse 0.8s ease-in-out ${i * 0.15}s infinite`,
                                        }}
                                    />
                                ))}
                            </div>
                        )}
                        {state === 'speaking' && (
                            <div className="flex items-end gap-0.5 h-6">
                                {[3, 5, 8, 6, 4, 7, 3, 5].map((h, i) => (
                                    <div
                                        key={i}
                                        className="w-1 rounded-full"
                                        style={{
                                            height: `${(h + v * 8) * 2.5}px`,
                                            background: `linear-gradient(to top, ${cfg.dotColor}, rgba(0,255,65,0.3))`,
                                            boxShadow: `0 0 4px ${cfg.dotColor}`,
                                            animation: `pulse ${0.4 + i * 0.06}s ease-in-out alternate infinite`,
                                        }}
                                    />
                                ))}
                            </div>
                        )}
                        {state === 'listening' && (
                            <div
                                className="w-4 h-4 rounded-full"
                                style={{
                                    background: cfg.dotColor,
                                    boxShadow: `0 0 12px ${cfg.dotColor}, 0 0 30px ${cfg.dotColor}`,
                                    animation: 'pulse 1.2s ease-in-out infinite',
                                    transform: `scale(${0.8 + v * 0.8})`,
                                }}
                            />
                        )}
                        {state === 'idle' && (
                            <div
                                className="w-2 h-2 rounded-full"
                                style={{
                                    background: cfg.dotColor,
                                    boxShadow: `0 0 8px ${cfg.dotColor}`,
                                    animation: 'pulse 3s ease-in-out infinite',
                                }}
                            />
                        )}
                    </div>
                </div>

                {/* Specular highlight on core */}
                <div
                    className="absolute rounded-full pointer-events-none"
                    style={{
                        width: 40, height: 20,
                        left: '50%', top: '32%',
                        transform: 'translate(-60%,-50%) rotate(-20deg)',
                        background: 'radial-gradient(ellipse, rgba(255,255,255,0.15) 0%, transparent 100%)',
                    }}
                />
            </div>

            {/* State label */}
            <div className="mt-6 flex flex-col items-center gap-2">
                <div className="flex items-center gap-2">
                    <span className={`status-dot ${state === 'idle' ? 'cyan' : state === 'listening' ? 'green' : state === 'thinking' ? 'purple' : 'green'}`} />
                    <span
                        className="font-hud text-xs tracking-widest uppercase"
                        style={{ color: cfg.labelColor, textShadow: `0 0 10px ${cfg.glow}` }}
                    >
                        {cfg.label}
                    </span>
                </div>
                {state === 'speaking' && (
                    <div className="flex items-center gap-1">
                        {Array.from({ length: 12 }).map((_, i) => (
                            <div
                                key={i}
                                className="rounded-full transition-all duration-75"
                                style={{
                                    width: 2,
                                    height: `${4 + Math.abs(Math.sin((i / 12) * Math.PI)) * (8 + v * 16)}px`,
                                    background: cfg.dotColor,
                                    opacity: 0.5 + v * 0.5,
                                    boxShadow: `0 0 4px ${cfg.dotColor}`,
                                }}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* PiP Camera */}
            {cameraStream && (
                <div className="absolute top-0 right-[-90px] w-24 h-32 rounded-xl overflow-hidden hud-panel z-20">
                    <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
                    <div className="absolute bottom-1 left-0 right-0 text-center">
                        <span className="font-mono-hud text-[8px] text-[var(--c-green)] tracking-wider">◉ LIVE</span>
                    </div>
                </div>
            )}
        </div>
    );
}
