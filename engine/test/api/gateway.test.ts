/**
 * ★ THE GATEWAY HEADER — verified exactly, refused loudly, and never trusted without a secret.
 *
 * `api/gateway.ts` is the one home of the MAC: the connector re-exports it and the server verifies with
 * it. These are its verdicts, first as a function (where a non-loopback peer can be named) and then
 * over a real socket, where the header has to survive Express, the body reader and the router-level
 * check before any route runs.
 */

import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GATEWAY_HEADER,
  GATEWAY_MAX_SKEW_SECONDS,
  GATEWAY_REFUSAL,
  decodeGatewaySecret,
  gatewayHeaders,
  isLoopback,
  verifyGatewayHeaders,
} from '../../src/api/gateway.js';
import type { PrincipalId } from '../../src/core/types.js';
import {
  PATHS,
  agent,
  buildSigned,
  harness,
  publicKeyOf,
  raw,
  type Agent,
  type Harness,
} from './harness.js';

/** Fixed bytes, not random ones: a test may not draw unseeded randomness (DET-7's spirit). */
const SECRET = Buffer.alloc(32, 0x5a);
const OTHER = Buffer.alloc(32, 0x33);
const ACCOUNT = '0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
const NOW = 1_700_000_000;
const REQUEST = { method: 'POST', path: '/api/act', contentDigest: 'sha-256=:abc=:', peer: '127.0.0.1', now: NOW };

function headersFor(over: Partial<{ method: string; path: string; contentDigest: string | null; now: number; accountId: string }> = {}) {
  return gatewayHeaders(SECRET, { accountId: ACCOUNT, method: 'POST', path: '/api/act', contentDigest: 'sha-256=:abc=:', now: NOW, ...over });
}

describe('★ verifyGatewayHeaders — every verdict, as a function', () => {
  it('a good header verifies and names its account', () => {
    expect(verifyGatewayHeaders(SECRET, headersFor(), REQUEST)).toEqual({ ok: true, accountId: ACCOUNT });
  });

  it('STALE beyond the skew window either way, and fine exactly at its edge', () => {
    expect(verifyGatewayHeaders(SECRET, headersFor(), { ...REQUEST, now: NOW + GATEWAY_MAX_SKEW_SECONDS + 1 })).toEqual({ ok: false, reason: 'STALE' });
    expect(verifyGatewayHeaders(SECRET, headersFor(), { ...REQUEST, now: NOW - GATEWAY_MAX_SKEW_SECONDS - 1 })).toEqual({ ok: false, reason: 'STALE' });
    expect(verifyGatewayHeaders(SECRET, headersFor(), { ...REQUEST, now: NOW + GATEWAY_MAX_SKEW_SECONDS }).ok).toBe(true);
    expect(verifyGatewayHeaders(SECRET, headersFor(), { ...REQUEST, now: NOW - GATEWAY_MAX_SKEW_SECONDS }).ok).toBe(true);
  });

  it('BAD_MAC under another secret, and for a header lifted onto another method, path, body or account', () => {
    const headers = headersFor();
    expect(verifyGatewayHeaders(OTHER, headers, REQUEST)).toEqual({ ok: false, reason: 'BAD_MAC' });
    expect(verifyGatewayHeaders(SECRET, headers, { ...REQUEST, method: 'GET' })).toEqual({ ok: false, reason: 'BAD_MAC' });
    expect(verifyGatewayHeaders(SECRET, headers, { ...REQUEST, path: '/api/enroll' })).toEqual({ ok: false, reason: 'BAD_MAC' });
    expect(verifyGatewayHeaders(SECRET, headers, { ...REQUEST, contentDigest: 'sha-256=:other=:' })).toEqual({ ok: false, reason: 'BAD_MAC' });
    expect(verifyGatewayHeaders(SECRET, headers, { ...REQUEST, contentDigest: null })).toEqual({ ok: false, reason: 'BAD_MAC' });
    const forged = { ...headers, [GATEWAY_HEADER.account]: '11111111-2222-4333-8444-555555555555' };
    expect(verifyGatewayHeaders(SECRET, forged, REQUEST)).toEqual({ ok: false, reason: 'BAD_MAC' });
  });

  it('NOT_LOOPBACK from any peer that is not 127.0.0.0/8 or ::1', () => {
    for (const peer of ['203.0.113.7', '10.0.0.1', '::ffff:10.0.0.1', '89.117.78.215', undefined]) {
      expect(verifyGatewayHeaders(SECRET, headersFor(), { ...REQUEST, peer })).toEqual({ ok: false, reason: 'NOT_LOOPBACK' });
    }
    for (const peer of ['127.0.0.1', '127.8.9.1', '::1', '::ffff:127.0.0.1']) {
      expect(isLoopback(peer)).toBe(true);
      expect(verifyGatewayHeaders(SECRET, headersFor(), { ...REQUEST, peer }).ok).toBe(true);
    }
  });

  it('NOT_CONFIGURED with no secret — the header is never trusted, however well-formed', () => {
    expect(verifyGatewayHeaders(null, headersFor(), REQUEST)).toEqual({ ok: false, reason: 'NOT_CONFIGURED' });
    expect(verifyGatewayHeaders(Buffer.alloc(16, 1), headersFor(), REQUEST)).toEqual({ ok: false, reason: 'NOT_CONFIGURED' });
  });

  it('ABSENT with none of the three, INCOMPLETE with some, MALFORMED with the wrong shapes', () => {
    expect(verifyGatewayHeaders(SECRET, {}, REQUEST)).toEqual({ ok: false, reason: 'ABSENT' });
    expect(verifyGatewayHeaders(null, {}, REQUEST)).toEqual({ ok: false, reason: 'ABSENT' });
    expect(verifyGatewayHeaders(SECRET, { [GATEWAY_HEADER.account]: ACCOUNT }, REQUEST)).toEqual({ ok: false, reason: 'INCOMPLETE' });
    const good = headersFor();
    for (const bad of [
      { ...good, [GATEWAY_HEADER.account]: ACCOUNT.toUpperCase() },
      { ...good, [GATEWAY_HEADER.time]: '17e8' },
      { ...good, [GATEWAY_HEADER.mac]: 'short' },
      { ...good, [GATEWAY_HEADER.account]: [ACCOUNT, ACCOUNT] },
    ]) {
      expect(verifyGatewayHeaders(SECRET, bad, REQUEST)).toEqual({ ok: false, reason: 'MALFORMED' });
    }
  });

  it('refuses to build a header for an account that is not a lowercase UUID', () => {
    expect(() => headersFor({ accountId: 'p:vale' })).toThrow();
  });

  it('decodes the secret the way the connector does: base64, base64url or hex, exactly 32 bytes', () => {
    for (const text of [SECRET.toString('base64'), SECRET.toString('base64url'), SECRET.toString('hex'), ` ${SECRET.toString('base64')}\n`]) {
      const decoded = decodeGatewaySecret(text);
      expect(decoded.ok).toBe(true);
      if (decoded.ok) expect(decoded.secret.equals(SECRET)).toBe(true);
    }
    for (const text of ['', '   ', Buffer.alloc(16, 1).toString('base64'), 'not a key at all!', 'z'.repeat(64)]) {
      expect(decodeGatewaySecret(text).ok).toBe(false);
    }
  });

  it('every refusal code is distinct and spelled as its key', () => {
    const codes = Object.entries(GATEWAY_REFUSAL);
    for (const [key, value] of codes) expect(value).toBe(key);
    expect(new Set(codes.map(([, v]) => v)).size).toBe(codes.length);
  });
});

// ── Over a real socket ──────────────────────────────────────────────────────

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

function nowOf(x: Harness): number {
  return Math.floor(x.clock.nowMs() / 1000);
}

function digestOf(text: string): string {
  return `sha-256=:${createHash('sha256').update(text).digest('base64')}:`;
}

/** An unsigned JSON POST carrying a gateway header built the way the connector builds one. */
async function gatewayPost(
  x: Harness,
  path: string,
  body: unknown,
  over: { secret?: Buffer; account?: string; now?: number; macDigest?: string | null; sentDigest?: string | null } = {},
) {
  const text = JSON.stringify(body);
  const digest = digestOf(text);
  const macDigest = over.macDigest === undefined ? digest : over.macDigest;
  const sentDigest = over.sentDigest === undefined ? digest : over.sentDigest;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...gatewayHeaders(over.secret ?? SECRET, {
      accountId: over.account ?? ACCOUNT,
      method: 'POST',
      path,
      contentDigest: macDigest,
      now: over.now ?? nowOf(x),
    }),
  };
  if (sentDigest !== null) headers['content-digest'] = sentDigest;
  return raw(x, 'POST', path, text, headers);
}

function enrolBody(a: Agent): { handle: string; publicKey: string } {
  return { handle: a.handle, publicKey: publicKeyOf(a) };
}

describe('★ the gateway header over HTTP', () => {
  it('a verified enrolment mints a HOSTED principal, and its own first observation already says so', async () => {
    h = await harness({ gateway: { state: 'configured', secret: SECRET } });
    const a = agent('chat-one');
    const res = await gatewayPost(h, PATHS.enroll, enrolBody(a));
    expect(res.status, res.text).toBe(201);
    const keyid = String(res.json['keyid']);
    expect(h.context.signers.isHosted(keyid)).toBe(true);
    const observation = res.json['observation'] as { header: { standing: Record<string, unknown> } };
    expect(observation.header.standing['signer']).toBe('hosted');
    expect(h.context.signers.signerAt(`p:${a.handle}` as PrincipalId, h.runtime.engine.tick)).toBe('hosted');
  });

  it('a plain enrolment beside it is `self`', async () => {
    h = await harness({ gateway: { state: 'configured', secret: SECRET } });
    const a = agent('own-key');
    const res = await raw(h, 'POST', PATHS.enroll, JSON.stringify(enrolBody(a)), { 'content-type': 'application/json' });
    expect(res.status, res.text).toBe(201);
    expect(h.context.signers.isHosted(String(res.json['keyid']))).toBe(false);
    const observation = res.json['observation'] as { header: { standing: Record<string, unknown> } };
    expect(observation.header.standing['signer']).toBe('self');
  });

  it('STALE, BAD_MAC, DIGEST_MISMATCH and BODY_UNBOUND are each a 400 GATEWAY_UNVERIFIED that created nothing', async () => {
    h = await harness({ gateway: { state: 'configured', secret: SECRET } });
    const cases: readonly [string, Parameters<typeof gatewayPost>[3]][] = [
      ['STALE', { now: nowOf(h) - GATEWAY_MAX_SKEW_SECONDS - 5 }],
      ['BAD_MAC', { secret: OTHER }],
      // The MAC is over a digest of OTHER bytes, and that digest is what is sent: the MAC verifies and
      // the body does not match it.
      ['DIGEST_MISMATCH', { macDigest: digestOf('{"handle":"someone-else"}'), sentDigest: digestOf('{"handle":"someone-else"}') }],
      // No Content-Digest at all, MAC'd as bodyless: it verifies, and would bind nothing about the bytes.
      ['BODY_UNBOUND', { macDigest: null, sentDigest: null }],
    ];
    for (const [reason, over] of cases) {
      const a = agent(`refused-${reason.toLowerCase().replace(/_/g, '-')}`);
      const res = await gatewayPost(h, PATHS.enroll, enrolBody(a), over);
      expect(res.status, `${reason}: ${res.text}`).toBe(400);
      expect(res.json['reason']).toBe('GATEWAY_UNVERIFIED');
      expect(String(res.json['detail'])).toMatch(new RegExp(`^${reason}:`));
      expect(h.context.keyring.activeFor(`p:${a.handle}` as PrincipalId), `${reason} bound a key`).toBeNull();
      expect(h.runtime.world.holdingByPrincipal.has(`p:${a.handle}` as PrincipalId), `${reason} seated a principal`).toBe(false);
    }
    expect(h.context.seats.rows).toBe(0);
    expect(h.context.signers.health().hosted).toBe(0);
  });

  it('with no secret configured every gateway header is refused (NOT_CONFIGURED), and a malformed one likewise', async () => {
    for (const gateway of [undefined, { state: 'unset' } as const, { state: 'malformed' } as const]) {
      h = await harness(gateway === undefined ? {} : { gateway });
      const a = agent('no-secret');
      const res = await gatewayPost(h, PATHS.enroll, enrolBody(a));
      expect(res.status, res.text).toBe(400);
      expect(res.json['reason']).toBe('GATEWAY_UNVERIFIED');
      expect(String(res.json['detail'])).toMatch(/^NOT_CONFIGURED:.*COMPACT_GATEWAY_SECRET/);
      expect(h.context.seats.rows).toBe(0);
      await h.close();
      h = null;
    }
  });

  it('the refusal names the variables and never carries the secret, in any encoding', async () => {
    h = await harness({ gateway: { state: 'configured', secret: SECRET } });
    const res = await gatewayPost(h, PATHS.enroll, enrolBody(agent('leak-check')), { secret: OTHER });
    expect(res.json['reason']).toBe('GATEWAY_UNVERIFIED');
    expect(res.text).toContain('EVE_GATEWAY_SECRET');
    expect(res.text).toContain('COMPACT_GATEWAY_SECRET');
    for (const encoded of [SECRET.toString('base64'), SECRET.toString('base64url'), SECRET.toString('hex')]) {
      expect(res.text).not.toContain(encoded);
    }
  });

  it('the check runs before EVERY route — a follow request carrying a broken header is refused too', async () => {
    h = await harness({ gateway: { state: 'configured', secret: SECRET } });
    const res = await raw(h, 'POST', '/api/follow', JSON.stringify({ handle: 'vale', email: 'a@example.com' }), {
      'content-type': 'application/json',
      [GATEWAY_HEADER.account]: ACCOUNT,
    });
    expect(res.status).toBe(400);
    expect(res.json['reason']).toBe('GATEWAY_UNVERIFIED');
    expect(String(res.json['detail'])).toMatch(/^INCOMPLETE:/);
  });

  it('absent: nothing changes — the request is keyed by its address exactly as before', async () => {
    h = await harness({ gateway: { state: 'configured', secret: SECRET } });
    const res = await raw(h, 'GET', PATHS.health);
    expect([200, 503]).toContain(res.status);
    expect(res.json['reason']).toBeUndefined();
  });

  it('a header MAC\'d for one path and sent to another is BAD_MAC — signed or not', async () => {
    h = await harness({ gateway: { state: 'configured', secret: SECRET } });
    const a = agent('lifted');
    expect((await raw(h, 'POST', PATHS.enroll, JSON.stringify(enrolBody(a)), { 'content-type': 'application/json' })).status).toBe(201);
    h.runtime.runTick();
    const { headers } = buildSigned(h, a, 'GET', PATHS.observe);
    const lifted = gatewayHeaders(SECRET, { accountId: ACCOUNT, method: 'GET', path: PATHS.act, contentDigest: null, now: nowOf(h) });
    const res = await raw(h, 'GET', PATHS.observe, undefined, { ...headers, ...lifted });
    expect(res.status).toBe(400);
    expect(String(res.json['detail'])).toMatch(/^BAD_MAC:/);
  });

  it('★ a key the connector signs with is recorded as hosted on its next verified request — the self-heal', async () => {
    // A principal enrolled before this engine verified gateway headers (or whose hosted row was lost to a
    // crash) reads `self`; the first request the connector signs for it through a verified gateway header
    // proves the server holds the key, and records it.
    h = await harness({ gateway: { state: 'configured', secret: SECRET } });
    const a = agent('healed');
    const enrolled = await raw(h, 'POST', PATHS.enroll, JSON.stringify(enrolBody(a)), { 'content-type': 'application/json' });
    expect(enrolled.status).toBe(201);
    const principal = `p:${a.handle}` as PrincipalId;
    expect(h.context.signers.signerAt(principal, h.runtime.engine.tick)).toBe('self');
    h.runtime.runTick();
    const { headers } = buildSigned(h, a, 'GET', PATHS.observe);
    const gate = gatewayHeaders(SECRET, { accountId: ACCOUNT, method: 'GET', path: PATHS.observe, contentDigest: null, now: nowOf(h) });
    const res = await raw(h, 'GET', PATHS.observe, undefined, { ...headers, ...gate });
    expect(res.status, res.text).toBe(200);
    expect(h.context.signers.signerAt(principal, h.runtime.engine.tick)).toBe('hosted');
    const observation = res.json['observation'] as { header: { standing: Record<string, unknown> } };
    expect(observation.header.standing['signer']).toBe('hosted');
  });
});
