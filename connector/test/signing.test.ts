/**
 * The service's requests, checked by the ENGINE's own RFC 9421 verifier
 * (`engine/src/identity`), byte for byte as the engine will check them in production.
 */

import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BoundedReplayStore, Keyring, recordFromJwk, verifySignedRequest, wallSeconds } from '../../engine/src/identity/index.js';
import type { PrincipalId } from '../../engine/src/core/types.js';
import { generateAgentKey, privateJwk } from '../src/crypto/keys.js';
import { EngineClient } from '../src/engine/client.js';
import * as connectorGateway from '../src/engine/gateway.js';
// The ENGINE's verifier, imported from the engine — the one the server runs on every request.
import * as engineGateway from '../../engine/src/api/gateway.js';

const { verifyGatewayHeaders } = engineGateway;

interface Captured {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
  readonly peer: string | undefined;
}

let server: Server;
let port = 0;
const captured: Captured[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      captured.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks), peer: req.socket.remoteAddress });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  port = typeof address === 'object' && address !== null ? address.port : 0;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function verify(request: Captured, keyring: Keyring, replay: BoundedReplayStore) {
  const headers = Object.fromEntries(Object.entries(request.headers).filter((e): e is [string, string] => typeof e[1] === 'string'));
  return verifySignedRequest({
    request: {
      method: request.method,
      scheme: 'http',
      authority: String(request.headers.host),
      requestTarget: request.url,
      headers,
      body: request.body.length === 0 ? null : new Uint8Array(request.body),
    },
    now: wallSeconds(Math.floor(Date.now() / 1000)),
    tick: 1,
    directory: keyring,
    replay,
  });
}

describe('signed engine requests', () => {
  const key = generateAgentKey();
  const signer = { keyid: key.keyid, privateKey: privateJwk(key.publicKey, key.seed) };
  const secret = randomBytes(32);
  const account = randomUUID();
  const keyring = new Keyring();
  keyring.register('p:tester' as PrincipalId, recordFromJwk({ kty: 'OKP', crv: 'Ed25519', x: key.publicKey }), 0);
  const replay = new BoundedReplayStore({ retention: wallSeconds(120), perKeyCap: 512, maxKeys: 4096 });

  function client(authority?: string) {
    return new EngineClient({
      engineUrl: `http://127.0.0.1:${port}`,
      authority: authority ?? `127.0.0.1:${port}`,
      clientIp: '127.0.0.1',
      gatewaySecret: secret,
      timeoutMs: 5000,
      maxConcurrent: 4,
    });
  }

  it('verify under the engine verifier, bodyless and with a body', async () => {
    captured.length = 0;
    await client().call({ method: 'GET', path: '/api/observe', signer, accountId: account });
    await client().call({ method: 'POST', path: '/api/act', payload: { actions: [{ verb: 'levy_vote', params: { choice: 'EVEN' }, clientSequence: 1 }], idempotencyKey: 'mcp-x' }, signer, accountId: account });
    expect(captured).toHaveLength(2);
    for (const request of captured) {
      const verdict = verify(request, keyring, replay);
      expect(verdict.ok, JSON.stringify(verdict)).toBe(true);
      if (verdict.ok) expect(verdict.value.principal).toBe('p:tester');
      expect(request.headers['cf-connecting-ip']).toBe('127.0.0.1');
    }
    expect(String(captured[0]?.headers['signature-input'])).toContain('("@method" "@path" "@authority")');
    expect(String(captured[1]?.headers['signature-input'])).toContain('"content-digest"');
  });

  it('signs the public authority it sends as Host, while connecting to loopback', async () => {
    captured.length = 0;
    await client('agenteve.io').call({ method: 'GET', path: '/api/observe', signer });
    const request = captured[0] as Captured;
    expect(request.headers.host).toBe('agenteve.io');
    expect(verify(request, keyring, replay).ok).toBe(true);
  });

  it('is refused for a tampered body and for a replayed nonce', async () => {
    captured.length = 0;
    await client().call({ method: 'POST', path: '/api/act', payload: { actions: [] }, signer });
    const original = captured[0] as Captured;
    const tampered = { ...original, body: Buffer.from(JSON.stringify({ actions: ['steal'] })) };
    const refused = verify(tampered, keyring, new BoundedReplayStore({ retention: wallSeconds(120), perKeyCap: 512, maxKeys: 4096 }));
    expect(refused.ok).toBe(false);
    const fresh = new BoundedReplayStore({ retention: wallSeconds(120), perKeyCap: 512, maxKeys: 4096 });
    expect(verify(original, keyring, fresh).ok).toBe(true);
    const again = verify(original, keyring, fresh);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe('NONCE_REPLAYED');
  });

  it("the connector's gateway module IS the engine's — one function signs and verifies", () => {
    expect(connectorGateway.gatewayHeaders).toBe(engineGateway.gatewayHeaders);
    expect(connectorGateway.verifyGatewayHeaders).toBe(engineGateway.verifyGatewayHeaders);
    expect(connectorGateway.GATEWAY_HEADER).toBe(engineGateway.GATEWAY_HEADER);
  });

  it("carries a gateway header the engine's verifier accepts, binding the body even unsigned", async () => {
    captured.length = 0;
    await client().call({ method: 'POST', path: '/api/enroll', payload: { handle: 'vale', publicKey: key.publicKey }, accountId: account });
    const request = captured[0] as Captured;
    expect(request.headers['signature']).toBeUndefined();
    const digest = String(request.headers['content-digest']);
    expect(digest).toMatch(/^sha-256=:[A-Za-z0-9+/]+=*:$/);
    const headers = Object.fromEntries(Object.entries(request.headers).filter((e): e is [string, string] => typeof e[1] === 'string'));
    const verdict = verifyGatewayHeaders(secret, headers, { method: 'POST', path: '/api/enroll', contentDigest: digest, peer: request.peer, now: Date.now() / 1000 });
    expect(verdict).toEqual({ ok: true, accountId: account });
    const lifted = verifyGatewayHeaders(secret, headers, { method: 'POST', path: '/api/act', contentDigest: digest, peer: request.peer, now: Date.now() / 1000 });
    expect(lifted.ok).toBe(false);
  });

  it("signed requests carry a gateway header the engine's verifier accepts, over the exact Content-Digest the signature covers", async () => {
    captured.length = 0;
    await client().call({ method: 'POST', path: '/api/act', payload: { actions: [{ verb: 'levy_vote', params: { choice: 'EVEN' }, clientSequence: 2 }] }, signer, accountId: account });
    await client().call({ method: 'GET', path: '/api/observe', signer, accountId: account });
    for (const request of captured) {
      const headers = Object.fromEntries(Object.entries(request.headers).filter((e): e is [string, string] => typeof e[1] === 'string'));
      const digest = typeof request.headers['content-digest'] === 'string' ? request.headers['content-digest'] : null;
      expect(digest !== null, 'a body travels with its digest, and a bodyless request with none').toBe(request.body.length > 0);
      const verdict = verifyGatewayHeaders(secret, headers, { method: request.method, path: request.url, contentDigest: digest, peer: request.peer, now: Date.now() / 1000 });
      expect(verdict, `${request.method} ${request.url}`).toEqual({ ok: true, accountId: account });
    }
  });
});
