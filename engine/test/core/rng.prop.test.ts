/**
 * Is `int(bound)` actually unbiased?
 *
 * The naive test — chi-square over `int(6)` — cannot answer this. A modulo
 * shortcut for a small bound biases the result by about one part in 1.4 billion,
 * which no sample size we can afford would ever see. So the test has to be built
 * where the bias is large:
 *
 *   1. A bound near 2**32 that does not divide it. Under `next() % bound` the
 *      bottom stretch of the range would appear roughly twice as often as the
 *      top. That is enormous and a bucketed chi-square finds it instantly.
 *   2. The draw counter. Rejection sampling must *consume extra draws* for such a
 *      bound; a modulo implementation always consumes exactly one. This is a
 *      structural proof that rejection is happening at all, not a statistical one.
 *
 * Small bounds are still checked, because they catch a different failure — poor
 * low-bit quality. `int(2)` is the lowest bit of the state, and the `**` in
 * xoshiro128** is what makes that bit trustworthy; a scrambler regression would
 * show up here and nowhere else.
 *
 * Every test in this file is deterministic: the seeds are fixed, so it cannot be
 * flaky. It either passes on this implementation or it does not.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Rng } from '../../src/core/rng.js';

const TWO32 = 2 ** 32;

/**
 * Upper-tail critical values at p = 0.001, by degrees of freedom. A fixed seed
 * makes this a threshold rather than a coin flip: the margin only has to be wide
 * enough that a correct generator is not near it.
 */
const CHI2_CRIT_001: Readonly<Record<number, number>> = {
  1: 10.828,
  2: 13.816,
  3: 16.266,
  4: 18.467,
  5: 20.515,
  6: 22.458,
  7: 24.322,
  8: 26.125,
  9: 27.877,
  15: 37.697,
  16: 39.252,
  23: 49.728,
  99: 148.23,
};

function chiSquare(counts: readonly number[], expected: number): number {
  return counts.reduce((acc, o) => acc + (o - expected) ** 2 / expected, 0);
}

function assertUniform(counts: readonly number[], label: string): void {
  const n = counts.reduce((a, b) => a + b, 0);
  const df = counts.length - 1;
  const crit = CHI2_CRIT_001[df];
  expect(crit, `no critical value tabulated for df=${df}`).toBeDefined();
  const chi = chiSquare(counts, n / counts.length);
  expect(chi, `${label}: chi2=${chi.toFixed(3)} df=${df} counts=${counts.join(',')}`).toBeLessThan(
    crit!,
  );
  // Every cell must be reached at all; a chi-square can pass on a distribution
  // that never produces one value if the others compensate.
  expect(counts.every((c) => c > 0), `${label}: an unreachable outcome`).toBe(true);
}

describe('int is unbiased where a modulo shortcut would be visible', () => {
  // 2**32 / 2_500_000_000 is 1.7178, so the rejection region is ~41.8% of the
  // raw range. Under `next() % bound`, the lowest 1_794_967_296 values of the
  // output range would be produced by two raw draws each and the rest by one:
  // roughly a 2:1 ratio across the split. Nothing subtle about it.
  const BOUND = 2_500_000_000;
  const SAMPLES = 100_000;
  const BUCKETS = 10;

  it('a bound near 2**32 is uniform across its whole range', () => {
    const g = Rng.fromSeed('bias:v1');
    const counts = new Array<number>(BUCKETS).fill(0);
    const width = BOUND / BUCKETS;
    for (let i = 0; i < SAMPLES; i++) {
      const v = g.int(BOUND);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(BOUND);
      const b = Math.min(BUCKETS - 1, Math.floor(v / width));
      counts[b] = counts[b]! + 1;
    }
    assertUniform(counts, `bound ${BOUND}`);
  });

  it('the same bound demonstrably rejects draws, which is the structural proof', () => {
    // Acceptance probability is limit / 2**32 = 2_500_000_000 / 4_294_967_296 =
    // 0.582077, so 1 / 0.582077 = 1.7180 draws per sample in expectation, and this
    // seed measures 1.7228 (about 1.4 sigma high). A modulo implementation would sit
    // at exactly 1.0000, and this assertion is the only thing in the suite that can
    // tell the two apart with certainty. The band below is theory +/- ~5 sigma.
    const g = Rng.fromSeed('bias:draws');
    for (let i = 0; i < SAMPLES; i++) g.int(BOUND);
    const perSample = g.draws / SAMPLES;
    const acceptance = (Math.floor(0x100000000 / BOUND) * BOUND) / 0x100000000;
    const theory = 1 / acceptance;
    expect(theory).toBeGreaterThan(1.717);
    expect(theory).toBeLessThan(1.719);
    expect(perSample, `theory ${theory.toFixed(4)}, measured ${perSample.toFixed(4)}`).toBeGreaterThan(1.70);
    expect(perSample).toBeLessThan(1.74);
  });

  it('the halfway-plus-one bound is uniform too, where bias would be starkest', () => {
    // bound = 2**31 + 1: the rejection region is just under half the raw range,
    // and a modulo would make value 0 twice as likely as any other single value.
    const bound = 2 ** 31 + 1;
    const g = Rng.fromSeed('bias:half');
    const counts = new Array<number>(8).fill(0);
    const width = bound / 8;
    for (let i = 0; i < 80_000; i++) {
      const v = g.int(bound);
      const b = Math.min(7, Math.floor(v / width));
      counts[b] = counts[b]! + 1;
    }
    assertUniform(counts, `bound ${bound}`);
    expect(g.draws / 80_000).toBeGreaterThan(1.9);
  });
});

describe('int is uniform for the small bounds the game actually rolls', () => {
  it.each([2, 3, 5, 6, 7, 10, 16, 17])('bound %i', (bound) => {
    // int(2) is the state's lowest bit. xoshiro128** scrambles with a multiply,
    // a rotate and a multiply precisely so that bit is usable; the plus-variants
    // of the same family fail here.
    const g = Rng.fromSeed(`small:${bound}`);
    const counts = new Array<number>(bound).fill(0);
    const n = 120_000;
    for (let i = 0; i < n; i++) {
      const v = g.int(bound);
      counts[v] = counts[v]! + 1;
    }
    assertUniform(counts, `bound ${bound}`);
  });

  it('successive draws are not correlated for bound 4', () => {
    // A lattice or a short period would show as some (first, second) pairs being
    // impossible while the marginals still looked perfect.
    const g = Rng.fromSeed('pairs:4');
    const counts = new Array<number>(16).fill(0);
    for (let i = 0; i < 160_000; i++) {
      const cell = g.int(4) * 4 + g.int(4);
      counts[cell] = counts[cell]! + 1;
    }
    assertUniform(counts, 'pairs of int(4)');
  });

  it('chance(n,d) fires at the stated rate, within four standard deviations', () => {
    // A binomial bound rather than a chi-square, because scaling one count to
    // fake a second cell would inflate its variance and quietly weaken the test.
    // Four sigma on a fixed seed is a threshold, not a coin flip.
    const n = 120_000;
    for (const [num, den] of [
      [1, 3],
      [1, 2],
      [7, 10],
      [1, 100],
    ] as const) {
      const g = Rng.fromSeed(`chance:${num}/${den}`);
      let hits = 0;
      for (let i = 0; i < n; i++) if (g.chance(num, den)) hits += 1;
      const p = num / den;
      const sigma = Math.sqrt(n * p * (1 - p));
      const drift = Math.abs(hits - n * p);
      expect(drift, `chance(${num},${den}): ${hits} hits, drift ${drift.toFixed(1)}, sigma ${sigma.toFixed(1)}`).toBeLessThan(4 * sigma);
    }
  });
});

describe('shuffle is uniform over permutations', () => {
  it('all 24 orderings of 4 items appear at the right rate', () => {
    // Shuffle order decides Levy sweep order and remainder tiebreaks. A biased
    // shuffle would quietly, permanently advantage whoever sorts first.
    const g = Rng.fromSeed('shuffle:uniform');
    const seen = new Map<string, number>();
    const n = 120_000;
    for (let i = 0; i < n; i++) {
      const key = g.shuffle(['a', 'b', 'c', 'd']).join('');
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    expect(seen.size).toBe(24);
    assertUniform([...seen.values()], 'permutations of 4');
  });

  it('every element keeps its identity — a shuffle is a permutation, never a resample', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 999 }), { minLength: 0, maxLength: 40 }),
        fc.string({ minLength: 1, maxLength: 10 }),
        (xs, seed) => {
          const before = [...xs].sort((a, b) => a - b);
          const after = [...Rng.fromSeed(seed).shuffle([...xs])].sort((a, b) => a - b);
          expect(after).toEqual(before);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('int and range are total and in bounds for any argument', () => {
  it('int(bound) is always in [0, bound) for bounds up to 2**32', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: TWO32 }),
        fc.string({ minLength: 1, maxLength: 8 }),
        (bound, seed) => {
          const v = Rng.fromSeed(seed).int(bound);
          expect(Number.isSafeInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(bound);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('range(lo,hi) is always inclusive of both ends and never outside them', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        fc.string({ minLength: 1, maxLength: 8 }),
        (lo, span, seed) => {
          const hi = lo + span;
          const v = Rng.fromSeed(seed).range(lo, hi);
          expect(Number.isSafeInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(lo);
          expect(v).toBeLessThanOrEqual(hi);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('range covers both endpoints in practice, not just in principle', () => {
    // GATE_TRANSIT and HAND_RECOVERY_TICKS are expressed as inclusive ranges, so
    // an off-by-one at either end would silently change the most load-bearing
    // number in the design (SPEC §17).
    const g = Rng.fromSeed('range:coverage');
    const seen = new Set<number>();
    for (let i = 0; i < 2_000; i++) seen.add(g.range(2, 6));
    expect([...seen].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6]);
  });

  it('a seeded generator replays identically no matter what it is asked for', () => {
    // The mixed-call-sequence version of DET-1: same seed, same interleaving of
    // int/range/chance/shuffle/pick, same everything.
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 10 }),
        fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 1, maxLength: 40 }),
        (seed, ops) => {
          const run = (): string[] => {
            const g = Rng.fromSeed(seed);
            const log: string[] = [];
            for (const op of ops) {
              switch (op) {
                case 0:
                  log.push(`i${g.int(7)}`);
                  break;
                case 1:
                  log.push(`r${g.range(-3, 9)}`);
                  break;
                case 2:
                  log.push(`c${g.chance(2, 5) ? 1 : 0}`);
                  break;
                case 3:
                  log.push(`s${g.shuffle(['a', 'b', 'c']).join('')}`);
                  break;
                default:
                  log.push(`p${g.pick(['x', 'y', 'z'])}`);
                  break;
              }
            }
            log.push(`d${g.draws}`);
            return log;
          };
          expect(run()).toEqual(run());
        },
      ),
      { numRuns: 300 },
    );
  });
});
