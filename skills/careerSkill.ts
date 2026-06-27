import { FunctionDeclaration, Type } from '@google/genai';
import { Skill } from '../services/agentSkillService';
import { coreAdd, coreWriteFile, isCoreConnected } from '../services/echoCoreSync';

/**
 * careerSkill — the "Career Suite" for Echo. Replaces Rezi/Teal.
 *
 * Cover letters, job-application tracking, and interview prep. Complements
 * resumeSkill / resumeTailorSkill.
 *
 * IMPORTANT: these tools do NOT generate prose. Echo (Gemini) is the writer —
 * it composes the actual cover letter and then calls save_cover_letter to
 * STRUCTURE, SAVE, and (optionally) EXPORT it. The tracker tools manage state
 * in localStorage; interview_prep is a pure, offline scaffold the agent uses to
 * coach the user.
 */

type AppStatus = 'applied' | 'interviewing' | 'offer' | 'rejected' | 'accepted';

const VALID_STATUSES: AppStatus[] = ['applied', 'interviewing', 'offer', 'rejected', 'accepted'];

const APPLICATIONS_KEY = 'echo_job_applications';

interface JobApplication {
    id: string;
    company: string;
    role: string;
    status: AppStatus;
    notes?: string;
    url?: string;
    updatedAt: number;
}

function slugify(input: string): string {
    return String(input || 'untitled')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        || 'untitled';
}

function loadApplications(): JobApplication[] {
    try {
        const raw = localStorage.getItem(APPLICATIONS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveApplications(apps: JobApplication[]): void {
    try {
        localStorage.setItem(APPLICATIONS_KEY, JSON.stringify(apps));
    } catch {
        /* ignore storage errors */
    }
}

function countByStatus(apps: JobApplication[]): Record<AppStatus, number> {
    const byStatus: Record<AppStatus, number> = {
        applied: 0,
        interviewing: 0,
        offer: 0,
        rejected: 0,
        accepted: 0,
    };
    for (const a of apps) {
        if (a && byStatus[a.status as AppStatus] !== undefined) {
            byStatus[a.status as AppStatus] += 1;
        }
    }
    return byStatus;
}

const saveCoverLetterDeclaration: FunctionDeclaration = {
    name: 'save_cover_letter',
    description:
        'Persist a finished cover letter that YOU wrote for a specific company + role. THIS is how the letter reaches ' +
        'the user — it saves your prose to the Mission Dashboard (Echo Core drafts) and, when export_to_file is true, ' +
        'also writes it as a .md file to the Desktop. Write the full cover letter first, then call this with the ' +
        'company, role, and the complete text in the `content` arg.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            company: {
                type: Type.STRING,
                description: 'The target company the cover letter is for (e.g. "Acme Corp").',
            },
            role: {
                type: Type.STRING,
                description: 'The role/position being applied for (e.g. "Senior Backend Engineer").',
            },
            content: {
                type: Type.STRING,
                description: 'The full finished cover letter you wrote (the actual prose to save).',
            },
            export_to_file: {
                type: Type.BOOLEAN,
                description: 'When true, also write the cover letter to a .md file on the Desktop (requires Echo Core connected).',
            },
        },
        required: ['company', 'role', 'content'],
    },
};

const trackApplicationDeclaration: FunctionDeclaration = {
    name: 'track_application',
    description:
        'Add a job application to the local application tracker (a Teal/Huntr killer). Records the company, role, ' +
        'status, optional notes, and optional URL so the user can follow every opportunity in one place. Use this ' +
        'whenever the user applies somewhere or wants to log a prospect.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            company: {
                type: Type.STRING,
                description: 'The company being applied to.',
            },
            role: {
                type: Type.STRING,
                description: 'The role/position being applied for.',
            },
            status: {
                type: Type.STRING,
                description: "Initial status: one of 'applied', 'interviewing', 'offer', 'rejected', 'accepted'. Defaults to 'applied'.",
            },
            notes: {
                type: Type.STRING,
                description: 'Optional free-form notes (recruiter name, referral, salary range, etc.).',
            },
            url: {
                type: Type.STRING,
                description: 'Optional link to the job posting or application portal.',
            },
        },
        required: ['company', 'role'],
    },
};

const updateApplicationStatusDeclaration: FunctionDeclaration = {
    name: 'update_application_status',
    description:
        'Update the status of an existing tracked application by its id. Use this as the user moves through a ' +
        'pipeline — e.g. from "applied" to "interviewing" to "offer". Get the id from list_applications.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            id: {
                type: Type.STRING,
                description: 'The id of the application to update (from list_applications).',
            },
            status: {
                type: Type.STRING,
                description: "New status: one of 'applied', 'interviewing', 'offer', 'rejected', 'accepted'.",
            },
        },
        required: ['id', 'status'],
    },
};

const listApplicationsDeclaration: FunctionDeclaration = {
    name: 'list_applications',
    description:
        'List every tracked job application with a per-status breakdown (applied / interviewing / offer / rejected / ' +
        'accepted). Use this to review the pipeline, find an application id, or summarize the search for the user.',
    parameters: {
        type: Type.OBJECT,
        properties: {},
    },
};

const interviewPrepDeclaration: FunctionDeclaration = {
    name: 'interview_prep',
    description:
        'Generate a structured interview-prep kit (scaffold) for a given role — behavioral questions, role-tailored ' +
        'questions, a STAR reminder, smart questions to ask the interviewer, and tips. This is a pure, offline ' +
        'coaching tool; YOU then expand on each item and rehearse answers with the user.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            role: {
                type: Type.STRING,
                description: 'The role being interviewed for (e.g. "Software Engineer", "Sales Manager").',
            },
            company: {
                type: Type.STRING,
                description: 'Optional company name, for context.',
            },
            level: {
                type: Type.STRING,
                description: 'Optional seniority level (e.g. "junior", "senior", "staff"), for context.',
            },
        },
        required: ['role'],
    },
};

export const careerSkill: Skill = {
    name: 'careerSkill',
    description:
        'Career Suite — cover letters, application tracking, interview prep. Replaces Rezi/Teal. YOU write the cover ' +
        'letters; save_cover_letter persists them to the Mission Dashboard and (optionally) a file. track_application, ' +
        'update_application_status, and list_applications run a job-search pipeline, and interview_prep returns a ' +
        'tailored prep kit to coach the user through interviews. Complements resumeSkill / resumeTailorSkill.',
    tools: [
        saveCoverLetterDeclaration,
        trackApplicationDeclaration,
        updateApplicationStatusDeclaration,
        listApplicationsDeclaration,
        interviewPrepDeclaration,
    ],

    execute: async (toolName: string, args: any) => {
        if (toolName === 'save_cover_letter') {
            const company = String(args.company || '').trim();
            const role = String(args.role || '').trim();
            const content = String(args.content || '');
            if (!company || !role) {
                return { error: 'save_cover_letter requires both `company` and `role`.' };
            }
            if (!content.trim()) {
                return { error: 'save_cover_letter requires non-empty `content` (the cover letter you wrote).' };
            }

            const title = `${role} @ ${company}`;

            // Always push to the dashboard (no-op if Core offline).
            coreAdd('drafts', { kind: 'cover-letter', title, content, source: 'career-suite' });

            let file: string | null = null;
            let note: string | undefined;

            if (args.export_to_file) {
                const slug = slugify(`${company}-${role}`);
                const path = `~/Desktop/cover-letter-${slug}.md`;
                try {
                    const res = await coreWriteFile(path, content);
                    if (res && res.error) {
                        note = `File export failed: ${res.error}`;
                    } else {
                        file = res?.path || path;
                    }
                } catch (err: any) {
                    note = `File export failed: ${err?.message || 'Echo Core not available'}`;
                }
            }

            const savedToDashboard = isCoreConnected();
            const parts = [
                savedToDashboard
                    ? `Saved cover letter "${title}" to the Mission Dashboard.`
                    : `Queued cover letter "${title}" (Echo Core offline — it will not appear on the dashboard until reconnected).`,
            ];
            if (file) parts.push(`Exported to ${file}.`);
            if (note) parts.push(note);

            return {
                success: true,
                savedToDashboard,
                file,
                note,
                message: parts.join(' '),
            };
        }

        if (toolName === 'track_application') {
            const company = String(args.company || '').trim();
            const role = String(args.role || '').trim();
            if (!company || !role) {
                return { error: 'track_application requires both `company` and `role`.' };
            }
            const rawStatus = String(args.status || '').trim() as AppStatus;
            const status: AppStatus = VALID_STATUSES.includes(rawStatus) ? rawStatus : 'applied';

            const application: JobApplication = {
                id: crypto.randomUUID(),
                company,
                role,
                status,
                notes: args.notes != null ? String(args.notes) : undefined,
                url: args.url != null ? String(args.url) : undefined,
                updatedAt: Date.now(),
            };

            const apps = loadApplications();
            apps.push(application);
            saveApplications(apps);

            return { success: true, application, total: apps.length };
        }

        if (toolName === 'update_application_status') {
            const id = String(args.id || '').trim();
            if (!id) {
                return { error: 'update_application_status requires an `id`.' };
            }
            const rawStatus = String(args.status || '').trim() as AppStatus;
            if (!VALID_STATUSES.includes(rawStatus)) {
                return {
                    error: `update_application_status requires a valid \`status\` (one of: ${VALID_STATUSES.join(', ')}).`,
                };
            }

            const apps = loadApplications();
            const target = apps.find(a => a && a.id === id);
            if (!target) {
                return { error: `No tracked application found with id "${id}".` };
            }

            target.status = rawStatus;
            target.updatedAt = Date.now();
            saveApplications(apps);

            return { success: true, application: target };
        }

        if (toolName === 'list_applications') {
            const applications = loadApplications();
            return {
                applications,
                count: applications.length,
                byStatus: countByStatus(applications),
            };
        }

        if (toolName === 'interview_prep') {
            const role = String(args.role || '').trim();
            if (!role) {
                return { error: 'interview_prep requires a non-empty `role`.' };
            }
            const roleLower = role.toLowerCase();

            const behavioralQuestions = [
                'Tell me about yourself and what drew you to this role.',
                'Describe a time you faced a significant challenge at work and how you handled it.',
                'Tell me about a time you disagreed with a teammate or manager — what happened?',
                'Give an example of a goal you set and how you achieved it.',
                'Describe a mistake you made and what you learned from it.',
                'Tell me about a time you had to juggle competing priorities under a tight deadline.',
            ];

            let roleQuestions: string[];
            if (/engineer|developer|programmer|software/.test(roleLower)) {
                roleQuestions = [
                    'Walk me through how you would design a scalable system for a high-traffic service.',
                    'How do you approach debugging a production incident under pressure?',
                    'Describe your testing strategy and how you ensure code quality.',
                    'Tell me about a technical trade-off you made and why.',
                    'How do you stay current with new technologies and apply them responsibly?',
                ];
            } else if (/manager|lead|director|head of/.test(roleLower)) {
                roleQuestions = [
                    'How do you motivate and develop the people on your team?',
                    'Describe how you handle an underperforming team member.',
                    'How do you set priorities and align your team to company goals?',
                    'Tell me about a difficult decision you made as a leader.',
                    'How do you give and receive feedback effectively?',
                ];
            } else if (/sales|account executive|business development|bdr|sdr/.test(roleLower)) {
                roleQuestions = [
                    'Walk me through how you build and manage a sales pipeline.',
                    'Describe a deal you closed against tough odds — what was your approach?',
                    'How do you handle objections and rejection?',
                    'How have you performed against quota, and how do you forecast?',
                    'How do you research and qualify a prospect before reaching out?',
                ];
            } else {
                roleQuestions = [
                    `Why do you want to work in a ${role} role specifically?`,
                    `What does success look like in the first 90 days of a ${role} position?`,
                    'What skills or experience make you a strong fit for this role?',
                    'How do you measure the impact of your work?',
                    'Describe a project you are most proud of and your contribution.',
                ];
            }

            const questionsToAsk = [
                'What does success look like in this role over the first 6–12 months?',
                'How would you describe the team culture and how the team works together?',
                'What are the biggest challenges the team is facing right now?',
                'How is performance evaluated and what growth opportunities exist?',
                'What are the next steps in the interview process?',
            ];

            const tips = [
                'Research the company, its products, and recent news before the interview.',
                'Prepare 3–4 concrete stories you can adapt to multiple behavioral questions.',
                'Quantify your impact with numbers wherever possible.',
                'Practice answers out loud and keep them concise (1–2 minutes each).',
                'Have thoughtful questions ready — it signals genuine interest.',
                'Send a brief, personalized thank-you note within 24 hours.',
            ];

            return {
                role,
                behavioralQuestions,
                roleQuestions,
                starReminder: 'Use Situation-Task-Action-Result for behavioral answers.',
                questionsToAsk,
                tips,
            };
        }

        return { error: `Unknown tool: ${toolName}` };
    },
};

export default careerSkill;
