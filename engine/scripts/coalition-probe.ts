#!/usr/bin/env node
/**
 * COALITION PROBE — is `join` reachable in a world nobody steers, and does anyone take it?
 *
 * Three questions, in the order they have to be answered:
 *
 *   1. **OPPORTUNITY.** How many (live raid, non-target principal with an IDLE hand at the stage)
 *      pairs does a heuristic run produce? `join`'s engine gate is presence, and if the cast never
 *      stands together the branch cannot fire whatever its policy says.
 *   2. **UPTAKE.** How many `join`s are actually sent, on which side, and with what standing.
 *   3. **SCALE.** Parties per battle and formations per side — the number the whole exercise is for.
 *
 * ```
 * npx tsx scripts/coalition-probe.ts --seeds-from g --count 8 --reckonings 3
 * ```
 */

import { HeuristicCast } from '../src/cast/index.js';
import { setSpeed, TICKS_PER_RECKONING } from '../src/core/time.js';
import { compareIds } from '../src/ledger/index.js';
import { Runtime } from '../src/sim/runtime.js';

interface Row {
  readonly seed: string;
  /** (raid, bystander-with-a-hand-at-the-stage) pairs seen at least once. */
  readonly opportunities: number;
  /** Distinct raids that had at least one such bystander. */
  readonly raidsWithBystander: number;
  readonly raids: number;
  readonly joins: number;
  readonly joinsDefender: number;
  readonly joinsRaider: number;
  readonly joinRefusals: number;
  /** The most parties any one standoff carried. */
  readonly maxParties: number;
  /** Σ parties over every standoff that ever had one. */
  readonly parties: number;
  /** The most principals fielding a formation on one side of one battle. */
  readonly maxPrincipalsOneSide: number;
  readonly battles: number;
  readonly ourWrecks: number;
  readonly halted: boolean;
  /** Every distinct `join` refusal the cast produced. Text, not a count — see the loop. */
  readonly hints: readonly string[];
}

function runOne(seed: string, ticks: number, members: number): Row {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size: members });
  cast.seat(seed);
  const mine = new Set(cast.roster.map((m) => String(m.principal)));

  const opportunity = new Set<string>();
  const raidsWithBystander = new Set<string>();
  let joins = 0;
  let joinsDefender = 0;
  let joinsRaider = 0;
  let joinRefusals = 0;
  let maxParties = 0;
  let maxPrincipalsOneSide = 0;
  const partiesOf = new Map<string, number>();
  const wrecked = new Set<string>();
  let ourWrecks = 0;
  let halted = false;
  const hints = new Set<string>();

  for (let n = 0; n < ticks; n += 1) {
    const tick = runtime.engine.tick + 1;

    // OPPORTUNITY, read off the same view the cast reads. A bystander is a principal that is not
    // the target and has an IDLE hand where the standoff stands, which is exactly `join`'s gate.
    for (const raid of runtime.raids.live()) {
      for (const member of cast.roster) {
        if (member.principal === raid.target) continue;
        if (runtime.raidsFor(member.principal, runtime.engine.tick, 24).every((v) => v.raid !== raid.id)) {
          continue;
        }
        opportunity.add(`${raid.id}/${String(member.principal)}`);
        raidsWithBystander.add(raid.id);
      }
    }

    for (const action of cast.decide(tick, seed)) {
      if (action.verb === 'join') {
        joins += 1;
        if (action.params['side'] === 'RAIDER') joinsRaider += 1;
        else joinsDefender += 1;
      }
      runtime.engine.submit(action);
    }
    const report = runtime.runTick();
    for (const member of cast.roster) {
      for (const correction of runtime.takeCorrections(member.principal)) {
        if (correction.verb !== 'join') continue;
        joinRefusals += 1;
        // AGT-S3: a bot hitting a refusal means an affordance or a hint is wrong, not that the bot
        // is wrong. So the text is kept rather than counted — a count cannot be acted on.
        hints.add(`${correction.invariant} ${correction.hint.slice(0, 160)}`);
      }
    }

    for (const raid of runtime.raids.all()) {
      partiesOf.set(raid.id, Math.max(partiesOf.get(raid.id) ?? 0, raid.parties.length));
      maxParties = Math.max(maxParties, raid.parties.length);
    }
    for (const battle of runtime.battles.all()) {
      const bySide = new Map<string, Set<string>>();
      for (const formation of battle.formations) {
        if (formation.hands.length === 0) continue;
        const seen = bySide.get(formation.side) ?? new Set<string>();
        seen.add(String(formation.principal));
        bySide.set(formation.side, seen);
      }
      for (const seen of bySide.values()) maxPrincipalsOneSide = Math.max(maxPrincipalsOneSide, seen.size);
      // Wrecks are pruned with the battle, so they are counted per tick.
      for (const wreck of battle.wrecks) {
        const key = `${battle.id}/${wreck.hull}`;
        if (wrecked.has(key)) continue;
        wrecked.add(key);
        if (mine.has(String(wreck.principal))) ourWrecks += 1;
      }
    }
    if (report.halted) {
      halted = true;
      break;
    }
  }

  return {
    seed,
    opportunities: opportunity.size,
    raidsWithBystander: raidsWithBystander.size,
    raids: runtime.raids.all().length,
    joins,
    joinsDefender,
    joinsRaider,
    joinRefusals,
    maxParties,
    parties: [...partiesOf.values()].reduce((a, b) => a + b, 0),
    maxPrincipalsOneSide,
    battles: runtime.battles.all().length,
    ourWrecks,
    halted,
    hints: [...hints].sort(compareIds),
  };
}

function parse(argv: readonly string[]): {
  readonly seeds: readonly string[];
  readonly ticks: number;
  readonly members: number;
} {
  let seeds: string[] = ['gate-a', 'gate-b', 'gate-c', 'gate-d'];
  let reckonings = 3;
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
  return { seeds, ticks: reckonings * TICKS_PER_RECKONING, members };
}

const args = parse(process.argv.slice(2));
process.stdout.write(
  `coalition probe — ${String(args.seeds.length)} seeds x ${String(args.ticks)} ticks x ` +
    `${String(args.members)} members\n\n`,
);
process.stdout.write(
  'seed         raids  bystood  chances   joins  def  raid  refused  maxParty  Σparty  maxSide  battles  ourWrecks\n',
);
const rows: Row[] = [];
for (const seed of args.seeds) {
  const row = runOne(seed, args.ticks, args.members);
  rows.push(row);
  process.stdout.write(
    `${row.seed.padEnd(12)} ${String(row.raids).padStart(5)} ${String(row.raidsWithBystander).padStart(8)} ` +
      `${String(row.opportunities).padStart(8)} ${String(row.joins).padStart(7)} ${String(row.joinsDefender).padStart(4)} ` +
      `${String(row.joinsRaider).padStart(5)} ${String(row.joinRefusals).padStart(8)} ` +
      `${String(row.maxParties).padStart(9)} ${String(row.parties).padStart(7)} ` +
      `${String(row.maxPrincipalsOneSide).padStart(8)} ${String(row.battles).padStart(8)} ` +
      `${String(row.ourWrecks).padStart(10)}${row.halted ? '  HALTED' : ''}\n`,
  );
  for (const hint of row.hints) process.stdout.write(`  ! ${hint}\n`);
}
const sum = (pick: (r: Row) => number): number => rows.reduce((n, r) => n + pick(r), 0);
const max = (pick: (r: Row) => number): number => rows.reduce((n, r) => Math.max(n, pick(r)), 0);
const total = {
  seeds: rows.length,
  ticks: args.ticks,
  members: args.members,
  raids: sum((r) => r.raids),
  raidsWithBystander: sum((r) => r.raidsWithBystander),
  opportunities: sum((r) => r.opportunities),
  joins: sum((r) => r.joins),
  joinsDefender: sum((r) => r.joinsDefender),
  joinsRaider: sum((r) => r.joinsRaider),
  joinRefusals: sum((r) => r.joinRefusals),
  maxParties: max((r) => r.maxParties),
  parties: sum((r) => r.parties),
  maxPrincipalsOneSide: max((r) => r.maxPrincipalsOneSide),
  battles: sum((r) => r.battles),
  ourWrecks: sum((r) => r.ourWrecks),
  halted: rows.filter((r) => r.halted).length,
};
process.stdout.write(
  `${'TOTAL'.padEnd(12)} ${String(total.raids).padStart(5)} ${String(total.raidsWithBystander).padStart(8)} ` +
    `${String(total.opportunities).padStart(8)} ${String(total.joins).padStart(7)} ` +
    `${String(total.joinsDefender).padStart(4)} ${String(total.joinsRaider).padStart(5)} ` +
    `${String(total.joinRefusals).padStart(8)} ${String(total.maxParties).padStart(9)} ` +
    `${String(total.parties).padStart(7)} ${String(total.maxPrincipalsOneSide).padStart(8)} ` +
    `${String(total.battles).padStart(8)} ${String(total.ourWrecks).padStart(10)}\n`,
);
process.stdout.write(`\nRESULT ${JSON.stringify(total)}\n`);
