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
  // ★ `custom` grants NOTHING on either axis unless it is named (`RULES_VERSION` 23), so the fence
  // is explicit here. That is the template working as designed rather than a fixture patch: the
  // escape hatch is deliberately the narrowest option, because a default that quietly filled in
  // the widest one would make the safest-looking word the most dangerous.
  verbs: ['create', 'elect'],
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

  it('turns a MAJORITY appointment into a PROPOSAL rather than refusing it', async () => {
    // This test used to assert a REFUSAL, and the refusal was honest at the time — `approve` had no
    // handler, so a majority charter genuinely could not appoint. But MAJORITY is the DEFAULT
    // charter, so the default syndicate could never do the one thing syndicates exist for. Now the
    // appointment becomes a proposal its members answer.
    const founder = await enrolled('democrat');
    const officer = await enrolled('officer5');
    const id = await foundedBy(founder, { decision: 'MAJORITY', treasury_offices: true });

    await act(founder, 'grant', { ...OFFICE, delegate: officer.principalId, on_behalf_of: id });
    run(1);
    expect(corrections(founder), 'proposing must not be refused').toBe('');

    // A single-member MAJORITY is one approval, and proposing IS agreeing — so it carries at once
    // and the office exists. A founder that had to approve its own proposal separately would spend
    // two actions to express one intention.
    const office = h.runtime.grants
      .forDelegate(officer.principalId as PrincipalId)
      .find((g) => String(g.grantor) === id);
    expect(office, 'a one-member majority carries immediately').toBeDefined();
  });

  it('needs a real majority once there is more than one member', async () => {
    const founder = await enrolled('chair6');
    const second = await enrolled('member6');
    const third = await enrolled('member6b');
    const officer = await enrolled('officer6');
    const id = await foundedBy(founder, {
      decision: 'MAJORITY',
      treasury_offices: true,
      admission: 'OPEN',
    });
    for (const m of [second, third]) {
      h.runtime.syndicates.admit(id as never, m.principalId as PrincipalId, h.runtime.engine.tick);
    }
    run(1);
    expect(h.runtime.syndicates.sittingMembers(id as never, h.runtime.engine.tick).length).toBe(3);

    await act(founder, 'grant', { ...OFFICE, delegate: officer.principalId, on_behalf_of: id });
    run(1);
    // Three members means two approvals. The proposer has one, so nothing exists yet.
    expect(
      h.runtime.grants.forDelegate(officer.principalId as PrincipalId).length,
      'one of three is not a majority, so no authority exists yet',
    ).toBe(0);
    const open = h.runtime.syndicates.openProposals(id as never, h.runtime.engine.tick);
    expect(open.length, 'the proposal stands, waiting').toBe(1);
    expect(h.runtime.syndicates.approvalsNeeded(id as never, h.runtime.engine.tick)).toBe(2);

    // The second approval carries it, and the office that lands is an ordinary grant.
    await act(second, 'approve', { proposal: open[0]?.id });
    run(1);
    expect(corrections(second), 'approving must not be refused for a sitting member').toBe('');
    const office = h.runtime.grants
      .forDelegate(officer.principalId as PrincipalId)
      .find((g) => String(g.grantor) === id);
    expect(office, 'the second approval carries the appointment').toBeDefined();
    expect(Number(office?.maxDirectLoss), 'on the TERMS THAT WERE APPROVED, not resent ones').toBe(
      OFFICE.max_direct_loss,
    );
    expect(
      h.runtime.syndicates.openProposals(id as never, h.runtime.engine.tick).length,
      'and the proposal is closed, so it cannot carry twice',
    ).toBe(0);
  });

  it("does not count a departed member's approval — the threshold drops when they go", async () => {
    // THE EXPLOIT, and it took two attempts to state correctly. My first version asserted a case
    // where the guard and the mutation both returned false, so it proved nothing — the mutation
    // test is the only reason I know this one does.
    //
    // The shape is that leaving lowers the BAR as well as removing a voter. Four members need
    // three approvals. Collect two, one of them from a member who then leaves: now three sit, so
    // two are needed, and the stale approval plus the lower bar carries an appointment that never
    // had the agreement it required.
    const founder = await enrolled('chair8');
    const leaver = await enrolled('leaver8');
    const ally = await enrolled('ally8');
    const fourth = await enrolled('fourth8');
    const officer = await enrolled('officer8');
    const id = await foundedBy(founder, {
      decision: 'MAJORITY',
      treasury_offices: true,
      admission: 'OPEN',
    });
    for (const m of [leaver, ally, fourth]) {
      h.runtime.syndicates.admit(id as never, m.principalId as PrincipalId, h.runtime.engine.tick);
    }
    run(1);
    const tickNow = (): number => h.runtime.engine.tick;
    expect(h.runtime.syndicates.sittingMembers(id as never, tickNow()).length).toBe(4);
    expect(h.runtime.syndicates.approvalsNeeded(id as never, tickNow()), 'four need three').toBe(3);

    // The leaver proposes (one approval) and an ally agrees (two). Three are needed, so it stands.
    await act(leaver, 'grant', { ...OFFICE, delegate: officer.principalId, on_behalf_of: id });
    run(1);
    const open = h.runtime.syndicates.openProposals(id as never, tickNow());
    expect(open.length).toBe(1);
    const proposalId = open[0]?.id ?? '';
    await act(ally, 'approve', { proposal: proposalId });
    run(1);
    expect(
      h.runtime.grants.forDelegate(officer.principalId as PrincipalId).length,
      'two of four is not a majority, so nothing exists yet',
    ).toBe(0);

    // The leaver goes. Three sit, so two are needed — and two approvals are on record, one of them
    // from somebody who has left.
    h.runtime.syndicates.giveNotice(id as never, leaver.principalId as PrincipalId, tickNow() + 1);
    run(2);
    expect(h.runtime.syndicates.sittingMembers(id as never, tickNow()).length).toBe(3);
    expect(h.runtime.syndicates.approvalsNeeded(id as never, tickNow()), 'three need two').toBe(2);
    expect(
      h.runtime.syndicates.proposal(proposalId)?.approvals.length,
      'two approvals are still on the record',
    ).toBe(2);

    // THE ASSERTION: it must not carry, because only ONE of those two approvals is from a member
    // who is still there.
    expect(
      h.runtime.syndicates.carries(proposalId, tickNow()),
      'a stale approval plus a lowered bar must not carry an appointment',
    ).toBe(false);
  });

  it('does not let a non-member approve', async () => {
    const founder = await enrolled('chair7');
    const second = await enrolled('member7');
    const outsider = await enrolled('outsider7');
    const officer = await enrolled('officer7');
    const id = await foundedBy(founder, {
      decision: 'MAJORITY',
      treasury_offices: true,
      admission: 'OPEN',
    });
    h.runtime.syndicates.admit(id as never, second.principalId as PrincipalId, h.runtime.engine.tick);
    run(1);
    await act(founder, 'grant', { ...OFFICE, delegate: officer.principalId, on_behalf_of: id });
    run(1);
    const open = h.runtime.syndicates.openProposals(id as never, h.runtime.engine.tick);
    await act(outsider, 'approve', { proposal: open[0]?.id });
    run(1);
    expect(corrections(outsider)).toMatch(/not a sitting member/);
    expect(h.runtime.grants.forDelegate(officer.principalId as PrincipalId).length).toBe(0);
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
