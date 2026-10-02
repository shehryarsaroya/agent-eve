/**
 * ★ **THE BRIEFING MOVES ON — a rung that reads history never empties, and the ladder under it dies.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `briefing.prompt`'s first rung, *authority you granted is being USED*, read every grant ever issued
 * (`forGrantor` keeps revoked and expired rows), every venture ever bound, and the GROSS spend journal.
 * A probe ran grant → delegated create → abandon (the draw released in full) → revoke, and for ~1,000
 * ticks its first sentence still said *"draws totalling 8000 have been taken … none of it can be
 * undone"* while `if_you_do_nothing` in the same object warned of an unelected elective — a permanent
 * default — the prompt never mentioned.
 *
 *   ★1  net of releases: an abandoned delegated venture gives its draw back, and the rung goes quiet;
 *   ★2  live only: a revoked grant is not authority in use;
 *   ★3  a rung ranked above the unelected elective carries it as a closing clause, with the figure
 *       `if_you_do_nothing` quotes;
 *   ★4  a held role still UNSEALED before the freeze is named by both keys, from one read.
 *
 * Mutation, run: reading `issuedRows` without `isLive` fails ★2; summing gross spends fails ★1; deleting
 * `alsoRiding` fails ★3; deleting the seal rung or its preview clause fails ★4.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../src/api/observe.js';
import { setSpeed } from '../../src/core/time.js';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import { AUDIT_LAG_TICKS } from '../../src/grant/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { commonsSystems } from '../../src/world/index.js';

type Row = Record<string, unknown>;
const obj = (v: unknown): Row => (typeof v === 'object' && v !== null ? (v as Row) : {});

const IN_USE = 'Authority you granted is being USED';

interface World {
  readonly rt: Runtime;
  readonly grantor: PrincipalId;
  readonly delegate: PrincipalId;
  readonly rival: PrincipalId;
  readonly stage: SystemId;
}

function world(seed: string): World {
  setSpeed('instant');
  const rt = new Runtime({ seed });
  const stage = commonsSystems(rt.world.map)[0];
  if (stage === undefined) throw new Error('the launch map has no Commons system');
  const grantor = 'p:trusting' as PrincipalId;
  const delegate = 'p:mole' as PrincipalId;
  const rival = 'p:rival' as PrincipalId;
  for (const [who, handle] of [
    [grantor, 'trusting'],
    [delegate, 'mole'],
    [rival, 'rival'],
  ] as const) {
    rt.seat(who, handle, stage);
    rt.standing.open(who);
  }
  return { rt, grantor, delegate, rival, stage };
}

/** One act through the front door; throws rather than letting a silent refusal fake a green test. */
function act(rt: Runtime, principal: PrincipalId, verb: string, params: Row): void {
  const outcome = rt.engine.submit({ principal, verb, params, clientSequence: 0, arrivalMs: 0, decisionSource: 'LIVE' });
  if (!outcome.ok) throw new Error(`submit ${verb}: ${outcome.invariant} ${outcome.hint}`);
  const report = rt.runTick();
  if (report.halted) throw new Error(`${verb} halted: ${report.violations.map((v) => v.id).join(',')}`);
  const refusal = rt.takeCorrections(principal)[0];
  if (refusal !== undefined) throw new Error(`${verb} refused by the handler: ${refusal.invariant} ${refusal.hint}`);
}

function briefing(rt: Runtime, who: PrincipalId): { prompt: string; ifNothing: string; payload: Row } {
  const payload = buildObservation({
    runtime: rt,
    principal: who,
    serverNowMs: 0,
    fresh: true,
    wakesRemaining: 9,
    stale: false,
    corrections: [],
    correctionsDropped: 0,
    actionsRemaining: 4,
  }) as unknown as Row;
  const b = obj(payload['briefing']);
  return { prompt: String(b['prompt']), ifNothing: String(b['if_you_do_nothing']), payload };
}

function handOf(rt: Runtime, who: PrincipalId): string {
  const hand = [...rt.world.hands.values()].find((h) => h.principal === who && h.state === 'IDLE');
  if (hand === undefined) throw new Error(`${who} has no idle hand`);
  return hand.id;
}

/** A DIG the grantor creates and staffs with the rival, signed through to LIVE: an elective rides it. */
function liveDig(w: World): string {
  act(w.rt, w.grantor, 'create', { kind: 'DIG', stage: w.stage, elective_bps: 3_000 });
  const venture = w.rt.ventures.all().find((v) => v.creator === w.grantor && v.state === 'FORMING');
  if (venture === undefined) throw new Error('the fixture needs a venture');
  const [first, second] = venture.roles;
  if (first === undefined || second === undefined) throw new Error('a DIG has two roles');
  act(w.rt, w.grantor, 'fill_role', { venture: venture.id, role: first.index, hand: handOf(w.rt, w.grantor), stake: 0 });
  act(w.rt, w.rival, 'fill_role', { venture: venture.id, role: second.index, hand: handOf(w.rt, w.rival), stake: 0 });
  act(w.rt, w.rival, 'sign', { venture: venture.id, terms_hash: venture.termsHash });
  expect(w.rt.ventures.require(venture.id).state, 'non-vacuity: the venture must be LIVE').toBe('LIVE');
  return venture.id;
}

describe('★ the authority rung reads LIVE authority, net of what came back', () => {
  it('★1 + ★2 grant → delegated create → abandon → revoke: the rung fires on the draw, and then goes quiet', () => {
    const w = world('briefing-moves-on');
    act(w.rt, w.grantor, 'grant', {
      delegate: w.delegate,
      template: 'quartermaster',
      max_direct_loss: 50_000,
      max_contingent_liability: 50_000,
      expires_tick: 400,
    });
    const grant = w.rt.grants.forGrantor(w.grantor)[0];
    expect(grant, 'the grant must exist').toBeDefined();
    act(w.rt, w.delegate, 'create', { kind: 'DIG', stage: w.stage, elective_bps: 2_000, on_behalf_of: w.grantor });
    const bound = w.rt.ventures.all().find((v) => v.boundByGrant !== null);
    expect(bound, 'the delegated create must have bound a venture in the grantor\'s name').toBeDefined();
    if (bound === undefined || grant === undefined) return;
    expect(w.rt.grants.netSpendOf(grant.id).direct, 'non-vacuity: the create drew on the grant').toBeGreaterThan(0);
    expect(briefing(w.rt, w.grantor).prompt, 'while the venture forms, the rung is the news').toContain(IN_USE);

    // ★1 — the grantor abandons the venture its delegate opened: escrow refunded, draw released.
    act(w.rt, w.grantor, 'abandon', { venture: bound.id });
    expect(w.rt.grants.netSpendOf(grant.id).direct, 'non-vacuity: the draw came back in full').toBe(0);
    expect(w.rt.grants.isLive(grant.id, w.rt.engine.tick), 'and the grant is still live').toBe(true);
    const afterAbandon = briefing(w.rt, w.grantor).prompt;
    expect(afterAbandon, 'a draw given back is not authority being used').not.toContain(IN_USE);
    expect(afterAbandon).not.toContain('draw(s) totalling');

    // ★2 — revoked: nothing left for `revoke` to bound, so nothing for the rung to say.
    act(w.rt, w.grantor, 'revoke', { grant: grant.id });
    expect(w.rt.grants.isLive(grant.id, w.rt.engine.tick + 1), "non-vacuity: no act sent now can use it").toBe(false);
    expect(briefing(w.rt, w.grantor).prompt).not.toContain(IN_USE);
  });

  it('★2 a dossier cut under a grant that has since been REVOKED no longer heads the ladder', () => {
    const w = world('briefing-dead-leak');
    act(w.rt, w.grantor, 'grant', {
      delegate: w.delegate,
      template: 'steward',
      max_direct_loss: 500,
      max_contingent_liability: 500,
      expires_tick: 400,
    });
    act(w.rt, w.delegate, 'message', { to: w.rival, dossier: `${String(w.grantor)}/STORES` });
    for (let i = 0; i <= AUDIT_LAG_TICKS; i += 1) w.rt.runTick();
    expect(briefing(w.rt, w.grantor).prompt, 'non-vacuity: a live leak IS the news').toContain(IN_USE);
    const grant = w.rt.grants.forGrantor(w.grantor)[0];
    if (grant === undefined) throw new Error('no grant');
    act(w.rt, w.grantor, 'revoke', { grant: grant.id });
    const after = briefing(w.rt, w.grantor);
    expect(after.prompt, 'the leak is permanent and on grants.about_me[]; the rung is for what revoke can bound').not.toContain(IN_USE);
    expect((obj(after.payload['grants'])['about_me'] as unknown[]).length, 'and the record still carries it').toBe(1);
  });
});

describe('★ the prompt and the preview agree about a default', () => {
  it('★3 a live leak outranks the elective, and the prompt still carries the figure the preview quotes', () => {
    const w = world('briefing-carries-default');
    liveDig(w);
    act(w.rt, w.grantor, 'grant', {
      delegate: w.delegate,
      template: 'steward',
      max_direct_loss: 500,
      max_contingent_liability: 500,
      expires_tick: 400,
    });
    act(w.rt, w.delegate, 'message', { to: w.rival, dossier: `${String(w.grantor)}/STORES` });
    for (let i = 0; i <= AUDIT_LAG_TICKS; i += 1) w.rt.runTick();
    const { prompt, ifNothing } = briefing(w.rt, w.grantor);
    const figure = /elective (\d+) is NOT paid/.exec(ifNothing)?.[1];
    expect(figure, `non-vacuity: the preview must report an unpaid elective (${ifNothing.slice(0, 160)})`).toBeDefined();
    expect(prompt, 'the leak is still the first thing named').toContain(IN_USE);
    expect(prompt, 'and the permanent default is not hidden behind it').toContain(`${String(figure)} of ELECTIVE half is unelected`);
    expect(prompt).toContain('DEFAULT');
  });
});

describe('★ a held role still unsealed before the freeze', () => {
  it('★4 is named by the prompt and by the preview, and both go quiet once it is sealed', () => {
    const w = world('briefing-unsealed');
    liveDig(w);
    const before = briefing(w.rt, w.rival);
    const seal = (before.payload['affordances'] as Row[]).find((a) => a['verb'] === 'seal');
    expect(seal, 'non-vacuity: a LIVE role with its delivery ahead is offered a seal').toBeDefined();
    expect(before.prompt).toContain('is UNSEALED');
    expect(before.prompt).toContain('PROP-D4');
    expect(before.ifNothing).toContain('UNSEALED');
    act(w.rt, w.rival, 'seal', obj(seal?.['params']));
    const after = briefing(w.rt, w.rival);
    expect(after.prompt, 'a sealed role is not a dilemma').not.toContain('UNSEALED');
    expect(after.ifNothing).not.toContain('UNSEALED');
  });
});
