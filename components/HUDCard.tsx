/**
 * HUDCard.tsx — Reusable Jarvis-style holographic panel.
 * Renders a glass panel with corner brackets, optional scan beam,
 * header label, and status dot. All panels in the app use this.
 */
import React from 'react';

type Variant = 'cyan' | 'green' | 'pink' | 'amber' | 'purple';

interface HUDCardProps {
    children: React.ReactNode;
    variant?: Variant;
    label?: string;
    status?: 'cyan' | 'green' | 'red' | 'amber' | 'purple';
    statusText?: string;
    scanBeam?: boolean;
    className?: string;
    onClick?: () => void;
    noPadding?: boolean;
}

const variantClass: Record<Variant, string> = {
    cyan:   'hud-panel hud-tr hud-bl',
    green:  'hud-panel hud-panel-green hud-tr hud-bl',
    pink:   'hud-panel hud-panel-pink hud-tr hud-bl',
    amber:  'hud-panel hud-panel-amber hud-tr hud-bl',
    purple: 'hud-panel hud-tr hud-bl',
};

export default function HUDCard({
    children,
    variant = 'cyan',
    label,
    status,
    statusText,
    scanBeam = false,
    className = '',
    onClick,
    noPadding = false,
}: HUDCardProps) {
    return (
        <div
            className={`${variantClass[variant]} ${noPadding ? '' : 'p-4'} ${onClick ? 'cursor-pointer hover:brightness-110 transition-all' : ''} ${className}`}
            onClick={onClick}
        >
            {scanBeam && <div className="scan-beam" />}

            {(label || status) && (
                <div className="flex items-center justify-between mb-3">
                    {label && (
                        <span className="font-hud text-[10px] uppercase tracking-widest text-[var(--c-cyan)] opacity-70">
                            {label}
                        </span>
                    )}
                    {status && (
                        <div className="flex items-center gap-1.5">
                            <span className={`status-dot ${status}`} />
                            {statusText && (
                                <span className="font-mono-hud text-[10px] text-white/40 uppercase tracking-wider">
                                    {statusText}
                                </span>
                            )}
                        </div>
                    )}
                </div>
            )}

            {children}
        </div>
    );
}

/** Thin horizontal divider with glow */
export function HUDDivider({ variant = 'cyan' }: { variant?: Variant }) {
    const color = {
        cyan:   'rgba(0,229,255,0.2)',
        green:  'rgba(0,255,65,0.2)',
        pink:   'rgba(255,107,157,0.2)',
        amber:  'rgba(255,179,0,0.2)',
        purple: 'rgba(160,100,255,0.2)',
    }[variant];
    return (
        <div className="my-3 h-px w-full" style={{ background: `linear-gradient(90deg,transparent,${color},transparent)` }} />
    );
}

/** A single data row: label + value */
export function HUDRow({ label, value, valueClass = 'text-white' }: { label: string; value: React.ReactNode; valueClass?: string }) {
    return (
        <div className="flex items-center justify-between py-1">
            <span className="font-mono-hud text-[11px] text-white/40 uppercase tracking-wider">{label}</span>
            <span className={`font-mono-hud text-[11px] ${valueClass}`}>{value}</span>
        </div>
    );
}
