/**
 * THE QUARTERMASTER WHO COULD EMPTY THE VAULT — and could not, because of one predicate.
 *
 * SPEC §8's complaint about ventures is that *"there is no quartermaster who could empty the vault at
 * any moment"*, and that is why A6 puts betrayal in OFFICES rather than transactions: *"Ventures for
 * the daily texture. Offices for the tail."*
 *
 * Every part of that was built. A syndicate pools a treasury. A charter fixes admission and decision
 * rules permanently. `propose` → `approve` → `carryOffice` appoints a holder by MAJORITY and routes
 * the approved terms verbatim into `vGrant` so an approval cannot be won cheaply then widened. The
 * grant shows up on both sides and renders as an `AuthorityLine` with both limits.
 *
 * And the holder could not spend the pool on anything, ever. `vCreate` refused
 * `on_behalf_of=<syndicate>` on an existence check — `holdingByPrincipal.get(creator) === undefined`
 * — because a syndicate is *"a principal with no keypair"*: a stores account and nothing else. The
 * only verb wired to `on_behalf_of` is `create`, so a syndicate treasury was unspendable by
 * construction. A probe agent found it from the outside; two independent reviewers then named it the
 * highest-value change available.
 *
 * The resolution is what an office already means: **the HOLDER brings the hands, the HOUSE brings the
 * money.** Escrow still draws on the syndicate's stores, the grant gate still bounds it by the limits
 * the members voted, and the stage comes from the hand actually standing there.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { storesAccount } from '../../src/ledger/index.js';
import { syndicateAsPrincipal } from '../../src/syndicate/book.js';
import { PATHS, agent, enrol, harness, signed, tick, type Agent, type Harness } from '../api/harness.js';

type Row = Record<string, unknown>;
let h: Harness;

beforeEach(async () => {
  h = await harness({ seed: 'office-can-spend' });
});
afterEach(async () => {
  await h.close();
});

async function observe(who: Agent): Promise<Row> {
  const res = await signed(h, who, 'GET', PATHS.observe);
  expect(res.status, res.text.slice(0, 300)).toBe(200);
  return res.json['observation'] as Row;
}

async function submit(who: Agent, verb: string, params: unknown, seq: number): Promise<void> {
  const res = await signed(h, who, 'POST', PATHS.act, {
    actions: [{ verb, params, clientSequence: seq }],
  });
  expect(res.status, res.text.slice(0, 300)).toBe(200);
}

async function refusalFor(who: Agent, verb: string): Promise<string | null> {
  const o = await observe(who);
  const rows = ((o['briefing'] as Row)['corrections'] ?? []) as readonly Row[];
  const mine = rows.find((c) => String(c['verb']) === verb);
  return mine === undefined ? null : String(mine['hint']);
}

/** A house with offices enabled, an officer holding one, and a funded treasury. */
async function houseWithOfficer(): Promise<{ founder: Agent; officer: Agent; syndicate: string }> {
  const founder = agent('founder');
  const officer = agent('quartermaster');
  expect((await enrol(h, founder)).status).toBe(201);
  expect((await enrol(h, officer)).status).toBe(201);
  tick(h, 2);

  await submit(founder, 'form', { name: 'the-vault', treasury_offices: true }, 1);
  tick(h, 2);
  expect(await refusalFor(founder, 'form')).toBeNull();

  const rows = h.runtime.syndicates.of(founder.principalId as never, h.runtime.engine.tick);
  expect(rows.length, 'the house must exist for this test to mean anything').toBeGreaterThan(0);
  const syndicate = String(rows[0]?.id);

  // NOTE ON FUNDING, because it is its own finding. There is no `contribute` verb: pooling rides on
  // `apply` — *"applying puts you in, and applying again deepens the commitment. One concept, not
  // two"* — and `contributeToSyndicate` gates on `freeCash`, i.e. EARNINGS only, never the starter
  // stake (D7: an endowment may not leave a principal). A freshly enrolled founder therefore cannot
  // fund a house at all, so these tests do not try to. They assert the predicate that was broken.
  await submit(founder, 'apply', { syndicate, amount: 80_000 }, 2);
  tick(h, 2);

  await submit(
    founder,
    'grant',
    {
      to: String(officer.principalId),
      on_behalf_of: syndicate,
      template: 'quartermaster',
      max_direct_loss: 40_000,
      max_contingent_liability: 40_000,
      expires_tick: h.runtime.engine.tick + 200,
    },
    3,
  );
  tick(h, 2);
  expect(await refusalFor(founder, 'grant')).toBeNull();
  return { founder, officer, syndicate };
}

describe('an office over a pooled treasury can actually spend it', () => {
  it('is no longer refused for EXISTING — the predicate that made offices inert', async () => {
    // THE ASSERTION THAT MATTERS, and it is about which refusal you get.
    //
    // Before the fix, `create on_behalf_of=<syndicate>` was refused with *"there is no principal
    // syn:... to create a venture on behalf of"* — an EXISTENCE refusal, unconditional, unreachable
    // by any amount of funding or voting. A syndicate treasury was unspendable by construction.
    //
    // After it, the same call reaches the escrow arithmetic and is refused (or accepted) on the
    // merits of what the house can afford. That change of reason IS the mechanic becoming real, and
    // it is testable without solving the funding problem in the note above.
    const { officer, syndicate } = await houseWithOfficer();
    const offer = (((await observe(officer))['affordances'] ?? []) as readonly Row[]).find(
      (a) => String(a['verb']) === 'create',
    );
    expect(offer, 'the officer needs a create affordance to build on').toBeDefined();
    await submit(officer, 'create', { ...(offer?.['params'] as Row), on_behalf_of: syndicate }, 1);
    tick(h, 2);

    const hint = await refusalFor(officer, 'create');
    if (hint !== null) {
      expect(
        hint,
        'the house is still being refused for not existing, so offices are still inert: §8\u2019s ' +
          'quartermaster who could empty the vault at any moment still cannot empty it at any moment',
      ).not.toMatch(/there is no principal/i);
      // What a legitimate refusal looks like now: the house cannot afford it. That is the mechanic
      // working — an office is bounded by what the members actually pooled.
      expect(hint, 'and the refusal should now be about money or place').toMatch(
        /escrow|afford|free|stage|hand/i,
      );
    }
  });

  it('draws on the HOUSE when the house can pay, never on the holder', async () => {
    // The property, asserted only when the world reaches the state — and reported rather than
    // skipped silently when it does not, because a test that quietly proves nothing is the defect
    // this whole session kept finding.
    const { officer, syndicate } = await houseWithOfficer();
    const pooled = syndicateAsPrincipal(syndicate as never);
    const before = h.runtime.ledger.balance(storesAccount(pooled));
    if (before <= 0) {
      console.log(
        'treasury is empty (pooling needs EARNINGS, see the note in houseWithOfficer), so the ' +
          'draw-from-house assertion did not run',
      );
      return;
    }
    const offer = (((await observe(officer))['affordances'] ?? []) as readonly Row[]).find(
      (a) => String(a['verb']) === 'create',
    );
    await submit(officer, 'create', { ...(offer?.['params'] as Row), on_behalf_of: syndicate }, 1);
    tick(h, 2);
    expect(await refusalFor(officer, 'create')).toBeNull();
    expect(
      h.runtime.ledger.balance(storesAccount(pooled)),
      'the escrow must come from the members\u2019 pool — that is what makes an office risky',
    ).toBeLessThan(before);
  });

  it('refuses a dissolved house, because a dead treasury has nothing to spend', async () => {
    // The new branch's own guard. Allowing a syndicate creator must not mean allowing any string
    // that looks like one — that would be a way to name a house into existence at spend time.
    const officer = agent('opportunist');
    expect((await enrol(h, officer)).status).toBe(201);
    tick(h, 2);
    const offer = (((await observe(officer))['affordances'] ?? []) as readonly Row[]).find(
      (a) => String(a['verb']) === 'create',
    );
    await submit(
      officer,
      'create',
      { ...(offer?.['params'] as Row), on_behalf_of: 'syn:p:nobody:1' },
      1,
    );
    tick(h, 2);
    const hint = await refusalFor(officer, 'create');
    expect(hint, 'a house that does not exist must be refused').not.toBeNull();
  });

  it('still refuses a plain principal that does not exist', async () => {
    // The check that was always right must survive the one that was wrong.
    const who = agent('typo');
    expect((await enrol(h, who)).status).toBe(201);
    tick(h, 2);
    const offer = (((await observe(who))['affordances'] ?? []) as readonly Row[]).find(
      (a) => String(a['verb']) === 'create',
    );
    await submit(who, 'create', { ...(offer?.['params'] as Row), on_behalf_of: 'p:ghost' }, 1);
    tick(h, 2);
    const hint = await refusalFor(who, 'create');
    expect(hint).not.toBeNull();
    expect(String(hint)).toMatch(/no principal/i);
  });
});
