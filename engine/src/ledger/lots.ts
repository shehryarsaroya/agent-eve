/**
 * Lots — where goods physically are.
 *
 * SPEC §10.2: *everything is located*. A lot is a located quantity of one good in
 * one account, with provenance and at most one encumbrance
 * (`PASS-ECONOMY-RISK-extended` §1.4 / P16: an `encumbrance_id` is what stops the
 * same goods from backing two obligations).
 *
 * **INV-7, said out loud:** the lot table is the *only* home of a goods quantity.
 * There is no `balanceQty` on an account and no goods total anywhere else. Goods
 * postings are the movement *record*, and `checkInv7` asserts the two agree; it
 * never sums across them. Scar #5 destroyed exactly 2× the real value by
 * aggregating a quantity and its mirror, and a raid handler summing a lot and an
 * account balance would reproduce it exactly.
 */

import type { AccountId, GoodId, PrincipalId, SystemId } from '../core/types.js';
import type { Qty } from '../core/units.js';

/** CONTRACT GAP: this brand belongs in `core/types.ts` beside `AccountId`. */
export type LotId = string & { readonly __brand: 'LotId' };

/**
 * `IN_TRANSIT` is the third bucket in INV-2 (`Σ balances + Σ escrowed +
 * Σ in-transit`). It is a state on the lot rather than an account, because being
 * in transit is physical and does not change who owns the goods — and because a
 * fifth account kind would not match `schema.sql`.
 */
export type LotState = 'AVAILABLE' | 'IN_TRANSIT';

export interface Lot {
  readonly id: LotId;
  /**
   * Where the value sits. A lot never changes account: a transfer decrements the
   * source lot and opens a new one at the destination, which is what keeps
   * "one quantity, one home" true through a move (P16 — splits preserve
   * provenance).
   */
  readonly account: AccountId;
  readonly good: GoodId;
  qty: Qty;
  location: SystemId;
  state: LotState;
  /** Exclusive. A pledged lot cannot back a second obligation, and cannot be sent away. */
  encumbranceId: string | null;
  readonly createdTick: number;
  /** Provenance, bounded to the creator (P16 keeps the histogram, we keep the head). */
  readonly origin: PrincipalId;
}

/**
 * Lot ids are derived from the event that created them plus an index within that
 * event. Content-derived, so replay from `(snapshot, action_log, seed)` produces
 * the same ids without a counter to snapshot (DET-3, DET-5).
 */
export function lotId(eventId: string, indexInEvent: number): LotId {
  return `lot:${eventId}:${indexInEvent}` as LotId;
}

/** A lot's value counts toward available supply only when it is not moving. */
export function isInTransit(lot: Lot): boolean {
  return lot.state === 'IN_TRANSIT';
}
