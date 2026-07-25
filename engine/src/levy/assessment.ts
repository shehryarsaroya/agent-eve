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

import type { ConstellationId, PrincipalId } from '../core/types.js';
import { minor, type Minor } from '../core/units.js';
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
  /** Free STORES: balance less every open lock. */
  readonly freeStores: Minor;
  /** EXPOSURE — Σ open `max_direct_loss`, and nothing else (§3). */
  readonly exposure: Minor;
}

/**
 * Is this principal inside the newcomer floor?
 *
 * **Both halves**, and `params.ts` argues why at length: read as "either half" the
 * floor is a switch any veteran can flip by spending down before the assessment.
 */
export function isNewcomer(subject: LevySubject): boolean {
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
      return 1 + Math.max(0, subject.exposure);
    case 'BY_STORES':
      return 1 + Math.max(0, subject.freeStores);
    case 'INVERSE_EXPOSURE': {
      const denominator = LEVY_EXPOSURE_UNIT + Math.max(0, subject.exposure);
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

export class LevyArithmeticError extends Error {}

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
      spared: subject.principal === spared,
      weight: 0,
    });
  }
  for (const [i, subject] of pool.entries()) {
    byPrincipal.set(subject.principal, {
      principal: subject.principal,
      amount: shares[i] ?? minor(0),
      newcomerFloored: false,
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
 * Distribute `amount` across `weights` so that the sum is `amount`, exactly.
 *
 * Largest remainder, with the index order as the tie-break — so callers must pass
 * weights in canonical principal order, which {@link allocate} does. `splitByBps`
 * cannot be used here: its weights must sum to 10 000 bps, and converting arbitrary
 * integer weights to bps first is the rounding step this method exists to avoid.
 */
export function largestRemainder(amount: Minor, weights: readonly number[]): readonly Minor[] {
  if (weights.length === 0) {
    if (amount !== 0) {
      throw new LevyArithmeticError(`cannot allocate ${amount} across zero weights`);
    }
    return [];
  }
  if (amount < 0) throw new LevyArithmeticError(`cannot allocate a negative total (${amount})`);

  const totalWeight = weights.reduce<number>((a, b) => a + b, 0);
  if (totalWeight <= 0) throw new LevyArithmeticError('weights must sum to a positive number');

  const scaled = weights.map((w) => {
    const product = amount * w;
    if (!Number.isSafeInteger(product)) {
      // Loud rather than silently imprecise: past 2^53 the division below stops being
      // integer arithmetic, and a value path that has stopped being integral cannot be
      // reconciled at all.
      throw new LevyArithmeticError(`allocation overflow: ${amount} x ${w} leaves safe integer range`);
    }
    return product;
  });

  const base = scaled.map((p) => Math.trunc(p / totalWeight));
  let left = amount - base.reduce<number>((a, b) => a + b, 0);
  const order = scaled
    .map((p, i) => ({ i, remainder: p - Math.trunc(p / totalWeight) * totalWeight }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);

  const out = [...base];
  let cursor = 0;
  while (left > 0) {
    const pick = order[cursor % order.length];
    if (pick === undefined) throw new LevyArithmeticError('unreachable: empty remainder order');
    out[pick.i] = (out[pick.i] ?? 0) + 1;
    left -= 1;
    cursor += 1;
    if (cursor > order.length * 2) {
      throw new LevyArithmeticError('unreachable: remainder distribution failed to converge');
    }
  }

  const check = out.reduce<number>((a, b) => a + b, 0);
  if (check !== amount) {
    throw new LevyArithmeticError(`allocation lost value: allocated ${check}, expected ${amount}`);
  }
  return out.map((n) => minor(n));
}
