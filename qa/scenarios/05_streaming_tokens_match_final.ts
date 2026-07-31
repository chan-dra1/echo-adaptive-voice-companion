import type { Scenario } from '../scenario';
import { resetLocalStorage } from '../shims';

/**
 * echoChatService.sendMessage(onToken) is what the chat UI uses to render
 * incremental text as it arrives. If the SSE parsing in llmRouter ever
 * drifts (wrong field path, off-by-one on frame boundaries, etc), tokens
 * could stop arriving, arrive duplicated, or stop matching the final
 * returned string — the UI would visibly break or show garbled text. This
 * scenario scripts a real OpenAI-compat SSE stream and checks the
 * concatenation of every onToken delta exactly equals the final result.
 */
const scenario: Scenario = {
    name: 'streaming_tokens_match_final',
    description:
        'chatStream (via echoChatService onToken) emits incremental deltas whose ' +
        'concatenation exactly equals the final returned reply text, over a real SSE mock.',

    async run(t, mock) {
        resetLocalStorage();
        localStorage.setItem('echo_groq_key', 'test-groq-key');

        const { echoChatService } = await import('../../services/echoChatService');
        echoChatService.clearHistory();

        mock.enqueue({
            kind: 'sse',
            events: [
                { choices: [{ delta: { content: 'Hey' } }] },
                { choices: [{ delta: { content: ' there' } }] },
                { choices: [{ delta: { content: '!' } }] },
                { choices: [{ delta: { content: ' How can I help?' } }] },
            ],
        });

        const tokens: string[] = [];
        const reply = await echoChatService.sendMessage('groq', 'unused', 'hi', delta => tokens.push(delta));

        const req = mock.requests.find(r => r.url.includes('api.groq.com'));
        t.check('request went to groq', !!req, 'no groq request captured');
        t.equal('request body declares stream: true', req?.body?.stream, true);

        t.check('onToken fired more than once (genuinely incremental, not one flush)', tokens.length > 1, `tokens: ${JSON.stringify(tokens)}`);
        t.equal('token concatenation matches final reply exactly', tokens.join(''), reply);
        t.equal('final reply is the fully assembled text', reply, 'Hey there! How can I help?');
    },
};

export default scenario;
