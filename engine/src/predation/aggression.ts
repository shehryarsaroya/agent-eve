/**
 * AGGRESSION CAPACITY — the price that stops predation collapsing into a toll cartel.
 *
 * §9 states the failure mode before it states the mechanic, and the mechanic only makes sense as an
 * answer to it: *"cheap, bounded, computable predation **Coase-collapses into a toll cartel** — the
 * raider posts a standing 8% passage fee, every hauler accepts because 8% certain beats an expected 15%
 * loss plus escort wages, the escort market never opens, and the map renders identically to peace —
 * which by A13 means the mechanic has no pixel signature at all."*
 *
 * A cartel needs the threat to be **cheap and repeatable**. So §9 prices it: *"spend from a
 * slow-regenerating aggression capacity **that expires unspent**, so sit-and-collect is priced out by
 * rule."*
 *
 * ── WHY "EXPIRES UNSPENT" IS THE WHOLE DESIGN, NOT A DETAIL ──────────────────
 *
 * A budget that accumulates is a war chest, and a war chest is exactly what a toll operator wants: bank
 * quietly for ten Reckonings, then credibly threaten everyone at once. Expiry inverts that — capacity
 * you did not use is *gone*, so the cost of threatening is not the capacity itself but **the alternative
 * threat you gave up this cycle**. That is what makes a demand a choice about targets rather than a
 * standing tariff, and it is why the cap is per-Reckoning rather than a stock.
 *
 * It also gives A15 its price here without charging identities: capacity is per-principal and does not
 * transfer, so N enrolments buy N *separate* small threats rather than one large one — and §9's
 * related-party rule already zeroes the salvage on predating yourself.
 *
 * ── NO STATE TABLE, DELIBERATELY ─────────────────────────────────────────────
 *
 * Capacity is **derived**, not stored: it is the per-Reckoning allowance minus what this principal has
 * already spent inside the current Reckoning, and the spends are already in the raid book (every
 * agent-initiated raid names its initiator and the tick it opened). A stored counter would be a second
 * home for a quantity the record already determines — scar #5 — and it would need its own capture,
 * restore, and a reset hook at the Reckoning boundary that could drift from the boundary itself.
 *
 * Derived means it is also correct across a restart for free, which is the property that matters most:
 * a raider whose capacity reset because the process bounced would be an exploit with an uptime
 * requirement, and A4 says uptime is never power.
 */

import type { PrincipalId } from '../core/types.js';

/**
 * Demands one principal may open per Reckoning. *(calibrate)*
 *
 * Small on purpose. §9 wants a demand to be an *event*, and a principal that can open one most days is
 * running a tariff rather than making a decision. Two is enough to answer a rival and still choose
 * wrongly; it is not enough to cover a lane.
 */
export const AGGRESSION_PER_RECKONING = 2;

/** One agent-initiated demand, for the purpose of counting capacity. */
export interface AggressionSpend {
  readonly initiator: PrincipalId;
  readonly tick: number;
}

/**
 * How many demands this principal may still open in the Reckoning containing `tick`.
 *
 * Counts only spends **inside the same Reckoning**, which is what makes the allowance expire: last
 * cycle's restraint buys nothing this cycle. Never negative — an over-spend is a bug in the caller's
 * gate rather than a debt to carry forward, and returning a negative would let it silently net against
 * next cycle's allowance.
 */
export function aggressionRemaining(
  spends: readonly AggressionSpend[],
  principal: PrincipalId,
  tick: number,
  reckoningOf: (t: number) => number,
  allowance: number = AGGRESSION_PER_RECKONING,
): number {
  const here = reckoningOf(tick);
  let used = 0;
  for (const s of spends) {
    if (s.initiator !== principal) continue;
    if (reckoningOf(s.tick) !== here) continue;
    used += 1;
  }
  return Math.max(0, allowance - used);
}

/**
 * The sentence an agent reads before it spends one, and the refusal when it cannot.
 *
 * A2: the arithmetic is exact and the *reason* is stated, because "you may not" without "and here is
 * what would change that" costs an agent an action every wake while it guesses. The expiry is named
 * explicitly — an agent that thinks capacity banks will plan a campaign it can never fund.
 */
export function aggressionNote(remaining: number, allowance: number = AGGRESSION_PER_RECKONING): string {
  return remaining > 0
    ? `You may open ${String(remaining)} more demand(s) this Reckoning, of ${String(allowance)}. ` +
        `Unspent capacity DOES NOT CARRY — what you do not use this cycle is gone, so the cost of a ` +
        `demand is the other demand you could have made instead.`
    : `You have spent all ${String(allowance)} of this Reckoning's aggression capacity. It refreshes at ` +
        `the next Reckoning and does not accumulate: a standing toll is not fundable by design (§9), ` +
        `because a raider who could threaten everyone every day would be a tariff rather than a threat.`;
}
