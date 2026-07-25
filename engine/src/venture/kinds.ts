/**
 * The eight venture kinds, as a table (SPEC §7, §17).
 *
 * Three properties that decide whether cooperation is *forced* or merely
 * *encouraged* are **derived from the yield table, never hand-maintained**:
 *
 *   - {@link isTopYield}   — `baseYieldMinor >= TOP_YIELD_THRESHOLD_MINOR`
 *   - {@link minRoles}     — 4 on a top-yield kind, 2 otherwise (§17)
 *   - {@link isEscrowable} — false on a top-yield kind (PROP-V5, §7.5)
 *
 * Derivation rather than three booleans is deliberate. §7.2 records the v2.0
 * draft's fatal flaw — presence scarcity did not bind, because 3 hands x 24 h is
 * ~12 solo ventures a day — and the fix is arithmetic: **>=4 roles, one per
 * principal, so >=4 principals.** A hand-maintained `topYield: true` on a kind
 * whose yield later rose is a silent hole in that arithmetic, and it would present
 * as "cooperation is optional again", which no unit test asks about. Tie the three
 * to the one number they are about and the hole cannot open.
 *
 * ## Why these two kinds are top-yield and the others are not
 *
 * `BUILD` and `SIEGE` are the two that create or take a **durable** asset — a
 * structure, a holding — which is the largest single prize in the game and
 * therefore §7.6's "grand venture" shape: the highest-yield kinds are legally
 * un-escrowable, so the whole consideration is elective and trust is genuinely at
 * risk. `RAID` is deliberately *not* top-yield: §9's Demand window is a small
 * party plus joiners, and forcing four principals on it would delete
 * agent-initiated predation. `DIG` is not, because it is the newcomer loop (§13).
 */

import type { VentureKind } from '../core/types.js';
import { BPS_ONE, bps, minor, type Bps, type Minor } from '../core/units.js';
import { scaleByBpsCeil, sumBps } from './arith.js';

/**
 * Role labels — the slot names a venture card renders (A13).
 *
 * A typed union rather than free-form strings so `test/core/vocabulary-repo.test.ts`
 * can actually see them: §3 is a rules surface, and a role label is agent-facing
 * text. None of these is a §3 canon term.
 *
 * `ESCORT` appears here **and** as a `VentureKind`, and that is one concept in two
 * shapes rather than §3's forbidden second concept: escorting a load is the job,
 * whether it is a slot inside somebody's `HAUL` or a standalone contract. §3's ROLE
 * row defines a role as "a slot in a venture" and says nothing about a slot's name
 * being reserved.
 */
export type RoleLabel = 'CARRIER' | 'ESCORT' | 'SCOUT' | 'DIGGER' | 'TALLYMAN' | 'FACTOR' | 'WRIGHT' | 'BREAKER' | 'RAIDER';

/** INV-26's declared cap on `venture.roles`. Every array has a bound (scar #3). */
export const MAX_ROLES_PER_VENTURE = 8;

/** §17: roles on top-yield kinds. The number that forces cooperation. */
export const MIN_ROLES_TOP_YIELD = 4;

/** A venture needs at least two roles, or it is one principal working alone. */
export const MIN_ROLES = 2;

/**
 * The line above which a kind is top-yield. One number, *(calibrate)*, and moving
 * it moves `minRoles` and `isEscrowable` with it — which is the point.
 */
export const TOP_YIELD_THRESHOLD_MINOR = minor(30_000);

export interface RoleSpec {
  readonly label: RoleLabel;
  /**
   * This role's marginal contribution to the kind's yield, in bps. Per kind these
   * sum to exactly `BPS_ONE`, so a full fill yields exactly `baseYieldMinor` and a
   * partial fill yields strictly less — which is what makes `PARTIAL_FILL` a real
   * outcome rather than a label (§7.4).
   */
  readonly marginalOutputBps: Bps;
}

export interface KindSpec {
  readonly kind: VentureKind;
  readonly roles: readonly RoleSpec[];
  /** Yield at a full fill, neutral stage, median residual. *(calibrate)* */
  readonly baseYieldMinor: Minor;
  /**
   * The seeded bounded residual's half-width, in bps of gross (§7.4). Symmetric,
   * so p50 is exactly zero residual — which is what makes `your_take_at_p50`
   * checkable against the waterfall rather than approximately equal to it
   * (PROP-V3).
   */
  readonly residualBandBps: Bps;
  /** `f(kind)`'s proportional term: `elective >= this x pinned consideration`. */
  readonly electiveFloorBps: Bps;
  /** `f(kind)`'s absolute term, so a tiny venture still risks something. */
  readonly electiveFloorMinor: Minor;
}

function role(label: RoleLabel, marginalOutputBps: number): RoleSpec {
  return { label, marginalOutputBps: bps(marginalOutputBps) };
}

/**
 * The kind table. Every number is *(calibrate)* per §17's convention — these are
 * starting points for simulation, not claims of correctness.
 *
 * `HAUL` is two roles on purpose: `CARRIER` + `ESCORT` is the vertical slice's
 * exact shape ("A forms a HAUL and hires B's hand as ESCORT for a share, part
 * escrowed and part elective"), and two roles at one principal each means the
 * smallest interesting venture already needs a counterparty.
 */
const SPECS: Readonly<Record<VentureKind, KindSpec>> = Object.freeze({
  HAUL: {
    kind: 'HAUL',
    roles: [role('CARRIER', 7_000), role('ESCORT', 3_000)],
    baseYieldMinor: minor(12_000),
    residualBandBps: bps(1_500),
    electiveFloorBps: bps(2_500),
    electiveFloorMinor: minor(100),
  },
  DIG: {
    kind: 'DIG',
    roles: [role('DIGGER', 7_500), role('TALLYMAN', 2_500)],
    baseYieldMinor: minor(6_000),
    residualBandBps: bps(2_000),
    electiveFloorBps: bps(2_000),
    electiveFloorMinor: minor(50),
  },
  ESCORT: {
    kind: 'ESCORT',
    roles: [role('ESCORT', 6_500), role('SCOUT', 3_500)],
    baseYieldMinor: minor(8_000),
    residualBandBps: bps(1_500),
    electiveFloorBps: bps(3_000),
    electiveFloorMinor: minor(100),
  },
  RAID: {
    kind: 'RAID',
    roles: [role('RAIDER', 6_500), role('SCOUT', 3_500)],
    baseYieldMinor: minor(15_000),
    residualBandBps: bps(4_000),
    electiveFloorBps: bps(3_500),
    electiveFloorMinor: minor(200),
  },
  SURVEY: {
    kind: 'SURVEY',
    roles: [role('SCOUT', 6_000), role('TALLYMAN', 4_000)],
    baseYieldMinor: minor(4_000),
    residualBandBps: bps(3_000),
    electiveFloorBps: bps(2_000),
    electiveFloorMinor: minor(50),
  },
  LEVY: {
    kind: 'LEVY',
    roles: [role('CARRIER', 6_000), role('TALLYMAN', 4_000)],
    baseYieldMinor: minor(5_000),
    residualBandBps: bps(500),
    electiveFloorBps: bps(2_000),
    electiveFloorMinor: minor(50),
  },
  BUILD: {
    kind: 'BUILD',
    roles: [
      role('WRIGHT', 4_000),
      role('CARRIER', 2_000),
      role('FACTOR', 2_000),
      role('TALLYMAN', 2_000),
    ],
    baseYieldMinor: minor(40_000),
    residualBandBps: bps(1_000),
    electiveFloorBps: bps(BPS_ONE),
    electiveFloorMinor: minor(500),
  },
  SIEGE: {
    kind: 'SIEGE',
    roles: [
      role('BREAKER', 4_000),
      role('RAIDER', 2_500),
      role('CARRIER', 2_000),
      role('SCOUT', 1_500),
    ],
    baseYieldMinor: minor(60_000),
    residualBandBps: bps(2_500),
    electiveFloorBps: bps(BPS_ONE),
    electiveFloorMinor: minor(1_000),
  },
} satisfies Record<VentureKind, KindSpec>);

export const VENTURE_KINDS: readonly VentureKind[] = Object.freeze([
  'BUILD',
  'DIG',
  'ESCORT',
  'HAUL',
  'LEVY',
  'RAID',
  'SIEGE',
  'SURVEY',
] satisfies VentureKind[]);

export class KindError extends Error {}

export function kindSpec(kind: VentureKind): KindSpec {
  // An own-property lookup, never a bare index: `SPECS` inherits Object.prototype,
  // so `SPECS['constructor']` would return a *function* for a caller that reached
  // this with an unvalidated string. Same reasoning as `declaredClass` in
  // `world/commons.ts` — classification must be total, not nearly total.
  if (!Object.prototype.hasOwnProperty.call(SPECS, kind)) {
    throw new KindError(`unknown venture kind ${String(kind)}`);
  }
  return SPECS[kind];
}

/**
 * A top-yield kind: the highest prizes in the game, and therefore the ones §7.5
 * makes un-escrowable and §17 gives >=4 roles.
 */
export function isTopYield(kind: VentureKind): boolean {
  return kindSpec(kind).baseYieldMinor >= TOP_YIELD_THRESHOLD_MINOR;
}

export function topYieldKinds(): readonly VentureKind[] {
  return VENTURE_KINDS.filter(isTopYield);
}

/** §17: ">=4, one per principal". The whole of PROP-V6's third clause. */
export function minRoles(kind: VentureKind): number {
  return isTopYield(kind) ? MIN_ROLES_TOP_YIELD : MIN_ROLES;
}

/**
 * PROP-V5 / §7.5: "the highest-yield kinds are **legally un-escrowable**". Left
 * free, agents set `elective` to zero because escrow strictly dominates for the
 * buyer of any promise — and then A7 is dead letter and standing has nothing to
 * accrue to.
 */
export function isEscrowable(kind: VentureKind): boolean {
  return !isTopYield(kind);
}

/**
 * The **arithmetic** statement of PROP-V6: how many distinct principals a kind
 * needs, given "one principal fills at most one role in a venture".
 *
 * Exported because the interesting assertion is about *capital being irrelevant*:
 * this number does not take a balance, so no amount of capital moves it, and a
 * solo principal cannot satisfy a top-yield kind at any capital level.
 */
export function principalsRequired(kind: VentureKind): number {
  return minRoles(kind);
}

/**
 * `f(kind)` from §7.5 — the elective floor, "rising with venture value".
 *
 * Two terms, because either alone fails: proportional-only lets a 40-minor
 * venture risk nothing, and absolute-only stops binding the moment ventures get
 * large. Rounded **up** (see `scaleByBpsCeil`) so the floor is never one minor
 * unit slack.
 */
export function electiveFloor(kind: VentureKind, pinnedConsideration: Minor): Minor {
  const spec = kindSpec(kind);
  if (pinnedConsideration <= 0) return minor(0);
  if (!isEscrowable(kind)) {
    // Un-escrowable: the floor *is* the whole consideration. Stated here rather
    // than only in the validator, so the number an agent is shown and the number
    // the validator enforces come from one function (scar #1).
    return pinnedConsideration;
  }
  const proportional = scaleByBpsCeil(pinnedConsideration, spec.electiveFloorBps);
  const floor = Math.max(proportional, spec.electiveFloorMinor);
  // A floor above the consideration is unsatisfiable; clamp so a small venture is
  // simply fully elective rather than impossible.
  return minor(Math.min(floor, pinnedConsideration));
}

/**
 * CI totality check on the table itself, in both directions — the same shape as
 * `assertVerbsClassified` in `world/commons.ts`, and for the same reason: the
 * engine and the canon disagreeing about the vocabulary *is* scar #1.
 */
export function assertKindTable(): void {
  const problems: string[] = [];
  for (const kind of VENTURE_KINDS) {
    const spec = kindSpec(kind);
    if (spec.kind !== kind) problems.push(`${kind} spec is labelled ${spec.kind}`);
    if (spec.roles.length < minRoles(kind)) {
      problems.push(
        `${kind} declares ${spec.roles.length} roles but needs >=${minRoles(kind)}` +
          (isTopYield(kind) ? ' (top-yield)' : ''),
      );
    }
    if (spec.roles.length > MAX_ROLES_PER_VENTURE) {
      problems.push(`INV-26: ${kind} declares ${spec.roles.length} roles, cap is ${MAX_ROLES_PER_VENTURE}`);
    }
    const total = sumBps(spec.roles.map((r) => r.marginalOutputBps));
    if (total !== BPS_ONE) {
      // If marginal outputs did not sum to 10_000, a full fill would not yield
      // `baseYieldMinor` and every published EV band would be wrong by a constant
      // nobody would notice.
      problems.push(`${kind} marginal outputs sum to ${total} bps, not ${BPS_ONE}`);
    }
    if (!isEscrowable(kind) && !isTopYield(kind)) {
      problems.push(`${kind} is un-escrowable but not top-yield; the two must be derived together`);
    }
  }
  const tops = topYieldKinds();
  if (tops.length === 0) {
    // A threshold above every yield silently deletes PROP-V6's third clause and
    // the un-escrowable prize with it, and every test would still pass.
    problems.push(
      `no kind is top-yield at threshold ${TOP_YIELD_THRESHOLD_MINOR}; §7.5's un-escrowable prize would not exist`,
    );
  }
  if (tops.length === VENTURE_KINDS.length) {
    problems.push('every kind is top-yield; a threshold below every yield forces 4 roles on the newcomer loop');
  }
  if (problems.length > 0) {
    throw new KindError(`the venture kind table is inconsistent:\n  - ${problems.join('\n  - ')}`);
  }
}
