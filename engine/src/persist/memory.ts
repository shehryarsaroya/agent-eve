/**
 * The in-memory journal store.
 *
 * Two jobs, and the second is the important one:
 *
 *   1. A store the durability tier can run against with **no external Postgres
 *      dependency**, so the round-trip — the actual risk this whole module exists to
 *      close — is exercised on every `vitest run`.
 *   2. The reference semantics the pg impl must match: append-only in time (a tick
 *      may not be appended behind the head), snapshots keyed by tick, enrolments in
 *      insertion order. If the two stores can disagree, the CI-tested one is the
 *      contract and the pg impl is measured against it.
 *
 * It is deliberately strict — `appendTick` refuses a regressing or duplicate tick —
 * because the failure it is guarding against (a doubled or dropped tick) is exactly
 * what the durability test's mutation proof injects, and a lenient store would
 * swallow the very corruption the test is trying to catch.
 */

import type {
  DivergenceRecord,
  EnrollmentRecord,
  JournalStore,
  SnapshotDigest,
  SnapshotRecord,
  TickRecord,
} from './store.js';

export class JournalStoreError extends Error {}

export class InMemoryJournalStore implements JournalStore {
  private seed: string | null = null;
  private rules: number | null = null;
  private readonly ticksByTick = new Map<number, TickRecord>();
  private readonly snapshotsByTick = new Map<number, SnapshotRecord>();
  private readonly enrollmentLog: EnrollmentRecord[] = [];
  private readonly divergenceLog: DivergenceRecord[] = [];
  private head = -1;

  init(masterSeed: string): Promise<void> {
    if (masterSeed.length === 0) {
      return Promise.reject(new JournalStoreError('a run needs a non-empty master seed'));
    }
    // Write-once. A second, different seed on the same store is a divergence the
    // caller must catch (boot reads `masterSeed` and refuses a mismatch), so this
    // records the first and never silently overwrites it.
    if (this.seed === null) this.seed = masterSeed;
    return Promise.resolve();
  }

  masterSeed(): Promise<string | null> {
    return Promise.resolve(this.seed);
  }

  appendTick(record: TickRecord): Promise<void> {
    if (this.ticksByTick.has(record.tick)) {
      return Promise.reject(
        new JournalStoreError(
          `tick ${String(record.tick)} is already journalled; the record is append-only in time`,
        ),
      );
    }
    if (record.tick <= this.head) {
      return Promise.reject(
        new JournalStoreError(
          `cannot append tick ${String(record.tick)} at or behind the head ${String(this.head)}`,
        ),
      );
    }
    this.ticksByTick.set(record.tick, record);
    this.head = record.tick;
    return Promise.resolve();
  }

  writeSnapshot(record: SnapshotRecord): Promise<void> {
    const existing = this.snapshotsByTick.get(record.tick);
    if (existing !== undefined && existing.stateHash !== record.stateHash) {
      // Two different snapshots at one tick means two different worlds claimed the
      // same checkpoint — the worst possible shape of bug for a durable record.
      return Promise.reject(
        new JournalStoreError(
          `snapshot at tick ${String(record.tick)} already stored with a different state_hash ` +
            `(${existing.stateHash} vs ${record.stateHash})`,
        ),
      );
    }
    this.snapshotsByTick.set(record.tick, record);
    return Promise.resolve();
  }

  latestSnapshot(): Promise<SnapshotRecord | null> {
    let best: SnapshotRecord | null = null;
    for (const snap of this.snapshotsByTick.values()) {
      if (best === null || snap.tick > best.tick) best = snap;
    }
    return Promise.resolve(best);
  }

  snapshots(): Promise<readonly SnapshotRecord[]> {
    return Promise.resolve(
      [...this.snapshotsByTick.values()].sort((a, b) => a.tick - b.tick),
    );
  }

  async snapshotHashes(): Promise<readonly SnapshotDigest[]> {
    return (await this.snapshots()).map((s) => ({ tick: s.tick, stateHash: s.stateHash }));
  }

  ticksSince(tick: number): Promise<readonly TickRecord[]> {
    return Promise.resolve(
      [...this.ticksByTick.values()].filter((t) => t.tick > tick).sort((a, b) => a.tick - b.tick),
    );
  }

  async ticksPage(tick: number, limit: number): Promise<readonly TickRecord[]> {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new JournalStoreError(`a page needs a positive integer limit, got ${String(limit)}`);
    }
    // The reference semantics the pg impl is measured against: strictly-after,
    // ascending, at most `limit`, and a short page means the end.
    return (await this.ticksSince(tick)).slice(0, limit);
  }

  headTick(): Promise<number> {
    return Promise.resolve(this.head);
  }

  recordRulesVersion(version: number): Promise<void> {
    // Write-once, exactly like the seed. What matters is which rules the OLD ticks
    // were computed under, and an upsert would erase precisely that.
    if (this.rules === null) this.rules = version;
    return Promise.resolve();
  }

  journalledRulesVersion(): Promise<number | null> {
    return Promise.resolve(this.rules);
  }

  recordDivergence(record: DivergenceRecord): Promise<void> {
    this.divergenceLog.push(record);
    return Promise.resolve();
  }

  divergences(): Promise<readonly DivergenceRecord[]> {
    return Promise.resolve(
      this.divergenceLog
        .map((d, i) => ({ d, i }))
        .sort((a, b) => a.d.tick - b.d.tick || a.i - b.i)
        .map(({ d }) => d),
    );
  }

  recordEnrollment(record: EnrollmentRecord): Promise<void> {
    this.enrollmentLog.push(record);
    return Promise.resolve();
  }

  enrollments(): Promise<readonly EnrollmentRecord[]> {
    // Ascending by enrolment tick, ties broken by insertion order — the order boot
    // must re-apply them in for the world to reach the same state at each tick.
    return Promise.resolve(
      this.enrollmentLog
        .map((e, i) => ({ e, i }))
        .sort((a, b) => a.e.enrolledAtTick - b.e.enrolledAtTick || a.i - b.i)
        .map(({ e }) => e),
    );
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  // ── Test-only durability surgery ──────────────────────────────────────────

  /**
   * Drop every tick and snapshot strictly after `tick`, simulating a lost tail — a
   * hard kill with an unflushed buffer, or a torn write.
   *
   * The durability test's mutation proof: boot from the truncated store and the head
   * hash must differ from the un-truncated boot, which is what proves the round-trip
   * assertion would *bite* on a real lost tick rather than passing vacuously.
   */
  dropTicksAfter(tick: number): void {
    for (const t of [...this.ticksByTick.keys()]) if (t > tick) this.ticksByTick.delete(t);
    for (const t of [...this.snapshotsByTick.keys()]) if (t > tick) this.snapshotsByTick.delete(t);
    this.head = tick;
  }

  /** Rows currently held, for test assertions. */
  get tickCount(): number {
    return this.ticksByTick.size;
  }
}
