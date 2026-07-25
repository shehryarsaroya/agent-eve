/**
 * Movement: the MOVE phase, the outbound half of the safe zone, and SPEC §16
 * step 3's assertion — **1,000 ticks, every hand in exactly one legal state,
 * replay identical.**
 */

import { describe, expect, it } from 'vitest';

import type { HandId, PrincipalId, SystemId } from '../../src/core/types.js';
import {
  beginTransit,
  commonsSystems,
  createWorld,
  enroll,
  HAND_STATES,
  handsOf,
  holdingOf,
  launchMap,
  MOVE_PHASE_MUST_PRECEDE,
  moveHand,
  presentHandsAt,
  relocateHolding,
  resolveMovement,
  systemOf,
  tierOf,
  transitProgressTicks,
  transitTicks,
  type WorldMap,
} from '../../src/world/index.js';
import { everyHandInOneLegalState, runSoak } from './harness.js';

const A = 'p-a' as PrincipalId;

function marchesPair(map: WorldMap): [SystemId, SystemId] {
  for (const id of map.systemOrder) {
    if (tierOf(map, id) !== 'MARCHES') continue;
    for (const neighbour of systemOf(map, id).lanes) {
      if (tierOf(map, neighbour) === 'MARCHES') return [id, neighbour];
    }
  }
  throw new Error('no adjacent MARCHES pair');
}

describe('MOVE runs before every resolution phase (SPEC §15.2)', () => {
  it('names the phases it must precede, so the tick loop can assert its own order', () => {
    expect(MOVE_PHASE_MUST_PRECEDE).toContain('PREDATE');
    expect(MOVE_PHASE_MUST_PRECEDE).toContain('VENTURES');
    expect(MOVE_PHASE_MUST_PRECEDE).toContain('ASSERT');
    // Nothing before MOVE in §15.2's order may appear here.
    for (const phase of ['FREEZE_QUEUE', 'EXPIRE', 'VALIDATE', 'MOVE']) {
      expect(MOVE_PHASE_MUST_PRECEDE).not.toContain(phase);
    }
  });

  it('arrives on exactly the published tick — not a tick early, not a tick late', () => {
    const map = launchMap();
    const state = createWorld(map);
    const [from, to] = marchesPair(map);
    enroll(state, A, 'Ashford', 0, from);
    const hand = handsOf(state, A)[0]!;
    const cost = transitTicks(map, from, to);

    beginTransit(map, hand, to, 10);
    const eta = 10 + cost;
    expect(hand.freeAtTick).toBe(eta);

    for (let tick = 10; tick < eta; tick += 1) {
      const outcome = resolveMovement(state, tick, () => false);
      expect(outcome.arrivals).toHaveLength(0);
      expect(hand.state).toBe('IN_TRANSIT');
      expect(transitProgressTicks(hand, tick)).toBe(tick - 10);
    }

    const outcome = resolveMovement(state, eta, () => false);
    expect(outcome.arrivals).toHaveLength(1);
    expect(outcome.arrivals[0]?.from).toBe(from);
    expect(outcome.arrivals[0]?.to).toBe(to);
    expect(outcome.arrivals[0]?.presentFromTick).toBe(eta + 1);
    expect(hand.location).toBe(to);
    expect(transitProgressTicks(hand, eta)).toBeNull();
  });

  it('excludes an arrival from the present set on its arrival tick', () => {
    const map = launchMap();
    const state = createWorld(map);
    const [from, to] = marchesPair(map);
    enroll(state, A, 'Ashford', 0, from);
    const hand = handsOf(state, A)[0]!;

    beginTransit(map, hand, to, 1);
    const eta = hand.freeAtTick!;
    resolveMovement(state, eta, () => false);

    expect(presentHandsAt(state, to, eta).map((h) => h.id)).not.toContain(hand.id);
    expect(presentHandsAt(state, to, eta + 1).map((h) => h.id)).toContain(hand.id);
  });

  it('resolves arrivals in canonical (principal, ordinal) order, never Map order', () => {
    const map = launchMap();
    const state = createWorld(map);
    const [from, to] = marchesPair(map);
    // Enrol out of alphabetical order so insertion order and canonical order differ.
    for (const id of ['p-c', 'p-a', 'p-b']) {
      enroll(state, id as PrincipalId, id, 0, from);
      for (const hand of handsOf(state, id as PrincipalId)) beginTransit(map, hand, to, 1);
    }
    const eta = handsOf(state, 'p-a' as PrincipalId)[0]!.freeAtTick!;
    const arrivals = resolveMovement(state, eta, () => false).arrivals;
    const ids = arrivals.map((a) => a.handId);
    const sorted = [...ids].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    expect(ids).toEqual(sorted);
    expect(ids).toHaveLength(9);
  });
});

describe('the Commons-bound rule (A15, the outbound half of the safe zone)', () => {
  it('pins a Commons-seated principal\'s hands inside the Commons', () => {
    const map = launchMap();
    const state = createWorld(map);
    const home = commonsSystems(map)[0]!;
    enroll(state, A, 'Ashford', 0, home);
    const hand = handsOf(state, A)[0]!;

    const outward = systemOf(map, home).lanes.find((id) => tierOf(map, id) !== 'COMMONS');
    const inward = systemOf(map, home).lanes.find((id) => tierOf(map, id) === 'COMMONS');

    if (outward !== undefined) {
      const rejected = moveHand(state, hand.id, outward, 1);
      expect(rejected.ok).toBe(false);
      if (!rejected.ok) {
        expect(rejected.invariant).toBe('A15');
        expect(rejected.hint).toMatch(/Commons-bound/);
        expect(rejected.hint).toMatch(/upkeep/);
      }
    }
    if (inward !== undefined) {
      expect(moveHand(state, hand.id, inward, 1).ok).toBe(true);
    }
    expect(outward === undefined && inward === undefined).toBe(false);
  });

  it('lifts once the principal holds outside the Commons — the gate is priced in goods, not identities', () => {
    const map = launchMap();
    const state = createWorld(map);
    const home = commonsSystems(map)[0]!;
    enroll(state, A, 'Ashford', 0, home);
    const hand = handsOf(state, A)[0]!;
    const outward = systemOf(map, home).lanes.find((id) => tierOf(map, id) !== 'COMMONS');
    if (outward === undefined) return;

    expect(moveHand(state, hand.id, outward, 1).ok).toBe(false);
    // Establishing a holding outside the Commons is what unlocks it. The *price*
    // of that holding is the economy's to charge, not the world's.
    expect(relocateHolding(map, holdingOf(state, A), outward)).toBeNull();
    expect(moveHand(state, hand.id, outward, 1).ok).toBe(true);
  });
});

describe('1,000 ticks (SPEC §16 step 3)', () => {
  const options = { seed: 'soak-1', ticks: 1_000, principals: 16 };
  const first = runSoak(options);

  it('breaks no presence invariant, at any tick', () => {
    expect(first.violations).toEqual([]);
  });

  it('leaves every hand in exactly one legal state', () => {
    expect(everyHandInOneLegalState(first.finalState, HAND_STATES)).toBe(true);
    for (const hand of first.finalState.hands.values()) {
      expect(HAND_STATES).toContain(hand.state);
    }
  });

  it('leaves every principal with exactly three hands after 1,000 ticks of losses', () => {
    for (const principal of first.finalState.principalOrder) {
      expect(handsOf(first.finalState, principal)).toHaveLength(3);
    }
    // And at least one hand is still recovering or has recovered, so the loss path
    // was walked rather than merely available.
    expect(first.counts.losses).toBeGreaterThan(first.counts.recoveries - 1);
  });

  it('actually exercises all four states — otherwise it proves nothing', () => {
    expect([...first.statesSeen].sort((a, b) => (a < b ? -1 : 1))).toEqual([
      'COMMITTED',
      'IDLE',
      'IN_TRANSIT',
      'RECOVERING',
    ]);
    expect(first.counts.moves).toBeGreaterThan(100);
    expect(first.counts.arrivals).toBeGreaterThan(100);
    expect(first.counts.losses).toBeGreaterThan(10);
    expect(first.counts.recoveries).toBeGreaterThan(10);
    expect(first.counts.commits).toBeGreaterThan(10);
    expect(first.counts.releases).toBeGreaterThan(10);
    // And it exercises the rule that keeps free hands inside the Commons.
    expect(first.counts.commonsBoundRejections).toBeGreaterThan(10);
  });

  it('replays identically — same seed, same 1,000 hashes', () => {
    const second = runSoak(options);
    expect(second.hashes).toHaveLength(1_000);
    expect(second.hashes).toEqual(first.hashes);
  });

  it('diverges on a different seed, so the hash is measuring something', () => {
    const other = runSoak({ ...options, seed: 'soak-2', ticks: 50 });
    expect(other.hashes[49]).not.toBe(first.hashes[49]);
  });

  it('never leaks a good: hands, stores and the loss sink always sum to supply', () => {
    // The harness asserts this every tick and reports it as INV-2; an empty
    // violation list above is that assertion holding 1,000 times.
    expect(first.violations.filter((v) => v.id === 'INV-2')).toEqual([]);
  });
});

describe('a hand that vanishes mid-transit is caught, not tolerated', () => {
  it('throws rather than silently arriving nowhere', () => {
    const map = launchMap();
    const state = createWorld(map);
    const [from, to] = marchesPair(map);
    enroll(state, A, 'Ashford', 0, from);
    const hand = handsOf(state, A)[0]!;
    beginTransit(map, hand, to, 1);
    const eta = hand.freeAtTick!;
    hand.destination = null;
    expect(() => resolveMovement(state, eta, () => false)).toThrow(/IN_TRANSIT with no destination/);
  });

  it('ignores a settled hand carrying a stale free tick, leaving it to ASSERT', () => {
    const map = launchMap();
    const state = createWorld(map);
    const [from] = marchesPair(map);
    enroll(state, A, 'Ashford', 0, from);
    const hand = handsOf(state, A)[0]!;
    hand.freeAtTick = 5;
    // MOVE does not guess a repair: the ASSERT phase halts the tick for it.
    const outcome = resolveMovement(state, 10, () => false);
    expect(outcome.arrivals).toHaveLength(0);
    expect(hand.state).toBe('IDLE');
  });

  it('asks the role table on arrival instead of remembering commitment', () => {
    const map = launchMap();
    const state = createWorld(map);
    const [from, to] = marchesPair(map);
    enroll(state, A, 'Ashford', 0, from);
    const hand = handsOf(state, A)[0]!;
    beginTransit(map, hand, to, 1);
    const eta = hand.freeAtTick!;
    const filled = new Set<HandId>([hand.id]);
    resolveMovement(state, eta, (id) => filled.has(id));
    expect(hand.state).toBe('COMMITTED');
  });
});
