/**
 * THE SCALE HARNESS, CI-SIZED — the same code `scripts/population-scale.ts` runs at 3,000 principals,
 * run here at forty across one Reckoning with a fake clock.
 *
 * The measurement itself (milliseconds, megabytes) is not asserted: CI hardware is not the target box,
 * and a timing assertion is a coin flip. What IS asserted is everything the measurement rests on, so
 * the instrument cannot rot between the runs somebody does by hand:
 *
 *   - it seats a population larger than the house cast's `MAX_CAST` (the old harness could not);
 *   - the run crosses a settlement tick and the burst is measured on the tick after it, for EVERY
 *     principal, with no extrapolation;
 *   - the Reckoning frame renders (the first 3,000-principal run died here — WORKS legend);
 *   - every population-sized book reports its size against its cap, and none is over;
 *   - the run is deterministic: two runs end on one `state_hash`, and serving observations through
 *     the fragment path rather than the reference path changes no byte and no hash.
 */

import { describe, expect, it } from 'vitest';
import { observationBody, referenceObservationBody } from '../../src/api/fragments.js';
import { MAX_CAST } from '../../src/cast/heuristic.js';
import { setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import { MAX_BUFFERED_EVENTS } from '../../src/tick/loop.js';
import { GROWTH_QUALIFIED_PER_SYSTEM } from '../../src/world/index.js';
import {
  formatRow,
  measurePopulation,
  referenceObserveBody,
  syntheticRoster,
  wakeInput,
  type ObserveBody,
  type ScaleOptions,
} from '../../scripts/scale/harness.js';

const POPULATION = 40;
const SETTLES = TICKS_PER_RECKONING - 1;

/** A clock that advances one "millisecond" per read: deterministic, and every interval is positive. */
function fakeClock(): () => number {
  let now = 0;
  return () => (now += 1);
}

const base = (observe: ObserveBody): ScaleOptions => ({
  population: POPULATION,
  seed: 'scale-ci',
  // Start eight ticks before the settlement tick so one run crosses it and reaches the burst after it.
  startTick: SETTLES - 8,
  ticks: 10,
  wakeEvery: 3,
  observe,
  clock: fakeClock(),
});

describe('the scale harness, at forty principals across one Reckoning', () => {
  // One byte-checking observer serves the first run: every body it returns is the fragment path's,
  // and it refuses to return one the reference path would not have produced byte for byte.
  let compared = 0;
  const checked: ObserveBody = (runtime, principal) => {
    const fast = observationBody(wakeInput(runtime, principal));
    const slow = referenceObservationBody(wakeInput(runtime, principal));
    if (fast !== slow) throw new Error(`fragment body differs from the reference for ${principal}`);
    compared += 1;
    return fast;
  };
  setSpeed('instant');
  const row = measurePopulation(base(checked));

  it('seats more principals than the house cast has names', () => {
    expect(POPULATION).toBeGreaterThan(MAX_CAST);
    expect(syntheticRoster(POPULATION)).toHaveLength(POPULATION);
    expect(new Set(syntheticRoster(3_000)).size).toBe(3_000);
    expect(row.population).toBe(POPULATION);
    expect(row.halted).toBe(false);
  });

  it('crosses the settlement tick and measures the burst on the tick after it, for everybody', () => {
    expect(row.reckoning?.tick).toBe(SETTLES);
    expect(row.observe.tick).toBe(SETTLES + 1);
    expect(row.observe.sampled).toBe(POPULATION);
    expect(row.observe.burstExtrapolated).toBe(false);
    expect(compared).toBe(POPULATION); // the byte check really ran, once per principal
    expect(row.observe.bytes.mean).toBeGreaterThan(1_000);
    expect(row.actionsPerTick).toBeGreaterThan(0); // somebody actually played
  });

  it('renders both frames, and records rather than crashes when one cannot render', () => {
    expect(row.frames.reckoningError).toBeNull();
    expect(row.frames.reckoningBytes ?? 0).toBeGreaterThan(0);
    expect(row.frames.liveBytes).toBeGreaterThan(0);
  });

  it('meters every population-sized book against its cap, and none is over', () => {
    const books = row.pressure.map((p) => p.book);
    for (const book of ['submission window', 'fill queue', 'elections', 'grants', 'open orders', 'levy ballots', 'charge ballots']) {
      expect(books).toContain(book);
    }
    for (const p of row.pressure) expect(p.size, p.book).toBeLessThanOrEqual(p.cap);
    expect(row.peakPressureBps).toBeLessThan(10_000);
    expect(row.journal.maxEventsPerTick).toBeGreaterThan(0);
    expect(row.journal.maxEventsPerTick).toBeLessThanOrEqual(MAX_BUFFERED_EVENTS);
  });

  it('reports the growth gate and the stage, read off the same map', () => {
    expect(row.growth.needed).toBe(row.map.systems * GROWTH_QUALIFIED_PER_SYSTEM);
    expect(row.growth.qualified).toBeLessThanOrEqual(POPULATION);
    expect(row.grown).toBe(0); // forty principals cannot open a constellation on the launch map
    expect(row.map.maxPerCommons).toBeGreaterThan(0);
    expect(formatRow(row)).toContain(String(POPULATION));
  });

  it('is deterministic, and the observation path changes no byte of the world', () => {
    // MUTATION: let an observation write state (a memo that leaks into a table), or let the synthetic
    // cast draw from anything but its seeded stream — the hashes part and this is RED.
    const again = measurePopulation(base(referenceObserveBody));
    expect(again.stateHash).toBe(row.stateHash);
    expect(again.journal.events).toBe(row.journal.events);
    expect(again.observe.bytes.mean).toBeGreaterThan(0);
  });
});
