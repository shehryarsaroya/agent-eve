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
 * The gate clears itself. The day `StandingBook`, `SealBook`, the `EventLedger` and
 * the obligation book are registered as restorable tables, boot becomes bounded with
 * no change here; until then it is exactly as safe as it was.
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
import type { Posting } from '../core/types.js';
import { minor } from '../core/units.js';
import { qtyDelta } from '../ledger/delta.js';
import type { AppliedBatch, BatchKind, Ledger, SupplyDirection } from '../ledger/index.js';
import type { Snapshot, StateTable } from '../tick/index.js';
import type { JournalStore, PersistedPosting, SnapshotRecord } from './store.js';

export class HydrateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HydrateError';
  }
}

/**
 * Every state table that must be present **and restorable** before a checkpoint may
 * be adopted, because losing what it holds makes the world wrong rather than stale.
 *
 * The first eight are registered today. The rest are the books that are not, each
 * named with what its absence costs:
 *
 *   - `standing`     — A10. Reputation, defaults, elective honours. Resetting it is
 *                      the exact thing A10 says never happens, and `state_hash`
 *                      cannot see it happen.
 *   - `seal`         — §14 and the say-do gap. Sealed intentions and their verdicts.
 *   - `obligation`   — INV-4 checks every open lock against a live obligation. An
 *                      empty book turns every encumbrance into an orphan and halts
 *                      the first tick after boot.
 *   - `event`        — the append-only public record and its audience index. The feed
 *                      is served from Postgres, but `observe` reads this in-process.
 *   - `attribution`  — the default register INV-17 walks in both directions.
 *
 * **This list is hand-maintained, and that is its weakness.** It cannot see a book
 * added tomorrow and never listed here, so it under-reports by construction. The real
 * fix is for the engine to enumerate its own mutable books and assert that each is
 * either captured or explicitly declared ephemeral; until then this is a floor, not a
 * ceiling, and the equivalence test in `test/durability/` compares whole worlds rather
 * than hashes precisely because a hash cannot check this.
 *
 * One known gap that is not a table at all: `Runtime`'s private grant-id counter is
 * outside the `grant` capture, so an adopted world would re-mint ids from zero.
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
  // Not yet registered anywhere. Each one is why boot still replays from genesis.
  'attribution',
  'event',
  'obligation',
  'seal',
  'standing',
];

/** Why a checkpoint was not adopted, or null when one was. */
export interface CheckpointPlan {
  /** The snapshot to adopt, or null to replay from genesis. */
  readonly snapshot: SnapshotRecord | null;
  /** Operator-readable, and null exactly when {@link snapshot} is non-null. */
  readonly refusal: string | null;
}

export interface CheckpointOptions {
  /**
   * Override the manifest. Tests narrow it to prove the ledger half in isolation;
   * production must not, and boot's default is {@link CHECKPOINT_REQUIRED_TABLES}.
   */
  readonly requiredTables?: readonly string[];
  /** Never adopt, whatever the manifest says. The operator's "just replay it". */
  readonly disabled?: boolean;
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
    return { snapshot: null, refusal: 'checkpoint adoption disabled by the caller' };
  }
  const missing = missingCheckpointTables(tables, options.requiredTables);
  if (missing.length > 0) {
    return {
      snapshot: null,
      refusal:
        `checkpoint adoption refused: ${String(missing.length)} book(s) the world needs are in no ` +
        `restorable state table — ${missing.join(', ')}. A snapshot carries the state tables and ` +
        `state_hash hashes exactly those, so adopting one would drop these silently and the ` +
        `tripwire would still pass. Replaying from genesis instead.`,
    };
  }
  const snapshot = await store.latestSnapshot();
  if (snapshot === null) {
    return { snapshot: null, refusal: 'no snapshot in the journal to adopt' };
  }
  return { snapshot, refusal: null };
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

/**
 * Rebuild the ledger's append-only halves for `snapshot`, from the durable posting log.
 *
 * Refuses rather than repairs, at every step. A group whose rows disagree about the
 * batch they belong to, a posting against an account the snapshot never held, a row
 * written before the batch columns existed, a count that does not match the capture —
 * each is a boot that stops, because each of them silently produces a ledger whose
 * INV-7 mirrors are wrong in a way that would surface a tick later as a halt with no
 * cause attached to it.
 *
 * Returns the number of postings and batches restored.
 */
export async function hydrateLedgerForSnapshot(
  ledger: Ledger,
  store: JournalStore,
  snapshot: SnapshotRecord,
  pageTicks: number = HYDRATE_PAGE_TICKS,
): Promise<{ readonly postings: number; readonly batches: number }> {
  if (!Number.isSafeInteger(pageTicks) || pageTicks < 1) {
    throw new HydrateError(`hydrate needs a positive integer page size, got ${String(pageTicks)}`);
  }
  const facts = readLedgerCapture(snapshot);

  const batches: AppliedBatch[] = [];
  let open: { key: string; batch: AppliedBatch; postings: Posting[] } | null = null;
  let seen = 0;

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
    throw new HydrateError(
      `the snapshot at tick ${String(snapshot.tick)} was taken over ${String(facts.postingCount)} ` +
        'postings and the journal returned none. This store does not persist the posting log, so ' +
        'there is nothing to hydrate from and an adopted ledger would fail INV-7 on its first tick.',
    );
  }

  // The counts are checked inside `hydrateAppendOnly` against these same numbers, so
  // a short or long log is a refusal there rather than a truncation here.
  ledger.hydrateAppendOnly(batches, {
    postingCount: facts.postingCount,
    batchCount: facts.batchCount,
  });
  return { postings: facts.postingCount, batches: facts.batchCount };
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
    // Stronger than the foreign key this table used to carry: it compares against the
    // accounts the snapshot itself held AT that tick, not against whatever exists now.
    throw new HydrateError(
      `${where} moves value in account ${row.account}, which the snapshot's ledger capture does ` +
        'not contain. The posting log and the snapshot describe different worlds.',
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
