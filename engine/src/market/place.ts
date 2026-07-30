/**
 * The `trade` verb's rules — place, modify, cancel.
 *
 * Every refusal here is a *sentence*, never an error: SPEC §12.2's "illegal actions
 * never error: return the violated invariant, the changed fields, the nearest legal
 * affordance". The hint names the exact shortfall — how much cash was free, how
 * many units were sellable at that venue — because an agent can only correct the
 * mistake it is told about, and a market is the surface where a vague refusal costs
 * the most attempts.
 *
 * ## The order of the checks is the design
 *
 *   1. **Shape** — operation, venue, good, side, quantity, price, duration.
 *   2. **Standing to trade there** — a hand present at the venue. §12.1 gives an
 *      agent the *local* book, so an agent that could trade a book it has nobody
 *      standing in would be acting on a `SENSED` fact from orbit.
 *   3. **Self-cross** — one principal may never be both sides of a print.
 *   4. **Caps** — the book's published ceilings.
 *   5. **Escrow, last, and all-or-nothing.** Nothing has moved until here, so
 *      every refusal above leaves the world exactly as it was.
 *
 * ## `modify` is cancel-and-replace, and it loses its place in the queue
 *
 * M4: "a price change or quantity increase is cancel-replace ... and loses age".
 * Repricing therefore costs an action and costs seniority, which is what stops the
 * continuous undercut war M11 describes — in an agent economy that war would be a
 * contest in polling frequency, i.e. A4 violated through the order book.
 */

import { TICKS_PER_RECKONING } from '../core/time.js';
import type { GoodId, PrincipalId } from '../core/types.js';
import { minor, qty, type Minor, type Qty } from '../core/units.js';
import type { Ledger } from '../ledger/index.js';
import { reject, type Rejection, type WorldResult } from '../world/result.js';
import { isPresent } from '../world/hands.js';
import { handsOf, type WorldState } from '../world/state.js';
import { MarketBook, MAX_OPEN_ORDERS, MAX_OPEN_ORDERS_PER_PRINCIPAL } from './book.js';
import {
  crossPrice,
  multiplyPrice,
  orderIdFor,
  remainingOf,
  type Order,
  type OrderId,
  type Side,
  type TimeInForce,
  type VenueId,
} from './order.js';
import {
  escrowGoods,
  freeCash,
  lockOrderCash,
  lockedCash,
  releaseGoods,
  releaseLock,
  sellableGoods,
} from './escrow.js';

/** The three operations. Not a string union type: it is parsed, not declared. */
export const TRADE_OPERATIONS: readonly string[] = ['place', 'modify', 'cancel'];

/** The largest single order. Bounds `price x quantity` far inside the safe range. */
export const MAX_ORDER_QTY = 1_000_000;
/** The highest unit price an order may name. Same reason. */
export const MAX_UNIT_PRICE = 1_000_000_000;
/**
 * The longest a resting order may live, in ticks. One Reckoning's worth
 * *(calibrate)*: long enough that an offline agent's order survives the night it
 * was placed for, short enough that the book cannot silently fill with the orders
 * of principals that stopped playing.
 */
export const MAX_DURATION_TICKS = TICKS_PER_RECKONING;

export interface TradeRequest {
  readonly operation: string;
  readonly venue: VenueId | null;
  readonly good: GoodId | null;
  readonly side: Side | null;
  readonly quantity: number | null;
  readonly limitPrice: number | null;
  readonly durationTicks: number | null;
  readonly timeInForce: TimeInForce | null;
  readonly order: OrderId | null;
}

export interface PlaceContext {
  readonly book: MarketBook;
  readonly ledger: Ledger;
  readonly world: WorldState;
  readonly principal: PrincipalId;
  readonly tick: number;
  /** The agent's own `client_sequence`. Mints the id; never orders it against others. */
  readonly clientSequence: number;
}

/** Everything an accepted order needs, once every rule has said yes. */
interface OrderPlan {
  readonly id: OrderId;
  readonly venue: VenueId;
  readonly good: GoodId;
  readonly side: Side;
  readonly quantity: Qty;
  readonly limitPrice: Minor;
  readonly timeInForce: TimeInForce;
  readonly expiresTick: number;
  /** What a BID must lock. Zero on an ASK, which escrows goods instead. */
  readonly cashRequired: Minor;
}

/**
 * Every rule an order must satisfy, in **one** place, and nothing moves here.
 *
 * `replacing` is the order a `modify` is about to cancel, and it changes three
 * answers: that order is out of the self-cross scan and out of the caps, and the
 * escrow it is about to give back is credited to the affordability check, because
 * once the cancel lands that value really is free.
 *
 * Splitting this out is not tidiness. `modify` is cancel-and-replace, so a
 * replacement refused *after* the cancel would destroy a live order while telling
 * its owner the act was refused — and §12.2's contract is the opposite: an illegal
 * action returns the violated invariant and **changes nothing**. Checking the
 * replacement here, before anything is cancelled, is what makes that true. Two
 * copies of these rules would drift, and a `place` and a `modify` that disagree
 * about what is legal is scar #1 with an order book attached.
 */
function planOrder(ctx: PlaceContext, req: TradeRequest, replacing: Order | null): WorldResult<OrderPlan> {
  const shape = checkShape(req);
  if (shape !== null) return shape;
  // `checkShape` has established all five, but the compiler cannot see through it.
  const venue = req.venue;
  const good = req.good;
  const side = req.side;
  const amount = req.quantity;
  const price = req.limitPrice;
  if (venue === null || good === null || side === null || amount === null || price === null) {
    return reject('A2', 'trade needs venue, good, side, quantity and limit_price.');
  }

  const standing = checkVenue(ctx, venue, good);
  if (standing !== null) return standing;

  const timeInForce: TimeInForce = req.timeInForce ?? 'GTC';
  const durationTicks = timeInForce === 'IOC' ? 1 : (req.durationTicks ?? MAX_DURATION_TICKS);
  if (!Number.isSafeInteger(durationTicks) || durationTicks < 1 || durationTicks > MAX_DURATION_TICKS) {
    return reject(
      'A2',
      `duration_ticks must be 1..${String(MAX_DURATION_TICKS)} ticks, got ${String(req.durationTicks)}. ` +
        'An IOC order ignores it: it gets exactly one matching pass.',
    );
  }

  const selfCross = checkSelfCross(ctx, venue, good, side, minor(price), replacing);
  if (selfCross !== null) return selfCross;

  // A replacement frees a slot before it takes one, so its own row does not count.
  const held = replacing === null ? 0 : 1;
  if (ctx.book.countOpen() - held >= MAX_OPEN_ORDERS) {
    return reject(
      'INV-26',
      `the book is full at its published cap of ${String(MAX_OPEN_ORDERS)} open orders. Cancel one, or ` +
        'trade at a venue with room.',
    );
  }
  if (ctx.book.countOpenFor(ctx.principal) - held >= MAX_OPEN_ORDERS_PER_PRINCIPAL) {
    return reject(
      'INV-26',
      `you already hold ${String(MAX_OPEN_ORDERS_PER_PRINCIPAL)} open orders, which is the cap. Cancel one ` +
        'before placing another.',
    );
  }

  const id = orderIdFor(ctx.principal, ctx.tick, ctx.clientSequence);
  const collides = ctx.book.get(id);
  if (collides !== undefined && collides.id !== replacing?.id) {
    return reject(
      'A2',
      `you have already placed an order this tick under client_sequence ${String(ctx.clientSequence)}. ` +
        'Give each action in a batch its own client_sequence.',
    );
  }

  const wanted = qty(amount);
  const unitPrice = minor(price);
  // `escrowFor` is exactly this ternary and had no caller. One home for "what a fresh BID must
  // escrow", so the gate below and anything that previews it cannot disagree.
  const required = escrowFor(side, unitPrice, wanted);

  if (side === 'BID') {
    // What the cancel is about to hand back is spendable by the replacement.
    const credit = replacing !== null && replacing.side === 'BID' ? lockedCash(ctx.ledger, replacing.encumbranceId) : 0;
    const free = minor(freeCash(ctx.ledger, ctx.principal) + credit);
    if (free < required) {
      return reject(
        'A7',
        `a buy order escrows the maximum it could spend: ${String(wanted)} x ${String(unitPrice)} = ` +
          `${String(required)}, and you have ${String(free)} free. An order that cannot be escrowed is ` +
          'refused rather than half-placed — unescrowed depth is fake depth. Lower the quantity or the price.',
      );
    }
  } else {
    // Only an ASK on the SAME book gives goods back where this one needs them:
    // `sellableGoods` is per `(good, venue)`, and a reprice that also moves venue
    // returns its units to the old one.
    //
    // ── A PRE-EXISTING OVERSTATEMENT, NAMED BECAUSE 20 MAKES IT REACHABLE ─────
    //
    // `sellable + credit` is the post-cancel answer only while the holding is at or above the
    // withheld floor. `sellableGoods` is `max(0, availableHeld − remainingGoods)`, and
    // `max(0, h + c − r) = max(0, h − r) + c` fails by `min(c, r − h)` when `h < r` — which a
    // resting ASK cannot create (escrow requires `h ≥ r`) but a later PLEDGE, `haul` or seizure
    // can, since those remove units from `availableHeld` without charging the allotment. The
    // consequence is bounded: `checkReplacement` says yes, the cancel lands, and `placeOrder`
    // then refuses with `escrowGoods` having moved nothing — so the agent loses a resting order
    // rather than getting a half-placed one.
    //
    // **Pre-existing and strictly NARROWED by `RULES_VERSION` 20**, which is why it is recorded
    // here rather than fixed here: under the old static floor `h < 50,000` was the common case
    // (123 of 576 measured observations), so the same arithmetic overstated far more often. What
    // 20 changes is that a resting `ration` ASK is possible at all, which is what makes the
    // reprice path reachable for this good for the first time. The honest fix is for the credit
    // to be `min(credit, ...)` against a recomputed post-cancel floor, and it belongs in a change
    // that can measure the reprice path rather than in one that measures the floor.
    const credit =
      replacing !== null && replacing.side === 'ASK' && replacing.good === good && replacing.venue === venue
        ? remainingOf(replacing)
        : 0;
    const have = qty(sellableGoods(ctx.ledger, ctx.principal, good, venue) + credit);
    if (have < wanted) {
      return reject(
        'A7',
        `a sell order escrows the goods: you asked to sell ${String(wanted)} of ${good} at ${venue} and hold ` +
          `${String(have)} there that is neither pledged nor in transit. An order that cannot be escrowed is ` +
          'refused rather than half-placed.',
      );
    }
  }

  return {
    ok: true,
    value: {
      id,
      venue,
      good,
      side,
      quantity: wanted,
      limitPrice: unitPrice,
      timeInForce,
      expiresTick: ctx.tick + durationTicks,
      cashRequired: required,
    },
  };
}

/**
 * Would this replacement be accepted, if `previous` were cancelled first?
 *
 * Returns the refusal a `modify` must give **before** it cancels anything, or
 * `null` when the replacement will land. See {@link planOrder} on why this exists:
 * a refusal that has already destroyed a resting order is not a refusal.
 *
 * `null` for an order that is missing, closed, or somebody else's — those are
 * {@link cancelOrder}'s sentences, and duplicating them here would be two answers
 * to one question.
 */
export function checkReplacement(
  ctx: PlaceContext,
  previous: Order | undefined,
  req: TradeRequest,
): Rejection | null {
  if (previous === undefined || previous.principal !== ctx.principal || previous.state !== 'OPEN') return null;
  const planned = planOrder(ctx, req, previous);
  return planned.ok ? null : planned;
}

/**
 * **Would this order be refused, and in what words?** Nothing moves.
 *
 * The observation layer's read-only door onto {@link planOrder} — the analogue of
 * `Runtime.demandRefusalFor`, and it exists for the same reason. `header.withheld`
 * has to say why no `trade` is offered, and the only honest source for that sentence
 * is the gate itself: a paraphrase in the affordance layer is a second home for a
 * rule (HARD RULE 4), and scar #1 is a whole game shipped on two homes for one rule
 * that read correctly apart.
 *
 * `null` means the order would be accepted. Every non-null answer carries the same
 * `hint` an agent would have been handed had it spent an action finding out —
 * which is the difference between a legible menu and a wiki with extra steps (A2).
 */
export function tradeRefusalFor(ctx: PlaceContext, req: TradeRequest): Rejection | null {
  const planned = planOrder(ctx, req, null);
  return planned.ok ? null : planned;
}

/**
 * Place an order, fully escrowed, or refuse.
 *
 * The returned order is already on the book and already escrowed. It is **not yet
 * matchable** — it carries `placedTick = tick` and the matcher only looks at orders
 * placed strictly earlier, which is §15.2's rule that a within-tick action never
 * reacts to another within-tick action.
 */
export function placeOrder(ctx: PlaceContext, req: TradeRequest): WorldResult<Order> {
  const planned = planOrder(ctx, req, null);
  if (!planned.ok) return planned;
  const plan = planned.value;

  // ── escrow, and nothing has moved before this point ──────────────────────
  let encumbranceId: string | null = null;

  if (plan.side === 'BID') {
    encumbranceId = lockOrderCash({
      ledger: ctx.ledger,
      principal: ctx.principal,
      order: plan.id,
      amount: plan.cashRequired,
      tick: ctx.tick,
    });
    if (encumbranceId === null) {
      return reject('A7', `the escrow of ${String(plan.cashRequired)} could not be locked, so no order was placed.`);
    }
  } else {
    const escrowed = escrowGoods({
      ledger: ctx.ledger,
      principal: ctx.principal,
      good: plan.good,
      venue: plan.venue,
      amount: plan.quantity,
      tick: ctx.tick,
      order: plan.id,
    });
    if (!escrowed) {
      return reject(
        'A7',
        `the ${String(plan.quantity)} of ${plan.good} could not be escrowed, so no order was placed.`,
      );
    }
  }

  const order: Order = {
    id: plan.id,
    principal: ctx.principal,
    venue: plan.venue,
    good: plan.good,
    side: plan.side,
    limitPrice: plan.limitPrice,
    quantity: plan.quantity,
    filled: qty(0),
    timeInForce: plan.timeInForce,
    placedTick: ctx.tick,
    expiresTick: plan.expiresTick,
    clientSequence: ctx.clientSequence,
    state: 'OPEN',
    encumbranceId,
  };
  try {
    ctx.book.add(order);
  } catch {
    // The caps were checked above, so this is our bug. Undo the escrow rather than
    // leave value locked behind an order that does not exist.
    unwind(ctx, order);
    return reject('INV-26', 'the book refused the order, so its escrow was released and nothing was placed.');
  }
  return { ok: true, value: order };
}

/**
 * Cancel an open order and release **exactly** what it locked.
 *
 * A BID's lock is released whole; an ASK's remaining escrowed goods go back to
 * STORES at the same venue. A partly-filled order returns only what is left — the
 * filled part is already the counterparty's and was never this order's to give back.
 */
export function cancelOrder(ctx: PlaceContext, id: OrderId): WorldResult<Order> {
  const order = ctx.book.get(id);
  if (order === undefined) {
    return reject(
      'A2',
      `there is no open order ${id}. An order that filled, expired or was already cancelled is gone from ` +
        'the book; look in market.recent for what became of it.',
    );
  }
  if (order.principal !== ctx.principal) {
    return reject('A2', `order ${id} is not yours. You may only cancel your own orders.`);
  }
  if (order.state !== 'OPEN') {
    return reject('A2', `order ${id} is already ${order.state.toLowerCase()}.`);
  }
  releaseEscrow(ctx.ledger, order, ctx.tick, `mkt.cancel:${order.id}`);
  ctx.book.close(order.id, 'CANCELLED', ctx.tick);
  return { ok: true, value: order };
}

/**
 * Release whatever an order still holds. The single home of "give it back".
 *
 * Called by cancel, by expiry, by the self-cross backstop and by the fill path when
 * an order closes — four callers, one rule, so a release can never be a different
 * amount depending on which door closed the order.
 */
export function releaseEscrow(ledger: Ledger, order: Order, tick: number, label: string): void {
  if (order.side === 'BID') {
    releaseLock(ledger, order.encumbranceId, tick);
    return;
  }
  const left = remainingOf(order);
  if (left <= 0) return;
  releaseGoods({
    ledger,
    principal: order.principal,
    good: order.good,
    venue: order.venue,
    amount: left,
    tick,
    label,
  });
}

function unwind(ctx: PlaceContext, order: Order): void {
  releaseEscrow(ctx.ledger, order, ctx.tick, `mkt.unwind:${order.id}`);
}

// ── the checks ──────────────────────────────────────────────────────────────

function checkShape(req: TradeRequest): Rejection | null {
  if (req.venue === null) {
    return reject('A2', 'trade needs a venue: {"venue": "<system>"}. A book is location-bound.');
  }
  if (req.good === null) {
    return reject('A2', 'trade needs a good: {"good": "<good id>"}.');
  }
  if (req.side === null) {
    return reject('A2', 'trade needs a side: "BID" to buy or "ASK" to sell.');
  }
  if (req.quantity === null || req.quantity < 1 || req.quantity > MAX_ORDER_QTY) {
    return reject(
      'A2',
      `quantity must be a whole number from 1 to ${String(MAX_ORDER_QTY)}, got ${String(req.quantity)}.`,
    );
  }
  if (req.limitPrice === null || req.limitPrice < 1 || req.limitPrice > MAX_UNIT_PRICE) {
    return reject(
      'A2',
      `limit_price is per unit, in minor units, and must be 1..${String(MAX_UNIT_PRICE)}, got ` +
        `${String(req.limitPrice)}. There is no market order in this game: every order names its limit, ` +
        'and an IOC limit order is the only way to take liquidity.',
    );
  }
  return null;
}

function checkVenue(ctx: PlaceContext, venue: VenueId, good: GoodId): Rejection | null {
  if (!ctx.world.map.systems.has(venue)) {
    return reject('A2', `there is no system ${venue}, so there is no book there.`);
  }
  const present = handsOf(ctx.world, ctx.principal).some(
    (hand) => isPresent(hand, ctx.tick) && hand.location === venue,
  );
  if (!present) {
    return reject(
      'A2',
      `you have no hand standing at ${venue}, and a book is local: §12.1 gives you the local book only, so ` +
        'trading one you are not present at would be acting on a sensed fact from orbit. Move a hand there first.',
    );
  }
  if (!ctx.ledger.goodsSupply().has(good)) {
    return reject(
      'A2',
      `nothing called ${good} has ever been produced, so there is no book for it. Trade a good that exists.`,
    );
  }
  return null;
}

/**
 * One principal may never be both sides of a print.
 *
 * `ledger/valuation.ts` rejects self-matched prints from the mark and calls the
 * attack the game's most dangerous exploit; this refuses to create one. Checked
 * against the live book including orders placed this same tick, so the pass that
 * runs next tick can never find a self-crossing pair.
 */
function checkSelfCross(
  ctx: PlaceContext,
  venue: VenueId,
  good: GoodId,
  side: Side,
  limitPrice: Minor,
  replacing: Order | null,
): Rejection | null {
  for (const own of ctx.book.openForIn(ctx.principal, venue, good)) {
    // An order cannot cross the order it is replacing: the cancel lands first.
    if (own.id === replacing?.id) continue;
    if (own.side === side) continue;
    const crosses =
      side === 'BID' ? limitPrice >= own.limitPrice : own.limitPrice >= limitPrice;
    if (!crosses) continue;
    return reject(
      'A15',
      `that order would trade against your own ${own.side.toLowerCase()} ${own.id} at ${String(own.limitPrice)}, ` +
        'and one principal may never be both sides of a print — a self-match prints a price nobody paid. ' +
        'Cancel that order first, or name a price that does not cross it.',
    );
  }
  return null;
}

/** Would these two of one principal's orders cross? Exposed for the invariant. */
export function selfCrossing(a: Order, b: Order): boolean {
  if (a.principal !== b.principal || a.venue !== b.venue || a.good !== b.good) return false;
  if (a.side === b.side) return false;
  const bid = a.side === 'BID' ? a : b;
  const ask = a.side === 'BID' ? b : a;
  return crossPrice(bid, ask) !== null;
}

/** What a BID would need escrowed for a fresh order of this size. */
export function escrowFor(side: Side, unitPrice: Minor, amount: Qty): Minor {
  return side === 'BID' ? multiplyPrice(unitPrice, amount) : minor(0);
}
