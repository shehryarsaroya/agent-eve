/**
 * The **MARKETS phase** — the one place in the tick where a book clears.
 *
 * SPEC §15.2's pipeline runs `… MOVE -> PREDATE -> **MARKETS** -> PRODUCE …`, and
 * both adjacencies are rules rather than tidiness: MOVE first, so a hand that
 * arrived this tick can trade at the venue it arrived at; PRODUCE after, because
 * §15.2's clear-before-produce means a job may not buy at market inside its own
 * resolution.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE MARKET IS CLOSED ON THE SETTLEMENT TICK, AND THAT IS A CORRECTNESS RULE.**
 *
 * §5.1's hard freeze is enforced by `reckoning/driver.ts:VERIFY_INPUTS`, which
 * re-reads every payer's **free balance** between the freeze and the settlement and
 * halts on any difference *in either direction*. MARKETS runs at phase 5 and the
 * settlement at phase 9 of the same tick, so a fill on the settlement tick would
 * move a figure the settlement was computed from — and pause a healthy world on the
 * one night that has an audience (A14), for a trade nobody did anything wrong in.
 *
 * So the pass is skipped whole on that tick: no match, no expiry, no closure, no
 * release. Escrow locked before the freeze stays locked through it, which is
 * exactly what the frozen reading already accounts for. The `trade` verb is refused
 * across the same window by the runtime's existing `committing` guard, so the two
 * halves close the same door from both sides.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## What a fill actually is
 *
 * Two ledger movements and nothing else: currency from the buyer's STORES to the
 * seller's, and goods from the seller's market escrow to the buyer's STORES **at
 * the venue** (M1's exact-venue settlement — the cargo lands where the trade
 * happened and somebody still has to move it). Both are ordinary `posting` pairs
 * summing to zero, so INV-1 and INV-2 cover the market for free and the market
 * creates and destroys nothing.
 *
 * The two legs are guaranteed to succeed before either is attempted: the matcher's
 * ceilings mean the goods are in escrow and the lock covers the payment at the
 * bid's own limit, and drawing the lock frees at least the payment because
 * `qty x price <= qty x limit`. A throw here is therefore *our* bug, and it is
 * handled the only safe way — the fill is recorded with what actually moved and
 * MKT-4 reconciles it against the posting log at ASSERT. A half-applied fill halts
 * the tick and rolls back; a fill where nothing moved is a logged fault and no
 * more, because halting for that would be a weapon (AGT-X9).
 */

import type { GoodId, PrincipalId } from '../core/types.js';
import { qty, type Qty } from '../core/units.js';
import type { EventId } from '../core/types.js';
import { Ledger, storesAccount } from '../ledger/index.js';
import { MarketBook, type ClosedOrder, type Fill } from './book.js';
import { matchBook, type PlannedFill } from './match.js';
import { multiplyPrice, remainingOf, type Order, type OrderId, type VenueId } from './order.js';
import { cashLegEvent, deliverGoods, drawLock, escrowedGoods } from './escrow.js';
import { releaseEscrow } from './place.js';

export interface ClearInputs {
  readonly book: MarketBook;
  readonly ledger: Ledger;
  readonly tick: number;
  /** §5.1's hard freeze. True on the tick a Reckoning settles; the pass is skipped. */
  readonly isSettlementTick: boolean;
  /** Charge the tick's step budget, so an oversized book is bounded like everything else. */
  step(n: number): void;
  /** Something went wrong where halting would have been worse. Bounded and printed. */
  fault(message: string): void;
}

export interface ClearReport {
  readonly fills: readonly Fill[];
  readonly closed: readonly ClosedOrder[];
  /** Orders the backstop cancelled because their own principal was the other side. */
  readonly selfCrossed: readonly OrderId[];
  /** True when the settlement froze the market. Reported, never silent. */
  readonly skipped: boolean;
}

/** The event id a fill's postings are minted under. One home; MKT-4 rebuilds it. */
export function fillIdFor(tick: number, bid: OrderId, ask: OrderId): string {
  return `mkt.fill:${String(tick)}:${bid}:${ask}`;
}

export function clearMarkets(input: ClearInputs): ClearReport {
  const { book, ledger, tick } = input;
  if (input.isSettlementTick) {
    return { fills: [], closed: [], selfCrossed: [], skipped: true };
  }

  const fills: Fill[] = [];
  const closed: ClosedOrder[] = [];
  const selfCrossed: OrderId[] = [];

  for (const ref of book.books()) {
    input.step(1);
    const orders = book.openIn(ref.venue, ref.good);
    const plan = matchBook({
      tick,
      venue: ref.venue,
      good: ref.good,
      orders,
      cashLockOf: (order) => lockOf(ledger, order),
      escrowedGoodsOf: (principal) => escrowedGoods(ledger, principal, ref.good, ref.venue),
    });
    input.step(plan.steps);

    for (const cross of plan.selfCrossed) {
      const order = book.get(cross.cancelled);
      if (order === undefined) continue;
      input.fault(
        `order ${cross.cancelled} reached the matcher crossing its own principal's ${cross.against}; ` +
          'placement should have refused it. Cancelled newest-first so the published spread stays honest.',
      );
      releaseEscrow(ledger, order, tick, `mkt.selfcross:${order.id}`);
      closed.push(book.close(order.id, 'CANCELLED', tick));
      selfCrossed.push(order.id);
    }

    for (const planned of plan.fills) {
      input.step(1);
      const fill = applyFill(input, planned);
      if (fill !== null) fills.push(fill);
    }
  }

  // ── close what is finished ────────────────────────────────────────────────
  // Fully-filled orders first, then expiries. Both release through one door
  // (`releaseEscrow`), so "a cancelled order releases exactly what it locked" and
  // "an expired order releases exactly what it locked" cannot drift apart.
  for (const order of book.open()) {
    if (remainingOf(order) > 0) continue;
    input.step(1);
    releaseEscrow(ledger, order, tick, `mkt.filled:${order.id}`);
    closed.push(book.close(order.id, 'FILLED', tick));
  }
  for (const order of book.open()) {
    if (order.expiresTick > tick) continue;
    input.step(1);
    releaseEscrow(ledger, order, tick, `mkt.expire:${order.id}`);
    closed.push(book.close(order.id, 'EXPIRED', tick));
  }

  return { fills, closed, selfCrossed, skipped: false };
}

function lockOf(ledger: Ledger, order: Order): ReturnType<typeof multiplyPrice> {
  const id = order.encumbranceId;
  if (id === null || !ledger.encumbrances.isOpen(id)) return multiplyPrice(order.limitPrice, qty(0));
  const row = ledger.encumbrances.get(id);
  return row === undefined ? multiplyPrice(order.limitPrice, qty(0)) : row.amountMinor;
}

/**
 * Move one planned trade, or explain why nothing moved.
 *
 * Returns the fill actually executed — which may be smaller than planned if the
 * escrow yielded less than the matcher was told it held — or `null` when nothing
 * moved at all.
 */
function applyFill(input: ClearInputs, planned: PlannedFill): Fill | null {
  const { book, ledger, tick } = input;
  const bid = book.get(planned.bid);
  const ask = book.get(planned.ask);
  if (bid === undefined || ask === undefined) {
    input.fault(`fill plan named ${planned.bid}/${planned.ask}, one of which is no longer on the book`);
    return null;
  }
  const base = fillIdFor(tick, planned.bid, planned.ask);

  // ── the physical leg, first, because it is the one that can come up short ──
  let moved: Qty = qty(0);
  let legs = 0;
  try {
    const handed = deliverGoods({
      ledger,
      seller: planned.seller,
      buyer: planned.buyer,
      good: planned.good,
      venue: planned.venue,
      amount: planned.qty,
      tick,
      eventBase: base,
    });
    moved = handed.moved;
    legs = handed.legs;
  } catch (error: unknown) {
    input.fault(`the goods leg of ${base} refused: ${describe(error)}`);
    return null;
  }
  if (moved <= 0) {
    input.fault(`${base} moved no goods; the seller's escrow was empty at ${planned.venue}`);
    return null;
  }

  const fill: Fill = {
    id: base,
    tick,
    venue: planned.venue,
    good: planned.good,
    unitPrice: planned.unitPrice,
    qty: moved,
    buyer: planned.buyer,
    seller: planned.seller,
    bid: planned.bid,
    ask: planned.ask,
    goodsLegs: legs,
  };
  // Recorded BEFORE the currency leg on purpose. If the payment then fails, MKT-4
  // finds a fill whose cash postings do not exist, halts the tick and rolls the
  // whole thing back — which is the correct answer to goods that moved and money
  // that did not. Recording afterwards would leave that tear invisible.
  book.recordFill(fill);

  try {
    payFor(ledger, fill, bid, tick);
  } catch (error: unknown) {
    input.fault(`the currency leg of ${base} refused: ${describe(error)} — MKT-4 will halt this tick`);
    return fill;
  }

  book.fill(bid.id, moved);
  book.fill(ask.id, moved);
  return fill;
}

/**
 * The currency leg: draw the bid's lock down at **its own limit**, then pay at the
 * **fill price**.
 *
 * The gap between them is the buyer's price improvement, and releasing it rather
 * than holding it is what makes "escrow is the maximum it could spend" literally
 * true. Drawing first is what makes the payment affordable: the locked cash is not
 * free until the lock yields it.
 */
function payFor(ledger: Ledger, fill: Fill, bid: Order, tick: number): void {
  const atLimit = multiplyPrice(bid.limitPrice, fill.qty);
  const payment = multiplyPrice(fill.unitPrice, fill.qty);
  if (bid.encumbranceId !== null) drawLock(ledger, bid.encumbranceId, atLimit);
  ledger.transferCurrency({
    eventId: cashLegEvent(fill.id) as EventId,
    tick,
    from: storesAccount(fill.buyer),
    to: storesAccount(fill.seller),
    amount: payment,
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? (error.message.split('\n')[0] ?? 'unknown') : 'unknown';
}

/** Books that would clear this tick, for the step estimate. Cheap and exact. */
export function booksToClear(book: MarketBook): readonly { venue: VenueId; good: GoodId }[] {
  return book.books();
}

/** Principals holding an open order. Used by the observation and the invariants. */
export function tradersIn(book: MarketBook): readonly PrincipalId[] {
  const seen = new Set<PrincipalId>();
  for (const order of book.open()) seen.add(order.principal);
  return [...seen].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
