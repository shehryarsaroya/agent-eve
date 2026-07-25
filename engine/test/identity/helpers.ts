/**
 * Fixtures for the identity suite. Not a test file: vitest only collects
 * `*.test.ts`.
 *
 * Everything here is deterministic except key generation, which draws from the OS
 * CSPRNG on purpose (see `keys.ts` — a key derived from the published seed would
 * be derivable by every spectator). No test asserts a hard-coded signature for
 * that reason; the golden assertions are on the **signature base**, which is the
 * part RFC 9421 §2.5 actually specifies and the part a bug would live in.
 */

import type { PrincipalId } from '../../src/core/types.js';
import { BoundedReplayStore, Keyring, generateKeypair, wallSeconds } from '../../src/identity/index.js';
import type { AgentKeypair, SignableRequest, WallSeconds } from '../../src/identity/index.js';

/** A fixed instant, so freshness arithmetic in tests is readable. */
export const NOW: WallSeconds = wallSeconds(1_700_000_000);

/** A tick well clear of zero, so "before registration" is expressible. */
export const TICK = 500;

export function principal(name: string): PrincipalId {
  return name as PrincipalId;
}

export interface Enrolled {
  readonly id: PrincipalId;
  readonly keypair: AgentKeypair;
}

export function enrol(keyring: Keyring, name: string, atTick = 0): Enrolled {
  const keypair = generateKeypair();
  const id = principal(name);
  keyring.register(id, keypair.record, atTick);
  return { id, keypair };
}

/** A store comfortably wider than the default policy's freshness window. */
export function freshStore(perKeyCap = 64, maxKeys = 32): BoundedReplayStore {
  return new BoundedReplayStore({ retention: wallSeconds(600), perKeyCap, maxKeys });
}

export function newKeyring(): Keyring {
  return new Keyring();
}

export function jsonBody(value: unknown): Uint8Array {
  return new Uint8Array(Buffer.from(JSON.stringify(value), 'utf8'));
}

/** Replace the request's headers wholesale — for hand-crafting a bad signature. */
export function withHeaders(
  request: SignableRequest,
  headers: Readonly<Record<string, string>>,
): SignableRequest {
  return { ...request, headers };
}

/**
 * A well-formed but meaningless signature: 64 zero bytes.
 *
 * Used for the rejections that are refused **before** any curve operation — the
 * structural ones. That the tests can use it at all is the check-order guarantee
 * made executable: if one of those cases ever started needing a real signature,
 * it would mean crypto had moved ahead of a cheap structural check.
 */
export const PLACEHOLDER_SIGNATURE = `compact=:${Buffer.alloc(64).toString('base64')}:`;

export function bareRequest(
  overrides: Partial<SignableRequest> = {},
): SignableRequest {
  return {
    method: 'POST',
    scheme: 'https',
    authority: 'compact.example',
    requestTarget: '/act',
    headers: {},
    body: null,
    ...overrides,
  };
}
