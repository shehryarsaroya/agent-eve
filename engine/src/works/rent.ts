/**
 * THE RENT — a claim's share of what the ground under it gives up.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE ARITHMETIC LIVES HERE, ALONE, BECAUSE IT IS THE ONE PLACE GOODS COULD BE MINTED.**
 *
 * A rent is a *split* of a quantity the world has already decided to hand over, and the
 * decision was made by `Book.sharesAt`, whose whole reason for existing is that
 * `Σ shares === YIELD_PER_TICK[tier]` **exactly** (INV-W1). If the split of a share into
 * `rent + net` can ever sum to more than the share, then goods enter the world from rounding —
 * at every claimed system, every tick, a unit at a time — and the A15 argument the WORKS
 * module is built on ("total world output is a property of the map, so enrolling changes
 * nothing") quietly stops being true.
 *
 * So there is exactly one function that does it, it returns both halves, and
 * `invariants.ts:checkRentConserves` asserts the sum against the gross rather than trusting
 * this comment.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## Why the rounding goes to the TENANT and not to the landlord
 *
 * `Math.trunc` on the landlord's side, so a fractional unit is kept by whoever extracted it.
 * This is not politeness: the rent is a claim on **another principal's labour**, and a rent
 * that rounded up would take a unit the rule never awarded. At 288 ticks across every claimed
 * system that is a real drip, it accrues to whoever holds the most territory, and it would be
 * invisible — the same shape as the share split rounding up, which INV-W1 exists to catch.
 * §10.2 requires published rounding; this is the published direction.
 *
 * ## Why a landlord never pays itself rent
 *
 * {@link rentOn} returns zero when the extractor *is* the claimant. Two postings that move a
 * quantity from a principal to itself are noise in the ledger and a lie on the frame — the
 * claim line would report rent taken where nothing changed hands, and `tenants` would count a
 * landlord as its own resident. The politics only exists between two principals.
 */

import type { PrincipalId } from '../core/types.js';
import { BPS_ONE, qty, type Qty } from '../core/units.js';

/**
 * The published terms of tenancy at one system: who takes rent there, and at what rate.
 *
 * Both fields come off the claim record, never off a constant — see `ClaimRecord.rentBps` for
 * why the rate is pinned rather than read live. `null` from the port means unclaimed ground, or
 * ground whose claim has already ended: nobody takes rent, and the extractor keeps everything.
 */
export interface RentTerms {
  readonly claimant: PrincipalId;
  /** Bps of extraction the claimant takes. Pinned when the claim was raised. */
  readonly bps: number;
  /**
   * Units of the FUEL good this claim burns per Reckoning to keep collecting. Zero means none.
   *
   * A tier fact rather than a term of tenancy, so — unlike {@link RentTerms.bps} — it is **not**
   * pinned on the claim record. The distinction is exact: the rate is a number a resident relied on
   * before it spent 60,000 raising a WORKS, and the fuel figure is the landlord's own cost, which
   * no tenant plans against. `sovereignty/params.ts:ANCHOR_FUEL_BY_TIER` is the one home for it.
   */
  readonly fuelWant: number;
}

/** A gross share, split into what the landlord takes and what the extractor keeps. */
export interface RentSplit {
  readonly rent: Qty;
  readonly net: Qty;
}

/**
 * Split a gross share exactly. `rent + net === gross`, always, by construction.
 *
 * Truncated on the rent, so the remainder stays with the extractor. The addition is done as
 * `gross - rent` rather than as a second multiplication precisely so the identity cannot fail:
 * two independent roundings of the same quantity is scar #5's shape in arithmetic.
 */
export function rentSplit(gross: Qty, rate: number): RentSplit {
  if (gross <= 0 || rate <= 0) return { rent: qty(0), net: qty(Math.max(0, gross)) };
  const product = gross * rate;
  if (!Number.isSafeInteger(product)) {
    // Unreachable at any published yield, and stated rather than trusted: a float here would be
    // unhashable (DET) and a silently wrong rent is a value transfer nobody authorised.
    return { rent: qty(0), net: gross };
  }
  const rent = Math.min(gross, Math.trunc(product / BPS_ONE));
  return { rent: qty(rent), net: qty(gross - rent) };
}

/**
 * Does a rent apply to this extractor at all? **The one home for the predicate.**
 *
 * Separate from {@link rentOn} because two surfaces need the *rate* without needing the amount —
 * `worksLines` publishes what a resident is charged, and at a small enough share the amount
 * truncates to zero while the rate is still very much in force. Deriving "is there a landlord
 * here" from `rent > 0` made a WORKS on claimed ground render as unclaimed for exactly that case,
 * so the question is asked once, here, and both callers ask it.
 */
export function rentApplies(terms: RentTerms | null, extractor: PrincipalId): boolean {
  return terms !== null && terms.claimant !== extractor && terms.bps > 0;
}

/**
 * What the claim at a system takes from ONE extractor's share this tick.
 *
 * The whole rule in one place: no claim means no rent, and a claimant's own WORKS pays none.
 */
export function rentOn(args: {
  readonly terms: RentTerms | null;
  readonly extractor: PrincipalId;
  readonly gross: Qty;
}): RentSplit {
  const { terms, extractor, gross } = args;
  if (!rentApplies(terms, extractor) || terms === null) return { rent: qty(0), net: gross };
  return rentSplit(gross, terms.bps);
}
