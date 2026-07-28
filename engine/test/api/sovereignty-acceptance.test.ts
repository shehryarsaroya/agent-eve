/**
 * **THE ACCEPTANCE TEST: an enrolled principal takes territory, is billed for it, pays,
 * misses, and loses it — with every step in its own observation before it happens.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **A TEST THAT CONSTRUCTS A CLAIM DIRECTLY DOES NOT COUNT.** `test/sovereignty/*.spec.ts`
 * drives the arithmetic through fixtures, on purpose and correctly — and that shortcut is
 * exactly what let a green suite coexist with a world no player could be raided in until
 * `commons-exit.test.ts` was written (read its header). So nothing in this file reaches into
 * the world to place a claim, post a bond, or move a holding.
 *
 * The principal here arrives through `POST /enroll` with no `seatAt`, reads its own
 * observation over signed HTTP, and **copies affordance `params` objects verbatim** at every
 * step: graduate, post_bond, build, deliver. If the mechanic ever stops being reachable that
 * way — a verb unregistered, an affordance withheld, a price it cannot see — this file goes
 * red and the fixture suite does not.
 *
 * The other half is A5′, and it is the half with a permanent public accusation on the end of
 * it: **before** each Reckoning settles, the test reads `obligations.charge[0]` and asserts
 * the state the settlement is about to record. `if_you_do_nothing` is the same function
 * settlement runs (`sovereignty/view.ts:claimDoNothing`), so if the two ever disagree this
 * file catches it on the tick before the record is written rather than after.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Every test below was mutation-checked: the line it covers was broken, the test was
 * confirmed red, and the line restored. The mutations are named in each test.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { GameEvent, PrincipalId, SystemId } from '../../src/core/types.js';
import { route } from '../../src/world/index.js';
import { storesAccount } from '../../src/ledger/index.js';
import {
  ANCHOR_QTY,
  CHARGE_GOOD,
  CHARGE_MISSES_TO_LAPSE,
  CLAIM_BOND_MINOR,
} from '../../src/sovereignty/index.js';
import { giveAlloy } from '../works/alloy-fixture.js';
import { PATHS, agent, enrol, harness, signed, tick, type Agent, type Harness } from './harness.js';

let h: Harness;

beforeEach(async () => {
  h = await harness({ seed: 'sovereignty-acceptance' });
});
afterEach(async () => {
  await h.close();
});

type Row = Record<string, unknown>;

function obs(body: Record<string, unknown>): Row {
  const o = body['observation'];
  expect(typeof o).toBe('object');
  return o as Row;
}

async function observe(who: Agent): Promise<Row> {
  const res = await signed(h, who, 'GET', PATHS.observe);
  expect(res.status, res.text.slice(0, 400)).toBe(200);
  return obs(res.json);
}

function affordance(observation: Row, name: string, match?: (a: Row) => boolean): Row | undefined {
  return (observation['affordances'] as Row[]).find(
    (a) => a['verb'] === name && (match === undefined || match(a)),
  );
}

/** Submit one act over real signed HTTP and assert it was not refused at the door. */
async function act(who: Agent, name: string, params: unknown): Promise<void> {
  const res = await signed(h, who, 'POST', PATHS.act, {
    actions: [{ verb: name, params, clientSequence: 1 }],
  });
  expect(res.status, `${name} -> ${res.status}: ${res.text.slice(0, 600)}`).toBe(200);
  const outcome = res.json['outcome'] as Row;
  expect(
    outcome['corrections'],
    `${name} was refused at the door: ${JSON.stringify(outcome['corrections'])}`,
  ).toEqual([]);
}

/** Copy an affordance's own `params` and send it. The whole point of the file. */
async function take(who: Agent, observation: Row, verb: string, match?: (a: Row) => boolean): Promise<Row> {
  const offer = affordance(observation, verb, match);
  expect(offer, `${verb} must be OFFERED, not merely allowed`).toBeDefined();
  const params = offer?.['params'] as Row;
  await act(who, verb, params);
  tick(h, 1);
  expect(
    h.runtime.takeCorrections(who.principalId as PrincipalId).map((c) => `${c.verb}/${c.invariant}: ${c.hint}`),
    `the ${verb} affordance was copied verbatim and must resolve`,
  ).toEqual([]);
  return offer as Row;
}

function chargeRows(observation: Row): readonly Row[] {
  return ((observation['obligations'] as Row)['charge'] ?? []) as Row[];
}

function threats(observation: Row): readonly Row[] {
  return ((observation['holding'] as Row)['threats'] ?? []) as Row[];
}

function eventsOfKind(kind: string): readonly GameEvent[] {
  const out: GameEvent[] = [];
  for (const t of h.runtime.events.ticks()) {
    for (const rec of h.runtime.events.eventsAtTick(t)) {
      if (rec.event.kind === kind) out.push(rec.event);
    }
  }
  return out;
}

/** Run ticks and fail loudly on a halt: a halted world makes every later assertion a lie. */
function run(n: number): void {
  for (let i = 0; i < n; i += 1) {
    const report = h.runtime.runTick();
    if (report.halted) {
      throw new Error(
        `halted at tick ${String(report.tick)}: ` +
          report.violations.map((v) => `${v.id} ${v.message}`).join(' | '),
      );
    }
  }
}

/** Advance to a phase of the current or next Reckoning. Never past a halt. */
function runToPhase(phase: number): void {
  const now = h.runtime.engine.tick;
  const base = now - (now % TICKS_PER_RECKONING);
  const target = base + phase > now ? base + phase : base + TICKS_PER_RECKONING + phase;
  run(target - now);
}

function freeMinor(who: Agent): number {
  const account = storesAccount(who.principalId as PrincipalId);
  return h.runtime.ledger.account(account) === undefined ? 0 : h.runtime.ledger.freeBalance(account);
}

/**
 * Enrol, cross, bond, and claim — **using nothing but the published surface.**
 *
 * Returns the system it claimed, read out of its own affordance rather than chosen here.
 */
async function enrolAndClaim(handle: string): Promise<{ who: Agent; system: string }> {
  const who = agent(handle);
  const enrolled = await enrol(h, who);
  expect(enrolled.status, enrolled.text.slice(0, 400)).toBe(201);
  tick(h, 1);

  const first = await observe(who);
  expect((first['holding'] as Row)['tier'], 'enrolment must still seat in the Commons').toBe('COMMONS');
  // A Commons-bound principal is told nothing about sovereignty, on purpose: a claim there
  // is INVALID rather than refused, so 3 KB of prose about it is a cost with no decision
  // attached. `graduation.statement` is what it reads instead.
  expect((first['holding'] as Row)['sovereignty']).toBeNull();
  // ── MATCHED ON THE KIND, NOT ON THE VERB, AND THAT IS THE POINT ───────────
  //
  // `build` is TWO acts now: `{"kind":"ANCHOR"}` takes territory and `{"kind":"WORKS"}` raises a
  // production structure. This assertion used to read "no `build` is offered in the Commons" and
  // went red the moment WORKS landed — correctly, because a WORKS in the Commons is legal and
  // must be: A8's floor is worthless if a newcomer cannot produce there.
  //
  // Kept as a kind-specific check rather than deleted, because the property it guards is real
  // and A8's: no CLAIM may be offered inside the Commons. And the fact that it broke is the
  // warning worth keeping — any agent matching on `verb === 'build'` alone gets whichever kind
  // happens to come first, which is why `agent.md` now says so in as many words.
  expect(
    affordance(first, 'build', (a) => (a['params'] as Row)['kind'] === 'ANCHOR'),
    'no claim is offered inside the Commons (A8)',
  ).toBeUndefined();
  expect(
    affordance(first, 'build', (a) => (a['params'] as Row)['kind'] === 'WORKS'),
    'but a WORKS is — a safe floor an agent cannot produce on is not a floor',
  ).toBeDefined();
  expect(affordance(first, 'post_bond'), 'no bond is offered inside the Commons').toBeUndefined();

  await take(who, first, 'graduate');

  const outside = await observe(who);
  const holding = outside['holding'] as Row;
  expect(holding['tier']).not.toBe('COMMONS');
  expect(holding['commons_bound']).toBe(false);
  // Now, and only now, the mechanic introduces itself.
  expect(String(holding['sovereignty'])).toContain('A CLAIM is your sovereign hold');
  expect((holding['bond'] as Row)['posted']).toBe(0);
  expect((holding['bond'] as Row)['required']).toBe(0);

  await take(who, outside, 'post_bond');

  const bonded = await observe(who);
  expect((bonded['holding'] as Row)['bond']).toMatchObject({ posted: CLAIM_BOND_MINOR, required: 0, claims: 0 });

  // ── THE ONE THING HERE THAT IS NOT COPIED FROM AN AFFORDANCE, AND WHY ─────
  //
  // The anchor's manufactured half is stood at the system through the same PRODUCTION faucet a
  // `refine` posts through, so the ledger and every invariant see what they would see if it had been
  // made in the Commons and hauled in. It is NOT reachable from where this principal stands: alloy
  // refines four times cheaper in the Commons and a claim is always outside it, so the honest road
  // is a franchise, a book that clears and a haul per lane — which
  // `test/works/a-good-only-the-commons-makes.spec.ts` walks end to end through this same door.
  // What THIS file has to keep proving is the Charge arc — assessed, paid, missed, lapsed, and
  // previewed correctly before each settlement — and it would prove none of it from behind a market.
  const anchorSystem = String((bonded['holding'] as Row)['system']) as SystemId;
  giveAlloy(h.runtime, who.principalId as PrincipalId, anchorSystem);
  tick(h, 1);
  await take(who, await observe(who), 'build', (a) => (a['params'] as Row)['kind'] === 'ANCHOR');

  const claimed = await observe(who);
  const system = String((claimed['holding'] as Row)['system']);
  expect((claimed['holding'] as Row)['bond']).toMatchObject({ required: CLAIM_BOND_MINOR, claims: 1 });
  return { who, system };
}

/**
 * Walk a hand to the claimed system, the way an agent has to.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THIS STEP IS NOT SCAFFOLDING — IT IS THE MECHANIC.** `graduate` moves a HOLDING and its
 * stores; it does not move hands. So a principal that has crossed, bonded and anchored has its
 * body and its goods at the claim and every hand still standing where it enrolled, and a Charge
 * is *goods physically handed over*. The first version of this file skipped the walk and the
 * `deliver` affordance was offered anyway; the acceptance test came back with the engine's own
 * refusal, which is an offer that costs an action (AGT-S2). Both sides were fixed: the
 * affordance is withheld with a counted reason, and this walk is what an agent actually does.
 * ══════════════════════════════════════════════════════════════════════════
 */
async function walkAHandTo(who: Agent, system: string): Promise<void> {
  const observation = await observe(who);
  const row = chargeRows(observation)[0] as Row;
  expect(row['hand_here'], 'the claim must publish that no hand is there yet').toBe(false);
  expect(
    affordance(observation, 'deliver', (a) => (a['params'] as Row)['obligation'] === 'CHARGE'),
    'an act the engine would refuse must never be offered',
  ).toBeUndefined();
  const withheld = (observation['header'] as Row)['withheld'] as Row;
  expect(String(withheld['reason']), 'and it must be counted, with the fix named').toContain('move` a hand');

  // ── ONE GATE AT A TIME, AND IT IS NOT ALWAYS ONE GATE ─────────────────
  //
  // A Commons holding may graduate through **any gate the zone has**, not just its own
  // system's lanes (that rule exists so no Commons seat is a cage), so the claimed system is
  // one lane from the *zone* and can be two or more from where this principal's hands are
  // standing. The walk is therefore a loop over the published route, taking the `move`
  // affordance for each hop verbatim. Transit is measured, never assumed: §17 calls gate
  // transit "the most load-bearing number in the design" and a test that hard-coded it would
  // pass for the wrong reason the day it changed.
  let walking: string | null = null;
  for (let hop = 0; hop < 10; hop += 1) {
    const now = await observe(who);
    if ((chargeRows(now)[0] as Row)['hand_here'] === true) break;
    // The SAME hand every hop, and the nearest one to start with. Picking "the first idle
    // hand" each time walks three hands one gate each and never arrives, which is a bug in a
    // test rather than in the engine — but it is the same class as the ones this file exists
    // to catch, so it is named.
    const idle = (now['hands'] as Row[])
      .filter((x) => x['state'] === 'IDLE' && (walking === null || x['id'] === walking))
      .sort(
        (a, b) =>
          (route(h.runtime.world.map, String(a['location']) as SystemId, system as SystemId)?.ticks ?? 1e9) -
          (route(h.runtime.world.map, String(b['location']) as SystemId, system as SystemId)?.ticks ?? 1e9),
      )[0];
    if (idle === undefined) {
      run(1);
      continue;
    }
    walking = String(idle['id']);
    const from = String(idle['location']);
    // ── ARRIVAL IS NOT PRESENCE, AND THE ENGINE SAYS SO ───────────────────
    //
    // `move`'s own affordance text: "a move resolving in tick R lands the hand on tick R+trip
    // and it is PRESENT — able to fill a role, work or escort — on R+trip+1." So a hand can be
    // IDLE at the claimed system and still not discharge a Charge for one more tick, and
    // `hand_here` reads `isPresent` rather than `location` because that is the predicate
    // `chargeDeliveryFault` actually applies. Waiting a tick here is the test agreeing with
    // the engine; asserting `location === system` was the test disagreeing with it.
    if (from === system) {
      run(1);
      continue;
    }
    const path = route(h.runtime.world.map, from as SystemId, system as SystemId);
    expect(path, `no lane route from ${from} to ${system}`).not.toBeNull();
    const next = String(path?.path[1] ?? system);
    await take(
      who,
      now,
      'move',
      (a) => (a['params'] as Row)['to'] === next && (a['params'] as Row)['hand'] === walking,
    );
    for (let i = 0; i < 40; i += 1) {
      const hand = ((await observe(who))['hands'] as Row[]).find((x) => x['id'] === walking);
      if (hand?.['state'] === 'IDLE' && hand['location'] === next) break;
      run(1);
    }
  }
  expect((chargeRows(await observe(who))[0] as Row)['hand_here'], 'the hand must arrive').toBe(true);
}

describe('THE ACCEPTANCE TEST — enrol, graduate, claim, pay, miss, lapse', () => {
  it('reaches a claim through the front door, and is told the recurring price before it takes one', async () => {
    // ══════════════════════════════════════════════════════════════════════
    // MUTATION 1: unregister `build` from `Runtime.verbTable()`. `liveVerbs` drops it,
    // `affordancesFor` still offers it, `POST /act` refuses it at the door with PHASE-0, and
    // `take` goes RED on the corrections assertion.
    //
    // MUTATION 2: make the 5d affordance block require `tierOf(...) === 'COMMONS'` instead of
    // `!== 'COMMONS'`. `post_bond` and `build` are offered only where a claim is invalid, and
    // this goes RED at the first `take` — which is the shape of the graduation bug (a verb
    // that exists and is never offered where it can be used).
    // ══════════════════════════════════════════════════════════════════════
    const { who, system } = await enrolAndClaim('vantage');

    const taken = eventsOfKind('claim.taken');
    expect(taken.length, 'taking a claim must publish it: territory nobody can see is not territory').toBe(1);
    expect(taken[0]?.payload).toMatchObject({
      system,
      claimant: who.principalId,
      route: 'VIRGIN',
      anchorQty: ANCHOR_QTY,
      good: CHARGE_GOOD,
      bondRequiredMinor: CLAIM_BOND_MINOR,
      state: 'SUPPLIED',
    });

    // The anchor was DESTROYED, not parked, and it was destroyed where it stood. `sink:consumption`
    // is the named sink, so the goods left the economy rather than moving somewhere useful.
    const anchored = h.runtime.ledger
      .lotsInAccount(storesAccount(who.principalId as PrincipalId))
      .filter((l) => l.good === CHARGE_GOOD && l.location === system)
      .reduce((n, l) => n + l.qty, 0);
    expect(anchored).toBeGreaterThan(0);
    expect(anchored).toBeLessThan(50_000);

    // The bond is LOCKED, not spent, and it is not in EXPOSURE. Both halves matter: a bond in
    // EXPOSURE would silently move every Levy allocation computed BY_EXPOSURE.
    expect(h.runtime.ledger.balance(storesAccount(who.principalId as PrincipalId))).toBeGreaterThan(
      CLAIM_BOND_MINOR,
    );
    expect(h.runtime.ledger.encumbrances.cachedExposure(who.principalId as PrincipalId)).toBe(0);
  });

  it('is assessed a Charge it can read, in goods, at the place, before the deadline (A5-prime, A2)', async () => {
    // MUTATION: drop the `assessChargeNow(ctx)` call from the OBLIGE handler. No plan is
    // minted, `obligations.charge` is an empty array, and every assertion below goes RED —
    // which is also the only A5′-safe failure mode, because a claim with no assessment is
    // never billed and never recorded short.
    const { who, system } = await enrolAndClaim('halcyon');

    const observation = await observe(who);
    const rows = chargeRows(observation);
    expect(rows.length, 'a claim must carry an assessment the tick it exists').toBe(1);
    const row = rows[0] as Row;

    // A2: exact and machine-readable, and computable by a stranger from the published tier.
    expect(row['system']).toBe(system);
    expect(row['good']).toBe(CHARGE_GOOD);
    expect(Number(row['due'])).toBeGreaterThan(0);
    expect(row['due']).toBe(row['rule_qty']);
    expect(row['paid']).toBe(0);
    expect(row['owed']).toBe(row['due']);
    expect(row['state']).toBe('SUPPLIED');
    expect(row['legend']).toBe('PAID');
    expect(row['arrears']).toBe(0);
    expect(row['arrears_of']).toBe(CHARGE_MISSES_TO_LAPSE - 1);

    // The deadline is in the future and the consequence of missing it is stated NOW.
    expect(Number(row['deadline_tick'])).toBeGreaterThan(h.runtime.engine.tick);
    expect(row['if_you_do_nothing']).toBe('ENTERS_ARREARS');
    expect(String(row['consequence'])).toContain('ARREARS 1 of');
    expect(Number(row['bond_at_risk'])).toBe(CLAIM_BOND_MINOR);
    // And the goods are there to pay it with, at the claimed system.
    expect(Number(row['available_here'])).toBeGreaterThanOrEqual(Number(row['due']));

    // ── NEITHER EXIT IS OFFERED YET, AND THAT IS A12 ─────────────────────
    //
    // The claim owes its first Charge and has ~280 ticks to pay it. `abandon` and a cession
    // offer are the *collapse* arc's exits and they belong to a claim the record has actually
    // published a miss against.
    //
    // MUTATION: widen the exits' guard from `state === STRAINED || CONTESTED` to
    // `claim.if_you_do_nothing !== 'STAYS_SUPPLIED'` (the first draft). Every claim is then
    // handed "sell it" and "give it up" at the start of every Reckoning, before it has missed
    // anything — the server suggesting surrender, which is narrative and not a sandbox. RED here.
    expect(
      affordance(observation, 'abandon', (a) => (a['params'] as Row)['claim'] === system),
      'a claim that has missed nothing must not be offered a way out of it',
    ).toBeUndefined();
    expect(
      affordance(observation, 'publish_offer', (a) => (a['params'] as Row)['cede'] === system),
    ).toBeUndefined();

    // `briefing.if_you_do_nothing` names it too. This is the field a playtest caught saying
    // "absence costs opportunity and nothing else" while a Levy shortfall accrued; the Charge
    // is that failure with territory on the end of it.
    const briefing = observation['briefing'] as Row;
    expect(String(briefing['if_you_do_nothing'])).toContain(system);
    expect(String(briefing['if_you_do_nothing'])).toContain('ARREARS');
  });

  it('pays it once and settles SUPPLIED, with the arrears counter at zero', async () => {
    // ══════════════════════════════════════════════════════════════════════
    // MUTATION 1: make `deliverCharge` not call `book.credit` at all. The goods are destroyed
    // and nothing is credited — the mirror of a fabricated payment — and `owed` stays at `due`.
    // RED.
    //
    // MUTATION 2: drop `&& claim.hand_here` from the deliver affordance's guard. The offer
    // comes back for a principal with no hand at the claim, `take` copies it verbatim, and the
    // engine's own refusal lands in `corrections`. RED — and that is the exact defect this test
    // found on its first run.
    //
    // **ONE CLAIM THIS TEST DOES NOT OWN, STATED RATHER THAN IMPLIED.** `deliverCharge` credits
    // `moved` and not `want`, which is the A5′ order (the ledger moves first, then the credit).
    // Mutating `moved` → `want` leaves this test GREEN, because on every path reachable from the
    // API the two are equal — the goods are checked present before the burn. The discipline is
    // real and the failure it prevents needs a partial destruction, which no agent action can
    // cause today. It is code order under review, not a property under test, and pretending
    // otherwise is the oversold-guard habit that cost five claims on another build.
    // ══════════════════════════════════════════════════════════════════════
    const { who, system } = await enrolAndClaim('orrin');

    await walkAHandTo(who, system);
    const before = await observe(who);
    const due = Number((chargeRows(before)[0] as Row)['due']);
    await take(who, before, 'deliver', (a) => (a['params'] as Row)['obligation'] === 'CHARGE');

    const after = await observe(who);
    const row = chargeRows(after)[0] as Row;
    expect(row['paid']).toBe(due);
    expect(row['owed']).toBe(0);
    expect(row['if_you_do_nothing']).toBe('STAYS_SUPPLIED');
    // Nothing is a threat while the bill is paid. An always-on warning trains agents to
    // ignore the field that matters most.
    expect(threats(after)).toEqual([]);
    // ── AND NEITHER EXIT IS OFFERED, WHICH IS A12 ────────────────────────
    //
    // MUTATION: widen the exits' guard from `state === STRAINED || CONTESTED` back to
    // `claim.owed > 0`. Every claim is then offered "sell it" and "give it up" at the start of
    // every Reckoning, including one that has just paid in full — the server suggesting
    // surrender, which is narrative and not a sandbox. RED here.
    expect(
      affordance(after, 'abandon', (a) => (a['params'] as Row)['claim'] === system),
      'a claim that paid must not be offered a way to give it up',
    ).toBeUndefined();
    expect(
      affordance(after, 'publish_offer', (a) => (a['params'] as Row)['cede'] === system),
    ).toBeUndefined();

    const delivered = eventsOfKind('charge.delivered');
    expect(delivered.length).toBe(1);
    expect(delivered[0]?.payload).toMatchObject({ system, qty: due, stillOwedQty: 0, rescue: false });

    runToPhase(TICKS_PER_RECKONING - 1);
    run(1);

    expect(h.runtime.sovereignty.liveAt(system as never)?.state).toBe('SUPPLIED');
    expect(h.runtime.sovereignty.missesAt(system as never)).toBe(0);
    expect(eventsOfKind('charge.arrears').length, 'a claim that paid must never be recorded short').toBe(0);
  });

  it('misses one and goes into PUBLIC arrears — and nothing else is taken', async () => {
    // MUTATION: in `settleCharge`, call `book.clearMisses` on the unpaid branch as well. The
    // arrears counter stays 0, the claim stays SUPPLIED, and both the event assertion and the
    // state assertion go RED. That is the mutation that would make a claim unlose-able.
    const { who, system } = await enrolAndClaim('sable');
    const bondBefore = freeMinor(who);

    // Read the prediction BEFORE the settlement that makes it true. This is the ordering the
    // whole file exists for: the record may only say what the agent was already shown.
    const before = await observe(who);
    expect((chargeRows(before)[0] as Row)['if_you_do_nothing']).toBe('ENTERS_ARREARS');

    runToPhase(TICKS_PER_RECKONING - 1);
    run(1);

    const arrears = eventsOfKind('charge.arrears');
    expect(arrears.length).toBe(1);
    expect(arrears[0]?.payload).toMatchObject({
      system,
      claimant: who.principalId,
      arrears: 1,
      state: 'STRAINED',
      slashedMinor: 0,
      // §5.2's protections survive sovereignty, and the receipt says so in full so a reader
      // can see that nothing else moved.
      identityTaken: false,
      holdingTaken: false,
      standingTaken: false,
      handsTaken: false,
    });
    // The arithmetic travels with the accusation (INV-17's rule, applied where it belongs).
    const payload = arrears[0]?.payload as Row;
    expect(Number(payload['assessedQty']) - Number(payload['paidQty'])).toBe(Number(payload['owedQty']));

    expect(h.runtime.sovereignty.liveAt(system as never)?.state).toBe('STRAINED');
    // Nothing was slashed on a first miss. Arrears cost publicity and nothing else.
    expect(freeMinor(who)).toBe(bondBefore);
    expect(h.runtime.standing.rows().length, 'an arrears is not a broken promise (INV-21)').toBe(0);

    const after = await observe(who);
    const row = chargeRows(after)[0] as Row;
    expect(row['state']).toBe('STRAINED');
    expect(row['legend']).toBe(`ARREARS 1 of ${String(CHARGE_MISSES_TO_LAPSE - 1)}`);
    // The cure is the CURRENT Charge plus a bounded surcharge, never accumulated back arrears.
    expect(Number(row['due'])).toBeGreaterThan(0);
    expect(Number(row['rule_qty'])).toBeGreaterThan(Number((chargeRows(before)[0] as Row)['rule_qty']));
    expect(threats(after).length).toBe(1);
    expect(threats(after)[0]).toMatchObject({ kind: 'CHARGE_ARREARS', system, state: 'STRAINED' });
  });

  it('misses twice and becomes CONTESTED, with the window published and the fall one Reckoning ahead', async () => {
    // MUTATION: in `settleCharge`, change `misses >= 2` to `misses >= 99`. The claim stays
    // STRAINED forever, `NEXT MISS LAPSES` never appears, and the window never opens — the
    // collapse arc silently loses its middle. RED on the legend assertion.
    const { who, system } = await enrolAndClaim('brannock');

    runToPhase(TICKS_PER_RECKONING - 1);
    run(1);
    runToPhase(TICKS_PER_RECKONING - 1);
    run(1);

    expect(h.runtime.sovereignty.liveAt(system as never)?.state).toBe('CONTESTED');
    expect(h.runtime.sovereignty.missesAt(system as never)).toBe(2);

    const observation = await observe(who);
    const row = chargeRows(observation)[0] as Row;
    expect(row['state']).toBe('CONTESTED');
    expect(String(row['legend'])).toContain('NEXT MISS LAPSES');
    // A14: the clock is published, and the defender reads the same one a challenger does.
    const window = row['vulnerability'] as Row;
    expect(window['first_phase']).toBe(168);
    expect(window['last_phase']).toBe(240);
    expect(Number(window['opens_tick'])).toBeGreaterThan(0);
    // And the fall is stated one whole Reckoning before it happens.
    expect(row['if_you_do_nothing']).toBe('LAPSES');
    expect(String(row['consequence'])).toContain('LAPSES');
    expect(String(row['consequence'])).toContain('abandon');

    // Both exits are offered while the claim is failing, and not before.
    expect(affordance(observation, 'abandon', (a) => (a['params'] as Row)['claim'] === system)).toBeDefined();
    expect(affordance(observation, 'publish_offer', (a) => (a['params'] as Row)['cede'] === system)).toBeDefined();
    // The salvage is strictly cheaper than the lapse, which is the arithmetic that makes the
    // fire sale a decision rather than a consolation.
    const exit = affordance(observation, 'abandon', (a) => (a['params'] as Row)['claim'] === system) as Row;
    expect(Number(exit['max_direct_loss'])).toBeLessThan(Number(row['bond_at_risk']));
  });

  it('misses a third time and LAPSES: the claim ends, the bond is slashed, and nothing else moves', async () => {
    // ══════════════════════════════════════════════════════════════════════
    // MUTATION 1: make `slashPort.slash` return `minor(0)` without retiring. The event
    // records `slashedMinor: 0` while the claim still lapsed, and the balance assertion goes
    // RED — a lapse that takes nothing is a bond that was never slashable.
    //
    // MUTATION 2: in `slashPort`, retire BEFORE releasing the lock. `retireCurrency` refuses
    // to take locked value, the catch files a fault, and `slashedMinor` is 0. RED, and it is
    // the ordering bug the port's own header argues about.
    // ══════════════════════════════════════════════════════════════════════
    const { who, system } = await enrolAndClaim('kestrel');
    const balanceBefore = h.runtime.ledger.balance(storesAccount(who.principalId as PrincipalId));

    for (let i = 0; i < CHARGE_MISSES_TO_LAPSE - 1; i += 1) {
      runToPhase(TICKS_PER_RECKONING - 1);
      run(1);
    }

    // The last observation before the fall must say the fall is coming, with the figure.
    const warned = await observe(who);
    const row = chargeRows(warned)[0] as Row;
    expect(row['if_you_do_nothing']).toBe('LAPSES');
    expect(Number(row['bond_at_risk'])).toBe(CLAIM_BOND_MINOR);
    expect(String((warned['briefing'] as Row)['if_you_do_nothing'])).toContain('LAPSE');

    runToPhase(TICKS_PER_RECKONING - 1);
    run(1);

    const lapsed = eventsOfKind('claim.lapsed');
    expect(lapsed.length, 'the third consecutive miss must end the claim').toBe(1);
    expect(lapsed[0]?.payload).toMatchObject({
      system,
      claimant: who.principalId,
      arrears: CHARGE_MISSES_TO_LAPSE,
      state: 'LAPSED',
      slashedMinor: CLAIM_BOND_MINOR,
      identityTaken: false,
      holdingTaken: false,
      standingTaken: false,
      handsTaken: false,
    });

    // The claim is gone and the capital is gone with it.
    expect(h.runtime.sovereignty.liveAt(system as never)).toBeNull();
    expect(h.runtime.ledger.balance(storesAccount(who.principalId as PrincipalId))).toBe(
      balanceBefore - CLAIM_BOND_MINOR,
    );
    // The lock went with it, so nothing is left for INV-4 to call an orphan.
    expect(h.runtime.bondView(who.principalId as PrincipalId)).toMatchObject({ posted: 0, required: 0, claims: 0 });

    // ── AND THE THREE PROTECTIONS HELD ──────────────────────────────────
    //
    // A5′ and §5.2: a claimant that loses everything it projected is still a player. This is
    // the assertion that would catch a future edit reaching for a holding through the lapse.
    const survivor = await observe(who);
    expect((survivor['holding'] as Row)['state']).toBe('INTACT');
    expect((survivor['holding'] as Row)['id']).toBeDefined();
    expect((survivor['hands'] as Row[]).length).toBe(3);
    expect(h.runtime.standing.rows().length).toBe(0);
    // And it owes nothing further: the bill dies with the claim.
    expect(chargeRows(survivor)).toEqual([]);
    expect(threats(survivor)).toEqual([]);
  });
});
