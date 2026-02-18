import React, { useRef, useEffect } from 'react';

interface MatrixRainProps {
    /** 0-100, how loud the AI output is — drives intensity */
    outputVolume?: number;
    /** 0-100, how loud the user input is */
    inputVolume?: number;
    /** Whether the session is live */
    isActive?: boolean;
}

/**
 * INTENSE full-screen Matrix rain effect.
 * When AI speaks, the rain BULGES outward from center, speeds up,
 * and characters scatter in all directions like a thinking AI.
 */
const MatrixRain: React.FC<MatrixRainProps> = ({
    outputVolume = 0,
    inputVolume = 0,
    isActive = false,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const stateRef = useRef({
        columns: 0,
        drops: [] as number[],
        speeds: [] as number[],
        brightness: [] as number[],
        smoothOutput: 0,
        smoothInput: 0,
        bulgePhase: 0,
        time: 0,
    });

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン01ECHO!@#$%^&*()<>{}[]ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
        const fontSize = 13;
        const s = stateRef.current;

        const resize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            const newCols = Math.floor(canvas.width / fontSize) + 1;
            if (newCols !== s.columns) {
                s.columns = newCols;
                s.drops = Array(newCols).fill(0).map(() => Math.random() * -50);
                s.speeds = Array(newCols).fill(0).map(() => 0.3 + Math.random() * 0.7);
                s.brightness = Array(newCols).fill(0).map(() => 0.3 + Math.random() * 0.7);
            }
        };
        resize();
        window.addEventListener('resize', resize);

        let animId: number;

        const draw = () => {
            const w = canvas.width;
            const h = canvas.height;
            const cx = w / 2;
            const cy = h / 2;

            // Smooth volume interpolation
            s.smoothOutput += (outputVolume - s.smoothOutput) * 0.08;
            s.smoothInput += (inputVolume - s.smoothInput) * 0.08;
            s.time += 1;

            const aiSpeaking = s.smoothOutput > 5;
            const userSpeaking = s.smoothInput > 5;
            const intensity = Math.min(1, s.smoothOutput / 30); // 0-1

            // ── Background fade (faster = more visible trails) ──
            const fadeAlpha = aiSpeaking ? 0.03 + intensity * 0.02 : 0.05;
            ctx.fillStyle = `rgba(0, 0, 0, ${fadeAlpha})`;
            ctx.fillRect(0, 0, w, h);

            // ── Bulge phase (wave that radiates from center when AI speaks) ──
            if (aiSpeaking) {
                s.bulgePhase += 0.06 + intensity * 0.04;
            } else {
                s.bulgePhase += 0.01;
            }

            ctx.font = `${fontSize}px monospace`;

            for (let i = 0; i < s.columns; i++) {
                const char = chars[Math.floor(Math.random() * chars.length)];
                const baseX = i * fontSize;
                const baseY = s.drops[i] * fontSize;

                // ── BULGE EFFECT: push characters outward from center when AI speaks ──
                let x = baseX;
                let y = baseY;

                if (aiSpeaking && intensity > 0.1) {
                    const dx = baseX - cx;
                    const dy = baseY - cy;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const maxDist = Math.sqrt(cx * cx + cy * cy);
                    const normalizedDist = dist / maxDist;

                    // Radial bulge wave
                    const bulgeWave = Math.sin(s.bulgePhase - normalizedDist * 6) * intensity;
                    const bulgeForce = Math.max(0, bulgeWave) * 40 * intensity;

                    // Push outward from center
                    if (dist > 0) {
                        x += (dx / dist) * bulgeForce;
                        y += (dy / dist) * bulgeForce;
                    }

                    // Lateral wave (thinking movement in all directions)
                    x += Math.sin(s.time * 0.05 + i * 0.3) * intensity * 8;
                    y += Math.cos(s.time * 0.04 + i * 0.2) * intensity * 4;
                }

                if (userSpeaking) {
                    // Subtle inward pull when user speaks
                    const dx = baseX - cx;
                    const dy = baseY - cy;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist > 0) {
                        const pull = Math.min(1, s.smoothInput / 30) * 10;
                        x -= (dx / dist) * pull * Math.sin(s.time * 0.03 + i);
                        y -= (dy / dist) * pull * Math.cos(s.time * 0.03 + i);
                    }
                }

                // ── Character brightness ──
                const baseBright = s.brightness[i];
                let alpha: number;
                let color: string;

                if (aiSpeaking) {
                    // Intense green, pulsing with volume
                    const pulse = 0.6 + Math.sin(s.time * 0.1 + i * 0.5) * 0.3 * intensity;
                    alpha = Math.min(1, baseBright * pulse + intensity * 0.4);
                    // Occasional bright white flashes
                    if (Math.random() < intensity * 0.05) {
                        color = '#ffffff';
                        alpha = 1;
                    } else {
                        const g = Math.floor(200 + intensity * 55);
                        color = `rgb(0, ${g}, ${Math.floor(30 + intensity * 40)})`;
                    }
                } else if (userSpeaking) {
                    alpha = baseBright * 0.7;
                    color = '#00c8ff'; // Cyan when listening
                } else {
                    alpha = baseBright * 0.6;
                    color = '#00ff41';
                }

                ctx.fillStyle = color;
                ctx.globalAlpha = alpha;
                ctx.fillText(char, x, y);

                // ── Head character glow ──
                if (Math.random() > 0.7 && aiSpeaking) {
                    ctx.shadowColor = '#00ff41';
                    ctx.shadowBlur = 8 + intensity * 12;
                    ctx.fillText(char, x, y);
                    ctx.shadowBlur = 0;
                }

                ctx.globalAlpha = 1;

                // ── Speed: faster when AI speaks ──
                const baseSpeed = s.speeds[i];
                const speedMultiplier = aiSpeaking ? 1.5 + intensity * 2 : 1;
                s.drops[i] += baseSpeed * speedMultiplier;

                // Reset when off screen
                if (s.drops[i] * fontSize > h) {
                    if (Math.random() > (aiSpeaking ? 0.92 : 0.975)) {
                        s.drops[i] = Math.random() * -10;
                        s.speeds[i] = 0.3 + Math.random() * (aiSpeaking ? 1.5 : 0.7);
                        s.brightness[i] = 0.3 + Math.random() * 0.7;
                    }
                }
            }

            // ── Center glow burst when AI speaks intensely ──
            if (aiSpeaking && intensity > 0.3) {
                const glowRadius = 100 + intensity * 200 + Math.sin(s.bulgePhase) * 50;
                const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
                gradient.addColorStop(0, `rgba(0, 255, 65, ${0.08 * intensity})`);
                gradient.addColorStop(0.5, `rgba(0, 255, 65, ${0.03 * intensity})`);
                gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
                ctx.fillStyle = gradient;
                ctx.fillRect(cx - glowRadius, cy - glowRadius, glowRadius * 2, glowRadius * 2);
            }

            // ── Scattered particles when very intense ──
            if (aiSpeaking && intensity > 0.5) {
                const particleCount = Math.floor(intensity * 8);
                for (let p = 0; p < particleCount; p++) {
                    const angle = Math.random() * Math.PI * 2;
                    const dist = 50 + Math.random() * 200 * intensity;
                    const px = cx + Math.cos(angle + s.bulgePhase * 0.3) * dist;
                    const py = cy + Math.sin(angle + s.bulgePhase * 0.3) * dist;
                    ctx.fillStyle = '#00ff41';
                    ctx.globalAlpha = 0.3 + Math.random() * 0.4;
                    ctx.fillRect(px, py, 2, 2);
                }
                ctx.globalAlpha = 1;
            }

            animId = requestAnimationFrame(draw);
        };

        animId = requestAnimationFrame(draw);

        return () => {
            cancelAnimationFrame(animId);
            window.removeEventListener('resize', resize);
        };
    }, [outputVolume, inputVolume, isActive]);

    return (
        <canvas
            ref={canvasRef}
            className="fixed inset-0 z-0 pointer-events-none"
            style={{ opacity: isActive ? 0.7 : 0.5 }}
        />
    );
};

export default React.memo(MatrixRain);
