#!/usr/bin/env node
/**
 * FOUR-ROLE PROBE — does the world produce four-role ventures, do they FORM, and what do they
 * cost the economy? (`RULES_VERSION` 41)
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A design review (2026-10-01) found **no venture with four or more roles had ever occurred in the
 * live world**. `scripts/formation-probe.ts` plays the part of an outside agent opening BUILDs; this
 * file asks the other question — whether a world NOBODY steers authors and fills them — and prints
 * the denominator `balance-gate.ts`'s own header demands of a landing: how often the mechanism was
 * ASKED (created), how often it BOUND (reached LIVE), and how it ended, beside the meters it must not
 * move (`levyShort`, kept/broken). `--top-yield-off` reruns the same seeds with the branch disabled, so
 * the cost of the change is a column rather than a claim.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ```
 * npx tsx scripts/four-role-probe.ts --seeds-from g --count 4 --reckonings 3 --members 12
 * npx tsx scripts/four-role-probe.ts --seeds-from g --count 4 --reckonings 3 --members 12 --top-yield-off
 * npx tsx scripts/four-role-probe.ts --seeds-from g --count 6 --reckonings 3 --members 12 --top-yield-bps 200
 * ```
 *
 * `--top-yield-bps N` sets `CastOptions.topYieldChanceBps` (default `DEFAULT_TOP_YIELD_CHANCE_BPS`), so the
 * calibration figures quoted on that constant are reproducible from this file rather than recalled;
 * `--top-yield-off` is `--top-yield-bps 0`.
 */

import { HeuristicCast } from '../src/cast/index.js';
import { isSettlementTick, setSpeed, TICKS_PER_RECKONING } from '../src/core/time.js';
import { Runtime } from '../src/sim/runtime.js';
import { isTopYield } from '../src/venture/index.js';

interface Row {
  readonly seed: string;
  readonly created: number;
  readonly byCast: number;
  readonly formed: number;
  readonly settled: number;
  readonly defaulted: number;
  readonly abandoned: number;
  readonly open: number;
  readonly fullyFilled: number;
  readonly fillers: number;
  readonly levyShort: number;
  readonly kept: number;
  readonly broken: number;
  readonly ventures: number;
  readonly halted: boolean;
}

function runOne(seed: string, ticks: number, members: number, topYieldBps: number | null): Row {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size: members, ...(topYieldBps === null ? {} : { topYieldChanceBps: topYieldBps }) });
  cast.seat(seed);
  const castIds = new Set(cast.roster.map((m) => String(m.principal)));
  let levyShort = 0;
  let halted = false;
  const everFormed = new Set<string>();
  const everFull = new Set<string>();
  const fillers = new Set<string>();
  for (let n = 0; n < ticks; n += 1) {
    const target = runtime.engine.tick + 1;
    for (const action of cast.decide(target, seed)) runtime.engine.submit(action);
    const report = runtime.runTick();
    if (report.halted) {
      halted = true;
      break;
    }
    for (const v of runtime.ventures.live()) {
      if (!isTopYield(v.kind)) continue;
      if (v.state === 'LIVE') everFormed.add(v.id);
      if (v.roles.every((r) => r.filledByPrincipal !== null)) everFull.add(v.id);
      for (const r of v.roles) if (r.filledByPrincipal !== null) fillers.add(String(r.filledByPrincipal));
    }
    if (isSettlementTick(report.tick)) levyShort += runtime.levySettlement?.levyShort ?? 0;
  }
  const fourRole = runtime.ventures.all().filter((v) => isTopYield(v.kind));
  const standings = runtime.standing.rows();
  return {
    seed,
    created: fourRole.length,
    byCast: fourRole.filter((v) => castIds.has(String(v.creator))).length,
    formed: fourRole.filter((v) => everFormed.has(v.id) || v.state === 'SETTLED' || v.state === 'DEFAULTED').length,
    settled: fourRole.filter((v) => v.state === 'SETTLED').length,
    defaulted: fourRole.filter((v) => v.state === 'DEFAULTED').length,
    abandoned: fourRole.filter((v) => v.state === 'ABANDONED').length,
    open: fourRole.filter((v) => v.state === 'FORMING' || v.state === 'LIVE' || v.state === 'DEFERRED').length,
    fullyFilled: fourRole.filter((v) => everFull.has(v.id)).length,
    fillers: fillers.size,
    levyShort,
    kept: standings.reduce((n, s) => n + s.electiveHonoured, 0),
    broken: standings.reduce((n, s) => n + s.defaults, 0),
    ventures: runtime.ventures.size,
    halted,
  };
}

function parse(argv: readonly string[]): {
  readonly seeds: readonly string[];
  readonly ticks: number;
  readonly members: number;
  readonly topYieldBps: number | null;
} {
  let seeds: string[] = ['g01', 'g02', 'g03', 'g04'];
  let reckonings = 3;
  let members = 12;
  let topYieldBps: number | null = null;
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
      case '--reckonings':
        reckonings = Number.parseInt(value, 10);
        i += 1;
        break;
      case '--members':
        members = Number.parseInt(value, 10);
        i += 1;
        break;
      case '--top-yield-off':
        topYieldBps = 0;
        break;
      case '--top-yield-bps':
        topYieldBps = Number.parseInt(value, 10);
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
  return { seeds, ticks: reckonings * TICKS_PER_RECKONING, members, topYieldBps };
}

const args = parse(process.argv.slice(2));
process.stdout.write(
  `four-role venture probe — ${String(args.seeds.length)} seeds x ${String(args.ticks)} ticks x ` +
    `${String(args.members)} members` +
    `${args.topYieldBps === null ? '' : args.topYieldBps === 0 ? ' (four-role branch OFF)' : ` (four-role ${String(args.topYieldBps)} bps)`}\n\n` +
    'seed     created byCast formed settled dflt aband open full fillers  levyShort  kept broken ventures\n',
);
const rows: Row[] = [];
for (const seed of args.seeds) {
  const r = runOne(seed, args.ticks, args.members, args.topYieldBps);
  rows.push(r);
  process.stdout.write(
    `${seed.padEnd(8)} ${String(r.created).padStart(7)} ${String(r.byCast).padStart(6)} ${String(r.formed).padStart(6)} ` +
      `${String(r.settled).padStart(7)} ${String(r.defaulted).padStart(4)} ${String(r.abandoned).padStart(5)} ` +
      `${String(r.open).padStart(4)} ${String(r.fullyFilled).padStart(4)} ${String(r.fillers).padStart(7)} ` +
      `${String(r.levyShort).padStart(10)} ${String(r.kept).padStart(5)} ${String(r.broken).padStart(6)} ` +
      `${String(r.ventures).padStart(8)}${r.halted ? '  HALTED' : ''}\n`,
  );
}
const sum = (f: (r: Row) => number): number => rows.reduce((n, r) => n + f(r), 0);
const total = {
  created: sum((r) => r.created),
  byCast: sum((r) => r.byCast),
  formed: sum((r) => r.formed),
  settled: sum((r) => r.settled),
  defaulted: sum((r) => r.defaulted),
  abandoned: sum((r) => r.abandoned),
  fullyFilled: sum((r) => r.fullyFilled),
  levyShort: sum((r) => r.levyShort),
  kept: sum((r) => r.kept),
  broken: sum((r) => r.broken),
  ventures: sum((r) => r.ventures),
  halted: rows.filter((r) => r.halted).length,
};
process.stdout.write(`\nRESULT ${JSON.stringify(total)}\n`);
