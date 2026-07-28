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

import type { EventId, Grant, GrantId, PrincipalId } from '../core/types.js';
import { compareIds } from '../ledger/order.js';
import { addMinor, minor, type Minor } from '../core/units.js';
import { isExpiredAt, isRevokedAt } from '../identity/vc.js';
import type { GrantSpend } from '../invariants/authority.js';
import type { CanonicalValue } from '../core/canonical.js';
import type { StateTable } from '../tick/snapshot.js';
import { canonicalClearance, canonicalVerbs } from './compartment.js';
import {
  readArray as snapArray,
  readInt as snapInt,
  readIntOrNull as snapIntOrNull,
  readObject as snapObject,
  readString as snapString,
} from '../tick/snapshot.js';

export class GrantBookError extends Error {}

/**
 * A cap on the spend journal (INV-26). Every on-behalf act that draws on a grant
 * appends one row; the journal is summed at every tick close, so it is bounded both to
 * keep `state_hash` finite and to keep INV-22's recompute cheap. Generous — grants
 * expire and a real world's live spend is small.
 */
export const MAX_GRANT_SPENDS = 16_384;

export class GrantBook {
  private readonly byId = new Map<GrantId, Grant>();

  /**
   * The spend journal INV-22 audits (SPEC §8.1 #1). The row caches (`spentDirect` /
   * `spentContingent`) are the fast read; this is the source of truth the invariant
   * recomputes from, because a per-row counter incremented by two delegates is a race
   * and a journal is not. Append-only within a run; captured and replayed with the rows.
   */
  private readonly spendLog: GrantSpend[] = [];

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
   * Record one delegate draw against a grant's LIMITS: append it to the journal INV-22
   * audits AND advance the row cache. Both halves move separately because LIMITS cap
   * destruction, not just transfers (SPEC §8.1 #2): a delegate can burn a grantor's
   * cargo without moving a coin, and a book that only tracked the direct half would show
   * a clean grant over a total loss.
   *
   * This does NOT enforce headroom — the caller checks {@link headroom} before it moves
   * any value, so a refusal leaves the world untouched. Recording a spend that overran
   * the LIMIT would be caught at tick close by INV-22 and halt the world, which is the
   * backstop, not the gate.
   */
  recordSpend(spend: GrantSpend): void {
    const grant = this.byId.get(spend.grant);
    if (grant === undefined) throw new GrantBookError(`no grant ${spend.grant} to spend against`);
    if (spend.direct < 0 || spend.contingent < 0) {
      throw new GrantBookError(`a spend never returns headroom: direct ${spend.direct}, contingent ${spend.contingent}`);
    }
    // ── THE FENCE, AT THE BOOK RATHER THAN ONLY AT THE DOOR ──────────────────
    //
    // Each caller checks `carriesVerb` before it moves value, so this is unreachable from a
    // request — exactly like the negative-spend throw above it, and there for the same
    // reason. A draw recorded against a verb the grant does not carry is a **wrong row in a
    // journal INV-22 halts the world over**, and A5′ says the record must never be wrong:
    // better to abort the tick here, where the operator sees the grant id and the verb, than
    // to publish a journal that accuses a delegate of a draw it was not authorised to make.
    if (!grant.verbs.includes(spend.verb)) {
      throw new GrantBookError(
        `grant ${grant.id} carries ${grant.verbs.length === 0 ? 'no verbs' : grant.verbs.join(', ')} and this ` +
          `draw is on "${spend.verb}"; the caller must check carriesVerb before it moves value`,
      );
    }
    if (this.spendLog.length >= MAX_GRANT_SPENDS) {
      throw new GrantBookError(`the grant spend journal is at its cap of ${MAX_GRANT_SPENDS}`);
    }
    grant.spentDirect = addMinor(grant.spentDirect, spend.direct);
    grant.spentContingent = addMinor(grant.spentContingent, spend.contingent);
    this.spendLog.push(spend);
  }

  /** The spend journal, in the order draws were recorded. INV-22's source of truth. */
  allSpends(): readonly GrantSpend[] {
    return this.spendLog;
  }

  /**
   * Restore-only: repopulate the spend journal from a capture. Bypasses the cap and the
   * cache bump on purpose — the row caches were already restored from the captured rows,
   * so replaying them through {@link recordSpend} would double-count. Used solely by
   * {@link grantsStateTable}'s restore path.
   */
  hydrateSpends(spends: readonly GrantSpend[]): void {
    for (const s of spends) this.spendLog.push(s);
  }

  /**
   * Does this grant delegate `verb`? The fence, as one predicate with one home.
   *
   * Every caller that is about to draw asks this, and `recordSpend` asks it again as the
   * backstop. Two copies of "may this delegate do this" — one for the door an agent hits,
   * one for the journal an invariant reads — is scar #1's setup on the core loop's own
   * surface, so the door and the backstop call the same line.
   */
  carriesVerb(id: GrantId, verb: string): boolean {
    return this.byId.get(id)?.verbs.includes(verb) ?? false;
  }

  /** Does this grant open `compartment` to its delegate? The sight half of the same rule. */
  carriesClearance(id: GrantId, compartment: string): boolean {
    return this.byId.get(id)?.clearance.includes(compartment) ?? false;
  }

  /**
   * The live grant from `grantor` to `delegate` that opens `compartment`, or null.
   *
   * Separate from {@link liveGrantBetween} on purpose: that one picks by *headroom*, which
   * is the right tiebreak for a draw and the wrong one for a read. A delegate holding two
   * grants from one grantor — one wide and blind, one narrow and cleared — must have its
   * read attributed to the grant that actually authorised it, or the custody chain names a
   * grant whose clearance never included the compartment and INV-22 halts a legal act.
   */
  clearanceGrantFor(
    grantor: PrincipalId,
    delegate: PrincipalId,
    compartment: string,
    atTick: number,
  ): Grant | null {
    const candidates = this.all().filter(
      (g) =>
        g.grantor === grantor &&
        g.delegate === delegate &&
        g.clearance.includes(compartment) &&
        this.isLive(g.id, atTick),
    );
    return candidates[0] ?? null;
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
    // An object with two id-sorted arrays: the rows AND the spend journal. Both are
    // authoritative — the rows are what a delegate's next act is checked against, the
    // journal is what INV-22 recomputes the spend from. A capture that dropped the
    // journal would let a restored world pass INV-22's sum-vs-cache check vacuously.
    capture: (): CanonicalValue => ({
      grants: read()
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
          // Both scopes are captured for `spentDirect`'s reason: a rolled-back or replayed
          // world that forgot a grant's fence would let a delegate draw on a verb the
          // grantor never delegated, with a counter that still looks clean. Arrays of
          // strings, already in canonical order by construction (`canonicalVerbs` /
          // `canonicalClearance`), so nothing here can hash two ways.
          verbs: [...g.verbs],
          clearance: [...g.clearance],
          expiresTick: g.expiresTick,
          revokedAtTick: g.revokedAtTick,
        })),
      spends: read()
        .allSpends()
        .map((s) => ({
          grant: s.grant,
          delegate: s.delegate,
          tick: s.tick,
          eventId: s.eventId,
          direct: s.direct,
          contingent: s.contingent,
          verb: s.verb,
        })),
    }),
    restore: (captured: CanonicalValue): void => {
      const root = snapObject(captured, 'grant table');
      const book = new GrantBook();
      for (const row of snapArray(root['grants'] ?? [], 'grant rows')) {
        const r = snapObject(row, 'grant row');
        const id = snapString(r, 'id', 'grant row') as GrantId;
        book.add({
          id,
          grantor: snapString(r, 'grantor', `grant ${id}`) as PrincipalId,
          delegate: snapString(r, 'delegate', `grant ${id}`) as PrincipalId,
          template: snapString(r, 'template', `grant ${id}`),
          maxDirectLoss: minor(snapInt(r, 'maxDirectLoss', `grant ${id}`)),
          maxContingentLiability: minor(snapInt(r, 'maxContingentLiability', `grant ${id}`)),
          // Restored to the CAPTURED cache directly, not by replaying the journal —
          // capture took a consistent pair, so the row cache and the journal below agree
          // by construction, and INV-22 re-checks that agreement on the next tick.
          spentDirect: minor(snapInt(r, 'spentDirect', `grant ${id}`)),
          spentContingent: minor(snapInt(r, 'spentContingent', `grant ${id}`)),
          // Narrowed on the way back in, and NOT trusted: a captured clearance naming a
          // compartment this build does not have would otherwise become a live row that
          // `carriesClearance` answers yes to and no `compartmentDigest` can serve.
          verbs: canonicalVerbs(snapArray(r['verbs'] ?? [], `grant ${id} verbs`).map(String)),
          clearance: canonicalClearance(
            snapArray(r['clearance'] ?? [], `grant ${id} clearance`).map(String),
          ),
          expiresTick: snapInt(r, 'expiresTick', `grant ${id}`),
          revokedAtTick: snapIntOrNull(r, 'revokedAtTick', `grant ${id}`),
        });
      }
      const spends: GrantSpend[] = [];
      for (const row of snapArray(root['spends'] ?? [], 'grant spends')) {
        const s = snapObject(row, 'grant spend');
        spends.push({
          grant: snapString(s, 'grant', 'grant spend') as GrantId,
          delegate: snapString(s, 'delegate', 'grant spend') as PrincipalId,
          tick: snapInt(s, 'tick', 'grant spend'),
          eventId: snapString(s, 'eventId', 'grant spend') as EventId,
          direct: minor(snapInt(s, 'direct', 'grant spend')),
          contingent: minor(snapInt(s, 'contingent', 'grant spend')),
          verb: snapString(s, 'verb', 'grant spend'),
        });
      }
      book.hydrateSpends(spends);
      write(book);
    },
  };
}
