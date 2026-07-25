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

// ── The buckets ─────────────────────────────────────────────────────────────

export interface Allowance {
  /** Requests permitted per window. */
  readonly burst: number;
  /** Window length, in wall-clock seconds. */
  readonly windowSeconds: number;
}

/**
 * Per-route allowances, per client address.
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
  enroll: { burst: 3, windowSeconds: 600 },
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
  ) {}

  /** Buckets currently held. Asserted by the soak test: this is the bound. */
  get tracked(): number {
    return this.windows.size;
  }

  check(route: string, client: string, now: WallSeconds): LimitVerdict {
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

  private prune(now: WallSeconds): void {
    const longest = Math.max(...Object.values(this.limits).map((l) => l.windowSeconds));
    for (const [key, window] of this.windows) {
      if (now - window.openedAt >= longest) this.windows.delete(key);
    }
  }
}
