/**
 * POPULATION SCALE — what does a tick actually cost as the world fills?
 *
 * `SPEC.md` §15 and `CLAUDE.md` §6 both rest on one claim: *"at 300 principals a deterministic tick is
 * single-digit milliseconds on the target box, so every remaining risk is a correctness risk, not a
 * capacity risk."* That sentence decides where the whole engineering budget goes — it is the reason
 * effort went into invariants rather than into performance — and **it has never been measured.**
 *
 * It could not be. `--principals P` feeds `HeuristicCast({size: P})` and the roster caps at
 * `MAX_CAST` (20 names, because a cast name may never collide with a handle `agent.md` uses as a
 * worked example). So the harness tops out at 20 and the live world runs ~22. There is no instrument
 * above that, which means the claim has been load-bearing and unfalsifiable at the same time — the
 * defect class this project keeps finding, one level up from the code.
 *
 * ── WHAT THIS MEASURES, AND WHAT IT HONESTLY CANNOT ──────────────────────────
 *
 * It measures **the shape of the curve** from 4 to 20 principals: per-tick wall cost, and how it grows.
 * Shape is the useful part. If cost is flat or linear in population, 300 is a straightforward
 * extrapolation and the claim is probably safe. If it is super-linear — and several known costs are
 * (INV-7 sums the whole posting log every tick, `checkStandingJournal` replays AND sorts its journal
 * every tick, both recorded as INV-26 debt) — then the extrapolation is worthless and 300 needs a real
 * harness before anyone trusts the number.
 *
 * It does **not** measure 300, and the output says so. Extrapolating a wall-clock claim across a 15×
 * population gap would be exactly the kind of confident-and-unverified statement this script exists to
 * replace.
 *
 * Wall-clock timing lives here rather than in `src/` on purpose: DET-7 bans `Date.now` inside the
 * engine because a single unseeded read makes the world unreplayable. A measurement harness outside
 * the tick is the right home for it.
 */

import { setSpeed } from '../src/core/time.js';
import { HeuristicCast, MAX_CAST } from '../src/cast/index.js';
import { Runtime } from '../src/sim/runtime.js';

const TICKS = 300;
const POPULATIONS = [4, 8, 12, 16, 20];

interface Row {
  readonly population: number;
  readonly totalMs: number;
  readonly perTickMs: number;
  readonly perTickPerPrincipalMs: number;
  readonly ventures: number;
  readonly postings: number;
}

function measure(population: number): Row {
  setSpeed('instant');
  const seed = `scale-${String(population)}`;
  const rt = new Runtime({ seed });
  const cast = new HeuristicCast(rt, { size: population });
  cast.seat(seed);

  // Warm the JIT on a few ticks that are not counted, or the smallest population absorbs all the
  // compilation cost and the curve slopes the wrong way for a reason that has nothing to do with scale.
  for (let i = 0; i < 20; i += 1) {
    for (const a of cast.decide(rt.engine.tick + 1, seed)) rt.engine.submit(a);
    rt.runTick();
  }

  const started = performance.now();
  for (let i = 0; i < TICKS; i += 1) {
    for (const a of cast.decide(rt.engine.tick + 1, seed)) rt.engine.submit(a);
    const report = rt.runTick();
    if (report.halted) throw new Error(`halted at tick ${String(report.tick)} with population ${String(population)}`);
  }
  const totalMs = performance.now() - started;

  return {
    population,
    totalMs,
    perTickMs: totalMs / TICKS,
    perTickPerPrincipalMs: totalMs / TICKS / population,
    ventures: rt.ventures.size,
    postings: rt.ledger.allPostings?.().length ?? 0,
  };
}

const rows = POPULATIONS.map(measure);

process.stdout.write(`\nPOPULATION SCALE — ${String(TICKS)} ticks per run, 20 warm-up ticks discarded\n\n`);
process.stdout.write('  pop   total ms   per-tick ms   per-tick-per-principal   ventures\n');
for (const r of rows) {
  process.stdout.write(
    `  ${String(r.population).padStart(3)}   ${r.totalMs.toFixed(0).padStart(8)}   ` +
      `${r.perTickMs.toFixed(3).padStart(11)}   ${r.perTickPerPrincipalMs.toFixed(4).padStart(22)}   ` +
      `${String(r.ventures).padStart(8)}\n`,
  );
}

// ── THE SHAPE, WHICH IS THE POINT ──────────────────────────────────────────────
//
// Per-tick-per-principal FALLING means sub-linear (fixed overhead dominating) — good news for 300.
// Flat means linear. RISING means super-linear, and the §15 claim cannot be extrapolated at all.
const first = rows[0];
const last = rows[rows.length - 1];
if (first !== undefined && last !== undefined) {
  const popRatio = last.population / first.population;
  const costRatio = last.perTickMs / first.perTickMs;
  const exponent = Math.log(costRatio) / Math.log(popRatio);
  process.stdout.write(
    `\n  population ×${popRatio.toFixed(1)} → per-tick cost ×${costRatio.toFixed(2)}   ` +
      `(scaling exponent ≈ ${exponent.toFixed(2)})\n`,
  );
  const verdict =
    exponent < 1.15
      ? 'LINEAR OR BETTER — extrapolating §15\'s claim to 300 is reasonable, though still unmeasured'
      : exponent < 1.6
        ? 'MILDLY SUPER-LINEAR — 300 needs a real harness before the claim is trusted'
        : 'SUPER-LINEAR — §15\'s "single-digit ms at 300" cannot be extrapolated from this curve';
  process.stdout.write(`  verdict: ${verdict}\n`);
  const projected = last.perTickMs * Math.pow(300 / last.population, exponent);
  process.stdout.write(
    `  naive projection at 300: ${projected.toFixed(1)} ms/tick ` +
      `— A PROJECTION, NOT A MEASUREMENT (harness caps at MAX_CAST=${String(MAX_CAST)})\n\n`,
  );
}
