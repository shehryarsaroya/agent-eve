/**
 * INV-21 resumed rather than repeated — the second half of the same problem `checkInv7` had, and the
 * one I got wrong the first time.
 *
 * `checkStandingJournal` replayed **and sorted** the entire standing journal every tick: O(n log n)
 * on an n that grows for the life of the world, worse than the O(n) `checkInv7` was doing. The
 * journal cannot be capped, because it IS the proof — INV-21's claim is that the cached row an agent
 * reads equals a replay of every change ever made to it.
 *
 * **The first attempt broke a hundred tests**, and the reason is the whole design: fold everything
 * through the current tick but seal the boundary at `tick - 1`, and the next call re-folds the
 * previous tick and double-counts. The comparison now runs against a CLONE of the carried state plus
 * the unsealed tail, while the carried state absorbs only completed ticks — and absorbs them only on
 * a clean pass, because a tick about to abort must not certify a boundary.
 *
 * **WHAT IS PROVEN AND WHAT IS NOT.** The `tick - 1` boundary is mutation-proven: absorb the current
 * tick too and a driven world halts at tick 287 with every count exactly DOUBLED
 * (*"electiveHonoured is 2, but the journal accounts for 4"*), which is the original hundred-failure
 * bug made visible in one line.
 *
 * The `if (out.length === 0)` guard — do not seal on a pass that found violations — is **NOT** proven
 * by these tests. Mutating it to seal unconditionally breaks nothing, because a healthy driven world
 * never produces a dirty pass, and constructing one that halts and then continues means restarting a
 * PAUSED engine. It is here on reasoning rather than measurement: the tick is about to abort, its
 * rows and journal entries will be rolled back, and a boundary sealed inside a tick that never
 * happened would certify a world that does not exist. Said plainly rather than left to look proven,
 * because a guard nobody has seen bite is a guard nobody should trust.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { setSpeed } from '../../src/core/time.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { inv21Stats } from '../../src/invariants/promises.js';

function world(seed: string, ticks: number): Runtime {
  setSpeed('instant');
  const rt = new Runtime({ seed });
  const cast = new HeuristicCast(rt, { size: 6 });
  cast.seat(seed);
  for (let i = 0; i < ticks; i += 1) {
    for (const a of cast.decide(rt.engine.tick + 1, seed)) rt.engine.submit(a);
    const r = rt.runTick();
    if (r.halted) throw new Error(`halted at ${String(r.tick)}: ${r.violations.map((v) => `${v.id} ${v.message}`).join(' | ')}`);
  }
  return rt;
}

describe('the replay is resumed, and still proves what it proved', () => {
  beforeEach(() => {
    inv21Stats.fullReplays = 0;
    inv21Stats.resumed = 0;
  });

  it('a long run stays clean and never halts — the property that broke on attempt one', () => {
    // The hundred failures were all downstream of double-counting: a resumed fold that re-absorbed
    // the previous tick made every standing row disagree with the journal, so INV-21 halted worlds
    // that were fine. A long driven run is the cheapest proof that it no longer does.
    const rt = world('inv21-a', 900);
    expect(rt.engine.status, 'a healthy world must not be PAUSED').not.toBe('PAUSED');
    expect(inv21Stats.resumed, 'and the check must actually have resumed, not re-replayed').toBeGreaterThan(100);
  });

  it('replays in full once and resumes thereafter', () => {
    const rt = world('inv21-b', 400);
    expect(rt.engine.tick).toBeGreaterThan(300);
    // One full replay at the start; everything after is a resume. More than a handful of full
    // replays would mean the boundary check is rejecting its own prefix every tick, which is the
    // optimisation doing nothing while looking like it works.
    expect(inv21Stats.fullReplays, `full replays: ${String(inv21Stats.fullReplays)}`).toBeLessThan(5);
    expect(inv21Stats.resumed).toBeGreaterThan(300);
  });

  it('still catches a standing row that disagrees with the journal, AFTER the prefix is warm', () => {
    // THE ASSERTION THE OPTIMISATION COULD HAVE DESTROYED. The corruption is applied to a row whose
    // changes sit entirely inside the sealed prefix, so a version that trusted its carried totals
    // and skipped the comparison would report clean. The comparison must still run against every
    // row, every tick — only the FOLDING is incremental.
    const rt = world('inv21-c', 400);
    const rows = rt.standing.rows();
    const victim = rows.find((r) => r.electiveHonoured > 0 || r.defaults > 0) ?? rows[0];
    expect(victim, 'the world must have produced standing to corrupt').toBeDefined();

    // Reach past the API on purpose: this is the corruption INV-21 exists to detect, and by
    // construction it cannot be produced through a legal path.
    (victim as unknown as { electiveHonoured: number }).electiveHonoured += 3;
    const report = rt.runTick();
    expect(
      report.halted,
      'a standing row that disagrees with its journal must still halt the tick',
    ).toBe(true);
    expect(report.violations.map((v) => v.id)).toContain('INV-21');
  });
});
