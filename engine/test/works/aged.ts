/**
 * A WORLD THAT IS ALREADY OLD — because every other sim in this repo starts at tick 0.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE COVERAGE GAP THIS FILE EXISTS TO CLOSE, NAMED.**
 *
 * On 2026-07-27 the territorial ladder — `graduate` → `build {WORKS}` → `post_bond` →
 * `build {ANCHOR}` → `deliver {CHARGE}` — passed its balance gate on **36 fresh seeds**
 * (11–12 live claims, ~34,000 rent, 18 hulls, 25 battles) and then did **nothing at all**
 * in production: `works 5 · claimLines 0 · battleLines 0`, unchanged, 120 ticks after the
 * deploy. Four of the world's five WORKS belonged to abandoned playtest probes.
 *
 * The cause was not the branches. It was that **a mature world is a different world**, and
 * every sim in the corpus was fresh:
 *
 *   - goods enter a principal exactly twice — the enrolment allotment
 *     (`LEVY_STARTER_ALLOTMENT`, once per identity, A15 forbids pricing anything in a
 *     second one) and a WORKS it already holds;
 *   - the Levy destroys goods every Reckoning and the Charge destroys more;
 *   - so a principal that only ever pays its tribute runs to **zero goods in four
 *     Reckonings** — `runtime.ts`'s own faucet comment predicted exactly this: *"a
 *     principal that only ever delivers from stock runs dry after about two and a half
 *     Reckonings"*;
 *   - and **every rung of the ladder is priced in the good that ran out**
 *     (`WORKS_BUILD_QTY`, `GRADUATION_UPKEEP_QTY`, `ANCHOR_QTY`).
 *
 * A 900-tick sim cannot see any of that. At three Reckonings the allotment still holds
 * 9,000 units against a 5,000 entry price, so **every gate is still open and every
 * assertion still passes.** The window closes at Reckoning 5, on tick 1,439 — 539 ticks
 * after the longest run anybody was making.
 *
 * {@link agedWorld} is therefore not a convenience. It is the only instrument in this repo
 * that can observe a mechanic in the world the mechanic will actually be deployed into, and
 * it is deliberately general: any future gate priced in produced goods, locked capital or
 * elapsed tenure inherits the same deadline and can be probed the same way.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { expect } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import { setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';
import type { CastMember } from '../../src/cast/heuristic.js';
import { Runtime } from '../../src/sim/runtime.js';
import { commonsSystems, holdingOf } from '../../src/world/index.js';

/**
 * How many Reckonings of tribute the enrolment allotment covers, and therefore how long a
 * principal has to enter the goods economy before it is locked out of it forever.
 *
 * Measured rather than derived, and measured against **production**: the live world's
 * per-member `ration` at its four surviving snapshots was `49,500 · 49,000 · 29,000 · 9,000`
 * at ticks `287 · 575 · 863 · 1,151`, and a single-principal reproduction of the same span
 * matched **to the unit at every one of them**. Reckoning 5 reads zero in both.
 *
 * Not a constant of the design — it is `LEVY_STARTER_ALLOTMENT` divided by the nominal
 * tribute, and moving either moves this. That is why the test that owns it asserts the
 * *shape* (a window that closes) as well as the number, and says which is which.
 */
export const ENDOWMENT_WINDOW_RECKONINGS = 4;

/** The tick after which no drained principal can ever pay a goods-priced entry price again. */
export const WINDOW_CLOSES_AFTER_TICK = ENDOWMENT_WINDOW_RECKONINGS * TICKS_PER_RECKONING - 1;

export interface AgedWorld {
  readonly runtime: Runtime;
  readonly roster: readonly CastMember[];
  /** How many Reckonings the world ran for. */
  readonly reckonings: number;
  /** Every verb the cast emitted, and how often. */
  readonly verbs: ReadonlyMap<string, number>;
  /** The first tick each member emitted `build`, if it ever did. */
  readonly firstBuild: ReadonlyMap<PrincipalId, number>;
  /**
   * Keep running the SAME world with the ladder switched **on**, and report what the cast did.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THE ONLY WAY TO OBSERVE A FEATURE ARRIVING, RATHER THAN A FEATURE BEING PRESENT.**
   * `cast: 'no-ladder'` ages a world the branches did not exist for; this is the deploy. Together
   * they are the live world's exact shape: 5,400 ticks with no `worksFor`, then `worksFor`.
   *
   * It flips the three ladder rolls back to their defaults on the options object the cast reads,
   * rather than seating a second cast — because `runtime.seat` refuses a second seating of the same
   * identity in as many words (A10, identity is never re-minted), so a fresh `HeuristicCast` over
   * this runtime cannot exist. The roster, the holdings, the stores, the standing and the tick
   * counter are all continuous, which is the whole point: a *new* world would be a fresh one again.
   * ══════════════════════════════════════════════════════════════════════════
   */
  resume(options: { readonly reckonings: number }): ReadonlyMap<string, number>;
}

export interface AgedWorldOptions {
  readonly seed: string;
  readonly reckonings: number;
  readonly size?: number;
  /**
   * `full` — the cast as it ships. `no-ladder` — the same cast with the three ladder rolls
   * at zero, which is precisely the cast production was running for its first 5,400 ticks,
   * before `worksFor`/`graduateFor`/`claimFor` existed. The second mode is how a test
   * reproduces a world the branches arrive *into* rather than one they were present for.
   */
  readonly cast?: 'full' | 'no-ladder';
}

/**
 * Run a real `Runtime` with a real cast for `reckonings` Reckonings and hand it back.
 *
 * The cast is the shipping `HeuristicCast` and the ticks are real ticks with the real
 * invariants asserting, because the whole value of the fixture is that nothing about the
 * world is stubbed: a trap that only appears when the Levy, the tribute walk, the ventures
 * and the seals are all running is a trap a hand-built fixture cannot show.
 */
export function agedWorld(options: AgedWorldOptions): AgedWorld {
  setSpeed('instant');
  const runtime = new Runtime({ seed: options.seed });
  // ── THE ONE MUTABLE OBJECT IN THE FIXTURE, AND WHY IT IS DELIBERATE ─────────
  //
  // `HeuristicCast` reads `this.options.worksChanceBps ?? DEFAULT_WORKS_CHANCE_BPS` on every draw,
  // so switching a branch on mid-run is a property write on the options object this file owns.
  // {@link AgedWorld.resume} needs exactly that — see its own note for why a second `HeuristicCast`
  // over the same runtime is impossible — and nothing in `src/` is touched to allow it.
  const rolls: {
    size: number;
    worksChanceBps?: number;
    graduateChanceBps?: number;
    claimChanceBps?: number;
  } = {
    size: options.size ?? 8,
    ...(options.cast === 'no-ladder'
      ? { worksChanceBps: 0, graduateChanceBps: 0, claimChanceBps: 0 }
      : {}),
  };
  // Passed BY REFERENCE, not spread: a spread would copy the rolls and `resume` would silently
  // mutate an object nothing reads — a fixture that reports a switch it did not throw.
  const cast = new HeuristicCast(runtime, rolls);
  const roster = cast.seat(options.seed);

  const verbs = new Map<string, number>();
  const firstBuild = new Map<PrincipalId, number>();
  const run = (reckonings: number, into: Map<string, number>): void => {
    const ticks = reckonings * TICKS_PER_RECKONING;
    for (let i = 0; i < ticks; i += 1) {
      const next = runtime.engine.tick + 1;
      for (const action of cast.decide(next, options.seed)) {
        into.set(action.verb, (into.get(action.verb) ?? 0) + 1);
        if (action.verb === 'build' && !firstBuild.has(action.principal)) {
          firstBuild.set(action.principal, next);
        }
        runtime.engine.submit(action);
      }
      const report = runtime.runTick();
      // A halt makes every count below meaningless, so it fails here rather than downstream.
      expect(
        report.halted,
        `aged world halted at ${String(report.tick)}: ${report.violations
          .map((v) => `${v.id} ${v.message}`)
          .join(' | ')}`,
      ).toBe(false);
    }
  };
  run(options.reckonings, verbs);
  return {
    runtime,
    roster,
    reckonings: options.reckonings,
    verbs,
    firstBuild,
    resume: (resumed) => {
      // The deploy: the three ladder rolls go back to their shipping defaults, in the world the
      // cast without them has already made. `delete` rather than a number, so the resumed cast runs
      // on `DEFAULT_*_CHANCE_BPS` and this fixture cannot pin a calibration of its own.
      delete rolls.worksChanceBps;
      delete rolls.graduateChanceBps;
      delete rolls.claimChanceBps;
      const after = new Map<string, number>();
      run(resumed.reckonings, after);
      return after;
    },
  };
}

/**
 * One principal, no cast, paying its tribute honestly and doing nothing else — the cheapest
 * exact reproduction of the production curve, and the one whose numbers are checkable
 * against the live snapshots by hand.
 *
 * Returns the `ration` standing at its seat at the close of each Reckoning.
 */
export function soloPayerRationByReckoning(
  seed: string,
  reckonings: number,
): { readonly runtime: Runtime; readonly who: PrincipalId; readonly perReckoning: readonly number[] } {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const seat = commonsSystems(runtime.world.map)[0];
  if (seat === undefined) throw new Error('the launch map has no Commons system');
  const who = 'p:aged-payer' as PrincipalId;
  runtime.seat(who, 'aged-payer', seat);
  runtime.standing.open(who);

  const perReckoning: number[] = [];
  for (let r = 0; r < reckonings; r += 1) {
    for (let i = 0; i < TICKS_PER_RECKONING; i += 1) {
      // The only thing this principal ever does: discharge what the world asks of it.
      const block = runtime.levyBlockFor(who, runtime.engine.tick + 1);
      if (block !== null && block.shortfall_if_unpaid > 0) {
        runtime.engine.submit({
          principal: who,
          verb: 'deliver',
          params: {},
          clientSequence: 0,
          arrivalMs: 0,
          decisionSource: 'LIVE',
        });
      }
      const report = runtime.runTick();
      expect(
        report.halted,
        `solo payer halted at ${String(report.tick)}: ${report.violations
          .map((v) => `${v.id} ${v.message}`)
          .join(' | ')}`,
      ).toBe(false);
    }
    perReckoning.push(runtime.worksQuote(who, holdingOf(runtime.world, who).system).availableQty);
  }
  return { runtime, who, perReckoning };
}

/**
 * ★ **A PRINCIPAL THAT DRAINS TO ZERO GOODS, COMES BACK THROUGH THE CURRENCY DOOR, AND THEN
 * LIVES OFF WHAT IT PRODUCES.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THIS IS THE ONLY FIXTURE THAT MEASURES THE FIX RATHER THAN THE TRAP**, and the shape of it is
 * the whole argument for `WORKS_GOODS_IN_CURRENCY_MINOR` being scoped to a first WORKS:
 *
 *   1. pay tribute honestly until the enrolment allotment is gone (~4 Reckonings);
 *   2. build **only when `payingGoodsInCurrency` is true** — so the goods route is never taken and
 *      what is observed afterwards is a WORKS that was bought with money alone;
 *   3. then `refine` every spare action, because a WORKS yields `ore` and every obligation is
 *      payable in `ration`. Nothing here skips that step: a fixture that credited `ration` directly
 *      would prove the door works while hiding that the goods arrive in the wrong form.
 *
 * The tribute always comes first, so the principal never goes short to fund the build — which
 * matters, because a fix that pays for itself out of an unpaid Levy has moved the failure onto the
 * public record (A5′) instead of removing it.
 *
 * Measured, `probe-rungs`, seed `probe-rungs`: dry at R5 with `graduate.affordable false` and
 * `0/5,000` anchor goods; through the door in R6 at 250,000 → 165,000; **23,920 units at seat by
 * R7**, both rungs open, and +3,040 a Reckoning after that — which is `YIELD_PER_TICK.COMMONS`
 * against a nominal Levy, exactly as `works/params.ts` calibrated it.
 * ══════════════════════════════════════════════════════════════════════════
 */
export function drainedThenBuilds(
  seed: string,
  reckonings = 6,
): {
  readonly runtime: Runtime;
  readonly who: PrincipalId;
  /** Free currency the tick before the build landed, so the price can be checked by subtraction. */
  readonly freeMinor: number;
  readonly freeBefore: number;
  /** The tick the WORKS was raised on, or null if the door never opened. */
  readonly builtAtTick: number | null;
} {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const seat = commonsSystems(runtime.world.map)[0];
  if (seat === undefined) throw new Error('the launch map has no Commons system');
  const who = 'p:door-payer' as PrincipalId;
  runtime.seat(who, 'door-payer', seat);
  runtime.standing.open(who);

  let builtAtTick: number | null = null;
  let freeBefore = 0;
  for (let i = 0; i < reckonings * TICKS_PER_RECKONING; i += 1) {
    const tick = runtime.engine.tick + 1;
    const system = holdingOf(runtime.world, who).system;
    const block = runtime.levyBlockFor(who, tick);
    // ── ONE ACTION A TICK, AND THE TRIBUTE OUTRANKS EVERYTHING ────────────────
    //
    // Not a budget shortcut: it is the order that keeps the measurement honest. A principal that
    // built while it owed would be funding the fix out of a breach on the permanent record.
    let submitted = false;
    if (block !== null && block.shortfall_if_unpaid > 0) {
      runtime.engine.submit({
        principal: who,
        verb: 'deliver',
        params: {},
        clientSequence: 0,
        arrivalMs: 0,
        decisionSource: 'LIVE',
      });
      submitted = true;
    }
    if (!submitted && builtAtTick === null) {
      const quote = runtime.worksQuote(who, system);
      // **Only the currency door.** `affordable` would fire at tick 1 out of the allotment and
      // measure the fresh path, which proves nothing about the state this fixture exists for.
      if (quote.payingGoodsInCurrency) {
        freeBefore = quote.freeMinor;
        runtime.engine.submit({
          principal: who,
          verb: 'build',
          params: { kind: 'WORKS', system },
          clientSequence: 0,
          arrivalMs: 0,
          decisionSource: 'LIVE',
        });
        builtAtTick = tick;
        submitted = true;
      }
    }
    if (!submitted && builtAtTick !== null) {
      // Raw yield is not payable. This is the step that turns `ore` into the good every obligation
      // is denominated in, and it is submitted every spare tick because `refine` takes whole
      // batches and a missed tick is only a missed batch.
      runtime.engine.submit({
        principal: who,
        verb: 'refine',
        params: { system },
        clientSequence: 0,
        arrivalMs: 0,
        decisionSource: 'LIVE',
      });
    }
    const report = runtime.runTick();
    expect(
      report.halted,
      `drained payer halted at ${String(report.tick)}: ${report.violations
        .map((v) => `${v.id} ${v.message}`)
        .join(' | ')}`,
    ).toBe(false);
  }
  expect(
    builtAtTick,
    'the currency door never opened, so this fixture measured nothing. Either the drain no longer ' +
      'reaches zero inside the run, or `payingGoodsInCurrency` is unreachable.',
  ).not.toBeNull();
  return {
    runtime,
    who,
    freeMinor: runtime.worksQuote(who, holdingOf(runtime.world, who).system).freeMinor,
    freeBefore,
    builtAtTick,
  };
}
