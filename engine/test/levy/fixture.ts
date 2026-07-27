/**
 * Shared scaffolding for the Levy suite.
 *
 * Two kinds of fixture, deliberately separate:
 *
 *   - {@link subject} builds a `LevySubject` by hand, for the pure arithmetic tests. No
 *     runtime, no ledger, no clock.
 *   - {@link levyWorld} seats principals in a real `Runtime`, which is the only way to
 *     test the parts that matter most: the verbs, the tick order, INV-24/INV-25 running
 *     in the real ASSERT phase, and the A5′ guard against the real settlement.
 *
 * The clock, restated because two tests once disagreed about it:
 * `quiet 0..262 · commitment 263..285 · freeze 286 · settlement 287`, and the LEVY ballot
 * for the next Reckoning closes at 263 — where the commitment window opens.
 */

import { expect } from 'vitest';
import { TICKS_PER_RECKONING, setSpeed } from '../../src/core/time.js';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import { minor, qty, type Minor } from '../../src/core/units.js';
import type { LevySubject } from '../../src/levy/index.js';
import {
  LEVY_NEWCOMER_CAPITAL_MINOR,
  LEVY_NEWCOMER_TENURE_TICKS,
} from '../../src/levy/index.js';
import { Runtime, type PendingCorrection } from '../../src/sim/runtime.js';
import { commonsSystems } from '../../src/world/index.js';

export const SETTLE_TICK = TICKS_PER_RECKONING - 1;
export const FREEZE_TICK = SETTLE_TICK - 1;

/**
 * A veteran with the given EXPOSURE and stores. Past both newcomer thresholds.
 *
 * `levyGoodHeld` defaults to **`freeStores`**, deliberately, so every arithmetic test written
 * before the two halves of STORES were split keeps asserting the same numbers: the old
 * `BY_STORES` weight was `1 + freeStores`, and with the two equal by default the new one is
 * arithmetically identical. A test that cares about the difference passes `levyGoodHeld`
 * explicitly — which is what `weightOf`'s own suite now does.
 */
export function subject(
  principal: string,
  over: {
    readonly exposure?: number;
    readonly freeStores?: number;
    readonly levyGoodHeld?: number;
    readonly tenureTicks?: number;
  } = {},
): LevySubject {
  const freeStores = over.freeStores ?? LEVY_NEWCOMER_CAPITAL_MINOR;
  return {
    principal: principal as PrincipalId,
    tenureTicks: over.tenureTicks ?? LEVY_NEWCOMER_TENURE_TICKS,
    freeStores: minor(freeStores),
    levyGoodHeld: qty(over.levyGoodHeld ?? freeStores),
    exposure: minor(over.exposure ?? 0),
  };
}

/** A principal inside the newcomer floor: short tenure **and** thin capital. */
export function newcomer(principal: string, over: { readonly exposure?: number } = {}): LevySubject {
  return {
    principal: principal as PrincipalId,
    tenureTicks: 0,
    freeStores: minor(0),
    levyGoodHeld: qty(0),
    exposure: minor(over.exposure ?? 0),
  };
}

export interface LevyWorld {
  readonly runtime: Runtime;
  readonly principals: readonly PrincipalId[];
  readonly stage: SystemId;
}

/**
 * A world with `count` principals seated in one Commons system.
 *
 * All in one system on purpose: the delivery place is the constellation's lowest-id
 * Commons system, so seating everybody in a single Commons system does *not* guarantee
 * they are standing on it — which is the point. Presence has to be earned by moving.
 */
export function levyWorld(seed: string, count = 3, seatIndex = 0): LevyWorld {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  // `seatIndex` matters: the delivery place is the constellation's **lowest-id** Commons
  // system, so `seatIndex: 0` seats everybody standing on it and any test about the journey
  // would pass vacuously. Tests that need distance pass a non-zero index.
  const stage = commonsSystems(runtime.world.map)[seatIndex];
  if (stage === undefined) throw new Error('the launch map has no Commons system at that index');
  const principals: PrincipalId[] = [];
  for (let i = 0; i < count; i += 1) {
    const handle = `lp${String(i + 1).padStart(2, '0')}`;
    const principal = `p:${handle}` as PrincipalId;
    runtime.seat(principal, handle, stage);
    runtime.standing.open(principal);
    principals.push(principal);
  }
  return { runtime, principals, stage };
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

/**
 * Submit one act and return **either** refusal, whichever the engine produced.
 *
 * Two doors refuse an action and they are not interchangeable: the Commons floor and the
 * verb table refuse at `submit`, before the tick; a handler refuses during
 * `VALIDATE+LOCK` and its sentence arrives on the correction channel. A test that only
 * looked at one door would silently pass while the other was broken — and it is the
 * submit door that refuses a mis-cased ballot kind, which is exactly the case worth
 * covering.
 */
export function attempt(
  runtime: Runtime,
  principal: PrincipalId,
  verb: string,
  params: Readonly<Record<string, unknown>>,
): { readonly invariant: string; readonly hint: string } | null {
  const outcome = runtime.engine.submit({
    principal,
    verb,
    params,
    clientSequence: 0,
    arrivalMs: 0,
    decisionSource: 'LIVE',
  });
  if (!outcome.ok) {
    // Refused at the door. Still run a tick so the caller's clock advances the same way it
    // would have, or a loop over hostile params would sit still and prove nothing.
    tick(runtime);
    return { invariant: outcome.invariant, hint: outcome.hint };
  }
  tick(runtime);
  const correction = runtime.takeCorrections(principal)[0];
  return correction === undefined ? null : { invariant: correction.invariant, hint: correction.hint };
}

/** Submit one act, run the tick, and return the refusal if the handler refused. */
export function act(
  runtime: Runtime,
  principal: PrincipalId,
  verb: string,
  params: Readonly<Record<string, unknown>>,
): PendingCorrection | null {
  submit(runtime, principal, verb, params);
  tick(runtime);
  return runtime.takeCorrections(principal)[0] ?? null;
}

/** Run one tick and fail loudly on a halt: a halted world makes every later assert a lie. */
export function tick(runtime: Runtime): void {
  const report = runtime.runTick();
  if (report.halted) {
    throw new Error(
      `halted at tick ${String(report.tick)}: ` +
        report.violations.map((v) => `${v.id} ${v.message}`).join(' | '),
    );
  }
  expect(report.violations.filter((v) => v.severity === 'HALT')).toEqual([]);
}

export function runTo(runtime: Runtime, target: number): void {
  while (runtime.engine.tick < target) tick(runtime);
}

/**
 * Walk a principal's first hand to the delivery place, one gate at a time.
 *
 * Uses the engine's own `move` verb and the engine's own clock, so the journey takes the
 * real number of ticks. A fixture that teleported a hand would prove the delivery gate
 * against a world that cannot happen.
 */
export function walkToPlace(runtime: Runtime, principal: PrincipalId, limit = 60): SystemId {
  const block = runtime.levyBlockFor(principal, runtime.engine.tick);
  if (block === null) throw new Error(`${principal} holds no Levy assessment to walk toward`);
  const place = block.deliverable_to;
  for (let n = 0; n < limit; n += 1) {
    const hands = [...runtime.world.hands.values()].filter((h) => h.principal === principal);
    const idle = hands.find((h) => h.state === 'IDLE' && h.location !== place);
    const there = hands.find((h) => h.state === 'IDLE' && h.location === place);
    if (there !== undefined) return place;
    if (idle === undefined) {
      tick(runtime);
      continue;
    }
    const system = runtime.world.map.systems.get(idle.location);
    const next = system?.lanes.find((lane) => lane === place) ?? place;
    const refusal = act(runtime, principal, 'move', { hand: idle.id, to: next });
    if (refusal !== null) tick(runtime);
  }
  throw new Error(`${principal} could not reach ${place} within ${String(limit)} ticks`);
}

export function assessmentOf(runtime: Runtime, principal: PrincipalId): Minor {
  return runtime.levy.assessmentOf(Math.floor(runtime.engine.tick / TICKS_PER_RECKONING), principal);
}
