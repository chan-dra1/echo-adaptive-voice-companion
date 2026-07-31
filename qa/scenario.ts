import type { Checks } from './check';
import type { MockLlm } from './mockLlm';

/**
 * Declarative scenario format.
 *
 * Why plain .ts and not YAML: the whole point of this harness is to call
 * REAL Echo services (`echoChatService.sendMessage`, `llmRouter.chat`,
 * `agentSkillService.registerSkill`) and script a mock fetch layer with
 * provider-shaped wire responses (Gemini `functionCall` parts, OpenAI
 * `tool_calls` deltas, SSE frames, etc). Expressing "call this function,
 * then enqueue this exact response object" in YAML would mean inventing a
 * small DSL/interpreter for something TypeScript already expresses directly
 * and type-safely — and it's one more npm dependency (a YAML parser) in a
 * repo that has none today. A plain .ts scenario file with a `run()`
 * function stays declarative in spirit (name, description, ordered
 * checks) without that cost.
 */
export interface Scenario {
    name: string;
    description: string;
    run: (t: Checks, mock: MockLlm) => Promise<void>;
}
