/**
 * Values JSON cannot express, built in code so the golden file can still pin
 * them.
 *
 * `test/golden/canonical.json` carries its inputs as JSON, which makes it a
 * readable cross-platform contract — but JSON has no `undefined`, no symbol
 * keys, no prototype chain, and `JSON.stringify(-0)` is `"0"`, so four of the
 * behaviours most likely to fabricate a hash mismatch cannot live there.
 *
 * They live here instead, keyed by name. `canonical-edge.json` holds only the
 * expected output per name, so there is exactly one definition of each input and
 * no drift between the generator and the test.
 */

import type { CanonicalValue } from '../../src/core/canonical.js';

/** Build a chain of `n` nested arrays with `1` at the bottom. */
function chainArray(n: number): CanonicalValue {
  let v: CanonicalValue = 1;
  for (let i = 0; i < n; i++) v = [v];
  return v;
}

/**
 * Named inputs. A thunk per case, because two of them mutate a fresh object and
 * a shared instance would let one case's Symbol leak into another's assertion.
 */
export const EDGE_VALUES: Readonly<Record<string, () => CanonicalValue>> = {
  // -0 is what `splitByBps` hands back for a negative remainder (Math.trunc(-0.5)
  // is -0), so it reaches the ledger and therefore reaches terms_hash. If it
  // serialised as "-0" the same settlement would hash two ways.
  negative_zero_scalar: () => -0,
  negative_zero_in_array: () => [-0, 0, -0],
  negative_zero_as_object_value: () => ({ a: -0, b: 0 }),

  // Absent must mean absent: an optional field left off and the same field set to
  // undefined have to be one term, or an agent that omits a null-ish field gets a
  // different terms_hash from the server that defaulted it.
  undefined_value_omitted: () =>
    ({ a: 1, b: undefined, c: 2 }) as unknown as CanonicalValue,
  undefined_only_key: () => ({ a: undefined }) as unknown as CanonicalValue,
  absent_key_baseline: () => ({ a: 1, c: 2 }),

  // Symbol keys and inherited keys are invisible to Object.keys. Pinning them
  // documents that they are silently dropped rather than throwing.
  symbol_key_omitted: () => {
    const o: Record<string, CanonicalValue> = { a: 2 };
    (o as unknown as Record<symbol, number>)[Symbol('ignored')] = 1;
    return o;
  },
  inherited_key_omitted: () => {
    const o = Object.create({ inherited: 1 }) as Record<string, CanonicalValue>;
    o.own = 2;
    return o;
  },

  // The depth guard applies to arrays as well as objects, and doubles as the only
  // cycle protection this serialiser has.
  deep_nested_32_arrays: () => chainArray(32),
};

/**
 * Pairs that must hash identically — this is the *point* of the pair, not an
 * exception grudgingly allowed. Everything else in the golden must be distinct,
 * and the test asserts that too.
 */
export const EDGE_ALIASES: readonly (readonly [string, string])[] = [
  // Absent and undefined are one term. This equality is the assertion.
  ['undefined_value_omitted', 'absent_key_baseline'],
];
