/**
 * DET-10 — the whole Reckoning batch is one transaction that fails closed.
 *
 * > Inject a failure at each stage of §15.3's sequence and assert no partial commit is
 * > ever visible. *(A partially-committed batch is a permanent silent imbalance in an
 * > append-only ledger — unrecoverable by construction.)* — TESTING.md §5
 *
 * "Ever visible" is the load-bearing word, and it decides what this test measures.
 * In-memory mutation cannot be the thing being prevented: ASSERT runs *over* the
 * state the tick produced, so the state has to exist before the tick can be judged.
 * What must never move is the **published** pointer and, with it, everything an agent
 * or a viewer can read at that tick.
 *
 * So each case below injects a failure at one stage and asserts four things: the
 * published tick did not move, the published state hash did not move, the world is
 * PAUSED, and nothing from the failed tick is readable through either feed.
 */

import { describe, expect, it } from 'vitest';
import { canonicalHash } from '../../src/core/canonical.js';
import type { InvariantReport } from '../../src/invariants/index.js';
import {
  CASCADE_ROUND_LIMIT,
  HaltController,
  RECKONING_STAGES,
  TransactionError,
  assertBoundedRounds,
  freezeTriple,
  halt,
  runReckoning,
  type ReckoningStage,
  type Stage,
  type TickInputs,
} from '../../src/invariants/index.js';
import { EventLedger } from '../../src/events/ledger.js';
import { ALICE, publicEvent } from './fixture.js';

const START_TICK = 100;
const START_HASH = canonicalHash({ world: 'clean' });
const FAILED_TICK = 101;

function inputs(tick = FAILED_TICK): TickInputs {
  return freezeTriple({
    tick,
    snapshot: { accounts: [], tick: tick - 1 },
    actionLog: [{ principal: 'alice', verb: 'move', clientSequence: 1 }],
    seed: `seed:${tick}`,
  });
}

function controller(): HaltController {
  return new HaltController({
    startTick: START_TICK,
    startStateHash: START_HASH,
    resumeKeys: new Map(),
  });
}

const CLEAN_REPORT: InvariantReport = { tick: FAILED_TICK, violations: [], checked: [], skipped: [] };

/** A stage that applies one effect and does not fail. */
function working(name: ReckoningStage, log: string[]): Stage {
  return {
    name,
    run: (ctx) => {
      ctx.effect(() => log.push(`applied:${name}`));
    },
  };
}

/** A stage that throws while planning. */
function failsPlanning(name: ReckoningStage): Stage {
  return {
    name,
    run: () => {
      throw new Error(`${name} could not compute its outcome`);
    },
  };
}

/** A stage that plans fine and throws while applying — the torn case. */
function failsApplying(name: ReckoningStage): Stage {
  return {
    name,
    run: (ctx) => {
      ctx.effect(() => {
        throw new Error(`${name} broke while writing`);
      });
    },
  };
}

describe('the happy path commits exactly once', () => {
  it('publishes only after ASSERT is clean, and only at the last stage', () => {
    const log: string[] = [];
    const ctl = controller();
    const nextHash = canonicalHash({ world: 'after' });
    const outcome = runReckoning({
      tick: FAILED_TICK,
      inputs: inputs(),
      stages: RECKONING_STAGES.map((s) => working(s, log)),
      assert: () => {
        // The published pointer must still be at the last good tick when ASSERT runs.
        expect(ctl.publishedTick).toBe(START_TICK);
        return CLEAN_REPORT;
      },
      stateHash: () => nextHash,
      controller: ctl,
    });
    expect(outcome.committed).toBe(true);
    expect(outcome.torn).toBe(false);
    expect(outcome.planned).toEqual([...RECKONING_STAGES]);
    expect(log).toHaveLength(RECKONING_STAGES.length);
    expect(ctl.status).toBe('RUNNING');
    expect(ctl.publishedTick).toBe(FAILED_TICK);
    expect(ctl.publishedStateHash).toBe(nextHash);
  });
});

describe('DET-10 — a failure at each stage of §15.3, and no partial commit is ever visible', () => {
  for (const stage of RECKONING_STAGES) {
    it(`planning failure at ${stage}: nothing applied, nothing published, world PAUSED`, () => {
      const log: string[] = [];
      const ctl = controller();
      let assertRan = false;
      const outcome = runReckoning({
        tick: FAILED_TICK,
        inputs: inputs(),
        stages: RECKONING_STAGES.map((s) => (s === stage ? failsPlanning(s) : working(s, log))),
        assert: () => {
          assertRan = true;
          return CLEAN_REPORT;
        },
        stateHash: () => canonicalHash({ world: 'never' }),
        controller: ctl,
      });

      expect(outcome.committed).toBe(false);
      expect(outcome.failedAt).toBe(stage);
      // Not torn: the effects of the earlier stages were queued, never applied.
      expect(outcome.torn).toBe(false);
      expect(log).toEqual([]);
      expect(assertRan).toBe(false);
      expect(outcome.applied).toEqual([]);

      // The four visibility assertions.
      expect(ctl.status).toBe('PAUSED');
      expect(ctl.publishedTick).toBe(START_TICK);
      expect(ctl.publishedStateHash).toBe(START_HASH);
      expect(ctl.haltRecord?.tick).toBe(FAILED_TICK);
      expect(ctl.haltRecord?.topId).toBe('TICK-STAGE');
    });

    it(`apply failure at ${stage}: torn in memory, still nothing published`, () => {
      const log: string[] = [];
      const ctl = controller();
      const outcome = runReckoning({
        tick: FAILED_TICK,
        inputs: inputs(),
        stages: RECKONING_STAGES.map((s) => (s === stage ? failsApplying(s) : working(s, log))),
        assert: () => CLEAN_REPORT,
        stateHash: () => canonicalHash({ world: 'never' }),
        controller: ctl,
      });

      expect(outcome.committed).toBe(false);
      expect(outcome.torn).toBe(true);
      expect(outcome.failedAt).toBe(stage);
      expect(ctl.status).toBe('PAUSED');
      expect(ctl.publishedTick).toBe(START_TICK);
      expect(ctl.publishedStateHash).toBe(START_HASH);
      // A torn commit outranks every invariant in the register, INV-17 included:
      // INV-17 libels one principal, this one silently unbalances every promise.
      expect(ctl.haltRecord?.topId).toBe('TICK-TORN');
      expect(ctl.haltRecord?.reason).toContain('unrecoverable by construction');
      // Stages before the failure did apply; that is why the world is unusable and
      // why the resume path replays from the triple rather than repairing it.
      const index = RECKONING_STAGES.indexOf(stage);
      expect(log).toHaveLength(index);
    });
  }

  it('an ASSERT failure publishes nothing and names the invariant, not the stage', () => {
    const ctl = controller();
    const outcome = runReckoning({
      tick: FAILED_TICK,
      inputs: inputs(),
      stages: [working('FREEZE', [])],
      assert: () => ({
        tick: FAILED_TICK,
        violations: [halt('INV-17', FAILED_TICK, 'a default with no attributable cause')],
        checked: ['INV-17'],
        skipped: [],
      }),
      stateHash: () => canonicalHash({ world: 'never' }),
      controller: ctl,
    });
    expect(outcome.committed).toBe(false);
    expect(outcome.torn).toBe(false);
    expect(ctl.status).toBe('PAUSED');
    expect(ctl.publishedTick).toBe(START_TICK);
    expect(ctl.haltRecord?.topId).toBe('INV-17');
    expect(ctl.haltRecord?.reason).toContain('top severity');
  });

  it('nothing from the failed tick is readable through either feed at the published tick', () => {
    // The visibility claim, made against the real event ledger rather than argued.
    const events = new EventLedger();
    publicEvent(events, { tick: START_TICK, kind: 'LAST_GOOD_THING', actor: ALICE });
    const ctl = controller();

    runReckoning({
      tick: FAILED_TICK,
      inputs: inputs(),
      stages: [
        {
          name: 'RECEIPTS',
          run: (ctx) => {
            // A stage that writes to the record and then the tick fails ASSERT.
            ctx.effect(() => {
              publicEvent(events, { tick: FAILED_TICK, kind: 'HALF_A_RECKONING', actor: ALICE });
            });
          },
        },
      ],
      assert: () => ({
        tick: FAILED_TICK,
        violations: [halt('INV-2', FAILED_TICK, 'supply does not conserve')],
        checked: ['INV-2'],
        skipped: [],
      }),
      stateHash: () => canonicalHash({ world: 'never' }),
      controller: ctl,
    });

    expect(ctl.status).toBe('PAUSED');
    // Feeds are read at the published tick, never at the tick being computed. That
    // one rule is what makes "no partial commit is ever visible" true of a ledger
    // that has already been appended to in memory.
    const spectator = ctl.publishedTick;
    const page = events.spectatorFeed({ atTick: spectator, after: null, limit: 50 });
    expect(page.views.map((v) => v.event.kind)).toEqual(['LAST_GOOD_THING']);
    const agent = events.agentFeed({ principal: ALICE, atTick: spectator, after: null, limit: 50 });
    expect(agent.views.map((v) => v.event.kind)).toEqual(['LAST_GOOD_THING']);
  });

  it('refuses to publish while PAUSED, so a caller cannot forget to check', () => {
    const ctl = controller();
    ctl.haltTick(
      { tick: FAILED_TICK, violations: [halt('INV-2', FAILED_TICK, 'broken')], checked: [], skipped: [] },
      inputs(),
    );
    expect(() => ctl.publish(FAILED_TICK, canonicalHash({ world: 'sneaky' }))).toThrow(/PAUSED/);
    expect(ctl.publishedTick).toBe(START_TICK);
  });
});

describe('the stage order is checked, because seniority depends on it', () => {
  it('refuses ELECTIVE before ESCROWED', () => {
    expect(() =>
      runReckoning({
        tick: FAILED_TICK,
        inputs: inputs(),
        stages: [working('ELECTIVE', []), working('ESCROWED', [])],
        assert: () => CLEAN_REPORT,
        stateHash: () => START_HASH,
        controller: controller(),
      }),
    ).toThrow(TransactionError);
  });

  it('refuses a stage that runs twice', () => {
    expect(() =>
      runReckoning({
        tick: FAILED_TICK,
        inputs: inputs(),
        stages: [working('FREEZE', []), working('FREEZE', [])],
        assert: () => CLEAN_REPORT,
        stateHash: () => START_HASH,
        controller: controller(),
      }),
    ).toThrow(/twice/);
  });

  it('accepts a subset in order — not every Reckoning runs every stage', () => {
    const ctl = controller();
    const outcome = runReckoning({
      tick: FAILED_TICK,
      inputs: inputs(),
      stages: [working('FREEZE', []), working('WATERFALL', []), working('RELEASE', [])],
      assert: () => CLEAN_REPORT,
      stateHash: () => canonicalHash({ world: 'subset' }),
      controller: ctl,
    });
    expect(outcome.committed).toBe(true);
  });
});

describe('DET-9 — the cascade is bounded, and an unresolved obligation DEFERS', () => {
  it('accepts up to the round limit', () => {
    expect(() => {
      assertBoundedRounds(CASCADE_ROUND_LIMIT);
    }).not.toThrow();
  });

  it('refuses past it, and says why a truncated cascade must never default', () => {
    expect(() => {
      assertBoundedRounds(CASCADE_ROUND_LIMIT + 1);
    }).toThrow(/DEFER/);
  });
});
