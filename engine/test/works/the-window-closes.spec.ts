/**
 * ★ THE ENTRY PRICE OF THE ECONOMY'S ONLY FAUCET WAS DENOMINATED IN THE GOOD IT IS THE ONLY
 * SOURCE OF — SO A PRINCIPAL THAT RAN DRY WAS LOCKED OUT PERMANENTLY. **THE DRAIN IS STILL
 * REAL; THE LOCKOUT IS FIXED, AND THIS FILE IS BOTH HALVES.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHY THIS FILE EXISTS: A LADDER THAT PASSED 36 SEEDS AND DID NOTHING IN PRODUCTION.**
 *
 * The territorial ladder shipped on 2026-07-27 and its balance gate was clean on 36 fresh
 * seeds — 11–12 live claims, ~34,000 rent collected, 18 hulls, 25 battles, `levyShort` 0.
 * In the live world, 120 ticks after the deploy: `works 5 · worksOnline 5 · claimLines 0 ·
 * battleLines 0`, and four of the five WORKS belonged to abandoned playtest probes.
 *
 * `worksAffordableBy` read **15**, which was taken as evidence that the goods half of the
 * gate was met. It is a count over *every seated principal*, and the 15 were the 15
 * abandoned probe accounts still sitting on untouched enrolment allotments. **Not one was a
 * cast member.** Measured on the live snapshot at tick 5,471: the twelve cast members held
 * 210,000–225,333 in currency and **zero units of every good in the game.**
 *
 * ── THE MECHANISM, AND IT WAS A DEADLOCK RATHER THAN A CALIBRATION ───────────
 *
 * Goods enter a principal at exactly two places (`grep -rn "sourceGoods(" src`):
 *
 *   1. the **enrolment allotment** — `LEVY_STARTER_ALLOTMENT`, once per identity, and A15
 *      forbids pricing anything in a second identity;
 *   2. a **WORKS it already holds** — plus `refine`, which converts the `ore` a WORKS
 *      yields.
 *
 * Against that, the Levy destroys goods every Reckoning and the Charge destroys more. So the
 * allotment is a **window, not a balance**, and every rung of the ladder was priced inside it:
 * `WORKS_BUILD_QTY` 5,000 · `GRADUATION_UPKEEP_QTY` 5,000 · `ANCHOR_QTY` 5,000. Miss the
 * window and the only door to the goods economy was bolted from the inside — with, in
 * production's case, a quarter of a million in currency in hand. **Its only escape was a
 * second identity, which prices economic re-entry in identities: A15 exactly inverted.**
 *
 * `works/params.ts` was written to close exactly this hazard and states it in its own header:
 * *"the terminal state is not a rising meter: it is a world where **every** obligation is
 * unpayable, every claim lapses, and the record accuses every principal of a default that our
 * own arithmetic made unavoidable"*, and *"a floor an agent starves on is not a floor"* (A8).
 * The module built the faucet and then priced its tap in the good behind the drain.
 *
 * ── WHY 3,184 TESTS AND 26 INVARIANTS MISSED IT: EVERY SIM STARTS AT TICK 0 ──
 *
 * `reachable.spec.ts` asserts *"a newcomer can raise its first WORKS"* at tick 1.
 * `economy-has-a-source.spec.ts` asserts goods enter through a place. Both are true and both
 * are about a **fresh** principal. The longest sim in the corpus was 900 ticks, and at three
 * Reckonings the allotment still holds 9,000 units against a 5,000 price — so every gate was
 * still open and every assertion still passed. The window closes on tick 1,439, five hundred
 * ticks past the end of the longest thing anybody ran.
 *
 * ── WHAT CHANGED, AND WHAT DELIBERATELY DID NOT ──────────────────────────────
 *
 * `WORKS_GOODS_IN_CURRENCY_MINOR` — **the goods half of a principal's FIRST WORKS is payable
 * in retired currency.** It exploits the trap's own signature: a drained principal has money
 * and no goods, and the Levy does not destroy currency. Retirement, not transfer, so D7 never
 * engages; first WORKS only, so it is a floor rather than an alternative price; and dearer
 * than the goods it replaces, so a solvent principal always pays in goods.
 *
 * **The drain curve is unchanged and this file still pins it to the unit.** That was never the
 * defect: the Levy's nominal rate against a finite grant is the meter working, and `runtime.ts`
 * predicted the shape in 2026. What changed is that reaching zero is no longer the end of the
 * game. So the tests below assert the *same* drain and the *opposite* consequence — and the
 * distinction is load-bearing, because the next person to tune `LEVY_STARTER_ALLOTMENT`, the
 * tribute rate or any entry price still has to read this first.
 *
 * **`GRADUATION_UPKEEP_QTY` and `ANCHOR_QTY` were left alone, by measurement rather than by
 * scope.** *every rung above the door is reachable out of PRODUCTION* below is that
 * measurement: a principal that comes through the door holds 23,920 units one Reckoning later
 * and both rungs are open. Widening the fix would have been a price change with no defect
 * behind it.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../src/api/observe.js';
import { setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';
import { LEVY_STARTER_ALLOTMENT, LEVY_UNIT_MINOR } from '../../src/levy/index.js';
import { GOODS_FAUCET } from '../../src/ledger/index.js';
import { STARTER_STAKE } from '../../src/ledger/endowment.js';
import { Runtime } from '../../src/sim/runtime.js';
import { GRADUATION_UPKEEP_QTY } from '../../src/world/graduation.js';
import { ANCHOR_QTY } from '../../src/sovereignty/params.js';
import {
  WORKS_BUILD_QTY,
  WORKS_COST_MINOR,
  WORKS_GOOD,
  WORKS_GOODS_IN_CURRENCY_MINOR,
  WORKS_SPINUP_TICKS,
  WORKS_YIELD_GOOD,
  YIELD_PER_TICK,
} from '../../src/works/params.js';
import { commonsSystems, holdingOf } from '../../src/world/index.js';
import {
  agedWorld,
  drainedThenBuilds,
  ENDOWMENT_WINDOW_RECKONINGS,
  soloPayerRationByReckoning,
  WINDOW_CLOSES_AFTER_TICK,
} from './aged.js';

const MINUTES = 300_000;

describe('the enrolment allotment is a WINDOW, not a balance', () => {
  it('★ a principal that only pays its tribute runs out of goods at Reckoning 5 — and is NOT locked out', () => {
    const { runtime, who, perReckoning } = soloPayerRationByReckoning('window-solo', 6);
    const seat = holdingOf(runtime.world, who).system;

    // ── THE CURVE, CHECKED AGAINST PRODUCTION ────────────────────────────────
    //
    // The live world's four surviving snapshots hold this exact sequence for its cast
    // members at ticks 287 · 575 · 863 · 1,151. A one-principal reproduction matching a
    // twelve-member world to the unit is what says the drain is structural rather than
    // anything the cast chose — it is the Levy's nominal rate against a finite grant, and
    // nothing else is in it.
    //
    // **STILL PINNED AFTER THE FIX, ON PURPOSE.** The drain was never the defect and it has
    // not moved by a unit; what moved is what a principal at zero can do. A test that relaxed
    // this would stop being able to tell "the door opened" from "the drain got slower".
    expect(perReckoning.slice(0, 6), 'the drain curve production ran down').toEqual([
      49_500, 49_000, 29_000, 9_000, 0, 0,
    ]);

    // ── THE ASYMMETRY IS THE WHOLE FINDING, AND NOW IT IS THE WHOLE FIX ──────
    //
    // Not "it went broke". The currency half of every gate is fully intact — this principal
    // has never spent a unit of its stake — and the goods half is zero. A diagnosis that
    // reads `affordable: false` and concludes "no money" looks at the wrong half and stays
    // wrong for as long as it is believed, which is what happened for a night.
    //
    // That asymmetry is exactly what the currency door is priced against, so the assertion that
    // used to read `false` now reads `true` — with the goods still at zero, which is the part
    // that must not quietly change underneath this.
    const works = runtime.worksQuote(who, seat);
    expect(works.freeMinor, 'the stake is untouched').toBeGreaterThanOrEqual(works.costMinor);
    expect(works.availableQty, `no ${WORKS_GOOD} anywhere`).toBe(0);
    expect(works.firstWorks, 'and it has never held a WORKS, so the door is open to it').toBe(true);
    expect(
      works.payingGoodsInCurrency,
      'the goods are short and the currency covers the whole price, so this build takes the door',
    ).toBe(true);
    expect(works.totalMinor, 'which is what it will actually retire').toBe(
      WORKS_COST_MINOR + WORKS_GOODS_IN_CURRENCY_MINOR,
    );
    expect(
      works.affordable,
      '★ THE INVERSION. This asserted `false` for as long as the trap existed: a WORKS was ' +
        'unaffordable on the GOODS half alone with the currency half fully covered, and a principal ' +
        'in that state could never build, cross, claim or arm again. If this goes back to `false` the ' +
        'lockout is back and economic re-entry is priced in identities again (A15).',
    ).toBe(true);

    // ── AND THE CROSSING IS STILL SHUT, WHICH IS CORRECT AND IS THE SCOPE ────
    //
    // The door is the WORKS and nothing else. `graduate` stays priced in goods, so a drained
    // principal must produce before it can cross — which is the difference between a bootstrap
    // floor and a currency-payable ladder. The rung is reachable one Reckoning later, out of
    // production, and *every rung above the door* measures it.
    const crossing = runtime.graduationQuote(who);
    expect(crossing?.freeMinor).toBeGreaterThanOrEqual(crossing?.upkeepMinor ?? 0);
    expect(crossing?.availableQty).toBe(0);
    expect(
      crossing?.affordable,
      'the crossing is NOT currency-payable and must not become so: the door is the first WORKS only',
    ).toBe(false);
  }, MINUTES);

  it('and a 900-tick sim CANNOT see the drain at all, which is why 36 seeds passed', () => {
    // The coverage gap as an assertion rather than as a paragraph. Three Reckonings is
    // longer than every sim in the corpus and the gate is still open there, so no amount of
    // seeds at that length could have found this — only a longer run could.
    const { runtime, who, perReckoning } = soloPayerRationByReckoning('window-short', 3);
    expect(runtime.engine.tick).toBeLessThan(900 + TICKS_PER_RECKONING);
    expect(perReckoning.at(-1), 'still above the entry price at Reckoning 3').toBeGreaterThanOrEqual(
      WORKS_BUILD_QTY,
    );
    const quote = runtime.worksQuote(who, holdingOf(runtime.world, who).system);
    expect(
      quote.affordable,
      'the gate a fresh sim measures is OPEN, and it stays open for every assertion in the corpus',
    ).toBe(true);
    // ── AND IT IS OPEN THROUGH THE **GOODS**, WHICH IS WHAT KEEPS THE ECONOMY ──
    //
    // A fix that made every build currency-payable would also read `affordable: true` here, and
    // this world would look identical while the goods economy stopped meaning anything. So the
    // route is asserted, not just the verdict: a principal holding the goods pays in goods.
    expect(
      quote.payingGoodsInCurrency,
      'a principal that HOLDS the goods must pay in goods — the currency door is a floor under a ' +
        'drained principal, never an alternative price for a solvent one',
    ).toBe(false);
    expect(quote.totalMinor, 'so it retires the currency half and nothing more').toBe(WORKS_COST_MINOR);
  }, MINUTES);

  it('every rung of the ladder is priced inside that one window', () => {
    // Three independently declared constants, one shared denominator, and — above the first
    // WORKS — no rung that is payable in anything else. This is what made the trap total
    // rather than partial, and it is why the door had to be at the FIRST rung: a principal
    // cannot enter at a different one, because they are all the same price in the same good.
    for (const [name, price] of [
      ['WORKS_BUILD_QTY', WORKS_BUILD_QTY],
      ['GRADUATION_UPKEEP_QTY', GRADUATION_UPKEEP_QTY],
      ['ANCHOR_QTY', ANCHOR_QTY],
    ] as const) {
      expect(price, `${name} must be payable out of the allotment or the rung is dead on arrival`)
        .toBeLessThanOrEqual(LEVY_STARTER_ALLOTMENT);
      expect(price, `${name} is priced in produced goods, so it shares the drain`).toBeGreaterThan(0);
    }
    expect(
      WINDOW_CLOSES_AFTER_TICK,
      'the window is four Reckonings; if the tribute rate or the allotment moved, this test is the ' +
        'thing that has to be re-measured rather than adjusted',
    ).toBe(ENDOWMENT_WINDOW_RECKONINGS * TICKS_PER_RECKONING - 1);
  });
});

describe('★ THE CURRENCY DOOR, and every clause of it that must not drift', () => {
  it('is dearer than the goods it replaces, at the one administered price this world publishes', () => {
    // ── WHY THIS IS THE BOUND AND NOT AN OPINION ─────────────────────────────
    //
    // `LEVY_UNIT_MINOR` is the only administered price in the game: one unit of the levy good
    // discharges that much duty. So `WORKS_BUILD_QTY` units are worth exactly that many minor to
    // the world's own arithmetic, and a substitute priced at or below it would be strictly cheaper
    // than producing — at which point nobody would ever produce and the goods economy would be
    // decoration. The multiple is what keeps the door a door.
    const goodsWorth = WORKS_BUILD_QTY * LEVY_UNIT_MINOR;
    expect(
      WORKS_GOODS_IN_CURRENCY_MINOR,
      `the substitute must cost MORE than the ${String(goodsWorth)} of duty ${String(WORKS_BUILD_QTY)} ` +
        `units of ${WORKS_GOOD} discharge, or the cheapest way to get goods is to not have any`,
    ).toBeGreaterThan(goodsWorth);

    // A tenth of the currency grant, exactly as `WORKS_BUILD_QTY` is a tenth of the goods grant.
    // Pinned because that symmetry is the whole calibration argument, and a drifted number with the
    // argument still in the doc comment is scar #1 in a constant.
    expect(WORKS_GOODS_IN_CURRENCY_MINOR, 'a tenth of the stake, mirroring a tenth of the allotment').toBe(
      Math.trunc(STARTER_STAKE / 10),
    );
    expect(
      WORKS_BUILD_QTY,
      'and the mirror only holds while the goods half is a tenth of the allotment',
    ).toBe(Math.trunc(LEVY_STARTER_ALLOTMENT / 10));

    // And it still has to be payable by the principal it exists for. The live cast held
    // 210,000–225,333 with 50,000 of that locked in a bond for two of them, so the total price has
    // to clear 160,000 with room for a venture — a door nobody trapped can afford is not a door.
    expect(
      WORKS_COST_MINOR + WORKS_GOODS_IN_CURRENCY_MINOR,
      "the whole price must be payable by a drained principal holding the live cast's balance",
    ).toBeLessThan(160_000);
  });

  it('is the FIRST WORKS only — it closes the moment a principal is producing', () => {
    // The scope, as an assertion. A currency-payable second rung would let a rich agent skip
    // production entirely, and a WORKS is never removed from the book, so "holds none" and "has
    // never held one" are the same predicate: there is no cycle to farm.
    const { runtime, who } = drainedThenBuilds('door-scope');
    const seat = holdingOf(runtime.world, who).system;
    expect(runtime.works.ofPrincipal(who).length, 'it came through the door').toBe(1);

    const after = runtime.worksQuote(who, seat);
    expect(after.firstWorks, 'and the door is shut behind it').toBe(false);
    expect(after.goodsInCurrencyMinor, 'no substitute is quoted to a holder').toBe(0);
    expect(after.payingGoodsInCurrency).toBe(false);
    expect(after.totalMinor, 'so a second WORKS costs the currency half and the goods half in goods').toBe(
      WORKS_COST_MINOR,
    );
  }, 2 * MINUTES);

  it('★ the door is once per IDENTITY, not once per live WORKS — the raze trap, pre-empted', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THIS GUARDS A DEFECT THAT DOES NOT EXIST YET, AND THAT IS THE POINT.**
    //
    // `WorksRecord` carries `razed`/`razedAtTick`, both captured and restored, and `ofPrincipal`
    // filters on them — so `ofPrincipal(p).length === 0` means *"holds none now"*, which is the same
    // answer as *"never held one"* only while nothing razes a WORKS. Nothing does today (`grep -rn
    // "razed" src` finds readers only). The day a raid, a siege or an `abandon` can end one, the live
    // predicate reopens the bootstrap door once per razing at `WORKS_GOODS_IN_CURRENCY_MINOR` a turn.
    //
    // That is the `Book.prune` failure shape: a fix whose predicate could be undone by a mechanism
    // its author had not checked, invisible in every test because the mechanism was not built. So the
    // gate is `everHeldBy` and this test razes a row by hand to prove it.
    //
    // **If raze lands and this test is in the way, that is the test working.** Whether a principal
    // that LOST its only WORKS deserves a fresh bootstrap is a real design question — it is trapped
    // again by exactly the arithmetic this file documents — and it must be answered on purpose rather
    // than inherited from which accessor somebody reached for.
    // ══════════════════════════════════════════════════════════════════════════
    const { runtime, who } = drainedThenBuilds('door-raze');
    const seat = holdingOf(runtime.world, who).system;
    const row = runtime.works.ofPrincipal(who)[0];
    expect(row, 'it came through the door').toBeDefined();
    if (row === undefined) return;

    // Reaching into the book because there is no verb: the whole hazard is that a future verb will
    // do this, and a test that waited for the verb would be written after the hole shipped.
    const razed = runtime.works.at(row.id);
    expect(razed).not.toBeNull();
    if (razed === null) return;
    (razed as { razed: boolean }).razed = true;
    (razed as { razedAtTick: number | null }).razedAtTick = runtime.engine.tick;

    expect(runtime.works.ofPrincipal(who).length, 'the LIVE set is empty again').toBe(0);
    expect(runtime.works.everHeldBy(who), 'but the lifetime answer is unchanged').toBe(true);
    const quote = runtime.worksQuote(who, seat);
    expect(
      quote.firstWorks,
      'a razed WORKS must NOT restore the bootstrap. If this is `true`, the door is farmable at ' +
        'one razing per 25,000 and the fix has become an A15 hole — `Book.everHeldBy` carries the ' +
        'argument and `ofPrincipal` is the accessor that would have caused it.',
    ).toBe(false);
    expect(quote.goodsInCurrencyMinor).toBe(0);
    expect(quote.payingGoodsInCurrency).toBe(false);
    expect(quote.totalMinor).toBe(WORKS_COST_MINOR);
  }, 2 * MINUTES);

  it('retires the WHOLE price, and takes no goods when it fires', () => {
    // ── RETIREMENT, NOT TRANSFER (D7) — AND ONE POSTING, NOT TWO ─────────────
    //
    // D7's rule is that the endowment may not LEAVE a principal, because a puppet handing its
    // stake to its operator turns free identities into capital. Nobody receives this: the supply
    // falls, in one atomic posting into `sink:upkeep`. Two retirements would rebuild the hazard
    // `vBuildWorks`'s own header warns about — a build that takes the currency and then fails.
    const { runtime, who, freeBefore } = drainedThenBuilds('door-sink');
    const seat = holdingOf(runtime.world, who).system;
    const price = WORKS_COST_MINOR + WORKS_GOODS_IN_CURRENCY_MINOR;
    expect(
      runtime.worksQuote(who, seat).freeMinor,
      'the whole price left the payer, in one act',
    ).toBe(freeBefore - price);
    // And no goods were destroyed, because there were none: the substitute IS the goods half, so a
    // burn here would charge for it twice.
    expect(runtime.chargeGoodAt(who, seat), `no ${WORKS_GOOD} was consumed — there was none`).toBe(0);
  }, 2 * MINUTES);

  it('★ every rung above the door is reachable out of PRODUCTION, at nine Reckonings', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THIS IS THE MEASUREMENT THAT KEPT THE FIX NARROW.** `GRADUATION_UPKEEP_QTY` and
    // `ANCHOR_QTY` are both priced in the drained good, so the obvious move was to give them a
    // currency door too. This says why that would have been a price change with no defect behind
    // it: one Reckoning after coming through the door, a Commons WORKS has produced and refined
    // enough to open both rungs, and it keeps doing so every Reckoning after.
    //
    // Run past the window on purpose — nine Reckonings, three past the longest thing the corpus
    // could see before `aged.ts` existed — because the whole class of defect here is *lateness*.
    // ══════════════════════════════════════════════════════════════════════════
    const { runtime, who } = drainedThenBuilds('door-rungs', 9);
    const seat = holdingOf(runtime.world, who).system;

    expect(runtime.works.ofPrincipal(who).length, 'it holds the WORKS it bought with currency').toBe(1);
    const produced = runtime.chargeGoodAt(who, seat);
    expect(
      produced,
      `a WORKS bought with currency must produce real ${WORKS_GOOD} — the door buys a faucet, not a ` +
        'balance, and if this is zero the principal is standing in the same trap with less money',
    ).toBeGreaterThan(0);

    // Rung 2 — the crossing. Priced in goods, and now payable.
    const crossing = runtime.graduationQuote(who);
    expect(crossing, 'a Commons seat always has a crossing quote').not.toBeNull();
    expect(crossing?.availableQty ?? 0, 'in the good the crossing wants').toBeGreaterThanOrEqual(
      GRADUATION_UPKEEP_QTY,
    );
    expect(
      crossing?.affordable,
      'the crossing must be reachable from production alone; if it is not, the door leads into a ' +
        'second trap and the fix is incomplete rather than narrow',
    ).toBe(true);

    // Rung 3 — the anchor. Not built here (a Commons claim is INVALID, A8), so what is asserted is
    // the PRICE: `ANCHOR_QTY` unpledged and standing at the system, which is exactly what
    // `chargeGoodAt` measures and exactly what `vBuild` and the cast's `claimFor` read.
    expect(
      produced,
      `and the anchor's ${String(ANCHOR_QTY)} units are covered by the same production, at the system ` +
        'where an anchor requires them to stand',
    ).toBeGreaterThanOrEqual(ANCHOR_QTY);

    // Rung 1 again, and this is the one that must stay SHUT: it is producing now, so the door is
    // closed and a second WORKS costs goods. The fix cannot become an income.
    expect(runtime.worksQuote(who, seat).goodsInCurrencyMinor).toBe(0);
  }, 4 * MINUTES);
});

describe('★ A2 — the two surfaces an agent reads must NAME the door', () => {
  it('the affordance quotes the substitute, the total, and that the route is the one being taken', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THE AFFORDANCE IS A RULES SURFACE** (hard rule 4), and this file's own header records what
    // happens when it is not checked: `worksQuote.good` named the cost good while a WORKS yields
    // another, and the affordance told an agent to hoard exactly the wrong thing. So the price the
    // engine will charge is asserted against the sentence and the fields an agent decides on, in
    // the state where they differ from the constants.
    // ══════════════════════════════════════════════════════════════════════════
    const { runtime, who } = soloPayerRationByReckoning('window-afford', 5);
    const obs = buildObservation({
      runtime,
      principal: who,
      serverNowMs: 0,
      fresh: true,
      wakesRemaining: 4,
      stale: false,
      corrections: [],
      actionsRemaining: 4,
    });
    const holdingBlock = obs['holding'] as Record<string, unknown>;
    const here = (holdingBlock['works'] as Record<string, unknown>)['here'] as Record<string, unknown>;
    expect(here['available_qty'], 'drained of the cost good').toBe(0);
    expect(here['first_works']).toBe(true);
    expect(here['goods_in_currency_minor']).toBe(WORKS_GOODS_IN_CURRENCY_MINOR);
    expect(here['paying_goods_in_currency']).toBe(true);
    expect(
      here['total_minor'],
      'the field an agent budgets off must be the price the verb takes, not the currency half',
    ).toBe(WORKS_COST_MINOR + WORKS_GOODS_IN_CURRENCY_MINOR);
    expect(here['affordable']).toBe(true);

    const affordances = obs['affordances'] as unknown as readonly Record<string, unknown>[];
    const build = affordances.find(
      (a) => a['verb'] === 'build' && (a['params'] as Record<string, unknown>)['kind'] === 'WORKS',
    );
    expect(build, 'a build this principal can afford must be OFFERED, not merely quoted').toBeDefined();
    expect(
      build?.['max_direct_loss'],
      'EXPOSURE is the sum of open `max_direct_loss` (§3), so it has to be the whole retirement',
    ).toBe(WORKS_COST_MINOR + WORKS_GOODS_IN_CURRENCY_MINOR);
    expect(
      build?.['max_contingent_liability'],
      'and NO goods are destroyed on this route, so quoting 5,000 units it does not hold is the lie ' +
        'this file keeps finding',
    ).toBe(0);
    const text = String(build?.['what_it_forecloses']);
    expect(text, 'the sentence must name the substitute').toContain(
      String(WORKS_GOODS_IN_CURRENCY_MINOR),
    );
    expect(text, 'and the total it adds up to').toContain(
      String(WORKS_COST_MINOR + WORKS_GOODS_IN_CURRENCY_MINOR),
    );
    expect(text, 'and that it closes').toContain('CLOSES the moment you hold a WORKS');
  }, MINUTES);

  it('★ and the REFUSAL names it too, when the currency is short as well as the goods', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THIS IS THE SENTENCE THAT WAS A LIE.** `vBuildWorks` refused with *"your first WORKS is
    // reachable before you have earned anything"* — true of the currency half, false of the goods
    // half, and therefore false of the act. Scar #1's exact class: engine and agent-facing text each
    // coherent alone. Now the whole price is in the sentence and the promise is true.
    //
    // The state is the live world's, not a contrivance: `brannock` and `kestrel` each hold 50,000
    // locked in a claim bond they can never spend, so a drained principal with capital committed is
    // exactly the reader this refusal is written for. `post_bond` takes any amount and locks it in
    // the poster's own stores, which is how the test reaches a free balance under the total.
    // ══════════════════════════════════════════════════════════════════════════
    const { runtime, who } = soloPayerRationByReckoning('window-refuse', 5);
    const seat = holdingOf(runtime.world, who).system;
    const total = WORKS_COST_MINOR + WORKS_GOODS_IN_CURRENCY_MINOR;
    const free = runtime.worksQuote(who, seat).freeMinor;
    // ── THE BAND IS EXACTLY BETWEEN THE TWO PRICES, AND A MUTATION SAYS WHY ──
    //
    // Left free: `WORKS_COST_MINOR + 1,000` — enough for the currency half, short of the total. That
    // is the one band that separates a gate on `totalMinor` from a gate on `costMinor`, and a
    // mutation test proved it is the only band that does. With the gate on `costMinor` this build
    // passes validation, reaches `retireCurrency(85,000)`, and the ledger throws — so the agent is
    // refused either way and the RECORD is fine, but the sentence it reads becomes
    // `INV-3 the WORKS cost could not be paid (LedgerError: …)` instead of a price. Engine right,
    // agent-facing surface useless: this file's own subject, one layer down.
    runtime.engine.submit({
      principal: who,
      verb: 'post_bond',
      params: { amount: free - (WORKS_COST_MINOR + 1_000) },
      clientSequence: 0,
      arrivalMs: 0,
      decisionSource: 'LIVE',
    });
    runtime.runTick();
    const left = runtime.worksQuote(who, seat).freeMinor;
    expect(left, 'short of the TOTAL').toBeLessThan(total);
    expect(left, 'but NOT of the currency half — that is the whole point of the band').toBeGreaterThanOrEqual(
      WORKS_COST_MINOR,
    );

    runtime.takeCorrections(who);
    runtime.engine.submit({
      principal: who,
      verb: 'build',
      params: { kind: 'WORKS', system: seat },
      clientSequence: 0,
      arrivalMs: 0,
      decisionSource: 'LIVE',
    });
    runtime.runTick();
    const refusal = runtime.takeCorrections(who).find((c) => c.hint.includes('WORKS'));
    const hint = refusal?.hint ?? '(no refusal for `build {WORKS}` on the correction channel)';
    expect(
      hint,
      'it must be the PRICE refusal, not a ledger error surfaced as one — the gate has to catch this ' +
        'before anything is charged, and `INV-3 … (LedgerError)` is what an agent reads if it does not',
    ).toContain('locked stores do not count');
    expect(hint, 'the currency half').toContain(String(WORKS_COST_MINOR));
    expect(hint, 'the substitute, by amount').toContain(String(WORKS_GOODS_IN_CURRENCY_MINOR));
    expect(
      hint,
      'and the TOTAL — a refusal that named 60,000 while the verb wanted 85,000 would cost the agent ' +
        'a second action to discover the difference (AGT-S2)',
    ).toContain(String(total));
    expect(
      hint,
      'and the promise this sentence has always made must be true of the act it refuses',
    ).toContain('reachable before you have earned anything');
  }, MINUTES);
});

describe('the second door is a PRICE, not a new faucet', () => {
  it('★ A15 — N identities at one system extract EXACTLY what one does, measured', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THE CLAIM THE WHOLE DECISION RESTS ON, CHECKED RATHER THAN CITED.**
    //
    // `works/params.ts` says *"total world output is a property of the map, which no amount of
    // enrolling changes"* and the currency door is only safe if that is true: a structure whose
    // output scaled with identity count would give the door — and the WORKS itself — a Sybil price
    // of zero. The header's own argument is arithmetic in `Book.sharesAt`, and this file's other
    // subject is what happens when an argument is trusted instead of run.
    //
    // Measured through the front door: N principals seated at ONE Commons system, each raising a
    // WORKS out of 100% endowment — which is the cheapest Sybil path that exists today and the
    // one the currency door does *not* make cheaper, because a fresh identity holds the goods and
    // never reaches the substitute. What is compared is the EXTRACTION faucet's own total.
    // ══════════════════════════════════════════════════════════════════════════
    const extractedBy = (puppets: number): { readonly total: number; readonly works: number } => {
      setSpeed('instant');
      const runtime = new Runtime({ seed: `a15-${String(puppets)}` });
      const seat = commonsSystems(runtime.world.map)[0];
      expect(seat, 'the launch map has a Commons system').toBeDefined();
      if (seat === undefined) return { total: 0, works: 0 };
      for (let i = 0; i < puppets; i += 1) {
        const p = `p:puppet-${String(i).padStart(3, '0')}` as PrincipalId;
        runtime.seat(p, `puppet-${String(i).padStart(3, '0')}`, seat);
        runtime.standing.open(p);
        runtime.engine.submit({
          principal: p,
          verb: 'build',
          params: { kind: 'WORKS', system: seat },
          clientSequence: 0,
          arrivalMs: 0,
          decisionSource: 'LIVE',
        });
      }
      for (let i = 0; i < WORKS_SPINUP_TICKS + 100; i += 1) runtime.runTick();
      const faucet = runtime.ledger.account(GOODS_FAUCET.EXTRACTION);
      return {
        total: faucet === undefined ? 0 : (faucet.movedQty.get(WORKS_YIELD_GOOD) ?? 0),
        works: runtime.works.liveInOrder().length,
      };
    };

    const one = extractedBy(1);
    const eight = extractedBy(8);
    expect(one.works, 'one WORKS stands').toBe(1);
    expect(eight.works, 'eight WORKS stand at the same place').toBe(8);
    expect(one.total, 'a sole occupant takes the whole tier yield for every tick it is online').toBe(
      YIELD_PER_TICK.COMMONS * 100,
    );
    expect(
      eight.total,
      '★ EIGHT identities extract exactly what ONE extracts. If this is greater, world output scales ' +
        'with the number of identities, enrolment is free, and every gate priced in produced goods — ' +
        'including the WORKS itself and the currency substitute for its goods half — has a Sybil price ' +
        'of ZERO. That would invalidate the design decision this file implements, not just this test.',
    ).toBe(one.total);
  }, 4 * MINUTES);

  it('goods still enter the world at exactly the same call sites', () => {
    // ── THE FIX MOVED A PRICE AND ADDED NO SOURCE, WHICH IS THE POINT ────────
    //
    // The same instrument `works/params.ts` cites in its header, kept as an assertion so the claim
    // cannot go stale the way that header's did once the WORKS landed. It is *more* load-bearing
    // after the fix, not less: the wrong way to solve a goods deadlock is to sprinkle goods, and
    // this is what says nobody did. `WORKS_GOODS_IN_CURRENCY_MINOR` deletes a goods *requirement*
    // and mints nothing.
    const files = readdirSync(new URL('../../src/', import.meta.url), {
      recursive: true,
      encoding: 'utf8',
    }).filter((f) => typeof f === 'string' && f.endsWith('.ts'));
    const callers = files.filter((f) =>
      readFileSync(new URL(`../../src/${f}`, import.meta.url), 'utf8').includes('sourceGoods({'),
    );
    expect(
      [...callers].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      'the set of ways goods can enter a principal changed. The currency door was NOT allowed to add ' +
        'one: it removes a goods price and mints nothing, so this list is the guard that the fix stayed ' +
        'a price change. A new faucet here needs its own A15 argument.',
    ).toEqual(['sim/runtime.ts', 'works/produce.ts']);
  });

  it('★ and re-entry is no longer priced in a second identity', () => {
    const { runtime, who } = soloPayerRationByReckoning('window-doors', 5);
    const seat = holdingOf(runtime.world, who).system;

    // Door 1 — the enrolment allotment. Once per identity, by construction: `enroll` refuses
    // a second seating in as many words ("identity is never re-minted"). **Unchanged, and it is
    // the reason the fix had to exist**: while this was the only renewable route to goods, and
    // enrolment is free, the world's economic re-entry was priced in identities and nothing else.
    expect(() => runtime.seat(who, 'aged-payer'), 'a principal cannot be re-endowed').toThrow();

    // Door 2 — a WORKS. **This is the assertion that inverted.** It needed `WORKS_BUILD_QTY` of the
    // good that ran out; it now has a currency price for a first WORKS, so the drained principal
    // above can raise one without a second identity, without a counterparty, and without anybody
    // giving it anything.
    const quote = runtime.worksQuote(who, seat);
    expect(quote.availableQty, 'still holding no goods at all').toBe(0);
    expect(runtime.works.ofPrincipal(who).length, 'and holding no WORKS to produce from').toBe(0);
    expect(
      quote.affordable,
      'so the ONLY escape used to be a new identity (A15 exactly inverted). It is now a price this ' +
        'principal can pay with what it already has.',
    ).toBe(true);
    expect(quote.payingGoodsInCurrency).toBe(true);

    // Door 3 — `refine`, which converts `ore` into `ration` 1:1. Only a WORKS yields `ore`,
    // so this door opens onto door 2 — which is now open. Asked through the front door, because
    // the refusal sentence is the rules surface an LLM member actually reads.
    //
    // The channel is drained first and the refusal is *found* rather than taken from the
    // head: the fixture's own tribute deliveries are refused every tick once the stock is
    // gone, so `[0]` is a `deliver` refusal and a test that read it would assert nothing
    // about `refine` while looking like it did.
    runtime.takeCorrections(who);
    const outcome = runtime.engine.submit({
      principal: who,
      verb: 'refine',
      params: {},
      clientSequence: 0,
      arrivalMs: 0,
      decisionSource: 'LIVE',
    });
    expect(outcome.ok, 'refine is a legal request; it is the recipe that cannot be met').toBe(true);
    runtime.runTick();
    const refusal = runtime.takeCorrections(who).find((c) => c.hint.includes('refine'));
    expect(
      refusal?.hint ?? '(no refusal for `refine` on the correction channel)',
      `refine must say it has no ${WORKS_YIELD_GOOD} — the third door opens onto the second`,
    ).toContain(WORKS_YIELD_GOOD);
  }, MINUTES);
});

describe('★ THE LADDER MUST BE ENTERABLE IN A WORLD THAT IS ALREADY OLD', () => {
  it('the shipping cast builds inside the window, on every seed, and is still producing at Reckoning 6', () => {
    // ── THE REGRESSION GUARD THE CORPUS DID NOT HAVE ─────────────────────────
    //
    // This is the assertion whose absence let `claimLines: 0` reach production twice. It is
    // NOT "the cast emits `build`" — a fresh 900-tick run proves that and proves nothing
    // about a mature world. It is "the cast emits `build` **before the allotment that pays
    // for it is gone**", measured in a world old enough for the difference to exist.
    //
    // It is kept at full strength **after** the currency door, and that is deliberate: the door
    // is an escape hatch and the cast should never need it. If a future branch delays the first
    // build past the window, the world still works — and that is exactly the kind of quiet
    // regression that would otherwise be invisible, because the door would absorb it while every
    // member paid 25,000 more than it had to.
    for (const seed of ['old-a', 'old-b']) {
      const world = agedWorld({ seed, reckonings: 6, size: 8 });
      const late: string[] = [];
      const dry: string[] = [];
      for (const member of world.roster) {
        const at = world.firstBuild.get(member.principal);
        if (at === undefined || at > WINDOW_CLOSES_AFTER_TICK) late.push(member.handle);
        if (world.runtime.works.ofPrincipal(member.principal).length === 0) dry.push(member.handle);
      }
      expect(
        late,
        `${seed}: these members did not raise a WORKS inside the endowment window (by tick ` +
          `${String(WINDOW_CLOSES_AFTER_TICK)}). A member that misses it now has to buy in with ` +
          `${String(WORKS_GOODS_IN_CURRENCY_MINOR)} of extra retired currency, which it should never ` +
          `have to: the whole territorial and combat ladder is priced in ${WORKS_GOOD} and the ` +
          `allotment is free. This is also precisely how the live world reached ` +
          `\`works: 5 · claimLines: 0\` with a rich cast.`,
      ).toEqual([]);
      expect(dry, `${seed}: members holding no WORKS at Reckoning 6`).toEqual([]);
    }
  }, 4 * MINUTES);

  it('★ and a cast that did NOT have the ladder is NO LONGER locked out of it — the fix, at scale', () => {
    // ── THE PRODUCTION SHAPE, EXACTLY ────────────────────────────────────────
    //
    // `no-ladder` is the cast the live world actually ran for its first 5,400 ticks: the
    // rungs did not exist yet. Age a world under it and the branches could never fire
    // afterwards, however good they were — which was the finding in one sentence. **A feature
    // deployed into a mature world inherits that world's dead ends, and no sim that starts
    // at tick 0 can tell you which ones.**
    //
    // This is the assertion the fix exists to invert, and it is measured in the same world, with
    // the same cast and the same seed as when it read 8.
    const lockedOutAfter = (reckonings: number): number => {
      const world = agedWorld({ seed: 'old-dark', reckonings, size: 8, cast: 'no-ladder' });
      expect(world.verbs.get('build') ?? 0, 'the ageing cast had the rung switched off').toBe(0);
      let lockedOut = 0;
      for (const member of world.roster) {
        const seat = holdingOf(world.runtime.world, member.principal).system;
        const quote = world.runtime.worksQuote(member.principal, seat);
        // Rich and shut out: the exact production signature.
        if (quote.freeMinor >= quote.costMinor && !quote.affordable) lockedOut += 1;
      }
      return lockedOut;
    };

    // ── THE COVERAGE GAP, AS AN ASSERTION RATHER THAN A COMMENT ──────────────
    //
    // Three Reckonings is longer than every sim in the corpus. At that age the same world,
    // the same cast and the same missing branches produced **no locked-out member at all** —
    // so the corpus could have run this exact scenario on a thousand seeds and reported the
    // ladder healthy. The trap was not rare; it was *late*, and lateness is the one thing a
    // fixture that starts at tick 0 and stops at 900 structurally cannot observe.
    expect(
      lockedOutAfter(3),
      'at three Reckonings nothing is trapped and never was — if this is non-zero the drain got faster ' +
        'and the whole corpus is now measuring a world with a different economy in it',
    ).toBe(0);
    expect(
      lockedOutAfter(6),
      '★ THIS READ 8 OF 8 AND THE WHOLE FIX IS THAT IT READS 0. Every member of a cast that aged past ' +
        'the window is rich in currency, and every one of them can now buy into the goods economy with ' +
        'it. If this goes back to 8, the currency door is gone or unreachable, the live cast is ' +
        'economically dead again, and the only escape left is a second identity — which is A15 ' +
        'inverted and the reason `WORKS_GOODS_IN_CURRENCY_MINOR` exists.',
    ).toBe(0);
  }, 4 * MINUTES);

  it('★ and it does not merely QUOTE its way out — the aged cast actually builds, and produces', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **`affordable: true` IS A QUOTE, NOT A WORKS.** This project's most repeated defect is a
    // capability that exists and is never exercised, and the assertion above would pass against a
    // door every gate advertised and every build refused. So this one ages a world with the ladder
    // switched OFF, switches it back ON in the same runtime, and requires real `build` actions to
    // land and real goods to come out of the ground.
    //
    // This is the live world's shape as closely as a test can reach it: the cast that ran for
    // 5,400 ticks without the branches, then the branches arriving into the world they made.
    // ══════════════════════════════════════════════════════════════════════════
    const world = agedWorld({ seed: 'old-dark', reckonings: 6, size: 8, cast: 'no-ladder' });
    expect(world.verbs.get('build') ?? 0, 'nothing was built while it aged').toBe(0);

    const after = world.resume({ reckonings: 2 });
    const builders: string[] = [];
    for (const member of world.roster) {
      if (world.runtime.works.ofPrincipal(member.principal).length > 0) builders.push(member.handle);
    }
    expect(
      after.get('build') ?? 0,
      'the ladder was switched on in a world that had already aged past the window, and the cast has ' +
        'to actually take it — a door only the quote can see is the defect this file was written about',
    ).toBeGreaterThan(0);
    expect(
      [...builders].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      'and every member of a cast that was trapped at Reckoning 6 is holding a WORKS two Reckonings later',
    ).toEqual([...world.roster.map((m) => m.handle)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));

    // And the goods are real. `extracted` is credited in the PRODUCE phase against the map's own
    // yield, so a positive total is the faucet running rather than a balance being handed out.
    const extracted = world.runtime.works.liveInOrder().reduce((n, w) => n + w.extracted, 0);
    expect(
      extracted,
      'a WORKS bought with currency must put goods in the ground; if this is zero the cast spent its ' +
        'stake on a structure that does nothing and the world is poorer than before the fix',
    ).toBeGreaterThan(0);
  }, 8 * MINUTES);
});
