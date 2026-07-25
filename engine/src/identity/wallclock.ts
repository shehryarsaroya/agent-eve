/**
 * Wall-clock seconds — deliberately **not** ticks.
 *
 * TESTING.md §1.1 hazard 1 and DET-8 require every duration to be in ticks or
 * derived from `tickSeconds()`. The durations in this module are the sanctioned
 * exception, for exactly the reason `scripts/scale-audit.mjs` whitelists
 * `src/api/limits.ts`: **they protect the host, not the game.**
 *
 *   - RFC 9421's `created` and `expires` are Unix seconds by the standard. A
 *     signature freshness window expressed in ticks would be *zero* seconds at
 *     `instant` speed (`tickSeconds() === 0`) — which deletes replay protection
 *     in precisely the mode CI runs in.
 *   - Replay protection must not become 300× looser when the tick becomes 300×
 *     shorter. The window means "within a minute of real time", at every speed.
 *
 * The unit lives in the **type**, not in the identifier, so a tick count can
 * never be passed where real seconds are meant. That is stronger than a naming
 * convention and it is what makes the exception safe to grant.
 *
 * Nothing here reads the clock. Real time enters through an injected
 * {@link Clock} at exactly one call site (`wallSecondsFrom`), per DET-7.
 */

import type { Clock } from '../core/time.js';

/** A point in time, or a span, in whole seconds of real time. Never ticks. */
export type WallSeconds = number & { readonly __brand: 'WallSeconds' };

export class WallClockError extends Error {}

export function wallSeconds(v: number): WallSeconds {
  if (!Number.isSafeInteger(v) || v < 0) {
    // Unix seconds and spans are both non-negative integers. A float here would
    // reach a signature parameter and therefore a hashed structure.
    throw new WallClockError(`WallSeconds must be a non-negative safe integer, got ${String(v)}`);
  }
  return v as WallSeconds;
}

export function addWallSeconds(a: WallSeconds, b: WallSeconds): WallSeconds {
  return wallSeconds(a + b);
}

/**
 * The single bridge from an injected clock to Unix seconds. Truncating rather
 * than rounding, so a signature created at `t.9` is never stamped `t+1` — a
 * timestamp from the future is a rejection reason of its own.
 */
export function wallSecondsFrom(clock: Clock): WallSeconds {
  const ms = clock.nowMs();
  if (!Number.isFinite(ms) || ms < 0) {
    throw new WallClockError(`clock returned an unusable value: ${String(ms)}`);
  }
  // Milliseconds to whole seconds. Not a game duration and not scale-dependent:
  // it is the unit conversion the RFC's timestamps are defined in.
  return wallSeconds(Math.floor(ms / 1000));
}
