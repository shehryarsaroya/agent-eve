/**
 * Integer units. There are no floats in this codebase's value paths.
 *
 * SPEC §15.5 bans "floats in anything hashed". We go further and ban them from
 * every quantity, because a float that never reaches a hash still reaches the
 * ledger, and INV-2 (supply conservation) cannot hold under rounding drift.
 *
 * All money is in **minor units** (integer). All goods are in **whole units**
 * (integer). All shares are in **basis points** (integer, 10_000 = 100%).
 */

/** Money, in minor units. Never a fraction, never negative except on a faucet. */
export type Minor = number & { readonly __brand: 'Minor' };
/** A quantity of a good, in whole units. */
export type Qty = number & { readonly __brand: 'Qty' };
/** A proportion in basis points. 10_000 === 100%. */
export type Bps = number & { readonly __brand: 'Bps' };

export const BPS_ONE = 10_000 as Bps;

export class UnitError extends Error {}

function checkInt(v: number, what: string): void {
  if (!Number.isSafeInteger(v)) {
    // Deliberately loud. A non-integer here is a class of bug that would
    // otherwise surface days later as a ledger that does not balance.
    throw new UnitError(`${what} must be a safe integer, got ${String(v)}`);
  }
}

export function minor(v: number): Minor {
  checkInt(v, 'Minor');
  return v as Minor;
}

export function qty(v: number): Qty {
  checkInt(v, 'Qty');
  if (v < 0) throw new UnitError(`Qty must be >= 0, got ${v}`);
  return v as Qty;
}

export function bps(v: number): Bps {
  checkInt(v, 'Bps');
  if (v < 0 || v > BPS_ONE) throw new UnitError(`Bps must be 0..10000, got ${v}`);
  return v as Bps;
}

/** Add money. Result is checked, so overflow past 2^53 throws rather than drifts. */
export function addMinor(a: Minor, b: Minor): Minor {
  return minor(a + b);
}

export function subMinor(a: Minor, b: Minor): Minor {
  return minor(a - b);
}

export function sumMinor(xs: readonly Minor[]): Minor {
  // Fold through addMinor rather than a bare `acc += x`. A plain accumulator that
  // crosses 2^53 rounds SILENTLY — `sumMinor([MAX_SAFE_INTEGER, 1, 1, -2])` returned
  // one less than the exact answer and `minor()` accepted it because the wrong result
  // was itself a safe integer. addMinor re-checks each intermediate, so a sum that
  // leaves the safe range throws (fail-closed) instead of recording a wrong total.
  // Found by a codex arithmetic pass. It only bites at 2^53 magnitude, but a ledger
  // that can be off by one is not a ledger.
  let acc = minor(0);
  for (const x of xs) acc = addMinor(acc, x);
  return acc;
}

export function negMinor(a: Minor): Minor {
  return minor(0 - (a as number));
}

/**
 * Apply a basis-point share to an amount, truncating toward zero.
 *
 * Truncation is deliberate and the remainder is **never discarded** — callers
 * must use {@link splitByBps}, which accounts for every minor unit. A bare
 * `applyBps` that drops the remainder is how a ledger silently stops balancing
 * (INV-6), so this is not exported for direct use in settlement.
 */
function applyBpsTrunc(amount: Minor, share: Bps): Minor {
  // Integer maths only: (amount * share) / 10_000, truncated.
  // amount and share are safe integers; the product may exceed 2^53 for very
  // large amounts, so guard explicitly rather than silently losing precision.
  const product = amount * share;
  if (!Number.isSafeInteger(product)) {
    throw new UnitError(`applyBps overflow: ${amount} * ${share} exceeds safe integer range`);
  }
  // `+ 0` collapses a negative-zero: `Math.trunc(-0.5)` is `-0`, and while `-0 === 0`
  // is true, `Object.is(-0, 0)` is false — so a -0 posting amount is a value that any
  // reconciliation keyed on the sign (or using Object.is) reads as neither debit nor
  // credit. A minor unit is a whole integer; it has no signed zero. Found by a codex pass.
  return minor(Math.trunc(product / BPS_ONE) + 0);
}

/**
 * Split an amount across weights in basis points, allocating **every** minor
 * unit deterministically.
 *
 * The remainder from truncation is handed out one unit at a time in the order
 * the weights were given. Callers must therefore pass weights in a canonical
 * order (settlement uses `venture_id`, then `role_index`) so the result is
 * reproducible — this is what makes INV-6 and DET-1 hold simultaneously.
 *
 * Invariant: `sum(result) === amount` exactly, always.
 */
export function splitByBps(amount: Minor, weights: readonly Bps[]): Minor[] {
  if (weights.length === 0) {
    if (amount !== 0) throw new UnitError('cannot split a non-zero amount across zero weights');
    return [];
  }
  const total = weights.reduce<number>((a, b) => a + b, 0);
  if (total !== BPS_ONE) {
    throw new UnitError(`split weights must sum to ${BPS_ONE} bps, got ${total}`);
  }

  const out = weights.map((w) => applyBpsTrunc(amount, w));
  const allocated = out.reduce<number>((a, b) => a + b, 0);
  let remainder = amount - allocated;

  // Distribute the remainder ONLY across positive-weight indices, in order.
  //
  // The earlier version handed it out "one unit per weight, in the given order"
  // starting at index 0 — so `splitByBps(2, [0, 0, 3333, 3333, 3334])` returned
  // `[1, 1, 0, 0, 0]`, giving the two ZERO-weight roles the whole pot. A role owed
  // 0 bps of the proceeds must receive nothing; handing it a remainder unit is value
  // going to a party the split says is owed none. Found by a codex arithmetic pass.
  // Weights sum to BPS_ONE, so at least one is positive and the remainder always has
  // somewhere legitimate to land.
  const positive = weights.map((w, idx) => (w > 0 ? idx : -1)).filter((idx) => idx >= 0);
  const step = remainder >= 0 ? 1 : -1;
  let i = 0;
  while (remainder !== 0) {
    const target = positive[i % positive.length];
    if (target === undefined) throw new UnitError('unreachable: no positive weight to take the remainder');
    const cur = out[target];
    if (cur === undefined) throw new UnitError('unreachable: split index out of range');
    out[target] = minor(cur + step);
    remainder -= step;
    i += 1;
    if (i > positive.length * 2) {
      throw new UnitError('unreachable: remainder distribution failed to converge');
    }
  }

  const check = out.reduce<number>((a, b) => a + b, 0);
  if (check !== amount) {
    throw new UnitError(`split lost value: allocated ${check}, expected ${amount}`);
  }
  return out;
}
