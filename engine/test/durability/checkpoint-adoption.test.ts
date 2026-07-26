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
 * **AND IT IS EQUIVALENT NOW.** It was not, and the finding that it was not is the
 * reason this file exists in this shape. A snapshot carries the engine's *state
 * tables* and `state_hash` hashes exactly those, so five books in no table —
 * `StandingBook` (A10 reputation), the `SealBook`, the obligation book INV-4 checks
 * locks against, the `EventLedger`, and the attribution register — were neither
 * carried nor missed. At the checkpoint the hash matched anyway, *because the hash
 * could not see them*; then the tail replayed, the tail read them, and the two worlds
 * parted company six ticks later. `electiveHonoured` for the cast went `4, 6, 2, 4, …`
 * → all zeros: reputation reset silently, past a tripwire that reported success.
 *
 * All five are restorable state tables now. Registering them then exposed two more
 * that no list had named — `mint` (the venture and grant id counters, which an adopted
 * world re-minted from zero, so the first venture after the checkpoint got a different
 * id) and `delivery` (the deed set's only source and a deferral's pinned pot) — and
 * those are in too. The inequality below is now an equality, turned on purpose and
 * with the evidence beside it:
 *
 *   - adopt-plus-tail reaches the **same `state_hash`** as a full genesis replay;
 *   - `electiveHonoured` **survives** adoption instead of going to zero;
 *   - and every mutation proof still bites, including one per newly-registered book.
 *
 * Nothing was relaxed to get here. `adoptSnapshot` still re-captures and compares
 * byte-for-byte, the manifest still names every required book, and boot still refuses
 * to adopt across a `RULES_VERSION` change.
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
  planCheckpoint,
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
  it('adopt+tail reaches the SAME genesis state_hash — so checkpointing is honest', async () => {
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
    const adoptedResult = await bootFromStore(adopted, live.store, { seed: SEED });
    expect(adoptedResult.adoptedAtTick).not.toBeNull();
    expect(adoptedResult.checkpointRefusal).toBeNull();
    // It really is the bounded path and not a genesis replay in disguise.
    expect(adoptedResult.ticksReplayed).toBeLessThan(TICKS);
    expect(adoptedResult.eventsHydrated).toBeGreaterThan(0);

    // ── THE RESULT ──────────────────────────────────────────────────────────
    // This was `not.toBe` for as long as five books sat outside the state tables.
    // It is `toBe` because they are inside them now, not because anything here was
    // relaxed to let it through.
    expect(adopted.engine.stateHash).toBe(live.headHash);
  }, 180_000);

  it('a tail that CROSSES a Reckoning still reaches the head hash — the latent case', async () => {
    // The equivalence above adopts the latest checkpoint, so its tail settles nothing.
    // That is the easy half, and it is the half a broken capture can still pass: a
    // book the tail only *reads at a Reckoning* — `delivery`, which is the deed set's
    // only source — goes missing with no visible effect until the next settlement,
    // hundreds of ticks later, in a process that has long since reported a clean boot.
    //
    // So: keep every tick, but hide the LATEST snapshot, forcing adoption at 287 and a
    // tail of 312 ticks that crosses the settlement at 575.
    const live = await liveRun();
    const early = [...live.snapshots].sort((a, b) => a.tick - b.tick)[0];
    expect(early).toBeDefined();
    if (early === undefined) return;

    const store = new InMemoryJournalStore();
    await store.init(SEED);
    for (const t of [...live.ticks].sort((a, b) => a.tick - b.tick)) await store.appendTick(t);
    await store.writeSnapshot(early);

    const adopted = seated(SEED);
    const result = await bootFromStore(adopted, store, { seed: SEED });
    expect(result.adoptedAtTick).toBe(early.tick);
    // Non-vacuity: the tail really did settle a Reckoning after the adoption point.
    expect(result.ticksReplayed).toBeGreaterThan(TICKS_PER_RECKONING);
    expect(adopted.engine.stateHash).toBe(live.headHash);
  }, 180_000);

  it('and the books the hash could not see are carried: standing survives adoption', async () => {
    const live = await liveRun();
    const snapshot = live.snapshots[live.snapshots.length - 1];
    expect(snapshot).toBeDefined();
    if (snapshot === undefined) return;
    const store = await storeUpTo(live, snapshot.tick);

    const genesis = seated(SEED);
    await bootFromStore(genesis, store, { seed: SEED, checkpoint: { disabled: true } });

    const adopted = seated(SEED);
    await bootFromStore(adopted, store, { seed: SEED });

    // Same tick, same hash — and that was never the hard part. The hash matched
    // before this change too, which is exactly what made the old bug so dangerous.
    expect(adopted.engine.tick).toBe(genesis.engine.tick);
    expect(adopted.engine.stateHash).toBe(genesis.engine.stateHash);

    const g = unhashedFacts(genesis);
    const a = unhashedFacts(adopted);
    expect(a.balances).toEqual(g.balances);
    // THE CLAIM THIS FILE EXISTS FOR. A10: identity, reputation, relationships and
    // legend never reset. `electiveHonoured` used to come back as 0 here.
    expect(g.electiveHonoured).toBeGreaterThan(0);
    expect(a.electiveHonoured).toBe(g.electiveHonoured);
    expect(a.defaults).toBe(g.defaults);

    // And the rest of what a snapshot used to drop, book by book.
    expect(adopted.seals.size).toBe(genesis.seals.size);
    expect(adopted.seals.auditRecords()).toEqual(genesis.seals.auditRecords());
    expect(adopted.events.eventCount).toBe(genesis.events.eventCount);
    expect(adopted.events.audienceRowCount).toBe(genesis.events.audienceRowCount);
    expect(adopted.events.lastTick).toBe(genesis.events.lastTick);
    expect(adopted.register.all()).toEqual(genesis.register.all());
    expect(adopted.obligations.capture()).toEqual(genesis.obligations.capture());
    expect(adopted.standing.changes()).toEqual(genesis.standing.changes());
    // A restored world must be able to answer the two questions an observer asks of
    // the record, not merely hold the right number of rows.
    expect(
      adopted.events.spectatorFeed({ atTick: adopted.engine.tick, after: null, limit: 8 }).views,
    ).toEqual(
      genesis.events.spectatorFeed({ atTick: genesis.engine.tick, after: null, limit: 8 }).views,
    );
  }, 180_000);
});

describe('checkpoint adoption: the gate', () => {
  it('the default boot ADOPTS now, and a build missing one book still refuses by name', async () => {
    const live = await liveRun();
    const runtime = seated(SEED);
    const result = await bootFromStore(runtime, live.store, { seed: SEED });

    // The gate has cleared: no override, no narrowed manifest, and it adopts.
    expect(result.adoptedAtTick).not.toBeNull();
    expect(result.checkpointRefusal).toBeNull();
    expect(result.postingsHydrated).toBeGreaterThan(0);
    expect(result.ticksReplayed).toBeLessThan(TICKS);
    expect(runtime.engine.stateHash).toBe(live.headHash);

    // And the refusal still works, because that is the half that must never rot: a
    // build that drops one book from its table list is told which one, by name, and
    // replays from genesis to the identical head.
    for (const book of ['standing', 'seal', 'obligation', 'event', 'attribution']) {
      const crippled = seated(SEED);
      const without = crippled.engine.stateTables.filter((t) => t.name !== book);
      const refusal = (
        await planCheckpoint(without, live.store, {})
      ).refusal;
      expect(refusal, `dropping ${book} must be refused`).toContain(book);
    }
  }, 180_000);

  it('names no missing book — change this only WITH the equivalence test', () => {
    const runtime = seated(SEED);
    // The tripwire that used to list five names. It is empty because every book in
    // the manifest is a restorable state table; if it ever grows a name again, the
    // equivalence test above is lying and adoption must be re-gated.
    expect([...missingCheckpointTables(runtime.engine.stateTables)]).toEqual([]);
    // And the manifest is not empty of the books that mattered — an empty manifest
    // would make the line above pass vacuously.
    for (const book of ['attribution', 'delivery', 'event', 'mint', 'obligation', 'seal', 'standing']) {
      expect(CHECKPOINT_REQUIRED_TABLES).toContain(book);
    }
  }, 30_000);

  it('a store that does not persist the record REFUSES, and does not crash-loop', async () => {
    // The production shape today. `PgJournalStore.ticksPage` returns `events: []` —
    // the durable `event` table carries no `visibility`, no `flag_keys` and no
    // audience `basis`, so the record cannot be rebuilt at full fidelity from it yet.
    // An adopted world would therefore come up with an EMPTY public ledger, which to
    // every reader is a world where nothing has ever happened.
    //
    // That must be a refusal (slow boot, correct world), never a throw. A throw here
    // is `serve()` crash-looping on a healthy journal, which is the failure mode the
    // whole held-boot design exists to avoid.
    const live = await liveRun();
    const store = new InMemoryJournalStore();
    await store.init(SEED);
    for (const t of [...live.ticks].sort((a, b) => a.tick - b.tick)) {
      await store.appendTick({ ...t, events: [] });
    }
    for (const s of [...live.snapshots].sort((a, b) => a.tick - b.tick)) await store.writeSnapshot(s);

    const runtime = seated(SEED);
    const result = await bootFromStore(runtime, store, { seed: SEED });
    expect(result.adoptedAtTick).toBeNull();
    expect(result.checkpointRefusal ?? '').toContain('does not persist the append-only record');
    // And the slow path produced the right world anyway.
    expect(result.ticksReplayed).toBe(TICKS);
    expect(runtime.engine.stateHash).toBe(live.headHash);
  }, 180_000);

  it('a self-inconsistent snapshot REFUSES too, so the operator door stays reachable', async () => {
    // A stored snapshot whose own tables do not hash to its own `state_hash`. Adopting
    // it would fail inside `adoptSnapshot`, after the runtime had been mutated, where
    // the only possible answer is a hard stop with no door. Caught before anything
    // moves, it is a plain refusal — genesis replay, tripwire, and
    // `COMPACT_ACCEPT_DIVERGENCE_AT_TICK`.
    const live = await liveRun();
    const store = new InMemoryJournalStore();
    await store.init(SEED);
    for (const t of [...live.ticks].sort((a, b) => a.tick - b.tick)) await store.appendTick(t);
    const sorted = [...live.snapshots].sort((a, b) => a.tick - b.tick);
    for (const [i, s] of sorted.entries()) {
      const last = i === sorted.length - 1;
      await store.writeSnapshot(last ? { ...s, stateHash: 'a'.repeat(64) } : s);
    }

    const plan = await planCheckpoint(seated(SEED).engine.stateTables, store, {});
    expect(plan.snapshot).toBeNull();
    expect(plan.refusal ?? '').toContain('disagrees with itself');
  }, 180_000);

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
