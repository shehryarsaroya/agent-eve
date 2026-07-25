/**
 * `quote_id` — the wire contract's pin (SPEC §12.3).
 *
 * > "`quote_id` pins input data, validation rules, fee schedule and maximum spend
 * > for 1–3 ticks; it does **not** reserve price, fill, or another agent's offer."
 *
 * Three properties, each of which is a decision rather than an implementation
 * detail:
 *
 * **1. The id is content-derived, never a counter.** A counter has to be
 * snapshotted or replay diverges (DET-3/DET-5), and there is nothing here worth
 * snapshotting. So the id is a short hash of the pinned terms, which also makes
 * the whole thing idempotent: two `observe` calls in the same tick for the same
 * principal produce the *same* `quote_id` for the same option, which is what
 * "memoised per `(principal, tick)`" means on the wire (§12.1).
 *
 * **2. It reserves nothing.** There is no reservation table in this file and there
 * must never be one. PROP-W4: two agents can hold quotes on the same scarce thing.
 * A quote that reserved would make `observe` a claim on the world, and then
 * fetching an observation faster would be worth something — A4 through a side
 * door, and scar #2 (request speed beat judgment) rebuilt inside a read.
 *
 * **3. Nothing is minted outside a wake.** §12.4: outside a wake `observe`
 * returns the cached snapshot with "no fresh affordances and **no new
 * `quote_id`**". The gate lives in `observation.ts` — this book simply never gets
 * called on that path — and `assertObservation` checks the payload for freshly
 * minted ids rather than trusting the gate.
 *
 * ## Why the book exists at all
 *
 * `act` has to be able to answer "is this the quote I published, is it still live,
 * and what did it pin". Recomputing that from the action's own parameters would
 * mean the validator and the publisher agree by coincidence — which is scar #1's
 * shape. So the publisher records, the validator looks up, and a quote whose id
 * does not resolve is refused with a fresh preview rather than guessed at
 * (PROP-W3).
 */

import { canonicalHash, shortHash, type CanonicalValue } from '../core/canonical.js';
import type { PrincipalId } from '../core/types.js';
import { compareIds } from '../ledger/index.js';
import type { Minor } from '../core/units.js';

/**
 * Ticks a quote stays live. §12.3 says 1–3; 3 is the top of the range because the
 * lower end makes an honest agent's round trip a race, which is the thing A4
 * exists to delete.
 */
export const QUOTE_TTL_TICKS = 3;

/** A version prefix, so a change to what a quote pins is visible in the id. */
export const QUOTE_VERSION = 1;

/**
 * Declared cap on the live quote table (INV-26). The natural bound is
 * `principals x affordances x QUOTE_TTL_TICKS`; this is a hard ceiling above it so
 * a runaway caller cannot turn a read surface into a memory leak (scar #3).
 */
export const MAX_LIVE_QUOTES = 200_000;

/** What a quote pins. Every field is an input to the id. */
export interface QuoteTerms {
  readonly tick: number;
  readonly principal: PrincipalId;
  readonly verb: string;
  readonly params: Readonly<Record<string, string | number | boolean | null>>;
  /** INV-15: pinned at issue and never rewritten. */
  readonly rulesVersion: number;
  /** The most this option can spend of the holder's own value. */
  readonly maxSpend: Minor;
  /** A digest of the world facts the quote was computed from. */
  readonly inputsHash: string;
}

export interface Quote extends QuoteTerms {
  readonly id: string;
  /** Inclusive. An action at exactly this tick is still inside the quote. */
  readonly expiresTick: number;
}

/** The id, from the terms alone. Pure, so the publisher and a test agree. */
export function quoteIdFor(terms: QuoteTerms): string {
  const canonical: CanonicalValue = {
    v: QUOTE_VERSION,
    tick: terms.tick,
    principal: terms.principal,
    verb: terms.verb,
    params: terms.params,
    rules: terms.rulesVersion,
    max_spend: terms.maxSpend,
    inputs: terms.inputsHash,
  };
  // 12 hex chars, prefixed. Short because it is carried on every affordance in
  // every observation and the token budget is real; prefixed because an opaque
  // 12-char string in a log is unsearchable.
  return `q${String(QUOTE_VERSION)}:${shortHash(canonicalHash(canonical))}`;
}

export function quoteFrom(terms: QuoteTerms): Quote {
  return Object.freeze({
    ...terms,
    id: quoteIdFor(terms),
    expiresTick: terms.tick + QUOTE_TTL_TICKS,
  });
}

export class QuoteBook {
  private readonly live = new Map<string, Quote>();
  /** The last tick {@link prune} ran for, so pruning is once per tick, not per call. */
  private prunedAt = -1;

  /**
   * Publish a quote. Idempotent by construction: the same terms produce the same
   * id, so re-issuing inside a tick overwrites an identical row.
   */
  issue(terms: QuoteTerms): Quote {
    this.prune(terms.tick);
    const quote = quoteFrom(terms);
    this.live.set(quote.id, quote);
    if (this.live.size > MAX_LIVE_QUOTES) this.evictSoonest();
    return quote;
  }

  find(id: string): Quote | undefined {
    return this.live.get(id);
  }

  /**
   * Is this quote usable at `tick`? A quote that has expired is not an error and
   * not a betrayal — §12.3 says a mismatch "returns a fresh preview rather than
   * guessing", and that is the caller's job.
   */
  isLive(id: string, tick: number): boolean {
    const quote = this.live.get(id);
    return quote !== undefined && tick >= quote.tick && tick <= quote.expiresTick;
  }

  get size(): number {
    return this.live.size;
  }

  /**
   * Drop everything that expired before `tick`. Runs at most once per tick.
   *
   * Unsorted, deliberately: the *resulting set* is the same whatever order the
   * deletions happen in, so sorting would be `O(n log n)` of work per tick buying no
   * determinism at all. Where order does matter — {@link evictSoonest}, which chooses
   * *which* live rows to lose — it is explicit.
   */
  prune(tick: number): void {
    if (tick === this.prunedAt) return;
    this.prunedAt = tick;
    for (const [id, quote] of [...this.live.entries()]) {
      if (quote.expiresTick < tick) this.live.delete(id);
    }
  }

  /**
   * The overflow valve, and it is deliberately the least harmful eviction
   * available: the quotes closest to expiry go first, so what is lost is what an
   * agent had least time to use anyway. Deterministic — soonest expiry, then id —
   * because a non-deterministic eviction would make two replays of one tick
   * publish different quote sets.
   */
  private evictSoonest(): void {
    const ordered = [...this.live.values()].sort(
      (a, b) => a.expiresTick - b.expiresTick || compareIds(a.id, b.id),
    );
    const over = this.live.size - MAX_LIVE_QUOTES;
    for (let i = 0; i < over; i += 1) {
      const victim = ordered[i];
      if (victim !== undefined) this.live.delete(victim.id);
    }
  }
}
