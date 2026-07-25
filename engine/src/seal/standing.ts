/**
 * What a contradicted seal costs, on a **published** schedule (SPEC §11.1,
 * PROP-D3).
 *
 * > "A contradicted seal costs standing. It is a vector in §6.4 alongside
 * > elective performance. Mandatory, free *and* weightless would predict
 * > trivially-true seals and boring reveals — the cost is what makes a seal a
 * > claim worth making."
 *
 * Three things make this a *schedule* rather than a number in a function body:
 *
 * - it is **versioned**, so a change to the cost is visible in the record instead
 *   of retroactively re-pricing seals already judged (INV-15's reasoning);
 * - it is **machine-readable**, because A2 requires known arithmetic to be exact
 *   and machine-readable — an agent must be able to price its own seal before
 *   making it;
 * - it ships with {@link SEAL_STANDING_STATEMENT}, the sentence `agent.md` must
 *   carry **verbatim**. Scar #1: the LLM-facing text, the affordance strings and
 *   the engine are one rules surface, and High Water's worst bug was a semantic
 *   disagreement between them that no unit test could see.
 *
 * ## Standing moves by cause, never as a side effect (INV-21)
 *
 * INV-21 names exactly four causes. This module owns one of them and provides the
 * checker for all four, because a checker that only knows about its own cause
 * cannot tell "nothing else moved" from "something else moved and I could not
 * see it" — which is the shape of every detector-with-a-blind-spot bug in the
 * scar list.
 *
 * A contradicted seal moves **one** vector by **one** step. It is deliberately not
 * a score: §3 says STANDING is "the public factual vectors", never a score, and
 * `Standing.contradictedSeals` is a count with a sample size an underwriter may
 * weight however it likes (§6.4).
 */

import type { InvariantViolation, PrincipalId, SealId, Standing } from '../core/types.js';
import { sealViolation } from './verdict.js';

/**
 * The schedule. `version` is stamped onto every charge so a later change is
 * legible in the record rather than silently re-pricing history.
 */
export const SEAL_STANDING_SCHEDULE = {
  version: 1,
  /** One contradicted seal adds exactly one to the `contradictedSeals` vector. */
  contradictedSealStep: 1,
} as const;

/**
 * The sentence `agent.md` carries verbatim. Exported so the onboarding doc and
 * the engine cannot drift (scar #1) — a test asserts the doc contains it once the
 * doc exists.
 */
export const SEAL_STANDING_STATEMENT =
  'Every seal resolves at its own Reckoning and never again. A seal you honour changes nothing; ' +
  'a seal your deeds contradict adds 1 to your public contradicted-seals count, permanently. ' +
  'You learn HONOURED or CONTRADICTED and nothing else, ever, at any tier, on any delay — never ' +
  "another principal's seal content. You cannot use seals to verify each other.";

/**
 * INV-21's four causes, and no fifth. A standing change with no cause on this
 * list is the invariant firing, not a new feature.
 */
export type StandingCause = 'ELECTIVE_HONOURED' | 'DEFAULT' | 'CONTRADICTED_SEAL' | 'DECAY';

/** The mutable vectors of {@link Standing}. `principal` is not one of them. */
export type StandingVector =
  | 'electiveHonoured'
  | 'electiveHonouredValue'
  | 'defaults'
  | 'contradictedSeals'
  | 'distinctCounterparties'
  | 'lastDefaultTick';

export const STANDING_VECTORS: readonly StandingVector[] = [
  'electiveHonoured',
  'electiveHonouredValue',
  'defaults',
  'contradictedSeals',
  'distinctCounterparties',
  'lastDefaultTick',
];

/**
 * Which vectors each cause is permitted to move.
 *
 * `DECAY` is broad on purpose — §6.4 gives every vector a published recency
 * half-life — and that breadth is exactly why the *other* three are narrow: with
 * decay unauthorised, this table is a tight statement about what a settlement, a
 * default or a seal may touch.
 */
export const VECTORS_BY_CAUSE: Readonly<Record<StandingCause, readonly StandingVector[]>> =
  Object.freeze({
    ELECTIVE_HONOURED: ['electiveHonoured', 'electiveHonouredValue', 'distinctCounterparties'],
    DEFAULT: ['defaults', 'lastDefaultTick'],
    // The whole of this module's authority over standing. One vector.
    CONTRADICTED_SEAL: ['contradictedSeals'],
    DECAY: [
      'electiveHonoured',
      'electiveHonouredValue',
      'defaults',
      'contradictedSeals',
      'distinctCounterparties',
    ],
  } satisfies Record<StandingCause, readonly StandingVector[]>);

/**
 * A standing charge raised by a contradicted seal.
 *
 * Note what is **absent**: the cited deed, the verdict basis, and anything from
 * the intent. Standing is `PUBLIC` (§11.2), so every field here is world-readable
 * — and "which deed the verdict cited" would narrow a sealed intention to that
 * deed's verb and target, which is seal content reaching an agent-readable
 * channel on a fixed lag. That is precisely the cartel-monitoring surface PROP-D2
 * closes. The attributable cause lives on the audit record instead
 * ({@link ../seal/book.ts}).
 */
export interface SealStandingCharge {
  readonly principal: PrincipalId;
  readonly cause: Extract<StandingCause, 'CONTRADICTED_SEAL'>;
  readonly sealId: SealId;
  readonly reckoningIndex: number;
  /** Always {@link SEAL_STANDING_SCHEDULE.contradictedSealStep}. */
  readonly contradictedSealsDelta: number;
  readonly scheduleVersion: number;
}

export function chargeForContradiction(
  principal: PrincipalId,
  sealId: SealId,
  reckoningIndexOfSeal: number,
): SealStandingCharge {
  return Object.freeze({
    principal,
    cause: 'CONTRADICTED_SEAL',
    sealId,
    reckoningIndex: reckoningIndexOfSeal,
    contradictedSealsDelta: SEAL_STANDING_SCHEDULE.contradictedSealStep,
    scheduleVersion: SEAL_STANDING_SCHEDULE.version,
  });
}

/**
 * Apply charges to a standing row. Pure: returns a new row, so INV-21 can be
 * checked by comparing before and after.
 *
 * Only `contradictedSeals` moves. Everything else is copied through, which is the
 * implementation of "never as a side effect of anything else".
 */
export function applySealStandingCharges(
  standing: Standing,
  charges: readonly SealStandingCharge[],
): Standing {
  let contradicted = standing.contradictedSeals;
  for (const charge of charges) {
    if (charge.principal !== standing.principal) {
      // Applying another principal's charge is the double-counting shape of scar
      // #14a, and it would mark the wrong agent. Loud, not lenient.
      throw new Error(
        `charge for ${charge.principal} applied to ${standing.principal}'s standing`,
      );
    }
    contradicted += charge.contradictedSealsDelta;
  }
  return {
    principal: standing.principal,
    electiveHonoured: standing.electiveHonoured,
    electiveHonouredValue: standing.electiveHonouredValue,
    defaults: standing.defaults,
    contradictedSeals: contradicted,
    distinctCounterparties: standing.distinctCounterparties,
    lastDefaultTick: standing.lastDefaultTick,
  };
}

function vectorValue(s: Standing, v: StandingVector): number | null {
  switch (v) {
    case 'electiveHonoured':
      return s.electiveHonoured;
    case 'electiveHonouredValue':
      return s.electiveHonouredValue;
    case 'defaults':
      return s.defaults;
    case 'contradictedSeals':
      return s.contradictedSeals;
    case 'distinctCounterparties':
      return s.distinctCounterparties;
    case 'lastDefaultTick':
      return s.lastDefaultTick;
  }
}

/**
 * INV-21 — standing changed **only** via an elective-honoured settlement, a
 * default, a contradicted seal, or scheduled decay.
 *
 * `causes` is what the tick claims it did. Anything that moved and is not covered
 * by one of those causes is a violation, and so is a change of `principal`: a
 * standing row that changes identity is scar #14a (duplicate/double-counted
 * standings) with the two rows merged instead of doubled.
 *
 * When `charges` is supplied, the arithmetic is checked too — the
 * `contradictedSeals` delta must equal the published step times the number of
 * charges, exactly. "Costs standing on the published schedule" is an arithmetic
 * claim, so it is tested as one (PROP-D3).
 */
export function checkInv21(
  prev: Standing,
  next: Standing,
  causes: readonly StandingCause[],
  tick: number,
  charges: readonly SealStandingCharge[] = [],
): InvariantViolation[] {
  const out: InvariantViolation[] = [];

  if (prev.principal !== next.principal) {
    out.push(
      sealViolation(
        'INV-21',
        tick,
        `standing row changed principal ${prev.principal} -> ${next.principal}`,
      ),
    );
    return out;
  }

  const permitted = new Set<StandingVector>();
  for (const cause of causes) for (const v of VECTORS_BY_CAUSE[cause]) permitted.add(v);

  for (const v of STANDING_VECTORS) {
    const before = vectorValue(prev, v);
    const after = vectorValue(next, v);
    if (before === after) continue;
    if (!permitted.has(v)) {
      out.push(
        sealViolation(
          'INV-21',
          tick,
          `${prev.principal}.${v} moved ${String(before)} -> ${String(after)} with no authorising cause` +
            ` (causes offered: ${causes.length === 0 ? 'none' : causes.join(', ')})`,
        ),
      );
      // Already reported; a second complaint about the same field is scar #14a's
      // shape (one movement counted twice) inside the checker itself.
      continue;
    }

    // **Only decay may lower a vector.** §6.4: standing is counts with sample
    // sizes, and the *only* published mechanism that reduces one is the recency
    // half-life. A contradicted seal costs standing and never credits it, and a
    // settlement adds to a record rather than editing it — so a fall under any
    // other cause is either a rewrite of history or a mark being quietly forgiven.
    // A legitimate recount (say, two counterparties later found to be related)
    // would need its own cause, which is exactly what INV-21 exists to force.
    if (!causes.includes('DECAY')) {
      const fell = before !== null && after !== null && after < before;
      const erased = before !== null && after === null;
      if (fell || erased) {
        out.push(
          sealViolation(
            'INV-21',
            tick,
            `${prev.principal}.${v} fell ${String(before)} -> ${String(after)} under ` +
              `${causes.join(', ')}; only scheduled decay lowers a standing vector`,
          ),
        );
      }
    }
  }

  if (charges.length > 0) {
    const expected = charges.length * SEAL_STANDING_SCHEDULE.contradictedSealStep;
    const actual = next.contradictedSeals - prev.contradictedSeals;
    // Only meaningful when decay is not also in play; decay may legitimately pull
    // the same vector down in the same batch.
    if (!causes.includes('DECAY') && actual !== expected) {
      out.push(
        sealViolation(
          'INV-21',
          tick,
          `${prev.principal} took ${charges.length} contradicted-seal charge(s) at step ` +
            `${SEAL_STANDING_SCHEDULE.contradictedSealStep}, so contradictedSeals must move by ` +
            `${expected}; it moved by ${actual}`,
        ),
      );
    }
    for (const charge of charges) {
      if (charge.scheduleVersion !== SEAL_STANDING_SCHEDULE.version) {
        out.push(
          sealViolation(
            'INV-21',
            tick,
            `charge on seal ${charge.sealId} was priced at schedule version ${charge.scheduleVersion},` +
              ` not the live ${SEAL_STANDING_SCHEDULE.version}`,
          ),
        );
      }
    }
  }

  return out;
}
