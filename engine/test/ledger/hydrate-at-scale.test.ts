/**
 * A checkpoint of a big world must be adoptable.
 *
 * `hydrateAppendOnly` put the durable record's rows back with `push(...rows)`, and spreading an array
 * into a call passes every element as an argument: V8 throws `Maximum call stack size exceeded` past
 * roughly 150,000 of them. The Season 1 scale measurement put a 1,000-principal world past 150,000
 * postings by tick ~400, so adopting ANY checkpoint of a world that size threw — and adoption falls
 * back to a replay from genesis, which at season scale is hours of 503s, while the operator reads a
 * stack overflow that names no rule.
 */

import { describe, expect, it } from 'vitest';
import type { EventId, PrincipalId } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';
import { CURRENCY_FAUCET, Ledger, storesAccount, type AppliedBatch } from '../../src/ledger/index.js';

const A = 'p:alva' as PrincipalId;

describe('hydrating the append-only log at season scale', () => {
  it('takes 600,000 batches without overflowing the stack, and in order', () => {
    // MUTATION: put back `this.postings.push(...postings)` — RangeError, RED.
    // 600,000 rather than the ~150,000 where plain `node` overflows: a vitest worker's stack is larger
    // and only throws somewhere between 200,000 and 500,000.
    const n = 600_000;
    const batches: AppliedBatch[] = [];
    for (let i = 0; i < n; i += 1) {
      const eventId = `mint:${String(i)}` as EventId;
      batches.push({
        eventId,
        tick: 1 + Math.floor(i / 1_000),
        kind: 'ISSUE',
        postings: [{ eventId, account: storesAccount(A), good: null, amountMinor: minor(1), amountQty: null }],
        supply: { direction: 'ISSUE', account: CURRENCY_FAUCET.STARTER_STAKE },
      });
    }
    const l = new Ledger();
    l.openAccount(storesAccount(A), 'STORES', A);
    expect(() => l.hydrateAppendOnly(batches, { postingCount: n, batchCount: n })).not.toThrow();
    expect(l.allPostings()).toHaveLength(n);
    expect(l.allBatches()).toHaveLength(n);
    expect(l.allBatches()[n - 1]?.eventId).toBe(`mint:${String(n - 1)}`);
    expect(l.allPostings()[0]?.eventId).toBe('mint:0');
  });
});
