/**
 * **PLAY IT.** A scripted combat probe that drives §9A through the real verb table.
 *
 * ── WHY THIS SCRIPT EXISTS AND `sim --ticks 900` DOES NOT ANSWER THE QUESTION ──
 *
 * This project's highest-yield instrument is playing through the front door: three blind probes found
 * five bugs that 26 invariants and 2,939 tests did not, *"every one the engine being internally
 * consistent while the agent-facing surface lied."*
 *
 * But `src/cast/heuristic.ts` has **no combat branch** — it does not build hulls and it does not
 * `engage`. So a plain heuristic run would show **zero battles**, and the honest reading of that is
 * *"nothing in the world knows how to fly a ship yet"*, not *"combat is irrational"*. Distinguishing
 * those two is the whole point of this file: it supplies the missing decision and nothing else.
 *
 * The second confound worth naming: the LLM cast **cannot currently read the standoff's rules at
 * all** — `agent.md` §11D is over the per-wake excerpt bar and is omitted from every wake — so a
 * "the LLM cast never fought" observation this week has two live explanations and no way to choose
 * between them. A scripted probe has neither problem: it acts from code, so what it measures is the
 * MECHANIC.
 *
 * ── THE THREE QUESTIONS, AND WHY EACH IS A SEPARATE PHASE ───────────────────
 *
 * **A. Does combat happen without anybody choosing it?** (A14, the axiom every autonomous-cast combat
 * layer fails first.) One doctrine per world, facing only the world's scheduled raids. Reported per
 * doctrine and per seed, because a world raid's target is chosen by published rule and one run
 * therefore tests one doctrine.
 *
 * **B. Does composition beat headcount?** The same doctrines against *each other* through `demand`, at
 * matched spend. If the answer is no, §12's five relationships are not implemented and this is a
 * scalar with extra steps.
 *
 * **C. Was answering FIGHT rational?** Hulls lost against goods kept. If FIGHT never pays, the whole
 * layer sits unreachable behind a rational refusal — §9's toll-cartel failure from the defender's side.
 *
 * Run: `npx tsx scripts/combat-sim.ts [ticks] [seeds...]`
 */

import { Rng } from '../src/core/rng.js';
import { setSpeed } from '../src/core/time.js';
import type { EventId, GoodId, PrincipalId, SystemId } from '../src/core/types.js';
import { qty } from '../src/core/units.js';
import { GOODS_FAUCET, storesAccount } from '../src/ledger/index.js';
import { HULL_COST_GOODS, hullQuote, simulateFit, worldFleetProfile } from '../src/combat/index.js';
import { Runtime } from '../src/sim/runtime.js';

setSpeed('instant');

const TICKS = Number(process.argv[2] ?? '900');
const SEEDS = process.argv.slice(3).length > 0 ? process.argv.slice(3) : ['cs-a', 'cs-b', 'cs-c'];

interface Ship {
  readonly hull: string;
  readonly modules: readonly string[];
}
interface Doctrine {
  readonly ships: readonly Ship[];
  readonly echelon: string;
  readonly posture: string;
  readonly primary: readonly string[];
  readonly withdrawBelowBps: number;
}

const MISSILE_LINE: Ship = {
  hull: 'WARDEN',
  modules: ['MISSILE', 'MISSILE', 'MISSILE', 'SHIELD_EXTENDER', 'SHIELD_EXTENDER', 'AFTERBURNER', 'DAMAGE_MOD', 'DAMAGE_MOD'],
};
const TACKLE_FRIGATE: Ship = { hull: 'PIKE', modules: ['SMALL_GUN', 'POINT', 'WEB', 'AFTERBURNER'] };
/**
 * A turret line, which unlike a missile line **pays capacitor to shoot**.
 *
 * This ship exists because the first run of this script found DISRUPT losing 0-18 to LINE, and the
 * arithmetic said why: `MISSILE` has `cap: 0`, so draining a missile fleet's capacitor removes
 * nothing at all. That is EVE-accurate and it means DISRUPT is the *wrong* answer against missiles by
 * construction — which is a counter-relationship rather than a bug, but only if there is something
 * EWAR *is* the right answer against. This is that something, and pitting DISRUPT at it is what turns
 * "EWAR may be dead" into "EWAR is situational".
 */
const GUN_LINE: Ship = {
  hull: 'WARDEN',
  modules: ['SMALL_GUN', 'SMALL_GUN', 'SMALL_GUN', 'SHIELD_EXTENDER', 'SHIELD_EXTENDER', 'SHIELD_BOOSTER', 'AFTERBURNER', 'DAMAGE_MOD', 'DAMAGE_MOD'],
};

/**
 * Four doctrines, **three hulls each** — because three is the real cap.
 *
 * `MAX_HULLS_PER_PRINCIPAL` is 6 and a principal has three hands, and `engage` needs an IDLE hand to
 * crew each hull. The first run of this script reported that as a refusal three times in a row, which
 * is the mechanic working: a fleet bigger than three is a **coalition**, not a purchase (§6.2).
 */
const DOCTRINES: Readonly<Record<string, Doctrine>> = {
  SWARM: {
    ships: [TACKLE_FRIGATE, TACKLE_FRIGATE, TACKLE_FRIGATE],
    echelon: 'SCREEN',
    posture: 'CLOSE',
    primary: ['REPAIR', 'COMMAND', 'WEAKEST'],
    withdrawBelowBps: 2_500,
  },
  LINE: {
    ships: [MISSILE_LINE, MISSILE_LINE, TACKLE_FRIGATE],
    echelon: 'MAIN',
    posture: 'HOLD',
    primary: ['TACKLE', 'REPAIR', 'WEAKEST'],
    withdrawBelowBps: 0,
  },
  SUPPORTED: {
    ships: [
      MISSILE_LINE,
      { hull: 'WARDEN', modules: ['REMOTE_REPAIR', 'REMOTE_REPAIR', 'CAP_BATTERY', 'SHIELD_EXTENDER', 'AFTERBURNER', 'CAP_RELAY', 'CAP_RELAY'] },
      TACKLE_FRIGATE,
    ],
    echelon: 'MAIN',
    posture: 'HOLD',
    primary: ['TACKLE', 'REPAIR', 'WEAKEST'],
    withdrawBelowBps: 0,
  },
  GUNS: {
    ships: [GUN_LINE, GUN_LINE, TACKLE_FRIGATE],
    echelon: 'MAIN',
    posture: 'CLOSE',
    primary: ['TACKLE', 'REPAIR', 'WEAKEST'],
    withdrawBelowBps: 0,
  },
  DISRUPT: {
    ships: [
      MISSILE_LINE,
      { hull: 'WARDEN', modules: ['DRAIN', 'DRAIN', 'DAMP', 'DAMP', 'PAINT', 'AFTERBURNER', 'CAP_RELAY', 'CAP_RELAY', 'REACTOR'] },
      TACKLE_FRIGATE,
    ],
    echelon: 'MAIN',
    posture: 'HOLD',
    primary: ['REPAIR', 'COMMAND', 'TACKLE', 'WEAKEST'],
    withdrawBelowBps: 0,
  },
};

const START_GOODS = 60_000;
let refusals: string[] = [];

function stock(runtime: Runtime, principal: PrincipalId, system: SystemId, good: GoodId, amount: number): void {
  runtime.ledger.sourceGoods({
    eventId: `sim.stock:${principal}:${good}` as EventId,
    tick: runtime.engine.tick,
    faucet: GOODS_FAUCET.PRODUCTION,
    to: storesAccount(principal),
    good,
    qty: qty(amount),
    location: system,
    origin: principal,
  });
}

function submit(runtime: Runtime, principal: PrincipalId, verb: string, params: Record<string, unknown>): void {
  const out = runtime.engine.submit({ principal, verb, params, clientSequence: 0, arrivalMs: 0, decisionSource: 'HEURISTIC' });
  if (!out.ok) refusals.push(`${verb}: ${out.invariant} ${out.hint.slice(0, 130)}`);
}

function step(runtime: Runtime, watch: readonly PrincipalId[]): void {
  const report = runtime.runTick();
  if (report.halted) {
    throw new Error(`HALTED at tick ${String(report.tick)}: ` + report.violations.map((v) => `${v.id} ${v.message}`).join(' | '));
  }
  for (const principal of watch) {
    for (const correction of runtime.takeCorrections(principal)) {
      refusals.push(`${correction.verb}: ${correction.invariant} ${correction.hint.slice(0, 130)}`);
    }
  }
}

interface Result {
  readonly battles: number;
  readonly won: number;
  readonly lost: number;
  readonly contested: number;
  readonly myWrecks: number;
  readonly theirWrecks: number;
  readonly fights: number;
  readonly yields: number;
  readonly goodsLost: number;
  readonly maxFielded: number;
}

/** Build a fleet and answer everything that comes, for `ticks`. */
function play(seed: string, mine: string, theirs: string | null, ticks: number): Result {
  const runtime = new Runtime({ seed });
  const stage = runtime.seatInTier('MARCHES', Rng.fromSeed(`${seed}:stage`));
  if (stage === undefined) throw new Error('no MARCHES system');

  const me = 'p:mine' as PrincipalId;
  const them = 'p:thrs' as PrincipalId;
  const roster: { readonly principal: PrincipalId; readonly doctrine: string }[] = [{ principal: me, doctrine: mine }];
  runtime.seat(me, 'mine', stage);
  runtime.standing.open(me);
  if (theirs !== null) {
    runtime.seat(them, 'thrs', stage);
    runtime.standing.open(them);
    roster.push({ principal: them, doctrine: theirs });
  }
  const watch = roster.map((r) => r.principal);
  const doctrineOf = new Map(roster.map((r) => [r.principal, r.doctrine]));

  for (const seat of roster) {
    stock(runtime, seat.principal, stage, HULL_COST_GOODS.frame, START_GOODS);
    stock(runtime, seat.principal, stage, HULL_COST_GOODS.fuel, 4_000);
  }
  step(runtime, watch);

  for (const seat of roster) {
    for (const ship of DOCTRINES[seat.doctrine]?.ships ?? []) {
      submit(runtime, seat.principal, 'build', { kind: 'HULL', system: stage, hull: ship.hull, modules: [...ship.modules] });
      step(runtime, watch);
    }
  }
  for (let i = 0; i < 8; i += 1) step(runtime, watch);

  let fights = 0;
  let yields = 0;
  let won = 0;
  let lost = 0;
  let contested = 0;
  let myWrecks = 0;
  let theirWrecks = 0;
  let maxFielded = 0;
  const closed = new Set<string>();
  const engaged = new Set<string>();

  for (let t = 0; t < ticks; t += 1) {
    for (const raid of runtime.raids.live()) {
      if (raid.answer !== null) continue;
      if (!doctrineOf.has(raid.target)) continue;
      if (runtime.committableHulls(raid.target, raid.stage).length > 0) {
        submit(runtime, raid.target, 'fight', { raid: raid.id, system: raid.stage });
        fights += 1;
      } else {
        submit(runtime, raid.target, 'yield', { raid: raid.id });
        yields += 1;
      }
    }

    for (const battle of runtime.battles.live()) {
      if (battle.state !== 'MUSTER') continue;
      for (const seat of roster) {
        const doctrine = DOCTRINES[seat.doctrine];
        if (doctrine === undefined) continue;
        if (battle.target !== seat.principal && battle.initiator !== seat.principal) continue;
        const hull = runtime.committableHulls(seat.principal, battle.stage)[0];
        if (hull === undefined) continue;
        const key = `${battle.id}/${hull.id}`;
        if (engaged.has(key)) continue;
        engaged.add(key);
        submit(runtime, seat.principal, 'engage', {
          raid: battle.raid,
          system: battle.stage,
          hull: hull.id,
          echelon: doctrine.echelon,
          posture: doctrine.posture,
          primary: [...doctrine.primary],
          withdraw_below_bps: doctrine.withdrawBelowBps,
        });
      }
      const fielded = battle.formations.filter((f) => f.principal === me).reduce((n, f) => n + f.hands.length, 0);
      maxFielded = Math.max(maxFielded, fielded);
    }

    if (theirs !== null && t % 40 === 20) {
      submit(runtime, me, 'demand', { principal: them, system: stage, good: HULL_COST_GOODS.frame, qty: 2_000 });
    }

    const before = new Set(runtime.battles.all().filter((b) => b.resolvedAtTick !== null).map((b) => b.id));
    step(runtime, watch);
    for (const battle of runtime.battles.all()) {
      if (battle.resolvedAtTick === null || before.has(battle.id) || closed.has(battle.id)) continue;
      closed.add(battle.id);
      const mySide = battle.formations.find((f) => f.principal === me)?.side ?? (battle.target === me ? 'DEFENDER' : 'RAIDER');
      if (battle.fieldControl === 'CONTESTED') contested += 1;
      else if (battle.fieldControl === mySide) won += 1;
      else lost += 1;
      for (const wreck of battle.wrecks) {
        if (wreck.principal === me) myWrecks += 1;
        else theirWrecks += 1;
      }
    }
  }

  const goods = runtime.ledger
    .lotsInAccount(storesAccount(me))
    .filter((l) => l.good === HULL_COST_GOODS.frame && l.qty > 0)
    .reduce((n, l) => n + l.qty, 0);
  const spent = (DOCTRINES[mine]?.ships ?? []).reduce((n, s) => n + Number(hullQuote(s.hull)?.frame ?? 0), 0);

  return {
    battles: closed.size,
    won,
    lost,
    contested,
    myWrecks,
    theirWrecks,
    fights,
    yields,
    goodsLost: START_GOODS - spent - goods,
    maxFielded,
  };
}

// ── The world's own fleet, published ────────────────────────────────────────

const world = worldFleetProfile();
console.log('\n════════ §9A COMBAT SIM ════════');
console.log(
  `world fleet per hull: ${
    world === null
      ? 'ILLEGAL'
      : `${String(world.ehp)} EHP · ${String(world.alpha)} alpha · mob ${String(world.mobility)} · ` +
        `sig ${String(world.signature)} · [${world.roleTags.join(',')}]`
  }  ×2-5 per raid`,
);
console.log('\ndoctrines, three hulls each (the hand cap):');
for (const [name, d] of Object.entries(DOCTRINES)) {
  const sum = (pick: (s: Ship) => number): number => d.ships.reduce((n, s) => n + pick(s), 0);
  const ehp = sum((s) => {
    const sim = simulateFit(s.hull, s.modules);
    return sim.ok ? sim.value.ehp : 0;
  });
  const alpha = sum((s) => {
    const sim = simulateFit(s.hull, s.modules);
    return sim.ok ? sim.value.alpha : 0;
  });
  console.log(
    `  ${name.padEnd(10)} ${String(sum((s) => Number(hullQuote(s.hull)?.frame ?? 0)))}f+` +
      `${String(sum((s) => Number(hullQuote(s.hull)?.fuel ?? 0)))}u · ${String(ehp)} EHP · ${String(alpha)} alpha · ` +
      `${d.echelon}/${d.posture} · withdraw ${String(d.withdrawBelowBps)}bps`,
  );
}

// ── PHASE A ─────────────────────────────────────────────────────────────────

console.log('\n──── A. the world comes for you (A14) ────');
console.log('doctrine   seed        battles  won lost cont   my hulls  world hulls  FIGHT YIELD  fielded');
const totals = { battles: 0, won: 0, lost: 0, contested: 0, mine: 0, theirs: 0, fights: 0, yields: 0 };
const seenRefusals = new Set<string>();
for (const name of Object.keys(DOCTRINES)) {
  for (const seed of SEEDS) {
    refusals = [];
    const r = play(`${seed}:${name}`, name, null, TICKS);
    totals.battles += r.battles;
    totals.won += r.won;
    totals.lost += r.lost;
    totals.contested += r.contested;
    totals.mine += r.myWrecks;
    totals.theirs += r.theirWrecks;
    totals.fights += r.fights;
    totals.yields += r.yields;
    console.log(
      `${name.padEnd(10)} ${seed.padEnd(11)} ${String(r.battles).padStart(7)} ${String(r.won).padStart(4)}` +
        ` ${String(r.lost).padStart(4)} ${String(r.contested).padStart(4)}   ${String(r.myWrecks).padStart(8)}` +
        ` ${String(r.theirWrecks).padStart(12)}  ${String(r.fights).padStart(5)} ${String(r.yields).padStart(5)}` +
        `  ${String(r.maxFielded).padStart(7)}`,
    );
    for (const line of refusals) seenRefusals.add(line);
  }
}
console.log(
  `TOTAL                     ${String(totals.battles).padStart(7)} ${String(totals.won).padStart(4)}` +
    ` ${String(totals.lost).padStart(4)} ${String(totals.contested).padStart(4)}   ${String(totals.mine).padStart(8)}` +
    ` ${String(totals.theirs).padStart(12)}  ${String(totals.fights).padStart(5)} ${String(totals.yields).padStart(5)}`,
);
if (seenRefusals.size > 0) {
  console.log('\nrefusals seen (deduped):');
  for (const line of [...seenRefusals].slice(0, 6)) console.log(`  ! ${line}`);
}

// ── PHASE B ─────────────────────────────────────────────────────────────────

console.log('\n──── B. doctrine against doctrine, matched spend (§12) ────');
console.log('mine       theirs     battles  won lost cont   my hulls  their hulls');
const pairs: readonly (readonly [string, string])[] = [
  ['SUPPORTED', 'LINE'],
  ['DISRUPT', 'LINE'],
  ['SWARM', 'LINE'],
  ['SUPPORTED', 'DISRUPT'],
  ['DISRUPT', 'GUNS'],
  ['LINE', 'GUNS'],
];
for (const [mine, theirs] of pairs) {
  const agg = { b: 0, w: 0, l: 0, c: 0, mw: 0, tw: 0 };
  for (const seed of SEEDS) {
    refusals = [];
    const r = play(`${seed}:${mine}v${theirs}`, mine, theirs, TICKS);
    agg.b += r.battles;
    agg.w += r.won;
    agg.l += r.lost;
    agg.c += r.contested;
    agg.mw += r.myWrecks;
    agg.tw += r.theirWrecks;
  }
  console.log(
    `${mine.padEnd(10)} ${theirs.padEnd(10)} ${String(agg.b).padStart(7)} ${String(agg.w).padStart(4)}` +
      ` ${String(agg.l).padStart(4)} ${String(agg.c).padStart(4)}   ${String(agg.mw).padStart(8)} ${String(agg.tw).padStart(12)}`,
  );
}

// ── PHASE C ─────────────────────────────────────────────────────────────────

console.log('\n──── C. was answering FIGHT rational? ────');
for (const name of Object.keys(DOCTRINES)) {
  const ships = DOCTRINES[name]?.ships ?? [];
  const perHull = ships.reduce((n, s) => n + Number(hullQuote(s.hull)?.frame ?? 0), 0) / Math.max(1, ships.length);
  let fought = 0;
  let hulls = 0;
  let goods = 0;
  for (const seed of SEEDS) {
    refusals = [];
    const r = play(`${seed}:${name}`, name, null, TICKS);
    fought += r.fights;
    hulls += r.myWrecks;
    goods += r.goodsLost;
  }
  console.log(
    `${name.padEnd(10)} answered FIGHT ${String(fought).padStart(3)} · lost ${String(hulls).padStart(3)} hull(s) ` +
      `(~${String(Math.trunc(hulls * perHull))} in goods) · goods a raid took: ${String(goods)}`,
  );
}
console.log('');
