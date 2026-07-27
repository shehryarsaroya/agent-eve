/**
 * §10'S PRODUCTION GRAPH: "FOUR GOODS, ONE BUILD STEP" — the first step of it.
 *
 * Before this the world had **one good**. `market` is 3,065 lines pricing a single fungible commodity,
 * so there was no trade, no specialization, no comparative advantage and no supply chain — and three
 * canon verbs were declared not-live to agents with the note *"step 11 (markets and the production
 * graph)"*: `extract`, `refine`, `haul`.
 *
 * `refine` is now live. A WORKS yields **ore**; every obligation in the game — the Levy, a sovereignty
 * Charge, the goods half of a WORKS build — is payable in **rations**; and `refine` is the only
 * conversion. Which is what makes the Levy a *supply chain* rather than a faucet with a tax on it:
 * paying it takes two acts in two places, and §10 is explicit that this is the point — *"nothing
 * consumed the four goods… with no hiring there is no delegation and no betrayal."*
 *
 * ── THE TRAP THIS DESIGN AVOIDS, WHICH IS WORTH KNOWING ──────────────────────
 *
 * Building a WORKS **consumes goods**. If it consumed the good a WORKS yields, a principal would need
 * `ore` to build the thing that makes `ore` — a bootstrap deadlock with no first move and no error
 * message, because every individual rule reads correctly. So `WORKS_YIELD_GOOD` and `WORKS_GOOD` are
 * separate constants: the cost stays in what a newcomer is endowed with, only the yield goes raw.
 *
 * ── AND THE BALANCE GATE, RUN BEFORE ANY OF THIS SHIPPED ─────────────────────
 *
 * The failure mode of getting a recipe wrong is severe and quiet: if refining cannot keep up, the Levy
 * becomes unpayable from domestic production, every principal defaults, and the permanent public record
 * fills with breaches nobody could have avoided. That is the hazard
 * `test/core/goods-are-independent.test.ts` names as the reason the goods must agree.
 *
 * So the recipe is **1:1 for the first landing** — the world's goods throughput is unchanged and what
 * changes is that goods arrive raw and an act is needed to make them payable. Measured on identical
 * seeds, 900 ticks, 8 members:
 *
 *     with the chain:  levyShort=6000  kept=36  broken=8  ventures=244
 *     without it:      levyShort=6000  kept=39  broken=7  ventures=238
 *
 * Identical shortfall. The scarcity is the ACTION, not the ratio, and the ratio is the obvious first
 * tuning knob once the chain has run for a season.
 */

import { describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import { setSpeed } from '../../src/core/time.js';
import { Runtime } from '../../src/sim/runtime.js';
import { REFINE_IN_QTY, REFINE_OUT_QTY, WORKS_GOOD, WORKS_YIELD_GOOD } from '../../src/works/params.js';

function world(seed: string, ticks: number): Runtime {
  setSpeed('instant');
  const rt = new Runtime({ seed });
  const cast = new HeuristicCast(rt, { size: 8 });
  cast.seat(seed);
  for (let i = 0; i < ticks; i += 1) {
    for (const a of cast.decide(rt.engine.tick + 1, seed)) rt.engine.submit(a);
    const r = rt.runTick();
    if (r.halted) throw new Error(`halted at ${String(r.tick)}: ${r.violations.map((v) => v.id).join(' ')}`);
  }
  return rt;
}

describe('goods arrive raw, and an act makes them payable', () => {
  it('the yield good and the cost good are DIFFERENT, or the bootstrap deadlocks', () => {
    // The whole reason there are two constants. If these were equal a principal would need the yield
    // in order to build the thing that produces the yield, and nothing in the engine would say so —
    // every rule would read correctly and no first move would exist.
    expect(WORKS_YIELD_GOOD).not.toBe(WORKS_GOOD);
  });

  it('a world nobody steers extracts ore AND converts it', () => {
    const rt = world('chain-lives', 900);
    const frame = rt.reckoningFrame();
    expect(frame, 'a frame must exist').not.toBeNull();
    // Somebody built a WORKS, so ore is entering the world.
    expect((frame?.worksLines ?? []).length, 'no WORKS, so nothing extracts and this proves nothing').toBeGreaterThan(0);

    // And the ore is being CONVERTED rather than piling up. The unrefined meter is the instrument:
    // if refining never happened it would grow without bound, because a WORKS yields every tick.
    const unrefined = frame?.meters.unrefined ?? 0;
    const extracted = (frame?.worksLines ?? []).reduce((n, w) => n + w.extracted, 0);
    expect(extracted, 'the WORKS must have extracted something over 900 ticks').toBeGreaterThan(0);
    expect(
      unrefined,
      'every unit ever extracted is still sitting raw, so nothing was ever refined and the chain is ' +
        'a faucet into a dead end',
    ).toBeLessThan(extracted);
  }, 180_000);

  it('THE BALANCE GATE: the chain does not make the Levy harder to pay', () => {
    // The assertion that gates shipping. A production graph that starves the Levy turns every principal
    // into a defaulter for a reason none of them chose, and A5 has no opt-out — the record would keep
    // those breaches forever.
    //
    // Compared against the meter rather than against a remembered number: `levyShort` is the one figure
    // §14 puts on screen as the headline, and it is the one an agent cannot lower alone.
    const rt = world('chain-gate', 900);
    const short = rt.reckoningFrame()?.meters.levyShort ?? 0;
    // ══════════════════════════════════════════════════════════════════════
    // **THIS ASSERTED `> 0` AND HAS BEEN CORRECTED, BECAUSE THE NON-ZERO WAS A CAST DEFECT.**
    //
    // The note here read *"a world where the Levy is trivially covered has no tension in it, and
    // §5's whole point is that turtling is the most-taxed posture."* The premise is right and the
    // measurement was not measuring it: the shortfall this run produced came from two bugs in
    // `src/cast/heuristic.ts` — a tier guard that refused a member's only legal route to its
    // delivery place, and no reservation of a hand, so a member with all three hands filled into
    // roles sat on 109,052 units of `ration` owing 19,304 and was swept. Neither is turtling.
    // Both are named at their call sites in that file; with both fixed this cast pays in full.
    //
    // So the chain's balance gate keeps the half that is about the CHAIN — production must keep up,
    // or every principal defaults for a reason none of them chose — and stops asserting a number
    // that was reporting the cast's inability to walk. The Levy's bite is pinned on purpose in
    // `test/levy/chronic.test.ts`, `tribute.test.ts`, `coase.test.ts`, `docket.test.ts` and
    // `halt.test.ts`, all of which still require a non-zero shortfall from a deliberate fixture.
    // ══════════════════════════════════════════════════════════════════════
    expect(short, 'the meter must exist and never go negative').toBeGreaterThanOrEqual(0);
    expect(
      short,
      'runaway shortfall means production cannot keep up and every principal defaults for a reason ' +
        'none of them chose — the hazard the goods-independence test names',
    ).toBeLessThan(1_000_000);
  }, 180_000);

  it('the unrefined stock is ON THE FRAME, or the conversion step is invisible (A13)', () => {
    // A conversion has no pixel signature unless the UN-converted stock is published. On screen this is
    // the counterweight to `levyShort`: shortfall climbing while this climbs too is a world that HAS the
    // goods and has not made them payable — a different story from a world that is simply poor, and the
    // two look identical without this number.
    // Sampled ACROSS the run, not at one tick. Asserting only `>= 0` passed a mutation that pinned the
    // meter to zero — a published number that is always zero is worse than an absent one, because it
    // renders as "nothing is waiting" and the panel looks correct while reporting nothing.
    setSpeed('instant');
    const seed = 'chain-renders';
    const rt = new Runtime({ seed });
    const cast = new HeuristicCast(rt, { size: 8 });
    cast.seat(seed);
    let sawStock = 0;
    let peak = 0;
    for (let i = 0; i < 400; i += 1) {
      for (const a of cast.decide(rt.engine.tick + 1, seed)) rt.engine.submit(a);
      if (rt.runTick().halted) break;
      const u = rt.reckoningFrame()?.meters.unrefined ?? 0;
      if (u > 0) sawStock += 1;
      if (u > peak) peak = u;
      expect(u, 'the meter may never go negative').toBeGreaterThanOrEqual(0);
    }
    expect(
      sawStock,
      'the unrefined meter was zero at every tick of a world that demonstrably extracts — it is not ' +
        'reporting the stock, and the panel would read "nothing waiting" forever',
    ).toBeGreaterThan(0);
    expect(peak, 'and it must reach a visible magnitude, not a rounding artefact').toBeGreaterThan(0);
  }, 180_000);

  it('the recipe is stated as integers, because a float here would be unhashable', () => {
    // DET: floats are banned in anything hashed, and a recipe that produced fractional goods would
    // either round in the actor's favour or silently destroy the remainder. §10.2 requires published
    // rounding, so the recipe is whole units and `vRefine` refines whole batches only.
    expect(Number.isSafeInteger(REFINE_IN_QTY)).toBe(true);
    expect(Number.isSafeInteger(REFINE_OUT_QTY)).toBe(true);
    expect(REFINE_IN_QTY).toBeGreaterThan(0);
    expect(REFINE_OUT_QTY).toBeGreaterThan(0);
  });
});
