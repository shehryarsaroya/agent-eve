/**
 * ★ **REACH READS EVERY SITUATION TWO PRINCIPALS STOOD IN TOGETHER — AND NOTHING THAT IS FREE TO
 * ENTER ALONE (`RULES_VERSION` 41).**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A blind playtester on 2026-10-01: *"a shared raid gives no right to address someone."* It had stood
 * on the DEFENDER side of a standoff beside another principal and could not say a word to it
 * afterwards. A design review measured the same edge from the outside: `reachable_principals: 0` on
 * most observations, because the two rungs that existed — a live campaign, a live grant — are the two
 * rarest situations in the world.
 *
 * Each rung below is driven through the verb that produces its situation in a live world, and each
 * one is asserted in BOTH directions: that the tie makes the other principal addressable, and that a
 * principal with no tie — seated beside them, in the same constellation — is not. A reach rule that
 * only ever says yes would pass every "can they talk" test and would be an open directory, which A15
 * forbids; the no-tie bystander is what makes each yes a measurement.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import type { PrincipalId } from '../../src/core/types.js';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import { DIRECTORY_OFFER_FRESH_TICKS } from '../../src/say/directory.js';
import {
  MAX_REACH_ROWS,
  PARLEY_CONSTELLATION_MIN_COUNTERPARTIES,
  PARLEY_TIE_TICKS,
  REACH_RUNGS,
} from '../../src/say/reach.js';
import { raidWorld, runToFirstRaid } from '../predation/fixture.js';
import {
  SETTLEMENT,
  act,
  contactWorld,
  entitle,
  liveHaul,
  observe,
  parleyOffers,
  runTo,
  seatAt,
  tick,
} from './contact-fixture.js';

function reachWhy(runtime: Parameters<typeof observe>[0], from: PrincipalId, to: PrincipalId): string | null {
  return runtime.reachFor(from, runtime.engine.tick).find((r) => r.principal === to)?.why ?? null;
}

describe('★ a shared raid IS a right to address someone — while it is open and for two Reckonings after', () => {
  it('the defender beside you is reachable after the standoff resolves, and a bystander is not', () => {
    const w = raidWorld('reach-raid', 3);
    const runtime = w.runtime;
    const raid = runToFirstRaid(runtime);
    const target = raid.target;
    const [ally, bystander] = w.principals.filter((p) => p !== target);
    if (ally === undefined || bystander === undefined) throw new Error('three principals expected');

    entitle(runtime, ally);
    expect(act(runtime, ally, 'join', { raid: raid.id, side: 'DEFENDER' }), 'the ally joins the defence').toBeNull();
    runTo(runtime, raid.resolvesAtTick + 1);
    expect(runtime.raids.get(raid.id)?.state, 'the standoff must be over — this is about AFTER').not.toBe('DEMANDED');

    // ── THE DEFECT, CLOSED ────────────────────────────────────────────────────
    expect(
      reachWhy(runtime, ally, target),
      'the playtester\'s exact situation: it stood beside the target, the standoff ended, and it could not ' +
        'speak to the principal it had just defended',
    ).toBe('RAID');
    expect(reachWhy(runtime, target, ally), 'and the tie runs both ways').toBe('RAID');
    expect(
      act(runtime, ally, 'message', { to: target, act: 'offer', text: 'Held it together. Same terms next time?' }),
      'the letter must land',
    ).toBeNull();

    // ── THE NO-TIE BYSTANDER, WHICH IS WHAT MAKES THE YES A MEASUREMENT ───────
    expect(
      reachWhy(runtime, ally, bystander),
      'a principal seated at the same stage that took no side in the raid has no tie: standing near a ' +
        'standoff is not standing in it',
    ).toBeNull();
  });

  it('the tie lapses after PARLEY_TIE_TICKS, so reach tracks who you are dealing with now', () => {
    const w = raidWorld('reach-raid-lapse', 3);
    const runtime = w.runtime;
    const raid = runToFirstRaid(runtime);
    const [ally] = w.principals.filter((p) => p !== raid.target);
    if (ally === undefined) throw new Error('no ally');
    entitle(runtime, ally);
    expect(act(runtime, ally, 'join', { raid: raid.id, side: 'DEFENDER' })).toBeNull();
    runTo(runtime, raid.resolvesAtTick + 1);
    const resolved = runtime.raids.get(raid.id)?.resolvedAtTick;
    if (resolved === null || resolved === undefined) throw new Error('the raid did not resolve');

    runTo(runtime, resolved + PARLEY_TIE_TICKS - 1);
    expect(reachWhy(runtime, ally, raid.target), 'still inside the window').toBe('RAID');
    runTo(runtime, resolved + PARLEY_TIE_TICKS + 1);
    expect(
      reachWhy(runtime, ally, raid.target),
      `the raid tie must lapse at resolve + ${String(PARLEY_TIE_TICKS)} ticks — a licence that never expired ` +
        'would accumulate the way §9 refuses to let a war chest accumulate',
    ).toBeNull();
  });

  it('A15: a free identity that joins the free side gains the TIE and still cannot speak first', () => {
    const w = raidWorld('reach-raid-sybil', 2);
    const runtime = w.runtime;
    const raid = runToFirstRaid(runtime);
    const sybil = 'p:sybil01' as PrincipalId;
    runtime.seat(sybil, 'sybil01', w.stage);
    runtime.standing.open(sybil);
    tick(runtime);
    expect(act(runtime, sybil, 'join', { raid: raid.id, side: 'DEFENDER' }), 'DEFENDER is free').toBeNull();

    expect(reachWhy(runtime, sybil, raid.target), 'the situation is real, so reach is satisfied').toBe('RAID');
    const refusal = act(runtime, sybil, 'message', { to: raid.target, act: 'offer', text: 'pay me' });
    expect(refusal?.invariant, 'and the entitlement is what closes the free door').toBe('A15');
    expect(parleyOffers(runtime, sybil), 'the menu must offer it nobody').toHaveLength(0);
  });
});

describe('★ a venture you FINISHED together is a tie; a live one already has its own channel', () => {
  it('payer and filler reach each other after settlement, and not via VENTURE while it is live', () => {
    const PAYER = 'p:vpayer' as PrincipalId;
    const FILLER = 'p:vfiller' as PrincipalId;
    const BYSTANDER = 'p:vbystand' as PrincipalId;
    const w = contactWorld('reach-venture', [PAYER, FILLER, BYSTANDER]);
    const id = liveHaul(w, PAYER, FILLER);

    expect(
      reachWhy(w.runtime, FILLER, PAYER),
      'a LIVE venture is still shared — its channel is `message {venture}`, a MESSAGE that declassifies at ' +
        'settlement, and §3 keeps that word apart from PARLEY',
    ).not.toBe('VENTURE');

    runTo(w.runtime, SETTLEMENT + 1);
    const settled = w.runtime.ventures.require(id);
    expect(['SETTLED', 'DEFAULTED'], 'the HAUL must have bound and finished').toContain(settled.state);

    expect(reachWhy(w.runtime, PAYER, FILLER), 'the finished deal ties them').toBe('VENTURE');
    expect(reachWhy(w.runtime, FILLER, PAYER)).toBe('VENTURE');
    expect(
      act(w.runtime, FILLER, 'message', { to: PAYER, act: 'offer', text: 'Same lane tomorrow? I will escort.' }),
      'the filler was PAID, so it is entitled — and the tie lets it propose the next deal',
    ).toBeNull();
    expect(reachWhy(w.runtime, PAYER, BYSTANDER), 'and a principal that dealt with neither is not tied').toBeNull();
  });
});

describe('★ a syndicate seat is a tie', () => {
  it('a member reaches its fellow members, and a non-member beside them does not', () => {
    const FOUNDER = 'p:sfounder' as PrincipalId;
    const MEMBER = 'p:smember' as PrincipalId;
    const OUTSIDE = 'p:soutside' as PrincipalId;
    const w = contactWorld('reach-syndicate', [FOUNDER, MEMBER, OUTSIDE]);
    entitle(w.runtime, FOUNDER, 200_000);
    expect(act(w.runtime, FOUNDER, 'form', { name: 'Lantern House', admission: 'OPEN' })).toBeNull();
    const house = w.runtime.syndicates.of(FOUNDER, w.runtime.engine.tick)[0];
    if (house === undefined) throw new Error('form did not found a syndicate');
    expect(act(w.runtime, MEMBER, 'apply', { syndicate: house.id })).toBeNull();
    expect(w.runtime.syndicates.isMember(house.id, MEMBER, w.runtime.engine.tick)).toBe(true);

    expect(reachWhy(w.runtime, FOUNDER, MEMBER)).toBe('SYNDICATE');
    expect(reachWhy(w.runtime, MEMBER, FOUNDER)).toBe('SYNDICATE');
    expect(reachWhy(w.runtime, FOUNDER, OUTSIDE), 'a non-member seated beside them has no seat to share').toBeNull();
  });
});

describe('★ an offer is an invitation to be addressed — inside your own constellation', () => {
  it('an entitled principal reaches an advertiser near it, until the offer goes stale', () => {
    const ASKER = 'p:oasker' as PrincipalId;
    const SELLER = 'p:oseller' as PrincipalId;
    const w = contactWorld('reach-offer', [ASKER, SELLER]);
    entitle(w.runtime, ASKER);
    expect(reachWhy(w.runtime, ASKER, SELLER), 'no offer, no tie: nothing to answer').toBeNull();

    expect(act(w.runtime, SELLER, 'publish_offer', { text: 'HANDS FOR HIRE — 8% OF CARGO' })).toBeNull();
    expect(reachWhy(w.runtime, ASKER, SELLER)).toBe('OFFER');
    expect(
      act(w.runtime, ASKER, 'message', { to: SELLER, act: 'offer', text: 'Two hands, one HAUL, 8% as posted.' }),
    ).toBeNull();

    runTo(w.runtime, w.runtime.engine.tick + DIRECTORY_OFFER_FRESH_TICKS + 2);
    expect(
      reachWhy(w.runtime, ASKER, SELLER),
      'a stale advertisement invites nothing — and the asker wrote first, so no REPLY rung runs its way',
    ).toBeNull();
  });

  it('an advertiser in ANOTHER constellation is not reachable through its offer', () => {
    const ASKER = 'p:farasker' as PrincipalId;
    const w = contactWorld('reach-offer-far', [ASKER]);
    const home = w.runtime.world.map.systems.get(w.stage)?.constellation;
    const far = w.runtime.world.map.systemOrder.find((s) => w.runtime.world.map.systems.get(s)?.constellation !== home);
    if (far === undefined) throw new Error('the launch map has one constellation');
    const SELLER = 'p:farseller' as PrincipalId;
    seatAt(w, SELLER, far);
    tick(w.runtime);
    entitle(w.runtime, ASKER);
    expect(act(w.runtime, SELLER, 'publish_offer', { text: 'ALLOY, CHEAP' })).toBeNull();
    expect(
      reachWhy(w.runtime, ASKER, SELLER),
      'the rung is bounded by the MAP, not by the population: a constellation away is not near',
    ).toBeNull();
  });
});

describe('★ THE EARNED RUNG — your constellation, priced in STANDING', () => {
  const PAYER = 'p:epayer' as PrincipalId;
  const FIRST = 'p:efirst' as PrincipalId;
  const SECOND = 'p:esecond' as PrincipalId;
  const STRANGER = 'p:estranger' as PrincipalId;

  it(`opens at ${String(PARLEY_CONSTELLATION_MIN_COUNTERPARTIES)} distinct counterparties, and not at one`, () => {
    const w = contactWorld('reach-earned', [PAYER, FIRST, SECOND, STRANGER]);
    entitle(w.runtime, PAYER, 60_000);
    liveHaul(w, PAYER, FIRST);
    runTo(w.runtime, SETTLEMENT + 1);
    const one = w.runtime.standing.row(PAYER).distinctCounterparties;
    expect(one, 'one elective promise honoured to one counterparty').toBe(1);
    expect(
      reachWhy(w.runtime, PAYER, STRANGER),
      'ONE kept promise buys the right to speak first, not the whole constellation',
    ).toBeNull();
    expect(w.runtime.parleysFor(PAYER, w.runtime.engine.tick).constellation_reach.earned).toBe(false);

    liveHaul(w, PAYER, SECOND);
    runTo(w.runtime, 2 * TICKS_PER_RECKONING);
    expect(w.runtime.standing.row(PAYER).distinctCounterparties).toBe(2);
    expect(
      reachWhy(w.runtime, PAYER, STRANGER),
      'two DISTINCT counterparties honoured opens every seated principal in the constellation',
    ).toBe('CONSTELLATION');
    expect(w.runtime.parleysFor(PAYER, w.runtime.engine.tick).constellation_reach.earned).toBe(true);
    expect(
      act(w.runtime, PAYER, 'message', { to: STRANGER, act: 'offer', text: 'You keep to yourself. Work for me?' }),
    ).toBeNull();
    // The rung is the reader's record, never the recipient's: the stranger earned nothing.
    expect(reachWhy(w.runtime, STRANGER, PAYER), 'only the reply rung runs back').toBe('REPLY');
  });

  it('the cap on published rows never caps who is LEGAL — the 33rd principal is still addressable', () => {
    const w = contactWorld('reach-uncapped', [PAYER, FIRST, SECOND]);
    entitle(w.runtime, PAYER, 60_000);
    const crowd: PrincipalId[] = [];
    for (let n = 0; n < MAX_REACH_ROWS + 4; n += 1) {
      const p = `p:crowd${String(n).padStart(2, '0')}` as PrincipalId;
      seatAt(w, p, w.stage);
      crowd.push(p);
    }
    tick(w.runtime);
    liveHaul(w, PAYER, FIRST);
    runTo(w.runtime, SETTLEMENT + 1);
    liveHaul(w, PAYER, SECOND);
    runTo(w.runtime, 2 * TICKS_PER_RECKONING);
    const reach = w.runtime.reachFor(PAYER, w.runtime.engine.tick);
    expect(reach.length, 'the whole constellation is reachable').toBeGreaterThan(MAX_REACH_ROWS);
    const last = crowd[crowd.length - 1];
    if (last === undefined) throw new Error('no crowd');
    expect(
      act(w.runtime, PAYER, 'message', { to: last, act: 'offer', text: 'Last in line, first to ask.' }),
      'the first version capped the predicate at 32 rows and refused the 33rd while calling it reachable',
    ).toBeNull();
  });
});

describe('the rung ladder is published, in rank order', () => {
  it('names eight rungs, with REPLY first and the earned one last', () => {
    expect(REACH_RUNGS[0]).toBe('REPLY');
    expect(REACH_RUNGS[REACH_RUNGS.length - 1]).toBe('CONSTELLATION');
    expect(new Set(REACH_RUNGS).size).toBe(REACH_RUNGS.length);
    expect(REACH_RUNGS).toHaveLength(8);
  });
});
