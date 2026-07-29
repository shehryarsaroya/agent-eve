/**
 * ALLOY — the fourth good, and the first two-way dependency this world has ever had.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHAT THIS FILE HAS TO EARN.** `COMPLETION.md` names the bottleneck exactly: *"every obligation is
 * priced in ONE GOOD, so there is nothing to trade"*, and *"`market` is 3,065 lines pricing a single
 * fungible commodity"*. That understated it. Measured before this change, four seeds x six Reckonings:
 *
 * ```
 *   market orders ever placed .... 0      market fills ever printed .... 0
 *   WORKS on FRONTIER ground ..... 0, 0, 0, 1        (so `fuel` exists in one world of four)
 *   `ration` in stores ........... 529,889 – 589,000
 * ```
 *
 * So the third good was nearly inert too, and the market had never held an order in the project's
 * life. A fourth good that only added a fourth pile would be the twelfth instance of this repo's
 * defining defect. The claim this file has to support is therefore narrower and harder than "a fourth
 * good exists":
 *
 *   1. **It is produced at a price that depends on WHERE** — `ALLOY_IN_BY_TIER`, and the gradient runs
 *      OPPOSITE to the ore yield, so the tier with the least ore converts it best.
 *   2. **It is consumed by gates that are somewhere else**, and those gates are one-time so no agent
 *      can ever be recorded short of it (A5′).
 *   3. **The two recipes compete for one lot**, so an agent faces a decision it can get wrong.
 *   4. **Nothing deadlocks**: every tier can make its own, so no gate is unreachable at any price.
 *   5. **It can physically move** — `haul`, the canon verb whose step this is — and a fill lands the
 *      cargo where it traded, so buying and using are different places.
 *   6. **A15 holds**: world alloy output is bounded by the MAP, not by the population.
 *
 * ── AND THE ONE THING THIS FILE CANNOT SHOW, STATED UP FRONT ─────────────────
 *
 * The cast does not complete a purchase, and the reason is **not** in this change. `market/escrow.ts`
 * funds a BID from `freeCash` = `freeBalance − ENDOWMENT_FLOOR_MINOR`, D7 puts that floor at the whole
 * `STARTER_STAKE` (250,000), and every cast member in every world sits between 62,000 and 203,000 — so
 * `freeCash` is **identically zero for every principal that has ever played this game.** That is the
 * real reason the market has never printed a fill, it predates the fourth good, and fixing it is an
 * A15 decision about what D7's floor should measure rather than a patch. `a buyer with earned cash
 * completes the whole chain` below drives the path with a funded buyer and proves the machinery is
 * complete; `the cast produces, prices and publishes` proves the supply side runs unaided.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import { setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { PrincipalId, SystemId, ZoneTier } from '../../src/core/types.js';
import { qty } from '../../src/core/units.js';
import { ENDOWMENT_GOOD } from '../../src/ledger/endowment.js';
import { storesAccount } from '../../src/ledger/index.js';
import { LEVY_GOOD, LEVY_UNIT_MINOR } from '../../src/levy/params.js';
import { freeCash } from '../../src/market/escrow.js';
import { Runtime } from '../../src/sim/runtime.js';
import { CHARGE_GOOD } from '../../src/sovereignty/index.js';
import { checkFuelIsFrontierOnly } from '../../src/works/invariants.js';
import {
  ALLOY_ANCHOR_QTY,
  ALLOY_GOOD,
  ALLOY_IN_BY_TIER,
  ALLOY_OUT_QTY,
  ALLOY_STATEMENT,
  ALLOY_TIER,
  FUEL_GOOD,
  WORKS_BUILD_QTY,
  WORKS_COST_MINOR,
  WORKS_GOOD,
  WORKS_YIELD_GOOD,
  YIELD_PER_TICK,
} from '../../src/works/params.js';
import { checkCargoMirror, MAX_HAUL_QTY, route } from '../../src/world/index.js';
import { PATHS, agent, enrol, harness, signed, tick, type Agent, type Harness } from '../api/harness.js';

const TIERS: readonly ZoneTier[] = ['COMMONS', 'MARCHES', 'FRONTIER'];

describe('the fourth good is a PRICE that depends on place, not a wall', () => {
  it('is a SIXTH goods constant and an alias of none of the five', () => {
    // The same discipline `test/core/goods-are-independent.test.ts` pins for the four obligation
    // goods. If alloy collapsed into `ration` it would be payable against every obligation, and the
    // whole design would be the three-good world with a fourth label on it.
    for (const other of [LEVY_GOOD, WORKS_GOOD, CHARGE_GOOD, ENDOWMENT_GOOD, WORKS_YIELD_GOOD, FUEL_GOOD]) {
      expect(ALLOY_GOOD, `alloy must differ from ${other}`).not.toBe(other);
    }
  });

  it('★ NO OBLIGATION IS PRICED IN IT, so nobody can ever be recorded short of it (A5′)', () => {
    // ══════════════════════════════════════════════════════════════════════
    // The load-bearing safety property of the whole change, and the reason the Levy is untouched.
    // A recurring obligation payable in alloy would bill every principal in a good whose price
    // depends on where it happens to be standing — and a claimant that could not meet it would be
    // recorded in default by our own geography, which is A5′ with the map as the cause. `fuel` set
    // the precedent (a cold anchor loses income and nothing else); alloy goes further, because both
    // of its sinks are gates an agent CHOOSES to walk through rather than bills it receives.
    //
    // MUTATION: set `LEVY_GOOD = ALLOY_GOOD`. RED here, and in the live world every principal
    // outside the Commons would default on a tribute it was structurally unable to pay.
    // ══════════════════════════════════════════════════════════════════════
    for (const obligation of [LEVY_GOOD, CHARGE_GOOD, WORKS_GOOD, ENDOWMENT_GOOD]) {
      expect(obligation, 'no obligation may be priced in the manufactured good').not.toBe(ALLOY_GOOD);
    }
    // And the four still agree with each other, which is what keeps the Levy payable from domestic
    // production. `goods-are-independent.test.ts` owns that claim; this restates the half that this
    // change could have broken.
    expect(new Set([LEVY_GOOD, CHARGE_GOOD, WORKS_GOOD, ENDOWMENT_GOOD]).size).toBe(1);
  });

  it('★ THE GRADIENT RUNS OPPOSITE TO THE ORE YIELD — that inversion IS the trade', () => {
    // ══════════════════════════════════════════════════════════════════════
    // The single most important assertion in this file. `fuel` created an asymmetry and no trade,
    // because the Frontier is richer at *everything* — 150 ore a tick against the Commons' 80 — so
    // nothing the interior made was worth carrying outward. Alloy inverts it: the poorest ore ground
    // refines best.
    //
    // MUTATION: make `ALLOY_IN_BY_TIER` flat, or order it the same way as `YIELD_PER_TICK`. RED here,
    // and in the live world a frontier producer would have no reason to buy anything from anybody —
    // which is a second `fuel` and leaves the bottleneck exactly where it was.
    // ══════════════════════════════════════════════════════════════════════
    expect(ALLOY_IN_BY_TIER.COMMONS).toBeLessThan(ALLOY_IN_BY_TIER.MARCHES);
    expect(ALLOY_IN_BY_TIER.MARCHES).toBeLessThan(ALLOY_IN_BY_TIER.FRONTIER);
    expect(YIELD_PER_TICK.COMMONS).toBeLessThan(YIELD_PER_TICK.MARCHES);
    expect(YIELD_PER_TICK.MARCHES).toBeLessThan(YIELD_PER_TICK.FRONTIER);
    // Stated as the property rather than as two orderings that happen to disagree: the cheapest
    // refiner is the poorest miner, at both ends.
    const cheapest = [...TIERS].sort((a, b) => ALLOY_IN_BY_TIER[a] - ALLOY_IN_BY_TIER[b])[0];
    const richest = [...TIERS].sort((a, b) => YIELD_PER_TICK[b] - YIELD_PER_TICK[a])[0];
    expect(cheapest, 'the best refiner must not also be the best miner').not.toBe(richest);
    expect(cheapest).toBe(ALLOY_TIER);
  });

  it('★ NOTHING DEADLOCKS: every tier can make its own at some price', () => {
    // ══════════════════════════════════════════════════════════════════════
    // **THE FIRST DESIGN WAS A WALL AND THIS TEST IS WHY IT IS NOT ONE NOW.** Alloy was COMMONS-only.
    // Measured over four seeds at six Reckonings, `claims` went from 4 a seed to **0** and stayed
    // there: a Marches claimant could not refine alloy and could not fund a market BID either, so the
    // anchor gate was unpassable and the sovereignty layer went with it.
    //
    // A gate the rules make impossible to pass is A15's and A5′'s shared failure, and it does not
    // announce itself — it reads as a balance problem. So the property is asserted rather than
    // remembered.
    //
    // MUTATION: set any tier's rate to 0 (or delete it). RED here, and the live world loses either
    // the claim ladder or, at FRONTIER, the whole combat layer — `HULL_COST_GOODS` needs `fuel`, and
    // fuel is only at the Frontier, so a frontier claim that could not be anchored would make a fleet
    // unreachable through the front door.
    // ══════════════════════════════════════════════════════════════════════
    for (const tier of TIERS) {
      expect(ALLOY_IN_BY_TIER[tier], `${tier} must be able to make its own alloy`).toBeGreaterThan(0);
      expect(Number.isInteger(ALLOY_IN_BY_TIER[tier]), 'no float in a value path').toBe(true);
    }
  });

  it('the gates are reachable from one Reckoning of a tier own ground', () => {
    // A15 arithmetic, not a mechanism test: a gate priced above what the place can produce in a cycle
    // is a wall with a number on it. Both sinks are checked at the tier that pays the most for them.
    for (const tier of TIERS) {
      const orePerReckoning = YIELD_PER_TICK[tier] * TICKS_PER_RECKONING;
      const anchorOre = Number(ALLOY_ANCHOR_QTY) * ALLOY_IN_BY_TIER[tier];
      // Strictly less, and by a real margin: the ore also has to cover the Levy, so a gate that
      // consumed a whole Reckoning's output would be payable only by a principal in default.
      expect(anchorOre, `${tier}: an anchor's alloy must cost under a Reckoning of ore`).toBeLessThan(
        orePerReckoning,
      );
    }
    // ⚑ A second clause stood here for a crossing surcharge — §10.1's "convex in footprint" — and it
    // is gone with the constant. The reason is a measurement rather than a simplification: the seat a
    // crossing departs FROM holds no WORKS and therefore no ore, so the fare closed the Frontier and
    // with it the combat layer. `works/params.ts` carries the diagnosis where the constant used to be.
    // **The anchor is now the only sink, and it is the one that measured healthy** — 3–4 claims a
    // seed, matching master.
  });

  it('★ there IS a price, and both ends of it are computable from published constants (A2)', () => {
    // A wall has an availability; a gradient has a price. A Marches buyer's own cost per unit is its
    // tier rate; a Commons seller's floor is its own. Everything between is a trade both sides prefer
    // to autarky — and every number in that sentence is public, so no agent needs a wiki.
    const sellerFloor = ALLOY_IN_BY_TIER.COMMONS * Number(LEVY_UNIT_MINOR);
    const marchesCeiling = ALLOY_IN_BY_TIER.MARCHES * Number(LEVY_UNIT_MINOR);
    expect(marchesCeiling - sellerFloor, 'the gain from trade, per unit, in minor').toBeGreaterThan(0);
    // Big enough to be worth an action and a hand for several ticks. Below a few units of margin a
    // haul is a rounding error and the book would be decoration.
    expect(marchesCeiling - sellerFloor).toBeGreaterThanOrEqual(16);
  });

  it('ALLOY_STATEMENT tells an agent the four things it cannot infer', () => {
    // A rules surface (hard rule 4). An agent that guessed the rate would guess ONE rate — the idea
    // that a recipe's cost depends on the tier is unlike anything else in the game, and a claimant
    // refused for a shortfall it thought it had covered has been billed by a rule nobody showed it.
    for (const tier of TIERS) expect(ALLOY_STATEMENT).toContain(String(ALLOY_IN_BY_TIER[tier]));
    expect(ALLOY_STATEMENT).toContain(String(ALLOY_ANCHOR_QTY));
    // ★ That the anchor is the ONLY thing that takes it. An agent told "a manufactured good" and left
    // to guess would hoard it against a crossing or a hull that never charges any — which is a
    // Reckoning of ore spent on nothing, and the kind of loss A2 exists to make impossible.
    expect(ALLOY_STATEMENT, 'that nothing else consumes it').toContain('Nothing ELSE consumes it');
    expect(ALLOY_STATEMENT, 'that it settles nothing').toContain('pays no obligation');
    expect(ALLOY_STATEMENT, 'and that goods do not teleport').toContain('haul');
  });

  it('agent.md carries the rates and the one gate, in the engine own numbers', () => {
    // Scar #1: the engine and the agent-facing text disagreeing about one number while each reads
    // correctly alone. Pinned against the constants rather than typed again.
    //
    // MUTATION: change any entry in `ALLOY_IN_BY_TIER` or either gate quantity. RED here.
    // ── ★ THIS TEST PINNED agent.md TO A RULE THE ENGINE DOES NOT ENFORCE ────
    //
    // It required the literal string *"**8 ore for 1 alloy, and it runs only at a COMMONS system**"* —
    // inside a `describe` block whose own title is **"the fourth good is a PRICE that depends on
    // place, not a wall"**, three assertions below one that loops over every entry of
    // `ALLOY_IN_BY_TIER`. So the file simultaneously knew alloy was a gradient and *guaranteed that
    // `agent.md` kept calling it a prohibition*, for fifteen rules releases. That is scar #1 — the
    // engine and the agent-facing text disagreeing about one rule while each reads correctly alone —
    // occurring inside the golden-file guard built to prevent scar #1, which is why it survived.
    //
    // A probe found it by playing: 288 ore hauled to a Marches system, `refine {kind:"ALLOY", qty:9}`,
    // nine alloy standing there, no correction. It cost nothing to fix and would have cost an agent
    // every haul it made to avoid a wall that was not there.
    //
    // Pinned against the CONSTANTS now, in both directions, so neither surface can drift again.
    const md = readAgentMd();
    for (const tier of TIERS) {
      expect(
        md,
        `agent.md must publish the ${tier} rate (${String(ALLOY_IN_BY_TIER[tier])}:1) — the whole point is ` +
          'that the cost depends on where the ore stands, and a claimant that reads only the Commons ' +
          'figure will price an anchor at a quarter of what it actually pays',
      ).toContain(`${tier} ${String(ALLOY_IN_BY_TIER[tier])}:1`);
    }
    expect(
      md,
      'and it must NOT re-assert the prohibition: alloy runs at every tier, and `works/refine.ts` says ' +
        'why in as many words — "a price gradient rather than a wall, because the wall version was ' +
        'measured and deadlocked"',
    ).not.toContain('runs only at a COMMONS system');
    expect(md, 'nor anywhere else').not.toContain('refined only at a');
    for (const wanted of [
      `${String(ALLOY_ANCHOR_QTY)} of it`,
      'Goods are LOCATED, and `haul` is the only verb that moves them',
      'A market fill settles the cargo at the venue it traded at',
    ]) {
      expect(md, `agent.md must say: ${wanted}`).toContain(wanted);
    }
  });
});

function readAgentMd(): string {
  return readFileSync(fileURLToPath(new URL('../../agent.md', import.meta.url)), 'utf8').replace(
    /\s+/g,
    ' ',
  );
}

describe('A15: world alloy output is bounded by the MAP, never by the population', () => {
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * **THE BOOTSTRAP-DOOR MEASUREMENT, REPEATED FOR THE FOURTH GOOD.** `works/params.ts` proves the ore
   * faucet is map-bounded by measuring it: *"1 puppet extracting 14,080 ore and 16 puppets at the same
   * system extracting 14,080, identical to the unit."* Alloy is downstream of ore, so the bound is
   * inherited — but "inherited" is an argument, and A15 asks for a measurement.
   *
   * This is the measurement. N principals, one system, the same window: the total ore the place hands
   * over is identical, so the total alloy the world can possibly refine from that place is identical.
   * Ten identities gain exactly nothing.
   * ══════════════════════════════════════════════════════════════════════════
   */
  function extractedAt(puppets: number, ticks: number): number {
    setSpeed('instant');
    const rt = new Runtime({ seed: 'alloy-a15' });
    const system = rt.world.map.systemOrder.find(
      (id) => rt.world.map.systems.get(id)?.tier === ALLOY_TIER,
    );
    if (system === undefined) throw new Error('the seeded map has no COMMONS system');
    for (let i = 0; i < puppets; i += 1) {
      rt.works.raise({ system, holder: `p:puppet-${String(i)}` as PrincipalId, tick: 0 });
    }
    let total = 0;
    for (let t = 0; t < ticks; t += 1) {
      for (const share of rt.works.sharesAt(system, ALLOY_TIER, t).values()) total += share;
    }
    return total;
  }

  it('1 puppet and 16 puppets at one system extract the SAME total, to the unit', () => {
    // MUTATION: make `sharesOf` divide by anything a principal controls, or give each WORKS the full
    // tier yield. RED here, and in the live world alloy supply would scale with identity count —
    // which is free, and which is the one thing A15 forbids outright.
    const one = extractedAt(1, 400);
    const many = extractedAt(16, 400);
    expect(one, 'a place must hand over something, or this proves nothing').toBeGreaterThan(0);
    expect(many, 'sixteen identities extract exactly what one extracts').toBe(one);
    // And therefore the alloy ceiling is the same for both, which is the claim A15 actually wants.
    expect(Math.trunc(many / ALLOY_IN_BY_TIER[ALLOY_TIER])).toBe(
      Math.trunc(one / ALLOY_IN_BY_TIER[ALLOY_TIER]),
    );
  });

  it('a second good at one place does not widen INV-W6, which is stated against fuel', () => {
    // Alloy is REFINED, never extracted, so no WORKS is ever credited any and the Frontier-only
    // invariant is untouched by its existence. Asserted because a fourth good arriving through the
    // same book is exactly how a bound quietly widens.
    const rt = new Runtime({ seed: 'alloy-invw6' });
    expect(checkFuelIsFrontierOnly({ book: rt.works, map: rt.world.map, tick: 10 })).toEqual([]);
  });
});

describe('★ the whole chain, through the front door', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness({ seed: 'alloy-front-door' });
  });
  afterEach(async () => {
    await h.close();
  });

  function run(n: number): void {
    for (let i = 0; i < n; i += 1) {
      const r = h.runtime.runTick();
      expect(
        r.halted,
        `halted at ${String(r.tick)}: ${r.violations.map((v) => `${v.id} ${v.message}`).join(' | ')}`,
      ).toBe(false);
    }
  }

  /**
   * Submit one act over real signed HTTP, advance a tick, and return **what the engine recorded**.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **THE FIRST VERSION OF THIS HELPER RETURNED THE POST RESPONSE, AND THREE OF ITS ASSERTIONS WERE
   * VACUOUS.** A verb-handler `reject` does not come back on the `act` call: the action is queued and
   * resolved in the next tick's VALIDATE+LOCK, so the response's `corrections` is `[]` for a refusal
   * and `[]` for a success — identical. `expect(corrections).toEqual([])` therefore asserted nothing at
   * all, and the typo test asserting a refusal failed for the same reason in the opposite direction,
   * which is the only way it got noticed.
   *
   * `Runtime.takeCorrections` is the engine's own record of what it decided. Reading that instead of a
   * structure the fixture built is the difference between testing the caller and testing the helper —
   * the exact mutation-survival this project has just paid for once.
   * ══════════════════════════════════════════════════════════════════════════
   */
  async function act(who: Agent, verb: string, params: unknown): Promise<readonly string[]> {
    const res = await signed(h, who, 'POST', PATHS.act, {
      actions: [{ verb, params, clientSequence: 1 }],
    });
    expect(res.status, `${verb} -> ${res.status}: ${res.text.slice(0, 400)}`).toBe(200);
    // Refused at the DOOR (an unknown or not-live verb) — a different failure with a different fix,
    // so it is surfaced separately rather than folded into the tick's answer.
    const atDoor = (res.json['outcome'] as Record<string, unknown>)['corrections'] as Record<
      string,
      unknown
    >[];
    if (atDoor.length > 0) return atDoor.map((c) => String(c['hint']));
    run(1);
    return h.runtime
      .takeCorrections(who.principalId as PrincipalId)
      .map((c) => `${c.verb}/${c.invariant}: ${c.hint}`);
  }

  let banks = 0;
  /** Top up from freshly enrolled principals until FREE CASH covers `want`. */
  async function fund(who: Agent, want: number): Promise<void> {
    const me = storesAccount(who.principalId as PrincipalId);
    for (let i = 0; i < 12; i += 1) {
      if (Number(freeCash(h.runtime.ledger, who.principalId as PrincipalId)) >= want) return;
      banks += 1;
      const bank = agent(`bank-${String(banks)}`);
      expect((await enrol(h, bank)).status).toBe(201);
      tick(h, 1);
      const from = storesAccount(bank.principalId as PrincipalId);
      const spare = h.runtime.ledger.freeBalance(from);
      if (spare <= 0) continue;
      h.runtime.ledger.transferCurrency({
        eventId: `test.income:${String(banks)}` as never,
        tick: h.runtime.engine.tick,
        from,
        to: me,
        amount: spare,
      });
    }
  }

  /** Walk one idle hand to `system`, one published lane at a time, and wait for it to arrive. */
  async function walkTo(who: Agent, system: SystemId): Promise<void> {
    const p = who.principalId as PrincipalId;
    for (let hop = 0; hop < 12; hop += 1) {
      const standing = [...h.runtime.world.hands.values()].filter((x) => x.principal === p);
      if (standing.some((x) => x.state === 'IDLE' && x.location === system)) return;
      const moving = standing.find((x) => x.state === 'IN_TRANSIT');
      if (moving !== undefined) {
        run(1);
        continue;
      }
      const idle = standing.find((x) => x.state === 'IDLE');
      if (idle === undefined) throw new Error('no idle hand to walk');
      const next = route(h.runtime.world.map, idle.location, system)?.path[1];
      if (next === undefined) throw new Error(`no route from ${idle.location} to ${system}`);
      expect(await act(who, 'move', { hand: idle.id, to: next }), `move to ${next} refused`).toEqual([]);
    }
    throw new Error(`could not walk to ${system}`);
  }

  function commonsSeatOf(who: Agent): SystemId {
    const quote = h.runtime.graduationQuote(who.principalId as PrincipalId);
    if (quote === null) throw new Error('no holding');
    expect(quote.fromTier, 'enrolment seats in the Commons').toBe(ALLOY_TIER);
    return quote.from;
  }

  /** Raise a WORKS and run it until `want` ore is standing. The real faucet, the real wait. */
  async function mine(who: Agent, want: number): Promise<SystemId> {
    const p = who.principalId as PrincipalId;
    const system = commonsSeatOf(who);
    await fund(who, Number(WORKS_COST_MINOR) + 30_000);
    expect(await act(who, 'build', { kind: 'WORKS', system }), 'build WORKS refused').toEqual([]);
    for (let i = 0; i < 2_000 && h.runtime.refinableAt(p, system) < want; i += 1) run(1);
    expect(h.runtime.refinableAt(p, system), 'the place must actually pay').toBeGreaterThanOrEqual(want);
    return system;
  }

  it('★ a buyer with earned cash completes the whole chain: refine → ask → bid → fill → haul', async () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THE CLAIM: TWO PRINCIPALS, TWO GOODS, MONEY AND CARGO MOVING IN OPPOSITE DIRECTIONS.** Every
    // step is a real signed HTTP action against the real verb table. Nothing here is a fixture except
    // the buyer's cash, and that is `fund` — which enrols banks and transfers their spare balance, the
    // same pattern `a-good-only-the-frontier-makes.spec.ts` uses, and the ONLY way to get a principal
    // past `ENDOWMENT_FLOOR_MINOR` in this build.
    //
    // MUTATION: delete the `haul` handler registration. The fill still happens and this goes RED at
    // the last assertion — which is the whole point of ending on the cargo's LOCATION rather than on
    // the buyer's total. A trade whose goods cannot reach the buyer is not a trade.
    // ══════════════════════════════════════════════════════════════════════════
    const seller = agent('smelter');
    const buyer = agent('prospector');
    expect((await enrol(h, seller)).status).toBe(201);
    expect((await enrol(h, buyer)).status).toBe(201);
    tick(h, 1);

    const sellerP = seller.principalId as PrincipalId;
    const buyerP = buyer.principalId as PrincipalId;

    // ── 1. THE SELLER MINES AND REFINES, AT THE COMMONS RATE ──────────────────
    const wanted = 200;
    const venue = await mine(seller, wanted * ALLOY_IN_BY_TIER[ALLOY_TIER]);
    const oreBefore = h.runtime.refinableAt(sellerP, venue);
    expect(await act(seller, 'refine', { kind: 'ALLOY', system: venue, qty: wanted }), 'refine ALLOY refused').toEqual([]);
    expect(h.runtime.alloyAt(sellerP, venue), 'the fourth good exists in the world').toBe(
      wanted * ALLOY_OUT_QTY,
    );
    // ── AND THE FORK IS REAL: THE SAME ORE IS GONE ────────────────────────────
    //
    // The decision §10.1 asked for, checked as arithmetic. A recipe that left the ore behind would be
    // a second faucet rather than a choice.
    //
    // The tick's own extraction is added back before the comparison, because `run(1)` advanced the
    // world and the WORKS kept paying. Reading a raw before/after difference here would have been off
    // by exactly one tick's share — the same off-by-one-tick error `works/produce.ts` warns about, and
    // it would have silently understated the fork by 5%.
    const perTick = h.runtime.worksQuote(sellerP, venue).sharePerTick;
    expect(oreBefore + perTick - h.runtime.refinableAt(sellerP, venue)).toBe(
      wanted * ALLOY_IN_BY_TIER[ALLOY_TIER],
    );

    // ── 2. IT GOES ON THE BOOK ────────────────────────────────────────────────
    const price = ALLOY_IN_BY_TIER.MARCHES; // inside the published 8–32 band
    expect(
      await act(seller, 'trade', {
        operation: 'place',
        venue,
        good: ALLOY_GOOD,
        side: 'ASK',
        quantity: wanted,
        limit_price: price,
        duration_ticks: 200,
      }),
      'ASK refused',
    ).toEqual([]);
    expect(
      h.runtime.market.openIn(venue as never, ALLOY_GOOD).length,
      'an ASK must be resting, or there is nothing to buy',
    ).toBe(1);

    // ── 3a. THE BUYER WALKS TO THE BOOK. A BOOK IS LOCAL, AND THAT IS THE POINT ──
    //
    // `market/place.ts` refuses an agent with no hand at the venue: *"§12.1 gives you the local book
    // only, so trading one you are not present at would be acting on a sensed fact from orbit."* So
    // buying is a journey before it is a price, which is half of why the good has to be hauled home
    // afterwards — the hand and the cargo make the same trip twice.
    //
    // This step was MISSING from the first draft of this test and the old helper hid it: a
    // verb-handler refusal does not come back on the `act` call, so the assertion read `[]` and the
    // test carried on to fail three steps later. Reading `takeCorrections` named it immediately.
    await walkTo(buyer, venue);

    // ── 3b. THE BUYER BIDS. IT NEEDS *EARNED* CASH, WHICH IS THE FINDING ──────
    expect(
      Number(freeCash(h.runtime.ledger, buyerP)),
      'a fresh principal has ZERO free cash — D7 floors it at the whole starter stake',
    ).toBe(0);
    await fund(buyer, price * wanted * 2);
    expect(Number(freeCash(h.runtime.ledger, buyerP))).toBeGreaterThanOrEqual(price * wanted);

    expect(
      await act(buyer, 'trade', {
        operation: 'place',
        venue,
        good: ALLOY_GOOD,
        side: 'BID',
        quantity: wanted,
        limit_price: price,
        duration_ticks: 200,
      }),
      'BID refused',
    ).toEqual([]);
    run(1);

    // ── 4. IT CLEARS, AND THE CARGO LANDS AT THE VENUE ────────────────────────
    const fills = h.runtime.market.fills().filter((f) => f.good === ALLOY_GOOD);
    expect(fills.length, 'the book must actually clear — this is the first fill this repo has printed').toBe(1);
    expect(fills[0]?.buyer).toBe(buyerP);
    expect(fills[0]?.seller).toBe(sellerP);
    expect(h.runtime.alloyAt(buyerP, venue), 'exact-venue settlement: the cargo is HERE').toBe(wanted);
    expect(h.runtime.alloyAt(sellerP, venue), 'and the seller no longer holds it').toBe(0);

    // ── 5. AND IT HAS TO BE CARRIED, WHICH IS WHY `haul` EXISTS ───────────────
    const lanes = [...h.runtime.world.map.lanes.values()].filter(
      (l) => l.a === venue || l.b === venue,
    );
    const to = ((lanes[0]?.a === venue ? lanes[0]?.b : lanes[0]?.a) ?? '') as SystemId;
    expect(to, 'the seeded map must give the venue a lane').not.toBe('');
    const hand = h.runtime.world.hands.values().next().value;
    const mine2 = [...h.runtime.world.hands.values()].find(
      (x) => x.principal === buyerP && x.state === 'IDLE' && x.location === venue,
    );
    expect(mine2, `the buyer needs a hand standing at ${venue} (saw ${String(hand?.location)})`).toBeDefined();

    expect(
      await act(buyer, 'haul', { hand: mine2?.id, to, good: ALLOY_GOOD, qty: wanted }),
      'haul refused',
    ).toEqual([]);

    // ── IN TRANSIT: SPENDABLE NOWHERE, AND COUNTED EXACTLY ONCE ───────────────
    //
    // The property INV-W7 exists for. While the convoy is on the lane the goods are in neither place's
    // AVAILABLE set — and they are still in the world, because INV-2's third bucket counts them.
    expect(h.runtime.alloyAt(buyerP, venue), 'gone from the origin the moment it departs').toBe(0);
    expect(h.runtime.alloyAt(buyerP, to), 'and not yet spendable at the destination').toBe(0);

    // Arrive.
    for (let i = 0; i < 60 && h.runtime.alloyAt(buyerP, to) < wanted; i += 1) run(1);
    expect(h.runtime.alloyAt(buyerP, to), 'the cargo lands where the hand landed').toBe(wanted);
  }, 300_000);

  it('a MARCHES seat cannot make what a COMMONS seat makes, at the same ore', async () => {
    // ══════════════════════════════════════════════════════════════════════════
    // The gradient, measured through the verb rather than read off the constant. Same principal, same
    // quantity of ore, two tiers, two answers — and the refusal names the place rather than only the
    // number, which is what an agent needs in order to know that the fix is "buy it somewhere else"
    // rather than "wait".
    // ══════════════════════════════════════════════════════════════════════════
    const who = agent('assayer');
    expect((await enrol(h, who)).status).toBe(201);
    tick(h, 1);
    const p = who.principalId as PrincipalId;
    const commons = await mine(who, ALLOY_IN_BY_TIER.MARCHES);

    // Enough for one unit at the MARCHES rate is enough for four at the COMMONS rate.
    const here = h.runtime.refinableAt(p, commons);
    expect(here).toBeGreaterThanOrEqual(ALLOY_IN_BY_TIER.MARCHES);
    expect(await act(who, 'refine', { kind: 'ALLOY', system: commons, qty: 1 })).toEqual([]);
    expect(h.runtime.alloyAt(p, commons)).toBe(1);
    // The Commons charged its own rate and nothing else — the tick's own extraction added back, as
    // above, so the comparison is the recipe rather than the recipe minus a tick of income.
    const tickShare = h.runtime.worksQuote(p, commons).sharePerTick;
    expect(here + tickShare - h.runtime.refinableAt(p, commons)).toBe(ALLOY_IN_BY_TIER.COMMONS);

    // And a short refusal names the tier and publishes every rate, so the buy-elsewhere move is
    // discoverable without a wiki (A2). MUTATION: drop `tier` from the message. RED here.
    const short = await act(who, 'refine', { kind: 'ALLOY', system: commons, qty: 1_000_000 });
    expect(short.length, 'asking for more than the ground can pay must be REFUSED').toBeGreaterThan(0);
    const hint = short.join(' ');
    expect(hint).toContain('COMMONS');
    expect(hint, 'and every tier rate, so both moves are computable').toContain(
      String(ALLOY_IN_BY_TIER.MARCHES),
    );
  }, 300_000);

  it('an unknown recipe is refused BY NAME, never defaulted into the wrong good', async () => {
    // D22 found `graduate` irreversibly graduating the wrong principal from a dropped param. A
    // mistyped `kind` silently consuming ore into rations would be the same defect: an irreversible
    // act reported as a success. MUTATION: make `refineKindOf` fall back to RATION. RED here.
    const who = agent('typo');
    expect((await enrol(h, who)).status).toBe(201);
    tick(h, 1);
    const out = await act(who, 'refine', { kind: 'ALOY' });
    expect(out.length, 'a typo must be refused, not guessed').toBeGreaterThan(0);
    expect(out.join(' '), 'and the refusal must list the recipes that DO exist').toContain('ALLOY');
    expect(out.join(' ')).toContain('RATION');
  }, 120_000);
});

describe('the cast produces, prices and publishes — unaided', () => {
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * **THE TWELFTH-INSTANCE GUARD.** Eleven times in this project a capability has existed, been
   * tested, been reported as built, and been used by nothing — most recently `lockFillStake`, which
   * implemented §7.3's escrow, quoted the section above itself, had its own unit test, and had no
   * caller. A fourth good with no cast branch would be the twelfth.
   *
   * This asserts on a world nobody steers: the good gets MADE and it gets OFFERED. It deliberately
   * does **not** assert a fill — see the file header — because `freeCash` is zero for every principal
   * that has played and the buy side is unreachable for reasons that predate this change. Asserting a
   * fill here would either fail forever or tempt somebody to weaken D7 to make a test go green.
   * ══════════════════════════════════════════════════════════════════════════
   */
  it('★ refines the fourth good and puts it on the book, with no human in the loop', () => {
    setSpeed('instant');
    const seed = 'alloy-cast';
    const rt = new Runtime({ seed });
    const cast = new HeuristicCast(rt, { size: 8 });
    cast.seat(seed);
    let refines = 0;
    let asks = 0;
    for (let i = 0; i < 6 * TICKS_PER_RECKONING; i += 1) {
      const next = rt.engine.tick + 1;
      for (const action of cast.decide(next, seed)) {
        const params = action.params as Record<string, unknown>;
        if (action.verb === 'refine' && params['kind'] === 'ALLOY') refines += 1;
        if (action.verb === 'trade' && params['side'] === 'ASK' && params['good'] === ALLOY_GOOD) asks += 1;
        rt.engine.submit(action);
      }
      const report = rt.runTick();
      expect(report.halted, `halted at ${String(report.tick)}`).toBe(false);
    }

    // MUTATION: delete the `alloyPlanFor` hold-back in `refineFor`. This goes to **0** — measured,
    // twice, on two different builds of this change: placing a branch above another does not reserve
    // its input, and the ration recipe drains the ore at 500 while an alloy batch needs 4,000.
    expect(refines, 'a world nobody steers must MAKE the fourth good').toBeGreaterThan(0);
    // MUTATION: delete `alloyAskFor`. This goes to 0 and the book stays empty forever — which is the
    // state `market/` was in for the whole of this project's life.
    expect(asks, 'and OFFER it, or 3,065 lines of market still price nothing').toBeGreaterThan(0);

    let alloy = 0;
    for (const lot of rt.ledger.allLots()) if (lot.good === ALLOY_GOOD) alloy += lot.qty;
    expect(alloy, 'and the units must exist in the ledger, not only in an action log').toBeGreaterThan(0);

    // ── AND THE CLAIM LADDER STILL WORKS, WHICH THE WALL VERSION BROKE ────────
    //
    // The regression that killed the first design, pinned so it cannot come back: `claims` went to 0
    // across every seed when alloy was COMMONS-only, because a Marches claimant could neither refine
    // it nor fund a BID.
    expect(
      rt.sovereignty.liveClaims().length,
      'a gate priced in a good nobody can obtain is a wall, and a wall takes the sovereignty layer with it',
    ).toBeGreaterThan(0);
  }, 300_000);
});

describe('a haul is bounded, refused honestly, and never strands goods', () => {
  it('caps one trip and says so, rather than silently truncating', () => {
    // INV-26 bounds every collection and every quantity. Truncating instead of refusing would move
    // fewer goods than the agent asked for and report success — the affordance lying about what it
    // did, which is the class of defect three blind probes found five of.
    expect(MAX_HAUL_QTY).toBeGreaterThan(Number(ALLOY_ANCHOR_QTY));
    expect(MAX_HAUL_QTY).toBeGreaterThan(Number(WORKS_BUILD_QTY));
    expect(Number.isInteger(MAX_HAUL_QTY)).toBe(true);
  });

  it('INV-W7 is quiet on an honest world and HALTS when the mirror breaks', () => {
    // ══════════════════════════════════════════════════════════════════════
    // `cargoHeldByHands` carries a ⚠ CONTRACT GAP: `hand.cargo` and the lot table cannot both be
    // authoritative, and *"the only sanctioned use of this function against the ledger is equality"*.
    // This is that equality. **Non-vacuity first**: the check must be capable of firing, or it is
    // INV-22 all over again — green over an empty journal for the project's whole life.
    // ══════════════════════════════════════════════════════════════════════
    setSpeed('instant');
    const rt = new Runtime({ seed: 'alloy-mirror' });
    const state = rt.world;
    // Honest: nothing carried, nothing in transit.
    expect(checkCargoMirror({ state, inTransitByGood: new Map(), tick: 1 })).toEqual([]);
    // MUTATION, APPLIED: a lot in transit with no hand carrying it — what a routed convoy would leave
    // behind if `routHand` did not retire the cargo. `runtime.ts` predicted this failure in a comment
    // before it was reachable, and the prediction was right.
    const broken = checkCargoMirror({
      state,
      inTransitByGood: new Map([[ALLOY_GOOD, qty(500)]]),
      tick: 1,
    });
    expect(broken.map((v) => v.id)).toContain('INV-W7');
    expect(broken[0]?.severity, 'a quantity with two homes that disagree is scar #5').toBe('HALT');
  });
});

