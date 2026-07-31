#!/usr/bin/env node
/**
 * FORMATION PROBE — do **four-role** ventures ever fill, and if not, how close do they get?
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **NOTHING IN `scripts/` COULD TELL "FOUR-ROLE VENTURES NEVER FORM" FROM "FOUR-ROLE VENTURES
 * NEVER EXIST", AND THE TWO NEED OPPOSITE FIXES.**
 *
 * `balance-gate.ts` prints `ventures: runtime.ventures.size` — every venture in every state, no
 * breakdown by kind and none by outcome. So a world in which BUILD is created and abandoned and a
 * world in which BUILD is never created at all produce the identical column, and the project's
 * signature defect gets to hide inside its own instrument.
 *
 * `src/cast/heuristic.ts`'s `CREATES` table maps its four bot roles onto `DIG | HAUL | ESCORT |
 * RAID`, **all two-role kinds**, so in a world nobody steers a four-role kind is never authored and
 * the fill path is never asked. That is a cast defect and it is deliberately NOT fixed by giving
 * the cast a `BUILD` branch: a top-yield kind is wholly un-escrowable (40,000 of pure elective
 * liability, `venture/terms.ts`), so seeding one into the cast's economics would move `levyShort`
 * and the tribute lines and confound the very measurement this file exists to take.
 *
 * Instead this probe **plays the part of the agent** — it submits `create {kind:'BUILD'}` through
 * the verb table exactly as a probe identity did when it reported the defect — and then lets the
 * heuristic cast do, or fail to do, the filling. That isolates *fillability* from *authorship*,
 * which are the two halves the single number could not separate.
 *
 * `ROLES` is the column that matters: the greatest number of roles a BUILD ever had filled at once.
 * A world where that is 3 of 4 for every venture is a world with a structurally unsatisfiable gate,
 * and a world where it is 0 is a world where nothing is bidding at all — again, opposite fixes.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ```
 * npx tsx scripts/formation-probe.ts --seeds-from g --count 8 --reckonings 3 --members 12
 * ```
 */

import { HeuristicCast } from '../src/cast/index.js';
import { setSpeed, TICKS_PER_RECKONING } from '../src/core/time.js';
import { Runtime } from '../src/sim/runtime.js';

interface Row {
  readonly seed: string;
  /** BUILDs this probe asked for, and the ones the engine actually minted. */
  readonly asked: number;
  readonly created: number;
  readonly formed: number;
  readonly abandoned: number;
  readonly stillForming: number;
  /** The most roles any one BUILD ever had filled at once, and Σ over all of them. */
  readonly bestRoles: number;
  readonly rolesFilled: number;
  readonly roleSlots: number;
  /** Distinct principals that ever held a role in a BUILD. */
  readonly fillers: number;
  /** Two-role kinds, for contrast: the same world's ordinary formation rate. */
  readonly twoRoleFormed: number;
  readonly twoRoleAbandoned: number;
  readonly refusals: readonly string[];
  readonly halted: boolean;
}

function runOne(seed: string, ticks: number, members: number, every: number): Row {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size: members });
  cast.seat(seed);

  const bestOf = new Map<string, number>();
  const fillers = new Set<string>();
  const refusals = new Set<string>();
  let asked = 0;
  let halted = false;

  for (let n = 0; n < ticks; n += 1) {
    const tick = runtime.engine.tick + 1;

    // The agent's part: one BUILD every `every` ticks, authored by a different member each time so
    // the creator-exclusion gate in `openSlotFor` does not always remove the same principal.
    if (n > 0 && n % every === 0) {
      const author = cast.roster[(n / every) % cast.roster.length];
      if (author !== undefined) {
        asked += 1;
        const out = runtime.engine.submit({
          principal: author.principal,
          verb: 'create',
          params: { kind: 'BUILD', stage: author.seat, value: 40_000 },
          clientSequence: 0,
          arrivalMs: 0,
          decisionSource: 'HEURISTIC',
        });
        if (!out.ok) refusals.add(`create: ${out.invariant} ${out.hint.slice(0, 140)}`);
      }
    }

    for (const action of cast.decide(tick, seed)) runtime.engine.submit(action);
    const report = runtime.runTick();

    for (const venture of runtime.ventures.all()) {
      if (venture.kind !== 'BUILD') continue;
      const held = venture.roles.filter((r) => r.filledByPrincipal !== null).length;
      bestOf.set(venture.id, Math.max(bestOf.get(venture.id) ?? 0, held));
      for (const role of venture.roles) {
        if (role.filledByPrincipal !== null) fillers.add(String(role.filledByPrincipal));
      }
    }
    for (const member of cast.roster) {
      for (const correction of runtime.takeCorrections(member.principal)) {
        if (correction.verb !== 'fill_role') continue;
        refusals.add(`fill_role: ${correction.invariant} ${correction.hint.slice(0, 140)}`);
      }
    }
    if (report.halted) {
      halted = true;
      break;
    }
  }

  const all = runtime.ventures.all();
  const build = all.filter((v) => v.kind === 'BUILD');
  const two = all.filter((v) => v.kind !== 'BUILD' && v.kind !== 'SIEGE');
  const formed = (state: string): boolean => state === 'LIVE' || state === 'SETTLED' || state === 'DEFAULTED';
  return {
    seed,
    asked,
    created: build.length,
    formed: build.filter((v) => formed(v.state)).length,
    abandoned: build.filter((v) => v.state === 'ABANDONED').length,
    stillForming: build.filter((v) => v.state === 'FORMING').length,
    bestRoles: Math.max(0, ...[...bestOf.values()]),
    rolesFilled: [...bestOf.values()].reduce((a, b) => a + b, 0),
    roleSlots: build.length * 4,
    fillers: fillers.size,
    twoRoleFormed: two.filter((v) => formed(v.state)).length,
    twoRoleAbandoned: two.filter((v) => v.state === 'ABANDONED').length,
    refusals: [...refusals].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    halted,
  };
}

function parse(argv: readonly string[]): {
  readonly seeds: readonly string[];
  readonly ticks: number;
  readonly members: number;
  readonly every: number;
} {
  let seeds: string[] = [];
  let reckonings = 3;
  let members = 12;
  let prefix = 'g';
  let count = 8;
  let every = 96;
  for (let i = 0; i < argv.length; i += 2) {
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
      case '--members':
        members = Number.parseInt(value, 10);
        break;
      case '--every':
        every = Number.parseInt(value, 10);
        break;
      default:
        throw new Error(`unknown flag ${flag}`);
    }
  }
  if (seeds.length === 0) {
    for (let n = 1; n <= count; n += 1) seeds.push(`${prefix}${String(n).padStart(2, '0')}`);
  }
  return { seeds, ticks: reckonings * TICKS_PER_RECKONING, members, every };
}

const args = parse(process.argv.slice(2));
process.stdout.write(
  `formation probe — ${String(args.seeds.length)} seeds x ${String(args.ticks)} ticks x ` +
    `${String(args.members)} members, one BUILD every ${String(args.every)} ticks\n\n`,
);
process.stdout.write(
  'seed      asked  built  FORMED  aband  open   best  rolesFilled/slots  fillers | 2-role formed  aband\n',
);
const rows: Row[] = [];
for (const seed of args.seeds) rows.push(runOne(seed, args.ticks, args.members, args.every));
const sum = (pick: (r: Row) => number): number => rows.reduce((n, r) => n + pick(r), 0);
for (const r of rows) {
  process.stdout.write(
    `${r.seed.padEnd(9)} ${String(r.asked).padStart(5)} ${String(r.created).padStart(6)} ` +
      `${String(r.formed).padStart(7)} ${String(r.abandoned).padStart(6)} ${String(r.stillForming).padStart(5)} ` +
      `${String(r.bestRoles).padStart(6)} ${`${String(r.rolesFilled)}/${String(r.roleSlots)}`.padStart(18)} ` +
      `${String(r.fillers).padStart(8)} | ${String(r.twoRoleFormed).padStart(12)} ${String(r.twoRoleAbandoned).padStart(6)}` +
      (r.halted ? '  HALTED' : '') +
      '\n',
  );
}
process.stdout.write(
  `${'TOTAL'.padEnd(9)} ${String(sum((r) => r.asked)).padStart(5)} ${String(sum((r) => r.created)).padStart(6)} ` +
    `${String(sum((r) => r.formed)).padStart(7)} ${String(sum((r) => r.abandoned)).padStart(6)} ` +
    `${String(sum((r) => r.stillForming)).padStart(5)} ${String(Math.max(...rows.map((r) => r.bestRoles))).padStart(6)} ` +
    `${`${String(sum((r) => r.rolesFilled))}/${String(sum((r) => r.roleSlots))}`.padStart(18)} ` +
    `${String(Math.max(...rows.map((r) => r.fillers))).padStart(8)} | ` +
    `${String(sum((r) => r.twoRoleFormed)).padStart(12)} ${String(sum((r) => r.twoRoleAbandoned)).padStart(6)}\n`,
);
const hints = [...new Set(rows.flatMap((r) => r.refusals))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
if (hints.length > 0) {
  process.stdout.write('\nrefusals seen (AGT-S3: a bot hitting one means an affordance or a hint is wrong):\n');
  for (const hint of hints.slice(0, 12)) process.stdout.write(`  ${hint}\n`);
}
process.stdout.write(
  `\nRESULT ${JSON.stringify({
    seeds: args.seeds.length,
    asked: sum((r) => r.asked),
    created: sum((r) => r.created),
    formed: sum((r) => r.formed),
    abandoned: sum((r) => r.abandoned),
    bestRoles: Math.max(...rows.map((r) => r.bestRoles)),
    rolesFilled: sum((r) => r.rolesFilled),
    roleSlots: sum((r) => r.roleSlots),
    twoRoleFormed: sum((r) => r.twoRoleFormed),
    twoRoleAbandoned: sum((r) => r.twoRoleAbandoned),
  })}\n`,
);
