/**
 * calcSkill.ts
 *
 * Deterministic, instant local math + structured odds/arbitrage research math.
 * No LLM round-trip. Pure local computation.
 *
 * Tools:
 *   - calc                 generic math expression evaluator
 *   - convert_units        unit conversions (length / mass / time / temperature / currency-static)
 *   - stats                array stats (mean, median, stddev, min, max, sum, quantile)
 *   - parse_and_compute    extract numbers/operators from natural language → calc
 *   - convert_odds         odds format conversion
 *   - implied_probability  implied probability from odds
 *   - remove_vig           de-vig a market into fair probabilities
 *   - arbitrage_check      detect arb across books + stake allocation
 *   - kelly_fraction       suggested Kelly fraction (capped fractional Kelly)
 *   - expected_value       EV per stake unit
 *   - hedge_calc           hedge stake to lock equal profit
 *
 * All odds tools return `disclaimer: "Informational only. Not financial advice."`.
 *
 * NO eval, NO Function, NO new dependencies.
 */

import { FunctionDeclaration, Type } from "@google/genai";
import { Skill } from "../services/agentSkillService";

const DISCLAIMER = "Informational only. Not financial advice.";

// ─────────────────────────────────────────────────────────────────────────────
// Safe math expression evaluator
// ─────────────────────────────────────────────────────────────────────────────

type TokenKind =
    | "num"
    | "op"
    | "lparen"
    | "rparen"
    | "comma"
    | "ident";
interface Token { kind: TokenKind; value: string; }

const OP_PREC: Record<string, { prec: number; assoc: "L" | "R" }> = {
    "+": { prec: 2, assoc: "L" },
    "-": { prec: 2, assoc: "L" },
    "*": { prec: 3, assoc: "L" },
    "/": { prec: 3, assoc: "L" },
    "%": { prec: 3, assoc: "L" },
    "^": { prec: 4, assoc: "R" },
    "u-": { prec: 5, assoc: "R" },
};

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
    sqrt: Math.sqrt,
    log: Math.log10,
    ln: Math.log,
    exp: Math.exp,
    abs: Math.abs,
    min: (...a: number[]) => Math.min(...a),
    max: (...a: number[]) => Math.max(...a),
    round: (x: number) => Math.round(x),
    floor: Math.floor,
    ceil: Math.ceil,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    pow: (a: number, b: number) => Math.pow(a, b),
};

const CONSTANTS: Record<string, number> = {
    pi: Math.PI,
    e: Math.E,
};

function tokenize(expr: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    const s = expr;
    while (i < s.length) {
        const c = s[i];
        if (c === " " || c === "\t" || c === "\n") { i++; continue; }
        if ((c >= "0" && c <= "9") || (c === "." && s[i + 1] >= "0" && s[i + 1] <= "9")) {
            let j = i;
            let dot = c === ".";
            while (j + 1 < s.length) {
                const nc = s[j + 1];
                if (nc >= "0" && nc <= "9") { j++; continue; }
                if (nc === "." && !dot) { dot = true; j++; continue; }
                if ((nc === "e" || nc === "E") && (s[j + 2] === "+" || s[j + 2] === "-" || (s[j + 2] >= "0" && s[j + 2] <= "9"))) {
                    j++; if (s[j + 1] === "+" || s[j + 1] === "-") j++; continue;
                }
                break;
            }
            tokens.push({ kind: "num", value: s.slice(i, j + 1) });
            i = j + 1;
            continue;
        }
        if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_") {
            let j = i;
            while (j + 1 < s.length) {
                const nc = s[j + 1];
                if ((nc >= "a" && nc <= "z") || (nc >= "A" && nc <= "Z") || (nc >= "0" && nc <= "9") || nc === "_") { j++; continue; }
                break;
            }
            tokens.push({ kind: "ident", value: s.slice(i, j + 1).toLowerCase() });
            i = j + 1;
            continue;
        }
        if ("+-*/%^".includes(c)) { tokens.push({ kind: "op", value: c }); i++; continue; }
        if (c === "(") { tokens.push({ kind: "lparen", value: "(" }); i++; continue; }
        if (c === ")") { tokens.push({ kind: "rparen", value: ")" }); i++; continue; }
        if (c === ",") { tokens.push({ kind: "comma", value: "," }); i++; continue; }
        throw new Error(`Unexpected character '${c}' at ${i}`);
    }
    return tokens;
}

function toRpn(tokens: Token[]): Token[] {
    const output: Token[] = [];
    const stack: Token[] = [];
    const argCount: number[] = [];

    let prev: Token | null = null;

    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.kind === "num") {
            output.push(t);
        } else if (t.kind === "ident") {
            if (t.value in CONSTANTS) {
                output.push({ kind: "num", value: String(CONSTANTS[t.value]) });
            } else if (t.value in FUNCTIONS) {
                stack.push({ kind: "ident", value: t.value });
                argCount.push(1);
                if (tokens[i + 1]?.kind !== "lparen") {
                    throw new Error(`Function '${t.value}' must be followed by '('`);
                }
            } else {
                throw new Error(`Unknown identifier: '${t.value}'`);
            }
        } else if (t.kind === "comma") {
            while (stack.length && stack[stack.length - 1].kind !== "lparen") {
                output.push(stack.pop()!);
            }
            if (!stack.length) throw new Error("Misplaced comma");
            if (argCount.length) argCount[argCount.length - 1]++;
        } else if (t.kind === "op") {
            let op = t.value;
            // unary minus detection
            const prevIsValue = prev && (prev.kind === "num" || prev.kind === "rparen" || (prev.kind === "ident" && prev.value in CONSTANTS));
            if (op === "-" && !prevIsValue) op = "u-";
            if (op === "+" && !prevIsValue) { prev = t; continue; }
            const cur = OP_PREC[op];
            while (stack.length) {
                const top = stack[stack.length - 1];
                if (top.kind === "op") {
                    const topInfo = OP_PREC[top.value];
                    if (!topInfo) break;
                    if (
                        (cur.assoc === "L" && cur.prec <= topInfo.prec) ||
                        (cur.assoc === "R" && cur.prec < topInfo.prec)
                    ) {
                        output.push(stack.pop()!);
                        continue;
                    }
                }
                break;
            }
            stack.push({ kind: "op", value: op });
        } else if (t.kind === "lparen") {
            stack.push(t);
        } else if (t.kind === "rparen") {
            while (stack.length && stack[stack.length - 1].kind !== "lparen") {
                output.push(stack.pop()!);
            }
            if (!stack.length) throw new Error("Mismatched parentheses");
            stack.pop(); // remove lparen
            if (stack.length && stack[stack.length - 1].kind === "ident") {
                const fn = stack.pop()!;
                const argc = argCount.pop() || 1;
                output.push({ kind: "ident", value: `${fn.value}|${argc}` });
            }
        }
        prev = t;
    }
    while (stack.length) {
        const top = stack.pop()!;
        if (top.kind === "lparen" || top.kind === "rparen") throw new Error("Mismatched parentheses");
        output.push(top);
    }
    return output;
}

function evalRpn(rpn: Token[]): number {
    const stack: number[] = [];
    for (const t of rpn) {
        if (t.kind === "num") {
            const n = Number(t.value);
            if (!Number.isFinite(n)) throw new Error(`Invalid number: ${t.value}`);
            stack.push(n);
        } else if (t.kind === "op") {
            if (t.value === "u-") {
                const a = stack.pop();
                if (a === undefined) throw new Error("Stack underflow");
                stack.push(-a);
                continue;
            }
            const b = stack.pop();
            const a = stack.pop();
            if (a === undefined || b === undefined) throw new Error("Stack underflow");
            switch (t.value) {
                case "+": stack.push(a + b); break;
                case "-": stack.push(a - b); break;
                case "*": stack.push(a * b); break;
                case "/":
                    if (b === 0) throw new Error("Division by zero");
                    stack.push(a / b); break;
                case "%":
                    if (b === 0) throw new Error("Modulo by zero");
                    stack.push(a % b); break;
                case "^": stack.push(Math.pow(a, b)); break;
                default: throw new Error(`Unknown operator: ${t.value}`);
            }
        } else if (t.kind === "ident") {
            const [fn, argcStr] = t.value.split("|");
            const argc = parseInt(argcStr, 10) || 1;
            const fnImpl = FUNCTIONS[fn];
            if (!fnImpl) throw new Error(`Unknown function: ${fn}`);
            if (stack.length < argc) throw new Error(`Not enough arguments for ${fn}`);
            const args = stack.splice(stack.length - argc, argc);
            stack.push(fnImpl(...args));
        }
    }
    if (stack.length !== 1) throw new Error("Invalid expression");
    return stack[0];
}

function safeEval(expr: string): number {
    if (typeof expr !== "string") throw new Error("Expression must be a string");
    if (expr.length > 4000) throw new Error("Expression too long");
    const rpn = toRpn(tokenize(expr));
    return evalRpn(rpn);
}

function roundTo(n: number, precision: number): number {
    if (!Number.isFinite(precision) || precision < 0) precision = 6;
    if (precision > 12) precision = 12;
    const f = Math.pow(10, precision);
    return Math.round(n * f) / f;
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit conversion tables (pure local)
// ─────────────────────────────────────────────────────────────────────────────

const LENGTH_TO_METERS: Record<string, number> = {
    m: 1, meter: 1, meters: 1,
    km: 1000, kilometer: 1000, kilometers: 1000,
    cm: 0.01, centimeter: 0.01, centimeters: 0.01,
    mm: 0.001, millimeter: 0.001, millimeters: 0.001,
    mi: 1609.344, mile: 1609.344, miles: 1609.344,
    yd: 0.9144, yard: 0.9144, yards: 0.9144,
    ft: 0.3048, foot: 0.3048, feet: 0.3048,
    in: 0.0254, inch: 0.0254, inches: 0.0254,
    nmi: 1852, nauticalmile: 1852,
};

const MASS_TO_KG: Record<string, number> = {
    kg: 1, kilogram: 1, kilograms: 1,
    g: 0.001, gram: 0.001, grams: 0.001,
    mg: 0.000001, milligram: 0.000001,
    lb: 0.45359237, lbs: 0.45359237, pound: 0.45359237, pounds: 0.45359237,
    oz: 0.0283495231, ounce: 0.0283495231, ounces: 0.0283495231,
    t: 1000, ton: 1000, tonne: 1000, tonnes: 1000,
    st: 6.35029318, stone: 6.35029318, stones: 6.35029318,
};

const TIME_TO_SECONDS: Record<string, number> = {
    s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
    ms: 0.001, millisecond: 0.001, milliseconds: 0.001,
    min: 60, mins: 60, minute: 60, minutes: 60,
    h: 3600, hr: 3600, hour: 3600, hours: 3600,
    d: 86400, day: 86400, days: 86400,
    w: 604800, week: 604800, weeks: 604800,
};

// Static currency table (USD = 1). Note: snapshot, not live. Caller is warned.
const CURRENCY_TO_USD: Record<string, number> = {
    usd: 1,
    eur: 1.08,
    gbp: 1.27,
    cad: 0.74,
    aud: 0.66,
    jpy: 0.0064,
    inr: 0.012,
    cny: 0.14,
    mxn: 0.058,
    brl: 0.20,
    chf: 1.12,
    krw: 0.00073,
    sek: 0.094,
    nzd: 0.61,
};

function temperatureConvert(value: number, from: string, to: string): number {
    const norm = (u: string) => u.toLowerCase().replace(/^°/, "").replace(/^deg/, "");
    const f = norm(from);
    const t = norm(to);
    let celsius: number;
    if (f === "c" || f === "celsius") celsius = value;
    else if (f === "f" || f === "fahrenheit") celsius = (value - 32) * 5 / 9;
    else if (f === "k" || f === "kelvin") celsius = value - 273.15;
    else throw new Error(`Unknown temperature unit: ${from}`);
    if (t === "c" || t === "celsius") return celsius;
    if (t === "f" || t === "fahrenheit") return celsius * 9 / 5 + 32;
    if (t === "k" || t === "kelvin") return celsius + 273.15;
    throw new Error(`Unknown temperature unit: ${to}`);
}

function detectUnitCategory(unit: string): "length" | "mass" | "time" | "temperature" | "currency" | null {
    const u = unit.toLowerCase().replace(/^°/, "");
    if (u in LENGTH_TO_METERS) return "length";
    if (u in MASS_TO_KG) return "mass";
    if (u in TIME_TO_SECONDS) return "time";
    if (["c", "f", "k", "celsius", "fahrenheit", "kelvin", "degc", "degf", "degk"].includes(u)) return "temperature";
    if (u in CURRENCY_TO_USD) return "currency";
    return null;
}

function convertUnits(value: number, from: string, to: string): { value: number; category: string; note?: string } {
    const fc = detectUnitCategory(from);
    const tc = detectUnitCategory(to);
    if (!fc || !tc) throw new Error(`Unknown unit(s): from='${from}' to='${to}'`);
    if (fc !== tc) throw new Error(`Cannot convert across categories: ${fc} → ${tc}`);
    const f = from.toLowerCase().replace(/^°/, "");
    const t = to.toLowerCase().replace(/^°/, "");
    if (fc === "length") return { value: (value * LENGTH_TO_METERS[f]) / LENGTH_TO_METERS[t], category: "length" };
    if (fc === "mass") return { value: (value * MASS_TO_KG[f]) / MASS_TO_KG[t], category: "mass" };
    if (fc === "time") return { value: (value * TIME_TO_SECONDS[f]) / TIME_TO_SECONDS[t], category: "time" };
    if (fc === "temperature") return { value: temperatureConvert(value, from, to), category: "temperature" };
    if (fc === "currency") {
        const usd = value * CURRENCY_TO_USD[f];
        return {
            value: usd / CURRENCY_TO_USD[t],
            category: "currency",
            note: "Static FX snapshot — not live. Use a market tool for live FX.",
        };
    }
    throw new Error(`Unsupported category: ${fc}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Stats
// ─────────────────────────────────────────────────────────────────────────────

function statsCompute(values: number[], ops?: string[]) {
    if (!Array.isArray(values) || values.length === 0) throw new Error("values must be a non-empty array");
    const nums = values.map(v => {
        const n = typeof v === "number" ? v : Number(v);
        if (!Number.isFinite(n)) throw new Error(`Non-numeric value: ${v}`);
        return n;
    });
    const wanted = (ops && ops.length) ? ops : ["mean", "median", "stddev", "min", "max", "sum"];
    const sorted = [...nums].sort((a, b) => a - b);
    const sum = nums.reduce((s, x) => s + x, 0);
    const mean = sum / nums.length;
    const variance = nums.reduce((s, x) => s + (x - mean) ** 2, 0) / nums.length;
    const stddev = Math.sqrt(variance);
    const median = sorted.length % 2
        ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    const out: Record<string, number> = {};
    for (const op of wanted) {
        if (op === "mean") out.mean = mean;
        else if (op === "median") out.median = median;
        else if (op === "stddev") out.stddev = stddev;
        else if (op === "variance") out.variance = variance;
        else if (op === "min") out.min = sorted[0];
        else if (op === "max") out.max = sorted[sorted.length - 1];
        else if (op === "sum") out.sum = sum;
        else if (op === "count") out.count = nums.length;
        else if (op.startsWith("quantile:")) {
            const q = Number(op.slice(9));
            if (!Number.isFinite(q) || q < 0 || q > 1) throw new Error(`Invalid quantile: ${op}`);
            const idx = q * (sorted.length - 1);
            const lo = Math.floor(idx);
            const hi = Math.ceil(idx);
            out[`quantile_${q}`] = sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
        }
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse-and-compute (natural language → expression)
// ─────────────────────────────────────────────────────────────────────────────

function parseAndCompute(text: string): { expression: string; result: number; steps: string[] } {
    if (typeof text !== "string") throw new Error("text must be a string");
    let s = " " + text.toLowerCase() + " ";
    const steps: string[] = [`Input: "${text}"`];
    // Normalize words to operators
    const replacements: Array<[RegExp, string]> = [
        [/\bplus\b|\band\b|\bsum of\b/g, "+"],
        [/\bminus\b|\bless\b|\bsubtract(?:ed)?(?:\sfrom)?\b/g, "-"],
        [/\btimes\b|\bmultiplied by\b|\bmultiply by\b|\bof\b/g, "*"],
        [/\bdivided by\b|\bover\b/g, "/"],
        [/\bsquared\b/g, "^2"],
        [/\bcubed\b/g, "^3"],
        [/\bto the power of\b|\braised to\b/g, "^"],
        [/\bmod(?:ulo)?\b/g, "%"],
        [/\bpercent of\b/g, "% *"],
        [/\bpercent\b/g, "%"],
    ];
    for (const [re, rep] of replacements) s = s.replace(re, rep);
    // x% → (x/100). Only when not directly followed by another * (the "percent of" expansion uses % *)
    s = s.replace(/(\d+(?:\.\d+)?)\s*%\s*\*/g, "($1/100)*");
    s = s.replace(/(\d+(?:\.\d+)?)\s*%/g, "($1/100)");
    // Drop filler words
    s = s.replace(/\b(is|equals?|what'?s|whats|calculate|compute|the|please|how much)\b/g, " ");
    // Keep only allowed chars
    const cleaned = s.replace(/[^0-9.+\-*/%^()\s\sa-z_,]/g, " ").replace(/\s+/g, " ").trim();
    steps.push(`Normalized: "${cleaned}"`);
    // Strip stray identifiers we don't support
    const safe = cleaned.replace(/\b(?!(?:sqrt|log|ln|exp|abs|min|max|round|floor|ceil|sin|cos|tan|pow|pi|e)\b)[a-z_]+\b/g, " ").replace(/\s+/g, " ").trim();
    steps.push(`Expression: "${safe}"`);
    if (!safe) throw new Error("Could not extract a math expression from the text");
    const result = safeEval(safe);
    steps.push(`Result: ${result}`);
    return { expression: safe, result, steps };
}

// ─────────────────────────────────────────────────────────────────────────────
// Odds math
// ─────────────────────────────────────────────────────────────────────────────

type OddsFormat = "decimal" | "american" | "fractional" | "implied";

function parseFractional(s: string): number {
    // "5/2" → 2.5 + 1 = 3.5 decimal odds
    const m = String(s).trim().match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
    if (!m) throw new Error(`Invalid fractional odds: '${s}'`);
    const num = Number(m[1]);
    const den = Number(m[2]);
    if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) throw new Error(`Invalid fractional odds: '${s}'`);
    return num / den + 1;
}

function toDecimal(input: string | number, format: OddsFormat): number {
    if (format === "decimal") {
        const n = Number(input);
        if (!Number.isFinite(n) || n < 1.0001) throw new Error(`Invalid decimal odds: '${input}'`);
        return n;
    }
    if (format === "american") {
        const n = Number(input);
        if (!Number.isFinite(n) || n === 0) throw new Error(`Invalid american odds: '${input}'`);
        return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
    }
    if (format === "fractional") return parseFractional(String(input));
    if (format === "implied") {
        // implied probability 0-1 or 0-100. Normalize.
        let p = Number(input);
        if (!Number.isFinite(p) || p <= 0) throw new Error(`Invalid implied probability: '${input}'`);
        if (p > 1) p = p / 100;
        if (p >= 1) throw new Error("Implied probability must be < 1");
        return 1 / p;
    }
    throw new Error(`Unsupported format: ${format}`);
}

function decimalToAmerican(d: number): number {
    if (d >= 2) return Math.round((d - 1) * 100);
    return Math.round(-100 / (d - 1));
}

function decimalToFractional(d: number): string {
    const dec = d - 1;
    // Approximate with a denominator up to 100
    let bestNum = 1, bestDen = 1, bestErr = Infinity;
    for (let den = 1; den <= 100; den++) {
        const num = Math.round(dec * den);
        if (num <= 0) continue;
        const err = Math.abs(num / den - dec);
        if (err < bestErr) { bestErr = err; bestNum = num; bestDen = den; if (err < 1e-9) break; }
    }
    return `${bestNum}/${bestDen}`;
}

function impliedProb(d: number): number {
    return 1 / d;
}

function convertOdds(input: string | number, fromFormat: OddsFormat, to?: OddsFormat) {
    const dec = toDecimal(input, fromFormat);
    const out: Record<string, any> = {
        decimal: Number(dec.toFixed(6)),
        american: decimalToAmerican(dec),
        fractional: decimalToFractional(dec),
        implied: Number(impliedProb(dec).toFixed(6)),
        implied_percent: Number((impliedProb(dec) * 100).toFixed(4)),
    };
    if (to) out.requested = out[to];
    return out;
}

function removeVig(oddsList: Array<{ odds: string | number; format: OddsFormat }>, method: "proportional" | "power" = "proportional") {
    const decs = oddsList.map(o => toDecimal(o.odds, o.format));
    const probs = decs.map(d => 1 / d);
    const overround = probs.reduce((s, p) => s + p, 0);
    let fair: number[];
    if (method === "power") {
        // Solve sum(p_i^k) = 1 via bisection
        let lo = 0.1, hi = 5.0;
        const f = (k: number) => probs.reduce((s, p) => s + Math.pow(p, k), 0) - 1;
        for (let i = 0; i < 80; i++) {
            const mid = (lo + hi) / 2;
            if (f(mid) > 0) lo = mid; else hi = mid;
        }
        const k = (lo + hi) / 2;
        fair = probs.map(p => Math.pow(p, k));
    } else {
        fair = probs.map(p => p / overround);
    }
    return {
        method,
        overround: Number(overround.toFixed(6)),
        vig_percent: Number(((overround - 1) * 100).toFixed(4)),
        legs: oddsList.map((o, i) => ({
            input: { odds: o.odds, format: o.format, decimal: Number(decs[i].toFixed(6)) },
            raw_implied: Number(probs[i].toFixed(6)),
            fair_probability: Number(fair[i].toFixed(6)),
            fair_decimal_odds: Number((1 / fair[i]).toFixed(6)),
            fair_american_odds: decimalToAmerican(1 / fair[i]),
        })),
        disclaimer: DISCLAIMER,
    };
}

function arbitrageCheck(
    legs: Array<{ odds: string | number; format: OddsFormat; book?: string; label?: string }>,
    stakeTotal?: number,
    rounding?: number,
) {
    if (!Array.isArray(legs) || legs.length < 2) throw new Error("Need at least 2 legs");
    const decs = legs.map(l => toDecimal(l.odds, l.format));
    const inverses = decs.map(d => 1 / d);
    const sumInv = inverses.reduce((s, x) => s + x, 0);
    const arbExists = sumInv < 1;
    const total = stakeTotal && Number.isFinite(stakeTotal) && stakeTotal > 0 ? stakeTotal : 100;
    const stakes = inverses.map(x => (x / sumInv) * total);
    const profitIfWin = stakes.map((s, i) => s * decs[i] - total);
    const guaranteedProfit = arbExists ? (total / sumInv) - total : Math.min(...profitIfWin);
    const round = (x: number) => {
        const p = Number.isFinite(rounding as number) && (rounding as number) >= 0 ? (rounding as number) : 2;
        const f = Math.pow(10, p);
        return Math.round(x * f) / f;
    };
    return {
        arbitrage_exists: arbExists,
        sum_of_inverse_decimal: Number(sumInv.toFixed(6)),
        margin_percent: Number(((1 - sumInv) * 100).toFixed(4)),
        stake_total: total,
        legs: legs.map((l, i) => ({
            label: l.label || `leg_${i + 1}`,
            book: l.book,
            input: { odds: l.odds, format: l.format },
            decimal: Number(decs[i].toFixed(6)),
            stake: round(stakes[i]),
            payout_if_wins: round(stakes[i] * decs[i]),
            net_if_wins: round(profitIfWin[i]),
        })),
        guaranteed_profit: round(guaranteedProfit),
        guaranteed_profit_percent: Number(((guaranteedProfit / total) * 100).toFixed(4)),
        disclaimer: DISCLAIMER,
    };
}

function kellyFraction(prob: number, odds: string | number, format: OddsFormat, bankroll?: number, fractional?: number) {
    if (!Number.isFinite(prob) || prob <= 0 || prob >= 1) throw new Error("prob must be in (0,1)");
    const dec = toDecimal(odds, format);
    const b = dec - 1;
    const q = 1 - prob;
    let f = (b * prob - q) / b;
    if (!Number.isFinite(f)) f = 0;
    const frac = Number.isFinite(fractional as number) ? Math.max(0, Math.min(1, fractional as number)) : 0.25;
    const safe = Math.max(0, f * frac);
    const fullCapped = Math.max(0, Math.min(f, 1));
    return {
        full_kelly_fraction: Number(fullCapped.toFixed(6)),
        suggested_fraction: Number(safe.toFixed(6)),
        fractional_used: frac,
        edge: Number((b * prob - q).toFixed(6)),
        decimal_odds: Number(dec.toFixed(6)),
        recommended_stake: Number.isFinite(bankroll as number) && (bankroll as number) > 0
            ? Number((safe * (bankroll as number)).toFixed(2))
            : undefined,
        note: "Kelly is mathematically optimal but high variance. Fractional Kelly (e.g. 0.25) is widely used to reduce ruin risk.",
        disclaimer: DISCLAIMER,
    };
}

function expectedValue(prob: number, odds: string | number, format: OddsFormat, stake: number) {
    if (!Number.isFinite(prob) || prob <= 0 || prob >= 1) throw new Error("prob must be in (0,1)");
    if (!Number.isFinite(stake) || stake <= 0) throw new Error("stake must be > 0");
    const dec = toDecimal(odds, format);
    const winNet = stake * (dec - 1);
    const ev = prob * winNet - (1 - prob) * stake;
    return {
        ev: Number(ev.toFixed(6)),
        ev_per_unit: Number((ev / stake).toFixed(6)),
        ev_percent: Number(((ev / stake) * 100).toFixed(4)),
        win_net: Number(winNet.toFixed(6)),
        decimal_odds: Number(dec.toFixed(6)),
        prob,
        stake,
        disclaimer: DISCLAIMER,
    };
}

function hedgeCalc(
    legOdds: string | number, legFormat: OddsFormat, legStake: number,
    hedgeOdds: string | number, hedgeFormat: OddsFormat,
) {
    const oA = toDecimal(legOdds, legFormat);
    const oB = toDecimal(hedgeOdds, hedgeFormat);
    if (!Number.isFinite(legStake) || legStake <= 0) throw new Error("leg_stake must be > 0");
    // To equalize profit, choose hedge stake = (legStake * oA) / oB
    const hedgeStake = (legStake * oA) / oB;
    const payoutIfA = legStake * oA;
    const payoutIfB = hedgeStake * oB;
    const totalRisk = legStake + hedgeStake;
    const profitIfA = payoutIfA - totalRisk;
    const profitIfB = payoutIfB - totalRisk;
    return {
        leg: { odds: legOdds, format: legFormat, decimal: Number(oA.toFixed(6)), stake: legStake },
        hedge: { odds: hedgeOdds, format: hedgeFormat, decimal: Number(oB.toFixed(6)), stake: Number(hedgeStake.toFixed(2)) },
        total_risk: Number(totalRisk.toFixed(2)),
        profit_if_leg_wins: Number(profitIfA.toFixed(2)),
        profit_if_hedge_wins: Number(profitIfB.toFixed(2)),
        guaranteed: Math.min(profitIfA, profitIfB) >= 0,
        guaranteed_profit: Number(Math.min(profitIfA, profitIfB).toFixed(2)),
        note: "Equal-profit hedge sizing. Use partial hedge to keep upside on one side.",
        disclaimer: DISCLAIMER,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool declarations
// ─────────────────────────────────────────────────────────────────────────────

const calcDecl: FunctionDeclaration = {
    name: "calc",
    description: "Evaluate a math expression locally and deterministically. Supports + - * / % ^, parentheses, unary -, functions (sqrt log ln exp abs min max round floor ceil sin cos tan pow), constants (pi, e). USE THIS for any numeric work instead of computing mentally.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            expression: { type: Type.STRING, description: "Math expression, e.g. '(127 + 33*4) * 1.08'." },
            precision: { type: Type.NUMBER, description: "Decimal places to round to (default 6)." },
        },
        required: ["expression"],
    },
};

const convertUnitsDecl: FunctionDeclaration = {
    name: "convert_units",
    description: "Convert a numeric value between units. Categories: length (m, km, mi, ft, in, ...), mass (kg, lb, oz, ...), time (s, min, h, d, ...), temperature (C/F/K), currency (USD/EUR/... — STATIC snapshot, not live).",
    parameters: {
        type: Type.OBJECT,
        properties: {
            value: { type: Type.NUMBER, description: "Numeric value to convert." },
            from: { type: Type.STRING, description: "Source unit (e.g. 'mi', 'kg', 'C', 'USD')." },
            to: { type: Type.STRING, description: "Destination unit." },
        },
        required: ["value", "from", "to"],
    },
};

const statsDecl: FunctionDeclaration = {
    name: "stats",
    description: "Compute descriptive statistics over an array of numbers. Supported ops: mean, median, stddev, variance, min, max, sum, count, 'quantile:<0..1>' (e.g. 'quantile:0.95').",
    parameters: {
        type: Type.OBJECT,
        properties: {
            values: { type: Type.ARRAY, items: { type: Type.NUMBER }, description: "Array of numbers." },
            ops: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Operations to run." },
        },
        required: ["values"],
    },
};

const parseAndComputeDecl: FunctionDeclaration = {
    name: "parse_and_compute",
    description: "Extract a math expression from a sentence and compute it. Handles words like 'plus', 'times', 'percent', 'squared', etc. Returns the derived expression + result.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            text: { type: Type.STRING, description: "Natural language describing a computation." },
        },
        required: ["text"],
    },
};

const convertOddsDecl: FunctionDeclaration = {
    name: "convert_odds",
    description: "Convert sports odds between decimal, american, fractional, and implied probability. Pure math, no advice.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            input: { type: Type.STRING, description: "Odds value, e.g. '2.50' (decimal), '+150' (american), '5/2' (fractional), '0.40' (implied)." },
            format: { type: Type.STRING, description: "'decimal' | 'american' | 'fractional' | 'implied'" },
            to: { type: Type.STRING, description: "Optional target format. If omitted, returns all formats." },
        },
        required: ["input", "format"],
    },
};

const impliedProbDecl: FunctionDeclaration = {
    name: "implied_probability",
    description: "Compute implied probability (0-1 and %) from odds in any format.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            odds: { type: Type.STRING, description: "Odds value." },
            format: { type: Type.STRING, description: "'decimal' | 'american' | 'fractional'." },
        },
        required: ["odds", "format"],
    },
};

const removeVigDecl: FunctionDeclaration = {
    name: "remove_vig",
    description: "Strip the bookmaker's vig from a two-way or three-way market and return fair probabilities and fair odds. Methods: 'proportional' (default) or 'power'.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            odds_list: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        odds: { type: Type.STRING, description: "Odds value." },
                        format: { type: Type.STRING, description: "'decimal' | 'american' | 'fractional'." },
                    },
                    required: ["odds", "format"],
                },
                description: "Two or three legs of a market.",
            },
            method: { type: Type.STRING, description: "'proportional' or 'power' (default proportional)." },
        },
        required: ["odds_list"],
    },
};

const arbCheckDecl: FunctionDeclaration = {
    name: "arbitrage_check",
    description: "Given two or more legs (opposite outcomes from possibly different books), report whether arbitrage exists and the per-leg stake split + guaranteed profit. Pure math. Informational only.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            legs: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        odds: { type: Type.STRING, description: "Odds value." },
                        format: { type: Type.STRING, description: "'decimal' | 'american' | 'fractional'." },
                        book: { type: Type.STRING, description: "Optional bookmaker name." },
                        label: { type: Type.STRING, description: "Optional outcome label." },
                    },
                    required: ["odds", "format"],
                },
            },
            stake_total: { type: Type.NUMBER, description: "Total bankroll to spread across legs. Default 100." },
            rounding: { type: Type.NUMBER, description: "Decimals to round stakes to (default 2)." },
        },
        required: ["legs"],
    },
};

const kellyDecl: FunctionDeclaration = {
    name: "kelly_fraction",
    description: "Compute Kelly fraction for a wager given your estimated true probability and offered odds. Returns full Kelly + safer fractional Kelly (default 0.25).",
    parameters: {
        type: Type.OBJECT,
        properties: {
            prob: { type: Type.NUMBER, description: "Your estimate of true win probability, in (0,1)." },
            odds: { type: Type.STRING, description: "Offered odds." },
            format: { type: Type.STRING, description: "'decimal' | 'american' | 'fractional'." },
            bankroll: { type: Type.NUMBER, description: "Optional bankroll for a stake recommendation." },
            fractional: { type: Type.NUMBER, description: "Fractional Kelly multiplier, default 0.25." },
        },
        required: ["prob", "odds", "format"],
    },
};

const evDecl: FunctionDeclaration = {
    name: "expected_value",
    description: "Compute expected value of a wager given probability, odds, and stake.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            prob: { type: Type.NUMBER, description: "True win probability, in (0,1)." },
            odds: { type: Type.STRING, description: "Offered odds." },
            format: { type: Type.STRING, description: "'decimal' | 'american' | 'fractional'." },
            stake: { type: Type.NUMBER, description: "Stake amount." },
        },
        required: ["prob", "odds", "format", "stake"],
    },
};

const hedgeDecl: FunctionDeclaration = {
    name: "hedge_calc",
    description: "Compute hedge stake to lock equal profit either side of a two-outcome market. Returns both-outcome profits and total risk.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            leg_odds: { type: Type.STRING, description: "Original leg's odds." },
            leg_format: { type: Type.STRING, description: "'decimal' | 'american' | 'fractional'." },
            leg_stake: { type: Type.NUMBER, description: "Stake already on the original leg." },
            hedge_odds: { type: Type.STRING, description: "Hedge side's odds." },
            hedge_format: { type: Type.STRING, description: "'decimal' | 'american' | 'fractional'." },
        },
        required: ["leg_odds", "leg_format", "leg_stake", "hedge_odds", "hedge_format"],
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Skill
// ─────────────────────────────────────────────────────────────────────────────

export const calcSkill: Skill = {
    name: "calcSkill",
    description: "Deterministic local math, unit conversion, stats, natural-language number extraction, and sports-odds / arbitrage research math. Pure local — no LLM or network.",
    tools: [
        calcDecl, convertUnitsDecl, statsDecl, parseAndComputeDecl,
        convertOddsDecl, impliedProbDecl, removeVigDecl, arbCheckDecl,
        kellyDecl, evDecl, hedgeDecl,
    ],
    execute: async (toolName, args) => {
        try {
            switch (toolName) {
                case "calc": {
                    const expression = String(args?.expression ?? "");
                    const precision = Number.isFinite(args?.precision) ? Number(args.precision) : 6;
                    const raw = safeEval(expression);
                    return { expression, result: roundTo(raw, precision), raw, precision };
                }
                case "convert_units": {
                    const value = Number(args?.value);
                    const from = String(args?.from ?? "");
                    const to = String(args?.to ?? "");
                    if (!Number.isFinite(value)) return { error: "value must be a number" };
                    const out = convertUnits(value, from, to);
                    return {
                        input: { value, from, to },
                        result: Number(out.value.toFixed(6)),
                        category: out.category,
                        note: out.note,
                    };
                }
                case "stats": {
                    const values = Array.isArray(args?.values) ? args.values : [];
                    const ops = Array.isArray(args?.ops) ? args.ops : undefined;
                    const result = statsCompute(values, ops);
                    return { count: values.length, result };
                }
                case "parse_and_compute": {
                    const text = String(args?.text ?? "");
                    return parseAndCompute(text);
                }
                case "convert_odds": {
                    const input = args?.input;
                    const format = String(args?.format ?? "decimal") as OddsFormat;
                    const to = args?.to ? (String(args.to) as OddsFormat) : undefined;
                    return { ...convertOdds(input, format, to), disclaimer: DISCLAIMER };
                }
                case "implied_probability": {
                    const dec = toDecimal(args?.odds, String(args?.format ?? "decimal") as OddsFormat);
                    const p = impliedProb(dec);
                    return {
                        probability: Number(p.toFixed(6)),
                        percent: Number((p * 100).toFixed(4)),
                        decimal_odds: Number(dec.toFixed(6)),
                        disclaimer: DISCLAIMER,
                    };
                }
                case "remove_vig": {
                    const list = Array.isArray(args?.odds_list) ? args.odds_list : [];
                    const method = (args?.method === "power" ? "power" : "proportional") as "power" | "proportional";
                    return removeVig(list, method);
                }
                case "arbitrage_check": {
                    const legs = Array.isArray(args?.legs) ? args.legs : [];
                    return arbitrageCheck(legs, Number(args?.stake_total), Number(args?.rounding));
                }
                case "kelly_fraction": {
                    return kellyFraction(
                        Number(args?.prob),
                        args?.odds,
                        String(args?.format ?? "decimal") as OddsFormat,
                        Number(args?.bankroll),
                        Number(args?.fractional),
                    );
                }
                case "expected_value": {
                    return expectedValue(
                        Number(args?.prob),
                        args?.odds,
                        String(args?.format ?? "decimal") as OddsFormat,
                        Number(args?.stake),
                    );
                }
                case "hedge_calc": {
                    return hedgeCalc(
                        args?.leg_odds,
                        String(args?.leg_format ?? "decimal") as OddsFormat,
                        Number(args?.leg_stake),
                        args?.hedge_odds,
                        String(args?.hedge_format ?? "decimal") as OddsFormat,
                    );
                }
                default:
                    return { error: `Tool not found: ${toolName}` };
            }
        } catch (e: any) {
            return { error: e?.message || String(e) };
        }
    },
};

// Internal helpers exported only for potential future tests; not part of the
// public skill surface. Kept here to avoid extra files.
export const _internals = {
    safeEval, parseAndCompute, convertUnits, statsCompute,
    convertOdds, removeVig, arbitrageCheck, kellyFraction, expectedValue, hedgeCalc,
    toDecimal, decimalToAmerican, decimalToFractional,
};

export default calcSkill;
