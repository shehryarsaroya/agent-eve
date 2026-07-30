/**
 * The assessment. §5.2's two halves, in the order they must happen:
 *
 *   1. **The total is fixed by rule and cannot be dodged** — `Σ duty(p)` over the
 *      constellation's roll, where a duty depends only on the roll and the newcomer
 *      floor. No agent action changes it. *That is the alarm.*
 *   2. **The allocation is a vote** — the total is then borne according to a weight
 *      rule the constellation chose, with one principal possibly spared. *That is the
 *      drama.*
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **INV-24 IS ARITHMETIC, NOT INTENTION: Σ assessments === total, EXACTLY.**
 *
 * "Exactly" is the load-bearing word, and it is why every allocation goes through
 * {@link allocate}'s largest-remainder pass rather than through per-principal
 * rounding. An allocation that summed to one minor unit *more* than the total would
 * put a principal in the sweep for a debt the rule never created — a fabricated debt
 * is the A5′ shape wearing arithmetic, and eight bugs of that shape have shipped in
 * this repo already.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Everything in this file is a pure function of its inputs. The book holds the state;
 * this holds the rule, so a test can compute the published formula independently and
 * compare — which is literally what E2E-8 asks for ("the result is identical to the
 * formula computed independently").
 */

import {
  AllocationError,
  largestRemainder as coreLargestRemainder,
} from '../core/allocate.js';
import type { ConstellationId, PrincipalId } from '../core/types.js';
import { minor, type Minor, type Qty } from '../core/units.js';
import { compareIds } from '../ledger/order.js';
import {
  LEVY_DUTY_PER_PRINCIPAL,
  LEVY_EXPOSURE_UNIT,
  LEVY_INVERSE_WEIGHT_NUM,
  LEVY_NEWCOMER_CAPITAL_MINOR,
  LEVY_NEWCOMER_TENURE_TICKS,
  LEVY_NOMINAL_MINOR,
} from './params.js';

/**
 * How the total is borne. The ballot picks one of these; quorum failure picks
 * {@link PUBLISHED_DEFAULT_RULE}.
 *
 * Four, not free-form per-principal numbers, and that is a legibility decision with
 * teeth: a viewer can read "the constellation voted that the exposed pay" off one
 * word, and an allocation that is a *rule plus a spared name* can be recomputed by
 * anyone from public facts. A free-form ballot would also be un-summable — every
 * ballot would need its own exactness proof, and INV-24 would be checking whether the
 * agents' arithmetic was right rather than whether ours was.
 */
export type LevyRule = 'BY_EXPOSURE' | 'BY_STORES' | 'EVEN' | 'INVERSE_EXPOSURE';

export const LEVY_RULES: readonly LevyRule[] = Object.freeze([
  'BY_EXPOSURE',
  'BY_STORES',
  'EVEN',
  'INVERSE_EXPOSURE',
]);

export function isLevyRule(raw: string): raw is LevyRule {
  return (LEVY_RULES as readonly string[]).includes(raw);
}

/**
 * §5.2's published default: *"allocated inversely to Exposure."*
 *
 * It is also the tie-break when two rules draw the same number of ballots, so a tie
 * is resolved by the published rule rather than by alphabetical accident.
 */
export const PUBLISHED_DEFAULT_RULE: LevyRule = 'INVERSE_EXPOSURE';

/** What the rule needs to know about one principal. Facts, never opinions. */
export interface LevySubject {
  readonly principal: PrincipalId;
  /** Ticks since enrolment, at the assessment tick. */
  readonly tenureTicks: number;
  /**
   * Free STORES **in currency**: the MINOR balance, less every open lock.
   *
   * ── THIS IS THE CAPITAL HALF OF STORES, AND IT IS NOT WHAT `BY_STORES` WEIGHS ──
   *
   * §3's canon entry for STORES is *"assets, inventory, balances"* — one word covering two
   * things — so a field called `freeStores` has to say which. This is the balance. What it is
   * for is the **newcomer floor** (`LEVY_NEWCOMER_CAPITAL_MINOR`, "a principal below a
   * tenure-and-capital threshold") and the `spare` nomination, both of which are questions
   * about capital. It is deliberately **not** the `BY_STORES` weight; see
   * {@link LevySubject.levyGoodHeld} for the unit bug that was.
   */
  readonly freeStores: Minor;
  /**
   * ★ Units of the **levy good** this principal can actually hand over — the inventory half of
   * STORES, and the weight `BY_STORES` is computed from.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THE POOL THE PAYMENT DRAWS ON IS THE POOL THE WEIGHT IS MEASURED FROM.** This is the same
   * figure `levyGoodAvailable` publishes and the same one `SweepPort.availableOf` reaches for:
   * unpledged, AVAILABLE lots of {@link LEVY_GOOD} in STORES. Not a second reading of "what do
   * you hold" — `owingOf`, `deliveryFault`, the sweep and now the weight all resolve to one.
   *
   * ── WHY IT IS NOT `freeStores`, WHICH IS WHAT IT USED TO BE ─────────────────
   *
   * `weightOf('BY_STORES')` read the **currency** balance while the obligation is payable
   * *"only in located goods"* (§5.2). Two consequences, both measured on `balance-gate --seeds-from
   * g --reckonings 6`, seeds `g07`/`g08`:
   *
   *   1. **The duty was anti-correlated with the ability to pay it.** `p:halcyon` held **0** units
   *      of the levy good and 207,764 in currency, and was assessed **36,374** of its
   *      constellation's 120,000 — the largest share on the docket. `p:vex`, holding **76,565**
   *      units, was assessed 500. The member that could pay was spared; the member that could not
   *      bore the most.
   *   2. **The duty grew every Reckoning while the income that pays it did not.** Currency
   *      accumulates monotonically for anyone who earns and does not spend, so halcyon's weight
   *      climbed 180,481 → 195,916 → 207,764 across R3–R5 against a fixed goods income of 11,520
   *      a Reckoning. `LEVY SHORT` went 0 · 0 · 0 · 0 · 8,615 · 28,622 · 40,729 and plateaued —
   *      and every one of those minor units was recorded against a principal that had delivered
   *      its whole non-escrowable share by hand every single Reckoning (`presenceOwed` 0 on every
   *      red row, 47 `deliver` calls).
   *
   * It was also the rules surface lying, which is scar #1's class: the `vote` affordance says
   * `BY_STORES` loads the total *"onto whoever is holding most"*, in the same observation that
   * says the Levy is payable only in goods. An agent reading that sentence and looking at its
   * warehouse read it correctly; the engine did not.
   *
   * Measured in the same unit as the payment, the rule is self-correcting instead: a principal
   * with nothing to give is weighted 1 and a full warehouse is what gets taxed, so a constellation
   * voting `BY_STORES` is voting to soak the goods-rich — which is what the words say, is politics
   * §5.2 wants, and cannot assess anybody a quantity of a good it has no route to.
   *
   * ── WHAT THIS DOES **NOT** FIX, AND MUST NOT BE READ AS FIXING ──────────────
   *
   * A constellation whose members crowd onto few systems is short whatever the vote does: goods
   * income is Σ over *occupied systems* (`YIELD_PER_TICK`, "the yield belongs to the place") while
   * duty is Σ over *principals* (`LEVY_DUTY_PER_PRINCIPAL`, "additive in principals"). Both cite
   * A15. In `g07` con-1 holds 6 principals on 3 systems: 86,400 income against 120,000 duty. That
   * residue is a §10 calibration decision and is recorded in
   * `test/levy/aged-solvency.spec.ts`, not here.
   * ══════════════════════════════════════════════════════════════════════════
   */
  readonly levyGoodHeld: Qty;
  /**
   * ★ The **EXPOSURE high-water mark of one Reckoning** — the largest Σ open `max_direct_loss`
   * this principal carried at any tick of the cycle the allocation is measuring.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **NOT EXPOSURE ITSELF, AND THE DIFFERENCE IS THE WHOLE OF `RULES_VERSION` 17.** §3 defines
   * EXPOSURE as *"Σ of your open `max_direct_loss`, and nothing else"* and this field is not a
   * second meaning of that word: it is a **statistic over** it, named for the statistic, and
   * `Book.exposurePeaks` is its one home.
   *
   * The instantaneous reading this replaced sampled `LEVY_ASSESS_PHASE` — phase **0** — one tick
   * after `settleVenture` released every stake in the world. A **22x trough** (`g01`: 4 open stake
   * locks at phase 0 against 92 at phase 286), which left `BY_EXPOSURE`, `EVEN` and the published
   * default `INVERSE_EXPOSURE` agreeing on **117 of 129 dockets** — three of eight seeds saw no
   * spread at all. The rule asks *how exposed were you this cycle*; the value at the one tick when
   * every stake has just been handed back answers nothing.
   *
   * Which cycle is **the caller's** to state, and the two callers state different ones on purpose:
   *
   *   - the **assessment** at phase 0 of Reckoning R reads R−1's *completed* mark, because the
   *     docket bills you for the cycle that just ended;
   *   - the **ballot** and the **observation** read the cycle in progress, because that is the
   *     figure the *next* docket will read and the one a voter can still change.
   *
   * `Runtime.levySubjectOf` takes the Reckoning as a parameter so there is one formula and one
   * named exception rather than two subject readers, which would be two arithmetics for the number
   * a principal is billed on.
   * ══════════════════════════════════════════════════════════════════════════
   */
  readonly exposurePeak: Minor;
}

/**
 * Is this principal inside the newcomer floor?
 *
 * **Both halves**, and `params.ts` argues why at length: read as "either half" the
 * floor is a switch any veteran can flip by spending down before the assessment.
 */
export function isNewcomer(subject: Pick<LevySubject, 'tenureTicks' | 'freeStores'>): boolean {
  return (
    subject.tenureTicks < LEVY_NEWCOMER_TENURE_TICKS &&
    subject.freeStores < LEVY_NEWCOMER_CAPITAL_MINOR
  );
}

/**
 * One principal's rule-fixed duty — the thing the total is the sum of.
 *
 * Deliberately **not** a share of a pot (A15). An extra identity adds its own duty and
 * lowers nobody else's, so identities buy no relief; the only ways to move burden are
 * the vote and delivery, and delivery costs produced goods and physical presence.
 */
export function dutyOf(subject: LevySubject): Minor {
  return isNewcomer(subject) ? LEVY_NOMINAL_MINOR : LEVY_DUTY_PER_PRINCIPAL;
}

/**
 * The constellation's total obligation. Fixed by rule; cannot be dodged.
 *
 * A principal cannot leave the roll (identity is never deleted, A10), cannot lower its
 * tenure, and lowering its capital only floors it if it is *also* new — so nothing an
 * agent does between one Reckoning and the next reduces this number. What the vote
 * moves is who bears it.
 */
export function totalFor(subjects: readonly LevySubject[]): Minor {
  let total = 0;
  for (const subject of subjects) total += dutyOf(subject);
  return minor(total);
}

/**
 * The weight one principal carries under a rule. Integers, always ≥ 1.
 *
 * A zero weight would be an exemption, and the Levy has none — the most exposed
 * principal under `INVERSE_EXPOSURE` pays *less*, never nothing.
 */
export function weightOf(rule: LevyRule, subject: LevySubject): number {
  switch (rule) {
    case 'EVEN':
      return 1;
    case 'BY_EXPOSURE':
      // ── ★ `LEVY_EXPOSURE_UNIT`, NOT `1`, AND THE FIRST WORLD WITH REAL EXPOSURE FOUND OUT WHY ──
      //
      // ══════════════════════════════════════════════════════════════════════════
      // **THIS RULE HAD NEVER RUN AGAINST A NON-ZERO EXPOSURE, AND THE FIRST TIME IT DID IT BILLED
      // ONE MEMBER 98.9% OF ITS CONSTELLATION'S TRIBUTE OVER 450 MINOR OF PERIL.**
      //
      // Measured, seed `g07`, Reckoning 5, `BY_EXPOSURE`, total 120,000 across six members: `p:sable`
      // carried EXPOSURE **450** and everybody else 0. At `1 + exposure` the weights are `451` against
      // five `1`s, so sable was assessed **118,449** while holding 38,932 units of the levy good — and
      // `levyShort` went from 0 to 9,847 on that one row. Nobody voted for that. The five members that
      // chose the rule were choosing a *flat* docket, because on every previous docket in this
      // project's history EXPOSURE was identically zero (`D30`) and `1 + 0` is `1` for everyone.
      //
      // The bug is that the `1` is a **unit** standing against a MINOR quantity, so the rule had no
      // scale: any exposure at all dwarfs the base and the single most exposed member pays nearly
      // everything. `BY_STORES` gets away with `1 + levyGoodHeld` because every member holds tens of
      // thousands of the good, so the `1` is noise and the rule is proportional. This one is not.
      //
      // {@link LEVY_EXPOSURE_UNIT} is the constant that already exists for exactly this and it is
      // already in the *other* exposure rule: `INVERSE_EXPOSURE` is `NUM / (UNIT + exposure)`, and its
      // declaration says the UNIT is there *"so that a zero-EXPOSURE principal has a finite weight"*.
      // §5.2 presents the two as opposites, and opposites have to be on one scale — the engine had
      // them on two. With the UNIT here the pair are exact mirrors: `UNIT + e` against
      // `NUM / (UNIT + e)`. Monotone in EXPOSURE, never zero (the Levy has no exemptions), and now
      // *proportional*: 450 of peril buys a 1.45x share rather than a 451x one.
      //
      // **It recomputes bit-identically for every docket ever settled.** `largestRemainder` over equal
      // weights gives the same shares whether every weight is `1` or every weight is `1000`, and every
      // docket in this world's history had EXPOSURE 0 for every member. So this is a real balance
      // change that costs the live record nothing.
      //
      // ── ★ AND IT READS THE CYCLE'S HIGH-WATER MARK, NOT THE INSTANT (`RULES_VERSION` 17) ──
      //
      // With `subject.exposure` — the value at the tick the docket was minted — this arm and
      // `INVERSE_EXPOSURE` below were flat on 117 of 129 dockets, because `LEVY_ASSESS_PHASE` is the
      // tick after `settleVenture` releases every stake. `LevySubject.exposurePeak` carries the
      // measurement and the argument.
      // ══════════════════════════════════════════════════════════════════════════
      return LEVY_EXPOSURE_UNIT + Math.max(0, subject.exposurePeak);
    case 'BY_STORES':
      // The INVENTORY half of STORES, never the balance. `levyGoodHeld` carries the whole
      // argument and the measurement; the one-line version is that a goods obligation weighted
      // by a currency balance can assess a principal more of a good than any route can get it.
      return 1 + Math.max(0, subject.levyGoodHeld);
    case 'INVERSE_EXPOSURE': {
      // The exact mirror of `BY_EXPOSURE` above, on the same reading (`RULES_VERSION` 17): §5.2
      // presents the two as opposites, and opposites have to be the same quantity measured the same
      // way. This is also the **published default**, so it is the arm most principals are billed
      // under without ever voting — and the arm whose flatness was hardest to notice.
      const denominator = LEVY_EXPOSURE_UNIT + Math.max(0, subject.exposurePeak);
      return Math.max(1, Math.trunc(LEVY_INVERSE_WEIGHT_NUM / denominator));
    }
  }
}

/** One line of an allocation: what this principal owes, and why that number. */
export interface Allocation {
  readonly principal: PrincipalId;
  readonly amount: Minor;
  /** True iff the newcomer floor was applied. Recorded, never re-derived (INV-24). */
  readonly newcomerFloored: boolean;
  /**
   * The raw inputs the floor decision was made from, carried so INV-24 can recompute
   * `isNewcomer` INDEPENDENTLY rather than trusting `newcomerFloored`.
   *
   * A completeness witness derived from the field it checks is a tautology — the seal
   * book shipped exactly that bug, and a verifier caught this one recurring here: with
   * `floorEligible` built from `newcomerFloored`, INV-24's "floored the wrong principal"
   * clauses could never fire. These two fields are the independent source that makes the
   * check real.
   */
  readonly tenureTicks: number;
  readonly freeStores: Minor;
  /** True iff the constellation voted to spare this principal down to the nominal rate. */
  readonly spared: boolean;
  /** The weight it carried in the remainder pool. Zero for a floored or spared line. */
  readonly weight: number;
}

export interface AllocationPlan {
  readonly constellation: ConstellationId;
  readonly total: Minor;
  readonly rule: LevyRule;
  readonly spared: PrincipalId | null;
  readonly lines: readonly Allocation[];
  /** True when quorum failed and the published default was applied (§5.2). */
  readonly byDefault: boolean;
}

/**
 * A Levy allocation that could not be made exactly.
 *
 * Extends {@link AllocationError} since `RULES_VERSION` 38, when the allocator moved to `core/`: a
 * caller that catches the general shape now catches the Levy's too, and a caller that names the Levy
 * specifically — every test in `test/levy/` does — is unaffected. {@link largestRemainder} below
 * translates, so the class a Levy allocation throws is unchanged.
 */
export class LevyArithmeticError extends AllocationError {}

/**
 * Allocate a total across subjects under a rule, exactly.
 *
 * The shape, and each clause is a §5.2 sentence rather than a preference:
 *
 *   - **Floored principals are assessed exactly the nominal rate** and take no part in
 *     the remainder pool. `checkInv24` halts on a floored principal assessed above the
 *     nominal rate, so this is the protection made structural rather than checked.
 *   - **A spared principal is treated identically** to a floored one for the money, and
 *     differently in the record: `spared` and `newcomerFloored` are separate columns
 *     because "the group chose to relieve you" and "the rules protect you" are two
 *     facts, and a viewer reading the docket is owed the difference.
 *   - **The remainder is the whole of the rest**, distributed by weight with the
 *     largest-remainder method and a canonical tie-break. Σ is exact by construction
 *     and asserted before returning.
 *   - **If nobody is left in the pool**, the remainder has nowhere to go that would not
 *     break a protection, so the total is reduced to what the protections allow.
 *     Read {@link relievedTotal} — this is the one place the total moves, it moves
 *     *down*, and it moves by rule.
 */
export function allocate(args: {
  readonly constellation: ConstellationId;
  readonly subjects: readonly LevySubject[];
  readonly rule: LevyRule;
  readonly spared: PrincipalId | null;
  readonly byDefault: boolean;
}): AllocationPlan {
  const subjects = [...args.subjects].sort((a, b) => compareIds(a.principal, b.principal));
  const floored = new Set<PrincipalId>();
  for (const subject of subjects) if (isNewcomer(subject)) floored.add(subject.principal);

  // A spared principal that is already floored is not spared twice: the nominal rate is
  // the nominal rate, and recording both would double-count the relief in the total.
  const spared =
    args.spared !== null && !floored.has(args.spared) && subjects.some((s) => s.principal === args.spared)
      ? args.spared
      : null;

  const relieved = new Set<PrincipalId>([...floored, ...(spared === null ? [] : [spared])]);
  const pool = subjects.filter((s) => !relieved.has(s.principal));
  const total = relievedTotal(subjects, relieved);
  const nominalPart = LEVY_NOMINAL_MINOR * relieved.size;
  const remainder = minor(total - nominalPart);

  const weights = pool.map((s) => weightOf(args.rule, s));
  const shares = largestRemainder(remainder, weights);

  const byPrincipal = new Map<PrincipalId, Allocation>();
  for (const subject of subjects) {
    if (!relieved.has(subject.principal)) continue;
    byPrincipal.set(subject.principal, {
      principal: subject.principal,
      amount: LEVY_NOMINAL_MINOR,
      newcomerFloored: floored.has(subject.principal),
      tenureTicks: subject.tenureTicks,
      freeStores: subject.freeStores,
      spared: subject.principal === spared,
      weight: 0,
    });
  }
  for (const [i, subject] of pool.entries()) {
    byPrincipal.set(subject.principal, {
      principal: subject.principal,
      amount: shares[i] ?? minor(0),
      newcomerFloored: false,
      tenureTicks: subject.tenureTicks,
      freeStores: subject.freeStores,
      spared: false,
      weight: weights[i] ?? 0,
    });
  }

  const lines = subjects
    .map((s) => byPrincipal.get(s.principal))
    .filter((line): line is Allocation => line !== undefined);

  const summed = lines.reduce<number>((acc, line) => acc + line.amount, 0);
  if (summed !== total) {
    // Never reachable through `largestRemainder`, which asserts its own sum. Kept
    // because INV-24 is the invariant this function exists to satisfy, and a
    // constructor that cannot be trusted to satisfy it should say so here rather than
    // let ASSERT halt a world over arithmetic that was wrong before it left this file.
    throw new LevyArithmeticError(
      `allocation for ${args.constellation} sums to ${summed}, not ${total}; INV-24 would halt the tick`,
    );
  }

  return {
    constellation: args.constellation,
    total,
    rule: args.rule,
    spared,
    lines,
    byDefault: args.byDefault,
  };
}

/**
 * The total, after the protections have taken what they must.
 *
 * Ordinarily this is `Σ duty` unchanged: the relieved principals' duties are already
 * the nominal rate (a newcomer's duty *is* nominal), so nothing moves. It differs in
 * exactly two situations, and both are the protections biting:
 *
 *   - **A spared principal**, whose ordinary duty was full and is now nominal. Its
 *     relief is redistributed, so the total is unchanged and this function still
 *     returns `Σ duty` — the relief is funded, which is what makes the vote a
 *     *redistribution* rather than a discount.
 *   - **Nobody left in the pool** — every principal in the constellation is floored or
 *     spared. Then there is no one the relief can be redistributed to, and the choice
 *     is between breaking a protection and reducing the total. §5.2 makes the
 *     protections unconditional ("never identity, never the holding, never standing"
 *     and "a newcomer ... is assessed at a nominal rate"), so the total gives way:
 *     it becomes `nominal × roll`. Night one of a constellation is exactly this case,
 *     and the honest reading is that the world's first day asks nothing but a token of
 *     everyone.
 */
export function relievedTotal(
  subjects: readonly LevySubject[],
  relieved: ReadonlySet<PrincipalId>,
): Minor {
  const pool = subjects.filter((s) => !relieved.has(s.principal));
  if (pool.length === 0) return minor(LEVY_NOMINAL_MINOR * subjects.length);
  return totalFor(subjects);
}

/**
 * Distribute `amount` across `weights` so that the sum is `amount`, exactly — **in `Minor`**.
 *
 * The arithmetic is {@link coreLargestRemainder} in `core/allocate.ts` and has been since
 * `RULES_VERSION` 38; this is the Levy's typed door onto it. Two reasons the door exists rather than
 * every caller importing `core/` directly:
 *
 *   1. **The error class.** A Levy allocation that cannot be made exactly has thrown
 *      {@link LevyArithmeticError} since the first Reckoning, `test/levy/` names it four times, and
 *      changing which class a halt throws is not a refactor. So the general error is translated here
 *      and the message is passed through verbatim.
 *   2. **The unit.** Everything the Levy divides is `Minor`. Stating that once here is what lets
 *      `allocate` below stay free of brand noise.
 *
 * Callers that are *not* the Levy — `world/lode.ts`, `works/book.ts`, `sovereignty/charge.ts` — now
 * import `core/allocate.js` directly and keep their own unit. They used to come through this function
 * and pay for it with `as never`, `as unknown as Minor`, or a `minor()`/`qty()` round trip.
 */
export function largestRemainder(amount: Minor, weights: readonly number[]): readonly Minor[] {
  try {
    return coreLargestRemainder(amount, weights);
  } catch (cause) {
    // Narrow, not blanket: an `AllocationError` is the allocator refusing, and the Levy has always
    // reported that refusal under its own name. Anything else is a bug in `core/` and must not be
    // relabelled as a Levy arithmetic fault.
    if (cause instanceof AllocationError) throw new LevyArithmeticError(cause.message);
    throw cause;
  }
}
