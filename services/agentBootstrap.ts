/**
 * agentBootstrap.ts
 *
 * Centralizes "wire everything up" logic that depends on cross-cutting
 * services. Imported once on app boot.
 *
 *  - Registers all static skills into agentSkillService.
 *  - Loads dynamic skills from IndexedDB.
 *  - Registers the `propose_new_skill` built-in meta-tool.
 *  - Rehydrates pending reminders.
 */

import { agentSkillService, Skill, proposeNewSkillToolDeclaration } from './agentSkillService';
import githubSkill from '../skills/githubSkill';
import knowledgeSkill from '../skills/knowledgeSkill';
import ghostSkill from '../skills/ghostSkill';
import fileGenSkill from '../skills/fileGenSkill';
import reminderSkill from '../skills/reminderSkill';
import flightSkill from '../skills/flightSkill';
import webSkill from '../skills/webSkill';
import resumeSkill from '../skills/resumeSkill';
import resumeTailorSkill from '../skills/resumeTailorSkill';
import taskMissionSkill from '../skills/taskMissionSkill';
import projectOpsSkill from '../skills/projectOpsSkill';
import marketingPlannerSkill from '../skills/marketingPlannerSkill';
import calcSkill from '../skills/calcSkill';
import screenIntelSkill from '../skills/screenIntelSkill';
import jobHuntSkill from '../skills/jobHuntSkill';
import { dynamicSkillService, DynamicSkill } from './dynamicSkillService';
import { getOrCreateWorker, disposeWorker } from './dynamicSkillRunner';
import { reminderService } from './reminderService';
import { taskMissionService } from './taskMissionService';
import { agentPolicyService } from './agentPolicyService';

let booted = false;

/** Pending skill approval request (used by the modal). */
export interface PendingSkillApproval {
    id: string;
    name: string;
    purpose: string;
    description: string;
    schema: any;
    jsCode: string;
    requestedPermissions: string[];
}

type ApprovalDecision =
    | { approved: true; finalCode?: string; finalPermissions?: string[] }
    | { approved: false; reason?: string };

type ApprovalHandler = (req: PendingSkillApproval) => Promise<ApprovalDecision>;

let approvalHandler: ApprovalHandler | null = null;

export function setSkillApprovalHandler(handler: ApprovalHandler | null) {
    approvalHandler = handler;
}

async function defaultApprovalHandler(req: PendingSkillApproval): Promise<ApprovalDecision> {
    if (agentPolicyService.isYoloMode()) return { approved: true };
    try {
        const msg = `Echo wants to install a new skill: "${req.name}"\n\n${req.purpose}\n\nPermissions: ${req.requestedPermissions.join(', ') || 'none'}\n\nApprove?`;
        return { approved: window.confirm(msg) };
    } catch {
        return { approved: false, reason: 'No approval handler available.' };
    }
}

function safeParseSchema(json: string): any | null {
    try { return JSON.parse(json); } catch { return null; }
}

const proposeNewSkillImplementation: Skill = {
    name: 'propose_new_skill_builtin',
    description: 'Built-in meta-tool that lets the agent install new skills at runtime.',
    tools: [proposeNewSkillToolDeclaration],
    execute: async (toolName, args) => {
        if (toolName !== 'propose_new_skill') return { error: `Unknown tool ${toolName}` };
        const { name, purpose, schemaJSON, jsCode, requestedPermissions, testArgsJSON } = args || {};
        if (!name || !schemaJSON || !jsCode) {
            return { error: 'Missing required fields (name, schemaJSON, jsCode).' };
        }
        const schema = safeParseSchema(schemaJSON);
        if (!schema || !schema.name || !schema.parameters) {
            return { error: 'schemaJSON must be a valid FunctionDeclaration JSON string.' };
        }

        const req: PendingSkillApproval = {
            id: crypto.randomUUID(),
            name,
            purpose,
            description: schema.description || purpose || '',
            schema,
            jsCode,
            requestedPermissions: Array.isArray(requestedPermissions) ? requestedPermissions : [],
        };

        const handler = approvalHandler || defaultApprovalHandler;
        const decision: ApprovalDecision = await handler(req);
        if (decision.approved !== true) {
            const reason = (decision as { reason?: string }).reason;
            return { ok: false, error: reason || 'Skill rejected by user.' };
        }

        const ds: DynamicSkill = {
            id: req.id,
            name,
            description: req.description,
            schema: req.schema,
            jsCode: decision.finalCode || req.jsCode,
            permissions: {
                fetchAllowlist: decision.finalPermissions || req.requestedPermissions,
            },
            createdAt: Date.now(),
            approvedAt: Date.now(),
        };

        // ── Sandbox self-test: run the skill against the model-supplied test
        //    args before installing. A skill that throws, returns an error
        //    shape, or times out never reaches the registry — the error goes
        //    back to the model so it can fix the code and re-propose.
        const testId = `selftest_${req.id}`;
        try {
            const testArgs = safeParseSchema(testArgsJSON || '{}') ?? {};
            const worker = getOrCreateWorker(testId, ds.jsCode, ds.permissions);
            const testResult = await worker.invoke(req.schema.name, testArgs);
            if (testResult && typeof testResult === 'object' && 'error' in testResult && testResult.error) {
                return { ok: false, error: `Self-test failed: skill returned error: ${testResult.error}. Fix the code and re-propose.` };
            }
            console.log(`[agentBootstrap] Skill "${name}" passed sandbox self-test:`, testResult);
        } catch (e: any) {
            return { ok: false, error: `Self-test failed: ${e?.message || e}. Fix the code and call propose_new_skill again.` };
        } finally {
            disposeWorker(testId);
        }

        try {
            await dynamicSkillService.upsert(ds);
            return {
                ok: true,
                message: `Skill "${name}" passed its sandbox self-test and is installed. Call it directly on the next turn.`,
                toolName: req.schema.name,
            };
        } catch (e: any) {
            return { ok: false, error: e?.message || String(e) };
        }
    },
};

export async function bootstrapAgent(): Promise<void> {
    if (booted) return;
    booted = true;

    // Static skills
    try {
        agentSkillService.registerSkill(githubSkill);
        agentSkillService.registerSkill(knowledgeSkill);
        agentSkillService.registerSkill(ghostSkill);
        agentSkillService.registerSkill(fileGenSkill);
        agentSkillService.registerSkill(reminderSkill);
        agentSkillService.registerSkill(flightSkill);
        agentSkillService.registerSkill(webSkill);
        agentSkillService.registerSkill(resumeSkill);
        agentSkillService.registerSkill(resumeTailorSkill);
        agentSkillService.registerSkill(taskMissionSkill);
        agentSkillService.registerSkill(projectOpsSkill);
        agentSkillService.registerSkill(marketingPlannerSkill);
        agentSkillService.registerSkill(calcSkill);
        agentSkillService.registerSkill(screenIntelSkill);
        agentSkillService.registerSkill(jobHuntSkill);
        agentSkillService.registerSkill(proposeNewSkillImplementation);
    } catch (e) {
        console.warn('[agentBootstrap] Some static skills failed to register:', e);
    }

    // Dynamic skills (loaded from IndexedDB)
    try {
        await dynamicSkillService.loadAndRegisterAll();
    } catch (e) {
        console.warn('[agentBootstrap] Failed to load dynamic skills:', e);
    }

    // Reminders
    try {
        reminderService.rehydrate();
    } catch (e) {
        console.warn('[agentBootstrap] reminder rehydrate failed:', e);
    }
    try {
        taskMissionService.rehydrate();
    } catch (e) {
        console.warn('[agentBootstrap] task mission rehydrate failed:', e);
    }
}
