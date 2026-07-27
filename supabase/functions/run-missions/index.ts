/**
 * run-missions — Supabase Edge Function (Deno runtime).
 *
 * Reads all active missions that are due (next_run_at <= now()), calls Gemini
 * with each mission's prompt, stores the result, and advances the schedule.
 *
 * Invoked by pg_cron every 5 minutes (see 0002_missions.sql) OR by
 * POST /api/missions/trigger from the client.
 *
 * Env vars (set in Supabase Dashboard → Edge Functions → Secrets):
 *   SUPABASE_URL              — automatically injected
 *   SUPABASE_SERVICE_ROLE_KEY — automatically injected
 *   GEMINI_CLOUD_KEY          — your paid Gemini key
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const GEMINI_KEY   = Deno.env.get('GEMINI_CLOUD_KEY') ?? '';
const GEMINI_MODEL = 'gemini-2.5-flash';

async function callGemini(prompt: string): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
      }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `Gemini error ${res.status}`);
  }
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  return parts.filter((p: any) => p.text).map((p: any) => p.text).join('');
}

Deno.serve(async (_req) => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return new Response('Missing Supabase env vars', { status: 500 });
  }
  if (!GEMINI_KEY) {
    return new Response('Missing GEMINI_CLOUD_KEY', { status: 500 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const now = new Date().toISOString();

  // Fetch all due active missions
  const { data: missions, error } = await admin
    .from('missions')
    .select('id, user_id, title, prompt')
    .eq('is_active', true)
    .lte('next_run_at', now)
    .limit(20); // process max 20 at a time per invocation

  if (error) {
    console.error('Failed to fetch missions:', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (!missions || missions.length === 0) {
    return new Response(JSON.stringify({ ran: 0 }), { status: 200 });
  }

  const results: { id: string; ok: boolean }[] = [];

  for (const mission of missions) {
    try {
      const content = await callGemini(mission.prompt);

      // Store result
      await admin.from('mission_results').insert({
        mission_id: mission.id,
        user_id: mission.user_id,
        content,
        status: 'done',
      });

      // Advance schedule
      await admin.rpc('advance_mission_schedule', {
        p_mission_id: mission.id,
        p_last_run: now,
      });

      results.push({ id: mission.id, ok: true });
    } catch (err: any) {
      console.error(`Mission ${mission.id} failed:`, err.message);

      // Store error result
      await admin.from('mission_results').insert({
        mission_id: mission.id,
        user_id: mission.user_id,
        content: '',
        status: 'error',
        error_msg: err.message,
      });

      // Still advance schedule so it retries next cycle
      await admin.rpc('advance_mission_schedule', {
        p_mission_id: mission.id,
        p_last_run: now,
      });

      results.push({ id: mission.id, ok: false });
    }
  }

  return new Response(
    JSON.stringify({ ran: results.length, results }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
});
