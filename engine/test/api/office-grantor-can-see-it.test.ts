/**
 * BOTH SIDES OF AN OFFICE READ THE SAME ROW (A6, §8.1) — and the grantor side could not read it.
 *
 * A probe agent formed a syndicate, granted an office over its pooled treasury, and watched the
 * delegate's `grants.held[]` show the office perfectly while its own `grants.granted[]` stayed `[]`
 * forever. The cause: `granted` was `forGrantor(principal)`, and an office grant's grantor is the
 * syndicate's id (`syn:<founder>:<tick>`), never the founder's.
 *
 * §8.1's stated point is that both roles read the same row *so the two sides cannot disagree*. Here
 * the grantor side could not read it at all, which is worse than disagreeing — the party carrying
 * `max_direct_loss` and `max_contingent_liability` had no way to watch the spend it had signed for.
 *
 * Scoped to syndicates the reader SITS IN. Not a widening: members vote offices into existence
 * through `propose`/`approve`, so a member being unable to see what it voted for is the anomaly.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PATHS, agent, enrol, harness, signed, tick, type Agent, type Harness } from './harness.js';

type Row = Record<string, unknown>;
let h: Harness;

beforeEach(async () => {
  h = await harness({ seed: 'office-grantor' });
});
afterEach(async () => {
  await h.close();
});

async function observe(who: Agent): Promise<Row> {
  const res = await signed(h, who, 'GET', PATHS.observe);
  expect(res.status, res.text.slice(0, 300)).toBe(200);
  return res.json['observation'] as Row;
}

async function act(who: Agent, verb: string, params: Row, seq: number): Promise<Row> {
  const res = await signed(h, who, 'POST', PATHS.act, {
    actions: [{ verb, params, clientSequence: seq }],
  });
  expect(res.status, res.text.slice(0, 300)).toBe(200);
  return res.json['outcome'] as Row;
}

/** The correction for a verb, if the engine refused it — readable only after the tick lands. */
async function refusalFor(who: Agent, verb: string): Promise<string | null> {
  const o = await observe(who);
  const rows = ((o['briefing'] as Row)['corrections'] ?? []) as readonly Row[];
  const mine = rows.find((c) => String(c['verb']) === verb);
  return mine === undefined ? null : String(mine['hint']);
}

describe('a founder can see the offices its syndicate issued', () => {
  it('the grant appears in the grantor\'s `granted[]`, not only the delegate\'s `held[]`', async () => {
    const founder = agent('founder');
    const officer = agent('officer');
    expect((await enrol(h, founder)).status).toBe(201);
    expect((await enrol(h, officer)).status).toBe(201);
    tick(h, 2);

    await act(founder, 'form', { name: 'the-bond-house', treasury_offices: true }, 1);
    tick(h, 2);
    const formRefusal = await refusalFor(founder, 'form');
    expect(formRefusal, `form was refused: ${String(formRefusal)}`).toBeNull();

    // The syndicate id is not published anywhere an agent can read (D13 §4), so the test asks the
    // book rather than guessing at `syn:<founder>:<tick>` — which is exactly what the probe had to
    // do by hand, and is its own open item.
    const mine = h.runtime.syndicates.of(founder.principalId as never, h.runtime.engine.tick);
    expect(mine.length, 'the syndicate must exist for this test to mean anything').toBeGreaterThan(0);
    const syndicate = String(mine[0]?.id);

    await act(
      founder,
      'grant',
      {
        to: String(officer.principalId),
        on_behalf_of: syndicate,
        template: 'treasury-hand',
        max_direct_loss: 5_000,
        max_contingent_liability: 5_000,
        expires_tick: h.runtime.engine.tick + 100,
      },
      2,
    );
    tick(h, 2);
    const grantRefusal = await refusalFor(founder, 'grant');
    expect(grantRefusal, `the office grant was refused: ${String(grantRefusal)}`).toBeNull();

    // The delegate side — which always worked, and is the control.
    const held = ((await observe(officer))['grants'] as Row)['held'] as readonly Row[];
    expect(held.length, 'the delegate must hold the office (this side was never broken)').toBe(1);

    // The half that was broken.
    const granted = ((await observe(founder))['grants'] as Row)['granted'] as readonly Row[];
    expect(
      granted.length,
      'the founder issued this office and must be able to watch it — an office whose grantor ' +
        'cannot read it is A6 legibility failing on the side that carries the liability',
    ).toBe(1);
    // And it is the SAME row, which is §8.1's actual requirement.
    expect(granted[0]?.['id']).toBe(held[0]?.['id']);
    expect(granted[0]?.['max_direct_loss']).toBe(held[0]?.['max_direct_loss']);
  });

  it('does not show a principal offices issued by a syndicate it does not sit in', async () => {
    // The scope, asserted rather than assumed. Without this the fix could be "show everyone every
    // office", which would be a real disclosure widening dressed up as a bug fix.
    const founder = agent('insider');
    const officer = agent('deputy');
    const stranger = agent('outsider');
    for (const who of [founder, officer, stranger]) {
      expect((await enrol(h, who)).status).toBe(201);
    }
    tick(h, 2);

    await act(founder, 'form', { name: 'closed-house', treasury_offices: true }, 1);
    tick(h, 2);
    const mine = h.runtime.syndicates.of(founder.principalId as never, h.runtime.engine.tick);
    expect(mine.length).toBeGreaterThan(0);
    await act(
      founder,
      'grant',
      {
        to: String(officer.principalId),
        on_behalf_of: String(mine[0]?.id),
        template: 'treasury-hand',
        max_direct_loss: 5_000,
        max_contingent_liability: 5_000,
        expires_tick: h.runtime.engine.tick + 100,
      },
      2,
    );
    tick(h, 2);
    expect(await refusalFor(founder, 'grant')).toBeNull();

    const granted = ((await observe(stranger))['grants'] as Row)['granted'] as readonly Row[];
    expect(granted, 'a non-member must not read another house\'s offices').toEqual([]);
  });
});
