/**
 * The FITTING PUZZLE, as a pure function: `(hull, modules) → FitProfile | Rejection`.
 *
 * ── THIS IS THE CONSEQUENCE PREVIEW, AND IT IS FREE ─────────────────────────
 *
 * A2 and High Water's `projectedDrown`, applied to combat: {@link simulateFit} costs no action,
 * reserves nothing, moves nothing, and returns **the exact profile the resolver will use**. Not an
 * estimate of it — the same function. `PASS-SHIPS-COMBAT-extended` §1 MUST-6 asks for
 * *"unlimited simulation"* and §10 MUST-3 puts *"simulate/compare fit"* in the "no tick, no
 * action, cacheable" row of its boundary table.
 *
 * The alternative — an agent building a hull and *then* discovering the fit is illegal — is §1
 * MUST-2's named failure: *"CUT failure by trial and error."*
 *
 * ── EVERY REFUSAL NAMES THE BINDING CONSTRAINT ──────────────────────────────
 *
 * §1 MUST-2: *"Validation returns machine-readable constraints such as `powergrid_shortfall`,
 * `cpu_shortfall`, `hardpoint_full`, `wrong_size`, `exclusive_group`, or `zone_illegal`, plus the
 * cheapest legal swaps and their full deltas."* {@link FIT_CONSTRAINTS} is that list and
 * {@link simulateFit}'s rejection hint carries the shortfall *by how much*, because "does not fit"
 * sends an agent back to trial and error and "short 14 CPU; a COPROCESSOR in a low supplies 18"
 * does not.
 *
 * ── WHY THE PROFILE IS ALL INTEGERS ─────────────────────────────────────────
 *
 * `fitHash` goes into the engagement book, which goes into `state_hash`. `canonicalize` throws on
 * a float (DET-7), and it throws for the right reason: a fit profile that differed in the twelfth
 * decimal between two hosts would diverge replay. So every multiplier is bps and every division
 * truncates in a stated direction.
 */

import { canonicalHash } from '../core/canonical.js';
import { reject, type WorldResult } from '../world/result.js';
import {
  HULLS,
  hullSpec,
  MODULES,
  moduleSpec,
  weaponProfile,
  type HullSpec,
  type ModuleFamily,
  type RoleTag,
  type SlotRow,
  type WeaponFamily,
} from './catalogue.js';
import {
  MAX_MODULES_PER_FIT,
  RANGE_CELLS,
  STACK_PENALTY_BPS,
  type TypeProfile,
} from './params.js';

/** The named constraints a fit can violate. §1 MUST-2's list, verbatim where it applies here. */
export const FIT_CONSTRAINTS = Object.freeze([
  'unknown_hull',
  'unknown_module',
  'slot_full',
  'cpu_shortfall',
  'powergrid_shortfall',
  'calibration_shortfall',
  'hardpoint_full',
  'wrong_size',
  'exclusive_group',
  'too_many_modules',
  'no_weapon',
] as const);

export type FitConstraint = (typeof FIT_CONSTRAINTS)[number];

/** A fit's identity. Content-derived, so two identical fits are one fit and coalesce (§2 MUST-2). */
export type FitHash = string & { readonly __brand: 'FitHash' };

/**
 * What one stacked effect came to, decomposed.
 *
 * §1 MUST-7's four fields verbatim: *"Every simulation and observation reports `nominal_effect`,
 * `effective_effect`, `stack_rank`, and `marginal_effect_if_added`."* `marginal_if_added` is the
 * one that changes a decision — an agent told a fourth damage module adds 283 bps rather than 1,200
 * spends the slot elsewhere without needing to know the curve.
 */
export interface StackReport {
  readonly family: ModuleFamily;
  readonly attribute: string;
  readonly nominalBps: number;
  readonly effectiveBps: number;
  readonly stackRank: number;
  readonly marginalIfAddedBps: number;
}

/** How a weapon applies, per range cell, before the target is known. */
export interface WeaponLine {
  readonly weapon: string;
  readonly family: WeaponFamily;
  readonly count: number;
  /** Alpha per volley for the whole line, after damage mods and the hull bonus. */
  readonly alpha: number;
  readonly tracking: number | null;
  readonly explosion: number;
  readonly damage: TypeProfile;
  /** The published range row, so an agent never has to look it up. */
  readonly rangeFactorBps: readonly number[];
}

/**
 * Everything the resolver reads off a fit, and everything an agent is shown before it commits.
 *
 * §3 MUST-9 wants *"raw stats and `derived` values by range band and target size"*. This is the
 * derived half. The raw half is the {@link HullSpec} and the module list, both of which an agent
 * already has.
 */
export interface FitProfile {
  readonly fitHash: FitHash;
  readonly hull: string;
  readonly modules: readonly string[];
  readonly size: number;

  // Survivability
  readonly shield: number;
  readonly armor: number;
  readonly structure: number;
  /** Σ of the three layers, after buffer multipliers. What has to be removed to make a wreck. */
  readonly ehp: number;

  // Presentation to weapons
  readonly signature: number;
  /** Base mobility with propulsion running. What the range race is fought with. */
  readonly mobility: number;

  // Output
  readonly weapons: readonly WeaponLine[];
  /** Σ alpha across weapon lines, before any application factor. The paper number. */
  readonly alpha: number;

  // Capacitor
  readonly capacitor: number;
  readonly capRegenPerSlice: number;
  readonly capLoadPerSlice: number;
  /** True when regen ≥ load, i.e. the fit can hold its role indefinitely. */
  readonly capStable: boolean;
  /** Slices until dry at full load, or `null` when stable. §1 MUST-3's `stable_at`. */
  readonly enduranceSlices: number | null;
  readonly drainResistBps: number;

  // Control
  readonly tackle: number;
  readonly tackleReach: number;
  readonly scrams: boolean;
  readonly webBps: number;
  readonly webReach: number;
  readonly paintBps: number;
  readonly paintReach: number;
  readonly damp: number;
  readonly dampReach: number;
  readonly drain: number;
  readonly drainReach: number;

  // Support
  readonly remoteRepair: number;
  readonly localRepair: number;
  readonly command: number;

  // Legibility
  readonly roleTags: readonly RoleTag[];
  readonly stacks: readonly StackReport[];
  /** Fitting headroom, exact. §1 MUST-2: *"Own fits expose exact headroom."* */
  readonly cpuUsed: number;
  readonly cpuAvailable: number;
  readonly gridUsed: number;
  readonly gridAvailable: number;
  readonly calibrationUsed: number;
  readonly calibrationAvailable: number;
  readonly hardpointsUsed: number;
  readonly hardpointsAvailable: number;
  /** What it cost to build. Carried so a wreck can be valued without a second lookup. */
  readonly costFrame: number;
  readonly costFuel: number;
}

/** Apply a bps multiplier to an integer, truncating. One place, so rounding is one rule. */
export function scaleBps(value: number, bps: number): number {
  return Math.trunc((value * bps) / 10_000);
}

/**
 * Sum a stack of like effects through {@link STACK_PENALTY_BPS}, strongest first.
 *
 * Strongest first is not cosmetic: the curve is steep, so ordering by magnitude is what makes
 * *"the first few matter and later copies contribute little"* true of the *effect* rather than of
 * the array index. Two fits with the same modules in a different order must produce the same
 * profile, or `fitHash` is not an identity.
 */
export function stackSum(magnitudes: readonly number[]): number {
  const sorted = [...magnitudes].sort((a, b) => b - a || 0);
  let total = 0;
  for (const [i, magnitude] of sorted.entries()) {
    const penalty = STACK_PENALTY_BPS[i];
    if (penalty === undefined) break;
    total += scaleBps(magnitude, penalty);
  }
  return total;
}

/** What one more module of this magnitude would add on top of an existing stack. */
export function marginalOf(magnitudes: readonly number[], magnitude: number): number {
  return stackSum([...magnitudes, magnitude]) - stackSum(magnitudes);
}

interface Tally {
  cpu: number;
  grid: number;
  calibration: number;
  hardpoints: number;
}

/**
 * Simulate a fit. Free, read-only, deterministic, and **the arithmetic the resolver runs**.
 *
 * `modules` is a flat list; the row each one occupies is a property of the module, not a choice, so
 * an agent cannot put a plate in a mid. That is a simplification of EVE's drag-and-drop and it is
 * the right one: the opportunity cost §1 MUST-1 protects is *which row the module competes in*, and
 * that is preserved exactly.
 */
export function simulateFit(hullName: string, modules: readonly string[]): WorldResult<FitProfile> {
  const hull = hullSpec(hullName);
  if (hull === undefined) {
    return reject(
      'A2',
      `unknown_hull: "${hullName}" is not a hull. The five are ${Object.keys(HULLS).join(' · ')}.`,
    );
  }
  if (modules.length > MAX_MODULES_PER_FIT) {
    return reject(
      'A2',
      `too_many_modules: ${String(modules.length)} named, ${String(MAX_MODULES_PER_FIT)} is the cap across all ` +
        `four rows.`,
    );
  }

  // ── Legality, in the order §1 MUST-2 names ────────────────────────────────
  const rows: Record<SlotRow, number> = { HIGH: 0, MID: 0, LOW: 0, RIG: 0 };
  const tally: Tally = { cpu: 0, grid: 0, calibration: 0, hardpoints: 0 };
  let cpuBonus = 0;
  let gridBonus = 0;
  const exclusives = new Map<string, string>();

  for (const name of modules) {
    const spec = moduleSpec(name);
    if (spec === undefined) {
      return reject(
        'A2',
        `unknown_module: "${name}" is not a module. ${String(Object.keys(MODULES).length)} exist; ` +
          `see the catalogue in your observation.`,
      );
    }
    rows[spec.row] += 1;
    tally.cpu += spec.cpu;
    tally.grid += spec.grid;
    tally.calibration += spec.calibration ?? 0;
    cpuBonus += spec.cpuBonus ?? 0;
    gridBonus += spec.gridBonus ?? 0;
    if (spec.hardpoint === true) tally.hardpoints += 1;

    if (spec.weapon !== undefined) {
      const weapon = weaponProfile(spec.weapon);
      if (weapon !== undefined && hull.size < weapon.minHullSize) {
        return reject(
          'A2',
          `wrong_size: ${name} needs a hull of size ${String(weapon.minHullSize)} or larger and ${hullName} is ` +
            `size ${String(hull.size)}. Small weapons fit anything; large ones need a large frame.`,
        );
      }
    }
    if (spec.exclusive !== undefined) {
      const held = exclusives.get(spec.exclusive);
      if (held !== undefined) {
        return reject(
          'A2',
          `exclusive_group: ${name} and ${held} are both ${spec.exclusive} and only one may be fitted.`,
        );
      }
      exclusives.set(spec.exclusive, name);
    }
  }

  for (const row of ['HIGH', 'MID', 'LOW', 'RIG'] as const) {
    if (rows[row] > hull.slots[row]) {
      return reject(
        'A2',
        `slot_full: ${String(rows[row])} modules want the ${row} row and ${hullName} has ` +
          `${String(hull.slots[row])}.`,
      );
    }
  }
  if (tally.hardpoints > hull.hardpoints) {
    return reject(
      'A2',
      `hardpoint_full: ${String(tally.hardpoints)} weapons need a hardpoint and ${hullName} has ` +
        `${String(hull.hardpoints)}. A utility high is still available — that is the point of the ` +
        `distinction.`,
    );
  }

  const cpuAvailable = hull.cpu + cpuBonus;
  const gridAvailable = hull.grid + gridBonus;
  if (tally.cpu > cpuAvailable) {
    return reject(
      'A2',
      `cpu_shortfall: short ${String(tally.cpu - cpuAvailable)} CPU (${String(tally.cpu)} used of ` +
        `${String(cpuAvailable)}). A COPROCESSOR in a low supplies 18 for 8 grid.`,
    );
  }
  if (tally.grid > gridAvailable) {
    return reject(
      'A2',
      `powergrid_shortfall: short ${String(tally.grid - gridAvailable)} grid (${String(tally.grid)} used of ` +
        `${String(gridAvailable)}). A REACTOR in a low supplies 45 for 8 CPU.`,
    );
  }
  if (tally.calibration > hull.calibration) {
    return reject(
      'A2',
      `calibration_shortfall: rigs want ${String(tally.calibration)} calibration and ${hullName} has ` +
        `${String(hull.calibration)}. A rig is destroyed if removed, so this is a permanent commitment.`,
    );
  }

  return { ok: true, value: derive(hullName, hull, modules) };
}

/**
 * A fit is legal but may still be useless, and that is deliberately **not** a rejection.
 *
 * §1 MUST-10: *"`fit.simulate` rejects nothing silently and names the binding constraint"* — but a
 * hull with no gun is a legal hull, and a repair cruiser or a pure tackle frigate is exactly the
 * kind of fit §12 relationship #4 exists to make viable. Refusing it would make "bring only
 * warships" a rule, which is the monoculture the stacking curve is there to prevent. So the
 * *observation* says so and the engine allows it.
 */
export function fitWarnings(profile: FitProfile): readonly string[] {
  const out: string[] = [];
  if (profile.alpha === 0) {
    out.push('no_weapon: this fit deals no damage. Legal, and correct for a REPAIR or TACKLE hull.');
  }
  if (!profile.capStable && profile.enduranceSlices !== null) {
    out.push(
      `cap_unstable: full load runs dry in ${String(profile.enduranceSlices)} slices of ` +
        `8 per tick, after which modules shut down WEAPON first and TACKLE last.`,
    );
  }
  if (profile.roleTags.length === 0) {
    out.push('no_role: this fit earns no role tag, so no doctrine quota counts it.');
  }
  return out;
}

function derive(hullName: string, hull: HullSpec, modules: readonly string[]): FitProfile {
  const specs = modules.map((name) => ({ name, spec: moduleSpec(name) })).filter((m) => m.spec !== undefined);

  // ── Buffers ───────────────────────────────────────────────────────────────
  // Buffer modules do not stack-penalise: they are absolute hit points, not percentages, and §1
  // MUST-7 says so explicitly ("Some absolute bonuses ... follow separate rules"). The bps
  // multipliers from rigs and nanos DO stack.
  let shield = hull.shield;
  let armor = hull.armor;
  const bufferBpsStack: number[] = [];
  const signatureBpsStack: number[] = [];
  const alphaBpsStack: number[] = [];
  const trackingBpsStack: number[] = [];
  const capRegenBpsStack: number[] = [];
  const drainResistStack: number[] = [];

  let mobility = hull.mobility;
  let capacitor = hull.capacitor;
  let capLoad = 0;
  let command = hull.command;
  let tackle = 0;
  let tackleReach = 0;
  let scrams = false;
  const webStack: number[] = [];
  let webReach = 0;
  const paintStack: number[] = [];
  let paintReach = 0;
  let damp = 0;
  let dampReach = 0;
  let drain = 0;
  let drainReach = 0;
  let remoteRepair = 0;
  let localRepair = 0;
  let rigReachBonus = 0;
  const tags = new Set<RoleTag>();
  const weaponCounts = new Map<string, number>();

  for (const { spec } of specs) {
    if (spec === undefined) continue;
    shield += spec.shield ?? 0;
    armor += spec.armor ?? 0;
    if (spec.bufferBps !== undefined) bufferBpsStack.push(spec.bufferBps);
    if (spec.signatureBps !== undefined) signatureBpsStack.push(spec.signatureBps);
    if (spec.alphaBps !== undefined) alphaBpsStack.push(spec.alphaBps);
    if (spec.trackingBps !== undefined) trackingBpsStack.push(spec.trackingBps);
    if (spec.capRegenBps !== undefined) capRegenBpsStack.push(spec.capRegenBps);
    if (spec.drainResistBps !== undefined) drainResistStack.push(spec.drainResistBps);
    mobility += spec.mobility ?? 0;
    capacitor += spec.cap_capacity ?? 0;
    capLoad += spec.cap ?? 0;
    command += spec.command ?? 0;
    if (spec.tackle !== undefined) {
      tackle += spec.tackle;
      tackleReach = Math.max(tackleReach, spec.reach ?? 0);
    }
    if (spec.scrams === true) scrams = true;
    if (spec.webBps !== undefined) {
      webStack.push(spec.webBps);
      webReach = Math.max(webReach, spec.reach ?? 0);
    }
    if (spec.paintBps !== undefined) {
      paintStack.push(spec.paintBps);
      paintReach = Math.max(paintReach, spec.reach ?? 0);
    }
    if (spec.damp !== undefined) {
      damp += spec.damp;
      if (spec.damp > 0) dampReach = Math.max(dampReach, spec.reach ?? 0);
    }
    if (spec.drain !== undefined) {
      drain += spec.drain;
      drainReach = Math.max(drainReach, spec.reach ?? 0);
    }
    remoteRepair += spec.remoteRepair ?? 0;
    localRepair += spec.localRepair ?? 0;
    if (spec.row === 'RIG' && spec.family === 'TACKLE') rigReachBonus += spec.reach ?? 0;
    for (const tag of spec.tags ?? []) tags.add(tag);
  }

  for (const { spec } of specs) {
    if (spec?.weapon === undefined) continue;
    weaponCounts.set(spec.weapon, (weaponCounts.get(spec.weapon) ?? 0) + 1);
  }

  // ── The hull bonus, applied to its one family ─────────────────────────────
  // Not stack-penalised: it is the hull's identity, and penalising it against the modules it
  // exists to boost would make every bonus hull worse the more it leaned into its role — the
  // opposite of §3 MUST-10.
  const bonusFor = (family: ModuleFamily): number => (hull.bonus.family === family ? hull.bonus.bps : 0);

  const bufferBps = 10_000 + stackSum(bufferBpsStack.filter((b) => b > 0)) + bufferBpsStack.filter((b) => b < 0).reduce((a, b) => a + b, 0);
  const structure = hull.structure;
  const shieldFinal = scaleBps(shield, bufferBps);
  const armorFinal = scaleBps(armor, bufferBps);
  const structureFinal = scaleBps(structure, bufferBps);

  const signature = scaleBps(hull.signature, 10_000 + stackSum(signatureBpsStack));
  const alphaBps = 10_000 + stackSum(alphaBpsStack.filter((b) => b > 0)) + alphaBpsStack.filter((b) => b < 0).reduce((a, b) => a + b, 0) + bonusFor('DAMAGE');
  const trackingBps = 10_000 + stackSum(trackingBpsStack) + bonusFor('APPLICATION');
  const capRegen =
    scaleBps(
      hull.capRegen,
      10_000 + stackSum(capRegenBpsStack.filter((b) => b > 0)) + capRegenBpsStack.filter((b) => b < 0).reduce((a, b) => a + b, 0),
    );

  const weapons: WeaponLine[] = [];
  let alphaTotal = 0;
  for (const name of [...weaponCounts.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const count = weaponCounts.get(name) ?? 0;
    const profile = weaponProfile(name);
    if (profile === undefined || count === 0) continue;
    const weaponBonus = bonusFor('WEAPON');
    const lineAlpha = scaleBps(profile.alpha * count, alphaBps + weaponBonus);
    alphaTotal += lineAlpha;
    weapons.push({
      weapon: name,
      family: profile.family,
      count,
      alpha: lineAlpha,
      tracking: profile.tracking === null ? null : scaleBps(profile.tracking, trackingBps),
      explosion: profile.explosion,
      damage: profile.damage,
      rangeFactorBps: rangeRowFor(profile.family),
    });
  }

  const capRegenPerSlice = capRegen;
  const capStable = capRegenPerSlice >= capLoad;
  const deficit = capLoad - capRegenPerSlice;
  const enduranceSlices = capStable ? null : Math.max(1, Math.trunc(capacitor / Math.max(1, deficit)));

  const profile: Omit<FitProfile, 'fitHash'> = {
    hull: hullName,
    modules: [...modules],
    size: hull.size,
    shield: shieldFinal,
    armor: armorFinal,
    structure: structureFinal,
    ehp: shieldFinal + armorFinal + structureFinal,
    signature: Math.max(1, signature),
    mobility: Math.max(0, mobility),
    weapons,
    alpha: alphaTotal,
    capacitor,
    capRegenPerSlice,
    capLoadPerSlice: capLoad,
    capStable,
    enduranceSlices,
    drainResistBps: Math.min(9_000, stackSum(drainResistStack)),
    tackle: tackle === 0 ? 0 : tackle + Math.trunc((tackle * bonusFor('TACKLE')) / 10_000),
    tackleReach: tackle === 0 ? 0 : tackleReach + rigReachBonus,
    scrams,
    webBps: Math.min(9_000, stackSum(webStack) + (webStack.length === 0 ? 0 : Math.trunc((stackSum(webStack) * bonusFor('EWAR')) / 10_000))),
    webReach,
    paintBps: stackSum(paintStack) + (paintStack.length === 0 ? 0 : Math.trunc((stackSum(paintStack) * bonusFor('EWAR')) / 10_000)),
    paintReach,
    damp,
    dampReach,
    drain: drain === 0 ? 0 : drain + Math.trunc((drain * bonusFor('EWAR')) / 10_000),
    drainReach,
    remoteRepair: remoteRepair === 0 ? 0 : remoteRepair + Math.trunc((remoteRepair * bonusFor('REPAIR')) / 10_000),
    localRepair,
    command,
    roleTags: [...tags].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    stacks: stackReports(alphaBpsStack, trackingBpsStack, webStack, paintStack, bufferBpsStack),
    cpuUsed: specs.reduce((n, m) => n + (m.spec?.cpu ?? 0), 0),
    cpuAvailable: hull.cpu + specs.reduce((n, m) => n + (m.spec?.cpuBonus ?? 0), 0),
    gridUsed: specs.reduce((n, m) => n + (m.spec?.grid ?? 0), 0),
    gridAvailable: hull.grid + specs.reduce((n, m) => n + (m.spec?.gridBonus ?? 0), 0),
    calibrationUsed: specs.reduce((n, m) => n + (m.spec?.calibration ?? 0), 0),
    calibrationAvailable: hull.calibration,
    hardpointsUsed: specs.filter((m) => m.spec?.hardpoint === true).length,
    hardpointsAvailable: hull.hardpoints,
    costFrame: hull.costFrame,
    costFuel: hull.costFuel,
  };

  return { ...profile, fitHash: fitHashOf(hullName, modules) };
}

/**
 * A fit's identity: the hull plus its modules, **order-independent**.
 *
 * Order-independent because §2 MUST-2 coalesces identical assets into one formation, and two hulls
 * with the same modules listed differently are the same hull. If order mattered, an agent could
 * fragment its own fleet into one formation per hull by shuffling a list, which is the
 * *"one ship per formation action spam"* MUST-2 explicitly prevents.
 */
export function fitHashOf(hull: string, modules: readonly string[]): FitHash {
  const sorted = [...modules].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `fit:${canonicalHash({ v: 1, hull, modules: sorted }).slice(0, 12)}` as FitHash;
}

/** The published range row for a weapon family, as an inert array an observation can carry. */
export function rangeRowFor(family: WeaponFamily): readonly number[] {
   
  switch (family) {
    case 'SMALL_GUN':
      return [10_000, 10_000, 4_000, 500, 0];
    case 'LARGE_GUN':
      return [3_000, 6_000, 10_000, 8_000, 3_000];
    case 'MISSILE':
      return [8_000, 10_000, 10_000, 7_000, 2_000];
  }
}

/** The name of a range cell by index, for prose. */
export function rangeName(index: number): string {
  return RANGE_CELLS[Math.max(0, Math.min(RANGE_CELLS.length - 1, index))] ?? 'MID';
}

function stackReports(
  alpha: readonly number[],
  tracking: readonly number[],
  web: readonly number[],
  paint: readonly number[],
  buffer: readonly number[],
): readonly StackReport[] {
  const rows: StackReport[] = [];
  const add = (family: ModuleFamily, attribute: string, magnitudes: readonly number[], next: number): void => {
    const positives = magnitudes.filter((m) => m > 0);
    if (positives.length === 0) return;
    rows.push({
      family,
      attribute,
      nominalBps: positives.reduce((a, b) => a + b, 0),
      effectiveBps: stackSum(positives),
      stackRank: positives.length,
      marginalIfAddedBps: marginalOf(positives, next),
    });
  };
  add('DAMAGE', 'alpha', alpha, 1_200);
  add('APPLICATION', 'tracking', tracking, 1_500);
  add('EWAR', 'web', web, 6_000);
  add('APPLICATION', 'paint', paint, 3_000);
  add('TANK_BUFFER', 'buffer', buffer, 1_200);
  return rows;
}
