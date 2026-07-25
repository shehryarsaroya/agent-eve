/**
 * Two integer scaling helpers, and the reason they are not `splitByBps`.
 *
 * `core/units.ts` deliberately does **not** export its `applyBpsTrunc`, with the
 * stated reason: "a bare `applyBps` that drops the remainder is how a ledger
 * silently stops balancing (INV-6), so this is not exported for direct use in
 * settlement." That reasoning is exactly right and it applies to **dividing a
 * pot**, which is the only place a dropped remainder can lose value.
 *
 * These two functions never divide a pot. They *define* a quantity — a kind's
 * yield given which roles are filled, a floor given a venture's value — from
 * inputs and a rate. There is no counterparty who was promised the truncated
 * fraction, so there is nothing to lose: truncation here is the definition, not
 * an approximation of one.
 *
 * **Every actual division of a pot in this module goes through `splitByBps`
 * (agreed shares) or `allocateProRata` (a short pot).** Both allocate every minor
 * unit and assert it. If you find yourself reaching for {@link scaleByBps} to
 * work out what somebody is owed *out of a fixed amount*, that is the bug this
 * comment exists to stop.
 */

import { BPS_ONE, UnitError, bps, minor, type Bps, type Minor } from '../core/units.js';

/**
 * `amount × rate / 10_000`, truncated toward zero.
 *
 * Truncation is the conservative direction for a yield and for a floor: a yield
 * rounded up mints value from nothing, and a floor rounded down would let
 * `elective` sit one minor unit under `f(kind)` on every venture forever, which
 * is how a margin requirement quietly stops binding (the same reasoning as
 * `applyHaircut` in `ledger/valuation.ts`). So floors are computed with
 * {@link scaleByBpsCeil} and yields with this.
 */
export function scaleByBps(amount: Minor, rate: Bps): Minor {
  const product = amount * rate;
  if (!Number.isSafeInteger(product)) {
    throw new UnitError(`scaleByBps overflow: ${amount} * ${rate} exceeds safe integer range`);
  }
  return minor(Math.trunc(product / BPS_ONE));
}

/** `amount × rate / 10_000`, rounded **away** from zero. For floors only. */
export function scaleByBpsCeil(amount: Minor, rate: Bps): Minor {
  const product = amount * rate;
  if (!Number.isSafeInteger(product)) {
    throw new UnitError(`scaleByBpsCeil overflow: ${amount} * ${rate} exceeds safe integer range`);
  }
  const q = product / BPS_ONE;
  return minor(product < 0 ? Math.floor(q) : Math.ceil(q));
}

/**
 * Apply a **signed** rate, which `Bps` cannot express: `bps()` rejects negatives
 * because a *share* is never negative, and the seeded residual on a venture's
 * output genuinely is — a haul can come in under its forecast.
 *
 * So the residual travels as a plain integer with its bound checked here rather
 * than wearing a brand that lies about its range. {@link assertSignedBps} is the
 * check; call it wherever a residual crosses a module boundary.
 */
export function scaleBySignedBps(amount: Minor, signedRate: number): Minor {
  assertSignedBps(signedRate);
  const product = amount * signedRate;
  if (!Number.isSafeInteger(product)) {
    throw new UnitError(`scaleBySignedBps overflow: ${amount} * ${signedRate}`);
  }
  return minor(Math.trunc(product / BPS_ONE));
}

/**
 * The negation of a rate, as a plain number.
 *
 * `Bps` is branded and non-negative by construction, so `-someBps` is refused by
 * lint (`no-unsafe-unary-minus`) — correctly: the result is not a `Bps`. Widening it
 * here, in one named place, keeps that refusal intact everywhere else and makes the
 * "this is no longer a share, it is a signed rate" step explicit rather than
 * incidental.
 */
export function negBps(rate: Bps): number {
  return 0 - (rate as number);
}

/** A signed rate is an integer in `[-10_000, 10_000]`. Nothing else. */
export function assertSignedBps(signedRate: number): void {
  if (!Number.isSafeInteger(signedRate)) {
    throw new UnitError(`a signed bps rate must be an integer, got ${signedRate}`);
  }
  if (signedRate < negBps(BPS_ONE) || signedRate > BPS_ONE) {
    throw new UnitError(`a signed bps rate must be within +/-${BPS_ONE}, got ${signedRate}`);
  }
}

/** Sum basis points and check the total is still a legal `Bps`. */
export function sumBps(xs: readonly Bps[]): Bps {
  let acc = 0;
  for (const x of xs) acc += x;
  return bps(acc);
}
