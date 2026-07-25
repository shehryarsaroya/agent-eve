/**
 * Replay. DET-3, and §15.1's correction about what replay's input actually is.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **`(snapshot_T, action_log_T, seed_T) → snapshot_T+1`. EVENTS ARE OUTPUT.**
 * ══════════════════════════════════════════════════════════════════════════
 *
 * §15.1 states the trap plainly: "'agent observations are projections of one event
 * stream' gets built as fold-events-per-request, which is the canonical
 * event-sourcing cliff and makes `expected_state_version` incoherent." So nothing
 * in this file reads an event. The event ledger is not even an argument.
 *
 * What replay needs, and nothing else:
 *
 *   - a snapshot, which is the canonical capture of every state table;
 *   - the action log for the tick, which is the actions the tick *resolved*
 *     (applied and refused alike — a refusal that stopped happening is a
 *     divergence, and a log without them could not detect it);
 *   - the seed, which is derived from the committed master seed and the tick.
 *
 * Arrival order is deliberately **not** part of the input in any meaningful sense.
 * {@link replayTick} re-submits the logged actions in whatever order they are given
 * and lets the engine re-derive resolution order from `(priority, principal_id,
 * client_sequence)`. That is what makes DET-2 and DET-3 the same property viewed
 * from two sides.
 */

import type { WorldState } from '../world/index.js';
import type { LoggedAction } from './actionLog.js';
import { Engine, type EngineOptions, type TickReport } from './loop.js';
import type { Snapshot } from './snapshot.js';

export class ReplayError extends Error {}

/** §15.2's immutable input triple, as one object. */
export interface ReplayInput {
  /** Term 1. The state after tick `snapshot.tick`. */
  readonly snapshot: Snapshot;
  /** Term 2. Everything the next tick resolved, in any order. */
  readonly actions: readonly LoggedAction[];
  /**
   * Term 3, as the run's master seed. The per-tick seed is derived from it, so
   * handing the master over is handing over the whole third term — and it keeps
   * the commit/reveal discipline intact rather than smuggling a revealed seed in.
   */
  readonly seed: string;
}

export interface ReplayResult {
  readonly report: TickReport;
  /** The engine the replay ran in. A sandbox; never the live one. */
  readonly engine: Engine;
}

/**
 * Re-run one tick in a fresh engine.
 *
 * `world` must be a world built on the **same map** as the snapshot — the map is
 * authored and pinned, not mutable state, so it is constructed rather than
 * restored, and `worldStateTable`'s restore refuses on a map-hash mismatch. Any
 * other state the original engine held must be supplied through
 * `options.tables`; a table in the snapshot with no counterpart here is refused
 * rather than skipped, because a silently partial restore produces a world that
 * merely *looks* replayed.
 */
export function replayTick(
  input: ReplayInput,
  world: WorldState,
  options?: Omit<EngineOptions, 'world' | 'seed' | 'startTick'>,
): ReplayResult {
  const engine = new Engine({
    ...(options ?? {}),
    world,
    seed: input.seed,
    startTick: input.snapshot.tick,
  });

  // Through the engine, never `restoreSnapshot` directly: `adoptSnapshot` also moves
  // the engine's own tick, version and published hash, and re-captures to prove the
  // restore reproduced the bytes. Restoring the tables alone leaves the engine
  // reporting a state it is not in.
  try {
    engine.adoptSnapshot(input.snapshot);
  } catch (error: unknown) {
    throw new ReplayError(
      `the snapshot could not be adopted: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (engine.stateHash !== input.snapshot.stateHash) {
    throw new ReplayError(
      `restored world hashes ${engine.stateHash} but the snapshot says ${input.snapshot.stateHash}`,
    );
  }

  for (const action of input.actions) {
    // Intent runs are not re-submitted: they are produced by the intents that the
    // snapshot already holds, and re-submitting them would run each twice.
    if (action.arrivalOrdinal === null) continue;
    const submitted = engine.submit({
      principal: action.principal,
      verb: action.verb,
      params: action.params,
      clientSequence: action.clientSequence,
      arrivalMs: action.arrivalMs ?? 0,
      decisionSource: action.decisionSource,
      priority: action.priority,
      ...(action.idempotencyKey === null ? {} : { idempotencyKey: action.idempotencyKey }),
      ...(action.actedOnStateVersion === null
        ? {}
        : { actedOnStateVersion: action.actedOnStateVersion }),
    });
    if (!submitted.ok && action.outcome === 'APPLIED') {
      // An action that was applied originally and cannot even be accepted now is a
      // divergence, and a loud one: it means the snapshot or the log is wrong.
      throw new ReplayError(
        `replay refused an action the original tick applied (${action.principal} ${action.verb}): ` +
          `${submitted.invariant} ${submitted.hint}`,
      );
    }
  }

  return { report: engine.runTick(), engine };
}
