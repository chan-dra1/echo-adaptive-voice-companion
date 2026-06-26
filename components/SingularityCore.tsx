/**
 * SingularityCore.tsx — "ECHO VOID"
 *
 * A dimensional rift where Echo exists. Part sacred geometry, part cyberpunk
 * HUD, part deep-space telescope, part bioluminescent abyss.
 *
 * Layers (back → front):
 *  1. Deep-space star field      — canvas, drawn once, 220 procedural stars
 *  2. Data stream edges          — subtle Matrix columns, left & right margins
 *  3. Metatron's Cube orb        — SVG sacred geometry with 3 orbital rings
 *  4. Waveform ring              — canvas RAF loop, 2-ring circular waveform
 *  5. Caption hologram           — typewriter text with chromatic scanline
 *  6. Corner telemetry           — four-corner minimal HUD readouts
 *
 * All animation: transform + opacity only (GPU-composited).
 * React state changes only on EchoState transitions. Everything else is
 * direct DOM mutation through refs inside a single consolidated RAF loop.
 */

import React, { useEffect, useRef, useState } from 'react';
import AggressiveAtom from './AggressiveAtom';

/* ── State config ─────────────────────────────────────────────── */
type ES = 'STANDBY' | 'LISTENING' | 'PROCESSING' | 'SPEAKING' | 'ONLINE';

const S: Record<ES, { c: string; rgb: string; label: string; sub: string }> = {
  STANDBY:    { c: '#6C5CE7', rgb: '108,92,231',  label: 'STANDBY',    sub: 'neural link offline'     },
  ONLINE:     { c: '#00CFFF', rgb: '0,207,255',   label: 'ONLINE',     sub: 'awaiting directive'      },
  LISTENING:  { c: '#00FF88', rgb: '0,255,136',   label: 'LISTENING',  sub: 'input stream active'     },
  PROCESSING: { c: '#FFB700', rgb: '255,183,0',   label: 'PROCESSING', sub: 'reasoning · routing'     },
  SPEAKING:   { c: '#FF2D78', rgb: '255,45,120',  label: 'SPEAKING',   sub: 'voice synthesis active'  },
};

/* ── Data stream columns ──────────────────────────────────────── */
const GLYPHS = '01ΩπφΔ∞░▒╔╚║═λ0F1E4A8B9C32756アイウエオカキ'.split('');
const rg = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
const col = (n: number) => Array.from({ length: n }, rg).join('\n');
const COLS = [
  { left: '1.0%',  dur: 13, delay: 0,  op: 0.09 },
  { left: '3.5%',  dur:  9, delay: -5, op: 0.06 },
  { left: '6.5%',  dur: 16, delay: -8, op: 0.07 },
  { left: '88.5%', dur: 11, delay: -3, op: 0.08 },
  { left: '92.0%', dur:  8, delay: -6, op: 0.06 },
  { left: '95.5%', dur: 14, delay: -1, op: 0.09 },
].map(c => ({ ...c, chars: col(60) }));

/* ── Props ────────────────────────────────────────────────────── */
interface Props {
  connected: boolean;
  inputVolume: number;
  outputVolume: number;
  captionText: string;
  streaming: boolean;
  awaitingReply: boolean;
}

export default function SingularityCore({
  connected, inputVolume, outputVolume, captionText, streaming, awaitingReply,
}: Props) {
  /* ── Normalize volumes (service emits 0–255) ──────────────── */
  const nIn  = inputVolume  > 1.5 ? inputVolume  / 255 : inputVolume;
  const nOut = outputVolume > 1.5 ? outputVolume / 255 : outputVolume;

  /* ── Derive Echo state ────────────────────────────────────── */
  const es: ES =
    !connected               ? 'STANDBY'    :
    nOut > 0.05              ? 'SPEAKING'   :
    nIn  > 0.05              ? 'LISTENING'  :
    (awaitingReply || streaming) ? 'PROCESSING' :
    'ONLINE';

  const meta = S[es];

  /* ── Glitch on state transition ───────────────────────────── */
  const [glitch, setGlitch] = useState(false);
  const prevEs = useRef<ES>(es);
  useEffect(() => {
    if (prevEs.current === es) return;
    prevEs.current = es;
    setGlitch(true);
    const t = setTimeout(() => setGlitch(false), 420);
    return () => clearTimeout(t);
  }, [es]);

  /* ── Caption typewriter (direct DOM — no re-renders) ─────── */
  const capRef  = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const charRef  = useRef(0);
  const prevCap  = useRef('');
  useEffect(() => {
    if (!captionText || captionText === prevCap.current) return;
    const isExt = captionText.startsWith(prevCap.current);
    if (!isExt) charRef.current = 0;
    prevCap.current = captionText;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      if (!capRef.current) return;
      if (charRef.current >= captionText.length) { clearInterval(timerRef.current!); return; }
      charRef.current = Math.min(charRef.current + 3, captionText.length);
      capRef.current.textContent = captionText.slice(0, charRef.current);
    }, 18);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [captionText]);

  /* ── Star field canvas (drawn once) ─────────────────────── */
  const starRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = starRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width  = c.offsetWidth  * dpr;
    c.height = c.offsetHeight * dpr;
    const ctx = c.getContext('2d')!;
    for (let i = 0; i < 240; i++) {
      ctx.beginPath();
      ctx.arc(Math.random() * c.width, Math.random() * c.height, Math.random() * 1.2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${0.1 + Math.random() * 0.75})`;
      ctx.fill();
    }
  }, []);

  /* ── Waveform canvas (RAF loop) ─────────────────────────── */
  const waveRef  = useRef<HTMLCanvasElement>(null);
  const rafRef   = useRef(0);
  const phRef    = useRef(0);
  const vInRef   = useRef(0);
  const vOutRef  = useRef(0);
  const metaRef  = useRef(meta);
  metaRef.current  = meta;
  vInRef.current   = nIn;
  vOutRef.current  = nOut;

  useEffect(() => {
    const c = waveRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => { c.width = c.offsetWidth * dpr; c.height = c.offsetHeight * dpr; };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(c);

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, c.width, c.height);
      phRef.current += 0.035;

      const vin  = vInRef.current;
      const vout = vOutRef.current;
      const energy = Math.max(vout * 1.6, vin * 0.9, 0.025);
      const cx = c.width / 2, cy = c.height / 2;
      const base = Math.min(c.width, c.height) * 0.31;
      const N = 128;
      const { c: col, rgb } = metaRef.current;

      // Outer waveform ring
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const wave =
          Math.sin(a * 7  + phRef.current) * energy * 15 +
          Math.sin(a * 3  - phRef.current * 0.9) * energy * 8 +
          Math.sin(a * 13 + phRef.current * 1.5) * energy * 4;
        const r = base + wave;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = col;
      ctx.lineWidth = (1.8 + energy * 2.5) * dpr;
      ctx.globalAlpha = 0.30 + energy * 0.55;
      ctx.shadowColor = col; ctx.shadowBlur = 16 * dpr;
      ctx.stroke();

      // Inner echo ring
      const inner = base * 0.62;
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const wave = Math.sin(a * 5 - phRef.current * 1.3) * energy * 9
                   + Math.sin(a * 9 + phRef.current * 0.6) * energy * 4;
        const r = inner + wave;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = `rgba(${rgb},0.5)`;
      ctx.lineWidth = (1 + energy) * dpr;
      ctx.globalAlpha = 0.18 + energy * 0.28;
      ctx.shadowBlur = 8 * dpr;
      ctx.stroke();

      // Micro radial spikes (only when energy > 0.2 = speaking/listening)
      if (energy > 0.15) {
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          const spike = energy * (0.3 + 0.7 * Math.abs(Math.sin(a * 3 + phRef.current * 2))) * 18;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * (base - 4), cy + Math.sin(a) * (base - 4));
          ctx.lineTo(cx + Math.cos(a) * (base + spike), cy + Math.sin(a) * (base + spike));
          ctx.strokeStyle = col;
          ctx.lineWidth = 1.5 * dpr;
          ctx.globalAlpha = 0.12 + energy * 0.35;
          ctx.shadowBlur = 8 * dpr;
          ctx.stroke();
        }
      }

      ctx.globalAlpha = 1;
      ctx.shadowBlur  = 0;
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(rafRef.current); ro.disconnect(); };
  }, []);

  /* ── Mouse parallax ──────────────────────────────────────── */
  const rootRef    = useRef<HTMLDivElement>(null);
  const orbWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    const orb  = orbWrapRef.current;
    if (!root || !orb) return;
    const onMove = (e: MouseEvent) => {
      const r = root.getBoundingClientRect();
      const tx = (e.clientX - r.left  - r.width  / 2) / (r.width  / 2);
      const ty = (e.clientY - r.top   - r.height / 2) / (r.height / 2);
      orb.style.transform = `perspective(700px) rotateY(${tx * 9}deg) rotateX(${-ty * 9}deg)`;
    };
    const onLeave = () => { orb.style.transform = 'perspective(700px) rotateY(0deg) rotateX(0deg)'; };
    root.addEventListener('mousemove', onMove);
    root.addEventListener('mouseleave', onLeave);
    return () => { root.removeEventListener('mousemove', onMove); root.removeEventListener('mouseleave', onLeave); };
  }, []);

  /* ── Render ──────────────────────────────────────────────── */
  const { c, rgb } = meta;

  return (
    <div ref={rootRef} className="sc-root relative flex flex-col items-center w-full h-full overflow-hidden">
      <style>{CSS}</style>

      {/* ── L1: Star field ─────────────────────────────────── */}
      <canvas ref={starRef} className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity: 0.65 }} />

      {/* ── L2: Nebula glow (CSS only) ─────────────────────── */}
      <div className="sc-nebula absolute inset-0 pointer-events-none"
        style={{ background: `radial-gradient(ellipse 70% 60% at 50% 45%, rgba(${rgb},0.07) 0%, transparent 70%)` }} />

      {/* ── L3: Data stream columns ────────────────────────── */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none select-none font-mono text-[8px] leading-[1.3]">
        {COLS.map((col, i) => (
          <div key={i} className="absolute top-0 whitespace-pre sc-stream-col"
            style={{ left: col.left, opacity: col.op, color: c,
              animationDuration: `${col.dur}s`, animationDelay: `${col.delay}s` }}>
            {col.chars + '\n' + col.chars}
          </div>
        ))}
      </div>

      {/* ── Corner telemetry ───────────────────────────────── */}
      <div className="absolute top-0 left-0 m-3 z-30 pointer-events-none font-mono text-[9px] leading-relaxed"
        style={{ color: `rgba(${rgb},0.5)` }}>
        <div style={{ borderLeft: `1px solid rgba(${rgb},0.3)`, paddingLeft: 6 }}>
          <div className="tracking-widest">ECHO·VOID</div>
          <div className="opacity-60">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
      </div>
      <div className="absolute top-0 right-0 m-3 z-30 pointer-events-none font-mono text-[9px] leading-relaxed text-right"
        style={{ color: `rgba(${rgb},0.5)` }}>
        <div style={{ borderRight: `1px solid rgba(${rgb},0.3)`, paddingRight: 6 }}>
          <div className="tracking-widest">{connected ? '●  LINKED' : '○  OFFLINE'}</div>
          <div className="opacity-60">AES-GCM-256</div>
        </div>
      </div>
      <div className="absolute bottom-28 md:bottom-40 left-0 m-3 z-30 pointer-events-none font-mono text-[8px]"
        style={{ color: `rgba(${rgb},0.4)` }}>
        <div>IN&nbsp;{(nIn  * 100).toFixed(0).padStart(3)}%</div>
        <div>OUT {(nOut * 100).toFixed(0).padStart(3)}%</div>
      </div>
      {/* ── L4: Orb + waveform ─────────────────────────────── */}
      <div className="relative flex-1 flex items-center justify-center w-full min-h-0 z-10 pb-16 md:pb-20">
        <div ref={orbWrapRef} className="relative sc-orb-wrap">

          {/* Waveform canvas — behind SVG */}
          <canvas ref={waveRef}
            className="absolute pointer-events-none"
            style={{ inset: '-32%', width: '164%', height: '164%', zIndex: 1 }} />

          {/* ── Aggressive Atom ──────────────────────── */}
          <div
            className={glitch ? 'sc-glitch' : ''}
            style={{
              position: 'relative', zIndex: 2,
              filter: `drop-shadow(0 0 ${20 + nOut * 22}px rgba(${rgb},0.55))`,
              transition: 'filter 0.4s ease',
            }}
          >
            <AggressiveAtom
              state={es}
              inputVolume={nIn}
              outputVolume={nOut}
              color={meta.c}
              rgb={meta.rgb}
            />
          </div>
        </div>
      </div>

      {/* ── L5: Caption — right-side HUD strip ──────────────── */}
      <div
        className="absolute right-2 md:right-5 top-14 z-20 w-40 md:w-52 pointer-events-none transition-colors duration-500"
        style={{ bottom: 'calc(6.5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        {/* State badge */}
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="sc-dot" style={{ '--dc': c } as any} />
          <span className="sc-hud-font text-[7px] tracking-[0.40em] uppercase transition-colors duration-500"
            style={{ color: c, opacity: 0.80 }}>
            {meta.label}
          </span>
        </div>

        {/* Top rule */}
        <div className="mb-2 h-px" style={{ background: `linear-gradient(90deg, rgba(${rgb},0.50), transparent)` }} />

        {/* Sub-label */}
        <div className="sc-hud-font text-[7px] tracking-widest uppercase mb-2 transition-colors duration-500"
          style={{ color: `rgba(${rgb},0.38)` }}>
          ECHO // {meta.sub}
        </div>

        {/* Caption text — left-border strip */}
        <div className="relative overflow-hidden"
          style={{ borderLeft: `1px solid rgba(${rgb},0.30)`, paddingLeft: '8px' }}>

          {/* Scanline sweep */}
          <span className="absolute left-0 right-0 h-px pointer-events-none sc-scan"
            style={{ background: `linear-gradient(90deg, transparent, rgba(${rgb},0.55), transparent)`, opacity: 0.28 }} />

          {/* Text */}
          <p className="sc-hud-font text-[10px] md:text-[11px] leading-[1.85] break-words transition-colors duration-500"
            style={{ color: 'rgba(255,255,255,0.68)', textShadow: `0 0 6px rgba(${rgb},0.28)`, letterSpacing: '0.04em' }}>
            <span ref={capRef}>
              {captionText ? undefined : (connected ? 'awaiting input_' : 'link offline_')}
            </span>
            {connected && <span className="sc-cursor" style={{ color: c }}>▋</span>}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── CSS keyframes & utilities ────────────────────────────────── */
const CSS = `
  @keyframes sc-scan    { from{top:0} to{top:100%} }
  @keyframes sc-cursor  { 0%,49%{opacity:1} 50%,100%{opacity:0} }
  @keyframes sc-stream-scroll { from{transform:translateY(0)} to{transform:translateY(-50%)} }
  @keyframes sc-nebula-pulse  { 0%,100%{opacity:0.8} 50%{opacity:1.0} }
  @keyframes sc-dot-pulse     { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.45;transform:scale(1.5)} }
  @keyframes sc-glitch-anim {
    0%   { clip-path:inset(0 0 0 0);      transform:translate(0,0);    filter:none; }
    12%  { clip-path:inset(12% 0 72% 0);  transform:translate(-3px,0); filter:hue-rotate(90deg)  saturate(4); }
    25%  { clip-path:inset(45% 0 42% 0);  transform:translate( 3px,0); filter:hue-rotate(180deg) saturate(6); }
    48%  { clip-path:inset(68% 0 22% 0);  transform:translate(-2px,0); filter:hue-rotate(270deg) brightness(1.4); }
    70%  { clip-path:inset(0 0 0 0);      transform:translate( 1px,0); filter:none; }
    100% { clip-path:inset(0 0 0 0);      transform:translate(0,0);    filter:none; }
  }
  .sc-glitch       { animation: sc-glitch-anim 0.42s steps(2,end) forwards; }
  .sc-orb-wrap     { transition: transform 0.1s ease-out; will-change: transform; }
  .sc-scan         { animation: sc-scan 4.5s linear infinite; }
  .sc-cursor       { animation: sc-cursor 0.9s step-end infinite; }
  .sc-nebula       { animation: sc-nebula-pulse 6s ease-in-out infinite; }
  .sc-stream-col   { animation-name: sc-stream-scroll; animation-timing-function: linear; animation-iteration-count: infinite; }
  .sc-dot {
    display:inline-block; width:6px; height:6px; border-radius:50%;
    background: var(--dc,white); box-shadow: 0 0 7px var(--dc,white);
    animation: sc-dot-pulse 1.6s ease-in-out infinite;
  }
  .sc-hud-font {
    font-family: 'Share Tech Mono', 'JetBrains Mono', ui-monospace, monospace;
    font-weight: 400;
  }
`;
