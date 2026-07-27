/**
 * The phase entry point: advance every live battle one tick, and turn the arithmetic into losses.
 *
 * `runPredate`'s shape — never throws, everything is `onFault(message)` — for the same reason: this
 * runs inside a tick, and a throw from here aborts a world in front of an audience over a battle.
 *
 * ── WHY A WORLD RAID BRINGS ITS OWN FLEET, AND WHY THAT IS THE WHOLE POINT ───
 *
 * A14 is the axiom that kills combat systems: *"Never ship a mechanic whose drama depends on agents
 * CHOOSING conflict — they won't; silence is their rational default."* Every autonomous-cast combat
 * layer fails here first and the failure is invisible, because the code works and the sim just shows
 * zero battles.
 *
 * §9 already solved it one layer down: *"each Reckoning the world spawns N raids, aimed by published
 * rule at the most exposed. Nobody owns them, so nobody can be bribed to call them off."* So the
 * engagement attaches to **that**. {@link mustWorldFleet} gives a world raid `force` destroyers on
 * the published {@link WORLD_FLEET_FIT}, crewed by nobody, owned by nobody, and unbribeable. A
 * defender that answers FIGHT gets a battle whether or not any agent has ever wanted one.
 *
 * That is what makes the tackle/repair/EWAR/capacitor interlock reachable at all: the world supplies
 * the opponent, and every agent-initiated demand after that is a *choice* on top of a floor rather
 * than the only way in.
 *
 * ── THE COUPLING BACK INTO THE RAID IS THROUGH HANDS, AND NOTHING ELSE ──────
 *
 * A wrecked hull routs its hand, `readForce` counts `handsAtStage` *at resolution* — its own doc says
 * *"a joiner counts only while its hand is still standing there"* — so a side that loses the battle
 * loses hands and therefore loses the force reading, automatically. Composition beats headcount
 * through a causal chain that already existed.
 *
 * **AND IT RUNS BOTH WAYS NOW, WHICH IT DID NOT.** The first version of this file said it *"does not
 * edit `predation/resolve.ts`"* and called that restraint. It was a defect: `applyLoss` returns early
 * on a world hull, so destroying the weather's entire fleet changed nothing on the raider's side of
 * the sum and a defender that won the battle still lost the standoff (`fz-13` t192 — three LANCEs
 * dead, **PLUNDERED 2-3**). {@link worldForceLeft} is the other direction, and it is the *same*
 * arithmetic rather than a second one: the world's hulls are crewed by synthetic hands, and those
 * hands are now counted at resolution by the rule every other hand in the sum is counted by.
 *
 * ── PIXEL SIGNATURE: **THE BATTLE LINE** (see `book.ts` for the full frame) ──
 *
 * Two lines of bars facing each other across a gap that narrows or widens every tick, stacked by
 * echelon, height ∝ EHP, with a repair tether, a tackle chain, a dark bar for an empty capacitor,
 * and a persistent wreck mark. This function is what moves all of it.
 */

import type { Rng } from '../core/rng.js';
import type { HandId, PrincipalId, SystemId } from '../core/types.js';
import { compareIds } from '../ledger/order.js';
import type { RaidId, RaidRecord } from '../predation/book.js';
import { engagementIdFor, type Book, type EngagementRecord, type FieldControl, type Formation } from './book.js';
import { openEngagement } from './engage.js';
import type { Fleet, HullId } from './fleet.js';
import { fitHashOf, simulateFit, type FitProfile } from './fit.js';
import {
  ENGAGEMENT_PHASE_TICKS,
  MAX_LIVE_ENGAGEMENTS,
  WORLD_FLEET,
  WORLD_FLEET_FIT,
  WRECK_VALUE_PER_GOOD,
} from './params.js';
import { fieldControlOf, runTick, type HullLoss } from './resolve.js';

/**
 * Everything a battle does to the world outside its own book.
 *
 * Every value-moving method **returns what actually moved**, which is `PredationPort`'s rule and the
 * reason a fabricated loss is not expressible here: the book records what the ledger did, never what
 * the resolver intended.
 */
export interface BattlePort {
  /** Destroy the hull's goods into the loss sink. Returns the value actually removed. */
  burnHull(args: {
    readonly owner: PrincipalId;
    readonly hull: string;
    readonly hullId: HullId;
    readonly system: SystemId;
    readonly eventId: string;
    readonly tick: number;
  }): number;
  /** Send a hand to RECOVERING. Returns false if it was not routable. Hands are never destroyed. */
  routHand(hand: HandId, tick: number): boolean;
  /** Wake a principal. §12.4's THREAT cause. */
  wake(principal: PrincipalId, item: string): void;
}

/** What one tick of the combat layer produced. */
export interface BattleReport {
  readonly opened: readonly EngagementRecord[];
  readonly advanced: readonly EngagementRecord[];
  readonly closed: readonly { readonly engagement: EngagementRecord; readonly control: FieldControl }[];
  readonly wrecked: number;
  readonly routed: number;
  readonly pruned: number;
}

/**
 * The world's fleet, as a fit profile computed once.
 *
 * Public rather than hidden, unlike an agent's: the world is not a principal, so §11.2 protects no
 * strategy of its — and A2 requires that a defender can compute exactly what a storm is made of. You
 * do not get to be surprised by the weather's composition; you get to be caught out of position by
 * it.
 */
export function worldFleetProfile(): FitProfile | null {
  const simulated = simulateFit(WORLD_FLEET.hull, WORLD_FLEET_FIT);
  return simulated.ok ? simulated.value : null;
}

/**
 * Prove the world can actually field its fleet — at construction, not at the first battle.
 *
 * `assertEngagementSchedule` cannot do this: `params.ts` holds the fit and `fit.ts` holds the
 * simulator, and the simulator imports the params. So the check lives here, is called from the same
 * place, and fails the same way.
 *
 * The failure it exists for is the worst kind this layer can have. An illegal `WORLD_FLEET_FIT`
 * means every world raid that is answered FIGHT faces an **empty field** — the defender wins by
 * walkover, no hull is ever destroyed, and A14's whole point (*"drama runs on a clock, not on
 * hope"*) fails silently while every test stays green. It was caught by exactly that: the first
 * hand-set catalogue had the world's fit over budget on both CPU and grid.
 */
export class WorldFleetError extends Error {}

export function assertWorldFleet(): void {
  const simulated = simulateFit(WORLD_FLEET.hull, WORLD_FLEET_FIT);
  if (!simulated.ok) {
    throw new WorldFleetError(
      `WORLD_FLEET_FIT does not fit a ${WORLD_FLEET.hull}: ${simulated.hint} A world raid answered FIGHT ` +
        `would face nothing, which is A14 failing silently — the code runs, the tests pass, and nothing ` +
        `ever fights.`,
    );
  }
  const profile = simulated.value;
  if (profile.alpha === 0) {
    throw new WorldFleetError(
      'the world fleet fits legally and deals no damage. A storm that cannot hurt anybody is not weather.',
    );
  }
  if (!profile.roleTags.includes('TACKLE')) {
    throw new WorldFleetError(
      'the world fleet carries no tackle, so nothing it attacks can ever be prevented from leaving. ' +
        'A raid that everyone can walk away from is the toll cartel §9 names, arriving from the other side.',
    );
  }
}

/** The world's fleet's fit hash. Stable, published, and pinned by test. */
export function worldFleetHash(): string {
  return fitHashOf(WORLD_FLEET.hull, WORLD_FLEET_FIT);
}

/** The synthetic hands the world's hulls are crewed by. Never real, never routable. */
function worldHand(raid: RaidRecord, index: number): HandId {
  return `world:${raid.id}:${String(index)}` as HandId;
}

/** The synthetic hull ids the world's fleet flies. Not in the fleet book; nothing owns them. */
function worldHull(raid: RaidRecord, index: number): HullId {
  return `world:${raid.id}:${String(index)}` as HullId;
}

/** Is this a hand the world crews rather than a principal's? */
export function isWorldHand(hand: HandId): boolean {
  return hand.startsWith('world:');
}

/** Is this a hull the world flies? Not in the fleet, so never burnt and never released. */
export function isWorldHull(hull: HullId): boolean {
  return hull.startsWith('world:');
}


/**
 * Give a world raid its fleet. Called immediately after {@link openEngagement} on a world standoff.
 *
 * `WORLD` is used as the owning principal id, which is a *reserved* id and not a seat — it enrolls
 * nothing, holds nothing, and can never be paid. §9's *"nobody owns them, so nobody can be bribed to
 * call them off"* has to be true of the fleet as well as of the raid, and the way to make it true is
 * for the owner not to exist.
 */
export const WORLD_PRINCIPAL = 'WORLD' as PrincipalId;

export function mustWorldFleet(args: {
  readonly book: Book;
  readonly engagement: EngagementRecord;
  readonly raid: RaidRecord;
  readonly tick: number;
  readonly onFault: (message: string) => void;
}): number {
  const profile = worldFleetProfile();
  if (profile === null) {
    args.onFault(
      'WORLD_FLEET_FIT does not simulate. The world raid has no opponent to field, so a defender that ' +
        'answered FIGHT would face nothing — which is A14 failing silently, exactly the way it always does.',
    );
    return 0;
  }
  const hulls = Math.max(1, args.raid.force * WORLD_FLEET.hullsPerForce);
  let brought = 0;
  for (let i = 0; i < hulls; i += 1) {
    try {
      args.book.commit({
        engagement: args.engagement.id,
        principal: WORLD_PRINCIPAL,
        side: 'RAIDER',
        fit: profile.fitHash,
        hull: WORLD_FLEET.hull,
        hand: worldHand(args.raid, i),
        // A synthetic hull id in the same namespace as the hand. It is deliberately NOT in the
        // fleet: the world owns nothing, so there is nothing to burn, release, or profit from —
        // which is `WORLD_PRINCIPAL`'s reason applied to the asset as well as to the owner.
        hullId: worldHull(args.raid, i),
        echelon: 'MAIN',
        posture: 'CLOSE',
        primary: ['TACKLE', 'REPAIR', 'WEAKEST'],
        withdrawWhen: { ehpBelowBps: 0, hullsLost: 0, now: false },
        ehpPerHull: profile.ehp,
        capPerHull: profile.capacitor,
        tick: args.tick,
      });
      brought += 1;
    } catch (error: unknown) {
      args.onFault(`the world could not field hull ${String(i)} for ${args.raid.id}: ${String(error)}`);
      break;
    }
  }
  return brought;
}

/**
 * **How much of a raid's own force is still on the field.** The other direction of §9A's coupling.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * The header above used to say this layer *"does not edit `predation/resolve.ts`"*, and that
 * restraint was right about the mechanism and wrong about the direction. A wrecked hull routing its
 * hand made **losing** a battle lose the force reading; nothing made **winning** one win it.
 * `applyLoss` returns early on a world hull — *"the world loses nothing it owned"* — and `raid.force`
 * was read straight off the record, so a defender that destroyed every LANCE faced the same number at
 * the window's end. Measured: seed `fz-13` tick 192, one missile WARDEN, all three world LANCEs
 * destroyed, field held at 2,395 EHP of 4,400, standoff **PLUNDERED 2-3**.
 *
 * So `readForce` now asks and this answers, and it is still *hands and nothing else*: the world's
 * fleet is crewed one synthetic hand per hull ({@link worldHand}), `resolve.ts` pops a hand off the
 * formation for every hull it destroys, and this counts what is left. The conversion back from hulls
 * to **force** is here rather than in predation because {@link WORLD_FLEET}`.hullsPerForce` is what
 * turned force into hulls on the way in — one constant, one home, both directions (scar #5).
 *
 * **`null` rather than 0 when there is nothing to count**, and that distinction is the whole safety
 * argument. Three roads reach it: no engagement row over this standoff (never answered FIGHT, or the
 * book pruned it), or a row with no world formation in it ({@link mustWorldFleet} faulted, or the
 * raid is an agent's `demand` and brings no fleet at all — `DEMAND_OWN_FORCE` is 0 and all of its
 * force is already hands). A 0 there would read as *"the raid has been wiped out"*, which is a
 * repulse nobody fought for written permanently against a real agent's name. `null` says *"nothing
 * is counting"* and the drawn scalar stands.
 *
 * Ceiling division for the same reason: at `hullsPerForce > 1` a raid with one hull left has *some*
 * force left, and rounding a survivor down to zero would be the free repulse arriving through
 * arithmetic instead of through a missing row.
 * ══════════════════════════════════════════════════════════════════════════
 */
export function worldForceLeft(book: Book, raid: RaidId): number | null {
  const record = book.forRaid(raid);
  if (record === undefined) return null;
  const worldFormations = record.formations.filter((f) => f.principal === WORLD_PRINCIPAL);
  if (worldFormations.length === 0) return null;
  // `!withdrawn` is `fieldControlOf`'s own predicate — a formation that has left the field is not
  // holding it. The world's `withdrawWhen` is all zeros so it never leaves of its own accord, and
  // asking anyway costs nothing and stops that from being load-bearing.
  const hulls = worldFormations.filter((f) => !f.withdrawn).reduce((n, f) => n + f.hands.length, 0);
  return Math.ceil(hulls / Math.max(1, WORLD_FLEET.hullsPerForce));
}

/**
 * Advance the combat layer one tick.
 *
 * Order inside: **open → advance → resolve losses → close → prune.** Opening first means a standoff
 * answered FIGHT last tick gets its MUSTER window starting this tick rather than a tick late, which
 * is the same correction `MOVE`-before-resolution makes in the tick pipeline (*"or every published
 * ETA is a tick optimistic"*).
 */
export function runBattles(args: {
  readonly book: Book;
  readonly fleet: Fleet;
  readonly port: BattlePort;
  readonly rng: Rng;
  readonly tick: number;
  /** Live standoffs, so a FIGHT answer can be turned into a battle. */
  readonly raids: readonly RaidRecord[];
  readonly seedCommitFor: (raid: RaidRecord) => string;
  readonly onFault: (message: string) => void;
}): BattleReport {
  const { book, fleet, port, tick } = args;
  const opened: EngagementRecord[] = [];
  const advanced: EngagementRecord[] = [];
  const closed: { engagement: EngagementRecord; control: FieldControl }[] = [];
  let wrecked = 0;
  let routed = 0;

  // ── Hulls finish fitting out ──────────────────────────────────────────────
  fleet.ready(tick);

  // ── 1. Open a battle over every standoff that was refused ─────────────────
  for (const raid of [...args.raids].sort((a, b) => compareIds(a.id, b.id))) {
    if (raid.state !== 'DEMANDED' || raid.answer !== 'FIGHT') continue;
    if (book.get(engagementIdFor(raid.id)) !== undefined) continue;
    if (book.liveCount() >= MAX_LIVE_ENGAGEMENTS) continue;
    try {
      const engagement = openEngagement({ book, raid, tick, seedCommit: args.seedCommitFor(raid) });
      opened.push(engagement);
      if (raid.initiator === null) {
        mustWorldFleet({ book, engagement, raid, tick, onFault: args.onFault });
      }
      port.wake(raid.target, engagement.id);
      if (raid.initiator !== null) port.wake(raid.initiator, engagement.id);
    } catch (error: unknown) {
      args.onFault(`could not open a battle over ${raid.id}: ${String(error)}`);
    }
  }

  // ── 2. Advance each live battle ───────────────────────────────────────────
  for (const record of book.live()) {
    const profileOf = profileLookup(fleet, record);

    const fireEnabled = record.state === 'CONTEST' || record.state === 'BREAK';
    const pursuitOnly = record.state === 'BREAK';

    if (record.state !== 'MUSTER') {
      const outcome = runTick({ record, profileOf, rng: args.rng, tick, fireEnabled, pursuitOnly });

      for (const line of outcome.trace) book.trace(record.id, line);

      // ── 3. Make the losses real ─────────────────────────────────────────
      for (const loss of outcome.losses) {
        wrecked += 1;
        if (!applyLoss({ book, fleet, port, record, loss, tick })) continue;
        routed += 1;
      }

      for (const exit of outcome.withdrawn) {
        for (const hullId of exit.hulls) {
          if (!isWorldHull(hullId)) fleet.release(hullId);
        }
      }
    }

    // ── 4. Advance the state clock ──────────────────────────────────────────
    if (tick < record.phaseEndsTick) {
      advanced.push(record);
      continue;
    }
    const decided = decideEarly(record);
    const next = decided ? 'AFTERMATH' : book.advance(record.id, tick);
    if (next === null || next === 'AFTERMATH') {
      const control = fieldControlOf(record);
      try {
        book.close(record.id, control, tick);
        closed.push({ engagement: record, control });
        releaseSurvivors({ fleet, record });
        port.wake(record.target, record.id);
        if (record.initiator !== null) port.wake(record.initiator, record.id);
      } catch (error: unknown) {
        args.onFault(`could not close the battle ${record.id}: ${String(error)}`);
      }
      continue;
    }
    advanced.push(record);
  }

  const pruned = book.prune(tick);
  return { opened, advanced, closed, wrecked, routed, pruned };
}

/**
 * Is the battle already decided? Close it early rather than running empty ticks.
 *
 * §7 MUST-8: *"KEEP objective timers... and loss-independent success; CUT arbitrary capture bars"*.
 * A battle whose loser has no standing formation left is over, and grinding out four more ticks of a
 * one-sided fight would publish frames of nothing happening — which is the A13 failure in its most
 * literal form.
 */
export function decideEarly(record: EngagementRecord): boolean {
  if (record.state === 'MUSTER' || record.state === 'CONTACT') return false;
  const standing = (side: 'RAIDER' | 'DEFENDER'): number =>
    record.formations.filter((f) => f.side === side && !f.withdrawn && f.hands.length > 0).length;
  return standing('RAIDER') === 0 || standing('DEFENDER') === 0;
}

/**
 * Destroy the hull, rout the hand, record the wreck. **In that order.**
 *
 * `refine.ts`'s ordering rule generalised: the destructive half first, so a partial failure leaves
 * the actor *poorer* rather than leaving a wreck on the record with the asset still standing. The
 * second is A5′ — the record must never be wrong — and a wreck row against a hull that still exists
 * is precisely a wrong record.
 *
 * A world hull is not in the fleet and crews no real hand, so it is recorded and nothing else. That
 * asymmetry is honest: the world loses nothing it owned, which is why nobody can profit from
 * fighting it beyond keeping their own goods.
 */
function applyLoss(args: {
  readonly book: Book;
  readonly fleet: Fleet;
  readonly port: BattlePort;
  readonly record: EngagementRecord;
  readonly loss: HullLoss;
  readonly tick: number;
}): boolean {
  const { book, fleet, port, record, loss, tick } = args;

  if (isWorldHull(loss.hullId)) {
    book.wreck(record.id, {
      formation: loss.formation,
      principal: WORLD_PRINCIPAL,
      hull: loss.hull,
      fit: fitHashOf(WORLD_FLEET.hull, WORLD_FLEET_FIT),
      hand: loss.hand,
      killedBy: loss.killedBy,
      tick,
      // Zero, and the zero is a rule: the world owned nothing, so nothing was destroyed that any
      // ledger held. A non-zero figure here would put fictional value on a permanent public record.
      value: 0,
    });
    return false;
  }

  const hullId = loss.hullId;
  const hullRecord = fleet.get(hullId);
  if (hullRecord === undefined) return false;

  const value = port.burnHull({
    owner: loss.principal,
    hull: loss.hull,
    hullId,
    system: record.stage,
    eventId: `${record.id}:wreck:${hullId}`,
    tick,
  });
  fleet.wreck(hullId, tick);
  port.routHand(loss.hand, tick);
  book.wreck(record.id, {
    formation: loss.formation,
    principal: loss.principal,
    hull: loss.hull,
    fit: hullRecord.fit,
    hand: loss.hand,
    killedBy: loss.killedBy,
    tick,
    value: value > 0 ? value : (hullRecord.modules.length + 1) * Number(WRECK_VALUE_PER_GOOD),
  });
  return true;
}

/** At AFTERMATH every surviving hull comes home. A battle does not hold an asset forever. */
function releaseSurvivors(args: { readonly fleet: Fleet; readonly record: EngagementRecord }): void {
  for (const formation of args.record.formations) {
    for (const hullId of formation.hulls) {
      if (isWorldHull(hullId)) continue;
      args.fleet.release(hullId);
    }
  }
}

/**
 * The profile lookup a battle runs on. Computed once per battle per tick, keyed by fit hash.
 *
 * §7 SHOULD-3: *"cached derived fits"*. Two hulls with the same fit hash have the same profile by
 * construction — that is what makes the hash an identity — so this memo is exact rather than
 * approximate, which is the only kind of cache allowed anywhere near `state_hash`.
 */
export function profileLookup(fleet: Fleet, record: EngagementRecord): (fit: string) => FitProfile | undefined {
  const memo = new Map<string, FitProfile | undefined>();
  const world = worldFleetProfile();
  if (world !== null) memo.set(world.fitHash, world);
  return (fit: string): FitProfile | undefined => {
    const held = memo.get(fit);
    if (held !== undefined) return held;
    if (memo.has(fit)) return undefined;
    const carrier = fleet.all().find((h) => h.fit === fit);
    if (carrier === undefined) {
      // A formation whose fit belongs to no hull in the fleet: possible for the world's, handled
      // above, and otherwise a sign the fleet row was pruned. Cache the miss so the walk stays O(1).
      memo.set(fit, undefined);
      void record;
      return undefined;
    }
    const simulated = simulateFit(carrier.hull, carrier.modules);
    const profile = simulated.ok ? simulated.value : undefined;
    memo.set(fit, profile);
    return profile;
  };
}

/** How many ticks a battle has left, for the countdown a viewer reads. */
export function ticksLeftOf(record: EngagementRecord, tick: number): number {
  if (record.resolvedAtTick !== null) return 0;
  return Math.max(0, record.phaseEndsTick - tick);
}

/** The state after this one, for the observation's "what happens next". */
export function nextStateNote(record: EngagementRecord): string {
   
  switch (record.state) {
    case 'MUSTER':
      return `hulls may still be committed; CONTACT opens in ${String(ENGAGEMENT_PHASE_TICKS.CONTACT)} tick(s) and then the fit is locked.`;
    case 'CONTACT':
      return 'the lines have met and nobody has fired. This is your last observation before damage.';
    case 'CONTEST':
      return 'volleys, repairs, tackle and the range race, every tick. Orders may still be restated.';
    case 'BREAK':
      return 'only what tackle still holds can be shot. Anything free has already left.';
    case 'AFTERMATH':
      return 'wrecks are written, the seed is revealed, field control is published.';
  }
}

/** Every formation in a battle, canonical order, for the view and the frame. */
export function formationsOf(record: EngagementRecord): readonly Formation[] {
  return [...record.formations].sort((a, b) => compareIds(a.id, b.id));
}
