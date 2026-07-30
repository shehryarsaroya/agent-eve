/**
 * A13 — the three signatures **carry data**, not just fields.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * *"A capability that exists and is never exercised is indistinguishable from one that is missing"* —
 * and this project has shipped that at the *frame* depth before: `RaidLine` gained `defenders[]` and
 * `raiders[]`, and *"`raiderForce`/`defenderForce` are written at resolution, so for the whole window —
 * the only interval an audience watches — a four-ally arc drew byte-identically to a lone defender."*
 *
 * A field on `ReckoningFrame` that is `[]` in every real frame is the same defect. So this asserts the
 * three signatures are **non-empty at the ticks that matter**, and that the arc's fill fraction is the
 * published escrow ratio rather than a second opinion about it.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { LEVY_GOOD } from '../../src/levy/index.js';
import {
  COVER_ELECTIVE_BPS_CEILING,
  MAX_COVER_ARCS,
  MAX_FRONT_BANDS,
  escrowRatioBps,
} from '../../src/risk/index.js';
import { MAX_FRAME_COVER_ARCS, MAX_FRAME_FRONT_BANDS } from '../../src/frames/contract.js';
import {
  FIRST_ANNOUNCE_TICK,
  FIRST_LANDFALL_TICK,
  act,
  fund,
  riskWorld,
  runTo,
  stockAt,
  tick,
} from './fixture.js';

describe('the three pixel signatures draw something', () => {
  it('★ THE FRONT BAND is the CONE before landfall and the SWATH after it', () => {
    const world = riskWorld('renders-band', 3, 'MARCHES');
    const { runtime, principals } = world;
    const holder = principals[0];
    if (holder === undefined) throw new Error('unreachable');

    runTo(runtime, FIRST_ANNOUNCE_TICK);
    const front = runtime.risk.allFronts()[0];
    if (front === undefined) throw new Error('unreachable');
    const cell = [...front.swath].sort((a, b) => b.intensityBps - a.intensityBps)[0];
    if (cell === undefined) throw new Error('unreachable');
    stockAt(runtime, holder, cell.system, 200_000, LEVY_GOOD);

    // Before: the CONE. `state` says which meaning `tintBps` carries, so the picture cannot lie.
    const forecast = runtime.frontBandLines(runtime.engine.tick);
    // MUTATION: return `[]` from `frontBands`. Red here, and nothing else notices — the frame budget
    // is satisfied by an empty list, which is how a signature becomes decoration.
    expect(forecast.length, 'the band draws while the front is still a forecast').toBeGreaterThan(0);
    for (const band of forecast) {
      expect(band.state, 'the pre-landfall band is the CONE').toBe('FORECAST');
      expect(band.ticksToLandfall).toBeGreaterThan(0);
      expect(band.legend.length, 'and every cell has a caption a viewer can read').toBeGreaterThan(0);
      expect(band.legend.length, '≤140, so it can be a ticker line').toBeLessThanOrEqual(140);
    }
    // ★ The SWATH is not published while the front is unstruck. Publishing it would be the oracle
    // CAT11 CUTS, arriving through the renderer.
    const conedSystems = new Set(forecast.map((b) => b.system));
    const swathSystems = new Set(front.swath.map((c) => c.system));
    const conedOnly = [...conedSystems].filter((s) => !swathSystems.has(s));
    expect(
      conedOnly.length,
      'the pre-landfall band names systems the front will MISS, so it is not the swath in disguise',
    ).toBeGreaterThan(0);

    runTo(runtime, FIRST_LANDFALL_TICK);
    tick(runtime);
    const struck = runtime.frontBandLines(runtime.engine.tick);
    expect(struck.length, 'and it draws after it lands').toBeGreaterThan(0);
    expect(struck.every((b) => b.state === 'STRUCK' || b.state === 'PASSED')).toBe(true);
    expect(struck.length, 'inside §17’s budget').toBeLessThanOrEqual(
      Math.min(MAX_FRONT_BANDS, MAX_FRAME_FRONT_BANDS),
    );
  });

  it('★ THE COVER ARC’s fill fraction IS the published escrow ratio (§7.5)', () => {
    const world = riskWorld('renders-arc', 5, 'MARCHES');
    const { runtime, principals } = world;
    const [payee, payer, , bankA, bankB] = principals;
    if (payee === undefined || payer === undefined || bankA === undefined || bankB === undefined) {
      throw new Error('unreachable');
    }
    fund(runtime, bankA, payer, 200_000);
    fund(runtime, bankB, payee, 200_000);

    runTo(runtime, FIRST_ANNOUNCE_TICK);
    const front = runtime.risk.allFronts()[0];
    if (front === undefined) throw new Error('unreachable');
    const cell = [...front.cone].sort((a, b) => b.oddsBps - a.oddsBps)[0];
    if (cell === undefined) throw new Error('unreachable');
    stockAt(runtime, payee, cell.system, 200_000, LEVY_GOOD);

    act(runtime, payer, 'publish_offer', {
      kind: 'COVER',
      system: cell.system,
      good: LEVY_GOOD,
      limit: 40_000,
      premium: 1_000,
      elective_bps: COVER_ELECTIVE_BPS_CEILING,
    });
    const cover = runtime.risk.coversBy(payer)[0];
    if (cover === undefined) throw new Error('unreachable');
    act(runtime, payee, 'sign', { cover: cover.id, terms_hash: cover.termsHash ?? '' });

    const arcs = runtime.coverArcLines(runtime.engine.tick);
    expect(arcs.length, 'a bound COVER draws an arc').toBe(1);
    const arc = arcs[0];
    if (arc === undefined) throw new Error('unreachable');
    // MUTATION: compute `filledBps` in `coverArcs` from anything other than `escrowRatioBps`. Red
    // here — and the picture and the number §7.5 requires be published would drift apart, which is
    // scar #1 rendered.
    expect(arc.filledBps, 'the arc IS the escrow ratio, not a second opinion about it').toBe(
      escrowRatioBps(cover),
    );
    expect(arc.onItsWord, 'and the hollow part is the promise, in money').toBe(cover.elective);
    expect(arc.inCone, 'the covered system is inside the live CONE, so the arc is about to matter').toBe(
      true,
    );
    expect(arcs.length).toBeLessThanOrEqual(Math.min(MAX_COVER_ARCS, MAX_FRAME_COVER_ARCS));
  });

  it('★ THE COVER CHAIN snaps at the link that broke and greys every link inward', () => {
    const world = riskWorld('renders-chain', 7, 'MARCHES');
    const { runtime, principals } = world;
    const [payee, payer, reinsurer, bankA, bankB, bankC] = principals;
    if (
      payee === undefined ||
      payer === undefined ||
      reinsurer === undefined ||
      bankA === undefined ||
      bankB === undefined ||
      bankC === undefined
    ) {
      throw new Error('unreachable');
    }
    fund(runtime, bankA, payer, 200_000);
    fund(runtime, bankB, reinsurer, 200_000);
    fund(runtime, bankC, payee, 200_000);

    runTo(runtime, FIRST_ANNOUNCE_TICK);
    const front = runtime.risk.allFronts()[0];
    if (front === undefined) throw new Error('unreachable');
    const cell = [...front.swath].sort((a, b) => b.intensityBps - a.intensityBps)[0];
    if (cell === undefined) throw new Error('unreachable');
    stockAt(runtime, payee, cell.system, 400_000, LEVY_GOOD);

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
    act(runtime, payee, 'sign', { cover: cover.id, terms_hash: cover.termsHash ?? '' });
    act(runtime, reinsurer, 'publish_offer', {
      kind: 'COVER',
      over: cover.id,
      limit: 10_000,
      premium: 800,
      elective_bps: COVER_ELECTIVE_BPS_CEILING,
    });
    const cession = runtime.risk.coversBy(reinsurer)[0];
    if (cession === undefined) throw new Error('unreachable');
    act(runtime, payer, 'sign', { cover: cession.id, terms_hash: cession.termsHash ?? '' });

    // Intact while the promises hold — and this half is what makes the snap legible later.
    const before = runtime.coverChainLines(runtime.engine.tick);
    expect(before.length, 'a chain of two draws one chain').toBe(1);
    expect(before[0]?.links.length, 'with both links on it').toBe(2);
    expect(before[0]?.snappedAt, 'nothing has broken yet').toBe(0);
    expect(before[0]?.links.every((l) => l.state === 'INTACT')).toBe(true);
    expect(before[0]?.links.map((l) => l.depth), 'outermost first, the way the money travels').toEqual([
      2, 1,
    ]);

    // The front lands; the primary elects; the reinsurer says nothing; the Reckoning settles.
    runTo(runtime, FIRST_LANDFALL_TICK);
    tick(runtime);
    act(runtime, payer, 'elect', { cover: cover.id, election: 'IN_FULL' });
    runTo(runtime, 3 * 288 + 287);

    const after = runtime.coverChainLines(runtime.engine.tick);
    const chain = after[0];
    expect(chain, 'the chain still draws after the settlement').toBeDefined();
    if (chain === undefined) throw new Error('unreachable');
    // MUTATION: delete the `greyed` map in `coverChains`. Red here. A viewer would see a snapped outer
    // link beside an "intact" inner one and have no way to know the inner one is now in doubt — which
    // is the whole reason this is a chain rather than two links.
    expect(chain.snappedAt, 'the reinsurer’s refusal snapped layer 2').toBe(2);
    const snapped = chain.links.filter((l) => l.state === 'SNAPPED');
    expect(snapped.length, 'one link broke').toBe(1);
    expect(snapped[0]?.broke, 'and it says how much').toBeGreaterThan(0);
    expect(chain.legend, 'the caption names the layer').toMatch(/SNAPPED at layer 2/);
  });
});
