/**
 * The verdict — deterministic, from typed fields, against the state the agent
 * acted on.
 *
 * ## What this function is not allowed to see
 *
 * {@link judge} takes an intent and a list of deeds. **There is no prose
 * parameter and no seal record**, so no future edit can start reading the
 * broadcast text without changing this signature and every caller. That is the
 * structural half of PROP-D1; the fuzz in `test/seal/prose.prop.test.ts` is the
 * regression half. Scar #8 is what happens without both: a 34-character
 * look-back over ordinary prose branded an honest agent a liar, permanently, and
 * the penalty in this design is public and permanent too.
 *
 * ## The four attribution rules, and why each exists
 *
 * A deed is attributable to a seal only if all of these hold:
 *
 * 1. **Same principal.** A foreign deed in the candidate list is a caller bug and
 *    halts; attributing another agent's act would be a fabricated record (A5′).
 * 2. **Same Reckoning as the seal** (`reckoningIndex(deed.tick) === seal`). Scar
 *    #7: High Water's `lastSay` persisted across tides, so one promise was
 *    re-judged at every subsequent court and ground an honest agent's reputation
 *    down for a single utterance. A seal is evaluated only against its own window.
 * 3. **Strictly after the seal.** The contradiction is provable against a
 *    *timestamp*, never inferred from behaviour — and it is what stops an agent
 *    performing for the reveal, because it had to commit before the outcome was
 *    known (§11.1). A seal written *after* a matching deed is therefore not
 *    honoured by it: a pre-commitment made in hindsight is not a pre-commitment.
 * 4. **Measured at or after the state version the seal pinned.** Scar #6: resolve
 *    from the same state the agents acted on. A measurement taken from a state
 *    older than the pre-commitment cannot be the outcome it predicted.
 *
 * ## Why an unjudgeable deed halts instead of contradicting
 *
 * If the verdict would be CONTRADICTED *and* there is a deed that matches the
 * verb and target but could not be attributed for a **measurement** reason — a
 * different `measure`, or a stale `valuedAtStateVersion` — the tick halts.
 *
 * That is scar #8's lesson in the one direction it actually points: prefer
 * precision over recall when the penalty is permanent. A unit disagreement
 * between the engine and the seal is scar #1 with money, and resolving it into a
 * public "CONTRADICTED" would libel an agent that did exactly what it said. A
 * halt is recoverable (SPEC §15.2: replay the tick from the immutable input
 * triple, fix the defect, resume); a permanent false mark is not.
 *
 * **Precondition on the caller:** a deed's `measure` is assigned by the engine
 * from the verb that produced it and is never agent-supplied. If it ever became
 * agent-supplied, this halt would be a denial-of-settlement lever — so it is
 * stated here rather than assumed.
 */

import type { EventId, InvariantViolation, PrincipalId, SealVerdict } from '../core/types.js';
import { reckoningIndex } from '../core/time.js';
import { cmpDeeds, deedFaults, type Deed } from './deed.js';
import { inBand, type SealIntent } from './intent.js';

/**
 * Why the verdict is what it is. **Audit-side only** — this never reaches an
 * agent or a viewer, because `OUT_OF_BAND` and `NO_ATTRIBUTABLE_DEED` are
 * different facts about a sealed intention, and PROP-D2 gives agents the verdict
 * and nothing else. See {@link ../seal/disclosure.ts}.
 */
export type VerdictBasis = 'IN_BAND' | 'OUT_OF_BAND' | 'NO_ATTRIBUTABLE_DEED';

/**
 * A halt. Thrown, never returned: the caller is the Reckoning batch, and SPEC
 * §15.2's rule is abort the tick and halt rather than publish a broken one. The
 * Reckoning is one transaction that fails closed (DET-10).
 */
export class SealHalt extends Error {
  constructor(readonly violations: readonly InvariantViolation[]) {
    super(`seal invariants failed: ${violations.map((v) => `${v.id} ${v.message}`).join(' | ')}`);
    this.name = 'SealHalt';
  }
}

export function sealViolation(id: string, tick: number, message: string): InvariantViolation {
  return { id, message, tick, severity: 'HALT' };
}

/**
 * Everything {@link judge} is allowed to know about a seal.
 *
 * Deliberately a *projection* of the seal record rather than the record itself:
 * the record carries prose, and a function that receives prose can be edited into
 * one that reads it.
 */
export interface VerdictInputs {
  readonly principal: PrincipalId;
  readonly reckoningIndex: number;
  readonly sealedAtTick: number;
  /** The state version the agent acted on when it sealed (INV-19, scar #6). */
  readonly actedOnStateVersion: number;
  readonly intent: SealIntent;
}

export interface Judgement {
  readonly verdict: SealVerdict;
  readonly basis: VerdictBasis;
  /** The deed the verdict was computed from, or null when none was attributable. */
  readonly citedDeedEventId: EventId | null;
  /** How many deeds were attributable at all. Audit-side; never disclosed. */
  readonly attributableCount: number;
}

/** Does this deed match the intent's verb and target? The cheap half of attribution. */
function namesTheSameAct(intent: SealIntent, deed: Deed): boolean {
  return deed.verb === intent.verb && deed.target === intent.target;
}

/**
 * Compute a verdict. Pure, total, and deterministic for a given
 * `(inputs, deeds)` — the deeds are sorted by {@link cmpDeeds} internally, so the
 * caller's argument order cannot change the published record (DET-2).
 */
export function judge(inputs: VerdictInputs, deeds: readonly Deed[], atTick: number): Judgement {
  const violations: InvariantViolation[] = [];
  for (const deed of deeds) {
    if (deed.principal !== inputs.principal) {
      violations.push(
        sealViolation(
          'INV-20',
          atTick,
          `deed ${deed.eventId} belongs to ${deed.principal} but was offered against ` +
            `${inputs.principal}'s seal; a verdict may only cite its own principal's deeds`,
        ),
      );
    }
    violations.push(...deedFaults(deed).map((m) => sealViolation('INV-17', atTick, m)));
  }
  if (violations.length > 0) throw new SealHalt(violations);

  const ordered = [...deeds].sort(cmpDeeds);

  const attributable: Deed[] = [];
  /** Matches the act but not the measurement. Never contradicts; see the header. */
  const unjudgeable: Deed[] = [];

  for (const deed of ordered) {
    // Rule 2 — the seal's own window, and no other (scar #7).
    if (reckoningIndex(deed.tick) !== inputs.reckoningIndex) continue;
    // Rule 3 — the timestamp. A deed at or before the seal cannot honour it.
    if (deed.tick <= inputs.sealedAtTick) continue;
    if (!namesTheSameAct(inputs.intent, deed)) continue;

    // Rule 4 and the measure check: both are *measurement* problems, so both go
    // to `unjudgeable` rather than silently making the seal contradicted.
    if (deed.measure !== inputs.intent.measure) {
      unjudgeable.push(deed);
      continue;
    }
    if (deed.valuedAtStateVersion < inputs.actedOnStateVersion) {
      unjudgeable.push(deed);
      continue;
    }
    attributable.push(deed);
  }

  // Any attributable deed inside the band honours the seal. "Any" rather than
  // "the first": scar #8 — when the penalty is permanent and public, prefer
  // precision over recall. An agent that did what it said, once, kept its word.
  for (const deed of attributable) {
    if (inBand(inputs.intent, deed.outcome)) {
      return {
        verdict: 'HONOURED',
        basis: 'IN_BAND',
        citedDeedEventId: deed.eventId,
        attributableCount: attributable.length,
      };
    }
  }

  if (unjudgeable.length > 0) {
    const bad = unjudgeable[0];
    throw new SealHalt([
      sealViolation(
        'INV-20',
        atTick,
        `refusing to contradict ${inputs.principal}: deed ${String(bad?.eventId)} names the same act ` +
          `('${inputs.intent.verb}' -> '${inputs.intent.target}') but was measured as ` +
          `${String(bad?.measure)} at state version ${String(bad?.valuedAtStateVersion)}, against a seal ` +
          `in ${inputs.intent.measure} pinned at ${inputs.actedOnStateVersion}. A unit or state-version ` +
          `disagreement must halt the tick, never become a permanent public mark (A5', scar #8)`,
      ),
    ]);
  }

  const first = attributable[0];
  if (first !== undefined) {
    return {
      verdict: 'CONTRADICTED',
      basis: 'OUT_OF_BAND',
      citedDeedEventId: first.eventId,
      attributableCount: attributable.length,
    };
  }

  return {
    verdict: 'CONTRADICTED',
    basis: 'NO_ATTRIBUTABLE_DEED',
    citedDeedEventId: null,
    attributableCount: 0,
  };
}
