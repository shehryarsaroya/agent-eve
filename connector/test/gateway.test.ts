import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GATEWAY_HEADER, gatewayHeaders, isLoopback, verifyGatewayHeaders } from '../src/engine/gateway.js';

const secret = randomBytes(32);
const account = randomUUID();
const now = 1_800_000_000;
const request = { method: 'POST', path: '/api/act', contentDigest: 'sha-256=:abc=:', peer: '127.0.0.1', now };

function headersFor(overrides: Partial<{ method: string; path: string; contentDigest: string | null; now: number }> = {}) {
  return gatewayHeaders(secret, { accountId: account, method: 'POST', path: '/api/act', contentDigest: 'sha-256=:abc=:', now, ...overrides });
}

describe('the gateway header', () => {
  it('verifies for the request it was made for', () => {
    expect(verifyGatewayHeaders(secret, headersFor(), request)).toEqual({ ok: true, accountId: account });
  });

  it('binds the method, path, body digest and time', () => {
    const headers = headersFor();
    expect(verifyGatewayHeaders(secret, headers, { ...request, method: 'GET' })).toEqual({ ok: false, reason: 'BAD_MAC' });
    expect(verifyGatewayHeaders(secret, headers, { ...request, path: '/api/enroll' })).toEqual({ ok: false, reason: 'BAD_MAC' });
    expect(verifyGatewayHeaders(secret, headers, { ...request, contentDigest: 'sha-256=:other=:' })).toEqual({ ok: false, reason: 'BAD_MAC' });
    expect(verifyGatewayHeaders(secret, headers, { ...request, now: now + 61 })).toEqual({ ok: false, reason: 'STALE' });
    expect(verifyGatewayHeaders(randomBytes(32), headers, request)).toEqual({ ok: false, reason: 'BAD_MAC' });
  });

  it('is refused from a non-loopback peer, and when incomplete or absent', () => {
    expect(verifyGatewayHeaders(secret, headersFor(), { ...request, peer: '203.0.113.7' })).toEqual({ ok: false, reason: 'NOT_LOOPBACK' });
    const partial = { [GATEWAY_HEADER.account]: account };
    expect(verifyGatewayHeaders(secret, partial, request)).toEqual({ ok: false, reason: 'INCOMPLETE' });
    expect(verifyGatewayHeaders(secret, {}, request)).toEqual({ ok: false, reason: 'ABSENT' });
    const forged = { ...headersFor(), [GATEWAY_HEADER.account]: randomUUID() };
    expect(verifyGatewayHeaders(secret, forged, request)).toEqual({ ok: false, reason: 'BAD_MAC' });
  });

  it('knows loopback when it sees it', () => {
    for (const address of ['127.0.0.1', '127.8.9.1', '::1', '::ffff:127.0.0.1']) expect(isLoopback(address)).toBe(true);
    for (const address of ['10.0.0.1', '::ffff:10.0.0.1', '89.117.78.215', undefined]) expect(isLoopback(address)).toBe(false);
  });

  it('refuses to name a non-UUID account', () => {
    expect(() => gatewayHeaders(secret, { accountId: 'p:vale', method: 'GET', path: '/', contentDigest: null, now })).toThrow();
  });
});
