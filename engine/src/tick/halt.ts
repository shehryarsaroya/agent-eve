/**
 * Aborting a tick — the half of halting that belongs to the pipeline.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **ON ASSERTION FAILURE: ABORT THE TICK, PUBLISH NOTHING, ENTER `PAUSED`.**
 * ══════════════════════════════════════════════════════════════════════════
 *
 * **Division of labour, and it matters that there is only one of each.**
 * `src/invariants/halt.ts` owns the PAUSED state machine: the `RUNNING | PAUSED`
 * status, the last *published* tick, the bounded submission queue, the "Reckoning
 * delayed" card, and the signed resume. This module owns *aborting the tick*: the
 * rollback of in-memory state, and turning a pipeline-level failure into the
 * `InvariantReport` + `TickInputs` pair the controller wants.
 *
 * There is deliberately no second status field, no second halt record and no second
 * resume path here. Two homes for one quantity is scar #5, and the quantity in
 * question is *whether the world is up* — the worst possible one to mirror.
 *
 * What this module adds that the controller cannot know: **whether the rollback was
 * complete.** The controller's contract is that after a failed tick the in-memory
 * world is garbage and recovery is a replay into a world rebuilt from the snapshot.
 * The tick loop can usually do better than that, because every state table it holds
 * has a `restore` — so it puts the world back at `snapshot_T` and says so. When a
 * participant has no restore (wave 1's `Ledger` has none), it says that instead,
 * loudly, rather than claiming a clean abort.
 */

import type { CanonicalValue } from '../core/canonical.js';
import type { InvariantViolation } from '../core/types.js';
import type { InvariantReport } from '../invariants/aggregate.js';
import type { TickInputs } from '../invariants/halt.js';
import type { LoggedAction } from './actionLog.js';
import { canonicalParams, type Snapshot } from './snapshot.js';

/** Was the in-memory world put back, or must it be rebuilt from the snapshot? */
export type Rollback = 'FULL' | 'INCOMPLETE';

/** A violation raised by the tick loop itself rather than by a module's checker. */
export function engineViolation(id: string, tick: number, message: string): InvariantViolation {
  return { id, message, tick, severity: 'HALT' };
}

/**
 * Wrap pipeline-level failures as an `InvariantReport`.
 *
 * The controller only halts on a report, which is the right shape: a step-budget
 * overrun and a broken invariant are the same event as far as an observer is
 * concerned — the tick did not publish. `checked` lists the pipeline itself so an
 * operator can see the failure came from the loop and not from a module's checker.
 */
export function engineReport(
  tick: number,
  violations: readonly InvariantViolation[],
  checked: readonly string[],
): InvariantReport {
  return { tick, violations, checked, skipped: [] };
}

/**
 * `(snapshot_T, action_log_T, seed_T)` in the controller's shape.
 *
 * The snapshot is canonicalised through the same serialiser everything else uses,
 * so `tripleHash` over it is stable across hosts (DET-4) — a triple whose identity
 * depended on key order would make a resume order refuse the very tick it was
 * signed for.
 */
export function tickInputsFor(
  snapshot: Snapshot,
  actions: readonly LoggedAction[],
  tick: number,
  seed: string,
): TickInputs {
  return {
    tick,
    snapshot: snapshotCanonical(snapshot),
    actionLog: actions.map(loggedActionCanonical),
    seed,
  };
}

export function snapshotCanonical(snapshot: Snapshot): CanonicalValue {
  return {
    tick: snapshot.tick,
    stateVersion: snapshot.stateVersion,
    stateHash: snapshot.stateHash,
    tables: snapshot.tables.map(([name, value]) => [name, value] as CanonicalValue),
  };
}

/**
 * One action log row, canonical.
 *
 * `arrivalMs` and `arrivalOrdinal` are kept in the triple even though nothing reads
 * them: the log is the A4 audit's evidence, and a replay artifact that quietly
 * dropped the field the audit needs would make the audit unfalsifiable.
 */
export function loggedActionCanonical(action: LoggedAction): CanonicalValue {
  return {
    tick: action.tick,
    principal: action.principal,
    verb: action.verb,
    params: canonicalParams(action.params, `action(${action.verb})`),
    clientSequence: action.clientSequence,
    priority: action.priority,
    decisionSource: action.decisionSource,
    idempotencyKey: action.idempotencyKey,
    actedOnStateVersion: action.actedOnStateVersion,
    arrivalMs: action.arrivalMs,
    arrivalOrdinal: action.arrivalOrdinal,
    resolutionOrdinal: action.resolutionOrdinal,
    outcome: action.outcome,
    // The hint, not just the code: an operator reading a failed tick needs to see
    // what the agent was told, because a wrong hint is itself a rules-surface bug
    // (scar #1) and it will never show up in a state hash.
    rejection:
      action.rejection === null
        ? null
        : { invariant: action.rejection.invariant, hint: action.rejection.hint },
  };
}
