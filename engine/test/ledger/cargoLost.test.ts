/**
 * PROP-L3 and INV-6 — encumbered assets are destructible, and the payout arithmetic
 * is exact.
 *
 * PROP-L3 is the branch the design cannot do without:
 *
 *   > Encumbered assets are destructible. An encumbrance is a claim on a thing, not
 *   > a shield over it — otherwise agents would encumber everything to become
 *   > raid-proof and the loss sink would die. — SPEC §10.2
 *
 * And the half that keeps A5′ intact: a `CARGO_LOST` shortfall is a **recorded
 * loss, not a default**. A default is the game saying an agent broke its word, it
 * is permanent, and it is public. Getting that wrong is worse than a crash.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { minor, qty, sumMinor, type Minor } from '../../src/core/units.js';
import type { AccountId, EventId } from '../../src/core/types.js';
import {
  GOODS_SINK,
  WaterfallError,
  allocateProRata,
  assertPayoutsExact,
  checkLedgerInvariants,
  payByPriority,
  resolveCargoLost,
  type Claim,
} from '../../src/ledger/index.js';
import {
  A_STORES,
  ALICE,
  B_STORES,
  C_STORES,
  HAUL_1,
  HAUL_ESCROW,
  ORE,
  emptyWorld,
  ev,
  fund,
  mine,
  type Fixture,
} from './fixture.js';

/** A haul with cargo pledged to the venture and money sitting in escrow. */
function loadedHaul(escrowAmount: Minor, cargo = qty(60)): { f: Fixture; lot: ReturnType<typeof mine>; enc: string } {
  const f = emptyWorld();
  fund(f, A_STORES, minor(50_000), ev('fund:a'));
  f.obligations.open(HAUL_1);
  const lot = mine(f, A_STORES, ALICE, ORE, cargo, ev('dig'));
  const enc = f.ledger.encumbrances.lock({
    eventId: 'lock:haul',
    tick: 1,
    principal: ALICE,
    account: A_STORES,
    amountMinor: minor(5_000),
    obligationRef: HAUL_1,
    maxDirectLoss: minor(5_000),
  });
  f.ledger.pledgeLot(lot, enc);
  // An empty escrow is a legitimate state — it is what a venture looks like when a
  // raid drained it before settlement (SPEC §15.4) — so zero funds no transfer
  // rather than an invalid one.
  if (escrowAmount > 0) {
    f.ledger.transferCurrency({
      eventId: ev('escrowIn'),
      tick: 1,
      from: A_STORES,
      to: HAUL_ESCROW,
      amount: escrowAmount,
    });
  }
  return { f, lot, enc };
}

describe('PROP-L3 encumbered assets are destructible', () => {
  it('destroys pledged cargo, pays the escrow by priority, and records a loss — not a default', () => {
    // Escrow holds 1,000. Claims total 1,500: a senior wage of 1,000 and a junior
    // share of 500. The cargo is pledged, and it burns anyway.
    const { f, lot, enc } = loadedHaul(minor(1_000));
    const claims: readonly Claim[] = [
      { account: B_STORES, priority: 0, amount: minor(1_000), key: 'role:1:wage' },
      { account: C_STORES, priority: 1, amount: minor(500), key: 'role:2:share' },
    ];

    const outcome = resolveCargoLost(f.ledger, {
      eventId: ev('raid:intercept'),
      tick: 5,
      venture: HAUL_1,
      escrow: HAUL_ESCROW,
      lost: [{ lotId: lot, qty: qty(60) }],
      claims,
      perilReleased: [],
      causeEventId: ev('predation:c-intercepts'),
    });

    // 1. The goods died. The lien did not save them.
    expect(f.ledger.lot(lot)).toBeUndefined();
    expect(outcome.destroyed.get(ORE)).toBe(60);
    expect(f.ledger.account(GOODS_SINK.LOSS)?.movedQty.get(ORE)).toBe(60);
    expect(f.ledger.goodsSupply().get(ORE)).toMatchObject({ available: 0, issued: 60, retired: 60 });

    // 2. The escrow still paid, in seniority order, against the reduced proceeds.
    expect(outcome.proceeds).toBe(1_000);
    expect(outcome.payouts.map((p) => [p.account, p.paid])).toEqual([
      [B_STORES, 1_000],
      [C_STORES, 0],
    ]);
    expect(f.ledger.balance(B_STORES)).toBe(1_000);
    expect(f.ledger.balance(C_STORES)).toBe(0);
    expect(f.ledger.balance(HAUL_ESCROW)).toBe(0);

    // 3. sum(payouts) == proceeds, against the reduced proceeds.
    expect(sumMinor(outcome.payouts.map((p) => p.paid))).toBe(outcome.proceeds);
    expect(outcome.shortfall).toBe(500);
    expect(outcome.surplus).toBe(0);

    // 4. It is a recorded loss with an attributable cause, and it is not a default.
    expect(outcome.isDefault).toBe(false);
    expect(outcome.causeEventId).toBe('predation:c-intercepts');

    // 5. The whole ledger still balances, and the lien is not left an orphan.
    expect(f.ledger.encumbrances.isOpen(enc)).toBe(true);
    expect(checkLedgerInvariants(f.ledger, { tick: 5, obligations: f.obligations })).toEqual([]);
  });

  it('charges the loss sink for exactly what burned, and nothing twice (scar #5)', () => {
    const { f, lot } = loadedHaul(minor(400), qty(30));
    resolveCargoLost(f.ledger, {
      eventId: ev('front'),
      tick: 9,
      venture: HAUL_1,
      escrow: HAUL_ESCROW,
      lost: [{ lotId: lot, qty: qty(12) }],
      claims: [{ account: B_STORES, priority: 0, amount: minor(400), key: 'wage' }],
      perilReleased: [],
      causeEventId: ev('front:reckoning-3'),
    });
    // 12 destroyed, not 24. Scar #5 destroyed exactly 2x the real value by summing a
    // quantity and its mirror; the assertion is written where that bug would live.
    expect(f.ledger.account(GOODS_SINK.LOSS)?.movedQty.get(ORE)).toBe(12);
    expect(f.ledger.requireLot(lot).qty).toBe(18);
    expect(checkLedgerInvariants(f.ledger, { tick: 9, obligations: f.obligations })).toEqual([]);
  });

  it('pays every claim in full and leaves the surplus in escrow when the pot is deep', () => {
    const { f, lot } = loadedHaul(minor(3_000));
    const outcome = resolveCargoLost(f.ledger, {
      eventId: ev('raid'),
      tick: 5,
      venture: HAUL_1,
      escrow: HAUL_ESCROW,
      lost: [{ lotId: lot, qty: qty(60) }],
      claims: [
        { account: B_STORES, priority: 0, amount: minor(1_000), key: 'wage' },
        { account: C_STORES, priority: 1, amount: minor(500), key: 'share' },
      ],
      perilReleased: [],
      causeEventId: ev('cause'),
    });
    expect(outcome.shortfall).toBe(0);
    expect(outcome.surplus).toBe(1_500);
    expect(f.ledger.balance(HAUL_ESCROW)).toBe(1_500);
    expect(checkLedgerInvariants(f.ledger, { tick: 5, obligations: f.obligations })).toEqual([]);
  });

  it('pays a short pot pro-rata inside a seniority band', () => {
    const { f, lot } = loadedHaul(minor(1_000));
    const outcome = resolveCargoLost(f.ledger, {
      eventId: ev('raid'),
      tick: 5,
      venture: HAUL_1,
      escrow: HAUL_ESCROW,
      lost: [{ lotId: lot, qty: qty(60) }],
      claims: [
        { account: B_STORES, priority: 0, amount: minor(1_200), key: 'a' },
        { account: C_STORES, priority: 0, amount: minor(800), key: 'b' },
      ],
      perilReleased: [],
      causeEventId: ev('cause'),
    });
    // 1,000 across 1,200 and 800 pro-rata is 600 and 400, exactly.
    expect(outcome.payouts.map((p) => p.paid)).toEqual([600, 400]);
    expect(sumMinor(outcome.payouts.map((p) => p.paid))).toBe(1_000);
  });

  it('refuses to be called with nothing destroyed', () => {
    const { f } = loadedHaul(minor(500));
    expect(() =>
      resolveCargoLost(f.ledger, {
        eventId: ev('nothing'),
        tick: 3,
        venture: HAUL_1,
        escrow: HAUL_ESCROW,
        lost: [],
        claims: [],
        perilReleased: [],
      causeEventId: ev('cause'),
      }),
    ).toThrow(/needs at least one destroyed lot/);
  });

  it('sheds the peril of cargo that no longer exists, and leaves the lock open', () => {
    const { f, lot, enc } = loadedHaul(minor(1_000));
    // 5,000 locked in currency, and the cargo pledged on top of it was valued at
    // 5,000 when the terms were signed. Both are inside the same commitment.
    expect(f.ledger.encumbrances.cachedExposure(ALICE)).toBe(5_000);
    const outcome = resolveCargoLost(f.ledger, {
      eventId: ev('front'),
      tick: 6,
      venture: HAUL_1,
      escrow: HAUL_ESCROW,
      lost: [{ lotId: lot, qty: qty(60) }],
      claims: [{ account: B_STORES, priority: 0, amount: minor(2_000), key: 'wage' }],
      // The value the cargo was pinned at, supplied by the caller: re-deriving it at
      // the current mark here is precisely the false-default mechanism (SPEC §15.4).
      perilReleased: [{ encumbranceId: enc, amount: minor(3_000) }],
      causeEventId: ev('front:reckoning-4'),
    });
    expect(outcome.perilShed).toEqual([{ id: enc, shed: minor(3_000) }]);
    expect(f.ledger.encumbrances.cachedExposure(ALICE)).toBe(2_000);
    expect(f.ledger.encumbrances.isOpen(enc)).toBe(true);
    expect(checkLedgerInvariants(f.ledger, { tick: 6, obligations: f.obligations })).toEqual([]);
  });

  it('the SPEC §15.4 scenario: the escrow is raided AND the cargo burns, and nobody defaults', () => {
    // "I commit to pay from account X; during the window my convoy is raided and X is
    // drained; my default is your bug, permanently attached to my name."
    const { f, lot, enc } = loadedHaul(minor(2_000));

    // The raid takes the stores backing the lock. 5,000 was locked; 1,000 is left, so
    // the lock yields to reality and says so.
    const drained = f.ledger.seizeCurrency({
      eventId: ev('raid:stores'),
      tick: 4,
      from: A_STORES,
      to: C_STORES,
      amount: minor(47_000),
    });
    expect(drained.locksReduced).toEqual([{ id: enc, shed: minor(4_000) }]);
    expect(f.ledger.encumbrances.get(enc)?.amountMinor).toBe(1_000);

    // And it takes most of the pot the promise was to be paid from.
    f.ledger.seizeCurrency({
      eventId: ev('raid:escrow'),
      tick: 4,
      from: HAUL_ESCROW,
      to: C_STORES,
      amount: minor(1_500),
    });

    const outcome = resolveCargoLost(f.ledger, {
      eventId: ev('raid:convoy'),
      tick: 5,
      venture: HAUL_1,
      escrow: HAUL_ESCROW,
      lost: [{ lotId: lot, qty: qty(60) }],
      claims: [{ account: B_STORES, priority: 0, amount: minor(9_000), key: 'wage' }],
      perilReleased: [{ encumbranceId: enc, amount: minor(1_000) }],
      causeEventId: ev('raid:convoy'),
    });

    // The escort is owed 9,000 and gets 500. That is an 8,500 recorded loss with a
    // named cause — not a broken promise, and the record must never say otherwise.
    expect(outcome.proceeds).toBe(500);
    expect(outcome.shortfall).toBe(8_500);
    expect(outcome.isDefault).toBe(false);
    expect(outcome.causeEventId).toBe('raid:convoy');
    expect(checkLedgerInvariants(f.ledger, { tick: 5, obligations: f.obligations })).toEqual([]);
    const s = f.ledger.currencySupply();
    expect(s.free + s.encumbered + s.escrowed).toBe(s.issued - s.retired);
  });

  it('PROP: for random cargo and claims, the goods always die and the pot is fully paid', () => {
    fc.assert(
      fc.property(
        fc.record({
          cargo: fc.integer({ min: 1, max: 500 }),
          burned: fc.integer({ min: 1, max: 500 }),
          escrow: fc.integer({ min: 0, max: 20_000 }),
          claims: fc.array(
            fc.record({
              amount: fc.integer({ min: 0, max: 9_000 }),
              priority: fc.integer({ min: 0, max: 2 }),
            }),
            { minLength: 1, maxLength: 5 },
          ),
        }),
        ({ cargo, burned, escrow, claims }) => {
          const burn = Math.min(burned, cargo);
          const { f, lot } = loadedHaul(minor(escrow), qty(cargo));
          const targets: readonly AccountId[] = [B_STORES, C_STORES];
          const c: Claim[] = claims.map((x, i) => ({
            account: targets[i % targets.length] ?? B_STORES,
            priority: x.priority,
            amount: minor(x.amount),
            key: `k${i}`,
          }));
          const before = f.ledger.requireLot(lot).qty;
          const outcome = resolveCargoLost(f.ledger, {
            eventId: ev('raid'),
            tick: 7,
            venture: HAUL_1,
            escrow: HAUL_ESCROW,
            lost: [{ lotId: lot, qty: qty(burn) }],
            claims: c,
            perilReleased: [],
      causeEventId: ev('cause'),
          });

          // The lien never protects the goods.
          const after = f.ledger.lot(lot)?.qty ?? 0;
          if (after !== before - burn) return false;
          if ((outcome.destroyed.get(ORE) ?? 0) !== burn) return false;

          const paid = sumMinor(outcome.payouts.map((p) => p.paid));
          const claimed = sumMinor(c.map((x) => x.amount));
          if (paid + outcome.surplus !== outcome.proceeds) return false;
          if (paid + outcome.shortfall !== claimed) return false;
          if (outcome.isDefault !== false) return false;
          return checkLedgerInvariants(f.ledger, { tick: 7, obligations: f.obligations }).length === 0;
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('INV-6 payouts sum exactly to proceeds', () => {
  it('allocates every minor unit and never overpays a claim', () => {
    // The bps trap: a claim of 1 against a claim of 1,000,000. A basis-point weight
    // would round the small claim to 1 bps and pay it 100 units — 100x what it is
    // owed. Pro-rata is computed from the amounts directly, so it cannot happen.
    const out = allocateProRata(minor(1_000_000), [minor(1), minor(1_000_000)]);
    expect(out[0]).toBeLessThanOrEqual(1);
    expect(sumMinor(out)).toBe(1_000_000);
  });

  it('pays a senior band in full before a junior band sees anything', () => {
    const r = payByPriority(minor(900), [
      { account: B_STORES, priority: 0, amount: minor(900), key: 'wage' },
      { account: C_STORES, priority: 1, amount: minor(900), key: 'share' },
    ]);
    expect(r.payouts.map((p) => p.paid)).toEqual([900, 0]);
    expect(r.shortfall).toBe(900);
  });

  it('is independent of the order claims are supplied in (PROP-V7, the ledger half)', () => {
    const claims: readonly Claim[] = [
      { account: B_STORES, priority: 1, amount: minor(700), key: 'b' },
      { account: C_STORES, priority: 0, amount: minor(500), key: 'a' },
      { account: A_STORES, priority: 1, amount: minor(300), key: 'c' },
    ];
    const forward = payByPriority(minor(900), claims);
    const reversed = payByPriority(minor(900), [...claims].reverse());
    expect(reversed.payouts).toEqual(forward.payouts);
  });

  it('rejects a negative claim and negative proceeds', () => {
    expect(() =>
      payByPriority(minor(10), [{ account: B_STORES, priority: 0, amount: minor(-5), key: 'x' }]),
    ).toThrow(WaterfallError);
    expect(() => payByPriority(minor(-1), [])).toThrow(WaterfallError);
  });

  it('catches a hand-built payout set that leaks value', () => {
    expect(() =>
      assertPayoutsExact(minor(1_000), {
        payouts: [
          { account: B_STORES, priority: 0, claimed: minor(600), paid: minor(600), key: 'a' },
          { account: C_STORES, priority: 0, claimed: minor(600), paid: minor(300), key: 'b' },
        ],
        shortfall: minor(300),
        // 100 units unaccounted for: not paid, not surplus. This is the rounding
        // leak INV-6 exists to make impossible.
        surplus: minor(0),
      }),
    ).toThrow(/INV-6: payouts 900 \+ surplus 0 != proceeds 1000/);
  });

  it('catches a junior payout made while a senior band was short', () => {
    expect(() =>
      assertPayoutsExact(minor(1_000), {
        payouts: [
          { account: B_STORES, priority: 0, claimed: minor(900), paid: minor(600), key: 'senior' },
          { account: C_STORES, priority: 1, claimed: minor(400), paid: minor(400), key: 'junior' },
        ],
        shortfall: minor(300),
        surplus: minor(0),
      }),
    ).toThrow(/while a senior band was short/);
  });

  it('PROP: payByPriority always allocates exactly, for random pots and claims', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.array(
          fc.record({
            amount: fc.integer({ min: 0, max: 200_000 }),
            priority: fc.integer({ min: 0, max: 3 }),
          }),
          { maxLength: 8 },
        ),
        (pot, raw) => {
          const claims: Claim[] = raw.map((x, i) => ({
            account: `stores:p${i}` as AccountId,
            priority: x.priority,
            amount: minor(x.amount),
            key: `k${i}`,
          }));
          const r = payByPriority(minor(pot), claims);
          const paid = sumMinor(r.payouts.map((p) => p.paid));
          const claimed = sumMinor(claims.map((c) => c.amount));
          // assertPayoutsExact already ran inside payByPriority; re-check the two
          // identities here so a regression is reported as a property failure.
          return (
            paid + r.surplus === pot &&
            paid + r.shortfall === claimed &&
            r.payouts.every((p) => p.paid >= 0 && p.paid <= p.claimed)
          );
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('the destruction event ids point at individual lots', () => {
  it('stamps one batch per destroyed lot so the record can name what burned', () => {
    const { f, lot } = loadedHaul(minor(100), qty(20));
    const second = mine(f, A_STORES, ALICE, ORE, qty(10), ev('dig2'));
    resolveCargoLost(f.ledger, {
      eventId: ev('front'),
      tick: 4,
      venture: HAUL_1,
      escrow: HAUL_ESCROW,
      lost: [
        { lotId: lot, qty: qty(20) },
        { lotId: second, qty: qty(10) },
      ],
      claims: [{ account: B_STORES, priority: 0, amount: minor(100), key: 'wage' }],
      perilReleased: [],
      causeEventId: ev('cause'),
    });
    const ids = f.ledger
      .allBatches()
      .map((b) => b.eventId)
      .filter((id: EventId) => id.startsWith('front#'));
    expect(ids).toContain('front#0');
    expect(ids).toContain('front#1');
    expect(f.ledger.account(GOODS_SINK.LOSS)?.movedQty.get(ORE)).toBe(30);
  });
});
