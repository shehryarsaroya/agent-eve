/**
 * **PROP-LV5 · R19 · E2E-5 — the Levy is payable while offline.**
 *
 * > *"R19 is preserved by construction: the Levy is payable by a standing intent, and its
 * > worst case is goods plus one public receipt."* — §5.2
 *
 * > `PROP-LV5` The Levy is payable by a standing intent, so it is satisfiable while
 * > offline (feeds `E2E-4`). · `E2E-5` Assessed while offline; paid by standing intent;
 * > tribute line goes dashed → solid → resolves.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHAT "OFFLINE" HAS TO MEAN FOR THIS TO BE A REAL TEST.
 *
 * Not "the agent took fewer actions". **No live action at all** between setting the intent
 * and the tribute being discharged: the principal submits `move` and
 * `set_delivery_intent`, then goes completely silent, and the payment lands anyway with
 * `decision_source: INTENT`. If the test acted again at the delivering tick, it would be
 * proving that a live delivery works — which is a different property, already covered in
 * `coase.test.ts`.
 *
 * The other half of R19 is A3's cost rule: **creating the intent costs one action, and
 * every tick it runs after that costs none.** Asserted here from the budget's own counter,
 * because a routine tick that was charged would make going offline strictly worse than
 * staying awake and R19 would be a dead letter.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { ACTIONS_PER_TICK } from '../../src/core/time.js';
import { act, levyWorld, runTo, submit, tick, walkToPlace } from './fixture.js';

describe('PROP-LV5 / R19 — paid by a standing intent, with nobody awake', () => {
  it('discharges the whole assessment from an intent, and the payment says INTENT', () => {
    const world = levyWorld('offline', 2);
    const payer = world.principals[0];
    if (payer === undefined) throw new Error('fixture');
    const runtime = world.runtime;
    tick(runtime);

    const owed = runtime.levyBlockFor(payer, runtime.engine.tick)?.my_assessment ?? 0;
    expect(owed).toBeGreaterThan(0);

    // The hand walks to the named place — one action, and the last one this principal will
    // take. Everything after this happens while it is dark.
    const place = walkToPlace(runtime, payer);

    const beforeIntent = runtime.engine.tick;
    act(runtime, payer, 'set_delivery_intent', {
      intent: { verb: 'deliver', params: { to: place } },
      until_tick: beforeIntent + 20,
      max_runs: 1,
    });
    expect(runtime.engine.intents.liveFor(payer)).toHaveLength(1);

    const routineBefore = runtime.engine.budget.routineChargesTaken;
    const materialBefore = runtime.engine.budget.materialTaken(payer);

    // ── SILENCE. Not one submission from here on. ──────────────────────────
    for (let n = 0; n < 5; n += 1) tick(runtime);

    const after = runtime.levyBlockFor(payer, runtime.engine.tick);
    expect(after?.paid).toBe(owed);
    expect(after?.shortfall_if_unpaid).toBe(0);

    // The delivery is in the record, attributed to the intent rather than to a live wake.
    const delivered = runtime.events
      .ticks()
      .flatMap((t) => runtime.events.eventsAtTick(t))
      .map((r) => r.event)
      .filter((e) => e.kind === 'levy.delivered' && e.actorPrincipalId === payer);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.decisionSource).toBe('INTENT');
    // A3: creating the intent cost one action; its routine ticks cost none. Both halves are
    // asserted, because either alone would pass while the rule was broken — the routine
    // counter proves the intent actually ran through the free path, and the material
    // counter proves that path never reached the charged branch. An intent that quietly
    // spent a material action would drain a budget an offline agent cannot see, and going
    // offline would stop being opportunity-only.
    expect(runtime.engine.budget.routineChargesTaken).toBeGreaterThan(routineBefore);
    expect(runtime.engine.budget.materialTaken(payer)).toBe(materialBefore);

    // The intent spent itself on the tick it could actually pay and retired.
    expect(runtime.engine.intents.liveFor(payer)).toHaveLength(0);
  });

  it('survives the whole journey: an intent set before departure fires on arrival', () => {
    // The genuine offline story, and the one the cast cannot use (see the note in
    // `cast/heuristic.ts:levyMove`): the intent is due every tick of the journey and
    // refused on each of them, then pays the moment the hand is present.
    // Seated deliberately AWAY from the delivery place, which is the constellation's
    // lowest-id Commons system: the journey clause is untestable from a seat already on it.
    const world = levyWorld('offline-journey', 2, 1);
    const payer = world.principals[0];
    if (payer === undefined) throw new Error('fixture');
    const runtime = world.runtime;
    tick(runtime);
    const place = runtime.levyBlockFor(payer, runtime.engine.tick)?.deliverable_to;
    if (place === undefined) throw new Error('no delivery place');
    const owed = runtime.levyBlockFor(payer, runtime.engine.tick)?.my_assessment ?? 0;

    const hand = [...runtime.world.hands.values()].find((h) => h.principal === payer);
    if (hand === undefined) throw new Error('no hand');
    // If the hand is already standing on the place, the journey clause is untestable —
    // fail loudly rather than pass vacuously.
    expect(hand.location).not.toBe(place);

    submit(runtime, payer, 'set_delivery_intent', {
      intent: { verb: 'deliver', params: { to: place } },
      until_tick: runtime.engine.tick + 40,
      max_runs: 1,
    });
    submit(runtime, payer, 'move', { hand: hand.id, to: place }, 1);
    tick(runtime);

    // ── SILENCE for the whole transit and beyond. ─────────────────────────
    for (let n = 0; n < 30; n += 1) tick(runtime);

    const after = runtime.levyBlockFor(payer, runtime.engine.tick);
    expect(after?.paid).toBe(owed);
    expect(after?.shortfall_if_unpaid).toBe(0);
    // Refusals during transit are normal and are NOT runs: an intent whose hand is still
    // moving must not spend itself (`IntentBook.ran`).
    const intent = runtime.engine.intents
      .inOrder()
      .find((i) => i.principal === payer && i.verb === 'deliver');
    expect(intent?.refusals).toBeGreaterThan(0);
    expect(intent?.runs).toBe(1);
    expect(intent?.state).toBe('SPENT');
  });

  it('is not short at settlement, and not in the sweep queue, having paid while dark', () => {
    const world = levyWorld('offline-settle', 2);
    const payer = world.principals[0];
    const other = world.principals[1];
    if (payer === undefined || other === undefined) throw new Error('fixture');
    const runtime = world.runtime;
    tick(runtime);
    const place = walkToPlace(runtime, payer);
    act(runtime, payer, 'set_delivery_intent', {
      intent: { verb: 'deliver', params: { to: place } },
      until_tick: 285,
      max_runs: 1,
    });

    // A whole Reckoning of silence from the payer, all the way through the freeze and the
    // settlement. Absence must cost opportunity, never the record.
    runTo(runtime, 287);

    const rows = runtime.levySettlement?.shortfalls ?? [];
    const mine = rows.find((r) => r.principal === payer);
    expect(mine?.owed).toBe(0);
    expect(mine?.inSweepQueue).toBe(false);
    expect(runtime.levySettlement?.sweepQueue).not.toContain(payer);
    // Identity, holding and standing all intact — and the neighbour who did nothing at all
    // is short, which is the comparison that makes the guarantee mean something.
    expect(runtime.world.holdingByPrincipal.get(payer)).toBeDefined();
    expect(runtime.standing.rows().find((s) => s.principal === payer)?.defaults ?? 0).toBe(0);
    expect(rows.find((r) => r.principal === other)?.owed ?? 0).toBeGreaterThan(0);
  });

  it('refuses a delivery inside the freeze, and says why in a sentence', () => {
    // §5.1's hard freeze read literally: the Reckoning batch compares the payer's balances
    // between the freeze and the settlement and halts on any difference in either
    // direction, so a delivery accepted inside the freeze would pause a healthy world on
    // the one tick that has an audience (A14).
    const world = levyWorld('offline-freeze', 2);
    const payer = world.principals[0];
    if (payer === undefined) throw new Error('fixture');
    const runtime = world.runtime;
    tick(runtime);
    walkToPlace(runtime, payer);
    runTo(runtime, 285);
    const refusal = act(runtime, payer, 'deliver', {});
    expect(refusal?.hint).toContain('freeze');
    expect(refusal?.hint).toContain('deliver before the freeze');
    // Which costs an agent nothing: the assessment is open from the first tick of its
    // Reckoning, and the refusal says so.
    expect(runtime.engine.status).toBe('RUNNING');
  });

  it('the action budget is what it always was — the Levy buys no extra actions', () => {
    // A mechanic that quietly raised the per-tick budget would be A4 violated through the
    // Levy's back door. `ACTIONS_PER_TICK` is the §17 figure and this asserts it is still it.
    expect(ACTIONS_PER_TICK).toBe(4);
  });
});
