/**
 * The event ledger and the two filters (SPEC §15.1, §11.2).
 *
 * Read {@link ./visibility.ts} first: it holds the ladder, and the reason A9 is
 * a theorem rather than a review item.
 */

export {
  EventLedger,
  EventLedgerError,
  eventsStateTable,
  mintEventId,
  type AgentFeedRequest,
  type FeedCursor,
  type FeedPage,
  type FeedRequest,
  type EventLedgerCounts,
  type LedgerMetrics,
  type NewEvent,
} from './ledger.js';

export {
  SEAL_FLAG_KEYS,
  agentView,
  declassifiedRedaction,
  describeVisibility,
  everyoneReveal,
  firstAgentRevealTick,
  redactedEvent,
  spectatorView,
  visibilityRule,
  visibilityFaultsAtBirth,
  visibilityRegressions,
  type AudienceAdmission,
  type AudienceBasis,
  type AudienceIndex,
  type AudienceRow,
  type EventView,
  type Redaction,
  type EventRecord,
  type VisibilityDescriptor,
} from './visibility.js';

export {
  appendOnlySurfaceViolations,
  assertEventInvariants,
  causalityViolations,
  fanOutViolations,
  monotonicityViolations,
  recordIntegrityViolations,
  seqDensityViolations,
  type AssertOptions,
  type AssertScope,
  type RecordSource,
} from './invariants.js';
