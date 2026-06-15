/**
 * voice.mjs — Echo Core terminal voice output.
 *
 * Speaks text aloud using whatever the OS already provides, so the terminal
 * "talks back" with zero extra dependencies:
 *   macOS    → `say`
 *   Linux    → `spd-say` then `espeak` then `festival`
 *   Windows  → PowerShell System.Speech
 *
 * If none is available it degrades to a silent no-op (text is still printed
 * and synced). Speaking is fire-and-forget and never blocks the REPL.
 *
 * Audio routing rule (set by the caller): the surface that GENERATED a
 * response is the one that voices it. So the terminal speaks responses it
 * generated; web-originated voice turns are only printed here (the browser
 * already played them) to avoid double audio on one machine.
 */

import { spawn, execSync } from 'node:child_process';
import os from 'node:os';

let enabled = true;
let engine = null; // resolved lazily
let current = null; // current child process (to allow interrupt)

function has(bin) {
    try { execSync(`command -v ${bin}`, { stdio: 'ignore' }); return true; } catch { return false; }
}

function resolveEngine() {
    if (engine !== null) return engine;
    const platform = os.platform();
    if (platform === 'darwin' && has('say')) engine = { cmd: 'say', args: (t) => [t] };
    else if (platform === 'win32') engine = { cmd: 'powershell', args: (t) => ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${t.replace(/'/g, "''")}')`] };
    else if (has('spd-say')) engine = { cmd: 'spd-say', args: (t) => ['-w', t] };
    else if (has('espeak')) engine = { cmd: 'espeak', args: (t) => [t] };
    else if (has('festival')) engine = { cmd: 'festival', args: () => ['--tts'] , stdin: true };
    else engine = false;
    return engine;
}

export const voice = {
    isAvailable() { return resolveEngine() !== false; },
    isEnabled() { return enabled && this.isAvailable(); },
    setEnabled(v) { enabled = !!v; if (!enabled) this.stop(); return this.isEnabled(); },
    engineName() { const e = resolveEngine(); return e ? e.cmd : 'none'; },

    /** Speak text aloud (non-blocking). Truncates very long output. */
    speak(text) {
        if (!enabled) return;
        const e = resolveEngine();
        if (!e) return;
        const clean = String(text || '').replace(/[`$]/g, '').slice(0, 1200).trim();
        if (!clean) return;
        try {
            this.stop();
            if (e.stdin) {
                current = spawn(e.cmd, e.args(clean), { stdio: ['pipe', 'ignore', 'ignore'] });
                current.stdin.write(clean); current.stdin.end();
            } else {
                current = spawn(e.cmd, e.args(clean), { stdio: 'ignore' });
            }
            current.on('error', () => { current = null; });
            current.on('exit', () => { current = null; });
        } catch { current = null; }
    },

    /** Interrupt current speech (e.g. user barge-in). */
    stop() { try { current?.kill(); } catch { /* ignore */ } current = null; },
};
