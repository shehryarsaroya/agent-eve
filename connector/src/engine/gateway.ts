/**
 * The gateway header: how the engine will learn which ACCOUNT a hosted request belongs to, so
 * its rate limits can apply per account instead of to one shared loopback address.
 *
 * Three headers, all required together:
 *
 *   X-Eve-Gateway-Account: <account uuid>
 *   X-Eve-Gateway-Time:    <unix seconds>
 *   X-Eve-Gateway-Mac:     base64url( HMAC-SHA256( secret,
 *                            "eve-gateway-v1\n" METHOD "\n" PATH "\n" ACCOUNT "\n" TIME "\n" CONTENT-DIGEST ) )
 *
 * CONTENT-DIGEST is the request's `Content-Digest` header value, or the empty string for a
 * bodyless request. Binding the method, path and body means a header captured from one request
 * cannot be lifted onto another; the time bounds replay to the skew window.
 *
 * Why a MAC and not "trust it because it came from loopback": nginx is ALSO a loopback peer of
 * the engine, so a header a public client sent would arrive from 127.0.0.1 if nginx forwarded it.
 * The engine change (README) verifies the MAC, requires a loopback peer, and the public vhost
 * strips these headers — three independent conditions, any one of which stops a spoof.
 *
 * `verifyGatewayHeaders` is the reference verifier the engine change should port.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const GATEWAY_HEADER = {
  account: 'x-eve-gateway-account',
  time: 'x-eve-gateway-time',
  mac: 'x-eve-gateway-mac',
} as const;

export const GATEWAY_MAX_SKEW_SECONDS = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface GatewayInput {
  readonly accountId: string;
  readonly method: string;
  readonly path: string;
  readonly contentDigest: string | null;
  readonly now: number;
}

function macOf(secret: Buffer, method: string, path: string, account: string, time: string, digest: string): Buffer {
  return createHmac('sha256', secret)
    .update(['eve-gateway-v1', method.toUpperCase(), path, account, time, digest].join('\n'), 'utf8')
    .digest();
}

export function gatewayHeaders(secret: Buffer, input: GatewayInput): Record<string, string> {
  if (!UUID.test(input.accountId)) throw new Error('gateway account must be a lowercase UUID');
  const time = String(Math.floor(input.now));
  const mac = macOf(secret, input.method, input.path, input.accountId, time, input.contentDigest ?? '');
  return {
    [GATEWAY_HEADER.account]: input.accountId,
    [GATEWAY_HEADER.time]: time,
    [GATEWAY_HEADER.mac]: mac.toString('base64url'),
  };
}

export type GatewayVerdict =
  | { readonly ok: true; readonly accountId: string }
  | { readonly ok: false; readonly reason: 'ABSENT' | 'INCOMPLETE' | 'NOT_LOOPBACK' | 'MALFORMED' | 'STALE' | 'BAD_MAC' };

export function isLoopback(address: string | undefined): boolean {
  if (address === undefined) return false;
  const a = address.startsWith('::ffff:') ? address.slice(7) : address;
  return a === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a);
}

/** Reference verification, as the engine should run it. */
export function verifyGatewayHeaders(
  secret: Buffer,
  headers: Readonly<Record<string, string | undefined>>,
  request: { readonly method: string; readonly path: string; readonly contentDigest: string | null; readonly peer: string | undefined; readonly now: number },
): GatewayVerdict {
  const account = headers[GATEWAY_HEADER.account];
  const time = headers[GATEWAY_HEADER.time];
  const mac = headers[GATEWAY_HEADER.mac];
  if (account === undefined && time === undefined && mac === undefined) return { ok: false, reason: 'ABSENT' };
  if (account === undefined || time === undefined || mac === undefined) return { ok: false, reason: 'INCOMPLETE' };
  if (!isLoopback(request.peer)) return { ok: false, reason: 'NOT_LOOPBACK' };
  if (!UUID.test(account) || !/^\d{1,12}$/.test(time) || !/^[A-Za-z0-9_-]{43}$/.test(mac)) return { ok: false, reason: 'MALFORMED' };
  if (Math.abs(request.now - Number(time)) > GATEWAY_MAX_SKEW_SECONDS) return { ok: false, reason: 'STALE' };
  const expected = macOf(secret, request.method, request.path, account, time, request.contentDigest ?? '');
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'BAD_MAC' };
  return { ok: true, accountId: account };
}
