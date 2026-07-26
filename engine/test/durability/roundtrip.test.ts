/**
 * THE DURABILITY TIER (TESTING.md §0's sixth speed).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THIS IS THE TEST THAT WOULD HAVE MADE THE DEFECT IMPOSSIBLE TO MISS.**
 *
 * Until the journal existed, the "permanent public record" was one Node process's
 * heap: `serve()` built the world from genesis on every boot, and every restart
 * reset it to tick 0. A5, A5′ and A10 were false at the substrate. Written the way a
 * golden file predates its bug: run a real sim through several Reckonings against the
 * in-memory store, then DISCARD the runtime, BOOT A FRESH ONE from the store alone,
 * and assert it is byte-for-byte the same world.
 *
 * The crux is the determinism round-trip: **boot must reproduce the exact
 * `state_hash`.** If it does not, that is a snapshot/replay determinism bug and the
 * most important thing in this file — so the assertion is `toBe`, not `toBeCloseTo`,
 * and the mutation proof below shows it bites on a single lost tick.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { Runtime, freeStores } from '../../src/sim/runtime.js';
import { HeuristicCast } from '../../src/cast/index.js';
import {
  InMemoryJournalStore,
  Journal,
  bootFromStore,
  type SnapshotRecord,
  type TickRecord,
} from '../../src/persist/index.js';
import { isSettlementTick } from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';

const SEED = 'durability-1';
const CAST_SIZE = 6;
/** Enough to cross two Reckonings (settlements at 287 and 575) plus a partial third. */
const TICKS = 600;
/** A mid-Reckoning tick, deliberately NOT a settlement tick, for the kill test. */
const KILL_TICK = 400;

/** A legible summary of the world, for a fact-by-fact comparison beyond the hash. */
interface KeyFacts {
  readonly headTick: number;
  readonly stateHash: string;
  /** balance + standing per principal, in canonical id order. */
  readonly principals: readonly {
    readonly id: PrincipalId;
    readonly balance: number;
    readonly electiveHonoured: number;
    readonly electiveHonouredValue: number;
    readonly defaults: number;
    readonly contradictedSeals: number;
  }[];
  /** Every venture's `id::state`, sorted — proves the settlement outcomes survived. */
  readonly ventures: readonly string[];
  readonly settledOrDefaulted: number;
}

function factsOf(runtime: Runtime): KeyFacts {
  const principals = [...runtime.world.principalOrder]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((id) => {
      const s = runtime.standing.row(id);
      return {
        id,
        balance: freeStores(runtime.ledger, id),
        electiveHonoured: s.electiveHonoured,
        electiveHonouredValue: s.electiveHonouredValue,
        defaults: s.defaults,
        contradictedSeals: s.contradictedSeals,
      };
    });
  const ventures = runtime.ventures
    .all()
    .map((v) => `${v.id}::${v.state}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const settledOrDefaulted = runtime.ventures
    .all()
    .filter((v) => v.state === 'SETTLED' || v.state === 'DEFAULTED').length;
  return { headTick: runtime.engine.tick, stateHash: runtime.engine.stateHash, principals, ventures, settledOrDefaulted };
}

/** A freshly-seated genesis runtime, exactly as `serve()` builds one. */
function seatedRuntime(seed: string): Runtime {
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size: CAST_SIZE });
  cast.seat(seed);
  return runtime;
}

interface LiveRun {
  readonly store: InMemoryJournalStore;
  readonly perTickHash: ReadonlyMap<number, string>;
  readonly facts: KeyFacts;
  readonly eventsPersisted: number;
  readonly postingsPersisted: number;
  readonly actionsPersisted: number;
}

/** Run a real sim, persisting every tick through the live {@link Journal}. */
async function runLive(seed: string, ticks: number): Promise<LiveRun> {
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size: CAST_SIZE });
  cast.seat(seed);
  const store = new InMemoryJournalStore();
  const journal = new Journal(store);
  await bootFromStore(runtime, store, { seed }); // GENESIS: records the master seed

  const perTickHash = new Map<number, string>();
  for (let i = 0; i < ticks; i += 1) {
    const target = runtime.engine.tick + 1;
    for (const action of cast.decide(target, seed)) runtime.engine.submit(action);
    const report = runtime.runTick();
    if (report.halted) throw new Error(`live sim halted at tick ${String(report.tick)}`);
    journal.record(runtime, report);
    await journal.flushPending();
    perTickHash.set(report.tick, report.stateHash);
  }
  await journal.drain();

  const all = await store.ticksSince(-1);
  const events = all.reduce((n, t) => n + t.events.length, 0);
  const postings = all.reduce((n, t) => n + t.postings.length, 0);
  const actions = all.reduce((n, t) => n + t.actions.length, 0);
  return {
    store,
    perTickHash,
    facts: factsOf(runtime),
    eventsPersisted: events,
    postingsPersisted: postings,
    actionsPersisted: actions,
  };
}

/** A fresh in-memory store holding only the records up to and including `upTo`. */
async function storeUpTo(
  seed: string,
  ticks: readonly TickRecord[],
  snaps: readonly SnapshotRecord[],
  upTo: number,
): Promise<InMemoryJournalStore> {
  const store = new InMemoryJournalStore();
  await store.init(seed);
  for (const t of [...ticks].sort((a, b) => a.tick - b.tick)) {
    if (t.tick <= upTo) await store.appendTick(t);
  }
  for (const s of [...snaps].sort((a, b) => a.tick - b.tick)) {
    if (s.tick <= upTo) await store.writeSnapshot(s);
  }
  return store;
}

/** Boot a fresh runtime from a store and return it plus the boot result. */
async function boot(seed: string, store: InMemoryJournalStore): Promise<{ runtime: Runtime; result: Awaited<ReturnType<typeof bootFromStore>> }> {
  const runtime = seatedRuntime(seed);
  const result = await bootFromStore(runtime, store, { seed });
  return { runtime, result };
}

describe('durability: boot-from-store reproduces the world', () => {
  it('a full run round-trips to the exact head state_hash and every key fact', async () => {
    const live = await runLive(SEED, TICKS);

    // The sim must actually have DONE something, or the round-trip proves nothing.
    expect(live.facts.settledOrDefaulted).toBeGreaterThan(0);
    expect(live.eventsPersisted).toBeGreaterThan(0);
    expect(live.postingsPersisted).toBeGreaterThan(0);
    expect(live.actionsPersisted).toBeGreaterThan(0);

    const { runtime: booted, result } = await boot(SEED, live.store);

    expect(result.mode).toBe('REPLAY');
    expect(result.headTick).toBe(TICKS - 1);
    // Two Reckonings crossed, so at least two snapshot tripwires were checked and passed.
    expect(result.tripwiresChecked).toBeGreaterThanOrEqual(2);

    // THE CRUX: byte-for-byte the same world.
    expect(booted.engine.stateHash).toBe(live.facts.stateHash);
    // And the legible facts, beyond the hash (standing is not even a hashed table —
    // it is reproduced only by replaying every Reckoning, so this proves replay
    // rebuilt derived state too).
    expect(factsOf(booted)).toEqual(live.facts);
  }, 120_000);

  it('a mid-Reckoning kill boots to the correct head', async () => {
    const live = await runLive(SEED, TICKS);
    expect(isSettlementTick(KILL_TICK)).toBe(false); // genuinely mid-Reckoning

    const all = await live.store.ticksSince(-1);
    const snaps = await live.store.snapshots();
    const killStore = await storeUpTo(SEED, all, snaps, KILL_TICK);

    const { runtime: booted, result } = await boot(SEED, killStore);
    expect(result.headTick).toBe(KILL_TICK);
    // The partial third... no — KILL_TICK 400 is in the second Reckoning, so exactly
    // one settlement (287) was crossed and its tripwire checked.
    expect(result.tripwiresChecked).toBeGreaterThanOrEqual(1);
    expect(booted.engine.stateHash).toBe(live.perTickHash.get(KILL_TICK));
  }, 120_000);

  it('MUTATION PROOF: dropping the last appended tick diverges the head hash', async () => {
    const live = await runLive(SEED, TICKS);
    const all = await live.store.ticksSince(-1);
    const snaps = await live.store.snapshots();

    // A store missing exactly the final tick — a lost tail, a torn write.
    const truncated = await storeUpTo(SEED, all, snaps, TICKS - 1);
    truncated.dropTicksAfter(TICKS - 2);

    const { runtime: booted } = await boot(SEED, truncated);
    expect(booted.engine.tick).toBe(TICKS - 2);
    // The round-trip assertion in the first test would FAIL here — that is the proof
    // it bites on a real lost tick rather than passing vacuously.
    expect(booted.engine.stateHash).not.toBe(live.facts.stateHash);
    expect(booted.engine.stateHash).toBe(live.perTickHash.get(TICKS - 2));
  }, 120_000);

  it('the master seed is a divergence guard: a different seed refuses to boot', async () => {
    const live = await runLive(SEED, 40);
    await expect(boot('a-different-seed', live.store)).rejects.toThrow(/different seed/);
  }, 60_000);
});

describe('durability: standing intents regenerate on replay, never double-counted', () => {
  // The heuristic cast deliberately creates no standing intents, so this is the only
  // place the intent-run path is exercised through the round-trip. Intent runs are
  // engine-derived (null arrival) — the extractor must drop them from the durable
  // action log, and replay must regenerate them from the (replayed) intent so the
  // hash still reproduces. If either were wrong, an intent run would be replayed twice.
  const ISEED = 'intent-durability';
  const seatTrio = (runtime: Runtime): void => {
    for (const n of ['vale', 'orison', 'halcyon']) runtime.seat(`p:${n}` as PrincipalId, n);
  };

  it('boots to the exact hash while filtering intent runs from the record', async () => {
    const runtime = new Runtime({ seed: ISEED });
    seatTrio(runtime);
    const store = new InMemoryJournalStore();
    const journal = new Journal(store);
    await bootFromStore(runtime, store, { seed: ISEED });

    // One submitted action that creates a standing intent; it then runs every tick.
    runtime.engine.submit({
      principal: 'p:vale' as PrincipalId,
      verb: 'set_delivery_intent',
      params: { intent: { verb: 'move', params: { hand: 'nope', to: 'nowhere' } }, until_tick: 40 },
      clientSequence: 1,
      arrivalMs: 0,
      decisionSource: 'LIVE',
    });

    let ticksWithIntentRun = 0;
    let recordsHeldAnIntentRun = false;
    for (let i = 0; i < 20; i += 1) {
      const report = runtime.runTick();
      journal.record(runtime, report);
      await journal.flushPending();
      if (runtime.engine.log.forTick(report.tick).some((a) => a.arrivalOrdinal === null)) {
        ticksWithIntentRun += 1;
      }
    }
    await journal.drain();
    const headHash = runtime.engine.stateHash;

    // The intent genuinely ran (non-vacuous), and NO intent run reached the durable log.
    expect(ticksWithIntentRun).toBeGreaterThan(0);
    for (const t of await store.ticksSince(-1)) {
      if (t.actions.some((a) => a.arrivalOrdinal === null)) recordsHeldAnIntentRun = true;
    }
    expect(recordsHeldAnIntentRun).toBe(false);

    // Boot: the submitted set_delivery_intent replays, recreates the intent, and its
    // runs regenerate — reproducing the exact hash.
    const booted = new Runtime({ seed: ISEED });
    seatTrio(booted);
    const result = await bootFromStore(booted, store, { seed: ISEED });
    expect(result.ticksReplayed).toBe(20);
    expect(booted.engine.stateHash).toBe(headHash);
  }, 60_000);
});
