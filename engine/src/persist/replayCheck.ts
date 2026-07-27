/**
 * THE DEPLOY PREFLIGHT: would this build still reproduce the record?
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A deploy that changes how any past tick computes turns the next restart into a
 * boot that cannot reproduce the journal. The world then holds (which is correct)
 * and stops (which is an outage). The right time to discover that is **before the
 * service is restarted**, with the old process still serving, not after.
 *
 * So this runs the real boot — the same {@link bootFromStore}, the same tripwires,
 * the same refusals — against the real journal, in a throwaway process, and exits
 * non-zero if it could not reproduce the record. `deploy/deploy.sh` gates the
 * restart on it, so a bricking change fails the deploy instead of the world.
 *
 * **It never writes.** The store is wrapped so every write path throws; a preflight
 * that mutated the record it is checking would be its own worst bug. The single
 * exception is `recordRulesVersion`, which is made a no-op rather than an error: it
 * is a write-once metadata insert that has nothing to do with reproduction, and
 * failing the check on it would be a false alarm.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { pathToFileURL } from 'node:url';
import { HeuristicCast } from '../cast/index.js';
import { Runtime, RULES_VERSION } from '../sim/runtime.js';
import { bootWorld, describeDiagnosis, type BootDiagnosis, type BootResult } from './boot.js';
import { PgJournalStore } from './postgres.js';
import type {
  DivergenceRecord,
  EnrollmentRecord,
  JournalStore,
  SnapshotDigest,
  SnapshotRecord,
  TickRecord,
} from './store.js';

/** Exit codes, so the shell can tell "broken world" from "broken script". */
export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_DIVERGED = 3;

export interface ReplayCheckResult {
  readonly reproduces: boolean;
  /** Present when it does not. Names the tick and the operator instruction. */
  readonly diagnosis: BootDiagnosis | null;
  /** Present when it does. */
  readonly boot: BootResult | null;
  /**
   * True when the divergence is exactly the one an operator has already declared via
   * `COMPACT_ACCEPT_DIVERGENCE_AT_TICK`. The check then passes: the deploy is
   * deliberate and the boot that follows will write the annotation.
   */
  readonly preAccepted: boolean;
  readonly report: string;
}

export interface ReplayCheckOptions {
  readonly store: JournalStore;
  readonly seed: string;
  /** Build the fresh, cast-seated runtime the boot replays into. */
  readonly buildRuntime: (seed: string) => Runtime;
  /** The tick an operator has already declared, or null. */
  readonly acceptDivergenceFromTick?: number | null;
  /** Progress sink; the CLI writes a line every few thousand ticks. */
  readonly onProgress?: (tick: number, headTick: number) => void;
}

/**
 * Replay the journal against this build and say whether it still reproduces.
 *
 * Returns rather than throws for a divergence — the divergence IS the answer — and
 * only throws when the check itself could not run (no database, unreadable rows).
 */
export async function replayCheck(opts: ReplayCheckOptions): Promise<ReplayCheckResult> {
  const store = readOnly(opts.store);
  const persistedSeed = await store.masterSeed();
  const head = await store.headTick();
  if (persistedSeed === null) {
    return {
      reproduces: true,
      diagnosis: null,
      boot: null,
      preAccepted: false,
      report:
        'replay-check: the journal is empty (no master seed). Nothing to reproduce; ' +
        'this build would boot a GENESIS world.',
    };
  }

  const runtime = opts.buildRuntime(persistedSeed);
  const outcome = await bootWorld(runtime, store, {
    seed: persistedSeed,
    // Always null: the CHECK never walks through the operator door. It reports
    // whether the door would be needed, and whether the operator already opened it.
    acceptDivergenceFromTick: null,
    // And it never adopts a checkpoint. The question this answers is "does this build re-derive the
    // record", and adoption re-derives nothing — an adopted preflight would report the first
    // divergence in the tail, which is a different (and later) tick than the one boot will demand.
    // Measured: adopt-at-100 reports tick 117 where genesis finds 66. The preflight exists to hand
    // an operator the tick to type; handing them the wrong one is worse than being slow.
    checkpoint: { disabled: true },
    ...(opts.onProgress === undefined ? {} : { onProgress: opts.onProgress }),
  });

  if (outcome.status === 'READY') {
    const r = outcome.result;
    return {
      reproduces: true,
      diagnosis: null,
      boot: r,
      preAccepted: false,
      report:
        `replay-check: OK. ${String(r.ticksReplayed)} ticks replayed to head ${String(r.headTick)}, ` +
        `${String(r.tripwiresChecked)} snapshot tripwires matched, rules_version ` +
        `${r.journalledRulesVersion === null ? 'unrecorded' : String(r.journalledRulesVersion)} -> ${String(r.runningRulesVersion)}. ` +
        `This build reproduces the record.`,
    };
  }

  const declared = opts.acceptDivergenceFromTick ?? null;
  const preAccepted = declared !== null && declared === outcome.diagnosis.tick;
  return {
    reproduces: false,
    diagnosis: outcome.diagnosis,
    boot: null,
    preAccepted,
    report:
      `replay-check: THIS BUILD WOULD NOT REPRODUCE THE RECORD (head tick ${String(head)}).\n\n` +
      describeDiagnosis(outcome.diagnosis) +
      (preAccepted
        ? `\n\n  An operator has ALREADY declared this exact tick ` +
          `(COMPACT_ACCEPT_DIVERGENCE_AT_TICK=${String(declared)}), so the deploy may proceed and ` +
          `the boot will write the annotation.`
        : declared === null
          ? ''
          : `\n\n  An operator declared tick ${String(declared)}, but the FIRST divergence is at tick ` +
            `${String(outcome.diagnosis.tick)}. The declaration must name the tick it was given.`),
  };
}

/**
 * A store that refuses to be written to.
 *
 * Explicit method-by-method rather than a Proxy: a Proxy would silently pass through
 * any method added to the interface later, which is the failure mode this wrapper
 * exists to prevent.
 */
function readOnly(inner: JournalStore): JournalStore {
  const refuse = (what: string): never => {
    throw new Error(`replay-check must not write: ${what} was called on a read-only store`);
  };
  return {
    init: (): Promise<void> => refuse('init'),
    masterSeed: () => inner.masterSeed(),
    appendTick: (): Promise<void> => refuse('appendTick'),
    writeSnapshot: (): Promise<void> => refuse('writeSnapshot'),
    latestSnapshot: () => inner.latestSnapshot(),
    snapshots: () => inner.snapshots(),
    snapshotHashes: () => inner.snapshotHashes(),
    ticksSince: (t: number) => inner.ticksSince(t),
    ticksPage: (t: number, limit: number) => inner.ticksPage(t, limit),
    postingsInRange: (from: number, to: number) => inner.postingsInRange(from, to),
    headTick: () => inner.headTick(),
    // A no-op, not a refusal: write-once metadata, irrelevant to reproduction, and a
    // check that failed on it would cry wolf on every journal written before it.
    recordRulesVersion: (): Promise<void> => Promise.resolve(),
    journalledRulesVersion: () => inner.journalledRulesVersion(),
    recordDivergence: (): Promise<void> => refuse('recordDivergence'),
    divergences: (): Promise<readonly DivergenceRecord[]> => inner.divergences(),
    recordEnrollment: (): Promise<void> => refuse('recordEnrollment'),
    enrollments: (): Promise<readonly EnrollmentRecord[]> => inner.enrollments(),
    close: () => Promise.resolve(),
  } satisfies JournalStore & {
    // Named so the compiler complains here — not at a call site — if the interface
    // grows a method this wrapper has not decided about.
    readonly snapshots: () => Promise<readonly SnapshotRecord[]>;
    readonly snapshotHashes: () => Promise<readonly SnapshotDigest[]>;
    readonly ticksSince: (t: number) => Promise<readonly TickRecord[]>;
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function envInt(name: string): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim().length === 0) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

async function main(): Promise<number> {
  const url =
    process.env['COMPACT_DATABASE_URL'] ?? process.env['DATABASE_URL'] ?? null;
  const hasPgEnv = process.env['PGHOST'] !== undefined || process.env['PGDATABASE'] !== undefined;
  if (url === null && !hasPgEnv) {
    process.stderr.write(
      'replay-check: no COMPACT_DATABASE_URL / DATABASE_URL / PG* configured. There is no journal to ' +
        'check against, so this proves nothing and must not pass silently.\n',
    );
    return EXIT_ERROR;
  }
  const castSize = envInt('COMPACT_CAST') ?? 12;
  const store = new PgJournalStore(url === null ? {} : { connectionString: url });
  let last = -1;
  try {
    const result = await replayCheck({
      store,
      seed: process.env['COMPACT_SEED'] ?? 'compact-1',
      acceptDivergenceFromTick: envInt('COMPACT_ACCEPT_DIVERGENCE_AT_TICK'),
      buildRuntime: (seed) => {
        const runtime = new Runtime({ seed });
        const cast = new HeuristicCast(runtime, { size: castSize });
        cast.seat(seed);
        return runtime;
      },
      onProgress: (tick, head) => {
        // Every 5 000 ticks: a long replay that prints nothing is indistinguishable
        // from a hung one, and the operator is watching a deploy.
        if (tick - last >= 5000) {
          last = tick;
          process.stderr.write(`  replay-check ${String(tick)}/${String(head)}\n`);
        }
      },
    });
    process.stdout.write(`${result.report}\n`);
    process.stdout.write(`rules_version(build) = ${String(RULES_VERSION)}\n`);
    if (result.reproduces) return EXIT_OK;
    return result.preAccepted ? EXIT_OK : EXIT_DIVERGED;
  } catch (error: unknown) {
    process.stderr.write(
      `replay-check: could not run — ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return EXIT_ERROR;
  } finally {
    await store.close();
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  process.exitCode = await main();
}
