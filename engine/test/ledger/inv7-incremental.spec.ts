/**
 * INV-7 made cheap without being made useless, which is the only interesting property here.
 *
 * The check re-summed **every posting ever written, every tick**, so its cost grew with history
 * without bound: at 4,300 ticks the live world was re-adding tens of thousands of rows sixty times a
 * minute to prove nothing had moved.
 *
 * The obvious fix destroys the invariant. INV-7 exists because a cached balance is compared against
 * an **independently recomputed** sum; keeping a running total and comparing it to the balance is two
 * numbers maintained by the same code path agreeing, which proves nothing. So the prefix carried here
 * is a sum that WAS independently recomputed, at the tick it was verified, and it is only reused while
 * the postings it summed provably have not changed.
 *
 * Three things have to be true, and a fast wrong answer is worse than a slow right one:
 *   1. it still catches a corrupted balance;
 *   2. it notices when the log is truncated under it (an aborted tick) and recomputes in full;
 *   3. it is actually incremental in the common case.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { checkInv7, inv7Stats } from '../../src/ledger/invariants.js';
import { CURRENCY_FAUCET, Ledger, storesAccount } from '../../src/ledger/index.js';
import type { EventId, PrincipalId } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';

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

describe('INV-7 still catches what it existed to catch', () => {
  beforeEach(() => {
    inv7Stats.fullRecomputes = 0;
    inv7Stats.incremental = 0;
  });

  it('is clean on a healthy ledger', () => {
    const l = funded();
    for (let i = 0; i < 20; i += 1) {
      move(l, i, 1);
      expect(checkInv7(l, 1)).toEqual([]);
    }
  });

  it('catches a cached balance that disagrees with the postings — even AFTER the prefix is warm', () => {
    // THE ASSERTION THE OPTIMISATION COULD HAVE BROKEN. The corruption is introduced on an account
    // whose postings are entirely inside the already-verified prefix, so a version that trusted its
    // carried total and skipped the comparison would report clean. The comparison must still run
    // against every world account, every tick — only the SUMMING is incremental.
    const l = funded();
    for (let i = 0; i < 30; i += 1) move(l, i, 1);
    expect(checkInv7(l, 1), 'healthy first').toEqual([]);

    const account = l.account(storesAccount(A));
    expect(account).toBeDefined();
    // Reach past the API on purpose: this simulates the corruption INV-7 exists to detect, which by
    // construction cannot be produced through a legal path.
    (account as unknown as { balanceMinor: number }).balanceMinor += 7;

    const violations = checkInv7(l, 2);
    expect(violations.length, 'a drifted cached balance must still be caught').toBeGreaterThan(0);
    expect(violations.map((v) => v.message).join(' ')).toMatch(/postings sum to/);
  });

  it('recomputes in full when the log is truncated under it', () => {
    // An aborted tick truncates the posting log positionally. A prefix that kept counting would then
    // be summing rows that no longer exist, and would disagree with the balances forever.
    const l = funded();
    for (let i = 0; i < 10; i += 1) move(l, i, 1);
    expect(checkInv7(l, 1)).toEqual([]);
    const warm = inv7Stats.fullRecomputes;

    // Truncate to a real BATCH BOUNDARY, found from the log rather than modelled. My first two
    // attempts guessed the postings-per-batch layout and cut mid-batch, leaving a log that could not
    // balance against any pair of numbers — and the test correctly refused both. Cutting after the
    // last row belonging to `mv:1` means exactly transfers mv:0 and mv:1 survived, whatever the
    // internal layout is.
    const rows = l.allPostings();
    const keep = rows.reduce((n, r, i) => (String(r.eventId) === 'mv:1' ? i + 1 : n), 0);
    expect(keep, 'the boundary must be found, not assumed').toBeGreaterThan(0);
    (rows as unknown as { length: number }).length = keep;
    const moved = 2;
    (l.account(storesAccount(A)) as unknown as { balanceMinor: number }).balanceMinor = 100_000 - moved;
    (l.account(storesAccount(B)) as unknown as { balanceMinor: number }).balanceMinor = moved;

    expect(checkInv7(l, 2), 'the shortened log must reconcile with the restored balances').toEqual([]);
    expect(
      inv7Stats.fullRecomputes,
      'and it must have taken the expensive path rather than trusting a stale prefix',
    ).toBeGreaterThan(warm);
  });

  it('notices a truncate-then-REPLACE that lands on the same length', () => {
    // The case the length check alone cannot see, and the reason the boundary `eventId` is stored.
    // An aborted tick discards its postings and the retried tick writes DIFFERENT ones — so the log
    // can come back the same length with different rows in it. A prefix that only compared lengths
    // would carry a sum of postings that no longer exist, and would then disagree with the balances
    // on every tick forever while blaming the ledger.
    //
    // Found by mutation: removing the boundary check broke no test until this one existed, because
    // the truncation test above shortens the log and the length check catches that on its own.
    const l = funded();
    for (let i = 0; i < 6; i += 1) move(l, i, 1);
    expect(checkInv7(l, 1)).toEqual([]);
    const fullsBefore = inv7Stats.fullRecomputes;

    const rows = l.allPostings();
    const keep = rows.reduce((n, r, i) => (String(r.eventId) === 'mv:3' ? i + 1 : n), 0);
    const discarded = rows.slice(keep).map((r) => ({ ...r, eventId: `redo:${String(r.eventId)}` as EventId }));
    (rows as unknown as { length: number }).length = keep;
    // Same length, different rows — exactly what an abort-and-retry produces.
    (rows as unknown as { push: (...r: unknown[]) => void }).push(...discarded);
    expect(l.allPostings().length, 'the log is back to its original length').toBe(rows.length);

    expect(checkInv7(l, 2), 'and it still reconciles, because it re-summed').toEqual([]);
    expect(
      inv7Stats.fullRecomputes,
      'the rewritten prefix must force the expensive path — a length match is not an identity match',
    ).toBeGreaterThan(fullsBefore);
  });

  it('is incremental in the common case, which is the whole point', () => {
    const l = funded();
    move(l, 0, 1);
    checkInv7(l, 1);
    const fullsAfterFirst = inv7Stats.fullRecomputes;
    for (let i = 1; i < 50; i += 1) {
      move(l, i, 1);
      checkInv7(l, 1);
    }
    expect(
      inv7Stats.fullRecomputes,
      'a growing, never-truncated log must be summed once and then extended',
    ).toBe(fullsAfterFirst);
    expect(inv7Stats.incremental).toBeGreaterThan(45);
  });
});
