/**
 * The order — what an agent puts on a book, and the ordering rule that decides
 * whose order wins.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **A4: A FASTER HTTP CLIENT MUST GAIN NOTHING HERE.**
 *
 * In EVE, market speed is enormous power: the player who repriced first got the
 * fill, so the market rewarded a fast connection and a macro. A4 forbids that —
 * "never let requests-per-second, uptime, model size, or account age be power" —
 * and a book is the single easiest place in this design to violate it by accident,
 * because *every* real exchange breaks A4 on purpose.
 *
 * So priority here is **price first, then `(placedTick, principal_id,
 * client_sequence, order_id)`** and never wall-clock arrival. Each term is chosen:
 *
 *   - `placedTick` is the *tick* an order entered the book, not the millisecond.
 *     Two orders submitted 4 minutes apart inside one 5-minute tick are the same
 *     age, so there is nothing to win by submitting sooner within the window.
 *   - `principal_id` and `client_sequence` are exactly the tick loop's own window
 *     ordering (`src/tick/queue.ts`: "ORDER BY `(priority, principal_id,
 *     client_sequence)`. NEVER BY ARRIVAL."). `client_sequence` is supplied by the
 *     agent for its *own* batch and is unique per `(principal, tick)`, so it orders
 *     an agent's competing commitments and can never order it ahead of anyone else.
 *   - `order_id` is a content-derived total-order backstop, so `Array.sort` never
 *     sees a tie and never falls back to implementation-defined ordering (DET-1).
 *
 * The consequence that is tested rather than asserted: **the same set of orders,
 * submitted in any arrival order, produces byte-identical fills.** See
 * `test/market/determinism.test.ts`.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Everything here is integer. Prices are `Minor` per unit and quantities are `Qty`,
 * because `core/units.ts` bans floats from every value path — not merely from
 * hashed structures — and a book is where a float would otherwise arrive first
 * (a midpoint, an average, a percentage fee).
 */

import type { GoodId, PrincipalId, SystemId } from '../core/types.js';
import { minor, qty, type Minor, type Qty } from '../core/units.js';
import { compareIds } from '../ledger/order.js';

/** A resting order's identity. Content-derived; see {@link orderIdFor}. */
export type OrderId = string & { readonly __brand: 'OrderId' };

/**
 * Which side of the book. `BID` buys, `ASK` sells.
 *
 * Deliberately not `BUY`/`SELL`: those are verbs and this is a *place on a book*.
 * Neither word is a SPEC §3 canon term and neither appears in any other union in
 * `src/`, so no word is doing two jobs (the §3 rule that `test/core/vocabulary-repo`
 * enforces repo-wide).
 */
export type Side = 'BID' | 'ASK';

/**
 * How long an order lives.
 *
 * `IOC` — immediate-or-cancel — is **the only market-take primitive in this game**
 * (`PASS-ECONOMY-RISK-extended` M1). There is no "market order": every order names
 * a limit price, and IOC is how an agent says *take what is there now and do not
 * leave a resting order behind*. Its unfilled remainder expires in the same
 * matching pass and its escrow is released in that pass.
 *
 * `GTC` rests until `expiresTick`. Both are matched in the same pass by the same
 * rule; the only difference is what happens to the remainder.
 */
export type TimeInForce = 'GTC' | 'IOC';

/**
 * Where an order is in its life. `OPEN` covers partially-filled orders too: a
 * commodity order permits partial fills (M1), and a partly-filled order that still
 * has quantity is still working.
 *
 * There is no `PARTIAL` member on purpose — `Coverage.PARTIAL` already exists in
 * `src/invariants/registry.ts` and one word may not name two concepts.
 */
export type OrderState = 'OPEN' | 'FILLED' | 'CANCELLED' | 'EXPIRED';

/**
 * A venue is a **system**, and orders settle exactly where they matched.
 *
 * M1's Phase 0 simplification, stated as a type: "Phase 0 uses exact-venue
 * settlement; later an explicit venue set creates escrowed child orders." A single
 * global book would delete geography, and with it hauling, trade routes, regional
 * scarcity and every reason a blockade is worth anything.
 */
export type VenueId = SystemId;

export interface Order {
  readonly id: OrderId;
  readonly principal: PrincipalId;
  readonly venue: VenueId;
  readonly good: GoodId;
  readonly side: Side;
  /** Per unit, pre-fee, in minor units. Never a total. */
  readonly limitPrice: Minor;
  /** What was ordered. `filled` never exceeds it (MKT-6). */
  readonly quantity: Qty;
  filled: Qty;
  readonly timeInForce: TimeInForce;
  /** The tick this order entered the book. Its matching epoch and its seniority. */
  readonly placedTick: number;
  /**
   * The last tick on which this order may still match. An order is expired at the
   * matching pass where `tick > expiresTick`.
   *
   * For `IOC` this equals `placedTick + 1` — the one pass it gets, since an order
   * placed at T is first matchable at T+1 (§15.2: within-tick actions never react
   * to another within-tick action).
   */
  readonly expiresTick: number;
  /** The agent's own `client_sequence`. Orders its own competing orders, nobody else's. */
  readonly clientSequence: number;
  state: OrderState;
  /**
   * The cash lock backing a `BID`, or `null` on an `ASK`.
   *
   * An `ASK` escrows *goods*, which live in the market escrow account rather than
   * behind an `EncumbranceBook` row — the book locks currency in STORES and cannot
   * hold a quantity of a good. See `escrow.ts` for why that is escrow and not a
   * second lock mechanism.
   */
  readonly encumbranceId: string | null;
}

/** What an order still has working. Never negative (MKT-6 asserts it). */
export function remainingOf(order: Order): Qty {
  return qty(Math.max(0, order.quantity - order.filled));
}

export function isOpen(order: Order): boolean {
  return order.state === 'OPEN';
}

/** The cash a `BID` must still have escrowed to honour its whole remainder. */
export function cashRequired(order: Order): Minor {
  if (order.side !== 'BID') return minor(0);
  return multiplyPrice(order.limitPrice, remainingOf(order));
}

/**
 * `unitPrice × quantity`, checked.
 *
 * A product that silently leaves the safe-integer range is how a ledger stops balancing, and
 * `minor()` would happily accept the wrong answer because the wrong answer is itself an integer (the
 * same trap `sumMinor` was hardened against).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THIS DOCSTRING SAID "NOT INLINED ANYWHERE" AND THAT WAS FALSE IN THREE PLACES.**
 *
 * At `RULES_VERSION` 34 the BID escrow — one quantity — had **six** homes: this helper, the two
 * wrappers {@link cashRequired} and `place.ts:escrowFor` (both of which had *no caller at all*), two
 * inlined copies of the wrappers' exact bodies in `place.ts:planOrder` and `market/invariants.ts`,
 * and a raw `order.limitPrice * remainingOf(order)` in `market/observe.ts` with **no overflow check**.
 *
 * So the module had written the checked helper, written two named wrappers around it, called neither,
 * and then re-inlined both — while the one path that skipped the check was the one publishing a
 * number to agents. At 38 the two wrappers have their callers back and the raw multiplication is
 * gone; this note stays because "not inlined anywhere" is a claim a docstring cannot enforce, and
 * `test/market/one-escrow-one-home.spec.ts` now can.
 * ══════════════════════════════════════════════════════════════════════════
 */
export function multiplyPrice(unitPrice: Minor, amount: Qty): Minor {
  const product = unitPrice * amount;
  if (!Number.isSafeInteger(product)) {
    throw new RangeError(`market: ${String(unitPrice)} x ${String(amount)} leaves the safe integer range`);
  }
  return minor(product);
}

/**
 * The order id, derived from content and never from a counter.
 *
 * `(principal, placedTick, clientSequence)` is unique by construction: the tick
 * loop's queue refuses a duplicate `client_sequence` inside one window
 * (`src/tick/queue.ts`), so no two orders can collide. Content-derived because a
 * counter has to be snapshotted or replay diverges (DET-3/DET-5) — the same
 * argument `lotId` and `handIdFor` make.
 */
export function orderIdFor(principal: PrincipalId, placedTick: number, clientSequence: number): OrderId {
  return `ord:${String(placedTick)}:${principal}:${String(clientSequence)}` as OrderId;
}

/** The book key. One book per venue and good — geography is the whole point. */
export function bookKey(venue: VenueId, good: GoodId): string {
  return `${venue}::${good}`;
}

/**
 * Seniority: **older first, and never by arrival**.
 *
 * This is the tie-break A4 turns on, so it is one exported function with one
 * caller-visible name rather than an inline comparator repeated at four sort
 * sites. `placedTick` first (an order that has rested a tick outranks one that has
 * not), then the tick loop's own `(principal_id, client_sequence)`, then the id.
 *
 * Negative when `a` is more senior.
 */
export function compareSeniority(a: Order, b: Order): number {
  return (
    a.placedTick - b.placedTick ||
    compareIds(a.principal, b.principal) ||
    a.clientSequence - b.clientSequence ||
    compareIds(a.id, b.id)
  );
}

/**
 * Full priority on one side of one book: **price first, then seniority**.
 *
 * A bid at a higher price outranks a bid at a lower one; an ask at a lower price
 * outranks an ask at a higher one. That is the only thing about this ordering that
 * rewards anything an agent can spend money on, which is the point — conviction
 * buys priority, latency does not.
 */
export function comparePriority(a: Order, b: Order): number {
  if (a.side !== b.side) {
    throw new RangeError('market: priority compares two orders on the same side of one book');
  }
  const byPrice = a.side === 'BID' ? b.limitPrice - a.limitPrice : a.limitPrice - b.limitPrice;
  return byPrice || compareSeniority(a, b);
}

/** Canonical id order. What capture, invariants and every published list use. */
export function compareOrderIds(a: Order, b: Order): number {
  return compareIds(a.id, b.id);
}

/**
 * Do these two limits cross, and at what price?
 *
 * The execution price is **the more senior order's limit**, which is the classic
 * maker's-price rule stated for a market where nothing "arrives first": whichever
 * order was resting longer set the price, and the aggressor takes it. Three
 * properties follow, and all three are asserted:
 *
 *   1. Neither limit is ever violated. If `bid.limit >= ask.limit`, then both
 *      `ask.limit` and `bid.limit` sit inside `[ask.limit, bid.limit]`, so
 *      executing at either satisfies both sides (MKT-5).
 *   2. No rounding, ever. The price is one of the two integers already on the
 *      book, so no midpoint, no division, and no float can enter the value path.
 *   3. Price improvement accrues to the aggressor, which is what makes resting
 *      liquidity worth supplying (M2: "limit-price competition and order priority
 *      reward conviction and supplied liquidity").
 *
 * Returns `null` when the two do not cross.
 */
export function crossPrice(bid: Order, ask: Order): Minor | null {
  if (bid.side !== 'BID' || ask.side !== 'ASK') {
    throw new RangeError('market: a cross is one BID against one ASK');
  }
  if (bid.limitPrice < ask.limitPrice) return null;

  // ── A15: WHEN NEITHER SIDE IS THE MAKER, NO NAME MAY SET THE PRICE ────────
  //
  // The maker's-price rule is right when one order genuinely rested longer: it pays for
  // presence, and price improvement accrues to the aggressor. But when BOTH orders
  // entered the book on the same tick, neither rested, and `compareSeniority` then falls
  // through to `principal_id` — so the handle decided the price. Reproduced:
  //
  //     buyer=aaron seller=zoe   -> fill 100      (bid limit 100, ask limit 95)
  //     buyer=zoe   seller=aaron -> fill  95
  //
  // Same orders, same tick; only the names differ and 5 per unit moves. The senior party
  // trades at its own limit, so the lexicographically LATER handle always takes the
  // improvement — and enrolment is free (A15), so the handle is choosable. A15 forbids a
  // gate priced in identities without qualification, and this was one worth real money on
  // every same-tick cross. (A4 was never affected: speed still buys nothing.)
  //
  // So a same-tick cross splits the spread instead. No name is consulted, which removes
  // the advantage rather than obscuring it, and it matches what a same-tick pair actually
  // is: two aggressors and no maker to pay.
  //
  // Rounding is toward the ASK — stated here because an integer midpoint of an odd spread
  // has to favour someone, and the tie must be decided by a published rule rather than by
  // whoever happens to be sorted first. Truncation of a non-negative sum is exact.
  if (compareSeniority(bid, ask) === 0 || bid.placedTick === ask.placedTick) {
    return minor(Math.trunc((bid.limitPrice + ask.limitPrice) / 2));
  }
  return compareSeniority(bid, ask) < 0 ? bid.limitPrice : ask.limitPrice;
}
