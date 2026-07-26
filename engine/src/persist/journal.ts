/**
 * The live persister: the seam between a committed tick and the durable journal,
 * and the home of the persistence-failure policy.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **PERSISTENCE FAILURE IS NOT COSMETIC — THE POLICY, STATED ONCE.**
 *
 * A frame write failing is fine to swallow: the show is cosmetic (that policy lives
 * in `serve()`). A **journal** write failing means the permanent public record is
 * not durable, and that is never swallowed. But a transient DB hiccup must also not
 * halt a live world mid-tick — a stalled Reckoning in front of an audience is worse
 * than the outage it avoids (A14). So:
 *
 *   - Committed ticks are **buffered in an ordered queue and never dropped.** The
 *     tick loop enqueues (synchronously, never throwing) and keeps running; a flush
 *     drains the queue to the store in order.
 *   - A write that fails is **retried** — the item stays at the head of the queue,
 *     `consecutiveFailures` climbs, and the next flush tries it again. Nothing behind
 *     a failed write is written, so the durable record can lag the live world but can
 *     never have a hole in the middle.
 *   - `durableTick` advances **only** on a successful append, so health reports the
 *     honest durability frontier. There is no "proceed as if persisted": a lagging
 *     `durableTick` is visible, and sustained failure — too many consecutive errors
 *     or too deep a backlog — flips {@link JournalHealth.healthy} to false, which the
 *     operator's `GET /health` surfaces as unhealthy (503).
 *
 * The cost of this posture is a bounded window of tail loss: a hard kill while the
 * queue holds unflushed ticks loses exactly those ticks from the durable record, and
 * boot resumes from `durableTick`. That is a rewind of the uncommitted tail, never a
 * corruption of it — the record stays internally consistent (A5′), and a clean
 * shutdown calls {@link drain} first so the window is only ever open during an actual
 * outage.
 * ══════════════════════════════════════════════════════════════════════════
 */

import type { Runtime } from '../sim/runtime.js';
import type { TickReport } from '../tick/index.js';
import { extractTick, snapshotRecordOf } from './extract.js';
import type { EnrollmentRecord, JournalStore, SnapshotRecord, TickRecord } from './store.js';

/** Consecutive failed flushes before health flips to unhealthy. (calibrate) */
export const FAILURE_ALARM_THRESHOLD = 3;

/** Queued-but-undurable writes before health flips to unhealthy. (calibrate) */
export const BACKLOG_ALARM = 64;

export interface JournalHealth {
  /** Highest tick successfully written to the store. The true durability frontier. */
  readonly durableTick: number;
  /** Highest committed tick handed to the journal. `headTick - durableTick` is the lag. */
  readonly headTick: number;
  /** Writes queued and not yet durable. */
  readonly backlog: number;
  /** False when sustained failure means an operator must look. */
  readonly healthy: boolean;
  readonly consecutiveFailures: number;
  /** The last write error's message, or null. Never a secret — a DB error string. */
  readonly lastError: string | null;
}

type PendingWrite =
  | { readonly kind: 'tick'; readonly record: TickRecord }
  | { readonly kind: 'snapshot'; readonly record: SnapshotRecord }
  | { readonly kind: 'enrollment'; readonly record: EnrollmentRecord };

export interface JournalOptions {
  /** Also write a full snapshot on every settlement tick (a Reckoning). Default true. */
  readonly snapshotOnReckoning?: boolean;
  /** Additionally snapshot every N ticks (0 disables). Default 0. */
  readonly snapshotEveryTicks?: number;
}

export class Journal {
  private readonly queue: PendingWrite[] = [];
  private durable = -1;
  private head = -1;
  private consecutiveFailures = 0;
  private lastError: string | null = null;
  private flushing = false;
  private closed = false;
  private readonly snapshotOnReckoning: boolean;
  private readonly snapshotEveryTicks: number;

  constructor(
    private readonly store: JournalStore,
    options: JournalOptions = {},
  ) {
    this.snapshotOnReckoning = options.snapshotOnReckoning ?? true;
    this.snapshotEveryTicks = options.snapshotEveryTicks ?? 0;
  }

  /**
   * Buffer one committed tick's durable rows. Synchronous and total — it never
   * throws, because the tick has already published and the world must keep moving.
   * A halted tick is refused: there is nothing published to persist.
   */
  record(runtime: Runtime, report: TickReport): void {
    if (report.halted) return;
    const tick = extractTick(runtime, report);
    this.enqueue({ kind: 'tick', record: tick });
    if (this.shouldSnapshot(report)) {
      this.enqueue({ kind: 'snapshot', record: snapshotRecordOf(runtime, report) });
    }
  }

  /** Buffer one external enrolment so boot can re-seat it. Synchronous, never throws. */
  recordEnrollment(enrollment: EnrollmentRecord): void {
    this.enqueue({ kind: 'enrollment', record: enrollment });
  }

  private shouldSnapshot(report: TickReport): boolean {
    if (this.snapshotOnReckoning && report.clock.isSettlementTick) return true;
    if (this.snapshotEveryTicks > 0 && report.tick % this.snapshotEveryTicks === 0) return true;
    return false;
  }

  private enqueue(item: PendingWrite): void {
    this.queue.push(item);
    if (item.kind === 'tick') this.head = Math.max(this.head, item.record.tick);
  }

  /**
   * Drain the queue to the store, in order, until it is empty or a write fails.
   * Single-flight (a concurrent call is a no-op), so `serve()` can fire it after
   * every tick without overlapping writes racing on the queue. Awaitable, so tests
   * are deterministic without a timer. Never throws — a write error is folded into
   * {@link health} and the item is left at the head of the queue to retry.
   */
  async flushPending(): Promise<number> {
    if (this.flushing || this.closed) return 0;
    this.flushing = true;
    let written = 0;
    try {
      while (this.queue.length > 0) {
        const item = this.queue[0];
        if (item === undefined) break;
        try {
          await this.write(item);
        } catch (error: unknown) {
          this.consecutiveFailures += 1;
          this.lastError = error instanceof Error ? error.message : String(error);
          return written; // leave `item` at the head; the next flush retries it
        }
        this.queue.shift();
        this.consecutiveFailures = 0;
        this.lastError = null;
        if (item.kind === 'tick') this.durable = item.record.tick;
        written += 1;
      }
    } finally {
      this.flushing = false;
    }
    return written;
  }

  private async write(item: PendingWrite): Promise<void> {
    switch (item.kind) {
      case 'tick':
        await this.store.appendTick(item.record);
        return;
      case 'snapshot':
        await this.store.writeSnapshot(item.record);
        return;
      case 'enrollment':
        await this.store.recordEnrollment(item.record);
        return;
    }
  }

  /**
   * Flush best-effort for a clean shutdown. Retries the queue a bounded number of
   * times so a momentary hiccup still drains; a sustained outage returns with a
   * non-empty backlog, which the caller logs — those tail ticks are the bounded loss
   * the module header describes, never a silent success.
   */
  async drain(maxAttempts = 8): Promise<void> {
    for (let attempt = 0; attempt < maxAttempts && this.queue.length > 0; attempt += 1) {
      const before = this.queue.length;
      // A concurrent live flush may hold the single-flight lock; wait it out.
      while (this.flushing) await Promise.resolve();
      await this.flushPending();
      if (this.queue.length === before) break; // no progress: the store is down
    }
  }

  health(): JournalHealth {
    const backlog = this.queue.length;
    // NOTHING DURABLE YET, WHILE TICKS HAVE BEEN PUBLISHED, IS NEVER HEALTHY.
    //
    // The thresholds above exist to stop one transient write error from flapping the
    // alarm, and they are right for that. They are wrong for the case they let through
    // in production: partitions ran out, EVERY insert failed with "no partition of
    // relation event found for row", and health read
    // `durableTick: -1, headTick: 2305, backlog: 2, healthy: true` — because two
    // consecutive failures is under a threshold of three. The world was publishing ticks
    // that could never become durable, and the next restart replayed to the last durable
    // tick and lost nine ticks of history.
    //
    // A counter of recent failures cannot see that, because the condition is not "some
    // writes failed lately", it is "the record does not exist". Publishing without
    // persisting is the whole hazard, so it is asserted directly rather than inferred
    // from a rate.
    const publishedNothingDurable = this.head >= 0 && this.durable < 0;
    const healthy =
      !publishedNothingDurable &&
      this.consecutiveFailures < FAILURE_ALARM_THRESHOLD &&
      backlog <= BACKLOG_ALARM;
    return {
      durableTick: this.durable,
      headTick: this.head,
      backlog,
      healthy,
      consecutiveFailures: this.consecutiveFailures,
      lastError: this.lastError,
    };
  }

  async close(): Promise<void> {
    await this.drain();
    this.closed = true;
    await this.store.close();
  }
}
