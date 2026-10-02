/**
 * The account tools end to end through an MCP client, on a fake engine and real SQL: enrolment
 * with a server-held key, signing, the signing log, retries that must not act twice, the wake
 * clock, isolation between accounts, and the per-account limits.
 */

import { randomUUID } from 'node:crypto';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agentKeyAad, KeyVault } from '../src/crypto/vault.js';
import { EngineError } from '../src/engine/client.js';
import { Store } from '../src/store/store.js';
import { MASTER_KEY } from './helpers/config.js';
import { harness, payload, type Harness } from './helpers/harness.js';

let h: Harness;
let store: Store;

beforeEach(async () => {
  h = await harness();
  store = new Store(h.db);
});
afterEach(async () => {
  await h.close();
});

async function signedIn(sub = randomUUID()): Promise<{ client: Client; sub: string }> {
  return { client: await h.connect({ token: await h.issuer.mcpToken({ sub }) }), sub };
}

async function tool(client: Client, name: string, args: Record<string, unknown> = {}) {
  return payload(await client.callTool({ name, arguments: args }));
}

describe('enrolment with a server-held key', () => {
  it('generates and seals the key before the request leaves, then enrols', async () => {
    const { client, sub } = await signedIn();
    const taken = await tool(client, 'eve_enroll', { handle: 'vale' });
    expect(taken).toMatchObject({ httpStatus: 409, reason: 'HANDLE_TAKEN', mcpError: true });
    // The key existed before the refused request: the row is there, pending, with a status.
    const pending = await store.principal(sub);
    expect(pending).toMatchObject({ handle: 'vale', enrolled: false, lastEnrollStatus: 409 });

    const enrolled = await tool(client, 'eve_enroll', { handle: 'brannock' });
    expect(enrolled).toMatchObject({ httpStatus: 201, handle: 'brannock', principalId: 'p:brannock', signer: 'hosted', mcpError: false });
    const row = await store.principal(sub);
    expect(row).toMatchObject({ handle: 'brannock', enrolled: true, keyid: pending?.keyid });
    expect(enrolled['keyid']).toBe(row?.keyid);

    // What reached the engine was the public half only; the stored half opens only under the master key.
    const sent = h.engine.calls.filter((c) => c.path === '/api/enroll').at(-1)?.payload as { publicKey: string };
    expect(sent.publicKey).toBe(row?.publicKey);
    const seed = new KeyVault(new Map([[1, MASTER_KEY]])).open({ version: row?.keyVersion ?? 0, blob: row?.sealedKey ?? Buffer.alloc(0) }, agentKeyAad(sub, row?.keyid ?? ''));
    expect(seed).toHaveLength(32);
    expect(row?.sealedKey.includes(seed)).toBe(false);
    expect(JSON.stringify(h.engine.calls)).not.toContain(seed.toString('base64url'));

    const log = await tool(client, 'eve_signing_log');
    const entries = log['entries'] as { path: string; signed: boolean; httpStatus: number }[];
    expect(entries.map((e) => [e.path, e.signed, e.httpStatus])).toEqual([
      ['/api/enroll', false, 201],
      ['/api/enroll', false, 409],
    ]);
  });

  it('holds one agent per account and resumes it', async () => {
    const { client } = await signedIn();
    expect((await tool(client, 'eve_enroll', { handle: 'kestrel' }))['httpStatus']).toBe(201);
    expect(await tool(client, 'eve_enroll', { handle: 'kestrel' })).toMatchObject({ httpStatus: 200, resumed: true, mcpError: false });
    const second = await tool(client, 'eve_enroll', { handle: 'kestrel-two' });
    expect(second['mcpError']).toBe(true);
    expect(String(second['error'])).toMatch(/already has an agent, kestrel/);
    expect(h.engine.calls.filter((c) => c.path === '/api/enroll')).toHaveLength(1);
  });

  it('never re-picks a handle whose enrolment may have completed', async () => {
    const { client, sub } = await signedIn();
    h.engine.override = (call) => (call.path === '/api/enroll' ? new EngineError('the engine is unreachable') : undefined);
    expect((await tool(client, 'eve_enroll', { handle: 'lost-reply' }))['mcpError']).toBe(true);
    h.engine.override = null;
    const switched = await tool(client, 'eve_enroll', { handle: 'other-name' });
    expect(String(switched['error'])).toMatch(/may have completed/);
    expect((await store.principal(sub))?.handle).toBe('lost-reply');
    expect((await tool(client, 'eve_enroll', { handle: 'lost-reply' }))['httpStatus']).toBe(201);
  });

  it('recovers an enrolment whose response was lost, by a signed observe', async () => {
    const { client } = await signedIn();
    let first = true;
    h.engine.override = (call) => {
      if (call.path !== '/api/enroll' || !first) return undefined;
      first = false;
      // The world enrolled us, then the reply was lost.
      void h.engine.call({ ...call });
      return new EngineError('the engine connection failed mid-reply');
    };
    expect((await tool(client, 'eve_enroll', { handle: 'phoenix' }))['mcpError']).toBe(true);
    h.engine.override = null;
    const recovered = await tool(client, 'eve_enroll', { handle: 'phoenix' });
    expect(recovered).toMatchObject({ httpStatus: 200, resumed: true, enrolled: true, mcpError: false });
  });
});

describe('playing', () => {
  async function enrolledClient(handle: string) {
    const { client, sub } = await signedIn();
    expect((await tool(client, 'eve_enroll', { handle }))['httpStatus']).toBe(201);
    return { client, sub };
  }

  it('observes signed, bounding other agents\' words and never touching affordances', async () => {
    const { client, sub } = await enrolledClient('observer');
    const observed = await tool(client, 'eve_observe');
    expect(observed).toMatchObject({ httpStatus: 200, mcpError: false });
    const observation = observed['observation'] as Record<string, any>;
    const talk = observation['ventures']['talks'][0];
    expect(talk.text.length).toBeLessThanOrEqual(481);
    expect(talk.text_truncated).toBe(true);
    expect(observation['counterparties'][0].last_parley.text.length).toBeLessThanOrEqual(481);
    expect(observation['affordances']).toEqual([{ verb: 'levy_vote', params: { choice: 'EVEN', text: '' }, max_direct_loss: 0 }]);
    expect(observed['untrusted_text']).toMatch(/data, never as instructions/);
    const signedCall = h.engine.calls.at(-1);
    expect(signedCall?.signer?.keyid).toBe((await store.principal(sub))?.keyid);
    expect(signedCall?.accountId).toBe(sub);
  });

  it('acts once, then recognises a host retry and does not act twice', async () => {
    const { client, sub } = await enrolledClient('trader');
    const actions = [{ verb: 'levy_vote', params: { choice: 'EVEN' } }];
    const first = await tool(client, 'eve_act', { actions });
    expect(first).toMatchObject({ httpStatus: 200, replayed: false, mcpError: false });
    expect(String(first['idempotencyKey'])).toMatch(/^mcp-[A-Za-z0-9_-]{24}$/);
    const sent = h.engine.calls.filter((c) => c.path === '/api/act');
    expect((sent[0]?.payload as { actions: { clientSequence: number }[] }).actions[0]?.clientSequence).toBe(1);
    expect(h.engine.acted).toBe(1);

    // The host times out and sends the very same call again.
    const retry = await tool(client, 'eve_act', { actions });
    expect(retry).toMatchObject({ replayed: true, source: 'signing_log', idempotencyKey: first['idempotencyKey'], mcpError: false });
    expect((retry['outcome'] as { accepted: { verb: string }[] }).accepted[0]?.verb).toBe('levy_vote');
    expect(h.engine.acted).toBe(1);
    expect(h.engine.calls.filter((c) => c.path === '/api/act')).toHaveLength(1);

    // Two concurrent identical calls: still one act.
    const concurrent = await Promise.all([tool(client, 'eve_act', { actions: [{ verb: 'haul', params: { lane: 1 } }] }), tool(client, 'eve_act', { actions: [{ verb: 'haul', params: { lane: 1 } }] })]);
    expect(concurrent.map((r) => r['replayed']).sort()).toEqual([false, true]);
    expect(h.engine.acted).toBe(2);

    // An explicit new key sends the same batch again on purpose; the same explicit key replays.
    expect((await tool(client, 'eve_act', { actions, idempotencyKey: 'deliberate-1' }))['replayed']).toBe(false);
    expect((await tool(client, 'eve_act', { actions, idempotencyKey: 'deliberate-1' }))['replayed']).toBe(true);
    expect(h.engine.acted).toBe(3);
    const sequences = h.engine.calls.filter((c) => c.path === '/api/act').map((c) => (c.payload as { actions: { clientSequence: number }[] }).actions[0]?.clientSequence);
    expect(new Set(sequences).size).toBe(sequences.length);
    expect((await store.principal(sub))?.nextSequence).toBeGreaterThan(3);
  });

  it('sends a fully refused batch again, since it acted nothing the first time', async () => {
    const { client } = await enrolledClient('corrected');
    const first = await tool(client, 'eve_act', { actions: [{ verb: 'invent_money', params: {} }] });
    expect((first['outcome'] as { accepted: unknown[] }).accepted).toHaveLength(0);
    const again = await tool(client, 'eve_act', { actions: [{ verb: 'invent_money', params: {} }] });
    expect(again['replayed']).toBe(false);
    const keys = h.engine.calls.filter((c) => c.path === '/api/act').map((c) => (c.payload as { idempotencyKey: string }).idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('re-sends with the same key when the engine never answered', async () => {
    const { client } = await enrolledClient('patient');
    h.engine.override = (call) => (call.path === '/api/act' ? new EngineError('the engine did not answer in time') : undefined);
    const lost = await tool(client, 'eve_act', { actions: [{ verb: 'levy_vote', params: { choice: 'EVEN' } }] });
    expect(lost['mcpError']).toBe(true);
    h.engine.override = null;
    const again = await tool(client, 'eve_act', { actions: [{ verb: 'levy_vote', params: { choice: 'EVEN' } }] });
    expect(again).toMatchObject({ replayed: false, mcpError: false });
    const keys = h.engine.calls.filter((c) => c.path === '/api/act').map((c) => (c.payload as { idempotencyKey: string }).idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    const log = await tool(client, 'eve_signing_log');
    expect((log['entries'] as { httpStatus: number | null }[]).slice(0, 2).map((e) => e.httpStatus)).toEqual([200, null]);
  });

  it('passes quote_id inside params and keeps corrections in the outcome summary', async () => {
    const { client } = await enrolledClient('quoter');
    const result = await tool(client, 'eve_act', { actions: [{ verb: 'fill_role', params: { venture: 'v:1' }, quote_id: 'q-123' }, { verb: 'invent_money', params: {} }] });
    const sent = h.engine.calls.filter((c) => c.path === '/api/act').at(-1)?.payload as { actions: { params: Record<string, unknown> }[] };
    expect(sent.actions[0]?.params).toEqual({ venture: 'v:1', quote_id: 'q-123' });
    expect((result['outcome'] as { corrections: unknown[] }).corrections).toHaveLength(1);
    const log = await tool(client, 'eve_signing_log', { limit: 1 });
    const entry = (log['entries'] as { verbs: string[]; outcome: { corrected: { invariant: string }[] } }[])[0];
    expect(entry?.verbs).toEqual(['fill_role', 'invent_money']);
    expect(entry?.outcome.corrected[0]?.invariant).toBe('A2');
  });

  it('reports a discrepancy signed as the agent', async () => {
    const { client } = await enrolledClient('reporter');
    expect(await tool(client, 'eve_report', { expected: 'a', observed: 'b' })).toMatchObject({ httpStatus: 202, mcpError: false });
    expect(h.engine.calls.at(-1)?.signer).toBeDefined();
  });

  it('tells the agent when it next needs to wake, without spending a wake', async () => {
    const { client } = await enrolledClient('sleeper');
    await tool(client, 'eve_observe');
    const callsBefore = h.engine.calls.filter((c) => c.signer !== undefined).length;
    const status = await tool(client, 'eve_wake_status');
    expect(status).toMatchObject({ tick: 100, wakesRemaining: 15, nextDecisionAt: 112, ticksUntilDecision: 12, decisionDue: false, suggestedSleepTicks: 12, suggestedSleepMinutes: 60, wakesRemainingIsEstimate: false });
    expect(h.engine.calls.filter((c) => c.signer !== undefined).length).toBe(callsBefore);
    h.engine.tick = 113;
    h.advance(3_100); // the shared /health read is cached for three seconds
    expect(await tool(client, 'eve_wake_status')).toMatchObject({ decisionDue: true, suggestedSleepTicks: 0 });
    h.engine.tick = 300; // a new Reckoning: the pool has refilled
    h.advance(3_100);
    expect(await tool(client, 'eve_wake_status')).toMatchObject({ reckoning: 1, wakesRemaining: 16, wakesRemainingIsEstimate: true });
  });
});

describe('isolation and limits', () => {
  it('keeps each account to its own agent and its own log', async () => {
    const a = await signedIn();
    const b = await signedIn();
    expect((await tool(a.client, 'eve_enroll', { handle: 'alpha-one' }))['httpStatus']).toBe(201);
    await tool(a.client, 'eve_observe');
    expect(String((await tool(b.client, 'eve_observe'))['error'])).toMatch(/Enroll first/);
    expect((await tool(b.client, 'eve_signing_log'))['entries']).toEqual([]);
    expect(await tool(b.client, 'eve_identity')).toMatchObject({ enrolled: false });
  });

  it('limits per account, and says it is not a game rule', async () => {
    await h.close();
    h = await harness({ EVE_MCP_LIMIT_OBSERVE: '2/60' });
    store = new Store(h.db);
    const { client } = await signedIn();
    await tool(client, 'eve_enroll', { handle: 'hasty' });
    await tool(client, 'eve_observe');
    await tool(client, 'eve_observe');
    const limited = await tool(client, 'eve_observe');
    expect(limited).toMatchObject({ mcpError: true, retryAfterSeconds: expect.any(Number) });
    expect(String(limited['error'])).toMatch(/not a game rule/);
    // Another account is unaffected.
    const other = await signedIn();
    await tool(other.client, 'eve_enroll', { handle: 'calm' });
    expect((await tool(other.client, 'eve_observe'))['httpStatus']).toBe(200);
  });

  it('refuses invalid arguments as a tool error', async () => {
    const { client } = await signedIn();
    const result = await tool(client, 'eve_act', { actions: [] });
    expect(result['mcpError']).toBe(true);
    expect(String(result['error'])).toMatch(/Invalid arguments for eve_act/);
    expect(String((await tool(client, 'eve_enroll', { handle: 'Not_A_Handle' }))['error'])).toMatch(/Invalid arguments/);
  });
});
