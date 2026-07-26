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
