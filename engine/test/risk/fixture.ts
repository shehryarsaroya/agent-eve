/**
 * Shared scaffolding for the risk suite.
 *
 * **The seat tier is a decision, not a default.** `VULNERABILITY_BY_TIER` puts the Commons at 2,500
 * bps against the Frontier's 10,000, so a fixture that seated in the Commons would make every
 * assertion about a strike four times weaker and some of them vacuous. `riskWorld` seats in the
 * MARCHES — where a front takes 60% of intensity — and `commonsRiskWorld` is the explicit opposite,
 * used to prove §10.1's *"the Commons squall takes goods and never the holding"*.
 *
 * The other decision here is `stockAt`, which sources goods straight from `GOODS_FAUCET.EXTRACTION`
 * rather than running a WORKS. `test/combat/reachable.spec.ts` makes the same call and writes down the
 * same reason: these files prove that the **risk market** works, not that the supply chain does, and
 * spinning up a WORKS per principal would put a `WORKS_SPINUP_TICKS` delay and a tier gate between the
 * test and its subject.
 */

import { expect } from 'vitest';
import { Rng } from '../../src/core/rng.js';
import { TICKS_PER_RECKONING, setSpeed } from '../../src/core/time.js';
import type { GameEvent, GoodId, PrincipalId, SystemId } from '../../src/core/types.js';
import { qty } from '../../src/core/units.js';
import { GOODS_FAUCET, storesAccount } from '../../src/ledger/accounts.js';
import { LEVY_GOOD } from '../../src/levy/index.js';
import { Runtime, type PendingCorrection } from '../../src/sim/runtime.js';
import { announceTickOf, landfallTickOf } from '../../src/risk/index.js';
import { tierOf } from '../../src/world/index.js';

export interface RiskWorld {
  readonly runtime: Runtime;
  readonly principals: readonly PrincipalId[];
  readonly stage: SystemId;
}

export function riskWorld(
  seed: string,
  count = 4,
  tier: 'COMMONS' | 'MARCHES' | 'FRONTIER' = 'MARCHES',
): RiskWorld {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const stage = runtime.seatInTier(tier, Rng.fromSeed(`${seed}:stage`));
  if (stage === undefined) throw new Error(`the launch map has no ${tier} system`);
  const principals: PrincipalId[] = [];
  for (let i = 0; i < count; i += 1) {
    const handle = `rk${String(i + 1).padStart(2, '0')}`;
    const principal = `p:${handle}` as PrincipalId;
    runtime.seat(principal, handle, stage);
    runtime.standing.open(principal);
    principals.push(principal);
  }
  expect(tierOf(runtime.world.map, stage)).toBe(tier);
  return { runtime, principals, stage };
}

export function commonsRiskWorld(seed: string, count = 3): RiskWorld {
  return riskWorld(seed, count, 'COMMONS');
}

/**
 * Name the seats a scenario needs, in one line, **with the arity preserved**.
 *
 * `world.principals[i]` is `PrincipalId | undefined` under `noUncheckedIndexedAccess`, so every fixture
 * that wants eight named roles otherwise opens with eight `if (x === undefined) throw` lines — noise that
 * buries the setup the test is actually about. The mapped tuple over `indexes` keeps each result
 * non-optional, so destructuring reads like the scenario: `const [holder, primary, reinsurer] = …`.
 *
 * It throws rather than padding: a scenario that asked for a seat the world does not have is a scenario
 * whose subject may not exist, which is the failure this whole suite is written against.
 */
export function seatsFor<T extends readonly number[]>(
  world: RiskWorld,
  ...indexes: T
): { [K in keyof T]: PrincipalId } {
  return indexes.map((i) => {
    const seat = world.principals[i];
    if (seat === undefined) {
      throw new Error(
        `the fixture seated ${String(world.principals.length)} principals and this scenario needs seat ` +
          `${String(i)}`,
      );
    }
    return seat;
  }) as { [K in keyof T]: PrincipalId };
}

/** Put located goods in a principal's stores. See the header on why this bypasses the WORKS. */
export function stockAt(
  runtime: Runtime,
  principal: PrincipalId,
  system: SystemId,
  amount: number,
  good: GoodId = LEVY_GOOD,
): void {
  runtime.ledger.sourceGoods({
    eventId: `fixture:stock:${principal}:${system}:${String(amount)}` as never,
    tick: runtime.engine.tick,
    faucet: GOODS_FAUCET.EXTRACTION,
    to: storesAccount(principal),
    good,
    qty: qty(amount),
    location: system,
    origin: principal,
  });
}

/**
 * ★ **GIVE A PAYER MONEY IT EARNED, BECAUSE ITS STAKE CANNOT WRITE COVER — AND THAT IS THE POINT.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * **THE A15 GATE FIRED ON THE FIRST RUN OF THIS SUITE AND IT WAS RIGHT.**
 *
 * A COVER's escrowed half is funded from `market/escrow.ts:freeCash`, which is
 * `freeBalance − endowments.remaining`. A freshly-seated principal has `balance === STARTER_STAKE`
 * and `remaining === STARTER_STAKE`, so its `freeCash` is **exactly zero** and it can write nothing.
 * The first six assertions in `propagates.spec.ts` failed with:
 *
 * > *the escrowed half of a 20000 limit is 15000 and your free cash is 0. Writing cover costs capital
 * > that can be taken — your starter stake is withheld from it, so a fresh identity is worth zero
 * > here (A15, D7).*
 *
 * That is **A15 working exactly as designed**: a gate priced in *slashable capital*, so an operator
 * spinning up sixteen identities buys sixteen zeros. It is also the same shape as the defect that
 * killed the market's buy side for this project's entire life — `SPEC.md` §10's own ⚑ box:
 * *"`freeCash` is identically zero for every principal that has ever played this game… That — not the
 * number of goods — is why 3,065 lines of `market/` had never printed a fill."*
 *
 * So this helper does what a real payer must do: **arrive with money it received rather than money it
 * was given.** A transfer in raises `freeCash` by the whole amount and never touches `remaining`,
 * which is `endowment.ts`'s property (3) and (4) — *"`remaining` falls on retirement only, never on a
 * transfer"*, therefore `freeCash ≤ earned − transferredOut`. The `from` principal's own `freeCash`
 * goes to zero in the same move, so the world's total is conserved and nothing is minted. A sale on
 * the order book, a wage, a venture split or an earned premium all do exactly this.
 *
 * **It is a fixture and not a fix.** Whether D7's floor should withhold the *whole* stake is an A15
 * design call, not a patch, and `SPEC.md` §10 already names it as the open item. What this suite
 * proves is that the risk market works *given* a payer with earned capital; whether the production
 * cast has any is a separate measurement, and `scripts/risk-probe.ts` runs it.
 * ══════════════════════════════════════════════════════════════════════════════
 */
export function fund(
  runtime: Runtime,
  from: PrincipalId,
  to: PrincipalId,
  amount: number,
): void {
  runtime.ledger.transferCurrency({
    eventId: `fixture:fund:${from}:${to}:${String(amount)}` as never,
    tick: runtime.engine.tick,
    from: storesAccount(from),
    to: storesAccount(to),
    amount: amount as never,
  });
}

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

/** Submit one act, run the tick, and return the handler's refusal if there was one. */
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

export function eventsOfKind(runtime: Runtime, kind: string): readonly GameEvent[] {
  const out: GameEvent[] = [];
  for (const t of runtime.events.ticks()) {
    for (const rec of runtime.events.eventsAtTick(t)) {
      if (rec.event.kind === kind) out.push(rec.event);
    }
  }
  return out;
}

/** The first RECKONING that gets a FRONT, and the two ticks that matter in it. */
export const FIRST_FRONT_RECKONING = 3;
export const FIRST_ANNOUNCE_TICK = announceTickOf(FIRST_FRONT_RECKONING);
export const FIRST_LANDFALL_TICK = landfallTickOf(FIRST_FRONT_RECKONING);
export const FIRST_SETTLE_TICK = FIRST_FRONT_RECKONING * TICKS_PER_RECKONING + TICKS_PER_RECKONING - 1;
