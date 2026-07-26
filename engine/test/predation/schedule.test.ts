/**
 * The published half of predation: the clock and the rule an agent reads **before**
 * anything happens to it.
 *
 * A14 says drama runs on a clock, *not on hope*; A2 says known arithmetic is exact and
 * machine-readable. Together they mean a raid an agent could not see coming is a dice
 * roll wearing a mechanic's clothes, and the thing that stops that is not the resolver —
 * it is this file's subject matter.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FREEZE_FIRST_PHASE,
  TICKS_PER_RECKONING,
  WINDOW_FIRST_PHASE,
  phaseOfReckoning,
} from '../../src/core/time.js';
import {
  DEMAND_WINDOW_TICKS,
  RAID_DEMAND_QTY,
  RAID_FORCE,
  RAID_SPAWN_PHASES,
  RAID_TAKE_MULTIPLE,
  RAID_TARGET_STATEMENT,
  assertRaidSchedule,
  isSpawnTick,
  nextSpawnTick,
  raidsPerReckoning,
  resolvesAt,
  scheduleAt,
} from '../../src/predation/index.js';

describe('the schedule is published, and it is a clock an agent can plan against', () => {
  it('names every spawn tick of the cycle, and only those', () => {
    const spawns: number[] = [];
    for (let tick = 0; tick < TICKS_PER_RECKONING; tick += 1) {
      if (isSpawnTick(tick)) spawns.push(tick);
    }
    expect(spawns).toEqual([...RAID_SPAWN_PHASES]);
    expect(raidsPerReckoning()).toBe(RAID_SPAWN_PHASES.length);
  });

  it('`nextSpawnTick` never looks backwards and never returns a tick in another cycle by mistake', () => {
    // Walked across two whole Reckonings rather than sampled: the wrap at the cycle
    // boundary is the only interesting case and a spot check would miss it.
    for (let tick = 0; tick < TICKS_PER_RECKONING * 2; tick += 1) {
      const next = nextSpawnTick(tick);
      expect(next, `tick ${String(tick)}`).toBeGreaterThanOrEqual(tick);
      expect(isSpawnTick(next), `tick ${String(tick)} -> ${String(next)}`).toBe(true);
      // Nothing between now and then is a spawn, or the countdown an agent reads would
      // be pointing past a raid that had already landed.
      for (let between = tick; between < next; between += 1) {
        expect(isSpawnTick(between), `${String(between)} is between ${String(tick)} and ${String(next)}`).toBe(false);
      }
    }
  });

  it('at a spawn tick, the countdown reads zero — a raid landing now is not "in 72 ticks"', () => {
    const at = RAID_SPAWN_PHASES[0];
    if (at === undefined) throw new Error('the schedule is empty');
    expect(scheduleAt(at).ticks_until_spawn).toBe(0);
    expect(scheduleAt(at).next_spawn_tick).toBe(at);
  });

  it('no raid can resolve inside the commitment window, the freeze or the settlement tick', () => {
    // §5.1's freeze is HARD: "no new commitments, no book clears, **no raid
    // resolution**". A raid that resolved there could only be dropped or resolved
    // illegally, and both are a permanent public fact the rules made unavoidable (A5′).
    for (const phase of RAID_SPAWN_PHASES) {
      const resolves = resolvesAt(phase);
      expect(phaseOfReckoning(resolves), `spawn ${String(phase)}`).toBe(resolves);
      expect(resolves).toBeLessThan(WINDOW_FIRST_PHASE);
      expect(resolves).toBeLessThan(FREEZE_FIRST_PHASE);
      expect(resolves).toBeLessThan(TICKS_PER_RECKONING - 1);
    }
    expect(() => {
      assertRaidSchedule();
    }).not.toThrow();
  });

  /**
   * **The guard is only a guard if something calls it.**
   *
   * A verifier mutated `Runtime`'s constructor to skip `assertRaidSchedule()` and the
   * whole suite stayed green: every test proved the *function* refuses a bad schedule and
   * none proved the *world* asks it. A check nobody invokes is a comment with a
   * signature, and this one is the difference between "a raid can never resolve inside
   * the freeze" being a property and being a hope — §5.1's freeze is hard, so a schedule
   * that violates it must stop the world at construction, before it has published a tick
   * anyone believed.
   *
   * Read from the source because the call has no observable effect while the schedule is
   * valid, which is exactly the condition that let it go untested.
   */
  it('the Runtime CONSTRUCTOR calls it — the guard is wired, not merely written', () => {
    const source = readFileSync(new URL('../../src/sim/runtime.ts', import.meta.url), 'utf8');
    const constructorBody = source.slice(
      source.indexOf('constructor(options: RuntimeOptions)'),
      source.indexOf('constructor(options: RuntimeOptions)') + 6_000,
    );
    expect(constructorBody).toContain('assertRaidSchedule()');
  });

  it('the schedule an agent reads carries the window, the count and the rule verbatim', () => {
    const published = scheduleAt(10);
    expect(published.window_ticks).toBe(DEMAND_WINDOW_TICKS);
    expect(published.per_reckoning).toBe(RAID_SPAWN_PHASES.length);
    expect(published.next_resolve_tick).toBe(published.next_spawn_tick + DEMAND_WINDOW_TICKS);
    expect(published.rule).toBe(RAID_TARGET_STATEMENT);
  });
});

describe('the target statement is a rules surface, and it must not lie', () => {
  // Scar #1 is the engine and the agent-facing text disagreeing about one word, and it
  // survived three critic passes because every component was correct on its own. This is
  // the cheapest guard available: the sentence has to name the things the code does.
  it('names the Commons floor, the cooldown, the multiple and the "not a default" promise', () => {
    expect(RAID_TARGET_STATEMENT).toMatch(/Commons/);
    expect(RAID_TARGET_STATEMENT).toMatch(/invalid, not punished/);
    expect(RAID_TARGET_STATEMENT).toMatch(/Reckoning/);
    expect(RAID_TARGET_STATEMENT).toMatch(/yield/);
    expect(RAID_TARGET_STATEMENT).toMatch(/fight/);
    expect(RAID_TARGET_STATEMENT).toMatch(/multiple/);
    expect(RAID_TARGET_STATEMENT).toMatch(/never a default|not.*default/i);
  });

  it('promises the demand does NOT depend on what you hold — the §11.2 clause it is built on', () => {
    // If this sentence ever stopped saying it, the fraction-of-stock design would be
    // back and the demand would leak a SENSED hold value through a public formula.
    expect(RAID_TARGET_STATEMENT).toMatch(/does NOT depend on what\s+you hold|does NOT depend on what you hold/);
  });
});

describe('the published bands are usable arithmetic, not decoration', () => {
  it('every band is ordered, positive, and integral — no float reaches a hashed record', () => {
    for (const band of [RAID_DEMAND_QTY, RAID_FORCE]) {
      expect(band.min).toBeLessThanOrEqual(band.max);
      expect(Number.isSafeInteger(band.min)).toBe(true);
      expect(Number.isSafeInteger(band.max)).toBe(true);
      expect(band.min).toBeGreaterThan(0);
    }
  });

  it('silence costs strictly more than paying, or the window is not a decision', () => {
    // The whole shape of the mechanic: pay strictly dominates ignore, so an agent that
    // is present always has a better answer than an agent that is not — and the cost of
    // not deciding is goods and time, never identity, standing or a holding.
    expect(RAID_TAKE_MULTIPLE).toBeGreaterThan(1);
  });
});
