#!/usr/bin/env node
/**
 * PARLEY PROBE — **is the price A15-safe, and is it payable?**
 *
 * A gate can fail in two directions and this measures both, because the argument for the price is
 * only worth what the numbers say:
 *
 *   1. **THE SYBIL DIRECTION — is it safe?** Enrol N identities that do nothing. Count what they may
 *      say and to whom. The claim is **zero on every column**: zero reachable principals, zero
 *      allowance, zero `message {to}` affordances, zero accepted parleys. If any column is positive,
 *      the gate is priced in identities and A15 is broken.
 *
 *   2. **THE DEAD-MECHANIC DIRECTION — is it payable?** Run a heuristic world nobody steers and count
 *      how many principals are ENTITLED, how many have somebody to address, and how many would be
 *      offered the act. This project's signature defect is a mechanism built, tested, reported
 *      complete and used by nothing — eighteen instances — and a price nobody can pay produces
 *      exactly that, with a green suite. A gate that admits 1 of 12 is a gate that shipped dead.
 *
 * ```
 * npx tsx scripts/parley-probe.ts --seeds-from g --count 8 --reckonings 3
 * ```
 */

import { HeuristicCast } from '../src/cast/index.js';
import { buildObservation } from '../src/api/observe.js';
import { setSpeed, TICKS_PER_RECKONING } from '../src/core/time.js';
import type { PrincipalId } from '../src/core/types.js';
import { freeCash } from '../src/market/escrow.js';
import { Runtime } from '../src/sim/runtime.js';

interface Row {
  readonly seed: string;
  readonly members: number;
  /** Principals whose entitlement is open: a kept elective promise, or currency somebody paid them. */
  readonly entitled: number;
  /** Of those, how many got there through `distinct_counterparties` (the A15-strong term). */
  readonly viaStanding: number;
  /** Of those, how many through `freeCash` (the reachable term). */
  readonly viaEarnings: number;
  /** Principals with at least one reachable recipient, entitled or not. */
  readonly withReach: number;
  /** Σ reachable recipients over the cast. */
  readonly reachRows: number;
  /** Principals whose menu actually carried a `message {to}` row. **The number that matters.** */
  readonly offered: number;
  /** Σ `message {to}` affordances published across the cast at the final tick. */
  readonly offers: number;
  readonly campaigns: number;
  readonly liveGrants: number;
  readonly halted: boolean;
}

/** A fresh identity, enrolled and left alone. The Sybil column. */
interface Sybil {
  readonly reach: number;
  readonly allowance: number;
  readonly offers: number;
  /** Did the engine accept a parley from it? Must be 0. */
  readonly accepted: number;
}

function observe(runtime: Runtime, principal: PrincipalId): ReturnType<typeof buildObservation> {
  return buildObservation({
    runtime,
    principal,
    serverNowMs: 0,
    fresh: true,
    wakesRemaining: 4,
    stale: false,
    corrections: [],
    correctionsDropped: 0,
    actionsRemaining: 4,
  });
}

function runOne(seed: string, ticks: number, members: number, sybils: number): {
  readonly row: Row;
  readonly sybil: Sybil;
} {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size: members });
  cast.seat(seed);
  let halted = false;

  for (let n = 0; n < ticks; n += 1) {
    const tick = runtime.engine.tick + 1;
    for (const action of cast.decide(tick, seed)) runtime.engine.submit(action);
    for (const member of cast.roster) runtime.takeCorrections(member.principal);
    if (runtime.runTick().halted) {
      halted = true;
      break;
    }
  }

  // ── 1. THE CAST: is the price payable? ────────────────────────────────────
  const tick = runtime.engine.tick;
  let entitled = 0;
  let viaStanding = 0;
  let viaEarnings = 0;
  let withReach = 0;
  let reachRows = 0;
  let offered = 0;
  let offers = 0;
  for (const member of cast.roster) {
    const capacity = runtime.parleysFor(member.principal, tick);
    const standing = runtime.standing.row(member.principal).distinctCounterparties;
    const earned = freeCash(runtime.ledger, member.principal);
    if (capacity.parleys_per_reckoning > 0) entitled += 1;
    if (standing > 0) viaStanding += 1;
    if (earned > 0) viaEarnings += 1;
    if (capacity.reachable_principals > 0) withReach += 1;
    reachRows += capacity.reachable_principals;
    const rows = observe(runtime, member.principal).affordances.filter(
      (a) => a.verb === 'message' && (a.params as Record<string, unknown>)['to'] !== undefined,
    );
    if (rows.length > 0) offered += 1;
    offers += rows.length;
  }

  // ── 2. THE SYBILS: is the price safe? ─────────────────────────────────────
  //
  // Enrolled at the END of the run, into a world that already has campaigns, claims and grants —
  // the most favourable moment for a free identity, because every situation reach can read already
  // exists. Enrolled and left alone, which is the whole point: the claim is that PLAYING buys reach
  // and ENROLLING does not.
  let sybilReach = 0;
  let sybilAllowance = 0;
  let sybilOffers = 0;
  let sybilAccepted = 0;
  const targets = cast.roster.map((m) => m.principal);
  for (let n = 0; n < sybils; n += 1) {
    const id = `p:sybil${String(n).padStart(2, '0')}` as PrincipalId;
    runtime.seat(id, `sybil${String(n)}`);
    runtime.standing.open(id);
  }
  runtime.runTick();
  for (let n = 0; n < sybils; n += 1) {
    const id = `p:sybil${String(n).padStart(2, '0')}` as PrincipalId;
    const capacity = runtime.parleysFor(id, runtime.engine.tick);
    sybilReach += capacity.reachable_principals;
    sybilAllowance += capacity.parleys_per_reckoning;
    sybilOffers += observe(runtime, id).affordances.filter(
      (a) => a.verb === 'message' && (a.params as Record<string, unknown>)['to'] !== undefined,
    ).length;
    // And the hard test: send one anyway, by hand, past the menu. An engine that accepts it has a
    // free channel whatever the affordance says — the probe that found this defect got in exactly
    // that way, by hand-building a call the menu never offered.
    for (const target of targets) {
      const door = runtime.engine.submit({
        principal: id,
        verb: 'message',
        params: { to: target, act: 'offer', text: 'PAY ME TO STAND DOWN' },
        clientSequence: 0,
        arrivalMs: runtime.engine.tick,
        decisionSource: 'LIVE',
      });
      if (!door.ok) continue;
      runtime.runTick();
      if (runtime.takeCorrections(id).every((c) => c.verb !== 'message')) sybilAccepted += 1;
    }
  }

  return {
    row: {
      seed,
      members,
      entitled,
      viaStanding,
      viaEarnings,
      withReach,
      reachRows,
      offered,
      offers,
      campaigns: runtime.campaigns.live().length,
      liveGrants: runtime.grants.all().filter((g) => runtime.grants.isLive(g.id, tick)).length,
      halted,
    },
    sybil: { reach: sybilReach, allowance: sybilAllowance, offers: sybilOffers, accepted: sybilAccepted },
  };
}

function parse(argv: readonly string[]): {
  readonly seeds: readonly string[];
  readonly ticks: number;
  readonly members: number;
  readonly sybils: number;
} {
  let seeds: string[] = ['gate-a', 'gate-b', 'gate-c', 'gate-d'];
  let reckonings = 3;
  let members = 12;
  let sybils = 10;
  let prefix: string | null = null;
  let count = 8;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === undefined) continue;
    if (value === undefined) throw new Error(`${flag} needs a value`);
    switch (flag) {
      case '--seeds':
        seeds = value.split(',');
        break;
      case '--seeds-from':
        prefix = value;
        break;
      case '--count':
        count = Number.parseInt(value, 10);
        break;
      case '--reckonings':
        reckonings = Number.parseInt(value, 10);
        break;
      case '--members':
        members = Number.parseInt(value, 10);
        break;
      case '--sybils':
        sybils = Number.parseInt(value, 10);
        break;
      default:
        throw new Error(`unknown flag ${flag}`);
    }
    i += 1;
  }
  if (prefix !== null) {
    seeds = [];
    for (let n = 1; n <= count; n += 1) seeds.push(`${prefix}${String(n).padStart(2, '0')}`);
  }
  return { seeds, ticks: reckonings * TICKS_PER_RECKONING, members, sybils };
}

const args = parse(process.argv.slice(2));
process.stdout.write(
  `parley probe — ${String(args.seeds.length)} seeds x ${String(args.ticks)} ticks x ` +
    `${String(args.members)} members, ${String(args.sybils)} free identities each\n\n`,
);
process.stdout.write(
  'seed     entitled  viaStand  viaEarn  withReach  Σreach  offered  Σoffers  camps  grants\n',
);
const rows: Row[] = [];
const sybils: Sybil[] = [];
for (const seed of args.seeds) {
  const { row, sybil } = runOne(seed, args.ticks, args.members, args.sybils);
  rows.push(row);
  sybils.push(sybil);
  process.stdout.write(
    `${seed.padEnd(9)}${String(row.entitled).padStart(8)}${String(row.viaStanding).padStart(10)}` +
      `${String(row.viaEarnings).padStart(9)}${String(row.withReach).padStart(11)}` +
      `${String(row.reachRows).padStart(8)}${String(row.offered).padStart(9)}` +
      `${String(row.offers).padStart(9)}${String(row.campaigns).padStart(7)}` +
      `${String(row.liveGrants).padStart(8)}${row.halted ? '  HALTED' : ''}\n`,
  );
}

const sum = (ns: readonly number[]): number => ns.reduce((a, b) => a + b, 0);
const seatsTotal = sum(rows.map((r) => r.members));
process.stdout.write(
  `\nCAST (is the price payable?)  entitled ${String(sum(rows.map((r) => r.entitled)))}/${String(seatsTotal)}` +
    `  ·  with reach ${String(sum(rows.map((r) => r.withReach)))}/${String(seatsTotal)}` +
    `  ·  OFFERED THE ACT ${String(sum(rows.map((r) => r.offered)))}/${String(seatsTotal)}\n`,
);
process.stdout.write(
  `SYBIL (is the price safe?)    reach ${String(sum(sybils.map((s) => s.reach)))}` +
    `  ·  allowance ${String(sum(sybils.map((s) => s.allowance)))}` +
    `  ·  offers ${String(sum(sybils.map((s) => s.offers)))}` +
    `  ·  ACCEPTED ${String(sum(sybils.map((s) => s.accepted)))}` +
    `   (all four must be 0)\n`,
);
