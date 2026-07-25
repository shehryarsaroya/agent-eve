/**
 * PROP-L1, PROP-L2, INV-2, INV-3 — supply conservation under abuse.
 *
 * PROP-L1 is SPEC §16 step 1's headline assertion: *10,000 random transfers never
 * break supply conservation.* It runs twice here, once as a literal seeded
 * 10,000-transfer loop (so the number in the spec is the number in the test) and
 * once as a fast-check property over shrinkable op sequences (so a failure arrives
 * as a minimal counterexample rather than as a haystack).
 *
 * PROP-L2 adds lock, release and destroy to the mix, which is the interesting case:
 * a lock changes availability without changing supply, and a destroy changes supply
 * without asking the lock's permission (PROP-L3).
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng.js';
import { minor, qty } from '../../src/core/units.js';
import type { AccountId, VentureId } from '../../src/core/types.js';
import {
  CURRENCY_FAUCET,
  CURRENCY_SINK,
  GOODS_SINK,
  LedgerError,
  checkInv2,
  checkInv3,
  checkInv7,
  type Ledger,
  type LotId,
} from '../../src/ledger/index.js';
import {
  A_STORES,
  ALICE,
  B_STORES,
  BOB,
  C_STORES,
  CARA,
  HAUL_1,
  HAUL_ESCROW,
  ORE,
  emptyWorld,
  ev,
  fund,
  fundedWorld,
  mine,
  type Fixture,
} from './fixture.js';

const WORLD_ACCOUNTS: readonly AccountId[] = [A_STORES, B_STORES, C_STORES, HAUL_ESCROW];

/** The identity INV-2 asserts, as one boolean, for currency and every good. */
function conserved(l: Ledger): boolean {
  const c = l.currencySupply();
  if (c.free + c.encumbered + c.escrowed !== c.issued - c.retired) return false;
  for (const g of l.goodsSupply().values()) {
    if (g.available + g.inTransit + g.escrowed !== g.issued - g.retired) return false;
  }
  return true;
}

describe('PROP-L1 10,000 random transfers never break supply conservation', () => {
  it('holds across 10,000 seeded transfers', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(1_000_000), ev('seed:a'));
    fund(f, B_STORES, minor(1_000_000), ev('seed:b'));
    fund(f, C_STORES, minor(1_000_000), ev('seed:c'));

    // Seeded, not Math.random: the failing case has to be reproducible or the
    // property test is a lottery ticket (DET-7).
    const rng = Rng.fromSeed('PROP-L1');
    let applied = 0;
    let refused = 0;
    for (let i = 0; i < 10_000; i += 1) {
      const from = rng.pick(WORLD_ACCOUNTS);
      const to = rng.pick(WORLD_ACCOUNTS);
      const amount = minor(rng.range(1, 5_000));
      if (from === to) {
        refused += 1;
        continue;
      }
      try {
        f.ledger.transferCurrency({ eventId: ev(`t${i}`), tick: i, from, to, amount });
        applied += 1;
      } catch (e) {
        // A refusal is a correct outcome: INV-3 forbids overdrawing. What is not
        // permitted is a refusal that half-applied.
        expect(e).toBeInstanceOf(LedgerError);
        refused += 1;
      }
      expect(conserved(f.ledger)).toBe(true);
    }
    expect(applied).toBeGreaterThan(1_000);
    expect(refused).toBeGreaterThan(0);
    expect(checkInv2(f.ledger, 10_000)).toEqual([]);
    expect(checkInv3(f.ledger, 10_000)).toEqual([]);
    expect(checkInv7(f.ledger, 10_000)).toEqual([]);
    const s = f.ledger.currencySupply();
    // Not one unit created and not one destroyed by 10,000 shuffles.
    expect(s.issued).toBe(3_000_000);
    expect(s.retired).toBe(0);
  });

  it('holds for arbitrary transfer sequences (fast-check)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            from: fc.integer({ min: 0, max: WORLD_ACCOUNTS.length - 1 }),
            to: fc.integer({ min: 0, max: WORLD_ACCOUNTS.length - 1 }),
            amount: fc.integer({ min: 1, max: 20_000 }),
          }),
          { maxLength: 120 },
        ),
        (ops) => {
          const f = emptyWorld();
          fund(f, A_STORES, minor(50_000), ev('seed:a'));
          fund(f, B_STORES, minor(50_000), ev('seed:b'));
          for (const [i, op] of ops.entries()) {
            const from = WORLD_ACCOUNTS[op.from];
            const to = WORLD_ACCOUNTS[op.to];
            if (from === undefined || to === undefined || from === to) continue;
            try {
              f.ledger.transferCurrency({
                eventId: ev(`p${i}`),
                tick: i,
                from,
                to,
                amount: minor(op.amount),
              });
            } catch {
              // Refusals are fine; silent imbalance is not.
            }
            if (!conserved(f.ledger)) return false;
          }
          return (
            checkInv2(f.ledger, ops.length).length === 0 &&
            checkInv3(f.ledger, ops.length).length === 0 &&
            checkInv7(f.ledger, ops.length).length === 0
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── PROP-L2 ────────────────────────────────────────────────────────────────

type Op =
  | { readonly t: 'transfer'; readonly from: number; readonly to: number; readonly amount: number }
  | { readonly t: 'lock'; readonly account: number; readonly amount: number; readonly maxDirectLoss: number }
  | { readonly t: 'lockSafe'; readonly account: number; readonly amount: number }
  | { readonly t: 'release'; readonly which: number }
  | { readonly t: 'seize'; readonly from: number; readonly to: number; readonly amount: number }
  | { readonly t: 'retire'; readonly from: number; readonly amount: number }
  | { readonly t: 'destroyGoods'; readonly which: number; readonly amount: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    t: fc.constant('transfer' as const),
    from: fc.integer({ min: 0, max: 3 }),
    to: fc.integer({ min: 0, max: 3 }),
    amount: fc.integer({ min: 1, max: 30_000 }),
  }),
  fc.record({
    t: fc.constant('lock' as const),
    account: fc.integer({ min: 0, max: 2 }),
    amount: fc.integer({ min: 1, max: 30_000 }),
    maxDirectLoss: fc.integer({ min: 0, max: 30_000 }),
  }),
  fc.record({
    t: fc.constant('lockSafe' as const),
    account: fc.integer({ min: 0, max: 2 }),
    amount: fc.integer({ min: 1, max: 30_000 }),
  }),
  fc.record({ t: fc.constant('release' as const), which: fc.integer({ min: 0, max: 12 }) }),
  fc.record({
    t: fc.constant('seize' as const),
    from: fc.integer({ min: 0, max: 2 }),
    to: fc.integer({ min: 0, max: 2 }),
    amount: fc.integer({ min: 1, max: 40_000 }),
  }),
  fc.record({
    t: fc.constant('retire' as const),
    from: fc.integer({ min: 0, max: 2 }),
    amount: fc.integer({ min: 1, max: 20_000 }),
  }),
  fc.record({
    t: fc.constant('destroyGoods' as const),
    which: fc.integer({ min: 0, max: 4 }),
    amount: fc.integer({ min: 1, max: 200 }),
  }),
);

interface Bench {
  readonly f: Fixture;
  readonly lots: LotId[];
  readonly locks: string[];
}

function bench(): Bench {
  const f = fundedWorld();
  f.obligations.open(HAUL_1);
  f.obligations.open('grant-1' as VentureId);
  const lots = f.ledger.allLots().map((l) => l.id);
  return { f, lots, locks: [] };
}

function runOp(b: Bench, op: Op, i: number): void {
  const { ledger } = b.f;
  const acct = (n: number): AccountId | undefined => WORLD_ACCOUNTS[n];
  const principalFor = (a: AccountId) => (a === A_STORES ? ALICE : a === B_STORES ? BOB : CARA);
  switch (op.t) {
    case 'transfer': {
      const from = acct(op.from);
      const to = acct(op.to);
      if (from === undefined || to === undefined || from === to) return;
      ledger.transferCurrency({ eventId: ev(`x${i}`), tick: i, from, to, amount: minor(op.amount) });
      return;
    }
    case 'lock': {
      const account = acct(op.account);
      if (account === undefined) return;
      // A lock over more than the free balance is refused; that is INV-3.
      if (ledger.freeBalance(account) < op.amount) return;
      b.locks.push(
        ledger.encumbrances.lock({
          eventId: `l${i}`,
          tick: i,
          principal: principalFor(account),
          account,
          amountMinor: minor(op.amount),
          obligationRef: HAUL_1,
          // Uncapped on purpose. `maxDirectLoss` is deliberately *not* bounded by
          // the amount locked (a haul locks the escrow and risks the cargo), so
          // capping it here would leave the design's own chosen case uncovered.
          maxDirectLoss: minor(op.maxDirectLoss),
        }),
      );
      return;
    }
    case 'lockSafe': {
      const account = acct(op.account);
      if (account === undefined) return;
      if (ledger.freeBalance(account) < op.amount) return;
      b.locks.push(
        ledger.encumbrances.lockSafe({
          eventId: `s${i}`,
          tick: i,
          principal: principalFor(account),
          account,
          amountMinor: minor(op.amount),
          obligationRef: HAUL_1,
        }),
      );
      return;
    }
    case 'release': {
      const id = b.locks[op.which % Math.max(b.locks.length, 1)];
      if (id === undefined || !ledger.encumbrances.isOpen(id)) return;
      ledger.encumbrances.release(id, i);
      return;
    }
    case 'seize': {
      const from = acct(op.from);
      const to = acct(op.to);
      if (from === undefined || to === undefined || from === to) return;
      // Predation ignores locks on purpose (PROP-L3).
      ledger.seizeCurrency({ eventId: ev(`z${i}`), tick: i, from, to, amount: minor(op.amount) });
      return;
    }
    case 'retire': {
      const from = acct(op.from);
      if (from === undefined) return;
      // Deliberately NOT pre-checked against the free balance: the engine must be
      // the thing that refuses this. Guarding here is how the missing check in
      // `retireCurrency` stayed invisible to a 300-run property test.
      ledger.retireCurrency({
        eventId: ev(`r${i}`),
        tick: i,
        sink: CURRENCY_SINK.FEES,
        from,
        amount: minor(op.amount),
      });
      return;
    }
    case 'destroyGoods': {
      const id = b.lots[op.which % Math.max(b.lots.length, 1)];
      if (id === undefined) return;
      const lot = ledger.lot(id);
      if (lot === undefined) return;
      ledger.destroyGoods({
        eventId: ev(`d${i}`),
        tick: i,
        sink: GOODS_SINK.LOSS,
        lotId: id,
        qty: qty(Math.min(op.amount, lot.qty)),
      });
      return;
    }
  }
}

describe('PROP-L2 any interleaving of transfer/lock/release/destroy preserves INV-2', () => {
  it('holds for arbitrary op sequences', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 60 }), (ops) => {
        const b = bench();
        for (const [i, op] of ops.entries()) {
          try {
            runOp(b, op, i + 1);
          } catch (e) {
            // Every refusal must be a stated invariant, never a crash.
            if (!(e instanceof Error)) return false;
            if (!/INV-|encumbrance|transfer|allocate|Qty|Minor/.test(e.message)) return false;
          }
          if (!conserved(b.f.ledger)) return false;
          if (checkInv3(b.f.ledger, i).length > 0) return false;
        }
        return (
          checkInv2(b.f.ledger, ops.length).length === 0 &&
          checkInv7(b.f.ledger, ops.length).length === 0
        );
      }),
      { numRuns: 300 },
    );
  });
});

describe('INV-3 no negative balance on any non-faucet account', () => {
  it('refuses an overdraft', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(100));
    expect(() =>
      f.ledger.transferCurrency({
        eventId: ev('over'),
        tick: 1,
        from: A_STORES,
        to: B_STORES,
        amount: minor(101),
      }),
    ).toThrow(/INV-3/);
    expect(f.ledger.balance(A_STORES)).toBe(100);
  });

  it('refuses spending locked value, and reports the free balance in the reason', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(1_000));
    f.obligations.open(HAUL_1);
    f.ledger.encumbrances.lock({
      eventId: 'lock1',
      tick: 1,
      principal: ALICE,
      account: A_STORES,
      amountMinor: minor(800),
      obligationRef: HAUL_1,
      maxDirectLoss: minor(800),
    });
    expect(f.ledger.freeBalance(A_STORES)).toBe(200);
    expect(() =>
      f.ledger.transferCurrency({
        eventId: ev('spendLocked'),
        tick: 2,
        from: A_STORES,
        to: B_STORES,
        amount: minor(300),
      }),
    ).toThrow(/INV-3: .* has 200 free/);
  });

  it('refuses destroying more of a good than a lot holds', () => {
    const f = emptyWorld();
    const id = mine(f, A_STORES, ALICE, ORE, qty(5), ev('dig'));
    expect(() =>
      f.ledger.destroyGoods({ eventId: ev('over'), tick: 1, sink: GOODS_SINK.LOSS, lotId: id, qty: qty(6) }),
    ).toThrow(/INV-3/);
    expect(f.ledger.requireLot(id).qty).toBe(5);
  });

  it('a faucet may go negative and nothing else may', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(10));
    // The exemption, exercised: the faucet is negative by exactly what it issued
    // and INV-3 tolerates it, because that sign convention is what makes INV-2
    // arithmetic rather than a scalar counter.
    expect(f.ledger.balance(CURRENCY_FAUCET.STARTER_STAKE)).toBe(-10);
    expect(checkInv3(f.ledger, 0)).toEqual([]);

    // And the narrowness of the exemption, exercised: a STORES account at the same
    // balance is reported. Asserting only the clean case leaves the whole detection
    // direction untested, which is a green test that tests nothing.
    const stores = f.ledger.account(A_STORES);
    expect(stores).toBeDefined();
    stores!.balanceMinor = minor(-10);
    const found = checkInv3(f.ledger, 0);
    expect(found.map((x) => x.message).join(' | ')).toContain('STORES account stores:alice holds -10');
    expect(found.every((x) => x.id === 'INV-3' && x.severity === 'HALT')).toBe(true);
  });

  /**
   * DEFECT found by the verifier: `retireCurrency` did not look at locks, while
   * `transferCurrency` did. Upkeep and fees are the economy's primary sinks (SPEC
   * §10.2) and they are charged by the world, so an account with escrow locked
   * against a live venture could be retired straight through its lock — leaving
   * `locked > balance`, a negative `freeBalance` served to the agent, and INV-3
   * halting the tick in response to a scheduled charge that broke no rule. That is
   * the false-halt class SPEC §15.4 is about: the engine, not any player, breaks it.
   */
  it('refuses to retire locked value, so a scheduled sink charge cannot halt the tick', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(1_000));
    f.obligations.open(HAUL_1);
    f.ledger.encumbrances.lock({
      eventId: 'lock1',
      tick: 1,
      principal: ALICE,
      account: A_STORES,
      amountMinor: minor(800),
      obligationRef: HAUL_1,
      maxDirectLoss: minor(800),
    });
    expect(() =>
      f.ledger.retireCurrency({
        eventId: ev('upkeep'),
        tick: 2,
        sink: CURRENCY_SINK.UPKEEP,
        from: A_STORES,
        amount: minor(1_000),
      }),
    ).toThrow(/INV-3: .* has 200 free/);

    // Nothing moved, the lock still stands, and the tick is still publishable.
    expect(f.ledger.balance(A_STORES)).toBe(1_000);
    expect(f.ledger.freeBalance(A_STORES)).toBe(200);
    expect(checkInv3(f.ledger, 2)).toEqual([]);

    // What is free is still retirable, so upkeep is not blocked — only overreach is.
    f.ledger.retireCurrency({
      eventId: ev('upkeep:ok'),
      tick: 2,
      sink: CURRENCY_SINK.UPKEEP,
      from: A_STORES,
      amount: minor(200),
    });
    expect(f.ledger.balance(A_STORES)).toBe(800);
    expect(checkInv3(f.ledger, 2)).toEqual([]);
    expect(checkInv2(f.ledger, 2)).toEqual([]);
  });

  /**
   * Predation remains the one thing that *may* take locked value, and it does so
   * through `seizeCurrency`, which sheds the locks it invalidates and reports them
   * so the caller records a loss rather than a default (PROP-L3). Asserted next to
   * the refusal above so the two paths cannot quietly converge.
   */
  it('but predation still takes locked value, shedding the locks it invalidates', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(1_000));
    f.obligations.open(HAUL_1);
    const id = f.ledger.encumbrances.lock({
      eventId: 'lock1',
      tick: 1,
      principal: ALICE,
      account: A_STORES,
      amountMinor: minor(800),
      obligationRef: HAUL_1,
      maxDirectLoss: minor(800),
    });
    const out = f.ledger.seizeCurrency({
      eventId: ev('raid'),
      tick: 2,
      from: A_STORES,
      to: B_STORES,
      amount: minor(1_000),
    });
    expect(out.seized).toBe(1_000);
    expect(out.locksReduced).toEqual([{ id, shed: minor(800) }]);
    expect(f.ledger.freeBalance(A_STORES)).toBe(0);
    expect(checkInv3(f.ledger, 2)).toEqual([]);
  });
});
