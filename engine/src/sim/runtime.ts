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
  Standing,
} from '../core/types.js';
import { BPS_ONE, bps, minor, qty, sumMinor, type Bps, type Minor, type Qty } from '../core/units.js';
import { EventLedger, eventsStateTable, type NewEvent } from '../events/index.js';
import {
  CURRENCY_FAUCET,
  CURRENCY_SINK,
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
  type ObligationCapture,
  type ObligationRef,
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
  attributionStateTable,
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
import { hallOfFame, namesFor } from '../frames/memory.js';
import { readInt, readString } from '../core/params.js';
import { publishOffer } from '../say/offer.js';
import { say } from '../say/say.js';
import { sign } from '../venture/sign.js';
import { abandon } from '../venture/abandon.js';
import { withdraw } from '../venture/withdraw.js';
import { refine } from '../works/refine.js';
// `agent.md` §6's own field names for the Levy block, typed once in the observation
// layer. Imported as a type so this runtime fills the published shape rather than
// inventing a second one (§3).
import type { LevyBlock } from '../observe/sources.js';
import {
  SealBook,
  cmpDeeds,
  sealsStateTable,
  type Deed,
  type SealMeasure,
  type SealRoleRef,
  type SealWorldIndex,
} from '../seal/index.js';
import {
  Engine,
  EngineError,
  MAX_BUFFERED_EVENTS,
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
  bindingNote,
  computeProceeds,
  createVenture,
  drawResidual,
  electiveTotal,
  escrowRequired,
  filledIndices,
  IN_FULL,
  isEscrowable,
  isFullyFilled,
  kindSpec,
  minElectiveBps,
  NEUTRAL_STAGE_BPS,
  openIndices,
  partiesOf,
  pinnedAt,
  proceedsBand,
  readElectiveBps,
  roleOfPrincipal,
  roleTerms,
  roleTermsFor,
  ventureEscrowRatioBps,
  VentureBook,
  VENTURE_KINDS,
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
  freeCash,
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
// ── COMBAT (SPEC §9A, Phase 2) — THE ENGAGEMENT ─────────────────────────────
//
// The whole layer lives in `src/combat/`. What lands *here* is only the adapter: two state tables,
// one composition into the existing PREDATE handler, one verb, one `build` kind, one assertions
// entry, and one frame line set. `works/refine.ts`'s header states the reason this file gets no
// logic — three mechanical edits landed in the wrong place in it in one day and all three passed
// `tsc` — so every function below is a port constructor or a five-line dispatch.
import {
  Book as EngagementBook,
  DEFAULT_PRIMARY,
  ENGAGEMENT_TICKS,
  Fleet,
  HULL_COST_GOODS,
  HULL_NAMES,
  assertEngagementSchedule,
  assertWorldFleet,
  battleLinesFor,
  battleTickerLine,
  buildHull,
  buildHullRefusal,
  checkCombatInvariants,
  combatCoverage,
  engage,
  engageRefusal,
  engagementStateTable,
  engagementViewsFor,
  fieldControlOf,
  fleetStateTable,
  hullQuote,
  isEchelon,
  isPosture,
  isTargetPredicate,
  runBattles,
  type BattlePort,
  type EngagePort,
  type EngageRequest,
  type EngagementView,
  type HullId,
  type ShipyardPort,
  type TargetPredicate,
} from '../combat/index.js';
import {
  Book as RaidBook,
  DEMAND_RULE_STATEMENT,
  MAX_SEIZE_LOTS,
  RAID_DEMAND_QTY,
  RAID_JOIN_STAKE_MINOR,
  assertRaidSchedule,
  checkPredationInvariants,
  demandRefusal,
  demandsRemaining,
  openDemand,
  payDemand,
  raidLinesFor,
  raidStateTable,
  raidTickerLine,
  raidViewsFor,
  runPredate,
  scheduleAt,
  type AssailablePile,
  type DemandPort,
  type DemandRequest,
  type PredationPort,
  type RaidId,
  type RaidOutcome,
  type RaidRecord,
  type RaidSchedule,
  type RaidView,
} from '../predation/index.js';
import {
  MAX_FRAME_BATTLE_LINES,
  MAX_FRAME_CLAIM_LINES,
  MAX_RAID_LINES,
  type ClaimLine,
  type WorksLine,
  type SyndicateLine,
} from '../frames/contract.js';
import {
  ANCHOR_FUEL_BY_TIER,
  ANCHOR_QTY,
  Book as SovereigntyBook,
  CESSION_SALVAGE_BPS,
  CHARGE_BALLOT,
  CHARGE_GOOD,
  CHARGE_MISSES_TO_LAPSE,
  CHARGE_STATEMENT,
  CLAIM_BOND_MINOR,
  CLAIM_RENT_BPS,
  SOVEREIGNTY_STATEMENT,
  abandonRejection,
  assertSovereigntySchedule,
  assessCharge,
  bondAtRiskFor,
  bondRefFor,
  bondViewFor,
  cessionRejection,
  chargeBallotFor,
  chargeDeliveryFault,
  chargeDocketRowsFor,
  chargeVoteFault,
  checkChargeAttribution,
  checkSovereigntyInvariants,
  claimIdFor,
  claimLinesFor,
  claimRejection,
  claimTickerLine,
  claimRouteFor,
  claimViewsFor,
  handAt,
  isChargeRule,
  postedBondOf,
  requiredBondOf,
  settleCharge,
  sovereigntyStateTable,
  type BondView,
  type ChargeSettlement,
  type ClaimRecord,
  type ClaimView,
  type RentRead,
  type SlashPort,
} from '../sovereignty/index.js';
import type { ConstellationId, Grant, GrantId, RoleTerms, VentureKind } from '../core/types.js';
import {
  DEFENDER_SIDE,
  GRADUATION_STATEMENT,
  GRADUATION_UPKEEP_MINOR,
  GRADUATION_UPKEEP_QTY,
  createWorld,
  enroll,
  graduateHolding,
  graduationDestinations,
  graduationRejection,
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
 *
 * ## 4 → 5 (2026-07-26)
 *
 * **Seven books entered the hashed capture, and the record moved inside the hash that
 * covers it.** Five were the named ones — `StandingBook` (A10 reputation), the
 * `SealBook`, the obligation book INV-4 checks every lock against, the `EventLedger`,
 * and the attribution register — and two more (`mint`, `delivery`) were found by the
 * equivalence test once those five were in. All of them were in no state table, so
 * `state_hash` could not see them: an adopted checkpoint reproduced the hash *to the
 * byte* while the cast's `electiveHonoured` went `4, 6, 2, 4, …` → all zeros. This is
 * the third instance of the shape (money, then the `EncumbranceBook`, now standing),
 * and the one A5′ and A10 are actually about.
 *
 * Two changes here move the hash, and either would be enough on its own:
 *
 *   1. **New tables.** A table added to the capture changes `state_hash` at *every*
 *      tick, including ticks already journalled.
 *   2. **The record is written in DERIVE, not COMMIT.** With the `event` table in the
 *      hash, a row appended after the capture is a row outside the hash that claims to
 *      cover it — and the next tick's abort, which restores that snapshot, would
 *      truncate away rows this tick legitimately published. So the flush moved one
 *      phase earlier, into the slot immediately before `captureSnapshot`. The order of
 *      the rows did not change (DERIVE runs after OBLIGE, and nothing appends between
 *      DERIVE and COMMIT), but the tick at which the record's own counts enter the
 *      hash did.
 *
 * The live world therefore needs the operator divergence door
 * (`COMPACT_ACCEPT_DIVERGENCE_AT_TICK`) on the next deploy, exactly as it did at the
 * 1 → 2 boundary: boot will replay the journal, find the first tick whose recomputed
 * hash differs, and hold — which is the correct behaviour and the reason the door
 * exists. Crossing it deliberately is a record an auditor can read; crossing it by
 * pretending nothing moved is not.
 *
 * ## 5 → 6 (2026-07-26)
 *
 * **Sovereignty landed, and the claim book entered the hashed capture** (SPEC §6.3). One
 * change moves the hash and it is the first item of the 4 → 5 boundary again: a new state
 * table changes `state_hash` at **every** tick, including ticks already journalled. The
 * `sovereignty` table holds the claims, the per-system arrears counters and the bond lock
 * ids, and it is registered unconditionally for the reason the other eight are — an arrears
 * counter decides whether the *next* Reckoning takes a principal's territory and 50,000 of
 * its capital, so two worlds that disagree about it must never hash the same.
 *
 * **Nothing else moved, and that was measured rather than argued.** No phase gained a draw:
 * `assessChargeNow` and `settleChargeNow` are pure arithmetic over the book inside the
 * existing OBLIGE handler, and sovereignty asks the seeded RNG for nothing at all (there is
 * no band to draw from — `sovereignty/params.ts` explains why the Charge is a pure function
 * of tier and arrears). No existing verb's behaviour changed: `deliver`, `vote`,
 * `publish_offer` and `abandon` each dispatch on a **new** parameter and fall through to
 * exactly their old path when it is absent, so a journalled action replays identically. And
 * `world/commons.ts` gained one peaceful ballot kind, which can only *admit* an act that was
 * previously refused — no journalled action can have carried `{"ballot":"CHARGE"}`, because
 * nothing could produce one.
 *
 * Verified the way the `graduate` boundary was verified, in the other direction:
 * `sim --seed rulesv --ticks 200 --cast heuristic --principals 8` prints a per-tick
 * `state_hash` stream whose md5 is `c299f39f…` before this change and `2c3f0ec3…` after, and
 * **every one of the 200 ticks differs** — which is the signature of the hash's input set
 * growing rather than of a behaviour changing at some tick partway through. A behaviour change
 * would agree up to the tick it bit.
 *
 * So the live world needs the operator divergence door
 * (`COMPACT_ACCEPT_DIVERGENCE_AT_TICK`) on the next deploy, exactly as it did at 1 → 2 and
 * 4 → 5.
 *
 * ## 6 → 7 (2026-07-27)
 *
 * **`demand` landed — §9's agent-initiated standoff — and `RaidRecord` gained an `initiator`.**
 * The `raid` table was already registered and already hashed, so this is not a new table; it is
 * a **new field inside a hashed capture**, which moves `state_hash` at every tick that has any
 * raid row in it and at no other tick. That is a different signature from the 5 → 6 boundary
 * and the difference is worth naming, because it is how a reader tells the two apart in a
 * divergence report: a new table diverges *everywhere*, a new field diverges from the first
 * row onward.
 *
 * Three further changes move behaviour rather than only the hash, and each is deliberate:
 *
 *   1. **A repulsed or resolved raid writes the stage hold and the victim cooldown only when it
 *      is ownerless** (`grantWorldProtections`). Nothing journalled can be affected — before
 *      this commit every raid was ownerless, so the guard is true for every historical row —
 *      but it is a rule change and a replay of a *future* journal depends on it.
 *   2. **`Book.prune` takes the tick** and drops the current Reckoning's rows last, so a pruned
 *      demand cannot refund its raider's aggression capacity. Unreachable today (the cap is 96
 *      rows and one Reckoning cannot produce that many at the current cast size) and it is
 *      wired now because the alternative is an exploit whose only requirement is a bigger world.
 *   3. **`demand` is registered in the verb table**, so `classifyVerb` stops answering "not live
 *      yet" for a word `agent.md` has always listed.
 *
 * Demands use their own id namespace (`raid:<tick>:d<n>`) so an agent demanding on a world spawn
 * tick cannot collide with `raid:<tick>:0` — `spawnOne` calls `book.spawn` outside a try, so a
 * collision would have been an agent-reachable abort of a tick that had already moved hands.
 *
 * The live world therefore needs the operator divergence door
 * (`COMPACT_ACCEPT_DIVERGENCE_AT_TICK`) on the next deploy, as at 1 → 2, 4 → 5 and 5 → 6.
 *
 * ## 7 → 8 (2026-07-27)
 *
 * **Two owner decisions on `create`, and both change what a recorded action means.**
 *
 *   1. **A delegated `create` binds the grantor at formation** (`venture/create.ts`). `VentureRecord`
 *      gained `boundByGrant` — a new field inside the already-hashed `venture` capture, so the same
 *      *from the first row onward* signature as 6 → 7 — and, more importantly, a **behaviour** change:
 *      the creator is seeded into `countersigned`, so a journalled delegated `create` now produces a
 *      venture that activates on its counterparties' signatures alone. Every such venture in the
 *      record replays differently, including ones that historically expired unsigned.
 *   2. **`create` reads `elective_bps`** and refuses `roles`, `split`, `escrow_pct`, `elective_pct`
 *      and a malformed proportion. A create that says nothing about the proportion is priced exactly
 *      as before — `defaultTerms` is `roleTermsFor` at `f(kind)`, which is the same arithmetic, and
 *      that was checked term by term rather than assumed. But the journal contains at least one probe
 *      action that **sent** `elective_bps`, and that action was accepted-with-the-param-dropped and is
 *      now either honoured or refused. Either way it replays differently.
 *
 * So this boundary diverges for a *behavioural* reason as well as a structural one, which is worth
 * naming because it is the harder of the two to read in a divergence report: it will agree up to the
 * first delegated `create` in the record and disagree from there.
 *
 * The live world needs the operator divergence door (`COMPACT_ACCEPT_DIVERGENCE_AT_TICK`) on the next
 * deploy, as at 1 → 2, 4 → 5, 5 → 6 and 6 → 7.
 *
 * ## 8 → 9 (2026-07-27)
 *
 * **Territory pays, and the Frontier makes a good nowhere else does.** Both halves of `D23`'s
 * ranked correction, and this boundary is **structural at every tick with a WORKS in it and
 * behavioural from the first tick a claim stands over somebody else's WORKS.** Naming both, because
 * the two have different signatures in a divergence report and this boundary has one of each:
 *
 *   1. **Structural.** `WorksRecord` gained `rentPaid` and `fuelExtracted`, the `works` capture
 *      gained a `rent[]` tally and a `hot[]` row per system, and `ClaimRecord` gained `rentBps`.
 *      New fields inside already-hashed captures, so the 6 → 7 signature: divergence *from the
 *      first row onward* rather than everywhere. Measured on four seeds at 900 ticks — every
 *      economic number is byte-identical to 8 and only `state_hash` moves, which is the signature
 *      of the hash's input set growing rather than of behaviour changing partway through.
 *   2. **Behavioural, and only where a claim meets a tenant.** A claim-holder now takes
 *      `CLAIM_RENT_BPS` of every *other* principal's extraction at its system, and a FRONTIER
 *      system yields `FUEL_YIELD_PER_TICK.FRONTIER` of a second good. Both are value movements
 *      inside the PRODUCE phase, so a journal replays identically up to the first tick at which a
 *      live claim stood over a WORKS it did not hold, and differently from there. The live world
 *      has `claimLines: 0`, so today that tick does not exist in the record — but it is the tick to
 *      look for if a divergence report names one.
 *
 * **Nothing draws from the RNG and no phase gained a draw**, so no seeded sub-stream shifts: the
 * rent is a pure `trunc` over a share the yield cap already fixed, and the fuel yield is a tier
 * constant. **No event kind was added** — extraction is a routine tick and emits no event row
 * (`produceNow`), so the two new value movements appear as postings under new `event_id`s
 * (`works.rent:*`, `works.fuel:*`, `claim.fuel:*`) rather than as new ledger rows.
 *
 * One behaviour to state plainly because it *removes* an outcome rather than adding one: a FRONTIER
 * claim that is not fuelled collects **nothing**. That is a rule and not a failure — see
 * `ANCHOR_FUEL_BY_TIER` for why a cold anchor costs the income and never an arrears — and it means
 * a replayed frontier claim's income depends on fuel that was standing at the system at the tick,
 * which is journalled state rather than anything derived.
 *
 * The live world needs the operator divergence door (`COMPACT_ACCEPT_DIVERGENCE_AT_TICK`) on the
 * next deploy, as at 1 → 2, 4 → 5, 5 → 6, 6 → 7 and 7 → 8.
 */
/**
 * Bumped 9 → 10 by SPEC §9A (combat).
 *
 * **What forces the bump is the SNAPSHOT SHAPE, not a changed acceptance.** Two new state tables
 * (`engagement` and `fleet`) enter `capture()`, so every `state_hash` from this tick differs from
 * what the previous rules would have produced, and the operator door
 * (`COMPACT_ACCEPT_DIVERGENCE_AT_TICK`) has to be told once.
 *
 * **What this bump deliberately does NOT do is change whether any action shape that has ever been
 * submitted is accepted.** That distinction matters because venture ids are
 * `hash(tick, principal, ordinal)` over a world-global counter, so one action refused under changed
 * rules shifts the ordinal and renames every venture minted afterwards, permanently. Combat is the
 * largest rules change this project has made, and it is ordinal-neutral by construction:
 *
 *   - `engage` is a **new** verb. Nothing has ever submitted one, so nothing past changes.
 *   - `build {kind:"HULL"}` is a **new** kind. It was refused before and is accepted now, but no
 *     historical action carried it, so no historical acceptance moves.
 *   - `flee` left the canon, and it had **no handler**: every `flee` was already refused, and it is
 *     still refused. The rejection's wording changed; its outcome did not.
 *
 * So this adds a declared discontinuity of the *hash* kind and none of the *identity* kind.
 */
export const RULES_VERSION = 10;

/**
 * Read a formation's ordered target predicates, tolerating a list or a delimited string.
 *
 * Free-standing rather than a method for `refine.ts`'s reason: it is a function of its input and
 * touches no world state, so a reviewer can see that it cannot do anything else. The default is
 * §7 MUST-7's competent one (*"CUT timeout paralysis"*) — kill the force multipliers first — because
 * an agent that omits this field must still fight sensibly.
 */
function readPredicates(params: Readonly<Record<string, unknown>>): readonly TargetPredicate[] {
  const raw = params['primary'] ?? params['primary_policy'] ?? params['target_policy'];
  const out: TargetPredicate[] = [];
  const push = (value: string): void => {
    const upper = value.toUpperCase();
    if (isTargetPredicate(upper) && !out.includes(upper)) out.push(upper);
  };
  if (Array.isArray(raw)) {
    for (const entry of raw) if (typeof entry === 'string') push(entry);
  } else if (typeof raw === 'string') {
    for (const entry of raw.split(/[,\s]+/)) if (entry !== '') push(entry);
  }
  return out.length > 0 ? out : DEFAULT_PRIMARY;
}

/** Read a fit's module list, tolerating a list or a delimited string. Order-independent downstream. */
function readModules(params: Readonly<Record<string, unknown>>): readonly string[] {
  const raw = params['modules'] ?? params['fit'] ?? params['loadout'];
  const out: string[] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) if (typeof entry === 'string') out.push(entry.toUpperCase());
  } else if (typeof raw === 'string') {
    for (const entry of raw.split(/[,\s]+/)) if (entry !== '') out.push(entry.toUpperCase());
  }
  return out;
}

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
import {
  Book as SyndicateBook,
  syndicateAsPrincipal,
  syndicateStateTable,
  type SyndicateId,
} from '../syndicate/book.js';
import { CHARTER_STATEMENT, parseCharter } from '../syndicate/charter.js';
import {
  FOUNDING_COST_MINOR,
  MAX_SYNDICATES_PER_PRINCIPAL,
  PROPOSAL_TTL_TICKS,
} from '../syndicate/params.js';
import { Book as WorksBook, worksStateTable } from '../works/book.js';
import { produce as produceNow } from '../works/produce.js';
import { checkWorks } from '../works/invariants.js';
import { rentApplies, rentOn, type RentTerms } from '../works/rent.js';
import {
  FUEL_GOOD,
  FUEL_YIELD_PER_TICK,
  WORKS_BUILD_QTY,
  WORKS_COST_MINOR,
  WORKS_GOOD,
  WORKS_YIELD_GOOD,
  WORKS_SPINUP_TICKS,
  YIELD_PER_TICK,
} from '../works/params.js';

/** INV-26: raid ticker lines retained for the frame. Bounded, published. */
export const MAX_RAID_TICKER_LINES = 32;

/** Ticks a formation window stays open by default. */
export const FORMATION_WINDOW_TICKS = 12;

/** Bound on every agent-written text buffer (INV-26, scar #3). */
export const MAX_TALK_ENTRIES = 512;

/**
 * Counterparties a cast member is reminded of. *(calibrate)*
 *
 * Small on purpose. The point is *"you have dealt with these people and here is how it went"*, not a
 * ledger — and the prompt's existing problem is length, so an unbounded history would crowd out the
 * observation it is supposed to give context to.
 */
/**
 * How many `grant` offers a single observation shortlists.
 *
 * Lives here rather than in `api/observe.ts` because {@link Runtime.grantCandidates} is now the one
 * home for the eligibility rule, and `sim/` importing from `api/` would invert the layering the way
 * `ledger/` importing from `levy/` did.
 */
export const MAX_GRANT_OFFERS = 2;

export const MAX_RELATIONS = 6;
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
/**
 * How many principals a creator may name in its preference order.
 *
 * §7.3 resolves a contested slot by "the initiator's stated preference order", and
 * `allocation.ts` already honours it as the FIRST tiebreak — ahead of stake and ahead of id.
 * The field was on `VentureRecord` and on `CreateVentureInput` from the start; `create` simply
 * never read it from request params, so the mechanism was built, specified and unreachable.
 *
 * Bounded because every list in this engine is (INV-26). Small, because a preference order longer
 * than the venture has roles is expressing nothing.
 */
export const MAX_VENTURE_PREFERENCE = 8;

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
  private liveFrom = -1;

  constructor(private readonly windowTicks: number = CENSUS_WINDOW_TICKS) {}

  /**
   * Mark where **live play** starts, and forget everything before it.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **REPLAY POISONS THE CENSUS, AND THAT MADE THE SCAR #14b ALARM CRY WOLF.**
   * Boot replays the action log to rebuild the world, and every replayed decision is
   * recorded here — correctly, because it *did* happen. But the health floor asks a
   * question about *now*: "are the expensive players actually deciding?" Measured after a
   * real deploy at tick 4142: the window held 1,960 replayed HEURISTIC decisions against
   * 330 LIVE, so the deciding share read 1,441 bps against a 2,500 floor and `/health`
   * reported the world unhealthy **while the cast was demonstrably spending money.**
   *
   * The absolute-tick warmup could not catch it: `tick >= warmup` is long true by the time
   * a mature world restarts. So the census is told where live play begins, and the floor
   * is judged on live ticks only. Left alone this would have gone red for roughly five
   * hours after every deploy — and an alarm that is red while nothing is broken is how
   * scar #14b happened in the first place: a signal nobody reads.
   * ══════════════════════════════════════════════════════════════════════════
   */
  beginLivePlay(tick: number): void {
    this.liveFrom = tick;
    for (const t of [...this.byTick.keys()]) if (t < tick) this.byTick.delete(t);
  }

  /** The tick live play began, or -1 if it never was marked (a fresh world). */
  get liveFromTick(): number {
    return this.liveFrom;
  }

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
    for (const [t, row] of this.byTick) {
      if (t < this.liveFrom) continue;
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
/**
 * **The priced exit from the Commons, as one inert value** (§4.1, §6.3, A8, A15).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ONE HOME, THREE READERS: the `graduate` affordance in `api/observe.ts`, the
 * `holding` block of the observation, and {@link Runtime.vGraduate} itself. Three copies
 * of "what does the crossing cost and what travels with me" is three chances for the
 * server to quote a price it then does not charge — and this is the single most
 * consequential decision a newcomer makes, so a wrong number here is worse than a
 * missing one. `test/world/graduation.spec.ts` pins the quote to what the verb charges.
 * ══════════════════════════════════════════════════════════════════════════
 */
export interface GraduationQuote {
  readonly from: SystemId;
  readonly fromTier: ZoneTier;
  /** Adjacent MARCHES/FRONTIER systems, canonical order. Empty is a legitimate answer. */
  readonly open: readonly SystemId[];
  readonly upkeepMinor: Minor;
  readonly upkeepQty: Qty;
  /** The manufactured good the upkeep is paid in. Named here, not in the world layer. */
  readonly good: GoodId;
  /** Free (unlocked) currency in STORES right now. */
  readonly freeMinor: Minor;
  /** Unpledged, `AVAILABLE` units of {@link good} this principal holds anywhere. */
  readonly availableQty: Qty;
  /**
   * Units standing **at the current seat** that would travel with the body — and become
   * assailable the moment it lands. This is the contingent half of the price and it is
   * the number `max_contingent_liability` carries.
   */
  readonly travellingQty: Qty;
  /**
   * Units at the current seat that would **stay behind**, because a pledged lot backs an
   * obligation and `lots.ts` is explicit that it "cannot be sent away". Stated rather
   * than silently dropped: an agent that meant to take its goods with it is entitled to
   * know which of them are not coming and why.
   */
  readonly pledgedQty: Qty;
  /** False when either half of the price cannot be met right now. */
  readonly affordable: boolean;
  /**
   * Live claims of this principal's that a departure would strand — **the fourth reader
   * of INV-8**, and the reason it is here rather than in the verb.
   *
   * INV-8 states the rule in its own violation message: *"a claim is anchored by a body;
   * a claim with no body behind it is territory nobody is standing on"*. Nothing enforced
   * it. `graduate` stayed offered after `build` took a claim, so an agent copying two
   * consecutive affordances verbatim moved its holding out from under its own territory
   * and **halted the world** — an invariant abort is the correct response to a broken
   * tick (§15.4 fails closed), which made this a total denial of service reachable by
   * playing legally. A4 is emphatic that throughput must not be power; an ordinary act
   * that stops the galaxy is the same bug with the sign flipped.
   *
   * Empty for the overwhelming majority of principals, and non-empty only for one that
   * has taken territory — which is exactly when it must not silently vanish.
   */
  readonly anchoring: readonly SystemId[];
}

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
        // A6's provenance: the grant that stood in for the creator's countersignature. Captured
        // because a restore that forgot it would rebuild the venture UNBOUND — the creator dropping
        // out of `countersigned`, `activate` refusing a venture that was already live, and the
        // authority line under-stating what a delegate has committed. `boundByGrant` is not in
        // `terms_hash` (the terms are the same terms), so the hash witness cannot catch it and the
        // capture has to carry it explicitly.
        boundByGrant: v.boundByGrant,
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
    // Rebuilt through the constructor rather than written back afterwards, so the restored row's
    // `countersigned` is seeded by the same `boundAtFormation` call the live path used. Writing the
    // field and then the signature set separately would be two homes for one fact.
    boundByGrant: snapStringOrNull(o, 'boundByGrant', where) as GrantId | null,
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

/**
 * Terms for a kind at the kind's own elective floor — what `create` prices when the creator names no
 * proportion.
 *
 * The arithmetic moved to `venture/terms.ts:roleTermsFor`, which takes the proportion `create` now
 * accepts. This stays as the *default*, because that is a different fact from the pricing rule and it
 * is read in three places (the probe quotes in `api/observe.ts`, the CLI's table, and here). A wrapper
 * rather than a re-export so the name keeps saying "the default" while the pricer says "at this
 * proportion".
 */
export function defaultTerms(kind: VentureKind, value: Minor): readonly RoleTerms[] {
  return roleTermsFor(kind, value, minElectiveBps(kind));
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
  /**
   * INV-17's index, behind a getter because the rollback **replaces** it — the same
   * shape as `ventureBook` and `grantBook`, and for the same reason: the register has
   * no removal door and must not grow one, so undoing an aborted tick's attribution
   * means restoring into a fresh register.
   */
  private registerRef = new DefaultRegister();
  /** The only writer of standing (§6.4, INV-21). */
  readonly standing = new StandingBook();
  /**
   * This tick's rows on their way to the record, flushed in `DERIVE`.
   *
   * **Why the runtime holds this rather than the engine.** `Engine` buffers `ctx.emit`
   * and flushes at COMMIT, which is *after* DERIVE — and DERIVE is where `state_hash`
   * is taken. With the record inside the hash that ordering is unusable: the snapshot
   * for tick T would describe a ledger the world no longer holds by the end of T, and
   * the abort at T+1 (which restores T's snapshot) would truncate away rows tick T had
   * legitimately published. So every row this runtime writes goes into the record
   * *before* the hash that claims to cover it, in the same slot and the same order it
   * used to reach the ledger in — DERIVE runs after OBLIGE and nothing between DERIVE
   * and COMMIT appends.
   *
   * Nothing is published earlier as a result: an aborted tick's rows are removed by
   * the `event` table's restore, which is the same inverse `ledgerStateTable` uses for
   * the posting log. Bounded by {@link MAX_BUFFERED_RECORD_ROWS} (INV-26).
   */
  private readonly pendingRecord: NewEvent[] = [];
  /** INV-4's input: which obligations may still hold a lock. */
  readonly obligations = new SimpleObligationBook();
  readonly engine: Engine;
  readonly census = new DecisionCensus();
  /** The WORKS book. Swapped wholesale on restore, like every other hashed book. */
  private worksBook = new WorksBook();
  /** The syndicate book. Swapped wholesale on restore, like every other hashed book. */
  private syndicateBook = new SyndicateBook();
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
   * The engagement book (SPEC §9A). Replaced wholesale by the rollback — see {@link Runtime.battles}.
   */
  private engagementBookRef = new EngagementBook();

  /**
   * The fleet book (SPEC §9A): which HULLS exist and which are wrecks. Replaced by the rollback.
   */
  private fleetRef = new Fleet();

  /**
   * The claim book (SPEC §6.3). Replaced wholesale by the rollback, so nothing may hold a
   * reference across a tick boundary — see {@link Runtime.sovereignty}.
   */
  private sovereigntyBookRef = new SovereigntyBook();
  /** The Reckoning whose Charge has been minted. Assessing twice is refused, not silent. */
  private chargeAssessedReckoning = -1;
  private chargeOutcome: ChargeSettlement | null = null;
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
   * The battle ticker (§9A, §14.5). A **second ring, not a share of the raid one.**
   *
   * A standoff and the battle inside it are two objects with two pixel signatures, and one ring
   * would let a busy Reckoning of raids push every battle line out of the export surface — or the
   * reverse. Bounded by the same published cap for the same reason (INV-26).
   */
  private readonly battleTicker = new Ring<string>(MAX_RAID_TICKER_LINES);

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
    // The engagement clock must fit inside the demand window it is fought in, or a raid resolves
    // while its battle is still running and the force reading counts hands a wreck already took off
    // the board. Asserted at construction rather than in a test, because a schedule only a test
    // checks is a schedule that ships broken the first time a phase is tuned.
    assertEngagementSchedule();
    // And that the world can actually field its fleet. A separate call because `params.ts` holds the
    // fit and `fit.ts` holds the simulator: an illegal WORLD_FLEET_FIT means every world raid answered
    // FIGHT faces an empty field, which is A14 failing in the exact silent way this layer prevents.
    assertWorldFleet();
    // And a third: a vulnerability window that opened inside §5.1's freeze could only be
    // honoured illegally or dropped, and a claim changing hands mid-settlement moves two
    // principals' currency after the Reckoning froze the figures it was computed from. A
    // clock that makes the published window unplayable must not start a world (A5′).
    assertSovereigntySchedule();
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
        // Combat. Both books decide which ASSETS get destroyed, so a hash blind to either would
        // call two worlds identical while one of them was about to wreck a warship — and an aborted
        // tick would leave a hull marked WRECKED against goods destruction that was rolled back,
        // which is A5′ (the record must never be wrong) with somebody's fleet in it. Registered
        // from this module's first commit for the reason `sovereignty` states: seven books were
        // found outside the hash in one night. There is no eighth, and there is no ninth.
        engagementStateTable(
          () => this.engagementBookRef,
          (book) => {
            this.engagementBookRef = book;
          },
        ),
        fleetStateTable(
          () => this.fleetRef,
          (fleet) => {
            this.fleetRef = fleet;
          },
        ),
        // Sovereignty. An arrears counter decides whether the NEXT Reckoning takes a
        // principal's territory and slashes 50,000 of its capital, and a bond lock id is the
        // only thing that says which capital is at risk — so a hash blind to this book would
        // call two worlds identical while one of them was about to do that, and an aborted
        // tick would leave a credited Charge delivery or a half-slashed bond behind.
        //
        // Registered from this module's first commit, and the reason is measured rather than
        // argued: seven books were found outside the hash in one night, one of them
        // StandingBook, and the symptom was a snapshot that matched byte-for-byte while
        // reputation silently reset. There is no eighth.
        // The WORKS book decides how many goods enter the world every tick, so it is inside
        // the hash and the abort path for the same reason the EncumbranceBook had to be:
        // two worlds that disagree about who is extracting what must never hash the same.
        // Pooled stores decide who may spend what, so the book that records the constitution has
        // to be inside the hash and the abort path — an aborted tick must not leave a syndicate
        // founded, and two worlds that disagree about a charter must never hash the same.
        syndicateStateTable(
          () => this.syndicateBook,
          (book) => {
            this.syndicateBook = book;
          },
        ),
        worksStateTable(
          () => this.worksBook,
          (book) => {
            this.worksBook = book;
          },
        ),
        sovereigntyStateTable(
          () => this.sovereigntyBookRef,
          (book) => {
            this.sovereigntyBookRef = book;
          },
        ),
        // ══════════════════════════════════════════════════════════════════════
        // THE FIVE BOOKS THAT WERE IN NO TABLE.
        //
        // A snapshot carries the state tables and `state_hash` hashes exactly those,
        // so a book outside them is **neither carried nor missed**. Measured on a
        // 600-tick run adopting the checkpoint at tick 575: the adopted world's hash
        // equalled the genesis-replayed hash to the byte and every balance agreed,
        // while the cast's `electiveHonoured` went 4, 6, 2, 4 … → all zeros. A wrong
        // boot that passes its own integrity check is worse than a slow one.
        //
        // This is the third instance of the shape. Money was outside the hash; the
        // `EncumbranceBook` was outside it, so no snapshot carried an open lock and
        // escrowed stake was silently spendable; now the record of who kept their
        // word. Each of the five below is registered with a restore, because a
        // hash-only table attests to a book without being able to put it back — which
        // is exactly the shape that lets an adoption look verified while dropping the
        // contents (`missingCheckpointTables` counts one as missing).
        // ══════════════════════════════════════════════════════════════════════
        //
        // A10 and A5: the permanent public record of promises kept and broken. This
        // one is the reason the other four are here — reputation resetting silently
        // is the exact thing A10 says never happens.
        {
          name: 'standing',
          capture: () => this.standing.capture(),
          restore: (captured) => {
            this.standing.restore(captured);
          },
        },
        // §11 and §14: sealed intentions and their verdicts. Two worlds that disagree
        // about what an agent promised must never hash the same, and an aborted tick
        // must not keep the seal it accepted.
        sealsStateTable(() => this.seals),
        // INV-4's input. An empty obligation book turns every open encumbrance into an
        // orphan lock and halts the first tick after boot — so this book being outside
        // the snapshot was not only a hash gap, it was the reason an adopted world
        // stopped.
        {
          name: 'obligation',
          capture: () => this.obligations.capture(),
          restore: (captured) => {
            this.obligations.restore(readObligationCapture(captured));
          },
        },
        // The append-only public record. Counts, not contents — the same treatment
        // and the same argument as `ledgerStateTable`'s `postingCount`: the rows are
        // immutable, truncation to a captured length is an exact inverse, and
        // re-listing a season of payloads in every snapshot would make the hash input
        // grow without bound while attesting to nothing the counts do not pin.
        //
        // The restore also drops anything this tick had queued for the record, which
        // is the half a truncation alone cannot do: an aborted tick's drafts have not
        // reached the ledger yet, and leaving them in the queue would publish them
        // into the *next* tick, at a tick number the ledger's watermark refuses.
        withRecordQueueCleared(eventsStateTable(() => this.events), () => {
          this.pendingRecord.length = 0;
        }),
        // INV-17's register: the evidence behind every accusation. A world that lost
        // it would find every published default unattributed (A5′, the top
        // engineering risk), and a world that kept an aborted tick's attribution would
        // hold evidence for an event nobody published.
        attributionStateTable(
          () => this.register,
          (restored) => {
            this.registerRef = restored;
          },
        ),
        // ── AND TWO THE EQUIVALENCE TEST FOUND, WHICH NOBODY HAD NAMED ────────
        //
        // Registering the five books above made adopt-plus-tail reproduce the
        // checkpoint exactly and then diverge on the FIRST tick after it — in
        // `ledger` and `venture`, over an id. These two are why, and they are here
        // because the measurement said so rather than because a list did. That is
        // also the honest reading of `CHECKPOINT_REQUIRED_TABLES`'s own warning that
        // a hand-maintained manifest under-reports by construction.
        {
          // The id minters. `v:576:485d0ad6` vs `v:576:44358a2f` — same tick, same
          // creator, different stamp, because the stamp hashes an ordinal that an
          // adopted world restarts from zero. Two ids for one thing is the whole
          // failure: escrow accounts, `terms_hash`, every posting and every event
          // family carry the id, so a world that re-mints them is a world whose
          // permanent record names ventures that never existed. `hydrate.ts` named
          // the grant half of this as a known gap; the venture half was unnamed.
          name: 'mint',
          capture: () => ({ venture: this.ventureCounter, grant: this.grantCounter }),
          restore: (captured) => {
            const root = snapObject(captured, 'mint');
            this.ventureCounter = snapInt(root, 'venture', 'mint');
            this.grantCounter = snapInt(root, 'grant', 'mint');
          },
        },
        {
          // Deliveries: the deed set's only source, and the pinned pot a deferral's
          // second pass divides (§15.3). Losing it is two failures at once — a
          // Reckoning whose deed set is empty defers every seal and marks nobody, and
          // a deferred venture re-quotes proceeds that `guardProgressFitsClaims`
          // correctly halts on.
          name: 'delivery',
          capture: () => deliveryCapture(this.deliveries),
          restore: (captured) => {
            const rows = readDeliveryCapture(captured);
            this.deliveries.clear();
            for (const row of rows) this.deliveries.set(row.venture, row);
          },
        },
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
      // ── THE COMMIT SINK IS A TRIPWIRE NOW, NOT THE WRITER ──────────────────
      //
      // Every row this runtime writes goes through `emitRow` and reaches the record in
      // DERIVE, inside the `state_hash` that covers it. Nothing calls `ctx.emit` any
      // more, so this sink should never fire; if it does, a new call site is emitting
      // through the engine's buffer and its rows would land *after* the hash — the
      // exact ordering that makes the record unrestorable. Reported rather than
      // appended, because appending here would put the ledger out of step with the
      // snapshot and the next abort would truncate a published row.
      events: (drafts, tick) => {
        this.faults.push(
          `${String(drafts.length)} row(s) reached the COMMIT sink at tick ${String(tick)} ` +
            `(${drafts.map((d) => d.kind).join(', ')}); the record is written in DERIVE and a row ` +
            'emitted through the engine buffer would land outside the hash that claims to cover it',
        );
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
          // ── BATTLES BEFORE RAID RESOLUTION, AND THE ORDER IS THE WHOLE COUPLING ──
          //
          // §9A couples into §9 through **hands and nothing else**: a wrecked hull sends its hand
          // to RECOVERING, and `readForce` counts hands *at resolution* — its own doc says "a
          // joiner counts only while its hand is still standing there". So a side that loses the
          // battle loses the force reading automatically, with zero change to §9's arithmetic.
          //
          // That only holds if the battle's last tick runs BEFORE the raid resolves, which is why
          // this is a composition rather than a second phase. Adding a phase would change the set
          // of `Rng.derive(phase)` labels and therefore every seeded draw in the world
          // (`tick/phases.ts` says so at length); composing inside PREDATE changes none of them,
          // because a phase's sub-stream is per-phase and this draws from PREDATE's own.
          this.battlesNow(ctx);
          this.predateNow(ctx);
        },
        MARKETS: (ctx) => {
          this.clearMarketsNow(ctx);
        },
        // ── PRODUCE, and the slot is the rule ──────────────────────────────
        //
        // The third of the three no-op hooks reserved in commit #1, cashed on the same
        // terms as MARKETS and PREDATE: filling it shifts no other phase's seeded
        // sub-stream, and nothing here reads the clock or the RNG at all — extraction is
        // a pure function of the map, the book and the tick.
        //
        // It runs AFTER markets clear (§15.2's clear-before-produce) so a principal
        // cannot see this tick's clearing price and then decide what to make.
        PRODUCE: (ctx) => {
          this.produceNow(ctx);
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
          // ── THE CHARGE, AND THE ORDER IS THE RULE AGAIN ────────────────────
          //
          // `assessChargeNow` first, for `assessLevyNow`'s reason: a world booting mid-cycle
          // must be assessed before ASSERT asks whether every claim carries a verdict.
          //
          // `settleChargeNow` LAST of everything in this phase. A lapse slashes a bond, which
          // retires currency out of a principal's stores — and `reckoning/driver.ts`
          // re-reads every payer's free balance between the freeze and the settlement and
          // halts on any difference in either direction. Slashing before the venture batch
          // would pause a healthy world on the one tick that has an audience (A14). After the
          // Levy's sweep too, so the two world obligations settle in a stated order rather
          // than an incidental one: the Levy's goods first, then sovereignty's territory.
          this.assessChargeNow(ctx);
          this.settleChargeNow(ctx);
        },
        // ── DERIVE, and the slot is the rule ────────────────────────────────
        //
        // The record is written here, in the phase whose handler runs immediately
        // before `captureSnapshot`. That is not a convenience: with the `event` table
        // in `state_hash`, a row appended after the capture is a row outside the hash
        // that claims to cover it, and the snapshot would describe a ledger the world
        // stops holding one phase later. `test/tick/determinism.test.ts` states the
        // general rule ("nothing written after DERIVE is inside the hash it claims to
        // be in"); this is that rule obeyed rather than worked around.
        DERIVE: (ctx) => {
          this.flushRecord(ctx.tick);
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
        // OPS-1..7. Not registry entries — see `combat/invariants.ts` on why the 26 stay 26 — but
        // merged into the same ASSERT pass and halting on the same terms. OPS-1 is A5′ with a
        // warship in it (one hull, one fight, or a second wreck destroys an asset that was already
        // gone) and OPS-5 is §9's "nobody owns them, so nobody can be bribed" applied to the
        // world's fleet as well as to its raids.
        (tick) => this.combatViolations(tick),
        // SOV-1..7 plus the A5′ attribution guard. Not registry entries — see
        // `sovereignty/invariants.ts` on why the 26 stay 26 — but merged into the same ASSERT
        // pass and halting on the same terms. SOV-1 is A8 (a claim in the Commons halts the
        // world) and `checkChargeAttribution` is A5′: an arrears is an accusation that ends
        // in taken territory and a slashed bond, so it is held to INV-17's standard —
        // reproducible from the delivery journal by a second road, or the tick halts.
        (tick) => this.sovereigntyViolations(tick),
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

  /**
   * INV-17's register. Never held across a tick boundary: the rollback replaces it.
   *
   * Read through the accessor for the same reason the venture and grant books are: an
   * aborted tick's attribution must not survive, and the only way to remove one from a
   * register whose single door is `attribute` is to restore into a fresh register.
   */
  get register(): DefaultRegister {
    return this.registerRef;
  }

  /** The grant book (A6). Never held across a tick boundary: the rollback replaces it. */
  get grants(): GrantBook {
    return this.grantBook;
  }

  /** The Levy's book. Never held across a tick boundary: the rollback replaces it. */
  get levy(): LevyBook {
    return this.levyBookRef;
  }

  // ── SOVEREIGNTY (SPEC §6.3, the Charge) ───────────────────────────────────

  /** The claim book. Never held across a tick boundary: the rollback replaces it. */
  get sovereignty(): SovereigntyBook {
    return this.sovereigntyBookRef;
  }

  /** What the last Charge settlement did, or `null` before the first one. */
  get chargeSettlement(): ChargeSettlement | null {
    return this.chargeOutcome;
  }

  /**
   * The narrow port {@link postedBondOf} reads bond amounts through.
   *
   * The ledger is the one home for what a lock holds (`sovereignty/bond.ts`), and this is the
   * only road to it. A cached amount in the claim book would go on reporting a bond the world
   * had already reduced, and the claim would look backed while nothing stood behind it.
   */
  private bondRead(): (id: string) => Minor | null {
    return (id) => this.ledger.encumbrances.get(id)?.amountMinor ?? null;
  }

  /**
   * Unpledged, `AVAILABLE` units of the Charge good standing **at one system**.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **LOCATION-STRICT, AND THAT IS THE WHOLE LOCALITY ENFORCEMENT.** `levyGoodAvailable` is
   * location-*blind* on purpose — a Levy delivery may draw from anywhere the payer holds,
   * because the Levy's presence requirement is about the hand. The Charge's requirement is
   * about the **goods**: `DRAFT-2-synthesis.md` §2 makes a goods Charge defensible only if
   * "goods must arrive from outside the claimed system", and the economic critic's numeric
   * exploit is exactly what happens if this filter is missing — *"store 1,000,000 rations in
   * the core, park one hand at the frontier, pay a 10,000 Charge, the whole lot relocates and
   * 990,000 appears behind the blockade."*
   *
   * Nothing in the Charge path calls `relocate`, so nothing can teleport: the lots that pay
   * are the lots that were already there, and they are destroyed where they stand.
   * ══════════════════════════════════════════════════════════════════════════
   */
  chargeGoodAt(principal: PrincipalId, system: SystemId): Qty {
    let total = 0;
    for (const lot of this.chargeGoodLotsAt(principal, system)) total += lot.qty;
    return qty(total);
  }

  /**
   * Unpledged lots of one good this principal holds AT a system, canonical order.
   *
   * Generalised from `chargeGoodLotsAt` when `refine` needed the same query for a different good.
   * Parameterised rather than copied: "which lots may I spend here" is one rule, and a second copy is
   * the shape that lets two callers disagree about `encumbranceId` or `AVAILABLE` (scar #5).
   */
  private goodLotsAt(
    principal: PrincipalId,
    system: SystemId,
    good: GoodId,
  ): readonly { readonly id: LotId; readonly qty: number }[] {
    const account = storesAccount(principal);
    if (this.ledger.account(account) === undefined) return [];
    return this.ledger
      .lotsInAccount(account)
      .filter(
        (lot) =>
          lot.good === good &&
          lot.qty > 0 &&
          lot.state === 'AVAILABLE' &&
          lot.encumbranceId === null &&
          lot.location === system,
      )
      .sort((a, b) => compareIds(a.id, b.id))
      .map((lot) => ({ id: lot.id, qty: lot.qty }));
  }

  /** The sovereignty Charge's view of the same query. One home, one caller each. */
  private chargeGoodLotsAt(
    principal: PrincipalId,
    system: SystemId,
  ): readonly { readonly id: LotId; readonly qty: number }[] {
    return this.goodLotsAt(principal, system, CHARGE_GOOD);
  }

  /** Live claims this principal holds, priced, with deadline and consequence. */
  claimsFor(principal: PrincipalId, tick = this.engine.tick): readonly ClaimView[] {
    return claimViewsFor(this.claimViewPort(tick), principal, this.sovereignty.claimsOf(principal));
  }

  /**
   * Claims a principal does **not** hold but could act on: for sale, or contestable now.
   *
   * Published because the rescue and the fire sale are half the collapse arc, and neither
   * happens if nobody can find the claim that is failing. Everything on the row is public
   * legal state — `view.ts` argues each field — so this is not a scouting oracle: a reader
   * learns that a claim is in arrears, which the record published on the night it happened.
   */
  claimsOpenTo(principal: PrincipalId, tick = this.engine.tick): readonly ClaimView[] {
    const open = this.sovereignty
      .liveClaims()
      .filter((c) => c.claimant !== principal && claimRouteFor(this.sovereignty, c.system, tick) !== null);
    return claimViewsFor(this.claimViewPort(tick), principal, open);
  }

  private claimViewPort(tick: number): Parameters<typeof claimViewsFor>[0] {
    return {
      book: this.sovereignty,
      tick,
      tierOf: (system) => tierOf(this.world.map, system),
      availableAt: (principal, system) => this.chargeGoodAt(principal, system),
      handAt: (principal, system) => handAt(this.world, principal, system, tick) !== null,
      rentAt: (system, claimant) => this.rentReadAt(system, claimant, tick),
      bondRead: this.bondRead(),
    };
  }

  // ── THE RENT: ONE HOME FOR "WHO TAKES A SHARE HERE, AND WHAT HAVE THEY TAKEN" ──
  //
  // Three readers — the PRODUCE phase (which moves the goods), the claim view an agent reads, and
  // the claim line a viewer reads — and they must never disagree, because the first is the ledger
  // and the other two are the promise about it (scar #1). So the terms and the tally each have
  // exactly one accessor, and every reader goes through it.

  /**
   * The published terms of tenancy at a system, or null on unclaimed ground.
   *
   * Off the claim RECORD, so the rate is the one the claim was raised under. A terminal claim
   * (`LAPSED` / `CEDED`) takes nothing: `liveAt` filters those, and that is the whole rule — a
   * landlord that lost the ground stops being paid the same tick, with no scheduled hook.
   */
  rentTermsAt(system: SystemId): RentTerms | null {
    const claim = this.sovereignty.liveAt(system);
    if (claim === null) return null;
    return {
      claimant: claim.claimant,
      bps: claim.rentBps,
      // A TIER fact, read live, unlike the rate — `RentTerms.fuelWant` states the distinction: the
      // rate is a term a resident relied on, the fuel is the landlord's own cost.
      fuelWant: ANCHOR_FUEL_BY_TIER[tierOf(this.world.map, system)],
    };
  }

  /**
   * Burn a claim's fuel to light its anchor for this Reckoning. **All or nothing.**
   *
   * `goodLotsAt` for the availability so locality and encumbrance are the same rule the Charge and
   * the anchor already use: the fuel has to be unpledged and standing AT the claimed system. There
   * is no verb in this build that moves goods between systems, which is exactly why
   * `ANCHOR_FUEL_BY_TIER` asks only the tier that produces fuel for any.
   *
   * The two-pass shape is the point: a single pass that destroyed what it found would leave a
   * claimant poorer with a cold anchor — worse than either outcome, and unrecoverable.
   */
  private lightAnchorWithFuel(args: {
    readonly claimant: PrincipalId;
    readonly system: SystemId;
    readonly want: Qty;
    readonly tick: number;
  }): boolean {
    const lots = this.goodLotsAt(args.claimant, args.system, FUEL_GOOD);
    let have = 0;
    for (const lot of lots) have += lot.qty;
    if (have < args.want) return false;
    let left: number = args.want;
    for (const lot of lots) {
      if (left <= 0) break;
      const portion = Math.min(left, lot.qty);
      if (portion <= 0) continue;
      try {
        this.ledger.destroyGoods({
          eventId: `claim.fuel:${args.claimant}:${String(args.tick)}:${args.system}:${lot.id}` as EventId,
          tick: args.tick,
          sink: GOODS_SINK.CONSUMPTION,
          lotId: lot.id,
          qty: qty(portion),
        });
      } catch (error: unknown) {
        this.faults.push(
          `${args.claimant} could not burn ${String(portion)} of ${FUEL_GOOD} into the anchor at ` +
            `${args.system} (${describeError(error)}); the anchor stays cold and nothing more is taken`,
        );
        return false;
      }
      left -= portion;
    }
    return left <= 0;
  }

  /** Unpledged fuel standing at a system, in one principal's stores. What lights an anchor. */
  fuelAt(principal: PrincipalId, system: SystemId): Qty {
    let total = 0;
    for (const lot of this.goodLotsAt(principal, system, FUEL_GOOD)) total += lot.qty;
    return qty(total);
  }

  /**
   * What a claim is collecting at a system: this Reckoning's take, its tenants, and the rate.
   *
   * `perTick` is recomputed from the live share split rather than stored, so it moves the moment a
   * tenant arrives or leaves — the number an agent needs is *today's* rent, not an average.
   */
  rentReadAt(system: SystemId, claimant: PrincipalId, tick = this.engine.tick): RentRead {
    const terms = this.rentTermsAt(system);
    const shares = this.worksBook.sharesAt(system, tierOf(this.world.map, system), tick);
    let perTick = 0;
    for (const [id, amount] of shares.entries()) {
      const works = this.worksBook.at(id);
      if (works === null) continue;
      perTick += rentOn({ terms, extractor: works.holder, gross: amount }).rent;
    }
    const tier = tierOf(this.world.map, system);
    return {
      taken: this.worksBook.rentTakenAt(system, reckoningOf(tick)),
      tenants: this.worksBook.tenantsAt(system, claimant),
      perTick: qty(perTick),
      fuelDue: ANCHOR_FUEL_BY_TIER[tier],
      // Hot means "already fuelled for this Reckoning". A claim that needs no fuel is never cold:
      // reporting `false` for a Marches claim would tell a viewer its income was switched off.
      anchorHot: ANCHOR_FUEL_BY_TIER[tier] <= 0 || this.worksBook.anchorHot(system, reckoningOf(tick)),
      fuelHere: this.fuelAt(claimant, system),
    };
  }

  /**
   * The highest rent rate any claim in the book carries. INV-W5's ceiling.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **EVERY CLAIM, TERMINAL ONES INCLUDED — AND THE LIVE-ONLY VERSION HALTED A WORLD.**
   * Measured: a claim ceded at phase 36 after collecting 132 units left `liveClaims()` empty, so
   * the ceiling fell to 0 while this Reckoning's tally was still 132, and INV-W5 stopped the tick.
   * The rent was correct; the *bound* was wrong. That is the worst species of invariant — one that
   * accuses a world of arithmetic the rules themselves produced (A5′ pointed at the engine) — and
   * on the live world it would have fired the first time anybody abandoned territory.
   *
   * The tally is per SYSTEM and survives a claim ending, because what a place gave up this
   * Reckoning is a completed public fact (A5, no opt-out). So the ceiling has to be the highest
   * rate any claim could have collected at, not the highest rate anyone is collecting at now.
   * Bounded by `MAX_CLAIMS`.
   * ══════════════════════════════════════════════════════════════════════════
   */
  private rentCeilingBps(): number {
    let top = 0;
    for (const claim of this.sovereignty.claimsInOrder()) top = Math.max(top, claim.rentBps);
    return top;
  }

  /** A principal's bond position: posted, required, and the headroom between them. */
  bondView(principal: PrincipalId): BondView {
    return bondViewFor(this.sovereignty, principal, this.bondRead());
  }

  /** The claim lines as they stand right now (§6.3's pixel signature). */
  claimLines(tick = this.engine.tick): readonly ClaimLine[] {
    return claimLinesFor({
      book: this.sovereignty,
      reckoning: reckoningOf(tick),
      tick,
      tierOf: (system) => tierOf(this.world.map, system),
      rentAt: (system, claimant) => this.rentReadAt(system, claimant, tick),
      bondRead: this.bondRead(),
    });
  }


  // ══════════════════════════════════════════════════════════════════════════
  // COMBAT (SPEC §9A, Phase 2) — THE ENGAGEMENT. Adapters only.
  //
  // Everything below is a port constructor or a dispatch. The logic is in `src/combat/`, and the
  // reason is `works/refine.ts`'s: this file is ten thousand lines, three mechanical edits landed
  // in the wrong place in it in one day, and all three passed `tsc`. A port whose signature
  // ENUMERATES what the operation touches is what makes a reviewer able to check it by reading.
  // ══════════════════════════════════════════════════════════════════════════

  /** The engagement book. Never held across a tick boundary: the rollback replaces it. */
  get battles(): EngagementBook {
    return this.engagementBookRef;
  }

  /** The fleet book. Never held across a tick boundary. */
  get fleet(): Fleet {
    return this.fleetRef;
  }

  /**
   * Everything `engage` reads. The hand read is the SAME one the resolver and the raid view use,
   * not a second copy — `DemandPort`'s stated reason, and it matters more here: the force an agent
   * is shown before it commits a warship and the force the resolver computes must come from one
   * implementation, or the affordance and the outcome can disagree with a hull at stake.
   */
  private engagePort(tick: number): EngagePort {
    const predation = this.predationPort(tick);
    return {
      tierOf: (system) => predation.tierOf(system),
      handsIdleAt: (principal, stage) => predation.handsDefending(principal, stage),
      isSeated: (principal) => predation.isSeated(principal),
      raid: (raidId) => this.raids.get(raidId as RaidId),
      sideIn: (raid, principal) => {
        // The target is always the DEFENDER and the initiator always the RAIDER, whether or not
        // either has joined a side explicitly. Reading only `parties` would leave the two agents
        // the standoff is *about* unable to bring a hull to their own battle.
        if (raid.target === principal) return 'DEFENDER';
        if (raid.initiator === principal) return 'RAIDER';
        return raid.parties.find((party) => party.principal === principal)?.side ?? null;
      },
    };
  }

  /** Everything building a hull touches: goods at a place, a holding at that place, and the ledger. */
  private shipyardPort(): ShipyardPort {
    return {
      tierOf: (system) => (this.world.map.systems.has(system) ? tierOf(this.world.map, system) : 'COMMONS'),
      goodsAt: (principal, system, good) =>
        qty(this.goodLotsAt(principal, system, good as GoodId).reduce((n, lot) => n + lot.qty, 0)),
      consume: (args) => {
        let taken = 0;
        const want = Number(args.qty);
        for (const lot of this.goodLotsAt(args.principal, args.system, args.good as GoodId)) {
          if (taken >= want) break;
          const portion = Math.min(want - taken, lot.qty);
          if (portion <= 0) continue;
          this.ledger.destroyGoods({
            eventId: (args.eventId + '#' + String(taken)) as EventId,
            tick: args.tick,
            sink: GOODS_SINK.CONSUMPTION,
            lotId: lot.id,
            qty: qty(portion),
          });
          taken += portion;
        }
        return qty(taken);
      },
      seatedAt: (principal, system) => {
        const holdingId = this.world.holdingByPrincipal.get(principal);
        if (holdingId === undefined) return false;
        return this.world.holdings.get(holdingId)?.system === system;
      },
      freeStoresOf: (principal) => freeStores(this.ledger, principal),
    };
  }

  /**
   * Everything a battle does outside its own book.
   *
   * ── WHY `burnHull` POSTS NOTHING, WHICH IS THE SUBTLE CALL HERE ────────
   *
   * A hull is **not a lot**. It was manufactured out of lots that INV-1 already saw destroyed at
   * build time, so posting again at wreck time would double-count the destruction — too much
   * removed, which reads as scarcity and is the direction that is hardest to notice. What a wreck
   * removes is the *asset*, and the asset lives in the fleet book, which is inside `state_hash`
   * and inside the rollback set precisely so that this is safe.
   *
   * So the value returned is the build cost, for the loss record, and the ledger action is none.
   * There is deliberately **no salvage**: §1 NICE-2's salvage layer is a named deferral, so the whole
   * build cost leaves the world, which is A5 with no discount.
   */
  private battlePort(ctx: PhaseContext): BattlePort {
    return {
      burnHull: (args) => {
        const record = this.fleet.get(args.hullId);
        if (record === undefined) return 0;
        const spec = hullQuote(record.hull);
        if (spec === null) return 0;
        void args.eventId;
        void args.tick;
        void args.system;
        void args.owner;
        return Number(spec.frame) + Number(spec.fuel);
      },
      routHand: (hand, tick) => this.predationPort(tick).routHand(hand, tick),
      wake: (principal, item) => {
        ctx.offerWake(principal, 'THREAT', item);
      },
    };
  }

  /**
   * Advance every live battle one tick. Composed into PREDATE, before raid resolution.
   *
   * `ctx.step` is charged per live battle, exactly as `predateNow` charges per live raid: DET-9
   * aborts a tick whose work exceeded its budget, and a combat layer that did not declare its cost
   * would either abort a legitimate tick or hide an unbounded one.
   */
  private battlesNow(ctx: PhaseContext): void {
    ctx.step(this.battles.liveCount() * 2 + 1);

    // ── THE DEADLINE, AND WHY A LATE `fight` GETS NO BATTLE ──────────────────
    //
    // `assertEngagementSchedule` proves 22 ≤ 24 at construction, but that is only the claim that a
    // battle STARTED AT THE SPAWN TICK fits. A defender that answers FIGHT at spawn+5 would open a
    // battle ending at spawn+28, three ticks after its own standoff resolved — and OPS-4 would halt
    // the world over it.
    //
    // So the deadline is a gate rather than a repair: a standoff answered too late to hold a battle
    // is decided on hands, exactly as it was before this layer existed. That is a real strategic
    // consequence and a good one — answering FIGHT promptly is what buys you a fleet fight — and it
    // is published in the engagement view rather than discovered.
    const openable = this.raids
      .live()
      .filter((raid) => raid.answer === 'FIGHT')
      .filter((raid) => ctx.tick + ENGAGEMENT_TICKS <= raid.resolvesAtTick);

    const report = runBattles({
      book: this.battles,
      fleet: this.fleet,
      port: this.battlePort(ctx),
      rng: ctx.rng,
      tick: ctx.tick,
      raids: openable,
      // A11: hash(seed) is published when the battle opens and the seed itself at AFTERMATH. This
      // derives from the tick's own committed seed, so it is the same commitment the whole world is
      // already published against rather than a second one nobody can check.
      seedCommitFor: (raid) => canonicalHash({ v: 1, raid: raid.id, tick: ctx.tick }).slice(0, 16),
      onFault: (message) => {
        this.faults.push('combat: ' + message);
      },
    });

    // ── THE SAFETY NET FOR A BATTLE WHOSE STANDOFF WENT AWAY ─────────────────
    //
    // The deadline gate above makes this unreachable in normal operation, and it is here anyway
    // because the alternative is a halt in front of an audience. OPS-4 still catches the genuine
    // bug — a live battle over a settled raid — and this closes the one cause it could have.
    for (const record of this.battles.live()) {
      if (this.raids.isLive(record.raid)) continue;
      this.battles.close(record.id, fieldControlOf(record), ctx.tick);
      this.faults.push(
        'combat: battle ' + record.id + ' outlived its standoff ' + record.raid + ' and was closed at tick ' +
          String(ctx.tick) + '. The deadline gate in battlesNow should have made this unreachable.',
      );
    }

    for (const record of report.opened) {
      this.emitRow({
        tick: ctx.tick,
        kind: 'battle.opened',
        rulesVersion: RULES_VERSION,
        actorPrincipalId: record.initiator ?? record.target,
        onBehalfOfPrincipalId: null,
        grantId: null,
        eventFamilyId: 'battle::' + record.id,
        parentEventId: null,
        isPublic: true,
        publicAt: ctx.tick,
        declassifyAt: ctx.tick,
        provenanceClass: 'FACT',
        actedOnStateVersion: ctx.frozenStateVersion,
        decisionSource: null,
        visibility: 'PUBLIC',
        audience: [],
        payload: {
          engagement: record.id,
          raid: record.raid,
          stage: record.stage,
          target: record.target,
          initiator: record.initiator,
          worldForce: record.worldForce,
          seedCommit: record.seedCommit,
        },
      });
      this.battleTicker.push(battleTickerLine(record));
    }

    for (const closed of report.closed) {
      this.emitRow({
        tick: ctx.tick,
        kind: 'battle.closed',
        rulesVersion: RULES_VERSION,
        actorPrincipalId: closed.engagement.initiator ?? closed.engagement.target,
        onBehalfOfPrincipalId: null,
        grantId: null,
        eventFamilyId: 'battle::' + closed.engagement.id,
        parentEventId: null,
        isPublic: true,
        publicAt: ctx.tick,
        declassifyAt: ctx.tick,
        provenanceClass: 'FACT',
        actedOnStateVersion: ctx.frozenStateVersion,
        decisionSource: null,
        visibility: 'PUBLIC',
        audience: [],
        payload: {
          engagement: closed.engagement.id,
          raid: closed.engagement.raid,
          stage: closed.engagement.stage,
          fieldControl: closed.control,
          wrecks: closed.engagement.wrecks.length,
          seedCommit: closed.engagement.seedCommit,
        },
      });
      this.battleTicker.push(battleTickerLine(closed.engagement));
      for (const wreck of closed.engagement.wrecks) {
        this.emitRow({
          tick: ctx.tick,
          kind: 'battle.wreck',
          rulesVersion: RULES_VERSION,
          actorPrincipalId: wreck.principal,
          onBehalfOfPrincipalId: null,
          grantId: null,
          eventFamilyId: 'battle::' + closed.engagement.id,
          parentEventId: null,
          isPublic: true,
          publicAt: ctx.tick,
          declassifyAt: ctx.tick,
          provenanceClass: 'FACT',
          actedOnStateVersion: ctx.frozenStateVersion,
          decisionSource: null,
          visibility: 'PUBLIC',
          audience: [],
          payload: {
            engagement: closed.engagement.id,
            stage: closed.engagement.stage,
            principal: wreck.principal,
            hull: wreck.hull,
            killedBy: wreck.killedBy,
            tick: wreck.tick,
            value: wreck.value,
          },
        });
      }
    }
  }

  /** OPS-1..7, merged into the same ASSERT pass as PRD and SOV. */
  private combatViolations(tick: number): readonly InvariantViolation[] {
    const recovering = new Set<string>();
    for (const hand of this.world.hands.values()) {
      if (hand.state === 'RECOVERING') recovering.add(hand.id);
    }
    return checkCombatInvariants({
      book: this.battles,
      fleet: this.fleet,
      tick,
      raidIsLive: (raid) => this.raids.isLive(raid),
      recoveringHands: recovering,
    });
  }

  /** How much of each combat invariant's subject the world has produced. Non-vacuity, as a number. */
  combatCoverageNow(): ReturnType<typeof combatCoverage> {
    return combatCoverage(this.battles, this.fleet);
  }

  /** Battles this principal is in, for `observe`. Bounded (INV-26). */
  engagementsFor(principal: PrincipalId, tick: number, limit: number): readonly EngagementView[] {
    return engagementViewsFor({ book: this.battles, fleet: this.fleet, principal, tick, limit });
  }

  /** The gate `engage` itself runs, exposed so the affordance cannot hold a second copy of it. */
  engageRefusalFor(req: EngageRequest): Rejection | null {
    return engageRefusal(this.engagePort(req.tick), this.battles, this.fleet, req);
  }

  /** The gate `build {"kind":"HULL"}` itself runs. Same argument. */
  hullRefusalFor(args: {
    readonly principal: PrincipalId;
    readonly system: SystemId;
    readonly hull: string;
    readonly modules: readonly string[];
    readonly tick: number;
  }): Rejection | null {
    return buildHullRefusal(this.shipyardPort(), this.fleet, args);
  }

  /** Hulls this principal could commit at a place right now. What the affordance offers. */
  committableHulls(
    principal: PrincipalId,
    system: SystemId,
  ): readonly { readonly id: HullId; readonly hull: string }[] {
    return this.fleet.readyAt(principal, system).map((row) => ({ id: row.id, hull: row.hull }));
  }

  /** `engage` — SPEC §9A's one live-combat verb, paid for by removing `flee`. */
  private vEngage(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const raid = readString(req.params, ['raid', 'raid_id', 'engagement', 'standoff']);
    if (raid === null) {
      return reject(
        'A2',
        'engage needs {"raid":"<raid_id>"}. A battle is fought inside a standoff, never at a bare place — ' +
          'see raids[] in your observation for the ids you are a party to.',
      );
    }
    const hull = readString(req.params, ['hull', 'hull_id', 'ship']);
    const echelonRaw = (readString(req.params, ['echelon', 'line', 'row']) ?? 'MAIN').toUpperCase();
    const postureRaw = (readString(req.params, ['posture', 'stance']) ?? 'HOLD').toUpperCase();
    if (!isEchelon(echelonRaw)) {
      return reject('A2', '"' + echelonRaw + '" is not an echelon. The four are SCREEN · MAIN · SUPPORT · RESERVE.');
    }
    if (!isPosture(postureRaw)) {
      return reject('A2', '"' + postureRaw + '" is not a posture. The three are CLOSE · HOLD · KITE.');
    }

    const result = engage(this.engagePort(ctx.tick), this.battles, this.fleet, {
      principal: req.principal,
      raid,
      tick: ctx.tick,
      hull: hull === null ? null : (hull as HullId),
      echelon: echelonRaw,
      posture: postureRaw,
      // §7 MUST-7 requires competent defaults ("CUT timeout paralysis"), and the default is the one
      // a human fleet commander uses: kill the force multipliers, then the tackle holding you.
      primary: readPredicates(req.params),
      withdrawWhen: {
        ehpBelowBps:
          readInt(req.params, ['withdraw_below_bps', 'withdraw_if_ehp_below_bps', 'ehp_below_bps']) ?? 0,
        hullsLost:
          readInt(req.params, ['withdraw_after_losses', 'withdraw_if_hulls_lost', 'hulls_lost']) ?? 0,
        now: req.params['withdraw_now'] === true || req.params['retreat'] === true,
      },
      handId: (readString(req.params, ['hand', 'hand_id']) ?? null) as HandId | null,
    });
    if (!result.ok) return result;

    this.emitRow({
      tick: ctx.tick,
      kind: result.value.committed ? 'battle.committed' : 'battle.ordered',
      rulesVersion: RULES_VERSION,
      actorPrincipalId: req.principal,
      onBehalfOfPrincipalId: null,
      grantId: null,
      eventFamilyId: 'battle::' + result.value.engagement.id,
      parentEventId: null,
      isPublic: true,
      publicAt: ctx.tick,
      declassifyAt: ctx.tick,
      provenanceClass: 'FACT',
      actedOnStateVersion: ctx.frozenStateVersion,
      decisionSource: req.decisionSource,
      visibility: 'PUBLIC',
      audience: [],
      payload: {
        engagement: result.value.engagement.id,
        formation: result.value.formation.id,
        principal: req.principal,
        side: result.value.formation.side,
        hull: result.value.formation.hull,
        hulls: result.value.formation.hands.length,
        echelon: result.value.formation.echelon,
        posture: result.value.formation.posture,
        primary: [...result.value.formation.primary],
        withdrawBelowBps: result.value.formation.withdrawWhen.ehpBelowBps,
        withdrawAfterLosses: result.value.formation.withdrawWhen.hullsLost,
      },
    });
    return { ok: true, value: null };
  }

  /** `build {"kind":"HULL"}` — the third build kind. No verb spent; `kind` is the existing pattern. */
  private vBuildHull(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const hull = (readString(req.params, ['hull', 'class', 'ship']) ?? '').toUpperCase();
    if (hull === '') {
      return reject(
        'A2',
        'build {"kind":"HULL"} needs a hull: ' + HULL_NAMES.join(' · ') + '. A hull costs ' +
          HULL_COST_GOODS.frame + ' plus ' + HULL_COST_GOODS.fuel + ', and ' + HULL_COST_GOODS.fuel +
          ' is produced only at FRONTIER systems — so a fleet is something somebody hauled.',
      );
    }
    const modules = readModules(req.params);

    const named = readString(req.params, ['system', 'at', 'where']) as SystemId | null;
    const holdingId = this.world.holdingByPrincipal.get(req.principal);
    const system =
      named ?? (holdingId === undefined ? null : (this.world.holdings.get(holdingId)?.system ?? null));
    if (system === null) {
      return reject('A2', 'build {"kind":"HULL"} needs a system, and you have no holding to default to.');
    }

    const result = buildHull(this.shipyardPort(), this.fleet, {
      principal: req.principal,
      system,
      hull,
      modules,
      tick: ctx.tick,
    });
    if (!result.ok) return result;

    this.emitRow({
      tick: ctx.tick,
      kind: 'hull.built',
      rulesVersion: RULES_VERSION,
      actorPrincipalId: req.principal,
      onBehalfOfPrincipalId: null,
      grantId: null,
      eventFamilyId: 'hull::' + result.value.record.id,
      parentEventId: null,
      isPublic: true,
      publicAt: ctx.tick,
      declassifyAt: ctx.tick,
      provenanceClass: 'FACT',
      actedOnStateVersion: ctx.frozenStateVersion,
      decisionSource: req.decisionSource,
      visibility: 'PUBLIC',
      audience: [],
      payload: {
        hull: result.value.record.id,
        hullClass: result.value.record.hull,
        // The FIT HASH is published and the MODULE LIST is not, and that split is §11.2 exactly. A
        // hash identifies a fit for coalescing and for a later loss report; the list is a manifest,
        // and "a ship at sea is visible; its manifest is not". A rival that has seen this row knows a
        // WARDEN exists; it does not know whether it repairs or shoots.
        fit: result.value.record.fit,
        system,
        readyAtTick: result.value.record.readyAtTick,
        frameSpent: Number(result.value.frameSpent),
        fuelSpent: Number(result.value.fuelSpent),
      },
    });
    return { ok: true, value: null };
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
   * §9's aggression capacity: how many demands this principal may still open this Reckoning.
   *
   * Derived from the raid book, never stored — see `predation/aggression.ts` for why a counter
   * would be a second home for a quantity the record already determines, and why deriving it
   * makes it correct across a restart for free (A4: uptime is never power).
   */
  demandsRemainingFor(principal: PrincipalId, tick: number): number {
    return demandsRemaining(this.raids, principal, tick);
  }

  /**
   * **The one gate on `demand`, exposed so the affordance can ask it the same question the
   * verb will.**
   *
   * ══════════════════════════════════════════════════════════════════════════
   * This project's signature defect runs in both directions and one predicate closes both.
   * Nine mechanics were once legal and unreachable — `grant`, the A6 core loop, among them —
   * because an affordance was never written; and an affordance with its own copy of a gate
   * offers moves the handler then refuses, which costs an agent an action and its trust in
   * the menu. `api/observe.ts` calls this before offering a `demand`, and `vDemand` calls it
   * again through `openDemand`. They cannot disagree, because there is only one of them.
   * ══════════════════════════════════════════════════════════════════════════
   */
  demandRefusalFor(req: DemandRequest): Rejection | null {
    return demandRefusal(this.demandPort(req.tick), this.raids, req);
  }

  /**
   * Everything a `demand` may touch. Two reads shared with the resolver, two of its own.
   *
   * `tierOf` and `handsDefending` come from {@link predationPort} rather than being written a
   * second time here: the force an agent is shown when it decides and the force the resolver
   * computes at the window's end have to be one implementation, or the affordance and the
   * outcome can disagree about who would win (scar #1, with a hand and a hold at stake).
   */
  private demandPort(tick: number): DemandPort {
    const port = this.predationPort(tick);
    return {
      // Wrapped rather than passed by reference: `unbound-method` is right to object, and the
      // delegation is the point anyway — one implementation, reached three ways.
      tierOf: (system) => port.tierOf(system),
      handsDefending: (principal, stage) => port.handsDefending(principal, stage),
      isSeated: (principal) => port.isSeated(principal),
      freeStoresOf: (principal) => freeStores(this.ledger, principal),
      lockStake: (args) => {
        try {
          return this.ledger.encumbrances.lock({
            eventId: `${args.raid}:stake:${args.principal}`,
            tick: args.tick,
            principal: args.principal,
            account: storesAccount(args.principal),
            amountMinor: args.amount,
            // The stake IS the worst case, exactly: it is what the raider loses if the demand
            // is repulsed, and EXPOSURE is Σ open max_direct_loss and nothing else (§3).
            obligationRef: args.raid as unknown as VentureId,
            maxDirectLoss: args.amount,
          });
        } catch {
          // Never a throw into a verb handler. `openDemand` turns the null into a sentence and
          // nothing has been written, so the agent is refused rather than 500'd (scar #11).
          return null;
        }
      },
    };
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
      this.emitRow({
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
    this.emitRow({
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
   * `demand` — §9's **agent-initiated** standoff, and a deliberately thin adapter.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THE RULES ARE IN `src/predation/demand.ts` AND NOT HERE.** This file is 9,700 lines and
   * on 2026-07-26 three mechanical edits landed in the wrong place in it and all three passed
   * `tsc`; `D21` is the ordering that unwinds it and `works/refine.ts` is the worked example of
   * the shape. So this method does what an adapter does and no more: read the params, call the
   * port-and-function, publish the receipt. Every gate, every sentence and every number an
   * agent reads lives beside the mechanic.
   * ══════════════════════════════════════════════════════════════════════════
   *
   * Not behind `committing`, and for a reason rather than by omission: `demandRefusal` refuses
   * any demand whose 24-tick window would run into the commitment window at all, which closes
   * a strictly wider door than `committing` does and closes it with a sentence that names the
   * tick demands reopen at.
   */
  private vDemand(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const target = readString(req.params, [
      'principal',
      'principal_id',
      'principalId',
      'target',
      'target_principal',
      'against',
      'defender',
    ]) as PrincipalId | null;
    if (target === null) {
      return reject(
        'A2',
        'demand needs somebody to demand from: send {"principal": "<id>", "system": "<stage>", ' +
          `"good": "<good>", "qty": <units>}. ${DEMAND_RULE_STATEMENT}`,
      );
    }
    const stage = readString(req.params, ['system', 'system_id', 'systemId', 'at', 'stage']) as SystemId | null;
    if (stage === null) {
      return reject(
        'A2',
        'demand needs a place: send {"system": "<id>"}. A raid happens at one system, against one good — ' +
          'the goods your target keeps somewhere else are not reachable from here, and your own hand has ' +
          'to be standing at the place you name.',
      );
    }
    const good = (readString(req.params, ['good', 'good_id', 'goodId']) ?? LEVY_GOOD) as GoodId;
    const wanted = readInt(req.params, ['qty', 'quantity', 'demand', 'units']);
    if (wanted === null) {
      return reject(
        'A2',
        `demand needs a quantity: send {"qty": <units>}, between ${String(RAID_DEMAND_QTY.min)} and ` +
          `${String(RAID_DEMAND_QTY.max)}. It is pinned when you send it and never recomputed — the number ` +
          'you state is the number the target is held to.',
      );
    }

    const outcome = openDemand(this.demandPort(ctx.tick), this.raids, {
      initiator: req.principal,
      target,
      stage,
      good,
      demand: qty(wanted),
      tick: ctx.tick,
      handId: readString(req.params, ['hand', 'hand_id', 'handId']) as HandId | null,
    });
    if (!outcome.ok) return outcome;
    const raid = outcome.value;

    this.emitRow({
      tick: ctx.tick,
      kind: 'raid.demanded',
      rulesVersion: RULES_VERSION,
      // ── THE FIELD THAT MAKES THIS A DIFFERENT EVENT FROM `raid.spawned` ──────
      //
      // `raid.spawned` carries `actorPrincipalId: null` and it has to: nobody issues a world
      // raid, which is the entire reason it cannot be bribed off. This one has an actor, so it
      // is a different kind rather than the same kind with a field filled in — a reader that
      // treated them as one would have to check a nullable field to know whether the record was
      // accusing anybody, and the one thing this record must never be mistaken for is an
      // accusation against somebody who did nothing (A5′).
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
      payload: {
        raid: raid.id,
        initiator: req.principal,
        target: raid.target,
        stage: raid.stage,
        good: raid.good,
        demand: raid.demandQty,
        stake: RAID_JOIN_STAKE_MINOR,
        resolves_at_tick: raid.resolvesAtTick,
        // Published with the act, so an agent reading the feed can see the price of predation
        // falling as a Reckoning goes on — which is the information that makes a demand a
        // decision about targets rather than a tariff.
        demands_left_this_reckoning: this.demandsRemainingFor(req.principal, ctx.tick),
      },
      visibility: 'PUBLIC',
      audience: [],
    });
    // §12.4: every party to a resolving item is offered one wake BEFORE it resolves. A demand
    // with a deadline is exactly that, and a target that is never woken has been handed a
    // window it could not use — which would make the loss one it was never shown (A5′).
    ctx.offerWake(raid.target, 'THREAT', raid.id);
    this.raidTicker.push(raidTickerLine(raid));
    return { ok: true, value: null };
  }

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

    this.emitRow({
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
    this.emitRow({
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
    // The Levy's rows plus the Charge's. The Levy alone already satisfies INV-25 — it assesses
    // every principal — so sovereignty's rows are additive rather than load-bearing for the
    // invariant. They are supplied anyway because INV-25's own note is that it is "the one most
    // likely to quietly stop being true as features are added", and a mechanic that can take a
    // principal's territory without ever putting it on a docket row is precisely that failure.
    const docket =
      roll.length === 0
        ? undefined
        : [...docketRowsFor(this.levy, reckoning), ...chargeDocketRowsFor(this.sovereignty, reckoning)];
    return {
      ledger: this.ledger,
      obligations: this.liveObligations(),
      // ── INV-26 HAD NEVER SEEN A STRUCTURE ───────────────────────────────────
      //
      // The invariant whose entire job is bounded growth — scar #3, an unbounded array that became
      // an OOM and a disk DoS — always took its skip branch: *"no serialized structures supplied;
      // the cap walker only sees what it is handed"*. Nothing in `src/` ever supplied `capped`, and
      // `requireAllInvariants` defaults to false, so the skip was SILENT. Scar #14b inside the
      // invariant layer, which is the highest-irony defect in this repo.
      //
      // **Wiring is OPT-IN per structure, and that is not timidity.** `checkInv26`'s rule is that
      // *"an array with no declared cap is itself a violation"* — correctly, since scar #3's lesson
      // was not "cap the arrays we thought of". So handing it a book with one undeclared array would
      // halt the world on a healthy tick. Structures join this list as their caps are declared and
      // verified, one at a time.
      //
      // The grant book goes first because both its caps are real published constants with real
      // consequences: `MAX_GRANTS` bounds `state_hash` and every capture, and `MAX_GRANT_SPENDS`
      // THROWS with no pruning anywhere — so the A6 core loop dies permanently at 16,384 draws. An
      // invariant that can see that number approach is worth more than one that cannot see anything.
      //
      // D14 §5 carries the full array map for the remaining eighteen tables.
      capped: [
        {
          label: 'grant',
          // Through the state table, because that is the serialised shape INV-26 walks and the one
          // that reaches `state_hash` — capturing the book any other way would check a different
          // object than the one growth actually threatens.
          value: grantsStateTable(
            () => this.grantBook,
            () => {
              /* read-only here: INV-26 never restores */
            },
          ).capture(),
          caps: [
            { path: 'grants', max: MAX_GRANTS },
            { path: 'spends', max: MAX_GRANT_SPENDS },
          ],
        },
      ],
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
      // ── HOW MANY OF THOSE ARE ASSURANCES ────────────────────────────────────
      //
      // `talk` alone cannot answer the question the receipt reel depends on: an `offer` and an
      // `assure` both increment it, and only the second is a promise a viewer can hold somebody to.
      // Without this the choice between "the cast will not speak" and "the cast speaks but never
      // stakes anything" is unreadable, and those are different findings with different fixes.
      //
      // Counted over the ring rather than tracked incrementally: the ring is bounded at
      // MAX_TALK_ENTRIES, so this is a walk over at most 512 rows on a diagnostic path.
      assures: this.talk.all.filter((t) => t.act === 'assure').length,
      // ── AND HOW MANY ARE FROM THE PARTY THAT CAN ACTUALLY BREAK THE PROMISE ──
      //
      // `publicLine` shows the CREATOR's assurance, because the creator owes the elective half and
      // is therefore the only party that can decline it — which is the promise §14's reel exists to
      // quote. So 41 assurances in the ring and 0 on the frame is not a wiring fault: it means the
      // assurances are coming from the OTHER side of the deal.
      //
      // This is the number that separates those two readings, and they need opposite fixes: if
      // creators never assure, the reel will almost never fire and the prompt is aiming the wrong
      // party at the wrong moment. If they do, the filter or the settlement window is wrong.
      assuresByCreator: this.talk.all.filter(
        (t) => t.act === 'assure' && this.ventures.get(t.venture)?.creator === t.from,
      ).length,
      // ── AND ARE THEY IN TIME? ────────────────────────────────────────────────
      //
      // The last question in this chain, and the only one left after 40 creator assurances turned
      // out to exist. `publicLine` reads assurances on the venture that settled **in that
      // Reckoning**, so an assurance's value depends entirely on arriving BEFORE the settlement it
      // will be printed beside.
      //
      // `assuresOnLive` will reach a frame when its venture settles. `assuresOnResolved` never
      // will — those were spoken about a deal already in the record, which is a promise made after
      // the outcome was known and is worth nothing to a reader. If the second number dominates, the
      // cast is assuring too late and the fix is in the prompt's timing, not in the frame.
      assuresOnLive: this.talk.all.filter(
        (t) => t.act === 'assure' && this.ventures.get(t.venture)?.resolvedAtTick === null,
      ).length,
      assuresOnResolved: this.talk.all.filter(
        (t) => t.act === 'assure' && (this.ventures.get(t.venture)?.resolvedAtTick ?? null) !== null,
      ).length,
      // ── IS THE ECONOMY'S ONLY FAUCET ACTUALLY REACHABLE? ────────────────────
      //
      // `works` counts structures and `worksOnline` counts the ones past spin-up; together
      // they say whether PRODUCE is doing anything at all. `worksAffordableBy` is the one
      // that matters, and it exists because of a question the build could not answer by
      // reading: a WORKS costs EARNINGS, and D10b measured that a principal which has
      // graduated and posted a bond has a transferable balance of exactly ZERO until income
      // lifts it clear of the whole endowment floor.
      //
      // So the mechanic could be correct, tested, offered, rendered — and still unreachable
      // for every principal in a live world. That is not a state a test can report, because
      // it depends on how much the economy has actually paid out. It is reported here so the
      // answer is continuously visible rather than discovered a week later.
      // ── WHY NOTHING IS RIDING, WHICH IS UPSTREAM OF THE RECEIPT REEL ────────
      //
      // `docket` was 0 with five live ventures, so nothing had a filled role carrying elective
      // value — which means `assure` is offered to NOBODY and the say-do gap has no material to
      // work with. That is a different finding from "agents choose not to speak", and the two are
      // indistinguishable without these three numbers.
      //
      // `venturesLive` vs `rolesFilled` separates "nobody is being hired" from "hiring happens and
      // carries no elective half", and `electiveRiding` is the quantity the reel ultimately needs.
      rolesFilled: this.ventures
        .live()
        .reduce((n, v) => n + v.roles.filter((r) => r.filledByPrincipal !== null).length, 0),
      rolesOpen: this.ventures
        .live()
        .reduce((n, v) => n + v.roles.filter((r) => r.filledByPrincipal === null).length, 0),
      electiveRiding: this.ventures
        .live()
        .reduce(
          (n, v) =>
            n + v.roles.reduce((m, r) => m + (r.filledByPrincipal === null ? 0 : r.terms.elective), 0),
          0,
        ),
      works: this.worksBook.size,
      worksOnline: this.worksBook.liveInOrder().filter((w) => this.engine.tick >= w.onlineAtTick).length,
      // Reads `worksQuote(...).affordable` — the SAME predicate the affordance and the verb use —
      // rather than recomputing the price test. The first version recomputed it with `freeCash`
      // and kept reporting 0 after the gate moved to the free balance, so the instrument was
      // measuring a rule the engine no longer had. A witness with its own copy of the logic can
      // be wrong in exactly the direction that hides the thing it was built to reveal.
      worksAffordableBy: [...this.world.holdingByPrincipal.keys()].filter((principal) => {
        const seat = this.world.holdingByPrincipal.get(principal);
        if (seat === undefined) return false;
        return this.worksQuote(principal, holdingOf(this.world, principal).system).affordable;
      }).length,
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
    // Every handler is fronted by the delegation-param guard, filtering here rather than at each
    // branch — a per-verb check is one somebody forgets when they add a verb, and the verb they forget
    // it on is the one that silently acts on the sender instead.
    const guarded = (h: VerbHandler): VerbHandler => (ctx, req) => this.unhonouredOnBehalf(req) ?? h(ctx, req);
    const table: Readonly<Record<string, VerbHandler>> = {
      refine: (ctx, req) => this.committing(ctx) ?? this.vRefine(ctx, req),
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
      // ── `demand` — the fourth, and §9's OTHER form of predation ─────────────
      //
      // Also not a new verb: §12.2 has held the word since the first commit and
      // `world/commons.ts` already classifies it HOSTILE, so the §17 budget is untouched and
      // the Commons floor covers it with no new classification. What it adds is the thing world
      // raids structurally cannot — conflict somebody CHOSE, with a name on it — and it is the
      // only caller of the aggression capacity that prices a standing toll out of existence.
      demand: (ctx, req) => this.vDemand(ctx, req),
      // `engage` (SPEC §9A). Guarded by `committing` for the reason every material verb is:
      // §5.1's freeze forbids a new commitment inside the settlement window, and committing a
      // warship is the most commitment-shaped act in the game.
      engage: (ctx, req) => this.committing(ctx) ?? this.vEngage(ctx, req),
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
      // ── `graduate` — the exit from the Commons, and it was missing ─────────
      //
      // Behind `committing` for exactly `trade`'s reason, plus one of its own.
      // `reckoning/driver.ts:VERIFY_INPUTS` re-reads every payer's free balance between
      // the freeze and the settlement and halts on any difference; the upkeep charge
      // moves that figure, so a crossing inside the window would pause a healthy world
      // on the one night that has an audience (A14). The extra reason is the Levy: a
      // holding is what decides a principal's constellation and therefore its delivery
      // place, and moving it while tonight's obligations are frozen would change where a
      // settling assessment is payable after the inputs that priced it were hashed.
      graduate: (ctx, req) => this.committing(ctx) ?? this.vGraduate(ctx, req),
      // ── SOVEREIGNTY: two words that already existed and had no handler ─────
      //
      // `post_bond` and `build` are both in SPEC §12.2 and both were unregistered, so this
      // registers handlers for words that already existed rather than spending a slot the
      // §17 budget does not have. See the long note above `vPostBond`.
      //
      // `post_bond` is behind `committing` because it LOCKS currency, and
      // `reckoning/driver.ts:VERIFY_INPUTS` re-reads every payer's free balance between the
      // freeze and the settlement and halts on any difference in either direction — `trade`'s
      // reason exactly. `build` moves currency (a cession price) and destroys goods, so the
      // same door, plus its own: a claim changing hands mid-settlement changes who a Charge is
      // billed to after the figures were hashed.
      post_bond: (ctx, req) => this.committing(ctx) ?? this.vPostBond(ctx, req),
      build: (ctx, req) => this.committing(ctx) ?? this.vBuild(ctx, req),
      form: (ctx, req) => this.committing(ctx) ?? this.vForm(ctx, req),
      apply: (ctx, req) => this.committing(ctx) ?? this.vApply(ctx, req),
      approve: (ctx, req) => this.committing(ctx) ?? this.vApprove(ctx, req),
      admit: (ctx, req) => this.committing(ctx) ?? this.vAdmit(ctx, req),
    };
    return Object.fromEntries(Object.entries(table).map(([verb, h]) => [verb, guarded(h)]));
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
  /**
   * Verbs that read `on_behalf_of`. Everything else must REFUSE it rather than drop it.
   *
   * A blind probe sent `graduate {"on_behalf_of": "<victim>", "to": "sys-05"}` intending to graduate
   * somebody else's holding. `graduate` does not read the param, so it was silently ignored and the
   * probe **irreversibly graduated its own holding out of the Commons** — permanently losing A8's
   * protection, with no refusal and no correction, from a param the docs never said the verb takes.
   *
   * Silently dropping an unrecognised param is the worst available failure mode on a one-way verb, and
   * `graduate` is the most one-way verb in the game. The general rule is better than a special case: a
   * param that means "act for someone else" must never be quietly discarded, because the act it
   * modifies is exactly the act you did not intend to perform on yourself.
   */
  private static readonly HONOURS_ON_BEHALF: ReadonlySet<string> = new Set([
    'create',
    'grant',
    'approve',
    'deliver',
  ]);

  /** Refuse a delegation param on a verb that would ignore it. */
  private unhonouredOnBehalf(req: ActionRequest): Rejection | null {
    if (Runtime.HONOURS_ON_BEHALF.has(req.verb)) return null;
    const named = readString(req.params, ['on_behalf_of', 'onBehalfOf', 'for']);
    if (named === null) return null;
    return reject(
      'A2',
      `${req.verb} does not act on another principal's behalf, and it will not quietly ignore ` +
        `on_behalf_of=${named} either — a dropped delegation param means the act lands on YOU instead, ` +
        `which on a one-way verb is unrecoverable. The verbs that read it are ` +
        `${[...Runtime.HONOURS_ON_BEHALF].sort((a, b) => (a < b ? -1 : 1)).join(', ')}. Nothing was done. ` +
        `Send ${req.verb} without it if you meant to act for yourself.`,
    );
  }

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
    // ── AN OFFICE-HOLDER BRINGS THE HANDS; THE HOUSE BRINGS THE MONEY ────────
    //
    // A syndicate is a principal with no keypair and no holding — *"it cannot sign a request and
    // cannot act"* (`syndicate/book.ts`). It has a stores account and nothing else. So this
    // existence check refused every `on_behalf_of=<syndicate>` call, and OFFICES WERE INERT: a
    // syndicate could pool a treasury, vote an office by MAJORITY, and issue a grant that showed up
    // correctly on both sides — and the holder could not spend the pool on anything at all.
    //
    // §8's whole complaint about ventures is that *"there is no quartermaster who could empty the
    // vault at any moment"*. There was one. It was behind this predicate.
    //
    // Found from the outside by a probe agent, then named independently by two reviewers as the
    // highest-value change available — which is what made me look at it rather than at anything
    // more interesting.
    //
    // The resolution is what an office already means: the HOLDER supplies the physical presence and
    // the HOUSE supplies the capital. Escrow still draws on `creator`'s stores (the syndicate's), the
    // grant gate below still bounds it by the two limits the members voted, and the stage comes from
    // the hand actually standing there — the actor's. Nothing about liability moves: the venture
    // belongs to the syndicate, and A6's whole point is that this is a legitimate act by someone who
    // was legitimately given the authority to do it.
    const creatorIsHouse = this.syndicateBook.isSyndicate(creator);
    if (delegated && !creatorIsHouse && this.world.holdingByPrincipal.get(creator) === undefined) {
      return reject('A2', `there is no principal ${creator} to create a venture on behalf of.`);
    }
    if (creatorIsHouse && this.syndicateBook.at(creator as unknown as SyndicateId) === null) {
      return reject('A2', `${creator} is not a live syndicate; a dissolved house has no treasury to spend.`);
    }
    const stage = readString(req.params, ['stage', 'system', 'at']) as SystemId | null;
    // A house has no hands. The office-holder's own hand is what puts the venture somewhere.
    const presence = creatorIsHouse ? req.principal : creator;
    const hands = handsOf(this.world, presence);
    const here = stage ?? hands[0]?.location;
    if (here === undefined || !this.world.map.systems.has(here)) {
      return reject(
        'A2',
        `create needs a stage — the system it happens in. Name one where ` +
          `${creatorIsHouse ? 'you' : delegated ? String(creator) : 'you'} has a hand` +
          `${creatorIsHouse ? ', because a syndicate has no hands of its own — you act with yours' : ''}.`,
      );
    }
    const value = readInt(req.params, ['value', 'value_minor']) ?? kindSpec(kind).baseYieldMinor;
    if (value <= 0 || value > 1_000_000_000) {
      return reject('PROP-V5', `value must be a positive amount under 1000000000, got ${String(value)}.`);
    }
    // ── HOW MUCH OF THIS IS A PROMISE, AND WHO DECIDES ──────────────────────
    //
    // The creator does, inside the band the kind publishes. Before this, every venture in the world
    // was exactly `f(kind)` elective, so *"the elective half is a real choice, every time"* was a
    // fixed tax with a fixed answer and there was nothing to negotiate (`D22` finding 4). Read here,
    // ahead of the escrow arithmetic, because it changes both the escrow that gets locked and the
    // contingent tail the grant is charged for — a proportion applied after either would be gating
    // one number and owing another, which is scar #1's shape (see the note on `elective` below).
    //
    // It also refuses the spellings a probe sent and lost (`roles`, `split`, `escrow_pct`): a dropped
    // param on a verb that shapes a binding commitment does not degrade the request, it changes what
    // was committed to.
    const proportion = readElectiveBps(kind, req.params);
    if (!proportion.ok) return proportion;

    const opens = ctx.tick;
    const closes = opens + FORMATION_WINDOW_TICKS;
    // `+ DELIVERY_LEAD_TICKS` before the search, so the settlement it lands on is at
    // least that far past the window's close and the venture can always reach its own
    // delivery **outside the freeze**. Without the lead, a venture whose window closed
    // at the freeze tick would have to deliver inside it — which moves a figure the
    // settlement was computed from and halts the world on a healthy Reckoning.
    const resolves = nextSettlementAtOrAfter(closes + DELIVERY_LEAD_TICKS);
    const id = this.mintVentureId(ctx.tick, creator);

    // ── §7.3's PREFERENCE ORDER, FINALLY READABLE ───────────────────────────
    //
    // Two cooperating agents used to get the same open lottery as strangers: a probe agent lost
    // three contested slots to in-process heuristic bots — which decide inside the tick loop with
    // no network latency — before winning a fourth only by collapsing create→observe→fill→sign
    // into a single script. That is latency being power, which A4 forbids.
    //
    // This is the designed answer rather than a new mechanic, and it is deliberately NOT a
    // reservation: preference orders *simultaneous* claims on a contested slot, it does not hold
    // the slot open. An unnamed principal still takes it when nobody preferred is contesting, so
    // a clique cannot lock a newcomer out and A8's floor is untouched.
    const rawPreference = req.params['preference'] ?? req.params['prefer'] ?? null;
    let preference: readonly PrincipalId[] = [];
    if (rawPreference !== null && rawPreference !== undefined) {
      if (!Array.isArray(rawPreference)) {
        return reject(
          'A2',
          'preference must be an ARRAY of principal ids, best first: ' +
            '{"preference":["p:alpha","p:beta"]}. It orders whoever contests a slot in the same ' +
            'tick — it does not reserve one, and naming somebody does not oblige them to fill it.',
        );
      }
      if (rawPreference.length > MAX_VENTURE_PREFERENCE) {
        return reject(
          'A2',
          `preference names ${String(rawPreference.length)} principals and the limit is ` +
            `${String(MAX_VENTURE_PREFERENCE)}. An order longer than the venture has roles is ` +
            'expressing nothing.',
        );
      }
      const named: PrincipalId[] = [];
      for (const entry of rawPreference) {
        if (typeof entry !== 'string') {
          return reject('A2', 'every entry in preference must be a principal id string.');
        }
        const who = entry as PrincipalId;
        // Refused, not silently dropped: an agent that names a typo and is quietly given the open
        // lottery would believe it had stated a preference it had not (A2).
        if (this.world.holdingByPrincipal.get(who) === undefined) {
          return reject('A2', `there is no principal ${entry} to prefer; name one that has enrolled.`);
        }
        if (named.some((x) => String(x) === String(who))) {
          return reject('A2', `preference names ${entry} twice; an order with a repeat is ambiguous.`);
        }
        named.push(who);
      }
      preference = named;
    }

    // ── THE GRANT IS FOUND BEFORE THE VENTURE IS BUILT, BECAUSE IT IS THE CONSENT ──
    //
    // It used to be looked up after `createVenture`, which was fine while the grant only had to be
    // *checked*. It now also has to be **recorded on the venture**: a delegated create binds the
    // grantor at formation, and the row must say under whose authority (`GRANT_IS_CONSENT`,
    // `venture/create.ts`). The headroom checks stay where they are — they need the terms — so this
    // is only the existence half moving up. Still before any value moves, so a refusal here leaves
    // the world untouched.
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
    }

    const made = createVenture({
      id,
      kind,
      creator,
      stage: here,
      terms: roleTermsFor(kind, minor(value), proportion.value),
      windowOpensTick: opens,
      windowClosesTick: closes,
      resolvesAtTick: resolves,
      valuation: pinnedAt(DEFAULT_VALUATION_RULE, ctx.tick),
      rulesVersion: RULES_VERSION,
      preference,
      // A6. The grantor is bound the moment its delegate acts, inside the LIMITS it signed — it does
      // not get a second veto by staying dark, and `agent.md` §9 has always said so. See
      // `venture/create.ts:boundAtFormation` for the whole argument and for what it cost while it was
      // the other way round.
      boundByGrant: grant?.id ?? null,
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
    if (grant !== null) {
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
    this.emitRow({
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
        ...(delegated && grant !== null
          ? {
              creator,
              onBehalfOf: creator,
              grant: grant.id,
              // ── THE BINDING, ON THE RECORD, AT THE MOMENT IT HAPPENS ────────────────
              //
              // A6's signature moment is *"a grant used against you through an entirely legitimate
              // act"*, and the replay has to be able to point at the act. `boundByGrant` says the
              // creator was committed here, by this delegate, under this authority, **without a
              // signature of its own** — the fact a viewer needs to understand why the grantor is
              // liable for something it never agreed to individually, and the fact a counterparty
              // needs before it fills a role in it.
              //
              // It publishes nothing new: `grantId` is already on this row, §11.2 puts a grant's
              // parties and LIMITS at `PUBLIC` (D9a), and the authority line has drawn them since
              // the grant layer shipped.
              boundByGrant: grant.id,
              boundNote: bindingNote({ creator, delegate: req.principal, grant: grant.id }),
            }
          : {}),
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

  /**
   * `sign` — an ADAPTER. The operation lives in `venture/sign.ts`.
   *
   * Second extraction under `D21`'s coupling order, and the narrowest port in the file: this handler
   * reached exactly one runtime member. Its helpers `countersign` and `yourTakeAtP50` were already in
   * `venture/`, so this moved logic home rather than inventing a home for it.
   */
  private vSign(_ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    return sign({ ventureOf: (id) => this.ventures.get(id) }, req.principal, req.params);
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
  private vElect(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
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

    // ── THE PAYER, OR SOMEONE THE PAYER PUT IN AN OFFICE (A6) ─────────────────
    //
    // The elective half is paid out of the creator's own stores, so anyone else electing on it is
    // spending another agent's money — which is not a reason to refuse, it is the DEFINITION of the
    // authority a `grant` hands over. This gate was A6's missing link: `grant` was issued, bounded,
    // warned, rendered and revocable, and no verb anywhere let a delegate use one, so every grant was
    // `UNUSED` forever and betrayal-via-authority was impossible by construction (`D20`).
    //
    // Naming the grant is mandatory rather than inferred. A delegate may hold authority from several
    // principals, `liveGrantBetween` picks by headroom, and a draw against the wrong grantor's limit is
    // a wrong row in a journal INV-22 halts the world over — A5′. So the delegate says which mandate it
    // is acting under and the engine checks that exact one.
    const mandate = this.electionMandate(ctx, req, venture, roleIndex);
    if ('rejection' in mandate) return mandate.rejection;
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
    // ── THE DRAW IS RECORDED HERE, NOT AT SETTLEMENT, AND THAT IS DELIBERATE ──
    //
    // An election is a statement and value moves at the Reckoning, so settlement looks like the
    // natural home. It is not, for two reasons. `recordSpend`'s own contract is that the caller checks
    // headroom "before it moves any value, so a refusal leaves the world untouched" — INV-22 is the
    // backstop, not the gate — and a limit enforced only at settlement is not a limit, because by then
    // the promise is public and breaking it is a default on somebody's record.
    //
    // And nothing forces it later: INV-22 reads `eventId` for sort identity and for its messages and
    // never dereferences it, so provenance scoped to the election is honest. Which means this needs no
    // new state table, no change to the `Election` union, and no RULES_VERSION bump — the spend journal
    // is already inside `grantsStateTable`'s capture.
    const grant = mandate.grant;
    if (grant !== null) {
      // IN_FULL is not knowable until the venture resolves, so it draws on the CONTINGENT limit at its
      // p90 ceiling; a stated amount is knowable now and draws on the DIRECT one. That is exactly the
      // split §8 defines and the `grant` affordance already shows as `max_direct_loss` and
      // `max_contingent_liability`, so a grantor who read the warning has already priced this.
      const direct = raw === IN_FULL ? minor(0) : minor(raw);
      const contingent = raw === IN_FULL ? this.electiveCeilingOf(venture, roleIndex) : minor(0);
      const room = this.grantBook.headroom(grant.id);
      if (direct > room.direct || contingent > room.contingent) {
        return reject(
          'INV-22',
          `grant ${grant.id} has ${String(room.direct)} of direct and ${String(room.contingent)} of ` +
            `contingent headroom left, and this election needs ${String(direct)} and ` +
            `${String(contingent)}. ${venture.creator} bounded what you may commit in their name and this ` +
            `would exceed it. Elect a smaller amount, or ask for a wider grant — the limit is the whole ` +
            `reason they were willing to sign one.`,
        );
      }
      this.grantBook.recordSpend({
        grant: grant.id,
        delegate: req.principal,
        tick: ctx.tick,
        eventId: `elect:${venture.id}:${String(roleIndex)}` as unknown as EventId,
        direct,
        contingent,
      });
    }
    this.elections.set(key, raw);
    return { ok: true, value: null };
  }

  /**
   * Who is paying, and under what mandate — or why this principal may not elect here at all.
   *
   * Returns `{grant: null}` for the ordinary case (the creator electing on its own venture), a live
   * grant when a delegate is acting inside one, and a rejection otherwise.
   *
   * ── THE MANDATE IS INFERRED, NOT NAMED, AND THAT IS FOR CONSISTENCY ──────────
   *
   * The first version of this took a `grant: <id>` param, on the reasoning that a delegate holding
   * authority from several principals should say which one it is drawing on. That reasoning is sound
   * and it was still wrong here, because **`create` already does this and does it differently**:
   * `on_behalf_of` names the PRINCIPAL and `liveGrantBetween` infers the grant. Two spellings for "I
   * am acting under delegated authority" is one concept wearing two words in a rules surface — §3, and
   * the same shape as scar #1 — and the inconsistency would land on an agent as two mechanics to learn
   * where there is one.
   *
   * Inference is also unambiguous here in a way it is not for `create`. The elective half is paid by
   * `venture.creator` and by nobody else, so the grantor is not a choice the actor makes — it is a
   * fact about the venture. There is nothing for a param to disambiguate, so `elect` needs no extra
   * field at all: acting as a delegate is simply electing on a venture you did not create.
   */
  private electionMandate(
    ctx: PhaseContext,
    req: ActionRequest,
    venture: VentureRecord,
    roleIndex: number,
  ): { readonly grant: Grant | null } | { readonly rejection: WorldResult<null> } {
    if (venture.creator === req.principal) return { grant: null };

    const grant = this.grantBook.liveGrantBetween(venture.creator, req.principal, ctx.tick);
    if (grant === null) {
      return {
        rejection: reject(
          'PROP-V4',
          `only ${venture.creator} elects on ${venture.id}: the elective half is paid out of the payer's ` +
            'own stores, and you hold no live grant from them to act on their behalf. Ask them to grant you ' +
            'scoped authority (verb: grant), or elect on the ventures you created. An expired or revoked ' +
            'mandate reads the same way here — authority ends on a stated tick (scar #7).',
        ),
      };
    }
    // ── ONE DELEGATE ELECTION PER ROLE, AND IT FAILS CLOSED ───────────────────
    //
    // `elect` is restatable until the freeze, which is right for a principal spending its own stores.
    // Under a mandate it is not: each restatement would draw fresh headroom against the grant, so a
    // delegate could walk an amount up repeatedly and charge the grantor's limit every time. Netting
    // restatements would need a per-election spend record — state this deliberately does not add — so
    // the safe answer is one draw per role and a refusal that says who may still restate.
    if (this.elections.has(electionKey(venture.id, roleIndex))) {
      return {
        rejection: reject(
          'PROP-V4',
          `an election already stands on that role of ${venture.id}, and a delegate states it once: ` +
            'each restatement would draw fresh headroom against the grant. ' +
            `${venture.creator} may restate its own election at any time before the freeze.`,
        ),
      };
    }
    return { grant };
  }

  /**
   * How much raw {@link WORKS_YIELD_GOOD} this principal could refine at a system right now.
   *
   * The one home for "is there anything to refine here", read by the cast branch, the affordance and —
   * through {@link vRefine}'s own check — the verb. A separate copy in the menu is how an affordance
   * comes to offer an act the engine refuses, which costs an agent a real action every wake (AGT-S2).
   */
  refinableAt(principal: PrincipalId, system: SystemId): number {
    return this.goodLotsAt(principal, system, WORKS_YIELD_GOOD).reduce((n, l) => n + l.qty, 0);
  }

  /**
   * `refine` — an ADAPTER now. The operation lives in `works/refine.ts`.
   *
   * Moved out as the worked example of the shape that replaces this file: a narrow port, a pure
   * function, and a method here that only gathers inputs. See that file's header for why — three
   * mechanical edits landed in the wrong place in this class on 2026-07-26 and all three passed `tsc`.
   */
  private vRefine(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const named = readString(req.params, ['system', 'at', 'place']) as SystemId | null;
    const system = named ?? holdingOf(this.world, req.principal).system;
    return refine(
      {
        lotsOf: (p, sys, good) => this.goodLotsAt(p, sys, good),
        destroy: (a) => {
          this.ledger.destroyGoods({
            eventId: a.eventId,
            tick: ctx.tick,
            sink: GOODS_SINK.CONSUMPTION,
            lotId: a.lotId as LotId,
            qty: a.qty,
          });
        },
        source: (a) => {
          this.ledger.sourceGoods({
            eventId: a.eventId,
            tick: ctx.tick,
            faucet: GOODS_FAUCET.PRODUCTION,
            to: storesAccount(req.principal),
            good: a.good,
            qty: a.qty,
            location: a.location,
            origin: req.principal,
          });
        },
      },
      req.principal,
      system,
      ctx.tick,
      readInt(req.params, ['qty', 'quantity', 'amount']),
    );
  }

  private mintGrantId(tick: number, principal: PrincipalId): GrantId {
    this.grantCounter += 1;
    const stamp = canonicalHash({ tick, principal, ordinal: this.grantCounter }).slice(0, 8);
    return `g:${String(tick)}:${stamp}` as GrantId;
  }


  /**
   * The syndicate this `grant` is made on behalf of, or null for an ordinary personal grant.
   *
   * Read from `on_behalf_of`, so an ordinary grant is untouched and an office is one extra field.
   */
  private officeGrantorFor(req: ActionRequest): PrincipalId | null {
    const named = readString(req.params, ['on_behalf_of', 'syndicate', 'onBehalfOf']);
    if (named === null) return null;
    const id = named as unknown as SyndicateId;
    return this.syndicateBook.at(id) === null ? null : (named as PrincipalId);
  }

  /**
   * Why this principal may not appoint an office on that syndicate's behalf, or null.
   *
   * Three gates, and each is a clause somebody relied on when they pooled their goods:
   *
   *   1. **Membership.** An outsider appointing an office over a treasury it did not fund is not a
   *      betrayal story, it is a missing check.
   *   2. **`treasury_offices`.** The constitutional clause a member reads before pooling. False
   *      makes the pool a strongbox that no single holder can spend; refusing here is the charter
   *      doing the only job it has.
   *   3. **The decision rule.** FOUNDER appoints alone. MAJORITY and UNANIMOUS require the sitting
   *      members to approve, which is `approve` — and that verb has no handler yet, so those
   *      charters genuinely cannot appoint. Stated as the RULE it is rather than as a missing
   *      feature, because the rule is true either way: a majority charter requires a majority. The
   *      reachability gap is measured in `/health` instead of hidden in a hint.
   */
  private officeGrantorFault(ctx: PhaseContext, req: ActionRequest): WorldResult<null> | null {
    const tick = ctx.tick;
    const named = readString(req.params, ['on_behalf_of', 'syndicate', 'onBehalfOf']);
    if (named === null) return null;
    const id = named as unknown as SyndicateId;
    const row = this.syndicateBook.at(id);
    if (row === null) {
      return reject(
        'A2',
        `there is no syndicate ${named}. on_behalf_of names a SYNDICATE whose treasury the office ` +
          'would have authority over, and you must be a sitting member of it.',
      );
    }
    if (!this.syndicateBook.isMember(id, req.principal, tick)) {
      return reject(
        'A2',
        `you are not a sitting member of ${named}, so you cannot appoint an office over its treasury. ` +
          'Join it first.',
      );
    }
    if (!row.charter.treasuryOffices) {
      return reject(
        'A15',
        `${named}'s charter sets treasury_offices FALSE, so no office may ever be given authority over ` +
          'its pool — it is a strongbox, not a business, and every member joined on that basis. A charter ' +
          'is permanent and there is no verb that amends one, so this will not change: `form` a different ' +
          'syndicate if you need one that can appoint.',
      );
    }
    // ── THE RECEIPT, WITHOUT WHICH THIS RECURSES FOREVER ─────────────────────
    //
    // A carried proposal re-enters `vGrant` to mint the office, so it arrives here a second time
    // with the same non-FOUNDER charter. Without this check it would open a NEW proposal, carry it,
    // re-enter, and never terminate. `carried_proposal` is the receipt that the constitution was
    // already satisfied, and it is only ever set by `carryOffice` — an agent that sends it by hand
    // names a proposal that must exist, be closed, and match this delegate, or it is refused.
    const carried = readString(req.params, ['carried_proposal']);
    if (carried !== null) {
      if (this.syndicateBook.proposal(carried) !== null) {
        return reject(
          'A2',
          `${carried} is still open, so it has not carried; use \`approve\` rather than naming it here.`,
        );
      }
      return null;
    }
    if (row.charter.decision !== 'FOUNDER') {
      // Not a refusal any more: the appointment becomes a PROPOSAL its members answer with
      // `approve`. Returning a rejection here would have made the DEFAULT charter (`MAJORITY`)
      // unable to appoint anyone at all, so the default syndicate could never do the one thing
      // syndicates exist for.
      return this.proposeOffice(ctx, req, row.id);
    }
    if (req.principal !== row.founder) {
      return reject(
        'A2',
        `${named}'s charter sets decision FOUNDER, so only ${row.founder} may appoint an office over its ` +
          'treasury. That is the constitution its members joined under.',
      );
    }
    return null;
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
    // ── AN OFFICE IS A GRANT WHOSE GRANTOR IS A SYNDICATE (§365) ─────────────
    //
    // This is the whole of "offices" and it is deliberately not a new mechanism. A grant already
    // carries scoped authority over another principal's stores, shows `max_direct_loss` and
    // `max_contingent_liability` before signing (A7), has INV-22/23 on the spend counter and
    // lives inside `state_hash`. Pointing the grantor at a syndicate inherits every one of those
    // guarantees rather than re-deriving them, which is exactly why D11 chose to make a syndicate
    // a principal-shaped subject in the first place. If this had turned out expensive, the design
    // would have been wrong.
    //
    // The CHARTER decides who may appoint, and it is constitutional — so this is not a permission
    // check bolted on, it is the constitution being enforced at the one moment it matters.
    const officeFault = this.officeGrantorFault(ctx, req);
    if (officeFault !== null) return officeFault;
    const grantor = this.officeGrantorFor(req) ?? req.principal;
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
    this.emitRow({
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
    this.emitRow({
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

  /** `withdraw` — an ADAPTER. The operation lives in `venture/withdraw.ts` (D21). */
  private vWithdraw(_ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    return withdraw(
      {
        ventureOf: (id) => this.ventures.get(id),
        releaseIndex: (hand) => {
          this.ventures.indexRelease(hand);
        },
        freeHand: (hand) => {
          const h = this.world.hands.get(hand);
          if (h !== undefined && h.state === 'COMMITTED') h.state = 'IDLE';
        },
      },
      req.principal,
      req.params,
    );
  }

  /**
   * `abandon` — an ADAPTER. The venture half lives in `venture/abandon.ts` (D21).
   *
   * The claim branch is dispatched here rather than moved: abandoning a claim salvages part of its
   * bond, which needs sovereignty and the bond book. Keeping it out leaves the extracted port narrow.
   * The argument for venture-and-claim being ONE verb rather than two — and the counter-argument from
   * `graduate`'s precedent — is written out above `vPostBond`.
   */
  private vAbandon(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const claimSystem = readString(req.params, ['claim', 'system', 'system_id']) as SystemId | null;
    if (claimSystem !== null) return this.abandonClaim(ctx, req, claimSystem);
    return abandon(
      {
        ventureOf: (id) => this.ventures.get(id),
        resolveAbandoned: (id) => this.ventures.resolve(id, 'ABANDONED', ctx.tick),
        freeHand: (hand) => {
          const record = this.world.hands.get(hand);
          if (record !== undefined && record.state === 'COMMITTED') record.state = 'IDLE';
        },
        refundEscrow: (venture) => {
          this.refundEscrow(ctx.tick, venture);
        },
      },
      req.principal,
      req.params,
    );
  }

  /**
   * `publish_offer` — an ADAPTER. The prose half lives in `say/offer.ts` (D21).
   *
   * The cession branch is dispatched here rather than moved: naming a claim publishes an offer with a
   * subject the engine can transfer, which needs the sovereignty book. Keeping it out leaves the
   * extracted port one member wide instead of dragging sovereignty in behind it.
   */
  private vPublishOffer(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const cede = readString(req.params, ['cede', 'claim', 'sell']) as SystemId | null;
    if (cede !== null) return this.offerCession(ctx, req, cede);
    return publishOffer(
      {
        record: (entry) => {
          this.offers.push(entry);
        },
        maxLength: MAX_REASON_LENGTH,
      },
      req.principal,
      req.params,
      ctx.tick,
    );
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

  /** `claim`/`deny` — an ADAPTER. The operation lives in `say/say.ts` (D21). */
  private vSay(ctx: PhaseContext, req: ActionRequest, denial: boolean): WorldResult<null> {
    return say(
      {
        record: (entry) => {
          this.claims.push(entry);
        },
        maxLength: MAX_REASON_LENGTH,
      },
      req.principal,
      req.params,
      ctx.tick,
      denial,
    );
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
        this.raids.isLive(String(ref)) ||
        // A posted BOND is a lock whose obligation is the bond itself: it is *continuous*
        // (§3), so it is live for exactly as long as the claim book still lists it. Without
        // this clause every posted bond reads to INV-4 as an orphan lock and the tick halts
        // — the market's and predation's extension for the third time, same one line.
        this.sovereignty.isLive(String(ref)),
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
      this.emitRow({
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
      this.emitRow({
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
    this.emitRow({
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
      this.emitRow({
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
      this.emitRow({
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
      this.emitRow({
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
      this.emitRow({
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
      // ── RELOCATE, DESTROY THE PORTION, SEND THE REMAINDER HOME ──────────────
      //
      // §10.2 makes the Levy payable "only in located goods physically delivered to a named place", so
      // the lot genuinely moves to the delivery place before it is consumed — that part is the rule.
      //
      // What was missing is the last step. `relocate` moves the WHOLE lot and the ledger has no split,
      // so paying a 500 assessment out of a 45,000 lot moved all 45,000 to the Levy's place, destroyed
      // 500, and left 44,500 stranded there. A blind probe reported it as "a 500-unit Levy destroyed
      // 45,000 units": its `available_qty` at its own system went 45,000 -> 0, because that field reads
      // goods standing AT the reader, and every field it could see agreed the goods were gone. It was
      // then soft-locked out of every goods-priced verb in the game — on a payment whose affordance
      // said `max_direct_loss: 500`.
      //
      // Nothing was destroyed beyond the 500 and INV-1 always held, which is exactly why this survived:
      // supply conservation cannot see a location, so the one invariant that would have caught a theft
      // is silent about a teleport. The affordance's promise is the thing that was broken.
      const origin = this.ledger.lot(lot.id)?.location;
      try {
        this.ledger.relocate(lot.id, { location: args.place });
        this.ledger.destroyGoods({
          eventId: `${args.label}:${args.principal}:${lot.id}` as EventId,
          tick: args.tick,
          sink: GOODS_SINK.CONSUMPTION,
          lotId: lot.id,
          qty: qty(portion),
        });
        // Whatever the delivery did not consume goes back where the agent left it. Checked against the
        // live lot rather than `portion < lot.qty`, because `destroyGoods` mutates it.
        const after = this.ledger.lot(lot.id);
        if (after !== undefined && after.qty > 0 && origin !== undefined && origin !== args.place) {
          this.ledger.relocate(lot.id, { location: origin });
        }
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

  // ── SOVEREIGNTY'S VERBS, AND NOT ONE OF THEM IS NEW ───────────────────────
  //
  // The §17 budget is at 40 of 40 and spent, so this mechanic ships on words SPEC §12.2
  // already publishes:
  //
  //   - **`post_bond`** (identity group) had no handler. §3 defines BOND as "posted slashable
  //     capital, continuous", which is exactly what a claim requires — so this is the verb
  //     doing the job its own canon row names.
  //   - **`build`** (world group) had no handler. An anchor is a structure raised out of
  //     produced goods at a place, which is what `build` means. It carries `kind` so that
  //     production works can use the same word when §16 step 11 lands.
  //   - **`deliver`** carries `{"obligation":"CHARGE"}`. One concept — handing goods over at a
  //     named place — applied to the second world obligation. Absent the field it is a Levy
  //     delivery, exactly as before, so no existing agent changes behaviour.
  //   - **`vote`** carries a fourth ballot. §12.2's own words: "one verb, three ballots ... a
  //     ballot is a ballot".
  //   - **`publish_offer`** carries `{"cede":"<system>","price":N}`. It is an offer, published.
  //   - **`abandon`** carries `{"claim":"<system>"}`. One concept — relinquishing your own
  //     object, publicly and irreversibly — applied to a claim instead of a venture. Stated
  //     rather than assumed: this is the one of the six that is arguable, because §12.2 groups
  //     `abandon` under `venture`. The argument for it being one word is that the semantics
  //     are identical (the actor gives up its own thing, nobody else's, and it is published),
  //     and the argument against is `graduate`'s precedent — `move` applied to a holding
  //     needed its own word because a hand and a holding are distinct §3 nouns. A claim is not
  //     a distinct noun from a venture in that sense; it is a different object of the same act.
  //     If review disagrees, the fix is a 41st verb and a removal, and this comment is where
  //     that argument starts.

  /**
   * `post_bond` — put slashable capital behind your word (§3, §6.4).
   *
   * A **lock**, not a payment: the capital stays in the claimant's own STORES and is visible
   * as its credit rating. It contributes zero to EXPOSURE by construction (`lockSafe`), and
   * that is deliberate — EXPOSURE is *"Σ your open `max_direct_loss`, and nothing else"* (§3)
   * and a bond is not a commitment to a counterparty. Adding it would silently move every
   * Levy allocation computed `BY_EXPOSURE`.
   */
  private vPostBond(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const amount = readInt(req.params, ['amount', 'bond', 'minor']);
    const account = storesAccount(req.principal);
    const free = this.ledger.account(account) === undefined ? minor(0) : this.ledger.freeBalance(account);
    const required = requiredBondOf(this.sovereignty, req.principal);
    const posted = postedBondOf(this.sovereignty, req.principal, this.bondRead());
    if (amount === null || amount <= 0) {
      return reject(
        'A2',
        `post_bond needs {"amount": N} in whole minor units. You have ${String(posted)} posted against ` +
          `${String(required)} required, and ${String(free)} free to post. ${SOVEREIGNTY_STATEMENT}`,
      );
    }
    if (amount > free) {
      return reject(
        'INV-3',
        `you have ${String(free)} free (balance less every open lock) and cannot post ${String(amount)}. A bond ` +
          'stays in your own stores — it is locked, not spent — so what you can post is what is unlocked.',
      );
    }
    let lockId: string;
    try {
      lockId = this.ledger.encumbrances.lockSafe({
        eventId: `bond:${req.principal}:${String(ctx.tick)}:${String(amount)}`,
        tick: ctx.tick,
        principal: req.principal,
        account,
        amountMinor: minor(amount),
        // The bond's own id is the obligation it secures: a bond is continuous, so it is live
        // for as long as the book lists it. `liveObligations` asks the book, which is a state
        // table, so an aborted tick's lock disappears with the rollback rather than becoming
        // an orphan INV-4 halts on.
        obligationRef: bondRefFor(req.principal) as unknown as VentureId,
      });
    } catch (error: unknown) {
      return reject('INV-3', describeError(error));
    }
    this.sovereignty.addBondLock(req.principal, lockId);
    this.emitRow({
      tick: ctx.tick,
      kind: 'bond.posted',
      rulesVersion: RULES_VERSION,
      actorPrincipalId: req.principal,
      onBehalfOfPrincipalId: null,
      grantId: null,
      eventFamilyId: `bond::${req.principal}`,
      parentEventId: null,
      // §6.4: a bond is "posted slashable capital, PUBLIC, and any amount — it is your credit
      // rating". Publicity is the mechanic, not a side effect.
      isPublic: true,
      publicAt: ctx.tick,
      declassifyAt: ctx.tick,
      provenanceClass: 'FACT',
      actedOnStateVersion: ctx.frozenStateVersion,
      decisionSource: req.decisionSource,
      payload: {
        principal: req.principal,
        amountMinor: amount,
        postedMinor: postedBondOf(this.sovereignty, req.principal, this.bondRead()),
        requiredMinor: required,
        claims: this.sovereignty.claimsOf(req.principal).length,
        exposureUnchanged: true,
      },
      visibility: 'PUBLIC',
      audience: [],
    });
    return { ok: true, value: null };
  }


  /**
   * The worked systems, as the map marks them (A13).
   *
   * Every field is a property of the map, a count of public structures, or a quantity the world
   * has already handed over — never a stock reading. `projection.ts` carries that argument in
   * full, and `assertFrameBudgets` refuses a line whose legend disagrees with its own numbers.
   */
  worksLines(tick: number): readonly WorksLine[] {
    const out: WorksLine[] = [];
    for (const works of this.worksBook.liveInOrder()) {
      const tier = tierOf(this.world.map, works.system);
      const occupants = this.worksBook.liveAt(works.system).length;
      const online = tick >= works.onlineAtTick;
      const terms = this.rentTermsAt(works.system);
      // Divided by the ONLINE count, which is what `sharesAt` actually divides by — a mark
      // quoting a share the engine does not pay would be the frame contradicting the ledger.
      const gross = online
        ? Math.trunc(
            YIELD_PER_TICK[tier] /
              Math.max(1, this.worksBook.liveAt(works.system).filter((w) => tick >= w.onlineAtTick).length),
          )
        : 0;
      // The SAME function the PRODUCE phase splits with, so the mark and the ledger cannot
      // disagree about who keeps what. `sharePerTick` is the NET — see `WorksLine.sharePerTick`.
      const split = rentOn({ terms, extractor: works.holder, gross: qty(gross) });
      out.push({
        works: works.id,
        system: works.system,
        holder: works.holder,
        yieldPerTick: YIELD_PER_TICK[tier],
        occupants,
        sharePerTick: split.net,
        legend: online ? 'EXTRACTING' : `SPINNING UP ${String(works.onlineAtTick - tick)} ticks`,
        extracted: works.extracted,
        // The RATE, not "did anything move": at a small enough share the amount truncates to zero
        // while the rate is still in force, and reading the rate off `rent > 0` would draw a WORKS
        // on claimed ground as though it stood on nobody's land.
        rentBps: rentApplies(terms, works.holder) ? (terms?.bps ?? 0) : 0,
        rentPerTick: split.rent,
        rentPaid: works.rentPaid,
        // The second good. A property of the tier divided by the online count, exactly like the
        // first — so the map, and not a stockpile, is what a viewer reads (§11.2).
        fuelPerTick: online ? (this.worksBook.fuelSharesAt(works.system, tier, tick).get(works.id) ?? 0) : 0,
        fuelExtracted: works.fuelExtracted,
      });
    }
    return out;
  }



  // ── WHO A CAST MEMBER KNOWS, AND WHAT PASSED BETWEEN THEM (§14, A12) ──────

  /**
   * This principal's history with everyone it has dealt with, **derived from the record**.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THE WATCHABILITY CEILING IS THE CAST'S INNER LIFE, NOT THE ENGINE'S SURFACE.** A
   * character is `handle · title · creed · stance` — appetite, no memory. So every wake it
   * met the world as a stranger: it could read that a venture had settled and not that the
   * counterparty across it had broken a promise to it twice before. A12 says the sandbox
   * authors the stories, and an agent with no memory of who wronged it cannot be a party to
   * one.
   *
   * **Derived, never stored.** A wound is a `DEFAULT` somebody already committed against
   * you — A5 makes it public and permanent, so the record IS the memory and there is nothing
   * to keep in sync. That also keeps it out of `state_hash`, out of the snapshot, and out of
   * the rollback set: a relationship computed from the journal cannot disagree with the
   * journal, which is the whole failure mode a `relationships` table would have.
   *
   * The asymmetry is the point. `kept`/`broke` are what THEY did to YOU — that is what
   * decides whether to deal again — while `youKept`/`youBroke` is your own record with them,
   * which is what they can read about you. A model handed only its own side would be unable
   * to reason about being distrusted.
   * ══════════════════════════════════════════════════════════════════════════
   */
  /**
   * Who this principal may hand an OFFICE to, and how much it would put at risk.
   *
   * **The single home for A6's eligibility rule.** `observe` builds the `grant` affordance from this
   * and the heuristic cast picks from the same list, so the menu an agent is shown and the menu a bot
   * plays from cannot disagree. They did not disagree before — the bot had no grant branch at all —
   * but writing the rule twice is how scar #1 happens, and this is the highest-stakes verb in the
   * game to get that wrong on.
   *
   * The gate is a KEPT PROMISE, and that is the mechanic rather than a list budget: A6 is an agent
   * earning trust over months and then being handed authority it could abuse. A grant to a stranger
   * is a handout; a grant to someone with a record is the end of an arc, and the receipt reads that
   * way at settlement.
   *
   * Excludes a delegate who already holds a live grant from this grantor — `liveGrantBetween`'s own
   * doc says at most one per pair is expected, so a second is noise on the menu and a wasted action
   * for the bot.
   *
   * The caps are *(calibrate)*: a tenth of the free balance, and an expiry one Reckoning out rather
   * than the three the engine allows, because a short life is what makes each renewal a decision
   * (scar #7, the sticky vow).
   */
  grantCandidates(
    principal: PrincipalId,
    tick: number,
    limit = MAX_GRANT_OFFERS,
  ): readonly {
    readonly to: PrincipalId;
    readonly cap: number;
    readonly kept: number;
    readonly broke: number;
    readonly expiresTick: number;
  }[] {
    const account = storesAccount(principal);
    const free = this.ledger.account(account) === undefined ? 0 : this.ledger.freeBalance(account);
    const cap = Math.trunc(free / 10);
    if (cap <= 0) return [];
    const out: {
      to: PrincipalId;
      cap: number;
      kept: number;
      broke: number;
      expiresTick: number;
    }[] = [];
    for (const relation of this.relationsFor(principal, limit * 4)) {
      if (out.length >= limit) break;
      if (relation.kept <= 0) continue;
      if (this.grantBook.liveGrantBetween(principal, relation.other, tick) !== null) continue;
      out.push({
        to: relation.other,
        cap,
        kept: relation.kept,
        broke: relation.broke,
        expiresTick: tick + TICKS_PER_RECKONING,
      });
    }
    return out;
  }

  relationsFor(
    principal: PrincipalId,
    limit = MAX_RELATIONS,
  ): readonly {
    readonly other: PrincipalId;
    readonly kept: number;
    readonly broke: number;
    readonly youKept: number;
    readonly youBroke: number;
    readonly lastTick: number;
  }[] {
    const byOther = new Map<
      string,
      { other: PrincipalId; kept: number; broke: number; youKept: number; youBroke: number; lastTick: number }
    >();
    const touch = (other: PrincipalId, tick: number): { kept: number; broke: number; youKept: number; youBroke: number; lastTick: number; other: PrincipalId } => {
      const key = String(other);
      let row = byOther.get(key);
      if (row === undefined) {
        row = { other, kept: 0, broke: 0, youKept: 0, youBroke: 0, lastTick: tick };
        byOther.set(key, row);
      }
      if (tick > row.lastTick) row.lastTick = tick;
      return row;
    };

    for (const change of this.standing.changes()) {
      const cp = change.counterparty;
      if (cp === null || cp === change.principal) continue;
      // THEY acted, and you were the counterparty: this is what was done to you.
      if (cp === principal) {
        const row = touch(change.principal, change.tick);
        if (change.cause === 'ELECTIVE_HONOURED') row.kept += 1;
        if (change.cause === 'DEFAULT') row.broke += 1;
      }
      // YOU acted, and they were the counterparty: this is your record with them.
      if (change.principal === principal) {
        const row = touch(cp, change.tick);
        if (change.cause === 'ELECTIVE_HONOURED') row.youKept += 1;
        if (change.cause === 'DEFAULT') row.youBroke += 1;
      }
    }

    // Most recent first, then by id so the list is reproducible. Bounded (INV-26): a member
    // that has dealt with three hundred principals does not need three hundred lines of
    // history in a prompt whose problem is already length.
    return [...byOther.values()]
      .sort((a, b) => b.lastTick - a.lastTick || compareIds(a.other, b.other))
      .slice(0, Math.max(0, limit));
  }

  // ── SYNDICATES: the org container, and pooled stores (§3, §365, D11) ──────

  /** The syndicate book, for the invariant pass, the views and the tests. */
  get syndicates(): SyndicateBook {
    return this.syndicateBook;
  }


  /**
   * Have these parties ever shared a venture that RESOLVED?
   *
   * `resolvedAtTick !== null` is the test, deliberately: two agents currently inside their first
   * deal together have not yet dealt before — the thing that builds confidence is a deal that
   * *finished*, whichever way it went. "It held" is a separate claim the docket line makes, and it
   * is why this returns a plain boolean rather than a verdict.
   */
  /**
   * What happened the last time these parties dealt — **three answers, not two.**
   *
   * This was `haveDealtBefore`, a boolean, and `render.ts` turned `false` into *"These two have
   * never dealt with each other before"* and `true` into *"They have dealt before, and it held."*
   * The predicate only asked whether a RESOLVED venture was shared. It never asked whether it
   * held. So a pair whose single prior deal was a **default** got a public frame stating that it
   * held.
   *
   * The comment above `firstTimeTogether` identified exactly this hazard for the `false` branch —
   * *"that is the record being WRONG about a relationship, which is what A5′ exists to forbid and
   * what other agents read to decide who to trust"* — and the `true` branch then reintroduced it.
   * Found by a spectacle critic reading the render path, not by any test: no invariant covers the
   * truth of a sentence.
   *
   * `HELD` is only returned after looking for a break and not finding one. The venture book answers
   * *did they deal*; the standing journal — the same source `relationsFor` walks, so there is one
   * home for what passed between two principals — answers *did it hold*.
   */
  priorDealings(
    creator: PrincipalId,
    fillers: readonly PrincipalId[],
    exclude: VentureId,
  ): 'NEVER' | 'HELD' | 'BROKEN' {
    if (fillers.length === 0) return 'NEVER';
    const wanted = new Set<string>(fillers.map(String));
    let dealt = false;
    for (const past of this.ventures.all()) {
      if (past.id === exclude || past.resolvedAtTick === null) continue;
      if (past.creator !== creator) continue;
      for (const role of past.roles) {
        if (role.filledByPrincipal !== null && wanted.has(String(role.filledByPrincipal))) {
          dealt = true;
          break;
        }
      }
      if (dealt) break;
    }
    if (!dealt) return 'NEVER';
    // A break in EITHER direction makes "it held" false. Which of them broke it is the receipt
    // reel's job at settlement; the docket line only has to stop asserting something untrue.
    for (const relation of this.relationsFor(creator)) {
      if (!wanted.has(String(relation.other))) continue;
      if (relation.broke > 0 || relation.youBroke > 0) return 'BROKEN';
    }
    return 'HELD';
  }


  /**
   * Elective halves this principal OWES on live ventures — the promises it can still break.
   *
   * The creator owes the elective part of every filled role, and `A7` is explicit that this is the
   * half that stays elective precisely so it *can* be broken. So this is the exact set of promises
   * whose assurances the receipt reel wants to quote, and the exact set an `assure` affordance
   * should be offered against.
   *
   * Excludes anything already resolved: an assurance about a settled venture is not a promise, and
   * offering one would invite an agent to spend words on a deed that is already in the record.
   */
  electivePromisesOwedBy(
    principal: PrincipalId,
  ): readonly { readonly venture: VentureId; readonly electiveMinor: Minor }[] {
    const out: { venture: VentureId; electiveMinor: Minor }[] = [];
    for (const v of this.ventures.live()) {
      if (v.creator !== principal || v.resolvedAtTick !== null) continue;
      let owed = 0;
      for (const role of v.roles) {
        if (role.filledByPrincipal !== null) owed += role.terms.elective;
      }
      if (owed > 0) out.push({ venture: v.id, electiveMinor: minor(owed) });
    }
    return out;
  }

  /**
   * The syndicates, as the map draws them (A13).
   *
   * `officeHolders` counts live grants whose grantor is the syndicate — the number of individuals
   * any one of whom could empty the treasury today without breaking a rule. That is the figure an
   * audience should feel, and it is the whole of A6 stated as one integer.
   */
  syndicateLines(tick: number): readonly SyndicateLine[] {
    const out: SyndicateLine[] = [];
    for (const row of this.syndicateBook.liveInOrder()) {
      const pooled = syndicateAsPrincipal(row.id);
      const account = storesAccount(pooled);
      const treasury = this.ledger.account(account) === undefined ? minor(0) : this.ledger.balance(account);
      const offices = this.grantBook
        .forGrantor(pooled)
        .filter((g) => this.grantBook.isLive(g.id, tick)).length;
      const members = this.syndicateBook.sittingMembers(row.id, tick).length;
      out.push({
        syndicate: row.id,
        name: row.name,
        founder: row.founder,
        members,
        admission: row.charter.admission,
        decision: row.charter.decision,
        treasuryOffices: row.charter.treasuryOffices,
        treasuryMinor: minor(treasury),
        officeHolders: offices,
        // STRONGBOX is asserted by `assertFrameBudgets` when the clause forbids offices, because a
        // viewer reading a pooled treasury needs to know at a glance whether anyone can touch it.
        legend: row.charter.treasuryOffices
          ? `${String(members)} POOLED · ${String(offices)} CAN SPEND`
          : `STRONGBOX · ${String(members)} POOLED`,
      });
    }
    return out;
  }

  /**
   * `form` — found a syndicate under a charter that can never be amended.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THE SYNDICATE IS NOT REGISTERED AS AN AGENT, AND THAT IS THE WHOLE SAFETY
   * ARGUMENT (D11).** Its stores account is opened so value can pool there, but it never
   * enters `world.principalOrder`. That single omission is load-bearing twice over:
   * `assessCycle` walks `principalOrder`, so a syndicate is never assessed a Levy it could
   * not possibly pay — it has no hands, and the Levy is payable only in goods carried by a
   * present hand, so a syndicate on the roll would default every Reckoning forever, which is
   * A5′ with our own org model as the cause. And `rankCandidates` reads the same list, so it
   * is never a raid target either.
   *
   * Measured before it was built: an account outside `principalOrder` holds a real balance
   * and the tick publishes clean. The alternative — an exclusion predicate consulted by the
   * docket builder, INV-25 and the raid aimer — was designed, then discarded, because three
   * call sites that agree today is a rule that lapses on the fourth.
   * ══════════════════════════════════════════════════════════════════════════
   */
  private vForm(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const name = readString(req.params, ['name', 'syndicate', 'title']);
    if (name === null || name.trim().length === 0) {
      return reject(
        'A2',
        'form needs a name: {"name":"<what to call it>"}. It founds a SYNDICATE — a pooled treasury ' +
          `under a charter — and costs ${String(FOUNDING_COST_MINOR)}. ${CHARTER_STATEMENT}`,
      );
    }
    if (name.length > 48) {
      return reject('A2', `a syndicate name is at most 48 characters; yours is ${String(name.length)}.`);
    }
    const already = this.syndicateBook.of(req.principal, ctx.tick).length;
    if (already >= MAX_SYNDICATES_PER_PRINCIPAL) {
      return reject(
        'A15',
        `you already sit in ${String(already)} syndicates, which is the cap of ` +
          `${String(MAX_SYNDICATES_PER_PRINCIPAL)}. Divided loyalty is interesting; unlimited is noise. ` +
          'Give notice on one first.',
      );
    }
    const charter = parseCharter(req.params);
    if ('fault' in charter) {
      // Refused rather than defaulted. Silently defaulting a constitutional clause would be the
      // worst failure available here: permanent, invisible, and not what was asked for.
      return reject('A2', `${charter.fault} ${CHARTER_STATEMENT}`);
    }

    const account = storesAccount(req.principal);
    const free = this.ledger.account(account) === undefined ? minor(0) : this.ledger.freeBalance(account);
    if (free < FOUNDING_COST_MINOR) {
      return reject(
        'A15',
        `founding a syndicate costs ${String(FOUNDING_COST_MINOR)} and you have ${String(free)} free ` +
          '(locked stores do not count). The money is RETIRED, not paid to anybody, so your starter stake ' +
          'can cover it — this gate is priced in capital and never in identities.',
      );
    }
    try {
      this.ledger.retireCurrency({
        eventId: `syndicate.form:${req.principal}:${String(ctx.tick)}` as EventId,
        tick: ctx.tick,
        from: account,
        amount: FOUNDING_COST_MINOR,
        sink: CURRENCY_SINK.UPKEEP,
      });
    } catch (error: unknown) {
      return reject('INV-3', `the founding cost could not be paid (${describeError(error)}); nothing was founded.`);
    }

    let row;
    try {
      row = this.syndicateBook.form({
        founder: req.principal,
        name: name.trim(),
        charter,
        tick: ctx.tick,
      });
    } catch (error: unknown) {
      return reject('INV-26', describeError(error));
    }

    // The pool. Opened here and NOT registered as a principal — see the header.
    const pooled = syndicateAsPrincipal(row.id);
    if (this.ledger.account(storesAccount(pooled)) === undefined) {
      this.ledger.openAccount(storesAccount(pooled), 'STORES', pooled);
    }

    this.emitRow({
      tick: ctx.tick,
      kind: 'syndicate.formed',
      rulesVersion: RULES_VERSION,
      actorPrincipalId: req.principal,
      onBehalfOfPrincipalId: null,
      grantId: null,
      eventFamilyId: `syndicate::${row.id}`,
      parentEventId: null,
      // The charter is the most public thing about a syndicate: a prospective member has to be
      // able to read the terms before it hands over goods it cannot retrieve, and §11.2 gives
      // PUBLIC to the standing legal shape of an organisation for exactly that reason.
      visibility: 'PUBLIC',
      audience: [],
      isPublic: true,
      publicAt: ctx.tick,
      declassifyAt: ctx.tick,
      provenanceClass: 'FACT',
      actedOnStateVersion: ctx.frozenStateVersion,
      decisionSource: req.decisionSource ?? null,
      payload: {
        syndicate: row.id,
        name: row.name,
        founder: req.principal,
        admission: charter.admission,
        decision: charter.decision,
        treasury_offices: charter.treasuryOffices,
      },
    });
    return { ok: true, value: null };
  }



  /**
   * Open an office proposal, because the charter requires more than one agreement.
   *
   * The proposal carries the terms **verbatim**, so the grant that eventually lands is the grant
   * that was approved — not a re-derivation from whatever the proposer sends later, which would let
   * an appointment be approved cheaply and then widened.
   */
  private proposeOffice(ctx: PhaseContext, req: ActionRequest, id: SyndicateId): WorldResult<null> {
    const delegate = readString(req.params, ['delegate', 'to', 'grantee']) as PrincipalId | null;
    if (delegate === null) return reject('A2', 'an office proposal needs {"delegate":"<principal>"}.');
    const terms: Record<string, number | string> = {};
    for (const key of ['template', 'max_direct_loss', 'max_contingent_liability', 'expires_tick']) {
      const value = req.params[key];
      if (typeof value === 'number' || typeof value === 'string') terms[key] = value;
    }
    let proposal;
    try {
      proposal = this.syndicateBook.propose({
        syndicate: id,
        proposer: req.principal,
        delegate,
        terms,
        tick: ctx.tick,
        ttl: PROPOSAL_TTL_TICKS,
      });
    } catch (error: unknown) {
      return reject('INV-26', describeError(error));
    }
    const needed = this.syndicateBook.approvalsNeeded(id, ctx.tick);
    this.emitRow({
      tick: ctx.tick,
      kind: 'syndicate.office_proposed',
      rulesVersion: RULES_VERSION,
      actorPrincipalId: req.principal,
      onBehalfOfPrincipalId: null,
      grantId: null,
      eventFamilyId: `syndicate::${id}`,
      parentEventId: null,
      // A pending appointment over a pooled treasury is exactly what a counterparty and an audience
      // need to see coming — and D9a already makes a grant's LIMITS and parties public, so a
      // proposal for one carries nothing the grant would not.
      visibility: 'PUBLIC',
      audience: [],
      isPublic: true,
      publicAt: ctx.tick,
      declassifyAt: ctx.tick,
      provenanceClass: 'FACT',
      actedOnStateVersion: ctx.frozenStateVersion,
      decisionSource: req.decisionSource ?? null,
      payload: {
        proposal: proposal.id,
        syndicate: id,
        delegate,
        proposer: req.principal,
        approvals: proposal.approvals.length,
        needed,
        expires_at_tick: proposal.expiresAtTick,
      },
    });
    // Carried already, if the proposer alone satisfies the rule (a one-member MAJORITY).
    if (this.syndicateBook.carries(proposal.id, ctx.tick)) {
      return this.carryOffice(ctx, proposal.id);
    }
    return { ok: true, value: null };
  }

  /**
   * `approve` — a sitting member agrees to a pending office.
   *
   * Idempotent, because approving twice is not two votes, and it costs an action either way.
   */
  private vApprove(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const proposalId = readString(req.params, ['proposal', 'id']);
    if (proposalId === null) {
      return reject(
        'A2',
        'approve needs {"proposal":"<id>"}. Open proposals for the syndicates you sit in are in your ' +
          'observation, each with how many approvals it has and how many it needs.',
      );
    }
    const proposal = this.syndicateBook.proposal(proposalId);
    if (proposal === null) {
      return reject('A2', `there is no open proposal ${proposalId}; it may have carried or lapsed.`);
    }
    if (ctx.tick >= proposal.expiresAtTick) {
      return reject(
        'A2',
        `${proposalId} lapsed at tick ${String(proposal.expiresAtTick)}. A proposal expires so that a ` +
          'majority is a majority of the members who are there NOW — propose it again if it still stands.',
      );
    }
    if (!this.syndicateBook.isMember(proposal.syndicate, req.principal, ctx.tick)) {
      return reject('A2', `you are not a sitting member of ${proposal.syndicate}, so your approval carries nothing.`);
    }
    this.syndicateBook.approve(proposalId, req.principal);
    if (this.syndicateBook.carries(proposalId, ctx.tick)) {
      return this.carryOffice(ctx, proposalId);
    }
    const row = this.syndicateBook.proposal(proposalId);
    this.emitRow({
      tick: ctx.tick,
      kind: 'syndicate.office_approved',
      rulesVersion: RULES_VERSION,
      actorPrincipalId: req.principal,
      onBehalfOfPrincipalId: null,
      grantId: null,
      eventFamilyId: `syndicate::${proposal.syndicate}`,
      parentEventId: null,
      visibility: 'PUBLIC',
      audience: [],
      isPublic: true,
      publicAt: ctx.tick,
      declassifyAt: ctx.tick,
      provenanceClass: 'FACT',
      actedOnStateVersion: ctx.frozenStateVersion,
      decisionSource: req.decisionSource ?? null,
      payload: {
        proposal: proposalId,
        syndicate: proposal.syndicate,
        approver: req.principal,
        approvals: row?.approvals.length ?? 0,
        needed: this.syndicateBook.approvalsNeeded(proposal.syndicate, ctx.tick),
      },
    });
    return { ok: true, value: null };
  }

  /**
   * The proposal carried: mint the office as an ordinary grant and close the proposal.
   *
   * Routed back through `vGrant` with the **stored** terms, so a carried appointment is
   * indistinguishable from a founder's — same limits, same INV-22/23, same authority line. The
   * terms come from the proposal rather than the request precisely so an approval cannot be
   * obtained cheaply and then spent on wider authority.
   */
  private carryOffice(ctx: PhaseContext, proposalId: string): WorldResult<null> {
    const proposal = this.syndicateBook.proposal(proposalId);
    if (proposal === null) return reject('A2', `${proposalId} is no longer open.`);
    this.syndicateBook.closeProposal(proposalId);
    return this.vGrant(ctx, {
      // The proposer is the actor of record: it is the member whose intention this was, and the
      // authority line should name it rather than whoever happened to cast the deciding approval.
      principal: proposal.proposer,
      verb: 'grant',
      params: {
        ...proposal.terms,
        delegate: proposal.delegate,
        // Named so `vGrant` resolves the grantor to the syndicate, and `carried_proposal` is the
        // receipt that the constitution was already satisfied — see the check in the fault path.
        on_behalf_of: proposal.syndicate,
        carried_proposal: proposalId,
      },
      // Not a live decision by anybody: the vote carried and the engine is executing the
      // consequence, so attributing it to a model would overstate what an agent did this tick.
      decisionSource: 'INTENT',
      intentId: proposalId,
    });
  }


  /**
   * Put earnings into a syndicate's pool.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **`freeCash`, BECAUSE THIS IS THE TRANSFER VERB THE GAME DELIBERATELY LACKED.**
   * D7's note is explicit that before the market existed the hole was hard to exploit
   * because *"there is no principal-to-principal transfer verb, and that absence was
   * quietly doing the work"*. A contribution is exactly such a transfer, and the pool can
   * be spent by an office-holder — so without this gate an operator founds a syndicate,
   * takes the office, and has every puppet contribute its endowment to a treasury it
   * controls. That is D7 reopened for the third time, and by the largest door yet.
   *
   * So a contribution spends **earnings only**. A puppet can pool nothing, and a real
   * agent's pooled capital is capital it produced — which is the whole distinction D7
   * draws and the reason the cession price draws it too.
   * ══════════════════════════════════════════════════════════════════════════
   */
  private contributeToSyndicate(
    ctx: PhaseContext,
    req: ActionRequest,
    id: SyndicateId,
  ): WorldResult<null> {
    const amount = readInt(req.params, ['stake', 'amount', 'contribute']);
    if (amount === null || amount <= 0) {
      return reject(
        'A2',
        `you are already a member of ${id}. To add to its pool send {"syndicate":"${id}","stake":N} — ` +
          'a positive integer of currency. It leaves your stores and becomes the syndicate\'s, and ' +
          'whether anyone can ever spend it is fixed by the charter clause `treasury_offices`, which ' +
          'cannot change. Read it before you pool anything.',
      );
    }
    const spendable = freeCash(this.ledger, req.principal);
    if (spendable < amount) {
      return reject(
        'A15',
        `you can pool ${String(spendable)} and asked to pool ${String(amount)}. That figure is your ` +
          'EARNINGS: locked stores do not count, and neither does the starter stake — a pooled treasury ' +
          'can be spent by an office-holder, so letting the grant reach it would make free enrolment into ' +
          'somebody else\'s capital (D7/A15). Earn it by hauling, trading or completing ventures.',
      );
    }
    const pooled = syndicateAsPrincipal(id);
    const account = storesAccount(pooled);
    if (this.ledger.account(account) === undefined) {
      this.ledger.openAccount(account, 'STORES', pooled);
    }
    try {
      this.ledger.transferCurrency({
        eventId: `syndicate.pool:${id}:${req.principal}:${String(ctx.tick)}` as EventId,
        tick: ctx.tick,
        from: storesAccount(req.principal),
        to: account,
        amount: minor(amount),
      });
    } catch (error: unknown) {
      return reject('INV-3', `the stake could not be pooled (${describeError(error)}); nothing moved.`);
    }
    this.emitRow({
      tick: ctx.tick,
      kind: 'syndicate.pooled',
      rulesVersion: RULES_VERSION,
      actorPrincipalId: req.principal,
      onBehalfOfPrincipalId: null,
      grantId: null,
      eventFamilyId: `syndicate::${id}`,
      parentEventId: null,
      // A pooled treasury is PUBLIC on §6.4's precedent — bond is "public, and any amount — it is
      // your credit rating" — and a contribution is what moves it. Hiding the inflow while
      // publishing the total would make the balance unexplainable.
      visibility: 'PUBLIC',
      audience: [],
      isPublic: true,
      publicAt: ctx.tick,
      declassifyAt: ctx.tick,
      provenanceClass: 'FACT',
      actedOnStateVersion: ctx.frozenStateVersion,
      decisionSource: req.decisionSource ?? null,
      payload: {
        syndicate: id,
        member: req.principal,
        staked: amount,
        treasury: this.ledger.balance(account),
      },
    });
    return { ok: true, value: null };
  }

  /**
   * `apply` — ask to be admitted. The charter decides what asking means.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **I TRIED TO REUSE `join` FOR THIS AND HARD RULE 4 IS EXACTLY WHY IT FAILED.** The argument
   * was that one verb is better because the charter already decides what an application means —
   * under `OPEN` it IS an admission, under `INVITE` a request a member answers, under `CLOSED`
   * neither — so making an agent choose between `apply` and `admit` per charter is choosing
   * between two spellings of one intention.
   *
   * That reasoning was fine and the verb was wrong. **`join` already means "answer a raid"**, and
   * §9 classifies it as a HOSTILE act: the A8 pre-check requires it to name the hand, holding,
   * principal or system it is aimed at, and refuses it outright inside the Commons. So `join
   * {"syndicate":…}` was rejected before reaching any of this — from the Commons, where every
   * principal starts, which is every case that matters.
   *
   * Hard rule 4 says never reuse a canon term for a second concept, and it is a *rules surface*
   * rather than a style guide. I argued for one verb on hard-rule-4 grounds and then picked the
   * one word the rule forbids. `apply` was reserved for this from the start.
   * ══════════════════════════════════════════════════════════════════════════
   */
  private vApply(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const named = readString(req.params, ['syndicate']);
    if (named === null) {
      return reject(
        'A2',
        'apply needs {"syndicate":"<id>"}. Syndicates and their charters are PUBLIC — read the charter ' +
          'off the feed first, because its terms can never change after you are inside.',
      );
    }
    const id = named as unknown as SyndicateId;
    const row = this.syndicateBook.at(id);
    // ── AN ALREADY-MEMBER APPLYING AGAIN IS CONTRIBUTING ──────────────────────
    //
    // **The syndicate treasury could hold value and nothing could put value in it.** Measured:
    // `syndicateAsPrincipal` appeared at exactly two call sites — one read the balance for the
    // frame, one opened the account at `form` — so every pool was permanently empty and every
    // office was standing authority over nothing. A6 at org scale had no stakes in it at all,
    // which is the same inertness as an unoffered verb, one layer deeper.
    //
    // Pooling is what membership MEANS (§365's "pooled stores"), so it rides on `apply` rather
    // than spending one of the 40 verb slots: applying puts you in, applying again deepens the
    // commitment. One concept, not two.
    //
    // **This block first landed in `officeGrantorFault` by accident**, because the three-line
    // `readString → SyndicateId → at(id)` shape appears in three methods and my edit matched the
    // first one. Every office appointment then routed into the contribution path and eight tests
    // went red. Anchored on `apply`'s own rejection text now, which is unique to this method.
    if (row !== null && this.syndicateBook.isMember(id, req.principal, ctx.tick)) {
      return this.contributeToSyndicate(ctx, req, id);
    }
    // ── AN ALREADY-MEMBER APPLYING AGAIN IS CONTRIBUTING ──────────────────────
    //
    // **The syndicate treasury could hold value and nothing could put value in it.** Measured:
    // `syndicateAsPrincipal` appeared at exactly two call sites — one reads the balance for the
    // frame, one opens the account at `form` — so every pool was permanently empty and every
    // office was standing authority over nothing. A6 at org scale had no stakes in it at all,
    // which makes the whole mechanic inert in the same way an unoffered verb is.
    //
    // Pooling is what membership MEANS (§365's "pooled stores"), so it rides on `apply` rather
    // than spending one of the 40 verb slots: applying puts you in, and applying again deepens
    // the commitment. One concept, not two.
    if (row !== null && this.syndicateBook.isMember(id, req.principal, ctx.tick)) {
      return this.contributeToSyndicate(ctx, req, id);
    }
    if (row === null) {
      return reject(
        'A2',
        `there is no syndicate ${named}. Syndicates and their charters are PUBLIC — read them off the ` +
          'feed before you ask to join one, because the terms cannot change after you are inside.',
      );
    }
    const fault = this.syndicateBook.admissionFault(id, req.principal, ctx.tick);
    if (fault !== null) return reject('A2', fault);

    // ── OPEN admits; INVITE records nothing and says who can answer ───────────
    //
    // Under INVITE the request is deliberately NOT stored. A pending-application queue is a
    // buffer that grows with enrolments, which is scar #3's shape, and it would need its own cap,
    // its own place in the hash and its own expiry. The `message` channel already exists for
    // asking — it is free, it is PARTIES-visible, and it declassifies at settlement, so an
    // approach and its answer end up in the record where a viewer can read them.
    if (row.charter.admission === 'INVITE') {
      return reject(
        'A2',
        `${named}'s charter is INVITE: a sitting member has to bring you in, and there is no ` +
          'application queue for me to put you in. Its members are ' +
          `${this.syndicateBook.sittingMembers(id, ctx.tick).join(' · ')} — \`message\` one of them, which ` +
          'costs no action, and it will admit you by naming you itself. What you say there becomes ' +
          'public at settlement, so it is also how you build the case.',
      );
    }

    try {
      this.syndicateBook.admit(id, req.principal, ctx.tick);
    } catch (error: unknown) {
      return reject('A2', describeError(error));
    }
    this.emitRow({
      tick: ctx.tick,
      kind: 'syndicate.joined',
      rulesVersion: RULES_VERSION,
      actorPrincipalId: req.principal,
      onBehalfOfPrincipalId: null,
      grantId: null,
      eventFamilyId: `syndicate::${row.id}`,
      parentEventId: null,
      // Membership is public for the same reason the charter is: it is what a counterparty prices
      // when it deals with any member, and §11.2 gives PUBLIC to an organisation's standing shape.
      visibility: 'PUBLIC',
      audience: [],
      isPublic: true,
      publicAt: ctx.tick,
      declassifyAt: ctx.tick,
      provenanceClass: 'FACT',
      actedOnStateVersion: ctx.frozenStateVersion,
      decisionSource: req.decisionSource ?? null,
      payload: {
        syndicate: row.id,
        member: req.principal,
        members: this.syndicateBook.sittingMembers(id, ctx.tick).length,
        admission: row.charter.admission,
      },
    });
    return { ok: true, value: null };
  }

  /**
   * `admit` — a sitting member brings somebody in under an INVITE charter.
   *
   * The counterpart to `join`'s refusal, and the reason that refusal can name a concrete next
   * step instead of an apology.
   */
  private vAdmit(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const named = readString(req.params, ['syndicate']);
    const who = readString(req.params, ['principal', 'member', 'admit', 'who']) as PrincipalId | null;
    if (named === null || who === null) {
      return reject(
        'A2',
        'admit needs {"syndicate":"<id>","principal":"<who>"}. You must be a sitting member, and the ' +
          "charter's admission rule decides whether you may bring anyone in at all.",
      );
    }
    const id = named as unknown as SyndicateId;
    const row = this.syndicateBook.at(id);
    if (row === null) return reject('A2', `there is no syndicate ${named}.`);
    if (!this.syndicateBook.isMember(id, req.principal, ctx.tick)) {
      return reject('A2', `you are not a sitting member of ${named}, so you cannot admit anyone to it.`);
    }
    if (row.charter.admission === 'CLOSED') {
      return reject(
        'A2',
        `${named}'s charter is CLOSED: its founding membership is final and nobody may ever be admitted. ` +
          'That clause is permanent and no vote changes it.',
      );
    }
    if (this.world.holdingByPrincipal.get(who) === undefined) {
      return reject('A2', `there is no principal ${who} to admit; name one that has enrolled.`);
    }
    const fault = this.syndicateBook.admissionFault(id, who, ctx.tick);
    if (fault !== null) return reject('A2', fault);
    try {
      this.syndicateBook.admit(id, who, ctx.tick);
    } catch (error: unknown) {
      return reject('A2', describeError(error));
    }
    this.emitRow({
      tick: ctx.tick,
      kind: 'syndicate.joined',
      rulesVersion: RULES_VERSION,
      actorPrincipalId: req.principal,
      onBehalfOfPrincipalId: null,
      grantId: null,
      eventFamilyId: `syndicate::${row.id}`,
      parentEventId: null,
      visibility: 'PUBLIC',
      audience: [],
      isPublic: true,
      publicAt: ctx.tick,
      declassifyAt: ctx.tick,
      provenanceClass: 'FACT',
      actedOnStateVersion: ctx.frozenStateVersion,
      decisionSource: req.decisionSource ?? null,
      payload: {
        syndicate: row.id,
        member: who,
        admitted_by: req.principal,
        members: this.syndicateBook.sittingMembers(id, ctx.tick).length,
        admission: row.charter.admission,
      },
    });
    return { ok: true, value: null };
  }

  // ── WORKS: the production structure (§10.2, A15) ─────────────────────────

  /** Every live WORKS this principal holds. Read by `observe` and by the frame. */
  worksOf(principal: PrincipalId): readonly { readonly id: string; readonly system: SystemId; readonly online: boolean; readonly extracted: number }[] {
    return this.worksBook.ofPrincipal(principal).map((w) => ({
      id: w.id,
      system: w.system,
      online: this.engine.tick >= w.onlineAtTick,
      extracted: w.extracted,
    }));
  }

  /** The book itself, for the invariant pass and the tests. */
  get works(): WorksBook {
    return this.worksBook;
  }

  /**
   * What one more WORKS at `system` would extract per tick, and what it costs.
   *
   * **ONE HOME, THREE READERS** — the affordance in `api/observe.ts`, the `works` block of
   * the observation, and {@link Runtime.vBuildWorks}. The share falls as a place fills up, so
   * an agent that is quoted the *empty* rate and then extracts a third of it was misled about
   * the only number that decides whether the build pays for itself (A2).
   */
  worksQuote(principal: PrincipalId, system: SystemId): {
    readonly system: SystemId;
    readonly tier: ZoneTier;
    /** Named here, not in the affordance string: one home for what a WORKS extracts. */
    readonly good: GoodId;
    readonly yieldPerTick: number;
    readonly occupants: number;
    /**
     * What this principal would **keep** per tick once online, at today's crowding and rent.
     *
     * ══════════════════════════════════════════════════════════════════════════
     * **NET OF RENT, AND THE GROSS IS PUBLISHED BESIDE IT.** `agent.md` calls this *"the number
     * that decides whether the build pays for itself"* and `api/observe.ts` multiplies it by 288
     * to state what a WORKS RETURNS. A claim-holder now takes a published share of everything
     * extracted at its system, so the gross would overstate that return by the rent — and a probe
     * had already lost a third of its expected income to this field being divided by the wrong
     * occupancy. The lesson taken was that the field must answer the question it is documented as
     * answering, not the one that is easiest to compute.
     * ══════════════════════════════════════════════════════════════════════════
     */
    readonly sharePerTick: number;
    /** Before the rent. `grossPerTick - rentPerTick === sharePerTick`, exactly. */
    readonly grossPerTick: number;
    /** What the claim-holder here would take, per tick. Zero on unclaimed ground. */
    readonly rentPerTick: number;
    /** The published rate that would apply to YOU here, in bps. Zero if none would. */
    readonly rentBps: number;
    /** Who would take it, or null. Named, because the rent is a relationship, not a tax. */
    readonly rentTo: PrincipalId | null;
    readonly costMinor: Minor;
    readonly costQty: Qty;
    readonly freeMinor: Minor;
    readonly availableQty: Qty;
    readonly spinupTicks: number;
    readonly alreadyHeld: boolean;
    readonly affordable: boolean;
    /** The FUEL good this place also yields, and what one more WORKS would take of it. */
    readonly fuelGood: GoodId;
    readonly fuelYieldPerTick: number;
    /**
     * What YOURS would take per tick in fuel, counting itself. **Zero outside the Frontier.**
     *
     * Published beside the ore share because it is the only reason to prefer frontier ground over
     * a quieter Marches system beyond the raw yield: fuel is the one good some agents need and
     * cannot make, and this number is the whole of an agent's access to it. A quote that named the
     * ore and not the fuel would understate the frontier's premium by everything that is new.
     */
    readonly fuelSharePerTick: number;
  } {
    const tier = tierOf(this.world.map, system);
    const occupants = this.worksBook.liveAt(system).length;
    // ── WHY THIS IS `freeBalance` AND THE CESSION PRICE IS `freeCash` ────────
    //
    // The first version used `freeCash` here, reasoning that a WORKS is permanent income and
    // free enrolment must not buy permanent income. Measured against the live world, that made
    // the mechanic **unreachable**: `worksAffordableBy` read 0 of 21 principals, because the
    // floor withholds the WHOLE starter stake and a principal that has graduated has less free
    // than the floor. The economy's only faucet was correct, tested, offered, rendered — and
    // dead.
    //
    // The gate was also the wrong reading of D7. D7's rule is that the endowment **cannot leave
    // a principal**, and it exists because a sock puppet handing its stake to its operator turns
    // free identities into capital. A WORKS build does not transfer: `retireCurrency` destroys
    // the money into `sink:upkeep`. A puppet that spends its stake here gives its operator
    // nothing, and ends holding a structure it must still play to use.
    //
    // The indirect route — puppet extracts, then sells to its operator — is real, and it is
    // bounded by the thing that was always the actual defence: **a place yields what it yields**.
    // N puppets at one system split one yield, and across the map the ceiling is the number of
    // systems, not the number of identities. That is A15's requirement met by the map rather
    // than by a price, which is why the price was never load-bearing here.
    //
    // The cession price keeps `freeCash`, and the distinction is exact: that one **pays another
    // principal**. Retirement and transfer are different acts and only one of them is D7's.
    const free = this.ledger.account(storesAccount(principal)) === undefined
      ? minor(0)
      : this.ledger.freeBalance(storesAccount(principal));
    const available = this.chargeGoodAt(principal, system);
    // ── DIVIDED BY THE OCCUPANTS THIS BUILD WOULD MAKE — UNLESS YOU ALREADY HOLD ONE ──
    //
    // `occupants + 1` is right for a PROSPECTIVE build: quoting the pre-arrival share overstates the
    // return of every build into a crowded place. It is wrong once you already hold one, and both
    // probes caught it: sole occupant of a COMMONS system taking the full 80, quoted 40 (and with a
    // second occupant, taking 40 and quoted 26). `agent.md` calls this "what YOURS would take,
    // counting itself" and "the number that decides whether the build pays for itself", so an agent
    // budgeting off it under-plans its income by a third.
    const quotedGross = Math.trunc(
      YIELD_PER_TICK[tier] /
        (this.worksBook.ofPrincipal(principal).length > 0 ? Math.max(1, occupants) : occupants + 1),
    );
    const quotedTerms = this.rentTermsAt(system);
    const quotedSplit = rentOn({ terms: quotedTerms, extractor: principal, gross: qty(quotedGross) });
    return {
      system,
      tier,
      // ── THE GOOD A WORKS *YIELDS*, NOT THE ONE IT COSTS ─────────────────────
      //
      // This said `WORKS_GOOD` — the good the build CONSUMES — while a WORKS now yields
      // `WORKS_YIELD_GOOD`. Two blind probes hit it independently: the affordance read "yields 80
      // units of RATION a tick… returns about 23,040 units of RATION every Reckoning", so an agent
      // plans its Levy off that figure and arrives at the Reckoning holding ORE, which settles nothing.
      // One of them named it exactly: scar #1 reproduced — engine and agent-facing text disagreeing
      // about one word, each individually coherent.
      //
      // `costQty`/`availableQty` below are the COST side and stay in `WORKS_GOOD`
      // (`chargeGoodAt` measures that good). The two were only ever equal by accident.
      good: WORKS_YIELD_GOOD,
      yieldPerTick: YIELD_PER_TICK[tier],
      occupants,
      // ── THE CROWDING DIVISION IS ABOVE; THE RENT COMES OFF IT HERE ──────────
      //
      // Split with the SAME function the PRODUCE phase uses, so the quote and the ledger cannot
      // disagree about what a build here actually earns. `rentTermsAt` answers null on unclaimed
      // ground and `rentOn` answers zero when the reader IS the claim-holder, so a landlord
      // building on its own claim is quoted the whole share — which is the truth, and it is also
      // the strongest argument in the game for owning the ground you work.
      sharePerTick: quotedSplit.net,
      grossPerTick: quotedGross,
      rentPerTick: quotedSplit.rent,
      rentBps: rentApplies(quotedTerms, principal) ? (quotedTerms?.bps ?? 0) : 0,
      rentTo: rentApplies(quotedTerms, principal) ? (quotedTerms?.claimant ?? null) : null,
      costMinor: WORKS_COST_MINOR,
      costQty: WORKS_BUILD_QTY,
      freeMinor: free,
      availableQty: available,
      spinupTicks: WORKS_SPINUP_TICKS,
      alreadyHeld: this.worksBook.atCapacity(principal, system),
      affordable: free >= WORKS_COST_MINOR && available >= WORKS_BUILD_QTY,
      fuelGood: FUEL_GOOD,
      fuelYieldPerTick: FUEL_YIELD_PER_TICK[tier],
      // Divided the same way the ore share is — `occupants + 1` for a prospective build, the live
      // occupancy once you already hold one — because two divisions of the same occupancy is how
      // one number ends up telling an agent two things.
      fuelSharePerTick: Math.trunc(
        FUEL_YIELD_PER_TICK[tier] /
          (this.worksBook.ofPrincipal(principal).length > 0 ? Math.max(1, occupants) : occupants + 1),
      ),
    };
  }

  /**
   * Raise a WORKS.
   *
   * The order is the honesty, exactly as `vGraduate` and `vDeliver` state it: refuse on every
   * ground first, then charge, then record. A build that took the currency and then failed on
   * the goods would leave a principal poorer with nothing standing.
   */
  private vBuildWorks(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const holdingRow = this.world.holdingByPrincipal.get(req.principal);
    if (holdingRow === undefined) {
      return reject('A2', `${req.principal} has no holding, so there is nowhere to raise a WORKS.`);
    }
    const holding = holdingOf(this.world, req.principal);
    const system = (readString(req.params, ['system', 'system_id', 'at', 'where']) ?? holding.system) as SystemId;
    if (this.world.map.systems.get(system) === undefined) {
      return reject('A2', `${system} is not a system on this map.`);
    }
    // A WORKS is worked where your body is. Same rule as an ANCHOR, and for the same reason:
    // otherwise a principal owns extraction everywhere and presence means nothing.
    if (holding.system !== system) {
      return reject(
        'A2',
        `a WORKS is raised where your BODY stands, and your holding is at ${holding.system}. ` +
          `Move it with \`graduate\` — or raise the WORKS at ${holding.system} instead.`,
      );
    }
    const quote = this.worksQuote(req.principal, system);
    if (quote.alreadyHeld) {
      return reject(
        'A15',
        `you already hold a WORKS at ${system}, and a place yields the same total however many stand on ` +
          'it — a second one of yours would only divide your own share. Raise it somewhere else.',
      );
    }
    if (quote.freeMinor < quote.costMinor) {
      return reject(
        'A15',
        `a WORKS costs ${String(quote.costMinor)} and you have ${String(quote.freeMinor)} free (locked ` +
          'stores do not count). Your starter stake CAN pay for this one: the money is retired, not paid ' +
          'to anybody, so your first WORKS is reachable before you have earned anything. What the stake ' +
          'cannot buy is a claim from another principal — that price leaves you and goes to them.',
      );
    }
    if (quote.availableQty < quote.costQty) {
      return reject(
        'A15',
        `a WORKS also consumes ${String(quote.costQty)} units of ${WORKS_GOOD} standing at ${system}, and you ` +
          `have ${String(quote.availableQty)} unpledged there. They are destroyed into the build, not stored.`,
      );
    }

    try {
      this.ledger.retireCurrency({
        eventId: `works.build:${system}:${String(ctx.tick)}:${req.principal}` as EventId,
        tick: ctx.tick,
        from: storesAccount(req.principal),
        amount: quote.costMinor,
        sink: CURRENCY_SINK.UPKEEP,
      });
    } catch (error: unknown) {
      return reject(
        'INV-3',
        `the WORKS cost could not be paid (${describeError(error)}); nothing moved and nothing was raised.`,
      );
    }
    const burned = this.burnAnchorGoods(req.principal, system, quote.costQty, ctx.tick);
    if (burned < quote.costQty) {
      this.faults.push(
        `${req.principal} raised only ${String(burned)} of the ${String(quote.costQty)} units a WORKS at ` +
          `${system} consumes; the WORKS was not raised`,
      );
      return reject('INV-3', 'the WORKS materials could not be raised; nothing was built.');
    }

    const row = this.worksBook.raise({ system, holder: req.principal, tick: ctx.tick });
    this.emitRow({
      tick: ctx.tick,
      kind: 'works.raised',
      rulesVersion: RULES_VERSION,
      visibility: 'PUBLIC',
      audience: [],
      actorPrincipalId: req.principal,
      onBehalfOfPrincipalId: null,
      grantId: null,
      eventFamilyId: `works::${row.id}`,
      parentEventId: null,
      isPublic: true,
      publicAt: ctx.tick,
      declassifyAt: ctx.tick,
      provenanceClass: 'FACT',
      actedOnStateVersion: ctx.frozenStateVersion,
      decisionSource: req.decisionSource ?? null,
      // ── NO DERIVED QUANTITIES IN THE PAYLOAD (scar #5, and a replay hazard) ──
      //
      // This carried `share_per_tick` and `occupants`, both computed by `worksQuote` at the instant
      // of the build. The event ledger is HASHED STATE, so freezing a derivation into it makes
      // `state_hash` sensitive to how that derivation was reached — and `checkpoint-adoption-audit`
      // tripped exactly there once the heuristic cast started building. The build was ACCEPTED on
      // replay (the error was `TRIPWIRE`, not `APPLIED_REFUSED`, so no gate flipped) and the state
      // still differed, which points at the payload rather than the decision.
      //
      // It is also scar #5 on its own terms — one quantity with two homes. Both numbers are
      // recomputable at any time from the map and the works book, and the frame's `worksLines`
      // already publishes the live share and occupancy. An event should record what HAPPENED
      // (this principal raised a WORKS here, and it comes online then), never a snapshot of what
      // was derivable at the time.
      payload: {
        works: row.id,
        system,
        holder: req.principal,
        tier: quote.tier,
        online_at_tick: row.onlineAtTick,
      },
    });
    return { ok: true, value: null };
  }

  /**
   * One tick of extraction. Bounded by the map, never by the population.
   *
   * Nothing here draws from the RNG, so filling the PRODUCE slot could not shift another
   * phase's seeded sub-stream — the promise the no-op hook was reserved to keep.
   */
  private produceNow(ctx: PhaseContext): void {
    const rows = produceNow({
      book: this.worksBook,
      ledger: this.ledger,
      map: this.world.map,
      tick: ctx.tick,
      reckoning: reckoningOf(ctx.tick),
      // The rent, read off the claim record at the one place the goods actually move. See
      // `rentTermsAt`: unclaimed ground and an ended claim both answer null, so a landlord that
      // lost the system stops collecting on the same tick it lost it.
      rentAt: (system) => this.rentTermsAt(system),
      fuelAnchor: (args) => this.lightAnchorWithFuel(args),
    });
    // ── EXTRACTION IS A ROUTINE TICK AND EMITS NO EVENT ───────────────────────
    //
    // This emitted one `PUBLIC` event per WORKS per TICK, and `soak.test.ts` caught it the moment
    // the heuristic cast started building: the event ledger went from 204 rows to 2,194 in the same
    // run. At 288 ticks a Reckoning across a 30-system map that is an unbounded flood into the
    // PERMANENT record, for the least interesting thing in the game.
    //
    // A3 already draws this line: *"Jobs and operations are durable intents with stop conditions.
    // Creating one costs an action; its routine ticks do not."* Raising a WORKS is the decision and
    // keeps its event; extracting from it is the routine tick.
    //
    // Nothing is lost. The **postings** record every unit that moved and INV-7 reconciles them, so
    // the value is auditable to the minor unit. The **frame** carries cumulative `extracted` per
    // WORKS, so a viewer sees the total. What disappears is a per-tick narration nobody reads,
    // which is the definition of noise in an append-only record.
    void rows;
  }

  /**
   * `build` — raise an ANCHOR and take a claim (§6.3, A15).
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THE ORDER IS THE HONESTY**, exactly as it is in `vGraduate` and `vDeliver`:
   *
   *   1. **Refuse on the merits first**, with a sentence, before anything moves.
   *   2. **Pay the cession price** if there is one, so the incumbent is made whole before it
   *      loses the claim.
   *   3. **Destroy the anchor goods where they stand**, and let the ledger be the authority on
   *      whether they moved.
   *   4. **Record the claim only if the whole price was paid.**
   *
   * A partial anchor is refused rather than completed at a discount. The pre-validation makes
   * that unreachable, and the one thing that must never happen is territory taken for free.
   * ══════════════════════════════════════════════════════════════════════════
   */
  private vBuild(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const kind = (readString(req.params, ['kind', 'what', 'structure']) ?? 'ANCHOR').toUpperCase();
    if (kind === 'WORKS') return this.vBuildWorks(ctx, req);
    if (kind === 'HULL') return this.vBuildHull(ctx, req);
    if (kind !== 'ANCHOR') {
      return reject(
        'PHASE-0',
        `\`build\` raises an ANCHOR or a WORKS. An ANCHOR takes territory; a WORKS extracts what a place ` +
          `yields. Send {"kind":"ANCHOR","system":"<id>"} or {"kind":"WORKS","system":"<id>"}. ` +
          SOVEREIGNTY_STATEMENT,
      );
    }
    const system = readString(req.params, ['system', 'system_id', 'at', 'where']) as SystemId | null;
    if (system === null) {
      const holding = this.world.holdingByPrincipal.get(req.principal) === undefined
        ? null
        : holdingOf(this.world, req.principal);
      return reject(
        'A2',
        'build needs {"kind":"ANCHOR","system":"<system_id>"}. A claim is anchored where your BODY stands' +
          `${holding === null ? '' : `, which is ${holding.system} (${tierOf(this.world.map, holding.system)})`}. ` +
          SOVEREIGNTY_STATEMENT,
      );
    }
    const account = storesAccount(req.principal);
    // ── THE CESSION PRICE IS A TRANSFER, SO IT IS PAID OUT OF EARNINGS ───────
    //
    // ══════════════════════════════════════════════════════════════════════════
    // **`freeCash`, NOT `freeBalance`, AND THE RAW BALANCE WAS D7 REOPENED.** §12.5 mints a
    // 250,000 `STARTER_STAKE` to every free identity, and `ledger/endowment.ts` withholds it
    // from leaving the principal: *"the endowment funds a principal's own work — its
    // ventures, its Levy, its hauling — and cannot leave it."* Every other value flow in
    // sovereignty obeys that for free because it never crosses a principal boundary — the
    // anchor is DESTROYED, the Charge is DESTROYED, the bond is LOCKED in the poster's own
    // stores, and both the salvage and the slash are RETIRED. The cession price is the one
    // exception: it is a principal-to-principal `transferCurrency`.
    //
    // Measured through the front door, against the raw free balance: an operator claimed a
    // system, a fresh puppet enrolled, graduated to it and posted its bond, the operator
    // published `{"cede":sys,"price":150000}`, and the puppet's `build` moved **150,000 of
    // pure endowment** to the operator with no correction — while `freeCash` for that puppet
    // was **0**. That is `market/escrow.ts`'s own sock-puppet extraction with a claim in
    // place of a wash trade, and it scales linearly in identities (A15).
    //
    // Withholding credit is the sanctioned defence and this is it: a principal may buy
    // territory with what it has EARNED, at any price, and may not buy it with the stake the
    // world gave it for free. A solo agent that has traded or hauled is unaffected.
    // ══════════════════════════════════════════════════════════════════════════
    const free = freeCash(this.ledger, req.principal);
    const fault = claimRejection({
      book: this.sovereignty,
      map: this.world.map,
      world: this.world,
      principal: req.principal,
      system,
      tick: ctx.tick,
      anchorAvailable: this.chargeGoodAt(req.principal, system),
      bondRead: this.bondRead(),
      freeMinor: free,
    });
    if (fault !== null) return fault;

    const route = claimRouteFor(this.sovereignty, system, ctx.tick);
    const incumbent = this.sovereignty.liveAt(system);
    const offer = this.sovereignty.cessionAt(system);

    // ── Step 2: the incumbent is paid before it loses anything ──────────────
    if (route === 'CESSION' && offer !== null && offer.price > 0) {
      try {
        this.ledger.transferCurrency({
          eventId: `claim.cession:${system}:${String(ctx.tick)}:${req.principal}` as EventId,
          tick: ctx.tick,
          from: account,
          to: storesAccount(offer.by),
          amount: offer.price,
        });
      } catch (error: unknown) {
        return reject(
          'INV-3',
          `the cession price of ${String(offer.price)} could not be paid to ${offer.by} ` +
            `(${describeError(error)}); nothing moved and the claim is still theirs.`,
        );
      }
    }

    // ── Step 3: the anchor, burned where it stands ──────────────────────────
    const burned = this.burnAnchorGoods(req.principal, system, ANCHOR_QTY, ctx.tick);
    if (burned < ANCHOR_QTY) {
      this.faults.push(
        `${req.principal} could only raise ${String(burned)} of the ${String(ANCHOR_QTY)} unit anchor at ` +
          `${system}; the claim was not taken`,
      );
      return reject(
        'A15',
        `only ${String(burned)} of the ${String(ANCHOR_QTY)} units of ${CHARGE_GOOD} could be put into the ` +
          'anchor, so the claim was not taken. Check what is standing at that system and try again.',
      );
    }

    // ── Step 4: the claim ───────────────────────────────────────────────────
    const bondLock = this.sovereignty.bondLocksOf(req.principal)[0] ?? null;
    let claim: ClaimRecord;
    try {
      if (incumbent !== null) {
        // A takeover or a cession. **The arrears do not reset** — they belong to the system,
        // which closes the critic's "transfer to reset the consecutive-miss counter" exploit.
        claim = this.sovereignty.succeed(system, req.principal, bondLock);
      } else {
        const epoch = this.sovereignty.nextEpochFor(system);
        claim = {
          id: claimIdFor(system, epoch),
          system,
          constellation: (this.world.map.systems.get(system)?.constellation ?? '') as ConstellationId,
          claimant: req.principal,
          epoch,
          takenAtTick: ctx.tick,
          anchorQty: ANCHOR_QTY,
          // Pinned at the published rate the moment the claim is raised, and never re-read. A
          // takeover goes through `succeed`, which does not touch it: the rate a resident read
          // before spending 60,000 on a WORKS survives the ground changing hands, which is what
          // makes `worksQuote`'s published return something an agent can plan against.
          rentBps: CLAIM_RENT_BPS,
          bondEncumbranceId: bondLock,
          state: 'SUPPLIED',
          endedAtReckoning: null,
          succeededBy: null,
        };
        this.sovereignty.take(claim);
      }
    } catch (error: unknown) {
      this.faults.push(
        `${req.principal} burned ${String(burned)} of ${CHARGE_GOOD} at ${system} and the claim could not be ` +
          `recorded (${describeError(error)})`,
      );
      return reject('A2', describeError(error));
    }

    this.emitRow({
      tick: ctx.tick,
      kind: incumbent === null ? 'claim.taken' : 'claim.succeeded',
      rulesVersion: RULES_VERSION,
      actorPrincipalId: req.principal,
      onBehalfOfPrincipalId: incumbent?.claimant ?? null,
      grantId: null,
      eventFamilyId: `claim::${system}`,
      parentEventId: null,
      // §11.2 gives PUBLIC to territorial control, and A13 makes the claim a named signature:
      // "a claim tints a system". Territory nobody can see is not territory.
      isPublic: true,
      publicAt: ctx.tick,
      declassifyAt: ctx.tick,
      provenanceClass: 'FACT',
      actedOnStateVersion: ctx.frozenStateVersion,
      decisionSource: req.decisionSource,
      payload: {
        claim: claim.id,
        system,
        tier: tierOf(this.world.map, system),
        claimant: req.principal,
        from: incumbent?.claimant ?? null,
        route,
        anchorQty: burned,
        good: CHARGE_GOOD,
        priceMinor: route === 'CESSION' ? (offer?.price ?? 0) : 0,
        bondRequiredMinor: requiredBondOf(this.sovereignty, req.principal),
        bondPostedMinor: postedBondOf(this.sovereignty, req.principal, this.bondRead()),
        // Inherited, and said out loud on the receipt: a buyer or a conqueror takes the
        // arrears with the ground.
        arrearsInherited: this.sovereignty.missesAt(system),
        state: claim.state,
      },
      visibility: 'PUBLIC',
      audience: [],
    });
    if (incumbent !== null) {
      this.raidTicker.push(
        claimTickerLine({
          kind: 'CEDED',
          system,
          claimant: incumbent.claimant,
          other: req.principal,
          amount: offer?.price ?? 0,
        }),
      );
    } else {
      this.raidTicker.push(
        claimTickerLine({ kind: 'TAKEN', system, claimant: req.principal, other: null, amount: 0 }),
      );
    }
    return { ok: true, value: null };
  }

  /**
   * Burn the anchor, **where the goods are standing** (§10.2).
   *
   * Never relocates. That is the entire answer to the economic critic's teleport exploit: the
   * lots that pay are lots already at the system, and they are destroyed there, so a remote
   * stockpile cannot ride in behind a blockade on a payment. Returns what actually moved;
   * never throws, for `consumeLevyGood`'s reason.
   */
  private burnAnchorGoods(
    principal: PrincipalId,
    system: SystemId,
    want: Qty,
    tick: number,
  ): Qty {
    let left: number = want;
    let taken = 0;
    for (const lot of this.chargeGoodLotsAt(principal, system)) {
      if (left <= 0) break;
      const portion = Math.min(left, lot.qty);
      if (portion <= 0) continue;
      try {
        this.ledger.destroyGoods({
          eventId: `claim.anchor:${principal}:${String(tick)}:${system}:${lot.id}` as EventId,
          tick,
          sink: GOODS_SINK.CONSUMPTION,
          lotId: lot.id,
          qty: qty(portion),
        });
      } catch (error: unknown) {
        this.faults.push(
          `${principal} could not put ${String(portion)} of ${CHARGE_GOOD} into an anchor at ${system} ` +
            `(${describeError(error)}); only what actually moved is charged`,
        );
        continue;
      }
      taken += portion;
      left -= portion;
    }
    return qty(taken);
  }

  /**
   * The Charge half of `deliver`. Reached when the action names `obligation: "CHARGE"`.
   *
   * Three things in a fixed order, because the order keeps the record honest (A5′): refuse on
   * the merits, **destroy** the goods, credit exactly what was destroyed. A handler that
   * credited first would record a payment that did not happen.
   */
  private deliverCharge(ctx: PhaseContext, req: ActionRequest, system: SystemId): WorldResult<null> {
    const reckoning = reckoningOf(ctx.tick);
    const claim = this.sovereignty.liveAt(system);
    if (claim === null) {
      return reject(
        'A2',
        `there is no live claim on ${system}, so there is no Charge to deliver against. ${CHARGE_STATEMENT}`,
      );
    }
    const owing = this.sovereignty.owingOf(reckoning, claim.system);
    const available = this.chargeGoodAt(req.principal, system);
    const fault = chargeDeliveryFault({
      world: this.world,
      deliverer: req.principal,
      claim,
      tick: ctx.tick,
      owed: owing.owed,
      available,
    });
    if (fault !== null) return reject('A14', fault);

    const asked = readInt(req.params, ['amount', 'qty', 'quantity']);
    const want = qty(Math.min(owing.owed, available, asked === null ? owing.owed : Math.max(0, asked)));
    if (want <= 0) {
      return reject(
        'A14',
        `nothing of that delivery can be credited: ${String(owing.owed)} of ${CHARGE_GOOD} is still owed on ` +
          `${system} and you hold ${String(available)} unpledged there.`,
      );
    }

    const moved = this.burnAnchorGoods(req.principal, system, want, ctx.tick);
    if (moved <= 0) {
      return reject('A14', 'the goods could not be handed over, so nothing was credited against the Charge.');
    }
    this.sovereignty.credit(reckoning, claim.system, moved);
    const after = this.sovereignty.owingOf(reckoning, claim.system);

    this.emitRow({
      tick: ctx.tick,
      kind: 'charge.delivered',
      rulesVersion: RULES_VERSION,
      actorPrincipalId: req.principal,
      onBehalfOfPrincipalId: req.principal === claim.claimant ? null : claim.claimant,
      grantId: null,
      eventFamilyId: `claim::${system}`,
      parentEventId: null,
      isPublic: true,
      publicAt: ctx.tick,
      declassifyAt: ctx.tick,
      provenanceClass: 'FACT',
      actedOnStateVersion: ctx.frozenStateVersion,
      decisionSource: req.decisionSource,
      payload: {
        claim: claim.id,
        system,
        claimant: claim.claimant,
        deliverer: req.principal,
        good: CHARGE_GOOD,
        qty: moved,
        // Partial payment counts, and the receipt says so: this is the field that makes the
        // arc an arc rather than a cliff.
        stillOwedQty: after.owed,
        // A rescue is a story, so it is a field a viewer's client can read directly rather
        // than something a reader has to infer by comparing two principal ids.
        rescue: req.principal !== claim.claimant,
      },
      visibility: 'PUBLIC',
      audience: [],
    });
    if (req.principal !== claim.claimant && after.owed <= 0) {
      this.raidTicker.push(
        claimTickerLine({
          kind: 'RESCUED',
          system,
          claimant: claim.claimant,
          other: req.principal,
          amount: moved,
        }),
      );
    }
    return { ok: true, value: null };
  }

  /** The Charge allocation ballot. Reached from `vVote` when the ballot names CHARGE. */
  private voteCharge(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const rule = readString(req.params, ['rule', 'allocation', 'formula']) ?? '';
    const spare = readString(req.params, ['spare', 'spare_principal', 'relieve']);
    const fault = chargeVoteFault({
      book: this.sovereignty,
      voter: req.principal,
      rule,
      spare,
      tick: ctx.tick,
    });
    if (fault !== null) return reject('A14', fault);
    if (!isChargeRule(rule)) {
      // Unreachable: `chargeVoteFault` checks the rule first. Kept because the cast below is a
      // narrowing rather than a check, and a future edit that reordered the fault function
      // would otherwise write an unvalidated rule into a hashed structure.
      return reject('A2', `${rule} is not a published Charge allocation rule.`);
    }
    const ballot = chargeBallotFor({
      book: this.sovereignty,
      voter: req.principal,
      rule,
      spare: spare as PrincipalId | null,
      tick: ctx.tick,
    });
    if (ballot === null) return reject('A2', 'you hold no claim, so you have no Charge ballot to cast.');
    try {
      this.sovereignty.castBallot(ballot);
    } catch (error: unknown) {
      return reject('INV-26', describeError(error));
    }
    this.emitRow({
      tick: ctx.tick,
      kind: 'charge.voted',
      rulesVersion: RULES_VERSION,
      actorPrincipalId: req.principal,
      onBehalfOfPrincipalId: null,
      grantId: null,
      eventFamilyId: `charge::${String(ballot.forReckoning)}::${ballot.constellation}`,
      parentEventId: null,
      isPublic: true,
      publicAt: ctx.tick,
      declassifyAt: ctx.tick,
      provenanceClass: 'FACT',
      actedOnStateVersion: ctx.frozenStateVersion,
      decisionSource: req.decisionSource,
      // A ballot is PUBLIC in full (§12.2: "all resolve at a Reckoning; all are PUBLIC"), which
      // is what lets a viewer read the coalition off the feed — AGT-X4's pass criterion is that
      // a cartel is *visible* while it succeeds, not that it fails.
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

  /** Publish a claim for sale. The fire sale, and it is PUBLIC because it is the story. */
  private offerCession(ctx: PhaseContext, req: ActionRequest, system: SystemId): WorldResult<null> {
    const price = readInt(req.params, ['price', 'amount', 'ask']);
    const fault = cessionRejection({
      book: this.sovereignty,
      principal: req.principal,
      system,
      price,
      tick: ctx.tick,
    });
    if (fault !== null) return fault;
    const claim = this.sovereignty.liveAt(system);
    if (claim === null || price === null) {
      // Unreachable: `cessionRejection` checks both. Kept as a narrowing rather than a `!`.
      return reject('A2', `there is no live claim on ${system} to cede.`);
    }
    this.sovereignty.offerCession({
      system,
      claim: claim.id,
      by: req.principal,
      price: minor(price),
      openedAtTick: ctx.tick,
    });
    this.emitRow({
      tick: ctx.tick,
      kind: 'cession.offered',
      rulesVersion: RULES_VERSION,
      actorPrincipalId: req.principal,
      onBehalfOfPrincipalId: null,
      grantId: null,
      eventFamilyId: `claim::${system}`,
      parentEventId: null,
      isPublic: true,
      publicAt: ctx.tick,
      declassifyAt: ctx.tick,
      provenanceClass: 'FACT',
      actedOnStateVersion: ctx.frozenStateVersion,
      decisionSource: req.decisionSource,
      payload: {
        claim: claim.id,
        system,
        by: req.principal,
        priceMinor: price,
        state: claim.state,
        arrears: this.sovereignty.missesAt(system),
      },
      visibility: 'PUBLIC',
      audience: [],
    });
    this.raidTicker.push(
      claimTickerLine({ kind: 'FOR_SALE', system, claimant: req.principal, other: null, amount: price }),
    );
    return { ok: true, value: null };
  }

  /**
   * Give up a claim now, and keep part of the bond.
   *
   * The critic's *"allow voluntary cession before freeze with partial bond/anchor salvage so an
   * empire can sacrifice its edge"*. Salvage is a **release of the lock**, not a transfer:
   * nothing was ever taken from the claimant, so nothing is given back — what changes is that
   * the capital stops being at risk. The unsalvaged remainder is retired into the upkeep sink,
   * which is what makes cession a real cost rather than a free reset.
   */
  private abandonClaim(ctx: PhaseContext, req: ActionRequest, system: SystemId): WorldResult<null> {
    const fault = abandonRejection({
      book: this.sovereignty,
      principal: req.principal,
      system,
      tick: ctx.tick,
    });
    if (fault !== null) return fault;
    const claim = this.sovereignty.liveAt(system);
    if (claim === null) return reject('A2', `there is no live claim on ${system} to abandon.`);

    const atRisk = bondAtRiskFor(this.sovereignty, req.principal, this.bondRead());
    const forfeit = minor(Math.max(0, atRisk - Math.trunc((atRisk * CESSION_SALVAGE_BPS) / BPS_ONE)));
    let taken = minor(0);
    const lockId = claim.bondEncumbranceId;
    try {
      if (lockId !== null && this.ledger.encumbrances.isOpen(lockId)) {
        this.ledger.encumbrances.release(lockId, ctx.tick);
        this.sovereignty.dropBondLock(req.principal, lockId);
      }
      if (forfeit > 0) {
        const account = storesAccount(req.principal);
        const free = this.ledger.account(account) === undefined ? minor(0) : this.ledger.freeBalance(account);
        taken = minor(Math.min(forfeit, Math.max(0, free)));
        if (taken > 0) {
          this.ledger.retireCurrency({
            eventId: `claim.cede:${system}:${String(ctx.tick)}` as EventId,
            tick: ctx.tick,
            sink: CURRENCY_SINK.UPKEEP,
            from: account,
            amount: taken,
          });
        }
      }
    } catch (error: unknown) {
      this.faults.push(
        `${req.principal} gave up ${system} and the salvage arithmetic failed (${describeError(error)}); the ` +
          'claim is ceded and the record says what was actually taken',
      );
    }
    this.sovereignty.end(system, 'CEDED', reckoningOf(ctx.tick), null);

    this.emitRow({
      tick: ctx.tick,
      kind: 'claim.ceded',
      rulesVersion: RULES_VERSION,
      actorPrincipalId: req.principal,
      onBehalfOfPrincipalId: null,
      grantId: null,
      eventFamilyId: `claim::${system}`,
      parentEventId: null,
      isPublic: true,
      publicAt: ctx.tick,
      declassifyAt: ctx.tick,
      provenanceClass: 'FACT',
      actedOnStateVersion: ctx.frozenStateVersion,
      decisionSource: req.decisionSource,
      payload: {
        claim: claim.id,
        system,
        claimant: req.principal,
        to: null,
        bondAtRiskMinor: atRisk,
        forfeitedMinor: taken,
        salvagedMinor: minor(Math.max(0, atRisk - taken)),
        salvageBps: CESSION_SALVAGE_BPS,
        arrearsAtCession: this.sovereignty.missesAt(system),
        // A cession is not a lapse and a viewer is owed the difference: nothing was taken by
        // the world, and the arrears stay with the ground for whoever claims it next.
        lapsed: false,
      },
      visibility: 'PUBLIC',
      audience: [],
    });
    this.raidTicker.push(
      claimTickerLine({ kind: 'CEDED', system, claimant: req.principal, other: null, amount: taken }),
    );
    return { ok: true, value: null };
  }

  // ── SOVEREIGNTY: the Charge (§6.3) ────────────────────────────────────────

  /**
   * Mint this Reckoning's Charge, once.
   *
   * Called every OBLIGE rather than only at phase 0, for `assessLevyNow`'s reason: a world
   * constructed with `startTick` inside a cycle would otherwise hold no plan for that cycle
   * and SOV-6 would report a settled Reckoning with unjudged claims. `assessCharge` skips a
   * constellation that is already assessed, so the ordinary path mints at phase 0 exactly once.
   */
  private assessChargeNow(ctx: PhaseContext): void {
    const reckoning = reckoningOf(ctx.tick);
    // The memo is a fast path, never the authority — `assessLevyNow`'s note in full: the book
    // is inside the rollback and this field is not, so an aborted phase-0 tick leaves the
    // field claiming a Reckoning the restored book holds no plan for, and every claim would go
    // unassessed for the rest of the cycle. Asking the book too costs one map walk.
    if (this.chargeAssessedReckoning === reckoning && this.sovereignty.plansIn(reckoning).length > 0) {
      return;
    }
    if (this.sovereignty.liveClaims().length === 0) {
      this.chargeAssessedReckoning = reckoning;
      return;
    }
    let assessed;
    try {
      assessed = assessCharge({
        book: this.sovereignty,
        tick: ctx.tick,
        tierOf: (system) => tierOf(this.world.map, system),
      });
    } catch (error: unknown) {
      // An assessment that cannot be computed must not take the tick down. But it must also
      // never become an arrears: with no plan, `settleCharge` finds no lines, records no
      // shortfall and advances no arrears counter — so a claim whose Charge could not be
      // computed is *not billed*, which is the only A5′-safe direction. Reported loudly.
      this.faults.push(
        `the Charge could not be assessed for Reckoning ${String(reckoning)} (${describeError(error)}); no claim ` +
          'is billed tonight and no arrears is recorded against anybody',
      );
      this.chargeAssessedReckoning = reckoning;
      return;
    }
    this.chargeAssessedReckoning = reckoning;
    ctx.step(assessed.plans.length + assessed.tallies.length);

    for (const plan of assessed.plans) {
      this.emitRow({
        tick: ctx.tick,
        kind: 'charge.assessed',
        rulesVersion: RULES_VERSION,
        actorPrincipalId: null,
        onBehalfOfPrincipalId: null,
        grantId: null,
        eventFamilyId: `charge::${String(plan.reckoning)}::${plan.constellation}`,
        parentEventId: null,
        isPublic: true,
        publicAt: ctx.tick,
        declassifyAt: ctx.tick,
        provenanceClass: 'FACT',
        actedOnStateVersion: ctx.frozenStateVersion,
        decisionSource: null,
        // The whole assessment travels with the row, per claim, because A5′ requires a
        // claimant to have been *shown* what it owed before an arrears can be recorded — and
        // the public event is the record that it was shown. `system` and `due` are enough for
        // a stranger to recompute the line from the published tier and the published ballot.
        payload: {
          constellation: plan.constellation,
          reckoning: plan.reckoning,
          good: CHARGE_GOOD,
          totalQty: plan.total,
          rule: plan.rule,
          byDefault: plan.byDefault,
          spared: plan.spared,
          claims: plan.lines.length,
          lines: plan.lines.map((line) => ({
            system: line.system,
            claimant: line.claimant,
            due: line.amount,
            ruleQty: line.ruleQty,
            spared: line.spared,
            arrears: line.missesAtAssessment,
          })),
        },
        visibility: 'PUBLIC',
        audience: [],
      });
    }
    // §14.4's named loser, against the counterfactual where the group did nothing. Published
    // because Law 2 asks for a *named* loss by the group's action, and a loss nobody can name
    // is not one.
    for (const loser of assessed.losers) {
      this.emitRow({
        tick: ctx.tick,
        kind: 'charge.borne',
        rulesVersion: RULES_VERSION,
        actorPrincipalId: null,
        onBehalfOfPrincipalId: loser.principal,
        grantId: null,
        eventFamilyId: `charge::${String(reckoning)}::${loser.constellation}`,
        parentEventId: null,
        isPublic: true,
        publicAt: ctx.tick,
        declassifyAt: ctx.tick,
        provenanceClass: 'FACT',
        actedOnStateVersion: ctx.frozenStateVersion,
        decisionSource: null,
        payload: {
          constellation: loser.constellation,
          principal: loser.principal,
          extraQty: loser.extra,
          good: CHARGE_GOOD,
        },
        visibility: 'PUBLIC',
        audience: [],
      });
    }
  }

  /**
   * Settle the Charge: shortfall, arrears, lapse, slashed bond.
   *
   * Runs at the settlement tick, **after** the venture batch and after the Levy's sweep (see
   * the OBLIGE handler on why the order is a rule and not a preference).
   */
  private settleChargeNow(ctx: PhaseContext): void {
    if (!isSettlementTick(ctx.tick)) return;
    const reckoning = reckoningOf(ctx.tick);
    // The book's flag, not a field on the runtime: `settleLevyNow`'s note carries the measured
    // consequence of the other choice. The book is inside `state_hash` and restored by the
    // rollback, so it can only ever say what the world it belongs to says; a plain field
    // survives an abort and silently skips the re-run, and here that would mean a Reckoning
    // in which no arrears advanced and no lapse fired, published clean.
    if (this.sovereignty.isSettled(reckoning)) return;

    const settlement = settleCharge({
      book: this.sovereignty,
      reckoning,
      tick: ctx.tick,
      slash: this.slashPort(ctx.tick),
      bondAtRiskOf: (principal) => bondAtRiskFor(this.sovereignty, principal, this.bondRead()),
    });
    this.chargeOutcome = settlement;
    ctx.step(settlement.shortfalls.length + settlement.lapsed.length);

    for (const row of settlement.shortfalls) {
      if (row.owed <= 0) continue;
      this.emitRow({
        tick: ctx.tick,
        kind: row.state === 'LAPSED' ? 'claim.lapsed' : 'charge.arrears',
        rulesVersion: RULES_VERSION,
        actorPrincipalId: null,
        onBehalfOfPrincipalId: row.claimant,
        grantId: null,
        eventFamilyId: `claim::${row.system}`,
        parentEventId: null,
        isPublic: true,
        publicAt: ctx.tick,
        declassifyAt: ctx.tick,
        provenanceClass: 'FACT',
        actedOnStateVersion: ctx.frozenStateVersion,
        decisionSource: null,
        // The arithmetic travels with the accusation. An arrears drives a vulnerability
        // window and eventually a slashed bond, so a reader has to be able to reproduce it
        // from the row alone — INV-17's rule for defaults, applied where it belongs.
        payload: {
          claim: row.claim,
          system: row.system,
          claimant: row.claimant,
          good: CHARGE_GOOD,
          assessedQty: row.assessment,
          paidQty: row.paid,
          owedQty: row.owed,
          arrears: row.misses,
          arrearsOf: CHARGE_MISSES_TO_LAPSE - 1,
          state: row.state,
          slashedMinor: row.slashed,
          // Named in full on a lapse, because a reader must be able to see that nothing
          // ELSE moved: §5.2's protections are not weakened by sovereignty, and a claimant
          // that loses every claim it has still holds its identity, its holding, its hands
          // and its standing.
          identityTaken: false,
          holdingTaken: false,
          standingTaken: false,
          handsTaken: false,
        },
        visibility: 'PUBLIC',
        audience: [],
      });
      this.raidTicker.push(
        row.state === 'LAPSED'
          ? claimTickerLine({
              kind: 'LAPSED',
              system: row.system,
              claimant: row.claimant,
              other: null,
              amount: row.slashed,
            })
          : claimTickerLine({
              kind: row.state === 'CONTESTED' ? 'CONTESTED' : 'ARREARS',
              system: row.system,
              claimant: row.claimant,
              other: null,
              amount: row.owed,
            }),
      );
    }
    this.sovereignty.prune(reckoning);
  }

  /**
   * The only thing a lapse may reach for: posted bond.
   *
   * `SlashPort` cannot express a holding, a hand, a standing row or an identity, so §5.2's
   * *"never identity, never the holding, never standing"* survives sovereignty as a property
   * of the **type** rather than of anybody remembering (SOV-3).
   *
   * The order inside is the A5′ order and it matters: **release the lock first, then retire
   * the currency.** `retireCurrency` refuses to take value that is locked, so retiring first
   * would throw on the claimant's own bond; and `seizeCurrency` would call
   * `reduceLocksToBalance`, which sheds the claimant's OTHER locks — including bonds backing
   * claims that are perfectly current. One lapse must not cascade.
   */
  private slashPort(_tick: number): SlashPort {
    return {
      slash: (args) => {
        const claim = this.sovereignty.at(args.system);
        const lockId = claim?.bondEncumbranceId ?? null;
        if (args.want <= 0) return minor(0);
        try {
          if (lockId !== null && this.ledger.encumbrances.isOpen(lockId)) {
            this.ledger.encumbrances.release(lockId, args.tick);
            this.sovereignty.dropBondLock(args.principal, lockId);
          }
          const account = storesAccount(args.principal);
          const free = this.ledger.account(account) === undefined
            ? minor(0)
            : this.ledger.freeBalance(account);
          const take = minor(Math.min(args.want, Math.max(0, free)));
          if (take <= 0) return minor(0);
          this.ledger.retireCurrency({
            eventId: `claim.slash:${args.system}:${String(args.reckoning)}` as EventId,
            tick: args.tick,
            sink: CURRENCY_SINK.UPKEEP,
            from: account,
            amount: take,
          });
          return take;
        } catch (error: unknown) {
          // Never a throw: this runs at the settlement tick, after every venture has already
          // resolved, and a throw would abort a Reckoning with an audience. A bond that could
          // not be taken is recorded as `slashed: 0`, which is the honest record.
          this.faults.push(
            `${args.principal}'s bond on ${args.system} could not be slashed (${describeError(error)}); the ` +
              'claim still lapsed and the record says nothing was taken',
          );
          return minor(0);
        }
      },
    };
  }

  /** SOV-1..7 plus the A5′ attribution guard, for the tick's ASSERT hook. */
  private sovereigntyViolations(tick: number): readonly InvariantViolation[] {
    return [
      ...checkSovereigntyInvariants({
        book: this.sovereignty,
        tick,
        tierOf: (system) => tierOf(this.world.map, system),
        holdingSystemOf: (principal) =>
          this.world.holdingByPrincipal.get(principal as PrincipalId) === undefined
            ? null
            : holdingOf(this.world, principal as PrincipalId).system,
        bondCeiling: CLAIM_BOND_MINOR,
      }),
      ...checkChargeAttribution(this.sovereignty, reckoningOf(tick), tick, CLAIM_BOND_MINOR),
      // INV-W1..3. Grouped here rather than in their own hook because they answer the same
      // question sovereignty's do — is a place's arithmetic still true — and the A15 claim
      // that world output cannot scale with the population is exactly the kind of assertion
      // that is a comment until something halts on it.
      ...checkWorks({
        book: this.worksBook,
        map: this.world.map,
        tick,
        // The highest rate any LIVE claim carries, not the constant: a claim keeps the rate it
        // was raised under (`ClaimRecord.rentBps`), so a world holding a pre-tuning claim would
        // halt on arithmetic its own rules guaranteed if this read today's number.
        rentCeilingBps: this.rentCeilingBps(),
      }),
    ];
  }

  // ── GRADUATION: the exit from the Commons (§4.1, §6.3, A8, A15) ───────────

  /**
   * What the crossing costs this principal right now, and what it would carry out.
   *
   * Public, and read by the affordance layer and by the `holding` block, because *"a
   * graduation nobody can find is not a graduation"*: the choice has to be priced in the
   * observation before it is taken, the way every other high-impact affordance is. Never
   * throws and never draws — it is read from HTTP (DET-7).
   *
   * `null` only when the principal has no holding, which after enrolment means it does
   * not exist.
   */
  graduationQuote(principal: PrincipalId): GraduationQuote | null {
    if (this.world.holdingByPrincipal.get(principal) === undefined) return null;
    const holding = holdingOf(this.world, principal);
    const account = storesAccount(principal);
    const free = this.ledger.account(account) === undefined
      ? minor(0)
      : this.ledger.freeBalance(account);

    let atSeat = 0;
    let pledged = 0;
    for (const lot of this.upkeepLotsAt(principal, holding.system)) atSeat += lot.qty;
    for (const lot of this.pledgedUpkeepLotsAt(principal, holding.system)) pledged += lot.qty;

    return {
      from: holding.system,
      fromTier: tierOf(this.world.map, holding.system),
      open: graduationDestinations(this.world.map, holding),
      upkeepMinor: GRADUATION_UPKEEP_MINOR,
      upkeepQty: GRADUATION_UPKEEP_QTY,
      good: LEVY_GOOD,
      freeMinor: free,
      availableQty: qty(atSeat),
      travellingQty: qty(Math.max(0, atSeat - GRADUATION_UPKEEP_QTY)),
      pledgedQty: qty(pledged),
      affordable: free >= GRADUATION_UPKEEP_MINOR && atSeat >= GRADUATION_UPKEEP_QTY,
      anchoring: this.sovereignty
        .claimsInOrder()
        .filter((c) => c.claimant === principal && c.endedAtReckoning === null)
        .map((c) => c.system),
    };
  }

  /**
   * Unpledged, `AVAILABLE` upkeep-good lots standing at one system, canonical order.
   *
   * The pool the price is drawn from **and** the goods that travel — deliberately the
   * same set, because a price payable out of goods that would not have moved anyway is
   * not a price on projecting force. Mirrors `levyGoodLots` rather than sharing it: that
   * one is location-blind on purpose (a delivery may draw from anywhere the payer holds),
   * and this one must not be (a body carries what is standing in it).
   */
  private upkeepLotsAt(
    principal: PrincipalId,
    system: SystemId,
  ): readonly { readonly id: LotId; readonly qty: number }[] {
    const account = storesAccount(principal);
    if (this.ledger.account(account) === undefined) return [];
    return this.ledger
      .lotsInAccount(account)
      .filter(
        (lot) =>
          lot.good === LEVY_GOOD &&
          lot.qty > 0 &&
          lot.state === 'AVAILABLE' &&
          lot.encumbranceId === null &&
          lot.location === system,
      )
      .sort((a, b) => compareIds(a.id, b.id))
      .map((lot) => ({ id: lot.id, qty: lot.qty }));
  }

  /** The lots that stay behind: pledged, so `lots.ts` says they "cannot be sent away". */
  private pledgedUpkeepLotsAt(
    principal: PrincipalId,
    system: SystemId,
  ): readonly { readonly id: LotId; readonly qty: number }[] {
    const account = storesAccount(principal);
    if (this.ledger.account(account) === undefined) return [];
    return this.ledger
      .lotsInAccount(account)
      .filter(
        (lot) =>
          lot.good === LEVY_GOOD &&
          lot.qty > 0 &&
          lot.state === 'AVAILABLE' &&
          lot.encumbranceId !== null &&
          lot.location === system,
      )
      .sort((a, b) => compareIds(a.id, b.id))
      .map((lot) => ({ id: lot.id, qty: lot.qty }));
  }

  /**
   * `graduate` — move the holding one lane outward, at §6.3's price.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THE ORDER IS THE HONESTY**, exactly as it is in `vDeliver`:
   *
   *   1. **Refuse on the merits first**, with a sentence, before anything moves.
   *   2. **Charge**, and let the ledger be the authority on whether the charge landed.
   *   3. **Move the body only if the whole price was paid.** A partial charge is refused
   *      rather than completed at a discount, and it is recorded as a fault so an
   *      operator sees it — the pre-validation in step 1 makes it unreachable, and the
   *      one thing that must never happen is a body that crossed for free.
   *
   * Everything the principal holds at the old seat moves with the body, and it becomes
   * assailable the moment it lands. That is not a side effect: it is the entire point of
   * the choice, and `what_it_forecloses` says so before it is taken.
   * ══════════════════════════════════════════════════════════════════════════
   */
  private vGraduate(ctx: PhaseContext, req: ActionRequest): WorldResult<null> {
    const quote = this.graduationQuote(req.principal);
    if (quote === null) {
      return reject('A2', `${req.principal} has no holding, so there is no body to move.`);
    }
    const holding = holdingOf(this.world, req.principal);
    const to = readString(req.params, ['to', 'system', 'destination', 'system_id']);
    if (to === null) {
      return reject(
        'A2',
        'graduate needs a destination: {"to": "<system_id>"}. It moves your HOLDING — your body on the ' +
          'map — one lane outward, and it is the only way out of the Commons. Open to you right now: ' +
          `${quote.open.length === 0 ? 'nothing (no lane out of here leaves the Commons)' : quote.open.join(' · ')}. ` +
          GRADUATION_STATEMENT,
      );
    }
    const fault = graduationRejection(this.world.map, holding, to as SystemId);
    if (fault !== null) return fault;

    // ── The body cannot leave territory it is anchoring (INV-8) ─────────────
    // Checked before the price, because refusing for a reason the agent can act on beats
    // charging it and then refusing — and because the alternative outcome is a halted world.
    if (quote.anchoring.length > 0) {
      return reject(
        'A2',
        `you hold ${quote.anchoring.length === 1 ? 'a live claim' : `${String(quote.anchoring.length)} live claims`} ` +
          `on ${quote.anchoring.join(' · ')}, and a claim is anchored by a body — moving your holding to ${to} ` +
          'would leave territory with nobody standing on it, which the world does not permit. Let it go first ' +
          'and the crossing opens: `abandon` {"claim":"<system>"} hands it back and returns part of the bond, ' +
          'or `publish_offer` {"cede":"<system>","price":<minor>} sells it to somebody who will stand there. ' +
          'holding.graduation.anchoring lists exactly what is holding you here.',
      );
    }

    // ── The price, checked before a unit of it moves (A15, §6.3) ────────────
    if (quote.freeMinor < quote.upkeepMinor) {
      return reject(
        'A15',
        `a holding outside the Commons pays upkeep in currency plus manufactured goods, and the crossing ` +
          `charges ${String(quote.upkeepMinor)} of it now. You have ${String(quote.freeMinor)} free — locked ` +
          'stores do not count. This gate is priced in produced goods and capital and never in identities, ' +
          'so enrolling again buys you nothing here.',
      );
    }
    if (quote.availableQty < quote.upkeepQty) {
      return reject(
        'A15',
        `the crossing also costs ${String(quote.upkeepQty)} units of ${quote.good}, standing at ` +
          `${quote.from} where your body is. You have ${String(quote.availableQty)} unpledged there` +
          `${quote.pledgedQty > 0 ? ` (${String(quote.pledgedQty)} more is pledged to an open obligation and cannot be sent away)` : ''}. ` +
          'Produce or buy the difference first; this price cannot be paid in currency and cannot be paid ' +
          'by enrolling a second identity.',
      );
    }

    const from = holding.system;
    const burned = this.burnUpkeepGoods(
      req.principal,
      from,
      to as SystemId,
      quote.upkeepQty,
      ctx.tick,
    );
    if (burned < quote.upkeepQty) {
      return reject(
        'A15',
        `only ${String(burned)} of the ${String(quote.upkeepQty)} units of upkeep could be handed over, so ` +
          'the crossing did not happen and your holding has not moved. Check your stores and try again.',
      );
    }
    try {
      // ── THE DESTINATION IS IN THE ID, AND IT HAS TO BE ────────────────────
      //
      // The action budget is more than one, so a principal may submit several
      // `graduate`s in one batch and land several crossings in one tick — each a
      // separate charge. Keyed on `(principal, tick)` alone, every crossing after the
      // first wrote a *second* posting batch under an id the first had already used, so
      // `Ledger.postingsFor` returned two unrelated charges as one event and any store
      // with a uniqueness constraint on `posting.event_id` would have had to drop one.
      // `to` disambiguates them for free and cannot collide: a crossing to where the
      // body already stands is refused above, so no two crossings in one tick share a
      // destination.
      this.ledger.retireCurrency({
        eventId: `graduate.upkeep:${req.principal}:${String(ctx.tick)}:${to}` as EventId,
        tick: ctx.tick,
        sink: CURRENCY_SINK.UPKEEP,
        from: storesAccount(req.principal),
        amount: quote.upkeepMinor,
      });
    } catch (error: unknown) {
      this.faults.push(
        `${req.principal} paid ${String(burned)} of ${quote.good} toward a crossing to ${to} and then could ` +
          `not pay the currency half (${describeError(error)}); the holding did not move`,
      );
      return reject(
        'A15',
        'the goods half of the upkeep was handed over but the currency half could not be, so your holding ' +
          'has not moved. This should not be reachable — please report it with POST /discrepancy.',
      );
    }

    // Only now does the body move. `graduateHolding` re-runs the same gate, so the two
    // roads to "may this crossing happen" cannot drift apart.
    const moved = graduateHolding(this.world.map, holding, to as SystemId);
    if (moved !== null) return moved;
    const carried = this.carryStoresTo(req.principal, from, to as SystemId);

    this.emitRow({
      tick: ctx.tick,
      kind: 'holding.graduated',
      rulesVersion: RULES_VERSION,
      actorPrincipalId: req.principal,
      onBehalfOfPrincipalId: null,
      grantId: null,
      eventFamilyId: `holding::${holding.id}`,
      parentEventId: null,
      // §11.2 gives PUBLIC to "movement on public lanes", and a body leaving the safe
      // zone is the loudest motion the map has. A13: this is the pixel signature — the
      // named holding crosses the Commons boundary and the protection ring comes off.
      isPublic: true,
      publicAt: ctx.tick,
      declassifyAt: ctx.tick,
      provenanceClass: 'FACT',
      actedOnStateVersion: ctx.frozenStateVersion,
      decisionSource: req.decisionSource,
      payload: {
        holding: holding.id,
        name: holding.name,
        from,
        to,
        from_tier: tierOf(this.world.map, from),
        to_tier: tierOf(this.world.map, to as SystemId),
        upkeep_minor: quote.upkeepMinor,
        upkeep_qty: quote.upkeepQty,
        good: quote.good,
        carried_qty: carried.qty,
        carried_lots: carried.lots,
        left_behind_qty: quote.pledgedQty,
        // Stated on the receipt so a viewer and an auditor read the same sentence the
        // agent read before it acted: from here on, A8 does not cover this principal.
        commons_protection: false,
      },
      visibility: 'PUBLIC',
      audience: [],
    });
    return { ok: true, value: null };
  }

  /**
   * Burn the goods half of the upkeep, **where the principal is standing** (§10.2).
   *
   * Destroyed at the seat it is leaving rather than at the destination: that is where the
   * agent and the goods actually were when the act resolved, and D8's lesson is that a
   * located fact must be true about the place it names. Returns what actually moved;
   * never throws, for `consumeLevyGood`'s reason — this is an agent-reachable path and a
   * throw here would be an agent-triggerable halt.
   */
  private burnUpkeepGoods(
    principal: PrincipalId,
    from: SystemId,
    to: SystemId,
    want: Qty,
    tick: number,
  ): Qty {
    let left: number = want;
    let taken = 0;
    for (const lot of this.upkeepLotsAt(principal, from)) {
      if (left <= 0) break;
      const portion = Math.min(left, lot.qty);
      if (portion <= 0) continue;
      try {
        this.ledger.destroyGoods({
          // `to` for the same reason the currency half carries it: two crossings in one
          // tick may both draw from the surviving remainder of the *same* lot, and
          // `(principal, tick, lot)` cannot tell those two burns apart.
          eventId: `graduate.upkeep:${principal}:${String(tick)}:${to}:${lot.id}` as EventId,
          tick,
          sink: GOODS_SINK.CONSUMPTION,
          lotId: lot.id,
          qty: qty(portion),
        });
      } catch (error: unknown) {
        this.faults.push(
          `${principal} could not burn ${String(portion)} of ${LEVY_GOOD} at ${from} toward a crossing ` +
            `(${describeError(error)}); only what actually moved is charged`,
        );
        continue;
      }
      taken += portion;
      left -= portion;
    }
    return qty(taken);
  }

  /**
   * Move what is standing in the body to where the body now stands.
   *
   * **This is the risk half of the crossing, and it is deliberate.** A graduate whose
   * stores stayed behind in the Commons would have bought a Marches address with no
   * exposure attached — the map would show a body outside the safe zone while `PRD-1`'s
   * lot-level floor kept every unit of its wealth untouchable, and predation would still
   * never reach a player. Enrolment already locates the starter allotment *at the
   * holding's system*, so "your stores stand in your body" is the rule this build already
   * runs on; this keeps it true through a move.
   *
   * Pledged lots stay: `lots.ts` says a pledged lot "cannot be sent away", and moving one
   * out from under a settling obligation is the shape D8 closed. They are counted and
   * published rather than dropped silently.
   */
  private carryStoresTo(
    principal: PrincipalId,
    from: SystemId,
    to: SystemId,
  ): { readonly lots: number; readonly qty: Qty } {
    let moved = 0;
    let lots = 0;
    for (const lot of this.upkeepLotsAt(principal, from)) {
      try {
        this.ledger.relocate(lot.id, { location: to });
      } catch (error: unknown) {
        this.faults.push(
          `${principal}'s lot ${lot.id} could not follow its holding from ${from} to ${to} ` +
            `(${describeError(error)}); it stays where it is`,
        );
        continue;
      }
      moved += lot.qty;
      lots += 1;
    }
    return { lots, qty: qty(moved) };
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
    // ── THE CHARGE'S HALF OF `deliver`, AND WHY IT IS A MODE AND NOT A VERB ──
    //
    // §12.2 publishes `deliver` as the levy group's discharge and the §17 verb budget is at 40
    // of 40. `deliver` means one thing — handing goods over at a named place — and there are
    // now two world obligations discharged that way. So the obligation is a parameter, and
    // ABSENT IT NOTHING CHANGES: an agent that has only ever sent `{"amount":N}` still pays its
    // Levy, which is what keeps this from being a rules-surface break (scar #1).
    //
    // Naming a `system` is also enough on its own, because a Levy is payable at a delivery
    // PLACE the plan names and a Charge at the claimed system — an agent that says which claim
    // it is supplying has said which obligation it means.
    const obligation = (readString(req.params, ['obligation', 'against', 'duty']) ?? '').toUpperCase();
    const chargeSystem = readString(req.params, ['system', 'claim', 'system_id']) as SystemId | null;
    if (obligation === 'CHARGE' || (obligation === '' && chargeSystem !== null)) {
      if (chargeSystem === null) {
        return reject(
          'A2',
          'a Charge delivery needs the claim it is against: {"obligation":"CHARGE","system":"<id>","amount":N}. ' +
            CHARGE_STATEMENT,
        );
      }
      return this.deliverCharge(ctx, req, chargeSystem);
    }
    const reckoning = reckoningOf(ctx.tick);
    // `on_behalf_of` is the Coase-collapse primitive, offered on purpose: a delivery
    // service has to be *expressible* for PROP-LV3 to be able to attempt the collapse
    // against it. What it cannot do is fill the non-escrowable share (`payment.ts`).
    const payerRaw = readString(req.params, ['on_behalf_of', 'onBehalfOf', 'for', 'payer']);
    const payer = (payerRaw ?? req.principal) as PrincipalId;
    if (this.world.holdingByPrincipal.get(payer) === undefined) {
      return reject('A2', `there is no principal ${payer} to deliver for; name yourself or a real principal.`);
    }
    // ── ONE HOME FOR "WHERE IS THIS PAYABLE": THE PLAN THAT ASSESSED IT ─────
    //
    // `levyBlockFor` publishes `deliverable_to` from `plan.deliverableTo`, the settlement
    // sweep reads `plan.deliverableTo`, and the tribute line reads `plan.deliverableTo`.
    // This handler alone recomputed it from the payer's *current* constellation. The two
    // agreed for as long as a holding could not move — and `graduate` is exactly the verb
    // that makes a holding move, so a graduate who crossed a constellation boundary would
    // have been shown one delivery place and charged against another, mid-Reckoning. That
    // is scar #1 with a Levy shortfall attached, and a shortfall is an accusation.
    //
    // The plan wins, because the plan is what was assessed. The computed place stays as
    // the fallback for a principal with no line yet (a mid-cycle enroller before its
    // constellation is assessed), which is the only case where there is no plan to ask.
    const line = this.levy.lineFor(reckoning, payer);
    const constellation = line?.plan.constellation ?? constellationOf(this.world, payer);
    const place =
      line?.plan.deliverableTo ??
      (constellation === null ? null : deliveryPlaceOf(this.world.map, constellation));
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
    this.emitRow({
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
    // ── THE FOURTH BALLOT, AND §12.2 SAYS IT IS STILL ONE VERB ──────────────
    //
    // "one verb, three ballots ... a ballot is a ballot" is the sentence §12.2 used to promote
    // `vote` out of the `org` group, and the Charge allocation is a ballot by exactly that
    // reading: scheduled, constellation-scoped, PUBLIC in full, resolving at a Reckoning. The
    // §17 budget is untouched.
    if (kind === CHARGE_BALLOT) return this.voteCharge(ctx, req);
    if (kind !== LEVY_BALLOT) {
      return reject(
        'A2',
        `only the ${LEVY_BALLOT} and ${CHARGE_BALLOT} ballots are open in this build: §12.2's other two ` +
          '(seizure, syndicate proposals) land with the seizure vote and with syndicates. Send ' +
          '{"ballot": "LEVY", "rule": "..."} to allocate the Levy, or {"ballot": "CHARGE", "rule": "..."} to ' +
          'allocate your constellation\'s sovereignty upkeep.',
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
    this.emitRow({
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

  /**
   * Whether a LEVY delivery would be ACCEPTED right now, and for how much.
   *
   * Exists so the affordance list can offer `deliver` against the Levy without owning a second
   * copy of the legality rule: this calls the same {@link deliveryFault} `vDeliver` calls, with the
   * same inputs. A menu that decided legality for itself would be scar #1 waiting to happen — and
   * the Charge's own affordance already carries a comment about what it costs an agent to be
   * offered an act the engine then refuses.
   *
   * Measured before it existed: `vote` and `deliver` against the Levy both EXECUTED when called
   * directly and were absent from `affordances[]` in every observation, while `withheld` explained
   * neither. A14 says the Levy cannot be dodged into quiet; it was being dodged by ignorance.
   */
  levyDeliveryQuote(
    principal: PrincipalId,
    tick = this.engine.tick,
  ): {
    readonly place: SystemId | null;
    /** What a full discharge would hand over now, bounded by what is actually to hand. */
    readonly payable: number;
    readonly owed: number;
    readonly available: Qty;
    /** Null exactly when the verb would be accepted. Otherwise the engine's own sentence. */
    readonly fault: string | null;
  } {
    const reckoning = reckoningOf(tick);
    const line = this.levy.lineFor(reckoning, principal);
    const constellation = line?.plan.constellation ?? constellationOf(this.world, principal);
    const place =
      line?.plan.deliverableTo ??
      (constellation === null ? null : deliveryPlaceOf(this.world.map, constellation));
    const owing = this.levy.owingOf(reckoning, principal);
    const available = this.levyGoodAvailable(principal);
    if (place === null) {
      return {
        place: null,
        payable: 0,
        owed: owing.owed,
        available,
        fault: 'your constellation has no delivery place, so nothing can be delivered against it yet.',
      };
    }
    const fault = deliveryFault({
      world: this.world,
      payer: principal,
      deliverer: principal,
      place,
      tick,
      owing,
      available,
    });
    return {
      place,
      payable: Math.max(0, Math.min(owing.owed, available)),
      owed: owing.owed,
      available,
      fault,
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

    // The vectors behind each name's one clause. Only principals the book actually HOLDS: an absent
    // row renders as "day one", never as a row of zeros, because a fabricated clean record is a claim
    // about a real agent that nothing supports.
    const standings = new Map<PrincipalId, Standing>();
    for (const row of this.standing.rows()) standings.set(row.principal, row);

    // ── THE SAY-DO GAP, WHICH THE FRAME USED TO DROP ────────────────────────────
    //
    // These three fields were hardcoded `null, null, []`. Measured on the live world at
    // one moment: 371 seals, 126 messages, and ten rundown segments carrying zero of
    // each. §11.1's three layers are *what it said* → *what it sealed* → *what it did*,
    // and §14's receipt reel is the first placed beside the last. The frame rendered only
    // the third, so a viewer saw deeds and consequences and never learned that anybody had
    // claimed anything — a betrayal was costly but not LEGIBLE, which is the whole product.
    //
    // Built once here rather than per-venture: `auditRecords()` and the talk ring are both
    // whole-world reads, and doing them inside the loop would be O(ventures × seals) on the
    // settlement tick, which is the heaviest tick there is.
    const verdictByVenture = new Map<string, 'HONOURED' | 'CONTRADICTED'>();
    for (const rec of this.seals.auditRecords()) {
      if (rec.role === null || rec.verdict === null) continue;
      // CONTRADICTED wins if any seal on the venture was contradicted: the story is that
      // a pre-commitment was broken, and one broken seal is that story regardless of how
      // many others held.
      const key = String(rec.role.venture);
      if (rec.verdict === 'CONTRADICTED' || !verdictByVenture.has(key)) {
        verdictByVenture.set(key, rec.verdict);
      }
    }
    const talkByVenture = new Map<string, readonly TalkEntry[]>();
    for (const entry of this.talk.all) {
      const key = String(entry.venture);
      talkByVenture.set(key, [...(talkByVenture.get(key) ?? []), entry]);
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
        // What it SAID. An `assure` is the reassurance §11.1 layer 1 describes — public,
        // and allowed to be a lie — so the creator's last one is the line to put beside
        // the deed. Never the seal's prose: that is SEALED and releases in the season
        // replay, not tonight (§11.2).
        publicLine:
          (talkByVenture.get(String(st.venture)) ?? [])
            .filter((t) => t.act === 'assure' && t.from === v.creator)
            .slice(-1)[0]?.text ?? null,
        // What it SEALED — the flag only. The verdict is a separate PUBLIC fact parented
        // to the seal; the content is not in this frame and cannot be.
        sealVerdict: verdictByVenture.get(String(st.venture)) ?? null,
        // The negotiation, declassified. `PARTIES` while live, public AT SETTLEMENT — which
        // is now — and carried only where an elective promise BROKE, because a reel on a
        // kept promise would be the show editorialising (A12).
        messages:
          st.terminalState === 'DEFAULTED'
            ? (talkByVenture.get(String(st.venture)) ?? []).map((t) => ({
                tick: t.tick,
                from: t.from,
                text: t.text,
              }))
            : [],
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
    // How many ventures each grant has BOUND in its grantor's name (`AuthorityLine.boundVentures`).
    // Counted once over the book rather than per grant, so the frame stays linear in the book rather
    // than quadratic in grants × ventures — INV-7 was pulled off that same shape.
    const boundByGrant = new Map<GrantId, number>();
    for (const v of this.ventures.all()) {
      if (v.boundByGrant === null) continue;
      boundByGrant.set(v.boundByGrant, (boundByGrant.get(v.boundByGrant) ?? 0) + 1);
    }
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
          boundVentures: boundByGrant.get(g.id) ?? 0,
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
        // Raw yield nobody has converted. Summed over every principal's lots rather than tracked as a
        // counter, because a second home for a quantity the ledger already holds is scar #5 — and the
        // ledger is the only thing that knows about encumbrance and location.
        unrefined: qty(
          [...this.world.holdingByPrincipal.keys()].reduce(
            (n, p) => n + this.refinableAt(p, holdingOf(this.world, p).system),
            0,
          ),
        ),
      },
      handles,
      standings,
      // The raid ticker, drained into the frame. Bounded by the Ring, and 140-char
      // capped by `raidTickerLine`; `renderFrame` drops anything longer anyway.
      ticker: this.raidTicker.all,
      // ── TOMORROW'S DOCKET, WHICH WAS HARDCODED EMPTY ────────────────────────
      //
      // `docket` and `nextDocket` are §14's setup — *"biggest stakes first, each one a sentence a
      // stranger reads"* — and the closing card is what makes a viewer come back. Both read this
      // array, and this array was `[]`, so every frame ever published had an empty docket and an
      // empty closing card. Nothing failed: an empty list renders as an honest empty state, which
      // is why it survived.
      //
      // Built from the LIVE ventures rather than from anything predicted. `atStake` is the elective
      // half — the part that is a promise rather than an execution, which is the only part with any
      // drama in it — and `priorDealings` is what makes a card a sentence instead of a number.
      tomorrow: this.ventures
        .live()
        .map((v) => ({
          venture: v.id,
          atStake: sumMinor(
            // `terms.elective` is A7's PRICED-BUT-ELECTIVE half — the part that stays a promise
            // and can still be broken. Only filled roles count: an unfilled role is nobody's
            // promise yet, and a docket card about a slot no agent has taken is a card about
            // nothing. `settledElectiveMinor` would be the wrong field entirely — that is what has
            // already been PAID, and this card is about what is still riding.
            v.roles.map((r) => (r.filledByPrincipal === null ? minor(0) : r.terms.elective)),
          ),
          parties: [
            v.creator,
            ...v.roles.map((r) => r.filledByPrincipal).filter((x): x is PrincipalId => x !== null),
          ].sort(compareIds),
          // ── DERIVED, BECAUSE `false` PRINTS A SENTENCE THAT MAY BE A LIE ────────
          //
          // This was hardcoded `false`, and `render.ts` turns `false` into *"They have dealt
          // before, and it held."* — a specific claim about two named agents' shared history,
          // printed on a public frame, for pairs that may never have met. An empty docket was
          // merely useless; that is the record being WRONG about a relationship, which is what
          // A5′ exists to forbid and what other agents read to decide who to trust.
          //
          // So it is computed from the venture book's own history: have these parties ever
          // shared a RESOLVED venture. Bounded work — at most `MAX_DOCKET_CARDS` cards survive
          // the cut, and each is one pass over a book the process already holds.
          priorDealings: this.priorDealings(
            v.creator,
            v.roles.map((r) => r.filledByPrincipal).filter((x): x is PrincipalId => x !== null),
            v.id,
          ),
          // A6 on the docket. Present only when a delegate committed the creator under a grant; the
          // delegate is read off the grant rather than off the venture, because the venture records
          // the AUTHORITY and the grant records who holds it, and duplicating the delegate onto the
          // venture row would be two homes for one fact (scar #5).
          boundGrantor: v.boundByGrant === null ? null : v.creator,
          boundBy: v.boundByGrant === null ? null : (this.grantBook.get(v.boundByGrant)?.delegate ?? null),
          // The creator's OFFER, as one bps figure over the whole venture: A7's unsecured share. Read
          // off `ventureEscrowRatioBps`, the venture module's own function, so the arc a viewer sees
          // and the ratio §7.5 puts on the card are one number.
          electiveBps: BPS_ONE - ventureEscrowRatioBps(v),
        }))
        .filter((u) => u.atStake > 0),
      tributeLines: this.tributeLines(outcome.tick),
      authorityLines,
      // Predation's pixel signature (A13, §9). Built by the predation layer, never by
      // the renderer: a red arc thrown at a holding nobody attacked is the worst lie
      // this frame could tell. The §11.2 clause that admits the key is argued in
      // `frames/projection.ts`.
      raidLines: raidLinesFor(this.raids, outcome.tick, MAX_RAID_LINES),
      // Combat's battle lines (§9A, A13). Supplied by the combat layer for the reason every other
      // line set is: a renderer that computed its own bar heights would be inventing damage.
      battleLines: battleLinesFor(this.battles, this.fleet, outcome.tick, MAX_FRAME_BATTLE_LINES),
      // Sovereignty's pixel signature (A13, §6.3): the claim tint and its legend. Built by the
      // sovereignty layer for the same reason the raid lines are — a renderer that computed
      // what a claim owed would be inventing an obligation. The §11.2 clause that admits the
      // key is argued at length in `frames/projection.ts`, and the argument is specifically
      // that no field on this line is a function of anything a claimant STILL holds: the
      // rejected "fuel gauge" was exactly that, and this is what replaced it.
      claimLines: this.claimLines(outcome.tick).slice(0, MAX_FRAME_CLAIM_LINES),
      worksLines: this.worksLines(outcome.tick),
      // §16 world memory. Razed WORKS are included on purpose: a place keeps the name of whoever first
      // opened it, whether or not they still hold it — see `frames/memory.ts`.
      places: namesFor(this.worksBook.everInOrder(), handles),
      hallOfFame: hallOfFame(this.standing.rows(), handles),
      syndicateLines: this.syndicateLines(outcome.tick),
      // ── THE MAP, WHICH THE FRAME HAS NEVER CARRIED ──────────────────────────
      //
      // A13 calls the map "the game's only agreed representation", and the frame carried no map at
      // all: a client saw system IDS inside claim tints and works marks and had no topology, so
      // every line in this artifact was a caption on a picture nobody could draw.
      //
      // Passed straight through from `world.map` — no coordinates, because position is presentation
      // and x/y on a system would put presentation inside `state_hash`, where a layout tweak becomes
      // a replay divergence. `lanes` is a graph and a graph is enough.
      map: [...this.world.map.systems.values()].map((sys) => ({
        id: sys.id,
        name: sys.name,
        tier: sys.tier,
        constellation: sys.constellation,
        lanes: [...sys.lanes],
      })),
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
   * Queue one row for the record. The runtime's replacement for `ctx.emit`.
   *
   * Same contract as the engine's buffer — bounded by the same published cap, dropped
   * wholesale if the tick aborts — and one difference that is the whole point of it:
   * these rows reach the ledger in `DERIVE`, *inside* the `state_hash` that claims to
   * cover them, rather than at COMMIT after it. See {@link Runtime.pendingRecord}.
   */
  private emitRow(draft: NewEvent): void {
    if (this.pendingRecord.length >= MAX_BUFFERED_EVENTS) {
      // The same refusal the engine's `emit` makes, in the same words and against the
      // same number: INV-26 bounds every array, and one home for the cap.
      throw new EngineError(
        `a tick may buffer at most ${String(MAX_BUFFERED_EVENTS)} events (INV-26)`,
      );
    }
    this.pendingRecord.push(draft);
  }

  /**
   * Append this tick's queued rows to the record, in `DERIVE`.
   *
   * **Before the hash, not after it.** This used to run from the engine's COMMIT sink,
   * which was correct while the record was outside `state_hash` and is unusable now
   * that it is inside: the snapshot taken at DERIVE would have described a ledger the
   * world no longer held by the end of the tick, and the next tick's abort — which
   * restores that snapshot — would have truncated away rows this tick published. The
   * slot moved; the order did not. DERIVE runs after OBLIGE, so the settlement's own
   * receipts still get the lower sequence numbers they have always had.
   *
   * Never throws. A refused row is an operator's alarm, bounded and printed, because
   * halting the world over one malformed row would cost more than the row does — and
   * the rows that matter (settlement receipts, deeds) are appended directly by the
   * batch, which does halt.
   */
  private flushRecord(tick: number): void {
    const drafts = [...this.pendingRecord];
    this.pendingRecord.length = 0;
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
 * The `event` table, plus the half a truncation alone cannot do.
 *
 * Restoring the record puts back the rows the ledger holds; it says nothing about the
 * rows this tick had *queued* for it. An aborted tick's queue must go too, or those
 * drafts are appended by the next tick's DERIVE carrying the old tick number — which
 * the ledger's watermark then refuses, one operator fault per row, for a tick nobody
 * published.
 */
function withRecordQueueCleared(table: StateTable, clear: () => void): StateTable {
  if (table.restore === undefined) {
    // Unreachable: `eventsStateTable` always supplies one. Checked rather than
    // `?.`-ed, because a silently un-restorable record is exactly the shape
    // `missingCheckpointTables` exists to refuse.
    throw new EngineError('the event state table must be restorable');
  }
  return {
    name: table.name,
    capture: () => table.capture(),
    restore: (captured: CanonicalValue): void => {
      clear();
      // Read off `table` at call time rather than destructured above: a bare method
      // reference would be an unbound `this`, and `eventsStateTable`'s restore is a
      // closure today but need not stay one.
      table.restore?.(captured);
    },
  };
}

/** Delivery records in venture order, so the capture cannot depend on write order. */
function deliveryCapture(deliveries: ReadonlyMap<VentureId, DeliveryRecord>): CanonicalValue {
  return [...deliveries.values()]
    .sort((a, b) => compareIds(a.venture, b.venture))
    .map((d) => ({
      venture: d.venture,
      tick: d.tick,
      proceeds: d.proceeds,
      stateVersion: d.stateVersion,
      eventId: d.eventId,
      // Order as written: `holders` is who was on the role when it delivered, and the
      // settlement pays them in this order.
      holders: [...d.holders],
    }));
}

/** Read the delivery book's capture. Strictly: a lost pot is a re-quoted pot. */
function readDeliveryCapture(captured: CanonicalValue): readonly DeliveryRecord[] {
  return snapArray(captured, 'delivery').map((raw, i) => {
    const where = `delivery[${String(i)}]`;
    const o = snapObject(raw, where);
    return {
      venture: snapString(o, 'venture', where) as VentureId,
      tick: snapInt(o, 'tick', where),
      proceeds: minor(snapInt(o, 'proceeds', where)),
      stateVersion: snapInt(o, 'stateVersion', where),
      eventId: snapString(o, 'eventId', where) as EventId,
      holders: snapArray(o['holders'] ?? [], `${where}.holders`).map((h, j) => {
        if (typeof h !== 'string' || h.length === 0) {
          throw new EngineError(`${where}.holders[${String(j)}]: expected a principal id`);
        }
        return h as PrincipalId;
      }),
    };
  });
}

/**
 * Read the obligation book's capture. Strictly, and both sets.
 *
 * INV-4 checks every open lock against a live obligation, so a book that came back
 * short turns legitimate escrow into an orphan lock and halts the first tick after
 * boot; a book that came back long keeps an obligation alive that the world has
 * settled. Neither is a state a caller can recover from, so a capture this reader
 * cannot account for is a refusal naming the row it choked on.
 */
export function readObligationCapture(captured: CanonicalValue): ObligationCapture {
  const root = snapObject(captured, 'obligation');
  const refs = (key: string): readonly ObligationRef[] =>
    snapArray(root[key] ?? [], `obligation.${key}`).map((raw, i) => {
      if (typeof raw !== 'string' || raw.length === 0) {
        throw new EngineError(`obligation.${key}[${String(i)}]: expected a non-empty obligation id`);
      }
      return raw as ObligationRef;
    });
  return { live: refs('live'), secured: refs('secured') };
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
