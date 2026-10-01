/**
 * The follow API over a real socket: validation, enumeration, rate limits, and the two links.
 *
 * Every test drives `createApp` exactly as `serve()` mounts it, with a recording mailer in
 * place of Resend. The properties under test only exist on the wire — an identical body for
 * five different address states, a GET or HEAD that changes nothing however often a scanner
 * sends it, a page that carries its own security headers and sets no cookie — so a mocked
 * request object would prove none of them.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { FOLLOW_CONFIRM_COOLDOWN_MS, FOLLOW_CONFIRM_TTL_MS, type Allowance } from '../../src/api/limits.js';
import { MAX_QUEUED_REQUESTS } from '../../src/api/follow/index.js';
import { LOOSE_FOLLOW_LIMITS, TEST_SECRET, followHarness, linkIn, pathOf, tokenOf, type FollowHarness, type Reply } from './helpers.js';
import { unsubscribeTokenFor } from '../../src/api/follow/index.js';

const FOLLOW = '/api/follow';

let h: FollowHarness | null = null;
afterEach(async () => {
  if (h !== null) await h.close();
  h = null;
});

async function harness(options: Parameters<typeof followHarness>[0] = {}): Promise<FollowHarness> {
  h = await followHarness(options);
  return h;
}

/** Follow, wait for the queue, and return the confirmation link that was sent. */
async function requestAndLink(x: FollowHarness, handle: string, email: string): Promise<string> {
  const res = await x.post(FOLLOW, { handle, email });
  expect(res.status).toBe(202);
  await x.service.idle();
  return linkIn(x.mailer.to(email).at(-1), 'confirm');
}

/** Press a page's one button: POST the token as a form, exactly as a browser sends it. */
async function press(x: FollowHarness, which: 'confirm' | 'unsubscribe', token: string): Promise<Reply> {
  return x.request('POST', `/api/follow/${which}`, `token=${encodeURIComponent(token)}`, {
    'content-type': 'application/x-www-form-urlencoded',
  });
}

/** What a person does: open the link (the same GET a scanner makes), then press Confirm. */
async function confirmByHand(x: FollowHarness, link: string): Promise<Reply> {
  const page = await x.get(pathOf(link));
  expect(page.status).toBe(200);
  return press(x, 'confirm', tokenOf(link));
}

/** A link scanner: every link opened, twice, plus the HEAD a prefetcher sends. Never a POST. */
async function scan(x: FollowHarness, path: string): Promise<void> {
  await x.request('HEAD', path);
  await x.get(path);
  await x.get(path);
  await x.request('HEAD', path);
}

describe('POST /api/follow — validation is free and precise', () => {
  it('refuses a malformed body, handle or address with 400, charging nothing and sending nothing', async () => {
    const x = await harness({ limits: { ...LOOSE_FOLLOW_LIMITS, 'follow-ip': { burst: 1, windowSeconds: 3600 } } });
    for (const body of [
      '{not json',
      '[]',
      { email: 'you@example.com' },
      { handle: 'Vale_Underscore', email: 'you@example.com' },
      { handle: 'vale', email: 'you@example.com\r\nBcc: v@x.io' },
      { handle: 'vale', email: 'Vale <you@example.com>' },
      { handle: 'vale', email: 'vale@agenteve.io' },
      { handle: 'vale' },
    ]) {
      const res = await x.post(FOLLOW, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(String(res.json['detail'])).toContain('no rate-limit window was charged');
    }
    // The single IP slot is still there: none of the eight refusals spent it.
    expect((await x.post(FOLLOW, { handle: 'vale', email: 'you@example.com' })).status).toBe(202);
    await x.service.idle();
    expect(x.mailer.sent).toHaveLength(1);
  });

  it('accepts a handle as people type it — capitals, @, p: — and normalises the address', async () => {
    const x = await harness();
    const res = await x.post(FOLLOW, { handle: '@Vale', email: '  You@Example.COM ' });
    expect(res.status).toBe(202);
    expect(res.json['handle']).toBe('vale');
    await x.service.idle();
    expect(x.mailer.sent[0]?.to).toBe('you@example.com');
    expect((await x.post(FOLLOW, { handle: 'p:orison', email: 'b@example.com' })).json['handle']).toBe('orison');
  });

  it('reads only application/json, so no cross-site HTML form can reach it', async () => {
    const x = await harness();
    const form = await x.request('POST', FOLLOW, 'handle=vale&email=you%40example.com', {
      'content-type': 'application/x-www-form-urlencoded',
    });
    expect(form.status).toBe(415);
    expect(form.json['reason']).toBe('CONTENT_TYPE_UNSUPPORTED');
    // The text/plain trick a form CAN send, carrying JSON-shaped bytes.
    const plain = await x.request('POST', FOLLOW, JSON.stringify({ handle: 'vale', email: 'you@example.com' }), {
      'content-type': 'text/plain',
    });
    expect(plain.status).toBe(415);
    const withCharset = await x.post(FOLLOW, { handle: 'vale', email: 'you@example.com' }, { 'content-type': 'application/json; charset=utf-8' });
    expect(withCharset.status).toBe(202);
  });

  it('names an unknown handle (handles are public), with 404, after the IP meter', async () => {
    const x = await harness();
    const res = await x.post(FOLLOW, { handle: 'nobody-here', email: 'you@example.com' });
    expect(res.status).toBe(404);
    expect(res.json['reason']).toBe('NOT_ENROLLED');
    await x.service.idle();
    expect(x.mailer.sent).toHaveLength(0);
  });
});

describe('POST /api/follow — no enumeration', () => {
  it('answers byte-identically for a new, pending, following, unsubscribed and bucket-refused address', async () => {
    const x = await harness({
      limits: { ...LOOSE_FOLLOW_LIMITS, 'follow-email': { burst: 2, windowSeconds: 86_400 } },
    });
    const body = (email: string): unknown => ({ handle: 'vale', email });
    const fresh = await x.post(FOLLOW, body('new@example.com'));

    await x.post(FOLLOW, body('pending@example.com'));
    const pending = await x.post(FOLLOW, body('pending@example.com'));

    const confirm = await requestAndLink(x, 'vale', 'active@example.com');
    await confirmByHand(x, confirm);
    const active = await x.post(FOLLOW, body('active@example.com'));

    const link2 = await requestAndLink(x, 'vale', 'gone@example.com');
    await confirmByHand(x, link2);
    const row = await x.store.find('vale', 'gone@example.com');
    if (row === null) throw new Error('no row');
    await x.store.unsubscribe(row.id, 1);
    const unsubscribed = await x.post(FOLLOW, body('gone@example.com'));

    // The per-address bucket (2 a day) is spent by two different handles' confirmations.
    await x.post(FOLLOW, { handle: 'orison', email: 'busy@example.com' });
    await x.post(FOLLOW, { handle: 'red-ash-9', email: 'busy@example.com' });
    await x.service.idle();
    const bucketed = await x.post(FOLLOW, body('busy@example.com'));

    for (const res of [fresh, pending, active, unsubscribed, bucketed]) {
      expect(res.status).toBe(202);
      expect(res.text).toBe(fresh.text);
    }
    // And the answer does not even echo the address.
    expect(fresh.text).not.toContain('new@example.com');
    await x.service.idle();
    // What actually happened, silently: no second mail to the follower, none past the bucket.
    expect(x.mailer.to('active@example.com')).toHaveLength(1);
    expect(x.mailer.to('busy@example.com')).toHaveLength(2);
    expect(x.service.outcomes).toContain('already-following');
    expect(x.service.outcomes).toContain('address-bucket');
  });

  it('a repeat request inside the cooldown sends nothing; after it, a fresh link replaces the old', async () => {
    const x = await harness();
    const first = await requestAndLink(x, 'vale', 'you@example.com');
    await x.post(FOLLOW, { handle: 'vale', email: 'you@example.com' });
    await x.service.idle();
    expect(x.mailer.to('you@example.com')).toHaveLength(1);
    expect(x.service.outcomes.at(-1)).toBe('cooldown');

    x.clock.advance(FOLLOW_CONFIRM_COOLDOWN_MS + 1);
    const second = await requestAndLink(x, 'vale', 'you@example.com');
    expect(second).not.toBe(first);
    // The replaced link is dead — on its page and on its button — and the new one works.
    expect((await x.get(pathOf(first))).status).toBe(404);
    expect((await press(x, 'confirm', tokenOf(first))).status).toBe(404);
    expect((await confirmByHand(x, second)).status).toBe(200);
  });
});

describe('POST /api/follow — the limits', () => {
  it('per client IP: a 429 with Retry-After, and the next IP is unaffected', async () => {
    const x = await harness({ limits: { ...LOOSE_FOLLOW_LIMITS, 'follow-ip': { burst: 2, windowSeconds: 3600 } } });
    const ip = (v: string): Record<string, string> => ({ 'cf-connecting-ip': v });
    expect((await x.post(FOLLOW, { handle: 'vale', email: 'a@example.com' }, ip('1.2.3.4'))).status).toBe(202);
    expect((await x.post(FOLLOW, { handle: 'vale', email: 'b@example.com' }, ip('1.2.3.4'))).status).toBe(202);
    const third = await x.post(FOLLOW, { handle: 'vale', email: 'c@example.com' }, ip('1.2.3.4'));
    expect(third.status).toBe(429);
    expect(third.json['reason']).toBe('RATE_LIMITED');
    expect(Number(third.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await x.post(FOLLOW, { handle: 'vale', email: 'c@example.com' }, ip('5.6.7.8'))).status).toBe(202);
  });

  it('per handle: confirmations naming one handle stop silently at the bucket', async () => {
    const x = await harness({ limits: { ...LOOSE_FOLLOW_LIMITS, 'follow-handle': { burst: 3, windowSeconds: 3600 } } });
    for (let i = 0; i < 6; i += 1) {
      expect((await x.post(FOLLOW, { handle: 'vale', email: `r${String(i)}@example.com` })).status).toBe(202);
    }
    await x.service.idle();
    expect(x.mailer.sent).toHaveLength(3);
    expect(x.service.outcomes.filter((o) => o === 'handle-bucket')).toHaveLength(3);
    // Another handle has its own bucket.
    await x.post(FOLLOW, { handle: 'orison', email: 'r9@example.com' });
    await x.service.idle();
    expect(x.mailer.sent).toHaveLength(4);
  });

  it('the global daily ceiling: a 503 MAIL_CEILING with Retry-After to UTC midnight, then it resets', async () => {
    const x = await harness({ dailyCeiling: 2 });
    await requestAndLink(x, 'vale', 'a@example.com');
    await requestAndLink(x, 'vale', 'b@example.com');
    const full = await x.post(FOLLOW, { handle: 'vale', email: 'c@example.com' });
    expect(full.status).toBe(503);
    expect(full.json['reason']).toBe('MAIL_CEILING');
    // The harness clock is 12:00 UTC: twelve hours to the reset.
    expect(Number(full.headers.get('retry-after'))).toBe(12 * 3600);
    x.clock.advance(12 * 3600 * 1000);
    expect((await x.post(FOLLOW, { handle: 'vale', email: 'c@example.com' })).status).toBe(202);
    await x.service.idle();
    expect(x.mailer.sent).toHaveLength(3);
  });

  it('a full queue is a 503 that says nothing about any address', async () => {
    const x = await harness();
    // Wedge the mailer so the queue cannot drain.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    x.mailer.fail = () => null;
    const original = x.mailer.send.bind(x.mailer);
    x.mailer.send = async (mail) => {
      await gate;
      return original(mail);
    };
    const results: number[] = [];
    for (let i = 0; i < MAX_QUEUED_REQUESTS + 2; i += 1) {
      results.push((await x.post(FOLLOW, { handle: 'vale', email: `q${String(i)}@example.com` })).status);
    }
    expect(results.filter((s) => s === 202)).toHaveLength(MAX_QUEUED_REQUESTS);
    expect(results.at(-1)).toBe(503);
    release();
    await x.service.idle();
  });
});

describe('POST /api/follow — switched off', () => {
  it('with no mailer: 503 FOLLOW_DISABLED naming why, and nothing stored', async () => {
    const x = await harness({ sending: false });
    const res = await x.post(FOLLOW, { handle: 'vale', email: 'you@example.com' });
    expect(res.status).toBe(503);
    expect(res.json['reason']).toBe('FOLLOW_DISABLED');
    expect(String(res.json['detail'])).toContain('RESEND_API_KEY');
    expect(x.store.all()).toHaveLength(0);
  });

  it('with no follow service at all the route still exists and says so', async () => {
    const x = await harness({ withService: false });
    const res = await x.post(FOLLOW, { handle: 'vale', email: 'you@example.com' });
    expect(res.status).toBe(503);
    expect(res.json['reason']).toBe('FOLLOW_DISABLED');
    const page = await x.get('/api/follow/unsubscribe?token=' + 'x'.repeat(43));
    expect(page.status).toBe(503);
    expect(page.headers.get('content-type')).toContain('text/html');
  });
});

describe('the confirm link — a GET shows, only the button acts', () => {
  it('a GET answers a page naming the handle with ONE Confirm button, and changes NOTHING', async () => {
    const x = await harness();
    const link = await requestAndLink(x, 'vale', 'you@example.com');
    expect(link.startsWith('https://agenteve.io/api/follow/confirm?token=')).toBe(true);
    const page = await x.get(pathOf(link));
    expect(page.status).toBe(200);
    expect(page.text).toContain('Follow vale?');
    expect(page.text.match(/<form /g)).toHaveLength(1);
    expect(page.text).toContain('<form method="post" action="confirm">');
    expect(page.text).toContain(`<input type="hidden" name="token" value="${tokenOf(link)}">`);
    expect(page.text).toContain('<button type="submit">Confirm</button>');
    expect((await x.store.find('vale', 'you@example.com'))?.status).toBe('PENDING');
  });

  it('★ a mail scanner opening the link — GET, GET, HEAD — never completes the opt-in', async () => {
    // The attack this whole shape exists for: somebody subscribes a stranger's corporate address,
    // and the stranger's own SafeLinks/Proofpoint opens every link in the confirmation. Before this
    // change that GET WAS the confirmation.
    const x = await harness();
    const link = await requestAndLink(x, 'vale', 'victim@corp.example');
    for (let i = 0; i < 3; i += 1) await scan(x, pathOf(link));
    const row = await x.store.find('vale', 'victim@corp.example');
    expect(row?.status).toBe('PENDING');
    expect(row?.confirmedMs).toBeNull();
    // And nothing was mailed to it after the one confirmation.
    expect(x.mailer.to('victim@corp.example')).toHaveLength(1);
  });

  it('the button (a form POST of the token) activates once, idempotently, from the NEXT Reckoning', async () => {
    const x = await harness({ startTick: 3 * 288 + 100 });
    const link = await requestAndLink(x, 'vale', 'you@example.com');
    const first = await confirmByHand(x, link);
    expect(first.status).toBe(200);
    expect(first.text).toContain('You follow vale');
    const row = await x.store.find('vale', 'you@example.com');
    expect(row?.status).toBe('ACTIVE');
    // Reckoning 2 had settled at tick 863; the first recap will be Reckoning 3's.
    expect(row?.lastSentReckoning).toBe(2);
    const again = await press(x, 'confirm', tokenOf(link));
    expect(again.status).toBe(200);
    expect(again.text).toContain('You already follow vale');
  });

  it('the GET page is the same for a pending, a live and an unsubscribed follow', async () => {
    const x = await harness();
    const link = await requestAndLink(x, 'vale', 'you@example.com');
    const pending = await x.get(pathOf(link));
    await press(x, 'confirm', tokenOf(link));
    const live = await x.get(pathOf(link));
    const row = await x.store.find('vale', 'you@example.com');
    if (row === null) throw new Error('no row');
    await x.store.unsubscribe(row.id, 1);
    const gone = await x.get(pathOf(link));
    for (const res of [live, gone]) {
      expect(res.status).toBe(200);
      expect(res.text).toBe(pending.text);
    }
  });

  it('a token that does not verify — unknown, malformed, missing, doubled — gets "invalid or expired"', async () => {
    const x = await harness();
    for (const q of ['?token=' + 'A'.repeat(43), '?token=short', '', '?token=a&token=b']) {
      const res = await x.get(`/api/follow/confirm${q}`);
      expect(res.status, q).toBe(404);
      expect(res.text).toContain('This link is invalid or expired');
      expect(res.text).not.toContain('<form');
    }
    const pressed = await press(x, 'confirm', 'A'.repeat(43));
    expect(pressed.status).toBe(404);
    expect(pressed.text).toContain('This link is invalid or expired');
  });

  it('past its window the page says "invalid or expired", and the button cannot revive it', async () => {
    const x = await harness();
    const link = await requestAndLink(x, 'vale', 'you@example.com');
    x.clock.advance(FOLLOW_CONFIRM_TTL_MS + 1);
    const page = await x.get(pathOf(link));
    expect(page.status).toBe(404);
    expect(page.text).toContain('This link is invalid or expired');
    expect((await press(x, 'confirm', tokenOf(link))).status).toBe(410);
    expect((await x.store.find('vale', 'you@example.com'))?.status).toBe('PENDING');
  });

  it('only a form confirms: JSON, text/plain or a token in the URL change nothing', async () => {
    const x = await harness();
    const link = await requestAndLink(x, 'vale', 'you@example.com');
    const token = tokenOf(link);
    const json = await x.request('POST', '/api/follow/confirm', JSON.stringify({ token }), { 'content-type': 'application/json' });
    expect(json.status).toBe(415);
    const plain = await x.request('POST', '/api/follow/confirm', `token=${token}`, { 'content-type': 'text/plain' });
    expect(plain.status).toBe(415);
    const inUrl = await x.request('POST', pathOf(link), 'List-Unsubscribe=One-Click', {
      'content-type': 'application/x-www-form-urlencoded',
    });
    expect(inUrl.status).toBe(404);
    expect((await x.store.find('vale', 'you@example.com'))?.status).toBe('PENDING');
  });

  it('enforces the follows-per-address cap at the button, where only the inbox owner sees it', async () => {
    const x = await harness({ maxActivePerEmail: 1 });
    const one = await requestAndLink(x, 'vale', 'you@example.com');
    const two = await requestAndLink(x, 'orison', 'you@example.com');
    expect((await confirmByHand(x, one)).status).toBe(200);
    const capped = await confirmByHand(x, two);
    expect(capped.status).toBe(409);
    expect(capped.text).toContain('already follows 1 principals');
    expect((await x.store.find('orison', 'you@example.com'))?.status).toBe('PENDING');
  });

  it('every link page carries its own security headers and sets NO cookie', async () => {
    const x = await harness();
    const link = await requestAndLink(x, 'vale', 'you@example.com');
    for (const res of [await x.get(pathOf(link)), await press(x, 'confirm', tokenOf(link)), await x.get('/api/follow/confirm?token=x')]) {
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('x-robots-tag')).toContain('noindex');
      const csp = res.headers.get('content-security-policy') ?? '';
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("form-action 'self'");
      expect(res.headers.get('set-cookie')).toBeNull();
    }
  });
});

describe('the unsubscribe link — a GET shows, the button or RFC 8058 acts', () => {
  async function following(x: FollowHarness, email = 'you@example.com'): Promise<string> {
    const link = await requestAndLink(x, 'vale', email);
    await confirmByHand(x, link);
    const row = await x.store.find('vale', email);
    if (row === null) throw new Error('no row');
    // The worker prints this exact link in every recap; derive it the same way.
    return `/api/follow/unsubscribe?token=${unsubscribeTokenFor(TEST_SECRET, row.id)}`;
  }

  it('a GET answers a page with ONE Unsubscribe button, and changes nothing', async () => {
    const x = await harness();
    const path = await following(x);
    const page = await x.get(path);
    expect(page.status).toBe(200);
    expect(page.text).toContain('Unsubscribe from vale?');
    expect(page.text).toContain('<form method="post" action="unsubscribe">');
    expect(page.text).toContain('<button type="submit">Unsubscribe</button>');
    expect((await x.store.find('vale', 'you@example.com'))?.status).toBe('ACTIVE');
  });

  it('★ a mail scanner opening every link in a recap never unsubscribes anybody', async () => {
    const x = await harness();
    const path = await following(x);
    for (let i = 0; i < 3; i += 1) await scan(x, path);
    expect((await x.store.find('vale', 'you@example.com'))?.status).toBe('ACTIVE');
  });

  it('the button unsubscribes, idempotently', async () => {
    const x = await harness();
    const path = await following(x);
    const token = new URL(`https://x${path}`).searchParams.get('token') ?? '';
    const first = await press(x, 'unsubscribe', token);
    expect(first.status).toBe(200);
    expect(first.text).toContain('You have unsubscribed from vale');
    expect((await x.store.find('vale', 'you@example.com'))?.status).toBe('UNSUBSCRIBED');
    const again = await press(x, 'unsubscribe', token);
    expect(again.status).toBe(200);
    expect(again.text).toContain('already unsubscribed');
  });

  it('RFC 8058 one-click, form-encoded: a mail client POSTs List-Unsubscribe=One-Click to the URL', async () => {
    const x = await harness();
    const path = await following(x);
    const res = await x.request('POST', path, 'List-Unsubscribe=One-Click', {
      'content-type': 'application/x-www-form-urlencoded',
    });
    expect(res.status).toBe(200);
    expect((await x.store.find('vale', 'you@example.com'))?.status).toBe('UNSUBSCRIBED');
  });

  it('RFC 8058 one-click, multipart — the encoding the RFC says SHOULD be used — works the same', async () => {
    const x = await harness();
    const path = await following(x);
    const boundary = 'eve-boundary-1';
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="List-Unsubscribe"\r\n\r\nOne-Click\r\n--${boundary}--\r\n`;
    const res = await x.request('POST', path, body, { 'content-type': `multipart/form-data; boundary=${boundary}` });
    expect(res.status).toBe(200);
    expect((await x.store.find('vale', 'you@example.com'))?.status).toBe('UNSUBSCRIBED');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('works with sending switched OFF — nobody is ever stranded', async () => {
    const x = await harness();
    const path = await following(x);
    // Same store, a service with no mailer, as after an operator removes the key.
    const { FollowService } = await import('../../src/api/follow/index.js');
    const off = new FollowService({
      store: x.store, mailer: null, offReason: 'off', secret: null, clock: x.clock, publicUrl: 'https://agenteve.io',
      dailyCeiling: 1, maxActivePerEmail: 1, log: () => undefined,
    });
    expect((await off.inspectUnsubscribe(tokenOf(`https://x${path}`))).kind).toBe('valid-link');
    expect((await off.unsubscribe(tokenOf(`https://x${path}`))).kind).toBe('unsubscribed');
  });

  it('an unknown token is "invalid or expired", on the page and on the button', async () => {
    const x = await harness();
    await following(x);
    expect((await x.get('/api/follow/unsubscribe?token=' + 'B'.repeat(43))).status).toBe(404);
    const pressed = await press(x, 'unsubscribe', 'B'.repeat(43));
    expect(pressed.status).toBe(404);
    expect(pressed.text).toContain('This link is invalid or expired');
    expect((await x.store.find('vale', 'you@example.com'))?.status).toBe('ACTIVE');
  });

  it('after unsubscribing, the OLD confirm button cannot re-subscribe; a new request can', async () => {
    const x = await harness();
    const link = await requestAndLink(x, 'vale', 'you@example.com');
    await confirmByHand(x, link);
    const row = await x.store.find('vale', 'you@example.com');
    if (row === null) throw new Error('no row');
    await x.store.unsubscribe(row.id, 1);
    const stale = await press(x, 'confirm', tokenOf(link));
    expect(stale.status).toBe(409);
    expect((await x.store.find('vale', 'you@example.com'))?.status).toBe('UNSUBSCRIBED');
    x.clock.advance(FOLLOW_CONFIRM_COOLDOWN_MS + 1);
    const fresh = await requestAndLink(x, 'vale', 'you@example.com');
    expect((await confirmByHand(x, fresh)).status).toBe(200);
    expect((await x.store.find('vale', 'you@example.com'))?.status).toBe('ACTIVE');
  });

  it('the link routes have their own IP bucket, for the pages and the buttons alike', async () => {
    const limits: Record<string, Allowance> = { ...LOOSE_FOLLOW_LIMITS, 'follow-link': { burst: 2, windowSeconds: 600 } };
    const x = await harness({ limits });
    const bad = '/api/follow/confirm?token=' + 'C'.repeat(43);
    expect((await x.get(bad)).status).toBe(404);
    expect((await press(x, 'confirm', 'C'.repeat(43))).status).toBe(404);
    const third = await x.get(bad);
    expect(third.status).toBe(429);
    expect(Number(third.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('the 404 enumeration names the new route, so the map stays true', () => {
  it('lists POST /api/follow among the API', async () => {
    const x = await harness();
    const res = await x.get('/api/nothing-here');
    expect(res.status).toBe(404);
    expect(String(res.json['detail'])).toContain('POST /api/follow');
  });
});
