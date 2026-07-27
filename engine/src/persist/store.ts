/**
 * The journal store — the durable substrate the "permanent public record" rests on.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHY THIS MODULE EXISTS.** Until it did, every write artifact SPEC §15.1 names
 * — the event ledger, the action log, the ledger, ventures, seals, standing, and
 * externally-enrolled identities — lived in ONE Node process's heap. `serve()`
 * built `new Runtime({seed})` from genesis on every boot; `Restart=always` and a
 * deploy restart reset the world to tick 0. A5 (loss is permanent), A5′ (the record
 * is never wrong) and A10 (identity never resets) were **false at the substrate**:
 * there was no substrate. This is the interface that gives the record a home
 * outside the heap.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * §15.1's three write artifacts, two projections. This store persists all three:
 *
 *   - **the append-only event ledger** — the product (viewer, audit, dataset);
 *   - **the action log** — replay's second term, "every SUBMITTED action including
 *     rejected" (intent runs are engine-derived and regenerate on replay, so they
 *     are deliberately not stored — see {@link TickRecord.actions});
 *   - **the postings** — authoritative for value (§15.1);
 *
 * plus the two things replay needs that are not events: the **per-tick seed** (so
 * `hash(seed(T))` can be re-verified from durable data alone) and the **snapshot**
 * at Reckoning checkpoints.
 *
 * ── THE SHAPE OF BOOT: FOUR BLOCKERS CLOSED, ONE LARGER ONE FOUND ───────────
 *
 * §15.2's story is "load the latest snapshot, adopt it, replay the actions after
 * it." Two earlier passes refused to build that and listed four reasons. Three of
 * the four are now closed and the fourth was never the decisive one; a fifth,
 * bigger than all of them, is why boot still replays from genesis by default.
 *
 * **Closed:**
 *
 *   1. *`EncumbranceBook` was in no state table.* Fixed elsewhere: the book now has
 *      `capture()`/`restore()` carrying rows, the exposure cache and the per-event
 *      counter, and sits inside `ledgerStateTable`. Re-verified here.
 *   2. *`PgJournalStore` did not write the `posting` table.* It does now, and the FK
 *      that blocked it is gone for a stated reason — see `postgres.ts` and
 *      `schema.sql`. {@link JournalStore.postingsInRange} is the read side.
 *   3. *The capture holds only `postingCount`/`batchCount`, never the contents, and
 *      `checkInv7` sums the whole posting log every tick.* The contents come back
 *      from the record: `Ledger.hydrateAppendOnly` rebuilds the append-only halves
 *      and refuses unless the rebuilt lengths equal the captured counts exactly.
 *   4. *`Ledger.restoreTo` refuses to grow the append-only halves.* **Untouched, and
 *      deliberately so.** The hydrate runs first, so the lengths already match and
 *      the truncation is a no-op; the refusal is not relaxed, it is satisfied.
 *
 * **Not closed, and it is the one that matters (`hydrate.ts` holds the manifest):**
 * a snapshot carries the *state tables*, and the state tables are not the whole
 * world. `StandingBook` (A10 reputation), `SealBook`, the `EventLedger`, the
 * obligation book INV-4 checks locks against, and the attribution register are in no
 * table, so an adopted world loses them — and `state_hash` cannot see the loss,
 * because it hashes only the tables. Measured: adopting a snapshot at tick 575
 * reproduces the hash **exactly** while `electiveHonoured` for the cast goes from
 * `4, 6, 2, 4 …` to all zeros. A tripwire that passes on a world whose reputation
 * has silently reset is worse than a slow boot, so boot adopts only when every book
 * is covered, and says which ones are not.
 */

import type { CanonicalValue } from '../core/canonical.js';
import type {
  AccountId,
  DecisionSource,
  EventId,
  GameEvent,
  GoodId,
  PrincipalId,
  Visibility,
} from '../core/types.js';
import type { LoggedAction } from '../tick/index.js';

/** One event as the durable record keeps it — full fidelity, so the in-memory store loses nothing. */
export interface PersistedEvent {
  readonly event: GameEvent;
  readonly visibility: Visibility;
  /** Payload keys that survive `FLAG_ONLY` for a `SEALED` event. */
  readonly flagKeys: readonly string[];
  /** The fan-out (`event_audience`): who may read this, and since when. */
  readonly audience: readonly PersistedAudience[];
}

export interface PersistedAudience {
  readonly principal: PrincipalId;
  readonly basis: string;
  readonly admittedAtTick: number;
}

/**
 * One posting as the durable record keeps it.
 *
 * `seqInTick` here is the **ledger batch's ordinal within the tick**, not an event's
 * `seq_in_tick` — the codebase does not maintain a 1:1 map between ledger batches
 * and `EventLedger` events (seating stakes and escrow refunds move value without an
 * `EventLedger` row), so a batch ordinal is the honest, gapless key. `eventId` is
 * carried so a batch can still be traced to its cause.
 *
 * **`batchKind` and `supplyAccount` are the batch's fields, repeated on every row of
 * that batch.** A batch has no table of its own, so it is reconstructed by grouping
 * on `(tick, seqInTick)` — and the denormalisation is made self-checking rather than
 * trusted: {@link JournalStore.postingsInRange}'s reader refuses a group whose rows
 * disagree about any of the three. They cannot be dropped and re-derived: INV-1's
 * form check and `checkInv7`'s third mirror both read the *named* faucet or sink a
 * supply change went through, and "which faucet" is not recoverable from the kind.
 */
export interface PersistedPosting {
  readonly tick: number;
  readonly seqInTick: number;
  readonly postingIndex: number;
  readonly eventId: EventId;
  readonly account: AccountId;
  readonly good: GoodId | null;
  /** Minor units, an integer. Never a float — money is minor units everywhere (A2). */
  readonly amountMinor: number;
  readonly amountQty: number | null;
  readonly batchKind: string;
  /**
   * The named faucet or sink this posting's batch moved supply through, or null for a
   * TRANSFER. Unnamed minting is unauditable (INV-1 form B), so the name is durable.
   */
  readonly supplyAccount: AccountId | null;
}

/**
 * One committed tick's durable rows. `appendTick`'s argument, unpacked.
 *
 * **`actions` holds SUBMITTED actions only** (`arrivalOrdinal !== null`). Intent
 * runs are produced by the standing intents the snapshot/replay already holds
 * (`loop.ts`, `replay.ts`), so re-storing them would replay each twice — and the
 * schema's `action_log` is "every SUBMITTED action". The extractor filters them out.
 */
export interface TickRecord {
  readonly tick: number;
  /** `seed(T)`, revealed after the window closed. */
  readonly seed: string;
  /** `hash(seed(T))`, the commitment published before the window opened (DET-6). */
  readonly seedHash: string;
  readonly events: readonly PersistedEvent[];
  readonly postings: readonly PersistedPosting[];
  readonly actions: readonly LoggedAction[];
}

/** A full snapshot at a checkpoint tick. `writeSnapshot`'s argument, unpacked. */
export interface SnapshotRecord {
  readonly tick: number;
  readonly stateHash: string;
  readonly stateVersion: number;
  /** The canonical capture of every state table, `[name, capture]` sorted by name. */
  readonly tables: readonly (readonly [string, CanonicalValue])[];
  /**
   * `seed(T)` and its commitment, carried so the snapshot row is self-contained for
   * audit without the store re-deriving the seed format (which is `SeedBook`'s, and
   * duplicating it here would be a second home for that rule).
   */
  readonly seed: string;
  readonly seedHash: string;
  /**
   * The `RULES_VERSION` whose arithmetic produced this snapshot, or null on a row
   * written before the column existed.
   *
   * Adoption is gated on this rather than on the world's write-once birth version, so a
   * rules change costs ONE genesis replay instead of one per boot forever. Null means
   * unknown provenance and is refused — see the column comment in `schema.sql`.
   */
  readonly rulesVersion: number | null;
}

/**
 * An externally-enrolled identity, durable so boot can re-seat it.
 *
 * The house cast is re-seated deterministically from the master seed and is never
 * stored; only HTTP enrolments (`POST /enroll`) land here. `publicKey` is base64url
 * so this table never depends on the fragile `principal` CHECK constraints (see
 * `postgres.ts`).
 */
export interface EnrollmentRecord {
  readonly principal: PrincipalId;
  readonly handle: string;
  readonly publicKey: string;
  readonly enrolledAtTick: number;
  readonly ownerEmail: string | null;
  /** The decision source recorded at enrolment, for the census. Usually `LIVE`. */
  readonly decisionSource?: DecisionSource;
}

/**
 * Just enough of a snapshot to check a tripwire: the tick and the hash.
 *
 * Boot compares hashes and reads nothing else, and a season's worth of full
 * captures does not fit in a boot's memory budget — 288 ticks per Reckoning over a
 * 28-day season is ~840 snapshots, each carrying every account, lot, venture and
 * grant. Loading the digests instead makes the tripwire set O(bytes-per-Reckoning)
 * rather than O(world-size × Reckonings).
 */
export interface SnapshotDigest {
  readonly tick: number;
  readonly stateHash: string;
}

/**
 * A **declared discontinuity in the record.**
 *
 * A5 says the record must never be wrong. When a code change makes a past tick
 * compute differently, the honest options are to refuse to serve the world or to
 * say out loud that the rules changed here — and only an operator may choose the
 * second. This row is that statement: which tick, which rules version was in force
 * when the tick was written, which one is in force now, and what the divergence
 * actually was. It is written **once, at the boot that accepted it**, and it never
 * rewrites a past row: the ticks before and after the divergence keep the bytes
 * they were written with, and this row is the annotation that says the two halves
 * were computed by different code.
 *
 * A silent discontinuity is a lie. An annotated one is history.
 */
export interface DivergenceRecord {
  /** The first tick whose replay disagreed with the record. */
  readonly tick: number;
  readonly kind: DivergenceKind;
  /** `rules_version` recorded at genesis, or null on a journal written before it was. */
  readonly fromRulesVersion: number | null;
  /** `RULES_VERSION` of the build that accepted the divergence. */
  readonly toRulesVersion: number;
  /** Human-readable: the action or the hashes. Never a secret; never a NUL byte. */
  readonly detail: string;
  /** For a tripwire mismatch: the journalled hash. Null for a refusal. */
  readonly expectedHash: string | null;
  /** For a tripwire mismatch: what this build produced. Null for a refusal. */
  readonly actualHash: string | null;
  /** How many further divergences the same boot tolerated after this one. */
  readonly toleratedAfter: number;
  /** Wall clock at acceptance, injected (DET-7). Audit only; nothing reads it back. */
  readonly acceptedAtMs: number;
}

export type DivergenceKind = 'APPLIED_REFUSED' | 'STATE_HASH_MISMATCH';

/**
 * Strip anything that cannot go in a Postgres text column, and bound the length.
 *
 * A NUL byte aborts the whole INSERT, and the one string here not authored by this
 * codebase is an engine hint quoting an agent-supplied verb. So the sanitiser runs
 * on the way in, where the alternative failure is "the operator accepted a
 * divergence and the annotation silently did not write".
 */
export function safeDetail(text: string, max = 2000): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? ' ' : ch;
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}

/**
 * The durable journal. Two implementations: {@link InMemoryJournalStore} (tests, no
 * external dependency) and `PgJournalStore` (production). The abstraction is what
 * lets the durability round-trip — the actual risk — be tested in CI without a
 * live database.
 *
 * Every method is async because the pg impl is; the in-memory impl resolves at once.
 */
export interface JournalStore {
  /**
   * Record the run's master seed once, at genesis. On a non-empty store this is a
   * no-op that must be reconciled by the caller against {@link masterSeed} — booting
   * a persisted world under a different seed would diverge silently, which is why
   * boot reads {@link masterSeed} and refuses a mismatch rather than trusting this.
   */
  init(masterSeed: string): Promise<void>;
  /** The master seed recorded at genesis, or null when the store has never been written. */
  masterSeed(): Promise<string | null>;

  /** Append one committed tick's events, postings, submitted actions and seed. */
  appendTick(record: TickRecord): Promise<void>;
  /** Write a full snapshot at a checkpoint (every Reckoning; cheap insurance). */
  writeSnapshot(record: SnapshotRecord): Promise<void>;

  /** The highest-tick snapshot, or null. Boot's adopt-point when the manifest allows it. */
  latestSnapshot(): Promise<SnapshotRecord | null>;
  /**
   * Every snapshot, ascending by tick — full captures.
   *
   * **Not what boot uses.** A long season's worth of full captures is unbounded
   * memory; boot reads {@link snapshotHashes} instead. This stays for operators, for
   * `verify-restore`, and for tests that need the bodies.
   */
  snapshots(): Promise<readonly SnapshotRecord[]>;
  /** Every snapshot's `(tick, state_hash)`, ascending. Boot's tripwire set. */
  snapshotHashes(): Promise<readonly SnapshotDigest[]>;

  /**
   * Every tick strictly after `tick`, ascending. `ticksSince(-1)` is the whole run.
   *
   * **Unbounded, so boot does not call it.** Kept because a whole-run read is the
   * honest thing for an audit or a test to ask for; the boot path pages through
   * {@link ticksPage}.
   */
  ticksSince(tick: number): Promise<readonly TickRecord[]>;
  /**
   * At most `limit` ticks strictly after `tick`, ascending. The paged form of
   * {@link ticksSince}, and the only one replay is allowed to use: a season at the
   * production 10 s tick is ~242 000 ticks, and materialising all of them (with
   * every action) before the first one is replayed is a boot that gets slower and
   * hungrier forever while A10 forbids ever resetting.
   *
   * A short page means the end of the log. `limit` must be >= 1.
   */
  ticksPage(tick: number, limit: number): Promise<readonly TickRecord[]>;
  /** The highest appended tick, or -1 when none. */
  headTick(): Promise<number>;

  /**
   * Every persisted posting with `fromTick <= tick <= toTick`, in append order
   * (`tick`, then `seqInTick`, then `postingIndex`).
   *
   * The read side of the authoritative posting log (§15.1), and the only durable
   * source a checkpoint adoption can rebuild the ledger's append-only halves from.
   * Bounded by the window rather than by a row limit on purpose: the caller pages in
   * tick windows, exactly as it does for {@link ticksPage}, and a tick's postings are
   * a batch-shaped unit that must not be split across pages — half a batch is a
   * malformed INV-1 group, and rejoining it across a page boundary is state the
   * reader would have to carry.
   *
   * An implementation that does not persist postings returns empty, which the
   * hydrate then refuses loudly against the snapshot's own counts rather than
   * adopting a ledger with no record behind it.
   */
  postingsInRange(fromTick: number, toTick: number): Promise<readonly PersistedPosting[]>;

  /**
   * Record the `RULES_VERSION` this run was born under. Write-once, like the seed:
   * the point is to know what the OLD ticks were computed by, and an upsert would
   * destroy exactly that.
   */
  recordRulesVersion(version: number): Promise<void>;
  /** The rules version at genesis, or null on a journal written before this existed. */
  journalledRulesVersion(): Promise<number | null>;

  /** Append one operator-accepted discontinuity. Never updates; never deletes. */
  recordDivergence(record: DivergenceRecord): Promise<void>;
  /** Every accepted discontinuity, ascending by tick. The public annotation. */
  divergences(): Promise<readonly DivergenceRecord[]>;

  /** Persist one external enrolment so boot can re-seat it. */
  recordEnrollment(record: EnrollmentRecord): Promise<void>;
  /** Every external enrolment, ascending by `enrolledAtTick` then insertion order. */
  enrollments(): Promise<readonly EnrollmentRecord[]>;

  close(): Promise<void>;
}

/** Build a {@link SnapshotRecord} from an engine {@link Snapshot} and its tick's seed pair. */
export function snapshotRecord(
  snapshot: {
    readonly tick: number;
    readonly stateVersion: number;
    readonly stateHash: string;
    readonly tables: readonly (readonly [string, CanonicalValue])[];
  },
  seed: string,
  seedHash: string,
  rulesVersion: number,
): SnapshotRecord {
  return {
    tick: snapshot.tick,
    stateHash: snapshot.stateHash,
    stateVersion: snapshot.stateVersion,
    tables: snapshot.tables,
    seed,
    seedHash,
    // Required, not defaulted. A snapshot's provenance is not guessable, and a default
    // would let a caller that forgot to stamp it produce a row that looks adoptable.
    rulesVersion,
  };
}
