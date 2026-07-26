/**
 * The matcher — pure, total, and the one place a fill is decided.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THIS FUNCTION TOUCHES NOTHING.** It reads a frozen list of orders and two
 * escrow ceilings and returns a *plan*. It does not move value, does not mutate an
 * order, does not emit an event and cannot throw on agent input.
 *
 * That is not tidiness. It is what makes the A4 claim testable: the determinism
 * suite hands {@link matchBook} the same set of orders in every permutation and
 * compares the plans byte-for-byte. A matcher that also settled would have to be
 * tested through a ledger, and "identical fills under shuffled arrival" would
 * become an assertion about a whole engine rather than about the rule.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## The pass, in one paragraph
 *
 * Both sides are sorted by {@link comparePriority} — price, then seniority, never
 * arrival. While the best bid crosses the best ask, they trade at the **more senior
 * order's limit** ({@link crossPrice}) for the smallest of: what each still has
 * working, what the bid's cash lock still backs, and what the seller actually has
 * in escrow. Anything short simply does not fill; nothing is ever borrowed.
 *
 * ## Why escrow ceilings are inputs rather than assumptions
 *
 * At placement, escrow covers the order exactly — an order that cannot be escrowed
 * is refused outright, never partially placed. But escrow is a *claim on a thing,
 * not armour over it* (PROP-L3): an audit seizure can drain a locked account
 * between two ticks, and the lock yields. If this matcher assumed the invariant it
 * was placed under, a raided buyer would either fill an order it could not pay for
 * or halt the world for a legitimate act of predation — and a false halt is the
 * same class of failure as a false default (SPEC §15.4).
 *
 * So the ceilings are read live, every pass, and a shortfall is expressed as a
 * smaller fill. That is also why the standing invariants are written as
 * "escrow never *exceeds* the order" rather than "escrow always covers it": the
 * covering half is enforced at the door, where a refusal is still a hint.
 *
 * ## Self-matching
 *
 * One principal may never be both sides of a print. `ledger/valuation.ts` names
 * this as the game's highest-value exploit — "self-match two of your own principals
 * to print a 50x mark" — and rejects such prints from the mark; the market refuses
 * to *make* them in the first place. The door is `book.ts`'s placement check; this
 * is the backstop, and it cancels the newer of the two rather than stalling the
 * pass, because a permanently crossed book publishes a spread that is a lie.
 */

import type { GoodId, PrincipalId } from '../core/types.js';
import { minor, qty, type Minor, type Qty } from '../core/units.js';
import {
  comparePriority,
  compareSeniority,
  crossPrice,
  remainingOf,
  type Order,
  type OrderId,
  type VenueId,
} from './order.js';

/** One intended trade. Nothing has moved when this is produced. */
export interface PlannedFill {
  readonly venue: VenueId;
  readonly good: GoodId;
  readonly bid: OrderId;
  readonly ask: OrderId;
  readonly buyer: PrincipalId;
  readonly seller: PrincipalId;
  /** Per unit. Always one of the two limits already on the book — never a midpoint. */
  readonly unitPrice: Minor;
  readonly qty: Qty;
}

/** An order the pass refuses to let its own principal trade against. */
export interface SelfCross {
  readonly cancelled: OrderId;
  readonly against: OrderId;
}

export interface MatchPlan {
  readonly fills: readonly PlannedFill[];
  readonly selfCrossed: readonly SelfCross[];
  /** Loop iterations, for the tick's step budget. Never unbounded. */
  readonly steps: number;
}

export interface MatchInputs {
  readonly tick: number;
  readonly venue: VenueId;
  readonly good: GoodId;
  /** Every OPEN order on this one book. Filtered for matchability here, not by the caller. */
  readonly orders: readonly Order[];
  /** Currency actually locked behind this BID **right now**. */
  cashLockOf(order: Order): Minor;
  /** Goods this principal actually has escrowed for this venue and good **right now**. */
  escrowedGoodsOf(principal: PrincipalId): Qty;
}

/**
 * A hard ceiling on iterations, so a bug in the advance logic is a bounded fault
 * rather than a hung tick. Two per order is generous: every iteration either
 * advances a side or zeroes a remainder.
 */
const ITERATION_SLACK = 4;

/**
 * Is this order eligible for the pass at `tick`?
 *
 * `placedTick < tick` is §15.2 as a predicate: **orders submitted at T match at
 * T+1**, against the book as it stood in the frozen snapshot. An order matching in
 * the tick it was submitted would be a within-tick action reacting to another
 * within-tick action, which is the one thing the phase order exists to forbid.
 */
export function isMatchable(order: Order, tick: number): boolean {
  return order.state === 'OPEN' && order.placedTick < tick && order.expiresTick >= tick && remainingOf(order) > 0;
}

export function matchBook(input: MatchInputs): MatchPlan {
  const bids = input.orders
    .filter((o) => o.side === 'BID' && isMatchable(o, input.tick))
    .sort(comparePriority);
  const asks = input.orders
    .filter((o) => o.side === 'ASK' && isMatchable(o, input.tick))
    .sort(comparePriority);

  const fills: PlannedFill[] = [];
  const selfCrossed: SelfCross[] = [];
  if (bids.length === 0 || asks.length === 0) {
    return { fills, selfCrossed, steps: 1 };
  }

  /** Working quantity, by order. Local to the pass; the book is untouched. */
  const left = new Map<OrderId, number>();
  for (const o of [...bids, ...asks]) left.set(o.id, remainingOf(o));
  /** Cash still locked behind each bid, drawn down at each bid's own LIMIT. */
  const cash = new Map<OrderId, number>();
  for (const b of bids) cash.set(b.id, input.cashLockOf(b));
  /**
   * Goods still in escrow, **by principal** rather than by order.
   *
   * A seller's asks on one book all draw the same escrowed pool (see `escrow.ts`),
   * so the budget has to be shared or two of one seller's asks would each believe
   * they owned the whole pile and the second fill would find nothing behind it.
   */
  const goods = new Map<PrincipalId, number>();
  for (const a of asks) {
    if (!goods.has(a.principal)) goods.set(a.principal, input.escrowedGoodsOf(a.principal));
  }

  let i = 0;
  let j = 0;
  let steps = 0;
  const cap = (bids.length + asks.length) * ITERATION_SLACK + 4;

  while (i < bids.length && j < asks.length) {
    steps += 1;
    if (steps > cap) break;
    const bid = bids[i];
    const ask = asks[j];
    if (bid === undefined || ask === undefined) break;

    const bidLeft = left.get(bid.id) ?? 0;
    if (bidLeft <= 0) {
      i += 1;
      continue;
    }
    const askLeft = left.get(ask.id) ?? 0;
    if (askLeft <= 0) {
      j += 1;
      continue;
    }

    const price = crossPrice(bid, ask);
    // The book no longer crosses. Everything below this pair is further away on
    // both sides, so the pass is finished — this is the loop's only clean exit.
    if (price === null) break;

    if (bid.principal === ask.principal) {
      // The backstop, not the door. `book.ts` refuses a self-crossing order at
      // placement; if one reaches here it is our bug, and the newer of the two
      // yields so the published spread stops lying.
      const newerIsBid = compareSeniority(bid, ask) > 0;
      selfCrossed.push(
        newerIsBid ? { cancelled: bid.id, against: ask.id } : { cancelled: ask.id, against: bid.id },
      );
      left.set(newerIsBid ? bid.id : ask.id, 0);
      if (newerIsBid) i += 1;
      else j += 1;
      continue;
    }

    // Escrow ceilings. A bid's lock is sized at its own LIMIT, so that is the
    // divisor: it answers "how many units does the locked cash still back", which
    // is the only question a fill at or below the limit can need.
    const lock = cash.get(bid.id) ?? 0;
    const affordable = Math.floor(lock / bid.limitPrice);
    const deliverable = goods.get(ask.principal) ?? 0;
    const amount = Math.min(bidLeft, askLeft, affordable, deliverable);

    if (amount <= 0) {
      // One side cannot perform. Advance the side that is short so the pass still
      // terminates; the short order stays on the book, uncrossed and honest.
      if (affordable <= 0) i += 1;
      else j += 1;
      continue;
    }

    fills.push({
      venue: input.venue,
      good: input.good,
      bid: bid.id,
      ask: ask.id,
      buyer: bid.principal,
      seller: ask.principal,
      unitPrice: price,
      qty: qty(amount),
    });
    left.set(bid.id, bidLeft - amount);
    left.set(ask.id, askLeft - amount);
    cash.set(bid.id, lock - amount * bid.limitPrice);
    goods.set(ask.principal, deliverable - amount);
  }

  return { fills, selfCrossed, steps };
}

/**
 * The best bid and best ask on a frozen book, and the spread between them.
 *
 * Read off the same priority order the matcher uses, so the number published to
 * agents and viewers is the number the next pass will trade at. Two homes for
 * "what is the best price" is exactly the doc/engine disagreement scar #1 names.
 */
export function topOfBook(orders: readonly Order[]): {
  readonly bestBid: Minor | null;
  readonly bestAsk: Minor | null;
  readonly spread: Minor | null;
} {
  let bestBid: number | null = null;
  let bestAsk: number | null = null;
  for (const o of orders) {
    if (o.state !== 'OPEN' || remainingOf(o) <= 0) continue;
    if (o.side === 'BID') bestBid = bestBid === null ? o.limitPrice : Math.max(bestBid, o.limitPrice);
    else bestAsk = bestAsk === null ? o.limitPrice : Math.min(bestAsk, o.limitPrice);
  }
  return {
    bestBid: bestBid === null ? null : minor(bestBid),
    bestAsk: bestAsk === null ? null : minor(bestAsk),
    spread: bestBid === null || bestAsk === null ? null : minor(bestAsk - bestBid),
  };
}
