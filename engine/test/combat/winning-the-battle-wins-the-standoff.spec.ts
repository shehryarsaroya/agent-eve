/**
 * ★ **THREE DEFECTS THAT MADE COMBAT IRRATIONAL OR LEAKY, ASSERTED THROUGH THE FRONT DOOR.**
 *
 * Every one of them was the same shape — the engine internally consistent while the agent-facing
 * surface said something else — which is the shape this project keeps re-finding and the reason all
 * three are pinned in one file rather than described in a commit message.
 *
 *   1. **Winning a battle could not win the standoff.** `readForce` computed `raiderForce =
 *      raid.force + joiners` off a scalar drawn at spawn, and `applyLoss` returns early on a world
 *      hull, so destroying the world's entire fleet changed nothing on the raider's side of the sum.
 *      Measured: `fz-13` t192 — one missile WARDEN, three world LANCEs destroyed, field held at
 *      2,395 EHP of 4,400, standoff **PLUNDERED 2-3**. `engage` against the weather was all downside
 *      for a material agent, so YIELD was the only rational answer and A14's scheduled drama rendered
 *      identically to peace (A13: then it does not exist).
 *   2. **`forecastFor` leaked the enemy's real fit**, under a comment saying it did not. §11.2 puts a
 *      fit at `SENSED`: *a ship at sea is visible; its manifest is not.*
 *   3. **`MAX_RAID_PARTIES` refused a full standoff by telling the agent it was "not a party"**,
 *      which is advice to retry the one action that cannot succeed, once per tick, until the raid
 *      resolves.
 *
 * The unit-level statement of #1 is `test/predation/resolve.test.ts`. This file is the wired half:
 * what the *verbs* produce.
 */

import { describe, expect, it } from 'vitest';
import {
  battleLinesFor,
  HULL_COST_GOODS,
  hullClassWeight,
  MAX_FORMATIONS_PER_SIDE,
  NOMINAL_FIT_MULTIPLE_BPS,
  WORLD_PRINCIPAL,
  worldForceLeft,
} from '../../src/combat/index.js';
import { MAX_FRAME_BATTLE_LINES } from '../../src/frames/contract.js';
import { MAX_RAID_PARTIES, type RaidId } from '../../src/predation/index.js';
import type { EventId, GoodId, PrincipalId, SystemId } from '../../src/core/types.js';
import { qty } from '../../src/core/units.js';
import { GOODS_FAUCET, storesAccount } from '../../src/ledger/index.js';
import type { Runtime } from '../../src/sim/runtime.js';
import { act, attempt, raidWorld, runToFirstRaid, tick } from '../predation/fixture.js';

function stock(runtime: Runtime, principal: PrincipalId, system: SystemId, good: GoodId, amount: number): void {
  runtime.ledger.sourceGoods({
    eventId: `test.wins:${principal}:${good}` as EventId,
    tick: runtime.engine.tick,
    faucet: GOODS_FAUCET.PRODUCTION,
    to: storesAccount(principal),
    good,
    qty: qty(amount),
    location: system,
    origin: principal,
  });
}

/** A hull that out-trades a world LANCE on its own. The cast's own doctrine lead. */
const HEAVY = ['MISSILE', 'MISSILE', 'MISSILE', 'SHIELD_EXTENDER', 'SHIELD_EXTENDER', 'AFTERBURNER', 'DAMAGE_MOD', 'DAMAGE_MOD'];
/** The same CLASS, a quarter of the strength. The pair that catches the forecast leak. */
const LIGHT = ['MISSILE', 'AFTERBURNER'];

/**
 * A world raid, answered FIGHT on the tick it spawns, with a fleet already berthed and flying.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE FLEET IS BUILT BEFORE THE SPAWN, AND THAT IS THE MECHANIC RATHER THAN THE FIXTURE.**
 *
 * `battlesNow` will not open a battle unless `tick + ENGAGEMENT_TICKS <= raid.resolvesAtTick`, and 22
 * against a 24-tick window leaves **two ticks**. So a defender that starts shopping when the demand
 * arrives gets no battle at all — the standoff is decided on hands, exactly as before combat existed.
 * The first version of this fixture built its hulls after the spawn and measured **zero wrecks**,
 * which is the gate working and not a bug.
 *
 * `minForce` exists to keep the verdict claim non-vacuous: at `FORCE_PER_HAND` = 1 and three hands, a
 * FRONTIER defender reads 3, so only a raid drawn at 4 or 5 gives a reading that says PLUNDERED before
 * the guns land. Seeds are tried in a fixed order and the first qualifying one is used, so the choice
 * is deterministic rather than lucky.
 * ══════════════════════════════════════════════════════════════════════════
 */
function worldRaidWithAFleet(args: {
  readonly seeds: readonly string[];
  readonly tier: 'MARCHES' | 'FRONTIER';
  readonly minForce: number;
  readonly hulls: number;
}): {
  readonly runtime: Runtime;
  readonly stage: SystemId;
  readonly target: PrincipalId;
  readonly raidId: RaidId;
  readonly force: number;
  readonly readingAtAnswer: string;
} {
  const tried: string[] = [];
  for (const seed of args.seeds) {
    const world = raidWorld(seed, 3, args.tier);
    const runtime = world.runtime;
    for (const principal of world.principals) {
      stock(runtime, principal, world.stage, HULL_COST_GOODS.frame, 60_000);
      stock(runtime, principal, world.stage, HULL_COST_GOODS.fuel, 6_000);
    }
    tick(runtime);
    // Everybody arms, because the target rule picks its own victim and this fixture may not.
    for (const principal of world.principals) {
      for (let i = 0; i < args.hulls; i += 1) {
        act(runtime, principal, 'build', {
          kind: 'HULL',
          system: world.stage,
          hull: 'WARDEN',
          modules: [...HEAVY],
        });
      }
    }
    for (let i = 0; i < 8; i += 1) tick(runtime);

    const raid = runToFirstRaid(runtime);
    tried.push(`${seed}=${String(raid.force)}`);
    if (raid.force < args.minForce) continue;

    const before = runtime.raidsFor(raid.target, runtime.engine.tick, 8).find((v) => v.raid === raid.id);
    const readingAtAnswer = before?.force.verdict_if_resolved_now ?? 'UNSEEN';
    expect(before?.force.raid_force_left, 'nothing has fought, so the raid still musters its draw').toBe(raid.force);
    expect(before?.force.raid_force_at_spawn).toBe(raid.force);

    act(runtime, raid.target, 'fight', { raid: raid.id, system: raid.stage });
    for (let n = 0; n < args.hulls; n += 1) {
      const hull = runtime.committableHulls(raid.target, world.stage)[0];
      if (hull === undefined) break;
      act(runtime, raid.target, 'engage', {
        raid: raid.id,
        system: raid.stage,
        hull: hull.id,
        echelon: 'MAIN',
        posture: 'CLOSE',
        primary: ['WEAKEST'],
        withdraw_below_bps: 0,
      });
    }
    return {
      runtime,
      stage: world.stage,
      target: raid.target,
      raidId: raid.id,
      force: raid.force,
      readingAtAnswer,
    };
  }
  throw new Error(
    `no seed drew a world raid at force >= ${String(args.minForce)} on the ${args.tier}: ${tried.join(', ')}. ` +
      `RAID_FORCE's band or the seed list changed; widen the list rather than lowering the floor, because ` +
      `the floor is what stops the verdict assertion from being vacuous.`,
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 1. WINNING THE BATTLE WINS THE STANDOFF
// ════════════════════════════════════════════════════════════════════════════

describe('★ a defender that destroys the world raid’s fleet wins the standoff', () => {
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * **THE ASSERTION THE WHOLE CHANGE EXISTS TO MAKE, DRIVEN THROUGH `fight` AND `engage`.**
   *
   * The defender's hands alone are deliberately NOT enough: the reading at the answer tick says
   * PLUNDERED, and it is the *battle* that flips it. That is what makes this a test of the coupling
   * rather than of the hand count — a world raid at force ≥ 2 against one defending hand.
   *
   * MUTATION: in `readForce`, restore `const raidForce = args.raid.force` — the standoff resolves
   * PLUNDERED and this goes RED with the goods it lost named.
   * MUTATION: in `combat/book.ts`, set `prune`'s cutoff back to `ENGAGEMENT_PHASE_TICKS.AFTERMATH + 1`
   * — green here (the book never fills in one raid) and RED in `assertEngagementSchedule`, which is
   * where that defect is actually caught.
   * ══════════════════════════════════════════════════════════════════════════
   */
  it('resolves REPULSED after the world fleet is wrecked, on a reading that said PLUNDERED', () => {
    // FRONTIER, so `FORCE_BY_TIER` gives 0 and three hands read 3 — and `minForce: 4` guarantees the
    // reading at the answer tick says PLUNDERED. Without that floor the hands alone would already
    // hold, and this would assert nothing about the battle.
    const war = worldRaidWithAFleet({
      seeds: ['wins-a', 'wins-b', 'wins-c', 'wins-d', 'wins-e', 'wins-f', 'wins-g', 'wins-h'],
      tier: 'FRONTIER',
      minForce: 4,
      hulls: 3,
    });
    const { runtime, target, raidId, force } = war;
    expect(
      war.readingAtAnswer,
      'the point of the seed floor: the hands alone must NOT be enough, so the flip can only come from ' +
        'the battle',
    ).toBe('PLUNDERED');

    // ── Run the window out, watching the published number fall ──────────────
    let sawTheDrop = false;
    let worldWrecks = 0;
    const seen = new Set<string>();
    const deadline = (runtime.raids.get(raidId)?.resolvesAtTick ?? 0) + 2;
    while (runtime.raids.get(raidId)?.state === 'DEMANDED' && runtime.engine.tick < deadline) {
      tick(runtime);
      for (const record of runtime.battles.all()) {
        if (record.raid !== raidId) continue;
        for (const wreck of record.wrecks) {
          const key = `${wreck.hand}:${String(wreck.tick)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (wreck.principal === WORLD_PRINCIPAL) worldWrecks += 1;
        }
      }
      const now = runtime.raidsFor(target, runtime.engine.tick, 8).find((v) => v.raid === raidId);
      if (now !== undefined && now.force.raid_force_left < now.force.raid_force_at_spawn) sawTheDrop = true;
    }

    expect(
      worldWrecks,
      'no world hull was destroyed, so this seed proves nothing about the coupling — the defence was ' +
        'never strong enough to test it. Re-pick the doctrine, not the assertion.',
    ).toBeGreaterThan(0);
    expect(
      sawTheDrop,
      'world hulls were destroyed and `force.raid_force_left` never fell below `raid_force_at_spawn` on ' +
        'the PUBLISHED view. The resolver and the observation must read one number (scar #1).',
    ).toBe(true);

    const closed = runtime.raids.get(raidId);
    expect(closed?.state, `the standoff resolved ${String(closed?.state)} after its raider fleet was wrecked`).toBe(
      'REPULSED',
    );
    expect(closed?.lostQty, 'and a repulse takes nothing at all').toBe(0);
    expect(
      closed?.raiderForce,
      'the recorded raider force is the one the battle left standing, not the one drawn at spawn — ' +
        'that number is what `raidTickerLine` puts on the ticker and the frame draws',
    ).toBeLessThan(force);
  }, 300_000);

  /**
   * The `null`-is-not-zero rule, wired: a live standoff **nobody fought** must read exactly as strong
   * as it was drawn. This is the A5′ half — a raid with no battle over it must not be reported as
   * wiped out, because that is a repulse nobody earned written against a real agent's name.
   *
   * MUTATION: make `worldForceLeft` return `0` instead of `null` for a missing engagement row — RED.
   */
  it('reports a standoff nobody fought at full strength, and hands out no free repulse', () => {
    const world = raidWorld('wins-nofight', 3);
    const runtime = world.runtime;
    for (const principal of world.principals) {
      stock(runtime, principal, world.stage, HULL_COST_GOODS.frame, 40_000);
    }
    tick(runtime);
    const raid = runToFirstRaid(runtime);

    expect(
      worldForceLeft(runtime.battles, raid.id),
      'no engagement row exists over this standoff, and that is "nothing is counting" rather than ' +
        '"the raid is gone"',
    ).toBeNull();
    const view = runtime.raidsFor(raid.target, runtime.engine.tick, 8).find((v) => v.raid === raid.id);
    expect(view?.force.raid_force_left).toBe(raid.force);
    expect(view?.force.raider).toBeGreaterThanOrEqual(raid.force);
  }, 60_000);

  /**
   * An agent's `demand` is untouched by any of this: `DEMAND_OWN_FORCE` is 0 and all of its force is
   * hands, counted the way every other party's is. So `raid_force_left` is 0 at spawn and stays 0,
   * and the whole world-fleet path is inert for it.
   */
  it('leaves an agent’s demand at zero own-force, because all of a demand’s force is hands', () => {
    const world = raidWorld('wins-demand', 3);
    const runtime = world.runtime;
    const raider = world.principals[0];
    const target = world.principals[1];
    if (raider === undefined || target === undefined) throw new Error('fixture');
    for (const principal of world.principals) {
      stock(runtime, principal, world.stage, HULL_COST_GOODS.frame, 20_000);
    }
    tick(runtime);
    act(runtime, raider, 'demand', {
      principal: target,
      system: world.stage,
      good: HULL_COST_GOODS.frame,
      qty: 2_000,
    });
    const raid = runtime.raids.live().find((r) => r.initiator === raider);
    expect(raid, 'the demand must have opened a standoff').toBeDefined();
    if (raid === undefined) return;

    const view = runtime.raidsFor(target, runtime.engine.tick, 8).find((v) => v.raid === raid.id);
    expect(view?.force.raid_force_at_spawn, 'a demand brings no force of its own').toBe(0);
    expect(view?.force.raid_force_left).toBe(0);
    expect(
      view?.force.raider,
      "and its strength is entirely the initiator's own hand, as a RAIDER party",
    ).toBeGreaterThan(0);
  }, 60_000);
});

// ════════════════════════════════════════════════════════════════════════════
// 2. THE FORECAST MAY NOT CHEAT
// ════════════════════════════════════════════════════════════════════════════

/** A battle between two principals at one stage, the enemy flying `theirFit`. */
function duel(seed: string, theirFit: readonly string[]): { readonly runtime: Runtime; readonly me: PrincipalId } {
  const world = raidWorld(seed, 3);
  const runtime = world.runtime;
  const enemy = world.principals[0];
  const me = world.principals[1];
  if (enemy === undefined || me === undefined) throw new Error('fixture');
  for (const principal of [enemy, me]) {
    stock(runtime, principal, world.stage, HULL_COST_GOODS.frame, 40_000);
    stock(runtime, principal, world.stage, HULL_COST_GOODS.fuel, 4_000);
  }
  tick(runtime);
  act(runtime, enemy, 'build', { kind: 'HULL', system: world.stage, hull: 'WARDEN', modules: [...theirFit] });
  act(runtime, me, 'build', { kind: 'HULL', system: world.stage, hull: 'WARDEN', modules: [...HEAVY] });
  for (let i = 0; i < 6; i += 1) tick(runtime);

  act(runtime, enemy, 'demand', {
    principal: me,
    system: world.stage,
    good: HULL_COST_GOODS.frame,
    qty: 2_000,
  });
  const raid = runtime.raids.live().find((r) => r.initiator === enemy);
  if (raid === undefined) throw new Error('no demand');
  act(runtime, me, 'fight', { raid: raid.id, system: raid.stage });
  tick(runtime);
  for (const principal of [enemy, me]) {
    const hull = runtime.committableHulls(principal, world.stage)[0];
    if (hull === undefined) continue;
    act(runtime, principal, 'engage', {
      raid: raid.id,
      system: raid.stage,
      hull: hull.id,
      echelon: 'MAIN',
      posture: 'HOLD',
      primary: ['WEAKEST'],
      withdraw_below_bps: 0,
    });
  }
  tick(runtime);
  return { runtime, me };
}

describe('★ the forecast is built from what the observer may know (§11.2)', () => {
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * **THE ASSERTION THAT CATCHES THE LEAK, AND IT CANNOT BE PASSED BY A COMMENT.**
   *
   * Two worlds, identical in every respect except the enemy's **fit**: one WARDEN on a triple-missile
   * double-extender line (~4,984 in the forecast's units), one on a missile and an afterburner
   * (~1,792). Same class, same hull count, my own fit identical. If `hold_field_bps.p50` differs
   * between them, the number is a function of a `SENSED` manifest and is invertible against my own
   * exact strength, which is exactly what it was.
   *
   * MUTATION: in `forecastFor`, drop the `published(f)` guard so `profileOf(f.fit)` is used for every
   * hostile formation — the two p50s diverge and this goes RED with both numbers named.
   * ══════════════════════════════════════════════════════════════════════════
   */
  it('gives the SAME p50 against two very differently fitted hulls of the same class', () => {
    const heavy = duel('forecast-heavy', HEAVY);
    const light = duel('forecast-light', LIGHT);

    const heavyView = heavy.runtime.engagementsFor(heavy.me, heavy.runtime.engine.tick, 4)[0];
    const lightView = light.runtime.engagementsFor(light.me, light.runtime.engine.tick, 4)[0];
    expect(heavyView, 'both worlds must have a battle to forecast').toBeDefined();
    expect(lightView).toBeDefined();
    if (heavyView === undefined || lightView === undefined) return;

    // The premise: the two enemies really are worlds apart in strength.
    const strong = hullClassWeight('WARDEN');
    expect(strong, 'the class weight is a published number over published data').toBeGreaterThan(0);

    expect(heavyView.contacts[0]?.hull_class, 'same class on both sides of the comparison').toBe('WARDEN');
    expect(lightView.contacts[0]?.hull_class).toBe('WARDEN');
    expect(heavyView.contacts[0]?.hulls).toBe(lightView.contacts[0]?.hulls);

    expect(
      lightView.forecast.hold_field_bps.p50,
      `the forecast p50 is ${String(heavyView.forecast.hold_field_bps.p50)} against a heavy WARDEN and ` +
        `${String(lightView.forecast.hold_field_bps.p50)} against a light one. Same class, same count — so the ` +
        `difference can only have come from their FIT, which §11.2 puts at SENSED and §9A says is never ` +
        `published. p50 is invertible against my own exact strength.`,
    ).toBe(heavyView.forecast.hold_field_bps.p50);
  }, 120_000);

  /**
   * A2's second half: *genuine uncertainty stays uncertain **and sourced***. A band over a class-only
   * estimate must be wide, and it must say what it was made of — otherwise an agent can neither
   * reproduce it nor decide how much to believe it.
   *
   * MUTATION: delete the `unidentified > 0` swing factor — RED on the sourcing assertion.
   */
  it('is honestly wide against an unknown fit, and names the method it used', () => {
    const { runtime, me } = duel('forecast-band', LIGHT);
    const view = runtime.engagementsFor(me, runtime.engine.tick, 4)[0];
    expect(view).toBeDefined();
    if (view === undefined) return;

    const band = view.forecast.hold_field_bps;
    expect(band.p90 - band.p10, 'a class-only estimate is not an 8% question').toBeGreaterThanOrEqual(2 * 1_800);
    expect(band.p10).toBeGreaterThanOrEqual(0);
    expect(band.p90).toBeLessThanOrEqual(10_000);
    const sourced = view.forecast.swing_factors.filter(
      (s) => s.includes('unknown fits') && s.includes(String(NOMINAL_FIT_MULTIPLE_BPS / 100)),
    );
    expect(
      sourced.length,
      `no swing factor names where the band came from. A2 requires genuine uncertainty to be SOURCED, ` +
        `not just present: ${view.forecast.swing_factors.join(' | ')}`,
    ).toBeGreaterThan(0);
  }, 60_000);

  /**
   * The world's fleet is the one exception and it is deliberate: `WORLD_FLEET_FIT` is published,
   * `battle.ts` says *"you do not get to be surprised by the weather's composition"*, and A2 requires
   * a defender be able to compute exactly what a storm is made of. So a fight with only the world on
   * the far side gets the TIGHT band — which is what makes a world raid the fight an agent can do
   * exact arithmetic about before committing a hull.
   *
   * MUTATION: make `published()` return false always — RED, the band widens against the weather.
   */
  it('keeps the band tight against the world, whose fit is published on purpose', () => {
    const war = worldRaidWithAFleet({
      seeds: ['fw-a', 'fw-b', 'fw-c', 'fw-d'],
      tier: 'MARCHES',
      minForce: 2,
      hulls: 1,
    });
    const { runtime } = war;
    const view = runtime.engagementsFor(war.target, runtime.engine.tick, 4)[0];
    expect(view).toBeDefined();
    if (view === undefined) return;
    const band = view.forecast.hold_field_bps;
    expect(
      band.p90 - band.p10,
      'the world fleet is the ONE hostile formation whose profile the forecast may read, so the band ' +
        'against it is tight. A wide band here means the exception was lost.',
    ).toBeLessThanOrEqual(2 * 800);
    expect(view.forecast.swing_factors.some((s) => s.includes("world's fleet is public"))).toBe(true);
  }, 120_000);

  /**
   * The **second** instance of the same defect, found by auditing for the first.
   *
   * `battleLinesFor` published `roleTags` read straight off every formation's fit, on a **public**
   * frame, under a `frames/projection.ts` comment asserting all four flags were *"effects that have
   * already landed"*. Three were. A `REMOTE_REPAIR` that never fired published `REPAIR` while the agent
   * fighting it saw nothing — `observed_effects` requires the effect to have landed *on the reader*.
   *
   * MUTATION: restore `roleTags: [...tagsOf(f, profileOf)]` for every formation — RED, because the
   * enemy's line names `LINE` on a frame taken before a shot is fired.
   */
  it('publishes only WITNESSED role tags on the public frame, never the fit’s', () => {
    // Taken at MUSTER: hulls are committed and nothing has fired, so a fit-derived tag list would
    // already be full and a witnessed one must be empty.
    const world = raidWorld('frame-tags', 3);
    const runtime = world.runtime;
    const enemy = world.principals[0];
    const me = world.principals[1];
    if (enemy === undefined || me === undefined) throw new Error('fixture');
    for (const principal of [enemy, me]) {
      stock(runtime, principal, world.stage, HULL_COST_GOODS.frame, 40_000);
      stock(runtime, principal, world.stage, HULL_COST_GOODS.fuel, 4_000);
    }
    tick(runtime);
    act(runtime, enemy, 'build', { kind: 'HULL', system: world.stage, hull: 'WARDEN', modules: [...HEAVY] });
    for (let i = 0; i < 6; i += 1) tick(runtime);
    act(runtime, enemy, 'demand', {
      principal: me,
      system: world.stage,
      good: HULL_COST_GOODS.frame,
      qty: 2_000,
    });
    const raid = runtime.raids.live().find((r) => r.initiator === enemy);
    if (raid === undefined) throw new Error('no demand');
    act(runtime, me, 'fight', { raid: raid.id, system: raid.stage });
    tick(runtime);
    const hull = runtime.committableHulls(enemy, world.stage)[0];
    if (hull === undefined) throw new Error('no hull');
    act(runtime, enemy, 'engage', {
      raid: raid.id,
      system: raid.stage,
      hull: hull.id,
      echelon: 'MAIN',
      posture: 'HOLD',
      primary: ['WEAKEST'],
      withdraw_below_bps: 0,
    });
    tick(runtime);

    const lines = battleLinesFor(runtime.battles, runtime.fleet, runtime.engine.tick, MAX_FRAME_BATTLE_LINES);
    const line = lines.find((l) => l.raid === raid.id);
    expect(line, 'the battle must be on the frame at all (A13)').toBeDefined();
    if (line === undefined) return;
    const bar = line.formations.find((f) => f.principal === enemy);
    expect(bar, "the enemy's formation must be drawn — it is the map's motion").toBeDefined();
    expect(line.state, 'taken during MUSTER, before anything has fired').toBe('MUSTER');
    expect(
      bar?.roleTags,
      `the frame names ${JSON.stringify(bar?.roleTags)} for a formation that has not fired a shot. Those ` +
        `tags are earned from what is FITTED (§9A), so publishing them names part of a SENSED manifest — ` +
        `and no combatant's own \`observe\` contains them, which inverts A9.`,
    ).toEqual([]);
  }, 120_000);
});

// ════════════════════════════════════════════════════════════════════════════
// 3. A FULL STANDOFF SAYS SO
// ════════════════════════════════════════════════════════════════════════════

describe('★ a full standoff refuses honestly rather than blaming the agent', () => {
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * **`engage` TOLD A LOCKED-OUT PRINCIPAL "you are not a party — take a side with `join` first"**,
   * once per tick, for the rest of the window. `sideIn` returns null for two unrelated reasons and the
   * refusal gave one answer to both, so the *fixable* cause was named when the cause was structural.
   * AGT-S3 is about refusal noise burying real defects; a refusal that is actively wrong about the
   * world is worse than noise, on the surface A2 calls the interface.
   *
   * MUTATION: delete the `raid.parties.length >= MAX_RAID_PARTIES` branch in `engageRefusal` gate 5 —
   * RED, because the refusal reverts to advising `join`.
   * ══════════════════════════════════════════════════════════════════════════
   */
  it('says the battle is FULL, and does not advise an action that cannot succeed', () => {
    const world = raidWorld('parties-full', MAX_RAID_PARTIES + 3);
    const runtime = world.runtime;
    for (const principal of world.principals) {
      stock(runtime, principal, world.stage, HULL_COST_GOODS.frame, 8_000);
    }
    tick(runtime);
    const raid = runToFirstRaid(runtime);
    act(runtime, raid.target, 'fight', { raid: raid.id, system: raid.stage });

    // Fill the standoff. Everyone but the target takes the defender's side; the surplus is refused.
    const joiners = world.principals.filter((p) => p !== raid.target);
    const lockedOut: PrincipalId[] = [];
    for (const principal of joiners) {
      // `attempt` ticks, and returns the refusal (submit-time or as a correction) or null.
      const refused = attempt(runtime, principal, 'join', { raid: raid.id, system: raid.stage, side: 'DEFENDER' });
      if (refused !== null) lockedOut.push(principal);
      if (runtime.raids.get(raid.id)?.state !== 'DEMANDED') break;
    }
    const live = runtime.raids.get(raid.id);
    expect(live?.state, 'the standoff must still be live for the refusal to be reachable').toBe('DEMANDED');
    expect(
      live?.parties.length,
      'the cap must actually have been reached, or this test proves nothing about a full standoff',
    ).toBe(MAX_RAID_PARTIES);
    expect(
      lockedOut.length,
      'nobody was locked out, so the subject of this assertion did not occur. Seat more principals.',
    ).toBeGreaterThan(0);

    // ── The refusal, from the SAME predicate the verb runs ──────────────────
    const shutOut = lockedOut[0];
    if (shutOut === undefined) return;
    // `engageRefusalFor` is the SAME predicate `vEngage` runs — never a copy, for the reason
    // `engage.ts` states: an affordance with its own copy offers moves the handler refuses.
    const refusal = runtime.engageRefusalFor({
      principal: shutOut,
      tick: runtime.engine.tick,
      raid: raid.id,
      hull: null,
      echelon: 'MAIN',
      posture: 'HOLD',
      primary: ['WEAKEST'],
      withdrawWhen: { ehpBelowBps: 0, hullsLost: 0, now: false },
      handId: null,
    });
    expect(refusal, 'a principal that could not join must still be refused').not.toBeNull();
    expect(
      refusal?.hint,
      `the refusal reads: ${String(refusal?.hint)}. It has to say the standoff is FULL — telling a ` +
        `locked-out agent to "take a side with join first" is advice to retry the action that just ` +
        `failed structurally, once per tick, until the raid resolves.`,
    ).toMatch(/FULL/);
    expect(refusal?.hint).toMatch(new RegExp(String(MAX_RAID_PARTIES)));
    expect(
      /take a side with `join` first/.test(String(refusal?.hint)),
      'and it must NOT advise `join`, which is refused for the same reason',
    ).toBe(false);
  }, 120_000);

  /**
   * The cap has to be large enough to reach the field the combat layer offers. Formations coalesce per
   * principal, so filling `MAX_FORMATIONS_PER_SIDE` on both sides needs the initiator + (n-1) raider
   * joiners and (n-1) defender joiners — the target is a party by *being* the target. At the old 8
   * against 6 formations a side, two of the twelve formation slots `engage` offers could never be
   * reached: a capability that exists and cannot be exercised.
   *
   * Asserted here as well as in `assertEngagementSchedule` because the constructor's version halts a
   * build and this one names the reason in the test log.
   */
  it('admits enough parties to fill both sides’ formation slots', () => {
    expect(
      MAX_RAID_PARTIES,
      `MAX_RAID_PARTIES is ${String(MAX_RAID_PARTIES)} and filling ${String(MAX_FORMATIONS_PER_SIDE)} ` +
        `formations on both sides takes ${String(2 * MAX_FORMATIONS_PER_SIDE - 1)}. The standoff fills before ` +
        `the field does, so a formation slot engage offers cannot be reached.`,
    ).toBeGreaterThanOrEqual(2 * MAX_FORMATIONS_PER_SIDE - 1);
  });
});
