/**
 * An OFFICE is a grant whose grantor is a syndicate, and that sentence is the whole feature.
 *
 * A6 — betrayal through legitimate authority — has been live at *grant scale* since the core loop
 * landed: one principal, its own stores. §365's real object is standing authority over an
 * ORGANISATION's treasury, because that is where the sums are large enough for the abuse to be a
 * legend rather than a dispute.
 *
 * D11 chose to make a syndicate a principal-shaped subject specifically so this would be cheap: the
 * grant path already carries scoped authority, shows both loss limits before signing (A7), has
 * INV-22/23 on the spend counter and lives in `state_hash`. **If offices had turned out expensive,
 * the design would have been wrong** — so the assertions below deliberately check that the ordinary
 * grant guarantees came along, rather than checking a new mechanism.
 *
 * The other half is the charter doing its only job. Every gate here is a clause a member relied on
 * when it handed over goods it cannot retrieve on demand.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PrincipalId } from '../../src/core/types.js';
import { storesAccount } from '../../src/ledger/index.js';
import { PATHS, agent, enrol, harness, signed, tick, type Agent, type Harness } from '../api/harness.js';

let h: Harness;

beforeEach(async () => {
  h = await harness({ seed: 'offices' });
});
afterEach(async () => {
  await h.close();
});

function run(n: number): void {
  for (let i = 0; i < n; i += 1) {
    const r = h.runtime.runTick();
    expect(
      r.halted,
      `halted at ${String(r.tick)}: ${r.violations.map((v) => `${v.id} ${v.message}`).join(' | ')}`,
    ).toBe(false);
  }
}

async function act(who: Agent, verb: string, params: unknown): Promise<void> {
  const res = await signed(h, who, 'POST', PATHS.act, {
    actions: [{ verb, params, clientSequence: 1 }],
  });
  expect(res.status, res.text.slice(0, 400)).toBe(200);
}

function corrections(who: Agent): string {
  return h.runtime
    .takeCorrections(who.principalId as PrincipalId)
    .map((c) => c.hint)
    .join(' | ');
}

async function enrolled(handle: string): Promise<Agent> {
  const who = agent(handle);
  expect((await enrol(h, who)).status).toBe(201);
  tick(h, 1);
  return who;
}

async function foundedBy(who: Agent, charter: Record<string, unknown>): Promise<string> {
  await act(who, 'form', { name: 'The Company', ...charter });
  run(1);
  const id = h.runtime.syndicates.of(who.principalId as PrincipalId, h.runtime.engine.tick)[0]?.id;
  expect(id, `forming must succeed: ${corrections(who)}`).toBeDefined();
  return String(id);
}

const OFFICE = {
  template: 'custom',
  max_direct_loss: 10_000,
  max_contingent_liability: 0,
  expires_tick: 600,
};

describe('an office is an ordinary grant, pointed at a treasury', () => {
  it('appoints a delegate over the pool and records the syndicate as grantor', async () => {
    const founder = await enrolled('chair');
    const officer = await enrolled('officer');
    const id = await foundedBy(founder, { decision: 'FOUNDER', treasury_offices: true });

    await act(founder, 'grant', { ...OFFICE, delegate: officer.principalId, on_behalf_of: id });
    run(1);
    expect(corrections(founder), 'an office appointment must not be refused').toBe('');

    // THE ASSERTION: the grant book records the SYNDICATE as grantor, not the founder. That is what
    // makes the authority survive the founder and what makes the treasury the thing at risk.
    // `h.runtime.grants.forDelegate(...)` — a REAL accessor, not an optional chain. The first draft
    // of this test used `h.runtime.grantsOf?.(...) ?? []`, which returns an empty array when the
    // method does not exist, so it could never fail for the right reason. Two assertions here were
    // checking nothing at all until the last test in this file exposed it.
    const office = h.runtime.grants
      .forDelegate(officer.principalId as PrincipalId)
      .find((g) => String(g.grantor) === id);
    expect(office, 'the delegate holds authority whose grantor is the syndicate').toBeDefined();
    expect(String(office?.grantor), 'the treasury is what is at risk, not the founder purse').toBe(id);
  });

  it('brings the A7 loss limits with it, because it is the same mechanism', async () => {
    const founder = await enrolled('chair2');
    const officer = await enrolled('officer2');
    const id = await foundedBy(founder, { decision: 'FOUNDER', treasury_offices: true });
    await act(founder, 'grant', { ...OFFICE, delegate: officer.principalId, on_behalf_of: id });
    run(1);
    const office = h.runtime.grants
      .forDelegate(officer.principalId as PrincipalId)
      .find((g) => String(g.grantor) === id);
    expect(office, 'the office exists').toBeDefined();
    // Not a new field list — the ordinary grant's, which is the point of doing it this way.
    expect(Number(office?.maxDirectLoss)).toBe(OFFICE.max_direct_loss);
  });
});

describe('the charter is what a member relied on, and it is enforced here', () => {
  it('refuses an office when treasury_offices is FALSE, and says it can never change', async () => {
    const founder = await enrolled('strongbox');
    const officer = await enrolled('hopeful');
    const id = await foundedBy(founder, { decision: 'FOUNDER', treasury_offices: false });
    await act(founder, 'grant', { ...OFFICE, delegate: officer.principalId, on_behalf_of: id });
    run(1);
    const said = corrections(founder);
    expect(said).toMatch(/treasury_offices FALSE/);
    expect(said, 'and that the clause is permanent, so nobody waits for it to change').toMatch(
      /permanent|no verb that amends/,
    );
    expect(said, 'and what to do instead').toMatch(/a different syndicate/i);
  });

  it('refuses a non-member outright', async () => {
    const founder = await enrolled('insider');
    const outsider = await enrolled('outsider');
    const officer = await enrolled('officer3');
    const id = await foundedBy(founder, { decision: 'FOUNDER', treasury_offices: true });
    await act(outsider, 'grant', { ...OFFICE, delegate: officer.principalId, on_behalf_of: id });
    run(1);
    expect(corrections(outsider)).toMatch(/not a sitting member/);
  });

  it('refuses a FOUNDER-charter appointment made by somebody who is not the founder', async () => {
    const founder = await enrolled('boss');
    const member = await enrolled('member');
    const officer = await enrolled('officer4');
    const id = await foundedBy(founder, { decision: 'FOUNDER', treasury_offices: true, admission: 'OPEN' });
    h.runtime.syndicates.admit(id as never, member.principalId as PrincipalId, h.runtime.engine.tick);
    run(1);
    await act(member, 'grant', { ...OFFICE, delegate: officer.principalId, on_behalf_of: id });
    run(1);
    expect(corrections(member)).toMatch(/only .* may appoint/);
  });

  it('refuses a MAJORITY charter as a RULE, not as a missing feature', async () => {
    // The distinction matters. `approve` has no handler yet, so a majority charter genuinely cannot
    // appoint — but the refusal states the constitution ("your charter needs the agreement of its
    // sitting members"), which is true whether or not the verb exists. An engine limitation phrased
    // as a rule is a lie; a rule that happens to also be a limitation is just the rule.
    const founder = await enrolled('democrat');
    const officer = await enrolled('officer5');
    const id = await foundedBy(founder, { decision: 'MAJORITY', treasury_offices: true });
    await act(founder, 'grant', { ...OFFICE, delegate: officer.principalId, on_behalf_of: id });
    run(1);
    const said = corrections(founder);
    expect(said).toMatch(/decision MAJORITY/);
    expect(said, 'names whose agreement is needed').toMatch(/sitting member/);
    expect(said, 'and never blames an unbuilt verb').not.toMatch(/not implemented|unbuilt|coming soon/i);
  });
});

describe('an ordinary personal grant is untouched by any of this', () => {
  it('still works with no on_behalf_of at all', async () => {
    const a = await enrolled('plain-a');
    const b = await enrolled('plain-b');
    await act(a, 'grant', { ...OFFICE, delegate: b.principalId });
    run(1);
    expect(corrections(a), 'the office path must not have changed the personal path').toBe('');
    expect(
      h.runtime.grants.forDelegate(b.principalId as PrincipalId).length,
      'b holds authority over a',
    ).toBeGreaterThan(0);
    expect(
      h.runtime.ledger.balance(storesAccount(a.principalId as PrincipalId)),
      'and granting costs no currency',
    ).toBeGreaterThan(0);
  });
});
