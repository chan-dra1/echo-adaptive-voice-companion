import type { Scenario } from '../scenario';
import { geminiTextResponse } from '../mockLlm';
import { resetLocalStorage } from '../shims';

/**
 * If a skill is registered with agentSkillService but agentSkillService.getTools()
 * or echoChatService's request assembly ever stops forwarding those schemas
 * to the model, every skill in the app silently becomes unreachable — the
 * model would just never be offered the tool. This scenario registers one
 * throwaway skill and checks its FunctionDeclaration actually reaches the
 * outbound Gemini request as `tools[0].functionDeclarations[]`.
 */
const scenario: Scenario = {
    name: 'tool_schemas_included',
    description:
        'A tool registered via agentSkillService.registerSkill() shows up in the ' +
        "outbound model request's tools[].functionDeclarations, in Gemini wire format.",

    async run(t, mock) {
        resetLocalStorage();
        localStorage.setItem('echo_api_key', 'test-gemini-key');

        const { echoChatService } = await import('../../services/echoChatService');
        const { agentSkillService } = await import('../../services/agentSkillService');
        const { Type } = await import('@google/genai');

        echoChatService.clearHistory();

        const SKILL_NAME = 'qa_get_weather';
        agentSkillService.registerSkill({
            name: 'qa_test_weather_skill',
            description: 'QA scenario throwaway skill',
            tools: [
                {
                    name: SKILL_NAME,
                    description: 'Get the current weather for a city',
                    parameters: {
                        type: Type.OBJECT,
                        properties: { city: { type: Type.STRING, description: 'City name' } },
                        required: ['city'],
                    },
                },
            ],
            execute: async () => ({ tempF: 72 }),
        });

        try {
            mock.enqueue({ kind: 'json', body: geminiTextResponse("It's sunny today.") });

            await echoChatService.sendMessage('gemini', 'unused', 'What is the weather?');

            const req = mock.requests.find(r => r.url.includes('generativelanguage.googleapis.com'));
            t.check('request went to gemini', !!req, 'no gemini request captured');
            if (!req) return;

            const tools = req.body?.tools;
            t.check('request body has a tools array', Array.isArray(tools) && tools.length > 0, `body.tools: ${JSON.stringify(tools)}`);
            const decls = tools?.[0]?.functionDeclarations;
            t.check('tools[0].functionDeclarations is an array', Array.isArray(decls), `got: ${JSON.stringify(tools?.[0])}`);

            const names = Array.isArray(decls) ? decls.map((d: any) => d.name) : [];
            t.check(`registered tool "${SKILL_NAME}" is present in outbound schemas`, names.includes(SKILL_NAME), `saw: ${JSON.stringify(names)}`);
        } finally {
            agentSkillService.unregisterSkill('qa_test_weather_skill');
        }
    },
};

export default scenario;
