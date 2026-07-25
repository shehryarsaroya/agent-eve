/**
 * `observe` — the agent's decision document (SPEC §12.1, §12.4, `agent.md` §6).
 *
 * What the rest of the engine needs to know about this module:
 *
 *   - **Exactly ten top-level keys, in order** — `header · hands · holding ·
 *     obligations · ventures · counterparties · grants · market · affordances ·
 *     briefing`. §17's budget is *at* its ceiling, so adding one means removing one,
 *     and `assertObservation` counts them.
 *   - **The budget is met by eligibility filtering, never truncation** (PROP-O1).
 *     There is no `TRUNCATED` ground in `WithheldGround` and there may never be: every
 *     omission is a named rule about the world, or it is `PAGED` — eligible, counted,
 *     and free to fetch through `ServiceDesk.page`.
 *   - **Every affordance carries all six honesty fields** (PROP-O4). An option whose
 *     worst case cannot be computed is *withheld*, never published with a plausible
 *     number: `agent.md` §12 tells players `max_direct_loss` is exact.
 *   - **`briefing.if_you_do_nothing` is structured and under test** (PROP-O5). Its
 *     outcomes carry a `ProvenanceClass`, because a wage's figure is arithmetic and a
 *     share's is a forecast, and the test asserts equality on the first and band
 *     containment on the second.
 *   - **Outside a wake, `observe` returns the cached snapshot verbatim** with no
 *     affordances and no new `quote_id` (§12.4). Verbatim is what keeps countdowns
 *     monotonic; empty is what makes it useless, which is the requirement.
 *   - **Nothing here mutates and nothing here reserves.** The free services take
 *     read-only sources; the quote book pins and reserves nothing (PROP-W4).
 *   - **Nothing here halts.** `observe` is a read, not a tick phase: every checker
 *     returns faults, only the `assert*` wrappers throw, and an over-budget payload is
 *     returned with `fits: false` rather than refused. An agent that can make a read
 *     throw has a denial-of-settlement lever (AGT-X9).
 *   - **Eligibility is composed from the owning module's predicates**, never
 *     re-derived. See the table at the top of `catalogue.ts`, and the test that calls
 *     the real `fillRole` on every slot this module advertises.
 */

export {
  AFFORDANCE_KEYS,
  VERBS,
  actionCostOf,
  affordanceFaults,
  compareCandidates,
  isVerb,
  paramKey,
  verbOrder,
  type Affordance,
  type AffordanceParams,
  type Candidate,
  type Verb,
} from './affordance.js';

export {
  buildBriefing,
  nextSettlementTick,
  resolvesAt,
  type Briefing,
  type DoNothingKind,
  type DoNothingOutcome,
  type IfYouDoNothing,
} from './briefing.js';

export {
  buildCatalogue,
  myVentures,
  partiesNamed,
  sortedVentures,
  ventureIdsOf,
  type Catalogue,
  type CatalogueContext,
} from './catalogue.js';

export {
  changedKeys,
  correctionFaults,
  correctionFor,
  nearestLegal,
  type Correction,
  type CorrectionInput,
} from './correction.js';

export {
  FORECAST_PERCENTILES,
  slotClaimAt,
  slotForecast,
  type SlotForecast,
} from './forecast.js';

export {
  ObservationFault,
  affordanceSetFaults,
  affordancesFor,
  assertCountdownMonotonic,
  assertObservation,
  budgetFaults,
  checkObservation,
  countdownFaults,
  keyFaults,
  sensingFaults,
  serialisationFaults,
  stalenessFaults,
  verbsOffered,
  withheldFaults,
} from './invariants.js';

export {
  OBSERVE_KEYS,
  ObservationCache,
  RUNGS,
  asCanonical,
  buildObservation,
  darkObservation,
  observationHash,
  observe,
  pageBy,
  staleProjection,
  type BoardSlot,
  type BuildResult,
  type CounterpartyLine,
  type Grants,
  type GrantLine,
  type HandLine,
  type Header,
  type HoldingLine,
  type Market,
  type MyVentureLine,
  type NextDecision,
  type NextReckoning,
  type Observation,
  type Obligations,
  type ObserveResult,
  type Rung,
  type Ventures,
} from './observation.js';

export {
  MAX_LIVE_QUOTES,
  QUOTE_TTL_TICKS,
  QUOTE_VERSION,
  QuoteBook,
  quoteFrom,
  quoteIdFor,
  type Quote,
  type QuoteTerms,
} from './quote.js';

export {
  EXPOSURE_BAND_FLOORS,
  canSense,
  exposureBandOf,
  sensesNothing,
  sensingFromWorld,
  type ExposureBand,
  type SensingIndex,
} from './sensing.js';

export {
  CALLS_PER_PRINCIPAL_PER_TICK,
  MAX_PLANS,
  MIN_PLANS,
  NODES_PER_PLAN_CALL,
  NODE_BUDGET_PER_TICK,
  SERVICE_NAMES,
  ServiceDesk,
  type DryRun,
  type GrantStress,
  type HandPlan,
  type PlanReply,
  type PlanStep,
  type PlanStepKind,
  type ServiceName,
  type ServiceReply,
  type VentureQuote,
} from './services.js';

export {
  noMarks,
  roleSealKey,
  storesReadOf,
  type BallotRef,
  type BookBand,
  type BookRow,
  type GrantTemplate,
  type LevyBlock,
  type MandateRead,
  type MarkPriceRead,
  type ObserveSources,
  type StoresRead,
  type TalkRow,
} from './sources.js';

export {
  CHARS_PER_TOKEN,
  COMMITMENT_TOKEN_CAP,
  FLOOR_CAPS,
  LIST_CAPS,
  MAX_FORECLOSE_ENTRIES,
  MAX_LINE_CHARS,
  MAX_PHRASE_CHARS,
  NORMAL_TOKEN_CAP,
  divCeil,
  estimateTokens,
  floorWorstCaseChars,
  isPreReckoning,
  line,
  phrase,
  tokenCapFor,
} from './tokens.js';

export {
  PAGED,
  WITHHELD_FIELDS,
  WITHHELD_GROUNDS,
  WithheldTally,
  accountingFaults,
  type FieldAccounting,
  type WithheldField,
  type WithheldGround,
  type WithheldRow,
} from './withheld.js';
