/**
 * Founding a syndicate over HTTP, and the one property that could take a live world down.
 *
 * D11's finding: a syndicate holds pooled stores, so it needs a ledger account, so it looks like a
 * principal — and a principal with no hands defaults its Levy every Reckoning forever, because the
 * Levy is payable only in goods carried by a present hand. That is A5′ with our own org model as the
 * cause, and it would libel an org permanently in the one column agents read for trustworthiness.
 *
 * The resolution is structural: the syndicate's account is **opened** but the syndicate is never
 * registered in `world.principalOrder`. That single omission does two jobs, because `assessCycle`
 * and `rankCandidates` both read that list. So the test that matters is not "does forming work" —
 * it is **run a world past a full Reckoning with a syndicate in it and prove nothing halts and
 * nothing is assessed against it.**
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';
import { storesAccount } from '../../src/ledger/index.js';
import { freeCash } from '../../src/market/escrow.js';
import { FOUNDING_COST_MINOR } from '../../src/syndicate/params.js';
import { PATHS, agent, enrol, harness, signed, tick, type Agent, type Harness } from '../api/harness.js';

let h: Harness;

beforeEach(async () => {
  h = await harness({ seed: 'form-front-door' });
});
afterEach(async () => {
  await h.close();
});

function run(n: number): void {
  for (let i = 0; i < n; i += 1) {
    const r = h.runtime.runTick();
    expect(
      r.halted,
      `the world halted at ${String(r.tick)}: ${r.violations.map((v) => `${v.id} ${v.message}`).join(' | ')}`,
    ).toBe(false);
  }
}

async function act(who: Agent, verb: string, params: unknown): Promise<void> {
  const res = await signed(h, who, 'POST', PATHS.act, {
    actions: [{ verb, params, clientSequence: 1 }],
  });
  expect(res.status, res.text.slice(0, 400)).toBe(200);
}

async function found(who: Agent, params: Record<string, unknown>): Promise<string | null> {
  await act(who, 'form', params);
  run(1);
  return h.runtime.syndicates.of(who.principalId as PrincipalId, h.runtime.engine.tick)[0]?.id ?? null;
}

describe('form founds a pooled subject that the world does not mistake for an agent', () => {
  it('opens a treasury, charges the founder, and keeps the syndicate off the agent roll', async () => {
    const who = agent('founder');
    expect((await enrol(h, who)).status).toBe(201);
    tick(h, 1);
    const p = who.principalId as PrincipalId;
    const before = h.runtime.ledger.balance(storesAccount(p));

    const id = await found(who, { name: 'The Long Haul', admission: 'OPEN', decision: 'MAJORITY' });
    expect(id, 'the syndicate exists').not.toBeNull();

    // Retired, not transferred. Nobody is richer for it, which is why the stake may pay for it.
    expect(h.runtime.ledger.balance(storesAccount(p))).toBe(before - FOUNDING_COST_MINOR);

    // The treasury is a real account that can hold value.
    const pooled = storesAccount(id as unknown as PrincipalId);
    expect(h.runtime.ledger.account(pooled), 'the pool is open').toBeDefined();
    expect(h.runtime.ledger.balance(pooled), 'and starts empty — nothing is pooled by founding').toBe(0);

    // ── THE D11 PROPERTY, ASSERTED WHERE IT WOULD ACTUALLY FAIL ──────────────
    expect(
      h.runtime.world.principalOrder.map(String),
      'a syndicate must NEVER join the roll of agents: assessCycle and rankCandidates both read it',
    ).not.toContain(String(id));
    expect(h.runtime.syndicates.isSyndicate(id as unknown as PrincipalId)).toBe(true);
  });

  it('survives a full Reckoning without being assessed or halting the world', async () => {
    // The test the structural claim actually rests on. A syndicate that reached the Levy roll would
    // be assessed, hold no hands, fail to deliver, and be recorded in default — and INV-25 halts
    // once per principal for a missing docket row, so the first failure mode is an outage.
    const who = agent('endurer');
    expect((await enrol(h, who)).status).toBe(201);
    tick(h, 1);
    const id = await found(who, { name: 'Patient Company' });
    expect(id).not.toBeNull();

    const reckoning = Math.floor(h.runtime.engine.tick / TICKS_PER_RECKONING);
    const now = h.runtime.engine.tick;
    const base = now - (now % TICKS_PER_RECKONING);
    run(base + TICKS_PER_RECKONING - now);

    // Nothing was assessed against it, so nothing can be recorded short against it.
    const synAsPrincipal = id as unknown as PrincipalId;
    for (const r of [reckoning, reckoning + 1]) {
      expect(
        h.runtime.levy.shortfallOf(r, synAsPrincipal),
        `no Levy shortfall may exist against a bodiless subject (Reckoning ${String(r)})`,
      ).toBeNull();
    }
  });
});

describe('a charter is refused rather than silently defaulted', () => {
  it('rejects an unknown clause and quotes the permanence statement', async () => {
    const who = agent('drafter');
    expect((await enrol(h, who)).status).toBe(201);
    tick(h, 1);
    const p = who.principalId as PrincipalId;
    await act(who, 'form', { name: 'Bad Draft', decision: 'WHATEVER' });
    run(1);
    const corrections = h.runtime.takeCorrections(p).map((c) => c.hint);
    expect(corrections.join(' '), 'the fault names the clause').toMatch(/decision must be/);
    expect(corrections.join(' '), 'and warns the choice would have been permanent').toMatch(
      /CHARTER IS PERMANENT/,
    );
    expect(
      h.runtime.syndicates.of(p, h.runtime.engine.tick).length,
      'and nothing was founded on a clause nobody chose',
    ).toBe(0);
  });

  it('charges nothing when it refuses', async () => {
    const who = agent('unspent');
    expect((await enrol(h, who)).status).toBe(201);
    tick(h, 1);
    const p = who.principalId as PrincipalId;
    const before = h.runtime.ledger.balance(storesAccount(p));
    await act(who, 'form', { name: '', admission: 'OPEN' });
    run(1);
    expect(h.runtime.ledger.balance(storesAccount(p)), 'a refusal is free').toBe(before);
  });
});

describe('joining is reachable, so a syndicate is not a solo container', () => {
  /**
   * Before this, `form` existed and nothing else did — so the founder was the only member a
   * syndicate could ever have, which makes pooled stores a private account with extra steps and
   * makes every charter clause about admission decorative.
   *
   * `apply` asks and `admit` answers. I first tried to do both with `join`, reasoning that the
   * charter already decides what asking MEANS — under OPEN an application is an admission, under
   * INVITE a request, under CLOSED neither — so one verb is better than two spellings of one
   * intention.
   *
   * The reasoning held and the verb was wrong: `join` already means "answer a raid" and §9 makes
   * it a HOSTILE act, so the A8 pre-check refused it inside the Commons — where every principal
   * starts. Hard rule 4 forbids reusing a canon term for a second concept, and I argued for one
   * verb on hard-rule-4 grounds while picking the one word it rules out. The last test in this
   * block guards the raid path, because that is what a careless reuse would have quietly eaten.
   */
  it('OPEN admits on the spot, and the membership is public', async () => {
    const founder = agent('opener');
    const joiner = agent('newcomer');
    for (const who of [founder, joiner]) expect((await enrol(h, who)).status).toBe(201);
    tick(h, 1);
    const id = await found(founder, { name: 'Open House', admission: 'OPEN' });
    expect(id).not.toBeNull();

    await act(joiner, 'apply', { syndicate: id });
    run(1);
    expect(
      h.runtime.takeCorrections(joiner.principalId as PrincipalId).map((c) => c.hint).join(' '),
      'an OPEN charter must admit without ceremony',
    ).toBe('');
    expect(
      h.runtime.syndicates.sittingMembers(id as never, h.runtime.engine.tick),
      'and the joiner is now a sitting member, so it counts in every vote',
    ).toContain(joiner.principalId);
  });

  it('INVITE refuses with the members named and the free channel to reach them', async () => {
    // The refusal has to be actionable or it is a dead end. There is deliberately NO application
    // queue: a pending list grows with enrolments (scar #3's shape) and would need its own cap,
    // hash entry and expiry. `message` already exists, costs no action, and becomes public at
    // settlement — so the approach and its answer land in the record a viewer reads.
    const founder = agent('gatekeeper');
    const hopeful = agent('supplicant');
    for (const who of [founder, hopeful]) expect((await enrol(h, who)).status).toBe(201);
    tick(h, 1);
    const id = await found(founder, { name: 'Invitation Only', admission: 'INVITE' });

    await act(hopeful, 'apply', { syndicate: id });
    run(1);
    const said = h.runtime.takeCorrections(hopeful.principalId as PrincipalId).map((c) => c.hint).join(' ');
    expect(said, 'it names who can actually let you in').toContain(String(founder.principalId));
    expect(said, 'and the free verb that reaches them').toContain('message');
    expect(
      h.runtime.syndicates.sittingMembers(id as never, h.runtime.engine.tick),
      'and nothing was admitted',
    ).not.toContain(hopeful.principalId);
  });

  it('admit lets a sitting member bring somebody in under INVITE', async () => {
    const founder = agent('host');
    const guest = agent('guest');
    for (const who of [founder, guest]) expect((await enrol(h, who)).status).toBe(201);
    tick(h, 1);
    const id = await found(founder, { name: 'By Arrangement', admission: 'INVITE' });

    await act(founder, 'admit', { syndicate: id, principal: guest.principalId });
    run(1);
    expect(
      h.runtime.takeCorrections(founder.principalId as PrincipalId).map((c) => c.hint).join(' '),
      'admitting must not be refused for a member under INVITE',
    ).toBe('');
    expect(
      h.runtime.syndicates.sittingMembers(id as never, h.runtime.engine.tick),
    ).toContain(guest.principalId);
  });

  it('CLOSED admits nobody, by anybody, ever', async () => {
    const founder = agent('sealed');
    const outsider = agent('knocker');
    for (const who of [founder, outsider]) expect((await enrol(h, who)).status).toBe(201);
    tick(h, 1);
    const id = await found(founder, { name: 'Final Company', admission: 'CLOSED' });

    await act(outsider, 'apply', { syndicate: id });
    await act(founder, 'admit', { syndicate: id, principal: outsider.principalId });
    run(1);
    expect(
      h.runtime.takeCorrections(founder.principalId as PrincipalId).map((c) => c.hint).join(' '),
      'even a founder cannot reopen a CLOSED charter',
    ).toMatch(/CLOSED|permanent/);
    expect(
      h.runtime.syndicates.sittingMembers(id as never, h.runtime.engine.tick),
    ).toEqual([founder.principalId]);
  });

  it('`join` still means answer-a-raid, and knows nothing about syndicates', async () => {
    // The regression a careless reuse would have caused: legal, quiet, and only visible the next
    // time a raid arrived. `join` is a hostile act by §9 and must name its target, which is also
    // the check that caught the reuse in the first place.
    const who = agent('defender');
    expect((await enrol(h, who)).status).toBe(201);
    tick(h, 1);
    // The A8 hostility pre-check runs at ACCEPT time, not at tick close, so the hint is in the
    // response rather than in `takeCorrections`. Worth stating: the two places a refusal can appear
    // is the distinction that made an earlier assertion in this repo look for the right message in
    // the wrong bucket and pass vacuously.
    const res = await signed(h, who, 'POST', PATHS.act, {
      actions: [{ verb: 'join', params: {}, clientSequence: 1 }],
    });
    expect(res.status).toBe(200);
    const said = JSON.stringify(res.json);
    expect(said, 'it must still be the raid answer').toMatch(/hostile act|aimed at/i);
    expect(said, 'and must not have learned about syndicates').not.toMatch(/syndicate/i);
  });
});

describe('a treasury that can be filled, because an empty pool is authority over nothing', () => {
  /**
   * **The syndicate treasury could hold value and nothing could put value in it.** Measured:
   * `syndicateAsPrincipal` appeared at exactly two call sites — one read the balance for the frame,
   * one opened the account at `form`. So every pool was permanently empty, every office was standing
   * authority over nothing, and A6 at org scale had no stakes in it at all.
   *
   * That is the same inertness as an unoffered verb, one layer deeper: not a mechanic an agent cannot
   * reach, but a mechanic with nothing at the end of it.
   *
   * Pooling rides on `apply` rather than spending one of the 40 verb slots: applying puts you in,
   * applying again deepens the commitment. And it spends EARNINGS only — a pool an office-holder can
   * spend is exactly the transfer path D7 closed twice already, and this is the largest door yet.
   */
  it('pools earnings, and refuses to pool the starter stake (D7 for the third time)', async () => {
    const founder = agent('treasurer');
    const funder = agent('income');
    for (const who of [founder, funder]) expect((await enrol(h, who)).status).toBe(201);
    tick(h, 1);
    const id = await found(founder, { name: 'The Common Purse', treasury_offices: true });
    expect(id).not.toBeNull();
    const p = founder.principalId as PrincipalId;
    const pooledAccount = storesAccount(id as unknown as PrincipalId);
    expect(h.runtime.ledger.balance(pooledAccount), 'founding pools nothing').toBe(0);

    // With only the grant, a contribution is refused — and says why in D7's own terms.
    await act(founder, 'apply', { syndicate: id, stake: 10_000 });
    run(1);
    const refused = h.runtime.takeCorrections(p).map((c) => c.hint).join(' ');
    expect(refused, 'the grant cannot reach a pool somebody else can spend').toMatch(/EARNINGS/);
    expect(refused).toMatch(/starter stake/);
    expect(h.runtime.ledger.balance(pooledAccount), 'and nothing moved').toBe(0);

    // Income arrives, clearing the endowment floor.
    h.runtime.ledger.transferCurrency({
      eventId: 'test.income:pool' as never,
      tick: h.runtime.engine.tick,
      from: storesAccount(funder.principalId as PrincipalId),
      to: storesAccount(p),
      amount: 200_000 as never,
    });
    run(1);

    const spendable = freeCash(h.runtime.ledger, p);
    expect(spendable, 'income lifts the transferable part above the floor').toBeGreaterThan(0);
    const stake = Math.min(spendable, 25_000);
    await act(founder, 'apply', { syndicate: id, stake });
    run(1);
    expect(
      h.runtime.takeCorrections(p).map((c) => c.hint).join(' '),
      'pooling earnings must not be refused',
    ).toBe('');
    expect(h.runtime.ledger.balance(pooledAccount), 'the treasury actually holds it now').toBe(stake);
  });

  it('the pooled total reaches the frame, so an office is visibly authority over something', async () => {
    const founder = agent('visible');
    const funder = agent('income2');
    for (const who of [founder, funder]) expect((await enrol(h, who)).status).toBe(201);
    tick(h, 1);
    const id = await found(founder, { name: 'Seen Company', treasury_offices: true });
    const p = founder.principalId as PrincipalId;
    h.runtime.ledger.transferCurrency({
      eventId: 'test.income:pool2' as never,
      tick: h.runtime.engine.tick,
      from: storesAccount(funder.principalId as PrincipalId),
      to: storesAccount(p),
      amount: 200_000 as never,
    });
    run(1);
    const stake = Math.min(freeCash(h.runtime.ledger, p), 30_000);
    await act(founder, 'apply', { syndicate: id, stake });
    run(1);

    const line = h.runtime.syndicateLines(h.runtime.engine.tick).find((l) => l.syndicate === id);
    expect(line, 'the syndicate is drawn').toBeDefined();
    expect(line?.treasuryMinor, 'and the pool it holds is what a counterparty prices').toBe(stake);
  });
});
