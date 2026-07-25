/**
 * `seed(T)`: committed before, revealed after. DET-6.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **A SEED REVEALED EARLY IS AN ORACLE.**
 * ══════════════════════════════════════════════════════════════════════════
 *
 * SPEC §15.2: "`hash(seed(T))` publishes before actions for T are accepted."
 * The commitment is what makes the world's randomness *auditable* — anyone can
 * check afterwards that the hazard roll which took your convoy was fixed before
 * you decided to send it. If the seed itself leaked first, an agent could compute
 * every draw of the coming tick and act on it, and the resulting record would be
 * a permanent public account of decisions made against a marked deck.
 *
 * So the two operations are separated in the *type*, not only in the docs:
 *
 *   - {@link SeedBook.publish} makes `hash(seed(T))` readable. It must happen
 *     before the window for T opens, and {@link SeedBook.isPublished} lets the
 *     queue refuse submissions until it has.
 *   - {@link SeedBook.reveal} returns the seed string, and **throws** until
 *     {@link SeedBook.freeze} has run for that tick. `freeze` is called from the
 *     `FREEZE_QUEUE` phase, i.e. after the last action for T was accepted.
 *
 * Per-phase sub-streams: every draw comes from `Rng.fromSeed(seed(T)).derive(phase)`.
 * Without the derive, adding one `rng.int()` inside `HAZARD` would shift every
 * draw in `PREDATE` for the rest of the game — a change that presents as a
 * balance regression and is nearly impossible to attribute.
 */

import { Rng } from '../core/rng.js';
import type { PhaseName } from './phases.js';

export class SeedDisclosureError extends Error {}

/** What a tick's seed looked like from the outside, in order. */
export interface SeedRecord {
  readonly tick: number;
  /** `sha256(seed(T))`, publishable before actions for T are accepted. */
  readonly commitment: string;
  /** The seed itself, or null while it is still sealed. */
  readonly revealed: string | null;
}

export class SeedBook {
  /**
   * `tick -> the commitment string that was actually published`.
   *
   * A `Set<number>` of ticks would make {@link commitmentHolds} a tautology: both
   * sides of its `===` would recompute `seedHash(seedString(tick))` from the same
   * master, so the check could not fail no matter what happened in between. Keeping
   * the published *bytes* is what makes it a check — it compares the seed being
   * revealed against the string an observer was handed in advance.
   */
  private readonly published = new Map<number, string>();
  private readonly frozen = new Set<number>();

  /**
   * `master` is the run's committed seed. Every failure in this codebase is
   * reproducible from `(seed, scenario, rules_version)` alone (`TESTING.md` §16),
   * so this string is the whole of the first term.
   */
  constructor(readonly master: string) {
    if (master.length === 0) {
      throw new SeedDisclosureError('a run needs a committed seed; the empty string is not one');
    }
  }

  /**
   * The seed for one tick, derived rather than stored.
   *
   * Private on purpose: a caller that can read this at will has defeated the
   * commitment. Everything outside goes through {@link commitment} (always
   * allowed) or {@link reveal} (only after freeze).
   */
  private seedString(tick: number): string {
    if (!Number.isSafeInteger(tick) || tick < 0) {
      throw new SeedDisclosureError(`a tick is a non-negative integer, got ${String(tick)}`);
    }
    return `${this.master}:t${String(tick)}`;
  }

  /** `hash(seed(T))`. Safe to hand to anyone, at any time. */
  commitment(tick: number): string {
    return Rng.seedHash(this.seedString(tick));
  }

  /**
   * Publish the commitment for a tick. Must precede the window for that tick;
   * the queue asks {@link isPublished} before it opens.
   */
  publish(tick: number): string {
    const commitment = this.commitment(tick);
    // Published once and never overwritten: a second publish that changed the bytes
    // would be a re-commitment after the fact, which is the failure the commitment
    // exists to prevent.
    if (!this.published.has(tick)) this.published.set(tick, commitment);
    return commitment;
  }

  isPublished(tick: number): boolean {
    return this.published.has(tick);
  }

  /** The bytes an observer was handed, or null if nothing was published for `tick`. */
  publishedCommitment(tick: number): string | null {
    return this.published.get(tick) ?? null;
  }

  /**
   * The window for `tick` has closed. Only now may the seed be read.
   *
   * Refuses if the commitment was never published: revealing a seed nobody could
   * have checked in advance is the same failure as revealing it early, just
   * harder to notice.
   */
  freeze(tick: number): void {
    if (!this.published.has(tick)) {
      throw new SeedDisclosureError(
        `seed(${String(tick)}) cannot be revealed: hash(seed(${String(tick)})) was never published, so no ` +
          `observer could have verified it was fixed in advance (DET-6)`,
      );
    }
    this.frozen.add(tick);
  }

  isRevealable(tick: number): boolean {
    return this.frozen.has(tick);
  }

  reveal(tick: number): string {
    if (!this.frozen.has(tick)) {
      throw new SeedDisclosureError(
        `seed(${String(tick)}) is sealed until the window for tick ${String(tick)} closes. A seed revealed ` +
          `before actions are accepted is an oracle (SPEC §15.2, DET-6).`,
      );
    }
    return this.seedString(tick);
  }

  /**
   * The tick's root generator. One per tick; phases take sub-streams from it.
   */
  rootRng(tick: number): Rng {
    return Rng.fromSeed(this.reveal(tick));
  }

  /**
   * A phase's own sub-stream. The label is the phase name, so the streams are
   * named by the rules surface rather than by call order.
   */
  phaseRng(tick: number, phase: PhaseName): Rng {
    return this.rootRng(tick).derive(phase);
  }

  /** The audit row for a tick: what was promised, and what was shown. */
  record(tick: number): SeedRecord {
    return {
      tick,
      commitment: this.published.get(tick) ?? this.commitment(tick),
      revealed: this.frozen.has(tick) ? this.seedString(tick) : null,
    };
  }

  /**
   * Does the revealed seed match what was committed?
   *
   * The commitment is only worth something if this is checkable, so it is
   * checked — in `COMMIT`, every tick, not just in a test.
   */
  commitmentHolds(tick: number): boolean {
    if (!this.frozen.has(tick)) return true;
    const promised = this.published.get(tick);
    // Nothing was published, so there is nothing this seed could be honouring. That
    // is a failure, not a pass: `freeze` refuses an unpublished tick, so reaching
    // here means the book was pruned or rebuilt under the tick it is revealing.
    if (promised === undefined) return false;
    return Rng.seedHash(this.seedString(tick)) === promised;
  }

  /**
   * Forget the bookkeeping for ticks older than `keepFromTick`.
   *
   * Two sets that only ever grow are scar #3 with a slow fuse: 288 ticks a day
   * forever is an unbounded array in a process that is meant to run for a season.
   * The published/frozen flags matter only for the window that is still open and
   * the tick being replayed, so anything older is dropped.
   */
  prune(keepFromTick: number): void {
    for (const t of [...this.published.keys()]) if (t < keepFromTick) this.published.delete(t);
    for (const t of [...this.frozen]) if (t < keepFromTick) this.frozen.delete(t);
  }
}
