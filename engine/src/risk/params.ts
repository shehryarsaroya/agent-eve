/**
 * Phase 3's risk market — the parameters, and the five words this layer spends.
 *
 * `PASS-ECONOMY-RISK` §7–8 is the source. Its MUST tier is 27 items across five sections; what
 * lands here is the three the owner scoped — **catastrophe, correlated claims, and the
 * pay/restructure/default decision** — plus the one structural feature that makes them a *market*
 * rather than a tax: a cover promise whose subject may be **another cover promise**, so one
 * failure propagates.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ## §3 — THE FIVE WORDS, AND THE SIX THAT WERE REJECTED
 *
 * §3 is a rules surface and *"an uncanonised word is unpoliced by construction"*. So every noun
 * below was checked against §3's table, against the combat and campaign tables, and against
 * `src/` before it was spent. **The rejections are the useful part** and they are recorded here
 * for the same reason `combat/index.ts` records its three:
 *
 *   - **`claim`** — spent, four ways, and §3 already ruled: *"the sovereignty sense keeps the bare
 *     word"*. The insurance-claim concept is the natural noun for {@link INDEMNITY_WORD} and it may
 *     not have it. `claim` is also a live **verb** (the say-do gap's public assertion) and a live
 *     **field** (`RoleClaim.claim`, what a venture role earned). Three homes; no room for a fourth.
 *   - **`peril`** — spent by `ledger/cargoLost.ts`, where `perilReleased`/`perilShed` mean *the
 *     EXPOSURE a lock sheds because its cargo burned*. A risk market wants `peril` for "the hazard
 *     a policy names", which is a different concept one module away. So the hazard is a **FRONT**.
 *   - **`footprint`** — spent by §10.1: holding upkeep is *"convex in footprint"*. The systems a
 *     front strikes are its **SWATH**.
 *   - **`forecast`** — spent by `venture/preview.ts` (`forecastsFor`, `TakeForecast`: a projection
 *     of your take). The front's published prediction is its **CONE**, which is also §10.1's and
 *     CAT2's own image (*"watch a cone tighten"*).
 *   - **`writer`** — spent, seventeen times, as the single-writer-of-a-table idiom (*"`StandingBook`
 *     is the only writer of standing"*). The principal that promises to pay is the **payer** and the
 *     one it owes is the **payee** — words `venture/settlement.ts` already uses for exactly this
 *     relationship. Reusing them is the point: it is the same A7 promise.
 *   - **`policy`** — spent, fifty-seven times, as "standing policy". Hence **COVER**.
 *
 * The five spent here, each with its `never means` column, in the shape §3's table uses:
 *
 * | Term | Means | Never means |
 * |---|---|---|
 * | **FRONT** | ★ the scheduled catastrophe. A published CONE that narrows over RECKONINGS, then LANDS and destroys located goods in its SWATH. §3's combat table **reserved this word for exactly this** — *"`front` is spent by §10.1's scheduled weather front, so the mechanic that wanted it is not built"* — and this is the mechanic | a battle line (§9A's positional axis is ECHELON); a war's lateral axis (still not built); a RAID (predation is somebody's decision, §9; a front is nobody's) |
 * | **CONE** | the FRONT's published prediction — per-system landfall odds in bps, widening then narrowing over the RECKONINGS before it lands | a forecast of your take from a VENTURE (`forecastsFor` owns that); a scan result; the SWATH (which is what actually happened) |
 * | **SWATH** | the systems one FRONT struck, each with an integer INTENSITY | the CONE (the prediction); a holding's footprint (§10.1's upkeep convexity owns *footprint*); a lane; a constellation |
 * | **COVER** | ★ one principal's promise to pay another for goods a FRONT destroys — A7's two halves written over somebody else's loss. Its subject is either located goods **or another COVER**, and that second shape is what lets one failure propagate | insurance in the abstract; a CLAIM; a hull's tank layers; §9A's repair coverage |
 * | **INDEMNITY** | what a COVER owes once a FRONT has struck its subject. The escrowed half pays itself; the elective half is *elected* | a CHARGE-CLAIM (the insolvency waterfall's creditor demand); a premium; a payout in general |
 *
 * ## What this layer deliberately does NOT build, and why
 *
 * §7–8's MUST tier is 27 items. Twenty-two are not here, and the omissions are chosen rather than
 * run out of:
 *
 *   - **RSK2's timed reverse auction, RSK6's technical premium, CAT3's marginal tail capital,
 *     SOL1's balance sheet.** Every one is *pricing*, and a price nobody pays is decoration. The
 *     first question is whether a catastrophe propagates at all; pricing it well is the second.
 *   - **RE2 quota share · RE3 XoL towers · RE4 mutuals · RE5 cat bonds.** All four are shapes of
 *     the same primitive — a promise over somebody else's promise — and RE1's facultative form is
 *     the one that tests whether the primitive works. `over: {cover}` below is that form.
 *   - **GOV2's guaranty fund.** It is a *fifth currency faucet* (`ledger/accounts.ts` holds exactly
 *     two and calls a third "a constitutional change, not a code change"), so it cannot be added
 *     from inside this module and should not be smuggled in as a transfer that looks like one.
 *   - **RSK10 / §7.4-2's bonded contest.** A contest that can delay a due date is the
 *     false-default problem with a verb attached (§15.4). Not until the honest path is measured.
 *
 * ## Every number here is *(calibrate)*
 *
 * SPEC §17's convention. These are starting points for the simulation in
 * `scripts/risk-probe.ts`, not claims of correctness. Integers throughout: **no float reaches a
 * hash** (§15.5), and pricing risk is the one place in this engine where that rule is easiest to
 * break by accident.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { GoodId, ZoneTier } from '../core/types.js';
import { BPS_ONE, bps, minor, type Bps, type Minor } from '../core/units.js';
import { FREEZE_FIRST_PHASE, TICKS_PER_RECKONING } from '../core/time.js';
import { LEVY_DUTY_PER_PRINCIPAL, LEVY_GOOD, LEVY_UNIT_MINOR } from '../levy/params.js';

/**
 * The canon words this module spends, as data, so `canon-word-per-concept` can police them.
 *
 * A list rather than a comment for the reason §3's own ⚑ box gives: the guard *"can only police
 * terms this table lists, so an uncanonised word is unpoliced by construction"*. `ORE` and
 * `RATION` were unpoliced for the project's whole life exactly this way.
 */
export const RISK_CANON: readonly { readonly term: string; readonly means: string }[] =
  Object.freeze([
    { term: 'FRONT', means: 'the scheduled catastrophe: a CONE that narrows, then a SWATH' },
    { term: 'CONE', means: "the FRONT's published per-system landfall odds, in bps" },
    { term: 'SWATH', means: 'the systems one FRONT struck, each with an INTENSITY' },
    { term: 'COVER', means: "a promise to pay another principal for goods a FRONT destroys" },
    { term: 'INDEMNITY', means: 'what a COVER owes once a FRONT has struck its subject' },
  ]);

/** Spelled once, so an affordance string and a canon row cannot drift (scar #1). */
export const INDEMNITY_WORD = 'INDEMNITY' as const;

// ── The FRONT's clock (A14) ─────────────────────────────────────────────────

/**
 * How many RECKONINGS before landfall the CONE is published.
 *
 * A14: *"never ship a mechanic whose drama depends on agents choosing conflict"*. A front is
 * scheduled, announced, and undodgeable — the same lever as the Levy. Two Reckonings is enough
 * for a market to form (buy cover, move goods, or stand naked) and short enough that the whole
 * arc fits inside one watchable stretch.
 */
export const FRONT_CONE_RECKONINGS = 2;

/**
 * The phase of the RECKONING at which a FRONT lands.
 *
 * ★ **Load-bearing, and the reason is architectural rather than dramatic.**
 * `reckoning/driver.ts:verifyInputs` re-reads every payer's free balance between the freeze
 * (phase {@link FREEZE_FIRST_PHASE}) and the settlement, and **halts the world on any difference
 * in either direction**. Landfall destroys goods, not currency, so it could not trip that check
 * directly — but the INDEMNITIES it opens must be electable *before* the freeze, or the payer's
 * only honest answer would be "nothing", which is the record manufacturing a refusal out of a
 * clock. So landfall sits a stated margin ahead of the freeze and that margin is the honour
 * window SOL4 asks for: *"long enough for one clearing tick, short enough to sustain drama."*
 */
export const FRONT_LANDFALL_PHASE = FREEZE_FIRST_PHASE - 70;

/** The honour window, in ticks: landfall to freeze. Published because agents must plan inside it. */
export const HONOUR_WINDOW_TICKS = FREEZE_FIRST_PHASE - FRONT_LANDFALL_PHASE;

/**
 * How close to landfall a FRONT stops accepting new COVER.
 *
 * CAT12, which is a **CUT**: *"instant post-forecast purchase or insurer cancellation … buyers wait
 * for a private warning and insurers cancel on bad news, so only certain losses bind."* The
 * symmetric halves are both here: nothing binds inside this window, and **bound cover is
 * non-cancellable** for the rest of the front's life ({@link COVER_IS_NONCANCELLABLE}).
 */
export const FRONT_COVER_FREEZE_TICKS = 48;

/**
 * Ticks after bind before a COVER attaches.
 *
 * CAT5's waiting period. Without it, an agent watching the CONE tighten buys cover on the tick
 * before landfall at a price set when the odds were long, which is a free option rather than a
 * transfer of risk. With {@link FRONT_COVER_FREEZE_TICKS} above it this is belt and braces: the
 * freeze bounds the *front*, this bounds the *cover*, and a cover written against a front that
 * does not exist yet still has to season.
 */
export const COVER_WAIT_TICKS = 12;

/** Stated as a constant so `agent.md` and the engine cannot disagree about it. */
export const COVER_IS_NONCANCELLABLE = true;

/**
 * ★ **A COVER HAS TWO CLOCKS AND THEY ARE NOT THE SAME CLOCK.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * **This was one field for the first draft of this module and the acceptance test caught it.**
 * `expiresTick` was set to `offeredTick + 144`, so every COVER **lapsed 431 ticks before the FRONT it
 * was written for landed**: the offer was taken, the premium was paid, the escrow was locked, the
 * strike came, and the cohort was **empty**. Nothing failed. `front.struck` reported the goods
 * destroyed, `cover.bound` was on the record, INV-R1…R7 were green over a book with no INDEMNITY in
 * it, and a payee that had paid for cover received nothing while the record showed no default.
 *
 * That is this project's signature defect in its purest form — *a mechanism that exists and is never
 * exercised* — and it was invisible to every instrument except a test that asked *"did the cohort open"*.
 * It is written down here rather than quietly fixed because the shape recurs: **two lifetimes in one
 * field is the same class of bug as two key grammars in one map.**
 *
 * So there are two:
 *
 *   - {@link COVER_OFFER_TTL_TICKS} — how long an **unbound** offer stands. RSK2's
 *     `valid_through_tick`: *"every outstanding firm quote is provisionally added to the book as if
 *     bound, reserving policy collateral… through `valid_through_tick`."* Short, because an offer
 *     nobody takes is capital sterilised.
 *   - {@link COVER_TERM_TICKS} — how long a **bound** COVER covers. Long enough to span a whole
 *     FRONT's life plus the RECKONING that settles it, or the clock discharges the promise.
 * ══════════════════════════════════════════════════════════════════════════════
 */
export const COVER_OFFER_TTL_TICKS = 144;

// ── The SWATH (CAT1) ───────────────────────────────────────────────────────

/** Systems the CONE names. Wider than the SWATH, which is what makes the CONE information. */
export const CONE_SYSTEMS = 8;

/** Systems a FRONT actually strikes. CAT10 is a CUT: never one roll per asset. */
export const SWATH_SYSTEMS_MIN = 2;
export const SWATH_SYSTEMS_MAX = 5;

/**
 * INTENSITY at the centre of the SWATH, in bps of located goods.
 *
 * CAT1 wants *"geographic intensity"* rather than a flat wipe, so intensity falls with distance
 * from the centre ({@link INTENSITY_FALLOFF_BPS}) and is then multiplied by the tier's
 * vulnerability. A front that took everything everywhere would make cover unpriceable and the map
 * unreadable.
 */
export const INTENSITY_MIN_BPS: Bps = bps(3_000);
export const INTENSITY_MAX_BPS: Bps = bps(9_000);

/** Multiplied into INTENSITY once per lane away from the SWATH's centre. */
export const INTENSITY_FALLOFF_BPS: Bps = bps(6_000);

/**
 * Vulnerability by tier, in bps of INTENSITY.
 *
 * ★ **The Commons is struck, and that is §10.1's call, not a relaxation of A8.**
 *
 * > *"Frontiers are where fronts land hardest; **the Commons squall takes goods and never the
 * > holding**."* — §10.1
 *
 * A8 forbids **hostile action by a principal** against a Commons target. A front is nobody's
 * action, and A8's own text is explicit that the floor *"protects your holding, your identity and
 * your record — **not your wealth**"*. Two consequences follow and both are deliberate:
 *
 *   1. **A holding is never destroyed by a front, at any tier.** Only located goods. The front is
 *      a goods sink (§10.1's fourth sink), never a body count.
 *   2. **Cover is worth buying in the Commons.** If the floor were total, the cast — which is
 *      Commons-heavy by construction — would face no peril, nobody would ever buy cover, and this
 *      whole layer would be the project's signature defect shipped on purpose: *a mechanism
 *      nothing ever selects.*
 */
export const VULNERABILITY_BY_TIER: Readonly<Record<ZoneTier, Bps>> = Object.freeze({
  COMMONS: bps(2_500),
  MARCHES: bps(6_000),
  FRONTIER: bps(10_000),
});

/**
 * ★ Goods a principal keeps whatever the INTENSITY, per good. **ONE FLOOR PER GOOD, NOT ONE FLOOR.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * Not mercy — A5′. A front that can take a principal's *last* unit of {@link LEVY_GOOD} leaves it
 * holding the LEVY, which is payable only in located goods, with no way to pay: **A5′ with our own
 * economy as the cause**, which is the exact failure `ledger/endowment.ts` refused to ship.
 *
 * **THE ARGUMENT ABOVE WAS WRITTEN FIRST AND THE NUMBER WAS AN ORDER OF MAGNITUDE TOO LOW.** It was a
 * literal `2_000` against a flat duty of 20,000 units, and `test/cast/the-constellation-closes-ranks`
 * found it at the aged horizon: R8 of `g07` recorded `p:halcyon` **4,275 short of 49,686** while its
 * constellation held 96,770 unpledged units above their own duty. So the levy good's floor is
 * **derived from the duty it exists to protect** rather than chosen — if `LEVY_DUTY_PER_PRINCIPAL`
 * moves, it moves with it, which is the difference between a rule and a coincidence.
 *
 * ⚑ **AND THEN THAT DERIVATION WAS APPLIED TO ALL FOUR GOODS AND KILLED THE SINK FOR THREE OF THEM.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * `destroySet` keys its spare ledger on `${lot.account}::${lot.good}` and charged **one number** —
 * 20,000, a figure derived for `ration` from a `ration`-denominated duty — against **every good**.
 * Measured on a driven world: of 13 exposed `(account, good)` groups, **5 cleared the floor and all
 * five were `ration`**. `ore` peaked at 720, `alloy` at 500, `fuel` at 1,200. A holder of ≤ 20,000
 * units of anything lost **exactly zero at any intensity**, so §10.1's *"fourth goods sink"* was a
 * `ration`-only sink and the front could not touch the three goods the demand side runs on.
 *
 * That is *"a cap sized for one good and applied to four"* — the same shape as the flat weight that
 * made three of the Levy's four allocation rules decoration, arriving through a spare floor.
 *
 * So the floor is now a **function of the good**, and the two branches carry different arguments:
 *
 *   - {@link FRONT_SPARES_LEVY_QTY} — the levy good. One Reckoning's flat duty, derived. **This one is
 *     A5′**: without it a front manufactures a LEVY shortfall the holder could not have avoided.
 *   - {@link FRONT_SPARES_OTHER_QTY} — every other good. **Nothing in this game is payable in `ore`,
 *     `alloy` or `fuel`**, so no obligation becomes impossible when they burn and the A5′ argument does
 *     not transfer. The floor is a small legibility token rather than a shield: a lot that goes to
 *     exactly zero reads on the map as *deleted* rather than *damaged*, and A13 owns that distinction.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Charged **once per `(account, good)`** across every struck system, not per system — see
 * `front.ts:destroySet`. A principal holding the good in three struck places keeps this much in total,
 * not three times it.
 *
 * ⚑ **THE LEVY FLOOR IS ALSO CARRYING A HALF OF §10.1 THAT IS NOT BUILT.**
 *
 * > *"A front is: a published multi-Reckoning forecast … a **destroy set** … and a **deposit set** that
 * > opens *new sites* in its wake. **That last clause is load-bearing**: it is the fresh opportunity
 * > that keeps entering the world … and the reason the map is never the same twice."* — §10.1
 *
 * The destroy set is here; **the deposit set is not**. So this front destroys without renewing — which
 * is precisely what §10.1 warns makes it *"a fourth tax"* rather than *"a central force"*. The levy
 * floor is standing in for the renewal, and it should come **back down** when the deposit set lands.
 *
 * ⚑ `Math.trunc` is not decoration. `LEVY_DUTY_PER_PRINCIPAL / LEVY_UNIT_MINOR` is a bare `/`, exact
 * today **only** because `LEVY_UNIT_MINOR` happens to be 1 — and this number reaches `destroySet`,
 * which decides a hashed quantity. The docblock at the top of this file claims *"Integers throughout:
 * no float reaches a hash"*; without the truncation that claim was one constant change from false.
 */
export const FRONT_SPARES_LEVY_QTY = Math.trunc(LEVY_DUTY_PER_PRINCIPAL / LEVY_UNIT_MINOR);

/** Every good that is not {@link LEVY_GOOD}. See {@link FRONT_SPARES_LEVY_QTY} for why it is small. */
export const FRONT_SPARES_OTHER_QTY = 100;

/**
 * The spare floor for one good. **The only door to either number**, so a caller cannot pick the wrong
 * one — which is exactly what a single exported `FRONT_SPARES_QTY` let `destroySet` do for four goods.
 */
export function frontSparesFor(good: GoodId): number {
  return good === LEVY_GOOD ? FRONT_SPARES_LEVY_QTY : FRONT_SPARES_OTHER_QTY;
}

// ── The COVER (RSK1, RSK3, A7) ──────────────────────────────────────────────

/**
 * A7's band on the elective share of a COVER, in bps.
 *
 * *"Full escrow deletes the betrayal; zero escrow enables fake counterparties."* The floor is
 * §7.5's argument transposed: left free, a payer sets elective to zero, escrow strictly dominates
 * for the buyer, and no trust is ever risked. The ceiling is `MIN_ESCROW_BPS`'s twin — a cover
 * that is *all* promise is a fake counterparty selling paper.
 *
 * Both numbers are the venture band's, on purpose. One promise shape, one band; a second set of
 * numbers for the same axiom would be two answers to one question.
 */
export const COVER_ELECTIVE_BPS_FLOOR: Bps = bps(2_500);
export const COVER_ELECTIVE_BPS_CEILING: Bps = bps(7_500);

/**
 * The payee's retained share of its own loss, in bps. CAT4's skin in the game.
 *
 * Deducted from the loss before the limit applies, so full cover is impossible and a payee always
 * has a reason to move its goods out of the CONE. Without it, cover is strictly better than
 * prudence and the front stops being a decision.
 */
export const COVER_DEDUCTIBLE_BPS: Bps = bps(1_000);

/**
 * How many COVERS may stand in one chain, counting the primary as depth 1.
 *
 * RE6: *"one or two additional layers enable real global diversification and systemic contagion;
 * unlimited recursion creates an exploit and an unreadable settlement graph."* RE11 is the CUT.
 * Three is the pass's own number and it is also the most a `CHAIN` frame line can render at seven
 * labels a frame (§17).
 */
export const COVER_MAX_DEPTH = 3;

/** The least a COVER may promise. Below this the row costs more to render than it can pay. */
export const COVER_MIN_LIMIT: Minor = minor(1_000);

/**
 * Ceiling on a COVER's limit, as bps of the pinned value of the goods it is written over.
 *
 * RSK1 (*"aggregate indemnity stays at/below pre-loss economic interest"*) and CAT6
 * (*"indemnity across layers stays at/below actual loss"*). At `BPS_ONE` exactly, so a payee can
 * insure what it holds and not one unit more — which, together with the exclusive interest lock,
 * is what stops two covers on one lot from manufacturing a shortfall that reads as a default.
 */
export const COVER_LIMIT_CEILING_BPS: Bps = bps(BPS_ONE);

// ── Bounds (INV-26) ────────────────────────────────────────────────────────

/**
 * ★ **THE RETENTION QUESTION, ANSWERED BEFORE IT COSTS ANYTHING.**
 *
 * `Book.prune` has silently destroyed a load-bearing row **five times** in this repo and *"every
 * one failed in the direction that hides"*. A COVER is the worst possible exposure to that,
 * because it is the first object in this engine designed to **outlive several RECKONINGS**: it is
 * bound before a CONE is published, it attaches after a waiting period, and it pays at a
 * settlement two Reckonings later. A window that dropped it would delete a promise, and a deleted
 * promise is not a default — it is a promise that never existed, which is worse.
 *
 * So {@link import('./book.js').RiskBook} states its rule here rather than in a prune:
 *
 *   - **A live COVER is never pruned, at any age or book size.** `CampaignBook` established this
 *     shape (`isLiveCampaign(row.state) ⇒ never pruned`); the difference is that this book's cap
 *     refuses an *insert* when it is full instead of dropping the oldest row, so the failure is a
 *     visible refusal at the door rather than an invisible loss at the back.
 *   - **A settled COVER and its INDEMNITY are retained {@link RISK_RETAINED_RECKONINGS}
 *     Reckonings**, and only after they are terminal. The receipt is already in the append-only
 *     `event` ledger by then, so what a prune drops is a projection, never the record.
 *   - **The per-principal counters are keyed by `PrincipalId` alone and never pruned**, exactly as
 *     `EndowmentBook` argues: *"every window prune in this codebase keys off the compound form;
 *     nothing can reach a bare principal key."*
 *
 * **Would a test notice either clearing?** Yes, by two roads, and they are named here so the claim
 * is checkable: `test/risk/retention.spec.ts` drives a COVER across four Reckonings — one past
 * this window — and asserts it still pays; and it mutation-deletes the row mid-chain and asserts
 * an INV-R violation rather than a silent non-payment.
 *
 * ⚑ **THAT SECOND SENTENCE USED TO SAY "AN INV-R HALT" AND IT WAS NOT ONE.** The test calls
 * `checkRiskInvariants` directly and asserts `faults.length > 0`, which is a *checker* returning a
 * row — and for the whole of this module's first life that was the strongest claim available, because
 * **INV-R was not registered with the engine at all**. `assertRiskInvariants` had exactly one caller,
 * inside `runCohortPhase`, which runs only on a settlement tick, only per struck FRONT, and only when
 * that front's cohort is non-empty. So a book that violated INV-R1…R7 on any other tick — including a
 * book a *restore* rebuilt — was never checked by anything, and an unregistered invariant cannot halt.
 *
 * `runtime.ts`'s `assertions` array now carries a risk entry beside the market's, predation's,
 * combat's, sovereignty's and the campaign's, so the checkers run in `ASSERT` **every tick** and a
 * violation aborts the tick through the one halt path there is. `retention.spec.ts` keeps its direct
 * call *and* gained a driven sibling that asserts the real halt.
 */
export const RISK_RETAINED_RECKONINGS = 4;

/** A front's whole life, in ticks, for the retention arithmetic above. */
export const FRONT_LIFETIME_TICKS = (FRONT_CONE_RECKONINGS + 1) * TICKS_PER_RECKONING;

/**
 * How long a bound COVER covers. See {@link COVER_OFFER_TTL_TICKS} for why this is a second constant.
 *
 * A front's whole life plus one RECKONING, so a COVER written the tick before a CONE is published
 * still stands at the settlement that pays it. Derived rather than a literal: if
 * {@link FRONT_CONE_RECKONINGS} moves, a COVER that used to span a front must not silently stop.
 */
export const COVER_TERM_TICKS = FRONT_LIFETIME_TICKS + TICKS_PER_RECKONING;

export const MAX_FRONTS = 16;
export const MAX_COVERS = 512;
export const MAX_INDEMNITIES = 1_024;
/** Covers one principal may have written and still standing. Bounds the chain walk. */
export const MAX_COVERS_PER_PAYER = 32;

/**
 * **Unstruck** FRONTs at once.
 *
 * One, and the argument is A13 rather than performance: §17 budgets **seven labels a frame**, and
 * two fronts with two CONES and two SWATHS is a weather map instead of a story. CAT1's spectator
 * line is singular for the same reason — *"a catastrophe front crosses the galaxy"*.
 *
 * ⚑ **THIS COULD NOT FIRE, AND THE WAY IT COULD NOT FIRE IS THE INTERESTING PART.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * `announceIfDue` used it as a **silent skip** — count the unstruck live fronts, and `return null`
 * without announcing if the count was at the cap. Two things were wrong with that and they point in
 * opposite directions:
 *
 *   1. **The arithmetic makes the count unreachable.** With {@link FRONT_EVERY_RECKONINGS} = 3 and
 *      {@link FRONT_CONE_RECKONINGS} = 2, the front for reckoning `R + 3` is announced at
 *      `landfallTickOf(R) + TICKS_PER_RECKONING` — a full Reckoning *after* the previous front already
 *      struck. So the unstruck count is 0 at every announcement tick the schedule can produce, and the
 *      branch was a guard whose subject cannot occur: the fifteenth instance of this repo's signature
 *      defect, in the module whose header claims to have avoided it.
 *   2. **Skipping would have been the wrong answer anyway.** A14: the front *"is scheduled, announced,
 *      and undodgeable — the same lever as the Levy."* Quietly not announcing a scheduled front is the
 *      one outcome A14 forbids, and it would have been invisible: no row, no ticker, no fault.
 *
 * So the skip is gone. `announceIfDue` **throws** if the cap is already met — *"abort the tick and
 * halt. Never publish a broken tick"* is the honest response to a schedule that has drifted — and
 * {@link import('./invariants.js').checkInvR9} carries the same bound as a *measured* invariant with
 * `RiskSubjects.unstruckFronts` as its denominator, so "one unstruck front" is a number an instrument
 * prints rather than a claim a comment makes. Mutation: set `FRONT_EVERY_RECKONINGS = 1` and the
 * invariant fires, because front `R + 1` is then announced a Reckoning *before* front `R` lands.
 * ══════════════════════════════════════════════════════════════════════════════
 */
export const MAX_LIVE_FRONTS = 1;

/**
 * How often a FRONT is scheduled, in RECKONINGS.
 *
 * Every third, so the world alternates between a front in the CONE and a Reckoning of quiet in
 * which to rebuild and re-cover. A front every Reckoning is a tax; a front nobody expects is
 * A14's failure mode.
 */
export const FRONT_EVERY_RECKONINGS = 3;
