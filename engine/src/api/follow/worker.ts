/**
 * The recap worker: after a Reckoning's frame is published, one email to each follower.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **IT NEVER TOUCHES THE TICK, AND THAT IS ENFORCED BY WHAT IT IS GIVEN.** The worker holds no
 * runtime, no engine and no journal. Its whole input is two files any spectator can download
 * — `frames/latest.json` and the archived frame before it — plus the follow store. So it
 * cannot block a tick, cannot alter one, and cannot read a fact the frame does not publish.
 * `serve()` calls {@link RecapWorker.kick} after `publishFrame` returns, and `kick` returns
 * at once: the work happens on the event loop between ticks.
 *
 * **EXACTLY ONCE, ACROSS RESTARTS**, from three things together:
 *
 *   1. `last_sent_reckoning` is the mark. A follower is due for Reckoning R exactly while its
 *      mark is not R — above R included, which is a re-seeded world restarting its count — and
 *      the mark moves with a conditional UPDATE after the provider accepts the email.
 *   2. The provider call carries an `Idempotency-Key` of `recap-<follow id>-r<R>`. A crash
 *      between "accepted" and "marked" re-sends with the same key on the next run, and the
 *      provider answers with the first email instead of a second.
 *   3. One run at a time in the process (`kick` is single-flight), and boot kicks once, so a
 *      restart in the middle of a run picks up exactly where the marks say it stopped.
 *
 * **FAILURE IS LOGGED AND RETRIED, NEVER FATAL.** A refused or failed send leaves the mark
 * where it was; the run carries on with the next follower, and a timer tries again later. A
 * provider that refuses US (a revoked key) stops the run early, because every further call
 * would fail the same way. Nothing here can throw into the caller.
 *
 * **BOUNDED**: rows are paged, a run sends at most {@link MAX_RECAPS_PER_RUN} before yielding
 * to the next run, each follower is tried at most {@link MAX_RECAP_ATTEMPTS} times per
 * Reckoning, and every send takes a slot of the durable daily ceiling first.
 *
 * **A missed Reckoning is not backfilled.** The worker only ever sends the latest frame. A
 * follower whose mark is two nights behind gets tonight's recap, not two — a story that
 * arrives a day late is noise, and two at once is spam.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Clock } from '../../core/time.js';
import { BPS_ONE } from '../../core/units.js';
import type { ReckoningFrame } from '../../frames/contract.js';
import { frameFileName, LATEST } from '../../frames/write.js';
import {
  CEILING_RESUME_GRACE_MS,
  FOLLOW_CONFIRM_TTL_MS,
  RECAP_CEILING_SHARE_BPS,
  RECAP_RETRY_MS,
} from '../limits.js';
import { composeRecap, followLinks, type FollowLinks } from './compose.js';
import { describeMailFailure, MailError, type Mailer } from './mailer.js';
import { buildRecap, type Recap } from './recap.js';
import { msUntilNextUtcDay, utcDay } from './service.js';
import type { FollowRow, FollowStore } from './store.js';
import { hashToken, unsubscribeTokenFor } from './tokens.js';

/** Rows read per page. */
export const RECAP_PAGE = 50;

/** Sends per run before the worker yields and schedules a continuation. */
export const MAX_RECAPS_PER_RUN = 500;

/** Tries per follower per Reckoning before that follower is skipped until the next one. */
export const MAX_RECAP_ATTEMPTS = 3;

export type RunEnd = 'off' | 'no-frame' | 'done' | 'ceiling' | 'provider' | 'bound' | 'closed';

export interface RecapRunReport {
  readonly reckoning: number | null;
  readonly sent: number;
  readonly failed: number;
  readonly skipped: number;
  readonly end: RunEnd;
}

export interface RecapWorkerOptions {
  readonly store: FollowStore;
  readonly mailer: Mailer | null;
  readonly secret: string | null;
  /** Where `publishFrame` writes. Null: no frames, so nothing to recap. */
  readonly framesDir: string | null;
  readonly publicUrl: string;
  readonly clock: Clock;
  readonly dailyCeiling: number;
  /** Is this handle still a principal in the running world? Absent: assume yes. */
  readonly principalExists?: (handle: string) => boolean;
  readonly log?: (line: string) => void;
  readonly pageSize?: number;
  readonly maxPerRun?: number;
  readonly maxAttempts?: number;
  readonly retryMs?: number;
  /** Injected timer, so a test can drive retries without waiting. Must not keep a process alive. */
  readonly schedule?: (run: () => void, ms: number) => { cancel(): void };
}

export interface RecapWorkerHealth {
  readonly sent: number;
  readonly failed: number;
  readonly lastReckoning: number | null;
  readonly lastEnd: RunEnd | null;
  readonly lastError: string | null;
}

/** The real timer, `unref`'d: a pending retry must never hold a shutting-down process open. */
function realSchedule(run: () => void, ms: number): { cancel(): void } {
  const t = setTimeout(run, Math.max(0, ms));
  t.unref();
  return {
    cancel: () => {
      clearTimeout(t);
    },
  };
}

/**
 * Read one published frame back off disk, or null. Defensive: a file mid-rename, a frame from
 * an older build, or a hand-edited archive must cost one run, never the process.
 */
export function readPublishedFrame(dir: string, name: string): ReckoningFrame | null {
  let raw: string;
  try {
    raw = readFileSync(join(dir, name), 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const f = parsed as Record<string, unknown>;
    if (typeof f['reckoningIndex'] !== 'number' || typeof f['tick'] !== 'number') return null;
    if (!Array.isArray(f['standings'])) return null;
    return parsed as ReckoningFrame;
  } catch {
    return null;
  }
}

export class RecapWorker {
  private readonly links: FollowLinks;
  private readonly log: (line: string) => void;
  private readonly schedule: (run: () => void, ms: number) => { cancel(): void };
  private readonly pageSize: number;
  private readonly maxPerRun: number;
  private readonly maxAttempts: number;
  private readonly retryMs: number;
  private current: Promise<RecapRunReport> | null = null;
  private again = false;
  private timer: { cancel(): void } | null = null;
  private closed = false;
  /** `${reckoning}:${id}` → attempts. Cleared whenever the Reckoning moves. */
  private attempts = new Map<string, number>();
  private attemptsFor: number | null = null;
  private stats: { sent: number; failed: number; lastReckoning: number | null; lastEnd: RunEnd | null; lastError: string | null } = {
    sent: 0,
    failed: 0,
    lastReckoning: null,
    lastEnd: null,
    lastError: null,
  };

  constructor(private readonly options: RecapWorkerOptions) {
    this.links = followLinks(options.publicUrl);
    this.log = options.log ?? ((line) => process.stderr.write(`${line}\n`));
    this.schedule = options.schedule ?? realSchedule;
    this.pageSize = options.pageSize ?? RECAP_PAGE;
    this.maxPerRun = options.maxPerRun ?? MAX_RECAPS_PER_RUN;
    this.maxAttempts = options.maxAttempts ?? MAX_RECAP_ATTEMPTS;
    this.retryMs = options.retryMs ?? RECAP_RETRY_MS;
  }

  /**
   * Start a run soon, or note that one is wanted. Returns at once and NEVER throws — it is
   * called from the tick loop, which must not learn that mail exists.
   */
  kick(): void {
    try {
      if (this.closed) return;
      if (this.current !== null) {
        this.again = true;
        return;
      }
      this.current = this.run()
        .catch((error: unknown): RecapRunReport => {
          this.stats.lastError = describeMailFailure(error);
          this.log(`follow: recap run failed (non-fatal, will retry): ${this.stats.lastError}`);
          this.retryIn(this.retryMs);
          return { reckoning: null, sent: 0, failed: 0, skipped: 0, end: 'done' };
        })
        .finally(() => {
          this.current = null;
          if (this.again && !this.closed) {
            this.again = false;
            this.kick();
          }
        });
    } catch {
      // Unreachable in practice; the contract is that the tick loop never sees a throw.
    }
  }

  /** Resolves when no run is in flight (including any follow-up a kick queued). */
  async idle(): Promise<void> {
    while (this.current !== null) {
      await this.current.catch(() => undefined);
      // A follow-up run starts synchronously in `finally`; give it a turn to register.
      await Promise.resolve();
    }
  }

  health(): RecapWorkerHealth {
    return { ...this.stats };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.timer?.cancel();
    this.timer = null;
    await this.idle();
  }

  private retryIn(ms: number): void {
    if (this.closed) return;
    this.timer?.cancel();
    this.timer = this.schedule(() => {
      this.timer = null;
      this.kick();
    }, ms);
  }

  /** One run. Public for tests; production only ever calls {@link kick}. */
  async run(): Promise<RecapRunReport> {
    const report = await this.runInner();
    this.stats.lastEnd = report.end;
    if (report.reckoning !== null) this.stats.lastReckoning = report.reckoning;
    switch (report.end) {
      case 'bound':
        this.retryIn(0);
        break;
      case 'ceiling':
        // Tomorrow's allowance, plus a margin so the reset has certainly happened.
        this.retryIn(msUntilNextUtcDay(this.options.clock.nowMs()) + CEILING_RESUME_GRACE_MS);
        break;
      case 'provider':
        this.retryIn(this.retryMs);
        break;
      case 'done':
        if (report.failed > 0) this.retryIn(this.retryMs);
        break;
      case 'off':
      case 'no-frame':
      case 'closed':
        break;
    }
    return report;
  }

  private async runInner(): Promise<RecapRunReport> {
    const { store, mailer, secret, framesDir, clock } = this.options;
    if (mailer === null || secret === null) return { reckoning: null, sent: 0, failed: 0, skipped: 0, end: 'off' };
    if (framesDir === null) return { reckoning: null, sent: 0, failed: 0, skipped: 0, end: 'no-frame' };
    const frame = readPublishedFrame(framesDir, LATEST);
    if (frame === null) return { reckoning: null, sent: 0, failed: 0, skipped: 0, end: 'no-frame' };
    const R = frame.reckoningIndex;
    const previous = R > 0 ? readPublishedFrame(framesDir, frameFileName(R - 1)) : null;
    if (this.attemptsFor !== R) {
      this.attempts = new Map();
      this.attemptsFor = R;
    }

    // Data, minimised: a confirmation nobody clicked within its window is deleted, address
    // and all. Best-effort — a failure here must not cost tonight's recaps.
    await store.pruneExpiredPending(clock.nowMs() - FOLLOW_CONFIRM_TTL_MS).catch(() => 0);

    const recapLimit = Math.floor((this.options.dailyCeiling * RECAP_CEILING_SHARE_BPS) / BPS_ONE);
    const recaps = new Map<string, Recap>();
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    let after: string | null = null;

    for (;;) {
      if (this.closed) return { reckoning: R, sent, failed, skipped, end: 'closed' };
      const page: readonly FollowRow[] = await store.dueForRecap(R, after, this.pageSize);
      if (page.length === 0) break;
      for (const row of page) {
        after = row.id;
        if (this.closed) return { reckoning: R, sent, failed, skipped, end: 'closed' };
        const key = `${String(R)}:${row.id}`;
        if ((this.attempts.get(key) ?? 0) >= this.maxAttempts) {
          skipped += 1;
          continue;
        }
        if (this.options.principalExists !== undefined && !this.options.principalExists(row.handle)) {
          // A handle that left this world (a re-seed) has no story to tell; say nothing.
          skipped += 1;
          continue;
        }
        if (sent >= this.maxPerRun) return { reckoning: R, sent, failed, skipped, end: 'bound' };

        let recap = recaps.get(row.handle);
        if (recap === undefined) {
          recap = buildRecap({ frame, previous, handle: row.handle });
          recaps.set(row.handle, recap);
        }
        const token = unsubscribeTokenFor(secret, row.id);
        const tokenHash = hashToken(token);
        // A rotated `COMPACT_FOLLOW_SECRET` re-derives every token; re-stamp the stored hash
        // BEFORE the email carrying the new link goes out, or that link would not work.
        if (tokenHash !== row.unsubscribeTokenHash) await store.setUnsubscribeHash(row.id, tokenHash);

        if (!(await store.reserveMail(utcDay(clock.nowMs()), recapLimit))) {
          this.log(`follow: the day's recap allowance (${String(recapLimit)}) is spent; resuming after UTC midnight`);
          return { reckoning: R, sent, failed, skipped, end: 'ceiling' };
        }
        const mail = composeRecap(recap, {
          recordUrl: this.links.record(row.handle),
          unsubscribeUrl: this.links.unsubscribe(token),
        });
        try {
          await mailer.send({
            to: row.email,
            subject: mail.subject,
            text: mail.text,
            html: mail.html,
            headers: mail.headers,
            idempotencyKey: `recap-${row.id}-r${String(R)}`,
          });
        } catch (error: unknown) {
          failed += 1;
          this.stats.failed += 1;
          this.attempts.set(key, (this.attempts.get(key) ?? 0) + 1);
          this.stats.lastError = describeMailFailure(error);
          // The follow's random id, never its address.
          this.log(`follow: recap for Reckoning ${String(R)} not sent (follow ${row.id}): ${this.stats.lastError}`);
          if (error instanceof MailError && (error.fatal || error.status === 429)) {
            return { reckoning: R, sent, failed, skipped, end: 'provider' };
          }
          continue;
        }
        await store.markRecapSent(row.id, R, clock.nowMs());
        sent += 1;
        this.stats.sent += 1;
      }
    }
    return { reckoning: R, sent, failed, skipped, end: 'done' };
  }
}
