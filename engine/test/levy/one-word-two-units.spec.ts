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
 *   5. **`DoNothingOutcome.amount` itself.** #3 fixed the comparator and left the *field* carrying
 *      five units under one name. `UNIT_OF` now publishes the denomination per kind and
 *      `orderOutcomes` guards on the **unit** rather than on the kind, so a new kind cannot
 *      reintroduce the bug by being added to `GRAVITY` and forgotten. Pinned here.
 *   6. **`hullOfferFor` added two GOODS together** — 1,500 `ration` + 90 `fuel` published as one
 *      `max_direct_loss` of 1,590, a quantity of nothing, in the field §3 denominates in MINOR. Split
 *      one-field-per-unit the way `build {WORKS}` and `build {ANCHOR}` already are. Pinned here.
 *   7. **`ShipyardPort.freeStoresOf`** — a **currency** reader on a verb priced entirely in goods,
 *      with no caller. Deleted; `combat/engage.ts` carries the argument at the gap it left.
 *   8. **`HoldingLine.upkeep_due`** — one `Minor` at 0 with a comment claiming *"a Commons holding is
 *      civic-leased and charges no upkeep"*, for §6.3's Charge, which is real and payable **only in
 *      goods**. Split into the currency zero plus `upkeep_due_qty`/`upkeep_good`, matching the live
 *      builder key for key. Pinned here.
 *
 * ── ★ AND ONE THAT IS THE OTHER DIRECTION: A UNIT WITH NO SCALE ──────────────
 *
 *   9. **`weightOf('BY_EXPOSURE')` was `1 + exposure`.** Not the wrong unit — *no* unit: the `1` is a
 *      cardinality standing against a MINOR quantity, so the rule had no scale and any EXPOSURE at all
 *      dwarfed the base. It could not be seen until EXPOSURE stopped being identically zero, and the
 *      first docket that had any billed one member **118,449 of 120,000 over 450 MINOR of peril**.
 *      Now `LEVY_EXPOSURE_UNIT + exposure`, the mirror of `INVERSE_EXPOSURE`'s own denominator. Pinned
 *      here, and it is the one site in this family whose fix is a *balance* change rather than a
 *      correction.
 *
 * Every one of them was internally consistent and every one of them was a rules surface lying.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import { setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import { minor, qty } from '../../src/core/units.js';
import { buildObservation } from '../../src/observe/observation.js';
import { orderOutcomes, UNIT_OF, type DoNothingOutcome } from '../../src/observe/briefing.js';
import {
  isNewcomer,
  largestRemainder,
  LEVY_DUTY_PER_PRINCIPAL,
  LEVY_EXPOSURE_UNIT,
  LEVY_INVERSE_WEIGHT_NUM,
  rollByConstellation,
  constellationOf,
  weightOf,
} from '../../src/levy/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { REFINE_IN_QTY, REFINE_OUT_QTY } from '../../src/works/params.js';
import { CAST_CLAIM_COVER_MULTIPLE, CAST_DOCTRINE } from '../../src/cast/heuristic.js';
import { hullOfferFor } from '../../src/combat/view.js';
import { simulateFit } from '../../src/combat/fit.js';
import { CHARGE_GOOD } from '../../src/sovereignty/params.js';
import { fixture } from '../venture/fixture.js';
import { ALICE } from '../venture/fixture.js';
import { sourcesFor } from '../observe/fixture.js';
import { subject } from './fixture.js';

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
    // `unit` comes from the engine's own table, never from a literal here: a fixture that named its
    // own unit could disagree with the payload and this whole describe block would be about a shape
    // the observation never publishes.
    return { kind, subject, amount: minor(amount), unit: UNIT_OF[kind], provenance: 'FACT', band: null };
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

  it('still ranks by amount WITHIN one UNIT, which is the only unit-safe comparison', () => {
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

describe('★ 5. `if_you_do_nothing` PUBLISHES the unit, so `amount` is not five things', () => {
  it('declares one unit per kind, and the three that are not currency are named', () => {
    // The table is total over `DoNothingKind` by its type, so this is not "are the entries there" —
    // it is the claim about WHICH unit each kind is in, which is the part a reader can get wrong.
    expect(UNIT_OF.LEVY_UNPAID, 'the Levy is payable only in located goods (§5.2)').toBe('QTY');
    expect(UNIT_OF.ROLE_OPEN, 'a count of open roles is a cardinality, never a value').toBe('COUNT');
    expect(UNIT_OF.HAND_LANDS, "this is an absolute tick — D28's clock bomb").toBe('TICK');
    expect(UNIT_OF.ELECTIVE_LAPSES).toBe('MINOR');
    expect(UNIT_OF.ESCROW_EXECUTES).toBe('MINOR');
    expect(UNIT_OF.ELECTIVE_AT_RISK).toBe('MINOR');
    expect(
      new Set(Object.values(UNIT_OF)).size,
      'if every kind shares one unit there was nothing here to fix',
    ).toBeGreaterThan(1);
  });

  it('★ never compares `amount` across two units, even inside one GRAVITY band', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THE GUARD MOVED FROM THE KIND TO THE UNIT, AND THIS IS THE DIFFERENCE.** `D28`'s comparator
    // fell back to `b.amount - a.amount` behind the comment *"same kind, therefore same unit"* — true
    // by accident of the current kind list, and silently wrong for the next kind added to `GRAVITY`.
    //
    // Reached with a **deliberately mislabelled** row: a `ROLE_OPEN` (a COUNT) forced to carry the
    // `MINOR` unit, so two rows share a `GRAVITY` band and disagree about denomination. Under the old
    // rule they rank by raw integer; under the new one the mismatch drops the amount term and the
    // canonical subject tie-break decides.
    //
    // MUTATION: put `b.amount - a.amount` back, unguarded, and this goes red — `zz` sorts first on
    // its bigger integer instead of last on its id.
    // ══════════════════════════════════════════════════════════════════════════
    const mixed: readonly DoNothingOutcome[] = [
      { kind: 'ROLE_OPEN', subject: 'zz', amount: minor(9_999), unit: 'MINOR', provenance: 'FACT', band: null },
      { kind: 'ROLE_OPEN', subject: 'aa', amount: minor(2), unit: 'COUNT', provenance: 'FACT', band: null },
    ];
    expect(orderOutcomes(mixed).map((o) => o.subject)).toEqual(['aa', 'zz']);
    // And with the units agreeing, the amount still decides — the fallback is narrowed, not removed.
    const same: readonly DoNothingOutcome[] = [
      { kind: 'ROLE_OPEN', subject: 'zz', amount: minor(2), unit: 'COUNT', provenance: 'FACT', band: null },
      { kind: 'ROLE_OPEN', subject: 'aa', amount: minor(4), unit: 'COUNT', provenance: 'FACT', band: null },
    ];
    expect(orderOutcomes(same).map((o) => o.subject)).toEqual(['aa', 'zz']);
  });
});

describe('★ 6. `build {HULL}` publishes two goods in two fields, never their sum', () => {
  it('puts `ration` in `max_direct_loss` and `fuel` in `max_contingent_liability`, and names both', () => {
    // NON-VACUITY: the two figures must DIFFER, or "did not add them" is indistinguishable from
    // "added them and got lucky". Built from the real fit simulator rather than from literals, so the
    // assertion is about the offer the observation actually publishes.
    const doctrine = CAST_DOCTRINE[0];
    expect(doctrine, 'the cast has no doctrine, so there is no real fit to price').toBeDefined();
    if (doctrine === undefined) return;
    const fit = simulateFit(doctrine.hull, doctrine.modules);
    expect(fit.ok, 'the doctrine lead does not simulate, so its costs are not real').toBe(true);
    if (!fit.ok) return;
    const { costFrame, costFuel } = fit.value;
    expect(costFrame, 'a hull with no frame cost cannot distinguish the two fields').toBeGreaterThan(0);
    expect(costFuel, 'a hull with no fuel cost cannot distinguish the two fields').toBeGreaterThan(0);
    expect(costFrame, 'the two goods are equal in this fit, so the sum would be invisible').not.toBe(costFuel);

    const offer = hullOfferFor({
      system: 'sys-26' as SystemId,
      hull: doctrine.hull,
      modules: doctrine.modules,
      frame: costFrame,
      fuel: costFuel,
      readyAtTick: 100,
      wrecks: 0,
    });
    expect(
      offer.max_direct_loss,
      'the published worst case is not the `ration` cost. If it equals frame + fuel it is a quantity ' +
        'of nothing: `fuel` is FRONTIER-only and not substitutable for `ration` at any published price',
    ).toBe(costFrame);
    expect(offer.max_contingent_liability, 'the `fuel` cost is not published on its own field').toBe(costFuel);
    expect(offer.max_direct_loss).not.toBe(costFrame + costFuel);
    // A2: the prose has to name which field is which, or the split is legible only from the source.
    expect(offer.what_it_forecloses).toContain(`${String(costFrame)} ration (max_direct_loss)`);
    expect(offer.what_it_forecloses).toContain(`${String(costFuel)} fuel (max_contingent_liability`);
  });
});

describe('★ 8. `holding.upkeep_due` is the CURRENCY half, and the goods half is published', () => {
  it('reports the Charge in goods, with its good named, and 0 currency because there is none', () => {
    // The failure being ruled out is the quiet one: a claimant reading `holding` and seeing `0`.
    // `api/observe.ts` publishes `upkeep_due` / `upkeep_due_qty` / `upkeep_good`; this asserts the
    // canonical builder now publishes the same three keys with the same meanings, because two
    // observation builders disagreeing about one key is HARD RULE 4 inside one payload.
    const f = fixture();
    const owed = qty(4_000);
    const built = buildObservation(sourcesFor(f, { upkeepOwed: () => owed }), ALICE);
    const holding = built.observation.holding;
    expect(holding.upkeep_due, 'the currency half must be 0: §6.3 upkeep has no currency leg').toBe(0);
    expect(
      holding.upkeep_due_qty,
      'the goods half is not published, so a claimant three misses from a lapsed claim reads "nothing owed"',
    ).toBe(owed);
    expect(holding.upkeep_good, 'the good is not named, so the quantity is unitless').toBe(CHARGE_GOOD);
    expect(holding.upkeep_due).not.toBe(holding.upkeep_due_qty);
  });
});

describe('★ 9. `BY_EXPOSURE` has a SCALE, so 450 of peril is not a 451x share', () => {
  it('weighs `LEVY_EXPOSURE_UNIT + exposure`, which is the mirror of the inverse rule', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THIS TEST FAILS ON MASTER**, and the number in it is the one measured on `g07` R5: `p:sable`
    // carried EXPOSURE 450 against five members at 0, and `1 + exposure` assessed it **118,449 of
    // 120,000** while it held 38,932 units of the levy good. `levyShort` went 0 → 9,847 on that row.
    //
    // The assertion is not "the exposed pay more" — that was already true and is the bug's own
    // symptom. It is that the share is **proportional**: at `UNIT + e` a member with 450 of peril
    // carries 1.45x an unexposed member's weight, not 451x. Written as a bound on the RATIO so it
    // does not become a restatement of the formula.
    //
    // MUTATION: back to `1 + Math.max(0, subject.exposure)` and the ratio is 451 — red on the bound.
    // ══════════════════════════════════════════════════════════════════════════
    const safe = subject('p:safe', { exposure: 0 });
    const exposed = subject('p:exposed', { exposure: 450 });
    const ratio = weightOf('BY_EXPOSURE', exposed) / weightOf('BY_EXPOSURE', safe);
    expect(ratio, 'the exposed member is not weighed above the safe one at all').toBeGreaterThan(1);
    expect(
      ratio,
      '450 MINOR of peril buys a share this large, which is the `1 + exposure` bug: the base is a ' +
        'CARDINALITY standing against a MINOR quantity, so the rule has no scale and the single most ' +
        'exposed member pays nearly the whole tribute over a rounding error of risk',
    ).toBeLessThan(2);

    // And it is the exact mirror of the published default, which is the argument for the constant:
    // `UNIT + e` against `NUM / (UNIT + e)` — one scale, two directions.
    expect(weightOf('BY_EXPOSURE', safe)).toBe(LEVY_EXPOSURE_UNIT);
    expect(weightOf('INVERSE_EXPOSURE', safe)).toBe(
      Math.trunc(LEVY_INVERSE_WEIGHT_NUM / LEVY_EXPOSURE_UNIT),
    );
    expect(weightOf('BY_EXPOSURE', exposed)).toBe(LEVY_EXPOSURE_UNIT + 450);
    expect(weightOf('INVERSE_EXPOSURE', exposed)).toBe(
      Math.trunc(LEVY_INVERSE_WEIGHT_NUM / (LEVY_EXPOSURE_UNIT + 450)),
    );
    // Never zero, at any EXPOSURE: the Levy has no exemptions.
    expect(weightOf('INVERSE_EXPOSURE', subject('p:huge', { exposure: 10 ** 12 }))).toBeGreaterThanOrEqual(1);
  });

  it('recomputes every historical docket IDENTICALLY, because EXPOSURE was zero for everyone', () => {
    // The `RULES_VERSION` 16 divergence claim, executable. `largestRemainder` over equal weights gives
    // the same shares whether every weight is 1 or every weight is 1,000 — so a world in which no
    // principal ever staked recomputes bit-identically under the new scale, and the live record costs
    // nothing. If this is red, the deploy needs a divergence tick for every `BY_EXPOSURE` docket ever
    // settled rather than none.
    const under = (weight: number): readonly number[] =>
      largestRemainder(minor(20_002), [weight, weight, weight]);
    expect(under(LEVY_EXPOSURE_UNIT)).toEqual(under(1));
    // And not vacuous: the shares are not all equal, so the remainder rule was exercised.
    expect(new Set(under(1)).size).toBeGreaterThan(1);
  });
});
