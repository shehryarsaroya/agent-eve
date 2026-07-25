/**
 * Enrolment, holdings, and the presence snapshot.
 *
 * The snapshot test here is the presence half of `DET-2`: the same set of
 * principals enrolled in a different order must produce an identical hash. That is
 * A4 structurally — if arrival order leaked into the state hash, whoever's request
 * landed first would be a different world, and no amount of later care would make
 * outcomes independent of throughput.
 */

import { describe, expect, it } from 'vitest';

import { Rng } from '../../src/core/rng.js';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import { qty } from '../../src/core/units.js';
import {
  beginTransit,
  checkWorldInvariants,
  commonsSystems,
  createWorld,
  enroll,
  handsAt,
  handsOf,
  holdingOccupancy,
  holdingOf,
  holdingsInOrder,
  isCivicLeased,
  launchMap,
  loadCargo,
  loseHand,
  markFallen,
  principalIsCommonsBound,
  relocateHolding,
  safestSeat,
  systemOf,
  tierOf,
  worldCanonical,
  worldHash,
  type WorldState,
} from '../../src/world/index.js';

function principals(n: number): PrincipalId[] {
  return Array.from({ length: n }, (_, i) => `p-${String(i + 1).padStart(2, '0')}` as PrincipalId);
}

function seatAll(order: readonly PrincipalId[]): WorldState {
  const state = createWorld(launchMap());
  for (const p of order) enroll(state, p, `holding-${p}`, 0);
  return state;
}

function seatAllAt(order: readonly PrincipalId[], seats: ReadonlyMap<PrincipalId, SystemId>): WorldState {
  const state = createWorld(launchMap());
  for (const p of order) enroll(state, p, `holding-${p}`, 0, seats.get(p));
  return state;
}

describe('enrolment seats a newcomer safely (scar #14)', () => {
  it('always seats into the Commons, never the Marches or the Frontier', () => {
    const map = launchMap();
    const state = createWorld(map);
    for (const p of principals(20)) {
      const enrolment = enroll(state, p, 'holding', 0);
      expect(tierOf(map, enrolment.holding.system)).toBe('COMMONS');
    }
  });

  it('spreads newcomers across the Commons instead of stacking them', () => {
    const map = launchMap();
    const state = createWorld(map);
    const commons = commonsSystems(map);
    for (const p of principals(commons.length * 2)) enroll(state, p, 'holding', 0);
    const occupancy = holdingOccupancy(state);
    for (const id of commons) expect(occupancy.get(id)).toBe(2);
  });

  it('picks the least-crowded Commons system, ties broken by ID', () => {
    const map = launchMap();
    const commons = commonsSystems(map);
    const first = commons[0]!;
    const second = commons[1]!;
    expect(safestSeat(map, commons, new Map())).toBe(first);
    expect(safestSeat(map, commons, new Map([[first, 3]]))).toBe(second);
  });

  it('mints three hands and one holding, and nothing else', () => {
    const state = seatAll(principals(1));
    const p = principals(1)[0]!;
    expect(handsOf(state, p)).toHaveLength(3);
    expect(holdingsInOrder(state)).toHaveLength(1);
    expect(holdingOf(state, p).id).toBe(`${p}:holding`);
    expect(checkWorldInvariants(state, 0)).toEqual([]);
  });

  it('makes every newcomer Commons-bound, so free identities buy no force (A15)', () => {
    const state = seatAll(principals(3));
    for (const p of principals(3)) {
      expect(principalIsCommonsBound(state, p)).toBe(true);
      expect(isCivicLeased(state.map, holdingOf(state, p))).toBe(true);
    }
  });
});

describe('holdings', () => {
  it('stops being civic-leased once it stands outside the Commons', () => {
    const state = seatAll(principals(1));
    const p = principals(1)[0]!;
    const marches = state.map.systemOrder.find((id) => tierOf(state.map, id) === 'MARCHES')!;
    expect(relocateHolding(state.map, holdingOf(state, p), marches)).toBeNull();
    expect(isCivicLeased(state.map, holdingOf(state, p))).toBe(false);
    expect(principalIsCommonsBound(state, p)).toBe(false);
  });

  it('keeps the row when it falls — identity and the ruin both survive', () => {
    const state = seatAll(principals(1));
    const p = principals(1)[0]!;
    const holding = holdingOf(state, p);
    markFallen(holding, 12);
    expect(state.holdings.has(holding.id)).toBe(true);
    expect(holding.fellAtReckoning).toBe(12);
    // Losing a holding never costs identity, and never the ability to have another.
    expect(handsOf(state, p)).toHaveLength(3);
    // But it cannot be walked somewhere else while it is a ruin.
    const other = state.map.systemOrder[9]!;
    expect(relocateHolding(state.map, holding, other)?.ok).toBe(false);
  });
});

describe('the presence snapshot', () => {
  it('does not encode insertion order (DET-2, structurally)', () => {
    // Same principals, same seats, inserted in opposite orders. The snapshot is
    // sorted, so the hash cannot see which request landed first — if it could,
    // whoever's packet arrived first would be playing a different world and A4
    // would be violated by the serialiser rather than by any mechanic.
    const ps = principals(8);
    const commons = commonsSystems(launchMap());
    const seats = new Map<PrincipalId, SystemId>(
      ps.map((p, i) => [p, commons[i % commons.length]!] as const),
    );
    expect(worldHash(seatAllAt([...ps].reverse(), seats))).toBe(worldHash(seatAllAt(ps, seats)));
  });

  it('WARNS: automatic seat choice depends on the enrolment sequence, so the queue must be ordered', () => {
    // This is a real order dependence, asserted rather than hidden. `safestSeat`
    // picks the least-crowded Commons system, and crowding is a function of who was
    // seated first — so seating p-01 before p-08 gives p-01 a different system than
    // seating p-08 first. The consequence for the tick loop is not optional:
    // enrolments must be processed in `(priority, principal_id, client_sequence)`
    // order (SPEC §15.2), never arrival order, or replay diverges at enrolment.
    const ps = principals(8);
    expect(worldHash(seatAll([...ps].reverse()))).not.toBe(worldHash(seatAll(ps)));
    // Ordered the same way twice, it is reproducible — which is all determinism asks.
    expect(worldHash(seatAll(ps))).toBe(worldHash(seatAll(ps)));
  });

  it('moves when the world moves', () => {
    const state = seatAll(principals(2));
    const before = worldHash(state);
    const p = principals(2)[0]!;
    const hand = handsOf(state, p)[0]!;
    const neighbour = systemOf(state.map, hand.location).lanes.find(
      (id) => tierOf(state.map, id) === 'COMMONS',
    )!;
    beginTransit(state.map, hand, neighbour, 4);
    expect(worldHash(state)).not.toBe(before);
  });

  it('hashes at all — which is proof no float reached it', () => {
    const state = seatAll(principals(2));
    const p = principals(2)[0]!;
    const hand = handsOf(state, p)[0]!;
    loadCargo(hand, 'ORE' as unknown as never, qty(3), 0);
    loseHand(handsOf(state, p)[1]!, 5, Rng.fromSeed('s'), holdingOf(state, p).system);
    // canonicalize() throws on a non-integer anywhere in the structure, so a
    // successful hash is the assertion (SPEC §15.5 bans floats in hashed things).
    expect(worldHash(state)).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(worldCanonical(state))).toContain('presentSinceTick');
  });

  it('lists hands occupying a system, excluding those on a lane', () => {
    const state = seatAll(principals(2));
    const p = principals(2)[0]!;
    const hand = handsOf(state, p)[0]!;
    const home = hand.location;
    const before = handsAt(state, home).length;
    const neighbour = systemOf(state.map, home).lanes.find(
      (id) => tierOf(state.map, id) === 'COMMONS',
    )!;
    beginTransit(state.map, hand, neighbour, 1);
    expect(handsAt(state, home)).toHaveLength(before - 1);
    expect(handsAt(state, neighbour).map((h) => h.id)).not.toContain(hand.id);
  });
});
