/**
 * The Resend mailer, driven through an injected `fetch` — no network, no real key.
 *
 * **THE KEY BELOW IS NOT A KEY.** It is assembled at runtime from the words "not a real key"
 * so that it is findable: a redactor can only be tested by giving it something to redact.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAIL_REDACTED,
  MailError,
  RESEND_EMAILS_URL,
  describeMailFailure,
  mailKeyPresent,
  pacedMailer,
  redactMailSecrets,
  resendMailer,
  type Mailer,
  type OutboundMail,
} from '../../src/api/follow/index.js';

const FAKE_KEY = ['re', 'this', 'is', 'not', 'a', 'real', 'key', '0011223344'].join('_');

let saved: string | undefined;
beforeEach(() => {
  saved = process.env['RESEND_API_KEY'];
  process.env['RESEND_API_KEY'] = FAKE_KEY;
});
afterEach(() => {
  if (saved === undefined) delete process.env['RESEND_API_KEY'];
  else process.env['RESEND_API_KEY'] = saved;
});

const MAIL: OutboundMail = {
  to: 'reader@example.com',
  subject: 'vale kept a promise · Reckoning 4',
  text: 'plain',
  html: '<p>html</p>',
  headers: { 'List-Unsubscribe': '<https://agenteve.io/api/follow/unsubscribe?token=abc>' },
  idempotencyKey: 'recap-id-r4',
};

interface Seen {
  url: string;
  init: RequestInit;
}

/** A request body as the text it was sent as. Every body this mailer sends is a JSON string. */
function bodyOf(init: RequestInit | undefined): string {
  return typeof init?.body === 'string' ? init.body : '';
}

function capture(response: () => Response): { fetchImpl: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    seen.push({ url, init });
    return Promise.resolve(response());
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}

describe('resendMailer — the request', () => {
  it('POSTs Resend’s shape to /emails, with the key in exactly one header', async () => {
    const { fetchImpl, seen } = capture(() => new Response(JSON.stringify({ id: 'em_1' }), { status: 200 }));
    const mailer = resendMailer({ from: 'Agent Eve <updates@agenteve.io>', fetchImpl });
    const receipt = await mailer.send(MAIL);
    expect(receipt.id).toBe('em_1');
    expect(seen).toHaveLength(1);
    const call = seen[0];
    if (call === undefined) throw new Error('no call');
    expect(call.url).toBe(RESEND_EMAILS_URL);
    expect(call.init.method).toBe('POST');
    const headers = call.init.headers as Record<string, string>;
    expect(headers['authorization']).toBe(`Bearer ${FAKE_KEY}`);
    expect(headers['content-type']).toBe('application/json');
    expect(headers['idempotency-key']).toBe('recap-id-r4');
    expect(headers['user-agent']).toMatch(/agent-eve/);
    const body = JSON.parse(bodyOf(call.init)) as Record<string, unknown>;
    expect(body).toEqual({
      from: 'Agent Eve <updates@agenteve.io>',
      to: ['reader@example.com'],
      subject: 'vale kept a promise · Reckoning 4',
      text: 'plain',
      html: '<p>html</p>',
      headers: { 'List-Unsubscribe': '<https://agenteve.io/api/follow/unsubscribe?token=abc>' },
    });
    // A key in the body would be a key in every provider-side log.
    expect(bodyOf(call.init)).not.toContain(FAKE_KEY);
  });

  it('strips line breaks from the subject, whatever the caller built', async () => {
    const { fetchImpl, seen } = capture(() => new Response('{}', { status: 200 }));
    await resendMailer({ from: 'a@agenteve.io', fetchImpl }).send({ ...MAIL, subject: 'one\r\nBcc: x@y.z' });
    const body = JSON.parse(bodyOf(seen[0]?.init)) as { subject: string };
    expect(body.subject).toBe('one Bcc: x@y.z');
  });

  it('reads the key lazily, so a rotated key needs no restart', async () => {
    const { fetchImpl, seen } = capture(() => new Response('{}', { status: 200 }));
    const mailer = resendMailer({ from: 'a@agenteve.io', fetchImpl });
    const rotated = `${FAKE_KEY}_rotated`;
    process.env['RESEND_API_KEY'] = rotated;
    await mailer.send(MAIL);
    expect((seen[0]?.init.headers as Record<string, string>)['authorization']).toBe(`Bearer ${rotated}`);
  });

  it('with no key: a fatal MailError naming the VARIABLE, and no request at all', async () => {
    delete process.env['RESEND_API_KEY'];
    const { fetchImpl, seen } = capture(() => new Response('{}', { status: 200 }));
    const error = await resendMailer({ from: 'a@agenteve.io', fetchImpl }).send(MAIL).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailError);
    expect((error as MailError).fatal).toBe(true);
    expect((error as MailError).message).toBe('RESEND_API_KEY is not set');
    expect(seen).toHaveLength(0);
    expect(mailKeyPresent()).toBe(false);
    process.env['RESEND_API_KEY'] = '   ';
    expect(mailKeyPresent()).toBe(false);
  });
});

describe('resendMailer — failure, classified and redacted', () => {
  async function failureFor(status: number, body: string, headers: Record<string, string> = {}): Promise<MailError> {
    const { fetchImpl } = capture(() => new Response(body, { status, headers }));
    const error = await resendMailer({ from: 'a@agenteve.io', fetchImpl }).send(MAIL).catch((e: unknown) => e);
    if (!(error instanceof MailError)) throw new Error('expected a MailError');
    return error;
  }

  it('401/403 are fatal (the provider refused US); 429 and 5xx are retryable; 422 is neither', async () => {
    expect((await failureFor(401, '{}')).fatal).toBe(true);
    expect((await failureFor(403, '{}')).fatal).toBe(true);
    const limited = await failureFor(429, '{}', { 'retry-after': '2' });
    expect(limited.retryable).toBe(true);
    expect(limited.retryAfterMs).toBe(2_000);
    expect((await failureFor(503, '{}')).retryable).toBe(true);
    const invalid = await failureFor(422, '{"message":"invalid to"}');
    expect(invalid.fatal).toBe(false);
    expect(invalid.retryable).toBe(false);
    expect(invalid.status).toBe(422);
  });

  it('an error body that echoes the key, the header, the address or a token is redacted', async () => {
    const echo =
      `{"message":"bad key ${FAKE_KEY}","request":{"Authorization":"Bearer ${FAKE_KEY}",` +
      `"to":"reader@example.com","link":"https://agenteve.io/api/follow/confirm?token=SECRETSECRETSECRET123"}}`;
    const error = await failureFor(401, echo);
    for (const leaked of [FAKE_KEY, 'reader@example.com', 'SECRETSECRETSECRET123']) {
      expect(error.message).not.toContain(leaked);
      expect(String(error.stack)).not.toContain(leaked);
      expect(describeMailFailure(error)).not.toContain(leaked);
    }
    expect(error.message).toContain(MAIL_REDACTED);
  });

  it('a network failure is retryable, and its message is redacted too', async () => {
    const fetchImpl = (() => Promise.reject(new Error(`connect ECONNREFUSED while sending to reader@example.com with ${FAKE_KEY}`))) as unknown as typeof fetch;
    const error = await resendMailer({ from: 'a@agenteve.io', fetchImpl }).send(MAIL).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailError);
    expect((error as MailError).retryable).toBe(true);
    expect((error as MailError).message).not.toContain(FAKE_KEY);
    expect((error as MailError).message).not.toContain('reader@example.com');
  });

  it('a hung provider is abandoned at the timeout and reported retryable', async () => {
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      })) as unknown as typeof fetch;
    const error = await resendMailer({ from: 'a@agenteve.io', fetchImpl, timeoutMs: 20 }).send(MAIL).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailError);
    expect((error as MailError).retryable).toBe(true);
  });
});

describe('redactMailSecrets', () => {
  it('removes a key-shaped string this process never held', () => {
    const other = ['re', 'AAAABBBBCCCCDDDD'].join('_');
    expect(redactMailSecrets(`upstream said ${other}`)).not.toContain(other);
  });

  it('removes the live key by literal match even when it has no recognisable shape', () => {
    const shapeless = ['COMPACT', 'MAIL', 'CREDENTIAL', 'ZZZZ9999'].join('_');
    process.env['RESEND_API_KEY'] = shapeless;
    expect(redactMailSecrets(`rejected ${shapeless} at 09:00`)).not.toContain(shapeless);
  });

  it('removes addresses and link tokens, which are private rather than secret', () => {
    const clean = redactMailSecrets('to someone+tag@mail.example.org via ?token=abcdefghijklmnop');
    expect(clean).not.toContain('someone+tag@mail.example.org');
    expect(clean).not.toContain('abcdefghijklmnop');
  });
});

describe('pacedMailer — one gate for the whole process', () => {
  it('serialises sends and spaces them by the interval, whatever the callers do', async () => {
    let now = 0;
    const sleeps: number[] = [];
    const order: string[] = [];
    const inner: Mailer = {
      send: (mail) => {
        order.push(mail.to);
        return Promise.resolve({ id: null });
      },
    };
    const paced = pacedMailer(inner, {
      intervalMs: 600,
      nowMs: () => now,
      sleep: (ms) => {
        sleeps.push(ms);
        now += ms;
        return Promise.resolve();
      },
    });
    await Promise.all(['a', 'b', 'c'].map((to) => paced.send({ ...MAIL, to: `${to}@example.com` })));
    expect(order).toEqual(['a@example.com', 'b@example.com', 'c@example.com']);
    expect(sleeps).toEqual([600, 600]);
  });

  it('a failed send does not wedge the gate for the next one', async () => {
    let calls = 0;
    const inner: Mailer = {
      send: () => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve({ id: 'ok' });
      },
    };
    const paced = pacedMailer(inner, { intervalMs: 0, nowMs: () => 0, sleep: () => Promise.resolve() });
    await expect(paced.send(MAIL)).rejects.toThrow('boom');
    await expect(paced.send(MAIL)).resolves.toEqual({ id: 'ok' });
  });
});
