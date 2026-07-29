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

import type { ZoneTier } from '../core/types.js';
import { BPS_ONE, bps, minor, type Bps, type Minor } from '../core/units.js';
import { FREEZE_FIRST_PHASE, TICKS_PER_RECKONING } from '../core/time.js';
import { LEVY_DUTY_PER_PRINCIPAL, LEVY_UNIT_MINOR } from '../levy/params.js';

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
 * ★ Goods a principal keeps whatever the INTENSITY, per good. **One RECKONING's flat duty.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * Not mercy — A5′. A front that can take a principal's *last* unit of `ration` leaves it holding the
 * LEVY, which is payable only in located goods, with no way to pay: **A5′ with our own economy as the
 * cause**, which is the exact failure `ledger/endowment.ts` refused to ship.
 *
 * **THE ARGUMENT ABOVE WAS WRITTEN FIRST AND THE NUMBER WAS AN ORDER OF MAGNITUDE TOO LOW.** It was a
 * literal `2_000` against a flat duty of 20,000 units, and `test/cast/the-constellation-closes-ranks`
 * found it at the aged horizon: R8 of `g07` recorded `p:halcyon` **4,275 short of 49,686** while its
 * constellation held 96,770 unpledged units above their own duty. The goods had been burned by fronts
 * at R3 and R6 and the reserve could not cover the gap. So the constant is now **derived from the duty
 * it exists to protect** rather than chosen — if `LEVY_DUTY_PER_PRINCIPAL` moves, this moves with it,
 * which is the difference between a rule and a coincidence.
 *
 * Charged **once per `(account, good)`** across every struck system, not per system — see
 * `front.ts:destroySet`. A principal holding the good in three struck places keeps this much in total,
 * not three times it.
 *
 * ⚑ **AND THE REASON THIS FLOOR HAS TO CARRY SO MUCH IS A HALF OF §10.1 THAT IS NOT BUILT.**
 *
 * > *"A front is: a published multi-Reckoning forecast … a **destroy set** … and a **deposit set** that
 * > opens *new sites* in its wake. **That last clause is load-bearing**: it is the fresh opportunity
 * > that keeps entering the world … and the reason the map is never the same twice."* — §10.1
 *
 * The destroy set is here; **the deposit set is not**, because opening a SITE is `src/world/`, which
 * was another agent's lane this round. So this front destroys without renewing — which is precisely
 * what §10.1 warns makes it *"a fourth tax"* rather than *"a central force"*. The spare floor is
 * standing in for the renewal, and it should come **back down** when the deposit set lands. Written
 * here rather than left as a tuning number somebody later mistakes for balance.
 * ══════════════════════════════════════════════════════════════════════════════
 */
export const FRONT_SPARES_QTY = LEVY_DUTY_PER_PRINCIPAL / LEVY_UNIT_MINOR;

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
 * an INV-R halt rather than a silent non-payment.
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
 * Live fronts at once.
 *
 * One, and the argument is A13 rather than performance: §17 budgets **seven labels a frame**, and
 * two fronts with two CONES and two SWATHS is a weather map instead of a story. CAT1's spectator
 * line is singular for the same reason — *"a catastrophe front crosses the galaxy"*.
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
