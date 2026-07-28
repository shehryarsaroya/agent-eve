/**
 * Escrow — **both sides, in full, or the order is refused.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A sell order escrows the goods. A buy order escrows the maximum cash. An order
 * that cannot be escrowed is **refused, never partially placed**.
 *
 * This is the market's A15 surface and it is the whole reason the book means
 * anything. Unescrowed liquidity is free to create, so a book that allowed it would
 * price in identities: one keypair could paint a wall of bids it never intended to
 * honour, move the mark, and post the printed good as a BOND. `ledger/valuation.ts`
 * calls that "the game's single most dangerous exploit" and defends the *mark*
 * against it; this file stops the fake depth existing in the first place.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## Two mechanisms, because the ledger has two ledgers
 *
 * `EncumbranceBook` locks **currency in STORES** — it takes a `Minor` and refuses
 * any account that is not STORES. It cannot hold a quantity of a good. So:
 *
 *   - **A BID locks cash** through `EncumbranceBook.lockSafe`, the book that was
 *     just made snapshot- and rollback-correct. No second lock mechanism is
 *     invented for the currency side.
 *   - **An ASK moves goods into an ESCROW account**, which is the ledger's own
 *     escrow — the same kind of account a venture's escrowed part lives in, counted
 *     in INV-2's `escrowed` bucket, and out of the seller's STORES so that nothing
 *     else (a Levy delivery, a second order) can spend the same units twice.
 *
 * ## Why the cash lock is `lockSafe`, i.e. **zero EXPOSURE**
 *
 * §3 is strict: EXPOSURE is "Σ of your open `max_direct_loss`, **and nothing
 * else**" — not value committed. A resting limit order cannot lose money: it either
 * buys goods at or below a price its own principal chose, or the cash is released
 * untouched. Charging EXPOSURE for it would inflate a figure that gates Commons
 * capacity and the Levy's `BY_EXPOSURE` rule, and would make market-making read as
 * peril.
 *
 * The honest counter-argument, recorded rather than hidden: locked cash is still
 * *destructible* (PROP-L3 — an encumbrance is a claim on a thing, never armour over
 * it), so an audit seizure can drain it. But that is a loss of STORES, attributable
 * to the seizure, and it is already recorded there. Attributing it to the order too
 * would count one loss twice, which is scar #5's shape.
 *
 * ## Every mutation here is all-or-nothing
 *
 * A half-escrowed order is a fake order with extra steps. {@link escrowGoods}
 * refuses before it moves anything, and unwinds itself if the ledger refuses a leg
 * it had already accepted — so the caller only ever sees "escrowed" or "not".
 */

import type { AccountId, EventId, GoodId, PrincipalId } from '../core/types.js';
import { minor, qty, type Minor, type Qty } from '../core/units.js';
import { Ledger, compareIds, storesAccount, type LotId, type ObligationRef } from '../ledger/index.js';
import { ENDOWMENT_GOOD, ENDOWMENT_GOOD_FLOOR_QTY } from '../ledger/endowment.js';
import type { OrderId, VenueId } from './order.js';

/**
 * A principal's market escrow account.
 *
 * One per principal rather than one per order: `schema.sql` requires an owning
 * principal on an ESCROW account, and an account per order is scar #3 — unbounded
 * rows created by strangers. Goods inside it are still located (every lot carries
 * its system), so `(good, venue)` distinguishes one book's escrow from another's
 * without a separate account, and geography survives.
 */
export function marketEscrowAccount(principal: PrincipalId): AccountId {
  return `escrow:market:${principal}` as AccountId;
}

/**
 * CONTRACT GAP, stated rather than hidden.
 *
 * `ObligationRef` is `VentureId | GrantId` in `ledger/encumbrance.ts`, and an order
 * is a third thing that may legitimately hold a lock. Widening that union belongs
 * in the ledger, and this module is under instruction not to edit that file, so the
 * cast lives here in exactly one named function with the reason attached. INV-4
 * still holds: `sim/runtime.ts` teaches the obligation book to answer "is this
 * order live?" from the market book itself, so a market lock is never an orphan.
 */
export function orderObligation(order: OrderId): ObligationRef {
  return order as unknown as ObligationRef;
}

/**
 * The `eventId` market locks are minted under: **one per principal, not one per
 * order**.
 *
 * `EncumbranceBook` derives lock ids as `enc:<eventId>:<n>` and keeps a permanent
 * `perEvent` counter map that is captured into `state_hash`. A distinct event id
 * per order would grow that map by one entry per order forever — a hashed structure
 * that never stops growing, which is scar #3 inside the snapshot. Keyed by
 * principal it is bounded by the population, and the ids stay unique because the
 * counter is captured and restored with the book.
 */
function lockEvent(principal: PrincipalId): string {
  return `mkt:${principal}`;
}

/** Open the escrow account if this principal has never traded. Idempotent. */
export function ensureMarketEscrow(ledger: Ledger, principal: PrincipalId): AccountId {
  const id = marketEscrowAccount(principal);
  if (ledger.account(id) === undefined) ledger.openAccount(id, 'ESCROW', principal);
  return id;
}

/**
 * Free currency a principal could still commit to a new BID — **its earnings, never its
 * endowment.**
 *
 * ## D7: the endowment is not transferable
 *
 * Enrolment is free and must stay free (A15), and it mints a `STARTER_STAKE`. Free
 * identities therefore mint capital, and **seat recycling makes it unbounded over time**:
 * enrol, mint, go idle, the seat recycles, enrol again — `seats.ts` never touches the
 * ledger, so the retired principal keeps its stores (A10). Measured: ten free identities
 * minted 2,500,000 currency and 500,000 goods at zero cost.
 *
 * Before the market there was no principal-to-principal transfer verb, and that friction
 * was quietly doing the work. A market removes it: a sock puppet bids far above value for
 * its operator's junk goods and the whole stake moves, using ordinary legal orders that
 * violate nothing in the matcher.
 *
 * A15 forbids the obvious defences — capping enrolments per source is a gate priced in
 * identities, and punishing wash trades requires proving intent when "the flow graph may
 * withhold credit, never accuse". **Withholding credit is exactly what this does.** The
 * endowment funds a principal's own work — its ventures, its Levy, its hauling — and
 * cannot leave it. A solo agent is unaffected. A sock puppet is worth zero.
 *
 * ## ★ WHAT THE FLOOR WITHHELD, AND WHY IT MOVES NOW (`RULES_VERSION` 19)
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THIS FUNCTION RETURNED ZERO FOR EVERY PRINCIPAL THAT HAS EVER PLAYED THIS GAME.**
 * The floor was the whole `STARTER_STAKE` (250,000) and it never moved, while the Levy, a
 * WORKS, a graduation and a founding all charge that stake — so every cast member in every
 * world sat between 62,000 and 203,000 and `freeBalance − 250,000` clamped to 0. No BID
 * could be funded by anybody, and the buy side of the order book was unreachable **by
 * construction** for the whole life of `market/` — 3,065 lines, an ask side that works, and
 * not one fill in any world this repo has run.
 *
 * `ledger/endowment.ts` predicted the over-withholding and misjudged its size, calling it
 * *"a rounding difference nobody can spend"*. The rounding difference was the buy side.
 *
 * So the floor is now **per principal and it falls as the principal spends into world
 * sinks** — `ledger.endowments`, decremented by `Ledger.retireCurrency`, in `state_hash`.
 * `freeCash` is `freeBalance − remaining`.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * **The Sybil funnel is closed exactly as tightly as before**, and the four properties are
 * argued in full in `ledger/endowment.ts`. In one line: a retirement lowers the balance and
 * the counter by the same amount, so burning endowment is `freeCash`-neutral and cannot
 * launder a stake into transferable money — while a transfer lowers the balance alone, so
 * what a principal may send is bounded by what it was paid. A fresh identity's `freeCash`
 * is still, and always, `0`.
 */
export function freeCash(ledger: Ledger, principal: PrincipalId): Minor {
  const id = storesAccount(principal);
  if (ledger.account(id) === undefined) return minor(0);
  const free = ledger.freeBalance(id);
  return minor(Math.max(0, free - ledger.endowments.remaining(principal)));
}

/**
 * Goods a principal could still commit to a new ASK at one venue.
 *
 * Pledged lots are excluded (the lien is exclusive — the same goods must never back
 * two obligations) and `IN_TRANSIT` lots are excluded (they are not anywhere a
 * trade could settle). Both exclusions mirror `runtime.levyGoodLots`, deliberately:
 * two different answers to "what can this principal actually hand over" is the
 * disagreement §3 exists to prevent.
 */
export function sellableGoods(ledger: Ledger, principal: PrincipalId, good: GoodId, venue: VenueId): Qty {
  let total = 0;
  for (const lot of sellableLots(ledger, principal, good, venue)) total += lot.qty;
  return qty(total);
}

function sellableLots(
  ledger: Ledger,
  principal: PrincipalId,
  good: GoodId,
  venue: VenueId,
): readonly { readonly id: LotId; readonly qty: number }[] {
  const account = storesAccount(principal);
  if (ledger.account(account) === undefined) return [];
  const lots = ledger
    .lotsInAccount(account)
    .filter(
      (lot) =>
        lot.good === good &&
        lot.location === venue &&
        lot.encumbranceId === null &&
        lot.state === 'AVAILABLE',
    )
    .sort((a, b) => compareIds(a.id, b.id))
    .map((lot) => ({ id: lot.id, qty: lot.qty }));

  // D7, the goods half. The starter allotment exists so a newcomer can meet a Levy that
  // is payable only in located goods — an obligation the rules would otherwise make
  // impossible to meet on arrival, which is A5′ with our own economy as the cause. It is
  // not trading stock, and selling it is the other half of the sock-puppet extraction.
  // Withheld the same way as the cash: everything above the allotment is sellable.
  if (good !== ENDOWMENT_GOOD) return lots;
  let floor: number = ENDOWMENT_GOOD_FLOOR_QTY;
  const sellable: { readonly id: LotId; readonly qty: number }[] = [];
  for (const lot of lots) {
    if (floor <= 0) {
      sellable.push(lot);
      continue;
    }
    const withheld = Math.min(floor, lot.qty);
    floor -= withheld;
    if (lot.qty > withheld) sellable.push({ id: lot.id, qty: lot.qty - withheld });
  }
  return sellable;
}

/** Goods this principal currently has escrowed for one book. The matcher's ceiling. */
export function escrowedGoods(ledger: Ledger, principal: PrincipalId, good: GoodId, venue: VenueId): Qty {
  let total = 0;
  for (const lot of escrowLots(ledger, principal, good, venue)) total += lot.qty;
  return qty(total);
}

function escrowLots(
  ledger: Ledger,
  principal: PrincipalId,
  good: GoodId,
  venue: VenueId,
): readonly { readonly id: LotId; readonly qty: number }[] {
  const account = marketEscrowAccount(principal);
  if (ledger.account(account) === undefined) return [];
  return ledger
    .lotsInAccount(account)
    .filter((lot) => lot.good === good && lot.location === venue && lot.encumbranceId === null)
    .sort((a, b) => compareIds(a.id, b.id))
    .map((lot) => ({ id: lot.id, qty: lot.qty }));
}

/** The currency a BID's lock still holds, or zero once it is released. */
export function lockedCash(ledger: Ledger, encumbranceId: string | null): Minor {
  if (encumbranceId === null) return minor(0);
  if (!ledger.encumbrances.isOpen(encumbranceId)) return minor(0);
  return ledger.encumbrances.get(encumbranceId)?.amountMinor ?? minor(0);
}

/**
 * Lock the maximum cash a BID could ever spend: `remaining x limit_price`.
 *
 * The *maximum*, because the fill may be at a better price — the difference is
 * released as the order fills rather than held hostage. Returns `null` when the
 * lock could not be created, and the caller must then refuse the order outright.
 */
export function lockOrderCash(args: {
  readonly ledger: Ledger;
  readonly principal: PrincipalId;
  readonly order: OrderId;
  readonly amount: Minor;
  readonly tick: number;
}): string | null {
  if (args.amount <= 0) return null;
  const account = storesAccount(args.principal);
  if (args.ledger.account(account) === undefined) return null;
  if (args.ledger.freeBalance(account) < args.amount) return null;
  try {
    return args.ledger.encumbrances.lockSafe({
      eventId: lockEvent(args.principal),
      tick: args.tick,
      principal: args.principal,
      account,
      amountMinor: args.amount,
      obligationRef: orderObligation(args.order),
    });
  } catch {
    // The book refused a lock the affordability check said was fine. That is our
    // bug, not the agent's, and the honest answer is still a refusal rather than an
    // order with nothing behind it.
    return null;
  }
}

/**
 * Draw down a BID's lock as it pays, **at its own limit price**.
 *
 * The lock was sized at the limit, so a fill of `q` retires `q x limit` of it
 * whatever the fill price was; the price improvement simply becomes free cash
 * again. Returns what the lock actually gave up.
 */
export function drawLock(ledger: Ledger, encumbranceId: string, amount: Minor): Minor {
  if (amount <= 0) return minor(0);
  if (!ledger.encumbrances.isOpen(encumbranceId)) return minor(0);
  return ledger.encumbrances.reduce(encumbranceId, amount);
}

/** Release a closed order's lock. Idempotent: a released row is left alone. */
export function releaseLock(ledger: Ledger, encumbranceId: string | null, tick: number): void {
  if (encumbranceId === null) return;
  if (!ledger.encumbrances.isOpen(encumbranceId)) return;
  ledger.encumbrances.release(encumbranceId, tick);
}

/**
 * Move `amount` of a good from a seller's STORES into its market escrow.
 *
 * All-or-nothing. The plan is computed and checked against the requested amount
 * *before* the first lot moves, and if a leg the ledger had already accepted is
 * followed by one it refuses, everything that moved is moved back. The caller sees
 * `true` only when the full amount is escrowed.
 */
export function escrowGoods(args: {
  readonly ledger: Ledger;
  readonly principal: PrincipalId;
  readonly good: GoodId;
  readonly venue: VenueId;
  readonly amount: Qty;
  readonly tick: number;
  readonly order: OrderId;
}): boolean {
  const { ledger, principal, good, venue, amount } = args;
  if (amount <= 0) return false;
  const plan = drawPlan(sellableLots(ledger, principal, good, venue), amount);
  if (plan === null) return false;
  const to = ensureMarketEscrow(ledger, principal);

  let moved = 0;
  try {
    for (const [index, leg] of plan.entries()) {
      ledger.transferGoods({
        eventId: `mkt.escrow:${args.order}` as EventId,
        tick: args.tick,
        lotId: leg.id,
        to,
        qty: qty(leg.take),
        openIndex: index,
      });
      moved += leg.take;
    }
    return true;
  } catch {
    if (moved > 0) {
      // Unwind, under a distinct event id so the returning lots cannot collide with
      // the ids the outbound legs already minted.
      releaseGoods({
        ledger,
        principal,
        good,
        venue,
        amount: qty(moved),
        tick: args.tick,
        label: `mkt.unwind:${args.order}`,
      });
    }
    return false;
  }
}

/**
 * Return escrowed goods to their owner's STORES — a cancel, an expiry, or the
 * unfilled remainder of an IOC.
 *
 * **Exactly what it locked**, which for a fungible good is the quantity: the units
 * come back to the same principal, at the same venue, as the same good. Provenance
 * can be reshuffled inside one principal's own escrow pool when two of its lots
 * merged there; that is a property of pooling identical goods owned by one party
 * and is stated here rather than discovered later.
 */
export function releaseGoods(args: {
  readonly ledger: Ledger;
  readonly principal: PrincipalId;
  readonly good: GoodId;
  readonly venue: VenueId;
  readonly amount: Qty;
  readonly tick: number;
  readonly label: string;
}): Qty {
  const { ledger, principal, good, venue } = args;
  if (args.amount <= 0) return qty(0);
  const plan = drawPlan(escrowLots(ledger, principal, good, venue), args.amount);
  if (plan === null) return qty(0);
  const to = storesAccount(principal);
  if (ledger.account(to) === undefined) return qty(0);

  let moved = 0;
  for (const [index, leg] of plan.entries()) {
    try {
      ledger.transferGoods({
        eventId: args.label as EventId,
        tick: args.tick,
        lotId: leg.id,
        to,
        qty: qty(leg.take),
        openIndex: index,
      });
      moved += leg.take;
    } catch {
      // Never throws outward: a release runs inside a phase, and a throw there
      // aborts a tick that has already settled other business.
      break;
    }
  }
  return qty(moved);
}

/**
 * Hand escrowed goods to a buyer. The physical half of a fill.
 *
 * Returns what actually moved and how many lot legs it took, because the fill
 * audit (MKT-4) recomputes the movement from the posting log by a second road and
 * needs to know which event ids to look under.
 */
export function deliverGoods(args: {
  readonly ledger: Ledger;
  readonly seller: PrincipalId;
  readonly buyer: PrincipalId;
  readonly good: GoodId;
  readonly venue: VenueId;
  readonly amount: Qty;
  readonly tick: number;
  readonly eventBase: string;
}): { readonly moved: Qty; readonly legs: number } {
  const { ledger, seller, good, venue } = args;
  const plan = drawPlan(escrowLots(ledger, seller, good, venue), args.amount);
  if (plan === null) return { moved: qty(0), legs: 0 };
  const to = storesAccount(args.buyer);
  if (ledger.account(to) === undefined) return { moved: qty(0), legs: 0 };

  let moved = 0;
  let legs = 0;
  for (const [index, leg] of plan.entries()) {
    ledger.transferGoods({
      eventId: goodsLegEvent(args.eventBase, index) as EventId,
      tick: args.tick,
      lotId: leg.id,
      to,
      qty: qty(leg.take),
      openIndex: 0,
    });
    moved += leg.take;
    legs += 1;
  }
  return { moved: qty(moved), legs };
}

/** The event id of one goods leg of a fill. One home, so the audit can rebuild it. */
export function goodsLegEvent(eventBase: string, index: number): string {
  return `${eventBase}:g${String(index)}`;
}

/** The event id of the currency leg of a fill. */
export function cashLegEvent(eventBase: string): string {
  return `${eventBase}:cash`;
}

/**
 * Which lots to draw from, in canonical id order, to make exactly `amount`.
 *
 * `null` when the lots do not hold that much — the caller must refuse rather than
 * take what it can find, because a partly-escrowed order is a fake order.
 */
function drawPlan(
  lots: readonly { readonly id: LotId; readonly qty: number }[],
  amount: Qty,
): readonly { readonly id: LotId; readonly take: number }[] | null {
  let left: number = amount;
  const plan: { id: LotId; take: number }[] = [];
  for (const lot of lots) {
    if (left <= 0) break;
    const take = Math.min(left, lot.qty);
    if (take <= 0) continue;
    plan.push({ id: lot.id, take });
    left -= take;
  }
  return left > 0 ? null : plan;
}
