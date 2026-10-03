/**
 * End to end, for real: the actual engine (engine/dist, in-memory journal, turbo clock, trusting
 * the edge exactly as production does, verifying the gateway header with the same secret this
 * service sends it under) behind this service on node:http, a JWKS served over HTTP the way
 * Supabase serves it, and the official MCP client playing
 * enroll → observe → act → retry → wake status → signing log — and the agent's public record
 * saying `signer: hosted`, on its own observation and on `eve_dossier`.
 *
 * Build the engine first: `cd engine && npm ci && npm run build`. Skipped (loudly) without it.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getRequestListener } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { remoteKeys } from '../../src/auth/tokens.js';
import { loadConfig } from '../../src/config.js';
import { memoryLogger } from '../../src/log.js';
import { createService } from '../../src/service.js';
import { fakeIssuer, serveJwks, type FakeIssuer } from '../helpers/auth.js';
import { GATEWAY_SECRET, testEnv } from '../helpers/config.js';
import { testDb, type TestDb } from '../helpers/db.js';
import { payload } from '../helpers/harness.js';

const ENGINE = fileURLToPath(new URL('../../../engine/dist/api/server.js', import.meta.url));
const built = existsSync(ENGINE);
if (!built) process.stderr.write(`\nconnector e2e SKIPPED: build the engine first (${ENGINE} is missing)\n\n`);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!built)('the real engine behind the connector', () => {
  let world: { port: number; close(): Promise<void> };
  let framesDir: string;
  let jwks: { url: string; close(): Promise<void> };
  let issuer: FakeIssuer;
  let db: TestDb;
  let server: Server;
  let endpoint: string;
  const clients: Client[] = [];
  const logs = memoryLogger();

  beforeAll(async () => {
    framesDir = mkdtempSync(join(tmpdir(), 'eve-e2e-frames-'));
    process.env['COMPACT_SPEED'] = 'turbo';
    process.env['COMPACT_CAST_LLM'] = '0';
    for (const name of ['PGHOST', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'DATABASE_URL', 'COMPACT_DATABASE_URL', 'COMPACT_RATELIMIT_ALLOWLIST']) delete process.env[name];
    const { serve } = (await import(pathToFileURL(ENGINE).href)) as { serve: (options: Record<string, unknown>) => Promise<{ port: number; close(): Promise<void> }> };
    // The engine verifies the connector's gateway header with COMPACT_GATEWAY_SECRET; production reads it
    // in bootOptionsFromEnv, and this is the same value testEnv() hands the service as EVE_GATEWAY_SECRET.
    world = await serve({
      port: 0,
      host: '127.0.0.1',
      seed: 'connector-e2e',
      trustEdge: true,
      castSize: 3,
      framesDir,
      gateway: { state: 'configured', secret: GATEWAY_SECRET },
    });

    issuer = await fakeIssuer();
    jwks = await serveJwks(issuer.jwks);
    db = await testDb();
    const config = loadConfig({
      ...testEnv(),
      EVE_ENGINE_URL: `http://127.0.0.1:${world.port}`,
      // Sign the public authority while connecting to loopback, as production can.
      EVE_ENGINE_AUTHORITY: 'agenteve.io',
      EVE_FRAMES_DIR: framesDir,
      SUPABASE_JWKS_URL: jwks.url,
    });
    const service = createService({ config, db, keys: remoteKeys(config.jwksUrl), logger: logs });
    server = createServer(getRequestListener((request, env) => service.handle(request, { address: 'incoming' in env ? env.incoming.socket.remoteAddress : undefined }), { overrideGlobalObjects: false }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    endpoint = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}/mcp`;
  }, 120_000);

  afterAll(async () => {
    await Promise.allSettled(clients.map((c) => c.close()));
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await world?.close();
    await jwks?.close();
    await db?.close();
    rmSync(framesDir, { recursive: true, force: true });
  });

  async function connect(token?: string): Promise<Client> {
    const client = new Client({ name: 'claude-ai', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), token === undefined ? {} : { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    clients.push(client);
    return client;
  }

  it('plays enroll → observe → act through an MCP client, signed by the service, verified by the engine', async () => {
    const anonymous = await connect();
    expect((await anonymous.listTools()).tools).toHaveLength(12);
    const status = payload(await anonymous.callTool({ name: 'eve_status', arguments: {} }));
    expect((status['report'] as { world: string }).world).toBe('RUNNING');
    const rules = payload(await anonymous.callTool({ name: 'eve_rules', arguments: { section: '0' } }));
    expect(String(rules['text'])).toMatch(/^## 0\. Your first wake/);

    // Signed out, an account tool is a 401 pointing at the resource metadata.
    const challenged = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'eve_observe', arguments: {} } }),
    });
    expect(challenged.status).toBe(401);
    expect(challenged.headers.get('www-authenticate')).toContain('resource_metadata="https://mcp.test.example/.well-known/oauth-protected-resource/mcp"');

    const token = await issuer.mcpToken();
    const player = await connect(token);
    const call = async (name: string, args: Record<string, unknown> = {}) => payload(await player.callTool({ name, arguments: args }));

    const enrolled = await call('eve_enroll', { handle: 'e2e-hosted' });
    expect(enrolled).toMatchObject({ httpStatus: 201, principalId: 'p:e2e-hosted', signer: 'hosted', mcpError: false });
    expect(await call('eve_identity')).toMatchObject({ enrolled: true, handle: 'e2e-hosted', keyid: enrolled['keyid'] });

    // The key takes effect on the next tick (agent.md §2); a 401 KEY_NOT_YET_REGISTERED until then.
    let observed = await call('eve_observe');
    for (let i = 0; i < 20 && observed['httpStatus'] === 401; i++) {
      expect(observed['reason']).toBe('KEY_NOT_YET_REGISTERED');
      await sleep(500);
      observed = await call('eve_observe');
    }
    expect(observed).toMatchObject({ httpStatus: 200, mcpError: false });
    // ★ The engine verified the gateway header at enrolment and recorded the key as hosted: the agent's
    // own record says so (SPEC §3 SIGNER), on the same row counterparties[] and the frames carry.
    const ownStanding = (observed['observation'] as { header: { standing: Record<string, unknown> } }).header.standing;
    expect(ownStanding['principal']).toBe('p:e2e-hosted');
    expect(ownStanding['signer']).toBe('hosted');
    // live.json is written to the frames directory every tick and served by nginx off disk — the
    // engine's own /frames/ route does not serve it — so the service reads the directory
    // (production: nginx's loopback listener) and eve_map keeps the live clock once a tick has run.
    let map = payload(await anonymous.callTool({ name: 'eve_map', arguments: {} }));
    for (let i = 0; i < 20 && typeof map['phase'] !== 'string'; i++) {
      await sleep(500);
      map = payload(await anonymous.callTool({ name: 'eve_map', arguments: {} }));
    }
    expect(typeof map['phase']).toBe('string');
    expect(typeof map['ticksUntilReckoning']).toBe('number');
    expect(typeof map['tick']).toBe('number');
    // Claude takes tool results up to about 150,000 characters; a fresh world is ~33,000.
    expect(JSON.stringify(observed).length).toBeLessThan(150_000);
    const affordances = (observed['observation'] as { affordances: { verb: string; params: Record<string, unknown>; quote_id?: string }[] }).affordances;
    expect(affordances.length).toBeGreaterThan(0);
    const row = affordances.find((a) => a.verb === 'levy_vote') ?? (affordances[0] as { verb: string; params: Record<string, unknown> });

    const acted = await call('eve_act', { actions: [row] });
    expect(acted).toMatchObject({ httpStatus: 200, replayed: false, mcpError: false });
    expect((acted['outcome'] as { accepted: unknown[] }).accepted, JSON.stringify(acted['outcome'])).toHaveLength(1);

    // The host retries the identical call: answered from the signing log, not sent again.
    const retried = await call('eve_act', { actions: [row] });
    expect(retried).toMatchObject({ replayed: true, source: 'signing_log', idempotencyKey: acted['idempotencyKey'] });

    // An illegal action is a correction, not an error, and nothing halts.
    const illegal = await call('eve_act', { actions: [{ verb: 'invent_money', params: {} }] });
    expect(illegal['httpStatus']).toBe(200);
    expect((illegal['outcome'] as { corrections: unknown[] }).corrections.length).toBeGreaterThan(0);

    // ★ A standing offer puts the agent on the live frame's dealing marks — where a principal's record
    // appears between Reckonings — and eve_dossier, a SIGNED-OUT spectator tool reading only the public
    // frames, reports who signs for it: Agent Eve's server.
    const offered = await call('eve_act', { actions: [{ verb: 'publish_offer', params: { text: 'HANDS FOR HIRE, PLAYED FROM CHAT' } }] });
    expect((offered['outcome'] as { accepted: unknown[] }).accepted, JSON.stringify(offered['outcome'])).toHaveLength(1);
    let dossier = payload(await anonymous.callTool({ name: 'eve_dossier', arguments: { handle: 'e2e-hosted' } }));
    for (let i = 0; i < 40 && dossier['signer'] !== 'hosted'; i++) {
      await sleep(500);
      dossier = payload(await anonymous.callTool({ name: 'eve_dossier', arguments: { handle: 'e2e-hosted' } }));
    }
    expect(dossier).toMatchObject({ handle: 'e2e-hosted', found: true, signer: 'hosted' });
    // And /health says the engine verifies the header at all, and counts the key.
    const health = payload(await anonymous.callTool({ name: 'eve_status', arguments: {} }));
    expect((health['report'] as { signers: Record<string, unknown> }).signers).toMatchObject({ gateway: 'configured', hosted: 1 });

    const wake = await call('eve_wake_status');
    expect(wake).toMatchObject({ enrolled: true, handle: 'e2e-hosted', mcpError: false });
    expect(typeof wake['nextDecisionAt']).toBe('number');
    expect(wake['wakesRemaining']).toBeLessThan(16);

    expect((await call('eve_report', { expected: 'e2e expected', observed: 'e2e observed' }))['httpStatus']).toBe(202);

    const log = (await call('eve_signing_log'))['entries'] as { path: string; signed: boolean; httpStatus: number | null }[];
    expect(log.some((e) => e.path === '/api/enroll' && !e.signed && e.httpStatus === 201)).toBe(true);
    expect(log.some((e) => e.path === '/api/observe' && e.signed && e.httpStatus === 200)).toBe(true);
    // levy_vote, the illegal act, and the offer: three sent (the retry was answered from this log, not sent).
    expect(log.filter((e) => e.path === '/api/act' && e.signed && e.httpStatus === 200)).toHaveLength(3);

    // One agent per account, enforced before the engine is asked.
    expect(String((await call('eve_enroll', { handle: 'e2e-second' }))['error'])).toMatch(/already has an agent/);
  }, 90_000);
});
