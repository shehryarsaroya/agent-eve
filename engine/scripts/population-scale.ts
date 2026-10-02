/**
 * POPULATION SCALE — what does a world cost as it fills?
 *
 * `SPEC.md` §15 and `CLAUDE.md` §6 rest on one claim: *"at 300 principals a deterministic tick is
 * single-digit milliseconds on the target box, so every remaining risk is a correctness risk, not a
 * capacity risk."* That sentence decides where the engineering budget goes, and until 2026-10-01 it
 * had only ever been **projected**: this script ran 4..20 principals because `HeuristicCast` capped at
 * `MAX_CAST` (20 names), fitted a curve, and printed *"A PROJECTION, NOT A MEASUREMENT"* under the
 * number at 300. Season 1 expects thousands, so the projection is retired and the populations are
 * seated for real — see `scripts/scale/harness.ts` for what each column measures and why the cast's
 * own decision time is reported apart from the engine's.
 *
 * Usage:
 *
 *     npx tsx scripts/population-scale.ts                       # 300, 1000, 3000 · 300 ticks
 *     npx tsx scripts/population-scale.ts --populations 300 --ticks 300
 *     npx tsx scripts/population-scale.ts --sample 120          # observe a stride sample, extrapolate
 *     npx tsx scripts/population-scale.ts --path reference      # the per-principal build, for "before"
 *     npx tsx scripts/population-scale.ts --json out.json
 *     npx tsx scripts/population-scale.ts --clock cpu           # CPU time: for a shared, loaded box
 *
 * 300 ticks crosses one settlement (phase 287), so every row reports a Reckoning batch and the burst
 * of observations the tick after it. A row marked `*` in the burst column was extrapolated from a
 * sample; every other figure is measured.
 *
 * Wall-clock timing lives here rather than in `src/` on purpose: DET-7 bans clock reads inside the
 * engine because a single unseeded read makes the world unreplayable.
 */

import { writeFileSync } from 'node:fs';
import { observationBody } from '../src/api/fragments.js';
import { formatRow, measurePopulation, referenceObserveBody, ROW_HEADER, wakeInput, type ObserveBody, type ScaleRow } from './scale/harness.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
}

const populations = (arg('populations') ?? '300,1000,3000').split(',').map((s) => Number(s.trim()));
const ticks = Number(arg('ticks') ?? 300);
const sample = arg('sample') === undefined ? undefined : Number(arg('sample'));
const wakeEvery = Number(arg('wake') ?? 18);
const path = arg('path') ?? 'fragments';
const jsonOut = arg('json');
const progress = process.argv.includes('--progress');
/**
 * `--clock cpu` times with this process's own CPU time instead of the wall. On a shared box the wall
 * counts every millisecond the scheduler gave to somebody else — the Season 1 measurements were taken
 * at a load average above 200 — and CPU time does not. `wall` (the default) is what a dedicated host
 * would see; on an idle machine the two agree to within GC helper threads.
 */
const clockName = arg('clock') ?? 'wall';
const cpuClock = (): number => {
  const used = process.cpuUsage();
  return (used.user + used.system) / 1000;
};

/** The server's own path: shared fragments once per tick, a per-principal envelope (§15.5). */
const fragmentObserveBody: ObserveBody = (runtime, principal) => observationBody(wakeInput(runtime, principal));
const observe = path === 'reference' ? referenceObserveBody : fragmentObserveBody;

const rows: ScaleRow[] = [];
process.stdout.write(
  `\nPOPULATION SCALE — ${String(ticks)} ticks from genesis, wake every ${String(wakeEvery)} ticks, observe path: ${path}, clock: ${clockName}\n\n`,
);
process.stdout.write(`${ROW_HEADER}\n`);
for (const population of populations) {
  const row = measurePopulation({
    population,
    ticks,
    wakeEvery,
    observe,
    ...(sample === undefined ? {} : { observeSample: sample }),
    ...(clockName === 'cpu' ? { clock: cpuClock } : {}),
    ...(progress
      ? {
          onTick: (tick: number, ms: number) => {
            if (tick % 24 === 0) process.stderr.write(`  [${String(population)}] tick ${String(tick)} ${ms.toFixed(0)} ms\n`);
          },
        }
      : {}),
  });
  rows.push(row);
  process.stdout.write(`${formatRow(row)}\n`);
}

process.stdout.write(
  '\n  tick ms: steady-state ticks (the settlement tick is reported on its own as `reckon ms`).\n' +
    '  obs ms/p: one observation body, built and serialised, on the first tick after the Reckoning.\n' +
    '  burst s: every principal observing on that tick, one after another on one core. `*` = extrapolated.\n' +
    '  sys/com/maxC: systems · COMMONS systems · most holdings standing in one COMMONS system.\n\n',
);
for (const r of rows) {
  process.stdout.write(
    `  ${String(r.population)}: halted=${String(r.halted)} decide ${r.decideMsPerTick.toFixed(1)} ms/tick (harness, not engine) · ` +
      `${r.actionsPerTick.toFixed(1)} actions/tick · journal ${String(r.journal.events)} events / ${String(r.journal.postings)} postings ` +
      `(max ${String(r.journal.maxEventsPerTick)} events in one tick) · state ${r.stateHash.slice(0, 12)}` +
      (r.frames.reckoningError === null ? '' : `\n      FRAME ERROR: ${r.frames.reckoningError}`) +
      `\n      growth: ${String(r.growth.qualified)} of ${String(r.growth.needed)} qualified · ${String(r.grown)} grown` +
      `\n      fullest books: ${r.pressure
        .slice(0, 5)
        .map((p) => `${p.book} peak ${String(p.peak)}/${String(p.cap)}`)
        .join(' · ')}` +
      '\n',
  );
}
if (jsonOut !== undefined) {
  writeFileSync(jsonOut, `${JSON.stringify(rows, null, 2)}\n`);
  process.stdout.write(`\n  wrote ${jsonOut}\n`);
}
process.stdout.write('\n');
