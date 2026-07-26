/**
 * The syndicate book: who is pooled with whom, under what constitution.
 *
 * ## The one rule that makes this safe to add (D11)
 *
 * A syndicate holds pooled stores, `schema.sql` requires a `principal_id` on every STORES account,
 * so **a syndicate is a principal with no keypair**: it cannot sign a request and cannot act. That
 * choice is what lets an OFFICE be an ordinary `grant` whose grantor happens to be a syndicate,
 * inheriting every A6 guarantee instead of re-implementing them.
 *
 * It also means a syndicate inherits every rule written for principals, **including the ones nobody
 * thought of as rules** — and D11 found the sharp one before this file existed: the Levy is payable
 * only in goods carried by a present hand, a syndicate has no hands, so a syndicate on the Levy roll
 * would default every Reckoning forever. That is A5′ with our own org model as the cause, and worse
 * than a crash, because an org showing a hundred consecutive defaults teaches every reader that the
 * default column is noise.
 *
 * {@link Book.isSyndicate} is the predicate the Levy, the docket and INV-25 consult, and it exists
 * so that exclusion is **one rule with one home** rather than three call sites that agree today.
 */

import type { CanonicalValue } from '../core/canonical.js';
import type { PrincipalId } from '../core/types.js';
import { compareIds } from '../ledger/order.js';
import { readArray, readInt, readObject, readString, SnapshotError, type StateTable } from '../tick/snapshot.js';
import { captureCharter, restoreCharter, type Charter } from './charter.js';
import { MAX_MEMBERS, MAX_SYNDICATES, MAX_SYNDICATES_PER_PRINCIPAL } from './params.js';

export type SyndicateId = string & { readonly __brand: 'SyndicateId' };

/** Content-derived from the founder and the tick, so replay mints the same id. */
export function syndicateId(founder: PrincipalId, tick: number): SyndicateId {
  return `syn:${founder}:${String(tick)}` as SyndicateId;
}

/**
 * A syndicate is addressed as a principal wherever value moves, because its stores account must
 * name one. The two ids are the same string, deliberately: one identity, not a mapping to keep in
 * step.
 */
export function syndicateAsPrincipal(id: SyndicateId): PrincipalId {
  return id as unknown as PrincipalId;
}

export interface Membership {
  readonly principal: PrincipalId;
  readonly joinedAtTick: number;
  /** Set when notice is given; the stake leaves the pool at this tick, never before. */
  readonly leavesAtTick: number | null;
}

export interface SyndicateRecord {
  readonly id: SyndicateId;
  readonly name: string;
  readonly founder: PrincipalId;
  readonly foundedAtTick: number;
  /** Fixed at founding. There is no verb that amends one — see `charter.ts`. */
  readonly charter: Charter;
  readonly members: readonly Membership[];
  readonly dissolvedAtTick: number | null;
}

export class SyndicateError extends Error {}

export class Book {
  private readonly rows = new Map<SyndicateId, SyndicateRecord>();

  /**
   * Is this principal id actually a syndicate?
   *
   * **The predicate D11's rule hangs on**, consulted by the Levy roll, the docket builder and
   * INV-25. One home, because "a syndicate is not a Levy subject" enforced at three call sites is a
   * rule that lapses the first time somebody adds a fourth.
   */
  isSyndicate(principal: PrincipalId): boolean {
    return this.rows.has(principal as unknown as SyndicateId);
  }

  at(id: SyndicateId): SyndicateRecord | null {
    return this.rows.get(id) ?? null;
  }

  liveInOrder(): readonly SyndicateRecord[] {
    return [...this.rows.values()]
      .filter((r) => r.dissolvedAtTick === null)
      .sort((a, b) => compareIds(a.id, b.id));
  }

  /** Syndicates this principal sits in, canonical order. Excludes ones it has noticed out of. */
  of(principal: PrincipalId, tick: number): readonly SyndicateRecord[] {
    return this.liveInOrder().filter((r) =>
      r.members.some(
        (m) => m.principal === principal && (m.leavesAtTick === null || tick < m.leavesAtTick),
      ),
    );
  }

  isMember(id: SyndicateId, principal: PrincipalId, tick: number): boolean {
    const row = this.rows.get(id);
    if (row === undefined || row.dissolvedAtTick !== null) return false;
    return row.members.some(
      (m) => m.principal === principal && (m.leavesAtTick === null || tick < m.leavesAtTick),
    );
  }

  /** Sitting members at `tick`, canonical order. The denominator every vote rule divides by. */
  sittingMembers(id: SyndicateId, tick: number): readonly PrincipalId[] {
    const row = this.rows.get(id);
    if (row === undefined) return [];
    return row.members
      .filter((m) => m.leavesAtTick === null || tick < m.leavesAtTick)
      .map((m) => m.principal)
      .sort(compareIds);
  }

  form(args: {
    readonly founder: PrincipalId;
    readonly name: string;
    readonly charter: Charter;
    readonly tick: number;
  }): SyndicateRecord {
    if (this.rows.size >= MAX_SYNDICATES) {
      throw new SyndicateError(`the world holds ${String(MAX_SYNDICATES)} syndicates, which is the cap`);
    }
    const id = syndicateId(args.founder, args.tick);
    if (this.rows.has(id)) throw new SyndicateError(`${id} already exists`);
    const row: SyndicateRecord = {
      id,
      name: args.name,
      founder: args.founder,
      foundedAtTick: args.tick,
      charter: args.charter,
      members: [{ principal: args.founder, joinedAtTick: args.tick, leavesAtTick: null }],
      dissolvedAtTick: null,
    };
    this.rows.set(id, row);
    return row;
  }

  /** Why `principal` may not join `id` right now, or null. The affordance and the verb share it. */
  admissionFault(id: SyndicateId, principal: PrincipalId, tick: number): string | null {
    const row = this.rows.get(id);
    if (row === null || row === undefined) return `${id} is not a syndicate.`;
    if (row.dissolvedAtTick !== null) return `${id} has been dissolved.`;
    if (this.isMember(id, principal, tick)) return `you are already a member of ${id}.`;
    if (this.sittingMembers(id, tick).length >= MAX_MEMBERS) {
      return `${id} holds ${String(MAX_MEMBERS)} members, which is the cap.`;
    }
    if (this.of(principal, tick).length >= MAX_SYNDICATES_PER_PRINCIPAL) {
      return `you already sit in ${String(MAX_SYNDICATES_PER_PRINCIPAL)} syndicates, which is the cap.`;
    }
    if (row.charter.admission === 'CLOSED') {
      return `${id}'s charter is CLOSED: its founding membership is final and nobody else ever joins. That clause is permanent.`;
    }
    return null;
  }

  admit(id: SyndicateId, principal: PrincipalId, tick: number): void {
    const row = this.rows.get(id);
    if (row === undefined) throw new SyndicateError(`${id} does not exist`);
    const fault = this.admissionFault(id, principal, tick);
    if (fault !== null) throw new SyndicateError(fault);
    this.rows.set(id, {
      ...row,
      members: [...row.members, { principal, joinedAtTick: tick, leavesAtTick: null }],
    });
  }

  /**
   * Give notice. The member stays sitting until `leavesAtTick`, and its stake stays pooled.
   *
   * Notice rather than instant exit because a pool a member can drain the moment it dislikes a vote
   * is a pool no office can be trusted with and no counterparty can price — and because a departure
   * visible for a full settlement is a departure an audience can watch coming.
   */
  giveNotice(id: SyndicateId, principal: PrincipalId, leavesAtTick: number): void {
    const row = this.rows.get(id);
    if (row === undefined) throw new SyndicateError(`${id} does not exist`);
    if (principal === row.founder) {
      throw new SyndicateError(
        `${principal} founded ${id} and a founder cannot give notice; dissolve it instead, which pays every member out.`,
      );
    }
    this.rows.set(id, {
      ...row,
      members: row.members.map((m) =>
        m.principal === principal && m.leavesAtTick === null ? { ...m, leavesAtTick } : m,
      ),
    });
  }

  dissolve(id: SyndicateId, tick: number): void {
    const row = this.rows.get(id);
    if (row === undefined) throw new SyndicateError(`${id} does not exist`);
    this.rows.set(id, { ...row, dissolvedAtTick: tick });
  }

  get size(): number {
    return this.rows.size;
  }

  capture(): CanonicalValue {
    return {
      syndicates: [...this.rows.values()]
        .sort((a, b) => compareIds(a.id, b.id))
        .map((r) => ({
          id: r.id,
          name: r.name,
          founder: r.founder,
          foundedAtTick: r.foundedAtTick,
          charter: captureCharter(r.charter),
          members: [...r.members]
            .sort((a, b) => compareIds(a.principal, b.principal))
            .map((m) => ({
              principal: m.principal,
              joinedAtTick: m.joinedAtTick,
              leavesAtTick: m.leavesAtTick,
            })),
          dissolvedAtTick: r.dissolvedAtTick,
        })),
    };
  }

  restore(captured: CanonicalValue): void {
    this.rows.clear();
    const root = readObject(captured, 'syndicate');
    for (const [i, raw] of readArray(root['syndicates'] ?? [], 'syndicate.syndicates').entries()) {
      const where = `syndicate.syndicates[${String(i)}]`;
      const o = readObject(raw, where);
      const dissolved = o['dissolvedAtTick'];
      const members = readArray(o['members'] ?? [], `${where}.members`).map((rawMember, j) => {
        const mw = `${where}.members[${String(j)}]`;
        const m = readObject(rawMember, mw);
        const leaves = m['leavesAtTick'];
        return {
          principal: readString(m, 'principal', mw) as PrincipalId,
          joinedAtTick: readInt(m, 'joinedAtTick', mw),
          leavesAtTick: leaves === null || leaves === undefined ? null : readInt(m, 'leavesAtTick', mw),
        };
      });
      const row: SyndicateRecord = {
        id: readString(o, 'id', where) as SyndicateId,
        name: readString(o, 'name', where),
        founder: readString(o, 'founder', where) as PrincipalId,
        foundedAtTick: readInt(o, 'foundedAtTick', where),
        charter: restoreCharter(o['charter'] ?? {}, `${where}.charter`),
        members,
        dissolvedAtTick: dissolved === null || dissolved === undefined ? null : readInt(o, 'dissolvedAtTick', where),
      };
      if (this.rows.has(row.id)) throw new SnapshotError(`${where}: duplicate syndicate ${row.id}`);
      this.rows.set(row.id, row);
    }
  }
}

/** In `state_hash` and the rollback set, for the reason every other book is. */
export function syndicateStateTable(getBook: () => Book, setBook: (book: Book) => void): StateTable {
  return {
    name: 'syndicate',
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
