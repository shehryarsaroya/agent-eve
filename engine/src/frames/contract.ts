import type { HallOfFameRow, PlaceName, Ruin } from './memory.js';
import type { CoverArc, CoverChain, FrontBand } from '../risk/lines.js';
/**
 * The frame contract — the interface between the world and the show.
 *
 * TESTING.md §1.1 hazard 3: the rundown's 6–9 minutes is *human* time and must
 * not compress with the tick. The consequence is architectural, not cosmetic:
 * **the renderer consumes a settled Reckoning from the ledger, never the live
 * sim.** `sim_speed` and `broadcast_speed` are independent, which is the only
 * reason the whole watchability suite can run against worlds generated overnight
 * at 30×. So this file is a *read model*, and nothing here may be computed from
 * live mutable state.
 *
 * A9 holds by construction (SPEC §15.5): a frame is built from one
 * `public_facts(tick)` object and the renderer has **no database handle**. A
 * viewer therefore cannot see a live fact that a non-party agent's own `observe`
 * would not — which matters because agents read the public feed, so any viewer
 * privilege is immediately an agent exploit.
 *
 * The legibility budgets below are §17 parameters and are asserted, not
 * suggested. A constellation renders ~70 handles and a viewer reads none of
 * them; the honest maximum is about seven named entities per frame. Hundreds of
 * agents is fine. *Naming* hundreds is not.
 */

import type {
  CampaignState,
  ClaimState,
  GoodId,
  GrantId,
  HandId,
  Handle,
  HoldingId,
  PrincipalId,
  RaidState,
  SealVerdict,
  ConstellationId,
  SystemId,
  VentureId,
  VentureState,
  ZoneTier,
} from '../core/types.js';
import type { Minor, Qty } from '../core/units.js';
import { TICKS_PER_RECKONING } from '../core/time.js';

/** §17: labels rendered per frame. The legible maximum. */
export const MAX_LABELS_PER_FRAME = 7;
/** §17: docket cards. The default view. */
export const MAX_DOCKET_CARDS = 7;
/** §17: rundown segments. A broadcast, not a batch. */
export const MAX_RUNDOWN_SEGMENTS = 12;
/** §17: authority lines drawn per frame. Convergence is the signature; a hairball is not. */
export const MAX_AUTHORITY_LINES = 12;
/** §17: raid lines drawn per frame. A countdown a viewer can follow, not a weather map. */
export const MAX_RAID_LINES = 6;
/** §17: claim tints drawn per frame. A map of who owes what, not a heatmap. */
export const MAX_FRAME_CLAIM_LINES = 12;

/**
 * ★ THE SAP's cap (A13). Six, and it is a **floor under the live wars** rather than a truncation.
 *
 * Every other line budget here picks the important members of a set larger than a viewer can read.
 * This one is deliberately above `MAX_LIVE_CAMPAIGNS` (4), because a campaign is the largest object
 * on the map and a dropped one would be a war in progress the map does not show — while the two
 * spare slots let a just-ended campaign's obituary stay on screen for a Reckoning.
 */
export const MAX_FRAME_SAP_LINES = 6;

/**
 * Works marks a frame may draw. *(calibrate)*
 *
 * Larger than the claim budget because a WORKS is cheaper than a claim and there will be more
 * of them — but still a legend a viewer reads rather than a heatmap. Overflow drops the LEAST
 * crowded, so the contested seams survive the cut.
 */
export const MAX_FRAME_WORKS_LINES = 16;

/** Syndicate lines a frame may draw. Fewer than works marks: an org is a bigger object. *(calibrate)* */
export const MAX_FRAME_SYNDICATE_LINES = 8;

/**
 * Ruins a frame may draw. **THE RUIN's budget.** *(calibrate)*
 *
 * Half the works budget, and the ratio is the claim it makes: a map should be able to show that
 * rather more is standing than has fallen, and a world where ruins outnumbered works by two to one
 * would be a world whose Levy had already failed. Eight is also two whole Reckonings of the maximum
 * razing rate the raid clock can produce (`RAID_SPAWN_PHASES` is three a Reckoning, and only a rout
 * razes), so a viewer arriving at any Reckoning sees at least the last two Reckonings of losses.
 *
 * Overflow drops the OLDEST — see `Frame.ruins`. That direction is not a preference; a cap that drops
 * the newest hides exactly the event the field exists to show.
 */
export const MAX_FRAME_RUINS = 8;

/**
 * Market prints a frame may draw. *(calibrate)*
 *
 * One line per `(venue, good)` that traded, and `(venue, good)` is the only key the book
 * matches on — so this is the count of *places a price exists*. Sized like the works budget
 * because it is the same kind of object: a small number of marks on a map, ranked so that
 * overflow drops the least interesting. Overflow keeps the widest premium, because the gap
 * between two places is what makes a price a story rather than a number.
 */
export const MAX_FRAME_MARKET_LINES = 16;

/**
 * Battle lines a frame may draw. Equal to `MAX_LIVE_ENGAGEMENTS` + the ones that closed this
 * Reckoning, and deliberately the **smallest** of every line budget here.
 *
 * A battle is the most detailed object on this frame — up to twelve formation bars inside one line —
 * and §14.1's hard rule is *"≤7 labels per frame"*. Four battles is already more than a viewer can
 * follow; the point of the budget is that a battle gets the screen, not that many do.
 */
export const MAX_FRAME_BATTLE_LINES = 4;
/**
 * A13's Phase 3 budgets. §17: **≤7 labels a frame**, so these are what a viewer can actually follow.
 *
 * `frontBands` is the largest of the three because a band is *one* label — the front's name — drawn
 * across many cells, exactly as the map is one picture over thirty systems. A chain is the opposite:
 * every link is a principal's name, so six is already at the ceiling.
 */
export const MAX_FRAME_FRONT_BANDS = 12;
export const MAX_FRAME_COVER_ARCS = 8;
export const MAX_FRAME_COVER_CHAINS = 4;

/**
 * ★ THE VERGE's cap (A13, §16.12 #1) — and it is the one budget here that is **not** a selection.
 *
 * Every other line budget picks the readable members of a set larger than a viewer can follow.
 * A border cannot be sampled: drop one system and the fence has a hole in it, and a hole reads as
 * *"nobody reaches here"* — which is a specific, false, and load-bearing claim, since bare ground is
 * exactly where §16.12 #1 says a small holder can live. So this is a **ceiling on the map**, checked
 * against `LAUNCH_SYSTEM_BOUNDS.max`, and the day the region grows past it the assertion fires and
 * the renderer's aggregation gets designed rather than discovered.
 */
export const MAX_FRAME_SWAY_LINES = 32;

/**
 * Formation bars one battle line may carry. Both sides, both caps.
 *
 * `MAX_FORMATIONS_PER_SIDE` is 6, so twelve is the honest ceiling. Not independently tunable: a
 * truncated battle draws a line with a side missing, which is worse than drawing none — a viewer
 * would read a one-sided massacre where there was a fight.
 */
export const MAX_BATTLE_FORMATIONS = 12;
/** §14.3: seconds per segment. Human time — never scaled by TICK_SECONDS. */
export const SEGMENT_SECONDS = { min: 30, max: 45 } as const;

/**
 * The three meters (§14.2). v2.0's single "total value in the open" meter fell
 * identically whether a promise was kept or broken, conflated escrow with the
 * elective tail, and could be topped by self-dealing at zero risk.
 */
/** One principal's public factual vectors, for the directory. */
export interface StandingRow {
  readonly principal: PrincipalId;
  readonly handle: string;
  readonly electiveHonoured: number;
  readonly electiveHonouredValue: Minor;
  readonly defaults: number;
  readonly contradictedSeals: number;
  readonly distinctCounterparties: number;
  readonly lastDefaultTick: number | null;
}

export interface Meters {
  /**
   * The headline, because it is the one number **no single agent can lower**,
   * and it *rises when everyone hides* — which is exactly when the screen needs
   * to look tense. Decomposable to whose tribute line is red.
   */
  readonly levyShort: Minor;
  /**
   * Value riding on nothing but someone's word. Inflatable only by genuinely
   * trusting someone: escrowed parts contribute zero by construction.
   */
  readonly onAPromise: Minor;
  /** The scoreboard. Moves only on the event the whole game is about. */
  readonly kept: number;
  readonly broken: number;
  /**
   * **Raw yield nobody has converted yet** — the production chain's tension, in one number.
   *
   * §10's chain is: a WORKS yields `ore`, `refine` turns it into the good every obligation is payable
   * in, and ore itself settles nothing. So this is *wealth that cannot pay a debt* — and it rises
   * exactly when the world is extracting hard and converting slowly, which is the moment before a
   * Reckoning where somebody is about to default while visibly rich.
   *
   * On screen it is the counterweight to `levyShort`: shortfall climbing while this climbs too is a
   * world that has the goods and has not made them payable, which is a different story from a world
   * that is simply poor — and the two look identical without this number.
   *
   * A13: every mechanic needs a named pixel signature, and a conversion step is invisible unless the
   * un-converted stock is published.
   */
  readonly unrefined: Qty;
}

/** A named character on screen. Never more than MAX_LABELS_PER_FRAME of these. */
export interface CastChip {
  readonly principal: PrincipalId;
  readonly handle: Handle;
  /** One clause a stranger can read in three seconds. */
  readonly line: string;
  /** Model family, for the one-keystroke model-map recolour (§14.5). */
  readonly modelBadge: string | null;
}

/**
 * The Levy's pixel signature (§5.2) — the highest-leverage single edit in the
 * design. Every principal on the map every day, turtling made visible rather
 * than merely taxed, continuous off-peak motion from a source that cannot go
 * quiet, and a forming cartel visible as convergence on a handful of hands.
 */
export type TributeLineState = 'DASHED' | 'SOLID' | 'RED' | 'REVERSING';

export interface TributeLine {
  readonly principal: PrincipalId;
  readonly from: HoldingId;
  readonly to: SystemId;
  /** Thickness is proportional to the amount owed. */
  readonly owed: Minor;
  /** DASHED no hand assigned · SOLID hand en route · RED unpaid at freeze · REVERSING seizure. */
  readonly state: TributeLineState;
}

/**
 * The A6 pixel signature (SPEC §8, §14): standing authority as a directed line from a
 * grantor to its delegate. Thickness ∝ the authority handed over (max_direct_loss), and
 * the state shows how much of that worst case the delegate has actually drawn — "an
 * offline agent is exposed, and the audience can see by how much" (§8.1). Authority
 * converging on a handful of delegates is a forming power bloc, watchable before it acts —
 * the same "convergence on a few hands" the Levy's tribute lines render for tribute.
 */
// Its own vocabulary (SPEC §3, one word per concept): `IDLE` is a hand's physical state
// and `SPENT` is an intent's, so an authority line — a different concept — gets its own.
//
// ── ★ `EXPIRED` IS THE FIFTH, AND IT IS §14's REQUIREMENT RATHER THAN A NICETY ──
//
// The nightly frame filtered to grants LIVE at the settlement, so a grant drawn on at tick 120 and
// expiring at tick 250 was gone by the time the Reckoning published the *deed* it authorised.
// Measured: on seed `g01`, **38 of the 41 grants ever drawn on had expired before any frame was
// written**. §14's strip needs *"the grant, the accepted warning, the seal, the deed and the
// negotiation text on one strip"* — so a `RundownSegment.grant` naming a grant no authority line on
// the same frame resolves is a **dangling pointer**, and the marquee artifact of this design cannot be
// assembled from a published frame. `EXPIRED` is what lets the referential integrity hold.
//
// It is a fifth state and not a reuse of `EXHAUSTED`, which means *"no headroom left on either
// limit"* — a grant with money still on it whose term simply ran out is a different fact, and
// conflating them would tell a viewer a delegate had spent everything when it had spent nothing.
// `OrderState` also has `EXPIRED`, and the vocabulary guard's `SHARED_MEMBERS` entry argues why they
// are one concept: a term that ran out with nothing owed either way, which is `ClaimState +
// CoverState.LAPSED`'s argument exactly.
export type AuthorityLineState = 'UNUSED' | 'DRAWN' | 'EXHAUSTED' | 'REVOKED' | 'EXPIRED';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * **BOTH LIMITS RENDER, BECAUSE ONLY ONE OF THEM USED TO.**
 *
 * A grant carries two worst cases (§8.1 #2) and this line drew only the first. A
 * delegate that opened un-escrowable top-yield ventures in its grantor's name moved no
 * escrow at all, so `spent` stayed 0 and the line rendered **`UNUSED`** — an
 * innocent-looking pixel signature over an unbounded contingent liability, and the
 * A13 half of the A6 defect. Thickness came off `max_direct_loss` alone too, so a grant
 * that authorised nothing direct and everything contingent drew as a hairline and sorted
 * last into the twelve-line budget: the largest exposure on the map, cut first.
 *
 * Four fields rather than two, and the state reads both.
 * ══════════════════════════════════════════════════════════════════════════
 */
export interface AuthorityLine {
  /**
   * ★ **THE JOIN §14 REQUIRES, AND THE FRAME CARRIED NO KEY TO MAKE IT ON.**
   *
   * ══════════════════════════════════════════════════════════════════════════
   * §14's receipt reel is *"the grant, the accepted warning, the seal, the deed and the negotiation
   * text on one strip"*. Four of those five reached the frame. The **grant** did not — this line was
   * keyed `(grantor, delegate)` and `RundownSegment` named a venture, so a renderer holding a
   * `SNAPPED_BLACK` segment had no key on which to find the authority that permitted the deed. Two
   * pairs may hold several grants at once and a pair may hold none by the time a default settles, so
   * `(grantor, delegate)` is neither unique nor sufficient. The strip could not be assembled from a
   * published frame at all, which by A13 means the signature artifact of this design does not exist.
   *
   * **It publishes nothing new.** `grant.issued` is emitted `PUBLIC` at `publicAt: tick` carrying
   * `payload.grant` — the id itself — and §11.2 D9a puts a grant's LIMITS and parties at `PUBLIC`
   * (the *verbs*, selectors and approval chain are what stays `PARTIES`, and none of those is here).
   * `venture.formed` carries the same id in its `grant_id` column on a `PUBLIC` row, which is the
   * argument {@link boundVentures} is already admitted on one field down. So this is the id both
   * ends of the join already publish, finally written on the same artifact.
   * ══════════════════════════════════════════════════════════════════════════
   */
  readonly grant: GrantId;
  readonly grantor: PrincipalId;
  readonly delegate: PrincipalId;
  /** Thickness ∝ the authority granted. This half is its max_direct_loss. */
  readonly granted: Minor;
  /** How much of the direct worst case the delegate has drawn. */
  readonly spent: Minor;
  /** The other half of the authority granted: its max_contingent_liability. */
  readonly grantedContingent: Minor;
  /**
   * How much of the contingent worst case the delegate has drawn — value the GRANTOR is
   * asked for at settlement and defaults on by staying silent. Visible exposure that
   * moves no coin until the Reckoning, which is exactly why it has to be on screen.
   */
  readonly spentContingent: Minor;
  /**
   * **How many ventures this delegate has bound its grantor to WITHOUT the grantor signing.**
   *
   * A6's signature moment made countable. §8.1 promises *"your delegates act within their limits,
   * which an offline principal cannot revise"*, and since a delegated `create` binds at formation
   * (`venture/create.ts`) that promise has teeth: every count here is a compact the grantor is a
   * party to and never individually agreed to. A grant with a large `granted` and a zero here is
   * authority nobody has used; the same grant at six is a delegate running an estate.
   *
   * `spent`/`spentContingent` cannot say this. They are money, and money is drawn by acts that are
   * not bindings; the *count of commitments made in someone else's name* is the fact §8.1 is about
   * and the one a viewer needs to read the line as a story rather than as a budget.
   *
   * Publishes nothing new: each of those ventures emitted a `PUBLIC` `venture.formed` carrying this
   * grant's id, and §11.2 puts a grant's parties at `PUBLIC` (D9a).
   */
  readonly boundVentures: number;
  /**
   * ★ **THE CLEARANCE PIPS (A13) — how much this delegate can SEE.**
   *
   * One pip per COMPARTMENT the grant opens, drawn on the **delegate end** of the line: zero
   * pips is an act-only office, two is a delegate that reads its grantor's balance sheet and the
   * position of every hand it owns. The client draws them as small filled squares on the line's
   * head, and the count is legible in three seconds without knowing the rules — *"that one can
   * look."*
   *
   * It is a named signature rather than a number in a panel because §16.12 #3's whole claim is
   * that *"organizations gain power only by taking a visible trust risk"*, and thickness already
   * spends itself on money. A line that could not show sight would show only half the stake — the
   * same defect `grantedContingent` was added to fix one field up, where a grant that authorised
   * nothing direct and everything contingent drew as a hairline.
   *
   * Publishes nothing new: `clearance` is on the `PUBLIC` `grant.issued` row (§11.2 D9a puts a
   * grant's LIMITS and parties at `PUBLIC`, and a clearance is a price a counterparty needs). The
   * grant's **verbs** are deliberately absent — those are `PARTIES` operational detail, "how a
   * principal actually runs its house".
   */
  readonly clearance: readonly string[];
  /**
   * ★ **THE DOSSIER THREADS (A13) — what the delegate did with what it could see.**
   *
   * A thin **dashed** thread from the delegate end of this line to each principal that has been
   * handed a DOSSIER cut under it, tinted by compartment. The map's only dashed element, because a
   * dossier is a **copy** rather than a transfer: nothing left the subject, and a solid line would
   * read as value moving.
   *
   * Three properties the client can rely on, each load-bearing:
   *
   *   - **It appears only at reveal.** A thread is drawn from `revealsAtTick`, never before, so
   *     the frame cannot show a leak the victim has not learned of. A9 is satisfied by
   *     construction rather than by care — the same clock serves the subject, every other agent
   *     and the viewer.
   *   - **It never fades.** A revocation snaps the authority line; the threads stay. That is the
   *     picture of the rule that makes this a real trust risk: revoking stops the next read and
   *     takes back nothing already taken.
   *   - **It hangs off the line, not off the map.** A re-handed dossier is attributed to the grant
   *     its custody chain ROOTS at, so a chain of three re-hands still points at the promotion
   *     that started it. That is §14's receipt reel requirement — the grant, the accepted warning
   *     and the deed on one strip — expressed as geometry.
   *
   * A thread to the GRANTOR ITSELF is the honest case (an office holder reporting), and the client
   * should draw it too: reading the same shape for a report and a leak is the point, and the frame
   * has no business labelling which one it was.
   */
  readonly dossiers: readonly AuthorityDossier[];
  /**
   * UNUSED nothing drawn on EITHER limit · DRAWN some headroom used · EXHAUSTED no
   * headroom left on either limit · REVOKED ending next tick · ★ EXPIRED the term ran out, and this
   * line is on the frame only because something else on it names this grant.
   */
  readonly state: AuthorityLineState;
}

/** One revealed DOSSIER thread hanging off an {@link AuthorityLine}. */
export interface AuthorityDossier {
  readonly to: PrincipalId;
  readonly compartment: string;
  /** The tick it was cut, so the client can age a thread rather than drawing all of them alike. */
  readonly cutAtTick: number;
  /** True when this row is a re-hand rather than a first cut — a copy of a copy. */
  readonly copied: boolean;
}

/**
 * Threads per line. Small on purpose and for `MAX_AUTHORITY_LINES`' reason: convergence is the
 * signature and a hairball is not. A delegate that has cut more than this has made the point.
 */
export const MAX_LINE_DOSSIERS = 4;

/**
 * Predation's pixel signature (A13, §9) — **THE RAID LINE**.
 *
 * A red arc thrown at a stage, anchored on the target's holding, thickness ∝ the demand,
 * with a countdown on it while the window runs. Four terminal looks, each readable in
 * three seconds without knowing the rules: `PAID` fades, `REPULSED` snaps outward and
 * leaves the stage marked held, `PLUNDERED` closes onto the holding and scars it, and
 * `MISSED` closes on nothing — the raid guessed wrong and hit ballast.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **NOTHING ON THIS LINE IS A `SENSED` QUANTITY**, and that is checked rather than
 * intended. `demand` is a seeded draw from a published band and is *not* a function of
 * what the target holds — see `predation/params.ts` on why an earlier fraction-of-stock
 * design was a §11.2 leak of exactly the "Charge fuel gauge" shape. `lost` is what the
 * ledger moved, which A5 makes public. `raiderForce`/`defenderForce` are counts of hands.
 * There is no field here a viewer could invert into a hold value.
 * ══════════════════════════════════════════════════════════════════════════
 */
export interface RaidLine {
  readonly raid: string;
  readonly stage: SystemId;
  readonly target: PrincipalId;
  /**
   * **Who chose this**, or `null` when the world did — §9's two forms, as one pixel.
   *
   * A13 is not satisfied by "a raid renders": a world raid is *weather*, drawn at a place, and
   * an agent's demand is *somebody attacking somebody*, drawn between two names. They are the
   * two different pictures §9 describes and the client draws them as two different things — a
   * red arc on a system, versus an arc with a raider's name on one end of it.
   *
   * It publishes nothing new. Taking a side in a standoff is already `PUBLIC` (`raid.joined`
   * carries the joiner and its stake, and §11.2 gives `PUBLIC` to the map's motion), and the
   * initiator is simply the first party to have taken one.
   */
  readonly initiator: PrincipalId | null;
  /** Thickness ∝ the demand, in units of the good. Never currency, never a hold value. */
  readonly demand: number;
  readonly state: RaidState;
  /** What was actually taken. Zero until it resolves, and zero on a repulse. */
  readonly lost: number;
  readonly raiderForce: number;
  readonly defenderForce: number;
  /** The countdown on the arc. Zero once it has resolved. */
  readonly ticksLeft: number;
  /**
   * ★ **WHO IS STANDING WITH THE TARGET** — the coalition, as names rather than as a number.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **WITHOUT THIS A COALITION RENDERS IDENTICALLY TO A LONE DEFENDER, WHICH BY A13 MEANS IT DOES
   * NOT EXIST.**
   *
   * `raiderForce` and `defenderForce` are *"the two sides as resolution computed them"* — written by
   * `Book.close` and therefore **0 for the whole window**, which is exactly the interval an audience
   * is watching. So four principals marching to a neighbour's standoff and one principal standing
   * alone produced byte-identical frames until the arc had already resolved, and the only thing that
   * ever distinguished them was a number that arrived after the drama.
   *
   * `BattleFormationLine.principal` does distinguish two principals on one side — but only once
   * hulls are committed, and a hull is berthed where it was built, so the *hand* coalition §9 is
   * actually made of has no battle at all unless somebody local owns a warship. The coalition is a
   * fact about the **standoff**, so it belongs on the standoff's line.
   *
   * Names and not counts, for `initiator`'s reason one step on: *"a raid demanded 4,000"* is weather,
   * *"p:kestrel demanded 4,000 of p:wren"* is a story, and *"and p:orrin and p:vale rode out to meet
   * it"* is the reason anybody watches the third one. The client draws each as a spur into the arc,
   * so a defended standoff visibly thickens on the defender's end as the window runs.
   *
   * **It publishes nothing new.** `raid.joined` is emitted `PUBLIC` at `publicAt: tick` carrying the
   * joiner, its side and its stake, and §11.2 gives `PUBLIC` to the map's motion. Bounded by
   * `MAX_RAID_PARTIES` (12) by construction — the book refuses a thirteenth party — so this needs no
   * cap of its own and cannot grow with the population.
   * ══════════════════════════════════════════════════════════════════════════
   */
  readonly defenders: readonly PrincipalId[];
  /** ★ Who is standing with the raid. Same tier, same bound, drawn on the other end of the arc. */
  readonly raiders: readonly PrincipalId[];
}

/**
 * One formation, as a bar. The unit **THE BATTLE LINE** is drawn out of.
 *
 * `ehpBps` is a **fraction and never an absolute**, and that is the §11.2 line in this whole
 * projection. A bar's height says *how hurt* something is, which is what a wound looks like from
 * outside. Its absolute EHP would let a viewer — and therefore any agent with a scraper — invert the
 * fit, which §10 SHOULD-2 names as the failure that *"would make private scouting pointless."*
 *
 * The four booleans are the four force multipliers, each rendered as an overlay rather than a number:
 * `pinned` a chain, `capOut` a dark bar, `repairing` a tether to what it is mending, and role tags a
 * glyph. All four are **observable effects** — the same tier `observed_effects` already publishes to
 * the agents in the fight — so A9's parity holds: a viewer sees nothing a combatant's own `observe`
 * would not contain.
 */
export interface BattleFormationLine {
  readonly formation: string;
  readonly principal: PrincipalId;
  /** `RAIDER` or `DEFENDER`. Which line of bars it is drawn in. */
  readonly side: string;
  readonly hull: string;
  /** Bar width. Hulls still standing, never hulls owned. */
  readonly hulls: number;
  /** Which of the four rows it is drawn in: SCREEN · MAIN · SUPPORT · RESERVE. */
  readonly echelon: string;
  /** CLOSE · HOLD · KITE. The arrow on the bar, and its side of the range race. */
  readonly posture: string;
  /** Bar height, in bps of full. A fraction on purpose — see the interface doc. */
  readonly ehpBps: number;
  /** Wrecks out of this cohort. What the bar has already lost. */
  readonly hullsLost: number;
  /** **The chain.** Tackle is holding it; it cannot leave. */
  readonly pinned: boolean;
  /** **The dark bar.** Capacitor empty: undamaged and operationally dead. */
  readonly capOut: boolean;
  /** It has left the field. Drawn leaving, then gone. */
  readonly withdrawn: boolean;
  /** **The tether.** This formation put repair into a friend this battle. */
  readonly repairing: boolean;
  /** LINE · TACKLE · REPAIR · EWAR · COMMAND — earned from the fit, never declared. */
  readonly roleTags: readonly string[];
}

/**
 * Combat's pixel signature (A13, §9A) — **THE BATTLE LINE.**
 *
 * Two lines of {@link BattleFormationLine} bars facing each other across a **gap that narrows or
 * widens every tick**. That gap is the range race and it is the most legible thing on the board: a
 * brawler fleet drags it shut, a kiting fleet holds it open, and a web wing decides which of them
 * wins. Bars stack in four rows by echelon — screen at the front, reserve greyed out behind
 * everything — width ∝ hull count, height ∝ EHP fraction, so a formation visibly *thins* as it dies
 * instead of vanishing at zero. Wreck marks persist at the stage into AFTERMATH.
 *
 * With the sound off and the text off a viewer can read: how many are on each side, who is winning
 * the range race, who cannot leave, whose repairs just stopped, and who just died. That is the A13
 * test, and it is the reason this projection carries `gap` and `ehpBps` at all.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **NOTHING HERE IS A `SENSED` QUANTITY.** Hulls on a field are the map's own motion, which §11.2
 * gives to `PUBLIC` for the same reason a convoy is public (*"a convoy is visible to anyone, because
 * it is the map's motion and the map is the show"*). `ehpBps` is a fraction, not a hold value. The
 * four flags are effects that have already landed. Wrecks are losses, and A5 gives a loss no opt-out.
 *
 * **Deliberately absent:** fit hashes, module lists, absolute EHP, capacitor totals, the trace's
 * numeric amounts, and any forecast. A frame carrying a fit would turn the spectator feed into a
 * scraper's intelligence service, and *"a ship at sea is visible; its manifest is not"* — a fit is a
 * manifest.
 * ══════════════════════════════════════════════════════════════════════════
 */
export interface BattleLine {
  readonly engagement: string;
  /** The standoff it is fought inside. A battle never exists without one. */
  readonly raid: string;
  readonly stage: SystemId;
  /** MUSTER · CONTACT · CONTEST · BREAK · AFTERMATH. Five beats, five looks. */
  readonly state: string;
  /** **The motion.** 0 (CONTACT) to 4 (EXTREME): how far apart the two lines stand, this tick. */
  readonly gap: number;
  /** The gap as a word, so the client needs no lookup table. */
  readonly rangeName: string;
  /** The countdown on the current state. Zero once it has closed. */
  readonly ticksLeft: number;
  /** `RAIDER` · `DEFENDER` · `CONTESTED`, or null while it is still running. */
  readonly fieldControl: string | null;
  readonly formations: readonly BattleFormationLine[];
  /** Permanent, public, and the reason any of the rest of it matters (A5). */
  readonly wrecks: readonly {
    readonly principal: PrincipalId;
    readonly hull: string;
    readonly tick: number;
    readonly killedBy: PrincipalId | null;
  }[];
}

/**
 * Sovereignty's pixel signature (A13, §6.3) — **THE CLAIM TINT AND ITS LEGEND.**
 *
 * A13's own example is *"a claim tints a system"*. The tint is the state; the legend on it is
 * the three words a stranger reads in three seconds — `PAID` · `ARREARS 1 of 2` ·
 * `ARREARS 2 of 2 · NEXT MISS LAPSES` — with the amount due, the deadline and the bond at
 * risk beside it.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THERE IS NO FUEL GAUGE HERE, AND THAT IS THE POINT OF THIS TYPE.**
 *
 * The rejected design published *"Reckonings of Charge remaining"*, which is a public recipe
 * divided by a **private** stockpile: it leaked reserve coverage, the limiting good, and —
 * when it jumped — inbound convoy contents. This line carries only the world's own published
 * verdict (`state`, `legend`, `arrears`), figures the rules fixed in advance (`due`,
 * `deadlineTick`, `bondAtRisk`, `arrearsOf`), what a completed public act moved (`owed`,
 * `slashed`), and two facts a claimant published itself (`forSale`, and `contestable`, which
 * is a clock).
 *
 * **`owed` had to argue for itself.** It is `due − delivered`, and `delivered` is goods that
 * have already been **destroyed** into `sink:consumption`. So it is a function of the
 * *spent* stock, never the remaining stock — a fact about the past, which A5 makes public the
 * moment it happens. The gauge's sin was publishing a function of what was **left**, and the
 * difference between those two is the whole §11.2 boundary this type sits on. A field named
 * `reckoningsOfCover`, or anything else derived from a warehouse, does not belong here and
 * `projection.ts` will refuse it.
 * ══════════════════════════════════════════════════════════════════════════
 */
/**
 * A worked system, as the map draws it (A13).
 *
 * ## The signature, and what it may not be
 *
 * A claim *tints* a system; a WORKS **marks** it, and the mark carries the one number a
 * viewer needs to read the map economically: how many are working the place and therefore how
 * thin each share has become. A system with four WORKS on it is visibly a contested seam, and
 * that is the picture the whole mechanic exists to produce.
 *
 * **What it must never carry, and this is the same boundary the Charge's fuel gauge failed.**
 * Not the holder's stockpile, not units in store anywhere, not "Reckonings of Levy covered".
 * Every field below is either a property of the MAP (`yieldPerTick`, fixed by tier and
 * published), a count of public structures (`occupants`, each one raised by a `PUBLIC` event),
 * or a quantity the world has already **handed over** (`extracted`, cumulative, an event per
 * tick). Past-handover and present-holdings are the two sides of §11.2's line, and everything
 * here is on the safe one — `extracted` says what a place has given up, never what its holder
 * still has.
 */
/**
 * A syndicate, as the map draws it (A13).
 *
 * ## What makes a pooled treasury watchable
 *
 * A claim tints a system and a WORKS marks one. A syndicate has no *place* — it is an authority
 * structure — so its signature is the **shape of the authority**: how many pooled in, what the
 * constitution permits, and how many people can currently spend the pot. That last number is the
 * one an audience should feel, because it is the count of individuals any one of whom could empty
 * the treasury today without breaking a rule (A6).
 *
 * ## The §11.2 argument, field by field
 *
 * `name`, `founder`, `members`, `admission`, `decision`, `treasuryOffices` — all **PUBLIC**, and
 * necessarily so: a charter is what a prospective member relies on before it hands over goods it
 * cannot retrieve, and a membership is what a counterparty prices when it deals with any member.
 * §11.2 gives `PUBLIC` to an organisation's standing legal shape for exactly this reason, and
 * `syndicate.formed` and `syndicate.joined` are both emitted `PUBLIC` already, so this is the
 * record re-read rather than anything derived.
 *
 * `officeHolders` is a **count of live grants whose grantor is this syndicate**, and a grant's
 * LIMITS and parties are already `PUBLIC` by D9a. Publicity is the mechanic here, not a leak: the
 * whole A6 story is that the authority was visible and legitimate the entire time.
 *
 * **`treasuryMinor` is the field that had to argue hardest, and the argument is that it is not a
 * stockpile.** It is currency in a named account that every member deliberately pooled, and §6.4's
 * precedent is exact: bond is *"posted slashable capital, **public**, and any amount — it is your
 * credit rating"*. A pooled treasury is the same object at org scale — the thing counterparties
 * price and the thing an office-holder could take. Hiding it would make the betrayal unreadable at
 * the moment it lands, which is the one moment the show exists for.
 *
 * **What a syndicate line may never carry:** any member's *own* balance or holdings (`SENSED`, and
 * nothing about pooling makes a member's private stores public); goods anywhere; a covenant's verbs,
 * selectors or approval chain (`PARTIES` by D9a — only a grant's LIMITS and parties are public);
 * anything derived from a member's private stock. `assertFrameBudgets` refuses the stockpile shapes
 * by field name, the same executable form `claimLines` and `worksLines` use.
 */
/**
 * One system, as the map needs it to be drawable.
 *
 * ## Why the frame carries the MAP and not a picture of it
 *
 * A13 calls the map *"the game's only agreed representation"*, and the frame carried no map at
 * all: a client saw system **ids** mentioned inside claim tints and works marks, with no topology
 * and no way to know which other systems existed. So nothing downstream could draw the thing the
 * axiom is about. Every line in this frame was a caption on a picture nobody could render.
 *
 * **Deliberately no coordinates.** Position is presentation, and putting x/y on `StarSystem` would
 * put presentation inside `state_hash` — where a layout tweak becomes a rules change and a replay
 * divergence. `lanes` is a graph, and a graph is enough: a client computes a layout from it
 * deterministically and pins it, which also keeps the map from swimming between Reckonings (a
 * spectator reads position as meaning, so drifting nodes destroy the meaning).
 *
 * `tier` and `constellation` come along because they are the two facts a layout should honour:
 * constellations cluster, and tiers run outward — Commons at the centre, frontier at the rim,
 * which is the risk gradient the whole `graduate` decision is about.
 *
 * All of it is `PUBLIC` and none of it is derived: §11.2 gives `PUBLIC` to *"movement on public
 * lanes — a convoy is visible to anyone, because it is the map's motion and the map is the show"*,
 * and a lane an agent could not see is a lane it could not have moved along.
 */
export interface MapSystem {
  readonly id: SystemId;
  readonly name: string;
  readonly tier: ZoneTier;
  readonly constellation: ConstellationId;
  /** Adjacent systems. A graph, never a geometry. */
  readonly lanes: readonly SystemId[];
  /**
   * ★ **THE PINCH** — the chokepoint signature (A13, §16.12 #1, §16.1 MUST-3).
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THE SIGNATURE, NAMED.** A claim **tints** a system · a compact draws a **link** · a venture is
   * a **ring** · a siege **closes** one · a convoy is a **line that can be severed** · THE SAP is a
   * **notched band** · THE PRINT puts a **price** on a place. **THE PINCH draws a lane narrowed at
   * its waist**, notched with the number of lanes the region would have to go around if it were
   * cut — or filled solid, with the count of systems stranded, when there is no way around at all.
   *
   * A viewer learns in one glance which four or five lanes the whole map must pass through, and
   * then learns to watch them: `map.ts` has said since commit #1 that the inter-constellation gate
   * *"is what a viewer learns to watch"*, and until now nothing drew it, so it was not.
   * ══════════════════════════════════════════════════════════════════════════
   *
   * **A subset of {@link lanes}, so it publishes nothing new.** Every strait is a lane already on
   * this row, and its classification is a pure function of the topology already here — any stranger
   * holding this frame could compute the same set. Derived at read time rather than stored on a
   * `Lane`, because `mapCanonical` feeds `mapHash` and `tick/snapshot.ts` compares that on restore.
   *
   * **Both ends appear.** The two rows for one strait carry the same numbers and name each other,
   * which is what lets a renderer draw the pinch from either endpoint without a second lookup —
   * and `assertFrameBudgets` checks the symmetry, because a one-sided strait would draw a pinch on
   * one half of a lane.
   */
  readonly straits: readonly StraitEdge[];
  /**
   * ★ **THE LODE** — the resource-distinct signature (A13, §16.12 #1, §16.1 MUST-4).
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THE SIGNATURE, NAMED.** A claim **tints** a system · THE PINCH narrows a lane · THE VERGE
   * fences a bloc · a WORKS **marks** a system · THE PRINT puts a **price** on it. **THE LODE sizes
   * the node**: a system's dot is drawn in proportion to what its ground yields, so the map's rich
   * ground is visibly big and its poor ground visibly small, and a viewer can see *why* a war is
   * happening where it is happening.
   *
   * Before this the frame published `worksLines.yieldPerTick` as a **tier constant**, so every one of
   * the eighteen MARCHES systems drew identically and the map was — in §16.1 MUST-4's own words —
   * *"coloured copies"*. Nothing on any screen could distinguish the ground worth taking from the
   * ground beside it, because nothing in the engine did either.
   * ══════════════════════════════════════════════════════════════════════════
   *
   * `PUBLIC`, and it publishes nothing new: it is a pure function of the fixed map and two published
   * constants (`YIELD_PER_TICK`, `FUEL_YIELD_PER_TICK`), both of which `agent.md` states and every
   * relevant observation carries. Any stranger holding this frame can recompute it. It is **not** a
   * stockpile and not an extraction total — `worksLines.extracted` is the cumulative handed-over
   * figure and stays where it is; this is what the ground *can* do, which is a property of the place.
   */
  readonly yieldPerTick: Qty;
  /** The same for FUEL. Zero outside the FRONTIER at every weight. */
  readonly fuelPerTick: Qty;
  /** Against the tier's flat figure, signed bps — the comparable number a renderer sizes on. */
  readonly richnessBps: number;
}

/**
 * One STRAIT, from one of its ends. See {@link MapSystem.straits} for the signature.
 *
 * `detourHops` and `severed` are the two different reasons a lane matters and a renderer draws them
 * differently: a **detour** strait is narrowed and notched with the number, a **severing** one is
 * drawn as a door with the count of systems behind it. Integers, both, because a float may not
 * reach a hashed structure and this frame is canonicalised.
 */
export interface StraitEdge {
  /** The system at the other end. Always present in the same frame's `map`. */
  readonly to: SystemId;
  /** Lanes in the cheapest way around, or `0` when there is none — then `severs` is true. */
  readonly detourHops: number;
  readonly severs: boolean;
  /** Systems stranded if it is cut, smaller side. `0` unless `severs`. */
  readonly severed: number;
}

/**
 * ★ **THE CONVOY LINE** — A13's own sixth named example, and it had no field for the layer's
 * whole life (A13: *"a convoy is a line that can be severed"*).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE PHRASE APPEARS FIVE TIMES IN THIS FILE AS THE REASON *OTHER* FIELDS MAY BE PUBLIC.**
 *
 * `raidLines`, `battleLines`, `map` and `swayLines` each win their §11.2 argument by quoting
 * §11.2's convoy clause — *"a convoy is visible to anyone, because it is the map's motion and the
 * map is the show"* — and the convoy itself was not on the frame. Nothing drew the one object the
 * whole tier argument is named after, so §11.2's most quotable asymmetry (**a ship at sea is
 * visible; its manifest is not**) could not be drawn either: there was no ship on screen to
 * withhold a manifest from.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## The §11.2 argument, and it is the tightest one in this file
 *
 * Every field here is a field of the `PUBLIC` `haul.departed` row, and *only* those fields.
 * `runtime.ts:vHaul` emits it `isPublic: true, publicAt: ctx.tick, declassifyAt: ctx.tick` with
 * `payload: { hand, from, to, arrivesAtTick, lots }`, under a comment that states the split this
 * type honours: *"`good` and `qty` are deliberately ABSENT from this payload… putting them here
 * would put a `SENSED` fact on a `PUBLIC` row."* So A9's parity is a theorem: an agent reading the
 * public feed at this tick has the row this line is a re-read of.
 *
 * **What decides which hands appear is the thing that makes the argument hold.** Only hands
 * carrying cargo — the ones a `haul.departed` row exists for. A bare `move` emits **no event at
 * all** (`tick/loop.ts:BUILT_IN_VERBS.move`), so publishing every in-transit hand would put a
 * fleet redeployment on a public screen that no agent's `observe` reports, which is A9 inverted and
 * is the same defect `world/sway.ts` refuses by deriving borders from holdings rather than hands.
 * An empty hand on a lane draws nothing here, exactly as it emits nothing there.
 *
 * **`lots` is deliberately not carried, not even as a count.** The row publishes lot *identifiers*
 * and this line publishes none of them: a lot count is the shape of a manifest, and
 * `assertFrameBudgets` refuses a field on this line whose name reads like cargo.
 *
 * ## What A13 promises that the engine does not yet do, stated rather than drawn
 *
 * *"A line that can be severed."* **It cannot be severed today**, and this type does not pretend
 * otherwise — there is no `severable` field, because it would be identically `false` and a field
 * that never discriminates is this repo's own named defect class. `PredationPort.routHand` returns
 * false unless `hand.state === 'IDLE'` (`runtime.ts`), so an `IN_TRANSIT` hand is never routed;
 * `predation/resolve.ts` records the same fact from the other side (*"`routHand` then found it
 * `IN_TRANSIT` and declined to rout it"*). Meanwhile the `haul` affordance tells agents *"if the
 * hand is routed on the way, the cargo is DESTROYED"* (`api/observe.ts`). The affordance and the
 * engine disagree; that is a rules-surface discrepancy for the predation layer to settle, and the
 * frame's job is to render what is true.
 *
 * What IS true and is here: {@link strait} says the lane is a chokepoint, which is where a severing
 * would happen if it happened, and it is a pure function of the topology already on this frame.
 */
export interface ConvoyLine {
  /** The carrier. Named on the `PUBLIC` `haul.departed` row as `payload.hand`. */
  readonly hand: HandId;
  readonly principal: PrincipalId;
  /** Where it left from. One move is one lane, so this is adjacent to {@link to}. */
  readonly from: SystemId;
  readonly to: SystemId;
  /** `payload.arrivesAtTick`, verbatim. */
  readonly arrivesAtTick: number;
  /** The countdown on the line. `arrivesAtTick − tick`, floored at zero. */
  readonly ticksLeft: number;
  /**
   * Is this lane a STRAIT? **THE PINCH and THE CONVOY LINE, on one pixel.**
   *
   * A pure function of `map[].straits` — which is on the same frame and is itself a pure function
   * of the topology — so it publishes nothing and any stranger holding this frame can recompute it.
   * It is here because *which* convoys matter is decided by *where* they must pass, and a renderer
   * would otherwise have to join two keys to draw the one thing §16.12 #1 says a viewer learns to
   * watch.
   */
  readonly strait: boolean;
  /** `HALCYON'S CONVOY · sys-04 → sys-11 · 6 TICKS` — the words a viewer reads. */
  readonly legend: string;
}

/**
 * ★ **THE COMPACT LINK** — A13's second and third named examples, which had no field either
 * (*"a compact draws a link between two holdings · a broken compact snaps that link and scars
 * both parties"*).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A venture rendered as a **ring at one `stage` system** ({@link VentureGlyph}) and nothing at all
 * between the parties. So the object the game is named after — a compact — had no geometry: two
 * agents on opposite sides of the map with 40,000 riding on a promise drew two unconnected dots,
 * and a broken promise scarred a *principal* row in `standings` rather than the *link*. A13 names
 * the link twice in six examples and the frame drew it zero times.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## §11.2, field by field, and none of it is new
 *
 * `venture`, `stage`, `kind`, `state`, the two parties and `electiveBps` are all on the `PUBLIC`
 * `venture.formed` / `venture.role_filled` / `venture.settled` rows, and the venture's terms are
 * what a counterparty reads before it signs — the same set {@link DocketCard} already publishes for
 * a forming venture and {@link RundownSegment} for a settled one. The two **holding systems** are
 * `handles`' clause: *"a holding is rendered with its name on it"*, which is also what `swayLines`
 * is derived from and `claimLines`/`worksLines` publish per row.
 *
 * `snapped` is A5 — *"loss is real, public, priceable"* — and it is the same bit `glyph.state`
 * already carries as `SNAPPED_BLACK`; here it is on the link so the **scar has somewhere to sit**.
 *
 * **What a compact link may never carry:** the role terms' escrow split per party (that is the
 * venture's `PARTIES` operational detail; the aggregate `electiveBps` is what the docket card
 * already publishes), anybody's stores at either end, the negotiation text (`PARTIES` until
 * settlement), or the seal. `assertFrameBudgets` refuses a field on this link whose name reads as
 * a stockpile or a manifest, the same executable instrument the claim line and the sway line use.
 */
export interface CompactLink {
  readonly venture: VentureId;
  readonly kind: string;
  /** Where the work happens. The ring sits here; the link runs through it. */
  readonly stage: SystemId;
  readonly state: VentureState;
  /** The creator, and the system its holding sits at — one end of the link. */
  readonly a: PrincipalId;
  readonly aAt: SystemId;
  /**
   * The counterparty with the most riding on it, and its holding's system — the other end.
   *
   * `null` while no role is filled: a compact with one party is not a link yet, and drawing one to
   * nowhere would assert a relationship that does not exist (A5′). That is also exactly what
   * `glyph.state: FORMING` is for — an empty socket, not a line.
   */
  readonly b: PrincipalId | null;
  readonly bAt: SystemId | null;
  /** How many parties in total, so a renderer knows the link is a simplification of a web. */
  readonly parties: number;
  /** The unsecured proportion of the whole compact, in bps. The part riding on someone's word. */
  readonly electiveBps: number;
  /** Value on the elective half. What the link is worth breaking. */
  readonly atStake: Minor;
  /** **The snap.** True exactly when this compact ended in a default (A5). */
  readonly snapped: boolean;
  /**
   * ★ The grant that bound this compact in someone else's name, or null.
   *
   * {@link AuthorityLine.grant}'s other end. A snapped link carrying a grant id is §14's strip with
   * the geometry attached: the authority, the deed, and the two holdings it ran between.
   */
  readonly grant: GrantId | null;
  /** `HAULED · 12K ON A WORD · SNAPPED` — the words a viewer reads. */
  readonly legend: string;
}

/**
 * Convoy lines a frame may draw. *(calibrate)*
 *
 * Sized like the works budget rather than like the label budget, because a convoy is a *line*
 * rather than a name: §17's seven-label rule bites on `cast`, and a renderer draws these as motion
 * on the map with a handle only on the ones a viewer is following. Overflow keeps the ones landing
 * soonest — the ones about to become an arrival — because a cap that dropped those would hide the
 * only moment a convoy is news.
 */
export const MAX_FRAME_CONVOY_LINES = 16;

/**
 * Compact links a frame may draw. *(calibrate)*
 *
 * Equal to `MAX_RUNDOWN_SEGMENTS`, deliberately: the rundown is what a night *narrates* and these
 * are what it narrates *about*, so a night can never tell a story whose link is off the map.
 * Overflow drops the smallest kept promise first and never a snap — a snapped link is the one
 * A13 names, and a cap that dropped it would fail in the direction that hides.
 */
export const MAX_FRAME_COMPACT_LINKS = 12;

/**
 * ★ **THE VERGE** — the projection signature (A13, §16.12 #1).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE SIGNATURE, NAMED.** THE PINCH draws the lanes; THE VERGE draws the **borders**. One row per
 * system outside the Commons, naming whose force reaches it hardest and by how much. A renderer
 * groups the rows by principal and draws **one closed fence per group** — so a bloc is a shape
 * rather than a list, the seam where two fences meet is a contested border, and a system nobody
 * reaches is drawn **bare**: no man's ground, which the launch map has plenty of.
 *
 * This is the field §16.12 #1's second clause is about. *"This creates local power, supply lines,
 * borders, markets, and a real place for smaller groups to exist"* — and none of those five were
 * drawable before, because the frame had no way to say where anybody's power stopped. A tint said
 * who owned a system; nothing said who could **reach** one.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## §11.2, and why this adds no disclosure at all
 *
 * Every input is `PUBLIC` and already on this frame:
 *
 *   - **the topology** — `map`, admitted with the argument that *"a lane an agent could not see is a
 *     lane it could not have moved along"*;
 *   - **holdings** — `handles`, admitted because *"a holding is rendered with its name on it"*;
 *   - **claims** — `claimLines`, whose own argument is that *"territory nobody can see is not
 *     territory"* and that a claim is A13's named signature;
 *   - **the published constants** `SWAY_AT_SEAT`, `SWAY_PER_HOP`, `SWAY_STRAIT_TOLL`, which
 *     `agent.md` states and `SWAY_STATEMENT` carries verbatim into every relevant observation.
 *
 * So a `SwayLine` is **integer arithmetic over facts already on the screen**, which A2 requires be
 * exact and machine-readable, and A9's parity holds by construction: every agent's own `observe`
 * carries `holding.sway` for itself and can compute any other principal's from `map` plus the
 * public holding and claim rows. There is no live fact here an `observe` would not answer.
 *
 * ## What it may never carry, and each was considered
 *
 * **Where anybody's hands are.** `sway.ts` derives the reading from holdings and claims and
 * deliberately not from hands, precisely so this line can exist: hand disposition is `SENSED` — *"a
 * ship at sea is visible; its manifest is not"* — and a border drawn from live hand positions would
 * put a fleet's location on a public screen and delete the intel market. The comment on
 * `SwaySeats` states that as the reason for the input choice, not as a filter applied afterwards.
 *
 * **Anybody's stores, at the system or anywhere.** Sway reads no quantity of anything.
 *
 * **A second-place holder, or the full per-principal table.** Only the strongest reading per system
 * is published. A full table would be 26 × N rows and would let a reader infer, for every
 * principal, the exact set of ground it holds — which is public, but publishing the *derivation*
 * rather than the *border* would make this a targeting service rather than a picture. The border is
 * what renders; the rest an agent computes itself.
 */
export interface SwayLine {
  readonly system: SystemId;
  /**
   * Whoever projects hardest here, or `null` when nobody reaches at all.
   *
   * `null` rather than an omitted row, for `standings`' reason inverted: an absent row and an empty
   * one read the same to a client, and *"nobody's force reaches this place"* is a fact this frame
   * must be able to state — it is where a small holder can live, which is §16.12 #1's own last
   * clause.
   */
  readonly principal: PrincipalId | null;
  /** That principal's SWAY here, `1..SWAY_AT_SEAT`. `0` exactly when `principal` is null. */
  readonly sway: number;
  /**
   * How many principals reach this system at all — **the field that says whether the name beside
   * it means anything.**
   *
   * `MarketLine.venues`' argument, in the political register: with one reacher a border is a
   * frontier with empty space behind it, and with three it is contested ground. Without this, a
   * lone reacher and a three-way standoff draw identically.
   */
  readonly reachers: number;
  /** True when this system is a STRAIT's endpoint — the ground whose toll its holder waives. */
  readonly gate: boolean;
}

export interface SyndicateLine {
  readonly syndicate: string;
  readonly name: string;
  readonly founder: PrincipalId;
  readonly members: number;
  readonly admission: string;
  readonly decision: string;
  /** Whether the constitution permits anyone to be given spending authority at all. */
  readonly treasuryOffices: boolean;
  /** Currency pooled. Public for §6.4's reason: this is the org's credit rating. */
  readonly treasuryMinor: Minor;
  /** Live offices over the pool — the count of people who could empty it legally today. */
  readonly officeHolders: number;
  /** `STRONGBOX` · `4 POOLED · 1 CAN SPEND` — the words a viewer reads. */
  readonly legend: string;
}

/**
 * ★ **THE PRINT** — the market's pixel signature (A13, §10).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE SIGNATURE, NAMED.** A claim **tints** a system. A WORKS **marks** it. A market
 * **PRINTS A PRICE ON IT** — and the print carries the one number that makes two places
 * comparable: what this good fetched *here*, against what it fetched everywhere.
 *
 * `market/` is 3,065 lines that had never printed a fill in any world this repo had run, and
 * on the day it printed 18 of them there was still no market or fill key anywhere in
 * `frames/latest.json`. A13 is a ship gate rather than a nicety, so this is the gate being
 * satisfied: the first production fill is now visible, and visible as a *price*.
 *
 * **The drama of an economy is price, not activity.** A projection saying "a trade happened"
 * is a log line. Two systems quoting the same good at prices 8% apart is a lane worth hauling
 * down, a hub forming, and a blockade worth mounting — M1's whole argument for why the book is
 * location-bound (*"a global book or teleporting fulfillment would erase most of the galaxy"*).
 * So `premiumBps` is the field this signature exists for, and `vwap` is what makes it exact.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## §11.2, field by field — and the one thing deliberately left out
 *
 * Everything here is derived from **completed fills and nothing else.** `market/observe.ts`
 * settles the tiers already and the two halves differ:
 *
 *   - **a completed fill is `PUBLIC`** — economy law 10, *"completed trades … become durable
 *     economic history"*. It is the print, the mark and the receipt reel's raw material. And it
 *     is `PUBLIC` **galaxy-wide**: every agent's `market.ticker` block is `recentPrints(book)`
 *     over every venue, so A9's parity holds by construction. There is no fact on this line an
 *     agent's own `observe` would not already answer.
 *   - **a resting order is not on this line, and that is a decision.** Depth, price levels and
 *     best bid/ask are `PUBLIC` too — but `booksFor` serves them only for venues where the
 *     reader has a hand (§12.1, *"local book only"*). A galaxy-wide depth ladder on a frame
 *     would therefore be a live fact most agents' `observe` would NOT show, which is A9
 *     inverted. And `market/observe.ts` gives the sharper reason: *"a resting ask IS a hold
 *     value — X has 400 of this good, here, right now"*, and a raider reading a manifest off a
 *     public surface without ever scouting deletes the intel market. **A fill is a deed; a
 *     resting order is a manifest.** Deeds go on the frame.
 *
 * `venue`, `good`, `lastPrice`, `lastTick`, `prints`, `volume`: the fills themselves, re-read.
 * `vwap` and `galaxyVwap`: integer volume-weighted averages over those same fills — known
 * arithmetic, which A2 requires be exact and machine-readable. `premiumBps`: the ratio of the
 * two, in bps, so no float reaches a screen.
 *
 * **What a print may never carry**, each considered: resting depth or a best bid/ask (venue-
 * gated above); an order's owner (`PRIVATE` — *"the principal itself; never anyone, never
 * later"*); anybody's inventory, balance or escrow; a `reference_mark`, which is the *bond*
 * valuation and belongs to the lender's question rather than the viewer's. `assertFrameBudgets`
 * refuses a field whose name reads as a stockpile, by the same executable rule `claimLines` and
 * `worksLines` use — the argument made checkable rather than remembered.
 */
export interface MarketLine {
  /** The system the price is printed on. `(venue, good)` is the book's only key. */
  readonly venue: SystemId;
  readonly good: GoodId;
  /** The most recent print here. What a viewer reads as "the price". */
  readonly lastPrice: Minor;
  readonly lastTick: number;
  /**
   * The earliest print this line counted — **so the frame states its own span.**
   *
   * `prints: 3` and `volume: 120` are counts over a period, and a count over an unstated period
   * is not a fact. There is deliberately no policy window (`market/observe.ts` records the
   * measurement that killed one): the span is whatever the book still remembers, and it is
   * published rather than assumed. Staleness is `frame.tick − lastTick`, by eye.
   */
  readonly firstTick: number;
  /** Prints on record here, at or before the frame's tick. A count of completed public acts. */
  readonly prints: number;
  /** Units that changed hands here in the window. */
  readonly volume: Qty;
  /** Volume-weighted average unit price here, integer. The comparable number. */
  readonly vwap: Minor;
  /** The same good's VWAP across EVERY venue in the same window. The thing to compare to. */
  readonly galaxyVwap: Minor;
  /**
   * How many places traded this good in the window — **the field that says whether the premium
   * beside it means anything.**
   *
   * With one venue there is no comparison to make, and a premium of 0 bps would read as "fairly
   * priced" when the truth is "nothing to price it against". A2 forbids letting an absence
   * render as a measurement, so the count is published and the legend says `ONLY MARKET`.
   */
  readonly venues: number;
  /**
   * `vwap` against `galaxyVwap`, in bps. Signed: positive is dear here, negative is cheap.
   *
   * Exactly zero when `venues < 2`, by identity — a sole market *is* the galaxy price. With two
   * or more it may still be zero, and that is a real result (`AT PARITY`) rather than a missing
   * one: integer bps over an integer denominator, so a gap under one bps rounds away.
   */
  readonly premiumBps: number;
  /** `ORE · 1240 · +812 bps DEAR` — the words a viewer reads. */
  readonly legend: string;
}

export interface WorksLine {
  readonly works: string;
  /** The system the mark sits on. */
  readonly system: SystemId;
  readonly holder: PrincipalId;
  /** What the PLACE yields per tick. A property of the map, identical for every viewer. */
  readonly yieldPerTick: number;
  /** Live WORKS standing there. The crowding, which is the economic story. */
  readonly occupants: number;
  /**
   * What this WORKS's holder **keeps** per tick at today's crowding: the share less the rent.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **NET, AND IT USED TO BE THE WHOLE DIVISION.** `yieldPerTick / occupants` was both the
   * definition and the truth while no claim took anything; once a claim-holder takes a published
   * share, a mark quoting the gross would tell a stranger a resident earns a fifth more than it
   * does — and the same field feeds `worksQuote`, which `agent.md` calls *"the number that
   * decides whether the build pays for itself"*. That is scar #1 exactly: two surfaces, each
   * individually coherent, disagreeing about one number.
   *
   * So the identity a reader can check is `sharePerTick + rentPerTick === yieldPerTick /
   * occupants`, and `assertFrameBudgets` refuses a line where it does not hold.
   * ══════════════════════════════════════════════════════════════════════════
   */
  readonly sharePerTick: number;
  /** `EXTRACTING` · `SPINNING UP 6 ticks` — the two words a viewer reads. */
  readonly legend: string;
  /** Cumulative units the place has HANDED OVER to this WORKS, GROSS. Never a stock reading. */
  readonly extracted: number;
  /** The rate the claim on this system takes, in bps. Zero on unclaimed ground. */
  readonly rentBps: number;
  /** What the claim-holder takes out of this WORKS's share per tick. Zero if nobody does. */
  readonly rentPerTick: number;
  /** Cumulative units this WORKS has handed to a landlord. The grievance, as a number. */
  readonly rentPaid: number;
  /**
   * The FUEL good this place also yields to this WORKS per tick. **Zero outside the Frontier.**
   *
   * A tier constant divided by a public occupancy, which is the same argument `sharePerTick` is
   * admitted on. It is on the frame because the third good is the only asymmetry in the economy and
   * a map that did not draw it would leave a viewer unable to see why the Frontier is fought over —
   * A13 refuses a mechanic with no pixel signature, and "some ground makes a thing no other ground
   * makes" is the mechanic.
   */
  readonly fuelPerTick: number;
  /** Cumulative fuel the place has HANDED OVER to this WORKS. Never a stock reading. */
  readonly fuelExtracted: number;
}

/**
 * ★ **THE SAP** — a campaign's pixel signature (§16.6, A13).
 *
 * A notched band drawn from a campaign's DEPOT toward its OBJECTIVE. `notches` of `notchesToReach`
 * is how far the trench has come; it advances on a BREACH and retreats on a REBUFF, so the band
 * **is** the score and a viewer reads it without a legend. `dashed` is the published notice window
 * before the first pulse — the defender sees the war coming. `hollow` is the campaign having no
 * MATERIEL for its next pulse, so a starving war looks starved a whole Reckoning before it dies.
 * `reached` is the only state in which the objective's own claim tint goes out and a ruin persists at
 * the fallen anchor.
 *
 * The full argument, including the one §11.2 decision (`hollow` is one bit about a published
 * obligation falling due at a published tick, never a stock reading — `anchorHot`'s exact
 * precedent), is in `campaign/view.ts`.
 *
 * Strictly fewer fields than `CampaignView`, which is what makes A9 a theorem here rather than a
 * review item: there is no fact on this line an agent's own `observe` would not answer.
 */
export interface SapLine {
  readonly campaign: string;
  /** Where the band starts: the attacker's forward system. */
  readonly depot: SystemId;
  /** Where it is aimed: the claimed system. */
  readonly objective: SystemId;
  readonly attacker: PrincipalId;
  readonly defender: PrincipalId;
  readonly state: CampaignState;
  /** `2-1 of 3` · `MASSING · first pulse tick 504` · `REBUFFED 1-3`. One home, three readers. */
  readonly legend: string;
  /** How far the trench has advanced. Zero on any ending but TAKEN: nothing was taken. */
  readonly notches: number;
  /** Its full length — the breaches this campaign's scope requires. */
  readonly notchesToReach: number;
  readonly rebuffs: number;
  readonly rebuffsToStand: number;
  /** Drawn dashed: declared, not yet pressing. The published notice (§16.6 MUST-8). */
  readonly dashed: boolean;
  /** Drawn hollow: no MATERIEL at the depot for the next pulse. Supply, made visible. */
  readonly hollow: boolean;
  /** The band touches the objective. Only on TAKEN. */
  readonly reached: boolean;
  /** Posted, slashable, `PUBLIC` by §6.4 exactly as a claim bond is. */
  readonly bond: Minor;
  /** What the ending actually moved to the defender. Zero while live; A5 makes a loss public. */
  readonly forfeited: Minor;
  readonly nextPulseTick: number | null;
  /** Roster size, both sides. §16.6 MUST-9's visible treaty edges, as a count. */
  readonly allies: number;
}

export interface ClaimLine {
  readonly claim: string;
  /** The system the tint sits on. */
  readonly system: SystemId;
  readonly claimant: PrincipalId;
  readonly state: ClaimState;
  /** The three words. `PAID` · `ARREARS 1 of 2` · `ARREARS 2 of 2 · NEXT MISS LAPSES`. */
  readonly legend: string;
  readonly arrears: number;
  readonly arrearsOf: number;
  /** This Reckoning's Charge, in units of the good. Computable by any stranger. */
  readonly due: number;
  /** Still owed. `due` less goods already destroyed — never a function of what is left. */
  readonly owed: number;
  readonly deadlineTick: number;
  /** Posted, slashable, and `PUBLIC` by §6.4: "public, and any amount". */
  readonly bondAtRisk: Minor;
  /** What a lapse actually took. Zero unless it lapsed; A5 makes a loss public. */
  readonly slashed: Minor;
  /** The asking price while the claimant has it up for sale, else null. The fire sale. */
  readonly forSale: Minor | null;
  /** True while the published vulnerability window is open on a CONTESTED claim. */
  readonly contestable: boolean;
  /**
   * What this claim takes from every other WORKS at its system, in bps. The RENT.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THE THREE RENT FIELDS ARE THE TERRITORY LAYER'S ONLY INCOME, AND A13 REFUSES A MECHANIC
   * WITH NO PIXEL SIGNATURE.** Before them a claim rendered as four ways of paying — the tint
   * carried a due, an owed, a bond at risk and a slash, and nothing at all about why anybody
   * would want the ground. A viewer could watch a claim fall and never learn what was lost.
   *
   * Each is on the public side of §11.2 for a reason already accepted elsewhere in this file:
   * `rentBps` is a published term of the claim, fixed when it was raised and readable by any
   * stranger; `rentTaken` is goods the world has **already handed over**, which is `extracted`'s
   * own argument; `tenants` counts live structures each raised by a `PUBLIC` event. None is a
   * function of what anybody still holds, so none of them is the rejected gauge.
   * ══════════════════════════════════════════════════════════════════════════
   */
  readonly rentBps: number;
  /** Units of the raw good this claim has collected **this Reckoning**. */
  readonly rentTaken: number;
  /** Live WORKS here held by somebody else — who is paying, and how many of them. */
  readonly tenants: number;
  /**
   * Is this claim's anchor fuelled for this Reckoning? **`false` means it is collecting nothing.**
   *
   * The pixel signature for the third good's sink, and the only new failure state sovereignty has
   * gained: a cold anchor keeps the claim, the arrears count and the bond exactly as they were and
   * loses only the income. A viewer watching a frontier landlord's rent stop while its tenants keep
   * their whole share is watching a supply failure it can see the cause of, which is the difference
   * between a story and a number that moved.
   *
   * True by construction where no fuel is required, because reporting `false` for a Marches claim
   * would tint it as switched off when nothing is wrong with it.
   */
  readonly anchorHot: boolean;
  /** Units of fuel this claim's tier asks per Reckoning. Zero where none is asked. */
  readonly fuelDue: number;
}

/**
 * The venture glyph (§14.5): a ring on its stage, hands as pips on the rim, an
 * unfilled role as an empty socket that pulses — that is what "forming" looks
 * like — the elective share as a hollow arc, and settlement closing it gold or
 * snapping it black.
 */
export interface VentureGlyph {
  readonly venture: VentureId;
  readonly stage: SystemId;
  readonly rolesFilled: number;
  readonly rolesTotal: number;
  /** Fraction of value that is elective, in bps. The hollow arc. */
  readonly electiveBps: number;
  readonly state: 'FORMING' | 'LIVE' | 'CLOSED_GOLD' | 'SNAPPED_BLACK' | 'DEFERRED';
}

/** A docket card. Biggest stakes first, each one a sentence a stranger reads. */
export interface DocketCard {
  readonly venture: VentureId;
  /** e.g. "Halcyon's 300,000 of ore is riding on Vex's escort." */
  readonly headline: string;
  /** e.g. "Vex has never escorted for Halcyon before." */
  readonly tension: string;
  readonly atStake: Minor;
  /**
   * **How much of this deal is unsecured, in bps — the creator's offer, made visible.**
   *
   * `VentureGlyph.electiveBps` renders this as the hollow arc for a venture that has already settled;
   * the docket is the FORWARD view (§14.1) and needed the same number about a deal still forming.
   * It became worth drawing the moment `create` took `elective_bps`: before that every venture in the
   * world carried the identical proportion, so an arc that never varied said nothing.
   *
   * Now it is the offer. Two cards with the same `atStake` and arcs of 25% and 60% are two different
   * bets by two different creators, which is exactly what §14.1 wants a cold viewer to be able to see
   * — and what a filler weighing a record against a proportion is deciding about.
   */
  readonly electiveBps: number;
  readonly cast: readonly CastChip[];
  /**
   * ★ The grant a delegate bound this card under, or null.
   *
   * {@link RundownSegment.grant}'s forward-looking twin, and the reason it is a field rather than
   * only a sentence: {@link tension} already *says* *"X committed Y to this under a grant"* in
   * prose, which a human reads and a renderer cannot join on. §14's strip needs a key.
   */
  readonly grant: GrantId | null;
}

/**
 * One rundown segment. Exactly one venture per segment, ascending by stakes,
 * with the three largest say-do deltas held to the end (§14.3). Resolving a
 * hundred deals simultaneously is a page refresh; nobody can follow it.
 */
/**
 * What a beat is ABOUT, so the running order can cross systems.
 *
 * ## Why this exists
 *
 * The rundown was built from settled ventures alone, and everything else the night did —
 * the Levy's result, a claim lapsing, a raid landing — reached a viewer only as a static
 * table beside it. So a Reckoning read as a narrated sequence followed by some lists, and
 * the largest irreversible loss of the night could be in one of the lists.
 *
 * §14.3 says the ordering IS the format: ascending by stakes, largest say-do deltas held to
 * the end, because a broken promise is the largest delta there is. That rule was never
 * specific to ventures — a claim LAPSING is permanent territorial loss with a bond slashed,
 * which is at least as big a delta as a defaulted promise, and it was being shown in a panel.
 *
 * A beat carries a `venture` only when it is about one. `subject` is what the beat names in
 * every case, so a client can render a running order without knowing which system produced it.
 */
/**
 * Named for what NARRATIVELY happened, not for the system that produced it.
 *
 * The first draft used `VENTURE | LEVY | LAPSE | RAID` and `vocabulary-repo.test.ts` refused
 * it: three of those are §3 canon terms being given a second meaning, and `RAID` already exists
 * as a `VentureKind` member. Hard rule 4 is a rules surface, not a style guide — a beat kind
 * called `RAID` and a venture kind called `RAID` are two concepts wearing one word, which is the
 * exact shape of the bug that survived three critic passes in High Water.
 *
 * So a beat is named by its event: something SETTLED, something LAPSED, something was PLUNDERED.
 * That reads better in a running order anyway, which is the usual result of being made to say
 * what you actually mean.
 */
export type BeatKind = 'SETTLEMENT' | 'LAPSE' | 'PLUNDER';

export interface RundownSegment {
  readonly order: number;
  readonly kind: BeatKind;
  /** What this beat is about: a venture id, a system, a principal. Always present. */
  readonly subject: string;
  /** Present only on a `VENTURE` beat. */
  readonly venture: VentureId | null;
  readonly cast: readonly CastChip[];
  /** What it said — a public claim, allowed to be a lie. */
  readonly publicLine: string | null;
  /**
   * What it sealed — **the flag only, never the content.**
   *
   * §11.2's ladder gives `SEALED` to *nobody* among agents, and to viewers only as
   * "the flag at the Reckoning"; the content arrives "in the season replay… when it is
   * archaeology rather than intelligence". This frame is the nightly artifact, so the
   * content has no business in it and the field that used to carry it is gone.
   *
   * It was not leaking, and that is the point: `sealContent` existed here and the client
   * printed it, and the only reason nothing escaped was that the runtime happened to pass
   * `null`. A tier boundary held up by a coincidence in a caller is not held up. Season
   * content belongs to a separate replay artifact that does not exist yet.
   */
  readonly sealVerdict: SealVerdict | null;
  /** What it did. Ground truth. */
  readonly deed: string;
  /**
   * The venture's arc on the map. **Null on a non-venture beat**, because a glyph is a
   * venture-shaped object (roles filled, elective fraction) and a lapsed claim has neither.
   * A client renders the glyph when it is there and the `deed` line when it is not.
   */
  readonly glyph: VentureGlyph | null;
  /** Plain language, for a stranger who does not know the rules. */
  readonly consequence: string;
  /**
   * THE RECEIPT REEL (§14). Present only when an elective promise broke: every
   * message its author sent between handshake and deed, declassified at
   * settlement. Nothing is authored — this is a query over PARTIES messages.
   */
  readonly receiptReel: readonly ReceiptLine[] | null;
  /**
   * ★ **THE GRANT THAT AUTHORISED THIS DEED**, or null when the promisor acted for itself.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **§14 NAMES FIVE ARTIFACTS AND THIS WAS THE MISSING KEY BETWEEN TWO OF THEM.**
   *
   * *"The grant, the accepted warning, the seal, the deed and the negotiation text on one strip."*
   * The deed is {@link deed}; the accepted warning is `AuthorityLine.granted` /
   * `.grantedContingent`; the negotiation is {@link receiptReel}; the verdict is
   * {@link sealVerdict}. **The grant was on no frame field at all** — so a renderer holding a
   * `SNAPPED_BLACK` segment had nothing to look the authority up by, and A6's *"the replay can
   * point at the exact promotion and the risk warning someone accepted"* was not achievable from
   * a published artifact. This is that pointer, and {@link AuthorityLine.grant} is what it points at.
   *
   * Publishes nothing new: `venture.formed`'s `grant_id` column is on a `PUBLIC` row, which is the
   * argument `AuthorityLine.boundVentures` is already admitted on.
   * ══════════════════════════════════════════════════════════════════════════
   */
  readonly grant: GrantId | null;
  /**
   * ★ Who actually acted, when a delegate acted in another principal's name.
   *
   * `VentureRecord.actedBy`, and it is the field A5′ was reopened over: the permanent public row
   * named the grantor as the promisor and *did not name the delegate at all*. A rundown segment is
   * the most-read public statement this engine makes about a broken promise, and it said the wrong
   * name. Null on an ordinary venture, where the creator is the actor and repeating it would assert
   * a delegation that did not happen.
   */
  readonly actedBy: PrincipalId | null;
  /** The principal whose money was riding on it, when {@link actedBy} is set. Null otherwise. */
  readonly onBehalfOf: PrincipalId | null;
}

export interface ReceiptLine {
  readonly tick: number;
  readonly from: Handle;
  readonly text: string;
}

/**
 * A settled Reckoning, rendered. Immutable once written — a settled tick never
 * changes — which is why nginx may cache frame JSON as `immutable`.
 */
export interface ReckoningFrame {
  readonly reckoningIndex: number;
  readonly tick: number;
  readonly stateHash: string;
  readonly meters: Meters;
  readonly docket: readonly DocketCard[];
  readonly rundown: readonly RundownSegment[];
  readonly tributeLines: readonly TributeLine[];
  /** The A6 authority signature: who holds standing power over whom, and by how much. */
  readonly authorityLines: readonly AuthorityLine[];
  /** Predation's signature (§9, A14): what the world came for, and how it went. */
  readonly raidLines: readonly RaidLine[];
  /** Combat's signature (§9A, A13): the two lines, the gap between them, and what burned. */
  readonly battleLines: readonly BattleLine[];
  /** Sovereignty's signature (§6.3, A13): who owes upkeep on what, and who is about to lose it. */
  readonly claimLines: readonly ClaimLine[];
  /** ★ Campaigns' signature (§16.6, A13): THE SAP — a trench from a depot toward a claim. */
  readonly saps: readonly SapLine[];
  readonly worksLines: readonly WorksLine[];
  /** ★ The market's signature (§10, A13): THE PRINT — a price on a place, and the gap to everywhere else. */
  readonly marketLines: readonly MarketLine[];
  /**
   * §16's world-memory projections. Read-only over books that already exist, so neither can move
   * `state_hash` — and both are what tell a spectator arriving at Reckoning 40 that the map was earned
   * rather than configured.
   */
  /**
   * **THE PUBLIC READ: every principal's standing vectors, in one place.**
   *
   * Three blind probes independently reported the same gap: you cannot look up a counterparty's record
   * *before* dealing with them, which is the only moment it matters. `counterparties[]` in `observe`
   * carries only agents already named in your own observation, so a reputation exists and cannot be
   * consulted — and a game whose premise is "the best decisions are about other agents" then has
   * nothing to decide on.
   *
   * **This publishes no new fact.** §11.2 already places standing at `PUBLIC`, `PUBLIC_FACT_KEYS`
   * already admits `standings` with the argument written out — *"`standingRow` already serves exactly
   * this row to every agent through `observe`, including in `counterparties[]` about principals other
   * than the reader, so publishing it to a viewer adds no disclosure and A9's parity holds by
   * construction"* — and the frame was already reading these vectors to build one character line. It
   * simply never emitted the set.
   *
   * NOT a score (§3). The frame carries the vectors; what they are worth is the reader's judgement,
   * which is exactly where the design wants that judgement to sit.
   */
  readonly standings: readonly StandingRow[];
  readonly places: readonly PlaceName[];
  /**
   * ★ **THE RUINS** — what this world has destroyed, newest first. Razing's pixel signature.
   *
   * Capped by {@link MAX_FRAME_RUINS} rather than unbounded, and the cap drops the OLDEST, which is
   * the only safe direction: `ruinsFor` sorts newest-first, so overflow loses ancient history and
   * never this Reckoning's news. A cap that dropped the newest would fail in the direction that
   * hides, which this repo has shipped three times.
   */
  readonly ruins: readonly Ruin[];
  readonly hallOfFame: readonly HallOfFameRow[];
  readonly syndicateLines: readonly SyndicateLine[];
  /** ★ A13's first Phase 3 signature: THE FRONT BAND. A swept band of tinted systems. */
  readonly frontBands: readonly FrontBand[];
  /** ★ A13's second: THE COVER ARC. Filled for the escrowed half, hollow for the elective. */
  readonly coverArcs: readonly CoverArc[];
  /** ★ A13's third: THE COVER CHAIN. Snaps at the link that broke; every link inward greys. */
  readonly coverChains: readonly CoverChain[];
  /**
   * The topology, so the map can be drawn at all (A13). Fixed per world — including
   * `MapSystem.straits`, which is a function of the topology and moves only when the region grows,
   * and `MapSystem.yieldPerTick`/`richnessBps`, which are a function of the map's own seed.
   */
  readonly map: readonly MapSystem[];
  /** ★ §16.12 #1's signature: **THE VERGE** — where each bloc's force stops, which is a border. */
  readonly swayLines: readonly SwayLine[];
  /** ★ A13's sixth named example: **THE CONVOY LINE** — the map's motion, without its manifest. */
  readonly convoyLines: readonly ConvoyLine[];
  /** ★ A13's second and third: **THE COMPACT LINK**, and the snap that scars both ends of it. */
  readonly compactLinks: readonly CompactLink[];
  readonly glyphs: readonly VentureGlyph[];
  /** One line, 140 chars, tick-stamped. The export surface. */
  readonly ticker: readonly string[];
  /** Tomorrow's docket, as the closing card. */
  readonly nextDocket: readonly DocketCard[];
}

// ══════════════════════════════════════════════════════════════════════════════
// ★ THE LIVE FRAME — the artifact that makes the Reckoning frame watchable
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Where the world is in its day. Derived from `ReckoningClock`, never stored.
 *
 * `EARLY` the long stretch · `COMMITMENT` the last `COMMITMENT_WINDOW_TICKS` (§5.1) · `FREEZE` the
 * single tick before settlement, where nothing may touch the settlement set · `SETTLING` the
 * settlement tick itself, which is the one tick a {@link ReckoningFrame} is written on.
 *
 * Its own word set, not `RaidState`'s and not `VentureState`'s (hard rule 4): this names where the
 * *clock* is, and no canon term already means that.
 *
 * **`EARLY` and not `OPEN`, and the repo-wide vocabulary guard is why.** The first spelling was `OPEN`
 * and `vocabulary-repo.test.ts` refused it in one line: `IndemnityState` and `OrderState` already share
 * `OPEN` with a sanctioned entry reading *"live and unresolved"*, and a *phase of the clock* is not
 * that — an order is `OPEN` or it is not, while every tick of a Reckoning is "live". One word wearing
 * two concepts is HARD RULE 4, and this is the guard doing exactly the job its own header describes.
 */
export type LivePhase = 'EARLY' | 'COMMITMENT' | 'FREEZE' | 'SETTLING';

/**
 * What moves between Reckonings. Cheap, and none of it is a whole-ledger read.
 *
 * Deliberately **not** {@link Meters}. `Meters.levyShort` is a per-Reckoning settlement result and
 * `Meters.unrefined` sums every stored lot of every principal — the exact shape that took production
 * down when `HAZARD` gained a subject and the step budget had no term for it. A meter that costs a
 * ledger sweep belongs on the artifact written once a day, not on the one written every tick.
 *
 * Every field here is a **count over a bounded book** or a sum the glyph pass already computed.
 */
export interface LiveMeters {
  /**
   * Value riding on nothing but someone's word, **right now** — the elective half of every filled
   * role in every live venture.
   *
   * The same quantity `Meters.onAPromise` reports for what *settled*, asked about what is *still
   * open*. It is the one number that says whether tonight has anything at stake in it, and it is
   * the reason a live frame is worth polling before the Reckoning rather than only after.
   */
  readonly onAPromise: Minor;
  /** Ventures with an unfilled role. The empty sockets, counted. */
  readonly forming: number;
  /** Ventures fully crewed and running. */
  readonly live: number;
  /** Standoffs with the window still open — the arcs with a countdown on them. */
  readonly raidsLive: number;
  /** Engagements not yet resolved — the gaps still moving. */
  readonly battlesLive: number;
  /** Laden hands on a lane. Convoys in flight. */
  readonly convoys: number;
}

/**
 * ★ **THE LIVE FRAME — because the nightly frame is a post-mortem.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * **MEASURED, AND IT INVALIDATES ABOUT A DOZEN FIELDS AT ONCE.**
 *
 * A {@link ReckoningFrame} is published only on `report.clock.isSettlementTick`. `SPEEDS.prod` is
 * 300 s and `TICKS_PER_RECKONING` is 288, so in production that is **one frame per 24 hours** —
 * while `latest.json` is served `max-age=2` and the client polls it every 15 seconds against a file
 * whose content changes once a day. A viewer arriving at an arbitrary moment sees a still image of
 * yesterday.
 *
 * The consequence is not a bug in any one field; it is that **every field designed to animate
 * within a Reckoning had no frame to appear in.** Censused over 21 real frames across three seeds:
 *
 * | field | what it is for | measured |
 * |---|---|---|
 * | `raidLines.ticksLeft` | the countdown on the arc | **0 on 117 of 117 rows** |
 * | `raidLines.state` | `DEMANDED` is the live standoff | **never once** |
 * | `battleLines.gap` / `.rangeName` | *"the gap that narrows every tick"* — called the most legible thing on the board | never animates; both battles observed were `AFTERMATH` |
 * | `VentureGlyph.state: FORMING` | *"an empty socket that pulses — that is what forming looks like"* | **never occurs** |
 * | `SapLine.dashed` / `.nextPulseTick` | the published notice window | unreachable |
 * | `ClaimLine.contestable` | the published vulnerability window | **0 of 24** |
 * | `AuthorityLine.state` | A6, as it is being drawn on | `UNUSED` on every row of every frame |
 *
 * The sort functions in `render.ts` were written for a world that could not reach a frame:
 * `raidLines` ranks `DEMANDED` first and `battleLines` ranks a running battle first, and neither
 * state ever arrived.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * **SO THIS IS A SECOND ARTIFACT, NOT A SECOND CEREMONY.** A14 makes the Reckoning the
 * appointment and A5 makes it the record; nothing here changes either. This is the motion
 * *between* appointments: the countdowns, the gap, the sockets, and the authority being spent.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ## Delivery: still static, still cacheable, still no socket
 *
 * §15.5 is explicit that spectator frames are *"static cacheable frames behind Cloudflare — not
 * per-connection SSE, because the Reckoning is exactly when you have an audience"*. A live frame
 * changes that not at all: it is one small JSON file, rewritten once per tick, served with the same
 * two-second cache `latest.json` uses. **One origin fetch per two seconds serves any audience**,
 * which is the property SSE would have destroyed. A tick is the finest cadence that can exist —
 * the world only changes on one — so publishing per tick is not a choice about frequency, it is
 * the absence of one.
 *
 * ## The cost, measured rather than asserted
 *
 * Seed `g07`, 1,728 ticks, 16 members, ending with 226 ventures and 168 grants on the books:
 *
 * | | |
 * |---|---|
 * | the tick itself | **55.9 ms** |
 * | `Runtime.liveFrame()` | **1.02 ms** — 2% of the tick |
 * | `Runtime.reckoningFrame()` | 6.86 ms, once per 288 ticks |
 * | `live.json` | **11.4 KB** mean |
 *
 * Against a 300-second production tick that is 0.0003% of the budget, and it is published outside the
 * tick's own step budget (`api/server.ts` calls it after `runTick` returns) so it cannot reach `DET-9`.
 * The figure holds because every read is bounded by a book and none of them walks the ledger — see the
 * list below, and `frames/authority.ts` on the O(grants × spends) fold that had to be removed first.
 *
 * ## A9, and why it is a theorem rather than a review item
 *
 * A9 is absolute: *"the spectator client never shows a live fact an agent's own `observe` would not
 * show."* Three properties make that structural here rather than careful:
 *
 *   1. **Every key on this frame is a key `PUBLIC_FACT_KEYS` already admits**, except
 *      {@link ConvoyLine} and {@link CompactLink}, which carry their arguments on their own types.
 *      `test/frames/live.spec.ts` asserts that containment, so a key added here without a §11.2
 *      argument fails the build rather than reaching a screen.
 *   2. **Each line set is built by the same module function the Reckoning frame calls**, with the
 *      tick as its only difference — `raidLinesFor(book, tick, …)`, `battleLinesFor(book, fleet,
 *      tick, …)`, `claimLinesFor`, `tributeLinesFor`, `sapLinesFor`, `frontBands`. There is no
 *      reader argument and no second derivation, so *"could an agent see this now"* has the same
 *      answer as *"does the module return it now"*.
 *   3. **Nothing time-scoped is on it.** §11.2 has exactly three tiers whose clause is a clock —
 *      `PARTIES` (declassifies at settlement), `SENSED` (at the Reckoning boundary), `SEALED` (the
 *      season replay) — and publishing *earlier* is the only way a re-read of a `PUBLIC` fact can
 *      become a leak. So this frame carries **no rundown at all**: no `receiptReel`, no
 *      `publicLine`, no `sealVerdict`. It carries no `haul.landed` quantity. It carries a front's
 *      **cone** and never its swath, which is the risk layer's own decision. It carries dossier
 *      threads only from `revealsAtTick`, on the same clock the subject reads.
 *      {@link assertLiveFrameBudgets} refuses the shapes by name.
 *
 * ## What is NOT here, and why each was left off
 *
 * `meters.unrefined` and `standings` — whole-ledger and whole-book reads; see {@link LiveMeters}.
 * `map`, `swayLines` — fixed for the world's life, so repeating them every tick would multiply the
 * file for zero motion; a client reads them once off `latest.json` and keys these lines to them
 * (every `SystemId` here is guaranteed present in the newest Reckoning frame's `map`).
 * `places`, `hallOfFame`, `ruins`, `worksLines`, `marketLines`, `syndicateLines`, `coverArcs`,
 * `coverChains` — slow-moving; a Reckoning is the right cadence for a day's economic history.
 * `docket`, `nextDocket`, `rundown` — settlement artifacts, and the second reason above.
 *
 * ## ★ AND `tributeLines`, WHICH IS THE ONE KEY A9 ACTUALLY REFUSED
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * It looked like the best live signal on this frame — §5.2's *"continuous off-peak motion from a
 * source that cannot go quiet"*, with `DASHED → SOLID → RED` moving on 42 of 1,151 ticks in a
 * measured world — and it is **not publishable at an arbitrary tick.**
 *
 * `levy/tribute.ts:tributeStateFor` returns `SOLID` from `carriageUnderway`, which is
 * `hand.destination === place || (isPresent(hand) && hand.location === place)`. That is a **hand
 * disposition**, and §11.2 puts one at `SENSED` by name: *a ship at sea is visible; its manifest is
 * not* — and `world/sway.ts` refuses hands as an input for exactly this reason, in its own words,
 * *"a border drawn from live hand positions would put every fleet's location on a public screen and
 * delete the intel market."*
 *
 * The distinction from `raidLines` and `battleLines`, which ARE here: those publish hulls **standing
 * on a field**, which §11.2 gives to `PUBLIC` as the map's motion, and `predation/view.ts` states the
 * position outright — *"a live raid is `PUBLIC` … `raidLinesFor` has always published every one of
 * them to the spectator frame, so by A9 an agent's own `observe` was already entitled to it. What was
 * narrow was convenience."* A tribute carriage is not motion on a public lane; it is **one bit about
 * where a specific principal has sent a hand**, and no agent's `observe` answers it about anybody but
 * itself (`LevyBlock` is `my_assessment` / `paid` / `deliverable_to` and nothing about a counterparty).
 *
 * It reaches the **nightly** frame, at the settlement tick, and that is a pre-existing §11.2 question
 * for the Levy layer rather than one this artifact may decide. What is decided here is that publishing
 * it 288 times a day would make the question materially worse, so it is not published at all.
 * ══════════════════════════════════════════════════════════════════════════════
 */
export interface LiveFrame {
  /** The tick this is a projection of. Strictly increasing across published live frames. */
  readonly tick: number;
  /** Which Reckoning is in progress — **not** which one settled. */
  readonly reckoningIndex: number;
  /** Ticks to the settlement that closes this Reckoning. The clock a viewer reads. */
  readonly ticksUntilReckoning: number;
  readonly phase: LivePhase;
  /**
   * The engine's own hash at this tick.
   *
   * On the frame for the reason it is on the Reckoning frame: it is what makes a published
   * projection checkable against the record rather than trusted. It also gives a client a free
   * change detector — two polls with the same hash are the same world.
   */
  readonly stateHash: string;
  /** The Reckoning frame this live frame sits after, or null before the world's first settlement. */
  readonly lastReckoning: number | null;
  readonly meters: LiveMeters;
  /** ★ THE RAID LINE, **with its countdown still running**. */
  readonly raidLines: readonly RaidLine[];
  /** ★ THE BATTLE LINE, **with the gap still moving**. */
  readonly battleLines: readonly BattleLine[];
  /** ★ THE VENTURE RING, including `FORMING` — the empty socket the nightly frame cannot show. */
  readonly glyphs: readonly VentureGlyph[];
  /** ★ THE COMPACT LINK, while it is still a promise rather than a result. */
  readonly compactLinks: readonly CompactLink[];
  /** ★ THE CONVOY LINE. The only place it can meaningfully live: a convoy is in flight or it is not. */
  readonly convoyLines: readonly ConvoyLine[];
  /** ★ THE AUTHORITY LINE, drawn on the tick the draw happens rather than after it expired. */
  readonly authorityLines: readonly AuthorityLine[];
  /** ★ THE CLAIM TINT, with `contestable` true while the published window is open. */
  readonly claimLines: readonly ClaimLine[];
  /** ★ THE SAP, dashed through its notice window and hollow when it is starving. */
  readonly saps: readonly SapLine[];
  /** ★ THE FRONT BAND — the cone, before landfall. */
  readonly frontBands: readonly FrontBand[];
  /** The export surface, 140-char bounded, exactly as on the Reckoning frame. */
  readonly ticker: readonly string[];
}

export class FrameBudgetError extends Error {}

/**
 * ★ THE CONVOY LINE's refusals. Shared by both frames, because both draw the line.
 *
 * A convoy is the map's motion; its manifest is `SENSED`. The same executable instrument the claim,
 * works, market and sway lines carry, aimed at the one line whose subject **is** a cargo hold — so
 * it is the line where a field added for a good reason does the most damage.
 */
function convoyProblems(lines: readonly ConvoyLine[]): readonly string[] {
  const problems: string[] = [];
  for (const line of lines) {
    for (const key of Object.keys(line)) {
      if (/good|qty|quantity|lots|cargo|manifest|units|stock|held|value/i.test(key)) {
        problems.push(
          `convoy ${line.hand} carries "${key}". §11.2: a ship at sea is visible; its manifest is ` +
            'not. `haul.departed` is PUBLIC precisely because it omits the good and the quantity, ' +
            'and this line may carry no more than that row does',
        );
      }
    }
    if (line.from === line.to) {
      problems.push(`convoy ${line.hand} is drawn from ${line.from} to itself; one move is one lane`);
    }
    if (line.ticksLeft < 0) {
      problems.push(`convoy ${line.hand} renders a negative countdown (${String(line.ticksLeft)})`);
    }
  }
  return problems;
}

/** ★ THE COMPACT LINK's refusals. Shared by both frames, for {@link convoyProblems}' reason. */
function compactProblems(links: readonly CompactLink[]): readonly string[] {
  const problems: string[] = [];
  for (const link of links) {
    for (const key of Object.keys(link)) {
      if (/stock|reserve|stores|escrow|balance|holdings|inventory|seal|message/i.test(key)) {
        problems.push(
          `compact ${link.venture} carries "${key}"; a link publishes WHO it runs between and what ` +
            "rides on it, never either end's stores (SENSED) or the negotiation (PARTIES)",
        );
      }
    }
    // A link with one end is not a link. Drawing one to nowhere asserts a relationship that does
    // not exist, which is A5′ about two named agents.
    if ((link.b === null) !== (link.bAt === null)) {
      problems.push(`compact ${link.venture} names a counterparty at one field and not the other`);
    }
    // The snap is the pixel A13 names, and the state is the world's verdict. A link drawn snapped
    // over a venture that settled is the picture contradicting the record (A5′).
    if (link.snapped !== (link.state === 'DEFAULTED')) {
      problems.push(
        `compact ${link.venture} is ${link.state} and draws snapped=${String(link.snapped)}; only a ` +
          'DEFAULTED compact snaps, and a snap that is not one is a permanent public accusation',
      );
    }
    if (link.atStake < 0 || link.electiveBps < 0 || link.parties < 1) {
      problems.push(`compact ${link.venture} renders a negative quantity or no parties at all`);
    }
  }
  return problems;
}

/**
 * The A9 refusal for a live frame, as arithmetic.
 *
 * Two jobs, and they fail differently. The budgets are {@link assertFrameBudgets}' — the same
 * caps, because a line set does not become more legible for being published more often. The
 * **tier** check is this function's own and is the reason it exists: a live frame is published
 * *before* settlement, so it is the one artifact on which a `PARTIES`, `SENSED` or `SEALED` field
 * would be an early disclosure rather than a re-read.
 *
 * The check is by field NAME, which catches a known leak shape spelled a known way. That is
 * deliberately the weaker half; the strong half is that this frame has no rundown to put one on and
 * `test/frames/live.spec.ts` proves the key set is contained in `PUBLIC_FACT_KEYS`. A guard that
 * could not fail would be worse than no guard — see the mutation cases in that file.
 */
export function assertLiveFrameBudgets(frame: LiveFrame): void {
  const problems: string[] = [];

  if (frame.raidLines.length > MAX_RAID_LINES) {
    problems.push(`${frame.raidLines.length} raid lines, budget is ${MAX_RAID_LINES}`);
  }
  if (frame.battleLines.length > MAX_FRAME_BATTLE_LINES) {
    problems.push(`${frame.battleLines.length} battle lines, budget is ${MAX_FRAME_BATTLE_LINES}`);
  }
  if (frame.authorityLines.length > MAX_AUTHORITY_LINES) {
    problems.push(`${frame.authorityLines.length} authority lines, budget is ${MAX_AUTHORITY_LINES}`);
  }
  if (frame.claimLines.length > MAX_FRAME_CLAIM_LINES) {
    problems.push(`${frame.claimLines.length} claim lines, budget is ${MAX_FRAME_CLAIM_LINES}`);
  }
  if (frame.saps.length > MAX_FRAME_SAP_LINES) {
    problems.push(`${frame.saps.length} saps, budget is ${MAX_FRAME_SAP_LINES}`);
  }
  if (frame.frontBands.length > MAX_FRAME_FRONT_BANDS) {
    problems.push(`${frame.frontBands.length} front band cells, budget is ${MAX_FRAME_FRONT_BANDS}`);
  }
  if (frame.convoyLines.length > MAX_FRAME_CONVOY_LINES) {
    problems.push(`${frame.convoyLines.length} convoy lines, budget is ${MAX_FRAME_CONVOY_LINES}`);
  }
  if (frame.compactLinks.length > MAX_FRAME_COMPACT_LINKS) {
    problems.push(`${frame.compactLinks.length} compact links, budget is ${MAX_FRAME_COMPACT_LINKS}`);
  }
  if (frame.ticker.some((t) => t.length > 140)) {
    problems.push('a ticker line exceeds 140 characters');
  }

  // ── THE ONE REFUSAL THAT IS THIS FRAME'S OWN ─────────────────────────────
  //
  // §11.2's three time-scoped tiers, refused at the top level by the names their content would
  // actually be spelled. A live frame publishes before the clock those tiers declassify on, so a
  // field here is not a re-read of a public fact — it is the disclosure arriving early, which is
  // A9 inverted and is the shape `roleTags` shipped in for the combat layer's whole life.
  for (const key of Object.keys(frame)) {
    if (/receipt|reel|publicLine|seal|negotiation|message|manifest|cargo|contents/i.test(key)) {
      problems.push(
        `a live frame carries "${key}". §11.2 declassifies PARTIES at settlement, SENSED at the ` +
          'Reckoning boundary and SEALED in the season replay — a frame published mid-Reckoning is ' +
          'the one artifact on which any of those is an early disclosure rather than a re-read (A9)',
      );
    }
  }

  problems.push(...convoyProblems(frame.convoyLines), ...compactProblems(frame.compactLinks));

  if (frame.ticksUntilReckoning < 1 || frame.ticksUntilReckoning > TICKS_PER_RECKONING) {
    problems.push(
      `a live frame reports ${frame.ticksUntilReckoning} ticks to the Reckoning; the clock runs ` +
        `1..${TICKS_PER_RECKONING}`,
    );
  }

  if (problems.length > 0) {
    throw new FrameBudgetError(
      `live frame at tick ${frame.tick} violates the §17 budgets or the §11.2 ladder:\n  - ${problems.join('\n  - ')}`,
    );
  }
}

/**
 * Assert the legibility budgets. Called before a frame is written, so an
 * over-full frame is a build failure rather than a screensaver.
 *
 * This is A13 as an executable test rather than a review item: the scoring panel
 * found that mechanics bolted on to answer critics got their economics and their
 * prose but neither their pixels nor their arithmetic, and Legible scored lowest
 * of all six dimensions as a direct result.
 */
export function assertFrameBudgets(frame: ReckoningFrame): void {
  const problems: string[] = [];

  if (frame.docket.length > MAX_DOCKET_CARDS) {
    problems.push(`docket has ${frame.docket.length} cards, budget is ${MAX_DOCKET_CARDS}`);
  }
  if (frame.rundown.length > MAX_RUNDOWN_SEGMENTS) {
    problems.push(
      `rundown has ${frame.rundown.length} segments, budget is ${MAX_RUNDOWN_SEGMENTS} — a broadcast, not a batch`,
    );
  }

  // The label budget is per *frame*, so a card with seven chips and a segment
  // with seven more is still a violation when they render together.
  for (const [i, card] of frame.docket.entries()) {
    if (card.cast.length > MAX_LABELS_PER_FRAME) {
      problems.push(`docket card ${i} names ${card.cast.length} entities, budget is ${MAX_LABELS_PER_FRAME}`);
    }
  }
  for (const seg of frame.rundown) {
    if (seg.cast.length > MAX_LABELS_PER_FRAME) {
      problems.push(`rundown segment ${seg.order} names ${seg.cast.length} entities, budget is ${MAX_LABELS_PER_FRAME}`);
    }
  }

  // Ascending by stakes is the format, not a preference: the cold open is the
  // largest amount riding on an unsecured promise and the biggest betrayals are
  // held to the end.
  for (let i = 1; i < frame.rundown.length; i++) {
    const prev = frame.rundown[i - 1];
    const cur = frame.rundown[i];
    if (prev !== undefined && cur !== undefined && cur.order <= prev.order) {
      problems.push(`rundown segment order is not strictly ascending at index ${i}`);
    }
  }

  // Seal CONTENT must never appear in a nightly frame at all (§11.2: viewers get the
  // flag on the night, the content in the season replay). The field is gone from the
  // type, so this checks the shape rather than the value — a future edit that puts it
  // back, or a hand-built frame carrying it, fails here instead of on screen.
  for (const seg of frame.rundown) {
    if (Object.prototype.hasOwnProperty.call(seg, 'sealContent')) {
      problems.push(
        `segment ${seg.order} carries seal content; §11.2 releases seal content in the ` +
          'season replay, never in a nightly frame',
      );
    }
  }

  // A receipt reel only exists where a promise broke. A reel on a kept promise
  // would be the show editorialising, which A12 forbids.
  for (const seg of frame.rundown) {
    if (seg.receiptReel !== null && seg.receiptReel.length === 0) {
      problems.push(`segment ${seg.order} has an empty receipt reel; use null when there is none`);
    }
  }

  if (frame.ticker.some((t) => t.length > 140)) {
    problems.push('a ticker line exceeds 140 characters');
  }

  for (const line of frame.authorityLines) {
    if (line.dossiers.length > MAX_LINE_DOSSIERS) {
      problems.push(
        `authority line ${line.grantor}->${line.delegate} carries ${line.dossiers.length} dossier threads, ` +
          `budget is ${MAX_LINE_DOSSIERS} — convergence is the signature, a hairball is not`,
      );
    }
    // ── ★ NOTHING ON A DOSSIER THREAD MAY BE A COMPARTMENT FIGURE ─────────────
    //
    // The same guard `marketLines` and `claimLines` carry, aimed at this layer's own temptation.
    // A thread says *a compartment was disclosed, to whom, when* — and the moment it carried the
    // `digest` it would publish the subject's balance sheet to every viewer, which is §11.2's
    // ladder inverted and would make cutting a dossier on your own grantor a free way to print
    // its books. The argument is made **executable** rather than remembered, because the version
    // of this that ships is the one where somebody added a field for a good reason.
    for (const thread of line.dossiers) {
      for (const key of Object.keys(thread)) {
        // `at` is deliberately absent from this list even though a leaked figure could be
        // spelled with it: `cutAtTick` and `revealsAtTick` are legitimate and a guard that
        // produced a false problem string would halt a healthy frame, which is worse than the
        // narrower list. The words here are the ones a *figure* would actually be named.
        if (/digest|free|encumbered|balance|qty|quantity|figure|value|holds|held/i.test(key)) {
          problems.push(
            `dossier thread on ${line.grantor}->${line.delegate} carries "${key}"; a thread publishes THAT a ` +
              'compartment was disclosed and to whom, never what was in it — the figures reach the two ' +
              'holders and nobody else, ever',
          );
        }
      }
    }
  }
  if (frame.authorityLines.length > MAX_AUTHORITY_LINES) {
    problems.push(
      `${frame.authorityLines.length} authority lines, budget is ${MAX_AUTHORITY_LINES} — convergence on a few hands is the signature, a hairball is not`,
    );
  }

  if (frame.raidLines.length > MAX_RAID_LINES) {
    problems.push(
      `${frame.raidLines.length} raid lines, budget is ${MAX_RAID_LINES} — a countdown a viewer can follow, not a weather map`,
    );
  }

  // ── A13's Phase 3 signatures, budgeted like every other line set ──────────
  if (frame.frontBands.length > MAX_FRAME_FRONT_BANDS) {
    problems.push(
      `${frame.frontBands.length} front band cells, budget is ${MAX_FRAME_FRONT_BANDS} — a swept band, ` +
        'not a weather map',
    );
  }
  if (frame.coverArcs.length > MAX_FRAME_COVER_ARCS) {
    problems.push(`${frame.coverArcs.length} cover arcs, budget is ${MAX_FRAME_COVER_ARCS}`);
  }
  if (frame.coverChains.length > MAX_FRAME_COVER_CHAINS) {
    problems.push(
      `${frame.coverChains.length} cover chains, budget is ${MAX_FRAME_COVER_CHAINS} — every link is a ` +
        'principal’s name and §17 allows seven labels',
    );
  }
  for (const arc of frame.coverArcs) {
    // The arc's fill fraction IS the published escrow ratio (§7.5). An arc outside 0..BPS_ONE would be
    // a picture that disagrees with the number beside it, which is scar #1 rendered.
    if (arc.filledBps < 0 || arc.filledBps > 10_000) {
      problems.push(`cover arc ${arc.cover} is ${String(arc.filledBps)} bps filled; 0..10000`);
    }
  }
  for (const chain of frame.coverChains) {
    // A chain that reports a snap with no SNAPPED link is a caption with no picture under it.
    if (chain.snappedAt > 0 && !chain.links.some((l) => l.state === 'SNAPPED')) {
      problems.push(`cover chain ${chain.primary} says it snapped at ${String(chain.snappedAt)} but no link did`);
    }
  }

  if (frame.battleLines.length > MAX_FRAME_BATTLE_LINES) {
    problems.push(
      `${frame.battleLines.length} battle lines, budget is ${MAX_FRAME_BATTLE_LINES} — a battle gets the screen, ` +
        'and the point of the budget is not that many do',
    );
  }
  for (const line of frame.battleLines) {
    if (line.formations.length > MAX_BATTLE_FORMATIONS) {
      problems.push(
        `battle ${line.engagement} draws ${String(line.formations.length)} formation bars, budget is ` +
          `${String(MAX_BATTLE_FORMATIONS)}`,
      );
    }
    if (line.gap < 0 || line.gap > 4) {
      problems.push(
        `battle ${line.engagement} has gap ${String(line.gap)}, outside the five range cells — a client would ` +
          'draw the two lines at a distance the rules cannot express',
      );
    }
    // ── THE §11.2 REFUSAL, AS ARITHMETIC ────────────────────────────────────
    //
    // `ehpBps` is a FRACTION and never an absolute, and the ClaimLine's `fuelDue` field-shape
    // refusal is the precedent. An absolute EHP on this line is invertible into the fit — divide by
    // hull count and you have the buffer, which names the tank modules — and a fit is a manifest.
    // §11.2: *a ship at sea is visible; its manifest is not.* So the bound is checked rather than
    // documented, because the failure mode is a viewer's client quietly becoming an intel service.
    for (const bar of line.formations) {
      if (bar.ehpBps < 0 || bar.ehpBps > 10_000) {
        problems.push(
          `battle ${line.engagement} formation ${bar.formation} carries ehpBps ${String(bar.ehpBps)}, which is ` +
            'not a fraction of full. An absolute here is invertible into the fit, and a fit is a manifest (§11.2)',
        );
      }
      if (bar.hulls < 0 || bar.hullsLost < 0) {
        problems.push(`battle ${line.engagement} formation ${bar.formation} has a negative hull count`);
      }
    }
    // A closed battle with no field control leaves the record silent about who won, which is the one
    // thing a permanent public account of a fight has to say (A5, and OPS-7 halts the tick on it).
    if (line.state === 'AFTERMATH' && line.ticksLeft === 0 && line.fieldControl === null) {
      problems.push(`battle ${line.engagement} renders AFTERMATH with no field control published`);
    }
  }
  // ── §14.3 AS ARITHMETIC: THE CLIMAX CLOSES THE NIGHT ─────────────────────
  //
  // *"The ordering IS the format. Ascending by stakes, largest say-do deltas held to the end,
  // because a broken promise is the largest delta there is."* That was a comment and a comparator,
  // and the comparator had a category error in it: `atStake` compares MINOR for settlements and
  // lapses against QTY for plunders, so a plunder of 7,000 ore closed a night whose one broken
  // promise was worth 6,000 minor. Measured on the live frame — the default sat at beat 7 of 12
  // with three plunders after it.
  //
  // A comment cannot fail. This can. A broken elective promise is `SNAPPED_BLACK` on the glyph —
  // the one state the published segment exposes that means "said one thing, did another" — so the
  // rule is expressible on the contract without adding a field for it.
  const snapped = frame.rundown.filter((s) => s.glyph?.state === 'SNAPPED_BLACK');
  if (snapped.length > 0) {
    const last = frame.rundown[frame.rundown.length - 1];
    if (last?.glyph?.state !== 'SNAPPED_BLACK') {
      problems.push(
        `the rundown carries ${String(snapped.length)} broken promise(s) and ends on ` +
          `${String(last?.kind)} ${String(last?.subject)} instead. §14.3 holds the largest say-do ` +
          'delta to the end; a night that buries its own betrayal is a batch, not a broadcast',
      );
    }
  }

  for (const line of frame.raidLines) {
    // A repulse that still took goods is the arithmetic contradicting the pixel, and the
    // pixel is what a stranger believes. PRD-6 halts the tick on it; this refuses to
    // draw it, because a frame is written from a settled outcome and a settled outcome
    // that says two things is worse on screen than off.
    if (line.state === 'REPULSED' && line.lost > 0) {
      problems.push(`raid ${line.raid} renders REPULSED and carries a loss of ${line.lost}`);
    }
    if (line.lost < 0 || line.demand < 0) {
      problems.push(`raid ${line.raid} renders a negative quantity`);
    }
  }

  // ── A SYNDICATE LINE MAY NOT CONTRADICT ITS OWN CONSTITUTION ─────────────
  //
  // The legend is what a viewer believes, and the frame is a stranger's only source. A line that
  // reads STRONGBOX while reporting office-holders is publishing a contradiction about the one
  // clause every member relied on.
  if (frame.syndicateLines.length > MAX_FRAME_SYNDICATE_LINES) {
    problems.push(
      `${frame.syndicateLines.length} syndicate lines, budget is ${MAX_FRAME_SYNDICATE_LINES} — a legend a viewer reads, not a directory`,
    );
  }
  for (const line of frame.syndicateLines) {
    if (!line.treasuryOffices && line.officeHolders > 0) {
      problems.push(
        `${line.syndicate} sets treasury_offices false but renders ${line.officeHolders} office-holder(s); no office may exist over that pool`,
      );
    }
    if (line.members < 1) {
      problems.push(`${line.syndicate} renders ${line.members} members; a syndicate always holds its founder`);
    }
    if (line.treasuryMinor < 0 || line.officeHolders < 0) {
      problems.push(`${line.syndicate} renders a negative quantity`);
    }
    if (!line.treasuryOffices && !/STRONGBOX/.test(line.legend)) {
      problems.push(
        `${line.syndicate} cannot appoint offices but its legend "${line.legend}" does not say STRONGBOX — that clause is the whole reason a member pooled`,
      );
    }
    // The same shape refusal the other two lines carry. A member's own stores are SENSED, and
    // pooling does not make them public — so a field naming a member's holdings is the fuel gauge
    // in a third costume.
    for (const key of Object.keys(line)) {
      if (/memberStock|memberHold|holdings|reserve|gauge|cover/i.test(key)) {
        problems.push(
          `${line.syndicate} carries "${key}", which reads as a member's own stock — §11.2 keeps that SENSED, and pooling does not publish it`,
        );
      }
    }
  }

  // ── A WORKS MARK MAY NOT CONTRADICT ITS OWN NUMBERS ──────────────────────
  //
  // The claim tint's guard, in the same voice, for the same reason: the frame is a stranger's
  // only source, so a mark reading EXTRACTING beside a dead share — or SPINNING UP beside a live
  // one — is a published contradiction with nothing to check it against.
  // ── ★ A RUIN MAY NOT CONTRADICT ITS OWN LABEL ────────────────────────────
  //
  // Same voice, same reason, and one extra clause the works marks do not need: a ruin's whole content
  // is a claim about a *past* loss, so its Reckoning label is the only thing a viewer can check it by.
  // A ruin whose legend named a different Reckoning from its own field would be a permanent public
  // statement about when a real agent lost real capital, disagreeing with itself on one frame (A5′).
  if (frame.ruins.length > MAX_FRAME_RUINS) {
    problems.push(
      `${frame.ruins.length} ruins, budget is ${MAX_FRAME_RUINS} — a legend a viewer reads, not a graveyard`,
    );
  }
  for (const ruin of frame.ruins) {
    if (!ruin.legend.includes(`R${String(ruin.fellAtReckoning)}`)) {
      problems.push(
        `ruin ${ruin.works} is labelled "${ruin.legend}" but fell at Reckoning ${String(ruin.fellAtReckoning)} — ` +
          'a ruin\'s legend is the only thing a viewer can date it by',
      );
    }
    if (ruin.razedBy === null && ruin.razedByHandle !== null) {
      problems.push(
        `ruin ${ruin.works} names no razer but carries the handle "${ruin.razedByHandle}" — a world-spawned ` +
          'raid has no author and a frame must not invent one',
      );
    }
  }

  if (frame.worksLines.length > MAX_FRAME_WORKS_LINES) {
    problems.push(
      `${frame.worksLines.length} works marks, budget is ${MAX_FRAME_WORKS_LINES} — a legend a viewer reads, not a heatmap`,
    );
  }
  for (const line of frame.worksLines) {
    const extracting = line.legend === 'EXTRACTING';
    if (extracting && line.sharePerTick <= 0) {
      problems.push(
        `${line.works} reads EXTRACTING but quotes a share of ${line.sharePerTick} — the legend and the number disagree`,
      );
    }
    if (!extracting && line.sharePerTick !== 0) {
      problems.push(
        `${line.works} reads "${line.legend}" but quotes a live share of ${line.sharePerTick}; a WORKS that is not online extracts nothing`,
      );
    }
    if (line.sharePerTick > line.yieldPerTick) {
      problems.push(
        `${line.works} quotes ${line.sharePerTick} from a place that yields ${line.yieldPerTick} — a share can never exceed the whole`,
      );
    }
    if (line.occupants < 1) {
      problems.push(`${line.works} is drawn on ${line.system} with ${line.occupants} occupants`);
    }
    // ── THE RENT SPLIT MUST ADD UP, ON SCREEN ────────────────────────────────
    //
    // `sharePerTick` is what the resident keeps and `rentPerTick` is what the landlord takes, so
    // together they are the whole share the place hands over. A frame where they do not is a
    // frame telling a stranger that goods appeared or vanished between the ground and the
    // stores — the fuel-gauge check refuses a field that leaks; this one refuses a field that
    // lies. Checked only while EXTRACTING, because a spinning-up WORKS pays and keeps nothing.
    if (line.rentPerTick < 0 || line.rentPaid < 0 || line.rentBps < 0) {
      problems.push(`${line.works} renders a negative rent`);
    }
    if (extracting && line.sharePerTick + line.rentPerTick > line.yieldPerTick) {
      problems.push(
        `${line.works} keeps ${line.sharePerTick} and pays ${line.rentPerTick} out of a place that yields ` +
          `${line.yieldPerTick} — the split sums above the whole`,
      );
    }
    if (line.fuelPerTick < 0 || line.fuelExtracted < 0) {
      problems.push(`${line.works} renders a negative fuel quantity`);
    }
    if (!extracting && line.fuelPerTick !== 0) {
      problems.push(
        `${line.works} reads "${line.legend}" but is handed ${line.fuelPerTick} of fuel; a WORKS that is ` +
          'not online extracts nothing of either good',
      );
    }
    if (!extracting && line.rentPerTick !== 0) {
      problems.push(
        `${line.works} reads "${line.legend}" but pays ${line.rentPerTick} in rent; a WORKS that is not ` +
          'online extracts nothing, so there is nothing to take a share of',
      );
    }
    if (line.rentBps === 0 && line.rentPerTick !== 0) {
      problems.push(
        `${line.works} pays ${line.rentPerTick} in rent on unclaimed ground (${line.rentBps} bps) — the rate ` +
          'and the amount disagree, and the amount is what actually moved',
      );
    }
    // ── THE REJECTED FUEL GAUGE, REFUSED BY SHAPE RATHER THAN BY REVIEW ─────
    //
    // `extracted` — what the world has already HANDED OVER — is admissible: a sum of completed
    // public acts, one event per tick. What the holder still HAS is `SENSED`, and the two differ
    // by everything it has spent. Any field naming a stock, a reserve or a coverage figure is a
    // private stockpile wearing a public formula, which is exactly what the Charge's proposed
    // gauge was, and an outside critic had to catch that one.
    for (const key of Object.keys(line)) {
      if (/cover|remaining|reserve|stock|gauge|held/i.test(key)) {
        problems.push(
          `${line.works} carries "${key}", which reads as a stockpile — §11.2 makes hold values SENSED, and a public rate over a private stock is the fuel gauge that was rejected`,
        );
      }
    }
  }

  if (frame.claimLines.length > MAX_FRAME_CLAIM_LINES) {
    problems.push(
      `${frame.claimLines.length} claim lines, budget is ${MAX_FRAME_CLAIM_LINES} — a legend a viewer reads, not a heatmap`,
    );
  }

  if (frame.saps.length > MAX_FRAME_SAP_LINES) {
    problems.push(
      `${frame.saps.length} saps, budget is ${MAX_FRAME_SAP_LINES} — a campaign is the largest object on the map, ` +
        'so a truncated set means a war in progress is not drawn at all',
    );
  }
  for (const sap of frame.saps) {
    // The band cannot be longer than itself: `notches > notchesToReach` draws a trench past the wall,
    // which says on screen that the claim has fallen when the score says it has not (A5-PRIME).
    if (sap.notches > sap.notchesToReach) {
      problems.push(
        `sap ${sap.campaign} has advanced ${sap.notches} notches of ${sap.notchesToReach}, which draws a band ` +
          'past its objective while the score says it has not been taken',
      );
    }
    if (sap.reached !== (sap.state === 'TAKEN')) {
      problems.push(
        `sap ${sap.campaign} is ${sap.state} and draws reached=${String(sap.reached)}. Only a TAKEN campaign ` +
          'touches its objective; every other ending recoils to the depot, because nothing was taken',
      );
    }
  }
  for (const line of frame.claimLines) {
    // ── THE LEGEND AND THE STATE MUST AGREE, AND THE PIXEL IS WHAT IS BELIEVED ──
    //
    // A claim tinted `SUPPLIED` under a legend reading `NEXT MISS LAPSES` is a stranger
    // being told the wrong thing about a real agent's territory, and a stranger has no
    // second source. The state is the world's verdict, so the label is checked against it
    // rather than the other way round.
    const expectsArrears = line.state === 'STRAINED' || line.state === 'CONTESTED';
    if (expectsArrears !== line.legend.startsWith('ARREARS')) {
      problems.push(
        `claim ${line.claim} renders ${line.state} under the legend "${line.legend}"; the label and the ` +
          'legal state must say the same thing',
      );
    }
    if (line.state === 'CONTESTED' && !line.legend.includes('NEXT MISS LAPSES')) {
      problems.push(
        `claim ${line.claim} is CONTESTED and its legend does not warn that the next miss lapses it; the whole ` +
          'point of publishing the state is that the fall is visible one Reckoning ahead',
      );
    }
    if (line.state !== 'LAPSED' && line.slashed > 0) {
      problems.push(
        `claim ${line.claim} renders ${line.state} and carries a slash of ${line.slashed}; only a LAPSE slashes`,
      );
    }
    if (line.due < 0 || line.owed < 0 || line.bondAtRisk < 0) {
      problems.push(`claim ${line.claim} renders a negative quantity`);
    }
    // ── THE RENT AND ITS TENANTS MUST AGREE ──────────────────────────────────
    //
    // Rent comes out of tenants' extraction and out of nothing else, so a claim collecting with
    // nobody on the ground is the map asserting an income that has no source — the same class of
    // published contradiction as EXTRACTING beside a dead share, and worse here because a viewer
    // reading it would credit a landlord with earning what it seized from nobody. The converse is
    // legal and common: tenants that arrived this Reckoning, or a claim whose anchor collects
    // nothing yet, render tenants > 0 with `rentTaken: 0`.
    if (line.rentTaken < 0 || line.tenants < 0 || line.rentBps < 0) {
      problems.push(`claim ${line.claim} renders a negative rent`);
    }
    if (line.rentTaken > 0 && line.tenants < 1) {
      problems.push(
        `claim ${line.claim} renders ${line.rentTaken} of rent taken with ${line.tenants} tenants — rent comes ` +
          'out of another principal\'s extraction, so there is nowhere for that number to have come from',
      );
    }
    if (line.rentTaken > 0 && !line.anchorHot) {
      problems.push(
        `claim ${line.claim} renders ${line.rentTaken} of rent taken with a COLD anchor — a cold anchor ` +
          'collects nothing, so the legend and the ledger disagree about the one thing this field is for',
      );
    }
    if (line.fuelDue < 0) {
      problems.push(`claim ${line.claim} renders a negative fuel requirement`);
    }
    if (line.rentTaken > 0 && line.rentBps === 0) {
      problems.push(
        `claim ${line.claim} renders ${line.rentTaken} of rent taken at a rate of 0 bps; the rate and the ` +
          'amount disagree, and the amount is what actually moved',
      );
    }
    if (line.owed > line.due) {
      problems.push(
        `claim ${line.claim} renders ${line.owed} owed against ${line.due} due; owed is due less what was ` +
          'already destroyed and can never exceed it',
      );
    }
    // The gauge, refused at the boundary rather than in review. Any field whose name
    // suggests a division of a stockpile by a recipe is the rejected design coming back,
    // and this is the last place before a screen.
    for (const key of Object.keys(line)) {
      if (/cover|remaining|reserve|stock|gauge/i.test(key)) {
        problems.push(
          `claim ${line.claim} carries '${key}'. A frame field derived from a private stockpile is the "fuel ` +
            'gauge" §11.2 refused: it leaks reserve coverage, the limiting good, and inbound convoy contents',
        );
      }
    }
  }

  // ── A PRINT MAY NOT CONTRADICT ITS OWN PRICE ─────────────────────────────
  //
  // The claim tint's guard and the works mark's guard, in the same voice and for the same
  // reason: a stranger has no second source. A price is worse than a legend to get wrong,
  // because a viewer will do arithmetic on it — and an agent reading `market.ticker` can
  // check the frame against the record, so a frame that disagrees with the book is not merely
  // unreadable but refutable.
  if (frame.marketLines.length > MAX_FRAME_MARKET_LINES) {
    problems.push(
      `${frame.marketLines.length} market prints, budget is ${MAX_FRAME_MARKET_LINES} — a price a viewer ` +
        'can compare, not a tape',
    );
  }
  for (const line of frame.marketLines) {
    // A line exists because something traded. A print with no prints in it is the frame
    // asserting a price the world never set — the market's version of a tint over territory
    // nobody owns.
    if (line.prints < 1) {
      problems.push(
        `${line.good} at ${line.venue} is drawn with ${line.prints} prints — a price on this frame means a ` +
          'completed fill, and a line with none is a quote nobody ever made',
      );
    }
    if (line.volume < 1) {
      problems.push(`${line.good} at ${line.venue} printed ${line.prints} times and moved ${line.volume} units`);
    }
    // The span must contain the print it names, or the two numbers a viewer uses to judge how
    // current a price is contradict each other.
    if (line.firstTick > line.lastTick) {
      problems.push(
        `${line.good} at ${line.venue} spans ticks ${line.firstTick}..${line.lastTick}, which runs backwards`,
      );
    }
    if (line.prints === 1 && line.firstTick !== line.lastTick) {
      problems.push(
        `${line.good} at ${line.venue} reports one print spanning ticks ${line.firstTick}..${line.lastTick}; ` +
          'a single print happened at a single tick',
      );
    }
    if (line.lastPrice < 0 || line.vwap < 0 || line.galaxyVwap < 0) {
      problems.push(`${line.good} at ${line.venue} renders a negative price`);
    }
    // A single-venue good has nothing to compare against, so its premium must be exactly zero
    // and its legend must say why. A "0 bps" beside a sole market reads as "fairly priced",
    // which is a claim about a comparison that was never made.
    if (line.venues < 1) {
      problems.push(`${line.good} at ${line.venue} printed here and reports ${line.venues} venues trading it`);
    }
    if (line.venues < 2) {
      if (line.premiumBps !== 0) {
        problems.push(
          `${line.good} trades only at ${line.venue} and still shows ${line.premiumBps} bps of premium — ` +
            'there is no second price, so the number a viewer reads as "haul here" is invented',
        );
      }
      if (line.vwap !== line.galaxyVwap) {
        problems.push(
          `${line.good} trades only at ${line.venue} at ${line.vwap} while the galaxy figure reads ` +
            `${line.galaxyVwap} — a sole market IS the galaxy price, so these cannot differ`,
        );
      }
      if (!line.legend.includes('ONLY MARKET')) {
        problems.push(
          `${line.good} trades only at ${line.venue} and its legend reads "${line.legend}"; a viewer must be ` +
            'told that there is nothing to compare the price to (A2)',
        );
      }
    }
    // A premium with no galaxy figure behind it is a ratio over nothing.
    if (line.galaxyVwap === 0 && line.premiumBps !== 0) {
      problems.push(
        `${line.good} at ${line.venue} quotes a premium of ${line.premiumBps} bps against a galaxy price of ` +
          '0 — the ratio has no denominator, so the number on screen means nothing',
      );
    }
    // ── THE DIRECTION, CHECKED — BUT NOT THE MAGNITUDE ───────────────────────
    //
    // A sign error would send a viewer's eye, and any reader building a hauling heuristic off
    // this frame, the wrong way down the lane. So the premium may not CONTRADICT the two prices
    // beside it. It may legitimately be zero when they differ by less than one bps: demanding a
    // non-zero premium there would be a guard satisfied by fabricating a magnitude, which is
    // worse than the rounding it was trying to catch.
    if (line.vwap > line.galaxyVwap && line.premiumBps < 0) {
      problems.push(
        `${line.good} is DEARER at ${line.venue} (${line.vwap} vs ${line.galaxyVwap}) but its premium reads ` +
          `${line.premiumBps} bps`,
      );
    }
    if (line.vwap < line.galaxyVwap && line.premiumBps > 0) {
      problems.push(
        `${line.good} is CHEAPER at ${line.venue} (${line.vwap} vs ${line.galaxyVwap}) but its premium reads ` +
          `${line.premiumBps} bps`,
      );
    }
    // ── THE MANIFEST, REFUSED BY SHAPE RATHER THAN BY REVIEW ────────────────
    //
    // `market/observe.ts` puts a resting order's owner at `PRIVATE` and reasons that a resting
    // ask IS a hold value ("X has 400 of this good, here, right now"), so a raider could read a
    // manifest off a public surface without ever scouting. A fill is a deed and belongs here; a
    // book, a ladder, depth, an owner or anybody's inventory does not. Same instrument as the
    // claim line's stockpile refusal, aimed at this layer's own temptation.
    for (const key of Object.keys(line)) {
      if (/depth|resting|ladder|bid|ask|owner|principal|inventory|stock|reserve|held|escrow/i.test(key)) {
        problems.push(
          `${line.good} at ${line.venue} carries "${key}", which reads as a resting order rather than a ` +
            'completed fill — §11.2 gates the book to venues the reader has a hand at, and a galaxy-wide ' +
            'ladder on a frame is both A9 inverted and the manifest a raid is supposed to have to scout for',
        );
      }
    }
  }

  // ── ★ THE PINCH: A STRAIT MUST BE A LANE, AND MUST HAVE TWO ENDS ─────────
  //
  // A pinch drawn on a lane that is not there, or on one half of a lane, is a border a viewer
  // learns and an agent cannot plan against — and `world/sway.ts` charges a real toll at exactly
  // these edges, so a frame that disagreed with the engine here would be scar #1 with territory on
  // it. Both checks are cheap and both have a failure that renders as something plausible.
  const mapById = new Map(frame.map.map((sys) => [sys.id, sys] as const));
  for (const sys of frame.map) {
    for (const edge of sys.straits) {
      if (!sys.lanes.includes(edge.to)) {
        problems.push(
          `${sys.id} draws a STRAIT to ${edge.to} with no lane between them — a pinch is a property of a ` +
            'lane and cannot exist without one',
        );
        continue;
      }
      const other = mapById.get(edge.to);
      if (other === undefined) {
        problems.push(`${sys.id} draws a STRAIT to ${edge.to}, which is not on this frame's map`);
        continue;
      }
      const back = other.straits.find((e) => e.to === sys.id);
      if (back === undefined) {
        problems.push(
          `${sys.id}~${edge.to} is a STRAIT from one end only; a renderer drawing the pinch from ${edge.to} ` +
            'would draw an ordinary lane over the same gate',
        );
      } else if (back.detourHops !== edge.detourHops || back.severs !== edge.severs || back.severed !== edge.severed) {
        problems.push(
          `${sys.id}~${edge.to} reports different numbers at each end (${edge.detourHops}/${edge.severed} vs ` +
            `${back.detourHops}/${back.severed}); one lane is one fact`,
        );
      }
      if (edge.severs !== (edge.detourHops === 0)) {
        problems.push(
          `${sys.id}~${edge.to} reports severs=${String(edge.severs)} with detourHops=${edge.detourHops}; a ` +
            'lane either has a way around it or it does not',
        );
      }
      // A8, on the surface a viewer reads. The engine refuses this at map construction
      // (`assertStraits`), and it is checked again here because the frame is a second rules
      // surface: a pinch drawn on a civic route teaches a viewer that the Commons can be
      // blockaded, which §16.1 MUST-3 promises it cannot.
      if (sys.tier === 'COMMONS' || other.tier === 'COMMONS') {
        problems.push(
          `${sys.id}~${edge.to} draws a STRAIT touching the COMMONS (${sys.tier}/${other.tier}); the Commons ` +
            'keeps a protected civic route and A8 is a floor, not a default',
        );
      }
    }
  }

  // ── ★ THE VERGE: A FENCE WITH NO HOLES IN IT ─────────────────────────────
  //
  // The budget is a ceiling on the map rather than a selection (see `MAX_FRAME_SWAY_LINES`), and
  // the rest of these guards exist because every one of them has a failure that renders as a
  // *plausible* border: a named principal at sway 0 draws a fence around ground it cannot reach,
  // and an unnamed one at sway 3 draws bare ground somebody owns.
  if (frame.swayLines.length > MAX_FRAME_SWAY_LINES) {
    problems.push(
      `${frame.swayLines.length} sway lines, budget is ${MAX_FRAME_SWAY_LINES} — THE VERGE is a fence and a ` +
        'fence cannot be sampled; a dropped system reads as ground nobody reaches',
    );
  }
  for (const line of frame.swayLines) {
    if (!mapById.has(line.system)) {
      problems.push(`a sway line names ${line.system}, which is not on this frame's map`);
      continue;
    }
    if (mapById.get(line.system)?.tier === 'COMMONS') {
      problems.push(
        `${line.system} is COMMONS and carries a sway line; hostile action there is INVALID rather than ` +
          'contested, so drawing a border across it would teach a viewer the floor is negotiable (A8)',
      );
    }
    if ((line.principal === null) !== (line.sway === 0)) {
      problems.push(
        `${line.system} names ${String(line.principal)} at sway ${line.sway}; a named reacher has 1 or more ` +
          'and bare ground has exactly 0 — the two fields are one fact',
      );
    }
    if (line.sway < 0 || line.reachers < 0) {
      problems.push(`${line.system} renders a negative sway (${line.sway}) or reacher count (${line.reachers})`);
    }
    if ((line.reachers === 0) !== (line.principal === null)) {
      problems.push(
        `${line.system} reports ${line.reachers} reacher(s) and ${String(line.principal)} as the strongest; ` +
          'a system with a strongest reacher has at least one, and one with none has no strongest',
      );
    }
    // The stockpile refusal, the third layer to carry it. A border is the most tempting place to
    // hang "and this is what they have there", which is precisely the `SENSED` quantity the claim
    // line's own guard refuses — and hand positions, which sway is deliberately not derived from.
    for (const key of Object.keys(line)) {
      if (/stock|reserve|held|cargo|hand|goods|stores|escrow|cover|remaining/i.test(key)) {
        problems.push(
          `${line.system}'s sway line carries "${key}"; a border is derived from HOLDINGS and CLAIMS, both ` +
            'PUBLIC, and never from hands or stores — §11.2 keeps a ship visible and its manifest not',
        );
      }
    }
  }

  // ── ★ THE CONVOY LINE AND THE COMPACT LINK ───────────────────────────────
  //
  // Budgeted and refused with the same instruments as every other line set, and with the same
  // helpers the live frame uses — one set of rules, two artifacts, so a shape refused on one can
  // never be publishable on the other.
  if (frame.convoyLines.length > MAX_FRAME_CONVOY_LINES) {
    problems.push(
      `${frame.convoyLines.length} convoy lines, budget is ${MAX_FRAME_CONVOY_LINES} — motion a viewer ` +
        'can follow, not a traffic map',
    );
  }
  if (frame.compactLinks.length > MAX_FRAME_COMPACT_LINKS) {
    problems.push(
      `${frame.compactLinks.length} compact links, budget is ${MAX_FRAME_COMPACT_LINKS} — a night cannot ` +
        'narrate more compacts than it can draw',
    );
  }
  problems.push(...convoyProblems(frame.convoyLines), ...compactProblems(frame.compactLinks));

  // ── ★ §14'S STRIP MUST BE ASSEMBLABLE FROM THE FRAME ALONE ────────────────
  //
  // ══════════════════════════════════════════════════════════════════════════
  // §14 requires *"the grant, the accepted warning, the seal, the deed and the negotiation text on one
  // strip"*. The deed is a rundown segment; the accepted warning is an authority line's two LIMITS;
  // and the pointer between them is a `GrantId`. **A published `grant` id that no line on the same
  // frame resolves is a dangling pointer, and a strip that cannot be assembled is a signature that
  // does not exist (A13).**
  //
  // This is the same rule `claimLines`, `worksLines` and `swayLines` are already checked against the
  // frame's own `map` for, applied to the one pointer the marquee artifact depends on. It is exempt
  // only when the twelve-line budget is genuinely full — `rankAuthorityLines` puts a named grant
  // FIRST for that reason, so the exemption is reachable only when more than `MAX_AUTHORITY_LINES`
  // distinct grants are named on one night, and refusing the whole frame over a legitimate
  // truncation would be an agent-reachable outage in the show (AGT-X9's shape).
  // ══════════════════════════════════════════════════════════════════════════
  const resolvable = new Set<string>(frame.authorityLines.map((l) => String(l.grant)));
  if (frame.authorityLines.length < MAX_AUTHORITY_LINES) {
    const named: { readonly where: string; readonly grant: string }[] = [
      ...frame.rundown.filter((s) => s.grant !== null).map((s) => ({ where: `rundown ${s.subject}`, grant: String(s.grant) })),
      ...frame.docket.filter((c) => c.grant !== null).map((c) => ({ where: `docket ${String(c.venture)}`, grant: String(c.grant) })),
      ...frame.compactLinks
        .filter((l) => l.grant !== null)
        .map((l) => ({ where: `compact ${String(l.venture)}`, grant: String(l.grant) })),
    ];
    for (const ref of named) {
      if (!resolvable.has(ref.grant)) {
        problems.push(
          `${ref.where} names grant ${ref.grant}, and no authority line on this frame carries it. §14's ` +
            'receipt reel puts the grant beside the deed on one strip, and a pointer into nothing is a ' +
            'strip a renderer cannot assemble',
        );
      }
    }
  }

  // A link, a convoy and a sway line all key to a system, and `claimLines`/`worksLines`/`marketLines`
  // are already checked against the map for this reason: a renderer cannot place a line whose
  // endpoint is not on the same frame's topology, and a silently unplaceable line reads as no line.
  for (const line of frame.convoyLines) {
    for (const at of [line.from, line.to]) {
      if (frame.map.length > 0 && !mapById.has(at)) {
        problems.push(`convoy ${line.hand} names ${at}, which is not on this frame's map`);
      }
    }
  }

  if (problems.length > 0) {
    throw new FrameBudgetError(
      `frame for Reckoning ${frame.reckoningIndex} violates the §17 legibility budgets:\n  - ${problems.join('\n  - ')}`,
    );
  }
}
