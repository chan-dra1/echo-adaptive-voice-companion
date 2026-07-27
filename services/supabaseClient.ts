/**
 * supabaseClient.ts
 *
 * Browser-side Supabase client for Echo Cloud (Stage 1). Uses the public
 * anon key — safe to ship in the client bundle, since access is governed by
 * Row Level Security policies (see supabase/migrations/0001_cloud_tier.sql),
 * not by keeping this key secret. The service-role key (which DOES bypass
 * RLS) lives only in the Vercel serverless function's environment
 * (api/cloud-chat.ts), never here.
 *
 * Returns null if VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY aren't
 * configured, so the rest of the app can treat "no Echo Cloud" as a normal,
 * expected state (BYOK-only) rather than a crash.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const url = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_SUPABASE_URL : undefined;
const anonKey = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_SUPABASE_ANON_KEY : undefined;

export const isEchoCloudConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isEchoCloudConfigured
  ? createClient(url as string, anonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true, // magic-link callback support
      },
    })
  : null;

if (!isEchoCloudConfigured && typeof window !== 'undefined') {
  console.info('[supabaseClient] VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY not set — Echo Cloud disabled, BYOK still works normally.');
}
