/**
 * The map: systems, constellations, lanes, zone tiers (SPEC §4).
 *
 * **Why a generator when §4.2 says "Phase 0 ships a fixed authored map"?** Both,
 * and they are the same artifact: the launch map *is* `generateMap(LAUNCH_SEED)`,
 * pinned and golden-filed by {@link mapHash}. Authored-by-pinned-seed is fixed —
 * it cannot drift without a golden file failing — and it means the schema and the
 * generator are exercised from commit #1 rather than retrofitted at Phase 1 when
 * growth opens new constellations.
 *
 * Two structural properties are asserted at construction rather than tested
 * hopefully, because a map that violates them cannot be repaired later without
 * deleting place IDs, and place IDs are permanent (§4.2):
 *
 *   1. **The Commons is reachable from every system.** A8 is a permanent floor,
 *      not a timer; a system with no path home would strand hands forever.
 *   2. **No lane leaves the Commons for another constellation.** The Commons sits
 *      in the interior of its own constellation, so leaving it always crosses the
 *      Marches. This is scar #14 generalised — the safest seat is also the
 *      deepest, so a newcomer cannot be adjacent to the Frontier on minute one.
 */

import { canonicalHash, type CanonicalValue } from '../core/canonical.js';
import { Rng } from '../core/rng.js';
import { GATE_TRANSIT } from '../core/time.js';
import type { ConstellationId, StarSystem, SystemId, ZoneTier } from '../core/types.js';

export class MapError extends Error {}

/**
 * String comparison by UTF-16 code unit — the same order on every host.
 * `localeCompare` is locale-dependent and would put macOS and Linux hashes on
 * different branches (DET-4), which is the same trap as Postgres collation.
 */
export function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ── Lanes ───────────────────────────────────────────────────────────────────

/**
 * A lane is the object; "gate transit" is the table it draws its cost from
 * (§4.3). One lane, one identity, one transit cost, both directions — a
 * per-direction cost would give the map a fast way in and a slow way out, and
 * nothing in the design asks for that.
 */
export type LaneKind = 'INTRA' | 'INTER';

export type LaneKey = string & { readonly __brand: 'LaneKey' };

export interface Lane {
  readonly key: LaneKey;
  /** Endpoints, ordered by code unit so the pair has exactly one key. */
  readonly a: SystemId;
  readonly b: SystemId;
  readonly kind: LaneKind;
  /**
   * §4.3: "the most load-bearing number in the design." Per-lane, fixed at
   * generation, never recomputed — an agent that quoted a route must be able to
   * rely on the arithmetic it quoted.
   */
  readonly transitTicks: number;
}

export function laneKey(a: SystemId, b: SystemId): LaneKey {
  return (cmpStr(a, b) <= 0 ? `${a}~${b}` : `${b}~${a}`) as LaneKey;
}

// ── The region ──────────────────────────────────────────────────────────────

export interface Constellation {
  readonly id: ConstellationId;
  readonly name: string;
  /** Canonical order: generation order, which is also tier order. */
  readonly systems: readonly SystemId[];
}

export interface WorldMap {
  readonly seed: string;
  /** Canonical iteration order for everything that must hash the same twice. */
  readonly systemOrder: readonly SystemId[];
  readonly constellationOrder: readonly ConstellationId[];
  readonly laneOrder: readonly LaneKey[];
  readonly systems: ReadonlyMap<SystemId, StarSystem>;
  readonly constellations: ReadonlyMap<ConstellationId, Constellation>;
  readonly lanes: ReadonlyMap<LaneKey, Lane>;
}

/**
 * Launch scale (§4.2): one region, 4 constellations, ~30 systems. The variable
 * was never system count — it is principals per stage — so this stays a named
 * plan rather than a tuning knob threaded through call sites.
 */
export interface MapPlan {
  readonly constellations: number;
  /** SPEC §4.2 bounds a constellation at 5–8 systems. */
  readonly systemsPerConstellation: { readonly min: number; readonly max: number };
  /** How many systems of the Commons constellation are COMMONS. */
  readonly commonsSystems: number;
  readonly commonsConstellation: number;
  readonly frontierConstellation: number;
  /**
   * Region shape. A diamond: the Commons constellation hubs to two Marches
   * constellations, both of which reach the Frontier. The Frontier is therefore
   * two constellation hops from the Commons and the Marches are unavoidably in
   * between — §4.1's "graduation ground", as topology rather than as advice.
   */
  readonly interConstellationPairs: readonly (readonly [number, number])[];
}

export const LAUNCH_PLAN: MapPlan = {
  constellations: 4,
  systemsPerConstellation: { min: 7, max: 8 },
  commonsSystems: 4,
  commonsConstellation: 0,
  frontierConstellation: 3,
  interConstellationPairs: [
    [0, 1],
    [0, 2],
    [1, 3],
    [2, 3],
  ],
};

/**
 * The pinned seed whose output is the Phase 0 launch map. Changing this string
 * rewrites the world's geography, which is why {@link mapHash} is golden-filed.
 */
export const LAUNCH_SEED = 'the-compact:phase0:region-1';

/** Total systems the launch plan is allowed to produce. Asserted, not assumed. */
export const LAUNCH_SYSTEM_BOUNDS = { min: 28, max: 32 } as const;

/** SPEC §4.2 — a constellation is 5–8 systems. Any plan is checked against this. */
export const CONSTELLATION_SIZE_BOUNDS = { min: 5, max: 8 } as const;

// ── Names ───────────────────────────────────────────────────────────────────

/**
 * Places are named because the feed needs them: "Vale's second hand fell at
 * Orison" only works if the system has a name a stranger can repeat. IDs are
 * permanent and never deleted (§4.2); names are the display layer, and Phase 0
 * acceptance adds a projection that renames places after whoever first developed
 * them — which is why the two are separate fields and not one.
 *
 * The civic names come first because the first systems generated are the Commons.
 */
const CIVIC_NAMES = ['Salt Ward', 'Low Ferry', 'Candle', 'Tallow'] as const;

const OUTER_NAMES = [
  'Orison',
  'Vale',
  'Bright Ash',
  'Quarrel',
  'Harrow',
  'Pale Reach',
  'Coldwater',
  'Stint',
  'Gallow Green',
  'Kiln',
  'Nettle',
  'Wither',
  'Bastion',
  'Mirefall',
  'Longshadow',
  'Ashen Ford',
  'Copper Wick',
  'Dunnage',
  'Grist',
  'Halyard',
  'Ironhold',
  'Jetsam',
  'Keelrow',
  'Lantern',
  'Moorage',
  'Nightjar',
  'Oxbow',
  'Pitch',
  'Quernstone',
  'Raker',
  'Sable',
  'Thrall',
] as const;

const SYSTEM_NAMES: readonly string[] = [...CIVIC_NAMES, ...OUTER_NAMES];

const CONSTELLATION_NAMES: readonly string[] = ['Hearth', 'Threshold', 'Marrow', 'Vane'];

// ── Generation ──────────────────────────────────────────────────────────────

interface MutableSystem {
  readonly id: SystemId;
  readonly constellation: ConstellationId;
  readonly name: string;
  readonly tier: ZoneTier;
  readonly lanes: Set<SystemId>;
}

/**
 * Build a map deterministically from a seed.
 *
 * Every draw comes from a labelled sub-stream, so adding a consumer to one stage
 * cannot shift the draws seen by another (see `Rng.derive`). Without that,
 * inserting one extra lane roll silently renames and re-wires the whole region
 * and every golden file fails at once, which reads as a corrupted map rather
 * than as the one-line change it was.
 */
export function generateMap(seed: string, plan: MapPlan = LAUNCH_PLAN): WorldMap {
  if (plan.constellations < 1) throw new MapError('a region needs at least one constellation');
  if (plan.commonsSystems < 1) throw new MapError('the Commons needs at least one system');
  if (plan.commonsSystems > CIVIC_NAMES.length) {
    throw new MapError(
      `plan asks for ${plan.commonsSystems} Commons systems but only ${CIVIC_NAMES.length} civic names exist`,
    );
  }
  if (plan.constellations > CONSTELLATION_NAMES.length) {
    throw new MapError(
      `plan asks for ${plan.constellations} constellations but only ${CONSTELLATION_NAMES.length} names exist`,
    );
  }

  const root = Rng.fromSeed(`map:${seed}`);
  const sizeRng = root.derive('constellation-sizes');
  const treeRng = root.derive('intra-topology');
  const extraRng = root.derive('intra-extra-lanes');
  const gateRng = root.derive('inter-gates');
  const transitRng = root.derive('gate-transit');

  const systems = new Map<SystemId, MutableSystem>();
  const systemOrder: SystemId[] = [];
  const constellations = new Map<ConstellationId, Constellation>();
  const constellationOrder: ConstellationId[] = [];
  const lanes = new Map<LaneKey, Lane>();

  // ── systems and constellations ────────────────────────────────────────────
  const perConstellation: SystemId[][] = [];
  let nextSystemIndex = 0;
  for (let c = 0; c < plan.constellations; c += 1) {
    const size = sizeRng.range(plan.systemsPerConstellation.min, plan.systemsPerConstellation.max);
    if (size < CONSTELLATION_SIZE_BOUNDS.min || size > CONSTELLATION_SIZE_BOUNDS.max) {
      throw new MapError(
        `constellation size ${size} is outside SPEC §4.2's 5-8 range; check the plan`,
      );
    }
    const cid = `con-${c + 1}` as ConstellationId;
    const ids: SystemId[] = [];
    for (let i = 0; i < size; i += 1) {
      const id = `sys-${String(nextSystemIndex + 1).padStart(2, '0')}` as SystemId;
      const name = SYSTEM_NAMES[nextSystemIndex];
      if (name === undefined) {
        throw new MapError(
          `out of authored system names at index ${nextSystemIndex}; add names before growing the region`,
        );
      }
      systems.set(id, {
        id,
        constellation: cid,
        name,
        tier: tierFor(c, i, plan),
        lanes: new Set<SystemId>(),
      });
      systemOrder.push(id);
      ids.push(id);
      nextSystemIndex += 1;
    }
    const cname = CONSTELLATION_NAMES[c];
    if (cname === undefined) throw new MapError('unreachable: constellation name exhausted');
    constellations.set(cid, { id: cid, name: cname, systems: ids });
    constellationOrder.push(cid);
    perConstellation.push(ids);
  }

  // ── intra-constellation lanes ─────────────────────────────────────────────
  // A random recursive tree: system i attaches to a uniformly chosen earlier
  // system. Two properties fall out for free, and both are load-bearing —
  // the constellation is always connected, and **any prefix of the generation
  // order is connected**, which is what makes the Commons a contiguous core
  // without a second pass to check it.
  for (const ids of perConstellation) {
    for (let i = 1; i < ids.length; i += 1) {
      const child = ids[i];
      const parent = ids[treeRng.int(i)];
      if (child === undefined || parent === undefined) {
        throw new MapError('unreachable: constellation index out of range');
      }
      addLane(lanes, systems, child, parent, 'INTRA', transitRng);
    }
    // A pure tree makes every system a choke point, which is too fragile: one
    // predator on one lane cuts a constellation in half. A third again as many
    // lanes gives alternatives without erasing chokepoints entirely.
    const extra = Math.floor(ids.length / 3);
    for (let k = 0; k < extra; k += 1) {
      const x = ids[extraRng.int(ids.length)];
      const y = ids[extraRng.int(ids.length)];
      if (x === undefined || y === undefined || x === y) continue;
      if (lanes.has(laneKey(x, y))) continue;
      addLane(lanes, systems, x, y, 'INTRA', transitRng);
    }
  }

  // ── inter-constellation lanes ─────────────────────────────────────────────
  // One lane per constellation pair. A single gate per pair is deliberate: it is
  // the chokepoint that makes interception a real game instead of a lottery over
  // parallel routes, and it is what a viewer learns to watch.
  const usedGates = new Set<SystemId>();
  for (const [x, y] of plan.interConstellationPairs) {
    const from = pickGate(perConstellation, systems, x, usedGates, gateRng);
    const to = pickGate(perConstellation, systems, y, usedGates, gateRng);
    usedGates.add(from);
    usedGates.add(to);
    if (lanes.has(laneKey(from, to))) continue;
    addLane(lanes, systems, from, to, 'INTER', transitRng);
  }

  const laneOrder = [...lanes.keys()].sort(cmpStr) as LaneKey[];
  const frozen = new Map<SystemId, StarSystem>();
  for (const id of systemOrder) {
    const s = systems.get(id);
    if (s === undefined) throw new MapError('unreachable: system missing from its own order');
    frozen.set(id, {
      id: s.id,
      constellation: s.constellation,
      name: s.name,
      tier: s.tier,
      lanes: [...s.lanes].sort(cmpStr),
    });
  }

  const map: WorldMap = {
    seed,
    systemOrder,
    constellationOrder,
    laneOrder,
    systems: frozen,
    constellations,
    lanes,
  };

  assertMapStructure(map, plan);
  return map;
}

/** The launch map. Fixed by construction: a pinned seed and a golden hash. */
export function launchMap(): WorldMap {
  return generateMap(LAUNCH_SEED);
}

function tierFor(constellationIndex: number, indexInConstellation: number, plan: MapPlan): ZoneTier {
  if (
    constellationIndex === plan.commonsConstellation &&
    indexInConstellation < plan.commonsSystems
  ) {
    return 'COMMONS';
  }
  if (constellationIndex === plan.frontierConstellation) return 'FRONTIER';
  return 'MARCHES';
}

function addLane(
  lanes: Map<LaneKey, Lane>,
  systems: Map<SystemId, MutableSystem>,
  x: SystemId,
  y: SystemId,
  kind: LaneKind,
  transitRng: Rng,
): void {
  if (x === y) throw new MapError(`self-lane at ${x}`);
  const key = laneKey(x, y);
  if (lanes.has(key)) throw new MapError(`duplicate lane ${key}`);
  const bounds = kind === 'INTRA' ? GATE_TRANSIT.intraConstellation : GATE_TRANSIT.interConstellation;
  const transitTicks = transitRng.range(bounds.min, bounds.max);
  const [a, b] = cmpStr(x, y) <= 0 ? [x, y] : [y, x];
  lanes.set(key, { key, a, b, kind, transitTicks });
  systems.get(x)?.lanes.add(y);
  systems.get(y)?.lanes.add(x);
}

function pickGate(
  perConstellation: readonly SystemId[][],
  systems: ReadonlyMap<SystemId, MutableSystem>,
  constellationIndex: number,
  usedGates: ReadonlySet<SystemId>,
  gateRng: Rng,
): SystemId {
  const ids = perConstellation[constellationIndex];
  if (ids === undefined) throw new MapError(`no constellation at index ${constellationIndex}`);
  // A COMMONS system is never a gate out of its constellation: leaving the
  // Commons must cross the Marches (see the file header).
  const eligible = ids.filter((id) => systems.get(id)?.tier !== 'COMMONS');
  if (eligible.length === 0) {
    throw new MapError(
      `constellation ${constellationIndex} is entirely COMMONS and cannot host an inter-constellation gate`,
    );
  }
  const fresh = eligible.filter((id) => !usedGates.has(id));
  return gateRng.pick(fresh.length > 0 ? fresh : eligible);
}

// ── Structure ───────────────────────────────────────────────────────────────

/**
 * Everything the rest of the engine is allowed to assume about a map. Run at
 * construction so an invalid map never exists, and again in tests over arbitrary
 * seeds — a generator that is correct for one seed and wrong for the next is the
 * shape of bug that survives until the day the region grows.
 */
export function assertMapStructure(map: WorldMap, plan: MapPlan = LAUNCH_PLAN): void {
  const problems: string[] = [];

  if (map.systemOrder.length !== map.systems.size) problems.push('systemOrder disagrees with systems');
  if (map.laneOrder.length !== map.lanes.size) problems.push('laneOrder disagrees with lanes');

  for (const [cid, con] of map.constellations) {
    if (
      con.systems.length < CONSTELLATION_SIZE_BOUNDS.min ||
      con.systems.length > CONSTELLATION_SIZE_BOUNDS.max
    ) {
      problems.push(
        `constellation ${cid} has ${con.systems.length} systems, outside SPEC §4.2's ${CONSTELLATION_SIZE_BOUNDS.min}-${CONSTELLATION_SIZE_BOUNDS.max}`,
      );
    }
  }

  for (const lane of map.lanes.values()) {
    if (lane.a === lane.b) problems.push(`self-lane ${lane.key}`);
    const a = map.systems.get(lane.a);
    const b = map.systems.get(lane.b);
    if (a === undefined || b === undefined) {
      problems.push(`lane ${lane.key} references a system that does not exist`);
      continue;
    }
    if (!a.lanes.includes(lane.b) || !b.lanes.includes(lane.a)) {
      problems.push(`lane ${lane.key} is not symmetric in the adjacency lists`);
    }
    const sameConstellation = a.constellation === b.constellation;
    if (sameConstellation !== (lane.kind === 'INTRA')) {
      problems.push(`lane ${lane.key} is marked ${lane.kind} but crosses constellations differently`);
    }
    const bounds =
      lane.kind === 'INTRA' ? GATE_TRANSIT.intraConstellation : GATE_TRANSIT.interConstellation;
    if (lane.transitTicks < bounds.min || lane.transitTicks > bounds.max) {
      problems.push(
        `lane ${lane.key} transit ${lane.transitTicks} ticks is outside the ${lane.kind} gate table`,
      );
    }
    if (!sameConstellation && (a.tier === 'COMMONS' || b.tier === 'COMMONS')) {
      problems.push(`lane ${lane.key} lets a COMMONS system leave its constellation`);
    }
  }

  for (const system of map.systems.values()) {
    for (const neighbour of system.lanes) {
      if (!map.lanes.has(laneKey(system.id, neighbour))) {
        problems.push(`${system.id} lists ${neighbour} as adjacent but no lane exists`);
      }
    }
  }

  const commons = commonsSystems(map);
  if (commons.length === 0) problems.push('the map has no COMMONS system; A8 has no floor to stand on');

  // Connectivity of the whole region, and of the Commons on its own. The second
  // matters because §9 promises "a complete if low-margin loop exists entirely
  // inside the Commons" — a disconnected Commons cannot host a haul.
  const reachedAll = reachable(map, map.systemOrder[0]);
  if (reachedAll.size !== map.systems.size) {
    problems.push(`the region is not connected: ${reachedAll.size} of ${map.systems.size} reachable`);
  }
  if (commons.length > 0) {
    const inCommons = new Set(commons);
    const reachedCommons = reachable(map, commons[0], (id) => inCommons.has(id));
    if (reachedCommons.size !== commons.length) {
      problems.push('the COMMONS systems are not connected to each other');
    }
  }

  // The property the whole safe floor rests on.
  for (const id of map.systemOrder) {
    if (nearestCommons(map, id) === null) {
      problems.push(`${id} cannot reach the Commons`);
    }
  }

  if (plan === LAUNCH_PLAN) {
    if (
      map.systems.size < LAUNCH_SYSTEM_BOUNDS.min ||
      map.systems.size > LAUNCH_SYSTEM_BOUNDS.max
    ) {
      problems.push(
        `launch plan produced ${map.systems.size} systems, outside ${LAUNCH_SYSTEM_BOUNDS.min}-${LAUNCH_SYSTEM_BOUNDS.max}`,
      );
    }
  }

  if (problems.length > 0) {
    throw new MapError(`map structure invalid:\n  - ${problems.join('\n  - ')}`);
  }
}

function reachable(
  map: WorldMap,
  start: SystemId | undefined,
  allow: (id: SystemId) => boolean = () => true,
): Set<SystemId> {
  const seen = new Set<SystemId>();
  if (start === undefined || !allow(start)) return seen;
  const queue: SystemId[] = [start];
  seen.add(start);
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === undefined) break;
    const system = map.systems.get(cur);
    if (system === undefined) continue;
    for (const next of system.lanes) {
      if (seen.has(next) || !allow(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

// ── Queries ─────────────────────────────────────────────────────────────────

export function systemOf(map: WorldMap, id: SystemId): StarSystem {
  const s = map.systems.get(id);
  if (s === undefined) throw new MapError(`no such system: ${id}`);
  return s;
}

export function tierOf(map: WorldMap, id: SystemId): ZoneTier {
  return systemOf(map, id).tier;
}

export function commonsSystems(map: WorldMap): readonly SystemId[] {
  return map.systemOrder.filter((id) => map.systems.get(id)?.tier === 'COMMONS');
}

export function laneBetween(map: WorldMap, a: SystemId, b: SystemId): Lane | null {
  return map.lanes.get(laneKey(a, b)) ?? null;
}

/**
 * Transit cost of one lane, in ticks. Throws if the systems are not adjacent —
 * a move is one lane (§4.3's `transit_ticks` is per gate), and multi-hop travel
 * is a route the agent walks one gate at a time. Silently returning a
 * shortest-path cost here would publish an ETA the mover cannot meet.
 */
export function transitTicks(map: WorldMap, from: SystemId, to: SystemId): number {
  const lane = laneBetween(map, from, to);
  if (lane === null) throw new MapError(`no lane between ${from} and ${to}`);
  return lane.transitTicks;
}

export interface Route {
  readonly path: readonly SystemId[];
  readonly lanes: readonly LaneKey[];
  /** Total transit, in ticks. Integer: lane costs are integers and add exactly. */
  readonly ticks: number;
}

/**
 * Cheapest route by total transit ticks, ties broken by system ID.
 *
 * This exists because of A2: legibility is the interface, and known arithmetic
 * must be exact and machine-readable. Making an agent reconstruct the lane graph
 * to answer "how long to Orison" is exactly the "go read a wiki" failure — and
 * it is free to answer here, so it is answered here.
 */
export function route(map: WorldMap, from: SystemId, to: SystemId): Route | null {
  systemOf(map, from);
  systemOf(map, to);
  if (from === to) return { path: [from], lanes: [], ticks: 0 };

  const dist = new Map<SystemId, number>([[from, 0]]);
  const prev = new Map<SystemId, SystemId>();
  const done = new Set<SystemId>();

  for (;;) {
    // Linear scan for the minimum. 30 systems; a heap here would buy nothing and
    // cost a deterministic tie-break we would have to write anyway.
    let best: SystemId | null = null;
    let bestDist = Number.MAX_SAFE_INTEGER;
    for (const id of map.systemOrder) {
      if (done.has(id)) continue;
      const d = dist.get(id);
      if (d === undefined) continue;
      if (d < bestDist || (d === bestDist && best !== null && cmpStr(id, best) < 0)) {
        best = id;
        bestDist = d;
      }
    }
    if (best === null) return null;
    if (best === to) break;
    done.add(best);
    const system = map.systems.get(best);
    if (system === undefined) continue;
    for (const next of system.lanes) {
      if (done.has(next)) continue;
      const lane = map.lanes.get(laneKey(best, next));
      if (lane === undefined) continue;
      const candidate = bestDist + lane.transitTicks;
      const existing = dist.get(next);
      if (existing === undefined || candidate < existing) {
        dist.set(next, candidate);
        prev.set(next, best);
      }
    }
  }

  const path: SystemId[] = [to];
  let cursor: SystemId = to;
  while (cursor !== from) {
    const p = prev.get(cursor);
    if (p === undefined) return null;
    path.push(p);
    cursor = p;
  }
  path.reverse();

  const laneKeys: LaneKey[] = [];
  let ticks = 0;
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    if (a === undefined || b === undefined) throw new MapError('unreachable: torn route');
    const lane = map.lanes.get(laneKey(a, b));
    if (lane === undefined) throw new MapError(`unreachable: route crossed a missing lane ${a}->${b}`);
    laneKeys.push(lane.key);
    ticks += lane.transitTicks;
  }
  return { path, lanes: laneKeys, ticks };
}

/** The cheapest route to any COMMONS system. Null only if the map is broken. */
export function nearestCommons(map: WorldMap, from: SystemId): Route | null {
  let best: Route | null = null;
  for (const id of commonsSystems(map)) {
    const r = route(map, from, id);
    if (r === null) continue;
    if (best === null) {
      best = r;
      continue;
    }
    const bestEnd = best.path[best.path.length - 1];
    const end = r.path[r.path.length - 1];
    if (r.ticks < best.ticks) best = r;
    else if (r.ticks === best.ticks && bestEnd !== undefined && end !== undefined && cmpStr(end, bestEnd) < 0) {
      best = r;
    }
  }
  return best;
}

// ── Hashing ─────────────────────────────────────────────────────────────────

/** The map as a canonical structure. Integers only; no floats reach a hash. */
export function mapCanonical(map: WorldMap): CanonicalValue {
  return {
    seed: map.seed,
    constellations: map.constellationOrder.map((cid) => {
      const con = map.constellations.get(cid);
      return {
        id: cid,
        name: con?.name ?? '',
        systems: con === undefined ? [] : [...con.systems],
      };
    }),
    systems: map.systemOrder.map((id) => {
      const s = map.systems.get(id);
      return {
        id,
        constellation: s?.constellation ?? '',
        name: s?.name ?? '',
        tier: s?.tier ?? '',
        lanes: s === undefined ? [] : [...s.lanes],
      };
    }),
    lanes: map.laneOrder.map((key) => {
      const lane = map.lanes.get(key);
      return {
        key,
        a: lane?.a ?? '',
        b: lane?.b ?? '',
        kind: lane?.kind ?? '',
        transitTicks: lane?.transitTicks ?? 0,
      };
    }),
  };
}

/**
 * The map's identity. Golden-filed: the launch map is "authored" precisely
 * because this hash cannot change without a test failing.
 */
export function mapHash(map: WorldMap): string {
  return canonicalHash(mapCanonical(map));
}
