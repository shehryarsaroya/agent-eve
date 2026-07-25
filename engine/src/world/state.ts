/**
 * The world's presence tables: the map, every hand, every holding.
 *
 * This is a **state table** in SPEC §15.1's sense — "what is true now" — and it is
 * deliberately not a fold over events. Replay's input is
 * `(snapshot_T, action_log_T, seed_T) -> snapshot_T+1`; events are output. Building
 * hand positions by replaying an event stream per request is the event-sourcing
 * cliff §15.1 names, and it makes `expected_state_version` incoherent.
 *
 * {@link worldHash} is the presence half of the per-tick `state_hash` that DET-1
 * and DET-3 compare.
 */

import { canonicalHash, type CanonicalValue } from '../core/canonical.js';
import type { GoodId, HandId, HoldingId, PrincipalId, SystemId } from '../core/types.js';
import {
  cmpHands,
  createHands,
  HANDS_PER_PRINCIPAL,
  type HandRecord,
} from './hands.js';
import {
  createHolding,
  isCommonsBound,
  safestSeat,
  type HoldingRecord,
} from './holding.js';
import { cmpStr, commonsSystems, mapHash, systemOf, type WorldMap } from './map.js';

export class WorldError extends Error {}

export interface WorldState {
  readonly map: WorldMap;
  readonly hands: Map<HandId, HandRecord>;
  readonly holdings: Map<HoldingId, HoldingRecord>;
  /** Enrolment order. Identity is never deleted, so this only ever grows (A10). */
  readonly principalOrder: PrincipalId[];
  readonly handsByPrincipal: Map<PrincipalId, HandId[]>;
  readonly holdingByPrincipal: Map<PrincipalId, HoldingId>;
}

export function createWorld(map: WorldMap): WorldState {
  return {
    map,
    hands: new Map<HandId, HandRecord>(),
    holdings: new Map<HoldingId, HoldingRecord>(),
    principalOrder: [],
    handsByPrincipal: new Map<PrincipalId, HandId[]>(),
    holdingByPrincipal: new Map<PrincipalId, HoldingId>(),
  };
}

export interface Enrolment {
  readonly principal: PrincipalId;
  readonly holding: HoldingRecord;
  readonly hands: readonly HandRecord[];
}

/**
 * Seat a principal: one Commons holding, exactly three hands (§6.1).
 *
 * Both counts are structural. Three hands is INV-8, and it is enforced by *this
 * being the only way to make a hand* — there is no `addHand`, because a fourth
 * hand would be a fourth unit of simultaneous presence bought with an identity,
 * which is A15's exact prohibition. `seatAt` exists for fixtures and for the
 * vertical slice, which needs two principals in two named systems.
 */
export function enroll(
  state: WorldState,
  principal: PrincipalId,
  name: string,
  tick: number,
  seatAt?: SystemId,
): Enrolment {
  if (state.holdingByPrincipal.has(principal)) {
    throw new WorldError(`principal ${principal} is already enrolled; identity is never re-minted`);
  }
  const system = seatAt ?? safestSeat(state.map, commonsSystems(state.map), holdingOccupancy(state));
  systemOf(state.map, system);

  const holding = createHolding(principal, name, system);
  const hands = createHands(principal, system, tick);

  state.holdings.set(holding.id, holding);
  state.holdingByPrincipal.set(principal, holding.id);
  state.principalOrder.push(principal);
  const ids: HandId[] = [];
  for (const hand of hands) {
    state.hands.set(hand.id, hand);
    ids.push(hand.id);
  }
  state.handsByPrincipal.set(principal, ids);

  if (ids.length !== HANDS_PER_PRINCIPAL) {
    throw new WorldError(`INV-8: enrolment minted ${ids.length} hands, not ${HANDS_PER_PRINCIPAL}`);
  }
  return { principal, holding, hands };
}

// ── Queries ─────────────────────────────────────────────────────────────────

export function handById(state: WorldState, id: HandId): HandRecord {
  const hand = state.hands.get(id);
  if (hand === undefined) throw new WorldError(`no such hand: ${id}`);
  return hand;
}

export function handsOf(state: WorldState, principal: PrincipalId): HandRecord[] {
  const ids = state.handsByPrincipal.get(principal) ?? [];
  const hands: HandRecord[] = [];
  for (const id of ids) {
    const hand = state.hands.get(id);
    if (hand !== undefined) hands.push(hand);
  }
  return hands;
}

export function holdingOf(state: WorldState, principal: PrincipalId): HoldingRecord {
  const id = state.holdingByPrincipal.get(principal);
  const holding = id === undefined ? undefined : state.holdings.get(id);
  if (holding === undefined) throw new WorldError(`principal ${principal} has no holding`);
  return holding;
}

/** Is this principal's force still pinned inside the Commons? (A15, §4.1.) */
export function principalIsCommonsBound(state: WorldState, principal: PrincipalId): boolean {
  return isCommonsBound(state.map, holdingOf(state, principal));
}

/**
 * Every hand, in canonical `(principal_id, ordinal)` order. **Every phase that
 * walks all hands must use this**, never `state.hands.values()` — Map insertion
 * order is enrolment order, which depends on when agents happened to arrive, and
 * a phase whose iteration order depends on arrival is DET-2 failing silently.
 */
export function handsInOrder(state: WorldState): HandRecord[] {
  return [...state.hands.values()].sort(cmpHands);
}

export function holdingsInOrder(state: WorldState): HoldingRecord[] {
  return [...state.holdings.values()].sort((a, b) => cmpStr(a.id, b.id));
}

/** Holdings per system — the input to newcomer seating. */
export function holdingOccupancy(state: WorldState): Map<SystemId, number> {
  const counts = new Map<SystemId, number>();
  for (const holding of state.holdings.values()) {
    counts.set(holding.system, (counts.get(holding.system) ?? 0) + 1);
  }
  return counts;
}

/** Hands currently occupying a system: present or arrived, never in transit. */
export function handsAt(state: WorldState, system: SystemId): HandRecord[] {
  return handsInOrder(state).filter((hand) => hand.state !== 'IN_TRANSIT' && hand.location === system);
}

// ── Serialisation ───────────────────────────────────────────────────────────

function cargoCanonical(cargo: ReadonlyMap<GoodId, number>): CanonicalValue {
  return [...cargo.entries()]
    .sort((a, b) => cmpStr(a[0], b[0]))
    .map(([good, amount]) => [good, amount]);
}

/**
 * The presence tables as a canonical structure: sorted, integer-only, no
 * `undefined`. `null` is written explicitly because absent and null are different
 * things to the canonicaliser and the difference must not depend on whether a
 * field happened to be set.
 */
export function worldCanonical(state: WorldState): CanonicalValue {
  return {
    map: mapHash(state.map),
    principals: [...state.principalOrder].sort(cmpStr),
    holdings: holdingsInOrder(state).map((h) => ({
      id: h.id,
      principal: h.principal,
      name: h.name,
      system: h.system,
      state: h.state,
      fellAtReckoning: h.fellAtReckoning,
    })),
    hands: handsInOrder(state).map((hand) => ({
      id: hand.id,
      principal: hand.principal,
      ordinal: hand.ordinal,
      state: hand.state,
      location: hand.location,
      destination: hand.destination,
      freeAtTick: hand.freeAtTick,
      departedAtTick: hand.departedAtTick,
      presentSinceTick: hand.presentSinceTick,
      cargo: cargoCanonical(hand.cargo),
    })),
  };
}

export function worldHash(state: WorldState): string {
  return canonicalHash(worldCanonical(state));
}
