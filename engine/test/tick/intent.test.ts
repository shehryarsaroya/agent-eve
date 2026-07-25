/**
 * A3 — "creating a durable intent costs an action; its routine ticks cost none.
 * Assert a standing intent runs N ticks for one action."
 *
 * `TESTING.md` §9 lists A3 as **executable**, and this is the executable form. The
 * property is what makes offline play viable at all (R19): an agent that goes dark
 * must keep acting through its standing intents without a budget it cannot see
 * draining underneath it.
 */

import { describe, it, expect } from 'vitest';
import { ACTIONS_PER_TICK } from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';
import {
  Engine,
  FREE_VERBS,
  INTENT_ORDER_STATEMENT,
  LIVE_ACTIONS_BEFORE_INTENTS,
  MAX_LIVE_INTENTS_PER_PRINCIPAL,
  costOf,
} from '../../src/tick/index.js';
import { PROBE_VERB, countingVerb, seatWorld, submission } from './harness.js';

const RUN_TICKS = 12;

function engineWithProbe(seed: string, principals = 2): {
  engine: Engine;
  principals: readonly PrincipalId[];
  counter: ReturnType<typeof countingVerb>;
} {
  const counter = countingVerb();
  const { world, principals: seated } = seatWorld(principals);
  const engine = new Engine({ world, seed, verbs: { [PROBE_VERB]: counter.verb } });
  return { engine, principals: seated, counter };
}

describe('A3 — one action buys a standing intent that runs for many ticks', () => {
  it('a standing intent runs N ticks for exactly one material action', () => {
    const { engine, principals, counter } = engineWithProbe('a3-run', 1);
    const principal = principals[0];
    if (principal === undefined) throw new Error('fixture seated nobody');

    // One action: create the intent.
    const accepted = engine.submit(
      submission({
        principal,
        verb: 'set_delivery_intent',
        params: { intent: { verb: PROBE_VERB, params: { what: 'deliver' } }, until_tick: 100 },
      }),
    );
    expect(accepted.ok).toBe(true);

    const creation = engine.runTick();
    expect(creation.halted).toBe(false);
    // Exactly one material action charged, in the tick that created it.
    expect(creation.charged).toEqual([[principal, 1]]);
    expect(engine.intents.liveCount()).toBe(1);
    // The intent does not run in its creation tick: it was created *during* the
    // tick, so running it too would be a within-tick action reacting to another.
    expect(creation.intentRuns).toBe(0);
    expect(counter.calls()).toBe(0);

    // Now N ticks with no submissions at all — the offline case.
    let charged = 0;
    for (let i = 0; i < RUN_TICKS; i += 1) {
      const report = engine.runTick();
      expect(report.halted).toBe(false);
      expect(report.intentRuns).toBe(1);
      charged += report.charged.reduce((sum, [, n]) => sum + n, 0);
    }

    // The whole claim, in three assertions.
    expect(counter.calls()).toBe(RUN_TICKS);
    expect(charged).toBe(0);
    expect(engine.budget.materialTaken(principal)).toBe(1);
  });

  it('an intent still runs while its principal never submits again, and stops on its own', () => {
    const { engine, principals, counter } = engineWithProbe('a3-stop', 1);
    const principal = principals[0];
    if (principal === undefined) throw new Error('fixture seated nobody');
    engine.submit(
      submission({
        principal,
        verb: 'set_delivery_intent',
        params: { intent: { verb: PROBE_VERB }, max_runs: 4 },
      }),
    );
    engine.runTick();

    for (let i = 0; i < 10; i += 1) engine.runTick();

    // `max_runs` is a stop condition and it holds: four runs, then SPENT.
    expect(counter.calls()).toBe(4);
    const intent = engine.intents.inOrder()[0];
    expect(intent?.state).toBe('SPENT');
    expect(intent?.runs).toBe(4);
    expect(engine.intents.liveCount()).toBe(0);
  });

  it('refuses an intent with no stop condition', () => {
    // An intent with no stop is an unbounded loop with an owner (scar #3), and its
    // principal would have no affordance that could ever show it again.
    const { engine, principals } = engineWithProbe('a3-nostop', 1);
    const principal = principals[0];
    if (principal === undefined) throw new Error('fixture seated nobody');
    engine.submit(
      submission({ principal, verb: 'set_delivery_intent', params: { intent: { verb: PROBE_VERB } } }),
    );
    const report = engine.runTick();
    expect(report.refused).toBe(1);
    expect(engine.intents.liveCount()).toBe(0);
    const logged = engine.log.forTick(report.tick)[0];
    expect(logged?.rejection?.invariant).toBe('A3');
    expect(logged?.rejection?.hint).toMatch(/stop condition/);
  });

  it('caps live intents per principal, with a published bound', () => {
    const { engine, principals } = engineWithProbe('a3-cap', 1);
    const principal = principals[0];
    if (principal === undefined) throw new Error('fixture seated nobody');
    // The action budget is 4 per tick, so the cap is reachable in one tick only if
    // the two numbers agree; assert the relationship rather than assuming it.
    expect(MAX_LIVE_INTENTS_PER_PRINCIPAL).toBeLessThanOrEqual(ACTIONS_PER_TICK);

    // Fill the cap in the first tick, which also consumes the whole action budget:
    // the two numbers are equal, so the overflow has to go in a second tick or the
    // budget would refuse it first and the cap would never be reached.
    for (let i = 0; i < MAX_LIVE_INTENTS_PER_PRINCIPAL; i += 1) {
      engine.submit(
        submission({
          principal,
          verb: 'set_delivery_intent',
          clientSequence: i,
          params: { intent: { verb: PROBE_VERB }, max_runs: 200 },
        }),
      );
    }
    const filled = engine.runTick();
    expect(filled.charged).toEqual([[principal, MAX_LIVE_INTENTS_PER_PRINCIPAL]]);
    expect(engine.intents.liveFor(principal).length).toBe(MAX_LIVE_INTENTS_PER_PRINCIPAL);

    engine.submit(
      submission({
        principal,
        verb: 'set_delivery_intent',
        clientSequence: 99,
        params: { intent: { verb: PROBE_VERB }, max_runs: 200 },
      }),
    );
    const report = engine.runTick();
    expect(engine.intents.liveFor(principal).length).toBe(MAX_LIVE_INTENTS_PER_PRINCIPAL);
    // The overflow was refused with a hint, never dropped silently.
    const refusals = engine.log
      .forTick(report.tick)
      .filter((a) => a.outcome === 'REFUSED')
      .map((a) => a.rejection?.invariant);
    expect(refusals).toContain('INV-26');
  });

  it('an intent tick that cannot act is a refusal, not a run — so a busy world cannot cancel it', () => {
    // Counting a refusal against `max_runs` would silently shorten an intent
    // whenever the world was busy, which an agent would read as the engine
    // cancelling its plans.
    const { world, principals } = seatWorld(1);
    const principal = principals[0];
    if (principal === undefined) throw new Error('fixture seated nobody');
    let allow = false;
    const engine = new Engine({
      world,
      seed: 'a3-refuse',
      verbs: {
        [PROBE_VERB]: () =>
          allow ? { ok: true, value: null } : { ok: false, invariant: 'INV-9', hint: 'busy' },
      },
    });
    engine.submit(
      submission({
        principal,
        verb: 'set_delivery_intent',
        params: { intent: { verb: PROBE_VERB }, max_runs: 2 },
      }),
    );
    engine.runTick();

    engine.runTick();
    engine.runTick();
    const intent = engine.intents.inOrder()[0];
    expect(intent?.runs).toBe(0);
    expect(intent?.refusals).toBe(2);
    expect(intent?.state).toBe('LIVE');

    allow = true;
    engine.runTick();
    engine.runTick();
    expect(engine.intents.inOrder()[0]?.runs).toBe(2);
  });

  it('live actions resolve before standing intents, and the sentence says so', () => {
    // The ordering decision is a rules surface (§15.2), so it is stated once, in
    // one place, in a sentence `agent.md` carries verbatim — the same pattern the
    // world module uses for the arrival decision (scar #1).
    expect(LIVE_ACTIONS_BEFORE_INTENTS).toBe(true);
    expect(INTENT_ORDER_STATEMENT).toContain('costs one material action');
    expect(INTENT_ORDER_STATEMENT).toContain('resolve before any of your standing intents');

    const order: string[] = [];
    const { world, principals } = seatWorld(1);
    const principal = principals[0];
    if (principal === undefined) throw new Error('fixture seated nobody');
    const engine = new Engine({
      world,
      seed: 'a3-order',
      verbs: {
        [PROBE_VERB]: (_ctx, request) => {
          order.push(request.intentId === null ? 'live' : 'intent');
          return { ok: true, value: null };
        },
      },
    });
    engine.submit(
      submission({
        principal,
        verb: 'set_delivery_intent',
        params: { intent: { verb: PROBE_VERB }, max_runs: 5 },
      }),
    );
    engine.runTick();
    order.length = 0;

    engine.submit(submission({ principal, verb: PROBE_VERB, clientSequence: 1 }));
    engine.runTick();
    expect(order).toEqual(['live', 'intent']);
  });

  it('an intent run is stamped INTENT in the action log and has no arrival at all', () => {
    // §15.1 is explicit that a durable pre-set decision is `INTENT`, never
    // `STANDING` — §3 gives that word to the public factual vectors. And a null
    // arrival is the clearest possible statement that arrival orders nothing.
    const { engine, principals } = engineWithProbe('a3-log', 1);
    const principal = principals[0];
    if (principal === undefined) throw new Error('fixture seated nobody');
    engine.submit(
      submission({
        principal,
        verb: 'set_delivery_intent',
        params: { intent: { verb: PROBE_VERB }, max_runs: 1 },
      }),
    );
    engine.runTick();
    const report = engine.runTick();
    const row = engine.log.forTick(report.tick).find((a) => a.decisionSource === 'INTENT');
    expect(row).toBeDefined();
    expect(row?.arrivalMs).toBeNull();
    expect(row?.arrivalOrdinal).toBeNull();
    expect(row?.outcome).toBe('APPLIED');
  });
});

describe('the action budget is engine-owned, and social verbs are free', () => {
  it('meters material actions at ACTIONS_PER_TICK and refuses the tail with a hint', () => {
    const { engine, principals, counter } = engineWithProbe('budget', 1);
    const principal = principals[0];
    if (principal === undefined) throw new Error('fixture seated nobody');
    for (let i = 0; i < ACTIONS_PER_TICK + 3; i += 1) {
      engine.submit(submission({ principal, verb: PROBE_VERB, clientSequence: i }));
    }
    const report = engine.runTick();
    expect(counter.calls()).toBe(ACTIONS_PER_TICK);
    expect(report.charged).toEqual([[principal, ACTIONS_PER_TICK]]);
    expect(report.refused).toBe(3);
    const refusal = engine.log.forTick(report.tick).find((a) => a.outcome === 'REFUSED');
    expect(refusal?.rejection?.invariant).toBe('A4');
    expect(refusal?.rejection?.hint).toMatch(/Acting faster buys nothing/);
  });

  it('leaves talk, claims and ballots free, and meters scan', () => {
    // High Water pattern 6: "bound material actions per agent per tick; leave talk,
    // deals and voting free." `scan` is information, and unmetered information is
    // throughput becoming power by another route (A4).
    expect([...FREE_VERBS].sort((a, b) => (a < b ? -1 : 1))).toEqual([
      'claim',
      'deny',
      'message',
      'vote',
    ]);
    expect(costOf('message')).toBe('FREE');
    expect(costOf('scan')).toBe('MATERIAL');
    expect(costOf('seal')).toBe('MATERIAL');
    expect(costOf('move')).toBe('MATERIAL');

    const talk = countingVerb();
    const { world, principals } = seatWorld(1);
    const principal = principals[0];
    if (principal === undefined) throw new Error('fixture seated nobody');
    const engine = new Engine({ world, seed: 'budget-free', verbs: { claim: talk.verb } });
    // Ten claims in one tick, which is more than twice the material budget.
    for (let i = 0; i < 10; i += 1) {
      const accepted = engine.submit(
        submission({ principal, verb: 'claim', clientSequence: i, params: { about: 'x' } }),
      );
      expect(accepted.ok).toBe(true);
    }
    const report = engine.runTick();
    expect(talk.calls()).toBe(10);
    expect(report.refused).toBe(0);
    // Not one material action charged, and the free counter saw all ten.
    expect(report.charged).toEqual([]);
    expect(engine.budget.freeTaken(principal)).toBe(10);
    expect(engine.budget.materialTaken(principal)).toBe(0);
  });
});
