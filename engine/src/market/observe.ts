/**
 * What an agent — and a viewer — may read off the book.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE TIER CHOICE, AND WHY (SPEC §11.2).**
 *
 * | What | Tier | Why |
 * |---|---|---|
 * | best bid / best ask / spread / price levels / depth | `PUBLIC` | It is the price signal, and the price signal is the show. §12.1 already gives `market` a top-level `observe` key ("local book only: best bid/ask + depth at two quantity bands"), and A13's whole claim is that a chart moving because a lane closed is a thing a stranger understands in three seconds. A9 holds: a viewer sees exactly what a non-party agent's own `observe` shows. |
 * | **who owns which order** | `PRIVATE` | The principal itself; never anyone, never later. |
 * | a completed fill | `PUBLIC` | Economy law 10: "completed trades ... become durable economic history." It is the print, the mark, and the receipt reel's raw material. |
 *
 * **Why order ownership is `PRIVATE` and not `SENSED`.** §11.2 puts "cargo
 * contents and hold values" at `SENSED` — visible to whoever has a hand in range
 * or bought the intel — precisely so that ambush depends on reconnaissance. A
 * resting ask *is* a hold value: "X has 400 of this good, here, right now." If the
 * depth ladder resolved to owners, a raider would read a manifest off a `PUBLIC`
 * surface without ever scouting, which both deletes the intel market and breaks
 * A9's "a viewer never sees a fact ahead of a non-party agent."
 *
 * `SENSED` was the near-miss and is the wrong answer too: `SENSED` declassifies
 * "after the Reckoning it mattered in", and an order's owner is not a fact that
 * stops mattering — publishing last night's book ownership is publishing this
 * morning's inventory. `PRIVATE`'s row is "the principal itself / never / never",
 * which is exactly the promise being made.
 *
 * The residual, stated rather than buried: a `PUBLIC` fill does reveal that its
 * buyer just acquired that quantity at that venue. That is history rather than
 * standing inventory — the buyer may move it, and finding out whether it did still
 * costs a scout — and it is the price of having a price chart at all.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Everything below is aggregate by construction. There is no code path from a
 * published level to a principal id; `mine` is built from the reader's own rows.
 */

import type { GoodId, PrincipalId, SystemId } from '../core/types.js';
import { BPS_ONE, minor, qty, type Minor, type Qty } from '../core/units.js';
// The frame contract owns the line's shape and this module fills it, exactly as
// `predation/view.ts` fills `RaidLine`. One home per rules surface: a second `MarketLine`
// declared here would be the same pixel signature described twice, and the two would drift
// the first time a field was added.
import type { MarketLine } from '../frames/contract.js';
import { compareIds } from '../ledger/index.js';
import type { Fill, MarketBook } from './book.js';
import { topOfBook } from './match.js';
import {
  bookKey,
  cashRequired,
  comparePriority,
  remainingOf,
  type Order,
  type Side,
  type VenueId,
} from './order.js';

/** Price levels published per side. Enough to read the shape; bounded (INV-26). */
export const PUBLISHED_LEVELS = 5;

/**
 * The two quantity bands every book publishes, small then large *(calibrate)*.
 *
 * M1 asks for "depth within 1%/5%" and "indicative_vwap at requested quantity".
 * Quantity bands are the version an agent can act on without a second request, and
 * they are the shape `observe/sources.ts:BookBand` already promises.
 */
export const DEPTH_BANDS: readonly number[] = [10, 100];

/** One aggregated price level. No principal, no order id — that is the whole point. */
export interface Level {
  readonly price: Minor;
  readonly qty: Qty;
  /** How many orders make up this level. A count is not an identity. */
  readonly orders: number;
}

export interface Band {
  readonly qty: Qty;
  /** Indicative average unit price to SELL this much into the bids, or null. */
  readonly bid: Minor | null;
  /** Indicative average unit price to BUY this much from the asks, or null. */
  readonly ask: Minor | null;
}

/** One principal's own order, as only that principal ever sees it. */
export interface OwnOrder {
  readonly order: string;
  readonly venue: VenueId;
  readonly good: GoodId;
  readonly side: Side;
  readonly limit_price: Minor;
  readonly quantity: Qty;
  readonly filled: Qty;
  readonly remaining: Qty;
  readonly time_in_force: string;
  readonly placed_tick: number;
  readonly expires_tick: number;
  /** Cash still locked behind a BID. Zero on an ASK, which escrows goods instead. */
  readonly escrowed_minor: Minor;
  /** Goods still escrowed behind an ASK. Zero on a BID. */
  readonly escrowed_qty: Qty;
}

export interface PublicBook {
  readonly venue: VenueId;
  readonly good: GoodId;
  readonly best_bid: Minor | null;
  readonly best_ask: Minor | null;
  readonly spread: Minor | null;
  readonly levels: {
    readonly bid: readonly Level[];
    readonly ask: readonly Level[];
  };
  readonly depth: readonly Band[];
  /** Total resting quantity per side. Unambiguous where an average is indicative. */
  readonly resting: { readonly bid: Qty; readonly ask: Qty };
  readonly last_price: Minor | null;
  readonly last_tick: number | null;
  /** Ticks since the last print here, or null if it has never traded. */
  readonly stale_ticks: number | null;
  /** The reader's own orders on this book. Present for nobody else. */
  readonly mine: readonly OwnOrder[];
}

/**
 * The fee schedule, published and versioned (M4: "the schedule/rounding is
 * versioned, never hidden behind progression").
 *
 * **Every rate is zero in this build, and that is a statement rather than a
 * placeholder.** M4 proposes a listing bond, a settlement levy and a venue fee;
 * none is implemented, because a fee is a currency `RETIRE` against a named sink
 * and shipping one half-built would put a supply movement in the market's path
 * before the conservation clauses had ever run against a live book. Publishing the
 * schedule at zero keeps the field honest — an agent reading `fees` gets the true
 * arithmetic — and leaves the sink to be turned on deliberately.
 */
export interface FeeSchedule {
  readonly listing_bond_bps: number;
  readonly settlement_levy_bps: number;
  readonly venue_fee_bps: number;
  readonly note: string;
}

export const MARKET_FEES: FeeSchedule = Object.freeze({
  listing_bond_bps: 0,
  settlement_levy_bps: 0,
  venue_fee_bps: 0,
  note:
    'No fee is charged in this build. M4 prices a listing bond, a settlement levy and a venue fee; each is a ' +
    'currency sink and none is wired, so the schedule is published at zero rather than guessed at. ' +
    'limit_price is pre-fee and is exactly what moves.',
});

/** A fill, as the public record sees it. */
export interface PublicPrint {
  readonly venue: VenueId;
  readonly good: GoodId;
  readonly unit_price: Minor;
  readonly qty: Qty;
  readonly tick: number;
  readonly buyer: PrincipalId;
  readonly seller: PrincipalId;
}

/**
 * Build the books a principal may read, newest facts first.
 *
 * `venues` limits the result to places the reader can legitimately see — §12.1's
 * "local book only". The caller supplies the set, because *what a principal can
 * sense* is the world module's rule and duplicating it here would be a second
 * answer to a question A9 turns on.
 */
export function booksFor(
  book: MarketBook,
  principal: PrincipalId,
  venues: ReadonlySet<SystemId>,
  tick: number,
): readonly PublicBook[] {
  const out: PublicBook[] = [];
  for (const ref of book.visibleBooks()) {
    if (!venues.has(ref.venue)) continue;
    out.push(publicBook(book, ref.venue, ref.good, principal, tick));
  }
  return out;
}

export function publicBook(
  book: MarketBook,
  venue: VenueId,
  good: GoodId,
  reader: PrincipalId | null,
  tick: number,
): PublicBook {
  const orders = book.openIn(venue, good);
  const top = topOfBook(orders);
  const bids = ladder(orders, 'BID');
  const asks = ladder(orders, 'ASK');
  const last = lastPrint(book, venue, good);

  return {
    venue,
    good,
    best_bid: top.bestBid,
    best_ask: top.bestAsk,
    spread: top.spread,
    levels: {
      bid: bids.slice(0, PUBLISHED_LEVELS),
      ask: asks.slice(0, PUBLISHED_LEVELS),
    },
    depth: DEPTH_BANDS.map((size) => ({
      qty: qty(size),
      bid: walk(bids, size, 'BID'),
      ask: walk(asks, size, 'ASK'),
    })),
    resting: { bid: totalOf(bids), ask: totalOf(asks) },
    last_price: last?.unitPrice ?? null,
    last_tick: last?.tick ?? null,
    stale_ticks: last === null ? null : tick - last.tick,
    mine:
      reader === null
        ? []
        : [...orders.filter((o) => o.principal === reader)].sort(comparePriority).map(ownOrder),
  };
}

/**
 * The `observe/sources.ts:BookRow` shape — the second observation implementation's
 * input port.
 *
 * `src/observe/` is a complete parallel build of the same ten keys with no
 * transport wired to it, so nothing in production constructs its sources today.
 * This adapter exists so that when it does get a transport it reads the same book
 * rather than growing its own — two homes for the price an agent trades on is
 * scar #1 with money attached.
 */
export interface BookRowShape {
  readonly system: SystemId;
  readonly good: GoodId;
  readonly best_bid: Minor | null;
  readonly best_ask: Minor | null;
  readonly depth: readonly { readonly qty: Qty; readonly bid: Minor | null; readonly ask: Minor | null }[];
}

export function bookRows(book: MarketBook, tick: number): readonly BookRowShape[] {
  return book.visibleBooks().map((ref) => {
    const view = publicBook(book, ref.venue, ref.good, null, tick);
    return {
      system: view.venue,
      good: view.good,
      best_bid: view.best_bid,
      best_ask: view.best_ask,
      depth: view.depth,
    };
  });
}

/** A principal's own open orders, everywhere. Nobody else may be shown these. */
export function ownOrdersFor(book: MarketBook, principal: PrincipalId): readonly OwnOrder[] {
  return [...book.openFor(principal)].sort(comparePriority).map(ownOrder);
}

/** A principal's own recent prints. Public facts, filtered to what it took part in. */
export function ownPrintsFor(book: MarketBook, principal: PrincipalId, limit: number): readonly PublicPrint[] {
  const rows = book.fillsFor(principal);
  return rows.slice(Math.max(0, rows.length - limit)).map((f) => ({
    venue: f.venue,
    good: f.good,
    unit_price: f.unitPrice,
    qty: f.qty,
    tick: f.tick,
    buyer: f.buyer,
    seller: f.seller,
  }));
}

/** Recent prints anywhere. The ticker, and the viewer's chart. */
export function recentPrints(book: MarketBook, limit: number): readonly PublicPrint[] {
  const rows = book.fills();
  return rows.slice(Math.max(0, rows.length - limit)).map((f) => ({
    venue: f.venue,
    good: f.good,
    unit_price: f.unitPrice,
    qty: f.qty,
    tick: f.tick,
    buyer: f.buyer,
    seller: f.seller,
  }));
}

// ── THE PIXEL SIGNATURE (A13, §10) ──────────────────────────────────────────
//
// ★ **THE PRINT.** A claim tints a system, a WORKS marks it, and a market PRINTS A PRICE ON
// IT. The shape is `../frames/contract.MarketLine`, whose header names the signature and argues
// it field by field; the §11.2 clause that admits the key is in `frames/projection.ts`.
//
// **Built here rather than in the renderer, for the reason every other line set is**: a
// renderer that computed its own prices would be inventing an economy, and a premium drawn
// over a good that never traded at two places is the same class of lie as a red arc thrown at a
// holding nobody attacked. This file can only see the book, and the book only holds fills.
//
// A9 holds by construction and it is worth stating where: this reads `book.fills()`, and every
// agent's `market.ticker` is `recentPrints(book)` over the same log — galaxy-wide, buyer and
// seller named. It reads no `Order`, so nothing venue-gated can reach a frame from here.

/**
 * One line per `(venue, good)` the book still remembers a print for, widest premium first.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THERE IS NO POLICY WINDOW, AND MEASURING ONE IS WHY.** The first draft measured one
 * Reckoning, and three seeded six-Reckoning worlds printed 6, 3 and 1 fills — a sparse market is
 * what a young economy looks like. Two of the three then rendered **no price at all** on their
 * head frame while the record plainly held one. Widening to three Reckonings fixed one of the
 * two: with trades this rare, *any* fixed window is empty most nights.
 *
 * That failure is the exact shape A2 forbids, and `visibleBooks` above had already reached the
 * answer for the agent's side: *"dropping it the moment the depth empties would tell an agent the
 * good has never traded here — which is a false statement about the world made by an absence."* A
 * viewer is owed the same surface. **A price from six Reckonings ago is a price; nothing is not.**
 *
 * So the span is every fill still on the ring, and the line publishes **its own span** —
 * {@link MarketLine.firstTick} and {@link MarketLine.lastTick}. That is what makes the counts
 * honest without a constant: `prints: 3 · firstTick: 600 · lastTick: 863` is unambiguous, where
 * "3 prints" against an unstated period would not be, and a policy number would additionally
 * need calibrating against a trade rate nobody can predict yet. Bounded by `MAX_FILLS`
 * structurally, and staleness is `frame.tick − lastTick`, which a viewer can do by eye.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `tick` is the upper bound rather than "now": rendering a past Reckoning's frame must not show a
 * print from after it, or the archive would drift every time it was re-read.
 */
export function marketLinesFor(book: MarketBook, tick: number, limit: number): readonly MarketLine[] {
  const window = book.fills().filter((f) => f.tick <= tick);
  if (window.length === 0) return [];

  // Per-good totals FIRST, so a venue's premium is measured against the whole galaxy rather
  // than against itself. Two passes over a bounded ring; no sort of non-strings.
  const galaxy = new Map<GoodId, { cost: number; qty: number }>();
  for (const f of window) {
    const cell = galaxy.get(f.good) ?? { cost: 0, qty: 0 };
    cell.cost += f.unitPrice * f.qty;
    cell.qty += f.qty;
    galaxy.set(f.good, cell);
  }

  const byBook = new Map<string, Fill[]>();
  for (const f of window) {
    const key = bookKey(f.venue, f.good);
    byBook.set(key, [...(byBook.get(key) ?? []), f]);
  }
  // How many places traded each good, which is what decides whether a premium MEANS anything.
  const venuesPerGood = new Map<GoodId, Set<VenueId>>();
  for (const f of window) {
    const seen = venuesPerGood.get(f.good) ?? new Set<VenueId>();
    seen.add(f.venue);
    venuesPerGood.set(f.good, seen);
  }

  const lines: MarketLine[] = [];
  for (const fills of byBook.values()) {
    const first = fills[0];
    if (first === undefined) continue;
    let cost = 0;
    let volume = 0;
    // `last` by TICK, then by position in the append-only log, so two fills in one tick
    // resolve the same way on every machine. Never `.sort()` on the fills themselves.
    let last = first;
    let firstTick = first.tick;
    for (const f of fills) {
      cost += f.unitPrice * f.qty;
      volume += f.qty;
      if (f.tick >= last.tick) last = f;
      if (f.tick < firstTick) firstTick = f.tick;
    }
    const here = volume === 0 ? 0 : Math.round(cost / volume);
    const total = galaxy.get(first.good) ?? { cost: 0, qty: 0 };
    const everywhere = total.qty === 0 ? 0 : Math.round(total.cost / total.qty);
    const venues = venuesPerGood.get(first.good)?.size ?? 1;
    // ── WHY `venues` DECIDES THE PREMIUM AND NOT THE ARITHMETIC ──────────────
    //
    // A sole market IS the galaxy price, so its premium is zero by identity and there is
    // nothing to compare. Elsewhere, integer bps against an integer denominator: a difference
    // smaller than one bps truncates to 0, which is honest ("the same price, to the precision
    // this field has") and is why `assertFrameBudgets` checks the premium's sign does not
    // CONTRADICT the two prices rather than demanding it be non-zero. A guard that demanded a
    // non-zero premium would be satisfied by fabricating a magnitude.
    const premiumBps =
      venues < 2 || everywhere === 0 ? 0 : Math.trunc(((here - everywhere) * BPS_ONE) / everywhere);
    lines.push({
      venue: first.venue,
      good: first.good,
      lastPrice: minor(last.unitPrice),
      lastTick: last.tick,
      firstTick,
      prints: fills.length,
      volume: qty(volume),
      vwap: minor(here),
      galaxyVwap: minor(everywhere),
      venues,
      premiumBps,
      legend: printLegend(first.good, here, venues, premiumBps),
    });
  }

  // Widest premium first: the gap between two places IS the story, so overflow must drop the
  // places that agree with everyone else rather than the ones that do not. Ties broken by
  // volume then by canonical id, so the frame is stable across runs (DET).
  return lines
    .sort(
      (a, b) =>
        Math.abs(b.premiumBps) - Math.abs(a.premiumBps) ||
        b.volume - a.volume ||
        compareIds(a.venue, b.venue) ||
        compareIds(a.good, b.good),
    )
    .slice(0, limit);
}

/**
 * `ORE · 1240 · +812 bps DEAR` — the words a viewer reads.
 *
 * Three states, not two, because "no premium" and "nothing to compare against" are different
 * facts and A2 forbids letting an absence read as a measurement. A sole market says `ONLY
 * MARKET`; two markets that agree say `AT PARITY`, which is a real and interesting result; a
 * gap says which way and how far.
 *
 * No `toLocaleString`: it depends on the ICU build Node was compiled with, so a number could
 * render differently on the server than in a test. Plain digits are the same everywhere.
 */
function printLegend(good: GoodId, vwap: number, venues: number, premiumBps: number): string {
  const head = `${String(good).toUpperCase()} · ${String(vwap)}`;
  if (venues < 2) return `${head} · ONLY MARKET`;
  if (premiumBps === 0) return `${head} · AT PARITY across ${String(venues)} markets`;
  const sign = premiumBps > 0 ? '+' : '-';
  return `${head} · ${sign}${String(Math.abs(premiumBps))} bps ${premiumBps > 0 ? 'DEAR' : 'CHEAP'}`;
}

function ownOrder(order: Order): OwnOrder {
  return {
    order: order.id,
    venue: order.venue,
    good: order.good,
    side: order.side,
    limit_price: order.limitPrice,
    quantity: order.quantity,
    filled: order.filled,
    remaining: remainingOf(order),
    time_in_force: order.timeInForce,
    placed_tick: order.placedTick,
    expires_tick: order.expiresTick,
    // `cashRequired`, not a raw `limitPrice * remainingOf` — this was the sixth home for the BID
    // escrow and the only one that skipped `multiplyPrice`'s safe-integer check, on the one path that
    // publishes the number to an agent. `cashRequired` already returns 0 for an ASK, so the ternary
    // went with it.
    escrowed_minor: cashRequired(order),
    escrowed_qty: order.side === 'ASK' ? remainingOf(order) : qty(0),
  };
}

/** Aggregate one side into price levels, best first. Never carries an owner. */
function ladder(orders: readonly Order[], side: Side): readonly Level[] {
  const byPrice = new Map<number, { qty: number; orders: number }>();
  for (const o of orders) {
    if (o.side !== side) continue;
    const left = remainingOf(o);
    if (left <= 0) continue;
    const cur = byPrice.get(o.limitPrice) ?? { qty: 0, orders: 0 };
    cur.qty += left;
    cur.orders += 1;
    byPrice.set(o.limitPrice, cur);
  }
  return [...byPrice.entries()]
    .sort((a, b) => (side === 'BID' ? b[0] - a[0] : a[0] - b[0]))
    .map(([price, cell]) => ({ price: minor(price), qty: qty(cell.qty), orders: cell.orders }));
}

function totalOf(levels: readonly Level[]): Qty {
  let total = 0;
  for (const level of levels) total += level.qty;
  return qty(total);
}

/**
 * The indicative average unit price for `want` units, walked down the ladder.
 *
 * `null` when the book cannot fill that much — an honest "you cannot do this here"
 * rather than an average of the part that exists, which would read as a price.
 *
 * **Rounded against the reader in both directions**: a buy is rounded up and a sell
 * rounded down, so the number shown is never better than the number achievable. The
 * same conservatism `applyHaircut` uses, and the same integer-division shape, so no
 * float enters a published figure.
 */
function walk(levels: readonly Level[], want: number, side: Side): Minor | null {
  let left = want;
  let cost = 0;
  for (const level of levels) {
    if (left <= 0) break;
    const take = Math.min(left, level.qty);
    cost += take * level.price;
    left -= take;
  }
  if (left > 0) return null;
  if (want <= 0) return null;
  return minor(side === 'BID' ? Math.floor(cost / want) : Math.ceil(cost / want));
}

function lastPrint(book: MarketBook, venue: VenueId, good: GoodId): { unitPrice: Minor; tick: number } | null {
  const fills = book.fills();
  for (let i = fills.length - 1; i >= 0; i -= 1) {
    const f = fills[i];
    if (f === undefined) continue;
    if (f.venue === venue && f.good === good) return { unitPrice: f.unitPrice, tick: f.tick };
  }
  return null;
}

/** Venues where a principal has a hand right now. The `market.at` list. */
export function venuesOf(systems: readonly SystemId[]): ReadonlySet<SystemId> {
  return new Set([...systems].sort(compareIds));
}
