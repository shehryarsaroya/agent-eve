/**
 * DET-9 — fixed rounds, a bounded tick, and the default that must never be
 * fabricated.
 *
 * Two claims, and the second is the one that matters:
 *
 *   1. an adversarially constructed circular-obligation graph terminates within the
 *      round limit, and the tick's step count is bounded regardless of input;
 *   2. **an obligation unresolved at the limit DEFERS. It never defaults.** SPEC
 *      §15.3: "a truncated cascade recording a breach is an engine-fabricated
 *      default, and a rival can construct one deliberately." That is A5′ — the one
 *      failure this design calls worse than a crash.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFERRAL_REASON,
  CascadeError,
  Engine,
  runCascade,
  STEP_BUDGET,
  stepBudgetFor,
  type CascadeAttempt,
  type ObligationSource,
} from '../../src/tick/index.js';
import { CASCADE_ROUND_LIMIT } from '../../src/invariants/transaction.js';
import { seatWorld, submission } from './harness.js';

/**
 * A ring: each obligation can only settle once the next one has. Nothing can go
 * first, so nothing ever settles — the exact graph a rival would build to try to get
 * a counterparty marked as having defaulted.
 */
function ring(size: number): { ids: string[]; attempt: (id: string) => CascadeAttempt } {
  const ids = Array.from({ length: size }, (_, i) => `o-${String(i).padStart(3, '0')}`);
  const settled = new Set<string>();
  const nextOf = (id: string): string => {
    const i = ids.indexOf(id);
    return ids[(i + 1) % ids.length] ?? id;
  };
  return {
    ids,
    attempt: (id): CascadeAttempt => {
      const dep = nextOf(id);
      if (!settled.has(dep)) return { done: false, waitingOn: dep };
      settled.add(id);
      return { done: true, breached: false, note: 'settled' };
    },
  };
}

describe('DET-9 — cascades run in fixed rounds', () => {
  it('shares its round limit with the invariants module rather than restating it', () => {
    // Two copies of a limit is a limit that will eventually disagree with itself.
    expect(CASCADE_ROUND_LIMIT).toBe(3);
    const r = runCascade(['a'], () => ({ done: false, waitingOn: 'b' }));
    expect(r.rounds).toBeLessThanOrEqual(CASCADE_ROUND_LIMIT);
  });

  it('an adversarial ring terminates and defers — it never records a breach', () => {
    for (const size of [2, 3, 5, 13, 64]) {
      const graph = ring(size);
      const result = runCascade(graph.ids, graph.attempt);

      expect(result.truncated).toBe(true);
      expect(result.resolved).toEqual([]);
      expect(result.deferred.length).toBe(size);
      // Nothing in the outcome can even express a breach: `CascadeStatus` has two
      // members and neither is a default. This asserts the consequence.
      for (const d of result.deferred) {
        expect(d.reason).toBe(DEFERRAL_REASON);
        expect(d.reason).toContain('not a default');
        expect(graph.ids).toContain(d.waitingOn);
      }
      expect(result.resolved.some((s) => s.breached)).toBe(false);
    }
  });

  it('bounds the step count by input size, never by input content', () => {
    for (const size of [1, 4, 32, 256]) {
      const graph = ring(size);
      const result = runCascade(graph.ids, graph.attempt);
      expect(result.steps).toBeLessThanOrEqual(CASCADE_ROUND_LIMIT * size);
      // A ring makes no progress, so the runner stops after the first fruitless
      // round rather than burning the full three: the same answer, fewer steps.
      expect(result.steps).toBe(size);
    }
  });

  it('resolves a chain that can make progress, one layer per round', () => {
    // The positive case, so the deferral above is not just "the cascade never works".
    const ids = ['c-0', 'c-1', 'c-2'];
    const settled = new Set<string>();
    const result = runCascade(ids, (id) => {
      const index = Number(id.slice(2));
      if (index > 0 && !settled.has(`c-${String(index - 1)}`)) {
        return { done: false, waitingOn: `c-${String(index - 1)}` };
      }
      settled.add(id);
      return { done: true, breached: false, note: 'settled' };
    });
    expect(result.deferred).toEqual([]);
    expect(result.resolved.map((s) => s.id)).toEqual(['c-0', 'c-1', 'c-2']);
    expect(result.rounds).toBeLessThanOrEqual(CASCADE_ROUND_LIMIT);
  });

  it('a resolver that ran may report a breach on the merits; the limit never can', () => {
    // The distinction the whole file is about. `breached` is only reachable through
    // `done: true`, which means a resolver looked at the obligation and judged it.
    const result = runCascade(['x'], () => ({ done: true, breached: true, note: 'unpaid at settlement' }));
    expect(result.truncated).toBe(false);
    expect(result.deferred).toEqual([]);
    expect(result.resolved[0]?.breached).toBe(true);
  });

  it('refuses a duplicate obligation id, which would settle the same promise twice', () => {
    // Scar #14a: a helper concatenated two overlapping lists with no dedupe.
    expect(() => runCascade(['a', 'a'], () => ({ done: true, breached: false, note: '' }))).toThrow(
      CascadeError,
    );
  });

  it('the tick step budget scales with EVERY input size, including the obligation set', () => {
    // The obligation term was missing, and this test's earlier version could not see
    // that: it checked three terms and the budget had four inputs. 600 obligations
    // that all settled cleanly halted the world, with a message blaming a convergence
    // loop that never happened.
    const zero = stepBudgetFor(0, 0, 0, 0);
    expect(zero).toBeGreaterThan(0);
    expect(stepBudgetFor(10, 0, 0, 0)).toBeGreaterThan(zero);
    expect(stepBudgetFor(0, 10, 0, 0)).toBeGreaterThan(zero);
    expect(stepBudgetFor(0, 0, 10, 0)).toBeGreaterThan(zero);
    expect(stepBudgetFor(0, 0, 0, 10)).toBeGreaterThan(zero);
  });

  it('budgets at least CASCADE_ROUND_LIMIT steps per obligation, or a legitimate cascade is unbudgetable', () => {
    // OBLIGE charges one step per resolver attempt and the cascade may legitimately
    // use every round for every item. A per-obligation term below the round limit
    // therefore halts a Reckoning that did nothing wrong.
    expect(STEP_BUDGET.perObligation).toBeGreaterThanOrEqual(CASCADE_ROUND_LIMIT);
    const n = 600;
    const worstCaseAttempts = n * CASCADE_ROUND_LIMIT;
    expect(stepBudgetFor(0, 0, 0, n) - stepBudgetFor(0, 0, 0, 0))
      .toBeGreaterThanOrEqual(worstCaseAttempts);
  });

  it('a phase that loops to convergence aborts the tick instead of hanging it', () => {
    // DET-9's second clause with teeth: an unbounded tick is a world that has
    // stopped without saying so, so it is treated exactly as an invariant failure.
    const { world } = seatWorld(2);
    const engine = new Engine({
      world,
      seed: 'det9-runaway',
      handlers: {
        HAZARD: (ctx) => {
          // A deliberately unbounded loop, the shape §15.2 forbids.
          for (;;) ctx.step();
        },
      },
    });
    const report = engine.runTick();
    expect(report.halted).toBe(true);
    expect(report.stateHash).toBe('');
    expect(report.violations.map((v) => v.id)).toContain('DET-9');
    expect(engine.status).toBe('PAUSED');
    expect(report.steps).toBeLessThanOrEqual(report.stepBudget + 1);
  });

  it('OBLIGE runs the cascade over a registered source and reports it', () => {
    const { world, principals } = seatWorld(2);
    const graph = ring(4);
    const obligations: ObligationSource = {
      due: () => graph.ids,
      attempt: (_ctx, id) => graph.attempt(id),
    };
    const engine = new Engine({ world, seed: 'det9-oblige', obligations });
    const principal = principals[0];
    if (principal === undefined) throw new Error('fixture seated nobody');
    engine.submit(submission({ principal, verb: 'claim', params: { about: 'nothing' } }));
    const report = engine.runTick();

    expect(report.halted).toBe(false);
    expect(report.cascade).not.toBeNull();
    expect(report.cascade?.deferred.length).toBe(4);
    expect(report.cascade?.resolved).toEqual([]);
    // Deferral is not a halt: the world publishes, and the obligations wait.
    expect(report.stateHash).not.toBe('');
    expect(engine.status).toBe('RUNNING');
  });

  it('reads the obligation set exactly once per tick, so the budget cannot be for different work', () => {
    // The budget is sized from `due()` and OBLIGE processes the cached result. If
    // `due()` were called twice, the two calls could disagree and the budget would be
    // for work that is not the work being done — the same class of bug as the missing
    // term, and considerably harder to see. So the call count is asserted, not assumed.
    const { world, principals } = seatWorld(2);
    let dueCalls = 0;
    const ids = ['ob-a', 'ob-b', 'ob-c'];
    const obligations: ObligationSource = {
      due: () => {
        dueCalls += 1;
        return ids;
      },
      attempt: () => ({ done: true, breached: false, note: 'settled' }),
    };
    const engine = new Engine({ world, seed: 'due-once', obligations });
    const principal = principals[0];
    if (principal === undefined) throw new Error('fixture seated nobody');
    engine.submit(submission({ principal, verb: 'claim', params: { about: 'nothing' } }));
    const report = engine.runTick();

    expect(dueCalls).toBe(1);
    expect(report.halted).toBe(false);
    expect(report.cascade?.resolved.length).toBe(3);
  });

  it('REGRESSION: a large Reckoning whose obligations all settle cleanly does not halt', () => {
    // The wave-2 verifier's measurement, as a permanent test. 600 obligations that
    // every one of them settles cleanly (done: true, breached: false) in a
    // two-principal world used to halt with:
    //
    //   DET-9: tick exceeded its step budget of 560 in phase OBLIGE;
    //          cascades run in fixed rounds and no phase may loop to convergence
    //
    // OBLIGE had done exactly the bounded thing it was designed to do. The budget
    // simply had no term for the obligation set, and the settlement set scales with
    // VENTURES rather than hands, so the cap and the work never moved together.
    //
    // Two reasons this mattered more than an ordinary sizing miss. It is a
    // self-inflicted halt — the engine stopping the world on a state it created
    // itself — and it lands on the Reckoning, the one tick that has an audience
    // (A14). The message also blamed a convergence loop that never happened, which
    // would have sent an operator hunting the wrong bug.
    const { world, principals } = seatWorld(2);
    const ids = Array.from({ length: 600 }, (_, i) => `ob-${String(i).padStart(4, '0')}`);
    const obligations: ObligationSource = {
      due: () => ids,
      attempt: () => ({ done: true, breached: false, note: 'settled' }),
    };
    const engine = new Engine({ world, seed: 'det9-large-clean', obligations });
    const principal = principals[0];
    if (principal === undefined) throw new Error('fixture seated nobody');
    engine.submit(submission({ principal, verb: 'claim', params: { about: 'nothing' } }));
    const report = engine.runTick();

    expect(report.halted).toBe(false);
    expect(engine.status).toBe('RUNNING');
    expect(report.stateHash).not.toBe('');
    expect(report.violations.map((v) => v.id)).not.toContain('DET-9');
    // Every one resolved, none breached, none deferred.
    expect(report.cascade?.resolved.length).toBe(600);
    expect(report.cascade?.deferred).toEqual([]);
    expect(report.cascade?.resolved.some((r) => r.breached)).toBe(false);
    // And the budget genuinely covered it rather than the phase getting lucky.
    expect(report.stepBudget).toBeGreaterThan(600);
  });
});
