/**
 * ★ PER-ACCOUNT LIMITS (A4) — behind the connector, every chat player is `127.0.0.1`.
 *
 * Without the gateway header the engine's per-address limits bind every chat player together, most
 * sharply the enrolment quota: six identities a day for the whole of ChatGPT and Claude. With a
 * verified header each ACCOUNT is its own bucket — on every route and on the quota — and the address
 * behind them all keeps its own, untouched.
 */

import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { gatewayHeaders } from '../../src/api/gateway.js';
import { ACCOUNT_KEY_PREFIX, accountKey } from '../../src/api/limits.js';
import { wallSecondsFrom } from '../../src/identity/index.js';
import {
  LOOSE_LIMITS,
  LOOSE_QUOTA,
  PATHS,
  agent,
  buildSigned,
  harness,
  publicKeyOf,
  raw,
  type Agent,
  type Harness,
} from './harness.js';

const SECRET = Buffer.alloc(32, 0x41);
const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

function nowOf(x: Harness): number {
  return Math.floor(x.clock.nowMs() / 1000);
}

async function enrolAs(x: Harness, account: string | null, a: Agent) {
  const text = JSON.stringify({ handle: a.handle, publicKey: publicKeyOf(a) });
  const digest = `sha-256=:${createHash('sha256').update(text).digest('base64')}:`;
  const headers: Record<string, string> = { 'content-type': 'application/json', 'content-digest': digest };
  if (account !== null) {
    Object.assign(headers, gatewayHeaders(SECRET, { accountId: account, method: 'POST', path: PATHS.enroll, contentDigest: digest, now: nowOf(x) }));
  }
  return raw(x, 'POST', PATHS.enroll, text, headers);
}

async function observeAs(x: Harness, account: string, a: Agent) {
  const { headers } = buildSigned(x, a, 'GET', PATHS.observe);
  const gate = gatewayHeaders(SECRET, { accountId: account, method: 'GET', path: PATHS.observe, contentDigest: null, now: nowOf(x) });
  return raw(x, 'GET', PATHS.observe, undefined, { ...headers, ...gate });
}

describe('★ every bucket keys on the account when the gateway header verified', () => {
  it('the enrol burst: one account exhausting its own leaves the next account, and the address, untouched', async () => {
    h = await harness({
      gateway: { state: 'configured', secret: SECRET },
      limits: { ...LOOSE_LIMITS, enroll: { burst: 2, windowSeconds: 600 } },
    });
    expect((await enrolAs(h, ALICE, agent('alice-one'))).status).toBe(201);
    expect((await enrolAs(h, ALICE, agent('alice-two'))).status).toBe(201);
    const third = await enrolAs(h, ALICE, agent('alice-three'));
    expect(third.status).toBe(429);
    expect(third.json['reason']).toBe('RATE_LIMITED');
    expect(String(third.json['detail'])).toContain('from this account');
    expect(String(third.json['detail'])).not.toContain('127.0.0.1');
    // Another account behind the same loopback address: its own bucket.
    expect((await enrolAs(h, BOB, agent('bob-one'))).status).toBe(201);
    // And the address itself — an ordinary client — never shared a window with either account.
    expect((await enrolAs(h, null, agent('plain-one'))).status).toBe(201);
    expect((await enrolAs(h, null, agent('plain-two'))).status).toBe(201);
    expect((await enrolAs(h, null, agent('plain-three'))).status).toBe(429);
  });

  it('★ the enrolment QUOTA keys on the account: six a day per account, not six for every chat player', async () => {
    h = await harness({
      gateway: { state: 'configured', secret: SECRET },
      quota: { burst: 1, windowSeconds: 86_400 },
    });
    expect((await enrolAs(h, ALICE, agent('quota-alice'))).status).toBe(201);
    const again = await enrolAs(h, ALICE, agent('quota-alice-two'));
    expect(again.status).toBe(429);
    expect(String(again.json['detail'])).toMatch(/^this account has already minted 1 identities .* the most one account may/);
    // The account bucket is the one charged, by its own key.
    const now = wallSecondsFrom(h.clock);
    expect(h.context.limiter.quotaVerdict(accountKey(ALICE), now).allowed).toBe(false);
    expect(h.context.limiter.quotaVerdict(accountKey(BOB), now).allowed).toBe(true);
    expect(h.context.limiter.quotaVerdict('127.0.0.1', now).allowed).toBe(true);
    expect((await enrolAs(h, BOB, agent('quota-bob'))).status).toBe(201);
    expect((await enrolAs(h, null, agent('quota-plain'))).status).toBe(201);
    // …and an address that has used its quota still says "address", in its own words.
    const plainAgain = await enrolAs(h, null, agent('quota-plain-two'));
    expect(plainAgain.status).toBe(429);
    expect(String(plainAgain.json['detail'])).toMatch(/^127\.0\.0\.1 has already minted 1 identities .* the most one address may/);
  });

  it('a signed route (observe) is metered per account too', async () => {
    h = await harness({
      gateway: { state: 'configured', secret: SECRET },
      limits: { ...LOOSE_LIMITS, observe: { burst: 1, windowSeconds: 60 } },
      quota: LOOSE_QUOTA,
    });
    const a = agent('watcher-a');
    const b = agent('watcher-b');
    expect((await enrolAs(h, ALICE, a)).status).toBe(201);
    expect((await enrolAs(h, BOB, b)).status).toBe(201);
    h.runtime.runTick();
    expect((await observeAs(h, ALICE, a)).status).toBe(200);
    const second = await observeAs(h, ALICE, a);
    expect(second.status).toBe(429);
    expect(String(second.json['detail'])).toContain('too many observe requests from this account');
    expect((await observeAs(h, BOB, b)).status).toBe(200);
  });

  it('the bucket key is `acct:` + the verified UUID, and nothing else can mint one', () => {
    expect(accountKey(ALICE)).toBe(`${ACCOUNT_KEY_PREFIX}${ALICE}`);
    expect(() => accountKey('127.0.0.1')).toThrow();
    expect(() => accountKey(ALICE.toUpperCase())).toThrow();
    expect(() => accountKey(`${ALICE} `)).toThrow();
  });
});
