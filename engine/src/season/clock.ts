/**
 * The SEASON clock — the third horizon (SPEC §5: *"Season · weeks · Frontier claims settle and
 * re-open; a finale; a champion; a recap"*).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **A PURE FUNCTION OF THE TICK, LIKE THE RAID SCHEDULE AND THE PULSE CLOCK.** No state, no draw and
 * no world read, so the observation, the frame, the affordance layer and the boundary step all answer
 * "which season is it and when does it end" from one function — scar #5's rule applied to a clock.
 * A season that two surfaces could disagree about is a finale an agent sleeps through.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## The numbering
 *
 * Seasons are **1-based** (the world opens on Season 1) and a season is exactly
 * {@link SEASON_RECKONINGS} consecutive Reckonings, so Season `s` holds Reckoning indexes
 * `(s−1)·N … s·N − 1`. Its **FINALE** is the last of them and the FINALE's settlement tick is the
 * season's last tick — the boundary step runs at its close, after everything else that Reckoning
 * settles, and the next tick is the next season's first.
 */

import { reckoningIndex, SETTLEMENT_PHASE, TICKS_PER_RECKONING } from '../core/time.js';
import { SEASON_RECKONINGS, SEASON_STATEMENT, TICKS_PER_SEASON } from './params.js';

/** The season `tick` falls in. 1-based; a tick before genesis counts as the first season. */
export function seasonOf(tick: number): number {
  const reckoning = Math.max(0, reckoningIndex(tick));
  return Math.floor(reckoning / SEASON_RECKONINGS) + 1;
}

/** The first tick of `season`. */
export function seasonFirstTick(season: number): number {
  assertSeason(season);
  return (season - 1) * TICKS_PER_SEASON;
}

/** The Reckoning index of `season`'s FINALE — its last Reckoning. */
export function finaleReckoningOf(season: number): number {
  assertSeason(season);
  return season * SEASON_RECKONINGS - 1;
}

/** The FINALE's settlement tick: the season's last tick, and the tick its boundary step runs at. */
export function finaleTickOf(season: number): number {
  return finaleReckoningOf(season) * TICKS_PER_RECKONING + SETTLEMENT_PHASE;
}

/** Which Reckoning of its season `tick` is in, **1-based** — "Reckoning 3 of 14". */
export function reckoningInSeason(tick: number): number {
  const reckoning = Math.max(0, reckoningIndex(tick));
  return (reckoning % SEASON_RECKONINGS) + 1;
}

/**
 * Reckonings still to settle this season, **counting the one in progress**. `1` means tonight is the
 * FINALE; it is never `0`, because the tick after the FINALE's settlement belongs to the next season.
 */
export function reckoningsLeft(tick: number): number {
  return SEASON_RECKONINGS - reckoningInSeason(tick) + 1;
}

/** Is `tick` inside its season's FINALE — the last Reckoning? */
export function inFinale(tick: number): boolean {
  return reckoningsLeft(tick) === 1;
}

/** Is `tick` the FINALE's settlement tick — the tick at whose close the season ends? */
export function isSeasonBoundaryTick(tick: number): boolean {
  return tick >= 0 && tick === finaleTickOf(seasonOf(tick));
}

function assertSeason(season: number): void {
  if (!Number.isSafeInteger(season) || season < 1) {
    throw new Error(`a season is a positive integer, got ${String(season)}`);
  }
}

/**
 * The clock as the observation and the frame publish it. One inert value, the `raid_schedule` shape.
 *
 * Named with their units on purpose (`one-word-two-units.spec.ts`): `reckoning` and `of` are counts
 * of Reckonings, `finale_tick` and `ticks_to_finale` are ticks.
 */
export interface SeasonClock {
  /** 1-based. */
  readonly season: number;
  /** Which Reckoning of the season this is, 1-based. */
  readonly reckoning: number;
  /** How many Reckonings a season has. */
  readonly of: number;
  /** Reckonings still to settle, counting this one: `1` means tonight is the FINALE. */
  readonly reckonings_left: number;
  readonly first_tick: number;
  /** The FINALE's settlement tick — the season's last tick. */
  readonly finale_tick: number;
  readonly ticks_to_finale: number;
  /** True for every tick of the FINALE. */
  readonly in_finale: boolean;
  /** {@link SEASON_STATEMENT}, verbatim. */
  readonly rule: string;
}

export function seasonClockAt(tick: number): SeasonClock {
  const season = seasonOf(tick);
  const finale = finaleTickOf(season);
  return {
    season,
    reckoning: reckoningInSeason(tick),
    of: SEASON_RECKONINGS,
    reckonings_left: reckoningsLeft(tick),
    first_tick: seasonFirstTick(season),
    finale_tick: finale,
    ticks_to_finale: Math.max(0, finale - tick),
    in_finale: inFinale(tick),
    rule: SEASON_STATEMENT,
  };
}
