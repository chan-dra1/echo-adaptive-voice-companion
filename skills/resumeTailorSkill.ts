/**
 * resumeTailorSkill.ts
 *
 * Takes a job description (raw text or URL) + the user's base resume from
 * the Vault and produces an ATS-friendly tailored resume in pdf/docx/md/txt.
 *
 * Implementation:
 *   1. If a URL is given → use webSkill.read_webpage to extract text.
 *   2. Read base resume from localStorage 'echo_base_resume' (set by the
 *      Vault textarea).
 *   3. Ask the LLM router (provider = user's default brain) to produce a
 *      structured JSON tailored resume.
 *   4. Render that JSON to the requested format and trigger a download.
 */

import { FunctionDeclaration, Type } from "@google/genai";
import { Skill } from "../services/agentSkillService";
import webSkill from "./webSkill";
import { chat, chooseProvider } from "../services/llmRouter";
import { jsPDF } from "jspdf";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";

export const tailorResumeToolDeclaration: FunctionDeclaration = {
    name: "tailor_resume",
    description:
        "Tailor the user's base resume to a specific job description. Reads the user's base resume from the Vault, extracts ATS keywords from the JD, rewrites the resume to weave them in (truthfully — never fabricate experience), and downloads it in the requested format. PDF output is ATS-friendly (single column, standard fonts, no graphics).",
    parameters: {
        type: Type.OBJECT,
        properties: {
            job_description_or_url: {
                type: Type.STRING,
                description: "Either the full job-description text, or a URL to a job posting.",
            },
            target_format: {
                type: Type.STRING,
                description: "Output format: 'pdf', 'docx', 'txt', or 'md'.",
            },
            tone: {
                type: Type.STRING,
                description: "Optional tone hint (e.g. 'formal', 'energetic', 'concise').",
            },
            focus_keywords: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Optional keywords the user explicitly wants emphasized.",
            },
        },
        required: ["job_description_or_url", "target_format"],
    },
};

export const evaluateAtsToolDeclaration: FunctionDeclaration = {
    name: "evaluate_ats_score",
    description: "Evaluates the ATS (Applicant Tracking System) compatibility score of a resume against a specific job description. Returns a score from 0-100, identifies missing keywords, and provides specific feedback for improvement.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            resume_text: {
                type: Type.STRING,
                description: "The full text of the resume to evaluate.",
            },
            job_description_or_url: {
                type: Type.STRING,
                description: "The job description or URL to evaluate against.",
            },
        },
        required: ["resume_text", "job_description_or_url"],
    },
};

interface TailoredResumeJson {
    name?: string;
    contact?: string;
    summary: string;
    skills: string[];
    experience: Array<{
        role: string;
        company: string;
        dates?: string;
        bullets: string[];
    }>;
    education?: Array<{
        degree: string;
        school: string;
        dates?: string;
    }>;
    keywords_used: string[];
    missing_from_resume: string[];
    ats_score?: number;
    feedback?: string;
}

function looksLikeUrl(s: string): boolean {
    return /^https?:\/\//i.test(s.trim());
}

async function fetchJobDescription(input: string): Promise<string> {
    if (!looksLikeUrl(input)) return input;
    const res = await webSkill.execute('read_webpage', { url: input });
    if (typeof res === 'string') return res;
    return String(res);
}

async function generateTailoredJson(
    jd: string,
    baseResume: string,
    tone: string | undefined,
    focusKeywords: string[] | undefined,
): Promise<TailoredResumeJson> {
    const provider = chooseProvider();
    const system = [
        "You are an expert resume coach who optimizes resumes for Applicant Tracking Systems (ATS).",
        "Rules:",
        "- NEVER fabricate experience, employers, or dates. Only re-phrase existing material.",
        "- Preserve factual truthfulness from the base resume.",
        "- Weave in ATS keywords from the job description naturally in bullets and the summary.",
        "- Calculate an 'ats_score' (0-100) based on how well the tailored resume matches the JD.",
        "- Provide a brief 'feedback' string explaining the score and any remaining gaps.",
        "- Output STRICT JSON conforming to the schema in the user message. No prose, no markdown fences.",
    ].join('\n');

    const schemaDoc = {
        name: 'string?', contact: 'string?', summary: 'string',
        skills: ['string'],
        experience: [{ role: 'string', company: 'string', dates: 'string?', bullets: ['string'] }],
        education: [{ degree: 'string', school: 'string', dates: 'string?' }],
        keywords_used: ['string'],
        missing_from_resume: ['string'],
        ats_score: 'number (0-100)',
        feedback: 'string',
    };

    const user = [
        '[JOB DESCRIPTION]',
        jd.slice(0, 12_000),
        '',
        '[USER BASE RESUME]',
        baseResume.slice(0, 12_000),
        '',
        tone ? `[TONE] ${tone}` : '',
        focusKeywords && focusKeywords.length ? `[FOCUS KEYWORDS] ${focusKeywords.join(', ')}` : '',
        '',
        '[SCHEMA]',
        JSON.stringify(schemaDoc, null, 2),
        '',
        'Return JSON only.',
    ].filter(Boolean).join('\n');

    const { text } = await chat({
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
        ],
        provider,
        temperature: 0.4,
        json: true,
        maxTokens: 2500,
    });

    let cleaned = text.trim();
    if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```$/g, '').trim();
    }

    let parsed: any;
    try {
        parsed = JSON.parse(cleaned);
    } catch (e) {
        throw new Error(`LLM did not return valid JSON. First 200 chars: ${cleaned.slice(0, 200)}`);
    }

    const result: TailoredResumeJson = {
        name: parsed.name,
        contact: parsed.contact,
        summary: String(parsed.summary || ''),
        skills: Array.isArray(parsed.skills) ? parsed.skills.map(String) : [],
        experience: Array.isArray(parsed.experience) ? parsed.experience.map((x: any) => ({
            role: String(x.role || ''),
            company: String(x.company || ''),
            dates: x.dates ? String(x.dates) : undefined,
            bullets: Array.isArray(x.bullets) ? x.bullets.map(String) : [],
        })) : [],
        education: Array.isArray(parsed.education) ? parsed.education.map((x: any) => ({
            degree: String(x.degree || ''),
            school: String(x.school || ''),
            dates: x.dates ? String(x.dates) : undefined,
        })) : undefined,
        keywords_used: Array.isArray(parsed.keywords_used) ? parsed.keywords_used.map(String) : [],
        missing_from_resume: Array.isArray(parsed.missing_from_resume) ? parsed.missing_from_resume.map(String) : [],
        ats_score: typeof parsed.ats_score === 'number' ? parsed.ats_score : undefined,
        feedback: parsed.feedback ? String(parsed.feedback) : undefined,
    };
    return result;
}

function renderText(resume: TailoredResumeJson): string {
    const lines: string[] = [];
    if (resume.name) lines.push(resume.name);
    if (resume.contact) lines.push(resume.contact);
    if (lines.length) lines.push('');
    lines.push('SUMMARY');
    lines.push(resume.summary);
    lines.push('');
    if (resume.skills.length) {
        lines.push('SKILLS');
        lines.push(resume.skills.join(', '));
        lines.push('');
    }
    lines.push('EXPERIENCE');
    for (const exp of resume.experience) {
        lines.push(`${exp.role} — ${exp.company}${exp.dates ? '  (' + exp.dates + ')' : ''}`);
        for (const b of exp.bullets) lines.push(`  • ${b}`);
        lines.push('');
    }
    if (resume.education?.length) {
        lines.push('EDUCATION');
        for (const ed of resume.education) {
            lines.push(`${ed.degree} — ${ed.school}${ed.dates ? '  (' + ed.dates + ')' : ''}`);
        }
        lines.push('');
    }
    return lines.join('\n').trim();
}

function renderMarkdown(resume: TailoredResumeJson): string {
    const lines: string[] = [];
    if (resume.name) lines.push(`# ${resume.name}`);
    if (resume.contact) lines.push(`*${resume.contact}*`);
    if (resume.name || resume.contact) lines.push('');
    lines.push('## Summary');
    lines.push(resume.summary);
    lines.push('');
    if (resume.skills.length) {
        lines.push('## Skills');
        lines.push(resume.skills.join(' · '));
        lines.push('');
    }
    lines.push('## Experience');
    for (const exp of resume.experience) {
        lines.push(`### ${exp.role} — ${exp.company}${exp.dates ? ` (${exp.dates})` : ''}`);
        for (const b of exp.bullets) lines.push(`- ${b}`);
        lines.push('');
    }
    if (resume.education?.length) {
        lines.push('## Education');
        for (const ed of resume.education) {
            lines.push(`- ${ed.degree} — ${ed.school}${ed.dates ? ` (${ed.dates})` : ''}`);
        }
    }
    return lines.join('\n').trim();
}

function renderPdf(resume: TailoredResumeJson): Blob {
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const marginX = 54;
    let y = 56;
    const width = 612 - marginX * 2;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    if (resume.name) {
        doc.text(resume.name, marginX, y);
        y += 22;
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    if (resume.contact) {
        doc.text(resume.contact, marginX, y);
        y += 18;
    }

    const writeHeading = (text: string) => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.text(text.toUpperCase(), marginX, y);
        y += 6;
        doc.setLineWidth(0.5);
        doc.line(marginX, y, marginX + width, y);
        y += 12;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
    };

    const writeWrapped = (text: string) => {
        const lines = doc.splitTextToSize(text, width);
        if (y + lines.length * 12 > 760) { doc.addPage(); y = 56; }
        doc.text(lines, marginX, y);
        y += lines.length * 12;
    };

    writeHeading('Summary');
    writeWrapped(resume.summary);
    y += 6;

    if (resume.skills.length) {
        writeHeading('Skills');
        writeWrapped(resume.skills.join(' · '));
        y += 6;
    }

    writeHeading('Experience');
    for (const exp of resume.experience) {
        if (y > 740) { doc.addPage(); y = 56; }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        const header = `${exp.role} — ${exp.company}${exp.dates ? '  (' + exp.dates + ')' : ''}`;
        doc.text(header, marginX, y);
        y += 14;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        for (const b of exp.bullets) {
            writeWrapped(`• ${b}`);
        }
        y += 4;
    }

    if (resume.education?.length) {
        writeHeading('Education');
        for (const ed of resume.education) {
            writeWrapped(`${ed.degree} — ${ed.school}${ed.dates ? '  (' + ed.dates + ')' : ''}`);
        }
    }

    return doc.output('blob');
}

async function renderDocx(resume: TailoredResumeJson): Promise<Blob> {
    const children: Paragraph[] = [];

    if (resume.name) {
        children.push(new Paragraph({
            children: [new TextRun({ text: resume.name, bold: true, size: 36 })],
        }));
    }
    if (resume.contact) {
        children.push(new Paragraph({
            children: [new TextRun({ text: resume.contact, size: 20 })],
        }));
    }

    children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: 'Summary', bold: true })],
    }));
    children.push(new Paragraph({ children: [new TextRun({ text: resume.summary })] }));

    if (resume.skills.length) {
        children.push(new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun({ text: 'Skills', bold: true })],
        }));
        children.push(new Paragraph({ children: [new TextRun({ text: resume.skills.join(' · ') })] }));
    }

    children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: 'Experience', bold: true })],
    }));
    for (const exp of resume.experience) {
        children.push(new Paragraph({
            children: [new TextRun({
                text: `${exp.role} — ${exp.company}${exp.dates ? '  (' + exp.dates + ')' : ''}`,
                bold: true,
            })],
        }));
        for (const b of exp.bullets) {
            children.push(new Paragraph({
                bullet: { level: 0 },
                children: [new TextRun({ text: b })],
            }));
        }
    }

    if (resume.education?.length) {
        children.push(new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun({ text: 'Education', bold: true })],
        }));
        for (const ed of resume.education) {
            children.push(new Paragraph({
                children: [new TextRun({
                    text: `${ed.degree} — ${ed.school}${ed.dates ? '  (' + ed.dates + ')' : ''}`,
                })],
            }));
        }
    }

    const doc = new Document({ sections: [{ properties: {}, children }] });
    return Packer.toBlob(doc);
}

function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const resumeTailorSkill: Skill = {
    name: 'resumeTailorSkill',
    description: 'Tailor the user base resume to a specific JD with ATS keyword optimization.',
    tools: [tailorResumeToolDeclaration, evaluateAtsToolDeclaration],

    execute: async (toolName, args) => {
        if (toolName === 'evaluate_ats_score') {
            const { resume_text, job_description_or_url } = args || {};
            let jd: string;
            try {
                jd = await fetchJobDescription(String(job_description_or_url || ''));
            } catch (e: any) {
                return { error: `Failed to load job description: ${e?.message || e}` };
            }

            const provider = chooseProvider();
            const { text } = await chat({
                messages: [
                    { 
                        role: 'system', 
                        content: 'You are an ATS (Applicant Tracking System) scanner. Analyze the resume against the job description. Return a JSON object with: { "score": number (0-100), "matched_keywords": string[], "missing_keywords": string[], "feedback": string }' 
                    },
                    { 
                        role: 'user', 
                        content: `[RESUME]\n${resume_text}\n\n[JOB DESCRIPTION]\n${jd}` 
                    }
                ],
                provider,
                json: true
            });

            try {
                return JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());
            } catch (e) {
                return { error: 'Failed to parse ATS evaluation result.' };
            }
        }

        if (toolName !== 'tailor_resume') return { error: `Unknown tool ${toolName}` };

        const baseResume = (localStorage.getItem('echo_base_resume') || '').trim();
        if (!baseResume) {
            return {
                error: 'no_base_resume',
                message: 'The user has not saved a base resume. Ask them to open the Settings Vault and paste their resume into the "Career Node" textarea.',
            };
        }

        const { job_description_or_url, target_format, tone, focus_keywords } = args || {};
        const fmt = String(target_format || 'pdf').toLowerCase();
        if (!['pdf', 'docx', 'md', 'txt'].includes(fmt)) {
            return { error: `Unsupported target_format "${fmt}". Must be one of pdf, docx, md, txt.` };
        }

        let jd: string;
        try {
            jd = await fetchJobDescription(String(job_description_or_url || ''));
        } catch (e: any) {
            return { error: `Failed to load job description: ${e?.message || e}` };
        }
        if (!jd || jd.trim().length < 30) {
            return { error: 'Job description is empty or too short to tailor against.' };
        }

        let resume: TailoredResumeJson;
        try {
            resume = await generateTailoredJson(jd, baseResume, tone, focus_keywords);
        } catch (e: any) {
            return { error: `LLM tailoring failed: ${e?.message || e}` };
        }

        const stamp = new Date().toISOString().slice(0, 10);
        const basename = `tailored-resume-${stamp}`;
        try {
            if (fmt === 'pdf') {
                triggerDownload(renderPdf(resume), `${basename}.pdf`);
            } else if (fmt === 'docx') {
                triggerDownload(await renderDocx(resume), `${basename}.docx`);
            } else if (fmt === 'md') {
                triggerDownload(new Blob([renderMarkdown(resume)], { type: 'text/markdown' }), `${basename}.md`);
            } else {
                triggerDownload(new Blob([renderText(resume)], { type: 'text/plain' }), `${basename}.txt`);
            }
        } catch (e: any) {
            return { error: `Failed to render ${fmt}: ${e?.message || e}` };
        }

        return {
            downloadTriggered: true,
            format: fmt,
            summary: resume.summary,
            atsScore: resume.ats_score,
            feedback: resume.feedback,
            keywordsUsed: resume.keywords_used,
            missingFromResume: resume.missing_from_resume,
            message: `Resume tailored & downloaded as ${basename}.${fmt}. You can find it in your device's Downloads folder.`,
        };
    },
};

export default resumeTailorSkill;
