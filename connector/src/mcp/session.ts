/**
 * A self-contained, signed `Mcp-Session-Id`.
 *
 * This server is stateless — every request gets a fresh MCP server instance, and a restart loses
 * nothing — but it needs one fact across requests: WHICH host is calling, because the two hosts
 * want an unauthenticated call to a sign-in tool answered differently (Claude: HTTP 401; ChatGPT:
 * a tool error carrying `_meta["mcp/www_authenticate"]`). The host names itself once, in
 * `initialize`'s `clientInfo`. So the session id IS that fact, MAC'd: the client echoes it on every
 * later request (Streamable HTTP requires it to), and verifying it needs no storage.
 *
 * It authorises nothing. A forged or stale id only changes which form a sign-in prompt takes.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SessionFacts {
  /** `clientInfo.name` from initialize, truncated. */
  readonly client: string;
  /** The protocol version the client asked for. */
  readonly protocol: string;
}

const PREFIX = 's1';

function mac(secret: Buffer, payload: string): string {
  return createHmac('sha256', secret).update(`agenteve-mcp/session/v1|${payload}`).digest('base64url').slice(0, 22);
}

export function mintSessionId(secret: Buffer, facts: SessionFacts, issuedAt: number): string {
  const payload = Buffer.from(
    JSON.stringify({ c: facts.client.replace(/[^\x20-\x7e]/g, '').slice(0, 64), p: facts.protocol.slice(0, 16), t: Math.floor(issuedAt) }),
    'utf8',
  ).toString('base64url');
  return `${PREFIX}.${payload}.${mac(secret, payload)}`;
}

export function readSessionId(secret: Buffer, value: string | null): SessionFacts | null {
  if (value === null || value.length > 512) return null;
  const parts = value.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  const payload = parts[1] as string;
  const expected = Buffer.from(mac(secret, payload));
  const given = Buffer.from(parts[2] as string);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { c?: unknown; p?: unknown };
    if (typeof decoded.c !== 'string' || typeof decoded.p !== 'string') return null;
    return { client: decoded.c, protocol: decoded.p };
  } catch {
    return null;
  }
}
