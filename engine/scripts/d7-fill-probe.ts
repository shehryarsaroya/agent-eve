#!/usr/bin/env node
/**
 * D7 / `RULES_VERSION` 19 — **DID THE BUY SIDE COME ALIVE?**
 *
 * The bar for this change is a FILL in a real world: an ask and a bid from two different
 * principals crossing, goods moving one way and currency the other, with nobody hand-funded.
 * `test/works/a-good-only-the-commons-makes.spec.ts` already proves the chain works when a
 * buyer is given money; this asks whether the cast can get there on its own.
 *
 * Prints, per seed: orders placed by side, fills, and for each fill the two principals, the
 * quantity, the unit price and the currency that moved. Also prints the `freeCash`
 * distribution, because the whole defect was that it was identically zero.
 *
 *   npx tsx scripts/d7-fill-probe.ts --seeds-from g --count 8 --reckonings 6
 */

import { HeuristicCast } from '../src/cast/index.js';
import { setSpeed, TICKS_PER_RECKONING } from '../src/core/time.js';
import { Runtime } from '../src/sim/runtime.js';
import { freeCash } from '../src/market/escrow.js';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

const reckonings = Number(arg('reckonings', '6'));
const members = Number(arg('members', '8'));
const count = Number(arg('count', '8'));
const prefix = arg('seeds-from', 'g');
const seeds: string[] = [];
for (let i = 1; i <= count; i += 1) seeds.push(`${prefix}${String(i).padStart(2, '0')}`);

let totalFills = 0;
let totalBids = 0;
let totalAsks = 0;

for (const seed of seeds) {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size: members });
  const roster = cast.seat(seed);
  const ticks = reckonings * TICKS_PER_RECKONING;

  let bids = 0;
  let asks = 0;
  for (let i = 0; i < ticks; i += 1) {
    const next = runtime.engine.tick + 1;
    for (const action of cast.decide(next, seed)) {
      if (action.verb === 'trade' && action.params['operation'] === 'place') {
        if (action.params['side'] === 'BID') bids += 1;
        else asks += 1;
      }
      runtime.engine.submit(action);
    }
    const report = runtime.runTick();
    if (report.halted) {
      console.log(`${seed}: HALTED at tick ${String(report.tick)}`);
      break;
    }
  }

  const fills = runtime.market.fills();
  totalFills += fills.length;
  totalBids += bids;
  totalAsks += asks;

  const cash = roster.map((m) => Number(freeCash(runtime.ledger, m.principal)));
  const funded = cash.filter((c) => c > 0).length;
  console.log(
    `${seed}  bidActions=${String(bids)} askActions=${String(asks)} FILLS=${String(fills.length)} ` +
      `funded=${String(funded)}/${String(cash.length)} freeCash=[${cash.sort((a, b) => a - b).join(',')}]`,
  );
  for (const f of fills.slice(0, 4)) {
    console.log(
      `    FILL tick=${String(f.tick)} ${String(f.seller)} -> ${String(f.buyer)}  ` +
        `${String(f.qty)} x ${String(f.good)} @ ${String(f.unitPrice)} = ${String(Number(f.qty) * Number(f.unitPrice))} minor`,
    );
  }
}

console.log(`\nTOTAL  bidActions=${String(totalBids)} askActions=${String(totalAsks)} FILLS=${String(totalFills)}`);
