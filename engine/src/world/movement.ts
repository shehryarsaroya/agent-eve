/**
 * The MOVE phase, and the `move` verb.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ORDERING (SPEC §15.2, and it is a rules surface):
 *
 *   FREEZE_QUEUE -> EXPIRE -> VALIDATE+LOCK -> **MOVE** -> PREDATE -> MARKETS
 *   -> PRODUCE -> VENTURES -> HAZARD -> OBLIGE -> DERIVE -> ASSERT -> COMMIT -> WAKE
 *
 * **MOVE runs before every resolution phase, or every published ETA is a tick
 * optimistic.** If arrivals resolved after VENTURES, a hand whose ETA said tick T
 * would in practice be usable from T+1 for everything the world does at T — so
 * the number the engine published and the number the agent experienced would
 * differ by one, forever, invisibly. Agents plan on the published number.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * MOVE owns *all* presence changes, not just arrivals: recoveries end here too,
 * for the same reason. If recovery ended in HAZARD, a hand would come back after
 * the phase that could have used it.
 */

import type { GoodId, HandId, PrincipalId, SystemId } from '../core/types.js';
import type { Qty } from '../core/units.js';
import {
  beginTransit,
  isPresent,
  resolveArrival,
  resolveRecovery,
  type HandRecord,
} from './hands.js';
import { tierOf, type WorldMap } from './map.js';
import { reject, type WorldResult } from './result.js';
import { handById, handsInOrder, principalIsCommonsBound, type WorldState } from './state.js';

/**
 * The phases MOVE must precede. Exported so the tick loop can assert its own
 * order against this list rather than against a comment — the ordering is a rule,
 * and rules get executable assertions (`TESTING.md` §0: assertions over review).
 */
export const MOVE_PHASE_MUST_PRECEDE: readonly string[] = [
  'PREDATE',
  'MARKETS',
  'PRODUCE',
  'VENTURES',
  'HAZARD',
  'OBLIGE',
  'DERIVE',
  'ASSERT',
  'COMMIT',
];

export interface Arrival {
  readonly handId: HandId;
  readonly principal: PrincipalId;
  readonly from: SystemId;
  readonly to: SystemId;
  readonly tick: number;
  /** The first tick this hand can act at `to`. See ARRIVAL_IS_PRESENT_SAME_TICK. */
  readonly presentFromTick: number;
  /** Movement on public lanes is PUBLIC (§11.2); the manifest is only SENSED. */
  readonly cargo: ReadonlyMap<GoodId, Qty>;
}

export interface RecoveryEnd {
  readonly handId: HandId;
  readonly principal: PrincipalId;
  readonly at: SystemId;
  readonly tick: number;
  readonly presentFromTick: number;
}

export interface MovementOutcome {
  readonly arrivals: readonly Arrival[];
  readonly recoveries: readonly RecoveryEnd[];
}

/**
 * Resolve every arrival and recovery due at `tick`.
 *
 * `filledInRole` is the role table's answer to "is this hand still committed".
 * It is injected because commitment has exactly one home
 * (`venture_role.filled_by_hand_id`) and this module must not become a second one
 * — scar #5 was a single mirrored quantity and it destroyed exactly 2x the real
 * value.
 *
 * Returns what happened rather than writing events: the ledger and the event
 * stream are owned elsewhere, and a phase that both mutates state and appends to
 * the record can commit half of each.
 */
export function resolveMovement(
  state: WorldState,
  tick: number,
  filledInRole: (handId: HandId) => boolean,
): MovementOutcome {
  const arrivals: Arrival[] = [];
  const recoveries: RecoveryEnd[] = [];

  // Canonical (principal_id, ordinal) order, never Map insertion order (DET-2).
  for (const hand of handsInOrder(state)) {
    if (hand.freeAtTick === null || hand.freeAtTick > tick) continue;

    switch (hand.state) {
      case 'IN_TRANSIT': {
        const from = hand.location;
        const to = hand.destination;
        if (to === null) {
          throw new Error(`hand ${hand.id} is IN_TRANSIT with no destination (INV-9)`);
        }
        resolveArrival(hand, tick, filledInRole(hand.id));
        arrivals.push({
          handId: hand.id,
          principal: hand.principal,
          from,
          to,
          tick,
          presentFromTick: hand.presentSinceTick,
          cargo: hand.cargo,
        });
        break;
      }
      case 'RECOVERING': {
        resolveRecovery(hand, tick, filledInRole(hand.id));
        recoveries.push({
          handId: hand.id,
          principal: hand.principal,
          at: hand.location,
          tick,
          presentFromTick: hand.presentSinceTick,
        });
        break;
      }
      case 'IDLE':
      case 'COMMITTED':
        // A settled hand with a freeAtTick is an INV-9 violation; the ASSERT
        // phase halts the tick for it rather than this phase guessing a repair.
        break;
    }
  }

  return { arrivals, recoveries };
}

/**
 * The `move` verb: one hand, one gate.
 *
 * Authority is *not* checked here — whether this principal may command this hand
 * is a grant question and lives with grants. This function answers only the
 * world's questions: is there a lane, is the hand able to travel, and is it
 * allowed out.
 */
export function moveHand(
  state: WorldState,
  handId: HandId,
  destination: SystemId,
  tick: number,
): WorldResult<HandRecord> {
  const hand = handById(state, handId);
  const bound = commonsBoundRejection(state, hand, destination);
  if (bound !== null) return bound;
  return beginTransit(state.map, hand, destination, tick);
}

/**
 * The Commons-bound rule (§4.1, A15): a principal whose holding is in the Commons
 * has Commons-bound hands, and projecting force elsewhere requires a holding that
 * pays upkeep in currency plus manufactured goods.
 *
 * This is the *outbound* half of the safe zone, and it is a different rule from
 * the Commons floor (`commons.ts`), which is the *inbound* half. Keeping them
 * separate matters: the floor says hostility against a Commons target is invalid;
 * this says free hands cannot be marched out of the nursery to be hostile
 * somewhere else. Collapsing them into one predicate would silently drop one.
 */
export function commonsBoundRejection(
  state: WorldState,
  hand: HandRecord,
  destination: SystemId,
): ReturnType<typeof reject> | null {
  if (!principalIsCommonsBound(state, hand.principal)) return null;
  if (tierOf(state.map, destination) === 'COMMONS') return null;
  return reject(
    'A15',
    `hand ${hand.id} is Commons-bound: its principal's holding is civic-leased in the Commons, ` +
      `so its hands may only move between COMMONS systems. Establish a holding outside the Commons ` +
      `— which pays upkeep in currency and goods — before projecting force into ${destination}.`,
  );
}

/**
 * Hands able to act at a system this tick — the input to strength, to role
 * satisfaction, and to production. Uses PRESENT, not occupancy, so an arrival is
 * excluded on its arrival tick.
 */
export function presentHandsAt(state: WorldState, system: SystemId, tick: number): HandRecord[] {
  return handsInOrder(state).filter(
    (hand) => hand.location === system && isPresent(hand, tick),
  );
}

/**
 * How far along its lane a hand is, in ticks travelled. The viewer draws the
 * convoy at this offset (A13: every mechanic renders, and motion is the map's
 * whole vocabulary). Integer ticks; the client may interpolate, the engine never
 * does, because a float here would reach a hash.
 */
export function transitProgressTicks(hand: HandRecord, tick: number): number | null {
  if (hand.state !== 'IN_TRANSIT' || hand.departedAtTick === null) return null;
  return tick - hand.departedAtTick;
}

/** For fixtures and the vertical slice: the map a state was built on. */
export function mapOf(state: WorldState): WorldMap {
  return state.map;
}
