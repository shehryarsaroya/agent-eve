/**
 * ★ **THE ONE THAT SAYS COMBAT IS REACHABLE THROUGH THE FRONT DOOR.**
 *
 * This project's most persistent defect class: *"a capability that exists and is never exercised is
 * indistinguishable from one that is missing — in every report, on every frame, and to every reader
 * including its author."* It has appeared at three depths already — verbs with no affordance (nine,
 * `grant` among them), affordances no cast ever selects, and invariants whose subject cannot occur.
 *
 * Combat is the largest thing this project has built in one change, so it is the most exposed. The
 * sweep in `test/api/agt-r5-reachability.test.ts` cannot see `engage` because it needs a conjunction
 * a short heuristic run does not enter — a live raid, answered FIGHT, with a READY hull berthed at
 * the stage and an IDLE hand to crew it — so that sweep names **this file** as its REACHABLE
 * ELSEWHERE proof.
 *
 * ── WHAT IT DRIVES, AND WHY THE ASSERTIONS ARE ABOUT THE MENU ───────────────
 *
 * `build {kind:"HULL"}` → `demand` → `fight` → `engage`, every step through the real verb table on a
 * real `Runtime`. And the assertion at the end is not *"the battle resolved"* — `resolve.spec.ts`
 * covers that — but **"the menu offered it, and the verb accepted what the menu said"**. That is the
 * weaker claim and it is the one that was false for nine mechanics at once.
 */

import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../src/api/observe.js';
import { HULL_COST_GOODS } from '../../src/combat/index.js';
import type { EventId, GoodId, PrincipalId, SystemId } from '../../src/core/types.js';
import { qty } from '../../src/core/units.js';
import { GOODS_FAUCET, storesAccount } from '../../src/ledger/index.js';
import type { Runtime } from '../../src/sim/runtime.js';
import { act, raidWorld, tick } from '../predation/fixture.js';

/** Every verb any affordance offers this principal, this tick. */
function offeredVerbs(runtime: Runtime, principal: PrincipalId): ReadonlySet<string> {
  const out = new Set<string>();
  for (const affordance of observe(runtime, principal).affordances) out.add(affordance.verb);
  return out;
}

/** One observation, as the HTTP surface builds it. `fresh` because affordances only exist in a wake. */
function observe(runtime: Runtime, principal: PrincipalId): ReturnType<typeof buildObservation> {
  return buildObservation({
    runtime,
    principal,
    serverNowMs: 0,
    fresh: true,
    wakesRemaining: 4,
    stale: false,
    corrections: [],
    actionsRemaining: 4,
  });
}

/**
 * Put the goods for a hull at a seat, straight from the faucet.
 *
 * The one place this file does not go through a verb, and the reason is stated rather than assumed:
 * `fuel` is produced only at a FRONTIER WORKS with a fuelled ANCHOR, which is four more verbs and a
 * Reckoning boundary away. What this file proves is **reachability of the menu**, not the economics of
 * the supply chain — that is `works/` and `sovereignty/`'s to test, and they do. Sourcing directly
 * keeps the failure this file can report unambiguous: if it is red, the door is shut, not the
 * warehouse empty.
 */
function stock(runtime: Runtime, principal: PrincipalId, system: SystemId, good: GoodId, amount: number): void {
  runtime.ledger.sourceGoods({
    eventId: `test.stock:${principal}:${good}:${String(amount)}` as EventId,
    tick: runtime.engine.tick,
    faucet: GOODS_FAUCET.PRODUCTION,
    to: storesAccount(principal),
    good,
    qty: qty(amount),
    location: system,
    origin: principal,
  });
}

describe('★ combat is reachable from the affordance menu', () => {
  it('offers `build {kind:"HULL"}` to a principal holding the goods at a berth outside the Commons', () => {
    const world = raidWorld('combat-reach-build', 2);
    const principal = world.principals[0];
    if (principal === undefined) throw new Error('no principal');
    stock(world.runtime, principal, world.stage, HULL_COST_GOODS.frame, 8_000);
    stock(world.runtime, principal, world.stage, HULL_COST_GOODS.fuel, 2_000);
    tick(world.runtime);

    const observation = observe(world.runtime, principal);
    const hullOffers = observation.affordances.filter(
      (a) => a.verb === 'build' && (a.params as Record<string, unknown>)['kind'] === 'HULL',
    );
    expect(
      hullOffers.length,
      'a principal standing outside the Commons with the goods for a hull must be offered ' +
        '`build {kind:"HULL"}`. Asserting on the KIND rather than the verb matters: `build` also raises a ' +
        'WORKS and an ANCHOR, so "build is offered" would pass on a menu that never mentions a warship.',
    ).toBeGreaterThan(0);

    const offer = hullOffers[0];
    if (offer === undefined) throw new Error('no hull offer');
    expect(
      String(offer.what_it_forecloses),
      'the prose must say the fit is frozen — it is the rule an agent would otherwise learn by ' +
        'building the wrong ship, and there is no refit',
    ).toMatch(/frozen/i);
    expect(
      String(offer.what_it_forecloses),
      'and it must name the fuel, because a Frontier-only input is why a fleet is a territorial question',
    ).toContain(HULL_COST_GOODS.fuel);
    expect(
      offer.max_direct_loss,
      'the goods are destroyed into the build and there is no salvage, so the worst case is all of them',
    ).toBeGreaterThan(0);
  });

  it('★ offers `engage` once a demand it made has been answered FIGHT, and the verb accepts it', () => {
    const world = raidWorld('combat-reach-engage', 3);
    const raider = world.principals[0];
    const target = world.principals[1];
    if (raider === undefined || target === undefined) throw new Error('no pair');

    // Goods for a hull, and a hull, through the verb.
    stock(world.runtime, raider, world.stage, HULL_COST_GOODS.frame, 8_000);
    stock(world.runtime, raider, world.stage, HULL_COST_GOODS.fuel, 2_000);
    // Something for the raid to actually be about, so the demand is not a demand on nothing.
    stock(world.runtime, target, world.stage, HULL_COST_GOODS.frame, 8_000);
    tick(world.runtime);

    const built = act(world.runtime, raider, 'build', {
      kind: 'HULL',
      system: world.stage,
      hull: 'PIKE',
      modules: ['SMALL_GUN', 'POINT', 'AFTERBURNER'],
    });
    expect(built, `build {kind:"HULL"} was refused: ${built?.hint ?? ''}`).toBeNull();

    // The fitting-out clock. A hull is not committable the tick it is built.
    for (let i = 0; i < 6; i += 1) tick(world.runtime);
    expect(
      world.runtime.committableHulls(raider, world.stage).length,
      'the hull must be READY after its fitting ticks, or nothing downstream can be proven',
    ).toBeGreaterThan(0);

    // Open a standoff.
    const demanded = act(world.runtime, raider, 'demand', {
      principal: target,
      system: world.stage,
      good: HULL_COST_GOODS.frame,
      qty: 2_000,
    });
    expect(demanded, `demand was refused: ${demanded?.hint ?? ''}`).toBeNull();
    const raid = world.runtime.raids.live()[0];
    expect(raid, 'a live raid must exist after an accepted demand').toBeDefined();
    if (raid === undefined) return;

    // Refuse it. This is what a battle IS.
    const fought = act(world.runtime, target, 'fight', { raid: raid.id, system: raid.stage });
    expect(fought, `fight was refused: ${fought?.hint ?? ''}`).toBeNull();

    const battle = world.runtime.battles.forRaid(raid.id);
    expect(
      battle,
      'a refused demand must become a battle in the same tick the FIGHT answer lands. If it opened a ' +
        'tick later, a defender that answered promptly would have bought less window than it was told.',
    ).toBeDefined();
    if (battle === undefined) return;
    expect(battle.state, 'and it opens in MUSTER, the only state a hull may be committed in').toBe('MUSTER');

    // ── THE ASSERTION THIS FILE EXISTS FOR ──────────────────────────────────
    expect(
      offeredVerbs(world.runtime, raider).has('engage'),
      '`engage` must appear in the raider’s affordance list once its demand has been refused and it ' +
        'holds a READY hull at the stage. If this is red, combat is a mechanic that works, renders, is ' +
        'tested, and cannot be reached from the menu the cast is told to plan from — which is exactly ' +
        'how the A6 core loop stayed dark for the whole life of the project.',
    ).toBe(true);

    const observation = observe(world.runtime, raider);
    const offer = observation.affordances.find((a) => a.verb === 'engage');
    if (offer === undefined) throw new Error('no engage offer');
    expect(
      (offer.params as Record<string, unknown>)['system'],
      '`engage` is HOSTILE, so the params must name a place the Commons floor can locate. An affordance ' +
        'is a complete, copyable act and agents copy these verbatim.',
    ).toBe(raid.stage);
    expect(
      String(offer.what_it_forecloses),
      'the prose must say the hull can be destroyed permanently — it is the only irreversible thing here',
    ).toMatch(/permanent/i);
    expect(
      offer.max_direct_loss,
      'the worst case is the hull in full: a committed hull can be destroyed and there is no salvage',
    ).toBeGreaterThan(0);

    // ── AND THE OFFER IS TAKEABLE, WHICH IS THE OTHER HALF ──────────────────
    //
    // An affordance the handler refuses costs an agent a real action and its trust in the menu, which
    // is why `engageRefusal` is ONE function called by both rather than two that agree today.
    const accepted = act(world.runtime, raider, 'engage', offer.params);
    expect(
      accepted,
      `the affordance the menu published was refused by the verb: ${accepted?.hint ?? ''}. ` +
        'The gate is one function precisely so this cannot happen.',
    ).toBeNull();
    const after = world.runtime.battles.forRaid(raid.id);
    expect(
      after?.formations.some((f) => f.principal === raider),
      'and the commit must have produced a formation the raider commands',
    ).toBe(true);
    expect(
      world.runtime.fleet.of(raider).every((h) => h.state !== 'READY'),
      'the hull must be marked ENGAGED, not left READY — a hull the fleet still thinks is free can be ' +
        'committed twice, and the second wreck destroys an asset that was already gone (OPS-1)',
    ).toBe(true);
  });

  it('offers nothing combat-shaped to a principal with no battle and no goods', () => {
    // The negative half, and it is not decoration: an affordance list that offered `engage` with no
    // battle to engage in would cost an agent an action every wake, which is the same harm as not
    // offering it at all with the sign flipped.
    const world = raidWorld('combat-reach-negative', 2);
    const principal = world.principals[0];
    if (principal === undefined) throw new Error('no principal');
    tick(world.runtime);
    const verbs = offeredVerbs(world.runtime, principal);
    expect(verbs.has('engage'), 'no battle exists, so `engage` must not be offered').toBe(false);
    const observation = observe(world.runtime, principal);
    expect(
      observation.affordances.filter(
        (a) => a.verb === 'build' && (a.params as Record<string, unknown>)['kind'] === 'HULL',
      ).length,
      'and with no fuel standing here, no HULL offer either',
    ).toBe(0);
  });
});
