/**
 * ★ **THREE OF THE LEVY'S FOUR ALLOCATION RULES WERE DECORATION, AND THIS FILE IS THE ASSERTION.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHY THIS FILE EXISTS.** §5.2 gives a constellation four ways to bear its tribute and calls the
 * vote *"the drama"*. `D30` measured what the vote actually did: **EXPOSURE was identically zero for
 * every principal at every phase of every Reckoning**, in a world with 101 live ventures, so
 * `weightOf` returned the same weight to everybody under `BY_EXPOSURE`, `EVEN` **and the published
 * default `INVERSE_EXPOSURE`** — flat on **18 of 18 dockets**. Only `BY_STORES` discriminated. A
 * goods-rich member "voting `BY_EXPOSURE`" was voting *flat*; it was simply the first flat rule
 * `ballotFor` reaches in `LEVY_RULES` order.
 *
 * That is the tenth appearance of this project's defining defect one remove out — **a rule that
 * exists and never discriminates is indistinguishable from a rule that is not there** — and one of
 * the two inert ones is the default that applies on quorum failure.
 *
 * ── AND THE ROOT CAUSE HAD A SECOND HALF NOBODY HAD LOOKED FOR ───────────────
 *
 * `D30` named the cause as *"the heuristic cast passes `stake: 0` on every `fill_role`"*. True, and
 * only half: §3 says EXPOSURE is created by a venture role stake, a raid stake or a `join` stake, and
 * the venture role stake is `venture/settlement.ts:lockFillStake` — implemented, documented with §7.3
 * quoted above it, unit-tested in `test/venture/invariants.test.ts`, and **called from nowhere in
 * `src/`.** So a non-zero `stake` was only ever a tiebreak in `canonicalRequestOrder`. The eleventh
 * appearance, nested inside the tenth, and CLAUDE.md's corollary exactly: *a negative claim from one
 * grep spelling is only as strong as the spelling.*
 *
 * ── WHAT THIS FILE ASSERTS, AND WHY IT IS NOT "EXPOSURE IS NON-ZERO" ─────────
 *
 * A test that checked EXPOSURE > 0 would pass with **every principal exposed by the same amount**,
 * which is the defect exactly: three rules still agreeing. So the assertion is on the **dockets**:
 * for a real docket from an aged world, `allocate()` under the four rules must produce four
 * **different** amount vectors, pairwise. That is the only claim that cannot be satisfied by a rule
 * that does not discriminate.
 *
 * Non-vacuity is checked first and in two places, because both are properties of the *world* rather
 * than of this file: that any docket was minted at all, and that at least one docket has two
 * unfloored, unspared members whose EXPOSURE actually **differs**. Under equal exposures all three
 * exposure-shaped rules are flat *correctly*, so a world without spread would make the pairwise
 * assertion a coin toss rather than a test.
 *
 * ── ★ AND THE THIRD TEST HAS BEEN INVERTED (`RULES_VERSION` 17) ───────────────
 *
 * It used to **pin the trough**: `12 of 129 dockets` saw spread and it asserted that not every docket
 * did, on purpose, so that an improvement would go red instead of passing silently. The improvement
 * arrived. §5.2's two exposure rules now read a **per-Reckoning EXPOSURE high-water mark** rather than
 * the instantaneous figure at `LEVY_ASSESS_PHASE`, and that test is now a **paired control** on one
 * world: the mark must discriminate on strictly more dockets than the instant, with a two-thirds
 * floor. Read it for the measurement and for what to check when it goes red.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import { phaseOfReckoning, reckoningIndex, setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { ConstellationId, PrincipalId } from '../../src/core/types.js';
import type { Minor } from '../../src/core/units.js';
import { principalPosition, storesAccount } from '../../src/ledger/index.js';
import {
  allocate,
  isNewcomer,
  LEVY_RULES,
  weightOf,
  type LevyRule,
  type LevySubject,
} from '../../src/levy/index.js';
import { Runtime } from '../../src/sim/runtime.js';

/** One docket as the rule saw it: the constellation, the total, and the subjects it allocated over. */
interface Docket {
  readonly reckoning: number;
  readonly constellation: ConstellationId;
  readonly rule: LevyRule;
  readonly total: number;
  readonly spared: PrincipalId | null;
  /** The engine's own subjects, read at the tick the assessment was minted. */
  readonly subjects: readonly LevySubject[];
  /**
   * ★ The **instantaneous** EXPOSURE of every subject at that same tick — the reading the rule used
   * before `RULES_VERSION` 17, captured here so the third test can compare the two readings **on one
   * world**.
   *
   * This is what makes the inverted tripwire a control rather than an assertion about a remembered
   * number: a change that pointed `weightOf` back at the instant, or that quietly stopped the
   * sampler, goes red on the *same* dockets rather than on some later sweep's totals.
   */
  readonly instantExposure: readonly Minor[];
}

/**
 * Age one world with the shipping cast and capture every docket's **inputs** at phase 0.
 *
 * Phase 0 and not settlement, for `aged-solvency.spec.ts`'s reason: that is when the allocation is
 * decided, so it is the only tick at which "what did the rule see" is a question with one answer.
 *
 * ── AND THE THIRD ARGUMENT TO `levySubjectOf` IS THE WHOLE OF `RULES_VERSION` 17 ──
 *
 * `reckoning - 1`, matching `assessLevyNow` exactly. The docket bills the cycle that just **ended**,
 * because phase 0 is one tick after `settleVenture` releases every stake in the world and
 * `reckoning`'s own high-water mark is therefore a tick old here. Passing `reckoning` instead — the
 * default, which is what the ballot and the observation take — would read near-zero for everybody and
 * this fixture would be describing a docket the engine did not cut.
 */
function agedDockets(seed: string, reckonings: number): readonly Docket[] {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size: 8 });
  cast.seat(seed);

  const out: Docket[] = [];
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
    if (phaseOfReckoning(report.tick) !== 0) continue;
    const reckoning = reckoningIndex(report.tick);
    for (const plan of runtime.levy.plansIn(reckoning)) {
      out.push({
        reckoning,
        constellation: plan.constellation,
        rule: plan.rule,
        total: plan.total,
        spared: plan.spared,
        subjects: plan.lines.map((line) => runtime.levySubjectOf(line.principal, report.tick, reckoning - 1)),
        instantExposure: plan.lines.map(
          (line) =>
            principalPosition(runtime.ledger, line.principal, storesAccount(line.principal)).exposure,
        ),
      });
    }
  }
  return out;
}

/** The amounts one rule would assess on this docket, in the plan's own line order. */
function amountsUnder(docket: Docket, rule: LevyRule): readonly number[] {
  return allocate({
    constellation: docket.constellation,
    subjects: docket.subjects,
    rule,
    spared: docket.spared,
    byDefault: false,
  }).lines.map((line) => line.amount);
}

/** The members a rule's weight can actually discriminate between: not floored, not spared. */
function pool(docket: Docket): readonly LevySubject[] {
  return docket.subjects.filter((s) => !isNewcomer(s) && s.principal !== docket.spared);
}

describe('★ the vote has four levers, not one', () => {
  // Two seeds pooled, and the reason has **changed** with `RULES_VERSION` 17 — kept because the old
  // reason is the finding. It used to read: *"the subject of this file is rare and one seed is a coin
  // toss about whether it occurs"*, and `g07`/`g08` were picked as the two gate seeds carrying the
  // most spread at phase 0 (4 and 3 dockets of 12). With the high-water mark the subject is no longer
  // rare — 37 of 40 weighable dockets across all eight seeds — so one seed would now do. Two are kept
  // because the third test's paired comparison wants a population rather than a handful, and because
  // a seed pair that was chosen for being *favourable to the old reading* is the least flattering
  // sample this change could be measured on.
  const dockets = [...agedDockets('g07', 6), ...agedDockets('g08', 6)];

  it('mints dockets whose EXPOSURE actually DIFFERS between members — non-vacuity, first', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **BOTH HALVES ARE PROPERTIES OF THE WORLD, NOT OF THIS FILE.** A world that minted no docket
    // would make every loop below iterate zero times and report green. A world that minted dockets
    // on which every member's EXPOSURE is equal would make the three exposure-shaped rules flat
    // *correctly*, so the pairwise assertion would be testing nothing — and that is precisely the
    // state `D30` found and this change exists to leave.
    //
    // MUTATION: set `CAST_STAKE_BPS` to 0 and this goes red on the second expectation, naming the
    // zero. That is the assertion that distinguishes "the rules discriminate" from "the rules exist".
    // ══════════════════════════════════════════════════════════════════════════
    expect(dockets.length, 'no Levy docket was minted in six Reckonings').toBeGreaterThan(0);

    const spread = dockets.filter((d) => new Set(pool(d).map((s) => s.exposurePeak)).size >= 2);
    expect(
      spread.length,
      `EXPOSURE is equal for every unfloored member on all ${String(dockets.length)} dockets, so ` +
        '`BY_EXPOSURE`, `INVERSE_EXPOSURE` and `EVEN` are all flat and agree — which is `D30` exactly. ' +
        'Σ open max_direct_loss is created by a venture role stake, a raid stake or a `join` stake; if ' +
        'this is red, none of the three is happening.',
    ).toBeGreaterThan(0);
  }, 600_000);

  it('★ allocates FOUR DIFFERENT dockets under the four rules — the whole point', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THIS IS THE ASSERTION THE CHANGE WAS FOR, AND IT IS DELIBERATELY NOT "EXPOSURE > 0".**
    // `weightOf` is `1` under `EVEN`, `1 + exposure` under `BY_EXPOSURE`, `1 + levyGoodHeld` under
    // `BY_STORES` and `NUM / (UNIT + exposure)` under `INVERSE_EXPOSURE`. With EXPOSURE identically
    // zero the first, second and fourth collapse to the same flat vector — `largestRemainder` over
    // equal weights — and the constellation's vote could move nothing but `BY_STORES`.
    //
    // Six pairs, all asserted on the SAME docket, so a rule that discriminates only on some other
    // Reckoning cannot carry the claim. Deliberately compared as amount VECTORS rather than as
    // weights: the weight is intermediate arithmetic and the amount is what a member is billed, and
    // two different weight vectors can normalise to the same docket.
    //
    // MUTATION: `CAST_STAKE_BPS` to 0 → red naming the pair that collapsed. Remove the
    // `lockFillStake` call from `resolveFills` → red the same way, because a stake that is never
    // escrowed creates no `max_direct_loss`.
    // ══════════════════════════════════════════════════════════════════════════
    const candidates = dockets.filter((d) => {
      const p = pool(d);
      return p.length >= 2 && new Set(p.map((s) => s.exposurePeak)).size >= 2;
    });
    expect(candidates.length, 'no docket had two unfloored members with differing EXPOSURE').toBeGreaterThan(0);

    let proven = 0;
    const collapses: string[] = [];
    for (const docket of candidates) {
      const amounts = new Map<LevyRule, readonly number[]>();
      for (const rule of LEVY_RULES) amounts.set(rule, amountsUnder(docket, rule));
      let allDiffer = true;
      for (const a of LEVY_RULES) {
        for (const b of LEVY_RULES) {
          if (a >= b) continue;
          const left = amounts.get(a) ?? [];
          const right = amounts.get(b) ?? [];
          if (JSON.stringify(left) === JSON.stringify(right)) {
            allDiffer = false;
            collapses.push(
              `R${String(docket.reckoning)} ${docket.constellation}: ${a} and ${b} both assess ` +
                `[${left.join(', ')}] — exposures [${pool(docket).map((s) => s.exposurePeak).join(', ')}]`,
            );
          }
        }
      }
      if (allDiffer) proven += 1;
    }

    expect(
      proven,
      'not one docket in five Reckonings allocated differently under all four rules. §5.2 calls the ' +
        'vote "the drama" and a rule that never changes the docket is a rule that is not there. ' +
        `Collapses seen: ${collapses.slice(0, 6).join(' | ')}`,
    ).toBeGreaterThan(0);
  }, 240_000);

  it('★ THE TROUGH IS CLOSED: the mark discriminates where the instant did not — INVERTED', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THIS TEST USED TO ASSERT THE DEFECT, AND ITS OWN MESSAGE SAID WHAT TO DO WHEN IT FLIPPED.**
    //
    // It read `expect(spread.length).toBeLessThan(dockets.length)` with the note: *"every docket now
    // sees EXPOSURE spread. That is BETTER than what this test records ... delete this expectation
    // with the reason."* This is that rewrite, and it is the same inversion `aggression.spec.ts` and
    // `inv22-is-vacuous` got when their subjects arrived — the tripwire is turned around rather than
    // deleted, so the trough coming back is a named failure instead of a silence.
    //
    // ── WHAT THE OLD VERSION RECORDED, KEPT BECAUSE IT IS THE MEASUREMENT ───────
    //
    // The cause was a *schedule*, not a price. `settleVenture` calls `releaseStakes` at the
    // **settlement tick** (§7.4's "encumbrances released last") and `LEVY_ASSESS_PHASE` is **0**, the
    // tick after — and `params.ts` gives three reasons phase 0 must stay where it is. So the docket
    // sampled the one moment every stake in the world had just been handed back. Measured, `g01`, six
    // Reckonings, open stake locks per phase: **phase 0 → 4**, phase 24 → 69, phase 144 → **89**,
    // phase 286 → 92, phase 287 → 6. A **22x trough**, and across the eight gate seeds only **12 of
    // 129 dockets** saw any spread, with three seeds seeing none.
    //
    // ── WHAT IT ASSERTS NOW, AND WHY IT IS A CONTROL RATHER THAN A NUMBER ───────
    //
    // `RULES_VERSION` 17 made `weightOf` read a **per-Reckoning EXPOSURE high-water mark**
    // (`levy/book.ts:exposurePeaks`). The assertion is a **paired comparison on one world**: for the
    // same dockets, at the same ticks, the mark must discriminate on strictly more of them than the
    // instantaneous reading does. That is a claim about the *reading* and nothing else — it cannot be
    // satisfied by a busier cast, a bigger stake or a longer sweep, and it does not depend on any
    // remembered total.
    //
    // The denominator is dockets with **two or more weighable members**, and that is not a
    // convenience: with a pool of one, `largestRemainder(remainder, [w])` is `[remainder]` for every
    // `w`, so all four rules agree by arithmetic and no reading of any quantity can change it.
    // Measured over the eight gate seeds at six Reckonings, 40 of 119 dockets are weighable at all —
    // 19 sit at Reckoning 0, which has no previous cycle to have been exposed in, and the rest hold a
    // singleton constellation or a roll still inside the two-Reckoning newcomer floor. On those 40:
    // **high-water mark 37 (93%), instantaneous 12 (30%)**, and all four rules differ on the same 37.
    //
    // MUTATION: point `weightOf`'s two exposure arms back at an instantaneous reading, or delete the
    // `observeExposurePeaks` call from the OBLIGE handler, and this goes red naming both counts.
    // ══════════════════════════════════════════════════════════════════════════
    const weighable = dockets.filter((d) => pool(d).length >= 2);
    expect(
      weighable.length,
      'no docket in this sweep had two weighable members, so neither reading could discriminate and ' +
        'the comparison below is vacuous',
    ).toBeGreaterThan(0);

    const distinct = (xs: readonly number[]): number => new Set(xs).size;
    const byMark = weighable.filter((d) => distinct(pool(d).map((s) => s.exposurePeak)) >= 2);
    const byInstant = weighable.filter((d) => {
      const weighed = new Set(pool(d).map((s) => s.principal));
      const instant = d.subjects
        .map((s, i) => (weighed.has(s.principal) ? d.instantExposure[i] : undefined))
        .filter((x): x is Minor => x !== undefined);
      return distinct(instant) >= 2;
    });

    // ★ THE INVERSION. The trough returning makes this red, and so does a sampler that stopped.
    expect(
      byMark.length,
      `the EXPOSURE HIGH-WATER MARK discriminates on ${String(byMark.length)} of ` +
        `${String(weighable.length)} weighable dockets and the INSTANTANEOUS reading on ` +
        `${String(byInstant.length)}. The mark must beat the instant, or the docket is back to ` +
        'sampling the one tick in the cycle when every stake has just been released (`RULES_VERSION` ' +
        '17, `levy/book.ts:exposurePeaks`). Check that `Runtime.observeExposurePeaks` is still called ' +
        'from OBLIGE, that `assessLevyNow` still passes `reckoning - 1`, and that both exposure arms ' +
        'of `weightOf` still read `exposurePeak`.',
    ).toBeGreaterThan(byInstant.length);

    // And a floor on the share, so a world in which the mark won by one docket cannot pass as a fix.
    // Two thirds rather than the measured 93%: the claim is that the reading works, and pinning a
    // percentage from one sweep would make an unrelated cast change look like this regressing.
    expect(
      byMark.length * 3,
      `the mark discriminates on only ${String(byMark.length)} of ${String(weighable.length)} ` +
        'weighable dockets. Under two thirds is the trough half-returned — a schedule change, a ' +
        'shorter retention window, or a cast that stopped staking.',
    ).toBeGreaterThanOrEqual(weighable.length * 2);
  }, 600_000);

  it('ranks the exposed BELOW the safe under `INVERSE_EXPOSURE` and above them under `BY_EXPOSURE`', () => {
    // The direction, not just the difference. Two rules that both discriminate but in the same
    // direction would still leave §5.2 with one lever wearing two names, and `INVERSE_EXPOSURE` is
    // the **published default** — the one that applies when a constellation fails quorum, i.e. the
    // one most agents will be billed under without ever voting.
    const docket = dockets.find((d) => {
      const p = pool(d);
      return p.length >= 2 && new Set(p.map((s) => s.exposurePeak)).size >= 2;
    });
    expect(docket, 'no docket with differing EXPOSURE, so nothing about direction can be asserted').toBeDefined();
    if (docket === undefined) return;

    const p = [...pool(docket)].sort((a, b) => a.exposurePeak - b.exposurePeak);
    const least = p[0];
    const most = p[p.length - 1];
    expect(least).toBeDefined();
    expect(most).toBeDefined();
    if (least === undefined || most === undefined) return;

    expect(
      weightOf('BY_EXPOSURE', most),
      '`BY_EXPOSURE` must weigh the most exposed member above the least',
    ).toBeGreaterThan(weightOf('BY_EXPOSURE', least));
    expect(
      weightOf('INVERSE_EXPOSURE', most),
      '§5.2\'s published default is "allocated inversely to Exposure", so the most exposed member ' +
        'must carry the SMALLER weight — and never zero, because the Levy has no exemptions',
    ).toBeLessThan(weightOf('INVERSE_EXPOSURE', least));
    expect(weightOf('INVERSE_EXPOSURE', most)).toBeGreaterThanOrEqual(1);
  }, 240_000);
});
