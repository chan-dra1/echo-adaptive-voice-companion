# Tier 3 Build Handoff — for the parallel agent

> **You are building Tier 3 of Echo's "all-in-one SaaS-killer" roadmap, in parallel with another agent building Tier 2.** You start with no shared memory of the planning conversation — this file is your complete brief. Read it fully before writing code.

---

## 1. What Echo is

Echo is a voice-first personal AI agent (web PWA + a Node "Echo Core" terminal daemon). The product goal: **one agent that replaces a ~$585/mo stack of SaaS subscriptions** so the user never pays for them separately. Each "module" we build targets a real money-making SaaS category.

- **Web app**: React + TypeScript + Vite + Tailwind. Entry `App.tsx`. Agent skills live in `skills/`, services in `services/`.
- **Echo Core**: Node.js daemon in `echo-core/` (WebSocket hub on `:8770`). Runs autonomous "missions" and does anything the browser can't (server-side API calls that browsers block via CORS). Files are `.mjs` (ES modules, Node).
- The agent (Gemini) calls **skills** — each skill is a set of tool functions. Skills DON'T have their own LLM; the agent IS the LLM. So for "generate" features, the agent writes the content and the skill persists/acts on it.

### Already shipped
- **Tier 1**: Social Autopilot, Outreach Engine, Content Studio, Automation Hub.
- **Tier 2** (in progress by the other agent): Meeting Copilot, Inbox Agent, Career Suite, SEO Intelligence.

---

## 2. ⚡ Coordination rules — READ THIS or you WILL clobber the other agent

Both agents share this workspace. To avoid editing the same files at the same time:

### Files YOU own (create freely)
- `skills/<yourName>Skill.ts` — your new skill files
- `components/<YourName>.tsx` — your new UI components (only if you build panels)
- `skills/tier3Skills.ts` — **your registration file** (already stubbed for you)

### How to register your skills — DO NOT touch `agentBootstrap.ts`
`services/agentBootstrap.ts` is owned by the Tier 2 agent. It already imports `skills/tier3Skills.ts` and registers everything in its default-export array. So to activate a Tier 3 skill, you ONLY edit `skills/tier3Skills.ts`:

```ts
import storefrontSkill from './storefrontSkill';
const tier3Skills: Skill[] = [ storefrontSkill ];
export default tier3Skills;
```

That's it — no other shared-file edit needed for skills.

### Files you must NOT edit (Tier 2 / shared — coordinate or you'll conflict)
- `services/agentBootstrap.ts` — register via `tier3Skills.ts` instead (above).
- `App.tsx` — **shared, high-conflict.** If a module needs a UI panel, STRONGLY prefer doing it on a **separate git branch** (see §6). If you must add to `App.tsx` on the same branch, keep additions in one contiguous block clearly marked `{/* ── TIER 3 ── */}` and tell the user so the other agent rebases around it.
- `echo-core/*` — if a module needs server-side execution (CORS-blocked APIs), create a NEW file `echo-core/<yourName>.mjs` and note in your final report that the Core WS handler wiring (`sync.mjs`) needs a small manual merge. Do NOT edit `echo-core/sync.mjs`, `echo.mjs`, `missionRunner.mjs`, or `socialPoster.mjs` directly.

### When in doubt
New file = safe. Editing an existing shared file = stop and use a git branch (§6).

---

## 3. Architecture conventions (match these exactly)

Look at `skills/socialSkill.ts` and `skills/contentSkill.ts` as reference implementations.

- **Skill shape** (`services/agentSkillService.ts`): `{ name: string; description: string; tools: FunctionDeclaration[]; execute(toolName, args): Promise<any> }`. `export default yourSkill`.
- Import `FunctionDeclaration, Type` from `'@google/genai'`. Use the `Type.*` enum (`Type.OBJECT`, `Type.STRING`, `Type.ARRAY`, `Type.NUMBER`, `Type.BOOLEAN`) for schema types — **never string literals** (causes TS errors).
- **Credentials**: store in `localStorage` under an `echo_*` key. Resolve as `args.key || localStorage.getItem('echo_x')`. Never hardcode secrets.
- **CORS reality**: most third-party POST APIs (OpenAI, most paid APIs) block direct browser calls. For those, route through Echo Core. Helpers in `services/echoCoreSync.ts`: `isCoreConnected()`, `coreAdd(collection, item)`, `coreWriteFile(path, content)`, `coreExec(cmd)`, `coreReadFile(path)`. CORS-friendly APIs (many public GET APIs) can be called directly with `fetch`.
- **Persistence to dashboard**: `coreAdd('drafts', { kind, title, content, source })`.
- **Error style**: every `execute` ends with `return { error: \`Unknown tool: ${toolName}\` };`. Wrap external `fetch` so non-OK returns `{ error: \`...${res.status}...\` }` with a sliced (≤200 char) detail.
- **Descriptions matter**: the agent decides when to call a tool from its `description` — make them rich and action-oriented.

### 🔒 Hard security constraint (non-negotiable)
Echo must **never clone, download, learn from, or read private/credentialed/secured repositories** or any gated/private data source. Lead/data tools must use only public information and say so. Don't add anything that scrapes private data.

---

## 4. Tier 3 module specs (build these)

Build them one at a time; register each in `tier3Skills.ts` and `npm run build` before moving on. You don't have to build all four — prioritize Lead Enrichment + Support Agent (most self-contained), then the bigger two.

### 4a. Lead Enrichment — `skills/leadEnrichmentSkill.ts` (kills 1Lookup ~$223k MRR business)
Public-data lookup/validation. Tools:
- `validate_email` — syntax + MX-record check. Use the public DNS-over-HTTPS API `https://dns.google/resolve?name=<domain>&type=MX` (CORS-friendly GET) to confirm the domain accepts mail. Return `{ email, valid_syntax, has_mx, deliverable_guess }`.
- `enrich_company` — given a domain, fetch public favicon/title/meta via `coreReadFile`? no — use a public endpoint or `http_request` through Core. Return public company basics. Public data only.
- `validate_url` / `check_domain` — reachability + basic info.
Start with `validate_email` (fully works browser-side via dns.google). Self-contained, no Core required.

### 4b. Support Agent — `skills/supportAgentSkill.ts` (kills Intercom/Zendesk-lite)
An embeddable support assistant config + canned-response manager for the user's OWN customers.
- `save_support_kb` — store FAQ/knowledge-base entries (localStorage `echo_support_kb`).
- `answer_support_question` — match a customer question against the saved KB (simple keyword/scoring match, pure function) and return the best answer + confidence; the agent can then refine it.
- `list_support_kb` / `export_support_widget` — return an embeddable HTML snippet the user can paste on their site (string template; no network).

### 4c. Creator Storefront — `skills/storefrontSkill.ts` (Stan = $3.57M MRR category)
Generate a link-in-bio / digital-product storefront page.
- `save_storefront` — store profile + links + products (localStorage `echo_storefront`).
- `generate_storefront_html` — pure function returning a complete, self-contained responsive HTML page (inline CSS) from the saved config; optionally `coreWriteFile` it to `~/Desktop/storefront.html`. This is the deliverable the user hosts anywhere.
- Optionally a `components/StorefrontEditor.tsx` panel (UI — see §2 about App.tsx; prefer a branch).

### 4d. Media Studio — `skills/mediaStudioSkill.ts` (kills Vid.AI / image SaaS)
AI image/video generation via API (user's key).
- `generate_image` — call an image API with the user's key from `localStorage`. **OpenAI images and most providers block browser CORS → route through Echo Core** (`coreExec` a curl, or create `echo-core/mediaStudio.mjs` + note the WS wiring needs merge). Save result URL/file. Return `{ success, url|file }`.
- Gate clearly behind a saved API key; return a helpful error if missing.
- This is the most infra-heavy module — do it last.

---

## 5. How to verify your work
- Web/TS: `npm run build` (must end `✓ built`). Zero new TS errors.
- Any `echo-core/*.mjs` you add: `node --check echo-core/<file>.mjs`. ⚠️ Watch for `*/` sequences inside `/** */` block comments — they close the comment early and cause syntax errors (this bit us once).
- Confirm your skill is in `skills/tier3Skills.ts`'s exported array.

## 6. Recommended: work on a git branch (cleanest isolation)
To never collide with the Tier 2 agent, run Tier 3 on its own branch:
```bash
git checkout -b tier-3
# ...build, commit...
```
Then the user merges `tier-3` into the Tier 2 branch at the end. This is the safest path if you need to touch any shared file (especially `App.tsx`). If you stay on the same branch, stick to NEW files + `tier3Skills.ts` only.

## 7. Where to start
1. Read this file + skim `skills/socialSkill.ts` and `skills/contentSkill.ts`.
2. (Recommended) `git checkout -b tier-3`.
3. Build `skills/leadEnrichmentSkill.ts` (fully self-contained, no Core needed).
4. Add it to `skills/tier3Skills.ts`. Run `npm run build`.
5. Repeat for Support Agent → Storefront → Media Studio.
6. Report which files you created and any shared-file merges still needed.
