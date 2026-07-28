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
 *
 * ── ★ AND IT IS PUBLISHED STANDING, NOT ONLY ON THE WAY OUT ──────────────────
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **A PRICE THAT IS INVISIBLE UNTIL IT IS SPENT IS NOT A PRICE, IT IS A SURPRISE.**
 *
 * For this module's whole life the only place an observation mentioned the capacity was a
 * `withheld` reason that fires **exactly when the agent has none left**. So the learning path ran
 * backwards: an agent discovered the resource existed by exhausting a resource it had never been
 * told it had, and with full capacity and no reachable target `demand` was simply absent from the
 * menu with nothing to explain it. A blind probe hit that and reported, correctly, that it could
 * not tell zero capacity from silence.
 *
 * {@link aggressionNote} was written for that agent and reached no observation — its own test
 * asserts that it says the capacity does not carry, and nothing outside the refusal path ever read
 * it. That is the project's signature defect (*a capability that exists and is never exercised is
 * indistinguishable from one that is missing*) applied to a sentence.
 *
 * {@link AggressionCapacity} is the fix: a standing block on `header`, present in every
 * observation the way `raid_schedule` is, at zero and at full alike. §9's design — *the cost of a
 * demand is the other demand you gave up this cycle* — is a decision an agent can only make if it
 * knows the count **before** it spends it.
 * ══════════════════════════════════════════════════════════════════════════
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
        `demand is the other demand you could have made instead. ${JOIN_IS_FREE}`
    : `You have spent all ${String(allowance)} of this Reckoning's aggression capacity. It refreshes at ` +
        `the next Reckoning and does not accumulate: a standing toll is not fundable by design (§9), ` +
        `because a raider who could threaten everyone every day would be a tariff rather than a threat. ` +
        JOIN_IS_FREE;
}

/**
 * The one thing an agent reading a *count* will otherwise get wrong.
 *
 * A principal that believes answering somebody else's standoff draws on this budget will decline
 * to reinforce an ally in order to keep its own powder dry — which is the escort market §9 wants
 * *open* closing for a reason the rules do not contain. Said in both branches, because the belief
 * is equally wrong at zero.
 */
const JOIN_IS_FREE =
  'Answering somebody else\'s standoff with `join` costs NONE of this — the capacity prices ' +
  'STARTING a fight, never taking a side in one.';

/**
 * §9's capacity as a standing block on `header`, present at zero and at full alike.
 *
 * ── EVERY NUMERIC KEY CARRIES ITS UNIT IN ITS NAME, DELIBERATELY ─────────────
 *
 * `test/levy/one-word-two-units.spec.ts` catalogues nine sites where a figure in the wrong unit
 * decided something, and its fifth entry is a field whose *name* carried five different units.
 * Three counts here are denominated in **demands** and two in **ticks**, so each key says which:
 * a bare `remaining: 2` next to a bare `refreshes_at: 6336` is the same trap one payload later.
 */
export interface AggressionCapacity {
  /** Demands this principal may still OPEN in the Reckoning containing the observed tick. */
  readonly demands_remaining: number;
  /** The whole allowance, so `remaining` has a denominator. {@link AGGRESSION_PER_RECKONING}. */
  readonly demands_per_reckoning: number;
  /** Always 0, and published rather than implied: `join` is free of this budget. */
  readonly join_costs_demands: number;
  /**
   * The last tick at which a demand may be **opened** this Reckoning.
   *
   * Absolute, not a phase, so it compares directly against `header.tick` and needs no arithmetic
   * about cycle boundaries. Past it the window would run into the freeze, where §5.1 admits no
   * raid resolution — and the refusal an agent would otherwise have to spend an action to read
   * says exactly that.
   */
  readonly open_until_tick: number;
  /** When the allowance resets — the same tick demands reopen if this one is closed. */
  readonly refreshes_at_tick: number;
  /** {@link aggressionNote}, verbatim. The expiry rule, in the payload that carries the count. */
  readonly rule: string;
}
