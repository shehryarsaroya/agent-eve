/**
 * INV-1 made cheap without being made useless — `inv7-incremental.spec.ts`'s argument, for the batch
 * log instead of the posting sums.
 *
 * The check re-read **every batch ever applied, every tick**, so its cost grew with the world's age:
 * the Season 1 scale measurement found a 1,000-principal world adding a few hundred batches a tick.
 * Each batch's verdict is fixed the moment it is verified (it reads the batch and its accounts' kinds,
 * and neither changes), so the verified prefix may be carried — but only while the log provably still
 * holds the batches that were verified.
 *
 * Four things have to be true, and a fast wrong answer is worse than a slow right one:
 *   1. it still catches a malformed batch that arrives after the prefix is warm — including one that
 *      never went through `apply` (a rehydrate pushes rows directly);
 *   2. it keeps reporting a bad batch on every call until it is gone, rather than certifying it;
 *   3. it notices when the log is truncated, or replaced with rows of the same length and ids;
 *   4. it is actually incremental in the common case.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { EventId, PrincipalId } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';
import { CURRENCY_FAUCET, Ledger, storesAccount } from '../../src/ledger/index.js';
import { checkInv1, inv1Stats } from '../../src/ledger/invariants.js';

const A = 'p:alva' as PrincipalId;
const B = 'p:brann' as PrincipalId;

function funded(): Ledger {
  const l = new Ledger();
  l.openAccount(storesAccount(A), 'STORES', A);
  l.openAccount(storesAccount(B), 'STORES', B);
  l.issueCurrency({
    eventId: 'seed' as EventId,
    tick: 0,
    faucet: CURRENCY_FAUCET.STARTER_STAKE,
    to: storesAccount(A),
    amount: minor(100_000),
  });
  return l;
}

function move(l: Ledger, n: number, tick: number): void {
  l.transferCurrency({
    eventId: `mv:${String(n)}` as EventId,
    tick,
    from: storesAccount(A),
    to: storesAccount(B),
    amount: minor(1),
  });
}

/** The log itself, reached past the API on purpose: these are the corruptions INV-1 exists to see. */
function log(l: Ledger): unknown[] {
  return l.allBatches() as unknown as unknown[];
}

/** A transfer whose postings do not sum to zero — a batch `apply` would have refused. */
function unbalanced(id: string): unknown {
  return {
    eventId: id as EventId,
    tick: 1,
    kind: 'TRANSFER',
    postings: [
      { eventId: id, account: storesAccount(A), good: null, amountMinor: -5, amountQty: null },
      { eventId: id, account: storesAccount(B), good: null, amountMinor: 7, amountQty: null },
    ],
    supply: null,
  };
}

describe('INV-1 still catches what it existed to catch', () => {
  beforeEach(() => {
    inv1Stats.fullRechecks = 0;
    inv1Stats.incremental = 0;
  });

  it('is clean on a healthy ledger, call after call', () => {
    const l = funded();
    for (let i = 0; i < 20; i += 1) {
      move(l, i, 1);
      expect(checkInv1(l, 1)).toEqual([]);
    }
  });

  it('catches a malformed batch pushed past apply AFTER the prefix is warm', () => {
    // THE ASSERTION THE OPTIMISATION COULD HAVE BROKEN: a rehydrate pushes rows without `apply`'s
    // check, and the new row lands after a verified prefix. A version that advanced its prefix to the
    // log's length without reading the tail would report clean.
    const l = funded();
    for (let i = 0; i < 30; i += 1) move(l, i, 1);
    expect(checkInv1(l, 1), 'healthy first').toEqual([]);

    log(l).push(unbalanced('rogue'));
    const violations = checkInv1(l, 2);
    expect(violations.length, 'the new malformed batch must be caught').toBeGreaterThan(0);
    expect(violations.map((x) => x.message).join(' ')).toMatch(/event rogue/);
  });

  it('keeps reporting a bad batch on every call until it is gone — a failed pass certifies nothing', () => {
    // MUTATION: advance the prefix whatever the pass found — the second call reads clean. RED.
    const l = funded();
    move(l, 0, 1);
    expect(checkInv1(l, 1)).toEqual([]);
    log(l).push(unbalanced('stays'));
    expect(checkInv1(l, 2).length).toBeGreaterThan(0);
    expect(checkInv1(l, 3).length, 'still there, still reported').toBeGreaterThan(0);
    log(l).pop();
    expect(checkInv1(l, 4), 'and clean once it is gone').toEqual([]);
  });

  it('re-checks in full when the log is truncated under it', () => {
    const l = funded();
    for (let i = 0; i < 10; i += 1) move(l, i, 1);
    expect(checkInv1(l, 1)).toEqual([]);
    const warm = inv1Stats.fullRechecks;

    (log(l) as { length: number }).length = 4; // an aborted tick's positional truncation
    expect(checkInv1(l, 2)).toEqual([]);
    expect(inv1Stats.fullRechecks, 'a shorter log must not be trusted to a longer prefix').toBeGreaterThan(warm);
  });

  it('notices a replace that lands on the same length WITH THE SAME EVENT IDS', () => {
    // The case an id comparison cannot see and the reason the boundary is an object: a rehydrate
    // rebuilds the log from the durable record, same length and same ids, and a corrupted copy of an
    // already-verified row must still be read.
    // MUTATION: compare the boundary by eventId instead of identity — this is RED.
    const l = funded();
    for (let i = 0; i < 6; i += 1) move(l, i, 1);
    expect(checkInv1(l, 1)).toEqual([]);
    const fullsBefore = inv1Stats.fullRechecks;

    const rows = log(l);
    const copies: unknown[] = rows.map((r) => ({ ...(r as object) }));
    // Corrupt an EARLY row in the copy, inside what the old prefix had certified.
    copies[2] = unbalanced(String((rows[2] as { eventId: string }).eventId));
    rows.length = 0;
    rows.push(...copies);
    expect(rows.length, 'the log is back to its original length').toBe(copies.length);

    const violations = checkInv1(l, 2);
    expect(inv1Stats.fullRechecks, 'a replaced log must force the expensive path').toBeGreaterThan(fullsBefore);
    expect(violations.length, 'and the corrupted early row must be found').toBeGreaterThan(0);
  });

  it('honours sinceIndex without certifying the rows it skipped', () => {
    const l = funded();
    for (let i = 0; i < 4; i += 1) move(l, i, 1);
    log(l).splice(2, 0, unbalanced('skipped'));
    // A caller that starts past the bad row sees nothing — that is what it asked for…
    expect(checkInv1(l, 1, 3)).toEqual([]);
    // …and the next full call must still read it, because nothing certified the gap.
    expect(checkInv1(l, 2).map((x) => x.message).join(' ')).toMatch(/event skipped/);
  });

  it('is incremental in the common case, which is the whole point', () => {
    const l = funded();
    move(l, 0, 1);
    checkInv1(l, 1);
    const fullsAfterFirst = inv1Stats.fullRechecks;
    for (let i = 1; i < 50; i += 1) {
      move(l, i, 1);
      checkInv1(l, 1);
    }
    expect(inv1Stats.fullRechecks, 'a growing, never-truncated log is read once and then extended').toBe(fullsAfterFirst);
    expect(inv1Stats.incremental).toBeGreaterThan(45);
  });
});
