/**
 * ★ THE GATEWAY HEADER — how a request Agent Eve's own chat connector makes for an ACCOUNT is told
 * apart from every other request, so the host's rate limits key on the account rather than on the
 * one loopback address every chat player shares (A4), and so a principal enrolled that way is
 * published as `signer: hosted` (SPEC §3 SIGNER, `identity/signer.ts`).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **ONE HOME, TWO READERS.** The connector (`connector/src/engine/gateway.ts`) re-exports this module
 * and `server.ts` verifies with it, so what the connector SENDS and what the engine CHECKS are the same
 * function — not a reference implementation and a port of it that could drift by one newline. It is
 * self-contained on purpose (`node:crypto` and nothing else): the connector bundles it at build, and
 * `deploy/deploy-mcp.py` ships this one file beside `core/time.ts`.
 * ══════════════════════════════════════════════════════════════════════════
 *
 *   X-Eve-Gateway-Account: <account uuid, lowercase>
 *   X-Eve-Gateway-Time:    <unix seconds>
 *   X-Eve-Gateway-Mac:     base64url( HMAC-SHA256( secret,
 *                            "eve-gateway-v1\n" METHOD "\n" PATH "\n" ACCOUNT "\n" TIME "\n" CONTENT-DIGEST ) )
 *
 * PATH is the origin-form target exactly as sent, query included (`/api/act`). CONTENT-DIGEST is the
 * request's `Content-Digest` header (RFC 9530), or the empty string for a request with no body; the
 * server also checks that header against the body it read, so the MAC binds the bytes and not merely a
 * claim about them. Binding the method, path and body means a header lifted from one request cannot be
 * put on another; the time bounds a replay to the skew window.
 *
 * **Three independent conditions stop a spoof, and production requires all three.** The MAC — the secret
 * is shared by the connector and the engine and nothing else (`COMPACT_GATEWAY_SECRET` here,
 * `EVE_GATEWAY_SECRET` there, generated on the host and never printed). A loopback peer — the engine
 * listens on 127.0.0.1 only. And nginx stripping all three headers from every public request
 * (`deploy/nginx-agenteve-standalone.conf`), which is needed because nginx is ITSELF a loopback peer of
 * the engine: a header a stranger sent would otherwise arrive from 127.0.0.1.
 *
 * **Present but wrong is refused, never ignored.** A request carrying any of the three that does not
 * verify is answered `400 GATEWAY_UNVERIFIED` — falling back to the caller's IP would make a
 * misconfigured secret silent, and the symptom (every chat player metered as one) is the very failure
 * this header exists to end. With no secret configured, every gateway header is refused.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** The three header names, as node presents them (lower case). */
export const GATEWAY_HEADER = {
  account: 'x-eve-gateway-account',
  time: 'x-eve-gateway-time',
  mac: 'x-eve-gateway-mac',
} as const;

/**
 * How far the header's time may be from the engine's clock, either way, in wall-clock seconds.
 *
 * Wall-clock BY NATURE, and deliberately not derived from the tick: it bounds how long a captured MAC
 * could be replayed, which is real time whatever speed the world runs at — the reason RFC 9421's own
 * freshness window in `identity/httpsig.ts` is wall-clock too. `scripts/scale-audit.mjs` whitelists this
 * file with that reason.
 */
export const GATEWAY_MAX_SKEW_SECONDS = 60;

/** The MAC's domain-separation prefix. A new MAC input is a new version, never a silent change. */
export const GATEWAY_MAC_VERSION = 'eve-gateway-v1';

/** The shared secret's length, in bytes. */
export const GATEWAY_SECRET_BYTES = 32;

/** A connector account id: a UUID, lower case. The account half of the `acct:<uuid>` limiter key. */
const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** What a request's headers are read as. Node's `IncomingHttpHeaders` fits; so does a plain record. */
export type GatewayHeaders = Readonly<Record<string, string | readonly string[] | undefined>>;

export interface GatewayInput {
  readonly accountId: string;
  readonly method: string;
  /** Origin-form, query included: exactly the target the request is sent to. */
  readonly path: string;
  /** The request's `Content-Digest` header value, or null for a request with no body. */
  readonly contentDigest: string | null;
  /** Unix seconds. Injected — this module reads no clock. */
  readonly now: number;
}

function macOf(secret: Buffer, method: string, path: string, account: string, time: string, digest: string): Buffer {
  return createHmac('sha256', secret)
    .update([GATEWAY_MAC_VERSION, method.toUpperCase(), path, account, time, digest].join('\n'), 'utf8')
    .digest();
}

/** The three headers for one request. The connector's half. */
export function gatewayHeaders(secret: Buffer, input: GatewayInput): Record<string, string> {
  if (!ACCOUNT_ID.test(input.accountId)) throw new Error('gateway account must be a lowercase UUID');
  const time = String(Math.floor(input.now));
  const mac = macOf(secret, input.method, input.path, input.accountId, time, input.contentDigest ?? '');
  return {
    [GATEWAY_HEADER.account]: input.accountId,
    [GATEWAY_HEADER.time]: time,
    [GATEWAY_HEADER.mac]: mac.toString('base64url'),
  };
}

/**
 * Why a gateway header was refused. A const object rather than a string union, so the repo's §3
 * vocabulary guard (which reads `'A' | 'B'` unions) does not mistake these refusal codes for a
 * vocabulary that shares a word with `Coverage`'s `ABSENT` — absence is not a refusal here at all.
 */
export const GATEWAY_REFUSAL = {
  /** One or two of the three headers, not all three. */
  INCOMPLETE: 'INCOMPLETE',
  /** This engine has no `COMPACT_GATEWAY_SECRET`, or one that does not decode to 32 bytes. */
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  /** The connection did not come from 127.0.0.0/8 or ::1. */
  NOT_LOOPBACK: 'NOT_LOOPBACK',
  /** An account that is not a lowercase UUID, a time that is not an integer, a MAC that is not 32 bytes. */
  MALFORMED: 'MALFORMED',
  /** The time is more than {@link GATEWAY_MAX_SKEW_SECONDS} from the engine's clock. */
  STALE: 'STALE',
  /** The MAC does not match this request under this engine's secret. */
  BAD_MAC: 'BAD_MAC',
  /** A request with a body and no `Content-Digest`: the MAC would bind nothing about the bytes. */
  BODY_UNBOUND: 'BODY_UNBOUND',
  /** `Content-Digest` does not match the body that arrived. */
  DIGEST_MISMATCH: 'DIGEST_MISMATCH',
} as const;

export type GatewayRefusal = (typeof GATEWAY_REFUSAL)[keyof typeof GATEWAY_REFUSAL];

export type GatewayVerdict =
  | { readonly ok: true; readonly accountId: string }
  | { readonly ok: false; readonly reason: 'ABSENT' | GatewayRefusal };

/** 127.0.0.0/8, ::1, and either written as an IPv4-mapped IPv6 address. */
export function isLoopback(address: string | undefined): boolean {
  if (address === undefined) return false;
  const a = address.startsWith('::ffff:') ? address.slice(7) : address;
  return a === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a);
}

/** One header's value, or undefined. A repeated header arrives as a list and is never trusted. */
function one(headers: GatewayHeaders, name: string): string | undefined | null {
  const raw = headers[name];
  if (raw === undefined) return undefined;
  if (typeof raw === 'string') return raw;
  return null;
}

/**
 * Verify the three headers against one request. The engine's half; total — it never throws.
 *
 * Order, and each step is a distinct refusal so an operator can tell a missing secret from a wrong one:
 * presence · a secret to check against · a loopback peer · shape · freshness · the MAC (compared in
 * constant time). The body's own digest is checked by the caller, which holds the bytes.
 */
export function verifyGatewayHeaders(
  secret: Buffer | null,
  headers: GatewayHeaders,
  request: {
    readonly method: string;
    readonly path: string;
    readonly contentDigest: string | null;
    readonly peer: string | undefined;
    readonly now: number;
  },
): GatewayVerdict {
  const account = one(headers, GATEWAY_HEADER.account);
  const time = one(headers, GATEWAY_HEADER.time);
  const mac = one(headers, GATEWAY_HEADER.mac);
  if (account === undefined && time === undefined && mac === undefined) return { ok: false, reason: 'ABSENT' };
  if (account === undefined || time === undefined || mac === undefined) return { ok: false, reason: GATEWAY_REFUSAL.INCOMPLETE };
  if (secret === null || secret.length !== GATEWAY_SECRET_BYTES) return { ok: false, reason: GATEWAY_REFUSAL.NOT_CONFIGURED };
  if (!isLoopback(request.peer)) return { ok: false, reason: GATEWAY_REFUSAL.NOT_LOOPBACK };
  if (account === null || time === null || mac === null) return { ok: false, reason: GATEWAY_REFUSAL.MALFORMED };
  if (!ACCOUNT_ID.test(account) || !/^\d{1,12}$/.test(time) || !/^[A-Za-z0-9_-]{43}$/.test(mac)) {
    return { ok: false, reason: GATEWAY_REFUSAL.MALFORMED };
  }
  if (Math.abs(request.now - Number(time)) > GATEWAY_MAX_SKEW_SECONDS) return { ok: false, reason: GATEWAY_REFUSAL.STALE };
  const expected = macOf(secret, request.method, request.path, account, time, request.contentDigest ?? '');
  const given = Buffer.from(mac, 'base64url');
  // Length first: timingSafeEqual throws on a mismatch, and a throw would be a 500 (scar #11).
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: GATEWAY_REFUSAL.BAD_MAC };
  return { ok: true, accountId: account };
}

/**
 * The shared secret, decoded: 32 bytes written as base64, base64url or 64 hex characters — the rule the
 * connector applies to `EVE_GATEWAY_SECRET` (`connector/src/config.ts:decodeKey`), so one value pasted
 * into both env files means one key. `deploy/provision-mcp.py` writes standard base64.
 */
export function decodeGatewaySecret(raw: string): { readonly ok: true; readonly secret: Buffer } | { readonly ok: false } {
  const text = raw.trim();
  if (text.length === 0) return { ok: false };
  const bytes = /^[0-9a-fA-F]{64}$/.test(text)
    ? Buffer.from(text, 'hex')
    : /^[A-Za-z0-9+/_-]+={0,2}$/.test(text)
      ? Buffer.from(text, 'base64')
      : null;
  if (bytes === null || bytes.length !== GATEWAY_SECRET_BYTES) return { ok: false };
  return { ok: true, secret: bytes };
}
