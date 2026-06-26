/**
 * VoiceOrb — the primary audio-reactive visual for Echo's voice interface.
 *
 * Layers (bottom → top):
 *  1. Three CSS-animated concentric rings (rotation speed reacts to state)
 *  2. Canvas: ambient glow field
 *  3. Canvas: 72 radial waveform bars (simulated FFT from volume)
 *  4. Canvas: emanating pulse rings
 *  5. Canvas: inner glowing core sphere
 *  6. Canvas: sparkle particles at high activity
 *  7. State label (LISTENING / SPEAKING / READY)
 *
 * Color state machine:
 *  inactive  → dim blue
 *  connected → blue
 *  listening → cyan  (inputVolume dominates)
 *  speaking  → green (outputVolume dominates)
 *  thinking  → amber
 */
import React, { useEffect, useRef } from 'react';

const BARS = 72;

interface Props {
  isActive: boolean;
  outputVolume: number;
  inputVolume: number;
  isThinking?: boolean;
}

const VoiceOrb: React.FC<Props> = ({ isActive, outputVolume, inputVolume, isThinking = false }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const tRef = useRef(0);
  const smoothOut = useRef(0);
  const smoothIn = useRef(0);
  const propsRef = useRef({ isActive, outputVolume, inputVolume, isThinking });

  // Always sync props into the ref so the stable animation loop reads fresh values
  useEffect(() => {
    propsRef.current = { isActive, outputVolume, inputVolume, isThinking };
  });

  // Single stable animation loop — never restarts on volume ticks
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const setSize = () => {
      const p = canvas.parentElement;
      if (!p) return;
      const s = Math.min(p.clientWidth, p.clientHeight);
      if (canvas.width !== s || canvas.height !== s) {
        canvas.width = s;
        canvas.height = s;
      }
    };
    setSize();

    let ro: ResizeObserver | undefined;
    try { ro = new ResizeObserver(setSize); if (canvas.parentElement) ro.observe(canvas.parentElement); } catch (_) {}
    window.addEventListener('resize', setSize);

    const draw = () => {
      const { isActive, outputVolume, inputVolume, isThinking } = propsRef.current;

      tRef.current += 0.016;
      const t = tRef.current;

      smoothOut.current += (outputVolume - smoothOut.current) * 0.1;
      smoothIn.current  += (inputVolume  - smoothIn.current)  * 0.1;

      const outV = smoothOut.current / 100;
      const inV  = smoothIn.current  / 100;
      const vol  = Math.max(outV, inV);

      const breath   = 0.5 + Math.sin(t * 0.8) * 0.12;
      const activity = isActive ? Math.max(vol, breath * 0.12) : breath * 0.05;

      const W  = canvas.width;
      const H  = canvas.height;
      if (!W || !H) { frameRef.current = requestAnimationFrame(draw); return; }
      const cx = W / 2;
      const cy = H / 2;

      ctx.clearRect(0, 0, W, H);

      const echoSpeaking = outV > 0.05 && outV >= inV;
      const userSpeaking = inV  > 0.05 && inV  >  outV;

      // ── Color ─────────────────────────────────────────────────
      let r: number, g: number, b: number;
      if (!isActive)       { r = 0;   g = 80;  b = 180; }
      else if (isThinking) { r = 255; g = 160; b = 0;   }
      else if (echoSpeaking){ r = 0;  g = 255; b = 65;  }
      else if (userSpeaking){ r = 0;  g = 220; b = 255; }
      else                 { r = 0;   g = 130; b = 255; }

      const baseR  = Math.min(W, H) * 0.29;
      const innerR = Math.min(W, H) * 0.092;

      // ── Ambient glow field ─────────────────────────────────────
      const glowR = baseR * (1.4 + activity * 0.7);
      const glow  = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
      glow.addColorStop(0,    `rgba(${r},${g},${b},${0.08 + activity * 0.16})`);
      glow.addColorStop(0.45, `rgba(${r},${g},${b},${0.02 + activity * 0.05})`);
      glow.addColorStop(1,    `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);

      // ── Radial waveform bars ───────────────────────────────────
      ctx.lineCap = 'round';
      const lw = Math.max(1.2, W / 260) * (1 + activity * 0.45);
      for (let i = 0; i < BARS; i++) {
        const ang = (i / BARS) * Math.PI * 2 - Math.PI / 2;
        // Layered sine functions simulate FFT variation without real FFT data
        const n = Math.max(0, (
          Math.sin(t * 2.1  + i * 0.26)        * 0.36 +
          Math.sin(t * 3.9  + i * 0.63 + 1.3)  * 0.22 +
          Math.sin(t * 1.2  + i * 0.11 + 2.6)  * 0.14 +
          Math.sin(t * 7.1  + i * 0.88 + 0.7)  * 0.08 +
          0.4
        ) / 1.65);

        const minH = isActive ? baseR * 0.04 : baseR * 0.007;
        const barH = minH + n * activity * baseR * 0.9;
        if (barH < 1) continue;

        const sr = innerR * 0.9;
        const sx = cx + Math.cos(ang) * sr;
        const sy = cy + Math.sin(ang) * sr;
        const ex = cx + Math.cos(ang) * (sr + barH);
        const ey = cy + Math.sin(ang) * (sr + barH);

        ctx.strokeStyle = `rgba(${r},${g},${b},${Math.min(0.9, 0.15 + n * activity * 0.8)})`;
        ctx.lineWidth   = lw;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }

      // ── Emanating pulse rings ──────────────────────────────────
      if (activity > 0.09) {
        for (let ri = 0; ri < 3; ri++) {
          const rr = (t * 80 + ri * 55) % (baseR * 1.8);
          const ra = Math.max(0, (1 - rr / (baseR * 1.8)) * activity * 0.55);
          if (ra < 0.015) continue;
          ctx.strokeStyle = `rgba(${r},${g},${b},${ra})`;
          ctx.lineWidth   = 1;
          ctx.beginPath();
          ctx.arc(cx, cy, innerR * 0.85 + rr, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // ── Inner core sphere ──────────────────────────────────────
      const coreR = innerR * (0.82 + activity * 0.58 + Math.sin(t * 2.4) * 0.06);
      const core  = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      core.addColorStop(0,    `rgba(255,255,255,${0.4  + activity * 0.52})`);
      core.addColorStop(0.22, `rgba(${r},${g},${b},${0.72 + activity * 0.22})`);
      core.addColorStop(0.65, `rgba(${r},${g},${b},${0.22 + activity * 0.28})`);
      core.addColorStop(1,    `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();

      // ── Sparkles at high activity ──────────────────────────────
      if (activity > 0.25 && isActive) {
        const cnt = Math.floor(activity * 20);
        for (let p = 0; p < cnt; p++) {
          const a = Math.random() * Math.PI * 2;
          const d = innerR + Math.random() * baseR * (0.35 + activity * 0.65);
          ctx.fillStyle = `rgba(${r},${g},${b},${0.22 + Math.random() * 0.55})`;
          ctx.beginPath();
          ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0.8 + Math.random() * 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      frameRef.current = requestAnimationFrame(draw);
    };

    frameRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frameRef.current);
      ro?.disconnect();
      window.removeEventListener('resize', setSize);
    };
  }, []); // stable — reads all live values from propsRef

  const echoSpeaking = outputVolume > 8;
  const userSpeaking = inputVolume  > 8;
  const rc = echoSpeaking ? '0,255,65' : userSpeaking ? '0,220,255' : isActive ? '0,130,255' : '20,50,140';

  const outerAlpha  = echoSpeaking ? 0.3  : userSpeaking ? 0.27 : isActive ? 0.1  : 0.04;
  const midAlpha    = echoSpeaking ? 0.4  : userSpeaking ? 0.36 : isActive ? 0.14 : 0.05;
  const innerAlpha  = echoSpeaking ? 0.5  : userSpeaking ? 0.44 : isActive ? 0.18 : 0.06;

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      {/* Outer ring — slow rotate */}
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          inset: '9%',
          border: `1px solid rgba(${rc},${outerAlpha})`,
          transition: 'border-color 0.8s ease, opacity 0.8s ease',
          animationName: 'ring-rotate',
          animationTimingFunction: 'linear',
          animationIterationCount: 'infinite',
          animationDuration: echoSpeaking ? '3s' : '18s',
        }}
      />
      {/* Mid ring — counter-rotate, dashed */}
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          inset: '17%',
          border: `1px dashed rgba(${rc},${midAlpha})`,
          transition: 'border-color 0.8s ease',
          animationName: 'ring-rotate-reverse',
          animationTimingFunction: 'linear',
          animationIterationCount: 'infinite',
          animationDuration: echoSpeaking ? '1.8s' : '11s',
        }}
      />
      {/* Inner ring — faster rotate, dotted */}
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          inset: '25%',
          border: `1px dotted rgba(${rc},${innerAlpha})`,
          transition: 'border-color 0.8s ease',
          animationName: 'ring-rotate',
          animationTimingFunction: 'linear',
          animationIterationCount: 'infinite',
          animationDuration: echoSpeaking ? '1.1s' : '6s',
        }}
      />

      {/* Audio-reactive canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {/* State label — floats in lower third of orb */}
      {isActive && (
        <div
          className="absolute left-0 right-0 flex justify-center pointer-events-none z-10"
          style={{ bottom: '14%' }}
        >
          <span
            className="font-mono uppercase transition-all duration-500 select-none"
            style={{
              fontSize: 'clamp(7px, 1.4vw, 10px)',
              letterSpacing: '0.38em',
              color: echoSpeaking ? '#00ff41' : userSpeaking ? '#00dcff' : 'rgba(255,255,255,0.2)',
              textShadow: echoSpeaking
                ? '0 0 10px rgba(0,255,65,0.9), 0 0 28px rgba(0,255,65,0.4)'
                : userSpeaking
                  ? '0 0 10px rgba(0,220,255,0.9), 0 0 28px rgba(0,220,255,0.4)'
                  : 'none',
            }}
          >
            {echoSpeaking ? '◈  S P E A K I N G  ◈' : userSpeaking ? '◉  L I S T E N I N G  ◉' : '·  R E A D Y  ·'}
          </span>
        </div>
      )}
    </div>
  );
};

export default VoiceOrb;
