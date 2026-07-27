/**
 * **THE §9 BALANCE GATE, AS ONE INSTRUMENT.** Run a world nobody steers and print the twelve
 * numbers a predation or combat change has to be judged against.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * `TRACKER.md`'s balance table (`levyShort` · red tribute lines · `kept` · `broken` · ventures ·
 * live claims · rent · hulls · battles · world hulls killed) was produced by an **ad-hoc harness
 * that was never committed**, so the next agent to touch §9 had a baseline it could read and no way
 * to reproduce. That is this project's signature defect wearing a measurement: a number nobody can
 * re-derive is indistinguishable from one nobody took.
 *
 * `sim --ticks 900` cannot answer it either — the CLI summary carries `levyShort`, ventures and the
 * freeze histogram, and **none** of `kept`, `broken`, claims, rent, hulls, battles or raid outcomes
 * by kind. `scripts/combat-sim.ts` answers the opposite question: it *supplies* the combat decision
 * so the mechanic can be measured in isolation. This one supplies nothing. It runs the heuristic
 * cast exactly as `sim` does and reports what that world did to itself.
 *
 * ── THE COLUMN THE GATE TURNS ON ────────────────────────────────────────────
 *
 * **Raid outcomes by kind, and `fight` split by what it produced.** A change that makes raids
 * winnable shows up here first and everywhere else second: `f→rep` climbing while `f→plu` stays
 * non-zero is *"committing a competent fleet can win"*; `f→plu` reaching zero is the
 * over-correction A14 forbids, because a mechanic with no losing branch has no drama and the Levy's
 * raid pressure evaporates.
 *
 * Run: `npx tsx scripts/raid-balance.ts [ticks] [members] [seeds...]`
 */

import { HeuristicCast } from '../src/cast/index.js';
import { setSpeed } from '../src/core/time.js';
import { WORLD_PRINCIPAL } from '../src/combat/index.js';
import { Runtime } from '../src/sim/runtime.js';

setSpeed('instant');

const TICKS = Number(process.argv[2] ?? '900');
const MEMBERS = Number(process.argv[3] ?? '8');
const SEEDS =
  process.argv.slice(4).length > 0
    ? process.argv.slice(4)
    : ['g01', 'g02', 'g03', 'g04', 'g05', 'g06', 'g07', 'g08'];

interface Row {
  readonly seed: string;
  readonly levyShort: number;
  readonly red: number;
  readonly tributeLines: number;
  readonly kept: number;
  readonly broken: number;
  readonly ventures: number;
  readonly claims: number;
  readonly rent: number;
  readonly hulls: number;
  readonly battles: number;
  readonly worldKilled: number;
  readonly oursKilled: number;
  /** Raid outcomes by kind, accumulated per tick because the book prunes. */
  readonly byState: Readonly<Record<string, number>>;
  readonly fights: number;
  readonly yields: number;
  /** `fight` answers by what the standoff then resolved as. The gate's own column. */
  readonly fightRepulsed: number;
  readonly fightPlundered: number;
  readonly fightOther: number;
}

const STATES = ['DEMANDED', 'REPULSED', 'PLUNDERED', 'PAID', 'MISSED'] as const;

function play(seed: string, ticks: number, size: number): Row {
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size });
  cast.seat(seed);

  let hulls = 0;
  let fights = 0;
  let yields = 0;
  let worldKilled = 0;
  let oursKilled = 0;
  const battles = new Set<string>();
  const seenWreck = new Set<string>();
  // Accumulated per tick: `predation/book.ts` prunes settled rows, so a tally read at the end of a
  // long run reports a quiet season on a world that fought one. Same reason
  // `the-cast-goes-to-war.spec.ts` accumulates its wrecks inside the loop.
  const finalState = new Map<string, string>();
  const answerOf = new Map<string, string>();

  for (let n = 0; n < ticks; n += 1) {
    const tick = runtime.engine.tick + 1;
    for (const action of cast.decide(tick, seed)) runtime.engine.submit(action);
    const report = runtime.runTick();
    if (report.halted) {
      throw new Error(
        `HALTED at ${String(report.tick)}: ${report.violations.map((v) => `${v.id} ${v.message}`).join(' | ')}`,
      );
    }

    for (const entry of runtime.engine.log.forTick(report.tick)) {
      if (entry.outcome === 'REFUSED') continue;
      const params = entry.params as Record<string, unknown>;
      if (entry.verb === 'build' && params['kind'] === 'HULL') hulls += 1;
      if (entry.verb === 'fight') {
        fights += 1;
        answerOf.set(String(params['raid']), 'fight');
      }
      if (entry.verb === 'yield') {
        yields += 1;
        answerOf.set(String(params['raid']), 'yield');
      }
    }

    for (const raid of runtime.raids.all()) finalState.set(raid.id, raid.state);
    for (const record of runtime.battles.all()) {
      battles.add(record.id);
      for (const wreck of record.wrecks) {
        const key = `${record.id}:${wreck.hand}:${String(wreck.tick)}`;
        if (seenWreck.has(key)) continue;
        seenWreck.add(key);
        if (wreck.principal === WORLD_PRINCIPAL) worldKilled += 1;
        else oursKilled += 1;
      }
    }
  }

  const frame = runtime.reckoningFrame();
  const byState: Record<string, number> = {};
  for (const state of STATES) byState[state] = 0;
  let fightRepulsed = 0;
  let fightPlundered = 0;
  let fightOther = 0;
  for (const [raid, state] of finalState) {
    byState[state] = (byState[state] ?? 0) + 1;
    if (answerOf.get(raid) !== 'fight') continue;
    if (state === 'REPULSED') fightRepulsed += 1;
    else if (state === 'PLUNDERED') fightPlundered += 1;
    else fightOther += 1;
  }

  return {
    seed,
    levyShort: Number(frame?.meters.levyShort ?? -1),
    red: (frame?.tributeLines ?? []).filter((l) => l.state === 'RED').length,
    tributeLines: (frame?.tributeLines ?? []).length,
    kept: frame?.meters.kept ?? -1,
    broken: frame?.meters.broken ?? -1,
    ventures: runtime.ventures.size,
    claims: (frame?.claimLines ?? []).length,
    rent: runtime.worksLines(runtime.engine.tick).reduce((n, w) => n + w.rentPaid, 0),
    hulls,
    battles: battles.size,
    worldKilled,
    oursKilled,
    byState,
    fights,
    yields,
    fightRepulsed,
    fightPlundered,
    fightOther,
  };
}

const HEAD =
  'seed    levyShort  red/lines  kept broken  ventures claims     rent  hulls battles wKill oKill  ' +
  'REP PLU PAID MISS LIVE  FIGHT YIELD  f→rep f→plu';

console.log(`\n════════ §9 BALANCE GATE · ${String(TICKS)} ticks × ${String(MEMBERS)} members ════════`);
console.log(HEAD);

const rows: Row[] = [];
for (const seed of SEEDS) {
  const row = play(seed, TICKS, MEMBERS);
  rows.push(row);
  console.log(
    `${seed.padEnd(7)} ${String(row.levyShort).padStart(9)}  ${String(row.red).padStart(3)}/${String(row.tributeLines).padEnd(5)} ` +
      `${String(row.kept).padStart(4)} ${String(row.broken).padStart(6)}  ${String(row.ventures).padStart(8)} ` +
      `${String(row.claims).padStart(6)} ${String(row.rent).padStart(8)}  ${String(row.hulls).padStart(5)} ` +
      `${String(row.battles).padStart(7)} ${String(row.worldKilled).padStart(5)} ${String(row.oursKilled).padStart(5)}  ` +
      `${String(row.byState['REPULSED'] ?? 0).padStart(3)} ${String(row.byState['PLUNDERED'] ?? 0).padStart(3)} ` +
      `${String(row.byState['PAID'] ?? 0).padStart(4)} ${String(row.byState['MISSED'] ?? 0).padStart(4)} ` +
      `${String(row.byState['DEMANDED'] ?? 0).padStart(4)}  ${String(row.fights).padStart(5)} ${String(row.yields).padStart(5)}  ` +
      `${String(row.fightRepulsed).padStart(5)} ${String(row.fightPlundered).padStart(5)}`,
  );
}

const sum = (pick: (row: Row) => number): number => rows.reduce((n, row) => n + pick(row), 0);
const state = (name: string): number => rows.reduce((n, row) => n + (row.byState[name] ?? 0), 0);
console.log(
  `TOTAL   ${String(sum((r) => r.levyShort)).padStart(9)}  ${String(sum((r) => r.red)).padStart(3)}/${String(sum((r) => r.tributeLines)).padEnd(5)} ` +
    `${String(sum((r) => r.kept)).padStart(4)} ${String(sum((r) => r.broken)).padStart(6)}  ` +
    `${String(sum((r) => r.ventures)).padStart(8)} ${String(sum((r) => r.claims)).padStart(6)} ` +
    `${String(sum((r) => r.rent)).padStart(8)}  ${String(sum((r) => r.hulls)).padStart(5)} ` +
    `${String(sum((r) => r.battles)).padStart(7)} ${String(sum((r) => r.worldKilled)).padStart(5)} ` +
    `${String(sum((r) => r.oursKilled)).padStart(5)}  ${String(state('REPULSED')).padStart(3)} ` +
    `${String(state('PLUNDERED')).padStart(3)} ${String(state('PAID')).padStart(4)} ${String(state('MISSED')).padStart(4)} ` +
    `${String(state('DEMANDED')).padStart(4)}  ${String(sum((r) => r.fights)).padStart(5)} ` +
    `${String(sum((r) => r.yields)).padStart(5)}  ${String(sum((r) => r.fightRepulsed)).padStart(5)} ` +
    `${String(sum((r) => r.fightPlundered)).padStart(5)}`,
);
console.log('');
