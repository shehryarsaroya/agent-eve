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
import type { Grant, PrincipalId, Standing, SystemId, VentureId, VentureKind } from '../core/types.js';
import { BPS_ONE, minor, type Minor } from '../core/units.js';
import { storesAccount } from '../ledger/index.js';
import { MAX_ORDER_QTY, freeCash, sellableGoods, type PublicBook } from '../market/index.js';
import { ACTIONS_PER_TICK } from '../core/time.js';
import {
  escrowRatioBps,
  escrowRequired,
  IN_FULL,
  kindSpec,
  maxElectiveBps,
  minElectiveBps,
  openIndices,
  pinnedValue,
  roleOfPrincipal,
  yourTakeAtP50,
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
import { LEVY_BALLOT, LEVY_GOOD, LEVY_RULES, PUBLISHED_DEFAULT_RULE } from '../levy/index.js';
import { syndicateAsPrincipal } from '../syndicate/book.js';
import { DEFAULT_CHARTER } from '../syndicate/charter.js';
import { FOUNDING_COST_MINOR, MAX_SYNDICATES_PER_PRINCIPAL } from '../syndicate/params.js';
import { REFINE_IN_QTY, REFINE_OUT_QTY, WORKS_GOOD, WORKS_YIELD_GOOD } from '../works/params.js';
import type { SealRoleRef } from '../seal/index.js';
import {
  commonsBoundRejection,
  GRADUATION_STATEMENT,
  handsOf,
  holdingOf,
  isPresent,
  occupiesSystem,
  principalIsCommonsBound,
  tierOf,
  transitTicks,
} from '../world/index.js';
import {
  defaultTerms,
  DELIVERY_MEASURE,
  DELIVERY_VERB,
  ELECTABLE_VENTURE_STATES,
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
 */


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
  readonly reason: string;
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
   */
  readonly corrections: readonly PendingCorrection[];
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
  const mine = runtime.ventures.forPrincipal(principal);

  const solved = boardFor(runtime, principal, tick);
  const board = solved.rows;
  // The market block is built ONCE and both published and used to price the `trade`
  // affordances, for the same reason the board is: two solves would let
  // `market.books[]` and the `trade` list disagree about a price, and an affordance
  // quoting a price the payload does not show is the two-homes shape of scar #1 with
  // money attached.
  const market = runtime.marketView(principal, tick);
  const books = (market['books'] ?? []) as readonly PublicBook[];
  // The **same rows** the payload publishes are the rows the affordances are built from.
  // Solving the board twice would let `ventures.board[]` and the `fill_role` list disagree
  // about a hash or a price, which is the two-homes-for-one-rules-surface shape of scar #1.
  const affordanceSet = input.fresh && !input.stale
    ? affordancesFor(runtime, principal, tick, board, solved.dropped, books)
    : { list: [] as Affordance[], withheld: notAWake(input) };

  const exposure = runtime.ledger.encumbrances.cachedExposure(principal);
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

    counterparties: counterpartiesFor(runtime, principal, mine, board).slice(0, MAX_LIST_ROWS),

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
        ...runtime.grants.forGrantor(principal),
        ...runtime.syndicates
          .of(principal, tick)
          .flatMap((s) => runtime.grants.forGrantor(syndicateAsPrincipal(s.id))),
      ]
        .slice(0, MAX_LIST_ROWS)
        .map((g) => grantView(runtime, g, tick)),
      held: runtime.grants
        .forDelegate(principal)
        .slice(0, MAX_LIST_ROWS)
        .map((g) => grantView(runtime, g, tick)),

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
      prompt: promptFor(runtime, principal, mine, board, input.fresh, tick),
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
       */
      corrections: input.corrections.map((c) => ({
        tick: c.tick,
        verb: c.verb,
        clientSequence: c.clientSequence,
        invariant: c.invariant,
        hint: c.hint,
        nearest_legal: affordanceSet.list.find((a) => a.verb === c.verb) ?? affordanceSet.list[0] ?? null,
      })),
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
  if (input.runtime.engine.status === 'PAUSED') {
    return {
      count: 0,
      reason:
        'this observation is the cached tick snapshot: the world is PAUSED, so there is nothing you can ' +
        'legally do until it resumes. Nothing was withheld — no affordance list was solved.',
    };
  }
  if (input.wakesRemaining > 0) {
    return {
      count: 0,
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

function affordancesFor(
  runtime: Runtime,
  principal: PrincipalId,
  tick: number,
  board: readonly BoardRow[],
  /** Eligible slots the board's own cap dropped. See {@link boardFor}. */
  boardDropped: number,
  /** The same books the payload publishes, so a quote cannot disagree with the ladder. */
  books: readonly PublicBook[],
): AffordanceSet {
  const eligible: Affordance[] = [];
  /** Charge deliveries withheld because no hand of this principal is standing there. */
  let chargeNoHand = 0;
  const chargeNoHandAt: string[] = [];
  const world = runtime.world;
  const hands = handsOf(world, principal);
  const mine = runtime.ventures.forPrincipal(principal);
  const free = runtime.ledger.account(storesAccount(principal)) === undefined
    ? minor(0)
    : runtime.ledger.freeBalance(storesAccount(principal));

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
          `${String(RAID_TAKE_MULTIPLE)}x, capped at half of what is actually there).`,
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
      if (free >= RAID_JOIN_STAKE_MINOR) {
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
            `against anything in the Commons (A8).`,
          expires_tick: view.resolves_tick,
          quote_id: quoteId(principal, tick, 'join', { raid: view.raid, side: 'RAIDER', principal: view.target }),
        });
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
  const myStages = new Set(
    hands
      .filter((hand) => hand.state === 'IDLE' && tierOf(world.map, hand.location) !== 'COMMONS')
      .map((hand) => hand.location),
  );
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
  if (demandsLeft > 0) {
    for (const stage of [...myStages].sort(cmp)) {
      if (demandsOffered >= MAX_DEMAND_AFFORDANCES) break;
      for (const other of world.principalOrder) {
        if (demandsOffered >= MAX_DEMAND_AFFORDANCES) break;
        if (other === principal) continue;
        const holdingId = world.holdingByPrincipal.get(other);
        if (holdingId === undefined || world.holdings.get(holdingId)?.system !== stage) continue;
        const ask = RAID_DEMAND_QTY.min;
        if (
          runtime.demandRefusalFor({
            initiator: principal,
            target: other,
            stage,
            good: LEVY_GOOD,
            demand: ask,
            tick,
            handId: null,
          }) !== null
        ) {
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
    const role = roleOfPrincipal(venture, principal);
    const owed = role === null ? escrowRequired(venture) : minor(0);
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
    const payer = venture.creator === principal;
    eligible.push({
      verb: 'sign',
      params: {
        venture: venture.id,
        terms_hash: venture.termsHash,
        your_take_at_p50: yourTakeAtP50(venture, principal),
      },
      cost: 1,
      max_direct_loss: owed,
      max_contingent_liability: electiveOwed(venture, principal),
      what_it_forecloses: payer
        ? 'signing binds you to these terms; the terms_hash cannot be amended afterwards. It does NOT decide ' +
          'what you pay — that is `elect`, one role at a time, restatable every tick until the freeze. Sign ' +
          'and never elect and you pay nothing, which is a decline and a default on the record.'
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
    // filler is the party bearing that difference. `max_direct_loss` on a fill is 0 and always was,
    // which a probe correctly read as *"filling costs nothing"*; what it costs is the elective part
    // never arriving, and that is not a loss the engine can price, so it has to be a sentence.
    const offer =
      `Of the ${String(row.escrowed + row.elective)} on this slot, ${String(row.escrowed)} is escrowed ` +
      `(${String(row.escrow_ratio_bps)} bps — it executes automatically and nobody can stop it) and ` +
      `${String(row.elective)} is elective (${String(row.elective_bps)} bps — ${row.creator} chooses at ` +
      `the Reckoning whether to pay it, and silence is a default on ITS record, not yours).` +
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
          `most one role in ${row.venture}. ${offer} FILLING IS NOT CLOSING: the fill is allocated at tick ` +
          `close and the venture stays FORMING until every party has countersigned the same terms_hash. ` +
          `${close} Unsigned by tick ${String(row.expires_tick)} and the window closes, the venture retires ` +
          'ABANDONED, and nothing you spent comes back.'
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
  for (const kind of OFFERED_KINDS) {
    const seat = hands[0]?.location;
    if (seat === undefined) continue;
    const probe = probeEscrow(kind);
    if (probe > free) continue;
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
        `staying silent is a permanent public default. ${band}`,
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
  for (const claim of runtime.claimsOpenTo(principal, tick)) {
    if (claim.route === null) continue;
    if (claim.available_here < ANCHOR_QTY) continue;
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
        `destroys ${String(ANCHOR_QTY)} of ${claim.good} standing at ${claim.system}. You become the claimant of ` +
        `record — AND you inherit its ${String(claim.arrears)} arrears and this Reckoning's ` +
        `${String(claim.owed)} still owed, which a transfer never resets. Your holding must already stand there ` +
        `and you must have ${String(CLAIM_BOND_MINOR)} more bond posted per claim.`,
      expires_tick: claim.vulnerability.open ? claim.vulnerability.closes_tick : claim.deadline_tick,
      quote_id: quoteId(principal, tick, 'build', { kind: 'ANCHOR', system: claim.system }),
    });
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
        runtime.chargeGoodAt(principal, holding.system) >= ANCHOR_QTY
      ) {
        eligible.push({
          verb: 'build',
          params: { kind: 'ANCHOR', system: holding.system },
          cost: 1,
          max_direct_loss: ANCHOR_QTY,
          max_contingent_liability: CLAIM_BOND_MINOR,
          what_it_forecloses:
            `destroys ${String(ANCHOR_QTY)} of ${CHARGE_GOOD} standing at ${holding.system} and makes you its ` +
            `claimant. From the next Reckoning onward the claim owes a CHARGE in goods that must be standing ` +
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
      what_it_forecloses:
        `hands ${String(levyQuote.payable)} of ${CHARGE_GOOD} to the Levy at ${String(levyQuote.place)}, ` +
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
  if (levyBallot !== null && levyBallot['voted'] === false) {
    eligible.push({
      verb: 'vote',
      params: { ballot: LEVY_BALLOT, rule: PUBLISHED_DEFAULT_RULE },
      cost: 0,
      max_direct_loss: 0,
      max_contingent_liability: 0,
      what_it_forecloses:
        `decides how this Reckoning's Levy is SPLIT across your constellation. The total is fixed and ` +
        `cannot be voted away — only who bears which share. Swap \`rule\` for any of ` +
        `${LEVY_RULES.join(', ')}: BY_EXPOSURE loads it onto whoever has most at risk, BY_STORES onto ` +
        `whoever is holding most, EVEN spreads it flat, INVERSE_EXPOSURE shields the exposed. You are ` +
        `voting on a bill you will pay, so the rule that suits you is rarely the one that suits the ` +
        `others. Quorum failure applies ${PUBLISHED_DEFAULT_RULE}. Free, and it costs no action.`,
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
        `hands over up to ${String(levyQuote.payable)} of ${CHARGE_GOOD} each Reckoning until tick ` +
        `${String(tick + TICKS_PER_RECKONING * 2)}, and it will keep doing so whether or not you are ` +
        `watching — including when you would rather have spent those goods on something else. Raise ` +
        `\`until_tick\` to cover a longer absence, or send it again later to replace this one.`,
      expires_tick: tick + 1,
      quote_id: quoteId(principal, tick, 'set_delivery_intent', { obligation: 'LEVY' }),
    });
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
  for (const candidate of runtime.grantCandidates(principal, tick, MAX_GRANT_OFFERS)) {
    eligible.push({
      verb: 'grant',
      params: {
        to: candidate.to,
        template: 'treasury-hand',
        max_direct_loss: candidate.cap,
        max_contingent_liability: candidate.cap,
        expires_tick: candidate.expiresTick,
      },
      cost: 1,
      max_direct_loss: candidate.cap,
      max_contingent_liability: candidate.cap,
      what_it_forecloses:
        `puts ${candidate.to} in an OFFICE over your treasury until tick ` +
        `${String(candidate.expiresTick)}. From the tick it lands they may act in your name up to ` +
        `${String(candidate.cap)} of direct loss and ${String(candidate.cap)} of contingent liability, and ` +
        `you cannot undo an act they have already taken — only \`revoke\` what is left. They have kept ` +
        `${String(candidate.kept)} promise(s) to you and broken ${String(candidate.broke)}. That record is ` +
        `why this is offered and it is not a prediction: the grant, this warning, and whatever they do ` +
        `with it all land on the same public record, and it is read back at settlement. This list is a ` +
        `SHORTLIST, not a restriction — \`grant\` accepts any enrolled principal, including one you have ` +
        `never dealt with, and the engine will not stop you. What is shown here is the ` +
        `${String(MAX_GRANT_OFFERS)} with the strongest record with you, because an office is the ` +
        `heaviest thing you can hand out.`,
      expires_tick: tick + 1,
      quote_id: quoteId(principal, tick, 'grant', { to: candidate.to }),
    });
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
          `R+${String(trip)} and it is PRESENT — able to fill a role, work or escort — on R+${String(trip + 1)}.`,
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
  //     Eligibility is affordability, exactly as it is for `create`. A bid is offered
  //     only for a quantity the free stores can escrow in full, and an ask only for
  //     goods the principal actually holds at that venue, unpledged and not in
  //     transit — the same two doors `place.ts` refuses at. Offering more would be the
  //     server telling an agent to do something and then declining (AGT-S2).
  for (const book of books) {
    const askLevel = book.levels.ask[0];
    if (askLevel !== undefined && askLevel.price > 0) {
      const affordable = Math.min(askLevel.qty, Math.floor(free / askLevel.price), MAX_ORDER_QTY);
      if (affordable > 0) {
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
    if (bidLevel !== undefined && holding > 0) {
      const amount = Math.min(bidLevel.qty, holding, MAX_ORDER_QTY);
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
  const reasons: string[] = [];
  if (dropped > 0) {
    reasons.push(
      `${String(dropped)} further legal acts exist and were not sent, because one observation carries at most ` +
        `${String(MAX_AFFORDANCES)}. They are the lowest-priority repeats (extra lanes for an already-listed hand)`,
    );
  }
  if (notLive > 0) {
    // Counted, not silent. PROP-O1 is about omissions being *countable*, and "the
    // mechanic has not landed" is an omission the agent is entitled to know about.
    reasons.push(
      `${String(notLive)} act(s) you are otherwise eligible for name a verb whose mechanic has not landed yet; ` +
        'header.live_verbs is the current list',
    );
  }
  if (alternateHands > 0) {
    reasons.push(
      `${String(alternateHands)} further legal fill_role act(s) exist and are not listed: each open slot on ` +
        'ventures.board[] can be filled by ANY of your idle hands standing at that venture’s stage, and only ' +
        'one is offered per slot. hands[] lists them all, and which hand you send changes nothing about what ' +
        'the role pays',
    );
  }
  if (rowsOutOfReach > 0) {
    reasons.push(
      `${String(rowsOutOfReach)} slot(s) on ventures.board[] have no fill_role offered because you have no ` +
        `idle hand standing at their stage (${[...unreachedStages].sort(cmp).join(', ')}) — a hand fills a ` +
        'role where the venture happens, so `move` one there first and check the trip fits inside the window ' +
        'each row publishes in expires_tick',
    );
  }
  if (rowsWithNoHand > 0) {
    reasons.push(
      `${String(rowsWithNoHand)} slot(s) on ventures.board[] have no fill_role offered because none of your ` +
        'hands is both IDLE and present this tick — a hand that arrived this tick is not present until the ' +
        'next one. They are still on the board and still yours to take once a hand frees up',
    );
  }
  if (commonsBoundLanes > 0) {
    reasons.push(
      `${String(commonsBoundLanes)} move(s) onto lanes leaving the Commons are not offered because your ` +
        'holding is civic-leased in the Commons, so your hands are Commons-bound and may only move between ' +
        'COMMONS systems (A15). That is not a bug and it is not permanent: `graduate` moves your HOLDING one ' +
        'lane outward for a price, and from the tick it lands your hands are free to go anywhere. ' +
        'holding.graduation carries the price and the destinations',
    );
  }
  if (crossingWithheld > 0 && crossing !== null) {
    // Counted, never silent: this is the one omission that, left uncounted, would look
    // exactly like the defect a playtest already found — an exit that does not exist.
    reasons.push(
      `${String(crossingWithheld)} graduate act(s) exist and are not offered because the crossing is not ` +
        `affordable yet: it costs ${String(crossing.upkeepMinor)} currency (you have free ` +
        `${String(crossing.freeMinor)}) plus ${String(crossing.upkeepQty)} units of ${crossing.good} standing ` +
        `at ${crossing.from} (you have ${String(crossing.availableQty)} unpledged there). ` +
        'holding.graduation carries the same figures and the destinations, so the choice is still readable',
    );
  }
  if (worksWithheld > 0 && worksHere !== null) {
    reasons.push(
      `a WORKS at ${worksHere.system} is not offered because you cannot pay for it yet: it costs ` +
        `${String(worksHere.costMinor)} of your unlocked balance (you can spend ` +
        `${String(worksHere.freeMinor)} — pledged stores are withheld from that figure, your starter ` +
        'stake is not) plus ' +
        `${String(worksHere.costQty)} units of ${worksHere.good} standing here (you have ` +
        `${String(worksHere.availableQty)} unpledged). holding.works carries the same figures and the ` +
        'share you would get, so the decision is readable before you can afford it',
    );
  }
  if (crossingAnchored > 0 && crossing !== null) {
    reasons.push(
      `${String(crossingAnchored)} graduate act(s) exist and are not offered because you hold live claim(s) on ` +
        `${crossing.anchoring.join(', ')} — a claim is anchored by a body, so your holding cannot leave ` +
        'territory that would then have nobody standing on it. `abandon` returns part of the bond and ' +
        '`publish_offer` {"cede":…} sells the claim; either one opens the crossing again',
    );
  }
  if (chargeNoHand > 0) {
    // Counted with the sentence that fixes it, because the fix is one ordinary act. Left
    // uncounted this would read as "your Charge is unpayable", which is the shape of the
    // refusal loop that buries real rules-surface defects (AGT-S3).
    reasons.push(
      `${String(chargeNoHand)} Charge delivery(ies) exist and are not offered because none of YOUR hands is ` +
        `standing at ${[...new Set(chargeNoHandAt)].sort(cmp).join(', ')}. A Charge is goods physically handed ` +
        'over, so `move` a hand there first — `graduate` moved your holding and your stores, never your hands. ' +
        'obligations.charge[] carries `hand_here: false` and the full bill regardless, so the deadline stays ' +
        'readable; and any principal\'s hand may pay any claim\'s Charge, so hiring a carrier also works',
    );
  }
  if (demandCapacitySpent) {
    // ── COUNTED, BECAUSE A MENU THAT SHRINKS WITHOUT SAYING WHY TEACHES THE WRONG RULE ──
    //
    // §9's capacity is the anti-toll-cartel price and it is only a price if the agent knows it
    // is being charged. An agent that saw `demand` yesterday and does not see it today, with no
    // sentence, will conclude that predation is unreliable rather than that it is rationed —
    // and will not plan the one decision the mechanic exists to force: WHICH target, given that
    // you get two.
    reasons.push(
      `every demand you could open is withheld because you have spent all ${String(AGGRESSION_PER_RECKONING)} ` +
        'of this Reckoning\'s aggression capacity (§9). It refreshes at the next Reckoning and does NOT ' +
        'accumulate: unspent capacity is gone, so a standing toll is unfundable by design, and the real cost ' +
        'of a demand is the other demand you gave up. Answering somebody else\'s standoff with `join` costs ' +
        'none of it',
    );
  }
  if (boardDropped > 0) {
    // The list this sentence is about is `ventures.board[]` itself, one level above the
    // affordances. It slices at `MAX_LIST_ROWS`, and until this branch existed the payload
    // closed with "nothing you were eligible for has been dropped without this count" while
    // holding back eligible slots — the engine contradicting `agent.md` §6 in the same
    // breath as the count that exists to prevent exactly that.
    reasons.push(
      `${String(boardDropped)} further slot(s) you are eligible for are not on ventures.board[] at all, ` +
        `because one observation carries at most ${String(MAX_LIST_ROWS)} rows. The rows you did get are the ` +
        'ones a hand of yours can reach, sorted first for that reason; the rest come into view as these ' +
        'resolve, or sooner if you move a hand to a stage you are not standing at',
    );
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
        commonsBoundLanes +
        (demandCapacitySpent ? 1 : 0),
      reason:
        reasons.length === 0
          ? 'nothing was withheld: this is every legal act, with its full cost.'
          : `${reasons.join('; ')}. Nothing you were eligible for has been dropped without this count.`,
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

function ventureRow(
  runtime: Runtime,
  venture: VentureRecord,
  principal: PrincipalId,
): Readonly<Record<string, unknown>> {
  const role = roleOfPrincipal(venture, principal);
  return {
    id: venture.id,
    kind: venture.kind,
    state: venture.state,
    stage: venture.stage,
    creator: venture.creator,
    terms_hash: venture.termsHash,
    resolves_at_tick: venture.resolvesAtTick,
    window_closes_tick: venture.windowClosesTick,
    pinned_value: pinnedValue(venture),
    roles: venture.roles.map((r) => ({
      index: r.index,
      label: r.label,
      filled_by: r.filledByPrincipal,
      escrowed: r.terms.escrowed,
      elective: r.terms.elective,
      // §7.5: "the escrow ratio is published on the venture card". It became worth publishing the
      // moment `create` took `elective_bps` — before that it was the same number on every venture in
      // the world, which is why nothing read it.
      escrow_ratio_bps: escrowRatioBps(r.terms),
    })),
    my_role: role === null ? null : role.index,
    my_escrowed: role === null ? 0 : role.terms.escrowed,
    my_elective: role === null ? 0 : role.terms.elective,
    /**
     * Direction, because `my_elective` alone was read two opposite ways by capable
     * agents — one thought a filler *owes* it. The elective on a role YOU hold is paid
     * TO you by the venture's **creator** (the payer), if the creator honours it; you
     * never elect it, the creator does. So it is `OWED_TO_ME` when you filled someone
     * else's venture. On your OWN venture your own role is self-paid and can never be a
     * breach (scar #9), so it is `SELF`. What YOU owe as a creator is never here — it is
     * the `elect` affordances, one per role somebody else holds in your venture.
     */
    my_elective_direction:
      role === null ? null : venture.creator === principal ? 'SELF' : 'OWED_TO_ME',
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
): Readonly<Record<string, unknown>>[] {
  const named = new Set<PrincipalId>();
  for (const venture of mine) {
    named.add(venture.creator);
    for (const role of venture.roles) {
      if (role.filledByPrincipal !== null) named.add(role.filledByPrincipal);
    }
  }
  for (const row of board) named.add(row.creator);
  named.delete(principal);

  return [...named].sort(cmp).map((other) => standingRow(runtime, other));
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
    expires_tick: grant.expiresTick,
    revoked_at_tick: grant.revokedAtTick,
    live: runtime.grants.isLive(grant.id, tick),
  };
}

// ── Briefing ────────────────────────────────────────────────────────────────

/** One sentence naming the actual dilemma. Never a greeting. */
function promptFor(
  runtime: Runtime,
  principal: PrincipalId,
  mine: readonly VentureRecord[],
  board: readonly BoardRow[],
  fresh: boolean,
  tick: number,
): string {
  if (!fresh) {
    return 'You are outside a wake, so this snapshot carries no fresh affordances and no quote_id. Nothing here can be acted on; wait for your next wake or the next Reckoning.';
  }
  const unsigned = mine.filter((v) => v.state === 'FORMING' && !v.countersigned.has(principal));
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
  return `Nothing is waiting on you and ${String(idle)} of your hands are idle; an idle hand earns nothing, and the Commons is safe but poor.`;
}

/**
 * The concrete consequence at the next Reckoning if this principal does nothing.
 *
 * **Tested against reality** (PROP-O5), which is the reason it is computed from
 * the same rows settlement will read rather than written as reassuring prose. It
 * is High Water's `projectedDrown` generalised, and it is what lets a model
 * self-correct.
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

  if (parts.length === 0) {
    return `Nothing resolves for you before tick ${String(settlement)}. Your identity, your holding and your standing are unchanged — absence costs opportunity and nothing else.`;
  }
  return `${parts.join('; ')}.`;
}

// ── Small derivations ───────────────────────────────────────────────────────

function electiveOwed(venture: VentureRecord, principal: PrincipalId): number {
  // What the *creator* owes: the elective halves of every role it did not fill.
  if (venture.creator !== principal) return 0;
  let total = 0;
  for (const role of venture.roles) {
    if (role.filledByPrincipal === null) continue;
    if (role.filledByPrincipal === principal) continue;
    total += role.terms.elective - role.settledElectiveMinor;
  }
  return total;
}

/** What this payer has NOT elected on, netted against what it has. */
function unelectedElective(
  runtime: Runtime,
  venture: VentureRecord,
  principal: PrincipalId,
): number {
  if (venture.creator !== principal) return 0;
  let total = 0;
  for (const role of venture.roles) {
    if (role.filledByPrincipal === null) continue;
    if (role.filledByPrincipal === principal) continue;
    const stated = runtime.electionOn(venture.id, role.index);
    // `IN_FULL` covers whatever the due turns out to be, so nothing is left unelected.
    if (stated === IN_FULL) continue;
    const owed = runtime.electiveCeilingOf(venture, role.index);
    total += Math.max(0, owed - (stated ?? 0));
  }
  return total;
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
  for (const p of runtime.ledger.encumbrances.principalsWithExposure()) {
    total += runtime.ledger.encumbrances.cachedExposure(p);
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
