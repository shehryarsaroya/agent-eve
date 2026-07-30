/**
 * ★ **THE SEED SCAN THAT RE-PINS `LINE_SEEDS`, AND WHY IT IS A SCAN RATHER THAN A SEARCH.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **A RE-PIN BY HUNTING FOR A SEED THAT PASSES IS NOT A RE-PIN, IT IS A SILENCER.**
 *
 * `the-cast-goes-to-war.spec.ts` and `the-cast-forms-a-coalition.spec.ts` have both been re-pinned
 * twice (`g10` → `g05`), and the file already carries the lesson from the last time: **no seed of 34
 * scanned still detected the `crewMove` deletion by going silent**, so that coverage had to become
 * an explicit assertion (`CREW_MOVE_FLOOR`) rather than a seed that happened to go quiet. A pin
 * chosen because it is green tells you only that it is green.
 *
 * So this prints the **whole scan** — every candidate and every property, pass or fail — and the
 * spec quotes the table. Three things then become visible that a search hides:
 *
 *   1. how many candidates satisfy the property at all (if it is 1 of 40, the property is a
 *      coincidence and the assertion is the wrong shape);
 *   2. whether the property survived the change at all, or whether every seed lost it (in which case
 *      the honest fix is an assertion about the mechanism, not a new seed);
 *   3. which seeds are near-misses, so the next person re-pinning has the data rather than the
 *      conclusion.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `npx tsx scripts/war-seed-scan.ts [count]` — 900 ticks per seed, ~85 s each.
 */

import { setSpeed } from '../src/core/time.js';
import { HeuristicCast } from '../src/cast/index.js';
import { Runtime } from '../src/sim/runtime.js';

interface Reading {
  readonly seed: string;
  /** A battle reached CONTEST — two sides actually met. */
  readonly contest: boolean;
  /** Hulls destroyed, permanently, on the record. */
  readonly wrecks: number;
  /** The richest `battleLines` any PUBLISHED frame carried. */
  readonly lines: number;
  /** …of which carried a RAIDER **and** a DEFENDER formation. The pixel signature A13 asks for. */
  readonly twoSided: number;
  /** `engage` count — the number `CREW_MOVE_FLOOR` is asserted against. */
  readonly engage: number;
}

const STATES = ['MUSTER', 'CONTACT', 'CONTEST', 'BREAK', 'AFTERMATH'] as const;

function play(seed: string, ticks: number): Reading {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size: 8 });
  cast.seat(seed);

  let deepest = 0;
  let engage = 0;
  const seenWreck = new Set<string>();
  let lines = 0;
  let twoSided = 0;

  for (let n = 0; n < ticks; n += 1) {
    const tick = runtime.engine.tick + 1;
    for (const action of cast.decide(tick, seed)) runtime.engine.submit(action);
    const report = runtime.runTick();
    if (report.halted) throw new Error(`${seed} halted at ${String(report.tick)}`);
    for (const entry of runtime.engine.log.forTick(report.tick)) {
      if (entry.outcome !== 'REFUSED' && entry.verb === 'engage') engage += 1;
    }
    for (const record of runtime.battles.all()) {
      deepest = Math.max(deepest, STATES.indexOf(record.state));
      // Accumulated inside the loop: `Book.prune` drops settled engagements and their wrecks with
      // them, so a tally read at the end reports zero on a run that destroyed nine hulls.
      for (const wreck of record.wrecks) seenWreck.add(`${record.id}:${wreck.hand}:${String(wreck.tick)}`);
    }
    const frame = runtime.reckoningFrame();
    if (frame !== null && frame.battleLines.length > lines) {
      lines = frame.battleLines.length;
      twoSided = frame.battleLines.filter(
        (line) =>
          line.formations.some((f) => f.side === 'RAIDER') &&
          line.formations.some((f) => f.side === 'DEFENDER'),
      ).length;
    }
  }

  return {
    seed,
    contest: deepest >= STATES.indexOf('CONTEST'),
    wrecks: seenWreck.size,
    lines,
    twoSided,
    engage,
  };
}

function main(): void {
  const count = Number(process.argv[2] ?? '24');
  // The candidate pool is the seeds this repo already uses plus a generated tail, so the scan can be
  // compared with the previous two re-pins rather than starting from a fresh namespace.
  const named = ['fz-13', 'g05', 'g10', 'g24', 'g01', 'g02', 'g03', 'g06', 'g07', 'g08'];
  const generated = Array.from({ length: Math.max(0, count - named.length) }, (_, i) => `w-${String(i)}`);
  const seeds = [...named, ...generated];

  console.log('seed       CONTEST  wrecks  lines  two-sided  engage   qualifies');
  const qualifying: string[] = [];
  for (const seed of seeds) {
    let r: Reading;
    try {
      r = play(seed, 900);
    } catch (err) {
      console.log(`${seed.padEnd(10)} ERROR ${String(err)}`);
      continue;
    }
    // The property `LINE_SEEDS` exists to cover: a two-sided battle line on a frame published at a
    // settlement tick, with a real wreck behind it.
    const ok = r.contest && r.wrecks > 0 && r.twoSided > 0;
    if (ok) qualifying.push(seed);
    console.log(
      `${r.seed.padEnd(10)} ${String(r.contest).padEnd(7)} ${String(r.wrecks).padStart(6)} ` +
        `${String(r.lines).padStart(6)} ${String(r.twoSided).padStart(10)} ${String(r.engage).padStart(7)}   ${ok ? '★ yes' : 'no'}`,
    );
  }
  console.log(`\n${String(qualifying.length)} of ${String(seeds.length)} qualify: ${qualifying.join(', ')}`);
  console.log(
    qualifying.length === 0
      ? '⚑ NO SEED CARRIES THE PROPERTY. Do not widen the pool — the fix is an ASSERTION about the\n' +
          '  mechanism, the way CREW_MOVE_FLOOR replaced a seed that no longer went silent.'
      : '★ Pin from this table, and paste the table into the spec so the next re-pin has the data.',
  );
}

main();
