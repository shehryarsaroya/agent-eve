/**
 * RFC 9728 protected resource metadata, and the RFC 6750 challenges that point hosts at it.
 *
 * Discovery, as both hosts run it: a `401` with `WWW-Authenticate: Bearer resource_metadata=…`
 * → this document → `authorization_servers[0]` (the Supabase project's issuer) → RFC 8414
 * metadata at `<origin>/.well-known/oauth-authorization-server/auth/v1` → dynamic client
 * registration → authorization code + PKCE (S256) → tokens. Claude uses only the FIRST listed
 * authorization server, so exactly one is listed.
 */

import type { Config } from '../config.js';

export const AUTH_REQUIRED_DESCRIPTION = 'Sign in to Agent Eve to use this tool';

export function resourceMetadataUrl(config: Pick<Config, 'publicOrigin'>): string {
  return `${config.publicOrigin}/.well-known/oauth-protected-resource/mcp`;
}

export function protectedResourceMetadata(config: Config): Record<string, unknown> {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: [...config.scopes],
    resource_name: 'Agent Eve',
    ...(config.docsUrl === null ? {} : { resource_documentation: config.docsUrl }),
    ...(config.policyUrl === null ? {} : { resource_policy_uri: config.policyUrl }),
    ...(config.termsUrl === null ? {} : { resource_tos_uri: config.termsUrl }),
  };
}

function quoted(value: string): string {
  return `"${value.replace(/[\\"]/g, '').replace(/[\r\n]/g, ' ')}"`;
}

/**
 * The `WWW-Authenticate` value for a 401: no token for a tool that needs one, or a bad token.
 *
 * For the no-token case RFC 6750 §3.1 says a server SHOULD NOT include an error code. This sends
 * `error="invalid_token"` anyway, because Claude's lazy-authentication guide specifies exactly this
 * header for exactly this case, and the MCP SDK's client reads it either way.
 */
export function bearerChallenge(config: Config, error: { readonly code: 'invalid_token' | 'insufficient_scope'; readonly description: string }): string {
  const parts = [
    `error=${quoted(error.code)}`,
    `error_description=${quoted(error.description)}`,
    `resource_metadata=${quoted(resourceMetadataUrl(config))}`,
  ];
  if (config.scopes.length > 0) parts.push(`scope=${quoted(config.scopes.join(' '))}`);
  return `Bearer ${parts.join(', ')}`;
}

/**
 * ChatGPT's in-band form of the same challenge: a tool error whose `_meta` carries the
 * `WWW-Authenticate` value, which (with the tool's `securitySchemes`) shows its sign-in prompt.
 * Used only for clients that announce themselves as ChatGPT; everyone else gets the HTTP 401
 * the MCP authorization spec and Claude's lazy authentication require.
 */
export function inbandAuthResult(config: Config): Record<string, unknown> {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ error: `${AUTH_REQUIRED_DESCRIPTION}. Connect your Agent Eve account, then try again.` }) }],
    _meta: {
      'mcp/www_authenticate': [bearerChallenge(config, { code: 'insufficient_scope', description: AUTH_REQUIRED_DESCRIPTION })],
    },
  };
}
