/**
 * listen.mjs — terminal microphone input (talk to Echo from the terminal).
 *
 * Two pieces, each auto-detected with graceful fallback:
 *   1. RECORD a short utterance from the mic
 *        sox `rec` (preferred, stops on silence) → sox -d → ffmpeg (fixed cap)
 *   2. TRANSCRIBE it to text
 *        Groq Whisper (GROQ_API_KEY) → OpenAI Whisper (OPENAI_API_KEY)
 *        → local `whisper` CLI (whisper.cpp / openai-whisper)
 *
 * If a recorder or transcriber is missing, available() is false and reason()
 * explains exactly what to install. Nothing here blocks the REPL; recording is
 * awaited explicitly via captureAndTranscribe().
 *
 * Local-first: with a local `whisper` binary, speech never leaves the machine.
 * The API paths are opt-in (only used if you've set a key).
 */

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function has(bin) { try { execSync(`command -v ${bin}`, { stdio: 'ignore' }); return true; } catch { return false; } }

/* ── recorder detection ── */
function detectRecorder() {
    // sox `rec`: record mono 16k, trim leading silence, stop after ~1.6s quiet
    const silence = ['silence', '1', '0.1', '2%', '1', '1.6', '2%'];
    if (has('rec')) return { name: 'rec', build: (f) => ['-q', '-c', '1', '-r', '16000', '-b', '16', f, ...silence] };
    if (has('sox')) return { name: 'sox', build: (f) => ['-d', '-q', '-c', '1', '-r', '16000', '-b', '16', f, ...silence] };
    if (has('ffmpeg')) {
        const input = os.platform() === 'darwin' ? ['-f', 'avfoundation', '-i', ':default']
            : os.platform() === 'linux' ? ['-f', 'alsa', '-i', 'default']
                : ['-f', 'dshow', '-i', 'audio=default'];
        return { name: 'ffmpeg', build: (f) => ['-y', '-hide_banner', '-loglevel', 'error', ...input, '-ac', '1', '-ar', '16000', '-t', '15', f] };
    }
    return null;
}

/* ── transcriber detection ── */
function detectSTT() {
    if (process.env.GROQ_API_KEY) return { name: 'groq', kind: 'api', url: 'https://api.groq.com/openai/v1/audio/transcriptions', model: 'whisper-large-v3', key: process.env.GROQ_API_KEY };
    if (process.env.OPENAI_API_KEY) return { name: 'openai', kind: 'api', url: 'https://api.openai.com/v1/audio/transcriptions', model: 'whisper-1', key: process.env.OPENAI_API_KEY };
    if (has('whisper')) return { name: 'whisper', kind: 'cli', bin: 'whisper' };
    if (has('whisper-cli')) return { name: 'whisper-cli', kind: 'cli', bin: 'whisper-cli' };
    return null;
}

let _rec = undefined, _stt = undefined;
const recorder = () => (_rec === undefined ? (_rec = detectRecorder()) : _rec);
const stt = () => (_stt === undefined ? (_stt = detectSTT()) : _stt);

function record(file) {
    const rec = recorder();
    return new Promise((resolve, reject) => {
        const p = spawn(rec.name, rec.build(file), { stdio: ['ignore', 'ignore', 'ignore'] });
        p.on('error', reject);
        p.on('exit', () => (fs.existsSync(file) ? resolve(file) : reject(new Error('no audio captured'))));
        // Safety cap so a stuck recorder can't hang the REPL forever.
        setTimeout(() => { try { p.kill(); } catch { /* */ } }, 30_000);
    });
}

async function transcribe(file) {
    const s = stt();
    if (s.kind === 'api') {
        const fd = new FormData();
        fd.append('file', new Blob([fs.readFileSync(file)]), 'audio.wav');
        fd.append('model', s.model);
        fd.append('response_format', 'json');
        const res = await fetch(s.url, { method: 'POST', headers: { Authorization: `Bearer ${s.key}` }, body: fd });
        if (!res.ok) throw new Error(`${s.name} STT failed: ${res.status} ${(await res.text()).slice(0, 160)}`);
        return ((await res.json()).text || '').trim();
    }
    // local CLI → writes <file>.txt next to the audio
    const out = path.dirname(file);
    execSync(`${s.bin} ${JSON.stringify(file)} --model base --output_format txt --output_dir ${JSON.stringify(out)} --language en`, { stdio: 'ignore' });
    const txt = file.replace(/\.\w+$/, '') + '.txt';
    return fs.existsSync(txt) ? fs.readFileSync(txt, 'utf8').trim() : '';
}

export const listen = {
    available() { return !!recorder() && !!stt(); },
    engine() { return { recorder: recorder()?.name || 'none', stt: stt()?.name || 'none' }; },

    /** Human-readable explanation of what's missing and how to fix it. */
    reason() {
        if (!recorder()) return os.platform() === 'darwin'
            ? 'No recorder found. Install one:  brew install sox'
            : 'No recorder found. Install sox (apt install sox) or ffmpeg.';
        if (!stt()) return 'No speech-to-text found. Set GROQ_API_KEY (free at console.groq.com) or OPENAI_API_KEY, or install local whisper.';
        return 'ready';
    },

    /** Record one utterance and return the transcript (''  if nothing heard). */
    async captureAndTranscribe() {
        if (!this.available()) throw new Error(this.reason());
        const file = path.join(os.tmpdir(), `echo-listen-${Date.now()}.wav`);
        try {
            await record(file);
            return await transcribe(file);
        } finally {
            try { fs.unlinkSync(file); } catch { /* */ }
            try { fs.unlinkSync(file.replace(/\.\w+$/, '') + '.txt'); } catch { /* */ }
        }
    },
};
