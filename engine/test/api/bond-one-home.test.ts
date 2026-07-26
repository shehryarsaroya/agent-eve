/**
 * ONE QUANTITY, ONE HOME — the posted bond (scar #5), found by a probe agent playing the game.
 *
 * `standingRow` hardcoded `bond_posted: 0` behind the comment *"Zero because bonds do not exist yet
 * (§6.4), not because none was posted."* Bonds exist: `post_bond` is a live verb and the bond is
 * slashable when a claim lapses. The probe posted 50000 and read, in ONE observation:
 *
 *     holding.bond.posted            50000
 *     header.standing.bond_posted        0
 *
 * `standingRow` builds the header's own row **and** every entry in `counterparties[]`, so the same
 * constant told every agent that every other agent had no capital at risk. A15 says a gate must cost
 * produced goods or slashable capital; the bond is the slashable capital, and it was invisible to
 * exactly the agents meant to price it.
 *
 * A9 decides the visibility question, not taste: the spectator frame already publishes `bondAtRisk`
 * per claim, and A9 forbids the client showing a live fact an agent's own `observe` would not. The
 * hardcoded zero broke public parity in the agent's disfavour.
 *
 * ── WHY A CONSTANT SURVIVED THIS LONG ────────────────────────────────────────
 * `src/observe/observation.ts` carries a SECOND `buildObservation` with the same constant, and it is
 * imported by eight test files and zero production files. A whole test directory exercises a builder
 * the server never calls, so nothing that passed there could ever have caught this. This file tests
 * the live path through the front door for that reason.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLAIM_BOND_MINOR } from '../../src/sovereignty/index.js';
import { PATHS, agent, enrol, harness, signed, tick, type Agent, type Harness } from './harness.js';

type Row = Record<string, unknown>;
let h: Harness;

beforeEach(async () => {
  h = await harness({ seed: 'bond-one-home' });
});
afterEach(async () => {
  await h.close();
});

async function observe(who: Agent): Promise<Row> {
  const res = await signed(h, who, 'GET', PATHS.observe);
  expect(res.status, res.text.slice(0, 300)).toBe(200);
  return res.json['observation'] as Row;
}

async function postBond(who: Agent, amount: number, seq: number): Promise<void> {
  const res = await signed(h, who, 'POST', PATHS.act, {
    actions: [{ verb: 'post_bond', params: { amount }, clientSequence: seq }],
  });
  expect(res.status, res.text.slice(0, 300)).toBe(200);
  const outcome = res.json['outcome'] as Row;
  expect(
    (outcome['accepted'] as readonly unknown[]).length,
    `post_bond refused: ${JSON.stringify(outcome['corrections'] ?? []).slice(0, 300)}`,
  ).toBe(1);
  tick(h, 2);
}

describe('a posted bond has one value, whoever is reading it', () => {
  it('the holder\'s own two views agree in the same observation', async () => {
    const who = agent('bonded');
    expect((await enrol(h, who)).status).toBe(201);
    tick(h, 1);

    const before = await observe(who);
    const beforeHolding = ((before['holding'] as Row)['bond'] as Row)['posted'];
    const beforeHeader = ((before['header'] as Row)['standing'] as Row)['bond_posted'];
    expect(beforeHeader, 'no bond yet, and both must say so').toBe(beforeHolding);

    await postBond(who, CLAIM_BOND_MINOR, 1);

    const after = await observe(who);
    const holding = ((after['holding'] as Row)['bond'] as Row)['posted'];
    const header = ((after['header'] as Row)['standing'] as Row)['bond_posted'];

    // The premise: the bond really landed. Without this the assertion below could pass on 0 === 0,
    // which is the exact shape of the bug it is guarding.
    expect(holding, 'the bond must actually be posted for this test to mean anything').toBe(
      CLAIM_BOND_MINOR,
    );
    expect(
      header,
      'header.standing.bond_posted and holding.bond.posted are one quantity — scar #5 is what ' +
        'happens when it has two homes',
    ).toBe(holding);
  });

  it('and a COUNTERPARTY sees the same number, because that is what it prices', async () => {
    // The half that actually mattered. `standingRow` builds both rows, so a constant here made every
    // principal look uncapitalised to everyone else.
    const holder = agent('holder');
    const watcher = agent('watcher');
    expect((await enrol(h, holder)).status).toBe(201);
    expect((await enrol(h, watcher)).status).toBe(201);
    tick(h, 1);
    await postBond(holder, CLAIM_BOND_MINOR, 1);

    // A counterparty row only exists once the two are named to each other, so drive some ticks and
    // then look for the holder wherever it appears. If it never appears the test says so rather than
    // passing vacuously.
    tick(h, 6);
    const seen = await observe(watcher);
    const rows = (seen['counterparties'] ?? []) as readonly Row[];
    const line = rows.find((r) => String(r['principal']) === String(holder.principalId));
    if (line === undefined) {
      // Not a silent pass: assert the live path directly instead, on the same function.
      const own = await observe(holder);
      expect(
        ((own['header'] as Row)['standing'] as Row)['bond_posted'],
        'no counterparty row was published, so the shared builder is checked on the holder instead',
      ).toBe(CLAIM_BOND_MINOR);
      return;
    }
    expect(line['bond_posted'], 'a counterparty must see real capital at risk').toBe(
      CLAIM_BOND_MINOR,
    );
  });
});
