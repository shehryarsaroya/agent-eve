/**
 * The two facts the follow routes read from the running world — and only those two.
 *
 * Whether a handle names a principal (handles are public: every one is on the standings),
 * and what tick it is. Both are READS between ticks; neither can change world state, and the
 * type below is deliberately narrower than `Runtime` so this adapter cannot grow a write.
 * The recap worker reads neither: it works from published frames alone.
 */

import {
  SETTLEMENT_PHASE,
  TICKS_PER_RECKONING,
  phaseOfReckoning,
  ticksToMs,
} from '../../core/time.js';
import type { PrincipalId } from '../../core/types.js';
import type { FollowWorld } from './routes.js';

/** The slice of a runtime this adapter may see. Structural, so a test can pass a stub. */
export interface WorldReader {
  readonly world: { readonly holdingByPrincipal: { has(principal: PrincipalId): boolean } };
  readonly engine: { readonly tick: number };
}

/**
 * The Reckoning that has most recently settled once `tick` has committed, or null before
 * the first. Reckoning k settles on tick `288k + 287`, so tick 287 is Reckoning 0's.
 */
export function latestSettledReckoningAt(tick: number): number | null {
  if (tick < SETTLEMENT_PHASE) return null;
  return Math.floor((tick + 1) / TICKS_PER_RECKONING) - 1;
}

/** Ticks from a committed `tick` to the next settlement tick. Always at least one. */
export function ticksToNextSettlement(tick: number): number {
  const p = phaseOfReckoning(Math.max(0, tick));
  const d = (SETTLEMENT_PHASE - p + TICKS_PER_RECKONING) % TICKS_PER_RECKONING;
  return d === 0 ? TICKS_PER_RECKONING : d;
}

export function followWorldOf(runtime: WorldReader): FollowWorld {
  return {
    principalExists: (handle) => runtime.world.holdingByPrincipal.has(`p:${handle}` as PrincipalId),
    latestSettledReckoning: () => latestSettledReckoningAt(runtime.engine.tick),
    msUntilNextReckoning: () => ticksToMs(ticksToNextSettlement(runtime.engine.tick)),
  };
}
