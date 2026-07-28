/**
 * **THE ACCEPTANCE TEST: an enrolled principal, starting where the API really puts it,
 * reaches the Marches and is raided there.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A live playtest ran eight probes against the running world. The predation probe came
 * back with this:
 *
 * > "I could not get raided, could not resist, and could never have seen a raid coming,
 * > because in this build no raid can arrive at anyone… a Commons-holding principal is
 * > Commons-bound and its hands cannot leave, with no live verb to move or build a
 * > holding — so the exit does not exist."
 *
 * Three correct facts made it true: enrolment always seats through
 * `safestSeat(map, commonsSystems(map), …)`; `commonsBoundRejection` refuses any hand
 * movement out while the holding is Commons-tier; and `relocateHolding` existed with no
 * caller. A8's permanent floor had become the **entire world** — predation shipped and
 * could never touch a player, the Marches and the Frontier were decorative, and there
 * was no risk/reward choice anywhere in the game.
 *
 * **THIS FILE DOES NOT SEAT ANYBODY IN THE MARCHES.** `test/predation/fixture.ts` does —
 * on purpose and correctly, so the predation arithmetic has something to bite on — and
 * that shortcut is exactly what let a green suite coexist with a world no player could
 * be raided in. Every principal here arrives through `POST /enroll` with no `seatAt`,
 * reads its own observation over signed HTTP, copies an affordance **verbatim**, and
 * gets where it gets on the strength of the published surface alone. If the exit ever
 * stops being reachable that way, this file goes red and the fixture-based suite does
 * not.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Every test below was mutation-checked: the line it covers was broken, the test was
 * confirmed red, and the line restored. The mutations are named in each test.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GameEvent, PrincipalId, SystemId } from '../../src/core/types.js';
import { GOODS_FAUCET, GOODS_SINK, storesAccount } from '../../src/ledger/index.js';
import { LEVY_GOOD } from '../../src/levy/index.js';
import { DEMAND_WINDOW_TICKS, RAID_SPAWN_PHASES } from '../../src/predation/index.js';
import {
  GRADUATION_UPKEEP_MINOR,
  GRADUATION_UPKEEP_QTY,
  tierOf,
} from '../../src/world/index.js';
import { PATHS, agent, enrol, harness, signed, tick, type Agent, type Harness } from './harness.js';

let h: Harness;

beforeEach(async () => {
  h = await harness({ seed: 'commons-exit' });
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

function affordance(observation: Row, name: string): Row | undefined {
  return (observation['affordances'] as Row[]).find((a) => a['verb'] === name);
}

function holding(observation: Row): Row {
  return observation['holding'] as Row;
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

/** A refusal from VALIDATE+LOCK arrives on the next read, never in the act response. */
function corrections(who: Agent): readonly { invariant: string; hint: string; verb: string }[] {
  return h.runtime.takeCorrections(who.principalId as never);
}

function expectResolved(who: Agent, what: string): void {
  expect(corrections(who).map((c) => `${c.verb}/${c.invariant}: ${c.hint}`), what).toEqual([]);
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

function goodsAt(who: Agent, system: string): number {
  let total = 0;
  for (const lot of h.runtime.ledger.lotsInAccount(storesAccount(who.principalId as PrincipalId))) {
    if (lot.good !== LEVY_GOOD || lot.location !== system) continue;
    total += lot.qty;
  }
  return total;
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

/**
 * Enrol, read, and cross — **using nothing but the published surface**.
 *
 * The destination is whatever `holding.graduation.open[0]` says, and the act body is the
 * affordance's own `params` object passed through untouched. Nothing here knows a system
 * id, and nothing here reaches into the world to place anybody.
 */
async function enrolAndCross(handle: string): Promise<{ who: Agent; to: string }> {
  const who = agent(handle);
  const enrolled = await enrol(h, who);
  expect(enrolled.status, enrolled.text.slice(0, 400)).toBe(201);
  tick(h, 1);

  const before = await observe(who);
  // Where the API really put it. Not asserted as a nicety — if this ever stops being
  // COMMONS the rest of the file is testing a different question than it claims to.
  expect(holding(before)['tier']).toBe('COMMONS');
  expect(holding(before)['commons_bound']).toBe(true);

  const offer = affordance(before, 'graduate');
  expect(offer, 'a freshly enrolled principal must be OFFERED the exit, not merely allowed it').toBeDefined();
  const params = offer?.['params'] as Row;
  const to = String(params['to']);

  await act(who, 'graduate', params);
  tick(h, 1);
  expectResolved(who, 'the graduate affordance was copied verbatim and must resolve');
  return { who, to };
}

// ── 1. the exit exists, and it is reachable from the published surface ───────

describe('THE ACCEPTANCE TEST — enrol, leave the Commons, get raided there', () => {
  it('an enrolled principal reaches a MARCHES system by copying its own affordance', async () => {
    // MUTATION: delete the `graduate` entry from `Runtime.verbTable()` — `liveVerbs` drops
    // it, `affordancesFor` filters the offer out, and `offer` is undefined. RED.
    const { who, to } = await enrolAndCross('vantage');

    const after = await observe(who);
    expect(holding(after)['system']).toBe(to);
    // The whole point: a principal that came in through the front door is now standing
    // somewhere a raid can reach.
    expect(holding(after)['tier']).toBe('MARCHES');
    expect(holding(after)['commons_bound']).toBe(false);
    expect(tierOf(h.runtime.world.map, to as SystemId)).toBe('MARCHES');
  });

  it('and is then raided there, by the world, with nobody choosing conflict (A14)', async () => {
    // ══════════════════════════════════════════════════════════════════════
    // THE SENTENCE THE PROBE COULD NOT WRITE. Nothing in this test aims a raid: the
    // schedule spawns it, the published target rule picks the target, and the target is
    // the one principal in the world with goods standing outside the Commons — which it
    // is because it walked out through the front door two lines ago.
    //
    // MUTATION: make `carryStoresTo` a no-op. The body crosses, the stores stay in the
    // Commons, `assailableOf` sees nothing outside the floor, and no raid ever spawns.
    // RED — and that mutation is precisely the half-fix that would have shipped a verb
    // and left the world exactly as quiet as the probe found it.
    // ══════════════════════════════════════════════════════════════════════
    const { who, to } = await enrolAndCross('bellows');
    expect(goodsAt(who, to)).toBeGreaterThan(0);

    const firstSpawn = RAID_SPAWN_PHASES[0] ?? 48;
    run(firstSpawn + 2 - h.runtime.engine.tick);

    const spawned = eventsOfKind('raid.spawned');
    expect(spawned.length, 'the world must spawn a raid at the published phase').toBeGreaterThan(0);
    const first = spawned[0]?.payload as Row;
    expect(first['target']).toBe(who.principalId);
    expect(first['stage']).toBe(to);
    // A world raid has no actor, which is why nobody can be bribed to call it off (§9).
    expect(spawned[0]?.actorPrincipalId).toBeNull();

    // And the agent can SEE it, in its own observation, with a deadline on it (A2).
    const under = await observe(who);
    const raids = (under['obligations'] as Row)['raid'] as Row[];
    expect(raids.length, 'the target must be told it is being raided').toBeGreaterThan(0);
    expect(raids[0]?.['stage']).toBe(to);
    expect(affordance(under, 'yield'), 'and offered the three answers').toBeDefined();
    expect(affordance(under, 'fight')).toBeDefined();
  });

  it('ignoring the demand costs it real goods at the deadline, publicly and permanently (A5)', async () => {
    // The end of the loop the probe said did not exist: enrol -> leave -> get raided ->
    // lose something. Nothing is answered here; the deadline does the work.
    const { who, to } = await enrolAndCross('marrowdown');
    const held = goodsAt(who, to);

    const firstSpawn = RAID_SPAWN_PHASES[0] ?? 48;
    run(firstSpawn + DEMAND_WINDOW_TICKS + 2 - h.runtime.engine.tick);

    const resolved = eventsOfKind('raid.resolved');
    expect(resolved.length, 'the demand window must close').toBeGreaterThan(0);
    const payload = resolved[0]?.payload as Row;
    expect(payload['target']).toBe(who.principalId);
    expect(payload['stage']).toBe(to);
    expect(Number(payload['lost'])).toBeGreaterThan(0);
    expect(goodsAt(who, to)).toBeLessThan(held);
    // A raid is never an accusation: it moves goods, never the record (§15.4, A5′).
    expect(payload['is_default']).toBe(false);
    expect(resolved[0]?.isPublic).toBe(true);
  });
});

// ── 2. the floor still holds ─────────────────────────────────────────────────

describe('A8 — the Commons floor is untouched by the exit existing', () => {
  it('a principal that stays is never a raid target, however long the world runs', async () => {
    // MUTATION: change `predationPort.assailable`'s Commons filter from
    // `safeTier(lot.location) !== 'COMMONS'` to `true`. The stayer becomes the top target
    // and this goes RED — which is the assertion that the exit did not open the floor.
    const stayer = agent('hearthward');
    await enrol(h, stayer);
    tick(h, 1);
    const seat = String(holding(await observe(stayer))['system']);
    expect(tierOf(h.runtime.world.map, seat as SystemId)).toBe('COMMONS');

    // Past two spawn phases and both their windows, with a fat pile of goods sitting in
    // the open — the single most attractive target the rule could possibly have, and it
    // is not a target at all because nothing in the Commons ever is.
    run(RAID_SPAWN_PHASES[1] ?? 120);
    expect(goodsAt(stayer, seat)).toBeGreaterThan(0);
    for (const event of eventsOfKind('raid.spawned')) {
      expect((event.payload as Row)['target']).not.toBe(stayer.principalId);
    }
    expect(h.runtime.raids.size()).toBe(0);
  });

  it('a raid that reached the Marches still cannot reach what stayed in the Commons', async () => {
    // ══════════════════════════════════════════════════════════════════════
    // **THE LOT-LEVEL FLOOR, FROM THE FAR SIDE.** A8 protects a *place*, not a
    // principal — `predationPort.assailable` filters on `lot.location`, which is what
    // lets a Commons-seated principal be raided for what it hauled out and for nothing it
    // left at home. This test asserts the mirror image: a principal that has *left* keeps
    // the protection on whatever is still standing inside the floor.
    //
    // A pledged lot is what stays: `lots.ts` says a pledged lot "cannot be sent away", so
    // `carryStoresTo` leaves it, and the crossing publishes how much stayed rather than
    // dropping it silently.
    //
    // MUTATION: this property has **two independent guards** and one is not enough to
    // prove — removing either alone leaves the other holding, which is the correct shape
    // for the one promise a newcomer has before it has learned anything else. Verified RED
    // with BOTH removed: `predate.ts`'s `port.tierOf(candidate.stage) === 'COMMONS'` skip
    // and `runtime.ts`'s `safeTier(lot.location) !== 'COMMONS'` lot filter. PRD-1 is a
    // third guard behind both, and `run()` throws on the halt it would raise.
    // ══════════════════════════════════════════════════════════════════════
    const who = agent('sillwright');
    await enrol(h, who);
    tick(h, 1);
    const seat = String(holding(await observe(who))['system']);

    // A second lot, sourced through the ledger so supply stays accounted for, then
    // pledged to a real open encumbrance. This is the goods an agent has committed to an
    // obligation, and it is the goods that will not travel.
    const account = storesAccount(who.principalId as PrincipalId);
    h.runtime.ledger.sourceGoods({
      eventId: 'test.pledged:sillwright' as never,
      tick: h.runtime.engine.tick,
      faucet: GOODS_FAUCET.PRODUCTION,
      to: account,
      good: LEVY_GOOD,
      qty: 1_000 as never,
      location: seat as never,
      origin: who.principalId as PrincipalId,
    });
    const pledgedLot = h.runtime.ledger
      .lotsInAccount(account)
      .find((lot) => lot.qty === 1_000);
    expect(pledgedLot).toBeDefined();
    // The obligation is opened first, and that is not ceremony: INV-4 halts the tick on
    // "an encumbrance locking value for a dead obligation", so a lock without one would
    // make this test green about a paused world instead of about a floor.
    h.runtime.obligations.open('test:sillwright' as never, false);
    const encumbrance = h.runtime.ledger.encumbrances.lock({
      eventId: 'test.lock:sillwright',
      tick: h.runtime.engine.tick,
      principal: who.principalId as PrincipalId,
      account,
      amountMinor: 1 as never,
      obligationRef: 'test:sillwright' as never,
      maxDirectLoss: 1 as never,
    });
    h.runtime.ledger.pledgeLot(pledgedLot?.id as never, encumbrance);
    // A tick, because `observe` is memoised per (principal, tick) — correct by
    // construction, since snapshot T is frozen — so a read in the tick the pledge was
    // written in would serve the cached bytes from before it.
    tick(h, 1);

    const view = await observe(who);
    const quote = holding(view)['graduation'] as Row;
    expect(Number(quote['left_behind_qty'])).toBe(1_000);
    const offer = affordance(view, 'graduate');
    await act(who, 'graduate', offer?.['params']);
    tick(h, 1);
    expectResolved(who, 'the crossing must resolve with a pledged lot on the books');

    const to = String((offer?.['params'] as Row)['to']);
    const crossed = eventsOfKind('holding.graduated')[0]?.payload as Row;
    expect(crossed['from']).toBe(seat);
    expect(Number(crossed['left_behind_qty'])).toBe(1_000);
    expect(tierOf(h.runtime.world.map, seat as SystemId)).toBe('COMMONS');
    // It really did stay, and it really is inside the floor.
    expect(goodsAt(who, seat)).toBe(1_000);

    run((RAID_SPAWN_PHASES[0] ?? 48) + DEMAND_WINDOW_TICKS + 2 - h.runtime.engine.tick);
    const resolved = eventsOfKind('raid.resolved');
    expect(resolved.length, 'the raid must actually happen, or this proves nothing').toBeGreaterThan(0);
    // Every unit taken came from the stage the raid named, which is outside the floor —
    // and the 1,000 units back home are untouched, to the unit.
    expect((resolved[0]?.payload as Row)['stage']).toBe(to);
    expect(Number((resolved[0]?.payload as Row)['lost'])).toBeGreaterThan(0);
    expect(goodsAt(who, seat)).toBe(1_000);
  });

  it('the crossing itself is never hostile, so the floor never refuses it', async () => {
    // `world/commons.ts` classifies every §12.2 verb, and an unclassified verb is treated
    // as HOSTILE. Since every principal starts Commons-seated, a HOSTILE `graduate` would
    // be refused by the floor for every principal in the game — the exit would be in the
    // verb table and unreachable, which is the original defect wearing a different hat.
    //
    // MUTATION: set `graduate: 'HOSTILE'` in `VERB_CLASS`. RED at the door.
    const { who } = await enrolAndCross('kestrelmoor');
    expect(corrections(who)).toEqual([]);
  });
});

// ── 3. the price, and that it is the price the agent was shown ───────────────

describe('the crossing is priced in produced goods and capital, never in identities (A15)', () => {
  it('charges both halves into their named sinks, exactly as the affordance quoted', async () => {
    const who = agent('tallowend');
    await enrol(h, who);
    tick(h, 1);

    const before = await observe(who);
    const quote = holding(before)['graduation'] as Row;
    const offer = affordance(before, 'graduate');
    expect(offer).toBeDefined();
    // The block and the affordance are one arithmetic, or the price shown is not the
    // price taken (scar #1 with money attached).
    expect(offer?.['max_direct_loss']).toBe(quote['upkeep_minor']);
    expect(quote['upkeep_minor']).toBe(GRADUATION_UPKEEP_MINOR);
    expect(quote['upkeep_qty']).toBe(GRADUATION_UPKEEP_QTY);

    const seat = String(holding(before)['system']);
    const account = storesAccount(who.principalId as PrincipalId);
    const cashBefore = h.runtime.ledger.freeBalance(account);
    const goodsBefore = goodsAt(who, seat);

    await act(who, 'graduate', offer?.['params']);
    tick(h, 1);
    expectResolved(who, 'the quoted crossing must be the crossing that happens');

    const to = String((offer?.['params'] as Row)['to']);
    expect(h.runtime.ledger.freeBalance(account)).toBe(cashBefore - Number(GRADUATION_UPKEEP_MINOR));
    // Every unit that was not burned is now standing at the new seat — nothing evaporated
    // and nothing was left in the Commons, which is what makes the crossing consequential.
    expect(goodsAt(who, seat)).toBe(0);
    expect(goodsAt(who, to)).toBe(goodsBefore - Number(GRADUATION_UPKEEP_QTY));
    expect(Number(goodsAt(who, to))).toBe(Number(quote['travelling_qty']));

    // Retired to a sink, never transferred: a price a sock puppet could pay to its
    // operator is not an A15 gate, it is an A15 loophole.
    const supply = h.runtime.ledger.currencySupply();
    expect(Number(supply.retired)).toBeGreaterThanOrEqual(Number(GRADUATION_UPKEEP_MINOR));
  });

  it('charges each crossing under its OWN event id when several land in one tick', async () => {
    // ══════════════════════════════════════════════════════════════════════
    // **THE ACTION BUDGET IS MORE THAN ONE, SO "ONE CROSSING" IS NOT A GIVEN.**
    //
    // `MAX_ACTIONS_PER_BATCH` is 8 and the per-tick budget is 4, so a principal may submit
    // several `graduate`s in one batch and land several crossings in one tick — each a
    // separate, legitimate charge. The first cut keyed the upkeep postings on
    // `(principal, tick)` and the goods burn on `(principal, tick, lot)`, so every crossing
    // after the first wrote a second posting batch under an id the first had already used.
    // Measured on the real HTTP path: two crossings in one tick produced
    // `graduate.upkeep:<p>:<t>` **twice** and, because both burns drew from the surviving
    // remainder of the same starting lot, `graduate.upkeep:<p>:<t>:lot:...` twice as well.
    //
    // Nothing halted, and that is what makes it worth a test rather than a comment:
    // `posting.event_id` is how a charge is traced back to the act that caused it, so
    // `Ledger.postingsFor` returned two unrelated charges as one event, and any store that
    // puts a uniqueness constraint on that column would have had to drop one — silently
    // losing 50,000 of retired currency from the audit trail while the balances stayed
    // right. `to` disambiguates them and cannot collide, because a crossing to where the
    // body already stands is refused.
    //
    // MUTATION: drop `:${to}` from either event id in `vGraduate` / `burnUpkeepGoods`. RED.
    // ══════════════════════════════════════════════════════════════════════
    const who = agent('twicegate');
    await enrol(h, who);
    tick(h, 1);
    const first = await observe(who);
    const seat = String(holding(first)['system']);
    const account = storesAccount(who.principalId as PrincipalId);
    const cashBefore = h.runtime.ledger.freeBalance(account);
    const hop1 = String(((affordance(first, 'graduate') ?? {})['params'] as Row)['to']);
    // The onward gate from `hop1`, read off the map rather than hard-coded.
    const hop2 = [...(h.runtime.world.map.systems.get(hop1 as SystemId)?.lanes ?? [])].find(
      (id) => tierOf(h.runtime.world.map, id) !== 'COMMONS' && id !== hop1,
    );
    expect(hop2, 'the launch map must offer an onward gate, or this proves nothing').toBeDefined();

    // ── THE SECOND RUNG IS PRICED IN ALLOY, AND THIS TEST IS NOT ABOUT THAT ───
    //
    // ⚑ A `giveAlloy` at `hop1` used to stand here, for a manufactured surcharge on the SECOND
    // crossing — §10.1's "convex in footprint". That surcharge is gone: it closed the Frontier for
    // every principal that had not already got alloy, because a seat you cross FROM holds no WORKS
    // and therefore no ore. `works/params.ts` carries the measurement where the constant used to be.
    // Both crossings are priced exactly as they were before the fourth good existed.

    const res = await signed(h, who, 'POST', PATHS.act, {
      actions: [
        { verb: 'graduate', params: { to: hop1 }, clientSequence: 1 },
        { verb: 'graduate', params: { to: hop2 }, clientSequence: 2 },
      ],
    });
    expect(res.status, res.text.slice(0, 400)).toBe(200);
    tick(h, 1);
    expectResolved(who, 'two legal crossings in one batch must both resolve');

    // Both really happened: two receipts, two charges, the body at the far end.
    expect(eventsOfKind('holding.graduated')).toHaveLength(2);
    expect(h.runtime.world.holdings.get(`${who.principalId}:holding` as never)?.system).toBe(hop2);
    expect(h.runtime.ledger.freeBalance(account)).toBe(
      cashBefore - 2 * Number(GRADUATION_UPKEEP_MINOR),
    );
    expect(goodsAt(who, seat)).toBe(0);

    // And every posting the tick wrote carries a DISTINCT event id, so each charge is
    // traceable to the crossing that caused it.
    const ids = h.runtime.ledger
      .allPostings()
      .map((p) => String(p.eventId))
      .filter((id) => id.startsWith('graduate.'));
    expect(ids.length).toBeGreaterThanOrEqual(4);
    expect(new Set(ids).size, `duplicate event ids: ${ids.join(' | ')}`).toBe(ids.length);
  });

  it('refuses when the price is not met, and does not offer what it would refuse', async () => {
    // MUTATION: drop the `crossing.affordable` guard in `affordancesFor`. The affordance
    // is offered, the agent copies it, the engine refuses, and one real action is gone —
    // AGT-S2, the server telling an agent to do something and then declining. RED here.
    const who = agent('sparrowgate');
    await enrol(h, who);
    tick(h, 1);

    // Burn the goods half down below the price — **through the ledger**, so supply stays
    // accounted for. Writing `lot.qty` directly would break INV-2 and halt the world, and
    // then this test would be green about a paused engine rather than about a refusal.
    let burned = 0;
    for (const lot of [
      ...h.runtime.ledger.lotsInAccount(storesAccount(who.principalId as PrincipalId)),
    ]) {
      if (lot.good !== LEVY_GOOD || lot.qty <= 1) continue;
      burned += 1;
      h.runtime.ledger.destroyGoods({
        eventId: `test.burn:${who.handle}:${String(burned)}` as never,
        tick: h.runtime.engine.tick,
        sink: GOODS_SINK.CONSUMPTION,
        lotId: lot.id,
        qty: (lot.qty - 1) as never,
      });
    }
    expect(burned).toBeGreaterThan(0);

    const view = await observe(who);
    const quote = holding(view)['graduation'] as Row;
    expect(quote['affordable']).toBe(false);
    expect(affordance(view, 'graduate')).toBeUndefined();
    // Withheld, never silent: PROP-O1 is about omissions being countable, and this is the
    // one omission that would otherwise read exactly like the defect a playtest found.
    const withheld = (view['header'] as Row)['withheld'] as Row;
    expect(Number(withheld['count'])).toBeGreaterThan(0);
    expect(String(withheld['reason'])).toContain('not affordable yet');

    // And if the agent sends it anyway, the refusal names the exact figures.
    const target = (quote['open'] as string[])[0];
    expect(target).toBeDefined();
    await act(who, 'graduate', { to: target });
    tick(h, 1);
    const refused = corrections(who);
    expect(refused.length).toBe(1);
    expect(refused[0]?.invariant).toBe('A15');
    expect(refused[0]?.hint).toContain('units of');
    expect(refused[0]?.hint).toContain('cannot be paid by enrolling a second identity');
  });
});

// ── 4. one-way, and said so before it is taken ───────────────────────────────

describe('the crossing is one-way, and the agent is told so in the words it reads', () => {
  it('refuses a COMMONS destination and explains that there is no way back', async () => {
    // MUTATION: delete the COMMONS branch of `graduationRejection`. A graduate could hop
    // back inside the floor the moment a raid spawned, and every "one-way" sentence in
    // agent.md and in the affordance would be a lie the engine tells. RED.
    const { who } = await enrolAndCross('windlass');
    const back = eventsOfKind('holding.graduated')[0]?.payload as Row;
    const home = String(back['from']);

    await act(who, 'graduate', { to: home });
    tick(h, 1);
    const refused = corrections(who);
    expect(refused.length).toBe(1);
    expect(refused[0]?.invariant).toBe('A8');
    expect(refused[0]?.hint).toContain('ONE-WAY');
    expect(refused[0]?.hint).toContain('no verb in this build that moves a holding back in');
    // And it really did not move.
    expect(h.runtime.world.holdings.get(`${who.principalId}:holding` as never)?.system).not.toBe(home);
  });

  it('the affordance warns before the fact, not after it', async () => {
    // A13/A2: the single most consequential choice a newcomer makes must be priced and
    // labelled *before* it is taken. Discovering it by being raided afterwards is the
    // failure this whole change exists to prevent.
    const who = agent('lampblack');
    await enrol(h, who);
    tick(h, 1);
    const offer = affordance(await observe(who), 'graduate');
    const warning = String(offer?.['what_it_forecloses']);
    expect(warning).toContain('ONE-WAY');
    expect(warning).toContain('ENDS A8 FOR YOU');
    expect(warning).toContain('can be raided at');
    expect(warning).toContain('never accepts a COMMONS destination');
    // The recurring cost is stated honestly rather than implied by silence.
    //
    // This line read `'Recurring upkeep is not charged yet'` until sovereignty landed, and
    // the pin is why the sentence was updated rather than left to rot: the moment the Charge
    // became real, an affordance still promising a one-off price was a rules-surface lie of
    // exactly scar #1's kind — engine and agent-facing text disagreeing about the rules,
    // with every individual component correct. The assertion's *intent* never moved. What
    // has to be honest is the recurring cost; what it says about it depends on the engine.
    expect(warning).toContain('one-off charge');
    expect(warning).toContain('RECURRING Charge every Reckoning');
    expect(warning, 'and it names where the agent will meet it').toContain('obligations.charge');
  });

  it('refuses a system that is not one lane away, so a body cannot teleport to the Frontier', async () => {
    // MUTATION: delete the `laneBetween` branch. §4.2's topology — "the Frontier is two
    // constellation hops from the Commons and the Marches are unavoidably in between" —
    // is deleted in one action, and so is the reason the Marches exist. RED.
    const who = agent('farholt');
    await enrol(h, who);
    tick(h, 1);
    const frontier = h.runtime.world.map.systemOrder.find(
      (id) => tierOf(h.runtime.world.map, id) === 'FRONTIER',
    );
    expect(frontier).toBeDefined();

    await act(who, 'graduate', { to: frontier });
    tick(h, 1);
    const refused = corrections(who);
    expect(refused.length).toBe(1);
    expect(refused[0]?.invariant).toBe('A2');
    expect(refused[0]?.hint).toContain('one lane at a time');
    expect(holding(await observe(who))['tier']).toBe('COMMONS');
  });
});

// ── 5. the exit is legible even when it is not offered ───────────────────────

describe('a graduation nobody can find is not a graduation (A2, A13)', () => {
  it('publishes the choice as state, with its price and its destinations, on the first wake', async () => {
    // MUTATION: return `{}` from `graduationBlock`. The verb still works and the
    // affordance is still offered — and an agent reading `holding` learns nothing about
    // the most consequential decision in the game. RED.
    const who = agent('candlewick');
    await enrol(h, who);
    tick(h, 1);
    const block = holding(await observe(who))['graduation'] as Row;

    expect((block['open'] as string[]).length).toBeGreaterThan(0);
    for (const id of block['open'] as string[]) {
      expect(tierOf(h.runtime.world.map, id as SystemId)).not.toBe('COMMONS');
    }
    expect(block['one_way']).toBe(true);
    expect(String(block['statement'])).toContain('IT IS ONE-WAY');
    expect(Number(block['available_qty'])).toBeGreaterThan(0);
  });

  it('never offers a move the Commons bind would refuse, and says why it did not', async () => {
    // The other half of what the probe hit: `move` was offered onto every lane, including
    // the ones leaving the Commons, and then refused. The offers were there; the door was
    // not. MUTATION: drop the `commonsBoundRejection` guard in the move loop. RED.
    const who = agent('threadneedle');
    await enrol(h, who);
    tick(h, 1);
    const view = await observe(who);
    const moves = (view['affordances'] as Row[]).filter((a) => a['verb'] === 'move');
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) {
      const to = String((m['params'] as Row)['to']);
      expect(tierOf(h.runtime.world.map, to as SystemId)).toBe('COMMONS');
    }
    const withheld = (view['header'] as Row)['withheld'] as Row;
    expect(String(withheld['reason'])).toContain('lanes leaving the Commons');
    expect(String(withheld['reason'])).toContain('`graduate` moves your HOLDING');
  });
});
