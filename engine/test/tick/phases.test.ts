/**
 * The phase order, checked against SPEC §15.2 itself.
 *
 * The order is a rules surface, so it gets the same treatment §3's vocabulary gets:
 * the canon is *parsed out of the spec* rather than copied into the test. Scar #1
 * survived a full build and three critic passes because the engine and the
 * agent-facing text disagreed about one word, and a hand-copied list of fourteen
 * phase names is the same shape of hazard.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { COMMITMENT_WINDOW_TICKS, TICKS_PER_RECKONING } from '../../src/core/time.js';
import {
  Engine,
  assertPhaseOrder,
  PHASES,
  PHASE_NOTE,
  opensCommitmentWindowNext,
  phaseIndex,
  reckoningClock,
  UNBUILT_PHASES,
  type PhaseName,
} from '../../src/tick/index.js';
import { MOVE_PHASE_MUST_PRECEDE } from '../../src/world/index.js';
import { seatWorld } from './harness.js';

const SPEC = readFileSync(new URL('../../../docs/design/SPEC.md', import.meta.url), 'utf8');

/** §15.2's arrow chain, in the spec's own spelling and order. */
function specPhases(): readonly string[] {
  const line = SPEC.split('\n').find((l) => l.includes('FREEZE_QUEUE') && l.includes('→'));
  if (line === undefined) throw new Error('SPEC §15.2 phase chain not found — this guard cannot run');
  return [...line.matchAll(/`([A-Z][A-Z_+]*)`/g)].map((m) => m[1] ?? '');
}

describe('SPEC §15.2 — the fourteen phases', () => {
  it('parses a non-trivial chain out of the spec, so a silent parse failure cannot pass', () => {
    // The guard's own guard. A regex that matched nothing would make every
    // assertion below vacuously true.
    const parsed = specPhases();
    expect(parsed.length).toBe(14);
    expect(parsed[0]).toBe('FREEZE_QUEUE');
    expect(parsed[parsed.length - 1]).toBe('WAKE');
  });

  it('the engine pipeline is byte-identical to the spec chain, in order', () => {
    // Not a set comparison. The order *is* the rule: inserting a phase shifts every
    // seeded draw and every golden file.
    expect([...PHASES]).toEqual([...specPhases()]);
  });

  it('keeps the spec spelling of VALIDATE+LOCK, so one phase does not get two names', () => {
    expect(PHASES).toContain('VALIDATE+LOCK');
    expect(PHASES as readonly string[]).not.toContain('VALIDATE_LOCK');
  });

  it('MOVE precedes every phase the world module says it must', () => {
    // The list comes from src/world/movement.ts, so the two modules cannot drift
    // apart about which phases depend on arrivals having resolved.
    expect(MOVE_PHASE_MUST_PRECEDE.length).toBeGreaterThan(0);
    for (const after of MOVE_PHASE_MUST_PRECEDE) {
      expect(PHASES as readonly string[]).toContain(after);
      expect(phaseIndex(after as PhaseName)).toBeGreaterThan(phaseIndex('MOVE'));
    }
  });

  it('clears before it produces, derives before it asserts, asserts before it commits', () => {
    expect(phaseIndex('MARKETS')).toBeLessThan(phaseIndex('PRODUCE'));
    expect(phaseIndex('DERIVE')).toBeLessThan(phaseIndex('ASSERT'));
    expect(phaseIndex('ASSERT')).toBeLessThan(phaseIndex('COMMIT'));
    expect(phaseIndex('EXPIRE')).toBeLessThan(phaseIndex('VALIDATE+LOCK'));
    expect(() => {
      assertPhaseOrder();
    }).not.toThrow();
  });

  it('the three unbuilt phases are present as hooks, each naming what fills it', () => {
    // Omitting them would be the cheap option now and an expensive one later:
    // adding a phase changes the set of Rng.derive labels, so every golden file
    // downstream of the insertion moves.
    expect([...UNBUILT_PHASES]).toEqual(['PREDATE', 'MARKETS', 'PRODUCE']);
    for (const phase of UNBUILT_PHASES) {
      expect(PHASES as readonly string[]).toContain(phase);
      expect(PHASE_NOTE[phase]).toContain('NO-OP HOOK');
      // A hook with no stated owner becomes a hook nobody fills.
      expect(PHASE_NOTE[phase]).toMatch(/Filled (by|with)/);
    }
  });

  it('every phase carries a note, because a slot with no stated purpose is a slot that moves', () => {
    for (const phase of PHASES) {
      expect(PHASE_NOTE[phase].length, `${phase} has no note`).toBeGreaterThan(40);
    }
  });
});

describe('the tick owns the clock, and hands it to every phase', () => {
  it('derives the Reckoning position from core/time and never from a stored field', () => {
    // `core/time.ts` is the one home of the clock. A module that derived "is this the
    // freeze?" itself would be a second answer to a question INV-18 halts over.
    const first = reckoningClock(0);
    expect(first.reckoning).toBe(0);
    expect(first.ticksUntilReckoning).toBe(TICKS_PER_RECKONING);
    expect(first.inCommitmentWindow).toBe(false);
    expect(first.inFreeze).toBe(false);
    expect(first.isSettlementTick).toBe(false);

    const settlement = reckoningClock(TICKS_PER_RECKONING - 1);
    expect(settlement.isSettlementTick).toBe(true);
    expect(settlement.inFreeze).toBe(true);
    // The freeze is not in the commitment window: the window ends where it begins.
    expect(settlement.inCommitmentWindow).toBe(false);

    const window = reckoningClock(TICKS_PER_RECKONING - COMMITMENT_WINDOW_TICKS);
    expect(window.inCommitmentWindow).toBe(true);
    expect(window.inFreeze).toBe(false);
  });

  it('puts the clock on every phase context and on the report', () => {
    const { world } = seatWorld(2);
    const seen: string[] = [];
    const engine = new Engine({
      world,
      seed: 'clock',
      handlers: {
        PREDATE: (ctx) => seen.push(`${ctx.phase}:${String(ctx.clock.reckoning)}`),
        VENTURES: (ctx) => seen.push(`${ctx.phase}:${String(ctx.clock.isSettlementTick)}`),
      },
    });
    const report = engine.runTick();
    expect(seen).toEqual(['PREDATE:0', 'VENTURES:false']);
    expect(report.clock).toEqual(reckoningClock(report.tick));
  });

  it('offers every principal one Reckoning wake as the commitment window opens, before settlement', () => {
    // §5.1: "Every party to a resolving item is offered one wake **before** it
    // (logged); after one offer it resolves regardless."
    //
    // The tick this fires on is load-bearing. WAKE is the last phase, so a wake
    // offered at the settlement tick is a wake for the tick *after* the thing it was
    // about — the agent would be told to come and decide about a Reckoning that had
    // already happened. The first draft did exactly that, and this test found it.
    const opens = TICKS_PER_RECKONING - COMMITMENT_WINDOW_TICKS;
    expect(opensCommitmentWindowNext(opens - 1)).toBe(true);
    expect(opensCommitmentWindowNext(opens)).toBe(false);
    expect(opensCommitmentWindowNext(TICKS_PER_RECKONING - 1)).toBe(false);

    const { world, principals } = seatWorld(3);
    const engine = new Engine({ world, seed: 'wake-clock', startTick: opens - 3 });
    const early = engine.runTick();
    expect(early.clock.inCommitmentWindow).toBe(false);
    expect(early.wakesOffered).toBe(0);

    const offering = engine.runTick();
    expect(offering.tick).toBe(opens - 1);
    // Offered while the window is still closed, so the agent's next observation is
    // its first tick.
    expect(offering.clock.inCommitmentWindow).toBe(false);
    expect(offering.clock.isSettlementTick).toBe(false);
    expect(offering.wakesOffered).toBe(principals.length);

    const offers = engine.wakes.offers().filter((o) => o.cause === 'RECKONING');
    expect(offers.length).toBe(principals.length);
    expect(new Set(offers.map((o) => o.principal)).size).toBe(principals.length);
    // Every offer is stamped with the tick it was made in, not the next one — WAKE
    // runs after COMMIT, and deriving the tick from the published pointer made every
    // row a tick late and rolled the wake budget a Reckoning early.
    for (const offer of offers) expect(offer.tick).toBe(offering.tick);
    // And after one offer it resolves regardless: the pair is spent.
    for (const principal of principals) {
      const again = engine.wakes.offer(principal, offering.tick, 'RECKONING', 'r0');
      expect(again.granted).toBe(false);
      if (!again.granted) expect(again.why).toBe('ALREADY_OFFERED');
    }
    // The window then opens and no second batch is offered.
    const inWindow = engine.runTick();
    expect(inWindow.clock.inCommitmentWindow).toBe(true);
    expect(inWindow.wakesOffered).toBe(0);
  });
});
