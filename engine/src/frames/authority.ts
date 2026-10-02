/**
 * ★ THE AUTHORITY LINE — A6's pixel signature, built in one reviewable place.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * **A6 IS THE CORE LOOP AND IT RENDERED `UNUSED` IN A WORLD WHERE IT FIRED 98 TIMES.**
 *
 * Measured directly on seed `g01` at tick 1,733 (an A13 audit, 2026-07-30):
 *
 *     grants total              = 158
 *     spend journal rows        =  98   (all nonzero)
 *     distinct grants DRAWN on  =  41
 *     grants LIVE at the tick   =  41   <- what the frame filtered to
 *       of which DRAWN          =   3
 *     frame.authorityLines      =  12 of 41 live (cap 12)
 *     frame states              = UNUSED=12
 *
 * The **field** had already been fixed once — `runtime.ts` read draws out of the journal rather than
 * the live row cache, with a comment naming the exact defect it closed. (That read was GROSS, and it
 * has since been made net of the release journal — ★ see {@link AuthorityLinesArgs.releases}: a gross
 * sum is not bounded by the LIMIT, and it published `spent 14400` of a `10000` grant.) The fix was
 * right and insufficient, because **nothing had fixed the SELECTION**: `render.ts` ranked authority
 * lines by `granted + grantedContingent` and by nothing else, so it was the only line set in the
 * file with no term for *whether anything happened*. `raidLines` puts live first, `battleLines` puts
 * live first, `claimLines` puts about-to-fall first. The three live-drawn grants lost the twelve-line
 * budget to bigger untouched ones, deterministically, on every frame ever published.
 *
 * That is this project's signature defect at the fourth distinct depth: a capability that fires and
 * is never selected is indistinguishable from one that does not exist — including to its author.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ## Two things are fixed here and one of them is a cost, not a picture
 *
 * **The draws are indexed once.** The previous shape ran `for (grant) { for (spend of allSpends()) }`
 * — O(grants × spends), which is 158 × 98 on a six-Reckoning world and grows with the square of a
 * world's age. That was affordable at one frame per Reckoning and is *not* affordable on a frame
 * published every tick, which is the artifact that finally makes A6 visible. So the journal is folded
 * into a map in one pass and every line reads it in constant time. Same numbers, linear cost. This is
 * the same shape as the quadratic in `riskHoldings` that held production down for four minutes —
 * a per-item rescan of the collection the outer loop had just keyed.
 *
 * **Ranking has a term for having happened.** {@link rankAuthorityLines} puts a drawn grant ahead of
 * an untouched one whatever their sizes, then a bound one ahead of an unbound one, then falls back to
 * the both-LIMITS weight the previous sort used alone. Size still decides among equals, which is
 * right: the previous comparator's own argument — that a grant authorising nothing direct and
 * everything contingent used to sort dead last — still holds and is preserved.
 *
 * ## An expired grant reaches the frame only when something else on it NAMES the grant
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * **THE FILTER IS THE DOMINANT CAUSE AND IT IS ALSO WHAT BREAKS §14's STRIP.**
 *
 * Grant lifetimes are 592–1,959 ticks and draws happen throughout, so **38 of the 41 grants ever
 * drawn on had expired before any frame was written**. Fixing the sort alone moved seed `g07`'s nine
 * published frames from `DRAWN 3 / 96` to `DRAWN 4 / 96` — measured, not estimated — because a sort
 * can only promote what is in its input.
 *
 * The reflex fix is a retention window (`battleLinesFor`'s precedent: *"the frame is a daily digest
 * and the battles of that day belong on it"*). The **better** rule is available here and needs no
 * clock at all: §14 requires that a broken promise's grant be findable, and `RundownSegment.grant`,
 * `DocketCard.grant` and `CompactLink.grant` now publish that id. So a grant is retained past expiry
 * **exactly when something else on the same frame points at it** — the referential-integrity rule
 * `assertFrameBudgets` already enforces between every line set and the frame's own `map`, applied to
 * the one pointer §14 depends on. A dangling `grant` id is a strip that cannot be assembled, and
 * that is checked rather than hoped for.
 *
 * A retained grant renders `EXPIRED`, never `UNUSED`: it holds no standing power and the line must
 * not draw a fence around authority that no longer exists — the sway line's *"a named principal at
 * sway 0 draws a fence around ground it cannot reach"* in the political register.
 *
 * And the *continuous* picture of A6 is the **live frame's** job, not this filter's: the same builder
 * runs every tick, so a grant drawn at tick 120 renders `DRAWN` on every live frame until it expires.
 * Measured on `g07`: 3,405 row-ticks of `DRAWN`/`EXHAUSTED` across 2,592 live frames, against 4 rows
 * across 9 nightly ones. A daily artifact cannot show a mid-day event; that was never a bug in the
 * selection, and pretending otherwise in the selection would make the nightly frame lie instead.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { GrantId, PrincipalId } from '../core/types.js';
import { addMinor, minor, type Minor } from '../core/units.js';
import { compareIds } from '../ledger/order.js';
import { MAX_AUTHORITY_LINES, MAX_LINE_DOSSIERS, type AuthorityDossier, type AuthorityLine, type AuthorityLineState } from './contract.js';

/** One grant, as this builder needs it. A projection of `Grant`, never the row. */
export interface AuthorityGrantRead {
  readonly id: GrantId;
  readonly grantor: PrincipalId;
  readonly delegate: PrincipalId;
  readonly maxDirectLoss: Minor;
  readonly maxContingentLiability: Minor;
  readonly clearance: readonly string[];
  readonly expiresTick: number;
  readonly revokedAtTick: number | null;
}

/** One journal row, as this builder needs it. `GrantSpend` minus the fields it may not publish. */
export interface AuthorityDrawRead {
  readonly grant: GrantId;
  readonly direct: Minor;
  readonly contingent: Minor;
}

export interface AuthorityLinesArgs {
  readonly grants: readonly AuthorityGrantRead[];
  /** The draw journal, every row, unfiltered (`GrantBook.allSpends`). */
  readonly draws: readonly AuthorityDrawRead[];
  /**
   * ★ **The release journal, every row** (`GrantBook.allReleases`) — draws given back when the venture
   * they were drawn for retired without binding anybody. **Subtracted**, exactly as INV-22 and the row
   * cache subtract it (`GrantBook.netSpendOf`).
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THE LINE PUBLISHED A DELEGATE SPENDING MORE THAN ITS LIMIT ALLOWS.** This builder summed the
   * draw journal GROSS, on the argument that the outstanding figure FALLS when an abandoned venture
   * returns its draw, so a delegate that opened ventures and let them lapse would render `UNUSED`. But
   * a draw that was given back is headroom the LIMIT has again — the delegate can draw it a second
   * time — so the gross sum is not bounded by the limit at all: a grant whose ventures were all
   * ABANDONED and refunded showed **`spent 14400` of a `10000` limit, `DRAWN`**, which on a public
   * frame reads as a delegate overrunning the authority it was given (A5′), while the book, INV-22 and
   * the delegate's own headroom all said nothing was outstanding. `contract.ts` defines `DRAWN` as
   * *"some headroom used"*, and none was.
   *
   * What the delegate DID stays on the line: `boundVentures` counts every venture it bound in the
   * grantor's name, released or not, and ranks second only to an outstanding draw.
   * ══════════════════════════════════════════════════════════════════════════
   */
  readonly releases: readonly AuthorityDrawRead[];
  /** Live headroom on both LIMITS. A different question from the draws, and it needs the current answer. */
  readonly headroom: (grant: GrantId) => { readonly direct: Minor; readonly contingent: Minor };
  /** How many ventures each grant has bound in its grantor's name, counted once over the book. */
  readonly boundVentures: ReadonlyMap<GrantId, number>;
  /** Revealed dossier threads, indexed by the grant each custody chain ROOTS at. */
  readonly dossiers: ReadonlyMap<GrantId, readonly AuthorityDossier[]>;
  readonly tick: number;
  /**
   * ★ Grants that must reach the frame even if their term has run — because something else on the
   * same frame **names** them.
   *
   * §14's strip needs the grant beside the deed, and a deed settles at the Reckoning while the grant
   * that authorised it may have expired weeks of ticks earlier. Without this, `RundownSegment.grant`
   * is a pointer into nothing. See the header.
   */
  readonly retain?: ReadonlySet<GrantId>;
  readonly limit?: number;
}

/**
 * What each grant has OUTSTANDING — Σ draws − Σ releases — folded in one pass over each journal. See the
 * header on why this is not per-grant, and {@link AuthorityLinesArgs.releases} on why it is net.
 *
 * The arithmetic is `GrantBook.netSpendOf`'s, which is the figure INV-22 recomputes and the row cache
 * holds, so the line, the invariant and the delegate's own headroom are one number. Floored at zero
 * per limit, as `netDrawOf` floors it: a release can never exceed its draw (`releaseSpend` refuses), so
 * the floor only ever meets a malformed journal, where it fails toward "nothing outstanding" rather than
 * publishing a negative spend.
 */
function outstandingByGrant(
  draws: readonly AuthorityDrawRead[],
  releases: readonly AuthorityDrawRead[],
): ReadonlyMap<GrantId, { direct: number; contingent: number }> {
  const out = new Map<GrantId, { direct: number; contingent: number }>();
  const fold = (row: AuthorityDrawRead, sign: 1 | -1): void => {
    const acc = out.get(row.grant) ?? { direct: 0, contingent: 0 };
    acc.direct += sign * row.direct;
    acc.contingent += sign * row.contingent;
    out.set(row.grant, acc);
  };
  for (const row of draws) fold(row, 1);
  for (const row of releases) fold(row, -1);
  for (const acc of out.values()) {
    acc.direct = Math.max(0, acc.direct);
    acc.contingent = Math.max(0, acc.contingent);
  }
  return out;
}

/** Both of §8.1 #2's LIMITS, summed with the checked helper so a huge pair throws rather than wrapping. */
function authorityWeight(line: AuthorityLine): Minor {
  return addMinor(line.granted, line.grantedContingent);
}

/**
 * Is this line on the frame only because something else points at it?
 *
 * `EXPIRED` is exactly that case, and it ranks FIRST — above even a drawn live grant — for a reason
 * that is not about importance: it is the one row whose absence would leave a published pointer
 * dangling, so it is the one row the twelve-line cap must not evict.
 */
function isNamedPointer(line: AuthorityLine): boolean {
  return line.state === 'EXPIRED';
}

/**
 * **Is any of this authority in use?** The term the previous comparator did not have.
 *
 * Read off the published fields rather than recomputed, so what decides the ranking is exactly what
 * a viewer can see on the line — a sort keyed on a fact the frame does not carry is a selection
 * nobody can check. Those fields are OUTSTANDING draws (net of releases), so a delegate whose ventures
 * all retired unbound ranks next by `boundVentures`, which still counts them.
 */
function wasDrawn(line: AuthorityLine): boolean {
  return line.spent > 0 || line.spentContingent > 0;
}

/**
 * Order the lines a viewer most needs, then cap.
 *
 * Exported because the ordering IS the fix and a test asserts it directly: a comparator whose only
 * caller is a builder is a comparator no test can aim at.
 */
export function rankAuthorityLines(lines: readonly AuthorityLine[]): readonly AuthorityLine[] {
  return [...lines].sort(
    (a, b) =>
      // A line something else on the frame NAMES, first — see {@link isNamedPointer}. Not a judgement
      // about drama: it is the row whose eviction would publish a dangling pointer, and §14's strip
      // is assembled from that pointer.
      Number(isNamedPointer(b)) - Number(isNamedPointer(a)) ||
      // ── ★ THE TERM THAT WAS MISSING ────────────────────────────────────────
      // A grant somebody has actually drawn on outranks an untouched one at any size. This is A6:
      // *"betrayal via legitimate authority"* is about authority being USED, and a budget that cut
      // the used ones first published the loop as `UNUSED` on 21 of 21 measured frames.
      Number(wasDrawn(b)) - Number(wasDrawn(a)) ||
      // Then a delegate that has BOUND its grantor to something, which is §8.1's promise with teeth:
      // a compact the grantor is a party to and never individually agreed to.
      b.boundVentures - a.boundVentures ||
      // Then size — the previous rule, preserved. Its own argument still stands: a grant written
      // `max_direct_loss: 0, max_contingent_liability: 900000` authorises the largest exposure on the
      // map and must not sort last.
      authorityWeight(b) - authorityWeight(a) ||
      compareIds(a.grantor, b.grantor) ||
      compareIds(a.delegate, b.delegate) ||
      compareIds(a.grant, b.grant),
  );
}

/**
 * Build THE AUTHORITY LINE set for a frame — live or nightly, the same function either way.
 *
 * One code path for both artifacts on purpose: two builders would be two answers to *"has this
 * delegate used its authority"*, and the whole reason this file exists is that the answer was
 * computed correctly in one place and thrown away by a sort in another.
 */
export function authorityLinesFor(args: AuthorityLinesArgs): readonly AuthorityLine[] {
  const outstanding = outstandingByGrant(args.draws, args.releases);
  const retain = args.retain ?? new Set<GrantId>();
  const lines: AuthorityLine[] = [];
  for (const g of args.grants) {
    // Live and revoked grants render, because a revocation is drama. An expired one renders ONLY when
    // something else on this frame names it — see the header, and `assertFrameBudgets`' pointer check.
    const expired = g.expiresTick < args.tick;
    if (expired && !retain.has(g.id)) continue;
    const drawn = outstanding.get(g.id) ?? { direct: 0, contingent: 0 };
    const headroom = args.headroom(g.id);
    // ★ What is OUTSTANDING decides it — `DRAWN` is *"some headroom used"* (`contract.ts`), and a draw
    // given back uses none. A delegate whose every venture retired unbound renders `UNUSED`, with its
    // `boundVentures` still counting what it did.
    const anyDraw = drawn.direct > 0 || drawn.contingent > 0;
    // BOTH limits decide the state. Reading `spentDirect` alone rendered the A6 attack as `UNUSED`:
    // an un-escrowable venture created on a grantor's behalf moves no escrow, so the direct counter
    // never leaves zero while the grantor carries the whole elective tail.
    //
    // `REVOKED` outranks `EXPIRED` when a grant is both: somebody *took the authority back*, which is
    // the more informative fact about what happened and the one A6 is about. A term simply running out
    // is what happens when nobody does anything.
    const state: AuthorityLineState =
      g.revokedAtTick !== null
        ? 'REVOKED'
        : expired
          ? 'EXPIRED'
          : !anyDraw
            ? 'UNUSED'
            : headroom.direct <= 0 && headroom.contingent <= 0
              ? 'EXHAUSTED'
              : 'DRAWN';
    lines.push({
      grant: g.id,
      grantor: g.grantor,
      delegate: g.delegate,
      granted: g.maxDirectLoss,
      spent: minor(drawn.direct),
      grantedContingent: g.maxContingentLiability,
      spentContingent: minor(drawn.contingent),
      boundVentures: args.boundVentures.get(g.id) ?? 0,
      clearance: [...g.clearance],
      // Only revealed rows, and only rows whose custody chain ROOTS at this grant — so a dossier
      // re-handed twice still points at the promotion that made it possible, and no thread is ever
      // drawn before the subject has learned of it (A9 by construction; the frame and the subject
      // read one clock). The reveal gate is applied by the caller that owns the book.
      dossiers: (args.dossiers.get(g.id) ?? []).slice(0, MAX_LINE_DOSSIERS),
      state,
    });
  }
  return rankAuthorityLines(lines).slice(0, args.limit ?? MAX_AUTHORITY_LINES);
}
