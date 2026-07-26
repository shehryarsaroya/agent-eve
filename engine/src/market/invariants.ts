/**
 * MKT-1 … MKT-7 — what must be true about the book at every tick close, forever.
 *
 * These are **not** new entries in `invariants/registry.ts`. That register is
 * TESTING.md §3's twenty-six, cross-checked against the document, and quietly
 * growing it would make "the 26 invariants" a number nobody can trust. So the
 * market's clauses carry their own prefix and are supplied through the tick loop's
 * `assertions` hook, which merges them into the same ASSERT pass and halts the tick
 * on the same terms. `registry.severityRank` ranks an unknown id at 99, so an
 * MKT violation sorts below every named invariant in a halt report — correct: a
 * broken book is serious and it is not a fabricated default.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE DIRECTION OF EVERY ESCROW CLAUSE IS DELIBERATE.**
 *
 * The obvious phrasing is "escrow always *covers* every open order". It is wrong as
 * a standing assertion, and writing it would have built a false-halt generator into
 * the one phase with an audience. PROP-L3: an encumbrance is a claim on a thing,
 * never armour over it — an audit seizure legitimately drains a locked account and
 * the lock yields. Under the covering phrasing, a raided buyer's perfectly innocent
 * resting order would halt the world, and "a false halt is the same class of bug as
 * a false default" (SPEC §15.4).
 *
 * So the *covering* half is enforced **at the door**, in `place.ts`, where a
 * shortfall is still a hint and an order that cannot be escrowed is refused rather
 * than half-placed. What is asserted here forever is the half predation cannot
 * falsify: **escrow never exceeds what the open remainder requires**, i.e. no value
 * is locked for nothing. A shortfall is instead expressed by the matcher as a
 * smaller fill (`match.ts`), which is the honest outcome and needs no halt.
 * ══════════════════════════════════════════════════════════════════════════
 */

import type { GoodId, InvariantViolation, PrincipalId } from '../core/types.js';
import type { Ledger } from '../ledger/index.js';
import { compareIds } from '../ledger/index.js';
import { halt } from '../invariants/registry.js';
import { MarketBook, type ClosedOrder, type Fill } from './book.js';
import { cashLegEvent, escrowedGoods, goodsLegEvent, marketEscrowAccount } from './escrow.js';
import { multiplyPrice, remainingOf, type Order, type OrderId, type VenueId } from './order.js';
import { storesAccount } from '../ledger/index.js';
import { selfCrossing } from './place.js';

export interface MarketInvariantInputs {
  readonly book: MarketBook;
  readonly ledger: Ledger;
  readonly tick: number;
}

/** Every market clause, in id order. The one call the ASSERT hook makes. */
export function checkMarketInvariants(input: MarketInvariantInputs): readonly InvariantViolation[] {
  return [
    ...checkMkt1(input),
    ...checkMkt2(input),
    ...checkMkt3(input),
    ...checkMkt4(input),
    ...checkMkt5(input),
    ...checkMkt6(input),
    ...checkMkt7(input),
  ];
}

/**
 * **MKT-1** — escrowed goods never exceed what the open asks still owe.
 *
 * Per `(principal, good, venue)`, because that triple is one book's escrow pool:
 * a seller's asks on one book all draw the same pile (see `escrow.ts` on why the
 * account is per-principal and the location does the rest of the work).
 *
 * Over-escrow means goods locked behind nothing — an agent's inventory silently
 * unspendable, which is a quiet theft rather than a loud one.
 */
export function checkMkt1(input: MarketInvariantInputs): readonly InvariantViolation[] {
  const { book, ledger, tick } = input;
  const out: InvariantViolation[] = [];
  const owed = new Map<string, number>();
  const keys = new Map<string, { principal: PrincipalId; good: GoodId; venue: VenueId }>();

  for (const order of book.open()) {
    if (order.side !== 'ASK') continue;
    const key = poolKey(order.principal, order.good, order.venue);
    keys.set(key, { principal: order.principal, good: order.good, venue: order.venue });
    owed.set(key, (owed.get(key) ?? 0) + remainingOf(order));
  }
  // Every pool that holds anything, whether or not an order still points at it —
  // a pool with escrow and no order is exactly the leak this clause exists to find.
  for (const lot of ledger.allLots()) {
    const account = ledger.account(lot.account);
    if (account === undefined || account.kind !== 'ESCROW' || account.principal === null) continue;
    if (lot.account !== marketEscrowAccount(account.principal)) continue;
    const key = poolKey(account.principal, lot.good, lot.location);
    if (!keys.has(key)) {
      keys.set(key, { principal: account.principal, good: lot.good, venue: lot.location });
    }
  }

  for (const key of [...keys.keys()].sort(compareIds)) {
    const at = keys.get(key);
    if (at === undefined) continue;
    const held = escrowedGoods(ledger, at.principal, at.good, at.venue);
    const need = owed.get(key) ?? 0;
    if (held > need) {
      out.push(
        halt(
          'MKT-1',
          tick,
          `${at.principal} has ${String(held)} of ${at.good} escrowed at ${at.venue} but its open asks owe ` +
            `only ${String(need)}; ${String(held - need)} is locked behind no order`,
        ),
      );
    }
  }
  return out;
}

/**
 * **MKT-2** — a bid's cash lock never exceeds `remaining x limit_price`, and it
 * belongs to that order.
 *
 * The second half matters as much as the first: a lock whose `obligationRef` names
 * a different order is a lock INV-4 would keep alive for the wrong reason, and it
 * would survive the right order's cancellation.
 */
export function checkMkt2(input: MarketInvariantInputs): readonly InvariantViolation[] {
  const { book, ledger, tick } = input;
  const out: InvariantViolation[] = [];
  for (const order of book.open()) {
    if (order.side !== 'BID') continue;
    const id = order.encumbranceId;
    if (id === null) continue;
    const row = ledger.encumbrances.get(id);
    if (row === undefined) continue;
    if (!ledger.encumbrances.isOpen(id)) continue;
    const cap = multiplyPrice(order.limitPrice, remainingOf(order));
    if (row.amountMinor > cap) {
      out.push(
        halt(
          'MKT-2',
          tick,
          `bid ${order.id} locks ${String(row.amountMinor)} but its remaining ${String(remainingOf(order))} ` +
            `at ${String(order.limitPrice)} needs at most ${String(cap)}`,
        ),
      );
    }
    if (String(row.obligationRef) !== String(order.id)) {
      out.push(
        halt('MKT-2', tick, `bid ${order.id} is backed by ${id}, which is locked for ${String(row.obligationRef)}`),
      );
    }
    if (row.account !== storesAccount(order.principal)) {
      out.push(halt('MKT-2', tick, `bid ${order.id}'s lock sits in ${row.account}, not its principal's STORES`));
    }
  }
  return out;
}

/**
 * **MKT-3** — every open bid has an open lock behind it.
 *
 * The converse of INV-4, which asks whether a lock's obligation is alive but never
 * whether an obligation has its lock (market orders are deliberately not in
 * `securedObligations()` — an ask holds goods, not currency, so a blanket
 * requirement there would be false for half the book). An open bid without a live
 * lock is exactly the fake liquidity full escrow exists to prevent.
 */
export function checkMkt3(input: MarketInvariantInputs): readonly InvariantViolation[] {
  const { book, ledger, tick } = input;
  const out: InvariantViolation[] = [];
  for (const order of book.open()) {
    if (order.side !== 'BID') continue;
    if (order.encumbranceId === null) {
      out.push(halt('MKT-3', tick, `bid ${order.id} rests on the book with no escrow at all`));
      continue;
    }
    if (!ledger.encumbrances.isOpen(order.encumbranceId)) {
      out.push(
        halt('MKT-3', tick, `bid ${order.id} names lock ${order.encumbranceId}, which is not open`),
      );
    }
  }
  return out;
}

/**
 * **MKT-4** — every fill this tick reconciles against the posting log, by a second
 * road.
 *
 * The market's A5′ clause. `posting` is authoritative for value (§15.1), so the
 * fill record is a *claim* and the postings are the fact; this recomputes the claim
 * from the fact and refuses any disagreement. It is what catches a torn fill —
 * goods handed over and payment never made, or the reverse — which is the one
 * failure in this module that would put a lie in an append-only record.
 *
 * Scoped to the current tick because postings are truncated on rollback with the
 * fills, so the pair is always consistent, and walking the whole log every tick
 * would grow without bound.
 */
export function checkMkt4(input: MarketInvariantInputs): readonly InvariantViolation[] {
  const { book, ledger, tick } = input;
  const out: InvariantViolation[] = [];
  for (const fill of book.fillsAt(tick)) {
    out.push(...checkFill(ledger, fill, tick));
  }
  return out;
}

function checkFill(ledger: Ledger, fill: Fill, tick: number): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const payment = multiplyPrice(fill.unitPrice, fill.qty);

  const cash = ledger.postingsFor(cashLegEvent(fill.id) as Parameters<Ledger['postingsFor']>[0]);
  const fromBuyer = sumAt(cash, storesAccount(fill.buyer));
  const toSeller = sumAt(cash, storesAccount(fill.seller));
  if (cash.length !== 2 || fromBuyer !== 0 - payment || toSeller !== payment) {
    out.push(
      halt(
        'MKT-4',
        tick,
        `fill ${fill.id} claims ${String(fill.qty)} at ${String(fill.unitPrice)} = ${String(payment)}, but its ` +
          `currency leg posts ${String(cash.length)} rows moving ${String(fromBuyer)} / ${String(toSeller)}`,
      ),
    );
  }

  let moved = 0;
  let released = 0;
  for (let i = 0; i < fill.goodsLegs; i += 1) {
    const leg = ledger.postingsFor(goodsLegEvent(fill.id, i) as Parameters<Ledger['postingsFor']>[0]);
    for (const p of leg) {
      if (p.good !== fill.good || p.amountQty === null) continue;
      if (p.account === storesAccount(fill.buyer)) moved += p.amountQty;
      if (p.account === marketEscrowAccount(fill.seller)) released += p.amountQty;
    }
  }
  if (moved !== fill.qty || released !== 0 - fill.qty) {
    out.push(
      halt(
        'MKT-4',
        tick,
        `fill ${fill.id} claims ${String(fill.qty)} of ${fill.good} but its goods legs move ${String(moved)} ` +
          `to the buyer and ${String(released)} out of the seller's escrow`,
      ),
    );
  }
  return out;
}

function sumAt(postings: readonly { account: string; amountMinor: number }[], account: string): number {
  let total = 0;
  for (const p of postings) if (p.account === account) total += p.amountMinor;
  return total;
}

/**
 * **MKT-5** — no fill was worse than either side's limit.
 *
 * True by construction (`crossPrice` returns one of the two limits and only when
 * they cross) and asserted anyway, because "true by construction" is a claim about
 * code that changes and this is a claim about the record, which does not.
 */
export function checkMkt5(input: MarketInvariantInputs): readonly InvariantViolation[] {
  const { book, tick } = input;
  const out: InvariantViolation[] = [];
  const limits = limitIndex(book);
  for (const fill of book.fillsAt(tick)) {
    const bid = limits.get(fill.bid);
    const ask = limits.get(fill.ask);
    if (bid !== undefined && fill.unitPrice > bid) {
      out.push(
        halt('MKT-5', tick, `fill ${fill.id} paid ${String(fill.unitPrice)} against a bid limit of ${String(bid)}`),
      );
    }
    if (ask !== undefined && fill.unitPrice < ask) {
      out.push(
        halt('MKT-5', tick, `fill ${fill.id} sold at ${String(fill.unitPrice)} against an ask limit of ${String(ask)}`),
      );
    }
    if (fill.buyer === fill.seller) {
      // The exploit `ledger/valuation.ts` names as the most dangerous in the game.
      // A print with one principal on both sides must never exist, at any price.
      out.push(halt('MKT-5', tick, `fill ${fill.id} has ${fill.buyer} on both sides; a self-match is never a print`));
    }
  }
  return out;
}

/** **MKT-6** — filled quantity is between zero and what was ordered, always. */
export function checkMkt6(input: MarketInvariantInputs): readonly InvariantViolation[] {
  const { book, tick } = input;
  const out: InvariantViolation[] = [];
  const rows: readonly (Order | ClosedOrder)[] = [...book.all(), ...book.closed()];
  for (const row of rows) {
    if (row.filled < 0 || row.filled > row.quantity) {
      out.push(
        halt('MKT-6', tick, `order ${row.id} is filled ${String(row.filled)} of ${String(row.quantity)}`),
      );
    }
  }
  return out;
}

/**
 * **MKT-7** — no principal rests on both sides of one book at crossing prices.
 *
 * The standing proof that `place.ts`'s door works. If this ever fires, a
 * self-matched print is one tick away — and a printed price nobody paid is what
 * turns a thin book into custody of everyone else's assets.
 */
export function checkMkt7(input: MarketInvariantInputs): readonly InvariantViolation[] {
  const { book, tick } = input;
  const out: InvariantViolation[] = [];
  const byPrincipal = new Map<PrincipalId, Order[]>();
  for (const order of book.open()) {
    const rows = byPrincipal.get(order.principal) ?? [];
    rows.push(order);
    byPrincipal.set(order.principal, rows);
  }
  for (const rows of byPrincipal.values()) {
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        const a = rows[i];
        const b = rows[j];
        if (a === undefined || b === undefined) continue;
        if (!selfCrossing(a, b)) continue;
        out.push(
          halt('MKT-7', tick, `${a.principal} rests ${a.id} and ${b.id} on one book at crossing prices`),
        );
      }
    }
  }
  return out;
}

function limitIndex(book: MarketBook): ReadonlyMap<OrderId, number> {
  const out = new Map<OrderId, number>();
  for (const o of book.all()) out.set(o.id, o.limitPrice);
  for (const c of book.closed()) if (!out.has(c.id)) out.set(c.id, c.limitPrice);
  return out;
}

function poolKey(principal: PrincipalId, good: GoodId, venue: VenueId): string {
  return `${principal}::${good}::${venue}`;
}
