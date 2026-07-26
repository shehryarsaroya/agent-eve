/**
 * The market as a hashed, rollback-correct state table.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THIS IS THE SHAPE THE ENCUMBRANCE OMISSION HAD, AND IT IS NOT REPEATED.**
 *
 * `EncumbranceBook` sat in no state table at all, and four things followed: an
 * aborted tick kept its locks, `state_hash` could not see escrow, a restored world
 * had escrowed stake silently spendable, and a bounded boot was blocked. The market
 * is a strictly larger version of that risk — an order *is* a claim on value, and
 * there are many more of them than there are ventures.
 *
 * So all three halves are captured:
 *
 *   - **orders**, because an order table outside the hash means two worlds with
 *     different books hash the same, and an order outside the rollback means an
 *     aborted tick leaves an order standing with escrow behind it;
 *   - **fills**, because they are what `ledger/valuation.ts` values goods from — a
 *     restored world with a different print history marks bonds differently, and a
 *     bond is custody of somebody else's assets;
 *   - **closures**, because they are what an agent reads to learn what became of
 *     its own order, and a rollback that dropped them would tell a principal its
 *     order simply vanished.
 *
 * Nothing here is a counter. Order ids come from `(principal, tick,
 * client_sequence)` and fill ids from `(tick, bid, ask)`, both content-derived, so
 * there is no sequence to snapshot and replay cannot diverge (DET-3, DET-5).
 * ══════════════════════════════════════════════════════════════════════════
 */

import type { CanonicalValue } from '../core/canonical.js';
import type { GoodId, PrincipalId } from '../core/types.js';
import { minor, qty } from '../core/units.js';
import type { StateTable } from '../tick/snapshot.js';
import {
  readArray as snapArray,
  readInt as snapInt,
  readObject as snapObject,
  readString as snapString,
  readStringOrNull as snapStringOrNull,
} from '../tick/snapshot.js';
import { MarketBook, type ClosedOrder, type Fill } from './book.js';
import type { Order, OrderId, OrderState, Side, TimeInForce, VenueId } from './order.js';

export class MarketRestoreError extends Error {}

const SIDES: ReadonlySet<string> = new Set<Side>(['BID', 'ASK']);
const TIF: ReadonlySet<string> = new Set<TimeInForce>(['GTC', 'IOC']);
const STATES: ReadonlySet<string> = new Set<OrderState>(['OPEN', 'FILLED', 'CANCELLED', 'EXPIRED']);

export function marketStateTable(read: () => MarketBook, write: (book: MarketBook) => void): StateTable {
  return {
    name: 'market',

    capture(): CanonicalValue {
      const book = read();
      return {
        // Id-sorted, so the capture cannot depend on insertion order and two hosts
        // that built the same book by different routes hash identically (DET-4).
        orders: book.all().map((o) => ({
          id: o.id,
          principal: o.principal,
          venue: o.venue,
          good: o.good,
          side: o.side,
          limitPrice: o.limitPrice,
          quantity: o.quantity,
          filled: o.filled,
          timeInForce: o.timeInForce,
          placedTick: o.placedTick,
          expiresTick: o.expiresTick,
          clientSequence: o.clientSequence,
          state: o.state,
          encumbranceId: o.encumbranceId,
        })),
        // In record order, not sorted: a ring's contents are a sequence, and the
        // valuation window reads them as one. Bounded by MAX_FILLS.
        fills: book.fills().map((f) => ({
          id: f.id,
          tick: f.tick,
          venue: f.venue,
          good: f.good,
          unitPrice: f.unitPrice,
          qty: f.qty,
          buyer: f.buyer,
          seller: f.seller,
          bid: f.bid,
          ask: f.ask,
          goodsLegs: f.goodsLegs,
        })),
        closed: book.closed().map((c) => ({
          id: c.id,
          principal: c.principal,
          venue: c.venue,
          good: c.good,
          side: c.side,
          limitPrice: c.limitPrice,
          quantity: c.quantity,
          filled: c.filled,
          state: c.state,
          closedTick: c.closedTick,
        })),
      };
    },

    restore(captured: CanonicalValue): void {
      const root = snapObject(captured, 'market table');
      const book = new MarketBook();
      const orders: Order[] = [];
      for (const raw of snapArray(root['orders'] ?? [], 'market.orders')) {
        orders.push(readOrder(raw));
      }
      const fills: Fill[] = [];
      for (const raw of snapArray(root['fills'] ?? [], 'market.fills')) {
        fills.push(readFill(raw));
      }
      const closed: ClosedOrder[] = [];
      for (const raw of snapArray(root['closed'] ?? [], 'market.closed')) {
        closed.push(readClosed(raw));
      }
      book.hydrate(orders, fills, closed);
      write(book);
    },
  };
}

function readOrder(raw: CanonicalValue): Order {
  const o = snapObject(raw, 'market order');
  const id = snapString(o, 'id', 'market order') as OrderId;
  const where = `market order ${id}`;
  return {
    id,
    principal: snapString(o, 'principal', where) as PrincipalId,
    venue: snapString(o, 'venue', where) as VenueId,
    good: snapString(o, 'good', where) as GoodId,
    side: member(snapString(o, 'side', where), SIDES, where, 'side') as Side,
    limitPrice: minor(snapInt(o, 'limitPrice', where)),
    quantity: qty(snapInt(o, 'quantity', where)),
    filled: qty(snapInt(o, 'filled', where)),
    timeInForce: member(snapString(o, 'timeInForce', where), TIF, where, 'time_in_force') as TimeInForce,
    placedTick: snapInt(o, 'placedTick', where),
    expiresTick: snapInt(o, 'expiresTick', where),
    clientSequence: snapInt(o, 'clientSequence', where),
    state: member(snapString(o, 'state', where), STATES, where, 'state') as OrderState,
    encumbranceId: snapStringOrNull(o, 'encumbranceId', where),
  };
}

function readFill(raw: CanonicalValue): Fill {
  const o = snapObject(raw, 'market fill');
  const id = snapString(o, 'id', 'market fill');
  const where = `market fill ${id}`;
  return {
    id,
    tick: snapInt(o, 'tick', where),
    venue: snapString(o, 'venue', where) as VenueId,
    good: snapString(o, 'good', where) as GoodId,
    unitPrice: minor(snapInt(o, 'unitPrice', where)),
    qty: qty(snapInt(o, 'qty', where)),
    buyer: snapString(o, 'buyer', where) as PrincipalId,
    seller: snapString(o, 'seller', where) as PrincipalId,
    bid: snapString(o, 'bid', where) as OrderId,
    ask: snapString(o, 'ask', where) as OrderId,
    goodsLegs: snapInt(o, 'goodsLegs', where),
  };
}

function readClosed(raw: CanonicalValue): ClosedOrder {
  const o = snapObject(raw, 'market closure');
  const id = snapString(o, 'id', 'market closure') as OrderId;
  const where = `market closure ${id}`;
  return {
    id,
    principal: snapString(o, 'principal', where) as PrincipalId,
    venue: snapString(o, 'venue', where) as VenueId,
    good: snapString(o, 'good', where) as GoodId,
    side: member(snapString(o, 'side', where), SIDES, where, 'side') as Side,
    limitPrice: minor(snapInt(o, 'limitPrice', where)),
    quantity: qty(snapInt(o, 'quantity', where)),
    filled: qty(snapInt(o, 'filled', where)),
    state: member(snapString(o, 'state', where), STATES, where, 'state') as OrderState,
    closedTick: snapInt(o, 'closedTick', where),
  };
}

/**
 * Strict, and loud. A snapshot is machine-written, so an unknown member is a bug in
 * the writer rather than bad input — coercing it would restore a world that *looks*
 * right, which is the failure mode `restoreSnapshot` refuses by design.
 */
function member(value: string, allowed: ReadonlySet<string>, where: string, field: string): string {
  if (!allowed.has(value)) throw new MarketRestoreError(`${where}: unknown ${field} '${value}'`);
  return value;
}
