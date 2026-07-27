/**
 * The WORKS book: which places are being worked, by whom, and what each tick yields them.
 *
 * ## Two rules hold this together, and both are about the yield cap
 *
 * 1. **A system's yield is divided, never multiplied.** {@link Book.sharesAt} splits
 *    `YIELD_PER_TICK[tier]` across the live WORKS at that system with the Levy's own
 *    `largestRemainder`, so Σ shares === the tier yield *exactly*. A split that rounded up
 *    would mint goods out of arithmetic, which is the A15 hole this design exists to close —
 *    and it would do it invisibly, a unit at a time, at every system, every tick.
 *
 * 2. **Order is canonical, never insertion.** Shares are assigned in `compareIds` order over
 *    the WORKS ids, because largest-remainder's tie-break is index order: two worlds that
 *    admitted the same WORKS in a different sequence must extract the same amounts, or
 *    replay diverges and every hash after it is wrong.
 */

import type { CanonicalValue } from '../core/canonical.js';
import type { PrincipalId, SystemId, ZoneTier } from '../core/types.js';
import { qty, type Minor, type Qty } from '../core/units.js';
import { compareIds } from '../ledger/order.js';
import { largestRemainder } from '../levy/assessment.js';
import {
  readArray,
  readInt,
  readObject,
  readString,
  SnapshotError,
  type StateTable,
} from '../tick/snapshot.js';
import { WORKS_PER_PRINCIPAL_PER_SYSTEM, WORKS_SPINUP_TICKS, YIELD_PER_TICK } from './params.js';

/** A WORKS id is content-derived from its place and the tick it was raised. */
export type WorksId = string & { readonly __brand: 'WorksId' };

export function worksId(system: SystemId, tick: number, holder: PrincipalId): WorksId {
  return `works:${system}:${String(tick)}:${holder}` as WorksId;
}

export interface WorksRecord {
  readonly id: WorksId;
  readonly system: SystemId;
  readonly holder: PrincipalId;
  readonly raisedAtTick: number;
  /** The tick from which it extracts. `raisedAtTick + WORKS_SPINUP_TICKS`. */
  readonly onlineAtTick: number;
  /** Ended WORKS stay in the book: the record is append-only and A5 has no opt-out. */
  readonly razed: boolean;
  readonly razedAtTick: number | null;
  /** Cumulative units extracted. The audit trail, and what the frame draws. */
  extracted: Qty;
}

export class WorksError extends Error {}

/**
 * Split a quantity into `n` equal-as-possible parts summing to it exactly.
 *
 * `largestRemainder` lives in the Levy and is typed in `Minor`, because that is what the Levy
 * divides. The algorithm itself is unit-agnostic integer arithmetic — it is the *sum-exactly*
 * property this module needs, and reimplementing it here to satisfy the type would mean two
 * copies of the one piece of arithmetic that must never round in our favour.
 *
 * So the units are laundered **once, here, with the reason**, rather than at each call site
 * where the cast would look like carelessness. `Qty` and `Minor` are branded apart on purpose
 * and that is worth keeping; this is the single crossing.
 */
function splitQty(total: Qty, parts: number): readonly Qty[] {
  const shares = largestRemainder(total as unknown as Minor, Array.from({ length: parts }, () => 1));
  return shares.map((n) => qty(Number(n)));
}

export class Book {
  private readonly rows = new Map<WorksId, WorksRecord>();

  /** Live WORKS at a system, canonical order. The order the share split depends on. */
  liveAt(system: SystemId): readonly WorksRecord[] {
    return [...this.rows.values()]
      .filter((w) => w.system === system && !w.razed)
      .sort((a, b) => compareIds(a.id, b.id));
  }

  at(id: WorksId): WorksRecord | null {
    return this.rows.get(id) ?? null;
  }

  ofPrincipal(holder: PrincipalId): readonly WorksRecord[] {
    return [...this.rows.values()]
      .filter((w) => w.holder === holder && !w.razed)
      .sort((a, b) => compareIds(a.id, b.id));
  }

  /**
   * Every WORKS this world has ever raised, razed ones included, canonical order.
   *
   * The only accessor that does not filter `razed`, and it exists for the world-memory projections
   * (`frames/memory.ts`). Every other reader wants the live set because it is asking a question about
   * the present — what extracts, what divides a yield, what a principal holds. A place is named for
   * whoever first opened it whether or not that WORKS still stands, so history needs the whole book,
   * and the book keeps ended rows precisely so it can be asked (A5 has no opt-out).
   */
  everInOrder(): readonly WorksRecord[] {
    return [...this.rows.values()].sort((a, b) => compareIds(a.id, b.id));
  }

  /** Every live WORKS, canonical order. What PRODUCE walks. */
  liveInOrder(): readonly WorksRecord[] {
    return [...this.rows.values()].filter((w) => !w.razed).sort((a, b) => compareIds(a.id, b.id));
  }

  /** Systems with at least one live WORKS, canonical order. */
  workedSystems(): readonly SystemId[] {
    const out = new Set<SystemId>();
    for (const w of this.liveInOrder()) out.add(w.system);
    return [...out].sort(compareIds);
  }

  holdsAt(holder: PrincipalId, system: SystemId): number {
    return this.liveAt(system).filter((w) => w.holder === holder).length;
  }

  atCapacity(holder: PrincipalId, system: SystemId): boolean {
    return this.holdsAt(holder, system) >= WORKS_PER_PRINCIPAL_PER_SYSTEM;
  }

  raise(args: {
    readonly system: SystemId;
    readonly holder: PrincipalId;
    readonly tick: number;
  }): WorksRecord {
    const id = worksId(args.system, args.tick, args.holder);
    if (this.rows.has(id)) throw new WorksError(`${id} already exists`);
    const row: WorksRecord = {
      id,
      system: args.system,
      holder: args.holder,
      raisedAtTick: args.tick,
      onlineAtTick: args.tick + WORKS_SPINUP_TICKS,
      razed: false,
      razedAtTick: null,
      extracted: qty(0),
    };
    this.rows.set(id, row);
    return row;
  }

  raze(id: WorksId, tick: number): void {
    const row = this.rows.get(id);
    if (row === undefined) throw new WorksError(`${id} does not exist`);
    this.rows.set(id, { ...row, razed: true, razedAtTick: tick });
  }

  credit(id: WorksId, amount: Qty): void {
    const row = this.rows.get(id);
    if (row === undefined) throw new WorksError(`${id} does not exist`);
    row.extracted = qty(row.extracted + amount);
  }

  /**
   * This tick's extraction, per WORKS, at one system — **summing to the tier yield exactly.**
   *
   * A WORKS still spinning up takes no share and, deliberately, **does not dilute** the
   * others: it is not yet extracting, so counting it would let a principal suppress a rival's
   * output by raising a structure it never finishes. The share is over the *online* set.
   */
  sharesAt(system: SystemId, tier: ZoneTier, tick: number): ReadonlyMap<WorksId, Qty> {
    const online = this.liveAt(system).filter((w) => tick >= w.onlineAtTick);
    const out = new Map<WorksId, Qty>();
    if (online.length === 0) return out;
    const yieldHere = YIELD_PER_TICK[tier];
    // Equal weights: a WORKS is a WORKS. Weighting by anything a principal controls would
    // be a lever to buy a bigger share of a fixed pool, which is the cap defeated.
    const shares = splitQty(yieldHere, online.length);
    for (const [i, w] of online.entries()) out.set(w.id, shares[i] ?? qty(0));
    return out;
  }

  get size(): number {
    return this.rows.size;
  }

  capture(): CanonicalValue {
    return {
      works: [...this.rows.values()]
        .sort((a, b) => compareIds(a.id, b.id))
        .map((w) => ({
          id: w.id,
          system: w.system,
          holder: w.holder,
          raisedAtTick: w.raisedAtTick,
          onlineAtTick: w.onlineAtTick,
          razed: w.razed,
          razedAtTick: w.razedAtTick,
          extracted: w.extracted,
        })),
    };
  }

  restore(captured: CanonicalValue): void {
    this.rows.clear();
    const root = readObject(captured, 'works');
    for (const [i, raw] of readArray(root['works'] ?? [], 'works.works').entries()) {
      const where = `works.works[${String(i)}]`;
      const o = readObject(raw, where);
      const razedAt = o['razedAtTick'];
      const row: WorksRecord = {
        id: readString(o, 'id', where) as WorksId,
        system: readString(o, 'system', where) as SystemId,
        holder: readString(o, 'holder', where) as PrincipalId,
        raisedAtTick: readInt(o, 'raisedAtTick', where),
        onlineAtTick: readInt(o, 'onlineAtTick', where),
        razed: readBool(o, 'razed', where),
        razedAtTick: razedAt === null || razedAt === undefined ? null : readInt(o, 'razedAtTick', where),
        extracted: qty(readInt(o, 'extracted', where)),
      };
      if (this.rows.has(row.id)) throw new SnapshotError(`${where}: duplicate WORKS ${row.id}`);
      this.rows.set(row.id, row);
    }
  }
}

/**
 * The WORKS book inside `state_hash` and the rollback set.
 *
 * Not optional and not a later step. A book that decides how many goods enter the world
 * every tick, sitting outside the hash, is the keystone defect the `EncumbranceBook` already
 * had once: two worlds that disagree about who is extracting what would hash the same, and
 * an aborted tick would leave the extraction counters advanced.
 */
export function worksStateTable(getBook: () => Book, setBook: (book: Book) => void): StateTable {
  return {
    name: 'works',
    capture(): CanonicalValue {
      return getBook().capture();
    },
    restore(captured: CanonicalValue): void {
      const fresh = new Book();
      fresh.restore(captured);
      setBook(fresh);
    },
  };
}

/** Local, like `sovereignty/book.ts`'s: the shared readers have no boolean. */
function readBool(o: Readonly<Record<string, CanonicalValue>>, key: string, where: string): boolean {
  const value = o[key];
  if (typeof value !== 'boolean') throw new SnapshotError(`${where}.${key} must be a boolean`);
  return value;
}
