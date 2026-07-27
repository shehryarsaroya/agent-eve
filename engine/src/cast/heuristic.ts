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

import { Rng } from '../core/rng.js';
import { inFreeze, isSettlementTick, TICKS_PER_RECKONING } from '../core/time.js';
import type { PrincipalId, SystemId, VentureKind } from '../core/types.js';
import { BPS_ONE, minor } from '../core/units.js';
import { compareIds } from '../ledger/index.js';
import {
  LEVY_BALLOT,
  LEVY_RULES,
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
import { REFINE_IN_QTY, YIELD_PER_TICK } from '../works/params.js';
import {
  handsOf,
  holdingOccupancy,
  holdingOf,
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
    for (const member of this.members) {
      const rng = Rng.fromSeed(`${seed}:cast:${member.principal}:${String(tick)}`);
      const action = this.decideOne(member, tick, rng, out.length);
      if (action !== null) out.push(action);
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
      const hand = idle[0];
      if (slot !== null && hand !== undefined) {
        return {
          ...base,
          verb: 'fill_role',
          params: { venture: slot.venture, role: slot.role, hand: hand.id, stake: 0 },
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
    if (runtime.refinableAt(member.principal, system) < want) return null;
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
    if (quote.sharePerTick * TICKS_PER_RECKONING < bill * CAST_CLAIM_COVER_MULTIPLE) return null;

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
    return { verb: 'build', params: { kind: 'ANCHOR', system } };
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

    const poorest = subjects
      .filter((s) => !isNewcomer(s) && s.principal !== member.principal)
      .sort((a, b) => a.freeStores - b.freeStores || compareIds(a.principal, b.principal))[0];

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

    const idle = hands.filter((h) => h.state === 'IDLE');
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
      const idle = hands.filter((h) => h.state === 'IDLE');
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
