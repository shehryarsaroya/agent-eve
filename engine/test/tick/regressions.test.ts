/**
 * Regressions found by an adversarial pass over the tick loop, each pinned so it
 * cannot come back.
 *
 * Four of these were live defects that the module's own tests could not see, and in
 * every case the reason was the same: the test exercised the property over a window
 * too short, or too clean, for the failure to be reachable. They are grouped here
 * rather than folded into the files they belong to so a reader can see, in one
 * screen, what shape of test the original suite was missing.
 *
 *   1. **A hashed state table was mutated after DERIVE.** `COMMIT` pruned the intent
 *      book, which is inside `state_hash`. The existing post-DERIVE test ran four
 *      ticks; the prune's retention window is 64, so it was unreachable. Effect:
 *      `snapshot_T` described a book the engine no longer held, and DET-3 replay of
 *      `T+1` from that snapshot diverged.
 *   2. **A resumed tick's action log was doubled.** `action_log_T` is replay's second
 *      term, so the resumed tick became permanently unreplayable.
 *   3. **`commitmentHolds` was a tautology** — both sides of the `===` recomputed the
 *      same hash from the same master, so the DET-6 check at COMMIT could not fail.
 *   4. **A refused wake consumed its item slot**, so the book claimed a party had been
 *      offered a wake it was never offered.
 */

import { describe, it, expect } from 'vitest';
import { generateKeypair } from '../../src/identity/keys.js';
import { HaltController, halt, signResume } from '../../src/invariants/index.js';
import { Rng } from '../../src/core/rng.js';
import type { PrincipalId } from '../../src/core/types.js';
import { WAKES_PER_RECKONING } from '../../src/core/time.js';
import {
  Engine,
  SeedBook,
  WakeBook,
  captureSnapshot,
  replayTick,
} from '../../src/tick/index.js';
import { PROBE_VERB, countingVerb, moveEveryone, seatWorld, submission } from './harness.js';

/** An engine with one intent that ends immediately, so a prune becomes reachable. */
function withSpentIntent(seed: string): { engine: Engine; principal: PrincipalId } {
  const counter = countingVerb();
  const { world, principals } = seatWorld(1);
  const principal = principals[0];
  if (principal === undefined) throw new Error('fixture seated nobody');
  const engine = new Engine({ world, seed, verbs: { [PROBE_VERB]: counter.verb } });
  const accepted = engine.submit(
    submission({
      principal,
      verb: 'set_delivery_intent',
      params: { intent: { verb: PROBE_VERB, params: { n: 1 } }, max_runs: 1 },
    }),
  );
  expect(accepted.ok).toBe(true);
  return { engine, principal };
}

describe('no phase after DERIVE may mutate a hashed table — over the whole retention window', () => {
  it('holds for every tick past the action log’s retention bound, not just the first few', () => {
    // The original assertion was right and its window was too short: the intent
    // prune only fires once a row has been ended for `ticksRetained` ticks, so four
    // ticks could never reach it. Run past the boundary.
    const { engine } = withSpentIntent('regress-prune');
    const ticks = engine.log.ticksRetained + 6;
    const divergences: number[] = [];
    for (let t = 0; t <= ticks; t += 1) {
      const report = engine.runTick();
      expect(report.halted).toBe(false);
      const after = captureSnapshot(engine.stateTables, report.tick, report.stateVersion);
      if (after.stateHash !== report.stateHash) divergences.push(report.tick);
      // And the engine's own published snapshot must be the world it is actually in.
      expect(engine.snapshot().stateHash).toBe(report.stateHash);
    }
    expect(divergences).toEqual([]);
  });

  it('the intent book really is pruned, so the test above is not passing by never pruning', () => {
    // The anti-false-green guard. If the prune stopped happening the assertion above
    // would pass trivially, and the storage bound (scar #3) would be gone.
    const { engine } = withSpentIntent('regress-prune-fires');
    for (let t = 0; t <= 4; t += 1) engine.runTick();
    expect(engine.intents.inOrder().length).toBe(1);
    expect(engine.intents.inOrder()[0]?.state).toBe('SPENT');
    for (let t = 0; t <= engine.log.ticksRetained + 4; t += 1) engine.runTick();
    expect(engine.intents.inOrder().length).toBe(0);
  });

  it('DET-3: the tick after a prune replays from the published snapshot to the same hash', () => {
    const { engine } = withSpentIntent('regress-prune-replay');
    // Stop one tick after the prune boundary so the snapshot being replayed from is
    // the one straddling it.
    const boundary = engine.log.ticksRetained + 1;
    for (let t = 0; t <= boundary; t += 1) engine.runTick();
    const snapshot = engine.snapshot();
    const live = engine.runTick();
    expect(live.halted).toBe(false);

    const result = replayTick(
      { snapshot, actions: engine.log.forTick(live.tick), seed: 'regress-prune-replay' },
      seatWorld(1).world,
      { verbs: { [PROBE_VERB]: countingVerb().verb } },
    );
    expect(result.report.stateHash).toBe(live.stateHash);
  });
});

describe('a resumed tick’s action log holds each action once', () => {
  it('re-running under a signed resume replaces action_log_T rather than appending to it', () => {
    const keypair = generateKeypair();
    const controller = new HaltController({
      startTick: -1,
      startStateHash: '',
      resumeKeys: new Map([[keypair.keyid, keypair.record.publicKeyJwk]]),
    });
    const source = seatWorld(3);
    const snapshot0 = { tick: -1 } as const;
    void snapshot0;
    let defect = true;
    const engine = new Engine({
      world: source.world,
      seed: 'regress-resume-log',
      controller,
      assertions: [(tick) => (defect ? [halt('INV-9', tick, 'the defect')] : [])],
    });
    const before = engine.snapshot();
    for (const move of moveEveryone(source.world, source.principals)) {
      expect(engine.submit(move).ok).toBe(true);
    }
    const bad = engine.runTick();
    expect(bad.halted).toBe(true);
    const rowsAtHalt = engine.log.forTick(bad.tick).length;
    expect(rowsAtHalt).toBe(source.principals.length);

    const record = controller.haltRecord;
    if (record === null) throw new Error('the halt was not recorded');
    defect = false;
    const { outcome } = engine.resume(
      signResume(
        { tick: record.tick, tripleHash: record.inputsHash, keyid: keypair.keyid, note: 'fixed' },
        (bytes) => keypair.sign(bytes),
      ),
    );
    expect(outcome.ok, outcome.reason).toBe(true);

    // One row per action, not two. §15.1's action_log is replay's second term.
    const rows = engine.log.forTick(bad.tick);
    expect(rows.length).toBe(rowsAtHalt);
    expect(rows.map((r) => `${r.principal}/${String(r.clientSequence)}`).length).toBe(
      new Set(rows.map((r) => `${r.principal}/${String(r.clientSequence)}`)).size,
    );

    // And the resumed tick is still replayable from its own log, which is the property
    // the doubling destroyed: PROP-W5 refuses a duplicate client_sequence, so
    // replayTick threw on an action the original tick had applied.
    const result = replayTick(
      { snapshot: before, actions: rows, seed: 'regress-resume-log' },
      seatWorld(3).world,
    );
    expect(result.report.stateHash).toBe(engine.stateHash);
  });
});

describe('DET-6: the commitment check can actually fail', () => {
  it('compares the revealed seed against the bytes that were published, not against itself', () => {
    const seeds = new SeedBook('regress-det6');
    seeds.publish(4);
    seeds.freeze(4);
    expect(seeds.commitmentHolds(4)).toBe(true);
    expect(seeds.publishedCommitment(4)).toBe(Rng.seedHash(seeds.reveal(4)));
  });

  it('fails when the seed being revealed is not the seed that was committed', () => {
    // The mutation test, and the reason the check needed a stored commitment at all:
    // while both sides recomputed `seedHash(seedString(tick))` from the same master,
    // no input could make this false, so the COMMIT-phase guard was dead code.
    //
    // The failure it now catches is a master-seed swap, or the seed derivation moving,
    // between the publish and the reveal — either of which makes the published
    // commitment a promise the world did not keep.
    const seeds = new SeedBook('regress-det6-b');
    seeds.publish(9);
    seeds.freeze(9);
    expect(seeds.commitmentHolds(9)).toBe(true);

    const swapped = seeds as unknown as { readonly published: Map<number, string> };
    swapped.published.set(9, Rng.seedHash('a-different-master:t9'));
    expect(seeds.commitmentHolds(9)).toBe(false);
  });

  it('a revealable tick with no published commitment is a failure, not a pass', () => {
    const seeds = new SeedBook('regress-det6-c');
    seeds.publish(9);
    seeds.freeze(9);
    const stripped = seeds as unknown as { readonly published: Map<number, string> };
    stripped.published.delete(9);
    expect(seeds.isRevealable(9)).toBe(true);
    expect(seeds.publishedCommitment(9)).toBeNull();
    expect(seeds.commitmentHolds(9)).toBe(false);
  });

  it('and the engine halts the tick when it does fail', () => {
    // Proving the COMMIT-phase check is wired to the abort, not just present.
    const { world } = seatWorld(1);
    const engine = new Engine({ world, seed: 'regress-det6-halt' });
    const spy = engine.seeds;
    const original = spy.commitmentHolds.bind(spy);
    Object.defineProperty(spy, 'commitmentHolds', {
      value: (tick: number): boolean => (tick === 0 ? false : original(tick)),
      configurable: true,
    });
    const report = engine.runTick();
    expect(report.halted).toBe(true);
    expect(report.stateHash).toBe('');
    expect(report.violations.map((v) => v.id)).toContain('DET-6');
  });
});

describe('§5.1: a wake that was refused is not recorded as offered', () => {
  it('a budget refusal leaves the (principal, item) slot unspent', () => {
    const book = new WakeBook();
    const principal = 'p-001' as PrincipalId;
    for (let i = 0; i < WAKES_PER_RECKONING; i += 1) {
      expect(book.offer(principal, 0, 'VENTURE', `v${String(i)}`).granted).toBe(true);
    }
    expect(book.remaining(principal, 0)).toBe(0);

    const refused = book.offer(principal, 0, 'SETTLEMENT', 'the-one-that-matters');
    expect(refused.granted).toBe(false);
    if (!refused.granted) expect(refused.why).toBe('BUDGET_SPENT');

    // Asked again, the answer is still "your budget is spent" — never "you were
    // already offered this", which would be the book asserting an offer that has no
    // row in `offers()` and no wake behind it.
    const again = book.offer(principal, 0, 'SETTLEMENT', 'the-one-that-matters');
    expect(again.granted).toBe(false);
    if (!again.granted) expect(again.why).toBe('BUDGET_SPENT');

    // And the audit surface agrees: nothing about that item is in the log, and the
    // snapshot does not claim it either.
    expect(book.offers().some((o) => o.item === 'the-one-that-matters')).toBe(false);
    expect(JSON.stringify(book.captureState())).not.toContain('the-one-that-matters');
  });

  it('still refuses a genuine second offer for the same item', () => {
    // The other half, so the fix above did not weaken §5.1's actual guarantee.
    const book = new WakeBook();
    const principal = 'p-001' as PrincipalId;
    expect(book.offer(principal, 0, 'SETTLEMENT', 'v-1').granted).toBe(true);
    const second = book.offer(principal, 0, 'SETTLEMENT', 'v-1');
    expect(second.granted).toBe(false);
    if (!second.granted) expect(second.why).toBe('ALREADY_OFFERED');
  });
});
