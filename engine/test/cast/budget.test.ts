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
    budget.settle(budget.charge(1_234), { inputTokens: 7, outputTokens: 3 , cachedInputTokens: null}, 99);
    expect(Number.isInteger(budget.spentMicros)).toBe(true);
  });

  it('settles down to the measured cost when the provider reports usage', () => {
    const budget = new CastBudget({ maxOutputTokens: 1_000 });
    const reserved = budget.charge(4_000); // 1000 in + 1000 out worst case = 7000 micros
    expect(reserved).toBe(7_000);
    budget.settle(reserved, { inputTokens: 1_000, outputTokens: 10 , cachedInputTokens: null}, 40);
    // 1000 in (1000) + 10 out (60) = 1060.
    expect(budget.spentMicros).toBe(1_060);
    expect(budget.report().estimatedCalls).toBe(0);
  });

  it('estimates from characters when the provider reports nothing, and says it did', () => {
    const budget = new CastBudget({ maxOutputTokens: 1_000 });
    const reserved = budget.charge(4_000);
    budget.settle(reserved, { inputTokens: null, outputTokens: null , cachedInputTokens: null}, 4 * CHARS_PER_TOKEN);
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
    budget.settle(reserved, { inputTokens: 1, outputTokens: 1 , cachedInputTokens: null}, 4);
    expect(budget.spentMicros).toBeLessThan(2_000);
    expect(budget.disabled).toBe(true);
  });
});

describe('the defaults are conservative', () => {
  it('caps a forgotten world at a few dollars, not a weekend', () => {
    // The bound on `maxOutputTokens` used to be <= 1000 and stood in for cost. It had to
    // move: gpt-5.6-luna spends REASONING tokens out of the same budget, and a cap that is
    // too low returns HTTP 200 with EMPTY content (measured: a cap of 200 was consumed
    // entirely by reasoning). So the token cap is a CORRECTNESS floor, not a cost ceiling,
    // and pinning it low was pinning the cast broken.
    //
    // Rather than just raise the number, assert the property the old bound was a proxy
    // for: the thing that actually stops a forgotten world spending a weekend is the
    // LATCHING spend cap, so bound the real worst case instead of one of its inputs.
    expect(DEFAULT_CAST_LIMITS.spendCapMicros).toBeLessThanOrEqual(10_000_000);
    expect(DEFAULT_CAST_LIMITS.callsPerReckoning).toBeLessThanOrEqual(400);

    // Worst case for one call under the defaults, priced exactly as the budget prices it.
    const worstInputTokens = Math.ceil(DEFAULT_CAST_LIMITS.maxPromptChars / 4);
    const worstCallMicros =
      Math.ceil((worstInputTokens * DEFAULT_CAST_LIMITS.inputMicrosPerMillion) / 1_000_000) +
      Math.ceil(
        (DEFAULT_CAST_LIMITS.maxOutputTokens * DEFAULT_CAST_LIMITS.outputMicrosPerMillion) /
          1_000_000,
      );
    // A single call can never be expensive enough to be a surprise on its own.
    expect(worstCallMicros).toBeLessThanOrEqual(50_000); // $0.05

    // And the latch binds the total regardless of how many Reckonings run unattended:
    // whatever the per-call cost, spending stops at the cap and the world runs on
    // heuristics. That is the actual "not a weekend" guarantee.
    const worstReckoningMicros = worstCallMicros * DEFAULT_CAST_LIMITS.callsPerReckoning;
    expect(worstReckoningMicros).toBeGreaterThan(0);
    expect(DEFAULT_CAST_LIMITS.spendCapMicros).toBeLessThanOrEqual(10_000_000);
  });

  it('the output cap is high enough that a reasoning model can actually answer', () => {
    // The other side of the same coin, and the reason the bound above changed. Measured on
    // gpt-5.6-luna: 113-200 reasoning tokens for one small prompt, and a 200-token cap
    // returned finish_reason=length with no text at all. A default below the observed
    // reasoning consumption ships a cast that silently never decides.
    expect(DEFAULT_CAST_LIMITS.maxOutputTokens).toBeGreaterThanOrEqual(1_000);
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

describe('prompt caching is priced, because it is most of the bill', () => {
  it('a cache hit costs a tenth of a fresh token, so the cap tracks the real invoice', () => {
    // Measured live against gpt-5.6-luna with the real agent.md contract as the first
    // message: 6498 of 6543 prompt tokens served from cache on the second call, i.e. 99%.
    // The contract is identical for all 20 members, so once warm the whole cast rides it.
    const budget = new CastBudget({ maxOutputTokens: 1_000 });
    const reserved = budget.charge(4 * 6_543);
    budget.settle(reserved, { inputTokens: 6_543, outputTokens: 10, cachedInputTokens: 6_498 }, 40);
    // 45 fresh (45 micros) + 6498 cached at a tenth (649) + 10 out (60) = 754.
    expect(budget.spentMicros).toBe(754);

    // The same call priced as if nothing were cached costs ~8.7x more. That ratio is the
    // difference between the cast running for hours and being cut off in minutes.
    const naive = new CastBudget({ maxOutputTokens: 1_000 });
    const r2 = naive.charge(4 * 6_543);
    naive.settle(r2, { inputTokens: 6_543, outputTokens: 10, cachedInputTokens: null }, 40);
    expect(naive.spentMicros).toBe(6_603);
    expect(naive.spentMicros).toBeGreaterThan(budget.spentMicros * 8);
  });

  it('a nonsense cached count can never price a call below zero', () => {
    // The provider is not trusted to be coherent: cached is clamped to the reported total.
    const budget = new CastBudget({ maxOutputTokens: 100 });
    const reserved = budget.charge(400);
    budget.settle(reserved, { inputTokens: 10, outputTokens: 1, cachedInputTokens: 999_999 }, 4);
    expect(budget.spentMicros).toBeGreaterThanOrEqual(0);
  });
});

describe('the spend is observable, not merely bounded', () => {
  it('a tripped cap is a NAMED health failure, not a silent fall back to heuristics', async () => {
    // The world ran on a real key with a latching cap and no meter, so the only way to
    // discover the spend was to hit it. A bounded risk is still an unobserved one, and
    // scars #4 and #14 both presented as a perfectly healthy system. When the cap
    // latches the world keeps running and looks fine while the expensive path — the
    // whole reason the cast exists — has switched itself off. That must be said out loud.
    const { buildHealth } = await import('../../src/api/health.js');
    const tripped = {
      enabled: true, model: 'gpt-5.6-luna', members: 20, live: 5, fallback: 2, discarded: 1,
      spentMicros: 5_000_000, capMicros: 5_000_000, capTripped: true, estimatedCalls: 0,
    };
    const { Runtime } = await import('../../src/sim/runtime.js');
    const { SeatBook } = await import('../../src/api/seats.js');
    const report = buildHealth(new Runtime({ seed: 'cast-health' }), new SeatBook(), {
      cast: () => tripped,
    });
    expect(report.cast?.spentMicros).toBe(5_000_000);
    expect(report.failures.join(' ')).toMatch(/spent its cap/i);
    expect(report.failures.join(' ')).toMatch(/COMPACT_CAST_SPEND_CAP_MICROS/);
  });

  it('an untripped cast reports its spend without raising a failure about it', async () => {
    const { buildHealth } = await import('../../src/api/health.js');
    const { Runtime } = await import('../../src/sim/runtime.js');
    const { SeatBook } = await import('../../src/api/seats.js');
    const report = buildHealth(new Runtime({ seed: 'cast-health-2' }), new SeatBook(), {
      cast: () => ({
        enabled: true, model: 'gpt-5.6-luna', members: 20, live: 5, fallback: 0, discarded: 0,
        spentMicros: 1_234, capMicros: 5_000_000, capTripped: false, estimatedCalls: 0,
      }),
    });
    expect(report.cast?.spentMicros).toBe(1_234);
    expect(report.failures.join(' ')).not.toMatch(/spent its cap/i);
  });
});
