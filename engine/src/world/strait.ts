/**
 * STRAITS — the chokepoint half of `PASS-TERRITORY-POLITICS` §16.12 #1, and §16.1 MUST-3.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE PROBLEM THIS SOLVES, STATED AS THE MAP HAD IT.**
 *
 * `map.ts` has said since commit #1 that the single inter-constellation gate *"is the chokepoint
 * that makes interception a real game instead of a lottery over parallel routes, and it is what a
 * viewer learns to watch."* That sentence was true about the **graph** and false about the
 * **rules**: nothing anywhere read it. Thirty systems, thirty-five lanes, and **no lane was more
 * important than another to any mechanic**, so there was no border anywhere, nothing was
 * defensible, and a large holder was strictly better than a small one at every point on the map.
 *
 * §16.1 MUST-3 is the fix, in its own words: *"Chokepoints turn map position into power … and let
 * a smaller defender exploit interior lines."*
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── WHY THIS IS DERIVED AND NOT A FIELD ON `Lane` ─────────────────────────────
 *
 * §16.1 MUST-1 fixes the map: *"a stable named geography"*, not procedural and not seasonal. So a
 * STRAIT is a **property of the graph every agent can read and plan against** — A2 working in our
 * favour rather than against it — and the honest way to express "derived from the graph" is a
 * function of the graph.
 *
 * It also has to be that way for a second, harder reason. `mapCanonical` feeds `mapHash`, and
 * `tick/snapshot.ts` writes `mapHash` into every snapshot and **compares it on restore**. Putting
 * a `strait` boolean on {@link import('./map.js').Lane} would therefore change the identity of a
 * map whose topology did not change by one lane, and a live world would refuse its own durable
 * record at boot. Derived costs one memo and buys a world that keeps reading its own snapshots.
 *
 * ── THE DEFINITION, AND WHY IT IS TWO CLAUSES RATHER THAN ONE ─────────────────
 *
 * A lane is a STRAIT when **either**:
 *
 *   1. cutting it **severs** at least {@link STRAIT_MIN_SEVERED} systems from the rest of the
 *      region — the lane is the only way in or out of a territory; **or**
 *   2. the cheapest way **around** it is at least {@link STRAIT_DETOUR_HOPS} lanes — the lane is
 *      not literally the only way, but the alternative is a trip around the region.
 *
 * Neither clause alone is enough, and the launch map is the proof of both directions.
 *
 * **Clause 2 alone misses the severing lanes**, because a lane that severs has *no* detour at all
 * and `null` is not `>= 6`. **Clause 1 alone misses every constellation gate**, and that is the
 * more interesting failure: `LAUNCH_PLAN.interConstellationPairs` is a **diamond**, so the four
 * gates lie on a ring and cutting any one of them severs nothing — Orison→Nettle can be replaced
 * by Orison→Vale→Ashen Ford→…→Nettle. A pure bridge test therefore classifies the four lanes
 * `map.ts` itself calls *"the chokepoint"* as ordinary. The detour is ten hops. That is a
 * chokepoint by every meaning of the word except graph-theoretic 2-edge-connectivity, which is
 * why the definition does not use it.
 *
 * `STRAIT_MIN_SEVERED` is the second clause's own guard: a lane to a **dead-end system** severs
 * exactly one system, and a cul-de-sac is not a border. Three is the smallest number that makes
 * "a territory" mean more than "a room".
 *
 * ── THE COMMONS IS NEVER PINCHED (A8) ────────────────────────────────────────
 *
 * §16.1 MUST-3: *"Commons always retains a protected civic route."* A lane with a COMMONS system
 * at either end is **never** a STRAIT, whatever the graph says — and on the launch map the graph
 * says plenty: `sys-01~sys-03` severs Candle outright and `sys-02~sys-05` has a four-hop detour.
 * {@link assertStraits} halts on a violation rather than filtering hopefully, because A8 is a
 * floor and a floor held up by one function behaving well is not a floor.
 *
 * ── CALIBRATION, MEASURED RATHER THAN CHOSEN ─────────────────────────────────
 *
 * Over the launch map the detour histogram is `{2: 9, 3: 4, 4: 4, 10: 8, CUT: 10}` — a **gap
 * between 4 and 10 with nothing in it**, so any threshold from 5 to 10 selects the same lanes and
 * the number is on a plateau rather than on a slope. That is what makes it a structural break
 * instead of a tuned constant, and it is why `STRAIT_DETOUR_HOPS` is documented with the
 * measurement instead of a `(calibrate)` tag.
 *
 * Over **300 generated seeds** the count is 4–17 straits with a mode of 8, and **not one seed
 * produced a map with no strait at all** — which is what licenses {@link assertStraits}'s
 * non-vacuity clause to run at construction instead of only in a test.
 */

import type { SystemId } from '../core/types.js';
import { cmpStr, laneKey, type Lane, type LaneKey, type WorldMap } from './map.js';

export class StraitError extends Error {}

/**
 * How far the graph must go around a lane before the lane counts as a STRAIT.
 *
 * Ten is the launch map's own answer for every constellation gate; four is the largest ordinary
 * detour. **Six sits in the empty gap between them**, so the classification is identical anywhere
 * in 5..10 and the constant is not load-bearing to a hop. See the header's histogram.
 */
export const STRAIT_DETOUR_HOPS = 6;

/**
 * How many systems cutting a lane must strand before the cut counts as a border.
 *
 * A dead-end system's only lane severs exactly one system. That is a cul-de-sac, and treating it
 * as a border would put a STRAIT on nine of the launch map's thirty-five lanes for no political
 * reason — the systems behind them cannot host a bloc.
 */
export const STRAIT_MIN_SEVERED = 3;

/**
 * One lane the region cannot cheaply route around.
 *
 * Both measurements are published rather than reduced to a boolean, because they are the two
 * different reasons a lane matters and an agent plans differently against each: a **severing**
 * strait is a door, and a **detour** strait is a shortcut whose alternative is a long march. The
 * frame draws the number (see `contract.ts`'s THE PINCH), so it has to be a number here.
 */
export interface Strait {
  readonly key: LaneKey;
  /** Endpoints, in the lane's own canonical order. */
  readonly a: SystemId;
  readonly b: SystemId;
  /**
   * Lanes in the cheapest route between the endpoints **with this lane removed**, or `0` when
   * there is no such route at all.
   *
   * Zero rather than `null` on purpose: `canonicalize` admits integers everywhere and this value
   * reaches the frame, and "0 hops around" is unambiguous — you cannot get around a lane in zero
   * lanes, so the reader that wants the distinction reads {@link severs}, which states it.
   */
  readonly detourHops: number;
  /** True when removing this lane disconnects the region. Then {@link detourHops} is 0. */
  readonly severs: boolean;
  /** Systems stranded if it is cut — the smaller side. `0` when the lane does not sever. */
  readonly severed: number;
}

/**
 * Derived, so it is recomputed rather than stored — and memoised, so it is recomputed once.
 *
 * The `WeakMap` is keyed by the map object and holds no world state: it is a cache over a pure
 * function of a frozen input, exactly the shape `ledger/invariants.ts` uses and for the same
 * stated reason — **derived state must never reach `state_hash`**. A `WorldMap` never mutates
 * after `generateMap` returns, so a stale entry is unrepresentable.
 */
const MEMO = new WeakMap<WorldMap, ReadonlyMap<LaneKey, Strait>>();

/** Every STRAIT on a map, keyed by lane, in canonical lane order. */
export function straitsOf(map: WorldMap): ReadonlyMap<LaneKey, Strait> {
  const cached = MEMO.get(map);
  if (cached !== undefined) return cached;
  const found = new Map<LaneKey, Strait>();
  // `laneOrder` is already sorted by code unit, so insertion order here is canonical and a
  // consumer that iterates the result gets one order on every host (DET-4).
  for (const key of map.laneOrder) {
    const lane = map.lanes.get(key);
    if (lane === undefined) continue;
    const strait = classify(map, lane);
    if (strait !== null) found.set(key, strait);
  }
  MEMO.set(map, found);
  return found;
}

function classify(map: WorldMap, lane: Lane): Strait | null {
  // A8's half, first and unconditionally: the Commons keeps a civic route that cannot be pinched.
  if (touchesCommons(map, lane)) return null;

  const detour = hopsAround(map, lane);
  if (detour === null) {
    const severed = Math.min(sideSize(map, lane.a, lane.key), sideSize(map, lane.b, lane.key));
    if (severed < STRAIT_MIN_SEVERED) return null;
    return { key: lane.key, a: lane.a, b: lane.b, detourHops: 0, severs: true, severed };
  }
  if (detour < STRAIT_DETOUR_HOPS) return null;
  return { key: lane.key, a: lane.a, b: lane.b, detourHops: detour, severs: false, severed: 0 };
}

function touchesCommons(map: WorldMap, lane: Lane): boolean {
  return (
    map.systems.get(lane.a)?.tier === 'COMMONS' || map.systems.get(lane.b)?.tier === 'COMMONS'
  );
}

/**
 * Lanes in the cheapest route between a lane's endpoints without using it, or `null` if there is
 * none.
 *
 * **Hops, not `transitTicks`** — and that is a rules decision, not a shortcut. §4.3 makes
 * `transit_ticks` the load-bearing *travel* number, and travel is deliberately untouched by this
 * module (see `sway.ts`). What a chokepoint measures is **topology**: how many gates a force must
 * pass. Measuring it in ticks would make a chokepoint move when a gate's cost was recalibrated,
 * which would silently redraw every border in the game from a travel-time tweak.
 */
function hopsAround(map: WorldMap, lane: Lane): number | null {
  const seen = new Set<SystemId>([lane.a]);
  let frontier: SystemId[] = [lane.a];
  let depth = 0;
  while (frontier.length > 0) {
    depth += 1;
    const next: SystemId[] = [];
    // Sorted so the traversal order is one order on every host, even though BFS depth does not
    // depend on it — DET-4 is about never writing code whose determinism needs an argument.
    for (const cur of [...frontier].sort(cmpStr)) {
      const system = map.systems.get(cur);
      if (system === undefined) continue;
      for (const neighbour of system.lanes) {
        if (laneKey(cur, neighbour) === lane.key) continue;
        if (seen.has(neighbour)) continue;
        if (neighbour === lane.b) return depth;
        seen.add(neighbour);
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return null;
}

/** How many systems are on one side of a cut, including the endpoint itself. */
function sideSize(map: WorldMap, from: SystemId, without: LaneKey): number {
  const seen = new Set<SystemId>([from]);
  const queue: SystemId[] = [from];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === undefined) break;
    const system = map.systems.get(cur);
    if (system === undefined) continue;
    for (const neighbour of system.lanes) {
      if (laneKey(cur, neighbour) === without) continue;
      if (seen.has(neighbour)) continue;
      seen.add(neighbour);
      queue.push(neighbour);
    }
  }
  return seen.size;
}

// ── Queries ─────────────────────────────────────────────────────────────────

/** Is the lane between these two systems a STRAIT? False when there is no lane at all. */
export function isStrait(map: WorldMap, a: SystemId, b: SystemId): boolean {
  return straitsOf(map).has(laneKey(a, b));
}

/**
 * The STRAITS with an end at this system, in canonical lane order.
 *
 * This is the query that makes holding one *worth* something: `sway.ts` waives a strait's toll for
 * a principal seated at either of its ends, so the count here is the size of the prize.
 */
export function straitsAt(map: WorldMap, system: SystemId): readonly Strait[] {
  const out: Strait[] = [];
  for (const strait of straitsOf(map).values()) {
    if (strait.a === system || strait.b === system) out.push(strait);
  }
  return out;
}

/** The other end of a STRAIT, from one end. Null when the system is not on it. */
export function straitAcross(strait: Strait, from: SystemId): SystemId | null {
  if (strait.a === from) return strait.b;
  if (strait.b === from) return strait.a;
  return null;
}

// ── The rules surface ───────────────────────────────────────────────────────

/**
 * The rule, as one sentence, for the agent that has to plan against it.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THIS STRING IS A RULES SURFACE** (hard rule 4), the same as `DEMAND_RULE_STATEMENT`, and
 * `test/world/the-map-has-borders.spec.ts` pins every number in it to the constant it came from.
 * An agent that believes a strait blocks *travel* will never haul again; one that believes its
 * force crosses one for free will march into a standoff it cannot win.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const STRAIT_STATEMENT =
  'Some lanes are STRAITS: the region cannot cheaply route around them, either because cutting one ' +
  `strands ${String(STRAIT_MIN_SEVERED)} or more systems or because the way around is ` +
  `${String(STRAIT_DETOUR_HOPS)} lanes or more. A STRAIT never blocks travel and never costs a haul ` +
  'anything — `move` does not read this at all. What it costs is REACH: your SWAY is cut by ' +
  'crossing a STRAIT you do not hold, so offence past one needs ground on it. Holding either end ' +
  'of a STRAIT — a HOLDING or a CLAIM there — waives that cost for you, which is why a gate system ' +
  'is worth more than the ore under it. Straits are fixed with the map, never redrawn, and no lane ' +
  'touching the COMMONS is ever one (A8).';

/**
 * Everything the rest of the engine may assume about a map's straits.
 *
 * Run from `assertMapStructure`, so a map that violates it never exists.
 *
 * Both clauses have bitten. The **Commons** clause is A8 and the launch graph really does want to
 * pinch `sys-01~sys-03`; the **non-vacuity** clause is this project's signature defect pointed at
 * its own new mechanic — a world with no strait would run every gate below, publish every field,
 * pass every test, and mean nothing. 300 seeds say it cannot happen; the assertion is what makes
 * that a rule rather than a sample.
 */
export function assertStraits(map: WorldMap): void {
  const problems: string[] = [];
  const straits = straitsOf(map);

  if (straits.size === 0) {
    problems.push(
      'the map has no STRAIT, so every lane is interchangeable and §16.12 #1 has no chokepoint to ' +
        'stand on — power would have unlimited reach and no border would exist anywhere',
    );
  }
  if (straits.size === map.lanes.size) {
    problems.push(
      `every one of the ${String(map.lanes.size)} lanes is a STRAIT, which is the same as none ` +
        'being one: a distinction that holds everywhere distinguishes nothing',
    );
  }

  for (const strait of straits.values()) {
    const a = map.systems.get(strait.a);
    const b = map.systems.get(strait.b);
    if (a === undefined || b === undefined) {
      problems.push(`strait ${strait.key} names a system that does not exist`);
      continue;
    }
    if (a.tier === 'COMMONS' || b.tier === 'COMMONS') {
      problems.push(
        `strait ${strait.key} touches the COMMONS (${a.tier}/${b.tier}); §16.1 MUST-3 gives the ` +
          'Commons a protected civic route that cannot be pinched, and A8 is a floor rather than a ' +
          'default',
      );
    }
    if (strait.severs !== (strait.detourHops === 0)) {
      problems.push(
        `strait ${strait.key} reports severs=${String(strait.severs)} with detourHops=` +
          `${String(strait.detourHops)}; the two are one fact and must agree`,
      );
    }
    if (strait.severs && strait.severed < STRAIT_MIN_SEVERED) {
      problems.push(
        `strait ${strait.key} severs only ${String(strait.severed)} system(s), below ` +
          `STRAIT_MIN_SEVERED=${String(STRAIT_MIN_SEVERED)} — a cul-de-sac is not a border`,
      );
    }
    if (!strait.severs && strait.detourHops < STRAIT_DETOUR_HOPS) {
      problems.push(
        `strait ${strait.key} has a ${String(strait.detourHops)}-hop detour, below ` +
          `STRAIT_DETOUR_HOPS=${String(STRAIT_DETOUR_HOPS)}`,
      );
    }
  }

  if (problems.length > 0) {
    throw new StraitError(`strait structure invalid:\n  - ${problems.join('\n  - ')}`);
  }
}
