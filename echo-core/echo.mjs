#!/usr/bin/env node
/**
 * echo.mjs — Echo Core entry point. One command, the whole brain.
 *
 *   $ node echo.mjs           (or: npm start, or the `echo` bin)
 *
 * Boots:
 *   • the encrypted shared store          (store.mjs)
 *   • the task brain (Ollama-first LLM)   (llm.mjs)
 *   • the WS sync hub for the dashboard   (sync.mjs)
 *   • a static server for the built web   (serves ../dist if present)
 *   • an interactive terminal REPL
 *
 * Everything created in the terminal is broadcast to the web dashboard live,
 * and vice-versa. The web client connects with the printed token.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.mjs';
import { createLLM } from './llm.mjs';
import { startSyncHub } from './sync.mjs';
import { voice } from './voice.mjs';
import { createScheduler, parseWhen, describeWhen, splitReminder } from './scheduler.mjs';
import { createMemory, extractRemember } from './memory.mjs';
import { createTasks } from './tasks.mjs';
import { listen } from './listen.mjs';
import * as research from './research.mjs';
import * as smarthome from './smarthome.mjs';
import * as weather from './weather.mjs';
import * as news from './news.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_PORT = Number(process.env.ECHO_WEB_PORT || 3030);

const ECHO_SYSTEM = `You are Echo, a concise, capable personal AI agent running in the user's terminal.
Be direct and useful. When asked to draft something (email, reply, post, message), write the final text only.
You run on the user's own machine; their data stays local.`;

const C = { dim: '\x1b[2m', grn: '\x1b[32m', cyn: '\x1b[36m', yel: '\x1b[33m', red: '\x1b[31m', rst: '\x1b[0m', b: '\x1b[1m' };

/* ── static web server (optional) ── */
function serveDist() {
    const dist = path.resolve(__dirname, '..', 'dist');
    if (!fs.existsSync(dist)) return null;
    const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.mjs': 'text/javascript' };
    const srv = http.createServer((req, res) => {
        let p = decodeURIComponent((req.url || '/').split('?')[0]);
        let fp = path.join(dist, p);
        if (!fp.startsWith(dist)) { res.writeHead(403); return res.end(); }
        if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) fp = path.join(dist, 'index.html'); // SPA fallback
        fs.readFile(fp, (err, buf) => {
            if (err) { res.writeHead(404); return res.end('Not found'); }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
            res.end(buf);
        });
    });
    srv.listen(WEB_PORT, '127.0.0.1');
    return srv;
}

async function main() {
    const store = await openStore();
    const llm = createLLM(store);
    const mem = createMemory(store);
    const tasks = createTasks(store);

    // Task handler shared by REPL + web 'ask' actions. Injects any remembered
    // facts relevant to this turn so the brain stays personal across restarts.
    async function ask(text) {
        const recent = store.all('history').slice(-6).flatMap(h => [
            { role: 'user', content: h.q }, { role: 'assistant', content: h.a },
        ]);
        const facts = mem.recall(text, 5);
        const system = facts.length
            ? `${ECHO_SYSTEM}\n\nKnown facts about the user (use when relevant):\n${facts.map(f => `- ${f}`).join('\n')}`
            : ECHO_SYSTEM;
        const res = await llm.chat({ system, messages: [...recent, { role: 'user', content: text }] });
        store.add('history', { q: text, a: res.text, provider: res.provider });
        return res;
    }

    // When the web has a spoken turn, surface it in the terminal so both
    // sides share one conversation. We only PRINT here — the browser already
    // played Echo's audio, so we don't double-speak on the same machine.
    const onVoiceTurn = (role, text) => {
        const tag = role === 'assistant' ? `${C.cyn}🔊 Echo${C.rst}` : `${C.grn}🎙  You${C.rst}`;
        process.stdout.write(`\n${tag} ${C.dim}(web voice)${C.rst}: ${text}\n${C.grn}echo>${C.rst} `);
    };

    const hub = startSyncHub(store, {
        onAsk: ask,
        onVoiceTurn,
        onExecLog: (cmd) => process.stdout.write(`\n${C.yel}⚡ exec${C.rst}: ${C.dim}${cmd}${C.rst}\n${C.grn}echo>${C.rst} `),
        onWriteLog: (fp) => process.stdout.write(`\n${C.cyn}📝 wrote${C.rst}: ${C.dim}${fp}${C.rst}\n${C.grn}echo>${C.rst} `),
    });
    const web = serveDist();

    /* ── briefing + scheduler ── */
    // A deterministic spoken briefing built from the shared store (reliable
    // even when the LLM is offline), plus an optional smart-home line.
    async function composeBriefing() {
        const now = new Date();
        const hr = now.getHours();
        const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
        const parts = [`${greet}. It's ${now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.`];

        const tomorrow = new Date(now); tomorrow.setHours(0, 0, 0, 0); tomorrow.setDate(tomorrow.getDate() + 1);
        const reminders = store.all('schedules').filter(j =>
            j.kind === 'reminder' && j.enabled !== false &&
            (j.when?.kind === 'daily' || (j.when?.kind === 'once' && j.when.at < tomorrow.getTime())));
        parts.push(reminders.length
            ? `${reminders.length} reminder${reminders.length > 1 ? 's' : ''} today: ${reminders.map(r => r.message).join('; ')}.`
            : 'No reminders on the books for today.');

        const drafts = store.all('drafts');
        if (drafts.length) parts.push(`${drafts.length} draft${drafts.length > 1 ? 's' : ''} waiting in your files.`);
        const campaigns = store.all('campaigns');
        if (campaigns.length) parts.push(`Latest campaign: ${campaigns[campaigns.length - 1].brand}.`);

        const taskLine = tasks.summaryLine();
        if (taskLine) parts.push(taskLine);

        try { const ha = await smarthome.statusLine(); if (ha) parts.push(ha); } catch { /* ignore */ }
        try { const wx = await weather.statusLine(); if (wx) parts.push(wx); } catch { /* ignore */ }
        try { const top = await news.statusLine(); if (top) parts.push(top); } catch { /* ignore */ }
        return parts.join(' ');
    }

    // Fire a due job: print in terminal, speak it, mirror to the dashboard.
    async function deliver(job) {
        const text = job.kind === 'briefing' ? await composeBriefing() : job.message;
        const label = job.kind === 'briefing' ? 'Briefing' : 'Reminder';
        process.stdout.write(`\n${C.yel}⏰ ${label}${C.rst}: ${text}\n${C.grn}echo>${C.rst} `);
        voice.speak(text);
        hub.speak(text);
        hub.notify(label, text);
    }

    const sched = createScheduler(store, { deliver });
    sched.start();

    // Shared handling for a non-command line — typed OR spoken (via /listen).
    // Routes to: remember a fact · draft something · or ask Echo.
    async function handleInput(input) {
        const fact = extractRemember(input);
        if (fact) {
            const m = mem.remember(fact);
            console.log(`${C.grn}  ✓ got it — I'll remember that.${C.rst} ${C.dim}(${m.id})${C.rst}\n`);
            voice.speak("Got it, I'll remember that.");
            return;
        }
        const dm = input.match(/^draft\s+(\w+)\s*:\s*(.+)$/i);
        try {
            process.stdout.write(`${C.dim}  …thinking${C.rst}\r`);
            if (dm) {
                const kind = dm[1].toLowerCase();
                const instr = dm[2];
                const res = await llm.chat({ system: ECHO_SYSTEM, messages: [{ role: 'user', content: `Write a ${kind}. ${instr}. Output only the final text.` }] });
                const draft = store.add('drafts', { kind, title: instr.slice(0, 60), content: res.text });
                console.log(`${C.grn}  ✓ draft saved${C.rst} ${C.dim}(${draft.id}, via ${res.provider}) — now in the dashboard${C.rst}\n`);
                console.log(res.text + '\n');
                voice.speak(`Draft ready. ${res.text}`);
                hub.speak(res.text);
            } else {
                const res = await ask(input);
                console.log(`${C.cyn}Echo${C.rst} ${C.dim}(${res.provider})${C.rst}: ${res.text}\n`);
                voice.speak(res.text);     // terminal generated it → terminal voices it
                hub.speak(res.text);       // web shows the transcript
            }
        } catch (e) {
            console.log(`${C.red}  ✗ ${e.message}${C.rst}\n`);
        }
    }

    /* ── banner ── */
    const providers = llm.listAvailable();
    console.log(`
${C.grn}${C.b}  ███████╗ ██████╗██╗  ██╗ ██████╗ ${C.rst}
${C.grn}${C.b}  ██╔════╝██╔════╝██║  ██║██╔═══██╗${C.rst}
${C.grn}${C.b}  █████╗  ██║     ███████║██║   ██║${C.rst}   ${C.dim}core · terminal + web, in sync${C.rst}
${C.grn}${C.b}  ██╔══╝  ██║     ██╔══██║██║   ██║${C.rst}
${C.grn}${C.b}  ███████╗╚██████╗██║  ██║╚██████╔╝${C.rst}
${C.grn}${C.b}  ╚══════╝ ╚═════╝╚═╝  ╚═╝ ╚═════╝ ${C.rst}

  ${C.cyn}sync hub${C.rst}   ws://127.0.0.1:${hub.port}
  ${C.cyn}dashboard${C.rst}  ${web ? `http://127.0.0.1:${WEB_PORT}` : `${C.dim}(run "npm run build" in the app to serve the dashboard here)${C.rst}`}
  ${C.cyn}task LLM${C.rst}   ${providers.length ? providers.join(', ') : `${C.yel}ollama (start it: ollama serve && ollama pull llama3)${C.rst}`}
  ${C.cyn}voice${C.rst}      ${voice.isAvailable() ? `${voice.engineName()} ${C.dim}(Echo speaks here · /voice off to mute)${C.rst}` : `${C.dim}none (no OS TTS found)${C.rst}`}
  ${C.cyn}pair web${C.rst}   token: ${C.dim}${hub.token}${C.rst}

  ${C.dim}Type a request, or /help. Try: /remind 8am call mom · /briefing every day at 8am${C.rst}
  ${C.dim}Anything you make here shows up in the dashboard live.${C.rst}
`);

    /* ── headless mode: no terminal attached, just stay up as a service ──
     * Stdin tricks (piping from /dev/null, backgrounding without a TTY) make
     * readline hit EOF immediately, which used to call process.exit(0) and
     * kill the whole server seconds after boot. ECHO_HEADLESS=1 skips the
     * REPL entirely — the HTTP + WS servers above keep the event loop alive
     * on their own, so the process just runs until you stop it. */
    if (process.env.ECHO_HEADLESS === '1') {
        console.log(`  ${C.dim}running headless (no terminal input) — stop with: kill ${process.pid}${C.rst}\n`);
        return;
    }

    /* ── REPL ── */
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: `${C.grn}echo>${C.rst} ` });
    rl.prompt();

    // Process lines strictly one at a time (a promise queue), so async handlers
    // can't interleave even when input is piped in as a single chunk.
    let queue = Promise.resolve();
    rl.on('line', (line) => { queue = queue.then(() => onLine(line)).catch((e) => console.error(e)); });

    async function onLine(line) {
        const input = line.trim();
        if (!input) { rl.prompt(); return; }

        // commands
        if (input.startsWith('/')) {
            const [cmd, ...rest] = input.slice(1).split(' ');
            switch (cmd) {
                case 'help':
                    console.log(`${C.dim}  /remind <when> <msg>   e.g. /remind 8am call mom · /remind in 10m stretch
  /briefing [when]       run a briefing now, or schedule it (every day at 8am)
  /schedule              list scheduled reminders & briefings
  /unschedule <id>       cancel one
  remember <fact>        remember something ("remember my dog is Mango")
  /memories              list what Echo remembers · /forget <id>
  /task <text>           add a to-do ("/task pay rent tomorrow")
  /tasks · /done <id>    list open tasks · mark one done
  /research <query>      search the web and get a cited answer
  /listen                talk to Echo with your mic (needs sox + a whisper key)
  /drafts                list saved drafts
  /campaigns             list saved campaigns
  /providers             show available task LLMs
  /voice on|off          toggle Echo speaking aloud
  /clients               connected dashboard clients
  /quit                  exit
  draft <kind>: ...      draft an email/reply/post and save it
  <anything else>        ask Echo${C.rst}`);
                    break;
                case 'drafts': {
                    const d = store.all('drafts').slice(-15).reverse();
                    console.log(d.length ? d.map(x => `  ${C.cyn}${x.id}${C.rst} ${x.title} ${C.dim}(${x.kind})${C.rst}`).join('\n') : `${C.dim}  no drafts yet${C.rst}`);
                    break;
                }
                case 'campaigns': {
                    const c = store.all('campaigns').slice(-15).reverse();
                    console.log(c.length ? c.map(x => `  ${C.cyn}${x.id}${C.rst} ${x.brand}`).join('\n') : `${C.dim}  no campaigns yet${C.rst}`);
                    break;
                }
                case 'providers':
                    console.log(`  ${llm.listAvailable().join(', ') || 'ollama (not verified)'}`);
                    break;
                case 'voice': {
                    const arg = (rest[0] || '').toLowerCase();
                    if (arg === 'off') { voice.setEnabled(false); console.log(`${C.dim}  voice muted${C.rst}`); }
                    else if (arg === 'on') { voice.setEnabled(true); console.log(`${C.dim}  voice on (${voice.engineName()})${C.rst}`); }
                    else console.log(`${C.dim}  voice is ${voice.isEnabled() ? 'on' : 'off'} (${voice.engineName()}). /voice on|off${C.rst}`);
                    break;
                }
                case 'remind': {
                    const { whenPhrase, message } = splitReminder(rest.join(' '));
                    const when = parseWhen(whenPhrase);
                    try {
                        const job = sched.add({ kind: 'reminder', message, when });
                        console.log(`${C.grn}  ✓ reminder set${C.rst} ${C.dim}(${describeWhen(job.when)}): ${job.message}${C.rst}`);
                    } catch (e) { console.log(`${C.yel}  ${e.message}${C.rst}`); }
                    break;
                }
                case 'briefing': {
                    if (rest.length) { // schedule it, e.g. /briefing every day at 8am
                        const when = parseWhen(rest.join(' '));
                        if (when) { const j = sched.add({ kind: 'briefing', when }); console.log(`${C.grn}  ✓ briefing scheduled${C.rst} ${C.dim}(${describeWhen(j.when)})${C.rst}`); break; }
                        console.log(`${C.yel}  couldn't parse that time — running briefing now${C.rst}`);
                    }
                    const text = await composeBriefing();
                    console.log(`${C.cyn}  ${text}${C.rst}`); voice.speak(text); hub.speak(text);
                    break;
                }
                case 'schedule': case 'schedules': {
                    const jobs = sched.list();
                    console.log(jobs.length ? jobs.map(j => `  ${C.cyn}${j.id}${C.rst} ${C.dim}[${describeWhen(j.when)}]${C.rst} ${j.kind === 'briefing' ? 'daily briefing' : j.message}`).join('\n') : `${C.dim}  nothing scheduled. Try /remind 8am call mom${C.rst}`);
                    break;
                }
                case 'unschedule': case 'cancel': {
                    const id = rest[0];
                    console.log(id && sched.remove(id) ? `${C.dim}  removed ${id}${C.rst}` : `${C.yel}  usage: /unschedule <id>  (see /schedule)${C.rst}`);
                    break;
                }
                case 'remember': {
                    try { const m = mem.remember(rest.join(' ')); console.log(`${C.grn}  ✓ remembered${C.rst} ${C.dim}(${m.id})${C.rst}`); }
                    catch (e) { console.log(`${C.yel}  ${e.message}${C.rst}`); }
                    break;
                }
                case 'memories': case 'memory': {
                    const m = mem.all().slice(-20).reverse();
                    console.log(m.length ? m.map(x => `  ${C.cyn}${x.id}${C.rst} ${x.text}`).join('\n') : `${C.dim}  nothing remembered yet. Try: remember my dog's name is Mango${C.rst}`);
                    break;
                }
                case 'forget': {
                    const id = rest[0];
                    console.log(id && mem.forget(id) ? `${C.dim}  forgot ${id}${C.rst}` : `${C.yel}  usage: /forget <id>  (see /memories)${C.rst}`);
                    break;
                }
                case 'research': {
                    const query = rest.join(' ').trim();
                    if (!query) { console.log(`${C.dim}  usage: /research <query>${C.rst}`); break; }
                    process.stdout.write(`${C.dim}  …researching "${query}"${C.rst}\r`);
                    try {
                        const { text, sources } = await research.answer(query, llm);
                        console.log(`${C.cyn}  ${text}${C.rst}\n`);
                        if (sources?.length) { console.log(`${C.dim}  sources:${C.rst}`); for (const s of sources) console.log(`${C.dim}    • ${s.title} — ${s.url}${C.rst}`); }
                        voice.speak(text); hub.speak(text);
                    } catch (e) { console.log(`${C.red}  ✗ ${e.message}${C.rst}`); }
                    break;
                }
                case 'task': {
                    try {
                        const t = tasks.add(rest.join(' '));
                        const due = t.due ? ` ${C.dim}(due ${describeWhen(t.due)})${C.rst}` : '';
                        console.log(`${C.grn}  ✓ task added${C.rst} ${C.dim}(${t.id})${C.rst}: ${t.text}${t.priority ? ` ${C.yel}!${C.rst}` : ''}${due}`);
                    } catch (e) { console.log(`${C.yel}  ${e.message}${C.rst}`); }
                    break;
                }
                case 'tasks': {
                    const open = tasks.list();
                    if (!open.length) { console.log(`${C.dim}  no open tasks. Add one: /task pay rent tomorrow${C.rst}`); break; }
                    for (const t of open) {
                        const due = t.due ? ` ${C.dim}— ${describeWhen(t.due)}${C.rst}` : '';
                        console.log(`  ${C.cyn}${t.id}${C.rst}  ${t.text}${t.priority ? ` ${C.yel}!${C.rst}` : ''}${due}`);
                    }
                    break;
                }
                case 'done': {
                    const t = tasks.complete(rest[0]);
                    console.log(t ? `${C.grn}  ✓ done:${C.rst} ${t.text}` : `${C.yel}  usage: /done <id>  (see /tasks)${C.rst}`);
                    break;
                }
                case 'listen': case 'mic': {
                    if (!listen.available()) { console.log(`${C.yel}  ${listen.reason()}${C.rst}`); break; }
                    const eng = listen.engine();
                    process.stdout.write(`${C.grn}  🎙  listening…${C.rst} ${C.dim}(speak, then pause · ${eng.recorder}→${eng.stt})${C.rst}\r`);
                    let heard = '';
                    try { heard = await listen.captureAndTranscribe(); }
                    catch (e) { console.log(`\n${C.red}  ✗ ${e.message}${C.rst}`); break; }
                    if (!heard) { console.log(`\n${C.dim}  (heard nothing)${C.rst}`); break; }
                    console.log(`\n${C.grn}  🎙  you${C.rst}: ${heard}`);
                    // Route the spoken line through the same handling as typed input.
                    await handleInput(heard);
                    break;
                }
                case 'clients':
                    console.log(`  ${hub.clientCount()} dashboard client(s) connected`);
                    break;
                case 'quit': case 'exit':
                    console.log(`${C.dim}  bye.${C.rst}`); rl.close(); process.exit(0);
                default:
                    console.log(`${C.yel}  unknown command. /help${C.rst}`);
            }
            rl.prompt();
            return;
        }

        await handleInput(input);
        rl.prompt();
    }

    // On EOF (e.g. piped input), let any in-flight queued work finish before exit.
    rl.on('close', () => { Promise.resolve(queue).then(() => process.exit(0)); });
}

main().catch((e) => { console.error('Echo Core failed to start:', e); process.exit(1); });
