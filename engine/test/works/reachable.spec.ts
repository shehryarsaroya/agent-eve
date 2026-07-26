import { describe, expect, it } from 'vitest';
import type { PrincipalId } from '../../src/core/types.js';
import { storesAccount } from '../../src/ledger/index.js';
import { freeCash } from '../../src/market/escrow.js';
import { PATHS, agent, enrol, harness, signed, tick } from '../api/harness.js';

describe('a real agent can find and take the WORKS build over HTTP', () => {
  it('reads it out of affordances[] and the world extracts for it', async () => {
    const h = await harness({ seed: 'reach' });
    try {
      const who = agent('reacher');
      expect((await enrol(h, who)).status).toBe(201);
      // Two funders: a WORKS costs 60,000 of EARNINGS and the floor withholds the whole
      // starter stake, so income has to clear 250,000 before the first spendable unit exists.
      // One enrolment's stake cannot do it, which is itself the D10b finding in miniature.
      const funders = [agent('bank-a'), agent('bank-b')];
      for (const f of funders) expect((await enrol(h, f)).status).toBe(201);
      tick(h, 1);
      const p = who.principalId as PrincipalId;

      // Before earnings: legal, unaffordable, and COUNTED with its price — not dropped.
      let obs = (await signed(h, who, 'GET', PATHS.observe)).json['observation'] as Record<string, unknown>;
      const works = (obs['holding'] as Record<string, unknown>)['works'] as Record<string, unknown>;
      const here = works['here'] as Record<string, unknown>;
      expect(here['affordable'], 'the stake cannot buy one').toBe(false);
      expect(Number(here['share_per_tick']), 'but the share is quoted anyway, so it can plan').toBeGreaterThan(0);
      expect(String((obs['header'] as Record<string, unknown>)['withheld']))
        .toBeDefined();

      // Earnings arrive.
      for (const [i, f] of funders.entries()) {
        h.runtime.ledger.transferCurrency({
          eventId: `test.income:reach:${String(i)}` as never,
          tick: h.runtime.engine.tick,
          from: storesAccount(f.principalId as PrincipalId),
          to: storesAccount(p),
          amount: 200_000 as never,
        });
      }

      // The premise of the rest of the test. If income did not land, everything below is
      // testing the wrong thing — which is exactly how a vacuous test happens.
      expect(h.runtime.ledger.balance(storesAccount(p)), 'income landed').toBeGreaterThan(600_000);
      expect(freeCash(h.runtime.ledger, p), 'and cleared the endowment floor').toBeGreaterThan(60_000);
      // ── AND A TICK, BECAUSE AN OBSERVATION IS A SNAPSHOT ────────────────────
      //
      // Agents act from snapshot T and valid actions land in T+1, so an observation does not
      // see currency that arrived inside the current tick. Not a quirk to work around — it is
      // the rule that makes within-tick actions unable to react to each other, and a test that
      // read live state here would be asserting something no agent can ever observe.
      h.runtime.runTick();

      obs = (await signed(h, who, 'GET', PATHS.observe)).json['observation'] as Record<string, unknown>;
      const offer = (obs['affordances'] as Record<string, unknown>[]).find(
        (a) => a['verb'] === 'build' && (a['params'] as Record<string, unknown>)['kind'] === 'WORKS',
      );
      expect(offer, 'THE LAST MILE: it must be ON the affordance list, not merely legal').toBeDefined();
      expect(String(offer?.['what_it_forecloses']), 'and it must say the share falls as others arrive')
        .toMatch(/share.*FALLS|FALLS as others/i);

      // Copied verbatim, it must resolve with no corrections.
      const res = await signed(h, who, 'POST', PATHS.act, {
        actions: [{ verb: 'build', params: offer?.['params'], clientSequence: 1 }],
      });
      expect(res.status).toBe(200);
      h.runtime.runTick();
      expect(
        h.runtime.takeCorrections(p).map((c) => `${c.verb}/${c.invariant}: ${c.hint}`),
        'an offered affordance copied verbatim must never be refused (AGT-S2)',
      ).toEqual([]);
      expect(h.runtime.worksOf(p).length, 'and the WORKS stands').toBe(1);
    } finally {
      await h.close();
    }
  });
});
