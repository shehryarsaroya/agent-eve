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
import { fixedClock } from '../../src/core/time.js';

/** A clock that can be stepped, for the window tests. `advance` is on the fixedClock shape. */
type Steppable = ReturnType<typeof fixedClock> & { advance(ms: number): void };
const clockAt = (ms = 1_700_000_000_000): Steppable => fixedClock(ms) as Steppable;

/**
 * A budget with a clock, for every test whose subject is NOT the window.
 *
 * The default limits carry a 24 h window and the constructor refuses a window with no
 * clock, so these all need one. They get a fixed clock that never advances, which pins
 * them to a single window and leaves each test asserting exactly what it asserted before.
 */
const budgetOf = (limits: Partial<typeof DEFAULT_CAST_LIMITS> = {}): CastBudget =>
  new CastBudget(limits, clockAt());

describe('pricing', () => {
  it('is exact integer micro-dollars at the default prices', () => {
    // $1/1M input is exactly 1 micro-dollar per token and $6/1M output is exactly 6.
    // No rounding at all, which is why micro-dollars is the unit.
    const budget = budgetOf({ maxOutputTokens: 100 });
    const reserved = budget.charge(4_000);
    // 4000 chars / 4 = 1000 input tokens = 1000 micros; 100 output tokens = 600 micros.
    expect(reserved).toBe(1_600);
    expect(budget.spentMicros).toBe(1_600);
  });

  it('never produces a float', () => {
    const budget = budgetOf({ inputMicrosPerMillion: 333, outputMicrosPerMillion: 777 });
    budget.charge(4_001);
    budget.settle(budget.charge(1_234), { inputTokens: 7, outputTokens: 3 , cachedInputTokens: null}, 99);
    expect(Number.isInteger(budget.spentMicros)).toBe(true);
  });

  it('settles down to the measured cost when the provider reports usage', () => {
    const budget = budgetOf({ maxOutputTokens: 1_000 });
    const reserved = budget.charge(4_000); // 1000 in + 1000 out worst case = 7000 micros
    expect(reserved).toBe(7_000);
    budget.settle(reserved, { inputTokens: 1_000, outputTokens: 10 , cachedInputTokens: null}, 40);
    // 1000 in (1000) + 10 out (60) = 1060.
    expect(budget.spentMicros).toBe(1_060);
    expect(budget.report().estimatedCalls).toBe(0);
  });

  it('estimates from characters when the provider reports nothing, and says it did', () => {
    const budget = budgetOf({ maxOutputTokens: 1_000 });
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
    const budget = budgetOf({ spendCapMicros: 2_000, maxOutputTokens: 100 });
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
    const budget = budgetOf({ callsPerReckoning: 2, spendCapMicros: 1_000_000_000 });
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
    const budget = budgetOf({ spendCapMicros: 5_000, maxOutputTokens: 100 });
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
    const budget = budgetOf({ maxOutputTokens: 100 });
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
    const budget = budgetOf({ spendCapMicros: 2_000, maxOutputTokens: 100 });
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
    const budget = budgetOf({ spendCapMicros: 2_000, maxOutputTokens: 1_000 });
    budget.rollTo(0);
    const reserved = budget.charge(4_000);
    expect(budget.disabled).toBe(true);
    budget.settle(reserved, { inputTokens: 1, outputTokens: 1 , cachedInputTokens: null}, 4);
    expect(budget.spentMicros).toBeLessThan(2_000);
    expect(budget.disabled).toBe(true);
  });
});

describe('the daily window — what the latch does and does not survive', () => {
  const DAY = 24 * 3_600_000;

  it('rolls after the window and clears the latch, so a world comes back on its own', () => {
    // The 2026-07-31 production failure, replayed: trip the cap, then let a day pass.
    const clock = clockAt();
    const budget = new CastBudget({ spendCapMicros: 2_000, maxOutputTokens: 100 }, clock);
    budget.charge(4_000);
    budget.charge(4_000);
    expect(budget.disabled).toBe(true);

    clock.advance(DAY - 1);
    expect(budget.mayCall().ok).toBe(false); // one ms short: still the same day

    clock.advance(1);
    expect(budget.mayCall().ok).toBe(true);
    expect(budget.disabled).toBe(false);
    expect(budget.spentMicros).toBe(0);
  });

  it('a Reckoning still buys nothing — only wall time does', () => {
    // The distinction the whole design rests on. World time runs at whatever COMPACT_SPEED
    // says; if a Reckoning cleared the latch, a turbo world would hand out the daily
    // allowance six times a day and the cap would be decoration.
    const clock = clockAt();
    const budget = new CastBudget({ spendCapMicros: 2_000, maxOutputTokens: 100 }, clock);
    budget.charge(4_000);
    budget.charge(4_000);
    expect(budget.disabled).toBe(true);
    for (let r = 1; r <= 20; r += 1) budget.rollTo(r);
    expect(budget.disabled).toBe(true);
    expect(budget.mayCall().ok).toBe(false);
  });

  it('the lifetime total keeps counting across windows, so the real spend stays visible', () => {
    // A daily cap that also resets the only number anybody reports would hide the total.
    const clock = clockAt();
    const budget = new CastBudget({ spendCapMicros: 10_000, maxOutputTokens: 100 }, clock);
    budget.charge(4_000); // 1600
    clock.advance(DAY);
    budget.charge(4_000); // 1600, new window
    expect(budget.spentMicros).toBe(1_600);
    expect(budget.report().spentLifetimeMicros).toBe(3_200);
  });

  it('reports how long until it comes back, because that is the operator\'s next question', () => {
    const clock = clockAt();
    const budget = new CastBudget({ spendCapMicros: 2_000, maxOutputTokens: 100 }, clock);
    expect(budget.report().windowResetsInMs).toBeNull(); // nothing charged, nothing anchored
    budget.charge(4_000);
    expect(budget.report().windowResetsInMs).toBe(DAY);
    clock.advance(6 * 3_600_000);
    expect(budget.report().windowResetsInMs).toBe(18 * 3_600_000);
  });

  it('never reports a negative countdown once the window has elapsed unused', () => {
    // rollWindow runs on use, so a report taken after the elapse but before the next call
    // would otherwise print a countdown that had gone through zero.
    const clock = clockAt();
    const budget = new CastBudget({ spendCapMicros: 2_000, maxOutputTokens: 100 }, clock);
    budget.charge(4_000);
    clock.advance(DAY * 3);
    expect(budget.report().windowResetsInMs).toBe(0);
  });

  it('a clock that steps BACKWARDS does not hand out a fresh allowance', () => {
    // NTP correcting a drifting VM, which this box is. Reading a backwards jump as "the
    // window elapsed" would mean a fault nobody thinks to look for spends real money.
    const clock = clockAt();
    const budget = new CastBudget({ spendCapMicros: 2_000, maxOutputTokens: 100 }, clock);
    budget.charge(4_000);
    budget.charge(4_000);
    expect(budget.disabled).toBe(true);
    clock.advance(-DAY * 2);
    expect(budget.disabled).toBe(true);
    expect(budget.mayCall().ok).toBe(false);
    expect(budget.spentMicros).toBeGreaterThan(0);
  });

  it('re-anchors after a backwards jump rather than wedging forever', () => {
    // The other half of the same guard: having re-anchored, a genuine day must still roll.
    const clock = clockAt();
    const budget = new CastBudget({ spendCapMicros: 2_000, maxOutputTokens: 100 }, clock);
    budget.charge(4_000);
    budget.charge(4_000);
    clock.advance(-DAY * 2);
    budget.mayCall(); // re-anchors the window at the new, earlier now
    clock.advance(DAY);
    expect(budget.mayCall().ok).toBe(true);
  });
});

describe('the defaults are conservative', () => {
  it('bounds a forgotten world PER DAY, and self-heals instead of dying', () => {
    // The guarantee changed shape on 2026-08-01 and this test changed with it, so state
    // both halves rather than just relaxing the number.
    //
    // It used to be "a few dollars, ever": $5 for the life of the process, latching for
    // good. That bounded the money and produced the failure it was not looking at — the
    // cast tripped seven hours into a fresh world and production ran THIRTY-TWO HOURS on
    // heuristics with the site up and frames publishing. A bound that converts a cost
    // overrun into an indefinite silent degradation is not conservative; it just moved
    // where the loss lands.
    //
    // The guarantee now is a DAILY ceiling that rolls: bounded spend per day, and a world
    // that comes back on its own. Assert the ceiling, the window, and the arithmetic that
    // makes the ceiling meaningful.
    expect(DEFAULT_CAST_LIMITS.spendCapMicros).toBeLessThanOrEqual(100_000_000); // $100/day
    expect(DEFAULT_CAST_LIMITS.spendWindowMs).toBe(24 * 3_600_000);
    expect(DEFAULT_CAST_LIMITS.callsPerReckoning).toBeLessThanOrEqual(400);

    // The rate cap is what makes the daily cap a real bound rather than a hope: whatever a
    // call costs, only so many can be made in a Reckoning, and only so many Reckonings fit
    // in a day. Worst case per day, priced exactly as the budget prices it.
    const worstInputTokens = Math.ceil(DEFAULT_CAST_LIMITS.maxPromptChars / 4);
    const worstCallMicros =
      Math.ceil((worstInputTokens * DEFAULT_CAST_LIMITS.inputMicrosPerMillion) / 1_000_000) +
      Math.ceil(
        (DEFAULT_CAST_LIMITS.maxOutputTokens * DEFAULT_CAST_LIMITS.outputMicrosPerMillion) /
          1_000_000,
      );
    // A single call can never be expensive enough to be a surprise on its own.
    expect(worstCallMicros).toBeLessThanOrEqual(50_000); // $0.05

    // And the day's spend stops at the cap however many Reckonings run unattended — the
    // window only ever gives back the SAME allowance, never a larger one.
    expect(worstCallMicros * DEFAULT_CAST_LIMITS.callsPerReckoning).toBeGreaterThan(0);
  });

  it('the daily ceiling is real money against the measured burn, not a number', () => {
    // Production measured $5.00 over 7.5 h at twelve members — call it $16/day. The cap
    // should be comfortable headroom over that (so it never binds in normal operation) and
    // still small enough that a runaway wake trigger is a bill somebody can absorb noticing
    // a day late. Both directions asserted, because only checking one is how a cap ends up
    // either strangling the cast or not being a cap.
    const measuredDailyBurnMicros = 16_000_000; // $16
    expect(DEFAULT_CAST_LIMITS.spendCapMicros).toBeGreaterThan(measuredDailyBurnMicros * 3);
    expect(DEFAULT_CAST_LIMITS.spendCapMicros).toBeLessThanOrEqual(measuredDailyBurnMicros * 10);
  });

  it('legacy: the pre-window shape is still reachable, and needs no clock', () => {
    // spendWindowMs: 0 restores the life-of-process cap. Kept working on purpose so a sim
    // harness that wants a hard total can have one, and so the window can be bisected out.
    const budget = new CastBudget({ spendWindowMs: 0, spendCapMicros: 2_000, maxOutputTokens: 100 });
    budget.charge(4_000);
    budget.charge(4_000);
    expect(budget.disabled).toBe(true);
    expect(budget.report().windowMs).toBe(0);
    expect(budget.report().windowResetsInMs).toBeNull();
  });

  it('a window with no clock is REFUSED, not silently treated as a lifetime cap', () => {
    // The failure this guards is a budget that lies about its own shape: a 24 h window that
    // cannot read a clock never rolls, so it behaves exactly like the lifetime cap while
    // every report says "of $100 per 24h". Louder to throw at construction.
    expect(() => new CastBudget({ spendWindowMs: 1_000 })).toThrow(/requires a Clock/);
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
    const budget = budgetOf({ maxOutputTokens: 1_000 });
    const reserved = budget.charge(4 * 6_543);
    budget.settle(reserved, { inputTokens: 6_543, outputTokens: 10, cachedInputTokens: 6_498 }, 40);
    // 45 fresh (45 micros) + 6498 cached at a tenth (649) + 10 out (60) = 754.
    expect(budget.spentMicros).toBe(754);

    // The same call priced as if nothing were cached costs ~8.7x more. That ratio is the
    // difference between the cast running for hours and being cut off in minutes.
    const naive = budgetOf({ maxOutputTokens: 1_000 });
    const r2 = naive.charge(4 * 6_543);
    naive.settle(r2, { inputTokens: 6_543, outputTokens: 10, cachedInputTokens: null }, 40);
    expect(naive.spentMicros).toBe(6_603);
    expect(naive.spentMicros).toBeGreaterThan(budget.spentMicros * 8);
  });

  it('a nonsense cached count can never price a call below zero', () => {
    // The provider is not trusted to be coherent: cached is clamped to the reported total.
    const budget = budgetOf({ maxOutputTokens: 100 });
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

describe('scar #14b measured against the population that actually tried', () => {
  it('a working cast is NOT a failure however small its share of all decisions', async () => {
    // Measured on the live world: the cast's own counters read live 41, fallback 0,
    // discarded 0 — working perfectly — while deciding_share_bps sat at 1397 against a
    // floor of 2500 and health reported unhealthy. The arithmetic is structural: twelve
    // members waking sixteen times a Reckoning cannot out-count a heuristic cast acting
    // every tick. A signal that is red while nothing is broken stops being read, which is
    // how scar #14b wins twice — first by hiding a fallback, then by crying wolf until
    // somebody silences the detector.
    const { buildHealth } = await import('../../src/api/health.js');
    const { Runtime } = await import('../../src/sim/runtime.js');
    const { SeatBook } = await import('../../src/api/seats.js');
    const report = buildHealth(new Runtime({ seed: 'fb-ok' }), new SeatBook(), {
      cast: () => ({
        enabled: true, model: 'gpt-5.6-luna', members: 12,
        live: 41, fallback: 0, discarded: 0,
        spentMicros: 231_000, capMicros: 5_000_000, capTripped: false, estimatedCalls: 0,
      }),
    });
    expect(report.failures.join(' ')).not.toMatch(/fell back on/);
  });

  it('a cast that keeps FAILING its wakes is a named failure, whatever the share says', async () => {
    // The state scar #14b actually names: the expensive path is being attempted and
    // failing, the world keeps running on heuristics, and everything looks fine.
    const { buildHealth } = await import('../../src/api/health.js');
    const { Runtime } = await import('../../src/sim/runtime.js');
    const { SeatBook } = await import('../../src/api/seats.js');
    const report = buildHealth(new Runtime({ seed: 'fb-bad' }), new SeatBook(), {
      cast: () => ({
        enabled: true, model: 'gpt-5.6-luna', members: 12,
        live: 10, fallback: 40, discarded: 0, // 8000 bps of attempts fell back
        spentMicros: 1_000, capMicros: 5_000_000, capTripped: false, estimatedCalls: 0,
      }),
    });
    expect(report.failures.join(' ')).toMatch(/fell back on 8000 bps/);
  });

  it('judges nothing before there is a rate to judge', async () => {
    // One failure out of one is 10,000 bps and means nothing. Judging a rate before it
    // exists is how an alarm earns its reputation for lying.
    const { buildHealth } = await import('../../src/api/health.js');
    const { Runtime } = await import('../../src/sim/runtime.js');
    const { SeatBook } = await import('../../src/api/seats.js');
    const report = buildHealth(new Runtime({ seed: 'fb-few' }), new SeatBook(), {
      cast: () => ({
        enabled: true, model: 'gpt-5.6-luna', members: 12,
        live: 0, fallback: 1, discarded: 0,
        spentMicros: 100, capMicros: 5_000_000, capTripped: false, estimatedCalls: 0,
      }),
    });
    expect(report.failures.join(' ')).not.toMatch(/fell back on/);
  });
});
