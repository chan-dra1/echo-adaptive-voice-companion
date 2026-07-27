/**
 * /api/cloud-chat — Echo Cloud proxy (Stage 1).
 *
 * Runs on Vercel's Edge Runtime. Verifies the caller's Supabase session,
 * enforces a daily message quota (supabase/migrations/0001_cloud_tier.sql),
 * then calls Gemini using the OPERATOR's own key (GEMINI_CLOUD_KEY — never
 * the user's own BYOK key, which never reaches this server). Speaks
 * OpenAI-compatible request/response shape (both plain and SSE-streamed) so
 * the client's existing llmRouter.ts parsing code works unmodified — this
 * proxy is just another "OpenAI-compat" backend from the client's view.
 *
 * Required environment variables (set in Vercel → Project → Settings →
 * Environment Variables — NOT in a VITE_-prefixed name, so they never ship
 * to the browser bundle):
 *   SUPABASE_SERVICE_ROLE_KEY   — Supabase → Project Settings → API → service_role (secret!)
 *   GEMINI_CLOUD_KEY            — a Gemini key YOU pay for, used for every Cloud-tier user
 *   FREE_CLOUD_DAILY_LIMIT      — optional, defaults to 30 messages/user/day
 * Also needs VITE_SUPABASE_URL (already set for the client — reused here;
 * Vercel exposes all project env vars to functions regardless of prefix,
 * the VITE_ prefix only controls what Vite inlines into the client bundle).
 */
import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const GEMINI_CLOUD_KEY = process.env.GEMINI_CLOUD_KEY || '';
const FREE_CLOUD_DAILY_LIMIT = parseInt(process.env.FREE_CLOUD_DAILY_LIMIT || '30', 10);
const CLOUD_MODEL = 'gemini-2.5-flash';

function json(status: number, body: any): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Exported for direct unit testing (see scratchpad/test-cloud-chat.mts) — not used by the client. */
export function safeParseArgs(s: any): any {
  if (typeof s !== 'string') return s || {};
  try { return JSON.parse(s); } catch { return {}; }
}

/** OpenAI-compat request body → Gemini generateContent body. Exported for direct unit testing. */
export function toGeminiBody(body: any): any {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const sys = messages.find((m: any) => m.role === 'system');
  const rest = messages.filter((m: any) => m.role !== 'system');

  const contents = rest.map((m: any) => {
    if (m.role === 'tool') {
      let parsed: any;
      try { parsed = JSON.parse(m.content); } catch { parsed = { result: m.content }; }
      return { role: 'function', parts: [{ functionResponse: { name: m.name || 'unknown_tool', response: parsed } }] };
    }
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      return {
        role: 'model',
        parts: m.tool_calls.map((tc: any) => ({
          functionCall: { name: tc.function?.name, args: safeParseArgs(tc.function?.arguments) },
        })),
      };
    }
    return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content || '' }] };
  });

  const genBody: any = {
    contents,
    generationConfig: { temperature: body.temperature ?? 0.7, maxOutputTokens: body.max_tokens ?? 2048 },
  };
  if (sys?.content) genBody.system_instruction = { parts: [{ text: sys.content }] };
  if (Array.isArray(body.tools) && body.tools.length) {
    genBody.tools = [{
      functionDeclarations: body.tools.map((t: any) => ({
        name: t.function?.name,
        description: t.function?.description,
        parameters: t.function?.parameters,
      })),
    }];
  }
  return genBody;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: { message: 'Method not allowed' } });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json(500, { error: { message: 'Echo Cloud is not configured on the server yet (missing Supabase env vars).' } });
  }
  if (!GEMINI_CLOUD_KEY) {
    return json(500, { error: { message: 'Echo Cloud has no model key configured on the server yet.' } });
  }

  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return json(401, { error: { message: 'Missing bearer token.' } });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return json(401, { error: { message: 'Invalid or expired session — sign in again.' } });
  const userId = userData.user.id;

  // Atomic increment-and-check — race-safe under concurrent requests.
  const { data: allowed, error: quotaErr } = await admin.rpc('increment_daily_usage', {
    p_user_id: userId,
    p_limit: FREE_CLOUD_DAILY_LIMIT,
  });
  if (quotaErr) return json(500, { error: { message: 'Usage check failed: ' + quotaErr.message } });
  if (!allowed) {
    return json(429, {
      error: {
        message: `Daily Echo Cloud limit (${FREE_CLOUD_DAILY_LIMIT} messages) reached. Resets at midnight UTC — or add your own free key in Settings for unlimited BYOK use in the meantime.`,
      },
    });
  }

  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: { message: 'Invalid JSON body.' } }); }

  const geminiBody = toGeminiBody(body);
  const wantsStream = body.stream === true;

  const logUsage = (usage: any) => {
    if (!usage) return;
    admin.from('usage_events').insert({
      user_id: userId,
      provider: 'gemini',
      model: CLOUD_MODEL,
      input_tokens: usage.promptTokenCount ?? null,
      output_tokens: usage.candidatesTokenCount ?? null,
    }).then(() => {}, () => {}); // fire-and-forget; a logging failure shouldn't fail the request
  };

  if (!wantsStream) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${CLOUD_MODEL}:generateContent?key=${GEMINI_CLOUD_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(geminiBody) },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return json(res.status, { error: { message: err?.error?.message || `Model error (${res.status})` } });
    }
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.filter((p: any) => p.text).map((p: any) => p.text).join('');
    const toolCallParts = parts.filter((p: any) => p.functionCall);
    logUsage(data?.usageMetadata);

    return json(200, {
      choices: [{
        message: {
          role: 'assistant',
          content: text || null,
          tool_calls: toolCallParts.length
            ? toolCallParts.map((p: any, i: number) => ({
                id: `call_${Date.now()}_${i}`,
                type: 'function',
                function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) },
              }))
            : undefined,
        },
      }],
    });
  }

  // Streaming: consume Gemini's SSE, re-emit as OpenAI-compatible delta chunks.
  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${CLOUD_MODEL}:streamGenerateContent?alt=sse&key=${GEMINI_CLOUD_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(geminiBody) },
  );
  if (!geminiRes.ok || !geminiRes.body) {
    const err = await geminiRes.json().catch(() => ({}));
    return json(geminiRes.status, { error: { message: err?.error?.message || `Model error (${geminiRes.status})` } });
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let usageLogged = false;
  let toolCallIndex = 0;

  const stream = new ReadableStream({
    async start(controller) {
      const reader = geminiRes.body!.getReader();
      let buf = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const jsonStr = trimmed.slice(5).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;
            try {
              const chunk = JSON.parse(jsonStr);
              const parts = chunk?.candidates?.[0]?.content?.parts || [];
              for (const p of parts) {
                if (p.text) {
                  controller.enqueue(encoder.encode(
                    `data: ${JSON.stringify({ choices: [{ delta: { content: p.text } }] })}\n\n`,
                  ));
                }
                if (p.functionCall) {
                  controller.enqueue(encoder.encode(
                    `data: ${JSON.stringify({
                      choices: [{
                        delta: {
                          tool_calls: [{
                            index: toolCallIndex++,
                            id: `call_${Date.now()}_${toolCallIndex}`,
                            function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) },
                          }],
                        },
                      }],
                    })}\n\n`,
                  ));
                }
              }
              if (chunk?.usageMetadata && !usageLogged) {
                usageLogged = true;
                logUsage(chunk.usageMetadata);
              }
            } catch { /* skip malformed SSE chunk */ }
          }
        }
      } catch {
        /* stream read failed — fall through to close */
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
}
