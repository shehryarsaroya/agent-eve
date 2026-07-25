/**
 * §7.4's output function: marginal output by role, duplicate-role diminishing returns,
 * the bottleneck report, and the seeded bounded residual.
 *
 * The residual is the only randomness a venture touches, so it is the only place a
 * venture can break DET-1. It is drawn from an `Rng` sub-stream keyed on the venture
 * id, which is what stops a consumer added elsewhere in the tick from shifting it —
 * "inserting a single `rng.int()` anywhere silently changes every downstream outcome
 * and every golden file, a change that looks like a balance regression."
 */

import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng.js';
import { BPS_ONE, bps } from '../../src/core/units.js';
import {
  DUPLICATE_ROLE_DIVISOR,
  negBps,
  NEUTRAL_STAGE_BPS,
  ProceedsError,
  VENTURE_KINDS,
  computeOutputBps,
  computeProceeds,
  drawResidual,
  kindSpec,
  proceedsBand,
  residualAtPercentile,
  type RoleSpec,
} from '../../src/venture/index.js';
import { vid } from './fixture.js';

describe('marginal output by role', () => {
  it('is the sum over filled roles, and the order it is given does not matter', () => {
    const roles = kindSpec('SIEGE').roles;
    expect(computeOutputBps(roles, [0, 1, 2, 3])).toBe(BPS_ONE);
    expect(computeOutputBps(roles, [3, 1, 0, 2])).toBe(BPS_ONE);
    expect(computeOutputBps(roles, [])).toBe(0);
  });

  it('ignores duplicate indices in the filled list', () => {
    const roles = kindSpec('HAUL').roles;
    expect(computeOutputBps(roles, [0, 0, 0])).toBe(computeOutputBps(roles, [0]));
  });

  it('halves a duplicate label, in role-index order', () => {
    // §7.4's "duplicate-role diminishing returns". Inert for the shipped table — no kind
    // repeats a label — so it is tested against a synthetic template, because a rule that
    // only runs on data nobody has is a rule nobody has tested.
    const template: readonly RoleSpec[] = [
      { label: 'CARRIER', marginalOutputBps: bps(4_000) },
      { label: 'CARRIER', marginalOutputBps: bps(4_000) },
      { label: 'CARRIER', marginalOutputBps: bps(2_000) },
    ];
    // First 4000 in full, second 4000 halved, third 2000 quartered.
    expect(computeOutputBps(template, [0, 1, 2])).toBe(4_000 + 2_000 + 500);
    // The *earliest index* is the one that counts fully, whichever order the fills
    // arrived in — otherwise the yield would depend on arrival (DET-2).
    expect(computeOutputBps(template, [2, 1, 0])).toBe(4_000 + 2_000 + 500);
    expect(DUPLICATE_ROLE_DIVISOR).toBe(2);
  });

  it('cannot exceed 10000 bps for any kind and any fill set', () => {
    for (const kind of VENTURE_KINDS) {
      const roles = kindSpec(kind).roles;
      const all = roles.map((_, i) => i);
      expect(computeOutputBps(roles, all), kind).toBeLessThanOrEqual(BPS_ONE);
    }
  });

  it('refuses a role index the kind does not have', () => {
    expect(() =>
      computeProceeds({ kind: 'HAUL', filled: [7], stageBps: NEUTRAL_STAGE_BPS, residualSignedBps: 0 }),
    ).toThrow(ProceedsError);
  });
});

describe('the bottleneck report (§7.4)', () => {
  it('names the open role that costs the most', () => {
    const siege = computeProceeds({
      kind: 'SIEGE',
      filled: [1, 2, 3],
      stageBps: NEUTRAL_STAGE_BPS,
      residualSignedBps: 0,
    });
    expect(siege.bottleneck?.label).toBe('BREAKER');
    expect(siege.bottleneck?.forgoneBps).toBe(4_000);
  });

  it('breaks a tie toward the earliest role index, so a card reads the same twice', () => {
    const build = computeProceeds({
      kind: 'BUILD',
      filled: [0],
      stageBps: NEUTRAL_STAGE_BPS,
      residualSignedBps: 0,
    });
    // CARRIER, FACTOR and TALLYMAN are all 2000 bps; the first open one wins.
    expect(build.bottleneck?.roleIndex).toBe(1);
  });

  it('is null at a full fill, and fullFill says so', () => {
    for (const kind of VENTURE_KINDS) {
      const all = kindSpec(kind).roles.map((_, i) => i);
      const p = computeProceeds({ kind, filled: all, stageBps: NEUTRAL_STAGE_BPS, residualSignedBps: 0 });
      expect(p.bottleneck, kind).toBeNull();
      expect(p.fullFill, kind).toBe(true);
      expect(p.proceeds, kind).toBe(kindSpec(kind).baseYieldMinor);
    }
  });
});

describe('the seeded bounded residual', () => {
  it('is reproducible from the same seed and the same venture id (DET-1)', () => {
    const a = drawResidual('HAUL', vid('v-1'), Rng.fromSeed('tick:100'));
    const b = drawResidual('HAUL', vid('v-1'), Rng.fromSeed('tick:100'));
    expect(b).toBe(a);
  });

  it('is independent per venture, so adding a consumer cannot shift another draw', () => {
    // `Rng.derive` gives each venture its own sub-stream. Without it, inserting one
    // `rng.int()` anywhere in the tick would change every venture's yield at once.
    const shared = Rng.fromSeed('tick:100');
    const first = drawResidual('HAUL', vid('v-1'), shared);
    const second = drawResidual('HAUL', vid('v-2'), shared);
    // The parent stream is untouched by a derive, so the order of the two calls does not
    // matter either.
    const shuffled = Rng.fromSeed('tick:100');
    expect(drawResidual('HAUL', vid('v-2'), shuffled)).toBe(second);
    expect(drawResidual('HAUL', vid('v-1'), shuffled)).toBe(first);
  });

  it('stays inside the kind band across 500 draws', () => {
    const band = kindSpec('RAID').residualBandBps;
    for (let i = 0; i < 500; i += 1) {
      const draw = drawResidual('RAID', vid(`v-${String(i)}`), Rng.fromSeed('tick:7'));
      expect(Math.abs(draw)).toBeLessThanOrEqual(band);
      // Every draw is a legal input to the proceeds function, which re-checks the band.
      expect(() =>
        computeProceeds({
          kind: 'RAID',
          filled: [0, 1],
          stageBps: NEUTRAL_STAGE_BPS,
          residualSignedBps: draw,
        }),
      ).not.toThrow();
    }
  });

  it('actually varies — a band that never moves is an inert mechanic', () => {
    const draws = new Set<number>();
    for (let i = 0; i < 60; i += 1) {
      draws.add(drawResidual('RAID', vid(`v-${String(i)}`), Rng.fromSeed('tick:9')));
    }
    expect(draws.size).toBeGreaterThan(10);
  });

  it('consumes nothing from the parent stream', () => {
    // The mechanism behind the independence above, asserted directly: `derive` seeds a
    // fresh generator from the parent's *state* without advancing it, so a venture's
    // residual draw cannot shift what any other phase of the tick sees.
    const rng = Rng.fromSeed('tick:11');
    const before = rng.draws;
    drawResidual('HAUL', vid('v-1'), rng);
    drawResidual('SIEGE', vid('v-2'), rng);
    expect(rng.draws).toBe(before);
  });
});

describe('the p10/p50/p90 band', () => {
  it('is symmetric, with p50 at exactly zero residual', () => {
    for (const kind of VENTURE_KINDS) {
      expect(residualAtPercentile(kind, 'p50'), kind).toBe(0);
      expect(residualAtPercentile(kind, 'p10'), kind).toBe(negBps(kindSpec(kind).residualBandBps));
      expect(residualAtPercentile(kind, 'p90'), kind).toBe(kindSpec(kind).residualBandBps);
    }
  });

  it('is monotonic, and p50 is the base yield at a full fill', () => {
    for (const kind of VENTURE_KINDS) {
      const all = kindSpec(kind).roles.map((_, i) => i);
      const band = proceedsBand(kind, all);
      expect(band.p10, kind).toBeLessThanOrEqual(band.p50);
      expect(band.p50, kind).toBeLessThanOrEqual(band.p90);
      expect(band.p50, kind).toBe(kindSpec(kind).baseYieldMinor);
    }
  });
});
