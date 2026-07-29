/**
 * **A JOINER'S FORCE IS ITS HAND, AND THE HAND HAS TO BE THERE.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * This file exists because the first predation build counted `raid.parties` by side and
 * never looked at the hand again. An adversarial verifier walked straight through it:
 *
 *   1. `join` at tick 49, putting an IDLE hand at the stage.
 *   2. `move` that hand out at tick 71 — one tick before the published deadline, which
 *      the observation itself hands you as `resolves_tick`.
 *   3. Resolve at 72. The party row still said "+1 force", and `routHand` — which
 *      requires an `IDLE` hand — found the hand `IN_TRANSIT` and declined to rout it.
 *
 * Two consequences, and the second is the worse one:
 *
 *   - a **RAIDER** joiner kept its force and dodged the hand half of its risk (its 500
 *     stake was still forfeited, so attacker risk was reduced rather than deleted);
 *   - a **DEFENDER** joiner stakes no capital at all, so dodging the hand left it with
 *     **literally nothing at risk** while still adding a full unit of force. Two agents
 *     with hands at a stage could have guaranteed each other free repulses forever, and
 *     §9's "world raids give escorts a guaranteed market" would have been a market in
 *     promises nobody has to keep.
 *
 * The target's own hands were always re-counted at resolution (`handsDefending`), so the
 * old behaviour also broke the rule the book states outright — *"force is per hand;
 * capital buys none"* — and §3's *"one hand is one unit of simultaneous presence"*.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Every test here is wired: a real `Runtime`, real verbs, real MOVE, real PREDATE. The
 * pure-arithmetic half lives in `resolve.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../src/api/observe.js';
import type { HandId, PrincipalId, SystemId } from '../../src/core/types.js';
import { readForce } from '../../src/predation/index.js';
import type { Runtime } from '../../src/sim/runtime.js';
import { raidRow, raidWorld, runToFirstRaid, submit, tick } from './fixture.js';

/** The longest lane out of `stage`, so a departure can outlast the window's last tick. */
function laneOut(runtime: Runtime, stage: SystemId): { to: SystemId; transit: number } {
  const out = [...(runtime.world.map.systems.get(stage)?.lanes ?? [])]
    .map((to) => {
      const key = [stage, to].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join('|');
      return { to, transit: runtime.world.map.lanes.get(key as never)?.transitTicks ?? 0 };
    })
    .sort((a, b) => b.transit - a.transit)[0];
  if (out === undefined) throw new Error('the stage has no lane out');
  return out;
}

function observeRaid(runtime: Runtime, principal: PrincipalId, raid: string): Record<string, unknown> | undefined {
  const rows = buildObservation({
    runtime,
    principal,
    serverNowMs: 0,
    fresh: true,
    wakesRemaining: 4,
    stale: false,
    corrections: [],
    correctionsDropped: 0,
    actionsRemaining: 4,
  }).obligations['raid'] as readonly Record<string, unknown>[] | undefined;
  return rows?.find((r) => r['raid'] === raid);
}

describe('a joiner counts only while its hand is standing at the stage', () => {
  /**
   * The regression, end to end. Both joiners leave one tick before the deadline; neither
   * may buy the standoff with a hand that is somewhere else.
   */
  it('a hand marched out before the deadline adds NO force and is not routed either', () => {
    const { runtime, principals, stage } = raidWorld('presence-depart', 4);
    const raid = runToFirstRaid(runtime);
    const others = principals.filter((p) => p !== raid.target);
    const raider = others[0];
    const ally = others[1];
    if (raider === undefined || ally === undefined) throw new Error('fixture');

    submit(runtime, raider, 'join', { raid: raid.id, side: 'RAIDER', system: stage });
    submit(runtime, ally, 'join', { raid: raid.id, side: 'DEFENDER' }, 1);
    tick(runtime);
    submit(runtime, raid.target, 'fight', { raid: raid.id, system: stage });
    tick(runtime);

    const parties = runtime.raids.require(raid.id).parties;
    const raiderHand = parties.find((p) => p.principal === raider)?.handId;
    const allyHand = parties.find((p) => p.principal === ally)?.handId;
    if (raiderHand === undefined || allyHand === undefined) throw new Error('both joins must have been admitted');

    // Both joiners are standing there right now, so both count. This is the control:
    // without it, a fix that simply stopped counting joiners would pass everything else.
    const beforeFlight = observeRaid(runtime, raid.target, raid.id);
    const raiderForceWhilePresent = Number(
      (beforeFlight?.['force'] as Record<string, unknown> | undefined)?.['raider'],
    );
    expect(raiderForceWhilePresent).toBe(raid.force + 1);

    // Leave as late as the published clock allows: still IN_TRANSIT on the deadline tick.
    const out = laneOut(runtime, stage);
    const launchAt = raid.resolvesAtTick - Math.max(1, out.transit - 1);
    while (runtime.engine.tick < launchAt - 1) tick(runtime);
    submit(runtime, raider, 'move', { hand: raiderHand, to: out.to });
    submit(runtime, ally, 'move', { hand: allyHand, to: out.to }, 1);
    tick(runtime);
    expect(runtime.takeCorrections(raider)).toEqual([]);
    expect(runtime.takeCorrections(ally)).toEqual([]);
    expect(runtime.world.hands.get(raiderHand)?.state).not.toBe('IDLE');
    expect(runtime.world.hands.get(allyHand)?.state).not.toBe('IDLE');

    while (runtime.raids.require(raid.id).state === 'DEMANDED') tick(runtime);
    const done = runtime.raids.require(raid.id);

    // Neither joiner bought anything: the raid's force is its own, and the defence is
    // the target's own hands plus terrain.
    expect(done.raiderForce).toBe(raid.force);
    // And the ally's absent hand is not in the defence either.
    const targetHandsAtStage = [...runtime.world.hands.values()].filter(
      (h) => h.principal === raid.target && h.location === stage && h.state === 'IDLE',
    ).length;
    expect(done.defenderForce).toBe(targetHandsAtStage + 1); // + MARCHES terrain
  });

  it('a hand that stayed still counts, so the fix did not simply delete joiners', () => {
    const { runtime, principals, stage } = raidWorld('presence-stay', 4);
    const raid = runToFirstRaid(runtime);
    const others = principals.filter((p) => p !== raid.target);
    const ally = others[0];
    if (ally === undefined) throw new Error('fixture');

    submit(runtime, ally, 'join', { raid: raid.id, side: 'DEFENDER' });
    tick(runtime);
    submit(runtime, raid.target, 'fight', { raid: raid.id, system: stage });
    tick(runtime);
    const allyHand = runtime.raids.require(raid.id).parties.find((p) => p.principal === ally)?.handId;
    if (allyHand === undefined) throw new Error('the join must have been admitted');

    while (runtime.raids.require(raid.id).state === 'DEMANDED') tick(runtime);
    const done = runtime.raids.require(raid.id);
    const targetHandsAtStage = 3; // a principal has exactly three (INV-8), all idle here
    expect(done.defenderForce).toBe(targetHandsAtStage + 1 /* ally */ + 1 /* MARCHES */);
    expect(done.state).toBe('REPULSED');
    // It stood there and it paid for it: the losing-side hand recovers, the winner's does
    // not, and this ally was on the winning side.
    expect(runtime.world.hands.get(allyHand)?.state).toBe('IDLE');
  });

  /**
   * A2: *the number an agent is shown is the number the resolver uses.* The observation
   * calls `readForce` too, so a joiner that has walked away must disappear from
   * `force.raider` in the same tick it stops counting at resolution — otherwise an agent
   * decides `fight` against a threat that is not there (scar #1 with a hold at stake).
   */
  it('the published force drops the moment the hand leaves, so observe and resolve agree', () => {
    const { runtime, principals, stage } = raidWorld('presence-observe', 4);
    const raid = runToFirstRaid(runtime);
    const raider = principals.find((p) => p !== raid.target);
    if (raider === undefined) throw new Error('fixture');

    submit(runtime, raider, 'join', { raid: raid.id, side: 'RAIDER', system: stage });
    tick(runtime);
    const handId = runtime.raids.require(raid.id).parties[0]?.handId;
    if (handId === undefined) throw new Error('the join must have been admitted');

    const withHand = observeRaid(runtime, raid.target, raid.id);
    expect((withHand?.['force'] as Record<string, unknown>)['raider']).toBe(raid.force + 1);

    const out = laneOut(runtime, stage);
    submit(runtime, raider, 'move', { hand: handId, to: out.to });
    tick(runtime);
    const withoutHand = observeRaid(runtime, raid.target, raid.id);
    expect((withoutHand?.['force'] as Record<string, unknown>)['raider']).toBe(raid.force);
  });

  /**
   * The unit-level statement of the same rule, so the arithmetic is pinned independently
   * of the world that produces it.
   */
  it('readForce ignores a party whose hand the port no longer places at the stage', () => {
    const here = 'p:here' as PrincipalId;
    const gone = 'p:gone' as PrincipalId;
    const raid = raidRow({
      force: 2,
      parties: [
        { principal: here, side: 'DEFENDER', handId: 'h:here' as HandId, stake: 0 as never, encumbranceId: null, joinedAtTick: 50 },
        { principal: gone, side: 'RAIDER', handId: 'h:gone' as HandId, stake: 500 as never, encumbranceId: 'e', joinedAtTick: 50 },
      ],
    });
    const reading = readForce({
      raid,
      tier: 'FRONTIER',
      defenderHands: 0,
      handsAtStage: (p) => (p === here ? (['h:here'] as HandId[]) : []),
      // No battle over this standoff, so the raid's own force is the drawn scalar.
      raidForceLeft: () => null,
    });
    expect(reading.terms.defenderJoiners).toBe(1);
    expect(reading.terms.raiderJoiners).toBe(0);
    expect(reading.raiderForce).toBe(2);
    expect(reading.defenderForce).toBe(1);
  });

  /** A hand that is present but is *a different* hand does not count either. */
  it('a party whose named hand is not among the present ones does not count', () => {
    const who = 'p:swap' as PrincipalId;
    const raid = raidRow({
      force: 1,
      parties: [
        { principal: who, side: 'RAIDER', handId: 'h:1' as HandId, stake: 500 as never, encumbranceId: 'e', joinedAtTick: 50 },
      ],
    });
    const reading = readForce({
      raid,
      tier: 'FRONTIER',
      defenderHands: 0,
      // The principal has a hand here — but not the one it put in.
      handsAtStage: () => ['h:2'] as HandId[],
      raidForceLeft: () => null,
    });
    expect(reading.terms.raiderJoiners).toBe(0);
  });
});
