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
import { inFreeze, isSettlementTick } from '../core/time.js';
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
import { IN_FULL, openIndices, roleOfPrincipal, type Election } from '../venture/index.js';
import { handsOf, holdingOf, route, tierOf } from '../world/index.js';
import {
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
}

/** Default appetite. *(calibrate)* — high enough that a day has ventures in it. */
export const DEFAULT_CREATE_CHANCE_BPS = 2_000;

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
    const build = this.worksFor(member, tick, rng);
    if (build !== null) return { ...base, ...build };

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

    if (idle.length > 0) {
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

    const appetite = this.options.createChanceBps ?? DEFAULT_CREATE_CHANCE_BPS;
    if (idle.length > 0 && rng.chance(appetite, 10_000)) {
      const hand = idle[0];
      if (hand !== undefined) {
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

    if (idle.length > 0) {
      const hand = idle[rng.int(idle.length)];
      if (hand !== undefined) {
        const system = runtime.world.map.systems.get(hand.location);
        if (system !== undefined && system.lanes.length > 0) {
          // Stay in the tier it was seated in: a Commons-bound principal may only
          // move between Commons systems (A15), and a refused move is a wasted bot.
          const home = tierOf(runtime.world.map, member.seat);
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
    const hand = idle[0];
    if (hand === undefined) return null;
    const path = route(runtime.world.map, hand.location, place);
    const next = path?.path[1];
    if (next === undefined) return null;
    // Stay inside the tier this member was seated in: a Commons-bound principal may only
    // move between Commons systems (A15), and the delivery place is chosen to be reachable
    // (`levy/place.ts`) — so a route leaving the tier means the route is not this
    // principal's to take, and the refusal would be a wasted bot every tick.
    if (tierOf(runtime.world.map, next) !== tierOf(runtime.world.map, member.seat)) return null;
    return { verb: 'move', params: { hand: hand.id, to: next } };
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
