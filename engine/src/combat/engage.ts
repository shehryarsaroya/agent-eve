/**
 * `engage` — the port, the single gate, and the two writers.
 *
 * ── WHY `engage` AND NOT `operate` ──────────────────────────────────────────
 *
 * `PASS-SHIPS-COMBAT-extended` §10 MUST-2 says *"add exactly one live-combat verb: `operate`"*, and
 * this ships `engage` instead. Hard rule 4 is why, and it is not a preference:
 *
 * - **`operation` is already spent.** `trade` takes an `operation` param — `TRADE_OPERATIONS =
 *   ['place','modify','cancel']` in `market/place.ts` — so an agent already sends
 *   `operation: 'place'` to the order book. A second `operation` meaning "a multi-tick battle" is one
 *   canon word carrying two concepts in the same action surface, which is scar #1's exact shape.
 * - **The verb and the noun must agree.** §3 is a rules surface, so the thing and the act that
 *   makes it want one word: an ENGAGEMENT is what `engage` opens. `operate` + ENGAGEMENT would be a
 *   verb whose noun is missing, which is the drift the canon exists to stop.
 * - **And `engagement` is collision-free** across SPEC, the passes, and `src/` — the only prior use
 *   was `world/hands.ts` calling the `COMMITTED` hand state "engaged" in three doc comments, which
 *   this change corrects to match the state's actual name.
 *
 * §17's verb budget is 40/40, so `engage` is paid for by **removing `flee`**. `flee` was in §12.2,
 * had no handler, and `api/verbs.ts:148` already argued it should never get one: *"flee is not a
 * second verb: move a hand off the stage and the raid misses; `move` already does this."* A canon
 * verb with no handler is this project's signature defect at the top level — it reads as built in
 * every summary and is unreachable — so the swap closes one hole and opens the layer. Net 40/40.
 *
 * ── ONE VERB, NO MODES, AND STOP CONDITIONS INSTEAD ─────────────────────────
 *
 * The pass gives `operate` five modes: `commit`, `order`, `broadcast`, `escalate`, `withdraw`. This
 * ships **none of them**, and the result is smaller *and* better:
 *
 * | pass mode | here |
 * |---|---|
 * | `commit` | the first `engage` on a battle. Names hull, echelon, posture, orders. |
 * | `order` | a later `engage` on the same formation. A3: *amending an intent costs an action.* |
 * | `withdraw` | `withdraw_if` — a **stop condition**, not an act |
 * | `broadcast` | `message` (§7.3) and the 140-char `reason`, both of which already exist |
 * | `escalate` | `commit` again with a reserve echelon released |
 *
 * The `withdraw_if` line is the one that matters. A3 says work is *"a durable intent with stop
 * conditions"* and §7 MUST-7 says *"fleet competence cannot be a function of owner polling
 * budget."* A retreat expressed as an *act* requires an agent to be awake at the moment the fight
 * turns; a retreat expressed as a *threshold* does not. So an offline agent's fleet withdraws
 * competently, which is the whole reason this design can have combat at all.
 *
 * And it makes the threshold a **promise on the public record**: §7 MUST-7's own example is
 * *"an agent can publicly claim it will hold tackle to 50% losses, then defect at 10%"* — which in
 * this world is a `claim`, a `withdraw_if`, and a `seal`, all three already built.
 */

import type { HandId, PrincipalId, SystemId, ZoneTier } from '../core/types.js';
import type { Qty } from '../core/units.js';
import { reject, type Rejection, type WorldResult } from '../world/result.js';
import type { RaidRecord, RaidSide } from '../predation/book.js';
import { hullSpec } from './catalogue.js';
import {
  ECHELONS,
  HOLD_FOREVER,
  isEchelon,
  isPosture,
  isTargetPredicate,
  POSTURES,
  TARGET_PREDICATES,
  type Book,
  type Echelon,
  type EngagementRecord,
  type Formation,
  type Posture,
  type TargetPredicate,
  type WithdrawWhen,
} from './book.js';
import { engagementIdFor } from './book.js';
import type { Fleet, HullId } from './fleet.js';
import { simulateFit, type FitProfile } from './fit.js';
import { MAX_RAID_PARTIES } from '../predation/params.js';
import {
  ENGAGEMENT_PHASE_TICKS,
  ENGAGEMENT_RULE_STATEMENT,
  GAP_MAX,
  MAX_FORMATIONS_PER_SIDE,
  MAX_LIVE_ENGAGEMENTS,
} from './params.js';

/**
 * Everything `engage` touches. Nothing else is reachable from here, which is the point.
 *
 * The reads are deliberately the *same* ones the resolver and the observation use, for
 * `DemandPort`'s stated reason: the force an agent is shown before it commits and the force the
 * resolver computes must come from one implementation, or the affordance and the outcome can
 * disagree — scar #1 with a warship at stake.
 */
export interface EngagePort {
  tierOf(system: SystemId): ZoneTier;
  /** IDLE hands this principal has present at `stage`. The crew a hull needs. */
  handsIdleAt(principal: PrincipalId, stage: SystemId): readonly HandId[];
  /** The standoff, or `undefined`. An engagement never exists without one. */
  raid(raidId: string): RaidRecord | undefined;
  /** Which side this principal is on in that standoff, or `null` if it is not a party. */
  sideIn(raid: RaidRecord, principal: PrincipalId): RaidSide | null;
  isSeated(principal: PrincipalId): boolean;
}

/** What building a hull touches. Narrow for the same reason. */
export interface ShipyardPort {
  tierOf(system: SystemId): ZoneTier;
  /** Unpledged units of a good this principal holds AT `system`. */
  goodsAt(principal: PrincipalId, system: SystemId, good: string): Qty;
  /** Destroy goods into the build. Returns what actually moved. */
  consume(args: {
    readonly principal: PrincipalId;
    readonly system: SystemId;
    readonly good: string;
    readonly qty: Qty;
    readonly eventId: string;
    readonly tick: number;
  }): Qty;
  /** Does this principal have a holding standing at `system`? A berth needs ground. */
  seatedAt(principal: PrincipalId, system: SystemId): boolean;
  // ── ★ NO `freeStoresOf`, AND ITS ABSENCE IS THE RULE ──────────────────────
  //
  // A `Minor` reader — the **currency** balance — sat here and **nothing in `shipyard.ts` ever
  // called it.** `build {kind:"HULL"}` is priced entirely in goods: `costFrame` in `ration` and
  // `costFuel` in `fuel`, both destroyed into the build, with no currency leg at all
  // (`hullBuildRefusal` checks `goodsAt` twice and nothing else). So the port advertised a
  // currency question to a verb that cannot ask one, and the next reader adding a price to
  // `build` had a typed, plausible, wrong figure ready to hand — which is the same
  // one-word-two-units family that produced `weightOf('BY_STORES')` and the `spare` pick.
  //
  // `predation/demand.ts` keeps its own `freeStoresOf` and should: a demand stakes
  // `RAID_JOIN_STAKE_MINOR` of **currency**, so there the reader is the price. Two ports, two
  // questions, and only one of them is about money.
}

/** What the caller has to name. Every field is the agent's own statement; none is derived. */
export interface EngageRequest {
  readonly principal: PrincipalId;
  /** The standoff. An engagement is opened on a raid, never on a place. */
  readonly raid: string;
  readonly tick: number;
  /** The hull to commit, or `null` to restate orders on formations already committed. */
  readonly hull: HullId | null;
  readonly echelon: Echelon;
  readonly posture: Posture;
  readonly primary: readonly TargetPredicate[];
  readonly withdrawWhen: WithdrawWhen;
  /** The hand to crew it, or `null` for "the first IDLE one I have there". */
  readonly handId: HandId | null;
}

/**
 * The **single** gate, called by both the affordance layer and the verb.
 *
 * `demandRefusal`'s pattern verbatim, and its reason: one predicate cannot drift from itself. An
 * affordance with its own copy offers moves the handler refuses, which costs an agent an action and
 * its trust in the menu — and this menu is the only thing that will ever tell a cast that combat
 * exists.
 *
 * Gates run in this published order:
 *
 * 1. seated · 2. the raid exists · 3. the raid is live · 4. it was answered FIGHT ·
 * 5. you are a party to it · 6. not the Commons · 7. the engagement is in a state that accepts this ·
 * 8. echelon and posture are real · 9. the primary list is real · 10. the withdrawal threshold is sane ·
 * 11. the hull exists, is yours, is READY, and is berthed at the stage · 12. a hand is free there ·
 * 13. the side has formation room · 14. the world is not already running too many battles.
 */
export function engageRefusal(
  port: EngagePort,
  book: Book,
  fleet: Fleet,
  req: EngageRequest,
): Rejection | null {
  // 1.
  if (!port.isSeated(req.principal)) {
    return reject('A8', 'engage needs a standing holding; a fleet with no home is not a party to anything.');
  }

  // 2–3.
  const raid = port.raid(req.raid);
  if (raid === undefined) {
    return reject('A2', `engage names a standoff and there is no raid "${req.raid}".`);
  }
  if (raid.state !== 'DEMANDED') {
    return reject(
      'A2',
      `raid ${raid.id} is ${raid.state}, not DEMANDED. A battle happens inside a live standoff — once the ` +
        `raid has resolved there is nothing left to contest.`,
    );
  }

  // 4. The engagement exists only on a contested standoff.
  if (raid.answer !== 'FIGHT') {
    return reject(
      'A2',
      `${raid.target} has not answered FIGHT on ${raid.id}` +
        (raid.answer === null ? ' — nothing is contested yet.' : ` — it answered ${raid.answer}.`) +
        ' A battle is what a refused demand becomes. If you are the target, `fight` first.',
    );
  }

  // 5.
  const side = port.sideIn(raid, req.principal);
  if (side === null) {
    // ══════════════════════════════════════════════════════════════════════════
    // **"YOU ARE NOT A PARTY" WAS A LIE WHEN THE STANDOFF WAS FULL, AND IT REPEATED EVERY TICK.**
    //
    // `sideIn` returns null for two completely different reasons and this used to give one answer to
    // both. Measured: a coalition of ten principals hit `MAX_RAID_PARTIES` = 8, the ninth and tenth
    // `join` were refused INV-26 — correctly — and then every `engage` those two sent for the rest of
    // the window came back *"you are not a party to raid:X. Take a side with `join` first"*. Which is
    // advice to retry the one action that cannot succeed, once per tick, until the raid resolves.
    //
    // That is worse than an unhelpful message. AGT-S3 is about refusal noise burying real defects, and
    // a refusal that names a **fixable** cause when the cause is **structural** does not just waste an
    // agent's action: it tells it something false about the world, on the surface A2 calls the
    // interface. A full battle is a fact about the standoff and the agent is entitled to read it.
    // ══════════════════════════════════════════════════════════════════════════
    if (raid.parties.length >= MAX_RAID_PARTIES) {
      return reject(
        'INV-26',
        `${raid.id} is FULL: all ${String(MAX_RAID_PARTIES)} party slots are taken, so no further principal ` +
          `can take a side in it and \`join\` would be refused too. You are not a party and cannot become ` +
          `one — this is the standoff's cap, not something you have failed to do. A coalition larger than ` +
          `${String(MAX_RAID_PARTIES)} principals has to be split across separate standoffs.`,
      );
    }
    return reject(
      'A2',
      `you are not a party to ${raid.id}. Take a side with \`join\` first — §9's standoff is what an ` +
        `engagement is fought inside, and only its parties bring hulls. ` +
        `${String(raid.parties.length)} of ${String(MAX_RAID_PARTIES)} party slots are taken.`,
    );
  }

  // 6. The Commons floor, stated here as well as enforced there, because a refusal that says
  //    "invalid" without saying why sends an agent looking for a wiki (A2).
  if (port.tierOf(raid.stage) === 'COMMONS') {
    return reject('A8', `${raid.stage} is COMMONS: hostile action there is invalid, not merely punished.`);
  }

  const engagement = book.forRaid(raid.id);

  // 7.
  if (req.hull !== null) {
    if (engagement !== undefined && engagement.state !== 'MUSTER') {
      return reject(
        'A2',
        `the battle over ${raid.id} is in ${engagement.state} and hulls may only be committed during MUSTER ` +
          `(${String(ENGAGEMENT_PHASE_TICKS.MUSTER)} ticks from the answer). ${ENGAGEMENT_RULE_STATEMENT}`,
      );
    }
    if (engagement === undefined && book.liveCount() >= MAX_LIVE_ENGAGEMENTS) {
      return reject(
        'A2',
        `${String(MAX_LIVE_ENGAGEMENTS)} battles are already running world-wide, which is the cap. ` +
          `This bounds the tick's combat work; it is not a judgement about your fleet.`,
      );
    }
  } else {
    if (engagement === undefined) {
      return reject(
        'A2',
        `no battle has opened over ${raid.id} yet, so there is no formation to give orders to. ` +
          `Name a \`hull\` to commit one.`,
      );
    }
    if (engagement.resolvedAtTick !== null) {
      return reject('A2', `the battle over ${raid.id} ended at tick ${String(engagement.resolvedAtTick)}.`);
    }
    if (book.formationsOf(engagement.id, req.principal).length === 0) {
      return reject(
        'A2',
        `you command no formation in the battle over ${raid.id}. Name a \`hull\` to commit one first.`,
      );
    }
  }

  // 8.
  if (!isEchelon(req.echelon)) {
    return reject('A2', `"${String(req.echelon)}" is not an echelon. The four are ${ECHELONS.join(' · ')}.`);
  }
  if (!isPosture(req.posture)) {
    return reject(
      'A2',
      `"${String(req.posture)}" is not a posture. The three are ${POSTURES.join(' · ')} — CLOSE drags the ` +
        `range shut, KITE holds it open, HOLD spends nothing on either and keeps its capacitor.`,
    );
  }

  // 9.
  if (req.primary.length === 0) {
    return reject(
      'A2',
      `engage needs a primary policy: an ordered list from ${TARGET_PREDICATES.join(' · ')}. This is the ` +
        `field that decides whether you kill the enemy's repair wing or farm its cheapest hull.`,
    );
  }
  for (const predicate of req.primary) {
    if (!isTargetPredicate(predicate)) {
      return reject('A2', `"${String(predicate)}" is not a target predicate. The seven are ${TARGET_PREDICATES.join(' · ')}.`);
    }
  }

  // 10.
  const when = req.withdrawWhen;
  if (when.ehpBelowBps < 0 || when.ehpBelowBps > 10_000) {
    return reject('A2', `withdraw_if.ehp_below_bps is ${String(when.ehpBelowBps)}; it must be 0..10000 (0 = never).`);
  }
  if (when.hullsLost < 0) {
    return reject('A2', `withdraw_if.hulls_lost is ${String(when.hullsLost)}; it must be 0 or more (0 = never).`);
  }

  if (req.hull === null) return null;

  // 11.
  const record = fleet.get(req.hull);
  if (record === undefined) {
    return reject('A2', `there is no hull "${String(req.hull)}".`);
  }
  if (record.owner !== req.principal) {
    return reject('A2', `hull ${String(req.hull)} is ${record.owner}'s, not yours. A grant does not fly it for you yet.`);
  }
  if (record.state === 'WRECKED') {
    return reject('A2', `hull ${String(req.hull)} was wrecked at tick ${String(record.wreckedAtTick)}. Loss is permanent (A5).`);
  }
  if (record.state === 'FITTING') {
    return reject(
      'A2',
      `hull ${String(req.hull)} is still fitting out and is committable from tick ${String(record.readyAtTick)}.`,
    );
  }
  if (record.state === 'ENGAGED') {
    return reject('A2', `hull ${String(req.hull)} is already in a battle. One hull, one fight.`);
  }
  if (record.location !== raid.stage) {
    return reject(
      'A2',
      `hull ${String(req.hull)} is berthed at ${record.location} and the battle is at ${raid.stage}. A hull does ` +
        `not travel: to fight somewhere you must have BUILT there, which is what makes a fleet something ` +
        `somebody hauled.`,
    );
  }

  // 12.
  const committed = book.committedHands(req.principal);
  const free = port.handsIdleAt(req.principal, raid.stage).filter((h) => !committed.has(h));
  if (req.handId !== null && !free.includes(req.handId)) {
    return reject(
      'A2',
      `hand ${String(req.handId)} is not IDLE at ${raid.stage}, or is already crewing a hull in a battle. ` +
        `One hand crews one hull.`,
    );
  }
  if (free.length === 0) {
    return reject(
      'A6',
      `you have no IDLE hand at ${raid.stage} to crew it. A hull without a hand is a berthed asset, not a ` +
        `combatant — which is the presence scarcity every other mechanic in this game is priced against.`,
    );
  }

  // 13.
  if (engagement !== undefined) {
    const mine = engagement.formations.filter((f) => f.side === side);
    const wouldCoalesce = mine.some(
      (f) => f.principal === req.principal && f.fit === record.fit && f.echelon === req.echelon && f.posture === req.posture,
    );
    if (!wouldCoalesce && mine.length >= MAX_FORMATIONS_PER_SIDE) {
      return reject(
        'A2',
        `the ${side} side already fields ${String(MAX_FORMATIONS_PER_SIDE)} formations. Commit this hull to the ` +
          `same echelon and posture as one you already hold and they coalesce into one cohort instead.`,
      );
    }
  }

  return null;
}

/**
 * Open the battle a refused demand became. Called from the tick, never from a verb.
 *
 * `seedCommit` is `hash(seed)` published now; the seed itself is revealed at AFTERMATH. A11
 * (*"`hash(seed(T))` is published before actions for T are accepted"*) applied to a battle, which is
 * what §2 MUST-5 asks for: *"Each operation seed is committed by hash at declaration and revealed in
 * Aftermath."* Without it a losing agent can always claim the resolver was tuned against it, and
 * with it that claim is checkable.
 */
export function openEngagement(args: {
  readonly book: Book;
  readonly raid: RaidRecord;
  readonly tick: number;
  readonly seedCommit: string;
}): EngagementRecord {
  const record: EngagementRecord = {
    id: engagementIdFor(args.raid.id),
    raid: args.raid.id,
    stage: args.raid.stage,
    target: args.raid.target,
    initiator: args.raid.initiator,
    worldForce: args.raid.initiator === null ? args.raid.force : 0,
    openedAtTick: args.tick,
    state: 'MUSTER',
    phaseEndsTick: args.tick + ENGAGEMENT_PHASE_TICKS.MUSTER,
    gap: GAP_MAX,
    seedCommit: args.seedCommit,
    formations: [],
    wrecks: [],
    trace: [],
    fieldControl: null,
    resolvedAtTick: null,
  };
  args.book.open(record);
  return record;
}

/** What an accepted `engage` produced, for the caller to emit and wake on. */
export interface EngageResult {
  readonly engagement: EngagementRecord;
  readonly formation: Formation;
  /** True when this call committed a hull rather than restating an order. */
  readonly committed: boolean;
  readonly profile: FitProfile;
}

/**
 * Commit a hull, or restate a formation's orders. **The gate has already run.**
 *
 * Two orderings are load-bearing and both are `openDemand`'s: mark the hull COMMITTED *before*
 * writing the formation, so a throw can never leave a formation crewed by a hull the fleet still
 * thinks is free; and never write a formation without a hand, so `state_hash` cannot hold a cohort
 * with nothing in it.
 */
export function engage(
  port: EngagePort,
  book: Book,
  fleet: Fleet,
  req: EngageRequest,
): WorldResult<EngageResult> {
  const refusal = engageRefusal(port, book, fleet, req);
  if (refusal !== null) return refusal;

  const raid = port.raid(req.raid);
  if (raid === undefined) return reject('A2', `no raid "${req.raid}".`);
  const side = port.sideIn(raid, req.principal);
  if (side === null) return reject('A2', `you are not a party to ${raid.id}.`);
  const engagement = book.forRaid(raid.id);
  if (engagement === undefined) {
    return reject('A2', `no battle has opened over ${raid.id}. It opens the tick after ${raid.target} answers FIGHT.`);
  }

  // ── Restate orders ────────────────────────────────────────────────────────
  if (req.hull === null) {
    const mine = book.formationsOf(engagement.id, req.principal);
    const target =
      mine.find((f) => f.echelon === req.echelon && f.posture === req.posture) ?? mine[0];
    if (target === undefined) return reject('A2', `you command no formation in the battle over ${raid.id}.`);
    const formation = book.reorder({
      engagement: engagement.id,
      formation: target.id,
      primary: req.primary,
      withdrawWhen: req.withdrawWhen,
    });
    const profile = profileOfFit(fleet, formation.fit);
    if (profile === null) return reject('A2', `formation ${formation.id} carries a fit the catalogue no longer knows.`);
    return { ok: true, value: { engagement, formation, committed: false, profile } };
  }

  // ── Commit a hull ─────────────────────────────────────────────────────────
  const record = fleet.require(req.hull);
  const simulated = simulateFit(record.hull, record.modules);
  if (!simulated.ok) return simulated;
  const profile = simulated.value;

  const committedHands = book.committedHands(req.principal);
  const free = port.handsIdleAt(req.principal, raid.stage).filter((h) => !committedHands.has(h));
  const hand = req.handId ?? free[0];
  if (hand === undefined) {
    return reject('A6', `you have no IDLE hand at ${raid.stage} to crew ${String(req.hull)}.`);
  }

  fleet.commit(req.hull);
  const formation = book.commit({
    engagement: engagement.id,
    principal: req.principal,
    side,
    fit: profile.fitHash,
    hull: record.hull,
    hand,
    hullId: req.hull,
    echelon: req.echelon,
    posture: req.posture,
    primary: req.primary,
    withdrawWhen: req.withdrawWhen,
    ehpPerHull: profile.ehp,
    capPerHull: profile.capacitor,
    tick: req.tick,
  });

  return { ok: true, value: { engagement, formation, committed: true, profile } };
}

/**
 * Recompute the profile behind a fit hash, from any hull in the fleet that carries it.
 *
 * A formation stores its `fitHash`, not its module list — the fleet holds the modules, and a hash is
 * an identity precisely because every hull carrying it has the same list. So this is a lookup, never
 * a reconstruction: it finds a hull with that hash and re-simulates from *its* modules, which is the
 * same arithmetic the resolver runs. Duplicating the list on the formation would be scar #5 (two
 * homes for one quantity) on the fit.
 */
export function profileOfFit(fleet: Fleet, fit: string): FitProfile | null {
  const carrier = fleet.all().find((h) => h.fit === fit);
  if (carrier === undefined) return null;
  if (hullSpec(carrier.hull) === undefined) return null;
  const simulated = simulateFit(carrier.hull, carrier.modules);
  return simulated.ok ? simulated.value : null;
}

/** The default withdrawal threshold: hold forever. Stated so the affordance can name it. */
export const DEFAULT_WITHDRAW: WithdrawWhen = HOLD_FOREVER;

/**
 * The default primary policy, and it is deliberately **not** `['WEAKEST']`.
 *
 * §7 MUST-7 requires competent defaults (*"CUT timeout paralysis"*), and the competent default is the
 * one a human fleet commander uses: kill the force multipliers, then the tackle holding you, then
 * whatever is nearest death. An agent that never sets this field still fights sensibly; an agent that
 * sets it badly can be beaten for it, which is the decision §7 MUST-4 exists to create.
 */
export const DEFAULT_PRIMARY: readonly TargetPredicate[] = Object.freeze([
  'REPAIR',
  'COMMAND',
  'TACKLE',
  'WEAKEST',
] as unknown as TargetPredicate[]);
