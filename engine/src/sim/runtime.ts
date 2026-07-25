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
  HandId,
  HoldingId,
  InvariantViolation,
  PrincipalId,
  SystemId,
  VentureId,
  VentureState,
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
  type LotId,
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
import type { TributeLine } from '../frames/contract.js';
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
  tickInputsFor,
  type ActionRequest,
  type CascadeAttempt,
  type ObligationSource,
  type PhaseContext,
  type StateTable,
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
  escrowRequired,
  filledIndices,
  IN_FULL,
  isEscrowable,
  isFullyFilled,
  kindSpec,
  NEUTRAL_STAGE_BPS,
  openIndices,
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
import type { RoleTerms, VentureKind } from '../core/types.js';
import {
  createWorld,
  enroll,
  handsOf,
  launchMap,
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
export const RULES_VERSION = 1;

/** The starter stake, in minor units. §12.5: "a bound starter stake". */
export const STARTER_STAKE = minor(250_000);

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

  /** Resolution-time refusals awaiting delivery, per principal. See the type's note. */
  private readonly pendingCorrections = new Map<PrincipalId, Ring<PendingCorrection>>();
  private readonly talk = new Ring<TalkEntry>(MAX_TALK_ENTRIES);
  private readonly offers = new Ring<OfferEntry>(MAX_OFFER_ENTRIES);
  private readonly claims = new Ring<ClaimEntry>(MAX_CLAIM_ENTRIES);

  /** Fill requests collected this tick, resolved once in VENTURES (PROP-V8). */
  private pendingFills: FillRequest[] = [];
  private ventureCounter = 0;

  /**
   * What each payer elected to pay, by `venture::roleIndex`.
   *
   * The payer's own statement, never the engine's inference (PROP-V4). Restated freely
   * until the commitment window closes; the last one before the freeze is the one the
   * settlement set carries, and an absent entry pays nothing.
   */
  private readonly elections = new Map<string, Election>();

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

    this.engine = new Engine({
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
      obligations: this.obligationSource(),
      // Buffered until COMMIT and appended here, so nothing an observer can read moves
      // until the tick is checked. The settlement's own receipts are the deliberate
      // exception: they are appended inside the batch, which is what makes the batch
      // one transaction with its own ASSERT (see `settleNow`).
      events: (drafts, tick) => {
        this.recordEvents(drafts, tick);
      },
      handlers: {
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
      ],
      invariantInputs: (tick) => this.invariantInputs(tick),
    });
  }

  /** The venture book. Never held across a tick boundary: the rollback replaces it. */
  get ventures(): VentureBook {
    return this.ventureBook;
  }

  /** The Levy's book. Never held across a tick boundary: the rollback replaces it. */
  get levy(): LevyBook {
    return this.levyBookRef;
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
      obligations: this.obligations,
      presence: this.world,
      roleFills: this.ventures.roleFills(),
      events: this.events,
      eventScope: 'TICK',
      defaults: this.register,
      sealBook: this.seals,
      standingChanges: this.standing.changes(),
      standings: this.standing.rows(),
      atReckoning: reckoning,
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
    if (!this.levy.isAssessed(reckoning, constellation)) return;
    try {
      this.levy.admitLate(reckoning, constellation, {
        principal,
        amount: LEVY_NOMINAL_MINOR,
        newcomerFloored: true,
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

  talksFor(principal: PrincipalId): readonly TalkEntry[] {
    return this.talk.all.filter((t) => {
      const venture = this.ventures.get(t.venture);
      if (venture === undefined) return false;
      if (venture.creator === principal) return true;
      return venture.roles.some((r) => r.filledByPrincipal === principal);
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
    const stage = readString(req.params, ['stage', 'system', 'at']) as SystemId | null;
    const hands = handsOf(this.world, req.principal);
    const here = stage ?? hands[0]?.location;
    if (here === undefined || !this.world.map.systems.has(here)) {
      return reject(
        'A2',
        'create needs a stage — the system it happens in. Name one where you have a hand.',
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
    const id = this.mintVentureId(ctx.tick, req.principal);

    const made = createVenture({
      id,
      kind,
      creator: req.principal,
      stage: here,
      terms: defaultTerms(kind, minor(value)),
      windowOpensTick: opens,
      windowClosesTick: closes,
      resolvesAtTick: resolves,
      valuation: pinnedAt(DEFAULT_VALUATION_RULE, ctx.tick),
      rulesVersion: RULES_VERSION,
    });
    if (!made.ok) return made;

    // A7: the escrowed half is locked **up front**, out of the creator's own free
    // balance. Checked here as a rejection so the ledger's throw is unreachable
    // from a request; wrapped below in case the two ever disagree.
    const required = escrowRequired(made.value);
    const stores = storesAccount(req.principal);
    if (this.ledger.account(stores) === undefined) {
      return reject('INV-1', 'you have no stores account; enroll before creating a venture.');
    }
    const free = this.ledger.freeBalance(stores);
    if (free < required) {
      return reject(
        'A7',
        `${kind} at value ${String(value)} needs ${String(required)} escrowed up front and your stores have ` +
          `${String(free)} free. Lower the value, or price more of it elective — the elective half is the ` +
          'only part standing can accrue to anyway.',
      );
    }
    try {
      openVentureEscrow(this.ledger, id, req.principal);
      if (required > 0) {
        this.ledger.transferCurrency({
          eventId: `escrow:${id}` as never,
          tick: ctx.tick,
          from: stores,
          to: escrowAccount(id, req.principal),
          amount: required,
        });
      }
    } catch (error: unknown) {
      // Never a halt from a request. The world is unchanged: the venture has not
      // been added to the book yet, and the escrow account is empty if it opened.
      return reject(
        'A7',
        `the escrow for ${id} could not be funded (${describeError(error)}). Nothing was created.`,
      );
    }

    this.ventures.add(made.value);
    ctx.emit({
      tick: ctx.tick,
      kind: 'venture.formed',
      rulesVersion: RULES_VERSION,
      actorPrincipalId: req.principal,
      onBehalfOfPrincipalId: null,
      grantId: null,
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
      payload: { venture: id, kind, stage: here, escrowed: required, termsHash: made.value.termsHash },
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
    if (this.pendingFills.length >= MAX_TALK_ENTRIES) {
      return reject('INV-26', 'the fill queue for this tick is full; try the next tick.');
    }
    // A request, not a grant (PROP-V8). Resolved once at VENTURES, from the set.
    this.pendingFills.push({
      venture: ventureId,
      roleIndex,
      principal: req.principal,
      hand: handId,
      clientSequence: this.pendingFills.length,
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
    const ventureId = readString(req.params, ['venture', 'venture_id']) as VentureId | null;
    const roleIndex = readInt(req.params, ['role', 'role_index', 'roleIndex']);
    const raw = req.params['election'] ?? req.params['elect'] ?? req.params['pay'];
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

  /** What the payer has stated for one role, or `undefined` for silence. */
  electionOn(venture: VentureId, roleIndex: number): Election | undefined {
    return this.elections.get(electionKey(venture, roleIndex));
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
    this.talk.push({ venture: ventureId, from: req.principal, act, text, tick: ctx.tick });
    return { ok: true, value: null };
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
    const named = readString(req.params, ['role_venture', 'roleVenture']) ?? target;
    const namedIndex = readInt(req.params, ['role', 'role_index', 'roleIndex']);
    const matching =
      held.find((r) => r.venture === named && (namedIndex === null || r.roleIndex === namedIndex)) ?? null;
    // No named match: claim the first held role that still has its free slot, so a
    // mandatory seal is free even when the agent did not spell the role out.
    const unspent =
      matching ??
      held.find(
        (r) => this.seals.freeSlotsRemaining(req.principal, reckoningOf(ctx.tick), [r]) > 0,
      ) ??
      null;

    const committed = this.seals.commit({
      principal: req.principal,
      tick: ctx.tick,
      actedOnStateVersion: ctx.frozenStateVersion,
      stateVersion: ctx.frozenStateVersion,
      intent: { verb, target, measure, outcomeLow: low, outcomeHigh: high },
      prose: readString(req.params, ['prose']) ?? '',
      role: unspent,
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
      allocateFills(this.ventures, this.pendingFills, {
        tick: ctx.tick,
        handOf: (id) => this.world.hands.get(id),
      });
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
  private levySubject(principal: PrincipalId, tick: number): LevySubject {
    const position = principalPosition(this.ledger, principal, storesAccount(principal));
    const hands = handsOf(this.world, principal);
    // Tenure from the earliest hand's own clock. Hands are minted exactly once, at
    // enrolment, and are never destroyed (INV-8), so `presentSinceTick` of the first hand
    // is the enrolment tick by construction — a second `enrolledAt` column would be one
    // fact with two homes, and the one that drifted would decide the newcomer floor.
    const seatedAt = hands.reduce<number>((earliest, hand) => {
      const since = hand.presentSinceTick ?? 0;
      return since < earliest ? since : earliest;
    }, tick);
    return {
      principal,
      tenureTicks: Math.max(0, tick - seatedAt),
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
    if (this.levyAssessedReckoning === reckoning) return;
    if (this.world.principalOrder.length === 0) return;
    let assessed;
    try {
      assessed = assessCycle({
        book: this.levy,
        world: this.world,
        tick: ctx.tick,
        subjectOf: (principal) => this.levySubject(principal, ctx.tick),
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
    if (this.levySettledReckoning === reckoning) return;
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

  /** Unpledged, available units of the levy good in a principal's STORES. */
  private levyGoodAvailable(principal: PrincipalId): Qty {
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
      obligations: this.obligations,
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

/** The settlement tick at or after `tick`. Settlement is the last tick of a day. */
export function nextSettlementAtOrAfter(tick: number): number {
  return tick + ticksUntilReckoning(tick) - 1;
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
