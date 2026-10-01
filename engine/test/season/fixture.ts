/**
 * Worlds that start on the season's last day, so the FINALE and the boundary are seconds away
 * instead of fourteen Reckonings.
 *
 * `Runtime({startTick})` opens the season book at the season the first tick falls in
 * (`SeasonBook.openAt`), so a world started inside the FINALE is a faithful Season 1 with nothing
 * closed behind it. Every principal here is seated at the grand stage and handed **earned** capital
 * (issued from civic procurement, the faucet a venture's proceeds come from) — a fresh identity's
 * `freeCash` is exactly zero, and the grand venture is priced in exactly that (A15).
 */

import { buildObservation } from '../../src/api/observe.js';
import { setSpeed } from '../../src/core/time.js';
import type { EventId, HandId, PrincipalId, SystemId, VentureId } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';
import { CURRENCY_FAUCET, storesAccount } from '../../src/ledger/index.js';
import { grandStageFor } from '../../src/season/index.js';
import { grandWindowAt, Runtime } from '../../src/sim/runtime.js';
import type { VentureRecord } from '../../src/venture/index.js';

export const WINDOW = grandWindowAt(1);

export interface FinaleWorld {
  readonly runtime: Runtime;
  readonly stage: SystemId;
}

/** Issue `amount` of EARNED capital to `principal` — the one place these files bypass a verb. */
export function earn(runtime: Runtime, principal: PrincipalId, amount: number, tag = 'earn'): void {
  runtime.ledger.issueCurrency({
    eventId: `test.${tag}:${principal}:${String(runtime.engine.tick)}:${String(amount)}` as EventId,
    tick: Math.max(0, runtime.engine.tick),
    faucet: CURRENCY_FAUCET.CIVIC_PROCUREMENT,
    to: storesAccount(principal),
    amount: minor(amount),
  });
}

/**
 * A world whose first tick is `firstTick` (default: the FINALE's first tick), with `principals`
 * seated AT the grand stage and each holding `cash` of earned capital.
 */
export function finaleWorld(
  seed: string,
  principals: readonly PrincipalId[],
  options: { readonly firstTick?: number; readonly cash?: number; readonly seatAt?: SystemId } = {},
): FinaleWorld {
  setSpeed('instant');
  const runtime = new Runtime({ seed, startTick: (options.firstTick ?? WINDOW.opens_tick) - 1 });
  const stage = grandStageFor(runtime.world.map, 1);
  if (stage === null) throw new Error('the launch map has no Frontier');
  for (const p of principals) {
    runtime.seat(p, p.replace('p:', ''), options.seatAt ?? stage);
    runtime.standing.open(p);
    earn(runtime, p, options.cash ?? 200_000);
  }
  return { runtime, stage };
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

/** Submit and return the door's refusal, or null when the door took it. */
export function tryDoor(
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
  return outcome.ok ? null : { invariant: outcome.invariant, hint: outcome.hint };
}

export function tick(runtime: Runtime): void {
  const report = runtime.runTick();
  if (report.halted) {
    throw new Error(
      `halted at tick ${String(report.tick)}: ` + report.violations.map((v) => `${v.id} ${v.message}`).join(' | '),
    );
  }
}

/** Submit, tick, and return the first correction the tick held for `principal`, or null. */
export function act(
  runtime: Runtime,
  principal: PrincipalId,
  verb: string,
  params: Readonly<Record<string, unknown>>,
): { readonly invariant: string; readonly hint: string } | null {
  const door = tryDoor(runtime, principal, verb, params);
  tick(runtime);
  if (door !== null) return door;
  return runtime.takeCorrections(principal)[0] ?? null;
}

export function runTo(runtime: Runtime, target: number): void {
  while (runtime.engine.tick < target) tick(runtime);
}

export function idleAt(runtime: Runtime, principal: PrincipalId, system: SystemId): HandId {
  const found = [...runtime.world.hands.values()]
    .filter((h) => h.principal === principal && h.state === 'IDLE' && h.location === system)
    .map((h) => h.id)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[0];
  if (found === undefined) throw new Error(`${principal} has no idle hand at ${system}`);
  return found;
}

export function grandVentures(runtime: Runtime): readonly VentureRecord[] {
  return runtime.ventures.all().filter((v) => v.grand !== null);
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
 * Form a grand candidate created by `creator` (optionally on behalf of `onBehalfOf`), filled by
 * `crew` in role order with the given stakes, and signed by every party. Returns its id, LIVE.
 */
export function formCandidate(
  w: FinaleWorld,
  args: {
    readonly creator: PrincipalId;
    readonly onBehalfOf?: PrincipalId;
    readonly crew: readonly PrincipalId[];
    readonly stakes?: readonly number[];
  },
): VentureId {
  const { runtime, stage } = w;
  const before = new Set(grandVentures(runtime).map((v) => v.id));
  const params: Record<string, unknown> = { kind: 'BUILD', stage, grand: true };
  if (args.onBehalfOf !== undefined) params['on_behalf_of'] = args.onBehalfOf;
  const refused = act(runtime, args.creator, 'create', params);
  if (refused !== null) throw new Error(`create refused: ${refused.invariant} ${refused.hint}`);
  const made = grandVentures(runtime).find((v) => !before.has(v.id));
  if (made === undefined) throw new Error('no grand venture was formed');
  for (const [index, p] of args.crew.entries()) {
    submit(runtime, p, 'fill_role', {
      venture: made.id,
      role: index,
      hand: idleAt(runtime, p, stage),
      stake: args.stakes?.[index] ?? 10_000,
    }, index);
  }
  tick(runtime);
  const filled = runtime.ventures.require(made.id);
  const hash = filled.termsHash;
  if (hash === null) throw new Error('no terms_hash');
  const signers = new Set<PrincipalId>([...args.crew]);
  // The creator signs its own terms unless a delegate bound it at formation (the grant is the consent).
  if (args.onBehalfOf === undefined) signers.add(args.creator);
  for (const [i, p] of [...signers].entries()) submit(runtime, p, 'sign', { venture: made.id, terms_hash: hash }, i);
  tick(runtime);
  tick(runtime);
  return made.id;
}
