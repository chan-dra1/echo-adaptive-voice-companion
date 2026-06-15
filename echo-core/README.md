# Echo Core — the terminal brain

Echo Core is the **daemon** that runs Echo in your terminal *and* keeps the
web dashboard in sync. One process holds the shared state; the terminal REPL
and the web UI are both windows onto it.

```
        ┌──────────────── ECHO CORE (this) ────────────────┐
        │  encrypted store · task LLM (Ollama-first) · WS  │
        └───────────┬──────────────────────────┬───────────┘
            terminal REPL                 web dashboard
         (type to Echo here)         (the ECHO VOID PWA)
                    └────────── stay in sync ──────────┘
```

## Run it

```bash
cd echo-core
npm install
npm start          # or: node echo.mjs
```

You'll see a banner with:
- the **sync hub** address (`ws://127.0.0.1:8770`)
- the **dashboard** URL (if you've run `npm run build` in the app, it's served here)
- the available **task LLM**
- a **pairing token**

In the web dashboard: **⌘K → "Connect Echo Core"** → paste the token. Now
anything you make in the terminal appears in the dashboard's Files panel
live, and vice-versa.

## Terminal usage

```
echo> draft email: thank a client for a great meeting
        ✓ draft saved (via ollama) — now in the dashboard
        Hi Jordan, thank you so much for...

echo> what's a good name for a coffee brand?
Echo (ollama): A few directions...

echo> /drafts        list saved drafts
echo> /providers     show available task LLMs
echo> /clients       connected dashboard clients
echo> /help          all commands
echo> /quit
```

## Task LLM (Ollama-first, BYO-key)

Out of the box it uses **Ollama** (local, free, offline). Install once:

```bash
# https://ollama.com
ollama serve
ollama pull llama3
```

To use a cloud provider instead, set an env var (or add the key in the web
Vault — they share config):

| Provider | Env var |
|---|---|
| Groq | `GROQ_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |
| OpenAI-compatible | `OPENAI_API_KEY` (+ `OPENAI_BASE_URL`) |
| Mistral | `MISTRAL_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |

Preference order is **free/local first**; on quota exhaustion (429) it
auto-fails-over to the next available provider, and only errors when all are
out.

## Storage & security

- All state lives in `~/.echo-core/state.enc`, **AES-256-GCM encrypted**.
- The data key is auto-generated at `~/.echo-core/key` (mode 600) on first run.
- The sync hub binds to `127.0.0.1` only and requires the token.
- Nothing leaves your machine.

## Voice (Phase 2)

Echo **talks back in the terminal** using your OS voice (macOS `say`, Linux
`spd-say`/`espeak`, Windows SAPI) — zero extra dependencies. Toggle with
`/voice on|off`.

The conversation is **shared both ways**:
- You speak in the **web** (Gemini Live) → the turn appears live in the
  terminal (`🎙 You (web voice): …`).
- You type in the **terminal** → Echo speaks it aloud *and* the response
  shows up in the web dashboard.

Audio routing avoids double-speak: the surface that generated a response is
the one that voices it; the other surface just shows the transcript.

## Proactive: reminders & daily briefing

Because Core runs 24/7, it can act on its own — the thing a browser can't:

```
echo> /remind 8am call the dentist
echo> /remind in 10m stretch
echo> /briefing every day at 8am      # spoken briefing every morning
echo> /briefing                       # run one right now
echo> /schedule                       # list everything · /unschedule <id>
```

When a job fires, Echo speaks it in the terminal **and** pushes a notification
to the dashboard (OS notification + toast), even if the tab is in the
background. The briefing folds in today's reminders, **open tasks**, waiting
drafts, your latest campaign, **live weather**, a **news headline**, and — if
Home Assistant is configured — a smart-home status line ("all doors locked,
garage closed").

Natural-language times include `8am` · `in 10m` · `in 3 days` · `friday` ·
`by tuesday 5pm` · `tomorrow 9am` · `every day at 8am`.

## Tasks & research

```
echo> /task pay rent in 3 days !      # ! = priority; due date parsed from text
echo> /task email landlord by tuesday
echo> /tasks                          # open tasks, soonest due first
echo> /done <id>                      # check one off
echo> /research who won the F1 race   # live web search → cited answer (spoken)
```

Tasks surface in the daily briefing. `/research` is keyless (DuckDuckGo) and
optionally uses `TAVILY_API_KEY`; it reads the top results and summarises with
your task LLM, citing sources.

## Memory

Echo remembers durable facts and recalls the relevant ones on each turn
(offline keyword recall — no embeddings, no cloud):

```
echo> remember my dog is Mango, a corgi
echo> what breed is my dog?            → uses the fact
echo> /memories                        # list · /forget <id>
```

## Talk to Echo in the terminal

```
echo> /listen        # hold a short utterance, pause to finish
```

Needs a recorder (`brew install sox`) and speech-to-text — either a key
(`GROQ_API_KEY`, free at console.groq.com, or `OPENAI_API_KEY`) or a local
`whisper` binary (fully offline). Without them, `/listen` tells you exactly
what to install. The spoken line runs through the same brain as typing, so you
can remember, draft, and ask by voice.

## What's in vs coming

**Now:** shared encrypted store · terminal REPL · Ollama-first task LLM ·
terminal voice in/out · two-way conversation sync · proactive reminders +
daily briefing · memory/recall · smart-home status in briefings · live sync of
drafts/campaigns/projects/memories/schedules · static serving of the dashboard.

**Next:** porting the full web skill set (RAG, project ops, campaigns) into the
daemon so the terminal has every capability the web does.
