/**
 * The Charge allocation ballot — §12.2's `vote`, carrying a fourth ballot kind.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **NO NEW VERB, AND THE ARGUMENT IS §12.2'S OWN.** *"`vote` — one verb, three ballots:
 * Levy allocation (§5.3), seizure (§14), syndicate proposals (§8). All resolve at a
 * Reckoning; all are PUBLIC."* The §17 budget is at 40 of 40 and spent, so `CHARGE` is a
 * fourth **ballot**, not a fortieth-plus-one verb: `vote` already takes a `ballot`
 * parameter and `vVote` already dispatches on it. A ballot is a ballot — that is the exact
 * sentence §12.2 used to promote `vote` out of the `org` group in the first place.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## The electorate is the constellation's claimants, and the A15 hole is named
 *
 * `DRAFT-2-synthesis.md` §3 records an unclosed finding: *"A15 hole to close: voting and
 * office control as drafted are priced in identities."* It is not fully closed here and
 * pretending otherwise would be worse than leaving it open, so here is exactly where it
 * stands:
 *
 *   - **Enrolling does not buy a vote.** A ballot requires a *live claim* in the
 *     constellation, and a claim costs {@link ANCHOR_QTY} of produced goods standing at
 *     the place plus {@link CLAIM_BOND_MINOR} of slashable capital. So the price of one
 *     vote is one funded claim, which is goods and capital — A15's own currency.
 *   - **What is still open** is that N claims across N identities buy N votes for the same
 *     total outlay as N claims under one identity, which buys one. That asymmetry is real.
 *     Closing it needs either weighted ballots (which makes the vote a wealth readout and
 *     kills the coalition drama) or the surety graph (§6.4), which is `offer_surety` and
 *     unbuilt. It is recorded as open rather than papered over — the flow graph may
 *     withhold credit, never accuse (A15).
 *
 * ## Tally, quorum, and why quorum failure is not silence
 *
 * A rule needs a plurality of ballots cast **and** quorum of the electorate, or the
 * published default applies. Both halves matter: quorum stops three claimants out of
 * twenty deciding an allocation, and the published default means abstention has a defined
 * consequence rather than stalling the Charge — A14 again, because a mechanic that can be
 * dodged into quiet will be.
 */

import { phaseOfReckoning, reckoningIndex } from '../core/time.js';
import type { ConstellationId, PrincipalId } from '../core/types.js';
import { BPS_ONE } from '../core/units.js';
import { compareIds } from '../ledger/order.js';
import type { Book, ChargeBallot, ChargeRule } from './book.js';
import { isChargeRule } from './book.js';
import { PUBLISHED_DEFAULT_CHARGE_RULE } from './charge.js';
import {
  ANCHOR_QTY,
  CHARGE_BALLOT_CLOSES_PHASE,
  CHARGE_QUORUM_BPS,
  CLAIM_BOND_MINOR,
} from './params.js';

/**
 * The ballot's kind, as agents spell it.
 *
 * A bare const rather than a union member, for `observe/sources.ts:BallotRef`'s reason:
 * `test/core/vocabulary-repo.test.ts` keys its allowlist on `Union.MEMBER` pairs, so
 * declaring a `BallotKind` union would mean editing that guard's allowlist — the one edit
 * that must be argued in review rather than made in passing. `world/commons.ts` reached
 * the same conclusion for `SEIZURE_BALLOT`.
 */
export const CHARGE_BALLOT = 'CHARGE';

export interface ChargeTally {
  readonly constellation: ConstellationId;
  readonly forReckoning: number;
  readonly electorate: number;
  readonly cast: number;
  readonly quorumMet: boolean;
  readonly rule: ChargeRule;
  readonly byDefault: boolean;
  readonly spared: PrincipalId | null;
  /** Ballots per rule, canonical order. Published, so the coalition is readable. */
  readonly byRule: readonly (readonly [ChargeRule, number])[];
}

/** Ballots needed for quorum, given the electorate. Rounded up: a half-vote is not one. */
export function chargeQuorumFor(electorate: number): number {
  if (electorate <= 0) return 0;
  return Math.ceil((electorate * CHARGE_QUORUM_BPS) / BPS_ONE);
}

/**
 * Is the ballot for the next Reckoning open at this tick?
 *
 * Open from phase 0 to {@link CHARGE_BALLOT_CLOSES_PHASE}, and it decides the **next**
 * Reckoning's allocation — never this one's. That is the Levy's timing and it is the only
 * timing that satisfies A5′: an assessment minted at phase 0 from a ballot that closed
 * yesterday is an assessment a claimant could have read before it was billed. A ballot
 * that decided its own Reckoning would let the allocation move after a claimant had
 * already hauled goods to a place.
 */
export function chargeBallotWindow(tick: number): {
  readonly open: boolean;
  readonly forReckoning: number;
  readonly closesTick: number;
} {
  const phase = phaseOfReckoning(tick);
  const base = tick - phase;
  return {
    open: phase <= CHARGE_BALLOT_CLOSES_PHASE,
    forReckoning: reckoningIndex(tick) + 1,
    closesTick: base + CHARGE_BALLOT_CLOSES_PHASE,
  };
}

/**
 * Tally one constellation's ballots for one Reckoning.
 *
 * Plurality with the published default as the tie-break, so two rules on three ballots
 * each resolve to `BY_CLAIMS` rather than to whichever string sorts first. The spare is
 * the principal nominated by the most ballots, needing at least two nominations — one
 * claimant cannot relieve itself, which is the Levy's `LEVY_SPARE_MIN_NOMINATIONS` rule
 * and the same reason: self-sparing is not a coalition, it is an exemption.
 */
export function tallyCharge(args: {
  readonly book: Book;
  readonly constellation: ConstellationId;
  readonly forReckoning: number;
  readonly electorate: readonly PrincipalId[];
}): ChargeTally {
  const ballots = args.book
    .ballotsFor(args.forReckoning, args.constellation)
    .filter((b) => args.electorate.includes(b.principal));
  const counts = new Map<ChargeRule, number>();
  const nominations = new Map<PrincipalId, number>();
  for (const ballot of ballots) {
    counts.set(ballot.rule, (counts.get(ballot.rule) ?? 0) + 1);
    if (ballot.spare !== null && args.electorate.includes(ballot.spare)) {
      nominations.set(ballot.spare, (nominations.get(ballot.spare) ?? 0) + 1);
    }
  }

  const quorum = chargeQuorumFor(args.electorate.length);
  const quorumMet = ballots.length >= quorum && ballots.length > 0;

  const byRule = [...counts.entries()].sort((a, b) => b[1] - a[1] || compareIds(a[0], b[0]));
  const leader = byRule[0];
  const tied = leader !== undefined && byRule.filter((r) => r[1] === leader[1]).length > 1;
  const rule = !quorumMet || leader === undefined || tied ? PUBLISHED_DEFAULT_CHARGE_RULE : leader[0];

  let spared: PrincipalId | null = null;
  if (quorumMet) {
    const ranked = [...nominations.entries()].sort((a, b) => b[1] - a[1] || compareIds(a[0], b[0]));
    const top = ranked[0];
    // At least two nominations, and never a lone self-nomination. `>= 2` is the whole
    // check: a claimant nominating itself contributes one, so it needs a second claimant
    // to agree, which is what makes sparing an act of the group (§14.4's named loser is
    // only a story if the group chose it).
    if (top !== undefined && top[1] >= 2) spared = top[0];
  }

  return {
    constellation: args.constellation,
    forReckoning: args.forReckoning,
    electorate: args.electorate.length,
    cast: ballots.length,
    quorumMet,
    rule,
    byDefault: rule === PUBLISHED_DEFAULT_CHARGE_RULE && (!quorumMet || tied || leader === undefined),
    spared,
    byRule,
  };
}

/**
 * Build a ballot, or `null` when this principal has no constellation to vote in.
 *
 * The constellation is read from the claims the principal actually holds, not from where
 * its holding stands: a claimant whose body has moved on still bears the Charge on the
 * claim it kept, and it must be able to vote on the allocation it is being assessed under.
 */
export function chargeBallotFor(args: {
  readonly book: Book;
  readonly voter: PrincipalId;
  readonly rule: ChargeRule;
  readonly spare: PrincipalId | null;
  readonly tick: number;
}): ChargeBallot | null {
  const constellation = chargeConstituencyOf(args.book, args.voter);
  if (constellation === null) return null;
  const window = chargeBallotWindow(args.tick);
  return {
    principal: args.voter,
    constellation,
    forReckoning: window.forReckoning,
    rule: args.rule,
    spare: args.spare,
    tick: args.tick,
  };
}

/**
 * The constellation a principal votes in: the one its claims are in.
 *
 * A principal holding claims in two constellations votes in the **first by id**, and that
 * is a stated limit rather than an accident: one ballot per principal is A4, and a
 * multi-constellation claimant would otherwise need one ballot per constellation, which is
 * a different mechanic. In the launch map there is one constellation with claimable
 * systems, so this is unreachable today; it is written as a rule so it cannot become a
 * silent `undefined` when the map grows.
 */
export function chargeConstituencyOf(book: Book, principal: PrincipalId): ConstellationId | null {
  const claims = book.claimsOf(principal);
  const first = [...claims].sort((a, b) => compareIds(a.constellation, b.constellation))[0];
  return first?.constellation ?? null;
}

/**
 * Why this ballot cannot be cast, as a sentence, or `null` if it can.
 *
 * Every clause teaches. An agent that reads a refusal and cannot tell what to do next
 * spends its actions on refusal loops, which is the noise that buries real rules-surface
 * defects (AGT-S3).
 */
export function chargeVoteFault(args: {
  readonly book: Book;
  readonly voter: PrincipalId;
  readonly rule: string;
  readonly spare: string | null;
  readonly tick: number;
}): string | null {
  if (!isChargeRule(args.rule)) {
    return (
      `'${args.rule}' is not a published Charge allocation rule. The three are EVEN (every claim the same), ` +
      'BY_CLAIMS (weight by how many claims the claimant holds — the published default, applied on quorum ' +
      'failure) and BY_TIER (the Frontier bears more than the Marches). Send ' +
      `{"ballot":"${CHARGE_BALLOT}","rule":"BY_CLAIMS"}.`
    );
  }
  const constellation = chargeConstituencyOf(args.book, args.voter);
  if (constellation === null) {
    return (
      'the Charge ballot is for claimants: it allocates the total your constellation owes across the claims ' +
      'in it, and you hold none. Take a claim first — `build` {"kind":"ANCHOR","system":"<id>"} costs ' +
      `${String(ANCHOR_QTY)} units of produced goods standing there plus a posted bond of ` +
      `${String(CLAIM_BOND_MINOR)}. Enrolling again does not buy a vote here (A15).`
    );
  }
  const window = chargeBallotWindow(args.tick);
  if (!window.open) {
    return (
      `the Charge ballot for Reckoning ${String(window.forReckoning)} closed at tick ` +
      `${String(window.closesTick)}; the allocation is fixed and the assessment is minted at the start of ` +
      'that Reckoning. Vote earlier in the cycle — the ballot opens at phase 0 and you have ' +
      `${String(CHARGE_BALLOT_CLOSES_PHASE)} ticks.`
    );
  }
  if (args.spare !== null) {
    const target = args.spare as PrincipalId;
    if (chargeConstituencyOf(args.book, target) !== constellation) {
      return (
        `${args.spare} holds no claim in ${constellation}, so it cannot be spared a share of a Charge it does ` +
        'not bear. Nominate a claimant in your own constellation, or leave `spare` out.'
      );
    }
  }
  return null;
}
