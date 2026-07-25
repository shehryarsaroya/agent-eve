/**
 * PERF-8 / §16 step 8 — the 24-hour-equivalent soak, reconciling every tick, with no
 * unbounded array.
 *
 * *"30 principals, 24 h unattended at `fast`, reconciling every tick, no unbounded
 * array, no memory growth."* At `fast` a Reckoning is 288 ticks in about 48 minutes,
 * so 24 hours is roughly **one full Reckoning plus change** of world time — and the
 * whole point of `instant` (`SPEEDS.instant === 0`) is that we can run that in CI in
 * seconds rather than waiting a day for the wall clock to catch up.
 *
 * The three things this measures, none of which is speed:
 *
 *   1. **It reconciles every tick.** `--assert-every-tick` is the default and the
 *      invariant pass runs in ASSERT; a single HALT-severity violation anywhere in the
 *      day fails this test.
 *   2. **No unbounded array.** Every buffer this module owns is sampled at the start,
 *      the middle and the end, and each has a published cap. Scar #3 was an unbounded
 *      array; the fix is not "smaller", it is *bounded*, which is a different claim
 *      and needs a different assertion.
 *   3. **The world is still answering.** A soak that ends with a PAUSED world and a
 *      bounded heap has proved the wrong thing.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { PATHS, agent, enrol, harness, raw, signed, type Harness } from './harness.js';

/** One day of world time at `fast`, plus a margin either side of the boundary. */
const SOAK_TICKS = TICKS_PER_RECKONING + 40;

/** Published caps. Every one of these is a bound, not a hope. */
const CAPS: Readonly<Record<string, number>> = Object.freeze({
  talk: 512,
  offers: 256,
  claims: 512,
  pendingFills: 512,
  censusTicks: 288,
  pendingCorrections: 16 * 40,
  pendingCorrectionPrincipals: 40,
});

let h: Harness;

beforeEach(async () => {
  h = await harness({ seed: 'soak', seats: 40 });
});
afterEach(async () => {
  await h.close();
});

describe('PERF-8 — a day unattended, reconciling every tick', () => {
  it('runs a full Reckoning with 30 principals, reconciles every tick, and stays bounded', async () => {
    const cast = new HeuristicCast(h.runtime, { size: 20 });
    cast.seat('soak');

    // Ten live agents over HTTP alongside the cast, so the soak exercises the boundary
    // and not only the engine. A soak that never touches the API would not notice an
    // unbounded map in the limiter, the idempotency store, or the correction buffer.
    const agents = Array.from({ length: 10 }, (_, i) => agent(`soaker-${String(i)}`));
    for (const a of agents) {
      expect((await enrol(h, a)).status).toBe(201);
    }
    // Thirty principals in the world: twenty house cast plus ten self-enrolled. The
    // seat cap bounds self-enrolment, which is the attacker-controlled half; the cast
    // is provisioned by the operator at boot and counted in `population`.
    expect(h.context.seats.occupied).toBe(10);
    expect(h.runtime.world.principalOrder.length).toBe(30);

    const samples: Record<string, number>[] = [];
    let violations = 0;
    let requests = 0;
    let badStatuses = 0;

    for (let n = 0; n < SOAK_TICKS; n += 1) {
      for (const action of cast.decide(h.runtime.engine.tick + 1, 'soak')) {
        h.runtime.engine.submit(action);
      }
      // The live agents act every fourth tick, which is about what a wake budget of 16
      // over 288 ticks actually permits — a soak where they acted every tick would be
      // measuring a load the design does not allow.
      if (n % 4 === 0) {
        for (const a of agents) {
          const acted = await signed(h, a, 'POST', PATHS.act, {
            actions: [{ verb: 'claim', params: { text: `t${String(n)}` }, clientSequence: 0 }],
            idempotencyKey: `${a.handle}-${String(n)}`,
          });
          requests += 1;
          if (acted.status >= 400) badStatuses += 1;
        }
      }
      // A deliberately illegal action every tick, from one agent, so the correction
      // buffer is under continuous pressure rather than empty.
      const noisy = agents[0];
      if (noisy !== undefined) {
        await signed(h, noisy, 'POST', PATHS.act, {
          actions: [{ verb: 'move', params: { hand: 'ghost', to: 'nowhere' }, clientSequence: 1 }],
        });
        requests += 1;
      }

      const report = h.runtime.runTick();
      violations += report.violations.length;
      expect(report.halted, `halted at tick ${String(report.tick)}`).toBe(false);
      if (n === 0 || n === Math.floor(SOAK_TICKS / 2) || n === SOAK_TICKS - 1) {
        samples.push({ ...h.runtime.bufferSizes() });
      }
      // Advance the wall clock too, so the rate limiter's windows really roll and its
      // own map is exercised rather than frozen at one window.
      h.clock.advance(10_000);
    }

    // 1. It reconciled every tick.
    expect(violations).toBe(0);
    expect(h.runtime.engine.status).toBe('RUNNING');

    // 2. Nothing grew without a bound.
    expect(samples).toHaveLength(3);
    for (const sample of samples) {
      for (const [name, cap] of Object.entries(CAPS)) {
        expect(sample[name], `${name} exceeded its published cap`).toBeLessThanOrEqual(cap);
      }
    }
    // The last sample is the one that matters: growth over a day, not a snapshot.
    const last = samples[2];
    expect(last).toBeDefined();
    if (last !== undefined) {
      expect(last['censusTicks']).toBeLessThanOrEqual(288);
      // The pending-correction buffer is per principal and drained on read, so an
      // agent that reads carries none and one that does not carries at most 16.
      expect(last['pendingCorrectionPrincipals']).toBeLessThanOrEqual(30);
    }

    // The host-side maps are bounded too. These are the ones an attacker chooses the
    // key space of, which is what made scar #3 a disk DoS rather than a leak.
    expect(h.context.limiter.tracked).toBeLessThanOrEqual(20_000);
    expect(h.context.idempotency.size).toBeLessThanOrEqual(20_000);
    // Per principal, the idempotency store keeps at most 64 keys — so ten agents
    // sending ~72 keys each cannot have kept them all.
    expect(h.context.idempotency.size).toBeLessThanOrEqual(10 * 64);

    // 3. It was still answering, and it never punished a well-formed request.
    expect(requests).toBeGreaterThan(400);
    expect(badStatuses).toBe(0);
    const health = await raw(h, 'GET', PATHS.health);
    // Not asserting `healthy` here: with twenty bots and ten agents the deciding share
    // may legitimately sit under the floor, and asserting 200 would make this test pass
    // for the wrong reason. What must be true is that the report is coherent.
    const report = health.json['report'] as Record<string, unknown>;
    expect((report['decisions'] as Record<string, unknown>)['total']).toBeGreaterThan(0);
    expect(report['world']).toBe('RUNNING');
    expect(report['failures']).toBeDefined();
  }, 120_000);

  it('the event ledger and the action log are both bounded in memory', () => {
    // The action log is a process-memory mirror of a Postgres table and retains a fixed
    // number of ticks; 288 ticks a day for a season kept forever is scar #3 with a slow
    // fuse. Asserted here rather than trusted, because the retention is a constructor
    // default somebody could change.
    const cast = new HeuristicCast(h.runtime, { size: 12 });
    cast.seat('ledger-bound');
    for (let n = 0; n < 200; n += 1) {
      for (const action of cast.decide(h.runtime.engine.tick + 1, 'ledger-bound')) {
        h.runtime.engine.submit(action);
      }
      h.runtime.runTick();
    }
    expect(h.runtime.engine.log.ticks.length).toBeLessThanOrEqual(65);
    // The event ledger is the product and grows on purpose — but it must grow only
    // with events, not with refusals (scar #10).
    expect(h.runtime.events.eventCount).toBeLessThanOrEqual(h.runtime.ventures.size * 4);
  });
});
