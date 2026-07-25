/**
 * The Reckoning as one transaction that fails closed (SPEC §15.3, DET-10).
 *
 * > The whole batch is one transaction that fails closed; **a partially-committed
 * > batch is a permanent silent imbalance in an append-only ledger, which is
 * > unrecoverable by construction.** — SPEC §15.3
 *
 * "Unrecoverable by construction" is the strongest phrase in the architecture
 * section and it sets the bar: this file's job is that no observer can ever see
 * half a Reckoning.
 *
 * ## What "commit" means here, precisely
 *
 * SPEC §15.2's tick is `… -> ASSERT -> COMMIT`, and ASSERT necessarily inspects the
 * state the tick produced. So in-memory mutation cannot be what COMMIT means, or
 * ASSERT would have nothing to look at. **Publication is commit.** The sequence is:
 *
 *   1. every stage *plans* — read state, compute, and queue its effects. A throw
 *      here applies nothing at all;
 *   2. effects apply to the in-memory world, in stage order;
 *   3. ASSERT runs over the world the effects produced;
 *   4. only if ASSERT is clean does the published pointer move.
 *
 * After a failed tick the in-memory world is **garbage and must not be used**. That
 * is not a defect, it is the design: the resume path re-runs from
 * `(snapshot_T, action_log_T, seed_T)` in a world rebuilt from the snapshot, so the
 * dirty state is discarded rather than repaired. Repairing it would be a second,
 * unreviewed settlement implementation running on the worst day of the year.
 *
 * ## Two failure classes, and why they are named differently
 *
 * - `TICK-STAGE` — a stage threw while planning. Nothing was applied; the world is
 *   still coherent; a replay is clean.
 * - `TICK-TORN` — a stage's effects threw *while applying*. Nothing is visible, but
 *   the in-memory world is now inconsistent. This outranks every invariant in the
 *   register, INV-17 included, because it is the one failure SPEC calls
 *   unrecoverable. Only a replay from the triple can produce a usable world.
 */

import type { InvariantViolation } from '../core/types.js';
import { ALL_INVARIANT_IDS, type InvariantReport } from './aggregate.js';
import { HaltController, type HaltRecord, type TickInputs } from './halt.js';
import { halting, rankViolations } from './registry.js';

/**
 * SPEC §15.3's sequence, in order.
 *
 * `ESCROWED` and `ELECTIVE` are §3's own words for A7's two halves and mean exactly
 * that here. `SEALS` is the stage that reveals seals; `RECONCILE` and `RELEASE` are
 * the last two steps of the quoted sequence.
 */
export const RECKONING_STAGES = [
  /** Freeze; the settlement set is computed and its inputs hashed. */
  'FREEZE',
  /** Assert the input hash equals what the parties acted on (INV-19). */
  'VERIFY_INPUTS',
  /** The escrowed parts, which auto-execute. */
  'ESCROWED',
  /** The elective parts, in venture_id order. The only part standing can accrue to. */
  'ELECTIVE',
  /** Cascade in <=3 fixed rounds. An obligation unresolved at the limit DEFERS. */
  'CASCADE',
  /** The split waterfall, with the deterministic remainder (INV-6). */
  'WATERFALL',
  /** Reveal seals, stamped with their own reckoning index (INV-20). */
  'SEALS',
  /** Receipts, standing, unlock (INV-21). */
  'RECEIPTS',
  'RECONCILE',
  'RELEASE',
] as const;

export type ReckoningStage = (typeof RECKONING_STAGES)[number];

/**
 * SPEC §15.3: "cascade in <=3 fixed rounds, and an obligation still unresolved at
 * the round limit **DEFERS** to the next Reckoning; it never defaults."
 *
 * Exported here rather than in the venture module because the reason for the number
 * is a halt-semantics reason: a truncated cascade recording a breach is an
 * engine-fabricated default, and a rival can construct one deliberately (E2E-13).
 */
export const CASCADE_ROUND_LIMIT = 3;

/** DET-9: the tick's step count is bounded regardless of input. */
export function assertBoundedRounds(rounds: number, limit = CASCADE_ROUND_LIMIT): void {
  if (rounds > limit) {
    throw new TransactionError(
      `the cascade ran ${rounds} rounds past its limit of ${limit}; unresolved obligations DEFER, they never default`,
    );
  }
}

export class TransactionError extends Error {}

/** What a stage may do. Read now, mutate later. */
export interface StageContext {
  readonly tick: number;
  readonly stage: ReckoningStage;
  /**
   * Queue a mutation for the apply phase.
   *
   * Everything a stage wants to change goes through here. A stage that mutates
   * directly breaks the "a throw applies nothing" guarantee for every stage after
   * it, which is why the runner offers no other door.
   */
  effect(run: () => void): void;
}

export interface Stage {
  readonly name: ReckoningStage;
  run(ctx: StageContext): void;
}

export interface ReckoningTransactionOptions {
  readonly tick: number;
  /** The immutable triple this tick is derived from. Frozen by the controller. */
  readonly inputs: TickInputs;
  readonly stages: readonly Stage[];
  /** The ASSERT phase, run over the world the effects produced. */
  readonly assert: () => InvariantReport;
  /** `state_hash` of `snapshot_T+1`, read after the effects applied. */
  readonly stateHash: () => string;
  readonly controller: HaltController;
}

export interface TransactionOutcome {
  readonly tick: number;
  /** True only when the published pointer moved. */
  readonly committed: boolean;
  /** The stage that failed, or `null`. */
  readonly failedAt: ReckoningStage | null;
  /**
   * True when effects were partly applied. The in-memory world is unusable and only
   * a replay from the input triple can produce a usable one.
   */
  readonly torn: boolean;
  readonly report: InvariantReport | null;
  readonly stateHash: string | null;
  readonly haltRecord: HaltRecord | null;
  /** Stages that planned successfully, in order. */
  readonly planned: readonly ReckoningStage[];
  /** Stages whose effects were applied, in order. */
  readonly applied: readonly ReckoningStage[];
}

/**
 * Run the Reckoning. One transaction; either the published pointer moves or nothing
 * an observer can see has changed.
 *
 * The stage list must be a prefix-free subset of {@link RECKONING_STAGES} in that
 * order — a settlement that runs `ELECTIVE` before `ESCROWED` pays a junior residual
 * claim ahead of a senior fixed one (§7.1), and the ledger would then record a
 * broken promise as honoured. The order is checked, not trusted.
 */
export function runReckoning(options: ReckoningTransactionOptions): TransactionOutcome {
  const { tick, stages, controller } = options;
  assertStageOrder(stages);

  const planned: ReckoningStage[] = [];
  const applied: ReckoningStage[] = [];
  const queued: { readonly stage: ReckoningStage; readonly run: () => void }[] = [];

  // ── 1. plan. A throw here applies nothing at all. ─────────────────────────
  for (const stage of stages) {
    const ctx: StageContext = {
      tick,
      stage: stage.name,
      effect: (run) => {
        queued.push({ stage: stage.name, run });
      },
    };
    try {
      stage.run(ctx);
    } catch (e) {
      return abort(options, planned, applied, stage.name, false, [
        stageViolation('TICK-STAGE', tick, stage.name, e),
      ]);
    }
    planned.push(stage.name);
  }

  // ── 2. apply. Nothing here is visible yet; publication is commit. ─────────
  let torn = false;
  let tornAt: ReckoningStage | null = null;
  let tornError: unknown = null;
  for (const item of queued) {
    try {
      item.run();
    } catch (e) {
      torn = true;
      tornAt = item.stage;
      tornError = e;
      break;
    }
    if (applied[applied.length - 1] !== item.stage) applied.push(item.stage);
  }
  if (torn && tornAt !== null) {
    return abort(options, planned, applied, tornAt, true, [
      stageViolation('TICK-TORN', tick, tornAt, tornError),
    ]);
  }

  // ── 3. ASSERT, over the state the effects produced. ──────────────────────
  let report: InvariantReport;
  try {
    report = options.assert();
  } catch (e) {
    return abort(options, planned, applied, 'RELEASE', true, [
      stageViolation('TICK-TORN', tick, 'RELEASE', e),
    ]);
  }
  if (halting(report.violations).length > 0) {
    const record = controller.haltTick(report, options.inputs);
    return {
      tick,
      committed: false,
      failedAt: 'RELEASE',
      torn: false,
      report,
      stateHash: null,
      haltRecord: record,
      planned,
      applied,
    };
  }

  // ── 4. COMMIT — the only visible step. ───────────────────────────────────
  const stateHash = options.stateHash();
  controller.publish(tick, stateHash);
  return {
    tick,
    committed: true,
    failedAt: null,
    torn: false,
    report,
    stateHash,
    haltRecord: null,
    planned,
    applied,
  };
}

function abort(
  options: ReckoningTransactionOptions,
  planned: readonly ReckoningStage[],
  applied: readonly ReckoningStage[],
  failedAt: ReckoningStage,
  torn: boolean,
  violations: readonly InvariantViolation[],
): TransactionOutcome {
  // Every invariant, listed as unchecked. An abort before ASSERT means the pass that
  // failed was looking at nothing at all, and an operator reading the halt record must
  // be told that rather than left to infer it from an empty violation list.
  const reason = `the tick aborted at stage ${failedAt} before ASSERT ran; nothing was checked and nothing was published`;
  const report: InvariantReport = {
    tick: options.tick,
    violations: rankViolations(violations),
    checked: [],
    skipped: ALL_INVARIANT_IDS.map((id) => ({ id, reason })),
  };
  const record = options.controller.haltTick(report, options.inputs);
  return {
    tick: options.tick,
    committed: false,
    failedAt,
    torn,
    report,
    stateHash: null,
    haltRecord: record,
    planned,
    applied,
  };
}

function stageViolation(
  id: 'TICK-STAGE' | 'TICK-TORN',
  tick: number,
  stage: ReckoningStage,
  cause: unknown,
): InvariantViolation {
  const text = cause instanceof Error ? cause.message : String(cause);
  return {
    id,
    tick,
    severity: 'HALT',
    message:
      id === 'TICK-TORN'
        ? `stage ${stage} threw while applying its effects: ${text}. The in-memory world is inconsistent; ` +
          'a partially-committed batch is unrecoverable by construction, so only a replay from ' +
          '(snapshot_T, action_log_T, seed_T) can produce a usable world'
        : `stage ${stage} threw while planning: ${text}. Nothing was applied and nothing was published`,
  };
}

/** The stages must appear in §15.3's order. Checked, because seniority depends on it. */
function assertStageOrder(stages: readonly Stage[]): void {
  let cursor = -1;
  const seen = new Set<ReckoningStage>();
  for (const stage of stages) {
    const index = RECKONING_STAGES.indexOf(stage.name);
    if (index < 0) {
      throw new TransactionError(`${stage.name} is not one of SPEC §15.3's stages`);
    }
    if (seen.has(stage.name)) {
      throw new TransactionError(`stage ${stage.name} appears twice; each stage runs once per Reckoning`);
    }
    if (index <= cursor) {
      throw new TransactionError(
        `stage ${stage.name} runs after ${String(RECKONING_STAGES[cursor])}, out of §15.3's order; ` +
          'ESCROWED before ELECTIVE is seniority, not style',
      );
    }
    seen.add(stage.name);
    cursor = index;
  }
}
