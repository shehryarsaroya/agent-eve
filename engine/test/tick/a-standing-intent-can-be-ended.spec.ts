/**
 * ★ **A STANDING INTENT CAN BE ENDED, AND ONE WITH NOTHING TO DO SAYS SO** (`RULES_VERSION` 41).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * Two defects from playing the live world, one mechanism each:
 *
 *   - **No door out.** `IntentBook.stop` existed with no caller, so an intent ended only at its own
 *     `until_tick` or `max_runs`, and the cap's refusal said in words that no verb withdraws one. The
 *     door is a parameter of the verb that makes intents — `set_delivery_intent {"stop": id}` — so no
 *     verb is spent (40 of 40).
 *   - **A satisfied order read as stuck.** Before running a due intent the engine now asks the owning
 *     module whether it has anything to do (`Runtime.intentSatisfaction`); "the bill is paid", "the
 *     ballot already says this", "no whole batch of ore yet" answer no, and the tick records
 *     `satisfied` instead of a run or a refusal — no correction, no action-log row, no `max_runs` spent.
 *
 * Every claim below is preceded by the non-vacuity check it rests on, and every act an agent would
 * send is copied from its own affordance rather than composed here.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';
import { buildObservation } from '../../src/api/index.js';
import { LEVY_BALLOT, PUBLISHED_DEFAULT_RULE } from '../../src/levy/index.js';
import type { Runtime } from '../../src/sim/runtime.js';
import { act, levyWorld, submit, tick, walkToPlace } from '../levy/fixture.js';

type Row = Record<string, unknown>;

function observe(runtime: Runtime, principal: PrincipalId): ReturnType<typeof buildObservation> {
  return buildObservation({
    runtime,
    principal,
    serverNowMs: 0,
    fresh: true,
    wakesRemaining: 16,
    stale: false,
    corrections: [],
    correctionsDropped: 0,
    actionsRemaining: 4,
  });
}

function intentRows(runtime: Runtime, principal: PrincipalId): Row[] {
  return (observe(runtime, principal).obligations as Row)['intents'] as Row[];
}

function eventsOf(runtime: Runtime, kind: string, actor: PrincipalId): readonly Row[] {
  return runtime.events
    .ticks()
    .flatMap((t) => runtime.events.eventsAtTick(t))
    .map((r) => r.event as unknown as Row)
    .filter((e) => e['kind'] === kind && e['actorPrincipalId'] === actor);
}

/** A Levy order, set the way the menu offers it, by a principal whose hand stands at the place. */
function levyOrder(seed: string, extra: Readonly<Record<string, unknown>> = {}): {
  readonly runtime: Runtime;
  readonly payer: PrincipalId;
  readonly other: PrincipalId;
  readonly id: string;
} {
  const world = levyWorld(seed, 2, 1);
  const runtime = world.runtime;
  const payer = world.principals[0];
  const other = world.principals[1];
  if (payer === undefined || other === undefined) throw new Error('fixture');
  tick(runtime);
  walkToPlace(runtime, payer);
  tick(runtime);
  const offer = observe(runtime, payer).affordances.find(
    (a) => a.verb === 'set_delivery_intent' && (a.params as Row)['obligation'] === 'LEVY',
  );
  expect(offer, 'non-vacuity: the Levy standing order must be offered').toBeDefined();
  submit(runtime, payer, 'set_delivery_intent', { ...(offer?.params as Row), ...extra });
  tick(runtime);
  const intent = runtime.engine.intents.liveFor(payer)[0];
  expect(intent, 'non-vacuity: the order must exist').toBeDefined();
  return { runtime, payer, other, id: intent?.id ?? '' };
}

describe('ending a standing intent — set_delivery_intent {"stop": id}', () => {
  it('★ is offered for every live intent, and the offer copied verbatim ends it before it runs again', () => {
    const { runtime, payer, id } = levyOrder('intent-stop');
    // Listed, with the id an agent needs.
    const before = intentRows(runtime, payer).find((r) => r['id'] === id);
    expect(before?.['state']).toBe('LIVE');

    const stop = observe(runtime, payer).affordances.find(
      (a) => a.verb === 'set_delivery_intent' && (a.params as Row)['stop'] === id,
    );
    expect(stop, 'REGRESSION: a live intent with no stop on the menu is an intent with no door').toBeDefined();
    if (stop === undefined) return;
    expect(stop.what_it_forecloses).toContain('final');

    const runsBefore = runtime.engine.intents.get(id)?.runs ?? 0;
    expect(act(runtime, payer, 'set_delivery_intent', stop.params as Row), 'the stop must be accepted').toBeNull();
    const ended = runtime.engine.intents.get(id);
    expect(ended?.state).toBe('STOPPED');
    expect(ended?.endedAtTick).toBe(runtime.engine.tick);
    // It does not run on the tick it was stopped, or ever again.
    for (let n = 0; n < 5; n += 1) tick(runtime);
    expect(runtime.engine.intents.get(id)?.runs).toBe(runsBefore);
    expect(runtime.engine.intents.liveFor(payer)).toHaveLength(0);
    // And the menu stops offering a door to a room that is gone; the row says how it ended.
    expect(
      observe(runtime, payer).affordances.some((a) => (a.params as Row)['stop'] === id),
      'an ended intent must not be offered a stop',
    ).toBe(false);
    expect(intentRows(runtime, payer).find((r) => r['id'] === id)?.['status']).toBe('STOPPED');
  }, 120_000);

  it('refuses, by name, a stop it cannot honour — and stops nothing', () => {
    const { runtime, payer, other, id } = levyOrder('intent-stop-refusals');
    const unknown = act(runtime, payer, 'set_delivery_intent', { stop: 'p:lp01:i9999:9' });
    expect(unknown?.invariant).toBe('A3');
    expect(unknown?.hint).toContain(id);

    // Somebody else's order is not yours to end.
    const foreign = act(runtime, other, 'set_delivery_intent', { stop: id });
    expect(foreign?.invariant).toBe('A3');
    expect(runtime.engine.intents.get(id)?.state).toBe('LIVE');

    // A stop that also tries to create is ambiguous, so it does neither.
    const mixed = act(runtime, payer, 'set_delivery_intent', { stop: id, intent_verb: 'deliver', until_tick: 9_000 });
    expect(mixed?.invariant).toBe('A3');
    expect(runtime.engine.intents.get(id)?.state).toBe('LIVE');
    expect(runtime.engine.intents.liveFor(payer)).toHaveLength(1);

    // Once ended, a second stop says so rather than pretending.
    expect(act(runtime, payer, 'set_delivery_intent', { stop: id })).toBeNull();
    const again = act(runtime, payer, 'set_delivery_intent', { stop: id });
    expect(again?.invariant).toBe('A3');
    expect(again?.hint).toContain('already ended');
  }, 120_000);
});

describe('a satisfied run is not a run', () => {
  it('★ uses none of max_runs, so a two-run Levy order pays two Reckonings, not one', () => {
    const { runtime, payer, id } = levyOrder('intent-max-runs', { max_runs: 2, until_tick: TICKS_PER_RECKONING * 3 });
    for (let n = 0; n < 30; n += 1) tick(runtime);
    const mid = runtime.engine.intents.get(id);
    expect(mid?.runs, 'non-vacuity: it paid tonight').toBe(1);
    expect(mid?.satisfied, 'and was satisfied after').toBeGreaterThan(20);
    expect(mid?.state, 'REGRESSION: satisfied ticks were spent against max_runs').toBe('LIVE');
    while (runtime.engine.tick < TICKS_PER_RECKONING + 20) tick(runtime);
    const done = runtime.engine.intents.get(id);
    expect(done?.runs, 'it paid tomorrow too').toBe(2);
    expect(done?.state).toBe('SPENT');
    expect(eventsOf(runtime, 'levy.delivered', payer).filter((e) => e['decisionSource'] === 'INTENT')).toHaveLength(2);
  }, 180_000);
});

describe('the other chores an intent can carry', () => {
  it('★ a standing Levy ballot is cast once per cycle, not re-cast every tick into the public record', () => {
    const world = levyWorld('intent-vote', 2, 0);
    const runtime = world.runtime;
    const voter = world.principals[0];
    if (voter === undefined) throw new Error('fixture');
    tick(runtime);
    submit(runtime, voter, 'set_delivery_intent', {
      intent_verb: 'vote',
      ballot: LEVY_BALLOT,
      rule: PUBLISHED_DEFAULT_RULE,
      until_tick: TICKS_PER_RECKONING * 2,
    });
    for (let n = 0; n < 60; n += 1) tick(runtime);
    const intent = runtime.engine.intents.liveFor(voter).find((i) => i.verb === 'vote');
    expect(intent, 'non-vacuity: the order must exist').toBeDefined();
    const voted = eventsOf(runtime, 'levy.voted', voter);
    expect(voted.length, 'non-vacuity: it voted').toBeGreaterThan(0);
    // ★ Without the satisfied check every due tick re-cast the same ballot and posted a PUBLIC row.
    expect(voted, 'REGRESSION: an identical ballot was re-cast every tick').toHaveLength(1);
    expect(intent?.runs).toBe(1);
    expect(intent?.satisfied).toBeGreaterThan(50);
    expect(intentRows(runtime, voter).find((r) => r['id'] === intent?.id)?.['status']).toBe('SATISFIED');
  }, 120_000);

  it('★ a standing refine order is offered beside a WORKS, waits SATISFIED for ore, and refines it', () => {
    const world = levyWorld('intent-refine', 1, 0);
    const runtime = world.runtime;
    const owner = world.principals[0];
    if (owner === undefined) throw new Error('fixture');
    tick(runtime);
    const build = observe(runtime, owner).affordances.find(
      (a) => a.verb === 'build' && (a.params as Row)['kind'] === 'WORKS',
    );
    expect(build, 'non-vacuity: a WORKS must be offered').toBeDefined();
    expect(act(runtime, owner, 'build', build?.params as Row)).toBeNull();

    const order = observe(runtime, owner).affordances.find(
      (a) => a.verb === 'set_delivery_intent' && (a.params as Row)['intent_verb'] === 'refine',
    );
    expect(order, 'REGRESSION: a WORKS stands and no standing refine order is offered beside it').toBeDefined();
    if (order === undefined) return;
    expect(order.what_it_forecloses, 'the choice it carries is stated').toContain('ALL the');
    expect(act(runtime, owner, 'set_delivery_intent', order.params as Row)).toBeNull();
    // The menu does not offer a second identical order beside a live one.
    expect(
      observe(runtime, owner).affordances.some(
        (a) => a.verb === 'set_delivery_intent' && (a.params as Row)['intent_verb'] === 'refine',
      ),
    ).toBe(false);

    const id = runtime.engine.intents.liveFor(owner).find((i) => i.verb === 'refine')?.id ?? '';
    // Spinning up: no ore, so nothing to do — and that is not a refusal.
    for (let n = 0; n < 10; n += 1) tick(runtime);
    const waiting = runtime.engine.intents.get(id);
    expect(waiting?.runs).toBe(0);
    expect(waiting?.satisfied).toBeGreaterThan(0);
    expect(waiting?.refusals, 'REGRESSION: a refine order waiting for ore was refused every tick').toBe(0);
    expect(String(intentRows(runtime, owner).find((r) => r['id'] === id)?.['now'])).toContain('waiting for');

    // Online: it refines what is extracted, every tick, for free.
    for (let n = 0; n < 40; n += 1) tick(runtime);
    const working = runtime.engine.intents.get(id);
    expect(working?.runs, 'it must refine once the WORKS extracts').toBeGreaterThan(0);
    expect(working?.refusals).toBe(0);
    expect(runtime.peekCorrections(owner).filter((c) => c.verb === 'refine')).toHaveLength(0);
  }, 180_000);
});
