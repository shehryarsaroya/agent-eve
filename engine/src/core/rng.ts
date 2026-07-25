/**
 * The only source of randomness in this codebase.
 *
 * `Math.random` is banned by lint (DET-7) because a single unseeded call makes
 * the whole world unreplayable, and replay is what makes the permanent record
 * trustworthy. Every draw comes from a seeded generator whose seed is committed
 * and published as a hash *before* the tick's actions are accepted (SPEC §15.2).
 *
 * Algorithm is xoshiro128** — small, fast, well-distributed, and trivially
 * portable, which matters because DET-4 asserts identical hashes on macOS and
 * Linux. No floats are used internally; `float01` exists but is never permitted
 * in a hashed structure.
 */

import { createHash } from 'node:crypto';

export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;
  private drawCount = 0;

  private constructor(s0: number, s1: number, s2: number, s3: number) {
    // All-zero state is a fixed point for xoshiro; seeding via SHA-256 makes it
    // effectively impossible, but guard anyway rather than silently degrade.
    if ((s0 | s1 | s2 | s3) === 0) {
      this.s0 = 0x9e3779b9;
      this.s1 = 0x243f6a88;
      this.s2 = 0xb7e15162;
      this.s3 = 0x85ebca6b;
    } else {
      this.s0 = s0 >>> 0;
      this.s1 = s1 >>> 0;
      this.s2 = s2 >>> 0;
      this.s3 = s3 >>> 0;
    }
  }

  /**
   * Derive a generator from a string seed. The seed string is the thing that
   * gets committed; `seedHash` publishes before actions are accepted.
   */
  static fromSeed(seed: string): Rng {
    const h = createHash('sha256').update(seed, 'utf8').digest();
    return new Rng(h.readUInt32BE(0), h.readUInt32BE(4), h.readUInt32BE(8), h.readUInt32BE(12));
  }

  /**
   * Derive an independent sub-stream, so that adding a consumer in one tick
   * phase cannot shift the draws seen by another. Without this, inserting a
   * single `rng.int()` anywhere silently changes every downstream outcome and
   * every golden file — a change that looks like a balance regression.
   */
  derive(label: string): Rng {
    return Rng.fromSeed(`${this.s0}:${this.s1}:${this.s2}:${this.s3}:${label}`);
  }

  static seedHash(seed: string): string {
    return createHash('sha256').update(seed, 'utf8').digest('hex');
  }

  /** Draws taken so far. Asserted in tests to catch accidental extra draws. */
  get draws(): number {
    return this.drawCount;
  }

  private next(): number {
    this.drawCount += 1;
    const r = (Math.imul(this.s1, 5) >>> 0);
    const result = ((((r << 7) | (r >>> 25)) >>> 0) * 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = (((this.s3 << 11) | (this.s3 >>> 21)) >>> 0);
    return result >>> 0;
  }

  /** Uniform integer in [0, boundExclusive). Rejection-sampled, so unbiased. */
  int(boundExclusive: number): number {
    if (!Number.isSafeInteger(boundExclusive) || boundExclusive <= 0) {
      throw new Error(`rng.int bound must be a positive integer, got ${boundExclusive}`);
    }
    if (boundExclusive === 1) return 0;
    // Reject the ragged tail so small bounds stay exactly uniform. A modulo
    // shortcut here would bias every hazard roll in the game very slightly,
    // which is the kind of thing nobody ever finds.
    const limit = Math.floor(0x100000000 / boundExclusive) * boundExclusive;
    let v = this.next();
    while (v >= limit) v = this.next();
    return v % boundExclusive;
  }

  /** Inclusive integer range. */
  range(lo: number, hi: number): number {
    if (hi < lo) throw new Error(`rng.range requires hi >= lo, got ${lo}..${hi}`);
    return lo + this.int(hi - lo + 1);
  }

  /** True with probability `numerator / denominator`, in integers only. */
  chance(numerator: number, denominator: number): boolean {
    if (denominator <= 0) throw new Error('rng.chance denominator must be positive');
    return this.int(denominator) < numerator;
  }

  /**
   * A float in [0, 1). Provided for non-hashed, non-ledger uses only.
   * Never put the result of this into an event, a posting, or a hash.
   */
  float01(): number {
    return this.next() / 0x100000000;
  }

  /** Deterministic in-place shuffle. */
  shuffle<T>(xs: T[]): T[] {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const a = xs[i];
      const b = xs[j];
      if (a === undefined || b === undefined) continue;
      xs[i] = b;
      xs[j] = a;
    }
    return xs;
  }

  pick<T>(xs: readonly T[]): T {
    if (xs.length === 0) throw new Error('rng.pick from empty array');
    const v = xs[this.int(xs.length)];
    if (v === undefined) throw new Error('unreachable: rng.pick out of range');
    return v;
  }
}
