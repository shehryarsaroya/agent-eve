/**
 * The whole sign-in chain with a real MCP client's OAuth implementation (the official SDK's, the
 * same shape the hosts run): our 401 → our RFC 9728 metadata → the authorization server's RFC 8414
 * metadata → dynamic registration → authorize with PKCE S256 and `resource` → OUR consent page
 * logic → code → token exchange → the retried tool call verified by us; then an expired token,
 * which our 401 turns into a refresh, and the refresh token rotates.
 *
 * The authorization server is a stand-in for Supabase's (helpers/mock-supabase.ts); what is under
 * test is everything on our side of it.
 */

import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { getRequestListener } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runConsent } from '../public/oauth/consent-flow.mjs';
import { loadConfig } from '../src/config.js';
import { memoryLogger } from '../src/log.js';
import { createService, type Service } from '../src/service.js';
import { fakeIssuer } from './helpers/auth.js';
import { testEnv } from './helpers/config.js';
import { testDb, type TestDb } from './helpers/db.js';
import { FakeEngine } from './helpers/fake-engine.js';
import { payload } from './helpers/harness.js';
import { MockSupabase } from './helpers/mock-supabase.js';

const REDIRECT = 'http://localhost:53682/callback';

class MemoryProvider {
  client: OAuthClientInformationMixed | undefined;
  stored: OAuthTokens | undefined;
  verifier = '';
  authorizationUrl: URL | undefined;
  readonly refreshTokens: string[] = [];
  get redirectUrl() {
    return REDIRECT;
  }
  get clientMetadata() {
    return { client_name: 'Flow Test Host', redirect_uris: [REDIRECT], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };
  }
  clientInformation() {
    return this.client;
  }
  saveClientInformation(info: OAuthClientInformationMixed) {
    this.client = info;
  }
  tokens() {
    return this.stored;
  }
  saveTokens(tokens: OAuthTokens) {
    this.stored = tokens;
    if (tokens.refresh_token) this.refreshTokens.push(tokens.refresh_token);
  }
  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
  }
  saveCodeVerifier(verifier: string) {
    this.verifier = verifier;
  }
  codeVerifier() {
    return this.verifier;
  }
}

describe('signing in through the authorization server, as a host does', () => {
  let server: Server;
  let origin = '';
  let service: Service;
  let db: TestDb;
  let mock: MockSupabase;
  const account = randomUUID();

  beforeAll(async () => {
    let handle: Service['handle'] | null = null;
    server = createServer(getRequestListener((request, env) => (handle as Service['handle'])(request, { address: 'incoming' in env ? env.incoming.socket.remoteAddress : undefined }), { overrideGlobalObjects: false }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    origin = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`;
    const issuer = await fakeIssuer();
    mock = new MockSupabase(issuer, () => origin, () => `${origin}/mcp`, account);
    await mock.start();
    db = await testDb();
    const config = loadConfig({ ...testEnv(), EVE_MCP_PUBLIC_ORIGIN: origin, SUPABASE_URL: mock.origin, SUPABASE_ISSUER: '' });
    expect(config.issuer).toBe(mock.issuerUrl);
    service = createService({ config, db, keys: issuer.keys, engine: new FakeEngine(), logger: memoryLogger() });
    handle = service.handle;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await mock.stop();
    await db.close();
  });

  it('discovers, registers, consents, exchanges, calls, and refreshes with rotation', async () => {
    const provider = new MemoryProvider();
    const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), { authProvider: provider as unknown as OAuthClientProvider });
    const client = new Client({ name: 'claude-ai', version: '1.0.0' });
    await client.connect(transport); // initialize needs no account
    expect(payload(await client.callTool({ name: 'eve_status', arguments: {} }))['mcpError']).toBe(false);

    // An account tool: our 401 starts the host's sign-in.
    await expect(client.callTool({ name: 'eve_identity', arguments: {} })).rejects.toThrow(UnauthorizedError);
    const authorize = provider.authorizationUrl as URL;
    expect(authorize.origin + authorize.pathname).toBe(`${mock.issuerUrl}/oauth/authorize`);
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize.searchParams.get('resource')).toBe(`${origin}/mcp`);
    expect(authorize.searchParams.get('scope')).toBe('email');
    expect(mock.clients.size).toBe(1); // registered dynamically

    // The person's browser: Supabase sends it to our consent page...
    const hop = await fetch(authorize, { redirect: 'manual' });
    expect(hop.status).toBe(302);
    const consentUrl = hop.headers.get('location') as string;
    expect(consentUrl.startsWith(`${origin}/oauth/consent?authorization_id=`)).toBe(true);

    // ...where the page's logic signs them in (already), shows the consent and approves.
    const session = await mock.sessionToken();
    const asJson = async (response: Response) => (response.ok ? { data: await response.json(), error: null } : { data: null, error: { message: String(response.status) } });
    const supabase = {
      auth: {
        getSession: async () => ({ data: { session: { access_token: session } } }),
        signOut: async () => ({ error: null }),
        oauth: {
          getAuthorizationDetails: async (id: string) => asJson(await fetch(`${mock.issuerUrl}/oauth/authorizations/${id}`, { headers: { authorization: `Bearer ${session}` } })),
          approveAuthorization: async (id: string) => asJson(await fetch(`${mock.issuerUrl}/oauth/authorizations/${id}/consent`, { method: 'POST', headers: { authorization: `Bearer ${session}`, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'approve' }) })),
          denyAuthorization: async (id: string) => asJson(await fetch(`${mock.issuerUrl}/oauth/authorizations/${id}/consent`, { method: 'POST', headers: { authorization: `Bearer ${session}`, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'deny' }) })),
        },
      },
    };
    let shown: { clientName: string; handle: string | null; redirect: { host: string; loopback: boolean } } | undefined;
    let landed = '';
    await runConsent({
      supabase,
      location: { href: consentUrl },
      navigate: (url: string) => {
        landed = url;
      },
      fetchAccount: async (token: string) => (await fetch(`${origin}/account`, { headers: { authorization: `Bearer ${token}` } })).json(),
      ui: {
        consent: (details: { allow(): Promise<void> } & NonNullable<typeof shown>) => {
          shown = details;
          return details.allow();
        },
        error: (message: string) => {
          throw new Error(`consent page error: ${message}`);
        },
        signIn: () => {
          throw new Error('should already be signed in');
        },
      },
      config: { knownRedirectHosts: ['claude.ai'] },
    });
    expect(shown).toMatchObject({ clientName: 'Flow Test Host', handle: null, redirect: { host: 'localhost', loopback: true } });
    const code = new URL(landed).searchParams.get('code');
    expect(code).toBeTruthy();

    // The host exchanges the code. Make the first access token already expired, so the first call
    // proves that our 401 on an expired token sends the host to refresh.
    mock.nextAccessTokenLifetime = -120;
    await transport.finishAuth(code as string);
    const identity = payload(await client.callTool({ name: 'eve_identity', arguments: {} }));
    expect(identity).toMatchObject({ enrolled: false, signer: 'hosted', mcpError: false });
    expect(mock.grants).toEqual(['authorization_code', 'refresh_token']);
    expect(new Set(provider.refreshTokens).size).toBe(2);

    // The rotated-out refresh token no longer works.
    const reused = await fetch(`${mock.issuerUrl}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: provider.refreshTokens[0] as string, client_id: String(provider.client?.client_id) }) });
    expect(reused.status).toBe(400);

    // And the account plays: its token names the account Supabase signed in.
    expect(payload(await client.callTool({ name: 'eve_enroll', arguments: { handle: 'flow-player' } }))).toMatchObject({ httpStatus: 201, mcpError: false });
    const page = await (await fetch(`${origin}/account`, { headers: { authorization: `Bearer ${session}` } })).json();
    expect(page).toMatchObject({ handle: 'flow-player', enrolled: true });
    await client.close();
  });
});
