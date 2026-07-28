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
import {
  Ledger,
  storesAccount,
  CURRENCY_FAUCET,
  CURRENCY_SINK,
  GOODS_FAUCET,
  GOODS_SINK,
  type LotId,
} from '../../src/ledger/index.js';
import {
  EndowmentBook,
  EndowmentError,
  ENDOWMENT_FLOOR_MINOR,
  ENDOWMENT_GOOD,
  ENDOWMENT_GOOD_FLOOR_QTY,
  STARTER_STAKE,
} from '../../src/ledger/endowment.js';
import { freeCash, sellableGoods } from '../../src/market/escrow.js';
import { checkInv7 } from '../../src/ledger/invariants.js';
import { ledgerStateTable } from '../../src/ledger/stateTable.js';
import { canonicalHash } from '../../src/core/canonical.js';
import { minor, qty } from '../../src/core/units.js';
import type { EventId, GoodId, PrincipalId, SystemId } from '../../src/core/types.js';

const P = 'p:one' as PrincipalId;
const Q = 'p:two' as PrincipalId;
const HOME = 's:kell' as SystemId;
const AWAY = 's:mora' as SystemId;
const OTHER_GOOD = 'ore' as GoodId;

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

// ── the goods half (`RULES_VERSION` 20) ───────────────────────────────────────

let goodsSeq = 0;

/** Source `amount` of `good` into `who`'s STORES at `where`, and hand back the lot. */
function source(
  led: Ledger,
  who: PrincipalId,
  amount: number,
  where: SystemId = HOME,
  good: GoodId = ENDOWMENT_GOOD,
): LotId {
  goodsSeq += 1;
  return led.sourceGoods({
    eventId: `e:goods:${String(goodsSeq)}` as EventId,
    tick: 0,
    faucet: GOODS_FAUCET.PRODUCTION,
    to: storesAccount(who),
    good,
    qty: qty(amount),
    location: where,
    origin: who,
  });
}

/**
 * `who` enrolled with a STORES account and the full goods allotment at `HOME`, plus
 * `produced` extra units of the same good — the goods twin of {@link enrolled}'s `extra`.
 */
function allotted(who: PrincipalId = P, produced = 0): Ledger {
  const led = new Ledger();
  led.openAccount(storesAccount(who), 'STORES', who);
  source(led, who, ENDOWMENT_GOOD_FLOOR_QTY);
  if (produced > 0) source(led, who, produced);
  return led;
}

/** Destroy `amount` of `good` from `who`'s first matching lot at `where`. */
function consume(
  led: Ledger,
  who: PrincipalId,
  amount: number,
  where: SystemId = HOME,
  good: GoodId = ENDOWMENT_GOOD,
): void {
  let left = amount;
  for (const lot of led.lotsInAccount(storesAccount(who))) {
    if (left <= 0) break;
    if (lot.good !== good || lot.location !== where) continue;
    const take = Math.min(left, lot.qty);
    if (take <= 0) continue;
    goodsSeq += 1;
    led.destroyGoods({
      eventId: `e:eat:${String(goodsSeq)}` as EventId,
      tick: 1,
      sink: GOODS_SINK.CONSUMPTION,
      lotId: lot.id,
      qty: qty(take),
    });
    left -= take;
  }
  if (left > 0) throw new Error(`fixture: ${who} could not destroy ${String(amount)} of ${good}`);
}

/** Total units of `good` this principal holds in STORES, wherever they are. */
function held(led: Ledger, who: PrincipalId, good: GoodId = ENDOWMENT_GOOD): number {
  return led
    .lotsInAccount(storesAccount(who))
    .filter((lot) => lot.good === good)
    .reduce((n, lot) => n + lot.qty, 0);
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

  // ── ★ THE GOODS COUNTER (`RULES_VERSION` 20) ────────────────────────────────
  //
  // Every guard above, restated for the second counter, because they were load-bearing for the
  // first and a counter that shares a row does not inherit them.

  it('★ the goods counter starts at the whole ALLOTMENT for a principal it has never heard of', () => {
    // MUTATION: default the absent row to 0 instead of ENDOWMENT_GOOD_FLOOR_QTY. RED here, and
    // in the live world any principal whose row went missing could sell its whole enrolment
    // allotment — the sell side of D7 reopened by a fallback. Absent must be the MAXIMUM
    // withholding, so a lost row costs selling power and never grants it.
    const book = new EndowmentBook();
    expect(book.remainingGoods(P)).toBe(ENDOWMENT_GOOD_FLOOR_QTY);
  });

  it('★ falls by exactly what was destroyed, and stops at zero', () => {
    // MUTATION: drop the `Math.max(0, ...)`. RED on the last line, and a negative counter would
    // make `held − remainingGoods` LARGER than the holding.
    const book = new EndowmentBook();
    book.retireGoods(P, qty(20_000));
    expect(book.remainingGoods(P)).toBe(ENDOWMENT_GOOD_FLOOR_QTY - 20_000);
    book.retireGoods(P, qty(20_000));
    expect(book.remainingGoods(P)).toBe(ENDOWMENT_GOOD_FLOOR_QTY - 40_000);
    book.retireGoods(P, qty(999_999));
    expect(book.remainingGoods(P)).toBe(0);
  });

  it('★ never rises — a destruction of zero or less is not a credit', () => {
    // MUTATION: remove the `amount <= 0` guard. A negative burn would ADD allotment back, which
    // is the one thing this counter must never do.
    //
    // The negative is CAST rather than built by `qty()`, which refuses one at the boundary. Both
    // guards are wanted: `qty()` is what stops a negative arriving through a verb, and this one
    // is what stops a caller that already holds a raw number from crediting the counter.
    const book = new EndowmentBook();
    book.retireGoods(P, qty(30_000));
    book.retireGoods(P, qty(0));
    book.retireGoods(P, -10_000 as ReturnType<typeof qty>);
    expect(book.remainingGoods(P)).toBe(ENDOWMENT_GOOD_FLOOR_QTY - 30_000);
  });

  it('★ is per principal — one principal delivering does not free another', () => {
    const book = new EndowmentBook();
    book.retireGoods(P, qty(ENDOWMENT_GOOD_FLOOR_QTY));
    expect(book.remainingGoods(P)).toBe(0);
    expect(book.remainingGoods(Q), "Q never delivered, so Q's allotment is untouched").toBe(
      ENDOWMENT_GOOD_FLOOR_QTY,
    );
  });

  it('★ THE TWO COUNTERS ARE INDEPENDENT — one row, two quantities, no crosstalk', () => {
    // ══════════════════════════════════════════════════════════════════════
    // The hazard created by nesting the goods counter in the currency counter's row. A single
    // shared number would be two units in one field (`one-word-two-units.spec.ts` catalogues
    // nine real bugs of exactly that shape) and, worse, it would make **burning currency free
    // the goods floor** — 250,000 of retired stake would clear a 50,000 allotment instantly,
    // which is the sell side of A15 handed away by an accounting shortcut.
    //
    // MUTATION: have `retire` also decrement `goods`, or have `retireGoods` read `remaining`.
    // RED here, and green in every other test in this file.
    // ══════════════════════════════════════════════════════════════════════
    const book = new EndowmentBook();
    book.retire(P, minor(250_000));
    expect(book.remaining(P), 'the stake is gone').toBe(0);
    expect(book.remainingGoods(P), 'and the allotment is untouched by it').toBe(
      ENDOWMENT_GOOD_FLOOR_QTY,
    );

    book.retireGoods(Q, qty(ENDOWMENT_GOOD_FLOOR_QTY));
    expect(book.remainingGoods(Q), 'the allotment is gone').toBe(0);
    expect(book.remaining(Q), 'and the stake is untouched by it').toBe(ENDOWMENT_FLOOR_MINOR);
  });

  it('★ a row created by a goods burn carries the untouched stake, and vice versa', () => {
    // The one consequence of sharing a row, stated as behaviour rather than left to be
    // discovered: a principal that has burned goods and never retired currency now HAS a row,
    // and its `remaining` must be exactly what the absent row would have answered — or INV-7's
    // mirror, which recomputes from the log, halts the world on a principal that did nothing
    // wrong.
    const book = new EndowmentBook();
    book.retireGoods(P, qty(1));
    expect(book.all()).toEqual([
      { principal: P, remaining: ENDOWMENT_FLOOR_MINOR, goods: ENDOWMENT_GOOD_FLOOR_QTY - 1 },
    ]);
    const other = new EndowmentBook();
    other.retire(P, minor(1));
    expect(other.all()).toEqual([
      { principal: P, remaining: ENDOWMENT_FLOOR_MINOR - 1, goods: ENDOWMENT_GOOD_FLOOR_QTY },
    ]);
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
    book.retireGoods(Q, qty(3_000));
    const captured = book.all();
    const other = new EndowmentBook();
    other.retire(Q, minor(9_999));
    other.retireGoods(P, qty(9_999));
    other.restore(captured);
    expect(other.all()).toEqual(captured);
    expect(other.remaining(Q)).toBe(STARTER_STAKE - 2_000);
    expect(other.remainingGoods(Q)).toBe(ENDOWMENT_GOOD_FLOOR_QTY - 3_000);
    expect(other.remainingGoods(P), 'and the row it replaced is gone, not merged').toBe(
      ENDOWMENT_GOOD_FLOOR_QTY,
    );
  });

  it('★ refuses a goods row above the allotment, because an allotment never grows', () => {
    // MUTATION: drop the goods upper-bound check. A capture claiming more allotment than was
    // ever minted is a corrupt triple, and the same hole read the other way is a principal
    // withholding goods it never had — refuse rather than clamp, exactly as the currency side.
    const book = new EndowmentBook();
    expect(() => {
      book.restore([
        { principal: P, remaining: STARTER_STAKE, goods: qty(ENDOWMENT_GOOD_FLOOR_QTY + 1) },
      ]);
    }).toThrow(EndowmentError);
  });

  it('★ refuses a negative or fractional goods row', () => {
    const book = new EndowmentBook();
    expect(() => {
      book.restore([{ principal: P, remaining: STARTER_STAKE, goods: -1 as ReturnType<typeof qty> }]);
    }).toThrow(EndowmentError);
    expect(() => {
      book.restore([
        { principal: P, remaining: STARTER_STAKE, goods: 0.5 as ReturnType<typeof qty> },
      ]);
    }).toThrow(EndowmentError);
  });

  it('★ AN ABSENT `goods` KEY IS MAXIMUM WITHHOLDING — the `RULES_VERSION` 19 capture', () => {
    // ══════════════════════════════════════════════════════════════════════
    // Every snapshot this world has ever written was written at 19 or earlier and has rows with
    // no `goods` key at all. The rule for a missing counter is the rule for a missing ROW:
    // revert to the pre-20 behaviour, which is a visible loss of selling power and never a
    // silent gain. A default of 0 here would make every principal in every historical
    // checkpoint able to sell its whole allotment the moment the snapshot was adopted.
    //
    // MUTATION: default the absent key to 0, or to the row's `remaining`. RED here.
    // ══════════════════════════════════════════════════════════════════════
    const book = new EndowmentBook();
    book.restore([{ principal: P, remaining: minor(1_000) }]);
    expect(book.remaining(P), 'the key that WAS there is honoured').toBe(1_000);
    expect(book.remainingGoods(P), 'and the one that was not withholds everything').toBe(
      ENDOWMENT_GOOD_FLOOR_QTY,
    );
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

describe('★ A15, the GOODS half: the arithmetic that makes an allotment unsellable', () => {
  it('a fresh identity can SELL nothing, exactly as before', () => {
    const led = allotted();
    expect(held(led, P), 'and it really holds the good').toBe(ENDOWMENT_GOOD_FLOOR_QTY);
    expect(sellableGoods(led, P, ENDOWMENT_GOOD, HOME), 'the allotment is not trading stock').toBe(0);
  });

  it('★ a destruction is sellable-NEUTRAL — you cannot launder an allotment by delivering it', () => {
    // ══════════════════════════════════════════════════════════════════════
    // THE LOAD-BEARING PROPERTY, and the goods twin of "burning it UNLOCKS NOTHING". If paying
    // a Levy out of the allotment freed the rest for sale, a puppet would convert its 50,000
    // units into sellable stock one delivery at a time and the sell side of A15 would be gone.
    // The holding falls by X and the counter falls by X, so the difference does not move.
    //
    // MUTATION: make `destroyGoods` skip the `endowments.retireGoods` call (the pre-20
    // behaviour). Every `sellableGoods` reading below stays 0 and only the LAST line — the
    // counter itself — goes red, which is exactly why the next test is here: neutrality alone is
    // satisfied by never moving the counter at all. Make the hook decrement by anything other
    // than the destroyed amount (`qty / 2`, or a flat constant): RED on the readings immediately.
    // ══════════════════════════════════════════════════════════════════════
    const led = allotted();
    for (const step of [20_000, 20_000, 9_000]) {
      consume(led, P, step);
      expect(
        sellableGoods(led, P, ENDOWMENT_GOOD, HOME),
        `after delivering ${String(step)} of pure allotment`,
      ).toBe(0);
    }
    expect(held(led, P)).toBe(ENDOWMENT_GOOD_FLOOR_QTY - 49_000);
    expect(led.endowments.remainingGoods(P)).toBe(ENDOWMENT_GOOD_FLOOR_QTY - 49_000);
  });

  it('★ but a principal that has DELIVERED keeps everything it PRODUCES — the defect, inverted', () => {
    // ══════════════════════════════════════════════════════════════════════
    // THIS IS THE TEST THE OLD RULE FAILS, and it is the whole change. Under a static floor:
    // the principal holds 50,000 − 40,000 + 12,000 = 22,000, the floor is 50,000, `sellable` is
    // 0 — it produced 12,000 units of the good every obligation in the game is priced in and
    // may sell none of them, forever, because it once paid its tribute. That is 123 of 576
    // measured observations, and `p:probe-scout-01` on the live shard permanently.
    //
    // MUTATION: revert `sellableLots` to `let floor = ENDOWMENT_GOOD_FLOOR_QTY`. RED here.
    // ══════════════════════════════════════════════════════════════════════
    const led = allotted();
    consume(led, P, 40_000);
    source(led, P, 12_000);
    expect(held(led, P)).toBe(22_000);
    expect(
      sellableGoods(led, P, ENDOWMENT_GOOD, HOME),
      'production is sellable however much allotment was delivered',
    ).toBe(12_000);
  });

  it('a destruction PAST the allotment consumes production, and sellable falls with it', () => {
    // The other side of the clamp: once the counter is 0 it cannot absorb any more, so a
    // further burn is production being destroyed and must show up as less to sell.
    const led = allotted(P, 30_000);
    expect(sellableGoods(led, P, ENDOWMENT_GOOD, HOME)).toBe(30_000);
    consume(led, P, ENDOWMENT_GOOD_FLOOR_QTY); // exactly the allotment
    expect(
      sellableGoods(led, P, ENDOWMENT_GOOD, HOME),
      'delivering the whole allotment leaves the production intact',
    ).toBe(30_000);
    consume(led, P, 11_000); // now into the production
    expect(led.endowments.remainingGoods(P)).toBe(0);
    expect(sellableGoods(led, P, ENDOWMENT_GOOD, HOME)).toBe(19_000);
  });

  it('★ N free identities put N x 0 of the good on a book — at N = 1, 4 and 16', () => {
    // ══════════════════════════════════════════════════════════════════════
    // THE SYBIL ARITHMETIC, AT THREE POPULATIONS. `test/market/the-sell-side-is-funded.spec.ts`
    // runs the same measurement against real seeded worlds with a WORKS at one system; this is
    // the closed-form floor of it, and it must hold for every puppet however much of its
    // allotment it has already spent — which is the case the static floor got right in the safe
    // direction and this rule must still get right.
    // ══════════════════════════════════════════════════════════════════════
    for (const n of [1, 4, 16]) {
      let sellable = 0;
      for (let i = 0; i < n; i += 1) {
        const who = `p:sock-${String(n)}-${String(i)}` as PrincipalId;
        const led = allotted(who);
        // Spend the allotment down the way a real newcomer does: a Levy, a WORKS, a crossing.
        consume(led, who, 5_000);
        consume(led, who, 5_000);
        consume(led, who, 20_000);
        sellable += sellableGoods(led, who, ENDOWMENT_GOOD, HOME);
      }
      expect(sellable, `${String(n)} free identities must yield zero sellable goods`).toBe(0);
    }
  });
});

describe('the goods hook is on the DOOR, not on the callers', () => {
  it('every destruction out of a principal STORES decrements, whatever the sink', () => {
    // MUTATION: scope the hook to one sink, or to one call site. RED for the other sinks — and
    // in the world, `GOODS_SINK.LOSS` is a raid destroying cargo, which must charge the
    // allotment for the same reason a Levy delivery does: the goods are gone either way, and a
    // floor that still withheld them would withhold something the principal does not have.
    for (const sink of [GOODS_SINK.LOSS, GOODS_SINK.CONSUMPTION, GOODS_SINK.PRODUCTION_INPUT]) {
      const led = allotted();
      const lot = led.lotsInAccount(storesAccount(P))[0];
      if (lot === undefined) throw new Error('fixture');
      led.destroyGoods({
        eventId: `e:sink:${sink}` as EventId,
        tick: 1,
        sink,
        lotId: lot.id,
        qty: qty(1_000),
      });
      expect(led.endowments.remainingGoods(P), `${sink} must charge the allotment too`).toBe(
        ENDOWMENT_GOOD_FLOOR_QTY - 1_000,
      );
    }
  });

  it('★ burning a DIFFERENT good never opens the allotment floor', () => {
    // ══════════════════════════════════════════════════════════════════════
    // The cross-good hole, and it would be free capacity: `ore` and `alloy` are produced, and a
    // hook that decremented the ration counter on any burn would let a principal refine its ore
    // into nothing and sell its untouched enrolment allotment. An allotment is minted in ONE
    // good (`test/core/goods-are-independent.test.ts` keeps the four constants from collapsing
    // into one) and only that good may charge it.
    //
    // MUTATION: drop the `good === ENDOWMENT_GOOD` test in `destroyGoods`. RED here.
    // ══════════════════════════════════════════════════════════════════════
    const led = allotted();
    source(led, P, 40_000, HOME, OTHER_GOOD);
    consume(led, P, 40_000, HOME, OTHER_GOOD);
    expect(led.endowments.remainingGoods(P), 'burning ore is not delivering rations').toBe(
      ENDOWMENT_GOOD_FLOOR_QTY,
    );
    expect(sellableGoods(led, P, ENDOWMENT_GOOD, HOME)).toBe(0);
  });

  it('a destruction out of an ESCROW charges nobody — it is not a principal store', () => {
    // MUTATION: drop the `kind === 'STORES'` test. Goods burning inside a market or venture
    // escrow would then free the owner's allotment, which is stock the owner never got back.
    const led = allotted();
    const esc = 'escrow:market:p:one';
    led.openAccount(esc as never, 'ESCROW', P);
    const lot = led.lotsInAccount(storesAccount(P))[0];
    if (lot === undefined) throw new Error('fixture');
    const moved = led.transferGoods({
      eventId: 'e:escrow' as EventId,
      tick: 1,
      lotId: lot.id,
      to: esc as never,
      qty: qty(10_000),
    });
    expect(
      led.endowments.remainingGoods(P),
      'escrowing is not spending it on the world',
    ).toBe(ENDOWMENT_GOOD_FLOOR_QTY);
    led.destroyGoods({
      eventId: 'e:esc-burn' as EventId,
      tick: 1,
      sink: GOODS_SINK.LOSS,
      lotId: moved,
      qty: qty(10_000),
    });
    expect(led.endowments.remainingGoods(P)).toBe(ENDOWMENT_GOOD_FLOOR_QTY);
  });

  it('★ a TRANSFER never decrements — a SALE is not a delivery', () => {
    // ══════════════════════════════════════════════════════════════════════
    // The goods twin of the term `TRACKER.md` got wrong on the currency side. A sale already
    // lowers the holding, so `held − remainingGoods` falls by what left; decrementing the
    // counter TOO would leave `sellable` unchanged after a sale, i.e. an unbounded one — a
    // principal could sell the same 10,000 units over and over. **Destruction and transfer are
    // different acts.**
    //
    // MUTATION: add a `this.endowments.retireGoods(...)` call to `transferGoods`. RED here.
    // ══════════════════════════════════════════════════════════════════════
    const led = allotted(P, 10_000);
    // Q is enrolled with its OWN allotment, because that is what a real counterparty is. Without
    // it Q would hold 10,000 against a 50,000 withholding and read 0 — which would be the
    // engine right and the fixture wrong, and the first draft of this test asserted it as a bug.
    led.openAccount(storesAccount(Q), 'STORES', Q);
    source(led, Q, ENDOWMENT_GOOD_FLOOR_QTY);
    expect(sellableGoods(led, P, ENDOWMENT_GOOD, HOME)).toBe(10_000);
    expect(sellableGoods(led, Q, ENDOWMENT_GOOD, HOME), 'and Q starts with nothing sellable').toBe(0);
    // Sell the surplus. The lot the walk leaves sellable is the second one, by canonical order.
    const surplus = led.lotsInAccount(storesAccount(P)).find((lot) => lot.qty === 10_000);
    if (surplus === undefined) throw new Error('fixture');
    led.transferGoods({
      eventId: 'e:sold' as EventId,
      tick: 1,
      lotId: surplus.id,
      to: storesAccount(Q),
      qty: qty(10_000),
    });
    expect(
      led.endowments.remainingGoods(P),
      'a sale spends production, not the allotment',
    ).toBe(ENDOWMENT_GOOD_FLOOR_QTY);
    expect(
      sellableGoods(led, P, ENDOWMENT_GOOD, HOME),
      'and what it sold is gone, so it cannot sell it twice',
    ).toBe(0);
    expect(
      sellableGoods(led, Q, ENDOWMENT_GOOD, HOME),
      'while the BUYER may resell it — it was paid, not granted',
    ).toBe(10_000);
  });

  it('★ THE LATENT DEFECT: goods split across two venues are withheld ONCE, not twice', () => {
    // ══════════════════════════════════════════════════════════════════════
    // The branch nothing in this repo has ever reached: every principal in every swept world
    // keeps its `ration` at one venue (`splitVenues = 0` over 576 observations), so the old
    // per-`(principal, venue)` floor was never observed charging twice. It would have: a
    // principal holding 60,000 split 30,000/30,000 was refused at BOTH venues, because each was
    // charged the whole 50,000. **A single per-principal counter deletes the branch**, and this
    // is the test that says so, since nothing else reaches it.
    //
    // MUTATION: restore the per-venue floor (filter by `venue` before the withholding walk).
    // RED — both venues answer 0 and the total is 0 instead of 10,000.
    // ══════════════════════════════════════════════════════════════════════
    const led = new Ledger();
    led.openAccount(storesAccount(P), 'STORES', P);
    source(led, P, 30_000, HOME);
    source(led, P, 30_000, AWAY);
    expect(held(led, P), 'non-vacuity: 60,000 across two systems').toBe(60_000);

    const atHome = Number(sellableGoods(led, P, ENDOWMENT_GOOD, HOME));
    const atAway = Number(sellableGoods(led, P, ENDOWMENT_GOOD, AWAY));
    expect(
      atHome + atAway,
      'the allotment is charged once, so the surplus over it is sellable somewhere',
    ).toBe(60_000 - ENDOWMENT_GOOD_FLOOR_QTY);
    // WHICH venue bears the withholding is decided by canonical lot order, not by pro-rata —
    // a share-out would need a division and a float in a value path cannot be reconciled. The
    // first lot in id order is charged first, so the surplus lands on the later one.
    expect(atHome, 'the earlier lot in canonical order is withheld first').toBe(0);
    expect(atAway).toBe(10_000);
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

  // ── ★ THE GOODS HALF OF THE MIRROR (`RULES_VERSION` 20) ─────────────────────

  it('★ recomputes the ALLOTMENT counter from the log, and the check is not vacuous', () => {
    const led = allotted(P, 8_000);
    consume(led, P, 31_000);
    // Non-vacuity FIRST: the mirror must have a row whose value is NOT the default, or a green
    // result is a green result over the untouched case and proves nothing.
    expect(led.endowments.all().length, 'the mirror must have a subject').toBe(1);
    expect(led.endowments.remainingGoods(P)).toBe(ENDOWMENT_GOOD_FLOOR_QTY - 31_000);
    expect(checkInv7(led, 1)).toEqual([]);
  });

  it('★ HALTS when the allotment counter is cleared behind its back — the Book.prune hazard', () => {
    // ══════════════════════════════════════════════════════════════════════
    // The goods twin of the currency case above, and the answer to the question a future
    // session will ask: *"would anything notice if a prune ate this row?"* `restore([])` is
    // exactly what a prune, a per-Reckoning reset, or a capture that forgot the key would do.
    //
    // MUTATION: delete the goods clause from mirror 4. RED here — and in the live world the
    // counter could be zeroed and every principal would silently revert to the pre-20
    // over-withholding, with no alarm anywhere. Note this halts *even though* the currency
    // counter is untouched, which is the property that makes the two independent.
    // ══════════════════════════════════════════════════════════════════════
    const led = allotted(P);
    consume(led, P, 31_000);
    expect(checkInv7(led, 1), 'clean before the mutation, or this proves nothing').toEqual([]);

    led.endowments.restore([]); // the prune
    const violations = checkInv7(led, 2);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]?.id).toBe('INV-7');
    expect(violations.some((x) => x.message.includes(ENDOWMENT_GOOD))).toBe(true);
  });

  it('★ HALTS when the allotment counter drifts UP, which is the A15 direction', () => {
    // A counter that grew would hand a puppet sellable goods. The mirror does not care which
    // way the drift went; both are published-record corruption.
    const led = allotted(P);
    consume(led, P, 31_000);
    led.endowments.restore([
      { principal: P, remaining: STARTER_STAKE, goods: ENDOWMENT_GOOD_FLOOR_QTY },
    ]);
    expect(checkInv7(led, 2).length).toBeGreaterThan(0);
  });

  it('★ is satisfied by a world where BOTH counters have moved', () => {
    // The two clauses must not be checking each other's subject. A ledger that has retired
    // currency AND destroyed goods is the only case where a mirror reading the wrong
    // accumulator would still look clean in the tests above.
    const led = enrolled(P, 10_000);
    source(led, P, ENDOWMENT_GOOD_FLOOR_QTY + 4_000);
    burn(led, P, 70_000);
    consume(led, P, 12_000);
    expect(led.endowments.remaining(P)).toBe(STARTER_STAKE - 70_000);
    expect(led.endowments.remainingGoods(P)).toBe(ENDOWMENT_GOOD_FLOOR_QTY - 12_000);
    expect(checkInv7(led, 1)).toEqual([]);
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

  it('★ two worlds that DELIVERED differently capture differently', () => {
    // ══════════════════════════════════════════════════════════════════════
    // The goods twin, and it needs its own test rather than riding the currency one: the
    // `endowments` key was already in the capture at 19, so the pair above passes with the
    // `goods` field omitted entirely. This is the assertion that the FIELD is in the hash input.
    //
    // **The first draft of this test was vacuous and the mutation is what proved it.** It gave
    // one ledger a row and the other none, so the captures differed by a ROW rather than by a
    // FIELD, and deleting `goods:` from `capture()` left all 47 tests green. The second draft
    // built two ledgers and compared them, which is vacuous a different way: event ids come off
    // a module counter, so two "identical" worlds capture different lot ids.
    //
    // So it is ONE ledger, captured three times, with nothing changed between them but the
    // counter — moved by a single unit and then moved back.
    //
    // MUTATION: delete `goods:` from `ledgerStateTable.capture()`'s endowments map. RED here,
    // GREEN on the currency pair above.
    // ══════════════════════════════════════════════════════════════════════
    const led = allotted();
    consume(led, P, 7_000);
    const capture = (): string =>
      canonicalHash(ledgerStateTable(() => led, () => undefined).capture());

    const before = capture();
    const stake = led.endowments.remaining(P);
    const allotment = led.endowments.remainingGoods(P);
    expect(allotment, 'non-vacuity: the counter must have moved off its default').toBe(
      ENDOWMENT_GOOD_FLOOR_QTY - 7_000,
    );

    led.endowments.restore([{ principal: P, remaining: stake, goods: qty(allotment - 1) }]);
    expect(capture(), 'one unit of allotment must move the capture, alone').not.toBe(before);

    // And back, which is what says the hash was seeing the counter rather than the restore.
    led.endowments.restore([{ principal: P, remaining: stake, goods: allotment }]);
    expect(capture(), 'and putting it back must re-capture identically').toBe(before);
  });

  it('round-trips through capture and restore byte-identically', () => {
    const led = enrolled(P, 5_000);
    source(led, P, ENDOWMENT_GOOD_FLOOR_QTY);
    consume(led, P, 2_222);
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
