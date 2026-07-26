/**
 * The journal store's contract and the tick extractor.
 *
 * The in-memory store is the reference the pg impl is measured against, so its
 * semantics are pinned directly: append-only in time, snapshots keyed by tick and
 * refusing a conflicting hash, enrolments in insertion order. The extractor is
 * pinned to pull exactly the three write artifacts and to drop engine-derived intent
 * runs (which regenerate on replay).
 */

import { describe, expect, it } from 'vitest';
import { Runtime } from '../../src/sim/runtime.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { InMemoryJournalStore, JournalStoreError, extractTick } from '../../src/persist/index.js';
import type { EnrollmentRecord, TickRecord } from '../../src/persist/index.js';
import type { TickReport } from '../../src/tick/index.js';
import type { PrincipalId } from '../../src/core/types.js';

function tickRecord(tick: number): TickRecord {
  return { tick, seed: `s:t${String(tick)}`, seedHash: `h:t${String(tick)}`, events: [], postings: [], actions: [] };
}

describe('InMemoryJournalStore is append-only in time', () => {
  it('refuses a duplicate tick', async () => {
    const store = new InMemoryJournalStore();
    await store.appendTick(tickRecord(0));
    await expect(store.appendTick(tickRecord(0))).rejects.toThrow(JournalStoreError);
  });

  it('refuses a lower, non-duplicate tick — the head guard, not the duplicate check', async () => {
    const store = new InMemoryJournalStore();
    await store.appendTick(tickRecord(0));
    await store.appendTick(tickRecord(5)); // head jumps to 5
    // Tick 3 was never appended, so this is the head guard firing, not the dup check.
    await expect(store.appendTick(tickRecord(3))).rejects.toThrow(/behind the head/);
    expect(await store.headTick()).toBe(5);
  });

  it('ticksSince returns strictly-later ticks, ascending', async () => {
    const store = new InMemoryJournalStore();
    for (const t of [0, 1, 2, 3]) await store.appendTick(tickRecord(t));
    const since = await store.ticksSince(1);
    expect(since.map((t) => t.tick)).toEqual([2, 3]);
    expect((await store.ticksSince(-1)).map((t) => t.tick)).toEqual([0, 1, 2, 3]);
  });
});

describe('InMemoryJournalStore snapshots', () => {
  it('latestSnapshot returns the highest-tick snapshot', async () => {
    const store = new InMemoryJournalStore();
    await store.writeSnapshot({ tick: 5, stateHash: 'a', stateVersion: 1, tables: [], seed: 's', seedHash: 'h' });
    await store.writeSnapshot({ tick: 11, stateHash: 'b', stateVersion: 2, tables: [], seed: 's', seedHash: 'h' });
    expect((await store.latestSnapshot())?.tick).toBe(11);
    expect((await store.snapshots()).map((s) => s.tick)).toEqual([5, 11]);
  });

  it('refuses two different snapshots at one tick', async () => {
    const store = new InMemoryJournalStore();
    await store.writeSnapshot({ tick: 5, stateHash: 'a', stateVersion: 1, tables: [], seed: 's', seedHash: 'h' });
    // Idempotent re-write of the same hash is fine.
    await store.writeSnapshot({ tick: 5, stateHash: 'a', stateVersion: 1, tables: [], seed: 's', seedHash: 'h' });
    await expect(
      store.writeSnapshot({ tick: 5, stateHash: 'DIFFERENT', stateVersion: 1, tables: [], seed: 's', seedHash: 'h' }),
    ).rejects.toThrow(/different state_hash/);
  });
});

describe('InMemoryJournalStore enrolments', () => {
  it('returns enrolments ordered by tick then insertion', async () => {
    const store = new InMemoryJournalStore();
    const e = (p: string, tick: number): EnrollmentRecord => ({
      principal: p as PrincipalId,
      handle: p,
      publicKey: 'k',
      enrolledAtTick: tick,
      ownerEmail: null,
    });
    await store.recordEnrollment(e('p:c', 10));
    await store.recordEnrollment(e('p:a', 5));
    await store.recordEnrollment(e('p:b', 5)); // same tick as a, later insertion
    expect((await store.enrollments()).map((x) => x.principal)).toEqual(['p:a', 'p:b', 'p:c']);
  });
});

describe('extractTick pulls the three write artifacts', () => {
  it('extracts events, postings and submitted actions from a committed tick', async () => {
    const runtime = new Runtime({ seed: 'extract-1' });
    const cast = new HeuristicCast(runtime, { size: 4 });
    cast.seat('extract-1');
    // Run far enough that a Reckoning settles and value moves (events + postings).
    let last: TickReport | null = null;
    let anyWithEvents = false;
    let anyWithActions = false;
    for (let i = 0; i < 300; i += 1) {
      const target = runtime.engine.tick + 1;
      for (const a of cast.decide(target, 'extract-1')) runtime.engine.submit(a);
      const report = runtime.runTick();
      const rec = extractTick(runtime, report);
      if (rec.events.length > 0) anyWithEvents = true;
      if (rec.actions.length > 0) anyWithActions = true;
      // Every persisted action is a genuine submission (intent runs filtered out).
      expect(rec.actions.every((a) => a.arrivalOrdinal !== null)).toBe(true);
      last = report;
    }
    expect(last).not.toBeNull();
    expect(anyWithEvents).toBe(true);
    expect(anyWithActions).toBe(true);

    // Postings accumulate across the run; the last settlement tick moved value.
    const total = (await Promise.resolve(runtime.ledger.allBatches())).length;
    expect(total).toBeGreaterThan(0);
  });

  it('carries every batch field a hydrated ledger needs, including the NAMED faucet', async () => {
    const runtime = new Runtime({ seed: 'extract-supply' });
    const cast = new HeuristicCast(runtime, { size: 4 });
    cast.seat('extract-supply');
    const store = new InMemoryJournalStore();
    await store.init('extract-supply');
    for (let i = 0; i < 40; i += 1) {
      const target = runtime.engine.tick + 1;
      for (const a of cast.decide(target, 'extract-supply')) runtime.engine.submit(a);
      await store.appendTick(extractTick(runtime, runtime.runTick()));
    }

    const rows = await store.postingsInRange(0, 39);
    expect(rows.length).toBeGreaterThan(0);

    // Append order, on integers only. This is the order the ledger's array is rebuilt
    // in, and `restoreTo` truncates that array positionally.
    for (let i = 1; i < rows.length; i += 1) {
      const prev = rows[i - 1];
      const cur = rows[i];
      if (prev === undefined || cur === undefined) continue;
      const before =
        prev.tick < cur.tick ||
        (prev.tick === cur.tick &&
          (prev.seqInTick < cur.seqInTick ||
            (prev.seqInTick === cur.seqInTick && prev.postingIndex < cur.postingIndex)));
      expect(before, `row ${String(i)} is out of append order`).toBe(true);
    }

    // A supply change names its faucet or sink; a TRANSFER names none. Both halves,
    // because dropping either is what makes `checkInv7`'s third mirror unrebuildable.
    const supply = rows.filter((r) => r.batchKind !== 'TRANSFER');
    expect(supply.length).toBeGreaterThan(0);
    expect(supply.every((r) => r.supplyAccount !== null && r.supplyAccount.length > 0)).toBe(true);
    expect(rows.filter((r) => r.batchKind === 'TRANSFER').every((r) => r.supplyAccount === null)).toBe(
      true,
    );
    // Every row carries the event that caused it, so a batch can be traced.
    expect(rows.every((r) => r.eventId.length > 0)).toBe(true);

    // The window is a window: nothing outside it, and an inverted one reads nothing.
    const early = await store.postingsInRange(0, 3);
    expect(early.every((r) => r.tick <= 3)).toBe(true);
    expect(early.length).toBeLessThan(rows.length);
    expect(await store.postingsInRange(20, 19)).toEqual([]);
  });

  it('refuses to extract a halted tick — nothing was published', () => {
    const runtime = new Runtime({ seed: 'extract-halt' });
    new HeuristicCast(runtime, { size: 2 }).seat('extract-halt');
    const halted = { tick: 3, halted: true } as unknown as TickReport;
    expect(() => extractTick(runtime, halted)).toThrow(/halted/);
  });
});
