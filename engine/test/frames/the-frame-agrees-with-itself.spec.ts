/**
 * ★ ONE FRAME, ONE MEANING PER WORD — four places the published frame disagreed with itself.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * Measured on the live world's frames, each a projection defect (none of these numbers is world
 * state; all four are read off books the frame already reads):
 *
 *   (a) `meters.kept`/`broken` summed the last EIGHT settlement summaries while the standings beside
 *       them are all-time, so from the ninth Reckoning the client printed "THE FRAME DISAGREES WITH
 *       ITSELF" over two honest numbers. Now `keptRecent`/`brokenRecent` with `recentFromReckoning`.
 *   (b) `frontBands[].took`/`tookQty` were 0 on every band — the only caller passed an empty map —
 *       while the ticker read "THE FRONT STRUCK … 40,000 goods gone".
 *   (c) `levyShort` ≠ Σ `tributeLines[].owed` on 8 of 13 frames: the lines were drawn at the
 *       PRE-sweep debt, the meter at the shortfall rows, which subtract what the sweep took.
 *   (d) `electiveBps` was the creator's OFFER on the compact link and the share REALISED at settlement
 *       on the settled glyph; `atStake` was the pinned elective price on the link and the half DUE on
 *       the rundown. One word, two numbers, same venture, same frame (HARD RULE 4).
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING, isSettlementTick } from '../../src/core/time.js';
import type { Handle, PrincipalId, VentureId } from '../../src/core/types.js';
import { minor, qty } from '../../src/core/units.js';
import { renderFrame, type FrameSource, type SettledView } from '../../src/frames/render.js';
import { serialiseFrame, frameIndexRow } from '../../src/frames/write.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { LEVY_GOOD, LEVY_NEWCOMER_CAPITAL_MINOR, owedAfterSweep, tributeLinesFor } from '../../src/levy/index.js';
import { CURRENCY_FAUCET, storesAccount } from '../../src/ledger/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { raidRow } from '../predation/fixture.js';
import { raidIdFor } from '../../src/predation/index.js';
import { levyWorld, tick as levyTick } from '../levy/fixture.js';
import { FIRST_ANNOUNCE_TICK, FIRST_LANDFALL_TICK, riskWorld, runTo, stockAt, tick as riskTick } from '../risk/fixture.js';

function settled(over: Partial<SettledView> = {}): SettledView {
  return {
    venture: 'v:1' as VentureId,
    kind: 'HAUL',
    stage: 'sys-05',
    creator: 'p:a' as PrincipalId,
    rolesFilled: 2,
    rolesTotal: 2,
    electiveBps: 2_500,
    atStake: minor(4_000),
    defaulted: false,
    deferred: false,
    parties: ['p:a' as PrincipalId, 'p:b' as PrincipalId],
    publicLine: null,
    sealVerdict: null,
    messages: [],
    ...over,
  };
}

function source(over: Partial<FrameSource> = {}): FrameSource {
  return {
    reckoning: 9,
    tick: 9 * TICKS_PER_RECKONING + TICKS_PER_RECKONING - 1,
    stateHash: 'x'.repeat(64),
    settled: [],
    meters: { levyShort: minor(0), onAPromise: minor(0), keptRecent: 40, brokenRecent: 4, recentFromReckoning: 2 },
    handles: new Map<PrincipalId, Handle>(),
    ticker: [],
    tomorrow: [],
    ...over,
  };
}

describe('(a) the scoreboard names the span it covers', () => {
  it('★ the published meters and the index row carry keptRecent/brokenRecent and the span, never a bare kept', () => {
    const frame = renderFrame(source());
    const published = JSON.parse(serialiseFrame(frame)) as { meters: Record<string, unknown> };
    expect(published.meters).toMatchObject({ keptRecent: 40, brokenRecent: 4, recentFromReckoning: 2 });
    expect(Object.keys(published.meters)).not.toContain('kept');
    expect(Object.keys(published.meters)).not.toContain('broken');
    const row = frameIndexRow(frame) as unknown as Record<string, unknown>;
    expect(row).toMatchObject({ keptRecent: 40, brokenRecent: 4, recentFromReckoning: 2 });
    expect(Object.keys(row)).not.toContain('kept');
  });

  it('the runtime publishes the first Reckoning its summaries actually cover, not 0 by default', () => {
    // A world that starts mid-season holds summaries only from its own first Reckoning on, so the
    // span really does not reach back to R0 — the case where comparing against the standings lies.
    const start = 9 * TICKS_PER_RECKONING;
    const runtime = new Runtime({ seed: 'span-r9', startTick: start });
    const cast = new HeuristicCast(runtime, { size: 4 });
    cast.seat('span-r9');
    while (!isSettlementTick(runtime.engine.tick) || runtime.engine.tick < start) {
      for (const a of cast.decide(runtime.engine.tick + 1, 'span-r9')) runtime.engine.submit(a);
      runtime.runTick();
    }
    const frame = runtime.reckoningFrame();
    expect(frame?.reckoningIndex).toBe(9);
    expect(frame?.meters.recentFromReckoning, 'the span starts where the summaries start').toBe(9);
  }, 120_000);
});

describe('(b) a struck front says what it took', () => {
  it('★ the struck band carries the goods and value destroyed at its system', () => {
    const world = riskWorld('band-took', 3, 'MARCHES');
    const { runtime, principals } = world;
    const holder = principals[0];
    if (holder === undefined) throw new Error('fixture');
    runTo(runtime, FIRST_ANNOUNCE_TICK);
    const front = runtime.risk.allFronts()[0];
    if (front === undefined) throw new Error('no front');
    const cell = [...front.swath].sort((a, b) => b.intensityBps - a.intensityBps)[0];
    if (cell === undefined) throw new Error('no swath');
    stockAt(runtime, holder, cell.system, 200_000, LEVY_GOOD);

    const before = runtime.frontBandLines(runtime.engine.tick);
    expect(before.length).toBeGreaterThan(0);
    for (const band of before) {
      expect(band.took, 'nothing is taken before landfall').toBe(0);
      expect(band.tookQty).toBe(0);
    }

    runTo(runtime, FIRST_LANDFALL_TICK);
    riskTick(runtime);
    const swept = runtime.events
      .eventsAtTick(FIRST_LANDFALL_TICK)
      .filter((e) => e.event.kind === 'front.swept' && e.event.eventFamilyId === front.id);
    expect(swept.length, 'non-vacuity: the front struck').toBe(1);
    const destroyed = Number(swept[0]?.event.payload['destroyedQty']);
    expect(destroyed, 'non-vacuity: the strike destroyed something').toBeGreaterThan(0);

    const bands = runtime.frontBandLines(runtime.engine.tick).filter((b) => b.front === front.id);
    const here = bands.find((b) => b.system === cell.system);
    expect(here?.tookQty, 'the band over the stocked system must say what it lost').toBeGreaterThan(0);
    expect(here?.took).toBe(Number(here?.tookQty) * runtime.markOf(LEVY_GOOD, runtime.engine.tick));
    // And the bands account for the whole strike, as the ticker and the event row do.
    expect(bands.reduce((n, b) => n + Number(b.tookQty), 0)).toBe(destroyed);
  });
});

describe('(c) the Levy headline and its decomposition are one number', () => {
  it('★ a line is drawn at the post-sweep debt, the shortfall row’s own arithmetic', () => {
    const world = levyWorld('tribute-after-sweep', 2, 1);
    const runtime = world.runtime;
    const swept = world.principals[0];
    if (swept === undefined) throw new Error('fixture');
    levyTick(runtime);
    const owing = runtime.levy.owingOf(0, swept);
    expect(owing.purchasableOwed, 'non-vacuity: there is a purchasable bucket to sweep').toBeGreaterThan(10);
    // The book's own door, the one `settle.ts` uses.
    runtime.levy.recordSweep(0, swept, qty(10));
    const line = tributeLinesFor({ book: runtime.levy, world: runtime.world, reckoning: 0, tick: runtime.engine.tick }).find(
      (l) => l.principal === swept,
    );
    expect(line?.owed, 'drawn at what the sweep left, not at what it found').toBe(owing.owed - 10);
    expect(owedAfterSweep(runtime.levy, 0, swept)).toBe(owing.presenceOwed + owing.purchasableOwed - 10);
  });

  it('★ at settlement, after a real sweep, levyShort is exactly the sum of the tribute lines', () => {
    let sweptAnywhere = 0;
    for (const seed of ['levy-agree-a', 'levy-agree-b']) {
      // Nobody delivers. Each principal is capitalised past the newcomer line (a newcomer is never
      // swept) and holds a little of the levy good unpledged, so the settlement sweep has something
      // to take — the case on which the meter and the lines used to part.
      const world = levyWorld(seed, 3, 1);
      const runtime = world.runtime;
      for (const p of world.principals) {
        runtime.ledger.issueCurrency({
          eventId: `fixture:capital:${p}` as never,
          tick: 0,
          faucet: CURRENCY_FAUCET.STARTER_STAKE,
          to: storesAccount(p),
          amount: minor(LEVY_NEWCOMER_CAPITAL_MINOR * 2),
        });
        stockAt(runtime, p, world.stage, 40, LEVY_GOOD);
      }
      while (runtime.engine.tick < TICKS_PER_RECKONING - 1) levyTick(runtime);
      const frame = runtime.reckoningFrame();
      expect(frame?.reckoningIndex).toBe(0);
      const lines = frame?.tributeLines ?? [];
      expect(lines.length, 'non-vacuity: everybody is assessed').toBe(3);
      expect(lines.reduce((n, l) => n + l.owed, 0)).toBe(frame?.meters.levyShort);
      // Every line agrees with its own shortfall row, which is what the record calls owed.
      for (const l of lines) {
        expect(l.owed).toBe(runtime.levy.shortfallOf(0, l.principal)?.owed ?? 0);
        sweptAnywhere += runtime.levy.paymentOf(0, l.principal).swept;
      }
    }
    expect(sweptAnywhere, 'non-vacuity: the settlement sweep must have taken something').toBeGreaterThan(0);
  });
});

describe('(d) electiveBps and atStake mean one thing each', () => {
  it('★ the rundown publishes the beat’s own size as magnitude, with its unit, and no atStake', () => {
    const frame = renderFrame(
      source({
        settled: [settled({ atStake: minor(4_000), defaulted: true, withheld: minor(1_000) })],
        raidLines: [
          {
            raid: raidIdFor(9 * TICKS_PER_RECKONING + 10, 0),
            stage: 'sys-x' as never,
            target: 'p:t' as PrincipalId,
            initiator: null,
            demand: 3_000,
            state: 'PLUNDERED',
            lost: 2_500,
            raiderForce: 3,
            defenderForce: 1,
            ticksLeft: 0,
            defenders: [],
            raiders: [],
          },
        ],
      }),
    );
    const published = JSON.parse(serialiseFrame(frame)) as { rundown: Record<string, unknown>[] };
    const settlement = published.rundown.find((b) => b['kind'] === 'SETTLEMENT');
    const plunder = published.rundown.find((b) => b['kind'] === 'PLUNDER');
    expect(settlement).toMatchObject({ magnitude: 4_000, magnitudeUnit: 'MINOR' });
    expect(plunder).toMatchObject({ magnitude: 2_500, magnitudeUnit: 'QTY' });
    for (const beat of published.rundown) expect(Object.keys(beat)).not.toContain('atStake');
    // Sanity on the fixture helper: a raid row built by the predation fixture is a world raid.
    expect(raidRow().initiator).toBeNull();
  });

  it('★ a settled venture’s glyph arc and its compact link carry the same electiveBps', () => {
    const seed = 'one-bps';
    const runtime = new Runtime({ seed });
    const cast = new HeuristicCast(runtime, { size: 10 });
    cast.seat(seed);
    for (let t = 0; t < TICKS_PER_RECKONING; t += 1) {
      for (const a of cast.decide(runtime.engine.tick + 1, seed)) runtime.engine.submit(a);
      runtime.runTick();
    }
    const frame = runtime.reckoningFrame();
    const glyphs = new Map(frame?.rundown.filter((b) => b.glyph !== null).map((b) => [String(b.glyph?.venture), b.glyph]));
    const linked = (frame?.compactLinks ?? []).filter((l) => glyphs.has(String(l.venture)));
    expect(linked.length, 'non-vacuity: a settled venture with both a glyph and a link').toBeGreaterThan(0);
    for (const link of linked) {
      expect(glyphs.get(String(link.venture))?.electiveBps, `${link.venture}`).toBe(link.electiveBps);
    }
  }, 300_000);
});
