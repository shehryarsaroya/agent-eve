/**
 * GROWTH's geography (SPEC §4.2, `world/growth.ts`) — determinism, the chokepoint, and the promise that
 * nothing already on the map is redrawn.
 *
 * Every assertion compares two of the engine's own answers — the map before and after, or two
 * independent regrowths — so none of them can pass over a fixture built beside it. Non-vacuity first
 * where it matters: a growth that opened nothing would satisfy "no existing strait moved" trivially.
 *
 * MUTATIONS EACH BLOCK IS BUILT TO KILL are named inline.
 */

import { describe, expect, it } from 'vitest';
import type { SystemId } from '../../src/core/types.js';
import { allLodes, YIELD_PER_TICK } from '../../src/works/params.js';
import {
  anchorSafeSystems,
  commonsSystems,
  generateMap,
  GROWTH_PLAN,
  GrowthError,
  laneKey,
  launchMap,
  mapHash,
  MAX_GROWN_CONSTELLATIONS,
  MAX_MAP_SYSTEMS,
  nearestCommons,
  openConstellation,
  regrowMap,
  straitsOf,
  type WorldMap,
} from '../../src/world/index.js';

const grownTimes = (n: number, base: WorldMap = launchMap()): WorldMap => regrowMap(base, n);

describe('growth is deterministic in the seed and the count, and nothing else', () => {
  it('opens the same constellation twice from the same map, byte for byte', () => {
    // MUTATION: draw the growth from a stream that includes the tick, or from a counter outside the
    // map. Two independent openings would then disagree and this is RED.
    const a = openConstellation(launchMap());
    const b = openConstellation(launchMap());
    expect(mapHash(a)).toBe(mapHash(b));
    expect(a.grown).toEqual(b.grown);
  });

  it('regrowing N at once equals growing one at a time, so a restore rebuilds the live map', () => {
    let stepwise = launchMap();
    for (let i = 0; i < 6; i += 1) stepwise = openConstellation(stepwise);
    expect(mapHash(grownTimes(6))).toBe(mapHash(stepwise));
  });

  it('two seeds grow two different regions', () => {
    const one = openConstellation(generateMap('growth-seed-a'));
    const two = openConstellation(generateMap('growth-seed-b'));
    expect(mapHash(one)).not.toBe(mapHash(two));
  });

  it('leaves the launch map hash exactly what it always was', () => {
    // A launch map with no growth must canonicalise as it did before `grown` existed, or every golden
    // snapshot hash in the repo would move for a world that never grew.
    const map = launchMap();
    expect(map.grown).toEqual([]);
    expect(mapHash(regrowMap(map, 0))).toBe(mapHash(map));
  });
});

describe('a grown constellation is joined through a STRAIT, and its COMMONS is its own floor', () => {
  const before = launchMap();
  const after = openConstellation(before);
  const record = after.grown[0];

  it('appends one constellation of the planned shape, with fresh permanent ids', () => {
    expect(record).toBeDefined();
    if (record === undefined) return;
    const tiers = record.systems.map((id) => after.systems.get(id)?.tier);
    expect(tiers.filter((t) => t === 'COMMONS')).toHaveLength(GROWTH_PLAN.commons);
    const marches = tiers.filter((t) => t === 'MARCHES').length;
    expect(marches).toBeGreaterThanOrEqual(GROWTH_PLAN.marches.min);
    expect(marches).toBeLessThanOrEqual(GROWTH_PLAN.marches.max);
    expect(tiers).not.toContain('FRONTIER');
    for (const id of record.systems) expect(before.systems.has(id)).toBe(false);
    // Names are unique across the whole map: a stranger repeats a name, never an id.
    const names = [...after.systems.values()].map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('joins the map by exactly ONE inter lane, and that lane is a STRAIT stranding the whole constellation', () => {
    // MUTATION: open the constellation with two gates. The gate then has a detour and severs nothing,
    // `assertGrowthStructure` refuses it, and so does this.
    if (record === undefined) throw new Error('no growth record');
    const own = new Set<SystemId>(record.systems);
    const crossings = after.laneOrder
      .map((k) => after.lanes.get(k))
      .filter((l) => l !== undefined && own.has(l.a) !== own.has(l.b));
    expect(crossings).toHaveLength(1);
    expect(crossings[0]?.key).toBe(record.gate);
    expect(crossings[0]?.kind).toBe('INTER');
    const gate = straitsOf(after).get(record.gate);
    expect(gate?.severs).toBe(true);
    expect(gate?.severed).toBe(record.systems.length);
  });

  it('never lets a COMMONS system touch the gate, and gives the new enclave a connected floor', () => {
    if (record === undefined) throw new Error('no growth record');
    expect(after.systems.get(record.anchor)?.tier).toBe('MARCHES');
    expect(after.systems.get(record.landing)?.tier).toBe('MARCHES');
    const enclave = commonsSystems(after).filter((id) => after.systems.get(id)?.constellation === record.constellation);
    expect(enclave).toHaveLength(GROWTH_PLAN.commons);
    // Every grown system reaches A COMMONS — its own, without leaving the constellation.
    for (const id of record.systems) {
      const home = nearestCommons(after, id);
      expect(home).not.toBeNull();
      const end = home?.path[home.path.length - 1];
      expect(end === undefined ? undefined : after.systems.get(end)?.constellation).toBe(record.constellation);
    }
  });

  it('redraws no existing strait, lane, system or lode', () => {
    // Non-vacuity: the launch map HAS straits for this to protect.
    const oldStraits = straitsOf(before);
    expect(oldStraits.size).toBeGreaterThan(0);
    const newStraits = straitsOf(after);
    for (const [key, s] of oldStraits) expect(newStraits.get(key)).toEqual(s);
    // And no lane that was not a strait became one.
    for (const key of before.laneOrder) expect(newStraits.has(key)).toBe(oldStraits.has(key));
    for (const key of before.laneOrder) expect(after.lanes.get(key)).toEqual(before.lanes.get(key));
    for (const id of before.systemOrder) {
      const was = before.systems.get(id);
      const now = after.systems.get(id);
      expect({ ...now, lanes: [] }).toEqual({ ...was, lanes: [] });
    }
    // MUTATION: allocate lodes across the whole tier instead of per grown constellation — every
    // launch MARCHES yield moves by a rounding step and this is RED.
    const oldLodes = allLodes(before);
    const newLodes = allLodes(after);
    for (const [id, lode] of oldLodes) expect(newLodes.get(id)).toEqual(lode);
  });

  it('conserves every tier exactly and keeps the grown COMMONS uniform', () => {
    if (record === undefined) throw new Error('no growth record');
    const lodes = allLodes(after);
    for (const id of record.systems) {
      const lode = lodes.get(id);
      expect(lode).toBeDefined();
      if (lode?.tier === 'COMMONS') expect(lode.richnessBps).toBe(0);
    }
    const marches = record.systems.filter((id) => after.systems.get(id)?.tier === 'MARCHES');
    expect(marches.length).toBeGreaterThan(0);
    const sum = marches.reduce((n, id) => n + (lodes.get(id)?.yieldPerTick ?? 0), 0);
    // Σ over the grown MARCHES is exactly the flat figure times their count — conserved inside the
    // grown constellation, so the tier as a whole is conserved too.
    expect(sum).toBe(YIELD_PER_TICK.MARCHES * marches.length);
  });
});

describe('growth keeps every promise across many seeds and many openings', () => {
  it('holds the structure for 12 seeds × 8 openings, and anchors only where no strait moves', () => {
    for (let s = 0; s < 12; s += 1) {
      let map = generateMap(`growth-sweep-${String(s)}`);
      for (let i = 0; i < 8; i += 1) {
        const safe = new Set(anchorSafeSystems(map));
        const next = openConstellation(map); // throws on any violation (assertGrowthStructure)
        const record = next.grown[next.grown.length - 1];
        expect(record).toBeDefined();
        if (record === undefined) break;
        expect(safe.has(record.anchor)).toBe(true);
        map = next;
      }
      expect(map.grown).toHaveLength(8);
      expect(map.systems.size).toBeLessThanOrEqual(MAX_MAP_SYSTEMS);
    }
  });

  it('spreads successive gates around the rim before reusing one', () => {
    const map = grownTimes(6);
    const anchors = map.grown.map((g) => g.anchor);
    expect(new Set(anchors).size).toBe(anchors.length);
  });

  it('refuses to grow past its ceiling rather than walk the map past every per-system cap', () => {
    const tiny = MAX_GROWN_CONSTELLATIONS;
    expect(tiny).toBeGreaterThan(0);
    const full = { ...launchMap(), grown: Array.from({ length: tiny }, (_, i) => ({
      index: i + 1,
      constellation: `con-x${String(i)}`,
      systems: [],
      gate: laneKey('sys-01' as SystemId, 'sys-02' as SystemId),
      anchor: 'sys-01',
      landing: 'sys-02',
    })) } as unknown as WorldMap;
    expect(() => openConstellation(full)).toThrow(GrowthError);
  });
});
