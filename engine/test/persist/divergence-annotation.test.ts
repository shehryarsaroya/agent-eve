/**
 * REVIEWER-AUTHORED. Two properties the boot/persistence work depends on that had no
 * test, each found by mutating the shipped code and watching CI stay green.
 *
 * ── 1. THE ANNOTATION'S DEDUP MUST BE PRECISE, NOT MERELY PRESENT ───────────
 * `annotate()` skips the write when `(tick, toRulesVersion)` is already on record, so
 * restarting through the same operator door annotates once rather than once per
 * restart. That is covered. What was NOT covered is the other half: a *different*
 * discontinuity, accepted later, must still be written down. Replacing the dedup
 * predicate with `() => true` left the whole suite green — and that mutation is a
 * world that resumes across an undeclared rules change, which is precisely the silent
 * lie A5 forbids and the reason `journal_divergence` exists.
 *
 * ── 2. THE TRIPWIRE TABLE MUST BE APPEND-ONLY BY GRANT ──────────────────────
 * Boot's only detector for "the arithmetic moved" is the replayed `state_hash` versus
 * `snapshot.state_hash`. Verified against a real Postgres 16: the app role held
 * UPDATE and DELETE on `snapshot`, so `DELETE FROM snapshot` made a boot that should
 * have HELD come up READY with `tripwiresChecked: 0`. Append-only by grant, not by
 * convention (INV-16) — the same rule the rest of history already follows.
 */

import { describe, expect, it } from 'vitest';
import { Runtime } from '../../src/sim/runtime.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { APPEND_ONLY_UNPARTITIONED } from '../../src/db/migrate.js';
import {
  InMemoryJournalStore,
  Journal,
  bootFromStore,
  bootWorld,
} from '../../src/persist/index.js';
import type { PrincipalId } from '../../src/core/types.js';
import type { SubmittedAction } from '../../src/tick/index.js';

/**
 * Every boot in this file exercises the **divergence door**, and the door only exists
 * on the replay path: an adopted boot re-derives nothing, so it can neither find a
 * divergence nor annotate one. That is not a gap this file should paper over — it is
 * why `planCheckpoint` refuses adoption across a `RULES_VERSION` change, and why
 * `checkpoint-adoption-audit.test.ts` pins `tripwiresChecked === 0` for an adopted
 * boot. Here the path is named rather than inherited from a default.
 */
const GENESIS = { disabled: true } as const;

const SEED = 'divergence-annotation-1';
const CAST = 6;

/**
 * A distinct wall clock per boot, because real restarts happen at different times and
 * "annotate once" must not quietly become "annotate once per clock reading". Injected
 * rather than read (DET-7).
 */
let clock = 1_700_000_000_000;
function nextClock(): number {
  clock += 60_000;
  return clock;
}

function seated(): Runtime {
  const rt = new Runtime({ seed: SEED });
  new HeuristicCast(rt, { size: CAST }).seat(SEED);
  return rt;
}

/** A rules change: from `fromTick`, one principal's actions are refused. */
function refuseAfter(rt: Runtime, fromTick: number): void {
  const engine = rt.engine;
  const original = engine.submit.bind(engine);
  const first = [...rt.world.principalOrder].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[0];
  if (first === undefined) throw new Error('no principals seated');
  const principal: PrincipalId = first;
  engine.submit = (a: SubmittedAction): ReturnType<typeof original> =>
    a.principal === principal && engine.tick + 1 >= fromTick
      ? { ok: false, invariant: 'A6-CONTINGENT', hint: 'simulated rules change' }
      : original(a);
}

async function runLive(ticks: number): Promise<InMemoryJournalStore> {
  const rt = new Runtime({ seed: SEED });
  const cast = new HeuristicCast(rt, { size: CAST });
  cast.seat(SEED);
  const store = new InMemoryJournalStore();
  const journal = new Journal(store);
  await bootFromStore(rt, store, { seed: SEED, checkpoint: GENESIS });
  for (let i = 0; i < ticks; i += 1) {
    for (const a of cast.decide(rt.engine.tick + 1, SEED)) rt.engine.submit(a);
    const report = rt.runTick();
    if (report.halted) throw new Error(`live halted at tick ${String(report.tick)}`);
    journal.record(rt, report);
    await journal.flushPending();
  }
  await journal.drain();
  return store;
}

/** Hold once to learn the tick, then walk through the door naming it. */
async function acceptAt(store: InMemoryJournalStore, fromTick: number): Promise<number> {
  const probe = seated();
  refuseAfter(probe, fromTick);
  const held = await bootWorld(probe, store, { seed: SEED, checkpoint: GENESIS });
  expect(held.status).toBe('HELD');
  if (held.status !== 'HELD') throw new Error('unreachable');
  const at = held.diagnosis.tick;

  const open = seated();
  refuseAfter(open, fromTick);
  const opened = await bootWorld(open, store, {
    seed: SEED,
    acceptDivergenceFromTick: at,
    nowMs: nextClock,
    checkpoint: GENESIS,
  });
  expect(opened.status).toBe('READY');
  return at;
}

describe('the divergence annotation dedups on identity, not on existence', () => {
  it('records a SECOND, different discontinuity instead of swallowing it', async () => {
    const store = await runLive(200);

    // One operator accepts one rules change. One row.
    const firstTick = await acceptAt(store, 60);
    expect((await store.divergences()).length).toBe(1);

    // The same door, same tick, again: still one row. (The covered half.)
    await acceptAt(store, 60);
    expect((await store.divergences()).length).toBe(1);

    // A DIFFERENT rules change, diverging at a DIFFERENT tick, accepted later. This
    // is a second discontinuity in the same world's life and the record must say so —
    // a build that resumes across it silently is A5's forbidden lie.
    const secondTick = await acceptAt(store, 140);
    expect(secondTick).not.toBe(firstTick);

    const rows = await store.divergences();
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.tick).sort((a, b) => a - b)).toEqual(
      [firstTick, secondTick].sort((a, b) => a - b),
    );
    // Ascending by tick, so the annotation reads as a history.
    expect(rows[0]?.tick).toBeLessThan(rows[1]?.tick ?? -1);
  }, 180_000);
});

describe('two DIFFERENT rules changes that diverge at the SAME tick are both recorded', () => {
  it('does not let one discontinuity hide behind another at the same tick', async () => {
    const store = await runLive(200);

    // Measured, not hypothesised: in a six-hand cast, refusing either of two different
    // principals from tick 100 first diverges at tick 100 for both. `RULES_VERSION` is
    // a constant that does not move when semantics change, so a `(tick, rules_version)`
    // key cannot tell these two apart — and the second world resumed with the record
    // naming only the first.
    const [a, b] = collidingPair(await firstDivergenceTickPerPrincipal(store));
    const rowsAfterA = await acceptChange(store, a.principal, a.tick);
    expect(rowsAfterA).toBe(1);
    const rowsAfterB = await acceptChange(store, b.principal, b.tick);
    expect(a.tick).toBe(b.tick);
    expect(a.principal).not.toBe(b.principal);
    expect(rowsAfterB).toBe(2);

    const rows = await store.divergences();
    expect(rows.every((r) => r.tick === a.tick)).toBe(true);
    expect(new Set(rows.map((r) => r.detail)).size).toBe(2);
  }, 180_000);

  it('still annotates ONCE per restart after the world has run on past a Reckoning', async () => {
    // The half a careless dedup fix breaks. After the door opens the world keeps
    // running; the next restart replays a longer journal, crosses another Reckoning's
    // snapshot and therefore tolerates a DIFFERENT number of downstream divergences.
    // If that count can reach the dedup key, every such restart writes a fresh row and
    // the annotation degrades from "the rules changed here" into a restart counter.
    const store = await runLive(250);
    const at = await acceptAt(store, 60);
    const firstRows = await store.divergences();
    expect(firstRows.length).toBe(1);
    const toleratedBefore = firstRows[0]?.toleratedAfter ?? -1;
    const snapsBefore = (await store.snapshotHashes()).length;

    // Resume and run on past tick 287, so a NEW snapshot lands in the journal.
    const rt = seated();
    refuseAfter(rt, 60);
    await bootWorld(rt, store, { seed: SEED, acceptDivergenceFromTick: at, nowMs: nextClock, checkpoint: GENESIS });
    const journal = new Journal(store);
    const cast = new HeuristicCast(rt, { size: CAST });
    for (let i = 0; i < 60; i += 1) {
      for (const action of cast.decide(rt.engine.tick + 1, SEED)) rt.engine.submit(action);
      const report = rt.runTick();
      if (report.halted) break;
      journal.record(rt, report);
      await journal.flushPending();
    }
    await journal.drain();
    // Non-vacuity: the journal really did grow a new checkpoint to trip over, so the
    // restarts below are replaying a materially different log from the accepting boot.
    expect((await store.snapshotHashes()).length).toBeGreaterThan(snapsBefore);
    expect(toleratedBefore).toBeGreaterThanOrEqual(0);

    const again = seated();
    refuseAfter(again, 60);
    const restarted = await bootWorld(again, store, {
      seed: SEED,
      acceptDivergenceFromTick: at,
      nowMs: nextClock,
      checkpoint: GENESIS,
    });
    expect(restarted.status).toBe('READY');

    for (let restart = 0; restart < 2; restart += 1) {
      const more = seated();
      refuseAfter(more, 60);
      await bootWorld(more, store, { seed: SEED, acceptDivergenceFromTick: at, nowMs: nextClock, checkpoint: GENESIS });
    }
    // One discontinuity happened, so the record says so exactly once.
    expect((await store.divergences()).length).toBe(1);
  }, 180_000);
});

/** The first-divergence tick each single-principal rules change produces. */
async function firstDivergenceTickPerPrincipal(
  store: InMemoryJournalStore,
): Promise<ReadonlyMap<PrincipalId, number>> {
  const found = new Map<PrincipalId, number>();
  const probe = seated();
  for (const principal of [...probe.world.principalOrder].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0))) {
    const rt = seated();
    refuseOne(rt, principal, 100, `change targeting ${principal}`);
    const held = await bootWorld(rt, store, { seed: SEED, checkpoint: GENESIS });
    if (held.status === 'HELD') found.set(principal, held.diagnosis.tick);
  }
  return found;
}

function collidingPair(
  byPrincipal: ReadonlyMap<PrincipalId, number>,
): readonly [{ principal: PrincipalId; tick: number }, { principal: PrincipalId; tick: number }] {
  const groups = new Map<number, PrincipalId[]>();
  for (const [p, t] of byPrincipal) groups.set(t, [...(groups.get(t) ?? []), p]);
  for (const [tick, ps] of groups) {
    const [x, y] = ps;
    if (x !== undefined && y !== undefined) {
      return [
        { principal: x, tick },
        { principal: y, tick },
      ];
    }
  }
  throw new Error('no two single-principal rules changes diverge at the same tick in this world');
}

/** Walk one principal-specific change through the door; return the row count after. */
async function acceptChange(
  store: InMemoryJournalStore,
  principal: PrincipalId,
  tick: number,
): Promise<number> {
  const rt = seated();
  refuseOne(rt, principal, 100, `change targeting ${principal}`);
  const opened = await bootWorld(rt, store, {
    seed: SEED,
    acceptDivergenceFromTick: tick,
    nowMs: nextClock,
    checkpoint: GENESIS,
  });
  expect(opened.status).toBe('READY');
  return (await store.divergences()).length;
}

function refuseOne(rt: Runtime, principal: PrincipalId, fromTick: number, tag: string): void {
  const engine = rt.engine;
  const original = engine.submit.bind(engine);
  engine.submit = (a: SubmittedAction): ReturnType<typeof original> =>
    a.principal === principal && engine.tick + 1 >= fromTick
      ? { ok: false, invariant: 'A6-CONTINGENT', hint: tag }
      : original(a);
}

describe('the tables boot trusts are append-only by grant (INV-16)', () => {
  it('includes the snapshot tripwire, which boot cannot detect a rules change without', () => {
    // Proven against a real Postgres 16: with `snapshot` writable by the app role,
    // `DELETE FROM snapshot` turned a boot that must HOLD into one that came up READY
    // with tripwiresChecked = 0 — no hash was ever checked and nothing said so.
    expect([...APPEND_ONLY_UNPARTITIONED]).toContain('snapshot');
    // And the rest of the journal's own history, so this list cannot shrink quietly.
    for (const table of ['journal_meta', 'tick_seed', 'journal_enrollment', 'journal_divergence']) {
      expect([...APPEND_ONLY_UNPARTITIONED]).toContain(table);
    }
  });
});
