/**
 * The venture — the atomic social object (SPEC §7).
 *
 * What the rest of the engine needs to know about this module:
 *
 *   - **Commitment lives in `venture_role.filled_by_hand_id` and nowhere else**
 *     (§6.2, INV-9). `VentureBook` holds the in-process equivalent of the schema's
 *     partial unique index; `book.roleFills()` is what you hand to `checkInv9`.
 *   - **`fill_role` is a request, not a grant.** Collect {@link FillRequest}s
 *     through the tick and resolve them with {@link allocateFills} at tick close,
 *     never at submit (PROP-V8, §7.3). Arrival order is not an input.
 *   - **Settlement runs in `venture_id` order and nothing else** (§15.3, PROP-V7).
 *     {@link settleBatch} sorts its own input, so a caller cannot get this wrong.
 *   - **The escrowed part always executes; the elective part never does**
 *     (PROP-V4). `SettleInput.elections` is opt-in and an absent entry pays nothing.
 *   - **A shortfall on the escrowed half is a recorded LOSS, never a default**
 *     (§10.2, PROP-L3). A default carries `causeEventId` and is never null (INV-17).
 *   - **Value moves only through the `Ledger`.** This module computes who is owed
 *     what and calls `transferCurrency`; it holds no balance of its own (§15.1).
 *   - **A default this engine cannot attribute is not written** (A5'). At the
 *     deferral bound the value is published as an unattributed loss instead; see
 *     `SettlementBatch.unattributed`.
 *   - **Events are drafts.** {@link settlementEvents} returns `NewEvent`s and
 *     appends nothing: the Reckoning batch is one transaction that fails closed.
 */

export {
  assertSignedBps,
  negBps,
  scaleByBps,
  scaleByBpsCeil,
  scaleBySignedBps,
  sumBps,
} from './arith.js';

export {
  KindError,
  MAX_ROLES_PER_VENTURE,
  MIN_ROLES,
  MIN_ROLES_TOP_YIELD,
  TOP_YIELD_THRESHOLD_MINOR,
  VENTURE_KINDS,
  assertKindTable,
  electiveFloor,
  isEscrowable,
  isTopYield,
  kindSpec,
  minRoles,
  principalsRequired,
  topYieldKinds,
  type KindSpec,
  type RoleLabel,
  type RoleSpec,
} from './kinds.js';

export {
  SHARE_PRIORITY,
  WAGE_PRIORITY,
  escrowRatioBps,
  fullyElectiveShare,
  isShareRole,
  isWageRole,
  pinnedAt,
  pinnedConsideration,
  roleTerms,
  seniorityOf,
  shareTerms,
  termsCanonical,
  termsHash,
  validateRoleTerms,
  wageTerms,
  type PinnedValuation,
  type TermsHashInput,
} from './terms.js';

export {
  DUPLICATE_ROLE_DIVISOR,
  NEUTRAL_STAGE_BPS,
  PERCENTILES,
  ProceedsError,
  computeOutputBps,
  computeProceeds,
  drawResidual,
  proceedsBand,
  residualAtPercentile,
  type Bottleneck,
  type Percentile,
  type Proceeds,
  type ProceedsBand,
  type ProceedsInput,
} from './proceeds.js';

export {
  LIVE_STATES,
  VentureError,
  activate,
  countersign,
  createVenture,
  escrowRequired,
  filledIndices,
  fillRole,
  isFullyCountersigned,
  isFullyFilled,
  isLive,
  openIndices,
  partiesOf,
  pinnedValue,
  roleAt,
  roleOfPrincipal,
  signatoriesRequired,
  soloIsImpossible,
  termsHashOf,
  vacateRole,
  windowContains,
  windowsOverlap,
  type CreateVentureInput,
  type TerminalState,
  type VentureRecord,
  type VentureRoleRecord,
} from './venture.js';

export { BookError, VentureBook, type RoleRef } from './book.js';

export {
  allocateFills,
  canonicalRequestOrder,
  stakeBid,
  type AllocationContext,
  type AllocationResult,
  type FillRequest,
  type Granted,
  type Refused,
  type RefusalReason,
} from './allocation.js';

export {
  CASCADE_ROUND_LIMIT,
  MAX_DEFERRALS,
  SettlementHalt,
  assertClaimsExact,
  computeClaims,
  lockFillStake,
  releaseStakes,
  settleBatch,
  settleVenture,
  type ClaimBreakdown,
  type DefaultCause,
  type ResolutionKind,
  type RoleClaim,
  type RolePayout,
  type SettleInput,
  type SettlementAccounts,
  type SettlementBatch,
  type StandingDelta,
  type VentureDefault,
  type VentureSettlement,
} from './settlement.js';

export {
  allRoleIndices,
  forecastsFor,
  projectedSettlement,
  referenceSplit,
  takeAtPercentile,
  ventureEscrowRatioBps,
  yourTakeAtP50,
  type ProjectedParty,
  type ProjectedSettlement,
  type ReferenceShare,
  type TakeForecast,
} from './preview.js';

export {
  assertSoloCannotSatisfyTopYield,
  checkSettlementExact,
  checkVentureIndex,
  checkVentureInvariants,
  checkVentureStructure,
  electiveHonouredValue,
} from './invariants.js';

export {
  VENTURE_EVENT_KINDS,
  batchEvents,
  formationEvent,
  settlementEvents,
  type ReceiptContext,
} from './events.js';
