/**
 * ★ **`nearest_legal` IS THE SAME ACT, RE-PRICED, OR NOTHING** (PROP-O7, `agent.md` §13).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * Two homes, two rules, one field. `POST /act` matched the refused verb and fell back to
 * `affordances[0]`; a correction delivered into a wake matched the verb alone. A blind player's
 * refused `create {"kind":"HAUL"}` came back as `create {"kind":"DIG"}` with HAUL rows on the same
 * menu, and a refused `join` came back as `create DIG` — *"neither near nor legal"*. `agent.md` §13
 * says the field is never a substitute suggestion, and it is the field an agent is told to copy.
 *
 * `api/nearest.ts` is now the one rule for both paths: the verb, plus every identifying parameter
 * the refused act named (its kind and its target), and a self-meaning absence (`payer`,
 * `on_behalf_of`) kept absent.
 *
 * Mutation, run: matching on `a.verb === refused.verb` alone fails ★1, ★2, ★3 and the front-door
 * test; dropping the `ABSENT_MEANS_SELF` clause fails ★2 alone.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { afterEach, describe, expect, it } from 'vitest';
import { nearestLegal } from '../../src/api/nearest.js';
import type { Affordance } from '../../src/api/observe.js';
import { PATHS, agent, enrol, harness, signed, tick, type Harness } from './harness.js';

let open: Harness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

function row(verb: string, params: Record<string, string | number | boolean>): Affordance {
  return {
    verb: verb,
    params,
    cost: 1,
    max_direct_loss: 0,
    max_contingent_liability: 0,
    what_it_forecloses: '',
    expires_tick: 1,
    quote_id: `${verb}:${JSON.stringify(params)}`,
  };
}

const MENU: readonly Affordance[] = [
  row('create', { kind: 'DIG', stage: 'sys-01', elective_bps: 2000 }),
  row('create', { kind: 'HAUL', stage: 'sys-01', elective_bps: 2000 }),
  row('deliver', { obligation: 'LEVY', payer: 'p:neighbour', amount: 300 }),
  row('deliver', { obligation: 'LEVY', amount: 500 }),
  row('move', { hand: 'h:1', to: 'sys-02' }),
];

describe('★ the rule, on a menu the test controls', () => {
  it('★1 a refused kind is answered by the SAME kind, never the first row of the verb', () => {
    expect(nearestLegal(MENU, { verb: 'create', params: { kind: 'HAUL', elective_bps: 1 } })?.params).toEqual({
      kind: 'HAUL',
      stage: 'sys-01',
      elective_bps: 2000,
    });
    expect(nearestLegal(MENU, { verb: 'create', params: { kind: 'SIEGE' } }), 'no SIEGE row: null').toBeNull();
  });

  it('★2 paying your own bill is not near carrying a neighbour’s', () => {
    expect(nearestLegal(MENU, { verb: 'deliver', params: { obligation: 'LEVY', amount: 9_999 } })?.params).toEqual({
      obligation: 'LEVY',
      amount: 500,
    });
    expect(
      nearestLegal(MENU, { verb: 'deliver', params: { obligation: 'LEVY', payer: 'p:other' } }),
      'a carry for a principal the menu does not carry for is a different act',
    ).toBeNull();
  });

  it('★3 what differs only in HOW is the nearest legal act; a different target is not', () => {
    expect(nearestLegal(MENU, { verb: 'move', params: { hand: 'h:9', to: 'sys-02' } })?.params).toEqual({
      hand: 'h:1',
      to: 'sys-02',
    });
    expect(nearestLegal(MENU, { verb: 'move', params: { hand: 'h:1', to: 'sys-77' } })).toBeNull();
  });

  it('★4 a verb with no row is null — never another verb', () => {
    expect(nearestLegal(MENU, { verb: 'join', params: { raid: 'r:1' } })).toBeNull();
    expect(nearestLegal(MENU, { verb: 'join' })).toBeNull();
    expect(nearestLegal([], { verb: 'move' })).toBeNull();
  });
});

describe('★ through the front door — the correction a wake delivers', () => {
  it('a create HAUL the tick refused comes back as a HAUL row or as null, never as a DIG', async () => {
    const h = await harness({ seed: 'nearest-same-kind' });
    open = h;
    const who = agent('probe-samekind');
    expect((await enrol(h, who)).status).toBe(201);
    tick(h, 1);
    const first = (await signed(h, who, 'GET', PATHS.observe)).json['observation'] as Record<string, unknown>;
    const creates = (first['affordances'] as Record<string, unknown>[]).filter((a) => a['verb'] === 'create');
    const kinds = creates.map((a) => String((a['params'] as Record<string, unknown>)['kind']));
    // NON-VACUITY: the old rule returned the FIRST create, so this only distinguishes the two if the
    // first create is some other kind and a HAUL row exists further down.
    expect(kinds[0], 'the first create row must not be HAUL, or the old rule passes too').not.toBe('HAUL');
    expect(kinds, 'a newcomer must be offered a HAUL create').toContain('HAUL');
    const haul = creates.find((a) => (a['params'] as Record<string, unknown>)['kind'] === 'HAUL');

    // Outside the kind's band, so the tick refuses it and the verdict waits for the next wake.
    const res = await signed(h, who, 'POST', PATHS.act, {
      actions: [
        {
          verb: 'create',
          params: { ...(haul?.['params'] as Record<string, unknown>), elective_bps: 1 },
          clientSequence: 41,
        },
      ],
    });
    expect((res.json['outcome'] as { accepted: unknown[] }).accepted.length, 'refused at the tick, not at submit').toBe(1);
    tick(h, 1);
    const next = (await signed(h, who, 'GET', PATHS.observe)).json['observation'] as Record<string, unknown>;
    const verdict = ((next['briefing'] as Record<string, unknown>)['corrections'] as Record<string, unknown>[]).find(
      (c) => c['clientSequence'] === 41,
    );
    expect(verdict, 'the refusal must arrive').toBeDefined();
    const nearest = verdict?.['nearest_legal'] as Record<string, unknown> | null;
    expect(nearest, 'a HAUL row is on this menu, so the nearest legal act exists').not.toBeNull();
    expect((nearest?.['params'] as Record<string, unknown>)['kind']).toBe('HAUL');
  }, 180_000);
});
