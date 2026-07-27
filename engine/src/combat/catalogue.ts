/**
 * The HULL and MODULE catalogue — five hulls, twenty-nine modules, and the opportunity costs
 * between them.
 *
 * ── FEWER NAMES, EVERY RELATIONSHIP ─────────────────────────────────────────
 *
 * `PASS-SHIPS-COMBAT-extended` §12 ends with the instruction this file follows literally:
 * *"If schedule forces a choice, ship fewer hull names and preserve these five relationships."*
 * The five are the fitting puzzle, application, tackle, counterable force multipliers, and
 * doctrines. So: one hull per size band rather than EVE's hundreds (§3 CUT-1 asks for exactly
 * that — *"CUT catalog parity; KEEP the role matrix"*), and a module list chosen so that **every
 * module is the answer to another module**.
 *
 * That last property is the test this catalogue has to pass, and it is checkable by reading:
 *
 * | if you bring | it is answered by |
 * |---|---|
 * | `LARGE_GUN` (can't track small) | small fast hulls — answered by `WEB`, `PAINT`, `TRACKING_MOD` |
 * | `MWD` (range control) | `SCRAM` kills it outright; `WEB` halves it |
 * | `POINT` (nothing leaves) | kill the PIKE holding it; or `NANO` past its reach |
 * | `REMOTE_REPAIR` (nothing dies) | `DRAIN` empties it; `DAMP` unlocks it; alpha outruns it |
 * | `SHIELD_EXTENDER` (buffer) | costs you signature, which is what `MISSILE` eats |
 * | `PLATE` (buffer) | costs you mobility, which is the range race |
 * | `COMMAND_BURST` (aura) | it must be committed and targetable — shoot it |
 * | `DRAIN` (cap warfare) | `CAP_BATTERY`, or a passive fit with no cap load at all |
 *
 * §12 relationship #4 states the requirement that table satisfies: *"Every multiplier must have an
 * attackable source, resource limit, coverage/lock constraint, stacking rule, and at least two
 * counters."*
 *
 * ── THE FIT IS IMMUTABLE, AND THAT IS A CUT WITH A REASON ────────────────────
 *
 * §1 MUST-8 wants `full_service` / `field_service` / `none` refit locations. This build has one
 * rule instead: **a hull is built with its fit and can never be refitted.** What that costs is the
 * turnaround loop — you cannot repair a burnt module or swap ammunition between engagements. What
 * it buys is the thing MUST-8 exists to protect, in its strongest form: *"Staging infrastructure
 * and supply intelligence matter only if combatants cannot freely morph into the exact counter
 * after seeing the enemy."* An immutable fit makes doctrine commitment total, makes scouting
 * permanently worth paying for, and costs no verb. The refit ladder is the named deferral.
 */

import type { DamageType, TypeProfile } from './params.js';

// ── Slots ───────────────────────────────────────────────────────────────────

/**
 * The four rows, and the competition between them *is* the puzzle.
 *
 * §1 MUST-1: *"Shield tank preserves damage lows but consumes control mids; armor tank preserves
 * control mids but consumes damage/mobility lows; a utility high means one fewer weapon."* That
 * sentence is implemented entirely by which row each module in {@link MODULES} sits in — there is
 * no separate rule enforcing the tradeoff, and there does not need to be one.
 */
export const SLOT_ROWS = Object.freeze(['HIGH', 'MID', 'LOW', 'RIG'] as const);

export type SlotRow = (typeof SLOT_ROWS)[number];

/**
 * What a module *does*, for the purposes of stacking, capacitor shutdown, and role coverage.
 *
 * §1 MUST-7: *"The engine applies modifiers by effect group, not module name, avoiding accidental
 * bypasses."* This is that group. Two modules in the same family stack against each other whether
 * or not they share a name, which is what stops "bring a different painter" from being a bypass.
 */
export const MODULE_FAMILIES = Object.freeze([
  'WEAPON',
  'TANK_BUFFER',
  'TANK_ACTIVE',
  'TACKLE',
  'EWAR',
  'REPAIR',
  'CAPACITOR',
  'PROPULSION',
  'COMMAND',
  'FITTING',
  'DAMAGE',
  'APPLICATION',
] as const);

export type ModuleFamily = (typeof MODULE_FAMILIES)[number];

/**
 * The five role tags a fit can *earn*, never declare.
 *
 * §3 MUST-2 wants `doctrine.publish` to bind a fit to a role and `commit` to *"validate minimum
 * role coverage but never force it"*. Deriving the tag from what is actually fitted rather than
 * taking the agent's word is the difference between a doctrine that describes a fleet and one that
 * a fleet can lie about. A hull with a `POINT` is TACKLE. A hull that says it is TACKLE and carries
 * no point is a hull with no tag, and `missing: {TACKLE: 2}` says so.
 *
 * `REPAIR` and not "logistics", deliberately: §10 and `D23` both spend *logistics* on hauling, and
 * one word may not carry two concepts (hard rule 4).
 */
export const ROLE_TAGS = Object.freeze(['LINE', 'TACKLE', 'REPAIR', 'EWAR', 'COMMAND'] as const);

export type RoleTag = (typeof ROLE_TAGS)[number];

// ── Weapons ─────────────────────────────────────────────────────────────────

/** Which {@link import('./params.js').RANGE_FACTOR} row a weapon reads, and how it applies. */
export type WeaponFamily = 'SMALL_GUN' | 'LARGE_GUN' | 'MISSILE';

export interface WeaponProfile {
  readonly family: WeaponFamily;
  /** Damage per volley before application, in hit points. */
  readonly alpha: number;
  /**
   * How well it follows a moving target. Turrets only; a missile's is `null`.
   *
   * §4 MUST-2's whole point in one number: applied fraction is `tracking / (tracking + motion)`, so
   * a `LARGE_GUN` at 2 against a webbed PIKE at 4 lands 33%, and against an un-webbed one at 12
   * lands 14%. **This single ratio is why a frigate matters beside a battleship.**
   */
  readonly tracking: number | null;
  /**
   * The signature it needs to apply fully. Bigger is worse.
   *
   * A missile with `explosion: 40` against a 40-signature frigate applies fully; against nothing
   * smaller does it ever apply *more*. A `PAINT` raises the target's signature and a
   * `SHIELD_EXTENDER` raises your own, which is the opportunity cost §1 MUST-1 names.
   */
  readonly explosion: number;
  /** Which of the four types it deals, in bps summing to 10,000. */
  readonly damage: TypeProfile;
  /** Hull size it may be mounted on, at most. A `LARGE_GUN` on a frigate is `wrong_size`. */
  readonly minHullSize: number;
}

/**
 * ── THE PACE, AND HOW PLAYING IT FOUND THE NUMBER ────────────────────────────
 *
 * **`alpha` is damage PER SLICE**, and there are eight slices in a tick and 96 in a CONTEST. The first
 * hand-set numbers missed that by an order of magnitude: a WARDEN had 2,288 EHP and a three-launcher
 * WARDEN had 734 alpha, so a cruiser died in **five slices** — under one tick — and every battle in
 * the sim closed early with nothing having happened in between. `CONTESTED` appeared **zero** times
 * across thirty battles.
 *
 * A battle that resolves in one tick leaves no room for any of the five relationships to operate.
 * Tackle cannot decide who leaves if nobody lives long enough to try; the range race cannot be
 * contested if the fight ends before the lines move; a repair wing cannot save anything; and the
 * five-state clock is decoration over an instant. Every relationship still *implemented*, and none of
 * them *reachable* — which is this project's signature defect wearing a balance number.
 *
 * So weapon alpha is **÷10** from the first draft and repair is **÷20**. Two distinct fixes, and it is
 * worth keeping them distinct:
 *
 * 1. **Pace.** A cruiser under one enemy cruiser's fire now lasts ~50 slices — six ticks of a twelve
 *    tick CONTEST. Long enough for orders to be restated, tackle to land and a repair wing to matter;
 *    short enough that a battle still finishes inside its standoff. `CONTESTED` went from 0/30 to
 *    9/39, which is the number that says a battle is now a *contest*.
 * 2. **Repair dominance.** At the first numbers a `SHIELD_BOOSTER` self-repaired 300 per slice against
 *    incoming of ~440, and `REMOTE_REPAIR` gave 240 — so **active tanking beat alpha outright**, and
 *    the sim said so: the repair doctrine beat every other one 9-0 while losing zero hulls. §5 MUST-7
 *    names the thing that has to stay true as *"the alpha breakpoint"*: repair must be beatable by
 *    concentrated damage. A repair wing now offsets roughly 40% of incoming, which is a force
 *    multiplier rather than an answer.
 *
 * **What the recalibration bought, in one line:** the counter-chain closed. The EWAR doctrine now
 * *beats* a turret fleet (4 won · 3 lost · 17 contested) and still *loses* to a missile fleet
 * (0 · 15 · 3) — because `MISSILE` has `cap: 0`, so draining a missile fleet's capacitor removes
 * nothing. That is EVE's own logic and it makes reconnaissance worth paying for: what to bring depends
 * on what they are flying, which is the whole content of §2 MUST-4.
 *
 * Both figures are *(calibrate)* and the instrument is `scripts/combat-sim.ts`.
 */
const kinetic = (): TypeProfile => ({ KINETIC: 10_000, THERMAL: 0, EXPLOSIVE: 0, EM: 0 });
const thermal = (): TypeProfile => ({ KINETIC: 0, THERMAL: 10_000, EXPLOSIVE: 0, EM: 0 });
const explosive = (): TypeProfile => ({ KINETIC: 0, THERMAL: 0, EXPLOSIVE: 10_000, EM: 0 });
const em = (): TypeProfile => ({ KINETIC: 0, THERMAL: 0, EXPLOSIVE: 0, EM: 10_000 });

/**
 * The weapons, and the ammunition choice folded into the module name.
 *
 * §4 MUST-1 wants ammunition choice, and an immutable fit means the choice is made once — so each
 * gun family ships in two named variants that differ in damage type and one other axis. That is
 * the *decision* MUST-1 exists for (*"the best ammunition depends on the target"*) without a
 * switch-condition policy field or a magazine to track. `SMALL_GUN_EM` against a shield fleet and
 * `SMALL_GUN` against an armour one is a real intelligence-driven fitting call.
 */
export const WEAPONS: Readonly<Record<string, WeaponProfile>> = Object.freeze({
  SMALL_GUN: Object.freeze({
    family: 'SMALL_GUN',
    alpha: 9,
    tracking: 8,
    explosion: 40,
    damage: Object.freeze(kinetic()),
    minHullSize: 1,
  }),
  SMALL_GUN_EM: Object.freeze({
    family: 'SMALL_GUN',
    alpha: 8,
    tracking: 8,
    explosion: 40,
    damage: Object.freeze(em()),
    minHullSize: 1,
  }),
  LARGE_GUN: Object.freeze({
    family: 'LARGE_GUN',
    alpha: 52,
    tracking: 2,
    explosion: 400,
    damage: Object.freeze(explosive()),
    minHullSize: 4,
  }),
  LARGE_GUN_EM: Object.freeze({
    family: 'LARGE_GUN',
    alpha: 45,
    tracking: 2,
    explosion: 400,
    damage: Object.freeze(em()),
    minHullSize: 4,
  }),
  MISSILE: Object.freeze({
    family: 'MISSILE',
    alpha: 20,
    tracking: null,
    explosion: 130,
    damage: Object.freeze(kinetic()),
    minHullSize: 2,
  }),
  MISSILE_THERMAL: Object.freeze({
    family: 'MISSILE',
    alpha: 19,
    tracking: null,
    explosion: 130,
    damage: Object.freeze(thermal()),
    minHullSize: 2,
  }),
});

// ── Modules ─────────────────────────────────────────────────────────────────

/**
 * One entry in the catalogue. Every numeric field is an *effect*, and the fit simulator turns the
 * set of them into a profile.
 *
 * Absent means zero. `cpu`/`grid` may be **negative** — that is how `COPROCESSOR` and `REACTOR`
 * work, and it is the shape §1 MUST-2 names: *"a co-processor spends a low to unlock EWAR"*.
 */
export interface ModuleSpec {
  readonly row: SlotRow;
  readonly family: ModuleFamily;
  /** CPU it consumes. Negative *supplies* CPU. */
  readonly cpu: number;
  /** Powergrid it consumes. Negative supplies. */
  readonly grid: number;
  /** Calibration. Rigs only. */
  readonly calibration?: number;
  /** Capacitor it draws per slice while active. */
  readonly cap?: number;
  /** Whether it needs a weapon hardpoint. */
  readonly hardpoint?: boolean;
  /** The weapon it is, if it is one. Keys {@link WEAPONS}. */
  readonly weapon?: string;
  /** Buffer added, in hit points, to a named layer. */
  readonly shield?: number;
  readonly armor?: number;
  /** Buffer multiplier in bps, applied to the total. Rigs and nanos. */
  readonly bufferBps?: number;
  /** Self-repair per slice. */
  readonly localRepair?: number;
  /** Remote repair per slice, given to a friend within {@link import('./params.js').REPAIR_REACH}. */
  readonly remoteRepair?: number;
  /** Tackle strength contributed. */
  readonly tackle?: number;
  /** Furthest range cell index this module reaches. */
  readonly reach?: number;
  /** Kills the target's `MWD`. `SCRAM` only. */
  readonly scrams?: boolean;
  /** Reduces the target's mobility by this many bps. */
  readonly webBps?: number;
  /** Raises the target's signature by this many bps. */
  readonly paintBps?: number;
  /** Reduces the target's locks and its own side's reach. */
  readonly damp?: number;
  /** Capacitor drained from the primary per slice. */
  readonly drain?: number;
  /** Capacitor capacity added. */
  readonly cap_capacity?: number;
  /** Capacitor regen added, in bps. */
  readonly capRegenBps?: number;
  /** Resistance to being drained, in bps. */
  readonly drainResistBps?: number;
  /** Mobility added. Negative subtracts. */
  readonly mobility?: number;
  /** Own signature multiplier in bps. `SHIELD_EXTENDER` and `MWD` both raise it. */
  readonly signatureBps?: number;
  /** Alpha multiplier in bps. Stacking-penalised through {@link ModuleSpec.family}. */
  readonly alphaBps?: number;
  /** Tracking multiplier in bps. Stacking-penalised. */
  readonly trackingBps?: number;
  /** Command channels contributed. */
  readonly command?: number;
  /** CPU supplied, for the fitting family. */
  readonly cpuBonus?: number;
  /** Powergrid supplied. */
  readonly gridBonus?: number;
  /** Only one module of this group may be fitted. */
  readonly exclusive?: string;
  /** Role tags a fit earns by carrying this. */
  readonly tags?: readonly RoleTag[];
}

/**
 * The catalogue. Twenty-nine modules, and the count is the point: §1 CUT-1 rejects
 * *"hundreds of near-duplicate modules"* because for autonomous agents they *"explode cache
 * cardinality, make enemy inference nearly arbitrary, and turn explanations into item-database
 * retrieval."*
 */
export const MODULES: Readonly<Record<string, ModuleSpec>> = Object.freeze({
  // ── HIGH ──────────────────────────────────────────────────────────────────
  SMALL_GUN: Object.freeze({
    row: 'HIGH', family: 'WEAPON', cpu: 8, grid: 6, cap: 4, hardpoint: true,
    weapon: 'SMALL_GUN', tags: ['LINE'] as const,
  }),
  SMALL_GUN_EM: Object.freeze({
    row: 'HIGH', family: 'WEAPON', cpu: 9, grid: 7, cap: 5, hardpoint: true,
    weapon: 'SMALL_GUN_EM', tags: ['LINE'] as const,
  }),
  LARGE_GUN: Object.freeze({
    row: 'HIGH', family: 'WEAPON', cpu: 14, grid: 90, cap: 12, hardpoint: true,
    weapon: 'LARGE_GUN', tags: ['LINE'] as const,
  }),
  LARGE_GUN_EM: Object.freeze({
    row: 'HIGH', family: 'WEAPON', cpu: 16, grid: 96, cap: 14, hardpoint: true,
    weapon: 'LARGE_GUN_EM', tags: ['LINE'] as const,
  }),
  MISSILE: Object.freeze({
    row: 'HIGH', family: 'WEAPON', cpu: 20, grid: 18, cap: 0, hardpoint: true,
    weapon: 'MISSILE', tags: ['LINE'] as const,
  }),
  MISSILE_THERMAL: Object.freeze({
    row: 'HIGH', family: 'WEAPON', cpu: 21, grid: 19, cap: 0, hardpoint: true,
    weapon: 'MISSILE_THERMAL', tags: ['LINE'] as const,
  }),
  REMOTE_REPAIR: Object.freeze({
    row: 'HIGH', family: 'REPAIR', cpu: 26, grid: 20, cap: 22,
    remoteRepair: 12, tags: ['REPAIR'] as const,
  }),
  DRAIN: Object.freeze({
    row: 'HIGH', family: 'EWAR', cpu: 18, grid: 14, cap: 14,
    drain: 120, reach: 1, tags: ['EWAR'] as const,
  }),
  COMMAND_BURST: Object.freeze({
    row: 'HIGH', family: 'COMMAND', cpu: 30, grid: 24, cap: 18,
    command: 1, exclusive: 'COMMAND', tags: ['COMMAND'] as const,
  }),

  // ── MID ───────────────────────────────────────────────────────────────────
  SHIELD_EXTENDER: Object.freeze({
    row: 'MID', family: 'TANK_BUFFER', cpu: 22, grid: 30,
    shield: 1_400, signatureBps: 2_500,
  }),
  SHIELD_BOOSTER: Object.freeze({
    row: 'MID', family: 'TANK_ACTIVE', cpu: 18, grid: 22, cap: 26,
    localRepair: 15,
  }),
  POINT: Object.freeze({
    row: 'MID', family: 'TACKLE', cpu: 12, grid: 6, cap: 8,
    tackle: 1, reach: 3, tags: ['TACKLE'] as const,
  }),
  SCRAM: Object.freeze({
    row: 'MID', family: 'TACKLE', cpu: 14, grid: 8, cap: 12,
    tackle: 2, reach: 1, scrams: true, tags: ['TACKLE'] as const,
  }),
  WEB: Object.freeze({
    row: 'MID', family: 'EWAR', cpu: 10, grid: 4, cap: 10,
    webBps: 6_000, reach: 1, tags: ['EWAR'] as const,
  }),
  DAMP: Object.freeze({
    row: 'MID', family: 'EWAR', cpu: 20, grid: 8, cap: 14,
    damp: 1, reach: 3, tags: ['EWAR'] as const,
  }),
  PAINT: Object.freeze({
    row: 'MID', family: 'APPLICATION', cpu: 14, grid: 6, cap: 8,
    paintBps: 3_000, reach: 3, tags: ['EWAR'] as const,
  }),
  MWD: Object.freeze({
    row: 'MID', family: 'PROPULSION', cpu: 20, grid: 40, cap: 24,
    mobility: 5, signatureBps: 4_500, exclusive: 'PROPULSION',
  }),
  AFTERBURNER: Object.freeze({
    row: 'MID', family: 'PROPULSION', cpu: 12, grid: 16, cap: 10,
    mobility: 2, exclusive: 'PROPULSION',
  }),
  CAP_BATTERY: Object.freeze({
    row: 'MID', family: 'CAPACITOR', cpu: 8, grid: 12,
    cap_capacity: 400, drainResistBps: 5_000,
  }),
  SENSOR_BOOSTER: Object.freeze({
    row: 'MID', family: 'APPLICATION', cpu: 16, grid: 8, cap: 6,
    damp: -1, reach: 1,
  }),

  // ── LOW ───────────────────────────────────────────────────────────────────
  PLATE: Object.freeze({
    row: 'LOW', family: 'TANK_BUFFER', cpu: 6, grid: 30,
    armor: 1_800, mobility: -2,
  }),
  ARMOR_REPAIRER: Object.freeze({
    row: 'LOW', family: 'TANK_ACTIVE', cpu: 14, grid: 34, cap: 30,
    localRepair: 13,
  }),
  DAMAGE_MOD: Object.freeze({
    row: 'LOW', family: 'DAMAGE', cpu: 20, grid: 8,
    alphaBps: 1_200,
  }),
  TRACKING_MOD: Object.freeze({
    row: 'LOW', family: 'APPLICATION', cpu: 14, grid: 4,
    trackingBps: 1_500,
  }),
  CAP_RELAY: Object.freeze({
    row: 'LOW', family: 'CAPACITOR', cpu: 10, grid: 6,
    capRegenBps: 1_800,
  }),
  NANO: Object.freeze({
    row: 'LOW', family: 'PROPULSION', cpu: 12, grid: 10,
    mobility: 2, bufferBps: -800,
  }),
  COPROCESSOR: Object.freeze({
    row: 'LOW', family: 'FITTING', cpu: 0, grid: 8,
    cpuBonus: 18,
  }),
  REACTOR: Object.freeze({
    row: 'LOW', family: 'FITTING', cpu: 8, grid: 0,
    gridBonus: 45,
  }),

  // ── RIG ───────────────────────────────────────────────────────────────────
  RIG_TANK: Object.freeze({
    row: 'RIG', family: 'TANK_BUFFER', cpu: 0, grid: 0, calibration: 2,
    bufferBps: 1_200, mobility: -1,
  }),
  RIG_GUN: Object.freeze({
    row: 'RIG', family: 'DAMAGE', cpu: 0, grid: 0, calibration: 2,
    alphaBps: 1_000, capRegenBps: -800,
  }),
  RIG_TACKLE: Object.freeze({
    row: 'RIG', family: 'TACKLE', cpu: 0, grid: 0, calibration: 2,
    reach: 1, bufferBps: -600,
  }),
  RIG_CAP: Object.freeze({
    row: 'RIG', family: 'CAPACITOR', cpu: 0, grid: 0, calibration: 2,
    cap_capacity: 300, alphaBps: -500,
  }),
});

// ── Hulls ───────────────────────────────────────────────────────────────────

export interface HullSpec {
  /** 1..5. Decides which weapons fit and how badly large guns track it. */
  readonly size: number;
  readonly slots: Readonly<Record<SlotRow, number>>;
  readonly cpu: number;
  readonly grid: number;
  readonly calibration: number;
  readonly hardpoints: number;
  /** The last layer. Never zero, so a hull is never destroyed by rounding. */
  readonly structure: number;
  readonly shield: number;
  readonly armor: number;
  /** Base signature. What weapons apply against. */
  readonly signature: number;
  /** Base mobility. What the range race and the tracking term are fought with. */
  readonly mobility: number;
  readonly capacitor: number;
  readonly capRegen: number;
  /** Command channels the hull itself provides. */
  readonly command: number;
  /**
   * The one family this hull is *for*, and what it adds, in bps.
   *
   * §3 MUST-10: *"KEEP strong role bonuses... CUT trap hulls with bonuses no viable fit uses."*
   * Every bonus below is on a family the hull has the slots to actually fit.
   */
  readonly bonus: Readonly<{ family: ModuleFamily; bps: number }>;
  /** What it costs to build, in the two goods. */
  readonly costFrame: number;
  readonly costFuel: number;
}

/**
 * Five hulls, one per size band, each with a different answer to the same question.
 *
 * §3 MUST-1..MUST-5 in five rows. The size ladder is *not* a power ladder and the numbers are set
 * so a reader can check that: a CITADEL costs 16× a PIKE and cannot hit it. What each is for:
 *
 * - **PIKE** — the cheap ship that decides which expensive one leaves. `TACKLE` bonus, tiny
 *   signature, highest mobility, two hardpoints. §3 MUST-1's *"best answer to how can a new agent
 *   matter immediately"*.
 * - **LANCE** — anti-small and the world's own hull. Four hardpoints on a fragile frame: it deletes
 *   a screen and dies to anything that catches it.
 * - **WARDEN** — the compositional backbone and the only hull with the CPU for `REMOTE_REPAIR`
 *   plus a real tank. §3 MUST-2's *"default doctrine chassis"*.
 * - **BULWARK** — the command platform. Its `EWAR` bonus and its command channel are both things
 *   that stop working when it dies, which is §8 MUST-4's requirement.
 * - **CITADEL** — the heavy line. Enormous alpha it cannot apply without help, which is the whole
 *   argument for combined arms and the reason §3 MUST-5 says *"unsupported battleships are
 *   tackled, neuted, bombed, or orbited by cheap ships."*
 */
export const HULLS: Readonly<Record<string, HullSpec>> = Object.freeze({
  PIKE: Object.freeze({
    size: 1,
    slots: Object.freeze({ HIGH: 2, MID: 3, LOW: 2, RIG: 1 }),
    // §3 MUST-10: *"CUT trap hulls with bonuses no viable fit uses."* These numbers were set by
    // hand first and every one of the five hulls came out unable to fit its own doctrine — the PIKE
    // could not carry a gun, a point and a propulsion module at once, which made the TACKLE bonus
    // decoration. Recalibrated against eleven named archetypes in `test/combat/fit.spec.ts`, each of
    // which now lands between 89% and 100% of at least one of CPU and grid. That tightness is the
    // fitting puzzle; the earlier looseness was not "hard", it was empty.
    cpu: 44, grid: 36, calibration: 3, hardpoints: 2,
    structure: 150, shield: 150, armor: 100,
    signature: 40, mobility: 9, capacitor: 300, capRegen: 30, command: 0,
    bonus: Object.freeze({ family: 'TACKLE', bps: 5_000 }),
    costFrame: 400, costFuel: 20,
  }),
  LANCE: Object.freeze({
    size: 2,
    slots: Object.freeze({ HIGH: 4, MID: 3, LOW: 2, RIG: 1 }),
    cpu: 74, grid: 76, calibration: 3, hardpoints: 4,
    structure: 260, shield: 260, armor: 180,
    signature: 70, mobility: 7, capacitor: 400, capRegen: 34, command: 0,
    bonus: Object.freeze({ family: 'WEAPON', bps: 3_000 }),
    costFrame: 700, costFuel: 40,
  }),
  WARDEN: Object.freeze({
    size: 3,
    slots: Object.freeze({ HIGH: 3, MID: 4, LOW: 4, RIG: 2 }),
    cpu: 180, grid: 190, calibration: 4, hardpoints: 3,
    structure: 600, shield: 600, armor: 400,
    signature: 130, mobility: 5, capacitor: 900, capRegen: 60, command: 0,
    bonus: Object.freeze({ family: 'REPAIR', bps: 5_000 }),
    costFrame: 1_500, costFuel: 90,
  }),
  BULWARK: Object.freeze({
    size: 4,
    slots: Object.freeze({ HIGH: 5, MID: 4, LOW: 5, RIG: 2 }),
    cpu: 250, grid: 260, calibration: 4, hardpoints: 5,
    structure: 1_200, shield: 1_100, armor: 900,
    signature: 230, mobility: 3, capacitor: 1_400, capRegen: 80, command: 1,
    bonus: Object.freeze({ family: 'EWAR', bps: 5_000 }),
    costFrame: 3_000, costFuel: 200,
  }),
  CITADEL: Object.freeze({
    size: 5,
    slots: Object.freeze({ HIGH: 6, MID: 5, LOW: 6, RIG: 2 }),
    cpu: 250, grid: 700, calibration: 4, hardpoints: 6,
    structure: 2_400, shield: 2_200, armor: 1_800,
    signature: 400, mobility: 2, capacitor: 2_200, capRegen: 110, command: 0,
    bonus: Object.freeze({ family: 'DAMAGE', bps: 5_000 }),
    costFrame: 6_400, costFuel: 450,
  }),
});

/** Every hull name, in canonical order. The order a menu is built in. */
export const HULL_NAMES: readonly string[] = Object.freeze(
  Object.keys(HULLS).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
);

/** Every module name, in canonical order. */
export const MODULE_NAMES: readonly string[] = Object.freeze(
  Object.keys(MODULES).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
);

/** Own-property lookup, never a bare index — `commons.ts`'s `declaredClass` argument verbatim. */
export function hullSpec(name: string): HullSpec | undefined {
  return Object.prototype.hasOwnProperty.call(HULLS, name) ? HULLS[name] : undefined;
}

/** Own-property lookup. `MODULES['constructor']` would otherwise return a function. */
export function moduleSpec(name: string): ModuleSpec | undefined {
  return Object.prototype.hasOwnProperty.call(MODULES, name) ? MODULES[name] : undefined;
}

/** Own-property lookup. */
export function weaponProfile(name: string): WeaponProfile | undefined {
  return Object.prototype.hasOwnProperty.call(WEAPONS, name) ? WEAPONS[name] : undefined;
}

/** Every damage type a profile mentions, so the resist walk is total. */
export function damageTypesOf(): readonly DamageType[] {
  return ['KINETIC', 'THERMAL', 'EXPLOSIVE', 'EM'];
}
