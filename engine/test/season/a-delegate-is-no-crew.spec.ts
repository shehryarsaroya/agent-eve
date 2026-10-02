/**
 * ★ **A DELEGATE OF THE GRAND CREATOR IS NO CREW** — the cast's FINALE obeys INV-23 (SPEC §8.1 #3).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `fill_role` refuses a principal a role in a venture whose creator had granted it authority when the
 * venture was created: a delegate may not be a counterparty to a deal it could have shaped
 * (`Runtime.fillRoleAuthorityRefusal`). The four-role BUILD branch has always known it. The grand
 * venture's two branches did not: `grandCreateFor` counted a delegate standing at the stage as crew,
 * and `grandFillFor` asked `grandFillRefusal` — the grand-only facts — and never the authority rule.
 *
 * Measured on `fs-a` once the launch fixes moved its trajectory: brannock formed three candidates in the
 * FINALE around two of its own delegates, both were refused on every tick of every window, none of the
 * candidates filled, and the season's prize went UNCLAIMED. Nothing in the world was wrong but the cast.
 *
 * This world makes the subject certain rather than lucky: the creator of `cf-a`'s crew hands every
 * cast-mate an office before the FINALE, so every one of them is barred from its candidates.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import { setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { EventId, PrincipalId } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';
import { CURRENCY_FAUCET, storesAccount } from '../../src/ledger/index.js';
import { finaleTickOf } from '../../src/season/index.js';
import { Runtime } from '../../src/sim/runtime.js';

const SEED = 'cf-a';
/** `cf-a`'s grand creator when nobody holds an office (`the-cast-takes-the-finale.spec.ts`). */
const CREATOR = 'p:brannock' as PrincipalId;

describe('★ the cast never crews a grand candidate with its creator\'s delegates (INV-23)', () => {
  it(
    'no grand fill is refused for authority, no candidate holds a delegate of its creator, and a crew still forms',
    () => {
      setSpeed('instant');
      const start = finaleTickOf(1) - 2 * TICKS_PER_RECKONING;
      const runtime = new Runtime({ seed: SEED, startTick: start });
      const cast = new HeuristicCast(runtime, { size: 12 });
      cast.seat(SEED);
      for (const m of cast.roster) {
        runtime.ledger.issueCurrency({
          eventId: `test.earn:${m.principal}` as EventId,
          tick: start + 1,
          faucet: CURRENCY_FAUCET.CIVIC_PROCUREMENT,
          to: storesAccount(m.principal),
          amount: minor(150_000),
        });
      }
      // ★ The subject: the creator hands every cast-mate an office, one a tick (a grant is a material
      // act, so the per-tick budget is spent on it like any other), long before the FINALE opens.
      const delegates = cast.roster.map((m) => m.principal).filter((p) => p !== CREATOR);

      let refusedForAuthority = 0;
      // Who held each candidate's creator's office when the candidate was formed — INV-23's own clock.
      const barredAtFormation = new Map<string, ReadonlySet<PrincipalId>>();
      while (runtime.engine.tick < finaleTickOf(1) + 1) {
        const next = delegates[runtime.engine.tick + 1 - (start + 1)];
        if (next !== undefined) {
          const out = runtime.engine.submit({
            principal: CREATOR,
            verb: 'grant',
            params: {
              delegate: next,
              template: 'treasury-hand',
              max_direct_loss: 0,
              max_contingent_liability: 1_000,
              expires_tick: finaleTickOf(1) + 10,
            },
            clientSequence: 99,
            arrivalMs: 0,
            decisionSource: 'LIVE',
          });
          expect(out.ok, `the grant to ${String(next)} must be accepted at the door`).toBe(true);
        }
        for (const action of cast.decide(runtime.engine.tick + 1, SEED)) runtime.engine.submit(action);
        const report = runtime.runTick();
        expect(report.halted, `halted at tick ${String(report.tick)}`).toBe(false);
        for (const v of runtime.ventures.all()) {
          if (v.grand === null || barredAtFormation.has(v.id)) continue;
          const live = runtime.grants
            .forGrantor(v.creator)
            .filter((g) => runtime.grants.isLive(g.id, report.tick))
            .map((g) => g.delegate);
          barredAtFormation.set(v.id, new Set(live));
        }
        for (const row of runtime.engine.log.forTick(report.tick)) {
          if (row.verb !== 'fill_role' || row.outcome !== 'REFUSED') continue;
          const venture = runtime.ventures.get(String(row.params['venture']) as never);
          const grandVenture = venture !== undefined && venture.grand !== null;
          if (grandVenture && row.rejection?.invariant === 'INV-23') refusedForAuthority += 1;
        }
      }
      expect(
        delegates.every((d) => runtime.grants.forGrantor(CREATOR).some((g) => g.delegate === d)),
        'non-vacuity: the creator really did hand every cast-mate an office',
      ).toBe(true);
      expect(
        refusedForAuthority,
        'a cast that asks for a grand role the authority rule refuses asks again every tick of the window',
      ).toBe(0);

      const grand = runtime.ventures.all().filter((v) => v.grand !== null);
      expect(grand.length, 'non-vacuity: the FINALE drew a candidate').toBeGreaterThan(0);
      for (const v of grand) {
        const barred = barredAtFormation.get(v.id) ?? new Set<PrincipalId>();
        for (const role of v.roles) {
          if (role.filledByPrincipal === null || role.filledByPrincipal === v.creator) continue;
          expect(
            barred.has(role.filledByPrincipal),
            `${String(role.filledByPrincipal)} crews ${String(v.id)} while holding ${String(v.creator)}'s office`,
          ).toBe(false);
        }
      }
      expect(
        grand.some((v) => (barredAtFormation.get(v.id)?.size ?? 0) > 0) ||
          grand.every((v) => v.creator !== CREATOR),
        'non-vacuity: either a candidate was formed by a creator with delegates, or the creator never formed one',
      ).toBe(true);
      // Barred from the creator's candidates is not barred from the prize: somebody else forms the crew,
      // and the delegates may stand in it — the grant runs from the creator to them, not the other way.
      expect(runtime.seasons.last()?.grand.outcome, 'the season\'s prize was still contested').not.toBe('UNCLAIMED');
    },
    900_000,
  );
});
