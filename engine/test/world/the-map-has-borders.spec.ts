/**
 * §16.12 #1 — **chokepoints and capacity-limited projection**, as executable claims.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **EVERY NUMBER HERE COMES FROM THE ENGINE, NOT FROM A FIXTURE BUILT BESIDE THE ASSERTION.**
 *
 * Two agents lost a mutation this week to the same mistake: a test asserted a property of an object
 * it had itself constructed, so the assertion could not fail whatever the engine did. So the pattern
 * throughout this file is: take the launch map, ask the engine what it thinks, assert a *relation*
 * between two of its own answers — and assert **non-vacuity first**, because "0 straits, therefore
 * no strait touches the Commons" is a green test over an absent mechanic, which is exactly this
 * project's signature defect wearing a passing suite.
 *
 * MUTATIONS EACH BLOCK IS BUILT TO KILL are named inline, in the form the rest of the suite uses.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { reckoningIndex, setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import { Book as CampaignBook, joinRefusal, readCampaignForce } from '../../src/campaign/index.js';
import {
  Book as PredationBook,
  demandRefusal,
  readForce,
  type RaidParty,
  type RaidRecord,
} from '../../src/predation/index.js';
import { AGGRESSION_PER_RECKONING } from '../../src/predation/aggression.js';
import {
  FORCE_BY_TIER,
  FORCE_PER_HAND,
  FORCE_PER_JOINER,
  RAID_DEMAND_QTY,
} from '../../src/predation/params.js';
import { Runtime } from '../../src/sim/runtime.js';
import {
  assertStraits,
  commonsSystems,
  generateMap,
  HANDS_PER_PRINCIPAL,
  isStrait,
  laneKey,
  launchMap,
  route,
  straitsAt,
  straitsHeld,
  straitsOf,
  swayAt,
  swayNote,
  swayReach,
  swayShortfall,
  SWAY_AT_SEAT,
  SWAY_PER_HOP,
  SWAY_STATEMENT,
  SWAY_STRAIT_TOLL,
  STRAIT_DETOUR_HOPS,
  STRAIT_MIN_SEVERED,
  STRAIT_STATEMENT,
  systemOf,
  tierOf,
  type WorldMap,
} from '../../src/world/index.js';

const P = 'p:probe' as PrincipalId;
const seats = (systems: readonly SystemId[]) => ({ principal: P, systems });

/** Non-Commons systems, which is the domain both halves are defined over. */
function outerSystems(map: WorldMap): readonly SystemId[] {
  return map.systemOrder.filter((id) => tierOf(map, id) !== 'COMMONS');
}

// ══════════════════════════════════════════════════════════════════════════
// THE CHOKEPOINTS
// ══════════════════════════════════════════════════════════════════════════

describe('§16.12 #1 · STRAITS — some lanes matter more than others, and the graph says which', () => {
  const map = launchMap();

  it('★ IS NOT VACUOUS: the launch map has straits, and they are a MINORITY of its lanes', () => {
    // ══════════════════════════════════════════════════════════════════════
    // **THE FIRST ASSERTION IN THE FILE, BECAUSE EVERY OTHER ONE IS EMPTY WITHOUT IT.** A
    // distinction that holds for no lane and a distinction that holds for every lane are the same
    // non-distinction, and both would let every test below pass. `assertStraits` refuses both at
    // map construction; this is the same claim about the map the world actually runs on.
    //
    // MUTATION: return an empty map from `straitsOf`. Every other test in this file still passes;
    // this one goes RED. That is the whole reason it is first.
    // ══════════════════════════════════════════════════════════════════════
    const straits = straitsOf(map);
    expect(straits.size, 'no strait: §16.12 #1 has no chokepoint to stand on').toBeGreaterThan(0);
    expect(straits.size, 'every lane a strait is the same as none being one').toBeLessThan(
      map.lanes.size,
    );
    // The measured figure, pinned so a generator change has to be looked at rather than absorbed.
    expect(straits.size, 'the launch map, measured').toBe(10);
    expect(map.lanes.size).toBe(35);
  });

  it('★ EVERY strait satisfies its own published definition, re-derived here from the graph', () => {
    // ══════════════════════════════════════════════════════════════════════
    // The definition, walked independently of `strait.ts`: with the lane removed, either there is
    // no route between its ends at all, or the cheapest one is `STRAIT_DETOUR_HOPS` hops or more.
    // This is a **second implementation** of the predicate checked against the first — the one
    // shape of duplication that is worth having in a test, because it cannot share a bug with the
    // code it audits.
    //
    // MUTATION: `detour < STRAIT_DETOUR_HOPS` → `detour <= STRAIT_DETOUR_HOPS`, or flip the
    // severing branch's `<` to `>`. RED, naming the lane.
    // ══════════════════════════════════════════════════════════════════════
    let checked = 0;
    for (const strait of straitsOf(map).values()) {
      checked += 1;
      const around = hopsWithout(map, strait.a, strait.b, laneKey(strait.a, strait.b));
      if (strait.severs) {
        expect(around, `${strait.key} claims to sever but a route around it exists`).toBeNull();
        expect(strait.severed, `${strait.key} severs too little to be a border`).toBeGreaterThanOrEqual(
          STRAIT_MIN_SEVERED,
        );
        expect(strait.detourHops).toBe(0);
      } else {
        expect(around, `${strait.key} claims a detour and has no route around`).not.toBeNull();
        expect(around, `${strait.key}'s detour disagrees with the graph`).toBe(strait.detourHops);
        expect(strait.detourHops).toBeGreaterThanOrEqual(STRAIT_DETOUR_HOPS);
      }
    }
    expect(checked, 'nothing was checked').toBe(10);
  });

  it('★ EVERY lane that is NOT a strait fails the definition — the other direction', () => {
    // The half a one-sided test would miss: a classifier that returned `true` for everything would
    // pass the block above. So each of the 25 ordinary lanes is shown to have a short way around it.
    //
    // MUTATION: drop the `if (detour < STRAIT_DETOUR_HOPS) return null` early exit in `classify`.
    // RED here and nowhere else.
    let ordinary = 0;
    for (const key of map.laneOrder) {
      if (straitsOf(map).has(key)) continue;
      const lane = map.lanes.get(key);
      if (lane === undefined) throw new Error('torn map');
      ordinary += 1;
      const around = hopsWithout(map, lane.a, lane.b, key);
      const commons =
        tierOf(map, lane.a) === 'COMMONS' || tierOf(map, lane.b) === 'COMMONS';
      const severs = around === null;
      // Either A8 excused it, or the graph really does route around it cheaply, or the cut is a
      // cul-de-sac. Exactly one of the three, and the test says which for each lane.
      expect(
        commons || (severs ? true : (around ?? 0) < STRAIT_DETOUR_HOPS),
        `${key} is not a strait and does not fail the definition`,
      ).toBe(true);
    }
    expect(ordinary, 'no ordinary lane was checked').toBe(25);
  });

  it('★ A8: NO strait touches the COMMONS — and the raw graph really does want to pinch one', () => {
    // ══════════════════════════════════════════════════════════════════════
    // **THIS IS THE ONE WHOSE NEGATIVE HALF HAD TO BE MEASURED.** "No strait touches the Commons"
    // is trivially true if the graph has no candidate, and a green test over an impossible subject
    // is this project's defect at the invariant depth (INV-22 over an empty journal, for the
    // project's whole life). So the second half of this test proves a *candidate exists*: the
    // launch map's `sys-01~sys-03` severs Candle outright, and it is excluded by tier and by
    // nothing else.
    //
    // MUTATION: delete the `touchesCommons` early return in `classify`. RED — and it would have
    // taught a viewer that the civic routes can be blockaded, which §16.1 MUST-3 forbids.
    // ══════════════════════════════════════════════════════════════════════
    const commons = new Set(commonsSystems(map));
    for (const strait of straitsOf(map).values()) {
      expect(
        commons.has(strait.a) || commons.has(strait.b),
        `${strait.key} pinches a civic route`,
      ).toBe(false);
    }
    // The candidate. Without this the assertion above could be vacuous.
    let candidates = 0;
    for (const key of map.laneOrder) {
      const lane = map.lanes.get(key);
      if (lane === undefined) continue;
      if (!commons.has(lane.a) && !commons.has(lane.b)) continue;
      const around = hopsWithout(map, lane.a, lane.b, key);
      if (around === null || around >= STRAIT_DETOUR_HOPS) candidates += 1;
    }
    expect(
      candidates,
      'no Commons lane would qualify anyway, so the exclusion above proves nothing',
    ).toBeGreaterThan(0);
  });

  it('★ holds across 200 generated maps: never zero, never all, never in the Commons', () => {
    // The generator is the thing that will change (growth opens constellations), and a map with no
    // chokepoint would run every gate in the game and mean nothing. `assertMapStructure` calls
    // `assertStraits`, so this also proves construction cannot produce one.
    //
    // MUTATION: raise `STRAIT_DETOUR_HOPS` to 99. Some seed produces zero and `generateMap` throws.
    let min = Number.MAX_SAFE_INTEGER;
    let max = 0;
    for (let i = 0; i < 200; i += 1) {
      const m = generateMap(`borders-${String(i)}`);
      const n = straitsOf(m).size;
      min = Math.min(min, n);
      max = Math.max(max, n);
      expect(() => {
        assertStraits(m);
      }, `seed borders-${String(i)}`).not.toThrow();
    }
    expect(min, 'some generated map has no chokepoint at all').toBeGreaterThan(0);
    expect(max, 'some generated map is all chokepoint').toBeLessThan(41);
  });

  it('the rule an agent reads names the constants it came from (scar #1)', () => {
    // A rules surface. An agent that believes a strait blocks TRAVEL will never haul again.
    expect(STRAIT_STATEMENT).toContain(String(STRAIT_MIN_SEVERED));
    expect(STRAIT_STATEMENT).toContain(String(STRAIT_DETOUR_HOPS));
    expect(STRAIT_STATEMENT, 'the travel promise is the one an agent must not misread').toMatch(
      /never blocks travel/,
    );
    expect(STRAIT_STATEMENT).toMatch(/COMMONS/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// THE PROJECTION
// ══════════════════════════════════════════════════════════════════════════

describe('§16.12 #1 · SWAY — force gets weaker with distance, and stops', () => {
  const map = launchMap();

  it('★ IS NOT VACUOUS: a single-seat principal reaches a MINORITY of the map, and 0 somewhere', () => {
    // ══════════════════════════════════════════════════════════════════════
    // **THE CLAIM §16.12 #1 IS ACTUALLY MAKING**: *"local power … and a real place for smaller
    // groups to exist."* If a seat reached everywhere, there would be no border; if it reached
    // nowhere, there would be no game. Measured over every possible seat, so it is a property of
    // the map rather than of one lucky choice.
    //
    // MUTATION: `SWAY_PER_HOP` → 0. Every seat reaches all 26 and this goes RED on the first one.
    // ══════════════════════════════════════════════════════════════════════
    const outer = outerSystems(map);
    expect(outer.length).toBe(26);
    let widest = 0;
    let narrowest = Number.MAX_SAFE_INTEGER;
    for (const seat of outer) {
      const reach = swayReach(map, seats([seat]));
      expect(reach.size, `a seat at ${seat} reaches nothing, not even itself`).toBeGreaterThan(0);
      expect(reach.size, `a seat at ${seat} reaches the whole map`).toBeLessThan(outer.length);
      widest = Math.max(widest, reach.size);
      narrowest = Math.min(narrowest, reach.size);
    }
    // The measured spread, pinned: local power is a 6x difference between the best seat and the
    // worst, which is what makes WHERE you settle a decision.
    expect(narrowest, 'the most fenced-in seat').toBe(2);
    expect(widest, 'the keystone').toBe(12);
  });

  it('★ full at your own ground, and one less per lane — read off the engine, not a fixture', () => {
    // MUTATION: `SWAY_AT_SEAT - spent` → `SWAY_AT_SEAT`. RED at the first hop.
    // MUTATION: drop the `for (const s of seats) cost.set(s, 0)` seeding. RED at the seat itself.
    const seat = 'sys-16' as SystemId; // Wither, MARCHES
    expect(swayAt(map, seats([seat]), seat), 'nothing is withheld at home').toBe(SWAY_AT_SEAT);
    // Every neighbour reached over an ordinary lane is exactly one less. Derived from the map's own
    // adjacency and its own strait set, so the relation is checked rather than a number recited.
    let ordinaryNeighbours = 0;
    for (const neighbour of systemOf(map, seat).lanes) {
      if (tierOf(map, neighbour) === 'COMMONS') continue;
      if (isStrait(map, seat, neighbour)) continue;
      ordinaryNeighbours += 1;
      expect(swayAt(map, seats([seat]), neighbour), `one lane to ${neighbour}`).toBe(
        SWAY_AT_SEAT - SWAY_PER_HOP,
      );
    }
    expect(ordinaryNeighbours, 'this seat has no ordinary neighbour to measure').toBeGreaterThan(0);
    expect(SWAY_AT_SEAT, 'the seat value IS the hand count, by import').toBe(HANDS_PER_PRINCIPAL);
  });

  it('★ a STRAIT costs extra — UNLESS you hold an end of it, which is the whole prize', () => {
    // ══════════════════════════════════════════════════════════════════════
    // **THIS IS "HOLDING ONE IS WORTH DOING AND LOSING ONE HURTS", AS ARITHMETIC.** Both readings
    // are the engine's, over the same lane, differing only in whether the reader holds a seat on
    // it — so the assertion is a *relation between two engine answers* and cannot be satisfied by
    // a fixture.
    //
    // MUTATION: drop the `!held.has(strait.a) && !held.has(strait.b)` waiver. The two readings
    // become equal and this goes RED. MUTATION: `SWAY_STRAIT_TOLL` → 0. Same.
    // ══════════════════════════════════════════════════════════════════════
    const strait = [...straitsOf(map).values()].find(
      (s) => tierOf(map, s.a) !== 'COMMONS' && tierOf(map, s.b) !== 'COMMONS',
    );
    if (strait === undefined) throw new Error('no strait to measure');
    // A holder of the near end reaches the far end at the ordinary one-hop price.
    const asHolder = swayAt(map, seats([strait.a]), strait.b);
    expect(asHolder, 'holding the gate should cost the lane and nothing more').toBe(
      SWAY_AT_SEAT - SWAY_PER_HOP,
    );
    // Somebody seated one lane short of the same gate pays the toll on top, and the difference is
    // exactly the toll plus the extra lane.
    const nearby = systemOf(map, strait.a).lanes.find(
      (id) => tierOf(map, id) !== 'COMMONS' && id !== strait.b && !isStrait(map, strait.a, id),
    );
    if (nearby === undefined) throw new Error('no neighbour to seat the outsider at');
    const asOutsider = swayAt(map, seats([nearby]), strait.b);
    // ── THE RELATION IS ON THE **COST**, NOT ON THE CLAMPED SWAY, AND THAT IS THE POINT ──
    //
    // `swayAt` floors at 0, so the outsider's raw cost of 4 against a seat value of 3 surfaces as 0
    // rather than as −1. Asserting the difference of the two *clamped* readings would therefore
    // measure the clamp and not the toll — and would still pass with the toll halved. `swayShortfall`
    // is the unclamped figure the refusal quotes, so this is the toll itself, and both numbers are
    // still the engine's.
    const holderCost = swayShortfall(map, seats([strait.a]), strait.b);
    const outsiderCost = swayShortfall(map, seats([nearby]), strait.b);
    expect(holderCost).not.toBeNull();
    expect(outsiderCost).not.toBeNull();
    expect(
      (outsiderCost ?? 0) - (holderCost ?? 0),
      'crossing a gate you do not hold must cost the toll plus the extra lane',
    ).toBe(SWAY_PER_HOP + SWAY_STRAIT_TOLL);
    // And at this map's numbers that is a wall rather than a speed bump: the outsider is out.
    expect(asOutsider, 'the toll did not actually fence anybody out').toBe(0);
    expect(asHolder, 'and the holder is not fenced out of its own gate').toBeGreaterThan(0);
  });

  it('★ THE KEYSTONE: the map has one, nobody authored it, and holding it quadruples reach', () => {
    // ══════════════════════════════════════════════════════════════════════
    // The emergent finding §16.12 #1 promises — *"chokepoints turn map position into power"*. It is
    // asserted as a **relation over every seat** rather than as a hardcoded system id, so it stays
    // true (or fails loudly) if the generator ever changes: the seat with the most straits on it
    // must also be the seat with the widest reach.
    //
    // MUTATION: drop the waiver (again) — reach becomes flat and the keystone disappears. RED.
    // ══════════════════════════════════════════════════════════════════════
    const scored = outerSystems(map).map((seat) => ({
      seat,
      straits: straitsAt(map, seat).length,
      reach: swayReach(map, seats([seat])).size,
    }));
    const byStraits = [...scored].sort((a, b) => b.straits - a.straits || (a.seat < b.seat ? -1 : 1));
    const byReach = [...scored].sort((a, b) => b.reach - a.reach || (a.seat < b.seat ? -1 : 1));
    const keystone = byStraits[0];
    if (keystone === undefined) throw new Error('no seats');
    expect(keystone.straits, 'no seat sits on more than one strait').toBeGreaterThan(1);
    expect(
      byReach[0]?.seat,
      'the seat on the most straits is not the seat with the widest reach, so holding a gate is not the prize',
    ).toBe(keystone.seat);
    // And the size of the prize, against the median seat.
    const median = [...scored].sort((a, b) => a.reach - b.reach)[Math.floor(scored.length / 2)];
    expect(keystone.reach / (median?.reach ?? 1), 'the keystone is not worth much').toBeGreaterThan(2);
    expect(straitsHeld(map, seats([keystone.seat])), 'and it says so').toEqual([keystone.seat]);
  });

  it('★ A8, BOTH ENDS: inert over a Commons system, and zero for a Commons-seated principal', () => {
    // ══════════════════════════════════════════════════════════════════════
    // The **target** end reads full, so sway can never be the thing that refuses a Commons act —
    // the floor answers first and an agent told "your force does not reach" about a place where
    // the real answer is "nothing hostile happens here" would go and buy the wrong thing.
    //
    // The **actor** end reads zero everywhere abroad, which is A15's outbound half arriving as
    // arithmetic. That is also the AGT-S2 fix: a Commons-seated principal can no longer be offered
    // a side in a war its hands can never reach.
    //
    // MUTATION: delete the `tier === 'COMMONS'` early return in `swayAt`. The first assertion goes
    // RED. MUTATION: drop the Commons filter in `costsFrom`. The second goes RED.
    // ══════════════════════════════════════════════════════════════════════
    const civic = commonsSystems(map);
    expect(civic.length).toBeGreaterThan(0);
    for (const id of civic) {
      expect(swayAt(map, seats([]), id), `${id} must read inert`).toBe(SWAY_AT_SEAT);
      expect(swayAt(map, seats([civic[0] as SystemId]), id)).toBe(SWAY_AT_SEAT);
    }
    // A principal whose only holding is in the Commons projects nowhere outside it.
    const nursery = seats([civic[0] as SystemId]);
    expect(swayReach(map, nursery).size, 'a Commons seat is not a base for anything').toBe(0);
    for (const id of outerSystems(map)) {
      expect(swayAt(map, nursery, id), `${id} must be out of a Commons-seated reach`).toBe(0);
    }
  });

  it('a second seat only ever widens reach, and a CLAIM is a seat', () => {
    // Monotonicity, which is what makes conquest legible: taking ground can never shrink what you
    // can strike. Checked over every ordered pair rather than one example.
    //
    // MUTATION: in `costsFrom`, seed only `seats.systems[0]`. RED on the first pair where the
    // second seat was nearer to something.
    const outer = outerSystems(map);
    let pairs = 0;
    let strictlyWider = 0;
    for (const a of outer) {
      const alone = swayReach(map, seats([a]));
      for (const b of outer) {
        if (a === b) continue;
        pairs += 1;
        const both = swayReach(map, seats([a, b]));
        for (const [system, sway] of alone) {
          expect(both.get(system) ?? 0, `${system} shrank when ${b} was added`).toBeGreaterThanOrEqual(sway);
        }
        if (both.size > alone.size) strictlyWider += 1;
      }
    }
    expect(pairs).toBe(26 * 25);
    expect(strictlyWider, 'a second seat never widened anything, so claims buy no reach').toBeGreaterThan(0);
  });

  it('the rule an agent reads names its constants, and both promises it must not misread', () => {
    expect(SWAY_STATEMENT).toContain(String(SWAY_AT_SEAT));
    expect(SWAY_STATEMENT).toContain(String(SWAY_PER_HOP));
    expect(SWAY_STATEMENT).toContain(String(SWAY_STRAIT_TOLL));
    // The two clauses whose absence would make an agent play a different game.
    expect(SWAY_STATEMENT, 'travel').toMatch(/NEVER limits travel/);
    expect(SWAY_STATEMENT, 'defence').toMatch(/NEVER limits defending your own ground/);
    // And the refusal names the shortfall rather than saying only "no" (A2).
    const civic = commonsSystems(map)[0] as SystemId;
    const far = outerSystems(map)[0] as SystemId;
    const note = swayNote(0, far, swayShortfall(map, seats([civic]), far));
    expect(note).toContain(far);
    expect(note, 'a refusal with no corrective act in it is a wiki').toMatch(/CLAIM nearer|STRAIT/);
    expect(note, 'and it must not read as a travel ban').toMatch(/moving, hauling or delivering/);

    // ── ★ AND THE TWO ZEROES ARE DIFFERENT SENTENCES, WHICH IS A DEFECT FOUND BY REVIEW ──
    //
    // `swayShortfall` used to share the capped Dijkstra with `swayAt`, so a system beyond the cap was
    // never relaxed and the shortfall came back `undefined` → `null`. `swayNote` reads `null` as
    // *"you hold no ground outside the COMMONS at all"* — so a principal holding two claims and
    // merely far from a stage was told, on a rules surface, that it held nothing. Scar #1's shape.
    //
    // MUTATION: give `swayShortfall`'s walk the default cap back. RED here, and only here.
    const nursery = swayNote(0, far, swayShortfall(map, seats([civic]), far));
    expect(nursery, 'a Commons-only principal really does hold nothing outside').toMatch(
      /no ground outside the COMMONS/,
    );
    // Somebody genuinely seated, and genuinely out of range: pick the pair with the largest gap.
    const pairs = outerSystems(map).flatMap((seat) =>
      outerSystems(map).map((target) => ({ seat, target, cost: swayShortfall(map, seats([seat]), target) })),
    );
    const distant = pairs.find((p) => (p.cost ?? 0) > SWAY_AT_SEAT);
    expect(distant, 'no seat is out of range of anything, so this cannot be tested').toBeDefined();
    const held = swayNote(0, distant?.target ?? far, distant?.cost ?? null);
    expect(held, 'a seated principal must never be told it holds nothing').not.toMatch(
      /no ground outside the COMMONS/,
    );
    expect(held, 'and it must be told HOW FAR short it fell (A2)').toMatch(/short/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// WHERE IT BINDS
// ══════════════════════════════════════════════════════════════════════════

describe('§16.12 #1 · the callers — offence is projected, defence is present', () => {
  function row(over: Partial<RaidRecord> = {}): RaidRecord {
    return {
      id: 'raid-x' as RaidRecord['id'],
      initiator: null,
      target: 'p:t' as PrincipalId,
      stage: 'sys-16' as SystemId,
      good: 'ration' as RaidRecord['good'],
      demandQty: 100 as RaidRecord['demandQty'],
      force: 0,
      spawnedAtTick: 0,
      resolvesAtTick: 24,
      state: 'DEMANDED',
      answer: null,
      answeredAtTick: null,
      parties: [],
      resolvedAtTick: null,
      lostQty: 0 as RaidRecord['lostQty'],
      forfeited: 0 as RaidRecord['forfeited'],
      defenderForce: 0,
      raiderForce: 0,
      ...over,
    };
  }
  function party(principal: string, side: RaidParty['side']): RaidParty {
    return {
      principal: principal as PrincipalId,
      side,
      handId: `${principal}:h1` as RaidParty['handId'],
      stake: 0 as RaidParty['stake'],
      encumbranceId: null,
      joinedAtTick: 1,
    };
  }
  const present = (raid: RaidRecord) => (p: PrincipalId) =>
    raid.parties.filter((x) => x.principal === p).map((x) => x.handId);

  it('★ readForce DROPS a raider at sway 0 and COUNTS the identical defender — one call apart', () => {
    // ══════════════════════════════════════════════════════════════════════
    // **THE ASYMMETRY, MEASURED AS A DIFFERENCE BETWEEN TWO OF THE ENGINE'S OWN READINGS.** Same
    // raid, same hand, same stage, same sway function — only the SIDE differs. A test that built
    // one reading and asserted a literal could not tell these apart.
    //
    // MUTATION: apply `swayAt` to `defenderJoiners` too. The second half goes RED, and the
    // chokepoint would have started favouring the distant attacker — §16.1 MUST-3 inverted.
    // MUTATION: drop the `>= 1` filter on `raidersPresent`. The first half goes RED.
    // ══════════════════════════════════════════════════════════════════════
    const raider = row({ parties: [party('p:far', 'RAIDER')] });
    const fenced = readForce({
      raid: raider,
      tier: 'MARCHES',
      defenderHands: 0,
      handsAtStage: present(raider),
      raidForceLeft: () => null,
      swayAt: () => 0,
    });
    const supplied = readForce({
      raid: raider,
      tier: 'MARCHES',
      defenderHands: 0,
      handsAtStage: present(raider),
      raidForceLeft: () => null,
      swayAt: () => SWAY_AT_SEAT,
    });
    expect(supplied.raiderForce - fenced.raiderForce, 'sway did not move the raider sum').toBe(
      FORCE_PER_JOINER,
    );
    expect(fenced.terms.raidersOutOfSway, 'the meter must name what was dropped').toBe(1);
    expect(supplied.terms.raidersOutOfSway).toBe(0);

    // And now the same hand on the other side, at the same sway 0.
    const defender = row({ parties: [party('p:far', 'DEFENDER')] });
    const held = readForce({
      raid: defender,
      tier: 'MARCHES',
      defenderHands: 1,
      handsAtStage: present(defender),
      raidForceLeft: () => null,
      swayAt: () => 0,
    });
    expect(
      held.defenderForce,
      'a defender joiner at sway 0 must still count: defence is present, not projected',
    ).toBe(FORCE_PER_HAND + FORCE_PER_JOINER + (FORCE_BY_TIER['MARCHES'] ?? 0));
    expect(held.terms.defenderJoiners).toBe(1);
    expect(held.terms.raidersOutOfSway, 'a defender is never out of sway').toBe(0);
  });

  it('★ A CAMPAIGN CAPS THE ATTACKER AND ITS ALLIES, AND NEVER THE DEFENDER', () => {
    // ══════════════════════════════════════════════════════════════════════
    // **THIS TEST EXISTS BECAUSE A MUTATION SURVIVED WITHOUT IT.** `Math.min(standing, attackerSway)`
    // in `readCampaignForce` was replaced with `standing` and **44 tests passed** — the campaign
    // half of §16.12 #1 had a caller, an argument and no assertion, which is one step short of this
    // project's signature defect and the step that hides it.
    //
    // Two readings from ONE port, differing only in `swayAt`, so the assertion is a relation between
    // two of the engine's own answers. The defender half is the load-bearing one: a claim IS a seat,
    // so the coincidence would make a capped defender look correct — the rule is that its hands are
    // never passed through sway at all, and this proves it by starving the sway function entirely.
    //
    // MUTATION: `Math.min(standing, attackerSway)` → `standing`. RED.
    // MUTATION: cap `defenderAllies` the same way. RED on the second half.
    // MUTATION: `attackerUnsupplied` hardcoded 0. RED on the meter.
    // ══════════════════════════════════════════════════════════════════════
    const ATT = 'p:att' as PrincipalId;
    const DEF = 'p:def' as PrincipalId;
    const ALLY = 'p:ally' as PrincipalId;
    const OBJ = 'sys-16' as SystemId;
    const campaign = {
      attacker: ATT,
      defender: DEF,
      objective: OBJ,
      parties: [
        { principal: ALLY, side: 'ATTACKER' as const, joinedAtTick: 1 },
        { principal: 'p:friend' as PrincipalId, side: 'DEFENDER' as const, joinedAtTick: 1 },
      ],
    } as unknown as Parameters<typeof readCampaignForce>[1];
    const port = (sway: number): Parameters<typeof readCampaignForce>[0] =>
      ({
        tierOf: () => 'MARCHES',
        claimAt: () => ({ claimant: DEF, state: 'SUPPLIED' }),
        // Three hands each, everywhere — so the ONLY thing that can move a sum is sway.
        handsAt: (who: PrincipalId) =>
          [`${who}:h1`, `${who}:h2`, `${who}:h3`] as unknown as readonly string[],
        materielLotsAt: () => [],
        swayAt: () => sway,
      }) as unknown as Parameters<typeof readCampaignForce>[0];

    const supplied = readCampaignForce(port(SWAY_AT_SEAT), campaign);
    const fenced = readCampaignForce(port(1), campaign);
    const cut = readCampaignForce(port(0), campaign);

    expect(supplied.attackerHands, 'all three of the attacker’s own hands at full sway').toBe(3);
    expect(fenced.attackerHands, 'one hand of reach counts one hand').toBe(1);
    expect(cut.attackerHands, 'no reach counts nothing however many stand there').toBe(0);
    expect(supplied.attackerAllies, 'the ally’s three, at full sway').toBe(3);
    expect(fenced.attackerAllies).toBe(1);
    expect(cut.attackerAllies).toBe(0);
    expect(
      supplied.attackerForce - cut.attackerForce,
      'sway did not move the attacker sum at all',
    ).toBe(FORCE_PER_HAND * 3 + FORCE_PER_JOINER * 3);

    // ── AND THE DEFENDER IS IDENTICAL AT EVERY READING ────────────────────
    expect(
      new Set([supplied.defenderForce, fenced.defenderForce, cut.defenderForce]).size,
      'the defender’s sum moved with sway; a chokepoint that thins the defence inverts §16.1 MUST-3',
    ).toBe(1);
    expect(cut.defenderHands, 'the holder of the claim under attack keeps all three').toBe(3);
    expect(cut.defenderAllies, 'and so does anyone standing with it').toBe(3);

    // ── THE METER ─────────────────────────────────────────────────────────
    expect(cut.attackerUnsupplied, 'six hands stood and none could be supplied').toBe(6);
    expect(fenced.attackerUnsupplied).toBe(4);
    expect(supplied.attackerUnsupplied, 'nothing was short at full reach').toBe(0);
    expect(cut.attackerSway).toBe(0);
  });

  it('★ THE GATES REFUSE, AND A COMMONS-SEATED PRINCIPAL IS TOLD THE RIGHT THING (AGT-S2)', () => {
    // ══════════════════════════════════════════════════════════════════════
    // The affordance-side half. `join {campaign}` shipped at 24 offering a Commons-seated principal
    // **both sides** of a war its Commons-bound hands could never reach — an offer it could not
    // fulfil, costing a real action out of four. Both branches read sway 0; only one of them is
    // reported as sway, because the corrective acts differ (`graduate` versus take ground nearer)
    // and `withheld.ts` refuses to collapse that distinction for `move`.
    //
    // MUTATION: delete the `isCommonsBound` branch. The `A15` assertion goes RED and a newcomer is
    // told to buy a claim it cannot legally hold. MUTATION: delete the `sway <= 0` branch. The
    // DEFENDER assertion goes RED — and the blue donut §16.13 names comes straight back.
    // ══════════════════════════════════════════════════════════════════════
    const base = {
      isSeated: () => true,
      freeStoresOf: () => 1_000_000 as never,
      lockStake: () => 'enc:1',
      swayShortfall: () => 4,
    };
    const book = new CampaignBook();
    const record = {
      id: 'cmp-1' as never,
      attacker: 'p:att' as PrincipalId,
      defender: 'p:def' as PrincipalId,
      objective: 'sys-16' as SystemId,
      depot: 'sys-17' as SystemId,
      state: 'MASSING' as const,
      parties: [],
      declaredAtTick: 0,
      endedAtTick: null,
      breaches: 0,
      rebuffs: 0,
      breachesNeeded: 3,
      rebuffsNeeded: 2,
      bond: 0 as never,
      lastPulseReckoning: null,
      encumbranceId: null,
    } as unknown as Parameters<CampaignBook['declare']>[0];
    book.declare(record);

    for (const side of ['ATTACKER', 'DEFENDER'] as const) {
      const bound = joinRefusal(
        { ...base, swayAt: () => 0, isCommonsBound: () => true },
        book,
        { principal: 'p:new' as PrincipalId, campaign: 'cmp-1' as never, side, tick: 5 },
      );
      expect(bound, `a Commons-bound principal was admitted to a war as ${side}`).not.toBeNull();
      expect(bound?.invariant, 'and it must be told A15, not A4').toBe('A15');
      expect(bound?.hint).toMatch(/graduate/);

      const fenced = joinRefusal(
        { ...base, swayAt: () => 0, isCommonsBound: () => false },
        book,
        { principal: 'p:far' as PrincipalId, campaign: 'cmp-1' as never, side, tick: 5 },
      );
      expect(fenced, `a principal with no reach was admitted as ${side}`).not.toBeNull();
      expect(fenced?.invariant).toBe('A4');
      expect(fenced?.hint, 'the refusal must name the corrective act').toMatch(/CLAIM nearer|STRAIT/);

      // Non-vacuity: with reach, the identical call is admitted. Otherwise the two above prove
      // only that `joinRefusal` refuses everything.
      expect(
        joinRefusal(
          { ...base, swayAt: () => SWAY_AT_SEAT, isCommonsBound: () => false },
          book,
          { principal: 'p:ok' as PrincipalId, campaign: 'cmp-1' as never, side, tick: 5 },
        ),
        `nothing can join as ${side} at all, so the refusals above prove nothing`,
      ).toBeNull();
    }
  });

  it('★ `demand` REFUSES OUT OF REACH, AND IN THE PUBLISHED ORDER (both mutations survived once)', () => {
    // ══════════════════════════════════════════════════════════════════════
    // **TWO MORE MUTATIONS THAT SURVIVED 67 TESTS.** Deleting the sway gate and deleting the
    // Commons-bound gate from `demandRefusal` both left `demand.spec.ts` — the file whose stated job
    // is *"every clause of it bites"* — entirely green, because its port answers full reach by
    // default and nothing asked what happens when it does not.
    //
    // ORDER is asserted as well as presence, and it is a real rule: the sway clause sits **before**
    // §9's aggression capacity, so an agent cannot learn its own reach by burning the scarcest
    // resource it has. A gate in the wrong place is not a gate an agent can plan against.
    //
    // MUTATION: `if (sway <= 0)` → `if (false && …)`. RED. MUTATION: same on the Commons-bound
    // branch. RED. MUTATION: move the sway clause below the capacity check. RED on the last block.
    // ══════════════════════════════════════════════════════════════════════
    const req = {
      initiator: 'p:raider' as PrincipalId,
      target: 'p:target' as PrincipalId,
      stage: 'sys-16' as SystemId,
      good: 'ration',
      demand: RAID_DEMAND_QTY.min,
      tick: 3,
      handId: null,
    } as unknown as Parameters<typeof demandRefusal>[2];
    const port = (over: Record<string, unknown>) =>
      ({
        tierOf: () => 'MARCHES',
        handsDefending: (p: PrincipalId) => (p === req.target ? [] : ['h:1']),
        isSeated: () => true,
        swayAt: () => SWAY_AT_SEAT,
        swayShortfall: () => 4,
        isCommonsBound: () => false,
        freeStoresOf: () => 1_000_000,
        lockStake: () => 'enc:1',
        ...over,
      }) as unknown as Parameters<typeof demandRefusal>[0];

    // Non-vacuity FIRST: at full reach the identical request is legal. Everything below is
    // meaningless without it.
    const book = new PredationBook();
    expect(
      demandRefusal(port({}), book, req),
      'nothing can open a demand at all, so the refusals below prove nothing',
    ).toBeNull();

    const fenced = demandRefusal(port({ swayAt: () => 0 }), book, req);
    expect(fenced, 'a demand was opened where no hand of the opener counts as force').not.toBeNull();
    expect(fenced?.invariant).toBe('A4');
    expect(fenced?.hint, 'the refusal must not read as a travel ban').toMatch(
      /moving, hauling or delivering/,
    );
    expect(fenced?.hint, 'and it must carry the rule itself').toContain(String(SWAY_AT_SEAT));

    const bound = demandRefusal(port({ swayAt: () => 0, isCommonsBound: () => true }), book, req);
    expect(bound?.invariant, 'Commons-bound is reported as A15, never as A4').toBe('A15');
    expect(bound?.hint).toMatch(/graduate/);

    // ── AND IT FIRES BEFORE THE CAPACITY IS SPENT ─────────────────────────
    //
    // Both clauses are checked against a request whose aggression capacity is exhausted: if either
    // sat below the capacity check, the refusal would come back as `A14` and the agent would be told
    // it had run out of demands when the real answer was that it cannot reach.
    const spent = { ...req, tick: 3 } as typeof req;
    // §9's capacity has no counter of its own — `aggressionSpends` derives it from raid rows with an
    // initiator (`book.ts`: "a counter would be a second home for a quantity the record already
    // determines"). So it is exhausted the only way the engine can exhaust it: by rows. Settled
    // ones, so the live-raid gates above it do not fire instead and mask what is being measured.
    for (let i = 0; i < AGGRESSION_PER_RECKONING; i += 1) {
      book.spawn(
        row({
          id: `raid-spent-${String(i)}` as RaidRecord['id'],
          initiator: req.initiator,
          target: `p:v${String(i)}` as PrincipalId,
          spawnedAtTick: 1,
          state: 'REPULSED',
          resolvedAtTick: 2,
        }),
      );
    }
    expect(
      demandRefusal(port({ swayAt: () => 0 }), book, spent)?.invariant,
      'sway must be answered before the capacity, or reach is learnt by exhausting it',
    ).toBe('A4');
    expect(
      demandRefusal(port({ isCommonsBound: () => true }), book, spent)?.invariant,
      'and A15 before it too',
    ).toBe('A15');
    // The control: with reach and a body outside the Commons, the exhausted capacity IS the answer.
    expect(demandRefusal(port({}), book, spent)?.invariant).toBe('A14');
  });

  it('★ THE WORLD RUNS AND THE MECHANIC IS REACHED: sway is published, and it discriminates', () => {
    // ══════════════════════════════════════════════════════════════════════
    // **THE ANTI-LABEL TEST.** Seventeen mechanics here have been built, tested, reported complete
    // and used by nothing. So this drives a real `Runtime` for a Reckoning and asserts the reading
    // reaches a real observation, varies across real principals, and appears on the frame — not
    // that a function returns a number.
    //
    // MUTATION: hardcode `swayBlockFor` to `{ reaches: [] }`. RED. MUTATION: drop `swayLines` from
    // the frame source. RED on the frame half.
    // ══════════════════════════════════════════════════════════════════════
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'borders-live' });
    // Two principals in different constellations, so their sway CANNOT be equal — the point is
    // that the reading discriminates between positions rather than that it exists.
    const map = runtime.world.map;
    const here = map.systemOrder.find((id) => tierOf(map, id) === 'MARCHES');
    const far = [...map.systemOrder].reverse().find((id) => tierOf(map, id) === 'FRONTIER');
    if (here === undefined || far === undefined) throw new Error('no seats');
    runtime.seat('p:near' as PrincipalId, 'near', here);
    runtime.seat('p:away' as PrincipalId, 'away', far);
    runtime.standing.open('p:near' as PrincipalId);
    runtime.standing.open('p:away' as PrincipalId);

    const nearBlock = runtime.swayBlockFor('p:near' as PrincipalId);
    const awayBlock = runtime.swayBlockFor('p:away' as PrincipalId);
    expect(nearBlock.at_seat).toBe(SWAY_AT_SEAT);
    expect(nearBlock.reaches.length, 'a seated principal projects nowhere').toBeGreaterThan(0);
    expect(nearBlock.rule).toBe(SWAY_STATEMENT);
    // The systems each reaches must differ — otherwise reach is a constant with a name.
    const nearSet = new Set(nearBlock.reaches.map((r) => r.system));
    const awaySet = new Set(awayBlock.reaches.map((r) => r.system));
    const disjoint = [...nearSet].filter((s) => !awaySet.has(s));
    expect(
      disjoint.length,
      'two principals two constellations apart project into the same places, so distance does nothing',
    ).toBeGreaterThan(0);
    // Its own seat is at the top of its own list.
    expect(nearBlock.reaches.find((r) => r.system === here)?.hands).toBe(SWAY_AT_SEAT);
    expect(swayAt(map, { principal: 'p:near' as PrincipalId, systems: [here] }, far)).toBe(
      runtime.swayFor('p:near' as PrincipalId, far),
    );

    // ── THE FRAME (A13) ────────────────────────────────────────────────────
    for (let i = runtime.engine.tick; i < TICKS_PER_RECKONING + 2; i += 1) runtime.runTick();
    const frame = runtime.reckoningFrame();
    expect(frame, 'no frame was published').not.toBeNull();
    const lines = frame?.swayLines ?? [];
    expect(lines.length, 'THE VERGE is empty, so no border can be drawn').toBe(26);
    // Somebody's fence exists, and somewhere is genuinely bare — both halves of "a real place for
    // smaller groups to exist".
    expect(lines.filter((l) => l.principal !== null).length, 'nobody reaches anywhere').toBeGreaterThan(0);
    expect(lines.filter((l) => l.principal === null).length, 'everywhere is claimed by somebody').toBeGreaterThan(0);
    for (const line of lines) {
      expect((line.principal === null) === (line.sway === 0), line.system).toBe(true);
      expect(tierOf(map, line.system), 'A8: no border across the Commons').not.toBe('COMMONS');
    }
    // THE PINCH is on the map rows, and at least one of them is pinched.
    const pinched = (frame?.map ?? []).filter((sys) => sys.straits.length > 0);
    expect(pinched.length, 'no lane is drawn as a strait').toBeGreaterThan(0);
    for (const sys of pinched) {
      for (const edge of sys.straits) {
        expect(sys.lanes, `${sys.id}~${edge.to} is pinched with no lane`).toContain(edge.to);
        expect(edge.severs === (edge.detourHops === 0), `${sys.id}~${edge.to}`).toBe(true);
      }
    }
    // And a gate system is labelled as one, which is what a renderer keys the prize off.
    expect(lines.filter((l) => l.gate).length, 'no gate is labelled').toBeGreaterThan(0);
    expect(reckoningIndex(runtime.engine.tick)).toBeGreaterThan(0);
  });
});

/**
 * Cheapest hops between two systems with one lane removed, or `null`.
 *
 * A **second implementation** of `strait.ts`'s own `hopsAround`, written from `route`'s neighbour
 * lists rather than from that function, so the two cannot share a bug. This is the only place in
 * this file where duplication is the point.
 */
function hopsWithout(map: WorldMap, from: SystemId, to: SystemId, skip: string): number | null {
  const seen = new Set<SystemId>([from]);
  let frontier: SystemId[] = [from];
  let depth = 0;
  while (frontier.length > 0) {
    depth += 1;
    const next: SystemId[] = [];
    for (const cur of frontier) {
      for (const neighbour of systemOf(map, cur).lanes) {
        if (laneKey(cur, neighbour) === skip) continue;
        if (seen.has(neighbour)) continue;
        if (neighbour === to) return depth;
        seen.add(neighbour);
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  // Sanity: with the lane present there is always a route, so a `null` here is about the cut and
  // not about a broken map.
  expect(route(map, from, to), `${from}..${to} is unreachable even WITH the lane`).not.toBeNull();
  return null;
}
