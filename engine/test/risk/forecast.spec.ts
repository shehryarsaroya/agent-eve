/**
 * ★ THE CONE MUST NOT BE ANTI-CORRELATED WITH THE SWATH — CAT1, CAT2, CAT11, A2.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ## The measurement
 *
 * Both `swathOf` and `coneOf` drew more candidate systems than they published and truncated the surplus
 * with `if (cells.length >= N) break;` **while iterating a `compareIds`-sorted list**. So a SWATH was
 * *"the N alphabetically-lowest system ids within N hops of the eye"* and the CONE was the same sentence
 * with a different N. One driven world, `front:r3:sys-17`:
 *
 * ```
 * CONE   sys-06:1868  sys-16:6901  sys-17:9209  sys-18:6837  sys-19:5488 …
 * SWATH  sys-01:87    sys-02:87    sys-04:87    sys-05:349   sys-06:583
 * ```
 *
 * The eye — `sys-17`, published at **9,209 bps** — was not struck. Four of the five struck systems
 * appear **nowhere in the cone**. The one that does appears at the *lowest* odds on the board. And
 * `view.ts:pickTarget` recommends the highest-odds cone cell, so `publish_offer {kind:"COVER"}`'s
 * suggested parameters aimed an underwriter's capital at ground the storm would not touch.
 *
 * Across 500 draws the eye was in its own swath **128 times — 25.6%**.
 *
 * Nothing could catch it: every cell was well-formed, the odds were monotone in hop, the cone and the
 * swath still came off different sub-streams so CAT11's oracle stayed CUT, and A2's *"genuine
 * uncertainty stays uncertain and sourced"* was satisfied by a number that was sourced, uncertain, and
 * about the wrong system. **Rank, then truncate** is the whole fix.
 *
 * ## What must stay uncertain, and this file asserts that too
 *
 * The eye is public from announcement (`front.forecast` carries it), so *"the eye is struck"* is not an
 * oracle — it is the honest statement that a storm hits its own centre. What the CONE may not reveal is
 * **how far the swath reaches** (2–5 rings) or **how hard it hits** (3,000–9,000 bps at the centre), and
 * both are drawn from `swathOf`'s own sub-stream. That is what a hurricane cone actually communicates.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng.js';
import { BPS_ONE } from '../../src/core/units.js';
import {
  CONE_JITTER_BPS,
  CONE_ODDS_MAX_BPS,
  CONE_ODDS_PER_HOP_BPS,
  CONE_SYSTEMS,
  announceFront,
  coneOf,
  frontId,
  hopsFrom,
  isFrontReckoning,
  swathOf,
  SWATH_SYSTEMS_MAX,
  SWATH_SYSTEMS_MIN,
} from '../../src/risk/index.js';
import { FIRST_ANNOUNCE_TICK, act, fund, riskWorld, runTo, seatsFor, stockAt } from './fixture.js';
import { LEVY_GOOD } from '../../src/levy/index.js';

/** 500 fronts over the launch map, so the claims below are frequencies rather than anecdotes. */
function sweep(count = 500): readonly { eye: string; swath: readonly string[]; cone: readonly string[] }[] {
  const world = riskWorld('sweep', 2, 'MARCHES');
  const map = world.runtime.world.map;
  const out: { eye: string; swath: readonly string[]; cone: readonly string[] }[] = [];
  for (let i = 0; i < count; i += 1) {
    const reckoning = 3 * (i + 1);
    expect(isFrontReckoning(reckoning), 'every third Reckoning gets one').toBe(true);
    const front = announceFront(map, Rng.fromSeed(`sweep:${String(i)}`), reckoning, reckoning * 288);
    out.push({
      eye: front.eye,
      swath: front.swath.map((c) => c.system),
      cone: front.cone.map((c) => c.system),
    });
  }
  return out;
}

describe('★ the SWATH is the systems NEAREST the eye, not the alphabetically-lowest ones', () => {
  it('★★ THE EYE IS ALWAYS IN ITS OWN SWATH — it used to be, 25.6% of the time', () => {
    const draws = sweep();
    const hits = draws.filter((d) => d.swath.includes(d.eye)).length;
    // MUTATION: restore `for (const [system, hop] of [...hops.entries()].sort(compareIds))` with
    // `if (cells.length >= span) break;` in `swathOf` and this drops to ~128/500. That is the number the
    // reviewer measured, and it is the one thing a storm model may not get wrong.
    expect(hits, 'every one of them').toBe(draws.length);
  });

  it('is not vacuous: the sweep really produces varied eyes and varied swath sizes', () => {
    const draws = sweep();
    expect(new Set(draws.map((d) => d.eye)).size, 'the eye moves').toBeGreaterThan(5);
    const sizes = new Set(draws.map((d) => d.swath.length));
    expect(sizes.size, 'and the span really is drawn, not fixed').toBeGreaterThan(1);
    for (const size of sizes) {
      expect(size, 'within the published band').toBeLessThanOrEqual(SWATH_SYSTEMS_MAX);
      expect(size, 'and never empty').toBeGreaterThanOrEqual(1);
    }
    expect(SWATH_SYSTEMS_MIN, 'and the band has two ends').toBeLessThan(SWATH_SYSTEMS_MAX);
  });

  it('★ every struck system is within `span` hops, and INTENSITY falls with distance', () => {
    const world = riskWorld('swath-shape', 2, 'MARCHES');
    const map = world.runtime.world.map;
    const id = frontId(3, 'sys-01' as never);
    const swath = swathOf(map, Rng.fromSeed('swath-shape:s'), id, 'sys-01' as never);
    expect(swath.length, 'the swath is non-empty').toBeGreaterThan(0);
    const hops = hopsFrom(map, 'sys-01' as never, SWATH_SYSTEMS_MAX);
    let previousHop = -1;
    for (const cell of swath) {
      const hop = hops.get(cell.system);
      expect(hop, 'every struck system is reachable from the eye').toBeDefined();
      // ★ Nearest-first is now a property of the ORDER, so the swath reads as a shape rather than as a
      // set. A13 needs that: the FRONT BAND is drawn from these cells in this order.
      expect(hop ?? 0, 'and they come out nearest-first').toBeGreaterThanOrEqual(previousHop);
      previousHop = hop ?? 0;
    }
    // The eye is hop 0, so it leads its own swath.
    expect(swath[0]?.system, 'the eye leads its own swath').toBe('sys-01');

    // ⚑ **BUT THE EYE IS NOT NECESSARILY THE HARDEST HIT, AND THAT IS CAT1 WORKING.**
    // Published INTENSITY is `raw × VULNERABILITY_BY_TIER[tier]`, and the tier multiplier spans 4×
    // (`COMMONS 2,500 · MARCHES 6,000 · FRONTIER 10,000`) while one hop of falloff costs 40%. So a
    // FRONTIER system one lane out really can lose more than a COMMONS eye — *"vulnerability is the
    // tier's, so geography prices itself"* — and asserting otherwise would be asserting that the map
    // does not matter. What falls monotonically with distance is the **raw** intensity, which is the
    // quantity the model is actually about.
    const hopOf = (system: string): number => hops.get(system as never) ?? 0;
    const byHop = new Map<number, number[]>();
    for (const cell of swath) {
      const list = byHop.get(hopOf(cell.system)) ?? [];
      list.push(cell.intensityBps);
      byHop.set(hopOf(cell.system), list);
    }
    // Within one ring, the tier is the only thing that varies, so ordering is by vulnerability.
    for (const [, list] of [...byHop.entries()].sort((a, b) => a[0] - b[0])) {
      expect([...list].sort((a, b) => b - a), 'ranked by tier within a ring').toEqual(list);
    }
  });
});

describe('★ the CONE points at the ground that will burn', () => {
  it('★★ the HIGHEST-ODDS cone cell is in the SWATH, every time', () => {
    const world = riskWorld('cone-top', 2, 'MARCHES');
    const map = world.runtime.world.map;
    let checked = 0;
    for (let i = 0; i < 200; i += 1) {
      const reckoning = 3 * (i + 1);
      const front = announceFront(map, Rng.fromSeed(`cone-top:${String(i)}`), reckoning, reckoning * 288);
      const top = [...front.cone].sort((a, b) => b.oddsBps - a.oddsBps)[0];
      expect(top, 'the cone names systems').toBeDefined();
      // ★ THE ONE THAT MATTERS FOR AN AGENT. `view.ts:pickTarget` recommends exactly this cell, so this
      // assertion is the difference between a suggestion an agent can copy and a suggestion that costs
      // it an escrow. Measured before the fix: the top cell was the eye and the eye was usually missed.
      expect(front.swath.map((c) => c.system), 'and its top cell is struck').toContain(top?.system ?? '');
      checked += 1;
    }
    expect(checked, 'over 200 fronts').toBe(200);
  });

  it('★ ordering by ODDS is ordering by DISTANCE, which is what makes the line above provable', () => {
    // The gap per hop must exceed the full jitter swing, or a hop-1 cell could out-rank the eye and
    // `pickTarget` could recommend a system the storm may miss. Stated as arithmetic rather than hoped.
    expect(CONE_ODDS_PER_HOP_BPS, 'the per-hop gap beats the whole jitter swing').toBeGreaterThan(
      2 * CONE_JITTER_BPS,
    );
  });

  it('★ no CONE cell ever claims CERTAINTY — a forecast that can be wrong may not print 10,000 bps', () => {
    const world = riskWorld('cone-cap', 2, 'MARCHES');
    const map = world.runtime.world.map;
    let cells = 0;
    for (let i = 0; i < 100; i += 1) {
      const id = frontId(3 * (i + 1), 'sys-01' as never);
      for (const cell of coneOf(map, Rng.fromSeed(`cone-cap:${String(i)}`), id, 'sys-01' as never)) {
        // MUTATION: restore `Math.min(BPS_ONE, base + jitter)` over a base that reaches `BPS_ONE` at
        // hop 0 and this goes red on the eye of nearly every front. The old expression published
        // *certain landfall* on a cell that was then missed — measured, `sys-10` at 10,000 bps.
        expect(cell.oddsBps, 'strictly below certainty').toBeLessThanOrEqual(CONE_ODDS_MAX_BPS);
        expect(CONE_ODDS_MAX_BPS, 'and the cap really is below BPS_ONE').toBeLessThan(BPS_ONE);
        expect(cell.oddsBps, 'and above the floor').toBeGreaterThanOrEqual(100);
        cells += 1;
      }
    }
    expect(cells, 'over a lot of cells').toBeGreaterThan(100);
  });

  it('★ and the JITTER really is symmetric now, which the old docblock only claimed', () => {
    const world = riskWorld('cone-jitter', 2, 'MARCHES');
    const map = world.runtime.world.map;
    // The clamp used to eat the whole upper half of the draw at the eye (`base === BPS_ONE`) and the
    // whole lower half at the rim (`base === 500`), so the jitter was a *bias* — and it biased toward
    // publishing certainty about the eye, the one cell that needs no help. The base is now clamped into
    // `[100 + jitter, CONE_ODDS_MAX_BPS - jitter]` **before** the draw is added, so both tails survive.
    const seen = new Set<number>();
    for (let i = 0; i < 60; i += 1) {
      const id = frontId(3 * (i + 1), 'sys-01' as never);
      const cone = coneOf(map, Rng.fromSeed(`cone-jitter:${String(i)}`), id, 'sys-01' as never);
      const eye = cone.find((c) => c.system === 'sys-01');
      if (eye !== undefined) seen.add(eye.oddsBps);
    }
    expect(seen.size, 'the eye’s published odds genuinely vary').toBeGreaterThan(5);
    const values = [...seen];
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    // Both sides of the clamped base are reachable — that is what "symmetric" means, and the old
    // arithmetic could only reach one of them.
    expect(hi - lo, 'across a range the jitter can actually span').toBeGreaterThan(CONE_JITTER_BPS);
    expect(hi, 'never at certainty').toBeLessThanOrEqual(CONE_ODDS_MAX_BPS);
  });

  it('the CONE is still WIDER than the SWATH, so it remains information rather than an answer', () => {
    const draws = sweep(200);
    let wider = 0;
    for (const d of draws) {
      // CAT11 CUTS an oracle. The eye is public anyway, so what the cone must not reveal is the swath's
      // *extent* — and it does not: the cone names up to CONE_SYSTEMS cells while the swath takes
      // between SWATH_SYSTEMS_MIN and SWATH_SYSTEMS_MAX of them.
      if (d.cone.length > d.swath.length) wider += 1;
      const notStruck = d.cone.filter((s) => !d.swath.includes(s));
      expect(notStruck.length, 'and some named cells are spared, or the cone IS the swath').toBeGreaterThan(
        0,
      );
    }
    expect(wider, 'on every front').toBe(draws.length);
    expect(CONE_SYSTEMS, 'and the published widths differ by construction').toBeGreaterThan(
      SWATH_SYSTEMS_MAX,
    );
  });
});

describe('★ and the affordance the fix exists for: a suggested COVER aims at struck ground', () => {
  it('★ `publish_offer {kind:"COVER"}`’s suggested system is in the SWATH', () => {
    const world = riskWorld('target', 4, 'MARCHES');
    const { runtime } = world;
    const [payer, holder, bank] = seatsFor(world, 0, 1, 2);
    fund(runtime, bank, payer, 200_000);
    runTo(runtime, FIRST_ANNOUNCE_TICK);
    const front = runtime.risk.allFronts()[0];
    if (front === undefined) throw new Error('unreachable');
    stockAt(runtime, holder, front.swath[0]?.system ?? ('' as never), 400_000, LEVY_GOOD);

    const offered = runtime.riskAffordances(payer).offered.find((a) => a.verb === 'publish_offer');
    expect(offered, 'the act is offered to a payer with earned capital').toBeDefined();
    const system = (offered?.params as Record<string, unknown>)['system'];
    expect(system, 'and it names a system to write over').toBeDefined();
    // ★ THE POINT OF THE WHOLE FILE. This is the parameter a blind copier sends verbatim, and before the
    // truncation fix it named the eye while the eye was usually spared — so the menu steered capital at
    // ground that would not burn and the payer's escrow lapsed `UNTAKEN` for reasons it could not see.
    expect(
      front.swath.map((c) => String(c.system)),
      'the suggested system is one the FRONT will actually strike',
    ).toContain(String(system));

    // And the offer is takeable: an affordance nobody can bind is a mechanism nothing selects.
    const ok = act(runtime, payer, 'publish_offer', offered?.params ?? {});
    expect(ok, `the suggestion was refused: ${ok?.hint ?? ''}`).toBeNull();
  });
});
