/**
 * **The Reckoning.** SPEC §15.3's sequence, wired end to end, as one transaction that
 * fails closed.
 *
 * > Commitment window (`PARTIES`-visible) -> freeze, settlement set computed and inputs
 * > hashed -> settle: assert the input hash equals what parties acted on -> escrowed
 * > parts -> elective parts in `venture_id` order -> cascade in <=3 fixed rounds, and
 * > **an obligation still unresolved at the round limit DEFERS to the next Reckoning; it
 * > never defaults** -> split waterfall with deterministic remainder -> reveal seals
 * > stamped `reckoning_id` -> receipts, standing, unlock -> reconcile -> release. **The
 * > whole batch is one transaction that fails closed**; a partially-committed batch is a
 * > permanent silent imbalance in an append-only ledger, which is unrecoverable by
 * > construction. — §15.3
 *
 * This module is the object that ties tick, venture, seal, ledger and events together.
 * It owns no rule of its own: every arithmetic decision belongs to the module that
 * declared it, and what happens here is *order*, *capture*, and *attribution*.
 *
 * ## The stages, and which of them do work
 *
 * `settleBatch` performs `ESCROWED`, `ELECTIVE`, `CASCADE`, `WATERFALL`, the
 * encumbrance unlock and the presence release **in one call**, in §15.3's order, because
 * there is exactly one settlement implementation (PROP-V7) and splitting it across
 * stages would mean writing a second one. So:
 *
 * | stage | what it does here |
 * |---|---|
 * | `FREEZE` | shape and idempotence checks on the frozen set. Pure; a throw applies nothing |
 * | `VERIFY_INPUTS` | §15.3's "assert the input hash equals what parties acted on". Pure. **E2E-12 and E2E-14 bite here** |
 * | `ESCROWED` | runs `settleBatch`, which performs the four money stages in order |
 * | `ELECTIVE` | asserts PROP-V4 over the result: no elective unit moved without an election |
 * | `CASCADE` | `assertBoundedRounds` (DET-9), and that no deferral recorded a breach |
 * | `WATERFALL` | INV-6 over the escrow pot, through the ledger's own `assertPayoutsExact` |
 * | `SEALS` | `SealBook.resolve` — stamped with its own `reckoning_id` by construction |
 * | `RECEIPTS` | appends the record, **resolves INV-17's attribution column**, moves standing, closes obligations |
 * | `RECONCILE` | escrow drained, states agree, receipts and report agree |
 * | `RELEASE` | presence and locks are genuinely back (E2E-13's denial-of-settlement clause) |
 *
 * The stages after `ESCROWED` verify rather than perform, and each of their checks is
 * the post-condition of a step `settleBatch` takes on its own. A failure in any of them
 * is `TICK-TORN` — correctly, because value has already moved in memory and the recovery
 * is a replay from `(snapshot_T, action_log_T, seed_T)`, never a repair.
 *
 * ## What "fails closed" means, precisely
 *
 * Publication is commit (`src/invariants/transaction.ts`). Nothing an observer can read
 * moves until `runReckoning` publishes, and the two things an observer reads are the
 * published pointer and the event ledger. So **every append happens in `RECEIPTS`**,
 * after all arithmetic has succeeded, and the published pointer moves only after ASSERT
 * is clean. A stage that throws before `RECEIPTS` has written no permanent row at all.
 *
 * ## What the tick loop owes this module, and it is not optional
 *
 * `VERIFY_INPUTS` compares the escrow balance and the payer's free balance between the
 * freeze and the settlement, and **halts on any difference in either direction**. That is
 * §5.1's hard freeze read literally — "no new commitments, no book clears, no raid
 * resolution, no grant spend, no hazard against any object in the settlement set" — and it
 * means the phases that run at the freeze tick *before* `VENTURES` must skip every object
 * in {@link FrozenReckoning.objects}. A `MARKETS` clear or a `PRODUCE` payout that credits
 * a payer's stores at the freeze tick is not harmless here: it moves a figure the
 * settlement was computed from, so this driver refuses to settle and the world pauses on a
 * tick where nothing was actually wrong.
 *
 * The check is deliberately symmetric rather than "halt only if the balance fell". A credit
 * that arrives inside the freeze is the same class of defect as a drain — the settlement
 * would resolve from a state the parties never acted on — and a one-sided check would make
 * the *flattering* direction invisible, which is how `src/invariants/audit.ts` once found a
 * default quietly disappearing because a drained payer had been refilled out of order.
 *
 * ## What this module deliberately does not do
 *
 *   - **It does not offer wakes.** §5.1's "offered exactly one wake before it" is the
 *     tick loop's `WAKE` phase, which runs after `COMMIT`; a wake offered from inside
 *     the transaction advertises a tick that may still abort.
 *   - **It does not enforce seal compliance.** PROP-D4's "sealing is mandatory" is a
 *     validator on the acting path, not a Reckoning-time penalty: halting on an unsealed
 *     role would hand every agent a one-role denial of settlement (AGT-X9). Unsealed
 *     roles are *reported* in {@link ReckoningOutcome.unsealedRoles}.
 *   - **It does not decide outcomes.** The resolution plan — outcome, pinned proceeds,
 *     elections, the event that destroyed value — is computed before the freeze by the
 *     `VENTURES` and `HAZARD` phases and arrives in the frozen set.
 */

import { reckoningIndex } from '../core/time.js';
import type { EventId, InvariantViolation, PrincipalId, VentureId } from '../core/types.js';
import { minor, sumMinor, type Minor } from '../core/units.js';
import type { EventLedger } from '../events/index.js';
import type { ObligationBook, ObligationRef, Ledger } from '../ledger/index.js';
import { assertPayoutsExact, compareIds, type Payout, type WaterfallResult } from '../ledger/index.js';
import {
  assertBoundedRounds,
  checkInvariants,
  runReckoning,
  type DefaultAttribution,
  type DefaultRegister,
  type HaltController,
  type InvariantInputs,
  type InvariantReport,
  type SettledPayouts,
  type Stage,
  type StandingDiff,
  type TickInputs,
  type TransactionOutcome,
} from '../invariants/index.js';
import {
  allDeedsWitness,
  roleKey,
  sealVerdictEvent,
  type Deed,
  type SealBook,
  type SealResolution,
  type SealRoleRef,
} from '../seal/index.js';
import type { WorldState } from '../world/index.js';
import {
  settleBatch,
  type ReceiptContext,
  type SettleInput,
  type SettlementAccounts,
  type SettlementBatch,
  type VentureBook,
  type VentureSettlement,
} from '../venture/index.js';
import { isTerminalState, reconcileFaults, releaseFaults } from './reconcile.js';
import { appendSettlementReceipts, settlementHandle, type SettlementReceipt } from './receipts.js';
import {
  ReckoningHalt,
  partiesOfReckoning,
  settlementItemsOf,
  settlementSetOf,
  verifyFrozenInputs,
  type FrozenObligation,
  type FrozenReckoning,
  type ObligationPlan,
} from './set.js';
import { StandingBook, type SealChargeRow, type StandingCredit } from './standing.js';

/** The obligation book plus the one mutation a settlement needs. */
export type ReckoningObligations = ObligationBook & {
  close(ref: ObligationRef): void;
};

export interface ReckoningWorld {
  readonly ledger: Ledger;
  readonly book: VentureBook;
  readonly events: EventLedger;
  /** INV-17's index. The only door through which a default may be recorded. */
  readonly register: DefaultRegister;
  readonly seals: SealBook;
  readonly standing: StandingBook;
  readonly obligations: ReckoningObligations;
  readonly accounts: SettlementAccounts;
  /**
   * The hand rows. The driver derives `SettlementPresence` from this itself, so a
   * caller cannot forget to release presence — a `COMMITTED` hand filling no live role
   * is an INV-9 halt on the next tick.
   */
  readonly presence: WorldState;
}

export interface ReckoningRun {
  readonly world: ReckoningWorld;
  /** Produced by `freezeReckoning` at the freeze, and immutable since. */
  readonly frozen: FrozenReckoning;
  readonly rulesVersion: number;
  readonly controller: HaltController;
  /** The immutable triple this tick derives from, for the halt record. */
  readonly inputs: TickInputs;
  /** Ground truth for the seals. Engine-recorded facts, never claims. */
  readonly deeds: readonly Deed[];
  /**
   * The completeness witness's per-principal tally: `(principal, deedCount)` pairs,
   * **including principals with zero deeds**, because a principal tallied at 0 is a
   * witnessed abstention and is marked, while a principal absent from the tally is an
   * unanswered question and defers.
   *
   * Required, not defaulted, and **the counts must come from wherever the deeds were
   * written** — the producer's own running count, or the venture and role records. The
   * one thing a caller must not do is `deeds.filter(...).length`, which makes the
   * resolver's comparison a tautology and reopens the §15.4 false-mark route one layer
   * up. `src/seal/book.ts` states the rule at length on `DeedTally`; this driver
   * deliberately passes the tally straight through and never derives it from
   * {@link ReckoningRun.deeds}, so there is nowhere here for the tautology to hide.
   */
  readonly deedTally: readonly (readonly [PrincipalId, number])[];
  /** `state_hash` of `snapshot_T+1`. A wired tick loop passes the engine's. */
  readonly stateHash?: () => string;
  /** Inputs for invariants this module does not own (the Levy, the docket, grants). */
  readonly extraInvariantInputs?: Partial<InvariantInputs>;
  /**
   * ⚠ **Skip §15.3's input-hash assertion and settle anyway.**
   *
   * This exists for exactly one reason, and it is E2E-12's second half: *"Then assert
   * the same attempt with the freeze disabled **does** fabricate one — proving the test
   * can detect the bug it exists for."* A defence that cannot be shown to bite is
   * indistinguishable from no defence, and the only way to show it is to run the same
   * code path with it off.
   *
   * Only `true` is accepted, so a config that carries the key at all is visibly wrong,
   * and the bypassed faults are published in
   * {@link ReckoningOutcome.bypassedFreezeFaults} rather than swallowed.
   */
  readonly disableFreeze?: true;
}

export interface ReckoningOutcome {
  readonly reckoning: number;
  readonly tick: number;
  readonly transaction: TransactionOutcome;
  readonly settlements: readonly VentureSettlement[];
  readonly receipts: readonly SettlementReceipt[];
  /** Every accusation this Reckoning published, with its evidence (INV-17). */
  readonly defaults: readonly DefaultAttribution[];
  readonly seals: SealResolution | null;
  /** The facts standing moved on, each paired with the minted row that justifies it. */
  readonly standingCredits: readonly StandingCredit[];
  readonly roundsUsed: number;
  readonly truncated: boolean;
  readonly unattributed: Minor;
  /** Elections the freeze could not read, by venture. Empty in a validated world. */
  readonly malformedElections: readonly { readonly venture: string; readonly roleIndex: number }[];
  /** PROP-D4's Reckoning-time audit. Reported, never punished here. */
  readonly unsealedRoles: readonly { readonly principal: PrincipalId; readonly role: string }[];
  /** Parties the tick loop's `WAKE` phase owes a wake to (§5.1). */
  readonly parties: readonly PrincipalId[];
  readonly report: InvariantReport | null;
  /** Faults the freeze found and `disableFreeze` ignored. Empty in production. */
  readonly bypassedFreezeFaults: readonly string[];
  /**
   * Ways the deed set and its own witness failed to reconcile.
   *
   * **A healthy Reckoning has none**, and each one costs the seals of the principal it
   * names — those defer, with no mark. Surfaced because it is an operator's alarm that
   * the deed query and the deed tally disagree, and it is deliberately *not* a halt: the
   * one witness fault whose cause might be the tally rather than the query cannot be
   * proven beyond agent influence, and a halt is for our bug (AGT-X9).
   */
  readonly deedSetFaults: readonly string[];
}

/**
 * One Reckoning, as a set of stages plus the boxes they hand each other.
 *
 * A class rather than a closure because the stage list has to be *inspectable*: DET-10
 * requires injecting a failure at each stage of §15.3's sequence, and the honest way to
 * do that is to let a test wrap the driver's own stages rather than to build a
 * second, test-only pipeline or to put a failure switch in production code.
 */
export class ReckoningBatch {
  private batch: SettlementBatch | null = null;
  private sealResolution: SealResolution | null = null;
  private readonly receipts: SettlementReceipt[] = [];
  private readonly credits: StandingCredit[] = [];
  private readonly bypassed: string[] = [];
  private settledPayouts: readonly SettledPayouts[] = [];
  private diffs: readonly StandingDiff[] = [];
  private settlementSeqFrom = 0;

  constructor(private readonly run: ReckoningRun) {
    const { frozen, inputs } = run;
    if (inputs.tick !== frozen.settlementTick) {
      // `HaltController.haltTick` refuses a record whose triple is for another tick, so
      // this would surface later as an unrelated error about a resume replaying the
      // wrong tick.
      throw new ReckoningHalt(
        `the tick inputs are for tick ${inputs.tick} but the frozen set settles at ` +
          `${frozen.settlementTick}; a halt record for the wrong tick would replay the wrong tick`,
      );
    }
    if (reckoningIndex(frozen.settlementTick) !== frozen.reckoning) {
      throw new ReckoningHalt(
        `the frozen set says Reckoning ${frozen.reckoning} and tick ${frozen.settlementTick} is in ` +
          `${reckoningIndex(frozen.settlementTick)}`,
      );
    }
  }

  /** §15.3's sequence, in order, as `runReckoning` stages. */
  stages(): readonly Stage[] {
    return [
      { name: 'FREEZE', run: () => this.freeze() },
      { name: 'VERIFY_INPUTS', run: () => this.verifyInputs() },
      { name: 'ESCROWED', run: (ctx) => ctx.effect(() => this.settle()) },
      { name: 'ELECTIVE', run: (ctx) => ctx.effect(() => this.assertElective()) },
      { name: 'CASCADE', run: (ctx) => ctx.effect(() => this.assertCascade()) },
      { name: 'WATERFALL', run: (ctx) => ctx.effect(() => this.assertWaterfall()) },
      { name: 'SEALS', run: (ctx) => ctx.effect(() => this.resolveSeals()) },
      { name: 'RECEIPTS', run: (ctx) => ctx.effect(() => this.postReceipts()) },
      { name: 'RECONCILE', run: (ctx) => ctx.effect(() => this.reconcile()) },
      { name: 'RELEASE', run: (ctx) => ctx.effect(() => this.release()) },
    ];
  }

  // ── FREEZE ─────────────────────────────────────────────────────────────────

  /**
   * Shape and idempotence. Pure: a throw here applies nothing at all.
   *
   * The idempotence check is the one that matters. Running a Reckoning twice would pay
   * every elective part twice and write two receipts for one promise, and the seal book
   * is the only structure in the engine that already refuses a second resolution — so
   * its answer is borrowed as the driver's own gate rather than kept in a second flag.
   */
  private freeze(): void {
    const { frozen, world } = this.run;
    if (world.seals.isResolved(frozen.reckoning)) {
      throw new ReckoningHalt(
        `Reckoning ${frozen.reckoning} has already resolved its seals, so this is a second settlement of ` +
          'the same Reckoning; one obligation settles once and two receipts for one promise is a record ' +
          'that cannot be read',
      );
    }
    for (const o of frozen.obligations) {
      if (world.book.get(o.venture) === undefined) {
        throw new ReckoningHalt(
          `${o.venture} is in the frozen settlement set and not in the book; the set was computed against ` +
            'a different world',
        );
      }
    }
    for (const deed of this.run.deeds) {
      if (deed.tick > frozen.settlementTick) {
        throw new ReckoningHalt(
          `deed ${deed.eventId} is at tick ${deed.tick}, after the settlement tick ` +
            `${frozen.settlementTick}; a verdict computed from the future is not a verdict`,
        );
      }
    }
  }

  // ── VERIFY_INPUTS ──────────────────────────────────────────────────────────

  /**
   * §15.3's "assert the input hash equals what parties acted on".
   *
   * The load-bearing stage. Everything the settlement is about to pay from was read at
   * the freeze and is read again here; if any of it moved, the settlement would resolve
   * from a state nobody acted on and would record the difference as a broken promise.
   * §15.4's sentence is the whole reason this exists:
   *
   * > I commit to pay from account X; during the window my convoy is raided and X is
   * > drained; my "default" is your bug, permanently attached to my name, invisible in a
   * > healthy-looking system.
   *
   * Halting is the answer rather than settling on the new numbers, because there is no
   * outcome to publish that is not a lie about somebody.
   */
  private verifyInputs(): void {
    const faults = verifyFrozenInputs(this.run.frozen, this.run.world);
    if (faults.length === 0) return;
    if (this.run.disableFreeze === true) {
      this.bypassed.push(...faults);
      return;
    }
    throw new ReckoningHalt(
      `the settlement inputs moved between the freeze and the settlement, so nothing is settled:\n  - ` +
        faults.join('\n  - '),
    );
  }

  // ── ESCROWED ───────────────────────────────────────────────────────────────

  /**
   * The money. `settleBatch` performs `ESCROWED -> ELECTIVE -> CASCADE -> WATERFALL`,
   * the unlock and the presence release, in that order.
   *
   * `actedOnStateVersion` is **the frozen capture**, taken from the immutable settlement
   * set. That is the contract `SettleInput.actedOnStateVersion` documents and the reason
   * this driver exists: the engine's live counter would halt every venture that outlives
   * its activation tick, and the row read back at settlement is the same object on both
   * sides of `!==` — a check that cannot fail.
   */
  private settle(): void {
    const { frozen, world } = this.run;
    const inputs: SettleInput[] = frozen.obligations.map((o) => ({
      venture: world.book.require(o.venture),
      tick: frozen.settlementTick,
      eventId: settlementHandle(frozen.reckoning, o.venture),
      outcome: o.plan.outcome,
      proceeds: o.plan.proceeds,
      elections: o.plan.elections,
      actedOnStateVersion: o.reading.actedOnStateVersion,
      causeEventId: o.plan.causeEventId,
    }));
    this.batch = settleBatch(world.ledger, world.book, inputs, world.accounts, {
      handOf: (id) => world.presence.hands.get(id),
    });
  }

  private settled(): SettlementBatch {
    if (this.batch === null) {
      throw new ReckoningHalt('the settlement has not run; the stages are out of §15.3’s order');
    }
    return this.batch;
  }

  /**
   * The frozen obligation for a venture the settlement produced.
   *
   * Throws rather than skipping. A settlement for a venture that is not in the frozen set
   * means the driver settled something the freeze never hashed — the one thing the freeze
   * exists to make impossible — and quietly ignoring it would let that settlement's
   * elections, cause and receipts be read off nothing at all.
   */
  private frozenFor(venture: VentureId): FrozenObligation {
    const found = this.run.frozen.obligations.find((x) => x.venture === venture);
    if (found === undefined) {
      throw new ReckoningHalt(
        `${venture} produced a settlement and is not in the frozen settlement set; nothing outside the ` +
          'freeze may settle',
      );
    }
    return found;
  }

  private planFor(venture: VentureId): ObligationPlan {
    return this.frozenFor(venture).plan;
  }

  // ── ELECTIVE ───────────────────────────────────────────────────────────────

  /**
   * PROP-V4's second clause, asserted over the result: **the elective part never
   * auto-executes.**
   *
   * A5's whole product is a record of promises kept, and a unit of elective value that
   * moved without an election is the record crediting a payer with a choice it never
   * made — the flattering mirror of a fabricated default, and just as wrong.
   *
   * The self-dealt case is exempt because nothing moves in it: settlement books a
   * creator's payment to itself as fully paid without an election, so that it can never
   * read as a breach (scar #9).
   */
  private assertElective(): void {
    const faults: string[] = [];
    for (const s of this.settled().settlements) {
      const o = this.frozenFor(s.venture);
      for (const p of s.payouts) {
        if (p.holder === null || p.electivePaid <= 0) continue;
        if (p.holder === o.payer) continue;
        if (!o.plan.elections.has(p.roleIndex)) {
          faults.push(
            `${s.venture} role ${p.roleIndex} was paid ${p.electivePaid} of elective value with no ` +
              'election; the elective half never auto-executes (A7, PROP-V4)',
          );
        }
      }
    }
    if (faults.length > 0) throw new ReckoningHalt(faults.join('; '));
  }

  // ── CASCADE ────────────────────────────────────────────────────────────────

  /** DET-9's bound, and §15.3's promise that a deferral is never a breach. */
  private assertCascade(): void {
    const batch = this.settled();
    // Through the invariants module's own assertion rather than a private copy: the
    // round limit's reason is a halt-semantics reason and it has one home.
    assertBoundedRounds(batch.roundsUsed);
    for (const s of batch.settlements) {
      if (s.terminalState !== 'DEFERRED') continue;
      if (s.defaults.length > 0 || s.standing.length > 0) {
        throw new ReckoningHalt(
          `${s.venture} deferred and recorded ${s.defaults.length} default(s) and ${s.standing.length} ` +
            'standing change(s); an obligation unresolved at the round limit DEFERS and never defaults',
        );
      }
    }
  }

  // ── WATERFALL ──────────────────────────────────────────────────────────────

  /**
   * INV-6 over the escrowed pot, through the ledger's own `assertPayoutsExact`.
   *
   * The escrowed half is a single pot paid by seniority, which is exactly the shape
   * `WaterfallResult` models — so this is a genuine instance of INV-6 rather than a
   * re-spelling of it, and the clause it can actually catch is the one that matters
   * here: **a junior `share` band paid while a senior `wage` band was short** (§7.1's
   * inversion, where "the ledger would record the broken promise as honoured").
   *
   * The elective half is deliberately *not* modelled as a waterfall. It pays from the
   * payer's own stores on an explicit election, so "one pot, pro-rata by seniority" is
   * the wrong shape for it; its exactness is `checkSettlementExact`'s job in `RECONCILE`.
   */
  private assertWaterfall(): void {
    const out: SettledPayouts[] = [];
    for (const s of this.settled().settlements) {
      const payouts: Payout[] = [];
      for (const p of s.payouts) {
        const holder = p.holder;
        if (holder === null || p.escrowedDue <= 0) continue;
        payouts.push({
          account: this.run.world.accounts.storesOf(holder),
          priority: p.priority,
          claimed: p.escrowedDue,
          paid: p.escrowedPaid,
          // Zero-padded so the code-unit tiebreak inside a band is role-index order,
          // the same key settlement itself builds.
          key: `${s.venture}:${String(p.roleIndex).padStart(2, '0')}`,
        });
      }
      const paid = sumMinor(payouts.map((p) => p.paid));
      const claimed = sumMinor(payouts.map((p) => p.claimed));
      const result: WaterfallResult = {
        payouts,
        shortfall: minor(claimed - paid),
        surplus: minor(0),
      };
      // What the pot actually delivered is the proceeds of *this* waterfall: the escrow
      // may have been raided between signing and settlement, which is a recorded loss
      // and never a default (§10.2, PROP-L3).
      assertPayoutsExact(paid, result);
      out.push({ obligation: `${s.venture}#escrowed`, proceeds: paid, result });
    }
    this.settledPayouts = Object.freeze(out);
  }

  // ── SEALS ──────────────────────────────────────────────────────────────────

  /**
   * "Reveal seals stamped `reckoning_id`" (§15.3).
   *
   * The stamp is not applied here and cannot be: `SealBook` derives `reckoningIndex`
   * from the sealing tick and refuses to resolve outside that Reckoning's own settlement
   * tick, which is scar #7 closed by construction rather than by care.
   */
  private resolveSeals(): void {
    const { frozen, world } = this.run;
    this.sealResolution = world.seals.resolve({
      reckoningIndex: frozen.reckoning,
      atTick: frozen.settlementTick,
      stateVersion: frozen.stateVersion,
      deeds: this.run.deeds,
      // The tally goes through untouched. Deriving it from `this.run.deeds` — even
      // partially, even to "fill in" a principal the caller forgot — would make the
      // resolver compare a number against its own source, which is the tautology
      // `allDeedsWitness` was rewritten to make impossible.
      deedSet: allDeedsWitness(frozen.reckoning, frozen.stateVersion, this.run.deedTally),
    });
  }

  // ── RECEIPTS ───────────────────────────────────────────────────────────────

  /**
   * The record: receipts, the attribution column, seal verdicts, standing, unlock.
   *
   * **This is the only stage that appends.** Everything before it is arithmetic in
   * memory, so a failure up to this point leaves no permanent row — which is what makes
   * "the whole batch is one transaction that fails closed" literal rather than
   * aspirational.
   */
  private postReceipts(): void {
    const { frozen, world } = this.run;
    const batch = this.settled();

    // INV-18's boundary. Captured immediately before the first append: with
    // `FREEZE_TICKS === 1` the freeze and the settlement share a tick, so the sequence
    // within it is the only thing separating the settlement's own rows from a third
    // party's.
    this.settlementSeqFrom = world.events.eventsAtTick(frozen.settlementTick).length;

    const ordered = [...batch.settlements].sort((a, b) => compareIds(a.venture, b.venture));
    for (const settlement of ordered) {
      const venture = world.book.require(settlement.venture);
      const receipt = appendSettlementReceipts({
        events: world.events,
        register: world.register,
        settlement,
        creator: venture.creator,
        ctx: this.receiptContext(),
        handle: settlementHandle(frozen.reckoning, settlement.venture),
        causeEventId: this.planFor(settlement.venture).causeEventId,
        reckoning: frozen.reckoning,
      });
      this.receipts.push(receipt);

      // Standing cites the minted rows, not the handles: `checkStandingJournal` asserts
      // that a `DEFAULT` change's event is in the `DefaultRegister`, so reputation can
      // only fall for an accusation the engine can justify (INV-17, INV-21).
      const defaultRowOf = new Map<string, EventId>();
      for (const d of receipt.defaults) defaultRowOf.set(`${settlement.venture}::${d.payee}`, d.eventId);
      for (const delta of settlement.standing) {
        const eventId =
          delta.cause === 'DEFAULT'
            ? defaultRowOf.get(`${delta.venture}::${delta.counterparty}`)
            : receipt.settledEventId;
        if (eventId === undefined) {
          throw new ReckoningHalt(
            `${delta.venture}: standing falls for ${delta.principal} against ${delta.counterparty} but no ` +
              'default row was published for that pair; reputation must never fall for an accusation the ' +
              'record cannot show',
          );
        }
        this.credits.push({ delta, eventId });
      }
    }

    // Seal verdicts, before standing, because a contradicted seal's charge cites the
    // minted `SEAL_RESOLVED` row.
    const charges: SealChargeRow[] = [];
    const resolution = this.sealResolution;
    if (resolution !== null) {
      const verdictRowOf = new Map<string, EventId>();
      for (const v of resolution.verdicts) {
        const rec = world.seals.auditRecord(v.sealId);
        if (rec === null) {
          throw new ReckoningHalt(`seal ${v.sealId} resolved and has no audit record`);
        }
        // No payload argument and no allow-list argument exists to pass: the ladder
        // decides what escapes a seal, not its author (PROP-D2).
        verdictRowOf.set(v.sealId, world.events.append(sealVerdictEvent(rec, this.run.rulesVersion, null)).event.id);
      }
      for (const charge of resolution.charges) {
        const eventId = verdictRowOf.get(charge.sealId);
        if (eventId === undefined) {
          throw new ReckoningHalt(
            `seal ${charge.sealId} charges standing but published no verdict row; a permanent mark with no ` +
              'row is a mark nobody can audit',
          );
        }
        charges.push({ charge, eventId });
      }
    }

    // The before/after rows come back from the one writer, because INV-21's per-batch
    // half is a claim about *this* batch and nothing else can produce them: the journal
    // is cumulative, so re-deriving "what moved tonight" from it after the fact would be
    // a second arithmetic that can disagree with the table (scar #14a).
    this.diffs = world.standing.apply({
      tick: frozen.settlementTick,
      credits: this.credits,
      charges,
    }).diffs;

    // "unlock" — the encumbrances are released inside `settleBatch`; the obligation
    // book's own entry is the driver's half. A deferral keeps its entry: the obligation
    // carries over even though the lock does not.
    for (const s of batch.settlements) {
      if (isTerminalState(s.terminalState)) world.obligations.close(s.venture);
    }
  }

  /**
   * One venture's cohort, stable for its whole life.
   *
   * `event_family_id` is §15.1's "immutable primary cohort", so it names the venture and
   * not the Reckoning: the receipt reel pulls formation, negotiation and settlement out
   * of one `transcript(family)` call, and a per-Reckoning cohort would split a deferred
   * obligation's story in half.
   *
   * `parentEventId` is null. The causal edge that matters is the default's, and this
   * module resolves that one itself (see `receipts.ts`); the driver has no minted
   * formation id to hand, and inventing one would make INV-12 refuse the row.
   */
  private receiptContext(): ReceiptContext {
    return {
      tick: this.run.frozen.settlementTick,
      rulesVersion: this.run.rulesVersion,
      actedOnStateVersion: this.run.frozen.stateVersion,
      familyOf: (venture) => `venture::${venture}`,
      parentEventId: null,
    };
  }

  // ── RECONCILE / RELEASE ────────────────────────────────────────────────────

  private reconcile(): void {
    const faults = reconcileFaults({
      frozen: this.run.frozen,
      ledger: this.run.world.ledger,
      book: this.run.world.book,
      accounts: this.run.world.accounts,
      obligations: this.run.world.obligations,
      settlements: this.settled().settlements,
      receipts: this.receipts,
      tick: this.run.frozen.settlementTick,
    });
    if (faults.length > 0) {
      throw new ReckoningHalt(`the Reckoning does not reconcile:\n  - ${faults.join('\n  - ')}`);
    }
  }

  private release(): void {
    const faults = releaseFaults({
      frozen: this.run.frozen,
      ledger: this.run.world.ledger,
      book: this.run.world.book,
      settlements: this.settled().settlements,
    });
    if (faults.length > 0) {
      throw new ReckoningHalt(`the Reckoning did not release:\n  - ${faults.join('\n  - ')}`);
    }
  }

  // ── ASSERT ─────────────────────────────────────────────────────────────────

  /**
   * The ASSERT phase, over the state the effects produced. **Exactly once per tick**:
   * the record pass advances INV-14's before-and-after snapshot as a side effect, so a
   * second call is blind to the first's regressions.
   */
  assert(): InvariantReport {
    const { frozen, world } = this.run;
    const bag: InvariantInputs = {
      ...this.run.extraInvariantInputs,
      ledger: world.ledger,
      obligations: world.obligations,
      events: world.events,
      eventScope: 'TICK',
      defaults: world.register,
      settlements: this.settledPayouts,
      settlementSet: settlementSetOf(frozen, this.settlementSeqFrom),
      settlementItems: settlementItemsOf(frozen, world.book),
      sealBook: world.seals,
      standingChanges: world.standing.changes(),
      standings: world.standing.rows(),
      standingDiffs: this.diffs,
      presence: world.presence,
      roleFills: world.book.roleFills(),
      principals: world.presence.principalOrder,
      atReckoning: frozen.reckoning,
    };
    return checkInvariants(bag, frozen.settlementTick);
  }

  /** Everything the caller needs, including on a halt. */
  outcome(transaction: TransactionOutcome): ReckoningOutcome {
    const batch = this.batch;
    return {
      reckoning: this.run.frozen.reckoning,
      tick: this.run.frozen.settlementTick,
      transaction,
      settlements: batch?.settlements ?? [],
      receipts: Object.freeze([...this.receipts]),
      // This Reckoning's accusations, not every one the register ever held: a caller
      // asserting "no default tonight" against a lifetime total would pass on a world
      // that had already libelled somebody.
      defaults: this.run.world.register
        .all()
        .filter((a) => a.reckoningIndex === this.run.frozen.reckoning),
      seals: this.sealResolution,
      standingCredits: Object.freeze([...this.credits]),
      roundsUsed: batch?.roundsUsed ?? 0,
      truncated: batch?.truncated ?? false,
      unattributed: batch?.unattributed ?? minor(0),
      malformedElections: this.run.frozen.obligations.flatMap((o) =>
        o.malformedElections.map((roleIndex) => ({ venture: o.venture, roleIndex })),
      ),
      unsealedRoles: this.unsealedRoles(),
      parties: partiesOfReckoning(this.run.frozen),
      report: transaction.report,
      bypassedFreezeFaults: Object.freeze([...this.bypassed]),
      deedSetFaults: this.sealResolution?.deedSetFaults ?? [],
    };
  }

  /**
   * PROP-D4's Reckoning-time audit: roles carried into the freeze with no seal.
   *
   * Reported and never punished. The cure is free and immediate, so the right place to
   * refuse an unsealed role is the acting path (`sealComplianceRejection`); halting here
   * would let one agent stop everybody's settlement by declining one free verb (AGT-X9).
   */
  private unsealedRoles(): readonly { readonly principal: PrincipalId; readonly role: string }[] {
    const held = new Map<PrincipalId, SealRoleRef[]>();
    for (const o of this.run.frozen.obligations) {
      for (const [roleIndex, holder] of o.reading.holders.entries()) {
        if (holder === null) continue;
        const list = held.get(holder) ?? [];
        list.push({ venture: o.venture, roleIndex });
        held.set(holder, list);
      }
    }
    const out: { readonly principal: PrincipalId; readonly role: string }[] = [];
    for (const principal of [...held.keys()].sort(compareIds)) {
      const roles = held.get(principal) ?? [];
      for (const ref of this.run.world.seals.unsealedRoles(
        principal,
        this.run.frozen.reckoning,
        roles,
      )) {
        out.push({ principal, role: roleKey(ref) });
      }
    }
    return Object.freeze(out);
  }
}

/**
 * Run one Reckoning. Either the published pointer moves or nothing an observer can see
 * has changed.
 */
export function runReckoningBatch(run: ReckoningRun): ReckoningOutcome {
  const batch = new ReckoningBatch(run);
  const transaction = runReckoning({
    tick: run.frozen.settlementTick,
    inputs: run.inputs,
    stages: batch.stages(),
    assert: () => batch.assert(),
    stateHash: run.stateHash ?? (() => run.world.ledger.stateHash()),
    controller: run.controller,
  });
  return batch.outcome(transaction);
}

/** Violations, as the tick loop's `assertions` hook wants them. */
export function reckoningViolations(outcome: ReckoningOutcome): readonly InvariantViolation[] {
  return outcome.report?.violations ?? [];
}
