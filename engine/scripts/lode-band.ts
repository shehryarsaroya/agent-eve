/**
 * ★ **THE PER-TIER FLOOR ARITHMETIC, AND THE BAND SWEEP THAT SETS `LODE_WEIGHT`.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHY THIS IS A SCRIPT AND NOT A PARAGRAPH.** `world/lode.ts` shipped two tables of this
 * arithmetic that **disagreed with each other** — the `LODE_WEIGHT` docblock said the poorest MARCHES
 * system yields ≈94 for a margin of +3,072, and {@link assertLodes}'s band sweep said +3,936 twenty
 * lines below it. One was an estimate written before the allocation existed and the other was a
 * reading; nothing in the file said which. That is the same defect as two features pinning one
 * number from parallel branches, inside a single file.
 *
 * So the numbers live here, they are produced by running the real allocator over the real launch
 * map, and the docblocks quote this script's output rather than an argument about it.
 *
 * **The floor being measured** is `assertLodes`' own: a system's SOLE occupant, holding a claim,
 * over one Reckoning.
 *
 *     income = lode.yieldPerTick × TICKS_PER_RECKONING
 *     owed   = LEVY_DUTY_PER_PRINCIPAL + CHARGE_BY_TIER[tier]
 *
 * Occupancy 1 is the binding case and the tightest one the design intends to be viable —
 * `YIELD_PER_TICK`'s calibration promises *"one WORKS alone at a system slightly beats its own
 * burn"*. Occupancy 2 is negative at every tier at every band **including flat**, and that is the
 * contention the design wants; a floor measured there would forbid the mechanic.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `npx tsx scripts/lode-band.ts` — prints the shipped map's per-system table, then sweeps candidate
 * bands over 300 seeds and reports the WORST poorest-system margin any seed produces.
 */

import { TICKS_PER_RECKONING } from '../src/core/time.js';
import type { SystemId, ZoneTier } from '../src/core/types.js';
import { LEVY_DUTY_PER_PRINCIPAL } from '../src/levy/params.js';
import { CHARGE_BY_TIER } from '../src/sovereignty/params.js';
import { FUEL_YIELD_PER_TICK, YIELD_PER_TICK } from '../src/works/params.js';
import { lodesOf, LODE_TIERS, type LodeBases } from '../src/world/lode.js';
import { generateMap, launchMap, tierOf } from '../src/world/map.js';

const BASES: LodeBases = { yield: YIELD_PER_TICK, fuel: FUEL_YIELD_PER_TICK };

/** What a sole occupant holding a claim owes for one Reckoning, by tier. */
function owedAt(tier: ZoneTier): number {
  return Number(LEVY_DUTY_PER_PRINCIPAL) + Number(CHARGE_BY_TIER[tier]);
}

/**
 * The allocator, re-implemented for the sweep ONLY because `LODE_WEIGHT` is a frozen module
 * constant and a band sweep has to vary it. Kept in lockstep with `lodesOf` by
 * `test/world/the-ground-is-not-uniform.spec.ts`, which asserts this function reproduces the shipped
 * module exactly at the shipped band — otherwise the sweep would be measuring a different rule from
 * the one that ships, which is the failure mode that makes a calibration script worse than nothing.
 */
async function sweepBand(seed: string, min: number, max: number) {
  const { Rng } = await import('../src/core/rng.js');
  const { largestRemainder } = await import('../src/levy/assessment.js');
  const map = generateMap(seed);
  const rng = Rng.fromSeed(`map:${map.seed}`).derive('system-lodes');
  const weights = new Map<SystemId, number>();
  for (const id of map.systemOrder) weights.set(id, rng.range(min, max));

  const out: { tier: ZoneTier; system: SystemId; yieldPerTick: number }[] = [];
  for (const tier of LODE_TIERS) {
    const ids = map.systemOrder.filter((id) => tierOf(map, id) === tier);
    if (ids.length === 0) continue;
    const w = ids.map((id) => weights.get(id) ?? min);
    const shares = largestRemainder((YIELD_PER_TICK[tier] * ids.length) as never, w) as readonly number[];
    ids.forEach((id, i) => out.push({ tier, system: id, yieldPerTick: shares[i] ?? 0 }));
  }
  return out;
}

async function main(): Promise<void> {
  const map = launchMap();
  const lodes = lodesOf(map, BASES);

  console.log('══ THE SHIPPED LAUNCH MAP, PER SYSTEM ══════════════════════════════════');
  console.log('tier      system   yield  fuel   bps      income/Rk    owed    margin');
  const byTier = new Map<ZoneTier, number[]>();
  for (const id of map.systemOrder) {
    const lode = lodes.get(id);
    if (lode === undefined) continue;
    const income = lode.yieldPerTick * TICKS_PER_RECKONING;
    const owed = owedAt(lode.tier);
    const list = byTier.get(lode.tier) ?? [];
    list.push(lode.yieldPerTick);
    byTier.set(lode.tier, list);
    console.log(
      `${lode.tier.padEnd(9)} ${id.padEnd(8)} ${String(lode.yieldPerTick).padStart(5)} ` +
        `${String(lode.fuelPerTick).padStart(4)} ${String(lode.richnessBps).padStart(7)} ` +
        `${String(income).padStart(10)} ${String(owed).padStart(7)} ${String(income - owed).padStart(9)}`,
    );
  }

  console.log('\n══ PER TIER, THE FLOOR ═════════════════════════════════════════════════');
  console.log('tier       n   base  poorest richest   Σ   Σ flat  poorest income  owed   MARGIN');
  for (const [tier, ys] of [...byTier.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const poorest = Math.min(...ys);
    const richest = Math.max(...ys);
    const sum = ys.reduce((a, b) => a + b, 0);
    const flat = YIELD_PER_TICK[tier] * ys.length;
    const income = poorest * TICKS_PER_RECKONING;
    const owed = owedAt(tier);
    console.log(
      `${tier.padEnd(10)} ${String(ys.length).padStart(2)} ${String(YIELD_PER_TICK[tier]).padStart(5)} ` +
        `${String(poorest).padStart(7)} ${String(richest).padStart(7)} ${String(sum).padStart(6)} ` +
        `${String(flat).padStart(6)} ${String(income).padStart(14)} ${String(owed).padStart(7)} ` +
        `${String(income - owed).padStart(8)}${sum === flat ? '' : '  ⚑ NOT CONSERVED'}`,
    );
  }

  console.log('\n══ BAND SWEEP — THE WORST POOREST-SYSTEM MARGIN OVER 300 SEEDS ═════════');
  console.log('(the shipped map is one draw; the floor has to hold on every map this can generate)');
  console.log('band      MARCHES worst   FRONTIER worst   verdict');
  const seeds = Array.from({ length: 300 }, (_, i) => `seed-${String(i)}`);
  for (const [min, max] of [
    [6, 12],
    [7, 12],
    [8, 12],
    [9, 12],
    [9, 11],
    [10, 12],
    [10, 13],
    [10, 14],
    [11, 14],
    [11, 12],
    [12, 15],
    [12, 16],
    [14, 18],
    [24, 30],
    [36, 42],
    [40, 46],
    [45, 53],
    [50, 58],
    [50, 55],
    [60, 66],
    [80, 88],
    [100, 110],
    [100, 105],
    [200, 210],
    [12, 12],
  ] as const) {
    const worst: Record<string, number> = { MARCHES: Number.POSITIVE_INFINITY, FRONTIER: Number.POSITIVE_INFINITY };
    for (const seed of seeds) {
      for (const row of await sweepBand(seed, min, max)) {
        const margin = row.yieldPerTick * TICKS_PER_RECKONING - owedAt(row.tier);
        if (margin < (worst[row.tier] ?? 0)) worst[row.tier] = margin;
      }
    }
    const ok = (worst['MARCHES'] ?? 0) > 0 && (worst['FRONTIER'] ?? 0) > 0;
    console.log(
      `${`${String(min)}..${String(max)}`.padEnd(9)} ${String(worst['MARCHES']).padStart(13)} ` +
        `${String(worst['FRONTIER']).padStart(16)}   ${ok ? 'clears' : '★ BELOW THE FLOOR'}`,
    );
  }

  // ── NON-VACUITY IS THE OTHER EDGE, AND NARROWING RUNS AT IT ────────────────
  //
  // `assertLodes` halts a world whose tier is uniform, because a "distinct" map on which every
  // system yields the same figure is `premiumBps`-structurally-zero with more code behind it. So the
  // band cannot be narrowed to a point: the floor pushes `min` UP and non-vacuity caps it. Both
  // edges are swept here so the shipped band is visibly between two measured walls rather than
  // between one wall and a preference.
  console.log('\n══ THE OTHER EDGE — DISTINCT YIELDS PER TIER, WORST OVER 300 SEEDS ═════');
  console.log('band      MARCHES distinct   FRONTIER distinct   spread   launch MARCHES   launch FRONTIER');
  for (const [min, max] of [
    [8, 12],
    [9, 12],
    [9, 11],
    [10, 12],
    [10, 13],
    [10, 14],
    [11, 14],
    [11, 12],
    [12, 15],
    [12, 16],
    [14, 18],
    [24, 30],
    [36, 42],
    [40, 46],
    [45, 53],
    [50, 58],
    [50, 55],
    [60, 66],
    [80, 88],
    [100, 110],
    [100, 105],
    [200, 210],
  ] as const) {
    let worstM = Number.POSITIVE_INFINITY;
    let worstF = Number.POSITIVE_INFINITY;
    for (const seed of seeds) {
      const rows = await sweepBand(seed, min, max);
      const m = new Set(rows.filter((r) => r.tier === 'MARCHES').map((r) => r.yieldPerTick));
      const f = new Set(rows.filter((r) => r.tier === 'FRONTIER').map((r) => r.yieldPerTick));
      if (m.size < worstM) worstM = m.size;
      if (f.size < worstF) worstF = f.size;
    }
    const launch = await sweepBand(map.seed, min, max);
    const lm = launch.filter((r) => r.tier === 'MARCHES').map((r) => r.yieldPerTick);
    const lf = launch.filter((r) => r.tier === 'FRONTIER').map((r) => r.yieldPerTick);
    console.log(
      `${`${String(min)}..${String(max)}`.padEnd(9)} ${String(worstM).padStart(16)} ` +
        `${String(worstF).padStart(19)}   ${(max / min).toFixed(2)}×   ` +
        `${`${String(Math.min(...lm))}–${String(Math.max(...lm))}`.padStart(14)}   ` +
        `${`${String(Math.min(...lf))}–${String(Math.max(...lf))}`.padStart(15)}`,
    );
  }
}

void main();
