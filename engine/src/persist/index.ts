/**
 * Durable persistence: the journal that makes "the permanent public record"
 * permanent, and boot-from-store that makes a restart resume rather than reset.
 *
 * See `store.ts` for the interface and the finding that shaped boot (the ledger's
 * snapshot is abort-only, so boot replays from genesis rather than adopting a
 * checkpoint), and `journal.ts` for the persistence-failure policy.
 */

export {
  type DivergenceKind,
  type DivergenceRecord,
  type EnrollmentRecord,
  type JournalStore,
  type PersistedAudience,
  type PersistedEvent,
  type PersistedPosting,
  type SnapshotDigest,
  type SnapshotRecord,
  type TickRecord,
  safeDetail,
  snapshotRecord,
} from './store.js';

export { InMemoryJournalStore, JournalStoreError } from './memory.js';
export { PgJournalStore, type PgJournalStoreOptions } from './postgres.js';
export { extractTick, snapshotRecordOf } from './extract.js';
export {
  bootFromStore,
  bootWorld,
  describeDiagnosis,
  BootError,
  REPLAY_PAGE_TICKS,
  type BootDiagnosis,
  type BootFailureKind,
  type BootOptions,
  type BootOutcome,
  type BootResult,
} from './boot.js';
export {
  CHECKPOINT_REQUIRED_TABLES,
  HYDRATE_PAGE_TICKS,
  CheckpointUnusableError,
  HydrateError,
  applyLedgerHydration,
  hydrateEventsForSnapshot,
  hydrateLedgerForSnapshot,
  missingCheckpointTables,
  planCheckpoint,
  readLedgerHydration,
  snapshotOf,
  verifyRecordRebuildable,
  type CheckpointOptions,
  type CheckpointPlan,
  type CheckpointRefusalKind,
  type LedgerHydration,
} from './hydrate.js';
export { replayCheck, type ReplayCheckResult } from './replayCheck.js';
export {
  Journal,
  BACKLOG_ALARM,
  FAILURE_ALARM_THRESHOLD,
  type JournalHealth,
  type JournalOptions,
} from './journal.js';
