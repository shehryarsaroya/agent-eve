/**
 * The house cast — heuristic principals that keep the world from being empty.
 *
 * SPEC §15.6: *"you cannot cast a show you do not fund"*. Agents bring their own
 * inference, which is what makes hundreds affordable, but a world whose external
 * agents have all gone quiet has no show in it. So the house runs a permanent cast
 * on its own keys, and — the part that matters mechanically — **heuristics fill
 * unfilled role slots so ventures always resolve.** A venture that never fills is
 * a story that never happens, and §7.2's concurrency rule means one unfilled slot
 * kills the whole thing.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **EVERY DRAW COMES FROM `Rng`.** `Math.random` is banned by lint (DET-7) and the
 * ban is not about tidiness: the cast is inside the tick, so a single unseeded draw
 * makes the whole world unreplayable, and replay is the only thing that makes a
 * permanent public record trustworthy. Each bot derives its own sub-stream from the
 * tick's seed by label, so adding a bot cannot shift another bot's draws — or every
 * golden file moves and it reads as a balance regression.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The cast is **`HEURISTIC`**, and it says so in every action's `decision_source`.
 * That honesty is what makes `GET /health` able to catch scar #14b: if the LLM
 * players fall back, the deciding share collapses and the health check fails. A
 * cast that labelled itself `LIVE` would make the one measurement that catches the
 * silent failure permanently green.
 */

import {
  HULL_COST_GOODS,
  hullQuote,
  simulateFit,
  SLICES_PER_TICK,
  WORLD_PRINCIPAL,
  worldFleetProfile,
} from '../combat/index.js';
import { Rng } from '../core/rng.js';
import { inFreeze, isSettlementTick, TICKS_PER_RECKONING } from '../core/time.js';
import type { PrincipalId, SystemId, VentureId, VentureKind } from '../core/types.js';
import { BPS_ONE, minor } from '../core/units.js';
import { compareIds } from '../ledger/index.js';
import {
  LEVY_BALLOT,
  LEVY_DUTY_PER_PRINCIPAL,
  LEVY_RULES,
  LEVY_UNIT_MINOR,
  ballotWindow,
  carrierAt,
  constellationOf,
  isNewcomer,
  rollByConstellation,
  weightOf,
  type LevyRule,
} from '../levy/index.js';
import { IN_FULL, kindSpec, openIndices, roleOfPrincipal, type Election } from '../venture/index.js';
import { DEFAULT_CHARTER } from '../syndicate/charter.js';
import { FOUNDING_COST_MINOR } from '../syndicate/params.js';
import {
  ALLOY_ANCHOR_QTY,
  ALLOY_GOOD,
  ALLOY_IN_BY_TIER,
  ALLOY_TIER,
  REFINE_IN_QTY,
  REFINE_OUT_QTY,
  YIELD_PER_TICK,
} from '../works/params.js';
import { freeCash } from '../market/index.js';
import {
  handsOf,
  holdingOccupancy,
  holdingOf,
  isPresent,
  MAX_HAUL_QTY,
  principalIsCommonsBound,
  route,
  tierOf,
} from '../world/index.js';
import { ANCHOR_QTY, chargeOf, CLAIM_BOND_MINOR } from '../sovereignty/index.js';
import { WORKS_COST_MINOR } from '../works/params.js';
import {
  defaultTerms,
  DELIVERY_MEASURE,
  DELIVERY_VERB,
  ELECTABLE_VENTURE_STATES,
  freeStores,
  reckoningOf,
  type Runtime,
} from '../sim/runtime.js';
import type { SubmittedAction } from '../tick/index.js';

/**
 * Named cast members. §15.6: "a permanent cast of 12–20 named principals".
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **NO NAME HERE MAY APPEAR AS A HANDLE IN `agent.md`.** A principal id is derived
 * from its handle, so a cast name that `agent.md` uses as a worked example is a handle
 * a first-time agent will send verbatim and be refused for — and, before the enrol
 * handler was fixed, was a handle that bound the caller's key to a house-cast
 * principal outright (see the A5′ note in `src/api/server.ts`).
 *
 * This list previously began with `vale`, which is exactly the handle `agent.md` §2
 * uses in `{ "handle": "vale" }` and in `vale@agenttransfer.dev`. `agent.md` is the
 * contract and does not move, so the cast does.
 * `test/cast/heuristic.test.ts` parses the document and asserts the disjointness, so
 * the next name added cannot quietly re-close the trap.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const CAST_NAMES: readonly string[] = Object.freeze([
  'varrow',
  'halcyon',
  'vex',
  'brannock',
  'sable',
  'orrin',
  'thessaly',
  'kestrel',
  'dunmore',
  'ferren',
  'ashlin',
  'corvid',
  'marrow',
  'quill',
  'severin',
  'tolen',
  'wren',
  'ysolde',
  'bram',
  'cassian',
]);

export const MAX_CAST = CAST_NAMES.length;

/**
 * What a bot is for.
 *
 * Lower case deliberately: `RAIDER` and `ESCORT` are `RoleLabel` members and
 * `RAID`/`ESCORT` are `VentureKind` members, and a third ALL-CAPS union sharing
 * those words would be one word doing three jobs (§3, and the repo-wide vocabulary
 * guard would catch it — which is the point of writing it this way first).
 */
export type CastRole = 'digger' | 'hauler' | 'escort' | 'raider';

export const CAST_ROLES: readonly CastRole[] = Object.freeze(['digger', 'hauler', 'escort', 'raider']);

/** Which kind each role creates when it decides to start something. */
const CREATES: Readonly<Record<CastRole, VentureKind>> = Object.freeze({
  digger: 'DIG',
  hauler: 'HAUL',
  escort: 'ESCORT',
  raider: 'RAID',
});

export interface CastMember {
  readonly principal: PrincipalId;
  readonly handle: string;
  readonly role: CastRole;
  /** Where it was seated. Raiders sit outside the Commons, or they can never act. */
  readonly seat: SystemId;
}

export interface CastOptions {
  /** How many to seat. Capped at {@link MAX_CAST}. */
  readonly size: number;
  /**
   * Chance in 10 000 that a member creates a venture on a tick it has nothing else
   * to do. Integers only: a float here would be a float in a hashed path the moment
   * anybody put the cast's state into a snapshot.
   */
  readonly createChanceBps?: number;
  /**
   * Chance in 10 000 that a member hands an eligible counterparty an OFFICE on a tick it could.
   * Integers only, for the same reason as `createChanceBps`.
   */
  readonly grantChanceBps?: number;
  /** Chance in 10 000 that a member raises its one WORKS on a tick it could afford to. */
  readonly worksChanceBps?: number;
  /** Chance in 10 000 that a member founds its one syndicate on a tick it could afford to. */
  readonly syndicateChanceBps?: number;
  /** Chance in 10 000 that a member leaves the Commons on a tick the crossing pays. */
  readonly graduateChanceBps?: number;
  /** Chance in 10 000 that a member takes the ground it already works, on a tick it can. */
  readonly claimChanceBps?: number;
}

/**
 * Default appetite. *(calibrate)* — high enough that a day has ventures in it.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **RAISED FROM 2,000 THE DAY {@link HeuristicCast.canPromiseOneMore} LANDED, AND THE TWO GO
 * TOGETHER.** This roll used to be the only brake on how many unsecured promises a member opened,
 * so its value was doing two jobs: setting the pace of the board *and* standing in for solvency.
 * With an A7 gate in front of `create` — a payer may not add to a book its appetite already fails to
 * cover — solvency has its own answer, and at 2,000 the roll then became the binding constraint in
 * the wrong direction: measured, the board thinned 22% (venture count 689 against 886) while the
 * defaults it was supposed to be pacing had already been fixed by the gate.
 *
 * Doubling it restores the board without restoring the breaches, and the two numbers were chosen
 * against each other rather than separately (4 seeds x 900 ticks x 8 members):
 *
 * | create bps | A7 gate | ventures | kept | broken |
 * |---|---|---|---|---|
 * | 2,000 | no | 1,123 | 124 | **78** |
 * | 2,000 | yes | 689 | 156 | 30 |
 * | **4,000** | **yes** | **905** | **172** | **16** |
 * | 6,000 | yes | 1,063 | 168 | 24 |
 *
 * The middle row is the one that matters: the gate is what removes the defaults, and this constant
 * is what pays for it. Six thousand is also defensible and buys a busier board for eight more
 * breaches; four is where the world is closest to the one the corpus was measured on.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const DEFAULT_CREATE_CHANCE_BPS = 4_000;

/**
 * Default appetite for handing out an office. *(calibrate)*
 *
 * Lower than `create` on purpose. `grantCandidates` already excludes anyone who holds a live grant
 * from this grantor, so the branch is self-limiting by construction and does not need a low roll to
 * avoid spamming. The roll is here for a different reason: a bot that delegates the instant it clears
 * the eligibility bar makes every grant land at the same point in a relationship, and A6's arc is
 * supposed to have a *decision* in it. Variance is what makes the timing legible as a choice.
 */
export const DEFAULT_GRANT_CHANCE_BPS = 1_200;

/**
 * Default appetite for raising a WORKS. *(calibrate)*
 *
 * A roll rather than "build the moment you can afford it", and the reason is variance rather than
 * balance. Building immediately is arguably the *right* play — the affordance says so, and every member
 * can afford one out of its endowment at tick 0 — but every member doing the same thing on the same
 * tick is a monoculture: the whole cast spends its currency simultaneously, the `build` affordance then
 * vanishes for want of an affordable buyer, and a world with no spread in it stops being a useful
 * fixture. Four unrelated tests broke on exactly that.
 *
 * At this rate the eight members raise theirs across the first Reckoning or so instead of all at once,
 * which is also what a real cohort would look like.
 */
export const DEFAULT_WORKS_CHANCE_BPS = 400;

/**
 * Default appetite for founding a house. *(calibrate)*
 *
 * Lower than the WORKS, because a charter is permanent and there is no verb that amends one. A cast
 * that founds eagerly fills the world with identical constitutions; a cast that founds rarely leaves
 * the mechanic visible without pretending politics are settled.
 */
export const DEFAULT_SYNDICATE_CHANCE_BPS = 150;

/**
 * Default appetite for leaving the Commons. *(calibrate)*
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THIS IS THE ONLY ROLL IN THIS FILE THAT COMPETES WITH ANOTHER ONE, AND THAT IS THE
 * MECHANISM RATHER THAN A SIDE EFFECT.**
 *
 * The branch is gated on holding **no WORKS**, and it sits directly above the WORKS branch, so
 * on every tick a member is effectively choosing between the two: at 1,200 against
 * {@link DEFAULT_WORKS_CHANCE_BPS} of 400, roughly three in four cross before they build and
 * one in four sinks its capital into the Commons and stays there for good. Both outcomes are
 * meant to exist. A cast that all left would empty the safe zone A8 exists to guarantee; a cast
 * that none left is the world this branch was written to end.
 *
 * The rate is high in absolute terms because these rolls are **per tick** and 288 of them fit
 * in a Reckoning — {@link DEFAULT_WORKS_CHANCE_BPS} at 400 already means "within about 25
 * ticks". So the number that matters is not 1,200, it is the RATIO, and the ratio is what was
 * calibrated: the crossing has to win often enough that the frontier is populated and lose
 * often enough that the Commons is not a ghost town.
 *
 * Note what the roll is NOT doing here. `build`'s roll exists for variance, because every member
 * could afford a WORKS on tick 0 and a monoculture is a useless fixture. This one has a stronger
 * job: `graduate` is the most one-way act in the game — it ends A8 for that principal and no
 * verb brings a holding back in — so a deterministic "cross the moment it pays" would make the
 * safe floor a formality that no cast member ever actually stood on.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const DEFAULT_GRADUATE_CHANCE_BPS = 1_200;

/**
 * Currency a crossing must leave behind: enough for the WORKS **and** the bond. *(calibrate)*
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE FIRST HALF OF THE BALANCE GATE, AND IT IS ARITHMETIC RATHER THAN A ROLL.**
 *
 * A member that crosses and then cannot afford to work the ground it landed on is strictly
 * poorer than one that stayed: it has paid 50,000 and 5,000 goods for a worse Levy position and
 * no income. Worse, it can never claim — {@link CAST_CLAIM_CHANCE_BPS}'s gate requires a
 * producing WORKS — so it is stranded outside the floor with nothing to show for it.
 *
 * So the crossing is refused unless the *whole road* is still affordable after it, and the road
 * is priced off the engine's own constants rather than a remembered figure: `WORKS_COST_MINOR`
 * (60,000) plus `CLAIM_BOND_MINOR` (50,000). At the §12.5 stake of 250,000 that permits exactly
 * **two** crossings and then stops, which is what keeps a wanderer from spending its whole
 * endowment on gates.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const CAST_GRADUATE_RESERVE_MINOR = WORKS_COST_MINOR + CLAIM_BOND_MINOR;

/**
 * Default appetite for taking the ground under your own WORKS. *(calibrate)*
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE LOWEST ROLL IN THE FILE, AND LOWER THAN THE CHARTER'S.** A claim is the only thing a
 * member can acquire that bills it **forever**: `CHARGE_BY_TIER` every Reckoning, three
 * consecutive misses and the claim lapses with `CLAIM_BOND_MINOR` slashed into a sink. A syndicate's
 * charter is permanent but free to hold; territory is permanent *and* metered.
 *
 * It is also the only branch whose downside lands on the **public record**: an arrears is a
 * published accusation and a lapse is a permanent one. A5 has no opt-out, so a cast that claimed
 * eagerly would fill the record with breaches, and the breaches would be OURS rather than the
 * agents' — which is the shape A5′ calls worse than a crash.
 *
 * Self-limiting three times over besides the roll: one claim per member, only on ground the member
 * already works, and only where the arithmetic gate below clears. Measured at this rate a claim
 * appears within the first Reckoning or two of a member's WORKS coming online, which is when the
 * decision is actually available to it.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const DEFAULT_CLAIM_CHANCE_BPS = 100;

/**
 * How many times over the ground must cover its own Charge before a member will take it.
 * *(calibrate)*
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THIS IS THE BALANCE GATE, AND IT IS THE WHOLE REASON THE BRANCH IS SAFE.**
 *
 * Claiming destroys `ANCHOR_QTY` (5,000) of the good the Levy is payable in, locks
 * `CLAIM_BOND_MINOR` (50,000) out of the free balance that keeps elective promises, and adds a
 * recurring Charge **in the same good as the tribute**. Naively taken, that is three ways to make
 * `levyShort` worse at once, and the Levy is already the meter §14.2 puts on screen as the headline.
 *
 * So the branch will not touch ground that does not pay for its own upkeep several times over. At
 * `TICKS_PER_RECKONING = 288` and the published yields:
 *
 * | tier | occupants | share/tick | per Reckoning | Charge x 3 | takes it? |
 * |---|---|---|---|---|---|
 * | MARCHES | 1 (yours) | 110 | 31,680 | 12,000 | yes |
 * | MARCHES | 2 | 55 | 15,840 | 12,000 | yes — and this is the tenanted case that pays RENT |
 * | MARCHES | 3 | 36 | 10,368 | 12,000 | **no** |
 * | FRONTIER | 1 | 150 | 43,200 | 21,000 | yes |
 * | FRONTIER | 2 | 75 | 21,600 | 21,000 | yes, barely |
 * | FRONTIER | 3 | 50 | 14,400 | 21,000 | **no** |
 *
 * Three rather than two so the margin also covers the tribute, and rather than four because four
 * refuses the two-occupant MARCHES case — which is exactly the case where a claim collects rent
 * from somebody, and a gate that only permitted claims on empty ground would produce
 * `rent_to: null` forever, which is the defect this whole branch exists to end.
 *
 * The projection deliberately ignores the rent the claim would collect, so the gate is an
 * **understatement**: income can only be better than it reads here.
 *
 * The "per Reckoning" column is income **after `refine`** — the yield is `ore` and the Charge is
 * payable in `ration`, so the comparison runs through `REFINE_OUT_QTY / REFINE_IN_QTY` at the call
 * site. At today's 1:1 recipe the figures above are unchanged; the ratio is written into the
 * arithmetic so they move with the recipe instead of silently ceasing to be true.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const CAST_CLAIM_COVER_MULTIPLE = 3;

/**
 * How much raw ore a cast member waits for before spending an action to refine. *(calibrate)*
 *
 * A CAST POLICY, not a rule — the engine refines any whole batch, and an agent with a reason to convert
 * a single unit may. This is the bot answering "is this worth one of my four actions this tick", and the
 * first version got it wrong by not asking: with no threshold, a WORKS yielding every tick meant there
 * was always ~1 ore available, so **refine fired 2,543 times in 900 ticks** and starved everything else
 * — `move` fell from 1,000 to 710, `elect` from 325 to 118, `build` from 8 to 3.
 *
 * That is the same monoculture failure as the WORKS branch building on tick 0, in the opposite
 * direction: a branch placed high with no gate does not add behaviour, it replaces it.
 */
export const CAST_REFINE_MIN_QTY = 500;

/**
 * The other half of the same threshold: **roughly how many ticks of output are worth one action.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **A FIXED FLOOR IS THE WRONG SHAPE FOR THIS, AND THE CROSSING PROVED IT.**
 *
 * {@link CAST_REFINE_MIN_QTY} was calibrated against the only world that existed: eight members,
 * eight WORKS, four COMMONS systems, so every member took `80 / 2 = 40` a tick and crossed 500 every
 * twelve or thirteen ticks. That produced ~690 refines in 900 ticks and left room for everything
 * else — which is exactly what its own note says the threshold is for.
 *
 * Then members started leaving the Commons, and the same absolute floor met a world with **twice
 * the output per member**: an uncrowded MARCHES system pays 110 a tick, a FRONTIER one 150. Measured:
 * refine went from ~690 to ~1,020 and the venture count fell 21%, because refining is placed third
 * and a branch that fires more often is a branch that displaces the ones below it. That is the
 * *identical* failure the constant was introduced to fix (`refine fired 2,543 times and starved
 * everything else`), reappearing not because the number changed but because the world did.
 *
 * So the floor scales with income: **wait about half a day's own output, or 500, whichever is more.**
 * At the old 40 a tick, `12 × 40 = 480` is below 500 and the threshold is unchanged — the baseline is
 * bit-identical, which is what makes this a fix rather than a re-tuning. At 110 it becomes 1,320 and
 * at 150 it becomes 1,800, so a richer member spends the same number of actions converting and the
 * rest on the game.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const CAST_REFINE_MIN_TICKS = 12;

/**
 * ★ Units of `ALLOY_GOOD` a Commons member refines in one batch, and offers in one ask. *(calibrate)*
 *
 * **Exactly `ALLOY_ANCHOR_QTY` (500), and that equality is the point rather than a coincidence.** One
 * batch is one anchor's worth, so a single fill completes a single buyer's errand and the errand branch
 * can stop. Smaller and a claim needs two purchases, two walks and two hauls before the anchor is
 * payable — a chain long enough that a break anywhere leaves the good inert, which is the failure this
 * whole change exists to avoid. Larger and one member's ask is more than the world's demand, so the
 * book clears once and never again.
 *
 * At `ALLOY_IN_QTY` = 8 the batch consumes **4,000 ore** — about a sixth of what a sole Commons
 * occupant's system yields in a Reckoning (`YIELD_PER_TICK.COMMONS` × `TICKS_PER_RECKONING` = 23,040),
 * so a supplier can make roughly one a Reckoning out of ore its tribute does not need.
 */
export const CAST_ALLOY_ASK_QTY = 500;

/**
 * Reckonings of tribute a Commons member keeps in `ration` before it will refine any alloy.
 * *(calibrate)*
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE ONE GUARD THAT PROTECTS THE ONLY TWO STABLE METERS IN THE INSTRUMENT.** `balance-gate.ts`'s
 * null control moved `ventures` −15% and `CARRIED` −83% on nothing but the *sign* of a tie-break, so
 * those columns are not meters. `levyShort` and the red tribute line count are, and they are exactly
 * what a second use for ore could break: the alloy recipe and the ration recipe compete for the same
 * lot, and a bot that refined alloy while short of tribute would manufacture a shortfall out of a
 * feature.
 *
 * **Two** rather than one, for `CAST_CARRY_RESERVE_RECKONINGS`'s reason: an assessment is levied on
 * the docket at the *end* of a cycle, so a member holding exactly this Reckoning's duty is one
 * unfavourable allocation rule away from short. Two gives the reserve a Reckoning of slack, which is
 * the direction a guard on a permanent public record should err in (A5′).
 * ══════════════════════════════════════════════════════════════════════════
 */
export const CAST_ALLOY_RESERVE_RECKONINGS = 2;

/**
 * The seller's markup over its own input cost, as an integer fraction. *(calibrate)*
 *
 * The floor is `ALLOY_IN_QTY × LEVY_UNIT_MINOR` = 8 minor: below it, a Commons member is better off
 * paying tribute with the ore. **3/2 of that is 12**, which leaves the seller 4 minor a unit — 2,000
 * on a 500-unit ask — for an action, a Reckoning of ore, and the risk of a book that does not clear.
 *
 * A fraction rather than a bps rate because both halves must be integers all the way through: a float
 * in a value path is banned and this figure becomes a `limitPrice` that reaches a hash. Deliberately
 * *not* a percentage of anything the buyer holds — that would make the price a wealth ranking, which is
 * the measured failure `stakeFor` documents at length and which cost the world a quarter of its
 * ventures the first time it was written that way.
 */
export const CAST_ALLOY_MARKUP_NUM = 3;
export const CAST_ALLOY_MARKUP_DEN = 2;

/**
 * The fleet a cast member will build, **in build order**, and why it is these three ships.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THREE, BECAUSE THREE IS THE REAL CAP, AND `MAX_HULLS_PER_PRINCIPAL` IS 6.** `combat/index.ts`
 * states the property this list is written against: *"a principal has three hands and `engage`
 * requires an IDLE hand at the stage to crew each hull, so the real cap on a fleet one principal
 * can field is three… a fleet larger than three hulls is a coalition, not a purchase."* Building a
 * fourth would buy a spare, and a spare is a berth the cast cannot fly and a Levy's worth of
 * `ration` it cannot deliver.
 *
 * **The composition is `scripts/combat-sim.ts`'s `LINE`, which is the doctrine that actually beats
 * the world.** Measured (2 seeds × 600 ticks, phase A): three PIKEs — the `SWARM` doctrine, and the
 * fit the affordance menu offers a newcomer — went **0 won · 2 lost**, losing all three hulls both
 * times. Two missile WARDENs plus a tackle PIKE went **4 won · 0 lost** for one hull. The arithmetic
 * says why and it is `catalogue.ts`'s own: a PIKE is 400 EHP against a LANCE's 700, so a swarm
 * brings a third of the world's buffer for two thirds of its output.
 *
 * The PIKE is **last** on purpose. It carries the only `POINT` in the doctrine, so it is the hull
 * that decides who leaves the field (§12 relationship #3) — but a member that has built one ship and
 * then cannot afford another has a tackle frigate and nothing to tackle *for*. So the buffer is
 * bought first and the control last, which is also the order the ships are lost in.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const CAST_DOCTRINE: readonly { readonly hull: string; readonly modules: readonly string[] }[] =
  Object.freeze([
    Object.freeze({
      hull: 'WARDEN',
      modules: Object.freeze([
        'MISSILE',
        'MISSILE',
        'MISSILE',
        'SHIELD_EXTENDER',
        'SHIELD_EXTENDER',
        'AFTERBURNER',
        'DAMAGE_MOD',
        'DAMAGE_MOD',
      ]),
    }),
    Object.freeze({
      hull: 'WARDEN',
      modules: Object.freeze([
        'MISSILE',
        'MISSILE',
        'MISSILE',
        'SHIELD_EXTENDER',
        'SHIELD_EXTENDER',
        'AFTERBURNER',
        'DAMAGE_MOD',
        'DAMAGE_MOD',
      ]),
    }),
    Object.freeze({
      hull: 'PIKE',
      modules: Object.freeze(['SMALL_GUN', 'POINT', 'WEB', 'AFTERBURNER']),
    }),
  ]);

/**
 * How many times over a hull's price must be standing there before the cast will build one.
 * *(calibrate)*
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **"NEVER COMMIT A HULL A MEMBER CANNOT REPLACE", AS ARITHMETIC.** A hull is destroyed
 * **permanently** (A5, no salvage), and its frame good is `ration` — the good the Levy, the
 * sovereignty Charge and a WORKS build are all denominated in. So a member that spends its last
 * affordable hull on a battle has converted a tribute into a wreck, and the tribute is the meter
 * §14.2 puts on screen as the headline.
 *
 * Two, so the *next* one is always affordable out of what is standing at the berth after this one is
 * paid for. Not three: at three a Frontier member that has just come online never arms at all, and a
 * gate that never opens is indistinguishable from a missing branch — which is the defect this whole
 * change exists to close.
 *
 * Applied to **both** goods, and the fuel half is the one that binds: a WARDEN's 90 units of `fuel`
 * is nine ticks of a sole-occupant FRONTIER yield, where its 1,500 `ration` is ten.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const CAST_ARMS_RESERVE_MULTIPLE = 2;

/**
 * How many Reckonings of its **own** tribute a member keeps back before it will carry
 * somebody else's escrowable share. *(calibrate)*
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE GATE THAT STOPS A CHARITY FROM BECOMING A SECOND SHORTFALL**, and it is the only
 * calibrate number in {@link HeuristicCast.carryFor}.
 *
 * `Runtime.levyCarryQuotes` already nets the deliverer's **outstanding** duty — an exact
 * published figure, and A2's job. What no engine figure can net is the duty that has not been
 * minted yet: a member that pays its own tribute in full, then gives every remaining unit away,
 * is solvent tonight and short at the next Reckoning. Turning one member's shortfall into
 * another's is a worse outcome than the one this branch exists to fix, because `levyShort` is
 * the same meter either way and the goods are consumed in both directions.
 *
 * So the reserve is forward-looking, which makes it a **judgement rather than arithmetic** — and
 * that is exactly why it lives here as cast policy and not in `levy/params.ts` as a rule. An
 * agent with a reason to give away its last unit may; §5.2's whole redistributive half is that
 * who bears the burden is a choice somebody makes.
 *
 * Two Reckonings, and the per-Reckoning unit is `max(this Reckoning's assessment,
 * LEVY_DUTY_PER_PRINCIPAL)`. The `max` is load-bearing: under `BY_STORES` a goods-rich member's
 * assessment is a share of `Σ duty` and can far exceed its own duty, so the rule-fixed figure
 * alone would under-reserve exactly the member this branch is aimed at — and the assessment
 * alone would under-reserve a member the constellation happened to spare this once.
 *
 * Not one, because one leaves nothing for a bad vote next Reckoning. Not three, because at three
 * the `g01` carriers — 360,000 units against a 23,900 assessment — still clear it easily while a
 * mid-sized holder never does, and a gate that only the richest member in the world can pass is
 * indistinguishable from a missing branch, which is the defect this change exists to close.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const CAST_CARRY_RESERVE_RECKONINGS = 2;

/**
 * How much stronger than the other side the cast's committed hulls must be. *(calibrate)*
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THIS IS THE COMBAT BALANCE GATE, AND WHAT IT PROTECTS IS THE STANDOFF RATHER THAN THE HULL.**
 *
 * A hull adds **no force to the defender's side** — `readForce` counts hands, and a hand crewing a
 * hull is still IDLE at the stage, so committing one adds nothing to `defender_if_you_fight`. What
 * committing does is put that hand at risk: `applyLoss` routs the hand of every wrecked hull, and a
 * routed hand is gone from `handsAtStage` **at resolution**. So a member that answers FIGHT on a
 * force reading of 3-2 and then loses a hull reads 2-2 at the window's end — still a repulse — and
 * one that loses two reads 1-2 and is plundered for twice the demand.
 *
 * **What it buys is on the OTHER side of the sum**, and that is what this constant now guards. A
 * world raid's own force is its fleet, and `worldForceLeft` re-measures it at resolution too, so
 * every LANCE these hulls destroy takes 1 off `force.raid_force_left`. A commit is therefore a trade:
 * one hand of the defender's own margin, against however much of the raid's force the fit can remove
 * before the window closes. This gate is what stops that trade being taken at a loss — the reason it
 * exists did not change, but the thing it is trading *for* went from nothing to the standoff itself.
 *
 * That is the coupling `combat/index.ts` calls *"composition beats headcount, through hands"*, seen
 * from the defender's side, and it means the honest gate is not *"can I afford the hull"* but
 * **"will this fleet lose one at all"**. Strength is the forecast's own formula —
 * `ehp + alpha × SLICES_PER_TICK`, `view.ts:forecastFor` — so the bot budgets against the number the
 * observation publishes rather than a second one of its own (scar #5).
 *
 * 13,000 bps means *"favoured by 30%"*. At the published numbers one missile WARDEN (3,067 EHP,
 * 52 alpha → 3,483) clears three world LANCEs (884 each → 2,652) and does **not** clear five
 * (4,420), so the branch commits a second hull against a heavy raid and one against a light one —
 * which is the composition decision this layer exists to create, taken from published facts.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const CAST_ENGAGE_FAVOUR_BPS = 13_000;

/**
 * The EHP fraction at which a cast formation breaks off. *(calibrate)*
 *
 * A3's stop condition rather than an act: §9A's `withdraw_if` is *"the one field that survives being
 * offline"*, and a formation that withdraws in time keeps its hull **and** its hand — `runBattles`
 * calls `fleet.release` on a withdrawal and routs nothing. Set rather than left at zero because
 * `if_you_do_nothing` is right to scold a fit with no threshold: *"will fight to the last hull."*
 *
 * It is deliberately **not** a substitute for the gate above, and the reason is published in
 * `ENGAGEMENT_RULE_STATEMENT`: *"a hull under tackle of 1 or more cannot leave"*, and the world's
 * fleet flies a POINT and a WEB by `assertWorldFleet`'s requirement. A threshold saves a formation
 * the world has not caught; nothing saves one it has.
 */
export const CAST_WITHDRAW_BELOW_BPS = 3_000;

/**
 * How much of its **free** stores a cast payer will commit to elective parts across
 * everything settling in one Reckoning. *(calibrate)*
 *
 * This one number is what makes §7.6 answerable at all: at `BPS_ONE` every promise is
 * honoured and the falsification test has a rigged answer, and at `0` nothing is ever
 * paid and standing has nothing to accrue to. In between, a payer with a few ventures
 * honours them and a payer that has over-committed relative to its purse declines the
 * marginal one — which is the ordinary road to a broken promise A6 describes, and it is
 * a *reason* rather than a dice roll.
 *
 * Not a claim of correctness (§7 of CLAUDE.md's conventions): it is a starting point for
 * simulation, and `test/cast/heuristic.test.ts` asserts the *shape* of the policy — that
 * it honours what it can afford and declines what it cannot — rather than this figure.
 */
export const CAST_ELECTIVE_APPETITE_BPS = 700;

/**
 * ★ What share of a **role's own published value** a cast member bids as its stake. *(calibrate)*
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THIS IS THE NUMBER THAT MAKES EXPOSURE EXIST AT ALL, AND THEREFORE THE NUMBER THAT MAKES THREE
 * OF THE LEVY'S FOUR ALLOCATION RULES DISCRIMINATE.**
 *
 * §3 defines EXPOSURE as *"Σ of your open `max_direct_loss`, and nothing else"*, and `D30` measured
 * it at **identically zero for every principal at every phase of every Reckoning** in a world with
 * 101 live ventures. `weightOf` therefore returned one flat weight to everybody under `BY_EXPOSURE`,
 * `EVEN` **and the published default `INVERSE_EXPOSURE`** on 18 of 18 dockets — §5.2's *"the vote is
 * the drama"* with one working lever — and A7's *staked* half had no instance in any world this repo
 * had ever run. The cast passing `stake: 0` was half the cause; `lockFillStake` having no caller was
 * the other half (see `RULES_VERSION` 16).
 *
 * ── THE DENOMINATOR IS THE ROLE, AND THAT WAS MEASURED THE HARD WAY ─────────
 *
 * The first version was a share of **free STORES**, on the brief's own reasoning — *stake more when
 * you can bear the loss.* It cost the world a quarter of its ventures, and the full argument for why
 * is at {@link HeuristicCast.stakeFor}: §7.3 resolves a contested slot *pro-rata by stake*, so a
 * wealth-priced bid turns every contest into a standing wealth ranking, and this file's own decision
 * order then converts that into fewer ventures. Priced off the role, two bidders compute the same
 * number and the tie falls through to `principal_id` exactly as it did at `stake: 0`.
 *
 * ── WHY 300 bps, AND THE TRADE IS SHARP ─────────────────────────────────────
 *
 * 3% of a role's `escrowed + elective`, which at this cast's role values is **~90–292 MINOR** — the
 * same order as {@link RAID_JOIN_STAKE_MINOR} (500), the project's other slashable stake, and the
 * scale that matters for the Levy is `LEVY_EXPOSURE_UNIT` (1,000): a 292 stake moves a
 * `BY_EXPOSURE` weight by 29% and an `INVERSE_EXPOSURE` weight by 23%. Discriminating, not
 * dominating.
 *
 * The trade against a bigger number is measured and it is not subtle. **8 seeds × 9 Reckonings:**
 *
 * | `CAST_STAKE_BPS` | `levyShort` 9R | red 9R | ventures 9R |
 * |---|---|---|---|
 * | master (no stake) | 8,051 | 1/576 | 5,295 |
 * | **300** | **0** | **0/576** | **5,277** |
 * | 1,000 | 11,884 | 2/576 | 4,943 |
 *
 * At 1,000 bps the peak stake is ~975, which is `LEVY_EXPOSURE_UNIT` itself, so the weights move by
 * up to 2x — and on `g07`, the one seed whose constellation genuinely produces less than it owes,
 * that is enough redistribution to open a shortfall the seed cannot absorb. §5.2 lets a constellation
 * vote itself into trouble and that is the mechanic working; it is also a regression against a meter
 * §14.2 headlines, so the smaller number wins. Not a claim of correctness (CLAUDE.md §7): it is where
 * the gate was run, and the gate is `D31`.
 *
 * ⚑ **AND IT IS NOT THE BINDING CONSTRAINT ON WHETHER THE RULES BIND.** Measured at this figure, only
 * **12 of 129 dockets** across the eight gate seeds see any EXPOSURE spread at all, and three seeds
 * see none. The cause is not the size of the stake: `settleVenture` releases every stake at the
 * settlement tick and `LEVY_ASSESS_PHASE` mints the docket on the **next** tick, so the assessment
 * reads EXPOSURE at a **22x trough** — on `g01`, 4 open stake locks summed over six phase-0 ticks
 * against 89 at phase 144. Raising this constant cannot fix that and the table above is what trying
 * costs. `D31` records it as the open question, because the fix is a reading, not a price.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const CAST_STAKE_BPS = 300;

/**
 * The cast, as a deterministic policy over the world.
 *
 * Stateless with respect to its own decisions: everything it needs is in the world
 * and the venture book, so it cannot drift out of sync with them and it needs no
 * state table of its own. The only state it holds is the roster.
 */
export class HeuristicCast {
  private readonly members: CastMember[] = [];

  constructor(
    private readonly runtime: Runtime,
    private readonly options: CastOptions,
  ) {}

  get roster(): readonly CastMember[] {
    return this.members;
  }

  /**
   * Where this member's BODY stands right now — **not where it was seated.**
   *
   * `graduate` is the only verb that moves a holding, and until it had a caller these two were
   * the same system for the cast's whole life, so `member.seat` was a safe stand-in for both.
   * It is not one any more: `seat` is a `readonly` field recorded once, so a member that has
   * crossed keeps it forever and every rule derived from it — which tier its hands may walk,
   * which system it would work, which ground it could claim — would go on answering for a
   * place the member left.
   */
  private bodyOf(member: CastMember): SystemId {
    const world = this.runtime.world;
    if (world.holdingByPrincipal.get(member.principal) === undefined) return member.seat;
    return holdingOf(world, member.principal).system;
  }

  /**
   * May one of this member's hands legally enter `system`? **The engine's rule, read live.**
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THE CAST WAS ASKING A DIFFERENT QUESTION AND GETTING A REAL ANSWER WRONG.**
   *
   * `world/movement.ts:commonsBoundRejection` pins a principal's hands inside the Commons
   * *only while its holding stands there*, and it never refuses a hand coming back **in** — the
   * safe zone's outbound bind and its inbound floor are deliberately different rules, and that
   * file says so.
   *
   * `levyMove` instead refused any hop whose tier differed from `tierOf(map, member.seat)`. The
   * launch map's constellation 1 is **mixed**: `sys-01`..`04` are COMMONS and `sys-05`..`07`
   * are MARCHES, and `levy/place.ts` puts the delivery place at *"the lowest-id COMMONS system
   * in the constellation"* — `sys-01`. So a MARCHES-seated member in constellation 1 could
   * never walk to the one place its Levy is payable at. Not because the engine refused it: the
   * move is legal. The cast's own guard refused the only legal route, so the member was
   * assessed in full every Reckoning and delivered nothing, forever.
   *
   * Measured on seed `gate-b`, 900 ticks, 8 members: `brannock`, a raider seated at `sys-05`,
   * all three hands parked at `sys-07`, delivery place `sys-01`, `deliver` count zero, and its
   * tribute line the only one in the world not quiet. Roughly one member in six is seated
   * there, so this has been quietly inflating `levyShort` in every sweep the project has run.
   * ══════════════════════════════════════════════════════════════════════════
   */
  private mayEnter(member: CastMember, system: SystemId): boolean {
    const world = this.runtime.world;
    if (world.holdingByPrincipal.get(member.principal) === undefined) return false;
    if (!principalIsCommonsBound(world, member.principal)) return true;
    return tierOf(world.map, system) === 'COMMONS';
  }

  /**
   * The elective total this member has already **stated** it will pay, across everything open.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **A7's OTHER SIDE, AND THE SECOND HALF OF THE BALANCE GATE.** {@link CAST_ELECTIVE_APPETITE_BPS}
   * lets a payer commit 700 bps of its **free** stores to unsecured promises. Every irreversible
   * purchase therefore *shrinks the promises it can keep*, and `electionFor` restates the excess
   * **down** — a permanent public default, correctly recorded, for a reason the payer chose.
   *
   * Measured: with the crossing ungated, `broken` went from 22 to 78 against 158 kept — 33% of
   * settled elective promises broken by a cast whose LLM counterpart breaks 12% (GATE 3's
   * `AGT-E1`). Those were not interesting betrayals. They were one bot paying a gate fee out of
   * money it had already promised somebody else, eight times over.
   *
   * So the territorial branches ask this first: *after this purchase, does my appetite still cover
   * what I have already said?* It is the arithmetic form of the sentence `agent.md` uses about
   * resisting a temptation you could afford — a member that has promised nothing may cross freely,
   * and one carrying commitments waits until they settle.
   *
   * Deliberately **not** applied to `worksFor` or `syndicateFor`: both predate this and both are
   * measured into the corpus at their current rates, so retro-fitting the gate there would move
   * numbers no finding asked to move. Stated rather than hidden — it is the one asymmetry in this
   * file's economics, and the case for extending it is a calibration pass of its own.
   * ══════════════════════════════════════════════════════════════════════════
   */
  private statedElectiveOf(member: CastMember): number {
    const runtime = this.runtime;
    let total = 0;
    for (const venture of runtime.ventures.forPrincipal(member.principal)) {
      if (venture.creator !== member.principal) continue;
      if (!ELECTABLE_VENTURE_STATES.includes(venture.state)) continue;
      for (const role of venture.roles) {
        if (role.filledByPrincipal === null) continue;
        // Its own role is booked as paid in full and can never be a breach (scar #9).
        if (role.filledByPrincipal === member.principal) continue;
        const stated = runtime.electionOn(venture.id, role.index);
        if (stated === undefined) continue;
        const owed = runtime.electiveCeilingOf(venture, role.index);
        total += stated === IN_FULL ? owed : Math.min(stated, owed);
      }
    }
    return total;
  }

  /** Would this much currency leaving still leave the appetite covering what was promised? */
  private canSpendWithoutBreakingAPromise(member: CastMember, spend: number): boolean {
    const free = freeStores(this.runtime.ledger, member.principal);
    const after = Math.max(0, free - spend);
    return (
      Math.trunc((after * CAST_ELECTIVE_APPETITE_BPS) / BPS_ONE) >= this.statedElectiveOf(member)
    );
  }

  /**
   * Could this member honour **one more** unsecured promise of this shape, on top of its open ones?
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **A7 APPLIED TO THE PAYER'S OWN SIDE, AND IT IS WHAT STOPS THE CAST MANUFACTURING DEFAULTS.**
   *
   * `electionFor` does not decline quietly. When its budget will not stretch it states the part it
   * can cover — `minor(room)` — and a stated part below what is due is a `DECLINED` default at
   * settlement, permanently, on the payer's record. So a payer that keeps opening ventures past its
   * purse is not "over-committed", it is **generating public breaches on a schedule**, and every one
   * of them is a breach *we* authored rather than an agent's decision.
   *
   * Attributed rather than assumed. With the territorial road open, every extra default in a
   * 900-tick run was `DECLINED` and every one belonged to a member that had spent 50,000 on a
   * crossing: `thessaly` 12, `vex` 10, `orrin` 5, and the two raiders that only ever posted a bond
   * — capital LOCKED rather than spent — produced **none**. The mechanism is exact:
   * {@link CAST_ELECTIVE_APPETITE_BPS} is a share of free stores, currency in this economy comes
   * only from venture proceeds, and territory consumes currency while paying in goods. So a
   * claimant is permanently poorer in the thing that keeps promises.
   *
   * The gate is the honest response and it belongs on `create` rather than on the crossing: the
   * crossing is a one-off, and the promise it eventually breaks is the *next* one opened afterwards.
   * A payer whose appetite already covers everything it has said may open another; one whose does
   * not, waits for a settlement. Priced off `defaultTerms(kind, baseYield)` — the runtime's single
   * pricing home, the same call the `create` affordance quotes `max_contingent_liability` from — so
   * the bot cannot budget against a number the menu does not publish.
   * ══════════════════════════════════════════════════════════════════════════
   */
  private canPromiseOneMore(member: CastMember, kind: VentureKind): boolean {
    let elective = 0;
    for (const t of defaultTerms(kind, kindSpec(kind).baseYieldMinor)) elective += t.elective;
    const free = freeStores(this.runtime.ledger, member.principal);
    const appetite = Math.trunc((free * CAST_ELECTIVE_APPETITE_BPS) / BPS_ONE);
    // ── ROOM FOR *PART* OF IT, NOT ALL OF IT, AND THE HALF-MEASURE IS THE POINT ──
    //
    // `appetite >= stated + elective` was measured and over-corrected: `broken` fell to 30 and the
    // venture count fell to 689 against HEAD's 886. The cast is *supposed* to promise more than it
    // will certainly keep — that is what gives §7.6 a real answer rather than a rigged one, and
    // `CAST_ELECTIVE_APPETITE_BPS`'s own note says so: *"at `BPS_ONE` every promise is honoured and
    // the falsification test has a rigged answer."* A gate that made the cast solvent by
    // construction would delete the mechanic it is here to feed.
    //
    return appetite >= this.statedElectiveOf(member) + elective;
  }

  /**
   * How many hands this member must keep free for goods it owes the WORLD and cannot reach.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **MEASURED, AND IT WAS THE WORST THING IN THIS FILE: A MEMBER SAT ON 109,052 UNITS OF
   * `ration`, OWED 19,304, AND WAS RECORDED SHORT.**
   *
   * Traced tick by tick on seed `gate-a`, Reckoning 2, member `thessaly`: all three hands
   * `COMMITTED` from tick 600 to tick 863 — filled into roles at `sys-07` and `sys-21` — while its
   * delivery place was `sys-01` and its stores climbed from 87,000 to 109,000. `levyMove` could
   * neither deliver (no hand *at* the place) nor walk (no hand IDLE), so it returned `null` on all
   * 264 ticks and the settlement swept what it could reach. Its tribute line rendered REVERSING:
   * a seizure against a member that could have paid twenty times over.
   *
   * This is `D19`'s finding — *"the members who work most therefore act least; halcyon held three
   * hands committed for 96% of all hand-ticks"* — with the Levy on the end of it, and it is
   * **older than the crossing**: `graduate` only made it visible, because a Commons member's hands
   * wander among four systems one of which IS the delivery place, so a committed hand was often
   * standing on it by luck. Take the body out to the Marches and the luck runs out.
   *
   * The policy: **never commit your last free hand while a world obligation is out of reach.**
   * Narrow on purpose — only while something is genuinely owed, only while there is stock to pay it
   * with, and only until a hand is standing there or walking there.
   *
   * **It returns a COUNT, and the second one is the Charge's.** A tribute is payable at its
   * constellation's named place and a Charge only at the claimed system, and for a member that has
   * crossed those are two different systems — `graduate` moves a holding and leaves the hands where
   * they were. One reserved hand cannot serve both: the aimless walk treats a hand on the delivery
   * berth as stationed, so it stays there and the claim never gets a carrier. A principal with
   * obligations in two places has to keep hands in two places, which is the logistics the mechanic
   * is made of rather than an inconvenience in it. Capped at two by construction, so a member with
   * three hands is never fully reserved.
   * ══════════════════════════════════════════════════════════════════════════
   */
  private carriageNeeded(member: CastMember, tick: number): number {
    const runtime = this.runtime;
    if (inFreeze(tick) || isSettlementTick(tick)) return 0;
    let need = 0;
    const block = runtime.levyBlockFor(member.principal, tick);
    if (
      block !== null &&
      block.shortfall_if_unpaid > 0 &&
      // Nothing to carry is not the same problem, and reserving a hand would not fix it.
      runtime.levyGoodAvailable(member.principal) > 0 &&
      !this.carriageUnderwayTo(member, block.deliverable_to, tick)
    ) {
      need += 1;
    }
    for (const claim of runtime.claimsFor(member.principal, tick)) {
      if (claim.owed <= 0) continue;
      // A Charge is payable ONLY in goods already standing at the claimed system, so a hand there
      // with nothing to hand over is not what is missing and a reservation would not supply it.
      if (claim.available_here <= 0) continue;
      if (this.carriageUnderwayTo(member, claim.system, tick)) continue;
      need += 1;
      break;
    }
    return need;
  }

  /**
   * How many hands are **mustered** at each stage: promised to a FIGHT this member has already given.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **MEASURED: A REPULSE AT THE ANSWER TICK THAT WAS A PLUNDER AT RESOLUTION.** Seed `gate-c`
   * answered FIGHT twice and one came back `FIGHT/PLUNDERED`. `handsDefending` counts only **IDLE**
   * hands present at the stage — `predationPort` says so and gives the reason (routing a COMMITTED
   * hand would be an agent-reachable world halt) — and `readForce` re-reads it at the window's end. So
   * filling a role with a hand standing at the stage silently spends the answer this member had
   * already given, and the standoff flips from taking nothing to taking twice the demand.
   *
   * The reservation is {@link carriageNeeded}'s shape and its argument: do not spend the hand a
   * commitment you have already made depends on. **Narrow in the same way, too** — it reserves the
   * number of hands the *reading* needs and not every hand standing there, so a member with three
   * hands at a stage that only takes two to hold still has a third that is genuinely idle. A
   * reservation wider than the requirement would cost the world filled roles for nothing, which is
   * the tug-of-war that cost it a fifth of its ventures once already.
   * ══════════════════════════════════════════════════════════════════════════
   */
  private musteredAt(member: CastMember, tick: number): ReadonlyMap<SystemId, number> {
    const out = new Map<SystemId, number>();
    for (const view of this.runtime.raidsFor(member.principal, tick, MAX_CAST)) {
      if (view.your_side !== 'TARGET' || view.state !== 'DEMANDED' || view.answer !== 'FIGHT') continue;
      // Hands at the stage = the reading minus the terms that are not hands. The view publishes both
      // sides, so this is arithmetic over published figures rather than a second count of the world.
      const mine = view.force.defender_if_you_fight - view.force.terrain;
      const needed = Math.max(0, view.force.raider - view.force.terrain);
      out.set(view.stage, Math.max(out.get(view.stage) ?? 0, Math.min(mine, needed)));
    }
    return out;
  }

  /** Is a hand of this member standing at, or walking to, `place`? */
  private carriageUnderwayTo(member: CastMember, place: SystemId, tick: number): boolean {
    const world = this.runtime.world;
    if (carrierAt(world, member.principal, place, tick) !== null) return true;
    return handsOf(world, member.principal).some((h) => h.destination === place);
  }

  /**
   * Seat the cast.
   *
   * Raiders are seated in the MARCHES on purpose. In the Commons a hostile act is
   * **invalid, not punished** (A8), so a raider seated there would have every
   * `RAID` it ever created refused by the floor — a bot that looks like it is
   * playing and cannot, which is the least debuggable kind of quiet.
   */
  seat(seed: string): readonly CastMember[] {
    const rng = Rng.fromSeed(`${seed}:cast:seating`);
    const size = Math.max(0, Math.min(this.options.size, MAX_CAST));
    for (let i = 0; i < size; i += 1) {
      const handle = CAST_NAMES[i];
      if (handle === undefined) break;
      const role = CAST_ROLES[i % CAST_ROLES.length];
      if (role === undefined) break;
      const tier = role === 'raider' ? 'MARCHES' : 'COMMONS';
      const seat = this.runtime.seatInTier(tier, rng.derive(`seat:${handle}`));
      if (seat === undefined) continue;
      const principal = `p:${handle}` as PrincipalId;
      this.runtime.seat(principal, handle, seat);
      this.members.push({ principal, handle, role, seat });
    }
    this.members.sort((a, b) => compareIds(a.principal, b.principal));
    return this.members;
  }

  /**
   * Decide this tick, for every member, in canonical order.
   *
   * Returns submissions rather than submitting them, so the caller owns ordering
   * and the cast cannot smuggle in an arrival-order advantage. The engine orders by
   * `(priority, principal_id, client_sequence)` anyway, and handing back a list is
   * what lets a test shuffle it and prove that.
   */
  decide(tick: number, seed: string): readonly SubmittedAction[] {
    const out: SubmittedAction[] = [];
    // ── WHOSE TRIBUTE A CAST-MATE IS ALREADY CARRYING THIS TICK ───────────────
    //
    // §15.2: *"within-tick actions never react to another within-tick action."* So four members
    // reading the same snapshot all see the same payer with the same escrowable remainder, all
    // offer to carry it, and **the first one to resolve fills the bucket while the other three are
    // refused** — measured on `cast-clean` at tick 13: `dunmore`, `ferren`, `orrin` and `vex` each
    // offering 350 against `p:ashlin`, three `A14`s. `heuristic.test.ts`'s AGT-S3 assertion caught
    // it, and its rule is the right one: *a bot hitting the same refusal repeatedly means an
    // affordance or a hint is wrong, not that the bot is wrong.*
    //
    // **The engine surface is NOT what is wrong here.** The refusal names the exact remainder and
    // why it cannot be bought, which is what an agent needs; two independent agents racing a
    // neighbour's bill is real contention and being told you lost it is the honest answer. What is
    // wrong is one cast generating a predictable refusal against **itself**, which it can see
    // coming — the same reasoning `musteredAt` and `carriageNeeded` use to stop this cast fighting
    // itself over one hand.
    //
    // Deterministic: `this.members` is a fixed order, so which member wins the payer is a property
    // of the roster and not of arrival (A4, DET-1).
    const claimed = new Set<PrincipalId>();
    for (const member of this.members) {
      const rng = Rng.fromSeed(`${seed}:cast:${member.principal}:${String(tick)}`);
      const action = this.decideOne(member, tick, rng, out.length, claimed);
      if (action !== null) {
        const payer = action.params['payer'];
        if (action.verb === 'deliver' && typeof payer === 'string') claimed.add(payer as PrincipalId);
        out.push(action);
      }
    }
    return out;
  }

  /**
   * One member's move, in priority order.
   *
   *   1. **Sign what is waiting on you.** Nothing binds until every party
   *      countersigns, so an unsigned venture is a venture that cannot go live.
   *   2. **State what you will pay**, or restate it. See {@link electionFor}.
   *   3. **Seal a role you hold.** Free, mandatory, and the reveal is the show.
   *   4. **Fill somebody's open role.** This is the clause §15.6 actually asks for:
   *      heuristics fill unfilled slots so ventures always resolve.
   *   5. **Create something**, occasionally, so the board is never empty.
   *   6. **Move an idle hand**, so the map has motion in it (A13).
   *
   * **The seal comes before `fill_role` and `create` on purpose.** PROP-D4's
   * compliance validator refuses both while a sealable role is unsealed, so a bot that
   * tried to fill first would be refused every tick and never reach its own seal branch
   * — one refusal per tick forever, which reads in the logs exactly like a rules-surface
   * defect (AGT-S3) and would bury the real ones.
   */
  private decideOne(
    member: CastMember,
    tick: number,
    rng: Rng,
    ordinal: number,
    /** Payers a cast-mate is already carrying for this tick — see {@link HeuristicCast.decide}. */
    carriedThisTick: ReadonlySet<PrincipalId>,
  ): SubmittedAction | null {
    const runtime = this.runtime;
    const base = {
      principal: member.principal,
      clientSequence: ordinal,
      // Nothing in the engine reads this. It exists so the A4 audit can compare
      // arrival order against resolution order and show no correlation.
      arrivalMs: tick,
      decisionSource: 'HEURISTIC' as const,
    };

    // ── ANSWER THE RAID FIRST, BECAUSE THE WORLD SET THIS DEADLINE AND IT IS TWO TICKS ──
    //
    // ══════════════════════════════════════════════════════════════════════════
    // **THE ONLY BRANCH IN THIS FILE WITH A DEADLINE MEASURED IN SINGLE TICKS.** `battlesNow`
    // opens a battle only over a standoff where `tick + ENGAGEMENT_TICKS <= raid.resolvesAtTick` —
    // 22 against a 24-tick window — so a FIGHT answered later than **two ticks after the spawn** is
    // a standoff decided on hands with no battle in it at all. Its own comment calls that a real
    // strategic consequence rather than a repair: *"answering FIGHT promptly is what buys you a
    // fleet fight."* A branch placed below `sign` and `elect` would inherit that as a coin flip
    // over whether a venture happened to be waiting, which is not a decision anybody made.
    //
    // It is also **free** — `fight` commits no hand, locks no capital and destroys no goods; it
    // only makes the target's own IDLE hands at the stage count at all. So placing it first costs
    // at most one action per raid, three times a Reckoning, and only for the member the world
    // named.
    //
    // Measured before it existed: **every raid in every seed was `null/PLUNDERED`** — 9 of 9 on
    // each of the four gate seeds. The cast had no branch that could answer, so it paid
    // `RAID_TAKE_MULTIPLE` (twice the demand) nine times a run in the good its tribute is
    // denominated in, and the meter that reads it is the one §14.2 puts on screen.
    // ══════════════════════════════════════════════════════════════════════════
    const answer = this.raidAnswerFor(member, tick);
    if (answer !== null) return { ...base, ...answer };

    // ── COMMIT A HULL WHILE THE MUSTER WINDOW IS OPEN ─────────────────────────
    //
    // Second, and for the same reason one place further down the same clock: MUSTER is six ticks and
    // it is *"the only window in which a hull may be committed"*. A member that spends those six
    // ticks signing ventures owns a fleet it cannot bring, which is the most expensive form of the
    // defect this file's combat branches exist to close — an asset that exists and is never used.
    const committing = this.engageFor(member, tick);
    if (committing !== null) return { ...base, ...committing };

    for (const venture of runtime.ventures.forPrincipal(member.principal)) {
      if (venture.state !== 'FORMING') continue;
      if (venture.termsHash === null) continue;
      if (venture.countersigned.has(member.principal)) continue;
      // No election here. `sign` binds the terms and nothing else — and `vSign` refuses
      // a request that carries one rather than dropping it, so this params list and that
      // handler cannot drift into a payer that believes it elected and did not.
      return {
        ...base,
        verb: 'sign',
        params: { venture: venture.id, terms_hash: venture.termsHash },
      };
    }

    const election = this.electionFor(member, tick);
    if (election !== null) return { ...base, ...election };

    // ── REFINE FIRST: RAW ORE PAYS NOTHING ────────────────────────────────────
    //
    // A WORKS yields `ore` and every obligation in the game is payable in `ration` — the Levy, a
    // Charge, a WORKS build. So a member sitting on ore is a member with income it cannot spend, and
    // this branch is placed above the rest because refining is the cheapest act that changes what a
    // principal can actually do. Ahead of `build` too: no point raising a second source of a good you
    // are not converting.
    // ── ★ ALLOY BEFORE RATIONS, AND THE ORDER IS THE WHOLE FORK ───────────────
    //
    // The two recipes compete for the same ore and `refineFor` deliberately takes **every whole batch
    // it can** ("a member with nothing else to do with the ore"), so a manufacturing branch placed
    // *below* it would find the ore already gone on every tick it ever ran — offered, legal, and
    // structurally incapable of firing. That is precisely how `authorityLines`, `worksLines`,
    // `syndicateLines` and `claimLines` all read zero for eight Reckonings.
    //
    // Safe above it because `alloyRefineFor` is the strictly narrower branch: COMMONS only, and only
    // out of ore this member does not need for tribute (`CAST_ALLOY_RESERVE_RECKONINGS`). A member
    // short of `ration` declines here and refines rations on the next line, in the same tick.
    const manufacture = this.alloyRefineFor(member, tick);
    if (manufacture !== null) return { ...base, ...manufacture };

    // ── AND PUT IT ON THE BOOK, OR THE PRODUCTION IS A PILE ───────────────────
    //
    // Directly under the branch that makes the good, because the two are one behaviour: 3,065 lines of
    // `market/` had never held an order in any world this repo ran, and a fourth good with no seller is
    // the twelfth instance of a capability that exists and is never exercised. Costs one action and
    // only when there is a whole ask to post and none already resting.
    const offer = this.alloyAskFor(member, tick);
    if (offer !== null) return { ...base, ...offer };

    // ── THE DEMAND SIDE: WALK, BUY, CARRY ─────────────────────────────────────
    //
    // Above `claimFor`, because it is the errand that makes the claim payable — a member that reaches
    // the claim branch without alloy standing under its body is refused by a gate no MARCHES seat can
    // ever satisfy locally. Above `graduateFor` for the same reason on the second rung out.
    const errand = this.alloyErrandFor(member, tick);
    if (errand !== null) return { ...base, ...errand };

    const refine = this.refineFor(member, tick);
    if (refine !== null) return { ...base, ...refine };

    // ── FOUND A HOUSE, so `syndicateLines` is not permanently empty ────────────
    //
    // The third panel that rendered nothing because the cast never did the thing. `form` was made
    // reachable earlier (it had no affordance at all, the fourth built-but-unreachable primitive found
    // this session) and a menu entry nobody selects leaves the mechanic exactly as invisible.
    //
    // One per member and a low roll, for the same reason as the WORKS: the charter is PERMANENT — no
    // verb in the game amends one — so a cast that founded a house the instant it could afford to
    // would put every member in an identical constitution on the same tick, which is the opposite of
    // the politics syndicates exist to produce.
    const house = this.syndicateFor(member, tick, rng);
    if (house !== null) return { ...base, ...house };

    // ── THE ONE DOOR GOODS ENTER THROUGH, AND NOBODY WAS OPENING IT ───────────
    //
    // D17 measured this precisely: the `build {WORKS}` affordance was offered in **70 of 70**
    // principal-observations, and neither cast had EVER built one — the heuristic spent 900 ticks on
    // `move 1003 · sign 502 · fill_role 353 · elect 264 · create 232` and issued `build` zero times,
    // while production ran eight Reckonings at `works: 0` with `levyShort` climbing past 345,000. A
    // WORKS is the only thing in the game that makes goods, so the economy was living off enrolment
    // endowments and running down.
    //
    // Placed HIGH on purpose. D17's hypothesis for the zero was that a capital investment loses an
    // action-budget contest to immediate income — a `create` pays at the next settlement, a WORKS pays
    // nothing for 24 ticks — so a branch sitting behind `create` and `fill_role` would have inherited
    // the same zero and proved nothing.
    //
    // Self-limiting without a roll: one WORKS per member. A member that already extracts has made the
    // investment, and `affordable` is the SAME predicate the affordance and the verb use, so the bot
    // cannot ask for something the menu would not have offered it.
    // ── LEAVE THE COMMONS, AND LEAVE BEFORE YOU SINK CAPITAL INTO IT ──────────
    //
    // `claimLines: 0` had two causes and this is the first one: **no cast member had ever left
    // the safe zone**, so a claim was not a bad decision, it was an unreachable one — a claim is
    // anchored by a body and every body in the world was standing where A8 makes a claim INVALID
    // rather than refused. Verified against live production at tick 5,274: five WORKS, all in the
    // Commons, `rentBps: 0` on every one of them.
    //
    // **ABOVE `worksFor`, and the ordering is the whole design of the branch.** A WORKS does not
    // move; its yield is posted at the system it stands on (`works/produce.ts`: *"extracted where
    // it stands, never at the holder's seat"*); `refine` only converts what is standing where the
    // body is; and `carryStoresTo` relocates the upkeep good only, so raw ore never follows a
    // crossing. A member that builds first and crosses afterwards therefore abandons its own
    // income into a pile it cannot reach — the branch would look like it was working and would be
    // making its member poorer. So the gate is "no WORKS yet", and the position above `worksFor`
    // is what makes that gate reachable at all.
    //
    // It is deliberately NOT above `refineFor`: a member with no WORKS has nothing to refine, so
    // the two branches cannot contend, and putting an irreversible act above a housekeeping one
    // would only obscure that.
    const crossing = this.graduateFor(member, tick, rng);
    if (crossing !== null) return { ...base, ...crossing };

    const build = this.worksFor(member, tick, rng);
    if (build !== null) return { ...base, ...build };

    // ── TAKE THE GROUND YOU ALREADY WORK ──────────────────────────────────────
    //
    // The third rung of one ladder — cross, work, own — and it is placed here for the reason D17
    // gave for putting `build {WORKS}` high: a capital commitment that pays nothing for a
    // Reckoning loses every action-budget contest to immediate income, so a branch sitting behind
    // `fill_role` would inherit `claimLines: 0` and prove nothing about why. All three rungs are
    // once-per-member with their own low rolls, so together they spend eight actions in 7,200 and
    // cannot crowd anything out — measured: `build` fires 8 times in a 900-tick run of 8 members.
    //
    // It needs **no hand**, which is why it sits above every branch fronted by an idle hand: a
    // claim is anchored by the body and paid for out of goods already standing under it. The
    // member that works hardest has the fewest free hands and is exactly the member with the
    // strongest case for owning its ground (D19, and the same argument the `grant` branch makes).
    const ground = this.claimFor(member, tick, rng);
    if (ground !== null) return { ...base, ...ground };

    // ── ARM THE GROUND YOU OWN — the fourth rung of the same ladder ────────────
    //
    // Cross, work, own, **arm**. Placed here for the reason D17 gave for `build {WORKS}` and
    // `claimFor` repeat: a capital commitment that pays nothing this Reckoning loses every
    // action-budget contest to immediate income, so a branch sitting behind `fill_role` would
    // inherit a fleet count of zero and prove nothing about why.
    //
    // It needs **no hand and no roll**. No hand because a berth is anchored by the body, exactly as
    // a claim is; no roll because unlike the WORKS and the charter there is nothing to spread out —
    // {@link CAST_ARMS_RESERVE_MULTIPLE} is a hard arithmetic gate and `fuel` exists at one tier in
    // the whole map, so the population of members that can reach this branch at all is already
    // small enough that a roll would only make combat rarer than the geography already does.
    const arming = this.hullFor(member, tick);
    if (arming !== null) return { ...base, ...arming };

    // ── A6, END TO END: ACT ON AUTHORITY SOMEBODY HANDED YOU ──────────────────
    //
    // Placed AFTER the member's own elections, and that ordering is the whole ethic of the branch: you
    // settle your own promises before you spend anyone else's money. A bot that reached for a mandate
    // while its own electives went unpaid would produce defaults on its own record and call it
    // stewardship.
    //
    // Until this existed the loop had a hole nobody could see from the code: `create` and `elect` both
    // ACCEPT a mandate, and no cast ever passed one, so every grant in every world this project has
    // run was `UNUSED`/`spent: 0` and INV-22 audited an always-empty journal. The capability was there
    // and unexercised — which reads, in every report and on the published frame, exactly like a
    // capability that is missing.
    const delegated = this.delegatedElectionFor(member, tick);
    if (delegated !== null) return { ...base, ...delegated };

    // One home for "which roles can still be sealed and kept": the affordance, PROP-D4's
    // compliance gate and this bot all read `sealableRoles`, so a bot cannot be refused
    // for failing to seal something it was never offered, and cannot be told to seal
    // something the resolver would mark CONTRADICTED from an absence.
    for (const ref of runtime.liveVerbs.has('seal')
      ? runtime.sealableRoles(member.principal, tick)
      : []) {
      if (runtime.seals.freeSlotsRemaining(member.principal, reckoningOf(tick), [ref]) === 0) continue;
      const venture = runtime.ventures.get(ref.venture);
      if (venture === undefined) continue;
      const band = runtime.deliveryBandOf(venture);
      return {
        ...base,
        verb: 'seal',
        params: {
          // ── THE DELIVERY VERB, NOT `sign` ────────────────────────────────────
          //
          // This branch named `verb: 'sign'` and this world records **no `sign` deed**.
          // With the completeness witness working, such a seal resolves `CONTRADICTED`
          // from an absence — a permanent public mark against a bot that did exactly
          // what it said it would. The only deed the engine writes is the delivery.
          verb: DELIVERY_VERB,
          // `target` names the venture and `role` names the slot, so the free slot
          // the engine charges is the one this bot's own arithmetic checked.
          target: ref.venture,
          role: ref.roleIndex,
          measure: DELIVERY_MEASURE,
          // The band the rules permit, which is what the deed will be measured
          // against — not `escrowed + elective`, which is what the *role* is owed and
          // is a different quantity entirely.
          outcome_low: band.low,
          outcome_high: band.high,
        },
      };
    }

    // ── The Levy ballot: free, once per cycle, and self-interested ────────────
    //
    // Placed before the venture branches because it is free and happens at most once per
    // Reckoning, so it costs the bot one tick of attention a day and no actions at all.
    const ballot = this.ballotFor(member, tick);
    if (ballot !== null) return { ...base, ...ballot };

    // ── A6: HAND SOMEONE AN OFFICE ────────────────────────────────────────────
    //
    // The heuristic cast emitted eight verbs and `grant` was not one of them, so the core loop the
    // whole design is built around could not be exercised by ~83% of the world's decisions (measured
    // in production: 296 HEURISTIC against 61 LIVE). The published frame said so plainly —
    // `authorityLines: 0` — and it was read as "the cast chooses not to delegate" when the truth was
    // that the branch did not exist.
    //
    // **Placed BEFORE the idle-hand gate, and that is the point rather than an ordering detail.** A
    // grant is authority, not physical presence, so it needs no hand. D19 measured that filling roles
    // commits a hand for a venture's life and that the members who work most therefore act least —
    // halcyon held three hands committed for 96% of all hand-ticks and managed 62 acts in 900 ticks.
    // Every branch below this one is fronted by `idle.length > 0`, so a fully-committed member could
    // previously do nothing at all. Delegating is exactly what such a member SHOULD do: it is the
    // move of someone who is out of hands but not out of assets, which is precisely A6's premise
    // ("you cannot run an empire alone").
    //
    // Eligibility is NOT decided here — `Runtime.grantCandidates` owns it, and `observe` builds its
    // affordance from the same call, so the bot cannot play a rule the menu does not show.
    //
    // **Only when there is no idle hand**, which is narrower than the first version of this branch
    // and is what the paragraph above actually argues for. Placed ahead of the hand branches but
    // gated on them coming up empty, it adds a move for the member that had none without taking one
    // from the member that did. The unconditional version displaced ~1.4% of all actions — enough to
    // make syndicates rarer in a sweep world, which cost `join` its affordance path and broke three
    // fixtures that had nothing to do with authority. A populator cast should add behaviour at the
    // margin, not re-prioritise the whole world.
    const idle = handsOf(runtime.world, member.principal).filter((h) => h.state === 'IDLE');
    if (idle.length === 0) {
      const grant = this.grantFor(member, tick, rng);
      if (grant !== null) return { ...base, ...grant };
    }

    // ── KEEP ONE HAND FOR THE WORLD'S OWN OBLIGATION ──────────────────────────
    //
    // {@link carriageNeeded} carries the measurement: a member holding 109,052 units of the good
    // its tribute is payable in, owing 19,304, with all three hands committed to roles for 264
    // consecutive ticks, and swept at the Reckoning. Rich and recorded short, for no reason it
    // chose. So the two hand-spending branches below see one fewer hand while a world obligation
    // is out of reach — and only then.
    //
    // A subtraction rather than a separate branch, because the *decision* is not "walk a hand"
    // (that is `levyMove`'s, further down) — it is "do not spend this one". Those are different
    // acts and only the first costs an action.
    const spendable = idle.length - this.carriageNeeded(member, tick);

    if (spendable > 0) {
      const slot = this.openSlotFor(member, tick);
      // A hand you have publicly promised to defend with is not idle — {@link musteredAt} carries
      // the measurement. It reserves only as many as the reading needs, so the surplus is spendable.
      const spare = new Map(this.musteredAt(member, tick));
      const hand = idle.find((h) => {
        const left = spare.get(h.location) ?? 0;
        if (left <= 0) return true;
        spare.set(h.location, left - 1);
        return false;
      });
      if (slot !== null && hand !== undefined) {
        return {
          ...base,
          verb: 'fill_role',
          // ── ★ AND IT NAMES A STAKE, WHICH IT DID NOT FOR THE PROJECT'S WHOLE LIFE ──
          //
          // `stake: 0` here was the *published* half of `D30`'s finding: EXPOSURE identically zero,
          // so `BY_EXPOSURE`, `INVERSE_EXPOSURE` and `EVEN` were one flat weight and §5.2's vote had
          // a single lever. {@link stakeFor} is the risk decision and every clause of it is a reason
          // this member might still stake nothing — which is the point: a docket allocated by
          // EXPOSURE needs the members to *differ*, not to all stake.
          params: {
            venture: slot.venture,
            role: slot.role,
            hand: hand.id,
            stake: this.stakeFor(member, tick, slot),
          },
        };
      }
    }

    // Not `spendable`: `create` only READS a hand's location for the stage and commits nothing,
    // so the reservation has no business narrowing it. The distinction matters — gating it here
    // as well was the first version of this change and it cost creates for no benefit at all.
    const appetite = this.options.createChanceBps ?? DEFAULT_CREATE_CHANCE_BPS;
    if (idle.length > 0 && rng.chance(appetite, 10_000)) {
      const hand = idle[0];
      if (hand !== undefined && this.canPromiseOneMore(member, CREATES[member.role])) {
        const kind = CREATES[member.role];
        return {
          ...base,
          verb: 'create',
          params: {
            kind,
            stage: hand.location,
            // A hostile kind must name what it is aimed at, or the Commons floor
            // refuses it for naming nothing — correct fail-closed behaviour, and a
            // bot that never names a target is a bot whose every raid is refused.
            ...(kind === 'RAID' || kind === 'SIEGE' ? { target_system: hand.location } : {}),
          },
        };
      }
    }

    // ── Pay the Levy, and walk toward it if you cannot ────────────────────────
    //
    // Placed *after* the venture branches and *before* the random walk, deliberately:
    //
    //   - After, because the ventures are what the rest of the suite measures and a bot
    //     that paid its tribute before filling a role would quietly change every
    //     venture-side number in the corpus.
    //   - Before, because this is what the random walk was standing in for. §5.2 promises
    //     "continuous off-peak motion from a source that cannot go quiet", and a hand
    //     walking to a delivery place is that motion; a hand wandering at random is
    //     noise that looks like it.
    const paying = this.levyMove(member, tick);
    if (paying !== null) return { ...base, ...paying };

    // ── SUPPLY THE CLAIM, OR LOSE IT AND THE BOND WITH IT ─────────────────────
    //
    // **After the Levy and not before it, deliberately, and the ordering is the balance gate in one
    // line.** The Charge is by far the more consequential of the two — three consecutive misses end
    // the claim and slash `CLAIM_BOND_MINOR` into a sink, where a tribute miss costs reduced Commons
    // capacity, which `D23` #8 records the population pricing at zero. Prioritised on consequence
    // alone the Charge would go first.
    //
    // It goes second because of what it is denominated in: the Charge and the Levy want the **same
    // good**, `levyShort` is the meter §14.2 puts on screen as the headline and the one no single
    // agent can lower, and the whole risk of making territory attractive is that the tribute pays
    // for it. Paying the world first cannot starve the claim, because {@link claimFor} only takes
    // ground that out-earns its own Charge threefold and only after checking the anchor is not being
    // bought out of goods the tribute needs — so by the time a member holds a claim at all, both
    // bills are covered by construction. Measured: `levyShort` is 0 on every gate seed with claims
    // live and Charges paid.
    //
    // Two steps, the same shape `levyMove` uses: hand over what is standing there, or walk a hand
    // to it. Partial payment counts (`CHARGE_STATEMENT`), so it hands over whatever it can rather
    // than waiting to be able to clear the whole bill.
    const supplying = this.chargeMove(member, tick);
    if (supplying !== null) return { ...base, ...supplying };

    // ── ★ CARRY A NEIGHBOUR'S SHARE — §5.2's OTHER HALF, FIRST EXERCISED HERE ──
    //
    // **Third of three claims on a unit of `ration`, and last of them on purpose.** Your tribute,
    // then your Charge, then somebody else's tribute — the ordering ethic is the one
    // `delegatedElectionFor` states for a mandate: you settle your own promises before you spend
    // goods on anyone else's. Both branches above return `null` the moment nothing is owed, so a
    // member that has paid in full reaches this in the same tick rather than a Reckoning later.
    //
    // Above the fleet and walk branches below it because it spends **no hand's position at all** —
    // it delivers from a hand already standing at the delivery place, which is where paying its own
    // tribute put it. A move that uses a hand where it stands should not lose to one that relocates
    // it for ticks.
    //
    // Why it exists: `deliver {payer}` is legal, works, credits `paidOther`, and **had never been
    // called by anything** — `paidOther` 0 in every world this repo has run. `carryFor` carries the
    // measurement and CAST_CARRY_RESERVE_RECKONINGS the one calibrate number.
    const carrying = this.carryFor(member, tick, carriedThisTick);
    if (carrying !== null) return { ...base, ...carrying };

    // ── BRING YOUR HANDS TO YOUR FLEET ────────────────────────────────────────
    //
    // ══════════════════════════════════════════════════════════════════════════
    // **THE MEASUREMENT THAT FORCED THIS BRANCH: A MEMBER WITH THREE READY WARSHIPS AND NOBODY TO
    // FLY THEM.**
    //
    // Traced tick by tick on seed `fz-13`, member `brannock` — the only member in twenty-four seeds
    // that reached the Frontier. It crossed, worked the ground, claimed it, and built the whole
    // doctrine: two WARDENs and a PIKE, all READY, all berthed at `sys-26`. Then the world raided
    // `sys-26` twice and it **paid both times**, because its three hands were at `sys-25`, `sys-29`
    // and `sys-08` — scattered across the constellation by the aimless walk, which was the only thing
    // in this file with an opinion about where a hand should be when nothing was owed.
    //
    // `engage` refuses a hull with no crew in as many words: *"a hull without a hand is a berthed
    // asset, not a combatant — which is the presence scarcity every other mechanic in this game is
    // priced against."* So the fleet was complete, legal, in the fleet book, and **unflyable** —
    // which is this project's signature defect one level below the one this change was written for.
    //
    // Placed **after** the Levy and the Charge for `chargeMove`'s reason exactly: those are
    // obligations with a public consequence and this is an option. Placed **before** the aimless walk
    // for the other half of that argument: a hand walking to a berth where a warship is waiting is
    // motion with a destination, and §5.2 asks for exactly that.
    // ══════════════════════════════════════════════════════════════════════════
    const crewing = this.crewMove(member, tick);
    if (crewing !== null) return { ...base, ...crewing };

    // ── A HAND STANDING WHERE YOUR TRIBUTE IS PAYABLE IS STATIONED, NOT IDLE ──
    //
    // The aimless walk was pulling hands off the one system they were needed on, every Reckoning,
    // and then `levyMove` walked them back. Measured on a world where members leave the Commons:
    // the tug-of-war kept `carriageNeeded` true for long stretches, which held `spendable` down,
    // which cost the world a fifth of its ventures — a walk with no destination beating a walk
    // with one, purely because it came last and therefore always had a hand to spend.
    //
    // So a hand on a place this member owes goods at is excluded from the walk. It is not a
    // restriction on motion: §5.2 asks for "continuous off-peak motion from a source that cannot go
    // quiet", and the tribute walk IS that source — the aimless one is what stands in for it. And a
    // hand parked on the delivery berth renders as the tribute line's SOLID state, which says more
    // to a viewer than a hand wandering between two systems.
    const stationed = new Set<SystemId>();
    const owedAt = runtime.levyBlockFor(member.principal, tick);
    // Permanently, not only while something is outstanding. Measured both ways: releasing the hand
    // the moment its tribute is discharged gives back the tug-of-war in full (venture count 691
    // against 1,189, defaults 66 against 33) because the obligation returns every Reckoning and the
    // walk has all of the ticks in between to carry the hand out of reach again.
    if (owedAt !== null) stationed.add(owedAt.deliverable_to);
    for (const claim of runtime.sovereignty.claimsOf(member.principal)) stationed.add(claim.system);
    // And a hand standing beside a warship of yours is **crew**, for the same reason with a sharper
    // edge: a hull does not travel, so the only place its hand is any use is the berth. The aimless
    // walk was measured carrying the crew away — see {@link crewMove}.
    for (const hull of runtime.fleet.readyOrBusyOf(member.principal)) stationed.add(hull.location);
    // And a stage this member has answered FIGHT at, for the whole window: the force reading is taken
    // again at resolution, so a hand that wanders off during it un-answers the raid.
    for (const stage of this.musteredAt(member, tick).keys()) stationed.add(stage);
    const roamers = idle.filter((h) => !stationed.has(h.location));
    if (roamers.length > 0) {
      const hand = roamers[rng.int(roamers.length)];
      if (hand !== undefined) {
        const system = runtime.world.map.systems.get(hand.location);
        if (system !== undefined && system.lanes.length > 0) {
          // Stay in the tier its BODY stands in: a Commons-bound principal may only
          // move between Commons systems (A15), and a refused move is a wasted bot.
          //
          // Off the holding, never `member.seat` — see {@link bodyOf}. Identical for every
          // member that has not crossed, which is why this is not a behaviour change on its
          // own; it is what keeps the aimless walk aimed at the right tier after one does.
          // Kept as a tier filter rather than {@link mayEnter} on purpose: `mayEnter` is the
          // engine's rule and would let a raider wander into the Commons, where every `RAID`
          // it then created would be refused by the floor — one refusal per tick, which is
          // exactly the AGT-S3 noise the whole file is arranged to avoid.
          const home = tierOf(runtime.world.map, this.bodyOf(member));
          const legal = [...system.lanes]
            .filter((lane) => tierOf(runtime.world.map, lane) === home)
            .sort(compareIds);
          const lane = legal.length === 0 ? undefined : legal[rng.int(legal.length)];
          if (lane !== undefined) {
            return { ...base, verb: 'move', params: { hand: hand.id, to: lane } };
          }
        }
      }
    }
    return null;
  }

  /**
   * What this payer will pay, and **why it sometimes will not pay in full.**
   *
   * ══════════════════════════════════════════════════════════════════════════
   * §7.6 IS THE POINT OF THIS FUNCTION.
   *
   * The old cast elected `IN_FULL` on every venture it created, unconditionally, and
   * said so honestly: *"a bot that always honours cannot answer §7.6."* That left the
   * design's own falsification test — *is the elective part always honoured?* — with a
   * rigged answer, because the only agent in the world was honest by construction.
   *
   * So this bot has a **reason**, and the reason is the one §6.4 uses to price the
   * resistance in the first place:
   *
   * > "Resisting a temptation you could not afford is worth more than resisting one you
   * > could not be bothered with." — `agent.md`
   *
   * The bot is willing to commit {@link CAST_ELECTIVE_APPETITE_BPS} of its **free**
   * stores to elective parts across everything settling tonight. Inside that, it elects
   * `IN_FULL` — the honest statement, and the only one that is safe on a share role
   * where the due is not knowable until the residual is drawn. Beyond it, it elects the
   * part it can still cover and declines the rest: a `DECLINED` default, permanently, on
   * a promise it decided not to keep because it had spent the money elsewhere. That is
   * the ordinary, legitimate, un-dramatic road to a broken promise, which is exactly A6's
   * claim about how betrayal happens.
   *
   * **Three properties that make it a policy and not a coin flip:**
   *
   *   1. **No `Rng` at all.** Deliberate: a random default is a dice roll, and A6's whole
   *      claim is that betrayal is never one. Nothing here draws, so nothing here can
   *      make the world unreplayable either (DET-7).
   *   2. **Integer arithmetic only** — `bps` and `trunc`. A float in a value path is
   *      banned, and this figure decides what moves at settlement.
   *   3. **Stateless and monotone.** It recomputes its whole intention from the world
   *      every tick, so it needs no book of its own and cannot drift out of step with
   *      one. An existing statement is left alone while it is still affordable and is
   *      only ever restated *downwards* — which converges, and which is the restatement
   *      `agent.md` promises is possible right up to the freeze: "changing your mind late
   *      is allowed, and it is the whole reason this game has drama in it."
   * ══════════════════════════════════════════════════════════════════════════
   */
  /**
   * Convert raw yield into the payable good, or null.
   *
   * No roll and no cap: unlike `build` and `form`, this is not a commitment with a permanent
   * consequence — it is the second half of an extraction the member already paid for, and a bot that
   * refined *sometimes* would just accumulate unusable ore. The engine's own refusal is the only gate
   * that matters, so the branch asks the same question the verb does (are there unpledged lots here)
   * and otherwise stays quiet, which keeps it out of AGT-S3's per-tick refusal noise.
   */
  private refineFor(
    member: CastMember,
    tick: number,
  ): { readonly verb: string; readonly params: Readonly<Record<string, unknown>> } | null {
    const runtime = this.runtime;
    if (inFreeze(tick) || isSettlementTick(tick)) return null;
    const system = holdingOf(runtime.world, member.principal).system;
    // A worthwhile batch, not merely a legal one — see {@link CAST_REFINE_MIN_QTY}, and
    // {@link CAST_REFINE_MIN_TICKS} for why the floor has to scale with what the place pays. The
    // rate comes off `worksQuote`, which already divides by the occupancy this member actually
    // faces, so a crowded system lowers the threshold exactly as much as it lowers the income.
    const perTick = runtime.worksQuote(member.principal, system).sharePerTick;
    const want = Math.max(REFINE_IN_QTY, CAST_REFINE_MIN_QTY, perTick * CAST_REFINE_MIN_TICKS);
    const have = runtime.refinableAt(member.principal, system);
    if (have < want) return null;
    // ── ★ A COMMONS MANUFACTURER HOLDS ITS ORE BACK, AND WITHOUT THIS THE FOURTH GOOD IS INERT ──
    //
    // ══════════════════════════════════════════════════════════════════════════
    // **MEASURED, AND THE FIRST BUILD OF THIS CHANGE PRODUCED EXACTLY ZERO.** Four seeds, six
    // Reckonings: `refine:ALLOY=0 · trade:ASK=0 · trade:BID=0 · haul=0 · fills=0`, with ~620,000
    // rations in stores and ~4,000 ore in the whole world. `alloyRefineFor` sits ABOVE this branch and
    // still never fired, because **placement is not a reserve.** This branch takes *every whole batch
    // it can* the moment ore crosses `want` (500–1,320), the alloy recipe needs
    // `CAST_ALLOY_ASK_QTY × ALLOY_IN_QTY` = 4,000 in one place, and ore therefore never survived long
    // enough to reach a batch. The branch above declined on every tick of every world.
    //
    // That is the twelfth instance of this repo's defining defect and it was one ordering away from
    // shipping: a mechanic built, an affordance offered, rules written, a cast branch present — and
    // structurally incapable of firing. *Ordering a branch higher does not reserve its input.*
    //
    // So the reserve is explicit. A Commons member whose tribute is already covered **stops making
    // rations it does not need and accumulates ore toward a batch it can sell.** That is not a bot
    // trick, it is the decision §10.1 asked the economy to produce, and it is the only form in which
    // this cast can express it.
    //
    // Three clauses, and every one of them is a reason NOT to hold back:
    //
    //   - **Only in the Commons.** Nowhere else can turn the ore into alloy, so holding it anywhere
    //     else is a member starving itself for a recipe it cannot run.
    //   - **Only with the tribute covered**, by the same reader and the same multiple
    //     `alloyRefineFor` uses. A member short of `ration` refines rations, always. `levyShort` and
    //     the red tribute line count are the only two meters in `balance-gate.ts` that survive a null
    //     control, and this is the clause that keeps them where they were.
    //   - **Only below the batch.** Once the batch is reachable the branch above takes it, and this
    //     one resumes on the remainder — so the hold-back is bounded by 4,000 units and cannot
    //     become a permanent refusal to convert.
    // ══════════════════════════════════════════════════════════════════════════
    const alloy = this.alloyPlanFor(member, tick);
    if (alloy !== null && alloy.system === system && have < alloy.batchOre) return null;
    // No `qty`: the verb refines every whole batch it can, which is what a member with nothing else to
    // do with the ore wants, and it costs one action either way.
    return { verb: 'refine', params: { system } };
  }

  /**
   * Found a syndicate, or null.
   *
   * The name is the same deterministic suggestion the affordance publishes (`<handle>-house`), so the
   * bot and the menu cannot disagree about what a copy-pasteable default looks like — and it involves
   * no RNG, so nothing here can move `state_hash` by inventing a string.
   *
   * Takes the charter defaults, `treasury_offices` included. That default is the STRONGBOX, which
   * means a founded house cannot be spent by any single holder — deliberately the conservative pick,
   * because the charter is permanent and a bot should not be the thing that decides a pool is a
   * business.
   */
  private syndicateFor(
    member: CastMember,
    tick: number,
    rng: { chance(n: number, of: number): boolean },
  ): { readonly verb: string; readonly params: Readonly<Record<string, unknown>> } | null {
    const runtime = this.runtime;
    if (inFreeze(tick) || isSettlementTick(tick)) return null;
    if (!rng.chance(this.options.syndicateChanceBps ?? DEFAULT_SYNDICATE_CHANCE_BPS, 10_000)) return null;
    if (runtime.syndicates.of(member.principal, tick).length > 0) return null;
    if (freeStores(runtime.ledger, member.principal) < FOUNDING_COST_MINOR) return null;
    return {
      verb: 'form',
      params: {
        name: `${String(member.principal).replace(/^p:/, '')}-house`,
        admission: DEFAULT_CHARTER.admission,
        decision: DEFAULT_CHARTER.decision,
        treasury_offices: DEFAULT_CHARTER.treasuryOffices,
      },
    };
  }

  /**
   * Cross out of the Commons, or null — **and where to, which is the interesting half.**
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THE DESTINATION IS RANKED BY THE ENGINE'S OWN QUOTE, PLUS ONE FACT THE QUOTE CANNOT SEE.**
   *
   * `worksQuote(me, there).sharePerTick` is exactly the question — *what would I keep per tick if
   * I worked that ground* — and it already accounts for the two things that make one system worth
   * more than another: how many WORKS are dividing the yield, and what the claim-holder there
   * would take of the rest. So the primary key is that number and no arithmetic of mine, which
   * keeps the bot from playing a rule the affordance does not publish (scar #5).
   *
   * **The fact the quote cannot see is intent.** Occupancy counts WORKS, and a member that has
   * crossed but not yet built is invisible to it. Rank on the quote alone and every graduate in
   * the world reads the same tie and picks the same system: measured, six members piled onto one
   * MARCHES system, each ending on a third of its yield — worse than the Commons they left. So
   * `holdingOccupancy` — the same accessor newcomer seating uses, one home for "how many bodies
   * stand here" — is the tie-break AND part of the gate.
   *
   * Two conditions, and a crossing needs both:
   *
   *   1. **The ground must quote better than where you stand.** Strictly, so a member cannot
   *      churn 50,000 and 5,000 goods moving between two systems that pay the same.
   *   2. **It must hold fewer bodies.** Every body standing there is a WORKS that has not been
   *      built yet, and this is the condition that makes the cast spread out instead of
   *      stampeding. It is also self-correcting in both directions: as members leave, the
   *      Commons de-crowds and staying gets better; as they arrive, the destination crowds and
   *      going gets worse.
   *
   * The result is an equilibrium rather than an exodus — the Commons keeps residents, the Marches
   * fill, and a member seated next to the Frontier goes there because 150 a tick beats 110.
   * ══════════════════════════════════════════════════════════════════════════
   *
   * Affordability is the engine's `graduationQuote(...).affordable`, never a recomputation, plus
   * {@link CAST_GRADUATE_RESERVE_MINOR} — the policy half, which is the balance gate.
   */
  private graduateFor(
    member: CastMember,
    tick: number,
    rng: { chance(n: number, of: number): boolean },
  ): { readonly verb: string; readonly params: Readonly<Record<string, unknown>> } | null {
    const runtime = this.runtime;
    if (inFreeze(tick) || isSettlementTick(tick)) return null;
    if (!rng.chance(this.options.graduateChanceBps ?? DEFAULT_GRADUATE_CHANCE_BPS, 10_000)) return null;
    // See the placement note in `decideOne`: a WORKS cannot follow a body, so crossing after
    // building strands the member's own income where it can neither refine nor spend it.
    if (runtime.works.ofPrincipal(member.principal).length > 0) return null;

    const quote = runtime.graduationQuote(member.principal);
    if (quote === null || !quote.affordable) return null;
    // The engine refuses a crossing that would leave a claim with no body on it (INV-8), and it
    // publishes the reason on the quote. Asking here as well keeps the bot out of AGT-S3's
    // per-tick refusal noise; it cannot currently fire, because a claimant always holds a WORKS.
    if (quote.anchoring.length > 0) return null;
    if (quote.freeMinor - quote.upkeepMinor < CAST_GRADUATE_RESERVE_MINOR) return null;
    // A gate fee may not be paid out of money already promised — see {@link statedElectiveOf}.
    if (!this.canSpendWithoutBreakingAPromise(member, quote.upkeepMinor)) return null;

    const here = this.bodyOf(member);
    const bodies = holdingOccupancy(runtime.world);
    const hereShare = runtime.worksQuote(member.principal, here).sharePerTick;
    const hereBodies = bodies.get(here) ?? 1;
    const hereTier = YIELD_PER_TICK[tierOf(runtime.world.map, here)];

    let best: { readonly to: SystemId; readonly share: number; readonly bodies: number } | null = null;
    // Canonical order over the destinations, so the third sort key is the id and two runs of one
    // seed can never disagree about which of two equal systems was picked.
    for (const to of [...quote.open].sort(compareIds)) {
      // ── A CROSSING IS A TIER DECISION, NOT A LATERAL MOVE ──────────────────
      //
      // The tier's published yield is the ordering — `YIELD_PER_TICK`, the engine's own table, not
      // an invented rank. A hop from one MARCHES system to another costs the same 50,000 and
      // 5,000 goods as leaving the Commons and buys nothing the member could not already have had
      // where it stood: it is outside A8 either way and can claim the ground under its feet.
      //
      // Measured, and it is the whole reason this line exists: with lateral hops allowed, `sable`
      // crossed TWICE, spent 100,000 of a 250,000 stake on gates, and then **declined 13 elective
      // promises** — because {@link CAST_ELECTIVE_APPETITE_BPS} is a share of free stores and a
      // member that has spent its stores keeps fewer promises. All 25 of the extra defaults the
      // crossing produced were `DECLINED` and every one of them was a member that had crossed. A
      // wanderer is not a story; it is a bot buying gate fees with money it needed to keep its word.
      //
      // Re-measured once {@link HeuristicCast.canPromiseOneMore} landed, because that gate absorbed
      // most of the defaults: deleting this line now costs the world its TENANTS rather than its
      // solvency — `tenants 5 -> 1` and rent collected `31,350 -> 3,113` across the four gate seeds,
      // because members that keep moving never settle next to each other. So the rule earns its place
      // twice, and the second reason is the better one: territory is worth holding only if somebody
      // else is standing on it.
      if (YIELD_PER_TICK[tierOf(runtime.world.map, to)] <= hereTier) continue;
      const share = runtime.worksQuote(member.principal, to).sharePerTick;
      if (share <= hereShare) continue;
      const there = bodies.get(to) ?? 0;
      if (there >= hereBodies) continue;
      if (best === null || share > best.share || (share === best.share && there < best.bodies)) {
        best = { to, share, bodies: there };
      }
    }
    if (best === null) return null;
    return { verb: 'graduate', params: { to: best.to } };
  }

  /**
   * Raise a WORKS, or null. The economy's only source of goods.
   *
   * Gated on `worksQuote(...).affordable` — the same predicate the affordance publishes and the verb
   * enforces, never a recomputation. D17 records what happens otherwise: an instrument that recomputed
   * this with `freeCash` kept reporting 0 after the gate moved to the free balance, so it measured a
   * rule the engine no longer had, in exactly the direction that hid what it was built to reveal.
   */
  private worksFor(
    member: CastMember,
    tick: number,
    rng: { chance(n: number, of: number): boolean },
  ): { readonly verb: string; readonly params: Readonly<Record<string, unknown>> } | null {
    const runtime = this.runtime;
    if (inFreeze(tick) || isSettlementTick(tick)) return null;
    if (!rng.chance(this.options.worksChanceBps ?? DEFAULT_WORKS_CHANCE_BPS, 10_000)) return null;
    // One per member. A second WORKS on the same system also DIVIDES the yield it already draws, so
    // stacking them is close to self-defeating anyway (`share_per_tick` falls as occupants arrive).
    if (runtime.works.ofPrincipal(member.principal).length > 0) return null;
    const system = holdingOf(runtime.world, member.principal).system;
    if (!runtime.worksQuote(member.principal, system).affordable) return null;
    return { verb: 'build', params: { kind: 'WORKS', system } };
  }

  /**
   * Post the bond, or raise the anchor, or null. **`claimLines: 0` was the whole finding.**
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **ONE BRANCH FOR TWO VERBS, BECAUSE A BOND WITHOUT A CLAIM IS CAPITAL LOCKED FOR NOTHING.**
   *
   * `post_bond` and `build {ANCHOR}` are not two decisions. `claimRejection` refuses the anchor
   * unless the bond is already posted, and a bond posted by a member that then never claims is
   * 50,000 taken out of the balance that keeps its elective promises in exchange for nothing at
   * all. So the same gate decides both and the branch emits whichever step is next: they are one
   * act that costs two actions.
   *
   * ## The gate, and every clause of it is the balance gate
   *
   *   1. **One claim per member.** Self-limiting, like the WORKS and the charter. `requiredBondOf`
   *      scales with claims held, so a second claim doubles the locked capital.
   *   2. **Outside the Commons.** A Commons claim is INVALID rather than refused (A8) — asking
   *      would be one refusal per tick forever, which is the AGT-S3 noise that buries real defects.
   *   3. **On ground this member already WORKS, and works ONLINE.** The recurring Charge is funded
   *      by income at that exact place, in the good the Charge is payable in once `refine` has run,
   *      standing where the Charge requires it to stand. It is also, and not by coincidence, the
   *      fuel rule: a FRONTIER claimant's own WORKS is the only thing that yields the `fuel` its
   *      anchor burns, and `works/params.ts` states the consequence — *"a landlord that works its
   *      own ground fuels itself; a pure rentier must buy fuel from the tenant it taxes."* Claim
   *      where you work and the anchor is warm by construction; claim where you do not and it is
   *      cold from the first Reckoning.
   *   4. **{@link CAST_CLAIM_COVER_MULTIPLE}** — the place must out-earn its own Charge threefold.
   *   5. **The anchor may not be paid out of goods the tribute needs.** Checked against
   *      `levyGoodAvailable` minus `ANCHOR_QTY` against what is still owed tonight, so the one act
   *      that destroys 5,000 units of the Levy's own good can never be the reason a tribute is
   *      short. This is the clause that makes the branch answerable to §14.2's headline directly
   *      rather than through a projection.
   *   6. **The bond may not be locked out of money already promised** —
   *      {@link canSpendWithoutBreakingAPromise}. A bond is not spent, but it leaves the *free*
   *      balance, and `CAST_ELECTIVE_APPETITE_BPS` is a share of exactly that. Measured on the
   *      crossing: unfunded capital commitments turn into `DECLINED` defaults on the public record.
   *
   * Everything the ENGINE decides is asked of the engine: `bondView` for the shortfall,
   * `chargeGoodAt` for the anchor goods, `worksQuote` for the income, `chargeOf` for the bill.
   * Nothing here recomputes a rule the affordance publishes (scar #5).
   * ══════════════════════════════════════════════════════════════════════════
   */
  private claimFor(
    member: CastMember,
    tick: number,
    rng: { chance(n: number, of: number): boolean },
  ): { readonly verb: string; readonly params: Readonly<Record<string, unknown>> } | null {
    const runtime = this.runtime;
    if (inFreeze(tick) || isSettlementTick(tick)) return null;
    if (!rng.chance(this.options.claimChanceBps ?? DEFAULT_CLAIM_CHANCE_BPS, 10_000)) return null;
    if (runtime.sovereignty.claimsOf(member.principal).length > 0) return null;

    const system = this.bodyOf(member);
    const tier = tierOf(runtime.world.map, system);
    if (tier === 'COMMONS') return null;
    // Somebody else's ground. A takeover is a real move and it is deliberately NOT this branch's:
    // it needs a CONTESTED incumbent, the published window, and the arrears inherited with it —
    // §6.3's collapse arc, which belongs to an agent with a reason and not to a populator's roll.
    if (runtime.sovereignty.liveAt(system) !== null) return null;

    // Working it, and *online*: a WORKS inside its spin-up has produced nothing, so its income is
    // a promise rather than a fact and the Charge it would fund is not yet fundable.
    const mine = runtime.works
      .liveAt(system)
      .filter((w) => w.holder === member.principal && tick >= w.onlineAtTick);
    if (mine.length === 0) return null;

    const quote = runtime.worksQuote(member.principal, system);
    const bill = chargeOf({ tier, misses: 0 });
    // ── ★ THE COVER TEST CROSSES TWO GOODS, SO THE RATIO IS IN THE ARITHMETIC ──
    //
    // `worksQuote.sharePerTick` is `WORKS_YIELD_GOOD` (`ore`); `chargeOf` returns `CHARGE_GOOD`
    // (`ration`). This compared them directly, which divides one good by another and reads the
    // answer as cover — the **identical** mistake `api/observe.ts` already fixed in the WORKS
    // payback sentence, with the reason stated there: *"it happens to be right at today's 1:1
    // recipe and would go silently wrong the moment `refine` stopped being lossless — so the ratio
    // is IN the arithmetic and named in the sentence, rather than assumed by both."* That fix
    // landed in the affordance and this copy kept the assumption.
    //
    // `sovereignty/params.ts` and `test/core/goods-are-independent.test.ts` are explicit that the
    // two goods being equal *"is a decision (D17), not a fact about the engine"*, so this is the
    // site that breaks on the day a second good lands — and it decides whether the cast takes
    // ground whose recurring bill would then be denominated in something it does not earn. A claim
    // that cannot fund its Charge lapses in three Reckonings and slashes `CLAIM_BOND_MINOR`.
    //
    // Refined income, not raw: the Charge is payable in `ration` and `refine` is the only road from
    // one to the other, so `ore x OUT / IN` is what a Reckoning of this place actually yields
    // *toward the bill*. Integer, and it truncates — the gate understates income, which is the same
    // direction {@link CAST_CLAIM_COVER_MULTIPLE} already errs in.
    const refinedPerReckoning = Math.floor(
      (quote.sharePerTick * TICKS_PER_RECKONING * REFINE_OUT_QTY) / REFINE_IN_QTY,
    );
    if (refinedPerReckoning < bill * CAST_CLAIM_COVER_MULTIPLE) return null;

    // ── THE TRIBUTE COMES FIRST, ALWAYS ──────────────────────────────────────
    //
    // `levyGoodAvailable` is location-blind exactly as the Levy's own reader is, so this asks the
    // question the settlement will ask: after the anchor destroys `ANCHOR_QTY` of the good the
    // tribute is payable in, is the tribute still covered?
    //
    // **Measured NOT to bind in an 8-to-20-member sim, and kept anyway.** Removing it moves nothing
    // — `levyShort 0 · kept 172 · broken 16 · ventures 905 · claims 11`, identical to four decimal
    // places — because a member that has crossed, built and waited out a spin-up is holding tens of
    // thousands of units by the time it can claim at all. So this is a **property** today and not a
    // behaviour, and that is written down rather than left to be discovered: an unexercised guard
    // reads exactly like a missing one.
    //
    // It stays because the world it guards is the one the population is heading toward, not away
    // from: the Commons crowds as the cast grows (`YIELD_PER_TICK` is divided, never multiplied), and
    // the first member to reach a claim while genuinely short of ration is the first one whose anchor
    // would be paid for out of its tribute. That breach would be the *cast's*, on a permanent public
    // record with no opt-out — the one class of failure A5′ calls worse than a crash.
    const owed = runtime.levyBlockFor(member.principal, tick)?.shortfall_if_unpaid ?? 0;
    if (runtime.levyGoodAvailable(member.principal) - ANCHOR_QTY < owed) return null;

    const bond = runtime.bondView(member.principal);
    const shortfall = CLAIM_BOND_MINOR + bond.required - bond.posted;
    if (shortfall > 0) {
      if (freeStores(runtime.ledger, member.principal) < shortfall) return null;
      if (!this.canSpendWithoutBreakingAPromise(member, shortfall)) return null;
      return { verb: 'post_bond', params: { amount: shortfall } };
    }
    // The anchor's own price, asked with the SAME accessor the verb and the affordance use.
    if (runtime.chargeGoodAt(member.principal, system) < ANCHOR_QTY) return null;
    // ── AND THE MANUFACTURED HALF, WHICH THIS MEMBER CANNOT HAVE MADE ─────────
    //
    // The same accessor `claimRejection` and the affordance read, for the reason the comment above
    // this method already gives about crossing two goods: the bot must not ask for something the menu
    // would refuse. `alloyAt` is location-bound because an anchor is produced material put into a
    // *place*, and `ALLOY_TIER` is COMMONS — so a member standing here can never refine this and the
    // units are always somebody else's work, hauled in. `alloyErrandFor` is the branch that gets them,
    // and it is placed above this one so the errand runs before the claim it is for.
    if (runtime.alloyAt(member.principal, system) < ALLOY_ANCHOR_QTY) return null;
    return { verb: 'build', params: { kind: 'ANCHOR', system } };
  }

  /**
   * ★ Refine the fourth good, and sell it. The **supply** side of the first two-way trade this world
   * has ever had.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THE MEASUREMENT THIS BRANCH EXISTS FOR: 0 ORDERS AND 0 FILLS, EVER.** `market/` is 3,065 built
   * lines and across four seeded worlds at six Reckonings it had never held a single order — because
   * no cast branch placed one, and because until `haul` there was nothing worth buying anywhere but
   * where you already stood. Meanwhile 530,000–589,000 units of `ration` sat in stores with nothing
   * to spend them on.
   *
   * This is the twelfth instance of the defect this repo keeps re-teaching, and the eleventh was
   * `lockFillStake` — a function implementing §7.3's escrow, with the section quoted above it and its
   * own unit test, and **no caller.** So the rule applied here is the one that cost the most to learn:
   * *when you land a mechanism, land the branch that uses it and the meter that shows it.*
   *
   * ── WHY THE COMMONS AND NOT EVERYONE ─────────────────────────────────────────
   *
   * `ALLOY_TIER` is COMMONS, so this branch is the only place in the cast that a COMMONS member does
   * something a MARCHES member cannot. Measured, the Commons holds **2–3 of 8 members** in every seed
   * — a real supply side on the first day, which is exactly what a FRONTIER-gated recipe would not
   * have had (0 of 8 in three seeds of four).
   *
   * ── THE TRIBUTE COMES FIRST, AND THAT IS THE LOAD-BEARING GUARD ──────────────
   *
   * The alloy recipe and the ration recipe **compete for the same ore**, which is the decision §10.1
   * asked for and also the one way this change could break the Levy. `levyShort` and the red tribute
   * line count are the only two meters in `balance-gate.ts` that survive a null control, so the gate
   * is: refine alloy only out of ore this member does **not** need for tribute, measured with the same
   * location-blind reader the settlement uses. A member short of `ration` makes rations.
   * ══════════════════════════════════════════════════════════════════════════
   */
  private alloyRefineFor(
    member: CastMember,
    tick: number,
  ): { readonly verb: string; readonly params: Readonly<Record<string, unknown>> } | null {
    if (inFreeze(tick) || isSettlementTick(tick)) return null;
    const plan = this.alloyPlanFor(member, tick);
    if (plan === null) return null;
    if (this.runtime.refinableAt(member.principal, plan.system) < plan.batchOre) return null;
    return { verb: 'refine', params: { kind: 'ALLOY', system: plan.system, qty: plan.step } };
  }

  /**
   * ★ Why this member wants alloy, how much, and what a batch of it costs in ore here — or null.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **ONE HOME, BECAUSE TWO BRANCHES HAVE TO AGREE OR THE GOOD IS INERT.** `alloyRefineFor` decides
   * whether to make a batch; `refineFor` decides whether to hold ore back so a batch is ever
   * reachable. **If those two disagree by a single unit the fourth good never gets made**, and that is
   * not a hypothetical — it is what the first two builds of this change measured. Build one had no
   * hold-back at all (`refine:ALLOY = 0`, because rations drained the ore at 500 while a batch needed
   * 4,000). Build two held back only in the COMMONS, so `claims` stayed at **0** while every Marches
   * member sat on 1,300 ore needing 16,000. Both times the branch existed, was reachable, was ordered
   * first, and could not fire.
   *
   * So the question is asked once and both callers read the answer.
   *
   * ── WHY A MEMBER WANTS IT AT ALL, AND THE TWO ANSWERS ARE DIFFERENT ──────────
   *
   * **In the Commons it is a business.** `ALLOY_IN_BY_TIER` makes this the cheapest ground in the
   * galaxy for the recipe (8:1 against 32 and 64) and every claim in the game is somewhere that pays
   * more, so a Commons member makes it to *sell*. It stops at one whole ask.
   *
   * **Outside it is a cost.** A claim needs `ALLOY_ANCHOR_QTY` and the local rate is four to eight
   * times worse, so a member only makes its own when it actually wants ground. It stops at the gate.
   * Without that clause the whole cast would manufacture a good most of them have no use for, which is
   * hoarding rather than an economy — and it would do it out of ore the Levy needs.
   * ══════════════════════════════════════════════════════════════════════════
   */
  private alloyPlanFor(
    member: CastMember,
    tick: number,
  ): { readonly system: SystemId; readonly step: number; readonly batchOre: number } | null {
    const runtime = this.runtime;
    const system = this.bodyOf(member);
    const tier = tierOf(runtime.world.map, system);

    const wantsGround =
      runtime.sovereignty.claimsOf(member.principal).length === 0 &&
      tier !== 'COMMONS' &&
      runtime.sovereignty.liveAt(system) === null &&
      runtime.works.liveAt(system).some((w) => w.holder === member.principal && tick >= w.onlineAtTick);
    if (tier !== ALLOY_TIER && !wantsGround) return null;

    const target = tier === ALLOY_TIER ? CAST_ALLOY_ASK_QTY : Number(ALLOY_ANCHOR_QTY);
    if (runtime.alloyAt(member.principal, system) >= target) return null;

    // ── THE TRIBUTE RESERVE, IN THE GOOD THE TRIBUTE IS PAYABLE IN ────────────
    //
    // `max` of this Reckoning's own assessment and the published duty, exactly as `carryFor` does and
    // for the same reason: an assessment can be below the duty under a favourable allocation rule, and
    // reserving the smaller of the two would leave the member short the moment the ballot changed.
    // **This is the clause that keeps `levyShort` and the red tribute line count where they were** —
    // the only two meters in `balance-gate.ts` that survive a null control — and it is checked here
    // rather than in either caller so that neither can forget it.
    const mine = runtime.levyBlockFor(member.principal, tick);
    const perReckoning = Math.max(mine?.my_assessment ?? 0, LEVY_DUTY_PER_PRINCIPAL);
    if (runtime.levyGoodAvailable(member.principal) < perReckoning * CAST_ALLOY_RESERVE_RECKONINGS) {
      return null;
    }

    // One action per batch rather than per unit: a member that refined 1 alloy at a time would spend
    // an action a tick forever and displace every branch below it.
    const step = Math.min(target, CAST_ALLOY_ASK_QTY);
    return { system, step, batchOre: step * ALLOY_IN_BY_TIER[tier] };
  }

  /**
   * Put the alloy on the book at the venue that made it, or null.
   *
   * ── PRICED OFF THE ONE ADMINISTERED PRICE, NOT OFF A GUESS ───────────────────
   *
   * `LEVY_UNIT_MINOR` is 1 — *"the one administered price this game publishes"* (`works/params.ts`
   * says so where it prices the currency door) — so a unit of `ration` discharges 1 minor of duty and
   * a unit of ore is worth 1 by the 1:1 recipe. The alloy recipe consumes {@link ALLOY_IN_QTY} ore, so
   * **8 minor is the seller's floor: below it, refining alloy is worse than paying tribute with the
   * same ore.** The ask is that floor times {@link CAST_ALLOY_MARKUP_NUM}/{@link CAST_ALLOY_MARKUP_DEN},
   * which is a margin the seller is *entitled* to ask because no buyer outside the Commons has an
   * alternative — and integer arithmetic throughout, because a float in a value path is banned.
   *
   * One resting ask at a time. `MAX_OPEN_ORDERS_PER_PRINCIPAL` is 24 and a bot that re-posted every
   * tick would fill the book with its own stale rows, which is `Book.prune`'s hazard arriving from the
   * cast side.
   */
  private alloyAskFor(
    member: CastMember,
    tick: number,
  ): { readonly verb: string; readonly params: Readonly<Record<string, unknown>> } | null {
    const runtime = this.runtime;
    if (inFreeze(tick) || isSettlementTick(tick)) return null;
    if (!runtime.liveVerbs.has('trade')) return null;
    const system = this.bodyOf(member);
    if (tierOf(runtime.world.map, system) !== ALLOY_TIER) return null;
    // A book is local and `trade` refuses an agent with no hand standing at the venue — the engine's
    // own rule, asked here so the bot does not generate a refusal it could have predicted (AGT-S3).
    const present = handsOf(runtime.world, member.principal).some(
      (hand) => isPresent(hand, tick) && hand.location === system,
    );
    if (!present) return null;
    if (runtime.market.openForIn(member.principal, system, ALLOY_GOOD).length > 0) {
      return null;
    }
    const have = runtime.alloyAt(member.principal, system);
    if (have < CAST_ALLOY_ASK_QTY) return null;
    // The seller's own input cost at the tier it is standing in — never a fixed number, because the
    // rate IS the geography and a Commons seller quoting a Marches cost would price itself out of the
    // only advantage it has. `LEVY_UNIT_MINOR` is 1, the one administered price this game publishes,
    // so a unit of ore is worth 1 and this floor is "what the ore would have discharged as tribute".
    const floor = ALLOY_IN_BY_TIER[ALLOY_TIER] * Number(LEVY_UNIT_MINOR);
    const price = Math.trunc((floor * CAST_ALLOY_MARKUP_NUM) / CAST_ALLOY_MARKUP_DEN);
    return {
      verb: 'trade',
      params: {
        operation: 'place',
        venue: system,
        good: ALLOY_GOOD,
        side: 'ASK',
        quantity: have,
        limit_price: price,
        duration_ticks: TICKS_PER_RECKONING,
      },
    };
  }

  /**
   * ★ The **demand** side, as a three-step errand: walk to a Commons book, buy, carry it home.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THIS IS THE BRANCH THAT MAKES THE FOURTH GOOD A GOOD RATHER THAN A RESOURCE.** A good produced
   * in one place and consumed in another with no reciprocal need is a second `fuel`: it flows one way
   * and prices at nothing. What makes alloy two-way is that the *manufacturer* is on the poorest ore
   * ground on the map (`YIELD_PER_TICK` pays the Commons 80 against the Frontier's 150) while the
   * *buyer* is on the richest and cannot refine a unit. So ore and currency move inward, alloy moves
   * outward, and neither side can substitute.
   *
   * Three steps, in the order the errand actually runs, each one action:
   *
   *   1. **`move`** an idle hand one gate toward the nearest COMMONS system with alloy on its book.
   *   2. **`trade`** a BID at that venue once a hand is standing there. The fill settles the cargo
   *      *at the venue* (`market/book.ts`: exact-venue settlement), which is why step 3 exists.
   *   3. **`haul`** it one gate at a time back to the body, because §10.2 locates everything and an
   *      anchor is produced material put into a *place*.
   *
   * ── WHY IT IS ONE BRANCH AND NOT THREE ───────────────────────────────────────
   *
   * The three steps are mutually exclusive by construction — a hand is either walking, standing at the
   * book, or carrying — so splitting them into three `decideOne` entries would spread one errand's
   * preconditions across three call sites that must agree about the destination, the quantity and the
   * reserve. The four empty panels were all *"the mechanic built, the affordance offered, and no cast
   * branch selecting it"*; three branches that each individually decline is how that happens on
   * purpose.
   *
   * ── AND WHY IT RUNS ONLY WHEN THERE IS SOMETHING TO SPEND IT ON ───────────────
   *
   * Gated on actually wanting alloy — a claimable seat, or a crossing beyond the Commons — so the cast
   * does not hoard a good it has no sink for. `runtime.alloyAt` at the body is the stop condition, and
   * it is the same accessor the claim gate and the crossing quote read.
   * ══════════════════════════════════════════════════════════════════════════
   */
  private alloyErrandFor(
    member: CastMember,
    tick: number,
  ): { readonly verb: string; readonly params: Readonly<Record<string, unknown>> } | null {
    const runtime = this.runtime;
    if (inFreeze(tick) || isSettlementTick(tick)) return null;
    if (!runtime.liveVerbs.has('trade') || !runtime.liveVerbs.has('haul')) return null;

    const body = this.bodyOf(member);
    // A Commons seat refines its own; it never runs an errand for what it can make where it stands.
    if (tierOf(runtime.world.map, body) === ALLOY_TIER) return null;
    const want = ALLOY_ANCHOR_QTY;
    if (runtime.alloyAt(member.principal, body) >= want) return null;

    const hands = handsOf(runtime.world, member.principal);

    // ── STEP 3 FIRST: A CARRY ALREADY UNDER WAY BEATS STARTING ANOTHER ─────────
    //
    // Ordered before the buy so a member cannot open a second purchase while the first is still on the
    // road — which would spend two Reckonings of ore on one anchor's worth of alloy.
    for (const hand of hands) {
      if (hand.state !== 'IDLE' || !isPresent(hand, tick)) continue;
      if (hand.location === body) continue;
      const here = runtime.alloyAt(member.principal, hand.location);
      if (here <= 0) continue;
      const next = route(runtime.world.map, hand.location, body)?.path[1];
      if (next === undefined) continue;
      if (!this.mayEnter(member, next)) continue;
      return {
        verb: 'haul',
        params: { hand: hand.id, to: next, good: ALLOY_GOOD, qty: Math.min(here, MAX_HAUL_QTY) },
      };
    }

    // ── AND IF IT CANNOT PAY, IT DOES NOT SET OUT ──────────────────────────────
    //
    // ══════════════════════════════════════════════════════════════════════════
    // **A WALK IS AN ACTION AND A HAND'S POSITION FOR TICKS, SO A SHOPPING TRIP THAT ENDS IN A REFUSAL
    // IS WORSE THAN NO TRIP.** Measured: with the walk ungated on cash, `move` went from ~35 a world to
    // **739**, hands wandered between Commons venues they could never buy at, and every branch below
    // this one was displaced. That is the monoculture failure `CAST_REFINE_MIN_QTY` records — *"a
    // branch placed high with no gate does not add behaviour, it replaces it"* — arriving through
    // logistics instead of through refining.
    //
    // The gate is the market's own accessor, which is the same correction the BID itself needed: with
    // D7's floor at the whole `STARTER_STAKE`, `freeCash` is zero for every principal that has played,
    // so today this returns here and the errand collapses to its haul step. **That is the honest
    // answer, not a workaround** — the world genuinely has no funded buyer — and the day a principal
    // earns past the floor the errand starts working with no further change.
    // ══════════════════════════════════════════════════════════════════════════
    if (Number(freeCash(runtime.ledger, member.principal)) <= 0) return null;

    // ── STEP 2: A HAND IS STANDING AT A BOOK WITH ALLOY ON IT ──────────────────
    //
    // The bid is the ask it can see plus a tick of patience: `crossPrice` is the engine's, and a bid
    // below every resting ask rests forever. Priced off the book rather than off a formula, so the bot
    // pays what the market says instead of what this file guesses.
    for (const hand of hands) {
      if (hand.state !== 'IDLE' || !isPresent(hand, tick)) continue;
      const venue = hand.location;
      const asks = runtime.market
        .openIn(venue, ALLOY_GOOD)
        .filter((o) => o.side === 'ASK' && o.principal !== member.principal);
      if (asks.length === 0) continue;
      if (runtime.market.openForIn(member.principal, venue, ALLOY_GOOD).length > 0) continue;
      const best = Math.min(...asks.map((o) => Number(o.limitPrice)));
      const need = want - runtime.alloyAt(member.principal, hand.location);
      if (need <= 0) continue;
      const cost = best * need;
      // ── ★ `freeCash`, NOT `freeStores`, AND THE DIFFERENCE IS THE WHOLE MARKET ──
      //
      // ══════════════════════════════════════════════════════════════════════
      // **MEASURED: THIS BRANCH SUBMITTED 8,575 BIDS IN ONE 1,728-TICK WORLD AND NOT ONE WAS
      // ACCEPTED.** It checked `freeStores` — the raw free balance — while `market/place.ts` escrows
      // against `market/escrow.ts:freeCash`, which is `freeBalance − ENDOWMENT_FLOOR_MINOR`. D7 puts
      // that floor at the whole `STARTER_STAKE` (250,000), and **every cast member in every world sits
      // between 62,000 and 203,000**, so `freeCash` is identically ZERO for every principal that has
      // ever played. A bot asking the wrong question re-asked it every tick forever.
      //
      // That is the bot and the menu disagreeing about what is possible — the failure this file guards
      // against everywhere else by reading the engine's own accessor — and it produced the worst kind
      // of noise: a predictable refusal per tick, per member, burying the unpredictable ones (AGT-S3).
      //
      // Asking the right question makes the branch **honest and, today, silent**: it declines instead
      // of spamming, and the reason it declines is a real property of the world rather than a bug in
      // here. That silence is a finding and it is reported as one — the market's buy side is
      // unreachable for anyone who has played the game, which is why `market/` has never printed a
      // fill in 3,065 lines. Fixing it means deciding what D7's floor should measure, and that is an
      // A15 decision rather than a patch.
      // ══════════════════════════════════════════════════════════════════════
      if (Number(freeCash(runtime.ledger, member.principal)) < cost) continue;
      if (!this.canSpendWithoutBreakingAPromise(member, cost)) continue;
      return {
        verb: 'trade',
        params: {
          operation: 'place',
          venue: hand.location,
          good: ALLOY_GOOD,
          side: 'BID',
          quantity: need,
          limit_price: best,
          duration_ticks: TICKS_PER_RECKONING,
        },
      };
    }

    // ── STEP 1: WALK TOWARD THE NEAREST BOOK THAT HAS ANY ─────────────────────
    //
    // Canonical order over the venues so one seed walks one sequence, and never a hand a world
    // obligation is standing on — `crewMove` states that rule and this one obeys the same list, for
    // the same reason: pulling a hand off the Levy's delivery place to go shopping reopens the
    // tug-of-war that cost the world a fifth of its ventures.
    const owing = new Set<SystemId>();
    const owedAt = runtime.levyBlockFor(member.principal, tick);
    if (owedAt !== null) owing.add(owedAt.deliverable_to);
    for (const claim of runtime.sovereignty.claimsOf(member.principal)) owing.add(claim.system);

    const venues = [
      ...new Set(
        runtime.market
          .open()
          .filter((o) => o.good === ALLOY_GOOD && o.side === 'ASK' && o.principal !== member.principal)
          .map((o) => o.venue),
      ),
    ].sort(compareIds);
    for (const venue of venues) {
      if (hands.some((hand) => hand.destination === venue || hand.location === venue)) continue;
      for (const hand of hands) {
        if (hand.state !== 'IDLE' || !isPresent(hand, tick)) continue;
        if (owing.has(hand.location)) continue;
        const next = route(runtime.world.map, hand.location, venue)?.path[1];
        if (next === undefined) continue;
        if (!this.mayEnter(member, next)) continue;
        return { verb: 'move', params: { hand: hand.id, to: next } };
      }
    }
    return null;
  }

  /**
   * Answer the standoff the world opened on this member: `fight`, `yield`, or nothing.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **PRICED OFF THE PUBLISHED VIEW, NEVER RECOMPUTED.** `raidsFor` is the same `RaidView` the
   * observation serves, and every figure this branch reads is one an agent is shown before it
   * decides: `force.verdict_if_resolved_now`, `costs.pay`, `costs.if_you_do_nothing`. Recomputing
   * the force here would be a second arithmetic for the number the resolver uses, which is scar #1
   * with a hold at stake — and `resolve.ts` says so in as many words: *"the number an agent is shown
   * before it commits and the number the resolver uses are literally the same call."*
   *
   * ## The four branches, and the second one is a finding rather than a preference
   *
   *   1. **The reading says REPULSED → `fight`.** Free: it commits nothing and locks no capital, and
   *      a repulse takes **nothing at all** plus a Reckoning of `RAID_STAGE_HELD_TICKS` peace at that
   *      place. There is no case in which a target that would win declines to answer.
   *
   *   2. **A favoured fleet at the stage → `fight`, and it costs one demand to do it.**
   *
   *      ══════════════════════════════════════════════════════════════════════
   *      **WINNING A BATTLE AGAINST THE WORLD NOW WINS THE STANDOFF — AND THIS CLAUSE IS WHAT MADE
   *      THAT DEFECT VISIBLE, SO THE HISTORY STAYS.**
   *
   *      It used not to. `predation/resolve.ts` computed `raiderForce = args.raid.force + joiners`,
   *      and for a world raid `raid.force` was a scalar drawn at spawn; `mustWorldFleet` gives the
   *      raid exactly `force` LANCEs and `applyLoss` returns early on a world hull, so a defender
   *      that destroyed **all** of them faced the same number at the window's end. Measured:
   *      `fz-13` tick 192, `brannock` answers FIGHT with one missile WARDEN, kills all three world
   *      LANCEs, holds the field at 2,395 EHP of 4,400 — and the standoff resolves **PLUNDERED
   *      2-3**. Destroying the weather's fleet accomplished, materially, nothing, and this branch
   *      existed to buy the battle anyway so the layer would not stay dark for want of a caller.
   *
   *      {@link import('../combat/battle.js').worldForceLeft} closes it: the world's hulls are
   *      crewed by synthetic hands and `readForce` now counts the ones still standing, so
   *      `force.raid_force_left` falls one per hull destroyed. **The branch stays, and its price
   *      stays** — for two reasons that are both about not over-correcting. The reading is taken at
   *      the window's *end*, so at the moment of the answer a fleet is a bet rather than a
   *      certainty: hulls can die first. And a fleet that is favoured on paper can still lose
   *      (`CAST_ENGAGE_FAVOUR_BPS` is a margin, not a proof), which is exactly the losing branch
   *      A14 requires — a mechanic with no way to lose has no drama.
   *
   *      So resisting instead of paying still costs the difference between two published figures
   *      (`if_you_do_nothing - pay`, one demand at `RAID_TAKE_MULTIPLE = 2`) in the worst case, and
   *      it is only taken when the tribute is still covered afterwards. What changed is that the
   *      spend now buys an outcome instead of a monument.
   *      ══════════════════════════════════════════════════════════════════════
   *
   *   3. **Otherwise `yield` when paying is cheaper than silence.** `yield` pays exactly the demand
   *      where silence pays `RAID_TAKE_MULTIPLE` of it, and both numbers are on the view.
   *   4. **Neither → nothing.** When `costs.pay >= costs.if_you_do_nothing` the cap
   *      (`RAID_MAX_TAKE_BPS`, half of what is standing) has already made silence the cheaper answer,
   *      and an action spent to pay *more* than the raid would take is a worse outcome dressed as
   *      diligence.
   *
   * A `RAID` venture the member created is **not** this branch's business: that is a venture with
   * roles and a settlement, and `raidsFor` returns standoffs.
   * ══════════════════════════════════════════════════════════════════════════
   */
  private raidAnswerFor(
    member: CastMember,
    tick: number,
  ): { readonly verb: string; readonly params: Readonly<Record<string, unknown>> } | null {
    const runtime = this.runtime;
    // No freeze guard, and that is checked rather than assumed: `fight` and `yield` are absent from
    // the `committing` table in `runtime.ts`, because a raid answer is a deadline the world imposed
    // rather than a new commitment. `assertRaidSchedule` also proves no world raid can still be live
    // in the freeze, so this cannot fire there anyway.
    for (const view of runtime.raidsFor(member.principal, tick, MAX_CAST)) {
      if (view.your_side !== 'TARGET') continue;
      if (view.state !== 'DEMANDED' || view.answer !== null) continue;
      const fight = { verb: 'fight', params: { raid: view.raid, system: view.stage } };
      if (view.force.verdict_if_resolved_now === 'REPULSED') return fight;
      // 2. Only against the world, whose composition is published, and only while the extra take
      //    still leaves the tribute covered. `if_you_do_nothing` is charged in full against the
      //    Levy's own good — the pessimistic reading, because `raid.good` need not be that good and
      //    a gate that assumed otherwise would be optimistic about the one meter §14.2 headlines.
      if (view.initiator !== null) continue;
      const owed = runtime.levyBlockFor(member.principal, tick)?.shortfall_if_unpaid ?? 0;
      const affordable =
        Number(runtime.levyGoodAvailable(member.principal)) - view.costs.if_you_do_nothing >= owed;
      if (affordable && this.fleetIsFavouredAt(member, view.stage, tick, view.force.raider)) return fight;
      if (view.costs.pay > 0 && view.costs.pay < view.costs.if_you_do_nothing) {
        return { verb: 'yield', params: { raid: view.raid, system: view.stage } };
      }
    }
    return null;
  }

  /**
   * Would the hulls this member could actually **bring** to `stage` beat `worldHulls` of the world's?
   *
   * "Could actually bring" is the load-bearing half. A READY hull with no hand to crew it is a berthed
   * asset — `engage` says exactly that in the refusal it would give — so counting the fleet rather
   * than the flyable part of it would answer FIGHT on ships that cannot leave the dock. Hands are
   * counted the way `engage` counts them, less {@link carriageNeeded}, so this and {@link engageFor}
   * cannot disagree about how many are coming.
   *
   * Strength is `ehp + alpha × SLICES_PER_TICK` on both sides — `view.ts:forecastFor`'s own formula —
   * so the bot budgets against the number the observation publishes rather than a second one of its
   * own (scar #5).
   */
  private fleetIsFavouredAt(
    member: CastMember,
    stage: SystemId,
    tick: number,
    worldHulls: number,
  ): boolean {
    if (worldHulls <= 0) return false;
    const world = worldFleetProfile();
    if (world === null) return false;
    const bringable = this.crewableAt(member, stage, tick);
    if (bringable < 1) return false;
    const ours = this.runtime
      .committableHulls(member.principal, stage)
      .slice(0, bringable)
      .reduce((n, row) => n + this.strengthOfHull(row.id), 0);
    const theirs = worldHulls * (world.ehp + world.alpha * SLICES_PER_TICK);
    return ours * BPS_ONE >= theirs * CAST_ENGAGE_FAVOUR_BPS;
  }

  /**
   * How many more hulls this member has a hand for at `stage`.
   *
   * IDLE, present, at the stage, not already crewing a hull — the same four conditions
   * `engageRefusal`'s hand gate applies — less the hands {@link carriageNeeded} is holding back for a
   * world obligation, because a wrecked hull routs its crew and a routed hand cannot deliver.
   */
  private crewableAt(member: CastMember, stage: SystemId, tick: number): number {
    const runtime = this.runtime;
    const crewed = runtime.battles.committedHands(member.principal);
    const free = handsOf(runtime.world, member.principal).filter(
      (hand) =>
        hand.state === 'IDLE' && hand.location === stage && isPresent(hand, tick) && !crewed.has(hand.id),
    ).length;
    return Math.max(0, free - this.carriageNeeded(member, tick));
  }

  /**
   * Commit one hull to a battle in MUSTER, or null.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **ONE HULL PER ACTION, RE-DECIDED EVERY TICK.** `engage` commits one hull per call, so a
   * three-ship fleet is three actions across the six ticks of MUSTER — and the gate below is
   * re-evaluated between each of them, which is what lets a heavy raid draw two hulls and a light
   * one draw a single hull without a second policy field.
   *
   * ## Four gates, and the reason for each
   *
   *   1. **The engine's own gate**, asked through `engageRefusalFor` — the identical function
   *      `vEngage` runs. Never a copy: an affordance with its own copy offers moves the handler
   *      refuses, which costs an agent an action and its trust in the menu (AGT-S2).
   *   2. **Only against the world's published fleet.** §11.2 makes a rival's fit a *manifest* — the
   *      view carries hull class and count and deliberately not EHP — so a bot that sized up another
   *      principal's formation would be playing a rule the observation does not publish. The world is
   *      not a principal and `WORLD_FLEET_FIT` is public *by design* (`battle.ts`: *"you do not get
   *      to be surprised by the weather's composition"*), so the arithmetic against it is exact and
   *      the arithmetic against anybody else is not available. A rival's battle is therefore an
   *      LLM's decision, not a heuristic's, and the branch declines rather than guessing.
   *   3. **{@link CAST_ENGAGE_FAVOUR_BPS}** — never feed a hull to a fleet that out-trades it.
   *   4. **A hand the tribute does not need**, through {@link crewableAt}. {@link carriageNeeded}
   *      carries the measurement that forced it into existence for the Levy: a member holding 109,052
   *      units of the good it owed 19,304 of, recorded short, because it had no free hand. A wrecked
   *      hull routs its crew, so a hull flown by the hand reserved for a world obligation is a
   *      tribute one bad battle away from a public shortfall.
   *   5. **THE MARGIN**, and only while the standoff is still winnable — see the block comment at the
   *      gate itself. Measured: seed `gate-c` answered FIGHT twice before this clause existed and one
   *      came back **`FIGHT/PLUNDERED`**, a repulse at the answer tick that was not one at resolution.
   * ══════════════════════════════════════════════════════════════════════════
   */
  private engageFor(
    member: CastMember,
    tick: number,
  ): { readonly verb: string; readonly params: Readonly<Record<string, unknown>> } | null {
    const runtime = this.runtime;
    // `engage` IS in the `committing` table, so the freeze refuses it — asked here as well to stay
    // out of AGT-S3's per-tick refusal noise.
    if (inFreeze(tick) || isSettlementTick(tick)) return null;

    for (const record of runtime.battles.forPrincipal(member.principal)) {
      if (record.resolvedAtTick !== null || record.state !== 'MUSTER') continue;
      const side = record.target === member.principal ? 'DEFENDER' : 'RAIDER';
      const hostile = record.formations.filter((f) => f.side !== side && f.hands.length > 0);
      if (hostile.length === 0) continue;
      // Gate 2. One non-world formation and the whole reading becomes a guess.
      if (hostile.some((f) => f.principal !== WORLD_PRINCIPAL)) continue;

      const hulls = runtime.committableHulls(member.principal, record.stage);
      const candidate = hulls[0];
      if (candidate === undefined) continue;

      // Gate 4. The hands the tribute and the Charge need are not crew.
      if (this.crewableAt(member, record.stage, tick) < 1) continue;

      // Gate 5. The margin, read off the same published view `raidAnswerFor` answered from.
      //
      // ══════════════════════════════════════════════════════════════════════
      // A hull adds **nothing** to the raid's force reading — `readForce` counts hands and a hand
      // crewing a hull is still IDLE at the stage — but a *wreck* subtracts one, because `applyLoss`
      // routs the crew and the reading is taken again at the window's end. So on a standoff the hands
      // would win, every hull committed is one hand of insurance spent: at 3 against 2, losing one
      // hull still repulses and losing two does not.
      //
      // **Skipped when the reading already says PLUNDERED**, and that is not a loophole: there is no
      // margin left to protect, the goods are lost either way at `RAID_TAKE_MULTIPLE`, and a routed
      // hand costs the standoff nothing it had not already lost. A hopeless standoff is the cheapest
      // place to bring a fleet, which is a strange sentence and a true one.
      //
      // ⚑ **ITS SUBJECT NOW OCCURS, AND `worldForceLeft` IS WHAT GAVE IT ONE.**
      //
      // The note that used to stand here said this clause was measured not to bind and kept anyway:
      // defanging it (`> margin + 99`) left every test in `the-cast-goes-to-war.spec.ts` green,
      // because on the gate seeds a member answering FIGHT owned no hull and on the war seeds the
      // one armed member stands on the Frontier where `FORCE_BY_TIER` is 0, so with two hands home
      // its reading was PLUNDERED and the branch was skipped.
      //
      // Both roads now meet, and by the front door rather than by a new seed. A world raid's own
      // force falls one per hull destroyed, so a standoff that read PLUNDERED at the answer **flips
      // to REPULSED mid-window** the moment the guns land — and from that tick this clause is what
      // decides whether the next hull reinforces or stays berthed. It is deliberately the
      // conservative side of a trade that is now genuinely two-sided: a committed hull can win
      // margin by killing a LANCE as well as lose it by becoming a wreck. Kept conservative because
      // the reading is taken at the window's *end*, and the margin is the only thing standing
      // between a lost hull and a lost standoff.
      // ══════════════════════════════════════════════════════════════════════
      const view = runtime.raidsFor(member.principal, tick, MAX_CAST).find((row) => row.raid === record.raid);
      if (view !== undefined && view.force.verdict_if_resolved_now === 'REPULSED') {
        const margin = view.force.defender_if_you_fight - view.force.raider;
        const flying = runtime.battles
          .formationsOf(record.id, member.principal)
          .reduce((n, f) => n + f.hands.length, 0);
        if (flying + 1 > margin) continue;
      }

      // Gate 3. Strength on the field after this commit, in the forecast's own units.
      const world = worldFleetProfile();
      if (world === null) continue;
      const theirs = hostile.reduce((n, f) => n + f.hands.length, 0) * (world.ehp + world.alpha * SLICES_PER_TICK);
      let ours = this.strengthOfHull(candidate.id);
      for (const hull of runtime.fleet.of(member.principal)) {
        if (hull.state !== 'ENGAGED' || hull.location !== record.stage) continue;
        ours += this.strengthOfHull(hull.id);
      }
      if (ours * BPS_ONE < theirs * CAST_ENGAGE_FAVOUR_BPS) continue;

      const params = {
        raid: record.raid,
        system: record.stage,
        hull: candidate.id,
        echelon: 'MAIN',
        posture: 'HOLD',
        // The competent default, stated rather than inherited: kill what holds you, then what
        // repairs, then whatever is nearest death. `DEFAULT_PRIMARY` leads with REPAIR, which is
        // the right order against a fleet that HAS one — the world's does not, and it flies a POINT.
        primary: ['TACKLE', 'REPAIR', 'WEAKEST'],
        withdraw_below_bps: CAST_WITHDRAW_BELOW_BPS,
      };
      // Gate 1, last, so a refusal can never be the thing this branch reports as a decision.
      if (
        runtime.engageRefusalFor({
          principal: member.principal,
          raid: record.raid,
          tick,
          hull: candidate.id,
          echelon: 'MAIN',
          posture: 'HOLD',
          primary: ['TACKLE', 'REPAIR', 'WEAKEST'],
          withdrawWhen: { ehpBelowBps: CAST_WITHDRAW_BELOW_BPS, hullsLost: 0, now: false },
          handId: null,
        }) !== null
      ) {
        continue;
      }
      return { verb: 'engage', params };
    }
    return null;
  }

  /**
   * One hull's strength in {@link CAST_ENGAGE_FAVOUR_BPS}'s units: `ehp + alpha × slices`.
   *
   * Read off the fleet record and re-simulated, which is `profileOfFit`'s rule: the fleet holds the
   * modules and a hash is an identity, so the profile is a lookup rather than a second copy of the
   * fit. Zero for a hull the catalogue no longer knows, so an unreadable fit can only ever make the
   * branch *less* willing to commit.
   */
  private strengthOfHull(id: string): number {
    const record = this.runtime.fleet.get(id as never);
    if (record === undefined) return 0;
    const simulated = simulateFit(record.hull, record.modules);
    if (!simulated.ok) return 0;
    return simulated.value.ehp + simulated.value.alpha * SLICES_PER_TICK;
  }

  /**
   * Build the next ship in {@link CAST_DOCTRINE}, or null.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **A HULL IS THE FIRST THING THIS CAST BUYS THAT IS PAID FOR IN THE TRIBUTE'S OWN GOOD AND
   * DESTROYED PERMANENTLY.** `HULL_COST_GOODS.frame` is `WORKS_GOOD`, which is `LEVY_GOOD`, which is
   * `CHARGE_GOOD` — one quantity, four bills — and `catalogue.ts` prices a WARDEN at 1,500 of it. So
   * three ships are 3,400 units of a tribute that runs about 20,000 a Reckoning, and there is no
   * salvage: a wreck removes the whole build cost from the world (`battlePort.burnHull`, *"A5 with no
   * discount"*).
   *
   * The gate is therefore ordered **world's bills first, then a replacement, then the ship**:
   *
   *   1. **Under the fleet cap**, which is {@link CAST_DOCTRINE}'s own length and not
   *      `MAX_HULLS_PER_PRINCIPAL`.
   *   2. **The engine's own refusal**, through `hullRefusalFor` — the same function `vBuildHull`
   *      runs, and the thing that enforces "not the Commons", "your holding stands here" and "the
   *      goods are unpledged and present". Asking it means this branch cannot want something the
   *      menu would not have offered (scar #5), and it is also why there is no tier test here: A8's
   *      floor is the engine's rule, not a copy of it.
   *   3. **The tribute is still covered after the spend**, read off `levyBlockFor` — location-blind,
   *      exactly as the settlement's own reader is.
   *   4. **Every Charge owed at this berth is still covered**, read off `claimsFor`, which is the
   *      same `ClaimView` the observation publishes.
   *   5. **{@link CAST_ARMS_RESERVE_MULTIPLE}** of the price is standing there in *both* goods, so
   *      the ship this branch buys is one the member could replace.
   *   6. **The anchor's `fuel` is not what pays for the fleet.** A cold anchor takes no arrears,
   *      lapses nothing and slashes no bond — `FUEL_STATEMENT` exists because *"nothing else in the
   *      observation goes red while the income is zero"* — so a hull bought out of
   *      `ANCHOR_FUEL_BY_TIER` is a claim quietly earning nothing, which is the least visible way
   *      this branch could make a member poorer.
   * ══════════════════════════════════════════════════════════════════════════
   */
  private hullFor(
    member: CastMember,
    tick: number,
  ): { readonly verb: string; readonly params: Readonly<Record<string, unknown>> } | null {
    const runtime = this.runtime;
    if (inFreeze(tick) || isSettlementTick(tick)) return null;

    // 1.
    const held = runtime.fleet.readyOrBusyOf(member.principal).length;
    const ship = CAST_DOCTRINE[held];
    if (ship === undefined) return null;

    const system = this.bodyOf(member);
    const price = hullQuote(ship.hull);
    if (price === null) return null;
    const frame = Number(price.frame);
    const fuel = Number(price.fuel);

    // 3. The tribute, first and location-blind, exactly as the sweep reads it.
    const owed = runtime.levyBlockFor(member.principal, tick)?.shortfall_if_unpaid ?? 0;
    if (Number(runtime.levyGoodAvailable(member.principal)) - frame < owed) return null;

    // 4 and 6. The Charge and the anchor's fuel, both read off the published claim view.
    let anchorFuel = 0;
    for (const claim of runtime.claimsFor(member.principal, tick)) {
      if (claim.system !== system) continue;
      if (claim.available_here - frame < claim.owed) return null;
      anchorFuel += claim.fuel_due;
    }

    // 5. A replacement, in both goods, standing where a berth can spend it.
    if (Number(runtime.goodsAt(member.principal, system, HULL_COST_GOODS.frame)) < frame * CAST_ARMS_RESERVE_MULTIPLE) {
      return null;
    }
    if (
      Number(runtime.goodsAt(member.principal, system, HULL_COST_GOODS.fuel)) - fuel * CAST_ARMS_RESERVE_MULTIPLE <
      anchorFuel
    ) {
      return null;
    }

    // 2. Last, so the branch never reports a refusal as a decision.
    if (
      runtime.hullRefusalFor({
        principal: member.principal,
        system,
        hull: ship.hull,
        modules: ship.modules,
        tick,
      }) !== null
    ) {
      return null;
    }

    return {
      verb: 'build',
      params: { kind: 'HULL', system, hull: ship.hull, modules: [...ship.modules] },
    };
  }

  /**
   * Elect on a venture belonging to a principal that granted this member authority, or null.
   *
   * The honest use of a mandate: the grantor owes an elective part, the grantor's stores pay it, and a
   * delegate with treasury authority can state it while the grantor is offline — which is A3's whole
   * promise (going offline costs opportunity, not your record) reached through A6's machinery.
   *
   * **It is also the exact seat betrayal happens from**, and deliberately so. Nothing here checks
   * whether paying is in the grantor's interest, because §16 forbids scripting that: this bot honours
   * what it can afford out of the grantor's purse, an LLM in the same seat may do something else, and
   * the record shows the grant, the accepted warning and the deed either way. No `betray()` verb, no
   * loyalty meter — the same branch produces stewardship and treachery, and only the outcome differs.
   *
   * Draws only on CONTINGENT headroom, because `IN_FULL` is what it states and an `IN_FULL` election is
   * not knowable until the venture resolves. A mandate with no contingent room left is skipped rather
   * than refused, so the bot never generates the per-tick refusal noise AGT-S3 warns about.
   */
  private delegatedElectionFor(
    member: CastMember,
    tick: number,
  ): { readonly verb: string; readonly params: Readonly<Record<string, unknown>> } | null {
    const runtime = this.runtime;
    if (inFreeze(tick) || isSettlementTick(tick)) return null;

    // Canonical order over the mandates held, so one seed walks grantors in one sequence.
    const mandates = runtime.grants
      .forDelegate(member.principal)
      .filter((g) => runtime.grants.isLive(g.id, tick))
      .sort((a, b) => compareIds(a.id, b.id));

    for (const mandate of mandates) {
      const room = runtime.grants.headroom(mandate.id);
      if (room.contingent <= 0) continue;

      const theirs = [...runtime.ventures.forPrincipal(mandate.grantor)]
        .filter((v) => v.creator === mandate.grantor)
        .sort((a, b) => compareIds(a.id, b.id));

      for (const venture of theirs) {
        if (!ELECTABLE_VENTURE_STATES.includes(venture.state)) continue;
        for (const role of venture.roles) {
          if (role.filledByPrincipal === null) continue;
          // A role the grantor holds itself is booked as paid in full (scar #9), and one this member
          // holds would be electing to itself out of the grantor's purse — which `elect` refuses by
          // name. Neither is a mandate's business.
          if (role.filledByPrincipal === mandate.grantor) continue;
          if (role.filledByPrincipal === member.principal) continue;
          // A delegate states an election once per role, so an existing one is not restatable here.
          if (runtime.electionOn(venture.id, role.index) !== undefined) continue;
          const owed = runtime.electiveCeilingOf(venture, role.index);
          if (owed <= 0 || owed > room.contingent) continue;
          return {
            verb: 'elect',
            // No mandate field: the grantor is `venture.creator` and the engine infers the grant from
            // (creator, actor). One spelling for delegation, shared with `create`.
            params: { venture: venture.id, role: role.index, election: IN_FULL },
          };
        }
      }
    }
    return null;
  }

  private electionFor(
    member: CastMember,
    tick: number,
  ): { readonly verb: string; readonly params: Readonly<Record<string, unknown>> } | null {
    const runtime = this.runtime;
    // Refused inside the freeze, so there is nothing to send there (§5.1). Checked here
    // as well as in the handler because a bot generating one refusal per tick is the
    // AGT-S3 noise that buries real defects.
    if (inFreeze(tick) || isSettlementTick(tick)) return null;

    const free = freeStores(runtime.ledger, member.principal);
    const budget = Math.trunc((free * CAST_ELECTIVE_APPETITE_BPS) / BPS_ONE);
    let pledged = 0;
    let first: { readonly venture: string; readonly role: number; readonly want: Election } | null =
      null;

    // Canonical order, so two runs of one seed walk the same roles in the same sequence
    // and therefore run out of budget at the same one.
    const mine = [...runtime.ventures.forPrincipal(member.principal)]
      .filter((v) => v.creator === member.principal)
      .sort((a, b) => compareIds(a.id, b.id));

    for (const venture of mine) {
      if (!ELECTABLE_VENTURE_STATES.includes(venture.state)) continue;
      for (const role of venture.roles) {
        // The payer owes an elective part only where somebody else holds the role: a
        // payment to its own stores is booked as paid in full and can never be a breach
        // (scar #9), and `elect` refuses it by name.
        if (role.filledByPrincipal === null) continue;
        if (role.filledByPrincipal === member.principal) continue;
        const owed = runtime.electiveCeilingOf(venture, role.index);
        if (owed <= 0) continue;

        const room = Math.max(0, budget - pledged);
        const stated = runtime.electionOn(venture.id, role.index);
        if (stated !== undefined) {
          const current = stated === IN_FULL ? owed : Math.min(stated, owed);
          if (current <= room) {
            // Already said, and still affordable. Left exactly as it is: restating a
            // promise you can keep costs an action and changes nothing.
            pledged += current;
            continue;
          }
          // The money went elsewhere since. Restated **down** to what is left, which is
          // a default for the difference and is meant to be.
          if (first === null) first = { venture: venture.id, role: role.index, want: minor(room) };
          pledged += room;
          continue;
        }
        const want: Election = room >= owed ? IN_FULL : minor(room);
        if (first === null) first = { venture: venture.id, role: role.index, want };
        pledged += room >= owed ? owed : room;
      }
    }

    if (first === null) return null;
    return {
      verb: 'elect',
      params: { venture: first.venture, role: first.role, election: first.want },
    };
  }

  /**
   * How this member votes on the Levy allocation, or `null` if it has nothing to cast.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **SELF-INTEREST, COMPUTED — not a coin flip and not a rigged answer.**
   *
   * The bot evaluates each published rule against its *own* share of its
   * constellation's total weight and votes for the one that costs it least. That is a
   * strategy an LLM would find in one wake, it needs no communication, and it produces
   * genuine political conflict: the exposed prefer `INVERSE_EXPOSURE`, the turtles prefer
   * `BY_EXPOSURE`, and the vote is a real fight rather than a formality.
   *
   * The spare nomination is the other half, and it is where a coalition comes from. Each
   * bot nominates its constellation's **poorest non-newcomer** — a figure every member
   * computes identically from public facts, so a coalition forms without a word being
   * exchanged and somebody is spared most nights. That is a *policy*, not a claim about
   * how agents will actually behave: an LLM cast may well nominate itself and never reach
   * the two nominations a spare needs, in which case no principal is spared and the
   * published formula does more of the work. Both are legitimate outcomes and the
   * mechanic has to survive either, which is why `test/levy/ballot.test.ts` asserts both.
   *
   * No `Rng`, no floats. A random vote would be a dice roll where §5.2 wants a choice.
   * ══════════════════════════════════════════════════════════════════════════
   */
  /**
   * Hand an eligible counterparty an office, or null.
   *
   * Reads {@link Runtime.grantCandidates} and adds nothing to it, deliberately: the eligibility rule
   * has one home and the menu an agent sees is built from the same call.
   */
  private grantFor(
    member: CastMember,
    tick: number,
    rng: { chance(n: number, of: number): boolean },
  ): { readonly verb: string; readonly params: Readonly<Record<string, unknown>> } | null {
    // §5's freeze forbids grant SPEND, and a grant that lands inside it would be an action spent on
    // authority nobody can use until the window reopens. Same guard the other branches take.
    if (inFreeze(tick) || isSettlementTick(tick)) return null;
    const appetite = this.options.grantChanceBps ?? DEFAULT_GRANT_CHANCE_BPS;
    if (!rng.chance(appetite, 10_000)) return null;
    const candidate = this.runtime.grantCandidates(member.principal, tick, 1)[0];
    if (candidate === undefined) return null;
    return {
      verb: 'grant',
      params: {
        to: candidate.to,
        template: 'treasury-hand',
        max_direct_loss: candidate.cap,
        max_contingent_liability: candidate.cap,
        expires_tick: candidate.expiresTick,
      },
    };
  }

  private ballotFor(
    member: CastMember,
    tick: number,
  ): { readonly verb: string; readonly params: Readonly<Record<string, unknown>> } | null {
    const runtime = this.runtime;
    const window = ballotWindow(tick);
    if (!window.open) return null;
    if (runtime.levy.hasVoted(window.forReckoning, member.principal)) return null;
    const constellation = constellationOf(runtime.world, member.principal);
    if (constellation === null) return null;
    const roll = rollByConstellation(runtime.world).get(constellation) ?? [];
    if (roll.length === 0) return null;

    // `levySubjectOf` is the engine's own subject reader — the same one the assessment
    // uses. A bot computing its own tenure and EXPOSURE would be a second arithmetic for
    // the figure it is voting about, and the bot would then vote against a world the
    // engine does not have.
    const subjects = [...roll].sort(compareIds).map((principal) => runtime.levySubjectOf(principal, tick));

    const mine = subjects.find((s) => s.principal === member.principal);
    if (mine === undefined) return null;

    // Integer comparison of `myWeight / totalWeight` across rules, done by cross
    // multiplication so no division and no float is involved: a < b iff
    // myA * totalB < myB * totalA.
    let best: LevyRule | null = null;
    let bestMine = 0;
    let bestTotal = 1;
    for (const rule of LEVY_RULES) {
      const myWeight = weightOf(rule, mine);
      const total = subjects.reduce<number>((n, s) => n + weightOf(rule, s), 0);
      if (total <= 0) continue;
      if (best === null || myWeight * bestTotal < bestMine * total) {
        best = rule;
        bestMine = myWeight;
        bestTotal = total;
      }
    }
    if (best === null) return null;

    // ── ★ THE SPARE PICK RANKS BY THE GOOD THE LEVY IS PAYABLE IN ────────────
    //
    // ══════════════════════════════════════════════════════════════════════════
    // **THIS IS `weightOf('BY_STORES')`'S BUG ONE LAYER UP, AND IT IS THE SAME ROOT.** §3's canon
    // entry for STORES is *"assets, inventory, balances"* — one canon word, two concepts — and both
    // call sites picked the unpayable one. The rule sized a goods bill by a cash balance; this
    // *relieved* by a cash balance, so the cast protected from a goods obligation the one principal
    // in its constellation who could most easily discharge it.
    //
    // Measured on `g07`: `p:vex` was spared for **three Reckonings running** while holding 76,565
    // units of the levy good — the most in its constellation — because it had spent its cash on a
    // crossing. The relief is funded by everyone else (`relievedTotal`: "the relief is funded, which
    // is what makes the vote a *redistribution* rather than a discount"), so the constellation was
    // taxing itself to protect its own best-supplied member. Same anti-correlation, same cause.
    //
    // ── AND IT IS STILL AN OPINION, WHICH IS WHY IT STAYS IN THIS FILE ────────
    //
    // §5.2 makes sparing a political choice — *"who is spared is a choice the society makes, on the
    // clock, in public"* — so a constellation is entitled to relieve whoever it likes, including
    // badly. Nothing here is a rule and nothing in the engine enforces it: this is one populator
    // cast's politics, an LLM member may nominate itself or its ally, and `test/levy/ballot.test.ts`
    // asserts both the coalition and the no-coalition outcome because the mechanic has to survive
    // either. What changed is only that the bot's *stated* policy — relieve whoever can least afford
    // this bill — is now computed in the unit the bill is denominated in.
    //
    // A balance change rather than a defect fix, therefore, and it carries its own sweep at 3, 6 and
    // 9 Reckonings rather than riding on the `deliver {payer}` one.
    // ══════════════════════════════════════════════════════════════════════════
    const poorest = subjects
      .filter((s) => !isNewcomer(s) && s.principal !== member.principal)
      .sort((a, b) => a.levyGoodHeld - b.levyGoodHeld || compareIds(a.principal, b.principal))[0];

    return {
      verb: 'vote',
      params: {
        ballot: LEVY_BALLOT,
        rule: best,
        ...(poorest === undefined ? {} : { spare: poorest.principal }),
      },
    };
  }

  /**
   * Pay the Levy, or take one gate toward the place it is payable at.
   *
   * Two branches, in the order a principal would actually do them:
   *
   *   1. **A hand is standing at the delivery place** → `deliver`.
   *   2. **Nothing is there** → walk an idle hand one gate along the cheapest route.
   *
   * Three guards, and each of them exists to stop the bot generating a refusal it could
   * have predicted — a bot hitting one refusal per tick reads in the logs exactly like a
   * rules-surface defect and would bury the real ones (AGT-S3):
   *
   *   - **Nothing owed** → nothing to do.
   *   - **Inside the freeze** → a delivery is refused there (§5.1) and no amount of trying
   *     changes that until the next Reckoning opens.
   *   - **No levy good left** → the Levy is payable only in goods. Phase 0 has no
   *     production behind the starter allotment, so a bot that has spent its stock is
   *     genuinely unable to pay and walking to the place would not help. This is the
   *     branch that produces a **rising `LEVY SHORT`** in a long run, and it is the meter
   *     doing its job.
   *
   * ── WHY THERE IS NO `set_delivery_intent` BRANCH HERE, which is a real finding ──
   *
   * An earlier version set a standing delivery intent while a hand was in transit, which
   * is exactly R19's story and worked. Two problems, neither about the Levy:
   *
   *   1. The intent is due every tick of the journey and refused on each of them
   *      (`IntentBook.ran(intent, false)` — "a convoy intent whose hand is still in
   *      transit"), which the AGT-S3 aggregate reads as a repeated refusal.
   *   2. More seriously, `GET /health`'s `deciding_share_bps` counts `INTENT` as deciding,
   *      so a **heuristic** cast using standing intents makes a bots-only world look
   *      healthy — which is scar #14b, the failure that check exists to catch, walking
   *      back in through a new door.
   *
   * Both are properties of the harness rather than of the mechanic, so the mechanic is
   * proven where it belongs: `test/levy/offline.test.ts` pays a whole assessment from a
   * standing intent with no live action at all (PROP-LV5, R19).
   */
  private levyMove(
    member: CastMember,
    tick: number,
  ): { readonly verb: string; readonly params: Readonly<Record<string, unknown>> } | null {
    const runtime = this.runtime;
    if (inFreeze(tick) || isSettlementTick(tick)) return null;
    const block = runtime.levyBlockFor(member.principal, tick);
    if (block === null || block.shortfall_if_unpaid <= 0) return null;
    if (runtime.levyGoodAvailable(member.principal) <= 0) return null;
    const place = block.deliverable_to;

    const carrier = carrierAt(runtime.world, member.principal, place, tick);
    if (carrier !== null) {
      return {
        verb: 'deliver',
        params: { to: place, hand: carrier.id, amount: block.shortfall_if_unpaid },
      };
    }

    const hands = handsOf(runtime.world, member.principal);
    if (hands.some((h) => h.destination === place)) return null;

    // A hand mustered at a stage this member has answered FIGHT at is not available to walk: the
    // reading is re-taken at resolution, so walking it out un-answers the raid. Same rule the
    // `fill_role` branch applies, same measurement behind it (`gate-c`, `FIGHT/PLUNDERED`).
    const mustered = this.musteredAt(member, tick);
    const idle = hands.filter((h) => h.state === 'IDLE' && (mustered.get(h.location) ?? 0) === 0);
    // The LAST idle hand, mirroring {@link carriageNeeded}: the branches above spend `idle[0]`
    // on roles, so taking from the other end means the hand a member reserved for its tribute
    // is the hand this walks, and the two ends of the list do not fight over one hand.
    const hand = idle[idle.length - 1];
    if (hand === undefined) return null;
    const path = route(runtime.world.map, hand.location, place);
    const next = path?.path[1];
    if (next === undefined) return null;
    // ── THE ENGINE'S RULE, NOT A TIER COMPARISON AGAINST A STALE FIELD ────────
    //
    // This read `tierOf(map, next) !== tierOf(map, member.seat)` and refused on a mismatch,
    // reasoning that the delivery place is always reachable so a route leaving the tier could
    // not be this principal's to take. The reasoning was sound and the premise was false:
    // constellation 1 is mixed, its delivery place is a COMMONS system, and a MARCHES-seated
    // member's only legal route to it leaves the tier on the first hop. {@link mayEnter}
    // carries the measurement — one member in six could never pay a Levy it was fully assessed.
    if (!this.mayEnter(member, next)) return null;
    return { verb: 'move', params: { hand: hand.id, to: next } };
  }

  /**
   * Hand goods over against a Charge, or walk a hand to the ground that owes it, or null.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **WITHOUT THIS BRANCH THE CLAIM BRANCH IS A MACHINE FOR LOSING BONDS.** Measured before it
   * existed: 11 claims taken across four seeds and 8 still live — **three had LAPSED**, each one an
   * arrears published three Reckonings running and 50,000 slashed. A5 has no opt-out, so those
   * three would have stayed on the record forever, and they would have been the *cast's* breaches
   * rather than any agent's decision — the shape A5′ calls worse than a crash.
   *
   * Everything the engine decides is read off `claimsFor`, which is the same `ClaimView` the
   * observation publishes: `owed` (what settlement will bill), `available_here` (unpledged goods
   * standing at the claimed system — location-strict, because the Charge is), and `hand_here`
   * (presence, the field the acceptance test found missing when the affordance offered a delivery
   * the engine refused). Nothing here recomputes any of the three.
   *
   * `hand_here` is why the walk exists at all: `graduate` moves a HOLDING and leaves the hands where
   * they were, so a member that has just claimed has its body and its stores on the ground and every
   * hand somewhere else. That is the ordinary state of a new claimant, not an edge case.
   * ══════════════════════════════════════════════════════════════════════════
   */
  private chargeMove(
    member: CastMember,
    tick: number,
  ): { readonly verb: string; readonly params: Readonly<Record<string, unknown>> } | null {
    const runtime = this.runtime;
    if (inFreeze(tick) || isSettlementTick(tick)) return null;
    // `claimsFor` is already in canonical system order, so one seed walks one sequence.
    for (const claim of runtime.claimsFor(member.principal, tick)) {
      if (claim.owed <= 0) continue;
      // Goods must already be standing THERE. Nothing in this build moves goods between systems, so
      // a claimant with an empty warehouse on its own ground cannot fix it this tick and asking
      // would be a refusal it could have predicted (AGT-S3).
      if (claim.available_here <= 0) continue;
      if (claim.hand_here) {
        return {
          verb: 'deliver',
          params: {
            obligation: 'CHARGE',
            system: claim.system,
            // Partial payment counts and reduces what is owed, so hand over what is there rather
            // than waiting to clear the whole bill — waiting is how a claim reaches its third miss
            // holding goods.
            amount: Math.min(claim.owed, claim.available_here),
          },
        };
      }
      const hands = handsOf(runtime.world, member.principal);
      if (hands.some((h) => h.destination === claim.system)) continue;
      // Mustered hands are not available to walk — see {@link musteredAt}.
      const mustered = this.musteredAt(member, tick);
      const idle = hands.filter((h) => h.state === 'IDLE' && (mustered.get(h.location) ?? 0) === 0);
      // The last idle hand, as `levyMove` takes: the role branches spend `idle[0]`.
      const hand = idle[idle.length - 1];
      if (hand === undefined) continue;
      const next = route(runtime.world.map, hand.location, claim.system)?.path[1];
      if (next === undefined) continue;
      if (!this.mayEnter(member, next)) continue;
      return { verb: 'move', params: { hand: hand.id, to: next } };
    }
    return null;
  }

  /**
   * ★ Carry a co-member's **escrowable** share with a hand you already have there, or null.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THE BRANCH THAT MAKES `paidOther` NON-ZERO FOR THE FIRST TIME.** §5.2 escrows 70% of every
   * assessment and permits that share to be carried by another principal's hand; `deliver {payer}`
   * has implemented it since the Levy landed; **no cast has ever selected it and no affordance ever
   * offered it**, so `paidOther` was 0 in every world this repo had run. An affordance no cast ever
   * selects is the second of the three depths the lesson shows up at, and the four empty panels are
   * the precedent — so offering the verb without a bot that uses it would only move the defect one
   * layer along.
   *
   * What it is aimed at, with the numbers: at nine Reckonings `levyShort` is 202,540 across eight
   * seeds, and on `g01` the cause is not production in aggregate. Three members hold a WORKS on one
   * MARCHES system at occupancy 3, earning `floor(110/3) x 288 = 10,368` a Reckoning against a
   * 23,900 assessment, and `orrin`, `sable` and `varrow` sit on **360,000 units of the same good in
   * the same constellation.** The goods exist. They are in the wrong warehouse.
   *
   * ## Why it sits HERE — after `levyMove` and after `chargeMove`
   *
   * **Settle your own obligations before you spend goods on anyone else's**, which is the same
   * ordering ethic `delegatedElectionFor` states for a mandate and the same one `chargeMove`'s
   * position argues from. Three consequences, and each is why a different position would be wrong:
   *
   *   - **Below `levyMove`**: a member that carried a neighbour's tribute while its own line was
   *     red would produce a shortfall on its own record and call it generosity. `levyMove` returns
   *     `null` the moment nothing is owed, so a member that has paid gets here in the same tick.
   *   - **Below `chargeMove`**: the Charge and the Levy want the *same good*, and three missed
   *     Charges lapse a claim and slash `CLAIM_BOND_MINOR`. A carry is the least consequential of
   *     the three claims on a unit of `ration`, so it goes last of the three.
   *   - **Above the aimless walk and the fleet branches**: this is a delivery to a place a hand is
   *     already standing on, so it costs one action and no repositioning at all — where the
   *     branches below it spend a hand's position for ticks. A move that uses a hand where it
   *     stands should never lose to one that relocates it.
   *
   * ## No walk branch, and that is a measurement rather than an omission
   *
   * `levyMove` and `chargeMove` both walk a hand toward the obligation when none is there. This
   * does not, because **a member that has paid its own tribute already has a hand at the delivery
   * place** — that is what paying it required — and the place is shared by the whole constellation
   * (`levy/place.ts`: one named place per constellation). So the carrier's hand is where it needs
   * to be as a *consequence* of its own compliance, and walking a hand across the map to fund
   * somebody else's bill is a much larger claim on the cast's behaviour than the residue justifies.
   * If a sweep shows carries failing for want of presence, that is the branch to add next, and it
   * should be added on that evidence.
   *
   * The reserve is {@link CAST_CARRY_RESERVE_RECKONINGS} and the argument for the number is at its
   * declaration. Everything else here is read off `Runtime.levyCarryQuotes` — the same rows the
   * affordance offers, in the same order — so the bot cannot play a rule the menu does not show,
   * and neither can compute an amount the other would not.
   * ══════════════════════════════════════════════════════════════════════════
   */
  private carryFor(
    member: CastMember,
    tick: number,
    carriedThisTick: ReadonlySet<PrincipalId>,
  ): { readonly verb: string; readonly params: Readonly<Record<string, unknown>> } | null {
    const runtime = this.runtime;
    // A delivery is refused inside the freeze (§5.1) and no amount of trying changes that until
    // the next Reckoning opens — the same guard every other obligation branch takes, and for the
    // same AGT-S3 reason: a predictable refusal per tick buries the unpredictable ones.
    if (inFreeze(tick) || isSettlementTick(tick)) return null;

    // The forward-looking reserve, in the good the Levy is paid in. `max` of the two figures — see
    // CAST_CARRY_RESERVE_RECKONINGS for why neither alone is enough.
    const mine = runtime.levyBlockFor(member.principal, tick);
    const perReckoning = Math.max(mine?.my_assessment ?? 0, LEVY_DUTY_PER_PRINCIPAL);
    const reserve = perReckoning * CAST_CARRY_RESERVE_RECKONINGS;

    // `levyCarryQuotes` has already dropped every row the verb would refuse and every row with
    // nothing to carry — the presence gate included, since a hand not standing at the delivery
    // place reads as a `fault`. No second copy of that rule here, which is what keeps the bot and
    // the menu from disagreeing about what is possible.
    for (const carry of runtime.levyCarryQuotes(member.principal, tick)) {
      // A cast-mate is already carrying this one and the escrowable bucket only takes filling
      // once — see {@link HeuristicCast.decide} for the measurement and why this belongs here
      // rather than in the engine.
      if (carriedThisTick.has(carry.payer)) continue;
      // `surplus` is already net of this member's OUTSTANDING duty (`carryableOf`), so subtracting
      // the reserve from it is the forward-looking half and nothing is counted twice.
      const give = Math.min(carry.payable, carry.surplus - reserve);
      if (give <= 0) continue;
      return {
        verb: 'deliver',
        params: { obligation: 'LEVY', payer: carry.payer, amount: give },
      };
    }
    return null;
  }

  /**
   * Walk one idle hand a gate closer to a berth where this member's hulls are waiting, or null.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THE LOGISTICS HALF OF A FLEET, AND WITHOUT IT THE OTHER HALF IS A MONUMENT.** `combat/index.ts`
   * states the constraint this branch exists to satisfy: *"`MAX_HULLS_PER_PRINCIPAL` is 6 and a
   * principal has three hands, and `engage` requires an IDLE hand at the stage to crew each hull. So
   * the real cap on a fleet one principal can field is three."* That is a cap on hands **at the
   * stage**, not hands owned — and nothing in this file moved a hand toward a warship until now.
   *
   * `graduate` is why: it moves a HOLDING and leaves every hand where it was, so a member that
   * crossed twice to reach the Frontier has its body, its stores, its claim and its whole fleet in one
   * constellation and its hands in another. `chargeMove` exists for the same reason one obligation
   * down.
   *
   * ## Three guards, each stopping a refusal the branch could have predicted (AGT-S3)
   *
   *   - **Only while the berth is short of crew.** One hand per hull, so a berth with as many hands
   *     standing on it as hulls needs nothing, and a member with three hulls and three hands home
   *     stops walking. `COMMITTED` hands count as present: a hand filling a role at the berth is a
   *     hand that will be idle again there, and walking a fourth one in would be permanent churn.
   *   - **Never the hand a world obligation is standing on.** A hand on the Levy's delivery place or
   *     on a claim is stationed by the paragraph above this one in `decideOne`, and pulling it away
   *     for a warship would reopen the tug-of-war that cost the world a fifth of its ventures.
   *   - **Never into a tier this principal's hands may not enter**, through {@link mayEnter} — the
   *     engine's own rule, read live, for the reason that guard had to be rewritten once already.
   * ══════════════════════════════════════════════════════════════════════════
   */
  private crewMove(
    member: CastMember,
    tick: number,
  ): { readonly verb: string; readonly params: Readonly<Record<string, unknown>> } | null {
    const runtime = this.runtime;
    if (inFreeze(tick) || isSettlementTick(tick)) return null;
    const hulls = runtime.fleet.readyOrBusyOf(member.principal);
    if (hulls.length === 0) return null;

    // Where a hand is genuinely needed elsewhere. The same set the aimless walk treats as stationed.
    const owing = new Set<SystemId>();
    const owedAt = runtime.levyBlockFor(member.principal, tick);
    if (owedAt !== null) owing.add(owedAt.deliverable_to);
    for (const claim of runtime.sovereignty.claimsOf(member.principal)) owing.add(claim.system);

    const hands = handsOf(runtime.world, member.principal);
    // Canonical order over the berths, so one seed walks one sequence.
    const berths = [...new Set(hulls.map((hull) => hull.location))].sort(compareIds);
    for (const berth of berths) {
      const want = hulls.filter((hull) => hull.location === berth).length;
      const here = hands.filter(
        (hand) => hand.location === berth && (hand.state === 'IDLE' || hand.state === 'COMMITTED'),
      ).length;
      const coming = hands.filter((hand) => hand.destination === berth).length;
      if (here + coming >= want) continue;
      for (const hand of hands) {
        if (hand.state !== 'IDLE' || hand.location === berth) continue;
        // A claim is a berth too, so a hand standing on one is already where it is needed — with the
        // exception of the berth itself, which the loop above has just found short of crew.
        if (owing.has(hand.location)) continue;
        const next = route(runtime.world.map, hand.location, berth)?.path[1];
        if (next === undefined) continue;
        if (!this.mayEnter(member, next)) continue;
        return { verb: 'move', params: { hand: hand.id, to: next } };
      }
    }
    return null;
  }

  /**
   * ★ What this member stakes on one open role, in MINOR. Zero is a legal and frequent answer.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **A7's STAKED HALF, FIRST EXERCISED HERE.** §7.3 escrows a role stake at fill time so that
   * *"filling a slot is not a free option"*, and its next sentence is what makes it a risk rather
   * than a deposit: *"abandoning a filled slot forfeits the stake to the other parties, not to a
   * sink."* Every principal in every world this repo had run passed `stake: 0`, so EXPOSURE — §3's
   * *Σ open `max_direct_loss`* — was identically zero and three of the Levy's four allocation rules
   * handed everybody one flat weight (`D30`). This branch is what makes them differ.
   *
   * ── ★ WHY THE STAKE IS PRICED OFF THE **ROLE**, NOT OFF THE MEMBER'S PURSE ──
   *
   * **This was measured, the wealth-priced version was written first, and it cost the world a
   * quarter of its ventures.** §7.3 resolves a contested slot *"by the initiator's stated preference
   * order or pro-rata by stake"* — so the stake is a **bid**, and `canonicalRequestOrder` ranks it
   * above `principal_id`. Price the bid as a share of free STORES and the contest becomes a **wealth
   * ranking**: the richest member in the world wins every contested slot, on every tick, forever.
   *
   * That is a systematic loss rather than a reshuffle, and the mechanism is this file's own decision
   * order. `canPromiseOneMore` means only a member with a **large free balance** can open a venture at
   * all (measured: `elective` per venture 5,251 against a mean appetite of 8,539, so the marginal
   * member sits a few hundred MINOR from the gate). `fill_role` sits **above** `create` here and both
   * need an idle hand. So a wealth-ranked contest moves slots from the members that *cannot* create
   * onto the members that are the only ones that *can*, and each slot won costs a hand for a whole
   * Reckoning — a create the world does not get. Measured on `g01`, 3 Reckonings, 8 members:
   * **ventures 269 → 209** at 10 bps of free stores and **269 → 180** at 100 bps, with the stake
   * *never locked at all* landing at **160** (so the lock is not the cause; the ordering is).
   * Removing only the stake term from `canonicalRequestOrder` restored **269 exactly, and every
   * counter with it** — which is what identifies the ordering as the whole of it.
   *
   * Priced off the role, two bidders for one slot compute the **same** number and the tie falls
   * through to `principal_id` exactly as it did when every stake was zero. The bid discriminates only
   * where a member genuinely cannot cover it, which is §7.3's rule doing what it is for — capital
   * buys the slot from the party that has it — instead of a standing wealth order.
   *
   * ## The gate, in the order it is asked, and every clause is a *reason not to risk it*
   *
   *   1. **A role worth nothing is worth nothing to hold.** The value is
   *      `escrowed + elective`, which is the same figure the `fill_role` affordance publishes as its
   *      `weight`, so the bot bids off the number the menu shows (scar #5).
   *   2. **★ THE BOOTSTRAP DOOR STAYS OPEN, AND THIS IS THE CLAUSE THE UNIT CONFUSION LIVES IN.**
   *      A tribute is payable *"only in located goods"* (§5.2), so a **currency** lock cannot make a
   *      goods bill short — comparing the two figures directly would be `weightOf('BY_STORES')`'s own
   *      bug arriving through cast policy, and this file has now been caught by that family four
   *      times. The real coupling runs the other way and it is exact:
   *      `WORKS_GOODS_IN_CURRENCY_MINOR` makes **currency the only route back into the goods
   *      economy** for a drained principal, which is the whole of `RULES_VERSION` 14 and the reason
   *      A15 is not inverted today. So a member that cannot cover its own outstanding tribute **in
   *      goods** keeps its currency free, because that currency is the door back in. Both sides of
   *      the comparison are `ration`; what it decides is denominated in MINOR. Written out so the
   *      next reader can see the units were checked rather than assumed.
   *   3. **A member with no WORKS keeps the door's whole price free.** `worksQuote(...).totalMinor`
   *      is the engine's own figure — 85,000 through the currency door — and it is the difference
   *      between a member with an income and a member without one. Locking capital in front of it
   *      would trade the tribute's only source for a tie-break on one slot.
   *   4. **Never more than it can bear**, which is the clause that makes this a risk decision rather
   *      than a price list: the bid is capped at what is left after the reserve, so a member with
   *      nothing spare bids nothing and takes the slot at `stake: 0` — legal, and last in a contest.
   *   5. **Never out of money already promised** — {@link canSpendWithoutBreakingAPromise},
   *      `claimFor` clause 6 verbatim and for its reason: a stake is *locked*, not spent, but it
   *      leaves the **free** balance and `CAST_ELECTIVE_APPETITE_BPS` is a share of exactly that. A
   *      capital commitment funded out of an unsecured promise becomes a `DECLINED` default on the
   *      public record, and a default this cast authored is worth less than nothing.
   *
   * Clauses 2–5 are why this is not a constant, and they are why EXPOSURE comes out **spread** rather
   * than uniform: at any tick some members hold a WORKS and some do not, some are short of the good
   * they owe and some are not, each holds a different number of roles of different value, and each has
   * said a different amount out loud. A rule that allocates by EXPOSURE has something to allocate by
   * only because those four facts differ.
   * ══════════════════════════════════════════════════════════════════════════
   */
  private stakeFor(member: CastMember, tick: number, slot: { readonly venture: string; readonly role: number }): number {
    const runtime = this.runtime;
    const venture = runtime.ventures.get(slot.venture as VentureId);
    if (venture === undefined) return 0;
    const terms = venture.roles[slot.role]?.terms;
    if (terms === undefined) return 0;
    // 1. The bid: a share of what this slot is worth, which is what every bidder for it sees.
    const bid = Math.trunc(((terms.escrowed + terms.elective) * CAST_STAKE_BPS) / BPS_ONE);
    if (bid <= 0) return 0;

    // 2. Short of the good the world is owed → the currency is the way back in, so it stays free.
    //    Goods against goods; see the note above about why this is not the other comparison.
    const owed = runtime.levyBlockFor(member.principal, tick)?.shortfall_if_unpaid ?? 0;
    if (owed > 0 && Number(runtime.levyGoodAvailable(member.principal)) < owed) return 0;

    // 3. No WORKS yet → hold the door's published price, whichever route it would take.
    const reserve =
      runtime.works.ofPrincipal(member.principal).length === 0
        ? runtime.worksQuote(member.principal, this.bodyOf(member)).totalMinor
        : 0;
    // 4. And never more than is left over after it.
    const stake = Math.min(bid, freeStores(runtime.ledger, member.principal) - reserve);
    if (stake <= 0) return 0;
    // 5. And never out of what it has already said it would pay.
    if (!this.canSpendWithoutBreakingAPromise(member, stake)) return 0;
    return stake;
  }

  /**
   * The first open slot this member is eligible for.
   *
   * Eligibility, not preference: one principal fills at most one role in a venture
   * (PROP-V6), and a bot that requested a second role in a venture it already holds
   * would generate a refusal every tick forever — which reads in the logs exactly
   * like a rules-surface defect (AGT-S3).
   */
  private openSlotFor(
    member: CastMember,
    tick: number,
  ): { readonly venture: string; readonly role: number } | null {
    for (const venture of this.runtime.ventures.live()) {
      if (venture.state !== 'FORMING') continue;
      if (tick > venture.windowClosesTick) continue;
      if (venture.creator === member.principal) continue;
      if (roleOfPrincipal(venture, member.principal) !== null) continue;
      // A hostile venture in the Commons can never be filled, so do not try.
      //
      // ── AND THIS ONE STAYS ON `member.seat`, WHICH IS THE OPPOSITE OF {@link bodyOf}'s RULE ──
      //
      // Every other reader of `member.seat` was answering a question about where the member IS and
      // was wrong after a crossing. This one is not: `vFillRole` does **not** require a filler to be
      // standing at the stage, so the tier here is a cast *policy* — "do not offer to work a
      // venture the floor would refuse" — and not the engine's rule. Repointing it at the body was
      // measured and cost a quarter of the world's ventures: Marches-staged ventures are scarce, so
      // a graduated member stopped finding any work at all, while the Commons roles it had been
      // filling perfectly legally went unfilled. §15.6's clause is that heuristics fill slots so
      // ventures resolve, and that is worth more than a tidier field read.
      if (tierOf(this.runtime.world.map, venture.stage) !== tierOf(this.runtime.world.map, member.seat)) {
        continue;
      }
      const open = openIndices(venture);
      const first = open[0];
      if (first === undefined) continue;
      return { venture: venture.id, role: first };
    }
    return null;
  }
}
