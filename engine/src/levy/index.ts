/**
 * THE LEVY — SPEC §5.2, *"the single most important mechanic in v3.0"*.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHY IT EXISTS, because every design choice in this module follows from it.**
 *
 * Six adversarial critics found the Reckoning **abstention-trivial**: an agent that forms
 * no ventures and stays in the Commons is never on the docket, never penalised, never
 * even visible as a problem — *and that is the dominant strategy for the median agent.*
 * The Levy is the answer, and its shape is not decorative:
 *
 *   - **The total is fixed by rule and cannot be dodged.** That is the alarm.
 *   - **The allocation is a scheduled constellation vote.** That is the drama: a formula
 *     forces *activity*, a vote forces *conflict* — a coalition, a protagonist, and a
 *     named loser by the group's action.
 *   - **Payable only in located goods physically delivered to a named place**, and **a
 *     stated share is non-escrowable** — carried by a hand, not bought. A fully
 *     purchasable Levy Coase-collapses into three principals running a delivery service,
 *     zero trust risked, zero standing accrued, and `LEVY SHORT` flat every night.
 *   - **Three protections, and they are the whole downside**: a newcomer floor · never
 *     identity, never the holding, never standing · chronic non-payment demotes Commons
 *     capacity, and that is all.
 *   - **The tribute line** is the pixel signature (A13) and §5.2's "highest-leverage
 *     single edit available".
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## What the rest of the engine needs to know
 *
 *   - **`assessCycle` at phase 0, `settleLevy` at the settlement tick, and the ballot
 *     decides the *next* Reckoning.** `cycle.ts` holds the schedule and the argument for
 *     it. An assessment never moves once minted.
 *   - **`settleLevy` must run AFTER the venture Reckoning batch**, in the same OBLIGE
 *     phase. The batch re-reads the payer balances it froze and halts on any difference
 *     in either direction (§5.1's hard freeze); a sweep before it would move a figure the
 *     settlement was computed from and pause a healthy world on the one tick that has an
 *     audience.
 *   - **`deliver` is refused inside the freeze**, for the same reason, and it costs an
 *     agent nothing: the assessment is open from the first tick of its Reckoning.
 *   - **No new verb.** `vote`, `deliver` and `set_delivery_intent` already exist in §12.2
 *     and the budget is at 39 of 40. `vote` is already free in `tick/budget.ts` and the
 *     `LEVY` ballot is already classified peaceful in `world/commons.ts`.
 *   - **`levyStateTable` is registered unconditionally.** The assessment decides what
 *     future ticks do, so a `state_hash` blind to it would call two different worlds
 *     identical, and a halt would leave the book dirty.
 *   - **`checkLevyAttribution` is the A5′ guard** and belongs in the tick's assertions. A
 *     shortfall is an accusation: it drives a sweep, a strike and a demotion, so it is
 *     held to INV-17's standard — reproducible from the journal, or the tick halts.
 *   - **Nothing here halts the world on an agent's input.** Every agent-reachable path
 *     returns a sentence (`voteFault`, `deliveryFault`), never a throw.
 *
 * ## What this module deliberately does not do
 *
 *   - **It does not take a holding.** §14.4's seizure ballot is a *separate* mechanic
 *     aimed at an elective default, and §5.2 forbids the Levy reaching a holding at all.
 *     `SweepPort` cannot express it.
 *   - **It does not touch standing.** INV-21 permits standing to move only on an
 *     elective-honoured settlement, a default, a contradicted seal, or scheduled decay.
 *     Paying a Levy is none of those, and neither is failing to.
 *   - **It does not price anything in identities** (A15). The total is `Σ duty`, additive,
 *     so an extra identity adds its own duty and lowers nobody else's.
 */

export {
  allocate,
  dutyOf,
  isLevyRule,
  isNewcomer,
  largestRemainder,
  LEVY_RULES,
  LevyArithmeticError,
  PUBLISHED_DEFAULT_RULE,
  relievedTotal,
  totalFor,
  weightOf,
  type Allocation,
  type AllocationPlan,
  type LevyRule,
  type LevySubject,
} from './assessment.js';

export {
  ballotFault,
  LEVY_BALLOT,
  namedLoser,
  quorumFor,
  tally,
  type LevyBallot,
  type Tally,
} from './ballot.js';

export {
  Book,
  LevyBookError,
  levyStateTable,
  type ChronicRow,
  type LevyPlan,
  type PaymentRow,
  type ShortfallRow,
} from './book.js';

export {
  assessCycle,
  ballotFor,
  ballotWindow,
  isAssessTick,
  voteFault,
  type AssessedCycle,
  type SubjectRead,
} from './cycle.js';

export {
  LEVY_ASSESS_PHASE,
  LEVY_BALLOT_CLOSES_PHASE,
  LEVY_BASE_COMMONS_CAPACITY,
  LEVY_CHRONIC_STRIKES,
  LEVY_DUTY_PER_PRINCIPAL,
  LEVY_EXPOSURE_UNIT,
  LEVY_GOOD,
  LEVY_INVERSE_WEIGHT_NUM,
  LEVY_MIN_COMMONS_CAPACITY,
  LEVY_NEWCOMER_CAPITAL_MINOR,
  LEVY_NEWCOMER_TENURE_TICKS,
  LEVY_NOMINAL_MINOR,
  LEVY_NON_ESCROWABLE_BPS,
  LEVY_QUORUM_BPS,
  LEVY_RETAINED_RECKONINGS,
  LEVY_SPARE_MIN_NOMINATIONS,
  LEVY_STARTER_ALLOTMENT,
  LEVY_UNIT_MINOR,
  MAX_LEVY_ASSESSMENTS,
  MAX_LEVY_BALLOTS,
  MAX_LEVY_CARRY_OFFERS,
  MAX_TRIBUTE_LINES,
} from './params.js';

export {
  carriageUnderway,
  carrierAt,
  carryableOf,
  creditFor,
  deliveryFault,
  nonEscrowableOf,
  owingOf,
  type Carryable,
  type LevyCarryQuote,
  type Owing,
  type PaymentSplit,
} from './payment.js';

export {
  constellationOf,
  DELIVERY_PLACE_STATEMENT,
  deliveryPlaceOf,
  rollByConstellation,
} from './place.js';

export {
  checkLevyAttribution,
  docketRowsFor,
  inv24InputsFor,
  settleLevy,
  type ExposurePeakRead,
  type LevySettlement,
  type SweepPort,
} from './settle.js';

export { levyShortNow, tributeLinesFor, tributeStateFor } from './tribute.js';
