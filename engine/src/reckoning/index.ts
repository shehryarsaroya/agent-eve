/**
 * The Reckoning — SPEC §5.1 and §15.3.
 *
 * What the rest of the engine needs to know about this module:
 *
 *   - **`freezeReckoning` then `runReckoningBatch`, and they are two calls on purpose.**
 *     The freeze captures `venture.actedOnStateVersion` and the balances the settlement
 *     will pay from; `VERIFY_INPUTS` reads them again and halts on any difference. A
 *     single call would compare a value against itself, which is the no-op
 *     `SettleInput.actedOnStateVersion` warns about twice — and the gap between the two
 *     calls is where a raid lands, which is the whole of E2E-12.
 *   - **The frozen set is the only source of `SettleInput`.** There is no field on a plan
 *     for `acted_on_state_version`, so a caller cannot pass the engine's live counter (it
 *     would halt every venture that outlives its activation tick) or the row read back
 *     (the same object on both sides of `!==`).
 *   - **`RECEIPTS` is the only stage that appends.** Everything before it is arithmetic in
 *     memory, so a failure up to that point leaves no permanent row and "the whole batch
 *     is one transaction that fails closed" is literal.
 *   - **A default's `parent_event_id` is its cause, as a column.** `receipts.ts` appends
 *     the `venture.settled` row, reads its minted id, and writes it (or the loss event's
 *     id) into each default before appending — the debt `src/venture/events.ts` records at
 *     the site, discharged. `EventLedger.append` mints ids, so only the caller that
 *     appends the batch can do this.
 *   - **`StandingBook` is the only writer of standing**, and it journals every write in
 *     the same statement, because INV-21's history half is a comparison between the two.
 *   - **Nothing an agent sends can halt this module.** A malformed election is dropped
 *     (PROP-V4's own default) and reported; an unsealed role is reported and not punished.
 *     A halt an agent can trigger is a denial of settlement (AGT-X9).
 *   - **`runReckoningAudit` is §15.4's false-default audit over the real settlement**, and
 *     it is deliberately named differently from `src/invariants/audit.ts`'s reference-model
 *     version so no call site can mean one and get the other.
 */

export {
  runReckoningAudit,
  verifyEveryDefaultAttributable,
  verifyNoInventedDefault,
  type ReckoningAuditOptions,
  type ReckoningAuditResult,
  type ReckoningAuditVerdict,
} from './audit.js';

export {
  ReckoningBatch,
  reckoningViolations,
  runReckoningBatch,
  type ReckoningObligations,
  type ReckoningOutcome,
  type ReckoningRun,
  type ReckoningWorld,
} from './driver.js';

export {
  isTerminalState,
  reconcileFaults,
  releaseFaults,
  type ReconcileInput,
} from './reconcile.js';

export {
  appendSettlementReceipts,
  resolveDefaultCause,
  settlementHandle,
  type SettlementReceipt,
} from './receipts.js';

export {
  FROZEN_INPUTS_VERSION,
  ReckoningHalt,
  freezeReckoning,
  hashFrozenInputs,
  isElection,
  partiesOfReckoning,
  settlementItemsOf,
  settlementSetOf,
  verifyFrozenInputs,
  type FrozenObligation,
  type FrozenReading,
  type FrozenReckoning,
  type ObligationPlan,
} from './set.js';

export {
  StandingBook,
  type SealChargeRow,
  type StandingApplied,
  type StandingCredit,
} from './standing.js';
