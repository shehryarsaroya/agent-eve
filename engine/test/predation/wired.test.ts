/**
 * **Predation as a wired mechanic, not a module** — and the difference is the whole point.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `src/predation/` could be perfect and change nothing. What makes A14 true is that the
 * tick loop's `PREDATE` phase spawns, `state_hash` sees the book, the abort path restores
 * it, the verb table accepts `yield`, `fight` and `join`, ASSERT runs PRD-1..6 over it,
 * and goods actually leave a real ledger.
 *
 * Every test here goes through the real `Runtime`. None constructs a `Book` by hand.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { storesAccount } from '../../src/ledger/index.js';
import { Book } from '../../src/predation/index.js';
import {
  DEMAND_WINDOW_TICKS,
  RAID_DEMAND_QTY,
  RAID_FORCE,
  RAID_JOIN_STAKE_MINOR,
  RAID_SPAWN_PHASES,
  RAID_VICTIM_COOLDOWN_TICKS,
} from '../../src/predation/index.js';
import { tierOf } from '../../src/world/index.js';
import {
  GOOD,
  act,
  attempt,
  commonsWorld,
  eventsOfKind,
  raidWorld,
  runTo,
  runToFirstRaid,
} from './fixture.js';

function goodsAt(runtime: ReturnType<typeof raidWorld>['runtime'], principal: string, stage: string): number {
  let total = 0;
  for (const lot of runtime.ledger.lotsInAccount(storesAccount(principal as never))) {
    if (lot.good !== GOOD || lot.location !== stage) continue;
    total += lot.qty;
  }
  return total;
}

describe('the world stops being quiet without anybody choosing conflict (A14)', () => {
  it('spawns a raid on the published schedule, at the published target, with nobody acting', () => {
    // THE WHOLE POINT. Nothing is submitted in this test. The live world ran thousands of
    // ticks with no conflict because `PREDATE` was a no-op hook; this asserts it is not.
    const { runtime, stage } = raidWorld('wired-spawn', 3);
    const raid = runToFirstRaid(runtime);

    expect(RAID_SPAWN_PHASES).toContain(raid.spawnedAtTick % 288);
    expect(raid.resolvesAtTick).toBe(raid.spawnedAtTick + DEMAND_WINDOW_TICKS);
    expect(raid.stage).toBe(stage);
    expect(raid.demandQty).toBeGreaterThanOrEqual(RAID_DEMAND_QTY.min);
    expect(raid.demandQty).toBeLessThanOrEqual(RAID_DEMAND_QTY.max);
    expect(raid.force).toBeGreaterThanOrEqual(RAID_FORCE.min);
    expect(raid.force).toBeLessThanOrEqual(RAID_FORCE.max);
    // The raid has no actor, which is exactly why nobody can be bribed to call it off.
    const spawnEvents = eventsOfKind(runtime, 'raid.spawned');
    expect(spawnEvents.length).toBeGreaterThan(0);
    expect(spawnEvents[0]?.actorPrincipalId).toBeNull();
    expect(spawnEvents[0]?.isPublic).toBe(true);
  });

  it('the same seed produces the same raid, and a different seed does not', () => {
    const a = runToFirstRaid(raidWorld('det-same', 3).runtime);
    const b = runToFirstRaid(raidWorld('det-same', 3).runtime);
    expect({ ...a, parties: [] }).toEqual({ ...b, parties: [] });

    const c = runToFirstRaid(raidWorld('det-other', 3).runtime);
    // Not an equality assertion on the whole row: two seeds may legitimately agree on a
    // field. What must not happen is the seed being ignored, and demand+force together
    // are 5 x 4 = 20 combinations, so agreement on both is a real signal.
    expect(`${String(c.demandQty)}:${String(c.force)}`).not.toBe(`${String(a.demandQty)}:${String(a.force)}`);
  });

  it('an ignored demand takes goods at the deadline, and the loss is public and permanent (A5)', () => {
    const { runtime, stage } = raidWorld('wired-ignore', 3);
    const raid = runToFirstRaid(runtime);
    const before = goodsAt(runtime, raid.target, stage);

    runTo(runtime, raid.resolvesAtTick);
    const closed = runtime.raids.get(raid.id);
    expect(closed?.state).toBe('PLUNDERED');
    expect(closed?.lostQty).toBeGreaterThan(0);
    expect(goodsAt(runtime, raid.target, stage)).toBe(before - (closed?.lostQty ?? 0));

    const resolved = eventsOfKind(runtime, 'raid.resolved');
    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved[0]?.isPublic).toBe(true);
    expect(resolved[0]?.payload['is_default']).toBe(false);
  });

  it('paying ends it at once, for exactly the demand and no more', () => {
    const { runtime, stage } = raidWorld('wired-yield', 3);
    const raid = runToFirstRaid(runtime);
    const before = goodsAt(runtime, raid.target, stage);

    expect(act(runtime, raid.target, 'yield', { raid: raid.id })).toBeNull();
    const closed = runtime.raids.get(raid.id);
    expect(closed?.state).toBe('PAID');
    expect(closed?.lostQty).toBe(raid.demandQty);
    expect(goodsAt(runtime, raid.target, stage)).toBe(before - raid.demandQty);
    // And it is over before the window closes: paying early is a legitimate move.
    expect(runtime.engine.tick).toBeLessThan(raid.resolvesAtTick);
  });

  it('resisting with enough force keeps every unit, and sends nobody to recover', () => {
    const { runtime, principals, stage } = raidWorld('wired-fight', 3);
    const raid = runToFirstRaid(runtime);
    const before = goodsAt(runtime, raid.target, stage);

    // Three IDLE hands plus the Marches terrain is 4, and the published band reaches 5 —
    // so a principal standing alone cannot guarantee a repulse and has to call somebody.
    // That is the calibration (see RAID_FORCE), and it is what makes `fight` a judgement
    // about other agents rather than a lookup. Two allies puts the defence at 6.
    expect(act(runtime, raid.target, 'fight', { raid: raid.id, system: stage })).toBeNull();
    for (const ally of principals.filter((p) => p !== raid.target)) {
      expect(act(runtime, ally, 'join', { raid: raid.id, side: 'DEFENDER' })).toBeNull();
    }
    runTo(runtime, raid.resolvesAtTick);

    const closed = runtime.raids.get(raid.id);
    expect(closed?.state).toBe('REPULSED');
    expect(closed?.lostQty).toBe(0);
    expect(goodsAt(runtime, raid.target, stage)).toBe(before);
    expect(closed?.defenderForce).toBeGreaterThanOrEqual(closed?.raiderForce ?? 0);
    const recovering = [...runtime.world.hands.values()].filter((h) => h.state === 'RECOVERING');
    expect(recovering).toEqual([]);
  });

  it('a plundered victim is cooled too — scar #14: nobody is farmed cycle after cycle', () => {
    // The cooldown is set on BOTH branches and each is its own line. A test that only
    // watched the repulse would leave the plunder branch uncovered, which is the branch
    // an absent agent actually meets.
    const { runtime } = raidWorld('wired-cool-plunder', 3);
    const raid = runToFirstRaid(runtime);
    runTo(runtime, raid.resolvesAtTick);
    expect(runtime.raids.get(raid.id)?.state).toBe('PLUNDERED');
    expect(runtime.raids.isVictimCooling(raid.target, runtime.engine.tick)).toBe(true);
    expect(runtime.raids.victimCooledUntil(raid.target)).toBe(
      runtime.engine.tick + RAID_VICTIM_COOLDOWN_TICKS,
    );
    // The next scheduled slot cannot come back for the same principal.
    const nextSpawn = RAID_SPAWN_PHASES.find((p) => p > raid.resolvesAtTick % 288);
    if (nextSpawn !== undefined) {
      runTo(runtime, nextSpawn);
      expect(runtime.raids.live().map((r) => r.target)).not.toContain(raid.target);
    }
  });

  it('a repulse holds the stage and cools the victim — the world raid pays in future access', () => {
    const { runtime, principals, stage } = raidWorld('wired-hold', 3);
    const raid = runToFirstRaid(runtime);
    act(runtime, raid.target, 'fight', { raid: raid.id, system: stage });
    for (const ally of principals.filter((p) => p !== raid.target)) {
      act(runtime, ally, 'join', { raid: raid.id, side: 'DEFENDER' });
    }
    runTo(runtime, raid.resolvesAtTick);
    expect(runtime.raids.get(raid.id)?.state).toBe('REPULSED');

    expect(runtime.raids.isStageHeld(stage, runtime.engine.tick)).toBe(true);
    expect(runtime.raids.isVictimCooling(raid.target, runtime.engine.tick)).toBe(true);
    // Everyone is seated at the one held stage, so the next scheduled slot finds nobody
    // legal. Beating a raid bought a real, published, time-bounded peace.
    const nextSpawn = RAID_SPAWN_PHASES.find((p) => p > raid.resolvesAtTick % 288);
    if (nextSpawn !== undefined) {
      runTo(runtime, nextSpawn);
      expect(runtime.raids.live()).toEqual([]);
    }
  });
});

describe('A8 — in the Commons, hostile action is INVALID and not merely punished', () => {
  it('never spawns against a Commons target, across a whole Reckoning', () => {
    const { runtime, stage } = commonsWorld('wired-a8', 4);
    expect(tierOf(runtime.world.map, stage)).toBe('COMMONS');
    // A whole cycle, so all three scheduled slots run and PRD-1 asserts every tick.
    runTo(runtime, 287);
    expect(runtime.raids.all()).toEqual([]);
    expect(runtime.engine.status).toBe('RUNNING');
  });

  it('refuses a join on the raider side aimed into the Commons, at the floor and not after', () => {
    const { runtime, principals } = commonsWorld('wired-a8-join', 3);
    const joiner = principals[1];
    const target = principals[0];
    if (joiner === undefined || target === undefined) throw new Error('fixture');
    // `join` with any side but the exact `DEFENDER` spelling is HOSTILE, and a hostile
    // act naming a Commons principal is rejected by the floor before anything is charged.
    const refusal = attempt(runtime, joiner, 'join', { raid: 'raid:0:0', side: 'RAIDER', principal: target });
    expect(refusal?.invariant).toBe('A8');
    expect(refusal?.hint).toContain('invalid rather than punished');
  });
});

describe('attacker risk — a raid that cannot fail is not drama', () => {
  it('a raider joiner stakes slashable capital that goes to the DEFENDER on a repulse', () => {
    const { runtime, principals, stage } = raidWorld('wired-stake', 4);
    const raid = runToFirstRaid(runtime);
    const raider = principals.find((p) => p !== raid.target);
    if (raider === undefined) throw new Error('fixture');

    const beforeRaider = runtime.ledger.balance(storesAccount(raider));
    const beforeTarget = runtime.ledger.balance(storesAccount(raid.target));

    expect(act(runtime, raider, 'join', { raid: raid.id, side: 'RAIDER', principal: raid.target })).toBeNull();
    const joined = runtime.raids.get(raid.id);
    expect(joined?.parties.map((p) => p.side)).toEqual(['RAIDER']);
    // Locked, not merely promised: the stake is unspendable from the moment it is made.
    expect(runtime.ledger.freeBalance(storesAccount(raider))).toBe(beforeRaider - RAID_JOIN_STAKE_MINOR);
    // And it is declared as a worst case, not merely reserved. §3: EXPOSURE is the sum
    // of open `max_direct_loss` and nothing else, so a lock that declared zero would make
    // the joiner look risk-free to every counterparty while its capital was on the table
    // — the A7 honesty guarantee INV-5 exists to keep.
    expect(runtime.ledger.encumbrances.recomputeExposure(raider)).toBe(RAID_JOIN_STAKE_MINOR);

    act(runtime, raid.target, 'fight', { raid: raid.id, system: stage });
    // Enough allies that the defence clears the top of the band plus the raider's joiner:
    // 3 hands + 1 terrain + 2 allies = 6, against at most 5 + 1 = 6, and ties hold.
    for (const ally of principals.filter((p) => p !== raid.target && p !== raider)) {
      act(runtime, ally, 'join', { raid: raid.id, side: 'DEFENDER' });
    }
    runTo(runtime, raid.resolvesAtTick);

    const closed = runtime.raids.get(raid.id);
    expect(closed?.state).toBe('REPULSED');
    expect(closed?.forfeited).toBe(RAID_JOIN_STAKE_MINOR);
    // Forfeiture to the counterparty, never to a sink (§7.3): an attack that fails is a
    // transfer to its victim, so griefing pays the person griefed.
    expect(runtime.ledger.balance(storesAccount(raider))).toBe(beforeRaider - RAID_JOIN_STAKE_MINOR);
    expect(runtime.ledger.balance(storesAccount(raid.target))).toBe(beforeTarget + RAID_JOIN_STAKE_MINOR);
    // And its hand pays in time, never in capacity: RECOVERING, never destroyed (INV-8).
    const routed = [...runtime.world.hands.values()].filter(
      (h) => h.principal === raider && h.state === 'RECOVERING',
    );
    expect(routed).toHaveLength(1);
    expect(runtime.world.hands.size).toBe(4 * 3);
  });

  it('refuses a raider join with nothing losable behind it', () => {
    const { runtime, principals } = raidWorld('wired-broke', 3);
    const raid = runToFirstRaid(runtime);
    const raider = principals.find((p) => p !== raid.target);
    if (raider === undefined) throw new Error('fixture');
    // Drain the would-be raider to just under the stake.
    const free = runtime.ledger.freeBalance(storesAccount(raider));
    runtime.ledger.seizeCurrency({
      eventId: 'test:drain' as never,
      tick: runtime.engine.tick,
      from: storesAccount(raider),
      to: storesAccount(raid.target),
      amount: (free - RAID_JOIN_STAKE_MINOR + 1) as never,
    });
    const refusal = attempt(runtime, raider, 'join', { raid: raid.id, side: 'RAIDER', principal: raid.target });
    expect(refusal?.invariant).toBe('A7');
    expect(refusal?.hint).toContain('slashable capital');
  });

  it('a raider that wins keeps its stake and CARRIES the goods away, rather than burning them', () => {
    // §9: "raids destroy or relocate cargo". With a joiner there is somebody to carry it,
    // which is the only reason joining a raid has an upside at all.
    const { runtime, principals, stage } = raidWorld('wired-relocate', 3);
    const raid = runToFirstRaid(runtime);
    const raider = principals.find((p) => p !== raid.target);
    if (raider === undefined) throw new Error('fixture');

    act(runtime, raider, 'join', { raid: raid.id, side: 'RAIDER', principal: raid.target });
    const raiderBefore = goodsAt(runtime, raider, stage);
    // The target does NOT answer, so its force is zero and the raid takes the goods.
    runTo(runtime, raid.resolvesAtTick);

    const closed = runtime.raids.get(raid.id);
    expect(closed?.state).toBe('PLUNDERED');
    expect(closed?.lostQty).toBeGreaterThan(0);
    expect(goodsAt(runtime, raider, stage)).toBe(raiderBefore + (closed?.lostQty ?? 0));
    // Stake returned, and its hand kept.
    expect(runtime.ledger.freeBalance(storesAccount(raider))).toBe(runtime.ledger.balance(storesAccount(raider)));
    expect([...runtime.world.hands.values()].filter((h) => h.principal === raider && h.state === 'RECOVERING')).toEqual([]);
  });
});

describe('only IDLE hands stand in a standoff, and that is a halt this cannot cause', () => {
  it('a hand filling a venture role neither defends nor can be put in — INV-9 would halt the tick', () => {
    // ── WHY THE FILTER IS `IDLE` AND NOT "PRESENT" ───────────────────────────
    //
    // INV-9 halts the tick on a hand that fills a venture role while RECOVERING. If a
    // COMMITTED hand could be routed by a lost raid, entirely legitimate predation would
    // pause the world — an agent-reachable halt, and three of those have shipped here.
    // It is also the better rule: a principal that has committed every hand to ventures
    // has genuinely left nothing at home, and that is a strategy with a price.
    const { runtime, principals, stage } = raidWorld('idle-only', 3);
    const raid = runToFirstRaid(runtime);
    const helper = principals.find((p) => p !== raid.target);
    if (helper === undefined) throw new Error('fixture');

    // Put two of the helper's hands into a venture, leaving one idle.
    act(runtime, helper, 'create', { kind: 'HAUL', stage, value: 12_000 });
    const venture = runtime.ventures.all().find((v) => v.creator === helper && v.state === 'FORMING');
    if (venture === undefined) throw new Error('create did not mint a venture');
    const idle = (): string => {
      const hand = [...runtime.world.hands.values()].find(
        (h) => h.principal === helper && h.state === 'IDLE',
      );
      if (hand === undefined) throw new Error('no idle hand left');
      return hand.id;
    };
    act(runtime, helper, 'fill_role', { venture: venture.id, role: 0, hand: idle() });
    const committed = [...runtime.world.hands.values()].filter(
      (h) => h.principal === helper && h.state === 'COMMITTED',
    );
    expect(committed.length).toBeGreaterThan(0);

    // A committed hand cannot be named into the standoff, by name or by default.
    const named = act(runtime, helper, 'join', {
      raid: raid.id,
      side: 'DEFENDER',
      hand: committed[0]?.id,
    });
    expect(named?.invariant).toBe('INV-9');
    expect(named?.hint).toContain('one unit of simultaneous presence');

    // And the force the observation publishes counts only what is genuinely free.
    const free = [...runtime.world.hands.values()].filter(
      (h) => h.principal === helper && h.state === 'IDLE' && h.location === stage,
    ).length;
    act(runtime, helper, 'join', { raid: raid.id, side: 'DEFENDER' });
    expect(runtime.raids.get(raid.id)?.parties).toHaveLength(1);
    expect(free).toBeLessThan(3);
    // The world is still up: the whole point of the filter.
    runTo(runtime, raid.resolvesAtTick);
    expect(runtime.engine.status).toBe('RUNNING');
  });
});

describe('what is never lost', () => {
  it('a plundered target keeps its identity, its holding, its three hands and its standing', () => {
    const { runtime, stage } = raidWorld('wired-keeps', 3);
    const raid = runToFirstRaid(runtime);
    const standingBefore = JSON.stringify(runtime.standing.rows().filter((r) => r.principal === raid.target));

    act(runtime, raid.target, 'fight', { raid: raid.id, system: stage });
    runTo(runtime, raid.resolvesAtTick);
    expect(runtime.raids.get(raid.id)?.state).toBeDefined();

    expect(runtime.world.holdingByPrincipal.has(raid.target)).toBe(true);
    expect([...runtime.world.holdings.values()].find((h) => h.principal === raid.target)?.state).toBe('INTACT');
    expect([...runtime.world.hands.values()].filter((h) => h.principal === raid.target)).toHaveLength(3);
    // INV-21 permits standing to move only on an elective settlement, a default, a
    // contradicted seal or decay. A raid is none of those, so it must not have moved.
    expect(JSON.stringify(runtime.standing.rows().filter((r) => r.principal === raid.target))).toBe(standingBefore);
  });

  it('a routed hand is RECOVERING with a real return tick — loss is time, never capacity', () => {
    const { runtime, principals } = raidWorld('wired-recover', 3);
    const raid = runToFirstRaid(runtime);
    const helper = principals.find((p) => p !== raid.target);
    if (helper === undefined) throw new Error('fixture');
    // A defender joiner on a target that never answers: the raid wins and the helper's
    // hand pays for it.
    act(runtime, helper, 'join', { raid: raid.id, side: 'DEFENDER' });
    runTo(runtime, raid.resolvesAtTick);

    expect(runtime.raids.get(raid.id)?.state).toBe('PLUNDERED');
    const hand = [...runtime.world.hands.values()].find((h) => h.principal === helper && h.state === 'RECOVERING');
    expect(hand).toBeDefined();
    expect(hand?.freeAtTick).toBeGreaterThan(runtime.engine.tick);
    // Never destroyed: the row is still there and the principal still has three.
    expect([...runtime.world.hands.values()].filter((h) => h.principal === helper)).toHaveLength(3);
  });

  it('a target that fought and lost sends ITS OWN hands to recover, and only those', () => {
    // The other rout loop, and it is a separate line from the parties': the target's own
    // committed hands are not parties, so a test that only watched a joiner would leave
    // it uncovered — and this is the branch an agent that gambled and lost actually meets.
    //
    // The loss is **forced by arithmetic rather than by a lucky seed**: two of the
    // target's hands march away, leaving 1 hand + 1 terrain = 2, and one raider joins,
    // putting the raid at force + 1 >= 3. Higher wins, so this always plunders.
    const { runtime, principals, stage } = raidWorld('wired-recover-target', 3);
    const raid = runToFirstRaid(runtime);
    const raider = principals.find((p) => p !== raid.target);
    const bystander = principals.find((p) => p !== raid.target && p !== raider);
    if (raider === undefined || bystander === undefined) throw new Error('fixture');

    const away = runtime.world.map.systems.get(stage)?.lanes[0];
    if (away === undefined) throw new Error('the stage has no lane out');
    const mineBefore = [...runtime.world.hands.values()].filter((h) => h.principal === raid.target);
    for (const hand of mineBefore.slice(0, 2)) {
      act(runtime, raid.target, 'move', { hand: hand.id, to: away });
    }
    act(runtime, raid.target, 'fight', { raid: raid.id, system: stage });
    act(runtime, raider, 'join', { raid: raid.id, side: 'RAIDER', principal: raid.target });
    runTo(runtime, raid.resolvesAtTick);

    const closed = runtime.raids.get(raid.id);
    expect(closed?.state).toBe('PLUNDERED');
    const mine = [...runtime.world.hands.values()].filter((h) => h.principal === raid.target);
    const recovering = mine.filter((h) => h.state === 'RECOVERING');
    // Exactly the one hand that stood there. The two on the lane were not in the fight.
    expect(recovering).toHaveLength(1);
    expect(recovering[0]?.freeAtTick).toBeGreaterThan(runtime.engine.tick);
    // Never destroyed: three hands, always (INV-8). Loss is time, never capacity.
    expect(mine).toHaveLength(3);
    // And never anyone else's: a raid reaches its target and its parties, nobody else.
    expect(
      [...runtime.world.hands.values()].filter((h) => h.principal === bystander && h.state === 'RECOVERING'),
    ).toEqual([]);
  });
});

describe('the book is inside `state_hash` and inside the abort path', () => {
  it('a live demand moves the tick-boundary hash — two worlds that differ cannot hash the same', () => {
    // The `EncumbranceBook` sitting outside the hash was this engine's worst defect and
    // a verifier found it, not us. This is the same assertion for the raid book.
    const quiet = commonsWorld('hash-quiet', 3);
    const loud = raidWorld('hash-loud', 3);
    const raid = runToFirstRaid(loud.runtime);
    expect(raid).toBeDefined();
    runTo(quiet.runtime, loud.runtime.engine.tick);
    expect(loud.runtime.engine.stateHash).not.toBe(quiet.runtime.engine.stateHash);

    // And it is genuinely in the capture, not merely correlated with something else.
    const captured = loud.runtime.engine.snapshot().tables.find(([name]) => name === 'raid');
    expect(captured).toBeDefined();
    expect(JSON.stringify(captured)).toContain(raid.id);
  });

  it('captures and restores the whole book byte-for-byte, stakes and cooldowns included', () => {
    const { runtime, principals, stage } = raidWorld('hash-restore', 3);
    const raid = runToFirstRaid(runtime);
    const raider = principals.find((p) => p !== raid.target);
    if (raider === undefined) throw new Error('fixture');
    act(runtime, raider, 'join', { raid: raid.id, side: 'RAIDER', principal: raid.target });
    act(runtime, raid.target, 'fight', { raid: raid.id, system: stage });

    // Round-tripped through the registered table, which is what the abort path uses.
    // `captureSnapshot` compares BYTES, so a field the capture writes and the restore
    // drops shows up here rather than three ticks later as a divergent replay.
    const captured = runtime.raids.capture();
    const fresh = new Book();
    fresh.restore(captured);
    expect(JSON.stringify(fresh.capture())).toBe(JSON.stringify(captured));
    expect(JSON.stringify(fresh.all())).toBe(JSON.stringify(runtime.raids.all()));
    // The parts that are NOT the raid rows, and would be the easy ones to forget.
    expect(fresh.isVictimCooling(raid.target, runtime.engine.tick)).toBe(
      runtime.raids.isVictimCooling(raid.target, runtime.engine.tick),
    );
    expect(fresh.get(raid.id)?.parties[0]?.encumbranceId).toBe(
      runtime.raids.get(raid.id)?.parties[0]?.encumbranceId,
    );
  });

  it('is in the rollback set, so an aborted tick cannot leave a credited demand behind', () => {
    // A table with no `restore` contributes to the hash and cannot be rolled back, and
    // `rollbackGaps` names those. The raid book must not be one of them: an abort that
    // left a `yield` credited would have the world believing a payment that never
    // published, which is the shape of the EncumbranceBook defect.
    const { runtime } = raidWorld('hash-rollback', 3);
    expect(runtime.engine.stateTables.map((t) => t.name)).toContain('raid');
    expect(runtime.engine.rollbackGaps).not.toContain('raid');
  });
});
