/**
 * The exit from the Commons, as a **pure rule** — no ledger, no runtime, no clock.
 *
 * `test/api/commons-exit.test.ts` is the acceptance test and it plays the whole loop over
 * signed HTTP; this file is the half of the gate that decides *whether a crossing is
 * legal at all*, driven directly so every branch is reachable without arranging an
 * economy first. The two are deliberately separate: the world layer must be able to
 * refuse a crossing with no opinion about money (the price lives with the economy, and
 * an anti-Sybil gate implemented in two places is one that silently stops being
 * enforced in one of them).
 *
 * Every test here was mutation-checked; the mutation is named beside the assertion.
 */

import { describe, expect, it } from 'vitest';
import type { SystemId } from '../../src/core/types.js';
import {
  GRADUATION_STATEMENT,
  GRADUATION_UPKEEP_MINOR,
  GRADUATION_UPKEEP_QTY,
  commonsSystems,
  createHolding,
  createWorld,
  enroll,
  graduateHolding,
  graduationDestinations,
  graduationRejection,
  holdingOf,
  isCommonsBound,
  launchMap,
  markFallen,
  tierOf,
} from '../../src/world/index.js';

function seated(): ReturnType<typeof createWorld> {
  const world = createWorld(launchMap());
  enroll(world, 'p:one' as never, 'one', 0);
  return world;
}

describe('graduationDestinations — one gate outward, and only outward', () => {
  it('offers only non-COMMONS systems, each one gate off the Commons', () => {
    // MUTATION: drop the `tier !== 'COMMONS'` filter. A "graduation" that offered the
    // neighbouring Commons system would be a no-op crossing at full price. RED.
    const world = seated();
    const holding = holdingOf(world, 'p:one' as never);
    expect(tierOf(world.map, holding.system)).toBe('COMMONS');

    const open = graduationDestinations(world.map, holding);
    expect(open.length).toBeGreaterThan(0);
    for (const id of open) {
      expect(tierOf(world.map, id)).not.toBe('COMMONS');
      // Every offered system is adjacent to SOME Commons system — the zone's own gates,
      // never an arbitrary jump across the map.
      const touchesCommons = commonsSystems(world.map).some((c) =>
        [...(world.map.systems.get(c)?.lanes ?? [])].includes(id),
      );
      expect(touchesCommons, `${id} is not a gate off the Commons`).toBe(true);
    }
  });

  it('from OUTSIDE the Commons it is strictly adjacent, so a body still cannot teleport', () => {
    // The anti-teleport rule where it does the work. MUTATION: apply the zone rule to a
    // Marches holding as well and the Frontier becomes one action away from any Marches
    // seat, which deletes §4.2's topology. RED.
    const world = seated();
    const holding = holdingOf(world, 'p:one' as never);
    const first = graduationDestinations(world.map, holding)[0];
    expect(graduateHolding(world.map, holding, first as SystemId)).toBeNull();

    const open = graduationDestinations(world.map, holding);
    const lanes = [...(world.map.systems.get(holding.system)?.lanes ?? [])];
    for (const id of open) expect(lanes).toContain(id);
  });

  it('is in canonical order, so a replay picks the same first destination (DET-2)', () => {
    const world = seated();
    const open = graduationDestinations(world.map, holdingOf(world, 'p:one' as never));
    expect([...open].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual([...open]);
  });

  it('EVERY Commons seat has a way out — the floor is a floor, not a cage', () => {
    // ══════════════════════════════════════════════════════════════════════
    // THIS TEST FOUND A REAL DEFECT AND IT IS WHY THE RULE IS THE ZONE'S GATES.
    //
    // With bare adjacency, `sys-03` — an interior COMMONS system with **no outward lane
    // at all** — returned `[]`. `safestSeat` assigns seats by crowding, so roughly one
    // newcomer in four would have been seated somewhere with no exit in the game: the
    // exact defect this module closes, reintroduced one layer down and *intermittently*,
    // which is the harder kind to see.
    //
    // MUTATION: restore bare adjacency in `graduationDestinations` and this goes RED on
    // sys-03 while every other test in this file stays green.
    // ══════════════════════════════════════════════════════════════════════
    const world = createWorld(launchMap());
    for (const [i, system] of commonsSystems(world.map).entries()) {
      const holding = createHolding(`p:seat${String(i)}` as never, `seat${String(i)}`, system);
      expect(
        graduationDestinations(world.map, holding).length,
        `${system} is a seat with no way out of the Commons`,
      ).toBeGreaterThan(0);
    }
  });

  it('a seat with no outward lane of its own still has the whole zone’s gates', () => {
    // Named directly, because "one in four seats" is a probability and a regression that
    // only shows up a quarter of the time is a regression that ships.
    const world = createWorld(launchMap());
    const stranded = commonsSystems(world.map).find(
      (id) =>
        [...(world.map.systems.get(id)?.lanes ?? [])].filter(
          (lane) => tierOf(world.map, lane) !== 'COMMONS',
        ).length === 0,
    );
    expect(stranded, 'the launch map no longer has an interior Commons system').toBeDefined();
    const holding = createHolding('p:deep' as never, 'deep', stranded as SystemId);
    expect(graduationDestinations(world.map, holding).length).toBeGreaterThan(0);
  });
});

describe('graduationRejection — the four refusals, each of which teaches the rule', () => {
  it('refuses a COMMONS destination and says the crossing is one-way', () => {
    // MUTATION: delete this branch and a graduate can duck back inside the floor the
    // moment a raid spawns, which makes every "one-way" sentence the engine prints a lie.
    const world = seated();
    const holding = holdingOf(world, 'p:one' as never);
    const neighbourInside = [...(world.map.systems.get(holding.system)?.lanes ?? [])].find(
      (id) => tierOf(world.map, id) === 'COMMONS',
    );
    expect(neighbourInside).toBeDefined();

    const refusal = graduationRejection(world.map, holding, neighbourInside as SystemId);
    expect(refusal?.invariant).toBe('A8');
    expect(refusal?.hint).toContain('ONE-WAY');
    expect(refusal?.hint).toContain('the Commons never expires');
  });

  it('refuses a system that is not one gate away', () => {
    // MUTATION: delete the reachability branch. §4.2's whole topology argument — the
    // Frontier is two constellation hops away and the Marches are unavoidably in between
    // — is deleted in one action.
    const world = seated();
    const holding = holdingOf(world, 'p:one' as never);
    const far = world.map.systemOrder.find(
      (id) => tierOf(world.map, id) === 'FRONTIER',
    );
    expect(far).toBeDefined();

    const refusal = graduationRejection(world.map, holding, far as SystemId);
    expect(refusal?.invariant).toBe('A2');
    expect(refusal?.hint).toContain('one lane at a time');
    expect(refusal?.hint).toContain('The Commons is one place');
    // The refusal names what IS reachable, or it costs the agent a second wake to find out.
    for (const id of graduationDestinations(world.map, holding)) {
      expect(refusal?.hint).toContain(id);
    }
  });

  it('refuses a system that does not exist, without pretending it might', () => {
    const world = seated();
    const refusal = graduationRejection(
      world.map,
      holdingOf(world, 'p:one' as never),
      'sys-nowhere' as SystemId,
    );
    expect(refusal?.invariant).toBe('A2');
    expect(refusal?.hint).toContain('there is no system sys-nowhere');
  });

  it('refuses a FALLEN holding: a ruin does not travel', () => {
    // MUTATION: drop the FALLEN branch here and `relocateHolding`'s own check is the only
    // thing left — which refuses with a sentence about rebuilding rather than about the
    // crossing, and after the price has already been charged.
    const world = seated();
    const holding = holdingOf(world, 'p:one' as never);
    const open = graduationDestinations(world.map, holding)[0];
    expect(open).toBeDefined();
    markFallen(holding, 4);

    const refusal = graduationRejection(world.map, holding, open as SystemId);
    expect(refusal?.invariant).toBe('INV-8');
    expect(refusal?.hint).toContain('fell at Reckoning 4');
  });

  it('permits the crossing the destinations list offered', () => {
    const world = seated();
    const holding = holdingOf(world, 'p:one' as never);
    for (const id of graduationDestinations(world.map, holding)) {
      expect(graduationRejection(world.map, holding, id)).toBeNull();
    }
  });
});

describe('graduateHolding — the body moves, and the bind comes off with it', () => {
  it('moves the holding and stops the principal being Commons-bound (A15, §4.1)', () => {
    // The two halves of the safe zone are separate rules on purpose, and this is the one
    // place they meet: the outbound bind is derived from the holding's tier, so moving
    // the holding is what releases the hands. MUTATION: make `graduateHolding` return
    // null without calling `relocateHolding` — the verb "succeeds", nothing moves, and
    // the price has been charged for nothing. RED here and in the acceptance test.
    const world = seated();
    const holding = holdingOf(world, 'p:one' as never);
    expect(isCommonsBound(world.map, holding)).toBe(true);

    const to = graduationDestinations(world.map, holding)[0];
    expect(graduateHolding(world.map, holding, to as SystemId)).toBeNull();
    expect(holding.system).toBe(to);
    expect(isCommonsBound(world.map, holding)).toBe(false);
    expect(tierOf(world.map, holding.system)).not.toBe('COMMONS');
  });

  it('re-runs the gate, so it cannot be used to bypass the refusals', () => {
    // One road in. A future caller that "just needs to move a holding" must not be able
    // to reach `relocateHolding` around the rule.
    const world = seated();
    const holding = holdingOf(world, 'p:one' as never);
    const seat = holding.system;
    const inside = [...(world.map.systems.get(seat)?.lanes ?? [])].find(
      (id) => tierOf(world.map, id) === 'COMMONS',
    );
    expect(graduateHolding(world.map, holding, inside as SystemId)?.invariant).toBe('A8');
    expect(holding.system).toBe(seat);
  });

  it('the first crossing never changes constellation, so a Levy docket cannot move under it', () => {
    // `assertMapStructure` forbids a lane leaving a COMMONS system for another
    // constellation, and adjacency is what turns that map property into a guarantee about
    // this verb: a principal's first step out cannot relocate its assessment mid-cycle.
    // Asserted here rather than trusted, because the two rules live in different files.
    const world = createWorld(launchMap());
    for (const system of commonsSystems(world.map)) {
      const home = world.map.systems.get(system)?.constellation;
      for (const lane of world.map.systems.get(system)?.lanes ?? []) {
        expect(world.map.systems.get(lane)?.constellation).toBe(home);
      }
    }
  });
});

describe('GRADUATION_STATEMENT is a rules surface and quotes the real numbers', () => {
  it('states the price the constants actually charge', () => {
    // MUTATION: change `GRADUATION_UPKEEP_MINOR` without touching the statement. The
    // sentence an agent reads and the number it is charged diverge, which is scar #1 on
    // the most consequential decision in the game. RED.
    expect(GRADUATION_STATEMENT).toContain(String(GRADUATION_UPKEEP_MINOR));
    expect(GRADUATION_STATEMENT).toContain(String(GRADUATION_UPKEEP_QTY));
  });

  it('says all four things a newcomer has to know before it crosses', () => {
    expect(GRADUATION_STATEMENT).toContain('INVALID, not punished');
    expect(GRADUATION_STATEMENT).toContain('one lane outward');
    expect(GRADUATION_STATEMENT).toContain('IT IS ONE-WAY');
    expect(GRADUATION_STATEMENT).toContain('Recurring upkeep is NOT charged yet');
  });
});
