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
  const pieces: string[] = [];
  const sink: CanonicalSink = { push: (piece) => pieces.push(piece) };
  emit(value, sink);
  return pieces.join('');
}

/**
 * Where the canonical form goes, one token at a time: a string being joined ({@link canonicalize}) or a
 * hash being fed ({@link canonicalHash}). ONE writer serves both, so the bytes that are hashed are by
 * construction the bytes `canonicalize` returns — a second serialiser for the hash would be scar #5
 * applied to the one number the whole record is compared on.
 */
interface CanonicalSink {
  push(piece: string): void;
}

function emit(value: CanonicalValue, out: CanonicalSink): void {
  out.push(`c${String(CANONICAL_VERSION)}:`);
  write(value, 0, out);
}

function write(v: CanonicalValue, depth: number, out: CanonicalSink): void {
  if (depth > 32) throw new CanonicalError('canonical structure nested deeper than 32 levels');

  if (v === null) {
    out.push('null');
    return;
  }

  switch (typeof v) {
    case 'undefined':
    case 'bigint':
    case 'symbol':
    case 'function':
      throw new CanonicalError(`unserialisable type in canonical structure: ${typeof v}`);

    case 'boolean':
      out.push(v ? 'true' : 'false');
      return;

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
      out.push(Object.is(v, -0) ? '0' : String(v));
      return;

    case 'string':
      out.push(JSON.stringify(v));
      return;

    case 'object': {
      if (Array.isArray(v)) {
        const arr = v as readonly CanonicalValue[];
        out.push('[');
        for (let i = 0; i < arr.length; i += 1) {
          if (i > 0) out.push(',');
          // A HOLE renders as nothing, exactly as `map` + `join` rendered it — a recorded defect
          // (`test/core/canonical.test.ts`, "a sparse array emits [1,,2]") whose fix needs a
          // CANONICAL_VERSION bump, so the writer reproduces it rather than quietly changing a hash.
          if (!Object.prototype.hasOwnProperty.call(arr, i)) continue;
          write(arr[i] as CanonicalValue, depth + 1, out);
        }
        out.push(']');
        return;
      }
      const obj = v as { readonly [k: string]: CanonicalValue };
      const shape = shapeOf(obj, depth);
      out.push('{');
      let first = true;
      for (let i = 0; i < shape.sorted.length; i += 1) {
        const val = obj[shape.sorted[i] as string];
        if (val === undefined) continue; // absent, not null
        if (!first) out.push(',');
        first = false;
        out.push(shape.quoted[i] as string);
        out.push(':');
        write(val, depth + 1, out);
      }
      out.push('}');
      return;
    }
  }
}

/** An object's keys in canonical order, and each key already serialised. */
interface Shape {
  readonly keys: readonly string[];
  readonly sorted: readonly string[];
  readonly quoted: readonly string[];
}

/**
 * The last shape seen at each depth. A state table is thousands of rows with the same keys in the same
 * insertion order — every lot, every account — so the sort and the key serialisation are done once per
 * run of identical shapes rather than once per row. A cache of a pure function of the key list: the
 * output is the same with it or without it (`test/core/canonical-stream.test.ts` compares against the
 * pre-cache writer), and per depth so a nested row cannot evict its parent's shape mid-walk.
 */
const SHAPES: (Shape | undefined)[] = [];

function shapeOf(obj: { readonly [k: string]: CanonicalValue }, depth: number): Shape {
  const keys = Object.keys(obj);
  const last = SHAPES[depth];
  if (last !== undefined && last.keys.length === keys.length) {
    let same = true;
    for (let i = 0; i < keys.length; i += 1) {
      if (keys[i] !== last.keys[i]) {
        same = false;
        break;
      }
    }
    if (same) return last;
  }
  // Sort by UTF-16 code unit — the same order on every platform, unlike
  // locale collation (the Postgres ORDER BY trap, SPEC §15.5).
  const sorted = [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const shape: Shape = { keys, sorted, quoted: sorted.map((k) => JSON.stringify(k)) };
  SHAPES[depth] = shape;
  return shape;
}

/** The size at which {@link canonicalHash} hands buffered text to the hash. */
const HASH_CHUNK_CHARS = 1 << 16;

/**
 * SHA-256 of the canonical form, hex. Used for terms_hash and state_hash.
 *
 * **Streamed, never materialised.** The state hash canonicalises every state table at every tick
 * close, and the ledger's table grows with the world's lots — the Season 1 scale measurement found
 * the whole-state string at tens of megabytes on a 1,000-principal world by age 400, built and then
 * copied into a buffer for the hash, sixty times an hour. The writer now feeds the hash in 64K-char
 * chunks, so the transient is a chunk rather than the state.
 *
 * The digest is unchanged by construction: SHA-256 over chunks is SHA-256 over their concatenation,
 * and the concatenation is `canonicalize(value)` because both come from the one writer above. UTF-8
 * encoding commutes with concatenation as long as no chunk boundary splits a surrogate pair, and none
 * can: a boundary only ever falls between two whole tokens, and every token is well-formed UTF-16 —
 * `JSON.stringify` escapes a lone surrogate (ES2019's well-formed stringify) and every other token is
 * ASCII. `test/core/canonical-stream.test.ts` checks the digest against the materialised form across
 * the golden files, the edge values, random structures, and strings that straddle every boundary.
 */
export function canonicalHash(value: CanonicalValue): string {
  const hash = createHash('sha256');
  let buffered = '';
  emit(value, {
    push: (piece) => {
      buffered += piece;
      if (buffered.length >= HASH_CHUNK_CHARS) {
        hash.update(buffered, 'utf8');
        buffered = '';
      }
    },
  });
  if (buffered.length > 0) hash.update(buffered, 'utf8');
  return hash.digest('hex');
}

/**
 * A short hash for display — the first 12 hex chars. Used in the ticker and on
 * cards, never as an identity or a lookup key, because 48 bits collides.
 */
export function shortHash(full: string): string {
  return full.slice(0, 12);
}
