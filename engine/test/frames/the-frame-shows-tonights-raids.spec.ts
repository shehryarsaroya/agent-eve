/**
 * ★ A FRAME IS ONE NIGHT: its raid lines and PLUNDER beats are this Reckoning's, not the all-time top six.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `raidLinesFor` read the whole raid book — up to `MAX_RAID_ROWS` rows, retained across Reckonings —
 * and kept the six biggest demands. A resolved raid's demand never shrinks, so the settled frame for
 * Reckoning 12 (ticks 3456–3743) published `raid:1920:0`, `raid:3288:0`, `raid:3216:0`,
 * `raid:768:0`, `raid:48:0` and `raid:2928:0`: five of six from earlier nights. The rundown built its
 * PLUNDER beats from those lines, so the nightly broadcast re-ran old losses as tonight's news, and the
 * map drew their halos over systems where nothing was happening.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING, isSettlementTick, reckoningIndex } from '../../src/core/time.js';
import { qty } from '../../src/core/units.js';
import { MAX_RAID_LINES, type RaidLine } from '../../src/frames/contract.js';
import { renderFrame, type FrameSource } from '../../src/frames/render.js';
import { Book, raidIdFor, raidIsInReckoning, raidLinesFor, type RaidId } from '../../src/predation/index.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { raidRow } from '../predation/fixture.js';

/** Reckoning 12, the frame the defect was measured on. */
const R12_OPENS = 12 * TICKS_PER_RECKONING;
const R12_SETTLES = R12_OPENS + TICKS_PER_RECKONING - 1;

/** A raid that spawned at `at`, resolved `PLUNDERED` 24 ticks later, and took everything it asked. */
function plundered(at: number, demand: number): ReturnType<typeof raidRow> {
  return raidRow({
    id: raidIdFor(at, 0),
    spawnedAtTick: at,
    resolvesAtTick: at + 24,
    demandQty: qty(demand),
    state: 'PLUNDERED',
    resolvedAtTick: at + 24,
    lostQty: qty(demand),
    raiderForce: 3,
    defenderForce: 1,
  });
}

/** The book as it stood on the night: six big old raids, and tonight's smaller ones. */
function nightTwelve(): Book {
  const book = new Book();
  // The six the frame actually published, all larger than anything tonight. `raid:3288` spawned in
  // Reckoning 11 and resolved there too (3312 < 3456), so it is just as stale as `raid:48`.
  for (const [at, demand] of [[1920, 6_000], [3288, 5_900], [3216, 5_800], [768, 5_700], [48, 5_600], [2928, 5_500]] as const) {
    book.spawn(plundered(at, demand));
  }
  // Tonight: one that straddled the boundary and resolved inside it, one that resolved inside it,
  // and one still live at the settlement.
  book.spawn(plundered(R12_OPENS - 10, 2_000)); // resolves at R12_OPENS + 14
  book.spawn(plundered(R12_OPENS + 100, 1_500));
  book.spawn(raidRow({ id: raidIdFor(R12_SETTLES - 20, 0), spawnedAtTick: R12_SETTLES - 20, resolvesAtTick: R12_SETTLES + 4, demandQty: qty(1_000) }));
  return book;
}

function source(raidLines: readonly RaidLine[]): FrameSource {
  return {
    reckoning: 12,
    tick: R12_SETTLES,
    stateHash: 'x'.repeat(64),
    settled: [],
    meters: { levyShort: 0 as never, onAPromise: 0 as never, keptRecent: 0, brokenRecent: 0 },
    handles: new Map(),
    ticker: [],
    tomorrow: [],
    raidLines,
  };
}

describe('the raid lines are the night’s, not the season’s', () => {
  it('★ the frame for Reckoning 12 no longer reruns raids from Reckonings 0–11', () => {
    const book = nightTwelve();
    const lines = raidLinesFor(book, R12_SETTLES, MAX_RAID_LINES);
    const ids = lines.map((l) => l.raid);
    // Non-vacuity: the stale six are still in the book, and would win on demand alone.
    expect(book.all().length).toBe(9);
    for (const stale of [1920, 3288, 3216, 768, 48, 2928]) {
      expect(ids, `raid:${String(stale)}:0 resolved before tonight`).not.toContain(raidIdFor(stale, 0));
    }
    expect(ids).toEqual([
      raidIdFor(R12_SETTLES - 20, 0), // still DEMANDED: a countdown first
      raidIdFor(R12_OPENS - 10, 0), // spawned last night, resolved tonight
      raidIdFor(R12_OPENS + 100, 0),
    ]);
  });

  it('a standoff that straddles the boundary is live on both nights it spans', () => {
    const book = new Book();
    book.spawn(raidRow({ id: raidIdFor(R12_OPENS - 10, 0), spawnedAtTick: R12_OPENS - 10, resolvesAtTick: R12_OPENS + 14 }));
    expect(raidLinesFor(book, R12_OPENS - 1, MAX_RAID_LINES)).toHaveLength(1);
    expect(raidLinesFor(book, R12_OPENS + 5, MAX_RAID_LINES)).toHaveLength(1);
  });

  it('a frame rendered late cannot pick up a raid spawned after it', () => {
    const late = raidRow({ id: raidIdFor(R12_SETTLES + 30, 0), spawnedAtTick: R12_SETTLES + 30, resolvesAtTick: R12_SETTLES + 54 });
    expect(raidIsInReckoning(late, R12_SETTLES)).toBe(false);
  });

  it('★ the rundown’s PLUNDER beats are tonight’s plunders, and only tonight’s', () => {
    const frame = renderFrame(source(raidLinesFor(nightTwelve(), R12_SETTLES, MAX_RAID_LINES)));
    const plunders = frame.rundown.filter((b) => b.kind === 'PLUNDER');
    expect(plunders.length, 'non-vacuity: tonight did have plunders').toBe(2);
    // The deed names what was lost; tonight's two plunders took 2,000 and 1,500 — never 6,000.
    const taken = plunders.map((b) => Number(/lost (\d+)/.exec(b.deed)?.[1])).sort((a, b) => a - b);
    expect(taken).toEqual([1_500, 2_000]);
    // And the frame's halos (raidLines) agree with the beats about which raids happened.
    expect(frame.raidLines.map((l) => l.raid)).not.toContain(raidIdFor(1920, 0));
  });
});

describe('in a played world, both frames carry only the current Reckoning’s raids', () => {
  it('★ at the second settlement, and mid-Reckoning on the live frame', () => {
    const seed = 'raids-tonight';
    const runtime = new Runtime({ seed });
    const cast = new HeuristicCast(runtime, { size: 10 });
    cast.seat(seed);
    let checkedLive = false;
    let checkedSettled = false;
    let staleSeen = 0;
    for (let t = 0; t < 2 * TICKS_PER_RECKONING; t += 1) {
      for (const a of cast.decide(runtime.engine.tick + 1, seed)) runtime.engine.submit(a);
      const report = runtime.runTick();
      expect(report.halted).toBe(false);
      const tick = report.tick;
      if (reckoningIndex(tick) !== 1) continue;
      const stale = runtime.raids.all().filter((r) => !raidIsInReckoning(r, tick));
      staleSeen = Math.max(staleSeen, stale.length);
      if (tick === TICKS_PER_RECKONING + 200) {
        for (const line of runtime.liveFrame().raidLines) {
          const raid = runtime.raids.get(line.raid as RaidId);
          expect(raid !== undefined && raidIsInReckoning(raid, tick), `${line.raid} on the live frame`).toBe(true);
        }
        checkedLive = true;
      }
      if (isSettlementTick(tick)) {
        const frame = runtime.reckoningFrame();
        expect(frame?.reckoningIndex).toBe(1);
        for (const line of frame?.raidLines ?? []) {
          const raid = runtime.raids.get(line.raid as RaidId);
          expect(raid !== undefined && raidIsInReckoning(raid, tick), `${line.raid} on the settled frame`).toBe(true);
        }
        checkedSettled = true;
      }
    }
    expect(checkedLive && checkedSettled).toBe(true);
    // Non-vacuity: the book really did hold last night's raids for the filter to exclude.
    expect(staleSeen, 'no raid from Reckoning 0 was still in the book, so nothing was filtered').toBeGreaterThan(0);
  }, 300_000);
});
