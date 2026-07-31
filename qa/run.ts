/**
 * qa/run.ts — behavioral eval harness runner for Echo.
 *
 * Usage:  npx tsx qa/run.ts
 *
 * Runs every scenario in qa/scenarios/, against the REAL Echo services
 * (services/llmRouter.ts, services/echoChatService.ts,
 * services/agentSkillService.ts, services/modelContextBuilder.ts, ...) with
 * `fetch` swapped out for qa/mockLlm.ts's MockLlm, so assertions can inspect
 * the exact outbound request payload the app would have sent to a real
 * model provider. No test framework — this file IS the runner. Prints
 * OK/FAIL per assertion, a summary, and exits nonzero if anything failed.
 *
 * `import './shims'` MUST be the first import in this file — see
 * qa/shims.ts for why (it installs localStorage/window globals before any
 * services/* module gets evaluated).
 */
import './shims';
import { resetLocalStorage } from './shims';
import { MockLlm } from './mockLlm';
import type { Scenario } from './scenario';

import scenario01 from './scenarios/01_system_prompt_first';
import scenario02 from './scenarios/02_tool_schemas_included';
import scenario03 from './scenarios/03_tool_call_round_trip';
import scenario04 from './scenarios/04_tool_loop_hop_cap';
import scenario05 from './scenarios/05_streaming_tokens_match_final';
import scenario06 from './scenarios/06_local_only_memory_filtered_from_cloud';

const SCENARIOS: Scenario[] = [scenario01, scenario02, scenario03, scenario04, scenario05, scenario06];

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';

async function main() {
    let totalPass = 0;
    let totalFail = 0;
    let scenarioFailCount = 0;

    console.log(`${BOLD}Echo QA harness — ${SCENARIOS.length} scenario(s)${RESET}\n`);

    for (const scenario of SCENARIOS) {
        console.log(`${BOLD}▶ ${scenario.name}${RESET}`);
        console.log(`${DIM}  ${scenario.description}${RESET}`);

        resetLocalStorage();
        const mock = new MockLlm();
        (globalThis as any).fetch = mock.fetch;

        const { Checks } = await import('./check');
        const t = new Checks();

        try {
            await scenario.run(t, mock);
        } catch (err: any) {
            t.check('scenario ran to completion without throwing', false, err?.stack || String(err));
        }

        for (const r of t.results) {
            if (r.pass) {
                totalPass++;
                console.log(`  ${GREEN}OK${RESET}   ${r.name}`);
            } else {
                totalFail++;
                console.log(`  ${RED}FAIL${RESET} ${r.name}`);
                if (r.detail) console.log(`       ${DIM}${r.detail}${RESET}`);
            }
        }

        if (t.failures.length > 0) scenarioFailCount++;
        console.log('');
    }

    console.log(`${BOLD}────────────────────────────────────────${RESET}`);
    console.log(
        `${BOLD}${totalPass + totalFail} checks, ` +
        `${GREEN}${totalPass} passed${RESET}, ` +
        `${totalFail > 0 ? RED : ''}${totalFail} failed${RESET}${totalFail > 0 ? RESET : ''} ` +
        `across ${SCENARIOS.length} scenarios (${scenarioFailCount} with failures)`,
    );

    if (totalFail > 0) {
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error('Fatal error running QA harness:', err);
    process.exitCode = 1;
});
