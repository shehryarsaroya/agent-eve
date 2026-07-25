/**
 * PROP-W1 and DET-4 — the golden half.
 *
 * Why this file is the most load-bearing test in the repo: `terms_hash` is what
 * two principals countersign. If the same logical terms can serialise two ways,
 * agents see hash mismatches and correctly read them as *the counterparty
 * reneging* — the engine fabricating a betrayal, which is the A5' failure and
 * strictly worse than a crash (TESTING.md §0.2).
 *
 * DET-4 asks for identical hashes on macOS and Linux. One test process cannot
 * host two operating systems, so the golden files stand in for the second host:
 * every platform must reproduce the exact strings committed in
 * `test/golden/canonical.json`. A Linux CI run that disagrees is DET-4 firing.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  canonicalize,
  canonicalHash,
  shortHash,
  CanonicalError,
  CANONICAL_VERSION,
} from '../../src/core/canonical.js';
import type { CanonicalValue } from '../../src/core/canonical.js';
import { loadCanonicalGolden, loadCanonicalEdgeGolden } from '../golden/load.js';
import { EDGE_VALUES, EDGE_ALIASES } from '../golden/edge-values.js';

const golden = loadCanonicalGolden();
const edge = loadCanonicalEdgeGolden();

/** Cast helper for inputs the type system correctly refuses. */
function bad(v: unknown): CanonicalValue {
  return v as CanonicalValue;
}

/**
 * An array with a hole at index 1, built rather than written as `[1, , 2]` so the
 * source carries no sparse literal. A hole is not `undefined`: Array.map skips it
 * and join renders it as nothing, which is the whole defect.
 */
function sparseArray(): CanonicalValue {
  const xs: number[] = [];
  xs[0] = 1;
  xs[2] = 2;
  return xs;
}

/**
 * Written as a scan rather than a regex so no literal control byte ever lands in
 * this source file — one did, twice, while this test was being written.
 */
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) < 0x20) return true;
  }
  return false;
}

describe('DET-4 / PROP-W1 — canonical.json is the cross-platform contract', () => {
  it('the golden file is populated, so no test below can be silently vacuous', () => {
    expect(golden.length).toBeGreaterThanOrEqual(30);
    expect(new Set(golden.map((c) => c.name)).size).toBe(golden.length);
  });

  it.each(golden.map((c) => [c.name, c] as const))(
    'canonicalize matches the hand-authored golden: %s',
    (_name, c) => {
      expect(canonicalize(c.value)).toBe(c.canonical);
    },
  );

  it.each(golden.map((c) => [c.name, c] as const))(
    'canonicalHash matches the golden: %s',
    (_name, c) => {
      expect(canonicalHash(c.value)).toBe(c.hash);
    },
  );

  it('every golden hash is derivable from its canonical string alone', () => {
    // So a reader can verify the file by hand without running engine code —
    // which is the difference between an oracle and a snapshot of a bug.
    for (const c of golden) {
      expect(createHash('sha256').update(c.canonical, 'utf8').digest('hex')).toBe(c.hash);
    }
  });

  it('no two distinct golden cases share a hash', () => {
    // A collision here would mean two different sets of terms countersign as the
    // same compact, which is the A5' failure with extra steps.
    const seen = new Map<string, string>();
    for (const c of golden) {
      const prior = seen.get(c.hash);
      expect(prior, `${c.name} collides with ${prior ?? ''}`).toBeUndefined();
      seen.set(c.hash, c.name);
    }
  });

  it('every canonical form carries the version prefix', () => {
    // A canonicaliser change must be visible rather than silently rewriting
    // history, so the version travels with the bytes.
    for (const c of golden) {
      expect(c.canonical.startsWith(`c${CANONICAL_VERSION}:`)).toBe(true);
    }
    expect(CANONICAL_VERSION).toBe(1);
  });

  it('a canonical form is single-line and free of raw control characters', () => {
    // It gets logged, put in a ticker, and pasted into a dispatch. A raw newline
    // in a hashed token turns one record into two on any log reader.
    for (const c of golden) {
      expect(hasControlChar(c.canonical), c.name).toBe(false);
    }
  });
});

describe('DET-4 — canonical-edge.json covers what JSON cannot express', () => {
  it('every builder has an expectation and every expectation has a builder', () => {
    const builders = Object.keys(EDGE_VALUES).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const expectations = edge.cases.map((c) => c.name).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(expectations).toEqual(builders);
  });

  it.each(edge.cases.map((c) => [c.name, c] as const))(
    'constructed input matches its golden: %s',
    (name, c) => {
      const build = EDGE_VALUES[name];
      expect(build, `no builder named ${name}`).toBeDefined();
      expect(canonicalize(build!())).toBe(c.canonical);
      expect(canonicalHash(build!())).toBe(c.hash);
    },
  );

  it('declared aliases hash identically — the equality IS the assertion', () => {
    expect(EDGE_ALIASES.length).toBeGreaterThan(0);
    for (const [a, b] of EDGE_ALIASES) {
      const ba = EDGE_VALUES[a];
      const bb = EDGE_VALUES[b];
      expect(ba, a).toBeDefined();
      expect(bb, b).toBeDefined();
      expect(canonicalHash(ba!())).toBe(canonicalHash(bb!()));
    }
  });

  it('everything not declared an alias hashes distinctly', () => {
    const aliased = new Set(
      EDGE_ALIASES.map(([a, b]) => [a, b].sort((x, y) => (x < y ? -1 : 1)).join('|')),
    );
    const names = Object.keys(EDGE_VALUES);
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = names[i]!;
        const b = names[j]!;
        const key = [a, b].sort((x, y) => (x < y ? -1 : 1)).join('|');
        if (aliased.has(key)) continue;
        const ha = canonicalHash(EDGE_VALUES[a]!());
        const hb = canonicalHash(EDGE_VALUES[b]!());
        if (canonicalize(EDGE_VALUES[a]!()) === canonicalize(EDGE_VALUES[b]!())) {
          throw new Error(`${key} serialise identically but are not declared aliases`);
        }
        expect(ha, key).not.toBe(hb);
      }
    }
  });
});

describe('the numeric-key determinism killer is real, which is why this file exists', () => {
  it('V8 reorders integer-like keys and canonicalize overrides it', () => {
    // SPEC §15.5 names "JS numeric-key iteration order" as a determinism killer.
    // This asserts the hazard concretely: Object.keys returns numeric ascending,
    // not insertion order, and JSON.stringify inherits that.
    const o = JSON.parse('{"10":"ten","2":"two","1":"one"}') as Record<string, string>;
    expect(Object.keys(o)).toEqual(['1', '2', '10']);
    expect(JSON.stringify(o)).toBe('{"1":"one","2":"two","10":"ten"}');

    // Code-unit order is different, and it is the one that is stable everywhere.
    expect(canonicalize(o)).toBe('c1:{"1":"one","10":"ten","2":"two"}');
    expect(canonicalize(o)).not.toBe(`c${CANONICAL_VERSION}:${JSON.stringify(o)}`);
  });

  it('insertion order of string keys does not survive into the hash', () => {
    const a: Record<string, number> = {};
    a.z = 1;
    a.a = 2;
    const b: Record<string, number> = {};
    b.a = 2;
    b.z = 1;
    expect(Object.keys(a)).toEqual(['z', 'a']);
    expect(Object.keys(b)).toEqual(['a', 'z']);
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });

  it('key sorting is by code unit, so no ICU or locale version can move it', () => {
    // The Postgres COLLATE trap in JavaScript form: a locale-aware compare puts
    // 'a' before 'B'; code-unit order does not.
    expect(canonicalize({ a: 1, B: 2 })).toBe('c1:{"B":2,"a":1}');
    expect(['a', 'B'].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0))).toEqual(['B', 'a']);
  });
});

describe('canonicalize rejects everything that could put a float in a hash', () => {
  const floats: readonly [string, number][] = [
    ['a half', 0.5],
    ['a third', 1 / 3],
    ['the classic', 0.1 + 0.2],
    ['negative fraction', -2.5],
    ['tiny', 1e-7],
    ['almost an integer', 1.0000000000000002],
  ];

  it.each(floats)('throws on a bare float: %s', (_label, v) => {
    expect(() => canonicalize(v)).toThrow(CanonicalError);
    expect(() => canonicalize(v)).toThrow(/float/);
  });

  it.each(floats)('throws on a float nested in an array: %s', (_label, v) => {
    expect(() => canonicalize([1, [2, [v]]])).toThrow(CanonicalError);
  });

  it.each(floats)('throws on a float nested in an object value: %s', (_label, v) => {
    expect(() => canonicalize({ terms: { share: v } })).toThrow(/float/);
  });

  it('throws on every non-finite number', () => {
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => canonicalize(v)).toThrow(CanonicalError);
      expect(() => canonicalize(v)).toThrow(/non-finite/);
      expect(() => canonicalize({ a: [v] })).toThrow(/non-finite/);
    }
  });

  it('throws on integers beyond the safe range, rather than hashing a rounded value', () => {
    // 2^53 and 2^53+1 are the same double. If either hashed, two different
    // amounts would countersign as one compact.
    for (const v of [2 ** 53, -(2 ** 53), 2 ** 53 + 2, 1e21, Number.MAX_VALUE]) {
      expect(() => canonicalize(v)).toThrow(CanonicalError);
      expect(() => canonicalize({ amount: v })).toThrow(/safe range|float/);
    }
  });

  it('accepts the safe-integer boundary exactly', () => {
    expect(canonicalize(Number.MAX_SAFE_INTEGER)).toBe('c1:9007199254740991');
    expect(canonicalize(Number.MIN_SAFE_INTEGER)).toBe('c1:-9007199254740991');
  });

  it('throws on types that have no canonical form', () => {
    expect(() => canonicalize(bad(undefined))).toThrow(/unserialisable type/);
    expect(() => canonicalize(bad(10n))).toThrow(/unserialisable type/);
    expect(() => canonicalize(bad(Symbol('s')))).toThrow(/unserialisable type/);
    expect(() => canonicalize(bad(() => 1))).toThrow(/unserialisable type/);
    // Nested, because the recursion is where a real payload would carry one.
    expect(() => canonicalize(bad({ a: [undefined] }))).toThrow(/unserialisable type/);
    expect(() => canonicalize(bad({ a: { b: 10n } }))).toThrow(/unserialisable type/);
  });
});

describe('structure', () => {
  it('null is a value; undefined is absence', () => {
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: 1, b: null }));
    expect(canonicalHash({ a: 1 })).toBe(canonicalHash(bad({ a: 1, b: undefined })));
  });

  it('containers do not collapse into one another', () => {
    const forms = [canonicalize({}), canonicalize([]), canonicalize(''), canonicalize(0), canonicalize(null)];
    expect(new Set(forms).size).toBe(forms.length);
  });

  it('array order is meaning and is never sorted', () => {
    expect(canonicalize([3, 1, 2])).toBe('c1:[3,1,2]');
    expect(canonicalHash([1, 2])).not.toBe(canonicalHash([2, 1]));
  });

  it('a key cannot forge a second field through the delimiters', () => {
    expect(canonicalHash({ 'a":1,"b': 2 })).not.toBe(canonicalHash({ a: 1, b: 2 }));
  });

  it('the integer 1 and the string "1" are different terms', () => {
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: '1' }));
    expect(canonicalHash({ a: true })).not.toBe(canonicalHash({ a: 1 }));
    expect(canonicalHash({ a: false })).not.toBe(canonicalHash({ a: 0 }));
  });

  it('serialises exactly 32 levels and refuses 33', () => {
    const chain = (n: number): CanonicalValue => {
      let v: CanonicalValue = 1;
      for (let i = 0; i < n; i++) v = { a: v };
      return v;
    };
    expect(() => canonicalize(chain(32))).not.toThrow();
    expect(() => canonicalize(chain(33))).toThrow(/nested deeper than 32/);
    const arr = (n: number): CanonicalValue => {
      let v: CanonicalValue = 1;
      for (let i = 0; i < n; i++) v = [v];
      return v;
    };
    expect(() => canonicalize(arr(32))).not.toThrow();
    expect(() => canonicalize(arr(33))).toThrow(/nested deeper than 32/);
  });

  it('a cycle terminates via the depth guard rather than blowing the stack', () => {
    // The depth limit is the only cycle protection this serialiser has. If it
    // were removed, a self-referencing payload would take the tick down with a
    // RangeError instead of a CanonicalError, and the halt would be untraceable.
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(() => canonicalize(bad(cyclic))).toThrow(CanonicalError);
  });

  it('shortHash is a display prefix and is never an identity', () => {
    const full = canonicalHash({ a: 1 });
    expect(shortHash(full)).toHaveLength(12);
    expect(full.startsWith(shortHash(full))).toBe(true);
  });
});

describe('DEFECT reports against src/core/canonical.ts', () => {
  // These are written as `.fails` on purpose. A skipped test is invisible; a
  // `.fails` test states the requirement, records that the contract currently
  // violates it, and breaks loudly the day core is fixed — which forces someone
  // to come back and delete the `.fails`.

  it.fails(
    'DEFECT(core/canonical): a Map must not serialise as {} — two different cargos currently share one terms_hash',
    () => {
      // types.ts models Hand.cargo as ReadonlyMap<GoodId, Qty>. Object.keys of a
      // Map is [], so every Map canonicalises to {}. Any hashed structure that
      // reaches for a cargo manifest would therefore countersign two different
      // manifests as the same compact — the A5' failure, silently.
      const oreCargo = { cargo: new Map([['ore', 3]]) };
      const fuelCargo = { cargo: new Map([['fuel', 99]]) };
      expect(canonicalHash(bad(oreCargo))).not.toBe(canonicalHash(bad(fuelCargo)));
    },
  );

  it.fails(
    'DEFECT(core/canonical): a non-plain object (Map/Set/Date) must be rejected, not silently emptied',
    () => {
      expect(() => canonicalize(bad({ d: new Date(0) }))).toThrow(CanonicalError);
      expect(() => canonicalize(bad({ s: new Set([1, 2]) }))).toThrow(CanonicalError);
      expect(() => canonicalize(bad({ m: new Map() }))).toThrow(CanonicalError);
    },
  );

  it.fails(
    'DEFECT(core/canonical): a sparse array emits the unparseable "[1,,2]" instead of throwing',
    () => {
      // `[1, undefined, 2]` throws, but a hole is skipped by Array.map and then
      // rendered as an empty string by join, so the same logical shape has two
      // outcomes depending on how it was built.
      expect(() => canonicalize(sparseArray())).toThrow(CanonicalError);
    },
  );

  it('U+2028 and U+2029 survive raw into the canonical string, so "single-line" is narrower than it reads', () => {
    // The control-character assertions in this file and in canonical.prop.test.ts
    // scan for `charCodeAt(i) < 0x20` only. U+2028 LINE SEPARATOR and U+2029 are
    // LineTerminators in ECMAScript and line breaks to most log readers, and
    // JSON.stringify does not escape either — so a canonical form CAN contain a
    // line break even though every test says it cannot. Recorded rather than
    // asserted as a requirement: the fix (escape them, or reject them) changes
    // every hash of a string containing one, so it needs a CANONICAL_VERSION bump.
    //
    // Built with fromCharCode, never spelled literally: a raw U+2028 in this
    // source file is itself a LineTerminator, and the same hazard that made the
    // NFD key in canonical.prop.test.ts a lie applies here.
    const LS = String.fromCharCode(0x2028);
    const PS = String.fromCharCode(0x2029);
    const emitted = canonicalize({ note: `a${LS}b${PS}c` });
    expect(emitted).toBe(`c1:{"note":"a${LS}b${PS}c"}`);
    // The existing scan does not see them, so no test in this suite fires...
    expect(hasControlChar(emitted)).toBe(false);
    // ...but they really are there, and a LineTerminator-aware splitter sees three lines.
    expect(emitted.includes(LS)).toBe(true);
    expect(emitted.split(new RegExp(`[${LS}${PS}]`))).toHaveLength(3);
  });

  it('the sparse-array output is recorded here so the defect above is not abstract', () => {
    const emitted = canonicalize(sparseArray());
    expect(emitted).toBe('c1:[1,,2]');
    // And what it emits is not JSON, so nothing downstream can even read it back.
    const parse = (): unknown => JSON.parse(emitted.slice(3)) as unknown;
    expect(parse).toThrow();
  });
});
