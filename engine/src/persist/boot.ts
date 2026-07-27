/**
 * Boot the world from the durable journal. §15.2's halt/resume, made real.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE BOOT SHAPE: ADOPT THE LATEST CHECKPOINT IF — AND ONLY IF — IT CARRIES
 * THE WHOLE WORLD.**
 *
 * §15.2 describes resume as "load the latest snapshot, adopt it, replay the actions
 * after it", and the machinery for that now exists and is proven: the ledger's
 * append-only log is rebuilt from the durable posting rows (`hydrate.ts`), the
 * snapshot is adopted through `Engine.adoptSnapshot`, and only the ticks after it are
 * replayed. The equivalence test in `test/durability/` asserts that adopt-plus-tail
 * reaches a `state_hash` **identical** to a full genesis replay, and that `checkInv7`
 * passes on the first tick after the adopted boot.
 *
 * It is still not what production does, and the reason is the one thing a hash cannot
 * check itself for. A snapshot carries the engine's **state tables**, and `state_hash`
 * hashes exactly those tables — so a book kept outside a table is neither carried nor
 * missed. Measured: adopting the snapshot at tick 575 of a 600-tick run reproduced the
 * hash byte for byte while the cast's `electiveHonoured` went from `4, 6, 2, 4, …` to
 * all zeros. `StandingBook` is in no table, so reputation reset — silently, and past a
 * tripwire that reported success.
 *
 * So {@link planCheckpoint} gates adoption on `CHECKPOINT_REQUIRED_TABLES` (`hydrate.ts`), and
 * boot falls back to a genesis replay, naming the missing books, until every one of
 * them is a restorable state table. The gate clears itself: nothing here changes on
 * the day they are registered.
 *
 * The genesis path is unchanged and is still what runs today:
 *
 *   1. the caller builds a fresh `Runtime` on the master seed and seats the house
 *      cast (both deterministic from the seed) — this reproduces the exact tick -1
 *      state byte-for-byte;
 *   2. this function replays every journalled tick's submitted actions in order,
 *      re-applying external enrolments at the tick they first landed, and
 *   3. at every tick that has a stored snapshot, asserts the replayed `state_hash`
 *      equals the journalled one — a **tripwire** that turns any divergence between
 *      the record and the replay into a loud refusal instead of a quiet lie.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHAT THIS FILE FIXED BEFORE, AND WHAT IS STILL OPEN.**
 *
 * *Fixed — the crash loop.* Replay under changed code hits one of two walls: an
 * action the record says APPLIED is now refused, or the arithmetic moved and the
 * tripwire fires. Both used to throw out of `serve()`'s top-level await, exit the
 * process, and be restarted identically by `Restart=always` — an infinite loop that
 * re-read the whole action log every iteration with no HTTP surface, not even a 503.
 * Refusing to serve a world you cannot reproduce is *correct*; exiting is not. So
 * {@link bootWorld} returns a {@link BootOutcome} instead of throwing, carrying a
 * {@link BootDiagnosis} that names the tick, the action or the two hashes, whether
 * `RULES_VERSION` moved, and the exact operator instruction that would let the boot
 * proceed. The caller holds the world and serves the diagnosis.
 *
 * *Fixed — O(entire history) memory.* `ticksSince(-1)` materialised every tick and
 * every action before replaying the first one. Boot pages ({@link REPLAY_PAGE_TICKS}
 * ticks at a time) and reads only `(tick, state_hash)` for the tripwire set, so the
 * resident set is flat in season length.
 *
 * *Open — O(head) wall clock, until the manifest clears.* An adopted boot replays
 * only the ticks after the last Reckoning (≤288 at any speed), which is the bounded
 * boot; a refused one still costs ~0.8–1.8 ms per tick of history. The refusal is
 * reported in {@link BootResult.checkpointRefusal} so an operator can see which books
 * are keeping the boot long, rather than being told the boot is simply slow.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { RULES_VERSION, type Runtime } from '../sim/runtime.js';
import type { SubmittedAction } from '../tick/index.js';
import {
  hydrateEventsForSnapshot,
  hydrateLedgerForSnapshot,
  planCheckpoint,
  snapshotOf,
  type CheckpointOptions,
} from './hydrate.js';
import {
  safeDetail,
  type DivergenceKind,
  type DivergenceRecord,
  type EnrollmentRecord,
  type JournalStore,
} from './store.js';

/**
 * Ticks held in memory at once during replay.
 *
 * The bound, stated so it can be checked rather than believed: boot's resident set
 * is one page of {@link TickRecord} (this many ticks and their submitted actions),
 * plus one `(tick, state_hash)` pair per journalled snapshot, plus one row per
 * external enrolment. None of the three grows with the length of the run except the
 * snapshot digests, which are ~60 bytes per Reckoning (~50 kB for a 28-day season).
 *
 * 512 rather than 4096: a page is a single round trip, and the page is the thing
 * that has to fit, not the thing that has to be fast.
 */
export const REPLAY_PAGE_TICKS = 512;

export class BootError extends Error {
  constructor(
    message: string,
    /** Present on every replay failure; the caller renders it instead of dying. */
    readonly diagnosis: BootDiagnosis,
  ) {
    super(message);
    this.name = 'BootError';
  }
}

/**
 * Why the world could not be reproduced, in the terms an operator has to decide in.
 *
 * Every field here exists because an operator staring at a dead service at 03:00
 * needs it: *which* tick, *what* disagreed, whether the rules version moved (the
 * usual explanation), and the literal instruction that says "yes, I know, proceed
 * and write it down".
 */
export interface BootDiagnosis {
  readonly kind: BootFailureKind;
  /** The tick the failure is attached to, or -1 when it precedes replay. */
  readonly tick: number;
  readonly message: string;
  /** The journalled hash at a tripwire tick. Null otherwise. */
  readonly expectedHash: string | null;
  /** What this build produced at that tick. Null otherwise. */
  readonly actualHash: string | null;
  /** `principal verb` of the action the record says applied. Null otherwise. */
  readonly action: string | null;
  readonly journalledRulesVersion: number | null;
  readonly runningRulesVersion: number;
  /** True when the journal was written under a different `RULES_VERSION`. */
  readonly rulesVersionChanged: boolean;
  /**
   * The literal thing to set to accept this divergence, or null when no operator
   * instruction can help (a seed mismatch is not a rules change; a HALT means the
   * invariants themselves fail, and continuing past that would publish a broken
   * world).
   */
  readonly operatorInstruction: string | null;
}

export type BootFailureKind =
  | 'SEED_MISMATCH'
  | 'RUNTIME_NOT_FRESH'
  | 'APPLIED_REFUSED'
  | 'STATE_HASH_MISMATCH'
  | 'REPLAY_HALTED'
  | 'TICK_MISMATCH'
  | 'ENROLLMENT_REFUSED'
  | 'CHECKPOINT_UNUSABLE';

export interface BootResult {
  /** `GENESIS` when the store was empty; `REPLAY` when it held a run to resume. */
  readonly mode: 'GENESIS' | 'REPLAY';
  /** The tick the runtime sits at after boot. -1 for a fresh genesis. */
  readonly headTick: number;
  /**
   * The checkpoint this boot adopted, or null when it replayed from genesis.
   *
   * Non-null is the bounded boot: {@link ticksReplayed} is then the tail after this
   * tick, never the whole run.
   */
  readonly adoptedAtTick: number | null;
  /**
   * Why no checkpoint was adopted, or null when one was. Reported rather than logged
   * and forgotten: "the boot is slow" is not actionable, "these five books are in no
   * state table" is.
   */
  readonly checkpointRefusal: string | null;
  /** Postings rebuilt from the durable log to make the adoption legitimate. */
  readonly postingsHydrated: number;
  /**
   * Events rebuilt from the durable log to make the adoption legitimate.
   *
   * The `event` capture is four counts, not the contents (the record is append-only
   * and a season of payloads in every snapshot would be a snapshot larger than the
   * world), so the rows come from the journal and `EventLedger.restoreTo` refuses to
   * grow. This number is what that refusal was satisfied with.
   */
  readonly eventsHydrated: number;
  readonly ticksReplayed: number;
  readonly enrollmentsApplied: number;
  /** Journalled snapshots the replay was checked against. Every one that passed. */
  readonly tripwiresChecked: number;
  /** The `RULES_VERSION` recorded at genesis, or null on an older journal. */
  readonly journalledRulesVersion: number | null;
  /** The `RULES_VERSION` of this build. */
  readonly runningRulesVersion: number;
  readonly rulesVersionChanged: boolean;
  /**
   * The discontinuity this boot accepted and wrote down, or null on a clean boot.
   * Non-null means the world served from here does NOT match the record from
   * {@link DivergenceRecord.tick} onward, and says so publicly.
   */
  readonly divergenceAccepted: DivergenceRecord | null;
}

/** The first tick that disagreed, held until the replay finishes and it can be counted. */
interface FirstDivergence {
  readonly tick: number;
  readonly kind: DivergenceKind;
  readonly detail: string;
  readonly expected: string | null;
  readonly actual: string | null;
}

/** READY: serve it. HELD: do not serve it, and say exactly why. */
export type BootOutcome =
  | { readonly status: 'READY'; readonly result: BootResult }
  | { readonly status: 'HELD'; readonly diagnosis: BootDiagnosis; readonly message: string };

export interface BootOptions {
  /** The master seed the caller built the runtime on. Must match the store's. */
  readonly seed: string;
  /**
   * Re-establish an enrolment's out-of-world identity (keyring key, seat book) as it
   * is re-applied. The *world* seat is performed here (it is what the hash depends
   * on); this hook is for the identity layer that lives outside the runtime.
   */
  readonly onEnrollment?: (enrollment: EnrollmentRecord) => void;
  /** Called after each replayed tick, for a boot progress line on a long season. */
  readonly onProgress?: (tick: number, headTick: number) => void;
  /**
   * **THE OPERATOR DOOR.** The tick at which the operator has decided to accept that
   * this build no longer reproduces the record.
   *
   * It must equal the FIRST tick that diverges, not merely precede it: an operator
   * who was told "tick 12 400" and types 12 400 is accepting the thing they were
   * shown, while a blanket "accept anything" is the silent-continue this whole module
   * exists to prevent. Divergences at later ticks are then tolerated and counted,
   * because once the state has moved every downstream tripwire mismatches too.
   *
   * Default null: refuse.
   */
  readonly acceptDivergenceFromTick?: number | null;
  /** Wall clock for the divergence annotation's audit column. Injected (DET-7). */
  readonly nowMs?: () => number;
  /** Ticks per journal page. Defaults to {@link REPLAY_PAGE_TICKS}. */
  readonly pageSize?: number;
  /**
   * Checkpoint adoption. Defaults to "adopt the latest snapshot if the manifest
   * (`CHECKPOINT_REQUIRED_TABLES` (`hydrate.ts`)) is satisfied", which today means: don't.
   *
   * `requiredTables` exists for the durability tier, which narrows it to prove the
   * ledger half of adoption in isolation. Production must not narrow it.
   */
  readonly checkpoint?: CheckpointOptions;
}

/**
 * Reconstruct `runtime` from `store`, and never throw for a reason the world's own
 * record can explain.
 *
 * This is the entry point a server should use. {@link bootFromStore} still throws —
 * scripts and tests want that — but a *process* that throws here exits, and a process
 * that exits under `Restart=always` is a crash loop that hammers the database and
 * serves nothing.
 */
export async function bootWorld(
  runtime: Runtime,
  store: JournalStore,
  opts: BootOptions,
): Promise<BootOutcome> {
  try {
    return { status: 'READY', result: await bootFromStore(runtime, store, opts) };
  } catch (error: unknown) {
    if (error instanceof BootError) {
      return { status: 'HELD', diagnosis: error.diagnosis, message: error.message };
    }
    throw error;
  }
}

/**
 * Reconstruct `runtime` from `store`. The runtime must be fresh (tick -1) with its
 * house cast already seated by the caller — boot does not know how the world is
 * wired, only how to drive it forward from the record.
 */
export async function bootFromStore(
  runtime: Runtime,
  store: JournalStore,
  opts: BootOptions,
): Promise<BootResult> {
  const persistedSeed = await store.masterSeed();
  const journalledRules = await store.journalledRulesVersion();
  const rulesChanged = journalledRules !== null && journalledRules !== RULES_VERSION;

  if (persistedSeed === null) {
    // Genesis: nothing to resume. Record the seed AND the rules version this world is
    // born under, so a later boot can say what the old ticks were computed by instead
    // of guessing, then leave the freshly-seated world exactly as the caller built it.
    await store.init(opts.seed);
    await store.recordRulesVersion(RULES_VERSION);
    return {
      mode: 'GENESIS',
      headTick: runtime.engine.tick,
      adoptedAtTick: null,
      checkpointRefusal: 'genesis: the store holds no run to resume',
      postingsHydrated: 0,
      eventsHydrated: 0,
      ticksReplayed: 0,
      enrollmentsApplied: 0,
      tripwiresChecked: 0,
      journalledRulesVersion: RULES_VERSION,
      runningRulesVersion: RULES_VERSION,
      rulesVersionChanged: false,
      divergenceAccepted: null,
    };
  }

  // A journal written before rules_version existed gets it stamped now, with the
  // running value. That is honest — it says "from here we know" — and it is
  // write-once, so it can never overwrite a genuine older value.
  if (journalledRules === null) await store.recordRulesVersion(RULES_VERSION);

  const context = {
    journalledRulesVersion: journalledRules,
    runningRulesVersion: RULES_VERSION,
    rulesVersionChanged: rulesChanged,
  };

  if (persistedSeed !== opts.seed) {
    throw new BootError(
      `the journal was written under seed '${persistedSeed}' but boot was given '${opts.seed}'. ` +
        'Replaying a persisted world under a different seed diverges every hash — refusing rather than ' +
        'silently building a different world on the old record.',
      {
        ...context,
        kind: 'SEED_MISMATCH',
        tick: -1,
        message: `journal seed '${persistedSeed}' != boot seed '${opts.seed}'`,
        expectedHash: null,
        actualHash: null,
        action: null,
        // Deliberately null. A seed mismatch is a misconfigured process, not a rules
        // change, and there is no world it would be honest to continue.
        operatorInstruction: null,
      },
    );
  }
  if (runtime.engine.tick !== -1) {
    throw new BootError(
      `boot expects a fresh runtime at tick -1 (cast seated, no tick run), got tick ${String(runtime.engine.tick)}`,
      {
        ...context,
        kind: 'RUNTIME_NOT_FRESH',
        tick: runtime.engine.tick,
        message: 'the runtime handed to boot has already run ticks',
        expectedHash: null,
        actualHash: null,
        action: null,
        operatorInstruction: null,
      },
    );
  }

  const head = await store.headTick();
  const pageSize = opts.pageSize ?? REPLAY_PAGE_TICKS;
  // Digests, not bodies: boot compares hashes and reads nothing else, and the bodies
  // are the whole world once per Reckoning.
  const snapByTick = new Map((await store.snapshotHashes()).map((s) => [s.tick, s.stateHash] as const));
  const enrollments = await store.enrollments();
  const enrollByTick = new Map<number, EnrollmentRecord[]>();
  for (const e of enrollments) {
    const bucket = enrollByTick.get(e.enrolledAtTick);
    if (bucket === undefined) enrollByTick.set(e.enrolledAtTick, [e]);
    else bucket.push(e);
  }

  const accept = opts.acceptDivergenceFromTick ?? null;
  let firstDivergence: FirstDivergence | null = null;
  let toleratedAfter = 0;
  let ticksReplayed = 0;
  let tripwiresChecked = 0;
  let enrollmentsApplied = 0;
  let cursor = -1;

  // ── The checkpoint ────────────────────────────────────────────────────────
  //
  // Before a single tick is replayed: is there a snapshot, and does it carry the
  // whole world? Only then is the tail the honest thing to replay. A refusal is not
  // an error — it is the slow, correct boot, carried out loud.
  // `rulesChanged` — the world's BIRTH version against this build — is deliberately NOT
  // passed here any more, though it is still computed and still reported in the
  // diagnosis (it is the honest first explanation when a tripwire trips).
  //
  // It cannot be the adoption gate because it is write-once: derived from
  // `journal_meta.rules_version`, it records what the world was born under, so the first
  // rules change makes it permanently true and every boot forever pays a full genesis
  // replay to re-discover a divergence an operator already adjudicated once. Production
  // was doing exactly that — 4,809 ticks and 2m12s per restart, growing without bound,
  // 4,500 ticks after the operator accepted the change at tick 287.
  //
  // `planCheckpoint` now asks the narrower and more honest question instead: did THIS
  // BUILD's arithmetic write the snapshot I am about to take as given? That refuses the
  // same first boot after a rules change — the newest snapshot still carries the old
  // stamp — and then clears itself once the world checkpoints under the new rules.
  const plan = await planCheckpoint(runtime.engine.stateTables, store, opts.checkpoint);
  let adoptedAtTick: number | null = null;
  let postingsHydrated = 0;
  let eventsHydrated = 0;
  const checkpointRefusal = plan.refusal;
  if (plan.snapshot !== null) {
    const snapshot = plan.snapshot;
    try {
      // Order is load-bearing. The append-only log must be back BEFORE the snapshot is
      // adopted: `Ledger.restoreTo` refuses to grow those halves, and the hydrate is
      // what makes the lengths already match so the refusal is satisfied rather than
      // relaxed. (And `adoptSnapshot` re-captures and compares hashes, so a restore
      // that did not reproduce the captured bytes throws there rather than serving.)
      const restored = await hydrateLedgerForSnapshot(runtime.ledger, store, snapshot);
      postingsHydrated = restored.postings;
      // And the record, for the same reason and with the same ordering rule: the
      // append-only halves must be back BEFORE the snapshot is adopted, because
      // `EventLedger.restoreTo` refuses to grow and the hydrate is what makes the
      // counts already match — the refusal satisfied rather than relaxed.
      // The boot's own page size, not the hydrate's default: `bootFromStore`'s
      // memory bound is "never ask the store for the whole log, and never for more
      // than one page", and an inner read that pages at its own larger size would
      // quietly make that claim false for the adopted path.
      const record = await hydrateEventsForSnapshot(runtime.events, store, snapshot, pageSize);
      eventsHydrated = record.events;
      runtime.engine.adoptSnapshot(snapshotOf(snapshot));
      adoptedAtTick = snapshot.tick;
      cursor = snapshot.tick;
      // `tripwiresChecked` is deliberately NOT incremented here. A tripwire's claim is
      // "this build RECOMPUTED the tick and got the journalled hash"; adoption takes
      // the recorded state as given, so counting it would inflate the one number an
      // operator reads to decide how much of the record was actually re-derived.
      // Every snapshot in the replayed tail still counts.
    } catch (error: unknown) {
      throw new BootError(
        `checkpoint adoption failed at tick ${String(snapshot.tick)}: ` +
          `${error instanceof Error ? error.message : String(error)}. The snapshot and the durable ` +
          'posting log describe different worlds, so neither adopting nor quietly replaying past it ' +
          'is honest — the record itself is inconsistent.',
        {
          ...context,
          kind: 'CHECKPOINT_UNUSABLE',
          tick: snapshot.tick,
          message: error instanceof Error ? error.message : String(error),
          expectedHash: snapshot.stateHash,
          actualHash: null,
          action: null,
          // No door. This is not "the rules changed"; it is the durable record
          // disagreeing with itself, and continuing would publish a ledger whose
          // INV-7 mirrors are already known to be wrong.
          operatorInstruction: null,
        },
      );
    }
    // Enrolments inside the adopted prefix are already in the snapshot's `world`
    // capture, so they must NOT be re-seated. Their out-of-world identity — keyring
    // key, seat book — lives outside the runtime and is not in any snapshot, so the
    // hook still has to run for every one of them or a real agent boots with no way
    // to sign a request (A10 at the substrate, one layer out).
    for (const e of enrollments) {
      if (e.enrolledAtTick > cursor) continue;
      opts.onEnrollment?.(e);
    }
  }

  /**
   * The one place a divergence is judged. Either the operator named this exact tick
   * and boot proceeds with it written down, or boot refuses — there is no third
   * branch, and in particular no "continue quietly".
   */
  const onDivergence = (
    tick: number,
    kind: DivergenceKind,
    detail: string,
    expected: string | null,
    actual: string | null,
  ): void => {
    if (firstDivergence !== null) {
      // Already through the door for this boot. Once state has moved, every later
      // tripwire mismatches; counting them is honest, re-deciding them is not.
      toleratedAfter += 1;
      return;
    }
    if (accept !== tick) {
      throw new BootError(
        `${kind === 'APPLIED_REFUSED' ? 'replay refused an action the record says was applied' : 'TRIPWIRE'} ` +
          `at tick ${String(tick)}: ${detail}. The record and this build disagree, so the world is NOT ` +
          'resumed and must not accept writes.' +
          (accept === null
            ? ''
            : ` (An operator accepted divergence from tick ${String(accept)}, but the FIRST divergence is at ` +
              `tick ${String(tick)}. The instruction must name the tick it was given.)`),
        {
          ...context,
          kind,
          tick,
          message: detail,
          expectedHash: expected,
          actualHash: actual,
          action: kind === 'APPLIED_REFUSED' ? detail : null,
          operatorInstruction: `COMPACT_ACCEPT_DIVERGENCE_AT_TICK=${String(tick)}`,
        },
      );
    }
    firstDivergence = { tick, kind, detail: safeDetail(detail), expected, actual };
  };

  for (;;) {
    const page = await store.ticksPage(cursor, pageSize);
    if (page.length === 0) break;

    for (const tr of page) {
      // External enrolments that first landed while `engine.tick == tr.tick - 1`
      // (i.e. targeting tr.tick). Applied before the tick runs, in insertion order, so
      // the world going into tr.tick matches the world the original tick saw.
      for (const enrollment of enrollByTick.get(tr.tick) ?? []) {
        applyEnrollment(runtime, enrollment, tr.tick, context);
        opts.onEnrollment?.(enrollment);
        enrollmentsApplied += 1;
      }

      for (const action of tr.actions) {
        // Defensive: the extractor already drops intent runs, but a hand-written or
        // migrated log might carry one, and re-submitting it would double it.
        if (action.arrivalOrdinal === null) continue;
        const submitted: SubmittedAction = {
          principal: action.principal,
          verb: action.verb,
          params: action.params,
          clientSequence: action.clientSequence,
          arrivalMs: action.arrivalMs ?? 0,
          decisionSource: action.decisionSource,
          priority: action.priority,
          ...(action.idempotencyKey === null ? {} : { idempotencyKey: action.idempotencyKey }),
          ...(action.actedOnStateVersion === null
            ? {}
            : { actedOnStateVersion: action.actedOnStateVersion }),
        };
        const result = runtime.engine.submit(submitted);
        if (!result.ok && action.outcome === 'APPLIED') {
          // An action the original tick APPLIED that replay cannot even accept is a
          // divergence, and a loud one: the code changed under the record.
          onDivergence(
            tr.tick,
            'APPLIED_REFUSED',
            `${action.principal} ${action.verb} -> ${result.invariant} ${result.hint}`,
            null,
            null,
          );
        }
      }

      const report = runtime.runTick();
      if (report.halted) {
        throw new BootError(
          `replay HALTED at tick ${String(tr.tick)}: ${report.violations.map((v) => v.id).join(', ')}. ` +
            'A tick the record says committed cannot be re-derived — determinism is broken or the record is corrupt.',
          {
            ...context,
            kind: 'REPLAY_HALTED',
            tick: tr.tick,
            message: report.violations.map((v) => `${v.id} ${v.message}`).join(' | '),
            expectedHash: snapByTick.get(tr.tick) ?? null,
            actualHash: null,
            action: null,
            // No door. A HALT is the invariants themselves failing; proceeding would
            // publish a world the engine has already said is broken (A5′).
            operatorInstruction: null,
          },
        );
      }
      if (report.tick !== tr.tick) {
        throw new BootError(
          `replay produced tick ${String(report.tick)} but the journal expected ${String(tr.tick)}`,
          {
            ...context,
            kind: 'TICK_MISMATCH',
            tick: tr.tick,
            message: `replay is at tick ${String(report.tick)}, the journal at ${String(tr.tick)} — a hole in the log`,
            expectedHash: null,
            actualHash: null,
            action: null,
            operatorInstruction: null,
          },
        );
      }
      ticksReplayed += 1;
      cursor = tr.tick;

      const snapHash = snapByTick.get(tr.tick);
      if (snapHash !== undefined) {
        tripwiresChecked += 1;
        if (report.stateHash !== snapHash) {
          onDivergence(
            tr.tick,
            'STATE_HASH_MISMATCH',
            `replayed state_hash ${report.stateHash} does not match the journalled snapshot ${snapHash}`,
            snapHash,
            report.stateHash,
          );
        }
      }
      opts.onProgress?.(report.tick, head);
    }

    if (page.length < pageSize) break;
  }

  // Enrolments that landed in the open window at kill time (their target tick never
  // committed) are re-applied now so no enrolled identity is lost — A10 (identity
  // never resets) outranks reproducing an uncommitted tail that is gone regardless.
  for (const [targetTick, bucket] of [...enrollByTick.entries()].sort((a, b) => a[0] - b[0])) {
    if (targetTick <= cursor) continue;
    for (const enrollment of bucket) {
      applyEnrollment(runtime, enrollment, targetTick, context);
      opts.onEnrollment?.(enrollment);
      enrollmentsApplied += 1;
    }
  }

  const divergenceAccepted =
    firstDivergence === null
      ? null
      : await annotate(store, firstDivergence, toleratedAfter, context, opts.nowMs?.() ?? 0);

  return {
    mode: 'REPLAY',
    headTick: runtime.engine.tick,
    adoptedAtTick,
    checkpointRefusal,
    postingsHydrated,
    eventsHydrated,
    ticksReplayed,
    tripwiresChecked,
    enrollmentsApplied,
    ...context,
    divergenceAccepted,
  };
}

/**
 * Write the discontinuity down, publicly and permanently, before the world serves.
 *
 * Awaited and unguarded on purpose: if the annotation cannot be written, boot fails.
 * An accepted divergence that nobody recorded is the exact silent lie A5 forbids, and
 * it would be indistinguishable afterwards from a world that never diverged at all.
 *
 * ── WHAT THE DEDUP KEY HAS TO BE, AND WHY IT IS NOT `(tick, toRulesVersion)` ──
 *
 * A second restart under the same operator instruction must annotate once, not once
 * per restart. But `(tick, toRulesVersion)` is too coarse to say that, because
 * `RULES_VERSION` is a constant that does not move when semantics change (the
 * discipline is filed, not yet kept), so the key degenerates to "dedup on tick" — and
 * two genuinely different rules changes can first diverge at the same tick. Measured:
 * refusing `p:varrow` and refusing `p:vex` both first diverge at tick 100 in a
 * six-hand cast, and the second one resumed the world while the record named only the
 * first. That is the silent lie this table exists to prevent, arriving through the
 * table itself.
 *
 * So the key includes `detail`, which identifies *what* diverged (the action and its
 * refusal, or the two hashes). For that to stay restart-idempotent `detail` has to be
 * stable across restarts, which is why the tolerated-divergence count is no longer
 * interpolated into it: the count grows as the world runs on past the accepted tick,
 * and it already has its own column (`toleratedAfter`) and its own line in the boot
 * banner. A duplicated number that made the key unstable was the only thing it bought.
 */
async function annotate(
  store: JournalStore,
  first: FirstDivergence,
  toleratedAfter: number,
  context: {
    readonly journalledRulesVersion: number | null;
    readonly runningRulesVersion: number;
  },
  nowMs: number,
): Promise<DivergenceRecord> {
  const record: DivergenceRecord = {
    tick: first.tick,
    kind: first.kind,
    fromRulesVersion: context.journalledRulesVersion,
    toRulesVersion: context.runningRulesVersion,
    detail: safeDetail(
      `rules change accepted by operator at tick ${String(first.tick)}: ${first.detail}`,
    ),
    expectedHash: first.expected,
    actualHash: first.actual,
    toleratedAfter,
    acceptedAtMs: nowMs,
  };
  const existing = await store.divergences();
  const already = existing.some(
    (d) =>
      d.tick === record.tick &&
      d.toRulesVersion === record.toRulesVersion &&
      d.detail === record.detail,
  );
  if (!already) await store.recordDivergence(record);
  return record;
}

function applyEnrollment(
  runtime: Runtime,
  enrollment: EnrollmentRecord,
  tick: number,
  context: {
    readonly journalledRulesVersion: number | null;
    readonly runningRulesVersion: number;
    readonly rulesVersionChanged: boolean;
  },
): void {
  try {
    // The world seat only. seat() targets `engine.tick + 1`, which equals `tick`
    // when this is called with the engine one tick behind — reproducing the original
    // enrolment tick, which the holding and the Levy tenure clock both read.
    runtime.seat(enrollment.principal, enrollment.handle);
  } catch (error: unknown) {
    const why = error instanceof Error ? error.message : String(error);
    throw new BootError(
      `replay could not re-seat ${enrollment.principal} for tick ${String(tick)}: ${why}`,
      {
        ...context,
        kind: 'ENROLLMENT_REFUSED',
        tick,
        message: why,
        expectedHash: null,
        actualHash: null,
        action: `seat ${enrollment.principal}`,
        // No door: an identity that cannot be re-seated is A10 broken at the
        // substrate, and continuing would serve a world missing a real player.
        operatorInstruction: null,
      },
    );
  }
}

/** A one-screen operator briefing. Rendered to the log and to the held HTTP surface. */
export function describeDiagnosis(d: BootDiagnosis): string {
  const lines = [
    `THE WORLD IS HELD. Boot could not reproduce the record under this build.`,
    ``,
    `  failure          ${d.kind}`,
    `  tick             ${String(d.tick)}`,
    `  detail           ${d.message}`,
  ];
  if (d.action !== null) lines.push(`  action           ${d.action}`);
  if (d.expectedHash !== null) lines.push(`  journalled hash  ${d.expectedHash}`);
  if (d.actualHash !== null) lines.push(`  this build       ${d.actualHash}`);
  lines.push(
    `  rules_version    journal ${d.journalledRulesVersion === null ? 'unrecorded' : String(d.journalledRulesVersion)}` +
      ` -> running ${String(d.runningRulesVersion)}${d.rulesVersionChanged ? '  <- CHANGED, the likely cause' : ''}`,
  );
  lines.push(``);
  if (d.operatorInstruction === null) {
    lines.push(
      `  No operator instruction can accept this. It is not a rules change: fix the`,
      `  configuration or the record, or restore a backup.`,
    );
  } else {
    lines.push(
      `  To accept that the rules changed here — and to have that written into the`,
      `  permanent public record as a declared discontinuity at this exact tick:`,
      ``,
      `      ${d.operatorInstruction}`,
      ``,
      `  The world will then resume, and the record will say the ticks before and`,
      `  after this one were computed by different code. It never rewrites a past row.`,
    );
  }
  return lines.join('\n');
}
