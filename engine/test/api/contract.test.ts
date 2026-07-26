/**
 * PROP-O7, PROP-W2, PROP-W3, SCAR-10, and the ten observation keys.
 *
 * These four sit in one file because they are one property seen from four sides:
 * **the boundary tells the agent the truth about what happened, and tells nobody
 * else.** An illegal action returns a correction rather than an error; a replayed
 * key returns the original outcome rather than a second one; a stale state version
 * returns a fresh preview rather than a guess; and none of it ever reaches the feed.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ACTIONS_PER_TICK, WAKES_PER_RECKONING } from '../../src/core/time.js';
import { FREE_SERVICES, OBSERVE_KEYS, buildObservation, scrub } from '../../src/api/index.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { PATHS, agent, enrol, harness, signed, tick, type Harness } from './harness.js';

let h: Harness;

beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.close();
});

/** Read the observation out of any 2xx body. */
function obs(body: Record<string, unknown>): Record<string, unknown> {
  const o = body['observation'];
  expect(typeof o).toBe('object');
  return o as Record<string, unknown>;
}

describe('§12.1 — the observation is exactly ten keys, in agent.md order', () => {
  it('serves ten keys and no more', async () => {
    const a = agent('vale');
    const res = await enrol(h, a);
    expect(res.status).toBe(201);
    // PROP-O3: the budget is enforced by arithmetic, not intentions.
    expect(Object.keys(obs(res.json))).toEqual([...OBSERVE_KEYS]);
    expect(Object.keys(obs(res.json))).toHaveLength(10);
  });

  it('every affordance carries all six honesty fields (PROP-O4)', async () => {
    const a = agent('halcyon');
    const res = await enrol(h, a);
    const affordances = obs(res.json)['affordances'] as Record<string, unknown>[];
    expect(affordances.length).toBeGreaterThan(0);
    for (const affordance of affordances) {
      // Missing any one of these is not a smaller payload; it is the core loop's
      // honesty guarantee gone.
      expect(typeof affordance['verb']).toBe('string');
      expect(typeof affordance['cost']).toBe('number');
      expect(Number.isSafeInteger(affordance['max_direct_loss'])).toBe(true);
      expect(Number.isSafeInteger(affordance['max_contingent_liability'])).toBe(true);
      expect(typeof affordance['what_it_forecloses']).toBe('string');
      expect(Number.isSafeInteger(affordance['expires_tick'])).toBe(true);
      expect(typeof affordance['quote_id']).toBe('string');
      // A2: known arithmetic is exact. A float in a loss figure would mean the
      // number an agent is shown and the number the ledger moves differ.
      expect(Number.isInteger(affordance['max_direct_loss'])).toBe(true);
    }
  });

  it('never offers an affordance for a verb the engine will refuse (AGT-S2)', async () => {
    // ── The regression for a real defect the blind-play probe found ──────────
    //
    // `seal` was offered as an affordance while the runtime had deliberately
    // unregistered it. The probe did exactly what agent.md tells it to — copy an
    // affordance verbatim — and got a PHASE-0 correction for its trouble, on every
    // wake, for two hundred ticks, burning a real action each time.
    //
    // An affordance the engine will refuse is worse than a missing one: it is the
    // server telling an agent to do something and then declining.
    const a = agent('auditor');
    const res = await enrol(h, a);
    const observation = obs(res.json);
    const affordances = observation['affordances'] as Record<string, unknown>[];
    const live = new Set((observation['header'] as Record<string, unknown>)['live_verbs'] as string[]);
    expect(affordances.length).toBeGreaterThan(0);
    for (const affordance of affordances) {
      expect(live.has(String(affordance['verb'])), `offered '${String(affordance['verb'])}' which is not live`).toBe(true);
    }
    // And the header publishes the live list, so an agent never has to discover it by
    // spending actions on refusals.
    expect(live.size).toBeGreaterThan(3);
    // `seal` and `elect` are both live now, so what this asserts about them is the thing
    // that matters: they are in the published list, which is what makes offering them
    // legal under the check above.
    expect(live.has('seal')).toBe(true);
    expect(live.has('elect')).toBe(true);
  });

  it('counts a withheld act whose verb is not live yet, rather than dropping it silently', () => {
    // PROP-O1 is about omissions being countable. "The mechanic has not landed" is an
    // omission the agent is entitled to know about, and a silent filter would be
    // indistinguishable, from where it sits, from having become ineligible.
    //
    // ── WHY THIS SHADOWS `liveVerbs` INSTEAD OF USING A REAL GAP ─────────────
    //
    // It used to use `seal`, which was the one verb the generator produced and the
    // runtime refused. Both `seal` and `elect` are live now, so **every** verb the
    // generator can produce is live and there is no naturally-occurring instance left —
    // which would make this guard pass vacuously forever, and a guard that cannot fire
    // reads exactly like a clean bill of health.
    //
    // The mechanism is what has to stay covered, because the next unbuilt verb the
    // generator learns to offer will need it. So the live set is narrowed for one call.
    // Verified by mutation: deleting the `notLive` branch in `affordancesFor` fails this.
    const cast = new HeuristicCast(h.runtime, { size: 8 });
    cast.seat('withheld');
    for (let n = 0; n < 40; n += 1) {
      for (const action of cast.decide(h.runtime.engine.tick + 1, 'withheld')) {
        h.runtime.engine.submit(action);
      }
      h.runtime.runTick();
    }
    const holder = cast.roster.find(
      (m) => h.runtime.ventures.forPrincipal(m.principal).some(
        (v) => v.roles.some((r) => r.filledByPrincipal === m.principal),
      ),
    );
    expect(holder, 'the cast filled no roles, so this test would prove nothing').toBeDefined();
    if (holder === undefined) return;

    // The affordance the narrowing will withhold has to exist first, or the assertions
    // below would hold for the wrong reason.
    const before = buildObservation({
      runtime: h.runtime,
      principal: holder.principal,
      serverNowMs: h.clock.nowMs(),
      fresh: true,
      wakesRemaining: 16,
      stale: false,
      corrections: [],
      actionsRemaining: 4,
    });
    const target = before.affordances[0]?.verb;
    expect(target, 'no affordance to withhold, so this test would prove nothing').toBeDefined();
    if (target === undefined) return;

    const real = h.runtime.liveVerbs;
    const narrowed = new Set([...real].filter((v) => v !== target));
    Object.defineProperty(h.runtime, 'liveVerbs', { get: () => narrowed, configurable: true });
    try {
      const observation = buildObservation({
        runtime: h.runtime,
        principal: holder.principal,
        serverNowMs: h.clock.nowMs(),
        fresh: true,
        wakesRemaining: 16,
        stale: false,
        corrections: [],
        actionsRemaining: 4,
      });
      const withheld = observation.header['withheld'] as Record<string, unknown>;
      expect(Number(withheld['count'])).toBeGreaterThan(0);
      expect(String(withheld['reason'])).toContain('has not landed yet');
      expect(String(withheld['reason'])).toContain('Nothing you were eligible for has been dropped');
      // And the unlive verb was the thing withheld: it is not in the list.
      expect(observation.affordances.some((x) => x.verb === target)).toBe(false);
    } finally {
      Object.defineProperty(h.runtime, 'liveVerbs', { get: () => real, configurable: true });
    }
  });

  it('always reports withheld, including when nothing was withheld (PROP-O1)', async () => {
    const a = agent('vex');
    const res = await enrol(h, a);
    const header = obs(res.json)['header'] as Record<string, unknown>;
    const withheld = header['withheld'] as Record<string, unknown>;
    // An absent field and a field reading zero are the same thing to a reader that
    // has never seen one, so "nothing was withheld" has to be sayable.
    expect(typeof withheld['count']).toBe('number');
    expect(String(withheld['reason']).length).toBeGreaterThan(10);
  });

  it('a repeat fetch inside one tick is byte-identical and costs no wake (PROP-O6, A4)', async () => {
    const a = agent('brannock');
    await enrol(h, a);
    const first = await signed(h, a, 'GET', PATHS.observe);
    const spentAfterFirst = h.context.wakesSpent(a.principalId as never);
    const second = await signed(h, a, 'GET', PATHS.observe);
    const third = await signed(h, a, 'GET', PATHS.observe);
    expect(first.status).toBe(200);
    // Byte-identical, not merely equivalent: this is what makes "sending requests
    // faster does not help you" a fact about the bytes rather than a claim.
    expect(second.text).toBe(first.text);
    expect(third.text).toBe(first.text);
    expect(h.context.wakesSpent(a.principalId as never)).toBe(spentAfterFirst);
    expect(h.context.cacheHits()).toBeGreaterThanOrEqual(2);
  });

  it('spending the wake budget yields a legal, free and useless snapshot (§12.4)', async () => {
    const a = agent('sable');
    await enrol(h, a);
    // One fresh observation per tick, until the Reckoning's wakes are gone.
    for (let i = 0; i < WAKES_PER_RECKONING + 4; i += 1) {
      await signed(h, a, 'GET', PATHS.observe);
      tick(h, 1);
    }
    const spent = await signed(h, a, 'GET', PATHS.observe);
    expect(spent.status).toBe(200);
    const observation = obs(spent.json);
    const header = observation['header'] as Record<string, unknown>;
    expect(header['wakes_remaining']).toBe(0);
    // No fresh affordances and no new quote_id. Legal, free, and useless.
    expect(observation['affordances']).toEqual([]);
    const withheld = header['withheld'] as Record<string, unknown>;
    expect(String(withheld['reason'])).toContain('wakes');
  });

  it('countdowns never run backwards across two fetches (PROP-O8)', async () => {
    const a = agent('orrin');
    await enrol(h, a);
    let previous = Number.MAX_SAFE_INTEGER;
    let previousDecision = -1;
    for (let i = 0; i < 8; i += 1) {
      const res = await signed(h, a, 'GET', PATHS.observe);
      const header = obs(res.json)['header'] as Record<string, unknown>;
      const next = (header['next_reckoning'] as Record<string, unknown>)['ticks'] as number;
      expect(next).toBeLessThanOrEqual(previous);
      previous = next;
      // `next_decision_at` is a tick, not a countdown, so it may only move forward.
      const at = header['next_decision_at'] as number;
      expect(at).toBeGreaterThanOrEqual(previousDecision);
      previousDecision = at;
      tick(h, 1);
    }
  });

  it('never claims a Levy assessment of zero when the Levy does not exist yet', async () => {
    // `null` reads as "not assessed"; `0` reads as "assessed at nothing". The second
    // is a claim about a mechanic that has not run, and `if_you_do_nothing` is tested
    // against reality (PROP-O5) — so a fabricated zero would make the briefing lie.
    const a = agent('thessaly');
    const res = await enrol(h, a);
    const obligations = obs(res.json)['obligations'] as Record<string, unknown>;
    expect(obligations['levy']).toBeNull();
  });

  it('if_you_do_nothing is accurate for a newcomer, and reality agrees (PROP-O5)', async () => {
    const a = agent('kestrel');
    const res = await enrol(h, a);
    const briefing = obs(res.json)['briefing'] as Record<string, unknown>;
    const statement = String(briefing['if_you_do_nothing']);
    // The newcomer case: nothing resolves, and absence costs opportunity only.
    expect(statement).toContain('Nothing resolves for you');
    expect(statement).toMatch(/identity, your holding and your standing are unchanged/);

    const principal = a.principalId as never;
    const holdingBefore = h.runtime.world.holdingByPrincipal.get(principal);
    const handsBefore = h.runtime.world.handsByPrincipal.get(principal)?.length;
    // Take no action and advance to the stated tick. The claim has to hold.
    tick(h, 60);
    expect(h.runtime.world.holdingByPrincipal.get(principal)).toBe(holdingBefore);
    expect(h.runtime.world.handsByPrincipal.get(principal)?.length).toBe(handsBefore);
    expect(h.runtime.engine.status).toBe('RUNNING');
  });

  it('names the LEVY when one is owed — it cannot say absence is free while a shortfall accrues', async () => {
    // A live playtest caught this saying "absence costs opportunity and nothing else" in
    // the same payload that carried levy.shortfall_if_unpaid: 500, twice, across two
    // Reckonings. The Levy is the one obligation doing nothing cannot avoid (§5.2: the
    // total is fixed by rule), so omitting it inverted the only field PROP-O5 promises is
    // tested against reality — and told a principal it was safe while a public shortfall
    // was accruing against it.
    const a = agent('tolvane');
    await enrol(h, a);
    const principal = a.principalId as never;

    // Run far enough for an assessment to exist for this principal.
    tick(h, 40);
    const levy = h.runtime.levyBlockFor(principal);
    const short = levy === null ? 0 : (levy.shortfall_if_unpaid ?? 0);
    if (short <= 0) return; // no assessment in this window; the shape test below still holds

    const fresh = await signed(h, a, 'GET', PATHS.observe);
    const statement = String(
      (obs(fresh.json)['briefing'] as Record<string, unknown>)['if_you_do_nothing'],
    );
    expect(statement, 'a Levy is owed, so this cannot claim absence is free').not.toMatch(
      /absence costs opportunity and nothing else/,
    );
    expect(statement).toMatch(/Levy/);
    expect(statement).toContain(String(short));
  });
});

describe('PROP-O7 — an illegal action is a correction, not an error', () => {
  it('answers a submit-time refusal with the invariant, the changed fields, the nearest legal act, and a fresh observation', async () => {
    const a = agent('dunmore');
    await enrol(h, a);
    // A hostile act aimed at nothing: refused by the Commons floor at submit, which is
    // one of the refusals that IS knowable before the tick runs.
    const res = await signed(h, a, 'POST', PATHS.act, {
      actions: [{ verb: 'create', params: { kind: 'RAID' }, clientSequence: 1 }],
    });
    // 200. A 400 wastes the agent's turn and it loops.
    expect(res.status).toBe(200);
    const outcome = res.json['outcome'] as Record<string, unknown>;
    const corrections = outcome['corrections'] as Record<string, unknown>[];
    expect(corrections).toHaveLength(1);
    const correction = corrections[0];
    expect(correction).toBeDefined();
    if (correction === undefined) return;
    expect(correction['invariant']).toBe('A8');
    expect(String(correction['hint']).length).toBeGreaterThan(10);
    expect(Array.isArray(correction['changed'])).toBe(true);
    // The nearest legal thing, so the agent can act rather than guess.
    expect(correction['nearest_legal']).not.toBeNull();
    expect(Object.keys(correction['observation'] as Record<string, unknown>)).toEqual([...OBSERVE_KEYS]);
  });

  it('delivers a resolution-time refusal on the next read, and never drops it', async () => {
    // ── The half of PROP-O7 that the architecture forces ────────────────────
    //
    // `Engine.submit` does not run the verb handler, and it must not: the handler
    // mutates, and running it at submit would be an action reacting to a within-tick
    // decision (§15.2). So `move` with a hand that does not exist is ACCEPTED at
    // submit and REFUSED at VALIDATE+LOCK, one tick later — there is nothing to hand
    // back when the `act` response is written.
    //
    // Dropping it is the failure that matters: an agent whose action silently
    // evaporated cannot tell that from the world changing underneath it. So it is
    // held and delivered on the next read, once.
    const a = agent('ferren');
    await enrol(h, a);
    const submitted = await signed(h, a, 'POST', PATHS.act, {
      actions: [{ verb: 'move', params: { hand: 'no-such-hand', to: 'nowhere' }, clientSequence: 7 }],
    });
    expect(submitted.status).toBe(200);
    const accepted = (submitted.json['outcome'] as Record<string, unknown>)['accepted'] as unknown[];
    expect(accepted).toHaveLength(1);

    tick(h, 1);

    const read = await signed(h, a, 'GET', PATHS.observe);
    const briefing = obs(read.json)['briefing'] as Record<string, unknown>;
    const corrections = briefing['corrections'] as Record<string, unknown>[];
    expect(corrections).toHaveLength(1);
    expect(corrections[0]?.['verb']).toBe('move');
    expect(corrections[0]?.['clientSequence']).toBe(7);
    expect(String(corrections[0]?.['hint'])).toContain('no hand no-such-hand');
    // The nearest legal thing is a legal `move`, so the fix is one field away.
    const nearest = corrections[0]?.['nearest_legal'] as Record<string, unknown> | null;
    expect(nearest?.['verb']).toBe('move');

    // Delivered exactly once: draining on read is what keeps the buffer bounded.
    tick(h, 1);
    const again = await signed(h, a, 'GET', PATHS.observe);
    expect((obs(again.json)['briefing'] as Record<string, unknown>)['corrections']).toEqual([]);
  });

  it('holds at most a bounded number of undelivered corrections', async () => {
    // An agent that never reads must not be able to grow the process.
    const a = agent('bram');
    await enrol(h, a);
    for (let i = 0; i < 60; i += 1) {
      await signed(h, a, 'POST', PATHS.act, {
        actions: [{ verb: 'move', params: { hand: 'ghost', to: 'nowhere' }, clientSequence: i }],
      });
      tick(h, 1);
    }
    expect(h.runtime.bufferSizes()['pendingCorrections']).toBeLessThanOrEqual(16);
  });

  it('a canon verb whose mechanic has not landed says so, and costs nothing', async () => {
    // The alternative is the tick loop's `unknownVerb` — "there is no such verb" —
    // which contradicts agent.md §7, the document the agent learned the game from.
    //
    // The verb was `trade` until the market landed and made it live. `haul` replaces it
    // because the mechanism — a canon-but-unbuilt verb refused at the HTTP boundary,
    // charging nothing — needs a verb that is genuinely still unbuilt to exercise it,
    // and `haul` names the same build step so the assertion below is unchanged.
    const a = agent('ashlin');
    await enrol(h, a);
    const before = h.runtime.engine.budget.remaining(a.principalId as never);
    const res = await signed(h, a, 'POST', PATHS.act, {
      actions: [{ verb: 'haul', params: {}, clientSequence: 1 }],
    });
    expect(res.status).toBe(200);
    const outcome = res.json['outcome'] as Record<string, unknown>;
    const corrections = outcome['corrections'] as Record<string, unknown>[];
    expect(corrections[0]?.['invariant']).toBe('PHASE-0');
    expect(String(corrections[0]?.['hint'])).toContain('step 11');
    expect(String(corrections[0]?.['hint'])).toContain('Nothing was charged');
    expect(h.runtime.engine.budget.remaining(a.principalId as never)).toBe(before);
  });

  it('a verb that is not in the canon at all is a different sentence', async () => {
    const a = agent('corvid');
    await enrol(h, a);
    const res = await signed(h, a, 'POST', PATHS.act, {
      actions: [{ verb: 'betray', params: {}, clientSequence: 1 }],
    });
    const outcome = res.json['outcome'] as Record<string, unknown>;
    const corrections = outcome['corrections'] as Record<string, unknown>[];
    expect(String(corrections[0]?.['hint'])).toContain('not a verb in this game');
    // There is no `betray` verb, and the design says so out loud (A6).
    expect(String(corrections[0]?.['hint'])).toContain('agent.md');
  });

  it('accepts a legal action and reports the tick it will resolve in', async () => {
    const a = agent('marrow');
    const enrolled = await enrol(h, a);
    const affordances = obs(enrolled.json)['affordances'] as Record<string, unknown>[];
    const move = affordances.find((x) => x['verb'] === 'move');
    expect(move).toBeDefined();
    const res = await signed(h, a, 'POST', PATHS.act, {
      actions: [{ verb: 'move', params: move?.['params'], clientSequence: 1 }],
    });
    const outcome = res.json['outcome'] as Record<string, unknown>;
    expect(outcome['corrections']).toEqual([]);
    const accepted = outcome['accepted'] as Record<string, unknown>[];
    expect(accepted).toHaveLength(1);
    // §15.2: an agent acts from snapshot T and its action lands in T+1.
    expect(accepted[0]?.['resolvesInTick']).toBe(h.runtime.engine.tick + 1);
  });

  it('a hostile act aimed into the Commons is refused as invalid, not merely priced (A8)', async () => {
    const a = agent('quill');
    await enrol(h, a);
    const seat = h.runtime.world.hands.get(`${a.principalId}:h1` as never)?.location;
    const res = await signed(h, a, 'POST', PATHS.act, {
      actions: [{ verb: 'create', params: { kind: 'RAID', stage: seat, target_system: seat }, clientSequence: 1 }],
    });
    const outcome = res.json['outcome'] as Record<string, unknown>;
    const corrections = outcome['corrections'] as Record<string, unknown>[];
    expect(corrections).toHaveLength(1);
    expect(corrections[0]?.['invariant']).toBe('A8');
    // And nothing was created: invalid, not punished afterwards.
    expect(h.runtime.ventures.size).toBe(0);
  });
});

describe('SCAR-10 — a hint never reaches the public feed', () => {
  it('a rejected action writes no event at all', async () => {
    // High Water wrote illegal-move rejections as public ledger receipts and the
    // watcher UI filled with noise until the real story was unreadable.
    const a = agent('severin');
    await enrol(h, a);
    const eventsBefore = h.runtime.events.eventCount;
    for (let i = 0; i < 10; i += 1) {
      await signed(h, a, 'POST', PATHS.act, {
        actions: [{ verb: 'move', params: { hand: 'nope', to: 'nowhere' }, clientSequence: i }],
      });
    }
    tick(h, 2);
    // Some events may exist from the tick itself; none may mention a hint.
    const feed = h.runtime.events
      .spectatorFeed({ atTick: h.runtime.engine.tick, after: null, limit: 200 })
      .views.map((v) => JSON.stringify(v))
      .join('\n');
    expect(feed).not.toMatch(/hint/i);
    expect(feed).not.toMatch(/nearest_legal/);
    expect(feed).not.toMatch(/correction/i);
    expect(feed).not.toContain('no-such-hand');
    expect(feed).not.toContain('nope');
    // Ten refusals added no rows of their own.
    expect(h.runtime.events.eventCount).toBeGreaterThanOrEqual(eventsBefore);
  });

  it('a discrepancy report is a correction channel, never an event', async () => {
    const a = agent('tolen');
    await enrol(h, a);
    const before = h.runtime.events.eventCount;
    const res = await signed(h, a, 'POST', PATHS.discrepancy, {
      expected: 'my elective part was paid',
      observed: 'a default was recorded against me',
    });
    expect(res.status).toBe(202);
    expect(h.context.discrepancies).toHaveLength(1);
    expect(h.context.discrepancies[0]?.principal).toBe(a.principalId);
    // It is the most serious report in the game and it is still not a public event.
    expect(h.runtime.events.eventCount).toBe(before);
    const feed = h.runtime.events
      .spectatorFeed({ atTick: h.runtime.engine.tick, after: null, limit: 200 })
      .views.map((v) => JSON.stringify(v))
      .join('\n');
    expect(feed).not.toContain('a default was recorded against me');
  });

  it('an unsigned discrepancy is still accepted, because the reporter may not be able to sign', async () => {
    const res = await signed(h, agent('unenrolled'), 'POST', PATHS.discrepancy, {
      expected: 'x',
      observed: 'y',
    });
    expect(res.status).toBe(202);
    expect(res.json['attributed_to']).toBeNull();
  });

  it('the discrepancy buffer is bounded', async () => {
    for (let i = 0; i < 700; i += 1) {
      await signed(h, agent('flood'), 'POST', PATHS.discrepancy, {
        expected: `e${String(i)}`,
        observed: `o${String(i)}`,
      });
    }
    expect(h.context.discrepancies.length).toBeLessThanOrEqual(512);
  });
});

describe('PROP-W2 — idempotency is a no-op returning the original outcome', () => {
  it('replays the outcome and queues nothing the second time', async () => {
    const a = agent('wren');
    const enrolled = await enrol(h, a);
    const affordances = obs(enrolled.json)['affordances'] as Record<string, unknown>[];
    const move = affordances.find((x) => x['verb'] === 'move');

    const first = await signed(h, a, 'POST', PATHS.act, {
      actions: [{ verb: 'move', params: move?.['params'], clientSequence: 1 }],
      idempotencyKey: 'k-1',
    });
    const depthAfterFirst = h.runtime.engine.queue.depth;

    const second = await signed(h, a, 'POST', PATHS.act, {
      actions: [{ verb: 'move', params: move?.['params'], clientSequence: 1 }],
      idempotencyKey: 'k-1',
    });
    expect(second.status).toBe(200);
    expect(second.json['replayed']).toBe(true);
    // The outcome is byte-identical; the observation is deliberately rebuilt, because
    // a stale one would send the agent to act against a world we have moved past.
    expect(JSON.stringify(second.json['outcome'])).toBe(JSON.stringify(first.json['outcome']));
    expect(h.runtime.engine.queue.depth).toBe(depthAfterFirst);
  });

  it('one principal cannot read another principal\'s outcome through a shared key', async () => {
    // A global key space would make an idempotency key a read of somebody else's
    // private result through the one field nobody thinks of as a read.
    const a = agent('ysolde');
    const b = agent('bram');
    await enrol(h, a);
    await enrol(h, b);
    await signed(h, a, 'POST', PATHS.act, {
      actions: [{ verb: 'claim', params: { text: 'mine' }, clientSequence: 1 }],
      idempotencyKey: 'shared',
    });
    const asB = await signed(h, b, 'POST', PATHS.act, {
      actions: [{ verb: 'claim', params: { text: 'theirs' }, clientSequence: 1 }],
      idempotencyKey: 'shared',
    });
    expect(asB.json['replayed']).toBe(false);
  });

  it('refuses a key it could not safely use as a map key', async () => {
    const a = agent('cassian');
    await enrol(h, a);
    const res = await signed(h, a, 'POST', PATHS.act, {
      actions: [{ verb: 'claim', params: { text: 'x' }, clientSequence: 1 }],
      idempotencyKey: 'a'.repeat(400),
    });
    expect(res.status).toBe(400);
    expect(res.json['reason']).toBe('FIELD_MALFORMED');
  });
});

describe('PROP-W3 — a state-version mismatch returns a fresh preview, never a guess', () => {
  it('refuses with the version it actually holds and hands back a fresh observation', async () => {
    const a = agent('vale');
    await enrol(h, a);
    // Move the world on, so the version the agent quotes is genuinely stale.
    tick(h, 1);
    const res = await signed(h, a, 'POST', PATHS.act, {
      actions: [{ verb: 'claim', params: { text: 'hello' }, clientSequence: 1 }],
      expectedStateVersion: 999_999,
    });
    expect(res.status).toBe(200);
    const outcome = res.json['outcome'] as Record<string, unknown>;
    const corrections = outcome['corrections'] as Record<string, unknown>[];
    expect(corrections).toHaveLength(1);
    expect(corrections[0]?.['invariant']).toBe('PROP-W3');
    expect(String(corrections[0]?.['hint'])).toContain('will not guess');
    // The changed field names both numbers, so the agent can see exactly what moved.
    const changed = corrections[0]?.['changed'] as Record<string, unknown>[];
    const version = changed.find((c) => c['field'] === 'header.state_version');
    expect(version?.['you_acted_on']).toBe(999_999);
    expect(version?.['now']).toBe(h.runtime.engine.stateVersion);
    // And a fresh preview, which is what "never guesses" means in practice.
    expect(Object.keys(corrections[0]?.['observation'] as Record<string, unknown>)).toEqual([
      ...OBSERVE_KEYS,
    ]);
  });

  it('accepts the version the observation just published', async () => {
    const a = agent('halcyon');
    const enrolled = await enrol(h, a);
    const header = obs(enrolled.json)['header'] as Record<string, unknown>;
    const res = await signed(h, a, 'POST', PATHS.act, {
      actions: [{ verb: 'claim', params: { text: 'on time' }, clientSequence: 1 }],
      expectedStateVersion: header['state_version'],
    });
    const outcome = res.json['outcome'] as Record<string, unknown>;
    expect(outcome['corrections']).toEqual([]);
  });
});

describe('the budget is the engine\'s, not the transport\'s', () => {
  it('a fifth material action in one tick is refused by the engine (A4, scar #2)', async () => {
    const a = agent('vex');
    await enrol(h, a);
    // One batch, five material actions. The transport does not meter; the tick does.
    const actions = Array.from({ length: ACTIONS_PER_TICK + 1 }, (_, i) => ({
      verb: 'publish_offer',
      params: { text: `offer ${String(i)}` },
      clientSequence: i,
    }));
    await signed(h, a, 'POST', PATHS.act, { actions });
    tick(h, 1);
    const log = h.runtime.engine.log.forTick(h.runtime.engine.tick);
    const refused = log.filter((entry) => entry.outcome === 'REFUSED');
    expect(refused.length).toBeGreaterThanOrEqual(1);
    expect(refused.some((entry) => entry.rejection?.invariant === 'A4')).toBe(true);
  });

  it('actions_remaining answers for the window being submitted into, not the one that closed', async () => {
    // ── The regression for a measured defect ────────────────────────────────
    //
    // `ActionBudget.remaining()` is charged at resolution and cleared at the top of
    // each tick, so during the submission window it answers for the tick that just
    // *closed*. Measured directly: a principal that spends all four actions in tick T
    // reads 0 while submitting into T+1, where it actually has four.
    //
    // Nothing fails when that number is wrong. The agent simply under-acts forever,
    // believing it is out of budget — and agent.md §7 is what told it to believe the
    // field. A rules-surface number that is quietly wrong is scar #1's shape without
    // the drama.
    const a = agent('budgeter');
    const enrolled = await enrol(h, a);
    const header0 = obs(enrolled.json)['header'] as Record<string, unknown>;
    expect(header0['actions_remaining']).toBe(ACTIONS_PER_TICK);

    // Spend the whole budget in one window.
    const actions = Array.from({ length: ACTIONS_PER_TICK }, (_, i) => ({
      verb: 'publish_offer',
      params: { text: `offer ${String(i)}` },
      clientSequence: i,
    }));
    const acted = await signed(h, a, 'POST', PATHS.act, { actions });
    const spentHeader = (acted.json['observation'] as Record<string, unknown>)['header'] as Record<string, unknown>;
    // Zero left in THIS window, which is true and useful.
    expect(spentHeader['actions_remaining']).toBe(0);

    // The window closes and a new one opens. Four again — this is the assertion that
    // fails if the field ever goes back to reading the engine's post-resolution count.
    tick(h, 1);
    const next = await signed(h, a, 'GET', PATHS.observe);
    const nextHeader = obs(next.json)['header'] as Record<string, unknown>;
    expect(h.runtime.engine.budget.remaining(a.principalId as never)).toBe(0);
    expect(nextHeader['actions_remaining']).toBe(ACTIONS_PER_TICK);
  });

  it('social verbs stay free', async () => {
    const a = agent('sable');
    await enrol(h, a);
    const actions = Array.from({ length: 8 }, (_, i) => ({
      verb: 'claim',
      params: { text: `word ${String(i)}` },
      clientSequence: i,
    }));
    await signed(h, a, 'POST', PATHS.act, { actions });
    tick(h, 1);
    const log = h.runtime.engine.log.forTick(h.runtime.engine.tick);
    expect(log.filter((e) => e.outcome === 'REFUSED')).toHaveLength(0);
  });
});

describe('scrub — the outbound scrubber must not eat the message', () => {
  it('keeps prose that merely contains the word "at"', () => {
    // The mutation that caught this: a greedy stack-frame pattern deleted everything
    // from " at " onward, so the seat-full hint lost the half that said what would
    // change. The refusal still parsed. Nothing failed. That is the worst shape.
    const hint = 'the next seat becomes recyclable at tick 1152. Enrolment is free and stays free.';
    expect(scrub(hint)).toBe(hint);
  });

  it('still removes a real stack frame', () => {
    const leak = 'boom\n    at handler (/Users/someone/app/src/api/server.ts:12:9)';
    const cleaned = scrub(leak);
    expect(cleaned).not.toContain('/Users');
    expect(cleaned).not.toContain('server.ts');
    expect(cleaned).toContain('boom');
  });

  it('redacts anything shaped like a credential before anything else', () => {
    const leak = 'failed with token=abcdefgh12345678 while reading /opt/compact/.env';
    const cleaned = scrub(leak);
    expect(cleaned).not.toContain('abcdefgh12345678');
    expect(cleaned).not.toContain('/opt/compact');
  });
});

/**
 * A4 and §12.4 — the correction channel is not a way to buy information.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE DEFECT THIS PINS.** `nearest_legal` was solved fresh on every correction,
 * unconditionally: the observation attached to a correction is always built with
 * `fresh: false`, so its affordance list is always empty and the re-solve branch always
 * fired. Combine that with a canon-but-unbuilt verb — refused at the boundary, so it
 * costs **no action and no wake** — and an agent with 0 of 16 wakes left could POST
 * `trade`, read a fully priced affordance out of `nearest_legal` (exact
 * `max_direct_loss`, exact `max_contingent_liability`, live `quote_id`), and repeat
 * forever. Measured: five distinct `quote_id`s with the wake budget at zero and the
 * action budget untouched.
 *
 * `agent.md` §7 states the opposite in as many words: outside a wake there are "no fresh
 * affordances and no new `quote_id` … a bigger inference budget cannot buy you a bigger
 * information set." A refusal channel that sells either makes that sentence false —
 * A4 and a broken promise in one line.
 * ══════════════════════════════════════════════════════════════════════════
 */
describe('§12.4 — a spent wake budget cannot be topped up through a correction', () => {
  it('sells no fresh affordance and no quote_id once the wakes are gone', async () => {
    const a = agent('leech');
    await enrol(h, a);
    for (let i = 0; i < WAKES_PER_RECKONING + 4; i += 1) {
      await signed(h, a, 'GET', PATHS.observe);
      tick(h, 1);
    }
    const read = await signed(h, a, 'GET', PATHS.observe);
    const header = obs(read.json)['header'] as Record<string, unknown>;
    expect(header['wakes_remaining'], 'the budget must actually be spent or this proves nothing').toBe(0);
    expect(obs(read.json)['affordances']).toEqual([]);

    const budgetBefore = h.runtime.engine.budget.remaining(a.principalId as never);
    for (let n = 0; n < 5; n += 1) {
      const res = await signed(h, a, 'POST', PATHS.act, {
        actions: [{ verb: 'haul', params: {}, clientSequence: n }],
      });
      const corrections = (res.json['outcome'] as Record<string, unknown>)['corrections'] as Record<
        string,
        unknown
      >[];
      // The hint is still there — the agent is not left guessing, it is just not sold a
      // pinned quote it did not pay a wake for.
      expect(String(corrections[0]?.['hint']).length).toBeGreaterThan(20);
      expect(corrections[0]?.['nearest_legal'], 'a fresh affordance was sold outside a wake').toBeNull();
      const nested = corrections[0]?.['observation'] as Record<string, unknown>;
      expect(nested['affordances']).toEqual([]);
      tick(h, 1);
    }
    // And the free verb really was free, so the leak was not paid for in actions either.
    expect(h.runtime.engine.budget.remaining(a.principalId as never)).toBe(budgetBefore);
  });

  it('a fresh nearest_legal costs a wake, so it cannot be harvested for free', async () => {
    // The leak the verifier actually described, which the 0-wake test above does NOT
    // catch: an agent HOLDING wakes could POST junk repeatedly and pull a fresh priced
    // affordance set — live quote_ids — each time, unmetered, because solveHintSet
    // gated on having a wake but never spent one. A fresh set is fresh information and
    // must cost a wake exactly like an observe. This asserts the budget draws down.
    const a = agent('harvester');
    await enrol(h, a);
    // Read the spend directly from the context, not the header — unambiguous, and no
    // GET observe in the middle to confuse the accounting.
    const before = h.context.wakesSpent(a.principalId as never);

    // Three junk actions in a row, each of which would have harvested a free fresh set
    // under the bug (nearest_legal solved fresh, gated on having a wake, never spending).
    let served = 0;
    for (let n = 0; n < 3; n += 1) {
      const res = await signed(h, a, 'POST', PATHS.act, {
        actions: [{ verb: 'haul', params: {}, clientSequence: n }],
      });
      const c = ((res.json['outcome'] as Record<string, unknown>)['corrections'] as Record<string, unknown>[])[0];
      if (c?.['nearest_legal'] !== null && c?.['nearest_legal'] !== undefined) served += 1;
    }
    const after = h.context.wakesSpent(a.principalId as never);
    // Every fresh set served cost a wake. Under the bug, `served` sets came back while
    // `wakesSpent` never moved — free information through the correction channel.
    expect(after - before).toBe(served);
    expect(served).toBeGreaterThan(0);
  });

  it('still hands back the nearest legal act while the agent holds a wake (PROP-O7)', async () => {
    // The gate must not eat the guarantee it is protecting: inside a wake, a refusal
    // still comes with something to try instead.
    const a = agent('awake');
    await enrol(h, a);
    const res = await signed(h, a, 'POST', PATHS.act, {
      actions: [{ verb: 'haul', params: {}, clientSequence: 1 }],
    });
    const corrections = (res.json['outcome'] as Record<string, unknown>)['corrections'] as Record<
      string,
      unknown
    >[];
    const nearest = corrections[0]?.['nearest_legal'] as Record<string, unknown> | null;
    expect(nearest).not.toBeNull();
    expect(typeof nearest?.['quote_id']).toBe('string');
  });
});

/**
 * agent.md §6's free services are named as what they are, never denied.
 *
 * They have no endpoint in this build, which is a reported gap. What is not acceptable
 * is the sentence they used to get: since they are not in `CANON_VERBS`, `classifyVerb`
 * answered *"'plan_hands' is not a verb in this game. The full list is in agent.md §7"* —
 * the server denying the existence of the thing §6 lists and §12's first piece of advice
 * tells the agent to call before every allocation decision, while citing that same
 * document as its authority. Scar #1's exact shape.
 */
describe('agent.md §6 — the free services are never denied out of existence', () => {
  it('names them as services rather than as typos, and charges nothing', async () => {
    const a = agent('planner');
    await enrol(h, a);
    const before = h.runtime.engine.budget.remaining(a.principalId as never);
    for (const service of FREE_SERVICES) {
      const res = await signed(h, a, 'POST', PATHS.act, {
        actions: [{ verb: service, params: {}, clientSequence: 1 }],
      });
      const corrections = (res.json['outcome'] as Record<string, unknown>)['corrections'] as Record<
        string,
        unknown
      >[];
      const hint = String(corrections[0]?.['hint']);
      expect(hint, `${service} was denied out of existence`).not.toContain('not a verb in this game');
      expect(hint).toContain('agent.md §6');
      // And it points at what the agent can use instead, today.
      expect(hint).toContain('max_direct_loss');
      expect(hint).toContain('if_you_do_nothing');
    }
    expect(h.runtime.engine.budget.remaining(a.principalId as never)).toBe(before);
  });

  it('a genuine typo is still a typo, so the two are distinguishable', async () => {
    const a = agent('typist');
    await enrol(h, a);
    const res = await signed(h, a, 'POST', PATHS.act, {
      actions: [{ verb: 'plan_hand', params: {}, clientSequence: 1 }],
    });
    const corrections = (res.json['outcome'] as Record<string, unknown>)['corrections'] as Record<
      string,
      unknown
    >[];
    expect(String(corrections[0]?.['hint'])).toContain('not a verb in this game');
  });
});
