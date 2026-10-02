/**
 * THE STREAMED HASH IS THE MATERIALISED HASH — and the one writer is the old writer, byte for byte.
 *
 * `core/canonical.ts` moved from a recursive string builder to one token writer with two sinks (a
 * joined string for `canonicalize`, 64K-char chunks into SHA-256 for `canonicalHash`), because the
 * per-tick state hash was materialising the whole state as one string at every tick close — tens of
 * megabytes on a 1,000-principal world by age 400 (`docs/design/SCALE-2026-10-01.md` §5).
 *
 * Nothing may move. `terms_hash` is what two principals countersign and `state_hash` is what the record
 * is compared on, so this file checks the change three ways:
 *
 *   1. against the golden files — every case's canonical string and hash, unchanged;
 *   2. against the PREVIOUS implementation, copied here verbatim as `legacyCanonicalize`, over random
 *      structures with hazard keys, astral and lone-surrogate strings, holes, -0 and nesting;
 *   3. the streamed digest against SHA-256 of the materialised string, on values far larger than one
 *      chunk, with multi-byte characters placed on and around every chunk boundary.
 */

import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalHash, canonicalize, CanonicalError, type CanonicalValue } from '../../src/core/canonical.js';
import { EDGE_VALUES } from '../golden/edge-values.js';
import { loadCanonicalEdgeGolden, loadCanonicalGolden } from '../golden/load.js';

/** The implementation this file replaces, verbatim (core/canonical.ts before Season 1). */
function legacyCanonicalize(value: CanonicalValue): string {
  return `c1:${legacyWrite(value, 0)}`;
}
function legacyWrite(v: CanonicalValue, depth: number): string {
  if (depth > 32) throw new CanonicalError('canonical structure nested deeper than 32 levels');
  if (v === null) return 'null';
  switch (typeof v) {
    case 'undefined':
    case 'bigint':
    case 'symbol':
    case 'function':
      throw new CanonicalError(`unserialisable type in canonical structure: ${typeof v}`);
    case 'boolean':
      return v ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(v)) throw new CanonicalError(`non-finite number in canonical structure: ${String(v)}`);
      if (!Number.isInteger(v)) {
        throw new CanonicalError(`float in canonical structure: ${String(v)} — use integer minor units or bps`);
      }
      if (!Number.isSafeInteger(v)) {
        throw new CanonicalError(`integer beyond safe range in canonical structure: ${String(v)}`);
      }
      return Object.is(v, -0) ? '0' : String(v);
    case 'string':
      return JSON.stringify(v);
    case 'object': {
      if (Array.isArray(v)) {
        const arr = v as readonly CanonicalValue[];
        return `[${arr.map((x) => legacyWrite(x, depth + 1)).join(',')}]`;
      }
      const obj = v as { readonly [k: string]: CanonicalValue };
      const keys = Object.keys(obj).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      const parts: string[] = [];
      for (const k of keys) {
        const val = obj[k];
        if (val === undefined) continue;
        parts.push(`${JSON.stringify(k)}:${legacyWrite(val, depth + 1)}`);
      }
      return `{${parts.join(',')}}`;
    }
  }
}

const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/** Both implementations' outcome for one value: the string, or the error message. */
function outcome(f: (v: CanonicalValue) => string, v: CanonicalValue): string {
  try {
    return `ok:${f(v)}`;
  } catch (e) {
    return `err:${e instanceof Error ? `${e.constructor.name}:${e.message}` : String(e)}`;
  }
}

describe('the golden files do not move', () => {
  it('every canonical.json case serialises and hashes exactly as recorded', () => {
    for (const c of loadCanonicalGolden()) {
      expect(canonicalize(c.value), c.name).toBe(c.canonical);
      expect(canonicalHash(c.value), c.name).toBe(c.hash);
    }
  });

  it('every edge value agrees with the legacy writer and with its golden hash', () => {
    const edge = loadCanonicalEdgeGolden();
    const byName = new Map(edge.cases.map((c) => [c.name, c] as const));
    for (const [name, build] of Object.entries(EDGE_VALUES)) {
      const v = build();
      expect(outcome(canonicalize, v), name).toBe(outcome(legacyCanonicalize, v));
      const golden = byName.get(name);
      if (golden !== undefined) expect(canonicalHash(v), name).toBe(golden.hash);
    }
  });
});

const HAZARD_KEYS = ['0', '1', '10', '2', 'k1', 'k10', 'a', 'A', '\u00e9', 'e\u0301', '', '"', ':', ',', '\u{1F600}'];
const anyString = fc.oneof(
  fc.string(),
  fc.fullUnicodeString(),
  // Lone surrogates, which ES2019's well-formed JSON.stringify escapes — the property the chunking rests on.
  fc.constantFrom('\uD800', '\uDFFF', 'a\uD83D', '\uDE00b', '\uD83D\uDE00'),
);
const value: fc.Arbitrary<CanonicalValue> = fc.letrec((tie) => ({
  leaf: fc.oneof(fc.constant(null), fc.boolean(), fc.integer(), fc.constant(-0), fc.maxSafeInteger(), anyString),
  arr: fc.array(tie('node'), { maxLength: 6 }) as fc.Arbitrary<CanonicalValue>,
  obj: fc.dictionary(fc.oneof(fc.constantFrom(...HAZARD_KEYS), fc.string()), tie('node'), {
    maxKeys: 6,
  }) as fc.Arbitrary<CanonicalValue>,
  node: fc.oneof({ depthSize: 'small' }, tie('leaf'), tie('arr'), tie('obj')),
})).node as fc.Arbitrary<CanonicalValue>;

describe('the one writer is the old writer', () => {
  it('produces the legacy string, or the legacy error, for random structures', () => {
    fc.assert(
      fc.property(value, (v) => {
        expect(outcome(canonicalize, v)).toBe(outcome(legacyCanonicalize, v));
      }),
      { numRuns: 2_000, seed: 20261001 },
    );
  });

  it('reproduces the recorded defects rather than quietly fixing them (a fix is a version bump)', () => {
    const holey: number[] = [];
    holey[0] = 1;
    holey[2] = 2;
    const trailing: number[] = [];
    trailing[0] = 1;
    trailing.length = 2;
    const leading: number[] = [];
    leading[1] = 2;
    for (const v of [holey, trailing, leading, { m: new Map() }, { d: new Date(0) }] as unknown as CanonicalValue[]) {
      expect(outcome(canonicalize, v)).toBe(outcome(legacyCanonicalize, v));
    }
    expect(canonicalize(holey)).toBe('c1:[1,,2]');
  });

  it('throws exactly where the legacy writer threw', () => {
    let deep: CanonicalValue = 1;
    for (let i = 0; i < 40; i += 1) deep = [deep];
    for (const v of [1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60, deep, [1, undefined]] as unknown as CanonicalValue[]) {
      expect(outcome(canonicalize, v)).toMatch(/^err:CanonicalError:/);
      expect(outcome(canonicalize, v)).toBe(outcome(legacyCanonicalize, v));
      expect(() => canonicalHash(v)).toThrow(CanonicalError);
    }
  });
});

describe('the streamed digest is the materialised digest', () => {
  it('for random structures', () => {
    fc.assert(
      fc.property(value, (v) => {
        let materialised: string;
        try {
          materialised = canonicalize(v);
        } catch {
          return; // the error case is covered above
        }
        expect(canonicalHash(v)).toBe(sha(materialised));
      }),
      { numRuns: 1_000, seed: 20261002 },
    );
  });

  it('across many chunks, with multi-byte characters on and around every boundary', () => {
    // MUTATION: flush on a character count that can split a token — or hash with 'latin1' — RED.
    const pieces = ['\u{1F600}', '\u00e9', '\uD800', 'x', '\u4e2d', '\u2028'];
    for (let shift = 0; shift < 12; shift += 1) {
      const rows: CanonicalValue[] = [];
      for (let i = 0; i < 3_000; i += 1) {
        rows.push({
          id: `row-${String(i)}`,
          note: 'z'.repeat((i * 7 + shift) % 61) + (pieces[i % pieces.length] ?? '') + 'y'.repeat(shift),
          qty: i - 1_500,
        });
      }
      const v: CanonicalValue = { rows, shift };
      const materialised = canonicalize(v);
      expect(materialised.length).toBeGreaterThan(3 * 65_536); // really several chunks
      expect(canonicalHash(v)).toBe(sha(materialised));
    }
  });

  it('for one token longer than a chunk', () => {
    const long = '\u{1F600}'.repeat(70_000) + '\u00e9'.repeat(3);
    const v: CanonicalValue = { long, tail: [long, 1] };
    expect(canonicalHash(v)).toBe(sha(canonicalize(v)));
  });
});
