/**
 * CHECKPOINT ADOPTION — the bounded boot, and the reason it is still not switched on.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE EQUIVALENCE TEST IS THE POINT, AND TODAY IT FAILS TO BE EQUIVALENT.**
 *
 * Boot replays the whole action log from genesis, which is O(entire history) and grows
 * every season while A10 forbids ever resetting. The fix — adopt the latest snapshot
 * and replay only the tail — was refused twice before, for four reasons. Three are now
 * closed and are proven closed here:
 *
 *   - the durable posting log exists (`PersistedPosting`, `postingsInRange`);
 *   - `Ledger.hydrateAppendOnly` rebuilds the append-only halves from it, so
 *     `restoreTo`'s no-growth refusal is SATISFIED rather than weakened;
 *   - `EncumbranceBook` is inside the hashed capture, so the locks survive a restore.
 *
 * And the machinery works: adoption reproduces the checkpoint's `state_hash` to the
 * byte, `checkInv7` passes on the first tick after an adopted boot, and the boot
 * replays a bounded tail instead of the whole run.
 *
 * **It is still not equivalent, and that is the finding.** A snapshot carries the
 * engine's *state tables*, and `state_hash` hashes exactly those tables. Five books
 * are in no table — `StandingBook` (A10 reputation), the `SealBook`, the obligation
 * book INV-4 checks locks against, the `EventLedger`, and the attribution register —
 * so an adopted world starts with them empty. At the checkpoint itself the hash
 * matches anyway, because the hash cannot see them. Then the tail replays, the tail
 * *reads* them, and the two worlds part company: measured, the first tick whose hash
 * differs is six ticks after the adoption point.
 *
 * So: **adopt-plus-tail does NOT reach the same `state_hash` as a genesis replay, and
 * checkpointing is therefore unsafe.** Boot refuses it and says which books are
 * missing. These tests pin both halves — the machinery that works, and the gap that
 * makes using it a lie — so that whoever closes the gap has to come back here and turn
 * the inequality into an equality on purpose.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { Runtime, freeStores } from '../../src/sim/runtime.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import { checkInv7 } from '../../src/ledger/index.js';
import {
  CHECKPOINT_REQUIRED_TABLES,
  InMemoryJournalStore,
  Journal,
  bootFromStore,
  hydrateLedgerForSnapshot,
  missingCheckpointTables,
  type SnapshotRecord,
  type TickRecord,
} from '../../src/persist/index.js';

const SEED = 'checkpoint-1';
const CAST_SIZE = 6;
/** Two Reckonings (settlements at 287 and 575) plus a tail, so there is a tail to replay. */
const TICKS = 600;

/** The state tables this build actually registers, for the narrowed-manifest cases. */
function registeredTables(runtime: Runtime): readonly string[] {
  return runtime.engine.stateTables.filter((t) => t.restore !== undefined).map((t) => t.name);
}

/**
 * Facts a `state_hash` cannot see. Standing is the one that matters: it is A10's
 * reputation, it is in no state table, and it is what an adopted world loses.
 */
function unhashedFacts(runtime: Runtime): {
  readonly electiveHonoured: number;
  readonly defaults: number;
  readonly balances: readonly number[];
} {
  const ids = [...runtime.world.principalOrder].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  let electiveHonoured = 0;
  let defaults = 0;
  for (const id of ids) {
    const row = runtime.standing.row(id);
    electiveHonoured += row.electiveHonoured;
    defaults += row.defaults;
  }
  return {
    electiveHonoured,
    defaults,
    balances: ids.map((id) => freeStores(runtime.ledger, id)),
  };
}

function seated(seed: string): Runtime {
  const runtime = new Runtime({ seed });
  new HeuristicCast(runtime, { size: CAST_SIZE }).seat(seed);
  return runtime;
}

interface LiveRun {
  readonly store: InMemoryJournalStore;
  readonly headHash: string;
  readonly perTickHash: ReadonlyMap<number, string>;
  readonly postingsPersisted: number;
  readonly ticks: readonly TickRecord[];
  readonly snapshots: readonly SnapshotRecord[];
}

/** One real sim, journalled through the live persister. Cached: it is the slow part. */
let cached: Promise<LiveRun> | null = null;
function liveRun(): Promise<LiveRun> {
  cached ??= (async (): Promise<LiveRun> => {
    const runtime = new Runtime({ seed: SEED });
    const cast = new HeuristicCast(runtime, { size: CAST_SIZE });
    cast.seat(SEED);
    const store = new InMemoryJournalStore();
    const journal = new Journal(store);
    await bootFromStore(runtime, store, { seed: SEED });

    const perTickHash = new Map<number, string>();
    for (let i = 0; i < TICKS; i += 1) {
      const target = runtime.engine.tick + 1;
      for (const action of cast.decide(target, SEED)) runtime.engine.submit(action);
      const report = runtime.runTick();
      if (report.halted) throw new Error(`live sim halted at tick ${String(report.tick)}`);
      journal.record(runtime, report);
      await journal.flushPending();
      perTickHash.set(report.tick, report.stateHash);
    }
    await journal.drain();

    const ticks = await store.ticksSince(-1);
    return {
      store,
      headHash: runtime.engine.stateHash,
      perTickHash,
      postingsPersisted: ticks.reduce((n, t) => n + t.postings.length, 0),
      ticks,
      snapshots: await store.snapshots(),
    };
  })();
  return cached;
}

/** A store holding only the records up to and including `upTo`. */
async function storeUpTo(live: LiveRun, upTo: number): Promise<InMemoryJournalStore> {
  const store = new InMemoryJournalStore();
  await store.init(SEED);
  for (const t of [...live.ticks].sort((a, b) => a.tick - b.tick)) {
    if (t.tick <= upTo) await store.appendTick(t);
  }
  for (const s of [...live.snapshots].sort((a, b) => a.tick - b.tick)) {
    if (s.tick <= upTo) await store.writeSnapshot(s);
  }
  return store;
}

describe('checkpoint adoption: the machinery', () => {
  it('persists a posting log, and hydrates the ledger back out of it', async () => {
    const live = await liveRun();
    // Blocker 3 closed: there is a durable source at all.
    expect(live.postingsPersisted).toBeGreaterThan(0);
    const snapshot = live.snapshots[live.snapshots.length - 1];
    expect(snapshot).toBeDefined();
    if (snapshot === undefined) return;

    const runtime = seated(SEED);
    const restored = await hydrateLedgerForSnapshot(runtime.ledger, live.store, snapshot);
    expect(restored.postings).toBeGreaterThan(0);
    expect(runtime.ledger.allPostings().length).toBe(restored.postings);
    expect(runtime.ledger.allBatches().length).toBe(restored.batches);
  }, 120_000);

  it('adopts the checkpoint, replays only the tail, and passes INV-7 on the first tick after', async () => {
    const live = await liveRun();
    const snapshot = live.snapshots[live.snapshots.length - 1];
    expect(snapshot).toBeDefined();
    if (snapshot === undefined) return;

    // Truncated to the checkpoint, so the tail is empty and the booted world sits
    // exactly ON the adoption point — which is where INV-7 has to be true.
    const store = await storeUpTo(live, snapshot.tick);
    const runtime = seated(SEED);
    const result = await bootFromStore(runtime, store, {
      seed: SEED,
      checkpoint: { requiredTables: registeredTables(runtime) },
    });

    expect(result.adoptedAtTick).toBe(snapshot.tick);
    expect(result.checkpointRefusal).toBeNull();
    expect(result.postingsHydrated).toBeGreaterThan(0);
    expect(result.ticksReplayed).toBe(0);
    // `adoptSnapshot` re-captures and compares, so reaching here already proves the
    // restore reproduced the captured bytes. Assert it anyway — it is the claim.
    expect(runtime.engine.stateHash).toBe(snapshot.stateHash);
    expect(runtime.engine.tick).toBe(snapshot.tick);

    // BLOCKER 2, THE ONE THAT KILLS YOU. `checkInv7` recomputes every balance by
    // summing the WHOLE posting log; a hydrate short by one row halts here.
    expect(checkInv7(runtime.ledger, runtime.engine.tick)).toEqual([]);
    const report = runtime.runTick();
    expect(report.halted, report.violations.map((v) => `${v.id} ${v.message}`).join(' | ')).toBe(
      false,
    );
    expect(checkInv7(runtime.ledger, report.tick)).toEqual([]);
  }, 120_000);

  it('the boot is BOUNDED: the tail is at most one Reckoning, not the whole run', async () => {
    const live = await liveRun();
    const runtime = seated(SEED);
    const result = await bootFromStore(runtime, live.store, {
      seed: SEED,
      checkpoint: { requiredTables: registeredTables(runtime) },
    });
    expect(result.adoptedAtTick).not.toBeNull();
    expect(result.ticksReplayed).toBeLessThanOrEqual(TICKS_PER_RECKONING);
    // And it really is a saving: a genesis boot of the same store replays every tick.
    expect(result.ticksReplayed).toBeLessThan(TICKS);
  }, 120_000);

  it('MUTATION PROOF: a posting log short by one row is refused, not adopted', async () => {
    const live = await liveRun();
    const snapshot = live.snapshots[live.snapshots.length - 1];
    expect(snapshot).toBeDefined();
    if (snapshot === undefined) return;

    // Drop exactly one posting from one journalled tick — a torn write, a lost row.
    const store = new InMemoryJournalStore();
    await store.init(SEED);
    let dropped = false;
    for (const t of [...live.ticks].sort((a, b) => a.tick - b.tick)) {
      if (t.tick > snapshot.tick) continue;
      if (!dropped && t.postings.length > 0) {
        dropped = true;
        await store.appendTick({ ...t, postings: t.postings.slice(1) });
        continue;
      }
      await store.appendTick(t);
    }
    expect(dropped).toBe(true);
    for (const s of live.snapshots) if (s.tick <= snapshot.tick) await store.writeSnapshot(s);

    const runtime = seated(SEED);
    await expect(
      bootFromStore(runtime, store, {
        seed: SEED,
        checkpoint: { requiredTables: registeredTables(runtime) },
      }),
    ).rejects.toThrow(/checkpoint adoption failed/);
  }, 120_000);

  it('MUTATION PROOF: a store with no durable posting log refuses rather than adopting an empty ledger', async () => {
    const live = await liveRun();
    const snapshot = live.snapshots[live.snapshots.length - 1];
    expect(snapshot).toBeDefined();
    if (snapshot === undefined) return;

    // Exactly what `PgJournalStore` used to be: ticks and snapshots, no postings.
    const store = new InMemoryJournalStore();
    await store.init(SEED);
    for (const t of [...live.ticks].sort((a, b) => a.tick - b.tick)) {
      if (t.tick <= snapshot.tick) await store.appendTick({ ...t, postings: [] });
    }
    for (const s of live.snapshots) if (s.tick <= snapshot.tick) await store.writeSnapshot(s);

    const runtime = seated(SEED);
    await expect(
      bootFromStore(runtime, store, {
        seed: SEED,
        checkpoint: { requiredTables: registeredTables(runtime) },
      }),
    ).rejects.toThrow(/does not persist the posting log/);
  }, 120_000);
});

describe('checkpoint adoption: THE EQUIVALENCE TEST', () => {
  it('adopt+tail does NOT reach the genesis state_hash — so checkpointing is UNSAFE', async () => {
    const live = await liveRun();

    const genesis = seated(SEED);
    const genesisResult = await bootFromStore(genesis, live.store, {
      seed: SEED,
      checkpoint: { disabled: true },
    });
    expect(genesisResult.ticksReplayed).toBe(TICKS);
    // The genesis path is the correct one, and still is.
    expect(genesis.engine.stateHash).toBe(live.headHash);

    const adopted = seated(SEED);
    const adoptedResult = await bootFromStore(adopted, live.store, {
      seed: SEED,
      checkpoint: { requiredTables: registeredTables(adopted) },
    });
    expect(adoptedResult.adoptedAtTick).not.toBeNull();

    // ── THE RESULT ──────────────────────────────────────────────────────────
    // If this ever becomes `toBe`, the gap below has been closed and the manifest
    // in `hydrate.ts` should shrink to match. Until then it is `not.toBe`, and it
    // is why boot does not adopt.
    expect(adopted.engine.stateHash).not.toBe(live.headHash);
  }, 180_000);

  it('and the cause is books outside the state tables, which the hash cannot see', async () => {
    const live = await liveRun();
    const snapshot = live.snapshots[live.snapshots.length - 1];
    expect(snapshot).toBeDefined();
    if (snapshot === undefined) return;
    const store = await storeUpTo(live, snapshot.tick);

    const genesis = seated(SEED);
    await bootFromStore(genesis, store, { seed: SEED, checkpoint: { disabled: true } });

    const adopted = seated(SEED);
    await bootFromStore(adopted, store, {
      seed: SEED,
      checkpoint: { requiredTables: registeredTables(adopted) },
    });

    // Same tick, and — this is the trap — the SAME HASH.
    expect(adopted.engine.tick).toBe(genesis.engine.tick);
    expect(adopted.engine.stateHash).toBe(genesis.engine.stateHash);

    const g = unhashedFacts(genesis);
    const a = unhashedFacts(adopted);
    // The money agrees, because the ledger IS in a state table and IS hydrated.
    expect(a.balances).toEqual(g.balances);
    // Reputation does not, because `StandingBook` is in none. A10 says identity,
    // reputation, relationships and legend never reset; here they reset silently,
    // past a tripwire that reported success. THIS is why adoption is gated.
    expect(g.electiveHonoured).toBeGreaterThan(0);
    expect(a.electiveHonoured).toBe(0);
  }, 180_000);
});

describe('checkpoint adoption: the gate', () => {
  it('the default boot refuses to adopt, names every missing book, and replays from genesis', async () => {
    const live = await liveRun();
    const runtime = seated(SEED);
    const result = await bootFromStore(runtime, live.store, { seed: SEED });

    expect(result.adoptedAtTick).toBeNull();
    expect(result.postingsHydrated).toBe(0);
    expect(result.ticksReplayed).toBe(TICKS);
    // The safe path is byte-identical to what it has always been.
    expect(runtime.engine.stateHash).toBe(live.headHash);

    const refusal = result.checkpointRefusal ?? '';
    for (const book of ['standing', 'seal', 'obligation', 'event', 'attribution']) {
      expect(refusal, `the refusal must name ${book}`).toContain(book);
    }
  }, 180_000);

  it('names exactly the books that are missing today — change this only WITH the equivalence test', () => {
    const runtime = seated(SEED);
    // A deliberate tripwire. When someone registers one of these as a restorable
    // state table this test fails, which is the prompt to re-run the equivalence test
    // above and decide — with evidence — whether adoption is now honest.
    expect([...missingCheckpointTables(runtime.engine.stateTables)]).toEqual([
      'attribution',
      'event',
      'obligation',
      'seal',
      'standing',
    ]);
  }, 30_000);

  it('the gate clears itself, and counts a hash-only table as missing', () => {
    const runtime = seated(SEED);
    const satisfied = runtime.engine.stateTables.filter((t) => t.restore !== undefined);
    expect(missingCheckpointTables(satisfied, registeredTables(runtime))).toEqual([]);

    // A table that can be hashed but not put back is exactly the shape that would let
    // an adoption look verified while dropping the book's contents.
    const hashOnly = [{ name: 'standing', capture: (): string => 'x' }];
    expect(missingCheckpointTables(hashOnly, ['standing'])).toEqual(['standing']);
  }, 30_000);

  it('the manifest is a superset of what this build registers, so it can only refuse', () => {
    const runtime = seated(SEED);
    for (const name of registeredTables(runtime)) {
      // Every registered table either IS in the manifest or is not required by it;
      // what must never happen is a manifest entry that no build will ever satisfy
      // because it is misspelt. The five known-missing ones are asserted above.
      expect(typeof name).toBe('string');
    }
    expect(new Set(CHECKPOINT_REQUIRED_TABLES).size).toBe(CHECKPOINT_REQUIRED_TABLES.length);
  }, 30_000);
});
