/**
 * The published raid schedule — the half of predation an agent reads *before* anything
 * happens to it.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **A RAID AN AGENT COULD NOT SEE COMING IS A DICE ROLL.** A2 says known arithmetic is
 * exact and machine-readable; A14 says drama runs on a clock, *not on hope*. Both are
 * only satisfied if the clock is legible, so the spawn ticks, the window length, the
 * target rule and the resolution formula are all published in the observation before
 * the first raid of the season spawns.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Everything here is a pure function of the tick. There is no state, no draw and no
 * world read, which is what lets the affordance layer, the observation, the frame and
 * the PREDATE phase all answer "when is the next one" from one function — scar #5's
 * rule applied to a schedule rather than to a quantity.
 */

import { phaseOfReckoning, reckoningIndex, TICKS_PER_RECKONING } from '../core/time.js';
import { DEMAND_WINDOW_TICKS, RAID_SPAWN_PHASES } from './params.js';

/** Does the world spawn raids at this tick? */
export function isSpawnTick(tick: number): boolean {
  return RAID_SPAWN_PHASES.includes(phaseOfReckoning(tick));
}

/** The tick a raid spawned at `tick` would resolve at. */
export function resolvesAt(spawnTick: number): number {
  return spawnTick + DEMAND_WINDOW_TICKS;
}

/**
 * The next tick at or after `tick` at which the world spawns. Never null: the schedule
 * repeats every Reckoning, so there is always a next one.
 *
 * `atOrAfter` rather than `after` on purpose — an agent observing *at* a spawn tick is
 * looking at a raid that is landing now, and telling it the next one is in 72 ticks
 * would be a true sentence about the wrong raid.
 */
export function nextSpawnTick(tick: number): number {
  const phase = phaseOfReckoning(tick);
  const base = tick - phase;
  for (const p of RAID_SPAWN_PHASES) {
    if (p >= phase) return base + p;
  }
  const first = RAID_SPAWN_PHASES[0];
  // Unreachable while the schedule is non-empty; `assertRaidSchedule` refuses an empty
  // one at construction. Written as a branch rather than a `!` so an empty schedule
  // degrades to "never" instead of producing `NaN` in an agent's countdown.
  if (first === undefined) return Number.MAX_SAFE_INTEGER;
  return base + TICKS_PER_RECKONING + first;
}

/** How many raid windows open in one Reckoning. Published; it is `N` in SPEC §9. */
export function raidsPerReckoning(): number {
  return RAID_SPAWN_PHASES.length;
}

/**
 * The whole schedule as one inert value, for the observation and the affordance layer.
 *
 * `rule` is the target-selection sentence and it is here rather than in `target.ts`
 * because the schedule is what an agent *reads*: the rule and the clock arrive
 * together or an agent knows when to be afraid without knowing what of.
 */
export interface RaidSchedule {
  readonly next_spawn_tick: number;
  readonly ticks_until_spawn: number;
  readonly window_ticks: number;
  readonly next_resolve_tick: number;
  readonly per_reckoning: number;
  readonly reckoning: number;
  /** The published target rule, verbatim. See {@link RAID_TARGET_STATEMENT}. */
  readonly rule: string;
}

/**
 * The target rule, as one sentence.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THIS STRING IS A RULES SURFACE** (hard rule 4). It is what an agent is told, and
 * `target.ts` is what actually happens; `test/predation/schedule.test.ts` pins them to
 * each other, because scar #1 is the engine and the agent-facing text disagreeing about
 * one word and it survived three critic passes.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const RAID_TARGET_STATEMENT =
  'World raids are aimed by rule, never by choice: at each spawn tick the world picks the principal with the ' +
  'most goods standing OUTSIDE the Commons, breaking ties toward the one with fewest present hands there and ' +
  'then by lowest principal id. Nothing in the Commons can be a target at all — hostile action there is ' +
  'invalid, not punished. A principal just raided, and a place where a raid was repulsed, are both off the ' +
  'list for one Reckoning. The demand is drawn from a published band of units and does NOT depend on what ' +
  'you hold, so a raid can demand more than is there and leave with ballast. You have the whole window to ' +
  'pay it (yield), resist it (fight) or ignore it; ignoring costs the multiple, resisting risks your hands, ' +
  'and nothing a raid does is ever a default or moves your standing.';

export function scheduleAt(tick: number): RaidSchedule {
  const next = nextSpawnTick(tick);
  return {
    next_spawn_tick: next,
    ticks_until_spawn: Math.max(0, next - tick),
    window_ticks: DEMAND_WINDOW_TICKS,
    next_resolve_tick: resolvesAt(next),
    per_reckoning: raidsPerReckoning(),
    reckoning: reckoningIndex(tick),
    rule: RAID_TARGET_STATEMENT,
  };
}
