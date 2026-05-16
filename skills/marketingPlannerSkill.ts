import { FunctionDeclaration, Type } from '@google/genai';
import { Skill } from '../services/agentSkillService';
import { marketingPlanService, MarketingChannel, MarketingOutputFormat } from '../services/marketingPlanService';

const generateMarketingPlanTool: FunctionDeclaration = {
    name: 'generate_marketing_plan',
    description:
        'Generate a channel-specific marketing plan (7/14/30-day calendar, sample drafts, KPIs, checklist) and download it as PDF/DOCX/MD/TXT.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            project_id: { type: Type.STRING },
            brief: { type: Type.STRING },
            channels: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Subset of: ['reddit','x','instagram','linkedin','tiktok'].",
            },
            objective: { type: Type.STRING },
            target_audience: { type: Type.STRING },
            budget_level: { type: Type.STRING, description: 'low | medium | high' },
            output_format: { type: Type.STRING, description: "One of: 'pdf' | 'docx' | 'md' | 'txt'." },
        },
        required: ['output_format'],
    },
};

const allowedChannels = new Set<MarketingChannel>(['reddit', 'x', 'instagram', 'linkedin', 'tiktok']);
const allowedFormats = new Set<MarketingOutputFormat>(['pdf', 'docx', 'md', 'txt']);

function compactPlan(plan: any) {
    return {
        id: plan.id,
        title: plan.title,
        createdAt: plan.createdAt,
        channels: plan.channels,
        objective: plan.objective,
        targetAudience: plan.targetAudience,
        budgetLevel: plan.budgetLevel,
        exportedFormat: plan.exportedFormat,
        exportedFilename: plan.exportedFilename,
        channelStrategy: plan.channelStrategy,
        calendar7: plan.calendar7,
        calendar14: plan.calendar14,
        calendar30: plan.calendar30,
        sampleDrafts: plan.sampleDrafts,
        kpis: plan.kpis,
        executionChecklist: plan.executionChecklist,
    };
}

const marketingPlannerSkill: Skill = {
    name: 'marketingPlannerSkill',
    description: 'Creates multi-channel marketing plans, downloads reports, and keeps local encrypted plan history.',
    tools: [generateMarketingPlanTool],
    execute: async (toolName: string, args: any): Promise<any> => {
        if (toolName !== 'generate_marketing_plan') return { ok: false, error: 'tool_not_found' };
        const format = String(args?.output_format || '').toLowerCase() as MarketingOutputFormat;
        if (!allowedFormats.has(format)) {
            return { ok: false, error: 'invalid_output_format' };
        }
        const channels = Array.isArray(args?.channels)
            ? args.channels.map((ch: string) => String(ch || '').toLowerCase()).filter((ch: MarketingChannel) => allowedChannels.has(ch))
            : undefined;

        const plan = await marketingPlanService.generatePlan({
            project_id: args?.project_id,
            brief: args?.brief,
            channels: channels as MarketingChannel[] | undefined,
            objective: args?.objective,
            target_audience: args?.target_audience,
            budget_level: args?.budget_level,
            output_format: format,
        });

        return {
            ok: true,
            downloadTriggered: true,
            plan: compactPlan(plan),
        };
    },
};

export default marketingPlannerSkill;
