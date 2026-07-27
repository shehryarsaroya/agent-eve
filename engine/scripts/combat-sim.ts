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

// ── PHASE D ─────────────────────────────────────────────────────────────────
//
// ══════════════════════════════════════════════════════════════════════════
// **D. DOES COMPOSITION PAY AT COALITION SCALE?** — the question phase B cannot answer.
//
// Phase B found `LINE` (pure damage) beating every specialist, and the diagnosis was structural
// rather than a balance number: **a three-hull cap makes a support wing a third of the fleet**, where
// EVE's logistics ratio is about 1:5. A REPAIR hull that replaces a third of your damage has to offset
// a third of your damage to break even, and `catalogue.ts` deliberately calibrated remote repair to
// *"a force multiplier rather than an answer"* (~40% of incoming). So at three hulls the specialist is
// mathematically behind before the first volley, and phase B was measuring the cap, not the doctrine.
//
// `join` is the mechanic that lifts the cap — §9's *"nearby agents may join on either side"*, and
// `combat/index.ts` says so in as many words: *"a big battle is many principals on one side, each
// bringing what its own hands can crew… a fleet larger than three hulls is a coalition, not a
// purchase."* It was built, it is reachable, and **no sim had ever put two principals on one side of a
// battle.**
//
// So this phase fields five principals a side and varies only the *composition* of the defence at
// matched hull count:
//
//   - `ALL_LINE`    — 5 × three missile WARDENs. Fifteen hulls, no support at all.
//   - `LOGI_1_IN_5` — 4 × three missile WARDENs + 1 × three remote-repair WARDENs. Fifteen hulls, a
//                     support wing that is a fifth of the fleet rather than a third: EVE's ratio.
//
// Both against the same attacker, so the only difference on the field is what the fifteenth, and the
// thirteenth, and the fourteenth hull are carrying. If the specialist still loses, multipliers do not
// pay at coalition scale either and §12's relationship #4 is decoration; if it wins, phase B's finding
// was the cap.
// ══════════════════════════════════════════════════════════════════════════

const LOGI_WING: Ship = {
  hull: 'WARDEN',
  modules: ['REMOTE_REPAIR', 'REMOTE_REPAIR', 'CAP_BATTERY', 'SHIELD_EXTENDER', 'AFTERBURNER', 'CAP_RELAY', 'CAP_RELAY'],
};

interface Wing {
  readonly ships: readonly Ship[];
  readonly echelon: string;
  readonly posture: string;
}

const LINE_WING: Wing = { ships: [MISSILE_LINE, MISSILE_LINE, MISSILE_LINE], echelon: 'MAIN', posture: 'HOLD' };
const SUPPORT_WING: Wing = { ships: [LOGI_WING, LOGI_WING, LOGI_WING], echelon: 'SUPPORT', posture: 'HOLD' };

interface Coalition {
  readonly defence: readonly Wing[];
  readonly attack: readonly Wing[];
}

/**
 * Field two coalitions against each other through `demand` + `join`, and report the field.
 *
 * Every principal is seated at one stage and stocked for its own wing; the raid is opened by the first
 * attacker and every other attacker `join`s `RAIDER` while every other defender `join`s `DEFENDER`. The
 * target answers `fight`. That is the whole of §9's coalition machinery, driven through the verb table.
 */
function coalition(seed: string, plan: Coalition, ticks: number): {
  readonly battles: number;
  readonly defenderWins: number;
  readonly contested: number;
  readonly raiderWins: number;
  readonly defenderWrecks: number;
  readonly raiderWrecks: number;
  readonly fielded: number;
} {
  const runtime = new Runtime({ seed });
  const stage = runtime.seatInTier('MARCHES', Rng.fromSeed(`${seed}:stage`));
  if (stage === undefined) throw new Error('no MARCHES system');

  const defenders: PrincipalId[] = [];
  const attackers: PrincipalId[] = [];
  const wingOf = new Map<PrincipalId, Wing>();
  const seatWing = (label: string, index: number, wing: Wing, into: PrincipalId[]): void => {
    const principal = `p:${label}${String(index)}` as PrincipalId;
    runtime.seat(principal, `${label}${String(index)}`, stage);
    runtime.standing.open(principal);
    stock(runtime, principal, stage, HULL_COST_GOODS.frame, START_GOODS);
    stock(runtime, principal, stage, HULL_COST_GOODS.fuel, 4_000);
    wingOf.set(principal, wing);
    into.push(principal);
  };
  for (const [i, wing] of plan.defence.entries()) seatWing('def', i, wing, defenders);
  for (const [i, wing] of plan.attack.entries()) seatWing('atk', i, wing, attackers);
  const watch = [...defenders, ...attackers];
  step(runtime, watch);

  for (const principal of watch) {
    for (const ship of wingOf.get(principal)?.ships ?? []) {
      submit(runtime, principal, 'build', { kind: 'HULL', system: stage, hull: ship.hull, modules: [...ship.modules] });
      step(runtime, watch);
    }
  }
  for (let i = 0; i < 8; i += 1) step(runtime, watch);

  const target = defenders[0];
  const opener = attackers[0];
  if (target === undefined || opener === undefined) throw new Error('a coalition needs a side each');

  let battles = 0;
  let defenderWins = 0;
  let contested = 0;
  let raiderWins = 0;
  let defenderWrecks = 0;
  let raiderWrecks = 0;
  let fielded = 0;
  const closed = new Set<string>();
  const engaged = new Set<string>();
  const joined = new Set<string>();

  for (let t = 0; t < ticks; t += 1) {
    // One demand per Reckoning-ish, aimed at the lead defender. `AGGRESSION_PER_RECKONING` caps it.
    if (t % 96 === 20) {
      submit(runtime, opener, 'demand', { principal: target, system: stage, good: HULL_COST_GOODS.frame, qty: 2_000 });
    }
    for (const raid of runtime.raids.live()) {
      if (raid.target !== target) continue;
      // Everybody else takes a side. A defender joiner stakes nothing; a raider joiner stakes capital.
      for (const principal of watch) {
        if (principal === target || principal === raid.initiator) continue;
        const key = `${raid.id}/${principal}`;
        if (joined.has(key)) continue;
        joined.add(key);
        submit(runtime, principal, 'join', {
          raid: raid.id,
          system: raid.stage,
          side: defenders.includes(principal) ? 'DEFENDER' : 'RAIDER',
        });
      }
      if (raid.answer === null) submit(runtime, target, 'fight', { raid: raid.id, system: raid.stage });
    }

    for (const battle of runtime.battles.live()) {
      if (battle.state !== 'MUSTER') continue;
      for (const principal of watch) {
        const wing = wingOf.get(principal);
        if (wing === undefined) continue;
        for (const hull of runtime.committableHulls(principal, battle.stage)) {
          const key = `${battle.id}/${hull.id}`;
          if (engaged.has(key)) continue;
          engaged.add(key);
          submit(runtime, principal, 'engage', {
            raid: battle.raid,
            system: battle.stage,
            hull: hull.id,
            echelon: wing.echelon,
            posture: wing.posture,
            primary: ['TACKLE', 'REPAIR', 'WEAKEST'],
          });
          // One `engage` per principal per tick: the action budget is four and the point of the phase
          // is the composition, not a throughput race (A4).
          break;
        }
      }
      fielded = Math.max(
        fielded,
        battle.formations.reduce((n, f) => n + f.hands.length, 0),
      );
    }

    const before = new Set(runtime.battles.all().filter((b) => b.resolvedAtTick !== null).map((b) => b.id));
    step(runtime, watch);
    for (const battle of runtime.battles.all()) {
      if (battle.resolvedAtTick === null || before.has(battle.id) || closed.has(battle.id)) continue;
      closed.add(battle.id);
      battles += 1;
      if (battle.fieldControl === 'CONTESTED') contested += 1;
      else if (battle.fieldControl === 'DEFENDER') defenderWins += 1;
      else raiderWins += 1;
      for (const wreck of battle.wrecks) {
        if (defenders.includes(wreck.principal)) defenderWrecks += 1;
        else raiderWrecks += 1;
      }
    }
  }

  return { battles, defenderWins, contested, raiderWins, defenderWrecks, raiderWrecks, fielded };
}

console.log('\n──── D. does composition pay at COALITION scale? (§12 #4, join) ────');
console.log('defence         hulls  battles  def wins cont raid wins   def lost  raid lost  fielded');
const COALITIONS: readonly (readonly [string, Coalition])[] = [
  [
    'ALL_LINE',
    {
      defence: [LINE_WING, LINE_WING, LINE_WING, LINE_WING, LINE_WING],
      attack: [LINE_WING, LINE_WING, LINE_WING, LINE_WING, LINE_WING],
    },
  ],
  [
    'LOGI_1_IN_5',
    {
      defence: [LINE_WING, LINE_WING, LINE_WING, LINE_WING, SUPPORT_WING],
      attack: [LINE_WING, LINE_WING, LINE_WING, LINE_WING, LINE_WING],
    },
  ],
  [
    'LOGI_1_IN_3',
    {
      defence: [LINE_WING, LINE_WING, SUPPORT_WING],
      attack: [LINE_WING, LINE_WING, LINE_WING],
    },
  ],
];
for (const [name, plan] of COALITIONS) {
  const agg = { b: 0, d: 0, c: 0, r: 0, dw: 0, rw: 0, f: 0 };
  for (const seed of SEEDS) {
    refusals = [];
    const out = coalition(`${seed}:${name}`, plan, TICKS);
    agg.b += out.battles;
    agg.d += out.defenderWins;
    agg.c += out.contested;
    agg.r += out.raiderWins;
    agg.dw += out.defenderWrecks;
    agg.rw += out.raiderWrecks;
    agg.f = Math.max(agg.f, out.fielded);
  }
  const hulls = plan.defence.reduce((n, w) => n + w.ships.length, 0);
  console.log(
    `${name.padEnd(15)} ${String(hulls).padStart(5)} ${String(agg.b).padStart(8)} ${String(agg.d).padStart(9)}` +
      ` ${String(agg.c).padStart(4)} ${String(agg.r).padStart(9)}   ${String(agg.dw).padStart(8)}` +
      ` ${String(agg.rw).padStart(10)}  ${String(agg.f).padStart(7)}`,
  );
  if (refusals.length > 0) console.log(`  ! ${refusals.slice(0, 3).join('\n  ! ')}`);
}
console.log('');
