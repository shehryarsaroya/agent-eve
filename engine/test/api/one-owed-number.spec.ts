/**
 * ★ **ONE OBLIGATION, ONE NUMBER — the `assure` row and the venture row quote the same owed figure.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * The `assure` affordance said *"You owe 1200 on v:…"* — Σ of the pinned `terms.elective` over every
 * filled role, the creator's own included — while `ventures.mine[].my_elective_owed` on the same
 * venture said 2400: the BOUND `elect` charges (`venture/preview.ts:creatorElective`), over the roles
 * somebody else holds. A creator deciding whether to assure read two different debts for one promise.
 * The row now quotes the bound from the same call, and the helper that lists what is owed no longer
 * counts a role the creator holds itself (it is booked paid in full and owed to nobody — scar #9).
 *
 * Mutation, run: quoting `owed.electiveMinor` again fails ★1.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../src/api/observe.js';
import { setSpeed } from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';
import { Runtime } from '../../src/sim/runtime.js';
import { commonsSystems } from '../../src/world/index.js';

type Row = Record<string, unknown>;

function act(rt: Runtime, principal: PrincipalId, verb: string, params: Row): void {
  const outcome = rt.engine.submit({ principal, verb, params, clientSequence: 0, arrivalMs: 0, decisionSource: 'LIVE' });
  if (!outcome.ok) throw new Error(`submit ${verb}: ${outcome.invariant} ${outcome.hint}`);
  const report = rt.runTick();
  if (report.halted) throw new Error(`${verb} halted`);
  const refusal = rt.takeCorrections(principal)[0];
  if (refusal !== undefined) throw new Error(`${verb} refused: ${refusal.invariant} ${refusal.hint}`);
}

function handOf(rt: Runtime, who: PrincipalId): string {
  const hand = [...rt.world.hands.values()].find((h) => h.principal === who && h.state === 'IDLE');
  if (hand === undefined) throw new Error(`${who} has no idle hand`);
  return hand.id;
}

describe('★ the assure row quotes what the venture row says you owe', () => {
  it('★1 the same figure, on a venture whose creator also holds a role', () => {
    setSpeed('instant');
    const rt = new Runtime({ seed: 'one-owed-number' });
    const stage = commonsSystems(rt.world.map)[0];
    if (stage === undefined) throw new Error('no Commons system');
    const maker = 'p:maker' as PrincipalId;
    const filler = 'p:filler' as PrincipalId;
    for (const [who, handle] of [[maker, 'maker'], [filler, 'filler']] as const) {
      rt.seat(who, handle, stage);
      rt.standing.open(who);
    }
    act(rt, maker, 'create', { kind: 'DIG', stage, elective_bps: 3_000 });
    const venture = rt.ventures.all().find((v) => v.creator === maker);
    if (venture === undefined) throw new Error('no venture');
    const [first, second] = venture.roles;
    if (first === undefined || second === undefined) throw new Error('a DIG has two roles');
    // The creator takes a role itself: under the old sum, its own pinned elective was "owed" too.
    act(rt, maker, 'fill_role', { venture: venture.id, role: first.index, hand: handOf(rt, maker), stake: 0 });
    act(rt, filler, 'fill_role', { venture: venture.id, role: second.index, hand: handOf(rt, filler), stake: 0 });
    act(rt, filler, 'sign', { venture: venture.id, terms_hash: venture.termsHash });

    const payload = buildObservation({
      runtime: rt,
      principal: maker,
      serverNowMs: 0,
      fresh: true,
      wakesRemaining: 9,
      stale: false,
      corrections: [],
      correctionsDropped: 0,
      actionsRemaining: 4,
    }) as unknown as Row;
    const row = ((payload['ventures'] as Row)['mine'] as Row[]).find((v) => v['id'] === venture.id);
    const owedOnRow = Number(row?.['my_elective_owed']);
    expect(owedOnRow, 'non-vacuity: the creator owes the filler an elective half').toBeGreaterThan(0);
    const assure = (payload['affordances'] as Row[]).find(
      (a) => a['verb'] === 'message' && (a['params'] as Row)['act'] === 'assure' && (a['params'] as Row)['venture'] === venture.id,
    );
    expect(assure, 'the creator owes, so it is offered the assurance').toBeDefined();
    const quoted = /You owe up to (\d+) on/.exec(String(assure?.['what_it_forecloses']))?.[1];
    expect(Number(quoted), 'the assurance and the venture row must quote ONE number for one debt').toBe(owedOnRow);
    // And the helper counts the filler's role only — the creator's own is owed to nobody.
    const listed = rt.electivePromisesOwedBy(maker).find((o) => o.venture === venture.id);
    expect(listed?.electiveMinor).toBe(second.terms.elective);
  });
});
