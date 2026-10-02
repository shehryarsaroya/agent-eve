/**
 * Ed25519 agent keys, generated server-side for hosted players.
 *
 * The key id is the RFC 7638 thumbprint the engine itself computes (`engine/src/identity/keys.ts`),
 * built the same way as the stdio bridge (`mcp/client.mjs`), so all three agree byte for byte.
 */

import { createHash, generateKeyPairSync } from 'node:crypto';

export interface PrivateJwk {
  readonly kty: 'OKP';
  readonly crv: 'Ed25519';
  readonly x: string;
  readonly d: string;
}

export interface AgentKey {
  readonly keyid: string;
  /** base64url of the 32-byte public key: what `POST /api/enroll` takes as `publicKey`. */
  readonly publicKey: string;
  /** The 32-byte private seed. Secret: encrypted before it is stored. */
  readonly seed: Buffer;
}

export function thumbprint(x: string): string {
  return createHash('sha256').update(`{"crv":"Ed25519","kty":"OKP","x":"${x}"}`, 'utf8').digest('base64url');
}

export function generateAgentKey(): AgentKey {
  const { privateKey } = generateKeyPairSync('ed25519');
  const jwk = privateKey.export({ format: 'jwk' });
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string' || typeof jwk.d !== 'string') {
    throw new Error('Ed25519 key did not export as a JWK');
  }
  return { keyid: thumbprint(jwk.x), publicKey: jwk.x, seed: Buffer.from(jwk.d, 'base64url') };
}

export function privateJwk(publicKey: string, seed: Buffer): PrivateJwk {
  return { kty: 'OKP', crv: 'Ed25519', x: publicKey, d: seed.toString('base64url') };
}
