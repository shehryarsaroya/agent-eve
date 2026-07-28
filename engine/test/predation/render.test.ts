/**
 * **A13 and §11.2** — the raid renders, and nothing it renders is a `SENSED` quantity.
 *
 * A13: no named pixel signature, not ready. The signature is **the raid line** — a red
 * arc on the stage, thickness ∝ the demand, a countdown while the window runs, and four
 * terminal looks.
 *
 * §11.2 is the harder half, and it is why `PUBLIC_FACT_KEYS` exists: the frame is built
 * from a checked projection, and any new field has to argue for itself against the ladder
 * before it can reach a screen. The "Charge fuel gauge" — a frame field derived from a
 * public recipe and a **private** stockpile — was exactly this mistake in a different
 * mechanic and it took an outside critic to notice.
 */

import { describe, expect, it } from 'vitest';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import { qty } from '../../src/core/units.js';
import { MAX_RAID_LINES, assertFrameBudgets, type RaidLine } from '../../src/frames/contract.js';
import { PUBLIC_FACT_KEYS, assertInertPublicFacts } from '../../src/frames/projection.js';
import { emptyFrame, renderFrame, type FrameSource } from '../../src/frames/render.js';
import { Book, RAID_DEMAND_QTY, raidIdFor, raidLinesFor, raidTickerLine } from '../../src/predation/index.js';
import { raidRow } from './fixture.js';

function source(over: Partial<FrameSource> = {}): FrameSource {
  return {
    reckoning: 1,
    tick: 287,
    stateHash: 'abc',
    settled: [],
    meters: { levyShort: 0 as never, onAPromise: 0 as never, kept: 0, broken: 0 },
    handles: new Map(),
    ticker: [],
    tomorrow: [],
    ...over,
  };
}

describe('the raid line is a named pixel signature (A13)', () => {
  it('renders live raids first, then by the size of the demand, then by id', () => {
    const book = new Book();
    book.spawn(raidRow({ id: raidIdFor(48, 0), demandQty: qty(2_000) }));
    book.spawn(raidRow({ id: raidIdFor(120, 0), demandQty: qty(6_000), spawnedAtTick: 120, resolvesAtTick: 144 }));
    book.spawn(
      raidRow({
        id: raidIdFor(192, 0),
        demandQty: qty(9_000),
        spawnedAtTick: 192,
        resolvesAtTick: 216,
        state: 'PLUNDERED',
        resolvedAtTick: 216,
        lostQty: qty(9_000),
      }),
    );
    const lines = raidLinesFor(book, 220, MAX_RAID_LINES);
    // A countdown is what a viewer looks at, so the two open ones come first even though
    // the resolved one has the biggest number on it.
    expect(lines.map((l) => l.state)).toEqual(['DEMANDED', 'DEMANDED', 'PLUNDERED']);
    expect(lines[0]?.demand).toBe(6_000);
    expect(lines[0]?.ticksLeft).toBe(0);
  });

  it('is capped by the frame budget, and the budget is asserted rather than suggested', () => {
    const many: RaidLine[] = Array.from({ length: MAX_RAID_LINES + 3 }, (_, i) => ({
      raid: `raid:${String(i)}:0`,
      stage: 'sys-1' as SystemId,
      target: 'p:a' as PrincipalId,
      initiator: null,
      demand: 1_000 + i,
      state: 'DEMANDED' as const,
      lost: 0,
      raiderForce: 3,
      defenderForce: 0,
      ticksLeft: 5,
      defenders: [],
      raiders: [],
    }));
    const frame = renderFrame(source({ raidLines: many }));
    expect(frame.raidLines).toHaveLength(MAX_RAID_LINES);
    expect(() => {
      assertFrameBudgets({ ...frame, raidLines: many });
    }).toThrow(/raid lines/);
  });

  it('refuses to draw a repulse that also took goods — the pixel and the arithmetic must agree', () => {
    const contradiction: RaidLine = {
      raid: 'raid:48:0',
      stage: 'sys-1' as SystemId,
      target: 'p:a' as PrincipalId,
      initiator: null,
      demand: 3_000,
      state: 'REPULSED',
      lost: 500,
      raiderForce: 2,
      defenderForce: 5,
      ticksLeft: 0,
      defenders: [],
      raiders: [],
    };
    expect(() => {
      assertFrameBudgets({ ...emptyFrame(1, 287, 'h'), raidLines: [contradiction] });
    }).toThrow(/REPULSED and carries a loss/);
  });

  it('never invents a raid: a source with no raid layer draws no arcs', () => {
    // Same argument as the tribute and authority lines. A red arc thrown at a holding
    // nobody attacked is the worst lie this frame could tell, so the renderer has no way
    // to produce one — it can only pass through what the predation layer handed it.
    expect(renderFrame(source()).raidLines).toEqual([]);
    expect(emptyFrame(1, 0, 'h').raidLines).toEqual([]);
  });

  it('gives each resolved raid a 140-character ticker line a stranger can read', () => {
    const lines = [
      raidTickerLine(raidRow({ state: 'REPULSED', defenderForce: 5, raiderForce: 4, forfeited: 500 as never })),
      raidTickerLine(raidRow({ state: 'PAID', lostQty: qty(3_000) })),
      raidTickerLine(raidRow({ state: 'PLUNDERED', lostQty: qty(6_000), defenderForce: 1, raiderForce: 4 })),
      raidTickerLine(raidRow({ state: 'MISSED' })),
      raidTickerLine(raidRow()),
    ];
    for (const line of lines) {
      expect(line.length).toBeGreaterThan(10);
      expect(line.length).toBeLessThanOrEqual(140);
    }
    expect(lines[0]).toContain('held the field');
    expect(lines[0]).toContain('forfeited stakes');
    expect(lines[3]).toContain('found nothing worth taking');
  });
});

describe('§11.2 — the frame projection admits the key, and admits nothing more', () => {
  it('`raidLines` is on the allow-list, so it argued for itself before it could render', () => {
    expect(PUBLIC_FACT_KEYS).toContain('raidLines');
    expect(() => {
      assertInertPublicFacts(source({ raidLines: [] }));
    }).not.toThrow();
  });

  it('still refuses an unargued key — the boundary was not widened, only extended', () => {
    // The mutation this file exists to catch: adding a field to `FrameSource` without
    // adding it to PUBLIC_FACT_KEYS with the clause that admits it.
    expect(() => {
      assertInertPublicFacts({ ...source(), raidStockpiles: { 'p:a': 40_000 } } as unknown as FrameSource);
    }).toThrow(/no §11.2 clause admits/);
  });

  it('the line carries no quantity that could be inverted into a hold value', () => {
    // The `demand` is drawn from a published ABSOLUTE band and never from what the target
    // holds (see `predation/params.ts`), so it tells a viewer nothing about the hold. This
    // pins the property that makes that true: no two lines with the same demand can imply
    // different stocks, because the demand's whole range is the published band.
    const book = new Book();
    book.spawn(raidRow({ demandQty: RAID_DEMAND_QTY.min }));
    const line = raidLinesFor(book, 50, MAX_RAID_LINES)[0];
    expect(line).toBeDefined();
    expect(Object.keys(line ?? {}).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual([
      'defenderForce',
      'demand',
      // `initiator` is admissible and had to argue for itself like every other field here.
      // Taking a side in a standoff is already `PUBLIC` — `raid.joined` publishes the joiner
      // AND its stake, and §11.2 gives `PUBLIC` to the map's motion — and the initiator is
      // simply the first party to have taken one. It is an IDENTITY, not a quantity, so there
      // is nothing in it to invert into a hold value, which is the property this test guards.
      'initiator',
      'lost',
      'raid',
      'raiderForce',
      'stage',
      'state',
      'target',
      'ticksLeft',
    ]);
    expect(line?.demand).toBeGreaterThanOrEqual(RAID_DEMAND_QTY.min);
    expect(line?.demand).toBeLessThanOrEqual(RAID_DEMAND_QTY.max);
  });

  it('the projection is inert data — a line still holding live state cannot render', () => {
    // The structural half of the boundary: `canonicalize` refuses a function outright, so
    // a "line" that is really a live read — a lazy accessor over the book, the shape the
    // fuel-gauge leak would have taken — throws rather than rendering.
    const lazy = {
      ...source(),
      raidLines: [{ raid: 'r', demand: (): number => 1 }],
    } as unknown as FrameSource;
    expect(() => {
      assertInertPublicFacts(lazy);
    }).toThrow(/not inert data/);
    // A plain value passes, which is the only thing that should.
    expect(() => {
      assertInertPublicFacts(source({ raidLines: raidLinesFor(new Book(), 0, MAX_RAID_LINES) }));
    }).not.toThrow();
  });
});
