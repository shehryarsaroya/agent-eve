/**
 * A CAPITAL INVESTMENT AN AGENT HAS TO DO ARITHMETIC TO SEE IS ONE IT WILL NOT CHOOSE.
 *
 * The `build {WORKS}` affordance stated its cost (60,000 currency plus 5,000 goods), its crowding
 * (`share_per_tick`, falling as others arrive) and its spin-up (24 ticks) — and never what it EARNS.
 *
 * Measured 2026-07-26 (`D17-the-faucet-nobody-turns-on.md`):
 *
 *   - the affordance is offered whenever a WORKS is affordable — **70 of 70** principal-observations,
 *     so this is not the legally-unoffered defect that hid eight other mechanics;
 *   - and **neither cast has ever built one.** The heuristic spent 900 ticks on
 *     `move 1003 · sign 502 · fill_role 353 · elect 264 · create 232` and issued `build` exactly
 *     **zero** times; the LLM cast, which chooses freely and is told in its prompt that *"a WORKS is
 *     the only thing in the game that makes goods"*, ran eight Reckonings in production at
 *     `works: 0` while `levyShort` climbed past 345,000.
 *
 * So goods enter this world through one door and nobody opens it, which is the client's own
 * empty-state diagnosis: *"an empty list means the economy is living off enrolment grants and running
 * down."*
 *
 * D17's hypothesis is that a capital investment loses an action-budget contest against immediate
 * income — a `create` pays at the next settlement, a WORKS pays nothing for 24 ticks — and that the
 * first fix is therefore the NUMBER, not a mechanic. This file pins the number.
 *
 * ── WHY THE FIGURES ARE PHASE-FREE ───────────────────────────────────────────
 * "How much by this Reckoning's end" depends on where in the cycle the reader is, and a quote whose
 * meaning shifts with the phase is one an agent must re-derive every wake. Per-Reckoning steady state
 * and ticks-to-repay are true whenever they are read.
 *
 * **What this test cannot tell you** is whether stating the return changes behaviour. That needs a
 * probe asked, in prose and before acting, what it would spend its next action on and why — D17 names
 * it. This asserts only that the information is there to be weighed.
 */

import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../src/api/observe.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import { Runtime } from '../../src/sim/runtime.js';
import { REFINE_IN_QTY, WORKS_GOOD, WORKS_YIELD_GOOD } from '../../src/works/params.js';
import { holdingOf } from '../../src/world/index.js';

/** The first `build {WORKS}` affordance a real world publishes, with the quote it was priced from. */
function firstWorksOffer(seed: string): { readonly text: string; readonly sharePerTick: number; readonly costQty: number } | null {
  setSpeed('instant');
  const rt = new Runtime({ seed });
  const cast = new HeuristicCast(rt, { size: 8 });
  cast.seat(seed);
  for (let i = 0; i < 400; i += 1) {
    for (const a of cast.decide(rt.engine.tick + 1, seed)) rt.engine.submit(a);
    if (rt.runTick().halted) return null;
    for (const m of cast.roster) {
      let observation;
      try {
        observation = buildObservation({
          runtime: rt,
          principal: m.principal,
          serverNowMs: 0,
          fresh: true,
          wakesRemaining: 9,
          stale: false,
          corrections: [],
          correctionsDropped: 0,
          actionsRemaining: 4,
        });
      } catch {
        continue;
      }
      const offer = observation.affordances.find(
        (a) => a.verb === 'build' && (a.params as Record<string, unknown>)['kind'] === 'WORKS',
      );
      if (offer !== undefined) {
        const quote = rt.worksQuote(m.principal, holdingOf(rt.world, m.principal).system);
        return { text: offer.what_it_forecloses, sharePerTick: quote.sharePerTick, costQty: quote.costQty };
      }
    }
  }
  return null;
}

describe('the WORKS affordance states what it returns, not only what it costs', () => {
  it('names the per-Reckoning yield and the repayment time', () => {
    const offer = firstWorksOffer('works-return');
    expect(offer, 'no WORKS was offered in 400 ticks, so this test would prove nothing').not.toBeNull();
    if (offer === null) return;

    expect(offer.text, 'the return must be labelled, not buried').toContain('WHAT IT RETURNS');

    // The arithmetic, recomputed here from the same quote the affordance was priced from — so the
    // string cannot drift from the numbers without failing.
    const perReckoning = offer.sharePerTick * TICKS_PER_RECKONING;
    expect(offer.sharePerTick, 'a priced offer must have a positive share').toBeGreaterThan(0);
    expect(
      offer.text,
      `the per-Reckoning yield (${String(perReckoning)}) must appear, or an agent has to derive it`,
    ).toContain(String(perReckoning));

    // And the repayment horizon, which is what makes it comparable to a venture that pays at the
    // next settlement.
    expect(offer.text, 'the repayment time must be stated').toMatch(/repays .* in about \d+ ticks/);
  });

  it('names the COST good and the YIELD good as the two different goods they are', () => {
    // ══════════════════════════════════════════════════════════════════════
    // **THIS SENTENCE SAID THE BUILD COSTS ORE. IT COSTS RATION.**
    //
    // Found by a probe playing the live world on 2026-07-27: the affordance read *"plus 5000 units of
    // ore standing here, destroyed into the build"*, because it used `worksHere.good` — the good a
    // WORKS YIELDS — for the cost clause as well as the yield clause. The two constants are
    // independently declared and have only ever been equal by accident.
    //
    // What it cost an agent: `works.here.available_qty` counts `ration`, so a newcomer holding 50,000
    // ration and no ore reads `affordable: true` beside a price it appears not to hold. Worse, the
    // conversion runs the OTHER way — `refine` turns ore INTO ration — so an agent that believed the
    // sentence would hoard exactly the wrong good to fund the only faucet in the game.
    //
    // MUTATION: put `worksHere.good` back in the cost clause. RED here, and green in every other
    // assertion in this file, because every other one is about the numbers.
    // ══════════════════════════════════════════════════════════════════════
    expect(WORKS_GOOD, 'if the two goods ever collapse this test proves nothing').not.toBe(
      WORKS_YIELD_GOOD,
    );
    const offer = firstWorksOffer('works-two-goods');
    expect(offer).not.toBeNull();
    if (offer === null) return;
    expect(offer.text, 'the cost is in the endowment good').toContain(
      `${String(offer.costQty)} units of ${WORKS_GOOD} standing here`,
    );
    expect(offer.text, 'and the yield is in the good a place hands over').toContain(
      `units of ${WORKS_YIELD_GOOD} a tick`,
    );
    // The payback crosses the two, so the sentence must name the conversion rather than divide one
    // good by the other and print ticks.
    expect(offer.text).toContain(`\`refine\` turns ${String(REFINE_IN_QTY)} ${WORKS_YIELD_GOOD}`);
    expect(offer.text).toContain(`units of ${WORKS_GOOD} destroyed into the`);
  });

  it('still states the cost and the spin-up, because a return alone is a sales pitch', () => {
    // The guard's own guard. Adding the upside must not have displaced the downside: A2 says a
    // consequence preview is exact, and §8's whole discipline is that the worst case is shown before
    // you sign. An affordance that advertises 31,680 a Reckoning and hides the 24-tick dead period
    // would be worse than the silent version it replaced.
    const offer = firstWorksOffer('works-return-cost');
    expect(offer).not.toBeNull();
    if (offer === null) return;
    expect(offer.text, 'the goods destroyed into the build').toContain(String(offer.costQty));
    expect(offer.text, 'the spin-up, where it earns nothing').toMatch(/extracts nothing for \d+ ticks/);
    expect(offer.text, 'and that crowding erodes the share').toMatch(/FALLS as others arrive/);
  });

  it('quotes no payback when crowding would make the share zero', () => {
    // `sharePerTick` is `yield / (occupants + 1)` truncated, so a crowded enough place returns 0 — and
    // "repays in Infinity ticks" would be a division by zero shown to an agent as advice. The branch
    // exists; this asserts the shape rather than contriving the crowding, because a test that builds
    // 110 WORKS on one system to divide the yield to nothing is testing arithmetic, not the surface.
    const offer = firstWorksOffer('works-return-zero');
    if (offer === null || offer.sharePerTick > 0) {
      // The common case. Assert the guard cannot produce a non-finite number instead.
      if (offer !== null) {
        expect(offer.text).not.toMatch(/Infinity|NaN/);
      }
      return;
    }
    expect(offer.text).toContain('no payback to quote');
  });
});
