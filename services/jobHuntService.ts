/**
 * jobHuntService.ts — personal job-apply pipeline (search → score → tailor → track).
 */

import { chat, chooseProvider } from './llmRouter';
import { responseCache } from './responseCache';
import resumeTailorSkill from '../skills/resumeTailorSkill';
import webSkill from '../skills/webSkill';

export type JobApplicationStatus = 'found' | 'tailored' | 'applied' | 'skipped';

export interface JobListing {
  id: string;
  title: string;
  company: string;
  location?: string;
  applyUrl: string;
  snippet?: string;
  source?: string;
  atsScore?: number;
  keywordsMatched?: string[];
  missingKeywords?: string[];
  tailoredAt?: number;
  status: JobApplicationStatus;
  createdAt: number;
}

const STORAGE_KEY = 'echo_job_applications';

function loadAll(): JobListing[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAll(list: JobListing[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 200)));
  } catch { /* ignore */ }
}

export const jobHuntService = {
  list(status?: JobApplicationStatus): JobListing[] {
    const all = loadAll();
    return status ? all.filter((j) => j.status === status) : all;
  },

  get(id: string): JobListing | undefined {
    return loadAll().find((j) => j.id === id);
  },

  updateStatus(id: string, status: JobApplicationStatus): JobListing | null {
    const all = loadAll();
    const idx = all.findIndex((j) => j.id === id);
    if (idx < 0) return null;
    all[idx] = { ...all[idx], status };
    saveAll(all);
    return all[idx];
  },

  async searchJobs(params: {
    domain: string;
    location?: string;
    remote?: boolean;
    maxResults?: number;
  }): Promise<{ ok: boolean; jobs: JobListing[]; note?: string }> {
    const max = Math.min(params.maxResults ?? 8, 15);
    const cacheKey = `jobhunt:${JSON.stringify(params)}`;
    const cachedRaw = responseCache.get(cacheKey);
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw) as { jobs: JobListing[] };
        if (cached.jobs?.length) return { ok: true, jobs: cached.jobs, note: 'cached' };
      } catch { /* ignore */ }
    }

    const baseResume = localStorage.getItem('echo_base_resume') || '';
    const provider = chooseProvider();
    const query = [
      `Find ${max} real job postings for: ${params.domain}.`,
      params.location ? `Location: ${params.location}.` : '',
      params.remote ? 'Prefer remote-friendly roles.' : '',
      'Return STRICT JSON array only. Each item:',
      '{ "title", "company", "location", "applyUrl", "snippet", "source" }.',
      'Use publicly listed apply URLs (company career pages, Greenhouse, Lever, etc.).',
      'If you cannot verify a URL, set applyUrl to empty string and explain in snippet.',
      baseResume ? 'Bias toward roles matching this resume headline/skills (do not invent employers).' : '',
    ].filter(Boolean).join('\n');

    const { text } = await chat({
      messages: [
        {
          role: 'system',
          content: 'You are a job research assistant. Output JSON only — no markdown.',
        },
        { role: 'user', content: query },
      ],
      provider,
      temperature: 0.3,
      json: true,
      maxTokens: 2000,
    });

    let parsed: any[] = [];
    try {
      const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```$/g, '').trim();
      const data = JSON.parse(cleaned);
      parsed = Array.isArray(data) ? data : data.jobs ?? [];
    } catch {
      return { ok: false, jobs: [], note: 'Could not parse job search results.' };
    }

    const now = Date.now();
    const jobs: JobListing[] = parsed.slice(0, max).map((row, i) => ({
      id: `job_${now}_${i}`,
      title: String(row.title || 'Unknown role'),
      company: String(row.company || 'Unknown company'),
      location: row.location ? String(row.location) : undefined,
      applyUrl: String(row.applyUrl || row.url || ''),
      snippet: row.snippet ? String(row.snippet).slice(0, 500) : undefined,
      source: row.source ? String(row.source) : 'research',
      status: 'found' as const,
      createdAt: now,
    }));

    const existing = loadAll();
    saveAll([...jobs, ...existing]);
    responseCache.set(cacheKey, JSON.stringify({ jobs }), 15 * 60 * 1000);
    return { ok: true, jobs };
  },

  async scoreJob(jobId: string, jobDescriptionOrUrl?: string): Promise<JobListing | null> {
    const job = this.get(jobId);
    if (!job) return null;
    const resume = localStorage.getItem('echo_base_resume') || '';
    if (!resume) return null;

    let jd = jobDescriptionOrUrl || job.snippet || '';
    if (jd && /^https?:\/\//i.test(jd)) {
      const page = await webSkill.execute('read_webpage', { url: jd });
      jd = typeof page === 'string' ? page : String(page);
    }
    if (!jd) jd = `${job.title} at ${job.company}`;

    const result = await resumeTailorSkill.execute('evaluate_ats_score', {
      resume_text: resume,
      job_description_or_url: jd.slice(0, 12000),
    });

    const updated: JobListing = {
      ...job,
      atsScore: typeof result?.score === 'number' ? result.score : result?.ats_score,
      keywordsMatched: result?.matched_keywords || result?.keywordsMatched,
      missingKeywords: result?.missing_keywords || result?.missingKeywords,
    };
    const all = loadAll().map((j) => (j.id === jobId ? updated : j));
    saveAll(all);
    return updated;
  },

  async tailorForJob(
    jobId: string,
    targetFormat: 'pdf' | 'docx' | 'md' | 'txt' = 'pdf',
    jobDescriptionOrUrl?: string
  ): Promise<{ ok: boolean; job?: JobListing; result?: unknown; error?: string }> {
    const job = this.get(jobId);
    if (!job) return { ok: false, error: 'Job not found' };

    const jd =
      jobDescriptionOrUrl ||
      job.applyUrl ||
      job.snippet ||
      `${job.title} — ${job.company}`;

    try {
      const result = await resumeTailorSkill.execute('tailor_resume', {
        job_description_or_url: jd,
        target_format: targetFormat,
      });
      const updated = { ...job, status: 'tailored' as const, tailoredAt: Date.now() };
      saveAll(loadAll().map((j) => (j.id === jobId ? updated : j)));
      return { ok: true, job: updated, result };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  },

  async runBatchPipeline(params: {
    domain: string;
    location?: string;
    remote?: boolean;
    maxJobs?: number;
    targetFormat?: 'pdf' | 'docx' | 'md' | 'txt';
    minAtsScore?: number;
  }): Promise<{
    searched: number;
    scored: number;
    tailored: number;
    ready: JobListing[];
  }> {
    const search = await this.searchJobs({
      domain: params.domain,
      location: params.location,
      remote: params.remote,
      maxResults: params.maxJobs ?? 5,
    });
    if (!search.ok) return { searched: 0, scored: 0, tailored: 0, ready: [] };

    let scored = 0;
    let tailored = 0;
    const ready: JobListing[] = [];

    for (const job of search.jobs) {
      const scoredJob = (await this.scoreJob(job.id, job.applyUrl || undefined)) ?? job;
      scored++;
      const min = params.minAtsScore ?? 0;
      if (typeof scoredJob.atsScore === 'number' && scoredJob.atsScore < min) continue;

      const t = await this.tailorForJob(job.id, params.targetFormat ?? 'pdf', job.applyUrl || undefined);
      if (t.ok && t.job) {
        tailored++;
        ready.push(t.job);
      }
    }

    return {
      searched: search.jobs.length,
      scored,
      tailored,
      ready,
    };
  },
};
