/**
 * The tick. SPEC §15.2, and the module the whole design's determinism rests on.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WITHIN-TICK ACTIONS NEVER REACT TO ANOTHER WITHIN-TICK ACTION.**
 *
 * An agent acts from snapshot `T`; all valid actions become part of `T+1`.
 * Snapshot `T` is frozen for the whole window, which is what makes submit-time
 * validation honest.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * How that is made structural rather than promised:
 *
 *   - {@link Engine.submit} refuses while a tick is in flight. One writer, one
 *     phase at a time, so during the window the live world *is* snapshot T and
 *     nothing can move it. That is why the submit-time verdict still holds when
 *     `VALIDATE+LOCK` re-runs it.
 *   - `acted_on_state_version` is compared against the version captured at
 *     `FREEZE_QUEUE`, never against the running counter. Comparing against the
 *     running counter would make every action after the first in a tick fail, and
 *     "fix" it by making the check meaningless.
 *   - Order is `(priority, principal_id, client_sequence)` and the comparator is
 *     handed a type with no arrival field (`queue.ts`).
 *   - `seed(T)` is revealed in `FREEZE_QUEUE` and not before (`seed.ts`), and each
 *     phase draws from `Rng.derive(phase)` so adding a draw in one phase cannot
 *     shift another's.
 *   - `state_hash` exists at tick boundaries only (§15.1). There is exactly one
 *     per {@link TickReport} and none on anything smaller.
 *   - On assertion failure the pre-tick snapshot is restored, nothing is
 *     published, and the world enters `PAUSED` (`halt.ts`).
 *
 * The pipeline itself is data (`phases.ts`) and runs all fourteen phases every
 * tick whether or not anything is registered for them. Three are still no-op
 * hooks; they hold their slot because the order is the rules surface and inserting
 * a phase later would shift every seeded draw and every golden file.
 */

import { readInt, readString } from '../core/params.js';
import type { Rng } from '../core/rng.js';
import {
  inCommitmentWindow,
  inFreeze,
  isSettlementTick,
  reckoningIndex,
  ticksUntilReckoning,
} from '../core/time.js';
import type {
  DecisionSource,
  HandId,
  InvariantViolation,
  PrincipalId,
  SystemId,
  WorldStatus,
} from '../core/types.js';
import { compareIds } from '../ledger/index.js';
import type { NewEvent } from '../events/index.js';
import { checkInvariants, type InvariantInputs, type InvariantReport } from '../invariants/aggregate.js';
import { CASCADE_ROUND_LIMIT } from '../invariants/transaction.js';
import {
  HaltController,
  tripleHash,
  type HaltRecord,
  type RerunResult,
  type ResumeOrder,
  type ResumeOutcome,
  type TickInputs,
} from '../invariants/halt.js';
import { halting } from '../invariants/registry.js';
import {
  commonsFloorRejection,
  moveHand,
  NO_ROLE_FILLS,
  reject,
  resolveMovement,
  type ActionParams,
  type Arrival,
  type RecoveryEnd,
  type Rejection,
  type RoleFills,
  type WorldResult,
  type WorldState,
} from '../world/index.js';
import { ActionBudget } from './budget.js';
import { ActionLog, auditArrivalIndependence, type ArrivalAudit } from './actionLog.js';
import { runCascade, type CascadeAttempt, type CascadeResult } from './cascade.js';
import { engineReport, engineViolation, tickInputsFor, type Rollback } from './halt.js';
import { IntentBook, intentStateTable, type IntentDraft, type IntentRecord } from './intent.js';
import { assertPhaseOrder, PHASES, UNBUILT_PHASES, type PhaseName } from './phases.js';
import { SubmissionQueue, type FrozenWindow, type QueuedAction, type SubmittedAction } from './queue.js';
import { SeedBook } from './seed.js';
import {
  canonicalParams,
  captureSnapshot,
  restoreSnapshot,
  rollbackGaps,
  worldStateTable,
  type Snapshot,
  type StateTable,
} from './snapshot.js';
import { WakeBook, type WakeCause } from './wake.js';

export class EngineError extends Error {}

/**
 * The step budget. DET-9's second clause: "the tick's step count is bounded
 * regardless of input."
 *
 * Bounded by input *size*, never by input *content* — that is the whole claim. A
 * ring of circular obligations, an agent submitting its cap, a hand in every
 * system: all of them scale the budget linearly and none of them can make the tick
 * run for an unbounded time. Exceeding it aborts the tick exactly as an invariant
 * failure does, because an unbounded tick is a world that has stopped without
 * saying so.
 */
export const STEP_BUDGET = {
  base: 512,
  perAction: 64,
  perHand: 8,
  perIntent: 32,
  /**
   * The settlement set was missing from this budget entirely, and its absence was a
   * self-inflicted halt on the one tick that has an audience (A14).
   *
   * Measured by the wave-2 verifier: 600 obligations that ALL settle cleanly
   * (`done: true, breached: false`) in a two-principal world halted the world, with
   * a violation message blaming a convergence loop that never happened. OBLIGE had
   * done exactly the bounded thing it was designed to do — it charges one step per
   * resolver attempt, bounded by `CASCADE_ROUND_LIMIT × items` — while the cap only
   * counted actions, hands and intents. The settlement set scales with VENTURES,
   * not hands, so the two never moved together.
   *
   * It must be at least `CASCADE_ROUND_LIMIT`, or a Reckoning whose obligations all
   * legitimately need every round halts. The headroom above that is for the
   * per-item bookkeeping around each attempt.
   */
  perObligation: CASCADE_ROUND_LIMIT + 3,
  /**
   * **The resting order book, and this is the same defect as `perObligation`, one
   * phase over.**
   *
   * `MARKETS` walks every open order on every crossing book once per tick. Like the
   * settlement set, that quantity scales with nothing else in this budget: it is set
   * by agents collectively over many ticks, and the tick it is *spent* on may carry
   * no actions at all. Measured before this term existed: 480 resting one-unit asks
   * and one buyer crossing all of them charged 1024 steps against a cap of 1016, and
   * DET-9 aborted the tick and paused the world. Entirely legitimate play, so the
   * halt was agent-reachable — AGT-X9, which is worse than a crash because it is a
   * weapon.
   *
   * Three per order: the matcher's own advance, the fill, and the closure. The
   * market's caps (`MAX_OPEN_ORDERS`) bound this absolutely, so the budget stays
   * finite; what it must not do is bound it *below* the work a full book legitimately
   * needs.
   */
  perRestingOrder: 4,
  /**
   * **The stored lot, and this is `perRestingOrder`'s defect a third time — the first
   * one to take production down.**
   *
   * `HAZARD` reads every principal's holdings to decide what a front strikes, so its
   * cost scales with the number of stored lots. That quantity, like the settlement set
   * and the order book, is set by agents over many ticks and has no other term here.
   *
   * **What made this one different is that the phase was EMPTY.** `HAZARD` was an
   * explicit no-op hook from commit #1 — the slot was left registered so that filling
   * it would not shift any other phase's seeded sub-stream — so for the project's
   * entire life the term was missing and could not be missed. Phase 3 gave it a
   * subject and the very first deploy replayed into `DET-9` at tick 7,128 and HELD the
   * world: every route 503 with the boot diagnosis. A budget whose subject cannot
   * occur is untestable in exactly the way an invariant whose subject cannot occur is.
   *
   * Two per lot: the read and the mark lookup. `frontNow` is O(lots) after the
   * quadratic in `riskHoldings` was removed — that rescanned the whole account per lot
   * to total the group it had just keyed, which is what actually blew the cap. Both
   * halves are needed: the fix makes the work linear, this makes the budget know the
   * work exists.
   *
   * ⚑ **AND "O(lots)" WAS STILL FALSE WHEN THIS CLAIM WAS WRITTEN, ONE FUNCTION OVER.**
   * `risk/run.ts:strikeFront` looked its destroyed lots' owners up with
   * `port.lots().find(…)` **per destroyed lot**, and `port.lots()` is
   * `ledger.allLots()`, which sorts the galaxy: **37 calls over 15,828 rows on a
   * landfall tick** against 6 over 2,483 on a quiet one. Unbudgeted, so it surfaced as
   * latency rather than a halt — but it is the same shape as the quadratic above, in
   * the same phase, found by reading rather than by an outage. It indexes once now, so
   * the sentence is true. **A performance claim in a docblock is a claim like any
   * other: it needs a second road, and here the second road is the budget itself.**
   */
  perStoredLot: 2,
} as const;

export function stepBudgetFor(
  actions: number,
  hands: number,
  intents: number,
  obligations: number,
  restingOrders = 0,
  storedLots = 0,
): number {
  if (STEP_BUDGET.perObligation < CASCADE_ROUND_LIMIT) {
    // A budget below the round limit makes a legitimate cascade unbudgetable, which
    // is the defect this term exists to fix. Assert rather than trust the constant.
    throw new Error(
      `STEP_BUDGET.perObligation (${String(STEP_BUDGET.perObligation)}) must be >= ` +
        `CASCADE_ROUND_LIMIT (${String(CASCADE_ROUND_LIMIT)})`,
    );
  }
  return (
    STEP_BUDGET.base +
    STEP_BUDGET.perAction * actions +
    STEP_BUDGET.perHand * hands +
    STEP_BUDGET.perIntent * intents +
    STEP_BUDGET.perObligation * obligations +
    STEP_BUDGET.perRestingOrder * restingOrders +
    STEP_BUDGET.perStoredLot * storedLots
  );
}

/** Published cap on events buffered inside one tick (INV-26, scar #3). */
export const MAX_BUFFERED_EVENTS = 8192;

/** An action to execute, however it originated. */
export interface ActionRequest {
  readonly principal: PrincipalId;
  readonly verb: string;
  readonly params: ActionParams;
  readonly decisionSource: DecisionSource;
  /** The standing intent this came from, or null for a live action. */
  readonly intentId: string | null;
}

/** What a phase and a verb handler are given. */
export interface PhaseContext {
  readonly phase: PhaseName;
  readonly tick: number;
  readonly world: WorldState;
  /** This phase's own sub-stream. Never the tick's root. */
  readonly rng: Rng;
  /** The frozen, ordered window. Read-only, and identical for every phase. */
  readonly actions: readonly QueuedAction[];
  readonly intents: IntentBook;
  /** The version every action in this window was validated against. */
  readonly frozenStateVersion: number;
  /**
   * Where this tick sits in the Reckoning cycle.
   *
   * Supplied here rather than recomputed per module because `core/time.ts` is the
   * one home of the clock, and a module that derived "is this the freeze?" itself
   * would be a second answer to a question INV-18 halts the tick over.
   *
   * The tick loop deliberately does **not** enforce the freeze: §5.1's rule is "no
   * event touches any object *in the settlement set*", and the settlement set
   * belongs to the venture and Levy modules. This is the hook they enforce it from.
   */
  readonly clock: ReckoningClock;
  /** Buffered until COMMIT. Nothing reaches the append-only ledger before then. */
  emit(event: NewEvent): void;
  /** Charge work against the tick's step budget. Overrun aborts the tick. */
  step(n?: number): void;
  /** Create a durable intent (A3). The caller has already paid for the action. */
  createIntent(draft: IntentDraft): WorldResult<IntentRecord>;
  /** Offer a wake. §5.1: exactly one per party per resolving item. */
  offerWake(principal: PrincipalId, cause: WakeCause, item: string | null): void;
}

/** Where a tick sits in the Reckoning cycle (SPEC §5.1). Derived, never stored. */
export interface ReckoningClock {
  readonly reckoning: number;
  readonly ticksUntilReckoning: number;
  /** Last ~24 ticks: commitments here are PARTIES-visible only (A4). */
  readonly inCommitmentWindow: boolean;
  /** The last tick before settlement. Hard: nothing touches the settlement set. */
  readonly inFreeze: boolean;
  /** Settlement is due at the close of this tick. */
  readonly isSettlementTick: boolean;
}

/**
 * Is the commitment window about to open?
 *
 * The predicate the Reckoning wake is offered on. Derived from `core/time.ts` on
 * both sides rather than from an arithmetic comparison against
 * `COMMITMENT_WINDOW_TICKS`, so the two can never disagree about where the window
 * starts.
 */
export function opensCommitmentWindowNext(tick: number): boolean {
  return inCommitmentWindow(tick + 1) && !inCommitmentWindow(tick);
}

export function reckoningClock(tick: number): ReckoningClock {
  return {
    reckoning: reckoningIndex(tick),
    ticksUntilReckoning: ticksUntilReckoning(tick),
    inCommitmentWindow: inCommitmentWindow(tick),
    inFreeze: inFreeze(tick),
    isSettlementTick: isSettlementTick(tick),
  };
}

export type PhaseHandler = (ctx: PhaseContext) => void;
export type VerbHandler = (ctx: PhaseContext, request: ActionRequest) => WorldResult<null>;

/** What OBLIGE cascades over. Supplied by the venture and Levy modules. */
export interface ObligationSource {
  /**
   * Obligations due this tick, in **canonical order** — settlement order is
   * `venture_id` (§15.3, PROP-V7). The cascade does not sort for you.
   */
  due(ctx: PhaseContext): readonly string[];
  attempt(ctx: PhaseContext, id: string, round: number): CascadeAttempt;
}

/** Where events go at COMMIT. Kinds are named by the caller, never by the tick. */
export type EventSink = (events: readonly NewEvent[], tick: number) => void;

export interface EngineOptions {
  readonly world: WorldState;
  /** The run's committed seed. Every failure reproduces from this alone. */
  readonly seed: string;
  /** The tick already completed when the engine starts. Defaults to -1. */
  readonly startTick?: number;
  readonly handlers?: Partial<Record<PhaseName, PhaseHandler>>;
  /** Verb table. Overrides the built-ins, so nothing here is a monopoly. */
  readonly verbs?: Readonly<Record<string, VerbHandler>>;
  /**
   * Extra state tables. `world` is registered automatically; a module with its own
   * state registers it here so it joins `state_hash` *and* the rollback.
   */
  readonly tables?: readonly StateTable[];
  /** Extra invariant checkers run in ASSERT. Return violations, never throw. */
  readonly assertions?: readonly ((tick: number) => readonly InvariantViolation[])[];
  /**
   * Inputs for the ASSERT phase. `presence` and `roleFills` are filled in from this
   * engine's own world; everything else a module owns it must supply here, or its
   * invariants are skipped and `report.skipped` says so.
   */
  readonly invariantInputs?: (tick: number) => InvariantInputs;
  /**
   * Turn every skipped invariant into a HALT.
   *
   * The invariants module's own note says "the tick loop passes `requireAll: true`,
   * which turns every skip into a HALT" — and it should, *once every module that
   * owns an input exists*. Defaulting it on now would halt the first tick of every
   * fixture, so it is an explicit switch. Off here is a stated gap, not an oversight.
   *
   * One caveat worth knowing before turning it on: **INV-16 can never be satisfied
   * in-process.** Its database half (REVOKE UPDATE/DELETE, AX-A5-1) needs a live
   * Postgres, so `requireAll` halts on it even in a fully populated world. A run that
   * wants `requireAll` therefore needs the database attached, which means it belongs
   * to the deployed sim rather than to CI's `instant` suite.
   */
  readonly requireAllInvariants?: boolean;
  /**
   * `venture_role.filled_by_hand_id`, the single home of commitment (§6.2). Injected
   * because the tick loop must not become a second one — scar #5.
   */
  readonly roleFills?: () => RoleFills;
  readonly obligations?: ObligationSource;
  /**
   * How many orders are resting on the market books right now.
   *
   * Injected for the same reason `roleFills` is: the tick loop must not learn what an
   * order is. It sizes the step budget only — see `STEP_BUDGET.perRestingOrder` for
   * the measured halt this closes. Absent means zero, which is correct for any
   * fixture with no market.
   */
  readonly restingOrders?: () => number;
  /**
   * How many stored lots exist, for {@link STEP_BUDGET.perStoredLot}.
   *
   * Injected exactly as `restingOrders` is, and for the same reason: the engine must not
   * reach into the ledger. **Defaulting this to `() => 0` is what took production down for
   * an hour** — the term was added to `stepBudgetFor` and the caller was not, so the budget
   * stayed at 1,760 and `DET-9` halted the replay at tick 7,128 a second time, with the fix
   * present in the deployed build. A budget term with no caller is this project's signature
   * defect wearing the mechanism meant to prevent it.
   */
  readonly storedLots?: () => number;
  /**
   * Report whether an act is inside its module's own free allowance. Only `seal` uses
   * it today ("one free per role held", §17 and agent.md). Omit it and every act is
   * metered normally, which fails closed.
   */
  readonly allowance?: (request: ActionRequest) => boolean;
  readonly events?: EventSink;
  /**
   * The PAUSED state machine. Owned by `src/invariants/halt.ts`, never mirrored
   * here: two homes for "is the world up" would be the worst possible instance of
   * scar #5. One is constructed with no operator keys when the caller omits it, so
   * a fixture can halt but cannot resume — which is the safe default.
   */
  readonly controller?: HaltController;
  readonly actionsPerTick?: number;
}

export interface PhaseTrace {
  readonly phase: PhaseName;
  /** True for a phase with no module behind it yet. */
  readonly unbuilt: boolean;
  readonly steps: number;
}

/**
 * One tick's public account of itself.
 *
 * **Exactly one `stateHash`, and it is on the tick.** §15.1: per-event state
 * hashing was dropped deliberately, so there is no hash on {@link PhaseTrace} and
 * none on an event.
 */
export interface TickReport {
  readonly tick: number;
  readonly clock: ReckoningClock;
  readonly status: WorldStatus;
  readonly halted: boolean;
  /** Published before actions for this tick were accepted (DET-6). */
  readonly seedCommitment: string;
  /** Revealed in FREEZE_QUEUE, after the window closed. */
  readonly seedRevealed: string;
  /** The tick-boundary hash. Absent (empty) when the tick aborted. */
  readonly stateHash: string;
  readonly stateVersion: number;
  readonly phases: readonly PhaseTrace[];
  readonly steps: number;
  readonly stepBudget: number;
  readonly applied: number;
  readonly refused: number;
  readonly intentRuns: number;
  /** Material actions charged, per principal, in canonical order. */
  readonly charged: readonly (readonly [PrincipalId, number])[];
  readonly arrivals: readonly Arrival[];
  readonly recoveries: readonly RecoveryEnd[];
  readonly cascade: CascadeResult | null;
  readonly wakesOffered: number;
  readonly eventsCommitted: number;
  readonly violations: readonly InvariantViolation[];
  /** Invariants that did not run because their inputs were absent. Read this. */
  readonly skipped: readonly string[];
  /** Set when the tick aborted: was the in-memory world put back, or is it garbage? */
  readonly rollback: Rollback | null;
  readonly rollbackGaps: readonly string[];
  /** Evidence for A4: resolution order is the order key's, not arrival's. */
  readonly arrivalAudit: ArrivalAudit;
}

class StepBudgetError extends Error {}

export class Engine {
  readonly world: WorldState;
  readonly queue: SubmissionQueue;
  readonly seeds: SeedBook;
  readonly intents = new IntentBook();
  readonly budget: ActionBudget;
  readonly log = new ActionLog();
  readonly wakes = new WakeBook();
  /** The PAUSED state machine. The single home of the world's status. */
  readonly controller: HaltController;

  private readonly tables: StateTable[];
  private readonly handlers: Partial<Record<PhaseName, PhaseHandler>>;
  private readonly verbs: Record<string, VerbHandler>;
  private readonly assertions: readonly ((tick: number) => readonly InvariantViolation[])[];
  /** Sizes the step budget for the MARKETS phase. See `STEP_BUDGET.perRestingOrder`. */
  private readonly restingOrders: () => number;
  private readonly storedLots: () => number;
  private readonly invariantInputs: (tick: number) => InvariantInputs;
  private readonly requireAllInvariants: boolean;
  private readonly roleFills: () => RoleFills;
  private readonly obligations: ObligationSource | null;
  /**
   * Whether an act falls inside a module-owned free allowance (§17). Supplied by the
   * caller because only the owning module holds the count; see `budget.ts` on why
   * duplicating it here would be scar #5.
   */
  private readonly allowance: ((request: ActionRequest) => boolean) | null;
  /**
   * The obligation set for the tick being resolved, read ONCE at budget time.
   *
   * Deliberately cached rather than re-read in OBLIGE. Sizing the budget from one
   * call to `due()` and then processing a different call's result would let the
   * budget disagree with the work — which is the same class of bug as the missing
   * term itself, and harder to see.
   */
  private dueThisTick: readonly string[] = [];
  private readonly events: EventSink | null;

  private completedTick: number;
  private version = 0;
  private lastHash = '';
  private lastSnapshot: Snapshot;
  private inPhase: PhaseName | null = null;
  private lastRollback: Rollback | null = null;

  /** Retained so a halted tick can be re-run from the immutable input triple. */
  private pendingHalt:
    | { readonly window: FrozenWindow; readonly record: HaltRecord; readonly before: Snapshot }
    | null = null;

  /** Per-tick scratch. Reset at the top of every tick. */
  private buffer: NewEvent[] = [];
  private steps = 0;
  private stepCap = 0;
  private frozenVersion = 0;
  private appliedCount = 0;
  private refusedCount = 0;
  private intentRunCount = 0;
  private wakeCount = 0;
  private currentWindow: readonly QueuedAction[] = [];

  constructor(options: EngineOptions) {
    // A pipeline in the wrong order must fail at construction, before it has
    // published a tick an observer might have believed.
    assertPhaseOrder();

    this.world = options.world;
    this.completedTick = options.startTick ?? -1;
    this.seeds = new SeedBook(options.seed);
    this.queue = new SubmissionQueue(this.completedTick + 1);
    this.budget = new ActionBudget(options.actionsPerTick);
    this.restingOrders = options.restingOrders ?? ((): number => 0);
    this.storedLots = options.storedLots ?? ((): number => 0);
    this.handlers = options.handlers ?? {};
    this.verbs = { ...BUILT_IN_VERBS, ...(options.verbs ?? {}) };
    this.assertions = options.assertions ?? [];
    this.invariantInputs = options.invariantInputs ?? ((): InvariantInputs => ({}));
    this.requireAllInvariants = options.requireAllInvariants ?? false;
    this.roleFills = options.roleFills ?? ((): RoleFills => NO_ROLE_FILLS);
    this.obligations = options.obligations ?? null;
    this.allowance = options.allowance ?? null;
    this.events = options.events ?? null;
    // ── what is in `state_hash`, and what cannot be ────────────────────────
    //
    // Every mutable thing a tick changes **before DERIVE** must be here, or two
    // worlds that behave differently would be called identical. `world` and
    // `intent` qualify: both are written in VALIDATE+LOCK and MOVE.
    //
    // Two things are deliberately absent, and for two different reasons:
    //
    //   - **The action budget** is scratch. It is cleared at the top of every tick
    //     and never read across one, so it carries nothing between ticks.
    //   - **The wake book cannot be hashed at all.** DERIVE computes the hash and
    //     ASSERT checks what DERIVE hashed, so nothing written after DERIVE can be
    //     in it — and `WAKE` is the last phase. Putting the wake book in the
    //     snapshot would produce a snapshot that claimed to be complete while
    //     missing the last phase's writes, which is worse than leaving it out. It is
    //     a journal table in §15.1's sense (`wake_offer`, named there beside
    //     `event`), restored from the journal rather than from a snapshot;
    //     `wakeStateTable` is exported for the persistence layer that does that.
    //
    // `assertNothingAfterDeriveMutatesTheHash` in the tests pins this: the tables'
    // hash at the *end* of a tick must equal the hash DERIVE published.
    this.tables = [
      worldStateTable(this.world),
      intentStateTable(this.intents),
      ...(options.tables ?? []),
    ];

    // The window for the first tick can only open once its commitment is public.
    this.seeds.publish(this.completedTick + 1);
    this.queue.openFor(this.completedTick + 1);
    this.lastSnapshot = captureSnapshot(this.tables, this.completedTick, this.version);
    this.lastHash = this.lastSnapshot.stateHash;
    this.controller =
      options.controller ??
      new HaltController({
        startTick: this.completedTick,
        startStateHash: this.lastHash,
        // No operator keys by default: a fixture may halt and must not be able to
        // resume, because an unsigned resume is an operator restarting a broken
        // world and hoping (`src/invariants/halt.ts`).
        resumeKeys: new Map(),
      });
  }

  // ── State ─────────────────────────────────────────────────────────────────

  /** The last tick that was published. Actions accepted now resolve in `tick + 1`. */
  get tick(): number {
    return this.completedTick;
  }

  /** Read from the controller. There is no second status field here on purpose. */
  get status(): WorldStatus {
    return this.controller.status;
  }

  get stateVersion(): number {
    return this.version;
  }

  /** The last published tick-boundary hash. */
  get stateHash(): string {
    return this.lastHash;
  }

  /** `snapshot_T` for the last published tick — term 1 of the replay triple. */
  snapshot(): Snapshot {
    return this.lastSnapshot;
  }

  /**
   * Put this engine at a snapshot, and verify that it really is there.
   *
   * **The only sanctioned way to restore.** Calling `restoreSnapshot` on
   * `stateTables` directly puts the tables back but leaves the engine's own tick,
   * version and published hash where they were, so the engine then reports a state it
   * is not in — which is worse than not restoring at all, because everything
   * downstream compares against the wrong number while looking correct. That is
   * exactly the bug the intent-in-flight replay test found.
   *
   * The re-capture at the end is the load-bearing line: it asserts that the restore
   * reproduced the captured *bytes*, not merely that it ran.
   */
  adoptSnapshot(snapshot: Snapshot): void {
    if (this.inPhase !== null) {
      throw new EngineError(`cannot adopt a snapshot mid-tick (phase ${this.inPhase})`);
    }
    restoreSnapshot(this.tables, snapshot);
    this.completedTick = snapshot.tick;
    this.version = snapshot.stateVersion;
    this.lastSnapshot = snapshot;
    this.lastHash = snapshot.stateHash;

    const recaptured = captureSnapshot(this.tables, snapshot.tick, snapshot.stateVersion);
    if (recaptured.stateHash !== snapshot.stateHash) {
      throw new EngineError(
        `restore did not reproduce the snapshot: got ${recaptured.stateHash}, expected ${snapshot.stateHash}. ` +
          `A table's capture and restore disagree, so replay would silently compare two different worlds.`,
      );
    }
    // The window and the seed follow the tick, commitment first (DET-6).
    this.seeds.publish(snapshot.tick + 1);
    this.queue.openFor(snapshot.tick + 1);
  }

  /** Tables that cannot be rolled back. Empty is the healthy case. */
  get rollbackGaps(): readonly string[] {
    return rollbackGaps(this.tables);
  }

  /**
   * Every state table, including the three the engine registers itself.
   *
   * Exposed so a replay can restore into exactly the set that produced the
   * snapshot: a table present in one and absent from the other is the difference
   * between a replay and a world that merely looks replayed.
   */
  get stateTables(): readonly StateTable[] {
    return this.tables;
  }

  /** The commitment for the tick actions are currently being accepted for. */
  get openSeedCommitment(): string {
    return this.seeds.commitment(this.queue.targetTick);
  }

  // ── Submission ────────────────────────────────────────────────────────────

  /**
   * Offer an action for the next tick.
   *
   * The verdict returned here is the *submit-time* verdict, and it is honest
   * because snapshot T does not move during the window — the world is single-writer
   * and this method refuses while a tick is in flight. `VALIDATE+LOCK` re-runs the
   * same validator against the same state, so a cross-actor accept cannot turn into
   * a reject. An actor's *own* later actions may still be refused: two moves of one
   * hand in one window are competing commitments, and §12.3 resolves those by
   * `client_sequence`.
   */
  submit(action: SubmittedAction): WorldResult<QueuedAction> {
    if (this.inPhase !== null) {
      // The central rule, enforced rather than documented. An action accepted mid
      // tick would be reacting to a within-tick decision.
      return reject(
        'A3',
        `tick ${String(this.completedTick + 1)} is resolving (phase ${this.inPhase}). Actions submitted now would ` +
          `react to decisions inside it, which the engine does not allow. Retry when the tick closes.`,
      );
    }
    if (this.status === 'PAUSED') {
      // §15.2: "Submissions queue (bounded, with a published cap) rather than being
      // lost." The tick's own window cannot take them — it is frozen holding the
      // failed tick's actions, which the resume must re-run byte for byte — so they
      // go to the controller's bounded queue, which exists for exactly this and is
      // drained back into the next window when the resume succeeds.
      const outcome = this.controller.submit(
        {
          principal: action.principal,
          clientSequence: action.clientSequence,
          action: canonicalParams(
            { verb: action.verb, params: action.params, priority: action.priority ?? null },
            `submission(${action.verb})`,
          ),
        },
        this.completedTick,
      );
      // `PAUSED` here is the world's status (`WorldStatus`), not a second concept
      // wearing the same word (§3).
      return reject(
        outcome.ok ? 'PAUSED' : 'INV-26',
        `${outcome.reason} The world is PAUSED at tick ${String(this.controller.haltRecord?.tick)}; ` +
          `no tick is resolving, so this is held rather than applied. Depth ${String(outcome.queueDepth)} ` +
          `of ${String(outcome.queueBound)}.`,
      );
    }
    if (!this.seeds.isPublished(this.queue.targetTick)) {
      // DET-6 from the other side: nothing may be accepted for a tick whose seed
      // commitment is not yet public, or an agent could be acting against a draw
      // nobody can prove was fixed in advance.
      return reject(
        'DET-6',
        `hash(seed(${String(this.queue.targetTick)})) has not published yet, so no action can be accepted for that tick.`,
      );
    }

    const floor = commonsFloorRejection(this.world, action.verb, action.params);
    if (floor !== null) {
      this.queue.countRefused();
      return floor;
    }
    if (this.verbs[action.verb] === undefined) {
      this.queue.countRefused();
      return unknownVerb(action.verb);
    }
    const accepted = this.queue.accept(action);
    if (!accepted.ok) return accepted;
    return { ok: true, value: accepted.queued };
  }

  // ── The tick ──────────────────────────────────────────────────────────────

  /**
   * Run one tick, all fourteen phases, in order.
   *
   * Returns the report whether the tick published or aborted; `halted` and
   * `status` say which. It does not throw on a halt, because the caller is a
   * scheduler that must be able to log the report and stop — but it *does* throw if
   * asked to run again while PAUSED, since a scheduler silently spinning on a
   * halted world is the "verify the invisible" failure.
   */
  runTick(): TickReport {
    if (this.status === 'PAUSED') {
      const record = this.controller.haltRecord;
      throw new EngineError(
        `the world is PAUSED at tick ${String(record?.tick)} (${record?.reason ?? 'no record'}); ` +
          `replay the failed tick from its immutable triple, fix the defect, and issue a signed resume`,
      );
    }
    const tick = this.completedTick + 1;
    const before = this.lastSnapshot;

    // ── FREEZE_QUEUE ────────────────────────────────────────────────────────
    // The window closes and seed(T) is revealed, in that order. Reversing them
    // would hand out an oracle for the actions still arriving.
    let window: FrozenWindow;
    try {
      this.beginPhase('FREEZE_QUEUE');
      this.seeds.freeze(tick);
      window = this.queue.freeze();
    } catch (error: unknown) {
      // A failure here is an engine defect (a non-total order, an unpublished
      // commitment), not a game outcome. Clear the phase so the world is not left
      // looking mid-tick, then let it out loudly.
      this.inPhase = null;
      throw error;
    }
    if (window.tick !== tick) {
      this.inPhase = null;
      throw new EngineError(`the window was open for tick ${window.tick} but the engine is running ${tick}`);
    }
    return this.resolve(tick, window, before);
  }

  /**
   * Re-run a halted tick under a signed resume order (§15.2, E2E-31).
   *
   * The verification, the single-use check and the "if it fails again it stays
   * paused" rule all belong to the controller; this method supplies the *re-run*,
   * which is the only part the tick loop can perform. The triple is checked before
   * anything runs: the retained window is only usable as `action_log_T` if it
   * hashes to the triple the halt record froze, and asserting that is what keeps
   * "the world every observer was promised" a claim rather than a hope.
   *
   * `report` holds the re-run's own report, because `ResumeOutcome` is deliberately
   * narrow (status, reason, published tick) and a caller usually wants both.
   *
   * **The caller re-submits `outcome.released`.** Submissions queued while paused
   * come back out of the controller here, and putting them into the next window is
   * the API layer's job rather than this method's: they arrived as signed requests
   * and re-admitting them without re-checking authority would be the tick loop
   * quietly minting actions on principals' behalf.
   */
  resume(order: ResumeOrder): { readonly outcome: ResumeOutcome; readonly report: TickReport | null } {
    let report: TickReport | null = null;
    const outcome = this.controller.resume(order, (inputs: TickInputs): RerunResult => {
      const pending = this.pendingHalt;
      if (pending === null) throw new EngineError('no failed tick is retained to re-run');
      if (pending.record.inputsHash !== tripleHash(inputs)) {
        throw new EngineError('the retained window does not match the triple being resumed');
      }
      if (this.lastSnapshot.stateHash !== pending.before.stateHash) {
        throw new EngineError(
          'the world is not at the snapshot the failed tick started from; rebuild from the durable snapshot',
        );
      }
      report = this.resolve(inputs.tick, pending.window, pending.before);
      return {
        committed: !report.halted,
        stateHash: report.stateHash,
        report: engineReport(inputs.tick, report.violations, [...PHASES]),
      };
    });
    if (outcome.ok) this.pendingHalt = null;
    return { outcome, report };
  }

  private resolve(tick: number, window: FrozenWindow, before: Snapshot): TickReport {
    this.buffer = [];
    this.steps = 0;
    this.appliedCount = 0;
    this.refusedCount = 0;
    this.intentRunCount = 0;
    this.wakeCount = 0;
    this.currentWindow = window.actions;
    this.frozenVersion = this.version;
    this.budget.openTick(tick);
    // A re-run under a signed resume resolves the *same* tick again, and every row it
    // records would otherwise be appended to the rows the failed attempt left behind.
    // `action_log_T` is replay's second term (§15.1), so a doubled log makes the
    // resumed tick unreplayable — PROP-W5 refuses the duplicate `client_sequence` and
    // `replayTick` throws on an action the original tick applied.
    this.log.clearTick(tick);
    // The obligation count is part of the budget's input SIZE, exactly like actions
    // and hands. Omitting it was not a tuning miss — it made the claim "bounded by
    // input size" false for the phase most likely to be large, and the settlement set
    // scales with ventures rather than hands so the two never moved together.
    //
    // Read the set BEFORE sizing the cap, and reuse it in OBLIGE, so the budget is
    // always for exactly the work that runs. Sizing generously enough that reading
    // `due()` itself cannot exhaust the budget it is being read to compute.
    this.dueThisTick =
      this.obligations === null ? [] : this.obligations.due(this.context('OBLIGE', tick));
    this.stepCap = stepBudgetFor(
      window.actions.length,
      this.world.hands.size,
      this.intents.liveCount(),
      this.dueThisTick.length,
      this.restingOrders(),
      this.storedLots(),
    );

    const traces: PhaseTrace[] = [{ phase: 'FREEZE_QUEUE', unbuilt: false, steps: 0 }];
    const violations: InvariantViolation[] = [];
    let skipped: readonly string[] = [];
    let arrivals: readonly Arrival[] = [];
    let recoveries: readonly RecoveryEnd[] = [];
    let cascade: CascadeResult | null = null;
    let published = '';

    try {
      for (const phase of PHASES) {
        if (phase === 'FREEZE_QUEUE') continue;
        const stepsBefore = this.steps;
        this.beginPhase(phase);

        switch (phase) {
          case 'EXPIRE':
            this.intents.expire(tick);
            // Bounded storage, and it must happen *before* DERIVE. `intent` is a
            // hashed state table, so dropping a row in COMMIT — as the first draft
            // did — mutated the table after DERIVE had already published its hash:
            // `snapshot_T` then described a book the engine no longer held, and the
            // replay of `T+1` from that snapshot diverged (DET-3). A season is 8,064
            // ticks and an intent row that is never removed is scar #3, so the prune
            // stays; it just runs inside the hash.
            this.intents.prune(tick - this.log.ticksRetained);
            this.runHandler(phase, tick);
            break;

          case 'VALIDATE+LOCK':
            this.validateAndLock(tick, window.actions);
            this.runHandler(phase, tick);
            break;

          case 'MOVE': {
            // Before every resolution phase, or every published ETA is a tick
            // optimistic. Asserted by assertPhaseOrder against the world module's
            // own MOVE_PHASE_MUST_PRECEDE list.
            const fills = this.roleFills();
            this.step(this.world.hands.size);
            const outcome = resolveMovement(this.world, tick, (id: HandId) => (fills.get(id) ?? 0) > 0);
            arrivals = outcome.arrivals;
            recoveries = outcome.recoveries;
            this.runHandler(phase, tick);
            break;
          }

          case 'OBLIGE':
            cascade = this.oblige(tick);
            this.runHandler(phase, tick);
            break;

          case 'DERIVE': {
            this.runHandler(phase, tick);
            // The tick-boundary hash, and the only one (§15.1).
            const after = captureSnapshot(this.tables, tick, this.version);
            published = after.stateHash;
            this.pendingSnapshot = after;
            break;
          }

          case 'ASSERT': {
            // One call, all 26 (`src/invariants/aggregate.ts`), exactly once per
            // tick: the record pass advances INV-14's before-and-after snapshot as a
            // side effect, so a second call in the same tick is blind to the first's
            // regressions.
            const report = this.assertAll(tick);
            violations.push(...report.violations);
            skipped = report.skipped.map((s) => s.id);
            this.runHandler(phase, tick);
            if (halting(violations).length > 0) {
              return this.abort(tick, 'ASSERT', violations, skipped, window, before, traces);
            }
            break;
          }

          case 'COMMIT': {
            if (!this.seeds.commitmentHolds(tick)) {
              // The commitment is only worth something if it is checked, so it is
              // checked here, every tick, and not only in DET-6's test.
              violations.push(
                engineViolation('DET-6', tick, `seed(${String(tick)}) does not match its published commitment`),
              );
              return this.abort(tick, 'COMMIT', violations, skipped, window, before, traces);
            }
            this.commit(tick, published);
            this.runHandler(phase, tick);
            break;
          }

          case 'WAKE':
            // §12.4's causes that this phase owns, because it owns the clock and the
            // arrivals. Everything else comes from the module that knows what
            // resolved, through `ctx.offerWake`.
            for (const arrival of [...arrivals].sort((a, b) => compareIds(a.handId, b.handId))) {
              this.offerWake(tick, arrival.principal, 'ARRIVAL', arrival.handId);
            }
            if (opensCommitmentWindowNext(tick)) {
              // §5.1: every party to a resolving item is offered one wake **before**
              // it. A Reckoning resolves something for everyone (the Levy, at
              // minimum), so the offer is to everyone.
              //
              // Offered as the commitment window is about to open, not at the
              // settlement tick: WAKE is the last phase, so a wake offered at
              // settlement is a wake for the tick *after* the thing it was about —
              // the agent would be told to come and decide about a Reckoning that
              // had already happened. Here it wakes to the whole window.
              this.step(this.world.principalOrder.length);
              const item = `r${String(reckoningIndex(tick + 1))}`;
              for (const principal of [...this.world.principalOrder].sort(compareIds)) {
                this.offerWake(tick, principal, 'RECKONING', item);
              }
            }
            this.runHandler(phase, tick);
            break;

          // Every phase is named, and there is deliberately no `default` branch:
          // the exhaustiveness check then makes *adding* a phase a compile error
          // here rather than a silently skipped slot. The order is a rules surface,
          // so the compiler is the cheapest reviewer of a change to it.
          case 'PRODUCE':
            // No module yet. It runs, it does nothing, and it holds its slot — see
            // UNBUILT_PHASES and PHASE_NOTE for which build step fills it.
            this.runHandler(phase, tick);
            break;

          case 'PREDATE':
          case 'MARKETS':
          case 'VENTURES':
          case 'HAZARD':
            // The slot is the tick loop's; the content is a module's. Each takes a
            // registered handler from the market, predation, venture or Levy module.
            this.runHandler(phase, tick);
            break;
        }

        traces.push({
          phase,
          unbuilt: UNBUILT_PHASES.includes(phase) && this.handlers[phase] === undefined,
          steps: this.steps - stepsBefore,
        });
      }
    } catch (error: unknown) {
      if (error instanceof StepBudgetError) {
        // An unbounded tick is a world that has stopped without saying so, so it
        // is treated exactly as an invariant failure (DET-9).
        violations.push(engineViolation('DET-9', tick, error.message));
        return this.abort(tick, this.inPhase ?? 'ASSERT', violations, skipped, window, before, traces);
      }
      // Anything else escaping a phase means a module threw where it should have
      // returned a violation. Abort rather than publish a tick nobody checked.
      violations.push(
        engineViolation(
          'TICK-STAGE',
          tick,
          `phase ${String(this.inPhase)} threw: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      return this.abort(tick, this.inPhase ?? 'ASSERT', violations, skipped, window, before, traces);
    } finally {
      this.inPhase = null;
      this.currentWindow = [];
    }

    return {
      tick,
      clock: reckoningClock(tick),
      status: this.status,
      halted: false,
      seedCommitment: this.seeds.commitment(tick),
      seedRevealed: this.seeds.reveal(tick),
      stateHash: published,
      stateVersion: this.version,
      phases: traces,
      steps: this.steps,
      stepBudget: this.stepCap,
      applied: this.appliedCount,
      refused: this.refusedCount,
      intentRuns: this.intentRunCount,
      charged: this.budget.thisTick(),
      arrivals,
      recoveries,
      cascade,
      wakesOffered: this.wakeCount,
      eventsCommitted: this.committedThisTick,
      violations,
      skipped,
      rollback: null,
      rollbackGaps: [],
      arrivalAudit: auditArrivalIndependence(tick, window.actions),
    };
  }

  // ── Phases ────────────────────────────────────────────────────────────────

  private pendingSnapshot: Snapshot | null = null;
  private committedThisTick = 0;

  private validateAndLock(tick: number, actions: readonly QueuedAction[]): void {
    // Live actions first, then standing intents — decided once in `intent.ts` and
    // stated for `agent.md`. A live decision always beats one left running.
    for (const [index, action] of actions.entries()) {
      this.step();
      const outcome = this.applyOne(tick, {
        principal: action.principal,
        verb: action.verb,
        params: action.params,
        decisionSource: action.decisionSource,
        intentId: null,
      }, action.actedOnStateVersion, false);
      this.log.record({
        tick,
        principal: action.principal,
        verb: action.verb,
        params: action.params,
        clientSequence: action.clientSequence,
        priority: action.priority,
        decisionSource: action.decisionSource,
        idempotencyKey: action.idempotencyKey,
        actedOnStateVersion: action.actedOnStateVersion,
        arrivalMs: action.arrivalMs,
        arrivalOrdinal: action.arrivalOrdinal,
        resolutionOrdinal: index,
        outcome: outcome.ok ? 'APPLIED' : 'REFUSED',
        rejection: outcome.ok ? null : outcome,
      });
    }

    let ordinal = actions.length;
    for (const intent of this.intents.due(tick)) {
      this.step();
      const request: ActionRequest = {
        principal: intent.principal,
        verb: intent.verb,
        params: intent.params,
        // §15.1 is explicit that a durable pre-set decision is `INTENT` and never
        // `STANDING` — §3 gives that word to the public factual vectors.
        decisionSource: 'INTENT',
        intentId: intent.id,
      };
      const outcome = this.applyOne(tick, request, null, true);
      this.intents.ran(intent, outcome.ok);
      this.intentRunCount += 1;
      this.log.record({
        tick,
        principal: intent.principal,
        verb: intent.verb,
        params: intent.params,
        clientSequence: intent.runs,
        priority: 0,
        decisionSource: 'INTENT',
        idempotencyKey: intent.id,
        actedOnStateVersion: null,
        // A standing intent did not arrive. Recording null rather than a timestamp
        // is the clearest possible statement that arrival orders nothing.
        arrivalMs: null,
        arrivalOrdinal: null,
        resolutionOrdinal: ordinal,
        outcome: outcome.ok ? 'APPLIED' : 'REFUSED',
        rejection: outcome.ok ? null : outcome,
      });
      ordinal += 1;
    }
  }

  private applyOne(
    tick: number,
    request: ActionRequest,
    actedOnStateVersion: number | null,
    routine: boolean,
  ): WorldResult<null> {
    // PROP-W3: compared against the version captured at FREEZE_QUEUE, which is the
    // version every agent in this window actually saw. Comparing against the
    // running counter would fail every action after the first.
    if (actedOnStateVersion !== null && actedOnStateVersion !== this.frozenVersion) {
      return this.refuse(
        reject(
          'PROP-W3',
          `you acted on state version ${String(actedOnStateVersion)}; the window closed at ` +
            `${String(this.frozenVersion)}. Fetch a fresh observation — the engine will not guess what you meant.`,
        ),
      );
    }
    // A8 before anything is charged, locked or written: in the Commons a hostile
    // act is *invalid*, so nothing about it may have happened.
    const floor = commonsFloorRejection(this.world, request.verb, request.params);
    if (floor !== null) return this.refuse(floor);

    // Ask the owning module whether this act is inside its own free allowance —
    // today only `seal`'s "one free per role held" (§17), whose ledger lives in the
    // seals book. The budget meters; it does not keep a second copy of that count.
    // agent.md promises the first seal is free, so this hook is the difference
    // between keeping that promise and printing it.
    const withinAllowance = this.allowance?.(request) ?? false;
    const charged = this.budget.charge(request.principal, request.verb, routine, withinAllowance);
    if (!charged.ok) return this.refuse(charged);

    const handler = this.verbs[request.verb];
    if (handler === undefined) return this.refuse(unknownVerb(request.verb));

    const ctx = this.context('VALIDATE+LOCK', tick);
    const result = handler(ctx, request);
    if (!result.ok) {
      // The action was refused on the merits after the budget was charged. That is
      // deliberate: an act that reached the rules and lost still consumed a
      // decision, and refunding it would make retry-until-legal free (scar #2).
      return this.refuse(result);
    }
    this.appliedCount += 1;
    this.version += 1;
    return { ok: true, value: null };
  }

  private refuse(rejection: Rejection): Rejection {
    this.refusedCount += 1;
    return rejection;
  }

  private oblige(tick: number): CascadeResult | null {
    if (this.obligations === null) return null;
    const ctx = this.context('OBLIGE', tick);
    // The set read at budget time (see resolve). Not re-read: a second `due()` call
    // could return a different set, and the budget would then be for work that is
    // not the work being done.
    const due = this.dueThisTick;
    const source = this.obligations;
    return runCascade(due, (id, round) => {
      this.step();
      return source.attempt(ctx, id, round);
    });
  }

  /**
   * The ASSERT phase: `checkInvariants` once, plus anything the caller registered.
   *
   * The tick loop supplies `presence` and `roleFills` itself and merges whatever the
   * caller's `invariantInputs` provides. It does **not** re-run the presence checks
   * separately — one call per tick is the invariants module's stated contract, and a
   * second pass would be blind to the first's INV-14 comparison.
   */
  private assertAll(tick: number): InvariantReport {
    const supplied = this.invariantInputs(tick);
    const inputs: InvariantInputs = {
      // Role fills come from their single home, `venture_role.filled_by_hand_id`.
      roleFills: this.roleFills(),
      ...supplied,
      presence: supplied.presence ?? this.world,
      requireAll: supplied.requireAll ?? this.requireAllInvariants,
    };
    const report = checkInvariants(inputs, tick);
    const extra: InvariantViolation[] = [];
    for (const check of this.assertions) extra.push(...check(tick));
    if (this.buffer.length > MAX_BUFFERED_EVENTS) {
      extra.push(
        engineViolation(
          'INV-26',
          tick,
          `${String(this.buffer.length)} buffered events exceeds the published cap of ${String(MAX_BUFFERED_EVENTS)}`,
        ),
      );
    }
    if (extra.length === 0) return report;
    return {
      tick: report.tick,
      violations: [...report.violations, ...extra],
      checked: report.checked,
      skipped: report.skipped,
    };
  }

  private commit(tick: number, published: string): void {
    // The publish boundary. Events reach the append-only ledger here and nowhere
    // earlier, which is what makes "never publish a broken tick" literal: an
    // aborted tick's events are discarded, never retracted (INV-16 forbids the
    // retraction, so the buffer is the only correct design).
    const events = this.buffer;
    this.buffer = [];
    this.committedThisTick = events.length;
    if (this.events !== null && events.length > 0) this.events(events, tick);

    this.completedTick = tick;
    this.lastHash = published;
    this.lastSnapshot = this.pendingSnapshot ?? captureSnapshot(this.tables, tick, this.version);
    this.pendingSnapshot = null;
    this.lastRollback = null;
    // The published pointer moves in exactly one place, and it is not here — the
    // controller owns it (§15.2). During a resume the controller publishes itself
    // once the re-run reports `committed`, so calling it again would throw.
    if (this.status === 'RUNNING') this.controller.publish(tick, published);

    // Open the next window, commitment first. The order is DET-6.
    this.seeds.publish(tick + 1);
    this.queue.openFor(tick + 1);

    // Bounded storage. A season is 8,064 ticks and none of these mirrors are the
    // durable record (scar #3). The *intent* prune is deliberately not here — it
    // touches a hashed table, so it runs in EXPIRE, before DERIVE.
    this.seeds.prune(tick);
  }

  private abort(
    tick: number,
    phase: PhaseName,
    violations: readonly InvariantViolation[],
    skipped: readonly string[],
    window: FrozenWindow,
    before: Snapshot,
    traces: PhaseTrace[],
  ): TickReport {
    // Discard the buffer first: nothing this tick produced may survive it. An
    // aborted tick's events are dropped and never retracted, because INV-16 makes
    // retraction impossible by design — which is why they were buffered at all.
    this.buffer = [];
    this.pendingSnapshot = null;

    const gaps = rollbackGaps(this.tables);
    if (gaps.length === 0) restoreSnapshot(this.tables, before);
    else restorePartially(this.tables, before);
    this.version = before.stateVersion;
    this.lastHash = before.stateHash;
    this.lastSnapshot = before;
    this.lastRollback = gaps.length === 0 ? 'FULL' : 'INCOMPLETE';
    this.inPhase = null;

    const inputs = tickInputsFor(before, this.log.forTick(tick), tick, this.seeds.reveal(tick));
    // The PAUSED state machine is the controller's, so the halt is *recorded* there
    // and nowhere else. It refuses a report with no HALT-severity violation, which
    // is the guard against an abort over a WARN.
    const record = this.controller.haltTick(engineReport(tick, violations, [phase]), inputs);
    this.pendingHalt = { window, record, before };

    return {
      tick,
      clock: reckoningClock(tick),
      status: this.status,
      halted: true,
      seedCommitment: this.seeds.commitment(tick),
      seedRevealed: inputs.seed,
      // Empty on purpose: an aborted tick has no published hash, and returning the
      // previous one here would let a caller mistake a halt for a quiet tick.
      stateHash: '',
      stateVersion: this.version,
      phases: traces,
      steps: this.steps,
      stepBudget: this.stepCap,
      applied: this.appliedCount,
      refused: this.refusedCount,
      intentRuns: this.intentRunCount,
      charged: this.budget.thisTick(),
      arrivals: [],
      recoveries: [],
      cascade: null,
      wakesOffered: this.wakeCount,
      eventsCommitted: 0,
      violations,
      skipped,
      rollback: this.lastRollback,
      rollbackGaps: gaps,
      arrivalAudit: auditArrivalIndependence(tick, window.actions),
    };
  }

  // ── Context plumbing ──────────────────────────────────────────────────────

  private beginPhase(phase: PhaseName): void {
    this.inPhase = phase;
  }

  private step(n = 1): void {
    this.steps += n;
    if (this.steps > this.stepCap) {
      throw new StepBudgetError(
        `tick exceeded its step budget of ${String(this.stepCap)} in phase ${String(this.inPhase)}. ` +
          `The budget is a function of input size only (actions, hands, intents, obligations), so ` +
          `this is either a phase looping to convergence — which SPEC §15.2 forbids — or a term ` +
          `missing from stepBudgetFor. Check the second possibility first: the obligation term was ` +
          `absent once already, and the message then blamed a convergence loop that never happened.`,
      );
    }
  }

  /**
   * Offer a wake for the tick currently resolving.
   *
   * The tick is passed explicitly and **not** derived from `completedTick + 1`: WAKE
   * runs after COMMIT, so by then `completedTick` is already this tick and the
   * derived number would be the *next* one. At a settlement tick that error also
   * rolled the wake budget into the following Reckoning before that Reckoning's own
   * offers were made, quietly handing every principal a seventeenth wake.
   */
  private offerWake(tick: number, principal: PrincipalId, cause: WakeCause, item: string | null): void {
    const outcome = this.wakes.offer(principal, tick, cause, item);
    if (outcome.granted) this.wakeCount += 1;
  }

  private context(phase: PhaseName, tick: number): PhaseContext {
    return {
      phase,
      tick,
      world: this.world,
      // Per-phase sub-stream: adding a draw in one phase cannot shift another's.
      rng: this.seeds.phaseRng(tick, phase),
      actions: this.currentWindow,
      intents: this.intents,
      frozenStateVersion: this.frozenVersion,
      clock: reckoningClock(tick),
      emit: (event: NewEvent): void => {
        if (this.buffer.length >= MAX_BUFFERED_EVENTS) {
          throw new EngineError(
            `a tick may buffer at most ${String(MAX_BUFFERED_EVENTS)} events (INV-26); phase ${phase} exceeded it`,
          );
        }
        this.buffer.push(event);
      },
      step: (n?: number): void => {
        this.step(n);
      },
      createIntent: (draft: IntentDraft): WorldResult<IntentRecord> => {
        const made = this.intents.create(draft, tick);
        return made.ok ? { ok: true, value: made.intent } : made;
      },
      offerWake: (principal: PrincipalId, cause: WakeCause, item: string | null): void => {
        this.offerWake(tick, principal, cause, item);
      },
    };
  }

  private runHandler(phase: PhaseName, tick: number): void {
    const handler = this.handlers[phase];
    if (handler === undefined) return;
    handler(this.context(phase, tick));
  }
}

/**
 * Restore what can be restored, when at least one table has no restore path.
 *
 * Not a silent best effort: the halt report carries `rollback: 'INCOMPLETE'` and
 * names the gaps, so the operator knows the process must be rebuilt from the
 * durable snapshot rather than resumed. Skipping the restorable tables too would
 * be strictly worse — a world half at T and half at T+1.
 */
function restorePartially(tables: readonly StateTable[], before: Snapshot): void {
  for (const [name, captured] of before.tables) {
    const table = tables.find((t) => t.name === name);
    if (table?.restore === undefined) continue;
    table.restore(captured);
  }
}

function unknownVerb(verb: string): Rejection {
  return reject(
    'A2',
    `'${verb}' is not a verb this world answers to. Read the verb list in your observation's affordances; ` +
      `every legal move is listed there with its cost and its worst case.`,
  );
}

// ── Built-in verbs ──────────────────────────────────────────────────────────
//
// Two, and both are here because the tick loop is already the thing that owns
// them: `move` calls the world module's own verb, and `set_delivery_intent` is the
// only §12.2 verb whose entire semantics is "make a durable intent" (A3). Both are
// overridable through `EngineOptions.verbs`, so neither is a monopoly.

// `readParam` and `readInt` were declared here — bodies byte-identical to `core/params.ts`'s
// `readString` and `readInt`, which exist precisely so that they are not. That file's own header says
// it: *"copying them would be scar #5 — one rule, two homes, free to disagree about what counts as a
// value."* This file held the copy, and `readParam` held it under a second name, so a grep for
// `readString` could not find it.
//
// Removed at `RULES_VERSION` 38. `readString` is imported above; the two call sites below now read
// the same tolerance rules as every other verb in the engine.

const BUILT_IN_VERBS: Readonly<Record<string, VerbHandler>> = {
  move: (ctx, request): WorldResult<null> => {
    const hand = readString(request.params, ['hand', 'hand_id', 'handId']);
    const to = readString(request.params, ['to', 'destination', 'system', 'system_id']);
    if (hand === null || to === null) {
      return reject(
        'A2',
        `move needs a hand and a destination: {"hand": "<hand_id>", "to": "<system_id>"}. One move is one gate, ` +
          `so the destination must be adjacent to where the hand is now.`,
      );
    }
    if (ctx.world.hands.get(hand as HandId) === undefined) {
      return reject('A2', `there is no hand ${hand}; your own hands are listed in your observation.`);
    }
    const moved = moveHand(ctx.world, hand as HandId, to as SystemId, ctx.tick);
    return moved.ok ? { ok: true, value: null } : moved;
  },

  set_delivery_intent: (ctx, request): WorldResult<null> => {
    // ── TWO SPELLINGS, BECAUSE THE NESTED ONE IS UNREACHABLE FOR SOME CLIENTS ──
    //
    // This verb used to accept ONLY `{"intent": {"verb": ..., "params": {...}}}`, and that shape is
    // impossible for the house cast to send: `cast/parse.ts` rejects any non-array object in params
    // as `nested-object`, and a rejected param DISCARDS THE WHOLE PLAN — so one nested key costs a
    // member its entire wake, not one action. Production logged it verbatim:
    //
    //     cast: thessaly reply discarded (param-intent-nested-object)
    //
    // A real cast member tried to set a standing intent and lost its wake for it. A3 says durable
    // intents are what make an offline agent viable and R19 says the Levy is payable by one, so the
    // players who most need this — the absent ones — were the ones who could not express it.
    //
    // So a FLAT spelling is accepted too: `{"intent_verb": "deliver", "obligation": "LEVY",
    // "amount": N, "until_tick": N}` — the repeated act's own params sit alongside, minus the three
    // control keys. The nested form still works; nothing that already sent it changes.
    const CONTROL_KEYS: readonly string[] = ['intent', 'intent_verb', 'intentVerb', 'repeat', 'until_tick', 'untilTick', 'max_runs', 'maxRuns'];
    const inner = request.params['intent'];
    const nested = typeof inner === 'object' && inner !== null && !Array.isArray(inner);
    const flatVerb = request.params['intent_verb'] ?? request.params['intentVerb'] ?? request.params['repeat'];
    if (!nested && (typeof flatVerb !== 'string' || flatVerb.length === 0)) {
      return reject(
        'A3',
        `set_delivery_intent needs the act to repeat, in either spelling: nested — ` +
          `{"intent": {"verb": "...", "params": {...}}, "until_tick": N} — or flat, which is what ` +
          `to send if your client cannot nest an object: ` +
          `{"intent_verb": "deliver", "obligation": "LEVY", "amount": N, "until_tick": N}. ` +
          `Creating it costs one action; every tick it runs after that costs none.`,
      );
    }
    const spec = nested
      ? (inner as Record<string, unknown>)
      : {
          verb: flatVerb,
          // Built in SORTED key order rather than iteration order: this object reaches the hashed
          // action log, and a hash that depends on the order a client happened to serialise its
          // JSON is a determinism bug waiting for two clients to disagree. Explicit comparator —
          // DET-1 bans a bare `.sort()`.
          params: Object.fromEntries(
            Object.keys(request.params)
              .filter((k) => !CONTROL_KEYS.includes(k))
              .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
              .map((k) => [k, request.params[k]]),
          ),
        };
    const verb = spec['verb'];
    if (typeof verb !== 'string' || verb.length === 0) {
      return reject('A3', 'the intent needs a verb to repeat.');
    }
    const params = spec['params'];
    const untilTick = readInt(request.params, ['until_tick', 'untilTick']);
    const maxRuns = readInt(request.params, ['max_runs', 'maxRuns']);
    const draft: IntentDraft = {
      principal: request.principal,
      verb,
      params:
        typeof params === 'object' && params !== null && !Array.isArray(params)
          ? (params as ActionParams)
          : {},
      ...(untilTick === null ? {} : { untilTick }),
      ...(maxRuns === null ? {} : { maxRuns }),
    };
    const made = ctx.createIntent(draft);
    return made.ok ? { ok: true, value: null } : made;
  },
};
