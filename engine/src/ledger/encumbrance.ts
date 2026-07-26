/**
 * Encumbrances — locks, EXPOSURE, and the rule that an encumbrance is a claim on
 * a thing and never a shield over it.
 *
 * SPEC §3: **EXPOSURE** means Σ of your open `max_direct_loss`, *and nothing
 * else*. It is not "value committed". A lock over value that cannot be taken
 * therefore contributes **zero by construction** — `lockSafe` cannot be given a
 * `maxDirectLoss` at all, which is what dissolves the gaming problem (SPEC
 * §15.1): there is no field to shade, because safe locks have no field.
 *
 * The other half is PROP-L3. Locking value does not protect it. A raid can drain
 * a locked account and a front can burn pledged cargo; when that happens the lock
 * shrinks to what is actually there and the shortfall is a **recorded loss, not a
 * default** (SPEC §10.2). The alternative — encumbrance as armour — makes
 * "encumber everything" the dominant defensive move and kills the loss sink.
 *
 * One row per lock, one table, which is also why INV-5 is a sub-millisecond scan
 * (SPEC §15.1: "if Exposure is ever expensive, that is a symptom that locks are
 * scattered rather than in one table").
 */

import type {
  AccountId,
  Encumbrance,
  GrantId,
  PrincipalId,
  VentureId,
} from '../core/types.js';
import type { CanonicalValue } from '../core/canonical.js';
import { addMinor, minor, subMinor, type Minor } from '../core/units.js';
import { compareIds } from './order.js';

/** Why value is locked. An encumbrance with no live obligation is INV-4. */
export type ObligationRef = VentureId | GrantId;

/**
 * The single home of a lock. `core/types.ts:Encumbrance` is the read *projection*
 * of this row, built on demand by {@link EncumbranceBook.toEncumbrance} — its
 * fields are `readonly` and a lock's live amount changes when the value behind it
 * is destroyed, so storing both shapes would be one quantity with two homes.
 */
interface Row {
  readonly id: string;
  readonly principal: PrincipalId;
  readonly account: AccountId;
  amountMinor: Minor;
  readonly obligationRef: ObligationRef;
  maxDirectLoss: Minor;
  readonly openedTick: number;
  releasedAtTick: number | null;
}

export class EncumbranceError extends Error {}

/**
 * What the ledger needs to know about the world's obligations to detect orphans.
 * Injected, because the ledger must not know what a venture is — the venture
 * module owns that and this module must stay pure (SPEC §15.5).
 */
export interface ObligationBook {
  /** Is this obligation still live, i.e. may value still be locked for it? */
  isLive(ref: ObligationRef): boolean;
  /** Obligations that must be backed by at least one open encumbrance. */
  securedObligations(): readonly ObligationRef[];
}

/** An obligation book that knows nothing. Every lock is an orphan under it. */
export function emptyObligationBook(): ObligationBook {
  return { isLive: () => false, securedObligations: () => [] };
}

/** A mutable obligation book for the tick loop and for tests. */
export class SimpleObligationBook implements ObligationBook {
  private readonly live = new Set<ObligationRef>();
  private readonly secured = new Set<ObligationRef>();

  open(ref: ObligationRef, requiresEncumbrance = false): void {
    this.live.add(ref);
    if (requiresEncumbrance) this.secured.add(ref);
  }

  close(ref: ObligationRef): void {
    this.live.delete(ref);
    this.secured.delete(ref);
  }

  isLive(ref: ObligationRef): boolean {
    return this.live.has(ref);
  }

  securedObligations(): readonly ObligationRef[] {
    return [...this.secured].sort(compareIds);
  }

  /**
   * Both sets, for the hashed capture and the abort path.
   *
   * **Both, not just `live`.** `secured` is a strict subset by construction and it
   * would be tempting to carry only the superset and rebuild — but nothing in the
   * remaining state says *which* live obligations required an encumbrance, so a
   * rebuild would either mark every obligation secured (INV-4 halts on the first
   * unsecured one) or none (INV-4's "must be backed by an open encumbrance" clause
   * silently stops checking). Carrying only the headline set is precisely the
   * `EncumbranceBook` mistake this whole change exists to close.
   *
   * Sorted, because a `Set`'s iteration order is insertion order and two worlds that
   * opened the same obligations in different orders must hash the same.
   */
  capture(): CanonicalValue {
    return {
      live: [...this.live].sort(compareIds),
      secured: [...this.secured].sort(compareIds),
    };
  }

  /**
   * Replace both sets with a captured state. The inverse of {@link capture}.
   *
   * Refuses a `secured` entry that is not `live`: the two sets move together in
   * {@link open} and {@link close}, so a capture where they disagree describes a world
   * this class cannot produce, and restoring it would leave INV-4 demanding an
   * encumbrance for an obligation that no longer exists — a halt with no cause
   * attached to it, one tick after boot.
   */
  restore(state: ObligationCapture): void {
    for (const ref of state.secured) {
      if (!state.live.includes(ref)) {
        throw new EncumbranceError(
          `obligation ${ref} is captured as secured but not as live; a secured obligation is always ` +
            'live (both sets move together), so this capture describes a world the book cannot reach',
        );
      }
    }
    this.live.clear();
    this.secured.clear();
    for (const ref of state.live) this.live.add(ref);
    for (const ref of state.secured) this.secured.add(ref);
  }
}

/** The shape {@link SimpleObligationBook.restore} accepts, parsed from a capture. */
export interface ObligationCapture {
  readonly live: readonly ObligationRef[];
  readonly secured: readonly ObligationRef[];
}

export interface LockRequest {
  readonly eventId: string;
  readonly tick: number;
  readonly principal: PrincipalId;
  readonly account: AccountId;
  readonly amountMinor: Minor;
  readonly obligationRef: ObligationRef;
  /**
   * The most this lock can *lose*, not the most it can move. Bounds destruction
   * (PROP-G1) and is the only input to EXPOSURE. Non-negative, and deliberately
   * **not** capped at `amountMinor` — a haul locks the escrow and risks the cargo,
   * so the blast radius is routinely larger than the currency behind it.
   */
  readonly maxDirectLoss: Minor;
}

/** A lock over value that cannot be taken. It has no `maxDirectLoss` to shade. */
export type SafeLockRequest = Omit<LockRequest, 'maxDirectLoss'>;

/**
 * What the book needs to know about the account a lock sits in. Supplied by the
 * `Ledger`, so a lock cannot be created over value that is not there — INV-3's
 * third clause then holds by construction rather than being caught an hour later
 * at an `ASSERT` phase.
 */
export interface LockableAccount {
  readonly kind: string;
  readonly balanceMinor: Minor;
}

export type AccountLookup = (id: AccountId) => LockableAccount | undefined;

export class EncumbranceBook {
  private readonly rows = new Map<string, Row>();
  /** The cache INV-5 exists to check. Updated on every lock, release and reduction. */
  private readonly exposureCache = new Map<PrincipalId, Minor>();
  /** Per-event lock counter, so ids are content-derived rather than global. */
  private readonly perEvent = new Map<string, number>();

  constructor(private readonly lookup: AccountLookup) {}

  /**
   * Lock value for an obligation.
   *
   * `maxDirectLoss` is **not** capped at the amount locked, and that is deliberate:
   * a haul locks the escrow but risks the cargo too, so the blast radius of a
   * commitment routinely exceeds the currency behind it. The number is computed by
   * the engine and never supplied by an agent, so the thing that protects A7 is not
   * a cap here but INV-5's `served` check — the EXPOSURE an agent was shown is the
   * EXPOSURE the table holds.
   *
   * Locks live in STORES and nowhere else. Escrow is A7's *already committed* half —
   * locking it a second time would let the same value back two obligations, which is
   * the one thing `encumbrance_id` exists to prevent.
   */
  lock(req: LockRequest): string {
    if (req.amountMinor <= 0) {
      throw new EncumbranceError(`an encumbrance must lock a positive amount, got ${req.amountMinor}`);
    }
    if (req.maxDirectLoss < 0) {
      throw new EncumbranceError(`EXPOSURE cannot be negative, got ${req.maxDirectLoss}`);
    }
    const account = this.lookup(req.account);
    if (account === undefined) {
      throw new EncumbranceError(`INV-4: cannot lock value in unknown account ${req.account}`);
    }
    if (account.kind !== 'STORES') {
      throw new EncumbranceError(
        `a lock lives in a principal's STORES; ${req.account} is ${account.kind}`,
      );
    }
    const free = subMinor(account.balanceMinor, this.encumberedInAccount(req.account));
    if (req.amountMinor > free) {
      throw new EncumbranceError(
        `INV-3: ${req.account} has ${free} free and cannot lock ${req.amountMinor}`,
      );
    }
    const n = this.perEvent.get(req.eventId) ?? 0;
    this.perEvent.set(req.eventId, n + 1);
    const id = `enc:${req.eventId}:${n}`;
    if (this.rows.has(id)) throw new EncumbranceError(`duplicate encumbrance id ${id}`);

    this.rows.set(id, {
      id,
      principal: req.principal,
      account: req.account,
      amountMinor: req.amountMinor,
      obligationRef: req.obligationRef,
      maxDirectLoss: req.maxDirectLoss,
      openedTick: req.tick,
      releasedAtTick: null,
    });
    this.bumpCache(req.principal, req.maxDirectLoss);
    return id;
  }

  /**
   * Lock value that cannot be lost — Commons stores, or a claim already fully
   * funded from escrow. Contributes **zero** to EXPOSURE by construction: there
   * is no argument for `maxDirectLoss`, so there is nothing to under-declare.
   */
  lockSafe(req: SafeLockRequest): string {
    return this.lock({ ...req, maxDirectLoss: minor(0) });
  }

  release(id: string, tick: number): void {
    const row = this.rows.get(id);
    if (row === undefined) throw new EncumbranceError(`unknown encumbrance ${id}`);
    if (row.releasedAtTick !== null) {
      throw new EncumbranceError(`encumbrance ${id} was already released at tick ${row.releasedAtTick}`);
    }
    row.releasedAtTick = tick;
    this.bumpCache(row.principal, minor(0 - row.maxDirectLoss));
  }

  /**
   * Shrink a lock because the currency behind it is gone — a raid drained the
   * account. PROP-L3: an encumbrance is a claim on a thing, not a shield over it, so
   * the lock yields and the caller records the difference as a **loss**. It must not
   * record a default: the promise was not broken, the collateral was destroyed
   * (SPEC §10.2).
   *
   * **The row is never auto-released**, even when nothing is left in it. Releasing on
   * exhaustion would look tidy and would be a false-default generator: a secured
   * obligation would abruptly "lack its encumbrance" and any lot pledged to it would
   * become an orphan, so INV-4 would halt the tick in response to entirely
   * legitimate predation (SPEC §15.4). The claim still exists; it simply has nothing
   * behind it, which is exactly the story the record should tell. The obligation's
   * owner releases it at settlement.
   *
   * Returns the amount the lock gave up.
   */
  reduce(id: string, by: Minor): Minor {
    if (by < 0) throw new EncumbranceError(`cannot reduce an encumbrance by ${by}`);
    const row = this.row(id);
    const shed = minor(Math.min(by, row.amountMinor));
    row.amountMinor = subMinor(row.amountMinor, shed);
    // Less value behind the claim means less that can be lost from it.
    this.shedPeril(row, shed);
    return shed;
  }

  /**
   * Shrink a lock's **peril** without touching the currency it locks — the pledged
   * cargo burned, so the blast radius fell while the escrow is untouched. Separate
   * from {@link reduce} on purpose: one word per concept, and conflating "the money
   * went" with "the cargo went" is how EXPOSURE stops matching what an agent was
   * shown.
   */
  reducePeril(id: string, by: Minor): Minor {
    if (by < 0) throw new EncumbranceError(`cannot reduce peril by ${by}`);
    return this.shedPeril(this.row(id), by);
  }

  private shedPeril(row: Row, by: Minor): Minor {
    const shed = minor(Math.min(by, row.maxDirectLoss));
    row.maxDirectLoss = subMinor(row.maxDirectLoss, shed);
    this.bumpCache(row.principal, minor(0 - shed));
    return shed;
  }

  private row(id: string): Row {
    const row = this.rows.get(id);
    if (row === undefined) throw new EncumbranceError(`unknown encumbrance ${id}`);
    if (row.releasedAtTick !== null) throw new EncumbranceError(`encumbrance ${id} is released`);
    return row;
  }

  get(id: string): Encumbrance | undefined {
    const row = this.rows.get(id);
    return row === undefined ? undefined : toEncumbrance(row);
  }

  exists(id: string): boolean {
    return this.rows.has(id);
  }

  isOpen(id: string): boolean {
    return this.rows.get(id)?.releasedAtTick === null;
  }

  /** Open encumbrances, in code-unit id order so every scan is deterministic. */
  open(): readonly Encumbrance[] {
    return this.sortedRows()
      .filter((r) => r.releasedAtTick === null)
      .map(toEncumbrance);
  }

  openForAccount(account: AccountId): readonly Encumbrance[] {
    return this.open().filter((e) => e.account === account);
  }

  /** Locked currency in an account. Not spendable; still destructible (PROP-L3). */
  encumberedInAccount(account: AccountId): Minor {
    let acc = 0;
    for (const row of this.rows.values()) {
      if (row.releasedAtTick === null && row.account === account) acc += row.amountMinor;
    }
    return minor(acc);
  }

  /** Σ over every open lock. One of INV-2's buckets. */
  encumberedTotal(): Minor {
    let acc = 0;
    for (const row of this.rows.values()) {
      if (row.releasedAtTick === null) acc += row.amountMinor;
    }
    return minor(acc);
  }

  /** EXPOSURE, recomputed from the table. The authority INV-5 compares against. */
  recomputeExposure(principal: PrincipalId): Minor {
    let acc = 0;
    for (const row of this.rows.values()) {
      if (row.releasedAtTick === null && row.principal === principal) acc += row.maxDirectLoss;
    }
    return minor(acc);
  }

  /** The cached EXPOSURE the affordance layer reads. INV-5 asserts it is right. */
  cachedExposure(principal: PrincipalId): Minor {
    return this.exposureCache.get(principal) ?? minor(0);
  }

  principalsWithExposure(): readonly PrincipalId[] {
    const seen = new Set<PrincipalId>();
    for (const row of this.rows.values()) seen.add(row.principal);
    for (const p of this.exposureCache.keys()) seen.add(p);
    return [...seen].sort(compareIds);
  }

  private sortedRows(): Row[] {
    return [...this.rows.values()].sort((a, b) => compareIds(a.id, b.id));
  }

  private bumpCache(principal: PrincipalId, delta: Minor): void {
    const next = addMinor(this.cachedExposure(principal), delta);
    if (next === 0) this.exposureCache.delete(principal);
    else this.exposureCache.set(principal, next);
  }

  /** For the canonical state hash. Integers only; no floats reach a hash (DET-1). */
  canonicalRows(): readonly {
    readonly id: string;
    readonly principal: string;
    readonly account: string;
    readonly amountMinor: number;
    readonly obligationRef: string;
    readonly maxDirectLoss: number;
    readonly releasedAtTick: number | null;
  }[] {
    return this.sortedRows().map((r) => ({
      id: r.id,
      principal: r.principal,
      account: r.account,
      amountMinor: r.amountMinor,
      obligationRef: r.obligationRef,
      maxDirectLoss: r.maxDirectLoss,
      releasedAtTick: r.releasedAtTick,
    }));
  }

  /**
   * Everything this book owns, for the hashed capture and the abort path.
   *
   * This book was in **no state table at all** until now, which was the most
   * consequential omission in the engine and was found three times independently (a
   * codex ledger review, the boot-upgrade builder, and a direct test of
   * `ledgerStateTable.capture()`, which returned exactly
   * `{accounts, lots, postingCount, batchCount}`). Four things followed from it:
   *
   *   1. **Abort did not undo a lock.** A tick that opened an encumbrance and then
   *      aborted left it open — free balance reduced and exposure inflated for a
   *      commitment the world had rolled back.
   *   2. **`state_hash` could not see escrow.** Two worlds with different open locks
   *      hashed identically, so DET-1 was blind to divergent escrow. This is precisely
   *      the bug `ledgerStateTable` was written to fix ("a hash that cannot see the
   *      money is not a hash of the world"), one layer down.
   *   3. **A5′:** a world restored from a snapshot had escrowed stake silently
   *      spendable, because `freeBalance` reads this book and the book came back empty.
   *   4. It blocked checkpoint adoption, and therefore a bounded boot.
   *
   * All three maps are carried, not just `rows`. `exposureCache` is what INV-5 checks,
   * so restoring rows without it would resurrect the very mismatch INV-5 exists to
   * catch; and `perEvent` seeds content-derived ids, so dropping it would let a replayed
   * event mint an id that already exists and throw `duplicate encumbrance id`.
   */
  capture(): CanonicalValue {
    return {
      rows: [...this.rows.values()]
        .sort((a, b) => compareIds(a.id, b.id))
        .map((r) => ({
          id: r.id,
          principal: r.principal,
          account: r.account,
          amountMinor: r.amountMinor,
          obligationRef: r.obligationRef,
          maxDirectLoss: r.maxDirectLoss,
          openedTick: r.openedTick,
          releasedAtTick: r.releasedAtTick,
        })),
      exposure: [...this.exposureCache.entries()]
        .sort((a, b) => compareIds(a[0], b[0]))
        .map(([principal, amount]) => [principal, amount] as CanonicalValue),
      perEvent: [...this.perEvent.entries()]
        .sort((a, b) => compareIds(a[0], b[0]))
        .map(([eventId, n]) => [eventId, n] as CanonicalValue),
    };
  }

  /** Replace this book's contents with a captured state. The inverse of {@link capture}. */
  restore(state: EncumbranceCapture): void {
    this.rows.clear();
    this.exposureCache.clear();
    this.perEvent.clear();
    for (const r of state.rows) {
      this.rows.set(r.id, {
        id: r.id,
        principal: r.principal,
        account: r.account,
        amountMinor: r.amountMinor,
        obligationRef: r.obligationRef,
        maxDirectLoss: r.maxDirectLoss,
        openedTick: r.openedTick,
        releasedAtTick: r.releasedAtTick,
      });
    }
    for (const [principal, amount] of state.exposure) this.exposureCache.set(principal, amount);
    for (const [eventId, n] of state.perEvent) this.perEvent.set(eventId, n);
  }
}

/** The shape {@link EncumbranceBook.restore} accepts, parsed from a capture. */
export interface EncumbranceCapture {
  readonly rows: readonly {
    readonly id: string;
    readonly principal: PrincipalId;
    readonly account: AccountId;
    readonly amountMinor: Minor;
    readonly obligationRef: ObligationRef;
    readonly maxDirectLoss: Minor;
    readonly openedTick: number;
    readonly releasedAtTick: number | null;
  }[];
  readonly exposure: readonly (readonly [PrincipalId, Minor])[];
  readonly perEvent: readonly (readonly [string, number])[];
}

function toEncumbrance(row: Row): Encumbrance {
  return {
    id: row.id,
    principal: row.principal,
    account: row.account,
    amountMinor: row.amountMinor,
    obligationRef: row.obligationRef,
    maxDirectLoss: row.maxDirectLoss,
  };
}
