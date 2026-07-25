/**
 * Idempotency keys (PROP-W2), bounded.
 *
 * "Replaying an action with the same key is a no-op returning the original
 * result." Two things about that sentence needed a decision, and both are the kind
 * of decision that has to be written down rather than inferred from the code:
 *
 * **1. What "the original result" is.** An `act` response carries the outcome
 * *and* a fresh observation. Returning the stored observation would hand the agent
 * a stale world with stale affordances and stale `quote_id`s — technically the
 * original result, and actively harmful, because the agent would then act on a
 * snapshot the engine has moved past and be refused for a state-version mismatch
 * it could not have avoided. So what is stored and replayed byte-for-byte is the
 * **outcome**: what was accepted, what was corrected, and the state version it was
 * accepted against. The observation is rebuilt fresh and the response is flagged
 * `replayed`. The no-op guarantee is the load-bearing half and it is exact:
 * a replay queues nothing.
 *
 * **2. Whose key it is.** Keys are scoped **per principal**. A global key space
 * lets one agent guess or collide with another's key and receive its outcome —
 * which would be a read of another principal's private data through the one field
 * nobody thinks of as a read. `(principal, key)` makes that impossible by shape.
 *
 * Bounded on both axes (scar #3): a cap per principal and a cap overall, evicting
 * in insertion order, which is deterministic.
 */

import type { PrincipalId } from '../core/types.js';

/** Keys remembered per principal. A retry storm costs the retrier and nobody else. */
export const MAX_KEYS_PER_PRINCIPAL = 64;

/** Keys remembered in total. Bounded by seats × the per-principal cap in practice. */
export const MAX_KEYS_TOTAL = 20_000;

/** Longest idempotency key accepted. Bounded because it is a map key (INV-26). */
export const MAX_KEY_LENGTH = 128;

export interface StoredOutcome {
  /** The tick the original request was accepted for. */
  readonly tick: number;
  /** The engine state version it was accepted against. */
  readonly stateVersion: number;
  /** The outcome body, replayed verbatim. */
  readonly outcome: Readonly<Record<string, unknown>>;
}

export class IdempotencyStore {
  /** `principal::key` -> outcome. One flat map, keyed by the pair. */
  private readonly entries = new Map<string, StoredOutcome>();
  private readonly countByPrincipal = new Map<PrincipalId, number>();

  constructor(
    private readonly perPrincipal: number = MAX_KEYS_PER_PRINCIPAL,
    private readonly total: number = MAX_KEYS_TOTAL,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  /**
   * Look up a previous outcome for this principal's key.
   *
   * Note the separator: `::`, never a NUL byte. Two builders on this project used
   * NUL as a key separator and `file(1)` then reported the source as `data`, which
   * makes `grep` skip the file entirely while every gate stays green.
   */
  get(principal: PrincipalId, key: string): StoredOutcome | undefined {
    return this.entries.get(`${principal}::${key}`);
  }

  put(principal: PrincipalId, key: string, outcome: StoredOutcome): void {
    const composite = `${principal}::${key}`;
    if (this.entries.has(composite)) {
      // A second write under one key would make the replay non-deterministic, which
      // is the one thing this store exists to prevent.
      return;
    }
    this.evictIfNeeded(principal);
    this.entries.set(composite, outcome);
    this.countByPrincipal.set(principal, (this.countByPrincipal.get(principal) ?? 0) + 1);
  }

  /** Is this a well-formed key? Length and alphabet, because it is a map key. */
  static isWellFormed(key: string): boolean {
    return key.length > 0 && key.length <= MAX_KEY_LENGTH && /^[A-Za-z0-9_:.-]+$/.test(key);
  }

  private evictIfNeeded(principal: PrincipalId): void {
    if ((this.countByPrincipal.get(principal) ?? 0) >= this.perPrincipal) {
      this.evictOldestFor(principal);
    }
    while (this.entries.size >= this.total) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.forget(oldest.value);
    }
  }

  private evictOldestFor(principal: PrincipalId): void {
    const prefix = `${principal}::`;
    for (const composite of this.entries.keys()) {
      if (composite.startsWith(prefix)) {
        this.forget(composite);
        return;
      }
    }
  }

  private forget(composite: string): void {
    this.entries.delete(composite);
    const at = composite.indexOf('::');
    if (at < 0) return;
    const principal = composite.slice(0, at) as PrincipalId;
    const count = this.countByPrincipal.get(principal) ?? 0;
    if (count <= 1) this.countByPrincipal.delete(principal);
    else this.countByPrincipal.set(principal, count - 1);
  }
}
