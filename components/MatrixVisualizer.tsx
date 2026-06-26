/**
 * MatrixVisualizer.tsx — Hex-grid audio-reactive background.
 * Renders a canvas with:
 *  - Hexagonal grid that pulses with audio volume
 *  - Radial wave that emanates from center when Echo speaks
 *  - Particle dots that drift upward
 *  - Color shifts between states
 */
import React, { useEffect, useRef } from 'react';

interface Props {
    outputVolume: number;
    inputVolume: number;
    isActive: boolean;
}

const MatrixVisualizer: React.FC<Props> = ({ outputVolume, inputVolume, isActive }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const frameRef  = useRef(0);
    const timeRef   = useRef(0);

    // Smooth volume
    const smoothVol = useRef(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Particles
        const PARTICLE_COUNT = 40;
        type Particle = { x: number; y: number; vy: number; size: number; alpha: number; color: string };
        const particles: Particle[] = [];

        const resize = () => {
            if (!canvas.parentElement) return;
            canvas.width  = canvas.parentElement.clientWidth;
            canvas.height = canvas.parentElement.clientHeight;
        };
        window.addEventListener('resize', resize);
        resize();

        // Seed particles
        const seedParticles = () => {
            particles.length = 0;
            for (let i = 0; i < PARTICLE_COUNT; i++) {
                particles.push({
                    x:     Math.random() * canvas.width,
                    y:     Math.random() * canvas.height,
                    vy:    0.2 + Math.random() * 0.5,
                    size:  1 + Math.random() * 2,
                    alpha: 0.1 + Math.random() * 0.3,
                    color: Math.random() > 0.5 ? '#00E5FF' : '#00FF41',
                });
            }
        };
        seedParticles();

        const render = () => {
            timeRef.current += 0.016;
            const t = timeRef.current;
            const W = canvas.width;
            const H = canvas.height;
            const rawVol = Math.max(outputVolume, inputVolume) / 100;

            // Smooth volume
            smoothVol.current += (rawVol - smoothVol.current) * 0.1;
            const vol = smoothVol.current;

            ctx.clearRect(0, 0, W, H);

            if (!isActive && vol < 0.02) {
                frameRef.current = requestAnimationFrame(render);
                return;
            }

            const cx = W / 2;
            const cy = H / 2;

            // ── Hex grid ───────────────────────────────────────────
            const HEX_SIZE  = 28;
            const HEX_W     = HEX_SIZE * 2;
            const HEX_H     = Math.sqrt(3) * HEX_SIZE;
            const COLS = Math.ceil(W / HEX_W) + 2;
            const ROWS = Math.ceil(H / HEX_H) + 2;

            for (let col = -1; col < COLS; col++) {
                for (let row = -1; row < ROWS; row++) {
                    const xOff = row % 2 === 0 ? 0 : HEX_W * 0.5;
                    const hx = col * HEX_W * 0.75 + xOff;
                    const hy = row * HEX_H * 0.5;

                    const dx = hx - cx;
                    const dy = hy - cy;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const maxDist = Math.sqrt(cx * cx + cy * cy);

                    // Wave pulse from center
                    const wave = Math.sin(dist * 0.04 - t * 2.5) * vol;
                    const fade = 1 - dist / maxDist;
                    const alpha = (0.05 + wave * 0.25 + fade * 0.1 * vol) * (isActive ? 1 : 0.3);

                    if (alpha <= 0.005) continue;

                    // Color mix: cyan base, green with volume
                    const g = Math.floor(180 + vol * 75);
                    const b = Math.floor(255 * (1 - vol * 0.3));
                    ctx.strokeStyle = `rgba(0,${g},${b},${alpha})`;
                    ctx.lineWidth = 0.5 + vol * 0.5;

                    // Draw hexagon
                    ctx.beginPath();
                    for (let side = 0; side < 6; side++) {
                        const angle = (Math.PI / 3) * side - Math.PI / 6;
                        const sx = hx + HEX_SIZE * Math.cos(angle) * 0.92;
                        const sy = hy + HEX_SIZE * Math.sin(angle) * 0.92;
                        if (side === 0) ctx.moveTo(sx, sy);
                        else ctx.lineTo(sx, sy);
                    }
                    ctx.closePath();
                    ctx.stroke();

                    // Glow dots at vertices with high volume
                    if (vol > 0.4 && fade > 0.5 && Math.random() > 0.97) {
                        const angle = (Math.PI / 3) * Math.floor(Math.random() * 6);
                        ctx.fillStyle = `rgba(0,255,65,${vol * fade * 0.7})`;
                        ctx.beginPath();
                        ctx.arc(
                            hx + HEX_SIZE * Math.cos(angle) * 0.92,
                            hy + HEX_SIZE * Math.sin(angle) * 0.92,
                            1.5, 0, Math.PI * 2
                        );
                        ctx.fill();
                    }
                }
            }

            // ── Radial rings from center ───────────────────────────
            if (vol > 0.1) {
                for (let ring = 0; ring < 3; ring++) {
                    const radius = (t * 60 + ring * 80) % (Math.max(W, H) * 0.8);
                    const alpha  = Math.max(0, 0.4 - radius / (Math.max(W, H) * 0.8)) * vol;
                    const rStart = Math.max(0, radius - 2);
                    const grad   = ctx.createRadialGradient(cx, cy, rStart, cx, cy, radius + 2);
                    grad.addColorStop(0, `rgba(0,229,255,0)`);
                    grad.addColorStop(0.5, `rgba(0,229,255,${alpha})`);
                    grad.addColorStop(1, `rgba(0,229,255,0)`);
                    ctx.strokeStyle = `rgba(0,229,255,${alpha})`;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                    ctx.stroke();
                }
            }

            // ── Floating particles ─────────────────────────────────
            for (const p of particles) {
                p.y -= p.vy * (1 + vol * 3);
                if (p.y < -10) { p.y = H + 10; p.x = Math.random() * W; }

                const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2);
                grd.addColorStop(0, p.color);
                grd.addColorStop(1, 'transparent');
                ctx.fillStyle = grd;
                ctx.globalAlpha = p.alpha * (isActive ? 1 + vol : 0.3);
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1;
            }

            frameRef.current = requestAnimationFrame(render);
        };

        frameRef.current = requestAnimationFrame(render);

        return () => {
            cancelAnimationFrame(frameRef.current);
            window.removeEventListener('resize', resize);
        };
    }, [outputVolume, inputVolume, isActive]);

    return (
        <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ zIndex: 0 }}
        />
    );
};

export default MatrixVisualizer;
