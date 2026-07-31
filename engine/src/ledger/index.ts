/**
 * The ledger module's public surface.
 *
 * `posting` is authoritative for value (SPEC §15.1). Nothing outside this module
 * may hold a balance, and nothing inside it may know what a venture is — the tick
 * loop wires the two together, which is what keeps the tick pure in-memory code
 * with Postgres as journal and query surface (SPEC §15.5).
 */

export {
  CURRENCY_FAUCET,
  CURRENCY_SINK,
  GOODS_FAUCET,
  GOODS_SINK,
  NAMED_SUPPLY_ACCOUNTS,
  escrowAccount,
  isWorldAccount,
  newAccount,
  storesAccount,
  type Account,
  type AccountKind,
  type NamedSupplyAccount,
  type ValueLedger,
} from './accounts.js';

export {
  checkBatchForm,
  postingLedger,
  type AccountFacts,
  type AppliedBatch,
  type BatchKind,
  type PostingDraft,
  type SupplyDirection,
  type SupplyLeg,
} from './batch.js';

export { applyQtyDelta, negQtyDelta, qtyDelta, sumQtyDelta } from './delta.js';

export {
  EncumbranceBook,
  EncumbranceError,
  SimpleObligationBook,
  emptyObligationBook,
  type AccountLookup,
  type LockableAccount,
  type LockRequest,
  type ObligationBook,
  type ObligationCapture,
  type ObligationRef,
  type SafeLockRequest,
} from './encumbrance.js';

export {
  Ledger,
  LedgerError,
  openStores,
  openVentureEscrow,
  type BatchDraft,
  type CurrencySupply,
  type GoodsSupply,
  type LotDelta,
  type LotOpen,
} from './ledger.js';

export { isInTransit, lotId, type Lot, type LotId, type LotState } from './lots.js';

export { compareIds } from './order.js';

export {
  LedgerHalt,
  assertLedgerInvariants,
  checkInv1,
  checkInv2,
  checkInv3,
  checkInv4,
  checkInv5,
  checkInv7,
  checkLedgerInvariants,
  principalPosition,
  type LedgerInvariantContext,
  type PrincipalPosition,
} from './invariants.js';

export {
  WaterfallError,
  allocateProRata,
  assertPayoutsExact,
  payByPriority,
  type Claim,
  type Payout,
  type WaterfallResult,
} from './waterfall.js';

export {
  resolveCargoLost,
  type CargoLoss,
  type CargoLostInput,
  type CargoLostOutcome,
  type PerilRelease,
} from './cargoLost.js';

export {
  DEFAULT_VALUATION_RULE,
  RelatedPartyGraph,
  applyHaircut,
  bondableValue,
  noRelatedParties,
  valueGood,
  volumeWeightedMedian,
  type Print,
  type RelatedParties,
  type Valuation,
  type ValuationReason,
  type ValuationRule,
} from './valuation.js';

/**
 * The endowment — §12.5's enrolment mint and the withheld floor over it.
 *
 * **The barrel exported none of this until the ONE-HOME sweep**, which is why five modules
 * (`levy/params`, `sovereignty/params`, `market/standing`, `market/escrow`, `risk/view`) and
 * `sim/runtime.ts` all reach past it into `./endowment.js` — and why `runtime.ts` carries its own
 * `export { STARTER_STAKE } from '../ledger/endowment.js'` re-export, a second door onto a constant
 * whose whole docstring is about having one home. A barrel that omits the module every other module
 * needs is not a smaller surface; it is the same surface with the front door locked.
 */
export {
  ENDOWMENT_FLOOR_MINOR,
  ENDOWMENT_GOOD,
  ENDOWMENT_GOOD_FLOOR_QTY,
  EndowmentBook,
  STARTER_ALLOTMENT,
  STARTER_STAKE,
  type EndowmentRow,
  type EndowmentRowIn,
} from './endowment.js';

export { ledgerStateTable, LedgerRestoreError } from './stateTable.js';
export type { LedgerRestore, LedgerAccountRow } from './stateTable.js';
