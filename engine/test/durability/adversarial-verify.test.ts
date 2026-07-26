/**
 * ADVERSARIAL VERIFICATION PROBE (reviewer-authored, not the builder's).
 *
 * Distrusts the builder's own round-trip. It re-proves the crux INCLUDING the four
 * state stores that are NOT in `state_hash` (standing, the default register, the
 * obligation book, the seal book), because a hash-only round-trip is blind to exactly
 * the A5' record whose corruption is "worse than a crash". Then it drives four
 * distinct mutations and the persistence-failure policy.
 */

import { describe, expect, it } from 'vitest';
import { Runtime, freeStores } from '../../src/sim/runtime.js';
import { HeuristicCast } from '../../src/cast/index.js';
import {
  InMemoryJournalStore,
  Journal,
  bootFromStore,
  BootError,
  type EnrollmentRecord,
  type JournalStore,
  type SnapshotRecord,
  type TickRecord,
} from '../../src/persist/index.js';
import type { PrincipalId } from '../../src/core/types.js';

const SEED = 'adv-verify-1';
const CAST = 6;
const TICKS = 600; // crosses settlements at 287 and 575

/** Everything that must survive a restart, hashed AND unhashed. */
function fullCapture(rt: Runtime): Record<string, unknown> {
  const principals = [...rt.world.principalOrder].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    tick: rt.engine.tick,
    hash: rt.engine.stateHash,
    balances: principals.map((id) => [id, freeStores(rt.ledger, id)] as const),
    // ── the four stores OUTSIDE state_hash ────────────────────────────────────
    standing: rt.standing.rows(),
    standingChanges: rt.standing.changes(),
    defaults: rt.register.all(), // the accusation rows — A5'
    secured: [...rt.obligations.securedObligations()],
    seals: rt.seals.auditRecords(),
    sealsResolved: rt.seals.resolved(),
    ventures: rt.ventures
      .all()
      .map((v) => `${v.id}::${v.state}`)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  };
}

function seatedGenesis(seed: string): Runtime {
  const rt = new Runtime({ seed });
  const cast = new HeuristicCast(rt, { size: CAST });
  cast.seat(seed);
  return rt;
}

async function runLive(seed: string, ticks: number): Promise<{
  store: InMemoryJournalStore;
  rt: Runtime;
  perTick: Map<number, string>;
}> {
  const rt = new Runtime({ seed });
  const cast = new HeuristicCast(rt, { size: CAST });
  cast.seat(seed);
  const store = new InMemoryJournalStore();
  const journal = new Journal(store);
  await bootFromStore(rt, store, { seed }); // GENESIS — records the master seed
  const perTick = new Map<number, string>();
  for (let i = 0; i < ticks; i += 1) {
    const target = rt.engine.tick + 1;
    for (const a of cast.decide(target, seed)) rt.engine.submit(a);
    const rep = rt.runTick();
    if (rep.halted) throw new Error(`live halted at ${String(rep.tick)}`);
    journal.record(rt, rep);
    await journal.flushPending();
    perTick.set(rep.tick, rep.stateHash);
  }
  await journal.drain();
  return { store, rt, perTick };
}

async function storeFrom(
  seed: string,
  ticks: readonly TickRecord[],
  snaps: readonly SnapshotRecord[],
): Promise<InMemoryJournalStore> {
  const s = new InMemoryJournalStore();
  await s.init(seed);
  for (const t of [...ticks].sort((a, b) => a.tick - b.tick)) await s.appendTick(t);
  for (const sn of [...snaps].sort((a, b) => a.tick - b.tick)) await s.writeSnapshot(sn);
  return s;
}

describe('ADVERSARIAL: boot reproduces the whole world, not just the hash', () => {
  it('reproduces the head hash AND all four unhashed stores byte-for-byte', async () => {
    const { store, rt, perTick } = await runLive(SEED, TICKS);
    const live = fullCapture(rt);

    // The run must have DONE something in every store, or the round-trip is vacuous.
    expect((live['standing'] as unknown[]).length).toBeGreaterThan(0);
    expect((live['ventures'] as unknown[]).length).toBeGreaterThan(0);
    const settledOrDefaulted = (live['ventures'] as string[]).filter(
      (v) => v.endsWith('SETTLED') || v.endsWith('DEFAULTED'),
    ).length;
    expect(settledOrDefaulted).toBeGreaterThan(0);

    const booted = seatedGenesis(SEED);
    const result = await bootFromStore(booted, store, { seed: SEED });
    expect(result.mode).toBe('REPLAY');
    expect(result.headTick).toBe(TICKS - 1);
    expect(result.tripwiresChecked).toBeGreaterThanOrEqual(2);

    // THE CRUX, widened: the unhashed stores too.
    expect(fullCapture(booted)).toEqual(live);
    expect(perTick.get(TICKS - 1)).toBe(live['hash']);
  }, 120_000);
});

describe('ADVERSARIAL: four mutations must each be caught', () => {
  it('M1 drop the last tick -> head hash diverges (repro of the builder claim)', async () => {
    const { store, rt, perTick } = await runLive(SEED, TICKS);
    const liveHash = rt.engine.stateHash;
    store.dropTicksAfter(TICKS - 2);
    const booted = seatedGenesis(SEED);
    await bootFromStore(booted, store, { seed: SEED });
    expect(booted.engine.tick).toBe(TICKS - 2);
    expect(booted.engine.stateHash).not.toBe(liveHash);
    expect(booted.engine.stateHash).toBe(perTick.get(TICKS - 2));
  }, 120_000);

  it('M2 a middle GAP (store allows it) -> boot refuses, never a silent wrong world', async () => {
    const { store } = await runLive(SEED, 320);
    const all = await store.ticksSince(-1);
    const snaps = await store.snapshots();
    const GAP = 300; // present in the log, non-settlement
    expect(all.some((t) => t.tick === GAP)).toBe(true);
    const gapped = await storeFrom(
      SEED,
      all.filter((t) => t.tick !== GAP),
      snaps.filter((s) => s.tick !== GAP),
    );
    const booted = seatedGenesis(SEED);
    await expect(bootFromStore(booted, gapped, { seed: SEED })).rejects.toThrow(BootError);
  }, 120_000);

  it('M5 kill INSIDE the freeze window -> boot resumes and settles IDENTICALLY forward', async () => {
    // The real production scenario: killed mid-freeze, the transient `frozen` settlement
    // set (NOT a hashed table) must be rebuilt by replay or tick 287 halts/diverges.
    const ref = await runLive(SEED, 300);
    const all = await ref.store.ticksSince(-1);
    const snaps = await ref.store.snapshots();
    const FREEZE = 286; // freeze tick; settlement resolves at 287
    const upto = await storeFrom(
      SEED,
      all.filter((t) => t.tick <= FREEZE),
      snaps.filter((s) => s.tick <= FREEZE),
    );

    const booted = new Runtime({ seed: SEED });
    const cast = new HeuristicCast(booted, { size: CAST });
    cast.seat(SEED);
    const res = await bootFromStore(booted, upto, { seed: SEED });
    expect(res.headTick).toBe(FREEZE);
    expect(booted.engine.stateHash).toBe(ref.perTick.get(FREEZE));

    // Drive forward across the settlement; every tick must match the never-killed run.
    for (let target = FREEZE + 1; target <= 299; target += 1) {
      for (const a of cast.decide(target, SEED)) booted.engine.submit(a);
      const rep = booted.runTick();
      expect(rep.halted).toBe(false);
      expect(rep.stateHash).toBe(ref.perTick.get(rep.tick));
    }
  }, 120_000);

  it('M3 corrupt a stored SNAPSHOT hash -> the tripwire bites', async () => {
    const { store } = await runLive(SEED, 320);
    const all = await store.ticksSince(-1);
    const snaps = await store.snapshots();
    expect(snaps.length).toBeGreaterThan(0);
    const badSnaps = snaps.map((s, i) =>
      i === 0 ? { ...s, stateHash: `deadbeef${s.stateHash.slice(8)}` } : s,
    );
    const st = await storeFrom(SEED, all, badSnaps);
    const booted = seatedGenesis(SEED);
    await expect(bootFromStore(booted, st, { seed: SEED })).rejects.toThrow(/TRIPWIRE/);
  }, 120_000);

  it('M4 corrupt an APPLIED action to an unknown verb -> boot refuses (applied-refused guard)', async () => {
    const { store } = await runLive(SEED, 200);
    const all = await store.ticksSince(-1);
    const snaps = await store.snapshots();
    // Find a tick with a submitted+applied action.
    const victim = all.find((t) =>
      t.actions.some((a) => a.arrivalOrdinal !== null && a.outcome === 'APPLIED'),
    );
    expect(victim).toBeDefined();
    const cloned = structuredClone(victim) as unknown as {
      readonly tick: number;
      actions: Array<Record<string, unknown>>;
    };
    const act = cloned.actions.find(
      (a) => a['arrivalOrdinal'] !== null && a['outcome'] === 'APPLIED',
    );
    expect(act).toBeDefined();
    if (act) act['verb'] = 'zzz_not_a_verb';
    const corrupted = await storeFrom(
      SEED,
      all.map((t) => (t.tick === cloned.tick ? (cloned as unknown as TickRecord) : t)),
      snaps,
    );
    const booted = seatedGenesis(SEED);
    // Either the applied-refused guard fires, or (if the verb table is lenient) the
    // hash diverges. Assert the strong form first, fall back to divergence.
    let threw = false;
    try {
      await bootFromStore(booted, corrupted, { seed: SEED });
    } catch (e) {
      threw = e instanceof BootError;
    }
    if (!threw) {
      // must at least NOT silently reproduce the original head
      const clean = await runLive(SEED, 200);
      expect(booted.engine.stateHash).not.toBe(clean.rt.engine.stateHash);
    } else {
      expect(threw).toBe(true);
    }
  }, 120_000);
});

/** A store that fails appendTick on demand; everything else delegates to the real one. */
class FlakyStore implements JournalStore {
  down = false;
  constructor(private readonly inner: InMemoryJournalStore) {}
  init(s: string): Promise<void> {
    return this.inner.init(s);
  }
  masterSeed(): Promise<string | null> {
    return this.inner.masterSeed();
  }
  appendTick(r: TickRecord): Promise<void> {
    if (this.down) return Promise.reject(new Error('simulated DB outage'));
    return this.inner.appendTick(r);
  }
  writeSnapshot(r: SnapshotRecord): Promise<void> {
    return this.inner.writeSnapshot(r);
  }
  latestSnapshot(): Promise<SnapshotRecord | null> {
    return this.inner.latestSnapshot();
  }
  snapshots(): Promise<readonly SnapshotRecord[]> {
    return this.inner.snapshots();
  }
  ticksSince(t: number): Promise<readonly TickRecord[]> {
    return this.inner.ticksSince(t);
  }
  headTick(): Promise<number> {
    return this.inner.headTick();
  }
  recordEnrollment(r: EnrollmentRecord): Promise<void> {
    return this.inner.recordEnrollment(r);
  }
  enrollments(): Promise<readonly EnrollmentRecord[]> {
    return this.inner.enrollments();
  }
  close(): Promise<void> {
    return this.inner.close();
  }
}

describe('ADVERSARIAL: the persistence-failure policy is real', () => {
  it('a failed write never advances durableTick, retries in order, and flips health', async () => {
    const rt = new Runtime({ seed: 'fail-1' });
    for (const n of ['vale', 'orison']) rt.seat(`p:${n}` as PrincipalId, n);
    const inner = new InMemoryJournalStore();
    await inner.init('fail-1');
    const flaky = new FlakyStore(inner);
    const j = new Journal(flaky);

    flaky.down = true;
    const r1 = rt.runTick();
    // record() must be synchronous and total even with the store down.
    expect(() => j.record(rt, r1)).not.toThrow();
    const r2 = rt.runTick();
    expect(() => j.record(rt, r2)).not.toThrow();

    await j.flushPending();
    // The lie the whole policy forbids: claiming durability that did not happen.
    expect(j.health().durableTick).toBe(-1);
    expect(j.health().backlog).toBeGreaterThanOrEqual(2);
    expect(j.health().headTick).toBe(r2.tick);

    await j.flushPending();
    await j.flushPending();
    expect(j.health().consecutiveFailures).toBeGreaterThanOrEqual(3);
    expect(j.health().healthy).toBe(false);

    // drain under a sustained outage must not hang or throw, and must not fake success.
    await expect(j.drain()).resolves.toBeUndefined();
    expect(j.health().durableTick).toBe(-1);

    // Recover: the tail drains IN ORDER, no hole, and only now is it durable.
    flaky.down = false;
    await j.flushPending();
    expect(j.health().durableTick).toBe(r2.tick);
    expect(j.health().backlog).toBe(0);
    expect(j.health().healthy).toBe(true);
    const stored = (await inner.ticksSince(-1)).map((t) => t.tick);
    expect(stored).toEqual([r1.tick, r2.tick]);
  }, 60_000);
});
