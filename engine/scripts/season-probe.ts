#!/usr/bin/env node
/**
 * SEASON PROBE — a heuristic world from genesis through Season 1's boundary, and every figure the
 * launch fixes' cast change was judged on.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * The integrated Season 1 tree measured a 12-member season on `fs-a` at 1,465 ventures opened and 1,252
 * abandoned unfilled, and the cast change that closes it (`HeuristicCast.createCanFill`) was accepted on
 * the condition that settled ventures and kept promises do not fall. So this prints both halves side by
 * side, per seed and in total: what the board opened and how it ended, the elective promises kept and
 * broken, the four-role BUILDs, the grand venture's verdict, and the Levy shortfall Reckoning by Reckoning.
 *
 * It reads only APIs that predate the change, so the same file run on an older tree is the "before".
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ```
 * npx tsx scripts/season-probe.ts --seeds fs-a,fs-b,g01
 * npx tsx scripts/season-probe.ts --seeds-from g --count 7 --members 12
 * ```
 */

import { HeuristicCast } from '../src/cast/index.js';
import { isSettlementTick, setSpeed } from '../src/core/time.js';
import { finaleTickOf } from '../src/season/index.js';
import { Runtime } from '../src/sim/runtime.js';
import { isTopYield } from '../src/venture/index.js';

interface Row {
  readonly seed: string;
  readonly opened: number;
  readonly settled: number;
  readonly defaulted: number;
  readonly abandonedUnfilled: number;
  readonly open: number;
  readonly kept: number;
  readonly broken: number;
  readonly buildsOpened: number;
  readonly buildsSettled: number;
  readonly grand: string;
  readonly levyShort: readonly number[];
  readonly violations: number;
  readonly halted: boolean;
}

function runOne(seed: string, members: number): Row {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size: members });
  cast.seat(seed);
  const end = finaleTickOf(1) + 48;
  const levyShort: number[] = [];
  let violations = 0;
  let halted = false;
  while (runtime.engine.tick < end) {
    for (const action of cast.decide(runtime.engine.tick + 1, seed)) runtime.engine.submit(action);
    const report = runtime.runTick();
    violations += report.violations.length;
    if (report.halted) {
      halted = true;
      break;
    }
    if (isSettlementTick(report.tick)) levyShort.push(Number(runtime.levySettlement?.levyShort ?? 0));
  }
  const all = runtime.ventures.all();
  const builds = all.filter((v) => v.grand === null && isTopYield(v.kind));
  const record = runtime.seasons.last();
  const grand =
    record === undefined || record === null
      ? 'none'
      : `${record.grand.outcome}${record.grand.creator === null ? '' : ` ${String(record.grand.creator)}`} ` +
        `${String(Number(record.grand.proceedsMinor))} unpaid ` +
        `${String(record.grand.crew.filter((c) => Number(c.paidMinor) < Number(c.dueMinor)).length)}`;
  const standings = runtime.standing.rows();
  return {
    seed,
    opened: all.length,
    settled: all.filter((v) => v.state === 'SETTLED').length,
    defaulted: all.filter((v) => v.state === 'DEFAULTED').length,
    abandonedUnfilled: all.filter(
      (v) => v.state === 'ABANDONED' && v.roles.some((r) => r.filledByPrincipal === null),
    ).length,
    open: all.filter((v) => v.state === 'FORMING' || v.state === 'LIVE' || v.state === 'DEFERRED').length,
    kept: standings.reduce((n, s) => n + s.electiveHonoured, 0),
    broken: standings.reduce((n, s) => n + s.defaults, 0),
    buildsOpened: builds.length,
    buildsSettled: builds.filter((v) => v.state === 'SETTLED').length,
    grand,
    levyShort,
    violations,
    halted,
  };
}

function parse(argv: readonly string[]): { readonly seeds: readonly string[]; readonly members: number } {
  let seeds: string[] = ['fs-a', 'fs-b', 'g01'];
  let members = 12;
  let from: string | null = null;
  let count = 4;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i] ?? '';
    const value = argv[i + 1] ?? '';
    switch (flag) {
      case '--seeds':
        seeds = value.split(',').filter((s) => s.length > 0);
        i += 1;
        break;
      case '--seeds-from':
        from = value;
        i += 1;
        break;
      case '--count':
        count = Number.parseInt(value, 10);
        i += 1;
        break;
      case '--members':
        members = Number.parseInt(value, 10);
        i += 1;
        break;
      default:
        break;
    }
  }
  if (from !== null) {
    seeds = [];
    for (let n = 1; n <= count; n += 1) seeds.push(`${from}${String(n).padStart(2, '0')}`);
  }
  return { seeds, members };
}

const args = parse(process.argv.slice(2));
process.stdout.write(
  `season probe — ${String(args.seeds.length)} seeds x one season from genesis x ${String(args.members)} members\n\n` +
    'seed           opened settled dflt abandUnfilled open  kept broken builds  levyShort  grand\n',
);
const rows: Row[] = [];
for (const seed of args.seeds) {
  const r = runOne(seed, args.members);
  rows.push(r);
  const short = r.levyShort.reduce((a, b) => a + b, 0);
  process.stdout.write(
    `${seed.padEnd(14)} ${String(r.opened).padStart(6)} ${String(r.settled).padStart(7)} ${String(r.defaulted).padStart(4)} ` +
      `${String(r.abandonedUnfilled).padStart(13)} ${String(r.open).padStart(4)} ${String(r.kept).padStart(5)} ` +
      `${String(r.broken).padStart(6)} ${`${String(r.buildsOpened)}/${String(r.buildsSettled)}`.padStart(6)} ` +
      `${String(short).padStart(10)}  ${r.grand}${r.halted ? '  HALTED' : ''}${r.violations > 0 ? `  ${String(r.violations)} violations` : ''}\n` +
      `${''.padEnd(14)} levyShort by Reckoning: ${r.levyShort.join(' ')}\n`,
  );
}
const sum = (f: (r: Row) => number): number => rows.reduce((n, r) => n + f(r), 0);
process.stdout.write(
  `\nRESULT ${JSON.stringify({
    seeds: rows.length,
    opened: sum((r) => r.opened),
    settled: sum((r) => r.settled),
    defaulted: sum((r) => r.defaulted),
    abandonedUnfilled: sum((r) => r.abandonedUnfilled),
    kept: sum((r) => r.kept),
    broken: sum((r) => r.broken),
    buildsOpened: sum((r) => r.buildsOpened),
    buildsSettled: sum((r) => r.buildsSettled),
    levyShort: sum((r) => r.levyShort.reduce((a, b) => a + b, 0)),
    violations: sum((r) => r.violations),
    halted: rows.filter((r) => r.halted).length,
  })}\n`,
);
