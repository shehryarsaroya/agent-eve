/**
 * Supabase-issued access tokens, verified locally against the project's JWKS.
 *
 * Two kinds reach this service, and they are told apart by the `client_id` claim Supabase's
 * OAuth 2.1 server adds to every token it issues to an OAuth client:
 *
 *  - **MCP access tokens** (from ChatGPT or Claude, via the OAuth flow): MUST carry `client_id`,
 *    and MUST name this resource as their audience. Supabase does not put RFC 8707's `resource`
 *    into `aud` (its tokens say `aud: "authenticated"`), so the deploy installs a Custom Access
 *    Token Hook that stamps `aud` = this resource on every token that has a `client_id`. Until
 *    that hook is live, `EVE_MCP_TOKEN_AUDIENCES` can list `authenticated` too — a weaker check,
 *    acceptable only because the Supabase project serves this one resource and nothing else.
 *  - **Session tokens** (from the consent page, the person's own sign-in): MUST NOT carry
 *    `client_id`, and carry Supabase's default audience `authenticated`. Only `/account` takes them.
 *
 * Only asymmetric algorithms are accepted: the legacy shared-secret HS256 tokens are refused,
 * because this service holds no Supabase secret and must never need one.
 */

import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';

export const ACCEPTED_ALGORITHMS = ['ES256', 'RS256', 'EdDSA'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface McpPrincipal {
  /** Supabase user id (`sub`): the account. */
  readonly accountId: string;
  /** The OAuth client the token was issued to (the host's registration). */
  readonly clientId: string;
  readonly scopes: readonly string[];
  /** Seconds since the epoch. */
  readonly expiresAt: number;
}

export interface SessionUser {
  readonly accountId: string;
  /** The signed-in email, when the token carries one: the cross-device handoff matches on it. */
  readonly email: string | null;
}

export class TokenError extends Error {
  constructor(readonly code: 'invalid_token' | 'wrong_kind', message: string) {
    super(message);
  }
}

export interface TokenVerifierOptions {
  readonly issuer: string;
  readonly audiences: readonly string[];
  /** Production: the project's JWKS URL. Tests: a local key set. */
  readonly keys: JWTVerifyGetKey;
  /** Clock skew tolerated on exp/nbf/iat, seconds. */
  readonly clockToleranceSeconds?: number;
}

export function remoteKeys(jwksUrl: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(jwksUrl), { cooldownDuration: 30_000, cacheMaxAge: 600_000, timeoutDuration: 5_000 });
}

export class TokenVerifier {
  readonly #options: TokenVerifierOptions;

  constructor(options: TokenVerifierOptions) {
    this.#options = options;
  }

  async #verify(token: string, audiences: readonly string[]): Promise<JWTPayload> {
    if (token.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
      throw new TokenError('invalid_token', 'The access token is malformed.');
    }
    try {
      const { payload } = await jwtVerify(token, this.#options.keys, {
        issuer: this.#options.issuer,
        audience: [...audiences],
        algorithms: [...ACCEPTED_ALGORITHMS],
        clockTolerance: this.#options.clockToleranceSeconds ?? 30,
        requiredClaims: ['sub', 'exp', 'iat'],
      });
      if (typeof payload.sub !== 'string' || !UUID.test(payload.sub)) throw new TokenError('invalid_token', 'The access token has no account.');
      if (payload['role'] !== 'authenticated' || payload['is_anonymous'] === true) {
        throw new TokenError('invalid_token', 'The access token is not for a signed-in account.');
      }
      return payload;
    } catch (error) {
      if (error instanceof TokenError) throw error;
      if (error instanceof joseErrors.JWTExpired) throw new TokenError('invalid_token', 'The access token has expired.');
      if (error instanceof joseErrors.JOSEError) throw new TokenError('invalid_token', 'The access token is invalid.');
      throw new TokenError('invalid_token', 'The access token could not be verified.');
    }
  }

  /** A token an MCP host presents. */
  async verifyMcpToken(token: string): Promise<McpPrincipal> {
    const payload = await this.#verify(token, this.#options.audiences);
    const clientId = payload['client_id'];
    if (typeof clientId !== 'string' || clientId.length === 0 || clientId.length > 200) {
      throw new TokenError('wrong_kind', 'This is a sign-in session token, not a connector access token.');
    }
    const scope = typeof payload['scope'] === 'string' ? payload['scope'] : '';
    return {
      accountId: payload.sub as string,
      clientId,
      scopes: scope.split(' ').filter((s) => s.length > 0),
      expiresAt: payload.exp as number,
    };
  }

  /** The person's own sign-in, from the consent page. */
  async verifySessionToken(token: string): Promise<SessionUser> {
    const payload = await this.#verify(token, ['authenticated']);
    if (payload['client_id'] !== undefined && payload['client_id'] !== null) {
      throw new TokenError('wrong_kind', 'Connector access tokens are not accepted here.');
    }
    return { accountId: payload.sub as string, email: typeof payload['email'] === 'string' ? payload['email'] : null };
  }
}

/** `Authorization: Bearer <token>`, or null when absent. Throws on a malformed header. */
export function bearerToken(header: string | null): string | null {
  if (header === null || header.trim() === '') return null;
  const match = /^Bearer\s+([^\s]+)\s*$/i.exec(header);
  if (!match) throw new TokenError('invalid_token', 'The Authorization header must be a Bearer token.');
  return match[1] as string;
}
