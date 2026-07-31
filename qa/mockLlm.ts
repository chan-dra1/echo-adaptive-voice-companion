/**
 * qa/mockLlm.ts
 *
 * A mock LLM provider for the behavioral eval harness.
 *
 * Echo's services/llmRouter.ts talks to model providers exclusively via the
 * global `fetch`. That means the cheapest, highest-fidelity way to test
 * Echo's *actual* prompt-assembly and tool-loop code is to swap out
 * `globalThis.fetch` for something that (a) records the exact outbound
 * request body/headers/url the real code produced, and (b) returns scripted
 * wire-format responses (Gemini's `candidates[...]`, OpenAI-compat's
 * `choices[...]`, and SSE variants of both) — no reimplementation of
 * llmRouter's logic, just a fetch double.
 *
 * Scenarios enqueue one scripted response per expected outbound call (a
 * tool-call turn, then a final-text turn, etc.) and can assert against
 * `mock.requests[i]` afterwards.
 */

export interface CapturedRequest {
    /** 1-based index of this call, in call order. */
    index: number;
    url: string;
    method: string;
    headers: Record<string, string>;
    bodyRaw: string;
    /** Parsed JSON body, or undefined if body wasn't valid JSON. */
    body: any;
}

export type ScriptedResponse =
    | { kind: 'json'; status?: number; body: any }
    | { kind: 'error'; status: number; body?: any }
    /** Server-Sent-Events stream. `events` are provider-shaped chunk objects,
     *  each emitted as one `data: <json>\n\n` frame, terminated by `data: [DONE]`. */
    | { kind: 'sse'; status?: number; events: any[] };

/** URL substrings that identify a "model provider" call vs. incidental
 *  traffic the app also fires (e.g. archiveService's fs/write to
 *  localhost:8000, which is unrelated to the LLM call and should just
 *  404/reject quietly like it would with no local dev server running). */
const LLM_URL_MARKERS = [
    'generativelanguage.googleapis.com',
    'api.groq.com',
    'openrouter.ai',
    'api.openai.com',
    'api.mistral.ai',
    'api.anthropic.com',
    '/llm/anthropic',
    '/llm/ollama',
    '/api/cloud-chat',
    'api-inference.huggingface.co',
];

function isLlmUrl(url: string): boolean {
    return LLM_URL_MARKERS.some(m => url.includes(m));
}

/** Builds Gemini `candidates[0].content.parts` shaped response body. */
export function geminiTextResponse(text: string) {
    return { candidates: [{ content: { role: 'model', parts: [{ text }] } }] };
}
export function geminiToolCallResponse(name: string, args: any) {
    return { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args } }] } }] };
}

/** Builds OpenAI-compat `choices[0].message` shaped response body. */
export function openAiTextResponse(text: string) {
    return { choices: [{ message: { role: 'assistant', content: text } }] };
}
export function openAiToolCallResponse(name: string, args: any, id = 'call_1') {
    return {
        choices: [{
            message: {
                role: 'assistant',
                content: null,
                tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
            },
        }],
    };
}

export class MockLlm {
    requests: CapturedRequest[] = [];
    private queue: ScriptedResponse[] = [];
    private fallback: ScriptedResponse | null = null;
    /** Every request whose URL didn't match a known LLM endpoint (still recorded, but not scripted). */
    unmatchedRequests: CapturedRequest[] = [];

    /** Queue up scripted responses in the order they should be returned,
     *  one per outbound LLM fetch call. */
    enqueue(...responses: ScriptedResponse[]): this {
        this.queue.push(...responses);
        return this;
    }

    /** Response returned for any LLM call once the queue is empty (optional). */
    setFallback(response: ScriptedResponse): this {
        this.fallback = response;
        return this;
    }

    reset(): void {
        this.requests = [];
        this.unmatchedRequests = [];
        this.queue = [];
        this.fallback = null;
    }

    /** Drop-in replacement for `fetch`, to be assigned to globalThis.fetch. */
    fetch = async (input: any, init: any = {}): Promise<Response> => {
        const url = typeof input === 'string' ? input : (input?.url ?? String(input));
        const method = init?.method || 'GET';
        const headers: Record<string, string> = {};
        if (init?.headers) {
            for (const [k, v] of Object.entries(init.headers as Record<string, string>)) headers[k] = v;
        }
        const bodyRaw = typeof init?.body === 'string' ? init.body : '';
        let parsed: any;
        try { parsed = bodyRaw ? JSON.parse(bodyRaw) : undefined; } catch { parsed = undefined; }

        const captured: CapturedRequest = {
            index: this.requests.length + 1,
            url,
            method,
            headers,
            bodyRaw,
            body: parsed,
        };
        this.requests.push(captured);

        if (!isLlmUrl(url)) {
            // Simulate "nothing listening" for incidental non-LLM traffic
            // (e.g. archiveService's local disk-save endpoint) rather than
            // scripting it — callers already treat fetch failures here as
            // non-fatal (`.catch(() => {})`).
            this.unmatchedRequests.push(captured);
            return new Response('not found', { status: 404 });
        }

        const scripted = this.queue.shift() ?? this.fallback;
        if (!scripted) {
            throw new Error(
                `MockLlm: no scripted response queued for LLM call #${captured.index} to ${url}. ` +
                `Body: ${bodyRaw.slice(0, 300)}`,
            );
        }
        return this.toResponse(scripted);
    };

    private toResponse(scripted: ScriptedResponse): Response {
        if (scripted.kind === 'error') {
            return new Response(JSON.stringify(scripted.body ?? { error: { message: 'mock error' } }), {
                status: scripted.status,
                headers: { 'content-type': 'application/json' },
            });
        }
        if (scripted.kind === 'json') {
            return new Response(JSON.stringify(scripted.body), {
                status: scripted.status ?? 200,
                headers: { 'content-type': 'application/json' },
            });
        }
        // sse
        const encoder = new TextEncoder();
        const events = scripted.events;
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                for (const ev of events) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
                }
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                controller.close();
            },
        });
        return new Response(stream, {
            status: scripted.status ?? 200,
            headers: { 'content-type': 'text/event-stream' },
        });
    }
}
