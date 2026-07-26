/**
 * The spend caps, as arithmetic.
 *
 * A cap enforced by an operator watching a dashboard is not a cap. These are the three
 * that are enforced in code, and the property that matters most is the least obvious one:
 * **a call is charged at its worst case before it is made**, so a burst of concurrent
 * wakes cannot overshoot the cap by exactly the concurrency — the classic way a spend
 * limit is blown by a system that only counts what has already returned.
 */

import { describe, expect, it } from 'vitest';
import {
  CastBudget,
  CHARS_PER_TOKEN,
  DEFAULT_CAST_LIMITS,
  formatMicros,
} from '../../src/cast/index.js';

describe('pricing', () => {
  it('is exact integer micro-dollars at the default prices', () => {
    // $1/1M input is exactly 1 micro-dollar per token and $6/1M output is exactly 6.
    // No rounding at all, which is why micro-dollars is the unit.
    const budget = new CastBudget({ maxOutputTokens: 100 });
    const reserved = budget.charge(4_000);
    // 4000 chars / 4 = 1000 input tokens = 1000 micros; 100 output tokens = 600 micros.
    expect(reserved).toBe(1_600);
    expect(budget.spentMicros).toBe(1_600);
  });

  it('never produces a float', () => {
    const budget = new CastBudget({ inputMicrosPerMillion: 333, outputMicrosPerMillion: 777 });
    budget.charge(4_001);
    budget.settle(budget.charge(1_234), { inputTokens: 7, outputTokens: 3 }, 99);
    expect(Number.isInteger(budget.spentMicros)).toBe(true);
  });

  it('settles down to the measured cost when the provider reports usage', () => {
    const budget = new CastBudget({ maxOutputTokens: 1_000 });
    const reserved = budget.charge(4_000); // 1000 in + 1000 out worst case = 7000 micros
    expect(reserved).toBe(7_000);
    budget.settle(reserved, { inputTokens: 1_000, outputTokens: 10 }, 40);
    // 1000 in (1000) + 10 out (60) = 1060.
    expect(budget.spentMicros).toBe(1_060);
    expect(budget.report().estimatedCalls).toBe(0);
  });

  it('estimates from characters when the provider reports nothing, and says it did', () => {
    const budget = new CastBudget({ maxOutputTokens: 1_000 });
    const reserved = budget.charge(4_000);
    budget.settle(reserved, { inputTokens: null, outputTokens: null }, 4 * CHARS_PER_TOKEN);
    // Input estimate kept (1000 micros), output swapped from the 1000-token ceiling to 4
    // estimated tokens (24 micros).
    expect(budget.spentMicros).toBe(1_024);
    expect(budget.report().estimatedCalls).toBe(1);
  });
});

describe('the three caps', () => {
  it('the cumulative spend cap trips and LATCHES — it does not reset on a Reckoning', () => {
    const budget = new CastBudget({ spendCapMicros: 2_000, maxOutputTokens: 100 });
    budget.rollTo(0);
    expect(budget.mayCall().ok).toBe(true);
    budget.charge(4_000); // 1600
    expect(budget.mayCall().ok).toBe(true);
    budget.charge(4_000); // 3200, over
    expect(budget.disabled).toBe(true);
    const verdict = budget.mayCall();
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.why).toBe('SPEND_CAP');

    // The whole point of "latching": a new Reckoning does not buy more money.
    budget.rollTo(1);
    expect(budget.disabled).toBe(true);
    expect(budget.mayCall().ok).toBe(false);
  });

  it('the call-rate cap binds for one Reckoning and then clears', () => {
    const budget = new CastBudget({ callsPerReckoning: 2, spendCapMicros: 1_000_000_000 });
    budget.rollTo(0);
    budget.charge(100);
    budget.charge(100);
    const verdict = budget.mayCall();
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.why).toBe('CALL_RATE');
    expect(budget.disabled).toBe(false);

    budget.rollTo(1);
    expect(budget.mayCall().ok).toBe(true);
  });

  it('charges before the call, so concurrency cannot overshoot the cap', () => {
    // Ten wakes started in one tick against a cap that only three fit under. If the
    // charge happened on the reply, all ten would be in flight before the first one
    // returned and the cap would be blown by seven calls' worth of tokens.
    const budget = new CastBudget({ spendCapMicros: 5_000, maxOutputTokens: 100 });
    budget.rollTo(0);
    let started = 0;
    for (let i = 0; i < 10; i += 1) {
      if (!budget.mayCall().ok) break;
      budget.charge(4_000); // 1600 each
      started += 1;
    }
    expect(started).toBe(4);
    expect(budget.spentMicros).toBeLessThanOrEqual(5_000 + 1_600);
  });

  it('a refund gives back exactly what was reserved, and never goes negative', () => {
    const budget = new CastBudget({ maxOutputTokens: 100 });
    const reserved = budget.charge(4_000);
    budget.refund(reserved);
    expect(budget.spentMicros).toBe(0);
    budget.refund(reserved);
    expect(budget.spentMicros).toBe(0);
  });

  it('a refund UN-TRIPS the cap, because phantom spend never crossed it', () => {
    // The misconfiguration case: no key, so every call fails before it reaches the
    // provider. Without this, a world that spends nothing at all disables its own cast
    // permanently after a few Reckonings of reserving money it never used.
    const budget = new CastBudget({ spendCapMicros: 2_000, maxOutputTokens: 100 });
    budget.rollTo(0);
    const a = budget.charge(4_000);
    const b = budget.charge(4_000);
    expect(budget.disabled).toBe(true);
    budget.refund(a);
    budget.refund(b);
    expect(budget.spentMicros).toBe(0);
    expect(budget.disabled).toBe(false);
    expect(budget.mayCall().ok).toBe(true);
  });

  it('a downward SETTLE does not un-trip it — only a refund does', () => {
    // The distinction that keeps the cap a cap. A settle corrects an estimate for a call
    // that HAPPENED; the worst case genuinely crossed the line, and a cap that flickers
    // as estimates land is not a cap. A refund reverses a call that never happened.
    const budget = new CastBudget({ spendCapMicros: 2_000, maxOutputTokens: 1_000 });
    budget.rollTo(0);
    const reserved = budget.charge(4_000);
    expect(budget.disabled).toBe(true);
    budget.settle(reserved, { inputTokens: 1, outputTokens: 1 }, 4);
    expect(budget.spentMicros).toBeLessThan(2_000);
    expect(budget.disabled).toBe(true);
  });
});

describe('the defaults are conservative', () => {
  it('caps a forgotten world at a few dollars, not a weekend', () => {
    expect(DEFAULT_CAST_LIMITS.spendCapMicros).toBeLessThanOrEqual(10_000_000);
    expect(DEFAULT_CAST_LIMITS.callsPerReckoning).toBeLessThanOrEqual(400);
    expect(DEFAULT_CAST_LIMITS.maxOutputTokens).toBeLessThanOrEqual(1_000);
  });

  it('prices gpt-5.6-luna as documented: $1/1M in, $6/1M out', () => {
    expect(DEFAULT_CAST_LIMITS.inputMicrosPerMillion).toBe(1_000_000);
    expect(DEFAULT_CAST_LIMITS.outputMicrosPerMillion).toBe(6_000_000);
  });

  it('formats micro-dollars without a float', () => {
    expect(formatMicros(0)).toBe('$0.000000');
    expect(formatMicros(1_500_000)).toBe('$1.500000');
    expect(formatMicros(1)).toBe('$0.000001');
  });
});
