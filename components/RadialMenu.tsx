/**
 * RadialMenu.tsx — Jarvis-style circular navigation.
 *
 * A semicircle of action buttons that fans out from the bottom-center
 * when triggered. Each item glows in its designated color.
 * Press-and-hold the center mic button to open (or long-press on mobile).
 */
import React, { useState, useCallback, useRef } from 'react';
import {
    Mic, MessageSquare, Brain, Heart, Folder,
    Ghost, Globe, Camera, Headphones, Settings, X
} from 'lucide-react';

export interface RadialItem {
    id: string;
    icon: React.ReactNode;
    label: string;
    color: string;       // CSS color for glow
    glyph: string;       // tailwind text color class
    onClick: () => void;
    active?: boolean;
}

interface Props {
    items: RadialItem[];
    centerLabel?: string;
    isOpen: boolean;
    onToggle: () => void;
    centerColor?: string;
}

export default function RadialMenu({ items, centerLabel = 'MENU', isOpen, onToggle, centerColor = '#00E5FF' }: Props) {
    // Fan items in a semicircle above the center button
    // We place up to 8 items spread from 200° to 340° (above center)
    const count = items.length;
    const startAngle = 200;
    const endAngle   = 340;
    const spread = count > 1 ? (endAngle - startAngle) / (count - 1) : 0;
    const RADIUS = 110; // px from center

    return (
        <div className="relative flex items-center justify-center">
            {/* Radial items */}
            {items.map((item, i) => {
                const angleDeg = count === 1 ? 270 : startAngle + i * spread;
                const rad  = (angleDeg * Math.PI) / 180;
                const x    = Math.cos(rad) * RADIUS;
                const y    = Math.sin(rad) * RADIUS;

                return (
                    <div
                        key={item.id}
                        className="radial-item absolute flex flex-col items-center gap-1"
                        style={{
                            transform: isOpen
                                ? `translate(${x}px, ${y}px) scale(1)`
                                : 'translate(0,0) scale(0)',
                            opacity: isOpen ? 1 : 0,
                            transitionDelay: isOpen ? `${i * 35}ms` : '0ms',
                            pointerEvents: isOpen ? 'auto' : 'none',
                            zIndex: 50,
                        }}
                    >
                        <button
                            onClick={() => { item.onClick(); onToggle(); }}
                            className="relative w-11 h-11 rounded-full flex items-center justify-center transition-all"
                            style={{
                                background: `rgba(0,15,35,0.9)`,
                                border: `1px solid ${item.color}55`,
                                boxShadow: item.active
                                    ? `0 0 12px ${item.color}, 0 0 30px ${item.color}44`
                                    : `0 0 6px ${item.color}44`,
                            }}
                        >
                            <span className={`${item.glyph} ${item.active ? '' : 'opacity-70'}`}>
                                {item.icon}
                            </span>
                            {item.active && (
                                <span
                                    className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full"
                                    style={{ background: item.color, boxShadow: `0 0 4px ${item.color}` }}
                                />
                            )}
                        </button>
                        <span
                            className="font-hud text-[8px] tracking-widest uppercase whitespace-nowrap"
                            style={{ color: item.color, textShadow: `0 0 6px ${item.color}` }}
                        >
                            {item.label}
                        </span>
                    </div>
                );
            })}

            {/* Backdrop blur ring when open */}
            {isOpen && (
                <div
                    className="absolute rounded-full pointer-events-none"
                    style={{
                        width: (RADIUS + 60) * 2,
                        height: (RADIUS + 60) * 2,
                        left: '50%', top: '50%',
                        transform: 'translate(-50%,-50%)',
                        background: 'radial-gradient(circle, rgba(0,15,35,0.7) 0%, transparent 70%)',
                        zIndex: 40,
                    }}
                />
            )}

            {/* Center toggle button */}
            <button
                onClick={onToggle}
                className="relative z-50 flex items-center justify-center rounded-full transition-all duration-300"
                style={{
                    width: 52, height: 52,
                    background: isOpen ? 'rgba(255,48,64,0.15)' : 'rgba(0,15,35,0.9)',
                    border: `1px solid ${isOpen ? 'rgba(255,48,64,0.5)' : `${centerColor}55`}`,
                    boxShadow: isOpen
                        ? '0 0 15px rgba(255,48,64,0.4)'
                        : `0 0 12px ${centerColor}44`,
                }}
            >
                <div
                    className="transition-transform duration-300"
                    style={{ transform: isOpen ? 'rotate(45deg)' : 'rotate(0deg)' }}
                >
                    {isOpen
                        ? <X size={18} color="#FF3040" />
                        : <span className="font-hud text-[9px] tracking-wider" style={{ color: centerColor }}>{centerLabel}</span>
                    }
                </div>
            </button>
        </div>
    );
}
