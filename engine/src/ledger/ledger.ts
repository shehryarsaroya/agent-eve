/**
 * The ledger. In-memory, pure, deterministic.
 *
 * SPEC §15.5: "Keep the tick as pure in-memory code with Postgres as journal and
 * query surface." So nothing here touches a database, a clock or an unseeded
 * draw; ids are content-derived from the event that caused them, so a replay from
 * `(snapshot_T, action_log_T, seed_T)` reproduces this structure exactly (DET-3).
 *
 * **`posting` is authoritative for value** (SPEC §15.1). Two mirrors exist for
 * convenience and both are asserted against the postings at tick close rather
 * than trusted:
 *
 *   - `Account.balanceMinor` — Σ of that account's currency postings.
 *   - `Lot.qty` — where goods physically are; Σ per (account, good) must equal
 *     Σ of that account's goods postings for that good.
 *
 * Aggregate never crosses the mirror (INV-7). Scar #5 destroyed exactly 2× the
 * real value by summing a quantity and its mirror in a loss handler, and this
 * ledger's loss handler is `resolveCargoLost`, so the rule is written where the
 * bug would live.
 *
 * Fail closed. Every write validates the whole batch — INV-1 form, INV-3
 * non-negativity, the lot mirror — *before* mutating anything, and throws
 * `LedgerError` otherwise. A half-applied batch in an append-only ledger is a
 * permanent silent imbalance, which SPEC §15.3 correctly calls unrecoverable by
 * construction.
 */

import type { ValueLedger } from './accounts.js';
import { canonicalHash, type CanonicalValue } from '../core/canonical.js';
import type {
  AccountId,
  EventId,
  GoodId,
  Posting,
  PrincipalId,
  SystemId,
  VentureId,
} from '../core/types.js';
import { addMinor, minor, qty, subMinor, type Minor, type Qty } from '../core/units.js';
import {
  NAMED_SUPPLY_ACCOUNTS,
  escrowAccount,
  isWorldAccount,
  newAccount,
  storesAccount,
  type Account,
  type AccountKind,
} from './accounts.js';
import {
  checkBatchForm,
  postingLedger,
  type AppliedBatch,
  type BatchKind,
  type PostingDraft,
  type SupplyLeg,
} from './batch.js';
import { applyQtyDelta, qtyDelta } from './delta.js';
import { EncumbranceBook, type EncumbranceCapture } from './encumbrance.js';
import { EndowmentBook, type EndowmentRow } from './endowment.js';
import { lotId, type Lot, type LotId, type LotState } from './lots.js';
import { compareIds } from './order.js';

export class LedgerError extends Error {}

/** A change to an existing lot's size. The lot's account never changes. */
export interface LotDelta {
  readonly lotId: LotId;
  /** Signed, via `qtyDelta`. */
  readonly deltaQty: Qty;
}

export interface LotOpen {
  readonly id: LotId;
  readonly account: AccountId;
  readonly good: GoodId;
  readonly qty: Qty;
  readonly location: SystemId;
  readonly state: LotState;
  readonly origin: PrincipalId;
}

/** The raw door. Every convenience op below builds one of these. */
export interface BatchDraft {
  readonly eventId: EventId;
  readonly tick: number;
  readonly kind: BatchKind;
  readonly postings: readonly PostingDraft[];
  readonly supply: SupplyLeg | null;
  readonly opens: readonly LotOpen[];
  readonly deltas: readonly LotDelta[];
}

export interface CurrencySupply {
  /** STORES and ESCROW balances that no lock claims. */
  readonly free: Minor;
  /** Σ open encumbrance amounts. Locked, therefore unspendable — never unlosable. */
  readonly encumbered: Minor;
  /** Σ ESCROW balances. A7's escrowed part, which auto-executes at settlement. */
  readonly escrowed: Minor;
  readonly issued: Minor;
  readonly retired: Minor;
}

export interface GoodsSupply {
  readonly available: Qty;
  readonly inTransit: Qty;
  readonly escrowed: Qty;
  readonly issued: Qty;
  readonly retired: Qty;
}

export class Ledger {
  private readonly accounts = new Map<AccountId, Account>();
  private readonly lots = new Map<LotId, Lot>();
  /**
   * `account → its lot ids`. **Derived, never captured, never hashed.**
   *
   * `lotsInAccount` was `allLots().filter(...)`, and `allLots()` SORTS EVERY LOT IN THE GALAXY on
   * every call. `clearMarkets` reaches it through `escrowedGoods` once per ask principal per book, so
   * at a few hundred books and ten thousand lots that is ~10^8 comparator calls a tick — seconds, in
   * a design whose §15 budget is single-digit milliseconds. Unlike the other scaling findings this one
   * is **not history-dependent**: it bites at today's volumes.
   *
   * Safe as an index precisely because a lot's `account` is never reassigned in place — a move is a
   * delete plus an open — so there are exactly three sites to maintain: `restore`, the `opens` loop,
   * and the zero-qty delete. `allLots()` and the state table are untouched, so `state_hash` cannot
   * move; a differential test asserts the new answer equals the old one lot-for-lot.
   */
  private readonly lotsByAccount = new Map<AccountId, Set<LotId>>();
  private readonly postings: Posting[] = [];
  private readonly batches: AppliedBatch[] = [];
  /**
   * The lock table. Given a view of accounts so a lock can never be created over
   * value that is not there, nor inside an ESCROW account (which is A7's already
   * committed half).
   */
  readonly encumbrances = new EncumbranceBook((id) => this.accounts.get(id));
  /**
   * D7's per-principal endowment counter (`RULES_VERSION` 19).
   *
   * Lives here, and is written by exactly one method — {@link retireCurrency} — because
   * that is the single door through which currency is destroyed. Five call sites retire
   * today (a WORKS build, a syndicate founding, a graduation, a cession salvage, a bond
   * slash) and the sixth has not been written yet; hooking the door instead of the callers
   * is what makes the sixth correct for free. See `ledger/endowment.ts` for why this state
   * exists at all, given that the same file used to argue at length that it should not.
   */
  readonly endowments = new EndowmentBook();
  /** Set by {@link hydrateAppendOnly}. Boot-only, and only ever once. */
  private hydrated = false;

  constructor() {
    // The constitution, opened at construction. A faucet you have to remember to
    // open is a faucet someone opens ad hoc, and then supply has no closed set.
    for (const n of NAMED_SUPPLY_ACCOUNTS) {
      this.accounts.set(n.id, newAccount(n.id, n.kind, null, n.name, n.ledger));
    }
  }

  // ── Accounts ──────────────────────────────────────────────────────────────

  /**
   * Open a world account. `schema.sql` requires an owning principal on both
   * STORES and ESCROW, so both take one; FAUCET and SINK cannot be opened at all,
   * because the named set is closed.
   */
  openAccount(id: AccountId, kind: Extract<AccountKind, 'STORES' | 'ESCROW'>, principal: PrincipalId): Account {
    if (this.accounts.has(id)) throw new LedgerError(`account ${id} already exists`);
    const acct = newAccount(id, kind, principal, null, null);
    this.accounts.set(id, acct);
    return acct;
  }

  account(id: AccountId): Account | undefined {
    return this.accounts.get(id);
  }

  requireAccount(id: AccountId): Account {
    const a = this.accounts.get(id);
    if (a === undefined) throw new LedgerError(`unknown account ${id}`);
    return a;
  }

  /**
   * Put the mutable half back, and truncate the append-only half.
   *
   * The abort path (SPEC §15.2) and DET-3's replay both need this: without it the
   * ledger could not be a rollback-complete state table, so money sat outside
   * `state_hash` and a halted tick left balances dirty for the next one.
   *
   * Truncation is exact rather than approximate. `postings` and `batches` only ever
   * grow, so cutting them back to a captured length restores precisely the state the
   * snapshot was taken over — there is no partial row to unwind and no ordering to
   * rebuild. Growing them here would be a bug, so it is refused.
   *
   * **Cross-process boot does not weaken this.** A fresh process adopting a snapshot
   * from tick 287 puts the missing rows back from the durable record first — see
   * {@link hydrateAppendOnly} — so by the time this runs the lengths already match and
   * the truncation is a no-op. The refusal stays exactly as strict, because the thing
   * it catches (a capture describing a log this ledger never had) is still a corrupt
   * triple no matter which process asks.
   */
  restoreTo(state: {
    readonly accounts: readonly {
      readonly id: AccountId;
      readonly kind: AccountKind;
      readonly principal: PrincipalId | null;
      readonly name: string | null;
      readonly ledger: ValueLedger | null;
      readonly balanceMinor: Minor;
      readonly movedQty: ReadonlyMap<GoodId, Qty>;
    }[];
    readonly lots: readonly Lot[];
    /**
     * The open locks. Without this, `abort` restored balances but left every
     * encumbrance the aborted tick had opened — free balance reduced and exposure
     * inflated for a commitment the world had just rolled back.
     */
    readonly encumbrances: EncumbranceCapture;
    /**
     * D7's per-principal endowment counters. Restored for exactly the reason the
     * encumbrances are: an aborted tick that retired currency would otherwise keep the
     * decrement while the balance rolled back, and the two would disagree by the amount
     * of the rolled-back charge — which INV-7's fourth mirror halts on, correctly.
     */
    readonly endowments: readonly EndowmentRow[];
    readonly postingCount: number;
    readonly batchCount: number;
  }): void {
    if (state.postingCount > this.postings.length || state.batchCount > this.batches.length) {
      // A restore that had to ADD an append-only row would mean the snapshot came from
      // a future the ledger never reached — a corrupted triple, not a rollback.
      throw new LedgerError(
        `restore would grow an append-only table (postings ${String(this.postings.length)} -> ` +
          `${String(state.postingCount)}, batches ${String(this.batches.length)} -> ` +
          `${String(state.batchCount)}); the snapshot does not belong to this ledger`,
      );
    }

    this.accounts.clear();
    for (const a of state.accounts) {
      this.accounts.set(a.id, {
        id: a.id,
        kind: a.kind,
        principal: a.principal,
        name: a.name,
        ledger: a.ledger,
        balanceMinor: a.balanceMinor,
        movedQty: new Map(a.movedQty),
      });
    }

    this.lots.clear();
    this.lotsByAccount.clear();
    for (const lot of state.lots) {
      this.lots.set(lot.id, { ...lot });
      this.indexLot(lot.account, lot.id);
    }

    // The locks, restored with everything else. A lot carries only an `encumbranceId`
    // pointer, so restoring lots without the book leaves those pointers dangling at a
    // row that no longer exists — which reads as unencumbered cargo.
    this.encumbrances.restore(state.encumbrances);
    this.endowments.restore(state.endowments);

    this.postings.length = state.postingCount;
    this.batches.length = state.batchCount;
  }

  /**
   * Rebuild the append-only halves from the durable record, so a snapshot taken at
   * tick T can legitimately be adopted into a fresh process.
   *
   * ── WHY THIS EXISTS, AND WHY IT IS NOT A RELAXATION OF `restoreTo` ──────────
   *
   * {@link restoreTo} refuses to GROW `postings`/`batches`, and that refusal is
   * correct: inside one process, a capture can only ever describe a prefix of the log
   * the ledger already holds, so growth means the snapshot came from a future this
   * ledger never reached. Boot's problem is the *other* direction — a fresh process
   * has an almost-empty log and a snapshot from tick 287 — and the honest fix is to
   * put the missing rows back from the record rather than to teach the rollback path
   * to invent them.
   *
   * The rows are not optional decoration. `checkInv7` recomputes **every** account
   * balance by summing the whole posting log, and its third mirror recomputes faucet
   * and sink accumulators from every batch's supply leg, on every tick. A hydrated
   * ledger short by one row halts the first tick after boot; a hydrated ledger with
   * one row too many halts it just as loudly, in the opposite direction. So the
   * counts are checked against the snapshot's own capture and a mismatch is a
   * refusal, never a truncation: silently trimming to fit is how a boot loses a
   * posting and reports success.
   *
   * Call once, before adopting the matching snapshot. A second call is refused —
   * replacing a log the world has since extended would erase real history.
   */
  hydrateAppendOnly(
    batches: readonly AppliedBatch[],
    expected: { readonly postingCount: number; readonly batchCount: number },
  ): void {
    if (this.hydrated) {
      throw new LedgerError(
        'the append-only log has already been hydrated; a second hydrate would replace a log the world has since extended',
      );
    }
    if (!Number.isSafeInteger(expected.postingCount) || expected.postingCount < 0) {
      throw new LedgerError(`hydrate: postingCount ${String(expected.postingCount)} is not a count`);
    }
    if (!Number.isSafeInteger(expected.batchCount) || expected.batchCount < 0) {
      throw new LedgerError(`hydrate: batchCount ${String(expected.batchCount)} is not a count`);
    }

    const postings: Posting[] = [];
    const applied: AppliedBatch[] = [];
    let lastTick = Number.NEGATIVE_INFINITY;
    for (const [i, b] of batches.entries()) {
      const where = `hydrate: batch ${String(i)} (${b.eventId})`;
      if (b.postings.length === 0) {
        throw new LedgerError(`${where}: a value-moving batch with no postings (INV-1)`);
      }
      if (!Number.isSafeInteger(b.tick)) throw new LedgerError(`${where}: tick is not an integer`);
      if (b.tick < lastTick) {
        // Append order is the record's order. Out-of-order rows would still sum the
        // same, but they would mean the reader lost the ordering the log was written
        // in — and `allPostings()` is read positionally by `restoreTo`'s truncation.
        throw new LedgerError(
          `${where}: tick ${String(b.tick)} arrives after tick ${String(lastTick)}; the log is append-only in time`,
        );
      }
      lastTick = b.tick;
      if ((b.supply === null) !== (b.kind === 'TRANSFER')) {
        throw new LedgerError(
          `${where}: kind ${b.kind} ${b.supply === null ? 'carries no' : 'carries a'} supply leg; ` +
            'a TRANSFER never moves supply and an ISSUE/RETIRE always does (INV-1)',
        );
      }
      if (b.supply !== null && b.supply.direction !== b.kind) {
        throw new LedgerError(
          `${where}: kind ${b.kind} disagrees with supply direction ${b.supply.direction}`,
        );
      }
      for (const [j, p] of b.postings.entries()) {
        if (p.eventId !== b.eventId) {
          throw new LedgerError(
            `${where}: posting ${String(j)} carries event ${p.eventId}, not the batch's ${b.eventId}`,
          );
        }
        if (!Number.isSafeInteger(p.amountMinor)) {
          throw new LedgerError(`${where}: posting ${String(j)} amountMinor is not a safe integer`);
        }
        if (p.amountQty !== null && !Number.isSafeInteger(p.amountQty)) {
          throw new LedgerError(`${where}: posting ${String(j)} amountQty is not a safe integer`);
        }
        if (postingLedger(p) === null) {
          throw new LedgerError(
            `${where}: posting ${String(j)} on ${p.account} is neither a currency leg nor a goods leg`,
          );
        }
        postings.push(p);
      }
      applied.push(b);
    }

    if (postings.length !== expected.postingCount || applied.length !== expected.batchCount) {
      throw new LedgerError(
        `hydrate: the record yields ${String(postings.length)} postings in ${String(applied.length)} batches, ` +
          `but the snapshot was taken over ${String(expected.postingCount)} postings in ` +
          `${String(expected.batchCount)} batches. INV-7 sums the whole posting log every tick, so a ` +
          'hydrated ledger that is short or long halts the first tick after boot — refusing here instead.',
      );
    }

    this.postings.length = 0;
    this.postings.push(...postings);
    this.batches.length = 0;
    this.batches.push(...applied);
    this.hydrated = true;
  }

  allAccounts(): readonly Account[] {
    return [...this.accounts.values()].sort((a, b) => compareIds(a.id, b.id));
  }

  balance(id: AccountId): Minor {
    return this.requireAccount(id).balanceMinor;
  }

  /** Balance minus every open lock. What can actually be spent. */
  freeBalance(id: AccountId): Minor {
    return subMinor(this.balance(id), this.encumbrances.encumberedInAccount(id));
  }

  // ── Lots ──────────────────────────────────────────────────────────────────

  lot(id: LotId): Lot | undefined {
    return this.lots.get(id);
  }

  requireLot(id: LotId): Lot {
    const l = this.lots.get(id);
    if (l === undefined) throw new LedgerError(`unknown lot ${id}`);
    return l;
  }

  allLots(): readonly Lot[] {
    return [...this.lots.values()].sort((a, b) => compareIds(a.id, b.id));
  }

  private indexLot(account: AccountId, id: LotId): void {
    const set = this.lotsByAccount.get(account);
    if (set === undefined) this.lotsByAccount.set(account, new Set([id]));
    else set.add(id);
  }

  private unindexLot(account: AccountId, id: LotId): void {
    const set = this.lotsByAccount.get(account);
    if (set === undefined) return;
    set.delete(id);
    // Dropped when empty, or the map itself becomes the unbounded array (scar #3) keyed by every
    // account that ever held a lot.
    if (set.size === 0) this.lotsByAccount.delete(account);
  }

  lotsInAccount(account: AccountId): readonly Lot[] {
    // Sorted by id, exactly as the old `allLots().filter(...)` returned them: a global id sort
    // filtered to one account is the same sequence as that account's ids sorted. `lot-index.test.ts`
    // asserts the equality against the old implementation rather than trusting that sentence.
    const ids = this.lotsByAccount.get(account);
    if (ids === undefined) return [];
    const out: Lot[] = [];
    for (const id of ids) {
      const lot = this.lots.get(id);
      if (lot !== undefined) out.push(lot);
    }
    return out.sort((a, b) => compareIds(a.id, b.id));
  }

  /** Goods held in an account, by good. Derived from lots — the single home. */
  goodsInAccount(account: AccountId): ReadonlyMap<GoodId, Qty> {
    const out = new Map<GoodId, Qty>();
    for (const l of this.lotsInAccount(account)) {
      out.set(l.good, qty((out.get(l.good) ?? 0) + l.qty));
    }
    return out;
  }

  /**
   * Move a lot in space, or in and out of transit. No value moves, so there are
   * no postings — the movement event belongs to the world module, which is also
   * the only thing that knows the gate transit table (INV-10).
   */
  relocate(id: LotId, to: { readonly location?: SystemId; readonly state?: LotState }): void {
    const l = this.requireLot(id);
    if (to.location !== undefined) l.location = to.location;
    if (to.state !== undefined) l.state = to.state;
  }

  /**
   * Split `qty` off a lot into a **new lot in the same account**, and return its id.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **WHY THIS EXISTS, AND IT IS A DEFECT REPORT BEFORE IT IS A FEATURE.**
   *
   * `Runtime.consumeLevyGood` carries the scar in its own comment: *"`relocate` moves the WHOLE lot
   * and the ledger has no split, so paying a 500 assessment out of a 45,000 lot moved all 45,000 to
   * the Levy's place, destroyed 500, and left 44,500 stranded there."* A blind probe read that as a
   * 500-unit Levy destroying 45,000 units, and it was soft-locked out of every goods-priced verb in
   * the game — on a payment whose affordance promised `max_direct_loss: 500`.
   *
   * That was patched by relocating the remainder back, which works for a payment that happens inside
   * one tick and **cannot** work for `haul`, where part of a lot has to be somewhere else for many
   * ticks. So the missing primitive gets built rather than worked around a second time.
   *
   * ── WHY NO POSTINGS, WHICH IS THE CHECK THAT MATTERS ─────────────────────
   *
   * Same argument as {@link relocate}, one line above: *no value moves.* Both halves stay in the same
   * account, with the same good, so that account's balance and its lot total are both unchanged and
   * INV-7's mirror (`Σ lots per account === Σ postings per account`) holds by construction. A posting
   * pair here would be a transfer from an account to itself, which `transferGoods` rightly refuses.
   *
   * ── AND WHY A PLEDGED LOT MAY NOT BE SPLIT ───────────────────────────────
   *
   * `lots.ts` makes `encumbranceId` exclusive — *"a pledged lot cannot back a second obligation, and
   * cannot be sent away"*. Splitting one would silently produce an unpledged half out of collateral
   * somebody is relying on, which is INV-4 defeated by arithmetic rather than by a missing check.
   * ══════════════════════════════════════════════════════════════════════════
   *
   * `eventId` and `indexInEvent` derive the new id, so a replay produces the same ids without a
   * counter to snapshot (DET-3, DET-5).
   */
  splitLot(args: {
    readonly lotId: LotId;
    readonly qty: Qty;
    readonly eventId: EventId;
    readonly indexInEvent: number;
    readonly tick: number;
  }): LotId {
    const lot = this.requireLot(args.lotId);
    if (args.qty <= 0) throw new LedgerError(`a lot split must be positive, got ${args.qty}`);
    if (args.qty >= lot.qty) {
      throw new LedgerError(
        `INV-3: cannot split ${args.qty} off lot ${lot.id}, which holds ${lot.qty}; ` +
          'a split leaves both halves non-empty — move the whole lot instead',
      );
    }
    if (lot.encumbranceId !== null) {
      throw new LedgerError(
        `INV-4: lot ${lot.id} is pledged to ${lot.encumbranceId}; splitting it would produce an ` +
          'unpledged half out of collateral another obligation is relying on',
      );
    }
    const id = lotId(args.eventId, args.indexInEvent);
    if (this.lots.has(id)) throw new LedgerError(`duplicate lot id ${id}`);
    lot.qty = qty(lot.qty - args.qty);
    this.indexLot(lot.account, id);
    this.lots.set(id, {
      id,
      account: lot.account,
      good: lot.good,
      qty: args.qty,
      location: lot.location,
      state: lot.state,
      encumbranceId: null,
      createdTick: args.tick,
      origin: lot.origin,
    });
    return id;
  }

  // ── The record ────────────────────────────────────────────────────────────

  allPostings(): readonly Posting[] {
    return this.postings;
  }

  allBatches(): readonly AppliedBatch[] {
    return this.batches;
  }

  postingsFor(eventId: EventId): readonly Posting[] {
    return this.postings.filter((p) => p.eventId === eventId);
  }

  // ── Writes ────────────────────────────────────────────────────────────────

  /**
   * Apply a batch atomically. Validates first, mutates second; on any problem
   * nothing has changed and a `LedgerError` names the invariant.
   */
  apply(draft: BatchDraft): void {
    const problems = checkBatchForm(
      { kind: draft.kind, postings: draft.postings, supply: draft.supply, tick: draft.tick },
      { get: (id) => this.accounts.get(id) },
    );
    if (problems.length > 0) {
      throw new LedgerError(problems.map((p) => `${p.id}: ${p.message}`).join('; '));
    }

    this.checkLotMirror(draft);
    this.checkNoNegatives(draft);

    // ── commit ──
    const stamped: Posting[] = draft.postings.map((p) => ({
      eventId: draft.eventId,
      account: p.account,
      good: p.good,
      amountMinor: p.amountMinor,
      amountQty: p.amountQty,
    }));
    for (const p of stamped) {
      const acct = this.requireAccount(p.account);
      acct.balanceMinor = addMinor(acct.balanceMinor, p.amountMinor);
    }
    for (const open of draft.opens) {
      if (this.lots.has(open.id)) throw new LedgerError(`duplicate lot id ${open.id}`);
      this.indexLot(open.account, open.id);
      this.lots.set(open.id, {
        id: open.id,
        account: open.account,
        good: open.good,
        qty: open.qty,
        location: open.location,
        state: open.state,
        encumbranceId: null,
        createdTick: draft.tick,
        origin: open.origin,
      });
    }
    for (const d of draft.deltas) {
      const l = this.requireLot(d.lotId);
      l.qty = applyQtyDelta(l.qty, d.deltaQty);
      // A lot is where value sits, not a record; the record is the posting log.
      // (Never "a holding" — §3 reserves HOLDING for a principal's body on the
      // map and never for its assets, which are STORES.) Keeping
      // empty lots forever is scar #3's unbounded array with extra steps.
      if (l.qty === 0 && l.encumbranceId === null) {
        this.lots.delete(l.id);
        this.unindexLot(l.account, l.id);
      }
    }
    if (draft.supply !== null) {
      this.applySupplyLeg(draft.supply, stamped);
    }
    this.postings.push(...stamped);
    this.batches.push({
      eventId: draft.eventId,
      tick: draft.tick,
      kind: draft.kind,
      postings: stamped,
      supply: draft.supply,
    });
  }

  /** Mint currency from one of the two named faucets. One posting (INV-1 form B). */
  issueCurrency(args: {
    readonly eventId: EventId;
    readonly tick: number;
    readonly faucet: AccountId;
    readonly to: AccountId;
    readonly amount: Minor;
  }): void {
    this.apply({
      eventId: args.eventId,
      tick: args.tick,
      kind: 'ISSUE',
      postings: [{ account: args.to, good: null, amountMinor: args.amount, amountQty: null }],
      supply: { direction: 'ISSUE', account: args.faucet },
      opens: [],
      deltas: [],
    });
  }

  /**
   * Destroy currency into a named sink.
   *
   * Refuses to retire locked value, exactly as `transferCurrency` does. Upkeep and
   * fees are ordinary charges, not predation: if they could reach past a lock they
   * would drive `locked > balance` and INV-3 would HALT the tick in response to a
   * scheduled sink charge that broke no rule — the false-halt class of bug (SPEC
   * §15.4). Predation is the *only* thing that may take locked value, and it goes
   * through `seizeCurrency`, which sheds the locks it invalidates and reports them.
   */
  retireCurrency(args: {
    readonly eventId: EventId;
    readonly tick: number;
    readonly sink: AccountId;
    readonly from: AccountId;
    readonly amount: Minor;
  }): void {
    if (args.amount <= 0) throw new LedgerError(`a retirement must be positive, got ${args.amount}`);
    const free = this.freeBalance(args.from);
    if (free < args.amount) {
      throw new LedgerError(
        `INV-3: ${args.from} has ${free} free (balance ${this.balance(args.from)} less locks), cannot retire ${args.amount}`,
      );
    }
    this.apply({
      eventId: args.eventId,
      tick: args.tick,
      kind: 'RETIRE',
      postings: [
        { account: args.from, good: null, amountMinor: minor(0 - args.amount), amountQty: null },
      ],
      supply: { direction: 'RETIRE', account: args.sink },
      opens: [],
      deltas: [],
    });

    // ── D7 (`RULES_VERSION` 19): THE ENDOWMENT FALLS WITH THE MONEY IT PAID ────
    //
    // Currency that has been destroyed cannot be transferred, so the stake that paid for
    // it is spent and the counter must say so. Scoped to a principal's own STORES: an
    // ESCROW retiring into a sink is a venture's committed half, not a principal's purse,
    // and a faucet-to-sink flow has no principal at all. `endowments.retire` is
    // `freeCash`-neutral while any endowment is left, so this line never *creates*
    // transferable currency — it stops the floor from over-withholding money the
    // principal no longer has.
    const from = this.accounts.get(args.from);
    if (from !== undefined && from.kind === 'STORES' && from.principal !== null) {
      this.endowments.retire(from.principal, args.amount);
    }
  }

  /** Move currency between world accounts. Supply unchanged (INV-1 form A). */
  transferCurrency(args: {
    readonly eventId: EventId;
    readonly tick: number;
    readonly from: AccountId;
    readonly to: AccountId;
    readonly amount: Minor;
  }): void {
    if (args.amount <= 0) throw new LedgerError(`a transfer must be positive, got ${args.amount}`);
    if (args.from === args.to) throw new LedgerError('a transfer needs two accounts');
    // Locked value is unspendable. It is still destructible — see `seizeCurrency`.
    const free = this.freeBalance(args.from);
    if (free < args.amount) {
      throw new LedgerError(
        `INV-3: ${args.from} has ${free} free (balance ${this.balance(args.from)} less locks), cannot transfer ${args.amount}`,
      );
    }
    this.apply({
      eventId: args.eventId,
      tick: args.tick,
      kind: 'TRANSFER',
      postings: [
        { account: args.from, good: null, amountMinor: minor(0 - args.amount), amountQty: null },
        { account: args.to, good: null, amountMinor: args.amount, amountQty: null },
      ],
      supply: null,
      opens: [],
      deltas: [],
    });
  }

  /**
   * Predation: take currency that a lock claims. PROP-L3 in the currency ledger —
   * an encumbrance is a claim on value, not armour over it, and SPEC §15.4's
   * false-default scenario is exactly this ("my convoy is raided and X is
   * drained"). The locks that were relying on the seized value shrink, and the
   * returned `locksReduced` is what the venture module records as a **loss**. It
   * must not be recorded as a default: nobody broke a promise here.
   */
  seizeCurrency(args: {
    readonly eventId: EventId;
    readonly tick: number;
    readonly from: AccountId;
    readonly to: AccountId;
    readonly amount: Minor;
  }): { readonly seized: Minor; readonly locksReduced: readonly { id: string; shed: Minor }[] } {
    const available = this.balance(args.from);
    const seized = minor(Math.min(args.amount, Math.max(available, 0)));
    if (seized <= 0) return { seized: minor(0), locksReduced: [] };

    this.apply({
      eventId: args.eventId,
      tick: args.tick,
      kind: 'TRANSFER',
      postings: [
        { account: args.from, good: null, amountMinor: minor(0 - seized), amountQty: null },
        { account: args.to, good: null, amountMinor: seized, amountQty: null },
      ],
      supply: null,
      opens: [],
      deltas: [],
    });
    return { seized, locksReduced: this.reduceLocksToBalance(args.from) };
  }

  /**
   * Bring an account's locks back inside its balance after value left it. Runs in
   * descending id order, so the **newest** lock sheds first and the oldest claim
   * keeps its priority — which is what "escrow guarantees payment priority" has to
   * mean once there is less to pay from. Deterministic either way; stated so it is
   * a chosen rule rather than an incidental one.
   */
  reduceLocksToBalance(account: AccountId): readonly { id: string; shed: Minor }[] {
    const reduced: { id: string; shed: Minor }[] = [];
    let over = subMinor(this.encumbrances.encumberedInAccount(account), this.balance(account));
    if (over <= 0) return reduced;
    const open = [...this.encumbrances.openForAccount(account)].sort((a, b) => compareIds(b.id, a.id));
    for (const enc of open) {
      if (over <= 0) break;
      const shed = this.encumbrances.reduce(enc.id, minor(Math.min(over, enc.amountMinor)));
      if (shed > 0) reduced.push({ id: enc.id, shed });
      over = subMinor(over, shed);
    }
    if (over > 0) {
      throw new LedgerError(`INV-3: ${account} still has ${over} locked beyond its balance`);
    }
    return reduced;
  }

  /** Create goods. Extraction and production are the only sources (SPEC §10.2). */
  sourceGoods(args: {
    readonly eventId: EventId;
    readonly tick: number;
    readonly faucet: AccountId;
    readonly to: AccountId;
    readonly good: GoodId;
    readonly qty: Qty;
    readonly location: SystemId;
    readonly origin: PrincipalId;
  }): LotId {
    const id = lotId(args.eventId, 0);
    this.apply({
      eventId: args.eventId,
      tick: args.tick,
      kind: 'ISSUE',
      postings: [
        { account: args.to, good: args.good, amountMinor: minor(0), amountQty: qtyDelta(args.qty) },
      ],
      supply: { direction: 'ISSUE', account: args.faucet },
      opens: [
        {
          id,
          account: args.to,
          good: args.good,
          qty: args.qty,
          location: args.location,
          state: 'AVAILABLE',
          origin: args.origin,
        },
      ],
      deltas: [],
    });
    return id;
  }

  /**
   * Destroy goods into a named sink. **Works on an encumbered lot on purpose**
   * (PROP-L3): escrow guarantees payment priority, never that the goods survive.
   * The lien on the destroyed portion is not a shield, and if the lot goes to zero
   * its lien is cleared so it cannot become an orphan (INV-4).
   */
  destroyGoods(args: {
    readonly eventId: EventId;
    readonly tick: number;
    readonly sink: AccountId;
    readonly lotId: LotId;
    readonly qty: Qty;
  }): void {
    const lot = this.requireLot(args.lotId);
    if (args.qty <= 0) throw new LedgerError(`destruction must be positive, got ${args.qty}`);
    if (args.qty > lot.qty) {
      throw new LedgerError(`INV-3: cannot destroy ${args.qty} of ${lot.good}; lot holds ${lot.qty}`);
    }
    const goesEmpty = args.qty === lot.qty;
    if (goesEmpty) lot.encumbranceId = null;
    this.apply({
      eventId: args.eventId,
      tick: args.tick,
      kind: 'RETIRE',
      postings: [
        {
          account: lot.account,
          good: lot.good,
          amountMinor: minor(0),
          amountQty: qtyDelta(0 - args.qty),
        },
      ],
      supply: { direction: 'RETIRE', account: args.sink },
      opens: [],
      deltas: [{ lotId: args.lotId, deltaQty: qtyDelta(0 - args.qty) }],
    });
  }

  /**
   * Move goods between accounts. A lot never changes account: the source lot
   * shrinks and a new lot opens at the destination carrying the same provenance
   * and location (P16). A pledged lot cannot be sent away — the lien is exclusive,
   * which is the whole point of `encumbrance_id`.
   */
  transferGoods(args: {
    readonly eventId: EventId;
    readonly tick: number;
    readonly lotId: LotId;
    readonly to: AccountId;
    readonly qty: Qty;
    readonly openIndex?: number;
  }): LotId {
    const lot = this.requireLot(args.lotId);
    if (args.qty <= 0) throw new LedgerError(`a goods transfer must be positive, got ${args.qty}`);
    if (args.qty > lot.qty) {
      throw new LedgerError(`INV-3: cannot move ${args.qty} of ${lot.good}; lot holds ${lot.qty}`);
    }
    if (lot.encumbranceId !== null) {
      throw new LedgerError(
        `INV-4: lot ${lot.id} is pledged to encumbrance ${lot.encumbranceId} and cannot back a second obligation`,
      );
    }
    if (lot.account === args.to) throw new LedgerError('a goods transfer needs two accounts');
    const id = lotId(args.eventId, args.openIndex ?? 0);
    this.apply({
      eventId: args.eventId,
      tick: args.tick,
      kind: 'TRANSFER',
      postings: [
        {
          account: lot.account,
          good: lot.good,
          amountMinor: minor(0),
          amountQty: qtyDelta(0 - args.qty),
        },
        { account: args.to, good: lot.good, amountMinor: minor(0), amountQty: qtyDelta(args.qty) },
      ],
      supply: null,
      opens: [
        {
          id,
          account: args.to,
          good: lot.good,
          qty: args.qty,
          location: lot.location,
          state: lot.state,
          origin: lot.origin,
        },
      ],
      deltas: [{ lotId: args.lotId, deltaQty: qtyDelta(0 - args.qty) }],
    });
    return id;
  }

  /** Pledge a lot to an obligation. Exclusive, so the same goods back one thing. */
  pledgeLot(lotIdent: LotId, encumbranceId: string): void {
    const lot = this.requireLot(lotIdent);
    if (lot.encumbranceId !== null) {
      throw new LedgerError(`INV-4: lot ${lotIdent} is already pledged to ${lot.encumbranceId}`);
    }
    if (!this.encumbrances.isOpen(encumbranceId)) {
      throw new LedgerError(`INV-4: encumbrance ${encumbranceId} is not open`);
    }
    lot.encumbranceId = encumbranceId;
  }

  unpledgeLot(lotIdent: LotId): void {
    this.requireLot(lotIdent).encumbranceId = null;
  }

  // ── Supply ────────────────────────────────────────────────────────────────

  /**
   * INV-2 for currency. `free + encumbered + escrowed === issued − retired`, where
   * the three buckets **partition** every unit in the world: locks live only inside
   * STORES (the book refuses anything else), escrow is its own account kind, and
   * currency never travels. A unit in two buckets would make this identity a
   * tautology that hides scar #5 rather than an assertion that finds it.
   */
  currencySupply(): CurrencySupply {
    let stores = 0;
    let escrowed = 0;
    let issued = 0;
    let retired = 0;
    for (const a of this.accounts.values()) {
      switch (a.kind) {
        case 'STORES':
          stores += a.balanceMinor;
          break;
        case 'ESCROW':
          escrowed += a.balanceMinor;
          break;
        case 'FAUCET':
          issued -= a.balanceMinor;
          break;
        case 'SINK':
          retired += a.balanceMinor;
          break;
      }
    }
    const encumbered = this.encumbrances.encumberedTotal();
    return {
      free: subMinor(minor(stores), encumbered),
      encumbered,
      escrowed: minor(escrowed),
      issued: minor(issued),
      retired: minor(retired),
    };
  }

  /**
   * INV-2 per good. `available + inTransit + escrowed === issued − retired`.
   * In-transit is a lot state, so a convoy's cargo is counted exactly once —
   * counting it both as a balance and as freight is scar #5.
   */
  goodsSupply(): ReadonlyMap<GoodId, GoodsSupply> {
    const acc = new Map<GoodId, { available: number; inTransit: number; escrowed: number; issued: number; retired: number }>();
    const bucket = (g: GoodId) => {
      const cur = acc.get(g);
      if (cur !== undefined) return cur;
      const fresh = { available: 0, inTransit: 0, escrowed: 0, issued: 0, retired: 0 };
      acc.set(g, fresh);
      return fresh;
    };
    for (const lot of this.lots.values()) {
      const a = this.requireAccount(lot.account);
      const b = bucket(lot.good);
      if (a.kind === 'ESCROW') b.escrowed += lot.qty;
      else if (lot.state === 'IN_TRANSIT') b.inTransit += lot.qty;
      else b.available += lot.qty;
    }
    for (const a of this.accounts.values()) {
      if (a.kind !== 'FAUCET' && a.kind !== 'SINK') continue;
      for (const [good, moved] of a.movedQty) {
        const b = bucket(good);
        if (a.kind === 'FAUCET') b.issued += moved;
        else b.retired += moved;
      }
    }
    const out = new Map<GoodId, GoodsSupply>();
    for (const good of [...acc.keys()].sort(compareIds)) {
      const b = acc.get(good);
      if (b === undefined) continue;
      out.set(good, {
        available: qty(b.available),
        inTransit: qty(b.inTransit),
        escrowed: qty(b.escrowed),
        issued: qty(b.issued),
        retired: qty(b.retired),
      });
    }
    return out;
  }

  /**
   * A canonical projection of the whole ledger, for `state_hash`. Integers only —
   * `canonicalize` throws on a float, which is the cheapest possible float
   * detector in the value path (DET-1, DET-4).
   */
  stateHash(): string {
    const value: CanonicalValue = {
      accounts: this.allAccounts().map((a) => ({
        id: a.id,
        kind: a.kind,
        balanceMinor: a.balanceMinor,
        movedQty: [...a.movedQty.keys()]
          .sort(compareIds)
          .map((g) => ({ good: g, qty: a.movedQty.get(g) ?? 0 })),
      })),
      lots: this.allLots().map((l) => ({
        id: l.id,
        account: l.account,
        good: l.good,
        qty: l.qty,
        location: l.location,
        state: l.state,
        encumbranceId: l.encumbranceId,
      })),
      encumbrances: this.encumbrances.canonicalRows().map((r) => ({
        id: r.id,
        principal: r.principal,
        account: r.account,
        amountMinor: r.amountMinor,
        obligationRef: r.obligationRef,
        maxDirectLoss: r.maxDirectLoss,
        releasedAtTick: r.releasedAtTick,
      })),
      postingCount: this.postings.length,
    };
    return canonicalHash(value);
  }

  // ── Validation ────────────────────────────────────────────────────────────

  private applySupplyLeg(supply: SupplyLeg, postings: readonly Posting[]): void {
    const acct = this.requireAccount(supply.account);
    for (const p of postings) {
      const leg = postingLedger(p);
      if (leg === 'CURRENCY') {
        // A faucet runs negative by what it issued; a sink positive by what it
        // retired. That sign convention is what makes INV-2 pure arithmetic.
        acct.balanceMinor = subMinor(acct.balanceMinor, p.amountMinor);
      } else if (leg === 'GOODS' && p.good !== null && p.amountQty !== null) {
        const magnitude = Math.abs(p.amountQty);
        acct.movedQty.set(p.good, qty((acct.movedQty.get(p.good) ?? 0) + magnitude));
      }
    }
  }

  /**
   * INV-7 at write time: goods postings and lot movements must agree per
   * (account, good). Checking here as well as at tick close is deliberate — the
   * tick-close assertion tells you the ledger is broken, this one tells you which
   * batch broke it, and only one of those is debuggable at 03:00.
   */
  private checkLotMirror(draft: BatchDraft): void {
    const fromPostings = new Map<string, number>();
    for (const p of draft.postings) {
      if (p.good === null || p.amountQty === null) continue;
      const k = `${p.account}\u0000${p.good}`;
      fromPostings.set(k, (fromPostings.get(k) ?? 0) + p.amountQty);
    }
    const fromLots = new Map<string, number>();
    for (const o of draft.opens) {
      const k = `${o.account}\u0000${o.good}`;
      fromLots.set(k, (fromLots.get(k) ?? 0) + o.qty);
    }
    for (const d of draft.deltas) {
      const l = this.requireLot(d.lotId);
      const k = `${l.account}\u0000${l.good}`;
      fromLots.set(k, (fromLots.get(k) ?? 0) + d.deltaQty);
    }
    for (const k of new Set([...fromPostings.keys(), ...fromLots.keys()])) {
      const a = fromPostings.get(k) ?? 0;
      const b = fromLots.get(k) ?? 0;
      if (a !== b) {
        const [account, good] = k.split('\u0000');
        throw new LedgerError(
          `INV-7: ${String(good)} in ${String(account)} moves ${a} in postings but ${b} in lots — one quantity, two homes`,
        );
      }
    }
  }

  /** INV-3, before the write rather than after it. */
  private checkNoNegatives(draft: BatchDraft): void {
    const projected = new Map<AccountId, number>();
    for (const p of draft.postings) {
      const acct = this.requireAccount(p.account);
      projected.set(p.account, (projected.get(p.account) ?? acct.balanceMinor) + p.amountMinor);
    }
    for (const [id, next] of projected) {
      const acct = this.requireAccount(id);
      if (isWorldAccount(acct.kind) && next < 0) {
        throw new LedgerError(`INV-3: ${id} would go to ${next}; no non-faucet account may go negative`);
      }
    }
    for (const d of draft.deltas) {
      const l = this.requireLot(d.lotId);
      if (l.qty + d.deltaQty < 0) {
        throw new LedgerError(
          `INV-3: lot ${l.id} would go to ${l.qty + d.deltaQty} of ${l.good}; a quantity is never negative`,
        );
      }
    }
    for (const o of draft.opens) {
      if (o.qty <= 0) throw new LedgerError(`a new lot must hold something, got ${o.qty} of ${o.good}`);
    }
  }
}

/**
 * Open a principal's STORES at the conventional id. A separate helper because
 * "the principal's stores" is a phrase the rest of the engine says constantly and
 * spelling the id by hand in each caller is how two spellings appear.
 */
export function openStores(l: Ledger, principal: PrincipalId): Account {
  return l.openAccount(storesAccount(principal), 'STORES', principal);
}

/** The escrow a venture pays from. Its funder owns it, per `schema.sql`. */
export function openVentureEscrow(l: Ledger, venture: VentureId, funder: PrincipalId): Account {
  return l.openAccount(escrowAccount(venture, funder), 'ESCROW', funder);
}
