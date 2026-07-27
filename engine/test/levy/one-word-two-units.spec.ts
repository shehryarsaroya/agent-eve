/**
 * ★ **§3's `STORES` IS ONE CANON WORD FOR TWO CONCEPTS, AND THIS FILE IS THE STANDING GUARD.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE FAMILY, IN THE ORDER IT WAS FOUND.** SPEC §3 defines STORES as *"assets, inventory,
 * balances"* — a **currency balance** and a **located inventory of goods**, under one word that
 * HARD RULE 4 says is a rules surface. Four sites have now made a decision about a
 * goods-denominated obligation from a figure in the wrong unit:
 *
 *   1. **`weightOf('BY_STORES')`** sized a Levy — payable *"only in located goods"* — by the
 *      currency balance. Fixed before this file; `test/levy/aged-solvency.spec.ts` is its
 *      regression. It produced a duty **anti-correlated with the ability to pay it**: `p:halcyon`
 *      assessed 36,374 of 120,000 holding **0** units of the levy good, while `p:vex` holding
 *      76,565 was assessed 500.
 *   2. **The cast's `spare` nomination** — same root, one layer up, and pinned here. It relieved by
 *      *cash* poverty, so on `g07` the constellation spared its most goods-rich member three
 *      Reckonings running, funding that relief out of everybody else (`relievedTotal`: the relief
 *      is *funded*, which is what makes the vote a redistribution rather than a discount).
 *   3. **`orderOutcomes`** in `observe/briefing.ts` ranked a goods obligation, a currency figure, a
 *      count of roles and **an absolute tick number** on one scale, then truncated at 12 with no
 *      `withheld` field to be counted in. Pinned here.
 *   4. **`claimFor`'s cover multiple** compared an `ore` income against a `ration` bill with no
 *      refine conversion — the same arithmetic `api/observe.ts` had already fixed in the WORKS
 *      payback sentence. Tripwired here, honestly (see that test's own non-vacuity note).
 *
 * Every one of them was internally consistent and every one of them was a rules surface lying.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import { setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';
import { orderOutcomes, type DoNothingOutcome } from '../../src/observe/briefing.js';
import {
  isNewcomer,
  LEVY_DUTY_PER_PRINCIPAL,
  rollByConstellation,
  constellationOf,
} from '../../src/levy/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { REFINE_IN_QTY, REFINE_OUT_QTY } from '../../src/works/params.js';
import { CAST_CLAIM_COVER_MULTIPLE } from '../../src/cast/heuristic.js';

/** One `spare` nomination, with the constellation's goods position at the tick it was cast. */
interface Nomination {
  readonly tick: number;
  readonly by: PrincipalId;
  readonly nominee: PrincipalId;
  /** `levyGoodHeld` per eligible co-member, read at the nominating tick. */
  readonly held: ReadonlyMap<PrincipalId, number>;
}

/**
 * Age a heuristic world and capture every `spare` nomination the cast makes.
 *
 * Sampled from `cast.decide(...)` **before** the actions are submitted, which is the only moment at
 * which "what did this bot see" and "what did it choose" are the same tick. Reading the ballots out
 * of the book afterwards would compare a nomination against a warehouse that had moved since.
 */
function nominations(seed: string, reckonings: number): readonly Nomination[] {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size: 8 });
  cast.seat(seed);

  const out: Nomination[] = [];
  for (let i = 0; i < reckonings * TICKS_PER_RECKONING; i += 1) {
    const next = runtime.engine.tick + 1;
    const actions = cast.decide(next, seed);
    for (const action of actions) {
      const spare = action.params['spare'];
      if (action.verb !== 'vote' || typeof spare !== 'string') continue;
      const constellation = constellationOf(runtime.world, action.principal);
      if (constellation === null) continue;
      const held = new Map<PrincipalId, number>();
      for (const p of rollByConstellation(runtime.world).get(constellation) ?? []) {
        const subject = runtime.levySubjectOf(p, next);
        // The bot's own filter: not a newcomer (already floored) and not itself.
        if (isNewcomer(subject) || p === action.principal) continue;
        held.set(p, subject.levyGoodHeld);
      }
      out.push({ tick: next, by: action.principal, nominee: spare as PrincipalId, held });
    }
    for (const action of actions) runtime.engine.submit(action);
    const report = runtime.runTick();
    expect(
      report.halted,
      `halted at ${String(report.tick)}: ${report.violations.map((v) => `${v.id} ${v.message}`).join(' | ')}`,
    ).toBe(false);
  }
  return out;
}

describe('★ 2. the `spare` nomination relieves by the good the Levy is PAYABLE IN', () => {
  it('never nominates a member holding MORE of the levy good than an eligible alternative', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THIS TEST FAILS ON MASTER.** `ballotFor` sorted by `s.freeStores` — the currency balance —
    // so the cast relieved whoever had spent its cash, which on `g07` was `p:vex`: spared three
    // Reckonings running while holding **76,565** units of the levy good, the most in its
    // constellation, because it had paid for a crossing.
    //
    // The assertion is the bot's own stated policy — *relieve whoever can least afford THIS bill* —
    // and nothing more. §5.2 makes sparing a political choice, so this is not a rule and an LLM
    // member may nominate its ally or itself; what is pinned is that the figure the *heuristic*
    // sorts on is denominated in the thing being demanded.
    //
    // MUTATION: put `a.freeStores - b.freeStores` back in `ballotFor` and this goes red naming the
    // nominee and the member that held less.
    // ══════════════════════════════════════════════════════════════════════════
    const rows = nominations('g07', 4);

    // NON-VACUITY, FIRST. `ballotFor` only nominates when the window is open, the member has not
    // voted, and at least one eligible co-member exists — all properties of the world, not of this
    // file. A world that never nominated would make every loop below iterate zero times and report
    // green, which is precisely the failure the last aged test had to warn about at its assertion.
    expect(
      rows.length,
      'no `spare` nomination was made in four Reckonings, so this test asserted nothing at all',
    ).toBeGreaterThan(0);
    expect(
      rows.filter((r) => r.held.size >= 2).length,
      'every nomination had at most one eligible candidate, so "picked the poorest" was forced and ' +
        'the ordering was never exercised',
    ).toBeGreaterThan(0);

    for (const row of rows) {
      const nominated = row.held.get(row.nominee);
      // A nominee outside the eligible set would be a different bug; assert it is inside.
      expect(
        nominated,
        `tick ${String(row.tick)}: ${row.by} nominated ${row.nominee}, which is not an eligible ` +
          'non-newcomer co-member at all',
      ).toBeDefined();
      if (nominated === undefined) continue;
      for (const [other, held] of row.held) {
        expect(
          nominated,
          `tick ${String(row.tick)}: ${row.by} nominated ${row.nominee} for relief while it held ` +
            `${String(nominated)} units of the levy good and ${other} held only ${String(held)}. ` +
            'The Levy is payable ONLY in goods and the relief is funded by the others, so sparing ' +
            'the better-supplied member taxes the constellation to protect the one who could pay — ' +
            'if this is red the nomination is sorting on the currency balance again',
        ).toBeLessThanOrEqual(held);
      }
    }
  }, 240_000);
});

describe('★ 3. `if_you_do_nothing` ranks GRAVITY, never five units on one scale', () => {
  function outcome(kind: DoNothingOutcome['kind'], amount: number, subject = 's'): DoNothingOutcome {
    return { kind, subject, amount: minor(amount), provenance: 'FACT', band: null };
  }

  it('puts an unpaid Levy above a hand landing, at a tick number larger than the duty', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THE CLOCK BOMB.** `HAND_LANDS.amount` is `inTransitEta(hand)` — an **absolute tick**. The
    // old comparator was `b.amount - a.amount`, so past tick `LEVY_DUTY_PER_PRINCIPAL` every
    // in-transit hand outranked a full Levy assessment, forever. `renderLine` narrates
    // `outcomes.slice(0, 3)` and `agent.md` §12 tells players to read `if_you_do_nothing` FIRST
    // every wake, so the briefing was scheduled to start leading with "a hand arrives" while the
    // tribute went unpaid. The live world was at tick ~5,274 of the ~20,000 needed.
    //
    // This cannot be reached from a real world in a test — 20,000 ticks is 69 Reckonings — which is
    // exactly why `orderOutcomes` is exported and fed directly.
    //
    // MUTATION: restore `b.amount - a.amount` as the first comparator term and this goes red.
    // ══════════════════════════════════════════════════════════════════════════
    const lateTick = LEVY_DUTY_PER_PRINCIPAL + 10_000;
    const ordered = orderOutcomes([
      outcome('HAND_LANDS', lateTick, 'p:x:h1'),
      outcome('LEVY_UNPAID', LEVY_DUTY_PER_PRINCIPAL, 'sys-01'),
    ]);
    expect(
      ordered[0]?.kind,
      `a hand landing at tick ${String(lateTick)} outranked a ${String(LEVY_DUTY_PER_PRINCIPAL)} ` +
        'Levy shortfall — which is a clock reading beating a goods obligation on one scale',
    ).toBe('LEVY_UNPAID');
  });

  it('puts a role about to lapse above news, which a count of roles never could', () => {
    // `ROLE_OPEN.amount` is a CARDINALITY, 1..4, so under an amount sort it could never outrank
    // anything at all — a venture resolving PARTIAL_FILL sat permanently below a hand walking.
    const ordered = orderOutcomes([
      outcome('ESCROW_EXECUTES', 500_000, 'v:1'),
      outcome('HAND_LANDS', 9_000, 'p:x:h1'),
      outcome('ROLE_OPEN', 2, 'v:2'),
    ]);
    expect(ordered.map((o) => o.kind)).toEqual(['ROLE_OPEN', 'ESCROW_EXECUTES', 'HAND_LANDS']);
  });

  it('still ranks by amount WITHIN one kind, which is the only unit-safe comparison', () => {
    const ordered = orderOutcomes([
      outcome('ELECTIVE_LAPSES', 100, 'v:a'),
      outcome('ELECTIVE_LAPSES', 900, 'v:b'),
      outcome('ELECTIVE_LAPSES', 400, 'v:c'),
    ]);
    expect(ordered.map((o) => o.amount)).toEqual([900, 400, 100]);
    // And the tie-break is canonical, so two fetches in one tick are byte-identical (DET-1).
    const tied = orderOutcomes([outcome('SEAL_ABSENT', 0, 'v:z#1'), outcome('SEAL_ABSENT', 0, 'v:a#1')]);
    expect(tied.map((o) => o.subject)).toEqual(['v:a#1', 'v:z#1']);
  });

  it('ranks a permanent mark above every consequence that leaves no mark', () => {
    // The order is a claim about §5's severities, not a preference: a default and a Levy shortfall
    // are permanent and public (A5, no opt-out); everything below them is recoverable or is news.
    const ordered = orderOutcomes([
      outcome('NOTHING_RESOLVES', 0, ''),
      outcome('HAND_LANDS', 1, 'h'),
      outcome('ESCROW_EXECUTES', 1, 'v'),
      outcome('ELECTIVE_AT_RISK', 1, 'v'),
      outcome('ROLE_OPEN', 1, 'v'),
      outcome('SEAL_ABSENT', 0, 'v#0'),
      outcome('LEVY_UNPAID', 1, 'sys-01'),
      outcome('ELECTIVE_LAPSES', 1, 'v'),
    ]);
    expect(ordered.map((o) => o.kind)).toEqual([
      'ELECTIVE_LAPSES',
      'LEVY_UNPAID',
      'SEAL_ABSENT',
      'ROLE_OPEN',
      'ELECTIVE_AT_RISK',
      'ESCROW_EXECUTES',
      'HAND_LANDS',
      'NOTHING_RESOLVES',
    ]);
  });
});

describe('★ 4. the claim cover gate crosses two goods, so the recipe is a tripwire', () => {
  it('IS NOT A BEHAVIOURAL TEST TODAY, and says so: the recipe is 1:1', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **READ THIS BEFORE TRUSTING THIS TEST.** `claimFor`'s gate compares a WORKS income in
    // `WORKS_YIELD_GOOD` (`ore`) against a Charge in `CHARGE_GOOD` (`ration`). It did so with no
    // conversion — the identical mistake `api/observe.ts` had already fixed in the WORKS payback
    // sentence, whose comment says why: *"it happens to be right at today's 1:1 recipe and would go
    // silently wrong the moment `refine` stopped being lossless."*
    //
    // At `REFINE_IN_QTY:REFINE_OUT_QTY = 1:1` the fixed arithmetic and the broken arithmetic are the
    // SAME NUMBER, so **no behavioural test can distinguish them and this one does not pretend to.**
    // An unexercised guard reads exactly like a missing one, and the honest move is to say so at the
    // assertion rather than to let the next reader think the site is covered.
    //
    // What this therefore is: a **tripwire on the recipe.** The day a second good makes `refine`
    // lossy, this goes red and names the two sites that must be re-read — which is worth more than a
    // green tick, because a claim whose Charge it cannot fund lapses in three Reckonings and slashes
    // `CLAIM_BOND_MINOR`, and `sovereignty/params.ts` is explicit that the goods being equal *"is a
    // decision (D17), not a fact about the engine"*.
    // ══════════════════════════════════════════════════════════════════════════
    expect(
      [REFINE_IN_QTY, REFINE_OUT_QTY],
      'the refine recipe has moved off 1:1. TWO sites convert an `ore` income into a `ration` ' +
        'obligation and both must be re-read against the new ratio: `cast/heuristic.ts:claimFor`\'s ' +
        'CAST_CLAIM_COVER_MULTIPLE gate, and `api/observe.ts`\'s WORKS payback sentence. Until then ' +
        'no behavioural test can tell a converted comparison from an unconverted one',
    ).toEqual([1, 1]);
  });

  it('the conversion is present in the gate, as arithmetic over the published constants', () => {
    // Not a tautology only because it fixes the DIRECTION: refined output per unit of ore is
    // `OUT / IN`, so income is multiplied by `OUT` and divided by `IN`. Inverting the ratio is the
    // plausible mistake once it stops being 1, and at 1:1 the inversion is still invisible — which
    // is the same admission as above, kept next to the arithmetic it is about.
    const orePerReckoning = 10_368;
    const refined = Math.floor((orePerReckoning * REFINE_OUT_QTY) / REFINE_IN_QTY);
    expect(refined).toBe(orePerReckoning);
    // And the gate is a threefold cover, unchanged by the conversion at this recipe.
    expect(refined < 4_000 * CAST_CLAIM_COVER_MULTIPLE).toBe(true);
    expect(refined < 3_000 * CAST_CLAIM_COVER_MULTIPLE).toBe(false);
  });
});
