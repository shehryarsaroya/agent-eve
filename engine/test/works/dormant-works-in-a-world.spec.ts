/**
 * ★ **DORMANT, PLAYED THROUGH A WORLD NOBODY STEERS** (`RULES_VERSION` 41).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `dormant-works.spec.ts` proves the arithmetic against the book. This proves the claim the rule was
 * written for, in a seeded heuristic world with the cast running: two outside principals raise WORKS
 * on one Commons system; one keeps playing (a public `claim` once a Reckoning — any accepted action
 * counts), the other goes silent after its build. Then:
 *
 *   1. before the lease runs out, both divide the yield;
 *   2. from the first tick of the fifth Reckoning the silent one's WORKS is DORMANT — it extracts
 *      nothing, the one still playing takes the share it used to divide, the frame draws it DORMANT
 *      with the tick it stopped, and both observations say so (A9);
 *   3. nothing was confiscated — the WORKS stands, unrazed, with its history;
 *   4. the silent principal sends one act, and its WORKS extracts again **the tick after** — not the
 *      tick it acted, because production at T reads the world as T's window froze it.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import { buildObservation } from '../../src/api/observe.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { commonsSystems } from '../../src/world/index.js';
import { systemYield, WORKS_DORMANT_AFTER_TICKS, WORKS_SPINUP_TICKS } from '../../src/works/params.js';

type Row = Record<string, unknown>;

const AWAKE = 'p:keeps-playing' as PrincipalId;
const ASLEEP = 'p:went-quiet' as PrincipalId;

let sequence = 0;
function submit(runtime: Runtime, principal: PrincipalId, verb: string, params: Row): void {
  sequence += 1;
  const out = runtime.engine.submit({
    principal,
    verb,
    params,
    clientSequence: 5_000 + sequence,
    arrivalMs: 0,
    decisionSource: 'LIVE',
  });
  if (!out.ok) throw new Error(`${verb} refused at the door: ${out.invariant} ${out.hint}`);
}

function observe(runtime: Runtime, principal: PrincipalId): Row {
  return buildObservation({
    runtime,
    principal,
    serverNowMs: 0,
    fresh: true,
    wakesRemaining: 16,
    stale: false,
    corrections: [],
    correctionsDropped: 0,
    actionsRemaining: 4,
  }) as unknown as Row;
}

describe('a heuristic world: a dormant WORKS frees its share for its neighbour and resumes on return', () => {
  it('★ splits, goes DORMANT on the fifth Reckoning, gives the neighbour the yield, and resumes the tick after', () => {
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'dormant-world' });
    const cast = new HeuristicCast(runtime, { size: 8 });
    cast.seat('dormant-world');
    const stage = commonsSystems(runtime.world.map)[2] as SystemId;
    runtime.seat(AWAKE, 'keeps-playing', stage);
    runtime.seat(ASLEEP, 'went-quiet', stage);
    runtime.standing.open(AWAKE);
    runtime.standing.open(ASLEEP);

    const step = (extra?: () => void): void => {
      const next = runtime.engine.tick + 1;
      for (const action of cast.decide(next, 'dormant-world')) runtime.engine.submit(action);
      extra?.();
      const report = runtime.runTick();
      if (report.halted) {
        throw new Error(`halted at ${String(report.tick)}: ${report.violations.map((v) => v.message).join(' | ')}`);
      }
    };

    step();
    step(() => {
      submit(runtime, AWAKE, 'build', { kind: 'WORKS', system: stage });
      submit(runtime, ASLEEP, 'build', { kind: 'WORKS', system: stage });
    });
    const builtAt = runtime.engine.tick;
    const mine = (p: PrincipalId) => runtime.works.ofPrincipal(p).find((w) => w.system === stage);
    expect(mine(AWAKE), 'non-vacuity: the awake principal raised a WORKS').toBeDefined();
    expect(mine(ASLEEP), 'non-vacuity: the quiet principal raised a WORKS').toBeDefined();

    const yieldHere = systemYield(runtime.world.map, stage);
    const shareOf = (p: PrincipalId, tick: number): number => {
      const w = mine(p);
      return w === undefined ? 0 : (runtime.works.sharesAt(stage, yieldHere, tick).get(w.id) ?? 0);
    };
    const totalAt = (tick: number): number =>
      [...runtime.works.sharesAt(stage, yieldHere, tick).values()].reduce((a, b) => a + b, 0);

    // ── 1. BOTH DIVIDE, WHILE BOTH ARE FRESH ──────────────────────────────
    while (runtime.engine.tick < builtAt + WORKS_SPINUP_TICKS + 30) step();
    const early = runtime.engine.tick + 1;
    expect(shareOf(ASLEEP, early), 'non-vacuity: the quiet principal shares while fresh').toBeGreaterThan(0);
    const awakeShareShared = shareOf(AWAKE, early);
    expect(awakeShareShared).toBeGreaterThan(0);
    expect(totalAt(early), 'A15: the place yields what it yields').toBe(yieldHere);

    // ── PLAY ON: the awake one speaks once a Reckoning; the quiet one sends nothing ──
    const dormantFrom = builtAt + WORKS_DORMANT_AFTER_TICKS;
    while (runtime.engine.tick < dormantFrom + 5) {
      const now = runtime.engine.tick + 1;
      step(now % TICKS_PER_RECKONING === 7 ? () => submit(runtime, AWAKE, 'claim', { text: 'still here' }) : undefined);
    }

    // ── 2. DORMANT: it divides nothing, the neighbour takes the share ──────
    const late = runtime.engine.tick + 1;
    expect(runtime.works.isDormant(ASLEEP, late), 'the quiet principal is DORMANT').toBe(true);
    expect(runtime.works.isDormant(AWAKE, late), 'the one still playing is not').toBe(false);
    expect(shareOf(ASLEEP, late), 'a DORMANT WORKS takes no share').toBe(0);
    expect(
      shareOf(AWAKE, late),
      'REGRESSION: the neighbour still divides the yield with a WORKS whose holder left',
    ).toBeGreaterThan(awakeShareShared);
    expect(totalAt(late), 'A15: and the place still yields exactly what it yields').toBe(yieldHere);

    // The extraction counter really stopped — not just the forecast.
    const frozen = mine(ASLEEP)?.extracted ?? -1;
    step(() => submit(runtime, AWAKE, 'claim', { text: 'and still here' }));
    step();
    expect(mine(ASLEEP)?.extracted, 'a DORMANT WORKS extracts nothing').toBe(frozen);

    // The frame draws it (A13), and states the tick it stopped.
    const line = runtime.worksLines(runtime.engine.tick).find((w) => w.holder === ASLEEP && w.system === stage);
    expect(line?.legend).toBe('DORMANT');
    expect(line?.sharePerTick).toBe(0);
    expect(line?.dormantSinceTick).toBe(dormantFrom);
    const neighbour = runtime.worksLines(runtime.engine.tick).find((w) => w.holder === AWAKE && w.system === stage);
    expect(neighbour?.legend).toBe('EXTRACTING');
    expect(neighbour?.extractors, 'the divisor the frame states excludes the sleeper').toBeLessThan(neighbour?.occupants ?? 0);

    // Both observations say so (A9: the frame may not know more than an agent).
    const quiet = observe(runtime, ASLEEP);
    const held = ((quiet['holding'] as Row)['works'] as Row)['held'] as Row[];
    expect(held.find((w) => w['system'] === stage)?.['dormant']).toBe(true);
    expect(String((quiet['briefing'] as Row)['prompt'])).toContain('DORMANT');
    const awake = observe(runtime, AWAKE);
    const here = ((awake['holding'] as Row)['works'] as Row)['here'] as Row;
    expect(here['dormant_by'] as PrincipalId[]).toContain(ASLEEP);

    // ── 3. NOTHING CONFISCATED ─────────────────────────────────────────────
    expect(mine(ASLEEP)?.razed).toBe(false);
    expect(runtime.world.holdingByPrincipal.get(ASLEEP)).toBeDefined();
    expect(frozen, 'its history is kept').toBeGreaterThan(0);

    // ── 4. ONE ACT, AND IT WORKS AGAIN THE TICK AFTER ──────────────────────
    step(() => submit(runtime, ASLEEP, 'claim', { text: 'back' }));
    expect(mine(ASLEEP)?.extracted, 'not the tick it acted: production read the frozen window').toBe(frozen);
    step();
    expect(mine(ASLEEP)?.extracted ?? 0, 'the tick after, it extracts again').toBeGreaterThan(frozen);
    const after = runtime.engine.tick + 1;
    expect(runtime.works.isDormant(ASLEEP, after)).toBe(false);
    expect(shareOf(ASLEEP, after)).toBeGreaterThan(0);
    expect(totalAt(after)).toBe(yieldHere);
    // A world of 1,200 ticks with a cast of eight; slow on a loaded machine, hence the bound.
  }, 1_500_000);
});
