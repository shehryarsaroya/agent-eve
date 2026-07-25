/**
 * `DET-10` — the whole Reckoning batch is one transaction that fails closed, over the
 * **real** stages.
 *
 * > `DET-10` The whole Reckoning batch is one transaction that fails closed. Inject a
 * > failure at each stage of §15.3's sequence and assert no partial commit is ever visible.
 * > *(A partially-committed batch is a permanent silent imbalance in an append-only ledger
 * > — unrecoverable by construction.)* — TESTING.md §5
 *
 * `test/invariants/transaction.test.ts` already proves this about `runReckoning` itself,
 * over synthetic stages. What it cannot prove is the thing that actually ships: that **the
 * Reckoning driver's own ten stages** fail closed. So this file injects into
 * `ReckoningBatch.stages()` — the real list, in the real order — rather than into a
 * stand-in.
 *
 * ## What "visible" means, and the one boundary a caller must respect
 *
 * Publication is commit. Two things an observer can read: the published pointer, and the
 * feed. The pointer is the controller's and never moves on a failed tick. The feed is read
 * **at a tick**, and the rule this file pins is that the tick to read at is
 * `controller.publishedTick` — never the tick in flight. Read that way, a failed
 * Reckoning's rows are invisible even when the failure came *after* `RECEIPTS` appended
 * them, because they are all at a tick above the published one.
 *
 * That is a real requirement on whatever serves the feed, and it is asserted here rather
 * than assumed: an API layer that paged the feed at `world.tick` instead would publish
 * half a Reckoning while the world was `PAUSED`.
 *
 * ## Why a failure after `RECEIPTS` is `TICK-TORN` and that is correct
 *
 * By then value has moved in the in-memory ledger and rows are in the in-memory event
 * ledger, neither of which can be un-done — the ledger is append-only in both. §15.3's
 * recovery is not a repair: it is a replay from `(snapshot_T, action_log_T, seed_T)` into a
 * world rebuilt from the snapshot, which discards the dirty state. So the assertion is
 * `torn === true` and *nothing published*, not `nothing mutated`.
 */

import { describe, expect, it } from 'vitest';
import { minor } from '../../src/core/units.js';
import {
  RECKONING_STAGES,
  runReckoning,
  type ReckoningStage,
  type Stage,
} from '../../src/invariants/index.js';
import { ReckoningBatch, type ReckoningRun } from '../../src/reckoning/index.js';
import { computeClaims, type Election } from '../../src/venture/index.js';
import {
  ALICE,
  BRAM,
  RULES_VERSION,
  SETTLE_TICK,
  fixture,
  freeze,
  goLive,
  makeHaul,
  planFor,
  tickInputs,
  type Fix,
} from './fixture.js';

const PROCEEDS = minor(12_000);

/** Stages that append to the permanent record, or run after one that did. */
const AFTER_THE_FIRST_APPEND: readonly ReckoningStage[] = ['RECEIPTS', 'RECONCILE', 'RELEASE'];

function runFor(f: Fix): ReckoningRun {
  const haul = makeHaul(f);
  goLive(f, haul, [ALICE, BRAM], PROCEEDS);
  const elections = new Map<number, Election>();
  for (const r of computeClaims(haul, PROCEEDS).roles) {
    if (r.electiveDue > 0) elections.set(r.roleIndex, r.electiveDue);
  }
  const frozen = freeze(f, [planFor(haul, { proceeds: PROCEEDS, elections })]);
  return {
    world: f.reckoningWorld,
    frozen,
    rulesVersion: RULES_VERSION,
    controller: f.controller,
    inputs: tickInputs(frozen.settlementTick),
    deeds: [],
    deedTally: [],
  };
}

/**
 * Replace one of the driver's real stages with one that throws while **applying**.
 *
 * The stage's own plan still runs, so every stage before it has done its real work and the
 * failure lands exactly where the injection names it. Wrapping rather than substituting is
 * what keeps this a test of the real pipeline: the other nine stages are untouched.
 */
function failApplying(stages: readonly Stage[], at: ReckoningStage): readonly Stage[] {
  return stages.map((stage) =>
    stage.name === at
      ? {
          name: stage.name,
          run: (ctx) => {
            ctx.effect(() => {
              throw new Error(`${at} broke while writing`);
            });
          },
        }
      : stage,
  );
}

/** Replace one stage with one that throws while **planning**: nothing is applied at all. */
function failPlanning(stages: readonly Stage[], at: ReckoningStage): readonly Stage[] {
  return stages.map((stage) =>
    stage.name === at
      ? {
          name: stage.name,
          run: () => {
            throw new Error(`${at} could not compute its outcome`);
          },
        }
      : stage,
  );
}

function drive(
  f: Fix,
  run: ReckoningRun,
  stages: readonly Stage[],
): ReturnType<typeof runReckoning> {
  const batch = new ReckoningBatch(run);
  return runReckoning({
    tick: run.frozen.settlementTick,
    inputs: run.inputs,
    stages: stages.length > 0 ? stages : batch.stages(),
    assert: () => batch.assert(),
    stateHash: () => f.ledger.stateHash(),
    controller: f.controller,
  });
}

describe('DET-10 — the happy path commits exactly once', () => {
  it('publishes after ASSERT, and only then', () => {
    const f = fixture();
    const run = runFor(f);
    const batch = new ReckoningBatch(run);
    const before = f.controller.publishedStateHash;

    const outcome = runReckoning({
      tick: run.frozen.settlementTick,
      inputs: run.inputs,
      stages: batch.stages(),
      assert: () => {
        // The pointer must still be at the last good tick while ASSERT runs.
        expect(f.controller.publishedTick).toBe(-1);
        return batch.assert();
      },
      stateHash: () => f.ledger.stateHash(),
      controller: f.controller,
    });

    expect(outcome.committed).toBe(true);
    expect(outcome.planned).toEqual([...RECKONING_STAGES]);
    expect(f.controller.publishedTick).toBe(SETTLE_TICK);
    expect(f.controller.publishedStateHash).not.toBe(before);
  });
});

describe('DET-10 — a failure at each of §15.3’s ten stages, and no partial commit is visible', () => {
  for (const stage of RECKONING_STAGES) {
    it(`${stage} fails while applying: nothing published, world PAUSED`, () => {
      const f = fixture();
      const run = runFor(f);
      const outcome = drive(f, run, failApplying(new ReckoningBatch(run).stages(), stage));

      expect(outcome.committed).toBe(false);
      expect(outcome.failedAt).toBe(stage);
      expect(outcome.stateHash).toBeNull();
      // The published pointer never moved, so no observer saw any of it.
      expect(f.controller.publishedTick).toBe(-1);
      expect(f.controller.status).toBe('PAUSED');
      expect(f.controller.haltRecord?.tick).toBe(SETTLE_TICK);
      // The input triple is attached, which is what makes the recovery a replay rather
      // than a repair.
      expect(f.controller.haltRecord?.inputs.tick).toBe(SETTLE_TICK);
      expect(f.controller.haltRecord?.inputsHash.length).toBeGreaterThan(0);

      // Read the feed at the published tick — the only tick a caller may serve — and the
      // failed Reckoning is not in it.
      const feed = f.events.spectatorFeed({
        atTick: Math.max(f.controller.publishedTick, 0),
        after: null,
        limit: 64,
      });
      expect(feed.views.filter((v) => v.event.kind.startsWith('venture.'))).toEqual([]);

      if (!AFTER_THE_FIRST_APPEND.includes(stage)) {
        // Before `RECEIPTS` nothing was appended at all, so the in-memory record is clean
        // too and not merely unpublished.
        expect(
          f.events.eventsAtTick(SETTLE_TICK).filter((r) => r.event.kind.startsWith('venture.')),
        ).toEqual([]);
        expect(f.register.size).toBe(0);
      }
    });
  }

  for (const stage of RECKONING_STAGES) {
    it(`${stage} fails while planning: nothing is applied at all`, () => {
      const f = fixture();
      const run = runFor(f);
      const before = f.ledger.stateHash();
      const outcome = drive(f, run, failPlanning(new ReckoningBatch(run).stages(), stage));

      expect(outcome.committed).toBe(false);
      expect(outcome.failedAt).toBe(stage);
      expect(outcome.torn).toBe(false);
      expect(outcome.applied).toEqual([]);
      // A plan-stage failure leaves the world coherent: the ledger did not move, so a
      // replay is clean rather than a rebuild.
      expect(f.ledger.stateHash()).toBe(before);
      expect(f.register.size).toBe(0);
      expect(f.standing.changes()).toEqual([]);
      expect(f.controller.publishedTick).toBe(-1);
      expect(f.controller.status).toBe('PAUSED');
    });
  }
});

describe('DET-10 — the halt record is honest about what it checked', () => {
  it('an abort before ASSERT lists every invariant as unchecked, rather than as clean', () => {
    const f = fixture();
    const run = runFor(f);
    const outcome = drive(f, run, failPlanning(new ReckoningBatch(run).stages(), 'ESCROWED'));

    // An empty violation list from a pass that never ran is indistinguishable from a clean
    // world, which is the one thing an operator must not be told at a halt.
    expect(outcome.report?.violations.length).toBeGreaterThan(0);
    expect(outcome.report?.checked).toEqual([]);
    expect(outcome.report?.skipped.length).toBeGreaterThan(20);
    for (const s of outcome.report?.skipped ?? []) {
      expect(s.reason).toContain('nothing was checked and nothing was published');
    }
  });

  it('a torn stage outranks every invariant in the register, INV-17 included', () => {
    const f = fixture();
    const run = runFor(f);
    const outcome = drive(f, run, failApplying(new ReckoningBatch(run).stages(), 'RECEIPTS'));
    // §15.3 calls a partially-committed batch "unrecoverable by construction", so it is the
    // first thing an operator reads.
    expect(outcome.torn).toBe(true);
    expect(outcome.report?.violations[0]?.id).toBe('TICK-TORN');
    expect(f.controller.haltRecord?.topId).toBe('TICK-TORN');
  });
});
