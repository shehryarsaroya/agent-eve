#!/usr/bin/env node
/**
 * `sim` — the headless runner, and Gate 0's fourth artifact.
 *
 * TESTING.md Gate 0: *"`sim --seed S --ticks N` printing per-tick `state_hash`"*.
 * The per-tick hash is what makes DET-1 ("same seed + same action log → identical
 * `state_hash` per tick") a comparison somebody can actually run, rather than a
 * property nobody can observe. Two runs are diffed with `diff`, and a divergence
 * names the exact tick it began at.
 *
 * ```
 * sim --seed s1 --ticks 288 --speed instant --cast heuristic --principals 12 \
 *     --hazards off --assert-every-tick --emit state_hash
 * ```
 *
 * Four things about the output are deliberate:
 *
 *   - **One line per tick, `tick<TAB>state_hash`.** Machine-diffable first, human
 *     second. The summary goes to stderr so `sim ... > a` is the hash stream alone.
 *   - **`--assert-every-tick` is on by default.** The invariants are the point of
 *     the exercise; making them opt-in would mean the default run is the one that
 *     proves nothing.
 *   - **A halt exits non-zero and prints the triple**, so the failure is
 *     reproducible from `(snapshot, action_log, seed)` alone (§15.2).
 *   - **The rollback gaps are printed on a halt**, because a table with no
 *     `restore` cannot be put back and the operator has to know that *before*
 *     deciding to resume rather than during.
 */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SPEEDS, isSpeedName, setSpeed, systemClock, type SpeedName } from '../core/time.js';
import { Rng } from '../core/rng.js';
import { HeuristicCast } from '../cast/index.js';
import { archiveLiveFrame, publishFrame, publishLiveFrame, serialiseLiveFrame } from '../frames/write.js';
import { Runtime, type LevySummary, type ReckoningSummary } from './runtime.js';

export interface SimArgs {
  readonly seed: string;
  readonly ticks: number;
  readonly speed: SpeedName;
  /** Lower case: `HEURISTIC` is a `DecisionSource` member and this is not that. */
  readonly cast: 'heuristic' | 'none';
  readonly principals: number;
  readonly hazards: boolean;
  readonly assertEveryTick: boolean;
  readonly emitStateHash: boolean;
  readonly quiet: boolean;
  /** Directory to write settled-Reckoning frames to, for the spectator client. */
  readonly framesDir: string | null;
  /**
   * ★ Also archive **every** live frame, one file per tick, under `framesDir/live/`.
   *
   * Off by default and it must stay off by default: production rewrites one `live.json` in place,
   * because a mid-Reckoning tick is *motion* and its history is the ledger. A sim wants the opposite —
   * a sequence it can diff tick against tick — which is the only way to demonstrate that `ticksLeft`
   * counts DOWN and a `gap` MOVES rather than merely being non-zero once. The audit that found the
   * post-mortem defect did it by reading 21 archived frames; this is that instrument for the live one.
   */
  readonly liveFrames: boolean;
}

export const DEFAULT_ARGS: SimArgs = {
  seed: 'sim-1',
  ticks: 288,
  speed: 'instant',
  cast: 'heuristic',
  principals: 12,
  hazards: false,
  assertEveryTick: true,
  emitStateHash: true,
  quiet: false,
  framesDir: null,
  liveFrames: false,
};

export class ArgError extends Error {}

/**
 * Parse argv.
 *
 * Unknown flags are an **error**, not a warning. A typo'd `--tikcs 500` that
 * silently ran 288 ticks is a run whose result answers a different question than
 * the one asked, and an overnight sweep made of those is worse than no sweep.
 */
export function parseArgs(argv: readonly string[]): SimArgs {
  let args: SimArgs = { ...DEFAULT_ARGS };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === undefined) continue;
    const value = (): string => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new ArgError(`${flag} needs a value`);
      i += 1;
      return v;
    };
    switch (flag) {
      case '--frames':
        args = { ...args, framesDir: value() };
        break;
      case '--live-frames':
        args = { ...args, liveFrames: true };
        break;
      case '--seed':
        args = { ...args, seed: value() };
        break;
      case '--ticks':
        args = { ...args, ticks: positiveInt(value(), '--ticks') };
        break;
      case '--speed': {
        const raw = value();
        if (!isSpeedName(raw)) {
          throw new ArgError(`--speed must be one of ${Object.keys(SPEEDS).join(' | ')}, got ${raw}`);
        }
        args = { ...args, speed: raw };
        break;
      }
      case '--cast': {
        const raw = value();
        if (raw !== 'heuristic' && raw !== 'none') {
          throw new ArgError(`--cast must be heuristic | none, got ${raw}`);
        }
        args = { ...args, cast: raw };
        break;
      }
      case '--principals':
        args = { ...args, principals: positiveInt(value(), '--principals') };
        break;
      case '--hazards': {
        const raw = value();
        if (raw !== 'on' && raw !== 'off') throw new ArgError(`--hazards must be on | off, got ${raw}`);
        args = { ...args, hazards: raw === 'on' };
        break;
      }
      case '--assert-every-tick':
        args = { ...args, assertEveryTick: true };
        break;
      case '--no-assert-every-tick':
        args = { ...args, assertEveryTick: false };
        break;
      case '--emit': {
        const raw = value();
        if (raw !== 'state_hash' && raw !== 'none') {
          throw new ArgError(`--emit must be state_hash | none, got ${raw}`);
        }
        args = { ...args, emitStateHash: raw === 'state_hash' };
        break;
      }
      case '--quiet':
        args = { ...args, quiet: true };
        break;
      default:
        throw new ArgError(
          `unknown flag ${flag}. Usage: sim --seed S --ticks N --speed instant|turbo|fast|rehearsal|prod ` +
            '--cast heuristic|none --principals P --hazards on|off --assert-every-tick --emit state_hash',
        );
    }
  }
  return args;
}

function positiveInt(raw: string, flag: string): number {
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) throw new ArgError(`${flag} must be a positive integer, got ${raw}`);
  return n;
}

export interface SimLine {
  readonly tick: number;
  readonly stateHash: string;
}

/**
 * What the Reckonings did, over the whole run.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **This is how Gate 3 gets answered**, so every figure here is counted from the
 * batch's own output rather than inferred, and the two that could be mistaken for good
 * news are named so they cannot be:
 *
 *   - `defaults` is accusations *published*, each with its cause as a column (INV-17).
 *     Zero means nothing was recorded, which is not the same as nobody breaking a
 *     promise — read it next to `electiveHonoured`, which is the other half.
 *   - `levyShort` is `LEVY SHORT` — §14.2's headline, *"a world fact nobody can lower
 *     alone, which rises when the population turtles"* — summed over the run, and it is
 *     reported beside `levyAssessed` and `levyPaidInFull` for exactly the same reason. A
 *     zero on its own is unreadable: zero short with 48 assessed is a population that
 *     paid, and zero short with **zero assessed** is the Levy not running at all, which is
 *     the abstention-trivial failure the mechanic exists to delete. `levyBuilt` says
 *     which of those a zero means, and it is read from whether any assessment was minted
 *     rather than from a constant — a flag that could not be false is not a measurement.
 * ══════════════════════════════════════════════════════════════════════════
 */
export interface ReckoningTotals {
  /** Reckonings that reached settlement. One per settlement tick the run covered. */
  readonly reckonings: number;
  /** Reckonings whose batch committed. Anything less than `reckonings` is a halt. */
  readonly committed: number;
  readonly obligations: number;
  readonly settlements: number;
  readonly defaulted: number;
  readonly deferrals: number;
  readonly defaults: number;
  readonly electiveHonoured: number;
  readonly standingMoves: number;
  readonly sealsJudged: number;
  readonly sealsContradicted: number;
  readonly sealsUnmarked: number;
  readonly deedSetFaults: number;
  readonly proceedsMinor: number;
  readonly paidEscrowedMinor: number;
  readonly paidElectiveMinor: number;
  readonly unattributedMinor: number;
  readonly recordedLossMinor: number;
  /** `LEVY SHORT`, summed over the run. The one meter no single agent can lower. */
  readonly levyShort: number;
  readonly levyTotal: number;
  readonly levyAssessed: number;
  readonly levyPaidInFull: number;
  readonly levySweptQty: number;
  readonly levySweepQueue: number;
  readonly levyDemoted: number;
  /** Constellation-Reckonings where quorum failed and the published formula applied. */
  readonly levyByDefault: number;
  readonly levyBallots: number;
  /**
   * Did the Levy actually run? **Derived from the assessments, never asserted.**
   *
   * `true` iff at least one principal was assessed in at least one Reckoning of this run.
   * A hard-coded flag here would be the guard whose count came from the array it was
   * meant to witness — this one goes false the moment the wiring in `runtime.ts` stops
   * minting an assessment, which is the failure worth catching.
   */
  readonly levyBuilt: boolean;
}

export interface SimResult {
  readonly lines: readonly SimLine[];
  readonly halted: boolean;
  readonly haltedAtTick: number | null;
  readonly violations: readonly string[];
  readonly ticksRun: number;
  readonly applied: number;
  readonly refused: number;
  readonly ventures: number;
  readonly decisions: Readonly<Record<string, number>>;
  readonly rollbackGaps: readonly string[];
  readonly buffers: Readonly<Record<string, number>>;
  readonly reckonings: ReckoningTotals;
  /** Per Reckoning, oldest first. Bounded; the totals above cover the whole run. */
  readonly perReckoning: readonly ReckoningSummary[];
  /** The Levy per Reckoning, oldest first. `LEVY SHORT` is decomposable to this. */
  readonly perLevy: readonly LevySummary[];
  /**
   * The tribute lines at the last freeze the run reached, counted by state.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * A13's evidence, and it is sampled **at the freeze** on purpose: that is the moment
   * §5.2 says an unpaid line turns red, so it is the one tick where the histogram
   * distinguishes a population that paid from one that did not. Sampling at an arbitrary
   * tick would report mostly `DASHED` and mean nothing.
   *
   * `lines: 0` here with `levyAssessed > 0` would mean the mechanic ran and drew nothing —
   * A13's "no named pixel signature, not ready" as a number rather than a review note.
   * ══════════════════════════════════════════════════════════════════════════
   */
  readonly tributeAtFreeze: Readonly<Record<string, number>>;
  /**
   * Alarms the runtime deliberately did not halt for.
   *
   * Printed, because the alternative to halting is *saying so*: a fault nobody prints
   * is a fault nobody acts on, and every one of these is reachable without an agent's
   * help (a refused row, a venture with no delivery, a restore that did not reproduce).
   */
  readonly operatorFaults: readonly string[];
  readonly framesWritten: number;
  /** ★ How many LIVE frames were published. Zero without `--frames`. */
  readonly liveFramesWritten: number;
  /**
   * ★ How many of those live frames differed from the one before it.
   *
   * **The meter that makes the fix falsifiable.** `publishLiveFrame` skips an identical rewrite, so
   * this counts the ticks on which something a viewer can see actually MOVED. A live frame published
   * 1,734 times with `liveFramesMoved: 0` would be the post-mortem defect wearing a new file name —
   * and this repo's own lesson is that when you land a mechanism you land the meter, because an
   * unmeasured capability is the same defect one level up.
   */
  readonly liveFramesMoved: number;
}

/**
 * Run the sim in-process and return the hash stream.
 *
 * Separate from {@link main} so tests can assert on the result without capturing
 * stdout — a test that greps a process's output is a test that breaks when the
 * summary text is reworded, and the summary text is the part most likely to change.
 */
export function runSim(args: SimArgs, emit?: (line: SimLine) => void): SimResult {
  setSpeed(args.speed);

  const runtime = new Runtime({ seed: args.seed, hazards: args.hazards });
  const rng = Rng.fromSeed(`${args.seed}:seating`);

  const cast =
    args.cast === 'heuristic'
      ? new HeuristicCast(runtime, { size: args.principals })
      : null;
  if (cast !== null) cast.seat(args.seed);
  else {
    // No cast: still seat principals, so the world is not empty and the invariants
    // have something to be true about.
    for (let i = 0; i < args.principals; i += 1) {
      const handle = `probe-${String(i + 1).padStart(3, '0')}`;
      const seat = runtime.seatInTier('COMMONS', rng.derive(handle));
      if (seat === undefined) break;
      runtime.seat(`p:${handle}` as never, handle, seat);
    }
  }

  const lines: SimLine[] = [];
  const violations: string[] = [];
  const perReckoning: ReckoningSummary[] = [];
  const perLevy: LevySummary[] = [];
  let tributeAtFreeze: Record<string, number> = {};
  let applied = 0;
  let refused = 0;
  let halted = false;
  let haltedAtTick: number | null = null;
  let ticksRun = 0;
  let framesWritten = 0;
  let liveFramesWritten = 0;
  let liveFramesMoved = 0;
  let lastLiveBody = '';

  for (let n = 0; n < args.ticks; n += 1) {
    // The world stops when it stops. A scheduler that keeps calling a PAUSED engine is
    // the "verify the invisible" failure, and `runTick` throws rather than pretend.
    if (runtime.paused) break;
    const tick = runtime.engine.tick + 1;
    if (cast !== null) {
      for (const action of cast.decide(tick, args.seed)) {
        // A refused submission is data, not an error: the cast is a player and a
        // player's illegal move is a hint (PROP-O7). Counted, never thrown.
        const submitted = runtime.engine.submit(action);
        if (!submitted.ok) refused += 1;
      }
    }
    const report = runtime.runTick();
    ticksRun += 1;
    applied += report.applied;
    refused += report.refused;
    const line: SimLine = { tick: report.tick, stateHash: report.stateHash };
    lines.push(line);
    if (emit !== undefined) emit(line);
    // Collected per tick rather than read once at the end: the runtime's own log is
    // bounded (INV-26), so a long run would otherwise report only the last few
    // Reckonings and a reader would have no way to tell that from a quiet season.
    if (report.clock.isSettlementTick) {
      const settled = runtime.reckonings().at(-1);
      if (settled !== undefined && settled.tick === report.tick) perReckoning.push(settled);
      // Write the settled Reckoning as a frame for the spectator client. A read model
      // over the committed outcome — the world settles and someone can finally watch.
      if (args.framesDir !== null) {
        const frame = runtime.reckoningFrame();
        if (frame !== null) framesWritten += publishFrame(args.framesDir, frame).bytes > 0 ? 1 : 0;
      }
      // Collected the same way and for the same reason: the runtime's own Levy log is
      // bounded (INV-26), so a long run read only at the end would report the last few
      // Reckonings and a reader would have no way to tell that from a quiet season.
      const levied = runtime.levyReckonings().at(-1);
      if (levied !== undefined && levied.tick === report.tick) perLevy.push(levied);
    }

    // ── ★ THE LIVE FRAME, EVERY TICK — see `api/server.ts` for why it exists ───
    //
    // Published here as well as in the API server so a sim can MEASURE the motion, and `liveFramesMoved`
    // is that meter: the count of ticks on which the bytes a viewer would fetch actually CHANGED. It is
    // computed here rather than read off `rewritten` because the two modes would otherwise mean
    // different things — an archived per-tick file is always new, so its `rewritten` is always true and
    // the meter would report perfect motion over a frozen world. **A meter that cannot report zero is
    // the defect it was written to detect.**
    //
    // Never on a halted tick: that tick was aborted and NOT published, and a frame rendered from a
    // rolled-back world shows a state the record denies (A5′).
    if (args.framesDir !== null && !report.halted) {
      const live = runtime.liveFrame();
      const body = serialiseLiveFrame(live);
      if (body !== lastLiveBody) liveFramesMoved += 1;
      lastLiveBody = body;
      publishLiveFrame(args.framesDir, live);
      // The archive form, behind a flag: one file per tick under `live/`, so an instrument can diff
      // tick against tick. Production does not do this — see `frames/write.ts:archiveLiveFrame`.
      if (args.liveFrames) archiveLiveFrame(join(args.framesDir, 'live'), live);
      liveFramesWritten += 1;
    }
    if (report.clock.inFreeze) {
      tributeAtFreeze = { lines: 0, DASHED: 0, SOLID: 0, RED: 0, REVERSING: 0, owedMinor: 0 };
      for (const line of runtime.tributeLines(report.tick)) {
        tributeAtFreeze[line.state] = (tributeAtFreeze[line.state] ?? 0) + 1;
        tributeAtFreeze['lines'] = (tributeAtFreeze['lines'] ?? 0) + 1;
        tributeAtFreeze['owedMinor'] = (tributeAtFreeze['owedMinor'] ?? 0) + line.owed;
      }
    }

    if (args.assertEveryTick && report.violations.length > 0) {
      for (const v of report.violations) {
        violations.push(`${v.id}@${String(v.tick)} [${v.severity}] ${v.message}`);
      }
    }
    if (report.halted) {
      halted = true;
      haltedAtTick = report.tick;
      break;
    }
  }

  return {
    lines,
    halted,
    haltedAtTick,
    violations,
    ticksRun,
    applied,
    refused,
    ventures: runtime.ventures.size,
    decisions: runtime.census.distribution(),
    rollbackGaps: runtime.engine.rollbackGaps,
    buffers: runtime.bufferSizes(),
    reckonings: totalise(perReckoning, perLevy),
    perReckoning,
    perLevy,
    tributeAtFreeze,
    operatorFaults: runtime.operatorFaults(),
    framesWritten,
    liveFramesWritten,
    liveFramesMoved,
  };
}

/** Sum the per-Reckoning rows. Counted, never inferred — see {@link ReckoningTotals}. */
export function totalise(
  rows: readonly ReckoningSummary[],
  levy: readonly LevySummary[] = [],
): ReckoningTotals {
  const sum = (pick: (row: ReckoningSummary) => number): number =>
    rows.reduce((n, row) => n + pick(row), 0);
  const levySum = (pick: (row: LevySummary) => number): number =>
    levy.reduce((n, row) => n + pick(row), 0);
  return {
    reckonings: rows.length,
    committed: rows.filter((r) => r.committed).length,
    obligations: sum((r) => r.obligations),
    settlements: sum((r) => r.settled),
    defaulted: sum((r) => r.defaulted),
    deferrals: sum((r) => r.deferred),
    defaults: sum((r) => r.defaults),
    electiveHonoured: sum((r) => r.electiveHonoured),
    standingMoves: sum((r) => r.standingMoves),
    sealsJudged: sum((r) => r.sealsJudged),
    sealsContradicted: sum((r) => r.sealsContradicted),
    sealsUnmarked: sum((r) => r.sealsUnmarked),
    deedSetFaults: sum((r) => r.deedSetFaults),
    proceedsMinor: sum((r) => r.proceeds),
    paidEscrowedMinor: sum((r) => r.paidEscrowed),
    paidElectiveMinor: sum((r) => r.paidElective),
    unattributedMinor: sum((r) => r.unattributed),
    recordedLossMinor: sum((r) => r.recordedLoss),
    levyShort: levySum((r) => r.shortMinor),
    levyTotal: levySum((r) => r.totalMinor),
    levyAssessed: levySum((r) => r.assessed),
    levyPaidInFull: levySum((r) => r.paidInFull),
    levySweptQty: levySum((r) => r.sweptQty),
    levySweepQueue: levySum((r) => r.sweepQueue),
    levyDemoted: levySum((r) => r.demoted),
    levyByDefault: levySum((r) => r.byDefault),
    levyBallots: levySum((r) => r.ballotsCast),
    // Derived from the assessments, so it goes false the moment the wiring stops minting
    // one. A constant here would be a flag that cannot report its own failure.
    levyBuilt: levy.some((r) => r.assessed > 0),
  };
}

/**
 * The CLI entry point.
 *
 * The hash stream goes to **stdout**, one `tick<TAB>hash` per line; everything else
 * goes to stderr, so that `diff <(sim --seed a) <(sim --seed a)` is a determinism
 * check with no post-processing.
 */
export function main(argv: readonly string[]): number {
  let args: SimArgs;
  try {
    args = parseArgs(argv);
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : 'bad arguments'}\n`);
    return 2;
  }

  const started = systemClock().nowMs();
  const result = runSim(args, (line) => {
    if (args.emitStateHash) process.stdout.write(`${String(line.tick)}\t${line.stateHash}\n`);
  });
  const elapsedMs = systemClock().nowMs() - started;

  if (!args.quiet) {
    const summary = {
      seed: args.seed,
      speed: args.speed,
      ticks: result.ticksRun,
      applied: result.applied,
      refused: result.refused,
      ventures: result.ventures,
      decisions: result.decisions,
      reckonings: result.reckonings,
      per_reckoning: result.perReckoning,
      per_levy: result.perLevy,
      tribute_at_freeze: result.tributeAtFreeze,
      buffers: result.buffers,
      elapsed_ms: elapsedMs,
      final_state_hash: result.lines[result.lines.length - 1]?.stateHash ?? null,
    };
    process.stderr.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (result.rollbackGaps.length > 0) {
      process.stderr.write(
        `rollback gaps (tables that cannot be restored in-process): ${result.rollbackGaps.join(', ')}\n`,
      );
    }
    if (result.operatorFaults.length > 0) {
      process.stderr.write(`OPERATOR FAULTS (${String(result.operatorFaults.length)}), not halts:\n`);
      for (const fault of result.operatorFaults) process.stderr.write(`  ${fault}\n`);
    }
  }

  if (result.violations.length > 0) {
    process.stderr.write(`INVARIANT VIOLATIONS (${String(result.violations.length)}):\n`);
    for (const v of result.violations) process.stderr.write(`  ${v}\n`);
  }
  if (result.halted) {
    process.stderr.write(
      `HALTED at tick ${String(result.haltedAtTick)}. The world was not published. Reproduce with ` +
        `--seed ${args.seed} --ticks ${String(result.ticksRun)} and replay the failed tick from its triple.\n`,
    );
    return 1;
  }
  return result.violations.length > 0 ? 1 : 0;
}

// `import.meta.url` compared against the resolved entry path, rather than the CJS
// `require.main === module` idiom, which silently never fires in an ESM module and
// would turn this CLI into a library that prints nothing.
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  process.exit(main(process.argv.slice(2)));
}
