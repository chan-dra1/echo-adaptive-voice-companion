/**
 * /api/mission-results — Read latest results for a Cloud-tier mission.
 *
 * GET /api/mission-results?mission_id=:id&limit=10
 *
 * Requires a valid Supabase session bearer token. Results are scoped to the
 * authenticated user via the user_id column (RLS also enforces this).
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

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed.' });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json(500, { error: 'Echo Cloud server not configured.' });
  }

  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return json(401, { error: 'Missing bearer token.' });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return json(401, { error: 'Invalid or expired session.' });
  const userId = userData.user.id;

  const url       = new URL(req.url);
  const missionId = url.searchParams.get('mission_id');
  const limit     = Math.min(parseInt(url.searchParams.get('limit') ?? '10', 10), 50);

  if (!missionId) return json(400, { error: 'mission_id query param required.' });

  const { data, error } = await admin
    .from('mission_results')
    .select('id, mission_id, content, status, error_msg, created_at')
    .eq('mission_id', missionId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return json(500, { error: error.message });
  return json(200, { results: data });
}
