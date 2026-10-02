/**
 * A stand-in for the Supabase project's token issuance: an ES256 key, its JWKS, and a minter for
 * the two kinds of token the service sees (OAuth-client access tokens and sign-in sessions).
 */

import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK, type JWTVerifyGetKey } from 'jose';

export const TEST_ISSUER = 'https://test-project.supabase.co/auth/v1';
export const TEST_RESOURCE = 'https://mcp.test.example/mcp';

export interface FakeIssuer {
  readonly jwks: { keys: JWK[] };
  readonly keys: JWTVerifyGetKey;
  /** An access token as Supabase's OAuth server issues it to an MCP host (with the aud hook). */
  mcpToken(options?: { sub?: string; clientId?: string | null; aud?: string; iss?: string; expiresIn?: number; extra?: Record<string, unknown> }): Promise<string>;
  /** The person's own sign-in session (consent page). */
  sessionToken(options?: { sub?: string }): Promise<string>;
}

export async function fakeIssuer(): Promise<FakeIssuer> {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const kid = randomUUID();
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };
  const jwks = { keys: [jwk] };
  async function sign(claims: Record<string, unknown>, iss: string, aud: string, expiresIn: number): Promise<string> {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256', kid, typ: 'JWT' })
      .setIssuer(iss)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + expiresIn)
      .sign(privateKey);
  }
  return {
    jwks,
    keys: createLocalJWKSet(jwks),
    mcpToken: (options = {}) =>
      sign(
        {
          sub: options.sub ?? randomUUID(),
          role: 'authenticated',
          aal: 'aal1',
          session_id: randomUUID(),
          email: 'player@example.com',
          is_anonymous: false,
          ...(options.clientId === null ? {} : { client_id: options.clientId ?? randomUUID() }),
          ...(options.extra ?? {}),
        },
        options.iss ?? TEST_ISSUER,
        options.aud ?? TEST_RESOURCE,
        options.expiresIn ?? 3600,
      ),
    sessionToken: (options = {}) =>
      sign({ sub: options.sub ?? randomUUID(), role: 'authenticated', aal: 'aal1', session_id: randomUUID(), email: 'player@example.com', is_anonymous: false }, TEST_ISSUER, 'authenticated', 3600),
  };
}

/** Serves the JWKS over HTTP, at the path Supabase uses, for tests of the remote key set. */
export async function serveJwks(jwks: { keys: JWK[] }): Promise<{ readonly url: string; close(): Promise<void> }> {
  const server: Server = createServer((req, res) => {
    if (req.url === '/auth/v1/.well-known/jwks.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(jwks));
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/auth/v1/.well-known/jwks.json`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
