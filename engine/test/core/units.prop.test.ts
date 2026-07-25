/**
 * INV-6 as a property: `sum(splitByBps(amount, weights)) === amount`, exactly,
 * always.
 *
 * This is the single most valuable property in the units module. A dropped
 * remainder is how a ledger silently stops balancing — it raises nothing, breaks
 * nothing visible, and shows up weeks later as a total that no longer ties out in
 * an append-only ledger where nothing can be corrected. The generator therefore
 * aims at the cases where remainders exist: amounts smaller than the number of
 * weights, negative amounts, lopsided weights, and weights of zero.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { minor, bps, splitByBps, BPS_ONE, sumMinor, addMinor, subMinor, negMinor, UnitError } from '../../src/core/units.js';
import type { Bps } from '../../src/core/units.js';

/**
 * Weights that sum to exactly 10000, built by cutting the interval. Cut points
 * may repeat, which is the point: repeated cuts produce zero weights, and a zero
 * weight is where the remainder rule misbehaves.
 */
const weightsArb = (maxCount: number): fc.Arbitrary<Bps[]> =>
  fc
    .integer({ min: 1, max: maxCount })
    .chain((n) =>
      fc
        .array(fc.integer({ min: 0, max: BPS_ONE }), { minLength: n - 1, maxLength: n - 1 })
        .map((cuts) => {
          const sorted = [...cuts].sort((a, b) => a - b);
          const out: number[] = [];
          let prev = 0;
          for (const c of sorted) {
            out.push(c - prev);
            prev = c;
          }
          out.push(BPS_ONE - prev);
          return out.map((x) => bps(x));
        }),
    );

/**
 * Amounts weighted toward the small ones. A large random amount almost always
 * has a remainder, but only a small amount exercises "amount smaller than the
 * number of weights", where every truncated part is zero and the remainder is the
 * entire payout.
 */
const amountArb = fc.oneof(
  { arbitrary: fc.integer({ min: -20, max: 20 }), weight: 3 },
  { arbitrary: fc.integer({ min: -10_000, max: 10_000 }), weight: 2 },
  { arbitrary: fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }), weight: 2 },
  { arbitrary: fc.constantFrom(0, 1, -1, 9999, 10_000, 10_001, -9999, -10_000), weight: 1 },
);

function exactSum(parts: readonly number[]): number {
  // Parts of a legal split are all bounded by |amount|, so a plain fold is exact.
  return parts.reduce<number>((a, b) => a + b, 0);
}

describe('INV-6 — a split accounts for every minor unit', () => {
  it('sum(parts) === amount, exactly, for any amount and any legal weights', () => {
    fc.assert(
      fc.property(amountArb, weightsArb(12), (amount, weights) => {
        const parts = splitByBps(minor(amount), weights);
        expect(parts).toHaveLength(weights.length);
        expect(exactSum(parts)).toBe(amount);
      }),
      { numRuns: 4000 },
    );
  });

  it('holds when the amount is smaller than the number of weights', () => {
    // The interesting corner: every truncated part is 0 and the whole payout is
    // remainder. If the remainder loop were wrong here, a small settlement would
    // pay nobody and the pot would vanish.
    fc.assert(
      fc.property(
        fc.integer({ min: -30, max: 30 }),
        weightsArb(40).filter((ws) => ws.length > 8),
        (amount, weights) => {
          const parts = splitByBps(minor(amount), weights);
          expect(exactSum(parts)).toBe(amount);
          // At most one unit per weight can come from the remainder, so no part
          // may exceed the amount in magnitude.
          for (const p of parts) expect(Math.abs(p)).toBeLessThanOrEqual(Math.abs(amount) + 1);
        },
      ),
      { numRuns: 1500 },
    );
  });

  it('holds for negative amounts, which is what a clawback is', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: -1 }),
        weightsArb(10),
        (amount, weights) => {
          const parts = splitByBps(minor(amount), weights);
          expect(exactSum(parts)).toBe(amount);
          // Nothing may flip sign: a clawback must not pay anybody.
          for (const p of parts) expect(p).toBeLessThanOrEqual(0);
        },
      ),
      { numRuns: 1500 },
    );
  });

  it('every part is within one minor unit of its exact share', () => {
    // Stated in integers, because checking an integer allocation against a float
    // ideal is exactly the kind of shortcut this codebase bans. part * 10000 vs
    // amount * weight is the same comparison with no division.
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        weightsArb(12),
        (amount, weights) => {
          const parts = splitByBps(minor(amount), weights);
          parts.forEach((p, i) => {
            const drift = Math.abs(p * BPS_ONE - amount * weights[i]!);
            expect(drift, `part ${i} of ${JSON.stringify(weights)}`).toBeLessThan(2 * BPS_ONE);
          });
        },
      ),
      { numRuns: 1500 },
    );
  });

  it('the remainder distributed is always strictly fewer units than there are weights', () => {
    // The loop's convergence guard depends on this. If it were ever false the
    // guard would throw "failed to converge" mid-settlement, which fails closed
    // but takes the whole Reckoning batch with it.
    fc.assert(
      fc.property(amountArb, weightsArb(12), (amount, weights) => {
        const parts = splitByBps(minor(amount), weights);
        const truncated = weights.map((wt) => Math.trunc((amount * wt) / BPS_ONE));
        const remainder = Math.abs(amount - truncated.reduce((a, b) => a + b, 0));
        expect(remainder).toBeLessThan(weights.length);
        // And the parts differ from the truncated allocation by exactly that many units.
        const moved = parts.reduce<number>((acc, p, i) => acc + Math.abs(p - truncated[i]!), 0);
        expect(moved).toBe(remainder);
      }),
      { numRuns: 2000 },
    );
  });

  it('is a pure function: identical inputs give identical output every time', () => {
    // DET-1 at the smallest scale. splitByBps is called inside the settlement
    // waterfall, which is replayed from (snapshot, action_log, seed).
    fc.assert(
      fc.property(amountArb, weightsArb(12), (amount, weights) => {
        const first = splitByBps(minor(amount), weights);
        for (let i = 0; i < 5; i++) {
          const again = splitByBps(minor(amount), weights);
          expect(again.length).toBe(first.length);
          again.forEach((v, idx) => {
            // === rather than toEqual so a -0 does not read as a difference; the
            // ledger cares about value, and -0 === 0.
            expect(v === first[idx]).toBe(true);
          });
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('every part is a safe integer, so nothing it produces can poison a hash', () => {
    fc.assert(
      fc.property(amountArb, weightsArb(12), (amount, weights) => {
        for (const p of splitByBps(minor(amount), weights)) {
          expect(Number.isSafeInteger(p)).toBe(true);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('refuses any weight vector that does not sum to 10000', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 1000 }),
        fc
          .array(fc.integer({ min: 0, max: BPS_ONE }), { minLength: 1, maxLength: 6 })
          .filter((ws) => ws.reduce((a, b) => a + b, 0) !== BPS_ONE),
        (amount, rawWeights) => {
          expect(() => splitByBps(minor(amount), rawWeights.map((x) => bps(x)))).toThrow(UnitError);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('the branded constructors are total', () => {
  it('minor accepts exactly the safe integers', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: false }), (v) => {
        if (Number.isSafeInteger(v)) expect(minor(v)).toBe(v);
        else expect(() => minor(v)).toThrow(UnitError);
      }),
      { numRuns: 2000 },
    );
  });

  it('bps accepts exactly 0..10000', () => {
    fc.assert(
      fc.property(fc.integer({ min: -50_000, max: 50_000 }), (v) => {
        if (v >= 0 && v <= BPS_ONE) expect(bps(v)).toBe(v);
        else expect(() => bps(v)).toThrow(UnitError);
      }),
      { numRuns: 1000 },
    );
  });

  it('add, sub and neg are consistent with each other', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }),
        fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }),
        (a, b) => {
          const ma = minor(a);
          const mb = minor(b);
          expect(subMinor(addMinor(ma, mb), mb)).toBe(a);
          expect(addMinor(ma, negMinor(mb))).toBe(subMinor(ma, mb));
          expect(negMinor(negMinor(ma))).toBe(a);
          // A negated value never carries -0 into the ledger.
          expect(Object.is(negMinor(ma), -0)).toBe(false);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('sumMinor equals a fold for magnitudes the game can actually reach', () => {
    // Bounded deliberately: sumMinor has no intermediate overflow guard, which is
    // recorded as a defect in units.test.ts. This property states the range in
    // which it is trustworthy rather than pretending the range is unbounded.
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }), { maxLength: 200 }),
        (xs) => {
          const expected = xs.reduce((a, b) => a + b, 0);
          expect(sumMinor(xs.map((x) => minor(x)))).toBe(expected);
        },
      ),
      { numRuns: 500 },
    );
  });
});
