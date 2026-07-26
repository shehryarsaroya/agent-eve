/**
 * The **MarketBook** — every live order in the galaxy, one row each, and the
 * bounded record of what they traded.
 *
 * ## Location-bound, always
 *
 * There is no global book. A row carries a `venue` (a system) and a `good`, and
 * `(venue, good)` is the only key anything matches on. That single rule is what
 * creates regional price divergence, hauling, hubs, inventory strategy and the
 * value of a blockade — M1: "a global book or teleporting fulfillment would erase
 * most of the galaxy." Goods settle exactly where the trade happened (M1's Phase 0
 * exact-venue settlement), so a fill at Halcyon Reach puts the cargo at Halcyon
 * Reach and somebody still has to move it.
 *
 * ## Why this is a state table
 *
 * Orders decide who owns what. If they sat outside `state_hash`, two worlds with
 * different books would hash the same; if they sat outside the rollback, an aborted
 * tick would leave an order — and its escrow — behind. That is precisely the
 * omission that made `EncumbranceBook` the worst defect in this engine, and it is
 * not repeated here: `stateTable.ts` captures the rows, the fills and the closures,
 * and `test/market/abort.test.ts` proves an aborted tick leaves no order, no fill
 * and no escrow.
 *
 * ## Everything here is bounded
 *
 * Orders are written by strangers, so every collection has a published cap
 * (INV-26, scar #3): open orders per principal, open orders in total, and two rings
 * for the historical halves. The rings are what a bounded `state_hash` requires —
 * an ever-growing array inside a hashed capture is the same bug as an ever-growing
 * event array in memory.
 */

import type { GoodId, PrincipalId } from '../core/types.js';
import { qty, type Minor, type Qty } from '../core/units.js';
import { compareIds, type Print } from '../ledger/index.js';
import {
  bookKey,
  compareOrderIds,
  remainingOf,
  type Order,
  type OrderId,
  type OrderState,
  type Side,
  type VenueId,
} from './order.js';

export class MarketBookError extends Error {}

/** Open orders one principal may hold at once. A hard door, not a hint. */
export const MAX_OPEN_ORDERS_PER_PRINCIPAL = 24;
/** Open orders in the whole world. The book's own scar-#3 ceiling. */
export const MAX_OPEN_ORDERS = 2_048;
/** Fills retained. Several times the valuation window, so a mark never runs dry. */
export const MAX_FILLS = 2_048;
/** Closed orders retained, so an agent can read what became of its own order. */
export const MAX_CLOSED_ORDERS = 512;

/**
 * One executed trade. **The print** — this is what `ledger/valuation.ts` values a
 * good from, and the only thing that does.
 */
export interface Fill {
  readonly id: string;
  readonly tick: number;
  readonly venue: VenueId;
  readonly good: GoodId;
  readonly unitPrice: Minor;
  readonly qty: Qty;
  readonly buyer: PrincipalId;
  readonly seller: PrincipalId;
  readonly bid: OrderId;
  readonly ask: OrderId;
  /** How many lot legs the goods took. The fill audit rebuilds the event ids from it. */
  readonly goodsLegs: number;
}

/** What became of an order, kept briefly so its owner can read the outcome. */
export interface ClosedOrder {
  readonly id: OrderId;
  readonly principal: PrincipalId;
  readonly venue: VenueId;
  readonly good: GoodId;
  readonly side: Side;
  readonly limitPrice: Minor;
  readonly quantity: Qty;
  readonly filled: Qty;
  readonly state: OrderState;
  readonly closedTick: number;
}

/** A `(venue, good)` pair with at least one open order. */
export interface BookRef {
  readonly venue: VenueId;
  readonly good: GoodId;
}

export class MarketBook {
  private readonly orders = new Map<OrderId, Order>();
  private readonly fillLog: Fill[] = [];
  private readonly closedLog: ClosedOrder[] = [];

  // ── reads ─────────────────────────────────────────────────────────────────

  get(id: OrderId): Order | undefined {
    return this.orders.get(id);
  }

  /** Every order the book holds, in canonical id order. Capture and scans use this. */
  all(): readonly Order[] {
    return [...this.orders.values()].sort(compareOrderIds);
  }

  open(): readonly Order[] {
    return this.all().filter((o) => o.state === 'OPEN');
  }

  /** Is this order live? The answer INV-4 needs about a market lock's obligation. */
  isLive(id: string): boolean {
    return this.orders.get(id as OrderId)?.state === 'OPEN';
  }

  openIn(venue: VenueId, good: GoodId): readonly Order[] {
    return this.open().filter((o) => o.venue === venue && o.good === good);
  }

  openFor(principal: PrincipalId): readonly Order[] {
    return this.open().filter((o) => o.principal === principal);
  }

  openForIn(principal: PrincipalId, venue: VenueId, good: GoodId): readonly Order[] {
    return this.openIn(venue, good).filter((o) => o.principal === principal);
  }

  /**
   * Books with a **resting order**, in canonical `(venue, good)` order.
   *
   * This is the clearing set: a book with nothing on it has nothing to match, and
   * spending a step on it every tick is how a phase's cost stops being proportional
   * to the work it does.
   */
  books(): readonly BookRef[] {
    const seen = new Map<string, BookRef>();
    for (const o of this.open()) seen.set(bookKey(o.venue, o.good), { venue: o.venue, good: o.good });
    return sortRefs(seen);
  }

  /**
   * Books worth **showing**: resting orders *or* a recent print.
   *
   * Wider than {@link books} on purpose. A book whose orders have all filled still
   * has a last price, a reference mark and a history, and dropping it from the
   * observation the moment the depth empties would tell an agent the good has never
   * traded here — which is a false statement about the world made by an absence,
   * and the exact shape A2 forbids ("genuine uncertainty stays uncertain *and
   * sourced*", not silently missing).
   *
   * Bounded by the fills ring, so this cannot grow without limit either.
   */
  visibleBooks(): readonly BookRef[] {
    const seen = new Map<string, BookRef>();
    for (const o of this.open()) seen.set(bookKey(o.venue, o.good), { venue: o.venue, good: o.good });
    for (const f of this.fillLog) seen.set(bookKey(f.venue, f.good), { venue: f.venue, good: f.good });
    return sortRefs(seen);
  }

  /** Goods this principal still owes one book, summed across its open asks. */
  askedQty(principal: PrincipalId, venue: VenueId, good: GoodId): Qty {
    let total = 0;
    for (const o of this.openForIn(principal, venue, good)) {
      if (o.side === 'ASK') total += remainingOf(o);
    }
    return qty(total);
  }

  fills(): readonly Fill[] {
    return this.fillLog;
  }

  fillsAt(tick: number): readonly Fill[] {
    return this.fillLog.filter((f) => f.tick === tick);
  }

  fillsFor(principal: PrincipalId): readonly Fill[] {
    return this.fillLog.filter((f) => f.buyer === principal || f.seller === principal);
  }

  closed(): readonly ClosedOrder[] {
    return this.closedLog;
  }

  closedFor(principal: PrincipalId): readonly ClosedOrder[] {
    return this.closedLog.filter((c) => c.principal === principal);
  }

  /**
   * The fills, as `ledger/valuation.ts` wants them.
   *
   * The market clears; the ledger values. Two homes for "what is this good worth"
   * would be one number with two answers, and the whole point of `valueGood`'s
   * windowed, related-party-filtered median is that there is exactly one.
   */
  prints(): readonly Print[] {
    return this.fillLog.map((f) => ({
      id: f.id,
      good: f.good,
      tick: f.tick,
      unitPrice: f.unitPrice,
      qty: f.qty,
      buyer: f.buyer,
      seller: f.seller,
    }));
  }

  countOpen(): number {
    let n = 0;
    for (const o of this.orders.values()) if (o.state === 'OPEN') n += 1;
    return n;
  }

  countOpenFor(principal: PrincipalId): number {
    let n = 0;
    for (const o of this.orders.values()) if (o.state === 'OPEN' && o.principal === principal) n += 1;
    return n;
  }

  // ── writes ────────────────────────────────────────────────────────────────

  /**
   * Put a new order on the book.
   *
   * Refuses a duplicate id rather than overwriting: ids are minted once from
   * `(principal, tick, client_sequence)` and a collision is a bug in the minter, not
   * a legitimate replacement of a live order and its escrow. Same argument as
   * `GrantBook.add`.
   */
  add(order: Order): void {
    if (this.orders.has(order.id)) {
      throw new MarketBookError(`order ${order.id} already exists; ids are minted once and never reused`);
    }
    if (this.countOpen() >= MAX_OPEN_ORDERS) {
      throw new MarketBookError(`the book is at its published cap of ${String(MAX_OPEN_ORDERS)} open orders`);
    }
    if (this.countOpenFor(order.principal) >= MAX_OPEN_ORDERS_PER_PRINCIPAL) {
      throw new MarketBookError(
        `${order.principal} is at its cap of ${String(MAX_OPEN_ORDERS_PER_PRINCIPAL)} open orders`,
      );
    }
    this.orders.set(order.id, order);
  }

  /** Advance an order's filled quantity. Never past what was ordered (MKT-6). */
  fill(id: OrderId, amount: Qty): void {
    const order = this.require(id);
    if (amount <= 0) throw new MarketBookError(`a fill moves a positive quantity, got ${String(amount)}`);
    if (order.filled + amount > order.quantity) {
      throw new MarketBookError(
        `filling ${order.id} by ${String(amount)} would exceed its ordered ${String(order.quantity)}`,
      );
    }
    order.filled = qty(order.filled + amount);
  }

  /**
   * Close an order and move it to the closure ring.
   *
   * The row leaves the live table in the same step, so `open()` is always exactly
   * the working book and nothing has to remember to filter. The escrow release is
   * the caller's, not this table's — this module holds no ledger handle, which is
   * what keeps it a state table rather than a second economy.
   */
  close(id: OrderId, state: Exclude<OrderState, 'OPEN'>, tick: number): ClosedOrder {
    const order = this.require(id);
    order.state = state;
    const row: ClosedOrder = {
      id: order.id,
      principal: order.principal,
      venue: order.venue,
      good: order.good,
      side: order.side,
      limitPrice: order.limitPrice,
      quantity: order.quantity,
      filled: order.filled,
      state,
      closedTick: tick,
    };
    this.orders.delete(id);
    push(this.closedLog, row, MAX_CLOSED_ORDERS);
    return row;
  }

  recordFill(fill: Fill): void {
    push(this.fillLog, fill, MAX_FILLS);
  }

  require(id: OrderId): Order {
    const order = this.orders.get(id);
    if (order === undefined) throw new MarketBookError(`no order ${id}`);
    return order;
  }

  // ── restore ───────────────────────────────────────────────────────────────

  /**
   * Restore-only. Bypasses {@link add}'s caps on purpose: the capture came from a
   * world that already satisfied them, and re-checking here would turn a legitimate
   * snapshot into a refused restore — the failure mode where a rollback looks like
   * a corruption.
   */
  hydrate(orders: readonly Order[], fills: readonly Fill[], closed: readonly ClosedOrder[]): void {
    this.orders.clear();
    this.fillLog.length = 0;
    this.closedLog.length = 0;
    for (const o of orders) this.orders.set(o.id, o);
    for (const f of fills) this.fillLog.push(f);
    for (const c of closed) this.closedLog.push(c);
  }
}

function sortRefs(seen: ReadonlyMap<string, BookRef>): readonly BookRef[] {
  return [...seen.values()].sort((a, b) => compareIds(a.venue, b.venue) || compareIds(a.good, b.good));
}

/** Append with a hard ceiling: the oldest row falls off, and the array never grows. */
function push<T>(log: T[], row: T, cap: number): void {
  log.push(row);
  if (log.length > cap) log.splice(0, log.length - cap);
}
