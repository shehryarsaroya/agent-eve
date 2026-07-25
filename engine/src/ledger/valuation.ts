/**
 * What a good is worth, for the one purpose that has to be attack-proof: posting
 * goods as a **bond**.
 *
 * SPEC §19 / §6.4: *"Bonds are posted in settlement currency, or in goods at a
 * conservative haircut off a windowed median with related-party edges excluded —
 * never at last-trade, which is launderable."*
 *
 * The attack this file refuses, in full, because it is the exploit critic's
 * highest-value finding (SPEC §10.3):
 *
 *   > A thin book plus last-trade marking is the game's single most dangerous
 *   > exploit: self-match two of your own principals to print a 50× mark, post that
 *   > good as a bond, and the top tier hands you custody of everyone's assets
 *   > secured by 2% of the printed value.
 *
 * Four defences, all of which have to hold together:
 *
 *   1. **A window, not a last trade.** One print cannot move a median over many
 *      ticks of volume.
 *   2. **Volume-weighted median, not a mean.** A mean is moved by one enormous
 *      print; a median is moved only by *volume*, which has to be paid for.
 *   3. **Related-party edges excluded, and self-matches rejected outright.** One
 *      principal may never be both sides, and neither may two with a declared edge.
 *   4. **A floor on independent evidence.** Below it the good is `UNPRICED` and
 *      worth **nothing** as a bond. That is the crucial half: the safe failure mode
 *      is "no bond", not "a bond at the only price I can see". A15 also applies —
 *      the floor is denominated in produced volume and distinct counterparties, and
 *      never in identities, because identities are free.
 *
 * The related-party graph **withholds credit; it never accuses** (A15). Nothing
 * here writes a standing vector, emits an event, or names a suspected Sybil. It
 * declines to price. Scar #8: when the penalty is permanent and public, precision
 * beats recall, and the cheapest way to have perfect precision is to impose no
 * penalty at all.
 */

import type { GoodId, PrincipalId } from '../core/types.js';
import { BPS_ONE, UnitError, bps, minor, qty, type Bps, type Minor, type Qty } from '../core/units.js';
import { compareIds } from './order.js';

/** One fill. The ledger does not clear markets; the market module hands these over. */
export interface Print {
  readonly id: string;
  readonly good: GoodId;
  readonly tick: number;
  /** Per unit, in minor units. Integers only — a float here reaches a bond value. */
  readonly unitPrice: Minor;
  readonly qty: Qty;
  readonly buyer: PrincipalId;
  readonly seller: PrincipalId;
}

/**
 * A declared related-party graph. Undirected, and deliberately *not* inferred from
 * text: there is no natural-language Sybil detector in this design and `AX-A5-3`
 * asserts there never is (scars #7, #8).
 */
export interface RelatedParties {
  areRelated(a: PrincipalId, b: PrincipalId): boolean;
}

export function noRelatedParties(): RelatedParties {
  return { areRelated: () => false };
}

/** An explicit edge set. Symmetric by construction, so order never matters. */
export class RelatedPartyGraph implements RelatedParties {
  private readonly edges = new Set<string>();

  link(a: PrincipalId, b: PrincipalId): void {
    this.edges.add(key(a, b));
  }

  areRelated(a: PrincipalId, b: PrincipalId): boolean {
    return a === b || this.edges.has(key(a, b));
  }
}

function key(a: PrincipalId, b: PrincipalId): string {
  return compareIds(a, b) <= 0 ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * The pinned valuation rule. A venture's `terms_hash` includes this *and* its
 * as-of tick (SPEC §15.4), so a valuation cannot be re-derived under a different
 * rule at settlement and turn an honoured promise into a default.
 */
export interface ValuationRule {
  /** How far back the window reaches. In ticks, never seconds (DET-8). */
  readonly windowTicks: number;
  /** Withheld from the mark. Conservative: a bond is worth less than the mark. */
  readonly haircutBps: Bps;
  /** Minimum independent volume before a good is priceable at all. */
  readonly minIndependentQty: Qty;
  /** Minimum independent fills. Volume alone can come from one enormous print. */
  readonly minIndependentPrints: number;
  /** Distinct independently-capitalised counterparty pairs (§6.4's diversity term). */
  readonly minDistinctPairs: number;
}

/**
 * Starting values, all *(calibrate)*. The window is deliberately several ticks of
 * real trade rather than one: at 288 ticks per Reckoning, 48 ticks is a sixth of a
 * day, long enough that moving the median costs a day of volume.
 */
export const DEFAULT_VALUATION_RULE: ValuationRule = {
  windowTicks: 48,
  haircutBps: bps(3_000),
  minIndependentQty: qty(20),
  minIndependentPrints: 3,
  minDistinctPairs: 2,
};

export type ValuationReason =
  | 'PRICED'
  /** Independent trade exists but not enough of it. Worth nothing as a bond. */
  | 'THIN_BOOK'
  /** Every print in the window was self-matched or between related parties. */
  | 'NO_INDEPENDENT_VOLUME';

export interface Valuation {
  readonly good: GoodId;
  readonly asOfTick: number;
  /** The volume-weighted median unit price over independent prints, or null. */
  readonly markUnitPrice: Minor | null;
  /** The mark less the haircut. What a unit is worth **as a bond**, or null. */
  readonly bondableUnitPrice: Minor | null;
  readonly independentQty: Qty;
  readonly independentPrints: number;
  readonly distinctPairs: number;
  /** How many prints the related-party filter dropped. Published, never accusatory. */
  readonly excludedPrints: number;
  readonly reason: ValuationReason;
  readonly rule: ValuationRule;
}

/**
 * Value one good as of a tick.
 *
 * `asOfTick` is inclusive and the window is `(asOfTick − windowTicks, asOfTick]`.
 * Future prints are ignored: a valuation pinned at signing must not change because
 * time passed, or `terms_hash` stops meaning anything (SPEC §15.4).
 */
export function valueGood(
  good: GoodId,
  asOfTick: number,
  prints: readonly Print[],
  rule: ValuationRule = DEFAULT_VALUATION_RULE,
  related: RelatedParties = noRelatedParties(),
): Valuation {
  if (!Number.isSafeInteger(asOfTick)) throw new UnitError(`asOfTick must be an integer, got ${asOfTick}`);

  const inWindow = prints.filter(
    (p) => p.good === good && p.tick <= asOfTick && p.tick > asOfTick - rule.windowTicks,
  );
  const independent: Print[] = [];
  let excluded = 0;
  for (const p of inWindow) {
    // A self-match is rejected outright, and a related-party edge is the same
    // thing wearing a second keypair (SPEC §10.3, A15).
    if (p.buyer === p.seller || related.areRelated(p.buyer, p.seller)) {
      excluded += 1;
      continue;
    }
    independent.push(p);
  }

  const pairs = new Set<string>();
  let volume = 0;
  for (const p of independent) {
    pairs.add(key(p.buyer, p.seller));
    volume += p.qty;
  }

  const base = {
    good,
    asOfTick,
    independentQty: qty(volume),
    independentPrints: independent.length,
    distinctPairs: pairs.size,
    excludedPrints: excluded,
    rule,
  } as const;

  if (independent.length === 0) {
    return { ...base, markUnitPrice: null, bondableUnitPrice: null, reason: 'NO_INDEPENDENT_VOLUME' };
  }
  if (
    volume < rule.minIndependentQty ||
    independent.length < rule.minIndependentPrints ||
    pairs.size < rule.minDistinctPairs
  ) {
    // Unpriceable, therefore un-bondable. Refusing to price is the safe failure;
    // pricing off the only visible trade is the exploit.
    return { ...base, markUnitPrice: null, bondableUnitPrice: null, reason: 'THIN_BOOK' };
  }

  const mark = volumeWeightedMedian(independent);
  return {
    ...base,
    markUnitPrice: mark,
    bondableUnitPrice: applyHaircut(mark, rule.haircutBps),
    reason: 'PRICED',
  };
}

/**
 * What a quantity of a good is worth as a bond. Zero when unpriced — a bond has to
 * be *capital*, and an unpriceable good is not capital (A15).
 */
export function bondableValue(v: Valuation, amount: Qty): Minor {
  if (v.bondableUnitPrice === null) return minor(0);
  const product = v.bondableUnitPrice * amount;
  if (!Number.isSafeInteger(product)) {
    throw new UnitError(`bondable value overflow: ${v.bondableUnitPrice} * ${amount}`);
  }
  return minor(product);
}

/**
 * The volume-weighted median unit price.
 *
 * Sorted by `(unitPrice, tick, id)` — an explicit comparator, because a bare
 * `.sort()` is implementation-defined ordering and lint bans it (DET-1). The
 * halfway point is found by comparing `2 × cumulative ≥ total`, so no division
 * appears anywhere and no float can enter a value that ends up in `terms_hash`.
 *
 * Lower median on an even split, stated rather than incidental: it is the
 * conservative choice, and a bond valuation should err downward.
 */
export function volumeWeightedMedian(prints: readonly Print[]): Minor {
  if (prints.length === 0) throw new UnitError('cannot take a median of no prints');
  const sorted = [...prints].sort(
    (a, b) => a.unitPrice - b.unitPrice || a.tick - b.tick || compareIds(a.id, b.id),
  );
  let total = 0;
  for (const p of sorted) total += p.qty;

  let cumulative = 0;
  for (const p of sorted) {
    cumulative += p.qty;
    if (2 * cumulative >= total) return p.unitPrice;
  }
  const last = sorted[sorted.length - 1];
  if (last === undefined) throw new UnitError('unreachable: median over a non-empty list');
  return last.unitPrice;
}

/**
 * Withhold the haircut, truncating **toward zero**.
 *
 * Truncation is the conservative direction and that is the whole point: rounding a
 * bond up by one minor unit, every time, across every custody check, is how a
 * margin requirement quietly stops binding.
 */
export function applyHaircut(mark: Minor, haircutBps: Bps): Minor {
  const retained = BPS_ONE - haircutBps;
  const product = mark * retained;
  if (!Number.isSafeInteger(product)) {
    throw new UnitError(`haircut overflow: ${mark} * ${retained} exceeds safe integer range`);
  }
  return minor(Math.trunc(product / BPS_ONE));
}
