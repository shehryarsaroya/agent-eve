/**
 * ★ **POOLED IS THE TREASURY, NOT THE HEAD-COUNT.**
 *
 * The syndicate legend — on the map and in `grants.syndicates[].legend` — read `2 POOLED · 0 CAN
 * SPEND` over a house whose treasury held nothing: the number was `sittingMembers().length`, and
 * joining pools nothing (`syndicate/apply.ts` — only a member's second `apply` with a stake does).
 * It now says how many members and how much is pooled, separately.
 *
 * Mutation, run: printing `members` before POOLED again fails ★1.
 */

import { describe, expect, it } from 'vitest';
import { setSpeed } from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';
import { Runtime } from '../../src/sim/runtime.js';
import { commonsSystems } from '../../src/world/index.js';

function act(rt: Runtime, principal: PrincipalId, verb: string, params: Record<string, unknown>): void {
  const outcome = rt.engine.submit({ principal, verb, params, clientSequence: 0, arrivalMs: 0, decisionSource: 'LIVE' });
  if (!outcome.ok) throw new Error(`submit ${verb}: ${outcome.invariant} ${outcome.hint}`);
  rt.runTick();
  const refusal = rt.takeCorrections(principal)[0];
  if (refusal !== undefined) throw new Error(`${verb} refused: ${refusal.invariant} ${refusal.hint}`);
}

describe('★ the syndicate legend', () => {
  it('★1 a two-member house with an empty pool reads 0 POOLED, and says 2 MEMBERS', () => {
    setSpeed('instant');
    const rt = new Runtime({ seed: 'legend-pool' });
    const stage = commonsSystems(rt.world.map)[0];
    if (stage === undefined) throw new Error('no Commons system');
    const founder = 'p:founder' as PrincipalId;
    const joiner = 'p:joiner' as PrincipalId;
    for (const [who, handle] of [[founder, 'founder'], [joiner, 'joiner']] as const) {
      rt.seat(who, handle, stage);
      rt.standing.open(who);
    }
    act(rt, founder, 'form', { name: 'The Pool', admission: 'OPEN', decision: 'MAJORITY', treasury_offices: true });
    const house = rt.syndicates.of(founder, rt.engine.tick)[0];
    if (house === undefined) throw new Error('form failed');
    act(rt, joiner, 'apply', { syndicate: house.id });
    const line = rt.syndicateLines(rt.engine.tick).find((l) => l.syndicate === house.id);
    expect(line?.members, 'non-vacuity: two members sit').toBe(2);
    expect(line?.treasuryMinor, 'and nobody has pooled anything').toBe(0);
    expect(line?.legend).toBe('2 MEMBERS · 0 POOLED · 0 CAN SPEND');
  });
});
