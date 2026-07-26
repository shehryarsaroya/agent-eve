/**
 * What a member remembers between wakes.
 *
 * A model called with only the current observation is a goldfish: it re-derives its
 * plan from scratch every wake, contradicts what it said last time, and cannot possibly
 * exhibit the behaviour A6 is about — *months of honest work, then abuse of granted
 * authority at maximum leverage*. Leverage is a thing you notice because you remember
 * building it.
 *
 * So each member carries a short, bounded log of **what it did and what was done to it**:
 * the actions it submitted, whether they were accepted or refused (and the invariant, in
 * the engine's own words), and the corrections the engine held for it. Two properties:
 *
 *   - **Bounded, hard.** A ring of `perMember` notes, each truncated to `maxChars`. Scar
 *     #3 was unbounded growth reachable from outside; a memory that grows with the run is
 *     the same shape with a slower fuse, and it would also make every prompt more
 *     expensive than the last.
 *   - **Facts, never conclusions.** A note says `elect refused: INV-V7`, not "you are
 *     being treated unfairly". The model draws the conclusions; if we drew them we would
 *     be writing the character's strategy for it (A12).
 *
 * Not state. Nothing here is hashed, snapshotted, replayed or published — it is prompt
 * material and dies with the process, exactly like an external agent's own notes, which
 * §11.2 classifies `PRIVATE` and never publishes to anyone including its owner.
 */

import { stripControlBytes } from './text.js';

/** One remembered fact. */
export interface CastNote {
  readonly tick: number;
  readonly text: string;
}

export class CastMemory {
  private readonly notes = new Map<string, CastNote[]>();

  constructor(
    /** Notes retained per member. Small on purpose: the prompt pays for every one. */
    readonly perMember = 10,
    /** Characters retained per note. */
    readonly maxChars = 160,
  ) {}

  /**
   * Record a fact.
   *
   * Sanitised on the way in rather than on the way out: a NUL byte or a newline that
   * reaches the prompt is a formatting bug, and one that reaches anything canonical is a
   * serialiser failure. Cheaper to make it impossible here than to remember later.
   */
  remember(handle: string, tick: number, text: string): void {
    const clean = stripControlBytes(text).replace(/\s+/g, ' ').trim().slice(0, this.maxChars);
    if (clean.length === 0) return;
    const ring = this.notes.get(handle) ?? [];
    ring.push({ tick, text: clean });
    while (ring.length > this.perMember) ring.shift();
    this.notes.set(handle, ring);
  }

  recall(handle: string): readonly CastNote[] {
    return this.notes.get(handle) ?? [];
  }

  /** The prompt form: oldest first, one line each, or a plain statement of emptiness. */
  render(handle: string): string {
    const ring = this.recall(handle);
    if (ring.length === 0) return 'Nothing yet. This is the first thing you have done.';
    return ring.map((n) => `t${String(n.tick)}: ${n.text}`).join('\n');
  }

  /** Total notes held, for the buffer report. Bounded by construction; counted anyway. */
  get size(): number {
    let n = 0;
    for (const ring of this.notes.values()) n += ring.length;
    return n;
  }

  forget(handle: string): void {
    this.notes.delete(handle);
  }
}
