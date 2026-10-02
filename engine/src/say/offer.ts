/**
 * `publish_offer` — the standing price list, as a function of its inputs.
 *
 * Fifth extraction under `D21`'s coupling order. Sits beside `say.ts` because it is the same kind of
 * act: a short, public, permanently attributed statement. The difference is what it is FOR — a claim
 * says who you are, an offer says what you will do and for how much.
 *
 * ── THE CESSION BRANCH STAYS IN THE RUNTIME, DELIBERATELY ────────────────────
 *
 * `publish_offer` has two shapes. Naming a claim (`cede`) publishes an offer with a subject the engine
 * can actually transfer, which needs the sovereignty book, a price and a system. Everything else is
 * prose. Only the prose half moves here: the adapter dispatches the cession before calling this, so
 * the port stays one member wide instead of dragging sovereignty in behind it.
 *
 * A wider port would compile and would defeat the purpose — the value of these extractions is that the
 * signature ENUMERATES what the operation can reach.
 *
 * The length cap is INV-26 (bounded buffers), not style: an offer is a line on a public board every
 * observation reads. `agent.md`'s own example is the right register — *"HANDS FOR HIRE — 8% OF CARGO,
 * NO DEEP RUNS"* — a price list, not an essay.
 *
 * ── THE BOOK STANDS (§2 below, `RULES_VERSION` 41) ──────────────────────────
 *
 * It was a 256-row ring for the whole world that dropped its oldest row, so at launch volume a fresh
 * offer left the board inside its own freshness window, and one principal publishing every tick could
 * push everybody else's off it. Now the book holds **each principal's standing offer** — SPEC §7.3's
 * *"standing price list"*: a new offer replaces the author's last — for exactly the window its readers
 * read it in, so its size is a function of the population and never of anybody's volume.
 */

import { readString } from '../core/params.js';
import { MAX_PRINCIPALS } from '../core/time.js';
import type { PrincipalId } from '../core/types.js';
import { reject, type WorldResult } from '../world/result.js';
import { DIRECTORY_OFFER_FRESH_TICKS } from './directory.js';

/** One published offer, as the offer book stores it. */
export interface OfferEntry {
  readonly by: PrincipalId;
  readonly text: string;
  readonly tick: number;
}

export interface OfferPort {
  readonly record: (entry: OfferEntry) => void;
  readonly maxLength: number;
}

export function publishOffer(
  port: OfferPort,
  principal: PrincipalId,
  params: Readonly<Record<string, unknown>>,
  tick: number,
): WorldResult<null> {
  const text = readString(params, ['text', 'offer', 'reason']);
  if (text === null || text.length > port.maxLength) {
    return reject(
      'INV-26',
      `publish_offer needs {"text": "..."} of at most ${String(port.maxLength)} characters — a price ` +
        'list, not an essay: HANDS FOR HIRE — 8% OF CARGO, NO DEEP RUNS.',
    );
  }
  port.record({ by: principal, text, tick });
  return { ok: true, value: null };
}

// ── §2 THE BOOK STANDS ──────────────────────────────────────────────────────

/**
 * ★ The last tick at which anything reads this offer off the book, and so the last tick it is kept.
 *
 * Every reader is the freshness rule (`say/directory.ts:freshOfferOf`): the directory lists by it, the
 * OFFER reach rung addresses by it, and `market.offers` shows what is still in the book. An offer is
 * fresh through `tick + DIRECTORY_OFFER_FRESH_TICKS`, so that is the whole of its life.
 */
export function offerLastReadTick(entry: Pick<OfferEntry, 'tick'>): number {
  return entry.tick + DIRECTORY_OFFER_FRESH_TICKS;
}

/** ★ Offers one principal holds in the book: its standing one. A new offer replaces the last. */
export const OFFERS_RETAINED_PER_PRINCIPAL = 1;

/**
 * Total cap on the offer book (INV-26) — ★ **a population book, never a volume one**.
 *
 * It used to be a flat 256 for the whole world that evicted its oldest row. One standing offer for
 * every principal the world can hold, so the refusal in {@link OfferBook.push} is INV-26's tripwire and
 * cannot fire on legitimate play below `MAX_PRINCIPALS`. No row is preallocated: a world where nobody
 * advertises holds none.
 */
export const MAX_OFFER_ENTRIES = OFFERS_RETAINED_PER_PRINCIPAL * MAX_PRINCIPALS;

/**
 * ★ THE OFFER BOOK — every principal's standing offer, in the order they were published.
 *
 * Replaces a 256-row `Ring` that evicted the oldest offer in the world whoever had written it. Three
 * operations change it, and each keeps the one property {@link retire} depends on — **the rows are in
 * publish order, so their ticks never decrease**:
 *
 *   - {@link push} sets the author's standing offer and moves it to the back. The offer it replaces
 *     leaves the book: only the latest was ever read (`freshOfferOf` takes the latest), so nothing a
 *     reader sees changes, except that a principal who publishes every tick holds one row, not the book;
 *   - {@link retire} drops the offers past {@link offerLastReadTick}. Called from `EXPIRE`, so it is
 *     inside the hash and the abort path. Every offer is kept for the same span and the rows are in
 *     publish order, so the retired rows are always a prefix;
 *   - {@link restore} replaces the contents from a capture, and refuses one `push` could not produce.
 */
export class OfferBook {
  /** Author → standing offer. A `Map` iterates in insertion order, which is publish order here. */
  private readonly standing = new Map<PrincipalId, OfferEntry>();
  private rows: readonly OfferEntry[] | null = null;
  private dropped = 0;

  constructor(private readonly cap: number = MAX_OFFER_ENTRIES) {}

  /** Every standing offer, oldest first. */
  get all(): readonly OfferEntry[] {
    this.rows ??= [...this.standing.values()];
    return this.rows;
  }

  get size(): number {
    return this.standing.size;
  }

  /** Offers that have left the book since the world began — replaced or retired. The meter. */
  get droppedCount(): number {
    return this.dropped;
  }

  /** This principal's standing offer, fresh or not, or `null` if it has none in the book. */
  of(principal: PrincipalId): OfferEntry | null {
    return this.standing.get(principal) ?? null;
  }

  push(entry: OfferEntry): void {
    if (this.standing.delete(entry.by)) {
      this.dropped += 1;
    } else if (this.standing.size >= this.cap) {
      throw new Error(
        `the offer book is at its cap of ${String(this.cap)} standing offers, one per principal the world ` +
          'can hold; reaching it is a bug, and evicting somebody else\'s offer is the defect this book replaced',
      );
    }
    this.standing.set(entry.by, entry);
    this.rows = null;
  }

  /**
   * Drop every offer whose last reading tick is before `tick`. Returns how many left.
   *
   * Walks from the front and stops at the first offer still read, so the cost is the offers retired
   * plus one.
   */
  retire(tick: number): number {
    let n = 0;
    for (const [by, entry] of this.standing) {
      if (offerLastReadTick(entry) >= tick) break;
      this.standing.delete(by);
      n += 1;
    }
    if (n > 0) {
      this.dropped += n;
      this.rows = null;
    }
    return n;
  }

  /**
   * Replace the contents with a captured state — the inverse of reading {@link all} and
   * {@link droppedCount}. Refuses a capture `push` could not have produced: past the cap, a second
   * standing offer for one author, or ticks out of publish order.
   */
  restore(items: readonly OfferEntry[], dropped: number): void {
    if (items.length > this.cap) {
      throw new Error(`an offer book of cap ${String(this.cap)} cannot hold the ${String(items.length)} captured rows`);
    }
    const authors = new Set<PrincipalId>();
    let last = Number.NEGATIVE_INFINITY;
    for (const [i, entry] of items.entries()) {
      if (authors.has(entry.by)) {
        throw new Error(`captured offer ${String(i)} is a second standing offer for ${String(entry.by)}`);
      }
      if (entry.tick < last) {
        throw new Error(`captured offer ${String(i)} at tick ${String(entry.tick)} is out of publish order`);
      }
      authors.add(entry.by);
      last = entry.tick;
    }
    this.standing.clear();
    for (const entry of items) this.standing.set(entry.by, entry);
    this.rows = null;
    this.dropped = dropped;
  }
}
