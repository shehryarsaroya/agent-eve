/**
 * ★ **`revoke`, `apply` AND `approve` ARE ON THE MENU, AND THE DELEGATED HALF OF A GRANT IS COUNTED.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * The served observation never built a `revoke`, `apply`, `approve` or `on_behalf_of` row — only
 * `observe/catalogue.ts` did, and nothing serves that module — while `header.withheld` told a grantor
 * to "`revoke` the standing one first" and closed with *"Nothing you were eligible for has been
 * dropped"*, and two test exception lists said `revoke` was offered. Each verb accepted the act; the
 * payload even showed its input (`grants.granted[]`, `grants.syndicates[].open_proposals`).
 *
 * Every row here is copied from the menu verbatim and must be ACCEPTED — an offer the engine refuses
 * costs an agent a real action (AGT-S2). Acts in a grantor's name (`create`/`elect` under a grant the
 * reader holds) are not built; they are counted in `withheld`, one row per (grant, verb), with the call.
 *
 * Mutation, run: deleting each of the three offer loops fails its case; deleting the delegated rows
 * fails ★4.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PrincipalId } from '../../src/core/types.js';
import { PATHS, agent, enrol, harness, signed, tick, type Agent, type Harness } from './harness.js';

type Row = Record<string, unknown>;

let h: Harness;
beforeEach(async () => {
  h = await harness({ seed: 'office-acts' });
});
afterEach(async () => {
  await h.close();
});

function run(n: number): void {
  for (let i = 0; i < n; i += 1) {
    const r = h.runtime.runTick();
    expect(r.halted, `halted at ${String(r.tick)}`).toBe(false);
  }
}

async function act(who: Agent, verb: string, params: unknown): Promise<void> {
  const res = await signed(h, who, 'POST', PATHS.act, { actions: [{ verb, params, clientSequence: 1 }] });
  expect((res.json['outcome'] as { accepted: unknown[] }).accepted, res.text.slice(0, 300)).toHaveLength(1);
  run(1);
  const refused = h.runtime.takeCorrections(who.principalId as PrincipalId);
  expect(refused.map((c) => c.hint), `${verb} was refused`).toEqual([]);
}

async function enrolled(handle: string): Promise<Agent> {
  const who = agent(handle);
  expect((await enrol(h, who)).status).toBe(201);
  tick(h, 1);
  return who;
}

async function observation(who: Agent): Promise<Row> {
  return (await signed(h, who, 'GET', PATHS.observe)).json['observation'] as Row;
}

const offered = (o: Row, verb: string): Row[] => ((o['affordances'] ?? []) as Row[]).filter((a) => a['verb'] === verb);

async function house(founder: Agent, charter: Row): Promise<string> {
  await act(founder, 'form', { name: 'The Company', ...charter });
  const id = h.runtime.syndicates.of(founder.principalId as PrincipalId, h.runtime.engine.tick)[0]?.id;
  expect(id, 'forming must succeed').toBeDefined();
  return String(id);
}

describe('★ the office acts, offered and accepted verbatim', () => {
  it('★1 revoke: a grantor is offered the lever on each live grant it issued', async () => {
    const grantor = await enrolled('grantor-r');
    const delegate = await enrolled('delegate-r');
    await act(grantor, 'grant', {
      delegate: delegate.principalId,
      template: 'steward',
      max_direct_loss: 500,
      max_contingent_liability: 500,
      expires_tick: 400,
    });
    const grant = h.runtime.grants.forGrantor(grantor.principalId as PrincipalId)[0];
    expect(grant, 'non-vacuity: the grant was issued').toBeDefined();
    const row = offered(await observation(grantor), 'revoke').find((a) => (a['params'] as Row)['grant'] === grant?.id);
    expect(row, 'the grantor must be OFFERED revoke, not merely allowed it').toBeDefined();
    expect(row?.['max_direct_loss']).toBe(0);
    await act(grantor, 'revoke', row?.['params']);
    expect(h.runtime.grants.get(grant?.id as never)?.revokedAtTick, 'the menu row revoked it').not.toBeNull();
    run(1);
    expect(offered(await observation(grantor), 'revoke'), 'a dead grant has nothing left to revoke').toEqual([]);
  });

  it('★2 apply: an OPEN house is offered to a principal it would admit, by id', async () => {
    const founder = await enrolled('founder-a');
    const joiner = await enrolled('joiner-a');
    const id = await house(founder, { admission: 'OPEN', decision: 'MAJORITY', treasury_offices: true });
    const row = offered(await observation(joiner), 'apply').find((a) => (a['params'] as Row)['syndicate'] === id);
    expect(row, 'an OPEN house that would admit the reader must be on its menu').toBeDefined();
    await act(joiner, 'apply', row?.['params']);
    expect(h.runtime.syndicates.isMember(id as never, joiner.principalId as PrincipalId, h.runtime.engine.tick)).toBe(true);
    run(1);
    expect(
      offered(await observation(joiner), 'apply').some((a) => (a['params'] as Row)['syndicate'] === id),
      'a member is not offered admission again',
    ).toBe(false);
  });

  it('★3 approve: a sitting member is offered the open office proposal it has not approved', async () => {
    const founder = await enrolled('founder-p');
    const second = await enrolled('second-p');
    const third = await enrolled('third-p');
    const officer = await enrolled('officer-p');
    const id = await house(founder, { admission: 'OPEN', decision: 'MAJORITY', treasury_offices: true });
    await act(second, 'apply', { syndicate: id });
    await act(third, 'apply', { syndicate: id });
    await act(founder, 'grant', {
      template: 'custom',
      verbs: ['create'],
      max_direct_loss: 10_000,
      max_contingent_liability: 0,
      expires_tick: 600,
      delegate: officer.principalId,
      on_behalf_of: id,
    });
    const open = h.runtime.syndicates.openProposals(id as never, h.runtime.engine.tick);
    expect(open.length, 'non-vacuity: three members, so the proposal waits for a second approval').toBe(1);
    expect(offered(await observation(founder), 'approve'), 'the proposer has already approved').toEqual([]);
    const row = offered(await observation(second), 'approve').find((a) => (a['params'] as Row)['proposal'] === open[0]?.id);
    expect(row, 'a member that has not approved must be offered the approval').toBeDefined();
    await act(second, 'approve', row?.['params']);
    expect(
      h.runtime.grants.forDelegate(officer.principalId as PrincipalId).some((g) => String(g.grantor) === id),
      'the menu row carried the office',
    ).toBe(true);
  });

  it('★4 a delegate is told, by verb, what it may do in its grantor\'s name — counted, with the call', async () => {
    const grantor = await enrolled('grantor-d');
    const delegate = await enrolled('delegate-d');
    await act(grantor, 'grant', {
      delegate: delegate.principalId,
      template: 'quartermaster',
      max_direct_loss: 50_000,
      max_contingent_liability: 50_000,
      expires_tick: 400,
    });
    const grant = h.runtime.grants.forDelegate(delegate.principalId as PrincipalId)[0];
    expect(grant, 'non-vacuity: the delegate holds a grant').toBeDefined();
    const withheld = (await observation(delegate))['header'] as Row;
    const w = withheld['withheld'] as Row;
    expect(w['verbs'] as string[], 'the delegated verb is accounted for').toContain('create');
    expect(String(w['reason'])).toContain(`"on_behalf_of": "${String(grant?.grantor)}"`);
    expect(String(w['reason'])).toContain(String(grant?.id));
    expect(Number(w['count'])).toBeGreaterThan(0);
  });
});
