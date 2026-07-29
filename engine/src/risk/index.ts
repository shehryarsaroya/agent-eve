/**
 * `src/risk/` — Phase 3's risk market.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ## The premise this closes
 *
 * v1.1 of this design was built around a risk market **as the core loop**. v2.0 deferred it to Phase
 * 3 and promoted betrayal-via-authority; v3.0 survived six adversarial critics. This directory is the
 * deferred half, built back on top of what the intervening phases proved:
 *
 *   - **A7 is live and measured.** Every promise already has an escrowed part that auto-executes and a
 *     priced part that stays elective, and agents genuinely break **~12% of settled elective
 *     promises** unprompted (Gate 3, `AGT-E1`: kept 22 · broken 3). So the mechanism a risk market
 *     needs — a breakable promise with real money behind it — did not have to be invented.
 *   - **The waterfall is live.** `payByPriority` and `cargoLost` already implement §7.4's rule that an
 *     escrow shortfall is *"a recorded loss, not a default."*
 *   - **`elect` is live.** `Election = Minor | IN_FULL` is already **pay · part-pay · default**.
 *
 * Which is why **this layer costs zero verbs.** §17's ceiling is 40 and 40 are spent. Three existing
 * verbs take a new shape apiece — `publish_offer {kind:"COVER"}`, `sign {cover}`, `elect {cover}` —
 * and the precedents are `build {kind}` (four acts), `refine {kind}` (two recipes) and
 * `deliver {payer}`. The pass's own action vocabulary (`underwrite.request`, `bind`, `claim-payout`,
 * `default`) would have cost four; the reason it does not is that A7 already had all four shapes and
 * only needed a second subject.
 *
 * ## What is here
 *
 * | file | what |
 * |---|---|
 * | `params.ts` | the five canon words, the six rejected ones, and every *(calibrate)* number |
 * | `front.ts` | **CAT1 + CAT2** — the scheduled catastrophe: CONE, SWATH, the destroy set |
 * | `cover.ts` | **RSK1 + RSK3** — the promise, its two halves, insurable interest, `terms_hash` |
 * | `indemnity.ts` | **RSK4 + RSK5 + SOL2** — the correlated claim and pay/part/default |
 * | `run.ts` | the two phases: landfall in `HAZARD`, the cohort in `OBLIGE` after the venture batch |
 * | `book.ts` | the store, the retention rule, and **RSK7**'s decomposed record |
 * | `invariants.ts` | INV-R1…R7, two of them A5′ guards rather than arithmetic |
 * | `view.ts` | the observation surface, the affordances, and the withheld grounds |
 * | `lines.ts` | **A13** — the three pixel signatures |
 *
 * ## The three pixel signatures (A13)
 *
 * Named after the mechanic rather than invented as pictures, so no uncanonised noun enters through
 * the renderer — which is how `CLAIM`, `ANCHOR`, `CHARGE`, `RENT` and `FUEL` all got into `src/`
 * before they were canon:
 *
 *   1. **THE FRONT BAND** — a swept band of tinted systems. Before landfall it is the CONE, widening
 *      then narrowing; at landfall it is the SWATH, struck, with intensity as the tint.
 *   2. **THE COVER ARC** — an arc over a covered holding, **filled for the escrowed half and hollow
 *      for the elective half**. Deliberately the same grammar as A13's venture ring (*"a ring whose
 *      hollow arc is the part riding on someone's word"*), because it is the same axiom: a reader who
 *      has learned the ring reads the arc for free.
 *   3. **THE COVER CHAIN** — a link per cession between payers. On a default **the chain snaps at the
 *      link that broke and every link inward greys**, which is contagion rendered: you can see how
 *      far the failure travelled and who is next. A13 already gives *"a broken compact snaps that
 *      link and scars both parties"*; this is that verb applied to a layer of promises instead of a
 *      pair.
 * ══════════════════════════════════════════════════════════════════════════════
 */

export {
  COVER_DEDUCTIBLE_BPS,
  COVER_ELECTIVE_BPS_CEILING,
  COVER_ELECTIVE_BPS_FLOOR,
  COVER_IS_NONCANCELLABLE,
  COVER_LIMIT_CEILING_BPS,
  COVER_MAX_DEPTH,
  COVER_MIN_LIMIT,
  COVER_WAIT_TICKS,
  CONE_SYSTEMS,
  FRONT_CONE_RECKONINGS,
  FRONT_COVER_FREEZE_TICKS,
  FRONT_EVERY_RECKONINGS,
  FRONT_LANDFALL_PHASE,
  FRONT_LIFETIME_TICKS,
  FRONT_SPARES_QTY,
  HONOUR_WINDOW_TICKS,
  INDEMNITY_WORD,
  INTENSITY_FALLOFF_BPS,
  INTENSITY_MAX_BPS,
  INTENSITY_MIN_BPS,
  MAX_COVERS,
  MAX_COVERS_PER_PAYER,
  MAX_FRONTS,
  MAX_INDEMNITIES,
  MAX_LIVE_FRONTS,
  RISK_CANON,
  RISK_RETAINED_RECKONINGS,
  SWATH_SYSTEMS_MAX,
  SWATH_SYSTEMS_MIN,
  VULNERABILITY_BY_TIER,
} from './params.js';

export {
  announceFront,
  announceTickOf,
  coneAt,
  coneOf,
  destroySet,
  FrontError,
  frontId,
  frontReckoningAnnouncedAt,
  hopsFrom,
  intensityAt,
  isAnnounceTick,
  isFrontReckoning,
  isInSwath,
  isLandfallTick,
  landfallPhase,
  landfallTickOf,
  stateAt,
  swathOf,
  ticksToLandfall,
  type ConeCell,
  type FrontId,
  type FrontLoss,
  type FrontRecord,
  type FrontState,
  type SwathCell,
} from './front.js';

export {
  bindCover,
  coverCanonical,
  CoverError,
  coverEscrow,
  coverEventId,
  coverId,
  coverLine,
  coverTermsHash,
  cycleInChain,
  electiveOutstanding,
  escrowedOutstanding,
  escrowRatioBps,
  fingerprintOf,
  halvesOf,
  isAttached,
  isLiveCover,
  LIVE_COVER_STATES,
  offerCover,
  recordCoverPaid,
  type BindCoverInput,
  type CoverId,
  type CoverRecord,
  type CoverState,
  type CoverSubject,
  type OfferCoverInput,
} from './cover.js';

export {
  assertIndemnityExact,
  contingentOf,
  electiveOwed,
  escrowShortIsNeverDefault,
  guardIndemnity,
  IndemnityError,
  IndemnityHalt,
  indemnityId,
  indemnityLine,
  MAX_INDEMNITY_DEFERRALS,
  openCession,
  openPrimary,
  outstandingOf,
  pinnedMark,
  settleIndemnity,
  settlementOrder,
  wantedOf,
  type IndemnityId,
  type IndemnityRecord,
  type IndemnitySettlement,
  type IndemnityState,
  type OpenCessionInput,
  type OpenPrimaryInput,
  type RiskDefault,
  type RiskHonoured,
  type SettleIndemnityInput,
  type StruckInterest,
} from './indemnity.js';

export { RiskBook, RiskBookError, type RiskRecord } from './book.js';

export {
  announceIfDue,
  attachSeasoned,
  contingentLiabilityOf,
  defaultEventId,
  FRONT_SINK,
  lapseExpired,
  offersRanked,
  ownerOfStores,
  RiskRunError,
  settleCohort,
  strikeFront,
  type CohortOutcome,
  type FrontPort,
  type LapseOutcome,
  type SettleCohortInput,
  type StrikeOutcome,
} from './run.js';

export {
  assertRiskInvariants,
  checkInvR1,
  checkInvR2,
  checkInvR3,
  checkInvR4,
  checkInvR5,
  checkInvR6,
  checkInvR7,
  checkRiskInvariants,
  RiskHalt,
  riskSubjects,
  type RiskSubjects,
  type RiskViolation,
} from './invariants.js';

export {
  coverArcs,
  coverChains,
  frontBands,
  MAX_COVER_ARCS,
  MAX_COVER_CHAIN_LINKS,
  MAX_FRONT_BANDS,
  type CoverArc,
  type CoverChain,
  type CoverChainLink,
  type FrontBand,
} from './lines.js';

export {
  coverAffordances,
  coverOffersFor,
  frontViewFor,
  obligationsDueFor,
  riskViewFor,
  COVER_BAND_STATEMENT,
  FRONT_CLOCK_STATEMENT,
  type CoverAffordanceInput,
  type CoverOfferView,
  type FrontView,
  type HoldingRead,
  type ObligationDueView,
  type RiskAffordance,
  type RiskView,
  type RiskViewInput,
  type WithheldRisk,
} from './view.js';

export {
  coverFrozenFor,
  electCover,
  interestOf,
  publishCover,
  runCohortPhase,
  runFrontPhase,
  signCover,
  type CohortReport,
  type RiskEventDraft,
  type RiskWirePort,
} from './wire.js';
