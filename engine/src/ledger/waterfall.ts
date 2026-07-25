/**
 * Paying claims out of less money than they add up to.
 *
 * Two rules, both from SPEC §7.4:
 *
 *   1. **Seniority.** A fixed `wage` is senior to a residual `share` and is paid
 *      first. `wage` and `share` are separate fields precisely because one
 *      polymorphic field carrying both is scar #1 with money — and the ledger
 *      would then record the broken promise as *honoured*. Seniority is expressed
 *      here as an integer priority band, lower first.
 *   2. **Every minor unit is accounted.** `Σ payouts == proceeds` exactly when
 *      proceeds fall short, and no payout ever exceeds its claim. "Rounding leaks
 *      are how a ledger silently stops balancing" (INV-6).
 *
 * Deliberately *not* built on `splitByBps`: basis points have 10⁻⁴ granularity, so
 * a claim of 1 against a claim of 1,000,000 rounds to a weight of 1 bps and would
 * be paid 100× what it is owed. Pro-rata among claims is computed from the claim
 * amounts directly, capped at each claim, with the remainder handed out one unit at
 * a time in deterministic order. `splitByBps` stays the right tool for a SPLIT,
 * which is an agreed division in bps — a different thing, hence a different word.
 */

import type { AccountId } from '../core/types.js';
import { UnitError, addMinor, minor, subMinor, sumMinor, type Minor } from '../core/units.js';
import { compareIds } from './order.js';

/** One claim on a pot. `priority` is the seniority band: lower is paid first. */
export interface Claim {
  /** Where the money goes. */
  readonly account: AccountId;
  /** Lower is more senior. A fixed `wage` sits above a residual `share`. */
  readonly priority: number;
  readonly amount: Minor;
  /** Stable tiebreak inside a band, so the remainder lands the same way on replay. */
  readonly key: string;
}

export interface Payout {
  readonly account: AccountId;
  readonly priority: number;
  readonly claimed: Minor;
  readonly paid: Minor;
  readonly key: string;
}

export interface WaterfallResult {
  readonly payouts: readonly Payout[];
  /** What the pot could not cover. A **recorded loss**, never by itself a default. */
  readonly shortfall: Minor;
  /** What is left in the pot after every claim is met in full. */
  readonly surplus: Minor;
}

export class WaterfallError extends Error {}

/**
 * Pay `proceeds` across `claims` in seniority order, pro-rata within a band.
 *
 * Deterministic in the claims' `(priority, key)` order and in nothing else, which
 * is the ledger half of PROP-V7 — settlement independent of everything except a
 * stated order.
 */
export function payByPriority(proceeds: Minor, claims: readonly Claim[]): WaterfallResult {
  if (proceeds < 0) throw new WaterfallError(`proceeds cannot be negative, got ${proceeds}`);
  for (const c of claims) {
    if (c.amount < 0) throw new WaterfallError(`claim ${c.key} is negative: ${c.amount}`);
    if (!Number.isSafeInteger(c.priority)) {
      throw new WaterfallError(`claim ${c.key} has a non-integer priority`);
    }
  }

  const ordered = [...claims].sort(
    (a, b) => a.priority - b.priority || compareIds(a.key, b.key) || compareIds(a.account, b.account),
  );
  const bands = new Map<number, Claim[]>();
  for (const c of ordered) {
    const band = bands.get(c.priority);
    if (band === undefined) bands.set(c.priority, [c]);
    else band.push(c);
  }

  const payouts: Payout[] = [];
  let remaining = proceeds;
  for (const priority of [...bands.keys()].sort((a, b) => a - b)) {
    const band = bands.get(priority) ?? [];
    const allocated = allocateProRata(remaining, band.map((c) => c.amount));
    for (const [i, c] of band.entries()) {
      const paid = allocated[i] ?? minor(0);
      payouts.push({ account: c.account, priority: c.priority, claimed: c.amount, paid, key: c.key });
      remaining = subMinor(remaining, paid);
    }
  }

  const claimed = sumMinor(claims.map((c) => c.amount));
  const paid = sumMinor(payouts.map((p) => p.paid));
  const result: WaterfallResult = {
    payouts,
    shortfall: subMinor(claimed, paid),
    surplus: remaining,
  };
  assertPayoutsExact(proceeds, result);
  return result;
}

/**
 * Allocate `available` across `amounts` pro-rata, capped at each amount, placing
 * **every** minor unit.
 *
 * Never "split": §3 reserves SPLIT for the *agreed* division of proceeds and never
 * for a payment, and this is a payment — of less than was promised.
 *
 * Integers throughout. The remainder is handed out one unit at a time to claims
 * that are not yet full, in the order given — so the caller's order is the rule
 * and the outcome is replay-identical (DET-1).
 */
export function allocateProRata(available: Minor, amounts: readonly Minor[]): Minor[] {
  if (available < 0) throw new WaterfallError(`cannot allocate ${available}`);
  const total = sumMinor(amounts);
  if (amounts.length === 0) return [];
  if (total <= 0) return amounts.map(() => minor(0));
  if (available >= total) return amounts.map((a) => a);

  const out: Minor[] = amounts.map((a) => {
    const product = a * available;
    if (!Number.isSafeInteger(product)) {
      // Loud rather than silently lossy: a float here would break INV-6 in a way
      // that only shows up as a ledger that no longer balances.
      throw new UnitError(`pro-rata overflow: ${a} * ${available} exceeds safe integer range`);
    }
    return minor(Math.trunc(product / total));
  });

  let remainder = subMinor(available, sumMinor(out));
  let guard = 0;
  while (remainder > 0) {
    let placed = false;
    for (let i = 0; i < out.length && remainder > 0; i += 1) {
      const cur = out[i];
      const cap = amounts[i];
      if (cur === undefined || cap === undefined || cur >= cap) continue;
      out[i] = addMinor(cur, minor(1));
      remainder = subMinor(remainder, minor(1));
      placed = true;
    }
    // Terminates: each pass either places at least one unit or every claim is
    // full, and `available < total` guarantees capacity exists. Bounded anyway —
    // an unbounded loop inside a tick is DET-9's failure mode.
    guard += 1;
    if (!placed || guard > amounts.length + 2) break;
  }
  if (remainder !== 0) {
    throw new WaterfallError(`pro-rata failed to allocate ${remainder} of ${available}`);
  }
  return out;
}

/**
 * INV-6 — the settlement arithmetic, asserted rather than assumed.
 *
 * `Σ payouts == proceeds` exactly when the pot is short, `Σ payouts == Σ claims`
 * when it is not, no payout exceeds its claim, no payout is negative, and a junior
 * band is never paid while a senior band is unpaid.
 */
export function assertPayoutsExact(proceeds: Minor, result: WaterfallResult): void {
  const paid = sumMinor(result.payouts.map((p) => p.paid));
  const claimed = sumMinor(result.payouts.map((p) => p.claimed));

  for (const p of result.payouts) {
    if (p.paid < 0) throw new WaterfallError(`INV-6: negative payout ${p.paid} to ${p.account}`);
    if (p.paid > p.claimed) {
      throw new WaterfallError(`INV-6: ${p.account} was paid ${p.paid} against a claim of ${p.claimed}`);
    }
  }
  if (addMinor(paid, result.surplus) !== proceeds) {
    throw new WaterfallError(
      `INV-6: payouts ${paid} + surplus ${result.surplus} != proceeds ${proceeds}`,
    );
  }
  if (addMinor(paid, result.shortfall) !== claimed) {
    throw new WaterfallError(
      `INV-6: payouts ${paid} + shortfall ${result.shortfall} != claims ${claimed}`,
    );
  }
  if (result.shortfall > 0 && result.surplus > 0) {
    throw new WaterfallError(
      `INV-6: ${result.surplus} left in the pot while ${result.shortfall} of claims went unpaid`,
    );
  }

  // Seniority, checked **band by band**, not claim by claim: inside one band a
  // short pot pays everyone pro-rata, so a partially-paid neighbour is correct.
  // What must never happen is a junior band receiving anything while a senior band
  // is short — that is the fixed-vs-residual inversion §7.1 exists to prevent.
  const bands = new Map<number, Payout[]>();
  for (const p of result.payouts) {
    const band = bands.get(p.priority);
    if (band === undefined) bands.set(p.priority, [p]);
    else band.push(p);
  }
  let seniorShort = false;
  for (const priority of [...bands.keys()].sort((a, b) => a - b)) {
    const band = bands.get(priority) ?? [];
    if (seniorShort) {
      for (const p of band) {
        if (p.paid > 0) {
          throw new WaterfallError(
            `INV-6: ${p.account} in band ${p.priority} was paid ${p.paid} while a senior band was short`,
          );
        }
      }
    }
    if (band.some((p) => p.paid < p.claimed)) seniorShort = true;
  }
}
