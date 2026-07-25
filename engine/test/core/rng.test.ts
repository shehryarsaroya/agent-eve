/**
 * DET-1 and DET-4 for randomness.
 *
 * Every hazard roll, raid interception, remainder tiebreak and Levy sweep order
 * comes from here. Replay is `(snapshot, action_log, seed) -> snapshot`, so if the
 * generator is not reproducible the permanent record cannot be re-derived, and a
 * record nobody can re-derive is not evidence of anything.
 *
 * `test/golden/rng.json` stands in for the second host DET-4 asks for: xoshiro128**
 * here is built out of `Math.imul`, `<<`, `>>>` and `>>> 0`, and the golden is the
 * assertion that those produce the same integers everywhere.
 */

import { describe, it, expect } from 'vitest';
import { Rng } from '../../src/core/rng.js';
import { loadRngGolden } from '../golden/load.js';

const golden = loadRngGolden();
const TWO32 = 2 ** 32;

/**
 * `int(2**32)` is the only public call that returns a draw unmodified: the
 * rejection limit works out to exactly 2**32, so nothing is ever rejected and no
 * bits are folded away by the modulo.
 */
function rawDraws(g: Rng, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(g.int(TWO32));
  return out;
}

describe('DET-4 — rng.json is the cross-platform contract', () => {
  it('the seed hash matches, so the pre-commit published before a tick is portable', () => {
    // SPEC §15.2: hash(seed(T)) publishes before actions for T are accepted. If
    // that hash were host-dependent the pre-commitment would prove nothing.
    expect(Rng.seedHash(golden.seed)).toBe(golden.seedHash);
  });

  it('raw draws match the golden sequence', () => {
    expect(rawDraws(Rng.fromSeed(golden.seed), golden.rawDraws16.length)).toEqual([
      ...golden.rawDraws16,
    ]);
  });

  it('derived streams match the golden, including the empty label', () => {
    expect(golden.derivedStreams.size).toBeGreaterThanOrEqual(4);
    for (const [label, expected] of golden.derivedStreams) {
      const g = Rng.fromSeed(golden.seed).derive(label);
      expect(rawDraws(g, expected.length), `derive(${JSON.stringify(label)})`).toEqual([
        ...expected,
      ]);
    }
  });

  it('int, range, chance, shuffle and pick all match the golden', () => {
    const ints = Rng.fromSeed(golden.seed);
    expect(golden.int6.map(() => ints.int(6))).toEqual([...golden.int6]);

    const ranges = Rng.fromSeed(golden.seed);
    expect(golden.rangeNeg3To3.map(() => ranges.range(-3, 3))).toEqual([...golden.rangeNeg3To3]);

    const chances = Rng.fromSeed(golden.seed);
    expect(golden.chance1In3.map(() => chances.chance(1, 3))).toEqual([...golden.chance1In3]);

    expect(
      Rng.fromSeed(golden.seed).shuffle(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']),
    ).toEqual([...golden.shuffle10]);

    const picks = Rng.fromSeed(golden.seed);
    const pool = ['COMMONS', 'MARCHES', 'FRONTIER', 'HAUL', 'ESCORT'] as const;
    expect(golden.pickFrom5.map(() => picks.pick(pool))).toEqual([...golden.pickFrom5]);
  });

  it('the draw counter matches the golden, so an accidental extra draw is caught', () => {
    // An inserted `rng.int()` anywhere shifts every downstream outcome and every
    // golden file, and the diff looks like a balance regression rather than a bug.
    const g = Rng.fromSeed(golden.seed);
    rawDraws(g, golden.rawDraws16.length);
    expect(g.draws).toBe(golden.drawsAfter16Raw);
  });
});

describe('DET-1 — same seed, same sequence', () => {
  it('two generators from one seed agree for a long run', () => {
    const a = Rng.fromSeed('det1:same-seed');
    const b = Rng.fromSeed('det1:same-seed');
    for (let i = 0; i < 5_000; i++) {
      expect(a.int(TWO32)).toBe(b.int(TWO32));
    }
    expect(a.draws).toBe(b.draws);
  });

  it('different seeds diverge immediately', () => {
    const a = rawDraws(Rng.fromSeed('det1:a'), 8);
    const b = rawDraws(Rng.fromSeed('det1:b'), 8);
    expect(a).not.toEqual(b);
  });

  it('a one-character seed change changes the whole stream', () => {
    // Seeding goes through SHA-256 precisely so that "tick:41" and "tick:42" are
    // unrelated streams rather than neighbours.
    const a = rawDraws(Rng.fromSeed('tick:41'), 8);
    const b = rawDraws(Rng.fromSeed('tick:42'), 8);
    expect(a.filter((v, i) => v === b[i])).toHaveLength(0);
  });

  it('the all-zero state is unreachable, so no seed produces a stuck generator', () => {
    // All-zero is a fixed point for xoshiro. Seeding through SHA-256 makes it
    // effectively impossible, but a stuck generator would present as a world
    // where every hazard roll came out the same — so assert variety directly.
    for (const seed of ['', '0', 'a'.repeat(200)]) {
      const draws = rawDraws(Rng.fromSeed(seed), 32);
      expect(new Set(draws).size, `seed ${JSON.stringify(seed)}`).toBe(32);
      expect(draws.every((v) => v !== 0)).toBe(true);
    }
  });
});

describe('derive — independent streams', () => {
  it('derive does not consume a draw from the parent', () => {
    // Otherwise adding a consumer in one tick phase would shift the draws seen by
    // another, which is the exact coupling derive exists to prevent.
    const g = Rng.fromSeed('derive:no-consume');
    expect(g.draws).toBe(0);
    g.derive('a');
    g.derive('b');
    g.derive('a');
    expect(g.draws).toBe(0);
  });

  it('the same label from the same parent state gives the same stream', () => {
    const g = Rng.fromSeed('derive:stable');
    expect(rawDraws(g.derive('hazard'), 8)).toEqual(rawDraws(g.derive('hazard'), 8));
  });

  it('different labels give disjoint streams', () => {
    const g = Rng.fromSeed('derive:labels');
    const labels = ['settlement', 'hazard', 'levy', 'predation', 'arrival'];
    const streams = labels.map((l) => rawDraws(g.derive(l), 8));
    for (let i = 0; i < streams.length; i++) {
      for (let j = i + 1; j < streams.length; j++) {
        expect(streams[i], `${labels[i]} vs ${labels[j]}`).not.toEqual(streams[j]);
      }
    }
    // And no derived stream is a window onto the parent's own sequence.
    const parent = rawDraws(Rng.fromSeed('derive:labels'), 64);
    for (const s of streams) {
      expect(parent.join(',').includes(s.join(','))).toBe(false);
    }
  });

  it('derive reads the parent state, so a drawn parent derives differently', () => {
    // Documented rather than judged: it means derive must be called at a defined
    // point in the tick, not opportunistically.
    const fresh = Rng.fromSeed('derive:state');
    const drawn = Rng.fromSeed('derive:state');
    drawn.int(TWO32);
    expect(rawDraws(fresh.derive('x'), 4)).not.toEqual(rawDraws(drawn.derive('x'), 4));
  });

  it('a derived generator derives again without collapsing', () => {
    const g = Rng.fromSeed('derive:nested');
    const child = g.derive('a');
    const grandchild = child.derive('b');
    expect(rawDraws(child, 4)).not.toEqual(rawDraws(grandchild, 4));
  });
});

describe('int — bounds, draws, and the rejection tail', () => {
  it('rejects a bound that is not a positive integer', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => Rng.fromSeed('bounds').int(bad)).toThrow(/positive integer/);
    }
  });

  it('int(1) is always 0 and consumes no draw', () => {
    // A degenerate bound must not silently shift the stream, or a one-element
    // choice list would change every downstream outcome by existing.
    const g = Rng.fromSeed('int:one');
    for (let i = 0; i < 10; i++) expect(g.int(1)).toBe(0);
    expect(g.draws).toBe(0);
  });

  it('int(2**32) consumes exactly one draw and returns it unmodified', () => {
    const g = Rng.fromSeed('int:two32');
    const v = g.int(TWO32);
    expect(g.draws).toBe(1);
    expect(Number.isSafeInteger(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(TWO32);
  });

  it('a bound that divides 2**32 never rejects, so the draw count is exact', () => {
    // 2**k divides 2**32, so the rejection limit is 2**32 and one call is one draw.
    for (const bound of [2, 4, 256, 65_536, 2 ** 31]) {
      const g = Rng.fromSeed(`int:pow2:${bound}`);
      for (let i = 0; i < 1000; i++) g.int(bound);
      expect(g.draws, `bound ${bound}`).toBe(1000);
    }
  });

  it('range and chance are total over their edges', () => {
    const g = Rng.fromSeed('range:edges');
    expect(g.range(5, 5)).toBe(5);
    expect(g.draws).toBe(0); // a one-value range must not consume the stream either
    expect(() => g.range(2, 1)).toThrow(/hi >= lo/);
    expect(g.chance(1, 1)).toBe(true);
    expect(g.chance(0, 5)).toBe(false);
    expect(g.chance(5, 5)).toBe(true);
    expect(g.chance(9, 5)).toBe(true);
    expect(() => g.chance(1, 0)).toThrow(/denominator/);
    expect(() => g.chance(1, -1)).toThrow(/denominator/);
  });

  it('chance(0, d) consumes a draw, so an impossible hazard still costs the same stream', () => {
    // If a zero-probability hazard skipped its draw, turning a hazard off would
    // change every later outcome in the tick — a balance change disguised as a
    // config change.
    const g = Rng.fromSeed('chance:draws');
    g.chance(0, 6);
    expect(g.draws).toBe(1);
  });
});

describe('shuffle and pick', () => {
  it('shuffle is deterministic for a seed and is a permutation', () => {
    const input = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const a = Rng.fromSeed('shuffle:det').shuffle([...input]);
    const b = Rng.fromSeed('shuffle:det').shuffle([...input]);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => (x < y ? -1 : 1))).toEqual(input);
  });

  it('shuffle mutates in place and returns the same array', () => {
    const xs = [1, 2, 3, 4];
    const out = Rng.fromSeed('shuffle:inplace').shuffle(xs);
    expect(out).toBe(xs);
  });

  it('shuffle leaves 0- and 1-element arrays alone without consuming a draw', () => {
    const g = Rng.fromSeed('shuffle:small');
    expect(g.shuffle([])).toEqual([]);
    expect(g.shuffle(['only'])).toEqual(['only']);
    expect(g.draws).toBe(0);
  });

  it('pick refuses an empty pool rather than returning undefined', () => {
    expect(() => Rng.fromSeed('pick:empty').pick([])).toThrow(/empty/);
  });

  it('float01 is in [0,1) and is exactly the raw draw over 2**32', () => {
    // float01 is banned from anything hashed. Pinning the relationship documents
    // that it is a view of the same stream, not a second source of randomness.
    const a = Rng.fromSeed('float:same');
    const b = Rng.fromSeed('float:same');
    for (let i = 0; i < 200; i++) {
      const f = a.float01();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      expect(f * TWO32).toBe(b.int(TWO32));
    }
  });
});

describe('DEFECT reports against src/core/rng.ts', () => {
  it('the arithmetic cause of the >2**32 hang, asserted without triggering it', () => {
    // For any bound above 2**32 the rejection limit computes to 0, so
    // `while (v >= limit)` can never exit: every draw is rejected forever.
    // Asserted as arithmetic rather than by calling int(), because calling it
    // would hang the test runner rather than fail it.
    for (const bound of [2 ** 32 + 1, 2 ** 33, 2 ** 40, Number.MAX_SAFE_INTEGER]) {
      expect(Math.floor(0x100000000 / bound) * bound, `bound ${bound}`).toBe(0);
      expect(Number.isSafeInteger(bound)).toBe(true); // so the guard lets it through
      expect(bound > 0).toBe(true);
    }
    // The largest bound that is safe:
    expect(Math.floor(0x100000000 / TWO32) * TWO32).toBe(TWO32);
  });

  it.skip(
    'DEFECT(core/rng): int(bound) above 2**32 must throw, not spin forever — SKIPPED because it hangs the runner',
    () => {
      // Enable only when core/rng.ts bounds the argument to 2**32. Until then this
      // body never returns, so it cannot be `.fails` either.
      expect(() => Rng.fromSeed('hang').int(2 ** 33)).toThrow();
    },
  );

  it.fails(
    'DEFECT(core/rng): shuffle silently skips swaps when the array contains undefined, biasing the result',
    () => {
      // The `if (a === undefined || b === undefined) continue` guard exists to
      // satisfy noUncheckedIndexedAccess, but it also means a legitimate undefined
      // element makes the shuffle non-uniform while still consuming its draws.
      // Any caller shuffling an array of `T | undefined` gets a biased order with
      // no error — and shuffle order decides Levy sweep order and tiebreaks.
      const withHole: (string | undefined)[] = ['a', undefined, 'c', 'd'];
      const orders = new Set<string>();
      let undefinedEverMoved = false;
      for (let i = 0; i < 2000; i++) {
        const out = Rng.fromSeed(`hole:${i}`).shuffle([...withHole]);
        if (out[1] !== undefined) undefinedEverMoved = true;
        orders.add(out.map((x) => x ?? '_').join(''));
      }
      // Measured: only 6 of the 24 permutations are reachable, and the undefined
      // never leaves index 1 — every swap that would move it is skipped.
      expect(orders.size).toBe(24);
      expect(undefinedEverMoved).toBe(true);
    },
  );
});
