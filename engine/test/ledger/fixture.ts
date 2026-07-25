/**
 * Shared ledger fixture.
 *
 * Deliberately tiny and deliberately shared: every test in this directory builds
 * the same world so a failure message means the same thing in all of them. No
 * clock, no `Math.random` — event ids are strings the test chooses, which is also
 * how replay works (DET-3).
 */

import type { AccountId, EventId, GoodId, PrincipalId, SystemId, VentureId } from '../../src/core/types.js';
import { minor, qty, type Minor, type Qty } from '../../src/core/units.js';
import {
  CURRENCY_FAUCET,
  GOODS_FAUCET,
  Ledger,
  SimpleObligationBook,
  escrowAccount,
  openStores,
  openVentureEscrow,
  storesAccount,
  type LotId,
} from '../../src/ledger/index.js';

export const ALICE = 'alice' as PrincipalId;
export const BOB = 'bob' as PrincipalId;
export const CARA = 'cara' as PrincipalId;

export const ORE = 'ore' as GoodId;
export const RATIONS = 'rations' as GoodId;

export const HOME = 'sys-home' as SystemId;
export const REACH = 'sys-reach' as SystemId;

export const HAUL_1 = 'venture-haul-1' as VentureId;

export const A_STORES: AccountId = storesAccount(ALICE);
export const B_STORES: AccountId = storesAccount(BOB);
export const C_STORES: AccountId = storesAccount(CARA);
export const HAUL_ESCROW: AccountId = escrowAccount(HAUL_1, ALICE);

export function ev(name: string): EventId {
  return name as EventId;
}

export interface Fixture {
  readonly ledger: Ledger;
  readonly obligations: SimpleObligationBook;
}

/** Three principals with stores, one venture escrow, and no value yet. */
export function emptyWorld(): Fixture {
  const ledger = new Ledger();
  openStores(ledger, ALICE);
  openStores(ledger, BOB);
  openStores(ledger, CARA);
  openVentureEscrow(ledger, HAUL_1, ALICE);
  return { ledger, obligations: new SimpleObligationBook() };
}

/** Fund a principal's stores from the starter stake, the way enrolment does. */
export function fund(f: Fixture, to: AccountId, amount: Minor, eventId = ev('fund')): void {
  f.ledger.issueCurrency({
    eventId,
    tick: 0,
    faucet: CURRENCY_FAUCET.STARTER_STAKE,
    to,
    amount,
  });
}

/** Extract goods into an account, the way a DIG does. */
export function mine(
  f: Fixture,
  to: AccountId,
  origin: PrincipalId,
  good: GoodId,
  amount: Qty,
  eventId = ev('mine'),
  location: SystemId = HOME,
): LotId {
  return f.ledger.sourceGoods({
    eventId,
    tick: 0,
    faucet: GOODS_FAUCET.EXTRACTION,
    to,
    good,
    qty: amount,
    location,
    origin,
  });
}

/** A world with money and cargo, ready for a venture. */
export function fundedWorld(): Fixture {
  const f = emptyWorld();
  fund(f, A_STORES, minor(100_000), ev('fund:alice'));
  fund(f, B_STORES, minor(50_000), ev('fund:bob'));
  fund(f, C_STORES, minor(25_000), ev('fund:cara'));
  mine(f, A_STORES, ALICE, ORE, qty(120), ev('mine:alice-ore'));
  mine(f, B_STORES, BOB, RATIONS, qty(40), ev('mine:bob-rations'));
  return f;
}
