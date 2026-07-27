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

  it('★ SOMETHING SPENDS THIS NOW — and the caller, not this helper, is what enforces it', () => {
    // ══════════════════════════════════════════════════════════════════════
    // **THIS TEST USED TO SAY THE OPPOSITE, AND IT FIRED EXACTLY AS DESIGNED.**
    //
    // It was a self-destructing tripwire — the same shape as `inv22-is-vacuous`, which also fired
    // and also became `-is-live` — against this project's most persistent defect class: a
    // capability that exists and is never exercised is indistinguishable from one that is
    // missing, in every report, on every frame, and to every reader including its author. Verbs
    // with no affordance (nine, `grant` among them), affordances no cast ever selects, invariants
    // whose subject cannot occur, and *a module with no caller* — which is the same thing one
    // level down and reads as "built" in every summary.
    //
    // `demand` — §9's agent-initiated standoff — is now the caller, so the check is inverted
    // rather than deleted: it now fails if the caller goes away again. And it asserts the second
    // half the old text asked for, which is the load-bearing one: **this helper only REPORTS
    // capacity, it never enforces it.** `aggressionRemaining` returning 0 does nothing on its
    // own; `demandRefusal` refusing on it is the price.
    // ══════════════════════════════════════════════════════════════════════
    const callers = readdirSync(new URL('../../src/', import.meta.url), { recursive: true, encoding: 'utf8' })
      .filter((f) => typeof f === 'string' && f.endsWith('.ts') && !f.endsWith('predation/aggression.ts'))
      .filter((f) => readFileSync(new URL(`../../src/${f}`, import.meta.url), 'utf8').includes('aggressionRemaining'));
    expect(
      callers,
      'aggressionRemaining has no caller in src/ any more. §9\'s anti-toll-cartel price is the only ' +
        'thing standing between predation and a standing tariff, and a price nothing charges is not a ' +
        'price. Find what removed the `demand` gate rather than relaxing this.',
    ).not.toEqual([]);
    expect(
      callers.some((f) => f === 'predation/demand.ts'),
      'the caller must be `demand` — §9 names the aggression capacity as what an AGENT-INITIATED raid ' +
        'spends, and nothing else in the design has a claim on it',
    ).toBe(true);

    // And the enforcement lives in the gate, not here. Over-spending is representable at this
    // level — the helper clamps to 0 and carries no debt forward — so a reader must not mistake
    // "remaining is 0" for "the act is refused".
    const overspent = Array.from({ length: AGGRESSION_PER_RECKONING + 3 }, (_, i) => spend(RAIDER, i));
    expect(aggressionRemaining(overspent, RAIDER, 50, reckoningOf)).toBe(0);
  });
});
