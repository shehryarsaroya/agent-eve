/**
 * DET-3 — replay from `(snapshot_T, action_log_T, seed_T)` reproduces `snapshot_T+1`.
 *
 * And the clause that is easy to skip: **events are output, never input.** So the
 * replay path is asserted to be reachable with no event ledger at all. If replay
 * ever needed one, the engine would have walked off §15.1's event-sourcing cliff.
 */

import { describe, it, expect } from 'vitest';
import { Engine, replayTick, ReplayError, restoreSnapshot } from '../../src/tick/index.js';
import { canonicalParams } from '../../src/tick/index.js';
import type { PrincipalId } from '../../src/core/types.js';
import { createWorld, launchMap } from '../../src/world/index.js';
import { PROBE_VERB, countingVerb, moveEveryone, permute, seatWorld, submission } from './harness.js';

const SEED = 'det3-seed';

/** A world with the same seats as the source engine. The map is authored, not state. */
function sameShapedWorld(count: number): ReturnType<typeof seatWorld> {
  return seatWorld(count);
}

describe('DET-3 — replay reproduces the next snapshot exactly', () => {
  it('restores snapshot_T, re-feeds action_log_T and seed_T, and lands on the same hash', () => {
    const counter = countingVerb();
    const source = seatWorld(4);
    const engine = new Engine({
      world: source.world,
      seed: SEED,
      verbs: { [PROBE_VERB]: counter.verb },
    });

    // Run a few ticks so the snapshot being replayed from is not the pristine one:
    // a replay that only ever works from tick -1 has not been tested.
    for (let t = 0; t < 3; t += 1) {
      for (const [i, principal] of source.principals.entries()) {
        engine.submit(submission({ principal, verb: PROBE_VERB, clientSequence: i, params: { t } }));
      }
      engine.runTick();
    }

    const snapshot = engine.snapshot();
    expect(snapshot.tick).toBe(2);

    // One more tick on the live engine, which is the tick the replay must reproduce.
    for (const move of moveEveryone(source.world, source.principals)) engine.submit(move);
    for (const [i, principal] of source.principals.entries()) {
      engine.submit(submission({ principal, verb: PROBE_VERB, clientSequence: 10 + i, params: { t: 3 } }));
    }
    const live = engine.runTick();
    expect(live.halted).toBe(false);
    expect(live.applied).toBeGreaterThan(0);

    // ── replay ──
    const target = sameShapedWorld(4);
    const replayCounter = countingVerb();
    const result = replayTick(
      { snapshot, actions: engine.log.forTick(live.tick), seed: SEED },
      target.world,
      { verbs: { [PROBE_VERB]: replayCounter.verb } },
    );

    expect(result.report.halted).toBe(false);
    expect(result.report.tick).toBe(live.tick);
    expect(result.report.stateHash).toBe(live.stateHash);
    expect(result.report.applied).toBe(live.applied);
    expect(result.report.refused).toBe(live.refused);
    expect(result.engine.snapshot().stateHash).toBe(engine.snapshot().stateHash);
  });

  it('is order-independent: the log may be re-fed in any order and still lands on the same hash', () => {
    // DET-2 and DET-3 are the same property from two sides. Replay re-derives
    // resolution order from the order key rather than trusting the log's order, so a
    // shuffled log must produce the same world.
    const source = seatWorld(5);
    const engine = new Engine({ world: source.world, seed: SEED });
    const snapshot = engine.snapshot();
    for (const move of moveEveryone(source.world, source.principals)) engine.submit(move);
    const live = engine.runTick();

    const log = engine.log.forTick(live.tick);
    for (let run = 0; run < 8; run += 1) {
      const target = sameShapedWorld(5);
      const result = replayTick(
        { snapshot, actions: permute(log, `replay:${String(run)}`), seed: SEED },
        target.world,
      );
      expect(result.report.stateHash).toBe(live.stateHash);
    }
  });

  it('needs no event ledger — events are output, never input', () => {
    // The engine under replay is constructed with no `events` sink at all, and the
    // ReplayInput type has no event field. If that ever changes, this fails and the
    // event-sourcing cliff has been stepped off.
    const source = seatWorld(3);
    const engine = new Engine({ world: source.world, seed: SEED });
    const snapshot = engine.snapshot();
    for (const move of moveEveryone(source.world, source.principals)) engine.submit(move);
    const live = engine.runTick();

    const input = { snapshot, actions: engine.log.forTick(live.tick), seed: SEED };
    expect(Object.keys(input).sort((a, b) => (a < b ? -1 : 1))).toEqual([
      'actions',
      'seed',
      'snapshot',
    ]);
    const result = replayTick(input, sameShapedWorld(3).world);
    expect(result.report.stateHash).toBe(live.stateHash);
  });

  it('refuses to replay into a world built on a different map, rather than moving every hand', () => {
    const source = seatWorld(2);
    const engine = new Engine({ world: source.world, seed: SEED });
    const snapshot = engine.snapshot();

    // A world with the right map but the wrong seats: the restore rebuilds the
    // presence tables, so this actually succeeds — and that is correct, because the
    // snapshot *is* the presence tables. The failure to catch is a different map.
    const wrongMap = createWorld(launchMap());
    // Corrupt the captured map hash so the restore's own guard fires. Hand-built
    // rather than by generating a second map, because the launch map is pinned.
    const tampered = {
      ...snapshot,
      tables: snapshot.tables.map(([name, value]) =>
        name === 'world'
          ? ([name, { ...(value as Record<string, never>), mapHash: 'deadbeef' }] as const)
          : ([name, value] as const),
      ),
    };
    const target = new Engine({ world: wrongMap, seed: SEED });
    expect(() => {
      restoreSnapshot(target.stateTables, tampered);
    }).toThrow(/map/);
  });

  it('refuses when an action the original tick applied cannot even be accepted', () => {
    // A divergence must be loud. A replay that quietly skipped an applied action
    // would produce a plausible world that nobody was ever shown.
    const source = seatWorld(2);
    const engine = new Engine({ world: source.world, seed: SEED });
    const snapshot = engine.snapshot();
    for (const move of moveEveryone(source.world, source.principals)) engine.submit(move);
    const live = engine.runTick();
    const log = engine.log.forTick(live.tick);
    expect(log.length).toBeGreaterThan(0);

    // Replay into an engine that does not know the verb.
    const target = sameShapedWorld(2);
    expect(() =>
      replayTick(
        { snapshot, actions: log.map((a) => ({ ...a, verb: 'no_such_verb' })), seed: SEED },
        target.world,
      ),
    ).toThrow(ReplayError);
  });

  it('a snapshot with a table the engine does not have is refused, not skipped', () => {
    const source = seatWorld(2);
    const engine = new Engine({ world: source.world, seed: SEED });
    const snapshot = engine.snapshot();
    const withGhost = {
      ...snapshot,
      tables: [...snapshot.tables, ['ghost', { anything: 1 }] as const].sort((a, b) =>
        a[0] < b[0] ? -1 : 1,
      ),
    };
    expect(() => {
      restoreSnapshot(engine.stateTables, withGhost);
    }).toThrow(/ghost/);
  });

  it('registers exactly the tables written before DERIVE, and no others', () => {
    // `world` and `intent` are written in VALIDATE+LOCK and MOVE, so they are in the
    // hash. The wake book is written in WAKE, which is *after* DERIVE, so it cannot
    // be — see `wakeStateTable`'s note and the post-DERIVE test in
    // `determinism.test.ts`. The action budget is scratch and carries nothing across
    // a tick.
    const source = seatWorld(2);
    const engine = new Engine({ world: source.world, seed: SEED });
    expect(engine.stateTables.map((t) => t.name).sort((a, b) => (a < b ? -1 : 1))).toEqual([
      'intent',
      'world',
    ]);
    // All three restore, so the abort path is a full rollback in this configuration.
    expect(engine.rollbackGaps).toEqual([]);
  });

  it('an intent whose parameters are not canonical is refused at creation, not at snapshot time', () => {
    // Otherwise an unreplayable intent lies dormant for days and breaks the first
    // snapshot taken after it — in a tick nobody is watching.
    expect(() => canonicalParams({ ratio: 0.5 }, 'probe')).toThrow(/safe integer/);
    const source = seatWorld(1);
    const engine = new Engine({ world: source.world, seed: SEED });
    const principal = source.principals[0] as PrincipalId;
    const accepted = engine.submit(
      submission({
        principal,
        verb: 'set_delivery_intent',
        params: { intent: { verb: PROBE_VERB, params: { ratio: 0.5 } }, until_tick: 50 },
      }),
    );
    expect(accepted.ok).toBe(true);
    const report = engine.runTick();
    expect(report.refused).toBe(1);
    const logged = engine.log.forTick(report.tick)[0];
    expect(logged?.rejection?.invariant).toBe('DET-3');
    // And the snapshot is still takeable, which is the property that was protected.
    expect(engine.snapshot().stateHash).not.toBe('');
  });

  it('seats a fresh world identically, or the fixture itself is nondeterministic', () => {
    const a = seatWorld(4);
    const b = seatWorld(4);
    const engineA = new Engine({ world: a.world, seed: SEED });
    const engineB = new Engine({ world: b.world, seed: SEED });
    expect(engineA.stateHash).toBe(engineB.stateHash);
    // And the same seats, so `enroll` really is order-stable.
    const seatsOf = (w: typeof a.world): string[] =>
      [...w.holdings.values()].map((h) => `${h.principal}@${h.system}`).sort((x, y) => (x < y ? -1 : 1));
    expect(seatsOf(a.world)).toEqual(seatsOf(b.world));
  });
});

describe('DET-3 with a standing intent in flight', () => {
  it('reproduces a tick whose intent ran, without re-submitting the intent’s action', () => {
    // The one replay path that needed checking rather than reasoning about. Intent
    // runs are produced by the intents the snapshot already holds, so re-submitting
    // the logged row would run each twice — and the run count is in the hash, so a
    // double run would show up as a divergence rather than as a silent duplicate.
    const source = seatWorld(2);
    const counter = countingVerb();
    const engine = new Engine({
      world: source.world,
      seed: SEED,
      verbs: { [PROBE_VERB]: counter.verb },
    });
    const principal = source.principals[0];
    if (principal === undefined) throw new Error('fixture seated nobody');

    engine.submit(
      submission({
        principal,
        verb: 'set_delivery_intent',
        params: { intent: { verb: PROBE_VERB, params: { n: 1 } }, max_runs: 20 },
      }),
    );
    engine.runTick();
    engine.runTick();
    engine.runTick();
    const snapshot = engine.snapshot();
    const runsAtSnapshot = engine.intents.inOrder()[0]?.runs;
    expect(runsAtSnapshot).toBe(2);

    const live = engine.runTick();
    expect(live.intentRuns).toBe(1);
    const log = engine.log.forTick(live.tick);
    expect(log.some((a) => a.decisionSource === 'INTENT')).toBe(true);

    const replayCounter = countingVerb();
    const result = replayTick(
      { snapshot, actions: log, seed: SEED },
      seatWorld(2).world,
      { verbs: { [PROBE_VERB]: replayCounter.verb } },
    );
    expect(result.report.stateHash).toBe(live.stateHash);
    expect(result.report.intentRuns).toBe(1);
    // Exactly one call in the replay: the intent ran once, not once per log row.
    expect(replayCounter.calls()).toBe(1);
    expect(result.engine.intents.inOrder()[0]?.runs).toBe(3);
  });
});
