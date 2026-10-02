/**
 * A stand-in for Supabase Auth's OAuth 2.1 server — the subset an MCP host touches, shaped as read
 * from supabase/auth `internal/api/oauthserver` (2026-10-02): RFC 8414 metadata at the
 * path-inserted URL, dynamic registration (UUID client ids, exact redirect matching), authorize →
 * 302 to Site URL + /oauth/consent?authorization_id=…, the two consent endpoints supabase-js calls,
 * and the token endpoint (PKCE, refresh rotation). Its access tokens carry `client_id` and, as the
 * deploy's hook makes them, `aud` = the resource.
 *
 * It exists to prove OUR half against a real MCP client: discovery from our 401 and our metadata,
 * the consent page's logic, and our verification of what comes back.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { FakeIssuer } from './auth.js';

interface Authorization {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string | null;
  readonly challenge: string;
  readonly method: string;
  readonly resource: string | null;
  readonly scope: string;
  userId?: string;
  code?: string;
}

export class MockSupabase {
  readonly clients = new Map<string, { redirectUris: string[]; name: string }>();
  readonly authorizations = new Map<string, Authorization>();
  readonly refreshTokens = new Map<string, { userId: string; clientId: string }>();
  readonly grants: string[] = [];
  /** Lifetime of the next access token issued, seconds; negative issues an expired one. */
  nextAccessTokenLifetime = 3600;
  origin = '';
  #server: Server | null = null;

  constructor(
    private readonly issuer: FakeIssuer,
    private readonly siteUrl: () => string,
    private readonly resource: () => string,
    private readonly userId: string,
  ) {}

  get issuerUrl(): string {
    return `${this.origin}/auth/v1`;
  }

  async start(): Promise<void> {
    this.#server = createServer((req, res) => void this.#route(req, res));
    await new Promise<void>((resolve) => this.#server?.listen(0, '127.0.0.1', resolve));
    const address = this.#server.address();
    this.origin = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.#server?.close(() => resolve()));
  }

  async #body(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  }

  #json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  async #route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.origin);
    const path = url.pathname;
    if (req.method === 'GET' && path === '/.well-known/oauth-authorization-server/auth/v1') {
      return this.#json(res, 200, {
        issuer: this.issuerUrl,
        authorization_endpoint: `${this.issuerUrl}/oauth/authorize`,
        token_endpoint: `${this.issuerUrl}/oauth/token`,
        jwks_uri: `${this.issuerUrl}/.well-known/jwks.json`,
        userinfo_endpoint: `${this.issuerUrl}/oauth/userinfo`,
        registration_endpoint: `${this.issuerUrl}/oauth/clients/register`,
        response_types_supported: ['code'],
        response_modes_supported: ['query'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
        code_challenge_methods_supported: ['S256', 'plain'],
        scopes_supported: ['openid', 'email', 'profile', 'phone'],
      });
    }
    if (req.method === 'POST' && path === '/auth/v1/oauth/clients/register') {
      const meta = JSON.parse(await this.#body(req)) as { redirect_uris?: string[]; client_name?: string };
      const uris = meta.redirect_uris ?? [];
      if (uris.length === 0 || uris.some((u) => new URL(u).protocol === 'http:' && !['localhost', '127.0.0.1', '::1'].includes(new URL(u).hostname))) {
        return this.#json(res, 400, { error: 'invalid_client_metadata' });
      }
      const clientId = randomUUID();
      this.clients.set(clientId, { redirectUris: uris, name: meta.client_name ?? '' });
      return this.#json(res, 201, { client_id: clientId, client_type: 'public', redirect_uris: uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_name: meta.client_name });
    }
    if (req.method === 'GET' && path === '/auth/v1/oauth/authorize') {
      const p = url.searchParams;
      const client = this.clients.get(p.get('client_id') ?? '');
      if (!client || !client.redirectUris.includes(p.get('redirect_uri') ?? '')) return this.#json(res, 400, { error: 'invalid redirect_uri' });
      const scope = p.get('scope') || 'email';
      if (scope.split(' ').some((s) => !['openid', 'email', 'profile', 'phone'].includes(s))) return this.#json(res, 400, { error: `unsupported scope: ${scope}` });
      const challenge = p.get('code_challenge') ?? '';
      if (challenge.length < 43 || !['s256', 'plain'].includes((p.get('code_challenge_method') ?? '').toLowerCase())) return this.#json(res, 400, { error: 'PKCE required' });
      const id = randomUUID();
      this.authorizations.set(id, { clientId: p.get('client_id') as string, redirectUri: p.get('redirect_uri') as string, state: p.get('state'), challenge, method: (p.get('code_challenge_method') as string).toLowerCase(), resource: p.get('resource'), scope });
      res.writeHead(302, { location: `${this.siteUrl()}/oauth/consent?authorization_id=${id}` });
      return void res.end();
    }
    const detail = /^\/auth\/v1\/oauth\/authorizations\/([^/]+)(\/consent)?$/.exec(path);
    if (detail) {
      if (!/^Bearer \S+$/.test(String(req.headers.authorization ?? ''))) return this.#json(res, 403, { error: 'authentication required' });
      const authorization = this.authorizations.get(detail[1] as string);
      if (!authorization) return this.#json(res, 404, { error: 'authorization not found' });
      if (req.method === 'GET' && detail[2] === undefined) {
        authorization.userId = this.userId;
        const client = this.clients.get(authorization.clientId);
        return this.#json(res, 200, { authorization_id: detail[1], redirect_uri: authorization.redirectUri, client: { id: authorization.clientId, name: client?.name ?? '' }, user: { id: this.userId, email: 'player@example.com' }, scope: authorization.scope });
      }
      if (req.method === 'POST' && detail[2] === '/consent') {
        const action = (JSON.parse(await this.#body(req)) as { action?: string }).action;
        const target = new URL(authorization.redirectUri);
        if (action === 'approve') {
          authorization.code = randomBytes(16).toString('hex');
          target.searchParams.set('code', authorization.code);
        } else {
          target.searchParams.set('error', 'access_denied');
        }
        if (authorization.state) target.searchParams.set('state', authorization.state);
        return this.#json(res, 200, { redirect_url: target.href });
      }
    }
    if (req.method === 'POST' && path === '/auth/v1/oauth/token') {
      const form = new URLSearchParams(await this.#body(req));
      const grant = form.get('grant_type') ?? '';
      this.grants.push(grant);
      if (grant === 'authorization_code') {
        const entry = [...this.authorizations.entries()].find(([, a]) => a.code !== undefined && a.code === form.get('code'));
        if (!entry) return this.#json(res, 400, { error: 'invalid_grant' });
        const [id, authorization] = entry;
        const verifier = form.get('code_verifier') ?? '';
        const derived = authorization.method === 's256' ? createHash('sha256').update(verifier).digest('base64url') : verifier;
        if (derived !== authorization.challenge || form.get('redirect_uri') !== authorization.redirectUri || form.get('client_id') !== authorization.clientId) {
          return this.#json(res, 400, { error: 'invalid_grant' });
        }
        this.authorizations.delete(id);
        return this.#issue(res, authorization.userId ?? this.userId, authorization.clientId);
      }
      if (grant === 'refresh_token') {
        const old = form.get('refresh_token') ?? '';
        const holder = this.refreshTokens.get(old);
        if (!holder) return this.#json(res, 400, { error: 'invalid_grant' });
        this.refreshTokens.delete(old); // rotation: a refresh token works once
        return this.#issue(res, holder.userId, holder.clientId);
      }
      return this.#json(res, 400, { error: 'unsupported_grant_type' });
    }
    this.#json(res, 404, { error: 'not found' });
  }

  async #issue(res: ServerResponse, userId: string, clientId: string): Promise<void> {
    const lifetime = this.nextAccessTokenLifetime;
    this.nextAccessTokenLifetime = 3600;
    const access = await this.issuer.mcpToken({ sub: userId, clientId, iss: this.issuerUrl, aud: this.resource(), expiresIn: lifetime });
    const refresh = randomBytes(24).toString('base64url');
    this.refreshTokens.set(refresh, { userId, clientId });
    this.#json(res, 200, { access_token: access, token_type: 'bearer', expires_in: Math.max(lifetime, 0), refresh_token: refresh });
  }

  /** A sign-in session as supabase-js would hold it on the consent page. */
  sessionToken(): Promise<string> {
    return this.issuer.sessionToken({ sub: this.userId, iss: this.issuerUrl });
  }
}
