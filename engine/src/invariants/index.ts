/**
 * The unified invariant surface and the halt semantics.
 *
 * What the rest of the engine needs to know about this module:
 *
 *   - **`assertInvariants(world, tick)` is the ASSERT phase.** One call, all 26,
 *     and it must run exactly once per tick: the record pass advances INV-14's
 *     before-and-after snapshot as a side effect, so a second call in the same tick
 *     is blind to the first's regressions.
 *   - **Read `report.skipped` before believing `report.violations` is empty.** Six
 *     invariants read state no module writes yet. The tick loop passes
 *     `requireAll: true`, which turns every skip into a HALT.
 *   - **Publication is commit.** In-memory mutation is not. `HaltController` owns the
 *     published tick, and `runReckoning` moves it only after ASSERT is clean — which
 *     is what "never publish a broken tick" means operationally (SPEC §15.2).
 *   - **After a failed tick the in-memory world is garbage.** Recovery is a replay
 *     from `(snapshot_T, action_log_T, seed_T)` into a world rebuilt from the
 *     snapshot, never a repair of the dirty one.
 *   - **A default may only be recorded through `DefaultRegister.attribute`.** INV-17
 *     is the highest-severity check here, because a default with no attributable
 *     cause is the game accusing an innocent agent (A5′), and the check requires the
 *     link to be in the permanent record's `parent_event_id`, not only in memory.
 */

export {
  ALL_INVARIANT_IDS,
  InvariantHalt,
  assertInvariants,
  checkInv6,
  checkInvariants,
  type CappedStructure,
  type InvariantInputs,
  type InvariantReport,
  type SettledPayouts,
  type SkippedCheck,
  type StandingDiff,
} from './aggregate.js';

export {
  AttributionError,
  DEFAULT_CAUSE_KINDS,
  DEFAULT_EVENT_KINDS,
  DefaultRegister,
  attributionStateTable,
  checkInv17,
  isDefaultEventKind,
  type DefaultAttribution,
  type DefaultCauseKind,
  type Inv17Options,
} from './attribution.js';

export {
  checkInv22,
  checkInv23,
  type GrantSpend,
  type SignedDeal,
} from './authority.js';

export {
  auditModeA,
  auditModeB,
  runFalseDefaultAudit,
  verifyModeA,
  verifyModeB,
  type AuditModel,
  type AuditOptions,
  type AuditResult,
  type AuditVerdict,
} from './audit.js';

export {
  checkInv24,
  checkInv25,
  checkInv26,
  type ArrayCap,
  type DocketRow,
  type Inv24Inputs,
  type LevyAssessment,
} from './crowd.js';

export {
  HaltController,
  HaltError,
  RECKONING_DELAYED,
  SUBMISSION_QUEUE_BOUND,
  freezeTriple,
  resumeBytes,
  signResume,
  tripleHash,
  type ActRefusal,
  type DelayCard,
  type HaltControllerOptions,
  type HaltRecord,
  type LiveObservation,
  type Observation,
  type PausedObservation,
  type QueuedSubmission,
  type RerunResult,
  type ResumeClaim,
  type ResumeOrder,
  type ResumeOutcome,
  type Submission,
  type SubmissionOutcome,
  type TickInputs,
  type TickRerun,
} from './halt.js';

export {
  STANDING_CAUSES,
  assertCauseTableIntact,
  checkInv18,
  checkInv19,
  checkStandingJournal,
  checkUnjudgedSeals,
  touchedObjects,
  type Inv21Inputs,
  type SettlementItem,
  type SettlementSet,
  type StandingCause,
  type StandingChange,
  type StandingField,
} from './promises.js';

export {
  INVARIANTS,
  TOP_SEVERITY_ID,
  halt,
  halting,
  invariant,
  rankViolations,
  severityRank,
  warn,
  type Coverage,
  type InvariantEntry,
  type InvariantGroup,
} from './registry.js';

export {
  CASCADE_ROUND_LIMIT,
  RECKONING_STAGES,
  TransactionError,
  assertBoundedRounds,
  runReckoning,
  type ReckoningStage,
  type ReckoningTransactionOptions,
  type Stage,
  type StageContext,
  type TransactionOutcome,
} from './transaction.js';
