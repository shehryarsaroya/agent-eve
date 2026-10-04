/**
 * Cross-device sign-in handoffs (src/auth/handoff.ts): the popup's secret is the only way to
 * collect the session, the word must be typed (two wrong words cancel it), the confirming email
 * must match, the session is handed over once, and a full store refuses newcomers instead of
 * dropping anyone's pending sign-in.
 */

import { describe, expect, it } from 'vitest';
import { normaliseWord, SignInHandoffs, WRONG_WORDS_ALLOWED } from '../src/auth/handoff.js';
import { networkOf } from '../src/http.js';

const SESSION = { accessToken: 'access-1', refreshToken: 'refresh-1' };

function opened(handoffs: SignInHandoffs, email = 'player@example.com') {
  const result = handoffs.open(email);
  if (result === null) throw new Error('the store refused a handoff');
  return result;
}

describe('sign-in handoffs', () => {
  it('opens with an id, a secret and a word, and says only whether it is pending', () => {
    const handoffs = new SignInHandoffs();
    const { id, secret, word } = opened(handoffs, 'Player@Example.com');
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(word).toMatch(/^[A-Z]{3,7}$/);
    expect(handoffs.ttlSeconds).toBe(600);
    expect(handoffs.pending(id)).toBe(true);
    expect(handoffs.pending('AAAAAAAAAAAAAAAAAAAAAA')).toBe(false);
  });

  it('checks the typed word leniently, and hands a confirmed session to the secret holder once', () => {
    const handoffs = new SignInHandoffs();
    const { id, secret, word } = opened(handoffs);
    expect(handoffs.check(id, ` ${word.toLowerCase()}. `)).toEqual({ status: 'ok' });
    expect(handoffs.take(id, secret)).toEqual({ status: 'waiting' });
    expect(handoffs.confirm(id, ' PLAYER@example.com ', word, SESSION)).toBe('confirmed');
    expect(handoffs.pending(id)).toBe(false);
    expect(handoffs.take(id, 'not-the-secret')).toEqual({ status: 'unknown' });
    expect(handoffs.take(id, secret)).toEqual({ status: 'confirmed', session: SESSION });
    expect(handoffs.take(id, secret)).toEqual({ status: 'unknown' });
  });

  it('cancels the handoff after two wrong words, whether checked or confirmed', () => {
    expect(WRONG_WORDS_ALLOWED).toBe(2);
    const handoffs = new SignInHandoffs();
    const first = opened(handoffs);
    expect(handoffs.check(first.id, 'NOTAWORD')).toEqual({ status: 'wrong', triesLeft: 1 });
    expect(handoffs.check(first.id, 'STILLNOT')).toEqual({ status: 'wrong', triesLeft: 0 });
    expect(handoffs.check(first.id, first.word)).toEqual({ status: 'unknown' });
    expect(handoffs.take(first.id, first.secret)).toEqual({ status: 'unknown' });

    const second = opened(handoffs);
    expect(handoffs.check(second.id, 'NOTAWORD')).toEqual({ status: 'wrong', triesLeft: 1 });
    expect(handoffs.confirm(second.id, 'player@example.com', 'STILLNOT', SESSION)).toBe('wrong_word');
    expect(handoffs.confirm(second.id, 'player@example.com', second.word, SESSION)).toBe('unknown');
  });

  it('refuses a session for another email, a second confirmation and an unknown id', () => {
    const handoffs = new SignInHandoffs();
    const { id, secret, word } = opened(handoffs);
    expect(handoffs.confirm(id, 'someone-else@example.com', word, SESSION)).toBe('email_mismatch');
    expect(handoffs.take(id, secret)).toEqual({ status: 'waiting' });
    expect(handoffs.confirm(id, 'player@example.com', word, SESSION)).toBe('confirmed');
    expect(handoffs.confirm(id, 'player@example.com', word, { accessToken: 'other', refreshToken: 'other' })).toBe('already_confirmed');
    expect(handoffs.check(id, word)).toEqual({ status: 'unknown' });
    expect(handoffs.take(id, secret)).toEqual({ status: 'confirmed', session: SESSION });
    expect(handoffs.confirm('nope-nope-nope-nope', 'player@example.com', word, SESSION)).toBe('unknown');
  });

  it('forgets a handoff, confirmed or not, once its lifetime is over', () => {
    let now = 1_000_000;
    const handoffs = new SignInHandoffs({ ttlSeconds: 600, now: () => now });
    const waiting = opened(handoffs, 'a@example.com');
    const confirmed = opened(handoffs, 'b@example.com');
    handoffs.confirm(confirmed.id, 'b@example.com', confirmed.word, SESSION);
    now += 599_000;
    expect(handoffs.size).toBe(2);
    now += 2_000;
    expect(handoffs.pending(waiting.id)).toBe(false);
    expect(handoffs.take(confirmed.id, confirmed.secret)).toEqual({ status: 'unknown' });
    expect(handoffs.size).toBe(0);
  });

  it('refuses new handoffs when full and never drops a pending one', () => {
    let now = 0;
    const handoffs = new SignInHandoffs({ max: 3, ttlSeconds: 600, now: () => now });
    const kept = [opened(handoffs, 'a@example.com'), opened(handoffs, 'b@example.com'), opened(handoffs, 'c@example.com')];
    expect(handoffs.open('d@example.com')).toBeNull();
    for (const handoff of kept) expect(handoffs.pending(handoff.id)).toBe(true);
    now += 601_000;
    expect(handoffs.open('d@example.com')).not.toBeNull();
  });

  it('normalises typed words and keys IPv6 callers by their /64', () => {
    expect(normaliseWord(' Tiger. ')).toBe('TIGER');
    expect(networkOf('203.0.113.9')).toBe('203.0.113.9');
    expect(networkOf('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(networkOf('2001:db8:aa:bb:1:2:3:4')).toBe('2001:db8:aa:bb::/64');
    expect(networkOf('2001:0db8:00aa:00bb::4')).toBe('2001:db8:aa:bb::/64');
    expect(networkOf('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(networkOf('2001:db8::1')).toBe(networkOf('2001:db8:0:0:ffff::9'));
    expect(networkOf('unknown')).toBe('unknown');
  });
});
