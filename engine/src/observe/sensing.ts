/**
 * What a principal may sense — PROP-VI2, and the leak it is actually about.
 *
 * > "**Movement on public lanes is public; cargo contents and hold values are
 * > `SENSED`.** Assert a principal with no hand in range and no purchased intel
 * > cannot derive cargo contents *by any exposed field or combination* — including
 * > through market depth, venture EV bands, or Exposure. Derivable-by-inference is
 * > the interesting failure here." — TESTING.md, PROP-VI2 / AGT-X8
 *
 * ## The three leaks this module closes, and the one it cannot
 *
 * **1. Direct.** `hands[]` is the principal's *own* hands (§12.1), so no other
 * agent's cargo has a field in the payload at all. That is not a filter, it is an
 * absence, and an absent field cannot regress.
 *
 * **2. The market book.** A book is only shown for a system the principal senses,
 * and it is aggregate by construction ({@link import('./sources.js').BookRow} has no
 * principal and no order id). A per-holder book would publish a manifest to anybody
 * with a price feed.
 *
 * **3. Affordance existence.** This is the one AGT-X8 names and the one a per-field
 * test cannot see: offering `demand` against `p-vex:h2` *is* the assertion that
 * `p-vex:h2` is there and worth demanding from. So an affordance may name another
 * principal's hand or holding only where {@link SensingIndex} says the principal can
 * see it, and `invariants.ts:sensingFaults` re-checks every published affordance against
 * the index rather than trusting the generator. It is a separate entry point from
 * `checkObservation` because it needs the reader and the index, which the payload
 * deliberately does not carry — so a caller has to pass them, and the test does.
 *
 * **What it cannot close:** timing. An agent that watches `next_reckoning.ticks`
 * and its own arrivals learns the clock, which is public anyway. The test that
 * covers the rest is the differential one — two worlds identical except for an
 * unsensed hand's cargo must produce a **byte-identical** observation — because it
 * catches inference through any field and any combination of fields, including
 * fields added later, which is exactly what a per-field assertion cannot do.
 *
 * ## Range is presence, not proximity
 *
 * "Whoever has a hand in range" (§11.2) is implemented as **a PRESENT hand in the
 * same system**. Two deliberate consequences: an arriving hand senses nothing on its
 * arrival tick, because it is not PRESENT until T+1
 * (`world/hands.ts:ARRIVAL_IS_PRESENT_SAME_TICK`), and a hand on a lane senses
 * nothing at all, because it is between places. Both fall out of using the world's
 * own predicate instead of writing a second one — which is the point: if `isPresent`
 * ever changes, sensing changes with it.
 */

import type { PrincipalId, SystemId } from '../core/types.js';
import { handsInOrder, isPresent, type WorldState } from '../world/index.js';

/**
 * Who may read a `SENSED` fact, and why.
 *
 * Two questions, matching §11.2's two admissions exactly — "whoever has a hand in
 * range, **or** bought the intel". The event ledger's audience table spells the same
 * pair `IN_RANGE` and `INTEL`
 * (`src/events/visibility.ts:AudienceBasis`); this interface is the *state-table*
 * side of the same rule, for facts that are read rather than fetched from a feed.
 */
export interface SensingIndex {
  /** Does this principal have a PRESENT hand in that system, this tick? */
  hasHandInRange(principal: PrincipalId, system: SystemId): boolean;
  /**
   * Has this principal bought intel naming `subject`?
   *
   * `subject` is a hand id, a holding id or a system id — whatever the fact is
   * about. A free-form string rather than a union because the intel market prices
   * *facts*, and enumerating them here would put the market's catalogue in a
   * visibility helper.
   */
  hasIntel(principal: PrincipalId, subject: string): boolean;
}

/**
 * The real index, over the world's presence tables.
 *
 * `purchased` is injected because intel is a traded good (§11.2: "or bought the
 * intel") and this module owns none of that market. An empty set is the honest
 * default: nobody has bought anything, so only presence senses.
 */
export function sensingFromWorld(
  world: WorldState,
  tick: number,
  purchased: ReadonlySet<string> = new Set<string>(),
): SensingIndex {
  return {
    hasHandInRange: (principal, system) =>
      handsInOrder(world).some(
        (hand) => hand.principal === principal && hand.location === system && isPresent(hand, tick),
      ),
    // '::' as the separator (never NUL), and the principal is part of the key so one
    // agent's purchase cannot be read by another.
    hasIntel: (principal, subject) => purchased.has(`${principal}::${subject}`),
  };
}

/** Nobody senses anything. For fixtures that want the strictest possible reader. */
export function sensesNothing(): SensingIndex {
  return { hasHandInRange: () => false, hasIntel: () => false };
}

/** May `principal` be shown a `SENSED` fact about `subject`, located at `system`? */
export function canSense(
  sensing: SensingIndex,
  principal: PrincipalId,
  system: SystemId,
  subject: string,
): boolean {
  return sensing.hasHandInRange(principal, system) || sensing.hasIntel(principal, subject);
}

/**
 * EXPOSURE bands (§12.1's `constellation_band`, §5.2's fallback formula).
 *
 * A band, never a figure, and the ladder is coarse and published. Two reasons:
 *
 * - §5.2 allocates the Levy "inversely to Exposure" when a vote fails quorum, so the
 *   *relative* position is the strategically meaningful part and the exact total is
 *   nobody's business;
 * - a figure would be a continuous readout of the constellation's aggregate risk,
 *   and every loss event that shrinks somebody's peril would move it — which is a
 *   `SENSED` fact arriving through arithmetic. A band that only moves on order-of-
 *   magnitude changes cannot resolve a single hold.
 *
 * Powers of ten in minor units. `null` ceiling on the top band.
 */
export const EXPOSURE_BAND_FLOORS: readonly number[] = Object.freeze([
  0, 1_000, 10_000, 100_000, 1_000_000, 10_000_000,
]);

export interface ExposureBand {
  /** Index into {@link EXPOSURE_BAND_FLOORS}. Published, so it is comparable. */
  readonly band: number;
  readonly floor: number;
  readonly ceiling: number | null;
}

export function exposureBandOf(total: number): ExposureBand {
  let band = 0;
  for (const [index, floor] of EXPOSURE_BAND_FLOORS.entries()) {
    if (total >= floor) band = index;
  }
  const floor = EXPOSURE_BAND_FLOORS[band] ?? 0;
  const next = EXPOSURE_BAND_FLOORS[band + 1];
  return { band, floor, ceiling: next ?? null };
}
