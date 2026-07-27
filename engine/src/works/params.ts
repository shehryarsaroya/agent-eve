/**
 * WORKS — the production structure, and the numbers that bound the world's output.
 *
 * ## Why this module exists: the economy had a faucet and two drains
 *
 * Measured, not inferred. `grep -rn "sourceGoods(" src` returns **exactly one call site**
 * in the whole engine — the endowment in `runtime.ts`. Meanwhile:
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
/**
 * What a WORKS **YIELDS** — the raw good a place gives up. §10's production graph starts here.
 *
 * ── WHY THIS IS NOT WHAT A WORKS COSTS, AND THE DEADLOCK THAT FORCES IT ──────
 *
 * One constant was both, and splitting them is what makes §10's *"four goods, one build step"*
 * possible at all. The newcomer path is *"`extract` a bounded batch → `refine`"*, and `refine` was a
 * canon verb with no implementation — `verbs.ts` declared it not-live: "step 11, markets and the
 * production graph".
 *
 * **The trap:** building a WORKS consumes goods. If it consumed the good a WORKS *yields*, a principal
 * would need `ore` to build the thing that makes `ore` — a bootstrap deadlock with no first move and no
 * error message, because every individual rule reads correctly. So the COST stays in the good a
 * newcomer is endowed with, and only the YIELD becomes raw.
 *
 * The chain: endowment gives `ration` → build a WORKS with it → the WORKS yields `ore` → `refine` turns
 * `ore` into `ration` → the Levy is payable in `ration`. Which is what makes the Levy a *supply chain*
 * rather than a faucet with a tax on it: paying it now takes two acts, and one of them can be done for
 * you by somebody else's hand — which is §10's entire reason for existing ("nothing consumed the four
 * goods… with no hiring there is no delegation and no betrayal").
 */
export const WORKS_YIELD_GOOD = 'ore' as GoodId;

/**
 * What building a WORKS **COSTS** in goods, destroyed into the build.
 *
 * The endowment good, not the yield — see {@link WORKS_YIELD_GOOD} for the deadlock. Equal to
 * `LEVY_GOOD` and `CHARGE_GOOD` today and independently declared so it can stop being.
 */
export const WORKS_GOOD = 'ration' as GoodId;

/**
 * **THE THIRD GOOD, AND THE FIRST ONE THAT DOES NOT EXIST EVERYWHERE.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `D23`'s audit calls the economy *"ABSENT, and it is the bottleneck"*, and it names the exact
 * cause rather than asking for more market code:
 *
 * > *"Two goods, one lossless 1:1 conversion. **No comparative advantage exists anywhere in the
 * > world** — every agent needs the same good and can make it at the same rate. That is why the
 * > book has never cleared, and why more market code cannot fix it."*
 *
 * Its cheapest prescribed fix, ranked first of the three things most missing: *"a third good
 * produced only at FRONTIER systems, consumed by something everyone needs"*. This is that good.
 * `ore` and `ration` are produced identically at every tier and convert into each other 1:1, so a
 * trade between two principals was never anything but a transport of the same thing. **Fuel is
 * the first good in this world that some agents need and cannot make.**
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## The name is canon, not invented
 *
 * §10.1 names it — *"Hands consume a consumable per venture — rations or **fuel**, one of the four
 * goods"* — and `PASS-TERRITORY-POLITICS.md` §16.2 #5 makes it sovereignty's input by name: *"Each
 * claim owes a transparent mix of currency, manufactured administration goods, and **hub fuel**"*,
 * with a failure ladder whose first rung is *"`STRAINED` (upgrades shed)"*. That is exactly what a
 * cold anchor is here: the claim survives, its income does not.
 *
 * ## THE BOOTSTRAP DEADLOCK, AND WHY THIS GOOD IS NOT ON ANYBODY'S CRITICAL PATH
 *
 * {@link WORKS_YIELD_GOOD} carries the trap in full: *if a build consumed the good it yields, a
 * principal would need `ore` to build the thing that makes `ore` — a bootstrap deadlock with no
 * first move and no error message, because every individual rule reads correctly.* Fuel is one
 * step worse, because it is **geographically** bounded as well: anything on the road to a FRONTIER
 * WORKS that required fuel would be unreachable **forever**, not merely at the start.
 *
 * So the road to fuel is priced in things fuel is not needed for: `graduate` twice (currency and
 * `ration`), then a WORKS ({@link WORKS_COST_MINOR} and {@link WORKS_BUILD_QTY}, both in
 * `ration`). **Nothing a WORKS or a holding costs is payable in fuel, and that is a rule and not
 * an accident.** What fuel buys is *territorial income* — see `sovereignty/params.ts`'s
 * `ANCHOR_FUEL_BY_TIER` — which nothing else in the game is a precondition of.
 *
 * A fifth goods constant, independently declared like the other four
 * (`test/core/goods-are-independent.test.ts` pins that discipline). It is deliberately **not**
 * equal to them: that inequality is the whole feature.
 */
export const FUEL_GOOD = 'fuel' as GoodId;

/**
 * The recipe: how much {@link WORKS_YIELD_GOOD} `refine` consumes, and how much {@link WORKS_GOOD} it
 * produces. *(calibrate)*
 *
 * **1:1 on purpose for the first landing.** A ratio above 1 would make this change a balance change as
 * well as a mechanic change, and the failure mode is severe: if refining cannot keep up, the Levy
 * becomes unpayable from domestic production, every principal defaults, and the record fills with
 * breaches nobody could have avoided. `test/core/goods-are-independent.test.ts` names that exact hazard
 * as the reason the goods must agree.
 *
 * At 1:1 the world's goods throughput is **unchanged** — what changes is that goods now arrive raw and
 * an agent must act to make them payable. The scarcity is the ACTION, not the ratio, and the ratio is
 * left as the obvious first tuning knob once the chain has run for a season.
 */
export const REFINE_IN_QTY = 1;
export const REFINE_OUT_QTY = 1;

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
 * What a system yields per tick in {@link FUEL_GOOD}. **Zero everywhere but the Frontier.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE ZEROES ARE THE MECHANIC.** This is not a table with two dead rows in it: the fact that a
 * COMMONS and a MARCHES system yield *no* fuel at any occupancy is the entire comparative
 * advantage, and `invariants.ts:checkFuelIsFrontierOnly` halts a world that ever extracts fuel
 * where this says zero. Read together with `YIELD_PER_TICK`, the map now says two different things
 * about a place instead of one, which is the first time in this build that *where* an agent stands
 * decides *what* it can make rather than only how much.
 *
 * There is also no verb that moves goods between systems — `haul` is declared not-live, `graduate`
 * carries stores strictly outward, and a market book is venue-bound — so fuel cannot merely be
 * *cheaper* at the Frontier. Outside it, fuel does not exist. That is a much stronger asymmetry
 * than a price gradient, and it is why the sovereignty side had to be careful about which tiers can
 * be asked for it at all (`ANCHOR_FUEL_BY_TIER`).
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## Why 10 a tick *(calibrate)*
 *
 * A FRONTIER system yields 2,880 fuel a Reckoning, split among the WORKS standing on it, against
 * an `ANCHOR_FUEL_BY_TIER.FRONTIER` of 1,200 to keep one anchor collecting. Worked through, because
 * the interesting property is a consequence of the ratio rather than of either number:
 *
 * | who works the ground | fuel that reaches the claimant | vs. 1,200 |
 * |---|---|---|
 * | one tenant, landlord works nothing | **0** — rent is taken in ore, never in fuel | must buy all of it |
 * | two tenants, landlord works nothing | **0** | must buy all of it |
 * | landlord + one tenant | 1,440 (its own half) | covered, 240 spare |
 * | landlord alone | 2,880, and no rent to collect | nothing to fuel |
 *
 * So the number produces the design's sharpest sentence: **a landlord that works its own ground
 * fuels itself; a pure rentier must buy fuel from the tenant it taxes, every Reckoning, from a
 * seller with no competitor at that venue.** That is a bilateral trade with no substitute — the
 * first one in this world — and it is the reason a book might clear.
 *
 * Ten rather than a hundred because fuel must stay *scarce relative to its sink*. At 100 a tick a
 * single frontier WORKS would fuel every claim on the map and the asymmetry would price at nothing.
 */
export const FUEL_YIELD_PER_TICK: Readonly<Record<ZoneTier, Qty>> = Object.freeze({
  COMMONS: qty(0),
  MARCHES: qty(0),
  FRONTIER: qty(10),
});

/**
 * Currency to raise a WORKS, and it is spent from **earned** cash.
 *
 * `freeCash`, not `freeBalance` — D7's rule generalised, and the sovereignty pass proved
 * the generalisation was needed by reopening D7 through a verb that postdated it. A WORKS
 * turns capital into a perpetual claim on a place, so buying one with the endowment
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
