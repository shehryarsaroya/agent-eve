/**
 * D7 through a verb that did not exist when D7 was written.
 *
 * ## The hole, and why a new feature reopened a closed one
 *
 * D7's finding was that enrolment mints capital and enrolment is free, so free identities
 * mint capital without limit — and A15 rules out every obvious defence, because capping
 * enrolments per operator *is* a gate priced in identities and detecting wash trades needs
 * intent, which A15 forbids ("the flow graph may **withhold credit**, never accuse").
 *
 * The sanctioned answer was to withhold: the endowment funds a principal's **own** work and
 * cannot leave it. `market/escrow.ts:freeCash` withholds `ENDOWMENT_FLOOR_MINOR` from a BID
 * and `sellableLots` withholds the starter allotment from an ASK. That closed the two
 * principal-to-principal paths **that existed at the time.**
 *
 * Sovereignty then added a third: `publish_offer {"cede":…,"price":N}` followed by `build`
 * moves currency from the taker to the incumbent. It read the raw `freeBalance`, so a puppet
 * could hand its operator the entire endowment through a legal cession at any asking price —
 * a wash trade dressed as a territorial transaction, violating nothing in the matcher because
 * it never touched the matcher. Measured before the fix: **150,000 crossed where 0 was
 * transferable.**
 *
 * The general lesson, which is why this test exists as a permanent guard rather than a
 * one-off: **D7 is not a property of the market, it is a property of every verb that moves
 * currency between principals.** A withholding rule enforced at each call site is a rule that
 * silently lapses every time somebody adds a call site. Any future verb that transfers
 * currency has to pass through `freeCash`, and this file is the test that fails when one
 * does not.
 *
 * The distinction that makes the rule fair rather than merely restrictive: a principal buying
 * territory with money it **earned** is entirely unaffected. Only the minted stake is pinned
 * in place, so a real agent playing alone never encounters this, and a sock puppet is worth
 * exactly zero — which was D7's whole objective.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import { storesAccount } from '../../src/ledger/index.js';
import { STARTER_STAKE } from '../../src/ledger/endowment.js';
import { freeCash } from '../../src/market/escrow.js';
import { CLAIM_BOND_MINOR } from '../../src/sovereignty/index.js';
import { PATHS, agent, enrol, harness, signed, tick, type Agent, type Harness } from '../api/harness.js';

type Row = Record<string, unknown>;
let h: Harness;

beforeEach(async () => {
  h = await harness({ seed: 'cession-endowment' });
});
afterEach(async () => {
  await h.close();
});

async function observe(who: Agent): Promise<Row> {
  const res = await signed(h, who, 'GET', PATHS.observe);
  expect(res.status, res.text.slice(0, 300)).toBe(200);
  return res.json['observation'] as Row;
}

function affordance(o: Row, verb: string, match?: (a: Row) => boolean): Row | undefined {
  return (o['affordances'] as Row[]).find(
    (a) => a['verb'] === verb && (match === undefined || match(a)),
  );
}

async function act(who: Agent, verb: string, params: unknown): Promise<Row> {
  const res = await signed(h, who, 'POST', PATHS.act, {
    actions: [{ verb, params, clientSequence: 1 }],
  });
  expect(res.status, `${verb}: ${res.text.slice(0, 400)}`).toBe(200);
  return res.json['outcome'] as Row;
}

function run(n: number): void {
  for (let i = 0; i < n; i += 1) {
    const r = h.runtime.runTick();
    expect(
      r.halted,
      `the world halted at ${String(r.tick)}: ${r.violations.map((v) => `${v.id} ${v.message}`).join(' | ')}`,
    ).toBe(false);
  }
}

/**
 * Take an offered affordance. `kind` disambiguates `build`, which is two different acts —
 * ANCHOR takes territory, WORKS raises a production structure — and matching on the verb alone
 * takes whichever the ranking happened to put first.
 */
async function takeOffered(who: Agent, verb: string, kind?: string): Promise<void> {
  const offer = affordance(
    await observe(who),
    verb,
    kind === undefined ? undefined : (a) => (a['params'] as Row)['kind'] === kind,
  );
  expect(offer, `${verb}${kind === undefined ? '' : ` ${kind}`} must be offered`).toBeDefined();
  await act(who, verb, offer?.['params']);
  tick(h, 1);
}

function balance(who: Agent): number {
  return h.runtime.ledger.balance(storesAccount(who.principalId as PrincipalId));
}

describe('the endowment cannot leave a principal through a cession price (D7 · A15)', () => {
  it('a puppet asked for everything it has moves only what it earned, which is nothing', async () => {
    // The operator takes territory the honest way.
    const boss = agent('boss');
    expect((await enrol(h, boss)).status).toBe(201);
    tick(h, 1);
    for (const verb of ['graduate', 'post_bond'] as const) await takeOffered(boss, verb);
    await takeOffered(boss, 'build', 'ANCHOR');
    const system = String(((await observe(boss))['holding'] as Row)['system']) as SystemId;

    // The puppet enrols — free, as A15 requires it stay — and crosses to the same system.
    const puppet = agent('puppet');
    expect((await enrol(h, puppet)).status).toBe(201);
    tick(h, 1);
    await takeOffered(puppet, 'graduate');
    await act(puppet, 'post_bond', { amount: CLAIM_BOND_MINOR });
    run(1);

    const p = puppet.principalId as PrincipalId;
    const free = h.runtime.ledger.freeBalance(storesAccount(p));
    const transferable = freeCash(h.runtime.ledger, p);

    // The premise of the test: the puppet has unlocked currency and none of it is its own.
    // If this ever stops being true the scenario is no longer the exploit it was written for.
    expect(free, 'the puppet holds unlocked currency from the faucet').toBeGreaterThan(0);
    expect(transferable, 'and none of it is transferable, because all of it is endowment').toBe(0);
    expect(STARTER_STAKE, 'the floor and the grant are one quantity with one home').toBeGreaterThan(0);

    // The operator asks for the lot.
    const bossBefore = balance(boss);
    await act(boss, 'publish_offer', { cede: system, price: free });
    run(1);
    await act(puppet, 'build', { kind: 'ANCHOR', system });
    run(1);

    expect(
      balance(boss) - bossBefore,
      'no more than the transferable part may ever leave a principal (D7/A15)',
    ).toBeLessThanOrEqual(transferable);

    // And the refusal is legible rather than a silent no-op, so the agent is not left
    // guessing why a published, affordable-looking offer did not complete (A2).
    const corrections = h.runtime.takeCorrections(p).map((c) => c.hint);
    expect(
      corrections.join(' | '),
      'a refused cession says what is short, and locked stores not counting is the reason',
    ).toMatch(/free|locked stores/i);
  });

  it('currency a principal earned buys territory normally, which is the distinction', async () => {
    // The guard must withhold the *stake* without breaking the mechanic. A rule that also
    // blocked earned money would make territory untradeable and would not be D7's rule.
    const boss = agent('seller');
    expect((await enrol(h, boss)).status).toBe(201);
    tick(h, 1);
    for (const verb of ['graduate', 'post_bond'] as const) await takeOffered(boss, verb);
    await takeOffered(boss, 'build', 'ANCHOR');
    const system = String(((await observe(boss))['holding'] as Row)['system']) as SystemId;

    const buyer = agent('earner');
    expect((await enrol(h, buyer)).status).toBe(201);
    tick(h, 1);
    await takeOffered(buyer, 'graduate');
    await act(buyer, 'post_bond', { amount: CLAIM_BOND_MINOR });
    run(1);

    // Give the buyer INCOME, which is what the floor is defined against: the transferable
    // part is everything ABOVE the floor, so money that arrives from outside the faucet is
    // spendable the moment it lands. Simulated with a direct ledger transfer from a funder
    // rather than a market round-trip — the point under test is the cession gate, and the
    // ledger deliberately does not enforce a verb-level rule, which is what makes this a
    // clean stand-in for earnings.
    const funder = agent('funder');
    expect((await enrol(h, funder)).status).toBe(201);
    tick(h, 1);
    // ── WHY THE INCOME HAS TO BE THIS LARGE, WHICH IS ITSELF A FINDING ──────
    //
    // The floor is a flat comparison against the *whole* stake, not per-principal
    // accounting of how much endowment is left — `ledger/endowment.ts` chooses that
    // deliberately, because for a Sybil guard erring toward withholding is the safe
    // direction and the alternative is per-principal state inside `state_hash`.
    //
    // The consequence, measured here: this buyer has already spent stake on `graduate` and
    // locked more in its bond, so its free balance is BELOW the floor and its transferable
    // cash is 0. Income has to lift the free balance clear of the entire floor before any of
    // it can move. So early-game cession is effectively closed until a principal has earned
    // real money — which is defensible (territory should not be bought with the faucet) but
    // is a stronger brake than D7 set out to apply, and it is recorded in the expansion notes
    // rather than silently absorbed into a test constant.
    const b = buyer.principalId as PrincipalId;
    const earned = 150_000;
    h.runtime.ledger.transferCurrency({
      eventId: `test.income:${String(h.runtime.engine.tick)}` as never,
      tick: h.runtime.engine.tick,
      from: storesAccount(funder.principalId as PrincipalId),
      to: storesAccount(b),
      amount: earned as never,
    });
    const transferable = freeCash(h.runtime.ledger, b);
    expect(transferable, 'income above the floor is spendable, and only the part above it').toBeGreaterThan(0);

    const bossBefore = balance(boss);
    const price = transferable;
    await act(boss, 'publish_offer', { cede: system, price });
    run(1);
    await act(buyer, 'build', { kind: 'ANCHOR', system });
    run(1);

    expect(balance(boss) - bossBefore, 'earned currency buys territory at the asking price').toBe(price);
    expect(h.runtime.sovereignty.liveAt(system)?.claimant, 'and the claim actually changes hands').toBe(b);
  });
});
