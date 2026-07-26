/**
 * The assembled world: one object that owns every table the API and the cast read.
 *
 * `src/tick/loop.ts` is deliberately content-free — "the tick loop never learns
 * what a venture is" — so *something* has to know how the world is wired. This is
 * that something, and it is in `src/sim/` rather than `src/api/` because the sim
 * runs headless in CI while the API is one of several front ends onto it.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **NO AGENT-REACHABLE INPUT MAY HALT THE WORLD.**
 *
 * A halt is for *our* bug. An agent that can halt the tick holds a denial of
 * settlement (AGT-X9), which is worse than a crash because it is a weapon.
 *
 * The ledger's mutators **throw** on an overdraft, by design: `transferCurrency`
 * raises `LedgerError` rather than returning a rejection, because inside a
 * settlement an overdraft is an engine bug. But a verb handler is not inside a
 * settlement — it is holding a stranger's JSON. So every ledger call reachable
 * from a verb is (a) preceded by an explicit affordability check that produces a
 * *rejection*, and (b) wrapped, so that if the check and the ledger ever disagree
 * the agent gets a hint and the world keeps running. Belt and braces, because the
 * failure mode of getting this wrong is not a wrong answer, it is an outage in
 * front of an audience.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * What lives here and why:
 *
 *   - **The venture book joins `state_hash` and can be rolled back** through
 *     {@link ventureStateTable}. It rebuilds each row through `createVenture` and
 *     compares the `terms_hash` the constructor produces against the captured one, then
 *     re-captures the whole table and compares the bytes — the same shape
 *     `worldStateTable` uses for hands and holdings. `engine.rollbackGaps` is now empty,
 *     which is the claim a halt's `rollback: 'FULL'` rests on.
 *   - **The Reckoning is wired here, and it is two calls at two ticks.** The freeze
 *     computes the settlement set at the freeze tick and hashes its inputs; the
 *     settlement resolves it at the *next* tick. The gap between them is where a raid
 *     lands, and it is the reason {@link Runtime.committing} refuses a commitment inside
 *     it rather than letting `VERIFY_INPUTS` halt a healthy world.
 *   - **The election is its own verb, per role, restatable until the freeze.** `sign`
 *     binds the terms; {@link Runtime.vElect} decides the payment. The engine never
 *     infers an election, because inferring one deletes A7 and answering §7.6 with our
 *     own arithmetic is worse than not answering it — and it never *locks* one early
 *     either, because a choice fixed at signing has no moment of maximum leverage in it
 *     and A6 is the core loop.
 *   - **Deeds come from deliveries and the tally comes from the venture rows**, by two
 *     roads on purpose ({@link Runtime.deedTallyFor}). A tally counted off the deeds
 *     would make the seal resolver's own completeness check a tautology.
 *   - **Talk, offers and claims are bounded ring buffers.** They are the only
 *     agent-writable text in Phase 0, and unbounded text written by strangers is
 *     scar #3 with a nicer name.
 *   - **The decision census** is what makes `GET /health` able to answer "are
 *     agents actually deciding?" rather than "is the process alive" (scar #14b).
 */

import { canonicalHash, type CanonicalValue } from '../core/canonical.js';
import { Rng } from '../core/rng.js';
import {
  FREEZE_TICKS,
  TICKS_PER_RECKONING,
  inFreeze,
  isSettlementTick,
  reckoningIndex,
  ticksUntilReckoning,
} from '../core/time.js';
import type {
  DecisionSource,
  EventId,
  GoodId,
  Handle,
  HandId,
  HoldingId,
  InvariantViolation,
  PrincipalId,
  SystemId,
  VentureId,
  VentureState,
  ZoneTier,
} from '../core/types.js';
import { bps, minor, qty, sumMinor, type Bps, type Minor, type Qty } from '../core/units.js';
import { EventLedger, type NewEvent } from '../events/index.js';
import {
  CURRENCY_FAUCET,
  DEFAULT_VALUATION_RULE,
  GOODS_FAUCET,
  GOODS_SINK,
  Ledger,
  SimpleObligationBook,
  compareIds,
  escrowAccount,
  openStores,
  openVentureEscrow,
  principalPosition,
  storesAccount,
  ledgerStateTable,
  valueGood,
  type LotId,
  type Valuation,
} from '../ledger/index.js';
// ── THE LEVY (SPEC §5.2) ─────────────────────────────────────────────────────
//
// The mechanic §5.2 calls "the single most important in v3.0", and the reason it is
// wired *here* rather than left as a module: six critics found the Reckoning
// abstention-trivial, and a Levy that exists in `src/levy/` but is not registered on
// the tick is a Levy that has changed nothing. `levyBuilt` in the sim's summary is the
// flag that says whether this wiring happened, and it is read from this file's work.
import {
  Book as LevyBook,
  LEVY_BALLOT,
  LEVY_BASE_COMMONS_CAPACITY,
  LEVY_GOOD,
  LEVY_NOMINAL_MINOR,
  LEVY_STARTER_ALLOTMENT,
  assessCycle,
  ballotFor,
  ballotWindow,
  carrierAt,
  checkLevyAttribution,
  constellationOf,
  creditFor,
  deliveryFault,
  deliveryPlaceOf,
  docketRowsFor,
  inv24InputsFor,
  isLevyRule,
  levyStateTable,
  settleLevy,
  tributeLinesFor,
  voteFault,
  type LevySettlement,
  type LevySubject,
  type SweepPort,
} from '../levy/index.js';
import {
  DefaultRegister,
  HaltController,
  type InvariantInputs,
} from '../invariants/index.js';
import {
  freezeReckoning,
  isElection,
  reckoningViolations,
  runReckoningBatch,
  StandingBook,
  type FrozenReckoning,
  type ObligationPlan,
  type ReckoningOutcome,
  type ReckoningWorld,
  type ReckoningObligations,
} from '../reckoning/index.js';
// §7.1: "there is one function that answers 'what is this role owed', and both the quote
// and the payout read it." `slotClaimAt` is that function with the holder lookup lifted,
// and `test/observe/catalogue.test.ts` pins it against the preview at all three
// percentiles — so reading it here is reading the settlement's own arithmetic rather
// than a second copy of the escrowed/elective split.
import { slotClaimAt } from '../observe/forecast.js';
// The Levy's pixel signature (§5.2, A13). Imported as a *type only*: this runtime
// populates `TributeLine`, it does not define it — `frames/contract.ts` owns the shape and
// the client already draws that one.
import type { AuthorityLine, AuthorityLineState, TributeLine, ReckoningFrame } from '../frames/contract.js';
import { assertInertPublicFacts } from '../frames/projection.js';
import { renderFrame, type FrameSource, type SettledView } from '../frames/render.js';
// `agent.md` §6's own field names for the Levy block, typed once in the observation
// layer. Imported as a type so this runtime fills the published shape rather than
// inventing a second one (§3).
import type { LevyBlock } from '../observe/sources.js';
import {
  SealBook,
  cmpDeeds,
  type Deed,
  type SealMeasure,
  type SealRoleRef,
  type SealWorldIndex,
} from '../seal/index.js';
import {
  Engine,
  EngineError,
  MAX_QUEUED_PER_PRINCIPAL,
  tickInputsFor,
  type ActionRequest,
  type CascadeAttempt,
  type EngineOptions,
  type ObligationSource,
  type PhaseContext,
  type QueuedAction,
  type StateTable,
  type SubmittedAction,
  type TickReport,
  type VerbHandler,
} from '../tick/index.js';
// The canonical readers, from the module that owns the snapshot format. Imported
// directly rather than through `../tick/index.js` — which does not re-export them —
// because a second set of "read an integer out of a capture" helpers in this file
// would be two homes for the one rule that decides whether a restore is faithful.
// Aliased on import: this file already has `readInt`/`readString` for **agent
// params**, which are a stranger's JSON and coerce leniently, while these are for a
// machine-written capture and throw. One name for both would be §3's violation on
// the pair of functions where leniency and strictness are the whole difference.
import {
  readArray as snapArray,
  readInt as snapInt,
  readIntOrNull as snapIntOrNull,
  readObject as snapObject,
  readString as snapString,
  readStringOrNull as snapStringOrNull,
} from '../tick/snapshot.js';
import {
  allocateFills,
  activate,
  allRoleIndices,
  computeProceeds,
  countersign,
  createVenture,
  drawResidual,
  electiveFloor,
  electiveTotal,
  escrowRequired,
  filledIndices,
  IN_FULL,
  isEscrowable,
  isFullyFilled,
  kindSpec,
  NEUTRAL_STAGE_BPS,
  openIndices,
  partiesOf,
  pinnedAt,
  proceedsBand,
  roleOfPrincipal,
  roleTerms,
  scaleByBps,
  shareTerms,
  vacateRole,
  VentureBook,
  VENTURE_KINDS,
  yourTakeAtP50,
  type Election,
  type FillRequest,
  type SettlementAccounts,
  type VentureRecord,
} from '../venture/index.js';
import { MAX_GRANT_SPENDS, GrantBook, grantsStateTable } from '../grant/index.js';
// ── THE MARKET (SPEC §12.2 `trade`, PASS-ECONOMY-RISK-extended §4/M1) ────────
//
// Wired here for the same reason the Levy is: a book that exists in `src/market/`
// and is not registered on the tick is a book nobody can trade on. Three
// registrations make it real — the state table (so orders join `state_hash` and the
// abort path), the `MARKETS` phase handler (so it clears inside the tick, in its
// named slot, once), and the `trade` verb.
import {
  MarketBook,
  TRADE_OPERATIONS,
  booksFor,
  cancelOrder,
  checkMarketInvariants,
  checkReplacement,
  clearMarkets,
  marketStateTable,
  MARKET_FEES,
  ownOrdersFor,
  ownPrintsFor,
  placeOrder,
  publicBook,
  recentPrints,
  type ClearReport,
  type Order,
  type OrderId,
  type PlaceContext,
  type Side,
  type TimeInForce,
  type TradeRequest,
  type VenueId,
} from '../market/index.js';
// ── PREDATION (SPEC §9, §16 step 12) — the mechanic A14 was missing ─────────
//
// `PREDATE` was a documented no-op hook from commit #1 and the live world ran thousands
// of ticks with no conflict in it, because nothing forced any. This is the wiring that
// fills the slot: a state table, a phase handler, three verbs that already existed in
// §12.2, and an assertions entry carrying PRD-1 (A8) and PRD-3 (A5′).
import {
  Book as RaidBook,
  MAX_SEIZE_LOTS,
  RAID_JOIN_STAKE_MINOR,
  assertRaidSchedule,
  checkPredationInvariants,
  payDemand,
  raidLinesFor,
  raidStateTable,
  raidTickerLine,
  raidViewsFor,
  runPredate,
  scheduleAt,
  type AssailablePile,
  type PredationPort,
  type RaidId,
  type RaidOutcome,
  type RaidRecord,
  type RaidSchedule,
  type RaidView,
} from '../predation/index.js';
import { MAX_RAID_LINES } from '../frames/contract.js';
import type { Grant, GrantId, RoleTerms, VentureKind } from '../core/types.js';
import {
  DEFENDER_SIDE,
  createWorld,
  enroll,
  handsOf,
  holdingOf,
  isPresent,
  launchMap,
  loseHand,
  principalIsCommonsBound,
  reject,
  releaseHand,
  tierOf,
  type Enrolment,
  type Rejection,
  type WorldResult,
  type WorldState,
} from '../world/index.js';

/** The rules version every row this runtime writes is pinned to (INV-15). */
/**
 * The rules generation. **Bump this whenever a change alters what a PAST tick would
 * compute** — not when a verb is added, not when a message is reworded, but whenever
 * replaying the existing journal under the new build would produce a different
 * `state_hash`.
 *
 * It is stamped on events and read by boot, which compares the journalled value with the
 * running one and reports `journal N -> running M` when a replay diverges. A divergence
 * with the version unmoved says "the arithmetic changed and nobody declared it"; a
 * divergence with the version moved says "this was deliberate, and here is the
 * generation boundary". Only the second is a record anyone can audit later.
 *
 * ## 1 → 2 (2026-07-25)
 *
 * The `EncumbranceBook` entered the hashed capture. Open locks had been in no state
 * table at all, so `state_hash` could not see escrow, an aborted tick kept its locks, and
 * a snapshot-restored world had escrowed stake silently spendable (A5′). Closing that
 * necessarily changes the hash of **every** tick, including ticks already journalled —
 * so this is the exact case this constant exists for, and the live world crossed the
 * boundary through the operator door at tick 287 rather than by pretending nothing moved.
 *
 * ## 2 → 3 (2026-07-25)
 *
 * **Predation landed** (SPEC §9, §16 step 12). `PREDATE` stopped being a no-op hook, the
 * raid book entered the hashed capture as a new state table, and the phase now draws
 * from its own seeded sub-stream. Each of the three is enough on its own: a new table
 * changes `state_hash` at every tick including journalled ones, and a phase that draws
 * changes what a replay of the existing log computes.
 *
 * The sub-stream is the *reason the rest did not move*: `PREDATE` has held its slot and
 * its `Rng.derive('PREDATE')` label since commit #1 precisely so that filling it could
 * not shift `MOVE`, `HAZARD` or any other phase's draws. So this boundary is the raid
 * book entering the hash, and nothing else.
 *
 * ## 3 → 4 (2026-07-26)
 *
 * **A raid joiner's force is now measured at resolution, not at join.** `readForce`
 * counted `raid.parties` by side, so a joiner that marched its hand out of the stage
 * during the window still contributed a full unit of force — and `routHand`, which
 * requires an `IDLE` hand, then declined to rout it. A verifier walked it: join at 49,
 * `move` at 71, resolve at 72. The raider dodged the hand half of its risk, and a
 * **defender** joiner — which stakes no capital at all — dodged its risk entirely and
 * could grant a free repulse to anyone, forever.
 *
 * The target's own hands were always re-counted at resolution, so this also removes an
 * asymmetry that contradicted the book's own rule: *force is per hand, and one hand is
 * one unit of simultaneous presence* (§3). A replay of any journalled tick in which a
 * joiner's hand had left the stage now computes a different verdict, which is exactly
 * what this constant is for.
 */
export const RULES_VERSION = 4;

/**
 * Rows served in any market list. Matches `api/observe.ts:MAX_LIST_ROWS` in value and
 * is declared here rather than imported, because that module imports *this* one and a
 * cycle for one integer is not a trade worth making. INV-26: bounded, published.
 */
export const MAX_MARKET_ROWS = 24;

/** The starter stake, in minor units. §12.5: "a bound starter stake". */
/**
 * Re-exported from its new home. The enrolment grant and the endowment FLOOR must be the
 * same number — two homes for one quantity is scar #5, and a drift between them silently
 * reopens D7 — so `ledger/endowment.ts` owns it and this is the alias callers already use.
 */
export { STARTER_STAKE } from '../ledger/endowment.js';
import { STARTER_STAKE } from '../ledger/endowment.js';

/** INV-26: raid ticker lines retained for the frame. Bounded, published. */
export const MAX_RAID_TICKER_LINES = 32;

/** Ticks a formation window stays open by default. */
export const FORMATION_WINDOW_TICKS = 12;

/** Bound on every agent-written text buffer (INV-26, scar #3). */
export const MAX_TALK_ENTRIES = 512;
export const MAX_OFFER_ENTRIES = 256;
export const MAX_CLAIM_ENTRIES = 512;

/** §11.1: the public `reason` is hard-capped at 140 characters. */
export const MAX_REASON_LENGTH = 140;

/** §7.3: a message carries up to 480 characters of prose. */
export const MAX_MESSAGE_LENGTH = 480;

/** Ticks of decision history the health census keeps. Bounded, per scar #3. */
export const CENSUS_WINDOW_TICKS = TICKS_PER_RECKONING;

/**
 * How long before its own settlement a venture must have finished delivering.
 *
 * `FREEZE_TICKS + 1`, and every term of that is load-bearing. Delivery credits the
 * venture's escrow and appends a row naming the venture, so a delivery **inside the
 * freeze** would (a) move a figure the settlement was computed from — the drained-payer
 * shape §15.4 calls the top engineering risk, reported by `VERIFY_INPUTS` as a halt —
 * and (b) be an event touching an object in the settlement set, which is INV-18's halt.
 * So the last legal delivery tick is `resolvesAtTick - FREEZE_TICKS - 1`, one clear tick
 * before the freeze begins.
 *
 * {@link nextSettlementAtOrAfter} is applied to `windowClosesTick + DELIVERY_LEAD_TICKS`
 * for exactly this reason, so `windowClosesTick <= resolvesAtTick - DELIVERY_LEAD_TICKS`
 * holds for every venture `create` mints and a venture can always reach its delivery.
 */
export const DELIVERY_LEAD_TICKS = FREEZE_TICKS + 1;

/** Elections held for un-resolved ventures. Bounded (INV-26, scar #3). */
export const MAX_ELECTIONS = 2_048;

/**
 * The longest a grant may live: ~3 Reckonings (SPEC §8.1 #5, scar #7 — the sticky
 * vow). A short life is what makes each renewal a *decision* and keeps "months of
 * honest work" a visible chain of renewals rather than one unrevisable grant.
 */
export const GRANT_MAX_LIFETIME_TICKS = 3 * TICKS_PER_RECKONING;

/**
 * A total cap on the grant book (INV-26): a principal that minted grants without
 * limit would bloat `state_hash` and every capture. Generous, because grants expire
 * and a real world clears them by time; deterministic pruning of expired rows is a
 * follow-on (until then a long season is bounded by this, not by expiry).
 */
export const MAX_GRANTS = 4_096;

/**
 * The named grant templates (SPEC §8: "ship 5–8 named templates"). For now these are
 * labels an agent picks so a receipt reads as an *office* rather than a raw limit
 * pair; server-computed per-template worst cases are a follow-on. `custom` is the
 * escape hatch for an explicit, un-templated limit pair.
 */
export const GRANT_TEMPLATES: readonly string[] = Object.freeze([
  'treasury-hand',
  'quartermaster',
  'escort-captain',
  'factor',
  'steward',
  'custom',
]);

/**
 * Statements accepted into the **open window** and not yet resolved. Bounded (INV-26).
 *
 * The window itself is bounded — {@link MAX_QUEUED_PER_PRINCIPAL} per principal, and a
 * total cap in `tick/queue.ts` — so this map is already bounded by somebody else's
 * arithmetic. It carries its own published cap anyway, because "bounded by a cap in
 * another module" is exactly how scar #3's structure was argued safe.
 */
export const MAX_IN_FLIGHT_ELECTIONS = MAX_QUEUED_PER_PRINCIPAL * 32;

/**
 * Venture states in which an election is still a live statement — **one home, three
 * readers**: `vElect`'s door, the `elect` affordance, and the cast's policy.
 *
 * Three copies of this list is three chances for the engine to accept an election the
 * affordance did not offer, or to offer one the engine will refuse (AGT-S2). It was
 * written out three times before this constant existed.
 *
 * `DEFERRED` belongs here and it is not an oversight: §15.3's deferral carries the *same
 * pot* to the next Reckoning, {@link Runtime.settleNow} deliberately does not release a
 * deferred venture's election, and the payer's choice is therefore still ahead of it.
 * Everything absent from this list is terminal, and an election on a terminal obligation
 * is a book entry that is never released — see the note in {@link Runtime.vElect}.
 */
export const ELECTABLE_VENTURE_STATES: readonly VentureState[] = Object.freeze([
  'FORMING',
  'LIVE',
  'DEFERRED',
] as VentureState[]);

/** Reckonings of deed rows retained. Two: this one and the one being settled. */
export const DEED_RETAINED_RECKONINGS = 2;

/** Bound on the restore-fault log and the event-append fault log (INV-26). */
export const MAX_TABLE_FAULTS = 16;

/**
 * The event kind a delivery is recorded under.
 *
 * Declared here rather than added to `VENTURE_EVENT_KINDS`, which is the venture
 * module's and holds only the kinds *that module* writes. It is deliberately not
 * matched by `isDefaultEventKind` — a delivery accuses nobody — and
 * `test/sim/reckoning.test.ts` pins that, because a kind the attribution index thought
 * was an accusation would demand evidence for a row that is good news.
 */
export const DELIVERY_EVENT_KIND = 'venture.delivered';

/**
 * The unit a `venture.delivered` deed is measured in.
 *
 * One measure, and it is `MINOR`, because the only thing this build can measure about a
 * delivery is the value it realised. Handed to the seal book as
 * {@link SealWorldIndex.measureOfVerb} so a seal banded in `QTY` or `BPS` against a
 * delivery verb is refused **at the door** with a sentence, instead of becoming an
 * unjudgeable seal at the Reckoning (scar #8: when the penalty is permanent and public,
 * prefer precision over recall).
 */
export const DELIVERY_MEASURE: SealMeasure = 'MINOR';

/**
 * The **declared verb** a delivery is recorded under, for seal judgement.
 *
 * `Deed.verb` must be one of SPEC §12.2's verbs — `deedFaults` refuses anything else,
 * because a verdict is computed by comparing a sealed verb against a done verb and a
 * deed naming a word the canon does not have could never match a legal seal. Of the
 * thirty-eight, `haul` is the one that names *moving produced value to where it is
 * owed*, which is what a venture's delivery is.
 *
 * It is deliberately **not** `deliver`: §12.2 gives that word to the Levy, and one word
 * for two payments is scar #1 with money attached.
 *
 * Handed to the seal book as {@link SealWorldIndex.measureOfVerb}, so a seal banded in
 * `QTY` or `BPS` against it is refused **at the door** with a sentence rather than
 * becoming an unjudgeable seal at the Reckoning (scar #8).
 */
export const DELIVERY_VERB = 'haul';

/** Reckonings of settlement summaries the report keeps. Bounded (INV-26, scar #3). */
export const MAX_RECKONING_SUMMARIES = 8;

/**
 * What to add to a refused fill's own sentence, per `RefusalReason`.
 *
 * The allocator already writes the *fact*; this writes what the agent should do about it,
 * which is the half `agent.md` §7 promises and the half a refusal is useless without.
 * Keyed on the union so a new reason is a compile error rather than a silent blank.
 */
export const FILL_REFUSAL_NOTE: Readonly<Record<'LOST_CONTEST' | 'HAND_COMMITTED' | 'ROLE_RULE', string>> =
  Object.freeze({
    LOST_CONTEST:
      'Another principal took this slot in the same tick. A contest is decided by the initiator\'s stated ' +
      'preference, then by stake, and never by who arrived first — so sending it again faster will not help. ' +
      'The board in your next observation is already without it.',
    HAND_COMMITTED:
      'Nothing was charged and the hand keeps the role it already has. Send a different hand, or wait for that ' +
      'venture to resolve.',
    ROLE_RULE: 'Nothing was charged. Read the open roles in ventures.board[] and send one of those.',
  });

/**
 * What the Levy did in one Reckoning, counted from the settlement's own output.
 *
 * `shortMinor` is `LEVY SHORT` — §14.2's headline, *"a world fact nobody can lower alone,
 * which rises when the population turtles"*. It is reported beside `assessed` and
 * `paidInFull` for the same reason `defaults` is reported beside `electiveHonoured`: a
 * zero on its own is unreadable. Zero short with twelve assessed is a constellation that
 * paid; zero short with **zero assessed** is the Levy not running at all, which is the
 * abstention-trivial failure the whole mechanic exists to delete — and a summary that
 * could not tell those apart would be the flattering version of this measurement.
 */
export interface LevySummary {
  readonly reckoning: number;
  readonly tick: number;
  readonly assessed: number;
  readonly paidInFull: number;
  readonly totalMinor: Minor;
  readonly shortMinor: Minor;
  readonly sweptQty: Qty;
  readonly sweepQueue: number;
  readonly demoted: number;
  /** Constellations whose allocation fell to the published formula (quorum failed). */
  readonly byDefault: number;
  readonly ballotsCast: number;
}

/**
 * Venture states that imply the venture reached `LIVE` and therefore **delivered**.
 *
 * Load-bearing for the deed tally, which is derived from these rows and never from the
 * deed array (see {@link Runtime.deedTallyFor}). A venture reaches `LIVE` only inside
 * its formation window, and `windowClosesTick <= resolvesAtTick - DELIVERY_LEAD_TICKS`
 * holds for every venture `create` mints, so activation is always at or before the
 * delivery tick and "reached LIVE" implies "delivered at its delivery tick".
 * `ABANDONED` is absent for the same reason: it never went live, so nothing was done.
 */
const DELIVERED_STATES: readonly VentureState[] = Object.freeze([
  'LIVE',
  'DEFERRED',
  'SETTLED',
  'DEFAULTED',
] as VentureState[]);

// ── Agent-written text, bounded ─────────────────────────────────────────────

export interface TalkEntry {
  readonly venture: VentureId;
  readonly from: PrincipalId;
  /** §7.3's typed acts. Lower case so it never reads as a canon term. */
  readonly act: 'offer' | 'counter' | 'accept' | 'decline' | 'assure';
  readonly text: string;
  readonly tick: number;
}

export interface OfferEntry {
  readonly by: PrincipalId;
  readonly text: string;
  readonly tick: number;
}

/**
 * A refusal that could only be known once the tick resolved.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **Why this buffer exists at all**, because it is the least obvious thing in this
 * file. `Engine.submit` gives an honest *submit-time* verdict — the Commons floor,
 * the verb table, the queue caps — but it does not run the verb handler, and it
 * must not: the handler mutates, and running it at submit would be an action
 * reacting to a within-tick decision (§15.2).
 *
 * So a `move` to a non-adjacent system is **accepted at submit and refused at
 * VALIDATE+LOCK**, one tick later. `agent.md` §7 promises the agent gets back "the
 * invariant you violated, what changed, the nearest legal thing you could do
 * instead" — and for this class of refusal there is nothing to give back yet when
 * the response is written.
 *
 * Dropping it is not an option: an agent whose action silently evaporated cannot
 * tell that from the world changing underneath it, which is PROP-O1's failure shape
 * applied to writes. So the refusal is held here, per principal, bounded, and
 * delivered on the agent's next read. It is a **hint, not an event** — it is never
 * appended to the ledger (scar #10).
 * ══════════════════════════════════════════════════════════════════════════
 */
export interface PendingCorrection {
  readonly tick: number;
  readonly verb: string;
  readonly clientSequence: number;
  readonly invariant: string;
  readonly hint: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/** Corrections held per principal awaiting delivery. Bounded (INV-26, scar #3). */
export const MAX_PENDING_CORRECTIONS = 16;

export interface ClaimEntry {
  readonly by: PrincipalId;
  readonly text: string;
  /** True for `deny`, false for `claim`. One buffer, because both are just words. */
  readonly denial: boolean;
  readonly tick: number;
}

/** A bounded FIFO. Drops the oldest, and says how many it has dropped. */
class Ring<T> {
  private readonly items: T[] = [];
  private dropped = 0;

  constructor(private readonly cap: number) {}

  push(item: T): void {
    this.items.push(item);
    while (this.items.length > this.cap) {
      this.items.shift();
      this.dropped += 1;
    }
  }

  get all(): readonly T[] {
    return this.items;
  }

  get size(): number {
    return this.items.length;
  }

  get droppedCount(): number {
    return this.dropped;
  }
}

// ── The decision census (scar #14b) ─────────────────────────────────────────

/**
 * Who decided, over a rolling window of ticks.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **SCAR #14b.** High Water ran for hours looking perfectly healthy while its LLM
 * players had silently fallen back to heuristics. Every liveness probe was green.
 * The interesting property — *are agents actually deciding?* — was never measured,
 * so nobody could have noticed.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `decision_source` is a non-retrofittable event field for exactly this reason
 * (§15.1: "without which R3, R4 and the A4 audit are unmeasurable"). This class is
 * the projection that makes it answerable in one HTTP call.
 */
export class DecisionCensus {
  private readonly byTick = new Map<number, Map<DecisionSource, number>>();

  constructor(private readonly windowTicks: number = CENSUS_WINDOW_TICKS) {}

  record(tick: number, source: DecisionSource): void {
    const row = this.byTick.get(tick) ?? new Map<DecisionSource, number>();
    row.set(source, (row.get(source) ?? 0) + 1);
    this.byTick.set(tick, row);
    for (const t of [...this.byTick.keys()]) {
      if (t <= tick - this.windowTicks) this.byTick.delete(t);
    }
  }

  /** Totals over the window, in a fixed key order so the output is diffable. */
  distribution(): Readonly<Record<DecisionSource, number>> {
    const out: Record<DecisionSource, number> = {
      LIVE: 0,
      INTENT: 0,
      DELEGATE: 0,
      HEURISTIC: 0,
      FALLBACK: 0,
    };
    for (const row of this.byTick.values()) {
      for (const [source, n] of row) out[source] += n;
    }
    return out;
  }

  get total(): number {
    let n = 0;
    for (const value of Object.values(this.distribution())) n += value;
    return n;
  }

  /** Ticks retained. Asserted by the soak test: this is the boundedness claim. */
  get retainedTicks(): number {
    return this.byTick.size;
  }
}

// ── Delivery, and what the Reckoning did ────────────────────────────────────

/**
 * One venture's delivery: the tick its output was realised, and what it realised.
 *
 * **The producer's own record**, and the deed set's only source. `holders` is a
 * snapshot of who filled each role *at the moment the value landed*, because a deed is
 * a fact about what happened and not a re-derivation from rows that may move later.
 *
 * The tally the completeness witness carries is deliberately built from the **venture
 * rows** instead ({@link Runtime.deedTallyFor}), so the two numbers `SealBook.resolve`
 * compares reach it by two roads. A tally counted off this structure — or off the deed
 * array — would make that comparison a tautology, which is the §15.4 false-mark route
 * one layer up.
 */
export interface DeliveryRecord {
  readonly venture: VentureId;
  readonly tick: number;
  /** Pinned. A deferral's second pass divides the same pot (§15.3). */
  readonly proceeds: Minor;
  /** The state version the amount was measured against (scar #6, INV-19). */
  readonly stateVersion: number;
  /** The row in the record that is this delivery's ground truth. */
  readonly eventId: EventId;
  readonly holders: readonly PrincipalId[];
}

/** One Reckoning, as the report reads it. Everything here is counted, never inferred. */
export interface ReckoningSummary {
  readonly reckoning: number;
  readonly tick: number;
  /** True only when the published pointer moved (§15.3's fails-closed transaction). */
  readonly committed: boolean;
  readonly obligations: number;
  readonly settled: number;
  readonly defaulted: number;
  readonly deferred: number;
  /** Accusations published, each with its cause as a column (INV-17). */
  readonly defaults: number;
  readonly electiveHonoured: number;
  readonly standingMoves: number;
  readonly sealsJudged: number;
  readonly sealsContradicted: number;
  /** Judged once, closed with no mark. A healthy Reckoning defers nothing. */
  readonly sealsUnmarked: number;
  /** The deed query and the deed tally disagreeing. Healthy is zero. */
  readonly deedSetFaults: number;
  readonly unattributed: Minor;
  readonly recordedLoss: Minor;
  readonly proceeds: Minor;
  readonly paidEscrowed: Minor;
  readonly paidElective: Minor;
}

// ── The venture state table ─────────────────────────────────────────────────

/**
 * The venture book, as a hashed state table **with a restore path**.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * This `restore` used to be absent, and the reason it gave was sound: rebuilding a
 * `VentureRecord` from a canonical blob by hand means re-authoring, in this file, the
 * shape `src/venture/venture.ts` owns — a second constructor for the keystone object,
 * which is scar #5 on the social object the whole design rests on.
 *
 * What was wrong was the conclusion, not the argument. `worldStateTable` faced exactly
 * the same problem and solved it: it rebuilds each hand and holding **through the world
 * module's own constructors** and then asserts the derived id matches the captured one.
 * So this does the same — `createVenture` is the only constructor, `termsHash` is
 * recomputed by it and compared against the captured hash, and the mutable fields are
 * written back afterwards. Nothing here authors a venture; it asks the venture module to
 * and then checks the answer.
 *
 * Two things make that check real rather than decorative:
 *
 *   - **`termsHash` is the witness.** It covers id, kind, creator, stage, every role's
 *     label and terms, all three window ticks, the pinned valuation *and* its as-of
 *     tick, and `rules_version`. A restore that got any of them wrong produces a
 *     different hash and is refused, loudly, instead of producing a world that is
 *     *slightly* different while every hash it is later compared by agrees.
 *   - **The whole table is re-captured and compared** before the restore returns. That
 *     is `Engine.adoptSnapshot`'s own load-bearing line, applied one level down: it
 *     asserts the restore reproduced the captured *bytes* rather than merely running.
 *
 * `VentureBook.add` was already written for this — "a venture may arrive already filled
 * (a replay from a snapshot), so the index is built from the rows" — so the partial
 * unique index comes back from the rows rather than from a captured copy of itself
 * (scar #5 again, and the same reason `worldStateTable` derives `handsByPrincipal`).
 *
 * The book is **replaced**, not emptied, because `VentureBook` exposes no removal door
 * and must not grow one: a venture created during the aborted tick has to be gone
 * afterwards, and `add` refuses a duplicate id. That is why the runtime holds its book
 * behind a getter.
 * ══════════════════════════════════════════════════════════════════════════
 */
export function ventureStateTable(
  read: () => VentureBook,
  write: (book: VentureBook) => void,
): StateTable {
  const capture = (): CanonicalValue =>
    read()
      .all()
      .map((v) => ({
        id: v.id,
        kind: v.kind,
        creator: v.creator,
        state: v.state,
        visibility: v.visibility,
        stage: v.stage,
        windowOpensTick: v.windowOpensTick,
        windowClosesTick: v.windowClosesTick,
        resolvesAtTick: v.resolvesAtTick,
        termsHash: v.termsHash,
        actedOnStateVersion: v.actedOnStateVersion,
        resolvedAtTick: v.resolvedAtTick,
        deferrals: v.deferrals,
        escrowExecutedAtTick: v.escrowExecutedAtTick,
        rulesVersion: v.rulesVersion,
        // The pinned valuation rule *and* its as-of tick are inside `terms_hash`
        // (§15.4), so the capture has to carry the tick or the restore cannot
        // reproduce the hash it is checked against. The rule itself is this runtime's
        // one rule; a venture carrying another would fail the hash check rather than
        // be silently rebuilt with the wrong one.
        valuationAsOfTick: v.valuation.asOfTick,
        preference: [...v.preference],
        countersigned: [...v.countersigned].sort(compareIds),
        roles: v.roles.map((r) => ({
          index: r.index,
          label: r.label,
          wage: r.terms.wage,
          share: r.terms.share,
          escrowed: r.terms.escrowed,
          elective: r.terms.elective,
          filledByHandId: r.filledByHandId,
          filledByPrincipal: r.filledByPrincipal,
          filledAtTick: r.filledAtTick,
          // Cleared by settlement, so it is mutable state and belongs in the hash.
          // Its absence was a hole in `state_hash` on the field INV-4 reads.
          stakeEncumbranceId: r.stakeEncumbranceId,
          settledEscrowedMinor: r.settledEscrowedMinor,
          settledElectiveMinor: r.settledElectiveMinor,
        })),
      }));

  return {
    name: 'venture',
    capture,
    restore(captured: CanonicalValue): void {
      const rows = snapArray(captured, 'venture');
      const rebuilt = new VentureBook();
      for (const [i, raw] of rows.entries()) {
        rebuilt.add(readVenture(raw, `venture[${String(i)}]`));
      }
      write(rebuilt);
      const recaptured = canonicalHash(capture());
      const expected = canonicalHash(captured);
      if (recaptured !== expected) {
        throw new VentureRestoreError(
          `the venture table did not restore to the bytes it captured (${recaptured.slice(0, 12)} vs ` +
            `${expected.slice(0, 12)}); a rollback that reproduces a slightly different book would make ` +
            'every later hash comparison agree about two different worlds',
        );
      }
    },
  };
}

/** A restore that did not reproduce its capture. Engine-side, and never an agent's. */
export class VentureRestoreError extends Error {}

/**
 * One venture, rebuilt through `createVenture` and then checked.
 *
 * Every field written after construction is one that a phase mutates; everything else
 * is an argument to the constructor and is covered by the `terms_hash` comparison.
 */
function readVenture(raw: CanonicalValue, where: string): VentureRecord {
  const o = snapObject(raw, where);
  const kind = snapString(o, 'kind', where);
  if (!VENTURE_KINDS.includes(kind as VentureKind)) {
    throw new VentureRestoreError(`${where}: ${kind} is not a venture kind`);
  }
  const visibility = snapString(o, 'visibility', where);
  if (visibility !== 'PUBLIC' && visibility !== 'PARTIES') {
    throw new VentureRestoreError(`${where}: a venture is PUBLIC or PARTIES, not ${visibility}`);
  }
  const roleRows = snapArray(o['roles'] ?? [], `${where}.roles`).map((row, i) =>
    snapObject(row, `${where}.roles[${String(i)}]`),
  );
  const terms: RoleTerms[] = roleRows.map((row, i) =>
    roleTerms({
      wage: readMinorOrNull(row, 'wage', `${where}.roles[${String(i)}]`),
      share: readBpsOrNull(row, 'share', `${where}.roles[${String(i)}]`),
      escrowed: minor(snapInt(row, 'escrowed', `${where}.roles[${String(i)}]`)),
      elective: minor(snapInt(row, 'elective', `${where}.roles[${String(i)}]`)),
    }),
  );

  const made = createVenture({
    id: snapString(o, 'id', where) as VentureId,
    kind: kind as VentureKind,
    creator: snapString(o, 'creator', where) as PrincipalId,
    stage: snapString(o, 'stage', where) as SystemId,
    terms,
    windowOpensTick: snapInt(o, 'windowOpensTick', where),
    windowClosesTick: snapInt(o, 'windowClosesTick', where),
    resolvesAtTick: snapInt(o, 'resolvesAtTick', where),
    valuation: pinnedAt(DEFAULT_VALUATION_RULE, snapInt(o, 'valuationAsOfTick', where)),
    rulesVersion: snapInt(o, 'rulesVersion', where),
    visibility,
    preference: snapArray(o['preference'] ?? [], `${where}.preference`).map((p, i) => {
      if (typeof p !== 'string') throw new VentureRestoreError(`${where}.preference[${String(i)}]`);
      return p as PrincipalId;
    }),
  });
  if (!made.ok) {
    throw new VentureRestoreError(`${where}: ${made.invariant} ${made.hint}`);
  }
  const venture = made.value;

  // The witness. `terms_hash` covers every constructor argument, so a reconstruction
  // that differs anywhere shows up here rather than as a quietly different world.
  const captured = snapStringOrNull(o, 'termsHash', where);
  if (captured !== venture.termsHash) {
    throw new VentureRestoreError(
      `${where}: the snapshot's terms_hash is ${String(captured)?.slice(0, 12)} and the rebuilt row hashes ` +
        `to ${String(venture.termsHash).slice(0, 12)}; the capture and the constructor disagree about the terms`,
    );
  }

  const state = snapString(o, 'state', where);
  if (!VENTURE_STATES.includes(state as VentureState)) {
    throw new VentureRestoreError(`${where}: unknown venture state ${state}`);
  }
  venture.state = state as VentureState;
  venture.actedOnStateVersion = snapIntOrNull(o, 'actedOnStateVersion', where);
  venture.resolvedAtTick = snapIntOrNull(o, 'resolvedAtTick', where);
  venture.deferrals = snapInt(o, 'deferrals', where);
  venture.escrowExecutedAtTick = snapIntOrNull(o, 'escrowExecutedAtTick', where);
  for (const p of snapArray(o['countersigned'] ?? [], `${where}.countersigned`)) {
    if (typeof p !== 'string') throw new VentureRestoreError(`${where}.countersigned: expected ids`);
    venture.countersigned.add(p as PrincipalId);
  }
  for (const [i, row] of roleRows.entries()) {
    const at = `${where}.roles[${String(i)}]`;
    const role = venture.roles[i];
    if (role === undefined) throw new VentureRestoreError(`${at}: the kind has no role at that index`);
    if (snapInt(row, 'index', at) !== role.index || snapString(row, 'label', at) !== role.label) {
      throw new VentureRestoreError(`${at}: the snapshot's role does not line up with the kind's template`);
    }
    role.filledByHandId = snapStringOrNull(row, 'filledByHandId', at) as HandId | null;
    role.filledByPrincipal = snapStringOrNull(row, 'filledByPrincipal', at) as PrincipalId | null;
    role.filledAtTick = snapIntOrNull(row, 'filledAtTick', at);
    role.stakeEncumbranceId = snapStringOrNull(row, 'stakeEncumbranceId', at);
    role.settledEscrowedMinor = minor(snapInt(row, 'settledEscrowedMinor', at));
    role.settledElectiveMinor = minor(snapInt(row, 'settledElectiveMinor', at));
  }
  return venture;
}

/** Every state a venture row may hold. `core/types.ts` owns the union; this is its list. */
const VENTURE_STATES: readonly VentureState[] = Object.freeze([
  'FORMING',
  'LIVE',
  'SETTLED',
  'DEFAULTED',
  'DEFERRED',
  'ABANDONED',
] as VentureState[]);

function readMinorOrNull(
  row: { readonly [k: string]: CanonicalValue },
  key: string,
  where: string,
): Minor | null {
  const raw = snapIntOrNull(row, key, where);
  return raw === null ? null : minor(raw);
}

function readBpsOrNull(
  row: { readonly [k: string]: CanonicalValue },
  key: string,
  where: string,
): Bps | null {
  const raw = snapIntOrNull(row, key, where);
  return raw === null ? null : bps(raw);
}

// ── Options ─────────────────────────────────────────────────────────────────

export interface RuntimeOptions {
  readonly seed: string;
  /** Seats. Bounded per SEC-7; the API's `SeatBook` holds the same number. */
  readonly startTick?: number;
  readonly actionsPerTick?: number;
  /**
   * Hazards on or off. Phase 0 has no hazard content yet, so this is recorded and
   * reported rather than acted on — and it is recorded so that the false-default
   * audit's two modes (§15.4) have a switch to read when the content lands.
   */
  readonly hazards?: boolean;
}

/** Default terms for a kind, derived from the kind's own template. */
export function defaultTerms(kind: VentureKind, value: Minor): readonly RoleTerms[] {
  const spec = kindSpec(kind);
  const out: RoleTerms[] = [];
  for (const role of spec.roles) {
    // A role's share of the residual is its marginal contribution to the yield:
    // one number, used both to price the slot and to divide the proceeds, so the
    // quote an agent is shown and the split it is paid come from one place.
    const share = role.marginalOutputBps;
    const consideration = scaleByBps(value, share);
    const priced = consideration > 0 ? consideration : minor(1);
    if (!isEscrowable(kind)) {
      out.push(shareTerms(share, minor(0), priced));
      continue;
    }
    const floor = electiveFloor(kind, priced);
    const elective = floor > priced ? priced : floor;
    out.push(shareTerms(share, minor(priced - elective), elective));
  }
  return out;
}

/**
 * `Engine`, plus the one fact the runtime cannot learn any other way: **what a payer has
 * already said that has not resolved yet.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **A5′, THROUGH A READBACK.** An accepted action resolves in the *next* tick (§15.2), so
 * between `POST /act` and that tick the election book still holds the payer's
 * **previous** statement — and `agent.md`'s readback ("You have currently stated: …") is
 * built from that book. Measured on the live world: a payer that had elected `IN_FULL`
 * and then restated an amount was told, in a fresh `stale: false` observation, that it
 * had "currently stated: IN_FULL". At 16 wakes over 288 ticks — one wake per 18 — that
 * is the last thing it reads before going dark, and the amount is what settles. A
 * permanent public `DECLINED` default against an agent the engine showed as not owing:
 * §15.4's class exactly, and the one this project calls worse than a crash.
 *
 * The window is private to `SubmissionQueue` and must stay private — nothing *inside* a
 * tick may read it, or an action would react to a within-tick decision. So the runtime
 * learns about a statement at the only honest moment, **as the window accepts it**, and
 * keeps it out of every path that decides anything: the settlement reads
 * {@link Runtime.elections} directly, and only {@link Runtime.electionOn} — the
 * readback's own source, and nothing that moves money — consults the overlay.
 *
 * Subclassed rather than wired through an options hook because `submit` is the seam and
 * it is already public; a hook would put a second door onto the same call in the module
 * that owns the rule that there is only one.
 * ══════════════════════════════════════════════════════════════════════════
 */
class WindowedEngine extends Engine {
  constructor(
    options: EngineOptions,
    /** Called for every submission the window **took**. A refusal is not a statement. */
    private readonly accepted: (queued: QueuedAction) => void,
  ) {
    super(options);
  }

  override submit(action: SubmittedAction): WorldResult<QueuedAction> {
    const outcome = super.submit(action);
    if (outcome.ok) this.accepted(outcome.value);
    return outcome;
  }
}

/**
 * Is this venture still looking for a role holder?
 *
 * The one condition under which a venture's channel is a **recruiting** channel rather
 * than a `PARTIES` one: it is forming, and there is a slot a stranger could fill. Written
 * once because {@link Runtime.mayTalkIn} and {@link Runtime.talksFor} must agree about it
 * exactly — a write gate and a read gate that disagree is the defect this closed, in the
 * other direction.
 */
function isRecruiting(venture: VentureRecord): boolean {
  return venture.state === 'FORMING' && openIndices(venture).length > 0;
}

/**
 * The three fields an `elect` request carries, read once.
 *
 * ONE HOME, TWO READERS: {@link Runtime.vElect}, which applies the statement, and
 * {@link Runtime.noteElection}, which stops the readback lagging behind it. Two copies
 * of this spelling list is two chances for the readback to miss a statement the handler
 * will honour — A5′ reached through a parameter name, which is scar #1's shape.
 */
function electionFieldsOf(params: Readonly<Record<string, unknown>>): {
  readonly venture: VentureId | null;
  readonly roleIndex: number | null;
  readonly raw: unknown;
} {
  return {
    venture: readString(params, ['venture', 'venture_id']) as VentureId | null,
    roleIndex: readInt(params, ['role', 'role_index', 'roleIndex']),
    raw: params['election'] ?? params['elect'] ?? params['pay'],
  };
}

// ── The runtime ─────────────────────────────────────────────────────────────

export class Runtime {
  readonly world: WorldState;
  readonly ledger: Ledger;
  readonly events = new EventLedger();
  readonly seals: SealBook;
  /** INV-17's index. The only door through which a default may be recorded. */
  readonly register = new DefaultRegister();
  /** The only writer of standing (§6.4, INV-21). */
  readonly standing = new StandingBook();
  /** INV-4's input: which obligations may still hold a lock. */
  readonly obligations = new SimpleObligationBook();
  readonly engine: Engine;
  readonly census = new DecisionCensus();
  readonly hazards: boolean;

  /**
   * The venture book, behind a getter because the rollback **replaces** it.
   *
   * `VentureBook` has no removal door and must not grow one, so undoing an aborted
   * tick's `create` means restoring into a fresh book. Every reader goes through this
   * property rather than holding the object, so the swap is invisible to all of them.
   */
  private ventureBook = new VentureBook();

  /**
   * The live table of scoped authority (SPEC §8, A6). Assigned rather than readonly
   * because `grantsStateTable` replaces it wholesale on an abort/restore, exactly as
   * the venture book and election map are replaced.
   */
  private grantBook = new GrantBook();
  private grantCounter = 0;

  /**
   * The order books, behind a getter because the rollback **replaces** the object.
   *
   * Same shape as `ventureBook`, `levyBookRef` and `grantBook`, and for the same
   * reason: `marketStateTable.restore` builds a fresh `MarketBook`, so every reader
   * has to go through the accessor or half the engine keeps trading on the pre-abort
   * book.
   */
  private marketBook = new MarketBook();
  /** What the last `MARKETS` phase did. Read by the event emitter and by tests. */
  private lastClear: ClearReport | null = null;

  /** Resolution-time refusals awaiting delivery, per principal. See the type's note. */
  private readonly pendingCorrections = new Map<PrincipalId, Ring<PendingCorrection>>();
  private readonly talk = new Ring<TalkEntry>(MAX_TALK_ENTRIES);
  private readonly offers = new Ring<OfferEntry>(MAX_OFFER_ENTRIES);
  private readonly claims = new Ring<ClaimEntry>(MAX_CLAIM_ENTRIES);

  /** Fill requests collected this tick, resolved once in VENTURES (PROP-V8). */
  private pendingFills: FillRequest[] = [];

  /** One window's params-to-`client_sequence` index. See {@link sequenceOf}. */
  private readonly sequenceIndex = new WeakMap<readonly QueuedAction[], Map<object, number>>();
  private ventureCounter = 0;

  /**
   * What each payer elected to pay, by `venture::roleIndex`.
   *
   * The payer's own statement, never the engine's inference (PROP-V4). Restated freely
   * until the commitment window closes; the last one before the freeze is the one the
   * settlement set carries, and an absent entry pays nothing.
   */
  private readonly elections = new Map<string, Election>();

  /**
   * The **least-paying** statement each role has in flight this window, by
   * `venture::roleIndex`. Amounts only; see {@link WindowedEngine} for why it exists.
   *
   * Deliberately **outside `state_hash` and outside the rollback**, unlike
   * {@link electionsStateTable} — and the difference is the point. This is not state: it
   * is a fact about the *window*, it is cleared at the end of every tick, nothing that
   * moves value reads it, and a replayed tick rebuilds it from the same action log. A
   * table for it would put a per-window artefact into the hash two runs are compared on.
   */
  private readonly electionsInFlight = new Map<string, Minor>();

  /** Deliveries, by venture. The deed set's only source; bounded by settlement. */
  private readonly deliveries = new Map<VentureId, DeliveryRecord>();

  /** The frozen settlement set, from the freeze tick until its settlement resolves. */
  private frozen: FrozenReckoning | null = null;

  /** The Reckoning that ran this tick, so ASSERT can read its violations. */
  private settledAtTick = -1;
  private outcome: ReckoningOutcome | null = null;
  private readonly summaries = new Ring<ReckoningSummary>(MAX_RECKONING_SUMMARIES);

  /**
   * The Levy's book, behind a getter because the rollback **replaces** it — the same
   * shape as `ventureBook`, and for the same reason: `restore` builds a fresh `Book` and
   * every reader has to go through the accessor or half the engine keeps talking to the
   * pre-abort assessment.
   */
  private levyBookRef = new LevyBook();
  /** The Reckoning whose assessment has been minted. Assessing twice is refused, not silent. */
  private levyAssessedReckoning = -1;
  private levySettledReckoning = -1;
  private levyOutcome: LevySettlement | null = null;
  private readonly levySummaries = new Ring<LevySummary>(MAX_RECKONING_SUMMARIES);

  /**
   * The raid book. Replaced wholesale by the rollback, so nothing may hold a reference
   * across a tick boundary — see {@link Runtime.raids}.
   */
  private raidBookRef = new RaidBook();
  /**
   * One 140-character line per resolved raid, for the frame's ticker (§14).
   *
   * A Ring rather than an array: a season is 8,064 ticks and an unbounded string buffer
   * is scar #3. It is deliberately **outside** `state_hash` — it is a display buffer
   * derived from the book, not a fact anyone can act on, and hashing a display buffer
   * would make two identical worlds differ over what a viewer had scrolled past.
   */
  private readonly raidTicker = new Ring<string>(MAX_RAID_TICKER_LINES);

  /**
   * Things that went wrong where a halt would have been worse. Bounded, and printed.
   *
   * A restore that could not reproduce its capture, an event the ledger refused at
   * COMMIT, a due venture that never delivered: each is an operator's alarm and none of
   * them may stop the world, because the world stopping is the expensive failure and
   * three of the three are reachable without any agent's help.
   */
  private readonly faults = new Ring<string>(MAX_TABLE_FAULTS);

  /**
   * The Reckoning's own halt controller, separate from the engine's on purpose.
   *
   * `runReckoningBatch` publishes or halts through a controller, and the engine owns
   * the world's `RUNNING | PAUSED` status — two writers on one status field would be
   * the worst possible instance of scar #5. So the batch gets its own, and the way a
   * failed Reckoning stops the world is `reckoningViolations`, handed to the tick
   * loop's `assertions` hook, which aborts the tick through the one halt path there is.
   */
  private readonly reckoningController: HaltController;

  /** A venture's escrow and a principal's stores. One home, handed to the driver. */
  private readonly accounts: SettlementAccounts = {
    escrowOf: (venture) => escrowAccount(venture.id, venture.creator),
    storesOf: (principal) => storesAccount(principal),
  };

  constructor(options: RuntimeOptions) {
    // Before anything else, because a world whose clock makes every offered seal
    // unkeepable must not start. See {@link assertSealSchedule}.
    assertSealSchedule();
    // And before anything else again: a world whose clock would make a spawned raid
    // resolve inside the freeze must not start. §5.1's freeze is hard and admits no raid
    // resolution, so such a raid could only be dropped or resolved illegally — and both
    // are a permanent public fact the rules made unavoidable (A5′).
    assertRaidSchedule();
    this.world = createWorld(launchMap());
    this.ledger = new Ledger();
    this.hazards = options.hazards ?? false;
    // Attached in production, so `target` and `measure` are checked at the door and a
    // formatting slip costs one action instead of a permanent public mark (scar #8).
    this.seals = new SealBook(this.sealWorld());
    this.reckoningController = new HaltController({
      startTick: (options.startTick ?? -1),
      startStateHash: canonicalHash({ reckoning: 'start', seed: options.seed }),
      // No operator keys: a Reckoning that halts is resumed by resuming the tick,
      // which is the engine's controller's business and needs its keys, not a second
      // set here.
      resumeKeys: new Map(),
    });

    this.engine = new WindowedEngine({
      world: this.world,
      seed: options.seed,
      ...(options.startTick === undefined ? {} : { startTick: options.startTick }),
      ...(options.actionsPerTick === undefined ? {} : { actionsPerTick: options.actionsPerTick }),
      tables: [
        // Money is INSIDE state_hash and inside the abort path. It was outside both
        // until a verifier noticed only `venture` was registered: two runs with
        // divergent balances but identical world/intent/venture state hashed the same,
        // and a halt left the ledger dirty for the next tick. A hash that cannot see
        // the money is not a hash of this world.
        ledgerStateTable(
          () => this.ledger,
          (restore) => {
            this.ledger.restoreTo(restore);
          },
        ),
        ventureStateTable(
          () => this.ventureBook,
          (book) => {
            this.ventureBook = book;
          },
        ),
        // The one agent-supplied value that decides whether tonight is a settlement or a
        // default. See {@link electionsStateTable} on why it was wrong for it to be
        // outside both the hash and the abort path.
        electionsStateTable(
          () => this.elections,
          (restored) => {
            this.elections.clear();
            for (const [key, election] of restored) this.elections.set(key, election);
          },
        ),
        // The Levy is inside `state_hash` and inside the abort path, and both halves
        // matter. An assessment decides what future ticks do, so a hash blind to it
        // would call two worlds identical while one owed 240 000 of goods; and an
        // aborted tick that left a credited delivery in the book would have the world
        // believing a payment that never published (§15.1, and the two verifiers who
        // found exactly this for the venture book and the election map).
        levyStateTable(
          () => this.levyBookRef,
          (book) => {
            this.levyBookRef = book;
          },
        ),
        // Grants are the A6 betrayal surface, so the book a delegate's on-behalf act is
        // checked against is inside `state_hash` and the abort path — two worlds that
        // disagree about who may spend whose stores must never hash the same, and an
        // aborted tick must not leave a grant's spend counter advanced. See INV-22/23.
        grantsStateTable(
          () => this.grantBook,
          (book) => {
            this.grantBook = book;
          },
        ),
        // The order books. An order is a claim on value, so the same two arguments
        // that put money and grants in here apply with more force: two worlds whose
        // books disagree must never hash the same, and an aborted tick must leave no
        // order, no fill and no escrow behind. That last clause is exactly the
        // `EncumbranceBook` omission — the worst defect this engine has had — and the
        // market is a strictly larger instance of it, because there are far more
        // orders than there are ventures.
        marketStateTable(
          () => this.marketBook,
          (book) => {
            this.marketBook = book;
          },
        ),
        // Predation. A live demand decides what a future tick does to a principal's
        // goods, so a hash blind to it would call two worlds identical while one of
        // them was about to lose half its stock — and an aborted tick that left a
        // credited `yield` in the book would have the world believing a payment that
        // never published. Registered unconditionally from the first commit of this
        // module, because the `EncumbranceBook` sitting outside the hash was the worst
        // defect this engine has had and it was found by a verifier, not by us.
        raidStateTable(
          () => this.raidBookRef,
          (book) => {
            this.raidBookRef = book;
          },
        ),
      ],
      verbs: this.verbTable(),
      // §17 and agent.md: "one seal per role you hold is free and costs no action".
      // The allowance is the SEALS BOOK's ledger, so the budget asks rather than
      // keeping a second copy of the count (scar #5). Before this hook existed the
      // budget charged for every seal and agent.md's promise was simply false — a
      // doc/engine disagreement about a cost, which is scar #1's shape.
      allowance: (request): boolean => {
        if (request.verb !== 'seal') return false;
        const roles = this.sealableRoles(request.principal, this.engine.tick);
        if (roles.length === 0) return false;
        return this.seals.freeSlotsRemaining(request.principal, reckoningOf(this.engine.tick), roles) > 0;
      },
      roleFills: () => this.ventures.roleFills(),
      // The MARKETS phase walks the whole resting book, and that quantity scales with
      // nothing else in the step budget. Without this the tick loop sized a cap for a
      // world with no market and DET-9 aborted a legitimate book walk — an
      // agent-reachable halt (AGT-X9). See `STEP_BUDGET.perRestingOrder`.
      restingOrders: () => this.marketBook.countOpen(),
      obligations: this.obligationSource(),
      // Buffered until COMMIT and appended here, so nothing an observer can read moves
      // until the tick is checked. The settlement's own receipts are the deliberate
      // exception: they are appended inside the batch, which is what makes the batch
      // one transaction with its own ASSERT (see `settleNow`).
      events: (drafts, tick) => {
        this.recordEvents(drafts, tick);
      },
      handlers: {
        // ── MARKETS, and the slot is the rule ──────────────────────────────
        //
        // §15.2 puts MARKETS after MOVE (so a hand that arrived this tick can trade
        // where it arrived) and before PRODUCE (clear-before-produce; a job may not
        // buy at market). The phase existed as an explicit no-op hook from commit #1
        // precisely so filling it would not shift any other phase's seeded sub-stream
        // — that promise is now being cashed, and no other phase moved.
        // ── PREDATE, and the slot is the rule ──────────────────────────────
        //
        // §15.2 puts PREDATE after MOVE (so a hand that marched to the stage to defend
        // is present on the tick its published ETA promised) and before VENTURES (so a
        // venture settling tonight settles against goods a raid has already taken or
        // left). The phase was an explicit no-op hook from commit #1 precisely so that
        // filling it would shift no other phase's seeded sub-stream — cashed here, and
        // no other phase moved.
        PREDATE: (ctx) => {
          this.predateNow(ctx);
        },
        MARKETS: (ctx) => {
          this.clearMarketsNow(ctx);
        },
        VENTURES: (ctx) => {
          this.resolveFills(ctx);
        },
        OBLIGE: (ctx) => {
          // The freeze is computed here, at the END of the freeze tick: every figure it
          // reads has to be the one the settlement will pay from, and VALIDATE+LOCK,
          // MOVE and VENTURES all ran before it. The settlement runs from the cascade
          // (see `attemptObligation`); this second call is for the Reckoning whose
          // settlement set is empty, which still has seals to resolve and still has to
          // mark the Reckoning resolved (INV-20).
          this.freezeNow(ctx);
          this.settleNow(ctx);
          // ── THE LEVY, AND THE ORDER IS THE RULE ────────────────────────────
          //
          // `assessLevyNow` first, because a world that starts mid-cycle must be
          // assessed before ASSERT asks INV-25 whether everyone is on a docket.
          //
          // `settleLevyNow` **after** `settleNow`, and that is not tidiness: the
          // Reckoning batch re-reads the payer balances it froze and halts on any
          // difference *in either direction* (§5.1's hard freeze, `reckoning/driver.ts`).
          // A sweep before it would move a figure the settlement was computed from and
          // pause a healthy world on the one tick that has an audience (A14).
          this.assessLevyNow(ctx);
          this.settleLevyNow(ctx);
        },
      },
      assertions: [
        (tick) => this.ventures.checkVentureInvariants(tick),
        (tick) => this.reckoningViolationsAt(tick),
        // A5′ for the Levy: a shortfall is an accusation, so it is held to INV-17's
        // standard — reproducible from the payment journal by a second road, or halt.
        (tick) => checkLevyAttribution(this.levy, reckoningOf(tick), tick),
        // MKT-1..7. Not registry entries — see `market/invariants.ts` on why the 26
        // stay 26 — but merged into the same ASSERT pass and halting on the same
        // terms. MKT-4 is the one that matters most: it recomputes every fill from
        // the posting log by a second road, so a torn fill aborts the tick instead of
        // becoming a permanent lie about who paid whom.
        (tick) => checkMarketInvariants({ book: this.marketBook, ledger: this.ledger, tick }),
        // PRD-1..6. Not registry entries — see `predation/invariants.ts` on why the 26
        // stay 26 — but merged into the same ASSERT pass and halting on the same terms.
        // PRD-1 is A8 (a raid standing in the Commons halts the world) and PRD-3 is A5′
        // (a recorded loss must equal what the posting log actually moved).
        (tick) => this.predationViolations(tick),
      ],
      invariantInputs: (tick) => this.invariantInputs(tick),
    },
    (queued) => {
      this.noteElection(queued);
    });
  }

  /**
   * Record an accepted `elect` so the payer's readback cannot lag behind the payer.
   *
   * **The least-paying statement wins, and that is what makes this safe rather than
   * merely fresher.** {@link MAX_QUEUED_PER_PRINCIPAL} is eight times the per-tick action
   * budget, so a payer can queue more elections than the tick will resolve, and which one
   * survives is then decided by the budget rather than by the last thing sent. Keeping
   * the *most dangerous* candidate is the only rule that can never tell a payer it is
   * safe when it is not — and being a minimum it does not depend on the order the
   * submissions arrived in, which is A4 held by construction rather than by care.
   *
   * `IN_FULL` is therefore never recorded: it pays the whole due, so it can never be the
   * minimum, and an overlay holding it could only ever *raise* a readback — the one
   * direction A5′ forbids.
   *
   * Every door {@link vElect} refuses is re-checked here, and not for tidiness: an
   * overlay a stranger could write into would be a fresh way to tell a payer it owes
   * something it does not, which is the same harm arriving from the other side.
   */
  private noteElection(queued: QueuedAction): void {
    if (queued.verb !== 'elect') return;
    const fields = electionFieldsOf(queued.params);
    if (fields.venture === null || fields.roleIndex === null) return;
    if (!isElection(fields.raw) || fields.raw === IN_FULL) return;
    const venture = this.ventures.get(fields.venture);
    if (venture === undefined) return;
    if (venture.creator !== queued.principal) return;
    if (!ELECTABLE_VENTURE_STATES.includes(venture.state)) return;
    const role = venture.roles.find((r) => r.index === fields.roleIndex);
    if (role === undefined) return;
    if (role.filledByPrincipal === null || role.filledByPrincipal === queued.principal) return;

    const key = electionKey(venture.id, fields.roleIndex);
    const held = this.electionsInFlight.get(key);
    if (held !== undefined) {
      if (fields.raw < held) this.electionsInFlight.set(key, fields.raw);
      return;
    }
    // At the cap the overlay stops growing rather than evicting: an eviction would drop
    // a statement and restore the very lag this exists to close, and the honest failure
    // of a full buffer is to stop taking new ones.
    if (this.electionsInFlight.size >= MAX_IN_FLIGHT_ELECTIONS) return;
    this.electionsInFlight.set(key, fields.raw);
  }

  /** The venture book. Never held across a tick boundary: the rollback replaces it. */
  get ventures(): VentureBook {
    return this.ventureBook;
  }

  /** The grant book (A6). Never held across a tick boundary: the rollback replaces it. */
  get grants(): GrantBook {
    return this.grantBook;
  }

  /** The Levy's book. Never held across a tick boundary: the rollback replaces it. */
  get levy(): LevyBook {
    return this.levyBookRef;
  }

  // ── PREDATION (SPEC §9, §16 step 12) ──────────────────────────────────────

  /** The raid book. Never held across a tick boundary: the rollback replaces it. */
  get raids(): RaidBook {
    return this.raidBookRef;
  }

  /** The published schedule, for `observe`. A pure function of the tick (A2, A14). */
  raidSchedule(tick: number): RaidSchedule {
    return scheduleAt(tick);
  }

  /** Raids this principal is the target of, or a party to. Bounded (INV-26). */
  raidsFor(principal: PrincipalId, tick: number, limit: number): readonly RaidView[] {
    return raidViewsFor({ book: this.raids, port: this.predationPort(tick), principal, tick, limit });
  }

  /**
   * The live demand against this principal right now, if there is one.
   *
   * One home for "is this agent under a demand", so the affordance layer, the briefing
   * and the verb handler cannot disagree about it (scar #5).
   */
  liveRaidAgainst(principal: PrincipalId): RaidRecord | undefined {
    return this.raids.live().find((r) => r.target === principal);
  }

  /**
   * Everything predation may do to the world, as the narrow port `src/predation` takes.
   *
   * Every value-moving method **returns what actually moved**. That is the mechanical
   * form of A5′: the predation module never holds an intended figure at the moment it
   * writes the record, so it cannot write one.
   *
   * `rng` is optional because the read-only half of the port (targeting, pricing an
   * affordance, building an observation) must not draw at all — a draw taken to answer
   * an HTTP read would shift every downstream outcome and make the world unreplayable
   * (DET-7). {@link PredationPort.routHand} is the only method that needs one, and
   * without an `rng` it refuses rather than inventing a recovery length.
   */
  private predationPort(tick: number, rng?: Rng): PredationPort {
    const world = this.world;
    const ledger = this.ledger;
    const faults = this.faults;
    const safeTier = (system: SystemId): ZoneTier =>
      // Fails toward the floor: a system the map cannot place reads as COMMONS, so a
      // spawn skips it and PRD-1 halts if such a raid somehow already exists. A8 is the
      // one promise a newcomer has before it has learned anything else.
      world.map.systems.has(system) ? tierOf(world.map, system) : 'COMMONS';

    const assailable = (principal: PrincipalId): readonly AssailablePile[] =>
      ledger
        .lotsInAccount(storesAccount(principal))
        .filter(
          (lot) =>
            lot.qty > 0 &&
            // A pledged lot backs an obligation and cannot be sent away (INV-4), and an
            // in-transit lot is not somewhere anything can be taken from.
            lot.encumbranceId === null &&
            lot.state === 'AVAILABLE' &&
            // THE COMMONS FLOOR, and it is on the LOT rather than on the principal. A
            // Commons-seated principal that hauled goods into the Marches is raidable
            // for exactly those goods and for nothing it left at home — A8 read
            // literally: safety protects your holding, your identity and your record,
            // not your wealth.
            safeTier(lot.location) !== 'COMMONS',
        )
        .sort((a, b) => compareIds(a.id, b.id))
        .map((lot) => ({ lotId: lot.id, good: lot.good, qty: lot.qty, location: lot.location }));

    // Only IDLE hands defend, and that is not a simplification.
    //
    // A hand filling a venture role is COMMITTED, and INV-9 halts the tick on a hand
    // that fills a role while RECOVERING. Routing a committed hand would therefore turn
    // legitimate predation into an agent-reachable world halt — the exact class §15.4
    // calls out, and three of those have shipped in this repo. It is also the better
    // rule: a principal that has committed every hand to ventures has genuinely left
    // nothing at home to fight with, and that is a strategy with a cost.
    const idleHandsAt = (principal: PrincipalId, stage: SystemId): readonly HandId[] =>
      handsOf(world, principal)
        .filter((hand) => hand.state === 'IDLE' && hand.location === stage && isPresent(hand, tick))
        .map((hand) => hand.id);

    return {
      principals: () => world.principalOrder,
      assailableOf: assailable,
      presentHandsAt: (principal, system) => idleHandsAt(principal, system).length,
      tierOf: safeTier,
      handsDefending: idleHandsAt,
      isSeated: (principal) => {
        const holdingId = world.holdingByPrincipal.get(principal);
        if (holdingId === undefined) return false;
        return world.holdings.get(holdingId)?.state === 'INTACT';
      },

      seize: (args) => {
        const account = storesAccount(args.from);
        const lots = ledger
          .lotsInAccount(account)
          .filter(
            (lot) =>
              lot.good === args.good &&
              lot.location === args.stage &&
              lot.encumbranceId === null &&
              lot.state === 'AVAILABLE' &&
              lot.qty > 0,
          )
          .sort((a, b) => compareIds(a.id, b.id))
          .slice(0, MAX_SEIZE_LOTS);

        let left: number = args.want;
        let moved = 0;
        for (const [i, lot] of lots.entries()) {
          if (left <= 0) break;
          const portion = Math.min(left, lot.qty);
          if (portion <= 0) continue;
          // One event id per lot, enumerable by index — which is what lets PRD-3 verify
          // the recorded loss against the posting log without walking the whole ledger.
          const eventId = `${args.eventId}#${String(i)}` as EventId;
          try {
            if (args.to === null) {
              ledger.destroyGoods({
                eventId,
                tick: args.tick,
                sink: GOODS_SINK.LOSS,
                lotId: lot.id,
                qty: qty(portion),
              });
            } else {
              ledger.transferGoods({
                eventId,
                tick: args.tick,
                lotId: lot.id,
                to: storesAccount(args.to),
                qty: qty(portion),
              });
            }
          } catch (error: unknown) {
            // Never a throw. A raid resolves in a phase, after MOVE and the market have
            // already run, so a throw here aborts a tick that had already published
            // arrivals and fills. The raid takes what it can and records exactly that.
            faults.push(
              `raid could not take ${String(portion)} of ${args.good} from ${args.from} at ${args.stage} ` +
                `(${describeError(error)}); the record credits only what actually moved`,
            );
            continue;
          }
          moved += portion;
          left -= portion;
        }
        return qty(moved);
      },

      releaseStake: (encumbranceId, releaseTick) => {
        if (encumbranceId === null) return;
        try {
          if (ledger.encumbrances.isOpen(encumbranceId)) {
            ledger.encumbrances.release(encumbranceId, releaseTick);
          }
        } catch (error: unknown) {
          faults.push(`raid stake ${encumbranceId} could not be released (${describeError(error)})`);
        }
      },

      forfeit: (args) => {
        try {
          // `seizeCurrency` moves at most what is actually there and returns the figure,
          // so a raider that spent down between joining and losing forfeits what it has
          // and the record says so.
          return ledger.seizeCurrency({
            eventId: args.eventId as EventId,
            tick: args.tick,
            from: storesAccount(args.from),
            to: storesAccount(args.to),
            amount: args.amount,
          }).seized;
        } catch (error: unknown) {
          faults.push(`raid stake could not be forfeited from ${args.from} (${describeError(error)})`);
          return minor(0);
        }
      },

      routHand: (handId, routTick) => {
        if (rng === undefined) return false;
        const hand = world.hands.get(handId);
        if (hand === undefined || hand.state !== 'IDLE') return false;
        const holdingId = world.holdingByPrincipal.get(hand.principal);
        if (holdingId === undefined) return false;
        try {
          const loss = loseHand(hand, routTick, rng, holdingOf(world, hand.principal).system);
          if (loss.lostCargo.size > 0) {
            // Goods on a hand are one of INV-2's conservation terms. Nothing in this
            // build loads a hand (there is no `haul` verb yet), so this is unreachable
            // today — and it is reported rather than dropped, because silently dropping
            // it would make supply stop balancing with no event to point at.
            faults.push(
              `hand ${handId} was routed carrying cargo, which this build has no lot behind; ` +
                `supply will not balance until the haul path retires it`,
            );
          }
          return true;
        } catch (error: unknown) {
          faults.push(`hand ${handId} could not be routed (${describeError(error)})`);
          return false;
        }
      },

      standingOf: (principal, stage, good) => {
        let total = 0;
        for (const pile of assailable(principal)) {
          if (pile.location !== stage || pile.good !== good) continue;
          total += pile.qty;
        }
        return qty(total);
      },
    };
  }

  /**
   * The `PREDATE` phase. Resolve what is due, spawn if the schedule says so, prune.
   *
   * Every outcome is emitted as a `PUBLIC` event, because §11.2 gives `PUBLIC` to
   * "movement on public lanes" and a raid is the map's motion. Nothing in a payload here
   * is a `SENSED` quantity: the demand is a seeded draw from a published band and the
   * loss is what the ledger moved, which A5 makes public the moment it happens.
   */
  private predateNow(ctx: PhaseContext): void {
    // One step per live raid plus the spawn, so a busy book is paid for out of the
    // tick's step budget rather than silently exceeding it (DET-9).
    ctx.step(this.raids.liveCount() + 1);
    const report = runPredate({
      book: this.raids,
      port: this.predationPort(ctx.tick, ctx.rng),
      rng: ctx.rng,
      tick: ctx.tick,
      onFault: (message) => {
        this.faults.push(message);
      },
    });

    for (const raid of report.spawned) {
      ctx.emit({
        tick: ctx.tick,
        kind: 'raid.spawned',
        rulesVersion: RULES_VERSION,
        // Nobody acted. A world raid has no actor by construction, which is the whole
        // reason it cannot be bribed off (§9) and why A12 permits it: a target-selection
        // rule is physics, and an outcome is never authored.
        actorPrincipalId: null,
        onBehalfOfPrincipalId: null,
        grantId: null,
        eventFamilyId: `raid::${raid.id}`,
        parentEventId: null,
        isPublic: true,
        publicAt: ctx.tick,
        declassifyAt: ctx.tick,
        provenanceClass: 'FACT',
        actedOnStateVersion: ctx.frozenStateVersion,
        decisionSource: null,
        payload: {
          raid: raid.id,
          target: raid.target,
          stage: raid.stage,
          good: raid.good,
          demand: raid.demandQty,
          force: raid.force,
          resolves_at_tick: raid.resolvesAtTick,
        },
        visibility: 'PUBLIC',
        audience: [],
      });
      // §12.4: every party to a resolving item is offered one wake BEFORE it resolves.
      // A demand with a deadline is exactly that, and an agent that is never woken for
      // one has been given a window it could not use.
      ctx.offerWake(raid.target, 'THREAT', raid.id);
      this.raidTicker.push(raidTickerLine(raid));
    }

    for (const outcome of report.resolved) {
      this.emitRaidResolved(ctx, outcome);
      const raid = this.raids.get(outcome.raid);
      if (raid !== undefined) this.raidTicker.push(raidTickerLine(raid));
    }
  }

  /** The resolution receipt. `PUBLIC`, and it is never a default (A5′). */
  private emitRaidResolved(ctx: PhaseContext, outcome: RaidOutcome): void {
    ctx.emit({
      tick: ctx.tick,
      kind: 'raid.resolved',
      rulesVersion: RULES_VERSION,
      actorPrincipalId: null,
      onBehalfOfPrincipalId: null,
      grantId: null,
      eventFamilyId: `raid::${outcome.raid}`,
      parentEventId: null,
      isPublic: true,
      publicAt: ctx.tick,
      declassifyAt: ctx.tick,
      provenanceClass: 'FACT',
      actedOnStateVersion: ctx.frozenStateVersion,
      decisionSource: null,
      payload: {
        raid: outcome.raid,
        state: outcome.state,
        target: outcome.target,
        stage: outcome.stage,
        good: outcome.good,
        lost: outcome.lostQty,
        forfeited: outcome.forfeited,
        routed: outcome.routed.length,
        defender_force: outcome.force?.defenderForce ?? 0,
        raider_force: outcome.force?.raiderForce ?? 0,
        // Stated on the receipt itself rather than left to be inferred, because the one
        // thing this record must never be mistaken for is an accusation (§15.4).
        is_default: false,
      },
      visibility: 'PUBLIC',
      audience: [],
    });
    // ── A SECOND OFFER FOR THE SAME ITEM, AND IT IS NOT DEAD CODE ────────────
    //
    // `WakeBook.offer` refuses a repeat `(principal, item)` with `ALREADY_OFFERED`, so
    // for a target that was woken at spawn this is a no-op — and the spawn offer is the
    // one §5.1 requires, because it comes *before* the thing resolves.
    //
    // It fires in exactly one case: a target whose spawn offer was refused for
    // `BUDGET_SPENT`. That principal was never told about the demand, and the wake book
    // deliberately does not mark an item offered when it refuses one. Its budget resets
    // at the Reckoning, so this is the offer that reaches it — and being told you were
    // raided is the least the record owes somebody it just took goods from.
    ctx.offerWake(outcome.target, 'THREAT', outcome.raid);
  }


  // ── §9's three answers to a demand. No new verb: `yield`, `fight` and `join` are
  //    already in SPEC §12.2's table and already classified in `world/commons.ts`, so
  //    the 40-verb budget is untouched and the Commons floor already covers them.
  //
  //    None is behind `committing`. The schedule guarantees a raid resolves before the
  //    commitment window opens (`assertRaidSchedule`), so a demand is never live inside
  //    the freeze and the refusal would be dead code that read as a rule.

  /**
   * `yield` — pay the demand and the raid leaves. The cheap branch.
   *
   * Resolves immediately rather than at the window's end, because paying early is a
   * legitimate move ("buy them off before they gather") and making an agent wait for a
   * decision it has already made is the cockpit this design deleted.
   */
  private vYield(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const raid = this.raidNamedBy(req, 'yield');
    if ('ok' in raid) return raid;
    if (raid.raid.target !== req.principal) {
      return reject(
        'A2',
        `raid ${raid.raid.id} demands from ${raid.raid.target}, not from you. Only the target can pay a ` +
          `demand; to help, send join with {"side": "DEFENDER"}.`,
      );
    }
    const outcome = payDemand({
      book: this.raids,
      port: this.predationPort(ctx.tick, ctx.rng),
      raid: raid.raid,
      tick: ctx.tick,
      onFault: (message) => {
        this.faults.push(message);
      },
    });
    if (outcome === null) return reject('PRD-6', `raid ${raid.raid.id} could not be closed; nothing moved.`);
    this.emitRaidResolved(ctx, outcome);
    const closed = this.raids.get(outcome.raid);
    if (closed !== undefined) this.raidTicker.push(raidTickerLine(closed));
    return { ok: true, value: null };
  }

  /**
   * `fight` — muster the defence. Resolves at the window's end, not now.
   *
   * It commits nothing at the moment it is sent, and that is deliberate: hands can still
   * march to the stage during the window, so an agent that answers early and reinforces
   * late gets both. What it buys is that the target's IDLE hands at the stage count at
   * all — an unanswered raid musters no defence, which is what makes the window a
   * decision rather than a formality, and it is stated in `RAID_TARGET_STATEMENT`.
   */
  private vFight(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const raid = this.raidNamedBy(req, 'fight');
    if ('ok' in raid) return raid;
    if (raid.raid.target !== req.principal) {
      return reject(
        'A2',
        `raid ${raid.raid.id} is aimed at ${raid.raid.target}, not at you. To fight on its side send ` +
          `join with {"side": "DEFENDER"}.`,
      );
    }
    const mismatch = this.raidTargetMismatch(req, raid.raid);
    if (mismatch !== null) return mismatch;
    try {
      this.raids.answer(raid.raid.id, 'FIGHT', ctx.tick);
    } catch (error: unknown) {
      return reject('A2', describeError(error));
    }
    this.emitRaidAnswer(ctx, req, raid.raid.id, 'FIGHT');
    return { ok: true, value: null };
  }

  /**
   * `join` — take a side in someone else's standoff (§9: "nearby agents may join on
   * either side").
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THIS IS WHERE ATTACKER RISK LIVES.** A raider joiner locks
   * {@link RAID_JOIN_STAKE_MINOR} of its own capital and puts an IDLE hand in. If the
   * raid is repulsed the stake goes **to the defender** — forfeiture to the counterparty
   * and never to a sink, exactly as §7.3 rules for an abandoned slot, because forfeiture
   * to the void is a griefer's bargain — and the hand goes RECOVERING. A defender joiner
   * stakes no capital and risks only its hand, because charging for the only counter-move
   * in the mechanic would price it out.
   * ══════════════════════════════════════════════════════════════════════════
   */
  private vJoin(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const found = this.raidNamedBy(req, 'join');
    if ('ok' in found) return found;
    const raid = found.raid;
    const rawSide = (readString(req.params, ['side']) ?? '').toUpperCase();
    if (rawSide !== 'RAIDER' && rawSide !== DEFENDER_SIDE) {
      return reject(
        'A2',
        `join needs a side: {"side": "RAIDER"} or {"side": "${DEFENDER_SIDE}"}. ` +
          `Joining the raider's side is a hostile act and is invalid against a Commons target (A8).`,
      );
    }
    if (raid.target === req.principal) {
      return reject('A2', `you are the target of ${raid.id}; answer it with yield or fight, not join.`);
    }
    const mismatch = this.raidTargetMismatch(req, raid);
    if (mismatch !== null) return mismatch;

    // A hand, present and IDLE, at the stage. Force is per hand and capital buys none:
    // A4 says strategy must beat throughput, and a side that could be bought outright
    // would make the standoff an auction.
    const port = this.predationPort(ctx.tick, ctx.rng);
    const available = port.handsDefending(req.principal, raid.stage);
    const named = readString(req.params, ['hand', 'hand_id', 'handId']);
    const handId = named === null ? available[0] : available.find((id) => id === named);
    if (handId === undefined) {
      return reject(
        'INV-9',
        `you have no IDLE hand present at ${raid.stage} to put into raid ${raid.id}. A hand already ` +
          `filling a venture role cannot also stand in a standoff — one hand is one unit of simultaneous ` +
          `presence (§3) — and a Commons-bound principal cannot march hands out of the Commons at all (A15).`,
      );
    }

    let stake = minor(0);
    let encumbranceId: string | null = null;
    if (rawSide === 'RAIDER') {
      const free = freeStores(this.ledger, req.principal);
      if (free < RAID_JOIN_STAKE_MINOR) {
        return reject(
          'A7',
          `joining a raid stakes ${String(RAID_JOIN_STAKE_MINOR)} of slashable capital and you have ` +
            `${String(free)} free. An attacker with nothing at risk is weather, not a character: if the raid ` +
            `is repulsed this goes to the defender.`,
        );
      }
      try {
        encumbranceId = this.ledger.encumbrances.lock({
          eventId: `${raid.id}:stake:${req.principal}`,
          tick: ctx.tick,
          principal: req.principal,
          account: storesAccount(req.principal),
          amountMinor: RAID_JOIN_STAKE_MINOR,
          // The stake IS the worst case, exactly: it is what the joiner loses if the
          // raid fails, and EXPOSURE is Σ open max_direct_loss and nothing else (§3).
          obligationRef: raid.id as unknown as VentureId,
          maxDirectLoss: RAID_JOIN_STAKE_MINOR,
        });
        stake = RAID_JOIN_STAKE_MINOR;
      } catch (error: unknown) {
        return reject('INV-4', describeError(error));
      }
    }

    try {
      this.raids.addParty(raid.id, {
        principal: req.principal,
        side: rawSide === 'RAIDER' ? 'RAIDER' : 'DEFENDER',
        handId,
        stake,
        encumbranceId,
        joinedAtTick: ctx.tick,
      });
    } catch (error: unknown) {
      // Put the stake back before refusing: a lock left behind for a party that was
      // never admitted is an orphan INV-4 halts the tick over, and the agent would have
      // paid for an action that did nothing.
      if (encumbranceId !== null) {
        try {
          this.ledger.encumbrances.release(encumbranceId, ctx.tick);
        } catch {
          this.faults.push(`raid stake ${encumbranceId} was not released after a refused join`);
        }
      }
      return reject('INV-26', describeError(error));
    }

    ctx.emit({
      tick: ctx.tick,
      kind: 'raid.joined',
      rulesVersion: RULES_VERSION,
      actorPrincipalId: req.principal,
      onBehalfOfPrincipalId: null,
      grantId: null,
      eventFamilyId: `raid::${raid.id}`,
      parentEventId: null,
      isPublic: true,
      publicAt: ctx.tick,
      declassifyAt: ctx.tick,
      provenanceClass: 'FACT',
      actedOnStateVersion: ctx.frozenStateVersion,
      decisionSource: req.decisionSource,
      // Taking a side is the most public thing an agent can do — it is the map's motion
      // and it is what the audience is watching for. The stake is published with it,
      // because a stake nobody can see is not a stake anyone is impressed by.
      payload: { raid: raid.id, side: rawSide, hand: handId, stake },
      visibility: 'PUBLIC',
      audience: [],
    });
    return { ok: true, value: null };
  }

  /**
   * The Commons floor's target key, cross-checked against the raid it accompanies.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THE FLOOR CHECKS A TARGET KEY; THIS CHECKS THAT THE KEY IS THE RIGHT ONE.**
   *
   * `fight` and a raider `join` are HOSTILE, so `commonsFloorRejection` refuses them
   * unless the params name a hand, holding, principal or system it can locate — and
   * `world/commons.ts` says in as many words that the raid module must use its
   * spellings. So the affordance sends `system` (the stage) on a `fight` and `principal`
   * (the target) on a raider `join`, and **this** makes sure the thing the floor cleared
   * is the thing the handler is about to act on. Without it the two layers could clear
   * one place and act on another — which is the shape of a floor held up by a caller
   * behaving well rather than by a rule, and A8 is the one promise a newcomer has.
   * ══════════════════════════════════════════════════════════════════════════
   */
  private raidTargetMismatch(req: ActionRequest, raid: RaidRecord): WorldResult<null> | null {
    const system = readString(req.params, ['system', 'system_id', 'systemId', 'at']);
    if (system !== null && system !== raid.stage) {
      return reject(
        'A8',
        `you named ${system} but raid ${raid.id} stands at ${raid.stage}. The Commons floor is checked ` +
          `against the place you name, so it has to be the place the raid is.`,
      );
    }
    const principal = readString(req.params, ['principal', 'principal_id', 'principalId', 'defender', 'against']);
    if (principal !== null && principal !== raid.target) {
      return reject(
        'A8',
        `you named ${principal} but raid ${raid.id} is aimed at ${raid.target}. The Commons floor is checked ` +
          `against the principal you name, so it has to be the one the raid is aimed at.`,
      );
    }
    return null;
  }

  /** The `raid` parameter, resolved — or the sentence that says why it could not be. */
  private raidNamedBy(
    req: ActionRequest,
    verb: string,
  ): { readonly raid: RaidRecord } | WorldResult<null> {
    const named = readString(req.params, ['raid', 'raid_id', 'raidId', 'target', 'id']);
    if (named === null) {
      const mine = this.liveRaidAgainst(req.principal);
      if (mine === undefined) {
        return reject(
          'A2',
          `'${verb}' needs a raid: send {"raid": "<id>"}. There is no live demand against you right now, ` +
            `and obligations.raid in your observation lists every raid you are in.`,
        );
      }
      return { raid: mine };
    }
    const raid = this.raids.get(named as RaidId);
    if (raid === undefined) {
      return reject('A2', `there is no raid ${named}. Live raids are listed in obligations.raid.`);
    }
    if (raid.state !== 'DEMANDED') {
      return reject(
        'A2',
        `raid ${raid.id} already resolved as ${raid.state} at tick ${String(raid.resolvedAtTick)}. ` +
          `Nothing you send now can change it — the record is append-only (A5).`,
      );
    }
    return { raid };
  }

  private emitRaidAnswer(
    ctx: PhaseContext,
    req: ActionRequest,
    raid: RaidId,
    answer: string,
  ): void {
    ctx.emit({
      tick: ctx.tick,
      kind: 'raid.answered',
      rulesVersion: RULES_VERSION,
      actorPrincipalId: req.principal,
      onBehalfOfPrincipalId: null,
      grantId: null,
      eventFamilyId: `raid::${raid}`,
      parentEventId: null,
      isPublic: true,
      publicAt: ctx.tick,
      declassifyAt: ctx.tick,
      provenanceClass: 'FACT',
      actedOnStateVersion: ctx.frozenStateVersion,
      decisionSource: req.decisionSource,
      payload: { raid, answer },
      visibility: 'PUBLIC',
      audience: [],
    });
  }

  /** PRD-1..6, with the two second roads the A5′ clauses need. */
  private predationViolations(tick: number): readonly InvariantViolation[] {
    const defaultsThisTick = new Set<PrincipalId>(
      this.register.all().filter((row) => row.tick === tick).map((row) => row.promisor),
    );
    const port = this.predationPort(tick);
    return checkPredationInvariants({
      book: this.raids,
      tick,
      tierOf: (system) => port.tierOf(system),
      defaultsThisTick,
      movedForRaid: (raid) => this.goodsMovedForRaid(raid, tick),
    });
  }

  /**
   * PRD-3's second road: what the **posting log** says this raid took.
   *
   * Recomputed from the postings rather than read off the raid row, which is the whole
   * point — a row checked against itself is a detector agreeing with itself.
   *
   * Scoped to the tick the raid resolved on, and that is a deliberate limit rather than
   * a shortcut: a raid resolved three Reckonings ago was verified on the tick it
   * resolved and its postings are append-only, so re-walking them every tick forever
   * would cost O(season) per tick and prove nothing new. Returning `null` skips the
   * clause, which is what a fixture with no ledger needs too.
   */
  private goodsMovedForRaid(raid: RaidRecord, tick: number): number | null {
    if (raid.resolvedAtTick !== tick) return null;
    const account = storesAccount(raid.target);
    const bases = [
      `${raid.id}:yield`,
      `${raid.id}:seize`,
      ...raid.parties.filter((p) => p.side === 'RAIDER').map((p) => `${raid.id}:seize:${p.principal}`),
    ];
    let moved = 0;
    for (const base of bases) {
      for (let i = 0; i < MAX_SEIZE_LOTS; i += 1) {
        const postings = this.ledger.postingsFor(`${base}#${String(i)}` as EventId);
        if (postings.length === 0) continue;
        for (const posting of postings) {
          if (posting.account !== account) continue;
          if (posting.good !== raid.good) continue;
          const delta: number = posting.amountQty ?? 0;
          if (delta < 0) moved += 0 - delta;
        }
      }
    }
    return moved;
  }

  /**
   * Everything the tick's own ASSERT phase can see.
   *
   * `settlementSet` and `settlementItems` are deliberately **absent**, and it is not an
   * oversight: INV-18's input carries `settlementSeqFrom`, the sequence at which the
   * settlement's own rows begin, and only the batch that appended them knows it. A
   * second derivation of that number here would either agree (and be a copy) or
   * disagree — and if it disagreed by being too low, INV-18 would read the
   * settlement's own receipts as a third party touching the frozen set and halt a
   * healthy Reckoning. The batch runs INV-18 and INV-19 over the settlement it just
   * performed, with its own captured value, and its violations arrive here through
   * `reckoningViolationsAt`.
   */
  private invariantInputs(tick: number): InvariantInputs {
    const reckoning = Math.floor(tick / TICKS_PER_RECKONING);
    const levy = inv24InputsFor(this.levy, reckoning);
    // ── WHY THE DOCKET IS CONDITIONAL, AND WHY THAT IS NOT A DODGE ───────────
    //
    // `checkInv25` refuses an empty principal list on purpose — "an empty world
    // satisfies it vacuously and that is exactly the night it must not". A fixture with
    // no principals seated is a world with nothing to be quiet *about*, and supplying
    // the pair there would halt every such test on a state nobody could be silent in.
    // So the roll gates the supply, and the moment one principal exists the invariant is
    // live and the Levy has to have put it on a row.
    const roll = this.world.principalOrder;
    const docket = roll.length === 0 ? undefined : docketRowsFor(this.levy, reckoning);
    return {
      ledger: this.ledger,
      obligations: this.liveObligations(),
      presence: this.world,
      roleFills: this.ventures.roleFills(),
      events: this.events,
      eventScope: 'TICK',
      defaults: this.register,
      sealBook: this.seals,
      standingChanges: this.standing.changes(),
      standings: this.standing.rows(),
      atReckoning: reckoning,
      // A6: the grant rows and the spend journal, so INV-22/23 run over real data at
      // every tick close. INV-22 recomputes each grant's spend from the journal and
      // compares it to the row cache — the only way the "concurrent delegates cannot
      // race a journal" clause is checkable — and refuses any grant whose spend passed
      // its LIMITS (the worst case the grantor was shown before it signed, A7).
      grants: this.grantBook.all(),
      grantSpends: this.grantBook.allSpends(),
      ...(levy === null ? {} : { levy }),
      ...(docket === undefined ? {} : { docket }),
    };
  }

  /**
   * What the seal book asks the world before accepting a seal.
   *
   * Live rather than a snapshot of ids: ventures are minted every tick, and a seal
   * against a venture the index had never heard of would be refused at the door for
   * naming nothing — which is the right answer to a typo and the wrong one to a real
   * venture. `sealWorldIndex`'s case-folding is deliberately not reproduced: this world
   * spells ids exactly one way and a verdict compares them exactly.
   */
  private sealWorld(): SealWorldIndex {
    return {
      canonicalTarget: (raw: string): string | null => {
        if (this.ventures.get(raw as VentureId) !== undefined) return raw;
        if (this.world.map.systems.has(raw as SystemId)) return raw;
        if (this.world.hands.get(raw as HandId) !== undefined) return raw;
        if (this.world.holdings.get(raw as HoldingId) !== undefined) return raw;
        if (this.world.principalOrder.includes(raw as PrincipalId)) return raw;
        return null;
      },
      // ── One verb this world takes a measurement for, and it is the delivery ────
      //
      // Everything else answers `null`. **`null` narrows nothing.** Its own contract
      // says so — "`null` is honest and is treated as *no opinion*; it never widens
      // what a verdict may mark" (`SealWorldIndex.measureOfVerb`) — and "never widens"
      // is not "closes". All it does is skip the measure comparison at commit, so a
      // seal naming a verb this world records no deed for is **accepted** and then
      // resolves `CONTRADICTED` from the absence, as soon as its principal is
      // witnessed. Verified: a seal on `verb: 'sign'` against a real venture, with its
      // delivery intact, comes back `CONTRADICTED` with `contradictedSeals: 1` and
      // `deedSetFaults: 0`.
      //
      // An earlier version of this comment claimed the opposite — that such a seal
      // "can only ever close UNMARKED — never a mark from an absence". That is the
      // sentence a future session would read before deciding it was safe to register
      // `seal`, and it is exactly backwards: `src/api/observe.ts`'s seal affordance and
      // the cast both name `verb: 'sign'`, so registering the verb on the strength of
      // it would publish a permanent false mark on an agent that copied the server's
      // own affordance (A5′, scar #1). The measure gate is not the defence; leaving the
      // verb unregistered is, until those two call sites move onto {@link DELIVERY_VERB}.
      measureOfVerb: (verb: string): SealMeasure | null =>
        verb === DELIVERY_VERB ? DELIVERY_MEASURE : null,
    };
  }

  // ── Enrolment ─────────────────────────────────────────────────────────────

  /**
   * Seat a principal: a Commons holding, three hands, a funded STORES account.
   *
   * §12.5's list, minus the parts that are the HTTP layer's job. The starter stake
   * is issued from the named faucet rather than transferred from nowhere, because
   * `INV-2` counts supply against a closed set of faucets and a stake that appears
   * without one is unaccounted currency.
   */
  seat(principal: PrincipalId, handle: string, seatAt?: SystemId): Enrolment {
    const tick = this.engine.tick + 1;
    const enrolment = enroll(this.world, principal, handle, tick, seatAt);
    openStores(this.ledger, principal);
    this.ledger.issueCurrency({
      eventId: `enrol:${principal}` as never,
      tick: Math.max(0, tick),
      faucet: CURRENCY_FAUCET.STARTER_STAKE,
      to: storesAccount(principal),
      amount: STARTER_STAKE,
    });
    // ── §6.1's "starter stake of BOUND GOODS", which had never been minted ────
    //
    // The Levy is payable **only in located goods** (§5.2), and until this line the
    // build had issued the starter stake as currency alone — so there was nothing
    // located anywhere that a goods-only obligation could be discharged with, and every
    // principal would have been permanently, unavoidably short. An obligation the rules
    // make impossible to meet, recorded against a real agent every night, is A5′ with
    // the engine's own economy as the cause.
    //
    // The allotment is finite and there is no `PRODUCE` phase behind it yet (§16 step
    // 11), so a principal that only ever delivers from stock runs dry after about two
    // and a half Reckonings and `LEVY SHORT` starts to rise on its own. That is the
    // meter working rather than the model failing, and it is stated here so nobody
    // later reads a rising short as a bug.
    this.ledger.sourceGoods({
      eventId: `enrol.goods:${principal}` as never,
      tick: Math.max(0, tick),
      faucet: GOODS_FAUCET.PRODUCTION,
      to: storesAccount(principal),
      good: LEVY_GOOD,
      qty: LEVY_STARTER_ALLOTMENT,
      location: enrolment.holding.system,
      origin: principal,
    });
    // A principal that enrolled after its constellation was assessed still has to be on
    // tonight's docket, or INV-25 — the anti-quiet invariant — halts on the arrival of a
    // legitimate newcomer. Its duty is the nominal rate and it is added to the total, so
    // no existing line moves (see `Book.admitLate`).
    // The tenure clock, recorded once, here. The newcomer floor reads it and nothing
    // else in the engine holds an enrolment tick — see `Book.enrolled` on why deriving it
    // from hand presence was a permanent nominal-rate exploit.
    try {
      this.levy.enrolled(principal, Math.max(0, tick));
    } catch (error: unknown) {
      this.faults.push(`${principal} could not be added to the Levy tenure register (${describeError(error)})`);
    }
    this.admitLateToLevy(principal, Math.max(0, tick));
    return enrolment;
  }

  /**
   * Put a mid-cycle enroller on tonight's assessment. Never throws for an agent's sake.
   *
   * Enrolment is free and unauthenticated (§6.1) and reaches this through HTTP, so a
   * throw here would be an agent-triggerable halt on the world's own front door. Three
   * of those have shipped in this repo.
   */
  private admitLateToLevy(principal: PrincipalId, tick: number): void {
    const reckoning = reckoningOf(tick);
    const constellation = constellationOf(this.world, principal);
    if (constellation === null) return;
    if (!this.levy.isAssessed(reckoning, constellation)) {
      // ── THE SILENT RETURN WAS THE HALT, ONE TICK LATER ─────────────────────
      //
      // No plan means this constellation held no principal when `assessLevyNow` ran at
      // phase 0, so it was skipped — `assessCycle` skips an empty roll. Returning here
      // leaves the arrival with no assessment and no docket row, and `levyAssessedReckoning`
      // stops `assessCycle` from ever being asked again this Reckoning, so the plan is
      // never minted and INV-25 halts every remaining tick of the cycle:
      // `p:… appears in no docket row for Reckoning N; abstention must be impossible`.
      //
      // Reachable through `POST /enroll` — free and unauthenticated (A15) — in any world
      // whose Commons constellation was empty at phase 0 while another constellation held
      // a principal. Verified against the enrolment path's own call, `seat(principal,
      // handle)` with no `seatAt`.
      //
      // Clearing the memo is the whole fix: the next OBLIGE re-runs `assessCycle`, which
      // skips every constellation already assessed and mints the one that now has a roll.
      // The assessment lands at this phase rather than phase 0, which is the honest record
      // of when the constellation first had anybody in it.
      this.levyAssessedReckoning = -1;
      return;
    }
    try {
      // Carry the late enroller's REAL tenure and capital, not fabricated values, so
      // INV-24 can re-derive isNewcomer against the same inputs the assessment used.
      // A late enroller is a newcomer by construction (it just seated), so the floor is
      // correct here — but the check verifies that rather than trusting the flag.
      const subject = this.levySubjectOf(principal, tick);
      this.levy.admitLate(reckoning, constellation, {
        principal,
        amount: LEVY_NOMINAL_MINOR,
        newcomerFloored: true,
        tenureTicks: subject.tenureTicks,
        freeStores: subject.freeStores,
        spared: false,
        weight: 0,
      });
    } catch (error: unknown) {
      this.faults.push(
        `${principal} enrolled at tick ${String(tick)} and could not be added to the Reckoning ` +
          `${String(reckoning)} Levy (${describeError(error)}); it is assessed from the next Reckoning`,
      );
    }
  }

  /** A Commons seat with the fewest holdings, or a named tier for the cast. */
  seatInTier(tier: 'COMMONS' | 'MARCHES' | 'FRONTIER', rng: Rng): SystemId | undefined {
    const candidates = [...this.world.map.systems.keys()]
      .filter((id) => tierOf(this.world.map, id) === tier)
      .sort(compareIds);
    if (candidates.length === 0) return undefined;
    return rng.pick(candidates);
  }

  // ── Reads the API needs ───────────────────────────────────────────────────

  /**
   * The talk this principal may read.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THE READ PATH IS WHAT MAKES "ROLES ARE FILLED BY TALKING" BUILDABLE.** This used to
   * be the parties and nobody else, while {@link vMessage} let anyone write — so an
   * outsider could put text into a channel that declassifies publicly at settlement and
   * feed the receipt reel, and could never see a reply. A probe did it. The write side is
   * now gated (see {@link mayTalkIn}); the read side has to match it or the gate simply
   * deletes recruiting: a candidate that cannot read the creator's answer cannot
   * negotiate, and a probe named the missing reply as the reason the negotiation channel
   * felt unbuildable.
   *
   * So: the creator and the role holders always, plus **anyone who has spoken in a
   * venture that is still recruiting**. That is not a widening of the `PARTIES` tier, it
   * is the tier applied honestly — nothing binds until both parties countersign the same
   * `terms_hash` (§7.3), so an open venture has no parties yet to keep a secret from, and
   * its terms are already on the public board. The moment the last role fills, the channel
   * closes to everyone but the parties and stays that way until it declassifies.
   * ══════════════════════════════════════════════════════════════════════════
   */
  talksFor(principal: PrincipalId): readonly TalkEntry[] {
    // One pass for the ventures this principal has spoken in, so the filter below stays
    // linear: the ring holds up to MAX_TALK_ENTRIES and this is on the observation path.
    const spokenIn = new Set<VentureId>();
    for (const entry of this.talk.all) {
      if (entry.from === principal) spokenIn.add(entry.venture);
    }
    return this.talk.all.filter((t) => {
      const venture = this.ventures.get(t.venture);
      if (venture === undefined) return false;
      if (venture.creator === principal) return true;
      if (venture.roles.some((r) => r.filledByPrincipal === principal)) return true;
      return spokenIn.has(t.venture) && isRecruiting(venture);
    });
  }

  publishedOffers(): readonly OfferEntry[] {
    return this.offers.all;
  }

  publicClaims(): readonly ClaimEntry[] {
    return this.claims.all;
  }

  /**
   * Take this principal's undelivered corrections. **Draining, not peeking.**
   *
   * Draining on read is what makes the buffer bounded in practice as well as in
   * principle: a principal that never reads accumulates at most
   * {@link MAX_PENDING_CORRECTIONS}, and one that does read carries none.
   */
  takeCorrections(principal: PrincipalId): readonly PendingCorrection[] {
    const ring = this.pendingCorrections.get(principal);
    if (ring === undefined) return [];
    const out = [...ring.all];
    this.pendingCorrections.delete(principal);
    return out;
  }

  private holdCorrection(principal: PrincipalId, correction: PendingCorrection): void {
    const ring = this.pendingCorrections.get(principal) ?? new Ring<PendingCorrection>(MAX_PENDING_CORRECTIONS);
    ring.push(correction);
    this.pendingCorrections.set(principal, ring);
  }

  /** Every bounded buffer's size, for the soak test's no-unbounded-array claim. */
  bufferSizes(): Readonly<Record<string, number>> {
    return {
      talk: this.talk.size,
      offers: this.offers.size,
      claims: this.claims.size,
      pendingFills: this.pendingFills.length,
      censusTicks: this.census.retainedTicks,
      ventures: this.ventures.size,
      pendingCorrections: [...this.pendingCorrections.values()].reduce((n, r) => n + r.size, 0),
      pendingCorrectionPrincipals: this.pendingCorrections.size,
      elections: this.elections.size,
      electionsInFlight: this.electionsInFlight.size,
      deliveries: this.deliveries.size,
      reckonings: this.summaries.size,
      operatorFaults: this.faults.size,
      seals: this.seals.size,
      levyReckonings: this.levySummaries.size,
      ...this.levy.sizes(),
    };
  }

  /** Is the world stopped? Read from the one home of the status (§15.2). */
  get paused(): boolean {
    return this.engine.status === 'PAUSED';
  }

  /** Verbs this runtime actually implements. The API compares against the canon. */
  get liveVerbs(): ReadonlySet<string> {
    return new Set([...Object.keys(this.verbTable()), 'move', 'set_delivery_intent']);
  }

  // ── The tick ──────────────────────────────────────────────────────────────

  /**
   * Run one tick and fold the census.
   *
   * The census is read from the engine's own action log rather than from the API,
   * because an in-process cast never touches HTTP and a census that only counted
   * HTTP requests would report a world full of heuristics as having no decisions at
   * all — measuring the wrong thing in the same direction as the bug.
   */
  runTick(): TickReport {
    if (this.paused) {
      // The engine refuses this too, and says so in more detail. Checked here as well
      // because a scheduler spinning on a halted world is the "verify the invisible"
      // failure, and this is the door every front end comes through.
      throw new EngineError(
        `the world is PAUSED at tick ${String(this.engine.controller.haltRecord?.tick)}; nothing may tick ` +
          'until the failed tick is replayed from its immutable triple and a signed resume is issued',
      );
    }
    const report = this.engine.runTick();
    if (!report.halted) {
      for (const entry of this.engine.log.forTick(report.tick)) {
        this.census.record(report.tick, entry.decisionSource);
        if (entry.outcome === 'REFUSED' && entry.rejection !== null) {
          this.holdCorrection(entry.principal, {
            tick: report.tick,
            verb: entry.verb,
            clientSequence: entry.clientSequence,
            invariant: entry.rejection.invariant,
            hint: entry.rejection.hint,
            params: entry.params,
          });
        }
      }
    }
    // Fill requests never survive a tick: they are resolved in VENTURES or refused.
    this.pendingFills = [];
    // Neither do in-flight elections. The window this tick froze has been applied or
    // refused, so every statement in it is now either in the book or the subject of a
    // correction — and a survivor would keep flooring a readback the book has caught up
    // with. Cleared even on a halt, because a PAUSED world serves `stale: true` with no
    // affordances in it, so the overlay has no reader to mislead.
    this.electionsInFlight.clear();
    return report;
  }

  // ── Verbs ─────────────────────────────────────────────────────────────────

  private verbTable(): Readonly<Record<string, VerbHandler>> {
    return {
      create: (ctx, req) =>
        this.committing(ctx) ??
        this.sealCompliance(ctx, req) ??
        this.commonsCapacityRejection(req.principal) ??
        this.vCreate(ctx, req),
      fill_role: (ctx, req) =>
        this.committing(ctx) ??
        this.sealCompliance(ctx, req) ??
        this.commonsCapacityRejection(req.principal) ??
        this.vFillRole(ctx, req),
      sign: (ctx, req) => this.committing(ctx) ?? this.vSign(ctx, req),
      // ── `elect` is NOT behind `committing`, and it needs its own refusal ────
      //
      // `committing`'s sentence ends "submit again next tick", which is true of a
      // commitment and a lie about an election: the tick after the freeze is the
      // settlement tick, by which time the obligation this election was about has
      // already resolved. §5.1 forbids a *discretionary decision* inside the settlement
      // window, and the honest thing to tell a payer at that point is that its last
      // statement is what happens — not to try again.
      elect: (ctx, req) => this.electingFrozen(ctx) ?? this.vElect(ctx, req),
      withdraw: (ctx, req) => this.committing(ctx) ?? this.vWithdraw(ctx, req),
      abandon: (ctx, req) => this.committing(ctx) ?? this.vAbandon(ctx, req),
      publish_offer: (ctx, req) => this.vPublishOffer(ctx, req),
      message: (ctx, req) => this.vMessage(ctx, req),
      claim: (ctx, req) => this.vSay(ctx, req, false),
      deny: (ctx, req) => this.vSay(ctx, req, true),
      // ── `seal` IS NOW REGISTERED, and here is what had to be true first. ────
      //
      // Two blockers, both closed:
      //
      //   1. **Nothing resolved seals.** INV-20 requires every seal made in a Reckoning
      //      to be resolved exactly once when that Reckoning closes. The cast found the
      //      consequence in 288 ticks — 60 HALT-severity violations at tick 287 and a
      //      PAUSED world, reachable by any agent with one action (AGT-X9). The Reckoning
      //      driver now resolves every Reckoning's seals at its settlement tick, against
      //      real delivery deeds and a completeness witness whose counts come from the
      //      venture rows by a second road.
      //   2. **The affordance and the cast both sealed `verb: 'sign'`**, and this world
      //      records no `sign` deed — only the delivery, under {@link DELIVERY_VERB}. With
      //      the witness working, such a seal resolves `CONTRADICTED` **from an absence**:
      //      a permanent public lie about an agent that did exactly what the server's own
      //      affordance told it to (A5′, scar #1). Both call sites now name
      //      {@link DELIVERY_VERB}, and {@link Runtime.sealableRoles} is the single home
      //      of *when* a seal about a delivery can still be kept — so the affordance, the
      //      cast and PROP-D4's compliance gate cannot disagree about it.
      seal: (ctx, req) => this.vSeal(ctx, req),
      // ── The Levy's two verbs, and neither of them is new (§12.2, §17) ───────
      //
      // `deliver` and `vote` are already in the published verb table and the budget is at
      // 39 of 40, so this registers handlers for words that already existed rather than
      // spending the last slot. `set_delivery_intent` needs no handler here at all: it is
      // a built-in that creates a durable intent, and the intent re-submits `deliver`
      // through *this* table — which is what makes R19 ("payable by a standing intent, so
      // an offline agent can meet it") true without a second execution path.
      deliver: (ctx, req) => this.vDeliver(ctx, req),
      vote: (ctx, req) => this.vVote(ctx, req),
      // ── §9's three answers, and none of them is a new verb ─────────────────
      //
      // `yield`, `fight` and `join` are already in §12.2's table and already classified
      // in `world/commons.ts` (`demand` and `fight` HOSTILE, `yield` PEACEFUL, `join`
      // CONTEXTUAL on its `side`), so the 40-verb budget is untouched and the Commons
      // floor covers all three without a line of new classification. `flee` stays
      // unregistered on purpose: §9's flee is "targeting misses if the target moved",
      // which `move` already expresses, and a second spelling of one action would be
      // §3's forbidden second concept.
      yield: (ctx, req) => this.vYield(ctx, req),
      fight: (ctx, req) => this.vFight(ctx, req),
      join: (ctx, req) => this.vJoin(ctx, req),
      // ── A6: the two grant verbs. Issuing is a COMMITMENT, so it is refused in the
      // freeze like any other (§8.1: no grant spend in the settlement window). Revoking
      // is NOT behind `committing`: SPEC §8.1 #6 makes revocation always accepted, and
      // the attempted revocation is itself what posts — better drama than either extreme.
      grant: (ctx, req) => this.committing(ctx) ?? this.vGrant(ctx, req),
      revoke: (ctx, req) => this.vRevoke(ctx, req),
      // ── `trade` — §12.2's one market verb, now live ────────────────────────
      //
      // Behind `committing` for a reason that is not obvious and is load-bearing:
      // `reckoning/driver.ts:VERIFY_INPUTS` re-reads every payer's **free balance**
      // between the freeze and the settlement and halts on any difference in either
      // direction. Placing a bid locks cash, cancelling releases it, and either would
      // move that figure inside the window — pausing a healthy world on the one night
      // that has an audience (A14), over a trade nobody did anything wrong in. The
      // clearing pass is closed across the same window from the other side
      // (`clear.ts` skips the settlement tick), so the door shuts on both hinges.
      trade: (ctx, req) => this.committing(ctx) ?? this.vTrade(ctx, req),
    };
  }

  /**
   * The seal handler, exposed as well as registered.
   *
   * Kept because the seal tests drive it with a synthetic {@link PhaseContext} to reach
   * ticks the verb table's own clock would not put them at, and because a caller that
   * needs the handler without the table (the Reckoning fixtures) should not have to
   * reach through `verbTable`.
   */
  get sealHandler(): VerbHandler {
    return (ctx, req) => this.vSeal(ctx, req);
  }

  /**
   * PROP-D4's mandatory half, **as a validator on the acting path** — and the narrowest
   * one that makes the rule true.
   *
   * > "Seals are mandatory and free — one unbudgeted seal per venture you hold a role
   * > in. Optional seals mean a cast that never seals, which means no reveals, which
   * > means the design's only guaranteed clip generator produces nothing." — §11.1
   *
   * `SealBook.sealComplianceRejection` was written for this and had no caller, so the
   * rule was documentation. It is applied to **new commitments only** — `create` and
   * `fill_role`, the two verbs that add a role to the set carried into the freeze — and
   * deliberately to nothing else:
   *
   *   - **Never `elect`.** Gating the payment decision behind an unrelated rule is a
   *     road to a forced decline, and a decline is a permanent public default (A5′).
   *   - **Never `sign`.** A venture waiting on a countersignature would die in its
   *     window, and signing is what makes a role sealable in the first place.
   *   - **Never `withdraw` or `abandon`.** The exits must not be blockable.
   *   - **Never `seal`.** The cure cannot require itself.
   *   - **Never `move`, `message`, `claim`, `deny`, `publish_offer`.** None of them
   *     carries a role into the freeze, and a hand frozen in place is a map with no
   *     motion in it (A13).
   *
   * The set it asks about is {@link sealableRoles}, not every role held. That is the
   * whole reason this is safe: a role whose seal could not be kept is not a role a
   * seal may be *demanded* for, or the engine would be compelling agents into marks
   * they cannot avoid. It is a validator and not a penalty for the Commons floor's
   * reason (A8): the cure is free, immediate and offered in the same observation.
   */
  private sealCompliance(ctx: PhaseContext, req: ActionRequest): Rejection | null {
    const held = this.sealableRoles(req.principal, ctx.tick);
    if (held.length === 0) return null;
    return this.seals.sealComplianceRejection(req.principal, ctx.tick, held);
  }

  /**
   * Roles this principal holds for which a seal made **now** could still be kept.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * ONE HOME, THREE READERS: the `seal` affordance, the cast, and PROP-D4's compliance
   * gate. Three copies of this predicate is three chances for the engine to demand or
   * offer a seal that its own resolver will mark `CONTRADICTED`, which is A5′ with the
   * server's fingerprints on it.
   *
   * Every clause is a rule from `src/seal/verdict.ts`'s four attribution rules read
   * backwards, i.e. *what must hold for an honest agent's deed to be attributable*:
   *
   *   - **`LIVE`.** A venture reaches `LIVE` only fully filled, and then it delivers at
   *     its delivery tick ({@link DELIVERED_STATES}) — so the deed will exist. A
   *     `FORMING` venture may never fill, and its role holder would then be
   *     `CONTRADICTED` from an absence it did not cause.
   *   - **The delivery is still ahead** (rule 3: a deed at or before the seal cannot
   *     honour it). A seal written after the delivery is a pre-commitment made in
   *     hindsight, and the resolver correctly refuses to honour it.
   *   - **The delivery is in this same Reckoning** (rule 2, scar #7: a seal is judged
   *     only against its own window). A seal at Reckoning 1 for a delivery at Reckoning
   *     2 is judged with no deed in range at all.
   *
   * **There is deliberately no `inFreeze(tick)` clause**, and that is a mutation-test
   * result rather than an omission. One was written — `SealBook.commit` refuses inside the
   * freeze, so offering a seal there would be AGT-S2 — and deleting it changed nothing
   * observable, because the delivery clause already excludes every freeze tick: `create`
   * schedules delivery at `resolvesAtTick - DELIVERY_LEAD_TICKS`, `resolvesAtTick` is
   * always a settlement tick, and {@link DELIVERY_LEAD_TICKS} exceeds `FREEZE_TICKS`, so a
   * venture's delivery is always strictly before its freeze. A guard no test can bite on
   * is indistinguishable from a clean bill of health, so the *dependency* is asserted
   * instead — see {@link assertSealSchedule}, which fires if those constants ever move.
   * ══════════════════════════════════════════════════════════════════════════
   */
  sealableRoles(principal: PrincipalId, tick: number): readonly SealRoleRef[] {
    const out: SealRoleRef[] = [];
    for (const venture of this.ventures.forPrincipal(principal)) {
      if (venture.state !== 'LIVE') continue;
      const delivery = this.deliveryTickOf(venture);
      if (delivery <= tick) continue;
      if (reckoningOf(delivery) !== reckoningOf(tick)) continue;
      const role = roleOfPrincipal(venture, principal);
      if (role === null) continue;
      out.push({ venture: venture.id, roleIndex: role.index });
    }
    return out.sort((a, b) =>
      a.venture === b.venture ? a.roleIndex - b.roleIndex : compareIds(a.venture, b.venture),
    );
  }

  /**
   * The band a seal on a delivery can honestly claim, in `MINOR`.
   *
   * The proceeds are `gross + residual` where the residual is a **seeded draw inside a
   * band the kind publishes**, so `[p10, p90]` is not a forecast — it is the exact
   * closed interval the rules permit, and `residualAtPercentile` returns the band's two
   * ends rather than quantiles of a distribution. A venture that is `LIVE` is fully
   * filled, so the full-fill quote is the one that will be paid.
   *
   * That makes a seal an agent copies out of its affordance **keepable by
   * construction**, which is the only acceptable default when the penalty for missing
   * is permanent and public (A5′). An agent that wants to say something bolder narrows
   * the band itself, and the affordance's own text says so.
   */
  deliveryBandOf(venture: VentureRecord): { readonly low: Minor; readonly high: Minor } {
    const band = proceedsBand(venture.kind, allRoleIndices(venture), NEUTRAL_STAGE_BPS);
    return { low: band.p10, high: band.p90 };
  }

  /**
   * §5.1's hard freeze, as a refusal: **no new commitments** at the freeze or the
   * settlement tick.
   *
   * > **Freeze** (last tick before settlement). Hard: no new commitments, no book
   * > clears, no raid resolution, no grant spend, no hazard against any object in the
   * > settlement set. — §5.1
   *
   * This is not tidiness, it is the only thing standing between an ordinary action and
   * a false default. `verifyFrozenInputs` re-reads the escrow balance and the payer's
   * free stores at the settlement tick and **halts on any difference in either
   * direction** — so one `create` by a payer at tick 287 funds an escrow out of the
   * stores the settlement was computed from, and the world pauses on a tick where
   * nothing was actually wrong. INV-18 says the same thing about the events those verbs
   * emit.
   *
   * A refusal and never a halt: the acts are legal a tick later, the hint says so, and
   * a halt an agent can reach by doing something ordinary is a denial of settlement
   * (AGT-X9).
   *
   * The settlement tick is included as well as the freeze tick, and that is the whole
   * point of the pair being two ticks: INV-18's interval is `(frozenAtTick,
   * settlementTick]`, so the tick that settles is inside the window it protects.
   */
  private committing(ctx: PhaseContext): Rejection | null {
    if (!ctx.clock.inFreeze && !ctx.clock.isSettlementTick) return null;
    return reject(
      'INV-18',
      `the Reckoning's freeze has begun (tick ${String(ctx.tick)} of Reckoning ` +
        `${String(ctx.clock.reckoning)}): no new commitments and no withdrawals until it has settled. ` +
        'Everything the settlement pays from was read at the freeze, so moving any of it now would record a ' +
        'promise as broken that nobody broke. Nothing was lost — submit again next tick. (`elect` is closed ' +
        'too, for a different reason and with a different answer: see its own refusal — what you last stated ' +
        'is what happens tonight, and submitting again will not change it.)',
    );
  }

  private vCreate(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const kind = readEnum(req.params, ['kind'], VENTURE_KINDS);
    if (kind === null) {
      return reject(
        'A2',
        `create needs a kind: {"kind": "HAUL"}. The kinds are ${VENTURE_KINDS.join(' · ')}.`,
      );
    }
    // The venture belongs to `creator`. Usually that is the actor; when `on_behalf_of`
    // names another principal, the actor is a DELEGATE spending the grantor's stores
    // under a grant (A6). The grant gate runs below, once the escrow amount is known —
    // before any value moves, so a refusal leaves the world untouched.
    const onBehalf = readString(req.params, ['on_behalf_of', 'onBehalfOf', 'for']) as PrincipalId | null;
    const creator = onBehalf ?? req.principal;
    const delegated = onBehalf !== null && onBehalf !== req.principal;
    if (delegated && this.world.holdingByPrincipal.get(creator) === undefined) {
      return reject('A2', `there is no principal ${creator} to create a venture on behalf of.`);
    }
    const stage = readString(req.params, ['stage', 'system', 'at']) as SystemId | null;
    const hands = handsOf(this.world, creator);
    const here = stage ?? hands[0]?.location;
    if (here === undefined || !this.world.map.systems.has(here)) {
      return reject(
        'A2',
        `create needs a stage — the system it happens in. Name one where ${delegated ? String(creator) : 'you'} ` +
          'has a hand.',
      );
    }
    const value = readInt(req.params, ['value', 'value_minor']) ?? kindSpec(kind).baseYieldMinor;
    if (value <= 0 || value > 1_000_000_000) {
      return reject('PROP-V5', `value must be a positive amount under 1000000000, got ${String(value)}.`);
    }

    const opens = ctx.tick;
    const closes = opens + FORMATION_WINDOW_TICKS;
    // `+ DELIVERY_LEAD_TICKS` before the search, so the settlement it lands on is at
    // least that far past the window's close and the venture can always reach its own
    // delivery **outside the freeze**. Without the lead, a venture whose window closed
    // at the freeze tick would have to deliver inside it — which moves a figure the
    // settlement was computed from and halts the world on a healthy Reckoning.
    const resolves = nextSettlementAtOrAfter(closes + DELIVERY_LEAD_TICKS);
    const id = this.mintVentureId(ctx.tick, creator);

    const made = createVenture({
      id,
      kind,
      creator,
      stage: here,
      terms: defaultTerms(kind, minor(value)),
      windowOpensTick: opens,
      windowClosesTick: closes,
      resolvesAtTick: resolves,
      valuation: pinnedAt(DEFAULT_VALUATION_RULE, ctx.tick),
      rulesVersion: RULES_VERSION,
    });
    if (!made.ok) return made;

    // A7: the escrowed half is locked **up front**, out of the CREATOR's own free
    // balance. Checked here as a rejection so the ledger's throw is unreachable
    // from a request; wrapped below in case the two ever disagree.
    const required = escrowRequired(made.value);
    // ══════════════════════════════════════════════════════════════════════════
    // **A7's OTHER HALF, AND THE LIMIT NOTHING USED TO CHARGE.**
    //
    // Every role carries an elective part (`defaultTerms`) and the top-yield kinds are
    // legally un-escrowable, so `BUILD` and `SIEGE` are **100% elective**. The elective
    // part does not auto-execute: at the Reckoning the CREATOR is asked for it, and
    // silence is a decline, which is a permanent public default (A5).
    //
    // So on a delegated create it is the grantor — who may not have woken — that carries
    // it, and it is exactly what SPEC §8.1 #2's `max_contingent_liability` is for. It was
    // carried, shown, VC-serialised and INV-22-checked, and charged NOWHERE: the gate
    // below tested escrow against direct headroom only, and the draw was recorded with
    // `contingent: 0`. A grant issued with `max_direct_loss: 0` therefore showed its owner
    // a worst case of ZERO while a delegate opened un-escrowable top-yield ventures in its
    // name at zero headroom — `0 > 0` is false, so the gate passed, no spend was recorded,
    // INV-22 saw nothing, and the authority line rendered `UNUSED` over an unbounded
    // liability. A6's headline promise ("max_direct_loss and max_contingent_liability are
    // shown before you sign") was false as built.
    //
    // Derived from `made.value` — the terms the venture is ACTUALLY created with — never
    // re-guessed from the kind and the value, or the number gated would drift from the
    // number owed the moment terms stop being the default (scar #1's shape).
    // ══════════════════════════════════════════════════════════════════════════
    const elective = electiveTotal(made.value);

    // ── The delegation gate (A6, §8.1). Runs BEFORE any value moves. A delegate needs a
    // live grant from the creator, and a delegated create draws on BOTH of its LIMITS:
    // the escrow against DIRECT headroom (value locked out of the grantor's stores now),
    // the elective tail against CONTINGENT headroom (value the grantor is asked for at
    // settlement and defaults on by staying silent). Neither may pass the worst case the
    // grantor was shown (A7). This is the gate; INV-22 is the net.
    let grant: Grant | null = null;
    if (delegated) {
      grant = this.grantBook.liveGrantBetween(creator, req.principal, ctx.tick);
      if (grant === null) {
        return reject(
          'INV-23',
          `you hold no live grant from ${creator} to act on its behalf. Ask it to grant you scoped authority ` +
            '(verb: grant), or create on your own account.',
        );
      }
      const headroom = this.grantBook.headroom(grant.id);
      if (required > headroom.direct) {
        return reject(
          'INV-22',
          `this escrow of ${String(required)} would exceed grant ${grant.id}'s remaining direct headroom of ` +
            `${String(headroom.direct)} (max_direct_loss ${String(grant.maxDirectLoss)}, already spent ` +
            `${String(grant.spentDirect)}). A delegate can never lose the grantor more than the worst case it ` +
            'was shown before signing (A7, §8.1 #2).',
        );
      }
      if (elective > headroom.contingent) {
        return reject(
          'INV-22',
          `the elective part of this ${kind} totals ${String(elective)} and would exceed grant ${grant.id}'s ` +
            `remaining contingent headroom of ${String(headroom.contingent)} ` +
            `(max_contingent_liability ${String(grant.maxContingentLiability)}, already spent ` +
            `${String(grant.spentContingent)}).` +
            (isEscrowable(kind)
              ? ''
              : ` ${kind} is a top-yield kind and is legally un-escrowable, so ALL of it is elective —` +
                ' nothing about it is secured by escrow.') +
            ` The elective part does not auto-execute: ${creator} is asked for it at the Reckoning and ` +
            'staying silent is a decline, which is a permanent public default. That is contingent liability, ' +
            'not escrow, and it is capped by the second LIMIT the grantor was shown before it signed (A6, A7, ' +
            '§8.1 #2). Ask for a wider max_contingent_liability, lower the value, or create on your own ' +
            'account.',
        );
      }
      // INV-26's cap, as a REFUSAL rather than a throw. `recordSpend` throws when the
      // journal is full, and it is called below inside the value-moving path — so a full
      // journal used to abort the tick for an act that was merely not allowed.
      if (this.grantBook.allSpends().length >= MAX_GRANT_SPENDS) {
        return reject(
          'INV-26',
          `the grant spend journal is at its cap of ${String(MAX_GRANT_SPENDS)} draws, so this draw cannot be ` +
            'recorded and an unrecorded draw is an uncapped one. Nothing was created. Grants expire; act on ' +
            'your own account until this one does.',
        );
      }
    }

    const stores = storesAccount(creator);
    if (this.ledger.account(stores) === undefined) {
      return reject('INV-1', `${delegated ? String(creator) + ' has' : 'you have'} no stores account.`);
    }
    const free = this.ledger.freeBalance(stores);
    if (free < required) {
      return reject(
        'A7',
        `${kind} at value ${String(value)} needs ${String(required)} escrowed up front and ` +
          `${delegated ? String(creator) + "'s" : 'your'} stores have ${String(free)} free. Lower the value, or ` +
          'price more of it elective — the elective half is the only part standing can accrue to anyway.',
      );
    }
    // ── Everything that mutates, inside ONE guard ─────────────────────────────
    //
    // `recordSpend` used to sit AFTER this block and OUTSIDE it, on the reasoning that a
    // draw recorded after the money moved cannot disagree with the ledger. But it mutates
    // the row and then appends to a capped journal, so it can throw — and a throw there
    // aborts the tick with the escrow already funded, which turns an act that should have
    // been refused into a halted world. A refusal must stay a refusal (AGT-X9).
    //
    // So it is first, and inside the guard. Ordering the draw before the transfer is
    // deliberate: if the (already unreachable) transfer failed afterwards the residue
    // would be a recorded draw against a grant with no value moved — the grantor's
    // exposure over-stated, which is safe — where the other order leaves currency locked
    // in the escrow of a venture that was never added to the book.
    let drew = false;
    try {
      // Bounded by the two headroom checks above and by the journal-cap check; INV-22
      // re-checks the sum at tick close. Both actor and principal are on the event below.
      // The split is the honest one: escrow is DIRECT (locked now), the elective tail is
      // CONTINGENT (owed at settlement). Neither is counted as the other.
      if (delegated && grant !== null && (required > 0 || elective > 0)) {
        this.grantBook.recordSpend({
          grant: grant.id,
          delegate: req.principal,
          tick: ctx.tick,
          eventId: `escrow:${id}` as EventId,
          direct: required,
          contingent: elective,
        });
        drew = true;
      }
      openVentureEscrow(this.ledger, id, creator);
      if (required > 0) {
        this.ledger.transferCurrency({
          eventId: `escrow:${id}` as never,
          tick: ctx.tick,
          from: stores,
          to: escrowAccount(id, creator),
          amount: required,
        });
      }
    } catch (error: unknown) {
      // Never a halt from a request. No venture was added to the book, and the escrow
      // account is empty if it opened. The one thing that may survive is the recorded
      // draw, and the hint says so rather than claiming "nothing happened".
      return reject(
        'A7',
        `the escrow for ${id} could not be funded (${describeError(error)}). No venture was created` +
          (drew ? `, though the attempted draw is on grant ${grant?.id ?? '?'}` : '') +
          '.',
      );
    }

    this.ventures.add(made.value);
    ctx.emit({
      tick: ctx.tick,
      kind: 'venture.formed',
      rulesVersion: RULES_VERSION,
      // Both actor and principal on the receipt: a delegated formation names the delegate
      // that acted AND the grantor whose stores were committed, plus the grant it drew on.
      actorPrincipalId: req.principal,
      onBehalfOfPrincipalId: delegated ? creator : null,
      grantId: grant?.id ?? null,
      eventFamilyId: `venture::${id}`,
      parentEventId: null,
      isPublic: true,
      publicAt: ctx.tick,
      // A `PUBLIC` row declassifies at birth, so `declassifyAt` **is** the tick — the
      // ladder's own rule (`visibilityRule('PUBLIC').declassifyAt === 'BIRTH'`), checked
      // on the append path. This was `null`, which the record refuses; it went unnoticed
      // because nothing was wired to append these drafts, so every formation row this
      // runtime ever emitted was silently dropped at COMMIT.
      declassifyAt: ctx.tick,
      provenanceClass: 'FACT',
      actedOnStateVersion: ctx.frozenStateVersion,
      decisionSource: req.decisionSource,
      payload: {
        venture: id,
        kind,
        stage: here,
        escrowed: required,
        // The unsecured tail, on the record at formation. A7 requires the priced
        // elective part to be *displayed*, and a receipt that showed only the escrow
        // would describe an un-escrowable BUILD as a venture with nothing at stake.
        elective,
        termsHash: made.value.termsHash,
        ...(delegated ? { creator, onBehalfOf: creator, grant: grant?.id ?? null } : {}),
      },
      visibility: 'PUBLIC',
      audience: [],
    });
    return { ok: true, value: null };
  }

  private vFillRole(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const ventureId = readString(req.params, ['venture', 'venture_id']) as VentureId | null;
    const roleIndex = readInt(req.params, ['role', 'role_index', 'roleIndex']);
    const handId = readString(req.params, ['hand', 'hand_id']) as HandId | null;
    if (ventureId === null || roleIndex === null || handId === null) {
      return reject(
        'A2',
        'fill_role needs {"venture": "<id>", "role": <index>, "hand": "<hand_id>"}. The open roles you are ' +
          'eligible for are in ventures.board[].',
      );
    }
    const venture = this.ventures.get(ventureId);
    if (venture === undefined) return reject('PROP-V6', `there is no venture ${ventureId}.`);
    const hand = this.world.hands.get(handId);
    if (hand === undefined) return reject('A2', `there is no hand ${handId}.`);
    if (hand.principal !== req.principal) {
      return reject('INV-9', `hand ${handId} is not yours. You fill a role with your own hand.`);
    }
    if (roleIndex < 0 || roleIndex >= venture.roles.length) {
      return reject('PROP-V6', `${ventureId} has roles 0..${String(venture.roles.length - 1)}.`);
    }
    // ── ANTI-SELF-DEALING (SPEC §8.1 #3, INV-23) ─────────────────────────────
    //
    // A delegate may not be a counterparty to a deal it holds authority over. If you hold
    // a live grant over this venture's creator, you could have shaped the venture in your
    // own favour and funded its escrow from the creator's OWN stores — so you may not also
    // fill a role in it and be paid out of that escrow. That is the classic betrayal's
    // trivial form (create on the grantor's behalf, then pay yourself), and A6's whole
    // claim is that betrayal is subtle and legitimate, not this. Filling roles in ventures
    // whose creator you have no authority over is untouched.
    //
    // The question is asked at the venture's CREATION tick, not at this one. Asking it
    // at `ctx.tick` left a one-tick bypass around the only guardrail A6 has, and it was
    // the trivial betrayal named above wearing a delay: hold a grant, create a venture
    // on the grantor's behalf funded from the grantor's own stores, let the grant expire
    // (or revoke it yourself — revocation takes effect next tick), then fill a paid role
    // one tick later. `liveGrantBetween` returned null, the guard never ran, and the
    // delegate was paid out of an escrow it had shaped with someone else's money. Found
    // by a codex review of the grant accounting.
    //
    // Creation-tick is also strictly STRONGER than the check it replaces rather than
    // merely different, which is why this is a one-word fix and not a second condition:
    // liveness is `atTick <= end`, so a grant live now was necessarily live at creation
    // too. Every case the old check caught, this one still catches.
    if (
      venture.creator !== req.principal &&
      this.grantBook.liveGrantBetween(venture.creator, req.principal, venture.windowOpensTick) !==
        null
    ) {
      return reject(
        'INV-23',
        `you held a grant over ${venture.creator} when venture ${ventureId} was created, so you may ` +
          'not also fill a role in it: a delegate cannot be a counterparty to a deal it has authority ' +
          'over (self-dealing, §8.1 #3). Letting the grant lapse does not clear this — the conflict is ' +
          'that you could have shaped the venture. Fill roles in ventures whose creator you have no ' +
          'authority over.',
      );
    }
    // ── GEOGRAPHY IS NOT ENFORCED HERE, AND IT IS NOT AN OVERSIGHT ────────────
    //
    // `fillRole` checks `isPresent`, which is about the hand's *state* — not in transit,
    // not recovering — and says nothing about **which system** it is present in. So a hand
    // sitting in one Commons system fills a role staged three lanes away, and two Gate-3
    // probes did exactly that. Every other surface says otherwise: the `fill_role`
    // affordance in `src/observe/catalogue.ts` requires presence at the stage, and `move`'s
    // own `what_it_forecloses` promises "this hand cannot fill a role until it arrives".
    // A rule three surfaces state and the engine does not enforce is scar #1's shape, and
    // its consequence is that geography is decorative, `move` is a wasted action, and the
    // map — the game's only agreed representation (A13) — is a picture of nothing.
    //
    // `occupiesSystem(hand, venture.stage)` is the whole check, and it was **written,
    // measured, and taken back out**: the heuristic cast's `openSlotFor`
    // (`src/cast/heuristic.ts`) filters candidate slots by *tier*, not by system, and the
    // launch map has four COMMONS systems. With the check in, the cast picked an
    // unreachable slot, was refused, and picked the same one again every tick — 777
    // repeated `fill_role INV-9` refusals in one Reckoning, **zero ventures live and zero
    // settled**. That is Gate 3's own 0/0 failure, caused by the fix for it, and a silent
    // world is worse than a decorative map.
    //
    // It is therefore a **coupled** change across three files and it cannot land in one:
    //   1. `src/cast/heuristic.ts:openSlotFor` — `continue` unless `venture.stage` is a
    //      system the member has an idle hand in, instead of comparing tiers.
    //   2. `src/api/observe.ts` — the `fill_role` affordance picks `hands.find(IDLE)`
    //      regardless of where it is, so it would start offering acts the engine refuses
    //      (AGT-S2). It must pick an idle hand **at `row.stage`**, and skip the row if
    //      there is none.
    //   3. this check, restored.
    // Reported upward rather than half-shipped.

    if (this.pendingFills.length >= MAX_TALK_ENTRIES) {
      return reject('INV-26', 'the fill queue for this tick is full; try the next tick.');
    }
    // A request, not a grant (PROP-V8). Resolved once at VENTURES, from the set.
    this.pendingFills.push({
      venture: ventureId,
      roleIndex,
      principal: req.principal,
      hand: handId,
      // ── THE AGENT'S OWN SEQUENCE, NOT THIS QUEUE'S LENGTH ───────────────────
      //
      // `FillRequest.clientSequence` is documented as "§12.3's per-batch ordering key, a
      // statement of the agent's own preference", and `canonicalRequestOrder` breaks its
      // last tie on it. It was the *length of the pending array*, which is arrival order —
      // so which of one principal's own hands took a contested slot was decided by which
      // packet landed first, inside the one comparator written to make that impossible
      // (A4). It is also the number the refusal above echoes back, and a correction
      // citing a sequence the agent never sent is one it cannot match to anything it did.
      clientSequence: this.sequenceOf(ctx, req),
      stake: minor(readInt(req.params, ['stake', 'stake_minor']) ?? 0),
    });
    return { ok: true, value: null };
  }

  /**
   * `sign` — countersign the terms. **Nothing else.**
   *
   * The election used to ride here as an optional parameter, and it was the right
   * answer to a canon gap that no longer exists: SPEC §12.2 now has `elect`. Two
   * reasons it had to move, and the second is the one that mattered:
   *
   *   - On a **share** role the real due is not known until the residual is drawn at
   *     resolution, so a payer electing at signing is guessing rather than choosing.
   *   - **The moment of betrayal was not expressible.** A6's signature moment is
   *     authority abused *at the moment of maximum leverage*; a choice fixed at signing
   *     has no such moment, and §7.6's falsification test — *is the elective part always
   *     honoured?* — cannot be asked of a payer that was never offered the choice when
   *     it counted.
   *
   * So: `sign` binds the terms and {@link vElect} decides the payment. One verb, one
   * concept (§3). An `election` key on a `sign` request is **not** silently ignored —
   * see {@link electionOnSign} for why that would be the worst of the three options.
   */
  /**
   * The `client_sequence` the agent actually sent for the action being applied.
   *
   * `ActionRequest` does not carry it — the handler is given the principal, the verb and
   * the params, and nothing about the submission — but `PhaseContext.actions` is the
   * frozen window and holds it. Matched on **reference identity of the params object**,
   * because `applyOne` hands the handler the very object the window is holding: a field
   * comparison would find an action that merely *looks* the same, which for two of one
   * principal's own competing commitments is precisely the case that matters.
   *
   * Indexed once per tick and memoised against the window array itself, which is one
   * object for the whole tick — so this is a single pass over the window per tick rather
   * than a scan per action, and a `WeakMap` means it is bounded without anything having to
   * clear it (INV-26).
   *
   * A standing intent has no queued action at all and answers 0. That is deliberate and it
   * is not a collision: with the sequence equal, `canonicalRequestOrder` falls through to
   * the hand id, which is deterministic and has nothing to do with arrival.
   */
  private sequenceOf(ctx: PhaseContext, req: ActionRequest): number {
    let index = this.sequenceIndex.get(ctx.actions);
    if (index === undefined) {
      index = new Map<object, number>();
      for (const action of ctx.actions) index.set(action.params, action.clientSequence);
      this.sequenceIndex.set(ctx.actions, index);
    }
    return index.get(req.params) ?? 0;
  }

  private vSign(_ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const ventureId = readString(req.params, ['venture', 'venture_id']) as VentureId | null;
    const hash = readString(req.params, ['terms_hash', 'termsHash']);
    if (ventureId === null || hash === null) {
      return reject(
        'PROP-W1',
        'sign needs {"venture": "<id>", "terms_hash": "<hash>"}. Nothing binds until both parties ' +
          'countersign the same terms_hash.',
      );
    }
    const venture = this.ventures.get(ventureId);
    if (venture === undefined) return reject('PROP-V6', `there is no venture ${ventureId}.`);

    const misplaced = electionOnSign(req);
    if (misplaced !== null) return misplaced;

    if (!venture.countersigned.has(req.principal)) {
      const echoed = readInt(req.params, ['your_take_at_p50', 'take_at_p50']);
      const server = yourTakeAtP50(venture, req.principal);
      const signed = countersign(venture, req.principal, hash, minor(echoed ?? server), server);
      if (!signed.ok) return signed;
    }
    // Signing twice is not an error and the signature does not move, so this is an
    // accept rather than a refusal.
    return { ok: true, value: null };
  }

  /**
   * `elect` — what the payer will pay on **one** elective role, restatable until the
   * freeze.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * `agent.md`'s promises, each mapped to the line that keeps it:
   *
   * | promise | where |
   * |---|---|
   * | "state what you will pay on **each** elective role" | `role` is required; the book is keyed per role |
   * | "you may restate it right up to the freeze" | no once-only guard; the last statement wins |
   * | "you cannot change it during settlement" | {@link electingFrozen}, and §5.1 |
   * | "silence is a decline, not a pass" | nothing is written unless the payer writes it (PROP-V4) |
   * | "`IN_FULL` never pays more than you owe" | `electionFor` caps at the due, in `settlement.ts` |
   * | "an unfundable `IN_FULL` is unfunded, not declined" | `finaliseVenture` splits `DECLINED` from `UNFUNDED` |
   *
   * **The engine never infers an election** — not a default that pays, not a branch that
   * reads an intention out of a signature. That is PROP-V4's second clause, and an
   * engine that elected on the payer's behalf would delete A7 and answer §7.6 with its
   * own arithmetic instead of with an agent's decision.
   * ══════════════════════════════════════════════════════════════════════════
   */
  private vElect(_ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    // The same reader the window notice uses, so a spelling this handler honours can
    // never be one the readback missed. See {@link electionFieldsOf}.
    const { venture: ventureId, roleIndex, raw } = electionFieldsOf(req.params);
    if (ventureId === null || roleIndex === null || raw === undefined) {
      return reject(
        'A2',
        'elect needs {"venture": "<id>", "role": N, "election": "IN_FULL"} — or an amount of minor units ' +
          'in place of IN_FULL. It is per role, because what you owe one counterparty is not what you owe ' +
          'another, and you may restate it every tick until the freeze.',
      );
    }
    const venture = this.ventures.get(ventureId);
    if (venture === undefined) return reject('PROP-V6', `there is no venture ${ventureId}.`);

    // ── AN ELECTION ON A FINISHED OBLIGATION IS A KEY THAT IS NEVER RELEASED ──
    //
    // {@link releaseElections} runs when an obligation reaches a terminal state, so an
    // election accepted *after* that is never cleaned up — and the book is a **shared**
    // resource with a published cap. An agent that elected on a few thousand of its own
    // settled ventures would fill it and then every other payer's `elect` is refused for
    // INV-26, silently forcing `DECLINED` defaults on principals that tried to pay. That
    // is A5′ reached sideways, through a buffer.
    //
    // So the electable states are exactly the ones that still release: what has not
    // settled yet, plus a deferral, which carries the same pot to the next Reckoning and
    // whose election is deliberately kept alive (§15.3).
    if (!ELECTABLE_VENTURE_STATES.includes(venture.state)) {
      return reject(
        'PROP-V6',
        `${venture.id} is ${venture.state}, so there is nothing left to elect on it — its elective parts were ` +
          'settled or its formation was abandoned, and the record of what was paid is already permanent. ' +
          `Elections are live while a venture is ${ELECTABLE_VENTURE_STATES.join(', ')}.`,
      );
    }

    // The payer, and nobody else. The elective half is paid out of the creator's own
    // stores, so anyone else electing on it would be spending another agent's money.
    if (venture.creator !== req.principal) {
      return reject(
        'PROP-V4',
        `only ${venture.creator} elects on ${venture.id}: the elective half is paid out of the payer's own ` +
          'stores, and you are not the payer here. Your own elective parts are on the ventures you created.',
      );
    }
    const role = venture.roles.find((r) => r.index === roleIndex);
    if (role === undefined) {
      return reject(
        'PROP-V6',
        `${venture.id} has no role ${String(roleIndex)}; its roles are ` +
          `${venture.roles.map((r) => `${String(r.index)} (${r.label})`).join(', ')}.`,
      );
    }
    // A creator holding one of its own roles owes itself nothing: settlement books that
    // payment as fully paid *before* it reads the election, so it can never read as a
    // breach (scar #9). Said out loud rather than accepted as a no-op, because an agent
    // that thinks it is paying somebody is an agent budgeting for a payment that will
    // never happen.
    if (role.filledByPrincipal === req.principal) {
      return reject(
        'PROP-V4',
        `you hold role ${String(roleIndex)} of ${venture.id} yourself, so there is nothing to elect: a ` +
          'payment to your own stores is booked as paid in full, earns you no standing, and can never be ' +
          'recorded as a default. Elect on the roles other principals hold.',
      );
    }
    if (!isElection(raw)) {
      return reject(
        'PROP-V4',
        'an election is "IN_FULL" or a whole non-negative amount of minor units. IN_FULL pays whatever the ' +
          'elective part turns out to be, which on a share role is not knowable until the venture resolves — ' +
          'an amount short of the due is a decline, and a decline is a default on the record.',
      );
    }
    const key = electionKey(venture.id, roleIndex);
    if (this.elections.size >= MAX_ELECTIONS && !this.elections.has(key)) {
      return reject(
        'INV-26',
        `the election book is full at its published cap of ${String(MAX_ELECTIONS)}; elections are released ` +
          'when their ventures settle. Restating one you have already made is always allowed, because it ' +
          'does not grow the book.',
      );
    }
    this.elections.set(key, raw);
    return { ok: true, value: null };
  }

  private mintGrantId(tick: number, principal: PrincipalId): GrantId {
    this.grantCounter += 1;
    const stamp = canonicalHash({ tick, principal, ordinal: this.grantCounter }).slice(0, 8);
    return `g:${String(tick)}:${stamp}` as GrantId;
  }

  /**
   * `grant` — hand a delegate scoped authority over your OWN stores (SPEC §8, A6). This
   * is the core loop's issuance half: the grant, and the worst case accepted before
   * signing, both on the permanent public record. The *use* of it (betrayal or not) is
   * the delegate's, later, through ordinary verbs — there is no `betray()`.
   *
   * ── WHY A PARAMS PATH, NOT A SUBMITTED VC ──────────────────────────────────
   * A grant serialises AS a W3C VC (`identity/vc.ts`), signed by the grantor — that is
   * how a counterparty verifies a delegate offline. But the `Keyring` holds only public
   * keys and the house cast has no keypair, so the runtime cannot mint a VC and the cast
   * could never grant. So the authoritative record is this row (hashed, replayed,
   * enforced), created from parameters under the grantor's already-authenticated action;
   * the signed, portable VC is the grantor's to produce from these same claims. Both
   * describe one grant — the row is what the tick loop enforces, the credential is what
   * travels.
   */
  private vGrant(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const grantor = req.principal;
    const delegate = readString(req.params, ['delegate', 'to', 'grantee']) as PrincipalId | null;
    if (delegate === null) {
      return reject(
        'A2',
        'grant needs {"delegate":"<principal>","template":"...","max_direct_loss":N,' +
          '"max_contingent_liability":N,"expires_tick":T}. The delegate then acts on your stores within ' +
          'these LIMITS, and these two numbers are the most it can ever lose you — shown before you sign (A7).',
      );
    }
    if (delegate === grantor) {
      // A→…→A launders unlimited self-authority into a scoped namespace where the limits
      // were stripped (SPEC §8.1 #4, INV-23). The first hop of that is a self-grant.
      return reject(
        'INV-23',
        'you cannot grant authority to yourself: a delegate spends someone ELSE\'s stores under a limit, and ' +
          'authority over your own is already unlimited.',
      );
    }
    if (this.world.holdingByPrincipal.get(delegate) === undefined) {
      return reject('A2', `there is no principal ${delegate} to delegate to; name one that has enrolled.`);
    }
    const template = readString(req.params, ['template']) ?? 'custom';
    if (!GRANT_TEMPLATES.includes(template)) {
      return reject('A2', `template must be one of ${GRANT_TEMPLATES.join(', ')}; got "${template}".`);
    }
    const maxDirect = readInt(req.params, ['max_direct_loss', 'maxDirectLoss']);
    const maxContingent = readInt(req.params, ['max_contingent_liability', 'maxContingentLiability']) ?? 0;
    if (maxDirect === null || maxDirect < 0 || maxContingent < 0) {
      return reject(
        'A7',
        'a grant must state its worst case: max_direct_loss (≥0) and max_contingent_liability (≥0). LIMITS ' +
          'cap destruction, not just transfers — a delegate can burn your cargo without moving a coin, so both ' +
          'halves are bounded (SPEC §8.1 #2).',
      );
    }
    const expiresTick = readInt(req.params, ['expires_tick', 'expiresTick']);
    if (expiresTick === null || expiresTick <= ctx.tick) {
      return reject(
        'A2',
        `a grant must expire in the future: expires_tick must be greater than ${String(ctx.tick)}. Grants ` +
          'expire by design (SPEC §8.1 #5) — the short life is what makes each renewal a decision.',
      );
    }
    if (expiresTick > ctx.tick + GRANT_MAX_LIFETIME_TICKS) {
      return reject(
        'A14',
        `a grant may live at most ${String(GRANT_MAX_LIFETIME_TICKS)} ticks (~3 Reckonings): expires_tick ` +
          `must be ≤ ${String(ctx.tick + GRANT_MAX_LIFETIME_TICKS)}. Authority decays and must be renewed ` +
          '(scar #7, the sticky vow); a renewal is a fresh, visible decision.',
      );
    }
    if (this.grantBook.all().length >= MAX_GRANTS) {
      // Every grant is a new row (unique id), so unlike an election there is no free
      // "restate" case — the book only grows, so bound it (INV-26).
      return reject(
        'INV-26',
        `the grant book is at its cap of ${String(MAX_GRANTS)}. Grants expire; wait for outstanding ones to ` +
          'lapse, or revoke ones you no longer need.',
      );
    }
    const id = this.mintGrantId(ctx.tick, grantor);
    const grant: Grant = {
      id,
      grantor,
      delegate,
      template,
      maxDirectLoss: minor(maxDirect),
      maxContingentLiability: minor(maxContingent),
      spentDirect: minor(0),
      spentContingent: minor(0),
      expiresTick,
      revokedAtTick: null,
    };
    this.grantBook.add(grant);
    ctx.emit({
      tick: ctx.tick,
      kind: 'grant.issued',
      rulesVersion: RULES_VERSION,
      actorPrincipalId: grantor,
      onBehalfOfPrincipalId: null,
      grantId: id,
      eventFamilyId: `grant::${id}`,
      parentEventId: null,
      isPublic: true,
      publicAt: ctx.tick,
      declassifyAt: ctx.tick,
      provenanceClass: 'FACT',
      actedOnStateVersion: ctx.frozenStateVersion,
      decisionSource: req.decisionSource,
      payload: {
        grant: id,
        grantor,
        delegate,
        template,
        maxDirectLoss: maxDirect,
        maxContingentLiability: maxContingent,
        expiresTick,
      },
      visibility: 'PUBLIC',
      audience: [],
    });
    return { ok: true, value: null };
  }

  /**
   * `revoke` — end a grant you issued (SPEC §8.1 #6). Always accepted, takes effect the
   * NEXT tick (a role committed under it before then is not unwound), and the attempted
   * revocation is itself what posts publicly — better drama than a silent kill or an
   * un-revokable vow.
   */
  private vRevoke(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const grantId = readString(req.params, ['grant', 'grant_id', 'grantId']) as GrantId | null;
    if (grantId === null) return reject('A2', 'revoke needs {"grant":"<id>"}.');
    const grant = this.grantBook.get(grantId);
    if (grant === undefined) return reject('PROP-V6', `there is no grant ${grantId}.`);
    if (grant.grantor !== req.principal) {
      return reject(
        'INV-23',
        `only ${grant.grantor} may revoke ${grantId}: a delegate cannot revoke the authority handed to it.`,
      );
    }
    const alreadyRevoked = grant.revokedAtTick !== null;
    this.grantBook.revoke(grantId, ctx.tick);
    // Idempotent: a second revoke is accepted (§8.1 #6) but does not re-post — the record
    // already carries the revocation, and a second identical row would be noise.
    if (alreadyRevoked) return { ok: true, value: null };
    ctx.emit({
      tick: ctx.tick,
      kind: 'grant.revoked',
      rulesVersion: RULES_VERSION,
      actorPrincipalId: req.principal,
      onBehalfOfPrincipalId: null,
      grantId,
      eventFamilyId: `grant::${grantId}`,
      parentEventId: null,
      isPublic: true,
      publicAt: ctx.tick,
      declassifyAt: ctx.tick,
      provenanceClass: 'FACT',
      actedOnStateVersion: ctx.frozenStateVersion,
      decisionSource: req.decisionSource,
      payload: { grant: grantId, delegate: grant.delegate, effectiveTick: ctx.tick + 1 },
      visibility: 'PUBLIC',
      audience: [],
    });
    return { ok: true, value: null };
  }

  /**
   * §5.1's freeze, as it applies to a *decision* rather than a commitment.
   *
   * > **Settlement.** Deterministic and ordered. **There is no decision to make inside
   * > this window.** — §5.1
   *
   * This is deliberately not {@link committing}: that sentence ends "submit again next
   * tick", which is true of a `create` and false of an election, because the tick after
   * the freeze is the settlement tick and by then the obligation has resolved. The
   * honest sentence is that the last statement stands — which is also the sentence that
   * explains why being offline through a Reckoning cannot be used against you.
   */
  private electingFrozen(ctx: PhaseContext): Rejection | null {
    if (!ctx.clock.inFreeze && !ctx.clock.isSettlementTick) return null;
    return reject(
      'INV-18',
      `the freeze for Reckoning ${String(ctx.clock.reckoning)} has landed at tick ${String(ctx.tick)}, so ` +
        'the elections are closed: whatever you last stated is what happens tonight, and nothing you send ' +
        'now can change it. That is not a penalty — §5.1 puts no decision inside the settlement window, ' +
        'which is exactly why being offline through one cannot be used against you. Ventures that settle ' +
        'after tonight are electable again from the next tick.',
    );
  }

  /**
   * What the payer has stated for one role, or `undefined` for silence.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THE READBACK'S SOURCE, AND IT MAY NEVER OVERSTATE A PAYMENT.** `agent.md` tells the
   * payer that a decline is permanent and public, and the `elect` affordance ends with
   * "You have currently stated: …" — so this answer is the one an agent decides whether
   * to go dark on. It therefore reports the book **floored by anything the payer has said
   * that has not resolved yet** ({@link WindowedEngine}):
   *
   *   | book | in flight | answer | why |
   *   |---|---|---|---|
   *   | `IN_FULL` | 2340 | 2340 | the restatement is what settles; the old one is gone |
   *   | 5000 | 2340 | 2340 | the lower of two statements is the one that can default |
   *   | 2340 | `IN_FULL` | 2340 | conservative: the raise may still be refused for budget |
   *   | absent | 2340 | absent | silence is already a full decline — the worst reading |
   *
   * It never reads the queue and never learns *when* a statement was made, so it cannot
   * become a channel for one action to react to another (§15.2). The settlement reads the
   * book alone — see {@link plansFor} — because an obligation must resolve against what
   * the world has actually applied and nothing else.
   * ══════════════════════════════════════════════════════════════════════════
   */
  electionOn(venture: VentureId, roleIndex: number): Election | undefined {
    const key = electionKey(venture, roleIndex);
    const book = this.elections.get(key);
    const inFlight = this.electionsInFlight.get(key);
    if (inFlight === undefined) return book;
    if (book === undefined) return undefined;
    if (book === IN_FULL) return inFlight;
    return minor(Math.min(book, inFlight));
  }

  /**
   * The most one role's elective part can ever come to — **exact, not a forecast.**
   *
   * ══════════════════════════════════════════════════════════════════════════
   * ONE HOME, TWO READERS: the `elect` affordance's `max_direct_loss`, and the cast's
   * own decision about what it can afford. `agent.md` §12 tells players
   * `max_direct_loss` "is exact, not an estimate", so this cannot be the pinned
   * `role.terms.elective`: on a **share** role the due is `claim - escrowedDue` where the
   * claim is a fraction of proceeds, so a venture that over-performs owes *more* than the
   * pinned figure — §7.1's trap, in the one field the document says to trust.
   *
   * Exact rather than probabilistic all the same, because the residual is a seeded draw
   * inside a band the kind publishes: `residualAtPercentile('p90')` is the band's top
   * end, not a quantile, and proceeds are monotonic in the residual. Quoted at a full
   * fill because a venture reaches `LIVE` only fully filled and only a `LIVE` venture
   * settles, so the full-fill figure is the one that will be paid.
   * ══════════════════════════════════════════════════════════════════════════
   */
  electiveCeilingOf(venture: VentureRecord, roleIndex: number): Minor {
    const role = venture.roles.find((r) => r.index === roleIndex);
    if (role === undefined) return minor(0);
    const ceiling = slotClaimAt(venture, roleIndex, 'p90').electiveDue;
    return minor(Math.max(0, ceiling - role.settledElectiveMinor));
  }

  private vWithdraw(_ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const ventureId = readString(req.params, ['venture', 'venture_id']) as VentureId | null;
    if (ventureId === null) return reject('A2', 'withdraw needs {"venture": "<id>"}.');
    const venture = this.ventures.get(ventureId);
    if (venture === undefined) return reject('PROP-V6', `there is no venture ${ventureId}.`);
    if (venture.state !== 'FORMING') {
      return reject(
        'PROP-V6',
        `${ventureId} is ${venture.state}. You may withdraw from a venture while it is FORMING; once it is ` +
          'LIVE the way out is to decline the elective part at settlement, and that is a default on the record.',
      );
    }
    const role = roleOfPrincipal(venture, req.principal);
    if (role === null) return reject('PROP-V6', `you hold no role in ${ventureId}.`);
    const freed = vacateRole(venture, role.index);
    if (freed !== null) {
      this.ventures.indexRelease(freed);
      const hand = this.world.hands.get(freed);
      if (hand !== undefined && hand.state === 'COMMITTED') hand.state = 'IDLE';
    }
    return { ok: true, value: null };
  }

  private vAbandon(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const ventureId = readString(req.params, ['venture', 'venture_id']) as VentureId | null;
    if (ventureId === null) return reject('A2', 'abandon needs {"venture": "<id>"}.');
    const venture = this.ventures.get(ventureId);
    if (venture === undefined) return reject('PROP-V6', `there is no venture ${ventureId}.`);
    if (venture.creator !== req.principal) {
      return reject('PROP-V6', `only ${venture.creator} can abandon ${ventureId}.`);
    }
    if (venture.state !== 'FORMING') {
      return reject('PROP-V6', `${ventureId} is ${venture.state}; only a FORMING venture can be abandoned.`);
    }
    for (const hand of this.ventures.resolve(ventureId, 'ABANDONED', ctx.tick)) {
      const record = this.world.hands.get(hand);
      if (record !== undefined && record.state === 'COMMITTED') record.state = 'IDLE';
    }
    // The escrow returns to the funder. Checked, wrapped, and never a halt.
    this.refundEscrow(ctx.tick, venture);
    return { ok: true, value: null };
  }

  private vPublishOffer(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const text = readString(req.params, ['text', 'offer', 'reason']);
    if (text === null || text.length > MAX_REASON_LENGTH) {
      return reject(
        'INV-26',
        `publish_offer needs {"text": "..."} of at most ${String(MAX_REASON_LENGTH)} characters — a price ` +
          'list, not an essay: HANDS FOR HIRE — 8% OF CARGO, NO DEEP RUNS.',
      );
    }
    this.offers.push({ by: req.principal, text, tick: ctx.tick });
    return { ok: true, value: null };
  }

  private vMessage(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const ventureId = readString(req.params, ['venture', 'venture_id']) as VentureId | null;
    const act = readEnum(req.params, ['act', 'type'], [
      'offer',
      'counter',
      'accept',
      'decline',
      'assure',
    ] as const);
    const text = readString(req.params, ['text', 'body']) ?? '';
    if (ventureId === null || act === null) {
      return reject(
        'A2',
        'message needs {"venture": "<id>", "act": "offer|counter|accept|decline|assure", "text": "..."}.',
      );
    }
    if (text.length > MAX_MESSAGE_LENGTH) {
      return reject('INV-26', `a message carries at most ${String(MAX_MESSAGE_LENGTH)} characters of text.`);
    }
    const venture = this.ventures.get(ventureId);
    if (venture === undefined) return reject('PROP-V6', `there is no venture ${ventureId}.`);
    // ── A PARTIES CHANNEL WITH NO PARTY CHECK IS NOT A PARTIES CHANNEL ────────
    //
    // This validated only that the venture existed. So any principal could push text into
    // a live venture's private channel — which is `PARTIES` while the deal runs and
    // **declassifies publicly at settlement** (§11.2), where it becomes the receipt reel's
    // raw material (§14). An outsider could therefore write words that end up published
    // beside somebody else's kept or broken promise, and never see a reply. A probe did
    // exactly that. `talksFor` was already gated correctly, which is what made the leak
    // one-directional and invisible from inside the game.
    if (!this.mayTalkIn(venture, req.principal)) {
      return reject(
        'PROP-VI1',
        `${venture.id} is ${venture.state} and every role is taken, so its channel is now the parties' and ` +
          'yours is not among them: what is said in it becomes public beside what they actually did, and a ' +
          'stranger cannot be one of the voices in that. While a venture still has an open role anyone may ' +
          'pitch for it here and read the replies — so bid on a venture in ventures.board[], or say it in ' +
          'public with `claim` or `publish_offer`.',
      );
    }
    this.talk.push({ venture: ventureId, from: req.principal, act, text, tick: ctx.tick });
    return { ok: true, value: null };
  }

  /**
   * Who may write into a venture's channel: the parties, plus anyone at all while it is
   * still recruiting.
   *
   * ONE HOME, TWO READERS — this and {@link talksFor}. A write gate wider than the read
   * gate is the leak this closed; a read gate wider than the write gate would be a
   * different one, and two copies of the predicate is how a build gets both.
   */
  private mayTalkIn(venture: VentureRecord, principal: PrincipalId): boolean {
    if (venture.creator === principal) return true;
    if (venture.roles.some((r) => r.filledByPrincipal === principal)) return true;
    return isRecruiting(venture);
  }

  private vSay(ctx: PhaseContext, req: ActionRequest, denial: boolean): WorldResult<null> {
    const text = readString(req.params, ['text', 'reason', 'claim']);
    if (text === null || text.length > MAX_REASON_LENGTH) {
      return reject(
        'INV-26',
        `${denial ? 'deny' : 'claim'} carries at most ${String(MAX_REASON_LENGTH)} characters. It is public ` +
          'and permanent, and it is how anyone watching knows who you are.',
      );
    }
    this.claims.push({ by: req.principal, text, denial, tick: ctx.tick });
    return { ok: true, value: null };
  }

  private vSeal(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const verb = readString(req.params, ['verb', 'intent_verb']);
    const target = readString(req.params, ['target']);
    const measure = readEnum(req.params, ['measure'], ['MINOR', 'QTY', 'BPS'] as const);
    const low = readInt(req.params, ['outcome_low', 'outcomeLow']);
    const high = readInt(req.params, ['outcome_high', 'outcomeHigh']);
    if (verb === null || target === null || measure === null || low === null || high === null) {
      return reject(
        'PROP-D1',
        'seal needs a structured intention: {"verb": "...", "target": "...", "measure": "MINOR|QTY|BPS", ' +
          '"outcome_low": N, "outcome_high": N}. Prose never feeds the verdict.',
      );
    }
    const held = this.rolesHeldBy(req.principal);

    // ── The role this seal claims a free slot against ─────────────────────────
    //
    // Resolved from what the agent NAMED, never "the first role it happens to
    // hold". The first draft did the latter and it was a live defect the cast
    // found within 120 ticks: a principal holding two roles sealed its second, the
    // handler charged the slot of its *first*, the slot was already spent, so the
    // seal fell through to the paid path and was accepted — and the agent, whose
    // own free-slot arithmetic said a slot was available, tried again every tick
    // until it hit INV-26's cap. 311 refusals from a correct agent, caused
    // entirely by the engine and the affordance disagreeing about which role a
    // seal was for. One name, two meanings: scar #1's exact shape.
    const explicit = readString(req.params, ['role_venture', 'roleVenture']);
    const named = explicit ?? target;
    const namedIndex = readInt(req.params, ['role', 'role_index', 'roleIndex']);
    const matching =
      held.find((r) => r.venture === named && (namedIndex === null || r.roleIndex === namedIndex)) ?? null;

    // ── AND IT IS NEVER SOME OTHER ROLE ───────────────────────────────────────
    //
    // The fallback here was "the first held role that still has its free slot", which is
    // the same one-name-two-meanings defect the block above describes, arriving from the
    // other side: an agent that named a role it does **not** hold had its seal quietly
    // charged against a role it does. Measured: a probe finished with four seals attached
    // to roles it never named, none of them readable back (a verdict is `HONOURED |
    // CONTRADICTED` and nothing else, at any tier — PROP-D2), any of which could be
    // judged against its deeds. Its own words: "I would not have sealed at all had I
    // known." A mark is permanent and public, so an intention the agent did not state is
    // the one thing this door must not invent (A5′, scar #8: prefer precision over
    // recall).
    //
    // So a *named* role that is not held is refused outright, and an unnamed one resolves
    // to `null` — a seal that costs an action and claims no slot — rather than to
    // somebody else's slot. `SealBook.commit` already refuses `role` not in `rolesHeld`;
    // it never saw one, because this line substituted first.
    if (matching === null && (explicit !== null || namedIndex !== null)) {
      return reject(
        'PROP-D4',
        `you hold no role ${namedIndex === null ? '' : `${String(namedIndex)} `}in ${named}, so it gives you no ` +
          'free seal and this seal has not been made. It is deliberately not charged against a different role ' +
          'of yours: a seal is judged once, permanently and publicly, and the engine will not pick which ' +
          'promise you meant. ' +
          (held.length === 0
            ? 'You hold no roles at all right now — fill one first, or seal without naming a role and spend an action.'
            : `The roles you hold are ${held
                .map((r) => `${r.venture} role ${String(r.roleIndex)}`)
                .join(', ')}.`),
      );
    }

    const committed = this.seals.commit({
      principal: req.principal,
      tick: ctx.tick,
      actedOnStateVersion: ctx.frozenStateVersion,
      stateVersion: ctx.frozenStateVersion,
      intent: { verb, target, measure, outcomeLow: low, outcomeHigh: high },
      prose: readString(req.params, ['prose']) ?? '',
      role: matching,
      rolesHeld: held,
    });
    return committed.ok ? { ok: true, value: null } : committed;
  }

  /**
   * The roles this principal fills right now, read from the venture rows.
   *
   * Never cached and never mirrored: `venture_role.filled_by_hand_id` is the single
   * home of commitment (§6.2, INV-9), and a copy here would be scar #5 on the field
   * that decides what a seal costs.
   */
  private rolesHeldBy(principal: PrincipalId): SealRoleRef[] {
    const held: SealRoleRef[] = [];
    for (const venture of this.ventures.forPrincipal(principal)) {
      const role = roleOfPrincipal(venture, principal);
      if (role !== null) held.push({ venture: venture.id, roleIndex: role.index });
    }
    return held;
  }

  // ── VENTURES phase ────────────────────────────────────────────────────────

  /**
   * The VENTURES phase: resolve this tick's fills, activate what is ready, deliver
   * what is due, and retire what never filled.
   *
   * Ordering matters and is not arrival: `allocateFills` sorts its own input and is
   * pure with respect to the order the requests were handed over (PROP-V8), so two
   * agents racing for one slot get the same answer whichever packet landed first.
   *
   * **Activation before delivery, in one pass over the book.** A venture whose window
   * closes on its own delivery tick activates and delivers in the same phase, in that
   * order, which is the only way it can ever deliver at all. One pass rather than three
   * because each charges the step budget per venture and three passes would triple the
   * cost of the phase that scales with the book (DET-9).
   */
  private resolveFills(ctx: PhaseContext): void {
    if (this.pendingFills.length > 0) {
      ctx.step(this.pendingFills.length);
      const allocated = allocateFills(this.ventures, this.pendingFills, {
        tick: ctx.tick,
        handOf: (id) => this.world.hands.get(id),
      });
      // ── EVERY REFUSAL REACHES ITS AGENT, AND THE RETURN VALUE IS WHY ─────────
      //
      // This call's `{granted, refused}` was **discarded**, and each refusal it drops
      // carries an invariant and a written sentence. So a fill that lost a contest, named
      // a committed hand, or asked for a role that does not exist came back from
      // `POST /act` as `accepted` and then did nothing at all — `accepted` meaning
      // *queued*, with no later word either way. Measured on the live world: 20+ silent
      // no-ops across three probes, two of which filed bug reports they then had to
      // retract, and one of which wrote that "an accepted no-op is strictly worse than a
      // refusal". `agent.md` §7 promises the opposite in as many words: an illegal action
      // returns the invariant you violated and the nearest legal thing instead.
      //
      // It arrives through the corrections channel rather than as a return value for the
      // reason that channel exists (see {@link PendingCorrection}): a contest is only
      // decided once the whole tick's set is in, so at `POST /act` time there is nothing
      // yet to say. It is a **hint and never an event** (scar #10).
      for (const refused of allocated.refused) {
        this.holdCorrection(refused.request.principal, {
          tick: ctx.tick,
          verb: 'fill_role',
          clientSequence: refused.request.clientSequence,
          invariant: refused.invariant,
          hint: `${refused.hint} ${FILL_REFUSAL_NOTE[refused.reason]}`,
          params: {
            venture: refused.request.venture,
            role: refused.request.roleIndex,
            hand: refused.request.hand,
            stake: refused.request.stake,
          },
        });
      }
      this.pendingFills = [];
    }
    // Nothing in the freeze may touch a figure the settlement was computed from: a
    // delivery credits an escrow and a retirement refunds one (§5.1, INV-18).
    const frozen = ctx.clock.inFreeze || ctx.clock.isSettlementTick;
    for (const venture of this.ventures.live()) {
      ctx.step();
      if (venture.state === 'FORMING' && openIndices(venture).length === 0) {
        const live = activate(venture, ctx.frozenStateVersion, ctx.tick);
        if (live.ok) {
          // The obligation opens when the venture binds, and closes at settlement.
          // Without it INV-4 has no live obligation to point a lock at, and
          // `reconcileFaults` cannot tell a settled obligation from a carried one.
          this.obligations.open(venture.id, false);
          for (const party of venture.roles) {
            if (party.filledByPrincipal !== null) {
              ctx.offerWake(party.filledByPrincipal, 'VENTURE', venture.id);
            }
          }
        }
      }
      if (frozen) continue;
      if (venture.state === 'LIVE' && this.deliveryTickOf(venture) === ctx.tick) {
        this.deliver(ctx, venture);
      } else if (venture.state === 'FORMING' && ctx.tick > venture.windowClosesTick) {
        this.retireFormation(ctx, venture);
      }
    }
  }

  /**
   * The tick a venture's output has to be delivered by.
   *
   * `resolvesAtTick - DELIVERY_LEAD_TICKS`, which is one clear tick before the freeze
   * begins. See {@link DELIVERY_LEAD_TICKS} for why both terms of that are load-bearing.
   */
  deliveryTickOf(venture: Pick<VentureRecord, 'resolvesAtTick'>): number {
    return venture.resolvesAtTick - DELIVERY_LEAD_TICKS;
  }

  /** What this venture delivered, or null. The deed set's only source. */
  deliveryOf(venture: VentureId): DeliveryRecord | null {
    return this.deliveries.get(venture) ?? null;
  }

  /**
   * The venture realises its output: value into the escrow, a row in the record, and a
   * deed for every role holder.
   *
   * The proceeds are `computeProceeds` over the filled roles with a residual drawn from
   * the venture's own sub-stream, so two ventures delivering in one tick draw
   * independently and adding a consumer anywhere else in the tick shifts neither
   * (§7.4, DET-2). They are **pinned here**: the settlement divides this number, and a
   * deferral's second pass divides the same one again (§15.3).
   *
   * The money is **issued from the civic-procurement faucet** rather than moved out of
   * anybody's stores, because §10.1's demand side is what a venture sells its output
   * *to*. Two faucets exist and this is the one for delivered goods; a third would be a
   * constitutional change.
   */
  private deliver(ctx: PhaseContext, venture: VentureRecord): void {
    const filled = filledIndices(venture);
    const proceeds = computeProceeds({
      kind: venture.kind,
      filled,
      stageBps: NEUTRAL_STAGE_BPS,
      residualSignedBps: drawResidual(venture.kind, venture.id, ctx.rng),
    }).proceeds;
    const holders = venture.roles
      .map((r) => r.filledByPrincipal)
      .filter((p): p is PrincipalId => p !== null);

    // Appended immediately rather than buffered, because the deed that will be judged
    // against a seal has to cite a row an auditor can open, and a buffered draft has no
    // id until COMMIT. It is the same trade the settlement's own receipts make.
    const appended = this.appendPublic({
      tick: ctx.tick,
      kind: DELIVERY_EVENT_KIND,
      actor: venture.creator,
      family: `venture::${venture.id}`,
      payload: {
        venture: venture.id,
        kind: venture.kind,
        stage: venture.stage,
        proceedsMinor: proceeds,
        filled: [...filled],
      },
      actedOnStateVersion: ctx.frozenStateVersion,
    });
    if (appended === null) return;

    if (proceeds > 0) {
      try {
        this.ledger.issueCurrency({
          eventId: appended,
          tick: ctx.tick,
          faucet: CURRENCY_FAUCET.CIVIC_PROCUREMENT,
          to: escrowAccount(venture.id, venture.creator),
          amount: proceeds,
        });
      } catch (error: unknown) {
        // The row is already in the record, so the honest thing is to record the
        // delivery at what actually landed — zero — rather than pin proceeds the
        // settlement would then halt trying to pay.
        this.faults.push(
          `${venture.id} could not be credited its ${String(proceeds)} of proceeds ` +
            `(${describeError(error)}); it settles against what the escrow actually holds`,
        );
        this.deliveries.set(venture.id, {
          venture: venture.id,
          tick: ctx.tick,
          proceeds: minor(0),
          stateVersion: ctx.frozenStateVersion,
          eventId: appended,
          holders,
        });
        return;
      }
    }
    this.deliveries.set(venture.id, {
      venture: venture.id,
      tick: ctx.tick,
      proceeds,
      stateVersion: ctx.frozenStateVersion,
      eventId: appended,
      holders,
    });
  }

  /**
   * A venture whose window closed unfilled is retired and its escrow returned.
   *
   * Not a settlement and not a default: nothing was ever binding, because a venture goes
   * live "filled or not at all" (PROP-V6). Left alone it would hold its creator's escrow
   * for the rest of the season — capital locked against a promise that can no longer be
   * made — and hold a filled role's hand with it, which is INV-9's halt one tick later.
   */
  private retireFormation(ctx: PhaseContext, venture: VentureRecord): void {
    for (const hand of this.ventures.resolve(venture.id, 'ABANDONED', ctx.tick)) {
      const record = this.world.hands.get(hand);
      if (record !== undefined) releaseHand(record);
    }
    this.obligations.close(venture.id);
    this.refundEscrow(ctx.tick, venture);
    this.releaseElections(venture.id);
  }

  // ── The Reckoning ─────────────────────────────────────────────────────────

  /**
   * What OBLIGE cascades over: this Reckoning's settlement set, in `venture_id` order.
   *
   * `due` is read once, before the tick's phases run, and it is what sizes the step
   * budget — `STEP_BUDGET.perObligation` exists because the settlement set scales with
   * ventures rather than with hands, and a Reckoning whose obligations all legitimately
   * need every cascade round must still fit.
   */
  private obligationSource(): ObligationSource {
    return {
      due: (ctx) => this.settlementDue(ctx.tick),
      attempt: (ctx, id, round) => this.attemptObligation(ctx, id, round),
    };
  }

  /**
   * INV-4's input, widened to know what a market order is.
   *
   * A market lock's `obligationRef` is an order id, so INV-4 — "every encumbrance
   * references a live obligation" — has to be able to ask the book. Deriving the
   * answer from the book rather than registering orders in `SimpleObligationBook` is
   * deliberate: that book is **not** a state table, so an aborted tick would leave a
   * registration behind for an order that no longer exists, and the leak would grow
   * for the life of the world. The book *is* a state table, so asking it is
   * rollback-correct for free — one home for "is this order live".
   *
   * `securedObligations()` is passed through untouched. Orders are deliberately not
   * added to it: an ask escrows goods rather than currency, so "this obligation must
   * be backed by an open encumbrance" would be false for half the book. The
   * equivalent guarantee for bids is MKT-3, which checks exactly that and only for
   * the side it is true of.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **AND IT IS USED IN BOTH PLACES INV-4 RUNS, WHICH IS WHY `close` IS HERE.**
   *
   * The tick loop is not the only caller of `checkInvariants`. `reckoning/driver.ts`
   * runs its own ASSERT stage inside the settlement transaction, out of
   * `reckoningWorld()`, and that one was handed the raw `SimpleObligationBook` — a
   * book that has never heard of an order. So every open BID's cash lock read as
   * "an encumbrance for a dead obligation", INV-4 fired once per resting bid, and
   * the Reckoning halted.
   *
   * Measured before this was fixed: four principals resting ordinary buy orders
   * across one Reckoning produced 90 INV-4 violations and PAUSED THE WORLD at tick
   * 287. Nobody did anything wrong — leaving a bid on the book overnight is the most
   * ordinary market act there is — so the halt was agent-reachable (AGT-X9), on the
   * one night that has an audience (A14), and §15.4 puts a false halt in the same
   * class as a false default. One widened book, both callers, one answer.
   * ══════════════════════════════════════════════════════════════════════════
   */
  private liveObligations(): ReckoningObligations {
    return {
      // A joiner's locked stake names its raid as the obligation it secures, so INV-4
      // would read it as an orphan lock and halt the tick if the raid book were not
      // consulted here. Same extension the market needed, for the same reason.
      isLive: (ref) =>
        this.obligations.isLive(ref) ||
        this.marketBook.isLive(String(ref)) ||
        this.raids.isLive(String(ref)),
      securedObligations: () => this.obligations.securedObligations(),
      close: (ref) => {
        this.obligations.close(ref);
      },
    };
  }

  // ── the market (SPEC §12.2 `trade`) ───────────────────────────────────────

  /** The order books. Read-only to everything outside this file. */
  get market(): MarketBook {
    return this.marketBook;
  }

  /** What the last clearing pass did, or `null` before the first one. */
  get lastMarketClear(): ClearReport | null {
    return this.lastClear;
  }

  /**
   * The `MARKETS` phase: clear every book once, then publish what happened.
   *
   * Events are emitted here rather than inside `clear.ts` so that the market module
   * never learns what a `NewEvent` is — the same separation that lets the tick loop
   * stay content-free. Two kinds, at two tiers, and the split is §11.2's:
   *
   *   - `market.filled` is **PUBLIC**. A completed trade is durable economic history
   *     (economy law 10), it is the print `ledger/valuation.ts` marks goods from, and
   *     a price moving because a lane closed is the most legible thing this design
   *     has (A13).
   *   - `market.order_closed` is **PRIVATE** to its owner. Who owns which order is
   *     never published: a resting ask is a hold value, and §11.2 keeps hold values
   *     off any surface an ambusher can read without scouting.
   */
  private clearMarketsNow(ctx: PhaseContext): void {
    const report = clearMarkets({
      book: this.marketBook,
      ledger: this.ledger,
      tick: ctx.tick,
      isSettlementTick: ctx.clock.isSettlementTick,
      step: (n) => {
        ctx.step(n);
      },
      fault: (message) => {
        this.faults.push(message);
      },
    });
    this.lastClear = report;
    if (report.skipped) return;

    for (const fill of report.fills) {
      ctx.emit({
        tick: ctx.tick,
        kind: 'market.filled',
        rulesVersion: RULES_VERSION,
        actorPrincipalId: null,
        onBehalfOfPrincipalId: null,
        grantId: null,
        eventFamilyId: `market::${fill.venue}::${fill.good}`,
        parentEventId: null,
        isPublic: true,
        publicAt: ctx.tick,
        declassifyAt: ctx.tick,
        provenanceClass: 'FACT',
        actedOnStateVersion: ctx.frozenStateVersion,
        decisionSource: null,
        payload: {
          venue: fill.venue,
          good: fill.good,
          unit_price: fill.unitPrice,
          qty: fill.qty,
          buyer: fill.buyer,
          seller: fill.seller,
        },
        visibility: 'PUBLIC',
        audience: [],
      });
      ctx.offerWake(fill.buyer, 'SETTLEMENT', fill.id);
      ctx.offerWake(fill.seller, 'SETTLEMENT', fill.id);
    }

    for (const closed of report.closed) {
      ctx.emit({
        tick: ctx.tick,
        kind: 'market.order_closed',
        rulesVersion: RULES_VERSION,
        actorPrincipalId: closed.principal,
        onBehalfOfPrincipalId: null,
        grantId: null,
        eventFamilyId: `market::${closed.principal}`,
        parentEventId: null,
        isPublic: false,
        publicAt: null,
        declassifyAt: null,
        provenanceClass: 'FACT',
        actedOnStateVersion: ctx.frozenStateVersion,
        decisionSource: null,
        payload: {
          order: closed.id,
          venue: closed.venue,
          good: closed.good,
          side: closed.side,
          limit_price: closed.limitPrice,
          quantity: closed.quantity,
          filled: closed.filled,
          state: closed.state,
        },
        visibility: 'PRIVATE',
        audience: [{ principal: closed.principal, basis: 'SELF' }],
      });
    }
  }

  /**
   * `trade` — place, modify or cancel one order.
   *
   * `modify` is **cancel-and-replace** and it loses its place in the queue (M4). It
   * is one action, not two, because charging twice for a reprice would make the
   * cheapest strategy "cancel and hope", but the seniority it forfeits is real: a
   * repriced order is a new order, so nobody can hold a queue position by editing it.
   */
  private vTrade(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const operation = (readString(req.params, ['operation', 'op']) ?? 'place').toLowerCase();
    if (!TRADE_OPERATIONS.includes(operation)) {
      return reject(
        'A2',
        `trade needs an operation: ${TRADE_OPERATIONS.join(' · ')}. Got "${operation}".`,
      );
    }
    const place: PlaceContext = {
      book: this.marketBook,
      ledger: this.ledger,
      world: this.world,
      principal: req.principal,
      tick: ctx.tick,
      clientSequence: this.sequenceOf(ctx, req),
    };

    if (operation === 'cancel' || operation === 'modify') {
      const id = readString(req.params, ['order', 'order_id', 'id']) as OrderId | null;
      if (id === null) {
        return reject('A2', `${operation} needs {"operation": "${operation}", "order": "<order id>"}.`);
      }
      const previous = this.marketBook.get(id);
      // Cancel-replace: anything the agent did not restate is inherited from the
      // order it replaced, so a price change does not silently reset the quantity.
      const replacement = tradeRequestOf(req.params, previous);
      if (operation === 'modify') {
        // **Checked BEFORE the cancel, and that is the whole point.** `modify` is
        // cancel-and-replace, so a replacement refused after the cancel would
        // destroy a live resting order and its queue position while returning
        // `{ok:false}` — and §12.2's contract is that a refused action changes
        // nothing. `{"operation":"modify","quantity":0}` reached exactly that:
        // the order vanished and the hint talked about the quantity.
        const blocked = checkReplacement(place, previous, replacement);
        if (blocked !== null) return blocked;
      }
      const cancelled = cancelOrder(place, id);
      if (!cancelled.ok) return cancelled;
      this.emitOrderPlaced(ctx, cancelled.value, 'CANCELLED', req.decisionSource);
      if (operation === 'cancel') return { ok: true, value: null };
      const placed = placeOrder(place, replacement);
      if (!placed.ok) return placed;
      this.emitOrderPlaced(ctx, placed.value, 'OPEN', req.decisionSource);
      return { ok: true, value: null };
    }

    const placed = placeOrder(place, tradeRequestOf(req.params, undefined));
    if (!placed.ok) return placed;
    this.emitOrderPlaced(ctx, placed.value, 'OPEN', req.decisionSource);
    return { ok: true, value: null };
  }

  /**
   * A principal's own receipt for its own order. **PRIVATE, audience of one.**
   *
   * §11.2's PRIVATE row is "the principal itself / never / never", which is exactly
   * the promise: the aggregate book is the public price signal, and who placed what
   * is not published now and does not declassify later. Publishing it would let a
   * raider read a manifest off the depth ladder without ever scouting, which deletes
   * the intel market and breaks A9.
   */
  private emitOrderPlaced(
    ctx: PhaseContext,
    order: Order,
    state: string,
    decisionSource: DecisionSource,
  ): void {
    ctx.emit({
      tick: ctx.tick,
      kind: state === 'OPEN' ? 'market.order_placed' : 'market.order_cancelled',
      rulesVersion: RULES_VERSION,
      actorPrincipalId: order.principal,
      onBehalfOfPrincipalId: null,
      grantId: null,
      eventFamilyId: `market::${order.principal}`,
      parentEventId: null,
      isPublic: false,
      publicAt: null,
      declassifyAt: null,
      provenanceClass: 'FACT',
      actedOnStateVersion: ctx.frozenStateVersion,
      decisionSource,
      payload: {
        order: order.id,
        venue: order.venue,
        good: order.good,
        side: order.side,
        limit_price: order.limitPrice,
        quantity: order.quantity,
        filled: order.filled,
        time_in_force: order.timeInForce,
        expires_tick: order.expiresTick,
        state,
      },
      visibility: 'PRIVATE',
      audience: [{ principal: order.principal, basis: 'SELF' }],
    });
  }

  /**
   * The `market` observation block, for one principal.
   *
   * Aggregate books for everywhere it has a hand, its own orders and its own recent
   * prints, the published fee schedule, and the world ticker. Nothing here can name
   * another principal's order — `booksFor` builds levels from quantities and counts,
   * and `mine` is filtered to the reader before it leaves the market module.
   */
  marketView(principal: PrincipalId, tick: number): Readonly<Record<string, unknown>> {
    const venues = new Set<SystemId>(
      handsOf(this.world, principal)
        .filter((hand) => isPresent(hand, tick))
        .map((hand) => hand.location),
    );
    const books = booksFor(this.marketBook, principal, venues, tick);
    return {
      at: [...venues].sort(compareIds),
      // Each book carries the **reference mark** beside its executable prices, and
      // they are deliberately two different numbers (M3: "separate execution and
      // valuation marks"). `best_ask` is what you can buy at right now; the mark is
      // what the good is worth for a BOND, and it is `ledger/valuation.ts`'s windowed,
      // related-party-filtered, haircut-aware median — never last-trade, which is
      // launderable. Reused rather than reimplemented: two answers to "what is this
      // worth" is the disagreement a thin book turns into custody of other people's
      // assets (§10.3).
      books: books.map((book) => ({ ...book, reference_mark: markOf(this.referenceMark(book.good, tick)) })),
      mine: ownOrdersFor(this.marketBook, principal),
      recent: ownPrintsFor(this.marketBook, principal, MAX_MARKET_ROWS),
      ticker: recentPrints(this.marketBook, MAX_MARKET_ROWS),
      fees: MARKET_FEES,
    };
  }

  /**
   * What a good is worth **as a bond**, as of a tick.
   *
   * One line, and it is the whole point: `valueGood` already implements the
   * manipulation-resistant rule — a multi-tick window, a volume-weighted median
   * rather than a mean, self-matches and related-party edges excluded, and a floor of
   * independent volume below which the good is simply `UNPRICED` and worth nothing.
   * The market's job is to supply the prints; it must never form a second opinion.
   */
  referenceMark(good: GoodId, tick: number): Valuation {
    return valueGood(good, tick, this.marketBook.prints(), DEFAULT_VALUATION_RULE);
  }

  /** One book, for a viewer frame or a test. Aggregate only; no reader, no `mine`. */
  publicBookAt(venue: VenueId, good: GoodId, tick: number): ReturnType<typeof publicBook> {
    return publicBook(this.marketBook, venue, good, null, tick);
  }

  /** The frozen set's members, or nothing. Canonical order comes from the freeze. */
  private settlementDue(tick: number): readonly string[] {
    if (!isSettlementTick(tick)) return [];
    const frozen = this.frozen;
    if (frozen === null || frozen.settlementTick !== tick) return [];
    return frozen.obligations.map((o) => o.venture);
  }

  /**
   * One obligation's attempt, reported out of the batch that settled it.
   *
   * The Reckoning is **one transaction** (§15.3), so it cannot be performed one
   * obligation at a time — the escrowed halves of every venture execute before any
   * elective half does, which is what seniority means. So the first attempt runs the
   * whole batch and every attempt reads its own obligation's outcome out of it. The
   * cascade's rounds then do the one thing they are for: an obligation the batch
   * deferred comes back `done: false` and is retried, and at the round limit it is
   * reported as **deferred and never as a breach** — `CascadeStatus` has no third
   * member, so no wiring of this function can fabricate one.
   */
  private attemptObligation(ctx: PhaseContext, id: string, round: number): CascadeAttempt {
    const outcome = this.settleNow(ctx);
    if (outcome === null) {
      return { done: false, waitingOn: `no Reckoning ran at tick ${String(ctx.tick)}` };
    }
    const settlement = outcome.settlements.find((s) => s.venture === id);
    if (settlement === undefined) {
      return { done: false, waitingOn: `${id} produced no settlement in Reckoning ${String(outcome.reckoning)}` };
    }
    if (settlement.terminalState === 'DEFERRED') {
      return { done: false, waitingOn: `${id} deferred to the next Reckoning (round ${String(round)})` };
    }
    return { done: true, breached: settlement.defaults.length > 0, note: settlement.line };
  }

  /**
   * The freeze: compute the settlement set and hash its inputs (§5.1, §15.3).
   *
   * Runs at the freeze tick, in OBLIGE, which is after every phase that could move a
   * figure the settlement will pay from. The result is kept **immutably** — it carries
   * the inputs hash and the `acted_on_state_version` capture INV-19 compares against —
   * until the settlement tick consumes it.
   */
  private freezeNow(ctx: PhaseContext): void {
    if (!inFreeze(ctx.tick)) return;
    if (this.frozen !== null && this.frozen.frozenAtTick === ctx.tick) return;
    const plans = this.plansFor(ctx.tick + FREEZE_TICKS);
    ctx.step(plans.length);
    this.frozen = freezeReckoning({
      tick: ctx.tick,
      stateVersion: this.engine.stateVersion,
      ledger: this.ledger,
      book: this.ventures,
      accounts: this.accounts,
      plans,
    });
  }

  /**
   * One resolution plan per due obligation, computed **before** the freeze hashes it.
   *
   * The outcome, the pinned proceeds and the payer's elections are decisions, not
   * readings: the freeze captures them and nothing may move them afterwards. Every
   * figure here comes from a fact already in the world — the delivery that happened, the
   * election the payer stated — and none of it is inferred.
   */
  private plansFor(settlementTick: number): readonly ObligationPlan[] {
    const out: ObligationPlan[] = [];
    for (const venture of this.ventures.settlementSet(settlementTick)) {
      const delivered = this.deliveries.get(venture.id);
      if (delivered === undefined) {
        // Unreachable through `create`, which guarantees a delivery tick outside the
        // freeze for every venture it mints. Reported rather than halted: settling
        // against zero pays nobody and accuses nobody, while a halt here would stop the
        // world over a venture that produced nothing.
        this.faults.push(
          `${venture.id} is due at tick ${String(settlementTick)} and has no delivery on record; it settles ` +
            'against zero proceeds',
        );
      }
      const elections = new Map<number, Election>();
      for (const role of venture.roles) {
        const election = this.elections.get(electionKey(venture.id, role.index));
        if (election !== undefined) elections.set(role.index, election);
      }
      out.push({
        venture: venture.id,
        // `FULFILLED` asserts every role was filled, and `guardSettleable` refuses it
        // otherwise — so the distinction is made here rather than discovered there.
        // Neither outcome is a loss, so neither needs an event that destroyed value.
        outcome: isFullyFilled(venture) ? 'FULFILLED' : 'PARTIAL_FILL',
        proceeds: delivered?.proceeds ?? minor(0),
        elections,
        causeEventId: null,
      });
    }
    return out;
  }

  /**
   * Settle the frozen Reckoning. **Once per tick**, whatever calls it.
   *
   * The two calls — the cascade's first attempt and the OBLIGE handler — are both
   * inside OBLIGE, and the guard is a tick stamp rather than a boolean so a re-run of
   * the same tick under a signed resume settles again while a second call inside one
   * tick cannot. Set *before* the batch runs: a throw must not leave the door open for
   * a second settlement of the same Reckoning, which would pay every elective part
   * twice.
   */
  private settleNow(ctx: PhaseContext): ReckoningOutcome | null {
    if (!isSettlementTick(ctx.tick)) return null;
    if (this.settledAtTick === ctx.tick) return this.outcome;
    this.settledAtTick = ctx.tick;
    this.outcome = null;

    const frozen = this.frozen;
    if (frozen === null || frozen.settlementTick !== ctx.tick) {
      // A world that started inside a Reckoning has no freeze for it. Nothing was
      // promised for tonight, so nothing settles; reported because a Reckoning that
      // silently does not happen is a promise the world dropped.
      this.faults.push(
        `tick ${String(ctx.tick)} is a settlement tick with no frozen settlement set; nothing settled and no ` +
          'seal was judged',
      );
      return null;
    }
    this.frozen = null;

    const outcome = runReckoningBatch({
      world: this.reckoningWorld(),
      frozen,
      rulesVersion: RULES_VERSION,
      controller: this.reckoningController,
      // The same immutable triple the tick loop would halt with: `snapshot_T` is the
      // engine's own pre-tick capture, the action log is this tick's, and the seed is
      // the one revealed at FREEZE_QUEUE (§15.1).
      inputs: tickInputsFor(
        this.engine.snapshot(),
        this.engine.log.forTick(ctx.tick),
        ctx.tick,
        this.engine.seeds.reveal(ctx.tick),
      ),
      deeds: this.deedsFor(frozen.reckoning),
      deedTally: this.deedTallyFor(frozen.reckoning),
      // `stateHash` is deliberately not the engine's: DERIVE has not run, so the
      // tick-boundary hash does not exist yet, and handing over the *previous* tick's
      // would put a stale figure on the Reckoning's published pointer. The ledger's own
      // hash is the honest answer to "what does the money look like now", and it is the
      // documented default.
    });

    this.outcome = outcome;
    this.summaries.push(this.summarise(outcome));
    // Presence and the locks went back inside the batch — the driver derives
    // `SettlementPresence` from the hand rows itself, so a caller cannot forget it. What
    // is left here is this runtime's own bookkeeping: a finished obligation releases its
    // election, and a deferral keeps its own, because the same election settles the same
    // pot next Reckoning (§15.3).
    for (const settlement of outcome.settlements) {
      if (settlement.terminalState !== 'DEFERRED') this.releaseElections(settlement.venture);
    }
    this.pruneDeliveries(frozen.reckoning);
    return outcome;
  }

  // ── The Levy (SPEC §5.2) ──────────────────────────────────────────────────

  /**
   * What the allocation rule is allowed to know about a principal. **Facts only.**
   *
   * `freeStores` and `exposure` come from `principalPosition`, which is the same function
   * every affordance's `max_direct_loss` is computed from — so the number that decides an
   * assessment is the number an agent was shown, and there is no second EXPOSURE in the
   * engine for the Levy to disagree with (§3: EXPOSURE is Σ open `max_direct_loss`, and
   * nothing else).
   */
  levySubjectOf(principal: PrincipalId, tick = this.engine.tick): LevySubject {
    const position = principalPosition(this.ledger, principal, storesAccount(principal));
    return {
      principal,
      // ── NOT DERIVED FROM HAND PRESENCE, and the first version of this was ────
      //
      // `HandRecord.presentSinceTick` is the *arrival* clock and `resolveArrival`
      // rewrites it on every journey, so "earliest hand presence" reads as recent for
      // anybody who keeps its hands moving — a permanent newcomer floor bought with one
      // `move` a Reckoning. `Book.enrolled` records the seat tick once and never again;
      // its own comment carries the full argument.
      tenureTicks: this.levy.tenureTicksOf(principal, tick),
      freeStores: position.free,
      exposure: position.exposure,
    };
  }

  /**
   * Mint this Reckoning's assessment, once.
   *
   * Called every OBLIGE rather than only at phase 0, and the reason is a fixture rather
   * than an agent: a world constructed with `startTick` inside a cycle would otherwise
   * hold no assessment for that cycle, no docket row for anybody, and INV-25 would halt
   * a test world on its first tick. `assessCycle` skips a constellation that is already
   * assessed, so the ordinary path still mints at phase 0 exactly once.
   */
  private assessLevyNow(ctx: PhaseContext): void {
    const reckoning = reckoningOf(ctx.tick);
    // The memo is a fast path, never the authority: the book is inside the rollback and
    // this field is not, so an aborted phase-0 tick leaves the field claiming a Reckoning
    // the restored book holds no plan for. `resume()` would then re-run the tick, return
    // here, mint nothing, and INV-25 would halt on every principal for the rest of the
    // cycle — a world made unrecoverable by its own recovery path. Asking the book too
    // costs one map walk over at most `LEVY_RETAINED_RECKONINGS` constellations.
    if (this.levyAssessedReckoning === reckoning && this.levy.plansIn(reckoning).length > 0) return;
    if (this.world.principalOrder.length === 0) return;
    let assessed;
    try {
      assessed = assessCycle({
        book: this.levy,
        world: this.world,
        tick: ctx.tick,
        subjectOf: (principal) => this.levySubjectOf(principal, ctx.tick),
      });
    } catch (error: unknown) {
      // An assessment that cannot be computed must not take the tick down: the Levy is
      // the mechanic that keeps the world from being quiet, and a quiet world is better
      // than a stopped one. Reported loudly, and `levyBuilt` stays true while
      // `assessed: 0` says what happened.
      this.faults.push(
        `the Levy could not assess Reckoning ${String(reckoning)} (${describeError(error)}); nothing is ` +
          'assessed tonight and every principal is short of nothing',
      );
      this.levyAssessedReckoning = reckoning;
      return;
    }
    this.levyAssessedReckoning = reckoning;
    ctx.step(assessed.plans.length + assessed.tallies.length);

    for (const plan of assessed.plans) {
      ctx.emit({
        tick: ctx.tick,
        kind: 'levy.assessed',
        rulesVersion: RULES_VERSION,
        actorPrincipalId: null,
        onBehalfOfPrincipalId: null,
        grantId: null,
        eventFamilyId: `levy::${String(plan.reckoning)}::${plan.constellation}`,
        parentEventId: null,
        isPublic: true,
        publicAt: ctx.tick,
        declassifyAt: ctx.tick,
        provenanceClass: 'FACT',
        actedOnStateVersion: ctx.frozenStateVersion,
        decisionSource: null,
        payload: {
          constellation: plan.constellation,
          reckoning: plan.reckoning,
          totalMinor: plan.total,
          rule: plan.rule,
          byDefault: plan.byDefault,
          spared: plan.spared,
          deliverableTo: plan.deliverableTo,
          assessed: plan.lines.length,
        },
        visibility: 'PUBLIC',
        audience: [],
      });
    }
    // §14.4's named loser, computed against the counterfactual where the group did
    // nothing. Published because Law 2 asks for a *named* loss by the group's action, and
    // a loss nobody can name is not one.
    for (const loser of assessed.losers) {
      ctx.emit({
        tick: ctx.tick,
        kind: 'levy.borne',
        rulesVersion: RULES_VERSION,
        actorPrincipalId: null,
        onBehalfOfPrincipalId: loser.principal,
        grantId: null,
        eventFamilyId: `levy::${String(reckoning)}::${loser.constellation}`,
        parentEventId: null,
        isPublic: true,
        publicAt: ctx.tick,
        declassifyAt: ctx.tick,
        provenanceClass: 'FACT',
        actedOnStateVersion: ctx.frozenStateVersion,
        decisionSource: null,
        payload: { constellation: loser.constellation, principal: loser.principal, extraMinor: loser.extra },
        visibility: 'PUBLIC',
        audience: [],
      });
    }
  }

  /**
   * Settle the Levy: shortfall, sweep, strikes, `LEVY SHORT`.
   *
   * Runs at the settlement tick, **after** the venture batch (see the OBLIGE handler on
   * why the order is a rule and not a preference).
   */
  private settleLevyNow(ctx: PhaseContext): void {
    if (!isSettlementTick(ctx.tick)) return;
    const reckoning = reckoningOf(ctx.tick);
    // ── THE GUARD IS THE BOOK'S, BECAUSE THE BOOK IS INSIDE THE ROLLBACK ─────
    //
    // This used to read a plain field on the runtime. `settleLevy` is already idempotent
    // by refusal against `book.isSettled`, so the field was a second home for a fact the
    // book owns (scar #5) — and the two homes come apart at exactly the moment that
    // matters. `abort()` restores every state table, and `levyStateTable` is one of them,
    // so a halted tick's `markSettled` is rolled back; the field is in no table and is
    // not. `resume()` then re-runs the same tick, this guard returns early against the
    // stale field, and **the Reckoning's Levy is never settled**: no shortfall rows, no
    // sweep, no strikes, `LEVY SHORT` 0 instead of what was owed — and the tick publishes
    // clean, so nothing halts and nothing says so. Verified: 3 rows and 18 000 short
    // before the abort, 0 and 0 after the re-run.
    //
    // The book's flag is captured in `state_hash` and restored by the rollback, so it can
    // only ever say what the world it belongs to says.
    if (this.levy.isSettled(reckoning)) return;
    this.levySettledReckoning = reckoning;

    const settlement = settleLevy({
      book: this.levy,
      reckoning,
      tick: ctx.tick,
      exposureOf: (principal) => principalPosition(this.ledger, principal, storesAccount(principal)).exposure,
      sweep: this.levySweepPort(),
    });
    this.levyOutcome = settlement;
    ctx.step(settlement.shortfalls.length + settlement.sweepQueue.length);

    for (const row of settlement.shortfalls) {
      if (row.owed <= 0) continue;
      ctx.emit({
        tick: ctx.tick,
        kind: 'levy.short',
        rulesVersion: RULES_VERSION,
        actorPrincipalId: null,
        onBehalfOfPrincipalId: row.principal,
        grantId: null,
        eventFamilyId: `levy::${String(reckoning)}::${row.constellation}`,
        parentEventId: null,
        isPublic: true,
        publicAt: ctx.tick,
        declassifyAt: ctx.tick,
        provenanceClass: 'FACT',
        actedOnStateVersion: ctx.frozenStateVersion,
        decisionSource: null,
        // The arithmetic travels with the accusation. A shortfall drives a sweep, a
        // strike and eventually a demotion, so a reader has to be able to reproduce it
        // from the row alone — INV-17's rule for defaults, applied where it belongs.
        payload: {
          principal: row.principal,
          constellation: row.constellation,
          assessmentMinor: row.assessment,
          paidOwnMinor: row.paidOwn,
          paidOtherMinor: row.paidOther,
          sweptQty: row.sweptQty,
          presenceOwedMinor: row.presenceOwed,
          purchasableOwedMinor: row.purchasableOwed,
          owedMinor: row.owed,
          inSweepQueue: row.inSweepQueue,
        },
        visibility: 'PUBLIC',
        audience: [],
      });
    }

    for (const principal of settlement.demoted) {
      ctx.emit({
        tick: ctx.tick,
        kind: 'levy.capacity',
        rulesVersion: RULES_VERSION,
        actorPrincipalId: null,
        onBehalfOfPrincipalId: principal,
        grantId: null,
        eventFamilyId: `levy::${String(reckoning)}`,
        parentEventId: null,
        isPublic: true,
        publicAt: ctx.tick,
        declassifyAt: ctx.tick,
        provenanceClass: 'FACT',
        actedOnStateVersion: ctx.frozenStateVersion,
        decisionSource: null,
        // Named in full, because this is the *only* thing chronic non-payment costs and a
        // reader must be able to see that nothing else moved (§5.2, PROP-LV4).
        payload: {
          principal,
          capacity: this.levy.capacityOf(principal),
          identityTaken: false,
          holdingTaken: false,
          standingTaken: false,
        },
        visibility: 'PUBLIC',
        audience: [],
      });
    }

    const plans = this.levy.plansIn(reckoning);
    this.levySummaries.push({
      reckoning,
      tick: ctx.tick,
      assessed: settlement.assessed,
      paidInFull: settlement.paidInFull,
      totalMinor: sumMinor(plans.map((p) => p.total)),
      shortMinor: settlement.levyShort,
      sweptQty: settlement.sweptQty,
      sweepQueue: settlement.sweepQueue.length,
      demoted: settlement.demoted.length,
      byDefault: plans.filter((p) => p.byDefault).length,
      ballotsCast: plans.reduce<number>(
        (n, p) => n + this.levy.ballotsFor(reckoning, p.constellation).length,
        0,
      ),
    });
    this.levy.prune(reckoning);
  }

  /**
   * The only thing Levy settlement may reach for: located goods.
   *
   * `SweepPort` cannot express a holding, a standing row, a hand or an identity, so
   * §5.2's *"never identity, never the holding, never standing"* is a property of the
   * type rather than of anybody remembering (PROP-LV4).
   */
  private levySweepPort(): SweepPort {
    return {
      availableOf: (principal) => this.levyGoodAvailable(principal),
      consume: (args) =>
        this.consumeLevyGood({
          principal: args.principal,
          want: args.want,
          place: args.place,
          tick: args.tick,
          label: `levy.sweep:${String(args.reckoning)}`,
        }),
    };
  }

  /**
   * Unpledged, available units of the levy good in a principal's STORES.
   *
   * Public because a *player* has to be able to see it before it commits a hand to a
   * journey: walking three gates to a delivery place you cannot pay at is the shape of
   * refusal-loop noise that buries real rules-surface defects (AGT-S3). The affordance
   * layer and the cast read this same figure.
   */
  levyGoodAvailable(principal: PrincipalId): Qty {
    let total = 0;
    for (const lot of this.levyGoodLots(principal)) total += lot.qty;
    return qty(total);
  }

  /**
   * The lots a delivery or a sweep may draw on, in canonical order.
   *
   * A pledged lot is excluded: the lien is exclusive, and the same goods must never back
   * two obligations (INV-4). An `IN_TRANSIT` lot is excluded too — it is not somewhere a
   * hand can hand it over from.
   */
  private levyGoodLots(principal: PrincipalId): readonly { readonly id: LotId; readonly qty: number }[] {
    return this.ledger
      .lotsInAccount(storesAccount(principal))
      .filter((lot) => lot.good === LEVY_GOOD && lot.encumbranceId === null && lot.state === 'AVAILABLE')
      .sort((a, b) => compareIds(a.id, b.id))
      .map((lot) => ({ id: lot.id, qty: lot.qty }));
  }

  /**
   * Move `want` units of the levy good into civic custody at `place`, and return what
   * actually moved.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THE LOT IS RELOCATED TO THE DELIVERY PLACE BEFORE IT IS CONSUMED**, so the record
   * says the goods were destroyed *there*. §10.2's rule is that everything is located,
   * and a consumption posted at the payer's holding while its hand stood at the delivery
   * berth would be a located fact that was false.
   *
   * The carriage itself is compressed into the presence requirement: `haul` is §16 step
   * 11 and does not exist, so what the engine can actually check is that one of the
   * payer's own hands is standing at the named place. That is also the property §5.2 and
   * PROP-LV3 turn on — presence, not payment — so the compression costs the mechanic
   * nothing it depends on. It is stated rather than hidden, and it is the one place this
   * module is thinner than the fiction.
   *
   * Never throws. A delivery is an agent-reachable path and a sweep runs at settlement;
   * a throw in either would be an agent-triggerable halt or a tick aborted after every
   * venture had already settled.
   * ══════════════════════════════════════════════════════════════════════════
   */
  private consumeLevyGood(args: {
    readonly principal: PrincipalId;
    readonly want: Qty;
    readonly place: SystemId;
    readonly tick: number;
    readonly label: string;
  }): Qty {
    let left: number = args.want;
    let taken = 0;
    for (const lot of this.levyGoodLots(args.principal)) {
      if (left <= 0) break;
      const portion = Math.min(left, lot.qty);
      if (portion <= 0) continue;
      try {
        this.ledger.relocate(lot.id, { location: args.place });
        this.ledger.destroyGoods({
          eventId: `${args.label}:${args.principal}:${lot.id}` as EventId,
          tick: args.tick,
          sink: GOODS_SINK.CONSUMPTION,
          lotId: lot.id,
          qty: qty(portion),
        });
      } catch (error: unknown) {
        this.faults.push(
          `${args.principal} could not hand over ${String(portion)} of ${LEVY_GOOD} at ${args.place} ` +
            `(${describeError(error)}); the Levy credits only what actually moved`,
        );
        continue;
      }
      taken += portion;
      left -= portion;
    }
    return qty(taken);
  }

  /**
   * `deliver` — §5.2's discharge, and the only one.
   *
   * Three things this handler does in a fixed order, because the order is what keeps the
   * record honest (A5′):
   *
   *   1. **Refuse on the merits first**, with a sentence. Nothing has moved yet.
   *   2. **Move the goods.** The ledger is the authority on whether they moved.
   *   3. **Credit exactly what moved.** Never what was asked for.
   *
   * A handler that credited first and moved second would record a payment that did not
   * happen, which is the same lie as a fabricated default pointed the other way.
   */
  private vDeliver(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const reckoning = reckoningOf(ctx.tick);
    // `on_behalf_of` is the Coase-collapse primitive, offered on purpose: a delivery
    // service has to be *expressible* for PROP-LV3 to be able to attempt the collapse
    // against it. What it cannot do is fill the non-escrowable share (`payment.ts`).
    const payerRaw = readString(req.params, ['on_behalf_of', 'onBehalfOf', 'for', 'payer']);
    const payer = (payerRaw ?? req.principal) as PrincipalId;
    if (this.world.holdingByPrincipal.get(payer) === undefined) {
      return reject('A2', `there is no principal ${payer} to deliver for; name yourself or a real principal.`);
    }
    const constellation = constellationOf(this.world, payer);
    const place = constellation === null ? null : deliveryPlaceOf(this.world.map, constellation);
    if (place === null) {
      return reject(
        'A2',
        'that principal\'s constellation has no delivery place, so nothing can be delivered against it yet.',
      );
    }

    const owing = this.levy.owingOf(reckoning, payer);
    const available = this.levyGoodAvailable(req.principal);
    const fault = deliveryFault({
      world: this.world,
      payer,
      deliverer: req.principal,
      place,
      tick: ctx.tick,
      owing,
      available,
    });
    if (fault !== null) return reject('A14', fault);

    const asked = readInt(req.params, ['amount', 'qty', 'quantity']);
    const byOwnHand = req.principal === payer;
    const credible = creditFor(owing, minor(asked === null ? owing.owed : Math.max(0, asked)), byOwnHand);
    const want = qty(Math.min(credible, available));
    if (want <= 0) {
      return reject(
        'A14',
        `nothing of that delivery can be credited: ${String(credible)} is creditable and you hold ` +
          `${String(available)} of ${LEVY_GOOD}.`,
      );
    }

    const moved = this.consumeLevyGood({
      principal: req.principal,
      want,
      place,
      tick: ctx.tick,
      label: `levy.deliver:${String(reckoning)}`,
    });
    if (moved <= 0) {
      return reject('A14', 'the goods could not be handed over, so nothing was credited against your Levy.');
    }
    this.levy.credit(reckoning, payer, minor(moved), byOwnHand);

    const carrier = carrierAt(this.world, req.principal, place, ctx.tick);
    ctx.emit({
      tick: ctx.tick,
      kind: 'levy.delivered',
      rulesVersion: RULES_VERSION,
      actorPrincipalId: req.principal,
      onBehalfOfPrincipalId: byOwnHand ? null : payer,
      grantId: null,
      eventFamilyId: `levy::${String(reckoning)}::${String(constellation)}`,
      parentEventId: null,
      isPublic: true,
      publicAt: ctx.tick,
      declassifyAt: ctx.tick,
      provenanceClass: 'FACT',
      actedOnStateVersion: ctx.frozenStateVersion,
      decisionSource: req.decisionSource,
      payload: {
        payer,
        deliverer: req.principal,
        place,
        good: LEVY_GOOD,
        qty: moved,
        byOwnHand,
        hand: carrier?.id ?? null,
      },
      visibility: 'PUBLIC',
      audience: [],
    });
    return { ok: true, value: null };
  }

  /**
   * `vote` — §12.2's one verb, here for the `LEVY` ballot.
   *
   * Free (`tick/budget.ts` lists it), peaceful in the Commons (`world/commons.ts` names
   * `LEVY` a peaceful ballot), and **replacing** rather than appending: one principal, one
   * ballot, or a principal with more actions would have more votes and A4 would be
   * violated through the ballot box.
   */
  private vVote(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const kind = (readString(req.params, ['ballot', 'ballot_kind', 'kind']) ?? LEVY_BALLOT).toUpperCase();
    if (kind !== LEVY_BALLOT) {
      return reject(
        'A2',
        `only the ${LEVY_BALLOT} ballot is open in this build: §12.2's other two (seizure, syndicate ` +
          'proposals) land with predation and with syndicates. Send {"ballot": "LEVY", "rule": "..."}.',
      );
    }
    const rule = readString(req.params, ['rule', 'allocation', 'formula']) ?? '';
    const spare = readString(req.params, ['spare', 'spare_principal', 'relieve']);
    const fault = voteFault({
      book: this.levy,
      world: this.world,
      voter: req.principal,
      rule,
      spare,
      tick: ctx.tick,
    });
    if (fault !== null) return reject('A14', fault);
    if (!isLevyRule(rule)) {
      // Unreachable: `voteFault` checks the rule first. Kept because the cast is a
      // narrowing, not a check, and a future edit that reordered `voteFault` would
      // otherwise write an unvalidated rule into a hashed structure.
      return reject('A2', `${rule} is not a published Levy allocation rule.`);
    }
    const ballot = ballotFor({
      world: this.world,
      voter: req.principal,
      rule,
      spare: spare as PrincipalId | null,
      tick: ctx.tick,
    });
    if (ballot === null) return reject('A2', 'you have no constellation to cast a Levy ballot in.');
    try {
      this.levy.castBallot(ballot);
    } catch (error: unknown) {
      return reject('INV-26', describeError(error));
    }
    ctx.emit({
      tick: ctx.tick,
      kind: 'levy.voted',
      rulesVersion: RULES_VERSION,
      actorPrincipalId: req.principal,
      onBehalfOfPrincipalId: null,
      grantId: null,
      eventFamilyId: `levy::${String(ballot.forReckoning)}::${ballot.constellation}`,
      parentEventId: null,
      isPublic: true,
      publicAt: ctx.tick,
      declassifyAt: ctx.tick,
      provenanceClass: 'FACT',
      actedOnStateVersion: ctx.frozenStateVersion,
      decisionSource: req.decisionSource,
      // A ballot is PUBLIC in full (§12.2: "all resolve at a Reckoning; all are PUBLIC"),
      // which is what lets a viewer read the coalition off the feed — AGT-X4's pass
      // criterion is that a cartel is *visible* while it succeeds.
      payload: {
        constellation: ballot.constellation,
        forReckoning: ballot.forReckoning,
        rule: ballot.rule,
        spare: ballot.spare,
      },
      visibility: 'PUBLIC',
      audience: [],
    });
    return { ok: true, value: null };
  }

  /**
   * The only cost of chronic non-payment: fewer concurrent venture roles in the Commons.
   *
   * §5.2: *"chronic non-payment demotes Commons capacity, **and that is all**."* Floored
   * at {@link LEVY_MIN_COMMONS_CAPACITY} and applied only to a Commons-bound principal,
   * because it is what the civic-leased holding grants (§6.3). Never zero: the Commons is
   * a permanent floor, not a timer (A8), and a capacity of zero would be an ejection.
   */
  private commonsCapacityRejection(principal: PrincipalId): Rejection | null {
    if (this.world.holdingByPrincipal.get(principal) === undefined) return null;
    if (!principalIsCommonsBound(this.world, principal)) return null;
    const capacity = this.levy.capacityOf(principal);
    if (capacity >= LEVY_BASE_COMMONS_CAPACITY) return null;
    const held = this.ventures
      .live()
      .filter((v) => roleOfPrincipal(v, principal) !== null || v.creator === principal).length;
    if (held < capacity) return null;
    return reject(
      'A14',
      `your Commons capacity is ${String(capacity)} concurrent ventures after ` +
        `${String(this.levy.chronicOf(principal).demotions)} chronic Levy shortfalls, and you hold ` +
        `${String(held)}. Deliver your Levy for a clean Reckoning, or finish something first. Your holding, ` +
        'your standing and your identity are untouched and always will be.',
    );
  }

  /**
   * The Levy as `observe` shows it, in `agent.md` §6's own field names.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THE FIELD NAMES ARE THE CONTRACT AND THEY ARE NOT NEGOTIABLE HERE.**
   * `agent.md` §6 publishes `levy{ my_assessment, paid, deliverable_to,
   * shortfall_if_unpaid, ballot }`, and `observe/sources.ts:LevyBlock` types exactly
   * those plus `non_escrowable`. This method computes them from the one book, so the
   * number an agent is shown is the number it is charged — scar #1 was the engine and
   * the agent-facing text disagreeing about one word, and a Levy with two arithmetics
   * would be that with money attached.
   * ══════════════════════════════════════════════════════════════════════════
   *
   * `null` when the principal holds no assessment — which after the first OBLIGE of a
   * cycle means it is not enrolled. `my_assessment: 0` would read as "assessed at
   * nothing", a claim §5.2 makes about nobody.
   */
  levyBlockFor(principal: PrincipalId, tick = this.engine.tick): LevyBlock | null {
    const reckoning = reckoningOf(tick);
    const found = this.levy.lineFor(reckoning, principal);
    if (found === null) return null;
    const owing = this.levy.owingOf(reckoning, principal);
    const window = ballotWindow(tick);
    const constellation = found.plan.constellation;
    return {
      my_assessment: owing.assessment,
      paid: owing.paid,
      deliverable_to: found.plan.deliverableTo,
      shortfall_if_unpaid: owing.owed,
      non_escrowable: owing.nonEscrowable,
      ballot: window.open
        ? {
            id: `${LEVY_BALLOT}::${String(window.forReckoning)}::${constellation}`,
            kind: LEVY_BALLOT,
            closes_tick: window.closesTick,
            voted: this.levy.hasVoted(window.forReckoning, principal),
            // A LEVY ballot takes nothing. `null` is the honest answer, and it is what
            // keeps the Commons floor's "a hostile ballot with no resolvable target fails
            // closed" rule from mistaking an allocation vote for a seizure.
            target: null,
          }
        : null,
    };
  }

  /** Per-Reckoning Levy history, oldest first. Bounded; the record is in the ledger. */
  levyReckonings(): readonly LevySummary[] {
    return this.levySummaries.all;
  }

  /** The Levy settlement that ran this Reckoning, for the frame renderer and tests. */
  get levySettlement(): LevySettlement | null {
    return this.levyOutcome;
  }

  /**
   * The tribute lines as they stand right now (§5.2's pixel signature).
   *
   * Read from the book rather than recomputed, so the line's thickness is the number the
   * settlement will use. A drawn line nobody owes is a lie on the map.
   */
  tributeLines(tick = this.engine.tick): readonly TributeLine[] {
    return tributeLinesFor({ book: this.levy, world: this.world, reckoning: reckoningOf(tick), tick });
  }

  /** Every book the driver writes to. Built per call: the venture book can be replaced. */
  private reckoningWorld(): ReckoningWorld {
    return {
      ledger: this.ledger,
      book: this.ventures,
      events: this.events,
      register: this.register,
      seals: this.seals,
      standing: this.standing,
      // The WIDENED book, not the raw one. The driver's own ASSERT stage runs INV-4,
      // and with `this.obligations` here every resting market bid was an orphan lock
      // and the settlement halted. See `liveObligations`.
      obligations: this.liveObligations(),
      accounts: this.accounts,
      presence: this.world,
    };
  }

  /**
   * The Reckoning's violations, for the tick loop's `assertions` hook.
   *
   * This is how a failed Reckoning stops the world: the batch reports, the tick loop
   * aborts at ASSERT, and the world PAUSES through the one halt path there is. Scoped to
   * the tick it ran at, so a later tick cannot inherit a halt that already happened.
   */
  private reckoningViolationsAt(tick: number): readonly InvariantViolation[] {
    if (tick !== this.settledAtTick || this.outcome === null) return [];
    return reckoningViolations(this.outcome);
  }

  /**
   * The deeds this Reckoning recorded — **engine-recorded facts, never claims**.
   *
   * One per role holder per delivery, because a delivery is the thing the holders of a
   * venture's roles actually did. `outcome` is the value realised, in `MINOR`, measured
   * at the state version the delivery happened at (scar #6: a verdict is computed
   * against the state the agent acted on).
   */
  private deedsFor(reckoning: number): readonly Deed[] {
    const out: Deed[] = [];
    for (const record of this.deliveriesIn(reckoning)) {
      for (const principal of record.holders) {
        out.push({
          principal,
          tick: record.tick,
          verb: DELIVERY_VERB,
          target: record.venture,
          measure: DELIVERY_MEASURE,
          outcome: record.proceeds,
          valuedAtStateVersion: record.stateVersion,
          eventId: record.eventId,
        });
      }
    }
    return out.sort(cmpDeeds);
  }

  /**
   * The completeness witness's per-principal tally — **derived from the venture rows**.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * The one requirement a type cannot state: *the counts must not come from the deed
   * array they are checked against.* A tally counted off {@link deedsFor} would make
   * `SealBook.resolve`'s comparison a tautology, and a deed query that silently dropped
   * a principal would then mark that principal `CONTRADICTED` from an absence it caused
   * itself — a permanent false mark on an innocent agent (§15.4, A5′).
   *
   * So the two numbers reach the resolver by two roads. The deeds come from the
   * delivery records — what was true when the value landed. The tally comes from the
   * **venture book**: a venture that reached `LIVE` delivers at its delivery tick (see
   * {@link DELIVERED_STATES}), so its role rows say how many deeds were written for
   * whom, without consulting a single deed.
   *
   * Every enrolled principal appears, including at zero: a principal tallied at 0 is a
   * *witnessed abstention* and can be marked, while a principal absent from the tally is
   * an unanswered question and its seals defer with no mark.
   * ══════════════════════════════════════════════════════════════════════════
   */
  private deedTallyFor(reckoning: number): readonly (readonly [PrincipalId, number])[] {
    const counts = new Map<PrincipalId, number>();
    for (const principal of this.world.principalOrder) counts.set(principal, 0);
    for (const venture of this.ventures.all()) {
      if (!DELIVERED_STATES.includes(venture.state)) continue;
      if (reckoningOf(this.deliveryTickOf(venture)) !== reckoning) continue;
      for (const role of venture.roles) {
        const holder = role.filledByPrincipal;
        if (holder === null) continue;
        counts.set(holder, (counts.get(holder) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => compareIds(a[0], b[0]));
  }

  /** Deliveries recorded inside one Reckoning, in venture order. */
  private deliveriesIn(reckoning: number): readonly DeliveryRecord[] {
    const out: DeliveryRecord[] = [];
    for (const record of this.deliveries.values()) {
      if (reckoningOf(record.tick) === reckoning) out.push(record);
    }
    return out.sort((a, b) => compareIds(a.venture, b.venture));
  }

  /**
   * Drop delivery records whose ventures have finished with them.
   *
   * Not "older than N Reckonings" alone: a deferral settles the **same** pot up to
   * {@link MAX_DEFERRALS} Reckonings later, and losing the pinned proceeds in between
   * would make the second pass re-quote them — which `guardProgressFitsClaims` halts
   * on, correctly, naming a caller bug that would be this prune. So a record survives
   * until its venture is terminal, and deferrals are bounded, so this is too.
   */
  private pruneDeliveries(reckoning: number): void {
    for (const [id, record] of [...this.deliveries.entries()]) {
      const venture = this.ventures.get(id);
      const finished =
        venture === undefined ||
        venture.state === 'SETTLED' ||
        venture.state === 'DEFAULTED' ||
        venture.state === 'ABANDONED';
      if (finished && reckoningOf(record.tick) + DEED_RETAINED_RECKONINGS <= reckoning) {
        this.deliveries.delete(id);
      }
    }
  }

  /** An obligation that has finished releases its elections. Bounded, per INV-26. */
  private releaseElections(venture: VentureId): void {
    const record = this.ventures.get(venture);
    const roles = record?.roles.length ?? 0;
    for (let index = 0; index < Math.max(roles, 1); index += 1) {
      this.elections.delete(electionKey(venture, index));
    }
  }

  private summarise(outcome: ReckoningOutcome): ReckoningSummary {
    const states = outcome.settlements.map((s) => s.terminalState);
    const honoured = outcome.standingCredits.filter((c) => c.delta.cause === 'ELECTIVE_HONOURED');
    const verdicts = outcome.seals?.verdicts ?? [];
    return {
      reckoning: outcome.reckoning,
      tick: outcome.tick,
      committed: outcome.transaction.committed,
      obligations: outcome.settlements.length,
      settled: states.filter((s) => s === 'SETTLED').length,
      defaulted: states.filter((s) => s === 'DEFAULTED').length,
      deferred: states.filter((s) => s === 'DEFERRED').length,
      defaults: outcome.defaults.length,
      electiveHonoured: honoured.length,
      standingMoves: outcome.standingCredits.length + (outcome.seals?.charges.length ?? 0),
      sealsJudged: verdicts.length,
      sealsContradicted: verdicts.filter((v) => v.verdict === 'CONTRADICTED').length,
      sealsUnmarked: outcome.seals?.deferred.length ?? 0,
      deedSetFaults: outcome.deedSetFaults.length,
      unattributed: outcome.unattributed,
      recordedLoss: sumMinor(outcome.settlements.map((s) => s.recordedLoss)),
      proceeds: sumMinor(outcome.settlements.map((s) => s.claims.proceeds)),
      paidEscrowed: sumMinor(
        outcome.settlements.flatMap((s) => s.payouts.map((p) => p.escrowedPaid)),
      ),
      paidElective: sumMinor(
        outcome.settlements.flatMap((s) => s.payouts.map((p) => p.electivePaid)),
      ),
    };
  }

  /** Every Reckoning this process has settled, oldest first. Bounded (INV-26). */
  reckonings(): readonly ReckoningSummary[] {
    return this.summaries.all;
  }

  /** The last Reckoning's full outcome, for a caller that needs more than the summary. */
  get lastReckoning(): ReckoningOutcome | null {
    return this.outcome;
  }

  /**
   * The last settled Reckoning, rendered for the spectator client — or null before any
   * Reckoning has settled.
   *
   * A READ MODEL over the committed outcome, never the live tick: the renderer is handed
   * a settled result and nothing with a live handle, which is what keeps A9 parity
   * structural (a viewer cannot be shown a fact a non-party agent's own observe would
   * not) and lets the frame replay at broadcast speed independent of sim speed
   * (TESTING.md §1.1 hazard 3). The world settles Reckonings and, until this existed,
   * nobody could see one — half the product, dark.
   *
   * Fields sourced cleanly today: meters, the settled ventures with their parties and
   * outcome, tribute lines, handles from holding names. publicLine/sealContent/messages
   * are left null/empty — the renderer tolerates that (a reel only appears on a broken
   * elective promise anyway), and wiring the declassified negotiation transcript in is a
   * follow-up, not a blocker on the map having motion.
   */
  reckoningFrame(): ReckoningFrame | null {
    const outcome = this.outcome;
    if (outcome === null) return null;

    const handles = new Map<PrincipalId, Handle>();
    for (const h of this.world.holdings.values()) {
      handles.set(h.principal, h.name as unknown as Handle);
    }

    const settled: SettledView[] = [];
    for (const st of outcome.settlements) {
      const v = this.ventures.get(st.venture);
      if (v === undefined) continue;
      const filled = v.roles.filter((r) => r.filledByPrincipal !== null).length;
      const electiveDue = sumMinor(st.payouts.map((pp) => pp.electiveDue));
      settled.push({
        venture: st.venture,
        kind: v.kind,
        stage: v.stage,
        creator: v.creator,
        rolesFilled: filled,
        rolesTotal: v.roles.length,
        electiveBps: v.roles.length === 0 ? 0 : Math.round((electiveDue / Math.max(1, st.claims.proceeds)) * 10_000),
        atStake: electiveDue,
        defaulted: st.terminalState === 'DEFAULTED',
        deferred: st.terminalState === 'DEFERRED',
        parties: partiesOf(v),
        publicLine: null,
        sealVerdict: null,
        messages: [],
      });
    }

    // Meters: LEVY SHORT is the headline (§14.2), kept/broken is the cumulative
    // scoreboard, on-a-promise is the elective value that settled this Reckoning.
    const summaries = this.summaries.all;
    const kept = summaries.reduce((a, r) => a + r.electiveHonoured, 0);
    const broken = summaries.reduce((a, r) => a + r.defaults, 0);
    const onAPromise = sumMinor(settled.map((v) => v.atStake));

    // A6's authority signature (§8, §14): who holds standing power over whom at this
    // settlement, and how much of it has been drawn. Dead-expired grants are dropped;
    // live and revoked ones render (a revocation is drama). renderFrame sorts by the most
    // authority and caps to the budget — convergence is the signature, a hairball is not.
    const authorityLines: AuthorityLine[] = this.grantBook
      .all()
      .filter((g) => g.expiresTick >= outcome.tick)
      .map((g) => {
        // BOTH limits decide the state. Reading `spentDirect` alone rendered the A6
        // attack as `UNUSED`: an un-escrowable venture created on a grantor's behalf
        // moves no escrow, so the direct counter never leaves zero while the grantor
        // carries the whole elective tail. Nothing drawn on either limit is UNUSED;
        // no headroom left on either is EXHAUSTED; anything between is DRAWN.
        const headroom = this.grantBook.headroom(g.id);
        const drawn = g.spentDirect > 0 || g.spentContingent > 0;
        const state: AuthorityLineState =
          g.revokedAtTick !== null
            ? 'REVOKED'
            : !drawn
              ? 'UNUSED'
              : headroom.direct <= 0 && headroom.contingent <= 0
                ? 'EXHAUSTED'
                : 'DRAWN';
        return {
          grantor: g.grantor,
          delegate: g.delegate,
          granted: g.maxDirectLoss,
          spent: g.spentDirect,
          grantedContingent: g.maxContingentLiability,
          spentContingent: g.spentContingent,
          state,
        };
      });

    const source: FrameSource = {
      reckoning: outcome.reckoning,
      tick: outcome.tick,
      stateHash: this.engine.stateHash,
      settled,
      meters: {
        levyShort: this.levy.shortFor(outcome.reckoning),
        onAPromise,
        kept,
        broken,
      },
      handles,
      // The raid ticker, drained into the frame. Bounded by the Ring, and 140-char
      // capped by `raidTickerLine`; `renderFrame` drops anything longer anyway.
      ticker: this.raidTicker.all,
      tomorrow: [],
      tributeLines: this.tributeLines(outcome.tick),
      authorityLines,
      // Predation's pixel signature (A13, §9). Built by the predation layer, never by
      // the renderer: a red arc thrown at a holding nobody attacked is the worst lie
      // this frame could tell. The §11.2 clause that admits the key is argued in
      // `frames/projection.ts`.
      raidLines: raidLinesFor(this.raids, outcome.tick, MAX_RAID_LINES),
    };
    // A9 as a boundary rather than a habit. Everything above is tier-legal today, but
    // this frame is built by reading live books directly, so nothing structural stopped
    // the next field from being sensed cargo or a private stockpile. The assertion
    // refuses a projection carrying an unargued key, and refuses one that is still
    // holding a handle to live state (it must canonicalise, so it must be inert data).
    assertInertPublicFacts(source);
    return renderFrame(source);
  }

  /** Operator-facing alarms that were deliberately not halts. Bounded, and printed. */
  operatorFaults(): readonly string[] {
    return this.faults.all;
  }

  // ── The record ────────────────────────────────────────────────────────────

  /**
   * Append this tick's buffered events at COMMIT.
   *
   * Never throws. COMMIT runs *after* ASSERT — the tick is already published by the time
   * this is called — so a throw here would take down a tick that had passed every check,
   * and there is nothing left to abort. A refused row is an operator's alarm, bounded,
   * and reported.
   */
  private recordEvents(drafts: readonly NewEvent[], tick: number): void {
    for (const draft of drafts) {
      try {
        this.events.append(draft);
      } catch (error: unknown) {
        this.faults.push(
          `the record refused a ${draft.kind} row at tick ${String(tick)} (${describeError(error)})`,
        );
      }
    }
  }

  /**
   * Append one public row immediately and return its minted id, or null.
   *
   * For the two facts that need an id *within* the tick that produced them: a delivery,
   * whose deed has to cite a row an auditor can open, and its ledger posting. Everything
   * else goes through `ctx.emit` and lands at COMMIT.
   */
  private appendPublic(draft: {
    readonly tick: number;
    readonly kind: string;
    readonly actor: PrincipalId;
    /**
     * §15.1's "immutable primary cohort". The venture, so the receipt reel pulls
     * formation, delivery and settlement out of one `transcript(family)` call — the same
     * cohort `ReceiptContext.familyOf` uses, spelled the same way.
     */
    readonly family: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly actedOnStateVersion: number;
  }): EventId | null {
    const event: NewEvent = {
      tick: draft.tick,
      kind: draft.kind,
      rulesVersion: RULES_VERSION,
      actorPrincipalId: draft.actor,
      onBehalfOfPrincipalId: null,
      grantId: null,
      eventFamilyId: draft.family,
      parentEventId: null,
      isPublic: true,
      publicAt: draft.tick,
      declassifyAt: draft.tick,
      provenanceClass: 'FACT',
      actedOnStateVersion: draft.actedOnStateVersion,
      decisionSource: 'HEURISTIC',
      payload: draft.payload,
      visibility: 'PUBLIC',
      audience: [],
    };
    try {
      return this.events.append(event).event.id;
    } catch (error: unknown) {
      this.faults.push(`the record refused a ${draft.kind} row (${describeError(error)})`);
      return null;
    }
  }

  private refundEscrow(tick: number, venture: VentureRecord): void {
    const account = escrowAccount(venture.id, venture.creator);
    if (this.ledger.account(account) === undefined) return;
    const held = this.ledger.freeBalance(account);
    if (held <= 0) return;
    try {
      this.ledger.transferCurrency({
        eventId: `escrow.return:${venture.id}:${String(tick)}` as never,
        tick,
        from: account,
        to: storesAccount(venture.creator),
        amount: held,
      });
    } catch {
      // Leaving value in an escrow account is a visible imbalance the ledger's own
      // invariants will report; throwing here would halt the world over a refund.
    }
  }

  /**
   * Venture ids are derived, never random and never a counter alone.
   *
   * Derived from `(tick, principal, ordinal)` so a replay of the same action log
   * mints the same id — a random id would make every downstream hash differ on a
   * replay that was otherwise identical.
   */
  private mintVentureId(tick: number, principal: PrincipalId): VentureId {
    this.ventureCounter += 1;
    const stamp = canonicalHash({ tick, principal, ordinal: this.ventureCounter }).slice(0, 8);
    return `v:${String(tick)}:${stamp}` as VentureId;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** The Reckoning a tick belongs to. One home, so the seal book and the API agree. */
export function reckoningOf(tick: number): number {
  return reckoningIndex(tick);
}

/**
 * The scheduling fact {@link Runtime.sealableRoles} rests on, asserted rather than assumed.
 *
 * A seal is only keepable if the delivery it names actually happens, and `resolveFills`
 * skips every delivery inside the freeze (§5.1: nothing may touch a figure the settlement
 * was computed from). Every venture `create` mints resolves at a settlement tick and
 * delivers `DELIVERY_LEAD_TICKS` before it, so `DELIVERY_LEAD_TICKS > FREEZE_TICKS` is
 * exactly the condition that keeps every delivery outside the freeze — and therefore the
 * condition that lets `sealableRoles` decide sealability from the delivery tick alone.
 *
 * Called at construction, so a change to either constant fails loudly at start-up rather
 * than quietly turning every offered seal into a `CONTRADICTED` mark (A5′).
 */
export function assertSealSchedule(
  /**
   * Injected, defaulting to the real constants, for one reason: a guard nothing can make
   * fire is a guard no test can bite on, and a mutation proved it — with the comparison
   * flipped to something unsatisfiable, an `expect(...).not.toThrow()` on the healthy
   * world stayed green. The parameters are what let a test supply the violating pair.
   */
  lead: number = DELIVERY_LEAD_TICKS,
  freeze: number = FREEZE_TICKS,
): void {
  if (lead <= freeze) {
    throw new EngineError(
      `DELIVERY_LEAD_TICKS (${String(lead)}) must exceed FREEZE_TICKS ` +
        `(${String(freeze)}): a venture delivers DELIVERY_LEAD_TICKS before its settlement tick, and a ` +
        'delivery inside the freeze is skipped — which would leave every seal offered against it with no deed ' +
        'to honour it, and resolve it CONTRADICTED from an absence (A5′)',
    );
  }
}

/**
 * The election book's key.
 *
 * `::`, like every other composite key in this codebase. Three agents have reached for a
 * NUL byte here, after which `file(1)` reports the source as `data` and `grep` skips it
 * while every gate stays green.
 */
export function electionKey(venture: VentureId, roleIndex: number): string {
  return `${venture}::${String(roleIndex)}`;
}

/**
 * Refuse an `election` sent on a `sign`, rather than ignoring it.
 *
 * The election used to ride on `sign`, so this parameter shape is what a stale
 * `agent.md`, a cached prompt, or a model reasoning from either will produce. The three
 * things this handler could do with it:
 *
 *   1. **Ignore it.** The payer believes it has elected; nothing is recorded; silence is
 *      a decline; the settlement writes a `DECLINED` default — *"a deliberate refusal"* —
 *      permanently, publicly, against an agent that was trying to pay. That is A5′
 *      exactly, and it is the option a reasonable person implements by accident.
 *   2. **Honour it.** Two doors onto one concept (§3), and the choice is re-locked at
 *      signing, which is the whole thing `elect` exists to undo.
 *   3. **Refuse, before anything is written, naming the verb to use.** One action and
 *      one tick, inside a formation window of {@link FORMATION_WINDOW_TICKS}, against a
 *      permanent public lie. That is this.
 */
function electionOnSign(req: ActionRequest): Rejection | null {
  if (req.params['election'] === undefined && req.params['elect'] === undefined) return null;
  return reject(
    'PROP-V4',
    'the election does not ride on sign any more — it has its own verb. `sign` binds the terms; `elect` ' +
      'decides the payment, one role at a time, and you may restate it every tick until the freeze. Send ' +
      'sign without the election, then {"verb": "elect", "params": {"venture": "<id>", "role": N, ' +
      '"election": "IN_FULL"}}. Nothing was signed and nothing was elected: this is refused whole rather ' +
      'than signed with the election dropped, because a payer that believes it elected and did not is a ' +
      'payer the record will call a defaulter.',
  );
}

/**
 * The election book as a rollback-able, hashed table.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * The elections were **outside `state_hash` and outside the abort path** while they rode
 * on `sign`, and both halves matter more now that they are their own restatable verb:
 *
 *   - Outside the hash, two runs whose payers elected differently hash identically until
 *     the money moves at the Reckoning — so the sim's determinism check could not see
 *     the one agent-supplied value that decides whether tonight is a settlement or a
 *     default. The same omission is what `ledgerStateTable` was added for.
 *   - Outside the rollback, a tick that halts leaves an election behind that the
 *     replayed tick will write again. Benign today because a restatement is idempotent,
 *     and exactly the kind of "benign" that stops being so the moment the value is
 *     derived from anything.
 * ══════════════════════════════════════════════════════════════════════════
 */
export function electionsStateTable(
  read: () => Map<string, Election>,
  write: (restored: Map<string, Election>) => void,
): StateTable {
  return {
    name: 'election',
    capture: (): CanonicalValue =>
      [...read().keys()]
        .sort(compareIds)
        .map((key) => ({ key, election: read().get(key) ?? null })),
    restore: (captured: CanonicalValue): void => {
      const rows = snapArray(captured, 'election');
      const restored = new Map<string, Election>();
      for (const row of rows) {
        const record = snapObject(row, 'election row');
        const key = snapString(record, 'key', 'election row');
        const raw = record['election'];
        // `IN_FULL` is a string and an amount is an integer, which is how `Election`
        // discriminates them everywhere else — so the restore discriminates them the
        // same way rather than coercing, because an amount that happens to equal the
        // due is a different statement from IN_FULL.
        if (raw === IN_FULL) restored.set(key, IN_FULL);
        else restored.set(key, minor(snapInt(record, 'election', `election ${key}`)));
      }
      write(restored);
    },
  };
}

/**
 * The publishable half of a valuation.
 *
 * `reason` is carried, always, and it is the field that matters: `THIN_BOOK` and
 * `NO_INDEPENDENT_VOLUME` mean the good is worth **nothing** as a bond, and an agent
 * that saw a null price without the reason would read it as "not loaded yet" rather
 * than "this book cannot be trusted to price it". A2: genuine uncertainty stays
 * uncertain *and sourced*.
 */
function markOf(v: Valuation): Readonly<Record<string, unknown>> {
  return {
    unit_price: v.markUnitPrice,
    bondable_unit_price: v.bondableUnitPrice,
    reason: v.reason,
    window_ticks: v.rule.windowTicks,
    independent_qty: v.independentQty,
    independent_prints: v.independentPrints,
    distinct_pairs: v.distinctPairs,
    excluded_prints: v.excludedPrints,
  };
}

/** The settlement tick at or after `tick`. Settlement is the last tick of a day. */
export function nextSettlementAtOrAfter(tick: number): number {
  return tick + ticksUntilReckoning(tick) - 1;
}

/**
 * Parse a `trade` payload, accepting the spellings the rest of the game already
 * uses.
 *
 * The synonym list is not laxity — it is scar #1 avoidance. `observe/catalogue.ts`
 * already offers a `trade` affordance shaped `{at, good, qty, unit_price, side:
 * 'BUY'}`, `agent.md` and M1 both write `limit_price` and `location_id`, and the
 * §12.2 signature says `venue`. A parser that accepted only one of those would make
 * the server refuse the exact payload its own affordance handed the agent, which is
 * the engine and the agent-facing text disagreeing about one word.
 *
 * `BUY`/`SELL` normalise to `BID`/`ASK` for the same reason and one more: `BID` and
 * `ASK` are places on a book, `BUY` and `SELL` are what an agent means, and §3
 * lets one concept have one name in the engine while the door stays wide.
 *
 * `previous` is the order a `modify` replaces; every field it does not restate is
 * inherited, so changing a price cannot silently reset the quantity.
 */
function tradeRequestOf(
  params: Readonly<Record<string, unknown>>,
  previous: Order | undefined,
): TradeRequest {
  const rawSide = (readString(params, ['side']) ?? '').toUpperCase();
  const side: Side | null =
    rawSide === 'BID' || rawSide === 'BUY'
      ? 'BID'
      : rawSide === 'ASK' || rawSide === 'SELL'
        ? 'ASK'
        : (previous?.side ?? null);
  const rawTif = (readString(params, ['time_in_force', 'timeInForce', 'tif']) ?? '').toUpperCase();
  const timeInForce: TimeInForce | null =
    rawTif === 'IOC' ? 'IOC' : rawTif === 'GTC' ? 'GTC' : (previous?.timeInForce ?? null);
  return {
    operation: 'place',
    venue: (readString(params, ['venue', 'at', 'location', 'location_id', 'system']) ??
      previous?.venue ??
      null) as VenueId | null,
    good: (readString(params, ['good', 'good_id', 'type_id', 'item']) ?? previous?.good ?? null) as GoodId | null,
    side,
    quantity: readInt(params, ['quantity', 'qty', 'amount']) ?? previous?.quantity ?? null,
    limitPrice:
      readInt(params, ['limit_price', 'limitPrice', 'unit_price', 'price']) ?? previous?.limitPrice ?? null,
    durationTicks: readInt(params, ['duration_ticks', 'durationTicks']),
    timeInForce,
    order: readString(params, ['order', 'order_id']) as OrderId | null,
  };
}

function readString(params: Readonly<Record<string, unknown>>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

function readInt(params: Readonly<Record<string, unknown>>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  }
  return null;
}

function readEnum<T extends string>(
  params: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  allowed: readonly T[],
): T | null {
  const raw = readString(params, keys);
  if (raw === null) return null;
  return allowed.includes(raw as T) ? (raw as T) : null;
}

/** An error's text, with nothing of the host in it. */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message.split('\n')[0] ?? 'unknown';
  return 'unknown';
}

/** Re-exported so the API never has to reach into the ledger for a balance. */
export function freeStores(ledger: Ledger, principal: PrincipalId): Minor {
  const id = storesAccount(principal);
  return ledger.account(id) === undefined ? minor(0) : ledger.freeBalance(id);
}

export type { Bps, GoodId };
