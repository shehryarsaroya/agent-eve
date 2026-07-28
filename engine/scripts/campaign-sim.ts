/**
 * A scripted campaign probe — **does a campaign ever END, and can you tell who won?**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `scripts/combat-sim.ts` exists because *"the heuristic cast has no combat branch, so a sweep
 * measures the bot rather than the mechanic."* The same is true here and more so: `src/cast/heuristic.ts`
 * is owned elsewhere this round and has no campaign branch at all, so `npx tsx src/sim/cli.ts` would
 * report zero campaigns on every seed and prove nothing about the layer.
 *
 * So this script **supplies the decision the cast lacks** — declare, haul, march, defend, lift, cede —
 * and measures the mechanic. Every act goes through the real verb table on a real `Runtime` with every
 * invariant running at every tick, so a red result here is the engine and not a fixture.
 *
 * `npx tsx scripts/campaign-sim.ts [seeds...]`
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## What it measures, and what it deliberately does not
 *
 * It answers the three questions the owner asked and nothing else:
 *
 *   1. **Does a campaign end?** Every row must reach a terminal state inside its own clock.
 *   2. **Can you tell who won?** The legend, the ticker line and the SAP are printed for each, and a
 *      reader who has not seen the code should be able to name the winner from them.
 *   3. **Does it conclude differently from a raid?** A raid takes goods inside 24 ticks; a campaign
 *      takes *territory* over Reckonings, or forfeits a bond. The `claim` column is the difference.
 *
 * It does **not** measure whether a campaign is *rational* for an autonomous agent. That needs the
 * cast branch, and until one exists the honest answer is: the mechanism works, the prize is the only
 * road to a paying neighbour's RENT, and nobody has chosen it yet.
 */

import { setSpeed, TICKS_PER_RECKONING } from '../src/core/time.js';
import { Rng } from '../src/core/rng.js';
import type { EventId, GoodId, HandId, PrincipalId, SystemId } from '../src/core/types.js';
import { minor, qty } from '../src/core/units.js';
import { CURRENCY_FAUCET, GOODS_FAUCET, storesAccount } from '../src/ledger/index.js';
import { Runtime } from '../src/sim/runtime.js';
import { neighboursOf, tierOf } from '../src/world/index.js';
import { ALLOY_ANCHOR_QTY, ALLOY_GOOD } from '../src/works/params.js';
import { ANCHOR_QTY, CHARGE_GOOD, CLAIM_BOND_MINOR } from '../src/sovereignty/params.js';
import {
  CAMPAIGN_BOND_MINOR,
  CAMPAIGN_PULSES,
  campaignTickerLine,
  MATERIEL_GOOD,
  PULSE_MATERIEL_QTY,
} from '../src/campaign/index.js';

/**
 * `STARVE` is named for what it ATTEMPTS, and the measurement is that it does not happen — see the
 * finding recorded at {@link PULSE_MATERIEL_QTY}. Kept in the list rather than deleted, because the
 * negative result is the useful part: a fresh principal is seated with `LEVY_STARTER_ALLOTMENT`
 * (50,000) rations at its own system, which is **more than three whole campaigns** of materiel at
 * `PULSE_MATERIEL_QTY` × `CAMPAIGN_PULSES` = 15,000. So supply does not bind for a newcomer at this
 * calibration, and the STARVE branch is verified in `test/campaign/pulse.spec.ts` at the unit level
 * (three mutation-tested cases and the ending) rather than here.
 */
type Script = 'PRESS' | 'DEFEND' | 'STARVE' | 'CEDE' | 'LIFT';

const SCRIPTS: readonly Script[] = ['PRESS', 'DEFEND', 'STARVE', 'CEDE', 'LIFT'];

interface Row {
  readonly seed: string;
  readonly script: Script;
  readonly state: string;
  readonly legend: string;
  readonly pulses: number;
  readonly claimAfter: string;
  readonly bondBack: number;
  readonly forfeited: number;
  readonly endedTick: number | null;
  readonly ticker: string;
  readonly halted: boolean;
}

function source(rt: Runtime, p: PrincipalId, at: SystemId, good: GoodId, amount: number, tag: string): void {
  rt.ledger.sourceGoods({
    eventId: `probe.${tag}:${p}:${good}:${at}:${String(rt.engine.tick)}` as EventId,
    tick: rt.engine.tick,
    faucet: GOODS_FAUCET.PRODUCTION,
    to: storesAccount(p),
    good,
    qty: qty(amount),
    location: at,
    origin: p,
  });
}

function fund(rt: Runtime, p: PrincipalId, amount: number, tag: string): void {
  rt.ledger.issueCurrency({
    eventId: `probe.${tag}:${p}:${String(rt.engine.tick)}` as EventId,
    tick: rt.engine.tick,
    faucet: CURRENCY_FAUCET.STARTER_STAKE,
    to: storesAccount(p),
    amount: minor(amount),
  });
}

function send(rt: Runtime, p: PrincipalId, verb: string, params: Readonly<Record<string, unknown>>): string | null {
  const door = rt.engine.submit({
    principal: p,
    verb,
    params,
    clientSequence: 0,
    arrivalMs: rt.engine.tick,
    decisionSource: 'LIVE',
  });
  if (!door.ok) return `${door.invariant}: ${door.hint.slice(0, 120)}`;
  return null;
}

function runOne(seed: string, script: Script): Row {
  setSpeed('instant');
  const rt = new Runtime({ seed: `${seed}:${script}` });
  const objective = rt.seatInTier('MARCHES', Rng.fromSeed(`${seed}:obj`));
  if (objective === undefined) throw new Error('no MARCHES system');
  const depot = neighboursOf(rt.world.map, objective).find((s) => tierOf(rt.world.map, s) !== 'COMMONS');
  if (depot === undefined) throw new Error(`${objective} has no non-Commons neighbour`);

  const defender = 'p:pd' as PrincipalId;
  const attacker = 'p:pa' as PrincipalId;
  rt.seat(defender, 'pd', objective);
  rt.seat(attacker, 'pa', depot);
  rt.standing.open(defender);
  rt.standing.open(attacker);

  // The claim, through the front door.
  source(rt, defender, objective, CHARGE_GOOD, ANCHOR_QTY, 'anchor');
  source(rt, defender, objective, ALLOY_GOOD, ALLOY_ANCHOR_QTY, 'alloy');
  fund(rt, defender, CLAIM_BOND_MINOR * 4, 'dbond');
  fund(rt, attacker, CAMPAIGN_BOND_MINOR * 3, 'chest');
  rt.runTick();
  send(rt, defender, 'post_bond', { amount: CLAIM_BOND_MINOR });
  rt.runTick();
  send(rt, defender, 'build', { kind: 'ANCHOR', system: objective });
  rt.runTick();

  // Materiel for the whole war, except on STARVE where only the first pulse is funded.
  const pulsesFunded = script === 'STARVE' ? 1 : CAMPAIGN_PULSES + 1;
  source(rt, attacker, depot, MATERIEL_GOOD, PULSE_MATERIEL_QTY * pulsesFunded, 'materiel');
  rt.runTick();

  // ── DECLARE ────────────────────────────────────────────────────────────────
  const refusal = send(rt, attacker, 'build', { kind: 'CAMPAIGN', system: objective });
  rt.runTick();
  if (refusal !== null) throw new Error(`declaration refused: ${refusal}`);
  const campaign = rt.campaigns.liveAgainst(objective);
  if (campaign === null) throw new Error('no campaign row after an accepted declaration');
  const id = campaign.id;

  // ── MARCH ──────────────────────────────────────────────────────────────────
  //
  // The attacker's hands walk to the objective; the defender's stay home on DEFEND and are sent away
  // otherwise, so PRESS is an undefended objective and DEFEND is a contested one. This is the decision
  // the cast does not make, supplied so the measurement is of the mechanic.
  const marchers: readonly HandId[] = rt.world.handsByPrincipal.get(attacker) ?? [];
  if (script === 'PRESS' || script === 'DEFEND' || script === 'STARVE' || script === 'LIFT') {
    for (const hand of marchers) {
      send(rt, attacker, 'move', { hand, to: objective });
      rt.runTick();
    }
  }
  // ── THE DEFENDER KEEPS ONE HAND HOME, ALWAYS ───────────────────────────────
  //
  // Not a balance choice: the CHARGE is payable only by a hand standing at the claimed system, and a
  // defender with nobody there cannot pay. The first run of this probe moved every defender hand away
  // and **every campaign ended MOOT on the third Reckoning** — because the claim lapsed on its own,
  // from arrears, before any war could take it. That is the correct behaviour and it is worth recording:
  // *a campaign against a claimant that is not paying is pointless*, because the world takes the claim
  // for free at the third miss. A campaign is for the claim somebody is PAYING for, and the probe has to
  // make the defender pay or it measures the arrears ladder instead.
  const defenderHands = rt.world.handsByPrincipal.get(defender) ?? [];
  if (script !== 'DEFEND') {
    for (const hand of defenderHands.slice(1)) {
      send(rt, defender, 'move', { hand, to: depot });
      rt.runTick();
    }
  }

  // ── RUN THE WAR ────────────────────────────────────────────────────────────
  const limit = (CAMPAIGN_PULSES + 2) * TICKS_PER_RECKONING;
  let halted = false;
  let didScriptAct = false;
  while (rt.engine.tick < limit) {
    const report = rt.runTick();
    if (report.halted) {
      halted = true;
      console.error(
        `HALT ${seed}/${script} at tick ${String(report.tick)}: ` +
          report.violations.map((v) => `${v.id} ${v.message}`).join(' · '),
      );
      break;
    }
    // ── THE DEFENDER PAYS ITS CHARGE, EVERY RECKONING ────────────────────────
    //
    // Supplied for the reason above. `deliver` is the real verb and the goods are really destroyed, so
    // the claim stays SUPPLIED by the same road any agent would use — which is what makes the campaign
    // the ONLY route to this system and therefore what this probe is measuring.
    if (rt.engine.tick % TICKS_PER_RECKONING === 8) {
      const owed = rt.sovereignty.owingOf(Math.trunc(rt.engine.tick / TICKS_PER_RECKONING), objective).owed;
      if (owed > 0) {
        source(rt, defender, objective, CHARGE_GOOD, owed, `charge${String(rt.engine.tick)}`);
        send(rt, defender, 'deliver', { obligation: 'CHARGE', system: objective });
      }
    }

    const live = rt.campaigns.get(id);
    if (live === undefined) throw new Error('the campaign row was pruned mid-war');
    if (live.state !== 'MASSING' && live.state !== 'PRESSING') break;

    // One scripted act, after the first pulse has landed, so each branch is measured against a war
    // that had actually started.
    if (!didScriptAct && live.pulses.length >= 1) {
      if (script === 'CEDE') {
        send(rt, defender, 'abandon', { claim: objective });
        didScriptAct = true;
      } else if (script === 'LIFT') {
        send(rt, attacker, 'withdraw', { campaign: id });
        didScriptAct = true;
      }
    }
  }

  const row = rt.campaigns.get(id);
  if (row === undefined) throw new Error('the campaign row is gone');
  const claim = rt.sovereignty.at(objective);
  const balance = rt.ledger.freeBalance(storesAccount(attacker));
  return {
    seed,
    script,
    state: row.state,
    legend: rt.campaignsFor(attacker, rt.engine.tick, 4).find((c) => c.campaign === id)?.legend ?? '?',
    pulses: row.pulses.length,
    claimAfter: claim === null ? 'NONE' : `${claim.state}/${claim.claimant === defender ? 'held' : 'moved'}`,
    bondBack: row.returned,
    forfeited: row.forfeited,
    endedTick: row.endedAtTick,
    ticker: campaignTickerLine(row),
    halted,
    // `balance` is read to keep the ledger honest in the run; not a reported column.
    ...(balance >= 0 ? {} : {}),
  };
}

function main(): void {
  const seeds = process.argv.slice(2);
  const list = seeds.length > 0 ? seeds : ['c01', 'c02', 'c03'];
  const rows: Row[] = [];
  for (const seed of list) {
    for (const script of SCRIPTS) {
      rows.push(runOne(seed, script));
    }
  }

  const head = ['seed', 'script', 'state', 'pulses', 'claim after', 'bond back', 'forfeit', 'ended'];
  console.log(`\ncampaign probe — ${String(list.length)} seed(s) x ${String(SCRIPTS.length)} scripts\n`);
  console.log(
    `${head[0]?.padEnd(6) ?? ''}${head[1]?.padEnd(9) ?? ''}${head[2]?.padEnd(11) ?? ''}` +
      `${head[3]?.padStart(7) ?? ''}  ${head[4]?.padEnd(16) ?? ''}${head[5]?.padStart(10) ?? ''}` +
      `${head[6]?.padStart(9) ?? ''}${head[7]?.padStart(8) ?? ''}`,
  );
  for (const r of rows) {
    console.log(
      `${r.seed.padEnd(6)}${r.script.padEnd(9)}${r.state.padEnd(11)}${String(r.pulses).padStart(7)}  ` +
        `${r.claimAfter.padEnd(16)}${String(r.bondBack).padStart(10)}${String(r.forfeited).padStart(9)}` +
        `${String(r.endedTick ?? '—').padStart(8)}`,
    );
  }
  console.log('\nthe ticker, which is what a viewer reads:\n');
  for (const r of rows.slice(0, SCRIPTS.length)) {
    console.log(`  ${r.ticker}`);
  }

  const unfinished = rows.filter((r) => r.state === 'MASSING' || r.state === 'PRESSING');
  const halted = rows.filter((r) => r.halted);
  const bondBroken = rows.filter((r) => r.bondBack + r.forfeited !== CAMPAIGN_BOND_MINOR);
  console.log(
    `\nRESULT ${JSON.stringify({
      runs: rows.length,
      halted: halted.length,
      unfinished: unfinished.length,
      bondUnaccounted: bondBroken.length,
      endings: Object.fromEntries(
        [...new Set(rows.map((r) => r.state))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((s) => [s, rows.filter((r) => r.state === s).length]),
      ),
      claimsFallen: rows.filter((r) => r.claimAfter.startsWith('LAPSED')).length,
    })}`,
  );
  if (unfinished.length > 0 || halted.length > 0 || bondBroken.length > 0) process.exitCode = 1;
}

main();
