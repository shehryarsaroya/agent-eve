/**
 * **INV-25 — the anti-quiet invariant, which is the whole reason the Levy exists.**
 *
 * > *"Every principal appears in ≥1 docket row per Reckoning. The anti-quiet invariant,
 * > and the one most likely to quietly stop being true as features are added."*
 * > — TESTING.md §3
 *
 * ══════════════════════════════════════════════════════════════════════════
 * §5.2's opening sentence is the failure this invariant catches: *"an agent that forms no
 * ventures and stays in the Commons is never on the docket, never penalised, never even
 * visible as a problem — which is the dominant strategy for the median agent."*
 *
 * So the test that matters here is not "the checker works". It is: **a principal that does
 * absolutely nothing, for a whole Reckoning, is on the docket anyway** — and it is asserted
 * against the real ASSERT phase of the real tick loop, in a world where nobody acts, because
 * that is the world the critics said the design could not see.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';
import { checkInv25 } from '../../src/invariants/crowd.js';
import { docketRowsFor } from '../../src/levy/settle.js';
import { levyWorld, runTo, tick } from './fixture.js';

describe('INV-25 — every principal on a docket row, every Reckoning', () => {
  it('puts a principal that does NOTHING on the docket, and keeps it there all cycle', () => {
    const world = levyWorld('quiet', 3);
    const runtime = world.runtime;
    // Not one action from anybody. This is the quiet equilibrium, run on purpose.
    tick(runtime);

    const rows = docketRowsFor(runtime.levy, 0);
    expect(rows.length).toBeGreaterThanOrEqual(world.principals.length);
    expect(checkInv25(world.principals, rows, 0, runtime.engine.tick)).toEqual([]);

    // And it holds at every phase of the cycle, not just the one we happened to look at:
    // the assessment is minted at phase 0 and never moves, so the docket cannot go quiet
    // halfway through a day.
    for (const target of [50, 200, 262, 286, 287]) {
      runTo(runtime, target);
      const at = docketRowsFor(runtime.levy, 0);
      expect(checkInv25(world.principals, at, 0, runtime.engine.tick), `tick ${String(target)}`).toEqual([]);
    }
  });

  it('holds across a Reckoning boundary in the wired engine, with nobody acting', () => {
    // The real tick loop's ASSERT runs INV-25 every tick from `Runtime.invariantInputs`.
    // A silent world crossing into a new Reckoning is exactly where an un-reassessed roll
    // would surface, so this runs past the boundary and asserts no violation was raised.
    const world = levyWorld('quiet-boundary', 3);
    const runtime = world.runtime;
    runTo(runtime, TICKS_PER_RECKONING + 3);
    expect(runtime.engine.status).toBe('RUNNING');
    const rows = docketRowsFor(runtime.levy, 1);
    expect(checkInv25(world.principals, rows, 1, runtime.engine.tick)).toEqual([]);
  });

  it('one row per principal, so the invariant fails LOUDLY rather than vacuously', () => {
    // A single row naming everybody would satisfy INV-25 identically and tell a viewer
    // nothing. Per-principal rows mean the check names whoever fell off.
    const world = levyWorld('rows', 3);
    tick(world.runtime);
    const rows = docketRowsFor(world.runtime.levy, 0);
    for (const row of rows) expect(row.principals).toHaveLength(1);
    const named = new Set(rows.flatMap((r) => r.principals));
    const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
    expect([...named].sort(cmp)).toEqual([...world.principals].sort(cmp));
  });

  it('BITES: drop one principal from the docket and the checker names it', () => {
    const world = levyWorld('bite', 3);
    tick(world.runtime);
    const rows = docketRowsFor(world.runtime.levy, 0);
    const victim = world.principals[1];
    if (victim === undefined) throw new Error('fixture');
    // The mutation: the exact regression this invariant exists for — a principal quietly
    // stops being assessed, and nothing else about the world looks wrong.
    const mutated = rows.filter((r) => !r.principals.includes(victim));
    const violations = checkInv25(world.principals, mutated, 0, world.runtime.engine.tick);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.id).toBe('INV-25');
    expect(violations[0]?.message).toContain(victim);
    expect(violations[0]?.message).toContain('abstention must be impossible');
  });

  it('a principal enrolling mid-cycle is assessed at the nominal rate, on tonight\'s docket', () => {
    // Enrolment is free and continuous, so this happens constantly in production. Without
    // `Book.admitLate` the newcomer would hold no assessment, appear on no row, and INV-25
    // would halt the world on the arrival of a legitimate agent.
    const world = levyWorld('late', 2);
    const runtime = world.runtime;
    runTo(runtime, 100);
    const late = 'p:late' as PrincipalId;
    runtime.seat(late, 'late', world.stage);
    runtime.standing.open(late);
    tick(runtime);

    const roll = [...world.principals, late];
    const rows = docketRowsFor(runtime.levy, 0);
    expect(checkInv25(roll, rows, 0, runtime.engine.tick)).toEqual([]);
    const block = runtime.levyBlockFor(late, runtime.engine.tick);
    expect(block).not.toBeNull();
    expect(block?.my_assessment).toBeGreaterThan(0);
    // On the floor, because it has zero tenure — the protection at the one moment it is
    // most needed (§5.2: "otherwise inverse-Exposure weighting hands the minute-60
    // newcomer the maximum assessment").
    const line = runtime.levy.lineFor(0, late);
    expect(line?.line.newcomerFloored).toBe(true);
    // And no existing line moved: the total rose by the newcomer's own duty (A15).
    expect(line?.plan.total).toBe(
      (world.principals.reduce((n, p) => n + runtime.levy.assessmentOf(0, p), 0)) + (block?.my_assessment ?? 0),
    );
  });

  it('the world still runs a whole Reckoning to settlement with nobody acting at all', () => {
    // The full quiet equilibrium: three principals, zero actions, one settlement. The Levy
    // is the only thing on the docket, and it is enough that the Reckoning has an agenda.
    const world = levyWorld('quiet-settle', 3);
    const runtime = world.runtime;
    runTo(runtime, 287);
    expect(runtime.engine.status).toBe('RUNNING');
    const settled = runtime.levySettlement;
    expect(settled?.assessed).toBe(3);
    // Nobody paid, so the headline meter is up. That is A14 satisfied: the drama arrived on
    // the clock rather than because anybody chose conflict.
    expect(settled?.levyShort).toBeGreaterThan(0);
    expect(runtime.levyReckonings()).toHaveLength(1);
  });
});
