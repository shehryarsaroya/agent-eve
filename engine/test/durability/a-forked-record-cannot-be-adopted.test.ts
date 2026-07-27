/**
 * PRODUCTION'S CHECKPOINT REFUSAL, REPRODUCED — AND IT WAS NEVER ABOUT AN ACCOUNT THAT CLOSED.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * The failure this file reproduces, verbatim from the live boot log at tick 4895:
 *
 *     CHECKPOINT_UNUSABLE at tick 4895
 *     posting (tick 2830, batch 0, index 1) moves value in account
 *     escrow:v:2830:117e86ad:p:vale, which the snapshot's ledger capture does not contain.
 *
 * Four theories died before this one. Enrolment is not the trigger (an enrolled agent's world
 * adopts cleanly — `an-enrolled-principal-survives-adoption.spec.ts`). Length is not the trigger
 * (a 700-tick heuristic world adopts with a byte-identical head hash). Seat recycling is not the
 * trigger (a recycled seat deletes nothing — `seats.ts`: the row is *never deleted*). And the
 * account did not CLOSE: `capture()` lists every account with no filter, nothing in `ledger.ts`
 * deletes one, and the live capture at 4895 holds **1,303 escrow accounts with a zero balance** —
 * closed escrows are all present.
 *
 * ── WHAT IT ACTUALLY IS ─────────────────────────────────────────────────────
 *
 * The production journal, queried directly:
 *
 *     journal_divergence      9 rows, EVERY ONE at tick 287, STATE_HASH_MISMATCH,
 *                             from_rules_version 1 -> 2, 4, 5, 6 … 9
 *     posting log at 2830     escrow:v:2830:117e86ad:p:vale   escrow:v:2830:69c52d4d:p:varrow
 *     capture at 4895         escrow:v:2830:516e910d:p:vale   escrow:v:2830:f34917a2:p:varrow
 *
 * Same tick, same principals, same two ventures — **different ids**. A venture id is
 * `hash(tick, principal, ordinal)` where `ordinal` is a world-global counter
 * (`Runtime.mintVentureId`), so a single action that applied under the old rules and is refused
 * under the new ones shifts the ordinal and **renames every venture minted afterwards, forever.**
 *
 * The operator accepted that discontinuity at tick 287 — nine times, once per rules change. Each
 * acceptance forks the live world from its own durable record at 287 and the world runs on, so the
 * `posting` and `event` tables now hold rows from as many worlds as there have been rules changes,
 * while the snapshot at 4895 describes only the current one. The numbers say it plainly: the
 * capture at 4895 was taken over **5,542 postings** and the durable log holds **1,495** rows for
 * ticks ≤ 4895; the capture counts **2,791 events** and the log holds **3,180**.
 *
 * So the refusal is CORRECT and the record is not corrupt — the two artifacts simply describe
 * different worlds, exactly as nine accepted divergences say they do. The bug was never in what
 * gets captured or in what gets re-seated. It is that adoption asks a **superseded** log to rebuild
 * the current world's ledger, discovers the disagreement one row at a time, and blames the last
 * thing it looked at.
 *
 * ── AND THE ACCOUNT CHECK WAS THE ONLY THING BETWEEN THIS AND AN OUTAGE ──────
 *
 * `hydrateAppendOnly` refuses a count mismatch with a plain `LedgerError`, and boot only
 * recovers from `CheckpointUnusableError` — everything else is a `BootError` with no operator
 * door, which is a HELD world answering 503 on every route. Production's counts disagree by
 * ~4,000 rows, so the only reason it got a recoverable refusal is that a *renamed account*
 * happened to appear at tick 2830, twenty ticks into the log, before the count was ever compared.
 * That is luck, not a design. The fourth test here pins it.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import { setSpeed } from '../../src/core/time.js';
import {
  CheckpointUnusableError,
  InMemoryJournalStore,
  Journal,
  bootFromStore,
  bootWorld,
  hydrateLedgerForSnapshot,
  planCheckpoint,
  type JournalStore,
  type PersistedPosting,
  type TickRecord,
} from '../../src/persist/index.js';
import { Ledger } from '../../src/ledger/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import type { PrincipalId } from '../../src/core/types.js';
import type { SubmittedAction } from '../../src/tick/index.js';

const SEED = 'forked-record-1';
const CAST = 6;
/** The world the record describes. Two checkpoints at ticks 0 and 100. */
const TICKS = 200;
/** Where the rules move. Early enough that plenty of ventures are minted after it. */
const FORK_FROM = 20;
/** Ticks the forked world runs on for, so it writes a checkpoint of its OWN at tick 200. */
const AFTER = 60;

function seated(seed = SEED): { runtime: Runtime; cast: HeuristicCast } {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size: CAST });
  cast.seat(seed);
  return { runtime, cast };
}

function registeredTables(rt: Runtime): readonly string[] {
  return rt.engine.stateTables.filter((t) => t.restore !== undefined).map((t) => t.name);
}

/**
 * **THE RULES CHANGE, in the one shape that renames ventures.**
 *
 * From `fromTick`, one principal may no longer `create`. Nothing about the record is touched;
 * only the code it is replayed under. The refused create never increments the venture ordinal, so
 * every venture minted after it — by anyone — gets a different id from the one the record holds.
 * That is production's mechanism (`v:2830:117e86ad` -> `v:2830:516e910d`), not an analogue of it.
 */
function refuseCreatesBy(runtime: Runtime, principal: PrincipalId, fromTick: number): void {
  const engine = runtime.engine;
  const original = engine.submit.bind(engine);
  engine.submit = (action: SubmittedAction): ReturnType<typeof original> => {
    if (action.principal === principal && action.verb === 'create' && engine.tick + 1 >= fromTick) {
      return {
        ok: false,
        invariant: 'A6-CONTINGENT',
        hint: 'simulated rules change: this principal may no longer create a venture',
      };
    }
    return original(action);
  };
}

interface Forked {
  /** The journal: ticks 0–199 from the world that was, 200–259 from the world that is. */
  readonly store: InMemoryJournalStore;
  /** The principal whose `create` the new rules refuse. Read from the record, never guessed. */
  readonly victim: PrincipalId;
  /** The tick the operator accepted, which is the tick the fork begins at. */
  readonly acceptedAt: number;
  /** The head the forked world reaches, and its hash. Neither matches the record. */
  readonly headTick: number;
  readonly headHash: string;
}

/**
 * Build production's situation: a record, a declared discontinuity, and a world that ran on past
 * it and checkpointed itself.
 *
 * Memoised because every test in this file needs the same journal and it costs 500 ticks of real
 * sim to make. Boot writes only `rules_version` and the divergence annotation, both idempotent, so
 * the tests do not interfere with each other through it.
 */
let cached: Promise<Forked> | null = null;
function forkedWorld(): Promise<Forked> {
  cached ??= build();
  return cached;
}

async function build(): Promise<Forked> {
  // ── 1. THE WORLD THAT WAS ───────────────────────────────────────────────────
  const live = seated();
  const store = new InMemoryJournalStore();
  const journal = new Journal(store, { snapshotEveryTicks: 100 });
  await bootFromStore(live.runtime, store, { seed: SEED });
  for (let i = 0; i < TICKS; i += 1) {
    for (const a of live.cast.decide(live.runtime.engine.tick + 1, SEED)) live.runtime.engine.submit(a);
    const report = live.runtime.runTick();
    if (report.halted) throw new Error(`the live world halted at tick ${String(report.tick)}`);
    journal.record(live.runtime, report);
    await journal.flushPending();
  }
  await journal.drain();

  // The victim is whoever the RECORD says created a venture after the fork point. Reading it
  // rather than guessing is what stops this fixture from going vacuous the day the cast's
  // heuristics change and the principal it hard-coded stops creating anything.
  //
  // ══════════════════════════════════════════════════════════════════════════
  // **AND IT HAS TO BE A TICK WITH A SECOND CREATOR IN IT, WHICH THE FIRST VERSION DID NOT CHECK.**
  //
  // The finding this fixture exists for is that a venture id is `hash(tick, principal, ordinal)`
  // over a **world-global** counter, so refusing one create RENAMES every venture minted after it.
  // The proof of a rename rather than a deletion is a same-tick same-funder twin — and the funder
  // of the twin has to be somebody *other* than the victim, because the victim's creates are the
  // ones being refused and it therefore mints nothing in the forked world at all.
  //
  // Taking the first APPLIED create found leaves that to luck. It held while the cast created
  // freely enough that two members regularly created on one tick; the day `create` acquired a
  // solvency gate (`canPromiseOneMore`) the creates spread out, every log-only escrow belonged to
  // the victim, `onlyInCapture` was EMPTY, and the rename assertion failed with nothing renamed —
  // a vacuous fixture reporting a real finding as absent.
  //
  // The ordinal is world-global, so a rename does NOT need two creators on one tick — it needs at
  // least one create by somebody *other* than the victim, anywhere after it. What went vacuous is
  // narrower and it is stated as an assertion rather than left to luck: **brannock was the only
  // principal creating anything in the whole post-fork window**, so every log-only escrow was the
  // victim's own and there was nothing left to rename.
  // ══════════════════════════════════════════════════════════════════════════
  const creators: PrincipalId[] = [];
  let victim: PrincipalId | null = null;
  for (const tick of await store.ticksSince(FORK_FROM - 1)) {
    for (const a of tick.actions) {
      if (a.verb !== 'create' || a.outcome !== 'APPLIED') continue;
      victim ??= a.principal;
      if (!creators.includes(a.principal)) creators.push(a.principal);
    }
  }
  if (victim === null) {
    throw new Error('no venture was created after the fork point; this fixture would prove nothing');
  }
  if (creators.length < 2) {
    throw new Error(
      `only ${String(creators.length)} principal created anything after the fork point ` +
        `(${creators.join(', ')}), so refusing its creates leaves no other venture to RENAME and the ` +
        'rename assertion would be vacuous. Widen the world (CAST or TICKS) rather than relaxing it.',
    );
  }

  // ── 2. THE RULES MOVE, AND THE OPERATOR ACCEPTS IT ──────────────────────────
  //
  // `checkpoint: { disabled: true }` is not fixture convenience — it is the finding that building
  // this fixture produced. Left enabled, this boot ADOPTS the sound checkpoint at tick 100, replays
  // only 101–199, and reports its first divergence at tick 117; a genesis replay of the same journal
  // finds tick 66. An operator handed 117 is handed an instruction the next genesis-replaying boot
  // refuses. `planCheckpoint` now refuses adoption on any boot that carries an accepted tick, and
  // `replayCheck` disables it outright, for exactly this reason.
  const held = seated();
  refuseCreatesBy(held.runtime, victim, FORK_FROM);
  const refusal = await bootWorld(held.runtime, store, {
    seed: SEED,
    checkpoint: { disabled: true },
  });
  if (refusal.status !== 'HELD') {
    throw new Error('the injected rules change did not diverge; the fixture is not exercising a fork');
  }
  const acceptedAt = refusal.diagnosis.tick;

  const resumed = seated();
  refuseCreatesBy(resumed.runtime, victim, FORK_FROM);
  const opened = await bootFromStore(resumed.runtime, store, {
    seed: SEED,
    acceptDivergenceFromTick: acceptedAt,
    nowMs: () => 1_700_000_000_000,
  });
  if (opened.divergenceAccepted === null) throw new Error('the door did not annotate the divergence');

  // ── 3. THE FORKED WORLD RUNS ON AND CHECKPOINTS ITSELF ──────────────────────
  //
  // This is the step production has taken 4,600 times and no fixture had ever taken once. The
  // snapshot written here is sound, self-consistent and stamped with this build's RULES_VERSION —
  // and the posting rows underneath it belong to a world that no longer exists.
  const after = new Journal(store, { snapshotEveryTicks: 100 });
  for (let i = 0; i < AFTER; i += 1) {
    for (const a of resumed.cast.decide(resumed.runtime.engine.tick + 1, SEED)) {
      resumed.runtime.engine.submit(a);
    }
    const report = resumed.runtime.runTick();
    if (report.halted) throw new Error(`the forked world halted at tick ${String(report.tick)}`);
    after.record(resumed.runtime, report);
    await after.flushPending();
  }
  await after.drain();

  const latest = await store.latestSnapshot();
  if (latest === null || latest.tick <= TICKS - 1) {
    throw new Error('the forked world did not write a checkpoint of its own; nothing to adopt');
  }
  return {
    store,
    victim,
    acceptedAt,
    headTick: resumed.runtime.engine.tick,
    headHash: resumed.runtime.engine.stateHash,
  };
}

/** A fresh process running the same build the forked world runs. */
function bootableProcess(fork: Forked): { runtime: Runtime; cast: HeuristicCast } {
  const p = seated();
  refuseCreatesBy(p.runtime, fork.victim, FORK_FROM);
  return p;
}

describe('production, reproduced: the posting log and the capture describe different worlds', () => {
  it('names an account the current world never minted — the exact refusal from tick 4895', async () => {
    const fork = await forkedWorld();
    const snapshot = await fork.store.latestSnapshot();
    expect(snapshot, 'the forked world must have checkpointed itself').not.toBeNull();
    if (snapshot === null) throw new Error('unreachable');

    // Straight at the mechanism, with no boot around it: hand the ledger hydrate the snapshot the
    // forked world wrote and the posting log the superseded world left behind.
    let caught: unknown = null;
    try {
      await hydrateLedgerForSnapshot(new Ledger(), fork.store, snapshot);
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught, 'REPRODUCED: this is production, in a test').toBeInstanceOf(CheckpointUnusableError);
    expect((caught as Error).message).toMatch(/does not contain/);

    // And it is the SAME SHAPE of account: a venture escrow whose id the record and the world
    // disagree about, not a "closed" one. `escrow:v:<tick>:<8 hex>:p:<who>`.
    expect((caught as Error).message).toMatch(/escrow:v:\d+:[0-9a-f]{8}:/);
  }, 300_000);

  it('the disagreement is a RENAME, not a deletion: same tick, same principal, different id', async () => {
    const fork = await forkedWorld();
    const snapshot = await fork.store.latestSnapshot();
    if (snapshot === null) throw new Error('unreachable');

    const captured = new Set<string>();
    const ledger = snapshot.tables.find(([name]) => name === 'ledger')?.[1];
    const rows = (ledger as { accounts?: readonly { id?: unknown }[] } | undefined)?.accounts ?? [];
    for (const row of rows) if (typeof row.id === 'string') captured.add(row.id);

    const logged = new Set<string>();
    for (const p of await fork.store.postingsInRange(0, snapshot.tick)) logged.add(p.account);

    const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
    const onlyInLog = [...logged]
      .filter((a) => !captured.has(a) && a.startsWith('escrow:v:'))
      .sort(byId);
    const onlyInCapture = [...captured]
      .filter((a) => !logged.has(a) && a.startsWith('escrow:v:'))
      .sort(byId);
    expect(onlyInLog.length, 'the log must name escrows the world does not hold').toBeGreaterThan(0);

    // The proof that nothing was deleted: for at least one escrow the log names, the world holds a
    // DIFFERENT escrow for the same venture tick and the same funder. `escrow:v:<tick>:<hash>:p:<who>`
    // -> key on tick and funder, which are the parts an ordinal shift cannot change.
    const key = (id: string): string => {
      const parts = id.split(':');
      return `${String(parts[2])}|${parts.slice(4).join(':')}`;
    };
    const capturedKeys = new Set(onlyInCapture.map(key));
    const renamed = onlyInLog.filter((id) => capturedKeys.has(key(id)));
    expect(
      renamed.length,
      `an escrow in the log with a same-tick same-funder twin in the capture is the ordinal shift, ` +
        `which is what production shows (117e86ad -> 516e910d). log-only: ${onlyInLog.join(', ')} | ` +
        `capture-only: ${onlyInCapture.join(', ')}`,
    ).toBeGreaterThan(0);

    // Closed escrows are NOT missing. Theory 1, killed by counting rather than by reading.
    const zeroBalance = (rows as readonly { id?: unknown; balanceMinor?: unknown }[]).filter(
      (r) => typeof r.id === 'string' && r.id.startsWith('escrow:') && r.balanceMinor === 0,
    );
    expect(zeroBalance.length, 'the capture carries closed escrows, at zero, as production does').toBeGreaterThan(0);
  }, 300_000);
});

describe('a forked record is refused BEFORE anything is read, and named for what it is', () => {
  it('planCheckpoint refuses on the declared discontinuity, naming the tick', async () => {
    const fork = await forkedWorld();
    const probe = bootableProcess(fork);
    const plan = await planCheckpoint(probe.runtime.engine.stateTables, fork.store, {
      requiredTables: registeredTables(probe.runtime),
    });

    expect(plan.snapshot, 'a superseded record is not an adoptable one').toBeNull();
    expect(plan.refusal ?? '').toMatch(/declared discontinuity|superseded/);
    expect(plan.refusal ?? '').toContain(String(fork.acceptedAt));
    // The old message blamed an account, which sent three sessions looking at the ledger.
    expect(plan.refusal ?? '').not.toMatch(/does not contain/);
  }, 300_000);

  it('boot says it never tried, replays from genesis, and lands on the forked world', async () => {
    const fork = await forkedWorld();
    const p = bootableProcess(fork);
    const result = await bootFromStore(p.runtime, fork.store, {
      seed: SEED,
      acceptDivergenceFromTick: fork.acceptedAt,
      checkpoint: { requiredTables: registeredTables(p.runtime) },
    });

    expect(result.adoptedAtTick).toBeNull();
    expect(result.refusalKind).toBe('RECORD_SUPERSEDED');
    // The slow path is not merely available, it is CORRECT: the same head the forked world reached.
    expect(result.ticksReplayed).toBe(fork.headTick + 1);
    expect(p.runtime.engine.stateHash).toBe(fork.headHash);
    // And no posting row was ever read, so the refusal costs one small query rather than the log.
    expect(result.postingsHydrated).toBe(0);
  }, 300_000);
});

describe('and the guards that keep the fix from being a quiet disabling of adoption', () => {
  it('a world that never forked still ADOPTS, and the boot is bounded', async () => {
    // The non-vacuity guard. A "fix" that refused every checkpoint would pass everything above.
    const live = seated('unforked-1');
    const store = new InMemoryJournalStore();
    const journal = new Journal(store, { snapshotEveryTicks: 100 });
    await bootFromStore(live.runtime, store, { seed: 'unforked-1' });
    for (let i = 0; i < TICKS; i += 1) {
      for (const a of live.cast.decide(live.runtime.engine.tick + 1, 'unforked-1')) {
        live.runtime.engine.submit(a);
      }
      const report = live.runtime.runTick();
      if (report.halted) throw new Error(`halted at ${String(report.tick)}`);
      journal.record(live.runtime, report);
      await journal.flushPending();
    }
    await journal.drain();

    const fresh = seated('unforked-1');
    const result = await bootFromStore(fresh.runtime, store, {
      seed: 'unforked-1',
      checkpoint: { requiredTables: registeredTables(fresh.runtime) },
    });
    expect(result.adoptedAtTick, 'a sound record must still be adopted').not.toBeNull();
    expect(result.ticksReplayed, 'and adoption must actually save work').toBeLessThan(TICKS);
    expect(fresh.runtime.engine.stateHash).toBe(live.runtime.engine.stateHash);
    expect((await store.divergences()).length, 'nothing forked here').toBe(0);
  }, 300_000);

  it('MUTATION PROOF: an event log that disagrees on COUNT degrades instead of HOLDING the world', async () => {
    // The other artifact, and the more dangerous one: every refusal inside the event hydrate lands
    // AFTER `events.append` has begun mutating the runtime, so it can only be fatal. Production's
    // capture at 4895 counts 2,791 events against 3,180 durable rows, so this path is armed there
    // too — and it is only unreachable because the ledger half refuses first.
    const live = seated('short-record-1');
    const store = new InMemoryJournalStore();
    const journal = new Journal(store, { snapshotEveryTicks: 100 });
    await bootFromStore(live.runtime, store, { seed: 'short-record-1' });
    const ticks: TickRecord[] = [];
    for (let i = 0; i < TICKS; i += 1) {
      for (const a of live.cast.decide(live.runtime.engine.tick + 1, 'short-record-1')) {
        live.runtime.engine.submit(a);
      }
      const report = live.runtime.runTick();
      if (report.halted) throw new Error(`halted at ${String(report.tick)}`);
      journal.record(live.runtime, report);
      await journal.flushPending();
    }
    await journal.drain();
    for (const t of await store.ticksSince(-1)) ticks.push(t);

    // One event short, taken from the END of a tick so every remaining `(tick, seq)` still mints the
    // id the journal holds — the count is the only thing wrong.
    const short = new InMemoryJournalStore();
    await short.init('short-record-1');
    let dropped = false;
    for (const t of ticks) {
      const drop = !dropped && t.events.length > 0;
      if (drop) dropped = true;
      await short.appendTick(drop ? { ...t, events: t.events.slice(0, -1) } : t);
    }
    expect(dropped, 'the fixture must actually have dropped an event').toBe(true);
    for (const s of await store.snapshots()) await short.writeSnapshot(s);

    const fresh = seated('short-record-1');
    const outcome = await bootWorld(fresh.runtime, short, {
      seed: 'short-record-1',
      checkpoint: { requiredTables: registeredTables(fresh.runtime) },
    });
    expect(outcome.status, 'a record that cannot be rebuilt is a slow boot, not an outage').toBe('READY');
    if (outcome.status !== 'READY') throw new Error('unreachable');
    expect(outcome.result.adoptedAtTick).toBeNull();
    expect(outcome.result.refusalKind).toBe('RECORD_UNREBUILDABLE');
    expect(fresh.runtime.engine.stateHash).toBe(live.runtime.engine.stateHash);
  }, 300_000);

  it('MUTATION PROOF: a count-only disagreement degrades instead of HOLDING the world', async () => {
    // Production's counts disagree by ~4,000 rows and the only reason boot recovered is that a
    // renamed account appeared first. Take the rename away and leave the count wrong: before the
    // fix this threw `LedgerError` out of `hydrateAppendOnly`, which boot turned into a `BootError`
    // with `operatorInstruction: null` — a HELD world, 503 on every route, over an optimisation.
    const live = seated('short-log-1');
    const store = new InMemoryJournalStore();
    const journal = new Journal(store, { snapshotEveryTicks: 100 });
    await bootFromStore(live.runtime, store, { seed: 'short-log-1' });
    for (let i = 0; i < TICKS; i += 1) {
      for (const a of live.cast.decide(live.runtime.engine.tick + 1, 'short-log-1')) {
        live.runtime.engine.submit(a);
      }
      const report = live.runtime.runTick();
      if (report.halted) throw new Error(`halted at ${String(report.tick)}`);
      journal.record(live.runtime, report);
      await journal.flushPending();
    }
    await journal.drain();

    // One row short, every account still valid. The narrowest possible version of the production
    // condition, isolating the count check from the account check.
    const oneRowShort = new Proxy(store, {
      get(target, prop, receiver): unknown {
        if (prop !== 'postingsInRange') return Reflect.get(target, prop, receiver) as unknown;
        return async (from: number, to: number): Promise<readonly PersistedPosting[]> => {
          const rows = await target.postingsInRange(from, to);
          return rows.slice(0, Math.max(0, rows.length - 1));
        };
      },
    }) as JournalStore;

    const fresh = seated('short-log-1');
    const outcome = await bootWorld(fresh.runtime, oneRowShort, {
      seed: 'short-log-1',
      checkpoint: { requiredTables: registeredTables(fresh.runtime) },
    });

    expect(outcome.status, 'a log that cannot rebuild the ledger is a slow boot, not an outage').toBe('READY');
    if (outcome.status !== 'READY') throw new Error('unreachable');
    expect(outcome.result.adoptedAtTick).toBeNull();
    expect(outcome.result.refusalKind).toBe('LEDGER_UNREBUILDABLE');
    expect(outcome.result.checkpointRefusal ?? '').toMatch(/postings/);
    expect(fresh.runtime.engine.stateHash).toBe(live.runtime.engine.stateHash);
  }, 300_000);
});
