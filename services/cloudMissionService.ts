/**
 * cloudMissionService.ts — Client-side service for Echo Cloud always-on missions.
 *
 * Wraps /api/missions and /api/mission-results with typed methods.
 * Requires the user to be signed in to Echo Cloud (echoCloudAuthService).
 */

import { echoCloudAuthService } from './echoCloudAuthService';

const BASE = typeof window !== 'undefined' ? window.location.origin : '';

export interface CloudMission {
  id: string;
  title: string;
  prompt: string;
  cron_expr: string;
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string;
  created_at: string;
}

export interface CloudMissionResult {
  id: number;
  mission_id: string;
  content: string;
  status: 'done' | 'error';
  error_msg?: string | null;
  created_at: string;
}

/** Common schedules for the UI picker. */
export const PRESET_SCHEDULES = [
  { label: 'Every morning at 8am',   cron: '0 8 * * *' },
  { label: 'Every evening at 6pm',   cron: '0 18 * * *' },
  { label: 'Every Monday at 9am',    cron: '0 9 * * 1' },
  { label: 'Every Sunday at 8am',    cron: '0 8 * * 0' },
  { label: 'Every hour',             cron: '0 * * * *' },
  { label: 'Every 30 minutes',       cron: '*/30 * * * *' },
  { label: 'Every 4 hours',          cron: '0 */4 * * *' },
  { label: 'Daily at midnight',      cron: '0 0 * * *' },
] as const;

/** Human-readable label for a cron expression. */
export function cronToLabel(expr: string): string {
  const preset = PRESET_SCHEDULES.find(p => p.cron === expr);
  if (preset) return preset.label;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hr, , , dow] = parts;
  if (dow !== '*' && min === '0') return `Weekly on day ${dow} at ${hr}:${min.padStart(2, '0')}`;
  if (hr !== '*' && min === '0')  return `Daily at ${hr}:00`;
  if (hr === '*' && min.startsWith('*/')) return `Every ${min.slice(2)}m`;
  return expr;
}

function authHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${echoCloudAuthService.getCurrentAccessToken()}`,
  };
}

export const cloudMissionService = {
  isAvailable(): boolean {
    return echoCloudAuthService.isConfigured() && echoCloudAuthService.isSignedIn();
  },

  async listMissions(): Promise<{ ok: boolean; missions?: CloudMission[]; error?: string }> {
    try {
      const res = await fetch(`${BASE}/api/missions`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error ?? `Error ${res.status}` };
      return { ok: true, missions: data.missions };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  },

  async createMission(
    title: string,
    prompt: string,
    cron_expr = '0 8 * * *'
  ): Promise<{ ok: boolean; mission?: CloudMission; error?: string }> {
    try {
      const res = await fetch(`${BASE}/api/missions`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ title, prompt, cron_expr }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error ?? `Error ${res.status}` };
      return { ok: true, mission: data.mission };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  },

  async updateMission(
    id: string,
    patch: Partial<Pick<CloudMission, 'title' | 'prompt' | 'cron_expr' | 'is_active'>>
  ): Promise<{ ok: boolean; mission?: CloudMission; error?: string }> {
    try {
      const res = await fetch(`${BASE}/api/missions?id=${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error ?? `Error ${res.status}` };
      return { ok: true, mission: data.mission };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  },

  async deleteMission(id: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${BASE}/api/missions?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error ?? `Error ${res.status}` };
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  },

  async getMissionResults(
    missionId: string,
    limit = 10
  ): Promise<{ ok: boolean; results?: CloudMissionResult[]; error?: string }> {
    try {
      const res = await fetch(
        `${BASE}/api/mission-results?mission_id=${encodeURIComponent(missionId)}&limit=${limit}`,
        { headers: authHeaders() }
      );
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error ?? `Error ${res.status}` };
      return { ok: true, results: data.results };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  },

  /** Toggle a mission on or off. */
  async toggleMission(id: string, isActive: boolean): Promise<{ ok: boolean; error?: string }> {
    return this.updateMission(id, { is_active: isActive });
  },
};
