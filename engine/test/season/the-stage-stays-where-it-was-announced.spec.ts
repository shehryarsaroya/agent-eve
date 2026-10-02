/**
 * ★ **THE GRAND STAGE IS A FUNCTION OF THE SEASON, NOT OF HOW FAR THE REGION HAS GROWN** (Season 1 merge).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * The season lane stages the grand venture at the Frontier system farthest from the Commons, read off
 * the live map; the scale lane lets the map GROW, each new constellation bringing two COMMONS systems of
 * its own. `header.season.grand.stage` is announced from the season's first tick, the house cast walks
 * hands there two Reckonings out, and SSN-1 re-derives every grand venture's stage from the map every
 * tick — so a stage that moved when a constellation opened would strand every crew and halt the world.
 *
 * Today's generator never moves it (an anchor sits on the core side of every bridge), and the first case
 * below pins that measurement. The second builds the map the generator does not draw — a grown COMMONS
 * one lane from the farthest Frontier system — and shows the stage still stands, because the search reads
 * the launch map's graph by construction (`season/grand.ts:hopsFromCommons`).
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { setSpeed } from '../../src/core/time.js';
import type { ConstellationId, StarSystem, SystemId } from '../../src/core/types.js';
import { grandStageFor, hopsFromCommons } from '../../src/season/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { laneKey, openConstellation, type WorldMap } from '../../src/world/index.js';

const SEEDS = ['g01', 'g02', 'g03', 'g07', 'cf-a', 'cf-b', 'fs-a', 'fs-b'];

function launchMap(seed: string): WorldMap {
  setSpeed('instant');
  return new Runtime({ seed }).world.map;
}

describe('★ the grand stage stays where the season announced it', () => {
  it('as the region grows — every seed, up to eight new constellations, four seasons of rotation', () => {
    for (const seed of SEEDS) {
      const base = launchMap(seed);
      let grown = base;
      for (let opened = 1; opened <= 8; opened += 1) {
        grown = openConstellation(grown);
        expect(grown.grown.length).toBe(opened);
        for (let season = 1; season <= 4; season += 1) {
          expect(grandStageFor(grown, season), `${seed}, ${String(opened)} grown, season ${String(season)}`).toBe(
            grandStageFor(base, season),
          );
        }
      }
    }
  });

  it('even on a map where a grown COMMONS would sit one lane from the farthest Frontier system', () => {
    const base = launchMap('g02');
    const stage = grandStageFor(base, 1);
    if (stage === null) throw new Error('the launch map has no Frontier');
    const farthest = hopsFromCommons(base).get(stage);
    expect(farthest, 'the stage is several hops out').toBeGreaterThan(2);

    // A map the generator does not draw: one grown COMMONS system hung directly off the stage.
    const intruder = 'sys-900' as SystemId;
    const constellation = 'c-grown-test' as ConstellationId;
    const systems = new Map<SystemId, StarSystem>(base.systems);
    const at = systems.get(stage);
    if (at === undefined) throw new Error('unreachable');
    systems.set(stage, { ...at, lanes: [...at.lanes, intruder] });
    systems.set(intruder, { id: intruder, constellation, name: 'Intruder', tier: 'COMMONS', lanes: [stage] });
    const gate = laneKey(stage, intruder);
    const hostile: WorldMap = {
      ...base,
      systemOrder: [...base.systemOrder, intruder],
      systems,
      grown: [{ index: 1, constellation, systems: [intruder], gate, anchor: stage, landing: intruder }],
    };

    // Read as a source, the intruder would make the stage one hop from civic law and move the prize.
    expect(hopsFromCommons(hostile).has(intruder), 'a grown system is not on the launch graph').toBe(false);
    expect(hopsFromCommons(hostile).get(stage), 'the stage keeps its launch-map distance').toBe(farthest);
    for (let season = 1; season <= 4; season += 1) {
      expect(grandStageFor(hostile, season), `season ${String(season)}`).toBe(grandStageFor(base, season));
    }
  });
});
