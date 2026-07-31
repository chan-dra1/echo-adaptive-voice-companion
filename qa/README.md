# Echo QA — behavioral eval harness

Echo has ~100 skills and a multi-file system-prompt assembly pipeline
(`services/modelContextBuilder.ts` → `services/echoChatService.ts` →
`services/llmRouter.ts` → `services/agentSkillService.ts`), and until now
there was no automated way to tell when a change to that pipeline silently
breaks agent behavior — dropped system prompt, tool schemas no longer sent,
a leaked `local_only` memory, a tool loop that no longer terminates, etc.

This harness runs Echo's **real, unmodified** services against a **mock LLM
provider** that intercepts `fetch`, so scenarios assert on the *exact
outbound request payload* the app would have sent to Gemini / Groq /
OpenRouter / etc, and script back provider-shaped responses (including
multi-turn tool-call sequences and SSE streams). Nothing in `services/` or
`components/` is modified or reimplemented — everything under `qa/` is new.

## Running it

```sh
npx tsx qa/run.ts
```

No build step, no test framework installed (by design — see "Why no
Jest/Vitest" below). Prints `OK`/`FAIL` per assertion, grouped by scenario,
and exits with a nonzero code if anything failed (so it's CI-friendly: `npx
tsx qa/run.ts || exit 1`).

Example tail of output:

```
33 checks, 33 passed, 0 failed across 6 scenarios (0 with failures)
```

## How it works

- **`qa/shims.ts`** — installs the minimal browser globals
  (`localStorage`, `window`) Echo's services read. Must be the first thing
  `qa/run.ts` imports, since ES module imports evaluate in source order and
  several `services/*` modules read these globals at import time via
  transitive imports.
- **`qa/mockLlm.ts`** — `MockLlm`, a drop-in replacement for `fetch`.
  Records every outbound request (`mock.requests[]`, with parsed JSON
  body) and returns scripted responses from a queue (`mock.enqueue(...)`),
  in Gemini (`candidates[].content.parts`), OpenAI-compat
  (`choices[].message` / SSE `delta`), or raw-error shapes. Non-LLM traffic
  (e.g. `archiveService`'s local disk-save POST) is recorded separately and
  gets a harmless 404, matching what actually happens when no local dev
  server is running.
- **`qa/check.ts`** — a tiny assertion collector (`Checks`). Deliberately
  not throw-based: a scenario can register many checks and see all of them
  reported even if an early one fails, instead of stopping at the first
  thrown assertion.
- **`qa/scenario.ts`** — the `Scenario` type (`name`, `description`,
  `run(t, mock)`).
- **`qa/scenarios/*.ts`** — the actual scenarios (see below).
- **`qa/run.ts`** — the runner. Imports shims, then each scenario, resets
  `localStorage` and the mock between scenarios, runs them in sequence, and
  prints a summary.

### Why plain `.ts` scenarios instead of YAML

The task that produced this harness (see git history) called out OpenClaw's
`qa/scenarios` YAML approach as inspiration but explicitly allowed `.ts`
scenarios instead, to avoid adding a YAML-parsing dependency to a repo that
currently has none. Scenarios need to: call a real async service function,
register a throwaway skill via `agentSkillService`, script an exact
sequence of provider-shaped mock responses (including function/objects, not
just strings), and then run type-safe assertions against a parsed request
body. Expressing all of that in YAML would mean inventing a small
interpreter for something TypeScript already expresses directly. A plain
`.ts` file exporting `{ name, description, run() }` keeps the same
declarative shape (one file per scenario, one purpose, readable diff) without
that cost.

## Current scenarios

1. **`01_system_prompt_first`** — `echoChatService.sendMessage()`'s
   outbound request has exactly one `role: 'system'` message, it is
   `messages[0]`, and its content is the real Echo persona instruction (not
   a stub). Catches: system prompt dropped, reordered after history, or
   swapped for something else.
2. **`02_tool_schemas_included`** — a skill registered via
   `agentSkillService.registerSkill()` actually shows up in the outbound
   Gemini request as `tools[0].functionDeclarations[]`. Catches: a skill
   silently becoming unreachable because its schema stops being forwarded.
3. **`03_tool_call_round_trip`** — a scripted tool-call response causes the
   real skill's `execute()` to run with the model-provided args, and the
   **second** model call's messages contain both the assistant's
   `tool_calls` entry and a `{role:'tool', tool_call_id, content}` message
   correctly wired to the same call id, with the real execute() output
   inside it. Catches: tool execution not happening, or the result not
   making it back to the model (or being wired to the wrong call id).
4. **`04_tool_loop_hop_cap`** — a model that requests a tool call on
   *every* turn causes exactly `MAX_TOOL_HOPS` (4) model calls and
   `MAX_TOOL_HOPS - 1` (3) tool executions, then the loop terminates
   (asserted against a wall-clock timeout so a regression here fails fast
   instead of hanging the test). Catches: the hop cap being removed/raised,
   which would let a confused model loop indefinitely and burn API spend.
5. **`05_streaming_tokens_match_final`** — a real SSE-shaped OpenAI-compat
   mock stream produces more than one `onToken` delta, and the
   concatenation of every delta exactly equals the final returned reply
   text. Catches: SSE frame-parsing regressions in `llmRouter.chatStream`
   that would garble or truncate what the chat UI renders live.
6. **`06_local_only_memory_filtered_from_cloud`** — a memory saved with
   `sensitivity: 'local_only'` never appears in the system prompt sent to a
   cloud provider (Groq here), while a `cloud_ok` memory does. Catches: a
   privacy regression in `modelContextBuilder.buildSystemContext()`'s
   cloud-destination filter that would leak data the user explicitly marked
   "keep this local" to a third-party API.

## Adding a scenario

1. Create `qa/scenarios/NN_your_scenario_name.ts` exporting a default
   `Scenario` (see `qa/scenario.ts` for the type, and any existing scenario
   for the shape).
2. Call `resetLocalStorage()` from `qa/shims.ts` at the top of `run()`, then
   set whatever `localStorage` keys the code path needs (e.g.
   `echo_groq_key` to make `chooseProvider('groq')` succeed).
3. `mock.enqueue({ kind: 'json' | 'sse' | 'error', ... })` one scripted
   response per outbound model call you expect, in order. Use the
   `geminiTextResponse` / `geminiToolCallResponse` / `openAiTextResponse` /
   `openAiToolCallResponse` helpers from `qa/mockLlm.ts` to build correctly
   shaped bodies instead of hand-rolling them.
4. Call into the real service (`echoChatService.sendMessage(...)`,
   `chat(...)`/`chatStream(...)` from `services/llmRouter`, etc).
5. Assert against `mock.requests` (each has `.url`, `.body` — parsed JSON —
   `.headers`) using the `t.check(name, condition, detail)` / `t.equal(...)`
   / `t.includes(...)` helpers from `qa/check.ts`.
6. If you registered a skill via `agentSkillService.registerSkill()`, unregister
   it in a `finally` block — the registry is a process-wide singleton shared
   across all scenarios in the same run.
7. Add the import + array entry in `qa/run.ts`.
8. Run `npx tsx qa/run.ts` and confirm your new checks print `OK`.

## Why no Jest/Vitest

Per the constraints this harness was built under: no new npm dependencies
(no test framework is installed in this repo today), and no `npm install`
during development (concurrent work in `services/`/`components/` would make
installs unstable). `qa/run.ts` is a ~90-line self-contained runner — enough
for OK/FAIL-per-assertion reporting and a nonzero exit code, which is all a
CI gate needs. If the project later adopts Vitest for unit tests, this
harness's scenarios could be ported with minimal changes (the `Checks`
collector maps almost 1:1 to `expect()` calls); until then, this stays
dependency-free.

## Notes on running in a browser-targeted codebase

`services/*.ts` files assume `localStorage`/`window`/`import.meta.env`
exist (they're Vite/browser modules). `qa/shims.ts` polyfills only the
handful of globals actually touched by the import chain this harness
exercises (`llmRouter` → `echoChatService` → `agentSkillService` →
`modelContextBuilder` → `memoryService`/`companionPersonaService`/etc). It
does **not** attempt to shim IndexedDB, Web Workers, or Supabase — those
subsystems (`ragService`'s vector DB, `dynamicSkillService`'s sandboxed
skill execution, Echo Cloud auth) are outside this harness's current scope
and aren't imported by the scenarios above. `agentBootstrap.ts` (which
registers Echo's ~100 real skills, pulling in that entire dependency graph)
is intentionally never imported here — scenarios register small throwaway
skills directly via `agentSkillService.registerSkill()` instead, which is
enough to exercise the real tool-calling contract without needing every
skill's own dependencies to also run under Node.
