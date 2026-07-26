/**
 * The `PREDATE` phase — SPEC §15.2's fifth slot, and SPEC §16 step 12.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THIS IS WHAT MAKES A14 TRUE RATHER THAN INTENDED.**
 *
 * *"Never ship a mechanic whose drama depends on agents choosing conflict — they won't;
 * silence is their rational default."* Until this phase had a body, the live world had
 * run thousands of ticks with no conflict in it at all, because nothing forced any. The
 * world now spawns predation on a published clock, at a target chosen by a published
 * rule, whether or not anyone wants it.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## The order inside the phase, and why it is that order
 *
 *   1. **Resolve** every raid due at or before this tick. First, so the live-raid cap
 *      and the stage holds a resolution creates are both current before anything spawns.
 *   2. **Spawn**, if the schedule says so.
 *   3. **Prune** resolved rows past the retention cap — inside the hash, because PREDATE
 *      runs before DERIVE and dropping a hashed row after DERIVE diverges the replay.
 *
 * MOVE has already run (`MOVE_PHASE_MUST_PRECEDE` names PREDATE first), so a hand that
 * marched to the stage to defend is present here on the tick its published ETA said it
 * would be.
 *
 * ## What this module may do to the record
 *
 * It writes **losses**, never defaults. A5′ has two halves here and both are structural
 * rather than asserted:
 *
 *   - **Never a loss against a principal that did not suffer one.** Every figure written
 *     to the book is the ledger's *return value* — what actually moved — not the demand,
 *     not the stake, not the take. A raid that demands 6,000 and finds 200 records 200.
 *   - **Never a default for a demand that was never shown.** A raid records no default at
 *     all, ever: {@link RaidOutcome.isDefault} is the literal type `false`, exactly as
 *     `ledger/cargoLost.ts` does it, and {@link windowWasHonest} refuses to resolve a
 *     raid whose demand was not readable for the whole published window.
 */

import type { GoodId, HandId, PrincipalId, SystemId } from '../core/types.js';
import { minor, qty, type Minor, type Qty } from '../core/units.js';
import { compareIds } from '../ledger/order.js';
import type { Rng } from '../core/rng.js';
import { Book, raidIdFor, type RaidId, type RaidRecord, type RaidState } from './book.js';
import {
  DEMAND_WINDOW_TICKS,
  MAX_LIVE_RAIDS,
  RAID_DEMAND_QTY,
  RAID_FORCE,
  RAID_STAGE_HELD_TICKS,
  RAID_VICTIM_COOLDOWN_TICKS,
} from './params.js';
import { demandFor, payFor, readForce, takeFor, type ForceReading } from './resolve.js';
import { isSpawnTick, resolvesAt } from './schedule.js';
import { rankCandidates, type TargetPort } from './target.js';
import type { RaidViewPort } from './view.js';

/**
 * Everything predation is allowed to do to the world, as a narrow port.
 *
 * Narrow on purpose. A module handed a `Ledger` and a `WorldState` can reach a private
 * stockpile, and predation is the mechanic most tempted to. Every method that moves
 * value **returns what actually moved**, which is the mechanical form of A5′: there is
 * no way for this file to write an intended figure to the record, because it never has
 * one in its hand at the moment it writes.
 */
export interface PredationPort extends TargetPort, RaidViewPort {
  /**
   * Take goods from a principal at one place. `to === null` means the world carried
   * them off (they are retired to the named loss sink); a principal means they were
   * relocated (SPEC §9: *"raids destroy or relocate cargo"*).
   *
   * Returns the quantity that actually moved, which may be zero.
   */
  seize(args: {
    readonly from: PrincipalId;
    readonly good: GoodId;
    readonly stage: SystemId;
    readonly want: Qty;
    readonly to: PrincipalId | null;
    readonly eventId: string;
    readonly tick: number;
  }): Qty;
  /** Release a joiner's locked stake. Never throws for an agent's sake. */
  releaseStake(encumbranceId: string | null, tick: number): void;
  /** Move a repulsed raider's stake to the defender. Returns what actually moved. */
  forfeit(args: {
    readonly from: PrincipalId;
    readonly to: PrincipalId;
    readonly amount: Minor;
    readonly eventId: string;
    readonly tick: number;
  }): Minor;
  /**
   * Send a hand to `RECOVERING` at its holding. **Never destroys it** (INV-8): loss is
   * time and position, never capacity. Returns false if the hand could not be routed —
   * it had already moved, or was already recovering — which is not an error.
   */
  routHand(handId: HandId, tick: number): boolean;
  /** Is this principal still enrolled and standing? A raid on a ghost is a MISS. */
  isSeated(principal: PrincipalId): boolean;
}

/**
 * What one resolution did. Everything here is measured, and it is never a default.
 *
 * `isDefault: false` is a literal type rather than a runtime flag, for the reason
 * `CargoLostOutcome` gives: INV-17 and A5′ make a fabricated default the worst bug this
 * system can have, so the branch that could produce one must not be expressible.
 */
export interface RaidOutcome {
  readonly raid: RaidId;
  readonly state: Exclude<RaidState, 'DEMANDED'>;
  readonly target: PrincipalId;
  readonly stage: SystemId;
  readonly good: GoodId;
  /** What the ledger actually moved out of the target's stock. */
  readonly lostQty: Qty;
  /** Where it went: a raider joiner, or null for "the world carried it off". */
  readonly relocatedTo: readonly { readonly principal: PrincipalId; readonly qty: Qty }[];
  /** What the ledger actually moved out of repulsed raiders' stores, to the target. */
  readonly forfeited: Minor;
  readonly routed: readonly HandId[];
  readonly force: ForceReading | null;
  readonly isDefault: false;
}

export interface PredateReport {
  readonly spawned: readonly RaidRecord[];
  readonly resolved: readonly RaidOutcome[];
  readonly pruned: number;
  /** Spawn slots the rule found no legal target for. Published; see `observe`. */
  readonly noTarget: number;
}

/**
 * Has this raid's demand been readable for the whole published window?
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE A5′ GATE.** A raid resolved early would take goods from a principal that was
 * never given the window the rules promise it — a loss recorded against someone who was
 * never shown the demand, which is the same libel as a fabricated default pointed at a
 * different verb. So resolution asks this first and simply does not resolve if the
 * answer is no; the raid stays `DEMANDED` and comes back next tick.
 *
 * It cannot be dodged by pausing the world either: the window is counted in ticks and a
 * paused world does not tick.
 * ══════════════════════════════════════════════════════════════════════════
 */
export function windowWasHonest(raid: RaidRecord, tick: number): boolean {
  return tick - raid.spawnedAtTick >= DEMAND_WINDOW_TICKS;
}

/**
 * Run the phase. Pure with respect to *when*: the caller owns the clock.
 *
 * Never throws on anything an agent can cause. A raid is world-driven and resolves in a
 * phase, so a throw here aborts a tick that had already moved hands and cleared markets
 * — and three agent-triggerable halts have shipped in this repo. Anything that goes
 * wrong is reported through `onFault` and the raid resolves as far as it honestly can.
 */
export function runPredate(args: {
  readonly book: Book;
  readonly port: PredationPort;
  readonly rng: Rng;
  readonly tick: number;
  readonly onFault: (message: string) => void;
}): PredateReport {
  const resolved: RaidOutcome[] = [];
  for (const raid of args.book.dueAt(args.tick)) {
    if (!windowWasHonest(raid, args.tick)) continue;
    const outcome = resolveOne(args.book, args.port, raid, args.tick, args.onFault);
    if (outcome !== null) resolved.push(outcome);
  }

  const spawned: RaidRecord[] = [];
  let noTarget = 0;
  if (isSpawnTick(args.tick)) {
    const record = spawnOne(args.book, args.port, args.rng, args.tick);
    if (record === null) noTarget += 1;
    else spawned.push(record);
  }

  return { spawned, resolved, pruned: args.book.prune(), noTarget };
}

/**
 * Spawn one raid, or return null when the rule finds nobody legal to aim at.
 *
 * Null is a real and frequent answer, not a failure: in a world where everyone stayed in
 * the Commons there is nothing to raid, which is A8 working exactly as written. It is
 * counted and published rather than swallowed, because "the world came looking and found
 * nobody outside the walls" is a fact about the world an agent should be able to read.
 */
function spawnOne(book: Book, port: PredationPort, rng: Rng, tick: number): RaidRecord | null {
  if (book.liveCount() >= MAX_LIVE_RAIDS) return null;

  const live = book.live();
  for (const candidate of rankCandidates(port, book, tick)) {
    // One live raid per target, and one per stage. Two at once on one principal would
    // stack the take past the cap that keeps an absent agent's loss proportionate.
    if (live.some((r) => r.target === candidate.principal || r.stage === candidate.stage)) continue;
    if (port.tierOf(candidate.stage) === 'COMMONS') continue;

    // The two draws, in a fixed order so adding one later cannot shift the other. Both
    // bands are published (`params.ts`), so the agent knows the worst case at once.
    const demand = demandFor(rng.range(RAID_DEMAND_QTY.min, RAID_DEMAND_QTY.max));
    const force = rng.range(RAID_FORCE.min, RAID_FORCE.max);

    const record: RaidRecord = {
      // One spawn per tick, so the index is always 0 and the tick alone makes the id
      // unique forever. Content-derived, never a counter: a counter would have to be
      // snapshotted or replay diverges (DET-3/DET-5).
      id: raidIdFor(tick, 0),
      target: candidate.principal,
      stage: candidate.stage,
      good: candidate.good,
      demandQty: demand,
      force,
      spawnedAtTick: tick,
      resolvesAtTick: resolvesAt(tick),
      state: 'DEMANDED',
      answer: null,
      answeredAtTick: null,
      parties: [],
      resolvedAtTick: null,
      lostQty: qty(0),
      forfeited: minor(0),
      defenderForce: 0,
      raiderForce: 0,
    };
    book.spawn(record);
    return record;
  }
  return null;
}

/**
 * Resolve one raid. Returns null only if the book refused the close, which is an
 * operator fault rather than a game outcome.
 *
 * The branches, in the order they are decided:
 *
 *   1. **The target is gone** → `MISSED`. Nothing moves, nothing is recorded against it.
 *   2. **It paid inside the window** → already `PAID`; this is never reached, because
 *      `yield` closes the raid where it happens.
 *   3. **Force** decides `REPULSED` or `PLUNDERED`, and then value moves.
 */
function resolveOne(
  book: Book,
  port: PredationPort,
  raid: RaidRecord,
  tick: number,
  onFault: (message: string) => void,
): RaidOutcome | null {
  const routed: HandId[] = [];
  const relocatedTo: { principal: PrincipalId; qty: Qty }[] = [];

  if (!port.isSeated(raid.target)) {
    return close(book, raid, tick, onFault, {
      state: 'MISSED',
      lostQty: qty(0),
      forfeited: minor(0),
      force: null,
      routed,
      relocatedTo,
    });
  }

  // The target's own hands count only if it ANSWERED. Standing there asleep is not a
  // defence, and the distinction is what makes the window a decision rather than a
  // formality — it is stated in RAID_TARGET_STATEMENT so it is a rule, not a surprise.
  const defenders = raid.answer === 'FIGHT' ? port.handsDefending(raid.target, raid.stage) : [];
  const force = readForce({
    raid,
    tier: port.tierOf(raid.stage),
    defenderHands: defenders.length,
    // A joiner counts only while its hand is still standing at the stage — measured
    // here, at resolution, by the same call the target's own muster is measured with.
    handsAtStage: (principal) => port.handsDefending(principal, raid.stage),
  });

  if (force.verdict === 'REPULSED') {
    // ── ATTACKER RISK, and it is the only material one a world raid has ──────
    //
    // Every joiner that took the raider's side loses its staked capital to the
    // defender and its hand to recovery. Forfeiture goes to the COUNTERPARTY and never
    // to a sink, for §7.3's reason: forfeiture to the void is a griefer's bargain,
    // while forfeiture to the victim makes an attack that fails a transfer.
    let forfeited = 0;
    for (const party of [...raid.parties].sort((a, b) => compareIds(a.principal, b.principal))) {
      port.releaseStake(party.encumbranceId, tick);
      if (party.side !== 'RAIDER') continue;
      if (party.stake > 0) {
        forfeited += port.forfeit({
          from: party.principal,
          to: raid.target,
          amount: party.stake,
          eventId: `${raid.id}:forfeit:${party.principal}`,
          tick,
        });
      }
      if (port.routHand(party.handId, tick)) routed.push(party.handId);
    }
    // The raid itself pays in future access: this place is held for a Reckoning.
    book.holdStage(raid.stage, tick + RAID_STAGE_HELD_TICKS);
    book.coolVictim(raid.target, tick + RAID_VICTIM_COOLDOWN_TICKS);
    return close(book, raid, tick, onFault, {
      state: 'REPULSED',
      lostQty: qty(0),
      forfeited: minor(forfeited),
      force,
      routed,
      relocatedTo,
    });
  }

  // ── PLUNDERED ────────────────────────────────────────────────────────────
  //
  // What is lost is GOODS, and only goods. Never the identity, never the holding, never
  // a hand's existence — a hand that fought and lost goes RECOVERING, which is time and
  // position rather than capacity (INV-8, SPEC §6.2).
  const standingNow = port.standingOf(raid.target, raid.stage, raid.good);
  const want = takeFor(raid.demandQty, standingNow);
  const raiders = raid.parties.filter((p) => p.side === 'RAIDER');

  let lost = 0;
  if (want > 0) {
    if (raiders.length === 0) {
      // Nobody to carry it: the world takes it out of the game entirely.
      lost += port.seize({
        from: raid.target,
        good: raid.good,
        stage: raid.stage,
        want,
        to: null,
        eventId: `${raid.id}:seize`,
        tick,
      });
    } else {
      // Relocated, in equal shares with the remainder to the lowest id — deterministic,
      // and the reason a raider joins at all. `seize` returns what actually moved, so a
      // short pile shorts the last shares rather than inventing goods.
      const ordered = [...raiders].sort((a, b) => compareIds(a.principal, b.principal));
      const share = Math.floor(want / ordered.length);
      const remainder = want - share * ordered.length;
      for (const [i, party] of ordered.entries()) {
        const portion = share + (i < remainder ? 1 : 0);
        if (portion <= 0) continue;
        const moved = port.seize({
          from: raid.target,
          good: raid.good,
          stage: raid.stage,
          want: qty(portion),
          to: party.principal,
          eventId: `${raid.id}:seize:${party.principal}`,
          tick,
        });
        if (moved > 0) relocatedTo.push({ principal: party.principal, qty: moved });
        lost += moved;
      }
    }
  }

  for (const party of [...raid.parties].sort((a, b) => compareIds(a.principal, b.principal))) {
    port.releaseStake(party.encumbranceId, tick);
    // The losing side's hands recover. A raider that won keeps its hand and its stake.
    if (party.side === 'DEFENDER' && port.routHand(party.handId, tick)) routed.push(party.handId);
  }
  for (const handId of defenders) {
    if (port.routHand(handId, tick)) routed.push(handId);
  }

  book.coolVictim(raid.target, tick + RAID_VICTIM_COOLDOWN_TICKS);
  return close(book, raid, tick, onFault, {
    state: lost > 0 ? 'PLUNDERED' : 'MISSED',
    lostQty: qty(lost),
    forfeited: minor(0),
    force,
    routed,
    relocatedTo,
  });
}

function close(
  book: Book,
  raid: RaidRecord,
  tick: number,
  onFault: (message: string) => void,
  outcome: {
    readonly state: Exclude<RaidState, 'DEMANDED'>;
    readonly lostQty: Qty;
    readonly forfeited: Minor;
    readonly force: ForceReading | null;
    readonly routed: readonly HandId[];
    readonly relocatedTo: readonly { readonly principal: PrincipalId; readonly qty: Qty }[];
  },
): RaidOutcome | null {
  try {
    book.close(raid.id, {
      state: outcome.state,
      tick,
      lostQty: outcome.lostQty,
      forfeited: outcome.forfeited,
      defenderForce: outcome.force?.defenderForce ?? 0,
      raiderForce: outcome.force?.raiderForce ?? 0,
    });
  } catch (error: unknown) {
    onFault(
      `raid ${raid.id} could not be closed at tick ${String(tick)} ` +
        `(${error instanceof Error ? error.message : String(error)})`,
    );
    return null;
  }
  return {
    raid: raid.id,
    state: outcome.state,
    target: raid.target,
    stage: raid.stage,
    good: raid.good,
    lostQty: outcome.lostQty,
    relocatedTo: outcome.relocatedTo,
    forfeited: outcome.forfeited,
    routed: outcome.routed,
    force: outcome.force,
    isDefault: false,
  };
}

/**
 * `yield` — pay the demand, now, and the raid leaves.
 *
 * Runs from the verb handler in `VALIDATE+LOCK`, not from this phase, so an agent that
 * pays sees it happen in the tick it acted rather than a day later. Exactly the demand,
 * capped at what is actually there: a target that pays with an empty hold pays nothing
 * and is recorded as having paid nothing, which is the honest row.
 */
export function payDemand(args: {
  readonly book: Book;
  readonly port: PredationPort;
  readonly raid: RaidRecord;
  readonly tick: number;
  readonly onFault: (message: string) => void;
}): RaidOutcome | null {
  const standingNow = args.port.standingOf(args.raid.target, args.raid.stage, args.raid.good);
  const want = payFor(args.raid.demandQty, standingNow);
  const moved =
    want <= 0
      ? qty(0)
      : args.port.seize({
          from: args.raid.target,
          good: args.raid.good,
          stage: args.raid.stage,
          want,
          to: null,
          eventId: `${args.raid.id}:yield`,
          tick: args.tick,
        });
  for (const party of [...args.raid.parties].sort((a, b) => compareIds(a.principal, b.principal))) {
    args.port.releaseStake(party.encumbranceId, args.tick);
  }
  args.book.coolVictim(args.raid.target, args.tick + RAID_VICTIM_COOLDOWN_TICKS);
  return close(args.book, args.raid, args.tick, args.onFault, {
    state: 'PAID',
    lostQty: moved,
    forfeited: minor(0),
    force: null,
    routed: [],
    relocatedTo: [],
  });
}
