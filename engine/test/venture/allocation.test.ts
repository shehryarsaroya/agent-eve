/**
 * PROP-V8 — role slots are batch-allocated at tick close, never granted at submit.
 *
 * > Rationed resources (role slots) are batch-allocated at tick close, never granted
 * > at submit — so identical policies submitting at different moments within a tick
 * > get identical outcomes. *(Otherwise scarce slots are a polling contest: scar #2
 * > rebuilt.)*
 *
 * Scar #2 is the one this closes: "No engine-owned action budget ... wealth was
 * determined by requests-per-second, not judgment." A rationed slot granted at submit
 * rebuilds it inside a single mechanic, and it would look like a working feature.
 */

import { describe, expect, it } from 'vitest';
import { minor } from '../../src/core/units.js';
import type { HandId, PrincipalId } from '../../src/core/types.js';
import {
  allocateFills,
  type AllocationContext,
  type FillRequest,
} from '../../src/venture/index.js';
import { handById } from '../../src/world/index.js';
import {
  ALICE,
  BRAM,
  CASS,
  DOV,
  ESK,
  fixture,
  handOf,
  makeHaul,
  makeTopYield,
  rngFor,
  vid,
  type Fixture,
} from './fixture.js';

function ctxFor(f: Fixture, tick = 1): AllocationContext {
  return { tick, handOf: (id: HandId) => f.world.hands.get(id) };
}

function request(
  f: Fixture,
  venture: string,
  roleIndex: number,
  principal: PrincipalId,
  clientSequence: number,
  stake = 0,
  ordinal = 1,
): FillRequest {
  return {
    venture: vid(venture),
    roleIndex,
    principal,
    hand: handOf(f, principal, ordinal).id,
    clientSequence,
    stake: minor(stake),
  };
}

/** The same set of requests in a different order. Never a different *set*. */
function shuffled(requests: readonly FillRequest[], label: string): FillRequest[] {
  return rngFor(label).shuffle([...requests]);
}

describe('PROP-V8 — allocation is a function of the request set, not its order', () => {
  it('gives identical outcomes for 32 permutations of the same contest', () => {
    const requests = (f: Fixture): FillRequest[] => [
      request(f, 'v-a', 1, BRAM, 1, 500),
      request(f, 'v-a', 1, CASS, 1, 900),
      request(f, 'v-a', 1, DOV, 1, 200),
      request(f, 'v-a', 0, ALICE, 1, 0),
      request(f, 'v-b', 0, ESK, 1, 100),
      request(f, 'v-b', 1, CASS, 2, 100),
    ];

    const outcomes = new Set<string>();
    for (let i = 0; i < 32; i += 1) {
      const f = fixture();
      makeHaul(f, { id: vid('v-a') });
      makeHaul(f, { id: vid('v-b'), creator: BRAM });
      const result = allocateFills(f.book, shuffled(requests(f), `perm-${i}`), ctxFor(f));
      outcomes.add(
        JSON.stringify({
          granted: result.granted.map((g) => [g.request.venture, g.request.roleIndex, g.request.principal]),
          refused: result.refused.map((r) => [r.request.venture, r.request.roleIndex, r.request.principal, r.reason]),
        }),
      );
    }
    // One outcome across every permutation. If arrival mattered this would be many.
    expect(outcomes.size).toBe(1);
  });

  it('the winner is the highest stake, not the earliest client_sequence', () => {
    const f = fixture();
    makeHaul(f, { id: vid('v-a') });
    const result = allocateFills(
      f.book,
      [
        // Submitted "first" with the lowest stake.
        request(f, 'v-a', 1, BRAM, 1, 100),
        request(f, 'v-a', 1, CASS, 99, 900),
      ],
      ctxFor(f),
    );
    expect(result.granted).toHaveLength(1);
    expect(result.granted[0]?.request.principal).toBe(CASS);
    expect(result.refused[0]?.reason).toBe('LOST_CONTEST');
  });

  it("honours the initiator's stated preference order above stake (§7.3)", () => {
    const f = fixture();
    makeHaul(f, { id: vid('v-a'), preference: [DOV, CASS] });
    const result = allocateFills(
      f.book,
      [
        request(f, 'v-a', 1, CASS, 1, 100_000),
        request(f, 'v-a', 1, DOV, 1, 1),
      ],
      ctxFor(f),
    );
    expect(result.granted[0]?.request.principal).toBe(DOV);
  });

  it('sorts unlisted principals into one band, so stake decides between them', () => {
    const f = fixture();
    makeHaul(f, { id: vid('v-a'), preference: [ESK] });
    const result = allocateFills(
      f.book,
      [
        request(f, 'v-a', 1, CASS, 1, 100),
        request(f, 'v-a', 1, DOV, 1, 700),
      ],
      ctxFor(f),
    );
    expect(result.granted[0]?.request.principal).toBe(DOV);
  });

  it('breaks a true tie on principal id, then client_sequence — never arrival', () => {
    const f = fixture();
    makeHaul(f, { id: vid('v-a') });
    const result = allocateFills(
      f.book,
      [request(f, 'v-a', 1, DOV, 5, 500), request(f, 'v-a', 1, BRAM, 5, 500)],
      ctxFor(f),
    );
    // `p-bram` < `p-dov` by code unit.
    expect(result.granted[0]?.request.principal).toBe(BRAM);
  });
});

describe('allocation upholds the rules the venture and the index own', () => {
  it('refuses a second slot to a hand already committed, and says which', () => {
    const f = fixture();
    makeHaul(f, { id: vid('v-a') });
    makeHaul(f, { id: vid('v-b'), creator: BRAM });
    const result = allocateFills(
      f.book,
      [request(f, 'v-a', 1, CASS, 1, 100), request(f, 'v-b', 1, CASS, 2, 100)],
      ctxFor(f),
    );
    expect(result.granted).toHaveLength(1);
    expect(result.refused).toHaveLength(1);
    expect(result.refused[0]?.reason).toBe('HAND_COMMITTED');
    expect(result.refused[0]?.invariant).toBe('INV-9');
    // The two ventures are visited in `venture_id` order, so `v-a` wins, not whichever
    // request was handed over first.
    expect(result.granted[0]?.request.venture).toBe('v-a');
  });

  it('lets one principal use two hands across two ventures', () => {
    const f = fixture();
    makeHaul(f, { id: vid('v-a') });
    makeHaul(f, { id: vid('v-b'), creator: BRAM });
    const result = allocateFills(
      f.book,
      [
        request(f, 'v-a', 1, CASS, 1, 100, 1),
        request(f, 'v-b', 1, CASS, 2, 100, 2),
      ],
      ctxFor(f),
    );
    expect(result.granted).toHaveLength(2);
  });

  it('refuses the same principal a second role in one venture (PROP-V6)', () => {
    const f = fixture();
    makeHaul(f, { id: vid('v-a') });
    const result = allocateFills(
      f.book,
      [
        request(f, 'v-a', 0, CASS, 1, 100, 1),
        request(f, 'v-a', 1, CASS, 2, 100, 2),
      ],
      ctxFor(f),
    );
    expect(result.granted).toHaveLength(1);
    expect(result.refused).toHaveLength(1);
    expect(result.refused[0]?.invariant).toBe('PROP-V6');
    expect(result.refused[0]?.reason).toBe('ROLE_RULE');
  });

  it('never leaves a half-written role behind a losing request', () => {
    const f = fixture();
    const haul = makeHaul(f, { id: vid('v-a') });
    allocateFills(
      f.book,
      [
        request(f, 'v-a', 1, BRAM, 1, 100),
        request(f, 'v-a', 1, CASS, 1, 900),
        request(f, 'v-a', 1, DOV, 1, 400),
      ],
      ctxFor(f),
    );
    expect(haul.roles[1]?.filledByPrincipal).toBe(CASS);
    expect(f.book.indexFaults(1)).toEqual([]);
    // The losers' hands are untouched.
    expect(handById(f.world, handOf(f, BRAM, 1).id).state).toBe('IDLE');
    expect(handById(f.world, handOf(f, DOV, 1).id).state).toBe('IDLE');
  });

  it('refuses an unknown venture, an unknown hand, and a hand that is not yours', () => {
    const f = fixture();
    makeHaul(f, { id: vid('v-a') });
    const foreign: FillRequest = {
      venture: vid('v-a'),
      roleIndex: 1,
      principal: CASS,
      hand: handOf(f, DOV, 1).id,
      clientSequence: 1,
      stake: minor(0),
    };
    const result = allocateFills(
      f.book,
      [
        request(f, 'v-missing', 0, BRAM, 1),
        { ...request(f, 'v-a', 1, BRAM, 2), hand: 'no-such-hand' as HandId },
        foreign,
      ],
      ctxFor(f),
    );
    expect(result.granted).toHaveLength(0);
    expect(result.refused).toHaveLength(3);
    expect(new Set(result.refused.map((r) => r.reason))).toEqual(new Set(['ROLE_RULE']));
  });

  it('refuses everything once the window has closed', () => {
    const f = fixture();
    makeHaul(f, { id: vid('v-a'), windowOpensTick: 0, windowClosesTick: 5 });
    const result = allocateFills(f.book, [request(f, 'v-a', 0, ALICE, 1)], ctxFor(f, 6));
    expect(result.granted).toHaveLength(0);
    expect(result.refused[0]?.invariant).toBe('PROP-V6');
  });

  it('does not consult fillRole for a hand the index already holds', () => {
    // Ordering matters: if the venture were asked first, a losing request could write
    // a role and then be rolled back, and a rollback in a tick that later aborts is
    // exactly what §15.3 says must not be possible.
    const f = fixture();
    const a = makeHaul(f, { id: vid('v-a') });
    const b = makeHaul(f, { id: vid('v-b'), creator: BRAM });
    allocateFills(f.book, [request(f, 'v-a', 1, CASS, 1)], ctxFor(f));
    allocateFills(f.book, [request(f, 'v-b', 1, CASS, 1)], ctxFor(f));
    expect(a.roles[1]?.filledByPrincipal).toBe(CASS);
    expect(b.roles[1]?.filledByPrincipal).toBeNull();
  });
});

describe('the whole board fills deterministically', () => {
  it('four principals fill a four-role BUILD identically across permutations', () => {
    const outcomes = new Set<string>();
    for (let i = 0; i < 16; i += 1) {
      const f = fixture();
      // A BUILD is top-yield: un-escrowable, four roles, four distinct principals.
      const build = makeTopYield(f, 'BUILD', vid('v-build'), ESK);
      const requests = build.roles.map((role) =>
        request(f, 'v-build', role.index, [ALICE, BRAM, CASS, DOV][role.index] as PrincipalId, 1, role.index * 10),
      );
      const result = allocateFills(f.book, shuffled(requests, `build-${i}`), ctxFor(f));
      expect(result.refused).toHaveLength(0);
      outcomes.add(
        JSON.stringify(result.granted.map((g) => [g.request.roleIndex, g.request.principal])),
      );
    }
    expect(outcomes.size).toBe(1);
  });
});
