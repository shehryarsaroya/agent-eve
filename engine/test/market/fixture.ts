/**
 * Shared market fixture.
 *
 * Two shapes, because the module has two halves worth testing separately:
 *
 *   - {@link order} builds a bare `Order` row for the **pure** matcher, so the A4
 *     determinism suite tests the *rule* rather than a whole engine;
 *   - {@link world} seats principals on a real `Runtime`, so escrow, conservation
 *     and the abort path are tested against the actual ledger they have to hold in.
 *
 * No clock and no unseeded draw anywhere: ids are strings the test chooses, which
 * is also how replay works (DET-3).
 */

import type { GoodId, HandId, PrincipalId, SystemId } from '../../src/core/types.js';
import { minor, qty } from '../../src/core/units.js';
import { setSpeed } from '../../src/core/time.js';
import { LEVY_GOOD } from '../../src/levy/index.js';
import { commonsSystems } from '../../src/world/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { orderIdFor, type Order, type Side, type TimeInForce } from '../../src/market/index.js';
import type { EventId } from '../../src/core/types.js';
import { CURRENCY_FAUCET, GOODS_FAUCET, storesAccount } from '../../src/ledger/index.js';
import { ENDOWMENT_GOOD } from '../../src/ledger/endowment.js';

export const ALICE = 'p:alice' as PrincipalId;
export const BOB = 'p:bob' as PrincipalId;
export const CARA = 'p:cara' as PrincipalId;

/** The one good the launch world actually produces, so a book for it is real. */
export const GOOD: GoodId = LEVY_GOOD;

export interface OrderSpec {
  readonly principal: PrincipalId;
  readonly side: Side;
  readonly price: number;
  readonly qty: number;
  /** The tick it entered the book. Seniority, and never wall-clock arrival. */
  readonly tick?: number;
  readonly sequence?: number;
  readonly tif?: TimeInForce;
  readonly venue?: SystemId;
  readonly good?: GoodId;
  readonly filled?: number;
  readonly expires?: number;
}

export const VENUE = 'sys-01' as SystemId;

/** A bare order row for the pure matcher. Never touches a ledger. */
export function order(spec: OrderSpec): Order {
  const placedTick = spec.tick ?? 0;
  const sequence = spec.sequence ?? 0;
  const venue = spec.venue ?? VENUE;
  return {
    id: orderIdFor(spec.principal, placedTick, sequence),
    principal: spec.principal,
    venue,
    good: spec.good ?? GOOD,
    side: spec.side,
    limitPrice: minor(spec.price),
    quantity: qty(spec.qty),
    filled: qty(spec.filled ?? 0),
    timeInForce: spec.tif ?? 'GTC',
    placedTick,
    expiresTick: spec.expires ?? placedTick + 100,
    clientSequence: sequence,
    state: 'OPEN',
    encumbranceId: spec.side === 'BID' ? `enc:mkt:${spec.principal}:${String(sequence)}` : null,
  };
}

export interface MarketWorld {
  readonly runtime: Runtime;
  readonly venue: SystemId;
}

/** A real runtime with principals seated in the Commons, each holding cash and goods. */
export function world(seed: string, ...principals: readonly PrincipalId[]): MarketWorld {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const venue = commonsSystems(runtime.world.map)[0];
  if (venue === undefined) throw new Error('the launch map has no Commons system');
  for (const principal of principals) {
    runtime.seat(principal, principal.replace('p:', ''), venue);
    runtime.standing.open(principal);
    // Fund ABOVE the endowment floor. D7 makes the starter stake non-transferable — it
    // funds a principal's own work and can never be committed to a trade — so a seated
    // principal has exactly zero trading capital by design. These tests are about
    // matching, conservation and abort, not about whether a newcomer may trade, so they
    // need principals with EARNED capital. Granting it here rather than relaxing the
    // floor keeps the guard honest: `test/market/endowment.test.ts` is what asserts a
    // fresh identity can commit nothing.
    fundAboveEndowment(runtime, principal, venue);
  }
  return { runtime, venue };
}

export function submit(
  runtime: Runtime,
  principal: PrincipalId,
  verb: string,
  params: Readonly<Record<string, unknown>>,
  sequence = 0,
): void {
  const outcome = runtime.engine.submit({
    principal,
    verb,
    params,
    clientSequence: sequence,
    arrivalMs: sequence,
    decisionSource: 'LIVE',
  });
  if (!outcome.ok) throw new Error(`submit ${verb}: ${outcome.invariant} ${outcome.hint}`);
}

export function tick(runtime: Runtime): void {
  const report = runtime.runTick();
  if (report.halted) {
    throw new Error(
      `halted at tick ${String(report.tick)}: ` +
        report.violations.map((v) => `${v.id} ${v.message}`).join(' | '),
    );
  }
}

/** Run a tick and hand back the halt report rather than throwing. */
export function tickAllowingHalt(runtime: Runtime): ReturnType<Runtime['runTick']> {
  return runtime.runTick();
}

/** Submit one act, run the tick, and hand back the refusal if there was one. */
export function act(
  runtime: Runtime,
  principal: PrincipalId,
  verb: string,
  params: Readonly<Record<string, unknown>>,
  sequence = 0,
): { readonly invariant: string; readonly hint: string } | null {
  submit(runtime, principal, verb, params, sequence);
  tick(runtime);
  const correction = runtime.takeCorrections(principal)[0];
  return correction === undefined ? null : { invariant: correction.invariant, hint: correction.hint };
}

export function handAt(runtime: Runtime, principal: PrincipalId): HandId {
  const found = [...runtime.world.hands.values()].find((h) => h.principal === principal);
  if (found === undefined) throw new Error(`${principal} has no hand`);
  return found.id;
}

/** Every permutation of a small array, in a fixed order. No randomness (DET-7). */
export function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += 1) {
    const head = items[i];
    if (head === undefined) continue;
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([head, ...tail]);
  }
  return out;
}


/**
 * Give a principal spendable capital on top of its untouchable endowment.
 *
 * Deliberately issued from the same faucets enrolment uses, so supply stays accounted
 * (INV-2 counts against a closed faucet set) and these worlds remain conservation-clean.
 */
export function fundAboveEndowment(
  runtime: Runtime,
  principal: PrincipalId,
  venue: SystemId,
  // Deliberately below the 5,000,000 an adversarial probe uses to test an UNAFFORDABLE
  // reprice: fund the tests enough to trade, never so much that "cannot afford it" stops
  // being reachable. A fixture that quietly makes a refusal path unreachable turns its
  // test green while deleting the thing it checks.
  cash = 2_000_000,
  goods = 100_000,
): void {
  runtime.ledger.issueCurrency({
    eventId: `test:fund:${principal}` as EventId,
    tick: 0,
    faucet: CURRENCY_FAUCET.STARTER_STAKE,
    to: storesAccount(principal),
    amount: minor(cash),
  });
  runtime.ledger.sourceGoods({
    eventId: `test:goods:${principal}` as EventId,
    tick: 0,
    faucet: GOODS_FAUCET.PRODUCTION,
    to: storesAccount(principal),
    good: ENDOWMENT_GOOD,
    qty: qty(goods),
    location: venue,
    origin: principal,
  });
}
