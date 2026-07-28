#!/usr/bin/env node
/**
 * D7, THE GOODS HALF — **HOW MANY PRINCIPALS HOLD THE LEVY GOOD AND CAN SELL NONE OF IT?**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * The currency half of D7 shipped a static floor at the whole `STARTER_STAKE`, and
 * `scripts/d7-fill-probe.ts` is the instrument that measured what it cost: `freeCash` was
 * identically zero and the market's buy side was unreachable. **This is the same instrument
 * pointed at the sell side**, because `ENDOWMENT_GOOD_FLOOR_QTY` was the same static
 * over-withholding one field over and nothing printed the figure.
 *
 * One observation per `(seed, Reckoning, member)`, sampled at the settlement tick — which is
 * where the frame is drawn and therefore the reading a viewer and an agent both see. Per
 * observation it records what the principal HOLDS of the endowment good and what
 * `sellableGoods` says it may ASK, summed over the venues it holds anything at.
 *
 * The two numbers that are the finding:
 *
 *   - **`heldAndCannotSell`** — observations holding the good with `sellable = 0`. Every one
 *     of these is a principal that owns the good every obligation in the game is priced in
 *     and may not put a unit of it on a book.
 *   - **`neverSell`** — principals whose sellable was zero at **every** Reckoning of the run.
 *     Permanently locked out rather than briefly short, which is the live shard's
 *     `p:probe-scout-01`: 40,116 units held, sellable 0, and no production to grow past a
 *     floor that never fell.
 *
 * `splitVenues` is the latent half: observations holding the good at two or more venues at
 * once. Under a per-`(principal, venue)` floor a principal holding 60,000 split 30,000/30,000
 * can sell at NEITHER, and this column says whether any world ever reaches that branch.
 *
 *   npx tsx scripts/d7-sellable-probe.ts --seeds-from g --count 8 --reckonings 9
 * ══════════════════════════════════════════════════════════════════════════
 */

import { HeuristicCast } from '../src/cast/index.js';
import { isSettlementTick, reckoningIndex, setSpeed, TICKS_PER_RECKONING } from '../src/core/time.js';
import type { PrincipalId, SystemId } from '../src/core/types.js';
import { ENDOWMENT_GOOD } from '../src/ledger/endowment.js';
import { storesAccount } from '../src/ledger/index.js';
import { sellableGoods } from '../src/market/escrow.js';
import { Runtime } from '../src/sim/runtime.js';

/**
 * TWO READINGS, AND THEY ARE NOT THE SAME QUESTION.
 *
 * `sellable` sums `sellableGoods` over the venues the principal HOLDS the good at, which
 * isolates the floor: it is what the principal could ask if a hand were standing where its
 * goods are. `published` sums over `market.at` — the venues where a hand is PRESENT — which
 * is exactly what `market.endowment.sellable_qty` reports and therefore what an agent reads.
 *
 * They differ whenever the goods and the hands are in different places, which is a separate
 * finding from the floor and must not be attributed to it. Both are printed so the two cannot
 * be confused, and so a change to the floor is measured against `sellable` rather than against
 * a number that also moves when a hand walks.
 */

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

const reckonings = Number(arg('reckonings', '9'));
const members = Number(arg('members', '8'));
const count = Number(arg('count', '8'));
const prefix = arg('seeds-from', 'g');
const explicit = arg('seeds', '');
const seeds: string[] =
  explicit === ''
    ? Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`)
    : explicit.split(',');

interface Observation {
  readonly seed: string;
  readonly reckoning: number;
  readonly principal: PrincipalId;
  readonly held: number;
  readonly sellable: number;
  readonly published: number;
  readonly venues: number;
}

/** What this principal holds of the endowment good, and what it could actually ASK. */
function read(
  runtime: Runtime,
  who: PrincipalId,
  tick: number,
): { held: number; sellable: number; published: number; venues: number } {
  const account = storesAccount(who);
  if (runtime.ledger.account(account) === undefined) {
    return { held: 0, sellable: 0, published: 0, venues: 0 };
  }
  let held = 0;
  const venues = new Set<SystemId>();
  for (const lot of runtime.ledger.lotsInAccount(account)) {
    if (lot.good !== ENDOWMENT_GOOD) continue;
    held += lot.qty;
    venues.add(lot.location);
  }
  let sellable = 0;
  for (const venue of venues) sellable += sellableGoods(runtime.ledger, who, ENDOWMENT_GOOD, venue);
  // The engine's own published field, read through the engine's own accessor rather than
  // recomputed here — a witness with its own copy of the subject can be wrong in exactly the
  // direction that hides (`the-buy-side-is-funded.spec.ts`'s header).
  const view = runtime.marketView(who, tick) as { endowment: { sellable_qty: number } };
  return { held, sellable, published: Number(view.endowment.sellable_qty), venues: venues.size };
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : Math.floor(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
}

const all: Observation[] = [];
let halted = 0;

for (const seed of seeds) {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size: members });
  const roster = cast.seat(seed).map((m) => m.principal);
  for (let i = 0; i < reckonings * TICKS_PER_RECKONING; i += 1) {
    const next = runtime.engine.tick + 1;
    for (const action of cast.decide(next, seed)) runtime.engine.submit(action);
    const report = runtime.runTick();
    if (report.halted) {
      halted += 1;
      break;
    }
    if (!isSettlementTick(report.tick)) continue;
    const reckoning = reckoningIndex(report.tick);
    for (const who of roster) {
      const { held, sellable, published, venues } = read(runtime, who, report.tick);
      all.push({ seed, reckoning, principal: who, held, sellable, published, venues });
    }
  }
  const own = all.filter((o) => o.seed === seed);
  const stuck = own.filter((o) => o.held > 0 && o.sellable === 0).length;
  const stuckPub = own.filter((o) => o.held > 0 && o.published === 0).length;
  process.stdout.write(
    `${seed.padEnd(8)} observations=${String(own.length).padStart(3)}  ` +
      `heldAndCannotSell=${String(stuck).padStart(3)}  ` +
      `publishedZero=${String(stuckPub).padStart(3)}  ` +
      `medianHeld=${String(median(own.map((o) => o.held))).padStart(7)}  ` +
      `medianSellable=${String(median(own.map((o) => o.sellable))).padStart(7)}  ` +
      `split=${String(own.filter((o) => o.venues > 1).length)}\n`,
  );
}

const holding = all.filter((o) => o.held > 0);
const stuck = holding.filter((o) => o.sellable === 0);
/** Principals whose sellable was zero at EVERY Reckoning — locked out rather than briefly short. */
const perPrincipal = new Map<string, Observation[]>();
for (const o of all) {
  const key = `${o.seed}/${String(o.principal)}`;
  perPrincipal.set(key, [...(perPrincipal.get(key) ?? []), o]);
}
let neverSell = 0;
for (const rows of perPrincipal.values()) {
  if (rows.every((o) => o.sellable === 0)) neverSell += 1;
}

const stuckPublished = holding.filter((o) => o.published === 0);
process.stdout.write(
  `\nTOTAL observations=${String(all.length)}  holding=${String(holding.length)}  ` +
    `heldAndCannotSell=${String(stuck.length)} (${((100 * stuck.length) / Math.max(1, all.length)).toFixed(1)}%)  ` +
    `publishedZero=${String(stuckPublished.length)} (${((100 * stuckPublished.length) / Math.max(1, all.length)).toFixed(1)}%)  ` +
    `neverSell=${String(neverSell)}/${String(perPrincipal.size)} principals  ` +
    `medianHeld=${String(median(holding.map((o) => o.held)))}  ` +
    `medianSellable=${String(median(holding.map((o) => o.sellable)))}  ` +
    `splitVenues=${String(all.filter((o) => o.venues > 1).length)}  halted=${String(halted)}\n`,
);
process.stdout.write(
  `RESULT ${JSON.stringify({
    seeds: seeds.length,
    reckonings,
    members,
    observations: all.length,
    holding: holding.length,
    heldAndCannotSell: stuck.length,
    publishedZero: stuckPublished.length,
    neverSellPrincipals: neverSell,
    principals: perPrincipal.size,
    medianHeld: median(holding.map((o) => o.held)),
    medianSellable: median(holding.map((o) => o.sellable)),
    medianPublished: median(holding.map((o) => o.published)),
    splitVenues: all.filter((o) => o.venues > 1).length,
    halted,
  })}\n`,
);
