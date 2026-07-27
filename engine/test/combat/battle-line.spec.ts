/**
 * ★ **THE BATTLE LINE RENDERS, AND CARRIES NOTHING §11.2 FORBIDS.**
 *
 * A13: *"No feature ships without a named pixel signature. If you cannot name the signature, the
 * feature is not ready."* And the scoring panel's finding on why that has to be a test rather than a
 * review item: *"mechanics bolted on to answer critics got their economics and their prose but neither
 * their pixels nor their arithmetic, and Legible scored lowest of all six dimensions as a direct
 * result."*
 *
 * So this file asserts two things a review cannot:
 *
 * 1. **A live battle appears on the frame**, with the fields a renderer needs to draw the picture the
 *    header of `book.ts` describes — the gap, the echelon rows, the bar heights, and the four overlays.
 * 2. **It carries no `SENSED` quantity.** The dangerous field is `ehpBps`, and the danger is precise:
 *    an *absolute* EHP divided by the hull count is the buffer, and a buffer names the tank modules. A
 *    fit is a manifest, and §11.2 says *"a ship at sea is visible; its manifest is not."*
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_BATTLE_FORMATIONS,
  MAX_FRAME_BATTLE_LINES,
  assertFrameBudgets,
  type BattleLine,
  type ReckoningFrame,
} from '../../src/frames/contract.js';
import { emptyFrame } from '../../src/frames/render.js';
import { HULL_COST_GOODS, battleLinesFor, battleTickerLine } from '../../src/combat/index.js';
import type { EventId, GoodId, PrincipalId, SystemId } from '../../src/core/types.js';
import { qty } from '../../src/core/units.js';
import { GOODS_FAUCET, storesAccount } from '../../src/ledger/index.js';
import type { Runtime } from '../../src/sim/runtime.js';
import { act, raidWorld, tick } from '../predation/fixture.js';

function stock(runtime: Runtime, principal: PrincipalId, system: SystemId, good: GoodId, amount: number): void {
  runtime.ledger.sourceGoods({
    eventId: `test.frame:${principal}:${good}` as EventId,
    tick: runtime.engine.tick,
    faucet: GOODS_FAUCET.PRODUCTION,
    to: storesAccount(principal),
    good,
    qty: qty(amount),
    location: system,
    origin: principal,
  });
}

/** A world with one battle running, driven entirely through the verbs. */
function worldWithABattle(seed: string): { readonly runtime: Runtime; readonly stage: SystemId } {
  const world = raidWorld(seed, 3);
  const raider = world.principals[0];
  const target = world.principals[1];
  if (raider === undefined || target === undefined) throw new Error('no pair');
  for (const principal of [raider, target]) {
    stock(world.runtime, principal, world.stage, HULL_COST_GOODS.frame, 12_000);
    stock(world.runtime, principal, world.stage, HULL_COST_GOODS.fuel, 3_000);
  }
  tick(world.runtime);
  for (const principal of [raider, target]) {
    act(world.runtime, principal, 'build', {
      kind: 'HULL',
      system: world.stage,
      hull: 'WARDEN',
      modules: ['MISSILE', 'MISSILE', 'SHIELD_EXTENDER', 'AFTERBURNER', 'DAMAGE_MOD'],
    });
  }
  for (let i = 0; i < 6; i += 1) tick(world.runtime);

  act(world.runtime, raider, 'demand', {
    principal: target,
    system: world.stage,
    good: HULL_COST_GOODS.frame,
    qty: 2_000,
  });
  const raid = world.runtime.raids.live()[0];
  if (raid === undefined) throw new Error('no raid');
  act(world.runtime, target, 'fight', { raid: raid.id, system: raid.stage });
  for (const principal of [raider, target]) {
    const hull = world.runtime.committableHulls(principal, world.stage)[0];
    if (hull === undefined) continue;
    act(world.runtime, principal, 'engage', {
      raid: raid.id,
      system: raid.stage,
      hull: hull.id,
      echelon: principal === raider ? 'MAIN' : 'SCREEN',
      posture: principal === raider ? 'CLOSE' : 'HOLD',
      primary: ['TACKLE', 'REPAIR', 'WEAKEST'],
      withdraw_below_bps: 3_000,
    });
  }
  return { runtime: world.runtime, stage: world.stage };
}

describe('★ the battle line renders', () => {
  it('carries a live battle with everything a renderer needs to draw it', () => {
    const { runtime, stage } = worldWithABattle('battle-line-1');
    const lines = battleLinesFor(runtime.battles, runtime.fleet, runtime.engine.tick, MAX_FRAME_BATTLE_LINES);
    expect(
      lines.length,
      'a battle that is running must appear on the frame. A mechanic with no pixel signature does not ' +
        'exist (A13), and the way that failure arrives is a projection nobody wired up.',
    ).toBeGreaterThan(0);

    const line = lines[0];
    if (line === undefined) throw new Error('no line');
    expect(line.stage, 'drawn at the stage the standoff named').toBe(stage);
    expect(line.raid, 'and linked to the standoff, because a battle never exists without one').not.toBe('');
    expect(
      line.gap,
      '**the motion.** The gap between the two lines is the range race and the most legible thing on the ' +
        'board — a brawler drags it shut, a kiter holds it open',
    ).toBeGreaterThanOrEqual(0);
    expect(line.rangeName, 'as a word too, so the client needs no lookup table').toMatch(
      /CONTACT|CLOSE|MID|LONG|EXTREME/,
    );
    expect(line.formations.length, 'both sides must have bars, or a viewer reads a massacre').toBeGreaterThanOrEqual(2);
    expect(
      new Set(line.formations.map((f) => f.side)).size,
      'and they must be on two different sides',
    ).toBe(2);
    expect(
      new Set(line.formations.map((f) => f.echelon)).size,
      'stacked in more than one echelon row here, which is what the four rows are FOR',
    ).toBeGreaterThan(1);
    for (const bar of line.formations) {
      expect(bar.hulls, 'bar width is a hull count').toBeGreaterThan(0);
      expect(bar.ehpBps, 'bar height is a fraction of full').toBeGreaterThanOrEqual(0);
      expect(bar.ehpBps).toBeLessThanOrEqual(10_000);
      expect(typeof bar.pinned, 'the chain overlay').toBe('boolean');
      expect(typeof bar.capOut, 'the dark bar overlay').toBe('boolean');
      expect(typeof bar.repairing, 'the tether overlay').toBe('boolean');
      expect(bar.roleTags, 'and the role glyph, earned from the fit').toBeInstanceOf(Array);
    }
    expect(line.fieldControl, 'a live battle has not published a winner yet').toBeNull();
  });

  it('★ carries no absolute EHP, because that is invertible into a fit (§11.2)', () => {
    // MUTATION: add `ehp: f.ehp` to `BattleFormationLine` in `battleLinesFor` and to the interface.
    // `tsc` is happy, every test but this one stays green, and the spectator feed quietly becomes an
    // intelligence service any agent can scrape — which §10 SHOULD-2 names as the thing that
    // "would make private scouting pointless". RED here.
    const { runtime } = worldWithABattle('battle-line-2');
    const lines = battleLinesFor(runtime.battles, runtime.fleet, runtime.engine.tick, MAX_FRAME_BATTLE_LINES);
    const line = lines[0];
    if (line === undefined) throw new Error('no line');

    const forbidden = /^(ehp|ehpFull|cap|capFull|fit|modules|alpha|tackledBy|webbedBps)$/;
    for (const bar of line.formations) {
      for (const key of Object.keys(bar)) {
        expect(
          forbidden.test(key),
          `the battle line carries "${key}", which is a SENSED quantity or a fit. An absolute EHP ` +
            'divided by the hull count IS the buffer, and a buffer names the tank modules — a fit is a ' +
            'manifest, and §11.2 says a ship at sea is visible while its manifest is not.',
        ).toBe(false);
      }
    }
    for (const key of Object.keys(line)) {
      expect(forbidden.test(key), `the battle line itself carries "${key}"`).toBe(false);
    }
  });

  it('the budget refuses an over-full frame and a gap outside the topology', () => {
    // A13 as arithmetic rather than as a review item. Both refusals matter: too many battles is a
    // screensaver, and a gap outside 0..4 is a client asked to draw two lines at a distance the rules
    // cannot express.
    const base = emptyFrame(0, 0, 'x');
    const bar = {
      formation: 'f',
      principal: 'p:one' as PrincipalId,
      side: 'RAIDER',
      hull: 'PIKE',
      hulls: 1,
      echelon: 'MAIN',
      posture: 'HOLD',
      ehpBps: 10_000,
      hullsLost: 0,
      pinned: false,
      capOut: false,
      withdrawn: false,
      repairing: false,
      roleTags: [] as readonly string[],
    };
    const one = (over: Partial<BattleLine> = {}): BattleLine => ({
      engagement: 'eng:x',
      raid: 'raid:1:0',
      stage: 'sys-1' as SystemId,
      state: 'CONTEST',
      gap: 2,
      rangeName: 'MID',
      ticksLeft: 4,
      fieldControl: null,
      formations: [bar],
      wrecks: [],
      ...over,
    });
    const withLines = (lines: readonly BattleLine[]): ReckoningFrame => ({ ...base, battleLines: lines });

    expect(() => {
      assertFrameBudgets(withLines([one()]));
    }, 'one legal battle line is fine').not.toThrow();
    expect(() => {
      assertFrameBudgets(withLines(Array.from({ length: MAX_FRAME_BATTLE_LINES + 1 }, () => one())));
    }, 'over the budget is a build failure, not a screensaver').toThrow(/battle lines/);
    expect(() => {
      assertFrameBudgets(withLines([one({ gap: 9 })]));
    }, 'a gap outside the five range cells is refused').toThrow(/gap/);
    expect(() => {
      assertFrameBudgets(withLines([one({ formations: [{ ...bar, ehpBps: 12_000 }] })]));
    }, 'and an ehpBps that is not a fraction is refused, because an absolute is invertible').toThrow(/ehpBps/);
    expect(() => {
      assertFrameBudgets(
        withLines([one({ formations: Array.from({ length: MAX_BATTLE_FORMATIONS + 1 }, () => bar) })]),
      );
    }, 'and too many bars in one battle').toThrow(/formation bars/);
    expect(() => {
      assertFrameBudgets(withLines([one({ state: 'AFTERMATH', ticksLeft: 0, fieldControl: null })]));
    }, 'a closed battle with no winner leaves the record silent about the one thing it must say').toThrow(
      /field control/,
    );
  });

  it('the ticker line is a ≤140-char sentence a stranger can read', () => {
    const { runtime } = worldWithABattle('battle-line-3');
    const record = runtime.battles.live()[0];
    if (record === undefined) throw new Error('no battle');
    const line = battleTickerLine(record);
    expect(line.length, '§14.5: one line, 140 chars, the export surface').toBeLessThanOrEqual(140);
    expect(line, 'and it names the state, the place and the hull counts').toMatch(
      /MUSTER|CONTACT|CONTEST|BREAK|AFTERMATH|holds/,
    );
    expect(line, 'with the range as a word').toMatch(/CONTACT|CLOSE|MID|LONG|EXTREME/);
  });
});
