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
  acceptanceStringForDiagnosis,
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

/** Explicit comparator (DET-1): a bare `.sort()` is implementation-defined on non-strings. */
function sorted(values: readonly (string | null)[]): readonly (string | null)[] {
  return [...values].sort((x, y) => (String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0));
}

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

/**
 * Hold once to learn WHAT diverged, then walk through the door naming it.
 *
 * The probe boot is what produces the key, and that is the operator's real sequence too: the
 * preflight replays, prints `<tick>:<fingerprint>`, and the restart is given exactly that. A
 * fixture that synthesised the tick on its own would be testing a door no operator can reach.
 */
async function acceptAt(
  store: InMemoryJournalStore,
  fromTick: number,
): Promise<{ readonly tick: number; readonly key: string }> {
  const probe = seated();
  refuseAfter(probe, fromTick);
  const held = await bootWorld(probe, store, { seed: SEED, checkpoint: GENESIS });
  expect(held.status).toBe('HELD');
  if (held.status !== 'HELD') throw new Error('unreachable');
  const at = held.diagnosis.tick;
  const key = acceptanceStringForDiagnosis(held.diagnosis);

  const open = seated();
  refuseAfter(open, fromTick);
  const opened = await bootWorld(open, store, {
    seed: SEED,
    acceptDivergence: key,
    nowMs: nextClock,
    checkpoint: GENESIS,
  });
  expect(opened.status).toBe('READY');
  return { tick: at, key };
}

describe('the divergence annotation dedups on identity, not on existence', () => {
  it('records a SECOND, different discontinuity instead of swallowing it', async () => {
    const store = await runLive(200);

    // One operator accepts one rules change. One row.
    const { tick: firstTick } = await acceptAt(store, 60);
    expect((await store.divergences()).length).toBe(1);

    // The same door, same tick, again: still one row. (The covered half.)
    await acceptAt(store, 60);
    expect((await store.divergences()).length).toBe(1);

    // A DIFFERENT rules change, diverging at a DIFFERENT tick, accepted later. This
    // is a second discontinuity in the same world's life and the record must say so —
    // a build that resumes across it silently is A5's forbidden lie.
    const { tick: secondTick } = await acceptAt(store, 140);
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
    const { a, b, fromTick } = await findCollidingPair(store);
    const rowsAfterA = await acceptChange(store, a, fromTick);
    expect(rowsAfterA).toBe(1);
    const rowsAfterB = await acceptChange(store, b, fromTick);
    expect(a.tick).toBe(b.tick);
    expect(a.principal).not.toBe(b.principal);
    expect(rowsAfterB).toBe(2);

    const rows = await store.divergences();
    expect(rows.every((r) => r.tick === a.tick)).toBe(true);
    expect(new Set(rows.map((r) => r.detail)).size).toBe(2);

    // ── THE POINT OF THE WHOLE CHANGE, IN THIS FIXTURE'S OWN TERMS ────────────
    //
    // Two discontinuities, one tick, two keys — so `a`'s standing acceptance would NOT have
    // let `b` through, which is exactly what tick 287 did nineteen times in production. And
    // the record now says WHICH was authorised rather than only that something was.
    expect(a.key).not.toBe(b.key);
    expect(a.key.split(':')[0]).toBe(b.key.split(':')[0]);
    expect(new Set(rows.map((r) => r.acceptedAs)).size).toBe(2);
    expect(sorted(rows.map((r) => r.acceptedAs))).toEqual(sorted([a.key, b.key]));
  }, 180_000);

  it('still annotates ONCE per restart after the world has run on past a Reckoning', async () => {
    // The half a careless dedup fix breaks. After the door opens the world keeps
    // running; the next restart replays a longer journal, crosses another Reckoning's
    // snapshot and therefore tolerates a DIFFERENT number of downstream divergences.
    // If that count can reach the dedup key, every such restart writes a fresh row and
    // the annotation degrades from "the rules changed here" into a restart counter.
    const store = await runLive(250);
    const { key } = await acceptAt(store, 60);
    const firstRows = await store.divergences();
    expect(firstRows.length).toBe(1);
    const toleratedBefore = firstRows[0]?.toleratedAfter ?? -1;
    const snapsBefore = (await store.snapshotHashes()).length;

    // Resume and run on past tick 287, so a NEW snapshot lands in the journal.
    const rt = seated();
    refuseAfter(rt, 60);
    await bootWorld(rt, store, { seed: SEED, acceptDivergence: key, nowMs: nextClock, checkpoint: GENESIS });
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
    // ── AND THE SAME KEY STILL OPENS IT AFTER THE JOURNAL GREW ────────────────
    //
    // The fingerprint is taken over the divergence, not over the journal, so a longer log
    // with an extra Reckoning in it does not invalidate the operator's declaration. That is
    // the property that lets the line stay in /etc/compact/env: it is stable for as long as
    // the discontinuity it names is, and inert the moment a different one appears.
    const restarted = await bootWorld(again, store, {
      seed: SEED,
      acceptDivergence: key,
      nowMs: nextClock,
      checkpoint: GENESIS,
    });
    expect(restarted.status).toBe('READY');

    for (let restart = 0; restart < 2; restart += 1) {
      const more = seated();
      refuseAfter(more, 60);
      await bootWorld(more, store, { seed: SEED, acceptDivergence: key, nowMs: nextClock, checkpoint: GENESIS });
    }
    // One discontinuity happened, so the record says so exactly once.
    expect((await store.divergences()).length).toBe(1);
  }, 180_000);
});

/**
 * The first divergence each single-principal rules change produces: its tick AND its key.
 *
 * The key is carried through rather than re-derived at the accept, because the whole point of
 * this describe block is two changes at ONE tick — so a fixture that only remembered the tick
 * could not tell the door which of the two it meant, which is the defect under test.
 */
async function firstDivergencePerPrincipal(
  store: InMemoryJournalStore,
  fromTick: number,
): Promise<ReadonlyMap<PrincipalId, { readonly tick: number; readonly key: string }>> {
  const found = new Map<PrincipalId, { readonly tick: number; readonly key: string }>();
  const probe = seated();
  for (const principal of [...probe.world.principalOrder].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0))) {
    const rt = seated();
    refuseOne(rt, principal, fromTick, `change targeting ${principal}`);
    const held = await bootWorld(rt, store, { seed: SEED, checkpoint: GENESIS });
    if (held.status === 'HELD') {
      found.set(principal, {
        tick: held.diagnosis.tick,
        key: acceptanceStringForDiagnosis(held.diagnosis),
      });
    }
  }
  return found;
}

/**
 * Two principals whose single-principal rules change first diverges at the SAME tick, or null.
 *
 * Returns null rather than throwing so {@link findCollidingPair} can sweep. It used to throw, with the
 * refusal tick hardcoded to 100 — and a cast change (a `build` branch) moved which actions land there,
 * so no pair collided, and the test died in its own fixture with a message that read like a finding.
 * Which world grows a collision is incidental to what is under test: that two DIFFERENT discontinuities
 * at one tick are both recorded.
 */
interface Change {
  readonly principal: PrincipalId;
  readonly tick: number;
  readonly key: string;
}

function collidingPairAt(
  byPrincipal: ReadonlyMap<PrincipalId, { readonly tick: number; readonly key: string }>,
): readonly [Change, Change] | null {
  const groups = new Map<number, Change[]>();
  for (const [p, d] of byPrincipal) {
    groups.set(d.tick, [...(groups.get(d.tick) ?? []), { principal: p, tick: d.tick, key: d.key }]);
  }
  for (const ps of groups.values()) {
    const [x, y] = ps;
    if (x !== undefined && y !== undefined) return [x, y];
  }
  return null;
}

/** Sweep candidate refusal ticks until one produces a colliding pair, and say which tick it used. */
async function findCollidingPair(store: InMemoryJournalStore): Promise<{
  readonly a: Change;
  readonly b: Change;
  readonly fromTick: number;
}> {
  for (const fromTick of [100, 60, 140, 40, 180, 20, 220]) {
    const pair = collidingPairAt(await firstDivergencePerPrincipal(store, fromTick));
    if (pair !== null) return { a: pair[0], b: pair[1], fromTick };
  }
  throw new Error(
    'no refusal tick in the sweep produced two single-principal rules changes diverging at the same ' +
      'tick. Widen the sweep — do not weaken the assertion: the property under test is that two ' +
      'DIFFERENT discontinuities at one tick are both recorded, and it needs a genuine collision.',
  );
}

/** Walk one principal-specific change through the door; return the row count after. */
async function acceptChange(store: InMemoryJournalStore, change: Change, fromTick = 100): Promise<number> {
  const rt = seated();
  // `fromTick` must be the SAME refusal tick the divergence was discovered at. It was hardcoded to
  // 100 while the search learned to sweep, so a pair found at another tick was accepted against a
  // world built from a different change — the divergence landed elsewhere and the world stayed HELD.
  refuseOne(rt, change.principal, fromTick, `change targeting ${change.principal}`);
  const opened = await bootWorld(rt, store, {
    seed: SEED,
    // The KEY, which is what makes this fixture possible at all: `a` and `b` diverge at the
    // same tick, so a bare tick could not distinguish them and each would have accepted the
    // other. Their fingerprints differ because their `detail` differs.
    acceptDivergence: change.key,
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
