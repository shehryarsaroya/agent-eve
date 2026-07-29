/**
 * ★ **THE PRICE OF A PARLEY, MEASURED RATHER THAN ARGUED (A15).**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * HARD RULE 5: *"every gate costs produced goods, slashable capital, or an independently-capitalised
 * counterparty — never 'acquire another account'."* An open channel is the purest test of it:
 * enrolment is free and must stay free (A8 depends on it), so if messaging is free and unbounded then
 * N free identities are N × the volume and broadcasting at everybody becomes correct for every agent.
 *
 * This file is the measurement, in the shape `test/market/endowment.test.ts` established for the
 * endowment: **enrol free identities into the most favourable world available and count what they may
 * do.** Every column must read zero, and the last of them must read zero *past the menu* — the probe
 * that found the original defect got in by hand-building a call the affordance never offered, so a
 * test that only checks the menu proves nothing.
 *
 * It also pins the two candidate prices that measurement **rejected**, because the record should show
 * what was tried: an action from the per-tick budget, and a posted bond.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../src/api/observe.js';
import type { EventId, PrincipalId } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';
import { storesAccount } from '../../src/ledger/index.js';
import { freeCash } from '../../src/market/escrow.js';
import { PARLEYS_PER_RECKONING } from '../../src/say/parley.js';
import { FREE_VERBS } from '../../src/tick/budget.js';
import type { Runtime } from '../../src/sim/runtime.js';
import { CAMPAIGN_JOIN_STAKE_MINOR } from '../../src/campaign/index.js';
import { CLAIM_BOND_MINOR } from '../../src/sovereignty/params.js';
import { act, campaignWorld, tick } from '../campaign/fixture.js';

const SYBILS = 10;

function observe(runtime: Runtime, principal: PrincipalId): ReturnType<typeof buildObservation> {
  return buildObservation({
    runtime,
    principal,
    serverNowMs: 0,
    fresh: true,
    wakesRemaining: 4,
    stale: false,
    corrections: [],
    correctionsDropped: 0,
    actionsRemaining: 4,
  });
}

function parleyOfferCount(runtime: Runtime, principal: PrincipalId): number {
  return observe(runtime, principal).affordances.filter(
    (a) => a.verb === 'message' && (a.params as Record<string, unknown>)['to'] !== undefined,
  ).length;
}

/**
 * A live war, plus `SYBILS` free identities seated into it.
 *
 * Enrolled **after** the campaign exists, which is the most favourable moment for a free identity:
 * every situation reach can read is already there. Nothing else is done to them — that is the claim
 * under test, that PLAYING buys reach and ENROLLING does not.
 */
function worldWithSybils(seed: string): {
  readonly w: ReturnType<typeof campaignWorld>;
  readonly campaign: string;
  readonly sybils: readonly PrincipalId[];
} {
  const w = campaignWorld(seed);
  expect(act(w.runtime, w.attacker, 'build', { kind: 'CAMPAIGN', system: w.objective })).toBeNull();
  const id = w.runtime.campaigns.liveAgainst(w.objective)?.id;
  if (id === undefined) throw new Error('no campaign');
  const sybils: PrincipalId[] = [];
  for (let n = 0; n < SYBILS; n += 1) {
    const p = `p:sybil${String(n).padStart(2, '0')}` as PrincipalId;
    // Seated at the OBJECTIVE deliberately: the most generous placement, inside the constellation
    // whose holders a belligerent may address. If reach were placement-based they would all qualify.
    w.runtime.seat(p, `sybil${String(n)}`, w.objective);
    w.runtime.standing.open(p);
    sybils.push(p);
  }
  tick(w.runtime);
  return { w, campaign: String(id), sybils };
}

describe('★ A15 — the price of a parley, measured', () => {
  it('ten free identities: zero reach, zero allowance, zero offers, zero accepted', () => {
    const { w, sybils } = worldWithSybils('parley-a15');

    // ── NON-VACUITY FIRST ─────────────────────────────────────────────────────
    //
    // A zero from a loop that never ran is the shape of `INV-22` reporting green over an empty
    // journal for this project's whole life. So: the identities exist, are seated, hold hands, and
    // sit in the very constellation a belligerent may address — and there IS a live war for them to
    // be reachable in. Only then is a zero a measurement.
    expect(sybils.length).toBe(SYBILS);
    for (const p of sybils) {
      expect(w.runtime.world.holdingByPrincipal.get(p), 'seated').not.toBeUndefined();
      expect(
        w.runtime.world.map.systems.get(w.objective)?.constellation,
        'seated in the objective constellation, which is the generous case',
      ).toBe(w.runtime.world.map.systems.get(w.objective)?.constellation);
    }
    expect(w.runtime.campaigns.live().length, 'there is a live war to be reachable in').toBe(1);
    expect(
      w.runtime.reachFor(w.attacker, w.runtime.engine.tick).length,
      'and the attacker CAN reach people, so the rule is not simply off',
    ).toBeGreaterThan(0);

    // ── THE MEASUREMENT ───────────────────────────────────────────────────────
    let reach = 0;
    let allowance = 0;
    let offers = 0;
    let accepted = 0;
    for (const p of sybils) {
      const capacity = w.runtime.parleysFor(p, w.runtime.engine.tick);
      reach += capacity.reachable_principals;
      allowance += capacity.parleys_per_reckoning;
      offers += parleyOfferCount(w.runtime, p);
      for (const target of [w.attacker, w.defender, w.ally, ...sybils.filter((s) => s !== p)]) {
        // PAST THE MENU, BY HAND. The original defect was found exactly this way.
        if (act(w.runtime, p, 'message', { to: target, act: 'offer', text: 'PAY ME TO STAND DOWN' }) === null) {
          accepted += 1;
        }
      }
    }

    expect(reach, `${String(SYBILS)} free identities may address somebody`).toBe(0);
    expect(allowance, 'free identities hold parley allowance').toBe(0);
    expect(offers, 'the menu offered a free identity somebody to address').toBe(0);
    expect(
      accepted,
      'THE ENGINE ACCEPTED A PARLEY FROM A FREE IDENTITY. Reach and the entitlement are the whole A15 argument: ' +
        'if either can be walked past by hand, N enrolments buy N x the message volume and broadcasting at ' +
        'everybody becomes the correct play.',
    ).toBe(0);
  });

  it('a free identity that joins the DEFENDER side for free gains reach and STILL cannot speak', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THE HOLE REACH ALONE DOES NOT CLOSE, AND IT IS THE REASON THERE ARE TWO GATES.**
    //
    // `join {side:"DEFENDER"}` is FREE and needs only a seat — §16.6 MUST-9 makes it free on purpose,
    // because pricing the act of helping somebody hold their home would make the aggressor's side the
    // cheaper one to be on. So a free identity CAN put itself on a roster and inherit a
    // constellation's worth of reach for nothing. A reach-only design would be A15-unpriced through a
    // door another axiom holds open.
    // ══════════════════════════════════════════════════════════════════════════
    const { w, campaign, sybils } = worldWithSybils('parley-freedoor');
    const sybil = sybils[0];
    if (sybil === undefined) throw new Error('no sybil');

    expect(
      w.runtime.campaignJoinRefusalFor(sybil, campaign as never, 'DEFENDER', w.runtime.engine.tick),
      'the free side must genuinely be open to a free identity, or this test proves nothing',
    ).toBeNull();
    expect(act(w.runtime, sybil, 'join', { campaign, side: 'DEFENDER', system: w.objective })).toBeNull();

    const capacity = w.runtime.parleysFor(sybil, w.runtime.engine.tick);
    expect(
      capacity.reachable_principals,
      'it is now standing in the war, so REACH is satisfied — that is the door being open',
    ).toBeGreaterThan(0);
    expect(
      capacity.parleys_per_reckoning,
      'and the ENTITLEMENT is what closes it. Zero, because it has honoured no elective promise and nobody has ' +
        'paid it anything: enrolment mints capital it cannot transfer, and that counts for nothing here.',
    ).toBe(0);
    expect(parleyOfferCount(w.runtime, sybil), 'the menu must offer it nobody').toBe(0);
    const refusal = act(w.runtime, sybil, 'message', { to: w.attacker, act: 'offer', text: 'pay me' });
    expect(refusal?.invariant).toBe('A15');
    expect(
      refusal?.hint,
      'and the sentence must name the price as a DEAL, never another account',
    ).toMatch(/elective promise|paid you/);
  });

  it('the entitlement reads `freeCash`, never `freeBalance` — the endowment buys nothing', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THE MUTATION THIS FILE EXISTS TO CATCH.** Swap `freeCash` for `freeBalance` in
    // `parleyEntitlementOf` and every assertion above still passes *except* this one: a fresh
    // identity's raw unlocked balance is the whole `STARTER_STAKE`, so `freeBalance > 0` would entitle
    // every free identity in the world. D7's own note records the same field confusion costing the
    // market its entire buy side.
    // ══════════════════════════════════════════════════════════════════════════
    const { w, sybils } = worldWithSybils('parley-freecash');
    const sybil = sybils[0];
    if (sybil === undefined) throw new Error('no sybil');

    const raw = w.runtime.ledger.freeBalance(storesAccount(sybil));
    expect(
      raw,
      'a fresh identity holds a real unlocked balance — this is the number the wrong field would read',
    ).toBeGreaterThan(0);
    expect(
      freeCash(w.runtime.ledger, sybil),
      'and zero transferable currency, because the endowment is withheld in full (D7 property 1)',
    ).toBe(0);
    expect(
      w.runtime.parleysFor(sybil, w.runtime.engine.tick).earned_minor,
      'the published term must be the transferable figure. If this equals `freeBalance`, the gate is priced in ' +
        'identities and every assertion in this file about free identities is a lie.',
    ).toBe(0);
    expect(w.runtime.parleysFor(sybil, w.runtime.engine.tick).parleys_per_reckoning).toBe(0);
  });

  it('a posted bond does NOT buy the right to speak — which is why the bond is not the price', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // A15 permits **slashable capital** as a gate, so a bond looks like a legal price. Measurement
    // rules it out rather than taste: `post_bond` charges `freeBalance`, not `freeCash`, so a bond is
    // postable **straight out of the withheld endowment**. A bond-priced channel would therefore be a
    // gate a free identity pays with money the world handed it — and this test is the proof, because
    // it posts one successfully from an identity that has earned nothing.
    // ══════════════════════════════════════════════════════════════════════════
    const { w, sybils } = worldWithSybils('parley-bond');
    const sybil = sybils[0];
    if (sybil === undefined) throw new Error('no sybil');

    expect(
      act(w.runtime, sybil, 'post_bond', { amount: CLAIM_BOND_MINOR }),
      'a free identity CAN post slashable capital out of its endowment — that is the finding',
    ).toBeNull();
    expect(w.runtime.bondView(sybil).posted, 'and the bond is real').toBe(CLAIM_BOND_MINOR);
    expect(
      w.runtime.parleysFor(sybil, w.runtime.engine.tick).parleys_per_reckoning,
      'so the bond must buy nothing here, or A15 is defeated through a field name',
    ).toBe(0);
  });

  it('standing alone opens it — one kept elective promise, with `freeCash` still zero', () => {
    // The other disjunct, so both halves of the entitlement are exercised rather than only the one
    // the fixture happens to fund. This is HARD RULE 5's third price verbatim: an
    // independently-capitalised counterparty. `StandingBook.apply` is the only writer of standing
    // (INV-21) and it HALTS on a self-credit, so this cannot be farmed by dealing with yourself
    // (scar #9).
    const { w, sybils } = worldWithSybils('parley-standing');
    const sybil = sybils[0];
    if (sybil === undefined) throw new Error('no sybil');
    expect(act(w.runtime, sybil, 'join', { campaign: w.runtime.campaigns.live()[0]?.id, side: 'DEFENDER', system: w.objective })).toBeNull();
    expect(w.runtime.parleysFor(sybil, w.runtime.engine.tick).parleys_per_reckoning).toBe(0);

    // No tick afterwards: a synthetic journal entry cites no real event and INV-21 would rightly
    // halt on it. Same discipline as `test/api/observe-gate3.test.ts`.
    w.runtime.standing.apply({
      tick: w.runtime.engine.tick,
      credits: [
        {
          delta: {
            cause: 'ELECTIVE_HONOURED',
            principal: sybil,
            counterparty: w.ally,
            venture: 'v:parley-standing' as never,
            electiveHonoured: 1,
            electiveHonouredValue: minor(900),
            defaults: 0,
            defaultedValue: minor(0),
            actedBy: null,
            boundByGrant: null,
          },
          eventId: 'ev:test:parley-honoured' as EventId,
        },
      ],
      charges: [],
    });

    const capacity = w.runtime.parleysFor(sybil, w.runtime.engine.tick);
    expect(capacity.distinct_counterparties, 'one counterparty, honoured').toBe(1);
    expect(capacity.earned_minor, 'and still not a penny anybody paid it').toBe(0);
    expect(
      capacity.parleys_per_reckoning,
      'a kept elective promise with somebody who is not you is the price, and it is payable by playing',
    ).toBe(PARLEYS_PER_RECKONING);
    expect(parleyOfferCount(w.runtime, sybil), 'and the menu now names somebody').toBeGreaterThan(0);
  });

  it('an action from the per-tick budget is NOT the price, and `message` stays free', () => {
    // The other rejected candidate, pinned. A3 makes actions the scarce resource, so charging one
    // looks right — but `FREE_VERBS`' own note says charging for talk starves the receipt reel (§14),
    // and the A15 arithmetic does not work anyway: a per-tick budget is per-IDENTITY, so N enrolments
    // buy N budgets and the Sybil is untouched. This asserts the decision rather than describing it.
    expect(
      FREE_VERBS.has('message'),
      '`message` must stay free of the action budget. If this flips, §14\'s receipt reel is being metered and ' +
        'the A15 argument has been replaced with one that does not hold.',
    ).toBe(true);
    const { w } = worldWithSybils('parley-free');
    const offer = observe(w.runtime, w.attacker).affordances.find(
      (a) => a.verb === 'message' && (a.params as Record<string, unknown>)['to'] !== undefined,
    );
    expect(offer?.cost, 'and the menu must publish it as free, or the two surfaces disagree (scar #1)').toBe(0);
  });

  it('the allowance is bounded by what OTHER principals spent, so a reply path is not a free channel', () => {
    // The structural half of the reply argument: an unentitled principal's whole allowance is the
    // number of people waiting on it, which no identity of its own can raise. Ten free identities
    // addressing each other must produce zero volume.
    const { w, sybils } = worldWithSybils('parley-reply-bound');
    let accepted = 0;
    for (const from of sybils) {
      for (const to of sybils) {
        if (from === to) continue;
        if (act(w.runtime, from, 'message', { to, act: 'offer', text: 'reply to me' }) === null) accepted += 1;
      }
    }
    expect(
      accepted,
      'free identities cannot bootstrap a conversation among themselves: the reply allowance is funded only by a ' +
        'principal that already paid the cold-outreach price, so N enrolments buy N x 0',
    ).toBe(0);
    expect(
      w.runtime.parleysFor(sybils[0] as PrincipalId, w.runtime.engine.tick).awaiting_your_reply,
      'and nobody is waiting on any of them',
    ).toBe(0);
  });

  it('⚑ NEITHER `join` side is A15-priced — the ATTACKER stake is payable from the endowment too', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THIS ASSERTION WAS WRITTEN THE OTHER WAY ROUND AND MEASUREMENT REVERSED IT.**
    //
    // It expected the paid side to be refused to a free identity — `A7`, "you have 0 free" — which
    // would have made the free-DEFENDER door the only unpriced one. It is not: `joinRefusal` sizes the
    // stake against `port.freeStoresOf`, which is **raw free stores**, and a fresh identity holds the
    // whole `STARTER_STAKE` unlocked. `CAMPAIGN_JOIN_STAKE_MINOR` is a tenth of the campaign bond, so
    // a free identity can buy its way onto the ATTACKER roster as well.
    //
    // Recorded rather than fixed: `src/campaign/` is another agent's lane this round, and it is not
    // obviously a defect there — MUST-9's asymmetry is about attacker *risk*, and endowment locked in
    // a forfeitable stake is genuinely at risk. What it means for THIS file is the load-bearing part:
    // **reach cannot be the only gate, because every door into a campaign is payable by an identity
    // that has earned nothing.** The entitlement is what carries A15 here, and the two tests above are
    // the proof for both doors rather than one.
    // ══════════════════════════════════════════════════════════════════════════
    const { w, campaign, sybils } = worldWithSybils('parley-attackside');
    const sybil = sybils[0];
    if (sybil === undefined) throw new Error('no sybil');
    expect(CAMPAIGN_JOIN_STAKE_MINOR, 'the paid side does cost something').toBeGreaterThan(0);
    expect(
      w.runtime.campaignJoinRefusalFor(sybil, campaign as never, 'ATTACKER', w.runtime.engine.tick),
      'and a free identity can pay it out of the endowment — so REACH is buyable on either side',
    ).toBeNull();
    expect(act(w.runtime, sybil, 'join', { campaign, side: 'ATTACKER', system: w.objective })).toBeNull();

    const capacity = w.runtime.parleysFor(sybil, w.runtime.engine.tick);
    expect(capacity.reachable_principals, 'reach is now open to it on the ATTACKER side').toBeGreaterThan(0);
    expect(
      capacity.parleys_per_reckoning,
      'and it still may not speak. This is the whole two-gate argument in one assertion.',
    ).toBe(0);
    expect(act(w.runtime, sybil, 'message', { to: w.defender, act: 'offer', text: 'stand down' })?.invariant).toBe(
      'A15',
    );
  });
});
