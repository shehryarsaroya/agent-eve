/**
 * The house cast takes part in the FINALE (SPEC §7.6, §15.6): it walks hands to the Frontier stage,
 * forms ONE crew when four can stand there, staffs it with earned stakes, signs it, carries the
 * verdict — and its creator answers the season's exam question by its published creed.
 *
 * Two seeds, chosen because their first grand creator draws the two opposite answers: `cf-a`'s is
 * PATIENT (appoints a treasurer, or pays itself before the freeze) and `cf-b`'s is MERCENARY (keeps the
 * yield, and every share it owed is a default on its record). The assertions are the POLICY, not the
 * seed's outcome — a creator's stance is drawn from the seed and printed in `cast/characters.ts`, so a
 * reader can check the rule against any seed without running this file.
 */

import { describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import { CAST_GRAND_POLICY } from '../../src/cast/heuristic.js';
import { stanceFor } from '../../src/cast/stance.js';
import { setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { EventId } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';
import { CURRENCY_FAUCET, storesAccount } from '../../src/ledger/index.js';
import { finaleTickOf } from '../../src/season/index.js';
import { Runtime } from '../../src/sim/runtime.js';

function playFinale(seed: string): { readonly runtime: Runtime; readonly cast: HeuristicCast } {
  setSpeed('instant');
  // Two Reckonings before the FINALE ends: the penultimate Reckoning, when the cast starts walking.
  const start = finaleTickOf(1) - 2 * TICKS_PER_RECKONING;
  const runtime = new Runtime({ seed, startTick: start });
  const cast = new HeuristicCast(runtime, { size: 12 });
  cast.seat(seed);
  // A world started this late has had no season to earn in, so each member is handed what a season
  // of play earns (`cal-a`/`cal-b` measured ~135,000 median `freeCash` at the FINALE).
  for (const m of cast.roster) {
    runtime.ledger.issueCurrency({
      eventId: `test.earn:${m.principal}` as EventId,
      tick: start + 1,
      faucet: CURRENCY_FAUCET.CIVIC_PROCUREMENT,
      to: storesAccount(m.principal),
      amount: minor(150_000),
    });
  }
  while (runtime.engine.tick < finaleTickOf(1) + 1) {
    for (const action of cast.decide(runtime.engine.tick + 1, seed)) runtime.engine.submit(action);
    const report = runtime.runTick();
    expect(report.halted, `halted at tick ${String(report.tick)}`).toBe(false);
    expect(report.violations).toEqual([]);
  }
  return { runtime, cast };
}

describe('the house cast takes the FINALE', () => {
  for (const seed of ['cf-a', 'cf-b']) {
    it(
      `${seed}: one crew of four at the stage, carried, and the creator answers by its creed`,
      () => {
        const { runtime, cast } = playFinale(seed);
        const grand = runtime.ventures.all().filter((v) => v.grand !== null);
        // ONE crew: the cast forms a candidate only when four unattached principals stand there.
        expect(grand).toHaveLength(1);
        const v = grand[0];
        if (v === undefined) throw new Error('unreachable');
        expect(new Set(v.roles.map((r) => r.filledByPrincipal)).size).toBe(4);
        const record = runtime.seasons.last();
        expect(record?.grand.venture).toBe(v.id);
        const creator = cast.roster.find((m) => m.principal === v.creator);
        if (creator === undefined) throw new Error('the creator is not a cast member');
        const stance = stanceFor(creator.handle, seed);
        if (stance === null) throw new Error('no stance');
        const policy = CAST_GRAND_POLICY[stance];
        const others = (record?.grand.crew ?? []).filter((c) => c.principal !== v.creator);
        if (policy === 'KEEP') {
          expect(record?.grand.outcome).toBe('BROKEN');
          expect(others.every((c) => c.paidMinor === 0)).toBe(true);
        } else {
          expect(record?.grand.outcome).toBe('KEPT');
          expect(others.every((c) => c.paidMinor === c.dueMinor)).toBe(true);
        }
        // Non-vacuity across the pair: the two seeds were chosen to draw both answers.
        expect(['cf-a', 'cf-b']).toContain(seed);
      },
      900_000,
    );
  }

  it('the two seeds really do draw the two opposite answers (so the test above is not one case twice)', () => {
    expect(CAST_GRAND_POLICY[stanceFor('brannock', 'cf-a') ?? 'ZEALOT']).toBe('TREASURER');
    expect(CAST_GRAND_POLICY[stanceFor('brannock', 'cf-b') ?? 'ZEALOT']).toBe('KEEP');
  });
});
