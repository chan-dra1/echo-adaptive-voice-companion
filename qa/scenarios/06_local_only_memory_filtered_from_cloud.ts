import type { Scenario } from '../scenario';
import { openAiTextResponse } from '../mockLlm';
import { resetLocalStorage } from '../shims';

/**
 * modelContextBuilder.buildSystemContext() is supposed to strip
 * `sensitivity: 'local_only'` memories out of the system prompt whenever the
 * destination is a cloud provider (see services/modelContextBuilder.ts,
 * `destination === 'cloud'` filter). This is a genuine privacy guarantee —
 * a regression here means private facts the user marked "keep this local"
 * get sent to a third-party cloud LLM API. Every text-chat provider except
 * Ollama is `destination: 'cloud'` (see llmRouter.destinationFor), so this
 * matters for the vast majority of real usage.
 */
const scenario: Scenario = {
    name: 'local_only_memory_filtered_from_cloud',
    description:
        "A memory saved with sensitivity 'local_only' never reaches a cloud provider's " +
        "system prompt, while a 'cloud_ok' memory does.",

    async run(t, mock) {
        resetLocalStorage();
        localStorage.setItem('echo_groq_key', 'test-groq-key');

        const { echoChatService } = await import('../../services/echoChatService');
        const { saveMemory, clearMemories } = await import('../../services/memoryService');

        echoChatService.clearHistory();
        clearMemories();
        saveMemory('secret_health_note', 'QA_SECRET_MARKER_do_not_leak', 'local_only');
        saveMemory('favorite_color', 'QA_PUBLIC_MARKER_blue', 'cloud_ok');

        mock.enqueue({ kind: 'json', body: openAiTextResponse('Got it.') });

        await echoChatService.sendMessage('groq', 'unused', 'hi');

        const req = mock.requests.find(r => r.url.includes('api.groq.com'));
        const systemMsg = req?.body?.messages?.find((m: any) => m.role === 'system');
        t.check('system message present', !!systemMsg, 'no system message in request');

        t.check(
            'local_only memory is ABSENT from the cloud-bound system prompt',
            !String(systemMsg?.content ?? '').includes('QA_SECRET_MARKER_do_not_leak'),
            'PRIVACY LEAK: local_only memory content appeared in a cloud-provider request',
        );
        t.includes('cloud_ok memory IS present in the system prompt', systemMsg?.content, 'QA_PUBLIC_MARKER_blue');

        clearMemories();
    },
};

export default scenario;
