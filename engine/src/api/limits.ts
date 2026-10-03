/**
 * The ONE place wall-clock rate limits live.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **These numbers are deliberately NOT derived from `tickSeconds()`.**
 *
 * Everything else in this codebase is in ticks or derived from the tick, and
 * `scripts/scale-audit.mjs` fails the build on any duration that is neither. This
 * file is whitelisted there, with the reason recorded in the script: **a rate
 * limit protects the host, not the game.** A limiter that compressed with the tick
 * would let 150× `turbo` mean 150× the real requests per second against the same
 * CPU, which is the opposite of what a limiter is for.
 *
 * The inverse hazard is the one TESTING.md §1.1 names and it is why this file
 * exists at all: at 30× `fast`, a legitimate agent making one request per tick
 * makes one every 10 s rather than every 5 min, and a limiter tuned for `prod`
 * reads that as a flood. **So the per-tick allowances below are sized for the
 * fastest speed we run, not the slowest**, and the audit's own comment records
 * that this is by design rather than by omission.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * SEC-5 is the other half of this file: limiting by the wrong header means either
 * no limiting at all (every request looks like a different client) or limiting the
 * whole world as one client (every request looks like Cloudflare). Both fail
 * silently and in opposite directions, so the header is *asserted*, not assumed.
 */

import type { WallSeconds } from '../identity/index.js';
import { wallSeconds } from '../identity/index.js';

// ── The real client ─────────────────────────────────────────────────────────

/**
 * The only header this deployment trusts for a client address.
 *
 * Cloudflare sets it and — critically — **overwrites** it, so unlike
 * `X-Forwarded-For` it cannot be spoofed by the client when the request really did
 * arrive through the edge. `X-Forwarded-For` is deliberately never read: it is a
 * client-supplied list, and treating its first element as the client is the
 * classic bypass.
 */
export const CLIENT_IP_HEADER = 'cf-connecting-ip';

/** Why an address could not be established. Distinguishable, per SEC-1's habit. */
export const IP_REFUSAL = {
  HEADER_MISSING: 'CLIENT_IP_HEADER_MISSING',
  HEADER_MALFORMED: 'CLIENT_IP_HEADER_MALFORMED',
  SOCKET_UNKNOWN: 'CLIENT_IP_SOCKET_UNKNOWN',
} as const;

export type IpRefusal = (typeof IP_REFUSAL)[keyof typeof IP_REFUSAL];

export interface ClientAddress {
  readonly ip: string;
  /** True when it came from {@link CLIENT_IP_HEADER}; false when from the socket. */
  readonly viaEdge: boolean;
}

/**
 * IPv4 dotted quad, or something that looks enough like IPv6 to be a key.
 *
 * The point is not to validate an address — it is to refuse a *bucket key* that an
 * attacker controls the cardinality of. An unvalidated header value is an
 * unbounded key space, which turns the limiter's own map into scar #3.
 */
const IP_GRAMMAR = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F:]{2,45})$/;

export interface ClientAddressOptions {
  /**
   * True in production, where nginx sits behind Cloudflare and the vhost sets
   * {@link CLIENT_IP_HEADER}. **Then the header is mandatory**: a request that
   * reaches the app without it did not come through the edge, and serving it
   * unlimited is the "no limiting at all" failure.
   */
  readonly trustEdge: boolean;
}

/**
 * Establish the real client address, or refuse.
 *
 * Failing closed is the whole design. The tempting alternative — fall back to the
 * socket address when the header is missing — is what silently limits the entire
 * internet as one client the day the vhost stops setting it, because behind
 * Cloudflare every socket address is Cloudflare's.
 */
export function clientAddress(
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
  socketAddress: string | undefined,
  options: ClientAddressOptions,
): { readonly ok: true; readonly value: ClientAddress } | { readonly ok: false; readonly reason: IpRefusal; readonly detail: string } {
  // Typed explicitly rather than inferred: Express's `IncomingHttpHeaders` indexes to
  // `any` under `noUncheckedIndexedAccess`, and an `any` flowing into a rate-limit
  // bucket key is exactly the value that must not be trusted.
  const raw: string | readonly string[] | undefined = headers[CLIENT_IP_HEADER];
  const header: string | undefined =
    typeof raw === 'string' ? raw : Array.isArray(raw) ? (raw[0] as string | undefined) : undefined;

  if (options.trustEdge) {
    if (header === undefined || header.length === 0) {
      return {
        ok: false,
        reason: IP_REFUSAL.HEADER_MISSING,
        detail:
          `this deployment sits behind Cloudflare and requires the ${CLIENT_IP_HEADER} header. ` +
          'Without it every caller would share one rate-limit bucket, so the request is refused rather than served unlimited.',
      };
    }
    if (!IP_GRAMMAR.test(header)) {
      return {
        ok: false,
        reason: IP_REFUSAL.HEADER_MALFORMED,
        detail: `${CLIENT_IP_HEADER} is not an IP address.`,
      };
    }
    return { ok: true, value: { ip: header, viaEdge: true } };
  }

  // Direct exposure (tests, local dev, a sim behind nothing). The header is still
  // honoured when present so a probe can exercise SEC-5 without an edge.
  if (header !== undefined && IP_GRAMMAR.test(header)) {
    return { ok: true, value: { ip: header, viaEdge: true } };
  }
  if (socketAddress === undefined || socketAddress.length === 0) {
    return {
      ok: false,
      reason: IP_REFUSAL.SOCKET_UNKNOWN,
      detail: 'the connection has no remote address, so the request cannot be attributed to a caller.',
    };
  }
  // Node reports IPv4-mapped IPv6 for a v4 client on a dual-stack socket. Two
  // spellings of one address would be two buckets for one caller.
  const normalised = socketAddress.startsWith('::ffff:') ? socketAddress.slice(7) : socketAddress;
  return { ok: true, value: { ip: normalised, viaEdge: false } };
}

// ── The connector's accounts ────────────────────────────────────────────────

/**
 * ★ The bucket key for a request Agent Eve's own chat connector made for one ACCOUNT: `acct:<uuid>`.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * The connector reaches this process over loopback, so behind it every chat player is the same client
 * — `127.0.0.1` — and the limits below would bind them all together: most sharply the enrolment quota,
 * six identities a day for the whole of ChatGPT and Claude. A request whose gateway header verified
 * (`api/gateway.ts`: a MAC under the shared secret, from a loopback peer, inside the skew window) is
 * metered per account instead, on **every** bucket here: each route and the quota.
 *
 * The key space stays bounded, and not by trust: only a request the MAC verified can mint an `acct:`
 * key, the account half is a UUID the verifier has already shape-checked (so `acct:` can never collide
 * with an address — no IP contains a colon followed by that grammar), and {@link MAX_TRACKED_CLIENTS}
 * bounds the map either way. A4 still holds without any of this — speed buys nothing in a tick-batched
 * world — so the limiter remains what it always was: protection for the host.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const ACCOUNT_KEY_PREFIX = 'acct:';

/** A verified connector account id — a lowercase UUID — as a bucket key. */
const VERIFIED_ACCOUNT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** `acct:<uuid>`. Refuses anything that is not a verified-shape account id, so no header text reaches a key. */
export function accountKey(accountId: string): string {
  if (!VERIFIED_ACCOUNT.test(accountId)) throw new Error('an account bucket key needs a lowercase UUID');
  return `${ACCOUNT_KEY_PREFIX}${accountId}`;
}

// ── The buckets ─────────────────────────────────────────────────────────────

export interface Allowance {
  /** Requests permitted per window. */
  readonly burst: number;
  /** Window length, in wall-clock seconds. */
  readonly windowSeconds: number;
}

/**
 * Per-route allowances, per client address — or per connector account, `acct:<uuid>`, when the
 * request's gateway header verified ({@link accountKey}).
 *
 * Sized for `fast` (10 s/tick), the speed the agent suite runs at, so a legitimate
 * agent observing once and acting once per tick is nowhere near any of them. Each
 * one is *(calibrate)* in SPEC §17's sense.
 */
export const RATE_LIMITS = {
  /**
   * Enrolment is the scar #3 surface: it is the one endpoint that *creates*
   * permanent rows, and High Water's was unbounded. Tight on purpose, and the
   * seat cap (`seats.ts`) is the second, independent bound.
   */
  // Raised from 3 after a live playtest spent **54 minutes and four attempts** getting an
  // identity. Shape refusals were already free — `meter` deliberately runs after
  // validation — so that was not the cause. The cause is that a HANDLE COLLISION is
  // charged, correctly, because trying handles is enumeration and a free path would hand
  // an attacker the whole namespace. With a burst of three that meant three guesses per
  // ten minutes, and there is no way to test a handle without spending one.
  //
  // Eight still bounds row creation hard, and the seat cap is a second independent bound.
  // It buys a newcomer enough guesses to get in on its first sitting, which matters more
  // than it sounds: enrolment is the first thing every agent meets, and A15 says the door
  // must stay free — a door that takes an hour is a door priced in patience.
  enroll: { burst: 8, windowSeconds: 600 },
  /** Reads are cheap and memoised per `(principal, tick)`; generous. */
  observe: { burst: 240, windowSeconds: 60 },
  /** Writes are bounded by the action budget anyway; this only protects the host. */
  act: { burst: 120, windowSeconds: 60 },
  /** A5′'s sensor. Loose enough to be usable, bounded so it cannot be a firehose. */
  discrepancy: { burst: 12, windowSeconds: 60 },
  /** Operators and uptime checks. */
  health: { burst: 60, windowSeconds: 60 },
} as const satisfies Record<string, Allowance>;

export type RouteName = keyof typeof RATE_LIMITS;

/**
 * ★ **IDENTITIES MINTED per client address per day** — a QUOTA, and the one limit in this file
 * charged on SUCCESS rather than on the attempt.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `RATE_LIMITS.enroll` meters ATTEMPTS that reach state: eight per ten minutes, which is
 * 1,152 identities a day from one address against a world of 300 seats. Enrolment is free
 * and must stay free (A15), so the burst cannot be the bound on how many identities one
 * caller mints — it was raised to eight precisely so a newcomer guessing at handles gets in
 * on its first sitting. This is the second, slower bound: **six minted identities per
 * address per 24 hours**, alongside the burst rather than instead of it.
 *
 * Charged only when an identity is actually minted, never for a refused handle or a malformed
 * field, so it can never cost a newcomer the patience the burst was raised to protect. It
 * protects the seat cap, not the game: a seat is kept by play (`seats.ts`), and this caps how
 * fast one address can turn new keys into seats that have to be waited out. The operator
 * allowlist exempts it, exactly as it exempts every route.
 *
 * Behind the chat connector the "address" is the ACCOUNT ({@link accountKey}): six a day per account,
 * which the connector's own one-principal-per-account rule makes moot, rather than six a day for
 * every chat player at once.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const ENROLMENT_QUOTA: Allowance = { burst: 6, windowSeconds: 86_400 };

/** The bucket-key prefix for {@link ENROLMENT_QUOTA}. Not a route, so it cannot collide with one. */
const QUOTA_KEY = 'enroll-quota';

/** Signature freshness is 60 s + 30 s skew; a nonce must outlive that (SEC-1). */
export const REPLAY_STORE_LIMITS = {
  retention: wallSeconds(120),
  /** Per key, per generation. A flood costs the flooder and nobody else. */
  perKeyCap: 512,
  /** Bounded by seats: only a verified keyid ever gets a bucket. */
  maxKeys: 4096,
} as const;

/** Largest body accepted on any endpoint, in bytes. Not a duration. */
export const MAX_BODY_BYTES = 64 * 1024;

/**
 * Buckets held at once. Bounded because the key space is client-controlled: an
 * attacker with a /16 has 65k addresses, and a map that grows one entry per
 * address is scar #3 wearing a limiter's clothes.
 */
export const MAX_TRACKED_CLIENTS = 20_000;

interface Window {
  count: number;
  /** Wall-clock second the window opened. */
  openedAt: WallSeconds;
}

export interface LimitVerdict {
  readonly allowed: boolean;
  /** Seconds until the window rolls. Sent as `Retry-After`. */
  readonly retryAfterSeconds: number;
  readonly remaining: number;
}

/**
 * Fixed-window counters, one per `(route, client)`.
 *
 * A fixed window is chosen over a sliding log on purpose: a sliding log stores one
 * timestamp per request, which is an unbounded array per client — the exact hazard
 * this class exists to bound. The cost is a 2× burst across a window boundary,
 * which is acceptable for something protecting a 12-core box.
 *
 * **Wall-clock seconds are injected, never read.** `Date.now` is banned (DET-7),
 * and this class taking `now` is what lets the rate-limit tests be deterministic
 * rather than sleepy.
 */
export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly limits: Readonly<Record<string, Allowance>> = RATE_LIMITS,
    private readonly maxClients: number = MAX_TRACKED_CLIENTS,
    /**
     * Clients (by the same key `check` receives — a real IP) that bypass EVERY limit.
     * Default empty, so production is unchanged; an operator sets it (env) only for a
     * controlled test window. This is why Gate 3's probe fleet could not onboard: a
     * dozen probes behind ONE egress IP shared the enrol burst of 3/10min. It is safe
     * because the limiter guards the HOST, not the game — A4 already makes speed powerless
     * (actions are tick-batched) — so exempting a trusted operator IP changes no outcome,
     * only who may hammer the box. It is NOT a weakening of the limiter for anyone else
     * (scar #3): an unlisted client is metered exactly as before.
     */
    private readonly allowlist: ReadonlySet<string> = new Set(),
    /** Identities minted per client per window. See {@link ENROLMENT_QUOTA}. */
    private readonly quota: Allowance = ENROLMENT_QUOTA,
  ) {}

  /** Buckets currently held. Asserted by the soak test: this is the bound. */
  get tracked(): number {
    return this.windows.size;
  }

  /** The quota this limiter enforces, for the refusal text. */
  get enrolmentQuota(): Allowance {
    return this.quota;
  }

  /**
   * Would minting one more identity for this client stay inside {@link ENROLMENT_QUOTA}?
   *
   * **Spends nothing.** The quota is charged by {@link chargeQuota} after the identity exists,
   * so a request refused for any other reason — a taken handle, a full world — costs no part
   * of it.
   */
  quotaVerdict(client: string, now: WallSeconds): LimitVerdict {
    if (this.allowlist.has(client)) {
      return { allowed: true, retryAfterSeconds: 0, remaining: Number.MAX_SAFE_INTEGER };
    }
    const existing = this.windows.get(`${QUOTA_KEY}::${client}`);
    if (existing === undefined) return { allowed: true, retryAfterSeconds: 0, remaining: this.quota.burst };
    const age = now - existing.openedAt;
    if (age >= this.quota.windowSeconds) return { allowed: true, retryAfterSeconds: 0, remaining: this.quota.burst };
    if (existing.count >= this.quota.burst) {
      return { allowed: false, retryAfterSeconds: Math.max(1, this.quota.windowSeconds - age), remaining: 0 };
    }
    return { allowed: true, retryAfterSeconds: 0, remaining: this.quota.burst - existing.count };
  }

  /** Charge one minted identity against this client's quota. Call only once it exists. */
  chargeQuota(client: string, now: WallSeconds): void {
    if (this.allowlist.has(client)) return;
    const key = `${QUOTA_KEY}::${client}`;
    const existing = this.windows.get(key);
    if (existing === undefined) {
      this.admit(key, now);
      return;
    }
    if (now - existing.openedAt >= this.quota.windowSeconds) {
      existing.count = 1;
      existing.openedAt = now;
      return;
    }
    existing.count += 1;
  }

  check(route: string, client: string, now: WallSeconds): LimitVerdict {
    // A trusted, operator-listed client is never metered. Kept above the route lookup so
    // an allowlisted source is exempt even on a route that would otherwise fail closed.
    if (this.allowlist.has(client)) {
      return { allowed: true, retryAfterSeconds: 0, remaining: Number.MAX_SAFE_INTEGER };
    }
    const allowance = this.limits[route];
    if (allowance === undefined) {
      // An unlimited route is a route somebody forgot. Fail closed rather than
      // silently serving without a bound.
      return { allowed: false, retryAfterSeconds: 1, remaining: 0 };
    }
    const key = `${route}::${client}`;
    const existing = this.windows.get(key);

    if (existing === undefined) {
      this.admit(key, now);
      return { allowed: true, retryAfterSeconds: 0, remaining: allowance.burst - 1 };
    }
    const age = now - existing.openedAt;
    if (age >= allowance.windowSeconds) {
      existing.count = 1;
      existing.openedAt = now;
      return { allowed: true, retryAfterSeconds: 0, remaining: allowance.burst - 1 };
    }
    if (existing.count >= allowance.burst) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, allowance.windowSeconds - age),
        remaining: 0,
      };
    }
    existing.count += 1;
    return { allowed: true, retryAfterSeconds: 0, remaining: allowance.burst - existing.count };
  }


  /**
   * Drop windows that have rolled. Called on admission pressure rather than on a
   * timer, because a timer is another wall-clock dependency and this map is only
   * ever too big at the moment somebody is trying to add to it.
   */
  private admit(key: string, now: WallSeconds): void {
    if (this.windows.size >= this.maxClients) {
      this.prune(now);
      if (this.windows.size >= this.maxClients) {
        // Still full: evict in insertion order, which is deterministic. Evicting
        // the oldest entry is weaker protection for one client and bounded memory
        // for the host, and the host is what this file protects.
        const oldest = this.windows.keys().next();
        if (oldest.done !== true) this.windows.delete(oldest.value);
      }
    }
    this.windows.set(key, { count: 1, openedAt: now });
  }

  /**
   * Drop every window that has rolled, each judged by its OWN length.
   *
   * It used to drop anything older than the longest route window, which was correct while every
   * bucket was a route of ten minutes or less. A daily quota judged against a ten-minute cut-off
   * would be forgotten the first time the map came under pressure — a quota that resets when an
   * attacker floods the table is a quota the attacker controls.
   */
  private prune(now: WallSeconds): void {
    const longest = Math.max(this.quota.windowSeconds, ...Object.values(this.limits).map((l) => l.windowSeconds));
    for (const [key, window] of this.windows) {
      const name = key.slice(0, key.indexOf('::'));
      const length = name === QUOTA_KEY ? this.quota.windowSeconds : (this.limits[name]?.windowSeconds ?? longest);
      if (now - window.openedAt >= length) this.windows.delete(key);
    }
  }
}

// ── Follow by email ─────────────────────────────────────────────────────────
//
// ══════════════════════════════════════════════════════════════════════════
// **MAIL IS THE ONE OUTPUT OF THIS PROCESS THAT LANDS SOMEWHERE WE DO NOT CONTROL**, and
// that is why every number below is here, in wall-clock time, rather than in ticks.
//
// Scar #12 is High Water's open relay: an endpoint that let anyone put a real email in an
// arbitrary inbox, unlimited, with an attacker-chosen name unescaped in it. What a mail limit
// protects is a stranger's inbox and the sending domain's reputation, and mailbox providers
// measure both in REAL days. A ceiling that compressed with the tick would hand a `turbo`
// world 150 days of mail per day — the inverse of the hazard the scale audit names for a
// Dispatch, and the same reason `RATE_LIMITS` above does not scale.
//
// The consequence is deliberate and stated: at `prod` a Reckoning is a day and a follower gets
// one recap a day; at `rehearsal` a Reckoning is ~4.8 hours and the SAME daily ceiling covers
// a fifth as many followers. A faster world runs out of mail sooner. That is the correct
// direction for a limit that exists to protect people who never asked to be part of a test.
// ══════════════════════════════════════════════════════════════════════════

/**
 * The follow routes' four buckets. Kept OUT of {@link RATE_LIMITS} on purpose: the main
 * limiter carries the operator's probe-fleet allowlist, and an exemption granted so a test
 * fleet can enrol must not also let it mail strangers.
 *
 * Each is *(calibrate)*.
 */
export const FOLLOW_LIMITS = {
  /** `POST /api/follow`, per client IP. Every accepted one may put a confirmation in an inbox. */
  'follow-ip': { burst: 10, windowSeconds: 3_600 },
  /** The two emailed links — confirm and unsubscribe, RFC 8058's one-click POST included — per IP. */
  'follow-link': { burst: 60, windowSeconds: 600 },
  /**
   * Confirmation emails to ONE address, across every handle. The victim-inbox bound: an
   * attacker naming one stranger's address against three hundred handles gets five emails
   * into it per day, not three hundred. Five rather than three so a new fan can follow a few
   * of the house's characters in one sitting; the sixth confirmation waits for tomorrow.
   */
  'follow-email': { burst: 5, windowSeconds: 86_400 },
  /**
   * Confirmation emails naming ONE handle, across every address. Loose enough for a house
   * character a launch spike makes popular, tight enough that one hostile handle cannot spend
   * the whole day's ceiling before anyone else is served.
   */
  'follow-handle': { burst: 100, windowSeconds: 3_600 },
} as const satisfies Record<string, Allowance>;

export type FollowBucket = keyof typeof FOLLOW_LIMITS;

/**
 * Emails sent per UTC day, confirmations and recaps together, unless `COMPACT_MAIL_DAILY_LIMIT`
 * says otherwise. Counted DURABLY (`follow_mail_day`) rather than in memory, because this
 * service has been measured restarting sixty times in a day and an in-memory daily counter
 * would reset with each one.
 */
export const MAIL_DAILY_CEILING_DEFAULT = 2_000;

/**
 * The share of the daily ceiling recaps may use, in bps. The rest is held for confirmations, so
 * a night with many followers cannot lock every newcomer out until tomorrow.
 */
export const RECAP_CEILING_SHARE_BPS = 9_000;

/** Active follows one address may hold, unless `COMPACT_FOLLOW_MAX_PER_EMAIL` says otherwise. */
export const FOLLOW_MAX_PER_EMAIL_DEFAULT = 10;

/** A second confirmation for the SAME (handle, address) is not sent sooner than this. */
export const FOLLOW_CONFIRM_COOLDOWN_MS = 10 * 60 * 1_000;

/** How long a confirmation link works. Expired PENDING rows are deleted, not kept. */
export const FOLLOW_CONFIRM_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

/** One provider call may take this long before it is abandoned and retried later. */
export const MAIL_SEND_TIMEOUT_MS = 15_000;

/**
 * The gap between two provider calls. Resend's default ceiling is ten requests a second per
 * TEAM — shared by every key in the account, and this account is shared with other projects —
 * so this process stays under a fifth of it. Every send goes through one pacer, so the
 * confirmations and the recaps share the allowance instead of racing each other into a 429.
 */
export const MAIL_SEND_INTERVAL_MS = 600;

/** After a recap run that left anyone unsent — an outage, a 429 — try again after this. */
export const RECAP_RETRY_MS = 15 * 60 * 1_000;

/** One UTC day. The ceiling's window, and what `Retry-After` counts down to. */
export const MS_PER_UTC_DAY = 86_400_000;

/** A spent ceiling resumes this long after UTC midnight, so the reset has certainly happened. */
export const CEILING_RESUME_GRACE_MS = 60_000;
