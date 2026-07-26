/**
 * **AGT-X9 — no agent-reachable input may halt the world, and a full book is an
 * agent-reachable input.**
 *
 * The defect this file pins, measured before it was fixed: twenty principals rest
 * 480 one-unit asks over six ticks (four actions each, entirely within the budget),
 * one buyer crosses all of them with a single IOC bid, and the `MARKETS` phase
 * charges **1024 steps against a cap of 1016**. DET-9 aborts the tick and the world
 * PAUSES. Nobody did anything wrong; a halt anyone can trigger is worse than a
 * crash because it is a weapon.
 *
 * The cause is exactly `STEP_BUDGET.perObligation`'s, one phase over: the resting
 * book scales with nothing else in the budget — it is built by agents collectively
 * over many ticks, and the tick it is *spent* on may carry no actions at all — so
 * `perRestingOrder` sizes the cap for the work the tick actually has to do.
 */

import { describe, expect, it } from 'vitest';
import { setSpeed } from '../../src/core/time.js';
import { STEP_BUDGET, stepBudgetFor } from '../../src/tick/loop.js';
import { Runtime } from '../../src/sim/runtime.js';
import { commonsSystems } from '../../src/world/index.js';
import type { PrincipalId } from '../../src/core/types.js';
import { GOOD, tickAllowingHalt } from './fixture.js';

const SELLERS = 20;
const ROUNDS = 6;

describe('the step budget covers a full book walk', () => {
  it('sizes the cap for the resting orders, not only for this tick actions', () => {
    // The arithmetic, directly: a world with a book is budgeted more than the same
    // world without one. A term that existed but was never added would pass every
    // behavioural test in this file the moment the book happened to be small.
    expect(stepBudgetFor(0, 60, 0, 0, 480)).toBe(stepBudgetFor(0, 60, 0, 0, 0) + 480 * STEP_BUDGET.perRestingOrder);
    expect(STEP_BUDGET.perRestingOrder).toBeGreaterThan(0);
  });

  it('one bid crossing 480 resting asks completes instead of pausing the world', () => {
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'book-walk' });
    const venue = commonsSystems(runtime.world.map)[0];
    if (venue === undefined) throw new Error('the launch map has no Commons system');

    const sellers: PrincipalId[] = [];
    for (let i = 0; i < SELLERS; i += 1) {
      const p = `p:s${String(i).padStart(2, '0')}` as PrincipalId;
      runtime.seat(p, `s${String(i)}`, venue);
      runtime.standing.open(p);
      sellers.push(p);
    }
    const buyer = 'p:zbuyer' as PrincipalId;
    runtime.seat(buyer, 'zbuyer', venue);
    runtime.standing.open(buyer);
    expect(tickAllowingHalt(runtime).halted).toBe(false);

    // Fill the book at four actions per principal per tick — the published budget,
    // so nothing here is an abuse.
    for (let round = 0; round < ROUNDS; round += 1) {
      for (const p of sellers) {
        for (let k = 0; k < 4; k += 1) {
          runtime.engine.submit({
            principal: p,
            verb: 'trade',
            params: {
              operation: 'place',
              venue,
              good: GOOD,
              side: 'ASK',
              quantity: 1,
              limit_price: 1 + round * 4 + k,
              duration_ticks: 200,
            },
            clientSequence: k,
            arrivalMs: k,
            decisionSource: 'LIVE',
          });
        }
      }
      const filling = tickAllowingHalt(runtime);
      expect(filling.halted, 'the world halted while the book was merely being built').toBe(false);
    }
    const resting = runtime.market.countOpen();
    expect(resting).toBe(SELLERS * ROUNDS * 4);

    runtime.engine.submit({
      principal: buyer,
      verb: 'trade',
      params: {
        operation: 'place',
        venue,
        good: GOOD,
        side: 'BID',
        quantity: resting,
        limit_price: 1 + (ROUNDS - 1) * 4 + 3,
        time_in_force: 'IOC',
      },
      clientSequence: 0,
      arrivalMs: 0,
      decisionSource: 'LIVE',
    });
    expect(tickAllowingHalt(runtime).halted).toBe(false);

    // The tick that does the work. Under the defect this reported DET-9 and paused.
    const sweep = tickAllowingHalt(runtime);
    expect(
      sweep.halted,
      `the book walk paused the world: ${sweep.violations.map((v) => `${v.id} ${v.message}`).join(' | ')}`,
    ).toBe(false);
    expect(sweep.violations.some((v) => v.id === 'DET-9')).toBe(false);
    expect(runtime.market.fills().length, 'the walk did not actually happen').toBe(resting);
    // …and it is still metered: the phase spent real steps inside a real cap.
    expect(sweep.steps).toBeGreaterThan(1_000);
    expect(sweep.steps).toBeLessThan(sweep.stepBudget);
    // Everything closed and nothing is left locked.
    expect(runtime.market.open().length).toBe(0);
    expect(runtime.ledger.encumbrances.open().length).toBe(0);
  });
});
