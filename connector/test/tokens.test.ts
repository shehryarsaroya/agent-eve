import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { bearerToken, remoteKeys, TokenError, TokenVerifier } from '../src/auth/tokens.js';
import { fakeIssuer, serveJwks, TEST_ISSUER, TEST_RESOURCE } from './helpers/auth.js';

describe('Supabase access tokens', async () => {
  const issuer = await fakeIssuer();
  const verifier = new TokenVerifier({ issuer: TEST_ISSUER, audiences: [TEST_RESOURCE], keys: issuer.keys });

  it('accepts a connector token bound to this resource, naming the account and client', async () => {
    const sub = randomUUID();
    const clientId = randomUUID();
    const principal = await verifier.verifyMcpToken(await issuer.mcpToken({ sub, clientId }));
    expect(principal.accountId).toBe(sub);
    expect(principal.clientId).toBe(clientId);
    expect(principal.expiresAt).toBeGreaterThan(Date.now() / 1000);
  });

  it('refuses a token for another audience, another issuer, or past its expiry', async () => {
    await expect(verifier.verifyMcpToken(await issuer.mcpToken({ aud: 'https://elsewhere.example/mcp' }))).rejects.toThrow(TokenError);
    await expect(verifier.verifyMcpToken(await issuer.mcpToken({ aud: 'authenticated' }))).rejects.toThrow(TokenError);
    await expect(verifier.verifyMcpToken(await issuer.mcpToken({ iss: 'https://evil.supabase.co/auth/v1' }))).rejects.toThrow(TokenError);
    await expect(verifier.verifyMcpToken(await issuer.mcpToken({ expiresIn: -120 }))).rejects.toThrow(/expired/);
  });

  it('accepts Supabase\'s default audience only when configured to (before the audience hook is live)', async () => {
    const lenient = new TokenVerifier({ issuer: TEST_ISSUER, audiences: [TEST_RESOURCE, 'authenticated'], keys: issuer.keys });
    await expect(lenient.verifyMcpToken(await issuer.mcpToken({ aud: 'authenticated' }))).resolves.toBeTruthy();
  });

  it('tells connector tokens from sign-in sessions by client_id', async () => {
    await expect(verifier.verifyMcpToken(await issuer.mcpToken({ clientId: null }))).rejects.toThrow(/session token/);
    const session = await issuer.sessionToken();
    await expect(verifier.verifyMcpToken(session)).rejects.toThrow(TokenError);
    await expect(verifier.verifySessionToken(session)).resolves.toMatchObject({ accountId: expect.any(String) });
    // A connector token (default audience, pre-hook) is not a session.
    await expect(verifier.verifySessionToken(await issuer.mcpToken({ aud: 'authenticated' }))).rejects.toThrow(/not accepted here/);
  });

  it('refuses anonymous sign-ins, non-UUID subjects and symmetric (HS256) tokens', async () => {
    await expect(verifier.verifyMcpToken(await issuer.mcpToken({ extra: { is_anonymous: true } }))).rejects.toThrow(TokenError);
    await expect(verifier.verifyMcpToken(await issuer.mcpToken({ sub: 'p:vale' }))).rejects.toThrow(TokenError);
    const hs = await new SignJWT({ sub: randomUUID(), role: 'authenticated', client_id: 'x' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(TEST_ISSUER)
      .setAudience(TEST_RESOURCE)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('a-shared-secret-of-sufficient-length!!'));
    await expect(verifier.verifyMcpToken(hs)).rejects.toThrow(TokenError);
    await expect(verifier.verifyMcpToken('not.a.jwt!')).rejects.toThrow(/malformed/);
  });

  it('verifies against a remote JWKS, as production does', async () => {
    const jwks = await serveJwks(issuer.jwks);
    try {
      const remote = new TokenVerifier({ issuer: TEST_ISSUER, audiences: [TEST_RESOURCE], keys: remoteKeys(jwks.url) });
      await expect(remote.verifyMcpToken(await issuer.mcpToken())).resolves.toBeTruthy();
    } finally {
      await jwks.close();
    }
  });

  it('parses the Authorization header strictly', () => {
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(() => bearerToken('Basic dXNlcjpwYXNz')).toThrow(TokenError);
  });
});
