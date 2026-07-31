/**
 * qa/check.ts — tiny assertion collector used by scenarios.
 *
 * Deliberately NOT throw-based: a scenario registers many independent
 * checks via `t.check(...)`, all of which run and get reported even if an
 * earlier one failed, so a single scenario run gives a full picture rather
 * than stopping at the first broken assertion.
 */

export interface CheckResult {
    name: string;
    pass: boolean;
    detail?: string;
}

export class Checks {
    results: CheckResult[] = [];

    check(name: string, condition: boolean, detail?: string): void {
        this.results.push({ name, pass: condition, detail: condition ? undefined : detail });
    }

    equal(name: string, actual: unknown, expected: unknown): void {
        const pass = actual === expected;
        this.check(name, pass, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }

    includes(name: string, haystack: string | undefined | null, needle: string): void {
        const pass = typeof haystack === 'string' && haystack.includes(needle);
        this.check(name, pass, `expected string to include ${JSON.stringify(needle)}, got: ${JSON.stringify(haystack)?.slice(0, 200)}`);
    }

    get failures(): CheckResult[] {
        return this.results.filter(r => !r.pass);
    }
}
