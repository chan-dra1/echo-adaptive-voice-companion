/**
 * /api/missions — CRUD for Cloud-tier scheduled missions (Stage 2).
 *
 * All operations require a valid Supabase session bearer token.
 * RLS in Supabase ensures users can only touch their own missions.
 *
 * Endpoints (verb-routed via URL path suffix):
 *   POST   /api/missions          — create mission
 *   GET    /api/missions          — list user's missions
 *   PATCH  /api/missions?id=:id   — update (title/prompt/cron/is_active)
 *   DELETE /api/missions?id=:id   — delete mission
 */

import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'edge' };

const SUPABASE_URL     = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function getToken(req: Request): string | null {
  const auth = req.headers.get('authorization') ?? '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

/** Parse a simple 5-field cron expression (we validate the format here,
 *  not the semantics — the Edge Function handles scheduling). */
function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  // Very permissive: just check each part has valid cron chars
  return parts.every(p => /^(\*|[0-9]+|[0-9]+-[0-9]+|\*\/[0-9]+)$/.test(p));
}

export default async function handler(req: Request): Promise<Response> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json(500, { error: 'Echo Cloud server not configured.' });
  }

  const token = getToken(req);
  if (!token) return json(401, { error: 'Missing bearer token.' });

  // Use admin client to verify the token, then a user client for RLS-safe ops
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return json(401, { error: 'Invalid or expired session.' });
  }
  const userId = userData.user.id;

  const url   = new URL(req.url);
  const missionId = url.searchParams.get('id');
  const method = req.method.toUpperCase();

  // ── GET /api/missions ───────────────────────────────────────────────────────
  if (method === 'GET') {
    const { data, error } = await admin
      .from('missions')
      .select('id, title, prompt, cron_expr, is_active, last_run_at, next_run_at, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) return json(500, { error: error.message });
    return json(200, { missions: data });
  }

  // ── POST /api/missions ──────────────────────────────────────────────────────
  if (method === 'POST') {
    let body: any;
    try { body = await req.json(); } catch { return json(400, { error: 'Invalid JSON.' }); }

    const { title, prompt, cron_expr } = body;
    if (!title?.trim()) return json(400, { error: 'title is required.' });
    if (!prompt?.trim()) return json(400, { error: 'prompt is required.' });
    const cron = (cron_expr ?? '0 8 * * *').trim();
    if (!isValidCron(cron)) return json(400, { error: 'Invalid cron expression. Use 5-field format e.g. "0 8 * * *".' });

    const { data, error } = await admin
      .from('missions')
      .insert({ user_id: userId, title: title.trim(), prompt: prompt.trim(), cron_expr: cron })
      .select()
      .single();

    if (error) return json(500, { error: error.message });
    return json(201, { mission: data });
  }

  // ── PATCH /api/missions?id=:id ──────────────────────────────────────────────
  if (method === 'PATCH') {
    if (!missionId) return json(400, { error: 'id query param required.' });
    let body: any;
    try { body = await req.json(); } catch { return json(400, { error: 'Invalid JSON.' }); }

    const allowed: Record<string, unknown> = {};
    if (body.title     !== undefined) allowed.title     = body.title.trim();
    if (body.prompt    !== undefined) allowed.prompt    = body.prompt.trim();
    if (body.is_active !== undefined) allowed.is_active = Boolean(body.is_active);
    if (body.cron_expr !== undefined) {
      if (!isValidCron(body.cron_expr)) return json(400, { error: 'Invalid cron expression.' });
      allowed.cron_expr = body.cron_expr.trim();
    }
    if (!Object.keys(allowed).length) return json(400, { error: 'No updateable fields provided.' });

    const { data, error } = await admin
      .from('missions')
      .update(allowed)
      .eq('id', missionId)
      .eq('user_id', userId)   // RLS: only own missions
      .select()
      .single();

    if (error) return json(500, { error: error.message });
    if (!data)  return json(404, { error: 'Mission not found.' });
    return json(200, { mission: data });
  }

  // ── DELETE /api/missions?id=:id ─────────────────────────────────────────────
  if (method === 'DELETE') {
    if (!missionId) return json(400, { error: 'id query param required.' });

    const { error, count } = await admin
      .from('missions')
      .delete({ count: 'exact' })
      .eq('id', missionId)
      .eq('user_id', userId);

    if (error) return json(500, { error: error.message });
    if (count === 0) return json(404, { error: 'Mission not found.' });
    return json(200, { deleted: true });
  }

  return json(405, { error: 'Method not allowed.' });
}
