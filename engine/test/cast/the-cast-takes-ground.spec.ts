/**
 * **THE TERRITORIAL LAYER, LIVE — asserted on a world nobody steers.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHY THIS FILE EXISTS.** `D23` #4 found sovereignty *anti*-load-bearing and the rent was
 * built to answer it. The rent landed, it renders, and `claimLines` stayed **0** — because
 * nothing in the world ever *chose* the ground. The agent that built the rent wrote it down:
 * *"Tonight made the rent and fuel legible; it did not make anyone want the ground."*
 *
 * Verified against live production at tick 5,274 before this file was written: `claimLines`
 * `len=0`, and all five WORKS reporting `rentBps: 0, rentPaid: 0, rentPerTick: 0,
 * fuelExtracted: 0, fuelPerTick: 0`. One of them had extracted 3,920 units of ore and paid rent
 * to nobody, because nobody owned the ground under it.
 *
 * So the assertions here are deliberately about **outcomes in a running world**, not about
 * branches firing. A test that proves `build {ANCHOR}` was submitted proves the same thing
 * `claimLines: 0` already disproved. What has to become true is:
 *
 *   1. principals leave the Commons at all, and land somewhere better than they left;
 *   2. `claimLines` is **non-empty** — live claims stand;
 *   3. `rent_to` is **non-null for a real tenant**, and goods actually move on it;
 *   4. the Charge gets **paid**, so the claims are not a queue of pending lapses;
 *   5. `fuel` — the good only the Frontier makes — is extracted and **burned into an anchor**;
 *   6. and none of it makes the **Levy** harder, which is the gate that decides whether the
 *      branches were right. A5 has no opt-out: breaches this cast produces stay on the record.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { HeuristicCast, type CastMember } from '../../src/cast/index.js';
import { setSpeed } from '../../src/core/time.js';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import { Runtime } from '../../src/sim/runtime.js';
import { holdingOf, tierOf } from '../../src/world/index.js';

/** The four seeds the balance gate was run on. Fixed, so the numbers below are reproducible. */
export const GATE_SEEDS = ['gate-a', 'gate-b', 'gate-c', 'gate-d'] as const;

interface Run {
  readonly runtime: Runtime;
  readonly cast: HeuristicCast;
  /** Accepted actions, by verb. */
  readonly verbs: Map<string, number>;
  /** Accepted actions, by `principal|verb`, so a per-member claim is assertable. */
  readonly byMember: Map<string, number>;
  /** Refusals, by `verb invariant`. AGT-S3: a repeat here is a rules-surface defect. */
  readonly refusals: Map<string, number>;
}

/**
 * Run a world nobody steers, and tally what it actually did.
 *
 * Tallied from `engine.log` per tick rather than from the cast's own return, because the cast
 * returning an action proves only that it asked: `ActionLog` retention is bounded, so the tally
 * has to happen inside the loop.
 */
export function play(seed: string, ticks: number, size = 8): Run {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size });
  cast.seat(seed);
  const verbs = new Map<string, number>();
  const byMember = new Map<string, number>();
  const refusals = new Map<string, number>();
  for (let n = 0; n < ticks; n += 1) {
    for (const action of cast.decide(runtime.engine.tick + 1, seed)) runtime.engine.submit(action);
    const report = runtime.runTick();
    for (const entry of runtime.engine.log.forTick(report.tick)) {
      if (entry.outcome === 'REFUSED' && entry.rejection !== null) {
        const key = `${entry.verb} ${entry.rejection.invariant}`;
        refusals.set(key, (refusals.get(key) ?? 0) + 1);
        continue;
      }
      verbs.set(entry.verb, (verbs.get(entry.verb) ?? 0) + 1);
      const who = `${String(entry.principal)}|${entry.verb}`;
      byMember.set(who, (byMember.get(who) ?? 0) + 1);
    }
    expect(
      report.halted,
      `halted at ${String(report.tick)}: ${report.violations.map((v) => `${v.id} ${v.message}`).join(' | ')}`,
    ).toBe(false);
  }
  return { runtime, cast, verbs, byMember, refusals };
}

/** Where a member's body stands now — the same thing the cast's own `bodyOf` reads. */
function bodyOf(runtime: Runtime, member: CastMember): SystemId {
  return holdingOf(runtime.world, member.principal).system;
}

function did(run: Run, principal: PrincipalId, verb: string): number {
  return run.byMember.get(`${String(principal)}|${verb}`) ?? 0;
}

describe('the cast can reach the place its tribute is payable at (a guard that was wrong)', () => {
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * **A PRE-EXISTING DEFECT, FOUND WHILE MAKING TERRITORY REACHABLE.**
   *
   * `levyMove` refused any hop whose tier differed from `tierOf(map, member.seat)`. The launch
   * map's constellation 1 is mixed — `sys-01`..`04` COMMONS, `sys-05`..`07` MARCHES — and
   * `levy/place.ts` puts the delivery place at the constellation's *lowest-id COMMONS system*.
   * So a MARCHES-seated member in constellation 1 had its only legal route refused **by the
   * cast, not by the engine**: `commonsBoundRejection` binds hands going OUT of the Commons and
   * never refuses one coming back in.
   *
   * Measured before the fix, seed `gate-b`: `levyShort: 6000`, `brannock` (seat `sys-05`) with
   * three hands parked at `sys-07`, delivery place `sys-01`, zero `deliver` actions ever. After
   * the fix `levyShort` is **0 on all four gate seeds**.
   *
   * MUTATION: restore `tierOf(map, next) !== tierOf(map, member.seat)` in `levyMove`. RED on the
   * second expectation below.
   * ══════════════════════════════════════════════════════════════════════════
   */
  it('a member whose delivery place is in another TIER still pays', () => {
    const run = play('gate-b', 640);
    const stranded = run.cast.roster.filter((m) => {
      const block = run.runtime.levyBlockFor(m.principal, run.runtime.engine.tick);
      if (block === null) return false;
      const here = tierOf(run.runtime.world.map, bodyOf(run.runtime, m));
      return tierOf(run.runtime.world.map, block.deliverable_to) !== here;
    });
    // The fixture has to contain one, or the assertion below is vacuous — the failure mode three
    // agents hit in one night on this codebase.
    expect(
      stranded.length,
      'no member on this seed is assessed in a tier it is not standing in, so this proves nothing',
    ).toBeGreaterThan(0);
    for (const m of stranded) {
      expect(
        did(run, m.principal, 'deliver'),
        `${m.handle} stands in a different tier from ${String(
          run.runtime.levyBlockFor(m.principal, run.runtime.engine.tick)?.deliverable_to,
        )} and delivered nothing — the cast refused its own legal route`,
      ).toBeGreaterThan(0);
    }
  }, 180_000);

  it('and the world-level shortfall it was inflating is gone on every gate seed', () => {
    // The headline meter, which no single agent can lower (§14.2). Before the guard fix two of
    // the four gate seeds carried a 6,000 shortfall that was entirely one stranded member.
    for (const seed of GATE_SEEDS) {
      const run = play(seed, 640);
      expect(
        run.runtime.reckoningFrame()?.meters.levyShort ?? -1,
        `${seed} is short, and a shortfall is an accusation`,
      ).toBe(0);
    }
  }, 600_000);
});
