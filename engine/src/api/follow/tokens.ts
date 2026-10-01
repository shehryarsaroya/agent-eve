/**
 * The two link tokens, and why they are built differently.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **BOTH ARE STORED ONLY AS A SHA-256 HASH**, so a leaked backup holds no working link.
 * That property costs nothing for the confirm token and something real for the
 * unsubscribe token, and the difference is the whole design of this file:
 *
 *   - **Confirm** is sent ONCE. It is 32 random bytes, emailed, and forgotten; a re-request
 *     mints a new one. Nothing ever needs the plaintext again.
 *   - **Unsubscribe** must be printed into EVERY recap, for as long as the follow lives. A
 *     random token stored only as a hash cannot be re-printed, so it is an HMAC instead —
 *     keyed by `COMPACT_FOLLOW_SECRET`, over the follow's own random id — and recomputed at
 *     each send. The database holds the id and the hash; the key lives in the environment.
 *     A database leak without the key yields no working unsubscribe link, which is the same
 *     guarantee the confirm token gets for free.
 *
 * Rotating the key re-derives every token. The recap worker notices the stored hash no
 * longer matches and re-stamps it before it sends, so links in older emails stop working and
 * the link in the newest one always does.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `randomBytes` is not the world's randomness and never touches it: nothing here enters world
 * state, the action log or `state_hash`, which is DET-7's subject. A token that could be
 * replayed from a seed would be a token anyone with the seed could forge.
 */

import { createHash, createHmac, randomBytes } from 'node:crypto';

/** 32 bytes, base64url, unpadded: exactly 43 characters. Anything else is not ours. */
export const TOKEN_GRAMMAR = /^[A-Za-z0-9_-]{43}$/;

/** The shortest `COMPACT_FOLLOW_SECRET` accepted. 32 hex characters is 128 bits. */
export const MIN_SECRET_LENGTH = 32;

/** Domain separation, so this key can never sign anything that is not an unsubscribe link. */
const UNSUBSCRIBE_CONTEXT = 'agent-eve/follow/unsubscribe/v1:';

export function newLinkToken(): string {
  return randomBytes(32).toString('base64url');
}

/** A follow's id: random, so ids do not count followers and carry no ordering a reader could use. */
export function newFollowId(): string {
  return randomBytes(16).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function unsubscribeTokenFor(secret: string, followId: string): string {
  return createHmac('sha256', secret).update(`${UNSUBSCRIBE_CONTEXT}${followId}`, 'utf8').digest('base64url');
}

/** True for a string that could be one of our tokens. A cheap refusal before any lookup. */
export function isTokenShaped(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_GRAMMAR.test(value);
}

/**
 * A stable, non-reversible key for one address in an in-memory bucket, so the limiter's map
 * holds no address in the clear.
 */
export function addressKey(email: string): string {
  return createHash('sha256').update(`agent-eve/follow/address:${email}`, 'utf8').digest('hex').slice(0, 32);
}
