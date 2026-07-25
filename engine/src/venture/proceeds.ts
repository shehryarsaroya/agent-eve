/**
 * What a venture produces (SPEC §7.4).
 *
 * > Output is a function of filled roles, committed stakes, stage conditions, and
 * > a seeded bounded residual. — §7.4
 *
 * Four inputs, in that order, and nothing else. In particular **no clock and no
 * unseeded draw**: the residual comes from an `Rng` sub-stream derived from the
 * venture's own id, so inserting a consumer anywhere else in the tick cannot shift
 * it (`core/rng.ts`'s `derive`). Without that, adding one `rng.int()` in the raid
 * phase would silently change every venture's yield and every golden file, and it
 * would present as a balance regression.
 *
 * ## Why the residual band is symmetric
 *
 * p50 is then *exactly* zero residual — an integer, not a rounded midpoint. That
 * is what lets PROP-V3 assert `your_take_at_p50` **equals** what the waterfall
 * produces rather than approximately equals it, and an approximate consequence
 * preview is not a consequence preview (§7.1's `projectedDrown` pattern).
 *
 * ## Marginal output, and the bottleneck report
 *
 * Each role carries its marginal contribution in bps; per kind they sum to
 * `BPS_ONE`, so a full fill yields exactly `baseYieldMinor`. A partial fill yields
 * strictly less, which is what makes `PARTIAL_FILL` a real outcome. The unfilled
 * role that costs the most is reported as the **bottleneck**, which is §7.4's
 * "bottleneck report" and the thing that makes a stalled venture legible on the
 * card instead of merely disappointing (A2, A13).
 */

import { Rng } from '../core/rng.js';
import type { VentureId, VentureKind } from '../core/types.js';
import { BPS_ONE, addMinor, bps, minor, type Bps, type Minor } from '../core/units.js';
import { assertSignedBps, negBps, scaleByBps, scaleBySignedBps } from './arith.js';
import { kindSpec, type RoleLabel, type RoleSpec } from './kinds.js';

/** A neutral stage: no bonus, no penalty. */
export const NEUTRAL_STAGE_BPS: Bps = bps(BPS_ONE);

/**
 * Duplicate-role diminishing returns (§7.4). A second role with the same label
 * contributes half, a third a quarter, and so on — truncated, so the tenth
 * duplicate contributes nothing at all rather than a fraction of a minor unit.
 *
 * Inert for the shipped kind table (no kind repeats a label), and present anyway:
 * the rule is in the spec, and a rule with no implementation is a rule that gets
 * violated the first time a kind adds a second `CARRIER`.
 */
export const DUPLICATE_ROLE_DIVISOR = 2;

export type Percentile = 'p10' | 'p50' | 'p90';

export const PERCENTILES: readonly Percentile[] = Object.freeze(['p10', 'p50', 'p90'] as Percentile[]);

export interface Bottleneck {
  readonly label: RoleLabel;
  readonly roleIndex: number;
  /** Yield forgone by leaving this role open, in bps of the kind's base yield. */
  readonly forgoneBps: Bps;
}

export interface ProceedsInput {
  readonly kind: VentureKind;
  /** The role indices that are filled. Order is irrelevant; duplicates are ignored. */
  readonly filled: readonly number[];
  /** Stage conditions in bps; `NEUTRAL_STAGE_BPS` is neutral. */
  readonly stageBps: Bps;
  /**
   * The seeded residual, in **signed** bps of gross. Within +/- the kind's band.
   * Signed, so it cannot wear the `Bps` brand — see `arith.ts`.
   */
  readonly residualSignedBps: number;
}

export interface Proceeds {
  readonly kind: VentureKind;
  /** Σ marginal output over filled roles, after duplicate diminishing returns. */
  readonly filledOutputBps: Bps;
  /** Yield before the residual: base x filled output x stage. */
  readonly gross: Minor;
  readonly residualSignedBps: number;
  /** What the venture actually realised. Never negative. */
  readonly proceeds: Minor;
  /** The open role that costs the most, or null when every role is filled. */
  readonly bottleneck: Bottleneck | null;
  /** True when every role in the kind's template is filled. */
  readonly fullFill: boolean;
}

export class ProceedsError extends Error {}

/**
 * Σ marginal output over the filled roles, with duplicate-label diminishing
 * returns applied in **role-index order** — so the first `CARRIER` in the template
 * is the one that counts fully and the outcome does not depend on which order the
 * fills happened to arrive in (DET-2).
 *
 * Exported separately from {@link computeProceeds} so the diminishing-returns rule
 * can be tested against a synthetic template: the shipped table repeats no label,
 * and a rule that only runs on data nobody has is a rule nobody has tested.
 */
export function computeOutputBps(roles: readonly RoleSpec[], filled: readonly number[]): Bps {
  const filledSet = new Set(filled);
  const seen = new Map<RoleLabel, number>();
  let total = 0;
  for (const [index, spec] of roles.entries()) {
    if (!filledSet.has(index)) continue;
    const priorCount = seen.get(spec.label) ?? 0;
    seen.set(spec.label, priorCount + 1);
    const divisor = DUPLICATE_ROLE_DIVISOR ** priorCount;
    total += Math.trunc(spec.marginalOutputBps / divisor);
  }
  // Cannot exceed BPS_ONE: the template sums to BPS_ONE and duplicates only ever
  // reduce. Asserted rather than assumed, because `bps()` would throw anyway and a
  // named message beats a unit error from three frames down.
  if (total > BPS_ONE) {
    throw new ProceedsError(`filled output ${total} bps exceeds ${BPS_ONE}; the kind table is inconsistent`);
  }
  return bps(total);
}

export function computeProceeds(input: ProceedsInput): Proceeds {
  const spec = kindSpec(input.kind);
  assertSignedBps(input.residualSignedBps);
  if (Math.abs(input.residualSignedBps) > spec.residualBandBps) {
    throw new ProceedsError(
      `residual ${input.residualSignedBps} bps is outside ${input.kind}'s band of ` +
        `+/-${spec.residualBandBps}; the residual is bounded by rule, not by hope`,
    );
  }
  for (const index of input.filled) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= spec.roles.length) {
      throw new ProceedsError(`${input.kind} has no role at index ${index}`);
    }
  }

  const filledOutputBps = computeOutputBps(spec.roles, input.filled);
  const gross = scaleByBps(scaleByBps(spec.baseYieldMinor, filledOutputBps), input.stageBps);
  const residual = scaleBySignedBps(gross, input.residualSignedBps);
  // Clamped at zero: a venture can under-deliver to nothing but it cannot owe the
  // world value, and a negative proceeds figure would flow into `splitByBps` and
  // hand out negative payouts. INV-6 checks payouts are non-negative; this is the
  // upstream reason there is nothing for it to catch.
  const proceeds = minor(Math.max(0, addMinor(gross, residual)));

  return {
    kind: input.kind,
    filledOutputBps,
    gross,
    residualSignedBps: input.residualSignedBps,
    proceeds,
    bottleneck: bottleneckOf(spec.roles, input.filled),
    fullFill: filledOutputBps === BPS_ONE && new Set(input.filled).size === spec.roles.length,
  };
}

function bottleneckOf(roles: readonly RoleSpec[], filled: readonly number[]): Bottleneck | null {
  const filledSet = new Set(filled);
  let worst: Bottleneck | null = null;
  for (const [index, spec] of roles.entries()) {
    if (filledSet.has(index)) continue;
    // Strictly greater, so the earliest index wins a tie — deterministic, and it
    // reads correctly on the card ("the carrier is what this is waiting on").
    if (worst === null || spec.marginalOutputBps > worst.forgoneBps) {
      worst = { label: spec.label, roleIndex: index, forgoneBps: spec.marginalOutputBps };
    }
  }
  return worst;
}

/**
 * The residual at a named percentile: `-band`, `0`, `+band`.
 *
 * Exact integers by construction. `p50 === 0` is the identity PROP-V3 rests on.
 */
export function residualAtPercentile(kind: VentureKind, percentile: Percentile): number {
  const band = kindSpec(kind).residualBandBps;
  switch (percentile) {
    case 'p10':
      return negBps(band);
    case 'p50':
      return 0;
    case 'p90':
      return band;
  }
}

/**
 * Draw the residual for a venture.
 *
 * Derived by venture id, so two ventures resolving in the same tick draw
 * independently and adding a third consumer shifts neither (`Rng.derive`). The
 * label is part of the sub-stream key, so a future `venture:hazard` stream cannot
 * collide with this one.
 */
export function drawResidual(kind: VentureKind, venture: VentureId, rng: Rng): number {
  const band = kindSpec(kind).residualBandBps;
  if (band === 0) return 0;
  return rng.derive(`venture:proceeds:${venture}`).range(negBps(band), band);
}

/** The p10/p50/p90 band a venture card publishes (§12.1's `EV p10/p50/p90`). */
export interface ProceedsBand {
  readonly p10: Minor;
  readonly p50: Minor;
  readonly p90: Minor;
}

export function proceedsBand(
  kind: VentureKind,
  filled: readonly number[],
  stageBps: Bps = NEUTRAL_STAGE_BPS,
): ProceedsBand {
  const at = (percentile: Percentile): Minor =>
    computeProceeds({
      kind,
      filled,
      stageBps,
      residualSignedBps: residualAtPercentile(kind, percentile),
    }).proceeds;
  return { p10: at('p10'), p50: at('p50'), p90: at('p90') };
}
