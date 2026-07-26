/**
 * MKT-1 … MKT-7 — each proven to **fire**, not merely to exist.
 *
 * TESTING.md's standing complaint about invariants is that "an invariant nobody
 * implements looks exactly like an invariant that never fires", and wave 1 shipped
 * INV-2 and INV-7 with nine call sites and no test that either ever triggered. So
 * every clause here is driven into its own violation, and the conservation pair is
 * measured against the ledger rather than asserted about the code.
 */

import { describe, expect, it } from 'vitest';
import { minor, qty } from '../../src/core/units.js';
import type { EventId, GoodId } from '../../src/core/types.js';
import { storesAccount } from '../../src/ledger/index.js';
import {
  MarketBook,
  checkMarketInvariants,
  checkMkt1,
  checkMkt2,
  checkMkt3,
  checkMkt4,
  checkMkt5,
  checkMkt6,
  checkMkt7,
  marketEscrowAccount,
} from '../../src/market/index.js';
import { Ledger } from '../../src/ledger/index.js';
import { ALICE, BOB, GOOD, act, order, tick, world } from './fixture.js';

function ids(violations: readonly { id: string }[]): string[] {
  return [...new Set(violations.map((v) => v.id))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

describe('a healthy book violates nothing', () => {
  it('reports no violation over a book that has traded normally', () => {
    const w = world('clean', ALICE, BOB);
    tick(w.runtime);
    act(w.runtime, ALICE, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'ASK',
      quantity: 40,
      limit_price: 10,
    });
    act(w.runtime, BOB, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'BID',
      quantity: 25,
      limit_price: 12,
    });
    tick(w.runtime);
    expect(w.runtime.market.fills().length).toBe(1);
    expect(
      checkMarketInvariants({
        book: w.runtime.market,
        ledger: w.runtime.ledger,
        tick: w.runtime.engine.tick,
      }),
    ).toEqual([]);
  });
});

describe('MKT-1 — escrowed goods never exceed what the open asks owe', () => {
  it('fires when an ask is closed without its escrow being released', () => {
    const w = world('mkt1', ALICE, BOB);
    tick(w.runtime);
    act(w.runtime, ALICE, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'ASK',
      quantity: 30,
      limit_price: 10,
    });
    const open = w.runtime.market.open()[0];
    expect(open).toBeDefined();
    if (open === undefined) return;
    expect(checkMkt1({ book: w.runtime.market, ledger: w.runtime.ledger, tick: 1 })).toEqual([]);

    // The leak: the row leaves the book, the goods do not leave escrow.
    w.runtime.market.close(open.id, 'CANCELLED', 1);
    const found = checkMkt1({ book: w.runtime.market, ledger: w.runtime.ledger, tick: 1 });
    expect(ids(found)).toEqual(['MKT-1']);
    expect(found[0]?.message).toContain('locked behind no order');
    expect(found[0]?.severity).toBe('HALT');
  });

  it('does NOT fire when escrow falls short, because predation is legitimate', () => {
    // The direction of this clause is the design. If it were phrased "escrow always
    // covers the order", a seller whose escrow was legitimately destroyed would halt
    // the world — a false halt, which is the same class as a false default (§15.4).
    const book = new MarketBook();
    const ledger = new Ledger();
    book.add(order({ principal: ALICE, side: 'ASK', price: 10, qty: 50, tick: 0 }));
    // No escrow account exists at all: held = 0, owed = 50. Under-collateralised.
    expect(checkMkt1({ book, ledger, tick: 1 })).toEqual([]);
  });
});

describe('MKT-2 — a bid lock never exceeds remaining x limit', () => {
  it('fires when the remainder shrinks and the lock does not', () => {
    const w = world('mkt2', ALICE, BOB);
    tick(w.runtime);
    act(w.runtime, ALICE, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'BID',
      quantity: 20,
      limit_price: 10,
    });
    const open = w.runtime.market.open()[0];
    if (open === undefined) throw new Error('no order was placed');
    expect(checkMkt2({ book: w.runtime.market, ledger: w.runtime.ledger, tick: 1 })).toEqual([]);

    // 200 is locked; the order now only has 5 left to buy, which needs 50.
    (open as { filled: number }).filled = 15;
    const found = checkMkt2({ book: w.runtime.market, ledger: w.runtime.ledger, tick: 1 });
    expect(ids(found)).toEqual(['MKT-2']);
    expect(found[0]?.message).toContain('needs at most 50');
  });
});

describe('MKT-3 — every open bid has an open lock behind it', () => {
  it('fires on a bid resting with no escrow at all', () => {
    const book = new MarketBook();
    const ledger = new Ledger();
    const naked = order({ principal: ALICE, side: 'BID', price: 10, qty: 5, tick: 0 });
    (naked as { encumbranceId: string | null }).encumbranceId = null;
    book.add(naked);
    const found = checkMkt3({ book, ledger, tick: 1 });
    expect(ids(found)).toEqual(['MKT-3']);
    expect(found[0]?.message).toContain('no escrow at all');
  });

  it('fires on a bid whose named lock is not open', () => {
    const book = new MarketBook();
    const ledger = new Ledger();
    book.add(order({ principal: ALICE, side: 'BID', price: 10, qty: 5, tick: 0 }));
    const found = checkMkt3({ book, ledger, tick: 1 });
    expect(ids(found)).toEqual(['MKT-3']);
    expect(found[0]?.message).toContain('is not open');
  });
});

describe('MKT-4 — every fill reconciles against the posting log', () => {
  it('fires on a fill with no postings at all: goods claimed, nothing moved', () => {
    const book = new MarketBook();
    const ledger = new Ledger();
    book.recordFill({
      id: 'mkt.fill:1:a:b',
      tick: 1,
      venue: 'sys-01' as never,
      good: GOOD,
      unitPrice: minor(10),
      qty: qty(5),
      buyer: BOB,
      seller: ALICE,
      bid: 'a' as never,
      ask: 'b' as never,
      goodsLegs: 1,
    });
    const found = checkMkt4({ book, ledger, tick: 1 });
    expect(ids(found)).toEqual(['MKT-4']);
    expect(found.length).toBe(2); // the currency leg and the goods legs, separately
  });

  it('fires on a torn fill: the goods moved and the money did not', () => {
    const w = world('mkt4-torn', ALICE, BOB);
    tick(w.runtime);
    act(w.runtime, ALICE, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'ASK',
      quantity: 10,
      limit_price: 10,
    });
    act(w.runtime, BOB, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'BID',
      quantity: 10,
      limit_price: 10,
    });
    tick(w.runtime);
    const real = w.runtime.market.fills()[0];
    if (real === undefined) throw new Error('nothing traded');
    const at = real.tick;
    expect(checkMkt4({ book: w.runtime.market, ledger: w.runtime.ledger, tick: at })).toEqual([]);

    // Claim a bigger trade than the postings record. This is the shape of a torn
    // fill, and it is the one failure in this module that would put a permanent lie
    // about who paid whom into an append-only record.
    const lying = new MarketBook();
    lying.recordFill({ ...real, qty: qty(real.qty + 1) });
    const found = checkMkt4({ book: lying, ledger: w.runtime.ledger, tick: at });
    expect(ids(found)).toEqual(['MKT-4']);
  });

  it('passes a real fill, so the check is not merely always-on', () => {
    const w = world('mkt4-clean', ALICE, BOB);
    tick(w.runtime);
    act(w.runtime, ALICE, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'ASK',
      quantity: 7,
      limit_price: 13,
    });
    act(w.runtime, BOB, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'BID',
      quantity: 7,
      limit_price: 13,
    });
    tick(w.runtime);
    const at = w.runtime.market.fills()[0]?.tick ?? 0;
    expect(checkMkt4({ book: w.runtime.market, ledger: w.runtime.ledger, tick: at })).toEqual([]);
  });
});

describe('MKT-5 — no fill outside either limit, and never a self-match', () => {
  it('fires when the price is above the bid limit', () => {
    const book = new MarketBook();
    const ledger = new Ledger();
    const bid = order({ principal: BOB, side: 'BID', price: 10, qty: 5, tick: 0, sequence: 0 });
    const ask = order({ principal: ALICE, side: 'ASK', price: 10, qty: 5, tick: 0, sequence: 1 });
    book.add(bid);
    book.add(ask);
    book.recordFill({
      id: 'f1',
      tick: 1,
      venue: 'sys-01' as never,
      good: GOOD,
      unitPrice: minor(11),
      qty: qty(5),
      buyer: BOB,
      seller: ALICE,
      bid: bid.id,
      ask: ask.id,
      goodsLegs: 0,
    });
    expect(checkMkt5({ book, ledger, tick: 1 }).map((v) => v.message).join(' ')).toContain(
      'against a bid limit of 10',
    );
  });

  it('fires when the price is below the ask limit', () => {
    const book = new MarketBook();
    const ledger = new Ledger();
    const bid = order({ principal: BOB, side: 'BID', price: 20, qty: 5, tick: 0, sequence: 0 });
    const ask = order({ principal: ALICE, side: 'ASK', price: 15, qty: 5, tick: 0, sequence: 1 });
    book.add(bid);
    book.add(ask);
    book.recordFill({
      id: 'f2',
      tick: 1,
      venue: 'sys-01' as never,
      good: GOOD,
      unitPrice: minor(14),
      qty: qty(5),
      buyer: BOB,
      seller: ALICE,
      bid: bid.id,
      ask: ask.id,
      goodsLegs: 0,
    });
    expect(checkMkt5({ book, ledger, tick: 1 }).map((v) => v.message).join(' ')).toContain(
      'against an ask limit of 15',
    );
  });

  it('fires on a print with one principal on both sides, at any price', () => {
    // `ledger/valuation.ts` names this the most dangerous exploit in the game: print
    // a 50x mark against yourself and post the good as a BOND.
    const book = new MarketBook();
    const ledger = new Ledger();
    book.recordFill({
      id: 'f3',
      tick: 1,
      venue: 'sys-01' as never,
      good: GOOD,
      unitPrice: minor(5_000),
      qty: qty(1),
      buyer: ALICE,
      seller: ALICE,
      bid: 'x' as never,
      ask: 'y' as never,
      goodsLegs: 0,
    });
    expect(checkMkt5({ book, ledger, tick: 1 }).map((v) => v.message).join(' ')).toContain(
      'on both sides; a self-match is never a print',
    );
  });
});

describe('MKT-6 — filled never exceeds ordered', () => {
  it('fires on an order filled beyond its quantity', () => {
    const book = new MarketBook();
    const ledger = new Ledger();
    const row = order({ principal: ALICE, side: 'ASK', price: 10, qty: 5, tick: 0 });
    book.add(row);
    expect(checkMkt6({ book, ledger, tick: 1 })).toEqual([]);
    (row as { filled: number }).filled = 6;
    expect(ids(checkMkt6({ book, ledger, tick: 1 }))).toEqual(['MKT-6']);
  });

  it('the book itself refuses an over-fill, so the invariant is the backstop', () => {
    const book = new MarketBook();
    const row = order({ principal: ALICE, side: 'ASK', price: 10, qty: 5, tick: 0 });
    book.add(row);
    expect(() => {
      book.fill(row.id, qty(6));
    }).toThrow(/would exceed its ordered/);
  });
});

describe('MKT-7 — no principal rests on both sides at crossing prices', () => {
  it('fires on a self-crossing pair that reached the book', () => {
    const book = new MarketBook();
    const ledger = new Ledger();
    book.add(order({ principal: ALICE, side: 'BID', price: 12, qty: 5, tick: 0, sequence: 0 }));
    book.add(order({ principal: ALICE, side: 'ASK', price: 10, qty: 5, tick: 0, sequence: 1 }));
    const found = checkMkt7({ book, ledger, tick: 1 });
    expect(ids(found)).toEqual(['MKT-7']);
    expect(found[0]?.message).toContain('crossing prices');
  });

  it('is silent on a two-sided quote that does not cross', () => {
    const book = new MarketBook();
    const ledger = new Ledger();
    book.add(order({ principal: ALICE, side: 'BID', price: 8, qty: 5, tick: 0, sequence: 0 }));
    book.add(order({ principal: ALICE, side: 'ASK', price: 12, qty: 5, tick: 0, sequence: 1 }));
    expect(checkMkt7({ book, ledger, tick: 1 })).toEqual([]);
  });
});

describe('the book conserves goods and cash: every fill is a zero-sum posting pair', () => {
  it('leaves total currency supply and total goods supply exactly unchanged', () => {
    const w = world('conserve', ALICE, BOB);
    const { runtime, venue } = w;
    tick(runtime);

    const currencyBefore = runtime.ledger.currencySupply();
    const goodsBefore = runtime.ledger.goodsSupply().get(GOOD);
    expect(goodsBefore).toBeDefined();

    act(runtime, ALICE, 'trade', {
      operation: 'place',
      venue,
      good: GOOD,
      side: 'ASK',
      quantity: 120,
      limit_price: 7,
    });
    act(runtime, BOB, 'trade', {
      operation: 'place',
      venue,
      good: GOOD,
      side: 'BID',
      quantity: 120,
      limit_price: 9,
    });
    tick(runtime);
    expect(runtime.market.fills().length).toBe(1);

    const currencyAfter = runtime.ledger.currencySupply();
    const goodsAfter = runtime.ledger.goodsSupply().get(GOOD);
    // The market is a transfer engine and nothing else: it has no faucet and no sink.
    expect(currencyAfter.issued).toBe(currencyBefore.issued);
    expect(currencyAfter.retired).toBe(currencyBefore.retired);
    expect(currencyAfter.free + currencyAfter.encumbered + currencyAfter.escrowed).toBe(
      currencyBefore.free + currencyBefore.encumbered + currencyBefore.escrowed,
    );
    expect(goodsAfter?.issued).toBe(goodsBefore?.issued);
    expect(goodsAfter?.retired).toBe(goodsBefore?.retired);
    expect((goodsAfter?.available ?? 0) + (goodsAfter?.escrowed ?? 0)).toBe(
      (goodsBefore?.available ?? 0) + (goodsBefore?.escrowed ?? 0),
    );
  });

  it('every fill posting pair sums to zero, on both ledgers', () => {
    const w = world('zero-sum', ALICE, BOB);
    const { runtime, venue } = w;
    tick(runtime);
    act(runtime, ALICE, 'trade', {
      operation: 'place',
      venue,
      good: GOOD,
      side: 'ASK',
      quantity: 11,
      limit_price: 23,
    });
    act(runtime, BOB, 'trade', {
      operation: 'place',
      venue,
      good: GOOD,
      side: 'BID',
      quantity: 11,
      limit_price: 23,
    });
    tick(runtime);
    const fill = runtime.market.fills()[0];
    if (fill === undefined) throw new Error('nothing traded');

    const cash = runtime.ledger.postingsFor(`${fill.id}:cash` as EventId);
    expect(cash.length).toBe(2);
    expect(cash.reduce((n, p) => n + p.amountMinor, 0)).toBe(0);
    expect(cash.find((p) => p.account === storesAccount(BOB))?.amountMinor).toBe(-(11 * 23));
    expect(cash.find((p) => p.account === storesAccount(ALICE))?.amountMinor).toBe(11 * 23);

    let goodsSum = 0;
    let toBuyer = 0;
    for (let i = 0; i < fill.goodsLegs; i += 1) {
      const leg = runtime.ledger.postingsFor(`${fill.id}:g${String(i)}` as EventId);
      expect(leg.length).toBe(2);
      for (const p of leg) {
        goodsSum += p.amountQty ?? 0;
        if (p.account === storesAccount(BOB)) toBuyer += p.amountQty ?? 0;
        if (p.account === marketEscrowAccount(ALICE)) expect(p.good).toBe<GoodId>(GOOD);
      }
    }
    expect(goodsSum, 'the goods legs did not sum to zero').toBe(0);
    expect(toBuyer).toBe(11);
  });
});
