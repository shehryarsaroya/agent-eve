#!/usr/bin/env node
/**
 * THE BALANCE GATE, as an instrument instead of as a paragraph somebody re-derives.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHY THIS FILE EXISTS.** `TRACKER.md` has published the same nine-row table three times —
 * `levyShort` · red tribute lines · `kept` · `broken` · ventures · live claims · rent ·
 * hulls · battles, master against a branch, N seeds each — and every one of those tables was
 * produced by a throwaway script that no longer exists. So the numbers could not be
 * reproduced, the seed sets differed between passes, and the *shape* of the comparison had
 * to be re-argued each time. A gate nobody can re-run is a claim, not a gate.
 *
 * Two properties are the whole design:
 *
 *   - **`--reckonings`, not `--ticks`.** Every sweep in this project's history ran 900 ticks
 *     — about three Reckonings — and `test/works/the-window-closes.spec.ts` records what that
 *     cost: the endowment window closes at Reckoning 5, so a 900-tick sweep is structurally
 *     incapable of seeing any gate priced in produced goods. The default is 3 to reproduce
 *     the historical table; **6 is the one that matters** and it is one flag away instead of
 *     a rewrite.
 *   - **`TRAPPED` is a first-class meter.** A principal that is rich in currency and cannot
 *     buy into the goods economy is the failure this instrument was built to see, and a
 *     balance table that reported ventures and rent while that number climbed would report a
 *     healthy world every time.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ```
 * npx tsx scripts/balance-gate.ts --seeds g01,g02 --reckonings 6 --members 8
 * npx tsx scripts/balance-gate.ts --seeds-from g --count 8            # g01..g08
 * ```
 *
 * Output is one row per seed plus a TOTAL row, on stdout, plus a machine-readable
 * `RESULT <json>` line so a sweep can be diffed between two checkouts without eyeballing.
 */

import { HeuristicCast } from '../src/cast/index.js';
import { setSpeed, TICKS_PER_RECKONING } from '../src/core/time.js';
import { holdingOf } from '../src/world/index.js';
import { Runtime } from '../src/sim/runtime.js';

interface GateRow {
  readonly seed: string;
  readonly halted: boolean;
  readonly levyShort: number;
  readonly redTributeLines: number;
  readonly tributeLines: number;
  readonly kept: number;
  readonly broken: number;
  readonly ventures: number;
  readonly claims: number;
  readonly rent: number;
  readonly hulls: number;
  readonly battles: number;
  readonly works: number;
  /** Members holding no WORKS and rich enough in currency to buy one. The trap. */
  readonly trapped: number;
  readonly finalStateHash: string;
}

function runOne(seed: string, ticks: number, members: number): GateRow {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size: members });
  const roster = cast.seat(seed);

  let halted = false;
  let redTributeLines = 0;
  let tributeLines = 0;
  let finalStateHash = '';
  for (let i = 0; i < ticks; i += 1) {
    const next = runtime.engine.tick + 1;
    for (const action of cast.decide(next, seed)) runtime.engine.submit(action);
    const report = runtime.runTick();
    finalStateHash = report.stateHash;
    // Sampled in the freeze, which is where the published frame is drawn from and therefore
    // the only reading a viewer ever sees. Counted CUMULATIVELY across Reckonings rather than
    // read once at the end: one red line on Reckoning 2 is the finding even if Reckoning 6
    // is clean, and a last-look reading would silently drop it.
    if (report.clock.inFreeze) {
      for (const line of runtime.tributeLines(report.tick)) {
        tributeLines += 1;
        if (line.state === 'RED') redTributeLines += 1;
      }
    }
    if (report.halted) {
      halted = true;
      break;
    }
  }

  const summaries = runtime.reckonings();
  const levyShort = runtime.levyReckonings().reduce((n, r) => n + r.shortMinor, 0);
  const kept = summaries.reduce((n, r) => n + r.electiveHonoured, 0);
  const broken = summaries.reduce((n, r) => n + r.defaults, 0);
  const rent = runtime.works.liveInOrder().reduce((n, w) => n + w.rentPaid, 0);

  let trapped = 0;
  for (const member of roster) {
    if (runtime.works.ofPrincipal(member.principal).length > 0) continue;
    const quote = runtime.worksQuote(member.principal, holdingOf(runtime.world, member.principal).system);
    if (quote.freeMinor >= quote.costMinor && !quote.affordable) trapped += 1;
  }

  return {
    seed,
    halted,
    levyShort,
    redTributeLines,
    tributeLines,
    kept,
    broken,
    ventures: runtime.ventures.size,
    claims: runtime.sovereignty.liveClaims().length,
    rent,
    hulls: runtime.fleet.all().length,
    battles: runtime.battles.all().length,
    works: runtime.works.liveInOrder().length,
    trapped,
    finalStateHash,
  };
}

function parse(argv: readonly string[]): {
  readonly seeds: readonly string[];
  readonly ticks: number;
  readonly members: number;
} {
  let seeds: string[] = ['gate-a', 'gate-b', 'gate-c', 'gate-d'];
  let reckonings = 3;
  /** `--ticks` overrides, because the historical table is 900 ticks and 900 is not a multiple of 288. */
  let ticks: number | null = null;
  let members = 8;
  let prefix: string | null = null;
  let count = 8;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === undefined) continue;
    if (value === undefined) throw new Error(`${flag} needs a value`);
    switch (flag) {
      case '--seeds':
        seeds = value.split(',');
        break;
      case '--seeds-from':
        prefix = value;
        break;
      case '--count':
        count = Number.parseInt(value, 10);
        break;
      case '--reckonings':
        reckonings = Number.parseInt(value, 10);
        break;
      case '--ticks':
        ticks = Number.parseInt(value, 10);
        break;
      case '--members':
        members = Number.parseInt(value, 10);
        break;
      default:
        throw new Error(`unknown flag ${flag}`);
    }
    i += 1;
  }
  if (prefix !== null) {
    seeds = [];
    for (let n = 1; n <= count; n += 1) seeds.push(`${prefix}${String(n).padStart(2, '0')}`);
  }
  return { seeds, ticks: ticks ?? reckonings * TICKS_PER_RECKONING, members };
}

const args = parse(process.argv.slice(2));
process.stdout.write(
  `balance gate — ${String(args.seeds.length)} seeds x ${String(args.ticks)} ticks ` +
    `(${String(Math.floor(args.ticks / TICKS_PER_RECKONING))} Reckonings) x ${String(args.members)} members\n\n`,
);
process.stdout.write(
  'seed        levyShort  red/lines   kept broken  ventures claims     rent hulls battles works TRAPPED\n',
);
const rows: GateRow[] = [];
for (const seed of args.seeds) {
  const row = runOne(seed, args.ticks, args.members);
  rows.push(row);
  process.stdout.write(
    `${seed.padEnd(11)} ${String(row.levyShort).padStart(9)}  ` +
      `${`${String(row.redTributeLines)}/${String(row.tributeLines)}`.padStart(9)} ` +
      `${String(row.kept).padStart(6)} ${String(row.broken).padStart(6)} ` +
      `${String(row.ventures).padStart(9)} ${String(row.claims).padStart(6)} ` +
      `${String(row.rent).padStart(8)} ${String(row.hulls).padStart(5)} ` +
      `${String(row.battles).padStart(7)} ${String(row.works).padStart(5)} ` +
      `${String(row.trapped).padStart(7)}${row.halted ? '  HALTED' : ''}\n`,
  );
}
const sum = (pick: (r: GateRow) => number): number => rows.reduce((n, r) => n + pick(r), 0);
const total = {
  seeds: rows.length,
  ticks: args.ticks,
  members: args.members,
  halted: rows.filter((r) => r.halted).length,
  levyShort: sum((r) => r.levyShort),
  redTributeLines: sum((r) => r.redTributeLines),
  tributeLines: sum((r) => r.tributeLines),
  kept: sum((r) => r.kept),
  broken: sum((r) => r.broken),
  ventures: sum((r) => r.ventures),
  claims: sum((r) => r.claims),
  rent: sum((r) => r.rent),
  hulls: sum((r) => r.hulls),
  battles: sum((r) => r.battles),
  works: sum((r) => r.works),
  trapped: sum((r) => r.trapped),
};
process.stdout.write(
  `${'TOTAL'.padEnd(11)} ${String(total.levyShort).padStart(9)}  ` +
    `${`${String(total.redTributeLines)}/${String(total.tributeLines)}`.padStart(9)} ` +
    `${String(total.kept).padStart(6)} ${String(total.broken).padStart(6)} ` +
    `${String(total.ventures).padStart(9)} ${String(total.claims).padStart(6)} ` +
    `${String(total.rent).padStart(8)} ${String(total.hulls).padStart(5)} ` +
    `${String(total.battles).padStart(7)} ${String(total.works).padStart(5)} ` +
    `${String(total.trapped).padStart(7)}\n`,
);
process.stdout.write(`\nRESULT ${JSON.stringify(total)}\n`);
