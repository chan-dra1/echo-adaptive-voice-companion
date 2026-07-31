# subAgentService

Background sub-agent spawning for Echo (see module doc comment in
`subAgentService.ts` for the full design rationale). Non-blocking:
`spawnSubAgent()` returns immediately with a `SubAgentRun` handle; the run
executes its own bounded tool loop in the background and reports completion
via push events, not polling.

## Exported API

```ts
spawnSubAgent(opts: SpawnSubAgentOptions): SubAgentRun   // throws if over MAX_CONCURRENT_SUBAGENTS or MAX_SPAWN_DEPTH
subAgentService.list(): SubAgentRun[]                     // all runs, newest first
subAgentService.get(id: string): SubAgentRun | undefined
subAgentService.cancel(id: string): boolean               // cooperative — takes effect at next hop boundary
subAgentService.onChange(cb: (runs: SubAgentRun[]) => void): () => void

spawnSubAgentToolDeclaration: FunctionDeclaration          // Gemini-shape meta-tool, like proposeNewSkillToolDeclaration
executeSpawnSubAgentTool(toolName: string, args: any): Promise<any>  // tool handler
```

Also fires `window` CustomEvents: `echo:subagent:started`,
`echo:subagent:completed`, `echo:subagent:failed`, `echo:subagent:cancelled`
— each with `detail: { run: SubAgentRun }`.

## Safety caps (all in `subAgentService.ts`, easy to tune)

- `MAX_SUBAGENT_HOPS = 12` — tool round-trips per run (parent conversation is 4, see `echoChatService.MAX_TOOL_HOPS`; sub-agents get more headroom since they're off the latency path, but it's still finite).
- `MAX_CONCURRENT_SUBAGENTS = 3` — hard ceiling on simultaneous background runs; `spawnSubAgent` throws past this.
- `RUN_TIMEOUT_MS = 5 minutes` — wall-clock cap per run, independent of hop count.
- `MAX_SPAWN_DEPTH = 2` — sub-agents can spawn sub-agents, but a run at the cap simply isn't given the `spawn_sub_agent` tool, so recursion is capped structurally.

## Wiring the main session still needs to do

1. **`services/agentSkillService.ts`** (or wherever `proposeNewSkillToolDeclaration` is currently merged into the main tool list) — add `spawnSubAgentToolDeclaration` to the tools array passed to `chat`/`chatStream` in `echoChatService.ts`, alongside the existing `agentSkillService.getTools()` call.
2. **`services/echoChatService.ts`** — in the tool-execution branch of `sendMessage`'s hop loop, route calls where `tc.name === 'spawn_sub_agent'` to `executeSpawnSubAgentTool(tc.name, tc.args)` instead of `agentSkillService.executeTool(...)` (same dispatch pattern already needed for `propose_new_skill`, if that's not already handled elsewhere — check `agentBootstrap.ts`).
3. **Completion surfacing** — subscribe to `subAgentService.onChange(...)` or the `echo:subagent:completed` / `echo:subagent:failed` window events somewhere in the UI layer (e.g. a toast, or inject the result back into the chat as a new assistant/system turn) so the user actually sees sub-agent results land. This service does not push results into `echoChatService`'s history itself — that's a deliberate boundary so this file has zero dependency on chat/session state.
4. Optional: a small status panel (like `SkillsVaultPanel`) listing `subAgentService.list()` with cancel buttons, if surfacing running/completed sub-agents visually is wanted.
