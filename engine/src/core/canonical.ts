/**
 * Canonical serialisation. Golden-filed from commit #1 (Gate 0).
 *
 * Why this file is load-bearing: `terms_hash` is what two principals
 * countersign. If the same logical terms can serialise two ways, agents see
 * random hash mismatches and correctly read them as *the counterparty
 * reneging* — the engine fabricating a betrayal, which is the A5′ failure and
 * strictly worse than a crash. So:
 *
 *   - keys sorted by code unit, always
 *   - integers only; a float anywhere in the structure throws
 *   - no `undefined`; absent means absent
 *   - explicit version prefix, so a canonicaliser change is visible rather
 *     than silently rewriting history
 *
 * PROP-W1 asserts key-order independence. DET-4 asserts cross-platform
 * identity. Both compare against `test/golden/canonical.json`.
 */

import { createHash } from 'node:crypto';

export const CANONICAL_VERSION = 1;

export class CanonicalError extends Error {}

export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalValue[]
  | { readonly [k: string]: CanonicalValue };

/**
 * Serialise to a canonical string.
 *
 * Deliberately *not* `JSON.stringify` with a replacer: object key order in
 * JSON.stringify follows insertion order, and for integer-like string keys V8
 * reorders them numerically. That second behaviour is the "JS numeric-key
 * iteration order" determinism killer named in SPEC §15.5, and it is invisible
 * until a principal id happens to be numeric.
 */
export function canonicalize(value: CanonicalValue): string {
  return `c${CANONICAL_VERSION}:${write(value, 0)}`;
}

function write(v: CanonicalValue, depth: number): string {
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
      if (!Number.isFinite(v)) {
        throw new CanonicalError(`non-finite number in canonical structure: ${String(v)}`);
      }
      if (!Number.isInteger(v)) {
        // The whole point. Money is minor units, shares are bps.
        throw new CanonicalError(
          `float in canonical structure: ${String(v)} — use integer minor units or bps`,
        );
      }
      if (!Number.isSafeInteger(v)) {
        throw new CanonicalError(`integer beyond safe range in canonical structure: ${String(v)}`);
      }
      // Normalise -0 to 0; they hash differently as strings but are the same value.
      return Object.is(v, -0) ? '0' : String(v);

    case 'string':
      return JSON.stringify(v);

    case 'object': {
      if (Array.isArray(v)) {
        const arr = v as readonly CanonicalValue[];
        return `[${arr.map((x) => write(x, depth + 1)).join(',')}]`;
      }
      const obj = v as { readonly [k: string]: CanonicalValue };
      // Sort by UTF-16 code unit — the same order on every platform, unlike
      // locale collation (the Postgres ORDER BY trap, SPEC §15.5).
      const keys = Object.keys(obj).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      const parts: string[] = [];
      for (const k of keys) {
        const val = obj[k];
        if (val === undefined) continue; // absent, not null
        parts.push(`${JSON.stringify(k)}:${write(val, depth + 1)}`);
      }
      return `{${parts.join(',')}}`;
    }

  }
}

/** SHA-256 of the canonical form, hex. Used for terms_hash and state_hash. */
export function canonicalHash(value: CanonicalValue): string {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
}

/**
 * A short hash for display — the first 12 hex chars. Used in the ticker and on
 * cards, never as an identity or a lookup key, because 48 bits collides.
 */
export function shortHash(full: string): string {
  return full.slice(0, 12);
}
