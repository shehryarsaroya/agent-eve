/**
 * PROP-O8 — monotonic countdowns (scar #14d).
 *
 * > "The payload carries `serverNow` + `next_decision_at` and the agent derives the
 * > rest. Assert no derived countdown can go backwards across two successive fetches."
 *
 * Scar #14d, in full: *"Non-monotonic countdowns — derived per-request from server time;
 * agents saw time go backwards. Send `phaseEndsAt` + `serverNow` and let the client/agent
 * compute."*
 *
 * So the shape of the fix is the thing under test: **one wall-clock read per payload**,
 * an absolute deadline the agent can subtract from, and a countdown derived from the
 * payload's own tick rather than from a second clock read.
 */

import { describe, expect, it } from 'vitest';
import { minor } from '../../src/core/units.js';
import { TICKS_PER_RECKONING, ticksUntilReckoning } from '../../src/core/time.js';
import {
  ObservationCache,
  assertCountdownMonotonic,
  buildObservation,
  countdownFaults,
  observe,
} from '../../src/observe/index.js';
import { ALICE, BRAM, CASS, NOW_MS, fixture, goLive, makeHaul, sourcesFor } from './fixture.js';

describe('PROP-O8 — the payload carries the deadline and one clock reading', () => {
  it('carries serverNow verbatim and derives ticks from its own tick', () => {
    const f = fixture();
    const built = buildObservation(sourcesFor(f, { tick: 100, serverNowMs: NOW_MS }), ALICE);
    const { header } = built.observation;
    expect(header.serverNow).toBe(NOW_MS);
    expect(header.tick).toBe(100);
    // Derived inside the payload, from the payload's own tick. No second clock read.
    expect(header.next_reckoning.ticks).toBe(ticksUntilReckoning(100));
    expect(header.next_reckoning.tick).toBe(100 + ticksUntilReckoning(100) - 1);
  });

  it('next_decision_at is never before the payload’s own tick', () => {
    const f = fixture();
    for (const tick of [0, 1, 100, 250, TICKS_PER_RECKONING - 1]) {
      const built = buildObservation(sourcesFor(f, { tick }), ALICE);
      expect(built.observation.header.next_decision_at.tick).toBeGreaterThanOrEqual(tick);
      expect(countdownFaults(built.observation, built.observation)).toEqual([]);
    }
  });

  it('next_decision_at.ms derives from ticksToMs, so it scales with the clock', () => {
    const f = fixture();
    const built = buildObservation(sourcesFor(f, { tick: 10, serverNowMs: NOW_MS }), ALICE);
    // At `instant` speed (the test default) a tick is zero wall time, so the deadline is
    // now. What matters is that it is derived, never a literal.
    expect(built.observation.header.next_decision_at.ms).toBeGreaterThanOrEqual(NOW_MS);
  });
});

describe('PROP-O8 — no derived countdown goes backwards across successive fetches', () => {
  it('holds across every tick of a Reckoning', () => {
    const f = fixture();
    const haul = makeHaul(f, { windowClosesTick: 280, resolvesAtTick: 287 });
    goLive(f, haul, [BRAM, CASS], minor(12_000));
    let previous = buildObservation(sourcesFor(f, { tick: 0 }), ALICE).observation;
    for (let tick = 1; tick < TICKS_PER_RECKONING; tick += 1) {
      const next = buildObservation(sourcesFor(f, { tick }), ALICE).observation;
      // Both clauses: the announced deadline never moves earlier, and the countdown to
      // the same deadline never rises.
      assertCountdownMonotonic(previous, next);
      previous = next;
    }
  });

  it('holds across a Reckoning boundary — a new deadline is later, never earlier', () => {
    const f = fixture();
    const last = buildObservation(sourcesFor(f, { tick: TICKS_PER_RECKONING - 1 }), ALICE).observation;
    const first = buildObservation(sourcesFor(f, { tick: TICKS_PER_RECKONING }), ALICE).observation;
    assertCountdownMonotonic(last, first);
    expect(first.header.next_reckoning.tick).toBeGreaterThan(last.header.next_reckoning.tick);
    // The countdown resets upward, which is legal because the *deadline* moved with it.
    expect(first.header.next_reckoning.ticks).toBeGreaterThan(last.header.next_reckoning.ticks);
  });

  it('holds when a stale read is interleaved with fresh ones', () => {
    // The case the cached-verbatim rule exists for: a stale body reuses its own
    // `serverNow` and deadline, so it cannot make a countdown jump.
    const f = fixture();
    const cache = new ObservationCache();
    const a = observe(sourcesFor(f, { tick: 100, isWake: true }), ALICE, cache).observation;
    const b = observe(sourcesFor(f, { tick: 101, isWake: false }), ALICE, cache).observation;
    const c = observe(sourcesFor(f, { tick: 102, isWake: true }), ALICE, cache).observation;
    assertCountdownMonotonic(a, b);
    assertCountdownMonotonic(b, c);
    // The stale one repeats the cached figures exactly.
    expect(b.header.serverNow).toBe(a.header.serverNow);
    expect(b.header.next_reckoning.ticks).toBe(a.header.next_reckoning.ticks);
  });

  it('holds when an affordance expires and the next decision moves on', () => {
    // `next_decision_at` legitimately moves earlier when a nearer option appears, and
    // legitimately moves later when one dies. Neither is a broken promise; what would be
    // is the *Reckoning* moving earlier, which is asserted separately.
    const f = fixture();
    const haul = makeHaul(f, { windowOpensTick: 0, windowClosesTick: 4, resolvesAtTick: 100 });
    let previous = buildObservation(sourcesFor(f, { tick: 1 }), CASS).observation;
    for (let tick = 2; tick <= 10; tick += 1) {
      const next = buildObservation(sourcesFor(f, { tick }), CASS).observation;
      assertCountdownMonotonic(previous, next);
      previous = next;
    }
    void haul;
  });
});

describe('the countdown checker bites', () => {
  it('catches a Reckoning that moved earlier', () => {
    const f = fixture();
    const a = buildObservation(sourcesFor(f, { tick: 10 }), ALICE).observation;
    const b = buildObservation(sourcesFor(f, { tick: 11 }), ALICE).observation;
    const mutant = {
      ...b,
      header: {
        ...b.header,
        next_reckoning: { ...b.header.next_reckoning, tick: a.header.next_reckoning.tick - 5 },
      },
    };
    expect(countdownFaults(a, mutant).join(' ')).toContain('moved earlier');
    expect(() => assertCountdownMonotonic(a, mutant)).toThrow(/PROP-O8/);
  });

  it('catches a countdown to the same Reckoning that rose', () => {
    const f = fixture();
    const a = buildObservation(sourcesFor(f, { tick: 10 }), ALICE).observation;
    const b = buildObservation(sourcesFor(f, { tick: 11 }), ALICE).observation;
    const mutant = {
      ...b,
      header: {
        ...b.header,
        next_reckoning: { ...b.header.next_reckoning, ticks: a.header.next_reckoning.ticks + 1 },
      },
    };
    expect(countdownFaults(a, mutant).join(' ')).toContain('rose');
  });

  it('catches a tick that went backwards', () => {
    const f = fixture();
    const a = buildObservation(sourcesFor(f, { tick: 20 }), ALICE).observation;
    const b = buildObservation(sourcesFor(f, { tick: 10 }), ALICE).observation;
    expect(countdownFaults(a, b).join(' ')).toContain('backwards');
  });

  it('catches a next_decision_at behind the payload’s own tick', () => {
    const f = fixture();
    const a = buildObservation(sourcesFor(f, { tick: 20 }), ALICE).observation;
    const mutant = {
      ...a,
      header: { ...a.header, next_decision_at: { tick: 5, ms: NOW_MS } },
    };
    expect(countdownFaults(mutant, mutant).join(' ')).toContain('before the payload');
  });
});
