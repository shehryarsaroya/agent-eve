/**
 * The mailer: one HTTP call to Resend, and the rule that outranks everything else here.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **NO KEY VALUE MAY EVER LEAVE THIS FILE** — the same rule `cast/transport.ts` lives by.
 *
 * `RESEND_API_KEY` is read at one place, on each send, held in one local, and written into
 * exactly one header. It is never returned, never stored on an object a caller can reach,
 * never interpolated into a message and never logged. Every string this module hands back —
 * every error included — goes through {@link redactMailSecrets} first, because the leak that
 * actually happens is a provider's 401 body echoing the Authorization header into an error
 * that becomes a log line.
 *
 * The redactor also removes **recipient addresses** and **link tokens**. Neither is a
 * credential to Resend, but an address is a private fact this feature promised to keep
 * private, and a token in a log is a working unsubscribe link in a log.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * **The transport is injected because the tests must not touch the network.** Nothing in
 * this repo sends real mail or needs a real key: the suite drives this module through
 * `fetchImpl` and through a local HTTP server that speaks Resend's shape.
 */

import { redactSecrets } from '../../cast/transport.js';
import { MAIL_SEND_INTERVAL_MS, MAIL_SEND_TIMEOUT_MS } from '../limits.js';

/** Resend's send endpoint (`POST /emails`). Overridable only by constructor, never by env. */
export const RESEND_EMAILS_URL = 'https://api.resend.com/emails';

/** One spelling of a redaction, so a test can grep for it. */
export const MAIL_REDACTED = '[redacted]';

export interface OutboundMail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  /** Extra headers — `List-Unsubscribe` and its RFC 8058 companion, and nothing else. */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * Resend's `Idempotency-Key`. A retry after a crash between "sent" and "recorded as sent"
   * carries the same key, so the provider answers with the first send instead of a second
   * email — which is what makes the recap's exactly-once hold across a restart.
   */
  readonly idempotencyKey?: string;
}

export interface MailReceipt {
  /** The provider's id for the email, when it gave one. */
  readonly id: string | null;
}

export interface Mailer {
  send(mail: OutboundMail): Promise<MailReceipt>;
}

/**
 * Why a send failed, in the three shapes a caller acts on differently.
 *
 *   - `fatal` — the provider refused US (401/403: a bad or revoked key, an unverified
 *     domain). Every further send this run would fail identically, so a run stops.
 *   - `retryable` — try again later: 429, any 5xx, a timeout, a network failure.
 *   - neither — this one email was refused (400/422) and retrying it unchanged is pointless.
 */
export class MailError extends Error {
  readonly fatal: boolean;
  readonly retryable: boolean;
  /** Milliseconds the provider asked us to wait, from `Retry-After`, when it said. */
  readonly retryAfterMs: number | null;

  constructor(
    message: string,
    readonly status: number | null,
    options: { readonly fatal?: boolean; readonly retryable?: boolean; readonly retryAfterMs?: number | null } = {},
  ) {
    super(redactMailSecrets(message));
    this.name = 'MailError';
    this.fatal = options.fatal ?? false;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

/**
 * Remove anything that could be a credential, an address or a link token.
 *
 *   1. **The live key, by literal match**, read at call time and never retained.
 *   2. **Anything shaped like a Resend key** (`re_…`) — a key this process never held.
 *   3. **The cast's patterns** — `sk-…`, bearer tokens, `Authorization` values — because an
 *      error body that echoes a request header is the common leak, whatever the provider.
 *   4. **Email addresses** and **`token=` query values**, which are private rather than secret.
 */
export function redactMailSecrets(text: string): string {
  let out = text;
  const key = process.env['RESEND_API_KEY'];
  if (typeof key === 'string' && key.length >= 8) out = out.split(key).join(MAIL_REDACTED);
  out = out.replace(/\bre_[A-Za-z0-9_-]{8,}/g, MAIL_REDACTED);
  out = redactSecrets(out);
  out = out.replace(/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, '[email]');
  out = out.replace(/\b(token=)[A-Za-z0-9_-]{8,}/g, `$1${MAIL_REDACTED}`);
  return out;
}

/** A redacted, bounded, single-line description of any thrown thing. Safe to log. */
export function describeMailFailure(error: unknown, maxChars = 240): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const flat = redactMailSecrets(raw).replace(/\s+/g, ' ').trim();
  return flat.length <= maxChars ? flat : `${flat.slice(0, maxChars)}…`;
}

/**
 * Is a key configured? A PRESENCE test, which is the only fact about a key any caller may
 * learn. The value is read in {@link resendMailer}'s send path and nowhere else.
 */
export function mailKeyPresent(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const key = env['RESEND_API_KEY'];
  return typeof key === 'string' && key.trim().length > 0;
}

export interface ResendMailerOptions {
  /** The from-address, e.g. `Agent Eve <updates@agenteve.io>`. */
  readonly from: string;
  readonly url?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

/**
 * The real mailer. The key is read lazily, per send, so a rotated key needs no restart and a
 * mailer built before the environment loaded does not hold `undefined` forever.
 */
export function resendMailer(options: ResendMailerOptions): Mailer {
  const url = options.url ?? RESEND_EMAILS_URL;
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? MAIL_SEND_TIMEOUT_MS;

  return {
    async send(mail: OutboundMail): Promise<MailReceipt> {
      const key = process.env['RESEND_API_KEY'];
      if (typeof key !== 'string' || key.trim().length === 0) {
        // The variable's NAME, and nothing about its value.
        throw new MailError('RESEND_API_KEY is not set', null, { fatal: true });
      }
      const headers: Record<string, string> = {
        // The one place the key is used. Never read back off this object.
        authorization: `Bearer ${key.trim()}`,
        'content-type': 'application/json',
        'user-agent': 'agent-eve-follow/1',
      };
      if (mail.idempotencyKey !== undefined) headers['idempotency-key'] = mail.idempotencyKey;

      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, timeoutMs);
      timer.unref();
      let status: number | null = null;
      try {
        const response = await doFetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            from: options.from,
            to: [mail.to],
            // A header value: no line breaks, whatever the caller built.
            subject: mail.subject.replace(/[\r\n]+/g, ' ').trim(),
            text: mail.text,
            html: mail.html,
            ...(mail.headers === undefined ? {} : { headers: mail.headers }),
          }),
          signal: controller.signal,
        });
        status = response.status;
        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new MailError(`the provider answered ${String(status)}: ${body.slice(0, 200)}`, status, {
            fatal: status === 401 || status === 403,
            retryable: status === 429 || status >= 500,
            retryAfterMs: retryAfterMs(response.headers.get('retry-after')),
          });
        }
        const payload: unknown = await response.json().catch(() => null);
        const id =
          typeof payload === 'object' && payload !== null && typeof (payload as Record<string, unknown>)['id'] === 'string'
            ? ((payload as Record<string, unknown>)['id'] as string)
            : null;
        return { id };
      } catch (error: unknown) {
        if (error instanceof MailError) throw error;
        // A socket that died, DNS, TLS, or our own timeout. All of them: try again later.
        throw new MailError(describeMailFailure(error), status, { retryable: true });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function retryAfterMs(header: string | null): number | null {
  if (header === null) return null;
  const seconds = Number(header.trim());
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1_000) : null;
}

export interface PacedMailerOptions {
  readonly intervalMs?: number;
  readonly nowMs: () => number;
  /** Injected so a test paces in zero real time. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** The real sleep. `unref`'d: a pending pause must never keep a shutting-down process alive. */
export function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms)).unref();
  });
}

/**
 * Serialise every send through one gate with a minimum spacing.
 *
 * The confirmations and the recaps are two independent callers, and each alone stays under
 * the provider's rate; together they would not. One pacer for the whole process is the only
 * arrangement in which "under the limit" is a property rather than a coincidence.
 */
export function pacedMailer(inner: Mailer, options: PacedMailerOptions): Mailer {
  const interval = options.intervalMs ?? MAIL_SEND_INTERVAL_MS;
  const sleep = options.sleep ?? realSleep;
  let tail: Promise<unknown> = Promise.resolve();
  let lastAt: number | null = null;

  return {
    send(mail: OutboundMail): Promise<MailReceipt> {
      const run = async (): Promise<MailReceipt> => {
        if (lastAt !== null) {
          const wait = lastAt + interval - options.nowMs();
          if (wait > 0) await sleep(wait);
        }
        try {
          return await inner.send(mail);
        } finally {
          lastAt = options.nowMs();
        }
      };
      const result = tail.then(run, run);
      // The chain must survive a failed send, or one refusal would wedge every later one.
      tail = result.catch(() => undefined);
      return result;
    },
  };
}
