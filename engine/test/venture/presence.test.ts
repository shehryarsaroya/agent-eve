/**
 * INV-9 across the seam between the venture and the world.
 *
 * > a hand in a role is `COMMITTED` (stationed) or `IN_TRANSIT` (travelling for it —
 * > an escort's whole job), never `IDLE` and never `RECOVERING`. — `world/invariants.ts`
 *
 * Commitment lives in `venture_role.filled_by_hand_id` and hand *state* lives in the
 * world, so the two have to move together within one phase. The first build granted a
 * fill and left the hand `IDLE`, which means the ALLOCATE phase produced a state the
 * ASSERT phase halts on — the engine halting on a world it created itself, which §15.2
 * treats as an outage in front of an audience.
 *
 * Neither `allocation.test.ts` nor `concurrency.test.ts` could see it: the only test
 * that ran `checkInv9` reached the fill through the fixture's helper, which commits the
 * hand itself. So this file asserts the invariant against the **real** allocator and
 * the **real** settlement, with nothing in between.
 */

import { describe, expect, it } from 'vitest';
import { minor, type Minor } from '../../src/core/units.js';
import { checkInv9, handById } from '../../src/world/index.js';
import {
  IN_FULL,
  activate,
  allocateFills,
  settleBatch,
  type Election,
  type SettleInput,
  type VentureRecord,
} from '../../src/venture/index.js';
import {
  ACCOUNTS,
  ALICE,
  BRAM,
  CASS,
  STATE_VERSION,
  ev,
  fixture,
  freeHandOf,
  fundEscrow,
  makeHaul,
  presenceOf,
  signAll,
  vid,
  type Fixture,
} from './fixture.js';

function inp(
  venture: VentureRecord,
  proceeds: Minor,
  elections: ReadonlyMap<number, Election> = new Map(),
): SettleInput {
  return {
    venture,
    tick: 287,
    eventId: ev(`settle:${venture.id}`),
    outcome: 'FULFILLED',
    proceeds,
    elections,
    actedOnStateVersion: STATE_VERSION,
    causeEventId: null,
  };
}

/** Fill every role of a HAUL through the real allocator, never through the fixture. */
function allocate(f: Fixture, haul: VentureRecord, tick = 1): void {
  const requests = [ALICE, BRAM].map((principal, roleIndex) => ({
    venture: haul.id,
    roleIndex,
    principal,
    hand: freeHandOf(f, principal).id,
    clientSequence: 1,
    stake: minor(0),
  }));
  const result = allocateFills(f.book, requests, { tick, handOf: (id) => f.world.hands.get(id) });
  expect(result.refused).toEqual([]);
  expect(result.granted).toHaveLength(2);
}

describe('ALLOCATE leaves a world the ASSERT phase accepts', () => {
  it('commits the hand it granted a role to', () => {
    const f = fixture();
    const haul = makeHaul(f, { id: vid('v-a') });
    const hand = freeHandOf(f, BRAM);
    const result = allocateFills(
      f.book,
      [{ venture: haul.id, roleIndex: 1, principal: BRAM, hand: hand.id, clientSequence: 1, stake: minor(0) }],
      { tick: 1, handOf: (id) => f.world.hands.get(id) },
    );
    expect(result.granted).toHaveLength(1);
    expect(handById(f.world, hand.id).state).toBe('COMMITTED');
    expect(checkInv9(f.world, 1, f.book.roleFills())).toEqual([]);
  });

  it('leaves the hand alone when the request is refused', () => {
    const f = fixture();
    const haul = makeHaul(f, { id: vid('v-a') });
    const hand = freeHandOf(f, BRAM);
    const result = allocateFills(
      f.book,
      // A role index this kind does not have: refused on the rules, not a lost contest.
      [{ venture: haul.id, roleIndex: 9, principal: BRAM, hand: hand.id, clientSequence: 1, stake: minor(0) }],
      { tick: 1, handOf: (id) => f.world.hands.get(id) },
    );
    expect(result.granted).toEqual([]);
    expect(handById(f.world, hand.id).state).toBe('IDLE');
    expect(checkInv9(f.world, 1, f.book.roleFills())).toEqual([]);
  });

  it('commits exactly the winner of a contested slot, and nobody else', () => {
    const f = fixture();
    const haul = makeHaul(f, { id: vid('v-a'), preference: [BRAM, CASS] });
    const bram = freeHandOf(f, BRAM);
    const cass = freeHandOf(f, CASS);
    const result = allocateFills(
      f.book,
      [
        { venture: haul.id, roleIndex: 1, principal: CASS, hand: cass.id, clientSequence: 1, stake: minor(99) },
        { venture: haul.id, roleIndex: 1, principal: BRAM, hand: bram.id, clientSequence: 1, stake: minor(0) },
      ],
      { tick: 1, handOf: (id) => f.world.hands.get(id) },
    );
    expect(result.granted.map((g) => g.request.principal)).toEqual([BRAM]);
    expect(handById(f.world, bram.id).state).toBe('COMMITTED');
    // The loser's hand must stay free, or one contested slot costs three principals
    // their presence for a Reckoning.
    expect(handById(f.world, cass.id).state).toBe('IDLE');
    expect(checkInv9(f.world, 1, f.book.roleFills())).toEqual([]);
  });

  it('holds all the way through a real settlement, allocator to receipt', () => {
    const f = fixture();
    const haul = makeHaul(f, { id: vid('v-a') });
    allocate(f, haul);
    expect(checkInv9(f.world, 1, f.book.roleFills())).toEqual([]);

    signAll(f, haul);
    fundEscrow(f, haul);
    const live = activate(haul, STATE_VERSION, 1);
    if (!live.ok) throw new Error(`activate: ${live.invariant} ${live.hint}`);
    f.ledger.transferCurrency({
      eventId: ev('proceeds:v-a'),
      tick: 1,
      from: ACCOUNTS.storesOf(haul.creator),
      to: ACCOUNTS.escrowOf(haul),
      amount: minor(12_000),
    });

    settleBatch(
      f.ledger,
      f.book,
      [inp(haul, minor(12_000), new Map<number, Election>([[0, IN_FULL], [1, IN_FULL]]))],
      ACCOUNTS,
      presenceOf(f),
    );
    // The venture is resolved, so no hand fills a live role — and no hand may still be
    // COMMITTED, or INV-9 halts the very next tick.
    expect(f.book.roleFills().size).toBe(0);
    for (const hand of f.world.hands.values()) expect(hand.state).toBe('IDLE');
    expect(checkInv9(f.world, 288, f.book.roleFills())).toEqual([]);
  });

  it('frees presence on a deferral too, and INV-9 is clean at the boundary', () => {
    const f = fixture();
    const haul = makeHaul(f, { id: vid('v-a') });
    allocate(f, haul);
    signAll(f, haul);
    fundEscrow(f, haul);
    const live = activate(haul, STATE_VERSION, 1);
    if (!live.ok) throw new Error(`activate: ${live.invariant} ${live.hint}`);

    // No proceeds and no elections: the escrowed halves execute, the elective ones do
    // not, and the venture defaults rather than deferring — either way the hands come
    // back, because a resolved venture must not go on holding somebody's presence.
    settleBatch(f.ledger, f.book, [inp(haul, minor(0))], ACCOUNTS, presenceOf(f));
    expect(f.book.commitmentOf(freeHandOf(f, BRAM).id)).toBeNull();
    expect(checkInv9(f.world, 288, f.book.roleFills())).toEqual([]);
  });

  it('reports the hands a settlement freed, for a driver that owns hand state itself', () => {
    const f = fixture();
    const haul = makeHaul(f, { id: vid('v-a') });
    allocate(f, haul);
    signAll(f, haul);
    fundEscrow(f, haul);
    const live = activate(haul, STATE_VERSION, 1);
    if (!live.ok) throw new Error(`activate: ${live.invariant} ${live.hint}`);

    // Settled with no presence source: the ids are still on the receipt, so a caller
    // that keeps hand state elsewhere has everything it needs to release them.
    const batch = settleBatch(f.ledger, f.book, [inp(haul, minor(0))], ACCOUNTS);
    expect(batch.settlements[0]?.freedHands).toHaveLength(2);
    for (const id of batch.settlements[0]?.freedHands ?? []) {
      expect(f.book.commitmentOf(id)).toBeNull();
    }
  });
});
