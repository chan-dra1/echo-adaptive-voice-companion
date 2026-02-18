import React, { useRef, useEffect } from 'react';

interface AIAvatarProps {
    inputVolume: number;
    outputVolume: number;
    isActive: boolean;
}

/**
 * VIKI-style AI Avatar — a glowing, animated AI face that reacts to audio.
 * Features: pulsating core, geometric face outline, scanning eyes, speaking jaw animation.
 */
const AIAvatar: React.FC<AIAvatarProps> = ({ inputVolume, outputVolume, isActive }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const timeRef = useRef(0);
    const smoothOutputRef = useRef(0);
    const smoothInputRef = useRef(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let animationId: number;

        const render = () => {
            const dpr = window.devicePixelRatio || 1;
            const rect = canvas.getBoundingClientRect();
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            ctx.scale(dpr, dpr);

            const cx = rect.width / 2;
            const cy = rect.height / 2;
            const t = timeRef.current;

            ctx.clearRect(0, 0, rect.width, rect.height);

            // Smooth volume interpolation
            smoothOutputRef.current += (outputVolume - smoothOutputRef.current) * 0.12;
            smoothInputRef.current += (inputVolume - smoothInputRef.current) * 0.12;

            const outVol = smoothOutputRef.current;
            const inVol = smoothInputRef.current;
            const isSpeaking = outVol > 5;
            const isListening = inVol > 5;

            // ═══════════════════════════
            // IDLE STATE (Dormant VIKI)
            // ═══════════════════════════
            if (!isActive) {
                const breathe = Math.sin(t * 0.02) * 8;

                // Faint hexagonal outline
                drawHexagon(ctx, cx, cy, 70 + breathe, 'rgba(0, 255, 65, 0.15)', 1);
                drawHexagon(ctx, cx, cy, 55 + breathe * 0.5, 'rgba(0, 255, 65, 0.08)', 0.5);

                // Dormant eye (single horizontal line)
                ctx.beginPath();
                ctx.moveTo(cx - 20, cy);
                ctx.lineTo(cx + 20, cy);
                ctx.strokeStyle = 'rgba(0, 255, 65, 0.3)';
                ctx.lineWidth = 2;
                ctx.stroke();

                // "STANDBY" text
                ctx.font = '10px monospace';
                ctx.fillStyle = 'rgba(0, 255, 65, 0.2)';
                ctx.textAlign = 'center';
                ctx.fillText('STANDBY', cx, cy + 90 + breathe);

                timeRef.current += 1;
                animationId = requestAnimationFrame(render);
                return;
            }

            // ═══════════════════════════
            // ACTIVE STATE (VIKI Online)
            // ═══════════════════════════
            const pulseIntensity = isSpeaking ? outVol * 0.3 : isListening ? inVol * 0.2 : 0;
            const baseSize = 80 + pulseIntensity * 0.5;

            // ── Outer Scanning Rings ──
            for (let i = 0; i < 3; i++) {
                const ringSize = baseSize + 30 + i * 20 + Math.sin(t * 0.03 + i) * 5;
                const alpha = 0.15 - i * 0.04;
                ctx.save();
                ctx.translate(cx, cy);
                ctx.rotate(t * 0.005 * (i % 2 === 0 ? 1 : -1));
                drawHexagon(ctx, 0, 0, ringSize, `rgba(0, 255, 65, ${alpha})`, 1);
                ctx.restore();
            }

            // ── Core Glow ──
            const glowSize = baseSize * 1.2 + Math.sin(t * 0.04) * 10;
            const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowSize);
            gradient.addColorStop(0, isSpeaking ? 'rgba(0, 255, 65, 0.15)' : isListening ? 'rgba(0, 200, 255, 0.12)' : 'rgba(0, 255, 65, 0.06)');
            gradient.addColorStop(0.5, 'rgba(0, 255, 65, 0.03)');
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(cx, cy, glowSize, 0, Math.PI * 2);
            ctx.fill();

            // ── Face Frame (Hexagonal) ──
            const mainColor = isSpeaking ? '#00ff41' : isListening ? '#00c8ff' : '#00ff41';
            const mainAlpha = isSpeaking ? 0.8 : isListening ? 0.6 : 0.4;
            drawHexagon(ctx, cx, cy, baseSize, mainColor, 2, mainAlpha);
            drawHexagon(ctx, cx, cy, baseSize - 8, mainColor, 0.5, mainAlpha * 0.3);

            // ── EYES ──
            const eyeY = cy - baseSize * 0.15;
            const eyeSpacing = baseSize * 0.35;
            const eyeWidth = baseSize * 0.2;
            const eyeHeight = baseSize * 0.08;

            // Blinking logic
            const blinkCycle = Math.sin(t * 0.015);
            const blinkScale = blinkCycle > 0.95 ? Math.max(0.1, 1 - (blinkCycle - 0.95) * 20) : 1;

            // Left Eye
            drawEye(ctx, cx - eyeSpacing, eyeY, eyeWidth, eyeHeight * blinkScale, mainColor, mainAlpha, t, isSpeaking);
            // Right Eye
            drawEye(ctx, cx + eyeSpacing, eyeY, eyeWidth, eyeHeight * blinkScale, mainColor, mainAlpha, t, isSpeaking);

            // ── SCANNING LINE (moves vertically across face) ──
            if (isListening) {
                const scanY = cy - baseSize * 0.5 + ((t * 2) % (baseSize));
                ctx.beginPath();
                ctx.moveTo(cx - baseSize * 0.6, scanY);
                ctx.lineTo(cx + baseSize * 0.6, scanY);
                ctx.strokeStyle = 'rgba(0, 200, 255, 0.3)';
                ctx.lineWidth = 1;
                ctx.stroke();
            }

            // ── MOUTH / JAW ──
            const mouthY = cy + baseSize * 0.25;
            const mouthWidth = baseSize * 0.3;

            if (isSpeaking) {
                // Animated speaking jaw — opens based on volume
                const jawOpen = Math.min(baseSize * 0.15, outVol * 0.3);
                const waveSegments = 12;

                ctx.beginPath();
                for (let i = 0; i <= waveSegments; i++) {
                    const x = cx - mouthWidth + (i / waveSegments) * mouthWidth * 2;
                    const wave = Math.sin(t * 0.15 + i * 0.8) * jawOpen * 0.3;
                    const y = mouthY + wave;
                    if (i === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.strokeStyle = mainColor;
                ctx.lineWidth = 2;
                ctx.globalAlpha = mainAlpha;
                ctx.stroke();

                // Lower jaw
                ctx.beginPath();
                for (let i = 0; i <= waveSegments; i++) {
                    const x = cx - mouthWidth + (i / waveSegments) * mouthWidth * 2;
                    const wave = Math.sin(t * 0.15 + i * 0.8 + Math.PI) * jawOpen * 0.3;
                    const y = mouthY + jawOpen + wave;
                    if (i === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.strokeStyle = mainColor;
                ctx.lineWidth = 1.5;
                ctx.globalAlpha = mainAlpha * 0.7;
                ctx.stroke();
                ctx.globalAlpha = 1;
            } else {
                // Static mouth line
                ctx.beginPath();
                ctx.moveTo(cx - mouthWidth * 0.7, mouthY);
                ctx.lineTo(cx + mouthWidth * 0.7, mouthY);
                ctx.strokeStyle = mainColor;
                ctx.lineWidth = 1.5;
                ctx.globalAlpha = mainAlpha * 0.5;
                ctx.stroke();
                ctx.globalAlpha = 1;
            }

            // ── Data streams (side decorations) ──
            if (isSpeaking || isListening) {
                const streamColor = isSpeaking ? mainColor : '#00c8ff';
                for (let side = -1; side <= 1; side += 2) {
                    for (let i = 0; i < 5; i++) {
                        const sx = cx + side * (baseSize + 25 + i * 8);
                        const sy = cy - baseSize * 0.3 + ((t * 1.5 + i * 30) % (baseSize * 1.2));
                        const char = '01'[Math.floor(Math.random() * 2)];
                        ctx.font = '10px monospace';
                        ctx.fillStyle = streamColor;
                        ctx.globalAlpha = 0.3 - i * 0.05;
                        ctx.fillText(char, sx, sy);
                    }
                }
                ctx.globalAlpha = 1;
            }

            // ── Status Text ──
            ctx.font = '9px monospace';
            ctx.textAlign = 'center';
            ctx.fillStyle = mainColor;
            ctx.globalAlpha = 0.5;
            const statusText = isSpeaking ? '◉ TRANSMITTING' : isListening ? '◎ PROCESSING' : '● ONLINE';
            ctx.fillText(statusText, cx, cy + baseSize + 25);
            ctx.globalAlpha = 1;

            // ── Corner brackets (HUD frame) ──
            const frameSize = baseSize + 45;
            const bracketLen = 15;
            ctx.strokeStyle = mainColor;
            ctx.lineWidth = 1;
            ctx.globalAlpha = 0.3;
            // Top-left
            ctx.beginPath(); ctx.moveTo(cx - frameSize, cy - frameSize + bracketLen); ctx.lineTo(cx - frameSize, cy - frameSize); ctx.lineTo(cx - frameSize + bracketLen, cy - frameSize); ctx.stroke();
            // Top-right
            ctx.beginPath(); ctx.moveTo(cx + frameSize - bracketLen, cy - frameSize); ctx.lineTo(cx + frameSize, cy - frameSize); ctx.lineTo(cx + frameSize, cy - frameSize + bracketLen); ctx.stroke();
            // Bottom-left
            ctx.beginPath(); ctx.moveTo(cx - frameSize, cy + frameSize - bracketLen); ctx.lineTo(cx - frameSize, cy + frameSize); ctx.lineTo(cx - frameSize + bracketLen, cy + frameSize); ctx.stroke();
            // Bottom-right
            ctx.beginPath(); ctx.moveTo(cx + frameSize - bracketLen, cy + frameSize); ctx.lineTo(cx + frameSize, cy + frameSize); ctx.lineTo(cx + frameSize, cy + frameSize - bracketLen); ctx.stroke();
            ctx.globalAlpha = 1;

            timeRef.current += 1;
            animationId = requestAnimationFrame(render);
        };

        render();
        return () => cancelAnimationFrame(animationId);
    }, [inputVolume, outputVolume, isActive]);

    return <canvas ref={canvasRef} className="w-full h-full" />;
};

// ── Helper: Draw Hexagon ──
function drawHexagon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string, lineWidth: number, alpha = 1) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        const x = cx + size * Math.cos(angle);
        const y = cy + size * Math.sin(angle);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.globalAlpha = alpha;
    ctx.stroke();
    ctx.globalAlpha = 1;
}

// ── Helper: Draw Eye ──
function drawEye(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, alpha: number, t: number, isSpeaking: boolean) {
    // Eye shape (diamond/lens)
    ctx.beginPath();
    ctx.moveTo(x - w, y);
    ctx.quadraticCurveTo(x, y - h, x + w, y);
    ctx.quadraticCurveTo(x, y + h, x - w, y);
    ctx.closePath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = alpha;
    ctx.stroke();

    // Iris (glowing dot)
    const irisSize = Math.min(w * 0.25, h * 0.8);
    const irisGlow = ctx.createRadialGradient(x, y, 0, x, y, irisSize * 2);
    irisGlow.addColorStop(0, isSpeaking ? 'rgba(0, 255, 65, 0.9)' : 'rgba(0, 200, 255, 0.7)');
    irisGlow.addColorStop(0.5, isSpeaking ? 'rgba(0, 255, 65, 0.3)' : 'rgba(0, 200, 255, 0.2)');
    irisGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = irisGlow;
    ctx.beginPath();
    ctx.arc(x, y, irisSize * 2, 0, Math.PI * 2);
    ctx.fill();

    // Pupil
    ctx.beginPath();
    ctx.arc(x, y, irisSize * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha * 0.9;
    ctx.fill();
    ctx.globalAlpha = 1;
}

export default React.memo(AIAvatar);
