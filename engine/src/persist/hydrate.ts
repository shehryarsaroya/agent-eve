/**
 * Checkpoint adoption: rebuild the ledger's append-only log from the record, adopt a
 * snapshot, and — before any of that — decide whether adopting one is honest at all.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE MANIFEST IS THE POINT OF THIS FILE.**
 *
 * §15.2 says resume is "load the latest snapshot, adopt it, replay the actions after
 * it", and the ledger half of that now works: {@link hydrateLedgerForSnapshot} puts
 * the postings and batches back from the durable log, `Ledger.restoreTo` accepts the
 * result without being weakened, `checkInv7` passes on the first tick after, and the
 * adopted world reaches a `state_hash` identical to a full genesis replay.
 *
 * **That last sentence is also the trap.** A snapshot captures the engine's *state
 * tables*, and `state_hash` hashes exactly those tables — so anything the world keeps
 * outside a table is neither carried nor noticed. Measured on a 600-tick run adopting
 * the snapshot at tick 575: the hash matched to the byte, and `electiveHonoured` for
 * the cast went from `4, 6, 2, 4, …` to all zeros. Reputation had silently reset and
 * the tripwire could not see it, because the tripwire is the hash.
 *
 * A slow boot is strictly better than a wrong one, and a boot that is wrong *and*
 * passes its own integrity check is worse than either. So adoption is gated on a
 * manifest: every book whose loss makes the world wrong must be a restorable state
 * table before a checkpoint may be adopted. {@link CHECKPOINT_REQUIRED_TABLES} names
 * them, {@link planCheckpoint} checks the engine's own table list against it, and boot
 * falls back to replaying from genesis — reporting exactly which books are missing —
 * whenever one is not there.
 *
 * **The gate has cleared, and it cleared itself exactly as promised.** `StandingBook`,
 * the `SealBook`, the obligation book, the `EventLedger` and the attribution register
 * are restorable state tables now; so are the two the equivalence test found once
 * those five were in (`mint` and `delivery`). On the same 600-tick journal,
 * adopt-plus-tail reaches the same `state_hash` as a full genesis replay and
 * `electiveHonoured` survives adoption. The manifest was not relaxed to let it
 * through — the books moved into it.
 *
 * ── WHAT "BOUNDED" MEANS HERE, EXACTLY ──────────────────────────────────────
 *
 * Bounded in **replay work**: an adopted boot re-runs the ticks after the last
 * Reckoning and no more, so the cost is ≤ `TICKS_PER_RECKONING` engine ticks at any
 * season length instead of every tick since genesis.
 *
 * NOT bounded in **posting rows**: the hydrate reads the whole posting log up to the
 * checkpoint, because `Ledger` holds it and `checkInv7` sums all of it every tick.
 * That is not a regression the hydrate introduces — a genesis-replayed process ends
 * up holding exactly the same rows, and the live process has held them all along —
 * but it means the per-tick cost of INV-7 still grows with history, and no amount of
 * checkpointing fixes that. The honest next finding after this one.
 * ══════════════════════════════════════════════════════════════════════════
 */

import type { CanonicalValue } from '../core/canonical.js';
import type { EventId, Posting, PrincipalId } from '../core/types.js';
import { minor } from '../core/units.js';
import type { AudienceAdmission, AudienceBasis, EventLedger } from '../events/index.js';
import { qtyDelta } from '../ledger/delta.js';
import type { AppliedBatch, BatchKind, Ledger, SupplyDirection } from '../ledger/index.js';
import { RULES_VERSION } from '../sim/runtime.js';
import { snapshotHashOf, type Snapshot, type StateTable } from '../tick/index.js';
import type { JournalStore, PersistedPosting, SnapshotRecord } from './store.js';

export class HydrateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HydrateError';
  }
}

/**
 * **Adoption cannot proceed, but the record may be perfectly sound — replay from genesis.**
 *
 * A `HydrateError` says the durable record disagrees with itself, which is a hard stop with no
 * operator door. This subclass says something narrower and much less alarming: *this snapshot is not
 * adoptable by this code*, which a genesis replay of the same journal may reproduce without
 * complaint — and in the case that produced it, demonstrably does.
 *
 * The distinction was learned in an outage. Adoption ran in production for the first time ever (the
 * write-once rules gate had refused it since the world's first rules change) and threw on a tick-2830
 * posting against an escrow account the tick-4895 capture no longer holds. Boot reported *"the
 * posting log and the snapshot describe different worlds… the record itself is inconsistent"* and
 * HELD the world with no door. **That diagnosis was wrong** in its conclusion, though right in its
 * words: the very next boot replayed the same journal from genesis, verified 17 snapshot tripwires,
 * and came up healthy. The two artifacts *do* describe different worlds; the record is not corrupt.
 *
 * A boot path that cannot handle a snapshot must degrade to the slow path, never to an outage. So
 * this is thrown **only from validation that provably precedes any mutation** — both hydrates now
 * verify everything they can before touching the runtime, and the ledger hydrate touches `ledger` on
 * its last line. The runtime is still clean and the caller can fall through to a genesis replay.
 * Anything thrown at or after that stays a plain `HydrateError` and stays fatal, because by then the
 * runtime has been mutated and a fallback would be replaying into a dirty world.
 */
export class CheckpointUnusableError extends HydrateError {
  constructor(
    message: string,
    /** Which artifact could not be rebuilt, for the boot line and for tests. */
    readonly kind: 'LEDGER_UNREBUILDABLE' | 'RECORD_UNREBUILDABLE',
  ) {
    super(message);
    this.name = 'CheckpointUnusableError';
  }
}

/**
 * Why adoption did not happen, as a fact rather than a sentence.
 *
 * Every one of these used to be a prose refusal only, and prose is what let this bug live for three
 * sessions: the message named the last account the hydrate happened to look at, so three
 * investigations went looking at the ledger. A caller (and a test) can assert on a kind; nobody can
 * assert on a paragraph.
 */
export type CheckpointRefusalKind =
  /** The caller said never adopt. */
  | 'ADOPTION_DISABLED'
  /** A book the world needs is in no restorable state table. */
  | 'MANIFEST_INCOMPLETE'
  /** The caller required a genesis replay under changed rules. */
  | 'CALLER_REQUIRED_REPLAY'
  /** The operator is walking through the divergence door on this boot. */
  | 'OPERATOR_JUDGING_DIVERGENCE'
  /** Nothing to adopt. */
  | 'NO_SNAPSHOT'
  /** The snapshot was computed by other arithmetic than this build's. */
  | 'RULES_VERSION_MISMATCH'
  /** The snapshot's own tables do not hash to its own claim. */
  | 'SNAPSHOT_SELF_INCONSISTENT'
  /** The store does not keep the append-only record at all. */
  | 'RECORD_CARRIES_NO_EVENTS'
  /**
   * A declared discontinuity at or before the snapshot: the durable append-only logs below it were
   * written by a world this one has been declared not to be. **This is the production case.**
   */
  | 'RECORD_SUPERSEDED'
  /** The posting log cannot rebuild this snapshot's ledger. */
  | 'LEDGER_UNREBUILDABLE'
  /** The event log cannot rebuild this snapshot's record. */
  | 'RECORD_UNREBUILDABLE';

/**
 * Every state table that must be present **and restorable** before a checkpoint may
 * be adopted, because losing what it holds makes the world wrong rather than stale.
 *
 * **All of them are registered now, and the equivalence has been measured rather than
 * argued** (`test/durability/checkpoint-adoption.test.ts`): adopt-plus-tail reaches
 * the same `state_hash` as a full genesis replay of the same journal, and the cast's
 * `electiveHonoured` survives adoption instead of going to zero. The five that used
 * to be missing, each with what its absence cost:
 *
 *   - `standing`     — A10. Reputation, defaults, elective honours. Resetting it is
 *                      the exact thing A10 says never happens, and `state_hash`
 *                      could not see it happen.
 *   - `seal`         — §14 and the say-do gap. Sealed intentions and their verdicts.
 *   - `obligation`   — INV-4 checks every open lock against a live obligation. An
 *                      empty book turns every encumbrance into an orphan and halts
 *                      the first tick after boot.
 *   - `event`        — the append-only public record and its audience index. The feed
 *                      is served from Postgres, but `observe` reads this in-process.
 *                      Counts in the snapshot, contents from the journal — see
 *                      {@link hydrateEventsForSnapshot}.
 *   - `attribution`  — the default register INV-17 walks in both directions.
 *
 * And two the equivalence test found once those five were in, which no list had ever
 * named — the strongest evidence there is for the warning in the next paragraph:
 *
 *   - `mint`         — the venture and grant id counters. An adopted world re-minted
 *                      ids from zero, so the first venture created after the
 *                      checkpoint got a different id from the one the journal holds,
 *                      and `ledger` and `venture` parted company on the very first
 *                      tick after adoption.
 *   - `delivery`     — the deed set's only source and the pinned pot a deferral's
 *                      second pass divides (§15.3).
 *
 * **This list was hand-maintained, and that was its weakness.** It could not see a
 * book added tomorrow and never listed here, so it under-reported by construction —
 * `mint` and `delivery` are the proof, and they were found by comparing two whole
 * worlds rather than by reading this file. A verifier then found the next instance
 * sitting here already: `raid` was a restorable state table and was **not** in this
 * list, so a build that lost the raid registration would have adopted a checkpoint and
 * dropped every live demand with the gate reporting nothing missing.
 *
 * So the list is no longer only hand-maintained. `test/durability/books-in-the-hash`
 * pins **every restorable table the engine registers** against this array, in both
 * directions, so a book that has a table can no longer be absent from the list that
 * decides whether adopting it is safe. The manifest is still a floor rather than a
 * ceiling for a book in *no* table at all — that is what the whole-world equivalence
 * test is for, because a hash cannot check it — but it can no longer lag behind the
 * tables that do exist.
 */
export const CHECKPOINT_REQUIRED_TABLES: readonly string[] = [
  'election',
  'grant',
  'intent',
  'ledger',
  'levy',
  'market',
  'venture',
  'world',
  // Registered as of the change that made adoption honest. Each one was a book the
  // snapshot neither carried nor missed.
  'attribution',
  'delivery',
  'event',
  'mint',
  'obligation',
  'seal',
  'standing',
  // Predation. Registered with a restore since the raid book landed, and absent from
  // this list until a verifier compared the two sets — the same shape as `mint` and
  // `delivery`, caught one step earlier. A live demand decides what a future tick does
  // to a principal's goods, so an adopted world that dropped the book would come up
  // owing nobody anything.
  'raid',
  // Sovereignty. Registered with a restore from the claim book's first commit, and named here
  // in the same change rather than in a later one — `test/durability/books-in-the-hash.test.ts`
  // asserts the two sets are equal in BOTH directions, and it is right to: a restorable table
  // missing from this manifest is a book adoption can drop while the gate reports nothing
  // missing. That is the `mint`/`delivery` shape, and here it would come up as an adopted world
  // holding no claims, no arrears counters and no bond locks — every posted bond an orphan lock
  // INV-4 halts on, and every claim silently un-owned.
  'sovereignty',
  // WORKS. Named in the same change that registered the table, for the reason the two
  // entries above learned the hard way. This book decides how many goods enter the world every
  // tick, so an adopted world that dropped it would come up with every place unworked — and the
  // holders would watch their income stop with no event saying why.
  'works',
  // Combat (§9A). Named in the same change that registered the two tables, because
  // `test/durability/books-in-the-hash.test.ts` asserts the two sets are equal in BOTH directions
  // and it is right to: a restorable table missing from this manifest is a book adoption can drop
  // while the gate reports nothing missing.
  //
  // Here the drop would be worse than most. An adopted world without `engagement` comes up with
  // every live battle gone — and OPS-1 would then find hulls the `fleet` book still calls ENGAGED
  // flying in no formation, or the reverse. An adopted world without `fleet` comes up with **every
  // warship in the galaxy deleted and no event saying so**, which is A5′ (the record must never be
  // wrong) at the largest scale this engine can express it.
  'engagement',
  'fleet',
  // Syndicates. A charter can never be amended, so a checkpoint that dropped the book would
  // bring the world up with the constitution every member relied on simply gone — and there is
  // no verb that could restate it. Named in the same change that registered the table, which is
  // now the third time `books-in-the-hash` has asked for that within a minute of the table
  // landing. The lesson has stuck: the manifest entry is part of adding a book, not a follow-up.
  'syndicate',
];

/** Why a checkpoint was not adopted, or null when one was. */
export interface CheckpointPlan {
  /** The snapshot to adopt, or null to replay from genesis. */
  readonly snapshot: SnapshotRecord | null;
  /** Operator-readable, and null exactly when {@link snapshot} is non-null. */
  readonly refusal: string | null;
  /** Machine-readable, and null exactly when {@link snapshot} is non-null. */
  readonly kind: CheckpointRefusalKind | null;
}

export interface CheckpointOptions {
  /**
   * Override the manifest. Tests narrow it to prove the ledger half in isolation;
   * production must not, and boot's default is {@link CHECKPOINT_REQUIRED_TABLES}.
   */
  readonly requiredTables?: readonly string[];
  /** Never adopt, whatever the manifest says. The operator's "just replay it". */
  readonly disabled?: boolean;
  /**
   * True when the journal's `RULES_VERSION` differs from this build's.
   *
   * **Adoption re-derives nothing.** A genesis replay recomputes every tick and
   * compares each one against its journalled snapshot, which is how a rules change is
   * caught, held, and put through the operator door. An adopted boot takes the
   * recorded state as given and replays only the tail — and the tail after the LATEST
   * Reckoning contains no snapshot at all (measured: `tripwiresChecked === 0` on a
   * 900-tick journal), so a build whose arithmetic moved would resume silently with
   * no divergence record. That is the A5′ failure the door exists to prevent, so a
   * rules change forces the slow path.
   */
  readonly rulesChanged?: boolean;
  /**
   * True when this boot has been handed `acceptDivergenceFromTick`, i.e. an operator is judging a
   * divergence on it.
   *
   * **The door is a claim about the WHOLE record, and adoption re-derives none of it.** Boot refuses
   * any accepted tick that is not the FIRST divergence, and "first" is only meaningful if every tick
   * was re-derived. An adopted boot skips the prefix, so it reports the first divergence *in the
   * tail* — measured in the fixture: a boot that adopted the checkpoint at tick 100 reported tick
   * 117, while a genesis replay of the same journal found tick 66. An operator told 117 who sets it
   * would then be refused by the next boot that happens to replay from genesis, and the door would
   * have closed behind them.
   *
   * So a boot that is judging a divergence re-derives everything. Set by {@link BootOptions} rather
   * than by the caller.
   */
  readonly operatorJudgingDivergence?: boolean;
}

/**
 * Which state tables are missing or unrestorable, in name order.
 *
 * `restore === undefined` counts as missing on purpose: `restoreSnapshot` refuses such
 * a table anyway, and a hash-only table (`hashOnlyTable`) attests to a book without
 * being able to put it back — which is precisely the shape that would let an adoption
 * look verified while dropping the book's contents.
 */
export function missingCheckpointTables(
  tables: readonly StateTable[],
  required: readonly string[] = CHECKPOINT_REQUIRED_TABLES,
): readonly string[] {
  const restorable = new Set(tables.filter((t) => t.restore !== undefined).map((t) => t.name));
  return [...required]
    .filter((name) => !restorable.has(name))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Decide whether to adopt the latest checkpoint, and say why not when the answer is no.
 *
 * Never throws for a reason the world's own record can explain: a store with no
 * snapshot, or a manifest gap, is a plain refusal that boot turns into a genesis
 * replay. The caller gets the reason and reports it.
 */
export async function planCheckpoint(
  tables: readonly StateTable[],
  store: JournalStore,
  options: CheckpointOptions = {},
): Promise<CheckpointPlan> {
  if (options.disabled === true) {
    return {
      snapshot: null,
      kind: 'ADOPTION_DISABLED',
      refusal: 'checkpoint adoption disabled by the caller',
    };
  }
  const missing = missingCheckpointTables(tables, options.requiredTables);
  if (missing.length > 0) {
    return {
      snapshot: null,
      kind: 'MANIFEST_INCOMPLETE',
      refusal:
        `checkpoint adoption refused: ${String(missing.length)} book(s) the world needs are in no ` +
        `restorable state table — ${missing.join(', ')}. A snapshot carries the state tables and ` +
        `state_hash hashes exactly those, so adopting one would drop these silently and the ` +
        `tripwire would still pass. Replaying from genesis instead.`,
    };
  }
  // The caller's explicit "force the slow path", kept as a lever (the deploy preflight
  // uses it) but no longer derived from the world's write-once birth version — see the
  // per-snapshot gate below for why that distinction is the whole fix.
  if (options.rulesChanged === true) {
    return {
      snapshot: null,
      kind: 'CALLER_REQUIRED_REPLAY',
      refusal:
        'checkpoint adoption refused: the caller required a genesis replay under a different ' +
        'RULES_VERSION. Adoption re-derives nothing and the tail after the latest Reckoning ' +
        'carries no snapshot to check against, so a rules change would take effect with no ' +
        'tripwire and no divergence record. Replaying from genesis so the mismatch is found and ' +
        'the operator door is offered.',
    };
  }
  const snapshot = await store.latestSnapshot();
  if (snapshot === null) {
    return { snapshot: null, kind: 'NO_SNAPSHOT', refusal: 'no snapshot in the journal to adopt' };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // ── THE RECORD BELOW A DECLARED DISCONTINUITY BELONGS TO ANOTHER WORLD ────────
  //
  // **This is the gate that explains the production failure, and it is checked here — before a
  // single posting row is read — because the answer is a fact about the journal, not something to
  // be discovered one row at a time.**
  //
  // A `journal_divergence` row says: from tick D, this world's state is not what the record says.
  // The operator was shown it and accepted it. What no code noticed is the consequence for the two
  // append-only artifacts: the world runs on and keeps appending to the SAME `posting` and `event`
  // tables, so from D onward those tables hold rows from the world that was, while every snapshot
  // written afterwards describes the world that is. Adoption then asks the superseded log to rebuild
  // the current ledger, and it cannot.
  //
  // Production, measured directly (2026-07-27):
  //
  //   journal_divergence   9 rows, every one at tick 287, STATE_HASH_MISMATCH, rules 1 -> 2,4,5,6…9
  //
  // ⚑ "Every one at tick 287" was read here as a coincidence of the world's shape. It was not, and
  // the full explanation arrived nineteen rows later: `COMPACT_ACCEPT_DIVERGENCE_AT_TICK=287` was
  // standing in `/etc/compact/env`, and because a tick is a LOCATION rather than an identity it
  // pre-authorised every rules change that first diverged at the first snapshot tripwire — which is
  // nearly all of them. See `acceptance.ts`. The rows above are honest; the gate that let them be
  // written without asking was not. Nothing in this file changes: adoption's refusal was already
  // correct, and it is correct for the same reason under a bound acceptance.
  //   posting log @ 2830   escrow:v:2830:117e86ad:p:vale    escrow:v:2830:69c52d4d:p:varrow
  //   capture   @ 4895     escrow:v:2830:516e910d:p:vale    escrow:v:2830:f34917a2:p:varrow
  //   counts    @ 4895     capture 5,542 postings / 2,791 events; log 1,495 / 3,180
  //
  // Same tick, same principals, same two ventures, DIFFERENT IDS — because a venture id is
  // `hash(tick, principal, ordinal)` over a world-global ordinal (`Runtime.mintVentureId`), so one
  // action refused under new rules renames every venture minted after it, forever. The account the
  // old refusal named was never "an escrow that closed": the same capture carries 1,303 closed
  // escrows at zero balance. It was an account this world never minted.
  //
  // The refusal is therefore CORRECT, and it stays. What was wrong was the diagnosis, which sent
  // three investigations into `ledger.ts` looking for a deletion that does not exist.
  // ══════════════════════════════════════════════════════════════════════════════
  const superseded = (await store.divergences()).filter((d) => d.tick <= snapshot.tick);
  if (superseded.length > 0) {
    const first = superseded.reduce((a, b) => (a.tick <= b.tick ? a : b));
    return {
      snapshot: null,
      kind: 'RECORD_SUPERSEDED',
      refusal:
        `checkpoint adoption refused: the record carries ${String(superseded.length)} declared ` +
        `discontinuit${superseded.length === 1 ? 'y' : 'ies'}, the earliest a ${first.kind} at tick ` +
        `${String(first.tick)} (rules_version ` +
        `${first.fromRulesVersion === null ? 'unrecorded' : String(first.fromRulesVersion)} -> ` +
        `${String(first.toRulesVersion)}), and the snapshot being offered is at tick ` +
        `${String(snapshot.tick)} — after it. From tick ${String(first.tick)} on, the durable posting ` +
        'and event logs were written by a world an operator has declared this one is not, while the ' +
        'snapshot describes this one. Adoption rebuilds the append-only halves FROM those logs, so it ' +
        'would rebuild another world’s ledger under this world’s balances. Replaying from genesis ' +
        'instead, which re-derives every tick from the action log — the artifact a rules change does ' +
        'not invalidate. This boot is O(history) and will stay so until the world’s record and its ' +
        'state are reconciled (a record epoch, or a world that has not been forked).',
    };
  }

  // ── THE RULES GATE IS PER-SNAPSHOT, AND THAT IS NOT A RELAXATION ──────────────
  //
  // It used to be per-WORLD, read from `journal_meta.rules_version` — which is write-once
  // and records what the world was BORN under. So the first rules change made the
  // mismatch permanent: every boot forever re-replayed from genesis to re-discover a
  // divergence an operator had already adjudicated once. Measured in production at the
  // time this was found: 4,809 ticks, 2m12s, growing without bound, on every restart.
  //
  // The honest question is not "was this world born under my rules" but **"did my own
  // arithmetic write the state I am about to take as given"** — and that is a property of
  // the snapshot, not of the world's birth. Gating on it keeps the safety property intact
  // and makes it self-healing:
  //
  //   rules move 6 -> 7  ->  newest snapshot is stamped 6  ->  REFUSED  ->  genesis
  //   replay  ->  divergence found  ->  operator door  ->  world runs on  ->  new
  //   checkpoints stamped 7  ->  later boots adopt.
  //
  // Exactly ONE genesis replay per rules change, which was always the intent. A build
  // whose arithmetic moved still cannot resume silently, because the snapshot it would
  // need to adopt carries the old stamp and is refused before anything is restored.
  //
  // Null is refused rather than assumed current: a row written before the column existed
  // has unknown provenance, and guessing "probably mine" is precisely the A5′ failure the
  // door exists to prevent.
  if (snapshot.rulesVersion !== RULES_VERSION) {
    const wrote =
      snapshot.rulesVersion === null
        ? 'was written before snapshots recorded which rules produced them, so its provenance is unknown'
        : `was produced by RULES_VERSION ${String(snapshot.rulesVersion)}, not this build's ${String(RULES_VERSION)}`;
    return {
      snapshot: null,
      kind: 'RULES_VERSION_MISMATCH',
      refusal:
        `checkpoint adoption refused: the snapshot at tick ${String(snapshot.tick)} ${wrote}. ` +
        'Adoption re-derives nothing, so taking it as given would let changed arithmetic resume ' +
        'with no tripwire and no divergence record. Replaying from genesis so the mismatch is ' +
        'found and the operator door is offered. This costs one replay per rules change, not one ' +
        'per boot: the checkpoints this build writes from here carry its own version and later ' +
        'boots adopt them normally.',
    };
  }

  // ── THE DOOR IS A CLAIM ABOUT THE WHOLE RECORD ────────────────────────────────
  //
  // See `CheckpointOptions.operatorJudgingDivergence`. Checked AFTER the superseded gate on purpose:
  // when both hold, the durable fact ("this world's record was superseded at tick 287") is the one an
  // operator needs, and the flag on this particular boot is the lesser statement.
  if (options.operatorJudgingDivergence === true) {
    return {
      snapshot: null,
      kind: 'OPERATOR_JUDGING_DIVERGENCE',
      refusal:
        'checkpoint adoption refused: this boot was handed an accepted divergence tick, so it is ' +
        'judging whether this build reproduces the record. Adoption re-derives nothing and would ' +
        'report the first divergence in the TAIL rather than the first in the record — an operator ' +
        'who accepted that tick would be refused by the next boot that replayed further back. ' +
        'Replaying from genesis so "first" means first.',
    };
  }

  // ── THE RECORD MUST AGREE WITH ITSELF, AND IT IS CHECKED BEFORE ANYTHING MOVES ──
  //
  // `adoptSnapshot` re-captures and compares, but by then the ledger and the record
  // have already been hydrated into the runtime, so a failure there can only be a
  // hard stop — and a hard stop is the wrong answer for the case this catches. A
  // stored snapshot whose own tables do not hash to its own `state_hash` is a record
  // this build cannot reproduce, which is precisely the wall the operator door exists
  // for: replay from genesis, let the tripwire name the tick, and offer
  // `COMPACT_ACCEPT_DIVERGENCE_AT_TICK`. Refusing here rather than throwing there is
  // what keeps that door reachable (`serve()` holds; it does not crash-loop).
  const recomputed = snapshotHashOf(snapshot.tables, snapshot.tick, snapshot.stateVersion);
  if (recomputed !== snapshot.stateHash) {
    return {
      snapshot: null,
      kind: 'SNAPSHOT_SELF_INCONSISTENT',
      refusal:
        `checkpoint adoption refused: the snapshot at tick ${String(snapshot.tick)} claims ` +
        `state_hash ${snapshot.stateHash} and its own tables hash to ${recomputed}. The record ` +
        'disagrees with itself, so replaying from genesis is the only way to find out which tick ' +
        'this build actually computes differently.',
    };
  }
  // ── AND THE STORE MUST BE ABLE TO HAND THE RECORD BACK ───────────────────────
  //
  // The `event` capture is four counts; the rows come from the journal. A store that
  // does not persist them can only produce an adopted world with an empty public
  // ledger — indistinguishable, to every reader, from a world where nothing has ever
  // happened — so `hydrateEventsForSnapshot` refuses it. But by then the runtime has
  // been mutated and the refusal can only be a hard stop, which for a store that
  // simply does not carry events is the wrong answer: the right one is the slow boot.
  //
  // So it is probed here, before anything moves. The snapshot's OWN tick is tried first
  // because it is the cheapest page and it answers immediately in production: a snapshot
  // is written at a Reckoning and a Reckoning appends its receipts.
  //
  // ── WHY IT DOES NOT STOP THERE, THOUGH IT USED TO ────────────────────────────
  //
  // "That tick has rows whenever the store keeps any" is an assumption, not a fact, and
  // it is false whenever snapshots are NOT written on Reckoning boundaries — a store
  // checkpointing every 10 ticks lands most of them on ordinary ticks that emit nothing.
  // The old single-page probe then refused a store that persists the record perfectly
  // well, and the refusal was indistinguishable from the real thing it looks for.
  //
  // That was found the hard way: it had been passing **vacuously** in the checkpoint
  // audit for as long as it existed, because tick 300 there happened to carry one event.
  // Giving the cast a `grant` branch moved which ticks carry what, tick 300 came up
  // empty, and three tests failed with a diagnosis that named the wrong cause — the
  // store was fine.
  //
  // A false refusal here is not cheap. It costs a full genesis replay, which is O(head)
  // and unbounded — the precise cost this file's rules gate was just rewritten to stop
  // paying for an already-adjudicated reason. "Safe direction to be wrong in" is true of
  // correctness and false of availability, and a guard that cries wolf gets muted.
  //
  // So a miss on the snapshot's own tick escalates to a bounded backward window instead
  // of concluding. Any event in the window proves the store persists the record, which is
  // the only thing being asked.
  const want = eventCountOf(snapshot);
  if (want > 0) {
    const page = await store.ticksPage(snapshot.tick - 1, 1);
    let carried = page[0]?.events.length ?? 0;
    if (carried === 0) {
      const from = Math.max(-1, snapshot.tick - 1 - EVENT_PROBE_WINDOW);
      const window = await store.ticksPage(from, EVENT_PROBE_WINDOW);
      for (const t of window) {
        carried += t.events.length;
        if (carried > 0) break;
      }
    }
    if (carried === 0) {
      return {
        snapshot: null,
        kind: 'RECORD_CARRIES_NO_EVENTS',
        refusal:
          `checkpoint adoption refused: the snapshot at tick ${String(snapshot.tick)} was taken over ` +
          `${String(want)} events and this store returns none for that tick or the ` +
          `${String(EVENT_PROBE_WINDOW)} before it. It does not persist the append-only record, so an ` +
          'adopted world would come up with an empty public ledger. Replaying from genesis, which ' +
          'rebuilds the record tick by tick.',
      };
    }
  }
  return { snapshot, refusal: null, kind: null };
}

/**
 * How far back the event-persistence probe looks when the snapshot's own tick is empty.
 *
 * Bounded on purpose: the question is "does this store keep events at all", which any single
 * non-empty tick answers, so there is no reason to scan history. One Reckoning's worth is
 * comfortably enough — a world that emitted nothing for 288 consecutive ticks has no record to
 * lose.
 */
const EVENT_PROBE_WINDOW = 288;

/** The event count in a snapshot's `event` capture, or 0 when it has none. */
function eventCountOf(snapshot: SnapshotRecord): number {
  const entry = snapshot.tables.find(([name]) => name === 'event');
  const root = entry?.[1];
  if (typeof root !== 'object' || root === null || Array.isArray(root)) return 0;
  const count = (root as { readonly [k: string]: CanonicalValue })['events'];
  return typeof count === 'number' && Number.isSafeInteger(count) ? count : 0;
}

/** The `postingCount`/`batchCount`/account set a snapshot's ledger capture holds. */
interface LedgerCaptureFacts {
  readonly postingCount: number;
  readonly batchCount: number;
  readonly accounts: ReadonlySet<string>;
}

function readLedgerCapture(snapshot: SnapshotRecord): LedgerCaptureFacts {
  const entry = snapshot.tables.find(([name]) => name === 'ledger');
  if (entry === undefined) {
    throw new HydrateError(
      `the snapshot at tick ${String(snapshot.tick)} has no 'ledger' table; it was taken by a build ` +
        'whose money was outside state_hash and cannot be adopted',
    );
  }
  const root = entry[1];
  if (typeof root !== 'object' || root === null || Array.isArray(root)) {
    throw new HydrateError(`the snapshot's 'ledger' capture is not an object`);
  }
  const table = root as { readonly [k: string]: CanonicalValue };
  const postingCount = table['postingCount'];
  const batchCount = table['batchCount'];
  if (typeof postingCount !== 'number' || !Number.isSafeInteger(postingCount)) {
    throw new HydrateError(`the snapshot's ledger capture has no integer postingCount`);
  }
  if (typeof batchCount !== 'number' || !Number.isSafeInteger(batchCount)) {
    throw new HydrateError(`the snapshot's ledger capture has no integer batchCount`);
  }
  const accounts = new Set<string>();
  const rows = table['accounts'];
  if (Array.isArray(rows)) {
    for (const raw of rows as readonly CanonicalValue[]) {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
      const id = (raw as { readonly [k: string]: CanonicalValue })['id'];
      if (typeof id === 'string') accounts.add(id);
    }
  }
  return { postingCount, batchCount, accounts };
}

/** Ticks of posting log read per round trip. Same argument as `REPLAY_PAGE_TICKS`. */
export const HYDRATE_PAGE_TICKS = 512;

const BATCH_KINDS: ReadonlySet<string> = new Set<BatchKind>(['TRANSFER', 'ISSUE', 'RETIRE']);

/** The ledger's append-only halves, read and checked, and not yet given to a ledger. */
export interface LedgerHydration {
  readonly batches: readonly AppliedBatch[];
  readonly postingCount: number;
  readonly batchCount: number;
}

/**
 * Read and CHECK the ledger's append-only halves for `snapshot`, mutating nothing.
 *
 * Refuses rather than repairs, at every step. A group whose rows disagree about the
 * batch they belong to, a posting against an account the snapshot never held, a row
 * written before the batch columns existed, a count that does not match the capture —
 * each is a refusal, because each of them silently produces a ledger whose INV-7
 * mirrors are wrong in a way that would surface a tick later as a halt with no cause
 * attached to it.
 *
 * **Separated from the apply so that every recoverable refusal precedes every
 * mutation.** Boot used to hydrate the ledger and then the record, which meant a
 * refusal from the event half arrived with the ledger already rebuilt — and the
 * genesis replay it fell back to then ran on a ledger holding 800 batches from a
 * world it was about to rebuild from tick 0, halting on the first tick with a
 * diagnosis that named the wrong thing. Found by making the event half recoverable
 * and watching the fallback take the world down anyway.
 */
export async function readLedgerHydration(
  store: JournalStore,
  snapshot: SnapshotRecord,
  pageTicks: number = HYDRATE_PAGE_TICKS,
): Promise<LedgerHydration> {
  if (!Number.isSafeInteger(pageTicks) || pageTicks < 1) {
    throw new HydrateError(`hydrate needs a positive integer page size, got ${String(pageTicks)}`);
  }
  const facts = readLedgerCapture(snapshot);

  const batches: AppliedBatch[] = [];
  let open: { key: string; batch: AppliedBatch; postings: Posting[] } | null = null;
  let seen = 0;
  /** The log's earliest row. A log that starts after genesis can never rebuild a genesis-rooted count. */
  let earliest: number | null = null;

  const close = (): void => {
    if (open === null) return;
    batches.push({ ...open.batch, postings: open.postings });
    open = null;
  };

  for (let from = 0; from <= snapshot.tick; from += pageTicks) {
    const to = Math.min(from + pageTicks - 1, snapshot.tick);
    const page = await store.postingsInRange(from, to);
    for (const row of page) {
      seen += 1;
      earliest ??= row.tick;
      assertRowShape(row, facts.accounts);
      const key = `${String(row.tick)}:${String(row.seqInTick)}`;
      if (open !== null && open.key !== key) close();
      if (open === null) {
        open = { key, batch: batchOf(row), postings: [] };
      } else if (
        open.batch.eventId !== row.eventId ||
        open.batch.kind !== row.batchKind ||
        (open.batch.supply?.account ?? null) !== row.supplyAccount
      ) {
        // The three batch fields are repeated on every row of a batch, so they can be
        // checked against each other. This is what stops the denormalisation from
        // becoming a second home for the fact instead of a copy of it.
        throw new HydrateError(
          `posting (tick ${String(row.tick)}, batch ${String(row.seqInTick)}, index ` +
            `${String(row.postingIndex)}) disagrees with its own batch about event/kind/supply`,
        );
      }
      open.postings.push({
        eventId: row.eventId,
        account: row.account,
        good: row.good,
        amountMinor: minor(row.amountMinor),
        // `qtyDelta`, never `qty`: a posting is SIGNED (a haul is the pair -5 / +5),
        // and `qty()` refuses a negative because a stored balance may not be one.
        // Using the balance constructor here throws on every outbound goods leg —
        // which is how this line was first written, and what the probe caught.
        amountQty: row.amountQty === null ? null : qtyDelta(row.amountQty),
      });
    }
  }
  close();

  if (seen === 0 && facts.postingCount > 0) {
    throw new CheckpointUnusableError(
      `the snapshot at tick ${String(snapshot.tick)} was taken over ${String(facts.postingCount)} ` +
        'postings and the journal returned none. This store does not persist the posting log, so ' +
        'there is nothing to hydrate from and an adopted ledger would fail INV-7 on its first tick.',
      'LEDGER_UNREBUILDABLE',
    );
  }

  // ── THE COUNTS ARE COMPARED HERE, AND THAT IS THE WHOLE POINT ────────────────
  //
  // `hydrateAppendOnly` compares them too, and correctly, and refuses BEFORE it mutates — but it
  // refuses with a plain `LedgerError`, which boot can only turn into a `BootError` with no operator
  // door: a HELD world answering 503 on every route, over an optimisation that failed safely.
  //
  // **That path is armed in production right now.** The capture at 4895 was taken over 5,542 postings
  // and the durable log holds 1,495 rows for ticks ≤ 4895 (the posting log only became durable when
  // the world was already at tick 2,810, so ~4,000 of those postings were never written anywhere).
  // The ONLY reason production got a recoverable refusal instead of an outage is that a renamed
  // escrow account turned up at tick 2830 — twenty ticks into the log — before the count was ever
  // compared. Luck, not design.
  //
  // So the comparison happens here as well, before the call, as a `CheckpointUnusableError`. The one
  // inside `hydrateAppendOnly` stays exactly as strict; reaching it now means an engine bug rather
  // than a record this build cannot rebuild, and it is right for that to be fatal.
  const postingsFound = batches.reduce((n, b) => n + b.postings.length, 0);
  if (postingsFound !== facts.postingCount || batches.length !== facts.batchCount) {
    throw new CheckpointUnusableError(
      `the durable posting log yields ${String(postingsFound)} postings in ${String(batches.length)} ` +
        `batches for ticks 0..${String(snapshot.tick)}, and the snapshot at tick ` +
        `${String(snapshot.tick)} was taken over ${String(facts.postingCount)} postings in ` +
        `${String(facts.batchCount)} batches` +
        (earliest !== null && earliest > 0
          ? `. The log's earliest row is at tick ${String(earliest)}, so it does not reach genesis and ` +
            'cannot supply the postings written before it existed'
          : '') +
        '. INV-7 sums the whole posting log every tick, so an adopted ledger that is short or long ' +
        'halts the first tick after boot. Replaying from genesis instead, which rebuilds the ledger ' +
        'from the action log rather than from the posting log.',
      'LEDGER_UNREBUILDABLE',
    );
  }

  return { batches, postingCount: facts.postingCount, batchCount: facts.batchCount };
}

/**
 * Hand a checked {@link LedgerHydration} to the ledger. The mutation, and nothing else.
 *
 * `hydrateAppendOnly` re-checks the counts and refuses with a plain `LedgerError`, which is fatal
 * and right to be: reaching it means {@link readLedgerHydration} passed and the numbers still
 * disagree, which is an engine bug rather than a record this build cannot rebuild.
 */
export function applyLedgerHydration(
  ledger: Ledger,
  plan: LedgerHydration,
): { readonly postings: number; readonly batches: number } {
  ledger.hydrateAppendOnly(plan.batches, {
    postingCount: plan.postingCount,
    batchCount: plan.batchCount,
  });
  return { postings: plan.postingCount, batches: plan.batchCount };
}

/**
 * Read, check and apply in one call, for callers that hold no other half-built state.
 *
 * Boot does NOT use this: it reads both halves, checks both, and only then applies either.
 */
export async function hydrateLedgerForSnapshot(
  ledger: Ledger,
  store: JournalStore,
  snapshot: SnapshotRecord,
  pageTicks: number = HYDRATE_PAGE_TICKS,
): Promise<{ readonly postings: number; readonly batches: number }> {
  return applyLedgerHydration(ledger, await readLedgerHydration(store, snapshot, pageTicks));
}

/**
 * Rebuild the append-only **record** for `snapshot`, from the durable event log.
 *
 * The exact counterpart of {@link hydrateLedgerForSnapshot}, and it exists for the
 * same reason: the `event` capture is four counts, not the contents, so a snapshot
 * cannot put the rows back and the durable journal must. `EventLedger.restoreTo` then
 * refuses to grow, which turns "did the hydrate find everything?" into a question the
 * adoption answers by itself rather than one an operator has to trust.
 *
 * Refuses rather than repairs, at every step:
 *
 *   - a row whose id is not the one `(tick, seq)` mints is a record written by a
 *     different id rule, and adopting it would give two events one id;
 *   - a store that returns no events for a snapshot taken over some is a store that
 *     does not persist the record, which is the `PgJournalStore`-without-postings
 *     failure one artifact over;
 *   - anything `EventLedger.append` itself refuses (INV-12's causality, the
 *     visibility ladder at birth) stays refused, because the hydrate re-runs the door
 *     rather than writing behind it.
 *
 * Audience rows admitted **after** their event's own tick are replayed in tick order
 * against the same door (`admitAudience`), so the ladder is re-checked; today nothing
 * in the engine admits late, and {@link EventHydration.lateAdmissions} reports it when
 * something starts to, because their reveal ordinals are re-derived here rather than
 * carried.
 */
export async function hydrateEventsForSnapshot(
  events: EventLedger,
  store: JournalStore,
  snapshot: SnapshotRecord,
  pageTicks: number = HYDRATE_PAGE_TICKS,
): Promise<EventHydration> {
  if (!Number.isSafeInteger(pageTicks) || pageTicks < 1) {
    throw new HydrateError(`hydrate needs a positive integer page size, got ${String(pageTicks)}`);
  }
  const want = readEventCapture(snapshot);

  // ── COUNT FIRST, APPEND SECOND ───────────────────────────────────────────────
  //
  // The same lesson as the ledger hydrate's count check, in the artifact where getting it wrong is
  // worse. Every refusal below this point comes AFTER `events.append` has started mutating the
  // runtime, so it can only ever be fatal — a HELD world, 503 on every route. And the condition is
  // live: production's capture at 4895 counts 2,791 events while the durable log holds 3,180 for
  // ticks ≤ 4895, because an accepted divergence at tick 287 left the log describing a world the
  // snapshot does not. Reaching the append pass with those numbers would take the world down.
  //
  // One extra pass over the tick log, counting lengths and keeping no bodies. On the adopted path
  // that is the read we were going to do anyway, done twice; the alternative is buffering the whole
  // record in memory to inspect it, which costs more than it saves.
  await verifyRecordRebuildable(store, snapshot, pageTicks);

  let appended = 0;
  let lateAdmissions = 0;
  let cursor = -1;
  // `[admittedAtTick, eventId, principal, basis]`, held until the ledger's watermark
  // has reached the tick the admission was made at. Sorted before replay so the order
  // does not depend on which page a row arrived in.
  const late: { tick: number; eventId: EventId; principal: PrincipalId; basis: string }[] = [];

  const drainLate = (throughTick: number): void => {
    while (late.length > 0) {
      const next = late[0];
      if (next === undefined || next.tick > throughTick) break;
      late.shift();
      events.admitAudience(next.eventId, next.principal, next.basis as AudienceBasis, next.tick);
      lateAdmissions += 1;
    }
  };

  while (cursor < snapshot.tick) {
    const page = await store.ticksPage(cursor, pageTicks);
    if (page.length === 0) break;
    const before = cursor;
    for (const record of page) {
      if (record.tick > snapshot.tick) break;
      cursor = record.tick;
      // Late admissions for ticks already passed, before this tick's appends move the
      // watermark past them — `admitAudience` refuses a tick behind the watermark.
      drainLate(record.tick);
      for (const row of record.events) {
        const atBirth: AudienceAdmission[] = [];
        for (const seat of row.audience) {
          if (seat.admittedAtTick === row.event.tick) {
            atBirth.push({ principal: seat.principal, basis: seat.basis as AudienceBasis });
            continue;
          }
          late.push({
            tick: seat.admittedAtTick,
            eventId: row.event.id,
            principal: seat.principal,
            basis: seat.basis,
          });
        }
        const rec = events.append({
          ...row.event,
          visibility: row.visibility,
          flagKeys: row.flagKeys,
          audience: atBirth,
        });
        if (rec.event.id !== row.event.id) {
          throw new HydrateError(
            `the journal holds event ${row.event.id} at (tick ${String(row.event.tick)}, seq ` +
              `${String(row.event.seqInTick)}) and this build mints ${rec.event.id} there; the record ` +
              'and the id rule describe different worlds',
          );
        }
        appended += 1;
      }
      late.sort((a, b) => a.tick - b.tick || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0));
    }
    if (page.length < pageTicks) break;
    // A page whose first row is already past the snapshot leaves the cursor where it was, and
    // `while (cursor < snapshot.tick)` would then ask for the same page forever. Reachable on a
    // journal with a hole in it (ticks 90 -> 105 across a checkpoint at 100), which is exactly the
    // shape a lost tail produces.
    if (cursor === before) break;
  }
  drainLate(snapshot.tick);

  // The two checks below are now guards against an engine bug rather than against a record this
  // build cannot rebuild — the count was compared before a single append, so a disagreement here
  // means `EventLedger.append` dropped or minted something. They stay fatal, and it is right that
  // they do: by this line the runtime has been mutated and there is no clean world to fall back to.
  if (appended === 0 && want.events > 0) {
    throw new HydrateError(
      `the snapshot at tick ${String(snapshot.tick)} was taken over ${String(want.events)} events and ` +
        'the journal returned none. This store does not persist the record, so there is nothing to ' +
        'hydrate from and an adopted world would come up with an empty public ledger — ' +
        'indistinguishable, to every reader, from a world in which nothing has ever happened.',
    );
  }
  if (events.eventCount < want.events) {
    throw new HydrateError(
      `the record was rebuilt to ${String(events.eventCount)} events and the snapshot at tick ` +
        `${String(snapshot.tick)} was taken over ${String(want.events)}; the journal is short, so ` +
        'adopting would serve a public record with holes in it',
    );
  }
  return { events: appended, lateAdmissions };
}

/**
 * Refuse, before anything is mutated, a durable record that cannot rebuild this snapshot's own
 * event count.
 *
 * **Boot calls this before it applies either half of the adoption**, because every refusal inside
 * {@link hydrateEventsForSnapshot} lands after `events.append` has started and can therefore only be
 * fatal — a HELD world, 503 on every route. The condition is live: production's capture at tick 4895
 * counts 2,791 events while its durable log holds 3,180 for ticks ≤ 4895, an accepted divergence at
 * tick 287 having left the log describing a world the snapshot does not.
 *
 * Costs one paged scan of the tick log, counting lengths and keeping no bodies.
 */
export async function verifyRecordRebuildable(
  store: JournalStore,
  snapshot: SnapshotRecord,
  pageTicks: number = HYDRATE_PAGE_TICKS,
): Promise<number> {
  const want = readEventCapture(snapshot);
  const carried = await countJournalledEvents(store, snapshot.tick, pageTicks);
  if (carried !== want.events) {
    throw new CheckpointUnusableError(
      `the durable event log holds ${String(carried)} events for ticks 0..${String(snapshot.tick)} and ` +
        `the snapshot at tick ${String(snapshot.tick)} was taken over ${String(want.events)}. The two ` +
        'describe different worlds, or the log has holes in it; either way an adopted world would ' +
        'serve a public record that is not its own. Replaying from genesis instead, which rebuilds ' +
        'the record tick by tick from the action log.',
      'RECORD_UNREBUILDABLE',
    );
  }
  return carried;
}

/**
 * How many events the durable log holds for ticks `0..throughTick`.
 *
 * Pages like everything else here, and keeps nothing: the bodies are dropped as each page goes out
 * of scope, so the memory bound is one page whatever the age of the world.
 */
async function countJournalledEvents(
  store: JournalStore,
  throughTick: number,
  pageTicks: number,
): Promise<number> {
  let total = 0;
  let cursor = -1;
  while (cursor < throughTick) {
    const page = await store.ticksPage(cursor, pageTicks);
    if (page.length === 0) break;
    const before = cursor;
    for (const record of page) {
      if (record.tick > throughTick) break;
      cursor = record.tick;
      total += record.events.length;
    }
    if (page.length < pageTicks) break;
    if (cursor === before) break;
  }
  return total;
}

/** What {@link hydrateEventsForSnapshot} rebuilt. */
export interface EventHydration {
  readonly events: number;
  /**
   * Audience rows admitted after their event's tick.
   *
   * **Zero today, and worth watching.** Their reveal ordinals are re-derived from the
   * replay order rather than carried in the journal, so a non-zero count means a
   * rebuilt feed could order two reveals differently from the run that produced them
   * — invisible to `state_hash`, which counts ordinals rather than placing them.
   */
  readonly lateAdmissions: number;
}

/** The counts a snapshot's `event` capture holds. */
function readEventCapture(snapshot: SnapshotRecord): { readonly events: number } {
  const entry = snapshot.tables.find(([name]) => name === 'event');
  if (entry === undefined) {
    throw new HydrateError(
      `the snapshot at tick ${String(snapshot.tick)} has no 'event' table; it was taken by a build ` +
        'whose public record was outside state_hash and cannot be adopted',
    );
  }
  const root = entry[1];
  if (typeof root !== 'object' || root === null || Array.isArray(root)) {
    throw new HydrateError(`the snapshot's 'event' capture is not an object`);
  }
  const count = (root as { readonly [k: string]: CanonicalValue })['events'];
  if (typeof count !== 'number' || !Number.isSafeInteger(count)) {
    throw new HydrateError(`the snapshot's event capture has no integer event count`);
  }
  return { events: count };
}

function batchOf(row: PersistedPosting): AppliedBatch {
  const kind = row.batchKind as BatchKind;
  return {
    eventId: row.eventId,
    tick: row.tick,
    kind,
    postings: [],
    supply:
      row.supplyAccount === null
        ? null
        : { direction: kind as SupplyDirection, account: row.supplyAccount },
  };
}

function assertRowShape(row: PersistedPosting, accounts: ReadonlySet<string>): void {
  const where =
    `posting (tick ${String(row.tick)}, batch ${String(row.seqInTick)}, index ${String(row.postingIndex)})`;
  if (row.eventId.length === 0) {
    throw new HydrateError(
      `${where} has no event_id. It was written before the posting log carried its batch's fields, ` +
        'so the batch it belongs to cannot be reconstructed and INV-1 could not be re-checked over it.',
    );
  }
  if (!BATCH_KINDS.has(row.batchKind)) {
    throw new HydrateError(`${where} has batch_kind '${row.batchKind}', which is not a batch kind`);
  }
  if ((row.supplyAccount === null) !== (row.batchKind === 'TRANSFER')) {
    throw new HydrateError(
      `${where} is a ${row.batchKind} and ${row.supplyAccount === null ? 'names no' : `names`} ` +
        'supply account; a TRANSFER never moves supply and an ISSUE/RETIRE always does (INV-1)',
    );
  }
  if (!accounts.has(row.account)) {
    // ── WHAT THIS CHECK ACTUALLY CATCHES, AFTER TWO WRONG ANSWERS ───────────────
    //
    // Wrong answer #1, the original: "compares against the accounts the snapshot held AT that tick".
    // It does not — the snapshot is at the checkpoint's tick and this loop feeds it every posting
    // since genesis.
    //
    // Wrong answer #2, which cost an outage and then three sessions: "so an escrow that opened and
    // CLOSED before the checkpoint is legitimately absent." **That is false, and measuring it was
    // the whole fix.** `capture()` lists every account (`allAccounts()`, no filter, no cap), nothing
    // in `ledger.ts` deletes one, and the live capture at 4895 carries 1,303 escrow accounts sitting
    // at a zero balance. Closed escrows are all there. `escrow:v:2830:117e86ad:p:vale` was missing
    // for a different reason: the same capture holds `escrow:v:2830:516e910d:p:vale` — the same
    // venture, the same tick, the same funder, a DIFFERENT ORDINAL. A venture id is
    // `hash(tick, principal, ordinal)`, so one action refused under changed rules renames every
    // venture minted afterwards. The world never minted the account the log names.
    //
    // So this fires when the posting log and the capture come from different worlds, which after an
    // accepted divergence they do. `planCheckpoint`'s `RECORD_SUPERSEDED` gate now catches that case
    // first and by name; this stays as the tripwire for a mismatch nothing declared — and stays
    // recoverable, because a log this build cannot rebuild is a reason to take the slow path and
    // never a reason to stop serving.
    throw new CheckpointUnusableError(
      `${where} moves value in account ${row.account}, which the snapshot's ledger capture does ` +
        'not contain. The capture lists every account the world holds and deletes none, so this is ' +
        'not an account that closed: it is one this world never minted. Two things produce that — a ' +
        'posting log written by a world a declared discontinuity has superseded (ids derived from a ' +
        'world-global ordinal are renamed by any refused action), or a log that belongs to a ' +
        'different journal. The record may be perfectly sound either way: replaying from genesis ' +
        're-derives every tick from the action log and checks it against its own snapshots.',
      'LEDGER_UNREBUILDABLE',
    );
  }
}

/** A {@link SnapshotRecord} as the engine's `adoptSnapshot` wants it. */
export function snapshotOf(record: SnapshotRecord): Snapshot {
  return {
    tick: record.tick,
    stateVersion: record.stateVersion,
    tables: record.tables,
    stateHash: record.stateHash,
  };
}
