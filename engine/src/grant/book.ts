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
import type { GrantRelease, GrantSpend } from '../invariants/authority.js';
import { GRANT_RELEASE_CAUSES, type GrantReleaseCause } from '../invariants/authority.js';
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

/**
 * A cap on the release journal (INV-26), and it is **half** the spend cap on purpose: a release
 * always names a spend that is already in the journal, so there can never be more releases than
 * spends, and a bound larger than that would be a bound that cannot bind.
 */
export const MAX_GRANT_RELEASES = MAX_GRANT_SPENDS;

export class GrantBook {
  private readonly byId = new Map<GrantId, Grant>();

  /**
   * The spend journal INV-22 audits (SPEC §8.1 #1). The row caches (`spentDirect` /
   * `spentContingent`) are the fast read; this is the source of truth the invariant
   * recomputes from, because a per-row counter incremented by two delegates is a race
   * and a journal is not. Append-only within a run; captured and replayed with the rows.
   */
  private readonly spendLog: GrantSpend[] = [];

  /**
   * ★ The **release** journal — draws given back because the obligation they were drawn against
   * can no longer be owed (SPEC §8.1 #2, A7).
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **A RETIRED VENTURE USED TO CONSUME THE GRANTOR'S BUDGET FOREVER.**
   *
   * A blind probe watched a BUILD with 28,000 of elective liability retire **ABANDONED** having
   * paid nobody, and read `spent_contingent: 28000, headroom_contingent: 2000` off the grant on
   * three separate wakes afterwards — while the grantor's own `if_you_do_nothing` promised *"your
   * escrow … is refunded in full … and nothing stays locked."* 30,000 of a 30,000 mandate gone on
   * ventures that never bound anybody, **at zero cost to the delegate**: a
   * denial-of-authority attack whose only requirement is a `create` and an `abandon`.
   *
   * ── WHY A SECOND JOURNAL AND NOT A NEGATIVE SPEND ────────────────────────────
   *
   * `recordSpend` refuses a negative row — *"a spend never returns headroom"* — and INV-22 halts
   * the world over one. Both are right and neither should be relaxed: a journal whose rows can be
   * negative is a journal in which an over-release and a legitimate draw look alike. So a release
   * is its own row, it must **name the spend it gives back**, and it can never exceed it
   * ({@link GrantBook.releaseSpend}). INV-22 then reads the net — Σ spends − Σ releases — and the
   * row caches remain the cache it checks.
   *
   * Captured with the rows and the spends, for `spentDirect`'s reason: a restored world that forgot
   * a release would believe a delegate had drained a mandate it had handed back.
   * ══════════════════════════════════════════════════════════════════════════
   */
  private readonly releaseLog: GrantRelease[] = [];

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

  /**
   * ★ Give back a draw whose obligation can no longer be owed.
   *
   * **Where it happens:** the two paths that retire a venture without ever binding anybody —
   * `abandon` (the creator gives up a FORMING venture) and `retireFormation` (its window closed
   * with a role still open). Both already refund the escrow and release the stakes; this is the
   * same release applied to the authority the escrow was drawn against.
   *
   * **Where it deliberately does NOT happen:** settlement. A SETTLED or DEFAULTED venture's
   * elective half *was* owed and is now either paid or on the record forever, so the draw records
   * a commitment the delegate really made. Releasing there would turn `max_contingent_liability`
   * from a lifetime bound into a concurrent one, which is a different promise from the one the
   * grantor read.
   *
   * Five refusals, and each is a way an over-release could launder headroom back into a spent
   * mandate — which is INV-22's own subject seen from the other side, so they throw rather than
   * return: the caller is the engine, and there is no correct way to continue past *"I am about to
   * un-charge a limit by more than was ever charged to it"*.
   */
  releaseSpend(release: GrantRelease): void {
    const grant = this.byId.get(release.grant);
    if (grant === undefined) throw new GrantBookError(`no grant ${release.grant} to release against`);
    if (release.direct < 0 || release.contingent < 0) {
      throw new GrantBookError(
        `a release never charges a limit: direct ${release.direct}, contingent ${release.contingent}`,
      );
    }
    if (release.direct === 0 && release.contingent === 0) return;
    // The draw this names, netted against anything already given back for it. A release that
    // cannot find its spend is a release of headroom nobody ever charged.
    const outstanding = this.netDrawOf(release.grant, release.eventId);
    if (!outstanding.charged) {
      throw new GrantBookError(
        `release ${release.eventId} against grant ${release.grant} names no draw in the journal; ` +
          'headroom can only be returned to a limit it was charged to',
      );
    }
    const drawnDirect = outstanding.direct;
    const drawnContingent = outstanding.contingent;
    if (release.direct > drawnDirect || release.contingent > drawnContingent) {
      throw new GrantBookError(
        `release ${release.eventId} against grant ${release.grant} would return ${release.direct}/` +
          `${release.contingent} (direct/contingent) against ${drawnDirect}/${drawnContingent} still ` +
          'outstanding on that draw; a release can never exceed the draw it names',
      );
    }
    if (this.releaseLog.length >= MAX_GRANT_RELEASES) {
      throw new GrantBookError(`the grant release journal is at its cap of ${MAX_GRANT_RELEASES}`);
    }
    grant.spentDirect = minor(Math.max(0, grant.spentDirect - release.direct));
    grant.spentContingent = minor(Math.max(0, grant.spentContingent - release.contingent));
    this.releaseLog.push(release);
  }

  /** The spend journal, in the order draws were recorded. INV-22's source of truth. */
  allSpends(): readonly GrantSpend[] {
    return this.spendLog;
  }

  /** The release journal, in the order draws were given back. INV-22's other input. */
  allReleases(): readonly GrantRelease[] {
    return this.releaseLog;
  }

  /**
   * ★ What **one draw** on one grant still stands at, net of releases — and whether it was ever
   * charged at all.
   *
   * Three readers, which is why it is a method rather than three loops:
   *
   *   1. {@link GrantBook.releaseSpend}, to refuse a give-back larger than its own draw;
   *   2. `Runtime.releaseGrantDraw`, to know how much to give back when a venture retires;
   *   3. **`elect`, so a liability already charged at `create` is not charged twice.** That third
   *      one appeared the moment `create` started charging the worst case: `elect`'s `IN_FULL`
   *      branch draws the same p90 ceiling, so a `steward` used for both verbs consumed 2× the
   *      bound, and a mandate sized for one venture would have refused the very `elect` that keeps
   *      its promise — the engine manufacturing a default, which is A5′'s own failure.
   */
  netDrawOf(
    grant: GrantId,
    eventId: EventId,
  ): { readonly charged: boolean; readonly direct: Minor; readonly contingent: Minor } {
    let direct = 0;
    let contingent = 0;
    let charged = false;
    for (const s of this.spendLog) {
      if (s.grant !== grant || s.eventId !== eventId) continue;
      charged = true;
      direct += s.direct;
      contingent += s.contingent;
    }
    for (const r of this.releaseLog) {
      if (r.grant !== grant || r.eventId !== eventId) continue;
      direct -= r.direct;
      contingent -= r.contingent;
    }
    return { charged, direct: minor(Math.max(0, direct)), contingent: minor(Math.max(0, contingent)) };
  }

  /**
   * What a grant has actually been charged, net of releases — the figure the row caches hold and
   * INV-22 recomputes. One home, so the invariant and the book cannot disagree about the arithmetic.
   */
  netSpendOf(id: GrantId): { readonly direct: Minor; readonly contingent: Minor } {
    let direct = 0;
    let contingent = 0;
    for (const s of this.spendLog) {
      if (s.grant !== id) continue;
      direct += s.direct;
      contingent += s.contingent;
    }
    for (const r of this.releaseLog) {
      if (r.grant !== id) continue;
      direct -= r.direct;
      contingent -= r.contingent;
    }
    return { direct: minor(direct), contingent: minor(contingent) };
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

  /** Restore-only, for {@link GrantBook.hydrateSpends}'s reason. Bypasses the cap and the cache. */
  hydrateReleases(releases: readonly GrantRelease[]): void {
    for (const r of releases) this.releaseLog.push(r);
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
   * Every live grant from `grantor` to `delegate` at `atTick`, in canonical id order.
   *
   * The input to {@link selectGrant}, which is where "which of these authorises this verb"
   * is decided. This method deliberately does **not** rank them: ranking without knowing the
   * verb is what made a grantor's oldest, narrowest grant shadow four wider ones.
   */
  liveGrantsBetween(grantor: PrincipalId, delegate: PrincipalId, atTick: number): readonly Grant[] {
    return this.all().filter(
      (g) => g.grantor === grantor && g.delegate === delegate && this.isLive(g.id, atTick),
    );
  }

  /**
   * Is there ANY live grant from `grantor` to `delegate`? — and if so, one of them.
   *
   * ── THIS IS NO LONGER HOW A DRAW PICKS ITS MANDATE ───────────────────────────
   *
   * It answers *"does this delegate hold authority here at all"*, which is what the
   * anti-self-dealing guard (§8.1 #3) and the grant-candidate filter actually ask. A draw asks a
   * different question — *"which mandate authorises this verb"* — and must go through
   * {@link selectGrant}, because ranking by headroom before consulting the fence returns the
   * oldest grant whatever it carries. See `grant/select.ts` for the probe run that found it.
   *
   * Kept ranked (most direct headroom, then id) so the two callers that only need existence still
   * get a deterministic row rather than an arbitrary one.
   */
  liveGrantBetween(grantor: PrincipalId, delegate: PrincipalId, atTick: number): Grant | null {
    const candidates = this.liveGrantsBetween(grantor, delegate, atTick);
    if (candidates.length === 0) return null;
    return candidates.reduce((best, g) => {
      const bh = best.maxDirectLoss - best.spentDirect;
      const gh = g.maxDirectLoss - g.spentDirect;
      if (gh > bh) return g;
      if (gh < bh) return best;
      return compareIds(g.id, best.id) < 0 ? g : best;
    });
  }

  /**
   * ★ **EXPOSURE's delegated half: Σ `max_direct_loss` over every LIVE grant this principal has
   * issued** (SPEC §3, §11B).
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **§11B SAYS EXPOSURE IS Σ YOUR OPEN `max_direct_loss`, AND A GRANT'S WAS NEVER IN IT.**
   *
   * `EncumbranceBook.recomputeExposure` sums the `maxDirectLoss` of open *locks*, and a grant is
   * not a lock — so a principal with five live grants totalling 160,000 of `max_direct_loss`
   * registered as **exposure 0**, which is what a blind probe measured for a whole run.
   *
   * That is not a cosmetic gap. Two of the Levy's four allocation rules read EXPOSURE (§5.2), and
   * the published default is `INVERSE_EXPOSURE` — so a principal loaded up by its delegate showed
   * as the *least* exposed in its constellation and was **shielded** by the rule, which is the
   * exact inverse of §5's *"hiding is the most taxed posture in the game."*
   *
   * ── THE CAP, NOT THE DRAW, AND THAT IS THE WHOLE POINT ───────────────────────
   *
   * `maxDirectLoss` rather than `spentDirect` or the remaining headroom: EXPOSURE is *"the most
   * you can lose"*, and a grantor that has signed a 50,000 mandate its delegate has not yet used
   * can lose 50,000 tonight. Charging the drawn part only would make signing a wide grant a way to
   * carry peril without registering any — a hiding posture bought with an act the frame already
   * draws. Revoking or letting it expire is what reduces the figure, and that is a real, legible
   * lever rather than a loophole.
   *
   * Nothing double-counts: escrow committed by a delegated `create` leaves the grantor's stores as
   * a transfer, opens no lock, and therefore appears in neither term.
   * ══════════════════════════════════════════════════════════════════════════
   */
  delegatedExposureOf(grantor: PrincipalId, atTick: number): Minor {
    let total = 0;
    for (const g of this.byId.values()) {
      if (g.grantor !== grantor) continue;
      if (!this.isLive(g.id, atTick)) continue;
      total += g.maxDirectLoss;
    }
    return minor(total);
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
      // The releases, for the spends' reason. A capture that carried the draws and not the
      // give-backs would restore a world in which every abandoned venture had permanently eaten
      // its grantor's budget — the defect this journal exists to close, reintroduced by the
      // rollback path.
      releases: read()
        .allReleases()
        .map((r) => ({
          grant: r.grant,
          delegate: r.delegate,
          tick: r.tick,
          eventId: r.eventId,
          direct: r.direct,
          contingent: r.contingent,
          verb: r.verb,
          cause: r.cause,
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
      const releases: GrantRelease[] = [];
      for (const row of snapArray(root['releases'] ?? [], 'grant releases')) {
        const r = snapObject(row, 'grant release');
        const cause = snapString(r, 'cause', 'grant release');
        if (!GRANT_RELEASE_CAUSES.includes(cause as GrantReleaseCause)) {
          throw new GrantBookError(
            `grant release cause "${cause}" is not one of ${GRANT_RELEASE_CAUSES.join(', ')}; a restored ` +
              'release with an unknown cause is headroom returned for a reason this build cannot state',
          );
        }
        releases.push({
          grant: snapString(r, 'grant', 'grant release') as GrantId,
          delegate: snapString(r, 'delegate', 'grant release') as PrincipalId,
          tick: snapInt(r, 'tick', 'grant release'),
          eventId: snapString(r, 'eventId', 'grant release') as EventId,
          direct: minor(snapInt(r, 'direct', 'grant release')),
          contingent: minor(snapInt(r, 'contingent', 'grant release')),
          verb: snapString(r, 'verb', 'grant release'),
          cause: cause as GrantReleaseCause,
        });
      }
      book.hydrateReleases(releases);
      write(book);
    },
  };
}
