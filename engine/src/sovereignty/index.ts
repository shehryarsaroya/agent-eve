/**
 * SOVEREIGNTY — SPEC §6.3's recurring upkeep. **Territory that must be MAINTAINED.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHY IT EXISTS, because every design choice in this module follows from it.**
 *
 * §6.3: *"A Marches or Frontier holding **pays upkeep in currency plus manufactured goods**
 * — this is the anti-Sybil price of projecting force (A15) and the economy's primary sink."*
 * Until this landed, `graduate` charged that price **once**, at the crossing, and said so out
 * loud rather than letting an agent discover the recurring half by being billed for it. So
 * territory outside the Commons was a one-off purchase: pay 50,000 and 5,000 goods, and hold
 * a Frontier address forever with nothing further owed. Owning cost nothing to keep, which
 * means there was no economy sink, no reason for a blockade to matter, and nothing that could
 * be *lost* by neglect.
 *
 * A claim is the thing that has to be maintained, and the Charge is the maintenance:
 *
 *   - **The total is fixed by rule and cannot be dodged** (`charge.ts`). That is the alarm.
 *   - **The allocation is a vote among the constellation's claimants** (`ballot.ts`). That is
 *     the drama: a coalition, a protagonist, and a named loser by the group's action.
 *   - **Payable only in goods physically standing at the claimed system, and they are
 *     DESTROYED** (`claim.ts`, `settle.ts`) — locality and consumption, two of the three
 *     enforcements `DRAFT-2-synthesis.md` §2 makes conditions of a goods Charge.
 *   - **Miss it and the claim goes into public arrears; miss three times and it lapses and
 *     the bond is slashed** (`settle.ts`) — with a **published** vulnerability window at the
 *     CONTESTED step, because A14 forbids a mechanic whose drama depends on agents choosing
 *     conflict.
 *   - **A collapse arc, not a death spiral**: partial payment counts, the cure is bounded,
 *     and a failing claimant can sell or give up a claim before it lapses. The ending is a
 *     fire sale or a rescue.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## What the rest of the engine needs to know
 *
 *   - **`assessCharge` and `settleCharge` run in the OBLIGE phase, and the order is a rule.**
 *     `assessCharge` first (a world booting mid-cycle must be assessed before ASSERT asks
 *     whether every claim is on a docket); `settleCharge` **after** the venture batch and
 *     after `settleLevy`, because §5.1's freeze re-reads every payer balance and halts on any
 *     difference — a bond slash moves one.
 *   - **`sovereigntyStateTable` is registered unconditionally.** An arrears counter decides
 *     whether the *next* Reckoning takes a principal's territory and 50,000 of its capital,
 *     so a `state_hash` blind to it would call two worlds identical while one of them was
 *     about to do that. Seven books were found outside the hash on one night; there is not an
 *     eighth here.
 *   - **`checkSovereigntyInvariants` and `checkChargeAttribution` belong in the tick's
 *     `assertions` hook.** SOV-1 is A8 (a Commons claim halts the world) and
 *     `checkChargeAttribution` is A5′ — an arrears is an accusation that ends in taken
 *     territory, so it is held to INV-17's standard: reproducible from the delivery journal,
 *     or the tick halts.
 *   - **`liveObligations().isLive` must be extended with `book.isLive`**, or every posted bond
 *     reads to INV-4 as an orphan lock and halts the tick. That is the market's and
 *     predation's extension for the third time, and it is the same one-line fix.
 *   - **No new verb.** `post_bond` and `build` are already in SPEC §12.2 with no handler;
 *     `deliver`, `vote`, `publish_offer` and `abandon` are live and carry a mode. The §17
 *     budget stays at **40 of 40** — see `../api/verbs.ts` and the note in `ballot.ts`.
 *   - **Nothing here halts the world on an agent's input.** Every agent-reachable path
 *     returns a sentence (`claim.ts`), never a throw.
 *
 * ## What this module deliberately does not do
 *
 *   - **It does not implement the SIEGE.** The economic critic asks that lapse *"require an
 *     attacker to post meaningful stake and win a SIEGE, or a later third miss"*. `SIEGE` is
 *     a `VentureKind` with no mechanic in this build, so the third miss is the whole lapse
 *     trigger and the window is a **takeover** priced in the arrears plus a bond rather than
 *     a battle. Stated in `ARREARS_STATEMENT`, so no agent learns it by being surprised.
 *   - **It does not enforce provenance, or a non-local input category.** Both are conditions
 *     `DRAFT-2-synthesis.md` §2 sets, and both need the production graph (§16 step 11) and
 *     more than one good. `params.ts:CHARGE_GOOD` carries the honest statement: with one
 *     good, a corner on it is a corner on every claim.
 *   - **It does not touch standing.** INV-21 permits standing to move only on an
 *     elective-honoured settlement, a default, a contradicted seal, or scheduled decay. A
 *     lapse is none of those, and neither is paying a Charge.
 *   - **It records no default, ever.** An arrears and a lapse are *world* obligations, like
 *     the Levy's shortfall — not a broken promise to a counterparty, so no `standing` vector
 *     and no snapped map link.
 *   - **It does not price anything in identities** (A15). The total is `Σ` over claims, so an
 *     extra identity adds its claim's own cost and lowers nobody else's. The one hole that is
 *     *not* closed — a Sybil fleet packing the allocation ballot — is named in `ballot.ts`
 *     rather than waved at.
 */

export {
  bondAtRiskFor,
  bondCoversOneMore,
  bondNeededForOneMore,
  postedBondOf,
  requiredBondOf,
  type BondRead,
} from './bond.js';

export {
  Book,
  bondRefFor,
  chargeReckoningOf,
  claimIdFor,
  isChargeRule,
  isClaimState,
  isTerminal,
  sovereigntyStateTable,
  SovereigntyBookError,
  type CessionOffer,
  type ChargeBallot,
  type ChargeLine,
  type ChargePayment,
  type ChargePlan,
  type ChargeRule,
  type ChargeShortfallRow,
  type ClaimId,
  type ClaimRecord,
  type ClaimState,
  type DelinquencyRow,
} from './book.js';

export {
  CHARGE_BALLOT,
  chargeBallotFor,
  chargeBallotWindow,
  chargeConstituencyOf,
  chargeQuorumFor,
  chargeVoteFault,
  tallyCharge,
  type ChargeTally,
} from './ballot.js';

export {
  allocateCharge,
  ChargeArithmeticError,
  chargeOf,
  chargeWeightOf,
  nominalChargeOf,
  PUBLISHED_DEFAULT_CHARGE_RULE,
  relievedChargeTotal,
  totalCharge,
  type ChargeAllocation,
  type ChargeSubject,
} from './charge.js';

export {
  abandonRejection,
  cessionRejection,
  chargeDeliveryFault,
  claimRejection,
  claimRouteFor,
  handAt,
  type ClaimRoute,
} from './claim.js';

export {
  assessCharge,
  inVulnerabilityWindow,
  isChargeAssessTick,
  namedChargeLoser,
  nextChargeFor,
  vulnerabilityViewAt,
  type AssessedCharge,
  type TierRead,
  type VulnerabilityView,
} from './cycle.js';

export {
  checkSov1,
  checkSov2,
  checkSov3,
  checkSov4,
  checkSov5,
  checkSov6,
  checkSov7,
  checkSovereigntyInvariants,
  type SovereigntyInvariantInputs,
} from './invariants.js';

export {
  ANCHOR_QTY,
  ARREARS_STATEMENT,
  assertSovereigntySchedule,
  CESSION_SALVAGE_BPS,
  CHARGE_ARREARS_SURCHARGE_BPS,
  CHARGE_ASSESS_PHASE,
  CHARGE_BALLOT_CLOSES_PHASE,
  CHARGE_BY_TIER,
  CHARGE_GOOD,
  CHARGE_MISSES_TO_LAPSE,
  CHARGE_QUORUM_BPS,
  CHARGE_STATEMENT,
  CLAIM_BOND_MINOR,
  CLAIM_RENT_BPS,
  MAX_CHARGE_BALLOTS,
  MAX_CLAIM_LINES,
  MAX_CLAIMS,
  SOVEREIGNTY_RETAINED_RECKONINGS,
  RENT_STATEMENT,
  SOVEREIGNTY_STATEMENT,
  SovereigntyScheduleError,
  VULNERABILITY_WINDOW,
  VULNERABILITY_WINDOW_TICKS,
} from './params.js';

export {
  chargeDocketRowsFor,
  chargeShortNow,
  checkChargeAttribution,
  settleCharge,
  type ChargeSettlement,
  type SlashPort,
} from './settle.js';

export {
  ARREARS_STEPS,
  bondViewFor,
  cessionRowsFor,
  claimDoNothing,
  claimLegend,
  claimLinesFor,
  claimTickerLine,
  claimViewsFor,
  describeDoNothing,
  NO_CHARGE,
  type BondView,
  type ClaimDoNothing,
  type ClaimView,
  type ClaimViewPort,
  type RentRead,
} from './view.js';
