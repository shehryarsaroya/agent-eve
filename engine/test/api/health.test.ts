/**
 * SCAR-14b — health must fail when nothing is deciding.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * High Water ran for hours looking perfectly healthy while its LLM players had
 * silently fallen back to heuristics. The process was alive, the ticks landed, the
 * map rendered. Every monitor was green. Nobody could have noticed, because every
 * monitor measured liveness.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * TESTING.md's entry is a specification: *"Assert the expensive path is taken:
 * `decision_source` distribution must show `LIVE`/`DELEGATE`, and a run whose LLM
 * share drops below a floor **fails**, even though the process is alive and the game
 * looks healthy."*
 *
 * So the assertion this file exists for is the *negative* one: a world that is up,
 * ticking, and full of bots answers **503**. A test that only checked the happy path
 * would be the same green as the bug.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import { PATHS, agent, enrol, harness, raw, signed, tick, type Harness } from './harness.js';

let h: Harness;

beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.close();
});

function report(body: Record<string, unknown>): Record<string, unknown> {
  const r = body['report'];
  expect(typeof r).toBe('object');
  return r as Record<string, unknown>;
}

describe('SCAR-14b — the health check asserts the interesting property', () => {
  it('reports the decisionSource distribution, not just an uptime', async () => {
    const res = await raw(h, 'GET', PATHS.health);
    const decisions = report(res.json)['decisions'] as Record<string, unknown>;
    const bySource = decisions['by_source'] as Record<string, number>;
    // All five, always, so a source that stops appearing is visible as a zero rather
    // than as an absent key nobody notices.
    expect(Object.keys(bySource).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual([
      'DELEGATE',
      'FALLBACK',
      'HEURISTIC',
      'INTENT',
      'LIVE',
    ]);
    expect(typeof decisions['deciding_share_bps']).toBe('number');
    expect(typeof decisions['floor_bps']).toBe('number');
  });

  it('IS UNHEALTHY when every decision is heuristic, though the process is fine', async () => {
    // The whole scar, in one test. The world runs, the ticks land, the ventures form —
    // and the answer is 503, because nothing is deciding.
    const cast = new HeuristicCast(h.runtime, { size: 8 });
    cast.seat('health-fixture');
    for (let n = 0; n < 40; n += 1) {
      for (const action of cast.decide(h.runtime.engine.tick + 1, 'health-fixture')) {
        h.runtime.engine.submit(action);
      }
      h.runtime.runTick();
    }
    expect(h.runtime.engine.status).toBe('RUNNING');

    const res = await raw(h, 'GET', PATHS.health);
    expect(res.status).toBe(503);
    expect(res.json['ok']).toBe(false);
    const r = report(res.json);
    expect(r['status']).toBe('unhealthy');
    const decisions = r['decisions'] as Record<string, unknown>;
    expect((decisions['by_source'] as Record<string, number>)['HEURISTIC']).toBeGreaterThan(0);
    expect(decisions['deciding_share_bps']).toBe(0);
    // And it says why, in a sentence an operator can act on.
    const failures = r['failures'] as string[];
    expect(failures.join(' ')).toContain('scar #14b');
  });

  it('is healthy once real agents are deciding above the floor', async () => {
    const cast = new HeuristicCast(h.runtime, { size: 4 });
    cast.seat('mixed');
    // ── `agent('vale')` USED TO BE HERE, AND IT WAS THE EXPLOIT ───────────────
    //
    // `CAST_NAMES[0]` is `vale`, so this handle collided with the cast this very test
    // seats. The enrolment 500'd, the status was never asserted, and the acts below
    // still succeeded — because the pre-fix `POST /enroll` had already bound this
    // keypair to the house-cast principal `p:vale` on its way to failing. The `LIVE`
    // decisions this test measures were the identity-takeover defect, attributed to a
    // named character. The scar-#14b check was passing *because of* an A5′ bug.
    //
    // A non-cast handle, and the status is now asserted, which is the assertion whose
    // absence let it hide.
    const a = agent('observer-one');
    expect((await enrol(h, a)).status, 'the live agent must actually enrol or this measures nothing').toBe(201);
    for (let n = 0; n < 40; n += 1) {
      for (const action of cast.decide(h.runtime.engine.tick + 1, 'mixed')) {
        h.runtime.engine.submit(action);
      }
      // A live agent acting every tick. `decision_source: LIVE` comes from the API,
      // which is the only place that can honestly claim it.
      await signed(h, a, 'POST', PATHS.act, {
        actions: [
          { verb: 'claim', params: { text: `tick ${String(n)}` }, clientSequence: 0 },
          { verb: 'publish_offer', params: { text: 'HANDS FOR HIRE' }, clientSequence: 1 },
        ],
      });
      h.runtime.runTick();
    }
    const res = await raw(h, 'GET', PATHS.health);
    const decisions = report(res.json)['decisions'] as Record<string, unknown>;
    expect((decisions['by_source'] as Record<string, number>)['LIVE']).toBeGreaterThan(0);
    expect(decisions['deciding_share_bps']).toBeGreaterThan(0);
    if (res.status === 200) {
      expect(report(res.json)['failures']).toEqual([]);
    } else {
      // If the share is still under the floor the answer must be 503 and must say so:
      // what is not allowed is a green check with a collapsed share.
      expect(Number(decisions['deciding_share_bps'])).toBeLessThan(Number(decisions['floor_bps']));
    }
  });

  it('is unhealthy when nothing decided at all, past warm-up', async () => {
    // Measured separately from the share, because a zero denominator makes a share
    // meaningless — and "no decisions" is exactly the shape the scar took.
    tick(h, 40);
    const res = await raw(h, 'GET', PATHS.health);
    expect(res.status).toBe(503);
    expect((report(res.json)['failures'] as string[]).join(' ')).toContain('no decisions');
  });

  it('is not unhealthy merely for being young', async () => {
    // A world that has just started has no decisions yet and is not broken for it.
    const res = await raw(h, 'GET', PATHS.health);
    expect(res.status).toBe(200);
  });

  it('reports the seat census, the buffer sizes and the rollback gaps', async () => {
    await enrol(h, agent('halcyon'));
    const res = await raw(h, 'GET', PATHS.health);
    const r = report(res.json);
    expect((r['seats'] as Record<string, number>)['occupied']).toBe(1);
    expect((r['seats'] as Record<string, number>)['capacity']).toBeGreaterThan(0);
    // The buffers are how the soak test's "no unbounded array" claim is checked from
    // outside the process.
    expect(Object.keys(r['buffers'] as Record<string, number>).length).toBeGreaterThan(3);
    // Named rather than hidden: a table with no `restore` cannot be rolled back on a
    // halt, and an operator has to know that before deciding to resume.
    //
    // **Empty is now the correct answer**, and it is a stronger claim than the one this
    // line used to make. `venture` was the gap; it has a verified restore, so every
    // registered state table can be put back and a halted tick is genuinely undone.
    // Asserted as equality rather than "does not contain venture", so a table that
    // loses its restore path shows up here rather than in an operator's night.
    expect(Array.isArray(r['rollback_gaps'])).toBe(true);
    expect(r['rollback_gaps']).toEqual([]);
  });

  it('is unhealthy while the world is PAUSED, and says what to do', async () => {
    // Not reachable from any agent input by design (AGT-X9), so it is provoked the
    // only way an operator ever sees it: a HALT-severity violation at ASSERT.
    pause(h);
    const res = await raw(h, 'GET', PATHS.health);
    expect(res.status).toBe(503);
    const failures = (report(res.json)['failures'] as string[]).join(' ');
    expect(failures).toContain('PAUSED');
    expect(failures).toContain('signed resume');
  });

  it('serves the last good snapshot, marked stale, while PAUSED (§15.2)', async () => {
    const a = agent('vex');
    await enrol(h, a);
    pause(h);
    const res = await signed(h, a, 'GET', PATHS.observe);
    expect(res.status).toBe(200);
    const observation = res.json['observation'] as Record<string, unknown>;
    const header = observation['header'] as Record<string, unknown>;
    expect(header['stale']).toBe(true);
    // An empty affordance list, so the client shows "Reckoning delayed" rather than a
    // countdown to an event that will not occur.
    expect(observation['affordances']).toEqual([]);
    expect(header['actions_remaining']).toBe(0);
  });
});

/**
 * Put the world into `PAUSED` the way it actually happens.
 *
 * Through `haltTick`, with a real HALT-severity violation and a real input triple,
 * rather than by poking a status field: the controller refuses to halt on anything
 * less (halting on a WARN would make an outage out of something the design chose not
 * to stop for), and a test that bypassed that would be asserting on a state the
 * engine cannot reach.
 */
function pause(harnessed: Harness): void {
  const tickNumber = harnessed.runtime.engine.tick;
  harnessed.runtime.engine.controller.haltTick(
    {
      tick: tickNumber,
      violations: [
        {
          id: 'TEST-HALT',
          message: 'a deliberate halt, so the health check can be proven to report one',
          tick: tickNumber,
          severity: 'HALT',
        },
      ],
      checked: [],
      skipped: [],
    },
    {
      tick: tickNumber,
      snapshot: harnessed.runtime.engine.snapshot().stateHash,
      actionLog: [],
      seed: 'api-fixture',
    },
  );
}

describe('A4 — the clock is a decision, and a window must outlast an inference', () => {
  it('refuses an unrecognised COMPACT_SPEED rather than quietly picking one', async () => {
    // A world running at a speed nobody chose is how this defect survived for weeks:
    // serve() hardcoded `fast`, so affordance windows of 1-3 ticks were 10-30 seconds —
    // shorter than one LLM inference. A live probe lost two ventures to expiry copying an
    // affordance verbatim, then rebuilt as a 281ms loop and never missed again. That is
    // latency deciding outcomes, which A4 forbids.
    const { serve } = await import('../../src/api/server.js');
    const prev = process.env['COMPACT_SPEED'];
    process.env['COMPACT_SPEED'] = 'brisk';
    try {
      await expect(serve({ port: 0, host: '127.0.0.1', seed: 's', trustEdge: false, castSize: 1, framesDir: null }))
        .rejects.toThrow(/not a speed/);
    } finally {
      if (prev === undefined) delete process.env['COMPACT_SPEED'];
      else process.env['COMPACT_SPEED'] = prev;
    }
  });

  it('every window an agent must react inside outlasts a slow inference at the default', async () => {
    // The property, stated as arithmetic rather than as a hope. Take the shortest window
    // an agent is ever asked to act inside and require it to exceed a generous round trip
    // for a deep reasoning model. At `fast` this is 10s and fails; at `rehearsal` it is
    // 60s and passes, which is why the default moved.
    const { SPEEDS } = await import('../../src/core/time.js');
    const { DEFAULT_SPEED } = await import('../../src/api/server.js');
    const SHORTEST_WINDOW_TICKS = 1; // a quote pins for 1-3 ticks; an affordance can expire next tick
    const SLOW_INFERENCE_SECONDS = 30;
    // Bound to the value the SERVER applies, not to a speed name retyped here. My first
    // version read SPEEDS.rehearsal and stayed green when the default was mutated back to
    // fast — a guard that cannot see what it guards.
    const defaultSpeed = SPEEDS[DEFAULT_SPEED];
    expect(
      SHORTEST_WINDOW_TICKS * defaultSpeed,
      'the shortest window must outlast a slow model, or being fast is power (A4)',
    ).toBeGreaterThan(SLOW_INFERENCE_SECONDS);
    // And the speed the defect shipped under does NOT satisfy it — so this test would
    // have caught the original configuration.
    expect(SHORTEST_WINDOW_TICKS * SPEEDS.fast).toBeLessThan(SLOW_INFERENCE_SECONDS);
  });
});
