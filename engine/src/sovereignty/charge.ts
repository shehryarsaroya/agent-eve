/**
 * THE CHARGE — SPEC §6.3's recurring upkeep, built on §5.2's two halves.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE LEVY'S SPLIT, TRANSPLANTED, BECAUSE THAT SPLIT IS WHY THE LEVY WORKS:**
 *
 *   1. **The total is fixed by rule and cannot be dodged** — `Σ chargeOf(claim)` over the
 *      constellation's live claims, where a claim's rule-fixed amount depends only on its
 *      tier and its own arrears. No agent action lowers it. *That is the alarm.*
 *   2. **The allocation is a vote** — the total is then borne across the claims according
 *      to a weight rule the constellation's **claimants** chose, with one claimant
 *      possibly spared. *That is the drama:* a coalition of claimants can vote the whole
 *      constellation's upkeep onto the one holding the most territory, or spare the one
 *      it is trying to keep alive. §14.4's named loser, in goods, on a clock.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## Why the vote is among claimants and not among everybody
 *
 * The Levy's roll is the constellation's whole population, because a Levy is what the
 * *world* asks of everyone. The Charge is what a *claim* costs, so the roll is the claims
 * and the electorate is the principals holding them. Two consequences worth stating:
 * a principal with no claim cannot be assessed a Charge (it is not projecting force, so
 * §6.3's price does not apply to it) and cannot vote on one; and a claimant with several
 * claims has one ballot, not several, because A4 forbids power that scales with anything
 * other than judgement.
 *
 * ## A15: additive, so identities buy no relief
 *
 * The total is `Σ` over claims, not a pot divided among claimants. An extra identity that
 * takes a claim adds that claim's own rule-fixed amount to the total and lowers nobody
 * else's; an extra identity that takes *no* claim changes nothing at all. So the only ways
 * to move burden are the vote and delivery, and delivery costs produced goods standing at
 * a named place. *(Voting weight is per claimant, so a Sybil fleet could pack the ballot —
 * that hole is named in `ballot.ts` and priced there, not here.)*
 *
 * ## SOV-4 is arithmetic, not intention: Σ lines === total, EXACTLY
 *
 * Every allocation goes through {@link allocateCharge}'s largest-remainder pass, and the
 * pass is **`core/allocate.ts`'s** {@link largestRemainder} rather than a second copy. An
 * allocation summing to one unit more than the total would put a claim into arrears for a
 * debt the rule never created — a fabricated debt is the A5′ shape wearing arithmetic, and
 * this repo has shipped eight bugs of that shape.
 */

import type { ConstellationId, PrincipalId, ZoneTier } from '../core/types.js';
import { BPS_ONE, qty, type Qty } from '../core/units.js';
import { largestRemainder } from '../core/allocate.js';
import { compareIds } from '../ledger/order.js';
import type { ClaimId, ChargeLine, ChargeRule } from './book.js';
import {
  CHARGE_ARREARS_SURCHARGE_BPS,
  CHARGE_BY_TIER,
} from './params.js';

export class ChargeArithmeticError extends Error {}

/**
 * Distribute a quantity across integer weights, exactly.
 *
 * **`core/allocate.ts`'s `largestRemainder`, not a second copy** — a second largest-remainder
 * implementation is scar #5 applied to an algorithm, and the failure mode is a total off by one unit
 * in one of the two mechanics, which is a fabricated debt in whichever one drifted.
 *
 * The `minor()`/`qty()` round trip this used to make is gone as of the ONE-HOME sweep: the allocator
 * moved out of `levy/` and is generic over the brand, so the Charge's `Qty` stays `Qty` end to end.
 */
function shareOut(amount: Qty, weights: readonly number[]): readonly Qty[] {
  return largestRemainder(amount, weights);
}

/**
 * The published default allocation rule.
 *
 * `BY_CLAIMS` — the more territory you hold, the more of the constellation's upkeep you
 * bear. It is also the tie-break when two rules draw the same number of ballots, so a tie
 * resolves by the published rule rather than by alphabetical accident.
 *
 * Chosen as the default rather than `EVEN` because a default that ignored how much
 * territory a claimant held would make the *first* claim the expensive one and the tenth
 * nearly free, which is the opposite of an anti-Sybil price on projecting force (A15).
 */
export const PUBLISHED_DEFAULT_CHARGE_RULE: ChargeRule = 'BY_CLAIMS';

/** What the rule needs to know about one claim. Facts, never opinions. */
export interface ChargeSubject {
  readonly claim: ClaimId;
  readonly system: string;
  readonly claimant: PrincipalId;
  readonly tier: ZoneTier;
  /** Consecutive Charges this **system** has been recorded short. Never the claimant's. */
  readonly misses: number;
}

/**
 * One claim's rule-fixed amount — the thing the total is the sum of.
 *
 * Tier plus a **bounded** arrears surcharge, and the boundedness is the whole
 * anti-death-spiral argument: the surcharge is a fraction of *this* Reckoning's tier
 * amount however many Reckonings the claim has been short, so the cure never becomes
 * arithmetically unreachable. `params.ts:CHARGE_ARREARS_SURCHARGE_BPS` carries the
 * critic's sentence.
 *
 * Rounded **up** on the surcharge, so a claim in arrears always pays strictly more than
 * one that is not — a surcharge that rounded away would make the first miss free.
 */
export function chargeOf(subject: Pick<ChargeSubject, 'tier' | 'misses'>): Qty {
  const base = CHARGE_BY_TIER[subject.tier];
  if (subject.misses <= 0) return base;
  const product = base * CHARGE_ARREARS_SURCHARGE_BPS;
  if (!Number.isSafeInteger(product)) {
    throw new ChargeArithmeticError(`surcharge overflow: ${String(base)} x ${String(CHARGE_ARREARS_SURCHARGE_BPS)}`);
  }
  return qty(base + Math.ceil(product / BPS_ONE));
}

/**
 * The constellation's total Charge. Fixed by rule; cannot be dodged.
 *
 * Nothing an agent does between one Reckoning and the next lowers this except *giving up
 * a claim*, which removes exactly that claim's own amount and no more. Paying does not
 * lower it (it discharges a line), voting does not lower it (it moves who bears it), and
 * enrolling does not lower it (A15).
 */
export function totalCharge(subjects: readonly ChargeSubject[]): Qty {
  let total = 0;
  for (const subject of subjects) total += chargeOf(subject);
  return qty(total);
}

/**
 * The weight one claim carries under a rule. Integers, always ≥ 1.
 *
 * A zero weight would be an exemption, and the Charge has none — a spared claimant bears
 * the nominal share, never nothing, for the same reason §5.2's most-exposed principal
 * pays less rather than nothing.
 */
export function chargeWeightOf(
  rule: ChargeRule,
  subject: ChargeSubject,
  claimsHeld: number,
): number {
  switch (rule) {
    case 'EVEN':
      return 1;
    case 'BY_CLAIMS':
      // The claimant's total live claims, so a claimant holding four bears four times the
      // weight *per claim* — sixteen times the share of a claimant holding one. That is
      // deliberately superlinear: it is the anti-Sybil price of projecting force with the
      // sharpest edge the rule set allows, and it is published.
      return Math.max(1, claimsHeld);
    case 'BY_TIER':
      // The Frontier is where the world is least able to supply, so a `BY_TIER` vote is
      // the constellation saying "the far claims pay". Weights are the tier amounts
      // themselves, which keeps the rule readable off one word (A2).
      return Math.max(1, CHARGE_BY_TIER[subject.tier]);
  }
}

/**
 * The nominal share — what a spared claim pays instead of its allocated share.
 *
 * A tenth of the tier amount, rounded up, so it is never zero: sparing is relief, not an
 * exemption, and a spared claim still has to have a hand at the place with goods in it.
 * That matters more here than in the Levy, because the thing at the end of the arrears
 * ladder is losing territory rather than losing venture capacity.
 */
export function nominalChargeOf(tier: ZoneTier): Qty {
  return qty(Math.ceil(CHARGE_BY_TIER[tier] / 10));
}

export interface ChargeAllocation {
  readonly constellation: ConstellationId;
  readonly total: Qty;
  readonly rule: ChargeRule;
  readonly spared: PrincipalId | null;
  readonly lines: readonly ChargeLine[];
  /** True when quorum failed and the published default was applied. */
  readonly byDefault: boolean;
}

/**
 * Allocate a constellation's total across its claims under a rule, exactly.
 *
 * The shape, and each clause is a design sentence rather than a preference:
 *
 *   - **A spared claimant's claims are assessed the nominal share** and take no part in
 *     the remainder pool. SOV-5 halts on a spared claim assessed above nominal, so this
 *     is the relief made structural rather than checked.
 *   - **The remainder is the whole of the rest**, distributed by weight with the
 *     largest-remainder method and a canonical tie-break. Σ is exact by construction and
 *     asserted before returning.
 *   - **If nobody is left in the pool** — every claimant in the constellation was spared —
 *     the remainder has nowhere to go that would not break the relief, so the total gives
 *     way and becomes `Σ nominal`. It moves **down**, by rule, exactly once, and
 *     {@link relievedChargeTotal} is the only place it happens. That is the Levy's
 *     `relievedTotal` argument, and the honest reading here is that a constellation which
 *     unanimously spares itself is a constellation that has voted to under-supply its own
 *     frontier — the arrears that follows is the world's answer, not a bug.
 */
export function allocateCharge(args: {
  readonly constellation: ConstellationId;
  readonly subjects: readonly ChargeSubject[];
  readonly rule: ChargeRule;
  readonly spared: PrincipalId | null;
  readonly byDefault: boolean;
}): ChargeAllocation {
  const subjects = [...args.subjects].sort((a, b) => compareIds(a.system, b.system));
  const claimsHeld = new Map<PrincipalId, number>();
  for (const subject of subjects) {
    claimsHeld.set(subject.claimant, (claimsHeld.get(subject.claimant) ?? 0) + 1);
  }

  const spared =
    args.spared !== null && subjects.some((s) => s.claimant === args.spared) ? args.spared : null;
  const relieved = subjects.filter((s) => s.claimant === spared);
  const pool = subjects.filter((s) => s.claimant !== spared);
  const total = relievedChargeTotal(subjects, spared);
  let nominalPart = 0;
  for (const subject of relieved) nominalPart += nominalChargeOf(subject.tier);
  const remainder = qty(Math.max(0, total - nominalPart));

  const weights = pool.map((s) => chargeWeightOf(args.rule, s, claimsHeld.get(s.claimant) ?? 1));
  const shares = shareOut(remainder, weights);

  const byClaim = new Map<ClaimId, ChargeLine>();
  for (const subject of relieved) {
    byClaim.set(subject.claim, {
      claim: subject.claim,
      system: subject.system as ChargeLine['system'],
      claimant: subject.claimant,
      ruleQty: chargeOf(subject),
      amount: nominalChargeOf(subject.tier),
      spared: true,
      missesAtAssessment: subject.misses,
      weight: 0,
    });
  }
  for (const [i, subject] of pool.entries()) {
    byClaim.set(subject.claim, {
      claim: subject.claim,
      system: subject.system as ChargeLine['system'],
      claimant: subject.claimant,
      ruleQty: chargeOf(subject),
      amount: qty(shares[i] ?? 0),
      spared: false,
      missesAtAssessment: subject.misses,
      weight: weights[i] ?? 0,
    });
  }

  const lines = subjects
    .map((s) => byClaim.get(s.claim))
    .filter((line): line is ChargeLine => line !== undefined);

  const summed = lines.reduce<number>((acc, line) => acc + line.amount, 0);
  if (summed !== total) {
    // Never reachable through `largestRemainder`, which asserts its own sum. Kept because
    // SOV-4 is the invariant this function exists to satisfy, and a constructor that
    // cannot be trusted to satisfy it should say so here rather than let ASSERT halt a
    // world over arithmetic that was wrong before it left this file.
    throw new ChargeArithmeticError(
      `Charge allocation for ${args.constellation} sums to ${String(summed)}, not ${String(total)}; SOV-4 ` +
        'would halt the tick',
    );
  }

  return { constellation: args.constellation, total, rule: args.rule, spared, lines, byDefault: args.byDefault };
}

/**
 * The total after the relief has taken what it must.
 *
 * Ordinarily `Σ chargeOf` unchanged: the spared claimant's relief is redistributed across
 * the rest, which is what makes the vote a *redistribution* rather than a discount and is
 * exactly why sparing somebody is a decision with a named loser. It differs in one case —
 * every claim in the constellation belongs to the spared claimant — and then the total
 * becomes `Σ nominal`, because there is nobody to redistribute to and the alternative
 * would be assessing a spared claim above nominal.
 */
export function relievedChargeTotal(
  subjects: readonly ChargeSubject[],
  spared: PrincipalId | null,
): Qty {
  const pool = subjects.filter((s) => s.claimant !== spared);
  if (pool.length === 0) {
    let nominal = 0;
    for (const subject of subjects) nominal += nominalChargeOf(subject.tier);
    return qty(nominal);
  }
  return totalCharge(subjects);
}
