/**
 * The omission ledger — PROP-O1, and the reason truncation is **unrepresentable**
 * in this module rather than merely discouraged.
 *
 * > "**No eligible affordance is ever dropped uncounted.** The budget is met by
 * > eligibility filtering, never truncation, and every omission appears in
 * > `withheld` with a reason. *(Truncation is invisible to tests and
 * > indistinguishable, from the agent's side, from the world changing underneath
 * > it.)*" — TESTING.md, PROP-O1
 *
 * ## The structural version of that promise
 *
 * There is no `TRUNCATED` ground below, and there never may be. Every way an item
 * can fail to reach the agent is a **named rule about the world** — no action
 * budget left, no hand in range, the Commons floor refuses it, the freeze forbids
 * it, the grant has no headroom — or it is {@link 'PAGED'}, which means *eligible,
 * counted, and retrievable for free on the next page*. A builder that wanted to
 * slice a list would have nothing to write in the `ground` column, which is the
 * only kind of prohibition that survives a rewrite.
 *
 * ## Why the column is called `ground` and not `reason`
 *
 * §3 is a rules surface and **`reason` is taken**: it is the mandatory
 * 140-character public line on every material act (§11.1), the thing the whole
 * ticker corpus is made of. One word may not name two concepts, so the column
 * that says *why an item is absent* is `ground`. `src/events/visibility.ts` made
 * the same call for the same reason and called its column `basis`.
 *
 * `agent.md` §6 currently says "you get a `withheld` count and a reason", which
 * is prose about this field under the forbidden spelling. That disagreement is
 * reported rather than resolved by editing the promise (scar #1).
 *
 * ## Counting is exact, not indicative
 *
 * {@link tally} sums per `(field, ground)` and {@link accountingFaults} asserts
 * `candidates === shown + Σ withheld` **per field**. An approximate count is
 * worse than none: it tells an agent something was dropped and then lies about
 * how much, and the agent cannot tell an approximate count from a world that
 * moved.
 */

import { compareIds } from '../ledger/index.js';
import { LIST_CAPS } from './tokens.js';

/**
 * The lists an omission can be about, in the observation's own dotted spelling —
 * so an agent that reads `ventures.board` in a `withheld` row knows exactly which
 * array to page.
 */
export const WITHHELD_FIELDS = Object.freeze([
  'affordances',
  'ventures.mine',
  'ventures.board',
  'ventures.talks',
  'counterparties',
  'market',
  // `grants` covers `granted[]` and `held[]` together, because both are read from one
  // key and an agent pages the key rather than the half. It is here because the floor
  // rung narrows it: sixteen grant lines are ~4,800 characters, which is 40% of the
  // whole normal budget, so it is the largest single thing the last rung has to give
  // up — and a rung that gives something up without counting it is the truncation
  // this file exists to make unrepresentable.
  'grants',
] as const);

export type WithheldField = (typeof WITHHELD_FIELDS)[number];

/**
 * Why an item is not in the payload. Uppercase because this is a closed
 * machine-readable set, and every member is checked against SPEC §3's canon and
 * against every other union in `src/` by `test/core/vocabulary-repo.test.ts`.
 *
 * Each ground is a rule an agent can act on:
 *
 * - `ACTS_SPENT` — the per-tick material action budget is gone (A4). Waiting works.
 * - `WAKE_SPENT` — this fetch is outside a wake (§12.4). Legal, free, and useless.
 * - `HALTED` — the world is `PAUSED` (§15.2, E2E-30). No affordance is honest here.
 * - `FROZEN` — the freeze tick; nothing may touch the settlement set (INV-18).
 * - `NO_HAND_FREE` — presence is the binding constraint and none is available.
 * - `OUT_OF_REACH` — no hand of yours is present where this would happen.
 * - `COMMONS_FLOOR` — A8's *inbound* half: hostile action against a Commons target
 *   is invalid, and no amount of capital changes that.
 * - `COMMONS_BOUND` — A15's *outbound* half: your hands are civic-leased in the
 *   Commons and may only move between Commons systems. A separate ground from
 *   `COMMONS_FLOOR` because `world/` keeps the two rules separate on purpose
 *   ("collapsing them into one predicate would silently drop one"), and an agent
 *   told the wrong one would take the wrong corrective action — buy a holding, or
 *   pick a different target.
 * - `SHORT_FUNDS` — your free stores do not cover the stake or the escrow.
 * - `NO_PRICE` — the book is too thin to price what this would risk, so we will not
 *   publish a `max_direct_loss` we cannot stand behind (PROP-O4, `THIN_BOOK`).
 * - `LIMITS_SPENT` — a grant's headroom is exhausted (§8, INV-22).
 * - `WINDOW_SHUT` — the venture's formation window does not contain this tick.
 * - `UNSENSED` — you have no hand in range and bought no intel (§11.2, PROP-VI2).
 * - `NO_RECORD` — we hold no row for it, and will not invent zeros that read as facts.
 * - `NODE_BUDGET` — a free solver stopped at its declared node bound (§12.1).
 * - `PAGED` — **eligible**; on a later page, fetched free (§12.1's paginated GETs).
 */
export type WithheldGround =
  | 'ACTS_SPENT'
  | 'WAKE_SPENT'
  | 'HALTED'
  | 'FROZEN'
  | 'NO_HAND_FREE'
  | 'OUT_OF_REACH'
  | 'COMMONS_FLOOR'
  | 'COMMONS_BOUND'
  | 'SHORT_FUNDS'
  | 'NO_PRICE'
  | 'LIMITS_SPENT'
  | 'WINDOW_SHUT'
  | 'UNSENSED'
  | 'NO_RECORD'
  | 'NODE_BUDGET'
  | 'PAGED';

const GROUND_ORDER = Object.freeze([
  'ACTS_SPENT',
  'WAKE_SPENT',
  'HALTED',
  'FROZEN',
  'NO_HAND_FREE',
  'OUT_OF_REACH',
  'COMMONS_FLOOR',
  'COMMONS_BOUND',
  'SHORT_FUNDS',
  'NO_PRICE',
  'LIMITS_SPENT',
  'WINDOW_SHUT',
  'UNSENSED',
  'NO_RECORD',
  'NODE_BUDGET',
  'PAGED',
] as const);

export const WITHHELD_GROUNDS: readonly WithheldGround[] = GROUND_ORDER;

/**
 * **The union and the list are one list, and the compiler enforces it.**
 *
 * {@link rows} enumerates `WITHHELD_GROUNDS` to build the ledger, so a ground added to
 * the {@link WithheldGround} union and *not* to the list above would be tallied by
 * {@link WithheldTally.add}, counted by {@link WithheldTally.forField} — and then
 * **silently dropped from the rows the agent reads**. That is a truncated omission
 * ledger arriving through a type/value drift rather than through a slice, and the
 * previous `as WithheldGround[]` cast made it compile clean and pass every test.
 *
 * `Record<Exclude<union, listed>, never>` is empty exactly when nothing is missing, so
 * a union member with no entry above is a type error at this line.
 */
const _everyGroundIsListed: Record<Exclude<WithheldGround, (typeof GROUND_ORDER)[number]>, never> =
  {};
void _everyGroundIsListed;

/**
 * The one ground that means "you were entitled to this". Everything else is the
 * world saying no; this is us saying *later, for free*. Separated because the two
 * carry completely different instructions to an agent, and because PROP-O1's
 * assertion has to treat them differently.
 */
export const PAGED: Extract<WithheldGround, 'PAGED'> = 'PAGED';

/** One row of the omission ledger. */
export interface WithheldRow {
  readonly field: WithheldField;
  readonly ground: WithheldGround;
  readonly count: number;
}

/**
 * A mutable tally, collapsed to rows at the end.
 *
 * Deliberately not a plain object keyed by a template string: a `Map` cannot pick
 * up `Object.prototype` keys, and a `withheld` row for `constructor` would be an
 * omission nobody could act on.
 */
export class WithheldTally {
  private readonly counts = new Map<string, number>();

  add(field: WithheldField, ground: WithheldGround, count = 1): void {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`a withheld count is a non-negative integer, got ${String(count)}`);
    }
    if (count === 0) return;
    // '::' as the separator, never NUL — a NUL byte makes `file(1)` report the
    // source as `data` and makes grep skip it while every gate stays green.
    const key = `${field}::${ground}`;
    this.counts.set(key, (this.counts.get(key) ?? 0) + count);
  }

  /** Total omissions for one field. What PROP-O1's accounting compares against. */
  forField(field: WithheldField): number {
    let total = 0;
    for (const [key, count] of this.counts) {
      if (key.startsWith(`${field}::`)) total += count;
    }
    return total;
  }

  /** Omissions for one field under one ground. */
  forGround(field: WithheldField, ground: WithheldGround): number {
    return this.counts.get(`${field}::${ground}`) ?? 0;
  }

  /**
   * The rows, in canonical `(field, ground)` order and within the declared cap.
   *
   * **This throw is on a read path, and it is the one place in the module that can turn
   * a spent wake into a 500 (AGT-X9).** It is here anyway, because the alternative —
   * slicing — is the failure this whole file exists to prevent, and a loud CI failure is
   * strictly better than a quietly shortened omission ledger.
   *
   * So the cap has to be provably out of reach, and the earlier note here got the
   * arithmetic wrong: it claimed `WITHHELD_FIELDS.length * WITHHELD_GROUNDS.length` is
   * "below `LIST_CAPS.withheldRows`", which is `7 * 16 = 112` against a cap of `32`. The
   * product is **not** the bound. The bound is the *reachable* set, which
   * `test/observe/withheld.test.ts` enumerates ground by ground and asserts against the
   * cap, and `test/observe/noThrow.test.ts` covers empirically by driving an adversarial
   * world through every tick of two Reckonings without this line firing. Both are needed:
   * the enumeration is what a reviewer argues with, and the fuzz is what notices a ground
   * the enumeration forgot.
   */
  rows(): readonly WithheldRow[] {
    const out: WithheldRow[] = [];
    for (const field of WITHHELD_FIELDS) {
      for (const ground of WITHHELD_GROUNDS) {
        const count = this.forGround(field, ground);
        if (count > 0) out.push({ field, ground, count });
      }
    }
    out.sort((a, b) => compareIds(a.field, b.field) || compareIds(a.ground, b.ground));
    if (out.length > LIST_CAPS.withheldRows) {
      // Unreachable while the two closed sets multiply out below the cap. Loud
      // rather than sliced, because slicing here is the bug.
      throw new Error(
        `the omission ledger produced ${out.length} rows against a declared cap of ` +
          `${LIST_CAPS.withheldRows}; raise the cap rather than dropping a row`,
      );
    }
    return Object.freeze(out);
  }

  /** Every omission, summed. For the header's own sanity and for tests. */
  total(): number {
    let total = 0;
    for (const count of this.counts.values()) total += count;
    return total;
  }
}

/** What a field's accounting must balance. One entry per list in the payload. */
export interface FieldAccounting {
  readonly field: WithheldField;
  /** Everything the world offered before any rule ran. */
  readonly candidates: number;
  /** Everything the payload actually carries. */
  readonly shown: number;
}

/**
 * PROP-O1, as arithmetic: for every list, `candidates === shown + Σ withheld`.
 *
 * Returns the faults rather than throwing, so the caller decides whether this is a
 * halt (it is, in a test) or a logged defect (it is, in production — an
 * accounting slip must not deny an agent its observation, because a denied
 * observation is a denied wake and the wake budget is not refundable).
 */
export function accountingFaults(
  entries: readonly FieldAccounting[],
  tally: WithheldTally,
): string[] {
  const faults: string[] = [];
  const seen = new Set<WithheldField>();
  for (const entry of entries) {
    if (seen.has(entry.field)) {
      faults.push(`PROP-O1: ${entry.field} accounted twice; one list, one accounting`);
    }
    seen.add(entry.field);
    const withheld = tally.forField(entry.field);
    if (entry.shown + withheld !== entry.candidates) {
      faults.push(
        `PROP-O1: ${entry.field} offered ${entry.candidates} candidates, shows ${entry.shown} and ` +
          `counts ${withheld} withheld (${entry.shown + withheld} accounted). Every omission is counted ` +
          'with its ground, or the agent cannot tell an omission from a world that moved',
      );
    }
    if (entry.shown < 0 || entry.candidates < 0) {
      faults.push(`PROP-O1: ${entry.field} reports a negative count`);
    }
  }
  for (const field of WITHHELD_FIELDS) {
    if (tally.forField(field) > 0 && !seen.has(field)) {
      faults.push(
        `PROP-O1: ${field} counts withheld items but was never accounted; an unaccounted field is a ` +
          'list nobody proved complete',
      );
    }
  }
  return faults;
}
