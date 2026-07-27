/**
 * `demand` — §9's **agent-initiated standoff**, and the first piece of Phase 2.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHAT THIS ADDS THAT WORLD RAIDS COULD NOT.**
 *
 * A14 exists because *"silence is their rational default"*, and world-spawned raids answer it:
 * the world attacks somebody on a published clock whether or not anyone wants it. That made
 * conflict **happen**. It did not make conflict a **choice** — and every story worth watching
 * in this design is somebody's choice with their name on it. §9's second form is where a
 * principal decides, out of a capacity that expires unspent, that today it is going to take
 * something from a named neighbour.
 *
 * A world raid is weather. A demand is a *character* doing something, and the frame draws it
 * differently for exactly that reason (A13).
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── WHAT IS DELIBERATELY REUSED, AND WHY THAT IS THE POINT ───────────────────
 *
 * §9 says agent-initiated raids *"use the corpus's own deterministic engine, which was already
 * written"*. So this module opens a row in the **same book**, with the same window, the same
 * `join` on either side, the same `YIELD | FIGHT`, the same `readForce` arithmetic, the same
 * resolution, the same `PRD-1..7`, and the same pixel signature. There is no second raid
 * engine and no second spelling of any of it — that would be §3's forbidden second concept
 * wearing an implementation's clothes, and the two would drift the first time either changed.
 *
 * The whole feature is therefore: **one field on the record, one gate in front of it, and
 * three places that read the field.**
 *
 * ── THE FIVE DECISIONS THAT ARE NOT OBVIOUS ──────────────────────────────────
 *
 * **1. A demand's own force is ZERO. All of it is hands.** A world raid carries `force` drawn
 * from a published band — that is the weather term, and there is no weather in a decision. The
 * initiator instead joins its own raid as a `RAIDER` party, so its force is counted by exactly
 * the rule every other party's is: `readForce`'s `handsAtStage`, re-measured **at resolution**.
 * Pinning the initiator's force at spawn would reopen the hole `resolve.ts` documents at
 * length — join, march the hand away, keep the force — and it would reopen it for the one
 * party that chose the fight.
 *
 * The consequence is a calibration this design wants: `FORCE_BY_TIER` gives the Marches 1 and
 * the Frontier 0, ties go to the defender, so **a lone demand in the Marches loses to silence
 * and a lone demand on the Frontier beats it.** The policed zone is policed; the frontier is
 * not; and taking anything from a defended place needs somebody to stand with you.
 *
 * **2. There is no check that the target actually has anything.** Deliberate, and it is a
 * §11.2 decision rather than laziness: a gate reading the target's stock would answer
 * *"does p:x hold 2,000 rations at OPS-7?"* to any principal willing to spend an action, which
 * is a `SENSED` quantity served through a refusal. §11.2 promises the opposite — *"a raider
 * that guesses wrong hits ballast"* — and `takeFor` already delivers exactly that: a demand
 * against an empty stage resolves `MISSED`, having cost the raider a stake, a hand and one of
 * two demands it had this cycle. **Scouting is the counterplay, and it stays a real one.**
 *
 * **3. A demand writes NO victim cooldown and NO stage hold.** Those are the *world raid's*
 * price for losing — see `params.ts`: nobody owns a world raid, so the only thing it can lose
 * is future access. An agent-initiated raid loses **capital** (the stake, forfeited to the
 * defender) and **capacity**, so it does not need the access currency, and letting it spend
 * that currency would be an exploit with §9's own name on it: two cooperating principals could
 * mint a Reckoning of immunity from the world by arranging to be demanded from. That is the
 * Coase-collapse upside down — instead of paying a raider a toll to be left alone, you pay a
 * friend to attack you — and it needs no declared related-party edge to run, which is why the
 * answer has to be structural rather than a graph lookup (A15: never infer relatedness).
 *
 * A demand still **honours** both protections when it opens. Protections are granted by the
 * world and consumed by everybody; they are minted by nobody.
 *
 * **4. Predating yourself is refused outright, not merely made worthless.** §9: *"related-party
 * losses yield zero salvage, zero standing — else mutual predation between my own principals is
 * a faucet plus a bravery receipt."* The general form needs a related-party graph and this
 * build has none populated (`RelatedPartyGraph` exists and no edge is ever declared), so the
 * one case that is decidable without inference is the one enforced here. `PRD-7` asserts it on
 * the record as well, because a gate is a caller behaving well and an invariant is a rule.
 *
 * **5. The window must not run into the freeze.** `assertRaidSchedule` guarantees this for the
 * world's three spawn phases at construction; an agent can act at any tick, so the same rule
 * has to be a per-demand gate. §5.1's freeze is hard and admits no raid resolution, so a demand
 * that would resolve inside it could only be silently dropped or illegally resolved — and both
 * are a permanent public fact about a real agent that the rules made impossible to avoid.
 */

import { phaseOfReckoning, reckoningIndex, TICKS_PER_RECKONING, WINDOW_FIRST_PHASE } from '../core/time.js';
import type { GoodId, HandId, PrincipalId, SystemId, ZoneTier } from '../core/types.js';
import { minor, qty, type Minor, type Qty } from '../core/units.js';
import { reject, type Rejection, type WorldResult } from '../world/result.js';
import { aggressionNote, aggressionRemaining, AGGRESSION_PER_RECKONING } from './aggression.js';
import { Book, demandIdFor, type RaidId, type RaidRecord } from './book.js';
import {
  DEMAND_WINDOW_TICKS,
  MAX_LIVE_RAIDS,
  RAID_DEMAND_QTY,
  RAID_JOIN_STAKE_MINOR,
} from './params.js';
import { resolvesAt } from './schedule.js';

/**
 * A demand carries **no weather term**. See decision 1 in the header.
 *
 * Declared as a named constant rather than written `0` at the call site, because the number is
 * a rule an agent is told (`DEMAND_RULE_STATEMENT` states it) and a literal in one branch is
 * how the engine and the agent-facing text start disagreeing (scar #1).
 */
export const DEMAND_OWN_FORCE = 0;

/**
 * The rule, as one sentence, for the agent that is about to spend a hand on it.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THIS STRING IS A RULES SURFACE** (hard rule 4), the same as `RAID_TARGET_STATEMENT`, and
 * `test/predation/demand.spec.ts` pins every number in it to the constant it came from. An
 * agent that believes its capacity banks will plan a campaign it can never fund; one that
 * believes a demand carries the world's force will walk one hand into a repulse.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const DEMAND_RULE_STATEMENT =
  'A demand is a raid you open yourself, and it is the only predation in this game that has a name on ' +
  'it. It costs one of your aggression capacity for the Reckoning, which DOES NOT CARRY — unspent ' +
  'capacity is gone at the next Reckoning, so a standing toll is unfundable by design (§9). You state ' +
  'the place, the good and the quantity; the demand is pinned and never recomputed. Unlike a world ' +
  'raid a demand brings NO force of its own: all of it is hands, counted at resolution, so one hand ' +
  'against the Marches (terrain 1) ties and TIES GO TO THE DEFENDER — bring somebody, or aim at the ' +
  'Frontier, where terrain is 0. You stake slashable capital and one IDLE hand; if the target repulses ' +
  'you the stake goes to it and the hand goes RECOVERING. Nothing tells you what the target holds ' +
  'before you commit: guess wrong and you hit ballast (MISSED) having paid in full. Beating a demand ' +
  'buys the defender the stake and nothing else — a demand writes no stage hold and no victim ' +
  'cooldown, so nobody can arrange to be attacked in order to be left alone by the world.';

/**
 * Everything `demand` touches. Nothing else is reachable from here, which is the point.
 *
 * Narrow on purpose, and the two read methods are **the same two the resolver and the
 * observation already use** (`RaidViewPort`) rather than second copies: the force an agent is
 * shown before it commits and the force the resolver computes must come from one
 * implementation, or the affordance and the outcome can disagree — scar #1 with a hand and a
 * hold at stake.
 */
export interface DemandPort {
  tierOf(system: SystemId): ZoneTier;
  /** IDLE hands this principal has present at `stage`. The force a raid is made of. */
  handsDefending(principal: PrincipalId, stage: SystemId): readonly HandId[];
  /** Is this principal enrolled with a standing holding? A demand on a ghost is nothing. */
  isSeated(principal: PrincipalId): boolean;
  /** Unencumbered currency in the principal's stores. What the stake has to come out of. */
  freeStoresOf(principal: PrincipalId): Minor;
  /**
   * Lock the stake, returning the encumbrance id, or `null` if it could not be locked.
   *
   * A port method rather than something the adapter does afterwards, so that this module owns
   * the **ordering**: lock, then write the row. Writing first and locking after would leave a
   * live demand backed by nothing if the lock failed, which is an attacker with no risk — A7's
   * named failure — recorded as though it had paid.
   */
  lockStake(args: {
    readonly raid: RaidId;
    readonly principal: PrincipalId;
    readonly amount: Minor;
    readonly tick: number;
  }): string | null;
}

/** What the caller has to name. Every field is the agent's own statement, none is derived. */
export interface DemandRequest {
  readonly initiator: PrincipalId;
  readonly target: PrincipalId;
  readonly stage: SystemId;
  readonly good: GoodId;
  readonly demand: Qty;
  readonly tick: number;
  /** The hand to commit, or `null` for "the first IDLE one I have there". */
  readonly handId: HandId | null;
}

/**
 * The last tick in a Reckoning at which a demand may be opened.
 *
 * A phase, not a tick: `phase + DEMAND_WINDOW_TICKS` must land strictly before the commitment
 * window opens, which is exactly the arithmetic `assertRaidSchedule` applies to the world's
 * three spawn phases. Published, so an agent can plan its cycle rather than discover the wall.
 */
export const LAST_DEMAND_PHASE = WINDOW_FIRST_PHASE - DEMAND_WINDOW_TICKS - 1;

/**
 * **Every gate on `demand`, in one place, in published order.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE AFFORDANCE AND THE VERB CALL THIS SAME FUNCTION**, and that is not tidiness — it is
 * the fix for this project's signature defect in both directions at once. A verb whose gate
 * lives in the handler grows an affordance that offers illegal moves; an affordance with its
 * own copy of the gate grows a mechanic that is legal and unreachable (nine of those shipped
 * here, `grant` among them). One predicate cannot drift from itself.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Returns the refusal an agent reads, or `null` when the act is legal right now.
 */
export function demandRefusal(port: DemandPort, book: Book, req: DemandRequest): Rejection | null {
  // 1. Yourself. §9's related-party clause, in the one form decidable without a graph.
  if (req.initiator === req.target) {
    return reject(
      'A15',
      'you cannot demand from yourself. §9 gives related-party losses zero salvage and zero standing, ' +
        'because mutual predation between principals under one hand would be a faucet plus a bravery ' +
        'receipt — an attack that costs its owner nothing and prints a record of courage.',
    );
  }

  // 2. Somebody has to be there to demand from.
  if (!port.isSeated(req.target)) {
    return reject(
      'A2',
      `${req.target} is not a principal with a standing holding, so there is nobody at the other end of ` +
        'this demand. Name a principal you can see in counterparties[] or on the map.',
    );
  }

  // 3. A8, and it is checked here as well as at the floor because a floor held up by one
  //    caller behaving well is not a floor. `PRD-1` then halts on the result anyway.
  const tier = port.tierOf(req.stage);
  if (tier === 'COMMONS') {
    return reject(
      'A8',
      `${req.stage} is in the Commons, where hostile action is INVALID rather than punished. Nothing ` +
        'there can be demanded from, by you or by the world, and nothing you do will make it legal. ' +
        'Aim at the Marches or the Frontier.',
    );
  }

  // 4. §5.1: the freeze admits no raid resolution, so a window that would run into it is
  //    refused before it exists rather than dropped after (A5′).
  const phase = phaseOfReckoning(req.tick);
  if (phase > LAST_DEMAND_PHASE) {
    const reopens = req.tick - phase + TICKS_PER_RECKONING;
    return reject(
      'INV-18',
      `a demand opened now would resolve ${String(DEMAND_WINDOW_TICKS)} ticks from here, at phase ` +
        `${String(phase + DEMAND_WINDOW_TICKS)} of ${String(TICKS_PER_RECKONING)} — inside the commitment ` +
        `window, the freeze or the settlement, where §5.1 admits no raid resolution at all. The last phase ` +
        `a demand may open at is ${String(LAST_DEMAND_PHASE)}; demands reopen at tick ${String(reopens)}. ` +
        'Nothing was spent.',
    );
  }

  // 5. §9's price. Checked before the stake so the scarcest resource is named first.
  const remaining = aggressionRemaining(
    book.aggressionSpends(),
    req.initiator,
    req.tick,
    reckoningIndex,
  );
  if (remaining <= 0) {
    return reject('A14', aggressionNote(0));
  }

  // 6 & 7. The world's two protections, honoured and never minted (decision 3).
  if (book.isStageHeld(req.stage, req.tick)) {
    return reject(
      'A2',
      `a raid was repulsed at ${req.stage} and the defenders hold the field until tick ` +
        `${String(book.stageHeldUntil(req.stage) ?? req.tick)}. A won defence buys a real, published, ` +
        'time-bounded peace at that place, and it would buy nothing if the next raider could open one the ' +
        'same tick.',
    );
  }
  if (book.isVictimCooling(req.target, req.tick)) {
    return reject(
      'A2',
      `${req.target} was raided recently and is out of range until tick ` +
        `${String(book.victimCooledUntil(req.target) ?? req.tick)}. The per-victim cooldown is scar #14 by ` +
        'name — a fresh agent\'s only asset drowned on turn one — and it protects against you exactly as ' +
        'it protects against the world.',
    );
  }

  // 8 & 9. One live raid per target and one per stage — the world's own rule (`predate.ts`),
  //        because two at once on one principal stack the take past the cap that keeps an
  //        absent agent's loss proportionate, and two arcs on one system is a map a viewer
  //        cannot read (A13).
  for (const live of book.live()) {
    if (live.target === req.target) {
      return reject(
        'A2',
        `${req.target} is already under raid ${live.id}, which resolves at tick ` +
          `${String(live.resolvesAtTick)}. One live raid per target: two at once would stack the take past ` +
          'the cap that keeps an offline principal\'s loss proportionate. You may join that one instead — ' +
          'send join with {"side": "RAIDER"}.',
      );
    }
    if (live.stage === req.stage) {
      return reject(
        'A2',
        `raid ${live.id} already stands at ${req.stage} until tick ${String(live.resolvesAtTick)}. One ` +
          'standoff per place, so the map stays a countdown a viewer can follow rather than a weather map.',
      );
    }
  }
  if (book.liveCount() >= MAX_LIVE_RAIDS) {
    return reject(
      'INV-26',
      `${String(MAX_LIVE_RAIDS)} raids are already live, which is the declared world cap. Nothing was ` +
        'spent; the cap frees as they resolve.',
    );
  }

  // 10. The band. Clamping silently would mean the engine and the agent disagreeing about the
  //     one number the whole standoff is about, which is scar #1 with goods attached.
  if (!Number.isSafeInteger(req.demand) || req.demand < RAID_DEMAND_QTY.min || req.demand > RAID_DEMAND_QTY.max) {
    return reject(
      'A2',
      `a demand is a whole number of units between ${String(RAID_DEMAND_QTY.min)} and ` +
        `${String(RAID_DEMAND_QTY.max)}; you named ${String(req.demand)}. The band is the same one world ` +
        'raids draw from, and it is a cap on the ASK — what you actually take is capped again at half of ' +
        'whatever is standing there when the window closes.',
    );
  }

  // 11. A hand. Force is per hand and capital buys none (A4).
  if (handFor(port, req) === null) {
    const named = req.handId === null ? '' : ` Hand ${req.handId} is not IDLE and present there.`;
    return reject(
      'INV-9',
      `you have no IDLE hand present at ${req.stage} to open a demand with. A demand is made of hands: ` +
        'one hand is one unit of simultaneous presence (§3), a hand filling a venture role cannot also ' +
        'stand in a standoff, and a Commons-bound principal cannot march hands out of the Commons at all ' +
        `(A15). Move one there first — the window is ${String(DEMAND_WINDOW_TICKS)} ticks long, so ` +
        `reinforcements that arrive during it still count.${named}`,
    );
  }

  // 12. The stake. Last, because it is the easiest to fix and the least interesting refusal.
  const free = port.freeStoresOf(req.initiator);
  if (free < RAID_JOIN_STAKE_MINOR) {
    return reject(
      'A7',
      `opening a demand stakes ${String(RAID_JOIN_STAKE_MINOR)} of slashable capital and you have ` +
        `${String(free)} free. An attacker with nothing at risk is weather, not a character: if the target ` +
        'repulses you this goes to it, in full, and forfeiture to the counterparty rather than to a sink is ' +
        'what stops an attack that fails from being a griefer\'s bargain.',
    );
  }

  return null;
}

/**
 * How many demands this principal may still open this Reckoning. One home, so the affordance's
 * count and the gate's count are the same number (scar #5).
 */
export function demandsRemaining(book: Book, principal: PrincipalId, tick: number): number {
  return aggressionRemaining(book.aggressionSpends(), principal, tick, reckoningIndex);
}

/** The sentence that goes with {@link demandsRemaining}. Published in the affordance. */
export function demandsRemainingNote(book: Book, principal: PrincipalId, tick: number): string {
  return aggressionNote(demandsRemaining(book, principal, tick), AGGRESSION_PER_RECKONING);
}

/**
 * Open the standoff. Returns the row that was written, or the sentence that refused it.
 *
 * **Nothing has happened when this refuses.** The gate runs to completion before the stake is
 * locked and the row is written after the lock succeeds, so there is no ordering in which an
 * agent ends up with a lock and no raid, or a raid and no lock. The second of those would be
 * an attacker with no risk on the record as having posted one; the first is an orphan
 * encumbrance, which `INV-4` halts the whole world over.
 */
export function openDemand(port: DemandPort, book: Book, req: DemandRequest): WorldResult<RaidRecord> {
  const refusal = demandRefusal(port, book, req);
  if (refusal !== null) return refusal;

  const handId = handFor(port, req);
  if (handId === null) {
    // Unreachable: gate 11 checked exactly this. Written as a branch rather than a `!` so a
    // future edit that reorders the gate degrades to a refusal instead of an exception in a
    // verb handler, which is a 500 to an agent (scar #11).
    return reject('INV-9', `no IDLE hand of yours is present at ${req.stage}.`);
  }

  const id = demandIdFor(req.tick, book.nextDemandIndexAt(req.tick));
  const encumbranceId = port.lockStake({
    raid: id,
    principal: req.initiator,
    amount: RAID_JOIN_STAKE_MINOR,
    tick: req.tick,
  });
  if (encumbranceId === null) {
    return reject(
      'INV-4',
      `your stake of ${String(RAID_JOIN_STAKE_MINOR)} could not be locked, so the demand was not opened ` +
        'and nothing of yours is committed. Free some stores and send it again.',
    );
  }

  const record: RaidRecord = {
    id,
    initiator: req.initiator,
    target: req.target,
    stage: req.stage,
    good: req.good,
    demandQty: qty(req.demand),
    // No weather term. See decision 1: all of a demand's force is hands, and the initiator's
    // hand is counted through the party row below so that it is re-measured at resolution.
    force: DEMAND_OWN_FORCE,
    spawnedAtTick: req.tick,
    resolvesAtTick: resolvesAt(req.tick),
    state: 'DEMANDED',
    answer: null,
    answeredAtTick: null,
    parties: [
      {
        principal: req.initiator,
        side: 'RAIDER',
        handId,
        stake: RAID_JOIN_STAKE_MINOR,
        encumbranceId,
        joinedAtTick: req.tick,
      },
    ],
    resolvedAtTick: null,
    lostQty: qty(0),
    forfeited: minor(0),
    defenderForce: 0,
    raiderForce: 0,
  };
  book.spawn(record);
  return { ok: true, value: record };
}

/** The hand this demand would commit, or null. One rule, used by the gate and by the write. */
function handFor(port: DemandPort, req: DemandRequest): HandId | null {
  const available = port.handsDefending(req.initiator, req.stage);
  if (req.handId === null) return available[0] ?? null;
  return available.find((id) => id === req.handId) ?? null;
}
