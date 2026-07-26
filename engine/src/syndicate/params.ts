/**
 * SYNDICATE — the only org container in Phase 0 (§3), and the numbers that bound it.
 *
 * ## What a syndicate is for
 *
 * A6 is live at *grant scale*: one principal grants another scoped authority over its own stores.
 * §365 says the real object is bigger — an **office** is standing authority over *a syndicate's*
 * stores, offices are scarce per constellation so holding one is a status object, and some things
 * can only be operated by a named office-holder. §363: *"Offices require syndicates."*
 *
 * So this exists to make the signature moment reachable over an organisation's treasury rather than
 * one agent's purse, which is the difference between a dispute and a legend.
 *
 * ## The charter/covenant split, which is the design's actual content
 *
 * Two kinds of rule, and conflating them is what makes org games either rigid or meaningless:
 *
 *   - **The CHARTER is constitutional.** Fixed at founding, never amendable, and enforced by the
 *     engine. It is what a prospective member *relies on* when it hands over goods it will not be
 *     able to retrieve. A charter an incumbent could amend is not a promise, it is a preference —
 *     and the whole value of joining is that the terms cannot move after you are inside.
 *   - **A COVENANT is an office's terms.** Typed, revocable with notice, and set per appointment.
 *     This is where discretion lives, and therefore where betrayal lives: a covenant is the thing
 *     an office-holder can act inside and still ruin you.
 *
 * The split is what makes A6 legible at org scale. When a treasury is emptied, the replay can show
 * the charter that permitted the office to exist, the covenant that scoped it, and the act that
 * stayed inside both — which is exactly A6's "no `betray()` verb" requirement one level up.
 */

import { minor, type Minor } from '../core/units.js';

/**
 * Members one syndicate may hold. *(calibrate)*
 *
 * Bounded because INV-26 requires every array in the engine to declare a cap, and unbounded
 * membership is the shape of scar #3 — High Water's unbounded growth. Also a design choice: a
 * syndicate that can absorb the whole world is a syndicate nobody has to negotiate with.
 */
export const MAX_MEMBERS = 24;

/** Syndicates one principal may belong to. Divided loyalty is interesting; infinite is noise. */
export const MAX_SYNDICATES_PER_PRINCIPAL = 3;

/** Syndicates in a world, so the book is bounded (INV-26). *(calibrate)* */
export const MAX_SYNDICATES = 64;

/**
 * What founding costs, retired rather than paid to anybody.
 *
 * Priced in capital and never in identities (A15). Retired — not transferred — for the reason D11
 * settles about the WORKS build: retirement cannot move value to a sock-puppet operator, so it is
 * payable from the endowment and a real agent's first syndicate is reachable.
 */
export const FOUNDING_COST_MINOR: Minor = minor(40_000);

/**
 * Notice a member must give before its stake leaves the pool, in ticks.
 *
 * The whole point of pooled stores is that they are *committed*. A pool a member can drain the
 * instant it dislikes a vote is a pool no office can be trusted with and no counterparty can price.
 * One Reckoning of notice, so a departure is always visible for at least one settlement before it
 * lands — which is also what makes it *watchable*.
 */
export const WITHDRAWAL_NOTICE_TICKS = 288;

/**
 * Open office proposals one syndicate may hold. *(calibrate)*
 *
 * Bounded because INV-26 requires it, and because an unbounded proposal list is a way to make a
 * syndicate's own observation unreadable — spam 500 appointments and the members can no longer see
 * the one that matters. Small on purpose: an org with eight pending appointments has a decision
 * problem, not a tooling problem.
 */
export const MAX_OPEN_PROPOSALS = 8;

/**
 * Ticks a proposal stands before it lapses.
 *
 * One Reckoning. A proposal that never expires is a permanent latent authority: approve four of
 * eight members today, wait a month for the fifth, and the appointment lands on a membership that
 * has completely changed. Expiry means a majority is a majority **of the people who are there now**,
 * which is the only reading that makes the vote mean anything.
 */
export const PROPOSAL_TTL_TICKS = 288;
