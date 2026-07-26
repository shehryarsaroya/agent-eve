/**
 * INV-4, INV-5, INV-7 — locks, orphans, EXPOSURE, and the one-quantity-one-home rule.
 *
 * The two things these tests are really defending:
 *
 *   - **EXPOSURE means one thing** (SPEC §3): Σ of open `max_direct_loss`, and
 *     nothing else. Safe value contributes zero *by construction*, so there is no
 *     way to shade it, and the number an agent is shown before it signs is the
 *     number settlement uses.
 *   - **A lock is a claim, not armour.** Locked value is unspendable and still
 *     losable. If it were losable only with the lock's consent, "encumber
 *     everything" would be free armour (PROP-L3).
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { minor, qty } from '../../src/core/units.js';
import type { AccountId, GrantId, PrincipalId, VentureId } from '../../src/core/types.js';
import {
  EncumbranceError,
  SimpleObligationBook,
  checkInv3,
  checkInv4,
  checkInv5,
  checkInv7,
  checkLedgerInvariants,
  emptyObligationBook,
  principalPosition,
} from '../../src/ledger/index.js';
import {
  A_STORES,
  ALICE,
  B_STORES,
  BOB,
  HAUL_1,
  HAUL_ESCROW,
  ORE,
  emptyWorld,
  ev,
  fund,
  fundedWorld,
  mine,
} from './fixture.js';
import { ledgerStateTable } from '../../src/ledger/stateTable.js';

const GRANT_1 = 'grant-quartermaster' as GrantId;

describe('INV-4 every encumbrance references a live obligation', () => {
  it('accepts a lock against a live obligation', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(5_000));
    f.obligations.open(HAUL_1);
    f.ledger.encumbrances.lock({
      eventId: 'e1',
      tick: 1,
      principal: ALICE,
      account: A_STORES,
      amountMinor: minor(2_000),
      obligationRef: HAUL_1,
      maxDirectLoss: minor(2_000),
    });
    expect(checkInv4(f.ledger, { tick: 1, obligations: f.obligations })).toEqual([]);
  });

  it('detects an orphan lock when the obligation dies', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(5_000));
    f.obligations.open(HAUL_1);
    const id = f.ledger.encumbrances.lock({
      eventId: 'e1',
      tick: 1,
      principal: ALICE,
      account: A_STORES,
      amountMinor: minor(2_000),
      obligationRef: HAUL_1,
      maxDirectLoss: minor(0),
    });
    f.obligations.close(HAUL_1);
    const found = checkInv4(f.ledger, { tick: 2, obligations: f.obligations });
    expect(found).toHaveLength(1);
    expect(found[0]?.id).toBe('INV-4');
    expect(found[0]?.message).toContain(id);
    expect(found[0]?.severity).toBe('HALT');

    // Releasing it clears the orphan. An orphan lock is value nobody can spend and
    // nobody can claim, and no affordance would ever reveal it.
    f.ledger.encumbrances.release(id, 3);
    expect(checkInv4(f.ledger, { tick: 3, obligations: f.obligations })).toEqual([]);
  });

  it('detects an obligation that requires an encumbrance and has none', () => {
    const f = emptyWorld();
    f.obligations.open(HAUL_1, true);
    const found = checkInv4(f.ledger, { tick: 1, obligations: f.obligations });
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('requires an encumbrance and has none');
  });

  it('a lot may be pledged once and only once, and cannot then be sent away', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(5_000));
    f.obligations.open(HAUL_1);
    const lot = mine(f, A_STORES, ALICE, ORE, qty(40), ev('dig'));
    const enc = f.ledger.encumbrances.lock({
      eventId: 'e1',
      tick: 1,
      principal: ALICE,
      account: A_STORES,
      amountMinor: minor(1_000),
      obligationRef: HAUL_1,
      maxDirectLoss: minor(1_000),
    });
    f.ledger.pledgeLot(lot, enc);
    expect(() => f.ledger.pledgeLot(lot, enc)).toThrow(/already pledged/);
    expect(() =>
      f.ledger.transferGoods({ eventId: ev('sneak'), tick: 2, lotId: lot, to: B_STORES, qty: qty(1) }),
    ).toThrow(/INV-4: lot .* is pledged/);
    expect(checkInv4(f.ledger, { tick: 2, obligations: f.obligations })).toEqual([]);
  });

  it('detects a lot pledged to an encumbrance that is no longer open', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(5_000));
    f.obligations.open(HAUL_1);
    const lot = mine(f, A_STORES, ALICE, ORE, qty(40), ev('dig'));
    const enc = f.ledger.encumbrances.lock({
      eventId: 'e1',
      tick: 1,
      principal: ALICE,
      account: A_STORES,
      amountMinor: minor(1_000),
      obligationRef: HAUL_1,
      maxDirectLoss: minor(0),
    });
    f.ledger.pledgeLot(lot, enc);
    f.ledger.encumbrances.release(enc, 2);
    const found = checkInv4(f.ledger, { tick: 2, obligations: f.obligations });
    expect(found.map((x) => x.message).join(' ')).toContain('not an open encumbrance');
  });

  it('an empty obligation book makes every open lock an orphan', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(1_000));
    f.ledger.encumbrances.lock({
      eventId: 'e1',
      tick: 1,
      principal: ALICE,
      account: A_STORES,
      amountMinor: minor(500),
      obligationRef: GRANT_1,
      maxDirectLoss: minor(500),
    });
    expect(checkInv4(f.ledger, { tick: 1, obligations: emptyObligationBook() })).toHaveLength(1);
  });
});

describe('INV-5 EXPOSURE is Σ open max_direct_loss and nothing else', () => {
  it('matches the recomputation, and safe value contributes zero by construction', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(10_000));
    f.obligations.open(HAUL_1);
    f.ledger.encumbrances.lock({
      eventId: 'risky',
      tick: 1,
      principal: ALICE,
      account: A_STORES,
      amountMinor: minor(4_000),
      obligationRef: HAUL_1,
      maxDirectLoss: minor(1_500),
    });
    // A lock over value that cannot be taken. `lockSafe` has no maxDirectLoss
    // argument at all, so there is nothing to shade — that is what "zero by
    // construction" means, as opposed to "zero if you set it to zero".
    f.ledger.encumbrances.lockSafe({
      eventId: 'safe',
      tick: 1,
      principal: ALICE,
      account: A_STORES,
      amountMinor: minor(3_000),
      obligationRef: HAUL_1,
    });

    expect(f.ledger.encumbrances.cachedExposure(ALICE)).toBe(1_500);
    expect(f.ledger.encumbrances.recomputeExposure(ALICE)).toBe(1_500);
    // 7,000 is locked. EXPOSURE is 1,500. Those are different words on purpose.
    expect(f.ledger.encumbrances.encumberedInAccount(A_STORES)).toBe(7_000);
    expect(f.ledger.freeBalance(A_STORES)).toBe(3_000);
    expect(checkInv5(f.ledger, 1)).toEqual([]);
  });

  it('falls back to zero when every lock is released', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(1_000));
    f.obligations.open(HAUL_1);
    const id = f.ledger.encumbrances.lock({
      eventId: 'e1',
      tick: 1,
      principal: ALICE,
      account: A_STORES,
      amountMinor: minor(600),
      obligationRef: HAUL_1,
      maxDirectLoss: minor(600),
    });
    expect(f.ledger.encumbrances.cachedExposure(ALICE)).toBe(600);
    f.ledger.encumbrances.release(id, 2);
    expect(f.ledger.encumbrances.cachedExposure(ALICE)).toBe(0);
    expect(f.ledger.encumbrances.recomputeExposure(ALICE)).toBe(0);
    expect(checkInv5(f.ledger, 2)).toEqual([]);
  });

  it('fires when the EXPOSURE an agent was served disagrees with the table', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(2_000));
    f.obligations.open(HAUL_1);
    f.ledger.encumbrances.lock({
      eventId: 'e1',
      tick: 1,
      principal: ALICE,
      account: A_STORES,
      amountMinor: minor(900),
      obligationRef: HAUL_1,
      maxDirectLoss: minor(900),
    });
    const stale = new Map<PrincipalId, ReturnType<typeof minor>>([[ALICE, minor(100)]]);
    const found = checkInv5(f.ledger, 2, stale);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('but 100 was served');
  });

  it('allows peril larger than the lock — a haul risks the cargo as well as the escrow', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(1_000));
    f.obligations.open(HAUL_1);
    // 100 locked, 900 at risk: the cargo on the convoy is worth more than the money
    // behind the promise. Capping peril at the lock would make this unrepresentable
    // and would understate exactly the number A7 requires be shown honestly.
    const id = f.ledger.encumbrances.lock({
      eventId: 'e1',
      tick: 1,
      principal: ALICE,
      account: A_STORES,
      amountMinor: minor(100),
      obligationRef: HAUL_1,
      maxDirectLoss: minor(900),
    });
    expect(f.ledger.encumbrances.cachedExposure(ALICE)).toBe(900);
    expect(checkInv5(f.ledger, 1)).toEqual([]);

    // The cargo burns. Peril falls; the money is untouched.
    expect(f.ledger.encumbrances.reducePeril(id, minor(900))).toBe(900);
    expect(f.ledger.encumbrances.cachedExposure(ALICE)).toBe(0);
    expect(f.ledger.encumbrances.get(id)?.amountMinor).toBe(100);
    expect(checkInv5(f.ledger, 2)).toEqual([]);
  });

  it('refuses a negative peril', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(1_000));
    f.obligations.open(HAUL_1);
    expect(() =>
      f.ledger.encumbrances.lock({
        eventId: 'e1',
        tick: 1,
        principal: ALICE,
        account: A_STORES,
        amountMinor: minor(100),
        obligationRef: HAUL_1,
        maxDirectLoss: minor(-1),
      }),
    ).toThrow(EncumbranceError);
  });

  it('refuses a lock larger than the free balance — INV-3 by construction, not by audit', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(1_000));
    f.obligations.open(HAUL_1);
    const first = {
      eventId: 'e1',
      tick: 1,
      principal: ALICE,
      account: A_STORES,
      amountMinor: minor(700),
      obligationRef: HAUL_1,
      maxDirectLoss: minor(700),
    };
    f.ledger.encumbrances.lock(first);
    expect(() =>
      f.ledger.encumbrances.lock({
        ...first,
        eventId: 'e2',
        amountMinor: minor(400),
        maxDirectLoss: minor(400),
      }),
    ).toThrow(/INV-3: .* has 300 free and cannot lock 400/);
    expect(checkInv3(f.ledger, 1)).toEqual([]);
  });

  it('refuses a lock inside an escrow account — A7 already committed that value', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(1_000));
    f.ledger.transferCurrency({
      eventId: ev('escrowIn'),
      tick: 1,
      from: A_STORES,
      to: HAUL_ESCROW,
      amount: minor(600),
    });
    f.obligations.open(HAUL_1);
    expect(() =>
      f.ledger.encumbrances.lock({
        eventId: 'e1',
        tick: 1,
        principal: ALICE,
        account: HAUL_ESCROW,
        amountMinor: minor(100),
        obligationRef: HAUL_1,
        maxDirectLoss: minor(100),
      }),
    ).toThrow(/a lock lives in a principal's STORES; .* is ESCROW/);
  });

  it('refuses a lock in an account that does not exist', () => {
    const f = emptyWorld();
    f.obligations.open(HAUL_1);
    expect(() =>
      f.ledger.encumbrances.lock({
        eventId: 'e1',
        tick: 1,
        principal: ALICE,
        account: 'stores:ghost' as AccountId,
        amountMinor: minor(1),
        obligationRef: HAUL_1,
        maxDirectLoss: minor(0),
      }),
    ).toThrow(/INV-4: cannot lock value in unknown account/);
  });

  it('shrinks EXPOSURE with the lock when the value behind it is seized (PROP-L3)', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(1_000));
    f.obligations.open(HAUL_1);
    const id = f.ledger.encumbrances.lock({
      eventId: 'e1',
      tick: 1,
      principal: ALICE,
      account: A_STORES,
      amountMinor: minor(1_000),
      obligationRef: HAUL_1,
      maxDirectLoss: minor(1_000),
    });

    // A raid takes 600 of the locked money. The lock does not stop it — it yields.
    const outcome = f.ledger.seizeCurrency({
      eventId: ev('raid'),
      tick: 2,
      from: A_STORES,
      to: B_STORES,
      amount: minor(600),
    });
    expect(outcome.seized).toBe(600);
    expect(outcome.locksReduced).toEqual([{ id, shed: minor(600) }]);
    expect(f.ledger.encumbrances.get(id)?.amountMinor).toBe(400);
    expect(f.ledger.encumbrances.cachedExposure(ALICE)).toBe(400);
    expect(checkInv3(f.ledger, 2)).toEqual([]);
    expect(checkInv5(f.ledger, 2)).toEqual([]);
    expect(checkInv7(f.ledger, 2)).toEqual([]);
  });

  it('keeps a fully-drained lock OPEN, so legitimate predation cannot halt the tick', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(500));
    // A secured obligation: INV-4 requires it to have an encumbrance at all times.
    f.obligations.open(HAUL_1, true);
    const id = f.ledger.encumbrances.lock({
      eventId: 'e1',
      tick: 1,
      principal: ALICE,
      account: A_STORES,
      amountMinor: minor(500),
      obligationRef: HAUL_1,
      maxDirectLoss: minor(500),
    });
    f.ledger.seizeCurrency({ eventId: ev('raid'), tick: 2, from: A_STORES, to: B_STORES, amount: minor(500) });

    // The claim still exists; it simply has nothing behind it. Auto-releasing here
    // would be tidier and would fabricate an invariant failure: the obligation would
    // abruptly "lack its encumbrance" and INV-4 would halt the tick in response to a
    // raid that broke no rule (SPEC §15.4's false-default class).
    expect(f.ledger.encumbrances.isOpen(id)).toBe(true);
    expect(f.ledger.encumbrances.get(id)?.amountMinor).toBe(0);
    expect(f.ledger.encumbrances.cachedExposure(ALICE)).toBe(0);
    expect(checkInv4(f.ledger, { tick: 2, obligations: f.obligations })).toEqual([]);
    expect(checkInv3(f.ledger, 2)).toEqual([]);
    expect(checkInv5(f.ledger, 2)).toEqual([]);
  });

  it('PROP: EXPOSURE recomputed always equals the cache, for random lock/release/seize sequences', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.record({
              t: fc.constant('lock' as const),
              amount: fc.integer({ min: 1, max: 4_000 }),
              loss: fc.integer({ min: 0, max: 4_000 }),
              who: fc.integer({ min: 0, max: 1 }),
            }),
            fc.record({ t: fc.constant('release' as const), which: fc.integer({ min: 0, max: 20 }) }),
            fc.record({ t: fc.constant('seize' as const), amount: fc.integer({ min: 1, max: 6_000 }) }),
          ),
          { maxLength: 40 },
        ),
        (ops) => {
          const f = emptyWorld();
          fund(f, A_STORES, minor(20_000), ev('fa'));
          fund(f, B_STORES, minor(20_000), ev('fb'));
          f.obligations.open(HAUL_1);
          const ids: string[] = [];
          const accounts = [A_STORES, B_STORES] as const;
          const owners: readonly PrincipalId[] = [ALICE, BOB];
          for (const [i, op] of ops.entries()) {
            if (op.t === 'lock') {
              const account = accounts[op.who] ?? A_STORES;
              const principal = owners[op.who] ?? ALICE;
              if (f.ledger.freeBalance(account) < op.amount) continue;
              ids.push(
                f.ledger.encumbrances.lock({
                  eventId: `l${i}`,
                  tick: i,
                  principal,
                  account,
                  amountMinor: minor(op.amount),
                  obligationRef: HAUL_1,
                  // Uncapped: peril larger than the lock is the design's chosen
                  // case (a haul risks the cargo as well as the escrow), so the
                  // property has to reach it.
                  maxDirectLoss: minor(op.loss),
                }),
              );
            } else if (op.t === 'release') {
              const id = ids[op.which % Math.max(ids.length, 1)];
              if (id !== undefined && f.ledger.encumbrances.isOpen(id)) {
                f.ledger.encumbrances.release(id, i);
              }
            } else {
              f.ledger.seizeCurrency({
                eventId: ev(`z${i}`),
                tick: i,
                from: A_STORES,
                to: B_STORES,
                amount: minor(op.amount),
              });
            }
            if (checkInv5(f.ledger, i).length > 0) return false;
            if (checkInv3(f.ledger, i).length > 0) return false;
          }
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('INV-7 no quantity has two homes', () => {
  it('passes for a busy ledger and reports the account and good when it would not', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(9_000));
    const lot = mine(f, A_STORES, ALICE, ORE, qty(60), ev('dig'));
    f.ledger.transferGoods({ eventId: ev('sell'), tick: 1, lotId: lot, to: B_STORES, qty: qty(25) });
    f.ledger.transferCurrency({ eventId: ev('pay'), tick: 1, from: A_STORES, to: B_STORES, amount: minor(2_500) });
    expect(checkInv7(f.ledger, 1)).toEqual([]);
    expect(checkLedgerInvariants(f.ledger, { tick: 1, obligations: new SimpleObligationBook() })).toEqual([]);
  });
});

describe('principalPosition', () => {
  it('reports free balance, EXPOSURE and goods from one place', () => {
    const f = emptyWorld();
    fund(f, A_STORES, minor(4_000));
    mine(f, A_STORES, ALICE, ORE, qty(11), ev('dig'));
    f.obligations.open('venture-x' as VentureId);
    f.ledger.encumbrances.lock({
      eventId: 'e1',
      tick: 1,
      principal: ALICE,
      account: A_STORES,
      amountMinor: minor(1_000),
      obligationRef: 'venture-x' as VentureId,
      maxDirectLoss: minor(250),
    });
    const pos = principalPosition(f.ledger, ALICE, A_STORES);
    expect(pos.free).toBe(3_000);
    expect(pos.exposure).toBe(250);
    expect(pos.goods.get(ORE)).toBe(11);
  });
});

describe('the book is inside the hashed capture and the abort path (the keystone fix)', () => {
  it('a rolled-back tick does not keep its lock: capture -> lock -> restore releases it', () => {
    // This is the test that would have caught it. `ledgerStateTable.capture()` used to
    // return exactly {accounts, lots, postingCount, batchCount} — no encumbrances — so an
    // aborted tick kept every lock it had opened: free balance reduced and EXPOSURE
    // inflated for a commitment the world had just rolled back. Found three times
    // independently (a codex ledger review, the boot-upgrade builder, and a direct test
    // of the capture) while the file's own header claimed encumbrances were carried.
    const f = fundedWorld();
    const before = f.ledger.freeBalance(A_STORES);
    const captured = ledgerStateTable(
      () => f.ledger,
      (r) => {
        f.ledger.restoreTo(r);
      },
    );
    const snapshot = captured.capture();

    f.obligations.open('v:lock-test' as VentureId);
    f.ledger.encumbrances.lock({
      eventId: ev('lock'),
      tick: 1,
      principal: ALICE,
      account: A_STORES,
      amountMinor: minor(600),
      obligationRef: 'v:lock-test' as VentureId,
      maxDirectLoss: minor(600),
    });
    // The lock bites: free balance falls and exposure appears.
    expect(f.ledger.freeBalance(A_STORES)).toBe(before - 600);
    expect(f.ledger.encumbrances.cachedExposure(ALICE)).toBe(600);

    // Now abort the tick.
    captured.restore?.(snapshot);

    expect(f.ledger.freeBalance(A_STORES), 'the lock must be gone after a rollback').toBe(before);
    expect(f.ledger.encumbrances.cachedExposure(ALICE), 'EXPOSURE must roll back too').toBe(0);
    expect(f.ledger.encumbrances.openForAccount(A_STORES).length).toBe(0);
  });

  it('state_hash can SEE escrow: a world with a lock does not hash like one without', () => {
    // The bug `ledgerStateTable` was written to fix ("a hash that cannot see the money is
    // not a hash of the world"), one layer down: two worlds differing only in open locks
    // used to produce an identical capture, so DET-1 was blind to divergent escrow.
    const f = fundedWorld();
    const table = ledgerStateTable(
      () => f.ledger,
      (r) => {
        f.ledger.restoreTo(r);
      },
    );
    const withoutLock = JSON.stringify(table.capture());

    f.obligations.open('v:hash-test' as VentureId);
    f.ledger.encumbrances.lock({
      eventId: ev('lock2'),
      tick: 1,
      principal: ALICE,
      account: A_STORES,
      amountMinor: minor(600),
      obligationRef: 'v:hash-test' as VentureId,
      maxDirectLoss: minor(600),
    });
    const withLock = JSON.stringify(table.capture());

    expect(withLock, 'the capture must differ once escrow exists').not.toEqual(withoutLock);
  });
});
