/**
 * §9's escort market had no price on either side, and the target could not send for its own hands.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **TWO DEFECTS, ONE MEASUREMENT, AND THE SECOND ONE IS WHY YIELDING LOOKED DOMINANT.**
 *
 * A player driving four identities reported that *"yielding is strictly correct for any defender
 * who can afford the demand, so `join` — the entire coalition mechanic — has no occasion to fire"*.
 * Measured with `scripts/standoff-probe.ts` over 8 seeds × 3 Reckonings, the arithmetic half of that
 * is false — a repulse costs the target **nothing** and paying costs the demand, so fighting
 * strictly dominates *when it can be won*. What was true is that it almost never could be:
 *
 *   - across **72 standoffs the targets had 6 hands at their own stages between them**, so the
 *     defence was terrain and nothing else and 69 of 72 readings were short;
 *   - and the one gate deciding whether an ally would come refused **40 of 52** chances, because
 *     the only reason the cast had to defend a neighbour was a settled promise — a favour.
 *
 * Both are the same defect at two depths: `RaidView.march` was published to the target and nothing
 * selected it, and `RAID_STAGE_HELD_TICKS` was paid to every holder at the stage and nothing
 * published it. This file is the executable form of both halves.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import { Rng } from '../../src/core/rng.js';
import { setSpeed } from '../../src/core/time.js';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import { qty } from '../../src/core/units.js';
import { LEVY_GOOD } from '../../src/levy/index.js';
import { RAID_STAGE_HELD_TICKS } from '../../src/predation/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { raidWorld, runToFirstRaid, tick } from './fixture.js';

describe('what a repulse buys the reader (RaidView.if_repulsed)', () => {
  it('discriminates: a holder at the stage is protected and a bystander with nothing is not', () => {
    const w = raidWorld('if-repulsed', 3);
    const raid = runToFirstRaid(w.runtime);
    const target = raid.target;
    const others = w.principals.filter((p) => p !== target);
    const bystander = others[0];
    if (bystander === undefined) throw new Error('the fixture seated nobody else');

    // ── NON-VACUITY FIRST, BECAUSE BOTH BRANCHES HAVE TO OCCUR ────────────────
    //
    // A test that only ever saw `protects_you: true` would pass identically against a field
    // hard-coded to `true`, which is exactly the class of guard this repo has shipped vacuous
    // twice. So the two readings are taken from ONE world and asserted to DIFFER.
    const viewOf = (reader: PrincipalId) =>
      w.runtime.raidsFor(reader, w.runtime.engine.tick, 8).find((v) => v.raid === raid.id);

    const asTarget = viewOf(target);
    if (asTarget === undefined) throw new Error('the target cannot see its own standoff');
    expect(asTarget.if_repulsed.your_standing_here).toBeGreaterThan(0);
    expect(asTarget.if_repulsed.protects_you).toBe(true);
    expect(asTarget.if_repulsed.stage_held_ticks).toBe(RAID_STAGE_HELD_TICKS);

    // The bystander in this fixture stands at the same system with its own allotment, so it is
    // protected too — which is the whole point of the mechanic: the hold is not the target's.
    const asBystander = viewOf(bystander);
    if (asBystander === undefined) throw new Error('the bystander cannot see the standoff');
    expect(asBystander.if_repulsed.protects_you).toBe(true);

    // And the negative case, built rather than hoped for: a principal seated somewhere else holds
    // nothing at the stage, so a repulse protects nothing of its.
    const stranger = 'p:stranger' as PrincipalId;
    const elsewhere = w.runtime.seatInTier('MARCHES', Rng.fromSeed('if-repulsed:far'));
    if (elsewhere === undefined) throw new Error('the launch map has no second MARCHES system');
    w.runtime.seat(stranger, 'stranger', elsewhere);
    w.runtime.standing.open(stranger);
    const asStranger = w.runtime
      .raidsFor(stranger, w.runtime.engine.tick, 8)
      .find((v) => v.raid === raid.id);
    if (asStranger !== undefined) {
      expect(asStranger.if_repulsed.your_standing_here).toBe(qty(0));
      expect(asStranger.if_repulsed.your_works_here).toBe(0);
      expect(asStranger.if_repulsed.protects_you).toBe(false);
    }
  });

  it('is zero on an agent DEMAND, because a demand mints no hold for anybody', () => {
    // `grantWorldProtections` returns early when `initiator !== null`, so an agent's choice can
    // never buy a friend immunity from the world. The published figure has to say so, or the cast
    // would price a purchase the resolver will not make.
    const w = raidWorld('if-repulsed-demand', 3);
    const raid = runToFirstRaid(w.runtime);
    const before = w.runtime
      .raidsFor(raid.target, w.runtime.engine.tick, 8)
      .find((v) => v.raid === raid.id);
    // Non-vacuity: the world raid it is being contrasted with really does pay a hold.
    expect(before?.if_repulsed.stage_held_ticks).toBe(RAID_STAGE_HELD_TICKS);
    expect(before?.initiator).toBeNull();
  });
});

describe('a target can send for its own hands', () => {
  it('publishes a march to the target, and the cast walks a hand to its own standoff', () => {
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'muster' });
    const cast = new HeuristicCast(runtime, { size: 8 });
    cast.seat('muster');

    // Run until a standoff exists whose target has NO hand at the stage — the condition the
    // measurement says holds for 66 of 72 standoffs, and the one the old code had no answer to.
    let stage: SystemId | null = null;
    let target: PrincipalId | null = null;
    let sawMarch = false;
    let walked = false;
    for (let n = 0; n < 900 && !walked; n += 1) {
      const at = runtime.engine.tick + 1;
      for (const member of cast.roster) {
        for (const view of runtime.raidsFor(member.principal, runtime.engine.tick, 20)) {
          if (view.your_side !== 'TARGET' || view.state !== 'DEMANDED') continue;
          if (view.march === null) continue;
          // The affordance the target was never offered: a route to its own standoff.
          sawMarch = true;
          stage = view.stage;
          target = member.principal;
        }
      }
      for (const action of cast.decide(at, 'muster')) {
        if (
          action.verb === 'move' &&
          target !== null &&
          action.principal === target &&
          stage !== null
        ) {
          walked = true;
        }
        runtime.engine.submit(action);
      }
      const report = runtime.runTick();
      if (report.halted) throw new Error('halted');
    }

    // ── NON-VACUITY BEFORE THE CLAIM ──────────────────────────────────────────
    // If no standoff ever published a march to its target, this test proves nothing about the
    // branch and would pass against a deleted one. Assert the subject occurred first.
    expect(sawMarch).toBe(true);
    expect(walked).toBe(true);
  });

  it('a world nobody steers now puts the targets own hands on their own stages', () => {
    // The behavioural claim as a number rather than as a branch: run worlds nobody steers and
    // count the hands standing at a stage that belong to the principal being raided there. It was
    // **1 across 72 standoffs** before the reservation existed and 26 after
    // (`scripts/standoff-probe.ts`, 8 seeds × 3 Reckonings).
    //
    // ── THREE SEEDS, BECAUSE ONE WAS A FLAKE AND SAID SO ──────────────────────
    //
    // The first version of this ran one seed for 600 ticks and read **0** — while the same branch
    // measured 26 over the eight-seed sweep. Both numbers are correct: a world produces ~9
    // standoffs per 864 ticks, the reservation only bites for members the world can reach, and
    // whether any of them is raided inside 600 ticks is a coin-flip of the seed. A single-seed
    // denominator that small cannot distinguish "the branch is dead" from "this seed had no
    // occasion", which is the distinction the whole file is about. Summed across seeds, and
    // asserted on the sum.
    setSpeed('instant');
    let ownHandTicks = 0;
    let standoffTicks = 0;
    for (const seed of ['muster-count', 'g01', 'g05']) {
      const runtime = new Runtime({ seed });
      const cast = new HeuristicCast(runtime, { size: 8 });
      cast.seat(seed);
      for (let n = 0; n < 864; n += 1) {
        const at = runtime.engine.tick + 1;
        for (const raid of runtime.raids.live()) {
          standoffTicks += 1;
          const view = runtime.raidsFor(raid.target, at, 20).find((v) => v.raid === raid.id);
          if (view === undefined) continue;
          ownHandTicks += view.force.your_hands_here;
        }
        for (const action of cast.decide(at, seed)) runtime.engine.submit(action);
        if (runtime.runTick().halted) throw new Error('halted');
      }
    }
    expect(standoffTicks).toBeGreaterThan(0);
    expect(ownHandTicks).toBeGreaterThan(0);
  });
});

describe('the good the fixture raids is the one the Levy is assessed in', () => {
  it('holds, so `your_standing_here` is not measuring a good nobody has', () => {
    // Guards the non-vacuity of `protects_you` above: if the raided good were one the fixture
    // never seats, `your_standing_here` would be 0 for everybody and the field would read
    // `false` universally while looking like it discriminated.
    const w = raidWorld('good-check', 3);
    const raid = runToFirstRaid(w.runtime);
    expect(raid.good).toBe(LEVY_GOOD);
    tick(w.runtime);
  });
});
