/**
 * The season clock (SPEC §5): a pure function of the tick, pinned against arithmetic done by hand.
 *
 * The oracle is the table below, not the engine — `test/golden/time.json`'s rule: a recalibration
 * shows up as a diff a human reads, and an engine output pasted in unchecked is a snapshot of a bug.
 * With 288 ticks a Reckoning and 14 Reckonings a season, Season 1 is ticks 0..4031 and its FINALE is
 * Reckoning 13 (ticks 3744..4031), settling at 4031; Season 2 opens at 4032.
 */

import { describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import {
  SEASON_RECKONINGS,
  SEASON_STATEMENT,
  TICKS_PER_SEASON,
  finaleReckoningOf,
  finaleTickOf,
  inFinale,
  isSeasonBoundaryTick,
  reckoningInSeason,
  reckoningsLeft,
  seasonClockAt,
  seasonFirstTick,
  seasonOf,
} from '../../src/season/index.js';

describe('the season clock', () => {
  it('is fourteen Reckonings of 288 ticks — the calibration this file is pinned to', () => {
    expect(SEASON_RECKONINGS).toBe(14);
    expect(TICKS_PER_RECKONING).toBe(288);
    expect(TICKS_PER_SEASON).toBe(4_032);
  });

  it('numbers seasons from 1 and puts each tick in exactly one', () => {
    const table: readonly (readonly [number, number])[] = [
      [-5, 1],
      [0, 1],
      [287, 1],
      [4_031, 1],
      [4_032, 2],
      [8_063, 2],
      [8_064, 3],
    ];
    for (const [tick, season] of table) expect(seasonOf(tick), `tick ${String(tick)}`).toBe(season);
  });

  it('opens each season on a Reckoning boundary and closes it on the FINALE’s settlement tick', () => {
    expect(seasonFirstTick(1)).toBe(0);
    expect(seasonFirstTick(2)).toBe(4_032);
    expect(finaleReckoningOf(1)).toBe(13);
    expect(finaleReckoningOf(2)).toBe(27);
    expect(finaleTickOf(1)).toBe(4_031);
    expect(finaleTickOf(2)).toBe(8_063);
    // The boundary tick is the last of its season and the next tick is the next season's first.
    expect(seasonOf(finaleTickOf(1) + 1)).toBe(2);
    expect(seasonFirstTick(2)).toBe(finaleTickOf(1) + 1);
  });

  it('counts the Reckoning of the season from 1, and the Reckonings left counting the one in progress', () => {
    expect(reckoningInSeason(0)).toBe(1);
    expect(reckoningsLeft(0)).toBe(14);
    expect(reckoningInSeason(288)).toBe(2);
    expect(reckoningsLeft(288)).toBe(13);
    expect(reckoningInSeason(3_743)).toBe(13);
    expect(reckoningsLeft(3_743)).toBe(2);
    // The FINALE: 1 left, all 288 ticks of it, and never 0.
    for (const tick of [3_744, 3_900, 4_031]) {
      expect(reckoningsLeft(tick), `tick ${String(tick)}`).toBe(1);
      expect(inFinale(tick)).toBe(true);
    }
    expect(inFinale(3_743)).toBe(false);
    expect(reckoningsLeft(4_032)).toBe(14);
  });

  it('marks exactly one boundary tick per season', () => {
    const boundaries: number[] = [];
    for (let tick = 0; tick < 3 * TICKS_PER_SEASON; tick++) if (isSeasonBoundaryTick(tick)) boundaries.push(tick);
    expect(boundaries).toEqual([4_031, 8_063, 12_095]);
    expect(isSeasonBoundaryTick(-1)).toBe(false);
  });

  it('publishes the clock as one value, with the rule verbatim', () => {
    const c = seasonClockAt(3_800);
    expect(c).toEqual({
      season: 1,
      reckoning: 14,
      of: 14,
      reckonings_left: 1,
      first_tick: 0,
      finale_tick: 4_031,
      ticks_to_finale: 231,
      in_finale: true,
      rule: SEASON_STATEMENT,
    });
    expect(seasonClockAt(4_031).ticks_to_finale).toBe(0);
  });

  it('refuses a season that is not a positive integer rather than publishing NaN', () => {
    expect(() => finaleTickOf(0)).toThrow();
    expect(() => seasonFirstTick(1.5)).toThrow();
  });
});
