/**
 * The Levy's clock. Three moments per cycle, and the *order* of them is the mechanic.
 *
 * ```text
 *  phase 0        ASSESS    total fixed by rule; the ballot cast last cycle allocates it;
 *                           tribute lines drawn DASHED; the next cycle's ballot opens
 *  phases 0..262  PAY/VOTE  deliver, set_delivery_intent, vote
 *  phase 263      BALLOT    the ballot for the NEXT Reckoning closes (WINDOW_FIRST_PHASE)
 *  phase 286      FREEZE    unpaid tribute lines turn RED; deliveries refused (§5.1)
 *  phase 287      SETTLE    shortfall, sweep least-exposed first, strikes, LEVY SHORT
 * ```
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE VOTE DECIDES THE *NEXT* RECKONING, NOT THIS ONE**, and `params.ts` argues why at
 * length on {@link LEVY_BALLOT_CLOSES_PHASE}. The short version: an assessment that could
 * move mid-cycle would either confiscate goods a principal had already handed over, or
 * break INV-24's exact sum, or render the vote as a glitch in the line's thickness. §5.2
 * says the constellation votes *"before each Reckoning"*, and this is that read
 * literally.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Everything here is a pure function of `(book, world, tick)` plus injected reads. The
 * tick loop owns *when*; this module owns *what*.
 */

import { phaseOfReckoning, reckoningIndex } from '../core/time.js';
import type { ConstellationId, PrincipalId } from '../core/types.js';
import { compareIds } from '../ledger/order.js';
import type { WorldState } from '../world/state.js';
import {
  allocate,
  PUBLISHED_DEFAULT_RULE,
  type AllocationPlan,
  type LevySubject,
} from './assessment.js';
import { ballotFault, LEVY_BALLOT, namedLoser, tally, type LevyBallot, type Tally } from './ballot.js';
import type { Book, LevyPlan } from './book.js';
import { LEVY_ASSESS_PHASE, LEVY_BALLOT_CLOSES_PHASE } from './params.js';
import { constellationOf, deliveryPlaceOf, rollByConstellation } from './place.js';

/** What the Levy needs to know about one principal. Supplied by the runtime. */
export type SubjectRead = (principal: PrincipalId) => LevySubject;

/** Is this the tick a Reckoning's assessment is minted at? */
export function isAssessTick(tick: number): boolean {
  return phaseOfReckoning(tick) === LEVY_ASSESS_PHASE;
}

/**
 * The ballot window a tick sits in.
 *
 * `forReckoning` is always `reckoningIndex(tick) + 1`: a ballot cast now decides the
 * allocation of the cycle *after* this one. `closesTick` is published so the affordance
 * and the observation can show an agent exactly how long it has, from the same
 * arithmetic the refusal uses.
 */
export function ballotWindow(tick: number): {
  readonly forReckoning: number;
  readonly open: boolean;
  readonly closesTick: number;
} {
  const reckoning = reckoningIndex(tick);
  const phase = phaseOfReckoning(tick);
  const closesTick = tick - phase + LEVY_BALLOT_CLOSES_PHASE;
  return { forReckoning: reckoning + 1, open: phase <= LEVY_BALLOT_CLOSES_PHASE, closesTick };
}

/**
 * Why this `vote` cannot be accepted, as a sentence, or `null`.
 *
 * A closed ballot is a refusal with a hint and never an error — and never a halt, because
 * `vote` is agent-reachable and three agent-triggerable halts have shipped in this repo.
 */
export function voteFault(args: {
  readonly book: Book;
  readonly world: WorldState;
  readonly voter: PrincipalId;
  readonly rule: string;
  readonly spare: string | null;
  readonly tick: number;
}): string | null {
  const window = ballotWindow(args.tick);
  if (!window.open) {
    return (
      `the ${LEVY_BALLOT} ballot for Reckoning ${String(window.forReckoning)} closed at tick ` +
      `${String(window.closesTick)}, when the commitment window opened. The last 24 ticks and the freeze are ` +
      `for paying, not for arguing; the next ballot opens at the start of the next Reckoning.`
    );
  }
  const constellation = constellationOf(args.world, args.voter);
  if (constellation === null) {
    return 'your holding is not in a constellation the map knows, so you have no Levy ballot to cast.';
  }
  const roll = rollByConstellation(args.world).get(constellation) ?? [];
  return ballotFault({ rule: args.rule, spare: args.spare, roll, voter: args.voter });
}

export interface AssessedCycle {
  readonly reckoning: number;
  readonly tick: number;
  readonly plans: readonly LevyPlan[];
  readonly tallies: readonly Tally[];
  /** Per constellation: the principal the group's choice cost the most (§14.4, Law 2). */
  readonly losers: readonly { readonly constellation: ConstellationId; readonly principal: PrincipalId; readonly extra: number }[];
}

/**
 * Mint every constellation's assessment for a Reckoning.
 *
 * The two-plan shape is deliberate rather than wasteful: the voted allocation *and* the
 * one the published default would have produced are both computed, because
 * {@link namedLoser} is the difference between them. §14.4 wants a named loser **by the
 * group's action** every cycle, and "by the group's action" is only meaningful against
 * the counterfactual where the group did nothing.
 *
 * Refuses nothing and throws nothing an agent can cause: a constellation with no roll is
 * skipped, and a constellation with no delivery place is skipped and reported by the
 * caller. Assessing a principal at a place it cannot reach would be an obligation the
 * rules make impossible to discharge — see `place.ts`.
 */
export function assessCycle(args: {
  readonly book: Book;
  readonly world: WorldState;
  readonly tick: number;
  readonly subjectOf: SubjectRead;
}): AssessedCycle {
  const reckoning = reckoningIndex(args.tick);
  const plans: LevyPlan[] = [];
  const tallies: Tally[] = [];
  const losers: { constellation: ConstellationId; principal: PrincipalId; extra: number }[] = [];

  for (const [constellation, roll] of [...rollByConstellation(args.world).entries()].sort((a, b) =>
    compareIds(a[0], b[0]),
  )) {
    if (roll.length === 0) continue;
    if (args.book.isAssessed(reckoning, constellation)) continue;
    const place = deliveryPlaceOf(args.world.map, constellation);
    if (place === null) continue;

    const subjects = [...roll].sort(compareIds).map((p) => args.subjectOf(p));
    const counted = tally({
      constellation,
      forReckoning: reckoning,
      ballots: args.book.ballotsFor(reckoning, constellation),
      eligible: roll.length,
    });
    tallies.push(counted);

    const voted = allocate({
      constellation,
      subjects,
      rule: counted.rule,
      spared: counted.spared,
      byDefault: !counted.reachedQuorum,
    });
    const underDefault: AllocationPlan =
      counted.reachedQuorum && (counted.rule !== PUBLISHED_DEFAULT_RULE || counted.spared !== null)
        ? allocate({ constellation, subjects, rule: PUBLISHED_DEFAULT_RULE, spared: null, byDefault: true })
        : voted;
    const loser = namedLoser(voted, underDefault);
    if (loser !== null) losers.push({ constellation, ...loser });

    const plan: LevyPlan = {
      reckoning,
      constellation,
      total: voted.total,
      rule: voted.rule,
      spared: voted.spared,
      byDefault: voted.byDefault,
      deliverableTo: place,
      lines: voted.lines,
      assessedAtTick: args.tick,
    };
    args.book.assess(plan);
    plans.push(plan);
  }

  return { reckoning, tick: args.tick, plans, tallies, losers };
}

/** A ballot, ready for the book. Built here so the verb handler holds no arithmetic. */
export function ballotFor(args: {
  readonly world: WorldState;
  readonly voter: PrincipalId;
  readonly rule: LevyBallot['rule'];
  readonly spare: PrincipalId | null;
  readonly tick: number;
}): LevyBallot | null {
  const constellation = constellationOf(args.world, args.voter);
  if (constellation === null) return null;
  return {
    principal: args.voter,
    constellation,
    forReckoning: ballotWindow(args.tick).forReckoning,
    rule: args.rule,
    spare: args.spare,
    tick: args.tick,
  };
}
