/**
 * circadianThemeService.ts — Time-of-day adaptive theming.
 *
 * Subtly shifts the global accent color through the day to mimic
 * natural light cycles, while keeping the cyber-HUD identity intact.
 *
 *   05–10  DAWN     — soft cyan + violet warmth
 *   10–14  MORNING  — pure cyan/green (alert, productive)
 *   14–18  AFTERNOON— green/amber (focused, warm)
 *   18–21  EVENING  — amber/pink (winding down)
 *   21–05  NIGHT    — magenta/violet (calm, intimate)
 *
 * Updates CSS custom properties on :root every 60s.
 */

export type CircadianPhase = 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night';

interface PhaseConfig {
    name: string;
    accent: string;      // primary HUD glow
    accent2: string;     // secondary
    bg: string;          // body background tint
    glow: string;        // outer glow color
    label: string;
    icon: string;
}

const PHASES: Record<CircadianPhase, PhaseConfig> = {
    dawn:      { name:'DAWN',      accent:'#7DDEFF', accent2:'#A064FF', bg:'#020815', glow:'rgba(125,222,255,0.18)', label:'EARLY HOURS', icon:'🌅' },
    morning:   { name:'MORNING',   accent:'#00E5FF', accent2:'#00FF41', bg:'#000810', glow:'rgba(0,229,255,0.18)',   label:'PEAK FOCUS',  icon:'☀️' },
    afternoon: { name:'AFTERNOON', accent:'#00FF41', accent2:'#FFB300', bg:'#001008', glow:'rgba(0,255,65,0.18)',    label:'DEEP WORK',   icon:'🔆' },
    evening:   { name:'EVENING',   accent:'#FFB300', accent2:'#FF6B9D', bg:'#0F0805', glow:'rgba(255,179,0,0.18)',   label:'WIND DOWN',   icon:'🌇' },
    night:     { name:'NIGHT',     accent:'#FF6B9D', accent2:'#A064FF', bg:'#0A0210', glow:'rgba(255,107,157,0.16)', label:'AFTER HOURS', icon:'🌙' },
};

export function getPhase(date = new Date()): CircadianPhase {
    const h = date.getHours();
    if (h >= 5 && h < 10)  return 'dawn';
    if (h >= 10 && h < 14) return 'morning';
    if (h >= 14 && h < 18) return 'afternoon';
    if (h >= 18 && h < 21) return 'evening';
    return 'night';
}

export function getPhaseConfig(phase: CircadianPhase = getPhase()): PhaseConfig {
    return PHASES[phase];
}

/** Apply the phase to CSS custom properties on :root. */
export function applyPhase(phase: CircadianPhase = getPhase()): void {
    const cfg  = PHASES[phase];
    const root = document.documentElement;
    root.style.setProperty('--circadian-accent',  cfg.accent);
    root.style.setProperty('--circadian-accent2', cfg.accent2);
    root.style.setProperty('--circadian-bg',      cfg.bg);
    root.style.setProperty('--circadian-glow',    cfg.glow);
    root.dataset.phase = phase;
}

/**
 * Start the periodic update. Returns a cleanup function.
 * Updates immediately + every 60 seconds.
 */
export function startCircadianLoop(onChange?: (phase: CircadianPhase) => void): () => void {
    let lastPhase: CircadianPhase | null = null;

    const tick = () => {
        const phase = getPhase();
        if (phase !== lastPhase) {
            lastPhase = phase;
            applyPhase(phase);
            onChange?.(phase);
        }
    };

    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
}
