/**
 * A two-system campaign world: a defender holding a claim, an attacker one lane away.
 *
 * Everything here is set up **through the real gates** except two things, and both are argued for
 * rather than assumed:
 *
 *   - **Goods are sourced directly.** `reachable.spec.ts`'s rule: what these files prove is the
 *     reachability and the arithmetic of the mechanic, not the economics of the supply chain, which
 *     is four verbs and a Reckoning boundary away. Sourcing keeps a red result unambiguous — *the
 *     door is shut, not the warehouse empty.*
 *   - **The claim is taken through `build {kind:"ANCHOR"}`**, not written into the book. A campaign's
 *     whole subject is somebody else's claim, and a hand-written `ClaimRecord` would let a test pass
 *     against a claim shape the real handler cannot produce.
 */

import { expect } from 'vitest';
import { setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { EventId, GoodId, PrincipalId, SystemId } from '../../src/core/types.js';
import { minor, qty } from '../../src/core/units.js';
import { Rng } from '../../src/core/rng.js';
import { CURRENCY_FAUCET, GOODS_FAUCET, storesAccount } from '../../src/ledger/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { neighboursOf, tierOf } from '../../src/world/index.js';
import { ALLOY_ANCHOR_QTY, ALLOY_GOOD } from '../../src/works/params.js';
import { ANCHOR_QTY, CHARGE_GOOD, CLAIM_BOND_MINOR } from '../../src/sovereignty/params.js';
import { CAMPAIGN_BOND_MINOR, MATERIEL_GOOD, PULSE_MATERIEL_QTY } from '../../src/campaign/index.js';

export interface CampaignWorld {
  readonly runtime: Runtime;
  /** Holds the claim on {@link objective}. */
  readonly defender: PrincipalId;
  /** Holding stands at {@link depot}, one lane from the objective. */
  readonly attacker: PrincipalId;
  /** A third principal, seated at the objective, for the roster tests. */
  readonly ally: PrincipalId;
  readonly objective: SystemId;
  readonly depot: SystemId;
}

/** Source goods at a place. The one place these files bypass a verb — see the header. */
export function stock(
  runtime: Runtime,
  principal: PrincipalId,
  system: SystemId,
  good: GoodId,
  amount: number,
  tag = 'stock',
): void {
  runtime.ledger.sourceGoods({
    eventId: `test.${tag}:${principal}:${good}:${system}:${String(runtime.engine.tick)}:${String(amount)}` as EventId,
    tick: runtime.engine.tick,
    faucet: GOODS_FAUCET.PRODUCTION,
    to: storesAccount(principal),
    good,
    qty: qty(amount),
    location: system,
    origin: principal,
  });
}

/** Currency, so a bond can actually be locked. */
export function fund(runtime: Runtime, principal: PrincipalId, amount: number, tag = 'fund'): void {
  runtime.ledger.issueCurrency({
    eventId: `test.${tag}:${principal}:${String(runtime.engine.tick)}:${String(amount)}` as EventId,
    tick: runtime.engine.tick,
    faucet: CURRENCY_FAUCET.STARTER_STAKE,
    to: storesAccount(principal),
    amount: minor(amount),
  });
}

export function tick(runtime: Runtime): void {
  runtime.runTick();
}

export function runTo(runtime: Runtime, target: number): void {
  while (runtime.engine.tick < target) runtime.runTick();
}

/**
 * Submit one act and return **either** refusal — the door's or the handler's.
 *
 * Two doors refuse and they are not interchangeable: the Commons floor and the verb table refuse at
 * `submit`, before the tick; a handler refuses during `VALIDATE+LOCK` and its sentence arrives on the
 * correction channel. A test that watched one would pass silently while the other was broken, and for
 * campaigns it is the FLOOR that matters most — §16.6 MUST-1 is the one absolute in the section.
 */
export function act(
  runtime: Runtime,
  principal: PrincipalId,
  verb: string,
  params: Readonly<Record<string, unknown>>,
): { readonly invariant: string; readonly hint: string } | null {
  const door = runtime.engine.submit({
    principal,
    verb,
    params,
    clientSequence: 0,
    arrivalMs: runtime.engine.tick,
    decisionSource: 'LIVE',
  });
  runtime.runTick();
  if (!door.ok) return { invariant: door.invariant, hint: door.hint };
  const correction = runtime.takeCorrections(principal)[0];
  return correction === undefined ? null : { invariant: correction.invariant, hint: correction.hint };
}

/**
 * Two adjacent non-Commons systems with a live claim on one of them.
 *
 * The defender's claim is raised through `build`, so it carries the state and the terms the real
 * handler produces. The attacker is seated one lane away with materiel and a bond.
 */
export function campaignWorld(seed: string): CampaignWorld {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const objective = runtime.seatInTier('MARCHES', Rng.fromSeed(`${seed}:objective`));
  if (objective === undefined) throw new Error('the launch map has no MARCHES system');
  const depot = neighboursOf(runtime.world.map, objective).find(
    (s) => tierOf(runtime.world.map, s) !== 'COMMONS',
  );
  if (depot === undefined) throw new Error(`${objective} has no non-Commons neighbour`);

  const defender = 'p:cd01' as PrincipalId;
  const attacker = 'p:ca01' as PrincipalId;
  const ally = 'p:cy01' as PrincipalId;
  runtime.seat(defender, 'cd01', objective);
  runtime.seat(attacker, 'ca01', depot);
  runtime.seat(ally, 'cy01', objective);
  for (const p of [defender, attacker, ally]) runtime.standing.open(p);

  // The claim, through the front door.
  stock(runtime, defender, objective, CHARGE_GOOD, ANCHOR_QTY, 'anchor');
  stock(runtime, defender, objective, ALLOY_GOOD, ALLOY_ANCHOR_QTY, 'anchor-alloy');
  fund(runtime, defender, CLAIM_BOND_MINOR * 3, 'bond');
  tick(runtime);
  expect(act(runtime, defender, 'post_bond', { amount: CLAIM_BOND_MINOR })).toBeNull();
  expect(act(runtime, defender, 'build', { kind: 'ANCHOR', system: objective })).toBeNull();
  const claim = runtime.sovereignty.liveAt(objective);
  expect(claim, 'the fixture must produce a real live claim through `build`').not.toBeNull();
  expect(claim?.claimant).toBe(defender);

  // The attacker: capital for a bond, and materiel for as many pulses as any test can need.
  fund(runtime, attacker, CAMPAIGN_BOND_MINOR * 3, 'war-chest');
  stock(runtime, attacker, depot, MATERIEL_GOOD, PULSE_MATERIEL_QTY * 8, 'materiel');
  fund(runtime, ally, CAMPAIGN_BOND_MINOR, 'ally-chest');
  tick(runtime);

  return { runtime, defender, attacker, ally, objective, depot };
}

/** The tick a campaign declared at `from` first pulses at, without importing the derivation. */
export function nextPulseAfter(from: number, pulsePhase: number): number {
  const cycleStart = from - (from % TICKS_PER_RECKONING);
  return cycleStart + TICKS_PER_RECKONING + pulsePhase;
}
