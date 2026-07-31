/**
 * Sovereignty's published numbers and its three rules surfaces (SPEC §6.3, §16).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **EVERY NUMBER HERE IS PUBLISHED TO AGENTS BEFORE IT IS CHARGED.** A2: known
 * arithmetic is exact and machine-readable, and its corollary — *a formula nobody has
 * written cannot satisfy A2* — is why this is constants and sentences rather than
 * literals in the settler. A5′ raises the stakes above A2's: an arrears is a permanent
 * public accusation, so a claimant that was never shown what it owed must never be
 * recorded short. The three `*_STATEMENT` strings below are what it is shown.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## Nothing here is drawn from an RNG, and that is a §11.2 decision
 *
 * Predation draws its demand from a published *band* so that the number carries no
 * information about the target's stock (`predation/params.ts`). The Charge does not draw
 * at all: it is a pure function of the claim's tier and age, so a claimant can compute
 * next Reckoning's bill exactly, and a **stranger can compute it too** without learning
 * anything about what anybody holds. That is the whole reason the rejected "fuel gauge"
 * is not needed — the amount due is public because it is derived from public facts, and
 * *coverage* stays private because nothing publishes a stockpile.
 *
 * Numbers marked *(calibrate)* are simulation starting points, not claims.
 */

import { TICKS_PER_RECKONING, WINDOW_FIRST_PHASE } from '../core/time.js';
import type { GoodId, ZoneTier } from '../core/types.js';
import { bps, minor, qty, type Bps, type Minor, type Qty } from '../core/units.js';
// The enrolment allotment, read from the module that mints it rather than through the Levy's alias
// for it (the ONE-HOME sweep). Both names are the same number by construction; this one does not make
// `sovereignty/` depend on `levy/`, which it otherwise would for a quantity that is not the Levy's.
import { STARTER_ALLOTMENT } from '../ledger/endowment.js';
// The anchor's manufactured half. `CHARGE_GOOD` below stays declared with its own literal —
// `test/core/goods-are-independent.test.ts` forbids a goods constant defined in terms of another, and
// these are a QUANTITY and a TIER, not a redefinition of which good the Charge is payable in.
import { ALLOY_ANCHOR_QTY, ALLOY_GOOD, ALLOY_IN_BY_TIER } from '../works/params.js';

/**
 * The good the Charge is denominated in.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE SAME GOOD THE LEVY TAKES, AND THE HONEST REASON IS THAT THERE IS ONLY ONE.**
 *
 * `DRAFT-2-synthesis.md` §2 requires three enforcements for a goods Charge — locality,
 * consumption, provenance — plus "at least one input category not producible in the
 * charged system" and "multiple substitutes within the imported category". Two of the
 * three are enforced here and now: the goods must already be **located at the claimed
 * system** (`claim.ts:chargeDeliveryFault`) and the Charge **destroys** them into
 * `sink:consumption` rather than parking them (`settle.ts`).
 *
 * The third and the two diversification rules cannot be enforced yet, because `extract`,
 * `refine` and `build`-as-production are §16 step 11 and there is exactly one good in
 * the economy. Stated rather than hidden: until the production graph lands, the Charge's
 * claim is *"the world must physically supply this system"* with a single supply line,
 * which means a corner on `ration` is a corner on every claim. {@link CHARGE_STATEMENT}
 * says so to the agent, and `notDone` in the build report says so to us.
 * ══════════════════════════════════════════════════════════════════════════
 */
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
export const CHARGE_GOOD = 'ration' as GoodId;

/**
 * The Charge one claim owes per Reckoning, by the tier it stands in *(calibrate)*.
 *
 * §6.3 makes this "the anti-Sybil price of projecting force (A15) and the economy's
 * primary sink", so the Frontier costs more than the Marches: the further out the claim,
 * the more the world must physically supply to keep it. Both are a fraction of
 * `STARTER_ALLOTMENT` (50,000), so a newcomer's endowment cannot pre-fund a season
 * of sovereignty — which is A15 arithmetic, not flavour.
 *
 * COMMONS is present and **zero**, and it is not dead code: `chargeOf` is called for
 * whatever tier a claim's system reports, and a missing key would read as `undefined`
 * and propagate `NaN` into a value path. A Commons claim cannot exist (`claim.ts`
 * refuses it, A8), so zero is the arithmetic statement of that refusal.
 */
export const CHARGE_BY_TIER: Readonly<Record<ZoneTier, Qty>> = Object.freeze({
  COMMONS: qty(0),
  MARCHES: qty(4_000),
  FRONTIER: qty(7_000),
});

/**
 * The surcharge a claim in arrears pays on top of the current Charge, in bps.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **A BOUNDED SURCHARGE, NOT ACCUMULATED BACK ARREARS**, and the economic critic is
 * explicit about why: *"Cure with the current Charge plus a bounded surcharge. Do not
 * accumulate impossible back arrears."* Two misses of 4,000 that compound to 8,000 plus
 * this Reckoning's 4,000 is a bill a blockaded claimant cannot pay by construction, and
 * a state machine whose cure is unreachable is a death spiral with extra steps.
 *
 * So the cure is always `chargeOf(claim) + surcharge`, which is **bounded above** by
 * `chargeOf(claim) × (1 + this)` however many Reckonings the claim has been short. The
 * arrears *count* escalates; the bill does not.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const CHARGE_ARREARS_SURCHARGE_BPS: Bps = bps(2_500);

/**
 * Misses that end a claim. Two put it in the window; the third lapses it.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THREE, NOT TWO, AND THAT IS THE CRITIQUE'S CENTRAL CORRECTION.** Draft 1 had two
 * misses then automatic lapse, and the economic critic called it *"a correlated death
 * spiral, not yet a collapse arc"*: hold one choke for two Reckonings and every claim
 * behind it dies on a fixed attacker cost, which is "a solved targeting algorithm"
 * rather than a story.
 *
 * The third miss buys the arc its middle: `SUPPLIED → STRAINED → CONTESTED → LAPSED`,
 * with a published vulnerability window opening at `CONTESTED` and a fire sale or a
 * rescue available at every step. The critic also asks for lapse to require an attacker
 * to *win a SIEGE*; that is a venture kind this build does not implement, so the third
 * miss is the whole lapse trigger here and `SOVEREIGNTY_STATEMENT` says so.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const CHARGE_MISSES_TO_LAPSE = 3;

/**
 * The miss count at which a claim becomes **CONTESTED** — and therefore takeable.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **DERIVED, BECAUSE THIS NUMBER WAS WRITTEN AS A BARE `2` IN THREE PLACES AND DERIVED IN A FOURTH,
 * AND THE FOURTH HAS A DOCSTRING WARNING ABOUT EXACTLY THAT.**
 *
 * `view.ts:ARREARS_STEPS` already said it, thirty-nine lines above one of the literals: *"Derived
 * rather than written as `2`, so the legend and the threshold can never disagree … a hard-coded `2`
 * would leave the label saying '1 of 2' while the third miss no longer lapsed. That is scar #1's shape
 * in a string a viewer reads."* The label was derived; the **threshold it labels** was not.
 *
 * What the three literals decided, at `RULES_VERSION` 34, with `CHARGE_MISSES_TO_LAPSE` raised to 4:
 *
 *   - `view.ts:claimDoNothing` would still promise `BECOMES_CONTESTABLE` at miss 2,
 *   - `settle.ts:settleCharge` would still **open the vulnerability window** at miss 2 — so anyone
 *     could take the claim a full Reckoning before the legend said it was takeable (A14),
 *   - `invariants.ts` would still accept CONTESTED-at-2, so the A5′ guard written to catch a
 *     mislabelled claim would wave the mislabelling through.
 *
 * A published clock that disagrees with the engine is the clock a defender planned around being
 * wrong, which is the sentence `invariants.ts` uses for the sibling defect it *does* catch.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `CHARGE_MISSES_TO_LAPSE - 1` and not a level of its own: the state before the terminal one is the
 * contested one by definition, and the guard below forbids fewer than three misses to lapse, so this
 * is always ≥ 2 and there is always at least one non-terminal arrears step behind it.
 */
export const CHARGE_MISSES_TO_CONTEST = CHARGE_MISSES_TO_LAPSE - 1;

/**
 * The bond a claim requires, **continuously** *(calibrate)*.
 *
 * §3: BOND is *"posted slashable capital, continuous"* and never *"a claim deposit"* —
 * the vocabulary row names that exact misreading as forbidden, and the economic critic
 * names it again (*"make a claim increase the claimant's continuous BOND requirement;
 * do not use BOND as a one-time claim deposit"*). So this is a **requirement**, not a
 * price: `post_bond` posts capital into a lock that stays open for as long as the claim
 * does, `requiredBondOf` multiplies it by the number of claims held, and the lock is
 * what LAPSE slashes. A claimant that lets its bond fall below the requirement is short
 * on the *bond*, which is a separate published state from being short on the Charge.
 *
 * A fifth of the §12.5 starter stake per claim, so the endowment can back exactly one
 * claim and nothing else — the A15 gate again, priced in slashable capital.
 */
export const CLAIM_BOND_MINOR: Minor = minor(50_000);

/**
 * The anchor: units of produced goods destroyed to bring a claim into being.
 *
 * Destroyed at the claimed system, from lots already standing there, so the price
 * cannot be paid out of goods that never travelled. A tenth of the starter allotment —
 * deliberately not ruinous, because A15's requirement is that the gate cost *produced
 * goods* rather than that it hurt.
 */
export const ANCHOR_QTY: Qty = qty(Math.trunc(STARTER_ALLOTMENT / 10));

/**
 * **THE RENT: the share of a system's extraction its claim-holder takes.** *(calibrate)*
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THIS IS THE HALF OF SOVEREIGNTY THAT WAS MISSING, AND THE BUILD SHIPPED THE OTHER ONE
 * FIRST.** `D23`'s audit is blunt about it: EVE's sovereignty shape was *"copied bill-first"*,
 * and this build took its **upkeep** half with none of its **rent** half —
 *
 * > *"A claim that pays nothing is not EVE sovereignty simplified; it is EVE sovereignty with
 * > the reason removed."*
 *
 * Measured, not inferred: all four read sites of a claim were the holder **paying** —
 * {@link ANCHOR_QTY} destroyed, {@link CLAIM_BOND_MINOR} posted and slashable, a recurring
 * Charge, and a bond requirement that rises with every claim. A probe worked out that the
 * rational answer to *"should I take a claim?"* is **never**, and the cast agreed: the frame
 * carried `claimLines: 0`.
 *
 * `PASS-TERRITORY-POLITICS.md` §16.2 #9 states the test this closes:
 *
 * > *"Territory matters politically only if ownership changes who may live, build, trade, and
 * > receive protection. Residents then have leverage, grievances, and opportunities to
 * > collaborate with an invader."*
 *
 * So the claim-holder takes a published fraction of **every WORKS's extraction at its system,
 * except its own**. Three things that were previously true stop being true:
 *
 *   - `YIELD_PER_TICK` stops being a physics constant and becomes something **someone owns**;
 *   - the Charge acquires a **funding source** that is not the claimant's starter stake;
 *   - and a resident acquires a **grievance**, which is the raw material of politics and the
 *     only thing on this list that the show is actually made of.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## Why 2,000 bps, written out so it can be argued with rather than trusted
 *
 * A fifth. Three arithmetic constraints pin it, at `TICKS_PER_RECKONING = 288` and the
 * published `YIELD_PER_TICK` of 80 / 110 / 150:
 *
 * | tier | system yields / Reckoning | rent at 2,000 bps | its Charge | margin |
 * |---|---|---|---|---|
 * | `MARCHES` | 31,680 | 6,336 | 4,000 | **+2,336** |
 * | `FRONTIER` | 43,200 | 8,640 | 7,000 | **+1,640** |
 *
 *   1. **A fully tenanted claim must cover its own Charge, at both tiers.** Below ~1,700 bps a
 *      FRONTIER claim cannot, and the mechanic goes back to being a bill.
 *   2. **A tenant at the MARCHES must still be better off than one in the Commons**, or the
 *      rent makes `graduate` irrational and A8's quiet-equilibrium risk gets worse rather than
 *      better. A sole tenant nets 31,680 − 6,336 = **25,344** against the Commons' 23,040. At
 *      2,500 bps that margin collapses to 720 and the frontier stops being worth crossing to.
 *   3. **It has to be arithmetic an agent does in its head** (A2). A fifth is; 1,750 bps is not.
 *
 * The rent is taken in the good the place yields — **raw**, not in the good the Charge is
 * payable in — so a landlord still has to `refine` what it collects. That is deliberate: rent
 * funds the Charge, it does not *pay* it, and the act in between is what keeps a rentier
 * playing the game instead of collecting a coupon.
 */
export const CLAIM_RENT_BPS: Bps = bps(2_000);

/**
 * **FUEL: what an anchor burns per Reckoning to keep collecting rent, by tier** *(calibrate)*.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE SINK FOR THE THIRD GOOD, AND THE ONE PLACE IT COULD SAFELY GO.** `works/params.ts`
 * carries the full argument for `FUEL_GOOD`; this is the half of it that belongs to sovereignty.
 *
 * Fuel exists only at FRONTIER systems and no verb moves goods between systems, so a fuel
 * requirement is only satisfiable where fuel is *made*. Two consequences, both load-bearing:
 *
 *   - **`MARCHES` is zero, and that is a rule rather than a gap.** A Marches claim asked for fuel
 *     could never supply it — no local yield, and nothing in the game hauls — so the requirement
 *     would be an obligation the rules make impossible to meet. That is the sentence
 *     `ledger/endowment.ts` uses to refuse removing the starter allotment (*"a newcomer with no
 *     allotment holds an obligation the rules make impossible to meet, which is A5′ with our own
 *     economy as the cause"*), and it applies here unchanged.
 *   - **`COMMONS` is zero because a Commons claim cannot exist** (A8, `claim.ts` refuses it). Zero
 *     is the arithmetic statement of that refusal, exactly as it is in {@link CHARGE_BY_TIER}, and
 *     it is not dead code: a missing key would read `undefined` and propagate `NaN` into a value
 *     path.
 *
 * ## What being short costs, and what it deliberately does NOT cost
 *
 * A cold anchor **collects no rent**. It does not miss a Charge, it does not enter arrears, it
 * does not lapse, and nothing is slashed. Three reasons, in order of how much they matter:
 *
 *   1. **A5′.** A new way to be recorded short is a new way for the permanent public record to
 *      accuse a real agent, and this mechanic depends on a good that only exists in one zone. The
 *      record must never carry a breach the geography made unavoidable.
 *   2. **No death spiral.** `CHARGE_ARREARS_SURCHARGE_BPS` carries the economic critic's rule that
 *      *"the cure must never become arithmetically unreachable"*. A claim that lost its income for
 *      missing a Charge would be exactly that, and rent is the thing that funds the cure.
 *   3. **It is the canon failure step.** `PASS-TERRITORY-POLITICS.md` §16.2 #5's ladder begins
 *      *"`STRAINED` (upgrades shed)"* and #6 says *"priority determines which shuts off under
 *      shortage"*. The rent IS the upgrade. Shedding it is the published answer to a shortage.
 *
 * So the only thing a claimant risks by not fuelling is the income it would otherwise have had —
 * which makes this a **pure opportunity cost**, the one shape of sanction that cannot make the
 * Levy or the Charge harder to pay for anybody.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const ANCHOR_FUEL_BY_TIER: Readonly<Record<ZoneTier, Qty>> = Object.freeze({
  COMMONS: qty(0),
  MARCHES: qty(0),
  FRONTIER: qty(1_200),
});

/**
 * **A RULES SURFACE** (hard rule 4). What a claim now PAYS, and what it costs a resident.
 *
 * Carried verbatim in `agent.md` and pinned by `test/sovereignty/rent.spec.ts`. The rent
 * changes the return on the single most-quoted number in the economy — `share_per_tick`,
 * which `agent.md` calls *"the number that decides whether the build pays for itself"* — and
 * scar #1 is exactly the engine and the agent-facing text disagreeing about one such number
 * while each reads correctly on its own.
 */
export const RENT_STATEMENT =
  `A claim pays its holder RENT: ${String(CLAIM_RENT_BPS / 100)}% of everything every WORKS extracts at ` +
  'that system, taken as the place hands it over, in the RAW good a WORKS yields. It is taken from every ' +
  "WORKS except the claimant's own — a landlord never pays itself rent — and it is published on the claim " +
  'before you build there, so a WORKS you raise on claimed ground shows you the rent already deducted from ' +
  'its quoted share. The rate is fixed when the claim is raised and a takeover cannot raise it on you. ' +
  'Rent is why territory is worth holding: it is what funds the Charge. Rent arrives raw, so a holder ' +
  'still has to `refine` it before any obligation can be paid with it.';

/**
 * **A RULES SURFACE.** Fuel: where it comes from, what it keeps alive, and what running out costs.
 *
 * Published because a claimant that was never told its anchor needs fuel would watch its income
 * stop for no stated reason — and the fix (buy fuel from a neighbour who has some) is only
 * discoverable if the rule is written down. A2: known arithmetic is exact and machine-readable.
 */
export const FUEL_STATEMENT =
  `A FRONTIER claim's anchor burns ${String(ANCHOR_FUEL_BY_TIER.FRONTIER)} units of \`fuel\` once per ` +
  'Reckoning to keep collecting RENT, and the fuel must be unpledged and standing AT the claimed system. ' +
  'A cold anchor collects nothing — the tenants keep their whole share — and that is the ONLY penalty: ' +
  'no arrears, no lapse, no bond slashed. Bring fuel mid-Reckoning and the rent starts again for the rest ' +
  'of it. `fuel` is yielded ONLY by a WORKS standing at a FRONTIER system, it is not produced anywhere ' +
  // ── ★ THIS SENTENCE SAID "no verb in this build moves goods between systems" AND IT WAS TRUE ──
  //
  // `haul` landed with the fourth good and the sentence became **a false rule on the surface a
  // claimant is billed from**, which is scar #1 in the one place A5′ cares most about: a frontier
  // rentier was being told its only option was to buy from its own tenants, when it can now carry fuel
  // in from anywhere it can reach. The `agent.md` copy of §11A was updated in the same change and this
  // one was missed — a duplicated rules string where only one copy moved, which is exactly the risk
  // `agent-md.test.ts` pins the pair against and exactly the kind of miss a fixture sweep found.
  //
  // The replacement keeps the half that is still true (fuel exists in one tier and nowhere else) and
  // states the half that changed, because "buy from your tenants" is now a *choice* rather than the
  // only road, and a claimant that did not know that would overpay a monopolist it could have bypassed.
  'else at any price — so if you hold frontier territory and work none of it, you must get fuel from ' +
  'somebody: BUY it from the residents you are taxing, or `haul` it in one lane at a time on a hand. ' +
  'A MARCHES claim ' +
  'needs no fuel at all: none can be made there, and an obligation the rules make impossible is not one ' +
  'we will record you as having missed.';

/**
 * Bond returned to a claimant that cedes or abandons **before** it lapses, in bps.
 *
 * The critic's *"allow voluntary cession before freeze with partial bond/anchor salvage
 * so an empire can sacrifice its edge"*. Sixty per cent back is enough that triage is a
 * real strategy and little enough that it is not a cheaper Charge — a claimant that
 * cedes every Reckoning and re-claims pays the anchor again each time, which is the
 * arithmetic that keeps the salvage from being a subsidy.
 */
export const CESSION_SALVAGE_BPS: Bps = bps(6_000);

/**
 * The phase of the Reckoning at which the Charge is assessed. Phase 0, like the Levy.
 *
 * The whole cycle is then available to deliver in, which is what makes A5′ satisfiable:
 * *"never record an arrears against one that was never shown what it owed"* is only
 * true if the assessment predates every wake of the Reckoning it settles.
 */
export const CHARGE_ASSESS_PHASE = 0;

/**
 * The phase the allocation ballot closes at. The same phase the Levy's does.
 *
 * One tick before the commitment window opens, so the ballot never resolves inside
 * §5.1's freeze and a claimant reading its assessment at phase 0 already knows the
 * allocation that produced it.
 */
export const CHARGE_BALLOT_CLOSES_PHASE = WINDOW_FIRST_PHASE;

/** Quorum for the allocation ballot, in bps of the constellation's claimants. */
export const CHARGE_QUORUM_BPS: Bps = bps(5_000);

/**
 * The vulnerability window: the phases of a Reckoning during which a `CONTESTED` claim
 * can be taken from its holder.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **PUBLISHED, FIXED, AND NOT A FUNCTION OF ANYBODY'S CHOICE** (A14). *"Drama runs on a
 * clock. Never ship a mechanic whose drama depends on agents choosing conflict — they
 * won't; silence is their rational default."* A takeover that could happen at any tick
 * would happen at the tick the incumbent was least able to answer, which is a mechanic
 * that rewards uptime (A4). A takeover that needed a challenger to *want* one would
 * never happen at all.
 *
 * So the window is a published range of phases, it opens only for a claim the world has
 * already twice recorded short, and it closes before the commitment window — a claim
 * must not change hands inside §5.1's freeze, because the freeze re-reads the balances a
 * settlement was computed from and a takeover moves two principals' currency.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const VULNERABILITY_WINDOW = Object.freeze({
  /** Late enough that the incumbent has had most of a cycle to cure. */
  firstPhase: 168,
  lastPhase: 240,
});

/** Ticks the window is open for. Published, and the countdown an agent reads. */
export const VULNERABILITY_WINDOW_TICKS =
  VULNERABILITY_WINDOW.lastPhase - VULNERABILITY_WINDOW.firstPhase + 1;

/** Reckonings of claim history the book keeps. Older rows live in the event ledger. */
export const SOVEREIGNTY_RETAINED_RECKONINGS = 3;

/** Declared bound on the claim book (INV-26, scar #3). One claim per system, so: systems. */
export const MAX_CLAIMS = 64;

/** Declared bound on the ballot book. */
export const MAX_CHARGE_BALLOTS = 512;

/** Declared bound on the frame's claim lines. A legend a viewer can read, not a heatmap. */
export const MAX_CLAIM_LINES = 12;

export class SovereigntyScheduleError extends Error {}

/**
 * Refuse a clock that would make the vulnerability window unplayable.
 *
 * Run at construction, like `assertSealSchedule` and `assertRaidSchedule`, and for the
 * same reason: a window that opened inside the freeze could only be honoured illegally
 * or dropped, and both are a permanent public fact the rules made unavoidable (A5′).
 */
export function assertSovereigntySchedule(): void {
  const problems: string[] = [];
  if (VULNERABILITY_WINDOW.firstPhase <= CHARGE_ASSESS_PHASE) {
    problems.push(
      `the vulnerability window opens at phase ${String(VULNERABILITY_WINDOW.firstPhase)}, at or before the ` +
        `assessment at phase ${String(CHARGE_ASSESS_PHASE)}; a claim would be contestable before it was told ` +
        'what it owed',
    );
  }
  if (VULNERABILITY_WINDOW.lastPhase >= WINDOW_FIRST_PHASE) {
    problems.push(
      `the vulnerability window closes at phase ${String(VULNERABILITY_WINDOW.lastPhase)}, at or after the ` +
        `commitment window opens at ${String(WINDOW_FIRST_PHASE)}; a claim must not change hands inside the ` +
        'freeze (§5.1)',
    );
  }
  if (VULNERABILITY_WINDOW.lastPhase < VULNERABILITY_WINDOW.firstPhase) {
    problems.push('the vulnerability window closes before it opens');
  }
  if (VULNERABILITY_WINDOW.lastPhase >= TICKS_PER_RECKONING) {
    problems.push(`phase ${String(VULNERABILITY_WINDOW.lastPhase)} is past the end of a Reckoning`);
  }
  if (CHARGE_MISSES_TO_LAPSE < 3) {
    problems.push(
      `${String(CHARGE_MISSES_TO_LAPSE)} misses to lapse is the correlated death spiral the economic critic ` +
        'rejected; the arc needs a CONTESTED middle',
    );
  }
  if (problems.length > 0) {
    throw new SovereigntyScheduleError(
      `the sovereignty schedule cannot be honoured on this clock:\n  - ${problems.join('\n  - ')}`,
    );
  }
}

/**
 * **A RULES SURFACE** (hard rule 4). What a claim is and what it costs.
 *
 * Carried verbatim in `agent.md` and pinned to it by `test/rules-surface/agent-md.test.ts`,
 * because scar #1 is the engine and the agent-facing text disagreeing about one word and
 * it survived a full build and three critic passes.
 */
export const SOVEREIGNTY_STATEMENT =
  'A CLAIM is your sovereign hold on ONE system outside the Commons. You take it with `build` ' +
  `{"kind":"ANCHOR","system":"<id>"}: it destroys ${String(ANCHOR_QTY)} units of ${CHARGE_GOOD} and ` +
  `${String(ALLOY_ANCHOR_QTY)} units of ${ALLOY_GOOD} that are ` +
  'ALREADY STANDING at that system, and it requires you to have posted a BOND of ' +
  `${String(CLAIM_BOND_MINOR)} per claim with \`post_bond\`. The bond is slashable capital and it stays ` +
  'locked for as long as you hold the claim — it is not a deposit you get back. Your holding must stand at ' +
  'the system (`graduate` gets it there) and the system must be MARCHES or FRONTIER: a Commons claim is ' +
  'INVALID, not refused, because nothing in the Commons can be fought over. This gate is priced in produced ' +
  'goods and slashable capital and NEVER in identities, so enrolling again buys you nothing here. ' +
  // ── ★ THIS SENTENCE STATED A PROHIBITION THE ENGINE DOES NOT ENFORCE ────────
  //
  // It read: *"The alloy is the half you cannot make here: it is refined only at a COMMONS system
  // and every claimable system is outside the Commons, so buy it at a Commons venue."* That is
  // false, and it was false in the two loudest places at once — here, in a **rules surface**
  // published in refusals and in every claim statement, and verbatim in `agent.md` §11A and §11B,
  // which a golden-file test pinned to this wording and therefore held in sync **on the wrong
  // version** for fifteen rules releases. Scar #1 inside the guard built to prevent scar #1.
  //
  // {@link ALLOY_IN_BY_TIER} is a *price gradient*: COMMONS 8 · MARCHES 32 · FRONTIER 64, and
  // `works/refine.ts` says so above itself — *"it is a price gradient rather than a wall, because
  // the wall version was measured and deadlocked."* A probe hauled 288 ore to a Marches system,
  // sent `refine {kind:"ALLOY", qty:9}` and got 9 alloy standing there, with no correction.
  //
  // The cost of the false version was not cosmetic: it made every claimant believe an anchor's
  // alloy had to be bought and hauled, so an agent planning off this sentence moves goods it never
  // needed to move — and §11A built a whole Commons↔Frontier trade story on top of it. Built from
  // the constant now, in `tierRates`'s shape, so it cannot drift again.
  `The ${ALLOY_GOOD} is the expensive half rather than the impossible one: the rate depends on the ` +
  `tier the ore stands in — ${(['COMMONS', 'MARCHES', 'FRONTIER'] as const)
    .map((t) => `${t} ${String(ALLOY_IN_BY_TIER[t])}:1`)
    .join(' · ')} — and every claimable system is outside the Commons. So refine it where you ` +
  `stand for ${String(ALLOY_ANCHOR_QTY * ALLOY_IN_BY_TIER.MARCHES)}–` +
  `${String(ALLOY_ANCHOR_QTY * ALLOY_IN_BY_TIER.FRONTIER)} ore, or buy it at a Commons venue with ` +
  '`trade` and bring it with `haul`. Both are legal; the cheaper one depends on what you are short of.';

/**
 * **A RULES SURFACE.** The Charge: what it is, when it is due, and what missing it costs.
 *
 * The whole arc in one paragraph, because an agent that reads only this must still be
 * able to see a lapse coming three Reckonings out. A5′: never record an arrears against
 * a claimant that was never shown what it owed.
 */
export const CHARGE_STATEMENT =
  `Every Reckoning, each claim you hold is assessed a CHARGE in units of ${CHARGE_GOOD}. The TOTAL for your ` +
  'constellation is fixed by rule and cannot be dodged: it is the sum over every claim of a published ' +
  `per-tier amount (MARCHES ${String(CHARGE_BY_TIER.MARCHES)}, FRONTIER ${String(CHARGE_BY_TIER.FRONTIER)}), ` +
  'plus a bounded surcharge on any claim in arrears. WHO BEARS WHICH SHARE is a vote: the constellation\'s ' +
  'claimants `vote` {"ballot":"CHARGE","rule":"..."} on the allocation rule, and may spare one claimant down ' +
  'to a nominal share. Quorum failure applies the published default. It is payable ONLY in goods physically ' +
  `standing at the claimed system, handed over with \`deliver\` {"obligation":"CHARGE","system":"<id>"} by a ` +
  'hand that is standing there — ANY principal\'s hand, including a hauler you hired, because the rule is ' +
  'that the WORLD must supply the system, not that you personally carry it. The goods are DESTROYED, not ' +
  'parked, so the same stockpile cannot pay twice. Partial payment counts: what you deliver reduces what you ' +
  'owe. Deliver before the freeze.';

/**
 * **A RULES SURFACE.** Arrears, the window, and both endings.
 *
 * Named endings rather than a threat: the point of publishing this is that a failing
 * claimant can *choose* the fire sale, which is what makes the collapse a story instead
 * of a cliff.
 */
export const ARREARS_STATEMENT =
  'Miss a Charge and the claim goes into public ARREARS — one miss is STRAINED, two is CONTESTED, and the ' +
  `${String(CHARGE_MISSES_TO_LAPSE)}rd consecutive miss LAPSES it: the claim ends and your bond on it is ` +
  'SLASHED into the upkeep sink. Arrears are CONSECUTIVE: one Charge paid in full clears them completely, ' +
  'and the cure is always the CURRENT Charge plus a bounded surcharge — back arrears never accumulate into a ' +
  'bill you cannot pay. While a claim is CONTESTED there is a PUBLISHED VULNERABILITY WINDOW every Reckoning ' +
  `(phases ${String(VULNERABILITY_WINDOW.firstPhase)}–${String(VULNERABILITY_WINDOW.lastPhase)}) in which ` +
  'ANY principal whose holding stands there may take the claim from you with `build` by paying your arrears ' +
  'and posting its own bond. Outside that window nobody can touch it. Before it lapses you have two exits ' +
  'that are better than lapsing: `publish_offer` {"cede":"<system>","price":N} puts the claim up for sale — a ' +
  'buyer inherits the claim AND its arrears — or `abandon` {"claim":"<system>"} gives it up now and returns ' +
  `${String(CESSION_SALVAGE_BPS / 100)}% of the bond. A transfer never resets the arrears count: delinquency ` +
  'attaches to the system, not to whoever is holding it.';
