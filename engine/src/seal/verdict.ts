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
 *    older than the pre-commitment cannot be the outcome it predicted. The pin is
 *    agent-supplied, so a pin ahead of the world names a state that never existed
 *    and this rule has no content against it — `SealBook.resolve` disregards such a
 *    pin before calling in, rather than letting it filter every honest deed out.
 *
 * ## The third outcome, and why it is not a halt
 *
 * A seal can end in three states, not two: `HONOURED`, `CONTRADICTED`, or
 * **`UNMARKED`** — judged exactly once and closed **with no mark**.
 *
 * An earlier version of this file *halted the tick* instead of deferring, on the
 * stated precondition that "a deed's `measure` is assigned by the engine from the
 * verb that produced it and is never agent-supplied." Only the deed half of that
 * held. `intent.measure` and `intent.target` are agent-supplied at `commit`, and
 * `intent.actedOnStateVersion` with them — so the halt was a **denial of
 * settlement** (AGT-X9): one free seal in the wrong unit plus the act it named
 * stopped the settlement tick, every Reckoning, and took every other principal's
 * seals down with it (SPEC §15.2 pauses the world on assertion failure).
 *
 * The correcting rule, and it is the whole of this module's fix:
 *
 * > **A halt is for our bug, never for their input.** An input the engine cannot
 * > account for is *data*. The only answer A5′ permits is to make no mark.
 *
 * That is SPEC §15.3's own rule — "an obligation still unresolved at the round
 * limit **DEFERS** to the next Reckoning; it never defaults" — read against the
 * other permanent mark this design can make. Deferral here means the *decision* is
 * abandoned, never retried: re-judging a seal at a later court is scar #7 exactly
 * (High Water's `lastSay` ground an honest agent down for one utterance), so a
 * deferred seal is closed forever with `evaluations === 1` and no verdict.
 *
 * Four things defer, and each names the input it could not account for:
 *
 * | `basis` | what it means |
 * |---|---|
 * | `MEASURE_DISAGREEMENT` | a deed named the sealed act in another unit |
 * | `STALE_MEASUREMENT` | a deed was valued against a state older than the seal's pin |
 * | `UNWITNESSED_DEED_SET` | nobody claimed this was all of the principal's deeds |
 * | `UNWITNESSED_TARGET` | nothing confirmed the sealed target names a real entity |
 *
 * The first two are still refused *at the door* wherever the world can answer
 * (`SealWorldIndex` in `intent.ts`), so under a wired tick loop none of the four is
 * agent-reachable and `UNMARKED` cannot be used to make a seal weightless. These
 * are the floor under that, not a substitute for it.
 *
 * **The two remaining halts are caller bugs and stay halts:** a deed belonging to
 * another principal, and a structurally malformed deed. Both come from the engine,
 * neither can be reached by anything an agent sends, and judging a permanent public
 * verdict from either would be the A5′ failure that is strictly worse than a crash.
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
 *
 * The four deferral reasons are audit-side for the same reason and one more: "your
 * seal could not be judged, and here is which of your fields we could not account
 * for" is a probe an agent could run against the resolver.
 */
export type VerdictBasis =
  | 'IN_BAND'
  | 'OUT_OF_BAND'
  | 'NO_ATTRIBUTABLE_DEED'
  | 'MEASURE_DISAGREEMENT'
  | 'STALE_MEASUREMENT'
  | 'UNWITNESSED_DEED_SET'
  | 'UNWITNESSED_TARGET';

/**
 * How a seal closed. Three states, and `UNMARKED` is not a third *verdict*: it is
 * the absence of one, recorded so that "judged once and closed with no mark" is a
 * witnessed fact rather than a gap in the table (INV-20, and see
 * {@link ./invariants.ts} on how that clause is read).
 *
 * It was called `DEFERRED` until a re-verifier caught the collision: `VentureState`
 * also has a `DEFERRED`, and the two mean **opposite** things. A deferred venture is
 * explicitly *not* terminal (§15.3 — the obligation returns next Reckoning); an
 * unmarked seal *is* terminal and is never re-judged (INV-20 — scar #7 was a promise
 * re-judged at every subsequent court). One word for two opposite lifecycles, in one
 * engine, is scar #1 with the sign flipped. The venture keeps the word because §15.3
 * uses it; this concept was never deferral in the first place.
 *
 * `SealVerdict` in `core/types.ts` stays two-valued. Agents and viewers receive
 * `HONOURED | CONTRADICTED` or nothing at all, which is exactly PROP-D2.
 */
export type SealDisposition = 'HONOURED' | 'CONTRADICTED' | 'UNMARKED';

/**
 * A halt. Thrown, never returned: the caller is the Reckoning batch, and SPEC
 * §15.2's rule is abort the tick and halt rather than publish a broken one. The
 * Reckoning is one transaction that fails closed (DET-10).
 *
 * **Only ever raised for an engine-side defect.** Nothing an agent can send reaches
 * a `SealHalt` — that was AGT-X9, and the rule that replaced it is stated in the
 * module header: *a halt is for our bug, never for their input.* Every throw site in
 * this module and in `book.ts` is reachable only from a malformed deed, a foreign
 * deed, a self-contradicting completeness witness, or a caller resolving the wrong
 * Reckoning at the wrong tick.
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
  /**
   * Has anyone claimed that `deeds` is **all** of this principal's deeds for this
   * Reckoning?
   *
   * This is the completeness witness, and without it "the agent abstained" and "the
   * caller's query missed this principal" are the *same input* — the second of which
   * publishes a permanent public mark against an innocent agent with no invariant
   * firing anywhere. §15.4 calls that class of defect the top engineering risk. So
   * absence is evidence only when someone has witnessed it; otherwise the seal
   * defers. See `DeedSetWitness` in {@link ./book.ts}.
   */
  readonly deedSetWitnessed: boolean;
  /**
   * Did anything confirm the sealed `target` names a real entity, spelled the way
   * the world spells it?
   *
   * Same rule, other agent-supplied field. Unwitnessed, a target no deed can ever
   * match is indistinguishable from an act the agent chose not to perform, and the
   * mark for both is the same one.
   */
  readonly targetWitnessed: boolean;
}

export interface Judgement {
  /** How the seal closed. `DEFERRED` means no mark was made and none ever will be. */
  readonly disposition: SealDisposition;
  /** The published flag, or `null` when the seal deferred. */
  readonly verdict: SealVerdict | null;
  readonly basis: VerdictBasis;
  /**
   * The deed the judgement was computed from, or null when none was attributable.
   * A deferral cites the deed it could not account for, when there was one.
   */
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
  /**
   * Matches the act but not the measurement. Never contradicts and — since the
   * `measure` it disagrees about is agent-supplied — never halts either.
   */
  const unjudgeable: { readonly deed: Deed; readonly basis: VerdictBasis }[] = [];

  for (const deed of ordered) {
    // Rule 2 — the seal's own window, and no other (scar #7).
    if (reckoningIndex(deed.tick) !== inputs.reckoningIndex) continue;
    // Rule 3 — the timestamp. A deed at or before the seal cannot honour it.
    if (deed.tick <= inputs.sealedAtTick) continue;
    if (!namesTheSameAct(inputs.intent, deed)) continue;

    // Rule 4 and the measure check: both are *measurement* problems, so both go
    // to `unjudgeable` rather than silently making the seal contradicted.
    if (deed.measure !== inputs.intent.measure) {
      unjudgeable.push({ deed, basis: 'MEASURE_DISAGREEMENT' });
      continue;
    }
    if (deed.valuedAtStateVersion < inputs.actedOnStateVersion) {
      unjudgeable.push({ deed, basis: 'STALE_MEASUREMENT' });
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
        disposition: 'HONOURED',
        verdict: 'HONOURED',
        basis: 'IN_BAND',
        citedDeedEventId: deed.eventId,
        attributableCount: attributable.length,
      };
    }
  }

  // A measurement we cannot account for outranks a contradiction, and the reason is
  // scar #8 pointed the one way it actually points: prefer precision over recall
  // when the penalty is permanent. It does **not** outrank an honoured seal above —
  // the deferral exists to avoid a false mark, not to swallow a kept promise.
  const first = unjudgeable[0];
  if (first !== undefined) {
    return {
      disposition: 'UNMARKED',
      verdict: null,
      basis: first.basis,
      citedDeedEventId: first.deed.eventId,
      attributableCount: attributable.length,
    };
  }

  const missed = attributable[0];
  if (missed !== undefined) {
    // A mark with a cited deed behind it. No witness is needed for this one: the
    // record can point at the act that missed the band, which is INV-17's rule for
    // defaults ("every default event carries an attributable cause") applied here.
    return {
      disposition: 'CONTRADICTED',
      verdict: 'CONTRADICTED',
      basis: 'OUT_OF_BAND',
      citedDeedEventId: missed.eventId,
      attributableCount: attributable.length,
    };
  }

  // Nothing attributable. The mark now rests entirely on an **absence**, so it is
  // only available where the absence was witnessed. Unwitnessed, defer: §15.3's
  // unresolved-obligation rule, and the one A5′ route this module used not to
  // defend while spending a whole halt path on the strictly-less-likely mismatch.
  if (!inputs.targetWitnessed) {
    return {
      disposition: 'UNMARKED',
      verdict: null,
      basis: 'UNWITNESSED_TARGET',
      citedDeedEventId: null,
      attributableCount: 0,
    };
  }
  if (!inputs.deedSetWitnessed) {
    return {
      disposition: 'UNMARKED',
      verdict: null,
      basis: 'UNWITNESSED_DEED_SET',
      citedDeedEventId: null,
      attributableCount: 0,
    };
  }

  return {
    disposition: 'CONTRADICTED',
    verdict: 'CONTRADICTED',
    basis: 'NO_ATTRIBUTABLE_DEED',
    citedDeedEventId: null,
    attributableCount: 0,
  };
}
