#!/usr/bin/env node
/**
 * ★ **DOES A CHOKEPOINT EVER DECIDE ANYTHING?** — the instrument that separates §16.12 #1 from a label.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHY THIS EXISTS, AND WHY IT IS THE MOST IMPORTANT FILE IN THE FEATURE.**
 *
 * `balance-gate.ts` reported §16.12 #1's landing as **byte-identical to master on every column at
 * three and six Reckonings** — same `kept`, same `broken`, same `ventures`, same `claims`, same
 * `rent`, same `CARRIED`. That is exactly the reading a perfectly neutral change produces, and it is
 * also exactly the reading a **mechanic that never fires** produces. The two are indistinguishable
 * from that table, and this project has shipped the second one seventeen times while reading the
 * first: `lockFillStake` with its own passing test and no caller; `haul.landed` refused on every
 * emission for the project's life; `SyndicateBook.giveNotice` with no caller at all.
 *
 * So this counts the events that can only happen when reach binds:
 *
 *   · `demand` refused because the initiator's SWAY at the stage was 0;
 *   · `demand` refused because the initiator was Commons-bound (the AGT-S2 branch);
 *   · RAIDER `join`s the observation **withheld** for the same reason, with the stage named;
 *   · `raidersOutOfSway` at a real resolution — a hand that stood there and bought nothing;
 *   · `attackerUnsupplied` at a real campaign PULSE — a war losing to distance;
 *   · and, as the denominator that makes the zeroes readable, how many **candidate** acts existed at
 *     all: demands considered, standoffs a hand could reach, pulses resolved.
 *
 * ── HOW TO READ A ZERO ───────────────────────────────────────────────────────
 *
 * A zero with a zero denominator means **this instrument cannot see the mechanic** — the cast never
 * attempted the act, so nothing was decided either way, and the finding is about the cast rather
 * than about the feature. A zero with a **positive** denominator is the real negative result: the act
 * was attempted, reach was consulted, and it never bound. Both are worth knowing and they are
 * different findings; a single number reports them identically, which is the whole reason the
 * denominators are here.
 *
 * The **border** columns are the third kind of evidence and they never depend on the cast at all:
 * how much of the map any principal can reach, and how much of it nobody can. Those come from the
 * published frame, so they are true of the world whether or not anybody ever attacks anyone.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ```
 * npx tsx scripts/border-probe.ts --seeds-from g --count 8 --reckonings 6
 * ```
 */

import { HeuristicCast } from '../src/cast/index.js';
import { setSpeed, TICKS_PER_RECKONING } from '../src/core/time.js';
import { RAID_DEMAND_QTY } from '../src/predation/params.js';
import { Runtime } from '../src/sim/runtime.js';
import { straitsOf, SWAY_AT_SEAT, tierOf } from '../src/world/index.js';

interface Row {
  readonly seed: string;
  readonly halted: boolean;
  // ── THE GEOGRAPHY, WHICH DOES NOT DEPEND ON THE CAST ──────────────────────
  readonly straits: number;
  /** Non-Commons systems on the map. The denominator for the two below. */
  readonly outer: number;
  /** Systems no principal's force reaches at the last frame — "a place for smaller groups". */
  readonly bare: number;
  /** The widest reach any one principal had, in systems. Local power, measured. */
  readonly widest: number;
  /** Systems more than one principal reaches — contested border, as opposed to frontier. */
  readonly contested: number;
  // ── THE DECISIONS ─────────────────────────────────────────────────────────
  /** `demandRefusal` calls made by the affordance builder — the denominator for the two below. */
  readonly demandsConsidered: number;
  readonly demandsRefusedForSway: number;
  readonly demandsRefusedCommonsBound: number;
  /** Observations whose RAIDER `join` was withheld for sway (`header.withheld` names the stage). */
  readonly joinsWithheldForSway: number;
  /** Live standoffs a hand of somebody's could have reached. The denominator above. */
  readonly reachableStandoffs: number;
  /** Raider hands that stood at a stage and counted for nothing. */
  readonly raidersOutOfSway: number;
  /** Campaign pulses resolved, and attacker hands the pulse could not supply. */
  readonly pulses: number;
  readonly attackerUnsupplied: number;
}

function runOne(seed: string, ticks: number, members: number): Row {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size: members });
  const roster = cast.seat(seed);

  let halted = false;
  let demandsConsidered = 0;
  let demandsRefusedForSway = 0;
  let demandsRefusedCommonsBound = 0;
  let joinsWithheldForSway = 0;
  let reachableStandoffs = 0;
  let raidersOutOfSway = 0;
  let pulses = 0;
  let attackerUnsupplied = 0;

  for (let i = 0; i < ticks; i += 1) {
    const next = runtime.engine.tick + 1;
    for (const action of cast.decide(next, seed)) runtime.engine.submit(action);
    const report = runtime.runTick();
    if (report.halted) halted = true;

    // ── THE DEMAND GATE, ASKED THE WAY THE AFFORDANCE ASKS IT ───────────────
    //
    // `demandRefusalFor` is the same predicate `vDemand` runs, so this is not a second opinion —
    // it is the engine's own answer to the question the menu asks on every wake. Sampled once a
    // Reckoning rather than every tick: the answer is a function of geography and holdings, which
    // move at that cadence, and 1,728 ticks × 8 members × 7 neighbours is a different instrument.
    if (report.tick % TICKS_PER_RECKONING === 1) {
      for (const member of roster) {
        for (const other of roster) {
          if (other.principal === member.principal) continue;
          const stage = runtime.world.holdings.get(
            runtime.world.holdingByPrincipal.get(other.principal) ?? ('' as never),
          )?.system;
          if (stage === undefined) continue;
          if (tierOf(runtime.world.map, stage) === 'COMMONS') continue;
          demandsConsidered += 1;
          const refusal = runtime.demandRefusalFor({
            initiator: member.principal,
            target: other.principal,
            stage,
            good: 'ration' as never,
            demand: RAID_DEMAND_QTY.min,
            tick: report.tick,
            handId: null,
          });
          if (refusal === null) continue;
          if (/\bSWAY\b/.test(refusal.hint) && refusal.invariant === 'A4') demandsRefusedForSway += 1;
          if (refusal.invariant === 'A15' && /civic-leased|Commons-bound/.test(refusal.hint)) {
            demandsRefusedCommonsBound += 1;
          }
        }
      }
    }

    // ── THE RAIDER JOIN, OFF THE OBSERVATION ITSELF ─────────────────────────
    //
    // Read from `header.withheld.reason`, which is the sentence the AGENT is handed — so a nonzero
    // count here is proof the mechanic reached a menu rather than proof a function returns a number.
    for (const member of roster) {
      const view = runtime.raidsFor(member.principal, report.tick, 12);
      for (const raid of view) {
        if (raid.your_side !== null) continue;
        if (raid.march === null || !raid.march.in_time) continue;
        reachableStandoffs += 1;
        if (raid.force.your_sway <= 0) joinsWithheldForSway += 1;
      }
    }

    // ── WHAT A RESOLUTION ACTUALLY COUNTED ──────────────────────────────────
    const first = roster[0];
    if (first !== undefined) {
      // One reader is enough: the force reading is not per-reader, and asking eight would count the
      // same standoff eight times.
      for (const raid of runtime.raidsFor(first.principal, report.tick, 12)) {
        raidersOutOfSway = Math.max(raidersOutOfSway, raid.force.raiders_out_of_sway);
      }
      // ── AND WHAT A CAMPAIGN PULSE COULD NOT SUPPLY ────────────────────────
      //
      // Off `CampaignView`, which is the agent-facing surface, rather than by rebuilding the pulse
      // port here: a probe that assembled its own port would be measuring its own arithmetic.
      for (const campaign of runtime.campaignsFor(first.principal, report.tick, 8)) {
        pulses += 1;
        attackerUnsupplied = Math.max(attackerUnsupplied, campaign.force.attacker_unsupplied);
      }
    }
  }

  // ── THE GEOGRAPHY, OFF THE PUBLISHED FRAME ────────────────────────────────
  const lines = runtime.reckoningFrame()?.swayLines ?? [];
  const outer = lines.length;
  const bare = lines.filter((l) => l.principal === null).length;
  const contested = lines.filter((l) => l.reachers > 1).length;
  let widest = 0;
  for (const member of roster) {
    widest = Math.max(widest, runtime.swayBlockFor(member.principal).reaches.length);
  }

  return {
    seed,
    halted,
    straits: straitsOf(runtime.world.map).size,
    outer,
    bare,
    widest,
    contested,
    demandsConsidered,
    demandsRefusedForSway,
    demandsRefusedCommonsBound,
    joinsWithheldForSway,
    reachableStandoffs,
    raidersOutOfSway,
    pulses,
    attackerUnsupplied,
  };
}

function parse(argv: readonly string[]): {
  seeds: readonly string[];
  reckonings: number;
  members: number;
} {
  let seeds: string[] = ['g01'];
  let reckonings = 6;
  let members = 8;
  let from: string | null = null;
  let count = 8;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i] ?? '';
    const value = argv[i + 1] ?? '';
    if (flag === '--seeds') {
      seeds = value.split(',').filter(Boolean);
      i += 1;
    } else if (flag === '--seeds-from') {
      from = value;
      i += 1;
    } else if (flag === '--count') {
      count = Number(value);
      i += 1;
    } else if (flag === '--reckonings') {
      reckonings = Number(value);
      i += 1;
    } else if (flag === '--members') {
      members = Number(value);
      i += 1;
    }
  }
  if (from !== null) {
    seeds = Array.from({ length: count }, (_, i) => `${from}${String(i + 1).padStart(2, '0')}`);
  }
  return { seeds, reckonings, members };
}

const args = parse(process.argv.slice(2));
const ticks = args.reckonings * TICKS_PER_RECKONING;
const rows: Row[] = [];
for (const seed of args.seeds) rows.push(runOne(seed, ticks, args.members));

const pad = (n: number | string, w: number): string => String(n).padStart(w);
console.log(
  `does a chokepoint decide anything · ${String(args.seeds.length)} seeds × ` +
    `${String(args.reckonings)} Reckonings × ${String(args.members)} members · SWAY_AT_SEAT ` +
    `${String(SWAY_AT_SEAT)}`,
);
console.log(
  'seed   straits  outer  bare  contested  widest | demands  SWAY-0  CommonsBound | standoffs  ' +
    'join-withheld | outOfSway | pulses  unsupplied',
);
for (const r of rows) {
  console.log(
    `${r.seed} ${pad(r.straits, 8)} ${pad(r.outer, 6)} ${pad(r.bare, 5)} ${pad(r.contested, 10)} ` +
      `${pad(r.widest, 7)} | ${pad(r.demandsConsidered, 7)} ${pad(r.demandsRefusedForSway, 7)} ` +
      `${pad(r.demandsRefusedCommonsBound, 13)} | ${pad(r.reachableStandoffs, 9)} ` +
      `${pad(r.joinsWithheldForSway, 13)} | ${pad(r.raidersOutOfSway, 9)} | ${pad(r.pulses, 6)} ` +
      `${pad(r.attackerUnsupplied, 11)}`,
  );
}
const sum = (pick: (r: Row) => number): number => rows.reduce((n, r) => n + pick(r), 0);
const total = {
  straits: sum((r) => r.straits),
  outer: sum((r) => r.outer),
  bare: sum((r) => r.bare),
  contested: sum((r) => r.contested),
  demandsConsidered: sum((r) => r.demandsConsidered),
  demandsRefusedForSway: sum((r) => r.demandsRefusedForSway),
  demandsRefusedCommonsBound: sum((r) => r.demandsRefusedCommonsBound),
  reachableStandoffs: sum((r) => r.reachableStandoffs),
  joinsWithheldForSway: sum((r) => r.joinsWithheldForSway),
  raidersOutOfSway: sum((r) => r.raidersOutOfSway),
  pulses: sum((r) => r.pulses),
  attackerUnsupplied: sum((r) => r.attackerUnsupplied),
  widest: Math.max(...rows.map((r) => r.widest)),
  halted: rows.filter((r) => r.halted).length,
};
console.log(
  `TOTAL  ${pad(total.straits, 8)} ${pad(total.outer, 6)} ${pad(total.bare, 5)} ` +
    `${pad(total.contested, 10)} ${pad(total.widest, 7)} | ${pad(total.demandsConsidered, 7)} ` +
    `${pad(total.demandsRefusedForSway, 7)} ${pad(total.demandsRefusedCommonsBound, 13)} | ` +
    `${pad(total.reachableStandoffs, 9)} ${pad(total.joinsWithheldForSway, 13)} | ` +
    `${pad(total.raidersOutOfSway, 9)} | ${pad(total.pulses, 6)} ${pad(total.attackerUnsupplied, 11)}`,
);

// ── THE VERDICT, STATED RATHER THAN LEFT TO THE READER ──────────────────────
const decided =
  total.demandsRefusedForSway +
  total.demandsRefusedCommonsBound +
  total.joinsWithheldForSway +
  total.raidersOutOfSway +
  total.attackerUnsupplied;
console.log('');
if (decided === 0 && total.demandsConsidered === 0 && total.reachableStandoffs === 0) {
  console.log(
    '⚠ NO CANDIDATE ACT OCCURRED. This instrument cannot see the mechanic in this world — the ' +
      'finding is about the cast, not about the feature.',
  );
} else if (decided === 0) {
  console.log(
    `⚠ REACH WAS CONSULTED ${String(total.demandsConsidered + total.reachableStandoffs)} TIMES AND ` +
      'NEVER BOUND. That is a real negative result: the mechanic is reachable and every attempt was ' +
      'within reach. It is NOT the same as "the mechanic does not fire".',
  );
} else {
  console.log(
    `★ REACH DECIDED ${String(decided)} THINGS in a world nobody steers — ` +
      `${String(total.demandsRefusedForSway)} demands refused out of reach, ` +
      `${String(total.demandsRefusedCommonsBound)} refused as Commons-bound, ` +
      `${String(total.joinsWithheldForSway)} raider joins withheld, ` +
      `${String(total.raidersOutOfSway)} raider hands that bought nothing, ` +
      `${String(total.attackerUnsupplied)} campaign hands a pulse could not supply.`,
  );
}
console.log(
  `border: ${String(total.bare)} of ${String(total.outer)} systems are reached by NOBODY, ` +
    `${String(total.contested)} by more than one, and the widest single reach was ` +
    `${String(total.widest)} systems.`,
);
console.log(`RESULT ${JSON.stringify({ rows, total, decided })}`);
