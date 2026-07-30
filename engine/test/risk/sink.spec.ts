/**
 * ★ §10.1's FOURTH GOODS SINK IS A SINK FOR ALL FOUR GOODS — plus the `DUE` state and the lapse reason.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ## The measurement
 *
 * `FRONT_SPARES_QTY` was `LEVY_DUTY_PER_PRINCIPAL / LEVY_UNIT_MINOR` — **20,000**, derived for `ration`
 * from a `ration`-denominated duty for a stated A5′ reason. `destroySet` then keyed its spare ledger on
 * `${lot.account}::${lot.good}` and charged that one number against **every good**. Driven:
 *
 * ```
 * exposed (account, good) groups   13
 * groups that clear the floor       5      ← all five are `ration`
 * ore  peaks at   720
 * alloy peaks at  500
 * fuel  peaks at 1,200
 * ```
 *
 * A holder of ≤ 20,000 units of anything lost **exactly zero at any intensity**. So §10.1's *"fourth
 * goods sink"* was a `ration`-only sink, and the front could not touch the three goods the demand side
 * runs on. That is *"a cap sized for one good and applied to four"* — the same shape as the flat weight
 * that made three of the Levy's four allocation rules decoration.
 *
 * `agent.md` also states the floor as **2,000**, which is wrong by 10× against the old constant and
 * describes neither of the two the engine now uses. That file is another lode's this round; the numbers
 * a doc must state are asserted here so a fix has something to be checked against.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { GoodId } from '../../src/core/types.js';
import { LEVY_DUTY_PER_PRINCIPAL, LEVY_GOOD, LEVY_UNIT_MINOR } from '../../src/levy/params.js';
import { ALLOY_GOOD, FUEL_GOOD, WORKS_YIELD_GOOD } from '../../src/works/params.js';
import { storesAccount } from '../../src/ledger/accounts.js';
import {
  COVER_ELECTIVE_BPS_CEILING,
  destroySet,
  FRONT_SPARES_LEVY_QTY,
  FRONT_SPARES_OTHER_QTY,
  frontSparesFor,
  riskSubjects,
} from '../../src/risk/index.js';
import {
  FIRST_ANNOUNCE_TICK,
  FIRST_FRONT_RECKONING,
  FIRST_LANDFALL_TICK,
  act,
  eventsOfKind,
  fund,
  riskWorld,
  runTo,
  seatsFor,
  stockAt,
  tick,
} from './fixture.js';

const SETTLE_TICK = FIRST_FRONT_RECKONING * TICKS_PER_RECKONING + TICKS_PER_RECKONING - 1;

/** The three goods nothing in this game is payable in, at the scales a real world actually holds. */
const OTHERS: readonly [GoodId, number][] = [
  [WORKS_YIELD_GOOD, 720],
  [ALLOY_GOOD, 500],
  [FUEL_GOOD, 1_200],
];

describe('★ the spare floor is per-GOOD, and three goods used to be untouchable', () => {
  it('is not vacuous: the two floors are different numbers and one is derived', () => {
    expect(FRONT_SPARES_LEVY_QTY, 'the levy good’s floor is one Reckoning’s flat duty').toBe(
      Math.trunc(LEVY_DUTY_PER_PRINCIPAL / LEVY_UNIT_MINOR),
    );
    // MUTATION: drop the `Math.trunc` and this stays green **only** while `LEVY_UNIT_MINOR === 1`. The
    // file's own header claims *"Integers throughout: no float reaches a hash"*, and this number reaches
    // `destroySet`, which decides a hashed quantity. One constant change from false.
    expect(Number.isInteger(FRONT_SPARES_LEVY_QTY), 'and it is an integer by construction').toBe(true);
    expect(FRONT_SPARES_OTHER_QTY, 'every other good gets a token floor, not a shield').toBeLessThan(
      FRONT_SPARES_LEVY_QTY,
    );
    expect(frontSparesFor(LEVY_GOOD), 'and one function is the only door to either').toBe(
      FRONT_SPARES_LEVY_QTY,
    );
    for (const [good] of OTHERS) {
      expect(frontSparesFor(good), `${good} takes the other floor`).toBe(FRONT_SPARES_OTHER_QTY);
    }
  });

  it('★★ a FRONT takes ore, alloy AND fuel — all three used to lose exactly zero', () => {
    const world = riskWorld('sink-goods', 3, 'MARCHES');
    const { runtime, principals } = world;
    const holder = principals[0];
    if (holder === undefined) throw new Error('unreachable');
    runTo(runtime, FIRST_ANNOUNCE_TICK);
    const front = runtime.risk.allFronts()[0];
    if (front === undefined) throw new Error('unreachable');
    const cell = [...front.swath].sort((a, b) => b.intensityBps - a.intensityBps)[0];
    if (cell === undefined) throw new Error('unreachable');

    // ★ THE REVIEWER'S MEASURED SCALES, not round test numbers. `ore` peaked at 720 in a driven world,
    // `alloy` at 500, `fuel` at 1,200 — every one of them two orders of magnitude under a 20,000 floor.
    stockAt(runtime, holder, cell.system, 400_000, LEVY_GOOD);
    for (const [good, qty] of OTHERS) stockAt(runtime, holder, cell.system, qty, good);

    const set = destroySet(front, runtime.ledger.allLots());
    const goods = new Set(set.map((l) => l.good));
    // MUTATION: restore a single `FRONT_SPARES_QTY = 20_000` in `destroySet` and this goes red on every
    // good but `ration` — which is exactly the state §10.1's fourth sink shipped in.
    expect(goods, 'ration burns').toContain(LEVY_GOOD);
    for (const [good] of OTHERS) {
      expect(goods, `${good} burns too — nothing in this game is payable in it`).toContain(good);
    }
    expect(goods.size, 'all four goods are in the destroy set').toBe(4);
  });

  it('★ and the LEVY good keeps its floor, because that half really is A5′', () => {
    const world = riskWorld('sink-levy', 3, 'MARCHES');
    const { runtime, principals } = world;
    const holder = principals[0];
    if (holder === undefined) throw new Error('unreachable');
    runTo(runtime, FIRST_ANNOUNCE_TICK);
    const front = runtime.risk.allFronts()[0];
    if (front === undefined) throw new Error('unreachable');
    const cell = [...front.swath].sort((a, b) => b.intensityBps - a.intensityBps)[0];
    if (cell === undefined) throw new Error('unreachable');

    // A holder with exactly one duty's worth of `ration` must end the front still able to pay it. A
    // front that can take the last unit leaves a principal holding the LEVY with no way to pay: **A5′
    // with our own economy as the cause**, which `ledger/endowment.ts` refused to ship.
    stockAt(runtime, holder, cell.system, FRONT_SPARES_LEVY_QTY, LEVY_GOOD);
    const set = destroySet(front, runtime.ledger.allLots());
    expect(
      set.filter((l) => l.good === LEVY_GOOD).length,
      'at exactly one duty, the front takes no ration at all',
    ).toBe(0);

    // One unit more and the excess is exposed — the floor is a floor, not an exemption.
    stockAt(runtime, holder, cell.system, 200_000, LEVY_GOOD);
    const bigger = destroySet(front, runtime.ledger.allLots());
    expect(
      bigger.filter((l) => l.good === LEVY_GOOD).length,
      'above it, ration burns like anything else',
    ).toBeGreaterThan(0);
  });

  it('★ the floor is charged ONCE per (account, good), not once per struck system', () => {
    const world = riskWorld('sink-once', 3, 'MARCHES');
    const { runtime, principals } = world;
    const holder = principals[0];
    if (holder === undefined) throw new Error('unreachable');
    runTo(runtime, FIRST_ANNOUNCE_TICK);
    const front = runtime.risk.allFronts()[0];
    if (front === undefined) throw new Error('unreachable');
    expect(front.swath.length, 'the front strikes more than one system').toBeGreaterThan(1);

    // The same good, under the floor, at two struck systems. Charged per system it would survive both;
    // charged per `(account, good)` the second one is exposed. `destroySet` says the latter and this is
    // the assertion that keeps it saying it.
    const half = Math.trunc(FRONT_SPARES_OTHER_QTY / 2) + 40;
    expect(half, 'each holding on its own is UNDER the floor').toBeLessThan(FRONT_SPARES_OTHER_QTY);
    expect(2 * half, 'and the two together are OVER it — which is the whole test').toBeGreaterThan(
      FRONT_SPARES_OTHER_QTY,
    );
    for (const cell of front.swath.slice(0, 2)) {
      stockAt(runtime, holder, cell.system, half, ALLOY_GOOD);
    }
    const destroyed = destroySet(front, runtime.ledger.allLots())
      .filter((l) => l.good === ALLOY_GOOD)
      .reduce((s, l) => s + l.qty, 0);
    // Charged **per struck system** the floor would spare both holdings whole and this would be 0.
    // Charged once per `(account, good)` — which is what `destroySet` says and what the constant's
    // docblock promises — the excess over one floor is exposed. MUTATION: move the `spared` map's key to
    // `${lot.account}::${lot.good}::${lot.location}` and this goes red.
    expect(destroyed, 'the excess over ONE floor really burns').toBeGreaterThan(0);
  });
});

describe('★ `cover.lapsed` tells "nobody wanted it" from "the storm missed"', () => {
  it('★★ an unbound offer lapses UNTAKEN — every lapse used to read NO_LOSS', () => {
    const world = riskWorld('lapse-untaken', 4, 'MARCHES');
    const { runtime } = world;
    const [payer, bank] = seatsFor(world, 0, 2);
    fund(runtime, bank, payer, 200_000);
    runTo(runtime, FIRST_ANNOUNCE_TICK);
    const front = runtime.risk.allFronts()[0];
    if (front === undefined) throw new Error('unreachable');
    const cell = front.swath[0];
    if (cell === undefined) throw new Error('unreachable');

    const offered = act(runtime, payer, 'publish_offer', {
      kind: 'COVER',
      system: cell.system,
      good: LEVY_GOOD,
      limit: 60_000,
      premium: 1_000,
      elective_bps: COVER_ELECTIVE_BPS_CEILING,
    });
    expect(offered, `publish_offer refused: ${offered?.hint ?? ''}`).toBeNull();
    const cover = runtime.risk.coversBy(payer)[0];
    if (cover === undefined) throw new Error('unreachable');
    // Non-vacuity: it really is unbound, so the branch under test is the one that runs.
    expect(cover.payee, 'nobody took it').toBeNull();
    expect(cover.state, 'and it is still OFFERED').toBe('OFFERED');

    const before = runtime.ledger.balance(storesAccount(payer));
    runTo(runtime, cover.offerExpiresTick + 2);

    const lapsed = eventsOfKind(runtime, 'cover.lapsed');
    expect(lapsed.length, 'the offer lapsed').toBe(1);
    // ★ THE FIX. `reason` was computed from `cover.state` **after** `resolveCover` had overwritten it
    // with `'LAPSED'`, so the `'OFFERED' ? 'UNTAKEN'` test could never be true. Since an offer nobody
    // takes is by far the most frequent risk row a quiet world produces, the append-only record's most
    // common statement about this whole market was *"the storm missed"* when the truth was *"nobody
    // wanted it"* — two different facts about the payer's business.
    //
    // MUTATION: move the `reason` computation back below `book.resolveCover(...)` and this goes red.
    expect((lapsed[0]?.payload as Record<string, string>)['why'], 'and it says so').toBe('UNTAKEN');
    const after = runtime.ledger.balance(storesAccount(payer));
    expect(after, 'and the escrow went home — the payer’s business model').toBeGreaterThan(before);
  });

  it('★ a bound COVER a FRONT missed lapses NO_LOSS, and the premium is KEPT', () => {
    const world = riskWorld('lapse-noloss', 4, 'MARCHES');
    const { runtime } = world;
    const [payer, holder, bankA, bankB] = seatsFor(world, 0, 1, 2, 3);
    fund(runtime, bankA, payer, 200_000);
    fund(runtime, bankB, holder, 200_000);
    runTo(runtime, FIRST_ANNOUNCE_TICK);
    const front = runtime.risk.allFronts()[0];
    if (front === undefined) throw new Error('unreachable');
    // ★ A system the front will NOT strike — the whole point of this row's second reason. Taken from
    // the cone's spared cells, which the truncation fix guarantees exist.
    const missed = front.cone.map((c) => c.system).find((s) => !front.swath.some((c) => c.system === s));
    expect(missed, 'the cone names systems the swath spares, or this case is unreachable').toBeDefined();
    if (missed === undefined) throw new Error('unreachable');
    stockAt(runtime, holder, missed, 400_000, LEVY_GOOD);

    act(runtime, payer, 'publish_offer', {
      kind: 'COVER',
      system: missed,
      good: LEVY_GOOD,
      limit: 60_000,
      premium: 1_000,
      elective_bps: COVER_ELECTIVE_BPS_CEILING,
    });
    const cover = runtime.risk.coversBy(payer)[0];
    if (cover === undefined) throw new Error('unreachable');
    const signed = act(runtime, holder, 'sign', { cover: cover.id, terms_hash: cover.termsHash ?? '' });
    expect(signed, `sign refused: ${signed?.hint ?? ''}`).toBeNull();
    expect(cover.payee, 'it is bound, so the OTHER branch runs').toBe(holder);

    runTo(runtime, cover.expiresTick + 2);
    const lapsed = eventsOfKind(runtime, 'cover.lapsed');
    expect(lapsed.length, 'the bound cover lapsed').toBe(1);
    expect((lapsed[0]?.payload as Record<string, string>)['why'], 'the storm missed').toBe('NO_LOSS');
    expect(
      runtime.risk.record(payer).premiumEarned,
      '★ and the premium is kept — the whole return on writing risk',
    ).toBeGreaterThan(0);
  });
});

describe('★ the `DUE` state has a writer, and the freeze is what it means', () => {
  it('★★ an INDEMNITY goes OPEN → DUE → PAID — it never entered DUE at all before', () => {
    const world = riskWorld('due-state', 5, 'MARCHES');
    const { runtime } = world;
    const [holder, payer, bankA, bankB] = seatsFor(world, 0, 1, 3, 4);
    fund(runtime, bankA, payer, 200_000);
    fund(runtime, bankB, holder, 200_000);
    runTo(runtime, FIRST_ANNOUNCE_TICK);
    const front = runtime.risk.allFronts()[0];
    if (front === undefined) throw new Error('unreachable');
    const cell = [...front.swath].sort((a, b) => b.intensityBps - a.intensityBps)[0];
    if (cell === undefined) throw new Error('unreachable');
    stockAt(runtime, holder, cell.system, 400_000, LEVY_GOOD);
    act(runtime, payer, 'publish_offer', {
      kind: 'COVER',
      system: cell.system,
      good: LEVY_GOOD,
      limit: 60_000,
      premium: 1_000,
      elective_bps: COVER_ELECTIVE_BPS_CEILING,
    });
    const cover = runtime.risk.coversBy(payer)[0];
    if (cover === undefined) throw new Error('unreachable');
    act(runtime, holder, 'sign', { cover: cover.id, terms_hash: cover.termsHash ?? '' });

    runTo(runtime, FIRST_LANDFALL_TICK);
    tick(runtime);
    const ind = runtime.risk.indemnityForCover(cover.id);
    expect(ind?.state, 'at landfall it is OPEN — the payer may still decide').toBe('OPEN');
    expect(riskSubjects(runtime.risk).dueIndemnities, 'and nothing is DUE yet').toBe(0);

    const elected = act(runtime, payer, 'elect', { cover: cover.id, election: 'IN_FULL' });
    expect(elected, `the payer could not elect while OPEN: ${elected?.hint ?? ''}`).toBeNull();

    // ★ THE FREEZE. `markDue` is `DUE`'s only writer, and the tick it fires on is what gives the state
    // its meaning: the election that will settle this INDEMNITY stops being restatable in any way the
    // settlement can see. Before this, `'DUE'` was a value in a union with **seven** readers and no
    // writer — this repo's signature defect arriving at the type depth.
    //
    // MUTATION: delete the `markDue(port.book, port.tick)` line from `runFrontPhase` and this goes red,
    // and `dueIndemnities` returns to being identically 0 for the life of every world.
    runTo(runtime, SETTLE_TICK - 1);
    expect(runtime.risk.indemnityForCover(cover.id)?.state, 'after the freeze it is DUE').toBe('DUE');
    expect(riskSubjects(runtime.risk).dueIndemnities, 'and the counter says so').toBe(1);

    // And a DUE row is still settleable, which is the property the seven predicates were written for.
    tick(runtime);
    expect(runtime.risk.indemnityForCover(cover.id)?.state, 'then it settles').toBe('PAID');
  });
});
