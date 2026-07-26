/**
 * Resolution — **arithmetic, not a combat simulation** (SPEC §9, A2, A3).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **HIGHER FORCE WINS, DETERMINISTICALLY. NO DICE.**
 *
 *     defenderForce = FORCE_PER_HAND x (hands the target committed)
 *                   + FORCE_PER_JOINER x (joiners on the DEFENDER side)
 *                   + FORCE_BY_TIER[tier of the stage]
 *
 *     raiderForce   = raid.force                    (drawn at spawn, band published)
 *                   + FORCE_PER_JOINER x (joiners on the RAIDER side)
 *
 *     defenderForce >= raiderForce  ->  REPULSED       (ties go to the defender)
 *     otherwise                     ->  PLUNDERED
 *
 * There are no hit points, no rounds and no positioning. §9 says the Demand window
 * *"resolves within a tick and cannot be won by polling"*, and A3 says intent not
 * clicks: a tactical simulation at five minutes a tick is unwatchable and unplayable by
 * an agent that is offline most of the day. The only randomness anywhere near this is
 * `raid.force`, drawn **at spawn** inside a published band — so by the time an agent
 * decides, the arithmetic is fully known and the answer is a judgement about other
 * agents rather than a gamble against the engine.
 *
 * **Ties go to the defender**, deliberately: a defender that has done the arithmetic and
 * matched the raid should not lose to a rounding convention, and the direction is
 * published so it is a rule rather than an accident.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## What this file does *not* do
 *
 * It computes and it does not move anything. Every seizure, forfeiture and recovery is
 * performed by `predate.ts` through the ledger and the world, and the *measured* result
 * is what goes in the book — never the number below. A5′: the record must never be
 * wrong, and the cheapest guarantee is that the module which decides cannot also write.
 */

import type { RaidState, ZoneTier } from '../core/types.js';
import { qty, type Qty } from '../core/units.js';
import type { RaidRecord } from './book.js';
import {
  FORCE_BY_TIER,
  FORCE_PER_HAND,
  FORCE_PER_JOINER,
  RAID_DEMAND_QTY,
  RAID_MAX_TAKE_BPS,
  RAID_TAKE_MULTIPLE,
} from './params.js';

/**
 * Which way a standoff went, before anything has moved.
 *
 * A **narrowing of {@link RaidState}**, not a second union over the same two words: the
 * reading and the recorded outcome are one concept at two moments, and declaring
 * `'REPULSED' | 'PLUNDERED'` twice would be exactly the drift §3 exists to stop.
 */
export type Verdict = Extract<RaidState, 'REPULSED' | 'PLUNDERED'>;

export interface ForceReading {
  readonly defenderForce: number;
  readonly raiderForce: number;
  readonly verdict: Verdict;
  /** The terms, published so an agent can check the sum rather than trust it (A2). */
  readonly terms: {
    readonly defenderHands: number;
    readonly defenderJoiners: number;
    readonly terrain: number;
    readonly raidForce: number;
    readonly raiderJoiners: number;
  };
}

/**
 * The one force function. Called by the resolver, by the observation, and by the
 * affordance that prices `fight` — so the number an agent is shown before it commits and
 * the number the resolver uses are literally the same call (scar #1).
 *
 * `defenderHands` is passed in rather than counted here because commitment has one home
 * and it is not this module: the target's own committed hands are held by
 * `predate.ts`'s port, and a second count here would be scar #5.
 */
export function readForce(args: {
  readonly raid: RaidRecord;
  readonly tier: ZoneTier;
  readonly defenderHands: number;
}): ForceReading {
  const defenderJoiners = args.raid.parties.filter((p) => p.side === 'DEFENDER').length;
  const raiderJoiners = args.raid.parties.filter((p) => p.side === 'RAIDER').length;
  const terrain = FORCE_BY_TIER[args.tier] ?? 0;

  const defenderForce =
    FORCE_PER_HAND * Math.max(0, args.defenderHands) + FORCE_PER_JOINER * defenderJoiners + terrain;
  const raiderForce = args.raid.force + FORCE_PER_JOINER * raiderJoiners;

  return {
    defenderForce,
    raiderForce,
    // Ties to the defender. Stated once, here, and nowhere else.
    verdict: defenderForce >= raiderForce ? 'REPULSED' : 'PLUNDERED',
    terms: {
      defenderHands: Math.max(0, args.defenderHands),
      defenderJoiners,
      terrain,
      raidForce: args.raid.force,
      raiderJoiners,
    },
  };
}

/**
 * The demand, clamped into the published band.
 *
 * A pure function of the seeded draw and **not** of what the target holds — see
 * {@link RAID_DEMAND_QTY} for why that is a §11.2 decision rather than a calibration
 * one. Integer arithmetic throughout, because the result is pinned into a hashed record
 * and DET-7 bans floats from anything hashed.
 */
export function demandFor(draw: number): Qty {
  return qty(Math.max(RAID_DEMAND_QTY.min, Math.min(RAID_DEMAND_QTY.max, Math.floor(draw))));
}

/**
 * What a raid takes when it is not paid, given what the target *still* has.
 *
 * Two caps, and both matter:
 *
 *   - the multiple of the demand — the price of silence, and the reason paying strictly
 *     dominates ignoring;
 *   - {@link RAID_MAX_TAKE_BPS} of what is actually there — so "offline costs
 *     opportunity, never catastrophe" (§1.1) is arithmetic rather than a hope.
 *
 * And `standingNow`, never the demand: a raid that guesses wrong hits ballast, which is
 * exactly what §11.2's `SENSED` cargo tier is *for*. The target that emptied the place
 * during the window loses nothing, and that is the reward for reading the schedule.
 */
export function takeFor(demand: Qty, standingNow: Qty): Qty {
  if (standingNow <= 0) return qty(0);
  const byMultiple = demand * RAID_TAKE_MULTIPLE;
  const byCap = Math.floor((standingNow * RAID_MAX_TAKE_BPS) / 10_000);
  return qty(Math.max(0, Math.min(byMultiple, byCap, standingNow)));
}

/** What a raid takes when the target pays: exactly the demand, capped at what is there. */
export function payFor(demand: Qty, standingNow: Qty): Qty {
  return qty(Math.max(0, Math.min(demand, Math.max(0, standingNow))));
}
