/**
 * Every published number the ENGAGEMENT runs on, and the schedule assertion that proves they fit.
 *
 * ── A2 IS WHY THIS FILE IS LONG ──────────────────────────────────────────────
 *
 * *"Known arithmetic is exact and machine-readable... Never make an agent need a wiki."* Every
 * constant here is reachable from an agent's observation, and the ones an agent must reason about
 * ({@link RANGE_FACTOR}, {@link STACK_PENALTY_BPS}, {@link WORLD_FLEET}) are published verbatim in
 * the refusal and affordance text. A combat system whose numbers live only in the resolver is a
 * combat system that requires a wiki, and `PASS-SHIPS-COMBAT-extended` §13 names that as one of the
 * mechanics *"actively bad for an agent game"*: **"opaque formulas and stacking-penalty
 * memorization"**.
 *
 * ── THE ONE NUMBER THAT DECIDES WHETHER ANY OF THIS RENDERS ──────────────────
 *
 * {@link ENGAGEMENT_PHASE_TICKS} sums to 22 and the demand window is
 * `DEMAND_WINDOW_TICKS = 24`. That is not a coincidence and it is asserted, not hoped:
 * **an engagement must finish inside the standoff that opened it**, or a raid resolves while its
 * battle is still running and the force reading counts hands that a wreck had already taken off
 * the board. {@link assertEngagementSchedule} is called from `Runtime`'s constructor for the same
 * reason `assertRaidSchedule` is — a schedule that only a test checks is a schedule that ships
 * broken the first time someone tunes a phase.
 */

import { qty, type Bps, type Minor, type Qty } from '../core/units.js';
import type { GoodId } from '../core/types.js';
import { TICKS_PER_RECKONING } from '../core/time.js';
import { DEMAND_WINDOW_TICKS, MAX_RAID_PARTIES } from '../predation/params.js';
import { FUEL_GOOD, WORKS_GOOD } from '../works/params.js';

// ── The clock ───────────────────────────────────────────────────────────────

/**
 * How long each of the five states lasts, in ticks. *(calibrate)*
 *
 * `PASS-SHIPS-COMBAT-extended` §2 MUST-1: *"Muster → Contact → Contest → Break/Pursuit →
 * Aftermath"*, and its reason for five rather than one is *"commitment, reinforcement, target
 * calling, counter-escalation, and the decision to stay or flee remain separate dramatic
 * moments"*.
 *
 * The shape of the budget is the design:
 *
 * - **MUSTER 6** — the only window in which a hull may be committed. Long enough that an agent on
 *   a 16-wake day can actually reach it; short enough that a defender cannot stall a raid out.
 * - **CONTACT 1** — the lines meet at `GAP_AT_CONTACT`. No fire. This tick exists so that
 *   *"first contact"* is a frame of its own, and so an agent gets one observation of the enemy's
 *   revealed composition before any damage is taken.
 * - **CONTEST 12** — the fight. 12 ticks × {@link SLICES_PER_TICK} = 96 resolution slices, which
 *   is where the range race, tackle, repair and capacitor actually play out against each other.
 * - **BREAK 2** — pursuit. Anything still pinned takes fire with no repair coverage; anything free
 *   has left. This is the state in which the losing side's losses are decided, which is §7 MUST-5's
 *   *"a disengagement should save some assets and abandon others"*.
 * - **AFTERMATH 1** — wrecks are written, the seed is revealed, field control is published.
 */
export const ENGAGEMENT_PHASE_TICKS = Object.freeze({
  MUSTER: 6,
  CONTACT: 1,
  CONTEST: 12,
  BREAK: 2,
  AFTERMATH: 1,
});

/**
 * How many deterministic resolution slices run per tick.
 *
 * §7 MUST-2: *"SIMPLIFY real seconds to 6–12 fixed slices per combat tick; CUT model calls inside
 * slices"*. Eight, because eight is the length of the causal chain the pass enumerates and every
 * one of the eight is load-bearing — dropping any one of them collapses a counter. A number an
 * agent can hold in its head is also a number it can reason about: *"my capacitor lasts 40 slices,
 * so I am dry five ticks in."*
 */
export const SLICES_PER_TICK = 8;

/** Total ticks from MUSTER to the end of AFTERMATH. */
export const ENGAGEMENT_TICKS =
  ENGAGEMENT_PHASE_TICKS.MUSTER +
  ENGAGEMENT_PHASE_TICKS.CONTACT +
  ENGAGEMENT_PHASE_TICKS.CONTEST +
  ENGAGEMENT_PHASE_TICKS.BREAK +
  ENGAGEMENT_PHASE_TICKS.AFTERMATH;

// ── Topology ────────────────────────────────────────────────────────────────

/**
 * The five RANGE cells, nearest first. Index *is* the meaning.
 *
 * §7 MUST-1 asks for `front: left|center|right` × `depth: screen|main|support|reserve` × five
 * range cells. **One of those three axes is deliberately not built**, and saying which, and why,
 * is more useful than shipping a third of each:
 *
 * The lateral axis (`front`) appears in **none** of the five relationships §12 says to protect if
 * schedule forces a choice — fitting, application, tackle, force multipliers, doctrines. ECHELON
 * appears in two of them, because coverage and reach are what make a force multiplier attackable.
 * And `front` is a §3 collision besides: §10.1's *"a scheduled front destroys located goods"*
 * already spends that word on the weather. So: **one positional axis (ECHELON), one contested
 * scalar (the gap), and RANGE derived from both.** Flanking is the named deferral.
 */
export const RANGE_CELLS = Object.freeze(['CONTACT', 'CLOSE', 'MID', 'LONG', 'EXTREME'] as const);

export type RangeCell = (typeof RANGE_CELLS)[number];

/** The gap the two lines stand at when CONTACT opens. `LONG` — nobody starts in each other's face. */
export const GAP_AT_CONTACT = 3;

/** The widest the gap can be pushed. A kiting side that reaches this has broken off, not won. */
export const GAP_MAX = 4;

/**
 * How far behind its own line each ECHELON stands, in range cells.
 *
 * A formation's contribution to the pair distance. `RESERVE` is not on the board at all —
 * {@link RESERVE_ECHELON} — and the other three are one cell apart, which is what makes
 * *"the bombers went for the support wing"* and *"the screen held"* different sentences.
 */
export const ECHELON_DEPTH = Object.freeze({ SCREEN: 0, MAIN: 1, SUPPORT: 2, RESERVE: 3 });

/** The echelon that is held back. Fires nothing, is hit by nothing, counts for nothing. */
export const RESERVE_ECHELON = 'RESERVE';

// ── The stacking curve ──────────────────────────────────────────────────────

/**
 * What the *n*th module affecting one attribute actually contributes, in bps.
 *
 * §1 MUST-7: *"KEEP derived diminishing returns... SIMPLIFY to a published curve shared across
 * systems; CUT memorization. Every simulation and observation reports `nominal_effect`,
 * `effective_effect`, `stack_rank`, and `marginal_effect_if_added`."*
 *
 * One curve, used by every stacked effect in the engine, integer bps so it never touches a float
 * (DET-7). Index 0 is the first module. Past the end the contribution is **zero** rather than a
 * rounding artefact — a seventh damage module is not a small gain, it is no gain, and an agent
 * that is told `marginal_if_added: 0` will spend the low slot on something else.
 */
export const STACK_PENALTY_BPS: readonly Bps[] = Object.freeze([
  10_000, 8_691, 5_706, 2_830, 1_060, 300,
] as unknown as Bps[]);

// ── Application ─────────────────────────────────────────────────────────────

/**
 * How well each weapon family projects at each {@link RANGE_CELLS} index, in bps.
 *
 * §4 MUST-2 and MUST-3 in one table. *"KEEP the monotonic relationships and continuous curves;
 * SIMPLIFY raw transversal to server-derived `relative_motion`... CUT expecting the agent to
 * calculate radians or undocumented exponents."*
 *
 * The three rows are the three tactical identities and they are deliberately non-overlapping:
 *
 * - `SMALL_GUN` is lethal at CONTACT and irrelevant past MID. It cannot be kited by anything it
 *   can catch, and it is the only weapon a hull with two hardpoints can afford to bring.
 * - `LARGE_GUN` is the reverse — weak in your face, dominant at MID and LONG. This single row is
 *   why a battleship needs a screen: at CONTACT it is doing 30% of its paper number.
 * - `MISSILE` is flat and forgiving over CLOSE..MID and pays for it in the signature term, which
 *   is where {@link WEAPONS} `explosion` does the work. A missile boat does not care about the
 *   range race and cares enormously about whether the target is small.
 *
 * **A weapon at 0 is not firing.** That is what makes EXTREME a real place to stand.
 */
export const RANGE_FACTOR: Readonly<Record<string, readonly number[]>> = Object.freeze({
  SMALL_GUN: Object.freeze([10_000, 10_000, 4_000, 500, 0]),
  LARGE_GUN: Object.freeze([3_000, 6_000, 10_000, 8_000, 3_000]),
  MISSILE: Object.freeze([8_000, 10_000, 10_000, 7_000, 2_000]),
});

/**
 * The four damage types, and the fact that makes them worth having.
 *
 * §4 MUST-1: *"Four damage types, four resistance profiles, and ammunition choice"*, whose value is
 * *"the best ammunition depends on the target, so a fleet's damage choice is intelligence-driven"*.
 * Kept in full rather than reduced to one number, because it costs fifteen lines and it is the
 * reason a scan is worth paying for: a tank has a **hole**, and finding it is what intel buys.
 */
export const DAMAGE_TYPES = Object.freeze(['KINETIC', 'THERMAL', 'EXPLOSIVE', 'EM'] as const);

export type DamageType = (typeof DAMAGE_TYPES)[number];

/** A damage or resist profile: bps per type. A damage profile sums to 10,000; a resist does not. */
export type TypeProfile = Readonly<Record<DamageType, number>>;

/**
 * What each tank layer resists, in bps, before modules.
 *
 * EVE's actual shape and the reason the three layers are not interchangeable: shields are strong
 * against EM's opposite and weak to EM, armour is the mirror. A fleet that brings one damage type
 * hands the enemy a fitting answer; a fleet that brings two cannot be answered by one hardener.
 */
export const LAYER_RESIST: Readonly<Record<'SHIELD' | 'ARMOR' | 'STRUCTURE', TypeProfile>> = Object.freeze({
  SHIELD: Object.freeze({ KINETIC: 4_000, THERMAL: 2_000, EXPLOSIVE: 5_000, EM: 0 }),
  ARMOR: Object.freeze({ KINETIC: 2_500, THERMAL: 3_500, EXPLOSIVE: 1_000, EM: 5_000 }),
  STRUCTURE: Object.freeze({ KINETIC: 0, THERMAL: 0, EXPLOSIVE: 0, EM: 0 }),
});

// ── The seeded residual ─────────────────────────────────────────────────────

/**
 * The band a volley's applied damage lands in, in bps of the computed figure.
 *
 * §2 MUST-5: *"KEEP uncertainty; SIMPLIFY millions of rolls into stable cohort distributions; CUT
 * all-or-nothing per-cycle dice where it erases agency."* ±8% is small on purpose. It is wide
 * enough that two identical fleets do not produce a foregone conclusion, and narrow enough that
 * **composition always beats luck** — a side with a 30% application advantage cannot be reversed
 * by the draw, which is what makes a forecast worth reading and a fit worth theorising about.
 */
export const VOLLEY_BAND_BPS = Object.freeze({ min: 9_200, max: 10_800 });

// ── Tackle ──────────────────────────────────────────────────────────────────

/**
 * How much tackle strength one formation must be under before it cannot leave.
 *
 * §12 relationship #3: *"points, scrams, webs, bubbles... let cheap specialists decide which
 * expensive assets leave. Without this, agents rationally disengage and the insurance/claims game
 * starves."* One point holds one formation, and that is the entire economics of a PIKE.
 */
export const PIN_THRESHOLD = 1;

// ── Capacitor ───────────────────────────────────────────────────────────────

/**
 * The order modules shut down in when the capacitor cannot pay for them all.
 *
 * §1 MUST-3: *"A ship can be almost undamaged but operationally dead, and one MWD cycle can steal
 * the repair or tackle cycle that mattered."* Published rather than chosen per fit, because a
 * per-fit priority list is a fifth policy field on an order that already has four and it buys one
 * decision an agent makes once. What it costs to state it here instead: a fit that wants its guns
 * to die before its tackle cannot say so. Named deferral.
 *
 * Weapons are shed **first** and tackle **last**, which is the opposite of the intuitive order and
 * is the correct one: a formation that has lost its guns is a formation that still decides who
 * leaves the field, and a formation that has lost its point has stopped mattering entirely.
 */
export const CAP_SHUTDOWN_ORDER: readonly string[] = Object.freeze([
  'WEAPON',
  'PROPULSION',
  'EWAR',
  'REPAIR',
  'TACKLE',
]);

// ── Command ─────────────────────────────────────────────────────────────────

/** What a live command aura adds to application and repair, in bps, for friends it covers. */
export const COMMAND_BONUS_BPS = 800;

/** How many echelons either side of its own a command formation covers. */
export const COMMAND_REACH = 1;

// ── Repair ──────────────────────────────────────────────────────────────────

/** How many echelons a remote repair module reaches. Support behind main is inside it; reserve is not. */
export const REPAIR_REACH = 1;

// ── Building a hull ─────────────────────────────────────────────────────────

/**
 * The two goods a hull is built from, and **why one of them is the Frontier good**.
 *
 * `D23`'s first-ranked missing thing was *"comparative advantage — one good some agents need and
 * cannot make"*, and `works/params.ts` landed it: {@link FUEL_GOOD} is produced only at FRONTIER
 * systems. Its author's note says what fuel buys is *"territorial income — which nothing else in
 * the game is a precondition of"*.
 *
 * **A hull is the second thing, and it is the one that gives territory a military reason.** You
 * cannot build a warship out of Commons production. That single line does four things at once: it
 * gives fuel a demand curve that is not a tax, it gives a Frontier claim a reason that D23 called
 * *"ANTI-load-bearing"* for want of one, it makes war a production problem rather than a
 * willingness problem, and it means a fleet is a thing somebody hauled.
 *
 * **And it introduces no deadlock**, which is the trap `works/params.ts` documents at length. The
 * road to fuel is priced in `graduate` (currency + {@link WORKS_GOOD}) and a WORKS
 * ({@link WORKS_GOOD} again). Nothing on that road needs a hull, and nothing but a hull needs
 * a hull — combat is the only thing in this game that is optional all the way down.
 */
export const HULL_COST_GOODS: Readonly<Record<'frame' | 'fuel', GoodId>> = Object.freeze({
  frame: WORKS_GOOD,
  fuel: FUEL_GOOD,
});

/** How many ticks after `build` a hull is ready to be committed. *(calibrate)* */
export const HULL_FIT_TICKS = 4;

// ── Bounds, because an unbounded array inside `state_hash` is scar #3 ────────

/** Hulls one principal may hold at once. Caps the book, and caps a fleet nobody could pay for. */
export const MAX_HULLS_PER_PRINCIPAL = 6;

/** Formations one side may field in one engagement. */
export const MAX_FORMATIONS_PER_SIDE = 6;

/** Live engagements at once, world-wide. Bounds the tick's combat work (§7 SHOULD-3). */
export const MAX_LIVE_ENGAGEMENTS = 4;

/** Rows the engagement book retains before `prune` drops the settled ones. */
export const MAX_ENGAGEMENT_ROWS = 64;

/** Modules one fit may carry, across all four rows. Bounds `fitHash` input and the simulator. */
export const MAX_MODULES_PER_FIT = 20;

/** Wreck marks one engagement publishes. A battle that destroyed more says so in the count. */
export const MAX_WRECKS_PER_ENGAGEMENT = 24;

/** Trace entries one engagement keeps for its explanation. The causal record, bounded. */
export const MAX_TRACE_ENTRIES = 48;

/**
 * How long after it ends a battle still draws on **THE BATTLE LINE**.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **A RECKONING, BECAUSE THE PUBLISHED FRAME IS A DAILY DIGEST AND A BATTLE IS 22 TICKS OF 288.**
 *
 * This was two ticks, and at two ticks A13 was false for the whole layer: `runtime.reckoningFrame()`
 * is written at the settlement tick, an engagement runs at most {@link ENGAGEMENT_TICKS}, and the odds
 * that one of them is inside a two-tick window at settlement are about 8%. Measured on seed `fz-13`:
 * a battle that destroyed three hulls and held the field appeared on **no** published frame, and the
 * day it was fought served `battleLines: []`.
 *
 * A Reckoning is the same window the tribute lines and the claim lines are drawn over, so the three
 * signatures on one frame now describe one day rather than one day and two instants. Bounded twice
 * over regardless: `Book.prune` drops resolved rows once the book is over half full, and the caller's
 * `limit` ({@link import('../frames/contract.js').MAX_FRAME_BATTLE_LINES}) truncates the list.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const BATTLE_LINE_RETAIN_TICKS = TICKS_PER_RECKONING;

/**
 * How long `Book.prune` must keep a **resolved** engagement row before dropping it.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE LONGER OF THE TWO READERS THAT OUTLIVE A BATTLE, BECAUSE IT WAS SHORTER THAN BOTH.**
 *
 * `prune`'s cutoff was `AFTERMATH + 1` = **two ticks**, and two readers need more:
 *
 *   - {@link BATTLE_LINE_RETAIN_TICKS} = 288, the Reckoning window the frame draws over. At two
 *     ticks that constant was a decoration: `battleLinesFor` filtered rows the book had deleted.
 *   - `readForce`'s {@link import('./battle.js').worldForceLeft}, asked at the **raid's** resolution.
 *     A standoff answered FIGHT on its spawn tick closes its battle at spawn + {@link
 *     ENGAGEMENT_TICKS} and resolves at spawn + `DEMAND_WINDOW_TICKS` — so the row is exactly
 *     `DEMAND_WINDOW_TICKS - ENGAGEMENT_TICKS` ticks old when the number is read, which at the
 *     shipped clock is **2** and lands on the old cutoff exactly. A dropped row reads as *"nothing
 *     is counting"*, the drawn scalar stands, and the defender that destroyed the world's whole
 *     fleet loses the standoff — the very defect `worldForceLeft` exists to fix, reintroduced by a
 *     retention policy, on production worlds only, once the book is half full.
 *
 * A `max` rather than a hand-picked number so that tuning either reader cannot silently outrun it,
 * and {@link assertEngagementSchedule} refuses a build where it does. It costs nothing: at
 * `MAX_LIVE_ENGAGEMENTS` = 4 and three raids a Reckoning, the rows inside this window are single
 * digits against a {@link MAX_ENGAGEMENT_ROWS} of 64.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const ENGAGEMENT_RETAIN_TICKS = Math.max(BATTLE_LINE_RETAIN_TICKS, DEMAND_WINDOW_TICKS);

// ── The world's fleet ───────────────────────────────────────────────────────

/**
 * What a world-spawned raid brings, and **the reason this constant is the most important one here.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A14: *"Never ship a mechanic whose drama depends on agents choosing conflict — they won't;
 * silence is their rational default."* Every combat system ever designed for an autonomous cast
 * fails here first, and the failure is invisible: the code works, the tests pass, and the sim
 * shows zero battles because fighting is never the best move for anybody.
 *
 * §9 already solved it for predation — *"each Reckoning the world spawns N raids, aimed by
 * published rule at the most exposed. Nobody owns them, so nobody can be bribed to call them
 * off."* So the engagement layer attaches to **that**, not to an agent's willingness: a world raid
 * arrives at ticks 48, 120 and 192 of every Reckoning, and if the target answers FIGHT there is a
 * battle whether or not any agent ever chose one.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The world's fit is **public**, unlike an agent's. Two reasons, and the second is the one that
 * matters: the world is not a principal, so it has no strategy §11.2 protects — and A2 requires
 * that a defender can compute what it is facing *exactly*, because the whole point of the world
 * raid is that it is weather. You do not get to be surprised by a storm's composition; you get to
 * be caught out of position by it.
 *
 * One `LANCE` per point of `raid.force`, on {@link WORLD_FLEET_FIT}. `force` is drawn from
 * `RAID_FORCE` = 2..5, so the world brings 2–5 destroyers: enough to wreck an unescorted hauler,
 * losable by a competent two-hull defence, and never enough to make defending pointless.
 */
export const WORLD_FLEET = Object.freeze({
  hull: 'LANCE',
  hullsPerForce: 1,
  echelon: 'MAIN',
  posture: 'CLOSE',
});

/**
 * The published fit the world's hulls fly. Pinned by test, because a rules surface that drifts is
 * scar #1 — and **calibrated by playing it**, which is the part worth recording.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * The first version carried three guns and a PLATE, and the sim was unambiguous: a six-PIKE swarm
 * costing 2,400 in goods lost **six hulls to nothing** against a three-hull world raid, twice. The
 * arithmetic said why — the plate put the world at 2,500 EHP per hull against the PIKE's 400, and
 * three guns put it at 1,053 alpha against 540 — so the world brought triple the buffer and double
 * the output, for free, every time.
 *
 * A world raid that always wins is not weather, it is a tax with a red arc on it: nobody would ever
 * answer FIGHT, every answer would be YIELD, and the whole engagement layer would sit unreachable
 * behind a rational refusal. That is §9's toll-cartel failure arriving from the defender's side, and
 * it is exactly the shape A13 calls having no pixel signature — a mechanic that renders identically
 * to surrender.
 *
 * So: **no plate, two guns.** At force 3 the world brings 2,100 EHP and 702 alpha, against a
 * three-PIKE tackle wing's 1,200 EHP and 270 — still favoured, and now *losable* once the defender
 * brings a repair wing or webs the world's own mobility down. The world keeps its POINT and its WEB,
 * which is assertWorldFleet's requirement and the reason a defender cannot simply walk away.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const WORLD_FLEET_FIT: readonly string[] = Object.freeze([
  'SMALL_GUN',
  'SMALL_GUN',
  'POINT',
  'WEB',
  'AFTERBURNER',
]);

// ── Loss valuation ──────────────────────────────────────────────────────────

/**
 * What a wrecked hull is recorded as worth, per unit of its build cost in goods.
 *
 * A5 requires loss to be *priceable*, and §7 MUST-9 wants a `loss_record` carrying *"estimated and
 * market value"*. Valuing a wreck at its build cost in the frame good, times this, is the
 * conservative choice and it is deliberately **not** a market lookup: §10.3 names last-trade
 * marking as *"the game's single most dangerous exploit"*, and a loss figure that two principals
 * could inflate by self-matching would put a printed number on a permanent public record.
 */
export const WRECK_VALUE_PER_GOOD: Minor = 1 as Minor;

export class EngagementScheduleError extends Error {}

/**
 * Prove the clock fits inside the standoff that opens it — at construction, not in a test.
 *
 * `assertRaidSchedule`'s shape verbatim: collect every problem, throw one aggregated error. A
 * schedule only a test checks is a schedule that ships broken the first time a phase is tuned, and
 * this particular breakage is silent: an engagement that outlives its raid means the raid's force
 * reading counts hands whose hulls are already wrecks.
 */
export function assertEngagementSchedule(): void {
  const problems: string[] = [];

  if (ENGAGEMENT_TICKS > DEMAND_WINDOW_TICKS) {
    problems.push(
      `the engagement clock is ${String(ENGAGEMENT_TICKS)} ticks and the demand window is ` +
        `${String(DEMAND_WINDOW_TICKS)}. An engagement must finish inside the standoff that opened it, or ` +
        `the raid resolves while the battle is still running and readForce counts hands a wreck has ` +
        `already taken off the board.`,
    );
  }
  if (ENGAGEMENT_PHASE_TICKS.MUSTER < 1) {
    problems.push('MUSTER must be at least 1 tick, or no hull can ever be committed.');
  }
  if (ENGAGEMENT_PHASE_TICKS.CONTEST < 1) {
    problems.push('CONTEST must be at least 1 tick, or nothing is ever resolved.');
  }
  if (SLICES_PER_TICK < 6 || SLICES_PER_TICK > 12) {
    problems.push(
      `SLICES_PER_TICK is ${String(SLICES_PER_TICK)}; §7 MUST-2 specifies 6–12 fixed slices per combat tick.`,
    );
  }
  if (GAP_AT_CONTACT > GAP_MAX) {
    problems.push(`the lines cannot meet at gap ${String(GAP_AT_CONTACT)} when the maximum is ${String(GAP_MAX)}.`);
  }
  if (STACK_PENALTY_BPS[0] !== 10_000) {
    problems.push('the first module of a stack must contribute its full effect, or every fit is silently nerfed.');
  }
  for (const [family, row] of Object.entries(RANGE_FACTOR)) {
    if (row.length !== RANGE_CELLS.length) {
      problems.push(
        `RANGE_FACTOR.${family} has ${String(row.length)} cells and there are ${String(RANGE_CELLS.length)} ` +
          `range cells. A weapon with no factor at a cell would apply at whatever undefined coerces to.`,
      );
    }
  }
  for (const type of DAMAGE_TYPES) {
    for (const [layer, profile] of Object.entries(LAYER_RESIST)) {
      const value = profile[type];
      if (value < 0 || value >= 10_000) {
        problems.push(`LAYER_RESIST.${layer}.${type} is ${String(value)}; a resist must be in [0, 10000).`);
      }
    }
  }
  // ── THE TWO READERS THAT OUTLIVE A RESOLVED BATTLE ─────────────────────────
  //
  // Both were silently broken by a two-tick prune (see ENGAGEMENT_RETAIN_TICKS). Asserted here
  // rather than left to `book.ts`, because a retention window is exactly the kind of constant a
  // later tuning pass lowers for a good reason without knowing what reads through it.
  if (ENGAGEMENT_RETAIN_TICKS < BATTLE_LINE_RETAIN_TICKS) {
    problems.push(
      `resolved engagements are kept for ${String(ENGAGEMENT_RETAIN_TICKS)} ticks and THE BATTLE LINE is ` +
        `drawn over ${String(BATTLE_LINE_RETAIN_TICKS)}. The frame would filter rows the book had already ` +
        `deleted, which is A13 false for combat with a retention policy in front of it.`,
    );
  }
  if (ENGAGEMENT_RETAIN_TICKS < DEMAND_WINDOW_TICKS) {
    problems.push(
      `resolved engagements are kept for ${String(ENGAGEMENT_RETAIN_TICKS)} ticks and a standoff lives for ` +
        `${String(DEMAND_WINDOW_TICKS)}. readForce asks worldForceLeft at the RAID's resolution, so a row ` +
        `dropped first reads as "nothing is counting" and the raid's spawn scalar stands — the defender that ` +
        `destroyed the world's whole fleet loses the standoff anyway, which is the defect worldForceLeft exists ` +
        `to fix arriving through the prune.`,
    );
  }
  // ── THE TWO CAPS MUST NOT DISAGREE ABOUT HOW BIG A BATTLE CAN BE ───────────
  //
  // Formations coalesce per principal, so filling both sides' formation slots takes the initiator +
  // (n-1) raider joiners and (n-1) defender joiners — the target is a party by *being* the target.
  // If `MAX_RAID_PARTIES` is below that, the standoff fills before the field does and formation slots
  // `engage` offers cannot be reached at all: a capability that exists and cannot be exercised, which
  // is indistinguishable from a missing one. Measured at the old 8 against 6 formations a side.
  const partiesToFillBothSides = 2 * MAX_FORMATIONS_PER_SIDE - 1;
  if (MAX_RAID_PARTIES < partiesToFillBothSides) {
    problems.push(
      `MAX_RAID_PARTIES is ${String(MAX_RAID_PARTIES)} and filling ${String(MAX_FORMATIONS_PER_SIDE)} formations ` +
        `on both sides takes ${String(partiesToFillBothSides)} parties. The standoff would fill before the field ` +
        `does, so ${String(partiesToFillBothSides - MAX_RAID_PARTIES)} formation slot(s) engage offers could ` +
        `never be reached — and the surplus joiner gets refused INV-26 by join and then "you are not a party" ` +
        `by engage for the rest of the window.`,
    );
  }
  if (WORLD_FLEET_FIT.length === 0) {
    problems.push('the world must fly something, or a world raid that is answered FIGHT has no opponent.');
  }
  // That the fit is non-empty is not the claim worth making — that it is LEGAL is. An illegal
  // WORLD_FLEET_FIT means every world raid answered FIGHT faces an empty field, which is A14 failing
  // in the exact silent way this whole layer exists to prevent: the code runs, the tests pass, and
  // nothing ever fights. `assertWorldFleet` in `battle.ts` makes it a construction error, because
  // `params.ts` cannot import the simulator without a cycle.

  if (problems.length > 0) {
    throw new EngagementScheduleError(`engagement schedule is not viable:\n  - ${problems.join('\n  - ')}`);
  }
}

/** The one sentence an agent is owed about how a battle ends. A RULES SURFACE: pinned by test. */
export const ENGAGEMENT_RULE_STATEMENT =
  `An engagement runs MUSTER ${String(ENGAGEMENT_PHASE_TICKS.MUSTER)} ticks (the only window a hull may be ` +
  `committed in) → CONTACT ${String(ENGAGEMENT_PHASE_TICKS.CONTACT)} → CONTEST ` +
  `${String(ENGAGEMENT_PHASE_TICKS.CONTEST)} → BREAK ${String(ENGAGEMENT_PHASE_TICKS.BREAK)} → AFTERMATH ` +
  `${String(ENGAGEMENT_PHASE_TICKS.AFTERMATH)}, ${String(SLICES_PER_TICK)} resolution slices per tick, all ` +
  `deterministic from a seed committed by hash when the engagement opens and revealed at AFTERMATH. Nothing ` +
  `is a dice roll: applied damage varies by at most ±${String((VOLLEY_BAND_BPS.max - 10_000) / 100)}%, so ` +
  `composition beats luck. HULLS are destroyed permanently; HANDS are never destroyed and go RECOVERING. ` +
  `A hull under tackle of ${String(PIN_THRESHOLD)} or more cannot leave.`;

/** The goods half of what a hull costs, exposed for the refusal text. */
export function hullCostStatement(frame: Qty, fuel: Qty): string {
  return (
    `${String(frame)} ${HULL_COST_GOODS.frame} + ${String(fuel)} ${HULL_COST_GOODS.fuel}. ` +
    `${HULL_COST_GOODS.fuel} is produced only at FRONTIER systems, so a fleet is something somebody hauled.`
  );
}

/** Zero, in the branded unit, for the many places a profile starts empty. */
export const NO_QTY: Qty = qty(0);
