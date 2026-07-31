import type { Scenario } from '../scenario';
import { openAiToolCallResponse } from '../mockLlm';
import { resetLocalStorage } from '../shims';

/**
 * echoChatService caps tool round-trips at MAX_TOOL_HOPS (4 in the current
 * source) specifically so a confused model that just keeps calling tools
 * can't loop forever / burn unbounded API spend. This scenario scripts a
 * model that ALWAYS wants to call a tool, on every single turn, and checks
 * the loop actually stops at the cap rather than looping indefinitely (which
 * would hang this test) or overshooting it.
 */
const scenario: Scenario = {
    name: 'tool_loop_hop_cap',
    description:
        'A model that always returns a tool call causes exactly MAX_TOOL_HOPS (4) ' +
        'model calls and MAX_TOOL_HOPS-1 (3) tool executions, then the loop terminates.',

    async run(t, mock) {
        resetLocalStorage();
        localStorage.setItem('echo_groq_key', 'test-groq-key');

        const { echoChatService } = await import('../../services/echoChatService');
        const { agentSkillService } = await import('../../services/agentSkillService');
        const { Type } = await import('@google/genai');

        echoChatService.clearHistory();

        const TOOL_NAME = 'qa_infinite_tool';
        let executionCount = 0;
        agentSkillService.registerSkill({
            name: 'qa_test_infinite_skill',
            description: 'QA scenario throwaway skill that the mock model calls every turn',
            tools: [
                {
                    name: TOOL_NAME,
                    description: 'A tool the (mock) model is scripted to always call',
                    parameters: { type: Type.OBJECT, properties: {}, required: [] },
                },
            ],
            execute: async () => {
                executionCount++;
                return { ok: true, hop: executionCount };
            },
        });

        try {
            // Hops 1-3 are offered tools, and this model always calls one.
            for (let i = 0; i < 3; i++) {
                mock.enqueue({ kind: 'json', body: openAiToolCallResponse(TOOL_NAME, {}, `call_${i}`) });
            }
            // Hop 4 is the capped hop: echoChatService withholds tools, so a
            // real model has no choice but to answer in text. The mock mirrors
            // that. Two extra tool-call responses sit behind it as a tripwire —
            // if the cap ever regresses and a 5th call happens, it consumes one
            // of these and the "exactly 4 model calls" check fails loudly
            // instead of erroring out on an empty queue.
            mock.enqueue({
                kind: 'json',
                body: { choices: [{ message: { role: 'assistant', content: 'Here is what I found so far.' } }] },
            });
            for (let i = 0; i < 2; i++) {
                mock.enqueue({ kind: 'json', body: openAiToolCallResponse(TOOL_NAME, {}, `overflow_${i}`) });
            }

            const startedAt = Date.now();
            const reply = await echoChatService.sendMessage('groq', 'unused', 'Do the thing forever');
            const elapsedMs = Date.now() - startedAt;

            const groqCalls = mock.requests.filter(r => r.url.includes('api.groq.com'));
            t.equal('exactly 4 model calls were made (MAX_TOOL_HOPS)', groqCalls.length, 4);
            t.equal('exactly 3 tool executions happened (hops before the last)', executionCount, 3);
            t.check('the loop actually terminated (did not hang)', elapsedMs < 5000, `took ${elapsedMs}ms`);

            // Tools must be offered on every hop EXCEPT the last. Withholding
            // them on the final hop is what stops the model burning its last
            // turn on a call there's no budget to execute — which previously
            // surfaced to the user as the bare string "No response."
            const toolsPerCall = groqCalls.map(r => Array.isArray((r.body as any)?.tools) && (r.body as any).tools.length > 0);
            t.check('tools offered on hops 1-3', toolsPerCall.slice(0, 3).every(Boolean), JSON.stringify(toolsPerCall));
            t.check('tools WITHHELD on the final hop', toolsPerCall[3] === false, JSON.stringify(toolsPerCall));
            t.check('user gets real text, not the "No response." placeholder', reply !== 'No response.', `reply=${JSON.stringify(reply)}`);
        } finally {
            agentSkillService.unregisterSkill('qa_test_infinite_skill');
        }
    },
};

export default scenario;
