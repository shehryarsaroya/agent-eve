/**
 * GROWTH — the region opens a new constellation when its qualified population outgrows its stages.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **SPEC §4.2, in its own words:** *"The variable was never system count; it is principals per stage.
 * Growth opens new constellations, gated on bonded, capitalised, non-related population — never raw
 * headcount, which would let 60 bots mint a fresh resource supply. Phase 0 ships a fixed authored map;
 * the generator is reserved."* `map.ts` has said since commit #1 that the launch map *is*
 * `generateMap(LAUNCH_SEED)` so that *"the schema and the generator are exercised from commit #1 rather
 * than retrofitted at Phase 1 when growth opens new constellations."* This is that retrofit's other
 * half: the reserved generator, spent.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## The two halves, and which one may be generous
 *
 * **The geography is generous.** {@link openConstellation} appends one constellation of
 * {@link GROWTH_PLAN}'s shape — its own small COMMONS enclave and a ring of MARCHES around it — joined
 * to the map it grew from by **one** INTER lane. One lane is not a style choice: cutting it strands the
 * whole new constellation, so it is a STRAIT by `strait.ts`'s first clause on the day it opens, and the
 * gate system on the old side becomes the kind of ground §16.12 #1 says is worth more than the ore
 * under it. Every draw comes from `map:<seed>`'s own `growth:<n>` sub-stream, so the n-th constellation
 * is the same constellation on every replay, on every host, whatever tick it opened at.
 *
 * **The gate is stingy, and it has to be (A15).** {@link growthReading} counts a principal only when it
 * is all three of §4.2's words at once, each one read off a quantity the engine already hardened:
 *
 *   - **capitalised** — `freeCash ≥` {@link GROWTH_CAPITAL_MINOR}. D7's identity: `freeCash ≤ earned −
 *     transferredOut`, the endowment is withheld in full, and a fresh identity reads **zero by
 *     construction**. Capital a principal was PAID, never capital it was minted.
 *   - **non-related** — `standing.distinctCounterparties ≥ 1`: it has honoured an ELECTIVE promise to a
 *     counterparty that is not itself. Self-dealing earns zero (scar #9), and `StandingBook.apply` halts
 *     rather than write a self-credit.
 *   - **bonded** — slashable capital at stake this Reckoning: an EXPOSURE high-water mark above zero
 *     (A7's staked half — a stake locked into a role), or a posted BOND. §4.2's lower-case word, read
 *     as "has a bond in the game"; it is **not** §6.4's `BONDED` trust tier (a bond held against
 *     custody plus sureties), and the agent-facing sentence says *AT STAKE* rather than spend that
 *     tier's name on a second concept (hard rule 4).
 *
 * Headcount is not an input at all. Sixty fresh identities read **0 qualified**, and so do sixty idle
 * ones with a decade of tenure; the test that pins this is `test/world/growth-gate.spec.ts`.
 *
 * ## The threshold is principals PER STAGE
 *
 * A new constellation opens at a Reckoning when the qualified population reaches
 * {@link GROWTH_QUALIFIED_PER_SYSTEM} × the systems the region already has — §4.2's *"8–20 principals
 * present"* a stage, at its floor. Measured in the region's own stages so the bar rises as the map
 * grows: the launch map's 30 systems open the first new constellation at 240 qualified principals, and
 * each constellation it adds raises the bar by its own size. One per Reckoning at most, and only at the
 * settlement tick — a growth that can happen at any moment is a world that changes under a published
 * route, and A14 wants the moment on the clock where an audience can be told it is coming.
 *
 * ## What growth may never do
 *
 *   1. **Never redraw ground that already exists.** Place IDs are permanent (§4.2), and so is every
 *      published fact about them: a strait's numbers, a system's LODE, a lane's transit. The anchor is
 *      chosen on the larger side of every bridge in the map it grows from, which is exactly the
 *      condition under which hanging a new subtree off it moves no existing strait — and
 *      {@link assertGrowthStructure} re-derives every pre-existing strait and halts on any difference.
 *      LODES are allocated per constellation for grown ground (`lode.ts`), so the launch map's yields
 *      are byte-identical before and after.
 *   2. **Never pinch or strand a COMMONS.** The new enclave is interior to its own constellation — no
 *      INTER lane touches a COMMONS system, so leaving it always crosses the new MARCHES first (scar
 *      #14's rule, `map.ts`'s second structural property, unchanged).
 *   3. **Never put the FRONTIER next to a nursery.** A grown constellation adds COMMONS and MARCHES
 *      only; the FRONTIER is the season's prize and stays where the launch map put it.
 */

import { Rng } from '../core/rng.js';
import { GATE_TRANSIT } from '../core/time.js';
import type { ConstellationId, PrincipalId, StarSystem, SystemId, ZoneTier } from '../core/types.js';
import {
  assertMapStructure,
  cmpStr,
  CONSTELLATION_SIZE_BOUNDS,
  LAUNCH_SYSTEM_BOUNDS,
  laneKey,
  MapError,
  type Constellation,
  type GrownConstellation,
  type Lane,
  type LaneKey,
  type WorldMap,
} from './map.js';
import { straitsOf, type Strait } from './strait.js';

export class GrowthError extends Error {}

// ── The shape of a new constellation ─────────────────────────────────────────

/**
 * What a grown constellation is made of. *(calibrate)*
 *
 * **Two COMMONS systems**, because §9 promises *"a complete if low-margin loop exists entirely inside
 * the Commons"* and a single civic system cannot host a haul between two places. Two is also the
 * smallest enclave in which a newcomer has a neighbour it can trade with on minute one.
 *
 * **Four to six MARCHES**, so the constellation is 6–8 systems — inside §4.2's 5–8 — and its MARCHES
 * ring is large enough that the Levy, the WORKS and the first claims have more than one place to go.
 */
export const GROWTH_PLAN = {
  commons: 2,
  marches: { min: 4, max: 6 },
} as const;

/**
 * §4.2's stage floor: a system holds *"8–20 principals present"*. The region opens its next
 * constellation when the qualified population reaches this many per system it already has.
 * *(calibrate)* — at the floor rather than the middle, so a stage is relieved before it is crowded.
 */
export const GROWTH_QUALIFIED_PER_SYSTEM = 8;

/**
 * The capital half of the gate, in MINOR of `freeCash`. *(calibrate)*
 *
 * One Reckoning of `LEVY_DUTY_PER_PRINCIPAL` (20,000), declared here as a literal rather than imported
 * because `world/` may not depend on `levy/` (which depends on `world/`); `test/world/growth-gate.spec.ts`
 * asserts the two stay equal. A principal that has been paid one night's duty in currency it can
 * spend is a principal somebody else valued — and D7 makes that figure unmintable by enrolling.
 */
export const GROWTH_CAPITAL_MINOR = 20_000;

/**
 * How many constellations growth may ever open. A ceiling on the map rather than a target, sized so the
 * map can stage `MAX_PRINCIPALS` at the stage floor with room to spare, and asserted against it in
 * `test/core/capacity.spec.ts`. Place IDs are permanent, so this also bounds every table keyed on a
 * system (INV-26).
 */
export const MAX_GROWN_CONSTELLATIONS = 48;

/**
 * The most systems a map can ever hold: the launch plan's ceiling plus every constellation growth may
 * open at its largest. The **map ceiling** every per-system bound derives from — the frame's VERGE,
 * the claim book — so that growth can never walk a map past a cap that was sized for thirty systems.
 */
export const MAX_MAP_SYSTEMS = LAUNCH_SYSTEM_BOUNDS.max + MAX_GROWN_CONSTELLATIONS * CONSTELLATION_SIZE_BOUNDS.max;

// ── Names ────────────────────────────────────────────────────────────────────

/**
 * Civic names for the grown COMMONS. The same register as `map.ts`'s four: plain, warm, repeatable by a
 * stranger. None is a cast handle or an `agent.md` example, and the generator below refuses a
 * duplicate of any name already on the map.
 */
const GROWN_CIVIC_NAMES: readonly string[] = Object.freeze([
  'Lampwick', 'Mill Row', 'Hob', 'Ember Close', 'Kettle', 'Thimble', 'Rushlight', 'Bread Quay',
  'Wicker', 'Hearthside', 'Salt Lane', 'Lintel', 'Pennyhold', 'Ash Yard', 'Spindle', 'Cobble',
  'Tinder', 'Warp', 'Quill Lane', 'Loam', 'Ladle', 'Bellows', 'Hollin', 'Brine Steps',
]);

/** Outer names for the grown MARCHES. Same register as `map.ts`'s OUTER_NAMES. */
const GROWN_OUTER_NAMES: readonly string[] = Object.freeze([
  'Gannet', 'Shingle', 'Corran', 'Blackfen', 'Drover', 'Fallow', 'Gorse', 'Hythe', 'Ironmere',
  'Kestle', 'Lorn', 'Marl', 'Norrow', 'Oakum', 'Peat', 'Rime', 'Scour', 'Tarn', 'Umber', 'Varlet',
  'Weir', 'Yarrow', 'Brack', 'Culver', 'Dross', 'Ebb', 'Flint', 'Gibbet', 'Hask', 'Ingle', 'Jessop',
  'Knap', 'Lychgate', 'Morrow', 'Nab', 'Ossory', 'Pike', 'Quay', 'Rook', 'Selvage', 'Tallis',
  'Undercroft', 'Vetch', 'Wold', 'Yew', 'Ashlar', 'Burr', 'Chine', 'Dunlin', 'Ember', 'Fen', 'Garth',
  'Holm', 'Inch', 'Kell', 'Lade', 'Mere', 'Ness', 'Ord', 'Pell', 'Ridge', 'Sedge', 'Thorpe', 'Wick',
]);

/** Constellation names. Not published (frames carry ids), but held on `Constellation.name`. */
const GROWN_CONSTELLATION_NAMES: readonly string[] = Object.freeze([
  'Kindle', 'Harbour', 'Tideway', 'Longmere', 'Saltmarsh', 'Brightwater', 'Coldharbour', 'Wayside',
  'Highwold', 'Fairhaven', 'Stillwater', 'Greyholm',
]);

/** Syllables for the deterministic fallback once the authored lists run out. */
const SYLLABLES_A: readonly string[] = Object.freeze(['Ash', 'Brin', 'Cal', 'Dun', 'Ell', 'Fen', 'Gar', 'Hal', 'Ise', 'Kor', 'Lor', 'Mor', 'Nor', 'Os', 'Pen', 'Ros', 'Sel', 'Tor', 'Ul', 'Ves', 'Wen']);
const SYLLABLES_B: readonly string[] = Object.freeze(['ford', 'mere', 'holt', 'wick', 'stead', 'dale', 'mouth', 'reach', 'ley', 'by', 'wold', 'fell', 'side', 'gate', 'more', 'tor']);

function nameFrom(list: readonly string[], used: Set<string>, rng: Rng): string {
  for (const name of list) {
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  // Generated, deterministic, unique: the stream is this constellation's own, and a collision draws
  // again rather than suffixing, so the name a viewer sees is always pronounceable.
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const name = `${rng.pick(SYLLABLES_A)}${rng.pick(SYLLABLES_B)}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  throw new GrowthError('ran out of names for a grown system; extend the authored lists');
}

// ── Bridges: where an anchor may stand without moving an existing strait ─────

/**
 * Systems on the larger-or-equal side of **every** bridge of `map`.
 *
 * Hanging a subtree off a system X changes exactly one kind of existing fact: the `severed` count of a
 * bridge whose SMALLER side contains X (the subtree joins that side). No detour moves, because a
 * subtree hung by one lane adds no cycle a shortest way around could use. So a system on the
 * larger-or-equal side of every bridge is precisely a system at which growth redraws nothing — and on
 * a tie the minimum is unchanged whichever side grows, which is why equal sides are admitted.
 *
 * Such a system always exists: each "larger side" holds at least half the region and they are subtrees
 * of the bridge tree, so by Helly's property for subtrees they share a vertex.
 */
export function anchorSafeSystems(map: WorldMap): readonly SystemId[] {
  const ok = new Set<SystemId>(map.systemOrder);
  for (const key of map.laneOrder) {
    const lane = map.lanes.get(key);
    if (lane === undefined) continue;
    const side = componentWithout(map, lane.a, key);
    if (side.has(lane.b)) continue; // not a bridge
    const small = side.size * 2 < map.systems.size ? side : null;
    const otherSize = map.systems.size - side.size;
    const smallSide = small ?? (otherSize * 2 < map.systems.size ? complement(map, side) : null);
    if (smallSide === null) continue; // an exact tie: either side is safe
    for (const id of smallSide) ok.delete(id);
  }
  return map.systemOrder.filter((id) => ok.has(id));
}

function componentWithout(map: WorldMap, from: SystemId, without: LaneKey): Set<SystemId> {
  const seen = new Set<SystemId>([from]);
  const queue: SystemId[] = [from];
  for (let i = 0; i < queue.length; i += 1) {
    const cur = queue[i];
    if (cur === undefined) break;
    for (const next of map.systems.get(cur)?.lanes ?? []) {
      if (laneKey(cur, next) === without || seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

function complement(map: WorldMap, side: ReadonlySet<SystemId>): Set<SystemId> {
  return new Set(map.systemOrder.filter((id) => !side.has(id)));
}

// ── The generator ────────────────────────────────────────────────────────────

/** The next system id after the highest one on the map. Ids are permanent and only ever appended. */
function nextSystemNumber(map: WorldMap): number {
  let max = 0;
  for (const id of map.systemOrder) {
    const n = Number(/^sys-(\d+)$/.exec(id)?.[1] ?? '0');
    if (n > max) max = n;
  }
  return max + 1;
}

function nextConstellationNumber(map: WorldMap): number {
  let max = 0;
  for (const id of map.constellationOrder) {
    const n = Number(/^con-(\d+)$/.exec(id)?.[1] ?? '0');
    if (n > max) max = n;
  }
  return max + 1;
}

interface MutableSystem {
  readonly id: SystemId;
  readonly constellation: ConstellationId;
  readonly name: string;
  readonly tier: ZoneTier;
  readonly lanes: Set<SystemId>;
}

/**
 * Open one constellation on `map` and return the grown map. Pure: `map` is not touched, and the result
 * is a fresh frozen `WorldMap` (so every memo keyed on the map object — straits, lodes — recomputes).
 *
 * Deterministic in `map` alone: the n-th growth of a given seed draws from `map:<seed>`'s `growth:<n>`
 * sub-stream and from nothing else, so it is the same constellation whichever tick it opens at.
 */
export function openConstellation(map: WorldMap): WorldMap {
  const index = map.grown.length + 1;
  if (index > MAX_GROWN_CONSTELLATIONS) {
    throw new GrowthError(
      `the region already holds ${String(MAX_GROWN_CONSTELLATIONS)} grown constellations, which is the ceiling`,
    );
  }
  const root = Rng.fromSeed(`map:${map.seed}`).derive(`growth:${String(index)}`);
  const sizeRng = root.derive('size');
  const treeRng = root.derive('intra-topology');
  const extraRng = root.derive('intra-extra-lanes');
  const gateRng = root.derive('gate');
  const transitRng = root.derive('gate-transit');
  const nameRng = root.derive('names');

  const conNumber = nextConstellationNumber(map);
  const cid = `con-${String(conNumber)}` as ConstellationId;
  const marches = sizeRng.range(GROWTH_PLAN.marches.min, GROWTH_PLAN.marches.max);
  const size = GROWTH_PLAN.commons + marches;
  if (size < CONSTELLATION_SIZE_BOUNDS.min || size > CONSTELLATION_SIZE_BOUNDS.max) {
    throw new GrowthError(`a grown constellation of ${String(size)} systems is outside SPEC §4.2's 5–8`);
  }

  const usedNames = new Set<string>([...map.systems.values()].map((s) => s.name));
  const usedConNames = new Set<string>([...map.constellations.values()].map((c) => c.name));

  // ── systems ──────────────────────────────────────────────────────────────
  const fresh = new Map<SystemId, MutableSystem>();
  const ids: SystemId[] = [];
  let n = nextSystemNumber(map);
  for (let i = 0; i < size; i += 1) {
    const id = `sys-${String(n).padStart(2, '0')}` as SystemId;
    n += 1;
    const tier: ZoneTier = i < GROWTH_PLAN.commons ? 'COMMONS' : 'MARCHES';
    const name = nameFrom(tier === 'COMMONS' ? GROWN_CIVIC_NAMES : GROWN_OUTER_NAMES, usedNames, nameRng);
    fresh.set(id, { id, constellation: cid, name, tier, lanes: new Set<SystemId>() });
    ids.push(id);
  }

  const lanes = new Map<LaneKey, Lane>(map.lanes);
  const add = (x: SystemId, y: SystemId, kind: Lane['kind'], neighbours: Map<SystemId, Set<SystemId>>): void => {
    if (x === y) throw new GrowthError(`self-lane at ${x}`);
    const key = laneKey(x, y);
    if (lanes.has(key)) throw new GrowthError(`duplicate lane ${key}`);
    const bounds = kind === 'INTRA' ? GATE_TRANSIT.intraConstellation : GATE_TRANSIT.interConstellation;
    const [a, b] = cmpStr(x, y) <= 0 ? [x, y] : [y, x];
    lanes.set(key, { key, a, b, kind, transitTicks: transitRng.range(bounds.min, bounds.max) });
    const nx = neighbours.get(x);
    const ny = neighbours.get(y);
    if (nx === undefined || ny === undefined) throw new GrowthError(`lane ${key} names an unknown system`);
    nx.add(y);
    ny.add(x);
  };

  // Adjacency for every system — the old ones copied, so the input map is never mutated.
  const neighbours = new Map<SystemId, Set<SystemId>>();
  for (const [id, sys] of map.systems) neighbours.set(id, new Set(sys.lanes));
  for (const id of ids) neighbours.set(id, fresh.get(id)?.lanes ?? new Set());

  // ── intra lanes: a random recursive tree, so the COMMONS prefix is connected, plus a third again ──
  for (let i = 1; i < ids.length; i += 1) {
    const child = ids[i];
    const parent = ids[treeRng.int(i)];
    if (child === undefined || parent === undefined) throw new GrowthError('unreachable: torn tree');
    add(child, parent, 'INTRA', neighbours);
  }
  const extra = Math.floor(ids.length / 3);
  for (let k = 0; k < extra; k += 1) {
    const x = ids[extraRng.int(ids.length)];
    const y = ids[extraRng.int(ids.length)];
    if (x === undefined || y === undefined || x === y) continue;
    if (lanes.has(laneKey(x, y))) continue;
    add(x, y, 'INTRA', neighbours);
  }

  // ── the gate: ONE inter lane, from a MARCHES system on each side ─────────────
  const anchor = chooseAnchor(map, gateRng);
  const landingPool = ids.filter((id) => fresh.get(id)?.tier !== 'COMMONS');
  const landing = gateRng.pick(landingPool);
  add(anchor, landing, 'INTER', neighbours);

  // ── freeze ───────────────────────────────────────────────────────────────
  const systems = new Map<SystemId, StarSystem>();
  for (const id of map.systemOrder) {
    const s = map.systems.get(id);
    if (s === undefined) throw new GrowthError('unreachable: system missing from its own order');
    systems.set(id, { ...s, lanes: [...(neighbours.get(id) ?? [])].sort(cmpStr) });
  }
  for (const id of ids) {
    const s = fresh.get(id);
    if (s === undefined) throw new GrowthError('unreachable: fresh system missing');
    systems.set(id, { id, constellation: s.constellation, name: s.name, tier: s.tier, lanes: [...(neighbours.get(id) ?? [])].sort(cmpStr) });
  }
  const constellations = new Map<ConstellationId, Constellation>(map.constellations);
  constellations.set(cid, {
    id: cid,
    name: nameFrom(GROWN_CONSTELLATION_NAMES, usedConNames, nameRng),
    systems: ids,
  });
  const record: GrownConstellation = {
    index,
    constellation: cid,
    systems: ids,
    gate: laneKey(anchor, landing),
    anchor,
    landing,
  };
  const grown: WorldMap = {
    seed: map.seed,
    systemOrder: [...map.systemOrder, ...ids],
    constellationOrder: [...map.constellationOrder, cid],
    laneOrder: [...lanes.keys()].sort(cmpStr),
    systems,
    constellations,
    lanes,
    grown: [...map.grown, record],
  };
  assertGrowthStructure(map, grown);
  return grown;
}

/**
 * The existing system the new gate lands on.
 *
 * MARCHES first — a grown constellation hung off the FRONTIER would give its newcomers a two-lane walk
 * to the season's prize past nobody's ground — and only among {@link anchorSafeSystems}, so the
 * growth redraws no strait. Among those, the system with the **fewest INTER lanes**, so successive
 * constellations spread around the rim rather than all hanging off one gate; ties are a draw from the
 * growth's own stream over the canonical order.
 */
function chooseAnchor(map: WorldMap, rng: Rng): SystemId {
  const safe = anchorSafeSystems(map);
  const byTier = (tier: ZoneTier): SystemId[] => safe.filter((id) => map.systems.get(id)?.tier === tier);
  const pool = byTier('MARCHES').length > 0 ? byTier('MARCHES') : byTier('FRONTIER');
  if (pool.length === 0) {
    throw new GrowthError('no system outside the COMMONS can anchor a new constellation without redrawing a strait');
  }
  const interCount = (id: SystemId): number =>
    (map.systems.get(id)?.lanes ?? []).filter((o) => map.lanes.get(laneKey(id, o))?.kind === 'INTER').length;
  let fewest = Number.MAX_SAFE_INTEGER;
  for (const id of pool) fewest = Math.min(fewest, interCount(id));
  const best = pool.filter((id) => interCount(id) === fewest).sort(cmpStr);
  return rng.pick(best);
}

/**
 * Re-open `count` constellations on a base map, in order. How a restore and a replay rebuild the map:
 * the geography depends on the base map and the count alone, never on the ticks they opened at.
 */
export function regrowMap(base: WorldMap, count: number): WorldMap {
  if (!Number.isSafeInteger(count) || count < 0) throw new GrowthError(`cannot grow a map ${String(count)} times`);
  let map = base;
  for (let i = map.grown.length; i < count; i += 1) map = openConstellation(map);
  return map;
}

// ── Structure ────────────────────────────────────────────────────────────────

/**
 * Everything growth promises, checked on every grown map before it exists.
 *
 * `assertMapStructure` first (connectivity, the COMMONS rules, lane kinds, the strait clauses), then
 * the three things only a growth step can break: every pre-existing strait is unchanged, every
 * pre-existing lane and system is unchanged, and the new gate is itself a STRAIT that strands exactly
 * the new constellation.
 */
export function assertGrowthStructure(before: WorldMap, after: WorldMap): void {
  assertMapStructure(after);
  const problems: string[] = [];

  for (const id of before.systemOrder) {
    const was = before.systems.get(id);
    const now = after.systems.get(id);
    if (was === undefined || now === undefined) {
      problems.push(`${id} existed before the growth and does not after — place IDs are permanent (§4.2)`);
      continue;
    }
    if (was.name !== now.name || was.tier !== now.tier || was.constellation !== now.constellation) {
      problems.push(`${id} changed its name, tier or constellation when the region grew`);
    }
  }
  for (const key of before.laneOrder) {
    const was = before.lanes.get(key);
    const now = after.lanes.get(key);
    if (was === undefined || now === undefined || was.transitTicks !== now.transitTicks || was.kind !== now.kind) {
      problems.push(`lane ${key} changed when the region grew; a quoted route must stay true`);
    }
  }

  const oldStraits = straitsOf(before);
  const newStraits = straitsOf(after);
  for (const key of before.laneOrder) {
    const was = oldStraits.get(key);
    const now = newStraits.get(key);
    if (!sameStrait(was, now)) {
      problems.push(
        `lane ${key} was ${describe(was)} and is ${describe(now)} after the growth — a strait is fixed with ` +
          'the map and never redrawn, so an anchor that moves one is the wrong anchor',
      );
    }
  }

  const record = after.grown[after.grown.length - 1];
  if (record === undefined || after.grown.length !== before.grown.length + 1) {
    problems.push('a growth step must append exactly one grown constellation');
  } else {
    const gate = newStraits.get(record.gate);
    if (gate === undefined || !gate.severs || gate.severed !== record.systems.length) {
      problems.push(
        `the gate ${record.gate} must be a STRAIT that strands exactly the new constellation ` +
          `(${String(record.systems.length)} systems); it is ${describe(gate)}`,
      );
    }
    for (const id of record.systems) {
      const sys = after.systems.get(id);
      if (sys === undefined) continue;
      if (sys.tier === 'FRONTIER') problems.push(`${id} is FRONTIER; growth opens COMMONS and MARCHES only`);
    }
  }

  if (problems.length > 0) {
    throw new GrowthError(`growth structure invalid:\n  - ${problems.join('\n  - ')}`);
  }
}

function sameStrait(a: Strait | undefined, b: Strait | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.detourHops === b.detourHops && a.severs === b.severs && a.severed === b.severed;
}

function describe(s: Strait | undefined): string {
  if (s === undefined) return 'not a strait';
  return s.severs ? `a strait severing ${String(s.severed)}` : `a strait with a ${String(s.detourHops)}-hop detour`;
}

// ── The gate ─────────────────────────────────────────────────────────────────

/** What the gate reads about one principal. Narrow on purpose: it enumerates the gate's reach. */
export interface GrowthPort {
  /** Every enrolled principal, canonical order. Identity is never deleted, so this only grows. */
  readonly principals: () => readonly PrincipalId[];
  /** D7's transferable currency — what the principal was PAID, never its endowment. */
  readonly freeCash: (principal: PrincipalId) => number;
  /** `standing.distinctCounterparties`. */
  readonly distinctCounterparties: (principal: PrincipalId) => number;
  /** Slashable capital at stake this Reckoning: EXPOSURE's high-water mark, plus any posted bond. */
  readonly atStake: (principal: PrincipalId) => number;
}

export interface GrowthReading {
  /** Principals that are capitalised, non-related and bonded, all three. */
  readonly qualified: number;
  /** Systems the region has now — its stages. */
  readonly systems: number;
  /** Qualified principals the region needs before it opens another constellation. */
  readonly needed: number;
  /** Grown constellations so far. */
  readonly grown: number;
  /** True when the reading would open one at this Reckoning. */
  readonly opens: boolean;
}

/** Is this one principal counted? The three words of §4.2, each a hardened quantity. */
export function isQualified(port: GrowthPort, principal: PrincipalId): boolean {
  return (
    port.freeCash(principal) >= GROWTH_CAPITAL_MINOR &&
    port.distinctCounterparties(principal) >= 1 &&
    port.atStake(principal) > 0
  );
}

export function growthReading(
  map: WorldMap,
  port: GrowthPort,
  perSystem: number = GROWTH_QUALIFIED_PER_SYSTEM,
): GrowthReading {
  if (!Number.isSafeInteger(perSystem) || perSystem < 0) {
    throw new GrowthError(`the growth threshold must be a non-negative integer per system, got ${String(perSystem)}`);
  }
  let qualified = 0;
  for (const principal of port.principals()) if (isQualified(port, principal)) qualified += 1;
  const systems = map.systems.size;
  const needed = systems * perSystem;
  return {
    qualified,
    systems,
    needed,
    grown: map.grown.length,
    opens: qualified >= needed && map.grown.length < MAX_GROWN_CONSTELLATIONS,
  };
}

/**
 * The rule, as one sentence, for the agent deciding where to stand and for the viewer watching the rim.
 *
 * **THIS STRING IS A RULES SURFACE** (hard rule 4) and `test/world/growth-gate.spec.ts` pins every number
 * in it to the constant it came from.
 */
export const GROWTH_STATEMENT =
  'The region grows by whole constellations, never by headcount. At each Reckoning it counts the ' +
  'principals that are all three of: CAPITALISED (at least ' +
  `${String(GROWTH_CAPITAL_MINOR)} of transferable currency — money you were paid, never your starter ` +
  'stake), NON-RELATED (you have honoured an elective promise to another principal), and with capital AT ' +
  'STAKE this Reckoning (a staked role or a posted bond — capital you could lose). When that count reaches ' +
  `${String(GROWTH_QUALIFIED_PER_SYSTEM)} for every system the region already has, a new constellation ` +
  `opens at the Reckoning: ${String(GROWTH_PLAN.commons)} COMMONS systems of its own and ` +
  `${String(GROWTH_PLAN.marches.min)}–${String(GROWTH_PLAN.marches.max)} MARCHES, joined to the map by ` +
  'ONE lane, which is a STRAIT from the day it opens. At most one opens a Reckoning. Nothing that already ' +
  'exists is redrawn: every place, lane, strait and lode stays exactly as it was, and newcomers are ' +
  'seated in whichever COMMONS system has the fewest holdings, the newest first on a tie.';

/** For refusals and logs: why a reading did not open anything. */
export function describeReading(r: GrowthReading): string {
  return (
    `${String(r.qualified)} of ${String(r.needed)} qualified principals ` +
    `(${String(GROWTH_QUALIFIED_PER_SYSTEM)} for each of ${String(r.systems)} systems); ` +
    `${String(r.grown)} constellation(s) grown so far`
  );
}

/** Used by `MapError`-shaped callers that need the generator's own error type. */
export function isGrowthError(error: unknown): boolean {
  return error instanceof GrowthError || error instanceof MapError;
}
