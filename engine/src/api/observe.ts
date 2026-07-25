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
import type { PrincipalId, SystemId, VentureId, VentureKind } from '../core/types.js';
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
import type { SealRoleRef } from '../seal/index.js';
import { handsOf, holdingOf, tierOf } from '../world/index.js';
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

  const board = boardFor(runtime, principal, tick);
  const affordanceSet = input.fresh && !input.stale
    ? affordancesFor(runtime, principal, tick)
    : { list: [] as Affordance[], withheld: notAWake(input.wakesRemaining) };

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
       * **Null, not zero.** The Levy lands at SPEC §16 step 10. `my_assessment: 0`
       * would read as "assessed at nothing", which is a claim about a mechanic that
       * has not run; null reads as "not assessed", which is the truth.
       */
      levy: null,
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
      prompt: promptFor(runtime, principal, mine, board, input.fresh),
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

function notAWake(wakesRemaining: number): Withheld {
  return {
    count: 0,
    reason:
      wakesRemaining > 0
        ? 'this observation is the cached tick snapshot: the world is PAUSED, so there is nothing you can legally do until it resumes.'
        : `you have spent all ${String(WAKES_PER_RECKONING)} wakes this Reckoning. This snapshot is legal, free, and carries no fresh affordance and no quote_id. Wakes reset at the next Reckoning.`,
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
function affordancesFor(runtime: Runtime, principal: PrincipalId, tick: number): AffordanceSet {
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

  // 4. Fill an open role you are eligible for.
  for (const row of boardFor(runtime, principal, tick)) {
    const idle = hands.find((h) => h.state === 'IDLE');
    if (idle === undefined) break;
    eligible.push({
      verb: 'fill_role',
      params: { venture: row.venture, role: row.role, hand: idle.id, stake: 0 },
      cost: 1,
      max_direct_loss: 0,
      max_contingent_liability: 0,
      what_it_forecloses: `hand ${idle.id} cannot fill another role while it is committed to this one.`,
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
  for (const hand of hands) {
    if (hand.state !== 'IDLE') continue;
    const system = world.map.systems.get(hand.location);
    if (system === undefined) continue;
    for (const lane of [...system.lanes].sort(cmp)) {
      eligible.push({
        verb: 'move',
        params: { hand: hand.id, to: lane },
        cost: 1,
        max_direct_loss: 0,
        max_contingent_liability: 0,
        what_it_forecloses: 'this hand cannot fill a role until it arrives; an arrival is not present until the next tick.',
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
  return {
    list,
    withheld: {
      count: dropped + notLive,
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

interface BoardRow {
  readonly venture: VentureId;
  readonly role: number;
  readonly label: string;
  readonly kind: string;
  readonly stage: SystemId;
  readonly wage: number | null;
  readonly share: number | null;
  readonly escrowed: number;
  readonly elective: number;
  readonly your_take_at_p50: number;
  readonly expires_tick: number;
  readonly resolves_at_tick: number;
}

/**
 * Only slots this principal is eligible for (§12.1: server-side eligibility
 * filtering). "One principal fills at most one role", so a venture it already
 * holds a role in is filtered out here rather than refused later.
 */
function boardFor(runtime: Runtime, principal: PrincipalId, tick: number): BoardRow[] {
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
        wage: role.terms.wage,
        share: role.terms.share,
        escrowed: role.terms.escrowed,
        elective: role.terms.elective,
        your_take_at_p50: yourTakeAtP50(venture, principal),
        expires_tick: venture.windowClosesTick,
        resolves_at_tick: venture.resolvesAtTick,
      });
    }
  }
  return rows
    .sort((a, b) => cmp(a.venture, b.venture) || a.role - b.role)
    .slice(0, MAX_LIST_ROWS);
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
  for (const row of board) {
    const venture = runtime.ventures.get(row.venture);
    if (venture !== undefined) named.add(venture.creator);
  }
  named.delete(principal);

  return [...named].sort(cmp).map((other) => ({
    principal: other,
    /**
     * The public factual vectors, never a score (§3). Standing accrues only at
     * settlement, which lands with the Reckoning driver; these read zero because
     * nothing has settled, not because we chose not to say.
     */
    standing: {
      elective_honoured: 0,
      elective_honoured_value: 0,
      defaults: 0,
      contradicted_seals: 0,
      distinct_counterparties: 0,
    },
    bond_posted: 0,
    sureties: [],
    last_default: null,
  }));
}

// ── Briefing ────────────────────────────────────────────────────────────────

/** One sentence naming the actual dilemma. Never a greeting. */
function promptFor(
  runtime: Runtime,
  principal: PrincipalId,
  mine: readonly VentureRecord[],
  board: readonly BoardRow[],
  fresh: boolean,
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
    return first === undefined
      ? 'There are open roles you are eligible for.'
      : `${String(board.length)} open role(s) you are eligible for, the nearest being ${first.label} on ${first.venture} at ${String(first.elective)} elective — which is the only part that will ever build your standing.`;
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

  const forming = mine.filter((v) => v.state === 'FORMING');
  if (forming.length > 0) {
    parts.push(
      `${String(forming.length)} forming venture(s) never go live, their windows close, and their escrow stays locked until you abandon them`,
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
