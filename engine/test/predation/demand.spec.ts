/**
 * `demand` — §9's agent-initiated standoff, wired.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE DIFFERENCE THIS MECHANIC HAS TO MAKE, STATED AS A TEST.**
 *
 * World raids made conflict *happen* (A14: silence is an agent's rational default, so the world
 * attacks somebody on a clock). They could never make conflict a *choice*, because nobody issues
 * one — that is the whole reason they cannot be bribed off. `demand` is the other half of §9:
 * a principal spends from a capacity that expires unspent and starts a fight with its name on it.
 *
 * So the assertions that matter here are not "a raid appears". They are:
 *
 *   1. **it is reachable** — offered on the menu, gated by the same predicate the verb runs, and
 *      the offered params are accepted verbatim (nine mechanics in this repo were once legal and
 *      unreachable, `grant` — the core loop — among them);
 *   2. **it is priced** — two per Reckoning, and last cycle's restraint buys nothing;
 *   3. **it cannot mint the world's protections** — the exploit that would turn §9's own
 *      Coase-collapse argument inside out;
 *   4. **it renders as somebody's decision** rather than as weather (A13).
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Every test that can be wired is wired: a real `Runtime`, the real verb table, the real Commons
 * floor, the real PREDATE phase, real goods leaving a real ledger. The pure-arithmetic half lives
 * beside it in the `demandRefusal` unit tests at the end, which is where mutation testing bites
 * hardest because each gate can be broken in isolation.
 */

import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../src/api/observe.js';
import { CANON_VERBS, VERB_ARRIVES_AT } from '../../src/api/index.js';
import { TICKS_PER_RECKONING, phaseOfReckoning } from '../../src/core/time.js';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import { qty } from '../../src/core/units.js';
import { storesAccount } from '../../src/ledger/index.js';
import {
  AGGRESSION_PER_RECKONING,
  Book,
  DEMAND_OWN_FORCE,
  DEMAND_RULE_STATEMENT,
  DEMAND_WINDOW_TICKS,
  LAST_DEMAND_PHASE,
  MAX_RAID_ROWS,
  RAID_DEMAND_QTY,
  RAID_JOIN_STAKE_MINOR,
  RAID_STAGE_HELD_TICKS,
  RAID_VICTIM_COOLDOWN_TICKS,
  checkPrd7,
  demandIdFor,
  demandRefusal,
  demandsRemaining,
  openDemand,
  raidIdFor,
  raidLinesFor,
  raidTickerLine,
  type DemandPort,
  type DemandRequest,
} from '../../src/predation/index.js';
import { MAX_RAID_LINES } from '../../src/frames/contract.js';
import { renderFrame } from '../../src/frames/render.js';
import type { Runtime } from '../../src/sim/runtime.js';
import { GOOD, act, attempt, commonsWorld, eventsOfKind, raidRow, raidWorld, runTo, tick } from './fixture.js';
import { SWAY_AT_SEAT } from '../../src/world/index.js';

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function goodsAt(runtime: Runtime, principal: PrincipalId, stage: string): number {
  let total = 0;
  for (const lot of runtime.ledger.lotsInAccount(storesAccount(principal))) {
    if (lot.good !== GOOD || lot.location !== stage) continue;
    total += lot.qty;
  }
  return total;
}

function observation(runtime: Runtime, principal: PrincipalId): ReturnType<typeof buildObservation> {
  return buildObservation({
    runtime,
    principal,
    serverNowMs: 0,
    fresh: true,
    wakesRemaining: 4,
    stale: false,
    corrections: [],
    correctionsDropped: 0,
    actionsRemaining: 4,
  });
}

/** The `demand` rows on this principal's menu right now. */
function demandAffordances(
  runtime: Runtime,
  principal: PrincipalId,
): readonly { params: Readonly<Record<string, unknown>>; what_it_forecloses: string; max_direct_loss: number }[] {
  return observation(runtime, principal)
    .affordances.filter((a) => a.verb === 'demand')
    .map((a) => ({
      params: a.params,
      what_it_forecloses: a.what_it_forecloses,
      max_direct_loss: Number(a.max_direct_loss),
    }));
}

/**
 * A world where `raider` can legally demand from `target` right now.
 *
 * Two ticks are run first so every hand is present and IDLE rather than newly seated, and the
 * world's own spawn phases (48/120/192) are still far away — a world raid landing in the middle
 * of a demand test would make its assertions about a raid nobody in the test opened.
 */
function demandWorld(
  seed: string,
  tier: 'MARCHES' | 'FRONTIER' = 'MARCHES',
  count = 3,
): { runtime: Runtime; raider: PrincipalId; target: PrincipalId; others: readonly PrincipalId[]; stage: SystemId } {
  const { runtime, principals, stage } = raidWorld(seed, count, tier);
  tick(runtime);
  tick(runtime);
  const raider = principals[0];
  const target = principals[1];
  if (raider === undefined || target === undefined) throw new Error('fixture needs two principals');
  return { runtime, raider, target, others: principals.slice(2), stage };
}

/**
 * A principal `raider` may legally demand from right now, asked of the engine's own gate.
 *
 * Picked dynamically rather than by index on purpose. The world spawns its own raids on a
 * published clock, and a world raid leaves a victim cooldown — so a test that hardcoded a target
 * would pass or fail depending on which principal the world happened to hit, which is a fixture
 * deciding an assertion about a rule.
 */
function freeTarget(runtime: Runtime, raider: PrincipalId, stage: SystemId): PrincipalId {
  for (const other of runtime.world.principalOrder) {
    if (other === raider) continue;
    const refusal = runtime.demandRefusalFor({
      initiator: raider,
      target: other,
      stage,
      good: GOOD,
      demand: ASK,
      tick: runtime.engine.tick + 1,
      handId: null,
    });
    if (refusal === null) return other;
  }
  throw new Error(`no principal at ${stage} is demandable by ${raider} right now`);
}

/** Every raid in the book that somebody chose. The world's own are not demands. */
function demandsIn(runtime: Runtime): ReturnType<Runtime['raids']['all']> {
  return runtime.raids.all().filter((r) => r.initiator !== null);
}

const ASK = RAID_DEMAND_QTY.min;

describe('demand is REACHABLE — the affordance and the verb are one gate', () => {
  it('is a live verb with no lingering "arrives at step N" promise', () => {
    // The drift `verbs.ts` exists to stop, checked for this verb specifically because it is the
    // one that just moved: `classifyVerb` reads `live` first, so a stale entry never *shows* —
    // it only disagrees with the engine, silently, which is how seven of them accumulated.
    const { runtime } = demandWorld('demand-live');
    expect(CANON_VERBS).toContain('demand');
    expect(runtime.liveVerbs.has('demand')).toBe(true);
    expect(Object.keys(VERB_ARRIVES_AT)).not.toContain('demand');
  });

  it('★ is OFFERED on the menu, and the offered params are accepted verbatim', () => {
    // ══════════════════════════════════════════════════════════════════════
    // THE SIGNATURE-DEFECT TEST. A mechanic that is built, correct, tested and rendered can
    // still be invisible: nine were, and the frame published `authorityLines: 0` for months
    // because `grant` had no affordance. Agents copy affordance params verbatim — the cast
    // prompt tells them to — so "offered" and "accepted exactly as offered" are two claims and
    // both have to hold.
    // ══════════════════════════════════════════════════════════════════════
    const { runtime, raider } = demandWorld('demand-offered');
    const offers = demandAffordances(runtime, raider);
    expect(offers.length, 'a principal with an idle hand beside a neighbour must be offered a demand').toBeGreaterThan(0);

    const offer = offers[0];
    if (offer === undefined) throw new Error('fixture');
    expect(act(runtime, raider, 'demand', offer.params), 'the menu offered it, so the engine must take it').toBeNull();
    expect(runtime.raids.live()).toHaveLength(1);
    expect(runtime.raids.live()[0]?.initiator).toBe(raider);
  });

  it('the affordance publishes the exact price, the exact capacity and the exact verdict (A2)', () => {
    const { runtime, raider } = demandWorld('demand-priced');
    const offer = demandAffordances(runtime, raider)[0];
    if (offer === undefined) throw new Error('fixture');
    // What it costs, exactly — and never what it might WIN, because the raider cannot see what
    // the target holds and a predicted gain would be the fuel-gauge leak with the sign flipped.
    expect(offer.max_direct_loss).toBe(RAID_JOIN_STAKE_MINOR);
    expect(offer.what_it_forecloses).toContain('DOES NOT CARRY');
    expect(offer.what_it_forecloses).toContain(String(AGGRESSION_PER_RECKONING));
    // The MARCHES verdict for one hand, stated rather than left to be derived: terrain 1 beats
    // force 1 on a tie, and ties go to the defender.
    expect(offer.what_it_forecloses).toContain('LOSE ALONE');
    expect(offer.what_it_forecloses).toContain('ties go to the DEFENDER');
  });

  it('says so on the FRONTIER, where terrain is 0 and one hand is enough', () => {
    // The control for the line above. Without it, an implementation that hardcoded "LOSE ALONE"
    // would pass, and an agent would never learn that the frontier is where a lone raider wins —
    // which is the one calibration that makes the three zones mean different things.
    const { runtime, raider } = demandWorld('demand-frontier-text', 'FRONTIER');
    const offer = demandAffordances(runtime, raider)[0];
    if (offer === undefined) throw new Error('fixture');
    expect(offer.what_it_forecloses).toContain('TAKE IT ALONE');
  });

  it('offers nothing, and SAYS WHY, once the capacity is spent', () => {
    // A menu that shrinks in silence teaches the wrong rule: the agent concludes predation is
    // unreliable rather than that it is rationed, and never plans the one decision §9 wants —
    // WHICH target, given that you get two.
    const { runtime, raider, target, others, stage } = demandWorld('demand-spent', 'MARCHES', 4);
    const second = others[0];
    if (second === undefined) throw new Error('fixture');
    expect(act(runtime, raider, 'demand', { principal: target, system: stage, good: GOOD, qty: ASK })).toBeNull();
    expect(act(runtime, raider, 'demand', { principal: second, system: stage, good: GOOD, qty: ASK })).toBeNull();

    expect(demandAffordances(runtime, raider)).toHaveLength(0);
    const withheld = observation(runtime, raider).header['withheld'] as Record<string, unknown>;
    expect(String(withheld['reason'])).toContain('aggression capacity');
    expect(String(withheld['reason'])).toContain('does NOT');
    expect(Number(withheld['count'])).toBeGreaterThan(0);
  });
});

describe('what a demand actually opens', () => {
  it('writes a raid that names its raider, carries no force of its own, and locks the stake', () => {
    const { runtime, raider, target, stage } = demandWorld('demand-opens');
    const at = runtime.engine.tick + 1;
    const freeBefore = runtime.ledger.freeBalance(storesAccount(raider));
    expect(act(runtime, raider, 'demand', { principal: target, system: stage, good: GOOD, qty: 4_000 })).toBeNull();

    const raid = runtime.raids.live()[0];
    if (raid === undefined) throw new Error('the demand must have opened a raid');
    expect(raid.initiator).toBe(raider);
    expect(raid.target).toBe(target);
    expect(raid.stage).toBe(stage);
    expect(raid.demandQty).toBe(4_000);
    // ALL of a demand's force is hands, so it brings none of its own. A pinned force would be a
    // force the raider could keep after marching the hand away — the hole `resolve.ts` closed.
    expect(raid.force).toBe(DEMAND_OWN_FORCE);
    expect(raid.spawnedAtTick).toBe(at);
    expect(raid.resolvesAtTick).toBe(at + DEMAND_WINDOW_TICKS);

    // The initiator is a RAIDER party, which is what makes its hand re-measured at resolution.
    expect(raid.parties).toHaveLength(1);
    expect(raid.parties[0]?.principal).toBe(raider);
    expect(raid.parties[0]?.side).toBe('RAIDER');
    expect(raid.parties[0]?.stake).toBe(RAID_JOIN_STAKE_MINOR);
    expect(raid.parties[0]?.encumbranceId).not.toBeNull();
    expect(runtime.ledger.freeBalance(storesAccount(raider))).toBe(freeBefore - RAID_JOIN_STAKE_MINOR);
  });

  it('publishes a raid.demanded event with an ACTOR — which raid.spawned structurally cannot have', () => {
    const { runtime, raider, target, stage } = demandWorld('demand-event');
    act(runtime, raider, 'demand', { principal: target, system: stage, good: GOOD, qty: ASK });
    const events = eventsOfKind(runtime, 'raid.demanded');
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event?.actorPrincipalId).toBe(raider);
    expect(event?.isPublic).toBe(true);
    expect(event?.payload['initiator']).toBe(raider);
    expect(event?.payload['demands_left_this_reckoning']).toBe(AGGRESSION_PER_RECKONING - 1);
    // A different KIND, not `raid.spawned` with a field filled in: a reader would otherwise have
    // to check a nullable field to know whether the record was naming somebody, and the one
    // thing this record must never be mistaken for is an accusation (A5′).
    expect(eventsOfKind(runtime, 'raid.spawned')).toHaveLength(0);
  });

  it('the target reads it as a raid against it and can answer with the ordinary verbs', () => {
    // §9 says the demand window uses the engine that was already written. So the target's three
    // answers must arrive through exactly the machinery a world raid uses, with no second path.
    const { runtime, raider, target, stage } = demandWorld('demand-answerable');
    act(runtime, raider, 'demand', { principal: target, system: stage, good: GOOD, qty: ASK });
    const raid = runtime.raids.live()[0];
    if (raid === undefined) throw new Error('fixture');

    const rows = observation(runtime, target).obligations['raid'] as readonly Record<string, unknown>[];
    const row = rows.find((r) => r['raid'] === raid.id);
    expect(row, 'the target must be able to see the demand against it').toBeDefined();
    expect(row?.['your_side']).toBe('TARGET');
    expect(row?.['initiator']).toBe(raider);

    const before = goodsAt(runtime, target, stage);
    expect(act(runtime, target, 'yield', { raid: raid.id })).toBeNull();
    expect(runtime.raids.require(raid.id).state).toBe('PAID');
    expect(goodsAt(runtime, target, stage)).toBe(before - ASK);
  });

  it('offers the target a wake before the window closes, so the loss is never one it was not shown', () => {
    const { runtime, raider, target, stage } = demandWorld('demand-wake');
    act(runtime, raider, 'demand', { principal: target, system: stage, good: GOOD, qty: ASK });
    const raid = runtime.raids.live()[0];
    if (raid === undefined) throw new Error('fixture');
    expect(runtime.engine.wakes.offers().some((o) => o.principal === target && o.item === raid.id)).toBe(true);
  });
});

describe('§9\'s price: aggression capacity, and it expires unspent', () => {
  it(`allows exactly ${String(AGGRESSION_PER_RECKONING)} per Reckoning and refuses the next with the reason`, () => {
    const { runtime, raider, stage } = demandWorld('demand-capacity', 'MARCHES', 5);
    expect(runtime.demandsRemainingFor(raider, runtime.engine.tick)).toBe(AGGRESSION_PER_RECKONING);

    for (let n = 0; n < AGGRESSION_PER_RECKONING; n += 1) {
      const target = freeTarget(runtime, raider, stage);
      expect(act(runtime, raider, 'demand', { principal: target, system: stage, good: GOOD, qty: ASK })).toBeNull();
      expect(runtime.demandsRemainingFor(raider, runtime.engine.tick)).toBe(AGGRESSION_PER_RECKONING - 1 - n);
    }
    expect(demandsIn(runtime)).toHaveLength(AGGRESSION_PER_RECKONING);

    // The next one: refused on capacity, and the sentence has to name the expiry — an agent that
    // believes capacity banks will hold fire to fund a campaign it can never pay for.
    const spare = runtime.world.principalOrder.find(
      (p) => p !== raider && !runtime.raids.live().some((r) => r.target === p),
    );
    if (spare === undefined) throw new Error('fixture needs a principal with no live raid on it');
    const refused = attempt(runtime, raider, 'demand', { principal: spare, system: stage, good: GOOD, qty: ASK });
    expect(refused?.invariant).toBe('A14');
    expect(refused?.hint).toMatch(/next Reckoning/);
    expect(refused?.hint).toMatch(/toll|tariff/);
    expect(demandsIn(runtime)).toHaveLength(AGGRESSION_PER_RECKONING);
  });

  it('several demands may stand at ONE stage — one per target, never one per place', () => {
    // The rule a test caught me getting wrong. Copying the world's per-stage rule would have made
    // a single 500-minor demand a veto over everybody else's predation at that hub for a whole
    // window: a denial-of-predation gate at a price §9 would call cheap and bounded.
    const { runtime, raider, others, stage } = demandWorld('demand-two-at-one-stage', 'MARCHES', 5);
    const rival = others[0];
    if (rival === undefined) throw new Error('fixture');
    const first = freeTarget(runtime, raider, stage);
    expect(act(runtime, raider, 'demand', { principal: first, system: stage, good: GOOD, qty: ASK })).toBeNull();
    const second = freeTarget(runtime, rival, stage);
    expect(second).not.toBe(first);
    expect(act(runtime, rival, 'demand', { principal: second, system: stage, good: GOOD, qty: ASK })).toBeNull();
    expect(runtime.raids.live().filter((r) => r.stage === stage)).toHaveLength(2);
  });

  it('★ a quiet Reckoning buys NOTHING — the allowance does not accumulate', () => {
    // The assertion the anti-cartel argument rests on, at the wired level rather than the unit
    // level. An implementation that banked capacity would let a raider sit still for three
    // cycles and then threaten everyone at once, which is exactly the war chest a toll operator
    // wants and exactly what "expires unspent" is for.
    const { runtime, raider, stage } = demandWorld('demand-no-bank', 'MARCHES', 6);

    // Sit out the whole of Reckoning 0 without spending anything.
    runTo(runtime, TICKS_PER_RECKONING + 2);
    expect(runtime.demandsRemainingFor(raider, runtime.engine.tick)).toBe(AGGRESSION_PER_RECKONING);

    for (let n = 0; n < AGGRESSION_PER_RECKONING; n += 1) {
      const target = freeTarget(runtime, raider, stage);
      expect(act(runtime, raider, 'demand', { principal: target, system: stage, good: GOOD, qty: ASK })).toBeNull();
    }
    const spare = runtime.world.principalOrder.find(
      (p) => p !== raider && !runtime.raids.live().some((r) => r.target === p),
    );
    if (spare === undefined) throw new Error('fixture');
    const refused = attempt(runtime, raider, 'demand', { principal: spare, system: stage, good: GOOD, qty: ASK });
    expect(refused?.invariant, 'the third is refused however long the raider waited').toBe('A14');
  });

  it('refreshes at the Reckoning boundary, so predation is recurring rather than once-ever', () => {
    // The other side of the same rule, and the one an implementation breaks by counting the
    // whole book: a raider active last cycle would arrive this cycle already exhausted.
    const { runtime, raider, stage } = demandWorld('demand-refresh', 'MARCHES', 5);
    for (let n = 0; n < AGGRESSION_PER_RECKONING; n += 1) {
      const target = freeTarget(runtime, raider, stage);
      act(runtime, raider, 'demand', { principal: target, system: stage, good: GOOD, qty: ASK });
    }
    expect(runtime.demandsRemainingFor(raider, runtime.engine.tick)).toBe(0);
    expect(runtime.demandsRemainingFor(raider, runtime.engine.tick + TICKS_PER_RECKONING)).toBe(
      AGGRESSION_PER_RECKONING,
    );
  });

  it('counts only MY demands: another principal spending its capacity does not spend mine', () => {
    const { runtime, raider, target, others, stage } = demandWorld('demand-mine-only', 'MARCHES', 4);
    const rival = others[0];
    if (rival === undefined) throw new Error('fixture');
    act(runtime, rival, 'demand', { principal: target, system: stage, good: GOOD, qty: ASK });
    expect(runtime.demandsRemainingFor(rival, runtime.engine.tick)).toBe(AGGRESSION_PER_RECKONING - 1);
    expect(runtime.demandsRemainingFor(raider, runtime.engine.tick)).toBe(AGGRESSION_PER_RECKONING);
  });
});

describe('★ a demand cannot MINT the world\'s protections — the exploit that runs §9 backwards', () => {
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * §9 opens with the Coase-collapse: predation that is cheap and repeatable becomes a toll
   * everybody pays, and *"the map renders identically to peace"*. This is that argument run
   * **backwards**, and it is the one an implementation reaches by being consistent.
   *
   * If a demand wrote the world's stage hold and victim cooldown the way a world raid does, two
   * cooperating principals could buy a Reckoning of immunity from world predation for the price
   * of one staged attack — and the stake would be forfeited from one of them to the other, so
   * even that cost stays inside the family. No declared related-party edge is needed, so a graph
   * lookup could not catch it and A15 forbids inferring one.
   *
   * The structural answer: those protections are the ownerless raid's price for losing. A demand
   * pays in capital and capacity instead. Honoured by everyone, minted by nobody.
   * ══════════════════════════════════════════════════════════════════════════
   */
  it('a REPULSED demand leaves the stage open and the target still raidable', () => {
    const { runtime, raider, target, stage } = demandWorld('demand-no-hold');
    act(runtime, raider, 'demand', { principal: target, system: stage, good: GOOD, qty: ASK });
    const raid = runtime.raids.live()[0];
    if (raid === undefined) throw new Error('fixture');
    // ── ★ RECALIBRATED AT 35: FORCE IS HANDS, NOT PARTY ROWS ────────────────
    //
    // Every number in this block was a true statement about an arithmetic that said a raider party was
    // worth 1 whatever it brought, while the TARGET's own hands were worth 1 EACH. `readForce` now
    // scores both sides in hands (`min(present, sway)` on the raider's), so a seated principal with
    // three IDLE hands at the stage supplies 3 — which is what `SWAY_STATEMENT` has always told agents
    // and what `campaign/pulse.ts` already did. `predation/resolve.ts` carries the whole argument.
    //
    // The SUBJECT here is that a repulse writes no stage hold and no victim cooldown, so the fixture
    // has to reach a repulse — and it now does it the way the game means one to happen: the target
    // ANSWERS. Three defending hands plus the Marches' terrain against three supplied raider hands is
    // 4 to 3. Before 35 the raider was worth 1 and silence was enough, which made the only test of the
    // repulse path a test of an unanswered demand.
    expect(act(runtime, target, 'fight', { raid: raid.id, system: stage })).toBeNull();

    runTo(runtime, raid.resolvesAtTick + 1);
    const done = runtime.raids.require(raid.id);
    expect(done.state).toBe('REPULSED');
    expect(done.forfeited).toBe(RAID_JOIN_STAKE_MINOR);

    expect(runtime.raids.stageHeldUntil(stage), 'a demand must not close a stage to the world').toBeNull();
    expect(runtime.raids.victimCooledUntil(target), 'nor put its target out of the world\'s reach').toBeNull();
  });

  it('a PLUNDERED demand leaves no cooldown either', () => {
    const { runtime, raider, target, stage } = demandWorld('demand-no-cool', 'FRONTIER');
    act(runtime, raider, 'demand', { principal: target, system: stage, good: GOOD, qty: ASK });
    const raid = runtime.raids.live()[0];
    if (raid === undefined) throw new Error('fixture');
    runTo(runtime, raid.resolvesAtTick + 1);
    expect(runtime.raids.require(raid.id).state).toBe('PLUNDERED');
    expect(runtime.raids.victimCooledUntil(target)).toBeNull();
  });

  it('a PAID demand leaves no cooldown either — buying somebody off must not shelter them', () => {
    // The subtlest branch of the three. `yield` resolves immediately, so a friendly pair could
    // open a demand and pay a token amount to itself in one tick if paying wrote the cooldown.
    const { runtime, raider, target, stage } = demandWorld('demand-paid-no-cool');
    act(runtime, raider, 'demand', { principal: target, system: stage, good: GOOD, qty: ASK });
    const raid = runtime.raids.live()[0];
    if (raid === undefined) throw new Error('fixture');
    expect(act(runtime, target, 'yield', { raid: raid.id })).toBeNull();
    expect(runtime.raids.require(raid.id).state).toBe('PAID');
    expect(runtime.raids.victimCooledUntil(target)).toBeNull();
  });

  it('CONTROL — a WORLD raid still writes both, so the guard did not simply delete the feature', () => {
    // Without this, "no protections" would pass by having removed them from the game.
    const book = new Book();
    const world = raidRow({ id: raidIdFor(48, 0), initiator: null });
    book.spawn(world);
    expect(book.stageHeldUntil(world.stage)).toBeNull();

    // Both writers, invoked the way `predate.ts` invokes them for an ownerless raid.
    book.holdStage(world.stage, 72 + RAID_STAGE_HELD_TICKS);
    book.coolVictim(world.target, 72 + RAID_VICTIM_COOLDOWN_TICKS);
    expect(book.stageHeldUntil(world.stage)).toBe(72 + RAID_STAGE_HELD_TICKS);
    expect(book.victimCooledUntil(world.target)).toBe(72 + RAID_VICTIM_COOLDOWN_TICKS);
  });

  it('CONTROL, wired — a world raid resolving still holds the stage it was repulsed at', () => {
    // The same control against the real phase rather than the book, so a guard placed in the
    // wrong branch of `resolveOne` cannot pass by being unreachable.
    const { runtime, principals, stage } = raidWorld('demand-world-control', 4);
    let raid = runtime.raids.live()[0];
    while (raid === undefined) {
      tick(runtime);
      raid = runtime.raids.live()[0];
    }
    expect(raid.initiator, 'a world raid is ownerless').toBeNull();
    act(runtime, raid.target, 'fight', { raid: raid.id, system: stage });
    for (const ally of principals.filter((p) => p !== raid.target)) {
      act(runtime, ally, 'join', { raid: raid.id, side: 'DEFENDER' });
    }
    runTo(runtime, raid.resolvesAtTick + 1);
    expect(runtime.raids.require(raid.id).state).toBe('REPULSED');
    expect(runtime.raids.stageHeldUntil(stage)).toBe(raid.resolvesAtTick + RAID_STAGE_HELD_TICKS);
    expect(runtime.raids.victimCooledUntil(raid.target)).toBe(raid.resolvesAtTick + RAID_VICTIM_COOLDOWN_TICKS);
  });

  it('but a demand HONOURS a cooldown the world wrote — granted by the world, consumed by everyone', () => {
    const { runtime, raider, target, stage } = demandWorld('demand-honours-cool');
    runtime.raids.coolVictim(target, runtime.engine.tick + 50);
    const refused = attempt(runtime, raider, 'demand', { principal: target, system: stage, good: GOOD, qty: ASK });
    expect(refused?.hint).toContain('out of range until tick');
    expect(refused?.hint).toContain('scar #14');
    expect(runtime.raids.live()).toHaveLength(0);
  });

  it('and honours a stage the world holds, so a won defence buys a real peace', () => {
    const { runtime, raider, target, stage } = demandWorld('demand-honours-hold');
    runtime.raids.holdStage(stage, runtime.engine.tick + 50);
    const refused = attempt(runtime, raider, 'demand', { principal: target, system: stage, good: GOOD, qty: ASK });
    expect(refused?.hint).toContain('hold the field');
    expect(runtime.raids.live()).toHaveLength(0);
  });
});

describe('how a demand resolves — hands, and nothing but hands', () => {
  it('★ AN ANSWERED demand on the policed Marches is REPULSED, and the stake goes to the target', () => {
    // ── ★ RECALIBRATED AT 35: FORCE IS HANDS, NOT PARTY ROWS ────────────────
    //
    // Every number in this block was a true statement about an arithmetic that said a raider party was
    // worth 1 whatever it brought, while the TARGET's own hands were worth 1 EACH. `readForce` now
    // scores both sides in hands (`min(present, sway)` on the raider's), so a seated principal with
    // three IDLE hands at the stage supplies 3 — which is what `SWAY_STATEMENT` has always told agents
    // and what `campaign/pulse.ts` already did. `predation/resolve.ts` carries the whole argument.
    //
    // Renamed from *"one hand against the policed Marches"*: the raider no longer brings one hand, it
    // brings every hand it has standing there. So the Marches' terrain alone no longer stops a demand
    // and the defence has to be MUSTERED — which is the mechanic §9 wanted and the reason `fight` costs
    // an action. The forfeiture, the RECOVERING hand and the untouched goods are unchanged.
    const { runtime, raider, target, stage } = demandWorld('demand-marches');
    const targetFreeBefore = runtime.ledger.freeBalance(storesAccount(target));
    const goodsBefore = goodsAt(runtime, target, stage);
    act(runtime, raider, 'demand', { principal: target, system: stage, good: GOOD, qty: ASK });
    const raid = runtime.raids.live()[0];
    if (raid === undefined) throw new Error('fixture');
    const raiderHand = raid.parties[0]?.handId;
    expect(act(runtime, target, 'fight', { raid: raid.id, system: stage })).toBeNull();

    runTo(runtime, raid.resolvesAtTick + 1);
    const done = runtime.raids.require(raid.id);
    expect(done.state).toBe('REPULSED');
    expect(done.raiderForce, 'three IDLE hands standing at the stage, within sway').toBe(3);
    expect(done.defenderForce, 'three answered hands plus the Marches terrain').toBe(4);
    expect(goodsAt(runtime, target, stage)).toBe(goodsBefore);
    // Forfeiture to the COUNTERPARTY, never to a sink: an attack that fails is a transfer.
    expect(runtime.ledger.freeBalance(storesAccount(target))).toBe(targetFreeBefore + RAID_JOIN_STAKE_MINOR);
    // The hand is never destroyed. Loss is time and position (INV-8, §6.2).
    expect(runtime.world.hands.get(raiderHand as never)?.state).toBe('RECOVERING');
  });

  it('one hand on the unpoliced Frontier TAKES it, and the goods relocate to the raider', () => {
    // The calibration that makes the three zones mean different things, as an outcome rather
    // than as a sentence. Same act, same stake, same one hand — the only difference is terrain.
    const { runtime, raider, target, stage } = demandWorld('demand-frontier', 'FRONTIER');
    const targetBefore = goodsAt(runtime, target, stage);
    const raiderBefore = goodsAt(runtime, raider, stage);
    act(runtime, raider, 'demand', { principal: target, system: stage, good: GOOD, qty: ASK });
    const raid = runtime.raids.live()[0];
    if (raid === undefined) throw new Error('fixture');

    runTo(runtime, raid.resolvesAtTick + 1);
    const done = runtime.raids.require(raid.id);
    expect(done.state).toBe('PLUNDERED');
    // ── ★ RECALIBRATED AT 35: FORCE IS HANDS, NOT PARTY ROWS ────────────────
    //
    // Every number in this block was a true statement about an arithmetic that said a raider party was
    // worth 1 whatever it brought, while the TARGET's own hands were worth 1 EACH. `readForce` now
    // scores both sides in hands (`min(present, sway)` on the raider's), so a seated principal with
    // three IDLE hands at the stage supplies 3 — which is what `SWAY_STATEMENT` has always told agents
    // and what `campaign/pulse.ts` already did. `predation/resolve.ts` carries the whole argument.
    expect(done.raiderForce, 'every idle hand standing there, within sway').toBe(3);
    expect(done.defenderForce, 'the Frontier polices nothing and the target never answered').toBe(0);
    expect(done.lostQty).toBeGreaterThan(0);
    // Relocated, not destroyed: this is why a raider joins at all (§9).
    expect(goodsAt(runtime, target, stage)).toBe(targetBefore - done.lostQty);
    expect(goodsAt(runtime, raider, stage)).toBe(raiderBefore + done.lostQty);
  });

  it('a raider that marches its own hand away loses its own demand, and pays for it', () => {
    // The property that falls out of counting the initiator as a party rather than pinning its
    // force at spawn: there is no "open a demand and walk away" that keeps the threat alive.
    const { runtime, raider, target, stage } = demandWorld('demand-walkaway', 'FRONTIER');
    act(runtime, raider, 'demand', { principal: target, system: stage, good: GOOD, qty: ASK });
    const raid = runtime.raids.live()[0];
    if (raid === undefined) throw new Error('fixture');
    const handId = raid.parties[0]?.handId;
    if (handId === undefined) throw new Error('fixture');

    const lane = [...(runtime.world.map.systems.get(stage)?.lanes ?? [])][0];
    if (lane === undefined) throw new Error('the stage has no lane out');
    act(runtime, raider, 'move', { hand: handId, to: lane });

    runTo(runtime, raid.resolvesAtTick + 1);
    const done = runtime.raids.require(raid.id);
    expect(done.raiderForce, 'a hand a system away is not presence (§3)').toBe(0);
    expect(done.state).toBe('REPULSED');
    expect(done.forfeited).toBe(RAID_JOIN_STAKE_MINOR);
  });

  it('★ an ally on the raider\'s side adds ITS HANDS, not one point for being a principal', () => {
    // §9's escort market from the other side: a demand that needs help is a demand somebody has
    // to be persuaded to join, which is the judgement about other agents §1.1 wants decisions
    // to be made of.
    // ── ★ RECALIBRATED AT 35: FORCE IS HANDS, NOT PARTY ROWS ────────────────
    //
    // Every number in this block was a true statement about an arithmetic that said a raider party was
    // worth 1 whatever it brought, while the TARGET's own hands were worth 1 EACH. `readForce` now
    // scores both sides in hands (`min(present, sway)` on the raider's), so a seated principal with
    // three IDLE hands at the stage supplies 3 — which is what `SWAY_STATEMENT` has always told agents
    // and what `campaign/pulse.ts` already did. `predation/resolve.ts` carries the whole argument.
    //
    // Renamed, because the old title is now false in an instructive way: an ally is no longer *what
    // turns* a Marches demand into a take — the raider's own second and third hands do that. What an
    // ally buys is its OWN hands, which is a bigger contribution than before (3, not 1) and a real
    // negotiation rather than a token. `join` remains one row per principal; the escort market is
    // still a market, and its unit is now the same one everything else is measured in.
    const { runtime, raider, target, others, stage } = demandWorld('demand-with-ally', 'MARCHES', 4);
    const ally = others[0];
    if (ally === undefined) throw new Error('fixture');
    act(runtime, raider, 'demand', { principal: target, system: stage, good: GOOD, qty: ASK });
    const raid = runtime.raids.live()[0];
    if (raid === undefined) throw new Error('fixture');
    expect(act(runtime, ally, 'join', { raid: raid.id, side: 'RAIDER', principal: target })).toBeNull();

    runTo(runtime, raid.resolvesAtTick + 1);
    const done = runtime.raids.require(raid.id);
    expect(done.raiderForce, 'two principals with three hands each, both within sway').toBe(6);
    expect(done.defenderForce, 'terrain only: the target never answered').toBe(1);
    expect(done.state).toBe('PLUNDERED');
  });

  it('a demand against an empty place finds ballast and takes nothing, having cost everything', () => {
    // §11.2's own promise, and the reason there is no "does the target have anything" gate: a
    // gate like that would answer a SENSED question through a refusal. Scouting is the
    // counterplay and it stays a real one.
    const { runtime, raider, target, stage } = demandWorld('demand-ballast', 'FRONTIER');
    for (const lot of [...runtime.ledger.lotsInAccount(storesAccount(target))]) {
      if (lot.location !== stage || lot.qty <= 0) continue;
      runtime.ledger.destroyGoods({
        eventId: `test:empty:${lot.id}` as never,
        tick: runtime.engine.tick,
        sink: 'sink:loss' as never,
        lotId: lot.id,
        qty: qty(lot.qty),
      });
    }
    expect(goodsAt(runtime, target, stage)).toBe(0);

    act(runtime, raider, 'demand', { principal: target, system: stage, good: GOOD, qty: ASK });
    const raid = runtime.raids.live()[0];
    if (raid === undefined) throw new Error('fixture');
    runTo(runtime, raid.resolvesAtTick + 1);
    const done = runtime.raids.require(raid.id);
    expect(done.state).toBe('MISSED');
    expect(done.lostQty).toBe(0);
  });
});

describe('the gates, each with the sentence that fixes it', () => {
  it('refuses a demand against yourself (§9\'s related-party clause)', () => {
    const { runtime, raider, stage } = demandWorld('demand-self');
    const refused = attempt(runtime, raider, 'demand', { principal: raider, system: stage, good: GOOD, qty: ASK });
    expect(refused?.invariant).toBe('A15');
    expect(refused?.hint).toContain('bravery receipt');
    expect(runtime.raids.size()).toBe(0);
  });

  it('refuses a Commons stage at the FLOOR, before the handler sees it (A8)', () => {
    const { runtime, principals, stage } = commonsWorld('demand-commons', 3);
    const [raider, target] = principals;
    if (raider === undefined || target === undefined) throw new Error('fixture');
    tick(runtime);
    const refused = attempt(runtime, raider, 'demand', { principal: target, system: stage, good: GOOD, qty: ASK });
    expect(refused?.invariant).toBe('A8');
    expect(runtime.raids.size()).toBe(0);
  });

  it('refuses a second live raid against one target, and points at `join` instead', () => {
    const { runtime, raider, target, others, stage } = demandWorld('demand-one-per-target', 'MARCHES', 4);
    const second = others[0];
    if (second === undefined) throw new Error('fixture');
    act(runtime, raider, 'demand', { principal: target, system: stage, good: GOOD, qty: ASK });
    const refused = attempt(runtime, second, 'demand', { principal: target, system: stage, good: GOOD, qty: ASK });
    expect(refused?.hint).toContain('One live raid per target');
    expect(refused?.hint).toContain('join');
    expect(runtime.raids.live()).toHaveLength(1);
  });

  it('refuses a quantity outside the published band rather than clamping it silently', () => {
    // Clamping would be the engine and the agent disagreeing about the one number the whole
    // standoff is about, with goods attached — scar #1 exactly.
    const { runtime, raider, target, stage } = demandWorld('demand-band');
    const tooBig = attempt(runtime, raider, 'demand', {
      principal: target,
      system: stage,
      good: GOOD,
      qty: RAID_DEMAND_QTY.max + 1,
    });
    expect(tooBig?.invariant).toBe('A2');
    expect(tooBig?.hint).toContain(String(RAID_DEMAND_QTY.max));
    expect(runtime.raids.size()).toBe(0);

    const tooSmall = attempt(runtime, raider, 'demand', {
      principal: target,
      system: stage,
      good: GOOD,
      qty: RAID_DEMAND_QTY.min - 1,
    });
    expect(tooSmall?.invariant).toBe('A2');
    expect(runtime.raids.size()).toBe(0);
  });

  it('refuses when no IDLE hand of yours is standing at the stage', () => {
    const { runtime, raider, target, stage } = demandWorld('demand-no-hand');
    const lane = [...(runtime.world.map.systems.get(stage)?.lanes ?? [])][0];
    if (lane === undefined) throw new Error('fixture');
    for (const hand of [...runtime.world.hands.values()].filter((h) => h.principal === raider)) {
      act(runtime, raider, 'move', { hand: hand.id, to: lane });
    }
    const refused = attempt(runtime, raider, 'demand', { principal: target, system: stage, good: GOOD, qty: ASK });
    expect(refused?.invariant).toBe('INV-9');
    expect(refused?.hint).toContain('no IDLE hand present');
    expect(runtime.raids.size()).toBe(0);
  });

  it('refuses a window that would run into the freeze, and names the tick demands reopen at', () => {
    // §5.1's freeze is hard and admits no raid resolution. `assertRaidSchedule` guarantees this
    // for the world's three spawn phases at construction; an agent can act at any tick, so the
    // same rule has to be a gate.
    const { runtime, raider, target, stage } = demandWorld('demand-freeze');
    runTo(runtime, LAST_DEMAND_PHASE + 1);
    expect(phaseOfReckoning(runtime.engine.tick + 1)).toBeGreaterThan(LAST_DEMAND_PHASE);
    const refused = attempt(runtime, raider, 'demand', { principal: target, system: stage, good: GOOD, qty: ASK });
    expect(refused?.invariant).toBe('INV-18');
    expect(refused?.hint).toContain('demands reopen at tick');
    // Not `raids.size()`: the world spawned its own on the way here, and counting those would make
    // this assertion about the schedule rather than about the gate.
    expect(demandsIn(runtime)).toHaveLength(0);
  });

  it('and every demand that IS allowed resolves strictly before the commitment window', () => {
    // The positive form of the same rule, so a gate that refused everything would fail here.
    expect(LAST_DEMAND_PHASE).toBeGreaterThan(0);
    expect(LAST_DEMAND_PHASE + DEMAND_WINDOW_TICKS).toBeLessThan(TICKS_PER_RECKONING - 1 - 1 - 24 + 1);
  });
});

describe('it RENDERS as somebody\'s decision, not as weather (A13)', () => {
  it('the raid line carries the initiator, and a world raid\'s is null', () => {
    const book = new Book();
    book.spawn(raidRow({ id: raidIdFor(48, 0), initiator: null }));
    book.spawn(
      raidRow({
        id: demandIdFor(50, 0),
        initiator: 'p:kestrel' as PrincipalId,
        spawnedAtTick: 50,
        resolvesAtTick: 74,
        demandQty: qty(5_000),
      }),
    );
    const lines = raidLinesFor(book, 60, MAX_RAID_LINES);
    expect(lines.find((l) => l.raid === demandIdFor(50, 0))?.initiator).toBe('p:kestrel');
    expect(lines.find((l) => l.raid === raidIdFor(48, 0))?.initiator).toBeNull();
  });

  it('the ticker names the raider on a demand and nobody on a world raid', () => {
    const demanded = raidTickerLine(
      raidRow({ id: demandIdFor(50, 0), initiator: 'p:kestrel' as PrincipalId, target: 'p:wren' as PrincipalId }),
    );
    expect(demanded).toContain('p:kestrel demands');
    // A world raid must stay unattributed: naming anybody would be a permanent public
    // accusation against an agent that did nothing (A5′). The subject of the sentence is
    // "a raid", and nothing before the verb is a principal id.
    const weather = raidTickerLine(raidRow({ initiator: null }));
    expect(weather).toContain(': a raid demands');
    expect(weather.slice(0, weather.indexOf('demands'))).not.toContain('p:');
    expect(demanded.length).toBeLessThanOrEqual(140);
  });

  it('★ the frame does NOT tell a viewer a repulsed demand closed the stage — because it did not', () => {
    // The pixel contradicting the arithmetic is the defect `assertFrameBudgets` already refuses a
    // REPULSED-with-a-loss line over, and the frame is a stranger's only source. `grantWorldProtections`
    // writes the stage hold only for an ownerless raid, so the old sentence would have been a
    // published claim about a peace that does not exist.
    const source = {
      reckoning: 1,
      tick: 287,
      stateHash: 'h',
      settled: [],
      meters: { levyShort: 0 as never, onAPromise: 0 as never, kept: 0, broken: 0 },
      handles: new Map<string, string>(),
      ticker: [],
      tomorrow: [],
      raidLines: [
        {
          raid: demandIdFor(50, 0),
          stage: 'sys-1' as SystemId,
          target: 'p:wren' as PrincipalId,
          initiator: 'p:kestrel' as PrincipalId,
          demand: 3_000,
          state: 'REPULSED' as const,
          lost: 0,
          raiderForce: 1,
          defenderForce: 2,
          ticksLeft: 0,
        },
      ],
    };
    const beat = renderFrame(source as never).rundown.find((b) => b.kind === 'PLUNDER');
    expect(beat).toBeDefined();
    expect(beat?.consequence).not.toContain('closed to raiders');
    expect(beat?.consequence).toContain('stage stays open');
    expect(beat?.deed).toContain('p:kestrel');
  });

  it('a WORLD repulse still says the stage is closed, because for that one it is', () => {
    const source = {
      reckoning: 1,
      tick: 287,
      stateHash: 'h',
      settled: [],
      meters: { levyShort: 0 as never, onAPromise: 0 as never, kept: 0, broken: 0 },
      handles: new Map<string, string>(),
      ticker: [],
      tomorrow: [],
      raidLines: [
        {
          raid: raidIdFor(48, 0),
          stage: 'sys-1' as SystemId,
          target: 'p:wren' as PrincipalId,
          initiator: null,
          demand: 3_000,
          state: 'REPULSED' as const,
          lost: 0,
          raiderForce: 1,
          defenderForce: 2,
          ticksLeft: 0,
        },
      ],
    };
    const beat = renderFrame(source as never).rundown.find((b) => b.kind === 'PLUNDER');
    expect(beat?.consequence).toContain('closed to raiders for a Reckoning');
  });
});

describe('the record survives, and PRD-7 guards what reads it', () => {
  it('the initiator is captured and restored, so a demand does not come back as weather', () => {
    // `raid` is in CHECKPOINT_REQUIRED_TABLES. Dropped from the capture, an adopted checkpoint
    // would refund every raider's aggression capacity and start writing the world's protections
    // on their behalf — RULES_VERSION 6 -> 7 is this one field.
    const book = new Book();
    book.spawn(raidRow({ id: demandIdFor(50, 0), initiator: 'p:kestrel' as PrincipalId, spawnedAtTick: 50 }));
    book.spawn(raidRow({ id: raidIdFor(48, 0), initiator: null }));
    const restored = new Book();
    restored.restore(book.capture());
    expect(restored.require(demandIdFor(50, 0)).initiator).toBe('p:kestrel');
    expect(restored.require(raidIdFor(48, 0)).initiator).toBeNull();
    expect(restored.aggressionSpends()).toEqual([{ initiator: 'p:kestrel', tick: 50 }]);
  });

  it('a row written before this field existed restores as a world raid, never as an accusation', () => {
    const book = new Book();
    const legacy = book.capture() as Record<string, unknown>;
    const row = { ...(raidRow({ initiator: null }) as unknown as Record<string, unknown>) };
    delete row['initiator'];
    const restored = new Book();
    restored.restore({ ...legacy, raids: [row] } as never);
    expect(restored.require(raidIdFor(48, 0)).initiator).toBeNull();
  });

  it('PRD-7 halts on a raid that names one principal as both raider and target', () => {
    const book = new Book();
    book.spawn(raidRow({ id: demandIdFor(50, 0), initiator: 'p:same' as PrincipalId, target: 'p:same' as PrincipalId }));
    const violations = checkPrd7({
      book,
      tick: 60,
      tierOf: () => 'MARCHES',
      movedForRaid: () => null,
      defaultsThisTick: new Set(),
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.id).toBe('PRD-7');
    expect(violations[0]?.severity).toBe('HALT');
  });

  it('PRD-7 halts on a staked raider under an OWNERLESS raid — a demand that lost its name', () => {
    const book = new Book();
    book.spawn(
      raidRow({
        id: demandIdFor(50, 0),
        initiator: null,
        spawnedAtTick: 50,
        parties: [
          {
            principal: 'p:ghost' as PrincipalId,
            side: 'RAIDER',
            handId: 'h:1' as never,
            stake: RAID_JOIN_STAKE_MINOR,
            encumbranceId: 'e',
            joinedAtTick: 50,
          },
        ],
      }),
    );
    const violations = checkPrd7({
      book,
      tick: 60,
      tierOf: () => 'MARCHES',
      movedForRaid: () => null,
      defaultsThisTick: new Set(),
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('refund aggression capacity');
  });

  it('PRD-7 is quiet about an ordinary raider JOIN, which happens after the spawn tick', () => {
    // The guard's own guard: a clause that fired on every joined world raid would halt the live
    // world, and this is the exact state `join` produces every time somebody takes the raider's
    // side of the weather.
    const book = new Book();
    book.spawn(
      raidRow({
        initiator: null,
        spawnedAtTick: 48,
        parties: [
          {
            principal: 'p:joiner' as PrincipalId,
            side: 'RAIDER',
            handId: 'h:1' as never,
            stake: RAID_JOIN_STAKE_MINOR,
            encumbranceId: 'e',
            joinedAtTick: 49,
          },
        ],
      }),
    );
    expect(
      checkPrd7({ book, tick: 60, tierOf: () => 'MARCHES', movedForRaid: () => null, defaultsThisTick: new Set() }),
    ).toEqual([]);
  });

  it('a demand id can never collide with the world spawn at the same tick', () => {
    // `spawnOne` calls `book.spawn` outside a try, so a duplicate id would abort a tick that had
    // already moved hands and cleared markets — an agent-reachable world halt, in the phase whose
    // own header says nothing there may throw on an agent's input.
    expect(demandIdFor(48, 0)).not.toBe(raidIdFor(48, 0));
    const book = new Book();
    book.spawn(raidRow({ id: demandIdFor(48, 0), initiator: 'p:a' as PrincipalId }));
    expect(book.nextDemandIndexAt(48)).toBe(1);
    expect(() => {
      book.spawn(raidRow({ id: raidIdFor(48, 0), initiator: null }));
    }).not.toThrow();
    expect(book.nextDemandIndexAt(48), 'the world spawn is not a demand and does not shift the index').toBe(1);
  });

  it('★ pruning drops OLD Reckonings first, so a pruned demand cannot refund its capacity', () => {
    // Derived capacity means deleting a row hands the allowance back. Unreachable at today's
    // cast size and wired anyway, because the requirement for the exploit is "a bigger world".
    const book = new Book();
    const now = TICKS_PER_RECKONING * 4 + 10;
    // Fill past the cap with resolved rows: half from long ago, half from this Reckoning.
    for (let i = 0; i < MAX_RAID_ROWS; i += 1) {
      book.spawn(
        raidRow({
          id: demandIdFor(i, 0),
          initiator: 'p:old' as PrincipalId,
          spawnedAtTick: i,
          resolvesAtTick: i + DEMAND_WINDOW_TICKS,
          state: 'MISSED',
          resolvedAtTick: i + DEMAND_WINDOW_TICKS,
        }),
      );
    }
    for (let i = 0; i < 4; i += 1) {
      book.spawn(
        raidRow({
          id: demandIdFor(now - 5 + i, 0),
          initiator: 'p:now' as PrincipalId,
          spawnedAtTick: now - 5 + i,
          resolvesAtTick: now + 20 + i,
          state: 'MISSED',
          resolvedAtTick: now - 1,
        }),
      );
    }
    expect(book.prune(now)).toBe(4);
    expect(demandsRemaining(book, 'p:now' as PrincipalId, now)).toBe(0);
    expect(book.aggressionSpends().filter((s) => s.initiator === 'p:now')).toHaveLength(4);
  });
});

describe('demandRefusal is one predicate, and every clause of it bites', () => {
  const RAIDER = 'p:raider' as PrincipalId;
  const TARGET = 'p:target' as PrincipalId;
  const STAGE = 'sys-x' as SystemId;

  function port(over: Partial<DemandPort> = {}): DemandPort {
    return {
      tierOf: () => 'MARCHES',
      // Everybody but the target has a hand here, so a case that changes the INITIATOR is
      // testing the clause it means to rather than tripping over the hand gate.
      handsDefending: (p) => (p === TARGET ? [] : (['h:r1'] as never)),
      isSeated: () => true,
      // ★ §16.12 #1: full reach and not Commons-bound by default, so a case that changes another
      // clause is testing that clause. The sway clauses have their own cases below.
      swayAt: () => SWAY_AT_SEAT,
      swayShortfall: () => 0,
      isCommonsBound: () => false,
      freeStoresOf: () => (RAID_JOIN_STAKE_MINOR * 10) as never,
      lockStake: () => 'enc:1',
      ...over,
    };
  }

  function request(over: Partial<DemandRequest> = {}): DemandRequest {
    return {
      initiator: RAIDER,
      target: TARGET,
      stage: STAGE,
      good: GOOD,
      demand: qty(3_000),
      tick: 10,
      handId: null,
      ...over,
    };
  }

  it('passes a well-formed demand — the non-vacuity guard for everything below', () => {
    expect(demandRefusal(port(), new Book(), request())).toBeNull();
  });

  it('refuses self, an unseated target, a Commons stage, a bad band, no hand, and no stake', () => {
    const book = new Book();
    expect(demandRefusal(port(), book, request({ target: RAIDER }))?.invariant).toBe('A15');
    expect(demandRefusal(port({ isSeated: () => false }), book, request())?.invariant).toBe('A2');
    expect(demandRefusal(port({ tierOf: () => 'COMMONS' }), book, request())?.invariant).toBe('A8');
    expect(demandRefusal(port(), book, request({ demand: qty(1) }))?.invariant).toBe('A2');
    expect(demandRefusal(port(), book, request({ demand: qty(1_000_000) }))?.invariant).toBe('A2');
    expect(demandRefusal(port({ handsDefending: () => [] }), book, request())?.invariant).toBe('INV-9');
    expect(demandRefusal(port(), book, request({ handId: 'h:elsewhere' as never }))?.invariant).toBe('INV-9');
    expect(demandRefusal(port({ freeStoresOf: () => 0 as never }), book, request())?.invariant).toBe('A7');
  });

  it('refuses once the capacity is gone, counting only THIS Reckoning and only MY spends', () => {
    const book = new Book();
    for (let i = 0; i < AGGRESSION_PER_RECKONING; i += 1) {
      book.spawn(
        raidRow({
          id: demandIdFor(i, 0),
          initiator: RAIDER,
          target: `p:other${String(i)}` as PrincipalId,
          spawnedAtTick: i,
          resolvesAtTick: i + DEMAND_WINDOW_TICKS,
          state: 'MISSED',
          resolvedAtTick: i + DEMAND_WINDOW_TICKS,
        }),
      );
    }
    expect(demandRefusal(port(), book, request())?.invariant).toBe('A14');
    // Next Reckoning: the same book, and the allowance is whole again.
    expect(demandRefusal(port(), book, request({ tick: TICKS_PER_RECKONING + 10 }))).toBeNull();
    // Somebody else's book entries are not mine.
    expect(demandRefusal(port(), book, request({ initiator: 'p:innocent' as PrincipalId }))).toBeNull();
  });

  it('leaves nothing behind when it refuses: no row, no lock, no spent capacity', () => {
    // The ordering guarantee. A raid written before the lock succeeded would be an attacker with
    // no risk on the record as having posted one; a lock left behind for a raid that was never
    // written is an orphan encumbrance, which INV-4 halts the whole world over.
    const book = new Book();
    let locks = 0;
    const failing = port({
      lockStake: () => {
        locks += 1;
        return null;
      },
    });
    expect(demandRefusal(port(), book, request({ target: RAIDER })));
    expect(openDemand(failing, book, request({ target: RAIDER })).ok).toBe(false);
    expect(locks, 'a refused demand must not reach the ledger at all').toBe(0);
    expect(book.size()).toBe(0);

    // And a lock that fails leaves no row either.
    const result = openDemand(failing, book, request());
    expect(result.ok).toBe(false);
    expect(locks).toBe(1);
    expect(book.size()).toBe(0);
  });

  it('the published rule statement agrees with the constants it describes', () => {
    // A rules surface (hard rule 4). Scar #1 is the engine and the agent-facing text disagreeing
    // about one word, and it survived three critic passes because every component was correct.
    expect(DEMAND_RULE_STATEMENT).toContain('DOES NOT CARRY');
    expect(DEMAND_RULE_STATEMENT).toContain('TIES GO TO THE DEFENDER');
    expect(DEMAND_RULE_STATEMENT).toContain('NO force of its own');
    expect(DEMAND_RULE_STATEMENT).toContain('no stage hold and no victim cooldown');
    // The two claims about terrain have to match `FORCE_BY_TIER`, which is what makes them rules
    // rather than prose.
    expect(DEMAND_RULE_STATEMENT).toContain('Marches (terrain 1)');
    expect(DEMAND_RULE_STATEMENT).toContain('Frontier, where terrain is 0');
    expect(DEMAND_OWN_FORCE).toBe(0);
    // ── ★ 35: THE UNIT, WHICH THIS STATEMENT USED TO GET WRONG ────────────────
    //
    // It read *"one hand against the Marches ties … bring somebody"*, which was a true description of
    // an arithmetic that scored a raider party at 1 whatever it brought. Force is hands now, so the
    // corrective act is `move` and not recruitment — and a rules surface that sends an agent looking
    // for an ally when its own second hand would do is scar #1 in the direction that costs an action.
    expect(DEMAND_RULE_STATEMENT, 'the unit, stated').toContain('EVERY IDLE HAND YOU HAVE STANDING THERE');
    expect(DEMAND_RULE_STATEMENT, 'and the cap on it').toContain('up to your SWAY');
    expect(DEMAND_RULE_STATEMENT, 'and the act that adds one').toContain('`move` is the act that adds a hand');
    expect(
      DEMAND_RULE_STATEMENT,
      'and why `join` is not that act — one principal is one party row',
    ).toContain('one principal is one party row');
    expect(DEMAND_RULE_STATEMENT, 'and that the hand cap is HANDS_PER_PRINCIPAL, from the constant').toContain(
      `all ${String(SWAY_AT_SEAT)} of yours`,
    );
  });

  it('the affordance list and the gate never disagree — swept across a whole Reckoning', () => {
    // ══════════════════════════════════════════════════════════════════════
    // The general form of the reachability claim: for every principal at every sampled tick,
    // "offered" and "legal" must be the same set. A copy of the gate in the affordance layer
    // would drift the first time either changed; this fails the moment it does.
    // ══════════════════════════════════════════════════════════════════════
    const { runtime, stage } = raidWorld('demand-sweep', 4);
    tick(runtime);
    for (let n = 0; n < 60; n += 1) {
      tick(runtime);
      for (const principal of [...runtime.world.principalOrder].sort(cmp)) {
        const offered = new Set(
          demandAffordances(runtime, principal).map((a) => String(a.params['principal'])),
        );
        for (const other of runtime.world.principalOrder) {
          if (other === principal) continue;
          const legal =
            runtime.demandRefusalFor({
              initiator: principal,
              target: other,
              stage,
              good: GOOD,
              demand: ASK,
              tick: runtime.engine.tick,
              handId: null,
            }) === null;
          if (offered.has(other)) {
            expect(legal, `${principal} was offered a demand on ${other} that the gate refuses`).toBe(true);
          }
        }
      }
    }
  });
});
