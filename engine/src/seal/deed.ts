/**
 * Layer 3 of the three layers: **the deed, which is ground truth** (SPEC §11.1).
 *
 * A deed is not a claim and not an inference. It is a fact the engine already
 * recorded, presented to the seal module in the shape a verdict can be computed
 * from: who, when, which verb, against what, how much, and **which state version
 * the amount was measured against**.
 *
 * That last field is scar #6 made structural. High Water announced "the river
 * takes 1" from a forecast and then resolved the drowning from an *independent
 * fresh roll*, so ~35% of the time the mandatory event did not happen. The
 * transferable lesson — *resolve from the same state the agents acted on* — is why
 * every deed carries `valuedAtStateVersion` and why {@link
 * ../seal/verdict.ts} refuses to judge a seal against a measurement taken from a
 * state older than the one the agent sealed on.
 *
 * `eventId` is required, not optional. A CONTRADICTED verdict is a permanent
 * public mark on a real agent, so the record must be able to point at the deed it
 * was computed from — INV-17's rule for defaults ("every default event carries an
 * attributable cause") applied to the other permanent mark the design can make.
 */

import type { EventId, PrincipalId } from '../core/types.js';
import { compareIds } from '../ledger/order.js';
import type { SealMeasure } from './intent.js';
import { isDeclaredVerb } from './intent.js';

export interface Deed {
  readonly principal: PrincipalId;
  /** The tick it happened. Compared against the seal's tick — the timestamp proof. */
  readonly tick: number;
  readonly verb: string;
  readonly target: string;
  readonly measure: SealMeasure;
  /** The realised amount, an integer in `measure` units. */
  readonly outcome: number;
  /** The state version this amount was measured against (scar #6, INV-19). */
  readonly valuedAtStateVersion: number;
  /** The ledger event that is this deed's ground truth. */
  readonly eventId: EventId;
}

/**
 * Everything structurally wrong with a deed, or empty.
 *
 * Deeds come from the engine, not from an agent, so a fault here is a programmer
 * error and the caller ({@link ../seal/book.ts}) turns it into a halt rather than
 * a hint. Judging a permanent public verdict from a malformed deed is the A5′
 * failure that is strictly worse than a crash.
 */
export function deedFaults(deed: Deed): string[] {
  const faults: string[] = [];
  if (!Number.isSafeInteger(deed.tick) || deed.tick < 0) {
    faults.push(`deed ${deed.eventId} has a non-integer or negative tick ${String(deed.tick)}`);
  }
  if (!Number.isSafeInteger(deed.outcome)) {
    // A float outcome cannot be compared against an integer band without a
    // rounding rule, and a rounding rule inside a verdict is a rule nobody agreed.
    faults.push(`deed ${deed.eventId} outcome ${String(deed.outcome)} is not a safe integer`);
  }
  if (!Number.isSafeInteger(deed.valuedAtStateVersion) || deed.valuedAtStateVersion < 0) {
    faults.push(
      `deed ${deed.eventId} has no usable valuedAtStateVersion (${String(deed.valuedAtStateVersion)});` +
        ' a verdict must know which state the amount was measured against',
    );
  }
  if (!isDeclaredVerb(deed.verb)) {
    faults.push(`deed ${deed.eventId} names '${deed.verb}', which is not a verb this world declares`);
  }
  if (deed.target.length === 0) faults.push(`deed ${deed.eventId} names no target`);
  if (deed.eventId.length === 0) faults.push('a deed must cite the event that recorded it');
  return faults;
}

/**
 * Canonical deed order: `(tick, eventId)`.
 *
 * Every scan over deeds uses this. Arrival order, insertion order, or a bare
 * `.sort()` would make the cited deed — and therefore the published record —
 * depend on how the tick loop happened to assemble its arguments, which is DET-1
 * and DET-2 failing silently.
 */
export function cmpDeeds(a: Deed, b: Deed): number {
  if (a.tick !== b.tick) return a.tick - b.tick;
  return compareIds(a.eventId, b.eventId);
}
