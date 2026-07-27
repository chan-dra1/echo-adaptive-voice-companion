/**
 * echoCloudAuthService.ts
 *
 * Thin auth wrapper around Supabase for the Echo Cloud tier. Uses
 * passwordless magic-link sign-in (no password UI to build/secure).
 *
 * llmRouter's chat()/chatStream() need to read "is the user signed in" and
 * "what's their access token" SYNCHRONOUSLY (same contract as the other
 * providers' hasKeyFor/getKeyFor), but Supabase's own session getters are
 * async. So this service keeps an in-memory mirror of the current session,
 * updated via onAuthStateChange, that those synchronous reads pull from.
 */
import { supabase, isEchoCloudConfigured } from './supabaseClient';

let currentAccessToken: string | null = null;
let currentUserEmail: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) {
    try { l(); } catch { /* ignore */ }
  }
}

if (supabase) {
  // Prime the cache from any already-persisted session (page reload case).
  supabase.auth.getSession().then(({ data }) => {
    currentAccessToken = data.session?.access_token || null;
    currentUserEmail = data.session?.user?.email || null;
    emit();
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    currentAccessToken = session?.access_token || null;
    currentUserEmail = session?.user?.email || null;
    emit();
  });
}

export const echoCloudAuthService = {
  isConfigured(): boolean {
    return isEchoCloudConfigured;
  },

  isSignedIn(): boolean {
    return !!currentAccessToken;
  },

  /** Synchronous — used by llmRouter as the "API key" for the echoCloud provider. */
  getCurrentAccessToken(): string {
    return currentAccessToken || '';
  },

  getCurrentEmail(): string | null {
    return currentUserEmail;
  },

  /** Subscribe to sign-in/sign-out changes. Returns an unsubscribe function. */
  onChange(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },

  /** Send a magic sign-in link to the given email. */
  async sendMagicLink(email: string): Promise<{ ok: boolean; message: string }> {
    if (!supabase) return { ok: false, message: 'Echo Cloud isn\'t configured yet.' };
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes('@')) return { ok: false, message: 'Enter a valid email.' };
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined },
    });
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: `Check ${trimmed} for a sign-in link.` };
  },

  async signOut(): Promise<void> {
    if (!supabase) return;
    await supabase.auth.signOut();
  },
};
