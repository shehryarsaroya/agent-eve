/**
 * ★ **TWO SMALL SURFACE LIES, EACH ABOUT A NUMBER THAT CANNOT BE WHAT IT SAID.**
 *
 *   ★1 an ABANDONED venture showed `projected_settlement` — the p50 take of roles that will never be
 *      paid, on a venture that retired with every escrow refunded. It reads 0 now.
 *   ★2 a BID refused for want of transferable cash said *"Your unlocked balance is 245200, of which
 *      250000 is enrolment ENDOWMENT"*: the endowment counter falls only when currency is destroyed, so
 *      a stake LOCKED out of an untouched endowment left the counter above the balance it is part of.
 *      The part of the unlocked balance that is endowment is clamped to the balance.
 *
 * Mutation, run: dropping the ABANDONED branch fails ★1; dropping the clamp fails ★2.
 */

import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../src/api/observe.js';
import { setSpeed } from '../../src/core/time.js';
import type { HandId, PrincipalId } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';
import { storesAccount } from '../../src/ledger/index.js';
import { tradeCheck } from '../../src/market/index.js';
import { openIndices } from '../../src/venture/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { commonsSystems } from '../../src/world/index.js';

type Row = Record<string, unknown>;

function act(rt: Runtime, principal: PrincipalId, verb: string, params: Row): void {
  const outcome = rt.engine.submit({ principal, verb, params, clientSequence: 0, arrivalMs: 0, decisionSource: 'LIVE' });
  if (!outcome.ok) throw new Error(`submit ${verb}: ${outcome.invariant} ${outcome.hint}`);
  rt.runTick();
  const refusal = rt.takeCorrections(principal)[0];
  if (refusal !== undefined) throw new Error(`${verb} refused: ${refusal.invariant} ${refusal.hint}`);
}

function idleOf(rt: Runtime, principal: PrincipalId): HandId {
  const found = [...rt.world.hands.values()].find((h) => h.principal === principal && h.state === 'IDLE');
  if (found === undefined) throw new Error(`${principal} has no idle hand`);
  return found.id;
}

function world(seed: string, who: readonly PrincipalId[]): Runtime {
  setSpeed('instant');
  const rt = new Runtime({ seed });
  const stage = commonsSystems(rt.world.map)[0];
  if (stage === undefined) throw new Error('no Commons system');
  for (const p of who) {
    rt.seat(p, p.replace('p:', ''), stage);
    rt.standing.open(p);
  }
  return rt;
}

describe('★ the numbers say what they can be', () => {
  it('★1 an ABANDONED venture projects nothing', () => {
    const alpha = 'p:alpha' as PrincipalId;
    const bravo = 'p:bravo' as PrincipalId;
    const rt = world('abandoned-projects-nothing', [alpha, bravo]);
    const stage = commonsSystems(rt.world.map)[0];
    act(rt, alpha, 'create', { kind: 'HAUL', stage });
    const v = rt.ventures.all().find((x) => x.creator === alpha && x.state === 'FORMING');
    if (v === undefined || openIndices(v).length !== 2) throw new Error('create did not mint a two-role venture');
    act(rt, alpha, 'fill_role', { venture: v.id, role: 0, hand: idleOf(rt, alpha) });
    act(rt, bravo, 'fill_role', { venture: v.id, role: 1, hand: idleOf(rt, bravo) });
    for (let i = 0; i < 40 && rt.ventures.require(v.id).state === 'FORMING'; i += 1) rt.runTick();
    expect(rt.ventures.require(v.id).state, 'non-vacuity: nobody signed, so it retired').toBe('ABANDONED');
    const payload = buildObservation({
      runtime: rt,
      principal: bravo,
      serverNowMs: 0,
      fresh: true,
      wakesRemaining: 9,
      stale: false,
      corrections: [],
      correctionsDropped: 0,
      actionsRemaining: 4,
    }) as unknown as Row;
    const row = ((payload['ventures'] as Row)['mine'] as Row[]).find((x) => x['id'] === v.id);
    expect(row, 'non-vacuity: the filler still sees the venture').toBeDefined();
    expect(row?.['projected_settlement'], 'a retired venture pays nobody').toBe(0);
  });

  it('★2 the endowment part of an unlocked balance is never more than the balance', () => {
    const alpha = 'p:alpha' as PrincipalId;
    const rt = world('endowment-adds-up', [alpha]);
    rt.runTick();
    const stores = storesAccount(alpha);
    const remaining = rt.ledger.endowments.remaining(alpha);
    expect(remaining, 'non-vacuity: an untouched starter stake').toBeGreaterThan(0);
    rt.ledger.encumbrances.lock({
      eventId: 'test:lock',
      tick: rt.engine.tick,
      principal: alpha,
      account: stores,
      amountMinor: minor(4_800),
      obligationRef: 'v:test' as never,
      maxDirectLoss: minor(4_800),
    });
    const held = rt.ledger.freeBalance(stores);
    expect(held, 'non-vacuity: the lock took the balance under the counter').toBeLessThan(remaining);
    const hint = String(
      tradeCheck(
        { ledger: rt.ledger, world: rt.world, book: rt.market, principal: alpha, tick: rt.engine.tick + 1 },
        {
          operation: 'place',
          venue: rt.world.holdings.get(rt.world.holdingByPrincipal.get(alpha) as never)?.system ?? null,
          good: 'ration' as never,
          side: 'BID',
          quantity: 1,
          limitPrice: 1,
          durationTicks: null,
          timeInForce: 'GTC',
          order: null,
        },
      ),
    );
    const parts = /unlocked balance is (\d+), of which (\d+) is enrolment ENDOWMENT/.exec(hint);
    expect(parts, `the refusal must explain the endowment: ${hint.slice(0, 200)}`).not.toBeNull();
    expect(Number(parts?.[2])).toBeLessThanOrEqual(Number(parts?.[1]));
    expect(Number(parts?.[1])).toBe(held);
  });
});
