/**
 * `observe` — a decision document, not telemetry (SPEC §12.1).
 *
 * **Exactly ten top-level keys, and the budget is at its ceiling** (§17): adding
 * one means removing one, and `test/api/observe.test.ts` counts them rather than
 * trusting anybody's intentions. The names and their order are `agent.md` §6's,
 * because a player reads that document once and then pattern-matches on shape.
 *
 * Three properties this file exists to hold:
 *
 *   - **`affordances` is complete by eligibility, and every omission is counted.**
 *     PROP-O1: truncation is invisible to tests and, from the agent's side,
 *     indistinguishable from the world changing underneath it. So the list is
 *     filtered by legality first, ordered deterministically second, and only then
 *     capped — with an exact count and a reason. Never silently.
 *   - **Every affordance carries all six honesty fields** (PROP-O4). A missing
 *     `max_direct_loss` is not a smaller payload, it is the core loop's honesty
 *     guarantee gone.
 *   - **A repeat fetch inside one tick is byte-identical and free** (PROP-O6, A4).
 *     Memoised per `(principal, tick)` — correct by construction, because snapshot
 *     T is frozen for the whole window — which is also why polling faster buys
 *     nothing at all.
 *
 * **The wake budget is enforced here** (§12.4). Outside a wake, `observe` returns
 * the cached tick snapshot with no fresh affordances and no new `quote_id` —
 * legal, free, and useless. That is what makes A4 enforceable for the first time:
 * a bigger inference budget cannot buy a bigger information set.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THIS FILE HAS A RIVAL AND ONE OF THEM MUST GO.**
 *
 * `src/observe/` landed in parallel and is a second, independent implementation of
 * the same ten keys — affordances, corrections, withheld, briefing, quote — with its
 * own tests and no transport wired to it. This one is what the server serves.
 *
 * Two homes for the observation is two homes for the *rules surface an agent plays
 * from*, which is scar #1's exact shape rather than a tidiness complaint. The
 * recommendation is that `src/observe/` wins, this file is deleted, and `server.ts`
 * is adapted onto it. Recorded here as well as in `server.ts` so that whichever file
 * a reader opens first, they learn there is another.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { canonicalHash, shortHash, type CanonicalValue } from '../core/canonical.js';
import {
  FREEZE_TICKS,
  TICKS_PER_RECKONING,
  WAKES_PER_RECKONING,
  inCommitmentWindow,
  inFreeze,
  isSettlementTick,
  reckoningIndex,
  ticksUntilReckoning,
} from '../core/time.js';
import type { GoodId, Grant, PrincipalId, Standing, SystemId, VentureId, VentureKind } from '../core/types.js';
import { BPS_ONE, minor, type Minor } from '../core/units.js';
import { storesAccount } from '../ledger/index.js';
import {
  MAX_ORDER_QTY,
  freeCash,
  sellableGoods,
  tradeCheck,
  tradeObstacles,
  type PublicBook,
  type VenueId,
} from '../market/index.js';
import { ACTIONS_PER_TICK } from '../core/time.js';
import {
  creatorElective,
  escrowRatioBps,
  escrowRequired,
  IN_FULL,
  isLive,
  kindSpec,
  maxElectiveBps,
  minElectiveBps,
  openIndices,
  partiesOf,
  pinnedValue,
  roleOfPrincipal,
  yourTakeAtP50,
  type CreatorElective,
  type VentureRecord,
} from '../venture/index.js';
/**
 * §7.1: "there is one function that answers 'what is this role owed', and both the quote
 * and the payout read it." {@link slotClaimAt} is that function with the holder lookup
 * lifted out — which is the only way to price a slot **nobody holds yet**, and therefore
 * the only way `board[].your_take_at_p50` can be anything but zero.
 */
import { slotClaimAt } from '../observe/forecast.js';
import {
  AGGRESSION_PER_RECKONING,
  DEMAND_WINDOW_TICKS,
  FORCE_BY_TIER,
  RAID_DEMAND_QTY,
  RAID_JOIN_STAKE_MINOR,
  RAID_TAKE_MULTIPLE,
} from '../predation/index.js';
// ── PARLEY (§3) — the direct address, and the price on it ────────────────────
//
// The rule lives in `say/`, not here: this file publishes the menu and `runtime.parleyRefusalFor`
// is the one gate both it and the verb ask. Only the two published constants are imported, so a
// `withheld` sentence quoting the allowance cannot quote a different number than the engine charges.
import { PARLEYS_PER_RECKONING } from '../say/parley.js';
import { MAX_REACH_ROWS } from '../say/reach.js';
// ── COMBAT (SPEC §9A) ───────────────────────────────────────────────────────
//
// The offer BUILDERS live in `combat/view.ts`, not here. This file is 3,300 lines and the last two
// affordances added to it went in the wrong place — the `refine` offer was spliced inside `build`'s
// `if (affordable && !alreadyHeld)` and was never shown to anyone holding ore, who by definition
// already hold a WORKS. So combat's offers are a function of their inputs in their own module and
// this is the adapter that gathers them.
import { engageOffersFor, hullOfferFor, hullQuote } from '../combat/index.js';

/**
 * Combat offers in one observation. INV-26: every list here is bounded.
 *
 * Four rather than three: a commit is offered per (hull × echelon) and a battle worth entering is a
 * battle worth entering *somewhere specific*, so the menu has to be able to show a screen and a main
 * line for the same hull. Beyond four it stops being a decision and becomes a table.
 */
const MAX_COMBAT_AFFORDANCES = 4;

/**
 * The hull the `build` offer proposes, and its fit.
 *
 * **One offer, not thirty-five.** Five hulls × twenty-nine modules is a combinatorial menu, and
 * §12.1's budget is enforced by eligibility filtering rather than truncation — so the honest move is
 * to offer *one complete, legal, useful* fit and say in the prose that simulating any other is free
 * and unlimited. A menu that listed every hull would crowd out the rest of the observation and would
 * still not contain the fit an agent wanted.
 *
 * The PIKE because it is the cheapest hull in the game and the one §3 MUST-1 calls *"the best answer
 * to how can a new agent matter immediately"* — a frigate that catches a battleship. And a TACKLE fit
 * rather than a gun fit, because `POINT` is the module that decides who leaves the field, which is
 * §12 relationship #3 and the thing without which *"agents rationally disengage."*
 */
const STARTER_HULL = 'PIKE';
const STARTER_FIT: readonly string[] = ['SMALL_GUN', 'POINT', 'WEB', 'AFTERBURNER'];

/**
 * Demands offered in one observation. INV-26: every list here is bounded.
 *
 * Small on purpose and not only for the budget: the capacity is {@link AGGRESSION_PER_RECKONING}
 * per cycle, so a menu of twelve targets would be twelve rows an agent can act on twice. Three
 * is enough to make it a choice about *whom* — which is the decision §9 wants — without turning
 * the affordance list into a directory of everybody standing nearby.
 */
const MAX_DEMAND_AFFORDANCES = 3;

/**
 * Distinct refusal sentences carried into `withheld` when every candidate target was refused.
 *
 * Two, not one: the interesting case is a *mixed* answer — one neighbour under a live raid and
 * another behind a stage hold are different problems with different fixes, and collapsing them
 * would tell an agent to wait out a clock that is not the one blocking it. Beyond two the row
 * stops being a reason and becomes a log (INV-26 wants a bound either way).
 */
const MAX_DEMAND_REFUSAL_REASONS = 2;
import {
  ANCHOR_QTY,
  ARREARS_STATEMENT,
  CESSION_SALVAGE_BPS,
  CHARGE_BALLOT,
  CHARGE_GOOD,
  CHARGE_STATEMENT,
  CLAIM_BOND_MINOR,
  FUEL_STATEMENT,
  PUBLISHED_DEFAULT_CHARGE_RULE,
  SOVEREIGNTY_STATEMENT,
  chargeBallotWindow,
  chargeConstituencyOf,
  type ClaimView,
} from '../sovereignty/index.js';
// Campaigns (§16.6). The constants the affordance publishes; the gates themselves live in
// `src/campaign/` and the verbs run the same predicates this file probes through.
import {
  type CampaignView,
  CAMPAIGN_SALVAGE_BPS,
  LAST_DECLARE_PHASE,
  MATERIEL_GOOD,
  PULSE_MATERIEL_QTY,
} from '../campaign/index.js';
import { LEVY_BALLOT, LEVY_GOOD, LEVY_RULES, PUBLISHED_DEFAULT_RULE } from '../levy/index.js';
import { syndicateAsPrincipal } from '../syndicate/book.js';
import { DEFAULT_CHARTER } from '../syndicate/charter.js';
import { FOUNDING_COST_MINOR, MAX_SYNDICATES_PER_PRINCIPAL } from '../syndicate/params.js';
import {
  ALLOY_ANCHOR_QTY,
  ALLOY_GOOD,
  ALLOY_IN_BY_TIER,
  ALLOY_OUT_QTY,
  ALLOY_TIER,
  FUEL_GOOD,
  REFINE_IN_QTY,
  REFINE_OUT_QTY,
  WORKS_GOOD,
  WORKS_YIELD_GOOD,
} from '../works/params.js';
import { tierRates } from '../works/refine.js';

/**
 * The goods a `haul` row is offered for, in canonical order.
 *
 * **All four, not just the interesting one.** The temptation is to offer `alloy` alone, since that is
 * the good this verb was built for — and that would reproduce, in the menu, exactly the asymmetry the
 * verb exists to remove: `fuel` is FRONTIER-only and a landlord that bought some at a tenant's venue
 * would have no offered way to bring it to its anchor, while `ore` and `ration` are what a Commons
 * manufacturer needs to *import*. A list that named one good would make the other three's trades
 * legal-but-unoffered, which is this repo's defining defect written into the fix for it.
 */
const HAULABLE_GOODS: readonly GoodId[] = Object.freeze([
  ALLOY_GOOD,
  FUEL_GOOD,
  WORKS_GOOD,
  WORKS_YIELD_GOOD,
]);
import type { SealRoleRef } from '../seal/index.js';
import {
  AUDIT_LAG_TICKS,
  compartmentDigest,
  DELEGABLE_VERBS,
  isCompartment,
  officeShape,
  type Dossier,
} from '../grant/index.js';
import {
  commonsBoundRejection,
  GRADUATION_STATEMENT,
  HANDS_PER_PRINCIPAL,
  isStrait,
  SWAY_STRAIT_TOLL,
  LODE_STATEMENT,
  handsOf,
  holdingOf,
  isPresent,
  MAX_HAUL_QTY,
  occupiesSystem,
  principalIsCommonsBound,
  neighboursOf,
  tierOf,
  transitTicks,
} from '../world/index.js';
import {
  defaultTerms,
  DELIVERY_MEASURE,
  DELIVERY_VERB,
  ELECTABLE_VENTURE_STATES,
  FORMATION_WINDOW_TICKS,
  type PendingCorrection,
  type Runtime,
  MAX_GRANT_OFFERS,
} from '../sim/runtime.js';

/** Re-exported from its new home in `sim/runtime.ts`, where the eligibility rule lives. */
export { MAX_GRANT_OFFERS };

/** Ticks a `quote_id` pins its inputs for (§12.3: "1–3 ticks"). */
export const QUOTE_PIN_TICKS = 3;

/**
 * Affordances served in one observation.
 *
 * A cap is unavoidable — an uncapped list built from every hand × every lane ×
 * every open role is unbounded input turned into unbounded output, which is scar
 * #3 through a read endpoint. What makes it compatible with PROP-O1 is that
 * nothing is dropped *uncounted*: `header.withheld` carries the exact number and
 * the reason, always, including when it is zero.
 */
export const MAX_AFFORDANCES = 64;

/** Rows served in any list inside an observation. Bounded (INV-26). */
export const MAX_LIST_ROWS = 24;

/**
 * How many `grant` offers the menu carries at once.
 *
 * Small on purpose. A6 is the core loop and the list is the only place most players will meet it,
 * but an office is the heaviest thing an agent can hand out — so the menu shows the two best-attested
 * candidates rather than everyone with a record, and an agent that wants a different delegate names
 * one itself. *(calibrate)*
 *
 * **It is not the cap on the DOSSIER list.** See {@link MAX_DOSSIER_OFFERS} — 5C-bis borrowed this
 * constant, and a cap sized for "who should I promote?" silently deleted "whose books may I leak?".
 */


/**
 * How many `message {to, dossier}` rows the menu carries at once — the **sight** half of A6.
 *
 * Its own constant, because it answers a different question from {@link MAX_GRANT_OFFERS}: not *how
 * many candidates is it decent to suggest*, but *how many live capabilities may this list omit*. The
 * answer §6 forces is "none it does not count", and the answer a probe measured was two rows out of
 * four, both spent on the same grantor, with nothing in `withheld` to say so.
 *
 * Sized against the shape of the thing being enumerated rather than picked for taste: a row is a
 * `(grantor, compartment)` pair, `COMPARTMENTS` has two members, so six rows covers three grantors
 * exhaustively — and because {@link clearanceOffers} fills it breadth-first, six *distinct grantors*
 * each get a row before any grantor gets a second. A delegate with more cleared grantors than that is
 * a case the count and the ground now name explicitly. *(calibrate)*
 */
export const MAX_DOSSIER_OFFERS = 6;

/**
 * `message {to}` rows the menu carries at a time (§3's PARLEY).
 *
 * Sized against the **allowance** rather than against the reach set, which is the deliberate part:
 * `PARLEYS_PER_RECKONING` is 3, so an agent can act on three of these in a cycle and a menu of thirty
 * would be twenty-seven rows an agent reads, ranks and cannot take. Six leaves it a genuine choice —
 * the decision the expiring allowance exists to force is *whom*, and a choice of three from three is
 * not one — while `MAX_REACH_ROWS` (32) stays the bound on what the engine will accept, and
 * `header.withheld` names every principal dropped so the agent can still construct the call.
 * *(calibrate)*
 */
export const MAX_PARLEY_AFFORDANCES = 6;

/**
 * Kinds offered as a `create` affordance.
 *
 * RAID and SIEGE are excluded because they are hostile and every newcomer is Commons-seated, where a
 * hostile act is *invalid* rather than merely refused (A8) — offering one would be offering a move
 * the floor will always reject. LEVY is the world's own obligation, not a deal an agent opens.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **`BUILD` IS HERE NOW, AND ITS ABSENCE WAS THE COSTLIEST OMISSION ON THIS LIST.**
 *
 * The original reason read: *"the two-role kinds only: a four-role kind needs four
 * independently-capitalised principals to be live in one window, and offering it to a newcomer with
 * three hands and nobody to call is an affordance that cannot be taken."* That conflates two
 * different things, and the difference is this file's whole standard:
 *
 *   - **an act the engine would REFUSE** must not be offered (AGT-S2, and it costs a real action);
 *   - **a deal nobody might take** is a judgement about other agents, which §1 says is the game.
 *
 * `create {kind: "BUILD"}` is legal, always was, and works when sent by hand. It escrows **nothing**
 * — top-yield kinds are un-escrowable — so it passes the affordability gate below trivially, and if
 * no counterparty ever fills a role it retires ABANDONED at window close having cost one action and
 * zero currency. There is no refusal to protect anybody from.
 *
 * What its absence cost: `BUILD` is the only venture in the game that is 100% elective at four roles,
 * which makes it the only one where a large amount of trust is genuinely at risk — the *"grand
 * venture"* shape §7.6 says the design needs to make defection ever rational. **The LLM cast is
 * prompted from this same observation.** So no agent in this world has ever been shown the four-role
 * fully-unsecured venture the entire social premise rests on, and `AGT-E2` — *is trust priced?* — was
 * being asked of a world where the instrument that prices it was never on the menu.
 *
 * It was not counted in `withheld` either, against §6's *"we never truncate this list"*. A capability
 * that exists, is legal, and is never offered reads exactly like one that is missing (the diagnosis
 * that took three tries on the empty panels), and this is the third time that shape has cost a
 * mechanic.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * **It is LAST, and the order is load-bearing.** The prioritiser below keeps *the first offer of each
 * verb* ahead of every repeat, so whichever kind is first here is the one guaranteed to survive
 * truncation and the one a blind copier takes. Put `BUILD` first and every agent that copies its
 * highest affordance opens a four-role fully-unsecured venture and nothing else — the daily texture
 * the economy runs on comes from the two-role kinds, and it would stop. Last means the ordinary loop
 * keeps the guaranteed slot and `BUILD` is offered beside it; if the list ever truncates that far, the
 * drop is counted in `header.withheld` with its reason, which is the standard this file holds itself to
 * everywhere else.
 */
export const OFFERED_KINDS: readonly VentureKind[] = Object.freeze([
  'DIG',
  'HAUL',
  'ESCORT',
  'SURVEY',
  'BUILD',
]);

export interface Affordance {
  readonly verb: string;
  readonly params: Readonly<Record<string, unknown>>;
  /** Material actions this consumes. Zero for free verbs and free services. */
  readonly cost: number;
  /** **Exact**, never an estimate (A2). The most this act can cost you. */
  readonly max_direct_loss: number;
  readonly max_contingent_liability: number;
  readonly what_it_forecloses: string;
  readonly expires_tick: number;
  /** Null only outside a wake, where nothing is pinned (§12.4). */
  readonly quote_id: string | null;
}

export interface Withheld {
  readonly count: number;
  /**
   * ★ **WHICH VERBS THE COUNT IS ABOUT, MACHINE-READABLE.** Sorted, deduped, possibly empty.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * `withheld` closed with *"Nothing you were eligible for has been dropped without this
   * count"* and had **no mechanism connecting that promise to the verb set**. Every row was
   * hand-written per mechanic, so a mechanic could ship with no row at all — and one did:
   * `trade` was silent in **86% of observations** across a swept world (497 of 576), with a
   * reachable venue in every one of them.
   *
   * `test/api/agt-r5-reachability.test.ts` did not catch it and could not: it asks *"is every
   * live verb offered SOMEWHERE"*, a global property, and it passes. The property that broke is
   * per-observation — *"when this verb is absent for THIS principal on THIS wake, is the absence
   * accounted for"* — and nothing checked it because nothing could: the accounting existed only
   * as prose, and prose is not reconcilable against `header.live_verbs`.
   *
   * So each row is now **tagged with the verb it explains**, and this field is that tagging
   * published. It costs about thirty bytes, it saves an agent parsing a paragraph to learn
   * whether the thing it wanted is missing or merely withheld, and it makes
   * `test/api/withheld-is-accountable.spec.ts` possible at all.
   * ══════════════════════════════════════════════════════════════════════════
   */
  readonly verbs: readonly string[];
  readonly reason: string;
}

/**
 * One withheld row: the sentence, and **the verb whose absence it accounts for**.
 *
 * `verb: null` is for the rows that are about a *list* rather than a verb — the affordance
 * truncation, `ventures.board[]`'s own cap, a mechanic that has not landed. Those are real
 * omissions and stay counted; they simply do not exonerate any particular verb, and pretending
 * they did would make {@link Withheld.verbs} lie in the one direction that matters.
 */
interface WithheldRow {
  readonly verb: string | null;
  readonly text: string;
}

export interface Observation {
  readonly header: Readonly<Record<string, unknown>>;
  readonly hands: readonly Readonly<Record<string, unknown>>[];
  readonly holding: Readonly<Record<string, unknown>>;
  readonly obligations: Readonly<Record<string, unknown>>;
  readonly ventures: Readonly<Record<string, unknown>>;
  readonly counterparties: readonly Readonly<Record<string, unknown>>[];
  readonly grants: Readonly<Record<string, unknown>>;
  readonly market: Readonly<Record<string, unknown>>;
  readonly affordances: readonly Affordance[];
  readonly briefing: Readonly<Record<string, unknown>>;
}

/** The ten keys, in `agent.md` §6's order. Asserted, not assumed. */
export const OBSERVE_KEYS: readonly string[] = Object.freeze([
  'header',
  'hands',
  'holding',
  'obligations',
  'ventures',
  'counterparties',
  'grants',
  'market',
  'affordances',
  'briefing',
]);

export interface ObserveInput {
  readonly runtime: Runtime;
  readonly principal: PrincipalId;
  /** Wall-clock milliseconds, from the injected clock. Display only. */
  readonly serverNowMs: number;
  /** False outside a wake: no fresh affordances, no new quote (§12.4). */
  readonly fresh: boolean;
  readonly wakesRemaining: number;
  /** True while the world is PAUSED: the last good snapshot, marked stale. */
  readonly stale: boolean;
  /**
   * Refusals that could only be known after the tick resolved, drained by the caller
   * so that reading an observation is what delivers them exactly once.
   *
   * **Drained by a WAKE and peeked by everything else** (`Runtime.peekCorrections`).
   * The caller decides which, and it must decide explicitly — `server.ts:observe` takes
   * `drain` with no default, because the whole of Defect 1 was two call sites that
   * omitted the argument and got the destructive branch for free.
   */
  readonly corrections: readonly PendingCorrection[];
  /**
   * How many older refusals the per-principal ring **threw away** at
   * `MAX_PENDING_CORRECTIONS`, so an agent can tell "dropped" from "never recorded".
   *
   * `Ring` has counted its drops since it was written and nothing read the counter, so
   * a principal that refused seventeen actions between two wakes was told about sixteen
   * and had no way to know. It matters more now than it did: before Defect 1 was fixed,
   * every `POST /act` emptied the ring, so the cap was effectively unreachable and this
   * number would have been zero forever — a bound that hides is exactly the shape
   * `MAX_RECKONING_SUMMARIES` and `LEVY_RETAINED_RECKONINGS` already cost this repo.
   */
  readonly correctionsDropped: number;
  /**
   * Material actions the caller may still send into the **open window**.
   *
   * Supplied rather than read off `ActionBudget`, because the budget is charged at
   * resolution and answers for the tick that just closed — see the long note on
   * `windowSpend` in `server.ts`. Injected so this module has exactly one source for
   * the number and no opinion about how it is counted.
   */
  readonly actionsRemaining: number;
}

/**
 * Build an observation.
 *
 * Pure with respect to the runtime: it reads and never writes, so a second call in
 * the same tick produces the same bytes and the memoisation in `server.ts` is a
 * cache rather than a behaviour.
 */
export function buildObservation(input: ObserveInput): Observation {
  const { runtime, principal } = input;
  /**
   * The tick the agent is acting from, clamped at zero.
   *
   * `engine.tick` is "the last tick that published" and it is **-1 before the first
   * one has**. Reporting -1 breaks PROP-O8 immediately and invisibly: `-1` is 287
   * ticks into the previous Reckoning, so `next_reckoning.ticks` reads 1 on the first
   * fetch and 288 on the second, and an agent that trusted the countdown would
   * conclude it had one tick to act and then that the day had restarted. A world with
   * nothing published is at tick 0 with nothing resolved, and that is what it says.
   */
  const tick = Math.max(0, runtime.engine.tick);
  const world = runtime.world;
  const hands = handsOf(world, principal);
  const holding = holdingOf(world, principal);
  // ── ONE SOLVE, LIKE THE BOARD AND THE MARKET BLOCK ──────────────────────
  //
  // The claim rows are read once and used by `holding.threats`, `holding.upkeep_due_qty`,
  // `obligations.charge` and the affordance list. Solving them four times would let the
  // alarm, the bill and the act disagree about what is owed inside one payload — the
  // two-homes shape of scar #1 with territory attached — and it is also four walks of the
  // claim book per observation.
  const myClaims = runtime.claimsFor(principal, tick);
  // Read once and passed to both the `holding` block and the affordance layer. Two calls would be two
  // force readings of the same war in one observation, and `readCampaignForce` is recomputed rather
  // than cached — so they could disagree inside a single payload (scar #5's shape in a projection).
  const myCampaigns = runtime.campaignsFor(principal, tick, MAX_LIST_ROWS);
  const mine = runtime.ventures.forPrincipal(principal);
  // ── READ ONCE, FOR THE `grants` BLOCK *AND* THE DILEMMA SENTENCE ────────────
  //
  // Both of these were derived a second time inside `promptFor` when the A6 branch landed, which is
  // the mistake this file already names twice (`books`, `campaignViews`): a projection and the prose
  // that points at it must come off one read, or they can disagree inside a single payload. It is
  // also the cheaper arrangement — `forGrantor` sorts the whole grant book on every call and
  // `visibleToSubject` walks every dossier, and doing that twice per observation showed up as a
  // measurable slowdown in `blind-play`'s 200-tick gate.
  const myGrantsOut = runtime.grants.forGrantor(principal);
  const dossiersOnMe = (() => {
    const through = runtime.audits.through(principal);
    return runtime.dossiers.about(principal).filter((d) => runtime.dossiers.visibleToSubject(d, tick, through));
  })();

  const solved = boardFor(runtime, principal, tick);
  const board = solved.rows;
  // The market block is built ONCE and both published and used to price the `trade`
  // affordances, for the same reason the board is: two solves would let
  // `market.books[]` and the `trade` list disagree about a price, and an affordance
  // quoting a price the payload does not show is the two-homes shape of scar #1 with
  // money attached.
  const market = runtime.marketView(principal, tick);
  const books = (market['books'] ?? []) as readonly PublicBook[];
  /** `market.at`, read off the block rather than re-derived. See {@link affordancesFor}. */
  const marketVenues = (market['at'] ?? []) as readonly VenueId[];
  // The **same rows** the payload publishes are the rows the affordances are built from.
  // Solving the board twice would let `ventures.board[]` and the `fill_role` list disagree
  // about a hash or a price, which is the two-homes-for-one-rules-surface shape of scar #1.
  const affordanceSet = input.fresh && !input.stale
    ? affordancesFor(runtime, principal, tick, board, solved.dropped, myCampaigns,
    books, marketVenues)
    : { list: [] as Affordance[], withheld: notAWake(input) };

  // ★ `Runtime.exposureOf`, not `cachedExposure`: §3's EXPOSURE is Σ open `max_direct_loss`, and a
  // GRANT carries one. Reading the encumbrance cache alone showed a probe holding five live grants
  // worth 160,000 of delegated authority an `exposure.mine` of 0 for a whole run, while two of the
  // Levy's four allocation rules billed it off the same figure. One home, carried in `runtime.ts`.
  const exposure = runtime.exposureOf(principal, tick);
  const stores = runtime.ledger.account(storesAccount(principal));

  return {
    header: {
      tick,
      // Wall-clock, for display and for the agent's own scheduling. Never for
      // deriving game time: `agent.md` §5 says use the tick numbers we send.
      serverNow: input.serverNowMs,
      next_reckoning: {
        ticks: ticksUntilReckoning(tick),
        reckoning: reckoningIndex(tick) + 1,
        what_resolves: mine
          .filter((v) => v.state === 'LIVE' && v.resolvesAtTick <= nextSettlement(tick))
          .map((v) => v.id)
          .slice(0, MAX_LIST_ROWS),
        seal_slot: sealSlotFor(runtime, principal, tick),
        in_commitment_window: inCommitmentWindow(tick),
        in_freeze: inFreeze(tick),
      },
      /** The tick at which something changes for this principal. PROP-O8's anchor. */
      next_decision_at: nextDecisionAt(runtime, principal, tick),
      actions_remaining: input.stale ? 0 : input.actionsRemaining,
      actions_per_tick: ACTIONS_PER_TICK,
      wakes_remaining: input.wakesRemaining,
      /**
       * **Your own record — the same row `counterparties[]` carries about everybody else.**
       *
       * It lives on `header` rather than as an eleventh top-level key because §17's observe
       * budget is *at* its ceiling at ten (`OBSERVE_KEYS` is counted, not trusted), and
       * `header` is where the payload already keeps the facts about the reader that are
       * true regardless of what it is doing this tick — its clock, its budgets, its
       * mandate version. Its record belongs in exactly that set.
       *
       * It is not in `counterparties[]` on purpose: §3 says a counterparty is somebody you
       * deal with, and putting the reader in a list of other agents would be one word for
       * two concepts. Built by {@link standingRow}, so the row about you and the row about
       * them cannot drift — `header.standing.standing.defaults` and
       * `counterparties[i].standing.defaults` are the same field, computed once.
       *
       * §13's "report a default recorded against you" needs this to be sayable at all, and
       * `agent.md` §4's standing rules are unverifiable by an agent that cannot see its own
       * vectors move.
       */
      standing: standingRow(runtime, principal),
      /**
       * **THE PUBLISHED RAID SCHEDULE** (§9, A14, A2).
       *
       * A raid an agent could not see coming is a dice roll, and A2 says known
       * arithmetic is exact and machine-readable. So the next spawn tick, the window
       * length, how many the world spawns per Reckoning, and the target rule *verbatim*
       * are all here — before the first raid of the season, and in every observation
       * after it.
       *
       * It lives on `header` rather than as an eleventh top-level key because §17's
       * observe budget is *at* its ceiling at ten (`OBSERVE_KEYS` is counted, not
       * trusted), and `header` is where the payload already keeps the clock. A schedule
       * is a clock.
       */
      raid_schedule: runtime.raidSchedule(tick),
      /**
       * **§9'S AGGRESSION CAPACITY — THE PRICE, PUBLISHED BEFORE IT IS CHARGED (A2).**
       *
       * ══════════════════════════════════════════════════════════════════════
       * For the project's whole life the strings `aggression` and `capacity` were **absent from
       * the entire observation** of a real enrolled principal. The only mention anywhere was the
       * `withheld` reason below, which fires **exactly when the agent has spent all of it** — so
       * the learning path ran backwards: you discovered the resource existed by exhausting a
       * resource you were never told you had. A blind probe hit the other half of it and reported,
       * correctly, that with `demand` simply absent from the menu it could not tell zero capacity
       * from silence.
       *
       * §9 prices predation so it cannot Coase-collapse into a toll cartel, and the price only
       * works as a *decision*: the cost of a demand is the other demand you gave up this cycle.
       * That decision is unavailable to an agent that cannot read the count before it spends it —
       * which makes this exactly `raid_schedule`'s argument one field up. A raid an agent could
       * not see coming is a dice roll; a budget an agent cannot see is a trap.
       * ══════════════════════════════════════════════════════════════════════
       *
       * On `header` for `raid_schedule`'s reason, and it is the same reason: §17's observe budget
       * is *at* its ceiling at ten top-level keys (`OBSERVE_KEYS` is counted, not trusted), and
       * `header` is where the payload keeps the facts about the reader that hold regardless of
       * what it is doing this tick — its clock, its budgets, its record. A per-Reckoning allowance
       * is a budget.
       *
       * **A9 is satisfied by construction, not by exception.** This is the reader's *own* state,
       * derived from the raid book, whose rows are `PUBLIC` — every agent-initiated demand names
       * its initiator on the feed the moment it opens (`demands_left_this_reckoning` is already in
       * that event's payload). So nothing here is a fact the spectator frame could not carry, and
       * nothing here is a fact a stranger could not already count for itself.
       */
      aggression: runtime.aggressionFor(principal, tick),
      /**
       * **THE PARLEY PRICE (§3, `say/parley.ts`), PUBLISHED BEFORE IT IS CHARGED (A2).**
       *
       * ══════════════════════════════════════════════════════════════════════
       * A blind probe fighting a campaign at the Marches read `attacker 3, defender 4, terrain 1,
       * outcome_if_pulsed_now: REBUFF` — a reading no play of its own could change, because one
       * principal caps at three hands and ties go to the defender, so **the arithmetic makes a
       * coalition mandatory.** `join {campaign, side}` was the published answer, `counterparties[]`
       * was **empty**, and it published *"COALITION WANTED … I pay 20000 per hand"* as a standing
       * offer **into the void**, because `message` took a venture it was not in or a dossier it
       * could not cut. There was no way to say anything to a principal it was not already in
       * business with.
       *
       * `message {to, act, text}` is that channel, and an open channel is a Sybil vector, so it is
       * priced (A15). This block is the price, and it is present at **zero, at full, and at
       * not-entitled** alike — the third state being the one §9's aggression capacity spent this
       * project's whole life without, where its only appearance in an observation was the
       * `withheld` line that fires exactly when the count hits zero. An agent must not have to
       * discover a resource by exhausting it.
       * ══════════════════════════════════════════════════════════════════════
       *
       * On `header` for `aggression`'s reason, and it is the same one: §17's observe budget is at
       * ten of ten (`OBSERVE_KEYS` is counted, not trusted), and `header` is where the payload keeps
       * the reader's clocks, budgets and record. A per-Reckoning allowance is a budget.
       *
       * **A9 by construction.** Every input is the reader's own or already `PUBLIC`: its standing
       * row (published here and in every `counterparties[]` about it), its `freeCash`, and a count
       * of principals whose holdings and campaign rosters are public facts.
       */
      parley: runtime.parleysFor(principal, tick),
      // ── THE CAMPAIGN CLOCK (§16.6 MUST-8), PRESENT AT ZERO CAMPAIGNS AND AT FOUR ──
      //
      // On `header` for `raid_schedule`'s and `aggression`'s reason, and it is the same one:
      // §17's observe budget is at ten of ten, `header` is where a world-wide published clock
      // belongs, and a clock nobody can read is not a published clock. `aggressionFor`'s docblock
      // records what the alternative cost — until §9's capacity became a standing block, the only
      // mention of it in an observation was the `withheld` line that fires when it hits zero, so an
      // agent learned the resource existed by exhausting it.
      campaign_clock: runtime.campaignClock(tick),
      /**
       * §13B: the owner mandate is stable text, not per-tick state, so it is a free
       * read with a version announced here rather than a key of its own.
       */
      mandate_version: 0,
      state_version: runtime.engine.stateVersion,
      state_hash: runtime.engine.stateHash,
      /**
       * PROP-O1. **Always present, even at zero**, because an absent field and a
       * field reading zero are the same thing to a reader that has never seen one —
       * and "nothing was withheld" has to be sayable.
       */
      withheld: affordanceSet.withheld,
      stale: input.stale,
      /**
       * `agent.md` §7 lists every verb in the canon. These are the ones whose
       * mechanic has landed. Published rather than discovered by trial, because an
       * agent burning actions to find out is an agent we misled.
       */
      live_verbs: [...runtime.liveVerbs].sort(cmp),
    },

    hands: hands.slice(0, MAX_LIST_ROWS).map((hand) => {
      const commitment = runtime.ventures.commitmentOf(hand.id);
      return {
        id: hand.id,
        location: hand.location,
        state: hand.state,
        committed_to: commitment === null ? null : commitment.venture,
        free_at_tick: hand.freeAtTick,
        in_transit_eta: hand.state === 'IN_TRANSIT' ? hand.freeAtTick : null,
        destination: hand.destination,
        cargo: [...hand.cargo.entries()]
          .sort((a, b) => cmp(a[0], b[0]))
          .map(([good, amount]) => ({ good, qty: amount })),
      };
    }),

    holding: {
      id: holding.id,
      /** Whose body this is. Present so a correction can re-solve for the reader. */
      principal,
      name: holding.name,
      system: holding.system,
      tier: tierOf(world.map, holding.system),
      state: holding.state,
      fell_at_reckoning: holding.fellAtReckoning,
      /**
       * **THE ONE THING THAT CAN TAKE TERRITORY, AND IT IS NAMED BEFORE IT HAPPENS.**
       *
       * A `CONTESTED` claim of this principal's, inside or approaching the published
       * vulnerability window, is a real threat to a real holding — the first thing in
       * this build that is. Every row is public legal state and a clock: no row here
       * is a function of what anybody holds, which is the difference between this and
       * the "fuel gauge" §11.2 refused (see `sovereignty/view.ts`).
       *
       * Predation still contributes nothing: a raid takes located goods and sends
       * hands to `RECOVERING`, and §9 has nothing in it that reaches a holding. A
       * demand is a real row in `obligations.raid` instead, with its own deadline.
       */
      threats: claimThreats(myClaims),
      // ── §12.1's RESERVED *"siege clock"* SLOT, FILLED ──────────────────────
      //
      // §12.1 lists `holding` as `state · threats · siege clock · upkeep_due`. The third of those
      // had never been built, and campaigns are exactly it: a multi-Reckoning clock running against
      // (or from) a principal's territory. So this spends **no** top-level key — the budget is at ten
      // of ten and *"adding one means removing one"* — and it lands where the canon already put it.
      campaigns: myCampaigns,
      campaign_rules: runtime.campaignStatementFor(principal, tick),
      /**
       * §6.3's recurring upkeep, in **goods** — the Charge, summed over every claim.
       *
       * It was `0` with a comment saying the recurring half was not built. It is built:
       * `obligations.charge` carries the per-claim detail with each deadline, each
       * consequence and each bond at risk, and this is the headline an agent sees
       * without reading it. Currency is `0` because the Charge is payable ONLY in goods
       * standing at the claimed system — a currency figure here would be a bill nothing
       * sends, which is what this field used to be.
       */
      upkeep_due: 0,
      upkeep_due_qty: myClaims.reduce((n, c) => n + c.owed, 0),
      upkeep_good: CHARGE_GOOD,
      /**
       * **THE EXIT, VISIBLE FROM INSIDE** (§4.1, §6.3, A8, A15, A2).
       *
       * ══════════════════════════════════════════════════════════════════════
       * A live playtest found that no principal could ever leave the Commons — enrolment
       * always seats there, a Commons holding grants Commons-bound hands only, and
       * nothing moved a holding. A8's floor had become the entire world: predation could
       * not reach a player and the Marches and the Frontier were decorative.
       *
       * The verb is only half the fix. **A graduation nobody can find is not a
       * graduation**, so the choice is published as state — priced, with its
       * destinations named — and not only as an affordance that a slice or a stale
       * observation might not carry. `commons_bound` is the fact an agent needs to
       * explain why `move` refused it; `graduation` is what to do about it.
       * ══════════════════════════════════════════════════════════════════════
       */
      commons_bound: principalIsCommonsBound(world, principal),
      graduation: graduationBlock(runtime, principal),
      /**
       * ★ **SWAY — HOW FAR THIS BODY'S FORCE REACHES** (§16.12 #1, `world/sway.ts`).
       *
       * ══════════════════════════════════════════════════════════════════════
       * **ON `holding` AND NOT A KEY OF ITS OWN, AND THAT IS THE CANON'S CALL RATHER THAN A
       * BUDGET DODGE.** §12.1 is at ten of ten top-level keys and *"adding one means removing
       * one"*. It is also the right home: §3 makes a HOLDING *"your named body on the map"*, and
       * sway is exactly what that body can project — measured from it, and from the CLAIMS it has
       * taken. `campaigns` landed in the reserved *"siege clock"* slot beside this for the same
       * reason.
       *
       * **PUBLISHED STANDING, NOT ONLY ON REFUSAL.** `demand.ts` records the identical lesson
       * about §9's aggression capacity — *"the only mention of the capacity in an observation was
       * the `withheld` reason that fires when it hits zero, so an agent learned the resource
       * existed by exhausting it"*. A reach limit is worse: by the time a refusal names it, the
       * agent has already spent the moves that walked a hand somewhere it counts for nothing.
       *
       * Only places at 1 or more appear — 3–8 rows on the launch map, not 26 mostly-zero ones —
       * and `straits_held` is the actionable half: it names the ground whose toll you do not pay,
       * which is what turns *"I am fenced in"* into *"take that gate"*.
       * ══════════════════════════════════════════════════════════════════════
       */
      sway: runtime.swayBlockFor(principal),
      /**
       * WORKS — the only reason goods enter the world (§10.2).
       *
       * Carried whether or not the build is affordable, for the reason `graduation` is: the
       * most consequential economic decision a principal makes is whether to raise one, and
       * a decision it cannot read is one it cannot plan toward.
       */
      works: worksBlock(runtime, principal),
      /** §6.4: posted slashable capital, continuous and public. What a claim requires. */
      bond: runtime.bondView(principal),
      /**
       * **ONE sovereignty statement, chosen by what this principal can actually do next.**
       *
       * ══════════════════════════════════════════════════════════════════════
       * **THIS WAS THREE STATEMENTS AND IT BROKE THE CAST.** The first version shipped
       * `SOVEREIGNTY_STATEMENT`, `CHARGE_STATEMENT` and `ARREARS_STATEMENT` — about 3 KB
       * of static prose — in **every** observation for **every** principal, including
       * Commons-bound newcomers for whom a claim is not a legal act. Measured
       * consequence: `cast/prompt.ts:projectObservation` drops observation keys and then
       * truncates `affordances[]` once the payload passes 16,000 characters, so a
       * twelve-member cast over one Reckoning went from 192 LIVE decisions to 172 and the
       * deciding share fell **below** the health floor. Static prose crowded out the
       * agent's own choices.
       *
       * §12.1's observation budget is ~3k tokens normally, and it is a budget for
       * *decision-relevant state*. So the rule here is the one the affordance list already
       * follows: say the thing that applies now. All three strings are in `agent.md` in
       * full, verbatim and pinned, which is where a complete rules surface belongs.
       * ══════════════════════════════════════════════════════════════════════
       */
      sovereignty: sovereigntyStatementFor(world, principal, myClaims),
    },

    obligations: {
      /**
       * The principal's own Levy line for this Reckoning, or null when it has none
       * (not yet assessed this cycle, or not enrolled). NOT a hardcoded null — that
       * was the "tested but dead on the live path" bug a verifier caught: the Levy
       * settled correctly in the sim while an agent over HTTP could never see its own
       * assessment, the same shape as standing being a constant. `levyBlockFor`
       * returns exactly agent.md §6's `{ my_assessment, paid, deliverable_to,
       * shortfall_if_unpaid, ballot }`.
       */
      levy: runtime.levyBlockFor(principal, tick),
      exposure: {
        mine: exposure,
        /**
         * §11.3 publishes concentration as a *band*, never a per-principal number
         * for someone else. Phase 0 has one constellation (OPS-7), so the band is
         * the world's.
         */
        constellation_band: exposureBand(runtime),
      },
      stores_free: stores === undefined ? 0 : runtime.ledger.freeBalance(storesAccount(principal)),
      /**
       * **A DEMAND AGAINST YOU, WITH ITS DEADLINE** (§9's Demand window).
       *
       * It belongs in `obligations` and not in `briefing`, because that is exactly what
       * it is: something owed, to a named counterparty, by a named tick, with a stated
       * consequence for not paying. The only difference from the Levy line above it is
       * that nobody can be talked out of this one.
       *
       * Every row carries `costs.pay`, `costs.if_you_do_nothing` and the force
       * arithmetic on both sides — exact, never an estimate (A2) — so an agent can price
       * all three branches without a wiki. `if_you_do_nothing` is the `projectedDrown`
       * pattern this repo ships as a standing requirement: a decision under a clock
       * whose default outcome is not stated is not a decision.
       */
      raid: runtime.raidsFor(principal, tick, MAX_LIST_ROWS),
      /**
       * **THE BATTLE OVER A REFUSED DEMAND** (§9A, A13).
       *
       * ══════════════════════════════════════════════════════════════════════
       * **It goes inside `obligations`, beside the raid row, and NOT in a key of its own.** §12.1's
       * budget is *"exactly 10 top-level keys — at the §17 budget, so adding one means removing
       * one"*, and combat does not get to spend that: an engagement is what a `raid` row becomes
       * when its target answers FIGHT, so it belongs adjacent to the thing it is a consequence of,
       * which is the same argument that put `levy` and `exposure` together in the first place
       * (*"both are 'what I could lose', and adjacency is what an agent needs"*).
       * ══════════════════════════════════════════════════════════════════════
       *
       * Own formations exact, hostile contacts banded, the forecast in p10/p50/p90 with **named
       * swing factors** and never a percentage, the causal trace so a loss can be understood, and
       * `if_you_do_nothing` — the `projectedDrown` pattern, and the field that closes the trap a
       * fleet with no withdrawal threshold walks into.
       */
      battle: runtime.engagementsFor(principal, tick, MAX_LIST_ROWS),
      /**
       * **THE CHARGE, WITH ITS DEADLINE AND ITS CONSEQUENCE** (§6.3, A5′).
       *
       * It belongs in `obligations` for the raid row's reason: it is something owed, at
       * a named place, by a named tick, with a stated consequence for not paying. What
       * makes it the most dangerous row in the payload is that the consequence is
       * territory and slashable capital, so `if_you_do_nothing` and `consequence` are
       * not decoration — they are the same arithmetic settlement runs
       * (`sovereignty/view.ts:claimDoNothing`), so a claimant that reads this and does
       * nothing gets exactly what it was told.
       */
      charge: myClaims.slice(0, MAX_LIST_ROWS),
      /** The allocation ballot, while it is open. Who bears the total is the vote (§5.2's split). */
      charge_ballot: chargeBallotBlock(runtime, principal, tick),
    },

    ventures: {
      mine: mine.slice(0, MAX_LIST_ROWS).map((v) => ventureRow(runtime, v, principal)),
      board,
      talks: runtime
        .talksFor(principal)
        .slice(-MAX_LIST_ROWS)
        .map((t) => ({ venture: t.venture, from: t.from, act: t.act, text: t.text, tick: t.tick })),
    },

    /**
     * ★ **THE ADDRESS BOOK AND THE INBOX ARE ONE LIST, AND THAT IS THE FIX.**
     *
     * ══════════════════════════════════════════════════════════════════════════
     * A probe fighting a campaign it could not win alone read `counterparties[]` as **empty** — so
     * §12.4's own advice, *"look at `counterparties[].last_default` before you trust someone"*, was
     * inapplicable to the only relationship that mattered: the ally it did not have yet. The list
     * was every principal it had *already dealt with*, which for the decision in front of it was
     * every principal except the ones it needed.
     *
     * So the list now also carries the principals the world stands the reader beside — the ones
     * `affordances[]` names as PARLEY recipients — with the same standing row, and the mail each has
     * actually sent. Two consequences worth stating:
     *
     *   - §12.1's *"only agents named above"* is honoured rather than widened: a reachable principal
     *     IS named above, in `affordances[]`, by a `message {to}` row carrying its real id.
     *   - Pricing a stranger becomes possible **before** dealing with it, which is what §8 requires
     *     of a grant's public limits and what a coalition requires of an ally. An agent asked to pay
     *     20,000 a hand can now read the asker's `last_default` first.
     * ══════════════════════════════════════════════════════════════════════════
     */
    counterparties: counterpartiesFor(runtime, principal, mine, board, tick).slice(0, MAX_LIST_ROWS),

    grants: {
      // Authority you HANDED OUT (you are the grantor): watch each delegate's spend
      // against the worst case you signed. And authority you HOLD (you are the delegate):
      // read your remaining headroom before your next on-behalf act. Both from the one
      // book, through {@link grantView}, so the two sides can never disagree (A6, §8.1).
      // ── AN OFFICE'S GRANTOR IS THE SYNDICATE, NOT THE FOUNDER ──────────────
      //
      // `forGrantor(principal)` alone loses every office a syndicate issued: the grant's
      // grantor is `syn:<founder>:<tick>`, so the founder's `granted[]` stayed `[]` forever
      // while the delegate's `held[]` showed the office perfectly. A probe agent found this
      // by granting an office and then being unable to see that it had.
      //
      // That is A6 legibility failing on the side that carries the risk. §8.1's whole point
      // is that both roles read the same row so the two sides cannot disagree — and here the
      // grantor side could not read it at all, which is worse than disagreeing.
      //
      // Scoped to syndicates the reader SITS IN, and that is not a widening: members vote
      // offices into existence through `propose`/`approve`, so the authority a syndicate
      // holds is already theirs to decide. Being unable to see what they voted for is the
      // anomaly.
      granted: [
        ...myGrantsOut,
        ...runtime.syndicates
          .of(principal, tick)
          .flatMap((s) => runtime.grants.forGrantor(syndicateAsPrincipal(s.id))),
      ]
        .slice(0, MAX_LIST_ROWS)
        .map((g) => grantView(runtime, g, tick, principal)),
      held: runtime.grants
        .forDelegate(principal)
        .slice(0, MAX_LIST_ROWS)
        .map((g) => grantView(runtime, g, tick, principal)),

      /**
       * ★ **THE ACCESS LOG (§8, §16.7 MUST-8) — three lists, three readerships.**
       *
       * A grant now delegates *sight*, and a delegate that can see something can hand it on.
       * This is where that shows up, and it is deliberately in `grants` rather than as an
       * eleventh top-level key: §17's observe budget is at its ceiling at ten, and a DOSSIER is
       * *what a grant was used for*, so the key that publishes grants is its home.
       *
       *   - `about_me[]`  — cuts on YOUR compartments, once revealed (or once you `audit`).
       *                     This is the counterintelligence surface: who read what, and when.
       *   - `i_hold[]`    — documents in your hands, WITH the figures. Re-handable by id, and
       *                     re-handable **after the grant that cut them is revoked** — which is
       *                     §16.7 MUST-5's rule that revocation stops future reads and never
       *                     erases what was already observed, and the reason `revoke` is not a
       *                     cure for having trusted somebody.
       *   - `window`      — how long a fresh cut on you stays dark, and whether you have paid to
       *                     close it. Published as a number rather than left to be inferred: an
       *                     agent that cannot see the lag cannot price the `audit` that shortens
       *                     it, and a mechanic whose cost is legible while its benefit is not is
       *                     a mechanic nobody will buy.
       */
      about_me: dossiersOnMe.slice(-MAX_LIST_ROWS).map((d) => dossierView(d, principal)),
      i_hold: runtime.dossiers
        .heldBy(principal)
        .slice(-MAX_LIST_ROWS)
        .map((d) => dossierView(d, principal)),
      window: {
        /** Ticks a cut stays dark before it publishes to you, to every agent and to viewers alike. */
        audit_lag_ticks: AUDIT_LAG_TICKS,
        /** The last tick you spent an action reading this log, or null if you never have. */
        audited_through_tick: runtime.audits.through(principal),
        /**
         * Cuts on you that exist and have NOT reached you yet — **a count, never the rows.**
         *
         * This is the one number in the observation that had to be argued rather than added,
         * because publishing it at all seems to defeat the delay. It does not, and the
         * distinction is the mechanic: the delay hides *what was taken, by whom, to whom*, and
         * this says only *something was*. A victim that cannot tell "nobody is reading my
         * books" from "four people are" has no reason ever to spend an action on `audit`, so
         * the counterintel verb would be unreachable in practice while looking implemented —
         * and the window would protect the mole absolutely instead of protecting it for four
         * ticks. Four ticks of ambiguity about the details is a window; total ignorance that
         * anything happened is a blindfold, and A2 forbids the second.
         */
        unrevealed_count: (() => {
          const through = runtime.audits.through(principal);
          return runtime.dossiers
            .about(principal)
            .filter((d) => !runtime.dossiers.visibleToSubject(d, tick, through)).length;
        })(),
      },

      /**
       * The syndicates this principal SITS IN.
     *
       * `observe` mentioned syndicates nowhere at all. A probe agent formed one, then had to
       * reconstruct its own id by hand from the `syn:<founder>:<tick>` convention in order to use
       * any of `admit` · `apply` · `propose` · `approve` · `grant on_behalf_of` — every one of
       * which takes that id as a parameter. A subsystem whose primary key is unpublished is a
       * subsystem no agent can reach without reading our source, which is A2's *"never make an
       * agent need a wiki"* with the wiki being the repository.
       *
       * **Nested under `grants` rather than given its own top-level key**, because SPEC §17's
       * rules budget is `≤10 top-level observe keys` and it is AT ten: *"adding one means removing
       * one, enforced by a test that counts them, not by good intentions."* The test caught this
       * exactly as designed. `grants` is the right home anyway — it is the authority block, and
       * after the office-grantor fix above the offices a syndicate issued already appear in
       * `granted[]`. The house and the authority it delegates belong together.
       *
       * The numbers come from {@link Runtime.syndicateLines} — the same producer the spectator
       * frame reads — filtered to this principal's houses. One home for the arithmetic, so an
       * agent and a viewer can never be shown different treasuries (scar #5), and A9's parity
       * holds by construction rather than by care.
       */
      syndicates: (() => {
      const rows = runtime.syndicates.of(principal, tick).slice(0, MAX_LIST_ROWS);
      if (rows.length === 0) return [];
      const lines = new Map(runtime.syndicateLines(tick).map((l) => [String(l.syndicate), l]));
      return rows.flatMap((row) => {
        const line = lines.get(String(row.id));
        // A live membership with no published line would mean the two producers disagree about
        // which syndicates exist. Dropped rather than half-reported, and the frame's own budget
        // assertions are what would catch it.
        if (line === undefined) return [];
        return [{
          id: row.id,
          name: line.name,
          founder: line.founder,
          i_founded_it: String(line.founder) === String(principal),
          members: line.members,
          /** Fixed at founding. There is no verb that amends a charter (`charter.ts`). */
          admission: line.admission,
          decision: line.decision,
          treasury_offices: line.treasuryOffices,
          treasury_minor: line.treasuryMinor,
          office_holders: line.officeHolders,
          /** The same legend the frame prints, so what you read is what a viewer reads. */
          legend: line.legend,
          open_proposals: runtime.syndicates
            .openProposals(row.id, tick)
            .slice(0, MAX_LIST_ROWS)
            .map((proposal) => ({
              id: proposal.id,
              /** Who the office would go to, which is the whole substance of the vote. */
              delegate: proposal.delegate,
              proposer: proposal.proposer,
              terms: proposal.terms,
              expires_tick: proposal.expiresAtTick,
              approvals: proposal.approvals.length,
              approvals_needed: runtime.syndicates.approvalsNeeded(row.id, tick),
              i_approved: proposal.approvals.some((a) => String(a) === String(principal)),
              carries: runtime.syndicates.carries(proposal.id, tick),
            })),
        }];
      });
      })(),
    },

    /**
     * §12.1's `market` key, now carrying a real book.
     *
     * **The tier split, in one sentence** (§11.2, and `market/observe.ts` argues it
     * at length): the aggregate ladder — best bid, best ask, spread, price levels,
     * depth — is `PUBLIC`, because it is the price signal and the price signal is
     * the show; **who owns which order is `PRIVATE`**, because a resting ask is a
     * hold value and §11.2 keeps hold values off any surface an ambusher can read
     * without scouting. `mine` is filtered to the reader inside the market module
     * before it reaches here, and no level ever carries a principal.
     *
     * `system`, `best_bid`, `best_ask` and `depth` are kept at the top level as the
     * local summary they always were — now sourced from the book at the reader's own
     * holding instead of hard-coded nulls.
     */
    market: {
      system: holding.system,
      ...localSummary(books, holding.system),
      ...market,
      offers: runtime
        .publishedOffers()
        .slice(-MAX_LIST_ROWS)
        .map((o) => ({ by: o.by, text: o.text, tick: o.tick })),
    },

    affordances: affordanceSet.list,

    briefing: {
      prompt: promptFor(runtime, principal, mine, board, myCampaigns, myGrantsOut, dossiersOnMe, input.fresh, tick),
      if_you_do_nothing: ifYouDoNothing(runtime, principal, mine, tick),
      /**
       * **The delivery half of PROP-O7.**
       *
       * `POST /act` answers with every refusal that was knowable when the response
       * was written. A refusal from `VALIDATE+LOCK` is not: the tick had not run, and
       * running the handler at submit would be an action reacting to a within-tick
       * decision (§15.2). So those arrive here, on the next read, drained on delivery.
       *
       * It lives inside `briefing` rather than as an eleventh top-level key because
       * §17's budget is at its ceiling at ten — and because "the last thing you tried
       * was refused, and here is the nearest legal alternative" is exactly the framing
       * of the decision in front of the agent, which is what `briefing` is for.
       *
       * It is a hint. It is never an event (scar #10).
       *
       * ══════════════════════════════════════════════════════════════════════
       * **ONE ROW PER REFUSED ACTION, WHICH IT WAS NOT.** A probe refused three
       * actions in three consecutive ticks with no wake between them and its one
       * wake returned **one** row — so the batch read as 2-for-3 successful. The
       * rows were recorded correctly and then consumed: every `POST /act` attaches
       * an observation, that observation drained the ring, and a `fresh: false`
       * act response is precisely the payload an agent discounts as stale. That is
       * the `RULES_VERSION` 19 defect ("a verdict consumed by a poll the agent made
       * for some other reason") re-entering through a defaulted argument.
       *
       * Fixed at the call sites, not here: `drain` is now mandatory and true only
       * for a wake, and every other observation gets `Runtime.peekCorrections`.
       * This list is therefore complete for the wake that delivers it, and
       * `corrections_dropped` accounts for anything the ring could not hold.
       * ══════════════════════════════════════════════════════════════════════
       */
      corrections: input.corrections.map((c) => ({
        tick: c.tick,
        verb: c.verb,
        clientSequence: c.clientSequence,
        invariant: c.invariant,
        hint: c.hint,
        /**
         * ★ **A STANDING CONDITION IS ONE ROW WITH A COUNT, NOT N ROWS.**
         *
         * See `PendingCorrection.repeats`: a durable intent refused for a reason that cannot change
         * used to post an identical verdict every tick — measured at 16 rows in 16 ticks from one
         * `set_delivery_intent`, and 130 pending across 11 principals world-wide. `tick` is the most
         * recent occurrence, so the first of a consecutive run is `tick - repeats`.
         *
         * Read it as the instruction it is: a positive `repeats` on an intent's verb means the
         * intent is stuck, not that the world is busy, and the answer is to stop it rather than to
         * wait. Zero is the ordinary case.
         */
        repeats: c.repeats,
        /**
         * ★ **`?? affordanceSet.list[0]` USED TO BE THE LAST TERM HERE, AND IT INVENTED ADVICE.**
         *
         * When nothing in the list matched the refused verb, this handed back *whatever happened to
         * be first* — so a probe's refused `set_delivery_intent` came back with a `nearest_legal` of
         * `create DIG`, which its own report called "neither near nor legal". A field named
         * `nearest_legal` carrying an unrelated act is worse than an absent one: the whole value of
         * this channel is that an agent can copy the row and act, and PROP-O7 promises *"the nearest
         * legal thing you could do instead"* — not "an affordance".
         *
         * `null` is the honest answer, and it costs the agent nothing it had: the prose `hint` names
         * the invariant and the fix, and `affordances[]` is in the same payload.
         */
        nearest_legal: affordanceSet.list.find((a) => a.verb === c.verb) ?? null,
      })),
      /**
       * The accountable half of the bound above. Zero in every ordinary observation;
       * positive only when a principal refused more than `MAX_PENDING_CORRECTIONS`
       * actions between two wakes, and then it says how many rows are gone rather than
       * letting the list quietly be short. Same discipline as `header.withheld`: an
       * omission gets a **counted reason**, never silence.
       */
      corrections_dropped: input.correctionsDropped,
    },
  };
}

// ── Affordances ─────────────────────────────────────────────────────────────

/**
 * Why this payload carries no affordances — **and the world's actual status.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE TWO REASONS WERE SWAPPED, AND FOUR PROBES READ THE FALSE ONE.**
 *
 * The condition was `wakesRemaining > 0`, which is the *common* case rather than the
 * paused one: `POST /act` attaches an observation built with `fresh: false` (see
 * `server.ts:observationForHints`), so an agent with fifteen wakes in hand was told "the
 * world is PAUSED, so there is nothing you can legally do until it resumes" — while
 * `/health` said RUNNING, `header.stale` was false, its actions were being accepted, and
 * `briefing.prompt` **in the same payload** correctly said it was outside a wake.
 *
 * A false assertion about world state is not a cosmetic slip. An agent that believes the
 * world is paused stops playing, and the one thing it will not do is spend a wake to find
 * out otherwise. So the paused string is now gated on the engine's own status — the same
 * field `/health` publishes — and there is a third case for the one that was missing.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The count is zero in all three branches and that is exact rather than convenient:
 * nothing was *withheld*, because no affordance list was solved. Solving one here is the
 * A4 leak `server.ts:nearestFresh` exists to close — outside a wake, a bigger inference
 * budget must not buy a bigger information set.
 */
function notAWake(input: ObserveInput): Withheld {
  // `verbs: []` in every branch, and it is exact rather than convenient for the same reason
  // `count: 0` is: no affordance list was solved, so no verb's absence has been accounted for
  // OR left unaccounted. A non-empty list here would claim an accounting that never happened.
  if (input.runtime.engine.status === 'PAUSED') {
    return {
      count: 0,
      verbs: [],
      reason:
        'this observation is the cached tick snapshot: the world is PAUSED, so there is nothing you can ' +
        'legally do until it resumes. Nothing was withheld — no affordance list was solved.',
    };
  }
  if (input.wakesRemaining > 0) {
    return {
      count: 0,
      verbs: [],
      reason:
        `the world is RUNNING and you still hold ${String(input.wakesRemaining)} of ` +
        `${String(WAKES_PER_RECKONING)} wakes this Reckoning — this particular payload simply was not fetched ` +
        'in one. It is the copy attached to an action response or a preview, so it carries no fresh ' +
        'affordance and no quote_id. Nothing was withheld: no affordance list was solved. Send a signed ' +
        'GET /observe to spend a wake and get the actable list.',
    };
  }
  return {
    count: 0,
    verbs: [],
    reason:
      `you have spent all ${String(WAKES_PER_RECKONING)} wakes this Reckoning. This snapshot is legal, ` +
      'free, and carries no fresh affordance and no quote_id. Wakes reset at the next Reckoning. Nothing ' +
      'was withheld — no affordance list was solved.',
  };
}

interface AffordanceSet {
  readonly list: Affordance[];
  readonly withheld: Withheld;
}

/**
 * Everything this principal can legally do right now.
 *
 * Order is deterministic and is a *priority* order, not an alphabet: if the cap
 * bites, what survives is what the agent most needs. Within a group, canonical id
 * order, so the list is byte-stable across two fetches in one tick.
 */
/**
 * The one-line local summary `market` has always carried: the book at the reader's
 * own holding.
 *
 * Kept because it is the shape `agent.md` and every existing reader already know,
 * and because a principal with one holding should not have to scan `books[]` to
 * answer "what is it worth here". When more than one good trades at that system the
 * summary names the first in canonical order and `books[]` carries them all — an
 * ambiguity worth having, because the alternative is an eleventh top-level key and
 * §17's budget is at ten.
 */
/**
 * The exit, as state rather than as an offer — `holding.graduation`.
 *
 * Published in **every** observation, including the ones outside a wake that carry no
 * affordances at all (§12.4), and including the ones where the price is not yet met.
 * That is the difference between a choice an agent knows it has and a choice it happens
 * to catch: `affordable: false` with the two exact figures beside it tells a newcomer
 * what to go and earn, and an absent affordance tells it nothing.
 *
 * Every number comes from `Runtime.graduationQuote`, which is also what the verb charges,
 * so the price shown and the price taken are one arithmetic (scar #1).
 */
/**
 * What this principal is extracting, and what one more WORKS would get it.
 *
 * `share_per_tick` is divided by `occupants + 1` — the share AFTER arriving, never the empty
 * rate. The whole economic question is whether a build pays for itself, and the pre-arrival
 * number answers a question nobody asked.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THIS BLOCK ENUMERATES ITS FIELDS, SO EVERY NEW ONE HAS TO BE ADDED HERE BY HAND.**
 * `worksQuote` grew a rent split and a fuel yield and this block kept publishing the six fields
 * it had always published — an accessor written and never surfaced, which is this project's most
 * repeated defect and the one that hid nine mechanics and `BUILD`. The rule the omission broke:
 * a builder could not see who takes a share of what it extracts, and could not see the frontier's
 * fuel premium at all, so the only two facts that make WHERE you build a real decision were in
 * the engine and in no observation.
 * ══════════════════════════════════════════════════════════════════════════
 */
function worksBlock(runtime: Runtime, principal: PrincipalId): Readonly<Record<string, unknown>> {
  const seat = runtime.graduationQuote(principal);
  const mine = runtime.worksOf(principal);
  if (seat === null) return { held: mine, here: null };
  const quote = runtime.worksQuote(principal, seat.from);
  return {
    /** Live WORKS of yours, with whether each is past spin-up and what it has extracted. */
    held: mine,
    here: {
      system: quote.system,
      tier: quote.tier,
      good: quote.good,
      /** What the PLACE yields per tick, before division. A property of the map. */
      yield_per_tick: quote.yieldPerTick,
      /** WORKS standing there now, yours or anyone's. Your share falls as this rises. */
      occupants: quote.occupants,
      /**
       * ★ **WHO those occupants are, named.** `PUBLIC` — the spectator frame has always shown it.
       *
       * A blind player read `occupants: 4` on the ground under its own body and could not learn one
       * name; it got three of them only because `demand` happened to list them as targets, which is
       * a door that does not exist for a principal with no reach. These are the principals dividing
       * the yield with you — the ones to `message`, buy out, hire, or take the ground from. Includes
       * you when a WORKS of yours stands here, because the list is the ground's occupancy and not a
       * list of rivals.
       */
      occupied_by: quote.occupiedBy,
      /**
       * What yours would **KEEP** per tick once online, at today's crowding **and after rent**.
       *
       * ══════════════════════════════════════════════════════════════════════
       * **NET, AND THIS COMMENT USED TO SAY "EXTRACT".** `agent.md` calls this field *"the number
       * that decides whether the build pays for itself"* and the affordance multiplies it by a
       * Reckoning to state what a WORKS RETURNS — so when a claim started taking 20% of everything
       * extracted at its system, "what yours would extract" became a description of `gross_per_tick`
       * on a field that no longer carries it. A stale comment on the most-quoted number in the
       * economy is scar #1's exact shape: engine and agent-facing text disagreeing about one word,
       * each reading correctly alone.
       *
       * `gross_per_tick - rent_per_tick === share_per_tick`, exactly, and all three are published
       * so an agent can see the deduction rather than infer it from a number that came out low.
       * ══════════════════════════════════════════════════════════════════════
       */
      share_per_tick: quote.sharePerTick,
      /** Before the rent — what the place hands over to yours. Equal to the share on free ground. */
      gross_per_tick: quote.grossPerTick,
      /** What the claim-holder here would take of it, per tick. Zero on unclaimed ground. */
      rent_per_tick: quote.rentPerTick,
      /** The rate that would apply to YOU here, in bps. Off the claim, not off the constant. */
      rent_bps: quote.rentBps,
      /**
       * WHO takes it, named, or `null`.
       *
       * Named because the rent is a relationship and not a tax: the landlord is a principal you can
       * `message`, deal with, buy the ground from — or become, since a claimant never pays itself
       * rent. A number with nobody attached is a cost; a number with a name attached is a decision.
       */
      rent_to: quote.rentTo,
      /** The second good this place yields. Made ONLY at a FRONTIER system, by a WORKS. */
      fuel_good: quote.fuelGood,
      /** What the PLACE yields of it per tick, before division. Zero outside the Frontier. */
      fuel_yield_per_tick: quote.fuelYieldPerTick,
      /**
       * What YOURS would take of it per tick, counting itself. **Zero outside the Frontier.**
       *
       * The whole of the frontier premium beyond the raw ore rate: `fuel` is the one good some
       * agents need and cannot make — a FRONTIER claim's anchor burns it every Reckoning to keep
       * collecting rent, and no verb in this build moves goods between systems — so this number is
       * an agent's entire access to the only seller's side of that trade. A quote that named the ore
       * and not the fuel understated frontier ground by everything that is new about it.
       */
      fuel_share_per_tick: quote.fuelSharePerTick,
      cost_minor: quote.costMinor,
      cost_qty: quote.costQty,
      /**
       * Your UNLOCKED balance. Pledged stores are withheld from it; the starter stake is **not**.
       *
       * This comment used to read "EARNINGS you can spend, the starter stake is withheld (D7)", and
       * that was a rule the engine had already dropped — see `worksQuote`, which gates on
       * `freeBalance` on purpose. D7 forbids the endowment *leaving* a principal; a build retires
       * the money into `sink:upkeep` rather than paying anyone, so it never engages. Gating on
       * earnings was tried and made the mechanic unreachable: `worksAffordableBy` read 0 of 21.
       */
      spendable_minor: quote.freeMinor,
      available_qty: quote.availableQty,
      spinup_ticks: quote.spinupTicks,
      already_held: quote.alreadyHeld,
      /**
       * You hold no WORKS anywhere, so {@link goods_in_currency_minor} is open to you.
       *
       * A WORKS is never removed from the game, so this can only ever go from `true` to `false`. It
       * is published rather than left to be inferred from `held: []` because the two are the same
       * fact today and an agent should not have to know that.
       */
      first_works: quote.firstWorks,
      /**
       * ★ **What `cost_qty` costs in RETIRED CURRENCY instead, on a FIRST WORKS.** Zero after that.
       *
       * The endowment allotment is a window: the Levy destroys goods every Reckoning and this build,
       * the crossing and an anchor are each priced in the same good, so a principal that pays tribute
       * for four Reckonings without building reached zero goods and had **no legal path back** — its
       * only escape a second identity, which is the one thing A15 forbids. This is the way back. It is
       * retired to nobody, it is deliberately dearer than the goods it replaces, and it closes the
       * moment you hold a WORKS, because from then on you are producing.
       */
      goods_in_currency_minor: quote.goodsInCurrencyMinor,
      /** Whether a `build` NOW would take that route: the goods are short and the currency covers it. */
      paying_goods_in_currency: quote.payingGoodsInCurrency,
      /**
       * The currency this build would actually retire — `cost_minor`, plus the substitute if it applies.
       *
       * **Read this, not `cost_minor`, to decide whether you can pay.** It is what the verb charges and
       * what the affordance publishes as `max_direct_loss`, so all three are one number.
       */
      total_minor: quote.totalMinor,
      affordable: quote.affordable,
    },
  };
}

function graduationBlock(
  runtime: Runtime,
  principal: PrincipalId,
): Readonly<Record<string, unknown>> {
  const quote = runtime.graduationQuote(principal);
  if (quote === null) return { open: [], statement: GRADUATION_STATEMENT };
  return {
    /** Where `graduate` can put your body this tick. Empty is a real answer. */
    open: quote.open,
    /**
     * ★ **THE GROUND AT EACH DESTINATION** (§16.12 #1's resource-distinct clause, `world/lode.ts`).
     *
     * ══════════════════════════════════════════════════════════════════════
     * **A PROBE REPORTED CHOOSING BETWEEN TWO SYSTEMS "WITH LITERALLY NO INFORMATION ABOUT
     * EITHER"**, and it was right: `open` was a list of ids, and every system in a tier yielded the
     * identical figure anyway, so there was nothing to know. Both halves are now false — the ground
     * differs by about a third across a tier, and this is where an agent reads it **before** it
     * spends a one-way, priced, irreversible act on the poorest system on the map.
     *
     * A2, in its own words: known arithmetic is exact and machine-readable.
     *
     * ══════════════════════════════════════════════════════════════════════
     * ⚑ **AND IT PUBLISHED THE 15% TERM WHILE HIDING THE 430% ONE.** A blind player crossed onto
     * `sys-05` because the row read *"yield 110 · richness_bps 0 · gate: true"* — and it was the most
     * crowded system on the map, four WORKS dividing 110 into 27 each, while a rival sat **alone** on
     * `sys-10` taking 115. THE LODE spreads a tier by about 15%; **occupancy spreads it by 430%.** So
     * the fields above were a true, comparable, exactly-arithmetic account of the *smaller* term, and
     * the field that decided the income was the one an agent could not read at all.
     *
     * That is A2's second clause failing in the direction that hides: *"never hand it a solved
     * game"* was satisfied and *"never make an agent need a wiki"* was not, because the only way to
     * learn a destination's crowding was to spend the 50,000-plus-5,000 one-way act and look. It is
     * also the reason three separate measurements said the cast never competes for rich ground — it
     * **cannot**, because emptiness was not published.
     *
     * `share_per_tick` is the fix and the count is not: the count is a term an agent has to divide a
     * published yield by, and every arithmetic step we leave to a reader is a step it can get wrong.
     * So both are here and the derived figure is the one the field name promises — the SAME
     * `worksQuote` the build affordance quotes, the `works` block publishes and `vBuildWorks`
     * charges, so a destination cannot read one way here and another way on arrival (scar #1).
     * ══════════════════════════════════════════════════════════════════════
     */
    ground: quote.open.map((system) => {
      const lode = runtime.lodeFor(system);
      // ONE arithmetic, never a recomputation — `yield_per_tick / (occupants + 1)` less the rent is
      // exactly what `holding.works.here` will say once your body is standing there.
      const there = runtime.worksQuote(principal, system);
      return {
        system,
        tier: lode.tier,
        yield_per_tick: lode.yieldPerTick,
        fuel_per_tick: lode.fuelPerTick,
        /** Against the tier's flat figure, signed bps. The comparable number. */
        richness_bps: lode.richnessBps,
        /** Whether it is a STRAIT's endpoint — holding one waives that gate's SWAY toll. */
        gate: lode.gate,
        /**
         * ★ **WORKS ALREADY STANDING THERE.** The term that dominates this decision.
         *
         * A place yields what it yields however many divide it (A15), so every occupant here is a
         * share of {@link yield_per_tick} that will not be yours. Zero is the number to look for.
         */
        occupants: there.occupants,
        /** Who they are, named — the principals you would be dividing this ground with. */
        occupied_by: there.occupiedBy,
        /**
         * ★ **WHAT YOU WOULD KEEP PER TICK IF YOU CROSSED AND BUILT HERE** — the decision figure.
         *
         * `yield_per_tick` divided by `occupants + 1` (you, arriving), less the rent a claim here
         * would take. **Read this and not `yield_per_tick`**: the richest ground on the map pays
         * worse than the poorest if four WORKS already stand on it.
         */
        share_per_tick: there.sharePerTick,
        /** The same for FUEL, which only a FRONTIER system makes. Zero elsewhere. */
        fuel_share_per_tick: there.fuelSharePerTick,
        /** What a claim here would take of your share, in bps. Zero on unclaimed ground. */
        rent_bps: there.rentBps,
        /** WHO would take it, named — a landlord you can deal with, or `null`. */
        rent_to: there.rentTo,
      };
    }),
    lode_statement: LODE_STATEMENT,
    upkeep_minor: quote.upkeepMinor,
    upkeep_qty: quote.upkeepQty,
    upkeep_good: quote.good,
    free_minor: quote.freeMinor,
    /** Unpledged units of the upkeep good standing where your body is. */
    available_qty: quote.availableQty,
    /** What would land with you and be raidable there — the contingent half of the price. */
    travelling_qty: quote.travellingQty,
    /** Pledged, so it stays behind: a pledged lot cannot be sent away. */
    left_behind_qty: quote.pledgedQty,
    affordable: quote.affordable,
    /**
     * Live claims keeping your body here (INV-8). Non-empty means `graduate` is not
     * offered however affordable it is, and the fix is `abandon` or a ceded sale — not
     * more currency. Named so the agent reads the real obstacle rather than re-checking
     * a price that was never the problem.
     */
    anchoring: quote.anchoring,
    one_way: true,
    statement: GRADUATION_STATEMENT,
  };
}

/**
 * Claims of this principal's that are in arrears, as `holding.threats[]`.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **A THREAT AN AGENT COULD NOT SEE COMING IS A DICE ROLL, AND A LAPSE IS PERMANENT.** This
 * is the field an agent acts on hardest, so every row is a published fact and a published
 * clock: the claim's legal state, how many misses it carries, when the vulnerability window
 * opens, and what settlement does tonight if nothing more arrives. Nothing here is derived
 * from anybody's stores — not the claimant's and not a rival's.
 *
 * A `SUPPLIED` claim is not a threat and is deliberately absent: a threats list that always
 * had every claim in it would train agents to ignore it, which is the failure mode of a
 * warning that is always on.
 * ══════════════════════════════════════════════════════════════════════════
 */
function claimThreats(mine: readonly ClaimView[]): readonly Readonly<Record<string, unknown>>[] {
  return mine
    .filter((c) => c.state === 'STRAINED' || c.state === 'CONTESTED' || c.if_you_do_nothing !== 'STAYS_SUPPLIED')
    .slice(0, MAX_LIST_ROWS)
    .map((c) => ({
      kind: 'CHARGE_ARREARS',
      system: c.system,
      state: c.state,
      legend: c.legend,
      owed_qty: c.owed,
      deadline_tick: c.deadline_tick,
      bond_at_risk: c.bond_at_risk,
      if_you_do_nothing: c.if_you_do_nothing,
      consequence: c.consequence,
      /** Open now, or the tick it opens. A14: the defender reads the same clock the taker does. */
      window_opens_tick: c.vulnerability.opens_tick,
      window_open: c.vulnerability.open,
    }));
}

/**
 * The one sovereignty statement that applies to this principal right now.
 *
 * Four rules surfaces, one slot, and the choice is by what the principal can legally do
 * next — which is the same rule the affordance list follows. `null` for a Commons-bound
 * principal with no claim: a claim there is INVALID rather than refused (A8), so
 * sovereignty is not yet a thing that can happen to it, and 3 KB of prose about it on all
 * sixteen wakes a day is a cost with no decision attached. `graduation.statement` already
 * tells that principal what leaving the Commons commits it to, and `agent.md` §11 carries
 * all four strings in full.
 */
function sovereigntyStatementFor(
  world: Runtime['world'],
  principal: PrincipalId,
  mine: readonly ClaimView[],
): string | null {
  if (mine.some((c) => c.state === 'STRAINED' || c.state === 'CONTESTED')) return ARREARS_STATEMENT;
  // ── THE FUEL RULE, SERVED WHERE IT IS ABOUT TO COST SOMETHING ─────────────
  //
  // `FUEL_STATEMENT` was exported, pinned by a test, and **served nowhere** — so `agent.md` was the
  // only carrier of the rule, and a claimant that never read the manual would watch its rent stop
  // for no stated reason. That is the defect this project keeps re-teaching (an accessor written and
  // never surfaced) landing on the one mechanic whose failure is invisible: a cold anchor takes no
  // arrears, lapses nothing and slashes no bond, so **nothing else in the observation goes red.**
  //
  // Served only to a claimant the rule can actually bite, and preferred over `CHARGE_STATEMENT`
  // only when the anchor is cold or the fuel on hand will not light it next Reckoning. A statement
  // that were always on for every frontier claimant would displace the Charge — the larger loss,
  // being bonded capital — and would be the always-on warning `claimThreats` deliberately refuses
  // to be. Fuelled and stocked, the Charge is the rule that applies; short, this one is.
  if (mine.some((c) => c.fuel_due > 0 && (!c.anchor_hot || c.fuel_here < c.fuel_due))) {
    return FUEL_STATEMENT;
  }
  if (mine.length > 0) return CHARGE_STATEMENT;
  if (world.holdingByPrincipal.get(principal) === undefined) return null;
  if (tierOf(world.map, holdingOf(world, principal).system) === 'COMMONS') return null;
  return SOVEREIGNTY_STATEMENT;
}

/** The Charge allocation ballot, while it is open. Null when this principal holds no claim. */
function chargeBallotBlock(
  runtime: Runtime,
  principal: PrincipalId,
  tick: number,
): Readonly<Record<string, unknown>> | null {
  const constellation = chargeConstituencyOf(runtime.sovereignty, principal);
  if (constellation === null) return null;
  const window = chargeBallotWindow(tick);
  if (!window.open) return null;
  return {
    id: `${CHARGE_BALLOT}::${String(window.forReckoning)}::${constellation}`,
    kind: CHARGE_BALLOT,
    closes_tick: window.closesTick,
    voted: runtime.sovereignty.hasVoted(window.forReckoning, principal),
    for_reckoning: window.forReckoning,
    rules: ['EVEN', 'BY_CLAIMS', 'BY_TIER'],
    default_rule: PUBLISHED_DEFAULT_CHARGE_RULE,
    /** A CHARGE ballot takes nothing from anybody, so `null` is the honest answer. */
    target: null,
  };
}

function localSummary(
  books: readonly PublicBook[],
  system: SystemId,
): Readonly<Record<string, unknown>> {
  const local = books.filter((b) => b.venue === system).sort((a, b) => cmp(a.good, b.good))[0];
  if (local === undefined) return { best_bid: null, best_ask: null, spread: null, depth: [] };
  return {
    best_bid: local.best_bid,
    best_ask: local.best_ask,
    spread: local.spread,
    depth: local.depth,
  };
}

/**
 * Every `(grantor, compartment)` a delegate may cut a DOSSIER on, **breadth-first by grantor**,
 * with the tail counted rather than dropped.
 *
 * Extracted from 5C-bis and given its own cap for the reason argued at that call site: the old code
 * borrowed `MAX_GRANT_OFFERS` — a cap on an unrelated list — and walked grant-id hash order, so one
 * grantor could take every slot and a live readable subject vanished from the menu with no counted
 * reason. The door is `GrantBook.clearanceGrantFor`, which is a per-subject predicate with no cap at
 * all; this is the only place the *enumeration* exists, and it is the enumeration that has to be
 * fair.
 *
 * Round-robin is what makes the guarantee statable: **every grantor a delegate can read appears at
 * least once, up to `MAX_DOSSIER_OFFERS` distinct grantors.** Within a grantor the compartments keep
 * `grant.clearance`'s own order, which `canonicalClearance` already fixed, so nothing here is
 * order-sensitive to a `Map` walk and nothing needs `Rng`.
 */
function clearanceOffers(
  runtime: Runtime,
  principal: PrincipalId,
  tick: number,
): {
  readonly shown: readonly { readonly grant: Grant; readonly room: string }[];
  readonly dropped: number;
  readonly droppedSubjects: readonly string[];
} {
  // Grouped by grantor, insertion-ordered off `forDelegate` (which is id-sorted, hence
  // deterministic). An array of pairs rather than a Map keyed by principal id, so no iteration
  // order question arises at all — DET-7 bans numeric-key Map order and this sidesteps the class.
  const byGrantor: { grantor: string; rows: { grant: Grant; room: string }[] }[] = [];
  for (const grant of runtime.grants.forDelegate(principal)) {
    if (!runtime.grants.isLive(grant.id, tick)) continue;
    for (const room of grant.clearance) {
      if (!isCompartment(room)) continue;
      const key = String(grant.grantor);
      const bucket = byGrantor.find((b) => b.grantor === key);
      if (bucket === undefined) byGrantor.push({ grantor: key, rows: [{ grant, room }] });
      else bucket.rows.push({ grant, room });
    }
  }

  const shown: { grant: Grant; room: string }[] = [];
  const deepest = byGrantor.reduce((n, b) => Math.max(n, b.rows.length), 0);
  for (let round = 0; round < deepest; round += 1) {
    for (const bucket of byGrantor) {
      const row = bucket.rows[round];
      if (row === undefined) continue;
      if (shown.length >= MAX_DOSSIER_OFFERS) break;
      shown.push(row);
    }
    if (shown.length >= MAX_DOSSIER_OFFERS) break;
  }

  const total = byGrantor.reduce((n, b) => n + b.rows.length, 0);
  const seen = new Set(shown.map((r) => `${String(r.grant.grantor)}/${r.room}`));
  const droppedSubjects = [
    ...new Set(
      byGrantor
        .flatMap((b) => b.rows)
        .filter((r) => !seen.has(`${String(r.grant.grantor)}/${r.room}`))
        .map((r) => `${String(r.grant.grantor)}/${r.room}`),
    ),
  ].sort(cmp);
  return { shown, dropped: total - shown.length, droppedSubjects };
}

function affordancesFor(
  runtime: Runtime,
  principal: PrincipalId,
  tick: number,
  board: readonly BoardRow[],
  /** Eligible slots the board's own cap dropped. See {@link boardFor}. */
  boardDropped: number,
  /**
   * The campaign views the payload publishes, passed rather than recomputed.
   *
   * `books`'s reason exactly: `readCampaignForce` is recomputed on every read and never cached, so
   * two calls in one observation could publish two force readings of the same war — the affordance
   * offering a join on one number while `holding.campaigns[]` shows another, inside a single payload.
   */
  campaignViews: readonly CampaignView[],
  /** The same books the payload publishes, so a quote cannot disagree with the ladder. */
  books: readonly PublicBook[],
  /**
   * `market.at` — the venues a `trade` could reach, straight off the published block.
   *
   * Passed rather than recomputed from `hands`, for the reason `books` is passed: the withheld
   * row's claim *"market.at[] is empty"* has to be true of the array the agent is holding, and a
   * second derivation of "where am I present" is a second answer to the question that decides it.
   */
  venues: readonly VenueId[],
): AffordanceSet {
  const eligible: Affordance[] = [];

  // ── ★ PHASE 3'S RISK MARKET, PUSHED HERE AND NOT AFTER THE TRUNCATION ──────
  //
  // The first wiring pushed these onto `list` *below*, past `prioritised.slice(0, MAX_AFFORDANCES)`.
  // Two things were wrong with that and both are this file's own rules:
  //
  //   1. **It could take the payload past `MAX_AFFORDANCES`**, which is INV-26's bounded buffer.
  //   2. **It skipped the distinct-verb-first pass**, whose comment says in full why that pass exists:
  //      *"it guarantees no mechanic is invisible merely because another mechanic has many variants."*
  //      A COVER offer arriving after the slice is outside that guarantee in both directions — it
  //      cannot be dropped, and it cannot be counted in `dropped` either.
  //
  // So the offers join the pool before any ordering happens, exactly like every other mechanic's, and
  // `elect` goes first because it is the one with a deadline: §7.4's honour window closes at the freeze
  // and an election nobody was offered is a refusal the clock wrote.
  const riskAffordances = runtime.riskAffordances(principal, tick);
  for (const offer of riskAffordances.offered) {
    eligible.push({
      verb: offer.verb,
      params: offer.params,
      cost: 1,
      max_direct_loss: offer.maxDirectLoss,
      max_contingent_liability: offer.maxContingentLiability,
      what_it_forecloses: offer.forecloses.join('; '),
      expires_tick: offer.expiresTick,
      quote_id: quoteId(principal, tick, offer.verb, offer.params),
    });
  }
  /** Charge deliveries withheld because no hand of this principal is standing there. */
  let chargeNoHand = 0;
  const chargeNoHandAt: string[] = [];
  /** Carries withheld: a co-member has an escrowable remainder this principal cannot reach. */
  let carryBlocked = 0;
  const carryBlockedWhy = new Set<string>();
  /** `audit` withheld: grants are out, but none of them carries a CLEARANCE, so the log is empty. */
  let auditNoClearance = 0;
  /**
   * ★ §16.12 #1: RAIDER `join`s withheld because this principal's SWAY at the stage is 0.
   *
   * Counted rather than silent, because a menu that shrinks without saying why teaches the wrong
   * rule — the agent concludes predation is unreliable rather than that its reach is finite, and
   * the corrective act (take ground nearer, or a STRAIT) is one it will never look for. The
   * DEFENDER side of the same standoff is still offered, so this is a **narrowed** menu rather than
   * an absent one, and the row has to say which half went.
   */
  let raiderJoinsBeyondSway = 0;
  const raiderJoinSwayWhy = new Set<string>();
  /**
   * ★ Standoffs the reader is A PARTY TO where more of its hands would count and none can get there.
   *
   * The `your_side !== null` arm of the raid chain did not exist at all, so an initiator standing at
   * its own demand's stage got no affordance, no reason and no counter — this project's signature
   * defect landing on §9's own initiator. Collected here rather than pushed inline because `reasons`
   * is declared below the loop, and one array in two scopes is how a count and its text drift apart.
   */
  const reinforcementSilent: string[] = [];
  /** Reachable principals `MAX_PARLEY_AFFORDANCES` dropped, and who they were. */
  let parleyReachDropped = 0;
  let parleyReachDroppedNames: readonly string[] = [];
  /** Reachable principals the shared gate refused for a reason the reach rule does not know. */
  let parleyGated = 0;
  /** Why no parley is offered at all: not entitled, spent, or nobody reachable. See the block. */
  let parleyWithheldReason: string | null = null;
  let parleyWithheldCount = 0;
  /** Dossier rows `MAX_DOSSIER_OFFERS` dropped — see 5C-bis. Was silent, and a leak rode through it. */
  let clearanceOffersDropped = 0;
  /** Whose compartments those dropped rows were about, so the ground names a subject. */
  let clearanceOffersDroppedSubjects: readonly string[] = [];
  const world = runtime.world;
  const hands = handsOf(world, principal);
  const mine = runtime.ventures.forPrincipal(principal);
  const free = runtime.ledger.account(storesAccount(principal)) === undefined
    ? minor(0)
    : runtime.ledger.freeBalance(storesAccount(principal));
  /**
   * ★ **WHAT A BID MAY ACTUALLY COMMIT — `freeCash`, not `free`.**
   *
   * ══════════════════════════════════════════════════════════════════════════
   * `free` above is the raw unlocked balance and it is the right figure for everything that
   * **destroys** currency — a WORKS, a crossing, a Charge — which is why it exists. It was
   * also the figure the `trade` BID affordance sized itself against, while `planOrder` gates
   * the same order on `freeCash` (`market/place.ts:188`). Those differ by the whole
   * endowment, so on the live shard's own numbers — 200,000 free, 0 transferable — the menu
   * would have offered a BID for up to 200,000 and the verb would have refused every one of
   * them: the server telling an agent to do something and then declining, which is AGT-S2's
   * failure and costs the agent a real action every time.
   *
   * It never fired only because the probe's venue had no resting ask to price against. It
   * would have fired on the first order anybody rested there.
   * ══════════════════════════════════════════════════════════════════════════
   */
  const transferable = freeCash(runtime.ledger, principal);

  // 0. **Answer the demand.** A raid is a decision under a published clock and it is
  //    the only thing on this list with a deadline nobody can be talked out of, so it
  //    sorts above everything — including an unsigned venture, which at worst lapses.
  //
  //    Both branches carry the exact arithmetic in `max_direct_loss`, which for a raid
  //    is a quantity of goods rather than currency: `yield` costs what the demand can
  //    actually take, `fight` costs the multiple if the force reading says the defence
  //    is short. A2 forbids an estimate here and the numbers come from the same
  //    `RaidView` the payload publishes, so the affordance and the block cannot
  //    disagree (scar #1).
  for (const view of runtime.raidsFor(principal, tick, MAX_LIST_ROWS)) {
    if (view.state !== 'DEMANDED') continue;
    if (view.target === principal) {
      eligible.push({
        verb: 'yield',
        params: { raid: view.raid },
        cost: 1,
        max_direct_loss: view.costs.pay,
        max_contingent_liability: 0,
        what_it_forecloses:
          `paying hands over ${String(view.costs.pay)} of ${view.good} at ${view.stage} at once and the raid ` +
          `leaves. It is not a default and it does not move your standing — nothing a raid does ever does. ` +
          `Ignoring it costs ${String(view.costs.if_you_do_nothing)} instead (the published multiple is ` +
          `${String(RAID_TAKE_MULTIPLE)}x, capped at half of what is actually there).` +
          // ── ★ AND THE PART THAT IS NOT GOODS AT ALL ───────────────────────
          //
          // `works_at_risk` reached the payload the moment `RaidView` carried it, and a field nothing
          // points at is a capability an agent cannot find — this project's signature defect on the
          // exact surface A2 calls the interface. A razing is the largest loss in this decision and it
          // is not denominated in the good the other two numbers are, so it has to be said in words.
          (view.costs.works_at_risk === null
            ? ''
            : ` And as it stands the raid would RAZE ${view.costs.works_at_risk} — a WORKS is destroyed ` +
              `permanently, and rebuilding costs 5000 ration plus 60000 currency with no first-works ` +
              `discount. Paying stops that too.`),
        expires_tick: view.resolves_tick,
        quote_id: quoteId(principal, tick, 'yield', { raid: view.raid }),
      });
      const losing = view.force.verdict_if_resolved_now === 'PLUNDERED';
      eligible.push({
        verb: 'fight',
        // `system` is not decoration: `fight` is HOSTILE, so the Commons floor refuses it
        // unless the params name a place it can locate (`world/commons.ts` exports the
        // spellings for exactly this). An affordance is a complete, copyable act — agents
        // copy these verbatim — so omitting it would hand out a move the floor rejects.
        params: { raid: view.raid, system: view.stage },
        cost: 1,
        // Exact, and it is the honest worst case: if the force reading says the defence
        // is short, resisting costs the multiple AND every IDLE hand you have there goes
        // RECOVERING. If it says the defence holds, resisting costs nothing in goods —
        // and the number says so rather than hedging.
        max_direct_loss: losing ? view.costs.if_you_do_nothing : 0,
        max_contingent_liability: view.costs.if_you_do_nothing,
        what_it_forecloses:
          `your force at ${view.stage} would be ${String(view.force.defender_if_you_fight)} against the raid's ` +
          `${String(view.force.raider)}; higher wins and ties go to you, so as it stands you would ` +
          `${losing ? 'LOSE' : 'HOLD'}. Losing costs ${String(view.costs.if_you_do_nothing)} of ${view.good} and ` +
          `sends every IDLE hand you have there to RECOVERING — never destroyed, and never your holding, your ` +
          `identity or your standing. Winning costs nothing and takes any raider's forfeited stake. Others may ` +
          `still join either side before tick ${String(view.resolves_tick)}.` +
          // ── ★ THE RAZE MARGIN, WHICH IS WHY MUSTERING PAYS EVEN IF YOU LOSE ─
          //
          // The one number that makes `fight` rational against a raid you cannot beat: losing narrowly
          // costs goods, being ROUTED costs the structure. `save_works_force` is the published
          // threshold and it is the same call the resolver makes (scar #1), so the menu and the
          // outcome cannot disagree.
          (view.costs.works_at_risk === null
            ? view.costs.save_works_force > 0
              ? ` Your structures at ${view.stage} are out of raze range as it stands.`
              : ''
            : ` ★ As it stands the raid would also RAZE ${view.costs.works_at_risk}: an assault that wins by ` +
              `2 or more DESTROYS a WORKS at the stage, permanently. ` +
              `${String(view.costs.save_works_force)} more force here puts it out of range — you would still ` +
              `lose the ${view.good}, and you would keep the structure. One hand is 1 and one joiner is 1.`) +
          // ── THE HALF THAT MAKES A FLEET WORTH FLYING, AND IT WAS MISSING ────
          //
          // A world raid's own force USED to be a scalar nothing could touch, so an agent that read
          // this line correctly would never `engage`: hulls are destroyed permanently and could not
          // move the outcome. Now `force.raid_force_left` falls one per world hull destroyed, and an
          // agent that is not told so has a capability it cannot find (this project's signature
          // defect, on the exact surface A2 calls the interface).
          (view.initiator === null
            ? ` The raid's own force is ${String(view.force.raid_force_left)} of the ` +
              `${String(view.force.raid_force_at_spawn)} it arrived with, and it is its FLEET: after you answer ` +
              `FIGHT, \`engage\` commits hulls, and every one of the world's hulls you destroy takes 1 off ` +
              `that number before this standoff resolves. Its fit is published, so the arithmetic is exact.`
            : ` ${String(view.initiator)} brings no force of its own — all of it is hands, counted the same ` +
              `way yours are.`),
        expires_tick: view.resolves_tick,
        quote_id: quoteId(principal, tick, 'fight', { raid: view.raid }),
      });
    } else if (view.your_side === null && view.force.your_hands_here <= 0 && view.march !== null) {
      // `your_hands_here <= 0` used to be implicit in `march !== null` — the view nulled the route the
      // moment a hand of the reader's stood at the stage. It does not any more (a second hand is worth a
      // point of force now), so the condition has to be stated here or this branch swallows the `join`
      // branch below and a reader standing AT the stage is told to walk to it.
      // ── ★ THE MARCH: THE ONE ACT THAT MAKES `join` REACHABLE, AND IT HAD NO AFFORDANCE ──
      //
      // ══════════════════════════════════════════════════════════════════════════
      // **`join` IS OFFERED ONLY TO A PRINCIPAL ALREADY STANDING AT THE STAGE, AND THAT CONDITION
      // WAS MET 0 TIMES IN 72 WORLD RAIDS.** The `join` branch below is correct and was empty:
      // 70% of a principal's hand-ticks are `COMMITTED` and its hands are mostly not even at its own
      // body, so the escort market §9 argues for had a demand side nobody could see and a supply side
      // two lanes away.
      //
      // A `join` affordance for a hand that is not there would be a move the handler refuses
      // (AGT-S2), which costs an agent an action and its trust in the menu. So the affordance is the
      // **walk**, with the whole arithmetic of it: which hand, the next gate, how many actions the
      // trip costs, the tick it arrives, and the tick the window shuts. `max_direct_loss` is 0
      // because walking loses nothing — what it spends is presence, and the sentence says so.
      // ══════════════════════════════════════════════════════════════════════════
      const march = view.march;
      eligible.push({
        verb: 'move',
        params: { hand: march.hand, to: march.next },
        cost: 1,
        max_direct_loss: 0,
        max_contingent_liability: 0,
        what_it_forecloses:
          `${view.target} is under a demand at ${view.stage} and you are not in it. Your hand ${march.hand} ` +
          `stands at ${march.from}, ${String(march.hops)} gate(s) away: one \`move\` per gate, arriving tick ` +
          `${String(march.arrives_tick)} against a window that shuts at ${String(view.resolves_tick)} — ` +
          `${march.in_time ? 'in time' : 'TOO LATE, and this walk would arrive at a resolved standoff'}. ` +
          `Standing there lets you \`join\` for 1 action, which adds 1 to their force (currently ` +
          `${String(view.force.defender_if_you_fight)} against ${String(view.force.raider)}, of which ` +
          `${String(view.force.defender_joiners)} is already somebody else's hands) and stakes no capital. ` +
          `What it costs is the hand: it is not filling a role or carrying tribute while it stands there, ` +
          `and if the defence loses it goes RECOVERING.`,
        expires_tick: view.resolves_tick,
        quote_id: quoteId(principal, tick, 'move', { raid: view.raid, hand: march.hand, to: march.next }),
      });
    } else if (view.your_side === null) {
      eligible.push({
        verb: 'join',
        params: { raid: view.raid, side: 'DEFENDER' },
        cost: 1,
        // A defender stakes no capital. What it risks is a hand: if the raid wins, the
        // hand it put in goes RECOVERING with the target's.
        max_direct_loss: 0,
        max_contingent_liability: 0,
        what_it_forecloses:
          `standing with ${view.target} at ${view.stage} puts one IDLE hand of yours in the line and adds 1 to ` +
          `their force (currently ${String(view.force.defender_if_you_fight)} against ${String(view.force.raider)}). ` +
          `If the raid wins, that hand goes RECOVERING. Nothing else of yours is reachable.`,
        expires_tick: view.resolves_tick,
        quote_id: quoteId(principal, tick, 'join', { raid: view.raid, side: 'DEFENDER' }),
      });
      // ── ★ §16.12 #1: THE RAIDER SIDE IS OFFERED ONLY WITHIN YOUR SWAY ─────
      //
      // `vJoin` refuses a RAIDER join at sway 0 and `readForce` would count its hand as nothing
      // anyway, so offering it here would be a move the handler refuses — AGT-S2, costing an agent
      // an action and its trust in the menu, for a side that could not have helped.
      //
      // The DEFENDER offer above is deliberately NOT gated: defence is never capped by sway, which
      // is the asymmetry `world/sway.ts` owns. So a principal fenced out of the raider's side is
      // still offered the other one, and the withheld row below says which and why.
      if (view.force.your_sway <= 0) {
        raiderJoinsBeyondSway += 1;
        raiderJoinSwayWhy.add(view.stage);
      } else if (free >= RAID_JOIN_STAKE_MINOR) {
        eligible.push({
          verb: 'join',
          // `principal` for the same reason `fight` carries `system`: joining the raider's
          // side is HOSTILE and the floor is checked against the principal named here.
          params: { raid: view.raid, side: 'RAIDER', principal: view.target },
          cost: 1,
          max_direct_loss: RAID_JOIN_STAKE_MINOR,
          max_contingent_liability: RAID_JOIN_STAKE_MINOR,
          what_it_forecloses:
            `joining the raid locks ${String(RAID_JOIN_STAKE_MINOR)} of your stores and puts one IDLE hand in. ` +
            `If the raid is REPULSED the stake goes to ${view.target} and your hand goes RECOVERING; if it takes ` +
            `the goods, the raiders split them and your stake comes back. This is a hostile act and is INVALID ` +
            `against anything in the Commons (A8). Your SWAY at ${view.stage} is ` +
            `${String(view.force.your_sway)}, so your hand counts as force there — a RAIDER's does only within ` +
            `its reach, and ${String(view.force.raiders_out_of_sway)} hand(s) already standing on that side ` +
            `count for nothing.`,
          expires_tick: view.resolves_tick,
          quote_id: quoteId(principal, tick, 'join', { raid: view.raid, side: 'RAIDER', principal: view.target }),
        });
      }
    } else {
      // ══════════════════════════════════════════════════════════════════════════
      // ★ **THE BRANCH THAT DID NOT EXIST: A READER ALREADY IN THE STANDOFF.**
      //
      // The chain above is `target · not-in-it-and-far · not-in-it-and-here`, so `your_side ===
      // 'RAIDER' | 'DEFENDER'` fell through **every** arm — no affordance, no `withheld` row, and no
      // increment of any counter. A blind player that opened its own `demand` therefore stood at the
      // stage holding two IDLE hands, read `force.raider: 1`, and got silence from the one surface
      // that is supposed to say what was withheld and why. That is this project's signature defect
      // landing on §9's own initiator: *"offence is priced in allies the reach rules forbid asking."*
      //
      // `join` is genuinely closed to it — `RaidBook.addParty` throws on a second row for one
      // principal, deliberately, because `join` is a coalition verb and not a reinforcement verb. So
      // the answer is not a `join` offer; it is `move`, which is now a real answer because
      // `readForce` counts `min(hands standing here, sway here)` rather than one point per party.
      // **The hands you have standing there are the force you have.**
      // ══════════════════════════════════════════════════════════════════════════
      const supplied = view.force.your_hands_here;
      const room =
        view.your_side === 'RAIDER'
          ? Math.max(0, view.force.your_sway - supplied)
          : Math.max(0, HANDS_PER_PRINCIPAL - supplied);
      const march = view.march;
      if (room > 0 && march !== null) {
        eligible.push({
          verb: 'move',
          params: { hand: march.hand, to: march.next },
          cost: 1,
          max_direct_loss: 0,
          max_contingent_liability: 0,
          what_it_forecloses:
            `you are ${String(view.your_side)} in ${view.raid} at ${view.stage}, and force is counted in HANDS ` +
            `STANDING THERE when it resolves — never in how many principals took a side. It reads ` +
            `${String(view.force.raider)} raider against ${String(view.force.defender_if_you_fight)} defender ` +
            `(${view.force.verdict_if_resolved_now} as it stands, ties to the defender), and ${String(supplied)} ` +
            `of those hands are yours. Hand ${march.hand} stands at ${march.from}, ${String(march.hops)} gate(s) ` +
            `away: one \`move\` per gate, arriving tick ${String(march.arrives_tick)} against a window that ` +
            `shuts at ${String(view.resolves_tick)}` +
            `${march.in_time ? '' : ' — TOO LATE, and this walk would arrive at a resolved standoff'}. ` +
            (view.your_side === 'RAIDER'
              ? `Your SWAY at ${view.stage} is ${String(view.force.your_sway)} and that is the CAP on how many of ` +
                `your hands count as force there, so ${String(room)} more would count and anything beyond that ` +
                'would not. `join` cannot add one — one principal is one party row — so walking is the way.'
              : `Up to ${String(HANDS_PER_PRINCIPAL)} of your hands count when you are defending and sway never ` +
                `caps a defence, so ${String(room)} more would count.`),
          expires_tick: view.resolves_tick,
          quote_id: quoteId(principal, tick, 'move', { raid: view.raid, hand: march.hand, to: march.next }),
        });
      } else if (room > 0) {
        reinforcementSilent.push(
          `${view.raid} at ${view.stage}: ${String(room)} more of your hands would count as force there and you ` +
            'have none that is IDLE, free and able to reach the stage before it resolves. Force is HANDS ' +
            'STANDING THERE at resolution, `join` cannot add a second one (one principal is one party row), so ' +
            'walking is the only way and there is nothing left to walk',
        );
      }
    }
  }

  // ── 0. COMBAT (SPEC §9A) ─────────────────────────────────────────────────
  //
  // ══════════════════════════════════════════════════════════════════════════
  // **A VERB WITH NO AFFORDANCE IS THIS PROJECT'S SIGNATURE DEFECT**, and combat is the most
  // exposed thing yet built to it: an agent that has never seen `engage` on its menu has no reason
  // to believe a battle is something it can take part in, and A14's whole premise is that agents
  // left to themselves choose silence.
  //
  // Worse today than usual, and measured rather than feared: **the LLM cast cannot currently read
  // the standoff's rules at all.** `agent.md` §11D is over the per-wake excerpt bar and is omitted
  // from every wake, so `demand`, `yield`, `fight` and `join` are already offered and
  // unexplained. Until that is fixed, `what_it_forecloses` IS the documentation — which is why the
  // strings `combat/view.ts` builds are paragraphs rather than phrases.
  //
  // **Gated on `runtime.engageRefusalFor`, which is the gate `vEngage` itself runs.** Not a copy
  // of it — the same function.
  // ══════════════════════════════════════════════════════════════════════════
  for (const offer of engageOffersFor(runtime.battles, runtime.fleet, {
    principal,
    tick,
    committable: (stage: SystemId) => runtime.committableHulls(principal, stage),
    refusal: (probe: {
      readonly raid: string;
      readonly hull: string | null;
      readonly echelon: string;
      readonly posture: string;
    }) =>
      runtime.engageRefusalFor({
        principal,
        raid: probe.raid,
        tick,
        hull: probe.hull === null ? null : (probe.hull as never),
        echelon: probe.echelon as never,
        posture: probe.posture as never,
        primary: ['REPAIR', 'COMMAND', 'TACKLE', 'WEAKEST'] as never,
        withdrawWhen: { ehpBelowBps: 0, hullsLost: 0, now: false },
        handId: null,
      }) === null,
    limit: MAX_COMBAT_AFFORDANCES,
  })) {
    eligible.push({
      ...offer,
      quote_id: quoteId(principal, tick, 'engage', offer.params as CanonicalValue),
    });
  }

  // ── 0b. BUILD A HULL ────────────────────────────────────────────────────
  //
  // Offered only when it can actually be taken, exactly like `create` and `graduate`: eligibility
  // is affordability in this file, and an offer the engine would refuse costs the agent a real
  // action (AGT-S2). When the price is short, the reason goes to `withheld`.
  const hullSeat = holdingOf(world, principal).system;
  const hullPrice = hullQuote(STARTER_HULL);
  if (
    hullPrice !== null &&
    runtime.hullRefusalFor({
      principal,
      system: hullSeat,
      hull: STARTER_HULL,
      modules: STARTER_FIT,
      tick,
    }) === null
  ) {
    eligible.push({
      ...hullOfferFor({
        system: hullSeat,
        hull: STARTER_HULL,
        modules: STARTER_FIT,
        frame: Number(hullPrice.frame),
        fuel: Number(hullPrice.fuel),
        readyAtTick: tick + 4,
        wrecks: runtime.fleet.wrecksOf(principal),
      }),
      quote_id: quoteId(principal, tick, 'build', { kind: 'HULL', hull: STARTER_HULL, system: hullSeat }),
    });
  }

  // 0a. **OPEN ONE OF YOUR OWN.** §9's agent-initiated standoff — the only act in this game
  //     that starts a fight with your name on it.
  //
  //     ══════════════════════════════════════════════════════════════════════
  //     **A VERB WITH NO AFFORDANCE IS THIS PROJECT'S SIGNATURE DEFECT.** Nine mechanics were
  //     once legal and unreachable, `grant` — the A6 core loop — among them, and the live frame
  //     published `authorityLines: 0` as the direct result while the cast prompt told players
  //     "the safest plan is built from entries in affordances[]". Predation is more exposed to
  //     it than most: an agent that has never seen a `demand` on its menu has no reason to
  //     believe it can attack anybody, and A14's whole premise is that agents left to
  //     themselves choose silence.
  //
  //     **Gated on `runtime.demandRefusalFor`, which is the gate `vDemand` itself runs.** Not a
  //     copy of it — the same function. An affordance with its own copy offers moves the handler
  //     refuses, which costs an agent an action and its trust in the menu.
  //     ══════════════════════════════════════════════════════════════════════
  //
  //     The candidate targets are principals whose **holding** stands where a hand of yours
  //     does. A holding is a named body on the map and is `PUBLIC` (§3, §11.2), so this offers
  //     no fact a stranger could not already read — deliberately *not* "principals with goods
  //     here", which would answer a `SENSED` question through the menu.
  const demandsLeft = runtime.demandsRemainingFor(principal, tick);
  /**
   * The same block `header.aggression` publishes, read here so the count in the menu's prose and
   * the count in the header are one number rather than two that agree today (scar #5).
   */
  const demandOpenUntilTick = runtime.aggressionFor(principal, tick).open_until_tick;
  const myStages = new Set(
    hands
      .filter((hand) => hand.state === 'IDLE' && tierOf(world.map, hand.location) !== 'COMMONS')
      .map((hand) => hand.location),
  );
  const demandStages = [...myStages].sort(cmp);
  /**
   * Reported below and **counted**, because capacity spent is a PRICE and a price nobody is told
   * about is not one.
   *
   * Counted as one rather than as "how many targets were suppressed": the thing withheld is the
   * *act*, and the agent has zero of them regardless of how many neighbours it is standing next
   * to. Counting neighbours would make the number move for a reason that has nothing to do with
   * what was actually taken away.
   */
  const demandCapacitySpent = demandsLeft <= 0 && myStages.size > 0;
  let demandsOffered = 0;
  /**
   * Candidate targets considered, and the distinct reasons the gate gave for the ones it refused.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THE SILENT HALF OF THE SAME DEFECT.** `demandCapacitySpent` speaks only when the capacity is
   * gone. An agent holding all of it and offered no `demand` was told *nothing* — and a probe
   * reported, correctly, that it could not distinguish "you have none" from "we withheld it".
   * `header.withheld` closes with *"Nothing you were eligible for has been dropped without this
   * count"*, and for this case that sentence was false.
   *
   * The engine already knows the answer: `demandRefusalFor` is the same predicate `vDemand` runs
   * and it returns a full sentence. Carrying the sentence costs nothing an agent has to guess at;
   * carrying only a code would be handing it a wiki, which is the thing A2 forbids by name.
   * ══════════════════════════════════════════════════════════════════════════
   */
  let demandCandidates = 0;
  const demandRefusedWhy = new Set<string>();
  if (demandsLeft > 0) {
    for (const stage of demandStages) {
      if (demandsOffered >= MAX_DEMAND_AFFORDANCES) break;
      for (const other of world.principalOrder) {
        if (demandsOffered >= MAX_DEMAND_AFFORDANCES) break;
        if (other === principal) continue;
        const holdingId = world.holdingByPrincipal.get(other);
        if (holdingId === undefined || world.holdings.get(holdingId)?.system !== stage) continue;
        demandCandidates += 1;
        const ask = RAID_DEMAND_QTY.min;
        const refusal = runtime.demandRefusalFor({
          initiator: principal,
          target: other,
          stage,
          good: LEVY_GOOD,
          demand: ask,
          tick,
          handId: null,
        });
        if (refusal !== null) {
          // Bounded (INV-26) and deduplicated: the common shape is one global reason repeated
          // once per neighbour, and two distinct sentences is already more than a reader needs
          // to know what to change.
          if (demandRefusedWhy.size < MAX_DEMAND_REFUSAL_REASONS) demandRefusedWhy.add(refusal.hint);
          continue;
        }
        demandsOffered += 1;
        // A2: exact arithmetic, not an impression. One hand is force 1; a target that answers
        // with nothing musters only its terrain; ties go to the defender. So the whole verdict
        // against a silent target is a comparison of two integers the agent can check.
        const tier = tierOf(world.map, stage);
        const terrain = FORCE_BY_TIER[tier] ?? 0;
        const aloneWins = 1 > terrain;
        eligible.push({
          verb: 'demand',
          // `principal` AND `system`: `demand` is HOSTILE, so the Commons floor refuses it
          // unless the params name something it can locate, and `world/commons.ts` exports the
          // spellings for exactly this. An affordance is a complete, copyable act.
          params: { principal: other, system: stage, good: LEVY_GOOD, qty: ask },
          cost: 1,
          // Exact, and it is the honest worst case rather than the hoped-for one: what you
          // lose is the stake, in full, the moment the target repulses you. What you might
          // *take* is not a figure this field has any business predicting — you cannot see
          // what is there, and predicting it would be the "Charge fuel gauge" mistake with
          // the sign flipped.
          max_direct_loss: RAID_JOIN_STAKE_MINOR,
          max_contingent_liability: RAID_JOIN_STAKE_MINOR,
          what_it_forecloses:
            `demanding ${String(ask)} of ${LEVY_GOOD} from ${other} at ${stage} spends 1 of your ` +
            `${String(AGGRESSION_PER_RECKONING)} demands this Reckoning (${String(demandsLeft)} left, and ` +
            `unspent capacity DOES NOT CARRY — what you do not use is gone), locks ` +
            `${String(RAID_JOIN_STAKE_MINOR)} of your stores and puts one IDLE hand in for ` +
            `${String(DEMAND_WINDOW_TICKS)} ticks. A demand brings NO force of its own: all of it is hands, ` +
            `counted when the window closes. Yours is 1; ${stage} is ${tier}, worth ${String(terrain)} of ` +
            `terrain to the defender, and ties go to the DEFENDER — so against a target that answers with ` +
            `nothing you ${aloneWins ? 'TAKE IT ALONE' : 'LOSE ALONE and need one ally on your side'}. If ` +
            `it repulses you, your stake goes to ${other} and your hand goes RECOVERING (never destroyed). ` +
            `Nothing tells you what ${other} actually holds there: guess wrong and the raid finds ballast, ` +
            `takes nothing, and you have paid all of the above for a MISSED.`,
          expires_tick: tick + DEMAND_WINDOW_TICKS,
          quote_id: quoteId(principal, tick, 'demand', { principal: other, system: stage, qty: ask }),
        });
      }
    }
  }

  /**
   * **You hold capacity and the menu is still empty — the case that said nothing at all.**
   *
   * Gated on `!commonsBound` on purpose, and the gate is the `withheld` contract rather than
   * tidiness: the promise is *"nothing you were ELIGIBLE for has been dropped without this
   * count"*, and a Commons-bound principal is not eligible for a hostile act at any price (A8
   * makes it **invalid**, not refused). Counting it would put a row on every newcomer's every
   * wake for a decision it cannot make — while `header.aggression` publishes the count to that
   * newcomer regardless, which is the half that was actually missing.
   */
  const demandSilent =
    demandsLeft > 0 && demandsOffered === 0 && !principalIsCommonsBound(world, principal);

  // 0b. **Supply a claim of yours.** Second only to a raid, and for the same reason: the
  //     deadline is the Reckoning, nobody can be talked out of it, and the consequence is
  //     the only thing in this build that can take TERRITORY and slashable capital.
  //
  //     ══════════════════════════════════════════════════════════════════════
  //     **A5′ LIVES HERE.** *"Never record an arrears or a lapse against a claimant that
  //     was never shown what it owed."* The observation block is half of that; this is the
  //     other half, because an agent following the affordance list is the agent most likely
  //     to be following ONLY the affordance list. `max_direct_loss` on a `deliver` is the
  //     goods it hands over; `max_contingent_liability` is what NOT acting costs — the bond
  //     that gets slashed if this is the third miss — because that is the number A6's own
  //     preview rule exists to publish and the number an agent will regret not reading.
  //     ══════════════════════════════════════════════════════════════════════
  for (const claim of runtime.claimsFor(principal, tick)) {
    if (claim.owed <= 0) continue;
    const canPayNow = Math.min(claim.owed, claim.available_here);
    // ── PRESENCE, OR THE OFFER IS A TRAP (AGT-S2) ─────────────────────────
    //
    // A Charge is goods physically handed over, so `chargeDeliveryFault` refuses a delivery
    // with no hand of the deliverer standing at the claimed system — and it is right to.
    // `graduate` moves a HOLDING and leaves the hands where they were, so this is the
    // ORDINARY state of a principal that has just claimed, not an edge case. Offering
    // `deliver` there costs the agent a real action on an act the engine will refuse; the
    // acceptance test caught exactly that, verbatim. Withheld and counted below.
    if (canPayNow > 0 && claim.hand_here) {
      eligible.push({
        verb: 'deliver',
        params: { obligation: 'CHARGE', system: claim.system, amount: canPayNow },
        cost: 1,
        max_direct_loss: canPayNow,
        max_contingent_liability: claim.if_you_do_nothing === 'LAPSES' ? claim.bond_at_risk : 0,
        what_it_forecloses:
          `${String(canPayNow)} of ${claim.good} standing at ${claim.system} is destroyed and credited against ` +
          `this Reckoning's Charge of ${String(claim.due)}; ${String(claim.owed - canPayNow)} would still be ` +
          `owed after it. Partial payment counts. ${claim.consequence}`,
        expires_tick: claim.deadline_tick,
        quote_id: quoteId(principal, tick, 'deliver', { obligation: 'CHARGE', system: claim.system }),
      });
    } else if (canPayNow > 0) {
      chargeNoHand += 1;
      chargeNoHandAt.push(claim.system);
    }
    // The two exits, offered **only once the record has actually published a miss.** The
    // first draft offered them whenever a Charge was outstanding, which is *every* claim at
    // the start of *every* Reckoning — so a principal that had just taken territory and had
    // 280 ticks to pay for it was handed "sell it" and "give it up" as its top two
    // affordances. That is the server suggesting surrender, which is advice and not an
    // affordance (A12: ship the sandbox, never the narrative). From STRAINED onward there are
    // still two whole Reckonings to use them in, so nothing is lost by waiting for a fact.
    if (claim.state === 'STRAINED' || claim.state === 'CONTESTED') {
      eligible.push({
        verb: 'publish_offer',
        params: { cede: claim.system, price: 0 },
        cost: 1,
        max_direct_loss: 0,
        max_contingent_liability: 0,
        what_it_forecloses:
          `puts ${claim.system} up for sale at a price you set — 0 means "take it off my hands". A buyer ` +
          `inherits the claim AND its ${String(claim.arrears)} arrears, and pays you the price. Publishing an ` +
          `offer takes nothing from you and can be restated; nobody can take the claim without your offer ` +
          `unless it is CONTESTED and the published window is open.`,
        expires_tick: claim.deadline_tick,
        quote_id: quoteId(principal, tick, 'publish_offer', { cede: claim.system }),
      });
      eligible.push({
        verb: 'abandon',
        params: { claim: claim.system },
        cost: 1,
        // Exact: giving up costs the unsalvaged part of the bond, which is strictly less
        // than a lapse takes. That comparison is the whole reason this affordance exists.
        max_direct_loss: claim.bond_at_risk - Math.trunc((claim.bond_at_risk * CESSION_SALVAGE_BPS) / BPS_ONE),
        max_contingent_liability: 0,
        what_it_forecloses:
          `gives up ${claim.system} now. 60% of the ${String(claim.bond_at_risk)} bond stops being at risk and ` +
          `the rest is retired; the claim ends CEDED, not LAPSED. A lapse takes the whole ` +
          `${String(claim.bond_at_risk)}, so this is cheaper than failing — and the arrears stay with the ` +
          `ground for whoever claims it next.`,
        expires_tick: claim.deadline_tick,
        quote_id: quoteId(principal, tick, 'abandon', { claim: claim.system }),
      });
    }
  }

  // 1. Sign what is waiting on you. Nothing binds until both parties countersign,
  //    so an unsigned venture is the most time-critical thing on the list.
  for (const venture of mine) {
    if (venture.state !== 'FORMING') continue;
    if (venture.countersigned.has(principal)) continue;
    if (venture.termsHash === null) continue;
    const payer = venture.creator === principal;
    // ── ★ `max_direct_loss` WAS KEYED ON THE WRONG FACT, AND READ 0 ────────────
    //
    // It was `role === null ? escrowRequired(venture) : minor(0)` — the escrow quoted to
    // whoever holds NO role, rather than to whoever OWES it. Those coincide for a filler
    // and for a bare creator, and come apart for the one case in between: **a creator that
    // also fills a role in its own venture.** `fill_role` on your own venture is offered
    // from the menu, so this is a copy-two-affordances-in-a-row path, not an edge case.
    //
    // Measured from outside on a live world: the same creator's own `sign` quoted
    // `max_direct_loss: 4800` before it filled a role and **0** after, while the escrow it
    // owed had not changed by a unit. A6's headline promise is *"with `max_direct_loss` and
    // `max_contingent_liability` shown before you sign"* — reported as zero, on the verb
    // that promise is named after, for the party that carries the whole escrow.
    //
    // `src/observe/catalogue.ts` had it right all along (`isCreator ? escrowRequired : 0`),
    // which is the "two builders, one question, two answers" shape: the path `api/server.ts`
    // actually serves was the wrong one.
    const owed = payer ? escrowRequired(venture) : minor(0);
    // ── `sign` binds the terms and carries NO election ─────────────────────────
    //
    // It used to carry one, and the affordance was right to while `sign` was the only
    // door: an affordance is a **complete, copyable act** (`test/api/blind-play.test.ts`
    // exists because agents copy these params verbatim), and a `sign` that silently
    // elected nothing handed the payer an act whose consequence was a `DECLINED`
    // default. `elect` is now that door, so the election has moved to its own
    // affordance below — and `Runtime.vSign` **refuses** an `election` on a `sign`
    // rather than dropping it, so this parameter list and that handler cannot drift
    // into a payer that thinks it elected and did not.
    eligible.push({
      verb: 'sign',
      params: {
        venture: venture.id,
        terms_hash: venture.termsHash,
        your_take_at_p50: yourTakeAtP50(venture, principal),
      },
      cost: 1,
      max_direct_loss: owed,
      // ── ★ THE CONTINGENT COLUMN WAS 0 ON THE VERB A6 IS NAMED AFTER ───────────
      //
      // It was `electiveOwed(venture, principal)` — Σ of the **pinned** elective over roles
      // ALREADY held by somebody else. A creator countersigns its own venture a tick or two
      // after `create`, when no role is filled, so that expression is 0 by construction for
      // exactly the party that carries the whole contingency. `create` had just quoted the
      // same liability honestly one affordance earlier; the act that BINDS the creator to
      // those terms then quoted it as nothing.
      //
      // `creatorElective().ceiling` is the worst case and carries the argument for counting
      // open roles: `venture/preview.ts` owns it, `elect`'s own `max_direct_loss` is the same
      // per-role expression, and the delegated-`create` gate charges the same bound — so the
      // three published figures for one obligation are now one arithmetic.
      max_contingent_liability: creatorElectiveOf(runtime, venture, principal).ceiling,
      what_it_forecloses: payer
        ? 'signing binds you to these terms; the terms_hash cannot be amended afterwards. It does NOT decide ' +
          'what you pay — that is `elect`, one role at a time, restatable every tick until the freeze. Sign ' +
          'and never elect and you pay nothing, which is a decline and a default on the record. ' +
          'max_contingent_liability above is the WORST CASE: every role that is open today going to a ' +
          'stranger, at the top of the band this kind can deliver in. ventures.mine[].my_elective_owed is ' +
          'what is already owed on the roles somebody holds now, and my_elective_unelected is how much of ' +
          'that still has no election on it.'
        : 'signing binds you to these terms; the terms_hash cannot be amended afterwards.',
      expires_tick: venture.windowClosesTick,
      quote_id: quoteId(principal, tick, 'sign', { venture: venture.id }),
    });
  }

  // 2. State what you will pay on each elective role you are the payer of.
  //
  //    ══════════════════════════════════════════════════════════════════════
  //    **THE CHOICE HAS TO BE OFFERED, OR IT IS NOT A CHOICE.** Before `elect`
  //    existed, betrayal was possible and never offered: the payer's only door was a
  //    parameter on a signature it had already sent, so §7.6's falsification test —
  //    *is the elective part always honoured?* — was being asked of payers that were
  //    never presented with the decision at the moment it mattered.
  //
  //    **One affordance per role, and it carries `IN_FULL`.** Not two, and there is
  //    no separate decline button: A6 is explicit that there is no `betray()` verb,
  //    and betrayal happens "through ordinary legitimate actions". So the honest
  //    offer is the one `agent.md` tells the payer to use — `IN_FULL` — with the
  //    whole truth about the alternative in `what_it_forecloses`, and the agent
  //    constructs the other choice itself out of the same ordinary verb.
  //    ══════════════════════════════════════════════════════════════════════
  for (const venture of mine) {
    if (venture.creator !== principal) continue;
    if (!ELECTABLE_VENTURE_STATES.includes(venture.state)) continue;
    // Restatable *until* the freeze, so inside it there is nothing to offer: §5.1 puts
    // no decision in the settlement window, and `Runtime.vElect` refuses there.
    if (inFreeze(tick) || isSettlementTick(tick)) continue;
    for (const role of venture.roles) {
      // The payer owes an elective part only where somebody else holds the role: a
      // payment to your own stores is booked as paid in full and can never be a breach
      // (scar #9), and `elect` refuses it by name.
      if (role.filledByPrincipal === null || role.filledByPrincipal === principal) continue;
      const owed = runtime.electiveCeilingOf(venture, role.index);
      if (owed <= 0) continue;
      const stated = runtime.electionOn(venture.id, role.index);
      eligible.push({
        verb: 'elect',
        params: { venture: venture.id, role: role.index, election: IN_FULL },
        cost: 1,
        // Exact, not an estimate (A2). See `Runtime.electiveCeilingOf`: the residual is drawn
        // inside a band the kind publishes, so the top of that band is the most this
        // election can ever move — it is arithmetic, not a forecast.
        max_direct_loss: owed,
        // Nothing further is contingent. The election IS the commitment, and it settles
        // at the next Reckoning; there is no later call it can grow into.
        max_contingent_liability: minor(0),
        what_it_forecloses:
          `IN_FULL pays whatever role ${String(role.index)} turns out to be owed, up to ${String(owed)} — ` +
          'never a unit more. It forecloses nothing: you may restate this every tick until the freeze, ' +
          'including downwards. An amount instead of IN_FULL pays exactly that much and anything short of ' +
          'the due is a decline; electing nothing at all is also a decline. A decline is a permanent public ' +
          `default. You have currently stated: ${stated === undefined ? 'nothing, which is a decline' : String(stated)}.`,
        expires_tick: lastTickBeforeFreeze(tick),
        quote_id: quoteId(principal, tick, 'elect', { venture: venture.id, role: role.index }),
      });
    }
  }

  // 3. Seal a role you hold. Free, and mandatory for every sealable role (§11.1).
  //
  //    ══════════════════════════════════════════════════════════════════════
  //    **THIS AFFORDANCE WAS A TRAP AND THE FIX IS TWO FIELDS.** It named
  //    `verb: 'sign'`, and this world records no `sign` deed — the only deed it records
  //    is the delivery, under `DELIVERY_VERB`. With the completeness witness working,
  //    such a seal resolves `CONTRADICTED` **from an absence**: a permanent public lie
  //    about an agent that did exactly what this affordance told it to (A5′, scar #1).
  //    It also banded the claim in `pinnedConsideration(role.terms)`, which is what the
  //    *role* is owed, while a delivery deed's `outcome` is the *venture's* proceeds —
  //    two different quantities compared as if they were one.
  //
  //    Both now come from the runtime: `sealableRoles` decides when a seal about a
  //    delivery can still be kept, and `deliveryBandOf` gives the band the rules
  //    permit. One home each, shared with the cast and with PROP-D4's compliance gate,
  //    so a future edit cannot re-open the trap in one caller only.
  //    ══════════════════════════════════════════════════════════════════════
  for (const ref of runtime.sealableRoles(principal, tick)) {
    const venture = runtime.ventures.get(ref.venture);
    if (venture === undefined) continue;
    const band = runtime.deliveryBandOf(venture);
    eligible.push({
      verb: 'seal',
      params: {
        verb: DELIVERY_VERB,
        target: venture.id,
        role: ref.roleIndex,
        measure: DELIVERY_MEASURE,
        outcome_low: band.low,
        outcome_high: band.high,
      },
      cost: 0,
      max_direct_loss: 0,
      max_contingent_liability: 0,
      what_it_forecloses:
        `a seal is judged once, at this Reckoning, against what you do after it — it cannot be amended or ` +
        `withdrawn. This band is the whole range ${venture.kind} is allowed to deliver in, so keeping it ` +
        'costs you only the delivery itself; narrow it if you want the claim to mean more, and know that a ' +
        'contradicted seal costs standing.',
      expires_tick: lastTickBeforeFreeze(tick),
      quote_id: quoteId(principal, tick, 'seal', { venture: venture.id, role: ref.roleIndex }),
    });
  }

  // 5a-bis. **Say something you can be held to.** `assure` on a venture whose elective half
  //         you owe — offered because THE RECEIPT REEL has never fired otherwise.
  //
  //         ══════════════════════════════════════════════════════════════════════
  //         **THE THIRD TIME TONIGHT, AND THE MOST EXPENSIVE ONE.** `message` is live, FREE,
  //         and taught in `agent.md` and the cast prompt — and it was never on this list.
  //         `graduate` had the same shape (no principal reached the Marches) and so did
  //         `build {"kind":"WORKS"}` (the economy's only faucet, unreachable). An agent plays
  //         from `affordances[]`; prose is not an interface.
  //
  //         Measured on the live world at tick 4,395: twelve rundown segments, ONE genuine
  //         broken promise, and `publicLine: null` on every segment — so §14's receipt reel,
  //         which `CLAUDE.md` calls the signature moment of the entire design, has never fired
  //         in production. Not because it is broken: `test/frames/receipt-reel.spec.ts` proves
  //         the path end to end. Because nobody was ever invited to speak.
  //
  //         Offered to the party that owes the elective half, which is the creator — the only
  //         one who can break it, and therefore the only one whose words the reel wants to
  //         quote. Free, so it never competes with a material action.
  //
  //         ⚑ **AND IT WAS NESTED INSIDE THE `seal` LOOP, so it reached almost nobody.** This
  //         block sat between `for (const ref of sealableRoles(...))` and that loop's own body,
  //         indented as if it were top-level and syntactically inside it. Two consequences, and
  //         each one is the defect this comment was written about, one layer down:
  //
  //           - a principal that owed an elective half and had **no sealable role** was offered
  //             nothing — the common case, because a seal needs a role you hold in a live venture
  //             while an elective half is owed by whoever CREATED one;
  //           - and a principal that had several sealable roles was offered the same assurance
  //             once per role. Measured in one observation: two `seal` offers and **ten identical
  //             `message:assure` rows**, all for the same two ventures.
  //
  //         Found by the cast taking territory: `varrow` ended a run owing two elective halves
  //         with no sealable role, so `receipt-reel.spec.ts` failed by name on the assertion its
  //         own author added *because* the earlier version of this affordance had not been tested
  //         against the list. The nesting is why the fix it recorded did not hold.
  //         ══════════════════════════════════════════════════════════════════════
  for (const owed of runtime.electivePromisesOwedBy(principal)) {
    eligible.push({
      verb: 'message',
      params: { venture: owed.venture, act: 'assure', text: '' },
      cost: 0,
      max_direct_loss: 0,
      max_contingent_liability: 0,
      what_it_forecloses:
        `You owe ${String(owed.electiveMinor)} on ${owed.venture} that the engine will NOT take from you — ` +
        'the escrowed half executes itself, this half is yours to pay or keep. Saying so here costs no ' +
        'action and binds nothing: the channel is private to the parties while the deal runs and becomes ' +
        'PUBLIC at settlement, printed beside what you actually did. An assurance you kept is the ' +
        'strongest evidence you are worth dealing with. One you broke is the most damaging sentence in ' +
        'this game, and it is damaging in your own words rather than ours. Put your own text in "text" — ' +
        'the empty string here is a placeholder, not a message.',
      expires_tick: tick + QUOTE_PIN_TICKS,
      quote_id: quoteId(principal, tick, 'message', { venture: owed.venture }),
    });
  }

  // 4. Fill an open role you are eligible for — and *close* it.
  //
  //    ══════════════════════════════════════════════════════════════════════
  //    **A FILL IS NOT A DEAL, AND THIS STRING IS WHERE A FILLER LEARNS THAT.**
  //
  //    Gate 3's headline number was unreadable because ~46 ventures died on a missing
  //    countersignature rather than on price. `fill_role` is a request allocated at tick
  //    close, and the venture stays FORMING until every party has signed the same
  //    `terms_hash` — so the act an agent must send *next* is the whole game, and it is
  //    named here with both literal values, because the board row now carries them.
  //
  //    **Two omissions are counted rather than hidden.** `hands.find(...)` offered the
  //    first idle hand and stopped — one act per row, `break` when there was none, and
  //    `header.withheld` reading `count: 0` with "nothing was withheld: this is every
  //    legal act". Neither claim was true: any of the principal's other idle hands fills
  //    the same slot (two probes verified it by hand), and a row with no free hand is an
  //    eligible slot silently dropped. `agent.md` §6 names this exact case as a
  //    must-report, and PROP-O1 forbids the silent drop.
  //
  //    **AND THE HAND HAS TO BE WHERE THE VENTURE IS.** This is the one that cost the most
  //    at Gate 3, because it is silent: `Runtime.vFillRole` refuses a fill whose hand does
  //    not `occupiesSystem(venture.stage)` — a rule `src/observe/catalogue.ts` and `move`'s
  //    own `what_it_forecloses` both already state — and this list offered `hands[0]`
  //    whatever system it was standing in. A principal seated at `sys-02` was handed a
  //    copyable `fill_role` for a venture staged at `sys-01`, and the refusal arrives a
  //    tick later from VALIDATE+LOCK, after the action is spent. Home systems differ per
  //    principal, so whether an agent could play at all depended on where it woke up.
  //
  //    `isPresent` joins the filter for the same reason: a hand that arrived this tick is
  //    `IDLE` and **not present**, `fillRole` refuses it by name (INV-9), and offering it
  //    is the server telling an agent to do something and then declining (AGT-S2).
  //    `occupiesSystem` rather than a `location` comparison written here, because that is
  //    the world module's own predicate and it is false for a hand on a lane — the same
  //    call the runtime makes, so the two cannot drift.
  //    ══════════════════════════════════════════════════════════════════════
  const idleHands = hands
    .filter((h) => h.state === 'IDLE' && isPresent(h, tick))
    .sort((a, b) => cmp(a.id, b.id));
  let rowsWithNoHand = 0;
  let rowsOutOfReach = 0;
  let alternateHands = 0;
  let firstFill = true;
  const unreachedStages = new Set<SystemId>();
  for (const row of board) {
    const atStage = idleHands.filter((h) => occupiesSystem(h, row.stage));
    const idle = atStage[0];
    if (idle === undefined) {
      if (idleHands.length === 0) rowsWithNoHand += 1;
      else {
        rowsOutOfReach += 1;
        unreachedStages.add(row.stage);
      }
      continue;
    }
    // Every other present idle hand *at this stage* is an equally legal fill of this slot.
    alternateHands += atStage.length - 1;
    // ── The worked example is spelled out ONCE, and the rest of the list is short ──
    //
    // The closing sequence is a rule about `sign`, not a fact about this slot, and up to
    // `MAX_LIST_ROWS` fill affordances repeating a 600-character worked example would add
    // ~14 KB of identical prose to a payload an agent pays to read (A4, §17). So the
    // highest-priority slot — the board is sorted reachable-first, so it is the one most
    // worth taking — carries the copyable body, and the rest name the two fields on their
    // own board row. Nothing is withheld by this: every value either form refers to is in
    // the same payload.
    const first = firstFill;
    firstFill = false;
    // `createVenture` always hashes its terms, so the null branch is unreachable in this
    // build — but a half-written JSON snippet is worse than a sentence, so it says nothing
    // it cannot back up rather than emitting `terms_hash: null` for an agent to copy.
    const close =
      row.terms_hash === null
        ? `${row.venture} publishes no terms_hash yet, so read ventures.mine[] after the fill lands and sign ` +
          'the hash it carries.'
        : first
          ? `So send {"verb":"sign","params":{"venture":"${row.venture}","terms_hash":"${row.terms_hash}",` +
            `"your_take_at_p50":${String(row.your_take_at_p50)}}} on the NEXT tick — the next tick, because the ` +
            'echo is checked against what you are owed and you are owed nothing until the fill lands. This ' +
            'costs no wake: POST /act is not wake-gated.'
          : 'Closing it needs a sign on the NEXT tick with this row’s own terms_hash and your_take_at_p50 — ' +
            'the first fill_role affordance spells the body out.';
    // ── WHAT THIS SLOT IS OFFERING YOU, IN THE ONE SENTENCE YOU READ BEFORE COMMITTING ──
    //
    // The proportion, both amounts, and **who** is on the hook for the unsecured part. Since `create`
    // took `elective_bps`, two slots that pay the same total can be very different deals — and the
    // filler is the party bearing that difference. `max_direct_loss` on a fill is 0 **because the
    // quoted `stake` is 0**, which a probe correctly read as *"filling costs nothing"*; what it costs
    // is the elective part never arriving, and that is not a loss the engine can price, so it has to
    // be a sentence.
    //
    // ── ★ AND THE STAKE, BECAUSE IT IS A PARAMETER WITH A PERMANENT LOSS IN IT ──
    //
    // `RULES_VERSION` 16 made `stake` real: §7.3 escrows it at fill time and forfeits it to the other
    // parties on `withdraw`. The quote stays **0** — the published worst case has to be the worst case
    // of the act as quoted, and a stake the agent never chose would be a loss it never agreed to — but
    // an agent that is never told the knob exists cannot use it, which is this project's defining
    // defect one layer up from the engine. So the sentence names the parameter, the contest rule it
    // decides, and the one way it is lost.
    const stakeNote =
      'You may add "stake": <minor> to outbid a rival for this slot: a contest is resolved by the ' +
      "creator's stated preference first and by the LARGER STAKE second, never by who asked first. A " +
      'stake is escrowed the moment the role is filled, shows up in obligations.exposure.mine, and is ' +
      'FORFEIT to the other parties if you withdraw (§7.3) — it is returned untouched if the window ' +
      'closes unfilled or the creator abandons. It cannot exceed your free balance. Two of the four ' +
      'Levy allocation rules are computed from your EXPOSURE, so a stake is also a position in your ' +
      "constellation's next vote — and it is the HIGHEST EXPOSURE you reach in a Reckoning that is " +
      'billed, not the figure at settlement, so releasing the stake later does not undo the position. ' +
      'Read levy.exposure_peak_this_cycle.';
    // ── ★ AND WHETHER THIS SLOT CAN MOVE YOUR STANDING AT ALL ─────────────────
    //
    // ══════════════════════════════════════════════════════════════════════════
    // **SELF-DEALING IS GUARDED THREE DEEP AND ANNOUNCED NOWHERE.** A probe noticed it could fill
    // roles in a venture it had created and reasonably asked whether that farms standing. It
    // cannot: `payElectiveParts` refuses to emit the credit, `checkSettlementExact` flags one that
    // reaches it, and `reckoning/standing.ts` **halts the Reckoning** rather than write the row
    // (§6.4, scar #9 — ~17 duplicate pacts once took a reputation from 50 to 100).
    //
    // The guard is right. The silence is the defect: an agent either burns actions discovering it,
    // or — far worse — believes the exploit works and plans around it. A2 says known arithmetic is
    // exact and machine-readable, and "this act scores zero" is arithmetic.
    //
    // It says what the fill IS worth too, because the honest answer is not "don't": a filled role
    // raises the venture's own output (`computeOutputBps` counts the index, not the holder), so
    // self-filling is a real way to stop a slot going empty. What it never does is buy trust.
    // ══════════════════════════════════════════════════════════════════════════
    const selfDealt =
      row.creator === principal
        ? ` YOU CREATED ${row.venture}, so filling this role earns you ZERO STANDING and can record no ` +
          'default against you either — §6.4 accrues standing only to the elective part honoured across ' +
          'DISTINCT, independently-capitalised counterparties, and paying yourself is not a promise ' +
          '(scar #9). The elective figure above never moves: it is booked as paid because the money is ' +
          'already in the account it is owed to. The fill is still worth making if you want the slot ' +
          'filled — a filled role raises the venture\'s output whoever holds it — but standing is not ' +
          'what you are buying, and no number of these will make you VOUCHED.'
        : '';
    const offer =
      `Of the ${String(row.escrowed + row.elective)} on this slot, ${String(row.escrowed)} is escrowed ` +
      `(${String(row.escrow_ratio_bps)} bps — it executes automatically and nobody can stop it) and ` +
      `${String(row.elective)} is elective (${String(row.elective_bps)} bps — ${row.creator} chooses at ` +
      `the Reckoning whether to pay it, and silence is a default on ITS record, not yours).` +
      selfDealt +
      (row.creator_bound_by_grant === null
        ? ''
        : ` ${row.creator} was bound to this by a delegate under grant ${row.creator_bound_by_grant}, ` +
          'not by its own signature.');
    eligible.push({
      verb: 'fill_role',
      params: { venture: row.venture, role: row.role, hand: idle.id, stake: 0 },
      cost: 1,
      max_direct_loss: 0,
      max_contingent_liability: 0,
      what_it_forecloses: first
        ? `hand ${idle.id} cannot fill another role while it is committed to this one, and you may hold at ` +
          `most one role in ${row.venture}. ${offer} ${stakeNote} FILLING IS NOT CLOSING: the fill is ` +
          `allocated at tick close and the venture stays FORMING until every party has countersigned the ` +
          `same terms_hash. ${close} Unsigned by tick ${String(row.expires_tick)} and the window closes, ` +
          'the venture retires ABANDONED, and nothing you spent comes back.'
        : `hand ${idle.id} is committed until this resolves, and you may hold at most one role in ` +
          `${row.venture}. ${offer} ${close} Unsigned by tick ${String(row.expires_tick)}: retired ABANDONED.`,
      expires_tick: row.expires_tick,
      quote_id: quoteId(principal, tick, 'fill_role', { venture: row.venture, role: row.role }),
    });
  }

  // 5. Create a venture, for each kind the stores can actually fund. Affordability
  //    is part of *eligibility*, so an affordance is never an offer you cannot take.
  //
  //    ══════════════════════════════════════════════════════════════════════
  //    **THE PROPORTION IS ON THE OFFER, BECAUSE A KNOB NOBODY IS SHOWN IS NOT A KNOB.**
  //
  //    `create` takes `elective_bps` — how much of every role stays a promise instead of being
  //    locked — inside a band the kind publishes. It is in `params` at the default rather than
  //    omitted, because an agent plays from this list: a parameter that exists and never appears in
  //    a copyable request is the defect that hid nine mechanics including the core loop, and a probe
  //    that *guessed* this exact spelling had it silently dropped.
  //
  //    The two `max_*` figures quote the DEFAULT proportion, and the string says so and names the
  //    band. They have to: `max_direct_loss` is *exact, never an estimate* (A2), and raising
  //    `elective_bps` moves value from the direct column to the contingent one — so a single pair of
  //    numbers covering the whole band would be wrong at every point in it except one.
  //    ══════════════════════════════════════════════════════════════════════
  let firstCreate = true;
  for (const kind of OFFERED_KINDS) {
    const seat = hands[0]?.location;
    if (seat === undefined) continue;
    const probe = probeEscrow(kind);
    if (probe > free) continue;
    const roleRule = firstCreate
      ? ` ${CREATE_ROLE_RULE}`
      : ' The rule about that count is on the first create affordance.';
    firstCreate = false;
    const low = minElectiveBps(kind);
    const high = maxElectiveBps(kind);
    const band =
      low === high
        ? `${kind} is legally un-escrowable, so all ${String(BPS_ONE)} bps of it is elective and ` +
          'elective_bps cannot be moved: nothing about it is secured, and the whole of it is a promise ' +
          'you are asked for at the Reckoning.'
        : `elective_bps is yours to set anywhere in ${String(low)}..${String(high)} and these two ` +
          `figures quote ${String(low)}. Raise it and you lock less now and promise more later — ` +
          'every filler reads it on its own board row before it commits a hand, and weighs it against ' +
          'your public record.';
    eligible.push({
      verb: 'create',
      params: { kind, stage: seat, elective_bps: low },
      cost: 1,
      max_direct_loss: probe,
      max_contingent_liability: probeElective(kind),
      what_it_forecloses:
        `${String(probe)} of your stores is locked in escrow until this settles or is abandoned, and ` +
        `${String(probeElective(kind))} stays elective — you are asked for it at the Reckoning and ` +
        `staying silent is a permanent public default. ${probeRoles(kind)}${roleRule} ${band} ` +
        countersignWarning(tick),
      expires_tick: tick + QUOTE_PIN_TICKS,
      quote_id: quoteId(principal, tick, 'create', { kind, stage: seat }),
    });
  }

  // 5b. **Leave the Commons.** The one affordance on this list that cannot be undone.
  //
  //     ══════════════════════════════════════════════════════════════════════
  //     **THE CHOICE HAS TO BE OFFERED AND PRICED, OR THE GAME HAS NO RISK IN IT.**
  //
  //     A live playtest found that no principal could reach the Marches at all, so
  //     predation could never touch a player and there was no risk/reward decision
  //     anywhere in the world. The verb alone does not fix that: an agent plays from
  //     `affordances[]`, and a crossing that is legal but never offered is a crossing
  //     that never happens.
  //
  //     It sits above `move` because it is strictly more consequential than any lane hop
  //     and because the affordance list is capped — a routine hop crowding out the exit
  //     would reproduce the bug one layer up. It sits below the raid answers and the
  //     signature deadlines because those have clocks and this one does not.
  //
  //     **Offered only when it can actually be taken**, exactly like `create`: eligibility
  //     is affordability in this file, and an offer the engine would refuse costs the
  //     agent a real action (AGT-S2). When the price is short, the count and the reason
  //     go to `withheld`, and `holding.graduation` carries the two figures regardless — so
  //     the choice is legible even in the observation that cannot yet offer it.
  //     ══════════════════════════════════════════════════════════════════════
  const crossing = runtime.graduationQuote(principal);
  if (crossing !== null && crossing.affordable && crossing.anchoring.length === 0) {
    for (const destination of crossing.open) {
      eligible.push({
        verb: 'graduate',
        params: { to: destination },
        cost: 1,
        // Exact and charged the instant it lands: the currency half of §6.3's upkeep.
        max_direct_loss: crossing.upkeepMinor,
        // In UNITS OF `upkeep_good`, not currency, and the sentence below says so —
        // the same convention `yield` uses, because what a raid can take is goods.
        // This is everything that travels with the body and is assailable at the far
        // end from the tick it lands.
        max_contingent_liability: crossing.travellingQty,
        what_it_forecloses:
          `THIS IS ONE-WAY AND IT ENDS A8 FOR YOU. Your holding moves from ${crossing.from} ` +
          `(${crossing.fromTier}) to ${destination} (${tierOf(world.map, destination)}), and \`graduate\` ` +
          'never accepts a COMMONS destination — there is no verb in this build that moves a holding back ' +
          `in. It costs ${String(crossing.upkeepMinor)} of your stores (max_direct_loss, currency, retired ` +
          `to upkeep) plus ${String(crossing.upkeepQty)} units of ${crossing.good} standing at ` +
          `${crossing.from}, both charged the moment it lands. ${String(crossing.travellingQty)} units of ` +
          `${crossing.good} travel with your body (max_contingent_liability, in UNITS not currency) and can ` +
          `be raided at ${destination} from that tick` +
          `${crossing.pledgedQty > 0 ? `; ${String(crossing.pledgedQty)} pledged units stay at ${crossing.from}, because a pledged lot cannot be sent away` : ''}. ` +
          'In exchange your hands stop being Commons-bound and can go anywhere. World raids aim at the ' +
          'principal with the most goods standing outside the Commons — read header.raid_schedule before ' +
          'you go. This crossing is a one-off charge; territory taken out there carries a RECURRING Charge ' +
          'every Reckoning, and obligations.charge is where it appears.',
        expires_tick: tick + QUOTE_PIN_TICKS,
        quote_id: quoteId(principal, tick, 'graduate', { to: destination }),
      });
    }
  }
  // 5b-bis. **Raise a WORKS.** The only reason goods enter the world, so it is offered
  //         wherever the body stands and priced with the share it would actually get.
  //
  //         ══════════════════════════════════════════════════════════════════════
  //         **OFFERED, BECAUSE A VERB THAT IS LEGAL AND NEVER OFFERED IS A VERB THAT
  //         NEVER HAPPENS.** That sentence is not a guess: a live playtest found no
  //         principal could reach the Marches, because `graduate` existed and was not on
  //         this list. The economy's only faucet reaching the same fate would be worse —
  //         the world would run down to zero goods with the fix sitting in the engine.
  //
  //         The quote divides by `occupants + 1`, so the number an agent reads is what it
  //         would get AFTER arriving. Quoting the empty-system rate would overstate the
  //         return of every build into a crowded place, which is the one number that
  //         decides whether the build pays for itself (A2).
  //         ══════════════════════════════════════════════════════════════════════
  // 5E. **THE PRODUCTION CHAIN'S SECOND HALF.** A WORKS yields raw `ore` and every obligation in the
  //     game is payable in `ration`, so a principal sitting on ore has income it cannot spend. `refine`
  //     was a canon verb with no implementation and no menu entry; shipping the verb without the entry
  //     would repeat the defect that hid nine mechanics including the core loop.
  //
  //     Gated on `refinableAt`, the SAME accessor the verb and the cast read, so the menu can never
  //     offer a batch the engine refuses (AGT-S2: an affordance the engine declines costs an agent a
  //     real action every wake).
  const refinable = runtime.refinableAt(principal, holdingOf(world, principal).system);
  if (refinable >= REFINE_IN_QTY) {
    const batches = Math.trunc(refinable / REFINE_IN_QTY);
    const out = batches * REFINE_OUT_QTY;
    eligible.push({
      verb: 'refine',
      params: { system: holdingOf(world, principal).system },
      cost: 1,
      // Nothing is at risk: goods of one kind become goods of another in your own stores. The only
      // loss available here is the action itself.
      max_direct_loss: 0,
      max_contingent_liability: 0,
      what_it_forecloses:
        `turns ${String(refinable)} ${WORKS_YIELD_GOOD} standing at ` +
        `${holdingOf(world, principal).system} into ${String(out)} ${WORKS_GOOD}, in one action, all ` +
        `whole batches at once. **This is the only way raw yield becomes payable**: a WORKS extracts ` +
        `${WORKS_YIELD_GOOD}, and the Levy, a sovereignty Charge and a WORKS build are every one of ` +
        `them payable in ${WORKS_GOOD}. Ore in your stores settles nothing. The recipe is ` +
        `${String(REFINE_IN_QTY)}:${String(REFINE_OUT_QTY)} and the output appears where the ore ` +
        `stood, not at your seat — so refine where you extract, or haul first. Encumbered lots are ` +
        `skipped rather than refused.`,
      expires_tick: tick + 1,
      quote_id: quoteId(principal, tick, 'refine', { system: holdingOf(world, principal).system }),
    });
  }

  // 5F. **THE FORK, AND IT IS A SEPARATE ROW BECAUSE IT IS A SEPARATE DECISION.**
  //
  //     `refine {kind:"ALLOY"}` competes with 5E for the *same lot*, so folding it into that entry
  //     would hide the one choice §10.1 asked the economy to produce: this ore is either tonight's
  //     tribute or ground you keep. Two rows, both priced, and `params.kind` distinguishes them —
  //     the same discipline `build`'s three kinds already follow, and `agent.md` warns in as many
  //     words not to match on the verb alone.
  //
  //     Offered only at a COMMONS system, because that is the whole mechanic. An entry the engine
  //     would refuse costs an agent a real action every wake (AGT-S2), and offering this in the
  //     Marches would do it every wake forever, since no amount of ore there ever satisfies it.
  const hereTier = tierOf(world.map, holdingOf(world, principal).system);
  const alloyIn = ALLOY_IN_BY_TIER[hereTier];
  if (refinable >= alloyIn) {
    const here = holdingOf(world, principal).system;
    const batches = Math.trunc(refinable / alloyIn);
    const out = batches * ALLOY_OUT_QTY;
    eligible.push({
      verb: 'refine',
      params: { kind: 'ALLOY', system: here, qty: out },
      cost: 1,
      // No value leaves the principal: goods of one kind become goods of another in its own stores.
      // The real cost is an OPPORTUNITY — the ore is gone from the ration recipe — and that is stated
      // in the prose rather than dressed up as a loss, because `max_direct_loss` is a number a
      // counterparty relies on and inflating it would make every other row's figure less trustworthy.
      max_direct_loss: 0,
      max_contingent_liability: 0,
      what_it_forecloses:
        `turns ${String(batches * alloyIn)} ${WORKS_YIELD_GOOD} standing at ${here} into ` +
        `${String(out)} ${ALLOY_GOOD}, at ${String(alloyIn)}:${String(ALLOY_OUT_QTY)} — the rate ` +
        `for a ${hereTier} system (${tierRates()}). ` +
        `**THE SAME ORE CANNOT ALSO BECOME ${String(WORKS_GOOD).toUpperCase()}** — check what your ` +
        `Levy needs before you spend it, because ${ALLOY_GOOD} pays no obligation of any kind. ` +
        `What it buys is ground, and nothing else: an ANCHOR costs ${String(ALLOY_ANCHOR_QTY)} of it, ` +
        `and every system a claim can exist on is outside the Commons. ` +
        `${
          hereTier === ALLOY_TIER
            ? 'You are on the cheapest ground in the galaxy for this, and every claim in the game is ' +
              'somewhere that pays more — what you make here is worth more to somebody out there.'
            : `A ${ALLOY_TIER} system makes the same unit for ${String(ALLOY_IN_BY_TIER[ALLOY_TIER])} ` +
              `${WORKS_YIELD_GOOD}, so buying it there and hauling it home is often cheaper than ` +
              'refining it here. This is the price of making it yourself.'
        } ` +
        `Sell it with \`trade\`; move it with \`haul\`.`,
      expires_tick: tick + 1,
      quote_id: quoteId(principal, tick, 'refine', { kind: 'ALLOY', system: here }),
    });
  }

  // 5G. **`haul` — THE ONLY VERB THAT MOVES A GOOD, AND IT WAS NOT LIVE UNTIL NOW.**
  //
  //     AGT-R5 exists because of exactly this: *"a mechanic that works, is tested, renders, and
  //     cannot be reached from the menu an agent is told to plan from."* Nine mechanics including the
  //     A6 core loop hid behind that gap. So the verb and its row land together.
  //
  //     One row per (hand, good) that could actually move something, and the destinations are on the
  //     row rather than in it: `params` names one lane so the offer is submittable as-is, and
  //     `what_it_forecloses` lists the rest. `haulQuotes` has already dropped every hand the verb
  //     would refuse — not present, nothing standing here, Commons-bound with no legal exit — so the
  //     menu cannot offer a trip the engine declines.
  for (const good of HAULABLE_GOODS) {
    for (const quote of runtime.haulQuotesFor(principal, good, tick)) {
      const to = quote.open[0];
      if (to === undefined) continue;
      eligible.push({
        verb: 'haul',
        params: { hand: quote.hand, to, good, qty: quote.carryable },
        cost: 1,
        // ── THE CARGO IS THE `max_direct_loss`, AND IT IS NOT ZERO ──────────────
        //
        // A convoy can be routed. §10.1 #3 makes raids destroy or relocate cargo and `routHand` now
        // retires what a lost hand was carrying, so the goods on this trip are genuinely at risk in a
        // way the same goods standing in a hold are not. Quoting 0 here would be the affordance
        // promising safety the rules do not give — the exact shape of the Levy defect a blind probe
        // reported as "a 500-unit Levy destroyed 45,000 units" on an affordance that said 500.
        max_direct_loss: quote.carryable,
        max_contingent_liability: 0,
        what_it_forecloses:
          `loads ${String(quote.carryable)} ${good} from ${quote.from} onto ${quote.hand} and sends ` +
          `it to ${to}. Goods are LOCATED (§10.2) and this is the only verb that moves them — a ` +
          `market fill leaves the cargo at the venue it traded at, and an ANCHOR is paid in goods ` +
          `already standing at the system it claims. The hand is unavailable until it arrives and ` +
          `the cargo is unavailable with it; if the hand is routed on the way, the cargo is ` +
          `DESTROYED. One lane per action${quote.open.length > 1 ? `; also open from here: ${quote.open.slice(1).join(' · ')}` : ''}. ` +
          `You hold ${String(quote.availableHere)} unpledged ${good} at ${quote.from}` +
          `${quote.availableHere > quote.carryable ? `, and one trip carries at most ${String(MAX_HAUL_QTY)}` : ''}.`,
        expires_tick: tick + 1,
        quote_id: quoteId(principal, tick, 'haul', { hand: quote.hand, good, to }),
      });
    }
  }

  const worksSeat = runtime.graduationQuote(principal);
  const worksHere = worksSeat === null ? null : runtime.worksQuote(principal, worksSeat.from);
  if (worksHere !== null && worksHere.affordable && !worksHere.alreadyHeld) {
    eligible.push({
      verb: 'build',
      params: { kind: 'WORKS', system: worksHere.system },
      cost: 1,
      // Both halves are charged the instant it lands, and both are gone: the currency is
      // retired and the goods are destroyed into the build.
      //
      // `totalMinor`, not `costMinor` — on the currency door the goods half is retired too, so a
      // `max_direct_loss` of 60,000 beside an 85,000 charge would understate EXPOSURE (§3: "Σ of
      // your open `max_direct_loss`, and nothing else") by the whole of what is new. And the goods
      // liability is ZERO on that route, because no goods are destroyed: quoting 5,000 units an
      // agent does not hold and will not spend is the shape of lie this file keeps finding.
      max_direct_loss: worksHere.totalMinor,
      max_contingent_liability: worksHere.payingGoodsInCurrency ? 0 : worksHere.costQty,
      what_it_forecloses:
        `A WORKS extracts what a PLACE yields, and ${worksHere.system} (${worksHere.tier}) yields ` +
        `${String(worksHere.yieldPerTick)} units of ${worksHere.good} a tick divided among every WORKS ` +
        `standing on it. ${String(worksHere.occupants)} stand there now, so yours would KEEP about ` +
        `${String(worksHere.sharePerTick)} a tick — and that share FALLS as others arrive. ` +
        // ── WHO TAKES A CUT, BY NAME ──────────────────────────────────────────
        //
        // The number above is the NET and was corrected to be, but the string still named neither the
        // landlord nor the rate — so the deduction was visible only as a figure that came out lower
        // than `yield / occupants`, which is exactly the arithmetic `agent.md` tells an agent not to
        // do. A2: known arithmetic is exact, and both figures either side of a subtraction are part
        // of it. The landlord is NAMED because it is a principal an agent can `message`, buy the
        // ground from, out-bid or displace — a deduction with nobody attached is a tax, and there are
        // no taxes in this game, only counterparties.
        (worksHere.rentTo === null
          ? `No claim stands on ${worksHere.system} today, so nothing is deducted and that figure is ` +
            `the whole of your share. A claim raised here later would take its published share of ` +
            `everything you extract, and a sitting tenant cannot refuse it. `
          : `${worksHere.rentTo} HOLDS THE CLAIM HERE and is your landlord: the place would hand ` +
            `yours ${String(worksHere.grossPerTick)} a tick and ${String(worksHere.rentPerTick)} of ` +
            `that — ${String(worksHere.rentBps / 100)}% — goes to ${worksHere.rentTo} in raw ` +
            `${worksHere.good}, which is why the figure above is ${String(worksHere.sharePerTick)} ` +
            `and not ${String(worksHere.grossPerTick)}. That rate was fixed when the claim was raised ` +
            `and a takeover cannot raise it on you; the only way to keep the whole share is to hold ` +
            `the ground yourself, because a claimant never pays itself rent. `) +
        // ── THE FUEL, WHICH IS THE ONLY REASON TO PREFER THE FRONTIER ─────────
        //
        // `fuel` is yielded ONLY at a FRONTIER system and it is the one good some agents need and
        // cannot make: a frontier landlord's anchor burns it every Reckoning or collects nothing, and
        // no verb moves goods between systems. So a frontier WORKS is a seat on the only side of that
        // trade — and the affordance that named the ore and not the fuel understated frontier ground
        // by the whole of what is new about it. Zero elsewhere, and said so rather than omitted:
        // "this place makes none" is the fact that sends an agent to `graduate`.
        (worksHere.fuelSharePerTick > 0
          ? `It would ALSO take about ${String(worksHere.fuelSharePerTick)} units of ` +
            `${worksHere.fuelGood} a tick, of the ${String(worksHere.fuelYieldPerTick)} this place ` +
            `yields. ${worksHere.fuelGood} is made ONLY by a WORKS at a FRONTIER system, it refines ` +
            `into nothing and pays no obligation of yours — its one use is that every FRONTIER claim ` +
            `burns it each Reckoning to keep collecting rent, and no verb in this build moves goods ` +
            `between systems. So this makes you one of the few sellers of what every frontier ` +
            `landlord must buy. `
          : `It yields no ${worksHere.fuelGood} — only a FRONTIER system makes that, and it is the ` +
            `one good some agents need and cannot make. `) +
        `It costs ` +
        `${String(worksHere.costMinor)} of your unlocked balance (pledged stores do not count toward ` +
        `it; your starter stake does, because the money is destroyed rather than paid to anyone) plus ` +
        // ── THE COST GOOD IS NOT THE YIELD GOOD, AND THIS SENTENCE SAID IT WAS ──
        //
        // `WORKS_GOOD`, not `worksHere.good`. This read "plus 5000 units of ORE standing here" while a
        // build consumes `ration` — found by a probe playing the live world on 2026-07-27, on the same
        // sentence and for the same reason `worksQuote.good` was corrected the day before: ONE field
        // was being used for two goods that had only ever been equal by accident.
        //
        // What it cost an agent: `works.here.available_qty` counts `ration` and the affordance named
        // `ore`, so a newcomer holding 50,000 ration and no ore reads `affordable: true` beside a
        // price it appears not to hold, and an agent that believes the sentence hoards the wrong good
        // — while `refine` runs the other way (ore INTO ration), so hoarding ore to fund a build is
        // exactly backwards. Scar #1: two surfaces, one word, each coherent alone.
        `${String(worksHere.costQty)} units of ${WORKS_GOOD} standing here, destroyed into the build. ` +
        // ── AND WHICH OF THE TWO PRICES *THIS* BUILD WOULD ACTUALLY TAKE ────────
        //
        // `WORKS_GOODS_IN_CURRENCY_MINOR` carries the finding: the goods half of the one door into the
        // economy was denominated in the good the door is the only source of, so a principal drained by
        // four Reckonings of tribute was locked out permanently — with a quarter of a million in
        // currency in hand. The substitute is the way back, and an affordance that named only the goods
        // price would leave the way back invisible to the exact agent it was built for.
        //
        // Stated in BOTH directions rather than only when it fires: a principal paying in goods is told
        // the door exists and closes, because "you had a cheaper option once" is not a thing to find out
        // afterwards.
        (worksHere.payingGoodsInCurrency
          ? `YOU DO NOT HOLD THOSE GOODS, AND THIS BUILD DOES NOT NEED THEM: your FIRST WORKS may pay ` +
            `that half in currency instead — ${String(worksHere.goodsInCurrencyMinor)} more, retired to ` +
            `nobody, so ${String(worksHere.totalMinor)} in all and no ${WORKS_GOOD} at any point. That ` +
            `exists because the Levy destroys ${WORKS_GOOD} every Reckoning and your endowment is ` +
            `never repeated, so without it a principal that paid its tribute honestly for four ` +
            `Reckonings could never enter the economy again. It costs more than the goods are worth on ` +
            `purpose, and it CLOSES the moment you hold a WORKS — after that this half is payable only ` +
            `out of what you produce. `
          : worksHere.firstWorks
            ? `You hold those goods, so they are what this build takes — that is the cheaper half. Had ` +
              `you not, your FIRST WORKS could have paid it in currency instead ` +
              `(${String(worksHere.goodsInCurrencyMinor)}, retired), and that door closes the moment you ` +
              `hold a WORKS. `
            : '') +
        `It extracts nothing for ${String(worksHere.spinupTicks)} ticks, so a WORKS raised just before a ` +
        'Reckoning does not help you pay it, and one raised where a raid is coming may never pay for ' +
        'itself. This is the only way goods enter the world: everything you owe consumes them. ' +
        // ── THE PAYBACK, BECAUSE COST WITHOUT RETURN IS HALF A QUOTE ──────────
        //
        // This string stated the cost and the spin-up and never what it EARNS, so an agent could only
        // choose it by doing the arithmetic itself. Measured on 2026-07-26: `build {WORKS}` is offered
        // whenever it is affordable — 70 of 70 — and NEITHER CAST HAS EVER BUILT ONE. The heuristic
        // has no branch for it; the LLM cast, which chooses freely, spent 900 ticks on ventures and
        // never once on the faucet, and production ran eight Reckonings at `works: 0` while
        // `levyShort` climbed past 345,000.
        //
        // The hypothesis (D17) is that a capital investment loses an action-budget contest against
        // immediate income: a `create` pays at the next settlement, a WORKS pays nothing for 24 ticks.
        // If that is right, the first fix is not a mechanic but the number — an agent cannot weigh a
        // return it has to derive.
        //
        // Both figures are PHASE-FREE on purpose. "How much by this Reckoning's end" depends on where
        // in the cycle you are, and a quote whose meaning shifts with the phase is a quote an agent
        // has to re-derive every wake. Ticks-to-repay and per-Reckoning steady state are true whenever
        // they are read.
        (worksHere.sharePerTick <= 0
          ? 'At this crowding it would extract nothing, so there is no payback to quote.'
          : // ── AND THE PAYBACK CROSSES TWO GOODS, SO IT NAMES THE CONVERSION ─────
            //
            // The return is in `WORKS_YIELD_GOOD` and the cost is in `WORKS_GOOD`, so "repays the
            // 5,000 units" was dividing one good by another and printing the answer as a number of
            // ticks. It happens to be right at today's 1:1 recipe and would go silently wrong the
            // moment `refine` stopped being lossless — so the ratio is IN the arithmetic and named in
            // the sentence, rather than assumed by both.
            `WHAT IT RETURNS: about ${String(worksHere.sharePerTick * TICKS_PER_RECKONING)} units of ` +
            `${worksHere.good} every Reckoning once online, and \`refine\` turns ` +
            `${String(REFINE_IN_QTY)} ${worksHere.good} into ${String(REFINE_OUT_QTY)} ${WORKS_GOOD} — ` +
            `so it repays the ${String(worksHere.costQty)} units of ${WORKS_GOOD} destroyed into the ` +
            `build in about ` +
            `${String(
              Math.ceil((worksHere.costQty * REFINE_IN_QTY) / REFINE_OUT_QTY / worksHere.sharePerTick) +
                worksHere.spinupTicks,
            )} ` +
            `ticks. Compare that with what one venture pays you at the next settlement: the venture ` +
            `pays sooner and the WORKS pays forever, and nothing else in this game makes goods at all.`),
      expires_tick: tick + QUOTE_PIN_TICKS,
      quote_id: quoteId(principal, tick, 'build', { kind: 'WORKS', system: worksHere.system }),
    });
  }
  const worksWithheld =
    worksHere !== null && !worksHere.affordable && !worksHere.alreadyHeld ? 1 : 0;

  const crossingWithheld =
    crossing !== null && !crossing.affordable && crossing.anchoring.length === 0 ? crossing.open.length : 0;
  // Counted separately from the price, because the fix is a different act. Silently
  // dropping it would read as "the exit vanished" — the shape of the defect a playtest
  // already found once, and the reason every omission in this file carries a reason.
  const crossingAnchored =
    crossing !== null && crossing.anchoring.length > 0 ? crossing.open.length : 0;

  // 5c. **Rescue, or take.** A claim of somebody else's that is for sale, or contestable
  //     inside the published window. Both are `build`, and the row says which.
  //
  //     ══════════════════════════════════════════════════════════════════════
  //     **RANKED HERE AND NOT AT THE TOP, AND THE MEASUREMENT IS WHY.** It has a clock —
  //     the vulnerability window closes — but it is an *opportunity*, not an obligation:
  //     nothing happens to this principal if it declines. `graduate`'s note above states
  //     the rule ("below the raid answers and the signature deadlines because those have
  //     clocks and this one does not"), and taking somebody else's territory is the same
  //     kind of act.
  //
  //     Ranking it at the top was measured and was wrong in a way worth recording: the
  //     cast harness picks `affordances[0]` every wake, so with these above `sign` all
  //     twelve members marched out of the Commons and claimed within one Reckoning. The
  //     world then had far more for the heuristic gap-filler to do, and the LLM-deciding
  //     share fell from 3232 bps to 2477 — through the 2500 bps health floor. The
  //     affordance order is a rules surface for exactly this reason: it is what an agent
  //     playing from the list actually does.
  //     ══════════════════════════════════════════════════════════════════════
  // Campaign inputs, read once. Both go through the same predicates the verbs run — see 5e.
  const campaignObjectives = runtime.campaignObjectivesFor(principal, tick);
  for (const claim of runtime.claimsOpenTo(principal, tick)) {
    if (claim.route === null) continue;
    if (claim.available_here < ANCHOR_QTY) continue;
    // ── ★ AND THE MANUFACTURED HALF, WHICH THIS SITE FORGOT ────────────────
    //
    // **Found by a test that copies affordance `params` verbatim, 6 of 6 failing.** This gated on the
    // charge good alone, so the menu offered an anchor to a principal holding zero alloy and
    // `claimRejection` then refused it with A15 — an affordance the engine declines, which costs the
    // agent a real action every wake (AGT-S2) and is the exact defect three blind probes found five of.
    // `graduate` got this right by folding both halves into `affordable`; this site had two halves and
    // checked one.
    if (runtime.alloyAt(principal, claim.system) < ALLOY_ANCHOR_QTY) continue;
    const price = claim.cession?.price ?? 0;
    // `freeCash`, matching `vBuild`'s gate, not the raw free balance: a cession price is the
    // one principal-to-principal transfer in sovereignty, so it is payable out of EARNINGS
    // and never out of the §12.5 endowment (D7 — see the block above `vBuild`'s own `free`).
    // Offering it against the raw balance would offer a purchase the engine refuses, which
    // costs the agent a real action (AGT-S2).
    if (claim.route === 'CESSION' && freeCash(runtime.ledger, principal) < price) continue;
    eligible.push({
      verb: 'build',
      params: { kind: 'ANCHOR', system: claim.system },
      cost: 1,
      max_direct_loss: price,
      // Taking a claim takes on its Charge and its arrears, so the contingent liability is
      // the bond you must have posted plus what the arrears can cost you. Named, because A6's
      // preview rule is that a worst case is shown before it is signed for.
      max_contingent_liability: CLAIM_BOND_MINOR,
      what_it_forecloses:
        `${claim.route === 'CESSION' ? `pays ${String(price)} to ${claim.claimant} and` : 'takes the claim by force of arrival inside the published window and'} ` +
        `destroys ${String(ANCHOR_QTY)} of ${claim.good} AND ${String(ALLOY_ANCHOR_QTY)} of ${ALLOY_GOOD}, ` +
        `both standing at ${claim.system}. You become the claimant of ` +
        `record — AND you inherit its ${String(claim.arrears)} arrears and this Reckoning's ` +
        `${String(claim.owed)} still owed, which a transfer never resets. Your holding must already stand there ` +
        `and you must have ${String(CLAIM_BOND_MINOR)} more bond posted per claim. ` +
        // ══════════════════════════════════════════════════════════════════════
        // ★ **AND WHAT IT EARNS, WHICH THIS SENTENCE NAMED NOTHING OF.** The sweep that followed the
        // graduation defect: does this observation publish the term that dominates the outcome?
        //
        // Every clause above is a COST — the price, the goods, the arrears, the bond, the Charge. The
        // return on a claim is its RENT, and rent is `rent_bps` of everything **somebody else's** WORKS
        // extracts here. So `tenants` is the term that decides whether the act pays at all: a claim
        // over ground nobody else works earns **zero** for a recurring Charge in produced goods, which
        // is strictly negative and reads identically to a good claim in this affordance. `ClaimView`
        // has carried `tenants` and `rent_per_tick` the whole time; this string named neither.
        // ══════════════════════════════════════════════════════════════════════
        `WHAT IT EARNS: rent of ${String(claim.rent_bps)} bps on everything OTHER principals' WORKS ` +
        `extract here, and ${String(claim.tenants)} such WORKS stand there now — worth ` +
        `${String(claim.rent_per_tick)} of ${claim.good} per tick as it stands. A claimant never pays ` +
        `itself rent, so your own WORKS here keeps its whole share instead. **At 0 tenants a claim ` +
        `earns nothing and still owes its Charge every Reckoning**: read that number before the price.`,
      expires_tick: claim.vulnerability.open ? claim.vulnerability.closes_tick : claim.deadline_tick,
      quote_id: quoteId(principal, tick, 'build', { kind: 'ANCHOR', system: claim.system }),
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5e. CAMPAIGNS (§16.6) — declare one, take a side in one, or lift your own.
  //
  //     Ranked here, immediately after the anchor and before `post_bond`, and the position is a
  //     decision rather than an accident. Above it are the acts with a clock somebody else set;
  //     below it are the ones with none. A campaign has a clock — its next PULSE — but the clock is
  //     a whole Reckoning away, so it must never outrank answering a standoff that resolves in 24
  //     ticks. And it must never be FIRST for the reason `OFFERED_KINDS` records about `BUILD`: an
  //     agent that copies its highest affordance verbatim would declare a war as its opening move.
  //
  //     **Every offer here is gated through `runtime.campaignDeclareRefusalFor` / the roster's own
  //     `joinRefusal`** — the same functions the verbs run. AGT-S2 is the reason: an affordance the
  //     engine then refuses costs an agent a real action every wake and, from the agent's side, is
  //     indistinguishable from a counterparty having taken the slot.
  // ══════════════════════════════════════════════════════════════════════════
  for (const objective of campaignObjectives) {
    const claimThere = runtime.sovereignty.liveAt(objective);
    if (claimThere === null) continue;
    eligible.push({
      verb: 'build',
      params: { kind: 'CAMPAIGN', system: objective },
      cost: 1,
      // The bond IS the worst case, exactly: it is what you lose if the campaign fails, and
      // EXPOSURE is Σ open max_direct_loss and nothing else (§3). The materiel is a separate,
      // recurring cost and is named in `what_it_forecloses` rather than folded in here — one number
      // summing capital and goods would name a quantity of nothing in particular.
      max_direct_loss: runtime.campaignBond,
      max_contingent_liability: runtime.campaignBond,
      what_it_forecloses:
        `locks ${String(runtime.campaignBond)} of slashable capital and commits you to spending ` +
        `${String(PULSE_MATERIEL_QTY)} of ${MATERIEL_GOOD} standing at YOUR OWN system, once per ` +
        `Reckoning, against ${claimThere.claimant}'s claim on ${objective} (${claimThere.state}). It is the ` +
        'ONLY way to take a claim from a holder that is paying its Charge. First pulse tick ' +
        `${String(runtime.campaignFirstPulse(tick))} — never this Reckoning, so the defender gets a full ` +
        'cycle of notice. Fail and the whole bond goes to it.',
      // Not the pulse tick: the OFFER expires when the declaration window does, because a
      // declaration made later this cycle still first pulses at the same tick. An `expires_tick` on
      // the pulse would tell an agent it had a Reckoning to decide in when it has until the freeze.
      expires_tick: tick - (tick % TICKS_PER_RECKONING) + LAST_DECLARE_PHASE,
      quote_id: quoteId(principal, tick, 'build', { kind: 'CAMPAIGN', system: objective }),
    });
  }
  for (const campaign of campaignViews) {
    if (campaign.your_side === null) {
      for (const side of ['DEFENDER', 'ATTACKER'] as const) {
        // DEFENDER first, deliberately: the first offer of a verb is what survives truncation and
        // what a blind copier takes, and the free side is the one that cannot cost an agent capital
        // it did not understand it was risking.
        if (runtime.campaignJoinRefusalFor(principal, campaign.campaign, side, tick) !== null) continue;
        const stake = side === 'ATTACKER' ? runtime.campaignAllyStake : 0;
        eligible.push({
          verb: 'join',
          // `system` is REQUIRED even though `vJoinCampaign` never reads it: `join` is classified
          // HOSTILE, and the Commons floor refuses a hostile act that names no locatable place at all
          // (A8 is checked at the door, before any handler). The `fight` affordance carries the same
          // field for the same reason and says so. Found by the reachability test: without it the menu
          // published a join the FLOOR refused, which is AGT-S2 with the refusal coming from a
          // different door than the one the offer was gated on.
          params: { campaign: campaign.campaign, side, system: campaign.objective },
          cost: 1,
          max_direct_loss: stake,
          max_contingent_liability: stake,
          what_it_forecloses:
            side === 'ATTACKER'
              ? `puts ${String(stake)} of slashable capital behind ${campaign.attacker}'s war on ` +
                `${campaign.objective}, forfeit to ${campaign.defender} if the campaign fails. A ` +
                'co-belligerent risks its own stake. Your IDLE hands standing at the objective count for ' +
                'the attacker from the next pulse on — joining commits no hand by itself.'
              : `puts you on ${campaign.defender}'s side at ${campaign.objective} at NO capital cost. Your ` +
                'IDLE hands standing there count for the defence from the next pulse on, and ties go to the ' +
                'defender. It also tags you to that side on the record for this campaign.',
          expires_tick: campaign.next_pulse_tick ?? tick,
          quote_id: quoteId(principal, tick, 'join', { campaign: campaign.campaign, side }),
        });
      }
    }
    if (campaign.your_side === 'ATTACKER' && runtime.campaignLiftRefusalFor(principal, campaign.campaign, tick) === null) {
      eligible.push({
        verb: 'withdraw',
        params: { campaign: campaign.campaign },
        // No `system`: `withdraw` is classified peaceful, and adding a target to a peaceful act would
        // be a field with no meaning on the wire — an agent copying it would learn a rule that is not
        // one.
        cost: 1,
        max_direct_loss: campaign.bond - Math.floor((campaign.bond * CAMPAIGN_SALVAGE_BPS) / 10_000),
        max_contingent_liability: campaign.bond - Math.floor((campaign.bond * CAMPAIGN_SALVAGE_BPS) / 10_000),
        what_it_forecloses:
          `ends your campaign on ${campaign.objective} at ${campaign.legend}. ` +
          `${String(CAMPAIGN_SALVAGE_BPS / 100)}% of the ${String(campaign.bond)} bond returns and the rest ` +
          `goes to ${campaign.defender}. The claim is untouched and nothing you have spent on materiel comes ` +
          'back. This is the cheaper of the two ways to lose.',
        expires_tick: campaign.next_pulse_tick ?? tick,
        quote_id: quoteId(principal, tick, 'withdraw', { campaign: campaign.campaign }),
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5e-bis. **PARLEY — ASK SOMEBODY** (§3, `say/parley.ts`).
  //
  //     ★ The affordance that makes a coalition askable. It sits here, directly under `join`,
  //     because it is the same decision from the other side: `join` is taking a side in somebody's
  //     war and this is asking somebody to take yours. An agent reading its own losing force
  //     reading must find both in one place.
  //
  //     **One row per reachable principal, each naming a REAL id** — never a placeholder and never
  //     an instruction to guess one. A2's whole argument: an affordance is a complete, copyable act,
  //     and `{"to": "<principal>"}` as literal text is a rule the agent cannot follow. This is also
  //     the answer to the probe's `counterparties[]` being empty: these principals are now *named
  //     above*, so `counterpartiesFor` carries their standing line and §12.4's advice — "look at
  //     `counterparties[].last_default` before you trust someone" — becomes applicable to the only
  //     relationship that mattered.
  //
  //     Gated through `runtime.parleyRefusalFor`, the same function `vParley` runs (AGT-S2).
  // ══════════════════════════════════════════════════════════════════════════
  {
    const capacity = runtime.parleysFor(principal, tick);
    const reach = runtime.reachFor(principal, tick);
    // ── BOTH CONJUNCTS, AND THE SECOND WAS MISSING ────────────────────────────
    //
    // The first version branched on capacity alone, so a principal with a full allowance and an
    // EMPTY reach set fell into the offer branch, published nothing (the loop had nothing to
    // iterate) and produced no `withheld` row either. That is `trade`'s defect exactly — silent in
    // 497 of 576 observations with a reachable venue in every one — reintroduced in the block whose
    // own comment cites it. `test/api/withheld-is-accountable.spec.ts` promotes `message` to CLOSED
    // on the strength of this line.
    if (capacity.parleys_remaining > 0 && reach.length > 0) {
      for (const row of reach.slice(0, MAX_PARLEY_AFFORDANCES)) {
        if (runtime.parleyRefusalFor(principal, row.principal, tick) !== null) {
          parleyGated += 1;
          continue;
        }
        eligible.push({
          verb: 'message',
          // `act: "offer"` rather than `assure`: an opening address to a stranger is a proposal, and
          // `assure` is the unsecured promise — the most damaging sentence in the game if broken
          // (§14). A menu must not hand a copier the binding-sounding one by default.
          params: { to: row.principal, act: 'offer', text: '' },
          // FREE, like every other `message`. `FREE_VERBS`' own note: charging for talk starves the
          // receipt reel. The price of a parley is the per-Reckoning allowance and the entitlement,
          // never the action budget — see `parley.ts` §2 for why an action would not be A15-safe
          // anyway (N enrolments buy N budgets).
          cost: 0,
          max_direct_loss: 0,
          // Zero, and it is a fact rather than an omission: a parley moves nothing and binds nothing.
          // What it costs is one of `header.parley.parleys_remaining`, which is denominated in
          // parleys and not in currency, so folding it in here would name a quantity of nothing.
          max_contingent_liability: 0,
          what_it_forecloses:
            `${row.sentence} Spends 1 of your ${String(capacity.parleys_remaining)} remaining parley(s) this ` +
            'Reckoning; unspent ones DO NOT CARRY. It is PARTIES-private to the two of you and becomes PUBLIC ' +
            `at tick ${String(tick + capacity.declassifies_after_ticks)} — to every agent and every viewer at ` +
            'once, printed beside what you both actually did. It binds nothing and moves nothing: what it buys ' +
            'is that somebody who could help you knows you asked, and on what terms. Put your own text in ' +
            '"text" — the empty string here is a placeholder, not a message.',
          expires_tick: tick + QUOTE_PIN_TICKS,
          quote_id: quoteId(principal, tick, 'message', { to: row.principal }),
        });
      }
      parleyReachDropped = Math.max(0, reach.length - MAX_PARLEY_AFFORDANCES);
      parleyReachDroppedNames = reach.slice(MAX_PARLEY_AFFORDANCES).map((r) => String(r.principal));
    } else {
      // ── THE THREE SILENCES, TOLD APART ────────────────────────────────────
      //
      // A menu that simply omits the act leaves an agent unable to distinguish *not entitled*
      // from *spent* from *nobody to talk to* — which is exactly what a probe reported about
      // §9's capacity, in those words. Each carries the sentence that says what would change it.
      parleyWithheldReason = capacity.rule;
      parleyWithheldCount = Math.max(1, reach.length);
    }
  }

  // 5d. **Take a claim where you already stand**, and post the bond that backs it. No
  //     clock at all, so it ranks below everything that has one.
  //
  //     Offered only outside the Commons, because a Commons claim is INVALID rather than
  //     refused (A8) and offering it would be offering a move the floor always rejects — the
  //     same rule that keeps `RAID` out of `OFFERED_KINDS`. This is the affordance that makes
  //     the whole mechanic reachable by an agent that reads nothing else, which is why it
  //     carries both halves of the price and names the recurring one.
  {
    const holding = world.holdingByPrincipal.get(principal) === undefined
      ? null
      : holdingOf(world, principal);
    const bond = runtime.bondView(principal);
    if (holding !== null && tierOf(world.map, holding.system) !== 'COMMONS') {
      const here = runtime.sovereignty.liveAt(holding.system);
      const shortfall = CLAIM_BOND_MINOR + bond.required - bond.posted;
      if (shortfall > 0 && free >= shortfall) {
        eligible.push({
          verb: 'post_bond',
          params: { amount: shortfall },
          cost: 1,
          // A bond is LOCKED, not spent, and it is only lost if a claim of yours lapses. So
          // the direct loss is zero and the contingent liability is the whole amount — which
          // is the honest shape and the reason the two fields exist separately.
          max_direct_loss: 0,
          max_contingent_liability: shortfall,
          what_it_forecloses:
            `locks ${String(shortfall)} of your stores as BOND. It stays yours and stays visible as your credit ` +
            `rating; it is taken only if a claim of yours LAPSES. You have ${String(bond.posted)} posted against ` +
            `${String(bond.required)} required for ${String(bond.claims)} claim(s), and one more claim needs ` +
            `${String(CLAIM_BOND_MINOR)} on top. Locked stores cannot be spent on anything else.`,
          expires_tick: tick + 1,
          quote_id: quoteId(principal, tick, 'post_bond', { amount: shortfall }),
        });
      }
      if (
        here === null &&
        shortfall <= 0 &&
        runtime.chargeGoodAt(principal, holding.system) >= ANCHOR_QTY &&
        // Both halves, for the reason the takeover site one block up now carries in full: an anchor
        // costs a good this seat cannot make, and a menu that quoted only the payable half would send
        // an agent into an A15 refusal with a real action spent.
        runtime.alloyAt(principal, holding.system) >= ALLOY_ANCHOR_QTY
      ) {
        eligible.push({
          verb: 'build',
          params: { kind: 'ANCHOR', system: holding.system },
          cost: 1,
          max_direct_loss: ANCHOR_QTY,
          max_contingent_liability: CLAIM_BOND_MINOR,
          what_it_forecloses:
            `destroys ${String(ANCHOR_QTY)} of ${CHARGE_GOOD} AND ${String(ALLOY_ANCHOR_QTY)} of ` +
            `${ALLOY_GOOD}, both standing at ${holding.system}, and makes you its ` +
            `claimant. The ${ALLOY_GOOD} is the half you cannot make here at the Commons rate — it is ` +
            `refined everywhere but four times dearer outside the Commons, so most claimants buy it and ` +
            `\`haul\` it in. From the next Reckoning onward the claim owes a CHARGE in goods that must be standing ` +
            `THERE, every Reckoning, forever — miss it three times running and the claim lapses and ` +
            `${String(CLAIM_BOND_MINOR)} of your bond is slashed. This is territory you have to MAINTAIN, not ` +
            `territory you buy once.`,
          expires_tick: tick + 1,
          quote_id: quoteId(principal, tick, 'build', { kind: 'ANCHOR', system: holding.system }),
        });
      }
    }
    // The allocation vote. Free, like every other ballot (`tick/budget.ts` lists `vote`), and
    // offered only to a claimant with an open ballot it has not cast.
    const ballot = chargeBallotBlock(runtime, principal, tick);
    if (ballot !== null && ballot['voted'] === false) {
      eligible.push({
        verb: 'vote',
        params: { ballot: CHARGE_BALLOT, rule: PUBLISHED_DEFAULT_CHARGE_RULE },
        cost: 0,
        max_direct_loss: 0,
        max_contingent_liability: 0,
        what_it_forecloses:
          `decides how Reckoning ${String(ballot['for_reckoning'])}'s sovereignty upkeep is SPLIT across your ` +
          `constellation's claims — the total is fixed by rule and cannot be dodged, but who bears which share ` +
          `is this vote. EVEN spreads it per claim, BY_CLAIMS loads it onto whoever holds the most territory, ` +
          `BY_TIER loads it onto the Frontier. Two claimants naming the same \`spare\` relieve it to a nominal ` +
          `share and the rest of you fund the difference. Quorum failure applies ${PUBLISHED_DEFAULT_CHARGE_RULE}.`,
        expires_tick: Number(ballot['closes_tick']),
        quote_id: quoteId(principal, tick, 'vote', { ballot: CHARGE_BALLOT }),
      });
    }
  }

  // 5B. **THE LEVY.** A14 says the Levy is scheduled and cannot be dodged into quiet. It was being
  //     dodged by ignorance: `deliver` against the Levy and `vote` on its ballot both EXECUTE when
  //     called, and neither was ever offered in any observation — measured across 900 ticks and
  //     eight principals, with `withheld` explaining neither. The Charge got affordances when
  //     sovereignty landed and the Levy never did.
  //
  //     Legality is not decided here. `levyDeliveryQuote` calls the same `deliveryFault` the verb
  //     calls, so this list cannot offer an act the engine will refuse — which costs an agent a
  //     real action, exactly as the Charge's own comment says.
  const levyQuote = runtime.levyDeliveryQuote(principal, tick);
  if (levyQuote.fault === null && levyQuote.payable > 0) {
    eligible.push({
      verb: 'deliver',
      params: { obligation: 'LEVY', amount: levyQuote.payable },
      cost: 1,
      max_direct_loss: levyQuote.payable,
      max_contingent_liability: 0,
      // `LEVY_GOOD`, not `CHARGE_GOOD`. Both are `ration` today and this sentence read
      // `CHARGE_GOOD` — the sovereignty constant — inside the Levy's own affordance. Equal by
      // coincidence rather than by rule: `levy/params.ts` and `sovereignty/params.ts` declare
      // them independently *so that a second good is a local edit*, which is the whole point of
      // the separate declarations. The first divergence would have this offer naming the wrong
      // good in the one place an agent is told to copy verbatim, and naming the wrong good in an
      // affordance has already cost this repo two bugs.
      what_it_forecloses:
        `hands ${String(levyQuote.payable)} of ${LEVY_GOOD} to the Levy at ${String(levyQuote.place)}, ` +
        `against ${String(levyQuote.owed)} owed this Reckoning. Goods delivered are GONE — this is upkeep, ` +
        `not an investment, and it buys you no standing. What it avoids is the other branch: an unpaid ` +
        `assessment is recorded as a public shortfall against you at settlement, and a shortfall is ` +
        `permanent. Paying part is legal and is counted; the remainder still falls short.`,
      expires_tick: tick + 1,
      quote_id: quoteId(principal, tick, 'deliver', { obligation: 'LEVY' }),
    });
  }
  const levyBallotBlock = runtime.levyBlockFor(principal, tick);
  const levyBallot = (levyBallotBlock?.ballot ?? null) as Readonly<Record<string, unknown>> | null;
  // Read off the block, never recomputed here. `levyBlockFor` reads `Book.exposurePeakOf`, which is
  // the same call `levySubjectOf` makes for the weight — so the figure this sentence quotes is the
  // figure the rule uses, and a golden clause built from this string is a golden clause about the
  // engine. A second reading here would be the affordance and the arithmetic disagreeing about a
  // number, which is scar #1's exact shape.
  const levyPeakBilled = levyBallotBlock?.assessed_on_exposure_peak ?? 0;
  const levyPeakThisCycle = levyBallotBlock?.exposure_peak_this_cycle ?? 0;
  if (levyBallot !== null && levyBallot['voted'] === false) {
    eligible.push({
      verb: 'vote',
      params: { ballot: LEVY_BALLOT, rule: PUBLISHED_DEFAULT_RULE },
      cost: 0,
      max_direct_loss: 0,
      max_contingent_liability: 0,
      // ── `BY_STORES` NAMES THE GOOD, BECAUSE "HOLDING MOST" NAMED NOTHING ──────
      //
      // This read "BY_STORES onto whoever is holding most" — in the same block that says the Levy
      // is payable only in goods — while the engine weighted it by the CURRENCY balance. §3's canon
      // entry for STORES is "assets, inventory, balances", so the word covers both and the sentence
      // disambiguated neither. Both halves are fixed: `weightOf` now reads the levy good
      // (`assessment.ts:levyGoodHeld` carries the measurement) and this says which good it is.
      //
      // ── ★ AND THE TWO EXPOSURE RULES NAME **WHICH READING** (`RULES_VERSION` 17) ──
      //
      // Same defect class, in the same sentence, one rule over. "Whoever has most at risk" is true of
      // a dozen readings and the engine's is exactly one: the **largest** EXPOSURE you carried at any
      // tick of the previous Reckoning. Until 17 it was the value at the tick the docket was minted —
      // one tick after `settleVenture` releases every stake, a 22x trough — and an agent reading
      // `obligations.exposure.mine` at phase 0 and reasoning from it was reasoning correctly from the
      // wrong number. Both figures are quoted from the block, so the sentence and the arithmetic
      // cannot come apart (`levy/book.ts:exposurePeaks`).
      what_it_forecloses:
        `decides how NEXT Reckoning's Levy is SPLIT across your constellation. The total is fixed and ` +
        `cannot be voted away — only who bears which share. Swap \`rule\` for any of ` +
        `${LEVY_RULES.join(', ')}: BY_EXPOSURE loads it onto whoever has most at risk, BY_STORES onto ` +
        `whoever holds most ${LEVY_GOOD} to hand — the good the Levy is paid in, not currency — EVEN ` +
        `spreads it flat, INVERSE_EXPOSURE shields the exposed. "At risk" is one exact figure: the ` +
        `HIGHEST EXPOSURE you carried at any tick of a Reckoning, not the figure right now. Yours for ` +
        `the cycle in progress is ${String(levyPeakThisCycle)} and it is what the docket this ballot ` +
        `decides will read; the docket you are already holding was weighted from ` +
        `${String(levyPeakBilled)}. It only ever RISES inside a cycle, so a stake released before the ` +
        `freeze still counts — read levy.exposure_peak_this_cycle and levy.assessed_on_exposure_peak. ` +
        `You are voting on a bill you will pay, so the rule that suits you is rarely the one that ` +
        `suits the others. Quorum failure applies ${PUBLISHED_DEFAULT_RULE}. Free, and it costs no action.`,
      expires_tick: Number(levyBallot['closes_tick']),
      quote_id: quoteId(principal, tick, 'vote', { ballot: LEVY_BALLOT }),
    });
  }

  // 5B-bis. **THE OFFLINE PATH.** `set_delivery_intent` was the last HONEST GAP in AGT-R5's
  //     exception list: legal, executing, and offered nowhere. A3 makes durable intents the reason
  //     an offline agent is viable and R19 makes the Levy payable by one, so the players it serves
  //     are precisely the ones not around to go looking for it.
  //
  //     Offered in the FLAT spelling. The nested form is what the verb was born with and the house
  //     cast structurally cannot send it — `cast/parse.ts` rejects a non-array object in params and
  //     discards the whole plan for it, which production logged as
  //     `param-intent-nested-object`. An affordance an agent copies verbatim must be one every
  //     client can actually send.
  if (levyQuote.fault === null && levyQuote.payable > 0) {
    eligible.push({
      verb: 'set_delivery_intent',
      params: {
        intent_verb: 'deliver',
        obligation: 'LEVY',
        amount: levyQuote.payable,
        until_tick: tick + TICKS_PER_RECKONING * 2,
      },
      cost: 1,
      // The intent itself risks nothing at creation. What it will hand over each time it runs is
      // the delivery's own cost, and that is stated rather than hidden inside the total.
      max_direct_loss: levyQuote.payable,
      max_contingent_liability: 0,
      what_it_forecloses:
        `sets a STANDING ORDER to pay the Levy, so it keeps being paid while you are away. Creating ` +
        `it costs one action and every tick it runs after that costs NONE — that is the whole point ` +
        `of an intent, and it is why going offline costs you opportunity rather than your record. It ` +
        `hands over up to ${String(levyQuote.payable)} of ${LEVY_GOOD} each Reckoning until tick ` +
        `${String(tick + TICKS_PER_RECKONING * 2)}, and it will keep doing so whether or not you are ` +
        `watching — including when you would rather have spent those goods on something else. Raise ` +
        `\`until_tick\` to cover a longer absence, or send it again later to replace this one.`,
      expires_tick: tick + 1,
      quote_id: quoteId(principal, tick, 'set_delivery_intent', { obligation: 'LEVY' }),
    });
  }

  // 5B-ter. ★ **CARRY SOMEBODY ELSE'S SHARE — `deliver {payer}`, the ninth unexercised capability.**
  //
  //     §5.2 states the non-escrowable share as a *limit* — "it must be carried by a hand, not
  //     bought as a service" — and everything in this repo read only that half. The half nobody
  //     read is what the limit leaves: **70% of every assessment IS escrowable, and may be carried
  //     by another principal's hand.** `vDeliver` has honoured `payer`/`on_behalf_of` since the
  //     Levy landed, `creditFor` has bounded a foreign delivery to the escrowable bucket for just
  //     as long, and `levy.short` publishes `paidOtherMinor` to the viewer. **No affordance has
  //     ever offered it and `paidOther` is 0 in every world this repo has run.**
  //
  //     Which is the eighth instance of one lesson: a capability that exists and is never
  //     exercised is indistinguishable from one that is missing — in every report, on every frame,
  //     and to every reader including its author. It is also why the residue at nine Reckonings
  //     read as a §10 production shortfall: `g01` R7 has three members on one MARCHES system
  //     earning 10,368 a Reckoning against 23,900 each, while three others in the same
  //     constellation sit on 360,000 units of the same good. That is a **distribution** failure
  //     before it is a production one, and this is the door §5.2 already wrote for it.
  //
  //     Legality and arithmetic are both `Runtime.levyCarryQuotes`', which calls the same
  //     `deliveryFault` the verb calls and the same `carryableOf` the cast reads — so this cannot
  //     offer an act the engine refuses, and the bot cannot play a rule the menu does not show.
  //     `levyCarryQuotes` returns only the rows the verb would accept, capped at
  //     `MAX_LEVY_CARRY_OFFERS`; the rows it could not offer come back from
  //     `levyCarryObstacles` and are counted in `withheld` below, because an omission an agent
  //     could act on next tick is one it is entitled to know about (PROP-O1).
  for (const carry of runtime.levyCarryQuotes(principal, tick)) {
    eligible.push({
      verb: 'deliver',
      // `payer` rather than `on_behalf_of`: the verb takes either, and this is the spelling that
      // says what it does at a Levy. `amount` is already net of this principal's OWN outstanding
      // duty (see `carryableOf`), so copying this row verbatim cannot turn one shortfall into two.
      params: { obligation: 'LEVY', payer: carry.payer, amount: carry.payable },
      cost: 1,
      max_direct_loss: carry.payable,
      max_contingent_liability: 0,
      what_it_forecloses:
        `hands ${String(carry.payable)} of ${LEVY_GOOD} — out of YOUR stores, at ${String(carry.place)}, ` +
        `by one of YOUR hands standing there — against ${carry.payer}'s Levy, not your own. ` +
        `${carry.payer} owes ${String(carry.escrowableOwed)} that any hand may carry and ` +
        `${String(carry.presenceOwed)} that ONLY its own hand may: a stated share of every assessment is ` +
        `non-escrowable and cannot be bought at any price, so paying this does not clear ${carry.payer}'s ` +
        `whole bill and cannot. You hold ${String(carry.available)} of ${LEVY_GOOD} and still owe ` +
        `${String(carry.ownOwed)} on your own assessment; this offer is the ${String(carry.surplus)} above ` +
        `that, so it never spends the goods your own tribute needs. The goods are GONE — destroyed into ` +
        `civic custody — and the engine pays you NOTHING for this and awards you no standing: it is a ` +
        `transfer of your goods to somebody else's obligation. If you want paying, agree terms first ` +
        `(\`message\`, \`publish_offer\`, or a venture) — nothing here enforces a price. What it buys is ` +
        `political: a shortfall against ${carry.payer} is public and permanent, and this is on the record ` +
        `as the reason there was not one.`,
      expires_tick: tick + 1,
      quote_id: quoteId(principal, tick, 'deliver', { obligation: 'LEVY', payer: carry.payer }),
    });
  }
  for (const blocked of runtime.levyCarryObstacles(principal, tick)) {
    carryBlocked += 1;
    carryBlockedWhy.add(
      blocked.fault ??
        `your own assessment still needs ${String(blocked.ownOwed)} of the ${String(blocked.available)} ` +
          `units of ${LEVY_GOOD} you hold, so nothing is surplus yet`,
    );
  }

  // 5C. **THE CORE LOOP (A6).** `grant` had no affordance at all. It is legal, it works, and it was
  //     never on the menu — while the cast prompt tells a player *"the safest plan is built from
  //     entries in affordances[]"*. The live world showed the consequence directly:
  //     `authorityLines: 0` on the published frame, a core loop that had never run through the
  //     front door.
  //
  //     **Offered only to a counterparty you have actually kept a promise with.** That is not a
  //     list-budget dodge, it is the mechanic: A6 is an agent earning trust over months and then
  //     being handed authority it could abuse. A grant offered to a stranger is a handout; a grant
  //     offered to someone with a record is the end of an arc, and the receipt reads that way at
  //     settlement.
  //
  //     The caps are *(calibrate)* starting points, not claims of correctness: a tenth of the free
  //     balance, and an expiry one Reckoning out rather than the three the engine allows — a short
  //     life is what makes each renewal a decision (scar #7, the sticky vow).
  //
  //     The eligibility rule itself lives in `Runtime.grantCandidates` rather than here, because the
  //     heuristic cast now issues grants too and it picks from the same list. Two copies of "who may
  //     I hand an office to" — one for the menu an agent reads, one for the bot that plays — is scar
  //     #1's setup, and this is the worst verb in the game to have it on.
  //
  //     ★ **AND SINCE `RULES_VERSION` 23 THE PREVIEW PRICES THREE DIMENSIONS, NOT ONE.**
  //
  //     A7 requires that the grantor see the risk *before* it signs, and the risk stopped being
  //     one number the day a grant gained a fence and a clearance. Two numbers with a silent
  //     third axis is exposure accepted blind — scar #1 with money on it — so the row below
  //     states, in order: which VERBS the delegate may take in your name, which COMPARTMENTS it
  //     may read, and what it can do with what it reads. The last one is the part nobody prices
  //     by instinct: a cleared delegate can hand your figures to anybody, the copy is permanent,
  //     and revoking the grant does not take it back.
  const grantShape = officeShape('treasury-hand');
  let grantOffers = 0;
  /** The `grant` withheld text, or null. Pushed below, where `reasons` exists. */
  let grantSilent: string | null = null;
  for (const candidate of runtime.grantCandidates(principal, tick, MAX_GRANT_OFFERS)) {
    const fence = grantShape?.verbs ?? [];
    const rooms = grantShape?.clearance ?? [];
    eligible.push({
      verb: 'grant',
      params: {
        to: candidate.to,
        template: 'treasury-hand',
        max_direct_loss: candidate.cap,
        max_contingent_liability: candidate.cap,
        expires_tick: candidate.expiresTick,
        // Named explicitly rather than left to the template's default, though they are the same
        // two lists. A copy-pasteable affordance is the one place an agent learns a parameter
        // EXISTS, and a field that only ever appears as a default is a field no agent will ever
        // vary — which is how `preference` sat on `create` unread for the project's whole life.
        verbs: [...fence],
        clearance: [...rooms],
      },
      cost: 1,
      max_direct_loss: candidate.cap,
      max_contingent_liability: candidate.cap,
      what_it_forecloses:
        `puts ${candidate.to} in an OFFICE over your treasury until tick ` +
        `${String(candidate.expiresTick)}. From the tick it lands they may act in your name up to ` +
        `${String(candidate.cap)} of direct loss and ${String(candidate.cap)} of contingent liability, and ` +
        `you cannot undo an act they have already taken — only \`revoke\` what is left. ` +
        `A grant bounds THREE things and this one is a treasury-hand: it delegates the verb(s) ` +
        `${fence.join(' and ')} and NOT ${DELEGABLE_VERBS.filter((v) => !fence.includes(v)).join(', ')}, ` +
        `so they may pay your elective halves and cannot sign you into anything new. Its CLEARANCE is ` +
        `${rooms.length === 0 ? 'empty — they act blind' : rooms.join(' and ')}` +
        `${rooms.includes('STORES') ? ', so they read your exact free balance, your encumbered total and every good you hold' : ''}. ` +
        `A CLEARANCE IS THE PART THAT CANNOT BE TAKEN BACK: a cleared delegate may cut a DOSSIER — a ` +
        `signed, dated copy of those figures — and hand it to ANY principal with one \`message\`. You ` +
        `learn of it ${String(AUDIT_LAG_TICKS)} ticks later, or sooner if you spend an action on ` +
        `\`audit\`; and after you revoke, everything they already read stays theirs to pass on forever. ` +
        `Pass "clearance": [] to grant authority with no sight at all (that is a \`factor\`). ` +
        `They have kept ${String(candidate.kept)} promise(s) to you and broken ${String(candidate.broke)}. ` +
        `That record is why this is offered and it is not a prediction: the grant, this warning, and ` +
        `whatever they do with it all land on the same public record, and it is read back at settlement. ` +
        `This list is a SHORTLIST, not a restriction — \`grant\` accepts any enrolled principal, ` +
        `including one you have never dealt with, and the engine will not stop you. What is shown here ` +
        `is the ${String(MAX_GRANT_OFFERS)} with the strongest record with you, because an office is the ` +
        `heaviest thing you can hand out.`,
      expires_tick: tick + 1,
      quote_id: quoteId(principal, tick, 'grant', { to: candidate.to }),
    });
    grantOffers += 1;
  }
  // ══════════════════════════════════════════════════════════════════════════
  // ★ **AND WHEN THERE ARE NONE, SAY SO — `grant` HAD AN AFFORDANCE AND NO ACCOUNTING.**
  //
  // The affordance above closed *"a core loop that had never run through the front door"*. It did not
  // close the other half: a blind player went 21 observations with no `grant` offer and no `withheld`
  // entry, sent it anyway on the strength of §10's *"all live now"*, and it WORKED. So the menu was
  // silent about the game's core loop while the verb was reachable, which is the failure mode
  // `withheld` exists for.
  //
  // `test/api/withheld-is-accountable.spec.ts` had already measured it — 45.7% silent — and filed it
  // `OPEN` with the reason *"an office must EXIST before it can be granted, and offices are voted into
  // being, so the row would have to explain a multi-step path"*. **That describes a gate the code does
  // not have.** `grantCandidates` gates on three things and every one of them is one sentence:
  // a free balance to cap against, a counterparty that has HONOURED an elective half TO you, and no
  // live grant to that principal already. `officeShape('treasury-hand')` is a template constant — no
  // vote, no multi-step path. A stale exception is worse than a missing one: it argued a limitation the
  // engine never had, and the row it was blocking is four clauses long.
  // ══════════════════════════════════════════════════════════════════════════
  if (grantOffers === 0) {
    const cap = Math.trunc(free / 10);
    const relations = runtime.relationsFor(principal, MAX_LIST_ROWS);
    const withRecord = relations.filter((r) => r.kept > 0);
    // The set `grantCandidates` itself drops for an existing office: it is the only reader of the
    // grant book here, so this cannot disagree with the shortlist it is explaining.
    const alreadyGranted = withRecord.filter(
      (r) => !runtime.grantCandidates(principal, tick, MAX_LIST_ROWS).some((c) => c.to === r.other),
    );
    grantSilent =
        'no `grant` is offered' +
        (cap <= 0
          ? ': a grant is capped at a tenth of your FREE balance and yours is ' +
            `${String(free)}, so the cap would be 0 and an office worth nothing is not an office. ` +
            'Earn or unlock currency and the offer appears'
          : withRecord.length === 0
            ? ': the shortlist is principals that have HONOURED an elective half TO you, and ' +
              `${String(relations.length)} principal(s) have dealt with you with none of them having done ` +
              'that yet. `counterparties[].with_me.kept_to_me` is the count this reads — a grant is the heaviest ' +
              'thing you can hand out and the shortlist is the ones with a record with you'
            : alreadyGranted.length >= withRecord.length
              ? `: every principal with a record with you (${withRecord.map((r) => String(r.other)).sort(cmp).join(', ')}) ` +
                'already holds a LIVE grant from you — one at a time per counterparty. `revoke` the ' +
                'standing one first, or deal with somebody new'
              : ': the shortlist came back empty this tick') +
        '. **The shortlist is not the rule**: `grant {delegate, template, max_direct_loss, ' +
        'max_contingent_liability, expires_tick}` accepts ANY enrolled principal, including one you ' +
        'have never dealt with, and the engine will not refuse it. What is withheld here is the ' +
        'recommendation, never the act — A6 is the core loop and nothing gates it on our advice';
  }

  // 5C-bis. ★ **THE DOSSIER, AND `audit` — the sight half of A6 made reachable.**
  //
  //     Two mechanisms landed with the clearance and neither is worth anything unreachable. The
  //     project has thirteen recorded instances of exactly that, the most recent being
  //     `lockFillStake` — §7.3's escrow, its own passing test, no caller anywhere in `src/`.
  //
  //     **Offering a leak is not endorsing one, and this is the distinction A6 rests on.** The
  //     row below offers `message {to, dossier}`, whose meaning is decided entirely by the
  //     recipient the agent picks: to your grantor it is a report, to your grantor's rival it is
  //     a leak, and it is the SAME CALL. The engine records custody and never intent (§16.7
  //     MUST-9), so the menu names the act, prices the permanence, and leaves the choice where
  //     A6 puts it — with the agent, through an ordinary legitimate verb.
  //
  //     The recipient in `params` is deliberately the SUBJECT — i.e. reporting to your own
  //     grantor, the honest use — because a copy-pasteable affordance is a suggestion and the
  //     safe one is the right default. `what_it_forecloses` states plainly that any principal
  //     may be named instead.
  // One counter, and it bounds BOTH loops. The first draft tested `eligible.filter(...)` inside the
  // inner loop and `break`-ed on it, which only leaves the INNER loop — so a delegate holding three
  // cleared grants could push six rows past a cap of two. A cap that is not actually a cap is worse
  // than none: `withheld` reconciles `candidates === shown + Σ withheld` per field (PROP-O1), and an
  // over-full list makes that arithmetic wrong in the direction nobody checks.
  //
  // ── ★ AND THEN THE CAP THAT WAS A CAP DROPPED THE MOST DANGEROUS ACT IN THE GAME ──
  //
  // The paragraph above fixed the arithmetic and left two defects standing, both found by a probe
  // that ran a complete betrayal from outside:
  //
  //   1. **`MAX_GRANT_OFFERS` is a cap on a DIFFERENT LIST.** It sizes 5C's shortlist of principals
  //      you might grant an office TO — "the 2 with the strongest record with you, because an office
  //      is the heaviest thing you can hand out". Borrowing it here made the DOSSIER list two rows
  //      long for a reason that has nothing to do with dossiers, which is HARD RULE 4's failure mode
  //      one level below the vocabulary: one constant standing for two concepts.
  //   2. **The order was grant-id hash order, so one grantor could take every slot.** `forDelegate`
  //      returns `all()`, sorted lexicographically by `g:<tick>:<hash>` (`grant/book.ts`). A delegate
  //      holding an OFFICE in a syndicate *and* a personal grant over `p:probe-trust-01` therefore
  //      got both rows spent on `syn:…/STORES` and `syn:…/HANDS` — and `p:probe-trust-01` never
  //      appeared, while **two live grants were serving that principal's stores and hands on every
  //      tick**. `withheld` said `count: 4, verbs: [build, move, trade]` and named neither `message`
  //      nor the subject: both `break`s incremented nothing, so the drop was outside all 16 terms of
  //      the sum. The probe hand-built the call, it was ACCEPTED, and the leak landed.
  //
  // §6 says *"we never truncate this list. If something was left out you get a `withheld` count and
  // a reason."* This was the counterexample, and it was the worst possible row to lose: leaking a
  // dossier on the principal who trusted you is A6's signature act, and the menu offered it only
  // against a syndicate.
  //
  // So: **its own cap, breadth-first by grantor, and every drop counted.** Breadth-first is the
  // load-bearing half — a cap that always resolves in favour of the same subject is
  // indistinguishable from that subject being the only one you can read. The door
  // (`Runtime.cite` -> `GrantBook.clearanceGrantFor`) is uncapped and subject-agnostic, so the menu
  // being narrower than the door is exactly the "engine knows, surface lies" shape.
  const dossierRows = clearanceOffers(runtime, principal, tick);
  clearanceOffersDropped = dossierRows.dropped;
  clearanceOffersDroppedSubjects = dossierRows.droppedSubjects;
  for (const { grant, room } of dossierRows.shown) {
    {
      eligible.push({
        verb: 'message',
        params: { to: grant.grantor, dossier: `${String(grant.grantor)}/${room}` },
        cost: 1,
        // Nothing of YOURS is at risk and that is the whole problem with this act: the loss is
        // the subject's, and it is not denominated in currency at all. Stating 0 with the
        // sentence below is honest; inventing a figure for somebody else's secret would not be.
        max_direct_loss: 0,
        max_contingent_liability: 0,
        what_it_forecloses:
          `cuts a DOSSIER on ${grant.grantor}'s ${room} — the server's own figures, read at this tick and ` +
          `signed, not your word for them — and hands it to the principal you name in "to". As written this ` +
          `row reports to ${grant.grantor} ITSELF, which is what an office holder does; name any other ` +
          `principal instead and the identical call is a leak. Costs you nothing and risks nothing of ` +
          `yours. It is PERMANENT and ATTRIBUTABLE: the row names you, ${grant.grantor}, the recipient and ` +
          `grant ${grant.id}, it reaches ${grant.grantor} and every viewer at tick ` +
          `${String(tick + AUDIT_LAG_TICKS)} (sooner if ${grant.grantor} spends an action on \`audit\`), and ` +
          `whoever receives it can hand it on again forever — including after ${grant.grantor} revokes ` +
          `this grant. Nothing un-cuts a dossier. What ${grant.grantor} sees is THAT you disclosed and to ` +
          `whom, never its own figures read back.`,
        expires_tick: tick + 1,
        quote_id: quoteId(principal, tick, 'message', { dossier: `${String(grant.grantor)}/${room}` }),
      });
    }
  }

  //     `audit` — the counterintelligence half, and the only thing that shortens the window.
  //     Offered whenever a live grant of yours carries a CLEARANCE, because that is exactly when
  //     the log can have anything in it. `unrevealed_count` on the same payload is what makes the
  //     spend a decision rather than a ritual.
  {
    const cleared = runtime.grants
      .forGrantor(principal)
      .filter((g) => g.clearance.length > 0 && runtime.grants.isLive(g.id, tick));
    const through = runtime.audits.through(principal);
    const dark = runtime.dossiers
      .about(principal)
      .filter((d) => !runtime.dossiers.visibleToSubject(d, tick, through)).length;
    if (cleared.length > 0) {
      eligible.push({
        verb: 'audit',
        params: {},
        cost: 1,
        max_direct_loss: 0,
        max_contingent_liability: 0,
        what_it_forecloses:
          `reads your own access log NOW instead of waiting ${String(AUDIT_LAG_TICKS)} ticks. ` +
          `${String(cleared.length)} live grant(s) of yours carry a CLEARANCE, so ` +
          `${cleared.map((g) => `${String(g.delegate)} (${g.clearance.join('+')})`).join(', ')} can each cut a ` +
          `DOSSIER on you at will. ${String(dark)} cut(s) exist that have not reached you yet; this reveals ` +
          `every one of them, with who cut it, on which compartment, and to whom. It costs one action and ` +
          `buys no power: you cannot un-cut a dossier, only \`revoke\` the clearance that makes the NEXT one ` +
          `possible. The audit itself POSTS PUBLICLY, so your delegates will see that you looked — what it ` +
          `found stays yours.`,
        expires_tick: tick + 1,
        quote_id: quoteId(principal, tick, 'audit', { through: String(tick) }),
      });
    } else if (runtime.grants.forGrantor(principal).length > 0) {
      // PROP-O1: every eligible-looking omission is counted with a ground an agent can act on.
      // A grantor with grants but no clearance out has an EMPTY log by construction, and
      // `NO_RECORD` is precisely "we hold no row for it, and will not invent zeros that read as
      // facts" — the alternative being an `audit` offer that spends a real action on nothing.
      auditNoClearance = runtime.grants.forGrantor(principal).length;
    }
  }

  // 5D. **FOUNDING A HOUSE.** `form` was legal, priced, and never offered — the fourth
  //     built-but-unreachable primitive found this session. Its entry point being absent is why a
  //     probe agent that wanted a syndicate had to reconstruct the id convention from our source.
  //
  //     WHY IT HAD NO AFFORDANCE, and it is a real difficulty rather than an oversight: `form`
  //     needs a NAME, and a menu cannot invent one. The answer is a deterministic suggestion off
  //     the principal id — copy-pasteable, which is what the cast prompt promises an affordance is,
  //     and trivially overridden by an agent with a better idea. No RNG, so nothing here can move
  //     `state_hash`.
  //
  //     The charter is the loudest part of the warning because it is PERMANENT: there is no verb
  //     that amends one. `treasury_offices` in particular decides forever whether the pool is a
  //     business or a strongbox, and the default is the strongbox.
  if (runtime.syndicates.of(principal, tick).length < MAX_SYNDICATES_PER_PRINCIPAL &&
      free >= FOUNDING_COST_MINOR) {
    const suggested = `${String(principal).replace(/^p:/, '')}-house`;
    eligible.push({
      verb: 'form',
      params: { name: suggested, admission: DEFAULT_CHARTER.admission, decision: DEFAULT_CHARTER.decision, treasury_offices: DEFAULT_CHARTER.treasuryOffices },
      cost: 1,
      max_direct_loss: FOUNDING_COST_MINOR,
      max_contingent_liability: 0,
      what_it_forecloses:
        `founds a SYNDICATE for ${String(FOUNDING_COST_MINOR)}, retired to nobody, so your starter ` +
        `stake can cover it. The CHARTER YOU SET NOW IS PERMANENT — there is no verb in this game ` +
        `that amends one, because a charter an incumbent could amend is a preference and not a ` +
        `promise. These params carry the defaults: admission ${DEFAULT_CHARTER.admission}, decision ` +
        `${DEFAULT_CHARTER.decision}, and treasury_offices ` +
        `${String(DEFAULT_CHARTER.treasuryOffices)} — which means NO office may ever be given ` +
        `authority over the pool, making it a strongbox rather than a business. Send ` +
        `treasury_offices:true if you want a house that can appoint, and decide that now: you ` +
        `cannot change it later, and every member joins on the basis of what you set.`,
      expires_tick: tick + 1,
      quote_id: quoteId(principal, tick, 'form', { name: suggested }),
    });
  }

  // 6. Move an idle hand one gate. Loss is time, never capacity (INV-8), so the
  //    direct loss is exactly zero and saying so is the point.
  //
  //    **The trip's length is published, because a fill is on the other end of it.**
  //    A board slot staged elsewhere needs a `move` first, and an agent that cannot tell
  //    when the hand becomes fillable has to spend a *second wake* to find out — the same
  //    arithmetic that made Gate 3 unreadable, one step earlier in the chain. The lane's
  //    `transitTicks` is exact (`departHand` sets `freeAtTick = resolveTick + transitTicks`
  //    and `resolveArrival` sets `presentSinceTick = freeAtTick + 1` because
  //    `ARRIVAL_IS_PRESENT_SAME_TICK` is false), so this is arithmetic, not an estimate (A2).
  //    Stated as a rule about the resolving tick rather than as an absolute number, because
  //    this quote is good for `QUOTE_PIN_TICKS` and an absolute tick would go stale inside
  //    its own window.
  //
  //    **A lane the Commons bind would refuse is not offered** (A15, §4.1). Until this
  //    check existed, a Commons-seated principal — which is every principal at enrolment —
  //    was handed a `move` onto every outbound lane and then refused by
  //    `commonsBoundRejection` when it took one. That is the server telling an agent to do
  //    something and then declining (AGT-S2), it costs a real action every time, and it is
  //    the exact surface a playtest probe read as "there is no way out of the Commons":
  //    the offers were there, the door was not. Now the count says why and names the door.
  let commonsBoundLanes = 0;
  for (const hand of hands) {
    if (hand.state !== 'IDLE') continue;
    const system = world.map.systems.get(hand.location);
    if (system === undefined) continue;
    for (const lane of [...system.lanes].sort(cmp)) {
      if (commonsBoundRejection(world, hand, lane) !== null) {
        commonsBoundLanes += 1;
        continue;
      }
      const trip = transitTicks(world.map, hand.location, lane);
      eligible.push({
        verb: 'move',
        params: { hand: hand.id, to: lane },
        cost: 1,
        max_direct_loss: 0,
        max_contingent_liability: 0,
        what_it_forecloses:
          `this hand cannot fill a role until it arrives, and it can be raided at ${lane} from the tick it ` +
          `does. This lane takes ${String(trip)} tick(s): a move resolving in tick R lands the hand on tick ` +
          `R+${String(trip)} and it is PRESENT — able to fill a role, work or escort — on R+${String(trip + 1)}.` +
          // ══════════════════════════════════════════════════════════════════════
          // ★ **AND WHETHER THIS LANE IS A STRAIT, WHICH DECIDES IF THE WALK BUYS FORCE.**
          //
          // The same sweep question as `graduation.ground[]`: does the observation publish the term that
          // dominates the outcome? `move` names the trip and the exposure and said nothing about the
          // pinch — and at `RULES_VERSION` 35 that term became load-bearing, because raider force is
          // now `min(hands standing there, SWAY there)` and a STRAIT you hold neither end of costs
          // `SWAY_STRAIT_TOLL` of exactly that. So walking a hand across an unheld strait can put it
          // somewhere it is *present and worth nothing offensively*, which is indistinguishable from a
          // successful march in every other field on this affordance.
          //
          // `holding.sway.reaches[]` publishes the standing figure and `SWAY_STATEMENT` the rule; this
          // is the one place the toll is about to be paid. Only said when it applies — a clause on
          // every lane in the galaxy is a clause agents learn to skip.
          // ══════════════════════════════════════════════════════════════════════
          (isStrait(world.map, hand.location, lane)
            ? ` ★ THIS LANE IS A STRAIT. Your SWAY at ${lane} is ${String(runtime.swayFor(principal, lane))} — ` +
              `a strait whose ends you hold NEITHER of costs ${String(SWAY_STRAIT_TOLL)} of it, and SWAY is ` +
              `how many of your hands count as FORCE at a place you are not defending. At 0 a hand that ` +
              `arrives is present and counts for nothing on any offensive side. Defence is never capped ` +
              `this way. holding.sway lists every place you do project into and which STRAITS you hold.`
            : ''),
        expires_tick: tick + QUOTE_PIN_TICKS,
        quote_id: quoteId(principal, tick, 'move', { hand: hand.id, to: lane }),
      });
    }
  }

  // 6b. Trade the local book, both sides, and **only what is actually takeable**.
  //
  //     Every offer here is an `IOC` limit order, because IOC is the only market-take
  //     primitive in this game (M1) and because an affordance is a *complete, copyable
  //     act*: an agent that copies this gets the fill that is on the book now or gets
  //     nothing, never an unintended resting order it has to remember to cancel.
  //
  //     ── ★ ELIGIBILITY IS THE VERB'S OWN ANSWER NOW, NOT A SECOND COPY OF IT ──
  //
  //     It used to be this layer's own affordability arithmetic — `Math.floor(free / price)` —
  //     and `planOrder` decided the real one, three ways apart:
  //
  //       · it read the RAW BALANCE where `planOrder` reads `freeCash`, so on the live shard's
  //         own numbers (200,000 free, 0 transferable) the menu offered up to 200,000 of BIDs
  //         the verb refuses. It escaped notice only because the probe's venue had nothing
  //         resting to price against;
  //       · it never checked SELF-CROSS, so a principal whose own ask was the only level on the
  //         book was offered a BID against itself, which `planOrder` refuses on A15;
  //       · it never checked the open-order CAPS.
  //
  //     All three are AGT-S2 — the server telling an agent to do something and then declining —
  //     and all three are one bug: two homes for one rule (HARD RULE 4). `tradeCheck` asks the
  //     same `planOrder` the verb runs, moves nothing, and cannot drift from it.
  const tradePorts = {
    ledger: runtime.ledger,
    world,
    book: runtime.market,
    principal,
    tick,
  };
  for (const book of books) {
    const askLevel = book.levels.ask[0];
    if (askLevel !== undefined && askLevel.price > 0) {
      // `transferable`, never `free`: `planOrder` gates the BID on `freeCash` and the two
      // differ by the whole endowment. See {@link transferable} for what that cost. Kept as a
      // pre-filter as well as a gate because it also sizes the order.
      const affordable = Math.min(askLevel.qty, Math.floor(transferable / askLevel.price), MAX_ORDER_QTY);
      if (
        affordable > 0 &&
        tradeCheck(tradePorts, {
          operation: 'place',
          venue: book.venue,
          good: book.good,
          side: 'BID',
          quantity: affordable,
          limitPrice: askLevel.price,
          durationTicks: null,
          timeInForce: 'IOC',
          order: null,
        }) === null
      ) {
        const spend = minor(affordable * askLevel.price);
        eligible.push({
          verb: 'trade',
          params: {
            operation: 'place',
            venue: book.venue,
            good: book.good,
            side: 'BID',
            quantity: affordable,
            limit_price: askLevel.price,
            time_in_force: 'IOC',
          },
          cost: 1,
          // The whole escrow, stated as the worst case even though a fill can only be
          // at this price or better and the remainder is released. Overstating a cost
          // is the safe direction for PROP-O4; understating one is how A7's honesty
          // guarantee stops meaning anything.
          max_direct_loss: spend,
          max_contingent_liability: minor(0),
          what_it_forecloses:
            `${String(spend)} of your free stores is escrowed the moment this is accepted and stays escrowed ` +
            `until the next MARKETS phase. It buys at ${String(askLevel.price)} or better; anything unfilled ` +
            'expires that same pass and the cash comes back. The goods land at ' +
            `${book.venue} — a trade settles where it happened, and moving them is a separate journey.`,
          expires_tick: tick + QUOTE_PIN_TICKS,
          quote_id: quoteId(principal, tick, 'trade', { venue: book.venue, good: book.good, side: 'BID' }),
        });
      }
    }
    const bidLevel = book.levels.bid[0];
    const holding = sellableGoods(runtime.ledger, principal, book.good, book.venue);
    const amount = bidLevel === undefined ? 0 : Math.min(bidLevel.qty, holding, MAX_ORDER_QTY);
    if (
      bidLevel !== undefined &&
      amount > 0 &&
      tradeCheck(tradePorts, {
        operation: 'place',
        venue: book.venue,
        good: book.good,
        side: 'ASK',
        quantity: amount,
        limitPrice: bidLevel.price,
        durationTicks: null,
        timeInForce: 'IOC',
        order: null,
      }) === null
    ) {
      eligible.push({
        verb: 'trade',
        params: {
          operation: 'place',
          venue: book.venue,
          good: book.good,
          side: 'ASK',
          quantity: amount,
          limit_price: bidLevel.price,
          time_in_force: 'IOC',
        },
        cost: 1,
        // A sale escrows goods, not money, and it sells at its own limit or better —
        // so nothing is at risk of being lost. What it forecloses is the goods.
        max_direct_loss: minor(0),
        max_contingent_liability: minor(0),
        what_it_forecloses:
          `${String(amount)} of ${book.good} leaves your stores into escrow immediately and cannot back ` +
          'anything else — not a Levy delivery, not a second order — until this resolves. It sells at ' +
          `${String(bidLevel.price)} or better; anything unfilled comes back on the same pass.`,
        expires_tick: tick + QUOTE_PIN_TICKS,
        quote_id: quoteId(principal, tick, 'trade', { venue: book.venue, good: book.good, side: 'ASK' }),
      });
    }
  }

  // 7. Words. Free, bounded, public, permanent.
  eligible.push({
    verb: 'publish_offer',
    params: { text: 'HANDS FOR HIRE' },
    cost: 1,
    max_direct_loss: 0,
    max_contingent_liability: 0,
    what_it_forecloses: 'nothing. An offer is a price list, not a commitment.',
    expires_tick: tick + QUOTE_PIN_TICKS,
    quote_id: quoteId(principal, tick, 'publish_offer', {}),
  });
  eligible.push({
    verb: 'claim',
    params: { text: '' },
    cost: 0,
    max_direct_loss: 0,
    max_contingent_liability: 0,
    what_it_forecloses: 'nothing binds on a claim. It is public and permanent, and it may be a lie.',
    expires_tick: tick + QUOTE_PIN_TICKS,
    quote_id: quoteId(principal, tick, 'claim', {}),
  });

  // ── An affordance is never offered for a verb that cannot be taken ────────
  //
  // Structural, not a review item. `seal` was offered here while the runtime had
  // deliberately unregistered it, and the blind-play probe did exactly what agent.md
  // tells it to — copy an affordance verbatim — and got a PHASE-0 correction for its
  // trouble, every wake, for two hundred ticks. An affordance the engine will refuse
  // is worse than a missing one: it is the server telling an agent to do something
  // and then declining, which is AGT-S2's failure and it costs the agent real actions.
  //
  // Filtering here rather than at each `push` is deliberate too: a per-branch check is
  // one somebody forgets when they add a branch, and this one cannot be forgotten.
  const live = runtime.liveVerbs;
  const offerable = eligible.filter((a) => live.has(a.verb));
  const notLive = eligible.length - offerable.length;

  // ── EVERY DISTINCT VERB BEFORE ANY VERB'S REPEATS ─────────────────────────
  //
  // The truncation used to be `slice` over INSERTION order while the notice below told the agent the
  // dropped acts were "the lowest-priority repeats (extra lanes for an already-listed hand)". Nothing
  // made that true. It became false the moment the world got richer: a cast that holds WORKS,
  // syndicates and grants generates more offers, and `assure` — pushed late — fell off the end while
  // earlier repeats survived. So a principal that owed an elective half was not told it could assure,
  // and the observation explained the omission with a sentence that did not describe it.
  //
  // A rules surface that misdescribes its own omission is scar #1's shape: every component correct,
  // the agent taught the wrong thing. Cheapest way to make the sentence true is to make the ordering
  // match it — one pass that takes the first offer of each verb, then the rest in their original
  // order. Stable, no comparator on user data (DET-1), and it guarantees no mechanic is invisible
  // merely because another mechanic has many variants.
  const firstOfEachVerb: typeof offerable[number][] = [];
  const repeats: typeof offerable[number][] = [];
  const seenVerbs = new Set<string>();
  for (const a of offerable) {
    if (seenVerbs.has(a.verb)) repeats.push(a);
    else {
      seenVerbs.add(a.verb);
      firstOfEachVerb.push(a);
    }
  }
  const prioritised = [...firstOfEachVerb, ...repeats];

  const list = prioritised.slice(0, MAX_AFFORDANCES);
  const dropped = prioritised.length - list.length;
  // ── EVERY ROW CARRIES THE VERB IT ACCOUNTS FOR (see {@link Withheld.verbs}) ──
  //
  // The tag is not decoration and it is not for the reader alone: it is the only thing that makes
  // `header.withheld`'s closing promise *reconcilable* against `header.live_verbs`. Untagged, the
  // accounting existed only as prose and a whole mechanic could ship with no row — which is exactly
  // what `trade` did, in 86% of a swept world's observations.
  const reasons: WithheldRow[] = [];
  if (dropped > 0) {
    reasons.push({
      verb: null,
      text:
      `${String(dropped)} further legal acts exist and were not sent, because one observation carries at most ` +
        `${String(MAX_AFFORDANCES)}. They are the lowest-priority repeats (extra lanes for an already-listed hand)`,
    });
  }
  if (notLive > 0) {
    // Counted, not silent. PROP-O1 is about omissions being *countable*, and "the
    // mechanic has not landed" is an omission the agent is entitled to know about.
    reasons.push({
      verb: null,
      text:
      `${String(notLive)} act(s) you are otherwise eligible for name a verb whose mechanic has not landed yet; ` +
        'header.live_verbs is the current list',
    });
  }
  if (alternateHands > 0) {
    reasons.push({
      verb: 'fill_role',
      text:
      `${String(alternateHands)} further legal fill_role act(s) exist and are not listed: each open slot on ` +
        'ventures.board[] can be filled by ANY of your idle hands standing at that venture’s stage, and only ' +
        'one is offered per slot. hands[] lists them all, and which hand you send changes nothing about what ' +
        'the role pays',
    });
  }
  if (rowsOutOfReach > 0) {
    reasons.push({
      verb: 'fill_role',
      text:
      `${String(rowsOutOfReach)} slot(s) on ventures.board[] have no fill_role offered because you have no ` +
        `idle hand standing at their stage (${[...unreachedStages].sort(cmp).join(', ')}) — a hand fills a ` +
        'role where the venture happens, so `move` one there first and check the trip fits inside the window ' +
        'each row publishes in expires_tick',
    });
  }
  if (rowsWithNoHand > 0) {
    reasons.push({
      verb: 'fill_role',
      text:
      `${String(rowsWithNoHand)} slot(s) on ventures.board[] have no fill_role offered because none of your ` +
        'hands is both IDLE and present this tick — a hand that arrived this tick is not present until the ' +
        'next one. They are still on the board and still yours to take once a hand frees up',
    });
  }
  if (commonsBoundLanes > 0) {
    reasons.push({
      verb: 'move',
      text:
      `${String(commonsBoundLanes)} move(s) onto lanes leaving the Commons are not offered because your ` +
        'holding is civic-leased in the Commons, so your hands are Commons-bound and may only move between ' +
        'COMMONS systems (A15). That is not a bug and it is not permanent: `graduate` moves your HOLDING one ' +
        'lane outward for a price, and from the tick it lands your hands are free to go anywhere. ' +
        'holding.graduation carries the price and the destinations',
    });
  }
  if (crossingWithheld > 0 && crossing !== null) {
    // Counted, never silent: this is the one omission that, left uncounted, would look
    // exactly like the defect a playtest already found — an exit that does not exist.
    reasons.push({
      verb: 'graduate',
      text:
      `${String(crossingWithheld)} graduate act(s) exist and are not offered because the crossing is not ` +
        `affordable yet: it costs ${String(crossing.upkeepMinor)} currency (you have free ` +
        `${String(crossing.freeMinor)}) plus ${String(crossing.upkeepQty)} units of ${crossing.good} standing ` +
        `at ${crossing.from} (you have ${String(crossing.availableQty)} unpledged there). ` +
        'holding.graduation carries the same figures and the destinations, so the choice is still readable',
    });
  }
  if (worksWithheld > 0 && worksHere !== null) {
    reasons.push({
      verb: 'build',
      text:
      `a WORKS at ${worksHere.system} is not offered because you cannot pay for it yet: it costs ` +
        `${String(worksHere.costMinor)} of your unlocked balance (you can spend ` +
        `${String(worksHere.freeMinor)} — pledged stores are withheld from that figure, your starter ` +
        'stake is not) plus ' +
        `${String(worksHere.costQty)} units of ${worksHere.good} standing here (you have ` +
        `${String(worksHere.availableQty)} unpledged). holding.works carries the same figures and the ` +
        'share you would get, so the decision is readable before you can afford it',
    });
  }
  if (crossingAnchored > 0 && crossing !== null) {
    reasons.push({
      verb: 'graduate',
      text:
      `${String(crossingAnchored)} graduate act(s) exist and are not offered because you hold live claim(s) on ` +
        `${crossing.anchoring.join(', ')} — a claim is anchored by a body, so your holding cannot leave ` +
        'territory that would then have nobody standing on it. `abandon` returns part of the bond and ' +
        '`publish_offer` {"cede":…} sells the claim; either one opens the crossing again',
    });
  }
  if (chargeNoHand > 0) {
    // Counted with the sentence that fixes it, because the fix is one ordinary act. Left
    // uncounted this would read as "your Charge is unpayable", which is the shape of the
    // refusal loop that buries real rules-surface defects (AGT-S3).
    reasons.push({
      verb: 'deliver',
      text:
      `${String(chargeNoHand)} Charge delivery(ies) exist and are not offered because none of YOUR hands is ` +
        `standing at ${[...new Set(chargeNoHandAt)].sort(cmp).join(', ')}. A Charge is goods physically handed ` +
        'over, so `move` a hand there first — `graduate` moved your holding and your stores, never your hands. ' +
        'obligations.charge[] carries `hand_here: false` and the full bill regardless, so the deadline stays ' +
        'readable; and any principal\'s hand may pay any claim\'s Charge, so hiring a carrier also works',
    });
  }
  if (carryBlocked > 0) {
    // ── COUNTED, BECAUSE THIS OMISSION IS THE ONE THAT WAS INVISIBLE FOR THE WHOLE BUILD ──
    //
    // §5.2 makes 70% of every assessment escrowable and carryable by another principal's hand,
    // `deliver {payer}` has implemented it since the Levy landed, and until now nothing offered it
    // — so `paidOther` was 0 in every world this repo ran. Left uncounted, a principal with the
    // goods and no hand at the place would see no carry offer, conclude the mechanism does not
    // apply to it, and the meter would keep reading as a production shortfall.
    //
    // The fix is usually one ordinary act, so the sentence says which: a hand at the delivery
    // place. That is the same hand paying your own tribute puts there.
    reasons.push({
      verb: 'deliver',
      text:
      `${String(carryBlocked)} deliver act(s) on ANOTHER principal's Levy are not offered — a stated share of ` +
        'every assessment is escrowable (§5.2) and may be discharged by any principal\'s hand, so a ' +
        'constellation-mate with goods can pay down a neighbour\'s bill. Reason(s): ' +
        `${[...carryBlockedWhy].sort(cmp).join(' · ')}. The non-escrowable share is never carryable at any ` +
        'price, and nothing here obliges you to carry anything — a carry hands YOUR goods to somebody ' +
        'else\'s obligation for no payment the engine enforces',
    });
  }
  if (auditNoClearance > 0) {
    // ── COUNTED, BECAUSE AN EMPTY LOG AND A MISSING MECHANIC READ IDENTICALLY ──
    //
    // A grantor holding grants and offered no `audit` would reasonably conclude the verb does not
    // apply to it. The truth is sharper and more useful: its own grants delegate ACTION and not
    // SIGHT, so there is nothing that could be in the log — which is the fact that teaches the
    // agent what a clearance actually is, at the moment it is holding the alternative.
    reasons.push({
      verb: 'audit',
      text:
        `${String(auditNoClearance)} grant(s) you issued carry no CLEARANCE, so nobody can cut a DOSSIER on ` +
        'you and your access log is empty by construction — `audit` would spend a real action to read ' +
        'nothing. A grant delegates authority to ACT (its verbs) and authority to SEE (its clearance) ' +
        'separately, and yours delegate only the first. `grants.granted[].clearance` is the field',
    });
  }
  if (clearanceOffersDropped > 0) {
    // ── COUNTED, BECAUSE THIS IS THE ROW WHOSE ABSENCE WAS THE DEFECT ──────────
    //
    // A probe held two live grants — one over a syndicate, one over the principal that trusted it —
    // and the menu offered dossiers on the syndicate only. It hand-built the other call; it was
    // accepted; the leak landed. `withheld` had said `count: 4, verbs: [build, move, trade]`, so the
    // single most consequential omission in A6's whole loop was the one thing the accountability
    // channel did not mention. Naming the SUBJECTS rather than only the number is the part that
    // makes it actionable: a delegate reading this can construct the call, which is exactly what
    // §6's promise means and what an uncounted `break` denied.
    reasons.push({
      verb: 'message',
      text:
        `${String(clearanceOffersDropped)} DOSSIER row(s) you are cleared to cut are not on this list — the ` +
        `menu carries ${String(MAX_DOSSIER_OFFERS)} at a time, breadth-first so every grantor you can read ` +
        'appears at least once. Withheld from the MENU is not withheld from the GAME: `message ' +
        '{"to": "<any principal>", "dossier": "<grantor>/<COMPARTMENT>"}` is accepted for any live grant ' +
        'you hold, capped by nothing. The omitted ones are ' +
        `${clearanceOffersDroppedSubjects.join(', ')} — read them off \`grants.held[].clearance\``,
    });
  }
  if (raiderJoinsBeyondSway > 0) {
    // ── ★ §16.12 #1, COUNTED FOR `demandCapacitySpent`'s REASON AND ONE MORE ──
    //
    // A reach limit is the most silent thing this build has added: nothing about the observation
    // changes when a hand walks past the edge of its principal's sway, and the hand still stands
    // there looking useful. `holding.sway` publishes the standing figure, `force.your_sway`
    // publishes it per standoff, and this says out loud that the offer was narrowed and by what.
    reasons.push({
      verb: 'join',
      text:
        `${String(raiderJoinsBeyondSway)} standoff(s) are offered to you on the DEFENDER side only: your ` +
        `SWAY at ${[...raiderJoinSwayWhy].sort(cmp).join(', ')} is 0, and a RAIDER's hands count as force ` +
        'only within its reach (§16.12) — so joining that side would buy the raid nothing and `join` would ' +
        'refuse it. Defending is never capped this way. `holding.sway` lists every place you do project ' +
        'into and which STRAITS you hold; take a CLAIM nearer, or one end of the STRAIT in the way',
    });
  }
  // ── ★ A PARTY THAT COULD BRING MORE FORCE AND HAS NOTHING TO BRING ──────────
  //
  // `move` rather than `join`, because `join` is genuinely closed to a principal already in the
  // standoff (one principal is one party row) and naming it here would send an agent at a refusal.
  // The row exists because force stopped being a row count: *"more of your hands would count"* is now
  // a true and actionable sentence, and a menu that goes quiet over it teaches the old rule.
  if (grantSilent !== null) reasons.push({ verb: 'grant', text: grantSilent });
  if (reinforcementSilent.length > 0) {
    reasons.push({
      verb: 'move',
      text: `no reinforcement is offered for ${reinforcementSilent.join('; ')}`,
    });
  }
  if (parleyWithheldReason !== null) {
    // ── COUNTED, BECAUSE THREE DIFFERENT SILENCES READ IDENTICALLY ─────────────
    //
    // *Not entitled*, *spent* and *nobody reachable* produce the same empty menu, and a probe
    // reported exactly that confusion about §9's capacity in as many words: it could not tell zero
    // capacity from silence. `capacity.rule` is the sentence that names which one and what would
    // change it — the entitlement is a deal, never another account (A15).
    reasons.push({
      verb: 'message',
      text:
        `${String(parleyWithheldCount)} PARLEY act(s) are not offered. ${parleyWithheldReason} A MESSAGE inside ` +
        'a venture you already share is unaffected: it is free, unrationed, and needs no entitlement',
    });
  }
  if (parleyReachDropped > 0) {
    // ── COUNTED, AND THE SUBJECTS NAMED ───────────────────────────────────────
    //
    // `clearanceOffersDropped`'s lesson one channel over: a probe held two live grants, the menu
    // offered dossiers on one, and `withheld` named a count without a subject — so the omission was
    // unactionable. Naming the principals is what lets an agent construct the call itself, which is
    // the whole promise of "withheld from the MENU is not withheld from the GAME".
    reasons.push({
      verb: 'message',
      text:
        `${String(parleyReachDropped)} principal(s) you may PARLEY are not on this list — the menu carries ` +
        `${String(MAX_PARLEY_AFFORDANCES)} at a time because your allowance is ` +
        `${String(PARLEYS_PER_RECKONING)} a Reckoning and a longer list is rows you cannot take. ` +
        `\`message {"to": "<principal>", "act": "offer", "text": "..."}\` is accepted for any of them, up to ` +
        `${String(MAX_REACH_ROWS)} reachable principals: ${[...parleyReachDroppedNames].sort(cmp).join(', ')}`,
    });
  }
  if (parleyGated > 0) {
    reasons.push({
      verb: 'message',
      text:
        `${String(parleyGated)} reachable principal(s) were dropped by the shared gate rather than by the cap ` +
        '— the same function `message {to}` itself runs, so the menu never publishes an address the verb ' +
        'would refuse (AGT-S2). `header.parley.rule` carries the reason',
    });
  }
  if (demandCapacitySpent) {
    // ── COUNTED, BECAUSE A MENU THAT SHRINKS WITHOUT SAYING WHY TEACHES THE WRONG RULE ──
    //
    // §9's capacity is the anti-toll-cartel price and it is only a price if the agent knows it
    // is being charged. An agent that saw `demand` yesterday and does not see it today, with no
    // sentence, will conclude that predation is unreliable rather than that it is rationed —
    // and will not plan the one decision the mechanic exists to force: WHICH target, given that
    // you get two.
    reasons.push({
      verb: 'demand',
      text:
      `every demand you could open is withheld because you have spent all ${String(AGGRESSION_PER_RECKONING)} ` +
        'of this Reckoning\'s aggression capacity (§9). It refreshes at the next Reckoning and does NOT ' +
        'accumulate: unspent capacity is gone, so a standing toll is unfundable by design, and the real cost ' +
        'of a demand is the other demand you gave up. Answering somebody else\'s standoff with `join` costs ' +
        'none of it',
    });
  }
  if (demandSilent) {
    // ── COUNTED, BECAUSE THE OTHER BRANCH IS THE ONLY ONE THAT EVER SPOKE ─────
    //
    // `demandCapacitySpent` above fires when the capacity is GONE. Holding all of it and being
    // offered no `demand` was the silent case, and it is the far more common one: a probe with
    // full capacity reported that it could not tell whether it had zero or whether the act was
    // being withheld for some other reason. `header.withheld` closes with "Nothing you were
    // eligible for has been dropped without this count", and that promise was false here.
    //
    // The count is 1 rather than one-per-neighbour for the same reason the branch above gives:
    // the thing withheld is the ACT, and there is exactly one of it.
    reasons.push({
      verb: 'demand',
      text:
      `no demand is offered even though you hold ${String(demandsLeft)} of ` +
        `${String(AGGRESSION_PER_RECKONING)} aggression capacity — the capacity is NOT what is stopping you ` +
        `(header.aggression carries the count, the expiry and tick ${String(demandOpenUntilTick)}, the last ` +
        'tick one may be opened this Reckoning). ' +
        (demandStages.length === 0
          ? 'You have no IDLE hand standing outside the Commons, and a demand is made of hands: `move` one ' +
            'to a Marches or Frontier system first — capacity buys nothing without presence (A4)'
          : demandCandidates === 0
            ? `No other principal's holding stands at ${demandStages.join(', ')}, where your IDLE hands are, ` +
              'and a demand names a principal at a place. Holdings are PUBLIC, so the map already tells you ' +
              'where somebody is standing; move a hand to one of those systems'
            : `${String(demandCandidates)} neighbour(s) were considered and every one was refused. ` +
              `Reason(s): ${[...demandRefusedWhy].sort(cmp).join(' · ')}`),
    });
  }
  // ── CAMPAIGNS, AND THIS BRANCH EXISTS BECAUSE `trade` DID NOT HAVE ONE ─────
  //
  // `withheld` closes with *"Nothing you were eligible for has been dropped without this count"*, and
  // that promise was measured false once: `trade` was silent in 497 of 576 observations across a
  // swept world, with a reachable venue in every one of them, and `agt-r5-reachability.test.ts` could
  // not catch it because it asks a GLOBAL question ("is every live verb offered somewhere") that
  // passes. The property that broke is per-observation. So a campaign that is not offered says which
  // of the three walls it hit, every time.
  if (campaignObjectives.length === 0 && campaignViews.every((c) => c.your_side === null)) {
    const holdingNow = world.holdingByPrincipal.get(principal) === undefined ? null : holdingOf(world, principal);
    reasons.push({
      verb: 'build',
      text:
        'no CAMPAIGN is offered. A campaign is the only way to take a claim from a holder that is PAYING its ' +
        'Charge, and it needs three things at once: your HOLDING standing outside the Commons, a CLAIMED ' +
        `system ONE LANE from it, and ${String(PULSE_MATERIEL_QTY)} of ${MATERIEL_GOOD} already standing where ` +
        'your holding is. ' +
        (holdingNow === null
          ? 'You have no holding at all'
          : tierOf(world.map, holdingNow.system) === 'COMMONS'
            ? `Your holding stands at ${holdingNow.system}, in the COMMONS, and a campaign's DEPOT may never be ` +
              'there (§16.6 MUST-1): the one place nobody may attack cannot also be the staging ground for ' +
              'attacking everywhere else. `graduate` moves it one lane outward'
            : `Your holding stands at ${holdingNow.system}. Its lane-neighbours are ` +
              `${neighboursOf(world.map, holdingNow.system).join(' · ')} — a campaign can only be aimed at one ` +
              'of those, and only while somebody holds a SUPPLIED or STRAINED claim on it. A CONTESTED claim is ' +
              'takeable free in the vulnerability window, so a campaign against one is refused rather than ' +
              'offered'),
    });
  }

  if (boardDropped > 0) {
    // The list this sentence is about is `ventures.board[]` itself, one level above the
    // affordances. It slices at `MAX_LIST_ROWS`, and until this branch existed the payload
    // closed with "nothing you were eligible for has been dropped without this count" while
    // holding back eligible slots — the engine contradicting `agent.md` §6 in the same
    // breath as the count that exists to prevent exactly that.
    reasons.push({
      verb: null,
      text:
      `${String(boardDropped)} further slot(s) you are eligible for are not on ventures.board[] at all, ` +
        `because one observation carries at most ${String(MAX_LIST_ROWS)} rows. The rows you did get are the ` +
        'ones a hand of yours can reach, sorted first for that reason; the rest come into view as these ' +
        'resolve, or sooner if you move a hand to a stage you are not standing at',
    });
  }
  // ── ★ `trade`, WHICH HAD NO ROW AT ALL AND WAS THE DEFECT THIS TAGGING FOUND ──
  //
  // A probe holding 200,000 currency and 40,116 `ration` in the MARCHES was offered no `trade`,
  // shown `market.transferable_minor: 0`, and given `withheld.count: 2` naming a venture slot
  // and `demand`. So the payload's closing promise was false, and the one field that could have
  // explained it was a bare zero beside a six-figure balance.
  //
  // Solved in `market/standing.ts` for the reason `boardFor` is solved once: the affordance
  // layer, the payload block and this row must agree about why a trade is impossible, and three
  // copies of that reasoning is what let this affordance gate a BID on `freeBalance` while
  // `planOrder` gated it on `freeCash`.
  //
  // Counted as one, like `demand`: the thing withheld is the ACT.
  const tradeSilent = !offerable.some((a) => a.verb === 'trade') && live.has('trade');
  const tradeWhy = tradeSilent
    ? tradeObstacles({
        ledger: runtime.ledger,
        world,
        book: runtime.market,
        principal,
        tick,
        books,
        venues,
        // The holding, because `move` needs a destination and "somewhere" is not one. Every
        // principal has exactly one (`holdingOf` throws otherwise), and it is the system the
        // agent's own stores stand at — so the sentence names a place it has a reason to be.
        homeVenue: holdingOf(world, principal).system,
      })
    : [];
  if (tradeWhy.length > 0) {
    reasons.push({ verb: 'trade', text: tradeWhy.join('; also ') });
  }

  // ── ★ PHASE 3'S RISK MARKET, OFFERED OR ACCOUNTED — NEVER SILENT ───────────
  //
  // `test/api/withheld-is-accountable.spec.ts` measures the *silence rate* of a verb against a
  // payload-readable trigger, and it exists because `trade` was silent in **497 of 576** observations
  // with a reachable venue in every one while `AGT-R5` stayed green. So the three risk acts arrive as
  // one call that returns both halves — the offers and a tagged row per omission — and a caller
  // cannot take the first without the second.
  //
  // Every ground here is an existing `WithheldGround` (`SHORT_FUNDS · WINDOW_SHUT · NO_RECORD ·
  // FROZEN`) rather than a fifth: an agent that has learned `SHORT_FUNDS` on a venture already knows
  // what it means over a COVER, and the union is a closed set checked against §3's canon.
  let riskWithheld = 0;
  for (const row of riskAffordances.withheld) {
    riskWithheld += 1;
    reasons.push({ verb: row.verb, text: row.text });
  }
  return {
    list,
    withheld: {
      count:
        dropped +
        notLive +
        alternateHands +
        rowsWithNoHand +
        rowsOutOfReach +
        boardDropped +
        crossingWithheld +
        crossingAnchored +
        worksWithheld +
        chargeNoHand +
        carryBlocked +
        auditNoClearance +
        clearanceOffersDropped +
        commonsBoundLanes +
        // ★ §16.12 #1. One per standoff whose RAIDER side was withheld, not one for the mechanic:
        // the thing withheld is an act at a place, and there is one of those per standoff.
        raiderJoinsBeyondSway +
        (grantSilent === null ? 0 : 1) +
        // ★ One per standoff the reader is a party to whose reinforcement route was empty.
        reinforcementSilent.length +
        (demandCapacitySpent ? 1 : 0) +
        (demandSilent ? 1 : 0) +
        (tradeWhy.length > 0 ? 1 : 0) +
        riskWithheld,
      verbs: [...new Set(reasons.map((r) => r.verb).filter((v): v is string => v !== null))].sort(cmp),
      reason:
        reasons.length === 0
          ? 'nothing was withheld: this is every legal act, with its full cost.'
          : `${reasons.map((r) => r.text).join('; ')}. Nothing you were eligible for has been dropped ` +
            'without this count, and withheld.verbs names which verbs it is about.',
    },
  };
}

/**
 * Escrow and elective a default-priced venture of this kind would need.
 *
 * Both come from `defaultTerms`, the runtime's single home of the pricing rule, so
 * the number an affordance shows and the number `create` actually charges are the
 * same arithmetic. A second copy here would be the engine and the agent-facing
 * surface disagreeing about money, which is scar #1 with a price tag.
 */
function probeEscrow(kind: VentureKind): Minor {
  let total = 0;
  for (const t of defaultTerms(kind, kindSpec(kind).baseYieldMinor)) total += t.escrowed;
  return minor(total);
}

function probeElective(kind: VentureKind): Minor {
  let total = 0;
  for (const t of defaultTerms(kind, kindSpec(kind).baseYieldMinor)) total += t.elective;
  return minor(total);
}

/**
 * **The roles a `create` will mint, on the affordance that mints them.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A blind probe created a `DIG` expecting one role and got **two** — DIGGER and TALLYMAN, at
 * different shares, with separate escrowed/elective splits. The affordance said nothing about
 * either, so the probe committed to obligations it was never shown, and the escrowed halves lock
 * on the create rather than on the fill.
 *
 * The engine knows the rule and already states it — **in a refusal somewhere else**:
 * `unhonouredCreateParam` tells an agent that sent `roles` that *"how many roles a venture has is
 * fixed by its kind: DIG, HAUL, ESCORT, SURVEY, RAID and LEVY carry 2, and BUILD and SIEGE carry
 * 4"*. A rule an agent can only learn by getting something wrong is a wiki with extra steps (A2),
 * and this is the consequence-preview pattern `worksQuote` and High Water's `projectedDrown`
 * already set: publish the shape of the thing **at the decision**, not after it.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Read from `kindSpec` and `defaultTerms` — the same two calls {@link probeEscrow} and
 * {@link probeElective} use, so the manifest and the two `max_*` figures on the same affordance
 * are one arithmetic. A second table here would be the engine and the agent-facing surface
 * disagreeing about a deal, which is scar #1 with roles attached.
 */
function probeRoles(kind: VentureKind): string {
  const spec = kindSpec(kind);
  const terms = defaultTerms(kind, spec.baseYieldMinor);
  const lines = spec.roles.map((role, i) => {
    const t = terms[i];
    if (t === undefined) return role.label;
    // The legend below denominates a `share` role. `wage` and `share` are mutually exclusive
    // (§7.1) and denominated differently — MINOR against bps — so a wage role names its own unit
    // inline rather than borrowing the legend's. `defaultTerms` produces only share roles today,
    // and this branch is what stops the legend from starting to lie on the day one does not.
    const claim = t.wage === null ? String(role.marginalOutputBps) : `wage ${String(t.wage)}`;
    return `${role.label} ${claim} → ${String(t.escrowed)} + ${String(t.elective)}`;
  });
  // The legend rides on EVERY row rather than moving to `CREATE_ROLE_RULE`, and the ~40 characters
  // are the cheapest in this change: numbers with the unit one row away is the shape
  // `one-word-two-units.spec.ts` catalogues nine times, and `share` (bps) sitting beside `escrowed`
  // (MINOR) on the same line is the exact adjacency that keeps producing it.
  return (
    `Roles minted: ${String(spec.roles.length)} (one principal each, never the same twice), as ` +
    `LABEL share-bps → escrowed + elective MINOR: ${lines.join(' · ')}.`
  );
}

/**
 * The half of {@link probeRoles} that is identical on every kind, carried by the FIRST offer only.
 *
 * The same trade `fill_role`'s worked example makes twenty lines up, for the same reason: five
 * `create` rows repeating one 200-character rule is a kilobyte of identical prose in a payload the
 * owner pays for (A4, §17), and the prioritiser keeps *the first offer of each verb* ahead of every
 * repeat — so the row that carries it is the one guaranteed to survive truncation. Nothing is
 * withheld by this: the per-kind figures, which are the part that differs, are on every row.
 */
const CREATE_ROLE_RULE =
  'The count is FIXED BY THE KIND and create refuses a `roles` parameter rather than dropping it, so ' +
  'every escrowed figure there is locked by THIS act and every elective figure there is one YOU are ' +
  'asked for at the Reckoning — one venture, several promises.';

/**
 * **`create` DOES NOT BIND, AND IT NEVER SAID SO.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A play-tester ran four identities for two Reckonings, created eleven ventures, had nine of them
 * fully staffed by real counterparties, and watched all eleven die ABANDONED with
 * `i_have_signed: false`. Its conclusion was that `sign` is missing from the menu. **`sign` is on the
 * menu** — it is the FIRST row of the very next observation, with copy-pasteable params. What was
 * missing is *this sentence*: the act that creates the obligation to countersign never mentioned that
 * a countersignature exists, was required, or had a deadline.
 *
 * A creator therefore had to already know the rule to keep its own venture alive, and `agent.md` is
 * not an interface — HIGH-WATER scar #1 is that the affordance strings ARE the rules surface. Every
 * word an agent needs to not lose a venture has to be reachable from the act it is about to take.
 *
 * The deadline is arithmetic and therefore exact (A2): the action lands next tick, and the window is
 * {@link FORMATION_WINDOW_TICKS} from there. It is stated as an absolute tick because a relative one
 * is a subtraction the agent has to get right against a clock it reads separately.
 *
 * Paired with, and NOT a substitute for, `FORMATION_WINDOW_TICKS` 12 → 24. Telling an agent about a
 * deadline it cannot be awake for is a better error message, not a fix; the constant is what makes
 * the sentence actionable, and this is what makes the constant discoverable.
 * ══════════════════════════════════════════════════════════════════════════
 */
function countersignWarning(tick: number): string {
  // `create` resolves at tick+1 and the window opens there — `Runtime.vCreate`'s `opens = ctx.tick`.
  const closes = tick + 1 + FORMATION_WINDOW_TICKS;
  return (
    '★ THIS DOES NOT BIND ANYONE YET. A venture goes live only when every party has countersigned the ' +
    'same terms_hash, and that includes YOU: `sign` will be the first row of your next observation, ' +
    `carrying this venture's id and hash ready to send. Countersign by tick ${String(closes)} or the ` +
    'window closes and it is retired ABANDONED — your escrow comes back and no default is recorded, ' +
    'but the deal, the counterparties who filled its roles and the standing you would have earned are ' +
    'all gone. Observe again before then; that is what the wake is for.'
  );
}

// ── Rows ────────────────────────────────────────────────────────────────────

/**
 * One open slot, and **everything needed to both fill it and close it.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THIS ROW IS THE RECRUITING SURFACE AND IT USED TO BE UNCLOSEABLE.**
 *
 * Gate 3 measured `elective declines / elective roles settled` as `0/0`: across ~300
 * ticks and 668 actions nothing settled at all, and one probe's first sixteen ventures
 * died at window close "not one on price — every single one on a missing
 * countersignature". The cause is arithmetic in this interface.
 *
 * A fill is a *request*, allocated at tick close (PROP-V8), and the venture stays
 * `FORMING` until every party has countersigned the **same `terms_hash`** (§7.3). This
 * row carried no `terms_hash`, so a filler had to spend a **second wake** to read it out
 * of `ventures.mine[]` before it could sign — inside a `FORMATION_WINDOW_TICKS` of 12,
 * on a budget of `WAKES_PER_RECKONING` 16 over `TICKS_PER_RECKONING` 288, which is one
 * wake every 18 ticks. **A filler playing inside the documented wake budget could not
 * close a deal.** The creator could, because `create` handed it the hash.
 *
 * So the row carries the hash and the echo. `POST /act` is *not* wake-gated — only
 * observation freshness is (§12.4) — so with both values in hand the filler sends
 * `fill_role` in its wake and `sign` on the next tick without a second observation.
 * ══════════════════════════════════════════════════════════════════════════
 */
interface BoardRow {
  readonly venture: VentureId;
  readonly role: number;
  readonly label: string;
  readonly kind: string;
  readonly stage: SystemId;
  /**
   * Who **pays** the elective half of this role, and therefore whose record decides
   * whether `elective` below is money or a story. `counterparties[]` carries its
   * standing, and `agent.md` §12 advice #5 ("look at last_default before you trust
   * someone") is only followable from the board if the board names who to look up.
   */
  readonly creator: PrincipalId;
  /**
   * The grant a **delegate** bound the creator under, or null when the creator committed itself.
   *
   * The elective half of this role is paid by `creator`, and a creator that was bound by somebody
   * else's act is a materially different counterparty from one that signed its own terms: it may not
   * be awake, it did not price this deal, and what it agreed to was a set of LIMITS rather than this
   * venture. `counterparties[]` carries its standing; this says whose decision it actually was.
   *
   * Publishes nothing an agent could not already read — §11.2 puts a grant's parties at `PUBLIC`
   * (D9a) and `venture.formed` carries the grant id on a public row.
   */
  readonly creator_bound_by_grant: string | null;
  /** ★ The delegate that bound `creator`, or null. See `VentureRecord.actedBy` (A5′). */
  readonly creator_acted_by: string | null;
  readonly wage: number | null;
  readonly share: number | null;
  readonly escrowed: number;
  readonly elective: number;
  /**
   * **The proportion of this slot that is a PROMISE rather than an execution**, in bps.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THIS IS THE NUMBER THE WHOLE PREMISE TURNS ON, AND IT USED TO BE A CONSTANT.**
   *
   * `create` now takes `elective_bps`, so a creator chooses anywhere inside the kind's published band
   * — and *that* is what makes reading a counterparty's record worth an action. A filler weighing a
   * 40%-elective offer from an agent with 22 kept promises against a 25%-elective offer from an agent
   * with a default is making the decision §1 says this game is about. It cannot make it if the two
   * offers are identical by construction, which they were.
   *
   * `escrowed` and `elective` are already here in minor, and the ratio is derivable from them — but
   * A2 requires known arithmetic be *exact and machine-readable* on the surface where the decision
   * happens, and §7.5 says the escrow ratio is published on the card, not inferred from it.
   * ══════════════════════════════════════════════════════════════════════════
   */
  readonly elective_bps: number;
  /** The complement: §7.5's *"the escrow ratio is published on the venture card"*, as an integer. */
  readonly escrow_ratio_bps: number;
  /**
   * Ticks this slot will hold a hand — the OPPORTUNITY COST of filling it.
   *
   * Distinct from `resolves_at_tick`, which is the same instant read as *when it pays*. Measured
   * bimodal: median 11, p90 276, against a 288-tick Reckoning, because a venture resolves at a
   * Reckoning boundary. Filling early costs a third of your capacity for a cycle; filling late costs
   * almost nothing. See `D19-*.md`.
   */
  readonly hand_committed_ticks: number;
  /**
   * What **this slot** pays whoever fills it, at p50 — and the number to echo on `sign`.
   *
   * It used to be `yourTakeAtP50(venture, reader)`, which returns zero when the reader
   * holds no role — true of every board row by construction. So the price of a seat read
   * `0` at the decision point and became correct only once the choice was irreversible:
   * *"the recruiting surface tells every newcomer that every seat pays nothing."*
   *
   * **The echo is only valid once the fill has been granted.** `countersign` compares it
   * against `yourTakeAtP50(venture, you)`, which is still zero while you hold no role, so
   * a signature sent in the *same* tick as the fill is refused on PROP-V3. That is the
   * whole reason `fill_role`'s `what_it_forecloses` names the next tick.
   */
  readonly your_take_at_p50: number;
  /** The hash to countersign, and the second half of what closing a deal needs. */
  readonly terms_hash: string | null;
  readonly expires_tick: number;
  readonly resolves_at_tick: number;
}

/**
 * Only slots this principal is eligible for (§12.1: server-side eligibility
 * filtering). "One principal fills at most one role", so a venture it already
 * holds a role in is filtered out here rather than refused later.
 *
 * Returns the rows **and how many the cap dropped**, because `header.withheld` closes with
 * *"Nothing you were eligible for has been dropped without this count"* and the `.slice()`
 * below made that sentence false: measured at 36 eligible slots, 24 served, 12 gone with
 * `withheld.count` naming none of them. `agent.md` §6 says "we never truncate this list",
 * so an uncounted drop here is the engine and the document disagreeing about a rules
 * surface — scar #1's shape, on the recruiting surface a newcomer reads first.
 */
function boardFor(
  runtime: Runtime,
  principal: PrincipalId,
  tick: number,
): { readonly rows: BoardRow[]; readonly dropped: number } {
  const rows: BoardRow[] = [];
  for (const venture of runtime.ventures.live()) {
    if (venture.state !== 'FORMING') continue;
    if (tick > venture.windowClosesTick) continue;
    if (roleOfPrincipal(venture, principal) !== null) continue;
    for (const index of openIndices(venture)) {
      const role = venture.roles[index];
      if (role === undefined) continue;
      rows.push({
        venture: venture.id,
        role: index,
        label: role.label,
        kind: venture.kind,
        stage: venture.stage,
        creator: venture.creator,
        creator_bound_by_grant: venture.boundByGrant,
        // The counterparty fact that goes with it: WHO put the creator on the hook. A filler
        // deciding whether to trust the elective half is deciding about two principals, and the row
        // named one of them.
        creator_acted_by: venture.actedBy,
        wage: role.terms.wage,
        share: role.terms.share,
        escrowed: role.terms.escrowed,
        elective: role.terms.elective,
        // `escrowRatioBps` is the venture module's own function, not a division written here: the
        // number on the recruiting surface and the number §7.5 puts on the card have to be one
        // number, and the ratio is truncated there on purpose (a ratio shown one bp high reads as
        // more secured than it is).
        escrow_ratio_bps: escrowRatioBps(role.terms),
        elective_bps: BPS_ONE - escrowRatioBps(role.terms),
        // The slot's claim, not the reader's. Same arithmetic settlement will run.
        your_take_at_p50: slotClaimAt(venture, index, 'p50').claim,
        terms_hash: venture.termsHash,
        expires_tick: venture.windowClosesTick,
        resolves_at_tick: venture.resolvesAtTick,
        /**
         * How long filling this slot takes a hand out of play — **the cost, stated as a cost.**
         *
         * `resolves_at_tick` was already here and is the same instant, but it answers *when the
         * venture pays*. That is a different decision from *how long my hand is gone*, and an agent
         * optimising pay-per-action has no reason to compute the second from the first.
         *
         * Measured 2026-07-26 across 239 completed commitments: the distribution is **bimodal** —
         * median 11 ticks, p90 **276**, against a 288-tick Reckoning. Because a venture resolves at
         * `nextSettlementAtOrAfter(...)`, i.e. at a Reckoning boundary, a hand committed early in the
         * cycle is held until the cycle ENDS and one committed late is free in a few ticks. Same act,
         * same kind, same pay, a ~25x difference in what it costs you.
         *
         * The consequence was measurable all the way out: members who fill early go inert for a
         * Reckoning, so the principals still acting are whoever filled late or not at all, so creation
         * concentrates in those few (an 11x activity spread), so the board shows one or two sellers,
         * so `AGT-E2` has no competing offers to price trust against. One underived number sat under
         * the design's second falsification gate.
         */
        hand_committed_ticks: Math.max(0, venture.resolvesAtTick - tick),
      });
    }
  }
  // **Reachable slots first, then canonical id order.** The list is capped at
  // `MAX_LIST_ROWS`, and a cap over an arbitrary order can hide the only slot this
  // principal could actually fill behind twenty-three it cannot reach. Reachability is a
  // fact about the world computed the same way twice, so the order is still byte-stable
  // within a tick (PROP-O6) — it is a priority, not a shuffle.
  const reach = new Set<SystemId>();
  for (const hand of handsOf(runtime.world, principal)) {
    if (hand.state === 'IDLE' && isPresent(hand, tick)) reach.add(hand.location);
  }
  const sorted = rows.sort(
    (a, b) =>
      Number(reach.has(b.stage)) - Number(reach.has(a.stage)) ||
      cmp(a.venture, b.venture) ||
      a.role - b.role,
  );
  return {
    rows: sorted.slice(0, MAX_LIST_ROWS),
    dropped: Math.max(0, sorted.length - MAX_LIST_ROWS),
  };
}

/**
 * The one home of *"when does this venture pay"*, in the three states it can be asked in.
 *
 * A branch rather than a stored field, because the answer for a `DEFERRED` venture is a
 * function of the clock and would go stale the moment it was written down. Derived from
 * `nextSettlement`, which is the same call the header's `next_reckoning` uses, so the row and
 * the clock cannot disagree about the tick a settlement lands on.
 */
function ventureResolvesAt(venture: VentureRecord, tick: number): number | null {
  // `tick + 1`, not `tick`. `nextSettlement` is at-or-after, and a venture is deferred *during*
  // a settlement tick's own processing — so on that tick `nextSettlement(tick)` returns the tick
  // that just failed to settle it, which is the same class of false forward-looking fact this
  // function exists to remove, in a one-tick window.
  if (venture.state === 'DEFERRED') return nextSettlement(tick + 1);
  if (isLive(venture)) return venture.resolvesAtTick;
  return null;
}

function ventureRow(
  runtime: Runtime,
  venture: VentureRecord,
  principal: PrincipalId,
): Readonly<Record<string, unknown>> {
  const role = roleOfPrincipal(venture, principal);
  // Once per row, not once per field: each `electiveCeilingOfRole` inside it runs
  // `computeProceeds` + `computeClaims`, and this row is emitted up to `MAX_LIST_ROWS`
  // times per observation (A4 — a bigger payload must not cost the server more per read
  // than the information in it is worth). It is also read three times below — the figure,
  // the unelected remainder and the direction they decide — and three calls would be three
  // chances to disagree about one obligation.
  //
  // ── ★ A TERMINAL VENTURE OWES NOTHING, AND THIS ROW USED TO SAY IT DID ──────
  //
  // `creatorElective` never reads `venture.state` — its only filters are "am I the creator" and
  // "is this role mine". So on an ABANDONED venture, where `settledElectiveMinor` is still 0
  // because nothing ever settled, it returns the **full p90 ceiling** as if it were live debt.
  //
  // Measured by a play-tester: one identity finished a Reckoning with 11/11 ventures ABANDONED and
  // `my_elective_owed` totalling **49,920 it does not owe**; another read 26,400 on an abandoned
  // BUILD a full Reckoning after it died. Standing correctly recorded **0 defaults** — the engine
  // was right and only the surface lied, which is the worst version of this because the number is
  // exactly the shape of a real obligation and a creator cannot budget by summing the field.
  //
  // The gate is `ELECTABLE_VENTURE_STATES` and not a hand-written state list on purpose: it is the
  // SAME constant the `elect` affordance loop reads. This field's own docstring promises it is
  // *"Σ of the `max_direct_loss` on this venture's `elect` affordances, by construction"* — a
  // promise that was false on precisely the terminal states, since the affordance loop skips them
  // and this did not. Two builders, one question, two answers (`sign`'s `max_direct_loss` had the
  // same shape). Sharing the constant is what makes the sentence structurally true rather than
  // true-until-someone-edits-one-of-them.
  const owedByMe = ELECTABLE_VENTURE_STATES.includes(venture.state)
    ? creatorElectiveOf(runtime, venture, principal)
    : { owed: minor(0), unelected: minor(0), ceiling: minor(0) };
  return {
    id: venture.id,
    kind: venture.kind,
    state: venture.state,
    stage: venture.stage,
    creator: venture.creator,
    terms_hash: venture.termsHash,
    /**
     * ★ **WHEN THIS PAYS — `null` WHEN THE ANSWER IS "NEVER".**
     *
     * ══════════════════════════════════════════════════════════════════════════
     * This was `venture.resolvesAtTick` unconditionally, on every state, and it produced the
     * first false forward-looking fact a probe has ever caught on this surface. The probe that
     * reached a settlement — the first one that ever has — read:
     *
     *     "state": "ABANDONED", "resolves_at_tick": 287,
     *     "countersigned": [...], "i_have_signed": true
     *
     * planned around that settlement, waited for it, and nothing happened. **Every field there
     * is individually accurate** — `resolvesAtTick` is a stored value and the signatures are a
     * true record of who signed while it was live — and together they state a false fact about
     * the future. Same shape as `market.transferable_minor: 0` beside a six-figure balance: a
     * number true in isolation and misleading in place.
     *
     * Three branches, because there are three honest answers and the old field gave one:
     *
     *   - **terminal** (`SETTLED`/`DEFAULTED`/`ABANDONED`) → `null`. Nothing is coming.
     *     {@link resolved_at_tick} carries when it happened, and `state` says what happened.
     *   - **`DEFERRED`** → the **next** settlement tick, not the stored one. §15.3's cascade
     *     re-enters a deferred venture at the next Reckoning (`venture/book.ts` selects
     *     `LIVE || DEFERRED` with `resolvesAtTick <= tick`), so the stored tick is in the past
     *     and the true answer is a tick nobody was publishing.
     *   - **`FORMING`/`LIVE`** → unchanged.
     * ══════════════════════════════════════════════════════════════════════════
     */
    resolves_at_tick: ventureResolvesAt(venture, runtime.engine.tick),
    /** The tick it actually resolved at, or `null` while it has not. The other half. */
    resolved_at_tick: venture.resolvedAtTick,
    /**
     * The signing window, `null` once it can no longer be signed.
     *
     * The same defect one field over, and it is worse than its neighbour rather than better:
     * `countersign` refuses outright once the venture is not LIVE (`PROP-V6`), so a closed
     * record publishing a signing deadline invites an agent to spend an action on a refusal —
     * AGT-S2, from a field rather than from an affordance.
     */
    window_closes_tick: isLive(venture) ? venture.windowClosesTick : null,
    pinned_value: pinnedValue(venture),
    /**
     * ══════════════════════════════════════════════════════════════════════════
     * ★ **`elective` IS THE PINNED PRICE AND IT IS NOT THE BILL. `elective_ceiling` IS THE BILL.**
     *
     * A blind player budgeted off this row and defaulted. The row said `elective: 2100`; the `elect`
     * affordance for the same role said `max_direct_loss: 3360`. Second role: 900 here, 1,440 there.
     * Both reproduce exactly, and neither figure was wrong — they answer different questions and
     * only one of them had a name.
     *
     * `elective` is `RoleTerms.elective`, written once at creation by `pricedRoles` and never
     * mutated: **the price the creator offered.** But a share role's due is a fraction of *proceeds*,
     * so a venture that over-performs owes more than the pinned figure — §7.1's trap. The affordance
     * publishes `electiveCeilingOf`, which draws proceeds at the **p90** residual and subtracts what
     * has already settled, and `runtime.ts` says in as many words that `max_direct_loss` *"is exact,
     * not an estimate, so this cannot be the pinned `role.terms.elective`"*.
     *
     * `venture/preview.ts` already had the vocabulary and the warning: *"One word per concept: that
     * is the PRICE, this is the BOUND, and the whole defect was one standing in for the other."*
     * The defect was that the BOUND had no field on the row an agent budgets from — so the row
     * published the p50 and the affordance charged the p90, one method apart, which is the same shape
     * as `elect`-charges-p90-while-`create`-quotes-p50. Both are here now, both named, and
     * `test/api/observe-gate3.test.ts` pins the row's ceiling to the affordance's `max_direct_loss`
     * so they can never drift again.
     * ══════════════════════════════════════════════════════════════════════════
     */
    roles: venture.roles.map((r) => ({
      index: r.index,
      label: r.label,
      filled_by: r.filledByPrincipal,
      escrowed: r.terms.escrowed,
      /** The PRICE, pinned at creation and never updated. Not what settlement can charge. */
      elective: r.terms.elective,
      /**
       * ★ **THE BOUND — the most this role's elective half can cost the creator, exact.**
       *
       * The SAME arithmetic as the `elect` affordance's `max_direct_loss` (`electiveCeilingOf`), net
       * of {@link elective_settled}. **Budget from this, never from `elective`.**
       */
      elective_ceiling: runtime.electiveCeilingOf(venture, r.index),
      /** Already paid on this role by a prior or deferred settlement. Deducted from the ceiling. */
      elective_settled: r.settledElectiveMinor,
      // §7.5: "the escrow ratio is published on the venture card". It became worth publishing the
      // moment `create` took `elective_bps` — before that it was the same number on every venture in
      // the world, which is why nothing read it.
      escrow_ratio_bps: escrowRatioBps(r.terms),
    })),
    my_role: role === null ? null : role.index,
    my_escrowed: role === null ? 0 : role.terms.escrowed,
    my_elective: role === null ? 0 : role.terms.elective,
    /** The bound on the role YOU hold: at most this much can come TO you. Zero if you hold none. */
    my_elective_ceiling: role === null ? 0 : runtime.electiveCeilingOf(venture, role.index),
    /**
     * Direction, because `my_elective` alone was read two opposite ways by capable
     * agents — one thought a filler *owes* it. The elective on a role YOU hold is paid
     * TO you by the venture's **creator** (the payer), if the creator honours it; you
     * never elect it, the creator does. So it is `OWED_TO_ME` when you filled someone
     * else's venture. On your OWN venture your own role is self-paid and can never be a
     * breach (scar #9), so it is `SELF`.
     *
     * ── ★ AND `OWED_BY_ME`, WHICH USED TO BE `null` ────────────────────────────
     *
     * This docstring used to end *"What YOU owe as a creator is never here — it is the
     * `elect` affordances."* The consequence, measured from a real signed seat: a creator
     * that filled none of its own roles — the ordinary case — read `my_elective: 0` and
     * `my_elective_direction: null` on the venture whose entire elective half it was about
     * to be judged on. The row that names every other party's stake in the promise named
     * the promisor's as *nothing*, and `null` reads as "no elective relationship here"
     * rather than as "the field does not cover your case".
     *
     * `SELF` still wins where the reader holds a role, because that is what `my_elective`
     * on this row describes and the two fields must agree. What the creator owes is
     * {@link my_elective_owed}, which is populated in both cases.
     *
     * ── WHY NOT "A LIABILITY OUTRANKS A RECEIVABLE" (RESOLVED AT MERGE) ────────
     *
     * Version 37's branch reached this same defect independently and fixed it by testing
     * the liability **first**, so a creator that also holds a role of its own reads
     * `OWED_BY_ME` rather than `SELF`. That ordering was not taken, for one reason: this
     * field annotates {@link my_elective}, and on such a row `my_elective` is the reader's
     * OWN self-paid share — so `OWED_BY_ME` there would describe a number that is not on
     * the row, which is scar #1's shape in a direction field. The concern behind the flip
     * — that the liability must not be hidden — is met by {@link my_elective_owed} and
     * {@link my_elective_unelected}, which are populated in **every** case and which that
     * branch did not have. One word per concept (§3): direction describes `my_elective`.
     */
    my_elective_direction:
      role === null
        ? owedByMe.owed > 0
          ? 'OWED_BY_ME'
          : null
        : venture.creator === principal
          ? 'SELF'
          : 'OWED_TO_ME',
    /**
     * ★ **What THIS venture can ask YOU for on the elective half** (A7's paying side).
     *
     * Zero unless you created it. See `venture/preview.ts:creatorElective` for why it is
     * the **charge** (`electiveCeilingOfRole`, summed over roles somebody else holds) and
     * not the pinned `roles[].elective`: those two differ by ~60% on a live world, and
     * `elect`'s own `max_direct_loss` is computed from the former. This field is Σ of the
     * `max_direct_loss` on this venture's `elect` affordances, by construction — so an
     * agent that reads the row and an agent that reads the affordances are quoted one
     * number, and a freeze or a wakeless snapshot no longer hides it.
     */
    my_elective_owed: owedByMe.owed,
    /**
     * ★ **How much of {@link my_elective_owed} you have not elected yet** — the part that
     * becomes a permanent public default if this settles unchanged.
     *
     * The same arithmetic `briefing.prompt` and `if_you_do_nothing` publish in aggregate
     * (`unelectedElective` is now a projection of the same call), narrowed to this row so
     * a creator with several live ventures can tell **which** one still needs an `elect`.
     */
    my_elective_unelected: owedByMe.unelected,
    countersigned: [...venture.countersigned].sort(cmp),
    i_have_signed: venture.countersigned.has(principal),
    /**
     * The grant that stood in for the creator's countersignature, or null.
     *
     * On a venture **you** created through a delegate, this is the answer to "why is my name in
     * `countersigned` when I never signed anything": your grant is the consent, and a delegated
     * `create` binds you at formation (`venture/create.ts`). A grantor that reads its own name here
     * and cannot see why would reasonably file a discrepancy — which is exactly what a probe did
     * about a different silent behaviour, and the remedy each time is to say the reason on the row.
     *
     * On somebody else's venture it is the fact worth having before you fill a role in it: the
     * principal on the hook for the elective half did not personally agree to this deal.
     */
    bound_by_grant: venture.boundByGrant,
    /**
     * ★ **Who bound you**, or null (A5′).
     *
     * A blind probe read this row back on a `DEFAULTED` venture it had never created and never
     * signed, saw `creator` and `countersigned` naming *itself*, and found no field anywhere that
     * named the delegate that had acted — the only road to it was resolving `bound_by_grant`
     * against `grants.granted[]`, a table inside the victim's own private observation. The record
     * is the product; it named the wrong principal.
     */
    acted_by: venture.actedBy,
    projected_settlement: yourTakeAtP50(venture, principal),
    talks: runtime.talksFor(principal).filter((t) => t.venture === venture.id).length,
  };
}

/**
 * Only agents named above (§12.1). A counterparty list that named everyone would
 * be a directory, and a directory is a Sybil-scouting tool rather than a decision
 * aid.
 */
function counterpartiesFor(
  runtime: Runtime,
  principal: PrincipalId,
  mine: readonly VentureRecord[],
  board: readonly BoardRow[],
  tick: number,
): Readonly<Record<string, unknown>>[] {
  const named = new Set<PrincipalId>();
  for (const venture of mine) {
    named.add(venture.creator);
    for (const role of venture.roles) {
      if (role.filledByPrincipal !== null) named.add(role.filledByPrincipal);
    }
  }
  for (const row of board) named.add(row.creator);
  // Everyone the reader may PARLEY, because `affordances[]` names each of them by id — so they are
  // "agents named above" in §12.1's sense, and a standing line is exactly what an agent needs
  // before it answers a stranger's offer of 20,000 a hand.
  const reach = runtime.reachFor(principal, tick);
  for (const row of reach) named.add(row.principal);
  named.delete(principal);

  // The mail, indexed once so the map below stays linear over the ring.
  const inbound = new Map<PrincipalId, { readonly count: number; readonly last: ParleyRead }>();
  // ══════════════════════════════════════════════════════════════════════════
  // ★ **AND THE OUTBOUND HALF, WHICH LEFT NO TRACE ANYWHERE.**
  //
  // A blind player sent a PARLEY and could find no evidence of it in its own observation:
  // `last_parley` null, `parleys_received: 0`, nothing in `talks[]` (that ring is venture-scoped and a
  // parley has no venture). The only signal was `header.parley.parleys_remaining` dropping 3 → 2 —
  // *"wrong instrumentation for a 3-per-Reckoning resource that expires unspent."*
  //
  // `parleysVisibleTo` already returns both directions (`e.to === reader || e.from === reader`), and
  // the line below discarded one of them. A sent parley is a spent, non-refundable action against a
  // capped budget, and an agent that cannot see which ones it spent cannot tell "I already wrote to
  // them" from "I meant to" — so it either doubles up and wastes the budget, or waits on a reply to a
  // message it never actually sent. A9 is untouched: this is the reader's own outbox.
  // ══════════════════════════════════════════════════════════════════════════
  const outbound = new Map<PrincipalId, { readonly count: number; readonly last: ParleyRead }>();
  for (const entry of runtime.parleysVisible(principal, tick)) {
    const read: ParleyRead = {
      act: entry.act,
      text: entry.text,
      tick: entry.tick,
      publishes_at_tick: entry.revealsAtTick,
    };
    if (entry.to === principal) {
      const prior = inbound.get(entry.from);
      inbound.set(entry.from, { count: (prior?.count ?? 0) + 1, last: read });
    } else if (entry.from === principal) {
      const prior = outbound.get(entry.to);
      outbound.set(entry.to, { count: (prior?.count ?? 0) + 1, last: read });
    }
  }

  // The PAIRWISE record, indexed once. `standingRow` carries a principal's record with EVERYBODY;
  // this is its record with YOU, and they are different facts that were reported as one.
  const pairwise = new Map(runtime.relationsFor(principal, MAX_LIST_ROWS * 2).map((r) => [r.other, r]));

  return [...named].sort(cmp).map((other) => {
    const reachRow = reach.find((r) => r.principal === other);
    const mail = inbound.get(other);
    const sent = outbound.get(other);
    const pair = pairwise.get(other);
    return {
      ...standingRow(runtime, other),
      /**
       * ★ **ITS RECORD WITH *YOU*** — four counts, and the only ones `grant`'s shortlist reads.
       *
       * ══════════════════════════════════════════════════════════════════════
       * `standing.*` above is this principal's record with EVERYBODY, and that is not the question an
       * agent asks before it hands somebody an office. `Runtime.grantCandidates` gates the A6 core
       * loop on `relation.kept > 0` — *has this principal honoured an elective half **to me*** — and
       * that count was published **nowhere**. It appeared once, inside the `grant` affordance's own
       * prose (*"They have kept N promise(s) to you"*), which is exactly the affordance the gate
       * suppresses. So the input to the game's core loop was legible only in the offer it decided.
       *
       * A blind player went 21 observations with no `grant` offer and could not have worked out why
       * from the payload; the `withheld` row now names the rule and this is the field it names.
       * `PUBLIC` on the tier it already had — every term is a settled venture's `ELECTIVE_HONOURED`
       * or `DEFAULTED` row, and the frame draws both.
       * ══════════════════════════════════════════════════════════════════════
       */
      with_me: {
        /** Elective halves IT honoured to YOU. `grant`'s shortlist is `kept_to_me > 0`. */
        kept_to_me: pair?.kept ?? 0,
        /** Elective halves it DECLINED to you. A default on the record, naming it. */
        broke_to_me: pair?.broke ?? 0,
        /** Elective halves YOU honoured to it — the same question, the other way. */
        i_kept: pair?.youKept ?? 0,
        i_broke: pair?.youBroke ?? 0,
      },
      /**
       * Why this principal is addressable, or `null` when it is not (an ordinary counterparty from a
       * venture you share). Named rather than implied: "you may talk to it" and "you have dealt with
       * it" are two different relationships, and one list that did not distinguish them would be a
       * field an agent reads as trust when it means proximity.
       */
      parley_reach: reachRow === undefined ? null : { why: reachRow.why, about: reachRow.about },
      /**
       * What it has actually said to you. **Present at zero**, because an absent field and a field
       * reading zero are the same thing to a reader that has never seen one — and "nobody has written
       * to me" has to be sayable.
       *
       * A9: this is the reader's own mail, which is the one thing a party sees ahead of the audience.
       * `publishes_at_tick` on each is the tick every agent and every viewer read it together.
       */
      parleys_received: mail?.count ?? 0,
      last_parley: mail?.last ?? null,
      /**
       * ★ **What YOU have said to IT** — the outbox, which did not exist.
       *
       * Present at zero for the same reason {@link parleys_received} is: an absent field and a field
       * reading zero are the same thing to a reader that has never seen one, and *"I have not written
       * to this one yet"* is the fact a capped budget is spent against. `header.parley` carries how
       * many you have left; this carries where the spent ones went.
       */
      parleys_sent: sent?.count ?? 0,
      last_parley_sent: sent?.last ?? null,
    };
  });
}

/** One inbound parley, as a counterparty row carries it. */
interface ParleyRead {
  readonly act: string;
  readonly text: string;
  readonly tick: number;
  readonly publishes_at_tick: number;
}

/**
 * One principal's public record, in the one shape used for everybody including the reader.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THIS WAS A HARDCODED ZERO WHILE A LIVE `StandingBook` SAT BESIDE IT.**
 *
 * `Runtime.standing` is real, it is the only writer of standing (INV-21), and nothing
 * read it. Four consequences, all of which Gate 3's probes hit:
 *
 *   - `agent.md` §12 advice #5 — "look at `counterparties[].last_default` before you trust
 *     someone" — was **unfollowable by construction**, because the field was the literal
 *     `null` for a serial defaulter and for a saint alike.
 *   - Every probe's "every standing vector is still 0" was reading a constant, not a
 *     world. A constant that looks like data is worse than a missing field.
 *   - `AGT-E2` — *is trust priced?* — is the spread between what a high-standing
 *     counterparty is paid and what a defaulting one is paid. **Unanswerable** while the
 *     inputs are the same five zeros for everyone.
 *   - §13's "report a default recorded against you" is incoherent while an agent cannot
 *     see its own record. Hence the header's own row.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * **Zeros here are facts, not a clean bill of health**, and the distinction is real: a
 * principal with no journal entries genuinely has honoured nothing, defaulted on nothing
 * and dealt with nobody. `elective_honoured: 0` beside `distinct_counterparties: 0` is
 * *unproven*, which `agent.md` §4 already teaches ("a fully escrowed venture earns you a
 * performance record and **zero** trust"). What it must never be is a *constant*.
 */
function standingRow(runtime: Runtime, who: PrincipalId): Readonly<Record<string, unknown>> {
  const row: Standing = runtime.standing.row(who);
  return {
    principal: who,
    /** The public factual vectors, never a score (§3). */
    standing: {
      elective_honoured: row.electiveHonoured,
      elective_honoured_value: row.electiveHonouredValue,
      defaults: row.defaults,
      contradicted_seals: row.contradictedSeals,
      distinct_counterparties: row.distinctCounterparties,
    },
    /**
     * The bond this principal actually has posted — read from the same `bondView` the holder's own
     * `holding.bond` reads, so the two cannot disagree.
     *
     * This was hardcoded `0` behind the comment *"Zero because bonds do not exist yet (§6.4), not
     * because none was posted."* Bonds exist: `post_bond` is live and slashable. So a probe agent
     * posted 50000, saw `holding.bond.posted: 50000` and `header.standing.bond_posted: 0` in the
     * SAME observation, and reported the contradiction. Because `standingRow` also builds
     * `counterparties[]`, every agent was pricing every other agent's bond at zero — slashable
     * capital, the one thing A15 says a gate may cost, invisible to the agents meant to price it.
     *
     * A9 settles the visibility question rather than my judgement: the spectator frame already
     * publishes `bondAtRisk` per claim, and A9 forbids the client showing a live fact an agent's own
     * `observe` would not. A hardcoded zero here broke parity in the agent's disfavour.
     */
    bond_posted: runtime.bondView(who).posted,
    sureties: [],
    /** The tick of the latest recorded default, or null. A stamp, never a count. */
    last_default: row.lastDefaultTick,
  };
}

/**
 * One grant, as the reader sees it (SPEC §8, A6). Both roles read the same row so a
 * grantor's `granted[]` and a delegate's `held[]` cannot describe one grant two ways.
 *
 * `spent` and `headroom` are the point of surfacing this at all: a grantor watches how
 * much of the worst case it authorised a delegate has actually drawn — "an offline agent
 * is exposed, and the audience can see by how much" (§8.1) — and a delegate reads the
 * headroom it has left before its next on-behalf act is refused.
 */
function grantView(
  runtime: Runtime,
  grant: Grant,
  tick: number,
  reader: PrincipalId,
): Readonly<Record<string, unknown>> {
  const headroom = runtime.grants.headroom(grant.id);
  return {
    id: grant.id,
    grantor: grant.grantor,
    delegate: grant.delegate,
    template: grant.template,
    max_direct_loss: grant.maxDirectLoss,
    max_contingent_liability: grant.maxContingentLiability,
    spent_direct: grant.spentDirect,
    spent_contingent: grant.spentContingent,
    headroom_direct: headroom.direct,
    headroom_contingent: headroom.contingent,
    /**
     * ★ **The verb fence** — which acts this grant delegates (SPEC §8, §16.12 #3).
     *
     * `PARTIES`, and this key is where that tier is served: §11.2 D9a puts a grant's
     * *operational detail* — "which verbs, over which resources, with which approvals" — at
     * `PARTIES` because it is "how a principal actually runs its house", while the LIMITS are a
     * public price. Both principals bound by the grant read it here; nobody else does, and the
     * `PUBLIC` `grant.issued` row deliberately omits it.
     */
    verbs: [...grant.verbs],
    /**
     * ★ **The clearance** — which COMPARTMENTS of the grantor's private facts the delegate may
     * read. `PUBLIC` (it is on `grant.issued` and on the authority line), served here because
     * both parties need it in the same row they read the LIMITS from.
     */
    clearance: [...grant.clearance],
    /**
     * ★ **What the clearance actually shows, for the delegate that holds it.**
     *
     * The point of a clearance is the figures, and a clearance whose figures were never served
     * would be this project's signature defect on its newest field: a capability that exists and
     * is never exercised is indistinguishable from one that is missing. So the digest is right
     * here, in the row that says the delegate may read it, computed at this tick.
     *
     * `null` for the GRANTOR's own view of a grant it issued — not because the grantor may not
     * see its own books (it obviously may, everywhere else in the observation) but because
     * repeating them here would double the grants block for no information. `null` for a dead
     * grant too: `isLive` is the gate on a read exactly as it is on a draw.
     */
    reads:
      reader === grant.delegate && runtime.grants.isLive(grant.id, tick)
        ? Object.fromEntries(
            grant.clearance
              .filter(isCompartment)
              .map((room) => [room, compartmentDigest(runtime.compartmentPort(), grant.grantor, room, tick)]),
          )
        : null,
    expires_tick: grant.expiresTick,
    revoked_at_tick: grant.revokedAtTick,
    live: runtime.grants.isLive(grant.id, tick),
  };
}

/**
 * One DOSSIER, as one of the three principals it concerns may read it (§8, §16.7 MUST-8).
 *
 * ── WHO GETS THE DIGEST, AND WHY THE SUBJECT DOES NOT ────────────────────────
 *
 * The `digest` is the private figures. It goes to whoever legitimately **holds** the document
 * — the cutter and the recipient — and to nobody else, because a dossier is a copy in someone's
 * hands rather than a publication. The SUBJECT gets the *fact* of the disclosure and not the
 * figures, which sounds backwards for one second and then is obviously right: the subject
 * already knows its own balance, and what it needs from its access log is **who has been
 * reading it and when**.
 *
 * That split is also what keeps this from becoming a second leak. If the reveal published the
 * numbers, then every leak would leak twice — once to the recipient and once to the entire
 * galaxy and the audience — and cutting a dossier on your own grantor would be a free way to
 * publish its books. §11.2's ladder is about *who may read a fact*, not about a fact becoming
 * public because it moved.
 */
function dossierView(row: Dossier, reader: PrincipalId): Readonly<Record<string, unknown>> {
  const holder = reader === row.cutBy || reader === row.toWhom;
  return {
    id: row.id,
    subject: row.subject,
    compartment: row.compartment,
    cut_by: row.cutBy,
    to_whom: row.toWhom,
    /** The clearance it was read under, or null when this row is a re-hand of one already held. */
    under_grant: row.grant,
    /** The row it was copied from, or null for a first cut. The custody chain, as one field. */
    copied_from: row.parent,
    cut_at_tick: row.cutAtTick,
    /** When the subject, every other agent and every viewer learn of it — one clock for all three. */
    reveals_at_tick: row.revealsAtTick,
    /** The figures. Held documents only; the subject reads the disclosure, not its own numbers back. */
    digest: holder ? row.digest : null,
  };
}

// ── Briefing ────────────────────────────────────────────────────────────────

/**
 * One sentence naming the actual dilemma. Never a greeting.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★ **THE RANKING, AND WHY A6 SITS AT THE TOP OF IT.**
 *
 * This field contradicted `if_you_do_nothing` **in the same object**, and a probe caught it
 * mid-betrayal. With five offices out, three compartments leaked to three rivals and 7,800 of
 * permanent default riding, the victim was told:
 *
 *   *"Nothing is waiting on you and 3 of your hands are idle; an idle hand earns nothing, and
 *   the Commons is safe but poor."*
 *
 * — while `if_you_do_nothing`, one key over, said *"your elective 7800 is NOT paid … a default on
 * the record."* Earlier in the same run it had coached the victim to finish staffing the venture
 * its delegate had fabricated, calling it *"the 1 **you** created."*
 *
 * The ladder only ever read `mine`, `board` and idle hands, so **every fact about the core loop
 * was invisible to the sentence the agent reads first.** A6 is not a side system: it is the core
 * loop, and a dilemma field that cannot mention it is the eleventh instance of this project's
 * standing defect — a mechanism that exists, is exercised, and is unreachable in the one place an
 * agent looks to decide.
 *
 * The order below is not taste. It is **live liability, then permanence, then opportunity**:
 *
 *   1. `authorityInUse` — somebody is acting on authority you granted. Money is moving in your
 *      name *now*, one verb (`revoke`) still bounds what is left, and **this fact has no other home
 *      in the briefing at all.** One branch covers draws, delegated binds and cut dossiers together,
 *      because they are one dilemma about one counterparty and splitting them would make the ranking
 *      between them arbitrary.
 *   2. `campaignPressure` — a war whose next pulse is scheduled and takes ground whether you are
 *      awake or not (A14). Second rather than first only because it already has a dedicated
 *      `holding.campaigns[].if_you_do_nothing` saying the same thing precisely; among facts that
 *      *do* have another home, this is the largest and most preventable.
 *   3. an unelected elective riding into this settlement — recoverable this tick, **permanent**
 *      after it. A5′: a default libels you forever, so it outranks any window that merely closes.
 *      Below the war because declining an elective is a legitimate choice and losing a claim is not.
 *   4. the venture ladder, unchanged: your countersignature, your open roles, the board.
 *   5. the idle-hands line, which may now only be reached when everything above is empty — which is
 *      what makes it true.
 *
 * **The war half was corroborated independently**, in a run that shared nothing with the first: both
 * the attacker and the **besieged defender** of a live campaign read *"Nothing is waiting on you and
 * 3 of your hands are idle; … the Commons is safe but poor."* Neither was in the Commons, and the
 * attacker's three "idle" hands **were the war's entire force.** One key over,
 * `holding.campaigns[0].if_you_do_nothing` said *"the pulse at tick 792 is a BREACH against you — 2
 * of 3, and at 3 the claim LAPSES and your bond is slashed."* Two probes, two scenarios, one
 * ranking bug.
 * ══════════════════════════════════════════════════════════════════════════════
 */
function promptFor(
  runtime: Runtime,
  principal: PrincipalId,
  mine: readonly VentureRecord[],
  board: readonly BoardRow[],
  /**
   * The campaign views the payload publishes, **passed rather than recomputed** — the `books` and
   * `campaignViews` rule applied to prose. A second derivation of "how is my war going" is how the
   * sentence and the block it points at come to disagree inside one payload, which is the defect
   * class this whole function is being repaired for.
   */
  campaigns: readonly CampaignView[],
  /** Grants this principal ISSUED, and dossiers already revealed to it — both read once, above. */
  issued: readonly Grant[],
  dossiersOnMe: readonly Dossier[],
  fresh: boolean,
  tick: number,
): string {
  if (!fresh) {
    return 'You are outside a wake, so this snapshot carries no fresh affordances and no quote_id. Nothing here can be acted on; wait for your next wake or the next Reckoning.';
  }
  const delegated = authorityInUse(runtime, mine, issued, dossiersOnMe);
  if (delegated !== null) return delegated;
  const war = campaignPressure(campaigns);
  if (war !== null) return war;
  const riding = electiveRiding(runtime, principal, mine, tick);
  if (riding !== null) return riding;
  // ★ A live standoff outranks the whole venture ladder — see {@link standoffPressure}.
  const standoff = standoffPressure(runtime, principal, tick);
  if (standoff !== null) return standoff;
  // ══════════════════════════════════════════════════════════════════════════
  // ★ **AND SOMEBODY HAS TO BE WAITING ON IT.** `partiesOf(v).length > 0`.
  //
  // A blind player read *"v:265 is waiting on your countersignature"* while all four of its ventures
  // showed `filled_by: null` in the same payload. The predicate was `FORMING && !countersigned` and
  // nothing more, so it fired from tick 0 on every draft a principal had ever created — because
  // `countersigned` is seeded only for a *delegated* create (`venture/create.ts:boundAtFormation`),
  // so a self-created venture starts with an empty set by design.
  //
  // §7.3 is explicit that nothing binds until the PARTIES countersign, so a draft nobody has joined
  // carries no obligation and there is nothing to sign for. `observe/catalogue.ts` had already made
  // exactly this call one surface over — *"Mandatory only when somebody else is actually waiting on
  // this signature… A venture nobody has joined is a draft"* — and gates on `partiesOf` there. Two
  // surfaces, one rule, and only one of them had it: the affordance was honest and the sentence an
  // agent reads FIRST was not, which sent it to sign an empty draft ahead of the open roles that
  // were the actual next move.
  // ══════════════════════════════════════════════════════════════════════════
  const unsigned = mine.filter(
    (v) => v.state === 'FORMING' && !v.countersigned.has(principal) && partiesOf(v).length > 0,
  );
  if (unsigned.length > 0) {
    const first = unsigned[0];
    return first === undefined
      ? 'A venture is waiting on your countersignature.'
      : `${first.id} is waiting on your countersignature and nothing binds until it has one — sign it or let the window close at tick ${String(first.windowClosesTick)}.`;
  }
  const open = mine.filter((v) => v.state === 'FORMING' && openIndices(v).length > 0);
  if (open.length > 0) {
    const first = open[0];
    return first === undefined
      ? 'A venture of yours still has open roles.'
      : `${first.id} still needs ${String(openIndices(first).length)} role(s) filled and its window closes at tick ${String(first.windowClosesTick)}; you cannot staff it alone, so somebody has to be persuaded.`;
  }
  if (board.length > 0) {
    const first = board[0];
    // ══════════════════════════════════════════════════════════════════════════
    // **THIS SENTENCE TOLD A FILLER SOMETHING FALSE, AND IT IS THE FIRST SENTENCE
    // OF MOST WAKES (scar #1).**
    //
    // It read "… at N elective — which is the only part that will ever build your
    // standing." On a board role the reader is the **payee**, not the payer: the `elect`
    // affordance is generated only for `venture.creator === principal`, standing accrues to
    // whoever *honours* an elective part (INV-21, `ELECTIVE_HONOURED`), and a filler earns
    // no standing at all from this role. So the payload's most-read string asserted the
    // opposite of the engine's own rule about the design's central quantity — the exact
    // shape of scar #1, and two probes named it by name.
    //
    // What is true is more useful anyway: the elective half is the part the filler is owed
    // and may simply never be paid, which is why the payer's record is on the same row.
    // ══════════════════════════════════════════════════════════════════════════
    if (first === undefined) return 'There are open roles you are eligible for.';
    // The nearest slot a hand can actually reach, because a slot three lanes away needs a
    // `move` first and naming that one as "the nearest" is the prompt sending an agent at
    // an act the engine refuses. Falls back to the first row, with the trip named.
    const usable = handsOf(runtime.world, principal).filter(
      (h) => h.state === 'IDLE' && isPresent(h, tick),
    );
    const reachable = board.find((row) => usable.some((h) => occupiesSystem(h, row.stage)));
    const pick = reachable ?? first;
    const payer = runtime.standing.row(pick.creator);
    const record =
      payer.defaults > 0
        ? `${String(payer.defaults)} recorded default(s), the last at tick ${String(payer.lastDefaultTick)}`
        : payer.electiveHonoured > 0
          ? `${String(payer.electiveHonoured)} elective part(s) honoured across ` +
            `${String(payer.distinctCounterparties)} distinct counterparties and no defaults`
          : 'no record either way yet — unproven, which is not the same as clean';
    const close =
      reachable === undefined
        ? `You have no idle hand at ${pick.stage}, so move one there first — a hand fills a role where the ` +
          `venture happens, the window shuts at tick ${String(pick.expires_tick)}, and the trip has to fit.`
        : `To close it, fill_role now and sign ${String(pick.terms_hash)} on the next tick; unsigned by tick ` +
          `${String(pick.expires_tick)} and it retires with nothing settled.`;
    return (
      `${String(board.length)} open role(s) you are eligible for. The nearest is ${pick.label} on ` +
      `${pick.venture} at ${pick.stage}, which pays you ${String(pick.your_take_at_p50)} at p50, of which ` +
      `${String(pick.elective)} is elective — the part ${pick.creator} may simply decline to pay, and its ` +
      `record shows ${record}. Filling it builds no standing of your own: standing accrues to whoever ` +
      `HONOURS an elective part, and on this role that is the payer. ${close}`
    );
  }
  const idle = handsOf(runtime.world, principal).filter((h) => h.state === 'IDLE').length;
  // ── ★ THE TAIL SENTENCE NAMED A TIER THE READER MAY HAVE LEFT ──────────────
  //
  // *"the Commons is safe but poor"* was emitted unconditionally, so a principal that had already
  // paid to cross into the Marches — the one irreversible act in the game — was told about the place
  // it is no longer in, as advice, on the wake after it got there. Three separate reports have now
  // hit this line; the earlier repair reordered the ladder above so it is *reached* less often and
  // left the sentence itself alone, which fixed the frequency and not the claim.
  //
  // The payload already knows: `holding.commons_bound` is published from the same predicate two
  // hundred lines up. The branch costs one call and the sentence is now true of whoever reads it.
  const inCommons = principalIsCommonsBound(runtime.world, principal);
  const where = inCommons
    ? 'the Commons is safe but poor, and `graduate` is the way out.'
    : 'you are outside the Commons, where an idle hand is also an exposed one — it can be raided ' +
      'where it stands, and nothing out here makes hostile action invalid.';
  return `Nothing is waiting on you and ${String(idle)} of your hands are idle; an idle hand earns nothing, and ${where}`;
}

/**
 * ★ **Somebody is acting on authority you granted** — the A6 branch of the dilemma, and the one
 * the field never had.
 *
 * Three facts, one sentence, because they are one dilemma about one counterparty: a delegate that
 * has DRAWN on your treasury, a venture it SIGNED YOU INTO, and a DOSSIER it cut on your books
 * and handed somewhere. Ranking them against each other would have been arbitrary; naming the
 * delegate and letting the agent decide is what §13B means by narrative and never control.
 *
 * Read off the same books the `grants` key publishes — `allSpends()` is INV-22's own journal,
 * `dossiers.about` filtered by `visibleToSubject` is exactly `grants.about_me[]`, and `mine`
 * carries `boundByGrant`. One source per fact, so the sentence and the block it points at cannot
 * disagree (the `books`/`campaignViews` rule, applied to prose).
 *
 * **Silent while nothing has happened**, which is the whole difference between this and a warning:
 * issuing a grant is not a dilemma, and a grantor whose delegates have all behaved gets the
 * ordinary ladder. It is the *use* that is news.
 */
function authorityInUse(
  runtime: Runtime,
  mine: readonly VentureRecord[],
  /** Grants THIS principal issued — the only ones where it carries the risk. Read once by the caller. */
  issuedRows: readonly Grant[],
  leaked: readonly Dossier[],
): string | null {
  // A grant this principal HOLDS over somebody else is its own authority and no dilemma at all.
  if (issuedRows.length === 0 && leaked.length === 0) return null;
  const issued = new Map(issuedRows.map((g) => [g.id, g] as const));

  const bound = mine.filter((v) => v.boundByGrant !== null && issued.has(v.boundByGrant));
  // The journal, walked only once something is actually delegated. Bounded by INV-26, but it is a
  // per-observation walk and the cheap exits above are what keep it off the common path.
  const draws = issued.size === 0 ? [] : runtime.grants.allSpends().filter((s) => issued.has(s.grant));
  if (draws.length === 0 && bound.length === 0 && leaked.length === 0) return null;

  // The delegate with the most to answer for, named. Ties broken by id so the sentence is
  // deterministic (DET-7: no `Date.now`, no unstable sort key).
  const tally = new Map<string, number>();
  for (const s of draws) tally.set(String(s.delegate), (tally.get(String(s.delegate)) ?? 0) + 1);
  for (const v of bound) {
    const g = v.boundByGrant === null ? undefined : issued.get(v.boundByGrant);
    if (g !== undefined) tally.set(String(g.delegate), (tally.get(String(g.delegate)) ?? 0) + 1);
  }
  for (const d of leaked) tally.set(String(d.cutBy), (tally.get(String(d.cutBy)) ?? 0) + 1);
  const worst = [...tally.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))[0];

  const drawn = draws.reduce((sum, s) => sum + Number(s.direct), 0);
  const parts: string[] = [];
  if (bound.length > 0) {
    const first = bound[0];
    parts.push(
      `${String(bound.length)} venture(s) were signed in your name — ${first === undefined ? '' : `${first.id}, `}` +
        'which you did not create and cannot unsign',
    );
  }
  if (draws.length > 0) {
    parts.push(`${String(draws.length)} draw(s) totalling ${String(drawn)} have been taken against your LIMITS`);
  }
  if (leaked.length > 0) {
    const rooms = [...new Set(leaked.map((d) => d.compartment))].sort(cmp).join('+');
    const to = [...new Set(leaked.map((d) => String(d.toWhom)))].sort(cmp);
    parts.push(
      `${String(leaked.length)} DOSSIER(s) on your ${rooms} have been cut and handed to ` +
        `${to.slice(0, 3).join(', ')}${to.length > 3 ? ` and ${String(to.length - 3)} more` : ''} — ` +
        'permanent, re-handable forever, and nothing un-cuts one',
    );
  }
  return (
    `Authority you granted is being USED${worst === undefined ? '' : `, most of it by ${worst[0]}`}: ` +
    `${parts.join('; ')}. This is legitimate and none of it can be undone — \`revoke\` bounds only what ` +
    `is LEFT, and \`audit\` buys you the ${String(AUDIT_LAG_TICKS)}-tick window on reads you have not been ` +
    'told about yet. Read `grants.granted[]` for the remaining headroom and `grants.about_me[]` for who ' +
    'has been reading you, and decide whether this delegate keeps its office.'
  );
}

/**
 * ★ **A war whose next pulse is already scheduled** — the branch a second probe's siege demanded.
 *
 * Both the attacker and the besieged defender of a live campaign were told their hands were idle and
 * the Commons was safe, while the attacker's "idle" hands were the war's whole force. A14's point is
 * that the pulse *"fires whether you are awake or not"*, so a prompt that omits it is omitting the
 * one thing on a clock the agent cannot dodge.
 *
 * Read straight off `CampaignView.if_you_do_nothing` — the sentence the campaign block already
 * publishes, quoted rather than re-derived, so the top-level dilemma and `holding.campaigns[0]`
 * cannot say different things about the same war. `campaignsFor` returns them sorted by how close
 * each is to deciding something, so the first party row is the one that matters most.
 */
function campaignPressure(campaigns: readonly CampaignView[]): string | null {
  const mine = campaigns.find((c) => c.your_side !== null);
  if (mine === undefined) return null;
  const clock =
    mine.next_pulse_tick === null
      ? 'its next pulse is not scheduled'
      : `its next pulse is at tick ${String(mine.next_pulse_tick)} and fires whether you are awake or not`;
  return (
    `You are ${String(mine.your_side)} in campaign ${mine.campaign} over ${mine.objective}, standing ` +
    `${mine.legend}, and ${clock}. ${mine.if_you_do_nothing} Hands committed to a war are not idle ` +
    'hands; `holding.campaigns[]` carries the force reading, the depot and the materiel this pulse ' +
    'will consume, and there are four ways out rather than one.'
  );
}

/**
 * ★ **An elective half riding into THIS settlement, unelected** — the branch whose absence let the
 * dilemma field say "nothing is waiting on you" over 7,800 of imminent permanent default.
 *
 * Second in the ladder, not third, and A5′ is the reason: a formation window that closes retires a
 * venture with nothing settled, while a settlement that arrives unelected writes a `DEFAULTED` row
 * that no verb in this game removes. Recoverable-now-and-permanent-after outranks
 * recoverable-now-and-forgotten-after.
 *
 * Deliberately the **same arithmetic** as `if_you_do_nothing` — `unelectedElective` over the
 * ventures resolving by `nextSettlement` — because the defect was not that the number was missing
 * from the payload. It was there, one key over. The defect was that the two keys **disagreed**, and
 * two derivations of one figure is how they would disagree again.
 */
function electiveRiding(
  runtime: Runtime,
  principal: PrincipalId,
  mine: readonly VentureRecord[],
  tick: number,
): string | null {
  const settlement = nextSettlement(tick);
  const resolving = mine.filter((v) => v.state === 'LIVE' && v.resolvesAtTick <= settlement);
  const owed = resolving.reduce((sum, v) => sum + unelectedElective(runtime, v, principal), 0);
  if (owed <= 0) return null;
  const first = resolving.find((v) => unelectedElective(runtime, v, principal) > 0);
  return (
    `${String(owed)} of ELECTIVE half is unelected and settles at tick ${String(settlement)}` +
    `${first === undefined ? '' : ` (${first.id} first)`}. Paying it is genuinely your choice — the ` +
    'escrowed half auto-executes either way — but the choice is recorded: `elect` IN_FULL and it ' +
    'counts as honoured, or let it settle and a DEFAULT goes on your permanent public record naming ' +
    'you as promisor, which no verb in this game removes. Whoever is owed it reads the same row.'
  );
}

/**
 * ★ **A LIVE STANDOFF — the war the dilemma field could not see** (A14).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **`briefing.prompt` TALKED ABOUT BOARD ROLES WHILE THE READER'S OWN RAID WAS RESOLVING.** Twice,
 * in one session, and the second time with a battle in MUSTER. `campaignPressure` is the only war
 * branch the ladder had, and a campaign is the *slowest* form of conflict in the game — a raid
 * resolves inside 24 ticks, a MUSTER window inside 6, and neither had a branch at all.
 *
 * This sits above the venture ladder and below `electiveRiding` on the ladder's own stated rule
 * (*"live liability, then permanence, then opportunity"*): a default is permanent and public and
 * outranks everything, while a forfeited stake and a routed hand are losses you recover from. It
 * sits above the ventures because a standoff has a **clock nobody can dodge** and a board role does
 * not (A14).
 *
 * Both readings come from the same views the `obligations` key publishes — `raidsFor` and
 * `engagementsFor` — never a second derivation, for the reason `campaignPressure` takes its views as
 * an argument: two derivations of "how is my war going" is how the sentence and the block it points
 * at come to disagree inside one payload.
 * ══════════════════════════════════════════════════════════════════════════
 */
function standoffPressure(runtime: Runtime, principal: PrincipalId, tick: number): string | null {
  // Soonest first, then by id: a reader with two standoffs is told about the one that lands next,
  // and the tie-break is canonical so two runs of one seed cannot disagree (DET-2).
  const raids = [...runtime.raidsFor(principal, tick, MAX_LIST_ROWS)]
    .filter((r) => r.state === 'DEMANDED' && r.your_side !== null)
    .sort((a, b) => a.resolves_tick - b.resolves_tick || cmp(a.raid, b.raid));
  const raid = raids[0];
  if (raid !== undefined) {
    const role =
      raid.your_side === 'TARGET'
        ? `You are the TARGET of ${raid.initiator === null ? 'a world raid' : `${raid.initiator}'s demand`}`
        : `You are ${String(raid.your_side)} in ${raid.raid}`;
    const answer =
      raid.your_side === 'TARGET'
        ? `Answer it — \`yield\` costs ${String(raid.costs.pay)} of ${raid.good} and \`fight\` risks the ` +
          `whole ${String(raid.costs.if_you_do_nothing)}; silence IS the fight, without the defence.`
        : `Your stake of ${String(raid.costs.join_stake)} is forfeit to the other side if it loses, and the ` +
          'hand you put in is routed with it.';
    return (
      `${role} at ${raid.stage}, and it resolves at tick ${String(raid.resolves_tick)} — ` +
      `${String(raid.ticks_left)} tick(s) from now, which is BEFORE the next Reckoning. Force stands at ` +
      `${String(raid.force.raider)} raider against ${String(raid.force.defender_if_you_fight)} defender, so ` +
      `it reads ${raid.force.verdict_if_resolved_now} if it resolved now. ${answer} ` +
      '`obligations.raid[]` carries the whole arithmetic.'
    );
  }
  const musters = [...runtime.engagementsFor(principal, tick, MAX_LIST_ROWS)]
    .filter((e) => e.state === 'MUSTER')
    .sort((a, b) => cmp(a.engagement, b.engagement));
  const muster = musters[0];
  if (muster !== undefined) {
    return (
      `Battle ${muster.engagement} over ${muster.stage} is in MUSTER, which is the ONLY window a hull may ` +
      `be committed in, and it closes in ${String(muster.ticks_left)} tick(s). ${muster.if_you_do_nothing} ` +
      '`obligations.battle[]` carries the force reading and what each side has already committed.'
    );
  }
  return null;
}

/**
 * The concrete consequence at the next Reckoning if this principal does nothing.
 *
 * **Tested against reality** (PROP-O5), which is the reason it is computed from
 * the same rows settlement will read rather than written as reassuring prose. It
 * is High Water's `projectedDrown` generalised, and it is what lets a model
 * self-correct.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ★ **AND IT SAID "NOTHING RESOLVES FOR YOU" OVER A LIVE WAR.** At tick 213 a blind player read
 * *"Nothing resolves for you before tick 287… absence costs opportunity and nothing else."* A demand
 * it had 500 staked in resolved at tick 231 reading `REPULSED`; doing nothing cost the stake and a
 * hand. The field consulted ventures, the election book, hands in transit, the Levy and claims — and
 * **no raid, no demand, no battle and no campaign.** `Runtime.liveRaidAgainst` even carries the
 * docstring *"One home for 'is this agent under a demand', so the affordance layer, THE BRIEFING and
 * the verb handler cannot disagree about it"*, and the briefing had never called it.
 *
 * A5′ in the forward direction: the field's whole contract is that absence is priced, and pricing it
 * at zero over a scheduled loss is worse than saying nothing, because an agent that reads this and
 * sleeps has been told a falsehood by the one field built to stop that.
 * ══════════════════════════════════════════════════════════════════════════
 */
function ifYouDoNothing(
  runtime: Runtime,
  principal: PrincipalId,
  mine: readonly VentureRecord[],
  tick: number,
): string {
  const settlement = nextSettlement(tick);
  const resolving = mine.filter((v) => v.state === 'LIVE' && v.resolvesAtTick <= settlement);
  // ── This sentence has to read the election book, or it becomes a lie ────────
  //
  // PROP-O5 says `if_you_do_nothing` is *tested against reality*, and while the
  // election rode on `sign` there was no separate book to consult. Now there is: a
  // payer that has already elected `IN_FULL` and is still told "your elective N is NOT
  // paid" would either re-elect (burning actions on an act with no effect) or conclude
  // the engine lost its statement. So the figure is what is genuinely unelected, and
  // only that.
  const owed = resolving.reduce((sum, v) => sum + unelectedElective(runtime, v, principal), 0);
  const parts: string[] = [];

  if (resolving.length > 0) {
    parts.push(
      `${String(resolving.length)} venture(s) resolve at tick ${String(settlement)}: the escrowed halves execute automatically`,
    );
    if (owed > 0) {
      parts.push(
        `and your elective ${String(owed)} is NOT paid — an unelected elective part is a decline, and a decline is a default on the record, so \`elect\` it before the freeze`,
      );
    }
  }

  // ── The escrow claim was wrong, and PROP-O5 makes that a bug ───────────────
  //
  // This read "their escrow stays locked until you abandon them". It is not: `Runtime`'s
  // VENTURES phase calls `retireFormation` the first tick past `windowClosesTick`, which
  // resolves the venture ABANDONED, closes its obligation, **refunds the escrow in full**
  // and frees the hands — with the agent doing nothing at all. Three probes read the false
  // version and one saw it four times, which is exactly the field `agent.md` §6 promises is
  // "tested against reality — if it turns out to be wrong, that is a bug".
  //
  // The correction matters beyond accuracy: an agent told its capital is trapped until it
  // spends an action budgets around a lock that is not there.
  const forming = mine.filter((v) => v.state === 'FORMING');
  if (forming.length > 0) {
    const soonest = forming.reduce(
      (min, v) => Math.min(min, v.windowClosesTick),
      Number.MAX_SAFE_INTEGER,
    );
    const mineToRefund = forming.filter((v) => v.creator === principal).length;
    parts.push(
      `${String(forming.length)} forming venture(s) never go live: from tick ${String(soonest)} each window ` +
        'closes and the venture is retired ABANDONED without your acting' +
        (mineToRefund > 0
          ? `, your escrow on the ${String(mineToRefund)} you created is refunded in full, and any hand you ` +
            'committed comes free — you do not need to `abandon` them and nothing stays locked'
          : ', and any hand you committed comes free'),
    );
  }

  const transit = handsOf(runtime.world, principal).filter((h) => h.state === 'IN_TRANSIT');
  for (const hand of transit.slice(0, 3)) {
    parts.push(`hand ${hand.id} arrives at ${String(hand.destination)} on tick ${String(hand.freeAtTick)}`);
  }

  // ── THE LEVY HAS TO BE IN HERE, OR THE SENTENCE IS A LIE ────────────────────
  //
  // A live playtest caught this field saying *"absence costs opportunity and nothing
  // else"* in the same payload that carried `levy.shortfall_if_unpaid: 500`. Reproduced
  // across two Reckonings. The Levy is the one obligation an agent cannot dodge by doing
  // nothing (§5.2: the total is fixed by rule), so leaving it out of the
  // consequence-preview inverted the only field PROP-O5 promises is tested against
  // reality — and told a principal it was safe while a public shortfall was accruing.
  //
  // This is the `projectedDrown` pattern, which exists precisely so an agent can see the
  // cost of NOT deciding. A preview that omits the undodgeable item previews the wrong
  // world.
  const levy = runtime.levyBlockFor(principal, tick);
  const levyShort = levy === null ? 0 : Math.max(0, levy.shortfall_if_unpaid ?? 0);
  if (levyShort > 0) {
    parts.unshift(
      `your Levy assessment of ${String(levyShort)} goes UNPAID and is recorded as a public shortfall ` +
        `against you at tick ${String(settlement)} — this one does not lapse quietly, and it is the ` +
        'obligation doing nothing cannot avoid',
    );
  }

  // ── AND THE CHARGE HAS TO BE IN HERE, FOR THE SAME REASON AND WORSE ─────────
  //
  // The Levy was omitted from this field until a playtest caught it, and the sentence read
  // "absence costs opportunity and nothing else" in the same payload that carried
  // `shortfall_if_unpaid: 500`. The Charge is that failure with the stakes raised: a Levy
  // shortfall costs Commons capacity, and a Charge shortfall costs TERRITORY and 50,000 of
  // slashable capital. A5′ is explicit — never record an arrears or a lapse against a
  // claimant that was never shown what it owed — and this field is where being shown
  // happens for an agent that reads one line.
  //
  // It goes at the FRONT, ahead of the Levy, because a lapse is irreversible and a Levy
  // shortfall is not: the ordering is by what an agent would most regret not reading.
  const claims = runtime.claimsFor(principal, tick);
  const failing = claims.filter((c) => c.if_you_do_nothing !== 'STAYS_SUPPLIED');
  const lapsing = failing.filter((c) => c.if_you_do_nothing === 'LAPSES');
  if (failing.length > 0) {
    parts.unshift(
      failing
        .slice(0, 3)
        .map((c) => c.consequence)
        .join(' '),
    );
    if (lapsing.length > 0) {
      parts.unshift(
        `${String(lapsing.length)} claim(s) of yours LAPSE at tick ${String(settlement)} and ` +
          `${String(lapsing.reduce((n, c) => n + c.bond_at_risk, 0))} of your bond is SLASHED — this is the ` +
          'consequence of doing nothing that cannot be undone, and delivering, selling or abandoning are all ' +
          'cheaper than it',
      );
    }
  }

  // ── ★ AND A STANDOFF, WHICH RESOLVES BEFORE THE RECKONING DOES ──────────────
  //
  // FIRST in the sentence, ahead of the lapse and the Levy, and the ordering rule above is why: this
  // one lands SOONEST. A demand resolves 24 ticks after it is opened and a MUSTER window shuts in 6,
  // so a preview that leads with tick 287 while a stake burns at tick 231 is previewing the wrong
  // world in the one way the reader cannot recover from — it has already happened by the time the
  // sentence comes true.
  //
  // Read from the same views `obligations.raid[]` and `obligations.battle[]` publish, so the line and
  // the block cannot disagree. `costs.if_you_do_nothing` is the raid view's OWN field of this name —
  // the two were built independently and never once met.
  for (const raid of [...runtime.raidsFor(principal, tick, MAX_LIST_ROWS)]
    .filter((r) => r.state === 'DEMANDED' && r.your_side !== null)
    .sort((a, b) => a.resolves_tick - b.resolves_tick || cmp(a.raid, b.raid))
    .slice(0, 2)
    .reverse()) {
    parts.unshift(
      raid.your_side === 'TARGET'
        ? `${raid.raid} at ${raid.stage} resolves at tick ${String(raid.resolves_tick)} and an unanswered ` +
            `demand musters NO defence, so it takes ${String(raid.costs.if_you_do_nothing)} of ${raid.good} ` +
            `rather than the ${String(raid.costs.pay)} \`yield\` would cost — and this lands before tick ` +
            `${String(settlement)}`
        : `${raid.raid} at ${raid.stage} resolves at tick ${String(raid.resolves_tick)} with you on the ` +
            `${String(raid.your_side)} side; it reads ${raid.force.verdict_if_resolved_now} as it stands, and ` +
            `if your side loses your staked ${String(raid.costs.join_stake)} is forfeit and your hand is ` +
            `routed — this lands before tick ${String(settlement)}`,
    );
  }
  for (const battle of [...runtime.engagementsFor(principal, tick, MAX_LIST_ROWS)]
    .filter((e) => e.state === 'MUSTER' || e.state === 'CONTACT' || e.state === 'CONTEST')
    .sort((a, b) => cmp(a.engagement, b.engagement))
    .slice(0, 2)
    .reverse()) {
    parts.unshift(
      `battle ${battle.engagement} over ${battle.stage} is in ${battle.state} with ` +
        `${String(battle.ticks_left)} tick(s) left in it: ${battle.if_you_do_nothing}`,
    );
  }

  if (parts.length === 0) {
    return `Nothing resolves for you before tick ${String(settlement)}. Your identity, your holding and your standing are unchanged — absence costs opportunity and nothing else.`;
  }
  return `${parts.join('; ')}.`;
}

// ── Small derivations ───────────────────────────────────────────────────────

/**
 * What this payer has NOT elected on, netted against what it has.
 *
 * ── ★ ONE HOME, BECAUSE THIS ARITHMETIC NOW HAS THREE READERS ──────────────
 *
 * The body used to live here, and it was the *only* place a creator's liability was
 * computed — so `ventureRow` could not publish the figure without copying it, and a copy
 * is how one obligation acquires two numbers. It moved to
 * `venture/preview.ts:creatorElective`, beside `electiveCeilingOfRole` whose charge it
 * sums, and this function is now a projection of that one result. `briefing.prompt`,
 * `if_you_do_nothing` and `ventures.mine[].my_elective_unelected` therefore read the same
 * arithmetic by construction rather than by review.
 */
function unelectedElective(
  runtime: Runtime,
  venture: VentureRecord,
  principal: PrincipalId,
): number {
  return creatorElectiveOf(runtime, venture, principal).unelected;
}

/**
 * {@link creatorElective} bound to the runtime's election book.
 *
 * The lookup is passed rather than the book, so `preview.ts` stays free of `Runtime` — the
 * same reason `stageBps` is a parameter there.
 */
function creatorElectiveOf(
  runtime: Runtime,
  venture: VentureRecord,
  principal: PrincipalId,
): CreatorElective {
  return creatorElective(venture, principal, (id, roleIndex) => runtime.electionOn(id, roleIndex));
}

function nextSettlement(tick: number): number {
  return tick + ticksUntilReckoning(tick) - 1;
}

/**
 * The last tick on which an act aimed at tonight's settlement can still be taken.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * This used to return the **freeze tick itself**, which is a tick where `SealBook.commit`
 * and `Runtime.vElect` both refuse — so the seal affordance published an `expires_tick`
 * one past its own deadline and an agent acting at exactly that tick was told to do
 * something and then declined (AGT-S2). `nextSettlement(tick) - 1` is the freeze
 * (`FREEZE_TICKS === 1`); the last *actable* tick is one before that.
 * ══════════════════════════════════════════════════════════════════════════
 */
function lastTickBeforeFreeze(tick: number): number {
  const settlement = nextSettlement(tick);
  return Math.max(tick, settlement - 1 - FREEZE_TICKS);
}

/** The tick something changes for this principal. Never decreases within a tick. */
function nextDecisionAt(runtime: Runtime, principal: PrincipalId, tick: number): number {
  let soonest = nextSettlement(tick);
  for (const hand of handsOf(runtime.world, principal)) {
    if (hand.freeAtTick !== null && hand.freeAtTick > tick && hand.freeAtTick < soonest) {
      soonest = hand.freeAtTick;
    }
  }
  for (const venture of runtime.ventures.forPrincipal(principal)) {
    if (venture.state === 'FORMING' && venture.windowClosesTick > tick && venture.windowClosesTick < soonest) {
      soonest = venture.windowClosesTick;
    }
  }
  return soonest;
}

/**
 * Free seal slots left this Reckoning: one per role held, spent once (PROP-D4).
 *
 * `rolesHeld` is passed rather than counted, because the seal book's own rule is
 * *per role*, not per count — a principal holding two roles that has already
 * sealed one has one slot left, and a count could not distinguish that from having
 * sealed neither. Commitment lives in `venture_role.filled_by_hand_id` and is read
 * from there, never mirrored (scar #5).
 */
function sealSlotFor(runtime: Runtime, principal: PrincipalId, tick: number): number {
  const held: SealRoleRef[] = [];
  for (const venture of runtime.ventures.forPrincipal(principal)) {
    const role = roleOfPrincipal(venture, principal);
    if (role !== null) held.push({ venture: venture.id, roleIndex: role.index });
  }
  return runtime.seals.freeSlotsRemaining(principal, reckoningIndex(tick), held);
}

/**
 * The world's Exposure as a band, never a number belonging to somebody else.
 *
 * §11.3: publish concentration as a metric and use it to withhold credit, never to
 * accuse. A band is the widest thing that is still useful.
 */
function exposureBand(runtime: Runtime): string {
  let total = 0;
  // Every principal on the roll, not only those with a lock: the delegated half of EXPOSURE is
  // carried by grants, and `principalsWithExposure` only knows about the encumbrance table — so the
  // world band would have read "none open" over a galaxy full of live mandates.
  for (const p of runtime.world.principalOrder) {
    total += runtime.exposureOf(p);
  }
  if (total === 0) return 'none open';
  if (total < 100_000) return 'under 100000';
  if (total < 1_000_000) return '100000 to 1000000';
  return 'over 1000000';
}

/**
 * A quote id: a hash of what it pins, plus the tick.
 *
 * It pins inputs and rules and **reserves nothing** (§12.3, PROP-W4) — two agents
 * can hold quotes on the same scarce slot and exactly one will win the fill, which
 * is why the fill is allocated from the set at tick close rather than granted at
 * submit.
 */
export function quoteId(
  principal: PrincipalId,
  tick: number,
  verb: string,
  pinned: CanonicalValue,
): string {
  return shortHash(canonicalHash({ v: 1, principal, tick, verb, pinned }));
}

/** Is a quote still inside its pin window? */
export function quoteIsFresh(issuedAtTick: number, nowTick: number): boolean {
  return nowTick >= issuedAtTick && nowTick - issuedAtTick <= QUOTE_PIN_TICKS;
}

export function wakesRemainingFor(spent: number): number {
  return Math.max(0, WAKES_PER_RECKONING - spent);
}

export { TICKS_PER_RECKONING, isSettlementTick };

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
