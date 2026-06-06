import { FunctionDeclaration, Type } from '@google/genai';
import { Skill } from '../services/agentSkillService';
import { jobHuntService } from '../services/jobHuntService';

const searchJobsTool: FunctionDeclaration = {
  name: 'search_jobs',
  description:
    'Search for job postings matching a domain/role and optional location. Stores results locally with apply links.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      domain: { type: Type.STRING, description: 'Role or field, e.g. "backend engineer fintech".' },
      location: { type: Type.STRING, description: 'City/region or "remote".' },
      remote: { type: Type.BOOLEAN },
      max_results: { type: Type.NUMBER },
    },
    required: ['domain'],
  },
};

const scoreJobTool: FunctionDeclaration = {
  name: 'score_job_fit',
  description: 'ATS/fit score for a saved job against the user base resume in the Vault.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      job_id: { type: Type.STRING },
      job_description_or_url: { type: Type.STRING },
    },
    required: ['job_id'],
  },
};

const tailorJobTool: FunctionDeclaration = {
  name: 'tailor_resume_for_job',
  description: 'Generate a tailored ATS resume PDF/DOCX for a saved job and mark it ready to apply.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      job_id: { type: Type.STRING },
      target_format: { type: Type.STRING, description: 'pdf | docx | md | txt' },
      job_description_or_url: { type: Type.STRING },
    },
    required: ['job_id', 'target_format'],
  },
};

const batchPipelineTool: FunctionDeclaration = {
  name: 'run_job_apply_pipeline',
  description:
    'End-to-end: search jobs → ATS score → tailor resume per listing → return apply URLs. User only submits applications.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      domain: { type: Type.STRING },
      location: { type: Type.STRING },
      remote: { type: Type.BOOLEAN },
      max_jobs: { type: Type.NUMBER },
      target_format: { type: Type.STRING },
      min_ats_score: { type: Type.NUMBER },
    },
    required: ['domain'],
  },
};

const listJobsTool: FunctionDeclaration = {
  name: 'list_saved_jobs',
  description: 'List locally saved job applications, optionally filtered by status.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      status: { type: Type.STRING, description: 'found | tailored | applied | skipped' },
    },
  },
};

const markAppliedTool: FunctionDeclaration = {
  name: 'mark_job_applied',
  description: 'Mark a saved job as applied after the user submitted.',
  parameters: {
    type: Type.OBJECT,
    properties: { job_id: { type: Type.STRING } },
    required: ['job_id'],
  },
};

const jobHuntSkill: Skill = {
  name: 'jobHuntSkill',
  description: 'Personal job hunt: search, ATS score, tailor resumes, track apply links.',
  tools: [
    searchJobsTool,
    scoreJobTool,
    tailorJobTool,
    batchPipelineTool,
    listJobsTool,
    markAppliedTool,
  ],
  execute: async (toolName, args) => {
    switch (toolName) {
      case 'search_jobs': {
        const res = await jobHuntService.searchJobs({
          domain: args.domain,
          location: args.location,
          remote: args.remote,
          maxResults: args.max_results,
        });
        return {
          ok: res.ok,
          count: res.jobs.length,
          jobs: res.jobs.map((j) => ({
            id: j.id,
            title: j.title,
            company: j.company,
            applyUrl: j.applyUrl,
            location: j.location,
          })),
          note: res.note,
        };
      }
      case 'score_job_fit': {
        const job = await jobHuntService.scoreJob(args.job_id, args.job_description_or_url);
        if (!job) return { error: 'Job not found or resume missing in Vault.' };
        return {
          job_id: job.id,
          title: job.title,
          company: job.company,
          atsScore: job.atsScore,
          keywordsMatched: job.keywordsMatched,
          missingKeywords: job.missingKeywords,
          applyUrl: job.applyUrl,
        };
      }
      case 'tailor_resume_for_job': {
        const fmt = (args.target_format || 'pdf') as 'pdf' | 'docx' | 'md' | 'txt';
        const res = await jobHuntService.tailorForJob(
          args.job_id,
          fmt,
          args.job_description_or_url
        );
        if (!res.ok) return { error: res.error };
        return {
          job_id: res.job?.id,
          title: res.job?.title,
          company: res.job?.company,
          applyUrl: res.job?.applyUrl,
          downloadTriggered: true,
          status: res.job?.status,
        };
      }
      case 'run_job_apply_pipeline': {
        const res = await jobHuntService.runBatchPipeline({
          domain: args.domain,
          location: args.location,
          remote: args.remote,
          maxJobs: args.max_jobs ?? 5,
          targetFormat: (args.target_format || 'pdf') as 'pdf' | 'docx' | 'md' | 'txt',
          minAtsScore: args.min_ats_score,
        });
        return {
          searched: res.searched,
          scored: res.scored,
          tailored: res.tailored,
          ready: res.ready.map((j) => ({
            id: j.id,
            title: j.title,
            company: j.company,
            applyUrl: j.applyUrl,
            atsScore: j.atsScore,
          })),
        };
      }
      case 'list_saved_jobs': {
        const jobs = jobHuntService.list(args.status);
        return { count: jobs.length, jobs };
      }
      case 'mark_job_applied': {
        const job = jobHuntService.updateStatus(args.job_id, 'applied');
        return job ? { ok: true, job_id: job.id, status: job.status } : { error: 'Not found' };
      }
      default:
        throw new Error(`Unknown tool ${toolName}`);
    }
  },
};

export default jobHuntSkill;
