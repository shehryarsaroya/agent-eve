/**
 * **An aborted tick leaves no order, no fill, and no escrow behind.**
 *
 * The `EncumbranceBook` omission is the worst defect this engine has had: it sat in
 * no state table, so an aborted tick kept its locks, `state_hash` could not see
 * escrow, and a restored world had escrowed stake silently spendable. The market is
 * a strictly larger instance of the same shape — an order *is* a claim on value and
 * there are far more orders than ventures — so this file exists to make the same
 * omission impossible to reintroduce quietly.
 *
 * Three levels, because "it is registered" and "it actually rolls back" are
 * different claims and only the third is about a real tick:
 *
 *   1. the table is registered and has a restore (`rollbackGaps` is empty);
 *   2. capture/restore round-trips a book exactly — this *is* `Engine.abort`, which
 *      is `restoreSnapshot` over the same table set;
 *   3. a tick that actually halts leaves the world exactly as it began.
 */

import { describe, expect, it } from 'vitest';
import { captureSnapshot, restoreSnapshot, rollbackGaps } from '../../src/tick/snapshot.js';
import { storesAccount } from '../../src/ledger/index.js';
import { marketEscrowAccount } from '../../src/market/index.js';
import { ALICE, BOB, GOOD, act, submit, tick, tickAllowingHalt, world } from './fixture.js';

describe('the market is inside state_hash and inside the abort path', () => {
  it('is a registered state table with a restore, so the rollback set has no gap', () => {
    const w = world('registered', ALICE);
    const names = w.runtime.engine.stateTables.map((t) => t.name);
    expect(names, 'the market is not registered, so orders are outside state_hash').toContain('market');
    expect(rollbackGaps(w.runtime.engine.stateTables)).toEqual([]);
  });

  it('an order with NOTHING else changed moves the state hash', () => {
    // The measurement that proves the point. Same seed, same tick count, so every
    // other table is byte-identical; the only difference is that one placed an order.
    const clean = world('hash-clean', ALICE, BOB);
    const dirty = world('hash-clean', ALICE, BOB);
    tick(clean.runtime);
    tick(dirty.runtime);
    const before = clean.runtime.runTick().stateHash;

    act(dirty.runtime, ALICE, 'trade', {
      operation: 'place',
      venue: dirty.venue,
      good: GOOD,
      side: 'BID',
      quantity: 3,
      limit_price: 11,
    });
    const after = dirty.runtime.engine.stateHash;
    expect(before).not.toBe('');
    expect(after, 'two worlds with different books hashed the same').not.toBe(before);
  });

  it('capture and restore round-trip the book exactly, which is what abort does', () => {
    const w = world('roundtrip', ALICE, BOB);
    tick(w.runtime);
    const tables = w.runtime.engine.stateTables;
    const snapshot = captureSnapshot(tables, w.runtime.engine.tick, w.runtime.engine.stateVersion);

    act(w.runtime, ALICE, 'trade', {
      operation: 'place',
      venue: w.venue,
      good: GOOD,
      side: 'ASK',
      quantity: 30,
      limit_price: 10,
    });
    expect(w.runtime.market.open().length).toBe(1);
    expect(w.runtime.ledger.goodsInAccount(marketEscrowAccount(ALICE)).get(GOOD)).toBe(30);

    restoreSnapshot(tables, snapshot);
    expect(w.runtime.market.open().length, 'the order survived the rollback').toBe(0);
    expect(w.runtime.market.all().length).toBe(0);
    expect(w.runtime.market.fills().length).toBe(0);
    expect(
      w.runtime.ledger.goodsInAccount(marketEscrowAccount(ALICE)).get(GOOD) ?? 0,
      'escrowed goods survived the rollback',
    ).toBe(0);
    expect(captureSnapshot(tables, snapshot.tick, snapshot.stateVersion).stateHash).toBe(snapshot.stateHash);
  });

  it('a restored book keeps its fills, because the mark is derived from them', () => {
    // A rollback that dropped the print history would let a restored world value a
    // good differently — and a valuation is what a BOND is sized from, i.e. custody
    // of someone else's assets.
    const w = world('roundtrip-fills', ALICE, BOB);
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
    expect(w.runtime.market.fills().length).toBe(1);

    const tables = w.runtime.engine.stateTables;
    const snapshot = captureSnapshot(tables, w.runtime.engine.tick, w.runtime.engine.stateVersion);
    restoreSnapshot(tables, snapshot);
    expect(w.runtime.market.fills().length).toBe(1);
    expect(w.runtime.market.prints()[0]?.unitPrice).toBe(10);
  });
});

describe('a tick that halts leaves nothing of itself behind', () => {
  it('rolls back the order placed in the halting tick, and its escrow with it', () => {
    const w = world('abort', ALICE, BOB);
    const { runtime, venue } = w;
    tick(runtime);

    // A resting ask, from an earlier tick, so it is part of the pre-tick world.
    act(runtime, ALICE, 'trade', {
      operation: 'place',
      venue,
      good: GOOD,
      side: 'ASK',
      quantity: 20,
      limit_price: 10,
    });
    const resting = runtime.market.open()[0];
    expect(resting).toBeDefined();
    if (resting === undefined) return;

    const bobCashBefore = runtime.ledger.freeBalance(storesAccount(BOB));
    const openBefore = runtime.market.open().length;
    const fillsBefore = runtime.market.fills().length;
    const locksBefore = runtime.ledger.encumbrances.open().length;

    // BOB's crossing bid is queued but has not resolved: escrow is taken in
    // VALIDATE+LOCK, inside the tick this test is about to abort.
    submit(runtime, BOB, 'trade', {
      operation: 'place',
      venue,
      good: GOOD,
      side: 'BID',
      quantity: 20,
      limit_price: 12,
    });

    // Plant a corruption the ASSERT phase must refuse. `filled` beyond `quantity` is
    // MKT-6, and it is planted BEFORE the tick so the tick's own snapshot contains
    // it — which is the point: what must be rolled back is everything the tick did,
    // not the state it started from.
    (resting as { filled: number }).filled = resting.quantity + 5;

    const report = tickAllowingHalt(runtime);
    expect(report.halted, 'a book with a filled-beyond-ordered row did not halt the tick').toBe(true);
    expect(report.violations.some((v) => v.id === 'MKT-6')).toBe(true);

    // Nothing the tick did survives.
    expect(runtime.market.openFor(BOB).length, 'the aborted tick left an order behind').toBe(0);
    expect(runtime.market.open().length).toBe(openBefore);
    expect(runtime.market.fills().length, 'the aborted tick left a fill behind').toBe(fillsBefore);
    expect(
      runtime.ledger.freeBalance(storesAccount(BOB)),
      'the aborted tick left escrow behind: cash is still locked for an order that does not exist',
    ).toBe(bobCashBefore);
    expect(runtime.ledger.encumbrances.open().length).toBe(locksBefore);
  });
});
