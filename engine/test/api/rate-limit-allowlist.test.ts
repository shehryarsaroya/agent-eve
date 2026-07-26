/**
 * The rate-limit allowlist (Gate 3 run 2 finding #2).
 *
 * A probe FLEET behind one egress IP shared the enrol burst of 3 per 10 minutes, so 2 of
 * 6 probes never onboarded and the run lost a third of its sample. The fix is an operator
 * allowlist for a controlled test window — NOT a weakening of the limiter for anyone else
 * (scar #3), and safe because the limiter guards the host, not the game (A4 makes request
 * speed powerless). These tests pin all three properties: unlisted clients metered exactly
 * as before, allowlisted clients exempt on every route, and one allowlisted IP granting no
 * exemption to any other.
 */

import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../../src/api/limits.js';
import { wallSeconds } from '../../src/identity/index.js';

const NOW = wallSeconds(1000);

describe('RateLimiter allowlist', () => {
  it('an unlisted client is metered exactly as before — the enrol burst is 8', () => {
    const rl = new RateLimiter();
    const ip = '2001:db8::stranger';
    // Eight, raised from three after a playtest spent 54 minutes enrolling: a handle
    // collision is charged (it is enumeration), so three guesses per ten minutes was not
    // enough to get in on a first sitting. The bound is still hard and the seat cap is a
    // second, independent one.
    for (let i = 0; i < 8; i += 1) {
      expect(rl.check('enroll', ip, NOW).allowed, `enrol #${String(i + 1)}`).toBe(true);
    }
    expect(rl.check('enroll', ip, NOW).allowed).toBe(false); // the 9th trips the burst
  });

  it('an allowlisted client is never metered, on any route, however many requests', () => {
    const ip = '2001:db8::fleet';
    const rl = new RateLimiter(undefined, undefined, new Set([ip]));
    for (let i = 0; i < 50; i += 1) {
      expect(rl.check('enroll', ip, NOW).allowed, `enrol #${String(i)}`).toBe(true);
    }
    for (let i = 0; i < 500; i += 1) {
      expect(rl.check('act', ip, NOW).allowed, `act #${String(i)}`).toBe(true);
    }
    // Even an unknown route (which fails closed for everyone else) is served for a
    // trusted source — the exemption is checked before the route lookup.
    expect(rl.check('no-such-route', ip, NOW).allowed).toBe(true);
  });

  it('exempting one IP grants no exemption to any other (not a global weakening, scar #3)', () => {
    const rl = new RateLimiter(undefined, undefined, new Set(['1.2.3.4']));
    const other = '5.6.7.8';
    for (let i = 0; i < 8; i += 1) expect(rl.check('enroll', other, NOW).allowed).toBe(true);
    expect(rl.check('enroll', other, NOW).allowed).toBe(false); // metered normally
  });

  it('the default limiter has an empty allowlist, so production is unchanged', () => {
    const rl = new RateLimiter();
    const ip = '9.9.9.9';
    // Nine enrols: the ninth must be refused, proving nothing is silently exempt.
    const verdicts = Array.from({ length: 9 }, () => rl.check('enroll', ip, NOW).allowed);
    expect(verdicts).toEqual([true, true, true, true, true, true, true, true, false]);
  });
});
