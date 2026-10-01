/**
 * The follow lifecycle: request → confirm → (recaps) → unsubscribe.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE RESPONSE TO A REQUEST MUST NOT SAY WHAT THE ADDRESS ALREADY IS** — new, pending,
 * following, unsubscribed, or rate-limited — or `POST /api/follow` is an oracle for who
 * follows whom. Two halves, and the second is the one usually missed:
 *
 *   1. **The same status and the same body for every outcome.** Every per-address decision
 *      (cooldown, the per-address and per-handle buckets, "already following") is made
 *      AFTER the route has answered, and is silent.
 *   2. **The same time.** A request that sends mail takes a provider round trip; one that
 *      does not, does not. Measured from outside, that difference is the answer to "does
 *      this address already follow `vale`". So the route answers first and {@link request}
 *      does the work on a serial queue afterwards; the response time carries nothing.
 *
 * What CAN refuse synchronously is anything that is not about the address: a malformed
 * field, the caller's own IP bucket, an unknown handle (handles are public — the standings
 * list every one), the day's global ceiling, a full queue. None of them is enumeration.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Confirmation is double opt-in: nothing but the one confirmation email is ever sent to an
 * address that has not clicked its link, and the cap on follows per address is enforced at
 * the click — the only moment the reader is provably the inbox's owner — so even the cap
 * cannot be probed from the request route.
 */

import { wallSecondsFrom } from '../../identity/index.js';
import type { Clock } from '../../core/time.js';
import {
  FOLLOW_CONFIRM_COOLDOWN_MS,
  FOLLOW_CONFIRM_TTL_MS,
  FOLLOW_LIMITS,
  MS_PER_UTC_DAY,
  RateLimiter,
} from '../limits.js';
import { composeConfirmation, followLinks, type FollowLinks } from './compose.js';
import { IDENTITY_LABEL_DOMAINS } from './email.js';
import { describeMailFailure, type Mailer } from './mailer.js';
import type { FollowStore } from './store.js';
import { addressKey, hashToken, isTokenShaped, newFollowId, newLinkToken, unsubscribeTokenFor } from './tokens.js';

/** Requests queued behind the one being processed. A full queue is a 503, never a silent drop. */
export const MAX_QUEUED_REQUESTS = 256;

export interface FollowServiceOptions {
  readonly store: FollowStore;
  /** Null when sending is off; confirm and unsubscribe still work, so old links never break. */
  readonly mailer: Mailer | null;
  /** Why sending is off, in one operator-facing sentence. Null when it is on. */
  readonly offReason: string | null;
  /** The HMAC key for unsubscribe tokens. Required for sending; never logged. */
  readonly secret: string | null;
  readonly clock: Clock;
  readonly publicUrl: string;
  readonly dailyCeiling: number;
  readonly maxActivePerEmail: number;
  readonly limiter?: RateLimiter;
  /** Domains whose addresses are refused: identity labels and our own sending domain. */
  readonly refusedDomains?: readonly string[];
  readonly log?: (line: string) => void;
  /** Injectable for tests; default 32 random bytes. */
  readonly newToken?: () => string;
  readonly newId?: () => string;
}

export type ConfirmOutcome =
  | { readonly kind: 'confirmed'; readonly handle: string }
  | { readonly kind: 'already-following'; readonly handle: string }
  | { readonly kind: 'unsubscribed-earlier'; readonly handle: string }
  | { readonly kind: 'link-expired'; readonly handle: string }
  | { readonly kind: 'follow-cap'; readonly handle: string; readonly max: number }
  | { readonly kind: 'unknown-link' };

export type UnsubscribeOutcome =
  | { readonly kind: 'unsubscribed'; readonly handle: string }
  | { readonly kind: 'already-unsubscribed'; readonly handle: string }
  | { readonly kind: 'unknown-link' };

/** What one queued request turned into. Never returned to the caller who made it. */
export type RequestOutcome =
  | 'sent'
  | 'already-following'
  | 'cooldown'
  | 'address-bucket'
  | 'handle-bucket'
  | 'ceiling'
  | 'send-failed';

export interface FollowServiceCounters {
  readonly requestsAccepted: number;
  readonly confirmationsSent: number;
  readonly confirmationsFailed: number;
  readonly confirmed: number;
  readonly unsubscribed: number;
  readonly lastError: string | null;
}

/** `YYYY-MM-DD` in UTC. `toISOString` is fixed-format and locale-free (DET-4 allows it). */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Milliseconds until the next UTC midnight: when the day's mail ceiling resets. */
export function msUntilNextUtcDay(ms: number): number {
  const into = ((ms % MS_PER_UTC_DAY) + MS_PER_UTC_DAY) % MS_PER_UTC_DAY;
  return MS_PER_UTC_DAY - into;
}

/** The same, in whole seconds, for `Retry-After`. Never zero: zero would invite a hot loop. */
export function secondsUntilNextUtcDay(ms: number): number {
  return Math.max(1, Math.ceil(msUntilNextUtcDay(ms) / 1_000));
}

export class FollowService {
  readonly store: FollowStore;
  readonly links: FollowLinks;
  readonly publicUrl: string;
  readonly refusedDomains: readonly string[];
  private readonly mailer: Mailer | null;
  private readonly offReasonText: string | null;
  private readonly secret: string | null;
  private readonly clock: Clock;
  private readonly dailyCeiling: number;
  private readonly maxActivePerEmail: number;
  private readonly limiter: RateLimiter;
  private readonly log: (line: string) => void;
  private readonly newToken: () => string;
  private readonly newId: () => string;
  private tail: Promise<void> = Promise.resolve();
  private queued = 0;
  private closed = false;
  private counters = {
    requestsAccepted: 0,
    confirmationsSent: 0,
    confirmationsFailed: 0,
    confirmed: 0,
    unsubscribed: 0,
    lastError: null as string | null,
  };
  /** Outcomes of processed requests, newest last and bounded. For tests and for nothing else. */
  readonly outcomes: RequestOutcome[] = [];

  constructor(options: FollowServiceOptions) {
    this.store = options.store;
    this.mailer = options.mailer;
    this.secret = options.secret;
    this.offReasonText = options.offReason;
    this.clock = options.clock;
    this.publicUrl = options.publicUrl;
    this.links = followLinks(options.publicUrl);
    this.dailyCeiling = options.dailyCeiling;
    this.maxActivePerEmail = options.maxActivePerEmail;
    this.limiter = options.limiter ?? new RateLimiter(FOLLOW_LIMITS);
    this.refusedDomains = options.refusedDomains ?? IDENTITY_LABEL_DOMAINS;
    this.log = options.log ?? ((line) => process.stderr.write(`${line}\n`));
    this.newToken = options.newToken ?? newLinkToken;
    this.newId = options.newId ?? newFollowId;
  }

  /** True when a confirmation can actually be sent. */
  get sending(): boolean {
    return this.mailer !== null && this.secret !== null && !this.closed;
  }

  /** Why sending is off, or null when it is on. */
  get offReason(): string | null {
    if (this.sending) return null;
    return this.offReasonText ?? 'follow by email is not switched on for this world.';
  }

  /** The caller's own IP bucket. Synchronous, and about the caller rather than the address. */
  admitIp(ip: string): { readonly allowed: boolean; readonly retryAfterSeconds: number } {
    return this.limiter.check('follow-ip', ip, wallSecondsFrom(this.clock));
  }

  /** The link routes' IP bucket. */
  admitLink(ip: string): { readonly allowed: boolean; readonly retryAfterSeconds: number } {
    return this.limiter.check('follow-link', ip, wallSecondsFrom(this.clock));
  }

  /** Is there any of today's mail left? A peek: the slot is taken at the send, atomically. */
  async ceilingHasRoom(): Promise<boolean> {
    return (await this.store.mailReserved(utcDay(this.clock.nowMs()))) < this.dailyCeiling;
  }

  /** Seconds until the ceiling resets. */
  ceilingRetryAfterSeconds(): number {
    return secondsUntilNextUtcDay(this.clock.nowMs());
  }

  /**
   * Queue one request. Returns false only when the queue is full — the one refusal the route
   * may give after validation, and it says nothing about the address.
   */
  request(handle: string, email: string): boolean {
    if (!this.sending || this.queued >= MAX_QUEUED_REQUESTS) return false;
    this.queued += 1;
    this.counters.requestsAccepted += 1;
    this.tail = this.tail
      .then(async () => {
        const outcome = await this.process(handle, email);
        this.record(outcome);
      })
      .catch((error: unknown) => {
        // Never the address, never a token: `describeMailFailure` strips both.
        this.counters.lastError = describeMailFailure(error);
        this.log(`follow: a request failed and was dropped (non-fatal): ${this.counters.lastError}`);
        this.record('send-failed');
      })
      .finally(() => {
        this.queued -= 1;
      });
    return true;
  }

  /** Resolves when every queued request has been processed. */
  idle(): Promise<void> {
    return this.tail;
  }

  private record(outcome: RequestOutcome): void {
    this.outcomes.push(outcome);
    if (this.outcomes.length > 256) this.outcomes.shift();
  }

  private async process(handle: string, email: string): Promise<RequestOutcome> {
    const now = this.clock.nowMs();
    const existing = await this.store.find(handle, email);
    // Already following: the reader already gets every recap. Nothing to send, and nothing to say.
    if (existing !== null && existing.status === 'ACTIVE') return 'already-following';
    if (
      existing !== null &&
      existing.status === 'PENDING' &&
      existing.confirmSentMs !== null &&
      now - existing.confirmSentMs < FOLLOW_CONFIRM_COOLDOWN_MS
    ) {
      return 'cooldown';
    }
    const at = wallSecondsFrom(this.clock);
    if (!this.limiter.check('follow-email', addressKey(email), at).allowed) return 'address-bucket';
    if (!this.limiter.check('follow-handle', handle, at).allowed) return 'handle-bucket';

    const mailer = this.mailer;
    const secret = this.secret;
    if (mailer === null || secret === null) return 'send-failed';

    // The row first, then the mail: a link in an inbox must always name a token the store
    // knows. The reverse order can deliver a confirmation whose token was never written.
    const token = this.newToken();
    let id: string;
    if (existing === null) {
      id = this.newId();
      const inserted = await this.store.insertPending({
        id,
        handle,
        email,
        confirmTokenHash: hashToken(token),
        unsubscribeTokenHash: hashToken(unsubscribeTokenFor(secret, id)),
        nowMs: now,
      });
      if (!inserted) {
        // A concurrent writer got there first (another process); fall back to renewing it.
        const raced = await this.store.find(handle, email);
        if (raced === null || raced.status === 'ACTIVE') return 'already-following';
        id = raced.id;
        await this.store.renewPending(id, hashToken(token), now);
      }
    } else {
      id = existing.id;
      await this.store.renewPending(id, hashToken(token), now);
    }

    if (!(await this.store.reserveMail(utcDay(now), this.dailyCeiling))) {
      await this.store.clearConfirmSent(id);
      return 'ceiling';
    }
    const mail = composeConfirmation({
      handle,
      confirmUrl: this.links.confirm(token),
      recordUrl: this.links.record(handle),
      validDays: Math.round(FOLLOW_CONFIRM_TTL_MS / MS_PER_UTC_DAY),
    });
    try {
      await mailer.send({ to: email, ...mail, idempotencyKey: `follow-confirm-${hashToken(token).slice(0, 40)}` });
    } catch (error: unknown) {
      // The cooldown must not hold back the retry of a confirmation that never left.
      await this.store.clearConfirmSent(id).catch(() => undefined);
      this.counters.confirmationsFailed += 1;
      this.counters.lastError = describeMailFailure(error);
      this.log(`follow: a confirmation could not be sent (follow ${id}): ${this.counters.lastError}`);
      return 'send-failed';
    }
    this.counters.confirmationsSent += 1;
    return 'sent';
  }

  /**
   * The confirm link. Idempotent: a second click on a live follow is a success page, not an
   * error. Works with sending OFF — a link already in an inbox must keep meaning what it said.
   *
   * `startAfterReckoning` is the Reckoning that has already settled: the first recap this
   * follower receives is the next one, not yesterday's arriving at a random hour.
   */
  async confirm(token: unknown, startAfterReckoning: number | null): Promise<ConfirmOutcome> {
    if (!isTokenShaped(token)) return { kind: 'unknown-link' };
    const row = await this.store.byConfirmHash(hashToken(token));
    if (row === null) return { kind: 'unknown-link' };
    const handle = row.handle;
    switch (row.status) {
      case 'ACTIVE':
        return { kind: 'already-following', handle };
      case 'UNSUBSCRIBED':
        return { kind: 'unsubscribed-earlier', handle };
      case 'PENDING': {
        const now = this.clock.nowMs();
        if (row.confirmSentMs === null || now - row.confirmSentMs > FOLLOW_CONFIRM_TTL_MS) {
          return { kind: 'link-expired', handle };
        }
        if ((await this.store.countActive(row.email)) >= this.maxActivePerEmail) {
          return { kind: 'follow-cap', handle, max: this.maxActivePerEmail };
        }
        const activated = await this.store.activate(row.id, now, startAfterReckoning);
        if (!activated) return { kind: 'already-following', handle };
        this.counters.confirmed += 1;
        return { kind: 'confirmed', handle };
      }
    }
  }

  /** The unsubscribe link, and RFC 8058's one-click POST. Idempotent, and never needs mail. */
  async unsubscribe(token: unknown): Promise<UnsubscribeOutcome> {
    if (!isTokenShaped(token)) return { kind: 'unknown-link' };
    const row = await this.store.byUnsubscribeHash(hashToken(token));
    if (row === null) return { kind: 'unknown-link' };
    if (row.status === 'UNSUBSCRIBED') return { kind: 'already-unsubscribed', handle: row.handle };
    await this.store.unsubscribe(row.id, this.clock.nowMs());
    this.counters.unsubscribed += 1;
    return { kind: 'unsubscribed', handle: row.handle };
  }

  counts(): FollowServiceCounters {
    return { ...this.counters };
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.tail;
  }
}
