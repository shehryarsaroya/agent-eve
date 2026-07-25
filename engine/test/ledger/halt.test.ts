/**
 * The `ASSERT` phase — what happens when the value group fails.
 *
 * SPEC §15.2: *"On assertion failure: abort the tick and halt. Never publish a
 * broken tick."* So `assertLedgerInvariants` throws rather than returning, and the
 * exception carries every violation with `severity: 'HALT'` — the caller's only
 * correct response is to abort and enter `PAUSED`, and it needs the whole list to
 * put in the operator's hands, not the first one.
 */

import { describe, expect, it } from 'vitest';
import { minor, qty } from '../../src/core/units.js';
import {
  LedgerHalt,
  assertLedgerInvariants,
  checkInv2,
  checkLedgerInvariants,
  emptyObligationBook,
} from '../../src/ledger/index.js';
import { A_STORES, ALICE, B_STORES, HAUL_1, ORE, REACH, emptyWorld, ev, fund, mine } from './fixture.js';

describe('assertLedgerInvariants', () => {
  it('is silent on a healthy ledger', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(1_000));
    mine(f, A_STORES, ALICE, ORE, qty(10), ev('dig'));
    f.ledger.transferCurrency({ eventId: ev('pay'), tick: 1, from: A_STORES, to: B_STORES, amount: minor(250) });
    expect(() => assertLedgerInvariants(f.ledger, { tick: 1, obligations: f.obligations })).not.toThrow();
  });

  it('throws LedgerHalt carrying every violation, each marked HALT', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(1_000));
    f.obligations.open(HAUL_1);
    f.ledger.encumbrances.lock({
      eventId: 'l1',
      tick: 1,
      principal: ALICE,
      account: A_STORES,
      amountMinor: minor(400),
      obligationRef: HAUL_1,
      maxDirectLoss: minor(400),
    });
    // An empty obligation book: every open lock is now an orphan (INV-4).
    let caught: unknown;
    try {
      assertLedgerInvariants(f.ledger, { tick: 2, obligations: emptyObligationBook() });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(LedgerHalt);
    const halt = caught as LedgerHalt;
    expect(halt.violations.length).toBeGreaterThan(0);
    expect(halt.violations.every((x) => x.severity === 'HALT')).toBe(true);
    expect(halt.violations.every((x) => x.tick === 2)).toBe(true);
    expect(halt.message).toContain('INV-4');
  });
});

describe('INV-2 counts in-transit cargo exactly once', () => {
  it('conserves a good while it is moving between systems', () => {
    const f = emptyWorld();
    const lot = mine(f, A_STORES, ALICE, ORE, qty(40), ev('dig'));
    // A convoy departs. The cargo is not in the origin's available stores any more,
    // and it has not arrived anywhere: it is in transit, and it is still in supply.
    f.ledger.relocate(lot, { state: 'IN_TRANSIT', location: REACH });
    const g = f.ledger.goodsSupply().get(ORE);
    expect(g).toMatchObject({ available: 0, inTransit: 40, escrowed: 0, issued: 40, retired: 0 });
    expect(checkInv2(f.ledger, 3)).toEqual([]);

    // It arrives. Nothing was created and nothing destroyed by the journey.
    f.ledger.relocate(lot, { state: 'AVAILABLE' });
    expect(f.ledger.goodsSupply().get(ORE)).toMatchObject({ available: 40, inTransit: 0 });
    expect(checkLedgerInvariants(f.ledger, { tick: 4, obligations: f.obligations })).toEqual([]);
  });
});
