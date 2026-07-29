/**
 * UNIT-L1..n and INV-1 — postings, lots, faucet/sink accounting, and the form rule.
 *
 * INV-1: every value-moving event produces ≥2 postings summing to zero, or exactly
 * one ISSUE/RETIRE against a **named** faucet/sink. The accept and reject paths are
 * both tested through `Ledger.apply`, which is the same door the game uses — an
 * invariant tested only through its own checker is an invariant that can drift away
 * from the engine, which is scar #1's shape.
 */

import { describe, expect, it } from 'vitest';
import { minor, qty } from '../../src/core/units.js';
import type { AccountId, EventId, GoodId, PrincipalId } from '../../src/core/types.js';
import {
  CURRENCY_FAUCET,
  CURRENCY_SINK,
  GOODS_FAUCET,
  GOODS_SINK,
  Ledger,
  LedgerError,
  NAMED_SUPPLY_ACCOUNTS,
  checkInv1,
  checkInv7,
  compareIds,
  lotId,
  openStores,
  postingLedger,
  qtyDelta,
  storesAccount,
} from '../../src/ledger/index.js';
import {
  A_STORES,
  ALICE,
  B_STORES,
  BOB,
  HAUL_ESCROW,
  HOME,
  ORE,
  REACH,
  emptyWorld,
  ev,
  fund,
  mine,
} from './fixture.js';

describe('UNIT-L1 accounts', () => {
  it('opens the named faucets and sinks at construction and nothing else', () => {
    const l = new Ledger();
    for (const n of NAMED_SUPPLY_ACCOUNTS) {
      expect(l.account(n.id)?.kind).toBe(n.kind);
      expect(l.account(n.id)?.name).toBe(n.name);
    }
    // The two currency faucets in SPEC §10.2, and no third one.
    const currencyFaucets = NAMED_SUPPLY_ACCOUNTS.filter(
      (a) => a.kind === 'FAUCET' && a.ledger === 'CURRENCY',
    );
    expect(currencyFaucets.map((a) => a.id).sort(compareIds)).toEqual(
      [CURRENCY_FAUCET.CIVIC_PROCUREMENT, CURRENCY_FAUCET.STARTER_STAKE].sort(compareIds),
    );
  });

  it('refuses a duplicate account', () => {
    const l = new Ledger();
    openStores(l, ALICE);
    expect(() => openStores(l, ALICE)).toThrow(LedgerError);
  });

  it('rejects an ISSUE from an account that is not a named faucet', () => {
    const l = new Ledger();
    openStores(l, ALICE);
    openStores(l, BOB);
    expect(() =>
      l.issueCurrency({ eventId: ev('rogue'), tick: 0, faucet: B_STORES, to: A_STORES, amount: minor(1) }),
    ).toThrow(/not a named faucet or sink|is a STORES, not a FAUCET/);
  });

  it('rejects minting currency from a goods faucet — two ledgers, strictly separated', () => {
    const l = new Ledger();
    openStores(l, ALICE);
    expect(() =>
      l.issueCurrency({
        eventId: ev('crossed'),
        tick: 0,
        faucet: GOODS_FAUCET.EXTRACTION,
        to: A_STORES,
        amount: minor(500),
      }),
    ).toThrow(/GOODS FAUCET .* carries a CURRENCY posting/);
  });
});

describe('INV-1 posting form', () => {
  it('accepts a transfer as two postings summing to zero', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(1_000));
    f.ledger.transferCurrency({
      eventId: ev('pay'),
      tick: 1,
      from: A_STORES,
      to: B_STORES,
      amount: minor(400),
    });
    const postings = f.ledger.postingsFor(ev('pay'));
    expect(postings).toHaveLength(2);
    expect(postings.reduce((a, p) => a + p.amountMinor, 0)).toBe(0);
    expect(checkInv1(f.ledger, 1)).toEqual([]);
  });

  it('accepts exactly one posting when it is an ISSUE against a named faucet', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(700), ev('issue'));
    const postings = f.ledger.postingsFor(ev('issue'));
    expect(postings).toHaveLength(1);
    expect(f.ledger.balance(A_STORES)).toBe(700);
    // The faucet runs negative by what it issued. That sign convention is what
    // makes INV-2 pure arithmetic rather than a bookkeeping convention.
    expect(f.ledger.balance(CURRENCY_FAUCET.STARTER_STAKE)).toBe(-700);
    expect(checkInv1(f.ledger, 0)).toEqual([]);
  });

  it('accepts exactly one posting when it is a RETIRE against a named sink', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(700));
    f.ledger.retireCurrency({
      eventId: ev('fee'),
      tick: 2,
      sink: CURRENCY_SINK.FEES,
      from: A_STORES,
      amount: minor(50),
    });
    expect(f.ledger.balance(A_STORES)).toBe(650);
    expect(f.ledger.balance(CURRENCY_SINK.FEES)).toBe(50);
    expect(checkInv1(f.ledger, 2)).toEqual([]);
  });

  it('rejects a single posting with no named faucet or sink — an unbalanced mint', () => {
    const f = emptyWorld();
    expect(() =>
      f.ledger.apply({
        eventId: ev('freeMoney'),
        tick: 0,
        kind: 'TRANSFER',
        postings: [{ account: A_STORES, good: null, amountMinor: minor(9_999), amountQty: null }],
        supply: null,
        opens: [],
        deltas: [],
      }),
    ).toThrow(/INV-1/);
    expect(f.ledger.balance(A_STORES)).toBe(0);
  });

  it('rejects postings that do not sum to zero', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(1_000));
    expect(() =>
      f.ledger.apply({
        eventId: ev('skim'),
        tick: 0,
        kind: 'TRANSFER',
        postings: [
          { account: A_STORES, good: null, amountMinor: minor(-100), amountQty: null },
          { account: B_STORES, good: null, amountMinor: minor(150), amountQty: null },
        ],
        supply: null,
        opens: [],
        deltas: [],
      }),
    ).toThrow(/currency residue 50/);
  });

  it('rejects a posting against a faucet — supply has one home', () => {
    const f = emptyWorld();
    expect(() =>
      f.ledger.apply({
        eventId: ev('direct'),
        tick: 0,
        kind: 'TRANSFER',
        postings: [
          { account: CURRENCY_FAUCET.STARTER_STAKE, good: null, amountMinor: minor(-5), amountQty: null },
          { account: A_STORES, good: null, amountMinor: minor(5), amountQty: null },
        ],
        supply: null,
        opens: [],
        deltas: [],
      }),
    ).toThrow(/targets FAUCET account/);
  });

  it('rejects an ISSUE that decreases a world account, and a RETIRE that increases one', () => {
    const f = emptyWorld();
    expect(() =>
      f.ledger.apply({
        eventId: ev('backwards'),
        tick: 0,
        kind: 'ISSUE',
        postings: [{ account: A_STORES, good: null, amountMinor: minor(-5), amountQty: null }],
        supply: { direction: 'ISSUE', account: CURRENCY_FAUCET.STARTER_STAKE },
        opens: [],
        deltas: [],
      }),
    ).toThrow(/must increase a world account/);
    expect(() =>
      f.ledger.apply({
        eventId: ev('backwards2'),
        tick: 0,
        kind: 'RETIRE',
        postings: [{ account: A_STORES, good: null, amountMinor: minor(5), amountQty: null }],
        supply: { direction: 'RETIRE', account: CURRENCY_SINK.FEES },
        opens: [],
        deltas: [],
      }),
    ).toThrow(/must decrease a world account/);
  });

  it('rejects an ISSUE carrying more than one posting', () => {
    const f = emptyWorld();
    expect(() =>
      f.ledger.apply({
        eventId: ev('twoLegged'),
        tick: 0,
        kind: 'ISSUE',
        postings: [
          { account: A_STORES, good: null, amountMinor: minor(5), amountQty: null },
          { account: B_STORES, good: null, amountMinor: minor(5), amountQty: null },
        ],
        supply: { direction: 'ISSUE', account: CURRENCY_FAUCET.STARTER_STAKE },
        opens: [],
        deltas: [],
      }),
    ).toThrow(/permits exactly one against a named faucet\/sink/);
  });

  it('rejects a posting that is neither a clean currency leg nor a clean goods leg', () => {
    const f = emptyWorld();
    const mixed = {
      account: A_STORES,
      good: ORE,
      amountMinor: minor(100),
      amountQty: qtyDelta(5),
    };
    expect(postingLedger(mixed)).toBeNull();
    expect(() =>
      f.ledger.apply({
        eventId: ev('mixed'),
        tick: 0,
        kind: 'TRANSFER',
        postings: [mixed, { account: B_STORES, good: ORE, amountMinor: minor(-100), amountQty: qtyDelta(-5) }],
        supply: null,
        opens: [],
        deltas: [],
      }),
    ).toThrow(/neither a currency leg .* nor a goods leg/);
  });

  it('rejects a posting that moves nothing', () => {
    const f = emptyWorld();
    expect(() =>
      f.ledger.apply({
        eventId: ev('noop'),
        tick: 0,
        kind: 'TRANSFER',
        postings: [
          { account: A_STORES, good: null, amountMinor: minor(0), amountQty: null },
          { account: B_STORES, good: null, amountMinor: minor(0), amountQty: null },
        ],
        supply: null,
        opens: [],
        deltas: [],
      }),
    ).toThrow(/moves no value/);
  });
});

describe('UNIT-L2 lots', () => {
  it('sources goods into a located lot and counts them once', () => {
    const f = emptyWorld();
    const id = mine(f, A_STORES, ALICE, ORE, qty(30), ev('dig'));
    const lot = f.ledger.requireLot(id);
    expect(lot).toMatchObject({ account: A_STORES, good: ORE, qty: 30, location: HOME, state: 'AVAILABLE' });
    expect(lot.origin).toBe(ALICE);
    expect(f.ledger.goodsInAccount(A_STORES).get(ORE)).toBe(30);
    expect(f.ledger.goodsSupply().get(ORE)).toMatchObject({ available: 30, issued: 30, retired: 0 });
    expect(checkInv7(f.ledger, 0)).toEqual([]);
  });

  it('moves goods by shrinking the source lot and opening a new one, preserving provenance', () => {
    const f = emptyWorld();
    const src = mine(f, A_STORES, ALICE, ORE, qty(30), ev('dig'));
    const dst = f.ledger.transferGoods({ eventId: ev('haul'), tick: 1, lotId: src, to: B_STORES, qty: qty(12) });
    expect(f.ledger.requireLot(src).qty).toBe(18);
    const moved = f.ledger.requireLot(dst);
    expect(moved.qty).toBe(12);
    // Provenance survives the move: the head of the lot's history is who made it.
    expect(moved.origin).toBe(ALICE);
    expect(moved.location).toBe(HOME);
    expect(checkInv7(f.ledger, 1)).toEqual([]);
  });

  it('deletes an emptied lot rather than keeping a zero row forever (scar #3)', () => {
    const f = emptyWorld();
    const src = mine(f, A_STORES, ALICE, ORE, qty(10), ev('dig'));
    f.ledger.transferGoods({ eventId: ev('all'), tick: 1, lotId: src, to: B_STORES, qty: qty(10) });
    expect(f.ledger.lot(src)).toBeUndefined();
    expect(f.ledger.allLots()).toHaveLength(1);
  });

  it('relocating a lot moves no value and writes no posting', () => {
    const f = emptyWorld();
    const src = mine(f, A_STORES, ALICE, ORE, qty(10), ev('dig'));
    const before = f.ledger.allPostings().length;
    f.ledger.relocate(src, { location: REACH, state: 'IN_TRANSIT' });
    expect(f.ledger.allPostings()).toHaveLength(before);
    expect(f.ledger.goodsSupply().get(ORE)).toMatchObject({ available: 0, inTransit: 10, issued: 10 });
  });

  it('refuses a goods batch whose postings and lots disagree — INV-7 at write time', () => {
    const f = emptyWorld();
    const src = mine(f, A_STORES, ALICE, ORE, qty(10), ev('dig'));
    expect(() =>
      f.ledger.apply({
        eventId: ev('phantom'),
        tick: 1,
        kind: 'TRANSFER',
        postings: [
          { account: A_STORES, good: ORE, amountMinor: minor(0), amountQty: qtyDelta(-4) },
          { account: B_STORES, good: ORE, amountMinor: minor(0), amountQty: qtyDelta(4) },
        ],
        supply: null,
        // The destination lot is opened but the source lot is never decremented:
        // the ore now exists twice. This is scar #5 in one batch.
        opens: [
          {
            id: lotId(ev('phantom'), 0),
            account: B_STORES,
            good: ORE,
            qty: qty(4),
            location: HOME,
            state: 'AVAILABLE',
            carrier: null,
            origin: ALICE,
          },
        ],
        deltas: [],
      }),
    ).toThrow(/INV-7/);
    expect(f.ledger.requireLot(src).qty).toBe(10);
  });
});

describe('UNIT-L3 faucet and sink accounting', () => {
  it('tracks goods issuance and retirement per good, as magnitudes', () => {
    const f = emptyWorld();
    const id = mine(f, A_STORES, ALICE, ORE, qty(25), ev('dig'));
    f.ledger.destroyGoods({ eventId: ev('burn'), tick: 3, sink: GOODS_SINK.LOSS, lotId: id, qty: qty(10) });
    expect(f.ledger.account(GOODS_FAUCET.EXTRACTION)?.movedQty.get(ORE)).toBe(25);
    expect(f.ledger.account(GOODS_SINK.LOSS)?.movedQty.get(ORE)).toBe(10);
    expect(f.ledger.goodsSupply().get(ORE)).toMatchObject({ available: 15, issued: 25, retired: 10 });
    expect(checkInv7(f.ledger, 3)).toEqual([]);
  });

  it('a faucet only ever issues and a sink only ever retires', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(500));
    f.ledger.retireCurrency({
      eventId: ev('upkeep'),
      tick: 1,
      sink: CURRENCY_SINK.UPKEEP,
      from: A_STORES,
      amount: minor(200),
    });
    expect(f.ledger.currencySupply()).toMatchObject({ issued: 500, retired: 200 });
    expect(f.ledger.balance(CURRENCY_FAUCET.STARTER_STAKE)).toBeLessThan(0);
    expect(f.ledger.balance(CURRENCY_SINK.UPKEEP)).toBeGreaterThan(0);
  });
});

describe('UNIT-L4 the escrow account', () => {
  it('escrowed value leaves stores and lands in escrow, still inside supply', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(10_000));
    f.ledger.transferCurrency({
      eventId: ev('escrowIn'),
      tick: 1,
      from: A_STORES,
      to: HAUL_ESCROW,
      amount: minor(3_000),
    });
    const s = f.ledger.currencySupply();
    expect(s.escrowed).toBe(3_000);
    expect(s.free).toBe(7_000);
    expect(s.free + s.encumbered + s.escrowed).toBe(s.issued - s.retired);
  });
});

describe('DET-1 the ledger hashes deterministically', () => {
  it('two identically-built ledgers produce the same state hash', () => {
    const build = (): Ledger => {
      const l = new Ledger();
      const a: AccountId = storesAccount('p1' as PrincipalId);
      const b: AccountId = storesAccount('p2' as PrincipalId);
      l.openAccount(a, 'STORES', 'p1' as PrincipalId);
      l.openAccount(b, 'STORES', 'p2' as PrincipalId);
      l.issueCurrency({
        eventId: 'e1' as EventId,
        tick: 0,
        faucet: CURRENCY_FAUCET.STARTER_STAKE,
        to: a,
        amount: minor(1_234),
      });
      l.sourceGoods({
        eventId: 'e2' as EventId,
        tick: 0,
        faucet: GOODS_FAUCET.EXTRACTION,
        to: a,
        good: 'g' as GoodId,
        qty: qty(7),
        location: HOME,
        origin: 'p1' as PrincipalId,
      });
      l.transferCurrency({ eventId: 'e3' as EventId, tick: 1, from: a, to: b, amount: minor(34) });
      return l;
    };
    expect(build().stateHash()).toBe(build().stateHash());
    expect(build().stateHash()).toHaveLength(64);
  });
});
