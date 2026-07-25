/**
 * The world: the map, hands, holdings, movement, and the Commons floor.
 *
 * SPEC §4 (the world, zones, tiers, travel) and §6 (principals, hands, holdings).
 *
 * What the rest of the engine needs to know about this module:
 *
 *   - **MOVE runs before every resolution phase** (`movement.ts`), or every
 *     published ETA is a tick optimistic.
 *   - **An arrival is not PRESENT until the next tick** — `ARRIVAL_IS_PRESENT_SAME_TICK`
 *     in `hands.ts` is the single home of that decision, and `MOVEMENT_STATEMENT`
 *     is the sentence `agent.md` must carry verbatim.
 *   - **`cargoHeldByHands` is a cross-check against the ledger's lot table, not a
 *     second summand.** `src/ledger/lots.ts` claims to be the only home of a goods
 *     quantity; adding the two totals double-counts and reproduces scar #5. Read
 *     the warning on that function before using it.
 *   - **Commitment is never stored here.** Anything that needs to know whether a
 *     hand fills a role takes it as an argument.
 *   - **`commonsFloorRejection` is the A8 validator** and must run before an
 *     action is locked, charged or written.
 */

export {
  assertMapStructure,
  cmpStr,
  commonsSystems,
  CONSTELLATION_SIZE_BOUNDS,
  generateMap,
  LAUNCH_PLAN,
  LAUNCH_SEED,
  LAUNCH_SYSTEM_BOUNDS,
  laneBetween,
  laneKey,
  launchMap,
  MapError,
  mapCanonical,
  mapHash,
  nearestCommons,
  route,
  systemOf,
  tierOf,
  transitTicks,
  type Constellation,
  type Lane,
  type LaneKey,
  type LaneKind,
  type MapPlan,
  type Route,
  type WorldMap,
} from './map.js';

export {
  ARRIVAL_IS_PRESENT_SAME_TICK,
  beginTransit,
  cargoHeldByHands,
  cargoOf,
  cargoOnLanes,
  cmpHands,
  commitHand,
  createHands,
  expectedArrivalTick,
  HAND_STATES,
  HANDS_PER_PRINCIPAL,
  handIdFor,
  inTransitEta,
  isOnLane,
  isPresent,
  laneOf,
  loadCargo,
  loseHand,
  MAX_CARGO_GOODS,
  MOVEMENT_RULES,
  MOVEMENT_STATEMENT,
  occupiesSystem,
  releaseHand,
  resolveArrival,
  resolveRecovery,
  unloadCargo,
  type HandLoss,
  type HandRecord,
} from './hands.js';

export {
  createHolding,
  holdingIdFor,
  isCivicLeased,
  isCommonsBound,
  markFallen,
  relocateHolding,
  safestSeat,
  type HoldingRecord,
  type HoldingState,
} from './holding.js';

export {
  createWorld,
  enroll,
  handById,
  handsAt,
  handsInOrder,
  handsOf,
  holdingOccupancy,
  holdingOf,
  holdingsInOrder,
  principalIsCommonsBound,
  worldCanonical,
  worldHash,
  WorldError,
  type Enrolment,
  type WorldState,
} from './state.js';

export {
  commonsBoundRejection,
  MOVE_PHASE_MUST_PRECEDE,
  mapOf,
  moveHand,
  presentHandsAt,
  resolveMovement,
  transitProgressTicks,
  type Arrival,
  type MovementOutcome,
  type RecoveryEnd,
} from './movement.js';

export {
  assertVerbsClassified,
  classifyAction,
  commonsFloorRejection,
  DEFENDER_SIDE,
  HOSTILE_VENTURE_KINDS,
  laneIsProtected,
  MAX_CLASSIFY_DEPTH,
  protectionOf,
  SEIZURE_BALLOT,
  systemOfTarget,
  TARGET_KEYS,
  targetsOf,
  VERB_CLASS,
  type ActionParams,
  type Disposition,
  type Protection,
  type Target,
  type VerbClass,
} from './commons.js';

export {
  checkInv10,
  checkInv8,
  checkInv9,
  checkWorldInvariants,
  NO_ROLE_FILLS,
  type RoleFills,
} from './invariants.js';

export { accept, reject, type Accepted, type Rejection, type WorldResult } from './result.js';
