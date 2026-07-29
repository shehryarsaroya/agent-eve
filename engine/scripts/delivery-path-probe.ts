#!/usr/bin/env node
/**
 * ★ **DID THE MAP GET HARDER TO CROSS?** — the instrument §16.12 #1's landing was required to run.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHY A SECOND INSTRUMENT, WHEN THE BALANCE GATE ALREADY EXISTS.**
 *
 * `balance-gate.ts` reports `levyShort` and the red tribute-line count, and those are the two meters
 * that survive its own null control. They are also **outcome** meters: they say the Levy cleared, not
 * that it cleared *the same way*. Two hazards on the delivery path were measured this week and
 * neither is visible in either column:
 *
 *   1. **A member's goods and its hands end up in different systems in 325 of 576 observations.** A
 *      change that made carrying harder would raise that fraction and the Levy could still clear, out
 *      of a bigger buffer, for several Reckonings.
 *   2. **`levyMove` was once found refusing a member's only legal route to its own tribute.** That is
 *      a refusal, not a shortfall: the member ends the Reckoning short by a route it was never
 *      allowed to walk, and `levyShort` records the symptom with no way to name the cause.
 *
 * STRAITS and SWAY are built so that **neither can move**: `move`, `haul` and `deliver` do not read
 * either module, and the friction is entirely on force. That is a claim, and a claim about a negative
 * is exactly the kind this project has been wrong about repeatedly. So it is measured against the
 * same seeds at the same horizons, and the numbers must be **identical**, not merely acceptable.
 *
 * A difference here is a finding even when the balance gate is green.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ```
 * npx tsx scripts/delivery-path-probe.ts --seeds-from g --count 8 --reckonings 6
 * ```
 *
 * Output is one row per seed plus a TOTAL, and a machine-readable `RESULT <json>` line so two
 * checkouts can be diffed without eyeballing.
 */

import { HeuristicCast } from '../src/cast/index.js';
import { setSpeed, TICKS_PER_RECKONING } from '../src/core/time.js';
import { Runtime } from '../src/sim/runtime.js';
import { storesAccount } from '../src/ledger/index.js';
import { handsOf } from '../src/world/index.js';

interface Row {
  readonly seed: string;
  readonly halted: boolean;
  /** Observations sampled: one per member per settlement tick. The denominator. */
  readonly observations: number;
  /**
   * Observations in which the member had levy good standing somewhere it had **no hand**.
   *
   * The 325-of-576 hazard, as a counter. Measured at the settlement tick because that is the tick
   * the split actually costs something: goods that cannot be reached cannot be delivered.
   */
  readonly split: number;
  /**
   * `move`, `deliver` and `haul` actions the cast **submitted**, plus the tick loop's own totals.
   *
   * Submitted per verb and applied in aggregate, because `TickReport` carries `applied`/`refused`
   * and no per-action detail — and inventing a per-verb applied count here would be a second home
   * for something the engine already decides (scar #5). What matters for this comparison is that
   * every one of these numbers is **identical** between two checkouts: a change that made the map
   * harder to cross moves the submissions (the cast re-plans) or the refusals (the engine says no),
   * and there is no way for it to move neither.
   */
  readonly moveSubmitted: number;
  readonly deliverSubmitted: number;
  readonly haulSubmitted: number;
  readonly applied: number;
  readonly refused: number;
  /**
   * ★ Refusals of `move`, `haul` or `deliver` whose reason names SWAY or a STRAIT.
   *
   * **This must be 0 forever.** It is the executable form of the claim that the friction is on force
   * and never on freight: if a single travel or delivery refusal ever cites either mechanic, the
   * hazard above has arrived and this is the column that names it, on the tick it happened.
   */
  readonly refusedForReach: number;
  readonly finalStateHash: string;
}

const LEVY_GOOD = 'ration';

function runOne(seed: string, ticks: number, members: number): Row {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size: members });
  const roster = cast.seat(seed);

  let halted = false;
  let observations = 0;
  let split = 0;
  let moveSubmitted = 0;
  let deliverSubmitted = 0;
  let haulSubmitted = 0;
  let applied = 0;
  let refused = 0;
  let refusedForReach = 0;
  let finalStateHash = '';

  for (let i = 0; i < ticks; i += 1) {
    const next = runtime.engine.tick + 1;
    for (const action of cast.decide(next, seed)) {
      if (action.verb === 'move') moveSubmitted += 1;
      if (action.verb === 'deliver') deliverSubmitted += 1;
      if (action.verb === 'haul') haulSubmitted += 1;
      runtime.engine.submit(action);
    }
    const report = runtime.runTick();
    finalStateHash = report.stateHash;
    if (report.halted) halted = true;
    applied += report.applied;
    refused += report.refused;

    // ── THE REFUSALS, READ OFF THE ENGINE'S OWN CORRECTIONS CHANNEL ─────────
    //
    // `peekCorrections` and never `takeCorrections`: draining is what a wake does, and a probe that
    // drained would delete the rows the cast is about to read and change the run it is measuring.
    // The channel carries the verb, the invariant and the hint the AGENT sees, which is the only
    // place the refusal's *reason* exists — `TickReport` carries aggregate `applied`/`refused` and
    // no per-action detail.
    for (const member of roster) {
      for (const row of runtime.peekCorrections(member.principal)) {
        if (row.tick !== report.tick) continue;
        if (row.verb !== 'move' && row.verb !== 'haul' && row.verb !== 'deliver') continue;
        if (/\bSWAY\b|\bSTRAIT\b/.test(row.hint)) refusedForReach += 1;
      }
    }

    // ── THE SPLIT, AT THE TICK IT COSTS SOMETHING ──────────────────────────
    if (!report.clock.inFreeze) continue;
    for (const member of roster) {
      observations += 1;
      // ── HANDS ONLY, AND THE HOLDING IS DELIBERATELY NOT IN THE SET ──────
      //
      // `deliver` and `haul` both need a HAND standing where the goods are; a holding is a body on
      // the map and cannot pick anything up. Counting the holding as reach would have made this
      // column read 0 in every world, which is what it did in the first draft — a meter that cannot
      // move is the defect one level up from the one it exists to catch.
      const reach = new Set(handsOf(runtime.world, member.principal).map((hand) => hand.location));
      const stranded = runtime.ledger
        .lotsInAccount(storesAccount(member.principal))
        .some((lot) => lot.good === LEVY_GOOD && lot.qty > 0 && !reach.has(lot.location));
      if (stranded) split += 1;
    }
  }

  return {
    seed,
    halted,
    observations,
    split,
    moveSubmitted,
    deliverSubmitted,
    haulSubmitted,
    applied,
    refused,
    refusedForReach,
    finalStateHash,
  };
}

function parse(argv: readonly string[]): {
  seeds: readonly string[];
  reckonings: number;
  members: number;
} {
  let seeds: string[] = ['g01'];
  let reckonings = 3;
  let members = 8;
  let from: string | null = null;
  let count = 8;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i] ?? '';
    const value = argv[i + 1] ?? '';
    switch (flag) {
      case '--seeds':
        seeds = value.split(',').filter(Boolean);
        i += 1;
        break;
      case '--seeds-from':
        from = value;
        i += 1;
        break;
      case '--count':
        count = Number(value);
        i += 1;
        break;
      case '--reckonings':
        reckonings = Number(value);
        i += 1;
        break;
      case '--members':
        members = Number(value);
        i += 1;
        break;
      default:
        break;
    }
  }
  if (from !== null) {
    seeds = Array.from({ length: count }, (_, i) => `${from}${String(i + 1).padStart(2, '0')}`);
  }
  return { seeds, reckonings, members };
}

const args = parse(process.argv.slice(2));
const ticks = args.reckonings * TICKS_PER_RECKONING;
const rows: Row[] = [];
for (const seed of args.seeds) rows.push(runOne(seed, ticks, args.members));

const pad = (n: number | string, w: number): string => String(n).padStart(w);
console.log(
  `delivery path · ${String(args.seeds.length)} seeds × ${String(args.reckonings)} Reckonings × ` +
    `${String(args.members)} members`,
);
console.log('seed   halt  obs  split  split%   move  deliver  haul   applied  refused  REACH-REFUSED');
for (const r of rows) {
  const pct = r.observations === 0 ? 0 : Math.round((r.split * 1000) / r.observations) / 10;
  console.log(
    `${r.seed}  ${r.halted ? 'HALT' : '  ok'} ${pad(r.observations, 4)} ${pad(r.split, 6)} ` +
      `${pad(String(pct), 7)}  ${pad(r.moveSubmitted, 5)} ${pad(r.deliverSubmitted, 8)} ` +
      `${pad(r.haulSubmitted, 5)} ${pad(r.applied, 8)} ${pad(r.refused, 8)} ${pad(r.refusedForReach, 13)}`,
  );
}
const sum = (pick: (r: Row) => number): number => rows.reduce((n, r) => n + pick(r), 0);
const total = {
  observations: sum((r) => r.observations),
  split: sum((r) => r.split),
  moveSubmitted: sum((r) => r.moveSubmitted),
  deliverSubmitted: sum((r) => r.deliverSubmitted),
  haulSubmitted: sum((r) => r.haulSubmitted),
  applied: sum((r) => r.applied),
  refused: sum((r) => r.refused),
  refusedForReach: sum((r) => r.refusedForReach),
  halted: rows.filter((r) => r.halted).length,
};
console.log(
  `TOTAL   ${String(total.halted)}h ${pad(total.observations, 4)} ${pad(total.split, 6)} ` +
    `${pad(String(Math.round((total.split * 1000) / Math.max(1, total.observations)) / 10), 7)}  ` +
    `${pad(total.moveSubmitted, 5)} ${pad(total.deliverSubmitted, 8)} ` +
    `${pad(total.haulSubmitted, 5)} ${pad(total.applied, 8)} ${pad(total.refused, 8)} ` +
    `${pad(total.refusedForReach, 13)}`,
);
if (total.refusedForReach > 0) {
  console.log(
    '\n★ REGRESSION: a travel or delivery refusal cited SWAY or a STRAIT. §16.12 #1 is built so ' +
      'that neither can reach `move`, `haul` or `deliver` — this column must be 0.',
  );
}
console.log(`RESULT ${JSON.stringify({ rows, total })}`);
