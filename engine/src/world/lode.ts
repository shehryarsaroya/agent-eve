/**
 * LODES — the **resource-distinct** half of `PASS-TERRITORY-POLITICS` §16.12 #1, and the clause the
 * entry puts first: *"a fixed, **resource-distinct** graph with chokepoints and capacity-limited
 * projection."*
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE DEFECT, AS THE CODE HAD IT.** Yield was `YIELD_PER_TICK[tierOf(map, system)]` — indexed by
 * **tier**, never by system. So all eighteen MARCHES systems produced exactly 110 ore a tick and
 * **nothing else distinguished any of them**, and the same was true of `FUEL_YIELD_PER_TICK`.
 *
 * The consequence is the whole economy: **there was no reason to want *that* system rather than
 * *any* system.** No trade route has a reason to exist, no haul is worth its risk, and no price can
 * depend on place — which `TRACKER.md` had already measured from the other end, in the market's own
 * signature: *"`premiumBps` is structurally 0 in today's world … every seller quotes the same derived
 * constant, 12 at every venue, always."* A field whose interesting value cannot occur.
 *
 * §16.1 MUST-4 is the fix in its own words: *"Systems become qualitatively different rather than
 * coloured copies … Seed regions with complementary — not self-sufficient — resource baskets."*
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── ★ TIER-SUM PRESERVING, AND THAT IS WHAT MAKES IT SAFE ────────────────────
 *
 * A lode is **not a multiplier**. Each tier's total output is allocated across that tier's systems by
 * `largestRemainder` over integer weights, so
 *
 *     Σ over a tier's systems  ===  base × (systems in that tier)     exactly, always
 *
 * Three things fall out of that, and each is a constraint this change had to satisfy rather than a
 * happy accident:
 *
 *   1. **A15's proof survives untouched.** The map-bounded-output argument — *"N identities are worth
 *      no more than one"* — rests on a **per-system** cap, and `WORKS_PER_PRINCIPAL_PER_SYSTEM` is 1
 *      while `Book.sharesAt` divides one system's yield with `largestRemainder` and INV-W1 halts on
 *      any over-sum. Per-system yield changes *what* a system's cap is and never *that* it has one.
 *      Measured rather than argued: see `test/world/the-ground-is-not-uniform.spec.ts`, which re-runs
 *      the 1/4/16-puppet extraction and asserts the identical total.
 *   2. **Aggregate supply is unchanged**, so the Levy's payability from domestic production cannot
 *      fall in total — only in *place*, which is the entire point.
 *   3. **No float reaches a hashed structure** (DET-1/DET-7): weights and shares are integers and
 *      `largestRemainder` is the same integer instrument the Levy allocates dockets with.
 *
 * ── ★ THE COMMONS IS UNIFORM, AND FOR A8's REASON ────────────────────────────
 *
 * A COMMONS system yields exactly the tier figure, always. Not an oversight and not symmetry with
 * `strait.ts` for its own sake — the arithmetic forbids it. `YIELD_PER_TICK`'s own calibration note
 * says the Commons margin *"is deliberately the thinnest that is still positive"*: 80 a tick is
 * 23,040 a Reckoning against a ≈20,000 Levy. A lode of 0.8× would make that **17,568 against 20,000
 * — structurally short** — and A8 promises a floor that never expires. A safe zone where some systems
 * cannot fund their own tribute is not a floor; it is a trap with a nursery's name on it.
 *
 * §16.1 MUST-2 agrees from the design side: the Commons is *"Lowest, hard ceiling"*. A hard ceiling
 * is uniform by definition.
 *
 * ── WHY DERIVED AND NOT STORED ───────────────────────────────────────────────
 *
 * `strait.ts`'s reason, exactly: `mapCanonical` feeds `mapHash`, `tick/snapshot.ts` writes it into
 * every snapshot and **compares it on restore**, so a `lode` field on `StarSystem` would make a live
 * world refuse its own durable record over a topology that had not changed by one lane. Derived from
 * the map's own seed means it is **fixed with the map** — §16.1 MUST-1's *"stable named geography"* —
 * and readable by every agent, which is A2 working in our favour.
 *
 * ── AND IT IS THE SAME FEATURE AS THE CHOKEPOINTS ────────────────────────────
 *
 * A chokepoint that gates a lane to nowhere in particular is a label. A chokepoint that gates the
 * only cheap route to the one system that makes something scarce is a border worth fighting for. The
 * two halves are generated from one map and published on one frame row for exactly that reason, and
 * `the-ground-is-not-uniform.spec.ts` asserts the pairing rather than hoping for it: the map's
 * richest ground must not all sit inside one bloc's uncontested interior.
 */

import { Rng } from '../core/rng.js';
import type { SystemId, ZoneTier } from '../core/types.js';
import { qty, type Qty } from '../core/units.js';
import { largestRemainder } from '../levy/assessment.js';
import { type WorldMap } from './map.js';

export class LodeError extends Error {}

/**
 * The band a system's weight is drawn from. **Nine to twelve, and the floor is load-bearing.**
 *
 * The spread is `12/9` = **1.33×** between the richest and the poorest ground in a tier, which is
 * enough that a hauler, a claimant and a raider all rank systems differently — and small enough that
 * the poorest system still clears its own burn, which is the constraint that sets the floor rather
 * than taste:
 *
 * | tier | base | poorest | per Reckoning alone | its burn | margin |
 * |---|---|---|---|---|---|
 * | `MARCHES` | 110 | ≈94 | 27,072 | 24,000 Levy+Charge | **+3,072** |
 * | `FRONTIER` | 150 | ≈129 | 37,152 | 27,000 Levy+Charge | **+10,152** |
 *
 * A wider band was the first draft and it is recorded because the rejection is the useful part: at
 * `8..13` (1.63×) the poorest MARCHES system yields ≈84, which is 24,192 against a 24,000 burn — a
 * margin of **192 units a Reckoning**, indistinguishable from zero, and `g07`'s structural residue
 * arriving by design instead of by accident. The band is set by the tightest tier's break-even, not
 * by how interesting the map looks.
 */
export const LODE_WEIGHT = { min: 9, max: 12 } as const;

/** The tiers a lode varies. The COMMONS is absent on purpose — see the header (A8). */
export const LODE_TIERS: readonly ZoneTier[] = Object.freeze(['MARCHES', 'FRONTIER']);

/** Is this tier's ground distinct at all? False for the COMMONS, which is uniform by rule. */
export function tierHasLodes(tier: ZoneTier): boolean {
  return LODE_TIERS.includes(tier);
}

/** One system's ground, as an agent reads it. */
export interface Lode {
  readonly system: SystemId;
  readonly tier: ZoneTier;
  /**
   * The draw, in `LODE_WEIGHT`'s band. Published because it is what makes two systems comparable
   * *before* either has been worked — the ore is in the ground whether or not a WORKS stands there.
   */
  readonly weight: number;
  /**
   * Units of the WORKS good this system yields per tick, before it is divided among the WORKS
   * standing there. Σ over a tier is exactly `base × count`.
   */
  readonly yieldPerTick: Qty;
  /** The same for FUEL. Zero at every tier but the FRONTIER, at every weight. */
  readonly fuelPerTick: Qty;
  /**
   * `yieldPerTick` against the tier's flat figure, in basis points, signed.
   *
   * The comparable number, and the one a haul decision is actually made on: *"this ground is 14%
   * richer than the tier"* is a sentence an agent can rank on, where a raw 126 is not until it also
   * knows the base. `MarketLine.premiumBps`' argument, in the ground rather than in the book.
   */
  readonly richnessBps: number;
}

/**
 * Derived, memoised, and keyed by the map object — `strait.ts`'s pattern and its reason: a cache
 * over a pure function of a frozen input, holding no world state, so it can never reach
 * `state_hash`.
 */
const MEMO = new WeakMap<WorldMap, ReadonlyMap<SystemId, Lode>>();

/**
 * Every system's ground, keyed by system, in canonical system order.
 *
 * `bases` is injected rather than imported so this module does not depend on `works/` (which depends
 * on `world/`), and so the *one* place the tier figures live stays `works/params.ts`. A second copy
 * of `YIELD_PER_TICK` here would be scar #5 in the table the whole economy is priced off.
 */
export function lodesOf(
  map: WorldMap,
  bases: { readonly yield: Readonly<Record<ZoneTier, Qty>>; readonly fuel: Readonly<Record<ZoneTier, Qty>> },
): ReadonlyMap<SystemId, Lode> {
  const cached = MEMO.get(map);
  if (cached !== undefined) return cached;

  // A labelled sub-stream of the map's own seed, so the ground is **fixed with the map** and adding
  // a consumer to any other stage cannot shift these draws (`Rng.derive`'s whole reason).
  const rng = Rng.fromSeed(`map:${map.seed}`).derive('system-lodes');
  const weights = new Map<SystemId, number>();
  for (const id of map.systemOrder) {
    // Drawn for EVERY system including the Commons, so that excluding the Commons from the
    // *allocation* cannot shift the draws seen by the Marches — the same discipline `derive` exists
    // for, one level down.
    weights.set(id, rng.range(LODE_WEIGHT.min, LODE_WEIGHT.max));
  }

  const out = new Map<SystemId, Lode>();
  // The Commons first and flat, so the uniform case is written once rather than as a branch inside
  // the allocation.
  for (const id of map.systemOrder) {
    const tier = map.systems.get(id)?.tier;
    if (tier === undefined) throw new LodeError(`no system ${id}`);
    if (tierHasLodes(tier)) continue;
    out.set(id, {
      system: id,
      tier,
      weight: weights.get(id) ?? LODE_WEIGHT.min,
      yieldPerTick: bases.yield[tier],
      fuelPerTick: bases.fuel[tier],
      richnessBps: 0,
    });
  }

  for (const tier of LODE_TIERS) {
    const ids = map.systemOrder.filter((id) => map.systems.get(id)?.tier === tier);
    if (ids.length === 0) continue;
    const w = ids.map((id) => weights.get(id) ?? LODE_WEIGHT.min);
    const base = bases.yield[tier];
    const fuelBase = bases.fuel[tier];
    // `largestRemainder` over `base × count` is what makes the tier total exact. Its return type is
    // `Minor` because the Levy is its first caller; these are quantities of a good, and the brand is
    // a compile-time label over the same integer.
    const shares = largestRemainder((base * ids.length) as never, w) as readonly number[];
    const fuelShares =
      fuelBase === 0
        ? ids.map(() => 0)
        : (largestRemainder((fuelBase * ids.length) as never, w) as readonly number[]);
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i];
      const share = shares[i];
      if (id === undefined || share === undefined) throw new LodeError('lode allocation is torn');
      out.set(id, {
        system: id,
        tier,
        weight: w[i] ?? LODE_WEIGHT.min,
        yieldPerTick: qty(share),
        fuelPerTick: qty(fuelShares[i] ?? 0),
        // Integer bps against the tier figure. `base` is never 0 for a lode tier (asserted below).
        richnessBps: Math.trunc(((share - base) * 10_000) / base),
      });
    }
  }

  MEMO.set(map, out);
  return out;
}

/** One system's ground. Throws rather than defaulting: a silent tier figure would hide a torn map. */
export function lodeAt(
  map: WorldMap,
  system: SystemId,
  bases: Parameters<typeof lodesOf>[1],
): Lode {
  const lode = lodesOf(map, bases).get(system);
  if (lode === undefined) throw new LodeError(`no lode for ${system}`);
  return lode;
}

/**
 * Everything the rest of the engine may assume about a map's ground.
 *
 * The **conservation** clause is the one that matters and it is checked rather than trusted: if a
 * tier's shares ever summed to more than `base × count`, every A15 measurement in the repo would be
 * wrong and INV-W1 would start halting worlds for a reason no reader could find. The **non-vacuity**
 * clause is this project's signature defect aimed at its own new mechanic: a "distinct" map on which
 * every system yields the same figure is `premiumBps`-structurally-zero with more code behind it.
 */
export function assertLodes(map: WorldMap, bases: Parameters<typeof lodesOf>[1]): void {
  const problems: string[] = [];
  const lodes = lodesOf(map, bases);

  if (lodes.size !== map.systems.size) {
    problems.push(`${String(lodes.size)} lodes for ${String(map.systems.size)} systems`);
  }

  for (const tier of LODE_TIERS) {
    if (bases.yield[tier] <= 0) {
      problems.push(`tier ${tier} varies its ground and has a base yield of ${String(bases.yield[tier])}`);
    }
    const ids = map.systemOrder.filter((id) => map.systems.get(id)?.tier === tier);
    if (ids.length === 0) continue;
    let sum = 0;
    let fuelSum = 0;
    const seen = new Set<number>();
    for (const id of ids) {
      const lode = lodes.get(id);
      if (lode === undefined) {
        problems.push(`no lode for ${id}`);
        continue;
      }
      sum += lode.yieldPerTick;
      fuelSum += lode.fuelPerTick;
      seen.add(lode.yieldPerTick);
      if (lode.yieldPerTick <= 0) problems.push(`${id} yields nothing at all`);
    }
    // ── CONSERVATION ────────────────────────────────────────────────────────
    const want = bases.yield[tier] * ids.length;
    if (sum !== want) {
      problems.push(
        `tier ${tier} yields ${String(sum)} across ${String(ids.length)} systems, and the flat figure ` +
          `would be ${String(want)} — a lode redistributes a tier's output and may never change its ` +
          'total, or A15\'s map-bounded-output proof and the Levy\'s payability both move',
      );
    }
    const wantFuel = bases.fuel[tier] * ids.length;
    if (fuelSum !== wantFuel) {
      problems.push(`tier ${tier} fuel sums to ${String(fuelSum)} against a flat ${String(wantFuel)}`);
    }
    // ── NON-VACUITY ─────────────────────────────────────────────────────────
    if (ids.length > 1 && seen.size < 2) {
      problems.push(
        `every ${tier} system yields ${String([...seen][0] ?? 0)}, so the tier is uniform and §16.12 ` +
          "#1's resource-distinct clause has no instance — there is still no reason to want THAT " +
          'system rather than any system',
      );
    }
  }

  // The Commons, flat, checked in both directions so neither the exclusion nor the allocation can
  // quietly start covering it.
  for (const id of map.systemOrder) {
    const tier = map.systems.get(id)?.tier;
    const lode = lodes.get(id);
    if (tier === undefined || lode === undefined) continue;
    if (tierHasLodes(tier)) continue;
    if (lode.yieldPerTick !== bases.yield[tier] || lode.richnessBps !== 0) {
      problems.push(
        `${id} is ${tier} and yields ${String(lode.yieldPerTick)} against the flat ` +
          `${String(bases.yield[tier])}; the COMMONS is uniform because its margin over the Levy is ` +
          'the thinnest that is still positive, and a poorer one could not fund its own tribute (A8)',
      );
    }
  }

  if (problems.length > 0) {
    throw new LodeError(`lode structure invalid:\n  - ${problems.join('\n  - ')}`);
  }
}

/**
 * The rule, as one sentence, for the agent choosing where to stand.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THIS STRING IS A RULES SURFACE** (hard rule 4). A probe reported choosing between two graduation
 * destinations *"with literally no information about either"* — the same sentence as this feature, one
 * surface out. An agent that believes the tier is the whole story will graduate onto the poorest
 * ground on the map and never know why its margin is thin.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const LODE_STATEMENT =
  'Two systems in the same tier do NOT yield the same. Each has a LODE — a fixed richness, drawn ' +
  `with the map and never redrawn, between ${String(LODE_WEIGHT.min)} and ${String(LODE_WEIGHT.max)} ` +
  'in weight, so the richest ground in a tier out-yields the poorest by about a third. A tier\'s ' +
  'TOTAL output is unchanged: a lode moves where the ore is, never how much of it exists, so ' +
  'crowding one system still divides one system\'s yield and extra identities still buy nothing ' +
  '(A15). The COMMONS is the exception and is uniform everywhere, because its margin over the Levy ' +
  'is the thinnest that is still positive and a poorer civic system could not fund its own tribute. ' +
  'FUEL is distributed the same way and is still FRONTIER-only, so some frontier ground is worth ' +
  'far more than the rest of it. Every figure is readable before you commit: `holding.graduation` ' +
  'prices its destinations, `holding.works` prices where you stand, and the map on the published ' +
  'frame carries the yield and the richness of every system in the galaxy.';
