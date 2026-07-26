/**
 * The tick loop — SPEC §15.2.
 *
 * What the rest of the engine needs to know about this module:
 *
 *   - **The order is the rules surface.** `phases.ts` holds all fourteen phases as
 *     data, in the spec's own spelling, and `assertPhaseOrder()` runs at Engine
 *     construction. Three of them (`PREDATE`, `MARKETS`, `PRODUCE`) are explicit
 *     no-op hooks: they hold their slot so that filling them later does not shift
 *     every seeded draw and every golden file.
 *   - **Nothing is ordered by arrival.** `compareOrderKey` is handed a type with no
 *     arrival field. `arrival_ms` exists on the action log for the A4 audit and
 *     nowhere else.
 *   - **`state_hash` exists at tick boundaries only** (§15.1). One per
 *     `TickReport`; there is none on a phase and none on an event.
 *   - **Content plugs in; order does not.** A module supplies a `PhaseHandler`, a
 *     `StateTable` (so its state joins both the hash and the rollback), invariant
 *     checkers for `ASSERT`, and — for `OBLIGE` — an `ObligationSource`. The tick
 *     loop never learns what a venture is.
 *   - **Events are buffered until `COMMIT`.** That is what makes "never publish a
 *     broken tick" literal rather than aspirational: an aborted tick's events are
 *     discarded, never retracted, because INV-16 forbids retraction.
 *   - **A cascade can never emit a default.** `CascadeStatus` is `RESOLVED |
 *     DEFERRED` and has no third member, so a truncated cascade cannot fabricate a
 *     breach no matter how a caller is written (A5′).
 */

export {
  ActionLog,
  ACTION_LOG_TICKS_RETAINED,
  auditArrivalIndependence,
  type ActionOutcome,
  type ArrivalAudit,
  type LoggedAction,
} from './actionLog.js';

export { ActionBudget, costOf, FREE_VERBS, type ActionCost } from './budget.js';

export {
  CascadeError,
  DEFERRAL_REASON,
  runCascade,
  type CascadeAttempt,
  type CascadeResult,
  type CascadeStatus,
  type CascadeStep,
  type Deferral,
} from './cascade.js';

export {
  engineReport,
  engineViolation,
  loggedActionCanonical,
  snapshotCanonical,
  tickInputsFor,
  type Rollback,
} from './halt.js';

export {
  IntentBook,
  intentStateTable,
  INTENT_ORDER_STATEMENT,
  INTENT_RULES,
  LIVE_ACTIONS_BEFORE_INTENTS,
  MAX_LIVE_INTENTS_PER_PRINCIPAL,
  type IntentDraft,
  type IntentRecord,
  type IntentState,
} from './intent.js';

export {
  Engine,
  EngineError,
  MAX_BUFFERED_EVENTS,
  STEP_BUDGET,
  opensCommitmentWindowNext,
  reckoningClock,
  stepBudgetFor,
  type ActionRequest,
  type EngineOptions,
  type EventSink,
  type ObligationSource,
  type PhaseContext,
  type PhaseHandler,
  type PhaseTrace,
  type ReckoningClock,
  type TickReport,
  type VerbHandler,
} from './loop.js';

export {
  assertPhaseOrder,
  isPhaseName,
  PHASES,
  PHASE_NOTE,
  PhaseOrderError,
  phaseIndex,
  UNBUILT_PHASES,
  type PhaseName,
} from './phases.js';

export {
  compareOrderKey,
  defaultPriority,
  MAX_QUEUED_ACTIONS,
  MAX_QUEUED_PER_PRINCIPAL,
  orderKeyOf,
  PRIORITY,
  QueueError,
  SubmissionQueue,
  type FrozenWindow,
  type OrderKey,
  type QueuedAction,
  type SubmittedAction,
} from './queue.js';

export { replayTick, ReplayError, type ReplayInput, type ReplayResult } from './replay.js';

export { SeedBook, SeedDisclosureError, type SeedRecord } from './seed.js';

export {
  canonicalParams,
  captureSnapshot,
  snapshotHashOf,
  hashOnlyTable,
  readCanonicalParams,
  restoreSnapshot,
  rollbackGaps,
  SnapshotError,
  worldStateTable,
  type Snapshot,
  type StateTable,
} from './snapshot.js';

export { WakeBook, wakeStateTable, type WakeCause, type WakeOffer, type WakeOutcome } from './wake.js';
