/**
 * WORKS — the production structure, and the numbers that bound the world's output.
 *
 * ## Why this module exists: the economy had a faucet and two drains
 *
 * Measured, not inferred. `grep -rn "sourceGoods(" src` returns **exactly one call site**
 * in the whole engine — the enrolment grant in `runtime.ts`. Meanwhile:
 *
 *   - the **Levy** destroys goods every Reckoning (`sink:consumption`, §5.2), and
 *   - the **Charge** destroys `ANCHOR_QTY` to take a claim plus its tier amount every
 *     Reckoning after that (§6.3).
 *
 * So goods entered a world once per identity and left it forever. `runtime.ts` says so out
 * loud at the faucet — *"a principal that only ever delivers from stock runs dry after
 * about two and a half Reckonings"* — and treats the rising shortfall as the meter working.
 * That was true when the Levy was the only drain. With sovereignty landed there are two,
 * and the terminal state is not a rising meter: it is a world where **every** obligation is
 * unpayable, every claim lapses, and the record accuses every principal of a default that
 * our own arithmetic made unavoidable.
 *
 * `ledger/endowment.ts` already refuses to remove the starter allotment for exactly this
 * reason — *"a newcomer with no allotment holds an obligation the rules make impossible to
 * meet, which is A5′ with our own economy as the cause"*. This module is that sentence
 * applied to the whole world instead of to one newcomer.
 *
 * ## Why output is bounded by the MAP and never by the population (A15)
 *
 * The obvious design — a structure that mints goods for its owner — is an A15 hole of the
 * D7 family, and worse than D7's, because D7 leaked a *one-time* grant while this would
 * leak a *perpetual flow*: enrol N puppets, build N structures, and world output scales
 * with identity count, which is free.
 *
 * So a WORKS does not mint. **A system has a per-tick yield, and the WORKS standing there
 * divide it.** Total world output is a property of the map, which no amount of enrolling
 * changes. Two consequences, both of them wanted:
 *
 *   - **Crowding is real.** A second WORKS at a system does not double that system's
 *     output, it halves each share. So production creates contention over *places*, which
 *     is the pressure sovereignty exists to resolve — the Charge gives you a reason to hold
 *     territory and this gives territory a reason to be worth holding.
 *   - **A puppet farm gains nothing.** Ten identities with ten WORKS at one system extract
 *     exactly what one identity with one WORKS extracts. The gate is priced in produced
 *     goods and in *place*, never in identities, which is what A15 requires.
 *
 * This is also why `ledger/accounts.ts` has always had two goods faucets, `EXTRACTION` and
 * `PRODUCTION`: extraction is the world handing over what a place yields, and it is the one
 * this module posts against.
 *
 * ## Why the Commons yields at all
 *
 * A8 makes the Commons a permanent floor rather than a timer, and a floor an agent starves
 * on is not a floor. A newcomer that cannot produce holds a Levy it can only pay from a
 * grant that runs out, so the Commons yields — modestly. The gradient across tiers is the
 * whole risk/reward argument of `graduate` made material: the frontier pays better, and the
 * frontier is where raids aim and claims lapse.
 */

import { qty, type Minor, type Qty } from '../core/units.js';
import type { GoodId, ZoneTier } from '../core/types.js';
import { minor } from '../core/units.js';

/** The good a WORKS extracts. One good in this build, and the Levy and Charge want it. */
/**
 * Equal to the other three goods constants TODAY, and **not an alias of them.**
 *
 * These four were `X = LEVY_GOOD`, so changing the Levy's good silently changed the WORKS yield, the
 * Charge, and the enrolment grant at once — one constant wearing four meanings, which is scar #5's
 * shape in the type system rather than in a table. It also forced `ledger/` and `works/` to import
 * from `levy/`, inverting the layering: the ledger has no business depending on the Levy for the name
 * of a good.
 *
 * They are equal because this build has ONE good, which is a decision (`D17`), not a fact about the
 * engine — everything below `GoodId` is already good-agnostic. `test/core/goods-are-independent.test.ts`
 * pins both halves: that all four agree today, and that each is declared on its own so the day a second
 * good lands, changing one cannot move the others.
 */
export const WORKS_GOOD = 'ration' as GoodId;

/**
 * What a system yields per tick, before it is divided among the WORKS standing there.
 *
 * **The calibration, written out so it can be argued with rather than trusted** *(calibrate)*:
 *
 * A principal's recurring burn is its Levy — which `runtime.ts` measures as draining a
 * 50,000 grant in about two and a half Reckonings, so ≈20,000 units a Reckoning — plus, if
 * it holds territory, that claim's Charge: 4,000 at MARCHES or 7,000 at FRONTIER. Call it
 * 20,000 in the Commons and 24,000–27,000 for a claim-holder.
 *
 * At `TICKS_PER_RECKONING = 288`, a sole occupant therefore needs ≈70 units a tick to stand
 * still in the Commons and ≈85–94 to stand still holding territory. The figures below are
 * set so that **one WORKS alone at a system slightly beats its own burn** — enough to trade
 * with, not enough to ignore the meter — and so that the second occupant of a system makes
 * both of them poorer than the burn, which is the contention the design wants.
 *
 * | tier | yield/tick | sole occupant per Reckoning | vs. burn |
 * |---|---|---|---|
 * | `COMMONS` | 80 | 23,040 | +3,040 over a 20,000 Levy |
 * | `MARCHES` | 110 | 31,680 | +7,680 over a 24,000 Levy+Charge |
 * | `FRONTIER` | 150 | 43,200 | +16,200 over a 27,000 Levy+Charge |
 *
 * The Commons margin is deliberately the thinnest that is still positive: A8 promises
 * safety, not prosperity, and a Commons that funded expansion would make `graduate`
 * irrational — which is the quiet-equilibrium failure A8 is already monitored for.
 */
export const YIELD_PER_TICK: Readonly<Record<ZoneTier, Qty>> = Object.freeze({
  COMMONS: qty(80),
  MARCHES: qty(110),
  FRONTIER: qty(150),
});

/**
 * Currency to raise a WORKS, and it is spent from **earned** cash.
 *
 * `freeCash`, not `freeBalance` — D7's rule generalised, and the sovereignty pass proved
 * the generalisation was needed by reopening D7 through a verb that postdated it. A WORKS
 * turns capital into a perpetual claim on a place, so buying one with the enrolment grant
 * would convert a free identity into permanent income. That is the exploit this whole file
 * is arranged against, and the yield cap alone does not close it: a puppet's WORKS still
 * *dilutes* an honest neighbour's share, so admission has to cost something real.
 */
export const WORKS_COST_MINOR: Minor = minor(60_000);

/**
 * Goods consumed to raise a WORKS, destroyed where they stand.
 *
 * A tenth of the starter allotment, the same figure `ANCHOR_QTY` uses, and for the same
 * reason: it is payable out of the grant, so a newcomer's *first* WORKS is reachable
 * without earnings while the currency half still gates the second one. Bootstrapping has to
 * work or A8's floor is decorative.
 */
export const WORKS_BUILD_QTY: Qty = qty(5_000);

/** WORKS one principal may hold at one system. More would be a way to buy a bigger share. */
export const WORKS_PER_PRINCIPAL_PER_SYSTEM = 1;

/**
 * Ticks a WORKS takes to come online after it is raised.
 *
 * Non-zero so that production is a *commitment* rather than a purchase: a WORKS raised the
 * tick before a Reckoning does not pay that Reckoning's Levy, and one raised at a system
 * about to be raided may never pay for itself. A3's shape — a durable intent whose routine
 * ticks are free, whose *creation* is the decision that costs.
 */
export const WORKS_SPINUP_TICKS = 24;
