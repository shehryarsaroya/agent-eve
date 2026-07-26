/**
 * D7 — the endowment cannot leave the principal it was minted for.
 *
 * Enrolment is free and must stay free (A15), so free identities mint capital and seat
 * recycling makes it unbounded. The market removed the last friction on concentrating it.
 * A15's sanctioned defence is to WITHHOLD CREDIT rather than accuse, so the endowment
 * funds a principal's own work and cannot be committed to a trade.
 */
import { describe, expect, it } from 'vitest';
import { Ledger, storesAccount, CURRENCY_FAUCET, GOODS_FAUCET } from '../../src/ledger/index.js';
import { freeCash, sellableGoods } from '../../src/market/escrow.js';
import {
  ENDOWMENT_GOOD,
  ENDOWMENT_GOOD_FLOOR_QTY,
  STARTER_STAKE,
} from '../../src/ledger/endowment.js';
import { minor, qty } from '../../src/core/units.js';
import type { EventId, PrincipalId, SystemId } from '../../src/core/types.js';

const SOCK = 'p:sock' as PrincipalId;
const HOME = 's:kell' as SystemId;

function enrolled(extraCash = 0, extraGoods = 0): Ledger {
  const led = new Ledger();
  led.openAccount(storesAccount(SOCK), 'STORES', SOCK);
  led.issueCurrency({
    eventId: 'e:enrol' as EventId, tick: 0,
    faucet: CURRENCY_FAUCET.STARTER_STAKE,
    to: storesAccount(SOCK), amount: minor(STARTER_STAKE + extraCash),
  });
  led.sourceGoods({
    eventId: 'e:goods' as EventId, tick: 0,
    faucet: GOODS_FAUCET.PRODUCTION, to: storesAccount(SOCK),
    good: ENDOWMENT_GOOD, qty: qty(ENDOWMENT_GOOD_FLOOR_QTY + extraGoods),
    location: HOME, origin: SOCK,
  });
  return led;
}

describe('D7 — a free identity is worth nothing to its operator', () => {
  it('a freshly enrolled principal can commit NOTHING to a market BID', () => {
    const led = enrolled();
    expect(led.balance(storesAccount(SOCK))).toBe(STARTER_STAKE);
    expect(freeCash(led, SOCK), 'the endowment is not trading capital').toBe(0);
  });

  it('a freshly enrolled principal can SELL none of its allotment', () => {
    const led = enrolled();
    expect(sellableGoods(led, SOCK, ENDOWMENT_GOOD, HOME)).toBe(0);
  });

  it('but everything EARNED above the endowment is freely tradeable', () => {
    // The guard must not punish a real agent. Only the minted floor is withheld.
    const led = enrolled(40_000, 900);
    expect(freeCash(led, SOCK)).toBe(40_000);
    expect(sellableGoods(led, SOCK, ENDOWMENT_GOOD, HOME)).toBe(900);
  });

  it('the floor is per-principal, so N identities concentrate N x 0', () => {
    // The actual Sybil arithmetic: ten free identities used to mint 2,500,000 of
    // transferable currency. They now mint 2,500,000 of unspendable-elsewhere stake.
    let transferable = 0;
    for (let i = 0; i < 10; i += 1) {
      const led = new Ledger();
      const p = `p:sock${String(i)}` as PrincipalId;
      led.openAccount(storesAccount(p), 'STORES', p);
      led.issueCurrency({
        eventId: `e:${String(i)}` as EventId, tick: 0,
        faucet: CURRENCY_FAUCET.STARTER_STAKE, to: storesAccount(p), amount: STARTER_STAKE,
      });
      transferable += freeCash(led, p);
    }
    expect(transferable, 'a fleet of free identities must yield zero tradeable capital').toBe(0);
  });
});
