/**
 * The persistence-failure policy: a transient DB outage must not halt a live world,
 * must not silently proceed as if persisted, and must lose nothing on recovery.
 *
 * The world keeps ticking through the outage (records are buffered, `record` never
 * throws); `durableTick` never overstates the frontier; sustained failure flips
 * health to unhealthy; and when the store recovers the backlog drains in order with
 * no gap and no duplicate. A {@link FlakyStore} makes the outage deterministic —
 * no timers, no sleeps — so the policy is asserted exactly rather than raced.
 */

import { describe, expect, it } from 'vitest';
import { Runtime } from '../../src/sim/runtime.js';
import { HeuristicCast } from '../../src/cast/index.js';
import {
  FAILURE_ALARM_THRESHOLD,
  InMemoryJournalStore,
  Journal,
} from '../../src/persist/index.js';
import type {
  EnrollmentRecord,
  JournalStore,
  SnapshotRecord,
  TickRecord,
} from '../../src/persist/index.js';

/** An in-memory store that fails every write while `failing` is set. */
class FlakyStore implements JournalStore {
  failing = false;
  readonly inner = new InMemoryJournalStore();

  private guard(): void {
    if (this.failing) throw new Error('DB down');
  }
  init(seed: string): Promise<void> {
    return this.inner.init(seed);
  }
  masterSeed(): Promise<string | null> {
    return this.inner.masterSeed();
  }
  appendTick(record: TickRecord): Promise<void> {
    this.guard();
    return this.inner.appendTick(record);
  }
  writeSnapshot(record: SnapshotRecord): Promise<void> {
    this.guard();
    return this.inner.writeSnapshot(record);
  }
  latestSnapshot(): Promise<SnapshotRecord | null> {
    return this.inner.latestSnapshot();
  }
  snapshots(): Promise<readonly SnapshotRecord[]> {
    return this.inner.snapshots();
  }
  ticksSince(tick: number): Promise<readonly TickRecord[]> {
    return this.inner.ticksSince(tick);
  }
  headTick(): Promise<number> {
    return this.inner.headTick();
  }
  recordEnrollment(record: EnrollmentRecord): Promise<void> {
    this.guard();
    return this.inner.recordEnrollment(record);
  }
  enrollments(): Promise<readonly EnrollmentRecord[]> {
    return this.inner.enrollments();
  }
  close(): Promise<void> {
    return this.inner.close();
  }
}

const SEED = 'journal-1';

describe('the persistence-failure policy', () => {
  it('buffers through an outage, never overstates durability, alarms, then loses nothing', async () => {
    const runtime = new Runtime({ seed: SEED });
    const cast = new HeuristicCast(runtime, { size: 4 });
    cast.seat(SEED);
    const flaky = new FlakyStore();
    await flaky.init(SEED);
    const journal = new Journal(flaky);

    const runAndRecord = (n: number): void => {
      for (let i = 0; i < n; i += 1) {
        const target = runtime.engine.tick + 1;
        for (const a of cast.decide(target, SEED)) runtime.engine.submit(a);
        const report = runtime.runTick();
        if (report.halted) throw new Error(`sim halted at ${String(report.tick)}`);
        // The load-bearing line: recording a committed tick NEVER throws, so the
        // world keeps moving regardless of the store's health.
        journal.record(runtime, report);
      }
    };

    // Healthy: ticks 0..2 reach the store.
    runAndRecord(3);
    await journal.flushPending();
    expect(journal.health().durableTick).toBe(2);
    expect(journal.health().healthy).toBe(true);

    // Outage begins. The world keeps ticking; nothing here throws.
    flaky.failing = true;
    runAndRecord(2); // ticks 3, 4 buffered

    // Each flush attempt fails and leaves the item at the head; after the threshold,
    // health is unhealthy — the operator's alarm.
    for (let i = 0; i < FAILURE_ALARM_THRESHOLD; i += 1) await journal.flushPending();
    const sick = journal.health();
    expect(sick.healthy).toBe(false);
    expect(sick.durableTick).toBe(2); // never claims 3 or 4 are durable
    expect(sick.headTick).toBe(4);
    expect(sick.backlog).toBeGreaterThanOrEqual(2);
    expect(sick.lastError).toContain('DB down');

    // Recovery: one flush drains the whole backlog, in order.
    flaky.failing = false;
    await journal.flushPending();
    const well = journal.health();
    expect(well.healthy).toBe(true);
    expect(well.durableTick).toBe(4);
    expect(well.backlog).toBe(0);
    expect(well.consecutiveFailures).toBe(0);

    // No gap, no duplicate: exactly ticks 0..4, once each.
    const persisted = (await flaky.inner.ticksSince(-1)).map((t) => t.tick);
    expect(persisted).toEqual([0, 1, 2, 3, 4]);
  }, 30_000);

  it('drain flushes a healthy backlog for a clean shutdown', async () => {
    const runtime = new Runtime({ seed: SEED });
    const cast = new HeuristicCast(runtime, { size: 3 });
    cast.seat(SEED);
    const store = new InMemoryJournalStore();
    await store.init(SEED);
    const journal = new Journal(store);

    for (let i = 0; i < 4; i += 1) {
      const target = runtime.engine.tick + 1;
      for (const a of cast.decide(target, SEED)) runtime.engine.submit(a);
      journal.record(runtime, runtime.runTick());
    }
    // Nothing flushed yet: the buffer holds all four ticks.
    expect(journal.health().backlog).toBe(4);
    expect(journal.health().durableTick).toBe(-1);

    await journal.drain();
    expect(journal.health().backlog).toBe(0);
    expect(journal.health().durableTick).toBe(3);
    expect((await store.ticksSince(-1)).length).toBe(4);
  }, 30_000);
});
