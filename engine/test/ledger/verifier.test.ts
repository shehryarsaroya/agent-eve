/**
 * Adversarial verification pass over the ledger module.
 *
 * Two kinds of test live here, and the distinction is deliberate:
 *
 *   1. **Coverage the module claimed and did not have.** `checkInv7` and `checkInv2`
 *      were asserted to return `[]` in nine places and were never once shown to
 *      *fire*. An invariant whose detection direction is untested is an assertion
 *      nobody has checked is wired up — and INV-7 is the one that exists to catch
 *      scar #5, so "it returns empty on a healthy ledger" is the half that does not
 *      matter.
 *   2. **DEFECT records.** Each asserts the behaviour as it is today, with the
 *      reasoning for why it is wrong, so a fix is a visible diff to this file rather
 *      than a silent change of mind. None of them is a fabricated default, which is
 *      why they are recorded rather than patched here.
 */

import { describe, expect, it } from 'vitest';
import { minor, qty, type Minor } from '../../src/core/units.js';
import type { PrincipalId } from '../../src/core/types.js';
import {
  CURRENCY_FAUCET,
  GOODS_SINK,
  checkInv2,
  checkInv5,
  checkInv7,
  checkLedgerInvariants,
  resolveCargoLost,
} from '../../src/ledger/index.js';
import {
  A_STORES,
  ALICE,
  B_STORES,
  BOB,
  HAUL_1,
  HAUL_ESCROW,
  ORE,
  emptyWorld,
  ev,
  fund,
  mine,
} from './fixture.js';

// ── 1. The detection direction of the mirror invariants ─────────────────────

describe('INV-7 actually fires when a mirror drifts', () => {
  it('catches a cached balance that no longer matches its postings', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(1_000));
    const a = f.ledger.account(A_STORES);
    expect(a).toBeDefined();
    // The shape of the bug: something wrote a balance without writing a posting.
    a!.balanceMinor = minor(2_000);
    const found = checkInv7(f.ledger, 1);
    expect(found).toHaveLength(1);
    expect(found[0]?.id).toBe('INV-7');
    expect(found[0]?.severity).toBe('HALT');
    expect(found[0]?.message).toContain('postings sum to 1000, cached balance is 2000');
  });

  it('catches a lot quantity that no longer matches its postings — scar #5 exactly', () => {
    const f = emptyWorld();
    const id = mine(f, A_STORES, ALICE, ORE, qty(10), ev('dig'));
    // Scar #5 destroyed 2x the real value because a quantity had two homes and a
    // handler summed both. This is that state, and INV-7 must name it.
    f.ledger.requireLot(id).qty = qty(25);
    const found = checkInv7(f.ledger, 1);
    expect(found.map((x) => x.message).join(' | ')).toContain(
      'ore in stores:alice: postings sum to 10, lots hold 25',
    );
    expect(found.every((x) => x.severity === 'HALT')).toBe(true);
  });
});

describe('INV-2 actually fires when supply stops conserving', () => {
  it('catches a faucet whose issuance no longer matches what the world holds', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(1_000));
    const faucet = f.ledger.account(CURRENCY_FAUCET.STARTER_STAKE);
    expect(faucet).toBeDefined();
    faucet!.balanceMinor = minor(-2_000);
    const found = checkInv2(f.ledger, 1);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('issued 2000');
  });

  /**
   * A precision note on INV-2's stated form, not a defect.
   *
   * `currencySupply().free` is *defined* as `Σ stores − encumberedTotal()`, so in
   * `free + encumbered + escrowed` the encumbrance term cancels and the identity
   * reduces to `Σ stores + Σ escrow == issued − retired`. INV-2 therefore cannot
   * see the encumbrance table at all: a lock silently dropped from
   * `encumberedTotal()` is invisible to it. Over-counting is caught by INV-3's
   * per-account `locked > balance` clause; under-counting is caught by nothing,
   * because `checkInv5` audits `max_direct_loss`, which is a different column.
   */
  it('cannot see the encumbrance table, so INV-3 is the only guard on lock totals', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(1_000));
    const before = f.ledger.currencySupply();
    f.obligations.open(HAUL_1);
    f.ledger.encumbrances.lock({
      eventId: 'l1',
      tick: 1,
      principal: ALICE,
      account: A_STORES,
      amountMinor: minor(600),
      obligationRef: HAUL_1,
      maxDirectLoss: minor(600),
    });
    const after = f.ledger.currencySupply();
    expect(after.encumbered).toBe(600);
    expect(before.free + before.encumbered + before.escrowed).toBe(
      after.free + after.encumbered + after.escrowed,
    );
    expect(checkInv2(f.ledger, 1)).toEqual([]);
  });
});

// ── 2. DEFECT records ───────────────────────────────────────────────────────

describe("DEFECT(ledger): checkInv5's `served` check is unreachable from the ASSERT phase", () => {
  /**
   * `LedgerInvariantContext` is `{ tick, obligations }` and `checkLedgerInvariants`
   * calls `checkInv5(l, tick)` with no `served` map. So the check the module
   * describes as "what protects A7" — the EXPOSURE an agent was *shown* against the
   * EXPOSURE the table holds — cannot run in the tick's ASSERT phase at all. It is
   * reachable only by a caller who knows to invoke `checkInv5` directly, which the
   * one aggregate entry point does not do.
   */
  it('a stale served EXPOSURE is invisible to checkLedgerInvariants and visible to checkInv5', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(2_000));
    f.obligations.open(HAUL_1);
    f.ledger.encumbrances.lock({
      eventId: 'e1',
      tick: 1,
      principal: ALICE,
      account: A_STORES,
      amountMinor: minor(900),
      obligationRef: HAUL_1,
      maxDirectLoss: minor(900),
    });
    const stale = new Map<PrincipalId, Minor>([[ALICE, minor(100)]]);

    // Directly: caught.
    expect(checkInv5(f.ledger, 2, stale)).toHaveLength(1);
    // Through the phase the engine actually runs: silent, and there is no field on
    // the context that would let a caller pass it.
    expect(checkLedgerInvariants(f.ledger, { tick: 2, obligations: f.obligations })).toEqual([]);
  });
});

describe('DEFECT(ledger): pledgeLot and unpledgeLot have no guards and no invariant covers them', () => {
  /**
   * `transferGoods` refuses a pledged lot with a hard INV-4 error, because an
   * exclusive lien is the only thing stopping the same goods from backing two
   * obligations. `unpledgeLot` clears that lien unconditionally — no check that the
   * encumbrance is closed, none that the obligation is settled — and INV-4 only
   * asserts the converse (that a *pledged* lot's encumbrance is open). So the lien
   * is one unguarded call away from being no lien at all, and the whole ledger still
   * reports clean.
   */
  it('unpledgeLot frees cargo while the secured obligation it backed is still live', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(5_000));
    f.obligations.open(HAUL_1, true);
    const lot = mine(f, A_STORES, ALICE, ORE, qty(40), ev('dig'));
    const enc = f.ledger.encumbrances.lock({
      eventId: 'e1',
      tick: 1,
      principal: ALICE,
      account: A_STORES,
      amountMinor: minor(1_000),
      obligationRef: HAUL_1,
      maxDirectLoss: minor(1_000),
    });
    f.ledger.pledgeLot(lot, enc);
    f.ledger.unpledgeLot(lot);
    f.ledger.transferGoods({ eventId: ev('walk'), tick: 2, lotId: lot, to: B_STORES, qty: qty(40) });

    expect(f.ledger.encumbrances.isOpen(enc)).toBe(true);
    expect(f.ledger.goodsInAccount(B_STORES).get(ORE)).toBe(40);
    // Nothing objects. Recorded so that a guard, when added, changes this file.
    expect(checkLedgerInvariants(f.ledger, { tick: 2, obligations: f.obligations })).toEqual([]);
  });

  /**
   * `pledgeLot` checks only that the lot is unpledged and the encumbrance open. It
   * never checks that the lot and the lock belong to the same principal, so one
   * principal's cargo can be pledged against another's obligation — value posted as
   * collateral by someone who does not own it. §3's STORES are a principal's assets;
   * a lien primitive that ignores whose they are cannot enforce that.
   */
  it("pledges one principal's cargo to another principal's lock", () => {
    const f = emptyWorld();
    fund(f, B_STORES, minor(5_000));
    f.obligations.open(HAUL_1);
    const aliceLot = mine(f, A_STORES, ALICE, ORE, qty(40), ev('dig'));
    const bobLock = f.ledger.encumbrances.lock({
      eventId: 'e1',
      tick: 1,
      principal: BOB,
      account: B_STORES,
      amountMinor: minor(1_000),
      obligationRef: HAUL_1,
      maxDirectLoss: minor(1_000),
    });
    f.ledger.pledgeLot(aliceLot, bobLock);
    expect(f.ledger.requireLot(aliceLot).encumbranceId).toBe(bobLock);
    expect(f.ledger.requireLot(aliceLot).account).toBe(A_STORES);
    expect(checkLedgerInvariants(f.ledger, { tick: 2, obligations: f.obligations })).toEqual([]);
  });
});

describe('DEFECT(ledger): resolveCargoLost is many batches and is not atomic', () => {
  /**
   * `Ledger.apply` is correctly fail-closed per batch. `resolveCargoLost` is not:
   * it destroys every lost lot first (one batch each), then pays each claimant (one
   * batch each). A throw anywhere after the first destruction leaves the goods
   * permanently retired into `sink:loss` with no payment recorded and no outcome
   * returned — the caller cannot even tell what it now owes.
   *
   * Reached here by a claim whose payout account *is* the escrow, which
   * `transferCurrency` rejects as a self-transfer. A refund leg back to the funder's
   * own escrow is an entirely ordinary thing for the venture module to build, and
   * `resolveCargoLost` accepts the input, burns the cargo, and then throws.
   *
   * SPEC §15.3: the settlement batch is one transaction that fails closed. This one
   * fails open.
   */
  it('destroys the cargo and then throws, leaving the loss recorded and nothing paid', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(50_000));
    f.obligations.open(HAUL_1);
    const lot = mine(f, A_STORES, ALICE, ORE, qty(60), ev('dig'));
    f.ledger.transferCurrency({
      eventId: ev('escrowIn'),
      tick: 1,
      from: A_STORES,
      to: HAUL_ESCROW,
      amount: minor(1_000),
    });

    expect(() =>
      resolveCargoLost(f.ledger, {
        eventId: ev('raid'),
        tick: 5,
        venture: HAUL_1,
        escrow: HAUL_ESCROW,
        lost: [{ lotId: lot, qty: qty(60) }],
        claims: [{ account: HAUL_ESCROW, priority: 0, amount: minor(500), key: 'refund' }],
        perilReleased: [],
        causeEventId: ev('cause'),
      }),
    ).toThrow(/a transfer needs two accounts/);

    // The cargo is gone, permanently, and no payout exists.
    expect(f.ledger.lot(lot)).toBeUndefined();
    expect(f.ledger.account(GOODS_SINK.LOSS)?.movedQty.get(ORE)).toBe(60);
    expect(f.ledger.balance(HAUL_ESCROW)).toBe(1_000);
    // The ledger still balances, which is precisely why nothing catches this.
    expect(checkLedgerInvariants(f.ledger, { tick: 5, obligations: f.obligations })).toEqual([]);
  });
});
