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
import type { PrincipalId, Standing, SystemId, VentureId, VentureKind } from '../core/types.js';
import { minor, type Minor } from '../core/units.js';
import { storesAccount } from '../ledger/index.js';
import { ACTIONS_PER_TICK } from '../core/time.js';
import {
  escrowRequired,
  IN_FULL,
  kindSpec,
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
import type { SealRoleRef } from '../seal/index.js';
import { handsOf, holdingOf, isPresent, occupiesSystem, tierOf, transitTicks } from '../world/index.js';
import {
  defaultTerms,
  DELIVERY_MEASURE,
  DELIVERY_VERB,
  ELECTABLE_VENTURE_STATES,
  type PendingCorrection,
  type Runtime,
} from '../sim/runtime.js';

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
 * Kinds offered as a `create` affordance.
 *
 * The two-role kinds only: a four-role kind needs four independently-capitalised
 * principals to be live in one window, and offering it to a newcomer with three
 * hands and nobody to call is an affordance that cannot be taken. RAID is excluded
 * because it is hostile and every newcomer is Commons-seated, where a hostile act
 * is *invalid* rather than merely refused (A8) — offering it would be offering a
 * move the floor will always reject.
 */
export const OFFERED_KINDS: readonly VentureKind[] = Object.freeze(['DIG', 'HAUL', 'ESCORT', 'SURVEY']);

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
  const mine = runtime.ventures.forPrincipal(principal);

  const solved = boardFor(runtime, principal, tick);
  const board = solved.rows;
  // The **same rows** the payload publishes are the rows the affordances are built from.
  // Solving the board twice would let `ventures.board[]` and the `fill_role` list disagree
  // about a hash or a price, which is the two-homes-for-one-rules-surface shape of scar #1.
  const affordanceSet = input.fresh && !input.stale
    ? affordancesFor(runtime, principal, tick, board, solved.dropped)
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
       * Empty, and truthfully so: predation lands at step 12, and there is no
       * mechanism in this build that can threaten a holding. An invented threat
       * would be a lie in the one field an agent would act on hardest.
       */
      threats: [],
      upkeep_due: 0,
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
      /** Grants land at step 9. Two empty lists, not an invented headroom. */
      granted: [],
      held: [],
    },

    market: {
      /** Markets land at step 11. An empty book, and no invented spread. */
      system: holding.system,
      best_bid: null,
      best_ask: null,
      depth: [],
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
function affordancesFor(
  runtime: Runtime,
  principal: PrincipalId,
  tick: number,
  board: readonly BoardRow[],
  /** Eligible slots the board's own cap dropped. See {@link boardFor}. */
  boardDropped: number,
): AffordanceSet {
  const eligible: Affordance[] = [];
  const world = runtime.world;
  const hands = handsOf(world, principal);
  const mine = runtime.ventures.forPrincipal(principal);
  const free = runtime.ledger.account(storesAccount(principal)) === undefined
    ? minor(0)
    : runtime.ledger.freeBalance(storesAccount(principal));

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
    eligible.push({
      verb: 'fill_role',
      params: { venture: row.venture, role: row.role, hand: idle.id, stake: 0 },
      cost: 1,
      max_direct_loss: 0,
      max_contingent_liability: 0,
      what_it_forecloses: first
        ? `hand ${idle.id} cannot fill another role while it is committed to this one, and you may hold at ` +
          `most one role in ${row.venture}. FILLING IS NOT CLOSING: the fill is allocated at tick close and ` +
          `the venture stays FORMING until every party has countersigned the same terms_hash. ${close} ` +
          `Unsigned by tick ${String(row.expires_tick)} and the window closes, the venture retires ABANDONED, ` +
          'and nothing you spent comes back.'
        : `hand ${idle.id} is committed until this resolves, and you may hold at most one role in ` +
          `${row.venture}. ${close} Unsigned by tick ${String(row.expires_tick)}: retired ABANDONED.`,
      expires_tick: row.expires_tick,
      quote_id: quoteId(principal, tick, 'fill_role', { venture: row.venture, role: row.role }),
    });
  }

  // 5. Create a venture, for each kind the stores can actually fund. Affordability
  //    is part of *eligibility*, so an affordance is never an offer you cannot take.
  for (const kind of OFFERED_KINDS) {
    const seat = hands[0]?.location;
    if (seat === undefined) continue;
    const probe = probeEscrow(kind);
    if (probe > free) continue;
    eligible.push({
      verb: 'create',
      params: { kind, stage: seat },
      cost: 1,
      max_direct_loss: probe,
      max_contingent_liability: probeElective(kind),
      what_it_forecloses: `${String(probe)} of your stores is locked in escrow until this settles or is abandoned.`,
      expires_tick: tick + QUOTE_PIN_TICKS,
      quote_id: quoteId(principal, tick, 'create', { kind, stage: seat }),
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
  for (const hand of hands) {
    if (hand.state !== 'IDLE') continue;
    const system = world.map.systems.get(hand.location);
    if (system === undefined) continue;
    for (const lane of [...system.lanes].sort(cmp)) {
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

  const list = offerable.slice(0, MAX_AFFORDANCES);
  const dropped = offerable.length - list.length;
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
      count: dropped + notLive + alternateHands + rowsWithNoHand + rowsOutOfReach + boardDropped,
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
  readonly wage: number | null;
  readonly share: number | null;
  readonly escrowed: number;
  readonly elective: number;
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
        wage: role.terms.wage,
        share: role.terms.share,
        escrowed: role.terms.escrowed,
        elective: role.terms.elective,
        // The slot's claim, not the reader's. Same arithmetic settlement will run.
        your_take_at_p50: slotClaimAt(venture, index, 'p50').claim,
        terms_hash: venture.termsHash,
        expires_tick: venture.windowClosesTick,
        resolves_at_tick: venture.resolvesAtTick,
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
    })),
    my_role: role === null ? null : role.index,
    my_escrowed: role === null ? 0 : role.terms.escrowed,
    my_elective: role === null ? 0 : role.terms.elective,
    countersigned: [...venture.countersigned].sort(cmp),
    i_have_signed: venture.countersigned.has(principal),
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
    /** Zero because bonds do not exist yet (§6.4), not because none was posted. */
    bond_posted: 0,
    sureties: [],
    /** The tick of the latest recorded default, or null. A stamp, never a count. */
    last_default: row.lastDefaultTick,
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
