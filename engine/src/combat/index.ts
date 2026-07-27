/**
 * THE ENGAGEMENT — Phase 2's combat layer, and what the rest of the engine needs to know about it.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ## In one paragraph
 *
 * A refused demand becomes a **battle**. §9's standoff already had two sides, a join, a force
 * reading and a clock; what it did not have was a *fight*. This layer supplies one: five states
 * (MUSTER → CONTACT → CONTEST → BREAK → AFTERMATH) inside the 24-tick demand window, eight
 * deterministic resolution slices per tick, HULLS built from goods and destroyed permanently, and
 * **five interlocking roles** — LINE, TACKLE, REPAIR, EWAR, COMMAND — so a fleet is a composition
 * problem rather than a sum of ships.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## The four claims this layer makes, and where each is checkable
 *
 * **1. Combat happens on a clock, not on willingness (A14).** The world spawns raids at ticks 48,
 * 120 and 192 of every Reckoning and {@link mustWorldFleet} gives each one a published fleet nobody
 * owns. A defender that answers FIGHT gets a battle whether or not any agent ever chose one. This is
 * the claim every autonomous-cast combat system fails, silently, and it is why the world's fleet is
 * a *constant* (`WORLD_FLEET_FIT`) rather than a hope.
 *
 * **2. Composition beats headcount, through hands.** This layer does **not** edit
 * `predation/resolve.ts`. A wrecked hull routs its hand; `readForce` counts hands *at resolution* —
 * its own doc says *"a joiner counts only while its hand is still standing there"* — so losing the
 * battle loses the force reading automatically. Zero change to the most-tested arithmetic in the
 * engine, and the causal chain already existed.
 *
 * **3. Every force multiplier is attackable and has two counters** (§12 relationship #4). REPAIR is
 * broken by DRAIN (no capacitor) or DAMP (no lock) or alpha (outrun it). TACKLE is broken by killing
 * the frigate or out-ranging it. COMMAND is broken by shooting the ship that projects it. EWAR is
 * broken by CAP_BATTERY, SENSOR_BOOSTER, or range. `catalogue.ts`'s header carries the whole table.
 *
 * **4. A hull is a located, priceable, permanently losable asset (A5).** Built from
 * `ration + fuel` — and fuel is FRONTIER-only, so **a fleet is something somebody hauled**, which is
 * what finally gives territory the military reason `D23` graded *"ANTI-load-bearing"* for want of one.
 *
 * ## Pixel signature (A13): **THE BATTLE LINE**
 *
 * Two lines of bars facing each other across a **gap that narrows or widens every tick** — the range
 * race, and the most legible thing on the board. Bars stacked in four rows by ECHELON, width ∝ hull
 * count, **height ∝ EHP fraction** so a formation thins rather than vanishing. Four overlays for the
 * four multipliers: a **repair tether**, a **tackle chain**, a **dark bar** for an empty capacitor
 * (undamaged and operationally dead), and a **command halo**. Wreck marks persist into AFTERMATH.
 * Full text in `book.ts`; the data in {@link battleLinesFor}.
 *
 * ## The vocabulary this layer adds, and what it cost
 *
 * Nine canon terms — ENGAGEMENT, HULL, FIT, MODULE, RIG, FORMATION, ECHELON, POSTURE, DOCTRINE —
 * plus RANGE, TACKLE, CAPACITOR and EWAR as effect names. Each was checked against §3's 28 existing
 * terms and against `src/`, and three candidates were **rejected for collisions**, which is the part
 * worth recording:
 *
 * | wanted | collided with | shipped |
 * |---|---|---|
 * | `operation` | `trade {operation: 'place'}` (`market/place.ts`) | **ENGAGEMENT** |
 * | `phase` | the tick pipeline's `PhaseName` | **state** (the existing pattern) |
 * | `depth` | a grant's delegation depth (§8) | **ECHELON** |
 * | `front` | §10.1's scheduled weather front | *not built* — see `params.ts` |
 *
 * The verb is **`engage`**, and §17's budget is still 40/40 because it was paid for by removing
 * **`flee`** — a canon verb with no handler, which `api/verbs.ts` already argued should never get one.
 *
 * ## ★ THE CAP ON A FLEET IS HANDS, AND THE SIM IS WHAT FOUND IT
 *
 * MAX_HULLS_PER_PRINCIPAL is 6 and a principal has **three hands** (§17), and `engage` requires an
 * IDLE hand at the stage to crew each hull. So the real cap on a fleet one principal can *field* is
 * three, and the first combat sim reported it as a refusal, three times in a row:
 *
 * > `engage: A6 you have no IDLE hand at sys-17 to crew it. A hull without a hand is a berthed asset,
 * > not a combatant.`
 *
 * That was not a bug and it is the most valuable property this layer has. §6.2 says *"hands are not
 * purchasable. Capital's use is hiring other principals' hands, which is the labour market and the
 * point"* — and a fleet larger than three hulls is therefore **a coalition**, not a purchase. Six
 * owned hulls and three flyable ones is a spares problem, which is a real one.
 *
 * A **big battle is many principals on one side**, each bringing what its own hands can crew and each
 * choosing its own echelon, posture and primary policy. Which is EVE's actual shape: a doctrine is a
 * thing a *group* fields, and the reason a fleet needs a commander is that nobody can field one alone.
 *
 * ## What is deliberately NOT here, each with its reason
 *
 * - **Refitting.** A fit is frozen at build. §1 MUST-8 exists to stop *"morphing into the exact
 *   counter after seeing the enemy"*, and this is the strongest version of that. Deferred: the
 *   `full_service`/`field_service` ladder, repair, reload, re-rig.
 * - **Strategic mobility.** A hull is berthed where it was built. All of §9 (cynos, jump drives,
 *   bridges, capital escalation) is gated behind *"add only after counters work"* by the pass itself.
 * - **The lateral axis.** One positional axis (ECHELON), not `front × depth`. `front` appears in none
 *   of §12's five relationships and is a §3 collision besides. Flanking is the named deferral.
 * - **Drones, bombs, capitals, T2/T3, module quality bands.** All SHOULD or later in the pass's own
 *   build order, which puts the kernel first for a reason.
 * - **Four damage types are IN**, and they are the one MUST that could plausibly have been cut. They
 *   cost fifteen lines and they are the reason a scan is worth paying for: a tank has a hole.
 */

export {
  battleTickerLine,
  battleLinesFor,
  engageOffersFor,
  engagementViewsFor,
  hullOfferFor,
  rangeCellNames,
  MAX_VIEW_CONTACTS,
  MAX_VIEW_FORMATIONS,
  MAX_VIEW_TRACE,
  type CombatOffer,
  type ContactView,
  type EngagementView,
  type OfferContext,
  type EngagementViewPort,
  type ForecastView,
  type OwnFormationView,
} from './view.js';

export {
  assertWorldFleet,
  decideEarly,
  formationsOf,
  isWorldHand,
  isWorldHull,
  mustWorldFleet,
  nextStateNote,
  profileLookup,
  runBattles,
  ticksLeftOf,
  WORLD_PRINCIPAL,
  worldFleetHash,
  worldFleetProfile,
  WorldFleetError,
  type BattlePort,
  type BattleReport,
} from './battle.js';

export {
  Book,
  ECHELONS,
  engagementIdFor,
  engagementStateTable,
  EngagementBookError,
  formationIdFor,
  HOLD_FOREVER,
  isEchelon,
  isPosture,
  isTargetPredicate,
  POSTURES,
  TARGET_PREDICATES,
  type Echelon,
  type EngagementId,
  type EngagementRecord,
  type EngagementState,
  type FieldControl,
  type Formation,
  type FormationId,
  type Posture,
  type TargetPredicate,
  type TraceEntry,
  type WithdrawWhen,
  type Wreck,
} from './book.js';

export {
  damageTypesOf,
  HULLS,
  HULL_NAMES,
  hullSpec,
  MODULES,
  MODULE_FAMILIES,
  MODULE_NAMES,
  moduleSpec,
  ROLE_TAGS,
  SLOT_ROWS,
  weaponProfile,
  WEAPONS,
  type HullSpec,
  type ModuleFamily,
  type ModuleSpec,
  type RoleTag,
  type SlotRow,
  type WeaponFamily,
  type WeaponProfile,
} from './catalogue.js';

export {
  DEFAULT_PRIMARY,
  DEFAULT_WITHDRAW,
  engage,
  engageRefusal,
  openEngagement,
  profileOfFit,
  type EngagePort,
  type EngageRequest,
  type EngageResult,
  type ShipyardPort,
} from './engage.js';

export {
  Fleet,
  FleetError,
  fleetStateTable,
  hullIdFor,
  readyAtFor,
  type HullId,
  type HullRecord,
  type HullState,
} from './fleet.js';

export {
  FIT_CONSTRAINTS,
  fitHashOf,
  fitWarnings,
  marginalOf,
  rangeName,
  rangeRowFor,
  scaleBps,
  simulateFit,
  stackSum,
  type FitConstraint,
  type FitHash,
  type FitProfile,
  type StackReport,
  type WeaponLine,
} from './fit.js';

export {
  battlesOf,
  checkCombatInvariants,
  checkOps1,
  checkOps2,
  checkOps3,
  checkOps4,
  checkOps5,
  checkOps6,
  checkOps7,
  combatCoverage,
  wreckTally,
  type CombatCoverage,
  type CombatInvariantInputs,
} from './invariants.js';

export {
  assertEngagementSchedule,
  CAP_SHUTDOWN_ORDER,
  COMMAND_BONUS_BPS,
  COMMAND_REACH,
  DAMAGE_TYPES,
  ECHELON_DEPTH,
  ENGAGEMENT_PHASE_TICKS,
  ENGAGEMENT_RULE_STATEMENT,
  ENGAGEMENT_TICKS,
  EngagementScheduleError,
  GAP_AT_CONTACT,
  GAP_MAX,
  HULL_COST_GOODS,
  HULL_FIT_TICKS,
  hullCostStatement,
  LAYER_RESIST,
  MAX_ENGAGEMENT_ROWS,
  MAX_FORMATIONS_PER_SIDE,
  MAX_HULLS_PER_PRINCIPAL,
  MAX_LIVE_ENGAGEMENTS,
  MAX_MODULES_PER_FIT,
  MAX_TRACE_ENTRIES,
  MAX_WRECKS_PER_ENGAGEMENT,
  PIN_THRESHOLD,
  RANGE_CELLS,
  RANGE_FACTOR,
  RESERVE_ECHELON,
  SLICES_PER_TICK,
  STACK_PENALTY_BPS,
  VOLLEY_BAND_BPS,
  WORLD_FLEET,
  WORLD_FLEET_FIT,
  WRECK_VALUE_PER_GOOD,
  type DamageType,
  type RangeCell,
  type TypeProfile,
} from './params.js';

export {
  applyVolley,
  contestGap,
  echelons,
  effectiveMobility,
  fieldControlOf,
  pickPrimary,
  postureSign,
  rangeBetween,
  resistAt,
  runTick,
  SLICES,
  tagsOf,
  volleyBand,
  wantsOut,
  type HullLoss,
  type ProfileLookup,
  type Slice,
  type SliceOutcome,
  type VolleyResult,
} from './resolve.js';

export {
  buildHull,
  buildHullRefusal,
  hullQuote,
  type BuildHullRequest,
  type BuildHullResult,
} from './shipyard.js';
