/**
 * The HTTP surface, as a web-standard `(Request) => Response` handler (served on node:http by
 * `main.ts`, called directly by the tests).
 *
 *   POST /mcp                                     MCP Streamable HTTP, stateless, JSON responses
 *   GET|DELETE /mcp                               405: no server-initiated stream, no sessions to end
 *   GET /.well-known/oauth-protected-resource[/mcp]   RFC 9728 metadata
 *   GET /account                                  the consent page's "which agent is this account's?"
 *   GET /healthz                                  loopback health for the operator
 *
 * ── LAZY AUTHENTICATION ────────────────────────────────────────────────────────────────────
 * Spectator tools work signed out, so `initialize`, `tools/list` and their calls pass without a
 * token. A `tools/call` for an account tool with NO token is answered, before the SDK runs, with
 * HTTP 401 and `WWW-Authenticate: Bearer … resource_metadata="…"` — the one signal Claude starts
 * sign-in on (a 200 carrying a tool error does not). A request with an INVALID token is a 401
 * whatever it asks for, as the MCP authorization spec requires. ChatGPT documents an in-band form
 * instead (a tool error with `_meta["mcp/www_authenticate"]`), so a client whose initialize named
 * it ChatGPT gets that form; see `mcp/session.ts` for how the name survives a stateless server.
 */

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { AUTH_REQUIRED_DESCRIPTION, bearerChallenge, protectedResourceMetadata } from './auth/challenge.js';
import { bearerToken, TokenError, type McpPrincipal, type TokenVerifier } from './auth/tokens.js';
import type { Config } from './config.js';
import { isLoopback } from './engine/gateway.js';
import { describeError } from './log.js';
import { buildServer, toolDescriptor } from './mcp/server.js';
import { mintSessionId, readSessionId, type SessionFacts } from './mcp/session.js';
import { healthFrom, type ToolDefinition, type ToolDeps } from './mcp/tools.js';

export const MAX_MCP_BODY_BYTES = 256 * 1024;

export interface HttpDeps extends ToolDeps {
  readonly tokens: TokenVerifier;
  readonly tools: readonly ToolDefinition[];
  /** HMAC key for the self-contained session id. */
  readonly sessionSecret: Buffer;
}

export interface Peer {
  /** The TCP peer: nginx in production (loopback). */
  readonly address?: string | undefined;
}

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'access-control-expose-headers': 'Mcp-Session-Id, WWW-Authenticate',
  'access-control-max-age': '86400',
};

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers },
  });
}

function withHeaders(response: Response, headers: Record<string, string>): Response {
  const merged = new Headers(response.headers);
  for (const [name, value] of Object.entries(headers)) merged.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: merged });
}

function jsonRpcError(status: number, code: number, message: string): Response {
  return json(status, { jsonrpc: '2.0', error: { code, message }, id: null }, CORS_HEADERS);
}

type Message = { readonly method?: unknown; readonly params?: unknown };

function messages(body: unknown): Message[] {
  const list = Array.isArray(body) ? body : [body];
  return list.filter((m): m is Message => typeof m === 'object' && m !== null);
}

function initializeFacts(body: unknown): SessionFacts | null {
  for (const message of messages(body)) {
    if (message.method !== 'initialize' || typeof message.params !== 'object' || message.params === null) continue;
    const params = message.params as { clientInfo?: { name?: unknown }; protocolVersion?: unknown };
    return {
      client: typeof params.clientInfo?.name === 'string' ? params.clientInfo.name : '',
      protocol: typeof params.protocolVersion === 'string' ? params.protocolVersion : '',
    };
  }
  return null;
}

function callsAccountTool(body: unknown, accountTools: ReadonlySet<string>): string | null {
  for (const message of messages(body)) {
    if (message.method !== 'tools/call' || typeof message.params !== 'object' || message.params === null) continue;
    const name = (message.params as { name?: unknown }).name;
    if (typeof name === 'string' && accountTools.has(name)) return name;
  }
  return null;
}

function toolNames(body: unknown): string {
  return messages(body)
    .map((m) => (m.method === 'tools/call' && typeof m.params === 'object' && m.params !== null ? `tools/call:${String((m.params as { name?: unknown }).name)}` : String(m.method)))
    .join(',')
    .slice(0, 200);
}

async function readCapped(request: Request, cap: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > cap) return null;
  if (request.body === null) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createHandler(deps: HttpDeps): (request: Request, peer?: Peer) => Promise<Response> {
  const { config, logger } = deps;
  const descriptors: Tool[] = deps.tools.map(toolDescriptor);
  const accountTools = new Set(deps.tools.filter((t) => t.needsAccount).map((t) => t.name));
  const allowedOrigins = new Set(config.allowedOrigins);

  function callerKey(request: Request, peer: Peer): string {
    const forwarded = request.headers.get('x-real-ip');
    if (config.trustProxy && forwarded !== null && isLoopback(peer.address) && /^[0-9a-fA-F.:]{2,45}$/.test(forwarded)) return forwarded;
    return peer.address ?? 'unknown';
  }

  /**
   * Browser origins only (DNS-rebinding defence; hosts call server to server and send none).
   * `*` allows any origin; `http://localhost` allows a local inspector on any port.
   */
  function originAllowed(request: Request): boolean {
    const origin = request.headers.get('origin');
    if (origin === null) return true;
    if (allowedOrigins.has('*') || allowedOrigins.has(origin)) return true;
    if (!allowedOrigins.has('http://localhost')) return false;
    try {
      const url = new URL(origin);
      return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    } catch {
      return false;
    }
  }

  function unauthorized(description: string): Response {
    return json(401, { error: 'invalid_token', error_description: description }, {
      ...CORS_HEADERS,
      'www-authenticate': bearerChallenge(config, { code: 'invalid_token', description }),
    });
  }

  async function mcp(request: Request, peer: Peer, note: { detail: string }): Promise<Response> {
    if (request.method === 'GET' || request.method === 'DELETE') {
      return withHeaders(jsonRpcError(405, -32000, 'Method not allowed: this server is stateless and opens no server-initiated stream.'), { allow: 'POST' });
    }
    if (request.method !== 'POST') return withHeaders(jsonRpcError(405, -32000, 'Method not allowed.'), { allow: 'POST' });
    if (!originAllowed(request)) return jsonRpcError(403, -32000, 'Origin not allowed.');

    const raw = await readCapped(request, MAX_MCP_BODY_BYTES);
    if (raw === null) return jsonRpcError(413, -32000, `Request body exceeds ${MAX_MCP_BODY_BYTES} bytes.`);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return jsonRpcError(400, -32700, 'Parse error: invalid JSON.');
    }
    note.detail = toolNames(body);

    let auth: McpPrincipal | null = null;
    try {
      const token = bearerToken(request.headers.get('authorization'));
      if (token !== null) auth = await deps.tokens.verifyMcpToken(token);
    } catch (error) {
      if (error instanceof TokenError) return unauthorized(error.message);
      throw error;
    }

    const initialize = initializeFacts(body);
    const facts = initialize ?? readSessionId(deps.sessionSecret, request.headers.get('mcp-session-id'));
    const inband = facts !== null && facts.client !== '' && config.inbandAuthClients.test(facts.client);

    if (auth === null && !inband) {
      const tool = callsAccountTool(body, accountTools);
      if (tool !== null) {
        logger.info('mcp.challenge', { tool });
        return unauthorized(AUTH_REQUIRED_DESCRIPTION);
      }
    }
    if (auth !== null) await deps.store.touchAccount(auth.accountId);

    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const server = buildServer(config, deps, deps.tools, descriptors, { auth, inband, callerKey: callerKey(request, peer) });
    try {
      await server.connect(transport);
      let response = await transport.handleRequest(request, { parsedBody: body });
      if (initialize !== null && response.status === 200) {
        response = withHeaders(response, { 'mcp-session-id': mintSessionId(deps.sessionSecret, initialize, deps.now() / 1000) });
      }
      // The SDK built the body already (JSON response mode); materialise it before closing.
      const payload = await response.arrayBuffer();
      const headers = new Headers(response.headers);
      for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
      headers.set('cache-control', 'no-store');
      return new Response(response.status === 202 || response.status === 204 ? null : payload, { status: response.status, headers });
    } finally {
      await server.close().catch(() => undefined);
    }
  }

  async function account(request: Request): Promise<Response> {
    try {
      const token = bearerToken(request.headers.get('authorization'));
      if (token === null) return json(401, { error: 'sign_in_required' });
      const user = await deps.tokens.verifySessionToken(token);
      const principal = await deps.store.principal(user.accountId);
      return json(200, {
        signedIn: true,
        handle: principal?.handle ?? null,
        principalId: principal?.principalId ?? null,
        enrolled: principal?.enrolled ?? false,
        signer: 'hosted',
      });
    } catch (error) {
      if (error instanceof TokenError) return json(401, { error: 'invalid_token' });
      throw error;
    }
  }

  async function healthz(peer: Peer): Promise<Response> {
    if (!isLoopback(peer.address)) return json(404, { error: 'not_found' });
    let db = false;
    try {
      await deps.store.ping();
      db = true;
    } catch {
      db = false;
    }
    let engine: number | null = null;
    try {
      engine = (await healthFrom(deps.cache, deps.engine)).httpStatus;
    } catch {
      engine = null;
    }
    return json(db ? 200 : 503, { ok: db, db, engine });
  }

  return async (request: Request, peer: Peer = {}): Promise<Response> => {
    const started = deps.now();
    const url = new URL(request.url);
    let response: Response;
    const note = { detail: '' };
    try {
      if (request.method === 'OPTIONS') {
        response = new Response(null, { status: 204, headers: CORS_HEADERS });
      } else if (url.pathname === '/mcp') {
        response = await mcp(request, peer, note);
      } else if (url.pathname === '/.well-known/oauth-protected-resource' || url.pathname === '/.well-known/oauth-protected-resource/mcp') {
        response = request.method === 'GET' || request.method === 'HEAD'
          ? json(200, protectedResourceMetadata(config), { ...CORS_HEADERS, 'cache-control': 'public, max-age=300' })
          : json(405, { error: 'method_not_allowed' }, { allow: 'GET' });
      } else if (url.pathname === '/account' && request.method === 'GET') {
        response = await account(request);
      } else if (url.pathname === '/healthz' && request.method === 'GET') {
        response = await healthz(peer);
      } else {
        response = json(404, { error: 'not_found' });
      }
    } catch (error) {
      logger.error('http.failed', { path: url.pathname, error: describeError(error, deps.secrets()) });
      response = json(500, { error: 'internal_error' });
    }
    logger.info('http', { method: request.method, path: url.pathname, status: response.status, ms: Math.round(deps.now() - started), detail: note.detail });
    return response;
  };
}
