/**
 * The **GrantBook** — the live table of scoped authority one principal has handed
 * another (SPEC §8, A6). This is the surface an attacker works against, so it is
 * built to be captured into `state_hash`, restored on abort, and replayed from the
 * journal — the same three properties money and ventures already have.
 *
 * ── WHAT LIVES HERE, AND WHAT DOES NOT ──────────────────────────────────────
 * A {@link Grant} row is the *authoritative* record of a live grant: its claims
 * (grantor, delegate, template, LIMITS, expiry) plus the two mutable quantities the
 * signed credential deliberately does NOT carry — `spentDirect`/`spentContingent`
 * (server state that changes every act; see `identity/vc.ts`) and `revokedAtTick`.
 *
 * The credential is the *portable* form: a delegate verifies its own authority
 * offline and a counterparty verifies a delegate before dealing (`verifyGrantCredential`).
 * The row is the *enforced* form: this book is what the tick loop checks a delegate's
 * on-behalf act against, and it is inside the hash so two worlds that disagree about
 * who may spend whose stores can never hash the same.
 *
 * Spend on the row is a **cache**, exactly as EXPOSURE is for the ledger: INV-22
 * recomputes the true spend from the `GrantSpend` journal and treats the counter here
 * as a value to be checked, because a per-row counter incremented by two concurrent
 * delegates is the read-modify-write race that lets a spend slip past its LIMIT with a
 * counter that still looks clean.
 */

import type { Grant, GrantId, PrincipalId } from '../core/types.js';
import { compareIds } from '../ledger/order.js';
import { addMinor, minor, type Minor } from '../core/units.js';
import { isExpiredAt, isRevokedAt } from '../identity/vc.js';
import type { CanonicalValue } from '../core/canonical.js';
import type { StateTable } from '../tick/snapshot.js';
import {
  readArray as snapArray,
  readInt as snapInt,
  readIntOrNull as snapIntOrNull,
  readObject as snapObject,
  readString as snapString,
} from '../tick/snapshot.js';

export class GrantBookError extends Error {}

export class GrantBook {
  private readonly byId = new Map<GrantId, Grant>();

  get(id: GrantId): Grant | undefined {
    return this.byId.get(id);
  }

  has(id: GrantId): boolean {
    return this.byId.has(id);
  }

  /** Every grant, in canonical id order — the order capture and any docket must use. */
  all(): readonly Grant[] {
    return [...this.byId.values()].sort((a, b) => compareIds(a.id, b.id));
  }

  /**
   * Record a newly-issued grant. A grant id is minted once and never reused, so a
   * collision is a bug in the minter, not a legitimate overwrite — refuse it rather
   * than silently replacing a live grant (and its accrued spend) with a fresh one.
   */
  add(grant: Grant): void {
    if (this.byId.has(grant.id)) {
      throw new GrantBookError(`grant ${grant.id} already exists; ids are minted once and never reused`);
    }
    this.byId.set(grant.id, grant);
  }

  /**
   * Revoke a grant. SPEC §8.1 #6: revocation is always accepted and takes effect the
   * NEXT tick (see {@link isRevokedAt}); the attempted revocation is what posts, which
   * is better drama than either extreme. Kept idempotent-earliest: a second revoke can
   * only move the effective tick earlier, never un-revoke or delay.
   */
  revoke(id: GrantId, atTick: number): Grant {
    const grant = this.byId.get(id);
    if (grant === undefined) throw new GrantBookError(`no grant ${id} to revoke`);
    if (grant.revokedAtTick === null || atTick < grant.revokedAtTick) {
      grant.revokedAtTick = atTick;
    }
    return grant;
  }

  /**
   * Add one delegate draw against a grant's LIMITS — the cache INV-22 audits. Both
   * halves move separately because LIMITS cap destruction, not just transfers (SPEC
   * §8.1 #2): a delegate can burn a grantor's cargo without moving a coin, and a book
   * that only tracked the direct half would show a clean grant over a total loss.
   */
  recordSpend(id: GrantId, direct: Minor, contingent: Minor): void {
    const grant = this.byId.get(id);
    if (grant === undefined) throw new GrantBookError(`no grant ${id} to spend against`);
    grant.spentDirect = addMinor(grant.spentDirect, direct);
    grant.spentContingent = addMinor(grant.spentContingent, contingent);
  }

  /** Remaining headroom on a grant's two LIMITS, never below zero. */
  headroom(id: GrantId): { readonly direct: Minor; readonly contingent: Minor } {
    const grant = this.byId.get(id);
    if (grant === undefined) throw new GrantBookError(`no grant ${id}`);
    return {
      direct: minor(Math.max(0, grant.maxDirectLoss - grant.spentDirect)),
      contingent: minor(Math.max(0, grant.maxContingentLiability - grant.spentContingent)),
    };
  }

  /**
   * Is this grant usable at `atTick`? Exists, not expired, not revoked — the three
   * gates every on-behalf act must pass before its LIMITS are even consulted. The
   * clock rules are `vc.ts`'s, imported rather than reimplemented (one home per rule).
   */
  isLive(id: GrantId, atTick: number): boolean {
    const grant = this.byId.get(id);
    if (grant === undefined) return false;
    return !isExpiredAt(grant.expiresTick, atTick) && !isRevokedAt(grant.revokedAtTick, atTick);
  }

  /**
   * The live grant authorising `delegate` to act for `grantor` at `atTick`, or null.
   *
   * At most one is expected per (grantor, delegate) pair at a time, but if more than
   * one is live the one with the most direct headroom is returned — a delegate should
   * be told the most it can do, and picking deterministically (headroom, then id)
   * keeps replay stable.
   */
  liveGrantBetween(grantor: PrincipalId, delegate: PrincipalId, atTick: number): Grant | null {
    const candidates = this.all().filter(
      (g) => g.grantor === grantor && g.delegate === delegate && this.isLive(g.id, atTick),
    );
    if (candidates.length === 0) return null;
    return candidates.reduce((best, g) => {
      const bh = best.maxDirectLoss - best.spentDirect;
      const gh = g.maxDirectLoss - g.spentDirect;
      if (gh > bh) return g;
      if (gh < bh) return best;
      return compareIds(g.id, best.id) < 0 ? g : best;
    });
  }

  forDelegate(delegate: PrincipalId): readonly Grant[] {
    return this.all().filter((g) => g.delegate === delegate);
  }

  forGrantor(grantor: PrincipalId): readonly Grant[] {
    return this.all().filter((g) => g.grantor === grantor);
  }
}

/**
 * The state-table descriptor: how the GrantBook enters `state_hash`, the abort
 * rollback, and persistence replay. Mirrors `electionsStateTable` — a canonical,
 * id-sorted array of rows out, a fresh book rebuilt on the way back.
 *
 * Every field is captured, including the three mutable ones. Leaving `spentDirect`,
 * `spentContingent` or `revokedAtTick` out of the capture would let a rolled-back or
 * replayed world believe a delegate had spent nothing against a grant it had drained
 * — the "state outside the hash" class the ledger and elections were both pulled into
 * the hash to close (fable F2).
 */
export function grantsStateTable(
  read: () => GrantBook,
  write: (restored: GrantBook) => void,
): StateTable {
  return {
    name: 'grant',
    capture: (): CanonicalValue =>
      read()
        .all()
        .map((g) => ({
          id: g.id,
          grantor: g.grantor,
          delegate: g.delegate,
          template: g.template,
          maxDirectLoss: g.maxDirectLoss,
          maxContingentLiability: g.maxContingentLiability,
          spentDirect: g.spentDirect,
          spentContingent: g.spentContingent,
          expiresTick: g.expiresTick,
          revokedAtTick: g.revokedAtTick,
        })),
    restore: (captured: CanonicalValue): void => {
      const rows = snapArray(captured, 'grant');
      const book = new GrantBook();
      for (const row of rows) {
        const r = snapObject(row, 'grant row');
        const id = snapString(r, 'id', 'grant row') as GrantId;
        book.add({
          id,
          grantor: snapString(r, 'grantor', `grant ${id}`) as PrincipalId,
          delegate: snapString(r, 'delegate', `grant ${id}`) as PrincipalId,
          template: snapString(r, 'template', `grant ${id}`),
          maxDirectLoss: minor(snapInt(r, 'maxDirectLoss', `grant ${id}`)),
          maxContingentLiability: minor(snapInt(r, 'maxContingentLiability', `grant ${id}`)),
          spentDirect: minor(snapInt(r, 'spentDirect', `grant ${id}`)),
          spentContingent: minor(snapInt(r, 'spentContingent', `grant ${id}`)),
          expiresTick: snapInt(r, 'expiresTick', `grant ${id}`),
          revokedAtTick: snapIntOrNull(r, 'revokedAtTick', `grant ${id}`),
        });
      }
      write(book);
    },
  };
}
