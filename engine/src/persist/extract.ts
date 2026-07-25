/**
 * Turn a just-committed tick into its durable rows.
 *
 * A pure read over the runtime's own projections — it mutates nothing and must be
 * called **after** `runTick` returns a non-halted report, when the tick's events are
 * in the ledger, its postings are in the batch log, and its action log is still
 * inside the retention window. On a halted (aborted) tick there is nothing to
 * extract: the buffer was discarded and the tick was never published, so the caller
 * must not persist it.
 */

import type { Runtime } from '../sim/runtime.js';
import type { TickReport } from '../tick/index.js';
import type { PersistedEvent, PersistedPosting, SnapshotRecord, TickRecord } from './store.js';
import { snapshotRecord } from './store.js';

/**
 * Extract one committed tick's `(events, postings, submitted actions, seed)`.
 *
 * The three read sources are the three write artifacts (§15.1): `events` from the
 * event ledger, `postings` from the ledger's batch log, `actions` from the action
 * log — filtered to genuinely submitted actions, because intent runs are engine-
 * derived and regenerate on replay (see {@link TickRecord.actions}). The seed pair
 * comes off the report, which is where the commit/reveal discipline already lands
 * it.
 */
export function extractTick(runtime: Runtime, report: TickReport): TickRecord {
  if (report.halted) {
    throw new Error(
      `cannot extract tick ${String(report.tick)}: it halted, so nothing was published to persist`,
    );
  }
  const tick = report.tick;

  const events: PersistedEvent[] = runtime.events.eventsAtTick(tick).map((rec) => ({
    event: rec.event,
    visibility: rec.visibility,
    flagKeys: [...rec.flagKeys],
    audience: runtime.events.audienceOf(rec.event.id).map((a) => ({
      principal: a.principal,
      basis: a.basis,
      admittedAtTick: a.admittedAtTick,
    })),
  }));

  // A tick's batches are appended together during that tick and only truncated on an
  // abort (which never reaches here), so filtering the batch log by tick yields
  // exactly this tick's value moves. `seqInTick` is the batch's ordinal within the
  // tick; see PersistedPosting on why that is the honest key rather than an event's.
  const postings: PersistedPosting[] = [];
  let batchOrdinal = 0;
  for (const batch of runtime.ledger.allBatches()) {
    if (batch.tick !== tick) continue;
    batch.postings.forEach((p, index) => {
      postings.push({
        tick,
        seqInTick: batchOrdinal,
        postingIndex: index,
        eventId: p.eventId,
        account: p.account,
        good: p.good,
        amountMinor: p.amountMinor,
        amountQty: p.amountQty,
        batchKind: batch.kind,
      });
    });
    batchOrdinal += 1;
  }

  const actions = runtime.engine.log
    .forTick(tick)
    // Submitted only. A null arrival ordinal marks an engine-produced intent run,
    // which the snapshot's standing intents regenerate on replay — storing it would
    // replay it twice (`replay.ts` skips exactly this).
    .filter((a) => a.arrivalOrdinal !== null)
    .map((a) => ({ ...a }));

  return {
    tick,
    seed: report.seedRevealed,
    seedHash: report.seedCommitment,
    events,
    postings,
    actions,
  };
}

/**
 * The current engine snapshot as a durable checkpoint record.
 *
 * Called at a settlement tick right after `runTick`, so `engine.snapshot()` is that
 * tick's boundary snapshot and the report carries that tick's revealed seed pair.
 */
export function snapshotRecordOf(runtime: Runtime, report: TickReport): SnapshotRecord {
  return snapshotRecord(runtime.engine.snapshot(), report.seedRevealed, report.seedCommitment);
}
