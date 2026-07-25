/**
 * The three layers, side by side (SPEC §11.1) — the say-do gap as an object.
 *
 * > "The record therefore shows: *what it told everyone → what it privately
 * > committed to → what it did.* A public lie becomes provable against a
 * > timestamped pre-commitment, and — the reason this beats a viewer-only
 * > confessional — an externally-run agent **cannot perform for it**, because it
 * > had to commit before knowing the outcome."
 *
 * | Layer | What | Tier | May it lie? |
 * |---|---|---|---|
 * | 1 | the public `reason`, ≤140 chars | `PUBLIC` | **yes, legally** |
 * | 2 | the seal | `SEALED` → flag at the Reckoning | it is a pre-commitment |
 * | 3 | the deed | `PUBLIC` | it is ground truth |
 *
 * ## Layer 3 is carried by reference, not by value
 *
 * A row lists the principal's public deed **event ids** and stops there. Two
 * reasons, and the second is the load-bearing one:
 *
 * - the deeds are already in the public feed, and a second copy of a public fact
 *   is scar #5's shape (one quantity, two homes);
 * - a row that carried *which* deed each verdict was computed from would narrow
 *   the sealed verb and target to that deed's, which is seal content arriving on a
 *   fixed lag. {@link sayDoRow} therefore never reads `citedDeedEventId` — the
 *   field is not in this file, so no edit here can start leaking it by accident.
 *
 * The attribution appears in {@link sayDoReplayRow}, which is the season
 * documentary's projection and refuses to render before the season closes.
 *
 * ## Layer 1 is never an input to anything
 *
 * A 140-character public line is a poor instrument for constructing a deception
 * (§11.1) and a superb one for constructing a false accusation (scar #8). It is
 * *displayed* next to the flag and it is never read by {@link ../seal/verdict.ts}.
 */

import type { EventId, PrincipalId } from '../core/types.js';
import { compareIds } from '../ledger/order.js';
import type { SealAuditRecord } from './book.js';
import {
  SealDisclosureError,
  agentSealDisclosure,
  seasonReplaySealContent,
  type SealDisclosure,
  type SealReplayRow,
} from './disclosure.js';
import { claimFaults, type PublicClaim } from './intent.js';

/**
 * INV-26 — every array in every serialized structure is within its declared cap.
 * A Reckoning can hold up to `ACTIONS_PER_TICK x TICKS_PER_RECKONING` material
 * acts, so an uncapped row is scar #3's unbounded array with a public URL.
 */
export const MAX_ROW_ITEMS = 64;

/**
 * What the cap dropped, counted.
 *
 * PROP-O1's discipline: the budget is met by filtering, never by silent
 * truncation, and every omission is counted with a reason. A truncated list is
 * indistinguishable, from a reader's side, from the world having been quieter than
 * it was.
 */
export interface SayDoWithheld {
  readonly claims: number;
  readonly deeds: number;
}

export interface SayDoRow {
  readonly principal: PrincipalId;
  readonly reckoningIndex: number;
  /** Layer 1. Public, and allowed to be a lie. */
  readonly claims: readonly PublicClaim[];
  /** Layer 2. The flag, and nothing else, ever (PROP-D2). */
  readonly seals: readonly SealDisclosure[];
  /** Layer 3, by reference into the public feed. Unattributed, deliberately. */
  readonly deedEventIds: readonly EventId[];
  readonly withheld: SayDoWithheld;
}

export interface SayDoRowInput {
  readonly principal: PrincipalId;
  readonly reckoningIndex: number;
  readonly claims: readonly PublicClaim[];
  readonly seals: readonly SealAuditRecord[];
  /**
   * **All** of this principal's public deed events for the Reckoning, unfiltered.
   *
   * Passing only the deeds a verdict cited would rebuild the attribution this row
   * exists to withhold. The row cannot detect that, which is why it is stated
   * here: the caller's list is layer 3 as the public already sees it.
   */
  readonly deedEventIds: readonly EventId[];
}

/**
 * The agent-and-viewer projection of the say-do gap. One row per principal per
 * Reckoning, which is also the docket's shape (INV-25).
 */
export function sayDoRow(input: SayDoRowInput): SayDoRow {
  for (const claim of input.claims) {
    if (claim.principal !== input.principal) {
      throw new SealDisclosureError(
        `claim by ${claim.principal} offered in ${input.principal}'s row; attributing a line to the` +
          ' wrong principal is the fabricated-record failure (A5-prime)',
      );
    }
    const faults = claimFaults(claim);
    if (faults.length > 0) {
      throw new SealDisclosureError(`malformed public claim: ${faults.join('; ')}`);
    }
  }
  for (const rec of input.seals) {
    if (rec.principal !== input.principal) {
      throw new SealDisclosureError(`seal ${rec.id} belongs to ${rec.principal}, not ${input.principal}`);
    }
    if (rec.reckoningIndex !== input.reckoningIndex) {
      // Scar #7 at the presentation layer: a seal shown under a later Reckoning is
      // a promise being re-read at a court that is not its own.
      throw new SealDisclosureError(
        `seal ${rec.id} belongs to Reckoning ${rec.reckoningIndex}, not ${input.reckoningIndex}`,
      );
    }
  }

  const claims = [...input.claims]
    .sort((a, b) => a.tick - b.tick || compareIds(a.reason, b.reason))
    .slice(0, MAX_ROW_ITEMS);
  const deeds = [...new Set(input.deedEventIds)].sort(compareIds).slice(0, MAX_ROW_ITEMS);
  const seals = [...input.seals]
    .sort((a, b) => compareIds(a.id, b.id))
    .slice(0, MAX_ROW_ITEMS)
    .map(agentSealDisclosure);

  return Object.freeze({
    principal: input.principal,
    reckoningIndex: input.reckoningIndex,
    claims: Object.freeze(claims),
    seals: Object.freeze(seals),
    deedEventIds: Object.freeze(deeds),
    withheld: Object.freeze({
      claims: Math.max(0, input.claims.length - claims.length),
      deeds: Math.max(0, new Set(input.deedEventIds).size - deeds.length),
    }),
  });
}

export interface SayDoReplayRow {
  readonly principal: PrincipalId;
  readonly reckoningIndex: number;
  readonly claims: readonly PublicClaim[];
  /** Content, at last: the intents, the prose, and what each verdict cited. */
  readonly seals: readonly SealReplayRow[];
  readonly deedEventIds: readonly EventId[];
}

/**
 * The season documentary's projection. Refuses before the season closes — §11.2
 * releases content "when it is archaeology rather than intelligence".
 */
export function sayDoReplayRow(
  input: SayDoRowInput,
  seasonClosesAtTick: number,
  atTick: number,
): SayDoReplayRow {
  const base = sayDoRow(input);
  return Object.freeze({
    principal: base.principal,
    reckoningIndex: base.reckoningIndex,
    claims: base.claims,
    seals: Object.freeze(
      [...input.seals]
        .sort((a, b) => compareIds(a.id, b.id))
        .map((rec) => seasonReplaySealContent(rec, seasonClosesAtTick, atTick)),
    ),
    deedEventIds: base.deedEventIds,
  });
}
