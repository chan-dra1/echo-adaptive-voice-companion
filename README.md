<div align="center">

# ECHO
### Adaptive Voice Companion

**A 24/7 personal AI agent that lives in your browser, hears your voice, controls your computer, and never sleeps.**

[![Gemini Live API](https://img.shields.io/badge/Gemini%20Live-API-4285F4?style=flat-square&logo=google&logoColor=white)](https://ai.google.dev)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev)
[![PWA](https://img.shields.io/badge/PWA-ready-5A0FC8?style=flat-square)](https://web.dev/progressive-web-apps/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

</div>

---

Echo is a **real-time voice AI companion** powered by Google Gemini Live. It listens, thinks, speaks, and acts — running entirely in the browser as a Progressive Web App, installable on any device. Through an optional local daemon called **Echo Hands**, it gains full shell access to your Mac: building and deploying projects, cloning and learning from repos, controlling your smart home, and executing any task you can describe by voice.

> *Think less assistant, more resident agent. Echo is always on, always learning, and always within earshot.*

---

## What Echo Can Do

### Real-Time Voice Intelligence
- **Bidirectional audio streaming** via Gemini Live WebSocket — sub-second response latency
- **Live transcription** — your speech and Echo's responses appear on screen as they happen
- **Barge-in** — interrupt Echo mid-sentence, it adjusts immediately
- **Ambient conversation policy** — Echo ducks its own audio when it detects you're talking to someone else
- **Screen share + camera** — share your screen or point your webcam; Echo sees and comments in real time
- **Browser voice fallback** — works fully offline with the Web Speech API (no API key needed, free and local)

### Memory & Personalized Learning
- **Persistent long-term memory** — remembers your preferences, goals, context, and facts across sessions
- **RAG knowledge vault** — upload PDFs, docs, or paste URLs; Echo embeds and retrieves them locally
- **Personalized learning engine** — adapts vocabulary, tone, and pace to your speech patterns over time
- **Session summaries** — automatically distills long conversations into compact, searchable context
- **AES-GCM-256 encryption** — all stored data is encrypted at rest; nothing leaves the device in plaintext

### Echo Hands — Local Execution Daemon

The optional daemon gives Echo real "hands" on your computer. All operations are **localhost-only (127.0.0.1)**, token-authenticated, and workspace-jailed to `$HOME`.

```
you:  "Build me a landing page for my coffee brand and deploy it to Vercel"
echo: → scaffolds HTML/CSS/JS → git init → gh repo create → vercel --prod → reads you the live URL
```

| Daemon Tool | What it does |
|---|---|
| `run_command` | Execute shell commands (hard denylist blocks rm -rf, sudo, dd, fork bombs) |
| `read_file` / `write_file` | Read and write files within workspace |
| `create_project` | Scaffold a complete multi-file project under `~/EchoProjects` |
| `list_projects` / `read_dir_files` | Browse and download full project trees |
| `clone_repo` | Clone **public-only** GitHub/GitLab repos for learning (private repos silently refused) |
| `scan_repo` | Scan cloned code: 8-pattern secret redaction + 8-heuristic malware detection before any code reaches the model |
| `system_info` | CPU, memory, hostname, uptime |

### Smart Home — Home Assistant Integration

Connect Echo to your smart home via [Home Assistant](https://www.home-assistant.io). All traffic stays on your LAN — zero cloud middleman for device control.

```
"Turn off all the lights"              → ha_call_service
"Is the front door locked?"            → ha_get_state
"Show me the backyard camera"          → ha_get_camera_snapshot → piped to Gemini vision
"Set the thermostat to 72"             → ha_call_service
"What smart devices do I have?"        → ha_list_entities
```

Supported HA domains: `light`, `switch`, `lock`, `climate`, `scene`, `automation`, `cover`, `media_player`, `alarm_control_panel`, `fan`, `vacuum`, and any custom domain.

**Sensitive operations** (unlock, disarm) require explicit browser confirmation before executing.

### Content & UGC Campaign Studio

```
"Create a UGC campaign for my skincare brand targeting Gen Z on TikTok"
```

Echo generates a complete structured deliverable:
- Brand positioning + big creative idea
- 8-12 scroll-stopping hook variations (first 3 seconds)
- 3-5 full UGC scripts with shot-by-shot visual directions and CTAs
- 2-week posting calendar with captions and hashtag sets
- Saved to encrypted local store + `~/EchoProjects/campaigns/` + downloadable as Markdown

### Planning & Execution

- **Monthly planner** — turn a list of goals into a structured 30-day execution plan by voice
- **Feature ticket pipeline** — spec, prioritize, and track product features in conversation
- **Market watch** — read-only price and trend lookups for crypto, stocks, and FX
- **Task & mission tracking** — break large goals into tracked subtasks with status
- **Deadline guardian** — auto-generates phase-based milestones, sends personality-aware nudges

### Pluggable Skills

Echo ships with a typed skill system — each skill exposes strongly-typed Gemini function-call declarations:

| Skill | Capability |
|---|---|
| `draftsSkill` | Draft emails, replies, social posts — saved encrypted + downloadable |
| `resumeSkill` | Build or tailor a resume to a specific job description |
| `jobHuntSkill` | Research companies, prep targeted interview questions |
| `ghostSkill` | Ghost-write long-form content in your voice |
| `fileGenSkill` | Generate PDFs, DOCX, spreadsheets |
| `flightSkill` | Search and compare flight options |
| `webSkill` | Live web search grounded via Google Search tool |
| `screenIntelSkill` | Analyze shared screen content, answer questions about what Echo sees |
| `calcSkill` | Math, unit conversion, financial calculations |
| `marketingPlannerSkill` | Full marketing strategy documents |
| `projectOpsSkill` | Agile-style project ops, sprint planning |
| `taskMissionSkill` | Break missions into subtasks, track progress |

### GitHub Skill Learning

Echo can learn new capabilities directly from open-source code:

```
"Learn how to use the Stripe API from their official SDK repo"
```

- Confirms with you before cloning anything
- **Only public `github.com` / `gitlab.com` repos over HTTPS** — private repos, SSH URLs, and credential-bearing URLs are blocked at the gate
- 8-pattern **secret redaction** strips keys, tokens, and private keys before code reaches the model
- 8-heuristic **malware scan** refuses repos containing reverse shells, miners, eval-of-base64, curl-pipe-to-shell patterns
- 80 MB size cap — oversized repos refused
- Learned code is **never executed** — read-only study

### Files & Downloads

Everything Echo generates is accessible in the **Echo Files panel** (slide in from right):

- **Drafts** — individual Markdown download or bulk `.zip`
- **Campaigns** — individual Markdown download or bulk `.zip`
- **Projects** — full source tree per project, bundled via a dependency-free STORE-method zip builder (CRC-32 verified)
- **Download Everything** — single `.zip` with all artifacts, organized by type
- Works fully without the daemon for drafts and campaigns; projects require Echo Hands

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         Browser (PWA)                            │
│                                                                  │
│  ┌──────────────────┐   ┌────────────────────┐  ┌────────────┐  │
│  │  SingularityCore  │   │  GeminiLiveService  │  │ FilesPanel │  │
│  │  (ECHO VOID UI)   │   │  WebSocket ↕ Gemini │  │  /download │  │
│  │  Metatron orb     │   │  function dispatch  │  └────────────┘  │
│  │  waveform canvas  │   └────────────────────┘                  │
│  └──────────────────┘             │                              │
│                                   │                              │
│  ┌────────────────────────────────▼─────────────────────────┐   │
│  │                       Service Layer                       │   │
│  │  memoryService · cryptoService · artifactsService         │   │
│  │  campaignStudioService · draftsSkill · smartHomeService   │   │
│  │  handsBridgeService · projectModeService · ragService     │   │
│  │  monthlyPlannerService · marketWatchService · ...         │   │
│  └───────────────────────────┬───────────────────────────────┘  │
└──────────────────────────────│──────────────────────────────────┘
                               │ ws://127.0.0.1:8765
                               │ Token-authenticated
                     ┌─────────▼────────────────┐
                     │    Echo Hands Daemon      │
                     │    (Node.js / ESM)        │
                     │                           │
                     │  shell  ·  files  ·  git  │
                     │  Home Assistant REST API  │
                     │  repo clone + secret scan │
                     └─────────┬────────────────┘
                               │
                     ┌─────────▼────────────────┐
                     │   Your Machine / LAN      │
                     │  ~/EchoProjects           │
                     │  ~/EchoSkillsLab          │
                     │  Home Assistant instance  │
                     └──────────────────────────┘
```

**Key design decisions:**

- **PWA-first, no Electron** — runs in any Chromium browser, installable on desktop and mobile, no app store required
- **Gemini Live API** — bidirectional audio over WebSocket; Echo hears and responds in the same breath, not turn-by-turn
- **Daemon is additive** — all conversational features work without it; the daemon unlocks shell, file, and smart home powers
- **Encrypted at rest** — all memory, drafts, and campaigns use AES-GCM-256 via the browser's native SubtleCrypto API; nothing is stored in plaintext
- **No service worker in dev** — the SW is registered only in production builds; in dev it actively unregisters itself to prevent stale-cache blank screens
- **node_modules outside iCloud** — symlinked to `~/.echo-modules` to prevent iCloud Drive from evicting or corrupting Vite's binary

---

## Quick Start

### Prerequisites

- Node.js 18+
- A [Google AI Studio](https://aistudio.google.com) API key (Gemini Live access)
- Chrome, Edge, or Arc (WebSocket + Web Audio required)

### 1. Clone and install

```bash
git clone https://github.com/yourusername/echo-adaptive-voice-companion.git
cd echo-adaptive-voice-companion
npm install
```

### 2. Set your API key

```bash
# Create .env in the project root
echo "VITE_GEMINI_API_KEY=your_key_here" > .env
```

### 3. Start

```bash
npm run dev
# Open http://localhost:3000
```

Grant microphone access, then click **Connect**. Echo is live.

---

## Echo Hands Setup

The daemon gives Echo shell and file powers on your machine.

```bash
cd echo-daemon
npm install
npm start
```

On first run it generates a random 24-byte token:

```
╔══════════════════════════════════════════════════════╗
║  ECHO HANDS — local execution daemon                 ║
╠══════════════════════════════════════════════════════╣
║  Listening : ws://127.0.0.1:8765                     ║
║  Token: a3f9c2b1...                                  ║
╚══════════════════════════════════════════════════════╝
```

In Echo: press **⌘K** → **Connect Echo Hands** → paste the token.

---

## Smart Home Setup

1. Run [Home Assistant](https://www.home-assistant.io/installation/) on your local network (Raspberry Pi, NUC, or Mac Mini)
2. In HA: **Profile → Long-Lived Access Tokens → Create Token**
3. Start the Echo Hands daemon
4. Tell Echo: *"Configure Home Assistant"* and provide your HA URL and token **via the text command bar** (do not speak your token aloud)

Echo tests the connection and confirms the HA version. After that, full voice control is live.

---

## Security Model

| Concern | How Echo handles it |
|---|---|
| **API key** | Stored in `.env` / Vite env — never committed, never in browser storage |
| **HA token** | Stored in `~/.echo-hands/ha-config.json` (chmod 600) inside the daemon — never reaches the browser |
| **Data at rest** | AES-GCM-256 encryption for all stored memory, drafts, and campaigns via native SubtleCrypto |
| **Shell access** | Hard denylist: blocks `rm -rf /~`, `sudo`, `dd`, `mkfs`, `shutdown`, fork bombs, disk erasure |
| **Repo learning** | Only `https://github.com` and `https://gitlab.com` — SSH, credentialed URLs, and all other hosts refused |
| **Private repos** | Credential helpers disabled + `GIT_ASKPASS=/usr/bin/false` — private repos fail silently, never prompt |
| **Secret scanning** | 8 regex patterns strip PEM keys, AWS/GCP/Slack/GitHub/JWT/OpenAI tokens before excerpts reach Gemini |
| **Malware detection** | 8 heuristics: reverse shells, netcat exec, crypto miners, curl-pipe-to-shell, eval-of-base64, remote download+run |
| **Network exposure** | Daemon binds `127.0.0.1` only — zero inbound exposure |
| **Lock / alarm ops** | `ha_call_service` for unlock/disarm requires `window.confirm()` in the browser before executing |

---

## UI — ECHO VOID

The home screen is built around **Metatron's Cube** — a sacred geometry SVG orb (7 circles, 21 connecting lines) with three animated orbital rings, a 128-point audio-reactive waveform canvas, live transcription captions via direct DOM mutation (no React re-renders), and a Matrix-style data stream background.

| State | Color | Trigger |
|---|---|---|
| STANDBY | `#6C5CE7` violet | Idle, daemon not connected |
| ONLINE | `#00CFFF` cyan | Connected, ready to listen |
| LISTENING | `#00FF88` green | Picking up your voice |
| PROCESSING | `#FFB700` amber | Gemini is thinking |
| SPEAKING | `#FF2D78` magenta | Echo is responding |

Mouse parallax (perspective 700px, ±9° tilt), CSS glitch transitions on state changes, and a 220-star canvas field complete the aesthetic.

---

## Project Structure

```
echo-adaptive-voice-companion/
├── components/
│   ├── SingularityCore.tsx      ECHO VOID home screen (Metatron orb + waveform)
│   ├── FilesPanel.tsx           Download panel — drafts, campaigns, projects
│   ├── CompanionPanel.tsx       Settings, memory, habits, goals
│   ├── CommandPalette.tsx       ⌘K command bar
│   ├── RAGPanel.tsx             Knowledge vault — upload + semantic search
│   └── ...
├── services/
│   ├── geminiLiveService.ts     WebSocket session + all tool dispatch
│   ├── handsBridgeService.ts    Daemon WebSocket bridge
│   ├── smartHomeService.ts      Home Assistant tool declarations
│   ├── campaignStudioService.ts UGC campaign generator + storage
│   ├── artifactsService.ts      Unified download + dependency-free zip builder
│   ├── githubSkillService.ts    Public repo learning with safety gates
│   ├── projectModeService.ts    Voice-driven build + deploy pipeline
│   ├── monthlyPlannerService.ts 30-day execution plan generator
│   ├── memoryService.ts         Long-term encrypted memory
│   ├── cryptoService.ts         AES-GCM-256 vault
│   └── ...
├── skills/
│   ├── draftsSkill.ts           Draft emails, replies, posts
│   ├── resumeSkill.ts           Resume builder + tailor
│   ├── ghostSkill.ts            Long-form ghost-writing
│   ├── fileGenSkill.ts          PDF / DOCX / spreadsheet generation
│   └── ...
├── echo-daemon/
│   └── server.mjs               Node.js daemon — shell, files, HA, repo tools
└── public/                      PWA manifest + icons
```

---

## Build

```bash
npm run build   # outputs to dist/
```

Deploy `dist/` to Vercel, Netlify, Cloudflare Pages, or any static host.

---

## Roadmap

- [ ] WebLLM offline fallback — run a local model when Gemini is unreachable
- [ ] P2P CRDT sync — share context across devices with no server
- [ ] Web Workers for embedding and crypto — off the main thread
- [ ] Multi-agent orchestration — spawn sub-agents for parallel tasks
- [ ] Voice-to-code IDE integration (VS Code extension)
- [ ] iOS / Android native shell via Capacitor (optional, opt-in)
- [ ] Biometric enrollment UI
- [ ] Companion marketplace — share and install community skills

---

## Contributing

Pull requests are welcome. For major changes open an issue first.

```bash
npm run dev          # dev server with HMR
npx tsc --noEmit     # type check
npm run build        # production build
```

The daemon (`echo-daemon/`) is a standalone Node.js ESM project — `npm install` and `npm start` inside that directory.

---

## License

MIT © 2026

---

<div align="center">
  <sub>Built on Google Gemini Live API · React 19 · TypeScript · Vite · Tailwind CSS · Node.js</sub>
</div>
