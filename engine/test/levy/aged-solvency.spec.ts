/**
 * ★ **THE LEVY AT SIX RECKONINGS — the regime every balance gate in this repo has missed.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHY THIS FILE EXISTS.** `levyShort` and the count of red tribute lines are the two meters this
 * project treats as the safety gate for *every* change. Both were 0 on every sweep ever published
 * here — and every one of those sweeps ran **900 ticks, about three Reckonings**. At three
 * Reckonings the 50,000-unit enrolment allotment is still paying the tribute
 * (`test/works/aged.ts:ENDOWMENT_WINDOW_RECKONINGS` is 4), so the sweep cannot see whether the
 * economy the world will actually run on is solvent. It was measuring the endowment.
 *
 * Run at six, on the same eight seeds, master goes **`levyShort` 37,237 and 29,806 on `g07`/`g08`
 * with six red tribute lines** — with the ladder working and every member holding a WORKS. Run at
 * nine it is **six of eight seeds**. So the meter had not been green; it had been early.
 *
 * Two separate things were behind it and this file keeps them apart, because one is a defect and
 * the other is a decision:
 *
 *   1. **`BY_STORES` weighted a goods obligation by a CURRENCY balance** — a defect, fixed, and the
 *      first test here is its regression at the aged horizon. `assessment.ts:levyGoodHeld` carries
 *      the measurement. Fixing it takes six Reckonings on all eight seeds to **0 short, 0 red**.
 *   2. **A constellation whose members crowd onto few systems cannot produce its own tribute** — NOT
 *      fixed, and not fixable from the allocation side. It surfaces at **nine** Reckonings (`g01`
 *      87,714, `g03` 9,683 with the fix in) and the second and third tests pin its arithmetic and
 *      its shape, so the question stays on the record instead of being rediscovered by the next
 *      sweep that happens to run one Reckoning longer.
 *
 * **The one-line difference between them.** The first was the world billing the wrong principal; the
 * second is the world billing the right ones for goods that exist but are in somebody else's
 * warehouse. §5.2 already answers the second — 70% of every assessment is escrowable and may be
 * carried by *another* principal's hand — and `deliver {payer}` implements it, no affordance offers
 * it, and `paidOther` is 0 in every world this repo has ever run. So the residue may not be a
 * calibration question at all; it may be the ninth unexercised capability.
 *
 * ── ★ IT WAS. UPDATED AFTER THE MEASUREMENT ─────────────────────────────────
 *
 * `deliver {payer}` reached the affordance list and the cast's decision chain, and the eight-seed
 * nine-Reckoning sweep moved `levyShort` **202,540 → 8,051**, red tribute lines **19/576 → 1/576**,
 * `paidOther` **0 → 163,126**, and **seven of eight seeds spotless** (`D26` + `D27`; the carry alone is
 * 4,639 and 2/576). So the third test below now asserts the *closure* rather than the
 * question, and the second one — the income/duty mismatch — **still stands unchanged**: for a
 * constellation whose own margin is negative (`g07`: 149,760 produced against 160,000 owed)
 * distribution moves goods and cannot make them, which is why `g07` is the one seed still showing a
 * residue. The §10 calibration decision is still open and still the owner's.
 *
 * Two more things the measurement settled, both recorded in `TRACKER.md`:
 *
 *   · **`BY_EXPOSURE` is not unpayable by construction.** On the same dockets, `amount > held` is 5
 *     rows under `BY_EXPOSURE`, 5 under `BY_STORES` and 5 under `EVEN` — no allocation rule changes
 *     payability there. What is true is stranger: **EXPOSURE is identically zero at every phase of
 *     every Reckoning**, so `BY_EXPOSURE`, `EVEN` and the published default `INVERSE_EXPOSURE` hand
 *     every principal the same weight on 18 of 18 dockets and only `BY_STORES` discriminates.
 *   · Which means a goods-rich member "voting `BY_EXPOSURE`" is voting **flat**, not voting that the
 *     exposed should pay. It is simply the first flat rule `ballotFor` reaches in `LEVY_RULES` order.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import {
  isSettlementTick,
  phaseOfReckoning,
  reckoningIndex,
  setSpeed,
  TICKS_PER_RECKONING,
} from '../../src/core/time.js';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import { LEVY_DUTY_PER_PRINCIPAL, type LevyRule } from '../../src/levy/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { tierOf } from '../../src/world/index.js';
import { systemYield } from '../../src/works/params.js';

/** One line of one docket, plus the fact the allocation is supposed to be ABOUT. */
interface Line {
  readonly principal: PrincipalId;
  readonly amount: number;
  readonly floored: boolean;
  readonly spared: boolean;
  /** Units of the levy good to hand **at the tick the assessment was minted**. */
  readonly levyGood: number;
}

interface Docket {
  readonly reckoning: number;
  readonly rule: LevyRule;
  readonly total: number;
  readonly lines: readonly Line[];
}

/**
 * Age one world with the shipping cast and capture every docket at the tick it is minted.
 *
 * Sampled at **phase 0**, not at settlement, because that is when the allocation is decided and
 * therefore the only moment at which "how much of the levy good did this principal hold" is the
 * input the rule actually saw. Goods move all cycle; a settlement-time reading would be a
 * different number and the assertion would be about nothing.
 *
 * Deliberately not `agedWorld()`: that fixture runs the ticks and hands back the finished world,
 * and there is no hook in it for a per-Reckoning sample. Everything else is the same — the real
 * `Runtime`, the real `HeuristicCast`, real invariants asserting every tick.
 */
function agedDockets(
  seed: string,
  reckonings: number,
): {
  readonly runtime: Runtime;
  readonly dockets: readonly Docket[];
  /** `levyShort` per Reckoning, in order. NOT read off `levyReckonings()`, which is a bounded ring. */
  readonly shortByReckoning: readonly number[];
} {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size: 8 });
  cast.seat(seed);

  const dockets: Docket[] = [];
  const shortByReckoning: number[] = [];
  for (let i = 0; i < reckonings * TICKS_PER_RECKONING; i += 1) {
    const next = runtime.engine.tick + 1;
    for (const action of cast.decide(next, seed)) runtime.engine.submit(action);
    const report = runtime.runTick();
    expect(
      report.halted,
      `aged world halted at ${String(report.tick)}: ${report.violations
        .map((v) => `${v.id} ${v.message}`)
        .join(' | ')}`,
    ).toBe(false);

    if (phaseOfReckoning(report.tick) === 0) {
      const reckoning = reckoningIndex(report.tick);
      for (const plan of runtime.levy.plansIn(reckoning)) {
        dockets.push({
          reckoning,
          rule: plan.rule,
          total: plan.total,
          lines: plan.lines.map((line) => ({
            principal: line.principal,
            amount: line.amount,
            floored: line.newcomerFloored,
            spared: line.spared,
            levyGood: runtime.levyGoodAvailable(line.principal),
          })),
        });
      }
    }
    if (isSettlementTick(report.tick)) shortByReckoning.push(runtime.levySettlement?.levyShort ?? -1);
  }
  return { runtime, dockets, shortByReckoning };
}

describe('the Levy in an AGED world — six Reckonings, not three', () => {
  it('★ BY_STORES RANKS BY THE GOOD THE LEVY IS PAID IN, in a real world at the aged horizon', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THE REGRESSION. This test FAILS ON MASTER**, and it is written against readings that exist
    // on both sides — `plan.lines[].amount` and `runtime.levyGoodAvailable()` — so the failure is a
    // named assertion rather than a type error.
    //
    // What master does on `g07`: con-1 votes `BY_STORES` from Reckoning 2 onward, and `p:halcyon`
    // holds **0** units of the levy good while carrying **36,374** of the constellation's 120,000 —
    // the largest share on the docket — because the weight was its CURRENCY balance (207,764).
    // `p:vex`, sitting on 76,565 units it could have handed over that afternoon, was assessed 500.
    // The rule inverted itself: it taxed the warehouse that was empty.
    //
    // The property asserted is the one the rule's own name claims and the one the `vote` affordance
    // publishes — *"BY_STORES onto whoever holds most `ration` to hand"*. Pairwise and weak on
    // purpose: **more goods must never mean a smaller bill.** Ties are allowed (largest-remainder
    // hands single units out by a canonical order, so two equal holdings can differ by one), and
    // floored and spared lines are excluded because their amount is the nominal rate by rule and
    // has nothing to do with any weight.
    //
    // MUTATION: put `subject.freeStores` back in `weightOf`'s `BY_STORES` arm and this goes red on
    // `g07` naming halcyon and vex. Point `levySubjectOf.levyGoodHeld` at `position.free` and it
    // goes red identically — both halves of the fix are load-bearing and both are covered.
    // ══════════════════════════════════════════════════════════════════════════
    // ── ★ SCANNED, NOT PICKED — the second instance of one fragility ─────────
    //
    // This read `agedDockets('g07', 6)` and went red at `RULES_VERSION` 19 with *"no docket in six
    // Reckonings used BY_STORES"* — nothing to do with `BY_STORES`. `HeuristicCast.ballotFor` picks
    // the rule that minimises its own share, so which rule carries is a property of the world, and
    // **any cast edit re-rolls it**. `test/levy/exposure-high-water.spec.ts` had the identical
    // problem and was re-seeded FIVE times in one session before it was scanned instead; this is
    // that fix applied to the second instance rather than a sixth roll of the dice. The seed is now
    // an OUTPUT, named in the failure message, and the test fails only when NO candidate world
    // votes the rule at all — which would be a real finding about the ballot.
    const CANDIDATES = ['g07', 'g01', 'g02', 'g03', 'g04', 'g05', 'g06', 'g08'] as const;
    let chosen: { seed: string; byStores: readonly Docket[] } | null = null;
    const tried: string[] = [];
    for (const seed of CANDIDATES) {
      const found = agedDockets(seed, 6).dockets.filter((d) => d.rule === 'BY_STORES');
      tried.push(`${seed}:${String(found.length)}`);
      if (found.length > 0) {
        chosen = { seed, byStores: found };
        break;
      }
    }
    // Non-vacuity first, and it is not a formality: this whole assertion is about a rule the cast
    // has to actually vote for. A world that never voted it would make every loop below iterate
    // zero times and report green.
    expect(
      chosen,
      `none of ${String(CANDIDATES.length)} seeds voted BY_STORES in six Reckonings, so this test ` +
        `asserts nothing at all. Either the ballot stopped reaching the rule or the cast stopped ` +
        `being able to afford it — do not delete the assertion. Dockets per seed: ${tried.join(' ')}`,
    ).not.toBeNull();
    const byStores = chosen?.byStores ?? [];
    expect(byStores.length).toBeGreaterThan(0);

    for (const docket of byStores) {
      const weighed = docket.lines.filter((l) => !l.floored && !l.spared);
      for (const a of weighed) {
        for (const b of weighed) {
          if (a.levyGood <= b.levyGood) continue;
          expect(
            a.amount,
            `R${String(docket.reckoning)} voted BY_STORES and assessed ${a.principal} ` +
              `${String(a.amount)} on ${String(a.levyGood)} units of the levy good, while ` +
              `${b.principal} was assessed ${String(b.amount)} on only ${String(b.levyGood)}. ` +
              'BY_STORES loads the total onto whoever holds most of the good the Levy is PAID in — ' +
              'if this is red, the weight is reading the currency balance again',
          ).toBeGreaterThanOrEqual(b.amount);
        }
      }
    }

    // And the specific shape that was the bug: nobody holding NOTHING carries the top bill.
    for (const docket of byStores) {
      const weighed = docket.lines.filter((l) => !l.floored && !l.spared);
      if (weighed.length < 2) continue;
      const heaviest = weighed.reduce((x, y) => (y.amount > x.amount ? y : x));
      const anyoneWithGoods = weighed.some((l) => l.levyGood > 0);
      if (!anyoneWithGoods) continue;
      expect(
        heaviest.levyGood,
        `R${String(docket.reckoning)} put the largest BY_STORES assessment (${String(heaviest.amount)}) ` +
          `on ${heaviest.principal}, which holds NO levy good at all, while somebody in the same ` +
          'constellation holds some. That is a goods bill sized by a cash balance',
      ).toBeGreaterThan(0);
    }
  }, 180_000);

  it('★ THE RESIDUE IS STRUCTURAL AND IS A §10 CALIBRATION DECISION, not a bug — pinned', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **READ THIS BEFORE TRYING TO MAKE `levyShort` ZERO AT NINE RECKONINGS.** The `BY_STORES` fix
    // cleared six on all eight seeds, and it could, because at six there is still stock in the
    // constellation and the only thing wrong was *who* was being billed. It does not clear nine, and
    // no allocation rule can: at nine the constellation is producing less than it owes. The
    // arithmetic is three lines:
    //
    //   · goods income is **per PLACE**. `YIELD_PER_TICK` — "a system yields a fixed amount per
    //     tick, and every WORKS standing on it divides that amount ... the yield belongs to the
    //     place". Ten identities on one system extract what one extracts, which is A15.
    //   · the Levy duty is **per PRINCIPAL**. `LEVY_DUTY_PER_PRINCIPAL` — "additive in principals,
    //     never a pot divided among them ... an extra identity adds its own duty and lowers
    //     nobody's", which is also A15.
    //   · and goods **cannot cross a constellation**: `haul` is not live, `graduate` carries stores
    //     strictly outward, a market book is venue-bound. So solvency has to hold constellation by
    //     constellation; a surplus next door is unreachable.
    //
    // Put together: a constellation is solvent only while its members occupy enough DISTINCT
    // systems. Nothing in the rules makes them, and the harness seats the cast with
    // `Runtime.seatInTier`, which is `rng.pick` over the tier with no occupancy term — so about a
    // quarter of seeds pile most of the roll onto one Commons system. That is why it is two seeds
    // in eight rather than none or all.
    //
    // The three ways out are all §10 calibration and none of them belongs in a bug fix: raise
    // `YIELD_PER_TICK`, lower `LEVY_DUTY_PER_PRINCIPAL`, or give the yield a per-WORKS component so
    // a second occupant adds something. `works/params.ts` calibrated the table against a **20,000**
    // Levy and a **sole** occupant, and its own note says "the second occupant of a system makes
    // both of them poorer than the burn, which is the contention the design wants" — true per
    // member, and at the level of a whole constellation it is not contention, it is insolvency,
    // because there is no counterparty who has the goods either.
    //
    // This test therefore asserts the DIAGNOSIS, not a target. It fails if somebody moves either
    // constant without reading the other, which is the outcome worth protecting.
    // ══════════════════════════════════════════════════════════════════════════
    const { runtime } = agedDockets('g07', 6);

    // Which systems the world's WORKS actually stand on, and what each PLACE yields a Reckoning.
    //
    // ══════════════════════════════════════════════════════════════════════════
    // ⚑ **33: THIS SUM READ THE TIER TABLE, WHICH IS THE DEFECT §16.12 #1 EXISTS TO FIX, SITTING IN
    // THE TEST THAT MEASURES THE RESIDUE.** `YIELD_PER_TICK[tierOf(map, system)]` was every system's
    // output when this was written; it is now a tier BASE, and two MARCHES systems differ by up to a
    // quarter. Summing the base over the occupied set therefore answers a question about a world
    // this engine no longer runs — and it answers it *confidently*, which is why it had to be found
    // rather than noticed. `systemYield` is the same figure the PRODUCE phase actually pays out.
    // ══════════════════════════════════════════════════════════════════════════
    const occupied = new Set<SystemId>(runtime.works.liveInOrder().map((w) => w.system));
    let income = 0;
    for (const system of occupied) {
      income += systemYield(runtime.world.map, system) * TICKS_PER_RECKONING;
    }
    const duty = LEVY_DUTY_PER_PRINCIPAL * runtime.world.principalOrder.length;

    // ── THE DIAGNOSIS, RE-READ AT 33 ──────────────────────────────────────────
    //
    // The claim this test protects is a RELATION — *"`g07` produces less of the levy good than its
    // Levy asks for"* — and the relation is what is asserted. The absolute figures moved when the
    // ground stopped being uniform, and they are read from the engine rather than pinned, because a
    // pin here would be a third copy of `YIELD_PER_TICK` maintained by hand.
    expect(occupied.size, 'g07 crowds its principals onto few producing systems').toBeLessThan(
      runtime.world.principalOrder.length,
    );
    expect(duty, 'what the PRINCIPALS owe in a Reckoning').toBe(160_000);
    expect(
      income - duty,
      'g07 produces LESS of the levy good than its Levy asks for. No allocation rule closes a ' +
        'negative margin — see this test\'s note for the three calibration levers, all §10',
    ).toBeLessThan(0);

    // The number of distinct systems is the whole variable: at 8 principals the world needs enough
    // places to clear 160,000. Stated as arithmetic rather than as prose so it moves when the
    // constants do — and at 33 it is a RANGE per tier rather than one number, because the poorest
    // MARCHES ground needs more places than the richest does. That spread is the feature.
    const perTier = (tier: 'COMMONS' | 'MARCHES' | 'FRONTIER'): readonly [number, number] => {
      const ys = runtime.world.map.systemOrder
        .filter((id) => tierOf(runtime.world.map, id) === tier)
        .map((id) => systemYield(runtime.world.map, id));
      return [
        Math.ceil(duty / (Math.max(...ys) * TICKS_PER_RECKONING)),
        Math.ceil(duty / (Math.min(...ys) * TICKS_PER_RECKONING)),
      ];
    };
    expect(perTier('COMMONS'), 'COMMONS is uniform, so its range is a point (A8)').toEqual([7, 7]);
    const [marchesBest, marchesWorst] = perTier('MARCHES');
    expect(marchesBest, 'the richest MARCHES ground needs fewer places').toBeLessThanOrEqual(marchesWorst);
    expect(marchesWorst, 'and even the poorest needs fewer places than the Commons').toBeLessThan(7);
  }, 180_000);

  it('★ THE RESIDUE WAS A DISTRIBUTION FAILURE, AND `deliver {payer}` CLOSED IT', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THIS TEST USED TO ASSERT THE OPPOSITE, AND ITS OWN MESSAGE SAID WHAT TO DO IF IT FLIPPED.**
    // It read `expect(shortByReckoning.slice(6).some(n => n > 0)).toBe(true)` with the note *"if
    // this is green the residue has been fixed — which would be a real result: check whether
    // `deliver {payer}` reached the affordance list."* It reached it. This is that rewrite.
    //
    // What the old version had right: `g01`'s docket is `BY_EXPOSURE`, so **no allocation rule was
    // implicated** — three of its members hold a WORKS on `sys-05` at occupancy 3, yielding
    // `floor(110/3) = 36` a tick, 10,368 a Reckoning against a 23,900 assessment, and all three
    // paid every unit they earned and were still recorded ~13,000 short from Reckoning 6 onward.
    // Meanwhile `p:orrin`, `p:sable` and `p:varrow` sat on 360,000 units of the same good in the
    // same constellation. **The goods existed and were in the wrong warehouse.**
    //
    // What was missing was the door. §5.2 escrows 70% of every assessment and permits that share to
    // be carried by another principal's hand; `deliver {payer}` had implemented it since the Levy
    // landed; no affordance offered it; `paidOther` was 0 in every world this repo had ever run.
    // With the offer on the menu (`api/observe.ts` 5B-ter) and a cast branch that takes it
    // (`heuristic.ts:carryFor`), the eight-seed sweep at nine Reckonings moves:
    //
    //   `levyShort` **202,540 → 8,051** · red tribute lines **19/576 → 1/576** · `carried` **0 →
    //   163,126**, and `g01` itself from **87,714 to 0**. (`D27`, the `spare` pick, is in that figure
    //   and is what clears `g01`'s last 1,275; the carry alone leaves it there.)
    //
    // ── WHAT THIS DOES **NOT** OVERTURN ────────────────────────────────────────
    //
    // The test above it. Income is still Σ over occupied *systems* and duty still Σ over
    // *principals*, and for a constellation whose own margin is negative — `g07`: 149,760 produced
    // against 160,000 owed — distribution cannot manufacture goods, it can only move them. So `g07`
    // is the seed that still shows a residue (3,364 at nine Reckonings, from 80,475), and the §10
    // calibration question the test above pins is **still open and still the owner's to make.** What
    // has been settled is that it was not the *whole* cause, and that most of what was attributed to
    // it was reachable stock.
    //
    // Read on `shortByReckoning`, captured per settlement — NOT on `runtime.levyReckonings()`, which
    // is a `Ring` bounded at `MAX_RECKONING_SUMMARIES` = 8 and silently drops the oldest Reckonings
    // past that. At nine Reckonings that ring is already lying, which is the `Book.prune` hazard
    // living in the instrument instead of the engine; `balance-gate.ts` accumulates the same way
    // now, for the same reason.
    //
    // MUTATION: remove `carryFor` from `decide`'s chain, or the 5B-ter block from `api/observe.ts`,
    // and this goes red on Reckonings 6-8 with the master figures.
    // ══════════════════════════════════════════════════════════════════════════
    const nine = agedDockets('g01', 9);
    expect(nine.shortByReckoning.length, 'nine settlements, nine readings').toBe(9);

    // The first six were spotless before the fix too — the endowment and then the stock were paying.
    // Kept so a horizon change cannot be mistaken for the fix working.
    expect(
      nine.shortByReckoning.slice(0, 6),
      'SIX Reckonings of g01 were spotless on master as well, which is why a six-Reckoning sweep ' +
        'could not see this and nine could',
    ).toEqual([0, 0, 0, 0, 0, 0]);

    // ★ THE REGRESSION. Reckonings 6-8 were ~13,000 each on master and are zero now.
    expect(
      nine.shortByReckoning.slice(6),
      'g01 went short in Reckonings 6-8 on master (87,714 across the run) and the cause was that ' +
        '360,000 units sat in three other members\' warehouses with no verb offered to move them. ' +
        'If this is red, check that `deliver {payer}` is still offered (api/observe.ts 5B-ter), that ' +
        '`carryFor` is still in the cast\'s decision chain, and that MAX_LEVY_CARRY_OFFERS still ' +
        'caps OFFERS rather than rows — that last one is the bug that made the first version of ' +
        'this fix look like it had barely worked',
    ).toEqual([0, 0, 0]);

    // And the mechanism is the reason, not a coincidence: somebody's hand carried somebody else's
    // share. A green `levyShort` with `paidOther` at zero would mean the horizon or a constant moved.
    // A LAST-LOOK read, and deliberately a WEAK one: `Book.prune` keeps
    // `LEVY_RETAINED_RECKONINGS` (3) Reckonings of payment rows, so this sees only the most recent
    // few and undercounts the run. That is the safe direction for a `> 0` assertion and it is said
    // here rather than discovered — `test/levy/carry.spec.ts` does the accumulate-per-settlement
    // version, which is the one that can quote a total.
    let carried = 0;
    for (let r = 0; r < 9; r += 1) {
      for (const plan of nine.runtime.levy.plansIn(r)) {
        for (const line of plan.lines) {
          carried += nine.runtime.levy.paymentOf(r, line.principal).paidOther;
        }
      }
    }
    expect(
      carried,
      'levyShort is clean and NOT ONE UNIT was carried by another principal\'s hand, so something ' +
        'other than the distribution route closed it — read YIELD_PER_TICK and LEVY_DUTY_PER_PRINCIPAL',
    ).toBeGreaterThan(0);
  }, 240_000);
});
