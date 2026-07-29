#!/usr/bin/env node
/**
 * ★ CAN THE CAST REACH `haul`? — the instrument for the claim `D41` turns on.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHY THIS EXISTS.** `D41` closed two world halts that any enrolled agent could reach through the
 * `haul` affordance, and the reason production had not already stopped was believed to be *"no cast
 * branch sends the `haul` verb"*. That is **false** — `cast/heuristic.ts:alloyErrandFor` step 3 sends
 * it, and it sits **above** the `freeCash` gate that stops the errand's buy step. So the live shard
 * was protected by a branch whose *preconditions* had never been met, not by the absence of a branch.
 *
 * The difference is the whole risk assessment, and this project has been wrong about exactly this
 * distinction more than a dozen times (`CLAUDE.md` §3: *"a capability that exists and is never
 * exercised is indistinguishable from one that is missing"*). A grep cannot tell them apart. A count
 * can, so this counts — per seed, over real Reckonings, on a world nobody steers:
 *
 *   · `haul` actions the cast **submitted**, and how many the engine **applied**;
 *   · the peak number of lots `IN_TRANSIT` at once, which is the subject INV-W7 needs in order to
 *     mean anything;
 *   · the peak number of **hands carrying at the same time**, because the halt needed **two**;
 *   · whether the world ever halted.
 *
 * A run that reports `submitted 0` is not evidence that `haul` is safe. It is evidence that this
 * instrument, and the balance gate, and the whole test suite, **cannot see a regression in it** —
 * which is what `test/world/a-convoy-carries-its-own-cargo.spec.ts` is for, and why that file drives
 * the verb directly instead of waiting for a cast to select it.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ```
 * npx tsx scripts/haul-reach-probe.ts --seeds g01,g02 --reckonings 6 --members 8
 * ```
 */

import { HeuristicCast } from '../src/cast/index.js';
import { setSpeed, TICKS_PER_RECKONING } from '../src/core/time.js';
import { Runtime } from '../src/sim/runtime.js';

interface Row {
  readonly seed: string;
  readonly halted: boolean;
  readonly submitted: number;
  readonly applied: number;
  readonly peakTransitLots: number;
  readonly peakCarryingHands: number;
  readonly landed: number;
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? (process.argv[i + 1] as string) : fallback;
}

function runSeed(seed: string, reckonings: number, members: number): Row {
  setSpeed('instant');
  const rt = new Runtime({ seed });
  const cast = new HeuristicCast(rt, { size: members });
  cast.seat(seed);
  let submitted = 0;
  let applied = 0;
  let peakTransitLots = 0;
  let peakCarryingHands = 0;
  let landed = 0;
  let halted = false;

  for (let i = 0; i < reckonings * TICKS_PER_RECKONING; i += 1) {
    const next = rt.engine.tick + 1;
    for (const action of cast.decide(next, seed)) {
      if (action.verb === 'haul') submitted += 1;
      rt.engine.submit(action);
    }
    const report = rt.runTick();
    if (report.halted) {
      halted = true;
      const why = report.violations.map((v) => `${v.id}: ${v.message}`).join(' | ');
      console.log(`  ${seed} HALTED at tick ${String(report.tick)} — ${why}`);
      break;
    }
    // `haul.departed` is emitted once per applied haul; `haul.landed` once per landing.
    for (const row of rt.events.eventsAtTick(report.tick)) {
      if (row.event.kind === 'haul.departed') applied += 1;
      if (row.event.kind === 'haul.landed') landed += 1;
    }
    const lots = rt.ledger.lotsInTransit().length;
    if (lots > peakTransitLots) peakTransitLots = lots;
    let carrying = 0;
    for (const hand of rt.world.hands.values()) if (hand.cargo.size > 0) carrying += 1;
    if (carrying > peakCarryingHands) peakCarryingHands = carrying;
  }
  return { seed, halted, submitted, applied, peakTransitLots, peakCarryingHands, landed };
}

const seeds = arg('seeds', 'g01,g02,g03,g04').split(',');
const reckonings = Number(arg('reckonings', '3'));
const members = Number(arg('members', '8'));

console.log(
  `seed   halted  haul.submitted  haul.applied  haul.landed  peak.lots  peak.carrying`,
);
const rows: Row[] = [];
for (const seed of seeds) {
  const row = runSeed(seed, reckonings, members);
  rows.push(row);
  console.log(
    `${row.seed.padEnd(7)}${String(row.halted).padEnd(8)}${String(row.submitted).padStart(14)}` +
      `${String(row.applied).padStart(14)}${String(row.landed).padStart(13)}` +
      `${String(row.peakTransitLots).padStart(11)}${String(row.peakCarryingHands).padStart(15)}`,
  );
}
const total = rows.reduce(
  (a, r) => ({
    submitted: a.submitted + r.submitted,
    applied: a.applied + r.applied,
    landed: a.landed + r.landed,
    halted: a.halted || r.halted,
  }),
  { submitted: 0, applied: 0, landed: 0, halted: false },
);
console.log(`RESULT ${JSON.stringify({ ...total, seeds: seeds.length, reckonings, members })}`);
if (total.halted) process.exitCode = 1;
