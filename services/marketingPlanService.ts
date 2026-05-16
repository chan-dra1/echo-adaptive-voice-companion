import { jsPDF } from 'jspdf';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { getCached, setCached } from './cryptoService';
import { chat } from './llmRouter';
import { pickCheapModel, temperatureFor, tokenBudget } from './costPolicy';
import { projectOpsService } from './projectOpsService';

const HISTORY_KEY = 'echo_marketing_plan_history';

export type MarketingChannel = 'reddit' | 'x' | 'instagram' | 'linkedin' | 'tiktok';
export type MarketingOutputFormat = 'pdf' | 'docx' | 'md' | 'txt';

export interface MarketingPlan {
    id: string;
    createdAt: number;
    projectId?: string;
    title: string;
    channels: MarketingChannel[];
    objective: string;
    targetAudience: string;
    budgetLevel: string;
    channelStrategy: Array<{ channel: MarketingChannel; strategy: string }>;
    calendar7: string[];
    calendar14: string[];
    calendar30: string[];
    sampleDrafts: Array<{ channel: MarketingChannel; draft: string }>;
    kpis: string[];
    executionChecklist: string[];
    exportedFormat: MarketingOutputFormat;
    exportedFilename: string;
}

interface GeneratePlanInput {
    project_id?: string;
    brief?: string;
    channels?: MarketingChannel[];
    objective?: string;
    target_audience?: string;
    budget_level?: string;
    output_format: MarketingOutputFormat;
}

function readHistory(): MarketingPlan[] {
    const rows = getCached<MarketingPlan[]>(HISTORY_KEY, []);
    return Array.isArray(rows) ? rows : [];
}

function saveHistory(rows: MarketingPlan[]): void {
    setCached(HISTORY_KEY, rows.slice(0, 20));
}

function triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function markdownForPlan(plan: MarketingPlan): string {
    return [
        `# ${plan.title}`,
        '',
        `Objective: ${plan.objective}`,
        `Target audience: ${plan.targetAudience}`,
        `Budget level: ${plan.budgetLevel}`,
        `Channels: ${plan.channels.join(', ')}`,
        '',
        '## Channel Strategy',
        ...plan.channelStrategy.map((entry) => `- ${entry.channel}: ${entry.strategy}`),
        '',
        '## 7-Day Calendar',
        ...plan.calendar7.map((line) => `- ${line}`),
        '',
        '## 14-Day Calendar',
        ...plan.calendar14.map((line) => `- ${line}`),
        '',
        '## 30-Day Calendar',
        ...plan.calendar30.map((line) => `- ${line}`),
        '',
        '## Sample Drafts',
        ...plan.sampleDrafts.map((entry) => `- ${entry.channel}: ${entry.draft}`),
        '',
        '## KPI Checklist',
        ...plan.kpis.map((line) => `- [ ] ${line}`),
        '',
        '## Execution Checklist',
        ...plan.executionChecklist.map((line) => `- [ ] ${line}`),
        '',
    ].join('\n');
}

function renderTxt(plan: MarketingPlan): Blob {
    const text = markdownForPlan(plan).replace(/[#*`]/g, '');
    return new Blob([text], { type: 'text/plain' });
}

function renderMd(plan: MarketingPlan): Blob {
    return new Blob([markdownForPlan(plan)], { type: 'text/markdown' });
}

function renderPdf(plan: MarketingPlan): Blob {
    const doc = new jsPDF();
    const text = markdownForPlan(plan);
    const lines = doc.splitTextToSize(text, 170);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(plan.title, 20, 20);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    let y = 30;
    for (const line of lines) {
        if (y > 285) {
            doc.addPage();
            y = 20;
        }
        doc.text(line, 20, y);
        y += 5;
    }
    return doc.output('blob');
}

async function renderDocx(plan: MarketingPlan): Promise<Blob> {
    const children: Paragraph[] = [];
    children.push(
        new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun({ text: plan.title, bold: true })],
        })
    );
    children.push(new Paragraph({ children: [new TextRun({ text: `Objective: ${plan.objective}` })] }));
    children.push(new Paragraph({ children: [new TextRun({ text: `Target audience: ${plan.targetAudience}` })] }));
    children.push(new Paragraph({ children: [new TextRun({ text: `Budget level: ${plan.budgetLevel}` })] }));
    children.push(new Paragraph({ children: [new TextRun({ text: `Channels: ${plan.channels.join(', ')}` })] }));

    const section = (title: string, lines: string[]) => {
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: title, bold: true })] }));
        for (const line of lines) {
            children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: line })] }));
        }
    };

    section('Channel Strategy', plan.channelStrategy.map((entry) => `${entry.channel}: ${entry.strategy}`));
    section('7-Day Calendar', plan.calendar7);
    section('14-Day Calendar', plan.calendar14);
    section('30-Day Calendar', plan.calendar30);
    section('Sample Drafts', plan.sampleDrafts.map((entry) => `${entry.channel}: ${entry.draft}`));
    section('KPI Checklist', plan.kpis);
    section('Execution Checklist', plan.executionChecklist);

    const doc = new Document({ sections: [{ properties: {}, children }] });
    return Packer.toBlob(doc);
}

async function buildStructuredPlan(input: GeneratePlanInput): Promise<Omit<MarketingPlan, 'id' | 'createdAt' | 'exportedFormat' | 'exportedFilename'>> {
    const channels = (input.channels && input.channels.length ? input.channels : ['reddit', 'x', 'instagram', 'linkedin']) as MarketingChannel[];
    const project = input.project_id ? projectOpsService.getProject(input.project_id) : null;
    const objective = input.objective || 'Generate demand and qualified leads.';
    const audience = input.target_audience || 'Prospects likely to buy in the next 30 days.';
    const budget = input.budget_level || 'medium';
    const sourceBrief = input.brief || project?.brief || project?.name || 'General campaign brief';
    const title = `${project?.name || 'Campaign'} Marketing Plan`;

    try {
        const modelPick = pickCheapModel('summarize');
        const prompt = [
            'Create a concise but practical marketing plan.',
            `Project: ${project?.name || 'n/a'}`,
            `Brief: ${sourceBrief}`,
            `Objective: ${objective}`,
            `Target audience: ${audience}`,
            `Budget level: ${budget}`,
            `Channels: ${channels.join(', ')}`,
            'Return strict JSON with keys:',
            'channelStrategy[{channel,strategy}], calendar7[string], calendar14[string], calendar30[string], sampleDrafts[{channel,draft}], kpis[string], executionChecklist[string].',
            'Limits: each array 5-10 items; keep lines under 140 chars.',
        ].join('\n');

        const result = await chat({
            provider: modelPick.provider,
            model: modelPick.model,
            temperature: temperatureFor('summarize'),
            maxTokens: tokenBudget('code'),
            json: true,
            messages: [
                { role: 'system', content: 'You create practical social-media growth plans with concrete execution details.' },
                { role: 'user', content: prompt },
            ],
        });
        const parsed = JSON.parse(result.text);
        return {
            title,
            projectId: project?.id,
            channels,
            objective,
            targetAudience: audience,
            budgetLevel: budget,
            channelStrategy: Array.isArray(parsed.channelStrategy) ? parsed.channelStrategy.slice(0, 10) : [],
            calendar7: Array.isArray(parsed.calendar7) ? parsed.calendar7.slice(0, 10) : [],
            calendar14: Array.isArray(parsed.calendar14) ? parsed.calendar14.slice(0, 10) : [],
            calendar30: Array.isArray(parsed.calendar30) ? parsed.calendar30.slice(0, 10) : [],
            sampleDrafts: Array.isArray(parsed.sampleDrafts) ? parsed.sampleDrafts.slice(0, 12) : [],
            kpis: Array.isArray(parsed.kpis) ? parsed.kpis.slice(0, 10) : [],
            executionChecklist: Array.isArray(parsed.executionChecklist) ? parsed.executionChecklist.slice(0, 12) : [],
        };
    } catch {
        const fallbackStrategies = channels.map((channel) => ({
            channel,
            strategy: `Publish 3 weekly posts on ${channel} focused on pain-point hooks, social proof, and CTA.`,
        }));
        return {
            title,
            projectId: project?.id,
            channels,
            objective,
            targetAudience: audience,
            budgetLevel: budget,
            channelStrategy: fallbackStrategies,
            calendar7: [
                'Day 1: Publish launch hook + CTA.',
                'Day 3: Share quick case study.',
                'Day 5: Post FAQ carousel/thread.',
                'Day 7: Push limited-time offer.',
            ],
            calendar14: [
                'Week 2: Repurpose best Day 1 post into video + text variants.',
                'Week 2: DM/comment outreach to warm audience segments.',
                'Week 2: Publish testimonial clip and direct CTA.',
            ],
            calendar30: [
                'Week 3: Launch educational mini-series.',
                'Week 4: Share measurable proof, then conversion push.',
                'Week 4: Run retrospective and iterate content winners.',
            ],
            sampleDrafts: channels.map((channel) => ({
                channel,
                draft: `On ${channel}: "If you are stuck with [problem], here is a 3-step fix we used this week. Want the full checklist? Reply 'plan'."`,
            })),
            kpis: [
                'Reach growth week-over-week',
                'Engagement rate by channel',
                'Clicks to landing page',
                'Lead form submissions',
                'Conversion rate to booked calls/sales',
            ],
            executionChecklist: [
                'Create content backlog for 2 weeks',
                'Assign owner and publish deadlines',
                'Batch-produce creative assets',
                'Track KPIs every 3 days',
                'Adjust based on top-performing posts',
            ],
        };
    }
}

class MarketingPlanService {
    listHistory(): MarketingPlan[] {
        return readHistory().sort((a, b) => b.createdAt - a.createdAt);
    }

    getPlan(planId: string): MarketingPlan | null {
        return this.listHistory().find((item) => item.id === planId) || null;
    }

    async generatePlan(input: GeneratePlanInput): Promise<MarketingPlan> {
        const format = input.output_format;
        if (!['pdf', 'docx', 'md', 'txt'].includes(format)) {
            throw new Error(`Unsupported output format "${format}".`);
        }
        const built = await buildStructuredPlan(input);
        const stamp = new Date().toISOString().slice(0, 10);
        const filename = `marketing-plan-${stamp}.${format}`;
        const plan: MarketingPlan = {
            id: crypto.randomUUID(),
            createdAt: Date.now(),
            ...built,
            exportedFormat: format,
            exportedFilename: filename,
        };

        let blob: Blob;
        if (format === 'pdf') blob = renderPdf(plan);
        else if (format === 'docx') blob = await renderDocx(plan);
        else if (format === 'md') blob = renderMd(plan);
        else blob = renderTxt(plan);
        triggerDownload(blob, filename);

        const history = readHistory();
        history.unshift(plan);
        saveHistory(history);
        return plan;
    }
}

export const marketingPlanService = new MarketingPlanService();
