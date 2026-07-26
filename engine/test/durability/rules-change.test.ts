/**
 * THE RULES CHANGED UNDER THE RECORD. WHAT HAPPENS?
 *
 * ══════════════════════════════════════════════════════════════════════════
 * Boot replays the durable action log under whatever code is deployed. The first
 * deploy that changes how any PAST tick computes therefore hits one of two walls:
 * an action the record says APPLIED is refused, or the arithmetic moves and a
 * snapshot tripwire fires. Both were `throw`s out of `serve()`'s top-level await, so
 * the process exited, `Restart=always` restarted it, and it failed identically —
 * an infinite crash loop re-reading the whole action log from Postgres every
 * iteration, with no HTTP surface, not even a 503.
 *
 * The refusal is CORRECT (A5′: never serve a world you cannot reproduce). The
 * *exit* was the defect. So this file takes a world several Reckonings deep, changes
 * the rules on it, and proves three things:
 *
 *   1. boot does not crash-loop — it HOLDS, and it can say why;
 *   2. it names the exact tick, the exact action, and the exact operator instruction;
 *   3. with that instruction, it resumes AND writes the discontinuity into the
 *      permanent public record, without rewriting a single past row.
 *
 * The rules change is simulated the honest way: a refusal is injected into the
 * engine the replay runs in, so an action the journal says APPLIED is now refused.
 * That is precisely the shape of the fix landing in parallel (gating contingent
 * liability on delegated `create`).
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { Runtime } from '../../src/sim/runtime.js';
import { HeuristicCast } from '../../src/cast/index.js';
import {
  BootError,
  InMemoryJournalStore,
  Journal,
  bootFromStore,
  bootWorld,
  describeDiagnosis,
  replayCheck,
  type BootOptions,
  type JournalStore,
  type TickRecord,
} from '../../src/persist/index.js';
import type { PrincipalId } from '../../src/core/types.js';
import type { SubmittedAction } from '../../src/tick/index.js';

const SEED = 'rules-change-1';
const CAST_SIZE = 6;
/** Crosses the settlements at 287 and 575 — "several Reckonings deep". */
const TICKS = 600;

/** A freshly-seated genesis runtime, exactly as `serve()` builds one. */
function seatedRuntime(seed = SEED): Runtime {
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size: CAST_SIZE });
  cast.seat(seed);
  return runtime;
}

interface LiveRun {
  readonly store: InMemoryJournalStore;
  readonly headHash: string;
  readonly headTick: number;
}

/** Run a real sim through several Reckonings, persisting every tick. */
async function runLive(ticks = TICKS): Promise<LiveRun> {
  const runtime = new Runtime({ seed: SEED });
  const cast = new HeuristicCast(runtime, { size: CAST_SIZE });
  cast.seat(SEED);
  const store = new InMemoryJournalStore();
  const journal = new Journal(store);
  await bootFromStore(runtime, store, { seed: SEED });
  for (let i = 0; i < ticks; i += 1) {
    for (const action of cast.decide(runtime.engine.tick + 1, SEED)) runtime.engine.submit(action);
    const report = runtime.runTick();
    if (report.halted) throw new Error(`live sim halted at tick ${String(report.tick)}`);
    journal.record(runtime, report);
    await journal.flushPending();
  }
  await journal.drain();
  return { store, headHash: runtime.engine.stateHash, headTick: runtime.engine.tick };
}

/**
 * **THE RULES CHANGE.** Wrap the replay engine's `submit` so that from `fromTick`
 * onward one principal's actions are refused — actions the journal records as
 * APPLIED. Nothing about the record is touched; only the code it is replayed under.
 */
function refuseAfter(runtime: Runtime, principal: PrincipalId, fromTick: number): void {
  const engine = runtime.engine;
  const original = engine.submit.bind(engine);
  engine.submit = (action: SubmittedAction): ReturnType<typeof original> => {
    if (action.principal === principal && engine.tick + 1 >= fromTick) {
      return {
        ok: false,
        invariant: 'A6-CONTINGENT',
        hint: 'simulated rules change: this principal may no longer act',
      };
    }
    return original(action);
  };
}

/** The principal whose actions the injected rule refuses. Deterministic. */
function victim(runtime: Runtime): PrincipalId {
  const first = [...runtime.world.principalOrder].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[0];
  if (first === undefined) throw new Error('no principals seated');
  return first;
}

async function bootUnderChangedRules(
  store: InMemoryJournalStore,
  fromTick: number,
  extra: Partial<BootOptions> = {},
): Promise<{ runtime: Runtime; outcome: Awaited<ReturnType<typeof bootWorld>> }> {
  const runtime = seatedRuntime();
  refuseAfter(runtime, victim(runtime), fromTick);
  const outcome = await bootWorld(runtime, store, { seed: SEED, ...extra });
  return { runtime, outcome };
}

describe('a rules change under the record HOLDS the world instead of crash-looping', () => {
  it('holds, names the tick and the action, and offers the exact operator instruction', async () => {
    const live = await runLive();

    // The world genuinely ran several Reckonings before the rules moved.
    expect(live.headTick).toBe(TICKS - 1);
    expect((await live.store.snapshotHashes()).length).toBeGreaterThanOrEqual(2);

    const { outcome } = await bootUnderChangedRules(live.store, 300);

    // 1. IT DID NOT THROW. `bootWorld` returned; nothing exited; there is no loop.
    expect(outcome.status).toBe('HELD');
    if (outcome.status !== 'HELD') throw new Error('unreachable');

    // 2. It says exactly what happened, where.
    expect(outcome.diagnosis.kind).toBe('APPLIED_REFUSED');
    expect(outcome.diagnosis.tick).toBeGreaterThanOrEqual(300);
    expect(outcome.diagnosis.tick).toBeLessThanOrEqual(live.headTick);
    expect(outcome.diagnosis.action).toContain('A6-CONTINGENT');
    expect(outcome.diagnosis.message).toContain('simulated rules change');

    // 3. And it says what to do about it, naming that tick and no other.
    expect(outcome.diagnosis.operatorInstruction).toBe(
      `COMPACT_ACCEPT_DIVERGENCE_AT_TICK=${String(outcome.diagnosis.tick)}`,
    );
    const briefing = describeDiagnosis(outcome.diagnosis);
    expect(briefing).toContain('THE WORLD IS HELD');
    expect(briefing).toContain(String(outcome.diagnosis.tick));
  }, 120_000);

  it('a tripwire hash mismatch holds the same way, with both hashes named', async () => {
    const live = await runLive(400);
    const snaps = await live.store.snapshots();
    const first = snaps[0];
    expect(first).toBeDefined();
    if (first === undefined) throw new Error('unreachable');

    // Corrupt ONE stored snapshot hash: the record now claims a state the replay will
    // not produce. This is the "arithmetic moved" wall rather than the "action
    // refused" one, and it must hold identically.
    const corrupted = new InMemoryJournalStore();
    await corrupted.init(SEED);
    for (const t of await live.store.ticksSince(-1)) await corrupted.appendTick(t);
    for (const s of snaps) {
      await corrupted.writeSnapshot(s.tick === first.tick ? { ...s, stateHash: 'f'.repeat(64) } : s);
    }

    const outcome = await bootWorld(seatedRuntime(), corrupted, { seed: SEED });
    expect(outcome.status).toBe('HELD');
    if (outcome.status !== 'HELD') throw new Error('unreachable');
    expect(outcome.diagnosis.kind).toBe('STATE_HASH_MISMATCH');
    expect(outcome.diagnosis.tick).toBe(first.tick);
    expect(outcome.diagnosis.expectedHash).toBe('f'.repeat(64));
    expect(outcome.diagnosis.actualHash).toBe(first.stateHash);
    expect(outcome.diagnosis.operatorInstruction).toBe(
      `COMPACT_ACCEPT_DIVERGENCE_AT_TICK=${String(first.tick)}`,
    );
  }, 120_000);

  it('the door refuses a tick the operator did not name', async () => {
    const live = await runLive();
    const held = await bootUnderChangedRules(live.store, 300);
    if (held.outcome.status !== 'HELD') throw new Error('expected HELD');
    const real = held.outcome.diagnosis.tick;

    // An operator who types the wrong tick is accepting something they were not shown.
    const wrong = await bootUnderChangedRules(live.store, 300, {
      acceptDivergenceFromTick: real + 1,
    });
    expect(wrong.outcome.status).toBe('HELD');
    if (wrong.outcome.status !== 'HELD') throw new Error('unreachable');
    expect(wrong.outcome.message).toContain('must name the tick it was given');
    expect((await live.store.divergences()).length).toBe(0);
  }, 120_000);
});

describe('the operator door: resume, and write the discontinuity down', () => {
  it('resumes the world and records ONE public divergence naming both rules versions', async () => {
    const live = await runLive();
    const before = await live.store.ticksSince(-1);

    // The operator is shown a tick. They accept that exact tick.
    const held = await bootUnderChangedRules(live.store, 300);
    if (held.outcome.status !== 'HELD') throw new Error('expected HELD');
    const at = held.outcome.diagnosis.tick;

    const opened = await bootUnderChangedRules(live.store, 300, {
      acceptDivergenceFromTick: at,
      nowMs: () => 1_700_000_000_000,
    });
    expect(opened.outcome.status).toBe('READY');
    if (opened.outcome.status !== 'READY') throw new Error('unreachable');

    // The world resumed at the true head...
    expect(opened.outcome.result.headTick).toBe(live.headTick);
    // ...and is HONEST that it is not the same world the record describes.
    expect(opened.runtime.engine.stateHash).not.toBe(live.headHash);

    const declared = opened.outcome.result.divergenceAccepted;
    expect(declared).not.toBeNull();
    expect(declared?.tick).toBe(at);
    expect(declared?.kind).toBe('APPLIED_REFUSED');
    expect(declared?.toRulesVersion).toBe(opened.outcome.result.runningRulesVersion);
    expect(declared?.detail).toContain('rules change accepted by operator');
    expect(declared?.acceptedAtMs).toBe(1_700_000_000_000);
    // Downstream tripwires mismatch once state has moved; they are counted, not hidden.
    expect(declared?.toleratedAfter).toBeGreaterThan(0);

    const rows = await live.store.divergences();
    expect(rows.length).toBe(1);
    expect(rows[0]?.tick).toBe(at);

    // AND IT REWROTE NOTHING. Every past row is byte-identical.
    const after = await live.store.ticksSince(-1);
    expect(sig(after)).toEqual(sig(before));
  }, 180_000);

  it('a second restart through the same door annotates once, not once per restart', async () => {
    const live = await runLive();
    const held = await bootUnderChangedRules(live.store, 300);
    if (held.outcome.status !== 'HELD') throw new Error('expected HELD');
    const at = held.outcome.diagnosis.tick;

    for (let restart = 0; restart < 3; restart += 1) {
      const again = await bootUnderChangedRules(live.store, 300, { acceptDivergenceFromTick: at });
      expect(again.outcome.status).toBe('READY');
    }
    expect((await live.store.divergences()).length).toBe(1);
  }, 180_000);

  it('a seed mismatch has NO door — it is not a rules change', async () => {
    const live = await runLive(40);
    const outcome = await bootWorld(seatedRuntime('a-different-seed'), live.store, {
      seed: 'a-different-seed',
      acceptDivergenceFromTick: 0,
    });
    expect(outcome.status).toBe('HELD');
    if (outcome.status !== 'HELD') throw new Error('unreachable');
    expect(outcome.diagnosis.kind).toBe('SEED_MISMATCH');
    expect(outcome.diagnosis.operatorInstruction).toBeNull();
    expect(describeDiagnosis(outcome.diagnosis)).toContain('No operator instruction can accept this');
  }, 60_000);
});

describe('RULES_VERSION is read, not just stamped', () => {
  it('genesis records it, and a boot under a different one reports the change', async () => {
    const store = new InMemoryJournalStore();
    // A journal born under an older rules version than this build runs.
    await store.recordRulesVersion(0);
    const genesis = await bootFromStore(seatedRuntime(), store, { seed: SEED });
    expect(genesis.mode).toBe('GENESIS');
    expect(await store.journalledRulesVersion()).toBe(0);

    const resumed = await bootFromStore(seatedRuntime(), store, { seed: SEED });
    expect(resumed.journalledRulesVersion).toBe(0);
    expect(resumed.runningRulesVersion).toBeGreaterThan(0);
    expect(resumed.rulesVersionChanged).toBe(true);
  }, 60_000);

  it('names the rules change as the explanation in the held diagnosis', async () => {
    const store = new InMemoryJournalStore();
    await store.recordRulesVersion(0);
    const runtime = new Runtime({ seed: SEED });
    const cast = new HeuristicCast(runtime, { size: CAST_SIZE });
    cast.seat(SEED);
    const journal = new Journal(store);
    await bootFromStore(runtime, store, { seed: SEED });
    for (let i = 0; i < 320; i += 1) {
      for (const a of cast.decide(runtime.engine.tick + 1, SEED)) runtime.engine.submit(a);
      const report = runtime.runTick();
      journal.record(runtime, report);
      await journal.flushPending();
    }
    await journal.drain();

    const held = await bootUnderChangedRules(store, 200);
    if (held.outcome.status !== 'HELD') throw new Error('expected HELD');
    expect(held.outcome.diagnosis.rulesVersionChanged).toBe(true);
    expect(held.outcome.diagnosis.journalledRulesVersion).toBe(0);
    expect(describeDiagnosis(held.outcome.diagnosis)).toContain('CHANGED, the likely cause');
  }, 120_000);
});

describe('the deploy preflight answers the question before the restart', () => {
  it('passes on a clean journal and never writes to it', async () => {
    const live = await runLive(200);
    const result = await replayCheck({
      store: live.store,
      seed: SEED,
      buildRuntime: () => seatedRuntime(),
    });
    expect(result.reproduces).toBe(true);
    expect(result.report).toContain('reproduces the record');
    expect((await live.store.divergences()).length).toBe(0);
  }, 120_000);

  it('fails on a build that would not reproduce, and names the tick', async () => {
    const live = await runLive(200);
    const result = await replayCheck({
      store: live.store,
      seed: SEED,
      buildRuntime: () => {
        const runtime = seatedRuntime();
        refuseAfter(runtime, victim(runtime), 100);
        return runtime;
      },
    });
    expect(result.reproduces).toBe(false);
    expect(result.preAccepted).toBe(false);
    expect(result.diagnosis?.kind).toBe('APPLIED_REFUSED');
    expect(result.report).toContain('WOULD NOT REPRODUCE THE RECORD');
    // The check is read-only: no annotation was written by merely asking.
    expect((await live.store.divergences()).length).toBe(0);
  }, 120_000);

  it('passes when the operator has already declared that exact tick', async () => {
    const live = await runLive(200);
    const build = (): Runtime => {
      const runtime = seatedRuntime();
      refuseAfter(runtime, victim(runtime), 100);
      return runtime;
    };
    const first = await replayCheck({ store: live.store, seed: SEED, buildRuntime: build });
    const at = first.diagnosis?.tick ?? -1;
    expect(at).toBeGreaterThan(0);

    const declared = await replayCheck({
      store: live.store,
      seed: SEED,
      buildRuntime: build,
      acceptDivergenceFromTick: at,
    });
    expect(declared.preAccepted).toBe(true);
    expect(declared.report).toContain('ALREADY declared this exact tick');

    const wrong = await replayCheck({
      store: live.store,
      seed: SEED,
      buildRuntime: build,
      acceptDivergenceFromTick: at + 5,
    });
    expect(wrong.preAccepted).toBe(false);
    expect(wrong.report).toContain('must name the tick it was given');
  }, 180_000);

  it('is genuinely read-only: the store it hands boot absorbs even the metadata write', async () => {
    // A journal born before `rules_version` was recorded. A real boot stamps it; the
    // CHECK must not, and that absorbed write is the observable proof the read-only
    // wrapper is actually interposed rather than decorative.
    const store = new InMemoryJournalStore();
    const runtime = new Runtime({ seed: SEED });
    const cast = new HeuristicCast(runtime, { size: CAST_SIZE });
    cast.seat(SEED);
    const journal = new Journal(store);
    await store.init(SEED);
    for (let i = 0; i < 30; i += 1) {
      for (const a of cast.decide(runtime.engine.tick + 1, SEED)) runtime.engine.submit(a);
      const report = runtime.runTick();
      journal.record(runtime, report);
      await journal.flushPending();
    }
    await journal.drain();
    expect(await store.journalledRulesVersion()).toBeNull();

    const result = await replayCheck({ store, seed: SEED, buildRuntime: () => seatedRuntime() });
    expect(result.reproduces).toBe(true);
    // Untouched. A preflight that mutated the record it is checking would be its
    // own worst bug.
    expect(await store.journalledRulesVersion()).toBeNull();

    // Whereas a REAL boot does stamp it — so the assertion above is not vacuous.
    await bootFromStore(seatedRuntime(), store, { seed: SEED });
    expect(await store.journalledRulesVersion()).not.toBeNull();
  }, 60_000);
});

describe('boot is bounded in memory: it pages, and paging changes nothing', () => {
  it('a tiny page and a huge page produce the SAME head state_hash', async () => {
    const live = await runLive(320);

    const tiny = seatedRuntime();
    const tinyResult = await bootFromStore(tiny, live.store, { seed: SEED, pageSize: 7 });
    const huge = seatedRuntime();
    const hugeResult = await bootFromStore(huge, live.store, { seed: SEED, pageSize: 100_000 });

    // The equivalence that makes paging safe. Same record, same code, same world.
    expect(tiny.engine.stateHash).toBe(live.headHash);
    expect(huge.engine.stateHash).toBe(live.headHash);
    expect(tinyResult.ticksReplayed).toBe(hugeResult.ticksReplayed);
    expect(tinyResult.tripwiresChecked).toBe(hugeResult.tripwiresChecked);
  }, 180_000);

  it('never asks the store for the whole log, and never for more than one page', async () => {
    const live = await runLive(320);
    const asks: number[] = [];
    let wholeLogReads = 0;
    let snapshotBodyReads = 0;
    // Written out method by method rather than spread: a class instance's methods
    // live on the prototype, so `{...store}` produces an object with no methods at all
    // and a watcher that silently observes nothing.
    const inner = live.store;
    const watched: JournalStore = {
      init: (s) => inner.init(s),
      masterSeed: () => inner.masterSeed(),
      appendTick: (r) => inner.appendTick(r),
      writeSnapshot: (r) => inner.writeSnapshot(r),
      latestSnapshot: () => inner.latestSnapshot(),
      snapshots: async () => {
        snapshotBodyReads += 1;
        return inner.snapshots();
      },
      snapshotHashes: () => inner.snapshotHashes(),
      ticksSince: async (t: number): Promise<readonly TickRecord[]> => {
        wholeLogReads += 1;
        return inner.ticksSince(t);
      },
      ticksPage: async (t: number, limit: number): Promise<readonly TickRecord[]> => {
        const page = await inner.ticksPage(t, limit);
        asks.push(page.length);
        return page;
      },
      headTick: () => inner.headTick(),
      recordRulesVersion: (v) => inner.recordRulesVersion(v),
      journalledRulesVersion: () => inner.journalledRulesVersion(),
      recordDivergence: (r) => inner.recordDivergence(r),
      divergences: () => inner.divergences(),
      recordEnrollment: (r) => inner.recordEnrollment(r),
      enrollments: () => inner.enrollments(),
      close: () => inner.close(),
    };

    const runtime = seatedRuntime();
    await bootFromStore(runtime, watched, { seed: SEED, pageSize: 64 });

    expect(runtime.engine.stateHash).toBe(live.headHash);
    // THE BOUND: no page ever exceeded the limit, and the whole-log reads that used
    // to hold 242 000 ticks in memory never happened.
    expect(asks.length).toBeGreaterThan(1);
    expect(Math.max(...asks)).toBeLessThanOrEqual(64);
    expect(wholeLogReads).toBe(0);
    // Nor did it pull a full snapshot body per Reckoning; digests only.
    expect(snapshotBodyReads).toBe(0);
  }, 180_000);

  it('MUTATION PROOF: ticksPage refuses a non-positive limit', async () => {
    const live = await runLive(20);
    await expect(live.store.ticksPage(-1, 0)).rejects.toThrow(/positive integer limit/);
    // And a short page really is the end of the log, not a silent truncation.
    const all = await live.store.ticksSince(-1);
    const page = await live.store.ticksPage(-1, all.length + 10);
    expect(page.length).toBe(all.length);
  }, 60_000);
});

describe('bootFromStore still throws for callers that want it to', () => {
  it('throws a BootError carrying the same diagnosis bootWorld returns', async () => {
    const live = await runLive(200);
    const runtime = seatedRuntime();
    refuseAfter(runtime, victim(runtime), 100);
    let caught: unknown = null;
    try {
      await bootFromStore(runtime, live.store, { seed: SEED });
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BootError);
    expect((caught as BootError).diagnosis.kind).toBe('APPLIED_REFUSED');
    expect((caught as BootError).diagnosis.operatorInstruction).toMatch(
      /^COMPACT_ACCEPT_DIVERGENCE_AT_TICK=\d+$/,
    );
  }, 120_000);
});

/** A comparable fingerprint of the durable ticks, for "nothing was rewritten". */
function sig(ticks: readonly TickRecord[]): readonly string[] {
  return ticks.map(
    (t) =>
      `${String(t.tick)}|${t.seed}|${t.seedHash}|${String(t.events.length)}|${String(t.postings.length)}|` +
      t.actions.map((a) => `${a.principal}:${a.verb}:${a.outcome}`).join(','),
  );
}
