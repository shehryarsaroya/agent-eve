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
import { addMinor, minor, subMinor, type Minor } from '../core/units.js';
import { compareIds } from './batch.js';

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
  private readonly live = new Set<string>();
  private readonly secured = new Set<string>();

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
    return [...this.secured].sort(compareIds) as ObligationRef[];
  }
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
   * (PROP-G1) and is the only input to EXPOSURE. Must be 0..amountMinor.
   */
  readonly maxDirectLoss: Minor;
}

/** A lock over value that cannot be taken. It has no `maxDirectLoss` to shade. */
export type SafeLockRequest = Omit<LockRequest, 'maxDirectLoss'>;

export class EncumbranceBook {
  private readonly rows = new Map<string, Row>();
  /** The cache INV-5 exists to check. Updated on every lock, release and reduction. */
  private readonly exposureCache = new Map<PrincipalId, Minor>();
  /** Per-event lock counter, so ids are content-derived rather than global. */
  private readonly perEvent = new Map<string, number>();

  /**
   * Lock value for an obligation. `maxDirectLoss` is stated by the caller and
   * bounded by the lock, because a lock claiming to risk more than it holds makes
   * EXPOSURE a number an agent can inflate for free.
   */
  lock(req: LockRequest): string {
    if (req.amountMinor <= 0) {
      throw new EncumbranceError(`an encumbrance must lock a positive amount, got ${req.amountMinor}`);
    }
    if (req.maxDirectLoss < 0 || req.maxDirectLoss > req.amountMinor) {
      throw new EncumbranceError(
        `EXPOSURE must be 0..${req.amountMinor} for this encumbrance, got ${req.maxDirectLoss}`,
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
   * Shrink a lock because the value behind it is gone — a raid drained the
   * account, or the pledged cargo burned. PROP-L3: an encumbrance is a claim on a
   * thing, not a shield over it, so the lock yields and the caller records the
   * difference as a loss. It must not record a default: the promise was not
   * broken, the collateral was destroyed (SPEC §10.2).
   *
   * Returns the amount the lock gave up.
   */
  reduce(id: string, by: Minor, tick: number): Minor {
    if (by < 0) throw new EncumbranceError(`cannot reduce an encumbrance by ${by}`);
    const row = this.rows.get(id);
    if (row === undefined) throw new EncumbranceError(`unknown encumbrance ${id}`);
    if (row.releasedAtTick !== null) throw new EncumbranceError(`encumbrance ${id} is released`);
    const shed = minor(Math.min(by, row.amountMinor));
    row.amountMinor = subMinor(row.amountMinor, shed);
    // EXPOSURE can never exceed the value actually locked, so it shrinks with it.
    const lossShed = minor(Math.min(shed, row.maxDirectLoss));
    row.maxDirectLoss = subMinor(row.maxDirectLoss, lossShed);
    this.bumpCache(row.principal, minor(0 - lossShed));
    if (row.amountMinor === 0) row.releasedAtTick = tick;
    return shed;
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
    return [...seen].sort(compareIds) as PrincipalId[];
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
