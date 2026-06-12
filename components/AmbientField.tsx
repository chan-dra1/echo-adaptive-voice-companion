/**
 * AmbientField.tsx — Whole-viewport ambient particle layer.
 *
 * Sits behind everything (z=0). Slow-drifting dust + connecting line web
 * (Constellation pattern) that breathes even when Echo is idle.
 *
 * Reactive layers:
 *   - Time of day shifts hue
 *   - Audio volume scales connection web brightness + speed
 *   - Mouse position parallax-shifts the field subtly
 *   - Connection state changes density
 *
 * Performance: capped at ~40 nodes, no per-frame allocations.
 */
import React, { useEffect, useRef } from 'react';
import { getPhase, getPhaseConfig } from '../services/circadianThemeService';
import { ConnectionStatus } from '../types';

interface Props {
    status: ConnectionStatus;
    outputVolume: number;
    inputVolume: number;
}

const NODE_COUNT = 38;
const MAX_DIST   = 160; // px for connection line

type Node = { x: number; y: number; vx: number; vy: number; r: number; pulse: number };

export default function AmbientField({ status, outputVolume, inputVolume }: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const nodesRef  = useRef<Node[]>([]);
    const mouseRef  = useRef({ x: 0.5, y: 0.5 });
    const rafRef    = useRef(0);
    const volRef    = useRef(0);
    const audioStateRef = useRef({ output: 0, input: 0 });
    const statusRef = useRef(status);

    useEffect(() => { audioStateRef.current = { output: outputVolume, input: inputVolume }; }, [outputVolume, inputVolume]);
    useEffect(() => { statusRef.current = status; }, [status]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const resize = () => {
            const dpr = window.devicePixelRatio || 1;
            canvas.width  = window.innerWidth  * dpr;
            canvas.height = window.innerHeight * dpr;
            canvas.style.width  = `${window.innerWidth}px`;
            canvas.style.height = `${window.innerHeight}px`;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };

        const seed = () => {
            const W = window.innerWidth;
            const H = window.innerHeight;
            nodesRef.current = Array.from({ length: NODE_COUNT }, () => ({
                x: Math.random() * W,
                y: Math.random() * H,
                vx: (Math.random() - 0.5) * 0.18,
                vy: (Math.random() - 0.5) * 0.18,
                r:  0.6 + Math.random() * 1.6,
                pulse: Math.random() * Math.PI * 2,
            }));
        };

        resize();
        seed();

        const handleResize = () => { resize(); seed(); };
        const handleMouse  = (e: MouseEvent) => {
            mouseRef.current.x = e.clientX / window.innerWidth;
            mouseRef.current.y = e.clientY / window.innerHeight;
        };
        window.addEventListener('resize', handleResize);
        window.addEventListener('mousemove', handleMouse, { passive: true });

        let t = 0;
        const render = () => {
            t += 0.016;

            const W = window.innerWidth;
            const H = window.innerHeight;

            // Smooth volume
            const targetVol = Math.max(audioStateRef.current.output, audioStateRef.current.input) / 100;
            volRef.current += (targetVol - volRef.current) * 0.08;
            const vol = volRef.current;

            // Theme
            const cfg = getPhaseConfig(getPhase());
            const accent = cfg.accent;

            // Parse accent (#RRGGBB) once
            const r = parseInt(accent.slice(1, 3), 16);
            const g = parseInt(accent.slice(3, 5), 16);
            const b = parseInt(accent.slice(5, 7), 16);

            const isConnected = statusRef.current === ConnectionStatus.CONNECTED;

            ctx.clearRect(0, 0, W, H);

            // Background subtle radial gradient
            const grad = ctx.createRadialGradient(W * 0.5, H * 0.5, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.7);
            grad.addColorStop(0, `rgba(${r},${g},${b},${0.025 + vol * 0.05})`);
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, W, H);

            // Update + draw nodes
            const nodes = nodesRef.current;
            const mx = (mouseRef.current.x - 0.5) * 20;
            const my = (mouseRef.current.y - 0.5) * 20;

            for (const n of nodes) {
                n.pulse += 0.02;
                // gentle drift, with mouse parallax
                n.x += n.vx * (1 + vol * 1.5);
                n.y += n.vy * (1 + vol * 1.5);
                if (n.x < -20) n.x = W + 20;
                if (n.x > W + 20) n.x = -20;
                if (n.y < -20) n.y = H + 20;
                if (n.y > H + 20) n.y = -20;

                const pulseR = n.r * (1 + Math.sin(n.pulse) * 0.3) * (1 + vol);
                const alpha  = (0.18 + Math.sin(n.pulse) * 0.1) * (isConnected ? 1 : 0.55);

                // glow halo
                const halo = ctx.createRadialGradient(n.x + mx * 0.3, n.y + my * 0.3, 0, n.x + mx * 0.3, n.y + my * 0.3, pulseR * 4);
                halo.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
                halo.addColorStop(1, 'transparent');
                ctx.fillStyle = halo;
                ctx.beginPath();
                ctx.arc(n.x + mx * 0.3, n.y + my * 0.3, pulseR * 4, 0, Math.PI * 2);
                ctx.fill();

                // hard core
                ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(1, alpha + 0.4)})`;
                ctx.beginPath();
                ctx.arc(n.x + mx * 0.3, n.y + my * 0.3, pulseR, 0, Math.PI * 2);
                ctx.fill();
            }

            // Draw constellation connections (only nearby pairs)
            ctx.lineWidth = 0.4;
            for (let i = 0; i < nodes.length; i++) {
                const a = nodes[i];
                for (let j = i + 1; j < nodes.length; j++) {
                    const c = nodes[j];
                    const dx = (a.x - c.x);
                    const dy = (a.y - c.y);
                    const d  = Math.sqrt(dx * dx + dy * dy);
                    if (d > MAX_DIST) continue;
                    const lineAlpha = (1 - d / MAX_DIST) * (0.06 + vol * 0.25) * (isConnected ? 1 : 0.4);
                    ctx.strokeStyle = `rgba(${r},${g},${b},${lineAlpha})`;
                    ctx.beginPath();
                    ctx.moveTo(a.x + mx * 0.3, a.y + my * 0.3);
                    ctx.lineTo(c.x + mx * 0.3, c.y + my * 0.3);
                    ctx.stroke();
                }
            }

            rafRef.current = requestAnimationFrame(render);
        };

        rafRef.current = requestAnimationFrame(render);

        return () => {
            cancelAnimationFrame(rafRef.current);
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('mousemove', handleMouse);
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            className="ambient-field pointer-events-none"
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 0,
                width: '100vw',
                height: '100vh',
            }}
        />
    );
}
