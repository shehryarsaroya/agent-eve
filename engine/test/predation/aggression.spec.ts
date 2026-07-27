/**
 * THE PRICE THAT STOPS PREDATION BECOMING A TOLL BOOTH.
 *
 * §9 names the failure before the mechanic: *"cheap, bounded, computable predation Coase-collapses into
 * a toll cartel — the raider posts a standing 8% passage fee, every hauler accepts because 8% certain
 * beats an expected 15% loss plus escort wages, the escort market never opens, and the map renders
 * identically to peace"*. A13's verdict on that is brutal: a mechanic that renders identically to peace
 * has no pixel signature, so it does not exist.
 *
 * The answer is *"a slow-regenerating aggression capacity **that expires unspent**"*, and the expiry is
 * the entire design rather than a detail. A budget that ACCUMULATES is a war chest, which is precisely
 * what a toll operator wants — bank quietly for ten Reckonings, then credibly threaten everyone at once.
 * Expiry inverts it: the cost of a demand is not the capacity but **the other demand you gave up this
 * cycle**.
 *
 * These tests are mostly about that inversion, because it is the part an implementation gets wrong by
 * being helpful — carrying a remainder forward reads like generosity and quietly rebuilds the cartel.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PrincipalId } from '../../src/core/types.js';
import {
  AGGRESSION_PER_RECKONING,
  aggressionNote,
  aggressionRemaining,
  type AggressionSpend,
} from '../../src/predation/aggression.js';

const RAIDER = 'p:raider' as unknown as PrincipalId;
const OTHER = 'p:other' as unknown as PrincipalId;

/** A 100-tick Reckoning, so the boundaries are obvious to read in the cases below. */
const reckoningOf = (t: number): number => Math.floor(t / 100);

function spend(initiator: PrincipalId, tick: number): AggressionSpend {
  return { initiator, tick };
}

describe('aggression capacity expires unspent, which is what prices out a standing toll', () => {
  it('a principal that has done nothing holds the full allowance', () => {
    expect(aggressionRemaining([], RAIDER, 50, reckoningOf)).toBe(AGGRESSION_PER_RECKONING);
  });

  it('each demand inside the Reckoning spends one', () => {
    const spends = [spend(RAIDER, 10)];
    expect(aggressionRemaining(spends, RAIDER, 50, reckoningOf)).toBe(AGGRESSION_PER_RECKONING - 1);
    expect(aggressionRemaining([...spends, spend(RAIDER, 20)], RAIDER, 50, reckoningOf)).toBe(
      AGGRESSION_PER_RECKONING - 2,
    );
  });

  it('★ LAST CYCLE’S RESTRAINT BUYS NOTHING — the allowance does not accumulate', () => {
    // The assertion the whole mechanic rests on. A principal that sat quietly through three Reckonings
    // arrives at the fourth with exactly the same capacity as one that spent everything — which is what
    // makes "bank it and threaten everyone at once" unfundable, and therefore what keeps the escort
    // market open.
    const quiet: AggressionSpend[] = [];
    const spent = [spend(RAIDER, 10), spend(RAIDER, 20), spend(RAIDER, 110), spend(RAIDER, 120)];
    const atFourthReckoning = 350;
    expect(aggressionRemaining(quiet, RAIDER, atFourthReckoning, reckoningOf)).toBe(AGGRESSION_PER_RECKONING);
    expect(aggressionRemaining(spent, RAIDER, atFourthReckoning, reckoningOf)).toBe(AGGRESSION_PER_RECKONING);
  });

  it('spends in OTHER Reckonings do not count against this one', () => {
    // The same fact from the other side, and the one an implementation breaks by counting the whole
    // journal: a raider active last cycle would arrive this cycle already exhausted, which makes
    // predation a once-ever act rather than a recurring decision.
    const lastCycle = [spend(RAIDER, 10), spend(RAIDER, 90)];
    expect(aggressionRemaining(lastCycle, RAIDER, 150, reckoningOf)).toBe(AGGRESSION_PER_RECKONING);
  });

  it('another principal’s demands are not mine', () => {
    const theirs = [spend(OTHER, 10), spend(OTHER, 20), spend(OTHER, 30)];
    expect(aggressionRemaining(theirs, RAIDER, 50, reckoningOf)).toBe(AGGRESSION_PER_RECKONING);
  });

  it('never goes negative, so an over-spend cannot net against the next cycle', () => {
    // An over-spend is a bug in the caller's gate, not a debt. Returning a negative would let it silently
    // borrow from the next Reckoning — a raider could then front-load a campaign and pay it back with
    // capacity it was going to lose anyway, which is the accumulation this design forbids, arriving
    // backwards.
    const tooMany = Array.from({ length: AGGRESSION_PER_RECKONING + 5 }, (_, i) => spend(RAIDER, i));
    expect(aggressionRemaining(tooMany, RAIDER, 50, reckoningOf)).toBe(0);
  });

  it('the note tells an agent the capacity EXPIRES, because a wrong model plans a campaign it cannot fund', () => {
    // A2. An agent that believes capacity banks will hold fire for three cycles to fund one big move,
    // and discover at the end that it bought nothing. The refusal has to say so, not merely say no.
    expect(aggressionNote(1)).toMatch(/does not carry|DOES NOT CARRY/i);
    expect(aggressionNote(0), 'and the exhausted case must say when it refreshes').toMatch(/next Reckoning/i);
    expect(aggressionNote(0), 'and why it is capped at all').toMatch(/toll|tariff/i);
  });

  it('⚑ NOTHING SPENDS THIS YET — invert this test the day something does', () => {
    // The self-destructing tripwire, the same shape as `inv22-is-vacuous` (which failed today, exactly
    // as designed, and became `inv22-is-live`). A helper that nothing calls is the defect class this
    // project keeps finding at every depth: verbs with no affordance, affordances no cast selects,
    // invariants whose subject cannot occur. A module with no caller is the same thing one level down,
    // and it reads as "built" in every report.
    //
    // So this is written down rather than left to be noticed. `demand` — §9's agent-initiated standoff —
    // is what spends aggression capacity, and it is NOT built: `RaidRecord` has no initiator, and adding
    // one is a captured-table change (`raid` is in CHECKPOINT_REQUIRED_TABLES), which means a
    // RULES_VERSION bump and a declared discontinuity in the permanent public record.
    //
    // The expiry semantics above are the subtle half and they are done and mutation-verified. What
    // remains is wiring: the initiator field and its capture, a `vDemand` handler that reuses the raid
    // machinery already there (sides, join, force, YIELD/FIGHT, resolution), the affordance, and the
    // rules bump. When that lands, DELETE this test — do not weaken it.
    const callers = readdirSync(new URL('../../src/', import.meta.url), { recursive: true, encoding: 'utf8' })
      .filter((f) => typeof f === 'string' && f.endsWith('.ts') && !f.endsWith('predation/aggression.ts'))
      .filter((f) => readFileSync(new URL(`../../src/${f}`, import.meta.url), 'utf8').includes('aggressionRemaining'));
    expect(
      callers,
      `aggressionRemaining now has ${String(callers.length)} caller(s) — ${callers.join(', ')} — which ` +
        `means §9's demand window is being built. Good. This test is now backwards: delete it, and make ` +
        `sure the caller's gate is what refuses an over-spend, because this helper only REPORTS ` +
        `capacity and never enforces it.`,
    ).toEqual([]);
  });
});
