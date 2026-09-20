import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { serve } from '../../engine/dist/api/server.js';
import { signedHeaders } from '../client.mjs';

const bridge = fileURLToPath(new URL('../server.mjs', import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('MCP agents enroll, sign, act, retry, reject impersonation and resume identities', { timeout: 90000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'eve-mcp-test-'));
  process.env.COMPACT_SPEED = 'turbo';
  process.env.COMPACT_CAST_LLM = '0';
  const world = await serve({ port: 0, host: '127.0.0.1', seed: 'mcp-protocol-test', trustEdge: false, castSize: 3, framesDir: join(directory, 'frames') });
  const origin = `http://127.0.0.1:${world.port}`;
  const clients = [];
  async function connect(name) {
    const client = new Client({ name, version: '1.0.0' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [bridge], env: { ...process.env, AGENTEVE_URL: origin, AGENTEVE_IDENTITY_FILE: join(directory, `${name}.json`) }, stderr: 'pipe' });
    await client.connect(transport);
    clients.push(client);
    return client;
  }
  async function call(client, name, args = {}) {
    const result = await client.callTool({ name, arguments: args });
    return { ...JSON.parse(result.content[0].text), mcpError: result.isError === true };
  }
  try {
    const builder = await connect('qa-builder');
    const trader = await connect('qa-trader');
    const observer = await connect('qa-observer');
    await t.test('discovery, resources and missing identity', async () => {
      assert.equal((await builder.listTools()).tools.length, 7);
      const resource = await builder.readResource({ uri: 'agenteve://rules' });
      assert.match(resource.contents[0].text, /AGENT EVE/);
      assert.equal((await call(builder, 'eve_observe')).mcpError, true);
      assert.equal((await call(builder, 'eve_identity')).enrolled, false);
    });
    const enrolled = [];
    await t.test('three independent Ed25519 identities, private keys stay local', async () => {
      for (const [client, handle] of [[builder, 'qa-builder'], [trader, 'qa-trader'], [observer, 'qa-observer']]) {
        const result = await call(client, 'eve_enroll', { handle });
        assert.equal(result.httpStatus, 201, JSON.stringify(result));
        enrolled.push(result);
        assert.equal(statSync(join(directory, `${handle}.json`)).mode & 0o777, 0o600);
        const secret = JSON.parse(readFileSync(join(directory, `${handle}.json`))).privateKey.d;
        assert.ok(!JSON.stringify(result).includes(secret));
        assert.ok(!JSON.stringify(await call(client, 'eve_identity')).includes(secret));
      }
      assert.equal(new Set(enrolled.map(x => x.keyid)).size, 3);
    });
    const start = (await call(builder, 'eve_status')).report.tick;
    for (let i = 0; i < 30 && (await call(builder, 'eve_status')).report.tick <= start; i++) await delay(200);
    let observations;
    await t.test('each agent obtains its own signed observation', async () => {
      observations = await Promise.all([builder, trader, observer].map(c => call(c, 'eve_observe')));
      for (const result of observations) assert.equal(result.httpStatus, 200, JSON.stringify(result));
      for (const result of observations) assert.ok(result.observation.affordances.length > 0);
    });
    let accepted;
    await t.test('real afforded action and duplicate delivery are idempotent', async () => {
      const row = observations[0].observation.affordances.find(x => x.verb === 'levy_vote') ?? observations[0].observation.affordances[0];
      const action = { ...row, clientSequence: 101 };
      accepted = await call(builder, 'eve_act', { actions: [action], idempotencyKey: 'mcp-retry-test' });
      assert.equal(accepted.httpStatus, 200, JSON.stringify(accepted));
      assert.equal(accepted.outcome.accepted.length, 1, JSON.stringify(accepted.outcome));
      const retry = await call(builder, 'eve_act', { actions: [action], idempotencyKey: 'mcp-retry-test' });
      assert.equal(retry.replayed, true, JSON.stringify(retry));
      assert.deepEqual(retry.outcome, accepted.outcome);
    });
    await t.test('invalid MCP arguments and illegal game actions are refused without halting', async () => {
      const invalid = await builder.callTool({ name: 'eve_act', arguments: { actions: [] } });
      assert.equal(invalid.isError, true);
      const bad = await call(trader, 'eve_act', { actions: [{ verb: 'invent_money', params: {} }] });
      assert.equal(bad.httpStatus, 200);
      assert.equal(bad.outcome.accepted.length, 0, JSON.stringify(bad.outcome));
      assert.ok(bad.outcome.corrections.length > 0);
      assert.equal((await call(observer, 'eve_status')).report.world, 'RUNNING');
    });
    await t.test('wrong-key impersonation and repeated signature nonce are rejected', async () => {
      const a = JSON.parse(readFileSync(join(directory, 'qa-builder.json')));
      const b = JSON.parse(readFileSync(join(directory, 'qa-trader.json')));
      const url = new URL('/api/observe', origin);
      const forged = signedHeaders({ ...a, privateKey: b.privateKey }, 'GET', url);
      assert.equal((await fetch(url, { headers: forged })).status, 401);
      const valid = signedHeaders(a, 'GET', url);
      assert.equal((await fetch(url, { headers: valid })).status, 200);
      assert.equal((await fetch(url, { headers: valid })).status, 401);
    });
    await t.test('bridge restart resumes the same identity and cannot switch handles', async () => {
      const original = await call(builder, 'eve_identity');
      await builder.close();
      const resumed = await connect('qa-builder');
      assert.equal((await call(resumed, 'eve_identity')).keyid, original.keyid);
      assert.equal((await call(resumed, 'eve_enroll', { handle: 'qa-builder' })).resumed, true);
      assert.equal((await call(resumed, 'eve_observe')).httpStatus, 200);
      assert.equal((await call(resumed, 'eve_enroll', { handle: 'different-handle' })).mcpError, true);
    });
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    await world.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
