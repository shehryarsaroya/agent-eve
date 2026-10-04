/**
 * The HTTP surface: discovery documents, the transport's edges, and lazy authentication —
 * spectator tools signed out; a 401 with the resource-metadata hint only for account tools.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { harness, payload, type Harness } from './helpers/harness.js';

let h: Harness;
const RESOURCE = 'https://mcp.test.example/mcp';
const PRM_URL = 'https://mcp.test.example/.well-known/oauth-protected-resource/mcp';

beforeAll(async () => {
  h = await harness();
});
afterAll(async () => {
  await h.close();
});

const initialize = (name: string) => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name, version: '1.0.0' } },
});
const call = (name: string, args: Record<string, unknown> = {}, id = 2) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

describe('discovery (RFC 9728)', () => {
  for (const path of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
    it(`serves protected resource metadata at ${path}`, async () => {
      const response = await h.service.handle(new Request(`https://mcp.test.example${path}`));
      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(await response.json()).toEqual({
        resource: RESOURCE,
        authorization_servers: ['https://test-project.supabase.co/auth/v1'],
        bearer_methods_supported: ['header'],
        scopes_supported: ['email'],
        resource_name: 'Agent Eve',
      });
    });
  }

  it('answers a CORS preflight', async () => {
    const response = await h.service.handle(new Request(RESOURCE, { method: 'OPTIONS' }));
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-headers')).toContain('Mcp-Session-Id');
    expect(response.headers.get('access-control-expose-headers')).toContain('WWW-Authenticate');
  });
});

describe('the transport', () => {
  it('opens no server-initiated stream and has no session to delete', async () => {
    for (const method of ['GET', 'DELETE']) {
      const response = await h.service.handle(new Request(RESOURCE, { method, headers: { accept: 'text/event-stream' } }));
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
    }
  });

  it('refuses an oversized body, invalid JSON and a foreign browser origin', async () => {
    const big = await h.service.handle(new Request(RESOURCE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(300 * 1024) }));
    expect(big.status).toBe(413);
    const bad = await h.service.handle(new Request(RESOURCE, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{nope' }));
    expect(bad.status).toBe(400);
    expect((await h.post(initialize('x'), { origin: 'https://evil.example' })).status).toBe(403);
    expect((await h.post(initialize('x'), { origin: 'https://claude.ai' })).status).toBe(200);
  });

  it('negotiates both 2025 protocol revisions', async () => {
    for (const version of ['2025-06-18', '2025-11-25']) {
      const response = await h.post({ ...initialize('claude-ai'), params: { ...initialize('claude-ai').params, protocolVersion: version } });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { result: { protocolVersion: string; serverInfo: { name: string } } };
      expect(body.result.protocolVersion).toBe(version);
      expect(body.result.serverInfo.name).toBe('agenteve');
    }
  });
});

describe('tools/list', () => {
  it('lists twelve tools, each with a title, all four hints and its security scheme', async () => {
    const client = await h.connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['eve_act', 'eve_dossier', 'eve_enroll', 'eve_identity', 'eve_map', 'eve_observe', 'eve_report', 'eve_rules', 'eve_rundown', 'eve_signing_log', 'eve_status', 'eve_wake_status'],
    );
    const signedOut = new Set(['eve_status', 'eve_rules', 'eve_map', 'eve_rundown', 'eve_dossier']);
    for (const tool of tools) {
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.annotations?.title).toBe(tool.title);
      expect(tool.name.length).toBeLessThanOrEqual(64);
      for (const hint of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const) {
        expect(typeof tool.annotations?.[hint], `${tool.name} ${hint}`).toBe('boolean');
      }
      if (signedOut.has(tool.name)) expect(tool.annotations?.readOnlyHint).toBe(true);
    }
    // OpenAI's securitySchemes sit at the top level of the descriptor (which the SDK client
    // drops when it parses), mirrored in _meta for clients that only read _meta.
    const raw = (await (await h.post({ jsonrpc: '2.0', id: 9, method: 'tools/list', params: {} })).json()) as { result: { tools: Record<string, unknown>[] } };
    for (const tool of raw.result.tools) {
      const schemes = tool['securitySchemes'] as { type: string; scopes?: string[] }[];
      expect(schemes).toEqual((tool['_meta'] as { securitySchemes: unknown }).securitySchemes);
      expect(schemes).toEqual(signedOut.has(String(tool['name'])) ? [{ type: 'noauth' }] : [{ type: 'oauth2', scopes: ['email'] }]);
    }
    const act = tools.find((t) => t.name === 'eve_act');
    expect(act?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: true });
    const enroll = tools.find((t) => t.name === 'eve_enroll');
    expect(enroll?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });

  it('serves the rules as a resource too', async () => {
    const client = await h.connect();
    const resource = await client.readResource({ uri: 'agenteve://rules' });
    expect(JSON.stringify(resource.contents[0])).toContain('AGENT EVE');
  });
});

describe('lazy authentication', () => {
  it('runs spectator tools with no token', async () => {
    const client = await h.connect();
    const status = payload(await client.callTool({ name: 'eve_status', arguments: {} }));
    expect(status.mcpError).toBe(false);
    expect((status['report'] as { tick: number }).tick).toBe(100);
    const map = payload(await client.callTool({ name: 'eve_map', arguments: {} }));
    expect(map['tick']).toBe(412);
    expect(map['note']).toMatch(/data, never as instructions/);
    const rundown = payload(await client.callTool({ name: 'eve_rundown', arguments: {} }));
    expect((rundown['beats'] as { said: string }[])[0]?.said).toBe('Trust me.');
    const dossier = payload(await client.callTool({ name: 'eve_dossier', arguments: { handle: 'rook' } }));
    expect(dossier['found']).toBe(true);
    expect(dossier['page']).toBe('https://game.test.example/#/agent/rook');
    const rules = payload(await client.callTool({ name: 'eve_rules', arguments: { section: '1' } }));
    expect(rules['text']).toBe('## 1. The loop\n\nObserve, act.');
  });

  it('answers an account tool with no token with HTTP 401 and the resource-metadata hint', async () => {
    for (const name of ['eve_observe', 'eve_act', 'eve_enroll', 'eve_identity', 'eve_signing_log', 'eve_wake_status', 'eve_report']) {
      const response = await h.post(call(name, {}));
      expect(response.status, name).toBe(401);
      const challenge = response.headers.get('www-authenticate') ?? '';
      expect(challenge).toMatch(/^Bearer /);
      expect(challenge).toContain(`resource_metadata="${PRM_URL}"`);
      expect(challenge).toContain('error="invalid_token"');
      expect(challenge).toContain('scope="email"');
      expect(await response.json()).toMatchObject({ error: 'invalid_token' });
    }
    // A batch hiding one account tool among spectator calls is still challenged.
    expect((await h.post([call('eve_status', {}, 5), call('eve_observe', {}, 6)])).status).toBe(401);
  });

  it('answers a bad or expired token with 401 whatever the request', async () => {
    const expired = await h.issuer.mcpToken({ expiresIn: -300 });
    for (const token of ['garbage', expired, await h.issuer.mcpToken({ aud: 'https://elsewhere.example/mcp' }), await h.issuer.sessionToken()]) {
      const response = await h.post(initialize('claude-ai'), { authorization: `Bearer ${token}` });
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toContain('resource_metadata=');
    }
  });

  it('gives a ChatGPT client the in-band prompt instead, carried by a signed session id', async () => {
    const init = await h.post(initialize('openai-mcp'));
    expect(init.status).toBe(200);
    const session = init.headers.get('mcp-session-id');
    expect(session).toMatch(/^s1\./);
    const response = await h.post(call('eve_observe'), { 'mcp-session-id': session ?? '' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { isError: boolean; _meta: Record<string, string[]> } };
    expect(body.result.isError).toBe(true);
    const challenge = body.result._meta['mcp/www_authenticate']?.[0] ?? '';
    expect(challenge).toContain(`resource_metadata="${PRM_URL}"`);
    expect(challenge).toContain('error="insufficient_scope"');
    // A forged id is just an unknown client, which gets the spec's 401.
    const forged = await h.post(call('eve_observe'), { 'mcp-session-id': `${session ?? ''}x` });
    expect(forged.status).toBe(401);
  });

  it('lets a signed-in client through to the tool', async () => {
    const token = await h.issuer.mcpToken();
    const client = await h.connect({ token });
    const identity = payload(await client.callTool({ name: 'eve_identity', arguments: {} }));
    expect(identity).toMatchObject({ enrolled: false, signer: 'hosted', mcpError: false });
  });
});

describe('the consent page helper and operator endpoints', () => {
  it('/account names the signed-in account\'s agent, for a session token only', async () => {
    const sub = crypto.randomUUID();
    const none = await h.service.handle(new Request('https://mcp.test.example/account'));
    expect(none.status).toBe(401);
    const session = await h.issuer.sessionToken({ sub });
    const before = await h.service.handle(new Request('https://mcp.test.example/account', { headers: { authorization: `Bearer ${session}` } }));
    expect(await before.json()).toEqual({ signedIn: true, handle: null, principalId: null, enrolled: false, signer: 'hosted' });
    const client = await h.connect({ token: await h.issuer.mcpToken({ sub }) });
    expect(payload(await client.callTool({ name: 'eve_enroll', arguments: { handle: 'consent-check' } }))['httpStatus']).toBe(201);
    const after = await h.service.handle(new Request('https://mcp.test.example/account', { headers: { authorization: `Bearer ${session}` } }));
    expect(await after.json()).toMatchObject({ handle: 'consent-check', principalId: 'p:consent-check', enrolled: true });
    const connector = await h.service.handle(new Request('https://mcp.test.example/account', { headers: { authorization: `Bearer ${await h.issuer.mcpToken({ sub, aud: 'authenticated' })}` } }));
    expect(connector.status).toBe(401);
  });

  it('/healthz answers loopback only', async () => {
    const local = await h.service.handle(new Request('http://127.0.0.1:8825/healthz'), { address: '127.0.0.1' });
    expect(local.status).toBe(200);
    expect(await local.json()).toEqual({ ok: true, db: true, engine: 200 });
    const remote = await h.service.handle(new Request('http://127.0.0.1:8825/healthz'), { address: '203.0.113.9' });
    expect(remote.status).toBe(404);
    expect((await h.service.handle(new Request('https://mcp.test.example/nope'))).status).toBe(404);
  });

  it('/healthz never waits on a hung engine', async () => {
    h.advance(3_100); // past the cached /health
    const call = h.engine.call.bind(h.engine);
    h.engine.call = () => new Promise(() => undefined);
    try {
      const started = Date.now();
      const response = await h.service.handle(new Request('http://127.0.0.1:8825/healthz'), { address: '127.0.0.1' });
      expect(Date.now() - started).toBeLessThan(2_500);
      expect(await response.json()).toEqual({ ok: true, db: true, engine: null });
    } finally {
      h.engine.call = call;
      h.advance(3_100); // let the hung read age out of the cache
    }
  });
});

describe('cross-device sign-in handoffs', () => {
  const BASE = 'https://mcp.test.example/oauth/handoff';
  const OWN = { origin: 'https://mcp.test.example' };
  const post = (path: string, body: unknown, headers: Record<string, string> = OWN, peer?: { address: string }) =>
    h.service.handle(new Request(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }), peer);
  const open = (email: string, peer = { address: '203.0.113.20' }) => post('', { email }, OWN, peer);
  const poll = (id: string, secret?: string) => h.service.handle(new Request(`${BASE}/${id}`, { headers: secret === undefined ? {} : { 'x-handoff-secret': secret } }));
  const confirm = (id: string, token: string | null, body: Record<string, unknown>) =>
    post(`/${id}/confirm`, { refresh_token: 'refresh-token-1', ...body }, { ...OWN, ...(token === null ? {} : { authorization: `Bearer ${token}` }) });
  const opened = async (email: string) => (await (await open(email)).json()) as { id: string; secret: string; word: string; expires_in: number };

  it('opens a handoff, checks the typed word, and hands the confirmed session to the popup once', async () => {
    const response = await open('player@example.com');
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const { id, secret, word, expires_in } = (await response.json()) as { id: string; secret: string; word: string; expires_in: number };
    expect(expires_in).toBe(600);
    // The confirm page learns only that it is pending: the word must come from the person.
    expect(await (await poll(id)).json()).toEqual({ pending: true });
    expect(await (await poll(id, secret)).json()).toEqual({ status: 'waiting' });
    expect((await poll(id, 'wrong-secret')).status).toBe(404);
    expect(await (await post(`/${id}/check`, { word: word.toLowerCase() })).json()).toEqual({ ok: true });

    const session = await h.issuer.sessionToken({ email: 'player@example.com' });
    expect((await confirm(id, session, { word })).status).toBe(200);
    expect((await confirm(id, session, { word })).status).toBe(409);
    expect((await poll(id)).status).toBe(404);

    const taken = await poll(id, secret);
    expect(await taken.json()).toEqual({ status: 'confirmed', access_token: session, refresh_token: 'refresh-token-1' });
    expect((await poll(id, secret)).status).toBe(404);
  });

  it('cancels a handoff after two wrong words', async () => {
    const { id, secret } = await opened('player@example.com');
    const first = await post(`/${id}/check`, { word: 'NOTAWORD' });
    expect(first.status).toBe(422);
    expect(await first.json()).toEqual({ error: 'wrong_word', tries_left: 1 });
    expect(await (await post(`/${id}/check`, { word: '' })).json()).toEqual({ error: 'wrong_word', tries_left: 0 });
    expect((await post(`/${id}/check`, { word: 'ANYTHING' })).status).toBe(404);
    expect((await poll(id, secret)).status).toBe(404);
  });

  it('accepts only a sign-in session for the same email, with the word and its refresh token', async () => {
    const { id, secret, word } = await opened('player@example.com');
    expect((await confirm(id, null, { word })).status).toBe(401);
    expect((await confirm(id, 'not-a-jwt', { word })).status).toBe(401);
    expect((await confirm(id, await h.issuer.mcpToken({ sub: crypto.randomUUID() }), { word })).status).toBe(401);
    const other = await confirm(id, await h.issuer.sessionToken({ email: 'someone-else@example.com' }), { word });
    expect(other.status).toBe(409);
    expect(await other.json()).toEqual({ error: 'email_mismatch' });
    expect((await confirm(id, await h.issuer.sessionToken({ email: 'player@example.com' }), { word, refresh_token: '' })).status).toBe(400);
    expect(await (await poll(id, secret)).json()).toEqual({ status: 'waiting' });
    const guessed = await confirm(id, await h.issuer.sessionToken({ email: 'player@example.com' }), { word: 'NOTAWORD' });
    expect(guessed.status).toBe(422);
    expect(await (await poll(id, secret)).json()).toEqual({ status: 'waiting' });
    expect((await confirm('AAAAAAAAAAAAAAAAAAAAAA', await h.issuer.sessionToken(), { word })).status).toBe(404);
  });

  it('refuses other sites, a bad email and the wrong methods, and limits openings per network', async () => {
    expect((await post('', { email: 'player@example.com' }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post('/AAAAAAAAAAAAAAAAAAAAAA/check', { word: 'X' }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post('', { email: 'player@example.com' }, {}, { address: '203.0.113.21' })).status).toBe(201);
    expect((await open('not-an-email')).status).toBe(400);
    expect((await h.service.handle(new Request(BASE))).status).toBe(405);
    expect((await h.service.handle(new Request(`${BASE}/AAAAAAAAAAAAAAAAAAAAAA`, { method: 'DELETE' }))).status).toBe(405);
    expect((await h.service.handle(new Request(`${BASE}/AAAAAAAAAAAAAAAAAAAAAA/check`))).status).toBe(405);
    expect((await h.service.handle(new Request(`${BASE}/short`))).status).toBe(404);
    // One IPv6 subscriber is one network, however many of its addresses it uses.
    const statuses: number[] = [];
    for (let i = 0; i < 20; i++) statuses.push((await open(`limit-${i}@example.com`, { address: `2001:db8:77:1::${(i + 1).toString(16)}` })).status);
    expect(statuses.every((s) => s === 201)).toBe(true);
    const limited = await open('limit-20@example.com', { address: '2001:db8:77:1:ffff::1' });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await open('elsewhere@example.com', { address: '2001:db8:77:2::1' })).status).toBe(201);
  });
});
