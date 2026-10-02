/**
 * ★ **THE BILL EXPLAINS ITSELF — `obligations.levy` carries the docket's own reasons.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A member's bill went 500 → 6,656 → 56,977 → 39,227 across four Reckonings and the block published
 * the figure and nothing that moved it: no rule, no total, no weight, no word that quorum had failed.
 * The plan held all of it (`levy/assessment.ts:AllocationPlan`, `Allocation`). The block now reads it
 * off the same plan the bill came from:
 *
 *     rule · quorum_failed · constellation_total · my_weight · newcomer_floor · spared
 *
 * Asserted against the book, never against a retyped number, and across the newcomer boundary so both
 * shapes of a line are seen: a floored newcomer (weight 0) and a weighted veteran.
 *
 * Mutation, run: `quorum_failed: false`, `my_weight` from `found.line.amount`, and `constellation_total`
 * from `found.line.amount` each fail both cases.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import { LEVY_NEWCOMER_TENURE_TICKS, LEVY_RULES } from '../../src/levy/index.js';
import { levyWorld, runTo, tick } from './fixture.js';

describe('★ obligations.levy names the rule, the total, your weight and why', () => {
  it('★1 a newcomer docket: floored lines, weight 0, the published fallback because nobody voted', () => {
    const world = levyWorld('bill-explains-newcomer', 3);
    const rt = world.runtime;
    tick(rt);
    const blocks = world.principals.map((p) => rt.levyBlockFor(p, rt.engine.tick));
    const first = blocks[0];
    expect(first, 'non-vacuity: assessed').not.toBeNull();
    expect(LEVY_RULES).toContain(first?.rule);
    expect(first?.quorum_failed, 'no ballot has closed on the first docket, so it is the fallback').toBe(true);
    expect(first?.newcomer_floor).toBe(true);
    expect(first?.my_weight, 'a floored line carries no pool weight').toBe(0);
    const sum = blocks.reduce((n, b) => n + Number(b?.my_assessment ?? 0), 0);
    expect(first?.constellation_total, 'every line on the docket sums to the total (INV-24)').toBe(sum);
  });

  it('★2 a veteran docket: weighted lines, and the weight is the one the plan cut the bill with', () => {
    const world = levyWorld('bill-explains-veteran', 3);
    const rt = world.runtime;
    // Past the newcomer tenure, onto a fresh docket.
    runTo(rt, Math.ceil((LEVY_NEWCOMER_TENURE_TICKS + 1) / TICKS_PER_RECKONING) * TICKS_PER_RECKONING + 1);
    const who = world.principals[0];
    if (who === undefined) throw new Error('fixture');
    const block = rt.levyBlockFor(who, rt.engine.tick);
    const found = rt.levy.lineFor(Math.floor(rt.engine.tick / TICKS_PER_RECKONING), who);
    expect(found, 'non-vacuity: the book holds this line').not.toBeNull();
    expect(block?.newcomer_floor, 'past the tenure the floor no longer applies').toBe(false);
    expect(block?.my_weight, 'a weighted line').toBeGreaterThan(0);
    expect(block?.my_weight).toBe(found?.line.weight);
    expect(block?.rule).toBe(found?.plan.rule);
    expect(block?.quorum_failed).toBe(found?.plan.byDefault);
    expect(block?.constellation_total).toBe(found?.plan.total);
    expect(block?.spared).toBe(false);
    const sum = world.principals.reduce((n, p) => n + Number(rt.levyBlockFor(p, rt.engine.tick)?.my_assessment ?? 0), 0);
    expect(block?.constellation_total).toBe(sum);
  }, 120_000);
});
