/**
 * The BOND, as §3 defines it and not as the critique caught it being used.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * > **BOND** | posted slashable capital, continuous | *never* email verification;
 * > **a claim deposit** — SPEC §3
 *
 * The vocabulary row names the exact misuse this module could have shipped, and the
 * economic critic named it independently: *"make a claim increase the claimant's continuous
 * BOND requirement; do not use BOND as a one-time claim deposit, contrary to the canonical
 * vocabulary."*
 *
 * So there is no deposit anywhere in this mechanic. `post_bond` opens a **lock** in the
 * claimant's own STORES; the lock stays open for as long as the claim does; the
 * *requirement* scales with how many claims are held; and a lapse **slashes** it. The
 * capital never leaves the claimant's account until it is taken, which is what makes it
 * legible as "credit rating" rather than as a fee (§6.4: *"your bond is posted slashable
 * capital, public, and any amount — it is your credit rating"*).
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## One home for the amount, and it is the ledger
 *
 * The book stores lock **ids**; this module reads the amounts through {@link BondRead},
 * which is `ledger.encumbrances.get(id)?.amountMinor`. A copy in the book would be a second
 * home for posted capital, and the two would come apart at the one moment that matters:
 * `reduceLocksToBalance` sheds locks when value leaves an account, so a cached amount would
 * go on reporting a bond the world had already reduced — and the claim would look backed
 * while nothing stood behind it.
 */

import type { PrincipalId } from '../core/types.js';
import { minor, type Minor } from '../core/units.js';
import type { Book } from './book.js';
import { CLAIM_BOND_MINOR } from './params.js';

/** What one open lock currently holds, or `null` if there is no such lock. */
export type BondRead = (encumbranceId: string) => Minor | null;

/**
 * Capital this principal has actually posted as bond, right now.
 *
 * Σ over its live locks, read from the ledger. A lock the ledger no longer knows about
 * contributes nothing — which is the honest answer, because a released or fully-shed lock
 * is capital that is no longer at risk.
 */
export function postedBondOf(book: Book, principal: PrincipalId, read: BondRead): Minor {
  let total = 0;
  for (const id of book.bondLocksOf(principal)) total += read(id) ?? 0;
  return minor(total);
}

/**
 * The bond this principal is required to keep posted: {@link CLAIM_BOND_MINOR} per claim.
 *
 * Continuous, so it is recomputed from the live claim set every time it is asked for rather
 * than incremented when a claim is taken. An incremented counter would drift the moment a
 * claim lapsed, and it would drift in the dangerous direction: a requirement that stayed
 * high after a claim ended is a principal told it is short of a bond it does not owe.
 */
export function requiredBondOf(book: Book, principal: PrincipalId): Minor {
  return minor(book.claimsOf(principal).length * CLAIM_BOND_MINOR);
}

/**
 * What one more claim would require. What the `build` gate checks and the affordance shows.
 *
 * Deliberately the *next* claim's requirement rather than the current one, because the
 * question an agent asks before claiming is "is my bond enough for one more", and answering
 * the other question is how an agent posts exactly enough to be refused.
 */
export function bondNeededForOneMore(book: Book, principal: PrincipalId): Minor {
  return minor(requiredBondOf(book, principal) + CLAIM_BOND_MINOR);
}

/** Is this principal's posted bond enough to back one more claim? */
export function bondCoversOneMore(book: Book, principal: PrincipalId, read: BondRead): boolean {
  return postedBondOf(book, principal, read) >= bondNeededForOneMore(book, principal);
}

/**
 * The bond backing one claim, and therefore the capital that claim puts at risk.
 *
 * Deliberately the flat per-claim requirement rather than "everything posted": a claimant
 * holding four claims and posting 200,000 loses 50,000 when one lapses, not the lot. A
 * lapse that slashed the whole posted bond would make the first lapse fatal to every other
 * claim at once, which is the correlated cascade the collapse arc exists to avoid.
 *
 * Capped at what is actually posted, because the record must never overstate what was
 * taken from a principal (A5′): a claimant whose locks have been shed below the requirement
 * cannot be slashed for capital that is not there.
 */
export function bondAtRiskFor(book: Book, principal: PrincipalId, read: BondRead): Minor {
  return minor(Math.min(CLAIM_BOND_MINOR, postedBondOf(book, principal, read)));
}
