/**
 * The map: launch scale, determinism, and the structural promises the rest of the
 * engine is allowed to rely on (SPEC §4).
 *
 * The golden hash is what makes "Phase 0 ships a fixed authored map" true. The map
 * is generated, but it cannot *change* without this file changing, which is the
 * property that actually mattered — place IDs are permanent (§4.2), so a map that
 * silently re-wired itself between deploys would orphan every ledger reference to
 * a place.
 */

import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { GATE_TRANSIT } from '../../src/core/time.js';
import type { SystemId } from '../../src/core/types.js';
import {
  assertMapStructure,
  CONSTELLATION_SIZE_BOUNDS,
  commonsSystems,
  generateMap,
  LAUNCH_PLAN,
  LAUNCH_SEED,
  LAUNCH_SYSTEM_BOUNDS,
  laneBetween,
  laneKey,
  launchMap,
  MapError,
  mapHash,
  nearestCommons,
  route,
  systemOf,
  tierOf,
  transitTicks,
} from '../../src/world/index.js';

interface Golden {
  readonly seed: string;
  readonly hash: string;
  readonly systemCount: number;
  readonly laneCount: number;
  readonly commons: readonly string[];
}

const golden = JSON.parse(
  readFileSync(new URL('./golden/launch-map.json', import.meta.url), 'utf8'),
) as Golden;

describe('the launch map', () => {
  it('is the golden map — a change here is a change to the world, not to a test', () => {
    const map = launchMap();
    expect(golden.seed).toBe(LAUNCH_SEED);
    expect(mapHash(map)).toBe(golden.hash);
    expect(map.systems.size).toBe(golden.systemCount);
    expect(map.lanes.size).toBe(golden.laneCount);
    expect(commonsSystems(map)).toEqual(golden.commons);
  });

  it('is Phase 0 launch scale: one region, 4 constellations, ~30 systems', () => {
    const map = launchMap();
    expect(map.constellations.size).toBe(4);
    expect(map.systems.size).toBeGreaterThanOrEqual(LAUNCH_SYSTEM_BOUNDS.min);
    expect(map.systems.size).toBeLessThanOrEqual(LAUNCH_SYSTEM_BOUNDS.max);
    for (const con of map.constellations.values()) {
      expect(con.systems.length).toBeGreaterThanOrEqual(CONSTELLATION_SIZE_BOUNDS.min);
      expect(con.systems.length).toBeLessThanOrEqual(CONSTELLATION_SIZE_BOUNDS.max);
    }
  });

  it('has all three zone tiers, and the Commons is the smallest of them', () => {
    const map = launchMap();
    const tiers = new Map<string, number>();
    for (const system of map.systems.values()) {
      tiers.set(system.tier, (tiers.get(system.tier) ?? 0) + 1);
    }
    expect(tiers.get('COMMONS')).toBe(LAUNCH_PLAN.commonsSystems);
    expect(tiers.get('MARCHES')).toBeGreaterThan(0);
    expect(tiers.get('FRONTIER')).toBeGreaterThan(0);
  });

  it('names every system uniquely — the feed says "fell at Orison", not "at sys-05"', () => {
    const map = launchMap();
    const names = new Set<string>();
    for (const system of map.systems.values()) {
      expect(system.name.length).toBeGreaterThan(0);
      names.add(system.name);
    }
    expect(names.size).toBe(map.systems.size);
  });
});

describe('determinism', () => {
  it('is a pure function of the seed', () => {
    expect(mapHash(generateMap('seed-a'))).toBe(mapHash(generateMap('seed-a')));
    expect(mapHash(generateMap('seed-a'))).not.toBe(mapHash(generateMap('seed-b')));
  });

  it('gives every lane a fixed transit cost, identical in both directions', () => {
    const map = launchMap();
    for (const lane of map.lanes.values()) {
      expect(transitTicks(map, lane.a, lane.b)).toBe(lane.transitTicks);
      expect(transitTicks(map, lane.b, lane.a)).toBe(lane.transitTicks);
      expect(Number.isSafeInteger(lane.transitTicks)).toBe(true);
    }
  });

  it('draws gate transit from the table in core/time.ts and nowhere else', () => {
    const map = launchMap();
    for (const lane of map.lanes.values()) {
      const bounds =
        lane.kind === 'INTRA' ? GATE_TRANSIT.intraConstellation : GATE_TRANSIT.interConstellation;
      expect(lane.transitTicks).toBeGreaterThanOrEqual(bounds.min);
      expect(lane.transitTicks).toBeLessThanOrEqual(bounds.max);
    }
  });

  it('classifies a lane INTRA exactly when it stays inside one constellation', () => {
    const map = launchMap();
    for (const lane of map.lanes.values()) {
      const same = systemOf(map, lane.a).constellation === systemOf(map, lane.b).constellation;
      expect(lane.kind).toBe(same ? 'INTRA' : 'INTER');
    }
  });
});

describe('the Commons is reachable from everywhere (A8 as topology)', () => {
  it('routes every system to a COMMONS system', () => {
    const map = launchMap();
    for (const id of map.systemOrder) {
      const home = nearestCommons(map, id);
      expect(home).not.toBeNull();
      const end = home?.path[home.path.length - 1];
      expect(end === undefined ? '' : tierOf(map, end)).toBe('COMMONS');
    }
  });

  it('keeps the Commons in the interior: no COMMONS system has a lane out of its constellation', () => {
    const map = launchMap();
    for (const lane of map.lanes.values()) {
      if (lane.kind !== 'INTER') continue;
      expect(tierOf(map, lane.a)).not.toBe('COMMONS');
      expect(tierOf(map, lane.b)).not.toBe('COMMONS');
    }
  });

  it('keeps the Commons connected to itself, so a haul can happen inside it (§9)', () => {
    const map = launchMap();
    const commons = commonsSystems(map);
    expect(commons.length).toBeGreaterThan(1);
    for (const a of commons) {
      for (const b of commons) {
        const r = route(map, a, b);
        expect(r).not.toBeNull();
        // The route between two Commons systems never leaves the Commons.
        for (const hop of r?.path ?? []) expect(tierOf(map, hop)).toBe('COMMONS');
      }
    }
  });
});

describe('routing (A2: known arithmetic is exact and machine-readable)', () => {
  const map = launchMap();

  it('costs zero to stay put and is symmetric', () => {
    const first = map.systemOrder[0] as SystemId;
    expect(route(map, first, first)).toEqual({ path: [first], lanes: [], ticks: 0 });
    for (const a of map.systemOrder) {
      for (const b of map.systemOrder) {
        expect(route(map, a, b)?.ticks).toBe(route(map, b, a)?.ticks);
      }
    }
  });

  it('returns a walkable path whose cost is the sum of its lanes', () => {
    for (const a of map.systemOrder) {
      for (const b of map.systemOrder) {
        const r = route(map, a, b);
        expect(r).not.toBeNull();
        if (r === null) continue;
        let sum = 0;
        for (let i = 1; i < r.path.length; i += 1) {
          const from = r.path[i - 1] as SystemId;
          const to = r.path[i] as SystemId;
          const lane = laneBetween(map, from, to);
          expect(lane).not.toBeNull();
          expect(r.lanes[i - 1]).toBe(laneKey(from, to));
          sum += lane?.transitTicks ?? 0;
        }
        expect(r.ticks).toBe(sum);
      }
    }
  });

  it('is never longer than any single lane it could have taken instead', () => {
    for (const lane of map.lanes.values()) {
      expect(route(map, lane.a, lane.b)?.ticks).toBeLessThanOrEqual(lane.transitTicks);
    }
  });

  it('refuses a multi-hop move: transit cost is per gate, so an ETA is per gate', () => {
    const far = map.systemOrder[map.systemOrder.length - 1] as SystemId;
    const first = map.systemOrder[0] as SystemId;
    expect(() => transitTicks(map, first, far)).toThrow(MapError);
  });
});

describe('PROP: any seed produces a legal map', () => {
  it('holds for arbitrary seeds', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 24 }), (seed) => {
        // generateMap asserts structure internally; re-running it here means a
        // future refactor that removes the internal call still fails this test.
        const map = generateMap(seed);
        assertMapStructure(map);
        expect(map.systems.size).toBeGreaterThanOrEqual(LAUNCH_SYSTEM_BOUNDS.min);
        expect(commonsSystems(map).length).toBe(LAUNCH_PLAN.commonsSystems);
      }),
      { numRuns: 25 },
    );
  });
});

describe('a broken map cannot exist', () => {
  it('rejects a plan whose constellations are outside SPEC §4.2 bounds', () => {
    expect(() =>
      generateMap('x', { ...LAUNCH_PLAN, systemsPerConstellation: { min: 2, max: 2 } }),
    ).toThrow(MapError);
  });

  it('rejects a plan with no room for an inter-constellation gate outside the Commons', () => {
    expect(() => generateMap('x', { ...LAUNCH_PLAN, commonsSystems: 4, systemsPerConstellation: { min: 4, max: 4 } })).toThrow(
      MapError,
    );
  });

  it('detects a map whose Commons has been cut off', () => {
    const map = launchMap();
    const commons = commonsSystems(map)[0] as SystemId;
    const severed = new Map(map.systems);
    for (const [id, system] of severed) {
      severed.set(id, { ...system, lanes: system.lanes.filter((l) => l !== commons) });
    }
    const cut = severed.get(commons);
    if (cut !== undefined) severed.set(commons, { ...cut, lanes: [] });
    expect(() => assertMapStructure({ ...map, systems: severed })).toThrow(MapError);
  });
});
