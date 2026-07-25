/**
 * Wave-3 verifier regressions for `src/reckoning`.
 *
 * Each block below is a mutation that survived the module's own 73 tests, written as the
 * assertion that kills it.
 *
 *   1. **A refusal attributed to somebody else's raid.** `settleBatch` stamps *every*
 *      default on a loss-outcome venture with the loss event, `DECLINED` ones included, so
 *      the naive resolution published a payer that had the money and simply refused with
 *      `parent_event_id` pointing at the raid and a register kind of `LOSS`. The row's own
 *      payload said `DECLINED` on the same line. A5′: the record must never be wrong, and
 *      this was wrong in the *flattering* direction — plus it made a raider's event the
 *      cause of a default it did not cause.
 *   2. **`inputs_hash` was never compared against anything that moved.** Every existing
 *      freeze test trips one of `readingFaults`' named fields, so switching off the hash
 *      comparison in `verifyFrozenInputs` left all 73 green. The tamper only the hash can
 *      see is an edit to the frozen *plan* — and `Object.freeze` does not freeze a Map,
 *      so the elections are reachable.
 *   3. **The `WATERFALL` stage's only assertion never fired**, and
 *      three of `assertPayoutsExact`'s five clauses cannot fail on the instance the driver
 *      builds: `proceeds` *is* Σ`paid`, `surplus` is the literal `0`, and `shortfall` is
 *      Σ`claimed` − Σ`paid`. What is left that can fail is the seniority inversion and the
 *      overpay, and those are pinned here directly against the same helper the stage calls.
 */

import { describe, expect, it } from 'vitest';
import { minor } from '../../src/core/units.js';
import {
  assertPayoutsExact,
  escrowAccount,
  storesAccount,
  type Payout,
  type WaterfallResult,
} from '../../src/ledger/index.js';
import { SHARE_PRIORITY, WAGE_PRIORITY, type Election } from '../../src/venture/index.js';
import {
  BRAM,
  CASS,
  DOV,
  FORM_TICK,
  drain,
  fixture,
  freeze,
  goLive,
  makeHaul,
  planFor,
  run,
  wage,
} from './fixture.js';

describe('INV-17 — a refusal is never attributed to the event that destroyed the cargo', () => {
  /**
   * The payer keeps a full purse and declines anyway. The only thing the raid took is the
   * cargo, so nothing about the *funding* of the elective half changed.
   */
  function refusedAfterALoss() {
    const f = fixture(minor(50_000));
    const haul = makeHaul(f, {
      creator: DOV,
      // Wage roles: a senior fixed claim survives the loss of the cargo, so there is
      // still an elective half to refuse. A share claim on a destroyed cargo is zero.
      carrier: wage(100, 1_200),
      escort: wage(100, 1_200),
    });
    goLive(f, haul, [BRAM, CASS], minor(0));
    const raid = drain(f, {
      from: escrowAccount(haul.id, DOV),
      tick: FORM_TICK + 2,
      venture: haul.id,
    });
    const frozen = freeze(f, [
      planFor(haul, {
        outcome: 'CARGO_LOST',
        proceeds: minor(0),
        // Nothing elected: a deliberate refusal, with the money sitting right there.
        elections: new Map<number, Election>(),
        causeEventId: raid,
      }),
    ]);
    return { f, haul, raid, outcome: run(f, frozen) };
  }

  it('the payer could pay, so the default is ELAPSED_WINDOW and parents on the settlement', () => {
    const { f, raid, outcome } = refusedAfterALoss();

    expect(outcome.transaction.committed).toBe(true);
    // The premise: this payer was never short of money.
    expect(f.ledger.balance(storesAccount(DOV))).toBeGreaterThan(2_400);
    expect(outcome.defaults.length).toBeGreaterThan(0);

    const settledEventId = outcome.receipts[0]?.settledEventId;
    for (const attribution of outcome.defaults) {
      expect(attribution.cause).toBe('ELAPSED_WINDOW');
      expect(attribution.causeEventId).toBe(settledEventId);
      expect(attribution.causeEventId).not.toBe(raid);
      // The column an auditor joins on must agree with the register, and neither may
      // point at the raid.
      const row = f.events.get(attribution.defaultEventId);
      expect(row?.event.parentEventId).toBe(settledEventId);
      expect(row?.event.parentEventId).not.toBe(raid);
      // …and the payload's own word for it still says the payer chose.
      expect(row?.event.payload['cause']).toBe('DECLINED');
    }
  });

  it('the recorded loss still parents on the raid — the cargo really was destroyed', () => {
    const { f, raid, outcome } = refusedAfterALoss();
    const lossIds = outcome.receipts[0]?.lossEventIds ?? [];
    expect(lossIds.length).toBeGreaterThan(0);
    for (const id of lossIds) {
      expect(f.events.get(id)?.event.parentEventId).toBe(raid);
      expect(f.events.get(id)?.event.payload['isDefault']).toBe(false);
    }
  });
});

describe('the freeze — inputs_hash catches what the field-by-field list cannot see', () => {
  it('a frozen set edited in place after the freeze halts, on the hash alone', () => {
    const f = fixture();
    const haul = makeHaul(f, { creator: DOV, carrier: wage(100, 400), escort: wage(100, 900) });
    goLive(f, haul, [BRAM, CASS], minor(6_000));
    const elections = new Map<number, Election>([
      [0, minor(400)],
      [1, minor(900)],
    ]);
    const frozen = freeze(f, [planFor(haul, { proceeds: minor(6_000), elections })]);

    // The elections map is reachable through the frozen set (`Object.freeze` does not
    // freeze a Map's contents), so this is the tamper §15.3's hash is the only defence
    // against: `readingFaults` compares the *readings* and would report nothing, because
    // no balance, version, terms hash, state or holder moved. One election vanished.
    const plan = frozen.obligations[0]?.plan;
    if (plan === undefined) throw new Error('fixture');
    (plan.elections as Map<number, Election>).delete(1);

    const outcome = run(f, frozen);
    expect(outcome.transaction.committed).toBe(false);
    expect(outcome.transaction.failedAt).toBe('VERIFY_INPUTS');
    // The hash clause specifically, not one of the named-field ones.
    expect(outcome.transaction.haltRecord?.reason ?? '').toContain(
      'no longer hash to what the freeze recorded',
    );
    // Nothing was paid and nobody was accused of anything.
    expect(outcome.transaction.applied).toEqual([]);
    expect(outcome.defaults).toEqual([]);
    expect(f.register.size).toBe(0);
  });
});

describe('INV-6 — the two clauses of the escrow waterfall that can actually fail', () => {
  /** The instance shape the driver builds at `WATERFALL`. */
  function potOf(payouts: readonly Payout[]): { proceeds: number; result: WaterfallResult } {
    const paid = payouts.reduce((n, p) => n + p.paid, 0);
    const claimed = payouts.reduce((n, p) => n + p.claimed, 0);
    return {
      proceeds: paid,
      result: { payouts, shortfall: minor(claimed - paid), surplus: minor(0) },
    };
  }

  it('a junior share band paid while a senior wage band is short is refused', () => {
    // §7.1's inversion: "the ledger would record the broken promise as honoured."
    const bad = potOf([
      { account: storesAccount(BRAM), priority: WAGE_PRIORITY, claimed: minor(500), paid: minor(200), key: 'v:00' },
      { account: storesAccount(CASS), priority: SHARE_PRIORITY, claimed: minor(300), paid: minor(300), key: 'v:01' },
    ]);
    expect(() => assertPayoutsExact(minor(bad.proceeds), bad.result)).toThrow(/INV-6/);

    // The same pot with seniority respected passes, so the assertion is not simply broken.
    const good = potOf([
      { account: storesAccount(BRAM), priority: WAGE_PRIORITY, claimed: minor(500), paid: minor(500), key: 'v:00' },
      { account: storesAccount(CASS), priority: SHARE_PRIORITY, claimed: minor(300), paid: minor(0), key: 'v:01' },
    ]);
    expect(() => assertPayoutsExact(minor(good.proceeds), good.result)).not.toThrow();
  });

  it('a role paid more than it claimed is refused', () => {
    const bad = potOf([
      { account: storesAccount(BRAM), priority: WAGE_PRIORITY, claimed: minor(100), paid: minor(101), key: 'v:00' },
    ]);
    expect(() => assertPayoutsExact(minor(bad.proceeds), bad.result)).toThrow(/INV-6/);
  });

  it('DOCUMENTS THE GAP: the conservation clauses cannot fail on this instance shape', () => {
    // `proceeds` is Σ paid and `shortfall` is Σ claimed − Σ paid, both derived from the
    // same array, and `surplus` is the literal 0. So `paid + surplus === proceeds` and
    // `paid + shortfall === claimed` hold for *any* numbers at all, including numbers no
    // escrow could have produced. The escrow's own conservation is caught in `RECONCILE`
    // ("escrow still holds N after settling") and not here, and `report.checked` listing
    // INV-6 at the Reckoning should be read with that in mind.
    const nonsense = potOf([
      { account: storesAccount(BRAM), priority: WAGE_PRIORITY, claimed: minor(7), paid: minor(3), key: 'v:00' },
      { account: storesAccount(CASS), priority: WAGE_PRIORITY, claimed: minor(9), paid: minor(4), key: 'v:01' },
    ]);
    expect(() => assertPayoutsExact(minor(nonsense.proceeds), nonsense.result)).not.toThrow();
    // Σ paid = 7 against Σ claimed = 16 out of a pot that never held either figure.
    expect(nonsense.proceeds).toBe(7);
    expect(nonsense.result.shortfall).toBe(9);
  });
});
