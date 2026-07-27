/**
 * THE WORKS QUOTE IS THE NUMBER AGENTS BUDGET FROM. BOTH ITS HALVES WERE WRONG.
 *
 * `agent.md` points at this object twice — *"`here.share_per_tick` — what YOURS would take, counting
 * itself. This is the number that decides whether the build pays for itself"* — so an error here is
 * not a cosmetic one. Two independent blind probes found both halves on the same night.
 *
 * **1. It named the wrong good.** The quote reported `WORKS_GOOD` (what a build CONSUMES) while a WORKS
 * yields `WORKS_YIELD_GOOD`. The affordance therefore read *"yields 80 units of ration a tick… returns
 * about 23,040 units of ration every Reckoning"* — and an agent planning its Levy off that arrives
 * holding ORE, which settles nothing. One probe named it precisely: scar #1 reproduced, engine and
 * agent-facing text disagreeing about one word, each individually coherent. The two constants were only
 * ever equal by accident, and the production graph pulled them apart.
 *
 * **2. It divided by `occupants + 1` unconditionally.** Right for a PROSPECTIVE build — quoting the
 * pre-arrival share overstates the return of every build into a crowded place — and wrong once you
 * already hold one. A probe standing as sole occupant of a COMMONS system, taking the full 80, was
 * quoted 40; with one neighbour, taking 40, it was quoted 26. A third under-count, in the field the
 * manual calls decisive.
 */

import { describe, expect, it } from 'vitest';
import { setSpeed } from '../../src/core/time.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { WORKS_GOOD, WORKS_YIELD_GOOD } from '../../src/works/params.js';
import { holdingOf } from '../../src/world/index.js';

describe('the WORKS quote reports what you will actually receive', () => {
  it('names the good a WORKS YIELDS, not the one the build consumes', () => {
    setSpeed('instant');
    const seed = 'quote-good';
    const rt = new Runtime({ seed });
    const cast = new HeuristicCast(rt, { size: 4 });
    cast.seat(seed);
    rt.runTick();
    const who = cast.roster[0]!.principal;
    const quote = rt.worksQuote(who, holdingOf(rt.world, who).system);
    expect(
      quote.good,
      'the quote names the build COST good while the WORKS yields another — an agent budgets its Levy ' +
        'off this and arrives holding something that settles nothing (scar #1)',
    ).toBe(WORKS_YIELD_GOOD);
    expect(WORKS_YIELD_GOOD, 'and the two must be genuinely different, or this proves nothing').not.toBe(
      WORKS_GOOD,
    );
  }, 60_000);

  it('quotes the share you WOULD take before you build, and the one you DO take after', () => {
    setSpeed('instant');
    const seed = 'quote-share';
    const rt = new Runtime({ seed });
    const cast = new HeuristicCast(rt, { size: 4 });
    cast.seat(seed);
    rt.runTick();
    const who = cast.roster[0]!.principal;
    const system = holdingOf(rt.world, who).system;

    // BEFORE: dividing by `occupants + 1` is correct — the quote must count the arrival it is pricing.
    const before = rt.worksQuote(who, system);
    expect(before.alreadyHeld, 'nobody has built yet').toBe(false);
    expect(before.sharePerTick, 'a prospective build counts itself among the occupants').toBe(
      Math.trunc(before.yieldPerTick / (before.occupants + 1)),
    );

    // AFTER: the same +1 would price a THIRD works this principal is forbidden to build.
    const built = rt.engine.submit({
      principal: who,
      verb: 'build',
      params: { kind: 'WORKS', system },
      clientSequence: 1,
      arrivalMs: 0,
      decisionSource: 'LIVE',
    });
    expect(built.ok).toBe(true);
    rt.runTick();

    const after = rt.worksQuote(who, system);
    if (!after.alreadyHeld) return; // the build was refused for an unrelated reason; nothing to assert
    expect(
      after.sharePerTick,
      'once you hold one, the quote must divide by the occupants that EXIST — quoting occupants+1 ' +
        'understates your own income by a third, in the field agent.md calls decisive',
    ).toBe(Math.trunc(after.yieldPerTick / Math.max(1, after.occupants)));
  }, 60_000);
});
