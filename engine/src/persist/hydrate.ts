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
import { snapshotHashOf, type Snapshot, type StateTable } from '../tick/index.js';
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
  // After the manifest, not before it: the manifest is the standing reason and the one
  // an operator needs named on every boot today. The rules gate is the one that bites
  // on the day the manifest clears.
  if (options.rulesChanged === true) {
    return {
      snapshot: null,
      refusal:
        'checkpoint adoption refused: the journal was written under a different RULES_VERSION. ' +
        'Adoption re-derives nothing and the tail after the latest Reckoning carries no snapshot to ' +
        'check against, so a rules change would take effect with no tripwire and no divergence ' +
        'record. Replaying from genesis so the mismatch is found and the operator door is offered.',
    };
  }
  const snapshot = await store.latestSnapshot();
  if (snapshot === null) {
    return { snapshot: null, refusal: 'no snapshot in the journal to adopt' };
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
  // So it is probed here, before anything moves, on the cheapest decisive page there
  // is: the snapshot's OWN tick. A snapshot is written at a Reckoning and a Reckoning
  // appends its receipts, so that tick has rows whenever the store keeps any. A store
  // that keeps them and happens to have none there costs a genesis replay, which is
  // the safe direction to be wrong in.
  const want = eventCountOf(snapshot);
  if (want > 0) {
    const page = await store.ticksPage(snapshot.tick - 1, 1);
    const carried = page[0]?.events.length ?? 0;
    if (carried === 0) {
      return {
        snapshot: null,
        refusal:
          `checkpoint adoption refused: the snapshot at tick ${String(snapshot.tick)} was taken over ` +
          `${String(want)} events and this store returns none for that tick. It does not persist the ` +
          'append-only record, so an adopted world would come up with an empty public ledger. ' +
          'Replaying from genesis, which rebuilds the record tick by tick.',
      };
    }
  }
  return { snapshot, refusal: null };
}

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
  }
  drainLate(snapshot.tick);

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
