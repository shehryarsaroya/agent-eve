/**
 * The window: the frozen snapshot, the total order, and the published caps.
 *
 * The central rule (SPEC §15.2) is that **within-tick actions never react to
 * another within-tick action** — and the honesty of submit-time validation is a
 * consequence of it, not a separate feature. Both are asserted here.
 *
 * The subtle one is the *total* order. `Array.prototype.sort` is stable, so a tie in
 * `(priority, principal_id, client_sequence)` silently falls back to insertion
 * order, which is arrival order, which is the A4 hole the whole design closes. A
 * duplicate `client_sequence` is therefore refused at submit (PROP-W5) *and* the
 * freeze asserts strictness anyway.
 */

import { describe, it, expect } from 'vitest';
import type { PrincipalId } from '../../src/core/types.js';
import {
  Engine,
  MAX_QUEUED_ACTIONS,
  MAX_QUEUED_PER_PRINCIPAL,
  PRIORITY,
  QueueError,
  SubmissionQueue,
  defaultPriority,
} from '../../src/tick/index.js';
import {
  PROBE_VERB,
  commonsMove,
  countingVerb,
  moveEveryone,
  probeVerbs,
  seatWorld,
  submission,
} from './harness.js';

describe('the window is frozen for its whole length', () => {
  it('refuses a submission while a tick is resolving', () => {
    // Enforced, not documented: an action accepted mid-tick would be reacting to a
    // decision inside it.
    const { world, principals } = seatWorld(1);
    const principal = principals[0];
    if (principal === undefined) throw new Error('fixture seated nobody');
    // Held in a box rather than a `let`, because TypeScript narrows a `let`
    // assigned only inside a closure to `never` at the read.
    const box: { mid: ReturnType<Engine['submit']> | null } = { mid: null };
    const engine = new Engine({
      world,
      seed: 'window',
      handlers: {
        VENTURES: () => {
          box.mid = engine.submit(submission({ principal, verb: PROBE_VERB, clientSequence: 7 }));
        },
      },
    });
    engine.runTick();
    const mid = box.mid;
    expect(mid).not.toBeNull();
    if (mid === null) throw new Error('the handler never ran');
    expect(mid.ok).toBe(false);
    if (!mid.ok) {
      expect(mid.invariant).toBe('A3');
      expect(mid.hint).toMatch(/is resolving/);
    }
  });

  it('the submit-time verdict is the VALIDATE-time verdict, for actions from different actors', () => {
    // This is what "submit-time validation is honest" means. Cross-actor, because an
    // actor's *own* later actions are competing commitments and may legitimately
    // fail once an earlier one has applied (§12.3).
    const { world, principals } = seatWorld(6);
    const engine = new Engine({ world, seed: 'honest' });
    const submitted = moveEveryone(world, principals);
    for (const action of submitted) expect(engine.submit(action).ok).toBe(true);
    const report = engine.runTick();
    expect(report.applied).toBe(submitted.length);
    expect(report.refused).toBe(0);
  });

  it('resolves one actor’s competing commitments by client_sequence, never arrival', () => {
    // PROP-W5. Two moves of the same hand: the first applies, the second cannot,
    // and which is which is decided by the sequence number the agent chose.
    const { world, principals } = seatWorld(1);
    const principal = principals[0];
    if (principal === undefined) throw new Error('fixture seated nobody');
    const move = commonsMove(world, principal);
    if (move === null) throw new Error('no Commons lane to move along');

    const engine = new Engine({ world, seed: 'competing' });
    // Submitted second, sequenced first.
    expect(
      engine.submit(
        submission({ principal, verb: 'move', clientSequence: 1, params: { hand: move.hand, to: move.to } }),
      ).ok,
    ).toBe(true);
    expect(
      engine.submit(
        submission({ principal, verb: 'move', clientSequence: 0, params: { hand: move.hand, to: move.to } }),
      ).ok,
    ).toBe(true);

    const report = engine.runTick();
    const rows = engine.log.forTick(report.tick);
    expect(rows.map((r) => r.clientSequence)).toEqual([0, 1]);
    expect(rows[0]?.outcome).toBe('APPLIED');
    // The second is refused because the hand is already in transit, not because it
    // arrived later.
    expect(rows[1]?.outcome).toBe('REFUSED');
    expect(rows[1]?.rejection?.invariant).toBe('INV-9');
  });

  it('refuses a duplicate client_sequence, because a tie would fall back to arrival order', () => {
    const { world, principals } = seatWorld(1);
    const principal = principals[0];
    if (principal === undefined) throw new Error('fixture seated nobody');
    const engine = new Engine({ world, seed: 'dupe', verbs: probeVerbs() });
    expect(engine.submit(submission({ principal, verb: PROBE_VERB, clientSequence: 3 })).ok).toBe(true);
    const dupe = engine.submit(submission({ principal, verb: PROBE_VERB, clientSequence: 3 }));
    expect(dupe.ok).toBe(false);
    if (!dupe.ok) {
      expect(dupe.invariant).toBe('PROP-W5');
      expect(dupe.hint).toMatch(/never by arrival time/);
    }
  });

  it('the frozen window is strictly ordered, which is what the dedupe buys', () => {
    // The dedupe at accept is what makes the order *total*, and a total order is
    // what makes the sort's stability irrelevant. Asserted over a mixed set:
    // several principals, several sequences, both priorities.
    const queue = new SubmissionQueue(0);
    queue.openFor(0);
    for (const p of ['p-003', 'p-001', 'p-002']) {
      for (const seq of [2, 0, 1]) {
        const accepted = queue.accept({
          ...submission({ principal: p as PrincipalId, verb: PROBE_VERB, clientSequence: seq }),
          priority: seq === 1 ? PRIORITY.CONTEST : PRIORITY.ORDINARY,
        });
        expect(accepted.ok).toBe(true);
      }
    }
    const frozen = queue.freeze();
    expect(frozen.actions.length).toBe(9);
    const keys = frozen.actions.map((a) => `${String(a.priority)}|${a.principal}|${String(a.clientSequence)}`);
    expect(keys).toEqual([...keys].sort((a, b) => (a < b ? -1 : 1)));
    // Every hostile-priority action is after every ordinary one.
    const firstContest = frozen.actions.findIndex((a) => a.priority === PRIORITY.CONTEST);
    expect(frozen.actions.slice(firstContest).every((a) => a.priority === PRIORITY.CONTEST)).toBe(true);
  });

  it('refuses a submission for a closed window rather than silently queueing it late', () => {
    const queue = new SubmissionQueue(0);
    const refused = queue.accept(
      submission({ principal: 'p-001' as PrincipalId, verb: PROBE_VERB, clientSequence: 0 }),
    );
    expect(refused.ok).toBe(false);
    // And reopening for an earlier tick is an engine bug, not a game outcome.
    queue.openFor(4);
    expect(() => {
      queue.openFor(3);
    }).toThrow(QueueError);
  });

  it('orders hostile acts after peaceful ones in the same tick', () => {
    // Derived from the Commons floor's own total classification rather than from a
    // second table (§3, scar #1). What it buys: `yield` and `flee` are not
    // out-raced by the `demand` that provoked them.
    expect(defaultPriority('move', {})).toBe(PRIORITY.ORDINARY);
    expect(defaultPriority('yield', {})).toBe(PRIORITY.ORDINARY);
    // `engage` replaced `flee` (SPEC §9A) and is CONTEST rather than ORDINARY, which is the
    // classification doing its job: committing a warship is an act of force, so it resolves after
    // every peaceful act in the same tick — including the `yield` of a target that decided not to
    // fight after all. That ordering is the whole reason the priority is derived from the Commons
    // floor's classification rather than from a second table.
    expect(defaultPriority('engage', {})).toBe(PRIORITY.CONTEST);
    expect(defaultPriority('demand', {})).toBe(PRIORITY.CONTEST);
    expect(defaultPriority('fight', {})).toBe(PRIORITY.CONTEST);
    // An unknown verb is hostile by default, so it sorts last too.
    expect(defaultPriority('whatever_this_is', {})).toBe(PRIORITY.CONTEST);
    expect(PRIORITY.ORDINARY).toBeLessThan(PRIORITY.CONTEST);
  });
});

describe('the window is bounded, with published caps', () => {
  it('refuses past the per-principal cap with a hint that names the number', () => {
    // Scar #3: an unbounded array became an OOM and a disk DoS.
    const { world, principals } = seatWorld(1);
    const principal = principals[0];
    if (principal === undefined) throw new Error('fixture seated nobody');
    const engine = new Engine({ world, seed: 'cap', verbs: probeVerbs() });
    for (let i = 0; i < MAX_QUEUED_PER_PRINCIPAL; i += 1) {
      expect(engine.submit(submission({ principal, verb: PROBE_VERB, clientSequence: i })).ok).toBe(true);
    }
    const over = engine.submit(
      submission({ principal, verb: PROBE_VERB, clientSequence: MAX_QUEUED_PER_PRINCIPAL }),
    );
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.invariant).toBe('INV-26');
      expect(over.hint).toContain(String(MAX_QUEUED_PER_PRINCIPAL));
    }
    expect(engine.queue.depth).toBe(MAX_QUEUED_PER_PRINCIPAL);
  });

  it('publishes both caps as constants an agent can be told', () => {
    // §15.2 requires the cap to be *published*: an undisclosed bound is
    // indistinguishable from losing the submission.
    expect(MAX_QUEUED_PER_PRINCIPAL).toBeGreaterThan(0);
    expect(MAX_QUEUED_ACTIONS).toBeGreaterThan(MAX_QUEUED_PER_PRINCIPAL);
  });

  it('the action log retains a bounded number of ticks', () => {
    const counter = countingVerb();
    const { world, principals } = seatWorld(1);
    const principal = principals[0];
    if (principal === undefined) throw new Error('fixture seated nobody');
    const engine = new Engine({ world, seed: 'log-bound', verbs: { [PROBE_VERB]: counter.verb } });
    for (let t = 0; t < engine.log.ticksRetained * 2; t += 1) {
      engine.submit(submission({ principal, verb: PROBE_VERB, clientSequence: 0 }));
      engine.runTick();
    }
    expect(counter.calls()).toBe(engine.log.ticksRetained * 2);
    expect(engine.log.ticks.length).toBeLessThanOrEqual(engine.log.ticksRetained + 1);
  });
});

describe('the wire contract', () => {
  it('refuses an action whose acted_on_state_version is not the window’s', () => {
    // PROP-W3: a mismatch returns a fresh preview and never guesses. Compared
    // against the version captured at FREEZE_QUEUE, so an agent that read the world
    // once and submitted four actions is not punished for the first one landing.
    const counter = countingVerb();
    const { world, principals } = seatWorld(1);
    const principal = principals[0];
    if (principal === undefined) throw new Error('fixture seated nobody');
    const engine = new Engine({ world, seed: 'version', verbs: { [PROBE_VERB]: counter.verb } });

    const version = engine.stateVersion;
    for (let i = 0; i < 3; i += 1) {
      expect(
        engine.submit({
          principal,
          verb: PROBE_VERB,
          params: {},
          clientSequence: i,
          arrivalMs: i,
          decisionSource: 'LIVE',
          actedOnStateVersion: version,
        }).ok,
      ).toBe(true);
    }
    // All three carried the same version and all three apply: the check is against
    // the frozen snapshot, not the running counter.
    const first = engine.runTick();
    expect(first.applied).toBe(3);
    expect(counter.calls()).toBe(3);

    // Now a stale version.
    const stale = engine.submit({
      principal,
      verb: PROBE_VERB,
      params: {},
      clientSequence: 0,
      arrivalMs: 0,
      decisionSource: 'LIVE',
      actedOnStateVersion: version,
    });
    expect(stale.ok).toBe(true);
    const second = engine.runTick();
    expect(second.refused).toBe(1);
    expect(engine.log.forTick(second.tick)[0]?.rejection?.invariant).toBe('PROP-W3');
  });

  it('an unknown verb is refused with a hint, never an error', () => {
    // §12.2: "Illegal actions never error." High Water pattern 4: an agent that
    // gets a 400 wastes its turn and often loops.
    const { world, principals } = seatWorld(1);
    const principal = principals[0];
    if (principal === undefined) throw new Error('fixture seated nobody');
    const engine = new Engine({ world, seed: 'unknown' });
    // `refine` is a real SPEC §12.2 verb with no handler in this build step.
    const refused = engine.submit(submission({ principal, verb: 'refine' }));
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.invariant).toBe('A2');
      expect(refused.hint).toMatch(/affordances/);
    }
  });

  it('a hostile act aimed at the Commons is invalid at submit, before anything is charged', () => {
    // A8: invalid, not punished. And it is refused *before* the budget is touched,
    // because "nothing about it may have happened".
    const { world, principals } = seatWorld(2);
    const attacker = principals[0];
    const target = principals[1];
    if (attacker === undefined || target === undefined) throw new Error('fixture seated nobody');
    const engine = new Engine({ world, seed: 'commons', verbs: { demand: () => ({ ok: true, value: null }) } });
    const refused = engine.submit(
      submission({ principal: attacker, verb: 'demand', params: { target_principal: target } }),
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.invariant).toBe('A8');
      expect(refused.hint).toMatch(/invalid rather than punished/);
    }
    const report = engine.runTick();
    expect(report.charged).toEqual([]);
    expect(engine.budget.materialTaken(attacker)).toBe(0);
  });
});
