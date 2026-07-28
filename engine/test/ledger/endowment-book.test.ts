/**
 * `EndowmentBook` — the per-principal counter that replaced D7's static floor.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE DEFECT THIS CLOSES.** `freeCash` was `freeBalance − STARTER_STAKE` with the floor
 * fixed at the whole 250,000, and every principal that has ever played this game sits
 * between 62,000 and 203,000 — so `freeCash` was identically zero for everybody and the
 * market's buy side was unreachable by construction. `ledger/endowment.ts` predicted the
 * over-withholding and called it *"a rounding difference nobody can spend"*; it was the
 * entire buy side.
 *
 * **THE PROPERTY THAT MUST SURVIVE.** A15 / HARD RULE 5: enrolment is free, so if a fresh
 * identity's endowment could be transferred, N identities would be N × 250,000 of capital
 * and the Sybil price of money would be zero. Every test below is either that property or
 * the arithmetic it rests on.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Every guard here has a MUTATION named against it. `test/market/the-buy-side-is-funded.spec.ts`
 * carries the same argument at world scale, where the numbers are the engine's rather than
 * this file's.
 */
import { describe, expect, it } from 'vitest';
import { Ledger, storesAccount, CURRENCY_FAUCET, CURRENCY_SINK } from '../../src/ledger/index.js';
import {
  EndowmentBook,
  EndowmentError,
  ENDOWMENT_FLOOR_MINOR,
  STARTER_STAKE,
} from '../../src/ledger/endowment.js';
import { freeCash } from '../../src/market/escrow.js';
import { checkInv7 } from '../../src/ledger/invariants.js';
import { ledgerStateTable } from '../../src/ledger/stateTable.js';
import { canonicalHash } from '../../src/core/canonical.js';
import { minor } from '../../src/core/units.js';
import type { EventId, PrincipalId } from '../../src/core/types.js';

const P = 'p:one' as PrincipalId;
const Q = 'p:two' as PrincipalId;

/** A ledger with `who` enrolled and `extra` of EARNED currency on top of the stake. */
function enrolled(who: PrincipalId = P, extra = 0): Ledger {
  const led = new Ledger();
  led.openAccount(storesAccount(who), 'STORES', who);
  led.issueCurrency({
    eventId: `e:enrol:${who}` as EventId,
    tick: 0,
    faucet: CURRENCY_FAUCET.STARTER_STAKE,
    to: storesAccount(who),
    amount: STARTER_STAKE,
  });
  if (extra > 0) {
    // CIVIC_PROCUREMENT, not the starter stake: this is money the world PAID, which is the
    // only kind that may ever leave a principal.
    led.issueCurrency({
      eventId: `e:earn:${who}` as EventId,
      tick: 0,
      faucet: CURRENCY_FAUCET.CIVIC_PROCUREMENT,
      to: storesAccount(who),
      amount: minor(extra),
    });
  }
  return led;
}

let burnSeq = 0;
function burn(led: Ledger, who: PrincipalId, amount: number): void {
  burnSeq += 1;
  led.retireCurrency({
    eventId: `e:burn:${String(burnSeq)}` as EventId,
    tick: 1,
    sink: CURRENCY_SINK.UPKEEP,
    from: storesAccount(who),
    amount: minor(amount),
  });
}

describe('the counter itself', () => {
  it('starts at the whole stake for a principal it has never heard of', () => {
    // MUTATION: default the absent row to 0 instead of ENDOWMENT_FLOOR_MINOR. RED here, and
    // in the live world every principal whose row went missing would become instantly and
    // silently able to transfer its entire endowment — D7 reopened by a fallback.
    const book = new EndowmentBook();
    expect(book.remaining(P)).toBe(ENDOWMENT_FLOOR_MINOR);
    expect(ENDOWMENT_FLOOR_MINOR, 'the floor and the grant are one quantity').toBe(STARTER_STAKE);
  });

  it('falls by exactly what was retired, and stops at zero', () => {
    // MUTATION: drop the `Math.max(0, ...)`. RED on the last line, and a negative `remaining`
    // would make `freeBalance − remaining` LARGER than the balance.
    const book = new EndowmentBook();
    book.retire(P, minor(60_000));
    expect(book.remaining(P)).toBe(STARTER_STAKE - 60_000);
    book.retire(P, minor(40_000));
    expect(book.remaining(P)).toBe(STARTER_STAKE - 100_000);
    book.retire(P, minor(999_999));
    expect(book.remaining(P)).toBe(0);
  });

  it('never rises — a retirement of zero or less is not a credit', () => {
    // MUTATION: remove the `amount <= 0` guard. A negative retirement would ADD endowment
    // back, which is the one thing this counter must never do.
    const book = new EndowmentBook();
    book.retire(P, minor(100_000));
    book.retire(P, minor(0));
    book.retire(P, minor(-50_000));
    expect(book.remaining(P)).toBe(STARTER_STAKE - 100_000);
  });

  it('is per principal — one principal spending does not free another', () => {
    const book = new EndowmentBook();
    book.retire(P, minor(250_000));
    expect(book.remaining(P)).toBe(0);
    expect(book.remaining(Q), "Q never spent, so Q's stake is untouched").toBe(STARTER_STAKE);
  });

  it('only stores rows for principals that have actually spent', () => {
    // The capture is bounded by the principals that HAVE retired, not by the roll. Absent
    // means "untouched stake", which is the maximum-withholding default.
    const book = new EndowmentBook();
    expect(book.all()).toEqual([]);
    book.retire(P, minor(10));
    expect(book.all().map((r) => r.principal)).toEqual([P]);
  });

  it('captures in canonical principal order, whatever order the rows arrived', () => {
    // DET: a hash input whose order depends on insertion is a hash that differs between two
    // identical worlds reached by different routes.
    const a = new EndowmentBook();
    a.retire(Q, minor(1));
    a.retire(P, minor(2));
    const b = new EndowmentBook();
    b.retire(P, minor(2));
    b.retire(Q, minor(1));
    expect(a.all()).toEqual(b.all());
    expect(a.all().map((r) => r.principal)).toEqual([P, Q]);
  });
});

describe('restore refuses what it cannot honestly hold', () => {
  it('refuses a row above the stake, because an endowment never grows', () => {
    // MUTATION: drop the upper-bound check. A capture claiming `remaining` ABOVE the stake
    // would make `freeBalance − remaining` smaller than it should be — which is only
    // over-withholding — but the SAME hole read the other way is a corrupt triple, and a
    // capture we cannot trust must be refused rather than clamped.
    const book = new EndowmentBook();
    expect(() => {
      book.restore([{ principal: P, remaining: minor(STARTER_STAKE + 1) }]);
    }).toThrow(EndowmentError);
  });

  it('refuses a negative or fractional row', () => {
    const book = new EndowmentBook();
    expect(() => {
      book.restore([{ principal: P, remaining: minor(-1) }]);
    }).toThrow(EndowmentError);
    expect(() => {
      book.restore([{ principal: P, remaining: 0.5 as ReturnType<typeof minor> }]);
    }).toThrow(EndowmentError);
  });

  it('round-trips exactly, and a restore replaces rather than merges', () => {
    const book = new EndowmentBook();
    book.retire(P, minor(1_000));
    book.retire(Q, minor(2_000));
    const captured = book.all();
    const other = new EndowmentBook();
    other.retire(Q, minor(9_999));
    other.restore(captured);
    expect(other.all()).toEqual(captured);
    expect(other.remaining(Q)).toBe(STARTER_STAKE - 2_000);
  });
});

describe('★ A15: the arithmetic that makes an identity worth nothing', () => {
  it('a fresh identity can commit NOTHING, exactly as before', () => {
    const led = enrolled();
    expect(led.balance(storesAccount(P))).toBe(STARTER_STAKE);
    expect(freeCash(led, P), 'the endowment is not trading capital').toBe(0);
  });

  it('★ a retirement is freeCash-NEUTRAL — you cannot launder a stake by burning it', () => {
    // ══════════════════════════════════════════════════════════════════════
    // THE LOAD-BEARING PROPERTY. If burning endowment freed transferable currency, a
    // puppet would convert its 250,000 into spendable money and A15 would be gone. The
    // balance falls by X and the counter falls by X, so the difference does not move.
    //
    // MUTATION: make `retireCurrency` skip the `endowments.retire` call (the pre-19
    // behaviour). GREEN on this test — it stays 0 — but RED on the next one, which is why
    // both are here. Make the hook decrement by anything other than the retired amount
    // (say `amount / 2`, or a flat constant): RED here immediately.
    // ══════════════════════════════════════════════════════════════════════
    const led = enrolled();
    for (const step of [60_000, 40_000, 50_000]) {
      burn(led, P, step);
      expect(freeCash(led, P), `after burning ${String(step)} of pure endowment`).toBe(0);
    }
    expect(led.balance(storesAccount(P))).toBe(STARTER_STAKE - 150_000);
    expect(led.endowments.remaining(P)).toBe(STARTER_STAKE - 150_000);
  });

  it('★ but a principal that has SPENT keeps every penny it EARNS — the defect, inverted', () => {
    // ══════════════════════════════════════════════════════════════════════
    // THIS IS THE TEST THE OLD RULE FAILS. Under `freeBalance − STARTER_STAKE`: balance is
    // 250,000 − 150,000 + 30,000 = 130,000, floor is 250,000, `freeCash` is 0 — the agent
    // earned 30,000 and may commit none of it, forever, because it once paid for a WORKS.
    // That is the state every cast member in every world was in.
    //
    // MUTATION: revert `freeCash` to `freeBalance − ENDOWMENT_FLOOR_MINOR`. RED here.
    // ══════════════════════════════════════════════════════════════════════
    const led = enrolled();
    burn(led, P, 150_000);
    led.issueCurrency({
      eventId: 'e:paid' as EventId,
      tick: 2,
      faucet: CURRENCY_FAUCET.CIVIC_PROCUREMENT,
      to: storesAccount(P),
      amount: minor(30_000),
    });
    expect(led.balance(storesAccount(P))).toBe(130_000);
    expect(freeCash(led, P), 'earnings are transferable however much endowment was spent').toBe(
      30_000,
    );
  });

  it('a retirement PAST the endowment consumes earnings, and freeCash falls with them', () => {
    // The other side of the clamp: once `remaining` is 0 the counter cannot absorb any more,
    // so a further burn is earnings being destroyed and must show up as less to spend.
    const led = enrolled(P, 100_000);
    expect(freeCash(led, P)).toBe(100_000);
    burn(led, P, 250_000); // exactly the endowment
    expect(freeCash(led, P), 'burning the whole stake leaves the earnings intact').toBe(100_000);
    burn(led, P, 40_000); // now into the earnings
    expect(led.endowments.remaining(P)).toBe(0);
    expect(freeCash(led, P)).toBe(60_000);
  });

  it('ten free identities still concentrate ten times nothing', () => {
    // The original D7 arithmetic, re-run under the new rule. Each puppet spends its whole
    // stake into world sinks along the way, which is the case the static floor got wrong in
    // the safe direction and which this rule must still get right.
    let transferable = 0;
    for (let i = 0; i < 10; i += 1) {
      const who = `p:sock${String(i)}` as PrincipalId;
      const led = enrolled(who);
      burn(led, who, 60_000); // a WORKS
      burn(led, who, 40_000); // a founding
      burn(led, who, 50_000); // a graduation
      transferable += freeCash(led, who);
    }
    expect(transferable, 'a fleet of free identities must yield zero tradeable capital').toBe(0);
  });
});

describe('the hook is on the DOOR, not on the callers', () => {
  it('every retirement out of a principal STORES decrements, whatever the sink', () => {
    // MUTATION: scope the hook to one sink, or to one call site. RED for the other sinks.
    for (const sink of [
      CURRENCY_SINK.UPKEEP,
      CURRENCY_SINK.FEES,
      CURRENCY_SINK.SLOT_AUCTION,
      CURRENCY_SINK.RECOVERY,
    ]) {
      const led = enrolled();
      led.retireCurrency({
        eventId: `e:sink:${sink}` as EventId,
        tick: 1,
        sink,
        from: storesAccount(P),
        amount: minor(1_000),
      });
      expect(led.endowments.remaining(P), `${sink} must charge the endowment too`).toBe(
        STARTER_STAKE - 1_000,
      );
    }
  });

  it('a retirement out of an ESCROW charges nobody — it is not a principal purse', () => {
    // MUTATION: drop the `kind === 'STORES'` test. A venture's committed half burning would
    // then free the funder's endowment, which is currency the funder never got back.
    const led = enrolled();
    const esc = 'escrow:v:one:p:one';
    led.openAccount(esc as never, 'ESCROW', P);
    led.transferCurrency({
      eventId: 'e:fund' as EventId,
      tick: 1,
      from: storesAccount(P),
      to: esc as never,
      amount: minor(50_000),
    });
    expect(led.endowments.remaining(P), 'funding an escrow is not spending on the world').toBe(
      STARTER_STAKE,
    );
    led.retireCurrency({
      eventId: 'e:esc-burn' as EventId,
      tick: 1,
      sink: CURRENCY_SINK.UPKEEP,
      from: esc as never,
      amount: minor(50_000),
    });
    expect(led.endowments.remaining(P)).toBe(STARTER_STAKE);
  });

  it('a TRANSFER never decrements — that is the term TRACKER.md got wrong', () => {
    // ══════════════════════════════════════════════════════════════════════
    // `TRACKER.md` sketched the rule as `floor = STARTER_STAKE − retired − transferredOut`.
    // The third term is wrong and this test is why: subtracting it would leave `freeCash`
    // UNCHANGED after a transfer, so a principal could send the same earnings out over and
    // over. Retirement and transfer are different acts.
    //
    // MUTATION: add a `this.endowments.retire(...)` call to `transferCurrency`. RED here.
    // ══════════════════════════════════════════════════════════════════════
    const led = enrolled(P, 40_000);
    led.openAccount(storesAccount(Q), 'STORES', Q);
    expect(freeCash(led, P)).toBe(40_000);
    led.transferCurrency({
      eventId: 'e:pay' as EventId,
      tick: 1,
      from: storesAccount(P),
      to: storesAccount(Q),
      amount: minor(40_000),
    });
    expect(led.endowments.remaining(P), 'a transfer spends earnings, not endowment').toBe(
      STARTER_STAKE,
    );
    expect(freeCash(led, P), 'and what it sent is gone, so it cannot send it twice').toBe(0);
  });
});

describe("INV-7's fourth mirror recomputes the counter from the log", () => {
  it('is satisfied by an honest ledger, and the check is not vacuous', () => {
    const led = enrolled(P, 10_000);
    burn(led, P, 70_000);
    // Non-vacuity FIRST: the mirror must have a row to look at, or a green result means
    // nothing. This is the failure mode INV-22 had for the whole life of the project.
    expect(led.endowments.all().length, 'the mirror must have a subject').toBe(1);
    expect(led.endowments.remaining(P)).toBe(STARTER_STAKE - 70_000);
    expect(checkInv7(led, 1)).toEqual([]);
  });

  it('★ HALTS when the counter is cleared behind its back — the Book.prune hazard', () => {
    // ══════════════════════════════════════════════════════════════════════
    // `Book.prune` has silently destroyed a load-bearing row five times in this repo and
    // every one failed in the direction that hides. This counter has no prune, but the
    // question a future session will ask is *"would anything notice if it did?"* — and this
    // is the answer. `restore([])` is exactly what a prune, a per-Reckoning reset, or a
    // capture that forgot the key would do.
    //
    // MUTATION: delete the fourth mirror from `checkInv7`. RED here — and in the live world
    // the counter could be zeroed and every principal would silently revert to the
    // pre-19 over-withholding with no alarm anywhere.
    // ══════════════════════════════════════════════════════════════════════
    const led = enrolled(P, 10_000);
    burn(led, P, 70_000);
    expect(checkInv7(led, 1), 'clean before the mutation, or this proves nothing').toEqual([]);

    led.endowments.restore([]); // the prune
    const violations = checkInv7(led, 2);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]?.id).toBe('INV-7');
    expect(violations[0]?.message).toContain(P);
  });

  it('HALTS when the counter drifts UP, which is the A15 direction', () => {
    // A counter that grew would hand a puppet transferable capital. The mirror does not care
    // which way the drift went; both are published-record corruption.
    const led = enrolled(P);
    burn(led, P, 100_000);
    led.endowments.restore([{ principal: P, remaining: STARTER_STAKE }]);
    expect(checkInv7(led, 2).length).toBeGreaterThan(0);
  });

  it('HALTS on a row for a principal with no STORES account', () => {
    const led = enrolled(P);
    led.endowments.restore([{ principal: 'p:ghost' as PrincipalId, remaining: minor(0) }]);
    const violations = checkInv7(led, 2);
    expect(violations.some((x) => x.message.includes('p:ghost'))).toBe(true);
  });
});

describe('it is genuinely IN the hash input, not merely beside it', () => {
  it('two worlds that spent differently CAPTURE differently', () => {
    // ══════════════════════════════════════════════════════════════════════
    // The hazard this closes is specific and it is the one `books-in-the-hash` was written
    // for: a map that `restore()` CLEARS but `capture()` never emits is invisible to the
    // hash AND zeroed by every aborted tick, and both halves are silent. If `capture` had
    // omitted `endowments`, two worlds whose principals had spent differently would hash
    // the same and an abort would quietly re-withhold everybody's endowment.
    //
    // MUTATION: delete the `endowments:` key from `ledgerStateTable.capture()`. RED here.
    // ══════════════════════════════════════════════════════════════════════
    const spent = enrolled();
    burn(spent, P, 70_000);
    const untouched = enrolled();

    const a = ledgerStateTable(() => spent, () => undefined).capture();
    const b = ledgerStateTable(() => untouched, () => undefined).capture();
    expect(canonicalHash(a), 'the counter must move the capture').not.toBe(canonicalHash(b));

    // Non-vacuity: the two ledgers are otherwise identical, so the counter is the ONLY
    // difference the hash can be seeing. Balances differ by the burn, so this is asserted
    // by re-capturing `spent` with its counter forced back to the untouched value.
    spent.endowments.restore([]);
    const c = ledgerStateTable(() => spent, () => undefined).capture();
    expect(canonicalHash(a), 'and it is the counter, not just the balance').not.toBe(
      canonicalHash(c),
    );
  });

  it('round-trips through capture and restore byte-identically', () => {
    const led = enrolled(P, 5_000);
    burn(led, P, 11_111);
    const table = ledgerStateTable(
      () => led,
      (state) => {
        led.restoreTo(state);
      },
    );
    const before = table.capture();
    expect(led.endowments.remaining(P)).toBe(STARTER_STAKE - 11_111);

    // Wreck it, then restore. `restore` must put back the exact rows, not an empty book.
    led.endowments.restore([{ principal: P, remaining: minor(1) }]);
    expect(canonicalHash(table.capture())).not.toBe(canonicalHash(before));
    table.restore?.(before);
    expect(led.endowments.remaining(P)).toBe(STARTER_STAKE - 11_111);
    expect(canonicalHash(table.capture()), 'a restored ledger must re-capture identically').toBe(
      canonicalHash(before),
    );
  });
});
