/**
 * Signed goods deltas.
 *
 * `core/units.ts:qty()` rejects negatives, and it is right to: a *balance* of a
 * good is never negative (INV-3), so the constructor for a stored quantity must
 * refuse one. But a **posting** is signed. INV-1 requires the postings of a
 * value-moving event to sum to zero, and a haul of 5 ORE from A to B is the pair
 * `(-5, +5)` — the DB agrees, `posting.amount_qty` is a signed `bigint`.
 *
 * So this file holds the one sanctioned constructor for a signed goods delta.
 * Every quantity that is *stored* (a lot's size, a supply total) still goes
 * through `qty()` and therefore still cannot go negative.
 *
 * CONTRACT GAP: this belongs in `core/units.ts` beside `qty()`. Noted in the
 * module report rather than added there, because core/ is owned elsewhere.
 */

import { UnitError, qty, type Qty } from '../core/units.js';

/** A signed change in a quantity of goods. Never a balance. */
export function qtyDelta(v: number): Qty {
  if (!Number.isSafeInteger(v)) {
    throw new UnitError(`Qty delta must be a safe integer, got ${String(v)}`);
  }
  return v as Qty;
}

/** Add a signed delta to a stored quantity. Throws if the result would go negative. */
export function applyQtyDelta(current: Qty, d: Qty): Qty {
  // Routed through qty() deliberately: a negative result is INV-3 and must not
  // be representable, let alone storable.
  return qty(current + d);
}

/** Sum signed deltas. The result may be negative, so it is a delta, not a balance. */
export function sumQtyDelta(xs: readonly Qty[]): Qty {
  let acc = 0;
  for (const x of xs) acc += x;
  return qtyDelta(acc);
}

export function negQtyDelta(a: Qty): Qty {
  return qtyDelta(0 - (a as number));
}
