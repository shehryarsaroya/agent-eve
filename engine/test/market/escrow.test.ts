/**
 * Full escrow, both sides, or the order is refused — and a cancel gives back
 * **exactly** what was locked.
 *
 * This is the market's A15 surface. Unescrowed liquidity is free to create, so a
 * book that allowed it would price depth in identities: one keypair paints a wall
 * of bids it never intends to honour, moves the mark, and posts the printed good as
 * a BOND. `ledger/valuation.ts` defends the *mark* against that; these tests are
 * about the fake depth never existing in the first place.
 */

import { describe, expect, it } from 'vitest';
import { storesAccount } from '../../src/ledger/index.js';
import { marketEscrowAccount, sellableGoods } from '../../src/market/index.js';
import { ALICE, BOB, GOOD, act, tick, world } from './fixture.js';

function freeCashOf(w: ReturnType<typeof world>, who: string): number {
  return w.runtime.ledger.freeBalance(storesAccount(who as never));
}

function escrowedGoodsOf(w: ReturnType<typeof world>, who: string): number {
  const account = marketEscrowAccount(who as never);
  if (w.runtime.ledger.account(account) === undefined) return 0;
  return w.runtime.ledger.goodsInAccount(account).get(GOOD) ?? 0;
}

describe('a buy order escrows the maximum cash', () => {
  it('locks quantity x limit_price the moment it is accepted', () => {
    const w = world('bid-escrow', ALICE);
    tick(w.runtime);
    const before = freeCashOf(w, ALICE);
    expect(
      act(w.runtime, ALICE, 'trade', {
        operation: 'place',
        venue: w.venue,
        good: GOOD,
        side: 'BID',
        quantity: 12,
        limit_price: 37,
      }),
    ).toBeNull();
    expect(before - freeCashOf(w, ALICE)).toBe(12 * 37);
    // The BALANCE is untouched — a lock is a claim on value, never a transfer.
    expect(w.runtime.ledger.balance(storesAccount(ALICE))).toBe(before);
  });

  it('refuses an order it cannot escrow, and places nothing at all', () => {
    const w = world('bid-broke', ALICE);
    tick(w.runtime);
    const before = freeCashOf(w, ALICE);
    const refusal = act(w.runtime, ALICE, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'BID',
      quantity: 1_000_000,
      limit_price: 1_000,
    });
    expect(refusal?.invariant).toBe('A7');
    expect(refusal?.hint).toContain('refused rather than half-placed');
    expect(w.runtime.market.open().length, 'a refused order was half-placed').toBe(0);
    expect(freeCashOf(w, ALICE), 'a refused order took escrow anyway').toBe(before);
    expect(w.runtime.ledger.encumbrances.open().length).toBe(0);
  });

  it('the escrow is EXPOSURE-free, because a limit order cannot lose money', () => {
    // §3: EXPOSURE is the sum of open `max_direct_loss` and NOTHING else. A buy at a
    // price you chose either buys goods or gives the cash back; charging EXPOSURE for
    // it would inflate the number that gates Commons capacity and the Levy.
    const w = world('bid-exposure', ALICE);
    tick(w.runtime);
    act(w.runtime, ALICE, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'BID',
      quantity: 10,
      limit_price: 50,
    });
    expect(w.runtime.ledger.encumbrances.open().length).toBe(1);
    expect(w.runtime.ledger.encumbrances.cachedExposure(ALICE)).toBe(0);
    expect(w.runtime.ledger.encumbrances.recomputeExposure(ALICE)).toBe(0);
  });
});

describe('a sell order escrows the goods', () => {
  it('moves the goods out of STORES into the market escrow at that venue', () => {
    const w = world('ask-escrow', ALICE);
    tick(w.runtime);
    const before = sellableGoods(w.runtime.ledger, ALICE, GOOD, w.venue);
    expect(before).toBeGreaterThan(100);
    expect(
      act(w.runtime, ALICE, 'trade', {
        operation: 'place',
        venue: w.venue,
        good: GOOD,
        side: 'ASK',
        quantity: 60,
        limit_price: 9,
      }),
    ).toBeNull();
    expect(sellableGoods(w.runtime.ledger, ALICE, GOOD, w.venue)).toBe(before - 60);
    expect(escrowedGoodsOf(w, ALICE)).toBe(60);
  });

  it('escrowed goods cannot be spent twice — the Levy cannot draw on them', () => {
    // The whole point of moving them out of STORES rather than tagging them: every
    // other consumer of a principal's goods reads the STORES lots, so the escrow is
    // exclusive by construction rather than by everyone remembering to filter.
    const w = world('ask-exclusive', ALICE);
    tick(w.runtime);
    const before = w.runtime.levyGoodAvailable(ALICE);
    act(w.runtime, ALICE, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'ASK',
      quantity: 500,
      limit_price: 9,
    });
    expect(w.runtime.levyGoodAvailable(ALICE)).toBe(before - 500);
  });

  it('refuses a sale of goods that are not there, and escrows nothing', () => {
    const w = world('ask-empty', ALICE, BOB);
    tick(w.runtime);
    const refusal = act(w.runtime, ALICE, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'ASK',
      quantity: 900_000,
      limit_price: 9,
    });
    expect(refusal?.invariant).toBe('A7');
    // The DOOR's own sentence, not merely the axiom. `escrowGoods` refuses a short
    // draw too, so asserting only `A7` would leave the affordability check itself
    // uncovered — a mutation deleting it stayed green until this line existed, and a
    // check nothing covers is a check that will be deleted by someone tidying up.
    expect(refusal?.hint).toContain('a sell order escrows the goods');
    expect(refusal?.hint).toContain('neither pledged nor in transit');
    expect(escrowedGoodsOf(w, ALICE)).toBe(0);
    expect(w.runtime.market.open().length).toBe(0);
  });
});

describe('a cancel releases exactly what the order locked', () => {
  it('gives a bid its whole lock back, to the unit', () => {
    const w = world('cancel-bid', ALICE);
    tick(w.runtime);
    const before = freeCashOf(w, ALICE);
    act(w.runtime, ALICE, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'BID',
      quantity: 13,
      limit_price: 41,
    });
    const id = w.runtime.market.open()[0]?.id;
    expect(id).toBeDefined();
    expect(freeCashOf(w, ALICE)).toBe(before - 13 * 41);

    expect(act(w.runtime, ALICE, 'trade', { operation: 'cancel', order: id }, 1)).toBeNull();
    expect(freeCashOf(w, ALICE), 'a cancel did not return exactly what it locked').toBe(before);
    expect(w.runtime.ledger.encumbrances.open().length).toBe(0);
    expect(w.runtime.market.open().length).toBe(0);
  });

  it('gives an ask its goods back, at the same venue', () => {
    const w = world('cancel-ask', ALICE);
    tick(w.runtime);
    const before = sellableGoods(w.runtime.ledger, ALICE, GOOD, w.venue);
    act(w.runtime, ALICE, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'ASK',
      quantity: 77,
      limit_price: 9,
    });
    const id = w.runtime.market.open()[0]?.id;
    act(w.runtime, ALICE, 'trade', { operation: 'cancel', order: id }, 1);
    expect(sellableGoods(w.runtime.ledger, ALICE, GOOD, w.venue)).toBe(before);
    expect(escrowedGoodsOf(w, ALICE)).toBe(0);
  });

  it('a partly filled order returns only its remainder — the filled part was never its own to give back', () => {
    const w = world('cancel-partial', ALICE, BOB);
    tick(w.runtime);
    // BOB rests a 20-unit ask; ALICE bids for 50 and takes what is there.
    act(w.runtime, BOB, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'ASK',
      quantity: 20,
      limit_price: 10,
    });
    const cashBefore = freeCashOf(w, ALICE);
    act(w.runtime, ALICE, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'BID',
      quantity: 50,
      limit_price: 10,
    });
    expect(cashBefore - freeCashOf(w, ALICE)).toBe(500);
    tick(w.runtime); // matches 20 at 10

    const mine = w.runtime.market.openFor(ALICE)[0];
    expect(mine?.filled).toBe(20);
    // 200 was spent; 300 is still locked behind the 30 that are still working.
    expect(cashBefore - freeCashOf(w, ALICE)).toBe(500);
    expect(w.runtime.ledger.balance(storesAccount(ALICE))).toBe(cashBefore - 200);

    act(w.runtime, ALICE, 'trade', { operation: 'cancel', order: mine?.id }, 1);
    // Everything not spent comes back, and not one unit more.
    expect(freeCashOf(w, ALICE)).toBe(cashBefore - 200);
  });

  it('a partly filled ASK returns exactly its remainder, in goods', () => {
    // The mirror of the bid case, and the one a mutation slipped through: releasing
    // `quantity` instead of `remaining` asks the escrow for more than is in it, the
    // draw plan refuses, and the seller gets NOTHING back — its goods stranded in an
    // escrow account behind an order that no longer exists.
    const w = world('cancel-ask-partial', ALICE, BOB);
    tick(w.runtime);
    const before = sellableGoods(w.runtime.ledger, ALICE, GOOD, w.venue);
    act(w.runtime, ALICE, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'ASK',
      quantity: 50,
      limit_price: 10,
    });
    act(w.runtime, BOB, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'BID',
      quantity: 20,
      limit_price: 10,
    });
    tick(w.runtime); // 20 of the 50 trade

    const mine = w.runtime.market.openFor(ALICE)[0];
    expect(mine?.filled).toBe(20);
    expect(escrowedGoodsOf(w, ALICE)).toBe(30);
    act(w.runtime, ALICE, 'trade', { operation: 'cancel', order: mine?.id }, 1);
    expect(escrowedGoodsOf(w, ALICE), 'the remainder was stranded in escrow').toBe(0);
    expect(
      sellableGoods(w.runtime.ledger, ALICE, GOOD, w.venue),
      'a cancel returned something other than exactly the remainder',
    ).toBe(before - 20);
  });

  it('refuses to cancel another principal order', () => {
    const w = world('cancel-thief', ALICE, BOB);
    tick(w.runtime);
    act(w.runtime, ALICE, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'BID',
      quantity: 4,
      limit_price: 10,
    });
    const id = w.runtime.market.open()[0]?.id;
    const refusal = act(w.runtime, BOB, 'trade', { operation: 'cancel', order: id });
    expect(refusal?.hint).toContain('not yours');
    expect(w.runtime.market.open().length).toBe(1);
  });
});

describe('one principal may never be both sides of a print', () => {
  it('refuses an order that would cross the principal own resting order', () => {
    const w = world('self-cross', ALICE);
    tick(w.runtime);
    act(w.runtime, ALICE, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'BID',
      quantity: 5,
      limit_price: 12,
    });
    const refusal = act(
      w.runtime,
      ALICE,
      'trade',
      { operation: 'place', venue: w.venue, good: GOOD, side: 'ASK', quantity: 5, limit_price: 10 },
      1,
    );
    expect(refusal?.invariant).toBe('A15');
    expect(refusal?.hint).toContain('both sides of a print');
    expect(w.runtime.market.openFor(ALICE).length).toBe(1);
  });

  it('allows the same principal on both sides at prices that do not cross', () => {
    // Market-making by one principal is legitimate: quote a spread, take neither
    // side of your own quote. Refusing this would delete a whole strategy.
    const w = world('self-spread', ALICE);
    tick(w.runtime);
    act(w.runtime, ALICE, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'BID',
      quantity: 5,
      limit_price: 8,
    });
    expect(
      act(
        w.runtime,
        ALICE,
        'trade',
        { operation: 'place', venue: w.venue, good: GOOD, side: 'ASK', quantity: 5, limit_price: 12 },
        1,
      ),
    ).toBeNull();
    expect(w.runtime.market.openFor(ALICE).length).toBe(2);
    tick(w.runtime);
    expect(w.runtime.market.fills().length, 'a principal traded with itself').toBe(0);
  });
});

describe('the book is location-bound', () => {
  it('refuses a trade at a venue the principal has no hand at', () => {
    const w = world('remote', ALICE);
    tick(w.runtime);
    const elsewhere = [...w.runtime.world.map.systems.keys()].find((s) => s !== w.venue);
    expect(elsewhere).toBeDefined();
    const refusal = act(w.runtime, ALICE, 'trade', {
      operation: 'place',
      venue: elsewhere,
      good: GOOD,
      side: 'BID',
      quantity: 2,
      limit_price: 10,
    });
    expect(refusal?.hint).toContain('no hand standing at');
  });

  it('two venues are two books and never cross', () => {
    const w = world('two-books', ALICE, BOB);
    const { runtime } = w;
    tick(runtime);
    const other = [...runtime.world.map.systems.keys()].find((s) => s !== w.venue);
    expect(other).toBeDefined();
    if (other === undefined) return;
    // ALICE sells here; BOB is moved there and bids there. They must not meet.
    act(runtime, ALICE, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'ASK',
      quantity: 10,
      limit_price: 5,
    });
    // No hand there yet, so BOB's remote bid is refused outright — which is itself
    // the geography rule biting.
    const refusal = act(runtime, BOB, 'trade', {
      operation: 'place',
      venue: other,
      good: GOOD,
      side: 'BID',
      quantity: 10,
      limit_price: 50,
    });
    expect(refusal).not.toBeNull();
    tick(runtime);
    expect(runtime.market.fills().length).toBe(0);
    expect(runtime.market.books().length).toBe(1);
  });
});
