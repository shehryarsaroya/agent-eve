/**
 * The market module's public surface.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE THREE RULES THIS MODULE IS BUILT AROUND, IN ONE PLACE.**
 *
 * 1. **Location-bound.** A book is `(venue, good)` and goods settle exactly where
 *    they traded. A global book would delete geography, and geography is what makes
 *    hauling, hubs, regional scarcity and blockades worth anything (M1).
 * 2. **Full escrow, both sides, or refused.** A sell escrows the goods, a buy
 *    escrows the maximum cash, and an order that cannot be escrowed is refused
 *    rather than half-placed. Unescrowed depth is free to create, and anything free
 *    to create is priced in identities (A15).
 * 3. **A faster client gains nothing.** Priority is price, then `(placedTick,
 *    principal_id, client_sequence, order_id)`, never wall-clock arrival; matching
 *    runs once per tick in the `MARKETS` phase, over the frozen book, and orders
 *    submitted at T match at T+1. A4 is the constraint the whole design bends
 *    around, because a real exchange breaks it on purpose.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Nothing here holds a `Ledger` except by argument. The book is a state table; the
 * ledger is authoritative for value; the tick loop wires them together and never
 * learns what an order is.
 */

export {
  MarketBook,
  MarketBookError,
  MAX_CLOSED_ORDERS,
  MAX_FILLS,
  MAX_OPEN_ORDERS,
  MAX_OPEN_ORDERS_PER_PRINCIPAL,
  type BookRef,
  type ClosedOrder,
  type Fill,
} from './book.js';

export {
  bookKey,
  cashRequired,
  compareOrderIds,
  comparePriority,
  compareSeniority,
  crossPrice,
  isOpen,
  multiplyPrice,
  orderIdFor,
  remainingOf,
  type Order,
  type OrderId,
  type OrderState,
  type Side,
  type TimeInForce,
  type VenueId,
} from './order.js';

export { isMatchable, matchBook, topOfBook, type MatchInputs, type MatchPlan, type PlannedFill, type SelfCross } from './match.js';

export {
  booksToClear,
  clearMarkets,
  fillIdFor,
  tradersIn,
  type ClearInputs,
  type ClearReport,
} from './clear.js';

export {
  cashLegEvent,
  deliverGoods,
  drawLock,
  ensureMarketEscrow,
  escrowGoods,
  escrowedGoods,
  freeCash,
  goodsLegEvent,
  lockOrderCash,
  lockedCash,
  marketEscrowAccount,
  orderObligation,
  releaseGoods,
  releaseLock,
  sellableGoods,
} from './escrow.js';

export {
  cancelOrder,
  checkReplacement,
  escrowFor,
  placeOrder,
  releaseEscrow,
  selfCrossing,
  tradeRefusalFor,
  MAX_DURATION_TICKS,
  MAX_ORDER_QTY,
  MAX_UNIT_PRICE,
  TRADE_OPERATIONS,
  type PlaceContext,
  type TradeRequest,
} from './place.js';

export {
  ENDOWMENT_GOODS_RULE,
  ENDOWMENT_RULE,
  MAKER_NOTE,
  PROBE_SEQUENCE,
  endowmentStanding,
  tradeCheck,
  tradeObstacles,
  type EndowmentStanding,
  type TradeCheckPorts,
  type TradeObstacleInput,
} from './standing.js';

export { marketStateTable, MarketRestoreError } from './stateTable.js';

export {
  checkMarketInvariants,
  checkMkt1,
  checkMkt2,
  checkMkt3,
  checkMkt4,
  checkMkt5,
  checkMkt6,
  checkMkt7,
  type MarketInvariantInputs,
} from './invariants.js';

export {
  DEPTH_BANDS,
  MARKET_FEES,
  PUBLISHED_LEVELS,
  bookRows,
  booksFor,
  // ★ The pixel signature (A13, §10): THE PRINT — a price on a place, and the gap to everywhere.
  marketLinesFor,
  ownOrdersFor,
  ownPrintsFor,
  publicBook,
  recentPrints,
  venuesOf,
  type Band,
  type BookRowShape,
  type FeeSchedule,
  type Level,
  type OwnOrder,
  type PublicBook,
  type PublicPrint,
} from './observe.js';
