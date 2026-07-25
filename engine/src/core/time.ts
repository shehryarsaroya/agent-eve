/**
 * The clock. One constant sets the speed; everything else is measured in ticks.
 *
 * TESTING.md §1.1, hazard 1: compressing the tick does **not** compress
 * wall-clock durations. Rate limits, HTTP timeouts, retry backoffs and mail
 * caps all break at 30× compression, and the failure presents as *agents
 * mysteriously underperforming under load* rather than as an error. So every
 * duration in this codebase is either expressed in ticks or derived from
 * {@link tickSeconds}, and `scripts/scale-audit.mjs` (DET-8) fails the build on
 * any literal that is neither.
 *
 * Hazard 2, also worth reading before using this: an LLM's thinking latency
 * does not compress either, so a compressed run systematically advantages fast
 * models. **A4 is a wall-clock property and is measured at `prod` only.**
 */

/** Named speeds. TESTING.md §1.2. */
export const SPEEDS = {
  /** No wall clock at all; advance by function call. Unit/property/E2E tests. */
  instant: 0,
  /** 150×. Balance search and long-horizon economy sweeps. */
  turbo: 2,
  /** 30×. The default for agent work: a whole season in ~22 h. */
  fast: 10,
  /** 5×. Director timing and the watchability gate. */
  rehearsal: 60,
  /** The real thing. The only speed at which A4 may be measured. */
  prod: 300,
} as const;

export type SpeedName = keyof typeof SPEEDS;

export function isSpeedName(s: string): s is SpeedName {
  return Object.prototype.hasOwnProperty.call(SPEEDS, s);
}

/** Ticks per Reckoning. A "day" in world terms. Fixed across all speeds. */
export const TICKS_PER_RECKONING = 288;

/** The commitment window: the last N ticks before the freeze (SPEC §5.1). */
export const COMMITMENT_WINDOW_TICKS = 24;

/** The freeze is the single tick before settlement. */
export const FREEZE_TICKS = 1;

/** Wakes granted per principal per Reckoning (SPEC §17). */
export const WAKES_PER_RECKONING = 16;

/** Material actions per tick (SPEC §17). Social verbs are free. */
export const ACTIONS_PER_TICK = 4;

/**
 * Gate transit, in ticks (SPEC §17). The most load-bearing number in the
 * design — it sets ventures per day, what a hand's labour is worth, and
 * whether a viewer sees anything move. `TRACKER.md` open question 1.
 */
export const GATE_TRANSIT = {
  intraConstellation: { min: 2, max: 6 },
  interConstellation: { min: 8, max: 20 },
} as const;

/** Hand recovery after loss, in ticks. Loss is time, never capacity. */
export const HAND_RECOVERY_TICKS = { min: 12, max: 48 } as const;

let currentTickSeconds: number = SPEEDS.instant;

export function setSpeed(speed: SpeedName): void {
  currentTickSeconds = SPEEDS[speed];
}

export function tickSeconds(): number {
  return currentTickSeconds;
}

/**
 * Convert a tick count to wall-clock milliseconds at the current speed.
 * The **only** sanctioned way to turn game time into real time. Anything that
 * needs a real duration derives it from here so it scales automatically.
 */
export function ticksToMs(ticks: number): number {
  if (!Number.isSafeInteger(ticks) || ticks < 0) {
    throw new Error(`ticksToMs requires a non-negative integer, got ${ticks}`);
  }
  return ticks * currentTickSeconds * 1000;
}

/**
 * The three phases of a Reckoning, as PHASE INDEXES within the cycle.
 *
 * SPEC §5.1 orders them "commitment window -> **freeze** (last tick *before*
 * settlement) -> settlement", and the boundaries are explicitly "the design".
 *
 * My Gate 0 version made `inFreeze` and `isSettlementTick` BOTH true at phase 287,
 * which quietly deleted the interval the freeze exists to create. A wave-3 verifier
 * found the consequence: INV-18 — "between freeze and settlement, zero events touch
 * the settlement set" — was asserting over an EMPTY interval, so §15.4's
 * defence-in-depth against a fabricated default was unenforceable anywhere in the
 * wired engine. The primary defence (re-reading live balances at VERIFY_INPUTS) was
 * intact, so this was a lost second line rather than an open hole, but it was also an
 * unimplementable contract: a phase asked to "honour the freeze against the settlement
 * set" could not, because the set did not exist yet when it ran.
 *
 * Now the three are disjoint and together tile the cycle, which is the property the
 * tests assert rather than a comment claiming it.
 */
export const SETTLEMENT_PHASE = TICKS_PER_RECKONING - 1;
/** First phase of the freeze. With FREEZE_TICKS = 1 this is the single tick before settlement. */
export const FREEZE_FIRST_PHASE = SETTLEMENT_PHASE - FREEZE_TICKS;
/** First phase of the commitment window, which ends where the freeze begins. */
export const WINDOW_FIRST_PHASE = FREEZE_FIRST_PHASE - COMMITMENT_WINDOW_TICKS;

/** Position within the Reckoning cycle: 0 .. TICKS_PER_RECKONING-1. */
export function phaseOfReckoning(tick: number): number {
  return ((tick % TICKS_PER_RECKONING) + TICKS_PER_RECKONING) % TICKS_PER_RECKONING;
}

export function reckoningIndex(tick: number): number {
  return Math.floor(tick / TICKS_PER_RECKONING);
}

/** Ticks remaining until the next settlement. */
export function ticksUntilReckoning(tick: number): number {
  return TICKS_PER_RECKONING - phaseOfReckoning(tick);
}

/**
 * Is this tick inside the commitment window? Commitments made here are
 * PARTIES-visible only, which is what stops late information from being
 * superior information (A4).
 */
export function inCommitmentWindow(tick: number): boolean {
  const p = phaseOfReckoning(tick);
  return p >= WINDOW_FIRST_PHASE && p < FREEZE_FIRST_PHASE;
}

/**
 * Is this a freeze tick? Nothing may touch the settlement set (INV-18).
 *
 * Strictly BEFORE the settlement tick, so "between freeze and settlement" names a
 * real interval that a check can range over.
 */
export function inFreeze(tick: number): boolean {
  const p = phaseOfReckoning(tick);
  return p >= FREEZE_FIRST_PHASE && p < SETTLEMENT_PHASE;
}

/** Is settlement due at the close of this tick? */
export function isSettlementTick(tick: number): boolean {
  return phaseOfReckoning(tick) === SETTLEMENT_PHASE;
}

/**
 * An injected clock. `Date.now` is banned by lint (DET-7): a world that reads
 * the system clock cannot be replayed, and replay is what makes the record
 * trustworthy. Tests inject a fixed clock; production injects a real one at
 * exactly one place, the tick scheduler.
 */
export interface Clock {
  /** Wall-clock milliseconds since epoch. For display and scheduling only. */
  nowMs(): number;
}

export function fixedClock(startMs: number): Clock {
  let t = startMs;
  return {
    nowMs: () => t,
    // Exposed for tests that need to advance wall time deliberately.
    advance: (ms: number) => {
      t += ms;
    },
  } as Clock & { advance(ms: number): void };
}

/**
 * The one sanctioned reader of real time, used by the scheduler to decide when
 * to run the next tick. Never used inside tick resolution.
 */
export function systemClock(): Clock {
  // The single permitted reader of wall-clock time. DET-7 whitelists this file
  // by path (see eslint.config.js CLOCK_ALLOWLIST) with the reason recorded there.
  return { nowMs: () => Date.now() };
}
