/**
 * ★ THE ENTRY PRICE OF THE ECONOMY'S ONLY FAUCET IS DENOMINATED IN THE GOOD IT IS THE ONLY
 * SOURCE OF — SO A PRINCIPAL THAT RUNS DRY IS LOCKED OUT PERMANENTLY.
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
 * ── THE MECHANISM, AND IT IS A DEADLOCK RATHER THAN A CALIBRATION ────────────
 *
 * Goods enter a principal at exactly two places (`grep -rn "sourceGoods(" src`):
 *
 *   1. the **enrolment allotment** — `LEVY_STARTER_ALLOTMENT`, once per identity, and A15
 *      forbids pricing anything in a second identity;
 *   2. a **WORKS it already holds** — plus `refine`, which converts the `ore` a WORKS
 *      yields.
 *
 * Against that, the Levy destroys goods every Reckoning and the Charge destroys more. So the
 * allotment is a **window, not a balance**, and every rung of the ladder is priced inside it:
 * `WORKS_BUILD_QTY` 5,000 · `GRADUATION_UPKEEP_QTY` 5,000 · `ANCHOR_QTY` 5,000. Miss the
 * window and the only door to the goods economy is bolted from the inside — with, in
 * production's case, a quarter of a million in currency in hand.
 *
 * `works/params.ts` was written to close exactly this hazard and states it in its own header:
 * *"the terminal state is not a rising meter: it is a world where **every** obligation is
 * unpayable, every claim lapses, and the record accuses every principal of a default that our
 * own arithmetic made unavoidable"*, and *"a floor an agent starves on is not a floor"* (A8).
 * The module built the faucet and then priced its tap in the good behind the drain.
 * `vBuildWorks`'s own refusal text promises the opposite — *"your first WORKS is reachable
 * before you have earned anything"* — which is true of the currency half and false of the
 * goods half. Scar #1's class: engine and agent-facing text each individually coherent.
 *
 * ── WHY 2,939 TESTS AND 26 INVARIANTS MISSED IT: EVERY SIM STARTS AT TICK 0 ──
 *
 * `reachable.spec.ts` asserts *"a newcomer can raise its first WORKS"* at tick 1.
 * `economy-has-a-source.spec.ts` asserts goods enter through a place. Both are true and both
 * are about a **fresh** principal. The longest sim in the corpus is 900 ticks, and at three
 * Reckonings the allotment still holds 9,000 units against a 5,000 price — so every gate is
 * still open and every assertion still passes. The window closes on tick 1,439, five hundred
 * ticks past the end of the longest thing anybody ran.
 *
 * ── WHAT THIS FILE ASSERTS, AND WHAT IT DELIBERATELY DOES NOT ────────────────
 *
 * It asserts the trap **exists, is exact, and has no second door**, and that today's cast
 * escapes it — because the two facts together are the diagnosis, and either alone is
 * misleading. The shipping cast builds inside its first Reckoning on every seed, so the
 * production world is a casualty of *arrival order*: it was seeded before `worksFor` existed
 * and its members were dry 4,000 ticks before the branch that would have used the allotment
 * was written. Nothing in `heuristic.ts` is wrong today.
 *
 * It does **not** assert a fix. Re-opening the door is a §10 price change on the world's most
 * load-bearing constants — a `RULES_VERSION` bump, a declared production divergence and a
 * calibration pass of its own — and the corpus does not specify the price. **These tests go
 * red the moment anybody moves `LEVY_STARTER_ALLOTMENT`, the entry prices or the tribute
 * rate, which is the point: the next person to touch those numbers has to read this first.**
 * ══════════════════════════════════════════════════════════════════════════
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import { LEVY_STARTER_ALLOTMENT } from '../../src/levy/index.js';
import { GRADUATION_UPKEEP_QTY } from '../../src/world/graduation.js';
import { ANCHOR_QTY } from '../../src/sovereignty/params.js';
import { WORKS_BUILD_QTY, WORKS_GOOD, WORKS_YIELD_GOOD } from '../../src/works/params.js';
import { holdingOf } from '../../src/world/index.js';
import {
  agedWorld,
  ENDOWMENT_WINDOW_RECKONINGS,
  soloPayerRationByReckoning,
  WINDOW_CLOSES_AFTER_TICK,
} from './aged.js';

const MINUTES = 300_000;

describe('the enrolment allotment is a WINDOW, not a balance', () => {
  it('★ a principal that only pays its tribute is locked out of the goods economy at Reckoning 5', () => {
    const { runtime, who, perReckoning } = soloPayerRationByReckoning('window-solo', 6);
    const seat = holdingOf(runtime.world, who).system;

    // ── THE CURVE, CHECKED AGAINST PRODUCTION ────────────────────────────────
    //
    // The live world's four surviving snapshots hold this exact sequence for its cast
    // members at ticks 287 · 575 · 863 · 1,151. A one-principal reproduction matching a
    // twelve-member world to the unit is what says the drain is structural rather than
    // anything the cast chose — it is the Levy's nominal rate against a finite grant, and
    // nothing else is in it.
    expect(perReckoning.slice(0, 6), 'the drain curve production ran down').toEqual([
      49_500, 49_000, 29_000, 9_000, 0, 0,
    ]);

    // ── THE ASYMMETRY IS THE WHOLE FINDING ───────────────────────────────────
    //
    // Not "it went broke". The currency half of every gate is fully intact — this principal
    // has never spent a unit of its stake — and the goods half is zero. A diagnosis that
    // reads `affordable: false` and concludes "no money" looks at the wrong half and stays
    // wrong for as long as it is believed, which is what happened for a night.
    const works = runtime.worksQuote(who, seat);
    expect(works.freeMinor, 'the stake is untouched').toBeGreaterThanOrEqual(works.costMinor);
    expect(works.availableQty, `no ${WORKS_GOOD} anywhere`).toBe(0);
    expect(
      works.affordable,
      'a WORKS is unaffordable on the GOODS half alone, with the currency half fully covered',
    ).toBe(false);

    const crossing = runtime.graduationQuote(who);
    expect(crossing?.freeMinor).toBeGreaterThanOrEqual(crossing?.upkeepMinor ?? 0);
    expect(crossing?.availableQty).toBe(0);
    expect(crossing?.affordable, 'and so is the crossing, for the same reason').toBe(false);
  }, MINUTES);

  it('and a 900-tick sim CANNOT see it, which is why 36 seeds passed', () => {
    // The coverage gap as an assertion rather than as a paragraph. Three Reckonings is
    // longer than every sim in the corpus and the gate is still open there, so no amount of
    // seeds at that length could have found this — only a longer run could.
    const { runtime, who, perReckoning } = soloPayerRationByReckoning('window-short', 3);
    expect(runtime.engine.tick).toBeLessThan(900 + TICKS_PER_RECKONING);
    expect(perReckoning.at(-1), 'still above the entry price at Reckoning 3').toBeGreaterThanOrEqual(
      WORKS_BUILD_QTY,
    );
    expect(
      runtime.worksQuote(who, holdingOf(runtime.world, who).system).affordable,
      'the gate a fresh sim measures is OPEN, and it stays open for every assertion in the corpus',
    ).toBe(true);
  }, MINUTES);

  it('every rung of the ladder is priced inside that one window', () => {
    // Three independently declared constants, one shared denominator, and no rung that is
    // payable in anything else. This is what makes the trap total rather than partial: a
    // principal cannot enter at a different rung, because they are all the same price in
    // the same good.
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

describe('there is no second door', () => {
  it('goods enter the world at exactly three call sites, and two of them are behind a WORKS', () => {
    // The same instrument `works/params.ts` cites in its header, kept as an assertion so the
    // claim cannot go stale the way that header's did once the WORKS landed.
    const files = readdirSync(new URL('../../src/', import.meta.url), {
      recursive: true,
      encoding: 'utf8',
    }).filter((f) => typeof f === 'string' && f.endsWith('.ts'));
    const callers = files.filter((f) =>
      readFileSync(new URL(`../../src/${f}`, import.meta.url), 'utf8').includes('sourceGoods({'),
    );
    expect(
      [...callers].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      'the set of ways goods can enter a principal changed. If a NEW faucet landed, the trap this ' +
        'file documents may be closed and these tests should be rewritten around it rather than ' +
        'relaxed; if one was REMOVED, the world just got tighter than the state that produced ' +
        '`claimLines: 0`.',
    ).toEqual(['sim/runtime.ts', 'works/produce.ts']);
  });

  it('★ and none of them is reachable from the drained state', () => {
    const { runtime, who } = soloPayerRationByReckoning('window-doors', 5);
    const seat = holdingOf(runtime.world, who).system;

    // Door 1 — the enrolment allotment. Once per identity, by construction: `enroll` refuses
    // a second seating in as many words ("identity is never re-minted"). So the only renewable
    // route to goods is a NEW identity, and enrolment is free — which is A15 exactly inverted:
    // the world's economic re-entry would be priced in identities and nothing else.
    expect(() => runtime.seat(who, 'aged-payer'), 'a principal cannot be re-endowed').toThrow();

    // Door 2 — a WORKS. Needs `WORKS_BUILD_QTY` of the good that ran out.
    expect(runtime.worksQuote(who, seat).affordable).toBe(false);
    expect(runtime.works.ofPrincipal(who).length, 'and it holds none to produce from').toBe(0);

    // Door 3 — `refine`, which converts `ore` into `ration` 1:1. Only a WORKS yields `ore`,
    // so this door opens onto door 2. Asked through the front door, because the refusal
    // sentence is the rules surface an LLM member actually reads.
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
    // If a future branch is placed above `worksFor`, or its roll is lowered, or a gate is
    // added that delays the first build past Reckoning 4, this goes red — and the message
    // says what the consequence is, because the consequence is invisible at 900 ticks.
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
          `${String(WINDOW_CLOSES_AFTER_TICK)}). A member that misses it can NEVER build one, never ` +
          `cross, never claim and never arm — the whole territorial and combat ladder is priced in ` +
          `${WORKS_GOOD} and the allotment is the only ${WORKS_GOOD} it will ever see. This is ` +
          `precisely how the live world reached \`works: 5 · claimLines: 0\` with a rich cast.`,
      ).toEqual([]);
      expect(dry, `${seed}: members holding no WORKS at Reckoning 6`).toEqual([]);
    }
  }, 4 * MINUTES);

  it('and a cast that did NOT have the ladder is locked out of it forever — production, reproduced', () => {
    // ── THE PRODUCTION SHAPE, EXACTLY ────────────────────────────────────────
    //
    // `no-ladder` is the cast the live world actually ran for its first 5,400 ticks: the
    // rungs did not exist yet. Age a world under it and the branches can never fire
    // afterwards, however good they are — which is the finding in one sentence. **A feature
    // deployed into a mature world inherits that world's dead ends, and no sim that starts
    // at tick 0 can tell you which ones.**
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
    // the same cast and the same missing branches produce **no locked-out member at all** —
    // so the corpus could have run this exact scenario on a thousand seeds and reported the
    // ladder healthy. The trap is not rare; it is *late*, and lateness is the one thing a
    // fixture that starts at tick 0 and stops at 900 structurally cannot observe.
    expect(
      lockedOutAfter(3),
      'at three Reckonings the trap must be INVISIBLE — if this is non-zero the drain got faster and ' +
        'the whole corpus is now measuring a world with a different economy in it',
    ).toBe(0);
    expect(
      lockedOutAfter(6),
      'and at six Reckonings every member should be rich in currency and unable to buy into the goods ' +
        'economy — if this is no longer 8, a door was opened and this file is the record of what it ' +
        'was for',
    ).toBe(8);
  }, 4 * MINUTES);
});
