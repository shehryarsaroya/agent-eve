/**
 * `RoleTerms` — what a role is owed, and how much of it is guaranteed.
 *
 * ## PROP-V2: `wage` and `share` are never both set, and never both null
 *
 * §7.1 is the most emphatic paragraph in the spec and it is worth restating in
 * full, because this file is the only thing standing between the design and it:
 *
 * > A single `wage_or_share` field would carry two economically opposite things —
 * > a fixed claim senior to outcome, and a residual claim junior to it. That is
 * > scar #1 with money, permanence and an audience: an agent signs believing it
 * > took a wage, the engine recorded a share, the venture underperforms, it
 * > receives nothing, and **the ledger records the promise as honoured.** Every
 * > component correct, mental model inverted, invisible to unit tests.
 *
 * So the fields are separate in `core/types.ts`, and {@link validateRoleTerms}
 * refuses both-set *and* both-null. Both-null is the half that is easy to forget
 * and it is the more dangerous one: a role owed nothing settles silently and the
 * receipt says the promise was kept.
 *
 * ## The two halves of the amount, and the two halves of A7
 *
 * `wage`/`share` says **how much** and **with what seniority**. `escrowed`/
 * `elective` says **how much of it is pre-funded**:
 *
 *   consideration = escrowed + elective     the pinned total, fixed at signing
 *
 * - For a **wage** role the consideration *is* the claim, so
 *   `wage === escrowed + elective` is required. An agent that reads "wage 1000"
 *   and finds `escrowed + elective` adding to 900 has been shown two numbers that
 *   disagree, which is the §7.1 failure with extra steps.
 * - For a **share** role the claim is not known until the venture resolves, so
 *   the consideration is the **pinned estimate** the parties priced the deal at.
 *   It is what `f(kind)`'s floor is measured against and what the creator funds
 *   into escrow. It is deliberately *not* asserted equal to the p50 forecast:
 *   PROP-V3 compares the echoed `your_take_at_p50` against what the waterfall
 *   actually produces, and defining the terms to equal the forecast would make
 *   that comparison a tautology instead of a test.
 *
 * ## PROP-V5: the elective floor
 *
 * `elective >= f(kind)`, rising with venture value, and the top-yield kinds are
 * un-escrowable outright (`escrowed` must be 0). §7.5: "Left elective, agents set
 * it to zero — escrow strictly dominates for the buyer of any promise — and then
 * no trust is ever risked, A7 is dead letter, and standing has nothing to accrue
 * to. The floor is what makes the elective part exist at all."
 */

import { canonicalHash, type CanonicalValue } from '../core/canonical.js';
import type { GoodId, PrincipalId, RoleTerms, SystemId, VentureId, VentureKind } from '../core/types.js';
import { BPS_ONE, addMinor, bps, minor, type Bps, type Minor } from '../core/units.js';
import type { ValuationRule } from '../ledger/index.js';
import { compareIds } from '../ledger/index.js';
import { accept, reject, type WorldResult } from '../world/index.js';
import { electiveFloor, isEscrowable, kindSpec, type RoleLabel } from './kinds.js';

/** `escrowed + elective` — the total the parties pinned at signing. */
export function pinnedConsideration(terms: RoleTerms): Minor {
  return addMinor(terms.escrowed, terms.elective);
}

/**
 * A fixed `wage` is senior to a residual `share`. Expressed as the integer
 * priority band `ledger/waterfall.ts` takes, lower first — one home for the
 * seniority rule, so the ledger and the venture cannot disagree about which claim
 * is paid first.
 */
export const WAGE_PRIORITY = 0;
export const SHARE_PRIORITY = 1;

export function seniorityOf(terms: RoleTerms): number {
  return terms.wage !== null ? WAGE_PRIORITY : SHARE_PRIORITY;
}

export function isWageRole(terms: RoleTerms): boolean {
  return terms.wage !== null;
}

export function isShareRole(terms: RoleTerms): boolean {
  return terms.share !== null;
}

/**
 * The **escrow ratio**, which §7.5 requires on the venture card: "An A7
 * 'explicitly priced unsecured tail' that is not displayed is not priced; it is
 * hidden, which is the parser deceit the economic laws forbid."
 */
export function escrowRatioBps(terms: RoleTerms): Bps {
  const total = pinnedConsideration(terms);
  if (total <= 0) return bps(0);
  // Truncated: a ratio shown one bp high reads as more secured than it is.
  return bps(Math.trunc((terms.escrowed * BPS_ONE) / total));
}

/**
 * Validate one role's terms against `f(kind)`.
 *
 * Returns a {@link WorldResult} rather than throwing: creation is an agent action,
 * and §12.2 requires an illegal action to come back with the violated rule and a
 * hint, never an error (scar #10, and High Water's validated pattern 4 — an agent
 * that gets a 400 wastes its turn and often loops).
 */
export function validateRoleTerms(kind: VentureKind, terms: RoleTerms): WorldResult<RoleTerms> {
  const bothSet = terms.wage !== null && terms.share !== null;
  const neitherSet = terms.wage === null && terms.share === null;
  if (bothSet) {
    return reject(
      'PROP-V2',
      'a role takes a wage OR a share, never both: a wage is a fixed claim senior to the outcome and a ' +
        'share is a residual claim junior to it, and one slot carrying both is how a broken promise gets ' +
        'recorded as honoured. Clear one of them.',
    );
  }
  if (neitherSet) {
    return reject(
      'PROP-V2',
      'a role must take either a wage or a share; a role owed nothing settles silently and the receipt ' +
        'says the promise was kept. Set wage (a fixed amount) or share (bps of the residual).',
    );
  }

  if (terms.escrowed < 0 || terms.elective < 0) {
    return reject(
      'PROP-V2',
      `escrowed and elective are amounts, never debts: got escrowed ${terms.escrowed}, elective ${terms.elective}.`,
    );
  }

  const total = pinnedConsideration(terms);
  if (total <= 0) {
    return reject(
      'PROP-V5',
      'escrowed + elective is what the parties priced this role at and it must be positive; a role priced ' +
        'at zero risks nothing and earns no standing.',
    );
  }

  if (terms.wage !== null) {
    if (terms.wage <= 0) {
      return reject('PROP-V2', `a wage must be positive, got ${terms.wage}.`);
    }
    if (terms.wage !== total) {
      return reject(
        'PROP-V2',
        `a wage role's wage must equal escrowed + elective: wage ${terms.wage} against ` +
          `${terms.escrowed} + ${terms.elective} = ${total}. Two numbers that disagree is the field ` +
          'split in §7.1 defeating itself.',
      );
    }
  }

  if (terms.share !== null) {
    if (terms.share <= 0) {
      return reject('PROP-V2', `a share must be positive bps, got ${terms.share}.`);
    }
    if (terms.share > BPS_ONE) {
      return reject('PROP-V2', `a share cannot exceed ${BPS_ONE} bps (100%), got ${terms.share}.`);
    }
  }

  if (!isEscrowable(kind) && terms.escrowed !== 0) {
    return reject(
      'PROP-V5',
      `${kind} is a top-yield kind and is legally un-escrowable, so escrowed must be 0 and the whole ` +
        `${total} stays elective. Escrow strictly dominates for the buyer of a promise, so if the highest ` +
        'prizes could be escrowed nobody would ever risk trust and there would be nothing for standing to ' +
        'accrue to.',
    );
  }

  const floor = electiveFloor(kind, total);
  if (terms.elective < floor) {
    return reject(
      'PROP-V5',
      `${kind} requires elective >= ${floor} on a role priced at ${total} (f(kind) is ` +
        `${kindSpec(kind).electiveFloorBps} bps of value, floor ${kindSpec(kind).electiveFloorMinor}); ` +
        `got ${terms.elective}. The elective part is the only part standing can accrue to.`,
    );
  }

  return accept(terms);
}

// ── terms_hash ───────────────────────────────────────────────────────────────

/**
 * The valuation basis pinned into `terms_hash`.
 *
 * SPEC §15.4 lists this among the five defences against the false-default
 * problem: "`terms_hash` includes the valuation rule **and** its as-of tick".
 * Both halves are load-bearing and E2E-14 is the scenario — valuation moves
 * sharply between agreement and settlement, and the settlement must match what
 * the parties agreed rather than the new price. Pinning the rule without the tick
 * still lets the rule be re-evaluated against a later window; pinning the tick
 * without the rule still lets the haircut or the window width change underneath
 * it. Neither alone is enough, so neither is optional here.
 */
export interface PinnedValuation {
  readonly rule: ValuationRule;
  /** The tick the marks were taken at. Inclusive; see `valueGood`. */
  readonly asOfTick: number;
  /** The marks themselves, so the arithmetic is reproducible from the hash alone. */
  readonly marks: readonly { readonly good: GoodId; readonly unitPrice: Minor }[];
}

export interface TermsHashInput {
  readonly venture: VentureId;
  readonly kind: VentureKind;
  readonly creator: PrincipalId;
  readonly stage: SystemId;
  readonly roles: readonly {
    readonly index: number;
    readonly label: RoleLabel;
    readonly terms: RoleTerms;
  }[];
  readonly windowOpensTick: number;
  readonly windowClosesTick: number;
  readonly resolvesAtTick: number;
  readonly valuation: PinnedValuation;
  /**
   * INV-15: an accepted obligation pins the version it quoted, and it is never
   * rewritten — or a later balance patch retroactively edits history.
   */
  readonly rulesVersion: number;
}

/**
 * The canonical structure `terms_hash` is taken over.
 *
 * Built as an explicit object rather than by spreading the venture record, so a
 * field added to the record cannot silently join or leave the hash. A `terms_hash`
 * that changes when an unrelated field is added makes every live compact
 * un-settleable; one that *stops* covering a field lets that field be edited after
 * signing. Both are the A5' failure — the engine fabricating a betrayal — which
 * `core/canonical.ts` names as strictly worse than a crash.
 */
export function termsCanonical(input: TermsHashInput): CanonicalValue {
  return {
    v: 1,
    venture: input.venture,
    kind: input.kind,
    creator: input.creator,
    stage: input.stage,
    rulesVersion: input.rulesVersion,
    window: {
      opensTick: input.windowOpensTick,
      closesTick: input.windowClosesTick,
      resolvesAtTick: input.resolvesAtTick,
    },
    roles: [...input.roles]
      .sort((a, b) => a.index - b.index)
      .map((r) => ({
        index: r.index,
        label: r.label,
        // `null` written explicitly: absent and null are different to the
        // canonicaliser, and which one appears must not depend on whether a
        // field happened to be set.
        wage: r.terms.wage,
        share: r.terms.share,
        escrowed: r.terms.escrowed,
        elective: r.terms.elective,
      })),
    valuation: {
      asOfTick: input.valuation.asOfTick,
      rule: {
        windowTicks: input.valuation.rule.windowTicks,
        haircutBps: input.valuation.rule.haircutBps,
        minIndependentQty: input.valuation.rule.minIndependentQty,
        minIndependentPrints: input.valuation.rule.minIndependentPrints,
        minDistinctPairs: input.valuation.rule.minDistinctPairs,
      },
      marks: [...input.valuation.marks]
        .sort((a, b) => compareIds(a.good, b.good))
        .map((m) => ({ good: m.good, unitPrice: m.unitPrice })),
    },
  };
}

/**
 * `terms_hash` — what two principals countersign.
 *
 * Key-order independence comes from `canonicalize` (PROP-W1) and is asserted
 * there and again in this module's tests, because the failure mode is not a crash:
 * agents see a hash mismatch and correctly read it as *the counterparty reneging*.
 */
export function termsHash(input: TermsHashInput): string {
  return canonicalHash(termsCanonical(input));
}

/** A zero-mark valuation basis, for a venture whose settlement prices nothing. */
export function pinnedAt(rule: ValuationRule, asOfTick: number): PinnedValuation {
  return { rule, asOfTick, marks: [] };
}

/** Convenience constructor that keeps the four fields in one place at call sites. */
export function roleTerms(args: {
  readonly wage?: Minor | null;
  readonly share?: Bps | null;
  readonly escrowed: Minor;
  readonly elective: Minor;
}): RoleTerms {
  return {
    wage: args.wage ?? null,
    share: args.share ?? null,
    escrowed: args.escrowed,
    elective: args.elective,
  };
}

/** A wage role, with the `wage === escrowed + elective` identity held for you. */
export function wageTerms(escrowed: Minor, elective: Minor): RoleTerms {
  return { wage: addMinor(escrowed, elective), share: null, escrowed, elective };
}

/** A share role priced at `escrowed + elective`. */
export function shareTerms(share: Bps, escrowed: Minor, elective: Minor): RoleTerms {
  return { wage: null, share, escrowed, elective };
}

/** Terms with no escrowed half at all — the fully-elective shape a top kind needs. */
export function fullyElectiveShare(share: Bps, elective: Minor): RoleTerms {
  return shareTerms(share, minor(0), elective);
}
