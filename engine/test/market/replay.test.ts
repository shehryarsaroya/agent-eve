/**
 * **A world with a live book replays from the journal, byte for byte.**
 *
 * §15.1: replay's input is `(snapshot, action_log, seed)` and *events are output,
 * not input*. Boot reconstructs the world by re-running the recorded actions
 * through the same engine, so an order book needs **no schema row of its own** to
 * survive a restart — but "needs none" is a claim, and the class of bug it belongs
 * to is the one this project keeps finding: a table that is outside the hash, or a
 * phase whose result depends on something the action log does not carry.
 *
 * So the whole loop is exercised: run a world that places, rests, crosses and
 * cancels orders while journalling every tick, discard the runtime, boot a fresh
 * one from the store alone, and compare the `state_hash` with `toBe`. If the market
 * introduced any nondeterminism — a Map iterated in insertion order, an id from a
 * counter, a fill whose price depended on arrival — this is where it surfaces,
 * because the two runs build the same book by two different routes.
 */

import { describe, expect, it } from 'vitest';
import { setSpeed } from '../../src/core/time.js';
import { Runtime } from '../../src/sim/runtime.js';
import { InMemoryJournalStore, Journal, bootFromStore } from '../../src/persist/index.js';
import { commonsSystems } from '../../src/world/index.js';
import type { PrincipalId } from '../../src/core/types.js';
import { fundAboveEndowment } from './fixture.js';
import { ALICE, BOB, CARA, GOOD } from './fixture.js';

const SEED = 'market-replay-1';
const TRADERS: PrincipalId[] = [ALICE, BOB, CARA];

/** A scripted market: rests, crosses, partly fills, cancels, and expires. */
function script(tick: number, venue: string): { principal: PrincipalId; params: Record<string, unknown> }[] {
  const round = tick % 6;
  switch (round) {
    case 1:
      return [
        {
          principal: ALICE,
          params: { operation: 'place', venue, good: GOOD, side: 'ASK', quantity: 40, limit_price: 10, duration_ticks: 30 },
        },
        {
          principal: BOB,
          params: { operation: 'place', venue, good: GOOD, side: 'ASK', quantity: 25, limit_price: 11, duration_ticks: 30 },
        },
      ];
    case 2:
      return [
        {
          principal: CARA,
          params: { operation: 'place', venue, good: GOOD, side: 'BID', quantity: 50, limit_price: 12 },
        },
      ];
    case 4:
      return [
        {
          principal: ALICE,
          params: { operation: 'place', venue, good: GOOD, side: 'BID', quantity: 6, limit_price: 3, time_in_force: 'IOC' },
        },
        {
          principal: BOB,
          params: { operation: 'place', venue, good: GOOD, side: 'ASK', quantity: 9, limit_price: 40, duration_ticks: 2 },
        },
      ];
    default:
      return [];
  }
}

/** A genesis runtime seated exactly as `serve()` would, live and rebooted alike. */
function seated(): { readonly runtime: Runtime; readonly venue: string } {
  setSpeed('instant');
  const runtime = new Runtime({ seed: SEED });
  const venue = commonsSystems(runtime.world.map)[0];
  if (venue === undefined) throw new Error('the launch map has no Commons system');
  for (const p of TRADERS) {
    runtime.seat(p, p.replace('p:', ''), venue);
    runtime.standing.open(p);
    fundAboveEndowment(runtime, p, venue);
  }
  return { runtime, venue };
}

async function runLive(ticks: number): Promise<{
  readonly store: InMemoryJournalStore;
  readonly hash: string;
  readonly headTick: number;
  readonly fills: number;
  readonly openOrders: number;
  readonly orderRows: readonly string[];
  readonly printRows: readonly string[];
}> {
  const { runtime, venue } = seated();

  const store = new InMemoryJournalStore();
  const journal = new Journal(store);
  await bootFromStore(runtime, store, { seed: SEED });

  for (let i = 0; i < ticks; i += 1) {
    const target = runtime.engine.tick + 1;
    for (const [n, act] of script(target, venue).entries()) {
      runtime.engine.submit({
        principal: act.principal,
        verb: 'trade',
        params: act.params,
        clientSequence: n,
        arrivalMs: n,
        decisionSource: 'LIVE',
      });
    }
    const report = runtime.runTick();
    if (report.halted) {
      throw new Error(
        `the live market sim halted at tick ${String(report.tick)}: ` +
          report.violations.map((v) => `${v.id} ${v.message}`).join(' | '),
      );
    }
    journal.record(runtime, report);
    await journal.flushPending();
  }
  await journal.drain();
  return {
    store,
    hash: runtime.engine.stateHash,
    headTick: runtime.engine.tick,
    fills: runtime.market.fills().length,
    openOrders: runtime.market.countOpen(),
    orderRows: runtime.market.all().map((o) => `${o.id}::${String(o.filled)}::${o.state}`),
    printRows: runtime.market.prints().map((p) => `${p.id}::${String(p.unitPrice)}::${String(p.qty)}`),
  };
}

describe('a world with a live order book boots from its journal', () => {
  it('reproduces the exact state_hash, the fills and the resting book', async () => {
    const live = await runLive(30);
    // The scenario has to have actually traded, or the round-trip proves nothing.
    expect(live.fills, 'the scripted market never crossed').toBeGreaterThan(0);
    expect(live.openOrders, 'the scripted market left nothing resting').toBeGreaterThan(0);

    // A fresh, empty runtime seated the same way — exactly what `serve()` builds
    // before it hands the store to boot. Nothing of the live one is carried over.
    const { runtime: rebooted } = seated();
    const outcome = await bootFromStore(rebooted, live.store, { seed: SEED });
    expect(outcome.mode).toBe('REPLAY');
    expect(outcome.headTick).toBe(live.headTick);

    expect(rebooted.engine.tick).toBe(live.headTick);
    expect(
      rebooted.engine.stateHash,
      'a market world did not replay to the same hash — the book carries state the action log does not',
    ).toBe(live.hash);
    expect(rebooted.market.fills().length).toBe(live.fills);
    expect(rebooted.market.countOpen()).toBe(live.openOrders);
    // Row-for-row against the run that is now gone. An id minted from a counter
    // rather than from content survives a count comparison and fails here (DET-3,
    // DET-5), as does a fill whose price depended on arrival order.
    expect(rebooted.market.all().map((o) => `${o.id}::${String(o.filled)}::${o.state}`)).toEqual(live.orderRows);
    expect(
      rebooted.market.prints().map((p) => `${p.id}::${String(p.unitPrice)}::${String(p.qty)}`),
    ).toEqual(live.printRows);
  });

  it('two live runs of the same script produce the same book, so the replay target is stable', async () => {
    const a = await runLive(20);
    const b = await runLive(20);
    expect(a.hash).toBe(b.hash);
    expect(a.fills).toBe(b.fills);
  });
});
