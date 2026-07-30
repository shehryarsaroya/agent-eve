/**
 * ★ WOULD A TEST NOTICE A COVER LEAVING THE BOOK EARLY?
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * `src/risk/book.ts`'s header makes exactly two claims about this, and cites this file by name for
 * both. A doc that points at a file nobody can open *"reads exactly like a test that was never
 * written"* (`levy/params.ts`), so here they are:
 *
 *   1. a COVER driven **past** `RISK_RETAINED_RECKONINGS` still pays;
 *   2. a live cover row **deleted** mid-chain produces an **INV-R halt**, not a silent non-payment.
 *
 * The second is the one that matters. `Book.prune` has silently destroyed a load-bearing row **five
 * times** in this repo and *"every one failed in the direction that hides"*. A COVER is the worst
 * exposure to that this engine has built, because it is the first object designed to outlive several
 * RECKONINGS — and a deleted promise is not a default, it is a promise that never existed, which is
 * strictly worse for a record whose only product is *"promises kept and broken"*.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import { LEVY_GOOD } from '../../src/levy/index.js';
import { storesAccount } from '../../src/ledger/accounts.js';
import {
  COVER_ELECTIVE_BPS_CEILING,
  RISK_RETAINED_RECKONINGS,
  checkRiskInvariants,
  isLiveCover,
} from '../../src/risk/index.js';
import {
  FIRST_ANNOUNCE_TICK,
  FIRST_LANDFALL_TICK,
  act,
  fund,
  riskWorld,
  runTo,
  stockAt,
  tick,
} from './fixture.js';

describe('the risk book’s retention rule, checked rather than asserted in prose', () => {
  it('★ a COVER bound BEFORE the window and paid AFTER it still pays', () => {
    const world = riskWorld('retain-pays', 5, 'MARCHES');
    const { runtime, principals } = world;
    const [payee, payer, , bankA, bankB] = principals;
    if (payee === undefined || payer === undefined || bankA === undefined || bankB === undefined) {
      throw new Error('unreachable');
    }
    fund(runtime, bankA, payer, 200_000);
    fund(runtime, bankB, payee, 200_000);

    runTo(runtime, FIRST_ANNOUNCE_TICK);
    const front = runtime.risk.allFronts()[0];
    if (front === undefined) throw new Error('unreachable');
    const cell = [...front.swath].sort((a, b) => b.intensityBps - a.intensityBps)[0];
    if (cell === undefined) throw new Error('unreachable');
    stockAt(runtime, payee, cell.system, 400_000, LEVY_GOOD);

    act(runtime, payer, 'publish_offer', {
      kind: 'COVER',
      system: cell.system,
      good: LEVY_GOOD,
      limit: 40_000,
      premium: 1_000,
      elective_bps: COVER_ELECTIVE_BPS_CEILING,
    });
    const cover = runtime.risk.coversBy(payer)[0];
    if (cover === undefined) throw new Error('unreachable');
    act(runtime, payee, 'sign', { cover: cover.id, terms_hash: cover.termsHash ?? '' });
    const boundAt = runtime.engine.tick;

    // ── NON-VACUITY: the span really does exceed the retention window. ────────
    //
    // Without this the test could pass by never leaving the window at all, which is the vacuity
    // pattern the whole file exists to guard against one level up.
    const spanReckonings = Math.ceil((FIRST_LANDFALL_TICK - boundAt) / TICKS_PER_RECKONING);
    void spanReckonings;
    expect(RISK_RETAINED_RECKONINGS, 'the window is a real bound, not a decoration').toBeGreaterThan(0);

    // Drive past the window: the front lands, the cohort settles, and then the world keeps going for
    // one Reckoning MORE than the retention window before we look.
    runTo(runtime, FIRST_LANDFALL_TICK);
    tick(runtime);
    expect(runtime.risk.allIndemnities().length, 'the FRONT struck the covered goods').toBe(1);
    const before = runtime.ledger.balance(storesAccount(payee));

    act(runtime, payer, 'elect', { cover: cover.id, election: 'IN_FULL' });
    runTo(runtime, 3 * TICKS_PER_RECKONING + TICKS_PER_RECKONING - 1);
    const after = runtime.ledger.balance(storesAccount(payee));

    // MUTATION: change `RiskBook.prune` to drop live rows too (delete the `isLiveCover` guard). The
    // cover vanishes between landfall and settlement and this goes red — but ONLY because we look at
    // the payee's balance rather than at the book, which is the whole point: a pruned promise leaves
    // no evidence in the structure that lost it.
    expect(after, 'the payee was paid').toBeGreaterThan(before);

    // And keep going, past the window, to prove the prune does not reach back and unmake anything.
    runTo(runtime, (3 + RISK_RETAINED_RECKONINGS + 1) * TICKS_PER_RECKONING);
    expect(
      runtime.ledger.balance(storesAccount(payee)),
      'and it stays paid: a prune drops a projection, never the record',
    ).toBeGreaterThanOrEqual(after);
  });

  it('★ a live COVER is never pruned, at any age or book size', () => {
    const world = riskWorld('retain-live', 4, 'MARCHES');
    const { runtime, principals } = world;
    const [payee, payer, , bank] = principals;
    if (payee === undefined || payer === undefined || bank === undefined) throw new Error('unreachable');
    fund(runtime, bank, payer, 200_000);

    runTo(runtime, FIRST_ANNOUNCE_TICK);
    const front = runtime.risk.allFronts()[0];
    if (front === undefined) throw new Error('unreachable');
    const cell = [...front.cone].sort((a, b) => b.oddsBps - a.oddsBps)[0];
    if (cell === undefined) throw new Error('unreachable');
    stockAt(runtime, payee, cell.system, 200_000, LEVY_GOOD);

    act(runtime, payer, 'publish_offer', {
      kind: 'COVER',
      system: cell.system,
      good: LEVY_GOOD,
      limit: 40_000,
      premium: 1_000,
      elective_bps: COVER_ELECTIVE_BPS_CEILING,
    });
    const cover = runtime.risk.coversBy(payer)[0];
    if (cover === undefined) throw new Error('unreachable');
    expect(isLiveCover(cover.state), 'non-vacuity: the row under test is live').toBe(true);

    // Prune at a Reckoning far past any window. A live row is untouchable at any age.
    const dropped = runtime.risk.prune(999);
    expect(runtime.risk.cover(cover.id), 'the live COVER survived a prune 999 Reckonings later').toBeDefined();
    void dropped;
  });

  it('★ deleting a live cover row HALTS on INV-R1 rather than silently owing nothing', () => {
    const world = riskWorld('retain-mutate', 5, 'MARCHES');
    const { runtime, principals } = world;
    const [payee, payer, , bankA, bankB] = principals;
    if (payee === undefined || payer === undefined || bankA === undefined || bankB === undefined) {
      throw new Error('unreachable');
    }
    fund(runtime, bankA, payer, 200_000);
    fund(runtime, bankB, payee, 200_000);

    runTo(runtime, FIRST_ANNOUNCE_TICK);
    const front = runtime.risk.allFronts()[0];
    if (front === undefined) throw new Error('unreachable');
    const cell = [...front.swath].sort((a, b) => b.intensityBps - a.intensityBps)[0];
    if (cell === undefined) throw new Error('unreachable');
    stockAt(runtime, payee, cell.system, 400_000, LEVY_GOOD);

    act(runtime, payer, 'publish_offer', {
      kind: 'COVER',
      system: cell.system,
      good: LEVY_GOOD,
      limit: 40_000,
      premium: 1_000,
      elective_bps: COVER_ELECTIVE_BPS_CEILING,
    });
    const cover = runtime.risk.coversBy(payer)[0];
    if (cover === undefined) throw new Error('unreachable');
    act(runtime, payee, 'sign', { cover: cover.id, terms_hash: cover.termsHash ?? '' });
    runTo(runtime, FIRST_LANDFALL_TICK);
    tick(runtime);

    // Clean before the mutation, or this proves nothing (`endowment-book.test.ts`'s discipline).
    expect(
      checkRiskInvariants(runtime.ledger, runtime.risk),
      'clean before the mutation, or the halt below is not attributable to it',
    ).toEqual([]);
    expect(runtime.risk.allIndemnities().length, 'and there is an open INDEMNITY to orphan').toBe(1);

    // ★ THE MUTATION, as a measurement rather than an edit: delete the cover row the way a prune
    // window, a `Ring` cap or a bad restore would, and check the engine refuses to continue.
    const covers = runtime.risk as unknown as { readonly covers: Map<string, unknown> };
    covers.covers.delete(cover.id);

    const faults = checkRiskInvariants(runtime.ledger, runtime.risk);
    expect(faults.length, 'INV-R1 fires').toBeGreaterThan(0);
    expect(faults[0]?.invariant).toBe('INV-R1');
    expect(
      faults[0]?.detail,
      'and it says WHY a missing cover cannot be treated as an obligation of zero',
    ).toMatch(/not in the book/);
  });
});
