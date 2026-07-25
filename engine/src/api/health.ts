/**
 * `GET /health` — and it asserts the *interesting* property, not liveness.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **SCAR #14b.** High Water ran for hours looking perfectly healthy while its LLM
 * players had silently fallen back to heuristics. The process was alive. The ticks
 * landed. The map rendered. Nothing was deciding anything, and no monitor could
 * have told anyone, because every monitor measured liveness.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * TESTING.md's entry for it is a *specification*, not a suggestion: **"Assert the
 * expensive path is taken: `decision_source` distribution must show
 * `LIVE`/`DELEGATE`, and a run whose LLM share drops below a floor **fails**, even
 * though the process is alive and the game looks healthy."** OPS-6 repeats it.
 *
 * So this endpoint is **503 when the world is boring**, which is a deliberate and
 * slightly uncomfortable choice: an uptime checker will page somebody because
 * agents stopped thinking. That is the correct thing to be paged about. A green
 * check on a world of zombies is the failure this scar is.
 *
 * Three conditions make it unhealthy, and each names itself in `failures[]`:
 *
 *   1. **The world is PAUSED.** An invariant failed and the tick aborted (§15.2).
 *   2. **The deciding share is below the floor**, once past warm-up. `LIVE`,
 *      `INTENT` and `DELEGATE` are decisions somebody made; `HEURISTIC` and
 *      `FALLBACK` are the house holding the stage. A world that is all house is a
 *      world with no players in it.
 *   3. **Nothing decided at all**, past warm-up. Measured separately from (2)
 *      because a zero denominator makes a share meaningless, and "no decisions" is
 *      exactly the shape scar #14b took.
 */

import type { DecisionSource, WorldStatus } from '../core/types.js';
import { BPS_ONE } from '../core/units.js';
import { CENSUS_WINDOW_TICKS, type Runtime } from '../sim/runtime.js';
import type { SeatBook } from './seats.js';

/**
 * The floor, in basis points, on the share of decisions made by something that
 * actually decided. *(calibrate)*, and deliberately low: the point is to catch a
 * *collapse* to zero, not to police the cast's proportion.
 */
export const DECIDING_FLOOR_BPS = 2_500;

/**
 * Ticks before the floor is enforced.
 *
 * A world that has just started has no decisions yet and is not unhealthy for it.
 * One Reckoning's worth of ticks is long enough that a genuinely dead run cannot
 * hide inside it and short enough to catch the failure the same day.
 */
export const HEALTH_WARMUP_TICKS = 24;

/** `LIVE`, `INTENT` and `DELEGATE`: something chose. The expensive path. */
const DECIDING: readonly DecisionSource[] = Object.freeze(['LIVE', 'INTENT', 'DELEGATE']);

export interface HealthReport {
  /** Lower case, so it can never be mistaken for a canon term (§3). */
  readonly status: 'healthy' | 'unhealthy';
  readonly tick: number;
  readonly world: WorldStatus;
  readonly state_hash: string;
  readonly state_version: number;
  readonly decisions: {
    readonly window_ticks: number;
    readonly total: number;
    readonly by_source: Readonly<Record<DecisionSource, number>>;
    readonly deciding: number;
    readonly deciding_share_bps: number;
    readonly floor_bps: number;
  };
  readonly seats: {
    /** Self-enrolled principals holding a seat. What the cap bounds. */
    readonly occupied: number;
    readonly capacity: number;
    readonly rows: number;
    readonly recycled: number;
    /**
     * Every principal in the world, cast included.
     *
     * Reported beside `occupied` because the two are different numbers and the
     * difference matters: the seat cap bounds **self-enrolment**, which is the
     * attacker-controlled surface (scar #3), while the house cast is provisioned by
     * the operator at boot and counted here. An operator reading only `occupied`
     * would under-count what the box is actually serving.
     */
    readonly population: number;
  };
  readonly buffers: Readonly<Record<string, number>>;
  readonly ventures: { readonly total: number; readonly live: number };
  readonly rollback_gaps: readonly string[];
  /** The durability frontier, when a journal is attached. Null for a store-less run. */
  readonly durability: DurabilityHealth | null;
  /** Every reason it is unhealthy. Empty when healthy. Read this, not the status. */
  readonly failures: readonly string[];
}

/**
 * The journal's durability frontier, as the health endpoint reports it.
 *
 * Structural on purpose: `health.ts` is the API layer and must not depend on
 * `src/persist/**`, so `serve()` passes a probe that returns this shape (which
 * `JournalHealth` satisfies). `durableTick` lagging `headTick` is the honest signal
 * that the record is not yet durable — never a silent proceed-as-if-persisted.
 */
export interface DurabilityHealth {
  readonly healthy: boolean;
  readonly durableTick: number;
  readonly headTick: number;
  readonly backlog: number;
  readonly lastError: string | null;
}

export interface HealthOptions {
  readonly floorBps?: number;
  readonly warmupTicks?: number;
  /** A live probe of the journal's durability frontier, or absent for a store-less run. */
  readonly durability?: () => DurabilityHealth | null;
}

export function buildHealth(
  runtime: Runtime,
  seats: SeatBook,
  options: HealthOptions = {},
): HealthReport {
  const floorBps = options.floorBps ?? DECIDING_FLOOR_BPS;
  const warmup = options.warmupTicks ?? HEALTH_WARMUP_TICKS;
  /**
   * Clamped at zero, exactly as the observation is.
   *
   * `engine.tick` is -1 before the first tick publishes. Two endpoints answering "what
   * tick is it" differently — `-1` here and `0` in `observe` — is a small disagreement
   * of the kind that becomes a bug the moment anybody diffs them.
   */
  const tick = Math.max(0, runtime.engine.tick);
  const bySource = runtime.census.distribution();

  let total = 0;
  let deciding = 0;
  for (const [source, count] of Object.entries(bySource) as [DecisionSource, number][]) {
    total += count;
    if (DECIDING.includes(source)) deciding += count;
  }
  // Integer basis points throughout: a float share in a monitored number is how a
  // threshold ends up comparing 0.24999999 against 0.25 (DET-7's spirit).
  const shareBps = total === 0 ? 0 : Math.trunc((deciding * BPS_ONE) / total);

  const failures: string[] = [];
  if (runtime.engine.status === 'PAUSED') {
    failures.push(
      'the world is PAUSED: an invariant failed and the tick was aborted rather than published. ' +
        'Replay the failed tick from its triple, fix the defect, and issue a signed resume.',
    );
  }
  if (tick >= warmup && total === 0) {
    failures.push(
      `no decisions in the last ${String(CENSUS_WINDOW_TICKS)} ticks. The process is alive and nothing is ` +
        'playing, which is exactly the failure a liveness check cannot see (scar #14b).',
    );
  } else if (tick >= warmup && shareBps < floorBps) {
    failures.push(
      `only ${String(shareBps)} bps of decisions came from LIVE, INTENT or DELEGATE (floor ${String(floorBps)} bps). ` +
        `The rest are HEURISTIC or FALLBACK, which means the expensive path is not being taken — the world looks ` +
        'healthy and its players have silently fallen back (scar #14b).',
    );
  }

  // Durability is a first-class health signal: a green liveness check on a world
  // whose record is not reaching disk is the exact shape of the defect this whole
  // subsystem closes. Sustained journal failure is an operator alarm (503).
  const durability = options.durability?.() ?? null;
  if (durability !== null && !durability.healthy) {
    failures.push(
      `the journal is not durable: durable tick ${String(durability.durableTick)} lags head ` +
        `${String(durability.headTick)} with ${String(durability.backlog)} writes buffered` +
        (durability.lastError === null ? '' : ` (last error: ${durability.lastError})`) +
        '. The permanent public record is not reaching storage; an operator must look.',
    );
  }

  return {
    status: failures.length === 0 ? 'healthy' : 'unhealthy',
    tick,
    world: runtime.engine.status,
    state_hash: runtime.engine.stateHash,
    state_version: runtime.engine.stateVersion,
    decisions: {
      window_ticks: CENSUS_WINDOW_TICKS,
      total,
      by_source: bySource,
      deciding,
      deciding_share_bps: shareBps,
      floor_bps: floorBps,
    },
    seats: {
      occupied: seats.occupied,
      capacity: seats.capacity,
      rows: seats.rows,
      recycled: seats.recyclesTotal,
      population: runtime.world.principalOrder.length,
    },
    buffers: runtime.bufferSizes(),
    ventures: { total: runtime.ventures.size, live: runtime.ventures.live().length },
    /**
     * Named, not hidden. A table with no `restore` cannot be rolled back on a halt,
     * so an operator has to know before the halt rather than during it.
     */
    rollback_gaps: runtime.engine.rollbackGaps,
    durability,
    failures,
  };
}
