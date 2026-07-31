import type { Scenario } from '../scenario';
import { openAiTextResponse } from '../mockLlm';
import { resetLocalStorage } from '../shims';

/**
 * A regression in modelContextBuilder or echoChatService's message assembly
 * (e.g. accidentally dropping the system message, or reordering it after
 * history) would silently degrade Echo's personality/memory on every single
 * turn. This is the cheapest possible tripwire for that class of bug.
 */
const scenario: Scenario = {
    name: 'system_prompt_first',
    description:
        "echoChatService.sendMessage's outbound request has exactly one system " +
        'message, it is messages[0], and it contains the real Echo persona instruction.',

    async run(t, mock) {
        resetLocalStorage();
        localStorage.setItem('echo_groq_key', 'test-groq-key'); // OpenAI-compat wire format keeps 'system' as a literal message role (unlike Gemini, which moves it to system_instruction) — that's what this scenario needs to see.

        const { echoChatService } = await import('../../services/echoChatService');
        echoChatService.clearHistory();

        mock.enqueue({ kind: 'json', body: openAiTextResponse('Hey! Good to hear from you.') });

        const reply = await echoChatService.sendMessage('groq', 'unused', 'Hello Echo, how are you?');

        t.check('LLM call was made', mock.requests.length >= 1, `got ${mock.requests.length} requests`);
        const req = mock.requests.find(r => r.url.includes('api.groq.com'));
        t.check('request went to groq', !!req, 'no groq request captured');
        if (!req) return;

        const messages = req.body?.messages;
        t.check('request body has a messages array', Array.isArray(messages), `body: ${JSON.stringify(req.body)}`);
        if (!Array.isArray(messages)) return;

        const systemMessages = messages.filter((m: any) => m.role === 'system');
        t.equal('exactly one system message', systemMessages.length, 1);
        t.equal('system message is messages[0]', messages[0]?.role, 'system');
        t.includes('system message contains Echo persona instruction', messages[0]?.content, 'Echo,');
        t.includes('system message contains role description', messages[0]?.content, 'personal AI companion');
        t.check('reply text returned', typeof reply === 'string' && reply.length > 0, `reply: ${JSON.stringify(reply)}`);
    },
};

export default scenario;
