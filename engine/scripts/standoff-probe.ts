#!/usr/bin/env node
/**
 * STANDOFF PROBE — **why** a coalition did not form, with a denominator per gate.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **`coalition-probe.ts` COUNTS JOINS. THIS ONE COUNTS REFUSALS BY NAME, AND THEY ARE DIFFERENT
 * FINDINGS.**
 *
 * The sibling instrument reports 6 joins against 52 (standoff, bystander) chances over 8 seeds and
 * stops there. "46 chances did not convert" is one number covering six unrelated causes — the
 * standoff was already over, the neighbour was a stranger, the gap was unreachable, every hand was
 * spoken for, the road was too long — and a fix aimed at the wrong one reads exactly like a fix
 * aimed at the right one, because both leave the total unchanged. That is this project's signature
 * defect applied to its own instruments.
 *
 * So every chance is attributed to the **first** gate in `HeuristicCast.coalitionFor` that refused
 * it, in that function's own order, and the columns sum to the denominator by construction.
 *
 * ⚑ **The gates below MIRROR `coalitionFor`; they are not the same code.** A probe cannot call a
 * private method, and exporting one to be measured would put the cast's policy on its public
 * surface. The mirror is therefore a copy and can drift — which is scar #5 and is accepted *here*
 * only because this file decides nothing: it is read to choose where to look, and the behavioural
 * claim is always re-measured with `coalition-probe.ts`, which counts what the cast actually did.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * It also answers the question that has to come first and never had an instrument:
 * **how do standoffs actually END, and how much of the window was left when they did?** A world
 * where every raid is repulsed by a lone defender needs no coalition, and a world where every raid
 * is `PAID` on the spawn tick cannot have one. Those two are indistinguishable in a join count.
 *
 * ```
 * npx tsx scripts/standoff-probe.ts --seeds-from g --count 8 --reckonings 3
 * ```
 */

import { HeuristicCast } from '../src/cast/index.js';
import {
  CAST_ANSWER_GRACE_TICKS,
  CAST_COALITION_MAX_DEFICIT,
  CAST_COALITION_SPARE_HANDS,
} from '../src/cast/heuristic.js';
import { HAND_RECOVERY_TICKS, phaseOfReckoning, setSpeed, TICKS_PER_RECKONING } from '../src/core/time.js';
import type { PrincipalId } from '../src/core/types.js';
import { DEMAND_WINDOW_TICKS } from '../src/predation/index.js';
import { Runtime } from '../src/sim/runtime.js';
import { handsOf, isPresent } from '../src/world/index.js';

/** The gates, in `coalitionFor`'s order. `JOINED` is the one that did not refuse. */
const GATES = [
  'boundary',
  'over',
  'grace',
  'stranger',
  'nogap',
  'toobig',
  'nohand',
  'toofar',
  'JOINED',
] as const;
type Gate = (typeof GATES)[number];

interface Row {
  readonly seed: string;
  readonly raids: number;
  /** Terminal states, counted off the book at the end of the run. */
  readonly paid: number;
  readonly repulsed: number;
  readonly plundered: number;
  readonly open: number;
  /** Σ (ticks of window still unspent) over every raid that closed early. */
  readonly unspent: number;
  /** The most parties any one standoff carried. */
  readonly maxParties: number;
  /** Standoffs that ever carried 2+ parties on one side — a coalition, as opposed to one helper. */
  readonly coalitions: number;
  readonly chances: number;
  readonly byGate: Readonly<Record<Gate, number>>;
  /** How short the target's own best reading was, bucketed: `<=0` (it could win), 1, 2, 3, 4+. */
  readonly deficit: readonly number[];
  /** Σ the target's OWN hands standing at its stage, over every standoff it read. */
  readonly ownHands: number;
  readonly readByTarget: number;
  readonly halted: boolean;
}

function runOne(seed: string, ticks: number, members: number): Row {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size: members });
  cast.seat(seed);

  const byGate = new Map<Gate, number>(GATES.map((g) => [g, 0]));
  const seen = new Set<string>();
  // ── THE DECISIVE DATUM: HOW SHORT WAS THE DEFENCE WHEN IT GAVE UP? ──────────
  //
  // A join moves the reading by exactly `FORCE_PER_JOINER` = 1, so the number of allies a standoff
  // NEEDS is its deficit, and the number it can USE before the gap shuts is the same. A world whose
  // standoffs are all short by one can never produce a coalition of two however willing the cast is
  // — the second ally reads `nogap` and stays home. Keyed by raid, taken from the TARGET's own view
  // at its best moment, because that is the reading the target answers from.
  const bestDeficit = new Map<string, number>();
  /** The target's own hands standing at the stage, at that same best moment. */
  const ownHands = new Map<string, number>();
  let maxParties = 0;
  const coalition = new Set<string>();
  let halted = false;

  for (let n = 0; n < ticks; n += 1) {
    const tick = runtime.engine.tick + 1;

    for (const member of cast.roster) {
      // The two reads `coalitionFor` takes once per call, before any particular standoff.
      const settled = new Set<PrincipalId>();
      for (const relation of runtime.relationsFor(member.principal)) {
        if (relation.kept > 0 || relation.youKept > 0) settled.add(relation.other);
      }
      const crewed = runtime.battles.committedHands(member.principal);
      const idle = handsOf(runtime.world, member.principal).filter(
        (h) => h.state === 'IDLE' && isPresent(h, runtime.engine.tick) && !crewed.has(h.id),
      );
      const owing = (runtime.levyBlockFor(member.principal, runtime.engine.tick)?.shortfall_if_unpaid ?? 0) > 0;

      for (const view of runtime.raidsFor(member.principal, runtime.engine.tick, 20)) {
        if (view.state !== 'DEMANDED') continue;
        if (view.your_side === 'TARGET') {
          const gap = view.force.raider - view.force.defender_if_you_fight;
          const prior = bestDeficit.get(view.raid);
          if (prior === undefined || gap < prior) {
            bestDeficit.set(view.raid, gap);
            ownHands.set(view.raid, view.force.your_hands_here);
          }
        }
        if (view.your_side !== null || view.target === member.principal) continue;
        // One row per (standoff, member) pair, attributed at the FIRST tick the pair existed —
        // so a pair blocked for twenty ticks is one chance, not twenty. Counting per tick would
        // weight the long refusals and make a gate that blocks briefly look harmless.
        const key = `${view.raid}/${String(member.principal)}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const gate = ((): Gate => {
          if (
            phaseOfReckoning(runtime.engine.tick) + DEMAND_WINDOW_TICKS + HAND_RECOVERY_TICKS.max >
            TICKS_PER_RECKONING
          ) {
            return 'boundary';
          }
          if (view.ticks_left <= 0) return 'over';
          if (view.ticks_left <= CAST_ANSWER_GRACE_TICKS + 1) return 'grace';
          if (!settled.has(view.target) && !view.if_repulsed.protects_you) return 'stranger';
          const deficit = view.force.raider - view.force.defender_if_you_fight;
          if (deficit <= 0) return 'nogap';
          if (deficit > CAST_COALITION_MAX_DEFICIT) return 'toobig';
          // `carriageNeeded` and `musteredAt` are private; `owing` is the dominant term of the
          // former and the latter is 0 whenever this member has answered no FIGHT here. So this
          // column is a LOWER bound on hand pressure — it under-reports rather than over-reports,
          // which is the direction that does not hide a problem.
          const reserved = (owing ? 1 : 0) + CAST_COALITION_SPARE_HANDS;
          if (idle.length - reserved < 1) return 'nohand';
          if (idle.some((h) => h.location === view.stage)) return 'JOINED';
          return view.march !== null && view.march.in_time ? 'JOINED' : 'toofar';
        })();
        byGate.set(gate, (byGate.get(gate) ?? 0) + 1);
      }
    }

    for (const action of cast.decide(tick, seed)) runtime.engine.submit(action);
    const report = runtime.runTick();

    for (const raid of runtime.raids.all()) {
      maxParties = Math.max(maxParties, raid.parties.length);
      const bySide = new Map<string, number>();
      for (const party of raid.parties) bySide.set(party.side, (bySide.get(party.side) ?? 0) + 1);
      if ([...bySide.values()].some((n) => n >= 2)) coalition.add(raid.id);
    }
    if (report.halted) {
      halted = true;
      break;
    }
  }

  const all = runtime.raids.all();
  let unspent = 0;
  for (const raid of all) {
    if (raid.resolvedAtTick === null) continue;
    unspent += Math.max(0, raid.resolvesAtTick - raid.resolvedAtTick);
  }
  return {
    seed,
    raids: all.length,
    paid: all.filter((r) => r.state === 'PAID').length,
    repulsed: all.filter((r) => r.state === 'REPULSED').length,
    plundered: all.filter((r) => r.state === 'PLUNDERED').length,
    open: all.filter((r) => r.state === 'DEMANDED').length,
    unspent,
    maxParties,
    coalitions: coalition.size,
    chances: seen.size,
    byGate: Object.fromEntries(GATES.map((g) => [g, byGate.get(g) ?? 0])) as Record<Gate, number>,
    deficit: [0, 1, 2, 3, 4].map((bucket) =>
      [...bestDeficit.values()].filter((d) =>
        bucket === 0 ? d <= 0 : bucket === 4 ? d >= 4 : d === bucket,
      ).length,
    ),
    ownHands: [...ownHands.values()].reduce((a, b) => a + b, 0),
    readByTarget: bestDeficit.size,
    halted,
  };
}

function parse(argv: readonly string[]): {
  readonly seeds: readonly string[];
  readonly ticks: number;
  readonly members: number;
} {
  let seeds: string[] = [];
  let reckonings = 3;
  let members = 8;
  let prefix = 'g';
  let count = 8;
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
      default:
        throw new Error(`unknown flag ${flag}`);
    }
  }
  if (seeds.length === 0) {
    for (let n = 1; n <= count; n += 1) seeds.push(`${prefix}${String(n).padStart(2, '0')}`);
  }
  return { seeds, ticks: reckonings * TICKS_PER_RECKONING, members };
}

const args = parse(process.argv.slice(2));
process.stdout.write(
  `standoff probe — ${String(args.seeds.length)} seeds x ${String(args.ticks)} ticks x ` +
    `${String(args.members)} members\n\n`,
);
process.stdout.write(
  'seed      raids  paid  repl  plun  open  unspent  maxP  coal | chances  ' +
    GATES.map((g) => g.padStart(8)).join('') +
    '\n',
);

const rows: Row[] = [];
for (const seed of args.seeds) rows.push(runOne(seed, args.ticks, args.members));

const total = GATES.map((g) => rows.reduce((n, r) => n + r.byGate[g], 0));
for (const r of rows) {
  process.stdout.write(
    `${r.seed.padEnd(9)} ${String(r.raids).padStart(5)} ${String(r.paid).padStart(5)} ` +
      `${String(r.repulsed).padStart(5)} ${String(r.plundered).padStart(5)} ${String(r.open).padStart(5)} ` +
      `${String(r.unspent).padStart(8)} ${String(r.maxParties).padStart(5)} ${String(r.coalitions).padStart(5)} | ` +
      `${String(r.chances).padStart(7)}  ` +
      GATES.map((g) => String(r.byGate[g]).padStart(8)).join('') +
      (r.halted ? '  HALTED' : '') +
      '\n',
  );
}
const sum = (pick: (r: Row) => number): number => rows.reduce((n, r) => n + pick(r), 0);
process.stdout.write(
  `${'TOTAL'.padEnd(9)} ${String(sum((r) => r.raids)).padStart(5)} ${String(sum((r) => r.paid)).padStart(5)} ` +
    `${String(sum((r) => r.repulsed)).padStart(5)} ${String(sum((r) => r.plundered)).padStart(5)} ` +
    `${String(sum((r) => r.open)).padStart(5)} ${String(sum((r) => r.unspent)).padStart(8)} ` +
    `${String(Math.max(...rows.map((r) => r.maxParties))).padStart(5)} ` +
    `${String(sum((r) => r.coalitions)).padStart(5)} | ${String(sum((r) => r.chances)).padStart(7)}  ` +
    total.map((n) => String(n).padStart(8)).join('') +
    '\n',
);
process.stdout.write(
  `\nhow short was the DEFENCE, per standoff the target read (deficit at its best moment):\n` +
    `  could win  short 1  short 2  short 3  short 4+   |  read  own-hands-at-stage\n  ` +
    [0, 1, 2, 3, 4]
      .map((b) => String(rows.reduce((n, r) => n + (r.deficit[b] ?? 0), 0)).padStart(9))
      .join('') +
    `   |${String(sum((r) => r.readByTarget)).padStart(6)}${String(sum((r) => r.ownHands)).padStart(19)}\n`,
);
process.stdout.write(
  `\nRESULT ${JSON.stringify({
    deficit: [0, 1, 2, 3, 4].map((b) => rows.reduce((n, r) => n + (r.deficit[b] ?? 0), 0)),
    ownHands: sum((r) => r.ownHands),
    readByTarget: sum((r) => r.readByTarget),
    seeds: args.seeds.length,
    raids: sum((r) => r.raids),
    paid: sum((r) => r.paid),
    repulsed: sum((r) => r.repulsed),
    plundered: sum((r) => r.plundered),
    unspent: sum((r) => r.unspent),
    coalitions: sum((r) => r.coalitions),
    chances: sum((r) => r.chances),
    byGate: Object.fromEntries(GATES.map((g, i) => [g, total[i]])),
  })}\n`,
);
