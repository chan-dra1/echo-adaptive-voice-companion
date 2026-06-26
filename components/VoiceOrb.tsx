/**
 * VoiceOrb v3 — Premium multi-layer audio-reactive orb
 *
 * Design: "Liquid Glass Matrix" — volumetric sphere with:
 *  1. Mesh gradient background halo
 *  2. Three animated CSS rings (state-reactive speed)
 *  3. Canvas: 80-bar waveform spectrum (FFT-simulated)
 *  4. Canvas: emanating pulse rings (voice-gated)
 *  5. Canvas: volumetric core sphere (radial, specular highlight)
 *  6. Canvas: sparkle burst at high volume
 *  7. Glassmorphism overlay with live state label
 *
 * Color state machine:
 *  idle/disconnected → dim blue-slate
 *  connected/ready   → blue
 *  listening         → cyan / teal
 *  speaking          → emerald green  (matches matrix theme)
 *  thinking          → amber / gold
 */
import React, { useEffect, useRef } from 'react';

const BARS = 80;

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

  useEffect(() => {
    propsRef.current = { isActive, outputVolume, inputVolume, isThinking };
  });

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
        canvas.width  = s;
        canvas.height = s;
      }
    };
    setSize();

    let ro: ResizeObserver | undefined;
    try {
      ro = new ResizeObserver(setSize);
      if (canvas.parentElement) ro.observe(canvas.parentElement);
    } catch (_) {}
    window.addEventListener('resize', setSize);

    const draw = () => {
      const { isActive, outputVolume, inputVolume, isThinking } = propsRef.current;

      tRef.current += 0.016;
      const t = tRef.current;

      // Smooth volume with different response curves
      smoothOut.current += (outputVolume - smoothOut.current) * 0.08;
      smoothIn.current  += (inputVolume  - smoothIn.current)  * 0.12;

      const outV = Math.min(1, smoothOut.current / 100);
      const inV  = Math.min(1, smoothIn.current  / 100);
      const vol  = Math.max(outV, inV);

      // Breathing oscillation (idle pulse)
      const breath   = 0.5 + Math.sin(t * 0.65) * 0.14;
      const activity = isActive
        ? Math.max(vol * 1.05, breath * 0.18)
        : breath * 0.06;

      const W  = canvas.width;
      const H  = canvas.height;
      if (!W || !H) { frameRef.current = requestAnimationFrame(draw); return; }
      const cx = W / 2;
      const cy = H / 2;

      ctx.clearRect(0, 0, W, H);

      const echoSpeaking = outV > 0.04 && outV >= inV;
      const userSpeaking = inV  > 0.04 && inV  > outV;

      // ── Color state ──────────────────────────────────────────
      let r: number, g: number, b: number;
      if (!isActive)        { r = 20;  g = 60;  b = 180; }
      else if (isThinking)  { r = 255; g = 170; b = 0;   }
      else if (echoSpeaking){ r = 0;   g = 255; b = 136; }
      else if (userSpeaking){ r = 0;   g = 210; b = 255; }
      else                  { r = 30;  g = 140; b = 255; }

      const baseR  = Math.min(W, H) * 0.30;
      const coreR0 = Math.min(W, H) * 0.095;

      // ── 1. Wide ambient halo ──────────────────────────────────
      const haloR  = baseR * (1.6 + activity * 0.8);
      const halo   = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloR);
      const hA     = 0.07 + activity * 0.18;
      halo.addColorStop(0,    `rgba(${r},${g},${b},${hA})`);
      halo.addColorStop(0.35, `rgba(${r},${g},${b},${hA * 0.35})`);
      halo.addColorStop(0.75, `rgba(${r},${g},${b},${hA * 0.08})`);
      halo.addColorStop(1,    `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, W, H);

      // ── 2. Radial waveform bars ───────────────────────────────
      ctx.lineCap = 'round';
      const lw = Math.max(1.5, W / 240) * (1 + activity * 0.5);

      for (let i = 0; i < BARS; i++) {
        const ang = (i / BARS) * Math.PI * 2 - Math.PI / 2;

        // Multi-sine composite (FFT simulation)
        const n = Math.max(0, (
          Math.sin(t * 1.9 + i * 0.24)        * 0.38 +
          Math.sin(t * 3.7 + i * 0.59 + 1.1)  * 0.22 +
          Math.sin(t * 1.1 + i * 0.10 + 2.5)  * 0.15 +
          Math.sin(t * 6.8 + i * 0.84 + 0.6)  * 0.09 +
          Math.sin(t * 0.4 + i * 0.04)         * 0.06 +
          0.44
        ) / 1.7);

        const minH = isActive ? coreR0 * 0.25 : coreR0 * 0.04;
        const barH = minH + n * activity * baseR * 1.05;
        if (barH < 1) continue;

        const sr = coreR0 * 0.88;
        const sx = cx + Math.cos(ang) * sr;
        const sy = cy + Math.sin(ang) * sr;
        const ex = cx + Math.cos(ang) * (sr + barH);
        const ey = cy + Math.sin(ang) * (sr + barH);

        // Outer bars fade to transparent — 3D depth illusion
        const alpha = Math.min(0.92, 0.12 + n * activity * 0.88);
        ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.lineWidth   = lw;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }

      // ── 3. Emanating pulse rings ──────────────────────────────
      if (activity > 0.08) {
        for (let ri = 0; ri < 4; ri++) {
          const speed  = 70 + activity * 55;
          const spread = baseR * 2.0;
          const rr     = (t * speed + ri * (spread / 4)) % spread;
          const decay  = 1 - rr / spread;
          const ra     = Math.max(0, decay * decay * activity * 0.6);
          if (ra < 0.01) continue;

          ctx.strokeStyle = `rgba(${r},${g},${b},${ra})`;
          ctx.lineWidth   = 1.2;
          ctx.beginPath();
          ctx.arc(cx, cy, coreR0 * 0.8 + rr, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // ── 4. Core sphere — volumetric with specular ─────────────
      const pulseMag = isThinking
        ? Math.sin(t * 5) * 0.05          // jitter for thinking
        : Math.sin(t * 2.2) * 0.06;

      const coreR = coreR0 * (0.84 + activity * 0.62 + pulseMag);

      // Base sphere gradient
      const sphere = ctx.createRadialGradient(
        cx - coreR * 0.22, cy - coreR * 0.22, 0,  // offset center = specular
        cx, cy, coreR
      );
      sphere.addColorStop(0,    `rgba(255,255,255,${0.38 + activity * 0.44})`);
      sphere.addColorStop(0.18, `rgba(${r},${g},${b},${0.90 + activity * 0.10})`);
      sphere.addColorStop(0.55, `rgba(${r},${g},${b},${0.55 + activity * 0.30})`);
      sphere.addColorStop(0.85, `rgba(${Math.max(0,r-20)},${Math.max(0,g-60)},${Math.max(0,b-20)},${0.30 + activity * 0.20})`);
      sphere.addColorStop(1,    `rgba(${r},${g},${b},0)`);

      ctx.fillStyle = sphere;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();

      // Inner specular highlight (white dot, top-left)
      if (coreR > 4) {
        const specX  = cx - coreR * 0.28;
        const specY  = cy - coreR * 0.28;
        const specR  = coreR * 0.28;
        const spec   = ctx.createRadialGradient(specX, specY, 0, specX, specY, specR);
        spec.addColorStop(0, `rgba(255,255,255,${0.55 + activity * 0.35})`);
        spec.addColorStop(1, `rgba(255,255,255,0)`);
        ctx.fillStyle = spec;
        ctx.beginPath();
        ctx.arc(specX, specY, specR, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── 5. Sparkle burst at high activity ────────────────────
      if (activity > 0.22 && isActive) {
        const cnt = Math.floor(activity * 26);
        for (let p = 0; p < cnt; p++) {
          const a  = Math.random() * Math.PI * 2;
          const d  = coreR0 + Math.random() * baseR * (0.40 + activity * 0.70);
          const sz = 0.6 + Math.random() * 2.2;
          const al = 0.18 + Math.random() * 0.60;
          ctx.fillStyle = `rgba(${r},${g},${b},${al})`;
          ctx.beginPath();
          ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, sz, 0, Math.PI * 2);
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
  }, []); // stable — reads live props from propsRef

  // React-side computed values for CSS rings
  const echoSpeaking = outputVolume > 8;
  const userSpeaking = inputVolume  > 8;

  const rc = echoSpeaking ? '0,255,136' : userSpeaking ? '0,210,255' : isActive ? '30,140,255' : '20,60,180';
  const outerAlpha = echoSpeaking ? 0.32 : userSpeaking ? 0.28 : isActive ? 0.12 : 0.04;
  const midAlpha   = echoSpeaking ? 0.42 : userSpeaking ? 0.38 : isActive ? 0.16 : 0.06;
  const innerAlpha = echoSpeaking ? 0.56 : userSpeaking ? 0.48 : isActive ? 0.22 : 0.08;

  const outerDur = echoSpeaking ? '3s'  : '20s';
  const midDur   = echoSpeaking ? '1.8s': '12s';
  const innerDur = echoSpeaking ? '1.1s': '7s';

  // Label
  let stateLabel: string;
  let labelColor: string;
  let labelGlow: string;
  if (!isActive) {
    stateLabel = '·  S T A N D B Y  ·';
    labelColor = 'rgba(255,255,255,0.12)';
    labelGlow  = 'none';
  } else if (isThinking) {
    stateLabel = '◌  P R O C E S S I N G  ◌';
    labelColor = '#ffb300';
    labelGlow  = '0 0 10px rgba(255,179,0,0.9), 0 0 28px rgba(255,179,0,0.4)';
  } else if (echoSpeaking) {
    stateLabel = '◈  S P E A K I N G  ◈';
    labelColor = '#00ff88';
    labelGlow  = '0 0 10px rgba(0,255,136,0.9), 0 0 28px rgba(0,255,136,0.4)';
  } else if (userSpeaking) {
    stateLabel = '◉  L I S T E N I N G  ◉';
    labelColor = '#00d4ff';
    labelGlow  = '0 0 10px rgba(0,212,255,0.9), 0 0 28px rgba(0,212,255,0.4)';
  } else {
    stateLabel = '·  R E A D Y  ·';
    labelColor = 'rgba(255,255,255,0.25)';
    labelGlow  = 'none';
  }

  return (
    <div className="relative w-full h-full flex items-center justify-center">

      {/* Outer glow halo — pure CSS, GPU-accelerated */}
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          inset: '-8%',
          background: `radial-gradient(circle, rgba(${rc},${outerAlpha * 0.4}) 0%, transparent 70%)`,
          transition: 'background 1.2s ease',
          willChange: 'transform',
          animation: 'orb-breathe 4s ease-in-out infinite',
        }}
      />

      {/* Ring 1 — outermost, slow */}
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          inset: '8%',
          border: `1px solid rgba(${rc},${outerAlpha})`,
          transition: 'border-color 1s ease, opacity 1s ease',
          animationName: 'ring-rotate',
          animationTimingFunction: 'linear',
          animationIterationCount: 'infinite',
          animationDuration: outerDur,
          willChange: 'transform',
        }}
      />
      {/* Ring 2 — medium, counter-rotate */}
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          inset: '16%',
          border: `1px dashed rgba(${rc},${midAlpha})`,
          transition: 'border-color 1s ease',
          animationName: 'ring-rotate-reverse',
          animationTimingFunction: 'linear',
          animationIterationCount: 'infinite',
          animationDuration: midDur,
          willChange: 'transform',
        }}
      />
      {/* Ring 3 — inner, faster */}
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          inset: '24%',
          border: `1.5px dotted rgba(${rc},${innerAlpha})`,
          transition: 'border-color 1s ease',
          animationName: 'ring-rotate',
          animationTimingFunction: 'linear',
          animationIterationCount: 'infinite',
          animationDuration: innerDur,
          willChange: 'transform',
        }}
      />

      {/* Audio-reactive canvas — main visual */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ willChange: 'transform' }}
      />

      {/* State label — floats at bottom of orb */}
      <div
        className="absolute left-0 right-0 flex justify-center pointer-events-none z-10"
        style={{ bottom: '12%' }}
      >
        <span
          className="font-mono uppercase select-none transition-all duration-700"
          style={{
            fontSize: 'clamp(7px, 1.3vw, 10px)',
            letterSpacing: '0.35em',
            color: labelColor,
            textShadow: labelGlow,
          }}
        >
          {stateLabel}
        </span>
      </div>
    </div>
  );
};

export default VoiceOrb;
