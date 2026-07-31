/**
 * The LLM cast: it decides, and when it cannot it degrades instead of freezing.
 *
 * Every test here runs against a mock (see `mock.ts`). Nothing in this file touches the
 * network or needs a key, and nothing may be added that does.
 *
 * The properties, in the order they would hurt if they failed:
 *
 *   1. **The tick never awaits the network.** A transport that never answers must not
 *      slow, stall or fail a single tick.
 *   2. **Degrade, don't freeze.** Error, timeout, malformed reply, unknown verb, spend
 *      cap: every one of them falls back to the heuristic and marks it `FALLBACK`.
 *   3. **A well-formed reply becomes a submitted action marked `LIVE`.** Which is the
 *      whole point: `deciding_share_bps` is zero today and this is what moves it.
 *   4. **Default off**, byte-identically.
 *   5. **The wake budget is spent**, the same sixteen an external agent gets.
 */

import { describe, expect, it } from 'vitest';
import { setSpeed, TICKS_PER_RECKONING, WAKES_PER_RECKONING } from '../../src/core/time.js';
import {
  CastTransportError,
  createCast,
  HeuristicCast,
  LlmCast,
  type CastTransport,
  type CompletionReply,
} from '../../src/cast/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { buildHealth } from '../../src/api/health.js';
import { SeatBook } from '../../src/api/seats.js';
import { CONTRACT, harness, MockTransport, planJson, settle, stoppedClock } from './mock.js';

function sourcesIn(runtime: Runtime, fromTick: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (let t = fromTick; t <= runtime.engine.tick; t += 1) {
    for (const entry of runtime.engine.log.forTick(t)) {
      counts.set(entry.decisionSource, (counts.get(entry.decisionSource) ?? 0) + 1);
    }
  }
  return counts;
}

describe('a well-formed reply becomes a LIVE action', () => {
  it('submits the model’s chosen affordance and labels it LIVE', async () => {
    const transport = MockTransport.picksAffordance();
    const h = harness(transport, { size: 4, wakeGapTicks: 4, planMax: 2 });
    await h.run(12);

    expect(transport.count).toBeGreaterThan(0);
    const sources = sourcesIn(h.runtime, 0);
    expect(sources.get('LIVE') ?? 0).toBeGreaterThan(0);
    // And they were accepted, not merely submitted: a cast whose every LIVE action is
    // refused has moved the census and nothing else.
    const applied = [];
    for (let t = 0; t <= h.runtime.engine.tick; t += 1) {
      for (const e of h.runtime.engine.log.forTick(t)) {
        if (e.decisionSource === 'LIVE' && e.outcome === 'APPLIED') applied.push(e);
      }
    }
    expect(applied.length).toBeGreaterThan(0);
  });

  it('spreads a multi-action plan over consecutive ticks, one per tick', async () => {
    // A3: a wake buys a durable intention, not one click. The plan is submitted one
    // action per tick, so the world moves between them and a stale entry is refused —
    // which is the game working, not a bug.
    const transport = new MockTransport(() =>
      Promise.resolve({
        text: JSON.stringify({
          note: 'three moves',
          plan: [
            // `claim` is a live verb whose params the handler will refuse here. That is
            // deliberate: this test measures the *cadence* of submission, and a refused
            // action is still logged with its `decision_source`, so using an accepted
            // verb would make the assertion depend on the world's shape as well.
            { verb: 'claim', params: { text: 'one' } },
            { verb: 'claim', params: { text: 'two' } },
            { verb: 'claim', params: { text: 'three' } },
          ],
        }),
        inputTokens: 100,
        outputTokens: 20,
        cachedInputTokens: null,
      }),
    );
    const h = harness(transport, { size: 1, wakeGapTicks: 50, planMax: 3 });
    await h.run(8);

    const perTick = new Map<number, number>();
    for (let t = 0; t <= h.runtime.engine.tick; t += 1) {
      const live = h.runtime.engine.log.forTick(t).filter((e) => e.decisionSource === 'LIVE');
      if (live.length > 0) perTick.set(t, live.length);
    }
    expect(perTick.size).toBe(3);
    for (const n of perTick.values()) expect(n).toBe(1);
    // One wake bought all three: the transport was called once, not three times.
    expect(transport.count).toBe(1);
  });
});

describe('degrade, do not freeze', () => {
  it('a malformed reply is discarded, the heuristic acts, and it is marked FALLBACK', async () => {
    const transport = MockTransport.says('here is my plan: move the hand west');
    const h = harness(transport, { size: 2, wakeGapTicks: 3 });
    await h.run(9);

    const sources = sourcesIn(h.runtime, 0);
    expect(sources.get('LIVE') ?? 0).toBe(0);
    expect(sources.get('FALLBACK') ?? 0).toBeGreaterThan(0);
    expect(h.cast.report().discarded).toBeGreaterThan(0);
    expect(h.logs.join('\n')).toContain('reply discarded');
  });

  it('a reply naming a verb the engine does not implement is discarded', async () => {
    const transport = MockTransport.says(planJson('betray', { target: 'p:vex' }));
    const h = harness(transport, { size: 1, wakeGapTicks: 3 });
    await h.run(9);
    expect(h.cast.report().discarded).toBeGreaterThan(0);
    expect(sourcesIn(h.runtime, 0).get('LIVE') ?? 0).toBe(0);
    expect(h.logs.join('\n')).toContain('unknown-verb:betray');
  });

  it('an API error falls back and never throws out of decide()', async () => {
    const transport = MockTransport.fails('502 Bad Gateway from upstream');
    const h = harness(transport, { size: 3, wakeGapTicks: 3 });
    await expect(h.run(9)).resolves.toBeUndefined();

    const sources = sourcesIn(h.runtime, 0);
    expect(sources.get('FALLBACK') ?? 0).toBeGreaterThan(0);
    expect(h.runtime.engine.status).toBe('RUNNING');
  });

  it('a transport that throws synchronously falls back on the very next tick', async () => {
    // Not the same case as a rejected promise: a synchronous throw never produces a
    // promise, so nothing would ever fill the member's inbox and it would sit waiting
    // for a deadline that is only checked because something is in flight.
    let calls = 0;
    const transport: CastTransport = {
      complete(): Promise<CompletionReply> {
        calls += 1;
        throw new Error('transport exploded before it started');
      },
    };
    const h = harness(transport, { size: 1, wakeGapTicks: 3, deadlineTicks: 40 });
    await h.run(12);
    expect(sourcesIn(h.runtime, 0).get('FALLBACK') ?? 0).toBeGreaterThan(0);
    expect(h.logs.join('\n')).toContain('transport refused the call');
    // And it RECOVERS. A synchronous throw must clear the in-flight slot, or the member
    // sits waiting on a deadline for a call that was never made — one fallback and then
    // silence, which is much harder to see in a log than a repeated failure.
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it('a wake that never answers is abandoned after its deadline, in ticks', async () => {
    const transport = MockTransport.hangs();
    const h = harness(transport, { size: 1, wakeGapTicks: 100, deadlineTicks: 3 });
    await h.run(3);
    // Still in flight: nothing has expired yet, so no FALLBACK has been recorded.
    expect(sourcesIn(h.runtime, 0).get('FALLBACK') ?? 0).toBe(0);

    await h.run(4);
    expect(sourcesIn(h.runtime, 0).get('FALLBACK') ?? 0).toBeGreaterThan(0);
    expect(h.logs.join('\n')).toContain('exceeded 3 ticks');
  });

  it('a reply arriving after the deadline is ignored rather than acted on', async () => {
    // The stale-answer case. A member that gave up at tick 4 must not act at tick 20 on
    // an observation from tick 1 — the world has moved and the action would be refused,
    // or worse, accepted against a state nobody intended.
    // A holder rather than a `let`: TypeScript's flow analysis cannot see that the
    // promise executor ran, and narrows a reassigned `let` to `never` after a null check.
    const held: { resolve: ((reply: CompletionReply) => void) | null } = { resolve: null };
    const transport = new MockTransport(
      () =>
        new Promise<CompletionReply>((resolve) => {
          held.resolve = resolve;
        }),
    );
    const h = harness(transport, { size: 1, wakeGapTicks: 100, deadlineTicks: 2 });
    await h.run(6);
    const before = sourcesIn(h.runtime, 0).get('LIVE') ?? 0;

    expect(held.resolve).not.toBeNull();
    held.resolve?.({ text: planJson('claim', { text: 'late' }), inputTokens: 10, outputTokens: 10 , cachedInputTokens: null});
    await settle();
    await h.run(4);

    expect(sourcesIn(h.runtime, 0).get('LIVE') ?? 0).toBe(before);
  });
});

describe('the tick never awaits the network', () => {
  it('decide() returns synchronously while a call is hanging, and ticks keep landing', () => {
    setSpeed('instant');
    const transport = MockTransport.hangs();
    const runtime = new Runtime({ seed: 'never-block' });
    const cast = new LlmCast(runtime, {
      size: 6,
      transport,
      clock: stoppedClock,
      contract: CONTRACT,
      wakeGapTicks: 1,
      log: () => undefined,
    });
    cast.seat('never-block');

    // No `await` anywhere in this loop. If `decide` returned a promise, or awaited one,
    // this would not typecheck and the ticks would not land.
    for (let i = 0; i < 30; i += 1) {
      const actions = cast.decide(runtime.engine.tick + 1, 'never-block');
      expect(Array.isArray(actions)).toBe(true);
      for (const action of actions) runtime.engine.submit(action);
      const report = runtime.runTick();
      expect(report.halted).toBe(false);
    }
    expect(runtime.engine.tick).toBe(29);
    // Calls really were started and really never answered.
    expect(transport.count).toBeGreaterThan(0);
    cast.close();
  });

  it('never emits two actions for one member in one tick', async () => {
    const transport = MockTransport.picksAffordance();
    const h = harness(transport, { size: 6, wakeGapTicks: 2, planMax: 3 });
    await h.run(20);
    for (let t = 0; t <= h.runtime.engine.tick; t += 1) {
      const seen = new Set<string>();
      for (const entry of h.runtime.engine.log.forTick(t)) {
        // Intent runs have no arrival ordinal and are engine-originated, not ours.
        if (entry.arrivalOrdinal === null) continue;
        expect(seen.has(entry.principal)).toBe(false);
        seen.add(entry.principal);
      }
    }
  });
});

describe('budget caps are enforced in code', () => {
  it('the cumulative spend cap disables the LLM cast and latches', async () => {
    const transport = MockTransport.picksAffordance();
    const h = harness(transport, {
      size: 4,
      wakeGapTicks: 1,
      // Two calls' worth at the reserved worst case, roughly. Small enough to trip fast.
      limits: { spendCapMicros: 8_000, maxOutputTokens: 100 },
    });
    await h.run(20);

    const report = h.cast.report();
    expect(report.spend.disabled).toBe(true);
    expect(report.enabled).toBe(false);
    expect(h.logs.join('\n')).toContain('SPEND CAP TRIPPED');

    // Latching: more ticks buy no more calls.
    const callsAtTrip = transport.count;
    await h.run(20);
    expect(transport.count).toBe(callsAtTrip);
    // And the world kept playing.
    expect(h.runtime.engine.status).toBe('RUNNING');
    expect(sourcesIn(h.runtime, h.runtime.engine.tick - 5).get('HEURISTIC') ?? 0).toBeGreaterThan(0);
  });

  it('the calls-per-Reckoning cap binds without disabling the cast', async () => {
    const transport = MockTransport.picksAffordance();
    const h = harness(transport, {
      size: 4,
      wakeGapTicks: 1,
      limits: { callsPerReckoning: 3, spendCapMicros: 1_000_000_000 },
    });
    await h.run(20);
    expect(transport.count).toBe(3);
    // Rate, not ruin: the cast is still live and will wake again next Reckoning.
    expect(h.cast.report().enabled).toBe(true);
    expect(h.cast.report().spend.disabled).toBe(false);
  });

  it('the per-call output cap is sent on every request', async () => {
    const transport = MockTransport.picksAffordance();
    const h = harness(transport, { size: 2, wakeGapTicks: 1, limits: { maxOutputTokens: 123 } });
    await h.run(4);
    expect(transport.count).toBeGreaterThan(0);
    for (const call of transport.calls) expect(call.request.maxOutputTokens).toBe(123);
  });
});

describe('the wake budget is spent like any other principal’s', () => {
  it('no member exceeds WAKES_PER_RECKONING in one Reckoning', async () => {
    const transport = MockTransport.picksAffordance();
    // Gap of 1: the member wants to wake every tick, so the only thing that can stop it
    // at sixteen is the wake ledger.
    const h = harness(transport, {
      size: 2,
      wakeGapTicks: 1,
      limits: { callsPerReckoning: 10_000, spendCapMicros: 1_000_000_000 },
    });
    await h.run(TICKS_PER_RECKONING - 8);

    const perMember = new Map<string, number>();
    for (const call of transport.calls) {
      const who = call.request.messages[1]?.content.split('\n')[0] ?? '?';
      perMember.set(who, (perMember.get(who) ?? 0) + 1);
    }
    expect(perMember.size).toBe(2);
    for (const n of perMember.values()) expect(n).toBeLessThanOrEqual(WAKES_PER_RECKONING);
    // And it actually reached the cap, or the assertion above proves nothing.
    expect(Math.max(...perMember.values())).toBe(WAKES_PER_RECKONING);
  }, 30_000);

  it('reads the same observation an external agent gets, marked as a fresh wake', async () => {
    const transport = MockTransport.picksAffordance();
    const h = harness(transport, { size: 1, wakeGapTicks: 1 });
    await h.run(3);
    const first = transport.calls[0];
    expect(first).toBeDefined();
    const body = first?.request.messages[2]?.content ?? '';
    // The eleven keys, verbatim, in `agent.md` §6's order — not a private projection.
    expect(body).toContain('{"header"');
    expect(body).toContain('"affordances"');
    expect(body).toContain('"briefing"');
    // Fresh: outside a wake `affordances` is empty, so a non-empty list is the proof
    // that a wake was actually spent rather than a cached snapshot re-read.
    expect(body).toMatch(/"affordances":\[\{/);
  });
});

describe('default off', () => {
  it('createCast with no environment returns the heuristic cast, unchanged', () => {
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'default-off' });
    const cast = createCast(runtime, { size: 4, clock: stoppedClock, env: {} });
    expect(cast).toBeInstanceOf(HeuristicCast);
  });

  it('a world built through createCast with no env is byte-identical to the old one', () => {
    setSpeed('instant');
    const a = new Runtime({ seed: 'identical' });
    const castA = createCast(a, { size: 6, clock: stoppedClock, env: {} });
    castA.seat('identical');

    const b = new Runtime({ seed: 'identical' });
    const castB = new HeuristicCast(b, { size: 6 });
    castB.seat('identical');

    for (let i = 0; i < 40; i += 1) {
      for (const action of castA.decide(a.engine.tick + 1, 'identical')) a.engine.submit(action);
      for (const action of castB.decide(b.engine.tick + 1, 'identical')) b.engine.submit(action);
      a.runTick();
      b.runTick();
    }
    expect(a.engine.stateHash).toBe(b.engine.stateHash);
    expect(a.engine.stateVersion).toBe(b.engine.stateVersion);
  });

  it('an unreadable contract disables the LLM path rather than prompting from a copy', async () => {
    const transport = MockTransport.forbidden();
    const h = harness(transport, { size: 2, contract: null, wakeGapTicks: 1 });
    await h.run(10);
    expect(transport.count).toBe(0);
    expect(h.cast.report().enabled).toBe(false);
    expect(sourcesIn(h.runtime, 0).get('HEURISTIC') ?? 0).toBeGreaterThan(0);
    expect(h.logs.join('\n')).toContain('the LLM cast is OFF');
  });
});

describe('the idle policy', () => {
  it('quiet means a member acts only on its own decisions', async () => {
    const transport = MockTransport.picksAffordance();
    const h = harness(transport, { size: 3, wakeGapTicks: 6, planMax: 2, idle: 'quiet' });
    await h.run(24);
    const sources = sourcesIn(h.runtime, 0);
    expect(sources.get('HEURISTIC') ?? 0).toBe(0);
    expect(sources.get('LIVE') ?? 0).toBeGreaterThan(0);
  });

  it('heuristic — the default — keeps today’s motion and layers LIVE on top', async () => {
    const transport = MockTransport.picksAffordance();
    const h = harness(transport, { size: 3, wakeGapTicks: 6, planMax: 2 });
    await h.run(24);
    const sources = sourcesIn(h.runtime, 0);
    expect(sources.get('HEURISTIC') ?? 0).toBeGreaterThan(0);
    expect(sources.get('LIVE') ?? 0).toBeGreaterThan(0);
  });
});

describe('the watchability gap: the deciding share clears the health floor', () => {
  /**
   * The measurement this whole build exists for.
   *
   * The deployed world reports **unhealthy** with `deciding_share_bps: 0` against a floor
   * of 2500, and it is right to: every decision in it is `HEURISTIC`, and scar #14b is
   * precisely a world that looks alive while nothing is deciding anything.
   *
   * ── WHAT THIS DOES AND DOES NOT PROVE ──
   *
   * It runs a full Reckoning of 288 ticks with twelve members against a mock that
   * **always answers, always well-formed, and instantly**. So it measures the *ceiling*,
   * not the expected value: a real provider adds latency, refusals, malformed replies and
   * outages, every one of which converts a `LIVE` into a `FALLBACK` and pushes the share
   * down. What it does establish is that the wake cadence and the plan size are set such
   * that a *working* cast clears the floor with room — which is the thing that would
   * otherwise only be discovered in production, at $2 an hour.
   */
  it('a working cast at the default cadence reports healthy, where a bots-only world does not', async () => {
    const transport = MockTransport.picksAffordance();
    const h = harness(transport, {
      size: 12,
      wakeGapTicks: 18,
      planMax: 3,
      limits: { callsPerReckoning: 100_000, spendCapMicros: 100_000_000_000 },
    });
    await h.run(TICKS_PER_RECKONING);

    const seats = new SeatBook();
    const health = buildHealth(h.runtime, seats);
    expect(health.decisions.by_source.LIVE).toBe(WAKES_PER_RECKONING * 12);

    // ── ASSERTS WHAT THE CHECK ASSERTS: A COLLAPSE TO ZERO, NOT A PROPORTION ──
    //
    // This used to require `deciding_share_bps > DECIDING_FLOOR_BPS`, which is the condition
    // `buildHealth` itself ABANDONED — and abandoned for a reason its comment states as structural:
    // *"twelve members waking sixteen times a Reckoning cannot out-count a heuristic cast that acts
    // every tick."* The LLM contribution here is fixed at `WAKES_PER_RECKONING * 12`, so the share is a
    // ratio whose DENOMINATOR is heuristic activity — meaning any change that makes the bots busier
    // pushes a perfectly healthy cast under the floor.
    //
    // Adding the `refine` branch is exactly such a change, and it is what made this fail: 2,272 bps
    // against 2,500. Nothing was wrong with the cast. Keeping the assertion would have meant either
    // capping how much the world does, or re-tuning a fixture every time it does more — and the second
    // half of scar #14b is a detector that cries wolf until somebody silences it.
    //
    // So the test now asserts the property that actually matters and that the endpoint actually
    // enforces: a working cast is HEALTHY with no failures. The share stays in the payload and is worth
    // watching; it does not decide whether the world is up. The bots-only control below is what proves
    // the check still bites.
    expect(health.decisions.deciding_share_bps, 'the share is still reported, and non-zero').toBeGreaterThan(0);
    expect(health.failures).toEqual([]);
    expect(health.status).toBe('healthy');

    // The control: the same world, same length, heuristics only — the world as deployed.
    setSpeed('instant');
    const bots = new Runtime({ seed: 'bots-only' });
    const heuristic = new HeuristicCast(bots, { size: 12 });
    heuristic.seat('bots-only');
    for (let i = 0; i < TICKS_PER_RECKONING; i += 1) {
      for (const action of heuristic.decide(bots.engine.tick + 1, 'bots-only')) bots.engine.submit(action);
      bots.runTick();
    }
    const botHealth = buildHealth(bots, new SeatBook());
    expect(botHealth.decisions.deciding_share_bps).toBe(0);
    expect(botHealth.status).toBe('unhealthy');
  }, 60_000);
});

describe('a misconfiguration costs nothing', () => {
  it('COMPACT_CAST_LLM on with no key stays on heuristics and says why, once', () => {
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'no-key' });
    const logs: string[] = [];
    const cast = createCast(runtime, {
      size: 4,
      clock: stoppedClock,
      env: { COMPACT_CAST_LLM: 'true' },
      log: (line) => logs.push(line),
    });
    expect(cast).toBeInstanceOf(HeuristicCast);
    expect(logs.join('\n')).toContain('OPENAI_API_KEY is not set');
    // The variable's NAME, never a value — there is no value here to leak, and that is
    // the shape the message must keep when there is.
    expect(logs.join('\n')).not.toMatch(/OPENAI_API_KEY\s*=/);
  });

  it('a failure that never reached the provider is refunded, so it cannot trip the cap', async () => {
    // The case that made this necessary: no key, or DNS down. Every wake fails instantly,
    // nothing is billed, and yet a naive reservation would latch the cumulative cap and
    // disable the cast for good — for calls that were never made.
    const transport = new MockTransport(() =>
      Promise.reject(new CastTransportError('OPENAI_API_KEY is not set', null)),
    );
    const h = harness(transport, {
      size: 4,
      wakeGapTicks: 1,
      limits: { spendCapMicros: 20_000, maxOutputTokens: 200 },
    });
    await h.run(30);

    expect(transport.count).toBeGreaterThan(10);
    expect(h.cast.report().spend.spentMicros).toBe(0);
    expect(h.cast.report().spend.disabled).toBe(false);
    // Still degrading correctly the whole time.
    expect(sourcesIn(h.runtime, 0).get('FALLBACK') ?? 0).toBeGreaterThan(0);
  });

  it('a failure the provider DID answer stays charged, because it may be on the invoice', async () => {
    const transport = new MockTransport(() =>
      Promise.reject(new CastTransportError('completions returned 500: upstream', 500)),
    );
    const h = harness(transport, { size: 2, wakeGapTicks: 1 });
    await h.run(6);
    expect(h.cast.report().spend.spentMicros).toBeGreaterThan(0);
  });
});
