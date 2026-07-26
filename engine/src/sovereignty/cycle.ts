/**
 * Sovereignty's clock. Five moments per cycle, and the order of them is the mechanic.
 *
 * ```text
 *  phase 0          ASSESS    the Charge total is fixed by rule; last cycle's ballot
 *                             allocates it; every claim's amount due, deadline and bond at
 *                             risk become readable; the next cycle's ballot opens
 *  phases 0..167    PAY/VOTE  deliver against a claim, vote, publish or take a cession
 *  phases 168..240  WINDOW    the published VULNERABILITY WINDOW: a CONTESTED claim can be
 *                             taken by anyone standing there who pays its arrears (A14)
 *  phase 263        BALLOT    the ballot for the NEXT Reckoning closes
 *  phase 287        SETTLE    shortfall, arrears, lapse, bond slashed
 * ```
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE ASSESSMENT PREDATES EVERY WAKE OF THE RECKONING IT SETTLES, AND THAT IS A5′.**
 *
 * *"Never record an arrears or a lapse against a claimant that was never shown what it
 * owed."* That is only satisfiable if the amount, the deadline and the consequence are all
 * computable from state that existed before the claimant's first wake of the cycle. So the
 * Charge is minted at phase 0 from a ballot that closed in the previous cycle, and nothing
 * moves it afterwards — `Book.assess` refuses a second plan for the same pair rather than
 * replacing it, for exactly the Levy's reason.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Everything here is a pure function of `(book, tick)` plus injected reads. The tick loop
 * owns *when*; this module owns *what*.
 */

import { phaseOfReckoning, reckoningIndex } from '../core/time.js';
import type { ConstellationId, SystemId, ZoneTier } from '../core/types.js';
import { compareIds } from '../ledger/order.js';
import type { PrincipalId } from '../core/types.js';
import { chargeBallotWindow, tallyCharge, type ChargeTally } from './ballot.js';
import type { Book, ChargePlan } from './book.js';
import {
  allocateCharge,
  chargeOf,
  PUBLISHED_DEFAULT_CHARGE_RULE,
  type ChargeSubject,
} from './charge.js';
import {
  CHARGE_ASSESS_PHASE,
  VULNERABILITY_WINDOW,
} from './params.js';

/** What sovereignty needs to know about a system. Supplied by the runtime (the map). */
export type TierRead = (system: SystemId) => ZoneTier;

/** Is this the tick a Reckoning's Charge is minted at? */
export function isChargeAssessTick(tick: number): boolean {
  return phaseOfReckoning(tick) === CHARGE_ASSESS_PHASE;
}

/**
 * Is the published vulnerability window open at this tick?
 *
 * A pure function of the tick, so the affordance layer, the observation, the frame and the
 * `build` gate all answer "can this claim be taken right now" from one function — scar #5's
 * rule applied to a schedule rather than to a quantity. There is no state and no draw in
 * here: A14 wants a clock a defender can read, and a clock with state in it is weather.
 */
export function inVulnerabilityWindow(tick: number): boolean {
  const phase = phaseOfReckoning(tick);
  return phase >= VULNERABILITY_WINDOW.firstPhase && phase <= VULNERABILITY_WINDOW.lastPhase;
}

/** The whole window as one inert value, for the observation and the refusal. */
export interface VulnerabilityView {
  readonly open: boolean;
  readonly first_phase: number;
  readonly last_phase: number;
  readonly opens_tick: number;
  readonly closes_tick: number;
  readonly ticks_until_open: number;
  readonly ticks_left: number;
}

export function vulnerabilityViewAt(tick: number): VulnerabilityView {
  const phase = phaseOfReckoning(tick);
  const base = tick - phase;
  const opensThisCycle = base + VULNERABILITY_WINDOW.firstPhase;
  const closesThisCycle = base + VULNERABILITY_WINDOW.lastPhase;
  const open = inVulnerabilityWindow(tick);
  // `atOrAfter`, for `predation/schedule.ts:nextSpawnTick`'s reason: an agent observing at
  // the opening tick is looking at a window that is open now, and telling it the next one
  // is 288 ticks away would be a true sentence about the wrong window.
  const nextOpen = phase <= VULNERABILITY_WINDOW.lastPhase ? opensThisCycle : opensThisCycle + 288;
  return {
    open,
    first_phase: VULNERABILITY_WINDOW.firstPhase,
    last_phase: VULNERABILITY_WINDOW.lastPhase,
    opens_tick: nextOpen,
    closes_tick: open ? closesThisCycle : nextOpen + (VULNERABILITY_WINDOW.lastPhase - VULNERABILITY_WINDOW.firstPhase),
    ticks_until_open: Math.max(0, nextOpen - tick),
    ticks_left: open ? Math.max(0, closesThisCycle - tick) : 0,
  };
}

export interface AssessedCharge {
  readonly reckoning: number;
  readonly tick: number;
  readonly plans: readonly ChargePlan[];
  readonly tallies: readonly ChargeTally[];
  /** Per constellation: the claimant the group's vote cost the most (§14.4, Law 2). */
  readonly losers: readonly {
    readonly constellation: ConstellationId;
    readonly principal: PrincipalId;
    readonly extra: number;
  }[];
}

/**
 * Mint every claimed constellation's Charge for a Reckoning.
 *
 * The two-allocation shape is the Levy's and it is not wasteful: the voted allocation
 * *and* the one the published default would have produced are both computed, because the
 * named loser is the **difference** between them. §14.4 wants a named loser by the group's
 * action every cycle, and "by the group's action" is only meaningful against the
 * counterfactual where the group did nothing.
 *
 * Skips a constellation that is already assessed, so calling this every OBLIGE is safe and
 * the ordinary path still mints at phase 0 exactly once. Throws only on arithmetic that was
 * wrong before it left `allocateCharge`; the caller reports rather than halting, because a
 * world with no Charge assessed is better than a stopped one.
 */
export function assessCharge(args: {
  readonly book: Book;
  readonly tick: number;
  readonly tierOf: TierRead;
}): AssessedCharge {
  const reckoning = reckoningIndex(args.tick);
  const plans: ChargePlan[] = [];
  const tallies: ChargeTally[] = [];
  const losers: { constellation: ConstellationId; principal: PrincipalId; extra: number }[] = [];

  for (const constellation of args.book.claimedConstellations()) {
    if (args.book.isAssessed(reckoning, constellation)) continue;
    const claims = args.book.claimsIn(constellation);
    if (claims.length === 0) continue;

    const subjects: ChargeSubject[] = claims.map((claim) => ({
      claim: claim.id,
      system: claim.system,
      claimant: claim.claimant,
      tier: args.tierOf(claim.system),
      // The **system's** consecutive misses, not the claimant's: delinquency attaches to
      // the place (the economic critic's transfer-resets-the-counter closure), so a claim
      // taken over in the window is assessed the surcharge its predecessor earned.
      misses: args.book.missesAt(claim.system),
    }));

    const electorate = [...new Set(claims.map((c) => c.claimant))].sort(compareIds);
    const counted = tallyCharge({ book: args.book, constellation, forReckoning: reckoning, electorate });
    tallies.push(counted);

    const voted = allocateCharge({
      constellation,
      subjects,
      rule: counted.rule,
      spared: counted.spared,
      byDefault: counted.byDefault,
    });
    const underDefault =
      counted.quorumMet && (counted.rule !== PUBLISHED_DEFAULT_CHARGE_RULE || counted.spared !== null)
        ? allocateCharge({
            constellation,
            subjects,
            rule: PUBLISHED_DEFAULT_CHARGE_RULE,
            spared: null,
            byDefault: true,
          })
        : voted;

    const loser = namedChargeLoser(voted.lines, underDefault.lines);
    if (loser !== null) losers.push({ constellation, ...loser });

    const plan: ChargePlan = {
      reckoning,
      constellation,
      total: voted.total,
      rule: voted.rule,
      spared: voted.spared,
      byDefault: voted.byDefault,
      lines: voted.lines,
      assessedAtTick: args.tick,
    };
    args.book.assess(plan);
    plans.push(plan);
  }

  return { reckoning, tick: args.tick, plans, tallies, losers };
}

/**
 * The claimant the group's vote cost the most, against the published-default
 * counterfactual.
 *
 * Aggregated **per claimant**, not per claim, because §14.4 asks for a named *player* who
 * lost something by the group's action and a viewer reads names, not claim ids. Returns
 * `null` when the vote changed nothing — an honest absence, because a loser nobody can name
 * is not one and inventing one would be the show editorialising (A12).
 */
export function namedChargeLoser(
  voted: readonly { readonly claimant: PrincipalId; readonly amount: number }[],
  underDefault: readonly { readonly claimant: PrincipalId; readonly amount: number }[],
): { readonly principal: PrincipalId; readonly extra: number } | null {
  const before = new Map<PrincipalId, number>();
  for (const line of underDefault) before.set(line.claimant, (before.get(line.claimant) ?? 0) + line.amount);
  const after = new Map<PrincipalId, number>();
  for (const line of voted) after.set(line.claimant, (after.get(line.claimant) ?? 0) + line.amount);

  let worst: { principal: PrincipalId; extra: number } | null = null;
  for (const principal of [...after.keys()].sort(compareIds)) {
    const extra = (after.get(principal) ?? 0) - (before.get(principal) ?? 0);
    if (extra <= 0) continue;
    if (worst === null || extra > worst.extra) worst = { principal, extra };
  }
  return worst;
}

/** The rule-fixed amount a claim would owe next Reckoning if nothing changed. Published. */
export function nextChargeFor(args: {
  readonly book: Book;
  readonly system: SystemId;
  readonly tier: ZoneTier;
}): number {
  return chargeOf({ tier: args.tier, misses: args.book.missesAt(args.system) });
}

/** The ballot window, re-exported so callers need one import for the clock. */
export { chargeBallotWindow };
