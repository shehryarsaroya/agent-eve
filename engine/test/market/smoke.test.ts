/**
 * The end-to-end shape, once: place, clear, settle, observe.
 *
 * Everything else in this directory tests one property hard. This is the walk
 * through the whole thing, so a failure elsewhere can be read against a known-good
 * baseline rather than against a guess about which half broke.
 */

import { describe, expect, it } from 'vitest';
import { storesAccount } from '../../src/ledger/index.js';
import { buildObservation } from '../../src/api/observe.js';
import { ALICE, BOB, GOOD, act, tick, world } from './fixture.js';

describe('one convoy of a trade: place, clear, settle', () => {
  it('an ask and a crossing bid trade at the maker price, and the goods land at the venue', () => {
    const w = world('smoke', ALICE, BOB);
    const { runtime, venue } = w;
    tick(runtime); // seat the hands so they are PRESENT

    const sellerCashBefore = runtime.ledger.balance(storesAccount(ALICE));
    const buyerCashBefore = runtime.ledger.balance(storesAccount(BOB));
    const buyerGoodsBefore = runtime.ledger.goodsInAccount(storesAccount(BOB)).get(GOOD) ?? 0;

    // ALICE rests an ask at 10.
    expect(
      act(runtime, ALICE, 'trade', {
        operation: 'place',
        venue,
        good: GOOD,
        side: 'ASK',
        quantity: 40,
        limit_price: 10,
      }),
    ).toBeNull();
    expect(runtime.market.open().length).toBe(1);
    // Placed at T, so nothing has traded at T.
    expect(runtime.market.fills().length).toBe(0);

    // BOB crosses it at 12 the next tick. The book is still ALICE's alone when BOB's
    // order is validated, so BOB's is the aggressor and ALICE's limit is the price.
    expect(
      act(runtime, BOB, 'trade', {
        operation: 'place',
        venue,
        good: GOOD,
        side: 'BID',
        quantity: 40,
        limit_price: 12,
        time_in_force: 'IOC',
      }),
    ).toBeNull();
    tick(runtime); // the MARKETS phase that matches them

    const fills = runtime.market.fills();
    expect(fills.length).toBe(1);
    const fill = fills[0];
    expect(fill?.qty).toBe(40);
    expect(fill?.unitPrice, 'the resting order set the price; the aggressor kept the improvement').toBe(10);
    expect(fill?.buyer).toBe(BOB);
    expect(fill?.seller).toBe(ALICE);
    expect(fill?.venue).toBe(venue);

    // Money moved exactly 40 x 10 and nothing was created or destroyed.
    expect(runtime.ledger.balance(storesAccount(ALICE))).toBe(sellerCashBefore + 400);
    expect(runtime.ledger.balance(storesAccount(BOB))).toBe(buyerCashBefore - 400);
    // Goods landed at the venue, in the buyer's stores.
    expect(runtime.ledger.goodsInAccount(storesAccount(BOB)).get(GOOD)).toBe(buyerGoodsBefore + 40);
    for (const lot of runtime.ledger.lotsInAccount(storesAccount(BOB))) {
      if (lot.good === GOOD) expect(lot.location).toBe(venue);
    }
    // Both orders are off the book with no escrow left behind.
    expect(runtime.market.open().length).toBe(0);
    expect(runtime.ledger.encumbrances.open().length).toBe(0);
  });

  it('the observation publishes the ladder, the reader own orders, and the fee schedule', () => {
    const w = world('smoke-observe', ALICE, BOB);
    const { runtime, venue } = w;
    tick(runtime);
    act(runtime, ALICE, 'trade', {
      operation: 'place',
      venue,
      good: GOOD,
      side: 'ASK',
      quantity: 25,
      limit_price: 17,
    });

    const seen = buildObservation({
      runtime,
      principal: BOB,
      serverNowMs: 0,
      fresh: true,
      wakesRemaining: 16,
      stale: false,
      corrections: [],
      actionsRemaining: 4,
    });
    const market = seen.market;
    const books = market['books'] as { venue: string; good: string; best_ask: number | null; levels: { ask: { price: number; qty: number; orders: number }[] }; mine: unknown[] }[];
    expect(books.length).toBe(1);
    expect(books[0]?.venue).toBe(venue);
    expect(books[0]?.best_ask).toBe(17);
    expect(books[0]?.levels.ask[0]).toEqual({ price: 17, qty: 25, orders: 1 });
    // §11.2: the ladder is PUBLIC, the ownership is PRIVATE. BOB sees the depth and
    // no trace of whose order it is.
    expect(books[0]?.mine, 'a reader was shown another principal as an order owner').toEqual([]);
    expect(JSON.stringify(books)).not.toContain(ALICE);
    // …and ALICE sees its own.
    const mine = runtime.marketView(ALICE, runtime.engine.tick)['mine'] as { order: string }[];
    expect(mine.length).toBe(1);

    expect((market['fees'] as { listing_bond_bps: number }).listing_bond_bps).toBe(0);
    // The local summary is still there and now carries a real price.
    expect(market['best_ask']).toBe(17);
  });
});
