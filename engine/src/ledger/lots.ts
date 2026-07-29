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

import type { AccountId, GoodId, HandId, PrincipalId, SystemId } from '../core/types.js';
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
  /**
   * **Which hand is carrying this lot, or `null` if it is standing still.**
   *
   * ══════════════════════════════════════════════════════════════════════════
   * This is the field `world/hands.ts:cargoHeldByHands` has been asking for since `haul`
   * landed: *"until the two are reconciled (**the clean fix is a `carrier: HandId | null` on
   * the lot**, making `hand.cargo` a derived read), the only sanctioned use of this function
   * against the ledger is equality."*
   *
   * Without it, `IN_TRANSIT` lots form an **anonymous pool** keyed only by
   * `(account, good, destination)`, and every reader that needs *this hand's* cargo has to
   * guess by walking the pool in id order until a running total is covered. Two facts make
   * that guess wrong rather than merely arbitrary:
   *
   *   1. lot ids do not partition by hand — a split lot is named after the *event*
   *      (`lot:haul.split:<tick>:…`), so one haul's lots interleave with another's;
   *   2. the walk lands **whole lots**, so it overshoots the arriving hand's manifest and
   *      lands a second hand's cargo early while clearing only the first hand's manifest.
   *
   * That is the INV-W7 halt reproduced at `test/world/a-convoy-carries-its-own-cargo.spec.ts`:
   * two ordinary hauls on consecutive ticks stopped the world. With a carrier there is no
   * pool and no walk — a landing retires exactly the lots the landing hand departed with.
   *
   * **INVARIANT (INV-W7, the carrier half):** `carrier !== null` if and only if
   * `state === 'IN_TRANSIT'`, and `Σ qty` over a hand's lots equals that hand's manifest per
   * good. Asserted every tick by `checkCargoMirror`, so a future sink that lands or relocates
   * a lot without clearing the carrier halts instead of quietly re-pooling it.
   * ══════════════════════════════════════════════════════════════════════════
   */
  carrier: HandId | null;
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
