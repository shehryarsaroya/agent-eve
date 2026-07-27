import type { HallOfFameRow, PlaceName } from './memory.js';
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
  ClaimState,
  Handle,
  HoldingId,
  PrincipalId,
  RaidState,
  SealVerdict,
  ConstellationId,
  SystemId,
  VentureId,
  ZoneTier,
} from '../core/types.js';
import type { Minor, Qty } from '../core/units.js';

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
 * Works marks a frame may draw. *(calibrate)*
 *
 * Larger than the claim budget because a WORKS is cheaper than a claim and there will be more
 * of them — but still a legend a viewer reads rather than a heatmap. Overflow drops the LEAST
 * crowded, so the contested seams survive the cut.
 */
export const MAX_FRAME_WORKS_LINES = 16;

/** Syndicate lines a frame may draw. Fewer than works marks: an org is a bigger object. *(calibrate)* */
export const MAX_FRAME_SYNDICATE_LINES = 8;
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
export type AuthorityLineState = 'UNUSED' | 'DRAWN' | 'EXHAUSTED' | 'REVOKED';

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
   * UNUSED nothing drawn on EITHER limit · DRAWN some headroom used · EXHAUSTED no
   * headroom left on either limit · REVOKED ending next tick.
   */
  readonly state: AuthorityLineState;
}

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
  /** Sovereignty's signature (§6.3, A13): who owes upkeep on what, and who is about to lose it. */
  readonly claimLines: readonly ClaimLine[];
  readonly worksLines: readonly WorksLine[];
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
  readonly hallOfFame: readonly HallOfFameRow[];
  readonly syndicateLines: readonly SyndicateLine[];
  /** The topology, so the map can be drawn at all (A13). Fixed per world. */
  readonly map: readonly MapSystem[];
  readonly glyphs: readonly VentureGlyph[];
  /** One line, 140 chars, tick-stamped. The export surface. */
  readonly ticker: readonly string[];
  /** Tomorrow's docket, as the closing card. */
  readonly nextDocket: readonly DocketCard[];
}

export class FrameBudgetError extends Error {}

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

  if (problems.length > 0) {
    throw new FrameBudgetError(
      `frame for Reckoning ${frame.reckoningIndex} violates the §17 legibility budgets:\n  - ${problems.join('\n  - ')}`,
    );
  }
}
