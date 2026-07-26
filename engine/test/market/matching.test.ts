/**
 * Matching semantics: partial fills, IOC, limits, and the escrow ceilings.
 *
 * Driven through the **pure** matcher wherever the property is about the rule, so a
 * failure names the rule rather than the engine. The two properties that are about
 * the tick — "submitted at T, matched at T+1" and "IOC gets exactly one pass" — are
 * driven through a real runtime, because they are claims about the phase order and
 * cannot be true or false inside a pure function.
 */

import { describe, expect, it } from 'vitest';
import { minor, qty } from '../../src/core/units.js';
import { crossPrice, isMatchable, matchBook, topOfBook } from '../../src/market/index.js';
import type { Order } from '../../src/market/index.js';
import { ALICE, BOB, CARA, GOOD, VENUE, act, order, tick, world } from './fixture.js';

const TICK = 5;

function plan(orders: readonly Order[], cash?: (o: Order) => number, goods?: number) {
  return matchBook({
    tick: TICK,
    venue: VENUE,
    good: GOOD,
    orders,
    cashLockOf: (o) => minor(cash === undefined ? o.limitPrice * o.quantity : cash(o)),
    escrowedGoodsOf: () => qty(goods ?? 1_000_000),
  });
}

describe('partial fills — a commodity order fills as far as it can', () => {
  it('fills the smaller side and leaves the larger one working', () => {
    const bid = order({ principal: ALICE, side: 'BID', price: 10, qty: 10, tick: 1 });
    const ask = order({ principal: BOB, side: 'ASK', price: 10, qty: 4, tick: 1 });
    const fills = plan([bid, ask]).fills;
    expect(fills.length).toBe(1);
    expect(fills[0]?.qty).toBe(4);
  });

  it('walks a bid across several asks, best price first, paying each maker its own limit', () => {
    // The asks rested first, so each is the maker of its own fill and each is paid
    // exactly what it asked. The aggressor keeps the whole improvement.
    const cheap = order({ principal: BOB, side: 'ASK', price: 10, qty: 4, tick: 1 });
    const dear = order({ principal: CARA, side: 'ASK', price: 11, qty: 4, tick: 1 });
    const bid = order({ principal: ALICE, side: 'BID', price: 12, qty: 10, tick: 3 });
    const fills = plan([bid, dear, cheap]).fills;
    expect(fills.map((f) => [f.unitPrice, f.qty])).toEqual([
      [10, 4],
      [11, 4],
    ]);
    // 2 of the bid remain unfilled: the book ran out, not the bid.
    expect(fills.reduce((n, f) => n + f.qty, 0)).toBe(8);
  });

  it('the rule is symmetric: a resting BID pays its own limit when a later seller crosses it', () => {
    // The half of the maker-price rule that is easy to get wrong, because it looks
    // like the buyer overpaying. It is not: the bid stood there advertising 12, the
    // seller chose to take it, and the seller keeps the improvement. If this ever
    // flipped to "always the ask's price", resting a bid would be strictly dominated
    // and the buy side of every book would empty out.
    const resting = order({ principal: ALICE, side: 'BID', price: 12, qty: 4, tick: 1 });
    const later = order({ principal: BOB, side: 'ASK', price: 10, qty: 4, tick: 3 });
    const fills = plan([resting, later]).fills;
    expect(fills.length).toBe(1);
    expect(fills[0]?.unitPrice).toBe(12);
  });

  it('stops at the limit and never trades through it', () => {
    const bid = order({ principal: ALICE, side: 'BID', price: 10, qty: 10, tick: 1 });
    const tooDear = order({ principal: BOB, side: 'ASK', price: 11, qty: 10, tick: 1 });
    expect(plan([bid, tooDear]).fills).toEqual([]);
    expect(crossPrice(bid, tooDear)).toBeNull();
  });

  it('a partly filled order keeps only its remainder working', () => {
    const half = order({ principal: ALICE, side: 'BID', price: 10, qty: 10, filled: 7, tick: 1 });
    const ask = order({ principal: BOB, side: 'ASK', price: 10, qty: 10, tick: 1 });
    // The lock is sized on the REMAINDER, which is what an already-drawn lock holds.
    const fills = plan([half, ask], (o) => (o.side === 'BID' ? 3 * o.limitPrice : 0)).fills;
    expect(fills.length).toBe(1);
    expect(fills[0]?.qty).toBe(3);
  });
});

describe('the escrow ceilings bind the fill, they do not halt the world', () => {
  it('a bid whose lock was drained fills only what the lock still backs', () => {
    // PROP-L3 in the market: an audit seizure legitimately drains a locked account.
    // The order does not become illegal, it becomes smaller.
    const bid = order({ principal: ALICE, side: 'BID', price: 10, qty: 10, tick: 1 });
    const ask = order({ principal: BOB, side: 'ASK', price: 10, qty: 10, tick: 1 });
    const fills = plan([bid, ask], (o) => (o.side === 'BID' ? 25 : 0)).fills;
    expect(fills.length).toBe(1);
    // floor(25 / 10) = 2. Not 2.5, and not a refusal.
    expect(fills[0]?.qty).toBe(2);
  });

  it('an ask fills only what is actually in escrow, and the pool is shared across a seller orders', () => {
    const askA = order({ principal: BOB, side: 'ASK', price: 10, qty: 6, tick: 1, sequence: 0 });
    const askB = order({ principal: BOB, side: 'ASK', price: 10, qty: 6, tick: 1, sequence: 1 });
    const bid = order({ principal: ALICE, side: 'BID', price: 10, qty: 12, tick: 1 });
    // Only 7 units are actually escrowed by BOB across BOTH asks.
    const fills = plan([askA, askB, bid], undefined, 7).fills;
    expect(fills.reduce((n, f) => n + f.qty, 0), 'the pool was double-counted across two asks').toBe(7);
  });

  it('a bid with nothing behind it fills nothing and the pass still terminates', () => {
    const bid = order({ principal: ALICE, side: 'BID', price: 10, qty: 5, tick: 1 });
    const ask = order({ principal: BOB, side: 'ASK', price: 10, qty: 5, tick: 1 });
    const p = plan([bid, ask], () => 0);
    expect(p.fills).toEqual([]);
    expect(p.steps).toBeLessThan(20);
  });
});

describe('the matchable window is the phase order, expressed as a predicate', () => {
  it('an order placed this tick is not matchable this tick', () => {
    const fresh = order({ principal: ALICE, side: 'BID', price: 10, qty: 5, tick: TICK });
    expect(isMatchable(fresh, TICK)).toBe(false);
    expect(isMatchable(fresh, TICK + 1)).toBe(true);
  });

  it('an expired order is not matchable', () => {
    const stale = order({ principal: ALICE, side: 'BID', price: 10, qty: 5, tick: 1, expires: 3 });
    expect(isMatchable(stale, TICK)).toBe(false);
  });

  it('a fully filled order is not matchable', () => {
    const done = order({ principal: ALICE, side: 'BID', price: 10, qty: 5, filled: 5, tick: 1 });
    expect(isMatchable(done, TICK)).toBe(false);
  });
});

describe('top of book', () => {
  it('reports the best of each side and the spread between them', () => {
    const top = topOfBook([
      order({ principal: ALICE, side: 'BID', price: 8, qty: 1, tick: 1, sequence: 0 }),
      order({ principal: ALICE, side: 'BID', price: 9, qty: 1, tick: 1, sequence: 1 }),
      order({ principal: BOB, side: 'ASK', price: 12, qty: 1, tick: 1, sequence: 0 }),
      order({ principal: BOB, side: 'ASK', price: 11, qty: 1, tick: 1, sequence: 1 }),
    ]);
    expect(top).toEqual({ bestBid: 9, bestAsk: 11, spread: 2 });
  });

  it('an empty book has no price and no invented spread', () => {
    expect(topOfBook([])).toEqual({ bestBid: null, bestAsk: null, spread: null });
  });
});

describe('IOC is the only market-take primitive', () => {
  it('gets exactly one matching pass, then expires with its escrow released', () => {
    const w = world('ioc', ALICE, BOB);
    const { runtime, venue } = w;
    tick(runtime);
    // Nothing to trade against, so the IOC finds no counterparty.
    expect(
      act(runtime, ALICE, 'trade', {
        operation: 'place',
        venue,
        good: GOOD,
        side: 'BID',
        quantity: 5,
        limit_price: 9,
        time_in_force: 'IOC',
      }),
    ).toBeNull();
    expect(runtime.market.open().length).toBe(1);
    const locked = runtime.ledger.encumbrances.open().length;
    expect(locked).toBe(1);

    tick(runtime); // the one pass it gets
    expect(runtime.market.open().length, 'an IOC rested past its single pass').toBe(0);
    expect(runtime.ledger.encumbrances.open().length, 'an expired IOC kept its escrow').toBe(0);
    const closed = runtime.market.closed();
    expect(closed[closed.length - 1]?.state).toBe('EXPIRED');
  });

  it('a GTC order rests instead, and is still there several ticks later', () => {
    const w = world('gtc', ALICE, BOB);
    const { runtime, venue } = w;
    tick(runtime);
    act(runtime, ALICE, 'trade', {
      operation: 'place',
      venue,
      good: GOOD,
      side: 'BID',
      quantity: 5,
      limit_price: 9,
      duration_ticks: 20,
    });
    for (let i = 0; i < 5; i += 1) tick(runtime);
    expect(runtime.market.open().length).toBe(1);
    expect(runtime.ledger.encumbrances.open().length).toBe(1);
  });

  it('a GTC order expires at its duration and gives the escrow back', () => {
    const w = world('gtc-expiry', ALICE, BOB);
    const { runtime, venue } = w;
    tick(runtime);
    const free = runtime.ledger.freeBalance(`stores:${ALICE}` as never);
    act(runtime, ALICE, 'trade', {
      operation: 'place',
      venue,
      good: GOOD,
      side: 'BID',
      quantity: 5,
      limit_price: 9,
      duration_ticks: 2,
    });
    expect(runtime.ledger.freeBalance(`stores:${ALICE}` as never)).toBe(free - 45);
    tick(runtime);
    expect(runtime.market.open().length).toBe(1);
    tick(runtime);
    expect(runtime.market.open().length).toBe(0);
    expect(runtime.ledger.freeBalance(`stores:${ALICE}` as never)).toBe(free);
  });
});
