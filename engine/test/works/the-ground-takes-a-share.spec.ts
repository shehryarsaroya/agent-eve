/**
 * THE RENT — territory that pays, asserted end-to-end through the front door.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHY THIS TEST EXISTS.** `D23`'s audit found sovereignty *anti*-load-bearing: all four read
 * sites of a claim were the holder paying, and *"the correct answer to 'should I take a claim?'
 * is never — and the agents have worked it out: `claimLines: 0`."* Its ranked correction is
 * blunt: **build the rent before the upkeep**, because *"a claim that pays nothing is not EVE
 * sovereignty simplified; it is EVE sovereignty with the reason removed."*
 *
 * So a claim-holder now takes a published share of everything extracted at its system by
 * anybody else. Four things have to be true at once or the mechanic is worse than absent:
 *
 *   1. **It moves goods.** The landlord's stores rise and the tenant's rise by less.
 *   2. **It mints nothing.** `rent + net === gross`, against a yield the map already capped.
 *   3. **It does not lie.** `worksQuote.sharePerTick` — which `agent.md` calls *"the number
 *      that decides whether the build pays for itself"* and `observe.ts` multiplies by 288 to
 *      state a return — is NET. A gross number there costs a builder a fifth of its planned
 *      income, which is the class of defect a probe had already been burned by once.
 *   4. **It renders.** A13: `claimLines` carries what was taken and who is paying, or the
 *      territory layer is a tint with four ways of losing money on it and no income at all.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { systemYield } from '../../src/works/params.js';
import { BPS_ONE, minor, qty } from '../../src/core/units.js';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import { storesAccount } from '../../src/ledger/index.js';
import { CLAIM_RENT_BPS, RENT_STATEMENT } from '../../src/sovereignty/index.js';
import { checkRentBoundedByMap, checkRentWithinGross } from '../../src/works/invariants.js';
import { WORKS_SPINUP_TICKS, YIELD_PER_TICK } from '../../src/works/params.js';
import { rentApplies, rentOn, rentSplit } from '../../src/works/rent.js';
import { giveAlloy } from './alloy-fixture.js';
import { PATHS, agent, enrol, harness, signed, tick, type Agent, type Harness } from '../api/harness.js';

type Row = Record<string, unknown>;
let h: Harness;

beforeEach(async () => {
  h = await harness({ seed: 'the-ground-takes-a-share' });
});
afterEach(async () => {
  await h.close();
});

async function observe(who: Agent): Promise<Row> {
  const res = await signed(h, who, 'GET', PATHS.observe);
  expect(res.status, res.text.slice(0, 400)).toBe(200);
  return res.json['observation'] as Row;
}

async function act(who: Agent, verb: string, params: unknown): Promise<void> {
  const res = await signed(h, who, 'POST', PATHS.act, {
    actions: [{ verb, params, clientSequence: 1 }],
  });
  expect(res.status, `${verb} -> ${res.status}: ${res.text.slice(0, 400)}`).toBe(200);
}

/** Advance, refusing to paper over a halt: a halted world must fail the test that caused it. */
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
 * Enrol, and top up from another principal only if the starter stake is short.
 *
 * The road to territory costs 50,000 to cross plus a 50,000 bond, and a WORKS costs 60,000 —
 * all of which the §12.5 stake covers, so ordinarily nothing is credited at all. The top-up is
 * a **transfer** rather than a faucet when it is needed, because a fabricated faucet would break
 * INV-1 and the thing under test is the rent, not the road to it.
 */
async function enrolFunded(handle: string, want: number): Promise<Agent> {
  const who = agent(handle);
  expect((await enrol(h, who)).status).toBe(201);
  tick(h, 1);
  const held = h.runtime.ledger.freeBalance(storesAccount(who.principalId as PrincipalId));
  if (held >= want) return who;
  const bank = agent(`${handle}-bank`);
  expect((await enrol(h, bank)).status).toBe(201);
  tick(h, 1);
  const spare = h.runtime.ledger.freeBalance(storesAccount(bank.principalId as PrincipalId));
  h.runtime.ledger.transferCurrency({
    eventId: `test.income:${handle}` as never,
    tick: h.runtime.engine.tick,
    from: storesAccount(bank.principalId as PrincipalId),
    to: storesAccount(who.principalId as PrincipalId),
    amount: minor(Math.min(spare, want - held)),
  });
  return who;
}

/** Take the offered affordance for a verb (and, for `build`, a kind). */
async function takeOffered(who: Agent, verb: string, kind: string | null = null): Promise<void> {
  const offered = (((await observe(who))['affordances'] as Row[]) ?? []).find(
    (a) => a['verb'] === verb && (kind === null || (a['params'] as Row)['kind'] === kind),
  );
  expect(offered, `${verb}${kind === null ? '' : ` ${kind}`} must be offered to ${who.handle}`).toBeDefined();
  await act(who, verb, offered?.['params']);
  run(1);
}

/**
 * A landlord holding a claim, and a tenant working a WORKS on the same ground.
 *
 * The tenant graduates to the landlord's system by NAME rather than by taking whatever the
 * affordance offered: the whole mechanic is about two principals on one place, and a helper that
 * let them drift apart would pass while testing nothing.
 */
async function landlordAndTenant(): Promise<{
  readonly landlord: Agent;
  readonly tenant: Agent;
  readonly system: SystemId;
}> {
  const landlord = await enrolFunded('landlord', 150_000);
  await takeOffered(landlord, 'graduate');
  await takeOffered(landlord, 'post_bond');
  const system = String(((await observe(landlord))['holding'] as Row)['system']) as SystemId;
  // Everything in this file is about the RENT — the split, the quote that must not overstate it, and
  // the panel that draws it. The anchor's 500 units of alloy are supplied through the production
  // faucet because no claimable system can refine one, and a landlord that had to run a Commons
  // franchise first would make every rent assertion here fail for a reason in `market/`.
  giveAlloy(h.runtime, landlord.principalId as PrincipalId, system);
  run(1);
  await takeOffered(landlord, 'build', 'ANCHOR');
  expect(h.runtime.sovereignty.liveAt(system), 'a live claim must stand').not.toBeNull();

  const tenant = await enrolFunded('tenant', 150_000);
  await act(tenant, 'graduate', { to: system });
  run(1);
  expect(
    String(((await observe(tenant))['holding'] as Row)['system']),
    'the tenant has to stand on the landlord\'s ground or this proves nothing',
  ).toBe(system);
  await act(tenant, 'build', { kind: 'WORKS', system });
  run(1);
  expect(h.runtime.works.liveAt(system).length, 'the tenant WORKS stands').toBe(1);
  return { landlord, tenant, system };
}

describe('the arithmetic of a split, before any of it moves', () => {
  it('rent + net === gross, at every share a place can hand over', () => {
    // MUTATION: change `net` to a second multiplication (`gross * (BPS_ONE - rate) / BPS_ONE`)
    // and this goes red on the odd shares — two independent roundings of one quantity is scar #5
    // in arithmetic, and the residue is minted or destroyed goods at every claimed system.
    for (const gross of [0, 1, 4, 5, 9, 20, 27, 40, 55, 80, 110, 150, 149, 7_919]) {
      const split = rentSplit(qty(gross), CLAIM_RENT_BPS);
      expect(split.rent + split.net, `${String(gross)} did not split exactly`).toBe(gross);
      expect(split.rent).toBeGreaterThanOrEqual(0);
      expect(split.net).toBeGreaterThanOrEqual(0);
    }
  });

  it('the remainder goes to whoever DUG it, never to the landlord', () => {
    // §10.2 requires published rounding, and this is the published direction. A rent that rounded
    // up would take a unit the rule never awarded — 288 times a Reckoning at every claimed
    // system, accruing to whoever holds the most territory, invisibly.
    // MUTATION: `Math.ceil` in `rentSplit`. RED here.
    expect(rentSplit(qty(4), CLAIM_RENT_BPS).rent, '20% of 4 is 0.8, and it rounds to the tenant').toBe(0);
    expect(rentSplit(qty(4), CLAIM_RENT_BPS).net).toBe(4);
    // And it is a floor rather than a coincidence of one number.
    for (const gross of [1, 2, 3, 4, 6, 7, 8, 9, 11, 13, 27, 149]) {
      const exact = (gross * CLAIM_RENT_BPS) / BPS_ONE;
      expect(rentSplit(qty(gross), CLAIM_RENT_BPS).rent).toBeLessThanOrEqual(exact);
    }
  });

  it('a landlord never pays itself rent, and unclaimed ground charges none', () => {
    const me = 'p:me' as PrincipalId;
    const them = 'p:them' as PrincipalId;
    const terms = { claimant: me, bps: CLAIM_RENT_BPS, fuelWant: 0 };
    // MUTATION: drop the `terms.claimant === extractor` clause in `rentApplies`. RED here, and
    // the frame would then report rent taken where nothing changed hands.
    expect(rentOn({ terms, extractor: me, gross: qty(150) })).toEqual({ rent: 0, net: 150 });
    expect(rentOn({ terms, extractor: them, gross: qty(150) }).rent).toBe(30);
    expect(rentOn({ terms: null, extractor: them, gross: qty(150) })).toEqual({ rent: 0, net: 150 });
    // The predicate has one home, because two surfaces need the RATE without needing the amount:
    // at a small enough share the amount truncates to zero while the rate is still in force.
    expect(rentApplies(terms, them)).toBe(true);
    expect(rentApplies(terms, me)).toBe(false);
    expect(rentApplies(null, them)).toBe(false);
    expect(rentSplit(qty(3), CLAIM_RENT_BPS).rent, 'truncates to nothing…').toBe(0);
    expect(rentApplies(terms, them), '…and the rate is still in force').toBe(true);
  });
});

describe('a claim takes a share of the ground under it', () => {
  it('the landlord is paid out of the tenant extraction, and the split conserves', async () => {
    const { landlord, tenant, system } = await landlordAndTenant();
    const lord = landlord.principalId as PrincipalId;
    const worker = tenant.principalId as PrincipalId;
    // The tier is the MAP's choice, so it is read rather than assumed — a literal here would make
    // the test pass or fail on which gate the graduation affordance happened to offer.
    const tier = h.runtime.world.map.systems.get(system)?.tier;
    expect(tier, 'the system must be on the map').toBeDefined();
    // ★ Per-SYSTEM since §16.12 #1. The tier figure is the base a tier's total conserves, not what
    // this ground hands over — and rent is a share of what this ground hands over.
    const yieldPerTick = systemYield(h.runtime.world.map, system);
    expect(h.runtime.works.liveAt(system).length, 'exactly one WORKS, so the share is the whole yield').toBe(1);

    // Spin-up first: a WORKS that is not online extracts nothing, so there is nothing to share.
    run(WORKS_SPINUP_TICKS + 1);
    const lordBefore = h.runtime.refinableAt(lord, system);
    const workerBefore = h.runtime.refinableAt(worker, system);

    const ticks = 40;
    run(ticks);
    const lordGained = h.runtime.refinableAt(lord, system) - lordBefore;
    const workerGained = h.runtime.refinableAt(worker, system) - workerBefore;

    // 1. The landlord was paid AT ALL — which was the entire finding.
    expect(lordGained, 'the claim collected nothing; territory is still a bill').toBeGreaterThan(0);
    // 2. Exactly the published rate, per tick, truncated to the tenant. Pinned to the arithmetic
    //    rather than to a literal so the rule is what is asserted and not this seed's numbers.
    const rentPerTick = Math.trunc((yieldPerTick * CLAIM_RENT_BPS) / BPS_ONE);
    expect(rentPerTick, 'the rate must actually bite at this tier').toBeGreaterThan(0);
    expect(lordGained, 'the landlord takes the published share and not a unit more').toBe(rentPerTick * ticks);
    // 3. And nothing appeared from nowhere: the two halves sum to what the place handed over,
    //    which the map fixed and INV-W1 caps. This is the assertion the whole A15 argument rests
    //    on — a rent that minted would show up here as a sum above the yield.
    expect(lordGained + workerGained, 'rent + net must equal the whole yield over the window').toBe(
      yieldPerTick * ticks,
    );
    // 4. The tenant still keeps the larger part: the rent is a share, not a confiscation. One that
    //    took everything would make working claimed ground irrational, and the mechanic would go
    //    back to producing `claimLines: 0` from the other direction.
    expect(workerGained, 'a tenant must keep the larger part').toBeGreaterThan(lordGained);
  }, 60_000);

  it('the WORKS book records the rent, and never more than the place ever yielded', async () => {
    const { system } = await landlordAndTenant();
    run(WORKS_SPINUP_TICKS + 30);
    const works = h.runtime.works.liveAt(system)[0];
    expect(works, 'the WORKS stands').toBeDefined();
    expect(works?.rentPaid ?? 0, 'the resident has handed something over').toBeGreaterThan(0);
    // `extracted` stays GROSS — the place handed that much over, which is what it means
    // everywhere else it is read. So the rent is a strict part of it.
    expect(works?.rentPaid ?? 0).toBeLessThan(works?.extracted ?? 0);
    // INV-W4 and INV-W5 both quiet on a world that has actually collected rent, which is the
    // half of an invariant that a "returns no violations on an empty book" test never reaches.
    expect(
      checkRentWithinGross({ book: h.runtime.works, map: h.runtime.world.map, tick: h.runtime.engine.tick }),
    ).toEqual([]);
    expect(
      checkRentBoundedByMap({
        book: h.runtime.works,
        map: h.runtime.world.map,
        tick: h.runtime.engine.tick,
        rentCeilingBps: CLAIM_RENT_BPS,
      }),
    ).toEqual([]);
  }, 60_000);

  it('INV-W4 and INV-W5 HALT on a rent the map cannot support', async () => {
    const { system } = await landlordAndTenant();
    run(WORKS_SPINUP_TICKS + 30);
    const works = h.runtime.works.liveAt(system)[0];
    expect(works).toBeDefined();
    if (works === undefined) return;

    // MUTATION, applied here rather than described: a rent above the gross is minted goods, and
    // the whole A15 argument for this module is that world output cannot be multiplied.
    const honest = works.rentPaid;
    works.rentPaid = qty(works.extracted + 1);
    const w4 = checkRentWithinGross({
      book: h.runtime.works,
      map: h.runtime.world.map,
      tick: h.runtime.engine.tick,
    });
    expect(w4.map((v) => v.id)).toContain('INV-W4');
    expect(w4[0]?.severity, 'a minted good stops the world; it does not warn').toBe('HALT');
    works.rentPaid = honest;
    expect(
      checkRentWithinGross({ book: h.runtime.works, map: h.runtime.world.map, tick: h.runtime.engine.tick }),
    ).toEqual([]);

    // And the ceiling: a rate of zero means no rent is collectable at all, so any tally at all
    // is a landlord being paid per tenant rather than per place.
    const w5 = checkRentBoundedByMap({
      book: h.runtime.works,
      map: h.runtime.world.map,
      tick: h.runtime.engine.tick,
      rentCeilingBps: 0,
    });
    expect(w5.map((v) => v.id), `system ${system} should be over a zero ceiling`).toContain('INV-W5');
  }, 60_000);
});

describe('the quote a builder reads does not lie about the rent (A2, scar #1)', () => {
  it('worksQuote is NET of rent, and publishes the gross and the rate beside it', async () => {
    const { landlord, tenant, system } = await landlordAndTenant();
    const worker = tenant.principalId as PrincipalId;
    const lord = landlord.principalId as PrincipalId;

    const quote = h.runtime.worksQuote(worker, system);
    // MUTATION: put the gross back into `sharePerTick`. RED here — and in the live world it
    // would overstate a WORKS's stated return by a fifth, which `observe.ts` multiplies by 288
    // before showing it to an agent as "WHAT IT RETURNS".
    expect(quote.rentBps, 'the rate that applies to this builder').toBe(CLAIM_RENT_BPS);
    expect(quote.rentTo, 'named, because a rent is a relationship and not a tax').toBe(lord);
    expect(quote.rentPerTick, 'and the amount it costs per tick').toBeGreaterThan(0);
    expect(quote.sharePerTick + quote.rentPerTick, 'net + rent === gross, exactly').toBe(quote.grossPerTick);
    expect(quote.sharePerTick, 'the net is strictly less than the gross on claimed ground').toBeLessThan(
      quote.grossPerTick,
    );

    // The landlord building on its OWN claim is quoted the whole share, because that is the
    // truth — and it is the strongest argument in the game for working the ground you own.
    const own = h.runtime.worksQuote(lord, system);
    expect(own.rentPerTick).toBe(0);
    expect(own.rentBps).toBe(0);
    expect(own.rentTo).toBeNull();
    expect(own.sharePerTick).toBe(own.grossPerTick);
  }, 60_000);

  it('on unclaimed ground the quote is unchanged, so the Commons reads exactly as before', async () => {
    const who = await enrolFunded('commoner', 200_000);
    const system = String(((await observe(who))['holding'] as Row)['system']) as SystemId;
    const quote = h.runtime.worksQuote(who.principalId as PrincipalId, system);
    expect(quote.rentBps).toBe(0);
    expect(quote.rentPerTick).toBe(0);
    expect(quote.rentTo).toBeNull();
    expect(quote.sharePerTick).toBe(quote.grossPerTick);
    expect(quote.sharePerTick, 'a Commons system still yields its published amount').toBe(
      YIELD_PER_TICK.COMMONS,
    );
  }, 60_000);
});

describe('a builder READS the rent in its own observation, not only in the runtime', () => {
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * **`worksQuote` GREW FOUR RENT FIELDS AND `observe.ts` PUBLISHED NONE OF THEM.**
   *
   * `worksBlock().here` enumerates its fields by hand, so an accessor can be written, tested,
   * mutation-verified and *invisible* — which is this project's single most repeated defect: nine
   * mechanics were once legal and unreachable, and `BUILD` was off the affordance menu for the
   * game's whole life. Both were found by agents playing blind rather than by tests.
   *
   * So these assert the **agent-facing** surface over HTTP, not the accessor: a builder standing on
   * somebody else's claim must be able to read who takes a share of what it digs, and how much,
   * before it spends 60,000 on the structure.
   * ══════════════════════════════════════════════════════════════════════════
   */
  it('holding.works.here publishes the gross, the rent, the rate and the landlord by NAME', async () => {
    const { landlord, system } = await landlordAndTenant();
    // A PROSPECTIVE builder: standing on the claim with nothing raised yet, which is the only reader
    // for whom this quote is a decision rather than a report.
    const prospect = await enrolFunded('prospect', 150_000);
    await act(prospect, 'graduate', { to: system });
    run(1);
    const works = ((await observe(prospect))['holding'] as Row)['works'] as Row;
    const here = works['here'] as Row;
    expect(here, 'a principal standing somewhere always has a `here`').not.toBeNull();

    const quote = h.runtime.worksQuote(prospect.principalId as PrincipalId, system);
    // MUTATION: delete any one of these four lines from `worksBlock().here`. GREEN in every other
    // test in this file, because every other test reads the runtime.
    expect(here['rent_to'], 'the landlord, named — a cost with nobody attached is a tax').toBe(
      landlord.principalId,
    );
    expect(here['rent_bps']).toBe(CLAIM_RENT_BPS);
    expect(here['rent_per_tick']).toBe(quote.rentPerTick);
    expect(here['gross_per_tick']).toBe(quote.grossPerTick);
    // The identity, on the published numbers rather than on the accessor's: an agent that cannot
    // reproduce the subtraction has to trust us, and A2 says it never has to.
    expect(Number(here['gross_per_tick']) - Number(here['rent_per_tick'])).toBe(
      Number(here['share_per_tick']),
    );
    expect(Number(here['share_per_tick']), 'and the net is genuinely lower here').toBeLessThan(
      Number(here['gross_per_tick']),
    );
  }, 60_000);

  it('and the build affordance names the landlord and the rate in words', async () => {
    const { landlord, system } = await landlordAndTenant();
    const prospect = await enrolFunded('prospect-2', 150_000);
    await act(prospect, 'graduate', { to: system });
    run(1);
    const offer = (((await observe(prospect))['affordances'] as Row[]) ?? []).find(
      (a) => a['verb'] === 'build' && (a['params'] as Row)['kind'] === 'WORKS',
    );
    expect(offer, 'the faucet must be on the menu on claimed ground too').toBeDefined();
    const text = String(offer?.['what_it_forecloses']);
    // The affordance is what the LLM cast is prompted from, so this string IS the rule for a
    // deciding agent. It quoted the net correctly and named neither the landlord nor the rate,
    // which left the deduction visible only as a figure that came out lower than expected.
    expect(text, 'the landlord is named').toContain(String(landlord.principalId));
    expect(text, 'and the rate is stated as a percentage').toContain(
      `${String(CLAIM_RENT_BPS / 100)}%`,
    );
    // The RELATIONSHIP, in engine words rather than the test handle: `landlord.principalId` is
    // `p:landlord` here, so an assertion on the word "landlord" alone is satisfied by the id and
    // proves nothing. This phrase is the affordance's, and only the affordance's.
    expect(text, 'and the sentence that says what the name means').toContain('HOLDS THE CLAIM HERE');
    // Both figures either side of the subtraction, so an agent can reproduce it.
    const quote = h.runtime.worksQuote(prospect.principalId as PrincipalId, system);
    expect(text, 'the gross').toContain(String(quote.grossPerTick));
    expect(text, 'and what the landlord takes of it').toContain(String(quote.rentPerTick));
  }, 60_000);
});

describe('the territory layer renders its income (A13)', () => {
  it('the claim line carries what was taken this Reckoning and how many are paying', async () => {
    const { system } = await landlordAndTenant();
    run(WORKS_SPINUP_TICKS + 30);
    const line = h.runtime.claimLines().find((l) => l.system === system);
    expect(line, 'the claim must render at all').toBeDefined();
    // MUTATION: pin `rentAt` to zeros in `claimViewPort`. RED here — and on screen the panel
    // would read "nothing collected" forever while looking entirely correct, which is the exact
    // failure `the-production-chain.spec.ts` caught on the `unrefined` meter.
    expect(line?.rentBps).toBe(CLAIM_RENT_BPS);
    expect(line?.tenants, 'one WORKS here, and it is not the claimant\'s').toBe(1);
    expect(line?.rentTaken, 'and the rent is a number a viewer can read').toBeGreaterThan(0);
  }, 60_000);

  it('the works mark carries the split, and the mark and the ledger agree', async () => {
    const { system } = await landlordAndTenant();
    run(WORKS_SPINUP_TICKS + 30);
    const mark = h.runtime.worksLines(h.runtime.engine.tick).find((l) => l.system === system);
    expect(mark).toBeDefined();
    expect(mark?.rentBps).toBe(CLAIM_RENT_BPS);
    expect(mark?.rentPerTick).toBeGreaterThan(0);
    expect(mark?.rentPaid).toBe(h.runtime.works.liveAt(system)[0]?.rentPaid);
    // The identity `assertFrameBudgets` refuses a frame for breaking: the resident's net plus the
    // landlord's take is the whole share the place hands over, and a frame where they do not sum
    // tells a stranger goods appeared between the ground and the stores.
    expect((mark?.sharePerTick ?? 0) + (mark?.rentPerTick ?? 0)).toBeLessThanOrEqual(
      mark?.yieldPerTick ?? 0,
    );
    expect(mark?.legend).toBe('EXTRACTING');
  }, 60_000);

  it('the observation names the rent to the claimant, in the claim it already reads', async () => {
    const { landlord, system } = await landlordAndTenant();
    run(WORKS_SPINUP_TICKS + 30);
    const view = h.runtime.claimsFor(landlord.principalId as PrincipalId).find((c) => c.system === system);
    expect(view, 'the claimant reads its own claim').toBeDefined();
    // A9: the spectator frame shows no fact an agent's own `observe` would not. Both numbers come
    // off one accessor (`rentReadAt`), so the two surfaces cannot drift.
    expect(view?.rent_bps).toBe(CLAIM_RENT_BPS);
    expect(view?.tenants).toBe(1);
    expect(view?.rent_taken).toBe(h.runtime.claimLines().find((l) => l.system === system)?.rentTaken);
    expect(view?.rent_per_tick).toBeGreaterThan(0);
  }, 60_000);
});

describe('the rate is a term of tenancy, not a knob', () => {
  it('is pinned on the record when the claim is raised', async () => {
    const { system } = await landlordAndTenant();
    expect(h.runtime.sovereignty.liveAt(system)?.rentBps).toBe(CLAIM_RENT_BPS);
  }, 60_000);

  it('a takeover inherits the rate, so nobody can raise it on a sitting tenant', async () => {
    const { system } = await landlordAndTenant();
    const before = h.runtime.sovereignty.liveAt(system)?.rentBps;
    // `succeed` is the one path a claim changes hands by — a takeover, a cession, a rescue — and
    // it deliberately does not touch the rate. A resident spent 60,000 raising a WORKS against
    // the published number; a landlord that could raise it on takeover would make `worksQuote` a
    // number nobody can plan against, which is scar #1 with the agent's capital on the end.
    h.runtime.sovereignty.succeed(system, 'p:usurper' as PrincipalId, null);
    expect(h.runtime.sovereignty.liveAt(system)?.rentBps).toBe(before);
  }, 60_000);

  it('an ended claim stops collecting, and ending it MID-RECKONING does not halt the world', async () => {
    // ══════════════════════════════════════════════════════════════════════
    // **THIS TEST FOUND A HALT.** INV-W5's ceiling was the highest rate any *live* claim carried.
    // Cede a claim at phase 36 having collected 132 units and `liveClaims()` is empty, so the
    // ceiling falls to 0 while the tally is still 132 — and the invariant stopped the tick over
    // arithmetic the rules themselves produced. On the live world it would have fired the first
    // time anybody abandoned territory, which is an ordinary act any principal can take for free.
    // Fixed by bounding on every claim in the book rather than on the live set; the `run(20)`
    // below is what keeps it fixed.
    // ══════════════════════════════════════════════════════════════════════
    const { system } = await landlordAndTenant();
    run(WORKS_SPINUP_TICKS + 5);
    expect(h.runtime.rentTermsAt(system), 'a live claim has terms').not.toBeNull();
    expect(
      h.runtime.claimLines().find((l) => l.system === system)?.rentTaken ?? 0,
      'rent must already have been collected, or the halt this guards cannot reproduce',
    ).toBeGreaterThan(0);
    h.runtime.sovereignty.end(system, 'CEDED', 0, null);
    // MUTATION: read `at(system)` instead of `liveAt(system)` in `rentTermsAt`. RED here, and a
    // landlord that had given up the ground would keep being paid out of it forever.
    expect(h.runtime.rentTermsAt(system), 'a terminal claim has none').toBeNull();
    const works = h.runtime.works.liveAt(system)[0];
    const paidAtCession = works?.rentPaid ?? 0;
    run(20);
    expect(h.runtime.works.liveAt(system)[0]?.rentPaid, 'and nothing more is taken').toBe(paidAtCession);
  }, 60_000);

  it('survives capture/restore, because it is an input to a value-moving event every tick', async () => {
    const { system } = await landlordAndTenant();
    run(WORKS_SPINUP_TICKS + 20);
    const rate = h.runtime.sovereignty.liveAt(system)?.rentBps;
    const paid = h.runtime.works.liveAt(system)[0]?.rentPaid;
    const taken = h.runtime.claimLines().find((l) => l.system === system)?.rentTaken;
    expect(taken).toBeGreaterThan(0);

    // Round-trip both books. A rate read live from the constant would make replay depend on the
    // engine version rather than on the action log; a tally outside the hash would leave two
    // worlds that disagree about what a claim collected hashing the same.
    const captured = h.runtime.sovereignty.capture();
    h.runtime.sovereignty.restore(captured);
    const worksCaptured = h.runtime.works.capture();
    h.runtime.works.restore(worksCaptured);
    expect(h.runtime.sovereignty.liveAt(system)?.rentBps).toBe(rate);
    expect(h.runtime.works.liveAt(system)[0]?.rentPaid).toBe(paid);
    expect(h.runtime.claimLines().find((l) => l.system === system)?.rentTaken).toBe(taken);
  }, 60_000);
});

describe('the rules surface says the same thing the engine does (hard rule 4)', () => {
  it('RENT_STATEMENT quotes the rate the engine charges', () => {
    // MUTATION: change `CLAIM_RENT_BPS` and this goes red, because the statement is built from
    // the constant rather than repeating it. Scar #1 is the engine and the agent-facing text
    // disagreeing about one number while each reads correctly alone.
    expect(RENT_STATEMENT).toContain(`${String(CLAIM_RENT_BPS / 100)}%`);
    // And it says the three things an agent cannot infer: it is taken from EVERY other WORKS,
    // it arrives RAW, and a takeover cannot raise it.
    expect(RENT_STATEMENT).toContain('RAW');
    expect(RENT_STATEMENT).toContain('takeover cannot raise it');
    expect(RENT_STATEMENT).toContain('refine');
  });
});
