/**
 * ★ THE MAX-SHARE METER — how many docket lines §5.2's max share was ASKED about, how many it HELD,
 * and what the lines it RAISED went on to owe.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `balance-gate.ts`'s header asks every mechanism that lands for a second instrument with a
 * denominator, because a clean table reads the same for a neutral change and a dead mechanic. This is
 * that instrument for `LEVY_MAX_SHARE_MULTIPLE`: the pool lines on every docket (the denominator), the
 * lines whose share the bound held down (the count), and the largest line on any docket as a multiple
 * of `LEVY_DUTY_PER_PRINCIPAL` — the figure owner call (3) was raised about (5–9x).
 *
 * **It reads only the recorded plan**: which lines are in the remainder pool (neither floored nor
 * spared), the weight each carried, and the remainder they sum to. From those it recomputes the
 * docket the rule would have cut WITHOUT the bound — `largestRemainder` over the recorded weights,
 * `allocate`'s own first pass — and compares. So the same code runs on a tree that predates the bound,
 * where every pool line IS that free share and `maxed` counts the lines the bound would have held, and
 * on a tree that has it, where `maxed` counts the lines it held. The bound is restated here rather
 * than imported, as the independent road:
 *
 *   - `assessedOver` — pool lines billed above the bound. Before it, equal to `maxed`; with it, **0**.
 *   - `mismatches` — held lines assessed at neither the bound nor their free share. 0 on both trees.
 *
 * ── AND WHETHER THE BOUND MADE A SHORTFALL, PER RULE ─────────────────────────
 *
 * What a held line no longer carries goes to the rest of the pool, so the bound can only create a
 * shortfall on a line it RAISED — billed above its free share. `shortOnRaised` is
 * `Σ min(owed, amount − free share)` over those lines: the most of the shortfall the raise could be
 * responsible for, read off the settled rows, never more. Before the bound it is 0 by construction.
 * Kept per rule because owner call (3) singled out `BY_STORES`: there the bound moves a goods-rich
 * member's excess onto members holding less of the very good the Levy is paid in.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { largestRemainder } from '../src/core/allocate.js';
import { LEVY_DUTY_PER_PRINCIPAL, LEVY_MAX_SHARE_MULTIPLE } from '../src/levy/params.js';
import type { Book } from '../src/levy/book.js';

/** One rule's share of the reading. Every field is a count or a sum in MINOR. */
export interface RuleTally {
  dockets: number;
  poolLines: number;
  maxed: number;
  /** Pool lines billed above their free share — the members the bound moved the excess onto. */
  raised: number;
  /** Σ (amount − free share) over raised lines: what the bound moved. */
  raisedBy: number;
  /** Lines recorded short at settlement, and Σ owed over them. */
  shortLines: number;
  short: number;
  /** Σ owed over held lines. */
  shortOnHeld: number;
  /** Σ min(owed, amount − free share) over raised lines: the most of `short` the bound could have made. */
  shortOnRaised: number;
}

export interface MaxShareTally {
  /** Docket lines read, every kind. */
  lines: number;
  /** Lines in a remainder pool — the only lines the bound can reach. The denominator. */
  poolLines: number;
  /** Pool lines whose free share is above the bound: held there, or (before the bound) would be. */
  maxed: number;
  /** Pool lines the engine assessed above the bound. Equal to `maxed` before it; 0 with it. */
  assessedOver: number;
  /** Held lines assessed at neither the bound nor their free share. Always 0. */
  mismatches: number;
  /** The largest assessment on any line read, in MINOR. */
  topAmount: number;
  readonly byRule: Map<string, RuleTally>;
}

export function emptyTally(): MaxShareTally {
  return { lines: 0, poolLines: 0, maxed: 0, assessedOver: 0, mismatches: 0, topAmount: 0, byRule: new Map() };
}

function emptyRule(): RuleTally {
  return { dockets: 0, poolLines: 0, maxed: 0, raised: 0, raisedBy: 0, shortLines: 0, short: 0, shortOnHeld: 0, shortOnRaised: 0 };
}

/** `MULTIPLE x ceil(remainder / size)`, restated from §5.2's sentence rather than imported. */
function boundOf(remainder: number, size: number): number {
  const rest = remainder % size;
  const even = (remainder - rest) / size + (rest === 0 ? 0 : 1);
  return LEVY_MAX_SHARE_MULTIPLE * even;
}

/** Read every plan of one Reckoning into the tally. Call at the settlement tick, after the Levy settles. */
export function tallyReckoning(book: Book, reckoning: number, into: MaxShareTally): void {
  for (const plan of book.plansIn(reckoning)) {
    const rule = into.byRule.get(plan.rule) ?? emptyRule();
    into.byRule.set(plan.rule, rule);
    rule.dockets += 1;
    const owedOf = (line: (typeof plan.lines)[number]): number =>
      Number(book.shortfallOf(reckoning, line.principal)?.owed ?? 0);
    for (const line of plan.lines) {
      into.lines += 1;
      into.topAmount = Math.max(into.topAmount, Number(line.amount));
      const owed = owedOf(line);
      if (owed > 0) {
        rule.shortLines += 1;
        rule.short += owed;
      }
    }
    const pool = plan.lines.filter((line) => !line.newcomerFloored && !line.spared);
    if (pool.length === 0) continue;
    into.poolLines += pool.length;
    rule.poolLines += pool.length;
    const remainder = pool.reduce((n, line) => n + Number(line.amount), 0);
    const bound = boundOf(remainder, pool.length);
    const free = largestRemainder(remainder, pool.map((line) => line.weight));
    for (const [i, line] of pool.entries()) {
      const amount = Number(line.amount);
      const share = free[i] ?? 0;
      const owed = owedOf(line);
      if (amount > bound) into.assessedOver += 1;
      if (amount > share) {
        rule.raised += 1;
        rule.raisedBy += amount - share;
        rule.shortOnRaised += Math.min(owed, amount - share);
      }
      if (share <= bound) continue;
      into.maxed += 1;
      rule.maxed += 1;
      rule.shortOnHeld += owed;
      if (amount !== bound && amount !== share) into.mismatches += 1;
    }
  }
}

/** The largest line as a multiple of the duty, to two places, for a table. */
export function topMultiple(tally: Pick<MaxShareTally, 'topAmount'>): string {
  return (tally.topAmount / Number(LEVY_DUTY_PER_PRINCIPAL)).toFixed(2);
}

/** Merge per-rule readings, for a TOTAL row. */
export function mergeByRule(tallies: readonly MaxShareTally[]): Map<string, RuleTally> {
  const out = new Map<string, RuleTally>();
  for (const tally of tallies) {
    for (const [rule, row] of tally.byRule) {
      const acc = out.get(rule) ?? emptyRule();
      for (const key of Object.keys(acc) as (keyof RuleTally)[]) acc[key] += row[key];
      out.set(rule, acc);
    }
  }
  return out;
}

/** One line per rule, sorted by name, for a report. */
export function byRuleLines(byRule: ReadonlyMap<string, RuleTally>, indent: string): string {
  return [...byRule.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(
      ([rule, r]) =>
        `${indent}${rule.padEnd(16)} dockets ${String(r.dockets).padStart(3)} · held ${String(r.maxed)}/${String(r.poolLines)} · ` +
        `raised ${String(r.raised)} by ${String(r.raisedBy)} · short ${String(r.shortLines)} lines ${String(r.short)} ` +
        `(on held ${String(r.shortOnHeld)}, at most ${String(r.shortOnRaised)} from a raise)\n`,
    )
    .join('');
}
