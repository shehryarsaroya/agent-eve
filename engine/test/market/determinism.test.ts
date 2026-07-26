/**
 * **A4 — a faster HTTP client gains nothing on this book.**
 *
 * This is the test the whole market module was shaped around. In EVE, market speed
 * is enormous power: the player who repriced first got the fill. A4 forbids that
 * here — "never let requests-per-second, uptime, model size, or account age be
 * power" — and an order book is the single easiest place in this design to break it
 * by accident, because every real exchange breaks it on purpose.
 *
 * The claim, stated so it is falsifiable: **the same set of orders, presented to the
 * matcher in any arrival order, produces byte-identical fills.** Proved by running
 * every permutation of a set through the pure matcher and comparing canonical
 * hashes of the resulting plans, not by inspecting the rule and agreeing with it.
 */

import { describe, expect, it } from 'vitest';
import { canonicalHash, type CanonicalValue } from '../../src/core/canonical.js';
import { matchBook, type MatchPlan } from '../../src/market/index.js';
import { minor, qty } from '../../src/core/units.js';
import type { Order } from '../../src/market/index.js';
import { ALICE, BOB, CARA, GOOD, VENUE, order, permutations } from './fixture.js';

const TICK = 5;

function plan(orders: readonly Order[]): MatchPlan {
  return matchBook({
    tick: TICK,
    venue: VENUE,
    good: GOOD,
    orders,
    // Deep escrow on both sides, so this suite isolates the ORDERING rule. The
    // ceilings have their own tests in escrow.test.ts.
    cashLockOf: (o) => minor(o.limitPrice * o.quantity),
    escrowedGoodsOf: () => qty(1_000_000),
  });
}

function fingerprint(p: MatchPlan): string {
  const rows: CanonicalValue = p.fills.map((f) => [
    f.bid,
    f.ask,
    f.unitPrice as number,
    f.qty as number,
    f.buyer,
    f.seller,
  ]);
  return canonicalHash(rows);
}

describe('A4 — matching is deterministic under any arrival order', () => {
  it('every permutation of one crossing set produces the identical fill sequence', () => {
    const set: Order[] = [
      order({ principal: ALICE, side: 'BID', price: 12, qty: 5, tick: 1, sequence: 0 }),
      order({ principal: BOB, side: 'ASK', price: 10, qty: 3, tick: 1, sequence: 1 }),
      order({ principal: CARA, side: 'ASK', price: 11, qty: 4, tick: 2, sequence: 0 }),
      order({ principal: BOB, side: 'BID', price: 9, qty: 6, tick: 2, sequence: 2 }),
    ];
    const perms = permutations(set);
    // 4! — enough to catch any dependence on input order, small enough to be instant.
    expect(perms.length).toBe(24);

    const first = perms[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const expected = fingerprint(plan(first));
    for (const [i, shuffled] of perms.entries()) {
      expect(fingerprint(plan(shuffled)), `permutation ${String(i)} matched differently`).toBe(expected);
    }
    // The set must actually trade, or this proves only that nothing happened
    // identically 24 times.
    expect(plan(set).fills.length).toBeGreaterThan(0);
  });

  it('two same-priced orders in the same tick resolve by principal then client_sequence, not arrival', () => {
    // ALICE and BOB both ask 10 at tick 1. The buyer can only take 4 of the 8 on
    // offer, so exactly one of them gets the fill and WHICH ONE is the A4 question.
    // `compareIds('p:alice','p:bob') < 0`, so ALICE is senior on principal id and
    // must win in every arrival order.
    const set: Order[] = [
      order({ principal: BOB, side: 'ASK', price: 10, qty: 4, tick: 1, sequence: 0 }),
      order({ principal: ALICE, side: 'ASK', price: 10, qty: 4, tick: 1, sequence: 0 }),
      order({ principal: CARA, side: 'BID', price: 10, qty: 4, tick: 1, sequence: 0 }),
    ];
    for (const shuffled of permutations(set)) {
      const fills = plan(shuffled).fills;
      expect(fills.length).toBe(1);
      expect(fills[0]?.seller, 'the winner changed with arrival order — A4 is broken').toBe(ALICE);
    }
  });

  it('an order that has rested a tick outranks one placed later at the same price', () => {
    const early = order({ principal: BOB, side: 'ASK', price: 10, qty: 4, tick: 1, sequence: 0 });
    const late = order({ principal: ALICE, side: 'ASK', price: 10, qty: 4, tick: 3, sequence: 0 });
    const taker = order({ principal: CARA, side: 'BID', price: 10, qty: 4, tick: 4, sequence: 0 });
    for (const shuffled of permutations([late, early, taker])) {
      const fills = plan(shuffled).fills;
      expect(fills.length).toBe(1);
      // BOB is later in id order and still wins, because seniority is `placedTick`
      // FIRST. If price-time priority ever degraded to price-id priority this flips.
      expect(fills[0]?.seller).toBe(BOB);
    }
  });

  it('one agent submitting the same order twice as fast cannot outrank another agent', () => {
    // The concrete A4 scenario: CARA has a faster client and gets two bids in at the
    // same price in the same tick. It still cannot take a fill that ALICE's earlier
    // client_sequence... would not have. What it CAN do is queue behind itself.
    const first = order({ principal: ALICE, side: 'BID', price: 10, qty: 2, tick: 1, sequence: 0 });
    const fastA = order({ principal: CARA, side: 'BID', price: 10, qty: 2, tick: 1, sequence: 0 });
    const fastB = order({ principal: CARA, side: 'BID', price: 10, qty: 2, tick: 1, sequence: 1 });
    const seller = order({ principal: BOB, side: 'ASK', price: 10, qty: 2, tick: 1, sequence: 0 });
    for (const shuffled of permutations([fastB, fastA, first, seller])) {
      const fills = plan(shuffled).fills;
      expect(fills.length).toBe(1);
      expect(fills[0]?.buyer, 'a faster client took a fill that priority did not give it').toBe(ALICE);
    }
  });

  it('the plan is a pure function: running it twice changes nothing about the book', () => {
    const set: Order[] = [
      order({ principal: ALICE, side: 'BID', price: 12, qty: 5, tick: 1 }),
      order({ principal: BOB, side: 'ASK', price: 10, qty: 5, tick: 1 }),
    ];
    const shape = (): CanonicalValue => set.map((o) => [o.id, o.filled as number, o.state]);
    const before = canonicalHash(shape());
    const a = fingerprint(plan(set));
    const b = fingerprint(plan(set));
    const after = canonicalHash(shape());
    expect(a).toBe(b);
    expect(after, 'the matcher mutated an order; it must only ever return a plan').toBe(before);
  });

  it('price beats seniority: a better price jumps the queue, which is the only thing that can', () => {
    const patient = order({ principal: ALICE, side: 'ASK', price: 12, qty: 4, tick: 1 });
    const aggressive = order({ principal: BOB, side: 'ASK', price: 10, qty: 4, tick: 3 });
    const buyer = order({ principal: CARA, side: 'BID', price: 12, qty: 4, tick: 3, sequence: 1 });
    for (const shuffled of permutations([patient, aggressive, buyer])) {
      const fills = plan(shuffled).fills;
      expect(fills.length).toBe(1);
      expect(fills[0]?.seller).toBe(BOB);
      // …and it trades at the seller's limit, because the seller is the more senior
      // of the pair (tick 3, `p:bob` < `p:cara`). The buyer keeps the improvement.
      expect(fills[0]?.unitPrice).toBe(10);
    }
  });
});
