/**
 * **INV-24 and the arithmetic the whole mechanic rests on.**
 *
 * INV-24: *"Σ Levy assessments equals the constellation total, exactly. The newcomer floor
 * is applied to every eligible principal."* The word that carries the invariant is
 * *exactly*: the Levy is paid in delivered goods and its shortfall drives a sweep, so an
 * allocation that sums to one minor unit more than the total puts a principal in the sweep
 * for a debt the rule never created — a fabricated debt, which is A5′ wearing arithmetic.
 *
 * Two properties here are exploit closures rather than sums, and each names the exploit:
 *
 *   - **The total is additive in principals** (A15). A fixed pot shared out would mean
 *     every new identity lowered everybody's share, which is a gate priced in identities.
 *   - **The newcomer floor needs *both* halves.** Read as "either", a veteran spends its
 *     stores down below the line before the assessment and is floored for the rest of the
 *     season.
 */

import { describe, expect, it } from 'vitest';
import type { ConstellationId, PrincipalId } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';
import {
  LEVY_DUTY_PER_PRINCIPAL,
  LEVY_NEWCOMER_CAPITAL_MINOR,
  LEVY_NEWCOMER_TENURE_TICKS,
  LEVY_NOMINAL_MINOR,
  LEVY_RULES,
  LevyArithmeticError,
  allocate,
  dutyOf,
  isNewcomer,
  largestRemainder,
  totalFor,
  weightOf,
} from '../../src/levy/index.js';
import { checkInv24 } from '../../src/invariants/crowd.js';
import { inv24InputsFor } from '../../src/levy/settle.js';
import { Book } from '../../src/levy/book.js';
import { newcomer, subject } from './fixture.js';

const C = 'c:one' as ConstellationId;

function plan(subjects: readonly ReturnType<typeof subject>[], rule = LEVY_RULES[3]) {
  if (rule === undefined) throw new Error('no rule');
  return allocate({ constellation: C, subjects, rule, spared: null, byDefault: true });
}

describe('INV-24 — Σ assessments equals the total, exactly', () => {
  it('sums to the total under every published rule, for an awkward roll', () => {
    // Deliberately awkward: a prime-ish count, wildly different EXPOSURE and stores, so
    // the largest-remainder pass has real remainders to hand out.
    const subjects = [
      subject('p:a', { exposure: 0, freeStores: 900_000 }),
      subject('p:b', { exposure: 7, freeStores: 1 }),
      subject('p:c', { exposure: 1_234_567, freeStores: 12_345 }),
      subject('p:d', { exposure: 999, freeStores: 500_000 }),
      subject('p:e', { exposure: 3, freeStores: 7 }),
      subject('p:f', { exposure: 88_888, freeStores: 333_333 }),
      subject('p:g', { exposure: 1, freeStores: 300_001 }),
    ];
    const total = totalFor(subjects);
    for (const rule of LEVY_RULES) {
      const out = allocate({ constellation: C, subjects, rule, spared: null, byDefault: false });
      const summed = out.lines.reduce((n, l) => n + l.amount, 0);
      expect(summed, `rule ${rule} did not sum to the total`).toBe(total);
      expect(out.lines).toHaveLength(subjects.length);
      for (const line of out.lines) expect(line.amount).toBeGreaterThanOrEqual(0);
    }
  });

  it('is exact across 400 random rolls and rules — the property, not a case', () => {
    // A seeded LCG rather than fast-check: this file must not draw from an unseeded
    // source (DET-7), and the point is coverage of remainders, not shrinking.
    let seed = 20260725;
    const next = (bound: number): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % bound;
    };
    for (let n = 0; n < 400; n += 1) {
      const count = 1 + next(9);
      const subjects = Array.from({ length: count }, (_, i) =>
        next(4) === 0
          ? newcomer(`p:${String(i)}`, { exposure: next(50_000) })
          : subject(`p:${String(i)}`, { exposure: next(2_000_000), freeStores: next(4_000_000) }),
      );
      const rule = LEVY_RULES[next(LEVY_RULES.length)];
      if (rule === undefined) continue;
      const spared = next(3) === 0 ? (subjects[next(count)]?.principal ?? null) : null;
      const out = allocate({ constellation: C, subjects, rule, spared, byDefault: false });
      const summed = out.lines.reduce((acc, l) => acc + l.amount, 0);
      expect(summed).toBe(out.total);
    }
  });

  it('passes the real INV-24 checker, seizure-queue clause included', () => {
    const subjects = [subject('p:a'), subject('p:b'), newcomer('p:new')];
    const out = plan(subjects);
    const book = new Book();
    book.assess({
      reckoning: 0,
      constellation: C,
      total: out.total,
      rule: out.rule,
      spared: out.spared,
      byDefault: out.byDefault,
      deliverableTo: 's:place' as never,
      lines: out.lines,
      assessedAtTick: 0,
    });
    const inputs = inv24InputsFor(book, 0);
    expect(inputs).not.toBeNull();
    expect(checkInv24(inputs as never, 0)).toEqual([]);
  });

  it('BITES: a total one minor unit off is caught, so the checker is not decorative', () => {
    // The mutation this test is the regression for. `allocate` cannot produce it — it
    // asserts its own sum — so the corruption is injected at the plan, which is exactly
    // where a future edit ("just bump the total for the new sink") would put it.
    const subjects = [subject('p:a'), subject('p:b')];
    const out = plan(subjects);
    const book = new Book();
    book.assess({
      reckoning: 0,
      constellation: C,
      total: minor(out.total + 1),
      rule: out.rule,
      spared: null,
      byDefault: true,
      deliverableTo: 's:place' as never,
      lines: out.lines,
      assessedAtTick: 0,
    });
    const violations = checkInv24(inv24InputsFor(book, 0) as never, 0);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.id).toBe('INV-24');
    expect(violations[0]?.severity).toBe('HALT');
  });
});

describe('the total is fixed by rule, and cannot be dodged', () => {
  it('is Σ duty, so an extra identity ADDS its own duty and lowers nobody else (A15)', () => {
    const before = [subject('p:a'), subject('p:b')];
    const after = [...before, newcomer('p:sybil')];
    const one = allocate({ constellation: C, subjects: before, rule: 'EVEN', spared: null, byDefault: true });
    const two = allocate({ constellation: C, subjects: after, rule: 'EVEN', spared: null, byDefault: true });

    expect(two.total).toBe(one.total + LEVY_NOMINAL_MINOR);
    // The exploit this closes: if the total were a pot divided among the roll, `p:a`'s
    // share would have fallen when the Sybil arrived. It does not move at all.
    const aBefore = one.lines.find((l) => l.principal === ('p:a' as PrincipalId))?.amount;
    const aAfter = two.lines.find((l) => l.principal === ('p:a' as PrincipalId))?.amount;
    expect(aAfter).toBe(aBefore);
  });

  it('does not fall when a principal empties its stores or drops its EXPOSURE', () => {
    const rich = [subject('p:a', { freeStores: 5_000_000, exposure: 900_000 }), subject('p:b')];
    const poor = [subject('p:a', { freeStores: 0, exposure: 0 }), subject('p:b')];
    // Same roll, same tenure, everything else changed: the total is identical, because it
    // is a function of the roll and the floor and of nothing an agent decides.
    expect(totalFor(poor)).toBe(totalFor(rich));
  });
});

describe('the newcomer floor', () => {
  it('needs BOTH halves — short tenure AND thin capital', () => {
    expect(isNewcomer(newcomer('p:new'))).toBe(true);
    // Tenure short, capital fat: not a newcomer. A rich arrival is not protected.
    expect(
      isNewcomer({ tenureTicks: 0, freeStores: LEVY_NEWCOMER_CAPITAL_MINOR }),
    ).toBe(false);
    // ── THE EXPLOIT, NAMED ──────────────────────────────────────────────────
    // Tenure long, capital empty: NOT floored. Read as "either half", this is the
    // veteran that spends down before the assessment and pays the nominal rate forever.
    expect(
      isNewcomer({ tenureTicks: LEVY_NEWCOMER_TENURE_TICKS, freeStores: minor(0) }),
    ).toBe(false);
  });

  it('assesses a floored principal exactly the nominal rate, and records that it applied', () => {
    const out = plan([subject('p:a'), newcomer('p:new')]);
    const floored = out.lines.find((l) => l.principal === ('p:new' as PrincipalId));
    expect(floored?.amount).toBe(LEVY_NOMINAL_MINOR);
    expect(floored?.newcomerFloored).toBe(true);
    expect(floored?.weight).toBe(0);
    // The protection has to be *visible in the record*, not merely applied: INV-24 halts
    // on an eligible principal whose line does not claim the floor, because a floor that
    // silently failed to apply looks like an ordinary hard first night.
    const veteran = out.lines.find((l) => l.principal === ('p:a' as PrincipalId));
    expect(veteran?.newcomerFloored).toBe(false);
    expect(veteran?.amount).toBe(LEVY_DUTY_PER_PRINCIPAL);
  });

  it('reduces the total when EVERY principal is floored, rather than breaking the floor', () => {
    // Night one of a constellation. There is nobody to redistribute to, so the choice is
    // between breaking a protection and lowering the total — §5.2 makes the protections
    // unconditional, so the total gives way.
    const subjects = [newcomer('p:a'), newcomer('p:b'), newcomer('p:c')];
    const out = plan(subjects);
    expect(out.total).toBe(LEVY_NOMINAL_MINOR * 3);
    for (const line of out.lines) {
      expect(line.amount).toBe(LEVY_NOMINAL_MINOR);
      expect(line.newcomerFloored).toBe(true);
    }
  });
});

describe('the weights', () => {
  it('INVERSE_EXPOSURE falls as EXPOSURE rises, and never reaches zero', () => {
    const low = weightOf('INVERSE_EXPOSURE', subject('p:a', { exposure: 0 }));
    const mid = weightOf('INVERSE_EXPOSURE', subject('p:b', { exposure: 100_000 }));
    const high = weightOf('INVERSE_EXPOSURE', subject('p:c', { exposure: 10_000_000_000 }));
    expect(low).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(high);
    // Never zero: a zero weight would assess the most exposed principal at nothing, which
    // is not "inversely to Exposure" — it is an exemption, and the Levy has none.
    expect(high).toBeGreaterThanOrEqual(1);
  });

  it('makes the turtle the most taxed posture under the published default', () => {
    const turtle = subject('p:turtle', { exposure: 0 });
    const exposed = subject('p:exposed', { exposure: 2_000_000 });
    const out = plan([turtle, exposed]);
    const turtleShare = out.lines.find((l) => l.principal === turtle.principal)?.amount ?? 0;
    const exposedShare = out.lines.find((l) => l.principal === exposed.principal)?.amount ?? 0;
    // §5.2: "hiding is the most taxed posture in the game, not the safest."
    expect(turtleShare).toBeGreaterThan(exposedShare);
    expect(turtleShare + exposedShare).toBe(out.total);
  });

  it('every rule gives every subject a positive weight', () => {
    for (const rule of LEVY_RULES) {
      expect(
        weightOf(rule, subject('p:a', { exposure: 0, freeStores: 0, levyGoodHeld: 0 })),
      ).toBeGreaterThan(0);
    }
  });

  it('★ BY_STORES WEIGHS THE GOODS, NOT THE CURRENCY — the unit the Levy is payable in', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // `weightOf('BY_STORES')` read `freeStores` — the MINOR **currency** balance — while §5.2
    // makes the Levy payable "only in located goods". Measured consequence on
    // `balance-gate --seeds-from g --reckonings 6`: `p:halcyon` held 0 units of the levy good and
    // 207,764 in currency, and was assessed 36,374 of its constellation's 120,000 — the largest
    // share on the docket — while `p:vex`, holding 76,565 units, was assessed 500. It is also the
    // duty GROWING with an unspent balance: halcyon's weight climbed 180,481 → 195,916 → 207,764
    // across three Reckonings against a goods income fixed at 11,520.
    //
    // These two subjects are the shape of that bug in four lines. `subject()` defaults
    // `levyGoodHeld` to `freeStores`, so they must be passed apart or this assertion cannot fire.
    //
    // MUTATION: put `subject.freeStores` back into the `BY_STORES` arm of `weightOf` and this
    // goes red on the first assertion — the cash-rich pauper outweighs the goods-rich payer.
    // ══════════════════════════════════════════════════════════════════════════
    const cashRichPauper = subject('p:halcyon', { freeStores: 207_764, levyGoodHeld: 0 });
    const goodsRichPayer = subject('p:vex', { freeStores: 71_217, levyGoodHeld: 76_565 });

    expect(
      weightOf('BY_STORES', goodsRichPayer),
      'the member that can actually hand goods over must carry the heavier BY_STORES weight',
    ).toBeGreaterThan(weightOf('BY_STORES', cashRichPauper));

    // Never zero, for the reason every other rule is never zero: a zero weight is an exemption
    // and the Levy has none. A principal with an empty warehouse is weighted 1, not 0.
    expect(weightOf('BY_STORES', cashRichPauper)).toBe(1);

    // And currency must not move it AT ALL. Two subjects with the same goods and a 200,000-minor
    // spread in cash weigh exactly the same, which is what makes the rule's unit unambiguous.
    expect(weightOf('BY_STORES', subject('p:rich', { freeStores: 200_000, levyGoodHeld: 9_000 }))).toBe(
      weightOf('BY_STORES', subject('p:poor', { freeStores: 0, levyGoodHeld: 9_000 })),
    );

    // The allocation follows the weight: the pauper's share must be *below* an even split, and
    // the payer's above it, or the rule has not changed hands.
    const out = plan([cashRichPauper, goodsRichPayer], 'BY_STORES');
    const pauper = out.lines.find((l) => l.principal === cashRichPauper.principal)?.amount ?? -1;
    const payer = out.lines.find((l) => l.principal === goodsRichPayer.principal)?.amount ?? -1;
    expect(pauper).toBeLessThan(payer);
    expect(pauper + payer, 'INV-24 still holds exactly').toBe(out.total);
  });
});

describe('largestRemainder', () => {
  it('allocates every unit, and hands remainders out in a stated order', () => {
    // 10 across three equal weights: 3,3,3 with one left over, and the tie-break is index
    // order — which is why `allocate` sorts by principal id before calling.
    expect(largestRemainder(minor(10), [1, 1, 1])).toEqual([4, 3, 3]);
    expect(largestRemainder(minor(0), [5, 5])).toEqual([0, 0]);
    expect(largestRemainder(minor(0), [])).toEqual([]);
    // Weight matters: 100 across 1:3 is 25:75 with nothing left over.
    expect(largestRemainder(minor(100), [1, 3])).toEqual([25, 75]);
  });

  it('refuses what it cannot do honestly rather than guessing', () => {
    expect(() => largestRemainder(minor(1), [])).toThrow(LevyArithmeticError);
    expect(() => largestRemainder(minor(-1), [1])).toThrow(LevyArithmeticError);
    expect(() => largestRemainder(minor(5), [0, 0])).toThrow(LevyArithmeticError);
    // Past 2**53 the division stops being integer arithmetic, so it is refused loudly
    // rather than silently losing precision in a value path.
    expect(() => largestRemainder(minor(Number.MAX_SAFE_INTEGER), [3, 3])).toThrow(LevyArithmeticError);
  });
});

describe('dutyOf', () => {
  it('is the nominal rate for a newcomer and the full duty otherwise', () => {
    expect(dutyOf(newcomer('p:new'))).toBe(LEVY_NOMINAL_MINOR);
    expect(dutyOf(subject('p:a'))).toBe(LEVY_DUTY_PER_PRINCIPAL);
  });

  it('has a non-zero nominal rate, because there is NO Commons exemption', () => {
    // A floor of zero would take the protected principal off the docket entirely, which is
    // the silence INV-25 exists to make impossible (§5.2: "every principal is assessed").
    expect(LEVY_NOMINAL_MINOR).toBeGreaterThan(0);
  });
});
