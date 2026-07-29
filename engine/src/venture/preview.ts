/**
 * The consequence preview: `your_take_at_p50` and `projected_settlement`.
 *
 * High Water's fourth meta-lesson, promoted to a design pattern: *"cheap
 * consequence-preview fields prevent whole bug classes. `projectedDrown` (what
 * happens if resolution occurred now) let agents self-correct and made the mechanic
 * legible to spectators in the same move."*
 *
 * §7.1 makes it a rule twice over — the signing party must **echo a server-computed
 * `your_take_at_p50`**, "a confirmation of *understanding*, not just of terms", and
 * "every live venture exposes `projected_settlement` to its parties and to the
 * spectator". PROP-V3 then puts the preview itself under test, because a preview
 * that is *nearly* right is scar #1 with a reassuring number attached.
 *
 * ## Why the quote assumes a full fill
 *
 * `your_take_at_p50` is quoted against **every role filled**, not against whoever
 * has joined so far. Three reasons, and the third is the one that matters:
 *
 *  1. It is the deal as described. A venture goes `LIVE` only when it is fully
 *     filled (`activate`), so a full fill is the only state it can settle in.
 *  2. It is stable through the formation window, so an echo does not go stale every
 *     time a counterparty joins and force a re-sign.
 *  3. It is the *unfavourable* direction to be wrong in for the signer of a share:
 *     more filled roles means more marginal output but also more claimants, and
 *     quoting the fullest version means a partially-filled venture cannot pay a
 *     share role *less* than it was quoted while the engine calls the quote met.
 *
 * ## Why this shares `computeClaims` with settlement
 *
 * Because §7.1's failure *is* two implementations of one number. There is one
 * function that answers "what is this role owed", and both the quote and the payout
 * read it. What PROP-V3 then tests is the part that can still break: that a real
 * settlement, against a real ledger, with real transfers, pays the claim the quote
 * named.
 */

import type { PrincipalId, VentureId } from '../core/types.js';
import { BPS_ONE, bps, minor, type Bps, type Minor } from '../core/units.js';
import { compareIds } from '../ledger/index.js';
import { kindSpec, type RoleLabel } from './kinds.js';
import {
  NEUTRAL_STAGE_BPS,
  computeProceeds,
  proceedsBand,
  residualAtPercentile,
  type Bottleneck,
  type Percentile,
  type ProceedsBand,
} from './proceeds.js';
import { escrowRatioBps } from './terms.js';
import {
  filledIndices,
  isFullyFilled,
  pinnedValue,
  roleOfPrincipal,
  type VentureRecord,
} from './venture.js';
import { computeClaims, type ResolutionKind } from './settlement.js';

/** What one party is quoted, and how much of it is actually guaranteed. */
export interface TakeForecast {
  readonly venture: VentureId;
  readonly principal: PrincipalId;
  readonly roleIndex: number;
  readonly label: RoleLabel;
  readonly percentile: Percentile;
  /** The number echoed at signing. Compared byte-for-byte against the server's. */
  readonly take: Minor;
  /** The part that auto-executes from escrow (A7's escrowed half). */
  readonly escrowedPart: Minor;
  /** The part that stays elective — what the counterparty may simply not pay. */
  readonly electivePart: Minor;
  /** `escrowed / (escrowed + elective)`, published on the card per §7.5. */
  readonly escrowRatioBps: Bps;
  /** True when the role takes a fixed wage rather than a residual share. */
  readonly isWage: boolean;
}

/** Every role index — the full-fill assumption, in one place. */
export function allRoleIndices(venture: VentureRecord): readonly number[] {
  return venture.roles.map((r) => r.index);
}

/**
 * What `principal` takes at `percentile`, quoted against a full fill.
 *
 * Returns null when the principal holds no role — the creator's residual is not a
 * take, it is what is left, and calling it a take would put two concepts on one
 * word (§3).
 */
export function takeAtPercentile(
  venture: VentureRecord,
  principal: PrincipalId,
  percentile: Percentile,
  stageBps: Bps = NEUTRAL_STAGE_BPS,
): TakeForecast | null {
  const role = roleOfPrincipal(venture, principal);
  if (role === null) return null;

  const filled = allRoleIndices(venture);
  const proceeds = computeProceeds({
    kind: venture.kind,
    filled,
    stageBps,
    residualSignedBps: residualAtPercentile(venture.kind, percentile),
  }).proceeds;

  const claims = computeClaims(venture, proceeds, filled);
  const mine = claims.roles.find((r) => r.roleIndex === role.index);
  if (mine === undefined) return null;

  return {
    venture: venture.id,
    principal,
    roleIndex: role.index,
    label: role.label,
    percentile,
    take: mine.claim,
    escrowedPart: mine.escrowedDue,
    electivePart: mine.electiveDue,
    escrowRatioBps: escrowRatioBps(role.terms),
    isWage: role.terms.wage !== null,
  };
}

/**
 * **`your_take_at_p50`** — the number §7.1 requires a signer to echo.
 *
 * Zero when the principal holds no role, which is a legal echo for a creator that
 * filled none of its own roles: it takes the residual, not a take.
 */
export function yourTakeAtP50(
  venture: VentureRecord,
  principal: PrincipalId,
  stageBps: Bps = NEUTRAL_STAGE_BPS,
): Minor {
  return takeAtPercentile(venture, principal, 'p50', stageBps)?.take ?? minor(0);
}

// ══════════════════════════════════════════════════════════════════════════════
// ★ THE WORST CASE, WHICH IS THE ONLY NUMBER A LIMIT MAY BE MEASURED AGAINST (A7)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * The **most** one role's elective part can ever come to — exact, not a forecast.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **A LIMIT THAT BINDS TO THE p50 OF A DISTRIBUTION IS NOT A LIMIT.**
 *
 * A blind probe held a grant with `max_contingent_liability: 30000`, had its delegate create a
 * HAUL (value 8000, `elective_bps` 2500), and watched the engine **charge the grant 2,000** — Σ
 * `role.terms.elective`, the pinned figure. The server then told the grantor its actual ceiling in
 * the same observation: role 0 *"up to 5460"*, role 1 *"up to 2340"*, and `if_you_do_nothing`:
 * *"your elective **7800** is NOT paid — … a default on the record."* Drawn against the limit:
 * 2,000. Payable: **7,800**. Per-kind the multiplier was HAUL 3.9× and BUILD 3.93×, and it is
 * unbounded in principle because the two numbers are **independent**: the pinned figure scales with
 * the `value` the *delegate* chooses, while the amount actually asked for is
 * `claim - min(claim, escrowed)` where the claim is a share of proceeds — and proceeds come from the
 * KIND's `baseYieldMinor`, which no parameter of `create` touches.
 *
 * `agent.md` §10 tells a grantor the LIMITS *"are the whole of it"* and the refusal asserted the
 * tail is *"capped by the second LIMIT the grantor was shown before it signed"*. Both were false.
 * That is scar #1 with money on it.
 *
 * ── WHY THIS IS THE FIX RATHER THAN A NARROWER PROMISE ───────────────────────
 *
 * Because the engine **already** charges the worst case for the same obligation one verb away.
 * `elect`'s `IN_FULL` branch draws `Runtime.electiveCeilingOf`, whose own docstring says the pinned
 * `role.terms.elective` *may not* stand in for it: *"on a share role the due is `claim -
 * escrowedDue` … so a venture that over-performs owes MORE than the pinned figure — §7.1's trap, in
 * the one field the document says to trust."* So the codebase had already decided; `create` had not
 * been told. Narrowing the text instead would have meant writing, on the most-read surface in the
 * game, that the number bounding a grantor's downside bounds the median case — which no grantor
 * would read as a bound.
 *
 * ── WHY THIS IS EXACT AND NOT PROBABILISTIC ──────────────────────────────────
 *
 * The residual is a seeded draw inside a band the kind publishes, so `residualAtPercentile('p90')`
 * is the band's **top end** rather than a quantile, and proceeds are monotone in it. Quoted at a
 * **full fill** because a venture reaches `LIVE` only fully filled and only a `LIVE` venture
 * settles, and because claims are monotone in the filled set (a role's claim is proportional to
 * `Σ filled shares × its own share`, so every unfilled role lowers it). Both bounds therefore hold
 * with equality in the case that actually occurs, not merely in expectation.
 *
 * `stageBps` defaults to {@link NEUTRAL_STAGE_BPS}, which is what every caller in the engine passes
 * today. **If a stage condition above neutral is ever introduced, this bound moves with it** — the
 * argument is a bound on proceeds, and a multiplier above 1 raises proceeds.
 * ══════════════════════════════════════════════════════════════════════════
 */
export function electiveCeilingOfRole(
  venture: VentureRecord,
  roleIndex: number,
  stageBps: Bps = NEUTRAL_STAGE_BPS,
): Minor {
  const filled = allRoleIndices(venture);
  const proceeds = computeProceeds({
    kind: venture.kind,
    filled,
    stageBps,
    residualSignedBps: residualAtPercentile(venture.kind, 'p90'),
  }).proceeds;
  const claims = computeClaims(venture, proceeds, filled);
  return claims.roles.find((r) => r.roleIndex === roleIndex)?.electiveDue ?? minor(0);
}

/**
 * ★ **Σ over every role of {@link electiveCeilingOfRole}** — the most the creator of this venture
 * can ever be asked for on the elective half, and therefore the figure a delegated `create` charges
 * against `max_contingent_liability` (SPEC §8.1 #2, A7).
 *
 * Σ over **every** role rather than the filled ones, for {@link electiveTotal}'s reason: at creation
 * no role is filled, so the worst case is that every one of them goes to a stranger and the creator
 * owes all of it. A figure that assumed the creator would take a slot itself would be a forecast
 * dressed as a bound.
 *
 * `electiveTotal` still exists and is still the **pinned** figure — what the parties priced the
 * unsecured half at, which is the right number for the card, the docket's `atStake`, and the
 * escrow/elective partition of `pinnedValue`. One word per concept: that is the PRICE, this is the
 * BOUND, and the whole defect was one standing in for the other.
 */
export function maxElectiveLiability(
  venture: VentureRecord,
  stageBps: Bps = NEUTRAL_STAGE_BPS,
): Minor {
  const filled = allRoleIndices(venture);
  const proceeds = computeProceeds({
    kind: venture.kind,
    filled,
    stageBps,
    residualSignedBps: residualAtPercentile(venture.kind, 'p90'),
  }).proceeds;
  const claims = computeClaims(venture, proceeds, filled);
  let total = minor(0);
  for (const role of claims.roles) total = minor(total + role.electiveDue);
  return total;
}

/**
 * **`projected_settlement`** — "if this resolved now, you receive X, they receive Y"
 * (§7), for every live venture and for the spectator card.
 *
 * Quoted against the roles **filled right now**, unlike `your_take_at_p50`: this
 * answers "what happens if resolution occurred now", so it must show the venture as
 * it actually stands, bottleneck included. The two use different fill sets on
 * purpose, and each says which in its own field.
 */
export interface ProjectedSettlement {
  readonly venture: VentureId;
  readonly atTick: number;
  /** What resolving now would be called. `PARTIAL_FILL` while a role is open. */
  readonly outcomeIfNow: ResolutionKind;
  readonly proceeds: ProceedsBand;
  /** One entry per *filled* role, in role-index order. Capped by the role cap. */
  readonly parties: readonly ProjectedParty[];
  /** What the creator keeps at p50 after every claim. */
  readonly creatorResidualAtP50: Minor;
  /** The open role that costs the most, or null at a full fill (§7.4). */
  readonly bottleneck: Bottleneck | null;
  /** Σ escrowed / Σ (escrowed + elective) across the venture (§7.5's card figure). */
  readonly escrowRatioBps: Bps;
  /** Σ elective at p50 — the value riding on trust rather than on escrow. */
  readonly atRiskAtP50: Minor;
  readonly resolvesAtTick: number;
}

export interface ProjectedParty {
  readonly principal: PrincipalId;
  readonly roleIndex: number;
  readonly label: RoleLabel;
  readonly isWage: boolean;
  readonly p10: Minor;
  readonly p50: Minor;
  readonly p90: Minor;
  readonly escrowedAtP50: Minor;
  readonly electiveAtP50: Minor;
}

export function projectedSettlement(
  venture: VentureRecord,
  atTick: number,
  stageBps: Bps = NEUTRAL_STAGE_BPS,
): ProjectedSettlement {
  const filled = filledIndices(venture);
  const band = proceedsBand(venture.kind, filled, stageBps);
  const at = (percentile: Percentile): ReturnType<typeof computeClaims> =>
    computeClaims(
      venture,
      computeProceeds({
        kind: venture.kind,
        filled,
        stageBps,
        residualSignedBps: residualAtPercentile(venture.kind, percentile),
      }).proceeds,
      filled,
    );

  const p10 = at('p10');
  const p50 = at('p50');
  const p90 = at('p90');
  const claimOf = (breakdown: ReturnType<typeof computeClaims>, index: number): Minor =>
    breakdown.roles.find((r) => r.roleIndex === index)?.claim ?? minor(0);

  const parties: ProjectedParty[] = [];
  let atRisk = 0;
  for (const role of venture.roles) {
    if (role.filledByPrincipal === null) continue;
    const mine50 = p50.roles.find((r) => r.roleIndex === role.index);
    parties.push({
      principal: role.filledByPrincipal,
      roleIndex: role.index,
      label: role.label,
      isWage: role.terms.wage !== null,
      p10: claimOf(p10, role.index),
      p50: claimOf(p50, role.index),
      p90: claimOf(p90, role.index),
      escrowedAtP50: mine50?.escrowedDue ?? minor(0),
      electiveAtP50: mine50?.electiveDue ?? minor(0),
    });
    atRisk += mine50?.electiveDue ?? 0;
  }

  const proceedsNow = computeProceeds({
    kind: venture.kind,
    filled,
    stageBps,
    residualSignedBps: 0,
  });

  return {
    venture: venture.id,
    atTick,
    outcomeIfNow: isFullyFilled(venture) ? 'FULFILLED' : 'PARTIAL_FILL',
    proceeds: band,
    // Role-index order, so a card renders the same way twice and DET-1 has nothing
    // to complain about (`compareIds` on the label would reorder on a rename).
    parties: parties.sort((a, b) => a.roleIndex - b.roleIndex),
    creatorResidualAtP50: p50.creatorPart,
    bottleneck: proceedsNow.bottleneck,
    escrowRatioBps: ventureEscrowRatioBps(venture),
    atRiskAtP50: minor(atRisk),
    resolvesAtTick: venture.resolvesAtTick,
  };
}

/**
 * The venture-level escrow ratio §7.5 requires on the card: "An A7 'explicitly
 * priced unsecured tail' that is not displayed is not priced; it is hidden, which is
 * the parser deceit the economic laws forbid."
 */
export function ventureEscrowRatioBps(venture: VentureRecord): Bps {
  const total = pinnedValue(venture);
  if (total <= 0) return bps(0);
  let escrowed = 0;
  for (const role of venture.roles) escrowed += role.terms.escrowed;
  return bps(Math.trunc((escrowed * BPS_ONE) / total));
}

/**
 * §7.3's `reference_split` — "the deterministic contribution-accounting division, an
 * *anchor, never a recommendation*".
 *
 * Contribution accounting means exactly one thing here and it is already in the kind
 * table: a role's marginal output. So the reference is each role's
 * `marginalOutputBps`, unaltered, and the readable signal §7.3 wants — *"Vale took
 * eight points under reference to get that escort"* — is the difference between this
 * and the terms actually signed.
 *
 * Deliberately **not** weighted by stake, capital, standing or tenure. Any of those
 * would make the anchor a statement about who deserves more, and an anchor that
 * takes a side is a recommendation.
 */
export interface ReferenceShare {
  readonly roleIndex: number;
  readonly label: RoleLabel;
  /** The kind's marginal output for this role. The anchor. */
  readonly referenceBps: Bps;
  /** What was actually agreed, or null for a wage role. */
  readonly agreedBps: Bps | null;
  /**
   * `agreed - reference`, positive when the role took more than the anchor.
   * Null for a wage role: a fixed claim is not a point off a share, and
   * subtracting the two would put two units on one number.
   */
  readonly deviationBps: number | null;
}

export function referenceSplit(venture: VentureRecord): readonly ReferenceShare[] {
  const spec = kindSpec(venture.kind);
  return venture.roles.map((role) => {
    // Read from the **kind table**, never from the role row: the reference is a
    // property of the kind, and reading it off the negotiated terms would make the
    // anchor agree with whatever was signed and say nothing at all.
    const reference = spec.roles[role.index]?.marginalOutputBps ?? bps(0);
    const agreed = role.terms.share;
    return {
      roleIndex: role.index,
      label: role.label,
      referenceBps: reference,
      agreedBps: agreed,
      deviationBps: agreed === null ? null : agreed - reference,
    };
  });
}

/** Ventures a principal is quoted on, in id order. For the observation's `ventures`. */
export function forecastsFor(
  ventures: readonly VentureRecord[],
  principal: PrincipalId,
  percentile: Percentile = 'p50',
): readonly TakeForecast[] {
  const out: TakeForecast[] = [];
  for (const venture of [...ventures].sort((a, b) => compareIds(a.id, b.id))) {
    const forecast = takeAtPercentile(venture, principal, percentile);
    if (forecast !== null) out.push(forecast);
  }
  return out;
}
