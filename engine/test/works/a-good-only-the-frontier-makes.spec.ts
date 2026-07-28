/**
 * FUEL — the third good, and the first comparative advantage this world has ever had.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHY THIS EXISTS.** `D23` calls the player-made economy *"ABSENT, and it is the bottleneck"*, and
 * names the cause rather than asking for more market code:
 *
 * > *"Two goods, one lossless 1:1 conversion. **No comparative advantage exists anywhere in the
 * > world** — every agent needs the same good and can make it at the same rate. That is why the book
 * > has never cleared, and why more market code cannot fix it."*
 *
 * Its first-ranked fix is *"a third good produced only at FRONTIER systems, consumed by something
 * everyone needs"*. `fuel` is that good: yielded only where the map says so, and burned by a
 * FRONTIER claim to keep collecting rent.
 *
 * Four things have to hold, and the first is the one that would be silent if it broke:
 *
 *   1. **Fuel exists ONLY at the Frontier**, or the asymmetry prices at nothing and the failure
 *      looks exactly like the world we already had — a book that quietly does not clear.
 *   2. **Nothing on the road to fuel is priced in fuel.** `works/params.ts` documents the bootstrap
 *      deadlock; a geographically-bounded good makes it permanent rather than merely initial.
 *   3. **A cold anchor loses income and nothing else.** No arrears, no lapse, no slash — a new way
 *      to be recorded short would be A5′ with the geography as the cause.
 *   4. **The burn is once a Reckoning and atomic.** A partial burn destroys fuel and lights nothing.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildObservation } from '../../src/api/observe.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { ConstellationId, PrincipalId, SystemId, ZoneTier } from '../../src/core/types.js';
import { qty } from '../../src/core/units.js';
import { ENDOWMENT_GOOD } from '../../src/ledger/endowment.js';
import { storesAccount } from '../../src/ledger/index.js';
import { LEVY_GOOD } from '../../src/levy/params.js';
import { Runtime } from '../../src/sim/runtime.js';
import {
  ANCHOR_FUEL_BY_TIER,
  ANCHOR_QTY,
  CHARGE_BY_TIER,
  CHARGE_GOOD,
  CHARGE_STATEMENT,
  CLAIM_RENT_BPS,
  FUEL_STATEMENT,
  claimIdFor,
} from '../../src/sovereignty/index.js';
import { Book, worksId, type WorksId } from '../../src/works/book.js';
import { checkFuelIsFrontierOnly } from '../../src/works/invariants.js';
import {
  FUEL_GOOD,
  FUEL_YIELD_PER_TICK,
  WORKS_BUILD_QTY,
  WORKS_COST_MINOR,
  WORKS_GOOD,
  WORKS_SPINUP_TICKS,
  WORKS_YIELD_GOOD,
  YIELD_PER_TICK,
} from '../../src/works/params.js';
import { collectingAt } from '../../src/works/produce.js';
import type { RentTerms } from '../../src/works/rent.js';
import { PATHS, agent, enrol, harness, signed, tick, type Agent, type Harness } from '../api/harness.js';

const LORD = 'p:lord' as PrincipalId;
const WORKER = 'p:worker' as PrincipalId;
const SYS = 'sys-26' as SystemId;

describe('the good exists in one zone, and that is the whole mechanic', () => {
  it('is a FIFTH good, not an alias of any of the four that already agree', () => {
    // `test/core/goods-are-independent.test.ts` pins that the Levy, the WORKS cost, the Charge and
    // the endowment all name ONE good, because this build had one. Fuel is the first that must NOT:
    // if it collapsed into `ration` it would be producible everywhere, refinable, and payable
    // against every obligation — which is the two-good world with a third name on it.
    for (const other of [LEVY_GOOD, WORKS_GOOD, CHARGE_GOOD, ENDOWMENT_GOOD, WORKS_YIELD_GOOD]) {
      expect(FUEL_GOOD, `fuel must differ from ${other}`).not.toBe(other);
    }
  });

  it('is yielded at FRONTIER and NOWHERE else, and the zeroes are asserted not assumed', () => {
    // MUTATION: give MARCHES a non-zero fuel yield. This goes red, and so does the deadlock test
    // below — because a good every claim tier can make is not a comparative advantage.
    expect(FUEL_YIELD_PER_TICK.COMMONS).toBe(0);
    expect(FUEL_YIELD_PER_TICK.MARCHES).toBe(0);
    expect(FUEL_YIELD_PER_TICK.FRONTIER).toBeGreaterThan(0);
    // And the sink is asked for only where the good can be made. A MARCHES claim asked for fuel
    // could never supply it — no local yield, and (before `haul`) no way to bring any in — which
    // would be an obligation the rules make impossible to meet (A5′). Still zero now that goods can
    // move: a claim tier that yields none should not owe any, because the alternative is billing a
    // Marches claimant for a permanent import.
    expect(ANCHOR_FUEL_BY_TIER.MARCHES).toBe(0);
    expect(ANCHOR_FUEL_BY_TIER.COMMONS).toBe(0);
    expect(ANCHOR_FUEL_BY_TIER.FRONTIER).toBeGreaterThan(0);
  });

  it('NOTHING on the road to fuel is priced in fuel (the bootstrap deadlock)', () => {
    // ══════════════════════════════════════════════════════════════════════
    // The trap `works/params.ts` documents, checked rather than remembered. Fuel comes from a WORKS
    // at a FRONTIER system. The road there is: graduate, then build. If ANY step on that road were
    // payable in fuel, no first move would exist — and unlike the `ore`/`ration` version of this
    // trap, geography would make it permanent rather than merely initial.
    //
    // MUTATION: set `WORKS_GOOD = FUEL_GOOD`. RED here, and the live world would deadlock with
    // every individual rule reading correctly and no error message anywhere.
    // ══════════════════════════════════════════════════════════════════════
    expect(WORKS_GOOD, 'a WORKS must not cost the good only a WORKS on the frontier can make').not.toBe(FUEL_GOOD);
    expect(WORKS_YIELD_GOOD, 'and the ore yield is a different good again').not.toBe(FUEL_GOOD);
    expect(CHARGE_GOOD, 'a Charge is payable in the endowment good, so a claim is reachable').not.toBe(FUEL_GOOD);
    expect(LEVY_GOOD, 'and the Levy above all: a fuel Levy would be unpayable in three zones').not.toBe(FUEL_GOOD);
    expect(ENDOWMENT_GOOD).not.toBe(FUEL_GOOD);
    // The positive half: everything the road costs is denominated in the good a newcomer is handed.
    expect(WORKS_GOOD).toBe(ENDOWMENT_GOOD);
    expect(WORKS_BUILD_QTY).toBeGreaterThan(0);
    expect(WORKS_COST_MINOR).toBeGreaterThan(0);
  });

  it('the calibration produces the sentence it was chosen for', () => {
    // The property the ratio exists to create, stated as arithmetic: a landlord that works its own
    // ground fuels itself; a pure rentier cannot, because the rent is taken in ORE and never in
    // fuel. Both halves are load-bearing, and both move if either constant moves.
    const perReckoning = FUEL_YIELD_PER_TICK.FRONTIER * TICKS_PER_RECKONING;
    const need = ANCHOR_FUEL_BY_TIER.FRONTIER;
    // Landlord + one tenant: the landlord's own half of the fuel covers the anchor.
    expect(Math.trunc(perReckoning / 2), 'working your own ground must fuel your own anchor').toBeGreaterThanOrEqual(need);
    // A pure rentier receives none at all, so it has to buy every unit from a resident.
    expect(need, 'and a rentier must buy a real quantity, not a rounding').toBeGreaterThan(0);
    // Scarce relative to its sink: one frontier system must not fuel the whole map.
    expect(perReckoning, 'fuel must not be so abundant that the asymmetry prices at nothing').toBeLessThan(
      need * 8,
    );
  });

  it('agent.md carries every fuel rule, in the engine own numbers (hard rule 4)', () => {
    // ══════════════════════════════════════════════════════════════════════
    // **THE LLM CAST IS PROMPTED FROM `agent.md`, AND §11A IS THE ONLY PART OF IT THE CAST READS.**
    // `sovereigntyStatementFor` now serves `FUEL_STATEMENT` as the fourth statement (2026-07-27) —
    // for a day it served three and the statement was exported to nobody — but the served slot is an
    // *observation* field, and the cast contract excerpts §11A and not §11B, so §11A is still the
    // whole of what a cast member reads about the third good before it is a claimant.
    //
    // The prose here is compressed rather than verbatim, and the reason is worth keeping as a
    // record of what a byte budget on a rules surface actually costs: the excerpt was at 37,902 of
    // a 38,000 bar and a verbatim copy pushed it to 39,706, at which size a later section was
    // silently dropped. So the numbers are pinned against the constants instead of the prose being
    // pinned against the statement. **The budget is no longer paid by everybody on every wake**
    // (`src/cast/prompt.ts:CONTRACT_CATALOG` selects per situation, and §11A is floor), but §11B is
    // 8,491 characters and still does not fit — see `CONTRACT_NOT_EXCERPTED`. §11B carries the
    // statement verbatim for an external agent, and `test/rules-surface/agent-md.test.ts` pins it.
    //
    // MUTATION: change `ANCHOR_FUEL_BY_TIER.FRONTIER` or `FUEL_YIELD_PER_TICK.FRONTIER`. RED here,
    // which is the whole point: scar #1 is the engine and the agent-facing text disagreeing about one
    // number while each reads correctly alone.
    // ══════════════════════════════════════════════════════════════════════
    const md = readFileSync(fileURLToPath(new URL('../../agent.md', import.meta.url)), 'utf8');
    for (const wanted of [
      // The numbers, from the constants rather than typed again.
      `${String(ANCHOR_FUEL_BY_TIER.FRONTIER)} fuel once per Reckoning`,
      `${String(FUEL_YIELD_PER_TICK.FRONTIER)} \`${String(FUEL_GOOD)}\` a tick`,
      `${String(CLAIM_RENT_BPS / 100)}% of everything every WORKS extracts`,
      // The rules an agent cannot infer and would be punished for guessing.
      'cannot be refined, and pays no obligation',
      'standing at the claimed system',
      'cold anchor collects nothing',
      'no arrears, no lapse and no bond slashed',
      'MARCHES claim needs no fuel',
      // ── THIS LINE PINNED A SENTENCE THAT IS NOW FALSE, AND THE PIN FOLLOWED IT ──
      //
      // It read `'No verb in this build moves goods between systems'` — true, and the reason a
      // frontier rentier had to buy from its own tenants. `haul` is live, so agent.md dropped that
      // sentence rather than keep a **false statement about the rules on the most-read surface in
      // the game**, which is the failure a rules-surface pin exists to catch, not to cause. What an
      // agent still cannot infer is the half that did not change: goods are LOCATED, and exactly one
      // verb moves them. `test/rules-surface/agent-md.test.ts` re-pointed the identical assertion
      // for the identical reason; this copy was missed. The intent has not moved.
      'Goods are LOCATED, and `haul` is the only verb that moves them',
      'Never from the claimant\'s own WORKS',
      'a takeover cannot raise it on a sitting tenant',
      // And the field whose MEANING changed, which is the highest-risk surface of the lot.
      '`here.share_per_tick` — **what YOURS would KEEP: counting itself, after any rent.**',
    ]) {
      expect(md.replace(/\n/g, ' ').replace(/ +/g, ' '), `agent.md must say: ${wanted}`).toContain(
        wanted.replace(/\n/g, ' '),
      );
    }
  });

  it('FUEL_STATEMENT tells an agent the three things it cannot infer', () => {
    // A rules surface (hard rule 4): a claimant whose income stopped for an unstated reason cannot
    // find the fix, and the fix — buy fuel from the residents you tax — is only discoverable if the
    // rule is written down.
    expect(FUEL_STATEMENT).toContain(String(ANCHOR_FUEL_BY_TIER.FRONTIER));
    expect(FUEL_STATEMENT).toContain('cold anchor collects nothing');
    expect(FUEL_STATEMENT).toContain('no arrears, no lapse, no bond slashed');
    // ── THIS PIN MOVED WHEN `haul` LANDED, AND THE OLD ONE WOULD HAVE STAYED GREEN ──
    //
    // The statement used to say *"no verb in this build moves goods between systems — so ... you must
    // BUY fuel from the residents you are taxing."* True when written, **false the day `haul` shipped**,
    // and a false rule on the surface a claimant is billed from is scar #1 where A5′ cares most: a
    // rentier told its only option is its own tenants will overpay a monopolist it could bypass.
    // Asserting the OPTION rather than the obligation is what makes this pin survive the rule changing
    // and fail when the rule is wrong.
    expect(FUEL_STATEMENT, 'buying from a tenant is one road').toContain('BUY it from the residents');
    expect(FUEL_STATEMENT, 'and carrying it in is the other').toContain('`haul` it in one lane at a time');
    expect(FUEL_STATEMENT, 'and the statement must not promise goods cannot move').not.toContain(
      'no verb in this build moves goods',
    );
    expect(FUEL_STATEMENT).toContain('MARCHES claim needs no fuel');
  });
});

describe('the fourth statement is SERVED, not merely exported', () => {
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * **`FUEL_STATEMENT` WAS WRITTEN, TESTED, PINNED AND HANDED TO NOBODY.** `holding.sovereignty`
   * served one of three, so `agent.md` was the whole of a claimant's access to the rule — and this
   * is the one statement whose failure is invisible from every other field: a cold anchor takes no
   * arrears, lapses nothing, is slashed nothing, and `holding.threats[]` stays empty while the
   * income is zero. Nothing else in the observation turns red.
   *
   * The claim is inserted as a FIXTURE on purpose. Reaching a frontier claim through the front door
   * costs a four-hop walk, a bond and 5,000 refined units, and the acceptance test already owns that
   * road; what is under test here is the SELECTION, which is a pure function of the claim views.
   * ══════════════════════════════════════════════════════════════════════════
   */
  function worldWithClaimAt(tier: ZoneTier, seed: string): { readonly statement: string | null } {
    setSpeed('instant');
    const rt = new Runtime({ seed });
    const cast = new HeuristicCast(rt, { size: 4 });
    cast.seat(seed);
    rt.runTick();
    const who = cast.roster[0]?.principal;
    if (who === undefined) throw new Error('no cast member seated');
    const system = rt.world.map.systemOrder.find((id) => rt.world.map.systems.get(id)?.tier === tier);
    if (system === undefined) throw new Error(`the seeded map has no ${tier} system`);
    const epoch = rt.sovereignty.nextEpochFor(system);
    rt.sovereignty.take({
      id: claimIdFor(system, epoch),
      system,
      constellation: (rt.world.map.systems.get(system)?.constellation ?? '') as ConstellationId,
      claimant: who,
      epoch,
      takenAtTick: rt.engine.tick,
      anchorQty: ANCHOR_QTY,
      rentBps: CLAIM_RENT_BPS,
      bondEncumbranceId: `enc:bond:${who}:test`,
      state: 'SUPPLIED',
      endedAtReckoning: null,
      succeededBy: null,
    });
    const observation = buildObservation({
      runtime: rt,
      principal: who,
      serverNowMs: 0,
      fresh: true,
      wakesRemaining: 9,
      stale: false,
      corrections: [],
      actionsRemaining: 4,
    });
    const holding = observation.holding as Record<string, unknown>;
    const statement = holding['sovereignty'];
    // Asserted rather than cast: `holding.sovereignty` is a string or null by contract, and a test
    // that stringified an object here would report `[object Object]` as a passing statement.
    expect(statement === null || typeof statement === 'string').toBe(true);
    return { statement: typeof statement === 'string' ? statement : null };
  }

  it('a FRONTIER claimant with a cold anchor reads the FUEL rule on holding.sovereignty', () => {
    // MUTATION: remove the fuel branch from `sovereigntyStatementFor`. RED here, and GREEN in every
    // other test in this file — because every other test reads the constant, not the observation.
    const { statement } = worldWithClaimAt('FRONTIER', 'fuel-statement-frontier');
    expect(statement, 'the statement must reach the agent, not just the module').toBe(FUEL_STATEMENT);
  }, 60_000);

  it('a MARCHES claimant still reads the CHARGE, because no fuel is asked of it', () => {
    // The guard's guard. An always-on fuel statement would displace the Charge — the larger loss,
    // being bonded capital — and would be the always-on warning `claimThreats` deliberately refuses
    // to be. `ANCHOR_FUEL_BY_TIER.MARCHES` is zero, so the branch must not fire at all.
    const { statement } = worldWithClaimAt('MARCHES', 'fuel-statement-marches');
    expect(statement).toBe(CHARGE_STATEMENT);
  }, 60_000);
});

describe('the split of the second good is the split of the first', () => {
  function bookWith(holders: readonly PrincipalId[]): { book: Book; ids: readonly WorksId[] } {
    const book = new Book();
    const ids: WorksId[] = [];
    for (const [i, holder] of holders.entries()) {
      book.raise({ system: SYS, holder, tick: i });
      ids.push(worksId(SYS, i, holder));
    }
    return { book, ids };
  }

  it('divides the tier fuel yield exactly, over the ONLINE set, in canonical order', () => {
    const { book } = bookWith([LORD, WORKER, 'p:third' as PrincipalId]);
    const at = WORKS_SPINUP_TICKS + 10;
    for (const tier of ['COMMONS', 'MARCHES', 'FRONTIER'] as readonly ZoneTier[]) {
      const shares = book.fuelSharesAt(SYS, tier, at);
      let total = 0;
      for (const v of shares.values()) total += v;
      // MUTATION: divide fuel among the LIVE set instead of the online set, or round up in
      // `splitQty`. Either mints fuel, which is the A15 hole the ore split already closes — and
      // fuel is the good that would be worth minting.
      expect(total, `${tier} must hand over exactly its published fuel yield`).toBe(
        FUEL_YIELD_PER_TICK[tier],
      );
    }
    // Outside the Frontier the map yields none, so the split is EMPTY rather than a map of zeroes:
    // a zero row would put a fuel posting of 0 on the ledger at every system every tick.
    expect(book.fuelSharesAt(SYS, 'MARCHES', at).size).toBe(0);
    expect(book.fuelSharesAt(SYS, 'FRONTIER', at).size).toBe(3);
  });

  it('a WORKS still spinning up takes no fuel, and does not dilute the others', () => {
    const { book } = bookWith([LORD]);
    book.raise({ system: SYS, holder: WORKER, tick: 100 });
    const shares = book.fuelSharesAt(SYS, 'FRONTIER', WORKS_SPINUP_TICKS + 10);
    expect(shares.size, 'only the online one').toBe(1);
    expect([...shares.values()][0]).toBe(FUEL_YIELD_PER_TICK.FRONTIER);
  });
});

describe('the anchor has to be hot, and hot costs fuel once a Reckoning', () => {
  function fixture(holders: readonly PrincipalId[]): {
    book: Book;
    shares: ReadonlyMap<WorksId, ReturnType<typeof qty>>;
  } {
    const book = new Book();
    for (const [i, holder] of holders.entries()) book.raise({ system: SYS, holder, tick: i });
    return { book, shares: book.sharesAt(SYS, 'FRONTIER', WORKS_SPINUP_TICKS + 10) };
  }

  const terms = (fuelWant: number): RentTerms => ({ claimant: LORD, bps: CLAIM_RENT_BPS, fuelWant });

  it('a tier that asks no fuel collects without one, so the Marches is never cold', () => {
    const { book, shares } = fixture([WORKER]);
    let burns = 0;
    const got = collectingAt({
      book,
      claimed: terms(0),
      shares,
      system: SYS,
      reckoning: 3,
      tick: 900,
      fuelAnchor: () => {
        burns += 1;
        return true;
      },
    });
    // MUTATION: drop the `fuelWant <= 0` early return. Every Marches claim in the world would then
    // go cold and collect nothing, permanently, because no Marches system can produce fuel.
    expect(got, 'a claim that needs no fuel collects').not.toBeNull();
    expect(burns, 'and nothing is burned to do it').toBe(0);
  });

  it('collects when the fuel is there, and the burn happens ONCE per Reckoning', () => {
    const { book, shares } = fixture([WORKER]);
    let burns = 0;
    const call = (reckoning: number, at: number): RentTerms | null =>
      collectingAt({
        book,
        claimed: terms(1_200),
        shares,
        system: SYS,
        reckoning,
        tick: at,
        fuelAnchor: () => {
          burns += 1;
          return true;
        },
      });
    expect(call(3, 900)).not.toBeNull();
    expect(burns).toBe(1);
    // Every subsequent tick of the same Reckoning collects on the fuel already burned. MUTATION:
    // make `anchorHot` ignore the Reckoning and this stays at 1 forever — an anchor lit once would
    // collect for the rest of the world's life on one purchase.
    for (const at of [901, 902, 1_100]) expect(call(3, at)).not.toBeNull();
    expect(burns, 'still one purchase').toBe(1);
    // A new Reckoning is a new purchase.
    expect(call(4, 1_200)).not.toBeNull();
    expect(burns).toBe(2);
    expect(book.anchorHot(SYS, 4)).toBe(true);
    expect(book.anchorHot(SYS, 3), 'and the old Reckoning is dropped, not accumulated').toBe(false);
  });

  it('a COLD anchor collects nothing, and nothing was burned trying', () => {
    const { book, shares } = fixture([WORKER]);
    let burns = 0;
    const got = collectingAt({
      book,
      claimed: terms(1_200),
      shares,
      system: SYS,
      reckoning: 3,
      tick: 900,
      // The port refuses when the fuel is not all there — the all-or-nothing contract. Burning what
      // it found would leave the claimant poorer with a cold anchor, which is unrecoverable.
      fuelAnchor: () => {
        burns += 1;
        return false;
      },
    });
    // MUTATION: return `claimed` on a failed burn. The rent would flow on fuel nobody supplied, and
    // the frame would draw `anchorHot: false` beside a non-zero `rentTaken` — which
    // `assertFrameBudgets` now refuses, so the world would stop rather than lie.
    expect(got, 'a cold anchor is not collecting').toBeNull();
    expect(burns).toBe(1);
    expect(book.anchorHot(SYS, 3)).toBe(false);
  });

  it('fuel arriving mid-Reckoning lights it for the rest of the cycle (A4: not a timing game)', () => {
    const { book, shares } = fixture([WORKER]);
    let available = false;
    const call = (at: number): RentTerms | null =>
      collectingAt({
        book,
        claimed: terms(1_200),
        shares,
        system: SYS,
        reckoning: 3,
        tick: at,
        fuelAnchor: () => available,
      });
    expect(call(900), 'cold while the fuel is not there').toBeNull();
    expect(call(901)).toBeNull();
    available = true;
    expect(call(902), 'and it lights the moment it is').not.toBeNull();
    available = false;
    expect(call(903), 'and stays lit for the rest of the Reckoning on what was burned').not.toBeNull();
  });

  it('burns nothing when there is nobody to collect FROM', () => {
    // A lone claimant working its own ground would otherwise pay a Reckoning of fuel to tax itself
    // nothing. MUTATION: delete the `payer` loop. RED here, and in the live world a solo frontier
    // claimant would burn 1,200 fuel a Reckoning for zero income and never be told why.
    const { book, shares } = fixture([LORD]);
    let burns = 0;
    const got = collectingAt({
      book,
      claimed: terms(1_200),
      shares,
      system: SYS,
      reckoning: 3,
      tick: 900,
      fuelAnchor: () => {
        burns += 1;
        return true;
      },
    });
    expect(got).toBeNull();
    expect(burns).toBe(0);
  });

  it('unclaimed ground never burns and never collects', () => {
    const { book, shares } = fixture([WORKER]);
    let burns = 0;
    expect(
      collectingAt({
        book,
        claimed: null,
        shares,
        system: SYS,
        reckoning: 3,
        tick: 900,
        fuelAnchor: () => {
          burns += 1;
          return true;
        },
      }),
    ).toBeNull();
    expect(burns).toBe(0);
  });
});

describe('INV-W6: a fuel unit outside the Frontier stops the world', () => {
  it('is quiet on an honest book and HALTS on a leak', () => {
    const h2 = new Book();
    h2.raise({ system: 'sys-05' as SystemId, holder: WORKER, tick: 0 });
    const marchesWorks = worksId('sys-05' as SystemId, 0, WORKER);
    // A map stub is enough: the invariant asks only for the tier of a system.
    const map = { systems: new Map([['sys-05', { tier: 'MARCHES' }]]) } as never;
    expect(checkFuelIsFrontierOnly({ book: h2, map, tick: 10 })).toEqual([]);
    // MUTATION, applied: credit fuel to a Marches WORKS. In the live world this is what a
    // mis-keyed tier lookup would do, and the symptom would be a book that quietly clears.
    h2.creditFuel(marchesWorks, qty(5));
    const out = checkFuelIsFrontierOnly({ book: h2, map, tick: 10 });
    expect(out.map((v) => v.id)).toContain('INV-W6');
    expect(out[0]?.severity, 'a good appearing where the map yields none is not a warning').toBe('HALT');
  });
});

describe('a FRONTIER system actually hands fuel over, through the front door', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness({ seed: 'frontier-fuel' });
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

  async function act(who: Agent, verb: string, params: unknown): Promise<number> {
    const res = await signed(h, who, 'POST', PATHS.act, {
      actions: [{ verb, params, clientSequence: 1 }],
    });
    return res.status;
  }

  let banks = 0;

  /** Top up from freshly enrolled principals until the balance covers `want`. */
  async function topUp(who: Agent, want: number): Promise<void> {
    const me = storesAccount(who.principalId as PrincipalId);
    for (let i = 0; i < 6; i += 1) {
      if (h.runtime.ledger.freeBalance(me) >= want) return;
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

  /** Lane-hops from each system to the nearest FRONTIER one. The map is seeded, so it is measured. */
  function distanceToFrontier(): ReadonlyMap<string, number> {
    const map = h.runtime.world.map;
    const nb = new Map<string, string[]>();
    for (const lane of map.lanes.values()) {
      nb.set(lane.a, [...(nb.get(lane.a) ?? []), lane.b]);
      nb.set(lane.b, [...(nb.get(lane.b) ?? []), lane.a]);
    }
    const dist = new Map<string, number>();
    const queue: string[] = [];
    for (const id of map.systemOrder) {
      if (map.systems.get(id)?.tier === 'FRONTIER') {
        dist.set(id, 0);
        queue.push(id);
      }
    }
    while (queue.length > 0) {
      const cur = queue.shift();
      if (cur === undefined) continue;
      for (const next of [...(nb.get(cur) ?? [])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
        if (dist.has(next)) continue;
        dist.set(next, (dist.get(cur) ?? 0) + 1);
        queue.push(next);
      }
    }
    return dist;
  }

  /**
   * Walk a body outward, one published lane at a time, until it stands on FRONTIER ground.
   *
   * Every hop is taken through `graduation.open` and charged exactly as an agent would be charged,
   * so the road is the real one. Which of the open lanes to take is chosen by breadth-first distance
   * over the map — the map is generated from the seed, so a written-down route would be testing this
   * seed rather than the rule, and a "take the first option" walk wanders (measured: it did).
   */
  async function walkToFrontier(who: Agent): Promise<SystemId> {
    const dist = distanceToFrontier();
    const closer = (a: string, b: string): number =>
      (dist.get(a) ?? 99) - (dist.get(b) ?? 99) || (a < b ? -1 : a > b ? 1 : 0);
    for (let hop = 0; hop < 10; hop += 1) {
      const quote = h.runtime.graduationQuote(who.principalId as PrincipalId);
      if (quote === null) break;
      if (h.runtime.world.map.systems.get(quote.from)?.tier === 'FRONTIER') return quote.from;
      const next = [...quote.open].sort(closer)[0];
      if (next === undefined) break;
      await topUp(who, 60_000);
      // ── NO FARE ON THIS WALK, AND THAT IS A DELETED FEATURE RATHER THAN AN OMISSION ──
      //
      // A crossing beyond the Commons was briefly priced in `alloy` — §10.1's "convex in footprint" —
      // and it was removed on the measurement that walking this very road produced: every seat after
      // the first holds no WORKS, therefore no ore, therefore no way to refine any, and the market's
      // buy side is unfundable. It closed the Frontier, and `HULL_COST_GOODS` needs FRONTIER-only
      // fuel, so it closed the combat layer with it. `works/params.ts` carries the full diagnosis
      // where the constant used to be.
      expect(await act(who, 'graduate', { to: next }), `hop ${String(hop)} to ${next}`).toBe(200);
      run(1);
    }
    return h.runtime.graduationQuote(who.principalId as PrincipalId)?.from ?? ('' as SystemId);
  }

  it('yields fuel to the WORKS standing there, and the OBSERVATION says so before the build', async () => {
    const who = agent('prospector');
    expect((await enrol(h, who)).status).toBe(201);
    tick(h, 1);
    const system = await walkToFrontier(who);
    expect(
      h.runtime.world.map.systems.get(system)?.tier,
      'the walk must actually reach the Frontier or this proves nothing',
    ).toBe('FRONTIER');

    const p = who.principalId as PrincipalId;
    // The quote names the second good BEFORE anything is built. Without this an agent has no reason
    // to prefer frontier ground beyond the raw yield, and the whole asymmetry is undiscoverable.
    const quote = h.runtime.worksQuote(p, system);
    expect(quote.fuelGood).toBe(FUEL_GOOD);
    expect(quote.fuelYieldPerTick).toBe(FUEL_YIELD_PER_TICK.FRONTIER);
    expect(quote.fuelSharePerTick, 'and what YOURS would take of it').toBeGreaterThan(0);
    expect(quote.yieldPerTick).toBe(YIELD_PER_TICK.FRONTIER);

    // ══════════════════════════════════════════════════════════════════════
    // **AND THE AGENT CAN ACTUALLY READ IT.** The three assertions above passed for a day while
    // `worksBlock().here` — which enumerates its fields by hand — published none of them, so the
    // frontier premium existed in the engine and in no observation. That is the defect this project
    // keeps re-teaching, and it has only ever been caught by reading the agent-facing surface.
    // ══════════════════════════════════════════════════════════════════════
    const seen = await signed(h, who, 'GET', PATHS.observe);
    expect(seen.status).toBe(200);
    const observation = seen.json['observation'] as Record<string, unknown>;
    const worksBlock = (observation['holding'] as Record<string, unknown>)['works'] as Record<
      string,
      unknown
    >;
    const here = worksBlock['here'] as Record<string, unknown>;
    expect(here['fuel_good']).toBe(FUEL_GOOD);
    expect(here['fuel_yield_per_tick']).toBe(FUEL_YIELD_PER_TICK.FRONTIER);
    expect(here['fuel_share_per_tick'], 'the whole of the frontier premium').toBe(
      quote.fuelSharePerTick,
    );
    // And in the affordance, which is what the LLM cast decides from.
    await topUp(who, Number(WORKS_COST_MINOR) + 10_000);
    const offered = await signed(h, who, 'GET', PATHS.observe);
    const offer = (
      (offered.json['observation'] as Record<string, unknown>)['affordances'] as Record<
        string,
        unknown
      >[]
    ).find((a) => a['verb'] === 'build' && (a['params'] as Record<string, unknown>)['kind'] === 'WORKS');
    expect(offer, 'the faucet must be on the menu at the place that makes the scarce good').toBeDefined();
    const text = String(offer?.['what_it_forecloses']);
    expect(text, 'the fuel is named in the offer, not only in a field').toContain(String(FUEL_GOOD));
    expect(text).toContain(String(quote.fuelSharePerTick));

    await topUp(who, Number(WORKS_COST_MINOR) + 10_000);
    expect(await act(who, 'build', { kind: 'WORKS', system })).toBe(200);
    run(1);
    expect(h.runtime.works.liveAt(system).length).toBe(1);

    // Past spin-up FIRST, then measure a clean window: a snapshot taken before the WORKS came
    // online counts a boundary tick and turns an exact assertion into an off-by-one argument.
    run(WORKS_SPINUP_TICKS + 1);
    const before = h.runtime.fuelAt(p, system);
    const oreBefore = h.runtime.refinableAt(p, system);
    const ticks = 20;
    run(ticks);
    const gained = h.runtime.fuelAt(p, system) - before;
    // MUTATION: skip the fuel `sourceGoods` in `produce`. RED here — and the third good would
    // exist in the params file and nowhere in the world.
    expect(gained, 'a frontier place must hand over fuel').toBeGreaterThan(0);
    expect(gained, 'exactly the published rate, sole occupant, over the measured window').toBe(
      FUEL_YIELD_PER_TICK.FRONTIER * ticks,
    );
    // Located where it was dug, like everything else (§10.2). A landlord elsewhere cannot burn it.
    expect(h.runtime.fuelAt(p, 'sys-01' as SystemId)).toBe(0);
    // And the ore is unaffected: two goods from ONE place, counted apart (hard rule 4). A single
    // `extracted` summing both would make the frame's number a quantity of nothing in particular
    // and would silently widen INV-W4's and INV-W5's bounds, which are stated against the ore.
    expect(h.runtime.refinableAt(p, system) - oreBefore).toBe(YIELD_PER_TICK.FRONTIER * ticks);
    expect(h.runtime.works.liveAt(system)[0]?.fuelExtracted).toBeGreaterThanOrEqual(gained);
    expect(h.runtime.works.liveAt(system)[0]?.extracted).toBeGreaterThan(
      h.runtime.works.liveAt(system)[0]?.fuelExtracted ?? 0,
    );
    // The mark draws it, or the third good has no pixel signature (A13).
    const mark = h.runtime.worksLines(h.runtime.engine.tick).find((l) => l.system === system);
    expect(mark?.fuelPerTick).toBe(FUEL_YIELD_PER_TICK.FRONTIER);
    expect(mark?.fuelExtracted).toBe(h.runtime.works.liveAt(system)[0]?.fuelExtracted);
  }, 120_000);

  it('the anchor cost is reachable from what a frontier claim can actually make', () => {
    // A15 sanity, not a mechanism test: the claim gate is priced in produced goods, and this checks
    // the arithmetic leaves a first move. One frontier WORKS produces the anchor's ration cost and
    // its own tier's Charge inside a Reckoning, and the fuel to light one anchor twice over.
    expect(YIELD_PER_TICK.FRONTIER * TICKS_PER_RECKONING).toBeGreaterThan(
      Number(ANCHOR_QTY) + Number(CHARGE_BY_TIER.FRONTIER),
    );
    expect(FUEL_YIELD_PER_TICK.FRONTIER * TICKS_PER_RECKONING).toBeGreaterThan(
      Number(ANCHOR_FUEL_BY_TIER.FRONTIER),
    );
  });
});
