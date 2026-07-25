/**
 * PROP-L4 — haircut valuation uses a windowed median with related-party edges
 * excluded, never last-trade. Feed it a laundered thin book and assert the bond
 * value does not move.
 *
 * The attack, from SPEC §10.3, is the exploit critic's highest-value finding:
 *
 *   > Self-match two of your own principals to print a 50× mark, post that good as a
 *   > bond, and the top tier hands you custody of everyone's assets secured by 2% of
 *   > the printed value.
 *
 * So the assertions come in two flavours, and both matter:
 *
 *   - With an honest book present, laundered prints must not move the mark **at
 *     all** — not by one minor unit.
 *   - With *no* honest book, the good must come back `UNPRICED` and worth **zero**
 *     as a bond. Refusing to price is the safe failure; pricing off the only visible
 *     trade is the exploit wearing a different hat.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bps, minor, qty } from '../../src/core/units.js';
import type { GoodId, PrincipalId } from '../../src/core/types.js';
import {
  DEFAULT_VALUATION_RULE,
  RelatedPartyGraph,
  applyHaircut,
  bondableValue,
  noRelatedParties,
  valueGood,
  volumeWeightedMedian,
  type Print,
  type ValuationRule,
} from '../../src/ledger/index.js';

const ORE = 'ore' as GoodId;
const HONEST: readonly PrincipalId[] = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as PrincipalId[];
const SYBIL_A = 'shell-a' as PrincipalId;
const SYBIL_B = 'shell-b' as PrincipalId;

/** A believable honest book: ten fills between distinct parties around 100/unit. */
function honestBook(): Print[] {
  const prices = [98, 99, 100, 100, 101, 102, 100, 99, 101, 100];
  return prices.map((price, i) => ({
    id: `honest-${i}`,
    good: ORE,
    tick: 100 + i,
    unitPrice: minor(price),
    qty: qty(10),
    buyer: HONEST[i % HONEST.length] ?? HONEST[0]!,
    seller: HONEST[(i + 3) % HONEST.length] ?? HONEST[1]!,
  }));
}

/** The launder: prints at 50x between two shells the attacker controls. */
function launderedPrints(count: number, price: number, volume: number, tick = 108): Print[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `wash-${i}`,
    good: ORE,
    tick,
    unitPrice: minor(price),
    qty: qty(volume),
    buyer: SYBIL_A,
    seller: SYBIL_B,
  }));
}

describe('PROP-L4 the mark is a windowed median, not a last trade', () => {
  it('does not move when a related pair prints 50x, at any volume', () => {
    const related = new RelatedPartyGraph();
    related.link(SYBIL_A, SYBIL_B);

    const clean = valueGood(ORE, 110, honestBook(), DEFAULT_VALUATION_RULE, related);
    expect(clean.reason).toBe('PRICED');
    expect(clean.markUnitPrice).toBe(100);

    // 40 prints at 5,000/unit and 500 units each: 100x the honest volume, at 50x
    // the honest price, and the very last trades in the window.
    const laundered = valueGood(
      ORE,
      110,
      [...honestBook(), ...launderedPrints(40, 5_000, 500, 109)],
      DEFAULT_VALUATION_RULE,
      related,
    );
    expect(laundered.markUnitPrice).toBe(clean.markUnitPrice);
    expect(laundered.bondableUnitPrice).toBe(clean.bondableUnitPrice);
    expect(laundered.excludedPrints).toBe(40);
    expect(laundered.independentQty).toBe(clean.independentQty);
  });

  it('rejects a self-match outright — one principal is never both sides', () => {
    const self: Print[] = [
      {
        id: 'self-1',
        good: ORE,
        tick: 109,
        unitPrice: minor(5_000),
        qty: qty(1_000),
        buyer: SYBIL_A,
        seller: SYBIL_A,
      },
    ];
    const clean = valueGood(ORE, 110, honestBook());
    const attacked = valueGood(ORE, 110, [...honestBook(), ...self]);
    expect(attacked.markUnitPrice).toBe(clean.markUnitPrice);
    expect(attacked.excludedPrints).toBe(1);
  });

  it('returns UNPRICED, worth zero as a bond, when the only volume is laundered', () => {
    const related = new RelatedPartyGraph();
    related.link(SYBIL_A, SYBIL_B);
    const v = valueGood(ORE, 110, launderedPrints(30, 5_000, 1_000, 109), DEFAULT_VALUATION_RULE, related);
    expect(v.reason).toBe('NO_INDEPENDENT_VOLUME');
    expect(v.markUnitPrice).toBeNull();
    // The whole exploit chain dies here: no mark, so no bond, so no custody.
    expect(bondableValue(v, qty(1_000))).toBe(0);
  });

  it('returns THIN_BOOK when independent trade exists but there is not enough of it', () => {
    const thin: Print[] = [
      {
        id: 'thin-1',
        good: ORE,
        tick: 109,
        unitPrice: minor(5_000),
        qty: qty(2),
        buyer: HONEST[0]!,
        seller: HONEST[1]!,
      },
    ];
    const v = valueGood(ORE, 110, thin);
    expect(v.reason).toBe('THIN_BOOK');
    expect(v.markUnitPrice).toBeNull();
    expect(bondableValue(v, qty(2))).toBe(0);
  });

  it('needs distinct counterparties, not just volume, before it will price', () => {
    // One pair trading with itself repeatedly clears the volume and print floors and
    // still fails: the diversity term is what makes the gate cost independent
    // capital rather than repetition (§6.4, A15).
    const pairOnly: Print[] = Array.from({ length: 8 }, (_, i) => ({
      id: `pair-${i}`,
      good: ORE,
      tick: 100 + i,
      unitPrice: minor(4_000),
      qty: qty(50),
      buyer: HONEST[0]!,
      seller: HONEST[1]!,
    }));
    const v = valueGood(ORE, 110, pairOnly);
    expect(v.reason).toBe('THIN_BOOK');
    expect(v.distinctPairs).toBe(1);
  });

  it('ignores trades outside the window, in both directions', () => {
    const stale: Print[] = [
      {
        id: 'ancient',
        good: ORE,
        tick: 1,
        unitPrice: minor(9_000),
        qty: qty(10_000),
        buyer: HONEST[0]!,
        seller: HONEST[1]!,
      },
    ];
    const future: Print[] = [
      {
        id: 'later',
        good: ORE,
        tick: 200,
        unitPrice: minor(9_000),
        qty: qty(10_000),
        buyer: HONEST[0]!,
        seller: HONEST[1]!,
      },
    ];
    const clean = valueGood(ORE, 110, honestBook());
    expect(valueGood(ORE, 110, [...honestBook(), ...stale]).markUnitPrice).toBe(clean.markUnitPrice);
    // Pinning matters: a valuation quoted at signing must not change because time
    // passed, or `terms_hash` stops meaning anything (SPEC §15.4).
    expect(valueGood(ORE, 110, [...honestBook(), ...future]).markUnitPrice).toBe(clean.markUnitPrice);
  });

  it('ignores prints for other goods', () => {
    const other: Print[] = [
      {
        id: 'other',
        good: 'rations' as GoodId,
        tick: 109,
        unitPrice: minor(9_999),
        qty: qty(500),
        buyer: HONEST[0]!,
        seller: HONEST[1]!,
      },
    ];
    expect(valueGood(ORE, 110, [...honestBook(), ...other]).markUnitPrice).toBe(100);
  });

  it('PROP: laundered prints never move the mark, for arbitrary price and volume', () => {
    const related = new RelatedPartyGraph();
    related.link(SYBIL_A, SYBIL_B);
    const clean = valueGood(ORE, 110, honestBook(), DEFAULT_VALUATION_RULE, related);

    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            price: fc.integer({ min: 1, max: 10_000_000 }),
            volume: fc.integer({ min: 1, max: 100_000 }),
            tick: fc.integer({ min: 63, max: 110 }),
            flip: fc.boolean(),
          }),
          { maxLength: 30 },
        ),
        (washes) => {
          const wash: Print[] = washes.map((w, i) => ({
            id: `w${i}`,
            good: ORE,
            tick: w.tick,
            unitPrice: minor(w.price),
            qty: qty(w.volume),
            // Either direction, and self-matches too: both are excluded.
            buyer: w.flip ? SYBIL_B : SYBIL_A,
            seller: w.flip ? SYBIL_A : SYBIL_B,
          }));
          const v = valueGood(ORE, 110, [...honestBook(), ...wash], DEFAULT_VALUATION_RULE, related);
          return (
            v.markUnitPrice === clean.markUnitPrice &&
            v.bondableUnitPrice === clean.bondableUnitPrice &&
            v.excludedPrints === wash.length
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('the median and the haircut', () => {
  it('is volume-weighted, so one large print does not set the price a mean would', () => {
    const book: Print[] = [
      { id: 'a', good: ORE, tick: 1, unitPrice: minor(100), qty: qty(100), buyer: HONEST[0]!, seller: HONEST[1]! },
      { id: 'b', good: ORE, tick: 2, unitPrice: minor(101), qty: qty(100), buyer: HONEST[2]!, seller: HONEST[3]! },
      // One tiny print at an absurd price. A mean would be dragged to ~5,075; the
      // median moves by a single minor unit, because a median is moved only by
      // volume and volume has to be paid for.
      { id: 'c', good: ORE, tick: 3, unitPrice: minor(1_000_000), qty: qty(1), buyer: HONEST[4]!, seller: HONEST[5]! },
    ];
    expect(volumeWeightedMedian(book)).toBe(101);
    const mean = book.reduce((a, p) => a + p.unitPrice * p.qty, 0) / 201;
    expect(mean).toBeGreaterThan(5_000);
  });

  it('takes the lower median on an even split — the conservative direction', () => {
    const book: Print[] = [
      { id: 'a', good: ORE, tick: 1, unitPrice: minor(100), qty: qty(50), buyer: HONEST[0]!, seller: HONEST[1]! },
      { id: 'b', good: ORE, tick: 2, unitPrice: minor(200), qty: qty(50), buyer: HONEST[2]!, seller: HONEST[3]! },
    ];
    expect(volumeWeightedMedian(book)).toBe(100);
  });

  it('withholds the haircut, truncating toward zero so a bond is never rounded up', () => {
    // 30% haircut on 100 is 70. On 101 it is 70.7, which truncates to 70 — never 71.
    expect(applyHaircut(minor(100), bps(3_000))).toBe(70);
    expect(applyHaircut(minor(101), bps(3_000))).toBe(70);
    expect(applyHaircut(minor(1), bps(9_999))).toBe(0);
    expect(applyHaircut(minor(500), bps(0))).toBe(500);
  });

  it('PROP: the bondable price is never above the mark, at any haircut', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        (mark, haircut) => {
          const out = applyHaircut(minor(mark), bps(haircut));
          return out <= mark && out >= 0;
        },
      ),
      { numRuns: 500 },
    );
  });

  it('scales a bond by quantity and refuses to value an unpriced good', () => {
    const v = valueGood(ORE, 110, honestBook());
    expect(v.bondableUnitPrice).toBe(70);
    expect(bondableValue(v, qty(300))).toBe(21_000);
    const unpriced = valueGood(ORE, 110, []);
    expect(bondableValue(unpriced, qty(300))).toBe(0);
  });

  it('honours a pinned rule rather than a global default', () => {
    // The rule is pinned in `terms_hash` alongside its as-of tick (SPEC §15.4), so a
    // valuation cannot be re-derived under a friendlier rule at settlement.
    const strict: ValuationRule = { ...DEFAULT_VALUATION_RULE, haircutBps: bps(5_000) };
    const v = valueGood(ORE, 110, honestBook(), strict);
    expect(v.rule.haircutBps).toBe(5_000);
    expect(v.markUnitPrice).toBe(100);
    expect(v.bondableUnitPrice).toBe(50);
  });

  it('a stricter diversity requirement makes the same book unpriceable', () => {
    // The honest book has 3 distinct pairs. Demanding 5 refuses to price it, which is
    // the whole design of the floor: it declines credit, it never accuses (A15).
    const paranoid: ValuationRule = { ...DEFAULT_VALUATION_RULE, minDistinctPairs: 5 };
    const v = valueGood(ORE, 110, honestBook(), paranoid);
    expect(v.distinctPairs).toBe(3);
    expect(v.reason).toBe('THIN_BOOK');
    expect(bondableValue(v, qty(100))).toBe(0);
  });

  it('the empty graph relates nothing but a principal to itself', () => {
    expect(noRelatedParties().areRelated(SYBIL_A, SYBIL_B)).toBe(false);
    const g = new RelatedPartyGraph();
    expect(g.areRelated(SYBIL_A, SYBIL_A)).toBe(true);
    g.link(SYBIL_B, SYBIL_A);
    // Undirected by construction, so edge order can never matter.
    expect(g.areRelated(SYBIL_A, SYBIL_B)).toBe(true);
    expect(g.areRelated(SYBIL_B, SYBIL_A)).toBe(true);
  });
});
