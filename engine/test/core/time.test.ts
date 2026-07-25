/**
 * The clock: the Reckoning cycle must be total, non-overlapping, and the same
 * shape at tick -289 as at tick 288,000,287.
 *
 * Why totality matters more than it looks: the width of the commitment window is
 * an **agent-facing rule**. If `agent.md` says "you have 24 ticks to commit" and
 * the engine allows 23, that is scar #1 with money on it — the engine and the
 * agent-facing text disagreeing about one number, invisible to every component
 * test because each component is individually correct. So this file asserts the
 * actual widths and `test/golden/time.json` pins them, rather than restating the
 * constants and proving nothing.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fc from 'fast-check';
import {
  SPEEDS,
  isSpeedName,
  setSpeed,
  tickSeconds,
  ticksToMs,
  TICKS_PER_RECKONING,
  COMMITMENT_WINDOW_TICKS,
  FREEZE_TICKS,
  SETTLEMENT_PHASE,
  FREEZE_FIRST_PHASE,
  WINDOW_FIRST_PHASE,
  WAKES_PER_RECKONING,
  ACTIONS_PER_TICK,
  GATE_TRANSIT,
  HAND_RECOVERY_TICKS,
  phaseOfReckoning,
  reckoningIndex,
  ticksUntilReckoning,
  inCommitmentWindow,
  inFreeze,
  isSettlementTick,
  fixedClock,
  systemClock,
} from '../../src/core/time.js';
import type { Clock } from '../../src/core/time.js';
import { loadTimeGolden } from '../golden/load.js';

const golden = loadTimeGolden();

/** Every speed sets module-level state; leaving it set would poison later tests in this file. */
afterEach(() => {
  setSpeed('instant');
});

/** Ticks worth checking: two cycles either side of zero, the boundaries, and a far-future tick. */
function interestingTicks(): number[] {
  const out = new Set<number>();
  for (let t = -2 * TICKS_PER_RECKONING; t <= 3 * TICKS_PER_RECKONING; t++) out.add(t);
  for (const base of [288_000_000, -288_000_000, Number.MAX_SAFE_INTEGER - 1_000]) {
    for (let d = -2; d <= 2; d++) out.add(base + d);
  }
  return [...out];
}

describe('the cycle is total and non-overlapping', () => {
  it('phaseOfReckoning is always 0..TICKS_PER_RECKONING-1, including for negative ticks', () => {
    // A negative tick is not hypothetical: a season boundary or a replay offset can
    // produce one, and JavaScript's % returns a negative result for a negative
    // operand. The double-modulo in phaseOfReckoning is what stops that.
    for (const t of interestingTicks()) {
      const p = phaseOfReckoning(t);
      expect(Number.isSafeInteger(p), `tick ${t}`).toBe(true);
      expect(p, `tick ${t}`).toBeGreaterThanOrEqual(0);
      expect(p, `tick ${t}`).toBeLessThan(TICKS_PER_RECKONING);
    }
  });

  it('reckoningIndex and phaseOfReckoning reconstruct the tick exactly', () => {
    for (const t of interestingTicks()) {
      expect(reckoningIndex(t) * TICKS_PER_RECKONING + phaseOfReckoning(t), `tick ${t}`).toBe(t);
    }
  });

  it('the phase is periodic with the Reckoning', () => {
    for (const t of interestingTicks()) {
      expect(phaseOfReckoning(t + TICKS_PER_RECKONING)).toBe(phaseOfReckoning(t));
      expect(phaseOfReckoning(t - TICKS_PER_RECKONING)).toBe(phaseOfReckoning(t));
      expect(reckoningIndex(t + TICKS_PER_RECKONING)).toBe(reckoningIndex(t) + 1);
    }
  });

  it('ticksUntilReckoning is 1..TICKS_PER_RECKONING and counts down by one per tick', () => {
    // Scar #14: a countdown that goes backwards. This is the engine-side guarantee
    // the agent-facing countdown is derived from.
    for (const t of interestingTicks()) {
      const left = ticksUntilReckoning(t);
      expect(left, `tick ${t}`).toBeGreaterThanOrEqual(1);
      expect(left, `tick ${t}`).toBeLessThanOrEqual(TICKS_PER_RECKONING);
      const next = ticksUntilReckoning(t + 1);
      expect(next === left - 1 || (left === 1 && next === TICKS_PER_RECKONING), `tick ${t}`).toBe(
        true,
      );
    }
  });

  it('the three windows tile the cycle exactly once, with no overlap', () => {
    // Quiet, commitment, freeze. Every tick is in exactly one, and the counts sum
    // to the cycle — the arithmetic version of "no tick is in an undefined state".
    // Four parts, counted separately. An earlier version folded settlement into
    // `quiet` and then subtracted it in the expected value, which made an off-by-one
    // in either place cancel out — the shape of mistake this test exists to catch.
    let quiet = 0;
    let commitment = 0;
    let freeze = 0;
    let settlement = 0;
    for (let phase = 0; phase < TICKS_PER_RECKONING; phase++) {
      const c = inCommitmentWindow(phase);
      const f = inFreeze(phase);
      const t = isSettlementTick(phase);
      // Every pair is mutually exclusive, asserted rather than assumed: the bug this
      // replaced was exactly two of these being true at once.
      expect(c && f, `phase ${phase} is in both the window and the freeze`).toBe(false);
      expect(f && t, `phase ${phase} is both freeze and settlement`).toBe(false);
      expect(c && t, `phase ${phase} is both window and settlement`).toBe(false);
      if (t) settlement += 1;
      else if (f) freeze += 1;
      else if (c) commitment += 1;
      else quiet += 1;
    }
    expect(quiet + commitment + freeze + settlement).toBe(TICKS_PER_RECKONING);
    expect(settlement).toBe(1);
    expect(freeze).toBe(FREEZE_TICKS);
    // A FULL COMMITMENT_WINDOW_TICKS, and the freeze sits outside it rather than
    // eating its last tick. The previous version asserted 23 with a comment reasoning
    // that "the freeze tick falls inside the last 24 ticks and is excluded" — a
    // plausible-sounding justification for what was actually an off-by-one, and one
    // that would have drifted straight into agent-facing text.
    expect(commitment).toBe(COMMITMENT_WINDOW_TICKS);
    expect(quiet).toBe(TICKS_PER_RECKONING - COMMITMENT_WINDOW_TICKS - FREEZE_TICKS - 1);
  });

  it('the windows are contiguous and sit at the end of the cycle', () => {
    const phases = Array.from({ length: TICKS_PER_RECKONING }, (_, i) => i);
    const commitment = phases.filter((p) => inCommitmentWindow(p));
    const freeze = phases.filter((p) => inFreeze(p));
    // Derived from the declared constants, never hardcoded. The previous version
    // pinned 264..286 and freeze [287], which encoded TWO bugs at once: the freeze
    // coinciding with settlement, and a commitment window of 23 ticks while
    // COMMITMENT_WINDOW_TICKS declared 24. Hardcoded phase numbers are how a window
    // silently stops matching the constant that names its length.
    expect(commitment.length).toBe(COMMITMENT_WINDOW_TICKS);
    expect(commitment[0]).toBe(WINDOW_FIRST_PHASE);
    expect(commitment[commitment.length - 1]).toBe(FREEZE_FIRST_PHASE - 1);
    expect(commitment.every((p, i) => i === 0 || p === commitment[i - 1]! + 1)).toBe(true);
    expect(freeze.length).toBe(FREEZE_TICKS);
    expect(freeze[0]).toBe(FREEZE_FIRST_PHASE);
    // The three are adjacent: window ends where freeze begins, freeze ends where
    // settlement is.
    expect(freeze[freeze.length - 1]).toBe(SETTLEMENT_PHASE - 1);
  });

  it('the freeze tick is strictly BEFORE the settlement tick, so the interval exists', () => {
    // This test used to assert the OPPOSITE, with a comment reasoning that "settlement
    // happens at the close of the freeze tick, so they coincide today". That reading is
    // not what SPEC §5.1 says — "**Freeze** (last tick *before* settlement)" — and the
    // consequence was found by a wave-3 verifier: with the two coinciding, INV-18
    // ("between freeze and settlement, zero events touch the settlement set") ranged
    // over an EMPTY interval, so §15.4's defence-in-depth against a fabricated default
    // was unenforceable anywhere in the wired engine. It also made the contract
    // unimplementable: a phase asked to honour the freeze against the settlement set
    // could not, because the set did not exist yet when it ran.
    //
    // Worth keeping the history in view: a pinning test can enshrine a misreading, and
    // this one did, complete with a plausible justification.
    for (const t of interestingTicks()) {
      expect(inFreeze(t) && isSettlementTick(t), `tick ${t} is both`).toBe(false);
    }
    // And the freeze really does immediately precede settlement, rather than merely
    // being disjoint from it.
    for (const t of interestingTicks()) {
      if (!isSettlementTick(t)) continue;
      expect(inFreeze(t - 1), `the tick before settlement tick ${t}`).toBe(true);
    }
  });

  it('exactly one settlement per Reckoning, no more and no fewer', () => {
    // A14: the Reckoning cannot be dodged into quiet. Two settlements in a cycle
    // would double-charge the Levy; zero would silently skip it.
    for (let cycle = -2; cycle <= 3; cycle++) {
      let count = 0;
      for (let phase = 0; phase < TICKS_PER_RECKONING; phase++) {
        if (isSettlementTick(cycle * TICKS_PER_RECKONING + phase)) count += 1;
      }
      expect(count, `cycle ${cycle}`).toBe(1);
    }
  });

  it('holds for arbitrary ticks, not just the ones chosen by hand', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }),
        (t) => {
          const p = phaseOfReckoning(t);
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThan(TICKS_PER_RECKONING);
          expect(reckoningIndex(t) * TICKS_PER_RECKONING + p).toBe(t);
          expect(ticksUntilReckoning(t)).toBe(TICKS_PER_RECKONING - p);
          // All three pairwise disjoint, for every tick including negative ones.
          expect(inCommitmentWindow(t) && inFreeze(t)).toBe(false);
          expect(inFreeze(t) && isSettlementTick(t)).toBe(false);
          expect(inCommitmentWindow(t) && isSettlementTick(t)).toBe(false);
          // And the freeze immediately precedes settlement, everywhere.
          expect(inFreeze(t - 1)).toBe(isSettlementTick(t));
          // The predicates depend on the phase alone, never on the cycle.
          expect(inCommitmentWindow(t)).toBe(inCommitmentWindow(p));
          expect(inFreeze(t)).toBe(inFreeze(p));
          expect(isSettlementTick(t)).toBe(isSettlementTick(p));
        },
      ),
      { numRuns: 3000 },
    );
  });
});

describe('time.json pins the agent-facing windows', () => {
  it('the constants match the golden', () => {
    expect(golden.ticksPerReckoning).toBe(TICKS_PER_RECKONING);
    expect(golden.commitmentWindowTicksConstant).toBe(COMMITMENT_WINDOW_TICKS);
    expect(golden.freezeTicksConstant).toBe(FREEZE_TICKS);
  });

  it('the phase bands match the golden', () => {
    const measured = new Map<string, { first: number; last: number; count: number }>();
    const bands: Record<string, number[]> = { quiet: [], commitment: [], freeze: [], settlement: [] };
    // Four exclusive bands. The earlier version tested settlement with a SEPARATE
    // `if`, so the settlement tick was counted in `quiet` as well — which is how the
    // golden could record quiet as 0..287 while also recording settlement at 287, and
    // why the old off-by-one had somewhere to hide.
    for (let phase = 0; phase < TICKS_PER_RECKONING; phase++) {
      if (isSettlementTick(phase)) bands.settlement!.push(phase);
      else if (inFreeze(phase)) bands.freeze!.push(phase);
      else if (inCommitmentWindow(phase)) bands.commitment!.push(phase);
      else bands.quiet!.push(phase);
    }
    for (const [name, list] of Object.entries(bands)) {
      measured.set(name, { first: list[0]!, last: list[list.length - 1]!, count: list.length });
    }
    expect([...golden.bands.keys()].sort((a, b) => (a < b ? -1 : 1))).toEqual(
      [...measured.keys()].sort((a, b) => (a < b ? -1 : 1)),
    );
    for (const [name, band] of golden.bands) {
      expect(measured.get(name), name).toEqual(band);
    }
  });

  it('every golden spot tick still resolves the same way', () => {
    expect(golden.spots.length).toBeGreaterThanOrEqual(10);
    for (const s of golden.spots) {
      expect(phaseOfReckoning(s.tick), `tick ${s.tick} phase`).toBe(s.phase);
      expect(inCommitmentWindow(s.tick), `tick ${s.tick} commitment`).toBe(s.inCommitmentWindow);
      expect(inFreeze(s.tick), `tick ${s.tick} freeze`).toBe(s.inFreeze);
      expect(isSettlementTick(s.tick), `tick ${s.tick} settlement`).toBe(s.isSettlementTick);
    }
  });
});

describe('DET-8 — durations are in ticks, and only tickSeconds converts', () => {
  it('the default speed is instant, so a test that forgets to set one has no wall clock', () => {
    expect(tickSeconds()).toBe(SPEEDS.instant);
    expect(SPEEDS.instant).toBe(0);
  });

  it('every named speed is reachable and isSpeedName agrees with the table', () => {
    for (const name of Object.keys(SPEEDS)) {
      expect(isSpeedName(name)).toBe(true);
      setSpeed(name as keyof typeof SPEEDS);
      expect(tickSeconds()).toBe(SPEEDS[name as keyof typeof SPEEDS]);
    }
    for (const notASpeed of ['', 'PROD', 'slow', 'toString', 'constructor', '__proto__']) {
      // 'toString' and '__proto__' matter: a prototype-chain check instead of
      // hasOwnProperty would accept them and setSpeed would read undefined.
      expect(isSpeedName(notASpeed), notASpeed).toBe(false);
    }
  });

  it('ticksToMs scales with the speed and with nothing else', () => {
    setSpeed('instant');
    expect(ticksToMs(0)).toBe(0);
    expect(ticksToMs(288)).toBe(0);

    setSpeed('fast');
    expect(tickSeconds()).toBe(10);
    expect(ticksToMs(1)).toBe(10_000);
    // A whole Reckoning at `fast`: 288 ticks x 10 s = 48 minutes.
    expect(ticksToMs(TICKS_PER_RECKONING)).toBe(288 * 10 * 1000);

    setSpeed('prod');
    expect(tickSeconds()).toBe(300);
    // And at prod a Reckoning is a day, which is the claim SPEC §5 makes.
    expect(ticksToMs(TICKS_PER_RECKONING)).toBe(24 * 60 * 60 * 1000);
  });

  it('ticksToMs is linear, so any derived duration scales with the clock', () => {
    setSpeed('rehearsal');
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        (a, b) => {
          expect(ticksToMs(a + b)).toBe(ticksToMs(a) + ticksToMs(b));
        },
      ),
      { numRuns: 300 },
    );
  });

  it('ticksToMs refuses a negative or fractional tick count', () => {
    for (const bad of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => ticksToMs(bad), String(bad)).toThrow(/non-negative integer/);
    }
  });

  it('the five speeds are ordered and prod is the slowest', () => {
    // TESTING.md §1.2: A4 is a wall-clock property and may only be measured at
    // prod. If another speed were slower, the compression ratios in that document
    // would be wrong.
    const values = [SPEEDS.instant, SPEEDS.turbo, SPEEDS.fast, SPEEDS.rehearsal, SPEEDS.prod];
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(SPEEDS.prod).toBe(300);
  });
});

describe('the parameters SPEC §17 calls load-bearing are expressed in ticks', () => {
  it('gate transit and hand recovery are inclusive tick ranges with min <= max', () => {
    for (const [name, r] of Object.entries({
      intraConstellation: GATE_TRANSIT.intraConstellation,
      interConstellation: GATE_TRANSIT.interConstellation,
      handRecovery: HAND_RECOVERY_TICKS,
    })) {
      expect(Number.isSafeInteger(r.min), name).toBe(true);
      expect(Number.isSafeInteger(r.max), name).toBe(true);
      expect(r.min, name).toBeGreaterThan(0);
      expect(r.min, name).toBeLessThanOrEqual(r.max);
    }
    // Inter-constellation transit must cost more than intra, or the map has no
    // geography and distance stops being a constraint.
    expect(GATE_TRANSIT.interConstellation.min).toBeGreaterThan(
      GATE_TRANSIT.intraConstellation.max,
    );
  });

  it('the budgets match SPEC §17 and are small enough that they bind', () => {
    // A4: never let requests-per-second be power. These two numbers are the whole
    // of that guarantee on the engine side.
    expect(ACTIONS_PER_TICK).toBe(4);
    expect(WAKES_PER_RECKONING).toBe(16);
    expect(WAKES_PER_RECKONING).toBeLessThan(TICKS_PER_RECKONING);
  });

  it('a whole transit and a whole recovery still fit inside a Reckoning', () => {
    // Otherwise a hand lost early in a cycle could not be back for the next one,
    // and "loss is time, never capacity" would quietly become capacity.
    expect(GATE_TRANSIT.interConstellation.max).toBeLessThan(TICKS_PER_RECKONING);
    expect(HAND_RECOVERY_TICKS.max).toBeLessThan(TICKS_PER_RECKONING);
  });
});

describe('the clock is injected, never read', () => {
  it('fixedClock returns exactly what it was given', () => {
    const clock: Clock = fixedClock(1_700_000_000_000);
    expect(clock.nowMs()).toBe(1_700_000_000_000);
    expect(clock.nowMs()).toBe(1_700_000_000_000);
  });

  it('fixedClock advances only when a test asks it to', () => {
    const clock = fixedClock(0) as Clock & { advance(ms: number): void };
    expect(clock.nowMs()).toBe(0);
    clock.advance(ticksToMs(0));
    expect(clock.nowMs()).toBe(0);
    setSpeed('fast');
    clock.advance(ticksToMs(3));
    expect(clock.nowMs()).toBe(30_000);
  });

  it('systemClock is a Clock and is the only reader of real time', () => {
    // Called, not compared: asserting anything about the value would make this
    // test the one nondeterministic thing in the suite.
    const clock = systemClock();
    const t = clock.nowMs();
    expect(Number.isFinite(t)).toBe(true);
    expect(t).toBeGreaterThan(0);
    expect(clock.nowMs()).toBeGreaterThanOrEqual(t);
  });
});
