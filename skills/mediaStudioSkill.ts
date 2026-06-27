import { FunctionDeclaration, Type } from '@google/genai';
import { Skill } from '../services/agentSkillService';
import { isCoreConnected, coreExec, coreWriteFile } from '../services/echoCoreSync';

const IMAGE_APIS_KEY = 'echo_image_apis';
const ALL_PROVIDERS = ['openai', 'stability', 'together'];

// ── Tool declarations ─────────────────────────────────────────────────────────

const saveImageApiKeyDeclaration: FunctionDeclaration = {
    name: 'save_image_api_key',
    description:
        "Save an AI image provider API key to local storage so Echo can generate images on your behalf. Supported providers: 'openai' (DALL-E 3), 'stability' (Stability AI), 'together' (Together AI).",
    parameters: {
        type: Type.OBJECT,
        properties: {
            provider: {
                type: Type.STRING,
                description: "The image provider: 'openai', 'stability', or 'together'.",
            },
            api_key: {
                type: Type.STRING,
                description: 'The API key to store.',
            },
        },
        required: ['provider', 'api_key'],
    },
};

const generateImageDeclaration: FunctionDeclaration = {
    name: 'generate_image',
    description:
        "Generate an AI image from a text prompt using the user's own API key — no SaaS subscription needed. Replaces Midjourney / Adobe Firefly style services. Requires Echo Core to be running (for CORS bypass). Default provider is OpenAI DALL-E 3.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            prompt: {
                type: Type.STRING,
                description: 'Detailed description of the image to generate.',
            },
            provider: {
                type: Type.STRING,
                description: "Image provider: 'openai' (default), 'stability', or 'together'.",
            },
            size: {
                type: Type.STRING,
                description:
                    "Image size. For OpenAI: '256x256', '512x512', or '1024x1024' (default). Ignored by other providers.",
            },
            style: {
                type: Type.STRING,
                description: "Image style for OpenAI DALL-E 3: 'vivid' or 'natural'.",
            },
            save_to_desktop: {
                type: Type.BOOLEAN,
                description: 'If true, download the generated image to ~/Desktop as a PNG file.',
            },
            api_key: {
                type: Type.STRING,
                description:
                    'Override API key for this request (optional — falls back to saved key).',
            },
        },
        required: ['prompt'],
    },
};

const listImageProvidersDeclaration: FunctionDeclaration = {
    name: 'list_image_providers',
    description:
        'List all supported AI image providers and show which ones have API keys configured.',
    parameters: {
        type: Type.OBJECT,
        properties: {},
        required: [],
    },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadApiKeys(): Record<string, string> {
    try {
        return JSON.parse(localStorage.getItem(IMAGE_APIS_KEY) || '{}');
    } catch {
        return {};
    }
}

function saveApiKeys(keys: Record<string, string>): void {
    localStorage.setItem(IMAGE_APIS_KEY, JSON.stringify(keys));
}

// ── Skill definition ─────────────────────────────────────────────────────────

export const mediaStudioSkill: Skill = {
    name: 'mediaStudioSkill',
    description:
        'AI image generation using your own API keys — replaces Vid.AI / Midjourney-style SaaS. Supports OpenAI DALL-E 3, Stability AI, and Together AI. Requires Echo Core running locally for CORS bypass.',
    tools: [saveImageApiKeyDeclaration, generateImageDeclaration, listImageProvidersDeclaration],

    execute: async (toolName: string, args: any): Promise<any> => {

        // ── save_image_api_key ────────────────────────────────────────────────
        if (toolName === 'save_image_api_key') {
            const provider = String(args.provider || '').toLowerCase().trim();
            const apiKey = String(args.api_key || '').trim();

            if (!ALL_PROVIDERS.includes(provider)) {
                return {
                    error: `Unknown provider '${provider}'. Valid options: ${ALL_PROVIDERS.join(', ')}.`,
                };
            }
            if (!apiKey) {
                return { error: 'api_key cannot be empty.' };
            }

            const keys = loadApiKeys();
            keys[provider] = apiKey;
            saveApiKeys(keys);

            return { saved: true, provider };
        }

        // ── generate_image ────────────────────────────────────────────────────
        if (toolName === 'generate_image') {
            const prompt: string = String(args.prompt || '').trim();
            const provider: string = String(args.provider || 'openai').toLowerCase().trim();
            const size: string = String(args.size || '1024x1024').trim();
            const style: string | undefined = args.style ? String(args.style).trim() : undefined;
            const saveToDesktop: boolean = !!args.save_to_desktop;

            if (!prompt) {
                return { error: 'A prompt is required to generate an image.' };
            }

            // Resolve API key
            const keys = loadApiKeys();
            const apiKey: string = args.api_key
                ? String(args.api_key).trim()
                : (keys[provider] || '');

            if (!apiKey) {
                return {
                    error: `No API key for provider '${provider}'. Say "save my ${provider} key <YOUR_KEY>" to get started.`,
                };
            }

            // All image APIs block browser CORS — route through Echo Core
            if (!isCoreConnected()) {
                return {
                    error:
                        'Echo Core required for image generation (browser CORS). Start echo-core/echo.mjs and pair it.',
                };
            }

            try {
                if (provider === 'openai') {
                    // Build request body — use raw prompt; JSON.stringify handles all JSON escaping
                    const bodyObj: Record<string, any> = {
                        model: 'dall-e-3',
                        prompt,
                        n: 1,
                        size,
                    };
                    if (style) bodyObj.style = style;

                    // Shell-safe: escape single quotes in the JSON body so apostrophes in
                    // prompts ("a cat's hat") don't break the single-quoted shell argument
                    const shellBody = JSON.stringify(bodyObj).replace(/'/g, "'\\''");

                    const curlCmd = `curl -s -X POST https://api.openai.com/v1/images/generations \
  -H "Authorization: Bearer ${apiKey}" \
  -H "Content-Type: application/json" \
  -d '${shellBody}'`;

                    const result = await coreExec(curlCmd);
                    if (!result.ok) {
                        return {
                            error: 'Image generation request failed.',
                            detail: result.stderr || result.error,
                        };
                    }

                    let parsed: any;
                    try {
                        parsed = JSON.parse(result.stdout || '');
                    } catch {
                        return { error: 'Could not parse OpenAI response.', raw: result.stdout };
                    }

                    if (parsed.error) {
                        return { error: parsed.error.message || 'OpenAI returned an error.', detail: parsed.error };
                    }

                    const url: string = parsed?.data?.[0]?.url;
                    if (!url) {
                        return { error: 'No image URL in OpenAI response.', raw: parsed };
                    }

                    let savedTo: string | undefined;
                    if (saveToDesktop) {
                        const filename = `echo-image-${Date.now()}.png`;
                        const savePath = `~/Desktop/${filename}`;
                        const saveCmd = `curl -s -L -o ${savePath} "${url}"`;
                        const saveResult = await coreExec(saveCmd);
                        if (saveResult.ok) {
                            savedTo = savePath;
                        }
                    }

                    return {
                        success: true,
                        url,
                        provider: 'openai',
                        prompt,
                        size,
                        ...(style ? { style } : {}),
                        ...(savedTo ? { saved_to: savedTo } : {}),
                    };
                }

                if (provider === 'together') {
                    const shellBody = JSON.stringify({
                        model: 'black-forest-labs/FLUX.1-schnell-Free',
                        prompt,
                        n: 1,
                        width: 1024,
                        height: 1024,
                    }).replace(/'/g, "'\\''");

                    const curlCmd = `curl -s -X POST https://api.together.xyz/v1/images/generations \
  -H "Authorization: Bearer ${apiKey}" \
  -H "Content-Type: application/json" \
  -d '${shellBody}'`;

                    const result = await coreExec(curlCmd);
                    if (!result.ok) {
                        return {
                            error: 'Together AI image generation failed.',
                            detail: result.stderr || result.error,
                        };
                    }

                    let parsed: any;
                    try {
                        parsed = JSON.parse(result.stdout || '');
                    } catch {
                        return { error: 'Could not parse Together AI response.', raw: result.stdout };
                    }

                    if (parsed.error) {
                        return { error: parsed.error.message || 'Together AI returned an error.', detail: parsed.error };
                    }

                    const url: string = parsed?.data?.[0]?.url;
                    if (!url) {
                        return { error: 'No image URL in Together AI response.', raw: parsed };
                    }

                    let savedTo: string | undefined;
                    if (saveToDesktop) {
                        const filename = `echo-image-${Date.now()}.png`;
                        const savePath = `~/Desktop/${filename}`;
                        const saveCmd = `curl -s -L -o ${savePath} "${url}"`;
                        const saveResult = await coreExec(saveCmd);
                        if (saveResult.ok) {
                            savedTo = savePath;
                        }
                    }

                    return {
                        success: true,
                        url,
                        provider: 'together',
                        prompt,
                        ...(savedTo ? { saved_to: savedTo } : {}),
                    };
                }

                // stability — returns binary PNG directly to disk
                if (provider === 'stability') {
                    const safeFilename = `echo-image-${Date.now()}`;
                    const outputPath = saveToDesktop
                        ? `~/Desktop/${safeFilename}.png`
                        : `/tmp/${safeFilename}.png`;

                    // Use JSON.stringify for proper escaping, then shell-safe single-quote escape
                    const stabilityShellBody = JSON.stringify({
                        text_prompts: [{ text: prompt }],
                        width: 1024,
                        height: 1024,
                        samples: 1,
                    }).replace(/'/g, "'\\''");

                    const curlCmd = `curl -s -X POST \
  "https://api.stability.ai/v1/generation/stable-diffusion-v1-6/text-to-image" \
  -H "Authorization: Bearer ${apiKey}" \
  -H "Content-Type: application/json" \
  -H "Accept: image/png" \
  --output "${outputPath}" \
  -d '${stabilityShellBody}'`;

                    const result = await coreExec(curlCmd);
                    if (!result.ok) {
                        return {
                            error: 'Stability AI image generation failed.',
                            detail: result.stderr || result.error,
                        };
                    }

                    return {
                        success: true,
                        provider: 'stability',
                        prompt,
                        saved_to: outputPath,
                        note: 'Image saved directly to disk (Stability AI returns binary PNG).',
                    };
                }

                return {
                    error: `Provider '${provider}' is not yet supported. Use: ${ALL_PROVIDERS.join(', ')}.`,
                };
            } catch (err) {
                return { error: `Unexpected error: ${(err as Error).message}` };
            }
        }

        // ── list_image_providers ──────────────────────────────────────────────
        if (toolName === 'list_image_providers') {
            const keys = loadApiKeys();
            const configured = ALL_PROVIDERS.filter(p => !!keys[p]);

            return {
                configured,
                all_providers: ALL_PROVIDERS,
                setup_tip: 'Say "save my OpenAI key ABC123" to get started',
            };
        }

        return { error: `Unknown tool: ${toolName}` };
    },
};

export default mediaStudioSkill;
