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
 * ★ **THE FOURTH GOOD — §10's *manufactured* good, and the first one that flows INWARD.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHY A FOURTH GOOD AT ALL, WHEN THE THIRD ONE ALREADY GAVE US A GRADIENT.**
 *
 * Measured before it was designed, 4 seeds x 6 Reckonings of the heuristic world:
 *
 * ```
 *   market orders ever placed .......... 0        (in every world this repo has run)
 *   market fills ever printed .......... 0
 *   WORKS on FRONTIER ground ........... 0, 0, 0, 1   (of 8 members)
 *   `ration` standing at the end ....... 529,889 – 589,000
 *   `ore` standing at the end .......... 4,078 – 5,162
 * ```
 *
 * Two findings, and the second is the one that decided this design. **First:** `market/` is 3,065
 * built lines that have never held an order, so "the market prices one commodity" was generous —
 * it priced none. **Second:** `fuel` is FRONTIER-only and *the Frontier is empty*, so the third
 * good exists in one world of four. A gradient nobody stands on prices nothing.
 *
 * And half a million units of `ration` sat in stores with nothing to buy. The world's problem was
 * never supply. It was that **every good flowed one way and stopped.**
 *
 * ── WHAT MAKES THIS ONE DIFFERENT: IT IS MADE WHERE THE ORE IS WORST ─────────
 *
 * `alloy` is refined from {@link WORKS_YIELD_GOOD} — the same input as {@link WORKS_GOOD} — and it
 * can be refined **only at a `COMMONS` system** ({@link ALLOY_TIER}). Read that against
 * {@link YIELD_PER_TICK}, which pays the Commons 80 a tick against the Frontier's 150: the tier
 * that can manufacture is the tier with the least to manufacture *from*, and the tier with the ore
 * cannot manufacture at all.
 *
 * That is a **two-way** dependency rather than another `fuel`:
 *
 *   - an interior manufacturer wants **ore**, because its own ground is the poorest on the map;
 *   - everyone outside the Commons wants **alloy**, because the two gates that take them further
 *     out are priced in it and *no MARCHES or FRONTIER system can make a single unit*.
 *
 * Ore and rations move outward-to-inward; alloy moves inward-to-outward. Both parties need both,
 * neither can substitute, and the thing that carries them is `haul` — which is the map's motion,
 * which is the show (A13).
 *
 * ── AND THE FORK IS AT THE SAME INPUT, WHICH IS THE WHOLE DECISION ───────────
 *
 * One unit of ore becomes **either** a ration (which pays your Levy tonight) **or** a fraction of
 * an alloy (which buys you ground you keep). §10.1 asked for a demand side; this is one, and it is
 * a decision an agent can get *wrong* rather than a second faucet. `refine {kind:"RATION"}` and
 * `refine {kind:"ALLOY"}` compete for the same lot.
 *
 * ── WHY IT IS NOT ONE OF THE FOUR OBLIGATION GOODS, AND MUST NEVER BE ────────
 *
 * `LEVY_GOOD`, {@link WORKS_GOOD}, `CHARGE_GOOD` and `ENDOWMENT_GOOD` all name `ration` so that
 * **the Levy stays payable from domestic production** — `test/core/goods-are-independent.test.ts`
 * pins that and explains why an unpayable Levy is worse than a crash. Alloy is deliberately
 * outside that set: a Levy priced in a good three of the four zones cannot make would accuse every
 * principal outside the Commons of a default our own geography caused, which is A5′ with the map as
 * the culprit. `test/works/a-good-only-the-commons-makes.spec.ts` asserts the inequality directly.
 *
 * ── THE SINK, AND WHY IT IS A ONE-TIME GATE RATHER THAN AN OBLIGATION ───────
 *
 * `fuel` set the precedent that matters: a cold anchor **loses income and nothing else** — no
 * arrears, no lapse, no bond slashed — because a new way to be recorded short is A5′ arriving with
 * a feature. Alloy follows it and goes one better: both of its sinks are **gates you choose to walk
 * through**, so there is no state in which an agent *owes* alloy and cannot get it.
 *
 *   1. **{@link ALLOY_ANCHOR_QTY}** — every CLAIM, and after a measurement it is the ONLY one.
 *      `PASS-TERRITORY-POLITICS` §16.2 #5 names it verbatim:
 *      *"Each claim owes a transparent mix of currency, **manufactured administration goods**, and
 *      hub fuel."* A claim is always outside the Commons, so **every anchor in the game is built
 *      out of goods somebody carried in.**
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A sixth goods constant, independently declared like the other five, and deliberately equal to
 * none of them.
 */
export const ALLOY_GOOD = 'alloy' as GoodId;

/**
 * The ONE tier that can refine {@link ALLOY_GOOD}. **The single zero-sum-free asymmetry.**
 *
 * ── WHY THE COMMONS AND NOT THE FRONTIER, WHICH WAS THE FIRST DESIGN ─────────
 *
 * The obvious recipe was `ore + fuel -> alloy`, which puts manufacturing at the Frontier because
 * that is the only place fuel exists. It was rejected on a measurement: **the Frontier holds 0 WORKS
 * in three of four seeded worlds.** A good producible only where nobody stands is a good that does
 * not exist, and this repo has now shipped eleven capabilities with that shape. The Commons holds
 * 2–3 of 8 members in every world, so a Commons franchise has a supply side on the first day.
 *
 * ── AND WHY THIS CANNOT DEADLOCK, WHICH IS THE CHECK THAT HAD TO PASS ────────
 *
 * `WORKS_YIELD_GOOD`'s header states the trap in full: *if a build consumed the good it yields, a
 * principal would need `ore` to build the thing that makes `ore` — a bootstrap deadlock with no
 * first move and no error message.* Fuel then made it worse by adding geography. Alloy is the first
 * good whose geography **points the other way**, and that is why it is safe:
 *
 *   - **Everyone starts in the Commons.** Enrolment seats you there, so the manufacturing tier is
 *     the tier every principal begins in — nobody has to travel to reach the franchise.
 *   - **Nothing on the road INTO the Commons is priced in alloy**, because there is no road in.
 *   - **The first crossing out is not priced in alloy either**, so the ladder's first rung is
 *     reachable from the endowment exactly as it was before this good existed.
 *
 * So the only things alloy gates are the second rung and beyond — and a principal standing on the
 * second rung can always send a hand back to a Commons venue and buy some. A cage would need both
 * *no local production* and *no way in*; the Commons is adjacent to the Marches by construction
 * (`world/map.ts` keeps the Commons connected), so the second condition never holds.
 */
export const ALLOY_TIER: ZoneTier = 'COMMONS';

/**
 * ★ **THE ALLOY RECIPE, BY TIER — A PRICE GRADIENT AND NOT A WALL.** *(calibrate)*
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE FIRST DESIGN WAS A WALL, AND A MEASUREMENT KILLED IT.** Alloy was COMMONS-only, full stop,
 * exactly as `fuel` is FRONTIER-only. Four seeds, six Reckonings, measured through the cast:
 *
 * ```
 *   refine:ALLOY  32–40      alloy made        15,500–20,000
 *   trade:ASK      4–16      market fills           0
 *   trade:BID  1,980–9,151   claims taken           0   (was 4 per seed)
 * ```
 *
 * Supply worked. Demand did not, and **the reason had nothing to do with this good.**
 * `market/escrow.ts:freeCash` is `freeBalance − ENDOWMENT_FLOOR_MINOR`, the floor is the whole
 * `STARTER_STAKE` (250,000), and **every cast member in every world sits between 62,000 and 203,000**
 * — so `freeCash` is **identically zero for every principal that has ever played**, and no BID can be
 * funded by anyone, ever. `ledger/endowment.ts` predicted this in its own words — *"a principal that
 * spends endowment on legitimate costs keeps the floor, so its transferable balance stays smaller
 * than a perfectly-accounted version would allow... erring toward withholding is the safe direction"*
 * — and nothing had ever measured what the erring cost. It costs the entire buy side of the market,
 * which is why 3,065 lines of `market/` have never printed a fill.
 *
 * A wall plus an unfundable market is a **deadlock**: a Marches claimant could neither make alloy nor
 * buy it, so `claims` went to zero and the sovereignty layer went with it. That is a worse world than
 * the one with three goods, and no amount of cast tuning fixes it — the buyer has no money.
 *
 * ── SO THE GEOGRAPHY BECAME A RATIO, WHICH IS WHAT THE PROBLEM ASKED FOR ─────
 *
 * *"A good that is cheap in one tier and dear in another is where price and hauling come from."*
 * Every tier can refine alloy; the Commons does it **four times cheaper than the Marches and eight
 * times cheaper than the Frontier.** Read against {@link YIELD_PER_TICK}, which pays the Commons 80 a
 * tick against the Frontier's 150, that is comparative advantage in its textbook form: the tier with
 * the least ore converts it best, the tier with the most converts it worst, and both are better off
 * trading than either is alone.
 *
 * | tier | ore per alloy | ore a sole occupant yields per Reckoning | alloy it could make | one ANCHOR costs |
 * |---|---|---|---|---|
 * | `COMMONS` | **8** | 23,040 | 2,880 | 4,000 ore |
 * | `MARCHES` | **32** | 31,680 | 990 | 16,000 ore |
 * | `FRONTIER` | **64** | 43,200 | 675 | 32,000 ore |
 *
 * Three properties, and each is a thing the wall did not have:
 *
 *   - **Nothing can deadlock.** A claimant can always self-supply at its own tier's price, so no
 *     gate in the game is unreachable and no amount of anybody else's behaviour can lock it out.
 *     A15 and A5′ both rest on that: a gate the rules make impossible to pass is an obligation the
 *     rules make impossible to meet.
 *   - **There is a PRICE, and it is discoverable without a wiki (A2).** A Marches buyer's own cost is
 *     32 ore a unit and a Commons seller's is 8, so **the trading range is 8–32** and every agent can
 *     compute both ends from published constants. A wall has no price, only an availability.
 *   - **The gain from trade is 24 ore a unit and it has to be hauled.** That is the reason a convoy
 *     crosses the map, and the convoy is the show (A13).
 *
 * ── AND WHY THE FRONTIER IS WORST RATHER THAN FORBIDDEN ──────────────────────
 *
 * Forbidding it reads cleaner and is the same deadlock one tier out: `HULL_COST_GOODS` needs `fuel`,
 * fuel is FRONTIER-only, and a frontier claim that could not be anchored would make the combat layer
 * unreachable through the front door. 64 makes a frontier claim *expensive* — three quarters of a
 * Reckoning's ore — which is a reason to buy from the interior, not a reason to give up.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const ALLOY_IN_BY_TIER: Readonly<Record<ZoneTier, number>> = Object.freeze({
  COMMONS: 8,
  MARCHES: 32,
  FRONTIER: 64,
});

/**
 * The alloy recipe: {@link WORKS_YIELD_GOOD} in, {@link ALLOY_GOOD} out. *(calibrate)*
 *
 * **8:1, and the ratio is the price of the fork.** {@link REFINE_IN_QTY} is 1:1 deliberately, so
 * ore and rations are interchangeable and the only scarcity is the action. Alloy must not be: if it
 * converted 1:1 it would be a second name for a ration and the whole design would collapse into
 * the two-good world with a fourth label on it.
 *
 * Worked, because the interesting property is a consequence of the ratio rather than of the number:
 * a sole occupant of a COMMONS system takes `YIELD_PER_TICK.COMMONS` x `TICKS_PER_RECKONING` =
 * **23,040 ore a Reckoning**, against a Levy the calibration puts at ≈20,000. So it can spare
 * roughly 3,000 ore — **375 alloy** — without going short. That is inside one
 * {@link ALLOY_ANCHOR_QTY} and nowhere near two, which is the scarcity the sinks were sized
 * against: a Commons manufacturer supplies about one claim per Reckoning, and a second buyer has to
 * outbid the first.
 *
 * Above 8 the good is unbuyable and both gates jam; below 8 a manufacturer covers the whole map's
 * demand out of its spare ore and the book never has to clear. `test/works/a-good-only-the-commons-makes.spec.ts`
 * pins both edges as arithmetic rather than as a claim.
 */
export const ALLOY_IN_QTY = ALLOY_IN_BY_TIER[ALLOY_TIER];
export const ALLOY_OUT_QTY = 1;

/**
 * Units of {@link ALLOY_GOOD} destroyed to raise an ANCHOR, on top of `ANCHOR_QTY`. *(calibrate)*
 *
 * A tenth of `ANCHOR_QTY` (5,000), which at {@link ALLOY_IN_QTY} is 4,000 ore of input — so the
 * anchor's real goods price roughly doubles, and **the added half is payable in nothing a claimant
 * can produce on claimable ground.** Every claim is outside the Commons, so this is the line that
 * makes a territorial ambition depend on somebody else's industry.
 *
 * Sized *below* what one Commons manufacturer can spare in a Reckoning (see {@link ALLOY_IN_QTY}),
 * because a gate priced above the whole world's supply is not a gate, it is a wall — and a wall
 * here would take `claims` to zero and with it the entire sovereignty layer.
 */
export const ALLOY_ANCHOR_QTY: Qty = qty(500);

/**
 * ⚑ **THE SECOND SINK, DESIGNED, BUILT, MEASURED AND THEN REMOVED — AND THE MEASUREMENT IS THE
 * REASON THIS COMMENT SURVIVES THE CODE.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * §10.1 asks holding upkeep to be *"currency plus a manufactured good, **convex in footprint**"*, and
 * `world/movement.ts:commonsBoundRejection` has told agents since commit #1 that leaving requires *"a
 * holding that pays upkeep in currency **and manufactured goods**"*. The obvious way to cash both was
 * a surcharge on any `graduate` whose origin is **not** the Commons: the first rung stays free
 * (A8's floor, and `GRADUATION_STATEMENT`'s promise that "no seat is a cage"), every rung after it
 * costs a good the departing seat refines four to eight times dearer. It was built end to end —
 * quote field, refusal, burn, observation field, agent.md table.
 *
 * **It closes the Frontier, and with it the whole combat layer, and the cause is structural rather
 * than a tuning error.** Measured on `fz-13` over 900 ticks: zero FRONTIER claims, where master
 * reaches one. The two populations that would need to meet are **disjoint by construction**:
 *
 *   - the cast crosses **before** it builds (`heuristic.ts:graduateFor` refuses a member holding a
 *     WORKS, because *"a WORKS cannot follow a body, so crossing after building strands the member's
 *     own income where it can neither refine nor spend it"* — a measured harm, not a preference);
 *   - so every principal standing on a rung it might cross from **holds no WORKS, and therefore no
 *     ore**, and alloy is refined from ore and nothing else;
 *   - and it cannot buy any, because `market/escrow.ts:freeCash` is `freeBalance −
 *     ENDOWMENT_FLOOR_MINOR` and that is **identically zero for every principal that has ever played
 *     this game** (see {@link ALLOY_IN_BY_TIER}).
 *
 * Three independent walls, and no cast tuning gets past any of them. `HULL_COST_GOODS` needs `fuel`,
 * fuel is FRONTIER-only, so a Frontier nobody can reach is a combat layer nobody can enter through
 * the front door — a much larger loss than the convexity was a gain.
 *
 * ── WHY THE CONSTANT IS DELETED RATHER THAN SET TO ZERO ─────────────────────
 *
 * A constant at 0 behind live code is a mechanism that is built, tested, reported and used by
 * nothing — this repo's defining defect, eleven instances and counting, and the whole reason the
 * fourth good was worth building. It would also read in every future audit as a sink that exists.
 *
 * ── WHAT WOULD MAKE IT SHIPPABLE, SO THE NEXT ATTEMPT DOES NOT RE-DERIVE THIS ─
 *
 * Any **one** of these removes a wall: a funded market buy side (the D7 floor decision — the largest
 * of the three and wanted anyway); a `carryStoresTo` that moves every good rather than only the
 * upkeep good, **plus** a cast that can hold a WORKS and still cross; or a currency substitute on the
 * model of {@link WORKS_GOODS_IN_CURRENCY_MINOR}, which is this codebase's own precedent for exactly
 * this shape — *"a door out of a trap, not a shortcut into the economy."*
 *
 * The ANCHOR half of the sink is **kept and works** ({@link ALLOY_ANCHOR_QTY}): claims measured 3–4 a
 * seed with it, matching master, because a claimant does hold a WORKS and can refine at its own
 * tier's rate.
 * ══════════════════════════════════════════════════════════════════════════
 */

/**
 * **A RULES SURFACE** (hard rule 4). Everything about the fourth good an agent cannot infer, in
 * the engine's own numbers.
 *
 * Served on `holding.works.alloy` and carried verbatim by `agent.md`; the numbers are interpolated
 * from the constants rather than typed again, so scar #1 — the engine and the agent-facing text
 * disagreeing about one number while each reads correctly alone — cannot happen here without a
 * test going red. `FUEL_STATEMENT` is the pattern.
 */
export const ALLOY_STATEMENT =
  `${ALLOY_GOOD} is the manufactured good, and the ONE thing in this game whose price depends on ` +
  `where you make it. \`refine {kind:"ALLOY"}\` turns ${WORKS_YIELD_GOOD} into ${ALLOY_GOOD} at a ` +
  `rate set by the TIER you are standing in: ` +
  `COMMONS ${String(ALLOY_IN_BY_TIER.COMMONS)}:1 · MARCHES ${String(ALLOY_IN_BY_TIER.MARCHES)}:1 · ` +
  `FRONTIER ${String(ALLOY_IN_BY_TIER.FRONTIER)}:1. The Commons has the poorest ore on the map and ` +
  `refines it best; the Frontier has the richest and refines it worst. You can always make your own ` +
  `and you will usually rather buy it from somebody who makes it cheaper — that difference is the ` +
  `only reason a convoy crosses the map. The same ore becomes either ${WORKS_GOOD} (which pays your ` +
  `Levy tonight) or ${ALLOY_GOOD} (which buys ground you keep), and you cannot have both from one ` +
  `lot. ONE thing is priced in it and it is territory: an ANCHOR costs ${String(ALLOY_ANCHOR_QTY)} ` +
  `${ALLOY_GOOD} on top of its rations, and every system a claim can exist on is outside the Commons ` +
  `— so a claim is always partly somebody else's industry. Nothing ELSE consumes it: no crossing, no ` +
  `WORKS, no hull. It cannot be refined into anything, and it pays no obligation — ` +
  `a Levy, a Charge and a WORKS are all payable in ${WORKS_GOOD} and nothing else. Goods are ` +
  `LOCATED: use \`haul\` to carry them one lane on one of your hands.`;

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
 *
 * **"Payable out of the grant" was a window, not a balance** — see
 * {@link WORKS_GOODS_IN_CURRENCY_MINOR}, which is the correction and carries the measurement.
 */
export const WORKS_BUILD_QTY: Qty = qty(5_000);

/**
 * ★ **THE GOODS HALF OF A PRINCIPAL'S *FIRST* WORKS, PAYABLE IN RETIRED CURRENCY INSTEAD.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE DEFECT THIS CLOSES: THE FAUCET'S TAP SAT BEHIND THE DRAIN, AND THAT PRICED ECONOMIC
 * RE-ENTRY IN IDENTITIES (A15 EXACTLY INVERTED).**
 *
 * This file's own header set out to close the deadlock and then reproduced it one level up.
 * Goods enter a principal at exactly two places — the enrolment allotment
 * (`LEVY_STARTER_ALLOTMENT`, 50,000, **once per identity**) and a WORKS it already holds. The
 * Levy destroys goods every Reckoning and the Charge destroys more. So the allotment is a
 * **window**, and {@link WORKS_BUILD_QTY}, `GRADUATION_UPKEEP_QTY` and `ANCHOR_QTY` are each
 * 5,000 units *inside* it. Pay tribute for four Reckonings without building and you reach zero
 * goods with **no legal path back**.
 *
 * Measured on the live world at tick 5,471, and reproduced to the unit by
 * `test/works/the-window-closes.spec.ts`: all twelve cast members held **210,000–225,333 in
 * currency and zero units of every good in the game.** Locked-out members at Reckoning 3: 0 of
 * 8. At Reckoning 6: **8 of 8.** The trap was live for real enrolled agents too — 11 of 16
 * probe accounts sat on untouched allotments — and an honest agent that plays four Reckonings
 * without building was locked out **forever**, with exactly one escape: enrol again. That
 * prices the economy's front door in identities, which is the one thing A15 forbids outright.
 *
 * ── WHY *CURRENCY*, AND WHY THAT IS THE ONLY SHAPE THAT FIXES IT IN THE RULES ──
 *
 * The trap's own signature is the asymmetry that solves it: a drained principal has **money and
 * no goods.** The Levy does not destroy currency. So a currency-priced door reopens the ladder
 * immediately, for everyone already trapped, without rewriting a single past row — which A5
 * forbids anyway.
 *
 * The two alternatives were considered and are worse for reasons that are measured rather than
 * argued. **A market that clears** needs a seller, and the diagnosis found that no living
 * principal held goods to sell; it also would not fix the trap *generally*, only whenever
 * somebody happens to be liquid. **Re-seeding the world** fixes this world and leaves the trap
 * in place for every agent that ever enrols afterwards.
 *
 * ── WHY IT IS RETIRED AND NOT PAID TO ANYBODY (D7) ───────────────────────────
 *
 * `retireCurrency` into `sink:upkeep`, the same sink the currency half already charges. D7's
 * rule is that the endowment may not **leave** a principal, because a puppet handing its stake
 * to its operator turns free identities into capital. Retirement is not transfer: nobody
 * receives this, and a puppet that spends its stake here gives its operator nothing and ends
 * holding a structure it must still play to use. `vBuild`'s cession price keeps `freeCash` for
 * exactly the opposite reason — that one **pays another principal**.
 *
 * ── WHY THIS IS NOT AN A15 HOLE, WHICH IS THE CLAIM THAT HAD TO BE CHECKED ───
 *
 * Two independent reasons, and the second is the load-bearing one:
 *
 *   1. **The map bounds output, not the population.** `Book.sharesAt` divides
 *      {@link YIELD_PER_TICK} among the WORKS standing at a system with `largestRemainder`,
 *      `checkYieldCap` (INV-W1) **halts the world** if a split ever sums above the tier cap, and
 *      `checkWorksPerSystem` (INV-W2) holds {@link WORKS_PER_PRINCIPAL_PER_SYSTEM} at one. Ten
 *      identities with ten WORKS at one system extract exactly what one extracts. World output
 *      is Σ over systems of the tier yield — a property of the map, which no amount of enrolling
 *      changes.
 *   2. **This door is never the cheap route to a WORKS, so it adds no Sybil capacity at all.** A
 *      *fresh* identity already holds 50,000 units of the allotment and can pay
 *      {@link WORKS_BUILD_QTY} out of it, so the cheapest path a puppet farm has — enrol, build
 *      immediately — exists today and this does not lower its price. The door costs strictly
 *      more than the goods it replaces, and it is only reachable by a principal that has already
 *      spent four Reckonings' worth of tribute. It is a door out of a trap, not a shortcut into
 *      the economy.
 *
 * ── THE PRICE *(calibrate)* ──────────────────────────────────────────────────
 *
 * **A tenth of the §12.5 `STARTER_STAKE` (250,000), exactly as {@link WORKS_BUILD_QTY} is a
 * tenth of `LEVY_STARTER_ALLOTMENT`.** The goods half costs a tenth of the goods grant; its
 * currency substitute costs a tenth of the currency grant. Three properties make that the
 * number rather than a round figure:
 *
 *   - **It is FIVE TIMES what the world says the goods are worth.** `LEVY_UNIT_MINOR` is 1 —
 *     the one administered price this game publishes — so 5,000 units of {@link WORKS_GOOD}
 *     discharge 5,000 minor of duty. At 25,000 the door is strictly, visibly worse than
 *     producing, which is what keeps the goods economy meaning something: a principal holding
 *     the goods always pays in goods, and `worksQuote` only takes this route when the goods are
 *     short.
 *   - **It still hurts.** With {@link WORKS_COST_MINOR} it makes a first WORKS cost **85,000**,
 *     a third of everything the world hands a new identity, retired into a structure that yields
 *     nothing for {@link WORKS_SPINUP_TICKS} ticks. Compare `GRADUATION_UPKEEP_MINOR` and
 *     `CLAIM_BOND_MINOR`, both a fifth of the stake: this sits between them, and a principal
 *     that takes this door has spent the stake it would otherwise have bonded a claim with.
 *   - **A drained principal can actually pay it.** The live cast held 210,000–225,333 with
 *     50,000 of that locked in a bond for two of them, so 85,000 clears with room for a venture
 *     — which is the whole point of a door.
 *
 * ── AND WHY IT IS THE **FIRST** WORKS AND NOTHING ELSE ───────────────────────
 *
 * A principal holding a WORKS has a goods income; it does not need a door and should not be
 * offered one, because a currency-payable second rung would let a rich agent skip production
 * entirely and delete the reason the goods economy exists.
 *
 * The gate is `WorksBook.everHeldBy`, which counts **razed** rows, and that choice is load-bearing
 * rather than tidy. `ofPrincipal` filters `razed` and would have answered *"holds none now"* — the
 * same answer only while nothing razed a WORKS. **Something does now:** `works/raze.ts` ends one off
 * a raid rout and off a campaign breach, so the two predicates have genuinely parted and the
 * prediction written here before the mechanism existed was exact — the shorter spelling would reopen
 * this door **once per razing at 25,000 a turn**, an A15 hole arriving with a feature that has
 * nothing to do with it and the shape of the `Book.prune` defect that made a §9 fix evaporate in
 * production only. **There is no cycle to farm and `everHeldBy` is what keeps it that way.**
 *
 * The decision razing forced, and it was made rather than inherited: **a razed principal rebuilds in
 * goods like everybody else.** A door reopening per razing would invert the loss A5 exists to make
 * real and delete the replacement demand razing was built to create. `test/works/raze.spec.ts` asserts
 * it on the engine's own path, and `test/works/the-window-closes.spec.ts` still asserts it on a
 * hand-razed row.
 *
 * ── ★ AND WHAT THAT DECISION COSTS, MEASURED AT NINE RECKONINGS ──────────────
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE SHUT DOOR IS WHAT MAKES A RAZED MEMBER'S LOSS COMPOUND, AND THE BALANCE GATE SEES IT.**
 * 8 seeds × 9 Reckonings on `RULES_VERSION` 30: the two seeds that recorded a razing (`g04`, `g05`)
 * are **exactly** the two with a non-zero `levyShort` (28,281 and 33,638) and the only two with red
 * tribute lines (2/72 each); every seed with `razed: 0` is clean. `g04` also carries `TRAPPED: 1` —
 * the gate's own name for *a member holding no WORKS and rich enough in currency to buy one, which
 * cannot*. That is this constant's trap, re-entered by a principal that has already been through it.
 *
 * The mechanism is a loop: a rout takes the goods **and** the structure in one event, so the member
 * has no stock and no source; without 5,000 units it cannot rebuild; without a rebuild it makes none.
 * The Levy shortfall is that loop showing up in the one place the record publishes.
 *
 * **Reopening the door per razing is the obvious lever and it is NOT an A15 hole**, which is worth
 * writing down because the note above reads as though it would be. A15 forbids gates priced in
 * *identities*; this one would be priced in *having been routed*, which costs a 65,000 structure and
 * half the stock at the stage. And by the bullet above the door is **five times** what the goods are
 * worth, so taking it is strictly loss-making — there is no cycle that profits, only a worse way to
 * pay when the better one is unavailable. Which is what a door out of a trap is.
 *
 * It is left SHUT anyway, because whether a routed principal gets a second bootstrap is a design call
 * about how permanent loss should be (A5), not a defect to patch — and the two seeds are evidence for
 * whoever makes it rather than a reason to make it here.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `GRADUATION_UPKEEP_QTY` and `ANCHOR_QTY` are deliberately **left alone**: measured at 6 and 9
 * Reckonings in `test/works/the-window-closes.spec.ts`, a principal that comes through this door
 * reaches both of them out of production. They are rungs above a floor, and this is the floor.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const WORKS_GOODS_IN_CURRENCY_MINOR: Minor = minor(25_000);

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
