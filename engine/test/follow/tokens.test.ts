/**
 * The link tokens: random where they are sent once, HMAC where they must be re-printed, and
 * stored only as a hash either way — so a leaked dump of the follow table holds no working link.
 */

import { describe, expect, it } from 'vitest';
import {
  TOKEN_GRAMMAR,
  hashToken,
  isTokenShaped,
  newLinkToken,
  unsubscribeTokenFor,
} from '../../src/api/follow/index.js';
import { TEST_SECRET } from './helpers.js';

describe('link tokens', () => {
  it('a confirm token is 32 random bytes, base64url, 43 characters, and never repeats', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const t = newLinkToken();
      expect(t).toMatch(TOKEN_GRAMMAR);
      seen.add(t);
    }
    expect(seen.size).toBe(200);
  });

  it('the stored form is a sha-256 hex digest, not the token', () => {
    const t = newLinkToken();
    const h = hashToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(t);
    expect(hashToken(t)).toBe(h);
  });

  it('an unsubscribe token is deterministic per (secret, follow), so every recap can re-print it', () => {
    const a = unsubscribeTokenFor(TEST_SECRET, 'follow-a');
    expect(a).toMatch(TOKEN_GRAMMAR);
    expect(unsubscribeTokenFor(TEST_SECRET, 'follow-a')).toBe(a);
    expect(unsubscribeTokenFor(TEST_SECRET, 'follow-b')).not.toBe(a);
    // Without the key it cannot be derived: a different key gives a different token.
    expect(unsubscribeTokenFor(`${TEST_SECRET}-rotated`, 'follow-a')).not.toBe(a);
  });

  it('isTokenShaped refuses anything that is not exactly our grammar, before any lookup', () => {
    expect(isTokenShaped(newLinkToken())).toBe(true);
    for (const bad of [undefined, null, 1, '', 'short', `${newLinkToken()}x`, `${'a'.repeat(42)}!`, ['x'], "' OR 1=1 --"]) {
      expect(isTokenShaped(bad)).toBe(false);
    }
  });
});
