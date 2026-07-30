/**
 * §16.12 #1's **resource-distinct** clause — `world/lode.ts` — as executable claims.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ⚑ **THIS FILE WAS CITED THREE TIMES BEFORE IT EXISTED.** `world/lode.ts` said *"Measured rather
 * than argued: see `test/world/the-ground-is-not-uniform.spec.ts`, which re-runs the 1/4/16-puppet
 * extraction"*, said it again about the strait/lode pairing, and `works/params.ts` said this file
 * *"sweeps `src/` for that shape"*. **None of it was true** — the lode shipped with no test of its
 * own at all, and three source docblocks asserted coverage that did not exist. A citation to a
 * missing file is the strongest possible form of this project's signature defect: it reads as
 * *measured* to every reader including the author.
 *
 * So each of those three sentences is a test below, and they are the first three.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The pattern is `the-map-has-borders.spec.ts`': take a real map, ask the ENGINE what it thinks,
 * assert a relation between two of its own answers, and assert **non-vacuity first** — a lode file
 * that is green over a uniform map is `premiumBps`-structurally-zero with a passing suite on top.
 *
 * MUTATIONS each block is built to kill are named inline.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng.js';
import { setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { PrincipalId, SystemId, ZoneTier } from '../../src/core/types.js';
import { largestRemainder } from '../../src/levy/assessment.js';
import { LEVY_DUTY_PER_PRINCIPAL } from '../../src/levy/params.js';
import { Runtime } from '../../src/sim/runtime.js';
import { CHARGE_BY_TIER } from '../../src/sovereignty/params.js';
import {
  FUEL_YIELD_PER_TICK,
  systemFuelYield,
  systemYield,
  WORKS_PER_PRINCIPAL_PER_SYSTEM,
  WORKS_SPINUP_TICKS,
  YIELD_PER_TICK,
} from '../../src/works/params.js';
import {
  assertLodes,
  lodeAt,
  lodesOf,
  LodeError,
  LODE_STATEMENT,
  LODE_TIERS,
  LODE_WEIGHT,
  tierHasLodes,
  type LodeBases,
  type LodeFloor,
} from '../../src/world/lode.js';
import { generateMap, launchMap, tierOf, type WorldMap } from '../../src/world/map.js';
import { straitsAt } from '../../src/world/strait.js';

const BASES: LodeBases = { yield: YIELD_PER_TICK, fuel: FUEL_YIELD_PER_TICK };

/** The floor the engine itself passes at boot — `sim/runtime.ts`'s call, reproduced. */
const FLOOR: LodeFloor = {
  dutyPerReckoning: Number(LEVY_DUTY_PER_PRINCIPAL),
  chargeByTier: CHARGE_BY_TIER,
  ticksPerReckoning: TICKS_PER_RECKONING,
};

/** Seeds used wherever a claim must hold for maps other than the one that ships. */
const SEEDS = Array.from({ length: 60 }, (_, i) => `lode-seed-${String(i)}`);

function systemsOf(map: WorldMap, tier: ZoneTier): readonly SystemId[] {
  return map.systemOrder.filter((id) => tierOf(map, id) === tier);
}

describe('the three claims three source docblocks made before this file existed', () => {
  /**
   * ★ **CLAIM 1 — A15's map-bounded-output proof, re-run with per-system yield in place.**
   *
   * ══════════════════════════════════════════════════════════════════════════
   * `TRACKER.md`: *"1 puppet at a Commons system extracts 14,080 ore in 200 ticks; 16 puppets at the
   * same system extract 14,080, identical to the unit."* That measurement was taken when yield was a
   * TIER constant. The lode makes yield a function of the SYSTEM, which is a change to the numerator
   * of exactly that division — so the proof has to be taken again rather than inherited, and it has
   * to be taken **on a tier the lode actually varies**, which the Commons is not.
   *
   * The bound survives because it never depended on the figure: `WORKS_PER_PRINCIPAL_PER_SYSTEM` is
   * 1, `Book.sharesAt` divides ONE system's yield with `largestRemainder`, and INV-W1 halts on any
   * over-sum. A lode changes *what* a system's cap is, never *that* it has one.
   *
   * MUTATION: give each WORKS the full `systemYield` instead of a share, or divide by anything other
   * than the online count at that system. RED here, and in the live world ore supply would scale
   * with identity count — the one thing A15 forbids outright.
   * ══════════════════════════════════════════════════════════════════════════
   */
  function extractedAt(map: WorldMap, system: SystemId, puppets: number, ticks: number): number {
    setSpeed('instant');
    const rt = new Runtime({ seed: 'lode-a15' });
    for (let i = 0; i < puppets; i += 1) {
      rt.works.raise({ system, holder: `p:puppet-${String(i)}` as PrincipalId, tick: 0 });
    }
    let total = 0;
    for (let t = 0; t < ticks; t += 1) {
      for (const share of rt.works.sharesAt(system, systemYield(map, system), t).values()) total += share;
    }
    return total;
  }

  it('★ A15 RE-MEASURED: 1, 4 and 16 puppets extract the SAME total, on the RICHEST and the POOREST ground', () => {
    const rt = new Runtime({ seed: 'lode-a15' });
    const map = rt.world.map;
    const marches = systemsOf(map, 'MARCHES');
    const ranked = [...marches].sort((a, b) => systemYield(map, a) - systemYield(map, b));
    const poorest = ranked[0];
    const richest = ranked[ranked.length - 1];
    if (poorest === undefined || richest === undefined) throw new Error('need MARCHES systems');

    // NON-VACUITY FIRST. If the two ends are the same figure the rest of this test is a tautology
    // over a uniform map, which is the exact reading the lode exists to make impossible.
    expect(
      systemYield(map, richest),
      'the poorest and richest MARCHES ground must differ, or this proves nothing',
    ).toBeGreaterThan(systemYield(map, poorest));

    for (const system of [poorest, richest]) {
      const one = extractedAt(map, system, 1, 200);
      const four = extractedAt(map, system, 4, 200);
      const sixteen = extractedAt(map, system, 16, 200);
      expect(one, `${system} must hand over something`).toBeGreaterThan(0);
      expect(four, `${system}: four identities extract what one does`).toBe(one);
      expect(sixteen, `${system}: sixteen identities extract what one does`).toBe(one);
      // And the closed form, so a coincidence of two equal wrong numbers cannot pass: the place
      // yields its own figure every tick it is online, and `WORKS_SPINUP_TICKS` is when that starts.
      expect(one, `${system}: the total is the PLACE's yield over the online window`).toBe(
        systemYield(map, system) * (200 - WORKS_SPINUP_TICKS),
      );
    }

    // ★ THE A15 SENTENCE ITSELF: the bound is the map's, and a puppet farm's only achievement is
    // diluting its own shares. Stated across two DIFFERENT places so it cannot be read as a fact
    // about one system's number.
    expect(WORKS_PER_PRINCIPAL_PER_SYSTEM).toBe(1);
    expect(extractedAt(map, richest, 16, 200)).toBeGreaterThan(extractedAt(map, poorest, 16, 200));
  });

  /**
   * ★ **CLAIM 2 — the keystone and the prize.** `world/lode.ts`: *"the map's richest ground must not
   * all sit inside one bloc's uncontested interior."*
   *
   * Asserted as the weaker, checkable half of that sentence: the richest ground and the STRAIT
   * endpoints are drawn from one seeded map and are **not** disjoint, so at least one system is both
   * a gate and above its tier's base. That is what makes a chokepoint worth taking rather than a
   * label on a lane to nowhere.
   *
   * ⚑ Kept as a property over many seeds rather than a fact about `sys-25`, because the previous
   * version of this claim in `TRACKER.md` named a system — and a named system is a fact about one
   * draw that reads as a fact about the design.
   */
  it('★ the rich ground and the chokepoints are not disjoint, over 60 generated maps', () => {
    let bothOnSomeSeed = 0;
    let seedsWithGates = 0;
    for (const seed of SEEDS) {
      const map = generateMap(seed);
      const gated = map.systemOrder.filter((id) => straitsAt(map, id).length > 0);
      if (gated.length === 0) continue;
      seedsWithGates += 1;
      const richGate = gated.some((id) => {
        const lode = lodeAt(map, id, BASES);
        return tierHasLodes(lode.tier) && lode.richnessBps > 0;
      });
      if (richGate) bothOnSomeSeed += 1;
    }
    // Non-vacuity: there were gates to look at.
    expect(seedsWithGates, 'maps with at least one STRAIT').toBeGreaterThan(0);
    // The claim, as a rate rather than as a guarantee — some maps really will put every gate on poor
    // ground, and that is a map with a different story rather than a broken one.
    expect(
      bothOnSomeSeed / seedsWithGates,
      'on most maps at least one STRAIT endpoint is richer than its tier base',
    ).toBeGreaterThan(0.5);
  });

  /**
   * ★ **CLAIM 3 — `works/params.ts`: this file "sweeps `src/` for that shape".**
   *
   * The shape is reading `YIELD_PER_TICK[...]` or `FUEL_YIELD_PER_TICK[...]` **as a system's
   * output**. That is the defect §16.12 #1 exists to fix, and it is one careless line away at all
   * times: the table is still exported, because it is the base the allocation conserves.
   *
   * The sweep allows the table only in files that are entitled to it — the module that declares it,
   * the allocator's own call site, and the cast's TIER gate, which is about which tier to cross to
   * and deliberately not about which system.
   *
   * MUTATION: point any consumer back at the tier table and this goes red with the file named.
   */
  it('★ no module reads the TIER table as a SYSTEM\'s output', () => {
    const src = fileURLToPath(new URL('../../src', import.meta.url));
    const allowed = new Set([
      'works/params.ts', // declares it; `systemYield` is the accessor
      'world/lode.ts', // the allocator — the base is its input
      'cast/heuristic.ts', // the TIER gate in `graduateFor`, which is a tier decision by design
    ]);
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      // Explicit comparator (DET-1): directory order is filesystem-defined, and a sweep whose
      // report order changes between machines is a sweep whose diff nobody can read.
      for (const entry of [...readdirSync(dir)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.endsWith('.ts')) continue;
        const rel = full.slice(src.length + 1);
        if (allowed.has(rel)) continue;
        const body = readFileSync(full, 'utf8')
          // Comments quote the table constantly and correctly; only code counts.
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        if (/\b(?:FUEL_)?YIELD_PER_TICK\s*\[/.test(body)) offenders.push(rel);
      }
    };
    walk(src);
    expect(
      offenders,
      'these read a TIER figure where a SYSTEM\'s yield is meant — use systemYield/systemFuelYield',
    ).toEqual([]);
    // Non-vacuity: the sweep can see the constant at all.
    expect(readFileSync(join(src, 'works/params.ts'), 'utf8')).toContain('YIELD_PER_TICK');
  });
});

describe('a tier redistributes its output and never changes its total', () => {
  it('★ CONSERVATION holds exactly, on the launch map and on 60 generated ones', () => {
    for (const map of [launchMap(), ...SEEDS.map((s) => generateMap(s))]) {
      for (const tier of LODE_TIERS) {
        const ids = systemsOf(map, tier);
        if (ids.length === 0) continue;
        const sum = ids.reduce((a, id) => a + lodeAt(map, id, BASES).yieldPerTick, 0);
        const fuel = ids.reduce((a, id) => a + lodeAt(map, id, BASES).fuelPerTick, 0);
        expect(sum, `${map.seed} ${tier}: Σ yield must be base × count`).toBe(
          YIELD_PER_TICK[tier] * ids.length,
        );
        expect(fuel, `${map.seed} ${tier}: Σ fuel must be base × count`).toBe(
          FUEL_YIELD_PER_TICK[tier] * ids.length,
        );
      }
    }
  });

  it('★ NON-VACUITY: every lode tier really carries more than one figure, on every map', () => {
    // The signature defect aimed at its own mechanic. A conserved-but-uniform allocation passes
    // conservation perfectly and delivers nothing at all.
    for (const map of [launchMap(), ...SEEDS.map((s) => generateMap(s))]) {
      for (const tier of LODE_TIERS) {
        const ids = systemsOf(map, tier);
        if (ids.length < 2) continue;
        const distinct = new Set(ids.map((id) => lodeAt(map, id, BASES).yieldPerTick));
        expect(distinct.size, `${map.seed} ${tier} is uniform — §16.12 #1 has no instance`).toBeGreaterThan(1);
      }
    }
  });

  it('the COMMONS is uniform at the tier figure, and its richness is exactly zero (A8)', () => {
    for (const map of [launchMap(), ...SEEDS.slice(0, 20).map((s) => generateMap(s))]) {
      for (const id of systemsOf(map, 'COMMONS')) {
        const lode = lodeAt(map, id, BASES);
        expect(lode.yieldPerTick, `${id} must yield the flat COMMONS figure`).toBe(YIELD_PER_TICK.COMMONS);
        expect(lode.fuelPerTick).toBe(FUEL_YIELD_PER_TICK.COMMONS);
        expect(lode.richnessBps, 'a uniform tier has no richness to report').toBe(0);
      }
      expect(tierHasLodes('COMMONS')).toBe(false);
    }
  });

  it('richnessBps is signed, integral, and agrees with the yield it describes', () => {
    const map = launchMap();
    for (const tier of LODE_TIERS) {
      for (const id of systemsOf(map, tier)) {
        const lode = lodeAt(map, id, BASES);
        expect(Number.isInteger(lode.richnessBps), `${id} bps must be an integer (DET-7)`).toBe(true);
        expect(lode.richnessBps).toBe(
          Math.trunc(((lode.yieldPerTick - YIELD_PER_TICK[tier]) * 10_000) / YIELD_PER_TICK[tier]),
        );
        // The direction, which is the half an agent acts on.
        if (lode.yieldPerTick > YIELD_PER_TICK[tier]) expect(lode.richnessBps).toBeGreaterThan(0);
        if (lode.yieldPerTick < YIELD_PER_TICK[tier]) expect(lode.richnessBps).toBeLessThan(0);
      }
    }
  });

  it('is derived and memoised: one map always answers the same, two maps answer differently', () => {
    const a = launchMap();
    expect(lodesOf(a, BASES)).toBe(lodesOf(a, BASES)); // memo identity, so no `state_hash` reach
    const b = launchMap();
    for (const id of a.systemOrder) {
      expect(lodeAt(b, id, BASES).yieldPerTick, `${id} is fixed with the map`).toBe(
        lodeAt(a, id, BASES).yieldPerTick,
      );
    }
    const other = generateMap('lode-other');
    const differs = other.systemOrder.some((id) => {
      const here = a.systems.has(id) ? lodeAt(a, id, BASES).yieldPerTick : null;
      return here !== null && here !== lodeAt(other, id, BASES).yieldPerTick;
    });
    expect(differs, 'a different seed must draw different ground').toBe(true);
  });
});

describe('★ THE FLOOR — no lode may make a system a trap to settle on', () => {
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * **THE OWNER'S QUESTION, AS A TEST.** The Commons is uniform because 80/tick is 23,040 against a
   * 20,000 Levy and a 0.8× lode would be 17,568 — structurally short, and A8 promises a floor. The
   * same arithmetic has to be applied to the MARCHES and the FRONTIER, or the `g07` structural
   * residue is being built **by design** rather than encountered.
   *
   * The binding case is a SOLE occupant holding a claim, which is the tightest case the design
   * intends to be viable — `YIELD_PER_TICK`'s own calibration promises *"one WORKS alone at a system
   * slightly beats its own burn"*. Occupancy 2 is negative at every tier at every band including
   * flat, and that is the contention the design wants.
   * ══════════════════════════════════════════════════════════════════════════
   */
  it('★ every system\'s SOLE occupant clears its Levy plus its Charge, on 60 generated maps', () => {
    for (const map of [launchMap(), ...SEEDS.map((s) => generateMap(s))]) {
      for (const id of map.systemOrder) {
        const lode = lodeAt(map, id, BASES);
        const income = lode.yieldPerTick * TICKS_PER_RECKONING;
        const owed = Number(LEVY_DUTY_PER_PRINCIPAL) + Number(CHARGE_BY_TIER[lode.tier]);
        expect(
          income,
          `${map.seed} ${id} (${lode.tier}) yields ${String(lode.yieldPerTick)}/tick — its sole ` +
            'occupant cannot fund its own tribute, which is g07 arriving by design',
        ).toBeGreaterThan(owed);
      }
    }
  });

  it('the shipped launch map\'s per-tier floor, pinned as a reading', () => {
    // ⚑ These are `scripts/lode-band.ts`'s output for the SHIPPED band and nothing else. If the band
    // moves, run the script and paste — never adjust these by arithmetic on the old ones. The two
    // tables that used to disagree inside `lode.ts` are what this note is about.
    const map = launchMap();
    const read = (tier: ZoneTier) => {
      const ys = systemsOf(map, tier).map((id) => lodeAt(map, id, BASES).yieldPerTick);
      return { poorest: Math.min(...ys), richest: Math.max(...ys) };
    };
    expect(read('COMMONS')).toEqual({ poorest: 80, richest: 80 });
    expect(read('MARCHES')).toEqual({ poorest: 100, richest: 115 });
    expect(read('FRONTIER')).toEqual({ poorest: 141, richest: 158 });

    // ★ **THE FUEL SPREAD IS THE WALL THAT SET THE BAND, SO IT IS ASSERTED AND NOT ASSUMED.**
    // `FUEL_YIELD_PER_TICK.FRONTIER` is 10 over 8 systems, so one unit is a 10% step and the good
    // cannot express a finer spread. At 1.10× every frontier system yields exactly 10 — every ore
    // assertion in this file stays green and `agent.md`'s "some of it is worth far more than the
    // rest" silently becomes false. `assertLodes` cannot see it: its non-vacuity clause reads
    // `yieldPerTick` only. This line is the whole guard.
    const fuel = systemsOf(map, 'FRONTIER').map((id) => lodeAt(map, id, BASES).fuelPerTick);
    expect({ poorest: Math.min(...fuel), richest: Math.max(...fuel) }).toEqual({ poorest: 9, richest: 11 });
    expect(new Set(fuel).size, 'FUEL must carry more than one figure, or the frontier is flat').toBeGreaterThan(1);

    // The margins, which are the numbers the design decision was made on.
    expect(100 * TICKS_PER_RECKONING - 24_000, 'poorest MARCHES claimant margin').toBe(4_800);
    expect(141 * TICKS_PER_RECKONING - 27_000, 'poorest FRONTIER claimant margin').toBe(13_608);
    expect(80 * TICKS_PER_RECKONING - 20_000, 'a COMMONS resident, the thinnest margin in the game').toBe(3_040);
  });

  it('★ MUTATION: a band that breaches the floor is REFUSED at construction, not shipped', () => {
    // The guard's own subject has to be able to occur, or it is INV-22 over an empty journal again.
    // A 6..12 band is the measured below-the-floor case: `scripts/lode-band.ts` reads −4,992 on
    // MARCHES for it, so a map built that way must not be allowed to boot.
    const map = generateMap('lode-floor-mutant');
    const starved: LodeBases = {
      // Same shape, a base low enough that no allocation can clear the burn. This is the mutation
      // the floor clause exists for, expressed through the argument the clause actually reads.
      yield: { ...YIELD_PER_TICK, MARCHES: 80 } as typeof YIELD_PER_TICK,
      fuel: FUEL_YIELD_PER_TICK,
    };
    expect(() => {
      assertLodes(map, starved, FLOOR);
    }).toThrow(LodeError);
    try {
      assertLodes(map, starved, FLOOR);
    } catch (err) {
      // The message has to name the place and the arithmetic, because an operator reading a halt
      // needs the lever and not the symptom.
      expect(String(err)).toMatch(/bankrupts it for settling/);
      expect(String(err)).toMatch(/Narrow LODE_WEIGHT/);
    }
    // CONTROL: the shipped bases pass on the same map, so the throw above is the floor and not the
    // map. Without this the test would also pass if `assertLodes` threw unconditionally.
    expect(() => {
      assertLodes(map, BASES, FLOOR);
    }).not.toThrow();
  });

  it('MUTATION: a torn allocation that over-sums a tier is REFUSED', () => {
    // Conservation is what A15's proof and the Levy's payability both rest on, so the guard is the
    // thing standing between a rounding bug and INV-W1 halting worlds for an invisible reason.
    const map = generateMap('lode-conservation-mutant');
    // A fuel base the FRONTIER cannot hold conserved is not reachable through `lodesOf`, so the
    // mutation is applied where a real bug would land: a base of 0 on a tier the module varies.
    const zeroed: LodeBases = {
      yield: { ...YIELD_PER_TICK, FRONTIER: 0 } as typeof YIELD_PER_TICK,
      fuel: FUEL_YIELD_PER_TICK,
    };
    expect(() => {
      assertLodes(map, zeroed, FLOOR);
    }).toThrow(/base yield of 0|yields nothing at all/);
  });

  it('MUTATION: the COMMONS being given a lode is REFUSED in both directions', () => {
    // Both directions, because either the exclusion or the allocation could start covering it and
    // the failure would be silent: a Commons system 20% poorer than 80 cannot fund its own tribute,
    // and A8 promises a floor that never expires.
    expect(LODE_TIERS).not.toContain('COMMONS');
    expect(tierHasLodes('COMMONS')).toBe(false);
    const map = launchMap();
    for (const id of systemsOf(map, 'COMMONS')) {
      expect(lodeAt(map, id, BASES).yieldPerTick).toBe(YIELD_PER_TICK.COMMONS);
    }
  });

  it('the world\'s own boot check runs this, so the guard is not opt-in', () => {
    // `sim/runtime.ts` calls `assertMapLodes` in the constructor. If that call were removed the
    // guard would still pass its own unit tests and protect nothing — `lockFillStake`'s defect.
    const runtimeSrc = readFileSync(
      fileURLToPath(new URL('../../src/sim/runtime.ts', import.meta.url)),
      'utf8',
    );
    expect(runtimeSrc).toMatch(/assertMapLodes\(\s*this\.world\.map,/);
    expect(runtimeSrc, 'the floor figures must be passed, or the clause reads undefined').toMatch(
      /dutyPerReckoning:[\s\S]{0,200}chargeByTier:[\s\S]{0,200}ticksPerReckoning:/,
    );
  });
});

describe('★ the calibration script measures the rule that ships', () => {
  /**
   * `scripts/lode-band.ts` re-implements the allocation so it can vary `LODE_WEIGHT`, which is a
   * frozen module constant. That is a second copy of the rule — scar #5's shape — and the only thing
   * that makes it safe is this assertion: at the SHIPPED band the copy must reproduce the module
   * exactly, on every map. Otherwise the band was set by measuring a different rule from the one the
   * engine runs, which is worse than not measuring at all.
   *
   * MUTATION: change either allocator's `Rng.derive` label, its ordering, or its `largestRemainder`
   * total, and this goes red before the band table can be believed.
   */
  it('reproduces `lodesOf` exactly at the shipped band, over 60 maps', () => {
    for (const seed of SEEDS) {
      const map = generateMap(seed);
      const rng = Rng.fromSeed(`map:${map.seed}`).derive('system-lodes');
      const weights = new Map<SystemId, number>();
      for (const id of map.systemOrder) weights.set(id, rng.range(LODE_WEIGHT.min, LODE_WEIGHT.max));
      for (const tier of LODE_TIERS) {
        const ids = systemsOf(map, tier);
        if (ids.length === 0) continue;
        const w = ids.map((id) => weights.get(id) ?? LODE_WEIGHT.min);
        const shares = largestRemainder(
          (YIELD_PER_TICK[tier] * ids.length) as never,
          w,
        ) as readonly number[];
        ids.forEach((id, i) => {
          expect(shares[i], `${seed} ${id}: the script and the module must agree`).toBe(
            lodeAt(map, id, BASES).yieldPerTick,
          );
        });
      }
    }
  });
});

describe('★ the engine reads the SYSTEM everywhere it used to read the tier', () => {
  it('systemYield and systemFuelYield answer per system, and the quote agrees with the ledger', () => {
    setSpeed('instant');
    const rt = new Runtime({ seed: 'lode-quote' });
    const map = rt.world.map;
    const marches = systemsOf(map, 'MARCHES');
    const distinct = new Set(marches.map((id) => systemYield(map, id)));
    expect(distinct.size, 'non-vacuity: the tier must carry more than one figure').toBeGreaterThan(1);

    for (const id of marches) {
      // The affordance an agent reads before it spends a one-way act, against the module.
      const quote = rt.worksQuote('p:reader' as PrincipalId, id);
      expect(quote.yieldPerTick, `${id}: the QUOTE must publish this system's yield`).toBe(
        systemYield(map, id),
      );
      expect(quote.fuelYieldPerTick).toBe(systemFuelYield(map, id));
    }
  });

  it('INV-W1\'s cap is the SYSTEM\'s yield, so it neither refuses a rich place nor waves a poor one through', () => {
    // The invariant read the tier before §16.12 #1, which fails in BOTH directions at once — it
    // would have halted a rich system's honest output and let a poor system's over-sum past.
    setSpeed('instant');
    const rt = new Runtime({ seed: 'lode-invw1' });
    const map = rt.world.map;
    const ranked = [...systemsOf(map, 'MARCHES')].sort((a, b) => systemYield(map, a) - systemYield(map, b));
    const poorest = ranked[0];
    const richest = ranked[ranked.length - 1];
    if (poorest === undefined || richest === undefined) throw new Error('need MARCHES systems');
    expect(systemYield(map, richest)).toBeGreaterThan(systemYield(map, poorest));

    for (const system of [poorest, richest]) {
      rt.works.raise({ system, holder: `p:w-${system}` as PrincipalId, tick: 0 });
      const shares = rt.works.sharesAt(system, systemYield(map, system), WORKS_SPINUP_TICKS + 1);
      const total = [...shares.values()].reduce((a, b) => a + b, 0);
      expect(total, `${system}: extraction must equal the place's own cap`).toBe(systemYield(map, system));
    }
  });
});

describe('★ a crossing is still a TIER decision, and the lode decides WHERE inside it', () => {
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * **THE REGRESSION THIS FILE EXISTS FOR, AND IT SHIPPED GREEN ON THE BRANCH.**
   *
   * `cast/heuristic.ts:graduateFor` carries a paragraph headed *"A CROSSING IS A TIER DECISION, NOT
   * A LATERAL MOVE"* with three measurements behind it — `sable` crossing twice and declining 13
   * elective promises, 25 extra defaults, and `tenants 5 → 1` with rent `31,350 → 3,113`. §16.12 #1
   * pointed that gate at `systemYield` and **left the paragraph in place**. With per-system yield the
   * test *"a richer MARCHES system is not more than this MARCHES system"* is false, so every lateral
   * hop the paragraph forbids became legal again while the comment still said it did not.
   *
   * It cost five of the seven failures on that branch: `g07` spread 5 → 6 occupied systems, `g01`
   * took a **150** `levyShort` in a Reckoning both master and the strait/sway half were spotless in,
   * `g24` stopped publishing a battle line, and the coalition file's `doubleMarches` property went
   * **0 → 5**. Scar #1's shape exactly: engine and its own rules text disagreeing about one rule,
   * each individually coherent.
   *
   * MUTATION: point the gate back at `systemYield(map, to) <= systemYield(map, here)` and the first
   * test here goes red on the same tick.
   * ══════════════════════════════════════════════════════════════════════════
   */
  it('★ the gate compares TIERS, not systems — a lateral hop is never admissible', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../../src/cast/heuristic.ts', import.meta.url)),
      'utf8',
    );
    // The rule as code, asserted on the source because the alternative is running the cast for a
    // Reckoning and hoping a lateral hop happens to come up.
    expect(
      src,
      'graduateFor must gate on the TIER table; see the paragraph above the line',
    ).toMatch(/if \(YIELD_PER_TICK\[tierOf\(runtime\.world\.map, to\)\] <= hereTier\) continue;/);
    expect(
      src,
      'and it must NOT gate on the system, which is what re-admitted lateral hops',
    ).not.toMatch(/if \(systemYield\(runtime\.world\.map, to\) <= hereYield\) continue;/);
  });

  it('★ and the lode still binds: two systems in one tier are ranked differently by the quote', () => {
    // The §16.12 half that survives the tier gate, and the reason the gate costs the feature
    // nothing. `sharePerTick` is what `graduateFor` maximises over the admissible set, and it is
    // per-system — so among the destinations a crossing admits the cast picks the RICHEST, which it
    // could not do before because all eighteen MARCHES quotes were equal on yield.
    setSpeed('instant');
    const rt = new Runtime({ seed: 'lode-rank' });
    const map = rt.world.map;
    const reader = 'p:ranker' as PrincipalId;
    const quotes = systemsOf(map, 'MARCHES').map((id) => ({
      id,
      share: rt.worksQuote(reader, id).sharePerTick,
    }));
    const distinct = new Set(quotes.map((q) => q.share));
    expect(
      distinct.size,
      'the cast ranks destinations by this number; one value means it cannot choose',
    ).toBeGreaterThan(1);
    // And the ranking is the lode's ranking, not an accident of occupancy on an empty world.
    const byShare = [...quotes].sort((a, b) => b.share - a.share);
    const byYield = [...quotes].sort((a, b) => systemYield(map, b.id) - systemYield(map, a.id));
    expect(byShare[0]?.share).toBe(
      quotes.find((q) => q.id === byYield[0]?.id)?.share,
    );
  });
});

describe('the rules surface says what the engine does (scar #1)', () => {
  it('LODE_STATEMENT names the band, the conservation rule and where to read a figure', () => {
    expect(LODE_STATEMENT).toContain(String(LODE_WEIGHT.min));
    expect(LODE_STATEMENT).toContain(String(LODE_WEIGHT.max));
    expect(LODE_STATEMENT, 'the A15 half must be stated, not implied').toMatch(/extra identities still buy nothing/);
    expect(LODE_STATEMENT, 'the COMMONS exception is a rule an agent plans around').toMatch(/COMMONS is the exception/);
    expect(LODE_STATEMENT, 'and where to READ it, which is the probe\'s actual complaint').toMatch(
      /holding\.graduation/,
    );
  });

  it('★ agent.md\'s pinned ranges are the map\'s real ones', () => {
    // A rules surface carrying a stale range is a rules surface that lies, and this one is quoted to
    // an agent choosing where to spend a one-way act. Re-read from the engine every time the band
    // moves — the two ranges below moved when it did.
    const md = readFileSync(fileURLToPath(new URL('../../agent.md', import.meta.url)), 'utf8');
    const map = launchMap();
    for (const tier of LODE_TIERS) {
      const ys = systemsOf(map, tier).map((id) => lodeAt(map, id, BASES).yieldPerTick);
      const lo = Math.min(...ys);
      const hi = Math.max(...ys);
      expect(md, `agent.md must state ${tier} as ${String(lo)} to ${String(hi)}`).toContain(
        `**${String(lo)} to ${String(hi)}**`,
      );
    }
  });
});
