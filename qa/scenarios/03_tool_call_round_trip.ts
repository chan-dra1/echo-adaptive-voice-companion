import type { Scenario } from '../scenario';
import { openAiTextResponse, openAiToolCallResponse } from '../mockLlm';
import { resetLocalStorage } from '../shims';

/**
 * The core of Echo's agentic behavior: when the model responds with a tool
 * call, echoChatService must actually execute the matching skill, then send
 * a SECOND model call whose messages include the tool result in the wire
 * format that provider expects (OpenAI-compat: a `{role:'tool', tool_call_id,
 * content}` message). If this breaks, skills silently become "the model
 * asked but nothing happened" instead of executing.
 */
const scenario: Scenario = {
    name: 'tool_call_round_trip',
    description:
        'A scripted tool-call response causes the real skill to execute, and the ' +
        'follow-up model call contains the tool result correctly wired to the tool_call_id.',

    async run(t, mock) {
        resetLocalStorage();
        localStorage.setItem('echo_groq_key', 'test-groq-key');

        const { echoChatService } = await import('../../services/echoChatService');
        const { agentSkillService } = await import('../../services/agentSkillService');
        const { Type } = await import('@google/genai');

        echoChatService.clearHistory();

        const TOOL_NAME = 'qa_lookup_order_status';
        let executedWith: any = null;
        agentSkillService.registerSkill({
            name: 'qa_test_order_skill',
            description: 'QA scenario throwaway skill',
            tools: [
                {
                    name: TOOL_NAME,
                    description: 'Look up an order status by id',
                    parameters: {
                        type: Type.OBJECT,
                        properties: { orderId: { type: Type.STRING } },
                        required: ['orderId'],
                    },
                },
            ],
            execute: async (toolName, args) => {
                executedWith = { toolName, args };
                return { status: 'shipped', eta: '2026-08-02' };
            },
        });

        try {
            mock.enqueue(
                { kind: 'json', body: openAiToolCallResponse(TOOL_NAME, { orderId: 'ORD-42' }, 'call_xyz') },
                { kind: 'json', body: openAiTextResponse('Your order ORD-42 has shipped, arriving Aug 2.') },
            );

            const reply = await echoChatService.sendMessage('groq', 'unused', 'Where is my order ORD-42?');

            const groqCalls = mock.requests.filter(r => r.url.includes('api.groq.com'));
            t.equal('exactly 2 model calls were made (tool hop + final)', groqCalls.length, 2);
            if (groqCalls.length < 2) return;

            t.check('skill.execute was actually invoked', executedWith !== null, 'execute() was never called');
            t.equal('skill was invoked with the model-provided args', executedWith?.args?.orderId, 'ORD-42');

            const secondCallMessages = groqCalls[1].body?.messages ?? [];
            const assistantToolMsg = secondCallMessages.find((m: any) => m.role === 'assistant' && m.tool_calls?.length);
            t.check('follow-up call includes the assistant tool-call message', !!assistantToolMsg, `messages: ${JSON.stringify(secondCallMessages)}`);
            t.equal(
                'assistant tool_call id matches what the model sent',
                assistantToolMsg?.tool_calls?.[0]?.id,
                'call_xyz',
            );

            const toolResultMsg = secondCallMessages.find((m: any) => m.role === 'tool');
            t.check('follow-up call includes a tool-result message', !!toolResultMsg, `messages: ${JSON.stringify(secondCallMessages)}`);
            t.equal('tool-result message is wired to the correct tool_call_id', toolResultMsg?.tool_call_id, 'call_xyz');
            t.includes('tool-result content contains the real execute() output', toolResultMsg?.content, 'shipped');

            t.equal('final reply text is the second model response', reply, 'Your order ORD-42 has shipped, arriving Aug 2.');
        } finally {
            agentSkillService.unregisterSkill('qa_test_order_skill');
        }
    },
};

export default scenario;
