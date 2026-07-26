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
 * material, exactly like an external agent's own notes, which §11.2 classifies `PRIVATE`
 * and never publishes to anyone including its owner.
 *
 * ## It used to die with the process, and that quietly deleted the premise
 *
 * "Months of honest work, then abuse at maximum leverage" needs the months. Memory living
 * only in the heap meant **every deploy wiped every grudge**: a member that had been
 * defaulted on twice woke up with no reason to distrust anyone, and the trust arc A6 is
 * built on could never be longer than the gap between restarts. On a project deploying
 * several times a day that is not a long-run concern, it is the normal case.
 *
 * So the ring can now be handed a {@link MemoryVault} and will load itself at construction
 * and save on a bounded cadence. Two things stay true, and both are load-bearing:
 *
 *   - **It is still not game state.** Not hashed, not snapshotted, not replayed, never
 *     published. Losing the file costs the cast its continuity and costs the RECORD
 *     nothing, which is the correct blast radius for something outside the ledger.
 *   - **A save can never touch the tick.** Writes are fire-and-forget and swallow their
 *     own errors, the same discipline as the frame writer: the record is sacred, cast
 *     continuity is a nicety, and a full disk must drop a memory rather than halt a world.
 */

import { stripControlBytes } from './text.js';

/** One remembered fact. */
export interface CastNote {
  readonly tick: number;
  readonly text: string;
}

/**
 * Somewhere durable to keep the ring. Injected so tests use an in-memory double and the
 * cast never reaches for the filesystem on its own.
 */
export interface MemoryVault {
  load(): Record<string, CastNote[]> | null;
  save(all: Record<string, CastNote[]>): void;
}

export class CastMemory {
  private readonly notes = new Map<string, CastNote[]>();
  private readonly vault: MemoryVault | null;
  /** Notes written since the last save. Saving every note would be I/O per wake. */
  private dirty = 0;

  constructor(
    /** Notes retained per member. Small on purpose: the prompt pays for every one. */
    readonly perMember = 10,
    /** Characters retained per note. */
    readonly maxChars = 160,
    /** Where the ring survives a restart. Omit for a memory that dies with the process. */
    vault: MemoryVault | null = null,
    /** Notes written between saves. Bounds I/O without risking much continuity. */
    readonly saveEvery = 20,
  ) {
    this.vault = vault;
    const loaded = vault?.load() ?? null;
    if (loaded === null) return;
    // Trust nothing on the way in: a hand-edited or truncated file must not be able to
    // hand the prompt an unbounded string or a non-integer tick. Same discipline as the
    // snapshot parsers — a store that cannot be read is a store that is ignored, never
    // one that is half-applied.
    for (const [handle, ring] of Object.entries(loaded)) {
      if (!Array.isArray(ring)) continue;
      const clean = ring
        .filter(
          (n): n is CastNote =>
            typeof n === 'object' &&
            n !== null &&
            Number.isSafeInteger(n.tick) &&
            typeof n.text === 'string',
        )
        .slice(-this.perMember)
        .map((n) => ({ tick: n.tick, text: stripControlBytes(n.text).slice(0, this.maxChars) }));
      if (clean.length > 0) this.notes.set(handle, clean);
    }
  }

  /**
   * Persist the ring if enough has changed. Never throws, never awaited.
   *
   * Called from `remember`, which is on the wake path, so it must be cheap and it must be
   * incapable of taking the world down. Cast continuity is worth a write; it is not worth
   * a halted tick, and the frame writer already established that ordering.
   */
  private maybeSave(): void {
    if (this.vault === null) return;
    this.dirty += 1;
    if (this.dirty < this.saveEvery) return;
    this.dirty = 0;
    try {
      this.vault.save(Object.fromEntries(this.notes));
    } catch {
      // A memory that cannot be saved is a memory that is forgotten on restart. That is
      // a worse cast, never a wrong world, so it is swallowed deliberately.
    }
  }

  /** Force a save, for shutdown. Same never-throws contract. */
  flush(): void {
    if (this.vault === null) return;
    this.dirty = this.saveEvery;
    this.maybeSave();
  }

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
    this.maybeSave();
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
