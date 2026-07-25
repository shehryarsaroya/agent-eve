/**
 * Boot the world from the durable journal. §15.2's halt/resume, made real.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE BOOT SHAPE, AND WHY IT IS NOT "ADOPT THE LATEST SNAPSHOT".**
 *
 * §15.2 describes resume as "load the latest snapshot, adopt it, replay the actions
 * after it." That path is blocked here by one fact, verified before this file was
 * written: the ledger's state table stores the append-only postings/batches as
 * *counts*, and `Ledger.restoreTo` refuses to grow them (it is an abort-path
 * inverse, not a cross-process restore). A fresh process has zero postings, so
 * `adoptSnapshot` on any snapshot taken after value moved throws `restore would grow
 * an append-only table`.
 *
 * So boot instead **reconstructs genesis deterministically and replays the whole
 * action log**:
 *
 *   1. the caller builds a fresh `Runtime` on the master seed and seats the house
 *      cast (both deterministic from the seed) — this reproduces the exact tick -1
 *      state byte-for-byte;
 *   2. this function replays every journalled tick's submitted actions in order,
 *      re-applying external enrolments at the tick they first landed, and
 *   3. at every tick that has a stored snapshot, asserts the replayed `state_hash`
 *      equals the journalled one — a **tripwire** that turns any divergence between
 *      the record and the replay into a loud refusal instead of a quiet lie.
 *
 * The final head is produced by deterministic replay, so it reproduces the exact
 * pre-crash `state_hash` (this is the property the durability tier proves, and the
 * one the whole record's trustworthiness rests on). The cost is O(head): a long
 * season replays every tick at boot. The fast path — adopt a checkpoint and replay
 * only the partial Reckoning — needs a ledger that can hydrate its posting log from
 * the journal, which lives in `ledger.ts` (under review) and is reported, not
 * touched.
 * ══════════════════════════════════════════════════════════════════════════
 */

import type { Runtime } from '../sim/runtime.js';
import type { SubmittedAction } from '../tick/index.js';
import type { EnrollmentRecord, JournalStore } from './store.js';

export class BootError extends Error {}

export interface BootResult {
  /** `GENESIS` when the store was empty; `REPLAY` when it held a run to resume. */
  readonly mode: 'GENESIS' | 'REPLAY';
  /** The tick the runtime sits at after boot. -1 for a fresh genesis. */
  readonly headTick: number;
  readonly ticksReplayed: number;
  readonly enrollmentsApplied: number;
  /** Journalled snapshots the replay was checked against. Every one that passed. */
  readonly tripwiresChecked: number;
}

export interface BootOptions {
  /** The master seed the caller built the runtime on. Must match the store's. */
  readonly seed: string;
  /**
   * Re-establish an enrolment's out-of-world identity (keyring key, seat book) as it
   * is re-applied. The *world* seat is performed here (it is what the hash depends
   * on); this hook is for the identity layer that lives outside the runtime.
   */
  readonly onEnrollment?: (enrollment: EnrollmentRecord) => void;
  /** Called after each replayed tick, for a boot progress line on a long season. */
  readonly onProgress?: (tick: number, headTick: number) => void;
}

/**
 * Reconstruct `runtime` from `store`. The runtime must be fresh (tick -1) with its
 * house cast already seated by the caller — boot does not know how the world is
 * wired, only how to drive it forward from the record.
 */
export async function bootFromStore(
  runtime: Runtime,
  store: JournalStore,
  opts: BootOptions,
): Promise<BootResult> {
  const persistedSeed = await store.masterSeed();

  if (persistedSeed === null) {
    // Genesis: nothing to resume. Record the seed so a later boot can refuse a
    // mismatch, and leave the freshly-seated world exactly as the caller built it.
    await store.init(opts.seed);
    return {
      mode: 'GENESIS',
      headTick: runtime.engine.tick,
      ticksReplayed: 0,
      enrollmentsApplied: 0,
      tripwiresChecked: 0,
    };
  }

  if (persistedSeed !== opts.seed) {
    throw new BootError(
      `the journal was written under seed '${persistedSeed}' but boot was given '${opts.seed}'. ` +
        'Replaying a persisted world under a different seed diverges every hash — refusing rather than ' +
        'silently building a different world on the old record.',
    );
  }
  if (runtime.engine.tick !== -1) {
    throw new BootError(
      `boot expects a fresh runtime at tick -1 (cast seated, no tick run), got tick ${String(runtime.engine.tick)}`,
    );
  }

  const ticks = await store.ticksSince(runtime.engine.tick);
  const snaps = await store.snapshots();
  const snapByTick = new Map(snaps.map((s) => [s.tick, s] as const));
  const enrollments = await store.enrollments();
  const enrollByTick = new Map<number, EnrollmentRecord[]>();
  for (const e of enrollments) {
    const bucket = enrollByTick.get(e.enrolledAtTick);
    if (bucket === undefined) enrollByTick.set(e.enrolledAtTick, [e]);
    else bucket.push(e);
  }

  const head = ticks.length === 0 ? runtime.engine.tick : (ticks[ticks.length - 1]?.tick ?? runtime.engine.tick);
  let ticksReplayed = 0;
  let tripwiresChecked = 0;
  let enrollmentsApplied = 0;

  for (const tr of ticks) {
    // External enrolments that first landed while `engine.tick == tr.tick - 1`
    // (i.e. targeting tr.tick). Applied before the tick runs, in insertion order, so
    // the world going into tr.tick matches the world the original tick saw.
    for (const enrollment of enrollByTick.get(tr.tick) ?? []) {
      applyEnrollment(runtime, enrollment, tr.tick);
      opts.onEnrollment?.(enrollment);
      enrollmentsApplied += 1;
    }

    for (const action of tr.actions) {
      // Defensive: the extractor already drops intent runs, but a hand-written or
      // migrated log might carry one, and re-submitting it would double it.
      if (action.arrivalOrdinal === null) continue;
      const submitted: SubmittedAction = {
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
      };
      const result = runtime.engine.submit(submitted);
      if (!result.ok && action.outcome === 'APPLIED') {
        // An action the original tick APPLIED that replay cannot even accept is a
        // divergence, and a loud one: the snapshot or the log is wrong.
        throw new BootError(
          `replay refused an action the record says was applied at tick ${String(tr.tick)} ` +
            `(${action.principal} ${action.verb}): ${result.invariant} ${result.hint}`,
        );
      }
    }

    const report = runtime.runTick();
    if (report.halted) {
      throw new BootError(
        `replay HALTED at tick ${String(tr.tick)}: ${report.violations.map((v) => v.id).join(', ')}. ` +
          'A tick the record says committed cannot be re-derived — determinism is broken or the record is corrupt.',
      );
    }
    if (report.tick !== tr.tick) {
      throw new BootError(`replay produced tick ${String(report.tick)} but the journal expected ${String(tr.tick)}`);
    }
    ticksReplayed += 1;

    const snap = snapByTick.get(tr.tick);
    if (snap !== undefined) {
      tripwiresChecked += 1;
      if (report.stateHash !== snap.stateHash) {
        throw new BootError(
          `TRIPWIRE tick ${String(tr.tick)}: replayed state_hash ${report.stateHash} does not match the ` +
            `journalled snapshot ${snap.stateHash}. The record and the replay disagree; the world is NOT ` +
            'resumed and must not accept writes.',
        );
      }
    }
    opts.onProgress?.(report.tick, head);
  }

  // Enrolments that landed in the open window at kill time (their target tick never
  // committed) are re-applied now so no enrolled identity is lost — A10 (identity
  // never resets) outranks reproducing an uncommitted tail that is gone regardless.
  for (const [targetTick, bucket] of [...enrollByTick.entries()].sort((a, b) => a[0] - b[0])) {
    if (targetTick <= head) continue;
    for (const enrollment of bucket) {
      applyEnrollment(runtime, enrollment, targetTick);
      opts.onEnrollment?.(enrollment);
      enrollmentsApplied += 1;
    }
  }

  return {
    mode: 'REPLAY',
    headTick: runtime.engine.tick,
    ticksReplayed,
    tripwiresChecked,
    enrollmentsApplied,
  };
}

function applyEnrollment(runtime: Runtime, enrollment: EnrollmentRecord, tick: number): void {
  try {
    // The world seat only. seat() targets `engine.tick + 1`, which equals `tick`
    // when this is called with the engine one tick behind — reproducing the original
    // enrolment tick, which the holding and the Levy tenure clock both read.
    runtime.seat(enrollment.principal, enrollment.handle);
  } catch (error: unknown) {
    throw new BootError(
      `replay could not re-seat ${enrollment.principal} for tick ${String(tick)}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
