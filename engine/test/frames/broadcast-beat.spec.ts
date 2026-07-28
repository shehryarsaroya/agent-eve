/**
 * §14.3: the ordering IS the format. Ascending by stakes, largest say-do deltas held to the end,
 * because a broken promise is the largest delta there is — Tribal Council's oldest trick, and the
 * reason the rundown is a broadcast rather than a batch.
 *
 * That rule was only ever applied to **ventures**. Everything else the night did — a claim lapsing,
 * a raid landing — reached a viewer as a static table beside the narration. So a Reckoning read as a
 * sequence followed by some lists, and the biggest irreversible loss of the night could be in one of
 * the lists.
 *
 * A lapse is permanent territorial loss with a bond slashed. Under the rule the show already
 * follows, it belongs at the END, next to the defaults. That is what this file asserts.
 */

import { describe, expect, it } from 'vitest';
import type { PrincipalId, SystemId, VentureId } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';
import {
  MAX_RUNDOWN_SEGMENTS,
  type ClaimLine,
  type MapSystem,
  type RaidLine,
} from '../../src/frames/contract.js';
import { renderFrame, type FrameSource, type SettledView } from '../../src/frames/render.js';

/** The full shape, not a cast — a stub with holes in it fails inside the renderer, not usefully. */
function settled(over: Partial<SettledView> = {}): SettledView {
  return {
    venture: 'v:1' as VentureId,
    kind: 'HAUL',
    stage: 'sys-01',
    creator: 'p:a' as PrincipalId,
    rolesFilled: 1,
    rolesTotal: 1,
    electiveBps: 5_000,
    atStake: minor(1_000),
    defaulted: false,
    deferred: false,
    parties: ['p:a' as PrincipalId, 'p:b' as PrincipalId],
    publicLine: null,
    sealVerdict: null,
    messages: [],
    ...over,
  };
}

function lapsed(system: string, slashed: number): ClaimLine {
  return {
    claim: `claim:${system}:1`,
    system: system as SystemId,
    claimant: 'p:fallen' as PrincipalId,
    state: 'LAPSED',
    legend: 'LAPSED · BOND SLASHED',
    arrears: 3,
    arrearsOf: 2,
    due: 4_000,
    owed: 4_000,
    deadlineTick: 100,
    bondAtRisk: minor(0),
    slashed: minor(slashed),
    forSale: null,
  } as ClaimLine;
}

function raid(state: string, lost: number): RaidLine {
  return {
    raid: `raid:1:${state}`,
    target: 'p:hit' as PrincipalId,
    // A WORLD raid: ownerless, which is what every beat in this file was about before `demand`
    // existed. An agent's demand renders a different sentence (the raider is named, and a
    // repulse does NOT close the stage), so leaving this undefined would have made the ordering
    // assertions below quietly about a third thing that is neither.
    initiator: null,
    stage: 'sys-07' as SystemId,
    state,
    demand: 2_000,
    lost,
    raiderForce: 3,
    defenderForce: 0,
    ticksLeft: 0,
  } as unknown as RaidLine;
}

function source(over: Partial<FrameSource> = {}): FrameSource {
  return {
    reckoning: 1,
    tick: 288,
    stateHash: 'h',
    meters: { levyShort: minor(0), onAPromise: minor(0), kept: 0, broken: 0 },
    settled: [],
    handles: new Map(),
    modelBadges: new Map(),
    ticker: [],
    tomorrow: [],
    tributeLines: [],
    authorityLines: [],
    raidLines: [],
    claimLines: [],
    saps: [],
    worksLines: [],
    syndicateLines: [],
    map: [] as readonly MapSystem[],
    ...over,
  };
}

describe('the running order crosses systems', () => {
  it('puts a lapsed claim in the rundown at all — it used to exist only in a panel', () => {
    const frame = renderFrame(source({ claimLines: [lapsed('sys-05', 50_000)] }));
    const beat = frame.rundown.find((b) => b.kind === 'LAPSE');
    expect(beat, 'a lapse is a thing that HAPPENED, so it is a beat').toBeDefined();
    expect(beat?.subject).toBe('sys-05');
    expect(beat?.venture, 'and it is not about a venture').toBeNull();
    expect(beat?.glyph, 'a glyph is venture-shaped, so a lapse has none').toBeNull();
    expect(String(beat?.deed), 'the deed line carries the story instead').toMatch(/LAPSED/);
  });

  it('holds the lapse to the END even when it is the SMALLEST thing that happened', () => {
    // THE ORDERING ASSERTION, and it is deliberately rigged against the easy reading. A lapse of
    // 10 next to kept work worth 900,000: if the sort merely ranked by amount, the lapse would come
    // FIRST. It must come last, because the rule is largest say-do delta last and a permanent
    // territorial loss is a delta regardless of its price.
    //
    // My first version of this test gave the lapse a 50,000 slash, which sorts last by size anyway —
    // so mutating the loss flag changed nothing and the test proved nothing. Mutation testing is the
    // only reason I know this version works.
    const frame = renderFrame(
      source({
        settled: [
          settled({ venture: 'v:kept-a' as VentureId, atStake: minor(900_000) }),
          settled({ venture: 'v:kept-b' as VentureId, atStake: minor(500_000) }),
        ],
        claimLines: [lapsed('sys-09', 10)],
      }),
    );
    expect(frame.rundown.length).toBe(3);
    const kinds = frame.rundown.map((b) => b.kind);
    expect(kinds[kinds.length - 1], 'the smallest loss still closes the night').toBe('LAPSE');
    expect(kinds.slice(0, 2), 'and the kept work comes first, however large').toEqual([
      'SETTLEMENT',
      'SETTLEMENT',
    ]);
    // The order field is a dense 1..n running order regardless of which systems contributed.
    expect(frame.rundown.map((b) => b.order)).toEqual([1, 2, 3]);
  });

  it('sorts a repulsed raid EARLY and a plundered one late, because one is a win', () => {
    const frame = renderFrame(
      source({ raidLines: [raid('REPULSED', 0), raid('PLUNDERED', 30_000)] }),
    );
    const kinds = frame.rundown.filter((b) => b.kind === 'PLUNDER');
    expect(kinds.length).toBe(2);
    const repulsed = frame.rundown.findIndex((b) => /held/.test(b.deed));
    const plundered = frame.rundown.findIndex((b) => /lost/.test(b.deed));
    expect(repulsed).toBeGreaterThanOrEqual(0);
    expect(plundered).toBeGreaterThan(repulsed);
  });

  it('still respects the segment budget once other systems compete for it', () => {
    // The budget is a broadcast length, not a batch size. Adding beats from three systems must not
    // let the rundown grow past what a viewer can follow.
    const many = Array.from({ length: MAX_RUNDOWN_SEGMENTS + 6 }, (_, i) =>
      settled({ venture: `v:${String(i)}` as VentureId, atStake: minor(i * 10) }),
    );
    const frame = renderFrame(
      source({
        settled: many,
        claimLines: [lapsed('sys-01', 10), lapsed('sys-02', 20)],
        raidLines: [raid('PLUNDERED', 5)],
      }),
    );
    expect(frame.rundown.length).toBeLessThanOrEqual(MAX_RUNDOWN_SEGMENTS);
    expect(frame.rundown.map((b) => b.order)).toEqual(
      Array.from({ length: frame.rundown.length }, (_, i) => i + 1),
    );
  });
});

describe('the frame carries the MAP, or nothing downstream can draw one', () => {
  /**
   * A13 calls the map *"the game's only agreed representation"*, and the frame carried **no map at
   * all**. A client saw system IDs mentioned inside claim tints, works marks and raid arcs, with no
   * topology and no way to know which other systems existed — so every line in this artifact was a
   * caption on a picture nobody could render.
   *
   * I told the user the missing piece was *coordinates*. It was not: a client can derive a layout
   * from a lane graph itself. The missing piece was the graph.
   */
  it('carries every system with its tier, constellation and lanes', () => {
    const frame = renderFrame(
      source({
        map: [
          { id: 'sys-01' as SystemId, name: 'Hearth', tier: 'COMMONS', constellation: 'con-1' as never, lanes: ['sys-02' as SystemId] },
          { id: 'sys-02' as SystemId, name: 'Verge', tier: 'MARCHES', constellation: 'con-1' as never, lanes: ['sys-01' as SystemId] },
        ],
      }),
    );
    expect(frame.map.length).toBe(2);
    expect(frame.map[0]?.lanes, 'a lane graph, so a client can lay it out').toEqual(['sys-02']);
    expect(frame.map.map((m) => m.id), 'sorted, so the file is diffable').toEqual(['sys-01', 'sys-02']);
  });

  it('carries NO coordinates, because position is presentation', () => {
    // Putting x/y on a system would put presentation inside `state_hash`, where a layout tweak
    // becomes a rules change and a replay divergence. This asserts the absence, so somebody adding
    // them later has to argue for it.
    const frame = renderFrame(
      source({
        map: [{ id: 'sys-01' as SystemId, name: 'Hearth', tier: 'COMMONS', constellation: 'con-1' as never, lanes: [] }],
      }),
    );
    const keys = Object.keys(frame.map[0] ?? {});
    expect(keys.filter((k) => /^x$|^y$|coord|position|angle|radius/i.test(k))).toEqual([]);
    // Explicit comparator: DET-1 bans a bare .sort() even on a key list. Sixth time tonight.
    expect(keys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual([
      'constellation',
      'id',
      'lanes',
      'name',
      'tier',
    ]);
  });

  it('is never truncated by a budget, because a partial map has holes in it', () => {
    // Every other line type is capped — a legend a viewer reads, not a heatmap. The map is not a
    // legend: cut it and a client draws lanes to systems it cannot place, which is worse than
    // drawing nothing.
    const many = Array.from({ length: 64 }, (_, i) => ({
      id: `sys-${String(i).padStart(2, '0')}` as SystemId,
      name: `S${String(i)}`,
      tier: 'FRONTIER' as const,
      constellation: 'con-1' as never,
      lanes: [] as SystemId[],
    }));
    expect(renderFrame(source({ map: many })).map.length).toBe(64);
  });
});
