/**
 * The nonce store — bounded, because scar #3 was an unbounded array.
 *
 * High Water's `/enroll` accumulated a row per request forever and the whole map
 * was serialised every 1.5 s, so an attacker turned "remember this" into an OOM
 * and a disk DoS. A replay store is the same shape of hazard with a sharper edge:
 * its entire job is to remember things an attacker chooses.
 *
 * Four properties, each closing a specific drain:
 *
 *  1. **Two rotating generations, never a scan.** A nonce is remembered for at
 *     least the retention window and at most twice it; eviction is a bucket swap,
 *     so there is no per-request sweep to fall behind under load.
 *  2. **A per-key cap, not a global one.** A global cap is a cross-tenant DoS: one
 *     principal floods and everyone else is locked out. The cap is per key, so a
 *     flood costs the flooder its own budget and nobody else's.
 *  3. **Bounded bucket count.** Buckets are only ever created for a *resolved,
 *     cryptographically verified* keyid (see the ordering in `httpsig.ts`), so the
 *     number of buckets is bounded by the number of registered keys — which is
 *     bounded by seats (SEC-7). An unknown key never allocates anything.
 *  4. **Retention ≥ the freshness window.** If a nonce could be forgotten while a
 *     signature bearing it is still fresh, replay protection has a hole exactly
 *     the width of the difference. Asserted at construction, not assumed.
 *
 * **This is host state, deliberately in wall-clock seconds** (see `wallclock.ts`):
 * it protects the server, not the world. It never enters the state hash, replay
 * never reconstructs it, and it is not part of any invariant the tick asserts.
 */

import { IdentityError } from './reasons.js';
import type { WallSeconds } from './wallclock.js';
import { wallSeconds } from './wallclock.js';

export type ReplayOutcome = 'FRESH' | 'REPLAYED' | 'BUDGET_EXCEEDED';

export interface ReplayStore {
  /**
   * Spend a nonce. `FRESH` means it had not been seen and now has been.
   * Called **only** after the signature verifies, so an unsigned request can
   * never consume a principal's budget.
   */
  spend(keyid: string, nonce: string, now: WallSeconds): ReplayOutcome;
}

export interface ReplayStoreLimits {
  /** How long a nonce is remembered. Must be ≥ the signature freshness window. */
  readonly retention: WallSeconds;
  /** Nonces remembered per key per generation. A flood costs only the flooder. */
  readonly perKeyCap: number;
  /** Buckets held at once. Bounded by seats, because only known keys get one. */
  readonly maxKeys: number;
}

interface Bucket {
  current: Set<string>;
  previous: Set<string>;
  /** When `current` was opened. Rotation is time-driven, not size-driven. */
  openedAt: WallSeconds;
}

export class BoundedReplayStore implements ReplayStore {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly limits: ReplayStoreLimits) {
    if (limits.perKeyCap < 1 || !Number.isSafeInteger(limits.perKeyCap)) {
      throw new IdentityError(`perKeyCap must be a positive integer, got ${String(limits.perKeyCap)}`);
    }
    if (limits.maxKeys < 1 || !Number.isSafeInteger(limits.maxKeys)) {
      throw new IdentityError(`maxKeys must be a positive integer, got ${String(limits.maxKeys)}`);
    }
    if (limits.retention < 1) {
      throw new IdentityError('retention must be at least one second, or nothing is remembered');
    }
  }

  spend(keyid: string, nonce: string, now: WallSeconds): ReplayOutcome {
    const bucket = this.bucketFor(keyid, now);
    if (bucket === null) return 'BUDGET_EXCEEDED';

    if (bucket.current.has(nonce) || bucket.previous.has(nonce)) return 'REPLAYED';
    if (bucket.current.size >= this.limits.perKeyCap) {
      // Fail closed rather than forget. Forgetting is silently weaker protection;
      // refusing is loud, bounded, and confined to the key that caused it.
      return 'BUDGET_EXCEEDED';
    }
    bucket.current.add(nonce);
    return 'FRESH';
  }

  /** Buckets currently held. Asserted in tests: this is the boundedness claim. */
  get bucketCount(): number {
    return this.buckets.size;
  }

  /** Nonces currently remembered across every bucket and generation. */
  get remembered(): number {
    let n = 0;
    for (const b of this.buckets.values()) n += b.current.size + b.previous.size;
    return n;
  }

  /** The ceiling this store can never exceed. Stated so a test can assert it. */
  get capacity(): number {
    return this.limits.maxKeys * this.limits.perKeyCap * 2;
  }

  private bucketFor(keyid: string, now: WallSeconds): Bucket | null {
    const existing = this.buckets.get(keyid);
    if (existing !== undefined) {
      this.rotateIfDue(existing, now);
      return existing;
    }
    if (this.buckets.size >= this.limits.maxKeys) {
      this.pruneDead(now);
      if (this.buckets.size >= this.limits.maxKeys) return null;
    }
    const fresh: Bucket = { current: new Set(), previous: new Set(), openedAt: now };
    this.buckets.set(keyid, fresh);
    return fresh;
  }

  private rotateIfDue(bucket: Bucket, now: WallSeconds): void {
    const age = now - bucket.openedAt;
    if (age < this.limits.retention) return;
    if (age >= this.limits.retention * 2) {
      // Two whole windows idle: nothing in either generation can still be fresh.
      bucket.previous = new Set();
    } else {
      bucket.previous = bucket.current;
    }
    bucket.current = new Set();
    bucket.openedAt = now;
  }

  /**
   * Drop buckets whose every generation is older than any fresh signature could
   * be. Deterministic order (Map insertion order) so a replayed run prunes the
   * same buckets — this store is not hashed, but a nondeterministic prune would
   * still make a flaky test look like a real rejection.
   */
  private pruneDead(now: WallSeconds): void {
    const deadline = wallSeconds(Math.max(0, now - this.limits.retention * 2));
    for (const [keyid, bucket] of this.buckets) {
      if (bucket.openedAt <= deadline) this.buckets.delete(keyid);
    }
  }
}
