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
 * The band a system's weight is drawn from. **Forty to forty-six, and it sits between THREE measured
 * walls rather than between one wall and a preference.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ⚑ **THE NUMBERS BELOW ARE `scripts/lode-band.ts`'s OUTPUT, AND THAT MATTERS MORE THAN THE BAND.**
 * This docblock and {@link assertLodes}'s used to carry **two tables of the same arithmetic that
 * disagreed with each other** — ≈94 / +3,072 here against +3,936 twenty lines down — one an estimate
 * written before the allocator existed, one a reading, with nothing saying which. Both are deleted.
 * There is one source now and it is a command.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── THE THREE WALLS ──────────────────────────────────────────────────────────
 *
 * **1. The FLOOR pushes the spread NARROW.** A system whose SOLE occupant cannot fund the tribute
 * assessed on it plus its own Charge is a place the map invites a principal to settle and then
 * bankrupts it for settling — the `g07` structural residue arriving **by design**, and that residue
 * is already §10's one open item at twelve Reckonings. The clause is {@link assertLodes}'s floor
 * block and the arithmetic is per tier.
 *
 * ⚑ And the floor is not the only thing pulling that way. **A tier's total is conserved; the total
 * of the systems the world actually STANDS on is conserved by nothing.** A cast occupies six of
 * twenty-two producing systems, so the occupied subset can sit below the tier base — measured at
 * **−864 a Reckoning** on `g01` at the 1.25× draft, which is small, compounds into the stock buffer,
 * and surfaced as a **10,474 `levyShort` at Reckoning 8** on a seed master keeps spotless. It went
 * away at 1.15×. `scripts/lode-residue.ts` is the instrument, and it prints the discriminator —
 * occupied Σ against base Σ — because a shortfall reads identically whether the cast settled poor or
 * the allocation misfired.
 *
 * **2. ORE NON-VACUITY caps how narrow it may go**, and the FRONTIER binds it: eight systems, so
 * with too few distinct weight values every draw can land on one number, every frontier system
 * yields the tier figure, and `assertLodes` **halts the world at construction** for a tier with no
 * instance of the clause it exists to serve. `10..12` and `11..12` both do this — measured, not
 * feared: one seed in 300 at three weight values, and not rare at two.
 *
 * **3. FUEL NON-VACUITY caps it again, harder, and it is the wall that actually decided this.**
 * `FUEL_YIELD_PER_TICK.FRONTIER` is **10** over **8** systems — a total of 80, so one unit is a
 * 10% step and the good cannot express a spread finer than that. At 1.10× every frontier system
 * yields exactly 10 and `agent.md`'s *"some of it is worth far more than the rest"* becomes false
 * while every ore assertion stays green. Nothing in `assertLodes` checks it, because the non-vacuity
 * clause reads `yieldPerTick` only — so this wall is invisible to the engine and is held by
 * {@link LODE_WEIGHT}'s calibration and by `the-ground-is-not-uniform.spec.ts`, which asserts the
 * fuel spread directly. **A coarse good is the narrowest thing on the map, and it sets the band.**
 *
 * ── THE SWEEP, WORST POOREST-SYSTEM MARGIN OVER 300 GENERATED SEEDS ─────────
 *
 * Worst over seeds, not the launch map's own draw. The guard runs at **construction on every world
 * the engine builds**, so a band the generator can come within a rounding step of violating is a
 * band that eventually halts a world — and the launch map being lucky is not a property of the rule.
 *
 * | band | ratio | MARCHES margin | FRONTIER margin | ore distinct | fuel spread |
 * |---|---|---|---|---|---|
 * | `8..12` | 1.50× | **−960** | +4,104 | — | *(below the floor)* |
 * | `9..12` *(the first draft)* | 1.33× | **+1,344** | +7,560 | **2** | 8–11 |
 * | `10..12` | 1.20× | +3,360 | +9,864 | **1 — HALTS** | — |
 * | `11..12` | 1.09× | +5,088 | +13,032 | **1 — HALTS** | — |
 * | `24..30` | 1.25× | +3,072 | +9,864 | 3 | 9–11 |
 * | `36..42` | 1.17× | +4,512 | +11,880 | 3 | 9–11 |
 * | **`40..46` (shipped)** | **1.15×** | **+4,800** | **+12,168** | **3** | **9–11** |
 * | `45..53` | 1.18× | +4,224 | +11,304 | 3 | 9–11 |
 * | `50..58` | 1.16× | +4,800 | +11,880 | 3 | **10 only — flat** |
 * | `100..110` | 1.10× | +5,664 | +13,320 | 3 | **10 only — flat** |
 *
 * **Separating RATIO from MAGNITUDE is what made the band findable, and the first draft conflated
 * them.** The poorest share is ≈ `base × 2m/(m+M)`, so the floor depends only on the **ratio** —
 * while the number of distinct weight values is `M − m + 1`, which depends only on the
 * **magnitude**. `9..12` had to be wide because it was small. Lift the magnitude and the ratio is
 * free to narrow, which is why the shipped band clears the floor by 3.6× what the draft did while
 * being *narrower*, not wider.
 *
 * `40..46` is then the best worst-case floor among the bands whose FUEL still varies: 1.10× and
 * 1.16× both post a better ore margin and both flatten fuel to a single figure. The last row of that
 * table is the whole design: **the coarsest good on the map is what stops the band narrowing
 * further**, and it stops it before the ore floor wants to.
 *
 * ⚑ **`9..12` FAILED ITS OWN STATED TEST**, and that is why it was not kept. Its note argued *"the
 * cliff is between `7..12` and `8..12` and the shipped band clears it by two weight steps"* and
 * rejected `8..12` because *"+1,344 is the same order as a Reckoning's rounding, and a floor that
 * close to zero is a floor nobody can plan against."* On the sweep the cliff is between `8..12` and
 * `9..12`, `9..12` clears it by **zero** steps, and **+1,344 is `9..12`'s own worst case** — the
 * number its author rejected, one row off. The table it came from was shifted by exactly one band:
 * every figure in it was real and every label on those figures was one row too wide. That is the
 * most expensive kind of wrong number, because every individual entry checks out.
 */
export const LODE_WEIGHT = { min: 40, max: 46 } as const;

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
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ⚑ **THE `bases` ARE PART OF THE KEY, AND THEY WERE NOT.** `strait.ts` memoises a function of one
 * argument; this one takes two, and the first version cached on the map alone. So a second call with
 * *different* bases returned the first call's answer, silently — a pure function that is not
 * actually a function of its inputs.
 *
 * In production it could not bite: `works/params.ts` passes one frozen `LODE_BASES` and there is no
 * other caller. That is precisely the argument that keeps this class of bug alive, and it was found
 * by a test doing the one thing production does not — asserting that a starved base table is refused
 * **and that the shipped one still passes on the same map**. The control half read the mutant's
 * cached allocation and the guard looked broken. A cache that answers a question it was not asked is
 * worse than no cache, because the reading it produces is confident.
 * ══════════════════════════════════════════════════════════════════════════
 */
const MEMO = new WeakMap<WorldMap, { readonly bases: LodeBases; readonly lodes: ReadonlyMap<SystemId, Lode> }>();

/**
 * Every system's ground, keyed by system, in canonical system order.
 *
 * `bases` is injected rather than imported so this module does not depend on `works/` (which depends
 * on `world/`), and so the *one* place the tier figures live stays `works/params.ts`. A second copy
 * of `YIELD_PER_TICK` here would be scar #5 in the table the whole economy is priced off.
 */
export interface LodeBases {
  readonly yield: Readonly<Record<ZoneTier, Qty>>;
  readonly fuel: Readonly<Record<ZoneTier, Qty>>;
}

/**
 * ★ What a principal seated on this ground **owes** per Reckoning — {@link assertLodes}'s floor.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **A SEPARATE ARGUMENT FROM {@link LodeBases}, AND THE SEPARATION IS A SCAR.** The first version put
 * these three fields on `LodeBases`, which meant `works/params.ts` — where the tier bases live — had
 * to import `CHARGE_BY_TIER` from `sovereignty/params.ts`. **`tsc` accepted it and the engine would
 * not start**: `sovereignty/params.ts` initialises constants that reference each other at module
 * scope, and the added edge closed a cycle into the middle of that, producing
 * `ReferenceError: Cannot access 'ALLOY_ANCHOR_QTY' before initialization` on the first import.
 * A type-only gate cannot see it; only running it can.
 *
 * So the floor figures are supplied at the **call site** — `sim/runtime.ts`, which already holds
 * `works`, `levy` and `sovereignty` together without a cycle — and the allocation keeps needing
 * nothing but yield and fuel.
 * ══════════════════════════════════════════════════════════════════════════
 */
export interface LodeFloor {
  readonly dutyPerReckoning: number;
  readonly chargeByTier: Readonly<Record<ZoneTier, Qty>>;
  readonly ticksPerReckoning: number;
}

export function lodesOf(map: WorldMap, bases: LodeBases): ReadonlyMap<SystemId, Lode> {
  const cached = MEMO.get(map);
  // Reference equality on `bases`, not a deep compare: the one production caller passes a module
  // constant, so the hit path stays O(1) and a caller that builds a fresh table simply recomputes.
  if (cached !== undefined && cached.bases === bases) return cached.lodes;

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

  MEMO.set(map, { bases, lodes: out });
  return out;
}

/** One system's ground. Throws rather than defaulting: a silent tier figure would hide a torn map. */
export function lodeAt(map: WorldMap, system: SystemId, bases: LodeBases): Lode {
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
export function assertLodes(map: WorldMap, bases: LodeBases, floor: LodeFloor): void {
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
    // ── ★ THE FLOOR: NO LODE MAY MAKE A SYSTEM A TRAP TO SETTLE ON ──────────
    //
    // ══════════════════════════════════════════════════════════════════════════
    // **THIS CLAUSE EXISTS BECAUSE THE COMMONS ARGUMENT HAS TO APPLY TO THE OTHER TIERS TOO.**
    // The Commons is uniform because 80/tick is 23,040 a Reckoning against a ≈20,000 Levy, so a 0.8×
    // lode would be 17,568 — structurally short, and A8 promises a floor. That reasoning does not
    // stop at the Commons: a MARCHES or FRONTIER system whose **sole** occupant cannot fund the
    // tribute assessed on it plus its own Charge is a place the map invites you to settle and then
    // bankrupts you for settling, which is the `g07` structural residue arriving **by design**
    // instead of by accident — and that residue is already §10's one open item at twelve Reckonings.
    //
    // Measured at **occupancy 1 and a claim held**, because that is the binding case and the tightest
    // one the design intends to be viable: `YIELD_PER_TICK`'s own calibration promises *"one WORKS
    // alone at a system slightly beats its own burn"*. Occupancy 2 is negative on every tier at
    // every band **including flat** — that is the contention the design wants and this clause must
    // not accidentally forbid it, which is why the divisor is 1 and not the occupant count.
    //
    // ⚑ **THE BAND SWEEP DOES NOT LIVE HERE ANY MORE.** A second copy of it did, and it disagreed
    // with {@link LODE_WEIGHT}'s by ~900 units on MARCHES and ~1,400 on FRONTIER. One source now:
    // `scripts/lode-band.ts` runs the real allocator, and `LODE_WEIGHT` quotes its output.
    //
    // What this clause reads on the SHIPPED launch map, for orientation only — the sweep's
    // worst-over-300-seeds figures are the ones the band was set against, because this guard runs at
    // construction on every world the engine builds and not only on the one that ships:
    //
    // | tier | n | base | poorest | income/Rk | owed | margin |
    // |---|---|---|---|---|---|---|
    // | `COMMONS` | 4 | 80 | 80 *(uniform)* | 23,040 | 20,000 | +3,040 |
    // | `MARCHES` | 18 | 110 | **100** (richest 115) | 28,800 | 24,000 | **+4,800** |
    // | `FRONTIER` | 8 | 150 | **141** (richest 158) | 40,608 | 27,000 | **+13,608** |
    //
    // The COMMONS row is the one that never moves and it is the argument's origin: +3,040 is the
    // thinnest margin in the game and it is why that tier is uniform (A8). Every other tier's floor
    // is held here instead of by symmetry.
    // ══════════════════════════════════════════════════════════════════════════
    for (const id of ids) {
      const lode = lodes.get(id);
      if (lode === undefined) continue;
      const income = lode.yieldPerTick * floor.ticksPerReckoning;
      const owed = floor.dutyPerReckoning + Number(floor.chargeByTier[tier]);
      if (income <= owed) {
        problems.push(
          `${id} (${tier}) yields ${String(lode.yieldPerTick)} a tick, so its SOLE occupant earns ` +
            `${String(income)} a Reckoning against ${String(owed)} owed (Levy ` +
            `${String(floor.dutyPerReckoning)} + Charge ${String(floor.chargeByTier[tier])}) — the lode has ` +
            'made this system a place the map invites a principal to settle and then bankrupts it for ' +
            `settling. Narrow LODE_WEIGHT (currently ${String(LODE_WEIGHT.min)}..${String(LODE_WEIGHT.max)}); ` +
            'the same arithmetic is why the COMMONS is uniform',
        );
      }
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
 *
 * ⚑ **AND THEN A SECOND PLAYER READ THIS SENTENCE AND STILL PICKED THE WORST GROUND ON THE MAP** —
 * because it named the lode as the reason two systems differ and the lode is the *smaller* reason.
 * A tier's richest out-yields its poorest by about 15%; **occupancy divides it by up to 5.** So the
 * last clause now names the crowding term and the field that carries it, and it says which of the two
 * to sort on. A rules surface that ranks two terms in the wrong order is worse than one that omits
 * both: it reads as complete.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const LODE_STATEMENT =
  'Two systems in the same tier do NOT yield the same. Each has a LODE — a fixed richness, drawn ' +
  `with the map and never redrawn, between ${String(LODE_WEIGHT.min)} and ${String(LODE_WEIGHT.max)} ` +
  'in weight, so the richest ground in a tier out-yields the poorest by about 15%. A tier\'s ' +
  'TOTAL output is unchanged: a lode moves where the ore is, never how much of it exists, so ' +
  'crowding one system still divides one system\'s yield and extra identities still buy nothing ' +
  '(A15). The COMMONS is the exception and is uniform everywhere, because its margin over the Levy ' +
  'is the thinnest that is still positive and a poorer civic system could not fund its own tribute. ' +
  'FUEL is distributed the same way and is still FRONTIER-only, so some frontier ground is worth ' +
  'far more than the rest of it. ' +
  'THE LODE IS THE SMALLER TERM: it spreads a tier by about 15%, and how many WORKS already stand ' +
  'on a system divides that system\'s yield among them, which spreads the same tier by more than ' +
  '400%. An empty poor system pays better than a crowded rich one, every time. So read ' +
  '`share_per_tick` — the yield divided by the occupants you would be joining, less any rent — and ' +
  'never rank ground on `yield_per_tick` or `richness_bps` alone. ' +
  'Every figure is readable before you commit: `holding.graduation.ground[]` prices its destinations ' +
  'with the occupancy and the share you would get at each, `holding.works.here` prices where you ' +
  'stand and names who else is on it, and the map on the published frame carries the yield and the ' +
  'richness of every system in the galaxy.';
