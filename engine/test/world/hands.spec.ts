/**
 * Hands: INV-8, INV-9, INV-10 (`TESTING.md` §3, "Presence").
 *
 * Every invariant here is tested twice — once that it holds on a healthy world,
 * and once that it *fires* on a world with the violation injected. A check that
 * cannot fail is worse than no check: it reads as coverage and asserts nothing,
 * and INV-9's whole reason for existing is that the database index it duplicates
 * "is the thing most likely to be dropped by a careless migration".
 */

import { describe, expect, it } from 'vitest';

import { Rng } from '../../src/core/rng.js';
import { HAND_RECOVERY_TICKS } from '../../src/core/time.js';
import type { GoodId, HandId, PrincipalId, SystemId } from '../../src/core/types.js';
import { qty } from '../../src/core/units.js';
import {
  ARRIVAL_IS_PRESENT_SAME_TICK,
  beginTransit,
  cargoHeldByHands,
  cargoOnLanes,
  checkInv10,
  checkInv8,
  checkInv9,
  checkWorldInvariants,
  commitHand,
  createWorld,
  enroll,
  expectedArrivalTick,
  HAND_STATES,
  HANDS_PER_PRINCIPAL,
  handById,
  handsOf,
  holdingOf,
  inTransitEta,
  isPresent,
  laneOf,
  launchMap,
  loadCargo,
  loseHand,
  MAX_CARGO_GOODS,
  MOVEMENT_RULES,
  MOVEMENT_STATEMENT,
  occupiesSystem,
  releaseHand,
  resolveMovement,
  systemOf,
  tierOf,
  transitTicks,
  unloadCargo,
  type WorldMap,
  type WorldState,
} from '../../src/world/index.js';

const ORE = 'ORE' as GoodId;
const A = 'p-a' as PrincipalId;
const B = 'p-b' as PrincipalId;

/** Two adjacent systems of a given tier, found rather than hard-coded. */
function adjacentPair(map: WorldMap, tier: 'COMMONS' | 'MARCHES' | 'FRONTIER'): [SystemId, SystemId] {
  for (const id of map.systemOrder) {
    if (tierOf(map, id) !== tier) continue;
    for (const neighbour of systemOf(map, id).lanes) {
      if (tierOf(map, neighbour) === tier) return [id, neighbour];
    }
  }
  throw new Error(`no adjacent ${tier} pair in the launch map`);
}

interface Fixture {
  readonly state: WorldState;
  readonly map: WorldMap;
  readonly from: SystemId;
  readonly to: SystemId;
}

/**
 * Two principals seated in the Marches, so hands may actually travel: a
 * Commons-bound hand cannot leave the Commons (A15), which is tested in
 * `movement.spec.ts` rather than accidentally here.
 */
function fixture(): Fixture {
  const map = launchMap();
  const state = createWorld(map);
  const [from, to] = adjacentPair(map, 'MARCHES');
  enroll(state, A, 'Ashford', 0, from);
  enroll(state, B, 'Brine', 0, from);
  return { state, map, from, to };
}

const noFills = new Map<HandId, number>();

describe('INV-8 — exactly three hands, never destroyed', () => {
  it('mints exactly three at enrolment, and there is no way to mint a fourth', () => {
    const { state } = fixture();
    expect(handsOf(state, A)).toHaveLength(HANDS_PER_PRINCIPAL);
    expect(handsOf(state, A).map((h) => h.ordinal)).toEqual([1, 2, 3]);
    // A fourth hand would be a fourth unit of simultaneous presence bought with
    // an identity, which is A15's exact prohibition — so enrolment is the only
    // constructor and it refuses to run twice.
    expect(() => enroll(state, A, 'Ashford', 0)).toThrow(/already enrolled/);
    expect(checkInv8(state, 1)).toEqual([]);
  });

  it('turns a lost hand into RECOVERING with a freeAtTick — loss is time, never capacity', () => {
    const { state } = fixture();
    const hand = handsOf(state, A)[0]!;
    const home = holdingOf(state, A).system;
    const rng = Rng.fromSeed('loss');

    const loss = loseHand(hand, 100, rng, home);

    expect(hand.state).toBe('RECOVERING');
    expect(hand.location).toBe(home);
    expect(hand.freeAtTick).toBe(loss.freeAtTick);
    expect(loss.freeAtTick).toBeGreaterThanOrEqual(100 + HAND_RECOVERY_TICKS.min);
    expect(loss.freeAtTick).toBeLessThanOrEqual(100 + HAND_RECOVERY_TICKS.max);
    // The row survives. This is the whole invariant.
    expect(state.hands.has(hand.id)).toBe(true);
    expect(handsOf(state, A)).toHaveLength(HANDS_PER_PRINCIPAL);
    expect(checkInv8(state, 100)).toEqual([]);
  });

  it('hands the lost cargo back instead of deleting it (INV-2 has a term for it)', () => {
    const { state } = fixture();
    const hand = handsOf(state, A)[0]!;
    loadCargo(hand, ORE, qty(7), 0);

    const loss = loseHand(hand, 5, Rng.fromSeed('loss'), holdingOf(state, A).system);

    expect(loss.lostCargo.get(ORE)).toBe(7);
    expect(hand.cargo.size).toBe(0);
    // If this were void, seven ore would vanish with no event to point at and
    // supply conservation would fail in a module that cannot see a hand.
    expect(cargoHeldByHands(state.hands.values()).get(ORE)).toBeUndefined();
  });

  it('recovers to IDLE at the holding when the clock runs out', () => {
    const { state } = fixture();
    const hand = handsOf(state, A)[0]!;
    const loss = loseHand(hand, 5, Rng.fromSeed('loss'), holdingOf(state, A).system);

    const early = resolveMovement(state, loss.freeAtTick - 1, () => false);
    expect(early.recoveries).toHaveLength(0);
    expect(hand.state).toBe('RECOVERING');

    const outcome = resolveMovement(state, loss.freeAtTick, () => false);
    expect(outcome.recoveries).toHaveLength(1);
    expect(hand.state).toBe('IDLE');
    expect(hand.freeAtTick).toBeNull();
    // Symmetric with arrival: available from the next tick, not this one.
    expect(isPresent(hand, loss.freeAtTick)).toBe(false);
    expect(isPresent(hand, loss.freeAtTick + 1)).toBe(true);
  });

  it('fires when a hand row is deleted', () => {
    const { state } = fixture();
    const hand = handsOf(state, A)[0]!;
    state.hands.delete(hand.id);
    const violations = checkInv8(state, 1);
    expect(violations.map((v) => v.id)).toContain('INV-8');
    expect(violations.every((v) => v.severity === 'HALT')).toBe(true);
  });

  it('fires when a RECOVERING hand has no freeAtTick — that would be lost capacity', () => {
    const { state } = fixture();
    const hand = handsOf(state, A)[0]!;
    hand.state = 'RECOVERING';
    hand.freeAtTick = null;
    expect(checkInv8(state, 1).map((v) => v.message).join(' ')).toMatch(/capacity rather than time/);
  });
});

describe('INV-9 — exactly one state, at most one role', () => {
  it('accepts a healthy world', () => {
    const { state } = fixture();
    expect(checkInv9(state, 1, noFills)).toEqual([]);
    expect(HAND_STATES).toEqual(['IDLE', 'IN_TRANSIT', 'COMMITTED', 'RECOVERING']);
  });

  it('fires when a settled hand carries transit fields', () => {
    const { state, to } = fixture();
    const hand = handsOf(state, A)[0]!;
    hand.destination = to;
    expect(checkInv9(state, 1, noFills).map((v) => v.message).join(' ')).toMatch(/IDLE but has destination/);
  });

  it('fires when a hand in transit is missing its ETA or its departure', () => {
    const { state, map, to } = fixture();
    const hand = handsOf(state, A)[0]!;
    beginTransit(map, hand, to, 10);
    hand.freeAtTick = null;
    hand.departedAtTick = null;
    const messages = checkInv9(state, 11, noFills).map((v) => v.message).join(' ');
    expect(messages).toMatch(/no arrival tick/);
    expect(messages).toMatch(/no departure tick/);
  });

  it('fires when one hand fills two roles', () => {
    const { state } = fixture();
    const hand = handsOf(state, A)[0]!;
    commitHand(hand);
    const fills = new Map<HandId, number>([[hand.id, 2]]);
    expect(checkInv9(state, 1, fills).map((v) => v.message).join(' ')).toMatch(
      /fills 2 venture roles/,
    );
  });

  it('fires when a filled hand is RECOVERING — a lost hand must be released', () => {
    const { state } = fixture();
    const hand = handsOf(state, A)[0]!;
    loseHand(hand, 1, Rng.fromSeed('x'), holdingOf(state, A).system);
    const fills = new Map<HandId, number>([[hand.id, 1]]);
    expect(checkInv9(state, 2, fills).map((v) => v.message).join(' ')).toMatch(
      /fills a venture role but is RECOVERING/,
    );
  });

  it('fires when a hand is COMMITTED with no role behind it', () => {
    const { state } = fixture();
    const hand = handsOf(state, A)[0]!;
    commitHand(hand);
    expect(checkInv9(state, 1, noFills).map((v) => v.message).join(' ')).toMatch(
      /COMMITTED but fills no venture role/,
    );
  });

  it('fires when a role names a hand that does not exist', () => {
    const { state } = fixture();
    const fills = new Map<HandId, number>([['ghost:h1' as HandId, 1]]);
    expect(checkInv9(state, 1, fills).map((v) => v.message).join(' ')).toMatch(/which is not a hand/);
  });

  it('refuses to commit a recovering hand', () => {
    const { state } = fixture();
    const hand = handsOf(state, A)[0]!;
    loseHand(hand, 1, Rng.fromSeed('x'), holdingOf(state, A).system);
    const result = commitHand(hand);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.invariant).toBe('INV-9');
  });

  it('lets a committed hand travel and keeps it committed on arrival (the escort)', () => {
    const { state, map, to } = fixture();
    const hand = handsOf(state, A)[0]!;
    commitHand(hand);
    expect(hand.state).toBe('COMMITTED');

    beginTransit(map, hand, to, 10);
    expect(hand.state).toBe('IN_TRANSIT');
    const fills = new Map<HandId, number>([[hand.id, 1]]);
    // In transit and filled is legal: an escort's whole job is to move with the load.
    expect(checkInv9(state, 11, fills)).toEqual([]);

    resolveMovement(state, hand.freeAtTick!, (id) => (fills.get(id) ?? 0) > 0);
    expect(hand.state).toBe('COMMITTED');
    expect(hand.location).toBe(to);
  });

  it('releases only a stationed hand — physical state wins', () => {
    const { state, map, to } = fixture();
    const hand = handsOf(state, A)[0]!;
    commitHand(hand);
    beginTransit(map, hand, to, 1);
    releaseHand(hand);
    expect(hand.state).toBe('IN_TRANSIT');
  });
});

describe('INV-10 — in_transit_eta agrees with the gate transit table', () => {
  it('sets the ETA from the table and nothing else', () => {
    const { state, map, from, to } = fixture();
    const hand = handsOf(state, A)[0]!;
    const cost = transitTicks(map, from, to);

    beginTransit(map, hand, to, 40);

    expect(hand.departedAtTick).toBe(40);
    expect(hand.freeAtTick).toBe(40 + cost);
    expect(inTransitEta(hand)).toBe(40 + cost);
    expect(expectedArrivalTick(map, hand)).toBe(40 + cost);
    expect(checkInv10(state, 41)).toEqual([]);
  });

  it('fires when the ETA is tampered with', () => {
    const { state, map, to } = fixture();
    const hand = handsOf(state, A)[0]!;
    beginTransit(map, hand, to, 40);
    hand.freeAtTick = (hand.freeAtTick ?? 0) + 1;
    expect(checkInv10(state, 41).map((v) => v.message).join(' ')).toMatch(/the gate table says/);
  });

  it('fires when an arrival is overdue — MOVE must run before every resolution phase', () => {
    const { state, map, to } = fixture();
    const hand = handsOf(state, A)[0]!;
    beginTransit(map, hand, to, 40);
    const eta = hand.freeAtTick!;
    // Assert at a tick past the ETA without ever running MOVE.
    const messages = checkInv10(state, eta + 1).map((v) => v.message).join(' ');
    expect(messages).toMatch(/should have arrived/);
    expect(messages).toMatch(/MOVE must run before every resolution phase/);
  });

  it('publishes no ETA for a settled hand, and leaves a stray free tick to INV-9', () => {
    const { state } = fixture();
    const hand = handsOf(state, A)[0]!;
    hand.freeAtTick = 99;
    // A RECOVERING hand legitimately carries a freeAtTick, so INV-10 cannot claim
    // "free tick without transit" is wrong; INV-9's field consistency owns it.
    expect(inTransitEta(hand)).toBeNull();
    expect(checkInv10(state, 1)).toEqual([]);
    expect(checkInv9(state, 1, noFills).map((v) => v.message).join(' ')).toMatch(
      /IDLE but has freeAtTick 99/,
    );
  });

  it('refuses a move to a system with no lane, rather than pathfinding silently', () => {
    const { state, map } = fixture();
    const hand = handsOf(state, A)[0]!;
    const far = map.systemOrder.find(
      (id) => id !== hand.location && !systemOf(map, hand.location).lanes.includes(id),
    );
    const result = beginTransit(map, hand, far!, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.invariant).toBe('INV-10');
      expect(result.hint).toMatch(/one gate at a time/);
    }
  });

  it('refuses to redirect a hand mid-lane, and says when it arrives', () => {
    const { state, map, to } = fixture();
    const hand = handsOf(state, A)[0]!;
    beginTransit(map, hand, to, 1);
    const again = beginTransit(map, hand, hand.location, 2);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.hint).toMatch(/already in transit/);
  });
});

describe('the arrival decision (TRACKER open question 5)', () => {
  it('is a single exported constant, and it is false', () => {
    expect(ARRIVAL_IS_PRESENT_SAME_TICK).toBe(false);
    expect(MOVEMENT_RULES.arrivalIsPresentSameTick).toBe(ARRIVAL_IS_PRESENT_SAME_TICK);
  });

  it('states itself in one sentence for agent.md, and the sentence matches the engine', () => {
    // Scar #1: the agent-facing text is a rules surface. If this sentence and the
    // constant ever disagree, agents plan against a rule the engine does not run.
    expect(MOVEMENT_STATEMENT).toBe(MOVEMENT_RULES.statement);
    expect(MOVEMENT_STATEMENT).toContain('T+1');
    expect(MOVEMENT_STATEMENT).toContain('PRESENT');
    expect(ARRIVAL_IS_PRESENT_SAME_TICK ? 'unused' : MOVEMENT_STATEMENT).toContain('at tick T+1');
  });

  it('occupies the destination on the arrival tick but is not present until the next', () => {
    const { state, map, from, to } = fixture();
    const hand = handsOf(state, A)[0]!;
    beginTransit(map, hand, to, 10);
    const eta = hand.freeAtTick!;

    // Mid-lane: at neither end.
    expect(occupiesSystem(hand, from)).toBe(false);
    expect(occupiesSystem(hand, to)).toBe(false);
    expect(laneOf(hand)).not.toBeNull();

    resolveMovement(state, eta, () => false);

    // Arrived: it renders there and can be raided there...
    expect(occupiesSystem(hand, to)).toBe(true);
    // ...but it cannot work, escort, garrison or fill a role until the next tick.
    expect(isPresent(hand, eta)).toBe(false);
    expect(isPresent(hand, eta + 1)).toBe(true);
  });

  it('leaves the origin the tick it departs', () => {
    const { state, map, from, to } = fixture();
    const hand = handsOf(state, A)[0]!;
    beginTransit(map, hand, to, 10);
    expect(isPresent(hand, 10)).toBe(false);
    expect(occupiesSystem(hand, from)).toBe(false);
    expect(checkWorldInvariants(state, 10, noFills)).toEqual([]);
  });
});

describe('cargo, and what the ledger can see', () => {
  it('counts goods on every hand, moving or not (INV-2 Σ in-transit)', () => {
    const { state, map, to } = fixture();
    const [idle, moving] = handsOf(state, A);
    loadCargo(idle!, ORE, qty(4), 0);
    loadCargo(moving!, ORE, qty(6), 0);
    beginTransit(map, moving!, to, 1);

    // The idle hand's four ore are just as far outside the account tree as the
    // six that are moving. Narrowing this to state === IN_TRANSIT is the bug.
    expect(cargoHeldByHands(state.hands.values()).get(ORE)).toBe(10);
  });

  it('reports lane cargo separately, for the map and not for the ledger', () => {
    const { state, map, to } = fixture();
    const [idle, moving] = handsOf(state, A);
    loadCargo(idle!, ORE, qty(4), 0);
    loadCargo(moving!, ORE, qty(6), 0);
    beginTransit(map, moving!, to, 1);

    const lanes = cargoOnLanes(state.hands.values());
    expect(lanes.size).toBe(1);
    expect([...lanes.values()][0]?.get(ORE)).toBe(6);
  });

  it('refuses to load a hand that is not present', () => {
    const { state, map, to } = fixture();
    const hand = handsOf(state, A)[0]!;
    beginTransit(map, hand, to, 1);
    const result = loadCargo(hand, ORE, qty(1), 2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.hint).toMatch(/cannot be loaded/);
  });

  it('refuses to unload more than a hand carries — Qty cannot go negative', () => {
    const { state } = fixture();
    const hand = handsOf(state, A)[0]!;
    loadCargo(hand, ORE, qty(2), 0);
    expect(unloadCargo(hand, ORE, qty(3)).ok).toBe(false);
    expect(unloadCargo(hand, ORE, qty(2)).ok).toBe(true);
    expect(hand.cargo.has(ORE)).toBe(false);
  });

  it('caps the number of distinct goods on one hand (INV-26, scar #3)', () => {
    const { state } = fixture();
    const hand = handsOf(state, A)[0]!;
    for (let i = 0; i < MAX_CARGO_GOODS; i += 1) {
      expect(loadCargo(hand, `G${String(i)}` as GoodId, qty(1), 0).ok).toBe(true);
    }
    const overflow = loadCargo(hand, 'ONE-TOO-MANY' as GoodId, qty(1), 0);
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) expect(overflow.invariant).toBe('INV-26');
    // Adding to a good it already carries is always fine — the cap is on breadth.
    expect(loadCargo(hand, 'G0' as GoodId, qty(1), 0).ok).toBe(true);
  });

  it('keeps hands addressable by permanent id', () => {
    const { state } = fixture();
    const hand = handsOf(state, B)[1]!;
    expect(handById(state, hand.id)).toBe(hand);
    expect(hand.id).toBe(`${B}:h2`);
  });
});
