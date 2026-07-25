/**
 * **The named place — and the A5′ hazard hiding in the map's own geography.**
 *
 * §5.2 makes the Levy payable *"only in located goods physically delivered to a named
 * place"*, so somewhere has to be that place. Which somewhere is a rules surface, and the
 * wrong choice is not a cosmetic bug:
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A Commons-bound principal may only move between Commons systems (A15, §4.1), and
 * constellation 0 of the launch map is **mixed** — its first four systems are `COMMONS` and
 * the rest are `MARCHES`. A delivery place chosen by bare canonical order therefore lands in
 * the Marches for a constellation full of Commons-bound newcomers, and **every one of them
 * is permanently, unavoidably short**: an obligation the rules make impossible to discharge,
 * recorded against a real agent every single night. That is the A5′ shape with the engine's
 * own geography as the cause, and it is exactly the class of bug this repo has shipped eight
 * of.
 *
 * A mutation run found this file missing: changing `place.ts` to prefer a `FRONTIER` system
 * left the whole Levy suite green. It is the gap that mattered most of the three the run
 * turned up.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { setSpeed } from '../../src/core/time.js';
import { constellationOf, deliveryPlaceOf, rollByConstellation } from '../../src/levy/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { commonsSystems, route, tierOf } from '../../src/world/index.js';
import { holdingOf } from '../../src/world/state.js';
import { levyWorld, tick, walkToPlace } from './fixture.js';

describe('the delivery place is reachable by every principal assessed at it', () => {
  it('is a COMMONS system wherever the constellation has one', () => {
    setSpeed('instant');
    const map = new Runtime({ seed: 'place' }).world.map;
    let checked = 0;
    for (const constellation of map.constellationOrder) {
      const place = deliveryPlaceOf(map, constellation);
      expect(place, `no delivery place for ${constellation}`).not.toBeNull();
      if (place === null) continue;
      const rows = map.constellations.get(constellation);
      const hasCommons = (rows?.systems ?? []).some((s) => tierOf(map, s) === 'COMMONS');
      if (!hasCommons) continue;
      checked += 1;
      // The clause that closes the hazard: a mixed constellation delivers to its Commons,
      // not to its Marches, or every Commons-bound principal in it is unavoidably short.
      expect(tierOf(map, place), `${constellation} delivers to a non-Commons system`).toBe('COMMONS');
    }
    // The guard's own guard: the launch map must actually contain a mixed constellation, or
    // this test passes by never looking at one.
    expect(checked).toBeGreaterThan(0);
  });

  it('prefers the Commons over a lower id — the RULE, not the launch map\'s accident', () => {
    // ══════════════════════════════════════════════════════════════════════
    // A mutation run found this one. On the launch map, `generateMap` emits a
    // constellation's Commons systems FIRST, so they already hold the lowest ids and
    // "lowest-id Commons" and "lowest-id system" return the same answer for every
    // constellation that has a Commons at all. Deleting the tier preference altogether was
    // therefore an *equivalent* mutant against the real map — the whole suite stayed green
    // while the rule was gone, and the next map generator that ordered systems differently
    // would have made every Commons-bound principal permanently short.
    //
    // So the rule is pinned against a synthetic map where the two answers differ. `WorldMap`
    // is a plain read model, which is exactly what makes this cheap.
    // ══════════════════════════════════════════════════════════════════════
    const constellation = 'con-x' as never;
    const marches = 'sys-01' as never;
    const commons = 'sys-99' as never;
    const map = {
      seed: 'synthetic',
      systemOrder: [marches, commons],
      constellationOrder: [constellation],
      laneOrder: [],
      systems: new Map([
        [marches, { id: marches, constellation, name: 'Low', tier: 'MARCHES', lanes: [commons] }],
        [commons, { id: commons, constellation, name: 'High', tier: 'COMMONS', lanes: [marches] }],
      ]),
      constellations: new Map([[constellation, { id: constellation, name: 'X', systems: [marches, commons] }]]),
      lanes: new Map(),
    } as never;
    expect(deliveryPlaceOf(map, constellation)).toBe(commons);
  });

  it('is the LOWEST-ID Commons system, so two readers cannot disagree about it', () => {
    setSpeed('instant');
    const map = new Runtime({ seed: 'place-order' }).world.map;
    const constellation = map.constellationOrder[0];
    if (constellation === undefined) throw new Error('no constellations');
    const commons = (map.constellations.get(constellation)?.systems ?? [])
      .filter((s) => tierOf(map, s) === 'COMMONS')
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(deliveryPlaceOf(map, constellation)).toBe(commons[0]);
    // Unknown constellations answer null rather than throwing: this is read from the
    // observation layer and the frame renderer, and neither may be brought down by a
    // principal whose holding sits somewhere the map does not admit (AGT-X9).
    expect(deliveryPlaceOf(map, 'con-nowhere' as never)).toBeNull();
  });

  it('every Commons-bound principal has a Commons-only route to its own place', () => {
    // The property behind the tier rule, asserted as a route rather than as a tier: a path
    // that leaves the Commons is a path a Commons-bound hand may not take.
    const world = levyWorld('place-route', 4, 1);
    const runtime = world.runtime;
    tick(runtime);
    for (const principal of world.principals) {
      const constellation = constellationOf(runtime.world, principal);
      expect(constellation).not.toBeNull();
      if (constellation === null) continue;
      const place = deliveryPlaceOf(runtime.world.map, constellation);
      expect(place).not.toBeNull();
      if (place === null) continue;
      const from = holdingOf(runtime.world, principal).system;
      const path = route(runtime.world.map, from, place);
      expect(path, `${principal} cannot reach ${place} at all`).not.toBeNull();
      for (const hop of path?.path ?? []) {
        expect(tierOf(runtime.world.map, hop), `route from ${from} to ${place} leaves the Commons`).toBe(
          'COMMONS',
        );
      }
    }
  });

  it('and the walk actually completes in the engine, from a seat that is not the place', () => {
    // The end-to-end version: a hand really gets there using `move`, one gate at a time, on
    // the engine's own clock. A tier assertion could hold while the lanes did not connect.
    const world = levyWorld('place-walk', 2, 1);
    const runtime = world.runtime;
    const payer = world.principals[0];
    if (payer === undefined) throw new Error('fixture');
    tick(runtime);
    const place = runtime.levyBlockFor(payer, runtime.engine.tick)?.deliverable_to;
    expect(place).toBeDefined();
    expect(holdingOf(runtime.world, payer).system).not.toBe(place);
    expect(walkToPlace(runtime, payer)).toBe(place);
  });

  it('groups the roll by constellation from `principalOrder`, which is INV-25\'s own roll', () => {
    const world = levyWorld('place-roll', 3);
    const grouped = rollByConstellation(world.runtime.world);
    const flat = [...grouped.values()].flat();
    // Two roads to "who is enrolled" would be two answers to "who must be on the docket".
    expect(flat.length).toBe(world.runtime.world.principalOrder.length);
    for (const principal of world.principals) expect(flat).toContain(principal);
    expect(commonsSystems(world.runtime.world.map).length).toBeGreaterThan(1);
  });
});
