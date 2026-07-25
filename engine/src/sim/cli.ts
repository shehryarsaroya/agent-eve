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

import { pathToFileURL } from 'node:url';
import { SPEEDS, isSpeedName, setSpeed, systemClock, type SpeedName } from '../core/time.js';
import { Rng } from '../core/rng.js';
import { HeuristicCast } from '../cast/index.js';
import { Runtime } from './runtime.js';

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
  let applied = 0;
  let refused = 0;
  let halted = false;
  let haltedAtTick: number | null = null;
  let ticksRun = 0;

  for (let n = 0; n < args.ticks; n += 1) {
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
