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
 * ── THE SHAPE OF BOOT, AND A FINDING THAT CHANGED IT ────────────────────────
 *
 * §15.2's story is "load the latest snapshot, adopt it, replay the actions after
 * it." **That does not work here, and the reason is load-bearing.** The ledger's
 * state table (`src/ledger/stateTable.ts`) stores the append-only postings/batches
 * as *counts*, not contents, and `Ledger.restoreTo` **refuses to grow** them — it
 * is an abort-path inverse (truncate the current tick's additions), not a
 * cross-process restore. A fresh process has zero postings, so adopting any
 * snapshot taken after value has moved throws `restore would grow an append-only
 * table`. Verified empirically before this module was written.
 *
 * So boot **re-seats the deterministic house cast and replays the action log from
 * genesis**, which reproduces the exact `state_hash` (also verified). The stored
 * snapshots become **verification tripwires**: at every tick that has one, the
 * replayed hash must equal the stored hash, or boot refuses. {@link latestSnapshot}
 * is provided for interface completeness and for operators, but boot cannot use it
 * as an adopt-point until the ledger grows a hydrate-from-journal path — which lives
 * in `ledger.ts`, under review, and is reported rather than touched.
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
 * carried so a batch can still be traced to its cause. See the module note in
 * `postgres.ts` for why the `posting` table is not populated by the pg store yet.
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

  /** The highest-tick snapshot, or null. For operators; boot cannot adopt it (see header). */
  latestSnapshot(): Promise<SnapshotRecord | null>;
  /** Every snapshot, ascending by tick. Boot's tripwire set. */
  snapshots(): Promise<readonly SnapshotRecord[]>;

  /** Every tick strictly after `tick`, ascending. `ticksSince(-1)` is the whole run. */
  ticksSince(tick: number): Promise<readonly TickRecord[]>;
  /** The highest appended tick, or -1 when none. */
  headTick(): Promise<number>;

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
): SnapshotRecord {
  return {
    tick: snapshot.tick,
    stateHash: snapshot.stateHash,
    stateVersion: snapshot.stateVersion,
    tables: snapshot.tables,
    seed,
    seedHash,
  };
}
