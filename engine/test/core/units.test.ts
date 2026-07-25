/**
 * Integer units, and the one function the ledger's balance depends on.
 *
 * INV-6: every settled venture's splits sum **exactly** to its proceeds, and the
 * remainder is allocated by the deterministic rule and accounted, never dropped.
 * A dropped remainder does not raise an error — it makes the books drift, slowly,
 * in a system whose only product is a record people are supposed to trust.
 */

import { describe, it, expect } from 'vitest';
import {
  minor,
  qty,
  bps,
  BPS_ONE,
  addMinor,
  subMinor,
  sumMinor,
  negMinor,
  splitByBps,
  UnitError,
} from '../../src/core/units.js';
import type { Minor, Bps } from '../../src/core/units.js';
import { loadSplitGolden } from '../golden/load.js';

const golden = loadSplitGolden();

/** `toEqual` distinguishes -0 from 0, and splitByBps can return -0. Compare values, not bit patterns. */
function normaliseZeros(xs: readonly number[]): number[] {
  return xs.map((v) => (v === 0 ? 0 : v));
}

function w(...weights: number[]): Bps[] {
  return weights.map((x) => bps(x));
}

describe('constructors reject anything that is not an exact integer', () => {
  it('minor accepts safe integers of either sign and nothing else', () => {
    expect(minor(0)).toBe(0);
    expect(minor(-7)).toBe(-7);
    expect(minor(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    for (const bad of [0.5, -0.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, 1e21]) {
      expect(() => minor(bad), String(bad)).toThrow(UnitError);
      expect(() => minor(bad)).toThrow(/safe integer/);
    }
  });

  it('qty is non-negative, because a negative amount of a good is not a thing', () => {
    expect(qty(0)).toBe(0);
    expect(qty(42)).toBe(42);
    expect(() => qty(-1)).toThrow(/>= 0/);
    expect(() => qty(1.5)).toThrow(/safe integer/);
  });

  it('bps is 0..10000 inclusive, so a share can never exceed the whole', () => {
    expect(bps(0)).toBe(0);
    expect(bps(BPS_ONE)).toBe(10_000);
    expect(() => bps(-1)).toThrow(/0\.\.10000/);
    expect(() => bps(10_001)).toThrow(/0\.\.10000/);
    expect(() => bps(0.5)).toThrow(/safe integer/);
  });

  it('BPS_ONE is 10000, which is the whole vocabulary of a share', () => {
    expect(BPS_ONE).toBe(10_000);
  });
});

describe('arithmetic fails loudly rather than drifting', () => {
  it('add and sub round-trip', () => {
    expect(addMinor(minor(7), minor(-3))).toBe(4);
    expect(subMinor(minor(7), minor(-3))).toBe(10);
    expect(subMinor(addMinor(minor(123456), minor(789)), minor(789))).toBe(123456);
  });

  it('overflow past the safe range throws instead of silently rounding', () => {
    const big = minor(Number.MAX_SAFE_INTEGER);
    expect(() => addMinor(big, minor(1))).toThrow(UnitError);
    expect(() => subMinor(minor(-Number.MAX_SAFE_INTEGER), minor(2))).toThrow(UnitError);
  });

  it('negMinor of zero is positive zero, so a negated balance never becomes -0', () => {
    // A -0 leaking into a posting would serialise fine (canonicalize normalises
    // it) but would fail a naive Object.is comparison in any later reconciliation.
    expect(Object.is(negMinor(minor(0)), 0)).toBe(true);
    expect(negMinor(negMinor(minor(5)))).toBe(5);
  });

  it('sumMinor equals a plain fold for ordinary magnitudes', () => {
    expect(sumMinor([])).toBe(0);
    expect(sumMinor([minor(1), minor(2), minor(-3)])).toBe(0);
    expect(sumMinor([minor(1_000_000), minor(-999_999)])).toBe(1);
  });
});

describe('INV-6 / DET-1 — units.json is the split contract', () => {
  it('the golden file is populated', () => {
    expect(golden.length).toBeGreaterThanOrEqual(10);
  });

  it.each(golden.map((c) => [c.name, c] as const))('split matches the golden: %s', (_name, c) => {
    const parts = splitByBps(minor(c.amount), w(...c.weights));
    expect(normaliseZeros(parts)).toEqual(normaliseZeros(c.parts));
    // The assertion that actually matters, restated here so it cannot be lost in
    // a golden regeneration: every minor unit is accounted for.
    expect(parts.reduce<number>((a, b) => a + b, 0)).toBe(c.amount);
  });
});

describe('splitByBps — the edges', () => {
  it('refuses weights that do not sum to exactly 10000', () => {
    expect(() => splitByBps(minor(100), w(5000, 4999))).toThrow(/must sum to 10000/);
    expect(() => splitByBps(minor(100), w(5000, 5001))).toThrow(/must sum to 10000/);
    expect(() => splitByBps(minor(100), w(0))).toThrow(/must sum to 10000/);
  });

  it('an empty weight list is legal only for a zero amount', () => {
    expect(splitByBps(minor(0), [])).toEqual([]);
    expect(() => splitByBps(minor(1), [])).toThrow(/non-zero amount across zero weights/);
    expect(() => splitByBps(minor(-1), [])).toThrow(/non-zero amount across zero weights/);
  });

  it('throws rather than losing precision when amount * weight leaves the safe range', () => {
    // The guard is per weight, not on the total, so the ceiling on a settlement
    // depends on the LARGEST weight in the split rather than being one constant:
    // floor(2**53 / max_weight). Worth knowing before anyone documents a maximum
    // venture size — with a single 10000 bps role it is ~9.0e11 minor units, and
    // with two 5000 bps roles it is twice that.
    expect(() => splitByBps(minor(900_719_925_474), w(10_000))).not.toThrow();
    expect(() => splitByBps(minor(900_719_925_475), w(10_000))).toThrow(/overflow/);

    expect(() => splitByBps(minor(1_801_439_850_948), w(5000, 5000))).not.toThrow();
    expect(() => splitByBps(minor(1_801_439_850_949), w(5000, 5000))).toThrow(/overflow/);

    // And the amount that a 10000 bps role would refuse is fine once split in two.
    expect(() => splitByBps(minor(1e12), w(5000, 5000))).not.toThrow();
    expect(() => splitByBps(minor(1e12), w(10_000))).toThrow(/overflow/);
  });

  it('is deterministic: the same inputs give the same output, every time', () => {
    for (let i = 0; i < 50; i++) {
      expect(normaliseZeros(splitByBps(minor(1_000_003), w(3333, 3333, 3334)))).toEqual([
        333_301, 333_301, 333_401,
      ]);
    }
  });

  it('does not mutate the weights it was given', () => {
    const weights = w(3333, 3333, 3334);
    const before = [...weights];
    splitByBps(minor(100), weights);
    expect(weights).toEqual(before);
  });

  it('allocates the remainder in weight order, which is why callers must sort', () => {
    // The rule is positional, so settlement must pass roles in (venture_id,
    // role_index) order. If a caller passes them in map-iteration order instead,
    // the split is still exact but no longer reproducible — DET-1 fails, not INV-6,
    // and the failure looks like a flaky test rather than a bug.
    expect(normaliseZeros(splitByBps(minor(2), w(3333, 3333, 3334)))).toEqual([1, 1, 0]);
    expect(normaliseZeros(splitByBps(minor(2), w(3334, 3333, 3333)))).toEqual([1, 1, 0]);
    expect(normaliseZeros(splitByBps(minor(2), w(3333, 3334, 3333)))).toEqual([1, 1, 0]);
  });

  it('one weight of 10000 is the identity', () => {
    for (const amount of [0, 1, -1, 999_999, -999_999]) {
      expect(splitByBps(minor(amount), w(10_000))[0]).toBe(amount);
    }
  });

  it('handles many weights without leaking a unit', () => {
    const weights = w(...new Array<number>(100).fill(100));
    for (const amount of [0, 1, 99, 100, 101, 12_345, -12_345, -7]) {
      const parts = splitByBps(minor(amount), weights);
      expect(parts).toHaveLength(100);
      expect(parts.reduce<number>((a, b) => a + b, 0), `amount ${amount}`).toBe(amount);
    }
  });
});

describe('DEFECT reports against src/core/units.ts', () => {
  it.fails(
    'DEFECT(core/units): a 0 bps weight is handed a minor unit, so a role with no claim gets paid',
    () => {
      // The remainder walks the weights in order without checking whether the
      // weight is zero. The split still sums exactly (INV-6 holds), but it creates
      // a posting to a party that agreed to nothing — which then has to be
      // explained on a public receipt.
      const parts = splitByBps(minor(1), w(0, 5000, 5000));
      expect(parts[0]).toBe(0);
    },
  );

  it('the zero-weight payout is recorded here so the defect above is not abstract', () => {
    expect(normaliseZeros(splitByBps(minor(1), w(0, 5000, 5000)))).toEqual([1, 0, 0]);
    // Sharper: two roles with no claim take the entire pot while the three roles
    // that hold 100% of it between them are paid nothing.
    expect(normaliseZeros(splitByBps(minor(2), w(0, 0, 3333, 3333, 3334)))).toEqual([
      1, 1, 0, 0, 0,
    ]);
  });

  it.fails(
    'DEFECT(core/units): splitByBps returns -0 entries for a negative amount',
    () => {
      // Math.trunc(-0.5) is -0, and minor() accepts it. A -0 posting amount is
      // equal to 0 under === but not under Object.is, so any reconciliation that
      // uses Object.is (or a Map keyed on the sign) sees a value that is neither
      // debit nor credit.
      const parts = splitByBps(minor(-1), w(5000, 5000));
      expect(parts.some((p) => Object.is(p, -0))).toBe(false);
    },
  );

  it.fails(
    'DEFECT(core/units): sumMinor loses a unit near the safe-integer ceiling without throwing',
    () => {
      // Each element is a safe integer, so nothing individually trips checkInt —
      // but the running total passes through 2**53 where the spacing becomes 2,
      // and the final result lands back inside the safe range as a wrong number
      // that minor() happily accepts. addMinor is guarded; sumMinor is not.
      const xs: Minor[] = [minor(Number.MAX_SAFE_INTEGER), minor(1), minor(1), minor(-2)];
      expect(sumMinor(xs)).toBe(Number.MAX_SAFE_INTEGER);
    },
  );

  it('the sumMinor drift is recorded here so the defect above is not abstract', () => {
    const xs: Minor[] = [minor(Number.MAX_SAFE_INTEGER), minor(1), minor(1), minor(-2)];
    expect(sumMinor(xs)).toBe(Number.MAX_SAFE_INTEGER - 1);
    // Pairwise addition through the guarded helper refuses instead of drifting,
    // which is the behaviour sumMinor should inherit.
    expect(() => xs.reduce((a, b) => addMinor(a, b))).toThrow(UnitError);
  });
});
