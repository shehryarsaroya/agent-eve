/**
 * THE SCALE HARNESS — what one world costs at 300, 1,000 and 3,000 principals.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHY THIS EXISTS.** `population-scale.ts` measured 4..20 principals and projected 300 from the
 * curve, because `HeuristicCast` capped at `MAX_CAST` (20 names) and nothing else could populate a
 * world. Season 1 expects thousands, and a projection across a 150x gap is the confident-and-unverified
 * statement that harness was written to replace. So this one does not project: it seats the
 * population it reports on.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * **The population.** `HeuristicCast` with a synthetic roster (`s0001`…) and a wake cadence — member
 * `i` decides on the ticks where `(tick + i) % wakeEvery === 0`. §12.4 gives an external agent 16 wakes
 * a Reckoning, one per 18 ticks, so `wakeEvery: 18` is what a world of self-hosted agents looks like
 * from the server: about P/18 deciders a tick, never all of them at once. Deterministic: every draw is
 * the cast's own seeded `Rng`, and a run's final `state_hash` is part of the report so two runs can be
 * compared byte for byte.
 *
 * **What it measures, and the boundary between engine and harness.**
 *
 *   - `tick` — `Runtime.runTick()` alone. This is the engine's cost; the cast's `decide` is timed
 *     separately as `decide`, because in production each agent decides on its own machine and the
 *     server never pays for it.
 *   - `reckoning` — the settlement tick (phase 287), which runs the Levy, every venture's waterfall,
 *     the seals and standing in one batch. Reported apart from the mean because it is the spike.
 *   - `observe` — the server's observation body for a sample of principals, built on the first tick
 *     after the Reckoning settles, which is exactly when every agent wakes to read what happened.
 *     `burstMs` is the sum over **every** principal when `observeSample >= population`, and the mean
 *     times the population otherwise (`burstExtrapolated: true` says which).
 *   - `frames` — the live frame and the Reckoning frame, as the bytes `frames/write.ts` would publish.
 *   - `memory` — heap and RSS at the end of the run.
 *   - `journal` — events and postings, total and per tick: the record's growth rate.
 *
 * Wall-clock timing lives in `scripts/` on purpose, for the reason the original harness gave: DET-7
 * bans clock reads in the engine, and a measurement outside the tick is the right home for one. The
 * clock is injected so the CI-sized test can run the same code with a fake one.
 */

import { buildObservation, type ObserveInput } from '../../src/api/observe.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { isSettlementTick, setSpeed } from '../../src/core/time.js';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import { Runtime } from '../../src/sim/runtime.js';
import { commonsSystems, holdingOccupancy } from '../../src/world/index.js';

/** The server's observation body for one principal — the bytes `GET /observe` sends. */
export type ObserveBody = (runtime: Runtime, principal: PrincipalId) => string;

/** The input a fresh wake builds, minus the parts that vary by principal. */
export function wakeInput(runtime: Runtime, principal: PrincipalId): ObserveInput {
  return {
    runtime,
    principal,
    serverNowMs: 0,
    fresh: true,
    wakesRemaining: 15,
    stale: false,
    corrections: [],
    correctionsDropped: 0,
    actionsRemaining: 4,
  };
}

/** The reference path: one full per-principal build, serialised the way `server.ts` serialises it. */
export const referenceObserveBody: ObserveBody = (runtime, principal) =>
  JSON.stringify({ ok: true, observation: buildObservation(wakeInput(runtime, principal)) });

export interface ScaleOptions {
  readonly population: number;
  /** Ticks to run. A run that should report a Reckoning must cross a settlement tick. */
  readonly ticks: number;
  readonly seed?: string;
  /** The last published tick to start from (`RuntimeOptions.startTick`). Default: genesis. */
  readonly startTick?: number;
  /** §12.4's cadence. Default 18: sixteen wakes a Reckoning. */
  readonly wakeEvery?: number;
  /** How many principals' observations to build after the Reckoning. Default: all of them. */
  readonly observeSample?: number;
  readonly observe?: ObserveBody;
  /** Milliseconds, monotonic. Injected; `performance.now` by default. */
  readonly clock?: () => number;
  /** Called after every tick, for progress lines on long runs. */
  readonly onTick?: (tick: number, tickMs: number) => void;
}

export interface Spread {
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

export interface ScaleRow {
  readonly population: number;
  readonly seed: string;
  readonly ticks: number;
  readonly firstTick: number;
  readonly lastTick: number;
  readonly wakeEvery: number;
  readonly halted: boolean;
  readonly seatMs: number;
  readonly tickMs: Spread;
  /** Ticks that were not the settlement tick — the steady state. */
  readonly steadyTickMs: Spread;
  readonly reckoning: { readonly tick: number; readonly ms: number } | null;
  readonly decideMsPerTick: number;
  readonly actionsPerTick: number;
  readonly observe: {
    readonly tick: number;
    readonly sampled: number;
    readonly ms: Spread;
    readonly bytes: Spread;
    readonly burstMs: number;
    readonly burstExtrapolated: boolean;
  };
  readonly frames: {
    readonly liveBytes: number;
    readonly reckoningBytes: number | null;
    /** Set when the Reckoning frame could not be rendered at all — itself a finding. */
    readonly reckoningError: string | null;
  };
  readonly memory: { readonly heapUsedMb: number; readonly rssMb: number };
  readonly journal: {
    readonly events: number;
    readonly postings: number;
    readonly eventsPerTick: number;
    readonly postingsPerTick: number;
    /** `event_audience` fan-out rows — the table §15.1 says must be indexable, and it grows per reader. */
    readonly audienceRows: number;
    /** The most events one tick committed — the settlement tick, in practice (`MAX_BUFFERED_EVENTS`). */
    readonly maxEventsPerTick: number;
  };
  readonly map: {
    readonly systems: number;
    readonly constellations: number;
    readonly commons: number;
    /** The most holdings standing in any one COMMONS system — §4.2's "principals per stage". */
    readonly maxPerCommons: number;
    readonly maxPerSystem: number;
  };
  readonly stateHash: string;
}

/** `s0001`, `s0002`, … — valid handles, and none of them a handle `agent.md` uses. */
export function syntheticRoster(population: number): readonly string[] {
  const width = Math.max(4, String(population).length);
  return Array.from({ length: population }, (_, i) => `s${String(i + 1).padStart(width, '0')}`);
}

export function spread(values: readonly number[]): Spread {
  if (values.length === 0) return { mean: 0, p50: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return {
    mean: values.reduce((s, v) => s + v, 0) / values.length,
    p50: at(0.5),
    p95: at(0.95),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

/** Seat a synthetic population into a fresh world. Returns the runtime and the cast driving it. */
export function seatPopulation(options: {
  readonly population: number;
  readonly seed: string;
  readonly startTick?: number;
  readonly wakeEvery: number;
}): { readonly runtime: Runtime; readonly cast: HeuristicCast } {
  setSpeed('instant');
  const runtime = new Runtime({
    seed: options.seed,
    ...(options.startTick === undefined ? {} : { startTick: options.startTick }),
  });
  const cast = new HeuristicCast(runtime, {
    size: options.population,
    names: syntheticRoster(options.population),
    wakeEvery: options.wakeEvery,
  });
  cast.seat(options.seed);
  return { runtime, cast };
}

export function measurePopulation(options: ScaleOptions): ScaleRow {
  const clock = options.clock ?? (() => performance.now());
  const seed = options.seed ?? `scale-${String(options.population)}`;
  const wakeEvery = options.wakeEvery ?? 18;
  const observe = options.observe ?? referenceObserveBody;

  let t = clock();
  const { runtime, cast } = seatPopulation({
    population: options.population,
    seed,
    wakeEvery,
    ...(options.startTick === undefined ? {} : { startTick: options.startTick }),
  });
  const seatMs = clock() - t;
  const firstTick = runtime.engine.tick + 1;

  const tickMs: number[] = [];
  const steady: number[] = [];
  let reckoning: { tick: number; ms: number } | null = null;
  let decideMs = 0;
  let actions = 0;
  let halted = false;
  let reckoningFrameBytes: number | null = null;
  let frameError: string | null = null;
  let maxEventsPerTick = 0;
  let observeRow: ScaleRow['observe'] | null = null;
  const eventsAtStart = runtime.events.eventCount;
  let eventsBefore = eventsAtStart;
  const postingsAtStart = runtime.ledger.allPostings().length;

  for (let i = 0; i < options.ticks; i += 1) {
    const next = runtime.engine.tick + 1;
    t = clock();
    const decided = cast.decide(next, seed);
    decideMs += clock() - t;
    actions += decided.length;
    for (const action of decided) runtime.engine.submit(action);

    t = clock();
    const report = runtime.runTick();
    const ms = clock() - t;
    tickMs.push(ms);
    options.onTick?.(report.tick, ms);
    if (report.halted) {
      halted = true;
      break;
    }
    // `report.eventsCommitted` counts the engine's own buffer, which nothing writes to any more (the
    // record is written in DERIVE), so the record's growth is read off the ledger itself.
    const eventsNow = runtime.events.eventCount;
    maxEventsPerTick = Math.max(maxEventsPerTick, eventsNow - eventsBefore);
    eventsBefore = eventsNow;
    if (isSettlementTick(report.tick)) {
      reckoning = { tick: report.tick, ms };
      // A frame that cannot be rendered is a finding, not a crash of the instrument: record it.
      try {
        const frame = runtime.reckoningFrame();
        reckoningFrameBytes = frame === null ? null : JSON.stringify(frame).length;
      } catch (error: unknown) {
        frameError = error instanceof Error ? error.message.split('\n').slice(0, 3).join(' | ') : String(error);
      }
    } else {
      steady.push(ms);
    }
    // The burst: the first tick after a Reckoning settles, when every agent wakes to read it.
    if (observeRow === null && reckoning !== null && report.tick === reckoning.tick + 1) {
      observeRow = measureObserve(runtime, cast, observe, options, clock);
    }
  }
  // A run too short to settle still reports what an observation costs, at the last tick.
  observeRow ??= measureObserve(runtime, cast, observe, options, clock);

  let liveBytes = 0;
  try {
    liveBytes = JSON.stringify(runtime.liveFrame()).length;
  } catch (error: unknown) {
    frameError ??= `live: ${error instanceof Error ? error.message.split('\n')[0] ?? '' : String(error)}`;
  }
  const memory = process.memoryUsage();
  const ran = tickMs.length;
  const events = runtime.events.eventCount;
  const postings = runtime.ledger.allPostings().length;
  const occupancy = holdingOccupancy(runtime.world);
  const commons = commonsSystems(runtime.world.map);
  const maxOf = (ids: Iterable<SystemId>): number => {
    let max = 0;
    for (const id of ids) max = Math.max(max, occupancy.get(id) ?? 0);
    return max;
  };

  return {
    population: options.population,
    seed,
    ticks: ran,
    firstTick,
    lastTick: runtime.engine.tick,
    wakeEvery,
    halted,
    seatMs,
    tickMs: spread(tickMs),
    steadyTickMs: spread(steady),
    reckoning,
    decideMsPerTick: ran === 0 ? 0 : decideMs / ran,
    actionsPerTick: ran === 0 ? 0 : actions / ran,
    observe: observeRow,
    frames: { liveBytes, reckoningBytes: reckoningFrameBytes, reckoningError: frameError },
    memory: { heapUsedMb: memory.heapUsed / 1e6, rssMb: memory.rss / 1e6 },
    journal: {
      events,
      postings,
      eventsPerTick: ran === 0 ? 0 : (events - eventsAtStart) / ran,
      postingsPerTick: ran === 0 ? 0 : (postings - postingsAtStart) / ran,
      audienceRows: runtime.events.audienceRowCount,
      maxEventsPerTick,
    },
    map: {
      systems: runtime.world.map.systems.size,
      constellations: runtime.world.map.constellations.size,
      commons: commons.length,
      maxPerCommons: maxOf(commons),
      maxPerSystem: maxOf(runtime.world.map.systemOrder),
    },
    stateHash: runtime.engine.stateHash,
  };
}

function measureObserve(
  runtime: Runtime,
  cast: HeuristicCast,
  observe: ObserveBody,
  options: ScaleOptions,
  clock: () => number,
): ScaleRow['observe'] {
  const roster = cast.roster.map((m) => m.principal);
  const want = Math.min(roster.length, options.observeSample ?? roster.length);
  // An even stride over the canonical roster, so a sample is not just the first constellation.
  const stride = want <= 0 ? 1 : Math.max(1, Math.floor(roster.length / want));
  const sample = roster.filter((_, i) => i % stride === 0).slice(0, want);
  const ms: number[] = [];
  const bytes: number[] = [];
  for (const principal of sample) {
    const t = clock();
    const body = observe(runtime, principal);
    ms.push(clock() - t);
    bytes.push(body.length);
  }
  const total = ms.reduce((s, v) => s + v, 0);
  const extrapolated = sample.length < roster.length;
  return {
    tick: runtime.engine.tick,
    sampled: sample.length,
    ms: spread(ms),
    bytes: spread(bytes),
    burstMs: extrapolated && sample.length > 0 ? (total / sample.length) * roster.length : total,
    burstExtrapolated: extrapolated,
  };
}

/** One row as a fixed-width line. Shared by the CLI and anybody pasting a table into a doc. */
export function formatRow(r: ScaleRow): string {
  const f = (n: number, d = 1): string => n.toFixed(d);
  const kb = (n: number): string => `${f(n / 1024, 1)}K`;
  return [
    String(r.population).padStart(5),
    `${f(r.steadyTickMs.mean)}/${f(r.steadyTickMs.p95)}/${f(r.steadyTickMs.max)}`.padStart(20),
    (r.reckoning === null ? '—' : f(r.reckoning.ms, 0)).padStart(9),
    f(r.observe.ms.mean, 2).padStart(9),
    f(r.observe.burstMs / 1000, 1).padStart(9) + (r.observe.burstExtrapolated ? '*' : ' '),
    `${kb(r.observe.bytes.mean)}/${kb(r.observe.bytes.max)}`.padStart(14),
    kb(r.frames.liveBytes).padStart(8),
    (r.frames.reckoningBytes === null ? '—' : kb(r.frames.reckoningBytes)).padStart(9),
    `${f(r.memory.heapUsedMb, 0)}/${f(r.memory.rssMb, 0)}`.padStart(10),
    `${f(r.journal.eventsPerTick)}/${f(r.journal.postingsPerTick)}`.padStart(13),
    `${String(r.map.systems)}/${String(r.map.commons)}/${String(r.map.maxPerCommons)}`.padStart(11),
  ].join('  ');
}

export const ROW_HEADER = [
  '  pop',
  'tick ms mean/p95/max'.padStart(20),
  'reckon ms'.padStart(9),
  'obs ms/p'.padStart(9),
  'burst s'.padStart(10),
  'obs bytes avg/max'.padStart(14),
  'live fr'.padStart(8),
  'reckon fr'.padStart(9),
  'heap/rss MB'.padStart(10),
  'events/postings per tick'.padStart(13),
  'sys/com/maxC'.padStart(11),
].join('  ');
