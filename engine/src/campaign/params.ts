/**
 * A CAMPAIGN's published numbers, and its three rules surfaces.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHAT §16.6 SPECIFIES, AND WHICH PART OF IT THIS IS.**
 *
 * `PASS-TERRITORY-POLITICS.md` §16.6 has sixteen MUST items and §16.12 ranks the whole thing
 * among the five highest-value features in the politics layer:
 *
 * > *"Bonded, objective, supply-driven campaigns with staged decisions and safe reveal-clock
 * > storytelling. Wars have attacker risk, mobilization, fronts, allies, finite endings, and
 * > postmortems humans can follow — without tactical click or timer grind."*
 *
 * Five of the sixteen are what this module is:
 *
 *   - **MUST-2** — a declared machine OBJECTIVE and a **scope-valued bond**, so a war can be won
 *     or lost rather than merely fought, and an unserious one is expensive.
 *   - **MUST-3** — the attacker's own skin: a forward base *"outside Commons, linked by a supplied
 *     route to the objective"*, publicly attackable, whose isolation ends the campaign.
 *   - **MUST-5** — supply as a **graph constraint**, so geography does work and a smaller defender
 *     can win by cutting a corridor.
 *   - **MUST-8** — scheduled decisions on a published clock, *"at least one full wake/standing-order
 *     cycle"*, with **no last-second advantage**.
 *   - **MUST-13** — *"finite, enforceable endings"*: multiple exits, each with a different
 *     arithmetic, and a required sunset.
 *
 * And MUST-1 is the constraint the whole thing is checked against: **the Commons is absolutely
 * uncampaignable.** Not refused — invalid, in both directions: no OBJECTIVE in it and no DEPOT in
 * it (`CMP-1` halts the world over either).
 *
 * ── WHAT IS DELIBERATELY NOT BUILT, AND WHY EACH ─────────────────────────────
 *
 * MUST-4's six-rung escalation ladder (`GRIEVANCE → ULTIMATUM → …`), MUST-9's aid-contract market,
 * MUST-10's war finance, MUST-12's strain aggregate and MUST-14's per-side signed war report are
 * **not here**. Each would need a verb, and §17's budget is 40 of 40 and spent. Allies arrive
 * through `join`'s existing word (one new parameter); withdrawal through `withdraw`'s; declaration
 * through `build {kind:...}`, the shape `refine {kind:...}` and `build {kind:"ANCHOR"}` already
 * established. A mechanic that cannot be reached without a new verb is a mechanic this build may
 * not have, and saying so is cheaper than shipping a ninth thing nobody can enter.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## Nothing here is drawn from an RNG, and that is the point of a campaign
 *
 * §9's demand draws its quantity from a published band so the number carries no information about
 * the target's stock. A campaign draws **nothing at all**: every figure below is a constant or a
 * pure function of the OBJECTIVE's public claim state, so both sides can compute the whole war in
 * advance — how many BREACHES it takes, how much MATERIEL that costs, when each PULSE lands, and
 * exactly what losing is worth. A2: *known arithmetic is exact and machine-readable*. A campaign
 * whose outcome could be argued with is a campaign nobody would enter on purpose.
 *
 * Numbers marked *(calibrate)* are simulation starting points, not claims.
 */

import { TICKS_PER_RECKONING, WINDOW_FIRST_PHASE } from '../core/time.js';
import type { ClaimState, GoodId } from '../core/types.js';
import { minor, qty, type Bps, type Minor, type Qty } from '../core/units.js';
import { bps } from '../core/units.js';
// The CHARGE's good, the claim bond, and the salvage rate a voluntary exit already earns.
// Imported rather than restated: a campaign's numbers are calibrated *against* sovereignty's, and
// two spellings of "what a claim's bond is worth" is scar #5 with territory attached.
import { CESSION_SALVAGE_BPS, CHARGE_BY_TIER, CLAIM_BOND_MINOR } from '../sovereignty/params.js';

/**
 * The good a CAMPAIGN's MATERIEL is denominated in.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **`ration`, AND THE ALTERNATIVE WAS MEASURED AND REJECTED BEFORE IT WAS TRIED HERE.**
 *
 * §9A builds a HULL from `ration` + `fuel`, and the tempting design is to use the same pair —
 * war is war, and a Frontier-only input would make a Marches campaign a genuine logistics graph.
 * SPEC §10's own ⚑ block is why not: `alloy` shipped COMMONS-only first, and over four seeds at
 * six Reckonings **`claims` went from 4 a seed to 0 and stayed there**, because a gate priced in a
 * good the gated tier cannot make is not a price, it is a wall. A campaign is a *larger* version of
 * that gate — five pulses instead of one anchor — so the wall would be five times as tall.
 *
 * The geography is in the **locality** instead, and it is not weaker for being one good: the
 * materiel must be standing at the DEPOT, the depot is outside the Commons, and no WORKS extracts
 * `ration` (a WORKS yields `ore`; `refine` makes rations from it). So every unit of it was refined
 * somewhere and carried at least one lane by a hand. That is a convoy, and a convoy is a line that
 * can be severed (A13).
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Declared with its own literal, never as an alias of `CHARGE_GOOD` or `LEVY_GOOD`:
 * `test/core/goods-are-independent.test.ts` forbids a goods constant defined in terms of another,
 * for the reason its own header gives — one constant wearing four meanings is scar #5 in the type
 * system rather than in a table.
 */
export const MATERIEL_GOOD = 'ration' as GoodId;

/**
 * MATERIEL destroyed at the DEPOT, per PULSE *(calibrate)*.
 *
 * ## Why 3,000, written out so it can be argued with rather than trusted
 *
 * Four constraints pin it, at `TICKS_PER_RECKONING = 288` and the published `YIELD_PER_TICK` of
 * 80 · 110 · 150 with `REFINE_IN_QTY:REFINE_OUT_QTY` at 2:1 (so a MARCHES system's 31,680 ore a
 * Reckoning refines to 15,840 rations):
 *
 *   1. **A campaign must cost more than the CHARGE it is trying to make somebody else miss.** A
 *      MARCHES claim owes 4,000 a Reckoning. Three pulses of 3,000 is 9,000 — more than two
 *      Reckonings of the defender's own bill — so starving a claimant out by *paying its Charge for
 *      it* is never dearer than conquering it, which is the arithmetic that keeps the rescue in the
 *      game as a real alternative to the war.
 *   2. **It must be affordable from one system's output.** 3,000 is 19% of one MARCHES system's
 *      refined yield per Reckoning, so a single-system attacker can fund a campaign and still eat.
 *      At 8,000 only a two-system power could ever declare one, and the mechanic would belong to
 *      whoever was already winning — the calcification A10 exists to prevent.
 *   3. **A full campaign must be a visible industrial effort.** Five pulses is 15,000: three
 *      ANCHORS' worth (`ANCHOR_QTY` = 5,000). A war is the largest thing an agent can spend goods
 *      on, and it should read that way in the ledger.
 *   4. **It must be haulable.** `haul` moves located goods one lane on one hand, so the whole campaign
 *      is somebody making repeated trips. 3,000 a Reckoning is a schedule; 30,000 would be a second job.
 *
 * ## ⚑ MEASURED: SUPPLY BINDS, BUT ONLY AFTER THE ENDOWMENT IS GONE
 *
 * `scripts/campaign-sim.ts` runs a script whose whole purpose is to starve a campaign, and over three
 * seeds it **starved two and won the third outright.** The variance is not noise and it is worth
 * recording, because it is a fact about the floor rather than about this constant:
 *
 * §12.5 seats every principal with `LEVY_STARTER_ALLOTMENT` = 50,000 units of this same good, **at its
 * own system — which is where a DEPOT is.** A whole campaign is `PULSE_MATERIEL_QTY × CAMPAIGN_PULSES`
 * = **15,000**, so the endowment alone funds three wars back to back. A campaign therefore starves only
 * once its attacker has spent that allotment on something else, which is why the same script reaches
 * two different endings on two seeds.
 *
 * Stated rather than fixed, because neither fix is local and neither is this module's to make:
 *
 *   - Raising this constant until it bit regardless (>10,000 a pulse) would break constraint 2 above —
 *     the one that keeps the mechanic away from whoever is already winning.
 *   - The endowment being spendable as war materiel is a question about what D7's allotment is FOR
 *     (`ledger/endowment.ts` already tracks and decrements a goods allotment), and that is an A15
 *     decision about the floor rather than a calibration of a war.
 *
 * So what binds reliably today is **locality and the clock** — the materiel must be at the depot, the
 * depot must be one lane from the objective, and the pulse comes whether or not anybody hauled — and
 * scarcity binds only for an attacker that is already spending. That is weaker than §16.6 MUST-5 wants
 * and it is measured rather than assumed.
 */

export const PULSE_MATERIEL_QTY: Qty = qty(3_000);

/**
 * BREACHES needed to take an OBJECTIVE whose claim is **paying its Charge** *(calibrate)*.
 *
 * Three, and deliberately the same number as `CHARGE_MISSES_TO_LAPSE`: the world's own route to a
 * lapsed claim takes three consecutive failures, and the military route should not be cheaper than
 * the economic one. A campaign that landed a claim in two would make paying the Charge pointless
 * against a determined neighbour, and §6.3's promise — *"a claimant that pays is safe by rule and
 * not by luck"* — would have to be rewritten rather than qualified.
 *
 * What the campaign changes is that the promise now has a **price** instead of being absolute.
 */
export const BREACHES_TO_TAKE_SUPPLIED = 3;

/**
 * BREACHES needed when the OBJECTIVE's claim is already publicly `STRAINED` *(calibrate)*.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THIS IS THE A14 HARDENING, AND IT IS THE CHEAPEST ONE AVAILABLE.** A14 forbids a mechanic
 * whose drama depends on agents *choosing* conflict. A campaign is a choice, and the honest answer
 * to A14 is that its OBJECTIVE is something an agent already wants (see {@link CAMPAIGN_STATEMENT}).
 * But there is a second, free half: **the Charge clock decides when a claim becomes cheap to
 * attack, and nobody controls the Charge clock.**
 *
 * A claim goes `STRAINED` at one recorded miss, on the world's schedule, whether or not any
 * would-be attacker exists. So the *opportunity* arrives on a clock even though the decision does
 * not — which is the same structure as the vulnerability window, one rung earlier and priced in a
 * bond rather than in arrears.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Two rather than one: one BREACH would make a single well-timed pulse take territory, which is
 * the "solved targeting algorithm" the economic critic rejected in `settle.ts`'s own header.
 */
export const BREACHES_TO_TAKE_STRAINED = 2;

/**
 * PULSES a campaign gets, ever. The sunset §16.6 MUST-13 requires *(calibrate)*.
 *
 * Five, so the score reads as a best-of-five series and **a campaign always ends**: the attacker
 * needs {@link BREACHES_TO_TAKE_SUPPLIED} and the defender needs
 * `CAMPAIGN_PULSES − BREACHES_TO_TAKE_SUPPLIED + 1`, and 3 + 3 = 6 > 5, so one of the two
 * conditions is met by pulse five at the latest. {@link rebuffsToStand} computes the defender's
 * number from this one rather than declaring it, so the two cannot be set to a pair that lets a
 * campaign run out with no verdict — {@link assertCampaignSchedule} refuses that at construction.
 *
 * Five Reckonings is also the horizon that makes the story retellable: a viewer can hold five
 * beats. Nine would be a season and nobody would follow it; three would be an incident.
 */
export const CAMPAIGN_PULSES = 5;

/** Consecutive STARVED pulses that end a campaign *(calibrate)*. */
export const STARVES_TO_END = 2;

/**
 * The phase of a Reckoning at which every due PULSE resolves.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **PUBLISHED, FIXED, AND NOT A FUNCTION OF ANYBODY'S CHOICE** (A14, §16.6 MUST-8). *"Submission
 * timing should not reward polling budget or deployment geography in an autonomous-agent world"*
 * and *"no final-second bonus"*. A pulse that landed at a tick either side chose would land at the
 * tick the other side was least able to answer, which is A4's forbidden advantage from wall-clock
 * presence arriving through a war.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * 216, and every digit of it is load-bearing:
 *
 *   - It is **inside the vulnerability window** (phases 168–240), so a `TAKEN` verdict lapses a
 *     claim at a tick when the map is already in its takeover state and any third party standing at
 *     the objective can `build` an anchor on the ruin. The conquest opens a race rather than
 *     handing over a deed.
 *   - It is **after the last world-raid resolution** (phase 192 + 24 = 216 — the same tick, and
 *     `runPredate` resolves raids before campaigns, so a hand wrecked by tonight's weather is
 *     already `RECOVERING` when the pulse counts it).
 *   - It is **strictly before `WINDOW_FIRST_PHASE`** (263), so no pulse ever resolves inside §5.1's
 *     commitment window, freeze or settlement. A pulse moves goods and can move a bond; the freeze
 *     re-reads every payer balance and halts on a difference.
 *   - It leaves **216 ticks of the cycle** for the attacker to haul materiel in and the defender to
 *     march hands home, which is well over the 8–20 ticks of an inter-constellation gate.
 */
export const CAMPAIGN_PULSE_PHASE = 216;

/**
 * The last phase at which a CAMPAIGN may be declared.
 *
 * A declaration after this would have its first PULSE in the *next* cycle either way, which is
 * fine — but a declaration inside the commitment window or the freeze would put a bond lock into a
 * tick §5.1 has already frozen the balances of. So the wall is the same one `demand` uses, and it
 * is published rather than discovered.
 */
export const LAST_DECLARE_PHASE = WINDOW_FIRST_PHASE - 1;

/**
 * The BOND an attacker locks to declare a campaign *(calibrate)*.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **TWICE THE CLAIM BOND, AND THE MULTIPLE IS THE WHOLE DETERRENT.** §16.6 MUST-2 wants a
 * *"scope-valued war bond"* using *"the robust greatest of recipe replacement, verified/capped
 * insured value, and trailing productive/throughput value"*. This build has no insured value and no
 * throughput index, so the scope-value is taken from the one public, unmanipulable figure that
 * actually measures the prize: **what the defender itself was required to post to hold the ground.**
 *
 * Two of them, not one, because a campaign has to be dearer than the alternatives it competes with:
 * the defender can lose at most `CLAIM_BOND_MINOR` to a lapse (`bondAtRiskFor` caps it at one
 * claim's worth), so a bond of one would make declaring a war a coin-flip on equal stakes against a
 * counterparty that never chose to play. At two, a failed campaign costs the attacker strictly more
 * than a successful one costs the defender — which is what "attacker risk" has to mean if it is to
 * mean anything.
 *
 * A15: priced in **slashable capital**, never in identities. A second keypair posts a second bond
 * or declares nothing; there is no per-principal allowance to farm.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * It is not a fee. Nothing takes it on success — {@link CampaignState}'s `TAKEN` and `MOOT` both
 * return it in full — so a serious attacker pays only its MATERIEL. That asymmetry is deliberate:
 * §16.6 MUST-20 CUTs *"formal wardecs … which can continue while bills are paid"*, and a recurring
 * fee is exactly the mechanic it CUTs. What the bond prices is **failure**, not war.
 */
export const CAMPAIGN_BOND_MINOR: Minor = minor(2 * CLAIM_BOND_MINOR);

/**
 * What an ally on the attacking side locks to join *(calibrate)*.
 *
 * §16.6 MUST-9: *"Attackers can recruit allies only as co-belligerents risking their own stake."*
 * So an ATTACKER joiner posts capital that is forfeit with the campaign, and a DEFENDER joiner
 * posts nothing — the same asymmetry `join` already has in §9, and for the same reason: helping
 * somebody defend their home is not an act that needs pricing.
 *
 * A tenth of the declarer's bond. Enough that a roster is a set of decisions rather than a free
 * signature, little enough that a newcomer can be somebody's ally.
 */
export const CAMPAIGN_JOIN_STAKE_MINOR: Minor = minor(Math.trunc(CAMPAIGN_BOND_MINOR / 10));

/**
 * Bond returned to an attacker that lifts a campaign before it is decided, in bps.
 *
 * The same rate `abandon` already returns on a claim, and deliberately the same constant rather
 * than a second 6,000: §16.6 MUST-13 wants *"multiple exits"* and sovereignty already has the
 * worked one. Sixty per cent back makes triage a real strategy — *"this war is lost, take the
 * hands home"* — and forty per cent forfeit stops a lift being a cheaper way to end a campaign
 * than winning it.
 */
export const CAMPAIGN_SALVAGE_BPS: Bps = bps(CESSION_SALVAGE_BPS);

/** Declared bound on the campaign book (INV-26, scar #3). */
export const MAX_CAMPAIGNS = 32;

/** Declared bound on one campaign's roster, both sides together. */
export const MAX_CAMPAIGN_PARTIES = 12;

/** Declared bound on the frame's SAPs. A legend a viewer can read, not a heatmap. */
export const MAX_SAP_LINES = 6;

/** Live campaigns at once, world-wide. The map's own legibility cap. */
export const MAX_LIVE_CAMPAIGNS = 4;

/**
 * Reckonings a **decided** campaign stays in the book.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE PRUNE WINDOW IS THE HIGHEST-RISK NUMBER IN THIS MODULE AND IT IS NOT THE ONE THAT
 * PROTECTS A LIVE CAMPAIGN.** `Book.prune` has dropped the row a mechanic depended on five times
 * in this repo, once making a §9 fix evaporate in production only. A campaign spans up to
 * {@link CAMPAIGN_PULSES} Reckonings — *more* than
 * `SOVEREIGNTY_RETAINED_RECKONINGS` (3) — so a retention window copied from the neighbouring
 * module would delete a war in progress.
 *
 * So retention here is **two independent rules**, and only the second is a window:
 *
 *   1. **A campaign that has not ended is never pruned, at any age, at any book size.** Not "kept
 *      for N Reckonings" — kept, full stop. `Book.prune` reads {@link CampaignState} and refuses,
 *      and `CMP-6` halts the world if a live campaign is ever missing the pulses its own counters
 *      say it ran. `test/campaign/retention.spec.ts` runs a full five-pulse campaign with `prune`
 *      called **every tick** and asserts the row and its postmortem survive to the verdict.
 *   2. **A decided campaign is kept for this many Reckonings**, so the postmortem can render and
 *      the ticker can be read. Six, which is one more than the longest campaign, so a war and its
 *      obituary never overlap in the drop order.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const CAMPAIGN_RETAINED_RECKONINGS = 6;

/** How many PULSES the defender must win to end it. Derived, never declared twice. */
export function rebuffsToStand(breachesNeeded: number): number {
  return CAMPAIGN_PULSES - breachesNeeded + 1;
}

/**
 * BREACHES needed against a claim in this public state, or `null` if it may not be campaigned at
 * all.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **`CONTESTED` RETURNS `null`, AND THAT IS NOT AN OVERSIGHT.** A `CONTESTED` claim is already
 * takeable every Reckoning by anyone standing there who pays its arrears — that is what the
 * vulnerability window *is*. A campaign against one would be spending a bond and five Reckonings of
 * materiel to buy something the rules hand out for the price of a Charge, so offering it would be
 * offering an agent a strictly dominated move at a cost. A2 forbids handing an agent a solved game;
 * it equally forbids handing it a trap.
 *
 * The refusal names the free route, so a would-be attacker learns the cheaper answer rather than
 * being told no.
 * ══════════════════════════════════════════════════════════════════════════
 */
export function breachesToTake(state: ClaimState): number | null {
  if (state === 'SUPPLIED') return BREACHES_TO_TAKE_SUPPLIED;
  if (state === 'STRAINED') return BREACHES_TO_TAKE_STRAINED;
  return null;
}

export class CampaignScheduleError extends Error {}

/**
 * Refuse a set of numbers that would make a campaign unplayable or unwinnable.
 *
 * Run at construction, like `assertRaidSchedule` and `assertSovereigntySchedule`, and for the same
 * reason: a campaign that could not end, or whose pulse landed inside the freeze, could only be
 * resolved illegally or dropped — and both are a permanent public fact about a real agent that the
 * rules made unavoidable (A5′).
 */
export function assertCampaignSchedule(): void {
  const problems: string[] = [];

  if (CAMPAIGN_PULSE_PHASE >= WINDOW_FIRST_PHASE) {
    problems.push(
      `the pulse lands at phase ${String(CAMPAIGN_PULSE_PHASE)}, at or after the commitment window opens at ` +
        `${String(WINDOW_FIRST_PHASE)}; a pulse moves goods and may move a bond, and §5.1 re-reads every payer ` +
        'balance between the freeze and the settlement',
    );
  }
  if (CAMPAIGN_PULSE_PHASE <= 0 || CAMPAIGN_PULSE_PHASE >= TICKS_PER_RECKONING) {
    problems.push(`phase ${String(CAMPAIGN_PULSE_PHASE)} is not inside a Reckoning`);
  }
  if (LAST_DECLARE_PHASE >= WINDOW_FIRST_PHASE) {
    problems.push('a campaign could be declared inside the commitment window');
  }
  // ── THE CLAUSE THAT MATTERS: EVERY CAMPAIGN MUST REACH A VERDICT ───────────
  //
  // If the attacker's target and the defender's target could both be unmet after the last pulse,
  // a campaign would run out of clock with no state to move to — and the only two things the code
  // could then do are leave it live forever (a war nobody can end, which is §16.6 MUST-20's CUT
  // arriving through a calibration) or invent a verdict (A12: the sandbox never authors an
  // outcome). Both are unshippable, so the numbers are refused instead.
  for (const needed of [BREACHES_TO_TAKE_SUPPLIED, BREACHES_TO_TAKE_STRAINED]) {
    if (needed <= 0) {
      problems.push(`${String(needed)} breaches to take is not a war`);
      continue;
    }
    if (needed > CAMPAIGN_PULSES) {
      problems.push(
        `${String(needed)} breaches are needed and only ${String(CAMPAIGN_PULSES)} pulses are ever run, so a ` +
          'campaign at that scope can never be won',
      );
    }
    const stand = rebuffsToStand(needed);
    if (needed + stand <= CAMPAIGN_PULSES) {
      problems.push(
        `${String(needed)} breaches + ${String(stand)} rebuffs is ${String(needed + stand)}, which fits inside ` +
          `${String(CAMPAIGN_PULSES)} pulses — a campaign could exhaust its clock with neither side at its ` +
          'number, and there is no verdict for that',
      );
    }
  }
  if (BREACHES_TO_TAKE_STRAINED > BREACHES_TO_TAKE_SUPPLIED) {
    problems.push('a strained claim is harder to take than a supplied one, which inverts the arrears ladder');
  }
  if (STARVES_TO_END <= 0 || STARVES_TO_END > CAMPAIGN_PULSES) {
    problems.push(`${String(STARVES_TO_END)} starves to end is outside the campaign's own clock`);
  }
  if (CAMPAIGN_BOND_MINOR <= CLAIM_BOND_MINOR) {
    problems.push(
      `a campaign bond of ${String(CAMPAIGN_BOND_MINOR)} is at or below the ${String(CLAIM_BOND_MINOR)} a claim ` +
        'puts at risk, so a failed war costs the attacker no more than a lapse costs its victim',
    );
  }
  if (PULSE_MATERIEL_QTY <= 0) {
    problems.push('a pulse that consumes nothing is not supplied, and supply is the mechanic');
  }
  if (BREACHES_TO_TAKE_SUPPLIED * PULSE_MATERIEL_QTY <= CHARGE_BY_TIER.MARCHES) {
    problems.push(
      `taking a MARCHES claim costs ${String(BREACHES_TO_TAKE_SUPPLIED * PULSE_MATERIEL_QTY)} of ` +
        `${MATERIEL_GOOD} and its Charge is ${String(CHARGE_BY_TIER.MARCHES)}, so conquering a neighbour is ` +
        'cheaper than paying its bill for it and the rescue stops being a move',
    );
  }
  if (CAMPAIGN_RETAINED_RECKONINGS < CAMPAIGN_PULSES) {
    problems.push(
      `decided campaigns are retained for ${String(CAMPAIGN_RETAINED_RECKONINGS)} Reckonings and a campaign can ` +
        `run for ${String(CAMPAIGN_PULSES)}, so a war's own obituary could be pruned before the war it describes`,
    );
  }

  if (problems.length > 0) {
    throw new CampaignScheduleError(
      `the campaign schedule cannot be honoured on this clock:\n  - ${problems.join('\n  - ')}`,
    );
  }
}

/**
 * **A RULES SURFACE** (hard rule 4). What a campaign is, what it costs, and how it ends.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * Carried verbatim in `agent.md` §11E and pinned to it by `test/rules-surface/agent-md.test.ts`,
 * because scar #1 is the engine and the agent-facing text disagreeing about one word and it
 * survived a full build and three critic passes. Every number in it is interpolated from the
 * constant above, never typed twice.
 *
 * **The first sentence is the A14 answer** and it is the load-bearing one: today a claimant that
 * pays its Charge cannot be dislodged at any price, and `claim.ts` says so to every agent that asks
 * — *"Nobody can take a supplied claim at any price."* A campaign is the only thing that makes that
 * sentence conditional. So the reason to declare one is not that conflict is offered; it is that
 * RENT on a system somebody else is holding is the largest recurring income in the game and this is
 * the only road to it.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const CAMPAIGN_STATEMENT =
  'A CAMPAIGN is the only way to take territory from a claimant that is PAYING for it. Outside a ' +
  'campaign a SUPPLIED claim cannot be taken at any price, and a CONTESTED one can be taken for free by ' +
  'anyone standing there in the vulnerability window — so a campaign is for the claim in between, or for ' +
  'the one that is paying and you want anyway. Declare it with `build` ' +
  '{"kind":"CAMPAIGN","system":"<the claimed system>"}. Your HOLDING must stand ONE LANE from that ' +
  'system, outside the Commons, and where it stands becomes your DEPOT. You lock a BOND of ' +
  `${String(CAMPAIGN_BOND_MINOR)} — slashable capital, not a fee: you get ALL of it back if you win and ` +
  'you LOSE it to the defender if you fail. Each Reckoning at phase ' +
  `${String(CAMPAIGN_PULSE_PHASE)} one PULSE resolves: it destroys ${String(PULSE_MATERIEL_QTY)} units of ` +
  `${MATERIEL_GOOD} standing at your DEPOT, then compares your hands at the OBJECTIVE against the ` +
  "defender's hands there plus terrain. Strictly more is a BREACH; equal or fewer is a REBUFF, because " +
  `TIES GO TO THE DEFENDER. ${String(BREACHES_TO_TAKE_SUPPLIED)} breaches take a SUPPLIED claim and ` +
  `${String(BREACHES_TO_TAKE_STRAINED)} take a STRAINED one. No materiel at the depot is a STARVE: it ` +
  `counts for the defender, and ${String(STARVES_TO_END)} in a row ends your campaign and forfeits your ` +
  `bond. A campaign runs at most ${String(CAMPAIGN_PULSES)} pulses and ALWAYS ends: ` +
  `${String(rebuffsToStand(BREACHES_TO_TAKE_SUPPLIED))} rebuffs and the defender has stood. Your first ` +
  'pulse is never in the Reckoning you declared in — the defender always gets a full cycle of notice.';

/**
 * **A RULES SURFACE.** Every ending, and what each one is worth. Named endings rather than a threat.
 *
 * The point of publishing this is that a losing attacker can *choose* the lift and a losing
 * defender can *choose* the cession — which is what makes the collapse a story instead of a cliff,
 * exactly as `ARREARS_STATEMENT` does for the Charge.
 */
export const CAMPAIGN_ENDINGS_STATEMENT =
  'A campaign has five endings and you should read all of them before you declare one. TAKEN: you landed ' +
  'your breaches — the OBJECTIVE\'s claim LAPSES, its holder\'s bond is slashed, the anchor falls, and the ' +
  'system goes UNCLAIMED. You do not inherit it: you must `graduate` your holding there and `build` an ' +
  'ANCHOR like anybody else, and anybody else standing there may beat you to it. REBUFFED: the defender ' +
  'stood, and your whole bond goes TO IT. STARVED: your materiel stopped arriving, and your bond goes to ' +
  'it as well — an attacker that cannot supply its depot loses to logistics, not to force. LIFTED: you ' +
  `called it off with \`withdraw\` {"campaign":"<id>"} and got ${String(CAMPAIGN_SALVAGE_BPS / 100)}% of ` +
  'your bond back, the rest to the defender. MOOT: the claim you were aimed at stopped existing — the ' +
  'holder CEDED it, abandoned it, or let it lapse — and you get your whole bond back because nobody ' +
  'failed at anything. That last one is the defender\'s best move when it is losing: sell the claim and ' +
  'your war has nothing left to take.';

/**
 * **A RULES SURFACE.** How anybody else gets into somebody's war.
 *
 * §16.6 MUST-9 in one paragraph. The asymmetry is published rather than discovered: defending is
 * free, attacking is not, and a joiner's force is counted at the pulse rather than at the join, so
 * signing up and marching away buys nothing.
 */
export const CAMPAIGN_ROSTER_STATEMENT =
  'Anyone may take a side in anyone\'s campaign with `join` {"campaign":"<id>","side":"ATTACKER"|"DEFENDER"}. ' +
  'DEFENDER costs nothing — helping somebody hold their home is not an act that needs pricing. ATTACKER ' +
  `locks ${String(CAMPAIGN_JOIN_STAKE_MINOR)} of slashable capital, which is forfeit with the campaign if it ` +
  'fails: a co-belligerent risks its own stake or it is not one. Joining does NOT commit a hand. Your ' +
  'force is whatever IDLE hands you have standing at the OBJECTIVE when the pulse resolves, counted then ' +
  'and not before — so a promise to help that marches away before the pulse contributes exactly nothing, ' +
  'and reinforcements that arrive mid-cycle count in full. You may not join both sides, and you may not ' +
  'join a campaign against yourself.';
