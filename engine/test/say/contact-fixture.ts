/**
 * Scaffolding for the `RULES_VERSION` 41 contact suite — reach ties, answers, the directory.
 *
 * Everything here goes **through the real verbs** except currency, which is sourced so a principal
 * can be made ENTITLED to speak first without four Reckonings of setup. That is the one bypass, and it
 * is the same one `test/campaign/fixture.ts` argues for: what these files prove is who may address
 * whom and at what price, not how the economy funds a first wage. Every reach situation — a raid side,
 * a finished venture, a syndicate seat, an offer — is produced by the handler that produces it in a
 * live world, so a green result here is about the rule and not about a hand-written book row.
 */

import { expect } from 'vitest';
import { buildObservation } from '../../src/api/observe.js';
import { Rng } from '../../src/core/rng.js';
import { setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { EventId, HandId, PrincipalId, SystemId, VentureId } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';
import { CURRENCY_FAUCET, storesAccount } from '../../src/ledger/index.js';
import { Runtime, type PendingCorrection } from '../../src/sim/runtime.js';
import { IN_FULL, openIndices } from '../../src/venture/index.js';

export const SETTLEMENT = TICKS_PER_RECKONING - 1;

export interface ContactWorld {
  readonly runtime: Runtime;
  readonly stage: SystemId;
}

/** `principals` seated at one system of `tier`, each with an open standing row. */
export function contactWorld(
  seed: string,
  principals: readonly PrincipalId[],
  tier: 'COMMONS' | 'MARCHES' = 'COMMONS',
): ContactWorld {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const stage = runtime.seatInTier(tier, Rng.fromSeed(`${seed}:stage`));
  if (stage === undefined) throw new Error(`the launch map has no ${tier} system`);
  for (const principal of principals) {
    runtime.seat(principal, principal.replace('p:', ''), stage);
    runtime.standing.open(principal);
  }
  return { runtime, stage };
}

/** Seat one more principal at a given system. */
export function seatAt(world: ContactWorld, principal: PrincipalId, system: SystemId): void {
  world.runtime.seat(principal, principal.replace('p:', ''), system);
  world.runtime.standing.open(principal);
}

/**
 * Currency somebody "paid" this principal — the entitlement's second term, sourced. `freeCash` is
 * `freeBalance − endowment remaining`, and an issue to stores does not move the endowment counter,
 * so this is exactly the transferable balance a wage would have left.
 */
export function entitle(runtime: Runtime, principal: PrincipalId, amount = 5_000): void {
  runtime.ledger.issueCurrency({
    eventId: `test.entitle:${principal}:${String(runtime.engine.tick)}:${String(amount)}` as EventId,
    tick: runtime.engine.tick,
    faucet: CURRENCY_FAUCET.STARTER_STAKE,
    to: storesAccount(principal),
    amount: minor(amount),
  });
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

export function runTo(runtime: Runtime, target: number): void {
  while (runtime.engine.tick < target) tick(runtime);
}

/** Submit one act, run the tick, and hand back the handler's or the door's refusal, if any. */
export function act(
  runtime: Runtime,
  principal: PrincipalId,
  verb: string,
  params: Readonly<Record<string, unknown>>,
  sequence = 0,
): { readonly invariant: string; readonly hint: string } | null {
  const outcome = runtime.engine.submit({
    principal,
    verb,
    params,
    clientSequence: sequence,
    arrivalMs: sequence,
    decisionSource: 'LIVE',
  });
  tick(runtime);
  if (!outcome.ok) return { invariant: outcome.invariant, hint: outcome.hint };
  const correction: PendingCorrection | undefined = runtime.takeCorrections(principal)[0];
  return correction === undefined ? null : { invariant: correction.invariant, hint: correction.hint };
}

export function idleOf(runtime: Runtime, principal: PrincipalId): HandId {
  const found = [...runtime.world.hands.values()].find((h) => h.principal === principal && h.state === 'IDLE');
  if (found === undefined) throw new Error(`${principal} has no idle hand`);
  return found.id;
}

export function observe(runtime: Runtime, principal: PrincipalId): ReturnType<typeof buildObservation> {
  return buildObservation({
    runtime,
    principal,
    serverNowMs: 0,
    fresh: true,
    wakesRemaining: 16,
    stale: false,
    corrections: [],
    correctionsDropped: 0,
    actionsRemaining: 4,
  });
}

/**
 * Take every `seal` the menu offers. PROP-D4 refuses `create` and `fill_role` while a sealable role is
 * unsealed, so a test about anything else has to clear it first or it measures the wrong rule.
 */
export function sealEverything(runtime: Runtime, principal: PrincipalId): void {
  for (const offered of observe(runtime, principal).affordances) {
    if (offered.verb !== 'seal') continue;
    const refusal = act(runtime, principal, 'seal', offered.params);
    if (refusal !== null) throw new Error(`the seal affordance was refused: ${refusal.hint}`);
  }
}

/**
 * A HAUL from `payer` with `filler` on role 1, taken to LIVE through the real verbs, its elective
 * half stated IN_FULL — the shape that makes the payer's `distinct_counterparties` move when it
 * settles.
 */
export function liveHaul(world: ContactWorld, payer: PrincipalId, filler: PrincipalId): VentureId {
  const { runtime, stage } = world;
  sealEverything(runtime, payer);
  sealEverything(runtime, filler);
  submit(runtime, payer, 'create', { kind: 'HAUL', stage, value: 12_000 });
  tick(runtime);
  const made = runtime.ventures
    .all()
    .find((v) => v.creator === payer && v.state === 'FORMING' && openIndices(v).length === 2);
  if (made === undefined) throw new Error('create did not mint a FORMING HAUL');
  submit(runtime, payer, 'fill_role', { venture: made.id, role: 0, hand: idleOf(runtime, payer) });
  tick(runtime);
  submit(runtime, filler, 'fill_role', { venture: made.id, role: 1, hand: idleOf(runtime, filler) });
  tick(runtime);
  const hash = runtime.ventures.require(made.id).termsHash;
  if (hash === null) throw new Error('no terms_hash after both roles filled');
  submit(runtime, payer, 'sign', { venture: made.id, terms_hash: hash }, 0);
  submit(runtime, filler, 'sign', { venture: made.id, terms_hash: hash }, 1);
  tick(runtime);
  tick(runtime);
  expect(runtime.ventures.require(made.id).state, 'the HAUL must reach LIVE').toBe('LIVE');
  expect(act(runtime, payer, 'elect', { venture: made.id, role: 1, election: IN_FULL })).toBeNull();
  return made.id;
}

/** The parley rows `affordances[]` carries — `message {to}` and nothing else. */
export function parleyOffers(
  runtime: Runtime,
  principal: PrincipalId,
): readonly ReturnType<typeof observe>['affordances'][number][] {
  return observe(runtime, principal).affordances.filter(
    (a) => a.verb === 'message' && (a.params as Record<string, unknown>)['to'] !== undefined,
  );
}
