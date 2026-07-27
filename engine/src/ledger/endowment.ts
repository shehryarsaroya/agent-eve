import type { GoodId } from '../core/types.js';
/**
 * The endowment, and the one thing it may not do.
 *
 * ## Why this file exists (D7)
 *
 * Enrolment is free and **must stay free** — A15 says so, and A8's permanent floor
 * depends on it. So enrolment mints capital, and free identities mint capital without
 * limit. Worse, the seat cap does not bound it the way it looks: `api/seats.ts` never
 * touches the ledger, so recycling an idle seat frees the *seat* and leaves the *stores*
 * (A10 — identity never resets). The loop is enrol → mint → go idle → seat recycles →
 * enrol again, and total minted grows with churn, which has no ceiling. Measured: ten
 * free identities minted 2,500,000 currency and 500,000 goods at zero cost.
 *
 * Before the market existed this was hard to exploit: there is no principal-to-principal
 * transfer verb, and that absence was quietly doing the work. The market removes it — a
 * sock puppet bids far above value for its operator's junk goods and the entire stake
 * moves, through ordinary legal orders that violate nothing in the matcher.
 *
 * ## Why the endowment is withheld rather than removed or policed
 *
 * A15 rules out the obvious answers. Capping enrolments per source **is** a gate priced
 * in identities. Detecting and punishing wash trades needs intent, and A15 is explicit
 * that "the flow graph may **withhold credit**, never accuse". Removing the stake is
 * worse than the disease: the Levy is payable only in located goods, so a newcomer with
 * no allotment holds an obligation the rules make impossible to meet, which is A5′ with
 * our own economy as the cause.
 *
 * Withholding credit is precisely the sanctioned move, so that is what happens. **The
 * endowment funds a principal's own work — its ventures, its Levy, its hauling — and
 * cannot leave it.** It cannot fund a market BID and its goods cannot be sold. A real
 * agent playing alone never notices. A sock puppet is worth exactly zero, because the
 * only thing it can do with its stake is play, which is what we wanted anyway.
 *
 * ## Why there is no new state
 *
 * The endowment is a constant, so "how much of this balance is endowment" needs no
 * tracking: the transferable part is everything **above** the floor. That keeps the fix
 * out of `state_hash`, out of the rollback set, and out of the snapshot — which matters,
 * because the last thing added to the hashed capture (the `EncumbranceBook`) changed
 * every tick's hash and had to cross a declared generation boundary.
 *
 * A principal that spends endowment on legitimate costs keeps the floor, so its
 * transferable balance stays smaller than a perfectly-accounted version would allow.
 * That is deliberate: for a Sybil guard, erring toward withholding is the safe direction,
 * and the alternative is per-principal accounting inside the hash for a rounding
 * difference nobody can spend.
 */

import { minor, type Minor, type Qty } from '../core/units.js';
import { LEVY_STARTER_ALLOTMENT } from '../levy/params.js';

/**
 * The currency minted to each principal at enrolment (§12.5).
 *
 * Defined here rather than in the runtime because the floor and the grant must be the
 * same number — one quantity with two homes is scar #5, and a drift between them would
 * silently open the hole this file closes.
 */
export const STARTER_STAKE: Minor = minor(250_000);

/** Currency below this is endowment and cannot be committed to a market BID. */
export const ENDOWMENT_FLOOR_MINOR: Minor = STARTER_STAKE;

/** The good minted at enrolment. The Levy is payable only in this. */
/**
 * Equal to the other three goods constants TODAY, and **not an alias of them.**
 *
 * These four were `X = LEVY_GOOD`, so changing the Levy's good silently changed the WORKS yield, the
 * Charge, and the endowment at once — one constant wearing four meanings, which is scar #5's
 * shape in the type system rather than in a table. It also forced `ledger/` and `works/` to import
 * from `levy/`, inverting the layering: the ledger has no business depending on the Levy for the name
 * of a good.
 *
 * They are equal because this build has ONE good, which is a decision (`D17`), not a fact about the
 * engine — everything below `GoodId` is already good-agnostic. `test/core/goods-are-independent.test.ts`
 * pins both halves: that all four agree today, and that each is declared on its own so the day a second
 * good lands, changing one cannot move the others.
 */
export const ENDOWMENT_GOOD = 'ration' as GoodId;

/** Units of {@link ENDOWMENT_GOOD} below which a principal may not sell. */
export const ENDOWMENT_GOOD_FLOOR_QTY: Qty = LEVY_STARTER_ALLOTMENT;
