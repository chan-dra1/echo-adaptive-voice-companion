/**
 * tier3Skills.ts — Tier 3 module registration point (parallel-build handoff).
 *
 * ⚡ THIS FILE IS OWNED BY THE TIER 3 BUILD (the other Claude).
 *
 * It exists so Tier 3 skills can be registered WITHOUT editing agentBootstrap.ts
 * (which the Tier 2 build owns) — avoiding file-collision between the two agents
 * working in the same workspace. agentBootstrap imports the default export below
 * and registers every skill in it.
 *
 * To add a Tier 3 skill:
 *   1. Create your skill file, e.g. skills/storefrontSkill.ts (export default).
 *   2. Import it here and add it to the array.
 *   3. Run `npm run build` to verify.
 *
 * See TIER3_HANDOFF.md in the repo root for the full brief.
 */

import { Skill } from '../services/agentSkillService';

import leadEnrichmentSkill from './leadEnrichmentSkill';   // kills 1Lookup (~$223k MRR)
import supportAgentSkill from './supportAgentSkill';       // kills Intercom/Zendesk-lite
import storefrontSkill from './storefrontSkill';           // kills Stan.store ($3.57M MRR)
import mediaStudioSkill from './mediaStudioSkill';         // kills Vid.AI / image SaaS

const tier3Skills: Skill[] = [
    leadEnrichmentSkill,
    supportAgentSkill,
    storefrontSkill,
    mediaStudioSkill,
];

export default tier3Skills;
