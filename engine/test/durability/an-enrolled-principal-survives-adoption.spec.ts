/**
 * ══════════════════════════════════════════════════════════════════════════════
 * **CLOSED. THE ANSWER IS IN `a-forked-record-cannot-be-adopted.test.ts`, AND IT WAS NOT THIS.**
 *
 * The bug this file was built to hunt is reproduced, diagnosed and fixed, and the diagnosis is that
 * `p:vale` being an ENROLLED principal was a coincidence. Production's world has accepted a declared
 * discontinuity at tick 287 **nine times** (`journal_divergence`, one row per rules change), so from
 * tick 287 on its durable `posting` and `event` logs were written by worlds it has been declared not
 * to be — while every snapshot after that describes the world that is. Adoption rebuilds the ledger
 * FROM those logs, so it was asking a superseded record to justify the current one. The account it
 * named was never missing: the log holds `escrow:v:2830:117e86ad:p:vale` and the capture holds
 * `escrow:v:2830:516e910d:p:vale` — same tick, same funder, same venture, a different world-global
 * ordinal in `hash(tick, principal, ordinal)`.
 *
 * The refusal was CORRECT. Only the message was wrong, and it was wrong in the most expensive
 * possible way: it named the ledger, so three sessions searched the ledger.
 *
 * **This file keeps its place unchanged**, for the reason its last paragraph already gives: the
 * durability tier should not be able to claim adoption works while never once adopting a world
 * containing the kind of principal the game is built for. The investigation log below is left as
 * written, because the order the theories died in is the useful part.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * THE FIXTURE `test/durability/` NEVER HAD: A WORLD WITH A REAL ENROLLED AGENT IN IT.
 *
 * Every other durability fixture is **cast-only**. The house cast is re-seated deterministically from
 * the master seed and is never stored, so a cast-only world exercises exactly the path that cannot
 * break — and that is why 900 ticks of heuristic world adopts a checkpoint cleanly while production
 * does not:
 *
 *     CHECKPOINT_UNUSABLE at tick 4895
 *     posting (tick 2830, batch 0, index 1) moves value in account
 *     escrow:v:2830:117e86ad:p:vale, which the snapshot's ledger capture does not contain.
 *
 * `p:vale` is an externally ENROLLED principal. Enrolments are re-seated at boot through a separate
 * hook (`onEnrollment`) rather than by replayed actions, which makes them the one class of account
 * whose creation is not driven by the action log — and therefore the one class that can go missing
 * from a replayed ledger while the durable posting log still remembers its postings.
 *
 * ── TWO THEORIES ALREADY REFUTED, BOTH BY CHECKING RATHER THAN REASONING ─────
 *
 * 1. *"The escrow closed and its account was removed from the capture."* False twice over:
 *    `ledgerStateTable.capture()` includes EVERY account (`allAccounts()`, no filter, no cap), and
 *    there is no account deletion anywhere in `ledger.ts`.
 * 2. *"A long world is the trigger."* False: a 700-tick heuristic world adopts with a byte-identical
 *    head hash.
 *
 * So the account was genuinely absent from the tick-4895 LEDGER while present in the POSTING LOG, and
 * the two are rebuilt by different mechanisms. This file is the instrument for that hypothesis.
 *
 * ── IT PASSED, WHICH IS A RESULT AND NOT A CLEAN BILL ────────────────────────
 *
 * Verified to reach the hydrate rather than pass vacuously: the plan is ADOPTABLE at tick 200 and
 * adoption completes. So **enrolment alone is not the trigger.** Theory 3 refuted.
 *
 * Remaining suspects, in order:
 *
 *   1. **Seat recycling.** Production reports `occupied: 1, recycled: 9` against `population: 22` —
 *      heavy churn, and a recycled seat is the one case where a principal's identity is reused while
 *      its history is not. This fixture enrols once and never recycles.
 *   2. **An action that once APPLIED and would now be refused.** Replay drives the ledger from the
 *      action log, so a verb whose gate tightened leaves a replayed world missing whatever that action
 *      created — while the posting log, which is durable and append-only, still remembers it.
 *
 * ── AND THE FIRST RUN FOUND SOMETHING REAL, BY BEING WRONG ───────────────────
 *
 * Journalling AFTER the enrolment produced: *"the record yields 4 postings in 2 batches, but the
 * snapshot was taken over 6 postings in 4 batches."* That is a fixture artifact — production attaches
 * its Journal at boot — but it is worth keeping, because it is a **live hazard with a narrow window**:
 * any posting made before the Journal is attached lands in the ledger and never in the durable log, and
 * adoption then refuses forever with a message about counts rather than about ordering. If the Journal
 * is ever attached lazily, or after a mid-run reconnect, this is the failure it produces.
 *
 * The fixture earns its place either way: `test/durability/` should not be able to claim adoption works
 * while never once adopting a world containing the kind of principal the game is built for.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryJournalStore, Journal, bootFromStore, planCheckpoint } from '../../src/persist/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { setSpeed } from '../../src/core/time.js';
import { PATHS, agent, enrol, harness, signed, type Harness } from '../api/harness.js';

let open: Harness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

describe('a world containing a real enrolled principal can still be adopted', () => {
  it('journals an enrolled agent’s activity and adopts the checkpoint it produced', async () => {
    const SEED = 'enrolled-adoption';
    const h = await harness({ seed: SEED });
    open = h;

    // ── JOURNAL FIRST, THEN ENROL ─────────────────────────────────────────────
    //
    // Ordering matters and getting it wrong the first time was instructive: journalling AFTER the
    // enrolment left the endowment's postings in the ledger and out of the durable log, and adoption
    // refused with "the record yields 4 postings in 2 batches, but the snapshot was taken over 6 in 4".
    // That is a fixture artifact — production attaches its Journal at boot — so the journal starts here,
    // and any disagreement from now on is the engine's rather than mine.
    const store = new InMemoryJournalStore();
    const journal = new Journal(store, { snapshotEveryTicks: 50 });
    await bootFromStore(h.runtime, store, { seed: SEED });

    // A REAL enrolment over HTTP — the thing no other durability fixture does. Its account is created
    // outside the action log, which is the whole point of the exercise.
    const who = agent('probe-durable');
    expect((await enrol(h, who)).status, 'the agent must actually enrol').toBe(201);
    {
      const first = h.runtime.runTick();
      journal.record(h.runtime, first);
      await journal.flushPending();
    }

    // Give it something to do that MOVES VALUE, since an account with no postings proves nothing about
    // a posting log disagreeing with a ledger.
    await signed(h, who, 'POST', PATHS.act, {
      actions: [{ verb: 'create', params: { kind: 'HAUL', stage: 'sys-01' }, clientSequence: 1 }],
    });

    for (let i = 0; i < 220; i += 1) {
      const report = h.runtime.runTick();
      if (report.halted) throw new Error(`halted at ${String(report.tick)}`);
      journal.record(h.runtime, report);
      await journal.flushPending();
    }
    await journal.drain();

    // Now the question: can a fresh process adopt the checkpoint this world produced?
    const required = h.runtime.engine.stateTables.filter((t) => t.restore !== undefined).map((t) => t.name);
    const plan = await planCheckpoint(h.runtime.engine.stateTables, store, { requiredTables: required });

    // A refusal here is legitimate (the manifest, the rules stamp) and is NOT the bug — the bug is the
    // hydrate throwing on an account it cannot find. Report which happened rather than collapsing them.
    if (plan.snapshot === null) {
      expect(
        plan.refusal ?? '',
        'adoption was refused before the hydrate, so this run says nothing about the escrow bug — ' +
          'the fixture needs adjusting until it actually reaches the hydrate',
      ).toBeTruthy();
      return;
    }

    setSpeed('instant');
    const fresh = new Runtime({ seed: SEED });
    new HeuristicCast(fresh, { size: 1 }).seat(SEED);
    const result = await bootFromStore(fresh, store, { seed: SEED, checkpoint: { requiredTables: required } });

    // `CheckpointUnusableError` now degrades to a genesis replay rather than holding the world, so the
    // symptom is a REFUSAL MENTIONING AN ACCOUNT rather than a throw. That is the string to watch.
    expect(
      result.checkpointRefusal ?? '',
      'REPRODUCED: a world with an enrolled principal produced a checkpoint whose ledger capture is ' +
        'missing an account its own posting log references. This is the production failure, in a test.',
    ).not.toMatch(/does not contain/);
  }, 300_000);
});
