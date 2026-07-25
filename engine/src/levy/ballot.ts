/**
 * The Levy allocation ballot — §5.2's *"the allocation is a scheduled constellation
 * vote, and that is the drama"*, and §12.2's `vote`: **one verb, three ballots.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **NO NEW VERB.** The verb budget is at 39 of 40 (§17) and `vote` already exists for
 * three ballots. This module supplies the LEVY ballot's *parameters* and its tally;
 * the verb, its freeness, and its Commons classification are already decided in
 * `tick/budget.ts` (`vote` is free) and `world/commons.ts` (`LEVY` is a peaceful
 * ballot, unlike `SEIZURE`).
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## Why a vote rather than a formula, restated because it constrains the code
 *
 * §5.2: *"A published formula plus an algorithmic sweep forces activity, not conflict
 * — no coalition, no protagonist, no named loser."* So the tally must produce a
 * **name**, not only a number: {@link Tally.spared} is the protagonist and
 * {@link namedLoser} is the principal the group's choice cost the most. A tally that
 * returned a rule alone would satisfy the arithmetic and none of the design.
 *
 * ## What a ballot can and cannot do, and why the asymmetry is deliberate
 *
 * A ballot names a **rule** and may nominate **one principal to spare**. It cannot
 * name a principal to *load*. That asymmetry is the anti-Sybil shape (A15): a
 * coalition of cheap identities voting to spare itself moves at most one principal's
 * own duty, redistributed by a published rule — while a coalition able to *target*
 * would be an execution priced in enrolments, which is the one price the design
 * forbids. §5.2's own words are "who is **spared** is a choice the society makes",
 * and the named loser falls out of that choice rather than being cast by it.
 */

import type { ConstellationId, PrincipalId } from '../core/types.js';
import { BPS_ONE } from '../core/units.js';
import { compareIds } from '../ledger/order.js';
import { isLevyRule, PUBLISHED_DEFAULT_RULE, type AllocationPlan, type LevyRule } from './assessment.js';
import { LEVY_QUORUM_BPS, LEVY_SPARE_MIN_NOMINATIONS } from './params.js';

/** The ballot kind, as `vote`'s `ballot` parameter spells it. §12.2's three ballots. */
export const LEVY_BALLOT = 'LEVY';

/** One principal's ballot. One per principal per cycle: a restatement replaces it. */
export interface LevyBallot {
  readonly principal: PrincipalId;
  readonly constellation: ConstellationId;
  /** Which Reckoning's allocation this ballot decides — always the *next* one. */
  readonly forReckoning: number;
  readonly rule: LevyRule;
  /** Who this ballot would spare. `null` is a legitimate ballot: a vote for the rule alone. */
  readonly spare: PrincipalId | null;
  readonly tick: number;
}

export interface Tally {
  readonly constellation: ConstellationId;
  readonly forReckoning: number;
  readonly cast: number;
  readonly eligible: number;
  readonly quorumNeeded: number;
  readonly reachedQuorum: boolean;
  readonly rule: LevyRule;
  readonly spared: PrincipalId | null;
  /** Ballots for the winning rule. Published so a viewer can read the margin. */
  readonly ruleVotes: number;
  readonly spareVotes: number;
}

/**
 * Ballots a principal may not cast, checked at the door.
 *
 * Returned as a reason string rather than thrown: `vote` is an agent-reachable verb and
 * a refusal is a hint (§12.2), never an error and never a halt.
 */
export function ballotFault(args: {
  readonly rule: string;
  readonly spare: string | null;
  readonly roll: readonly PrincipalId[];
  readonly voter: PrincipalId;
}): string | null {
  if (!isLevyRule(args.rule)) {
    return (
      `a LEVY ballot names one of BY_EXPOSURE, BY_STORES, EVEN, INVERSE_EXPOSURE as its rule; ` +
      `got ${args.rule}. INVERSE_EXPOSURE is the published default and applies if quorum fails.`
    );
  }
  if (!args.roll.includes(args.voter)) {
    return 'you are not on this constellation\'s roll, so you have no ballot in its Levy allocation.';
  }
  if (args.spare !== null && !args.roll.includes(args.spare as PrincipalId)) {
    return (
      `you can only nominate a principal in your own constellation to be spared; ` +
      `${args.spare} is not on its roll.`
    );
  }
  return null;
}

/** How many ballots this constellation needs before its vote carries at all (§5.2). */
export function quorumFor(eligible: number): number {
  if (eligible <= 0) return 0;
  // Ceiling, so a 2-principal constellation needs 1 and a 3-principal one needs 2:
  // rounding a quorum down is how a "majority" becomes a plurality of one.
  return Math.ceil((eligible * LEVY_QUORUM_BPS) / BPS_ONE);
}

/**
 * Tally a constellation's ballots.
 *
 * Deterministic in every branch, and the tie-breaks are stated rather than incidental:
 *
 *   - **Rule ties go to {@link PUBLISHED_DEFAULT_RULE}** if it is tied, else to the
 *     lowest rule name. Resolving a tie by the published default is the honest answer:
 *     the constellation did not decide, so the published thing applies.
 *   - **Spare ties go to the lowest principal id.** Arbitrary, and it must be *some*
 *     stated rule or two runs of one seed would disagree (DET-1).
 *   - **A spare needs {@link LEVY_SPARE_MIN_NOMINATIONS} nominations**, so sparing is a
 *     coalition rather than a unilateral opt-out.
 *   - **Quorum failure discards the whole outcome**, rule and spare together. Half of
 *     §5.2's default is that the *published formula* applies; keeping a spared name
 *     from a failed vote would apply half a decision nobody reached.
 */
export function tally(args: {
  readonly constellation: ConstellationId;
  readonly forReckoning: number;
  readonly ballots: readonly LevyBallot[];
  readonly eligible: number;
}): Tally {
  const ballots = [...args.ballots]
    .filter((b) => b.constellation === args.constellation && b.forReckoning === args.forReckoning)
    .sort((a, b) => compareIds(a.principal, b.principal));

  const quorumNeeded = quorumFor(args.eligible);
  const reachedQuorum = ballots.length >= quorumNeeded && quorumNeeded > 0;

  const ruleCounts = new Map<LevyRule, number>();
  const spareCounts = new Map<PrincipalId, number>();
  for (const ballot of ballots) {
    ruleCounts.set(ballot.rule, (ruleCounts.get(ballot.rule) ?? 0) + 1);
    if (ballot.spare !== null) {
      spareCounts.set(ballot.spare, (spareCounts.get(ballot.spare) ?? 0) + 1);
    }
  }

  let rule: LevyRule = PUBLISHED_DEFAULT_RULE;
  let ruleVotes = 0;
  for (const [candidate, votes] of [...ruleCounts].sort((a, b) => compareIds(a[0], b[0]))) {
    if (votes > ruleVotes) {
      rule = candidate;
      ruleVotes = votes;
      continue;
    }
    if (votes === ruleVotes && candidate === PUBLISHED_DEFAULT_RULE) rule = candidate;
  }

  let spared: PrincipalId | null = null;
  let spareVotes = 0;
  for (const [candidate, votes] of [...spareCounts].sort((a, b) => compareIds(a[0], b[0]))) {
    if (votes > spareVotes) {
      spared = candidate;
      spareVotes = votes;
    }
  }
  if (spareVotes < LEVY_SPARE_MIN_NOMINATIONS) {
    spared = null;
    spareVotes = 0;
  }

  if (!reachedQuorum) {
    return {
      constellation: args.constellation,
      forReckoning: args.forReckoning,
      cast: ballots.length,
      eligible: args.eligible,
      quorumNeeded,
      reachedQuorum: false,
      rule: PUBLISHED_DEFAULT_RULE,
      spared: null,
      ruleVotes: 0,
      spareVotes: 0,
    };
  }

  return {
    constellation: args.constellation,
    forReckoning: args.forReckoning,
    cast: ballots.length,
    eligible: args.eligible,
    quorumNeeded,
    reachedQuorum,
    rule,
    spared,
    ruleVotes,
    spareVotes,
  };
}

/**
 * The principal the group's choice cost the most, against the published default.
 *
 * §14.4's Law 2 wants a *named* loser by the group's action every cycle. This is that
 * name, computed rather than authored (A12): whoever's assessment rose furthest above
 * what the published formula would have charged. `null` when the vote changed nothing,
 * which is an honest answer and must not be dressed up as a victim.
 */
export function namedLoser(
  voted: AllocationPlan,
  underDefault: AllocationPlan,
): { readonly principal: PrincipalId; readonly extra: number } | null {
  const baseline = new Map<PrincipalId, number>();
  for (const line of underDefault.lines) baseline.set(line.principal, line.amount);

  let worst: { readonly principal: PrincipalId; readonly extra: number } | null = null;
  for (const line of [...voted.lines].sort((a, b) => compareIds(a.principal, b.principal))) {
    const extra = line.amount - (baseline.get(line.principal) ?? line.amount);
    if (extra <= 0) continue;
    if (worst === null || extra > worst.extra) worst = { principal: line.principal, extra };
  }
  return worst;
}
