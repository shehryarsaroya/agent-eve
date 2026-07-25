/**
 * PROP-W1, the property half: identical logical terms in ANY key insertion order
 * produce an identical hash.
 *
 * This is the single assertion that keeps the engine from fabricating a betrayal.
 * If the same terms can serialise two ways, the parties to a compact compute
 * different `terms_hash` values, and the one who is told "your hash does not
 * match" reads that — correctly, by the rules we published — as the counterparty
 * having reneged. A5' says the record must never be wrong; this is where wrong
 * would enter.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { canonicalize, canonicalHash, CANONICAL_VERSION } from '../../src/core/canonical.js';
import type { CanonicalValue } from '../../src/core/canonical.js';
import { Rng } from '../../src/core/rng.js';

/**
 * Keys chosen to hit the hazards on purpose, not just to be plausible:
 * integer-like keys (V8 reorders those numerically in Object.keys, SPEC §15.5),
 * prefixed integer-like keys where the trap hides, case pairs that a locale
 * collation would order differently, punctuation around the alphanumerics,
 * non-ASCII, the empty key, and a key carrying the structural delimiters.
 */
const HAZARD_KEYS = [
  '0',
  '1',
  '2',
  '10',
  '11',
  '2000000000',
  'k1',
  'k2',
  'k10',
  'a',
  'A',
  'b',
  'B',
  'z',
  'Z',
  '_',
  '-',
  '',
  'é',
  // NFD: e + combining acute. A different key from the NFC one above, written
  // by code point because every editor and pipe in the chain silently
  // normalises it back when it is spelled literally — this test caught that.
  String.fromCharCode(0x65, 0x0301),
  '✦',
  'a":1,"b',
  'wage',
  'share',
  'escrowed',
  'elective',
] as const;

const keyArb = fc.oneof(
  { arbitrary: fc.constantFrom(...HAZARD_KEYS), weight: 4 },
  { arbitrary: fc.string({ maxLength: 6 }), weight: 1 },
  { arbitrary: fc.fullUnicodeString({ maxLength: 4 }), weight: 1 },
);

const scalarArb: fc.Arbitrary<CanonicalValue> = fc.oneof(
  { arbitrary: fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }), weight: 4 },
  { arbitrary: fc.constantFrom(0, -0, 1, -1, 10_000, 9007199254740991, -9007199254740991), weight: 2 },
  { arbitrary: fc.string({ maxLength: 8 }), weight: 2 },
  { arbitrary: fc.fullUnicodeString({ maxLength: 5 }), weight: 1 },
  { arbitrary: fc.boolean(), weight: 1 },
  { arbitrary: fc.constant(null), weight: 1 },
);

function objectFromEntries(entries: readonly (readonly [string, CanonicalValue])[]): CanonicalValue {
  const o: Record<string, CanonicalValue> = {};
  for (const [k, v] of entries) o[k] = v;
  return o;
}

/**
 * Recursion is unrolled by depth rather than expressed with fc.letrec, so the
 * generated structures are provably shallower than the serialiser's 32-level
 * guard — otherwise a generator tuning change could start producing inputs that
 * throw, and the property would quietly become "canonicalize throws consistently".
 */
function valueArb(depth: number): fc.Arbitrary<CanonicalValue> {
  if (depth <= 0) return scalarArb;
  const inner = valueArb(depth - 1);
  return fc.oneof(
    { arbitrary: scalarArb, weight: 4 },
    { arbitrary: fc.array(inner, { maxLength: 4 }), weight: 2 },
    { arbitrary: fc.array(fc.tuple(keyArb, inner), { maxLength: 6 }).map(objectFromEntries), weight: 3 },
  );
}

const VALUE = valueArb(4);

function isPlainObject(v: CanonicalValue): v is Record<string, CanonicalValue> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * `Array.isArray` widens a union containing `readonly CanonicalValue[]` to
 * `any[]`, which would silently turn every element below into `any` and switch off
 * the type checking these helpers depend on. An explicit predicate keeps it.
 */
function isArrayValue(v: CanonicalValue): v is readonly CanonicalValue[] {
  return Array.isArray(v);
}

/**
 * Rebuild the same logical value with every object's keys inserted in a
 * different order. This is the transformation the property is about: the shape
 * an agent sends over the wire depends on how its own serialiser happened to
 * order the fields, and that must not be able to change the hash.
 */
function reinsertKeys(v: CanonicalValue, rng: Rng): CanonicalValue {
  if (isArrayValue(v)) return v.map((x) => reinsertKeys(x, rng));
  if (isPlainObject(v)) {
    const keys = rng.shuffle(Object.keys(v));
    const out: Record<string, CanonicalValue> = {};
    for (const k of keys) out[k] = reinsertKeys(v[k]!, rng);
    return out;
  }
  return v;
}

/** True when any nested object's own-key order differs, so the test can prove it is not vacuous. */
function keyOrderDiffers(a: CanonicalValue, b: CanonicalValue): boolean {
  if (isArrayValue(a) && isArrayValue(b)) {
    return a.some((x, i) => keyOrderDiffers(x, b[i] ?? null));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.join(' ') !== kb.join(' ')) return true;
    return ka.some((k) => keyOrderDiffers(a[k]!, b[k]!));
  }
  return false;
}

/**
 * Logical equality under the rules canonicalize itself declares: numbers compare
 * with ===, so -0 and 0 are one value exactly as the serialiser treats them.
 * Used for the injectivity direction — different terms must never share a hash.
 */
function logicalEqual(a: CanonicalValue, b: CanonicalValue): boolean {
  if (isArrayValue(a) || isArrayValue(b)) {
    if (!isArrayValue(a) || !isArrayValue(b)) return false;
    return a.length === b.length && a.every((x, i) => logicalEqual(x, b[i]!));
  }
  if (isPlainObject(a) || isPlainObject(b)) {
    if (!isPlainObject(a) || !isPlainObject(b)) return false;
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => k in b && logicalEqual(a[k]!, b[k]!));
  }
  if (typeof a !== typeof b) return false;
  return a === b;
}

const RUNS = 500;

describe('PROP-W1 — key insertion order cannot change terms_hash', () => {
  it('any insertion order produces a byte-identical canonical form', () => {
    // Counted rather than assumed: if the permutation ever stopped changing any
    // key order, this property would still pass while testing nothing.
    let permutationsThatActuallyDiffered = 0;

    fc.assert(
      fc.property(VALUE, fc.string({ minLength: 1, maxLength: 12 }), (value, permSeed) => {
        const baseline = canonicalize(value);
        const baselineHash = canonicalHash(value);

        // Several distinct permutations per generated value: one shuffle can
        // easily be the identity on a two-key object.
        for (let attempt = 0; attempt < 4; attempt++) {
          const rng = Rng.fromSeed(`${permSeed}:${attempt}`);
          const permuted = reinsertKeys(value, rng);
          if (keyOrderDiffers(value, permuted)) permutationsThatActuallyDiffered += 1;
          expect(canonicalize(permuted)).toBe(baseline);
          expect(canonicalHash(permuted)).toBe(baselineHash);
        }
      }),
      { numRuns: RUNS },
    );

    expect(permutationsThatActuallyDiffered).toBeGreaterThan(0);
  });

  it('a JSON round trip does not change terms_hash — the wire contract', () => {
    // An agent posts terms as JSON; we parse them and hash. If the round trip
    // moved the hash, every compact signed over HTTP would mismatch on arrival.
    fc.assert(
      fc.property(VALUE, (value) => {
        const wire = JSON.stringify(value);
        // A value made only of scalars/arrays/objects is always JSON-expressible.
        expect(typeof wire).toBe('string');
        const back = JSON.parse(wire) as CanonicalValue;
        expect(canonicalHash(back)).toBe(canonicalHash(value));
      }),
      { numRuns: RUNS },
    );
  });

  it('the hash is exactly sha256 of the canonical string, so anyone can recompute it', () => {
    fc.assert(
      fc.property(VALUE, (value) => {
        const s = canonicalize(value);
        expect(canonicalHash(value)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
      }),
      { numRuns: RUNS },
    );
  });

  it('every canonical form is versioned and single-line', () => {
    fc.assert(
      fc.property(VALUE, (value) => {
        const s = canonicalize(value);
        expect(s.startsWith(`c${CANONICAL_VERSION}:`)).toBe(true);
        for (let i = 0; i < s.length; i++) {
          // A raw control byte in a hashed token breaks every log reader that
          // splits on newlines, and the ticker renders these strings verbatim.
          if (s.charCodeAt(i) < 0x20) throw new Error(`raw control byte at ${i}`);
        }
      }),
      { numRuns: RUNS },
    );
  });
});

describe('PROP-W1 — different terms never share a canonical form', () => {
  it('canonicalize is injective over logical equality', () => {
    // The other direction of the same guarantee. If two different sets of terms
    // could serialise identically, one party could sign what the other did not
    // agree to and the ledger would show them as having agreed.
    fc.assert(
      fc.property(VALUE, VALUE, (a, b) => {
        expect(canonicalize(a) === canonicalize(b)).toBe(logicalEqual(a, b));
      }),
      { numRuns: 2000 },
    );
  });

  it('a structural clone is logically equal and hashes the same', () => {
    fc.assert(
      fc.property(VALUE, (value) => {
        const clone = JSON.parse(JSON.stringify(value)) as CanonicalValue;
        expect(logicalEqual(value, clone)).toBe(true);
        expect(canonicalHash(clone)).toBe(canonicalHash(value));
      }),
      { numRuns: RUNS },
    );
  });

  it('changing one integer changes the hash', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1000 }),
        (base, delta) => {
          const a = { terms: { escrowed: base, elective: 0 } };
          const b = { terms: { escrowed: base + delta, elective: 0 } };
          expect(canonicalHash(a)).not.toBe(canonicalHash(b));
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('PROP-W1 — no float may reach a hash, for any shape', () => {
  it('a float anywhere in the structure throws', () => {
    const floatArb = fc
      .double({ min: -1e6, max: 1e6, noNaN: true })
      .filter((d) => !Number.isInteger(d));

    fc.assert(
      fc.property(VALUE, floatArb, fc.string({ minLength: 1, maxLength: 6 }), (value, f, key) => {
        // Graft the float onto the generated structure at the top level, which is
        // the shallowest place it can hide, then again one level down.
        expect(() => canonicalize({ ...(isPlainObject(value) ? value : { v: value }), [key]: f })).toThrow(
          /float/,
        );
        expect(() => canonicalize({ outer: { inner: [value, f] } })).toThrow(/float/);
      }),
      { numRuns: RUNS },
    );
  });
});
