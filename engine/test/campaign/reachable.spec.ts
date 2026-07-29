/**
 * ★ **Campaigns are reachable from the affordance menu, and the verb accepts what the menu said.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `test/combat/reachable.spec.ts` is the worked example of this pattern and this file copies it
 * deliberately. The assertion at the end is **not** *"the campaign resolved"* — `pulse.spec.ts`
 * covers that — but *"the menu offered it, and the verb accepted the exact params the menu
 * published."* That is the weaker claim and it is the one that was false for nine mechanics at once,
 * `grant` and the whole A6 core loop among them.
 *
 * It exists because **the cast has no campaign branch**: `src/cast/heuristic.ts` is owned by another
 * agent this round and cannot be touched, so `test/api/agt-r5-reachability.test.ts` — which sweeps a
 * live world and asks *"is every live verb offered somewhere"* — cannot enter the state a campaign
 * needs. This file is the handoff: it drives `build {kind:"ANCHOR"}` → `build {kind:"CAMPAIGN"}` →
 * `join` → `withdraw` through the real verb table, and the cast hook is reported as a named list of
 * calls rather than written.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../src/api/observe.js';
import type { PrincipalId } from '../../src/core/types.js';
import { Runtime } from '../../src/sim/runtime.js';
import {
  CAMPAIGN_BOND_MINOR,
  CAMPAIGN_JOIN_STAKE_MINOR,
  MATERIEL_GOOD,
  PULSE_MATERIEL_QTY,
} from '../../src/campaign/index.js';
import { act, campaignWorld } from './fixture.js';

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

function offersOf(
  runtime: Runtime,
  principal: PrincipalId,
  verb: string,
  key?: string,
  value?: unknown,
): readonly ReturnType<typeof observe>['affordances'][number][] {
  return observe(runtime, principal).affordances.filter(
    (a) =>
      a.verb === verb &&
      (key === undefined || (a.params as Record<string, unknown>)[key] === value),
  );
}

describe('★ campaigns are reachable from the affordance menu', () => {
  it('offers `build {kind:"CAMPAIGN"}` to a principal one lane from a live claim, with the materiel there', () => {
    const w = campaignWorld('camp-reach-declare');
    const offers = offersOf(w.runtime, w.attacker, 'build', 'kind', 'CAMPAIGN');

    expect(
      offers.length,
      'a principal whose holding stands one lane from a SUPPLIED claim, holding the bond and the first ' +
        "pulse's materiel at its own system, must be offered `build {kind:\"CAMPAIGN\"}`. Asserting on the " +
        'KIND rather than the verb matters: `build` also raises a WORKS, an ANCHOR and a HULL, so "build is ' +
        'offered" would pass on a menu that never mentions a war.',
    ).toBeGreaterThan(0);

    const offer = offers[0];
    if (offer === undefined) throw new Error('no campaign offer');
    expect(offer.params['system'], 'the offer must name the OBJECTIVE, not the depot').toBe(w.objective);
    expect(
      offer.max_direct_loss,
      'the bond IS the worst case, exactly. EXPOSURE is Σ open max_direct_loss and nothing else (§3), and a ' +
        'campaign whose menu understated its bond would be A6\'s preview rule broken on the largest single ' +
        'commitment in the game.',
    ).toBe(CAMPAIGN_BOND_MINOR);
    expect(
      offer.what_it_forecloses,
      'the recurring MATERIEL cost has to be in the foreclosure text: it is the whole of §16.6 MUST-5 and the ' +
        'one thing an agent cannot discover by declaring.',
    ).toContain(String(PULSE_MATERIEL_QTY));
    expect(offer.what_it_forecloses).toContain(MATERIEL_GOOD);

    // ── AND THE OFFER MUST BE TAKEABLE ────────────────────────────────────────
    //
    // The half that makes this a handoff test and not just a menu test. An affordance the handler
    // refuses costs an agent a real action and its trust in the menu (AGT-S2), which is why
    // `campaignDeclareRefusalFor` is ONE function called by both rather than two that agree today.
    const accepted = act(w.runtime, w.attacker, 'build', offer.params);
    expect(
      accepted,
      `the affordance the menu published was refused by the verb: ${accepted?.hint ?? ''}. The gate is one ` +
        'function precisely so this cannot happen.',
    ).toBeNull();
    const live = w.runtime.campaigns.liveAgainst(w.objective);
    expect(live, 'the accepted act must have produced a live campaign row').not.toBeNull();
    expect(live?.attacker).toBe(w.attacker);
    expect(live?.defender).toBe(w.defender);
    expect(live?.depot, "the depot is derived from the attacker's own body, never named").toBe(w.depot);
    expect(live?.state, 'a campaign is MASSING until its first pulse — the published notice').toBe('MASSING');
  });

  it('offers `join` on both sides to a bystander, DEFENDER first, and the verb accepts either', () => {
    const w = campaignWorld('camp-reach-join');
    expect(act(w.runtime, w.attacker, 'build', { kind: 'CAMPAIGN', system: w.objective })).toBeNull();
    const id = w.runtime.campaigns.liveAgainst(w.objective)?.id;
    if (id === undefined) throw new Error('no campaign');

    const joins = offersOf(w.runtime, w.ally, 'join', 'campaign', id);
    expect(joins.length, 'a bystander must be offered both sides of a live campaign').toBe(2);
    // The first offer of a verb is what survives truncation and what a blind copier takes
    // (`api/observe.ts`'s `firstOfEachVerb` ordering), so the free side must be first: a copier must
    // not lock capital it did not understand it was risking.
    expect(
      joins[0]?.params['side'],
      'DEFENDER must be the first `join` offered. The first offer of each verb sorts ahead of every repeat ' +
        'and is what an agent copying its menu takes, and the ATTACKER side costs capital.',
    ).toBe('DEFENDER');
    expect(joins[0]?.max_direct_loss, 'defending costs nothing (§16.6 MUST-9)').toBe(0);
    const attackSide = joins.find((a) => a.params['side'] === 'ATTACKER');
    expect(attackSide?.max_direct_loss, 'a co-belligerent risks its own stake').toBe(CAMPAIGN_JOIN_STAKE_MINOR);

    const accepted = act(w.runtime, w.ally, 'join', attackSide?.params ?? {});
    expect(accepted, `the published join was refused: ${accepted?.hint ?? ''}`).toBeNull();
    expect(w.runtime.campaigns.require(id).parties.map((p) => p.principal)).toEqual([w.ally]);
    expect(w.runtime.campaigns.require(id).parties[0]?.side).toBe('ATTACKER');

    // And the offer is gone once taken. An affordance still on the menu after it has been used is an
    // action an agent spends on a refusal every wake for the rest of the war.
    expect(offersOf(w.runtime, w.ally, 'join', 'campaign', id).length).toBe(0);
  });

  it('offers `withdraw {campaign}` to the attacker only, and the verb accepts it', () => {
    const w = campaignWorld('camp-reach-lift');
    expect(act(w.runtime, w.attacker, 'build', { kind: 'CAMPAIGN', system: w.objective })).toBeNull();
    const id = w.runtime.campaigns.liveAgainst(w.objective)?.id;
    if (id === undefined) throw new Error('no campaign');

    expect(
      offersOf(w.runtime, w.defender, 'withdraw', 'campaign', id).length,
      'a defender may not lift somebody else\'s war. What ends it for the defender is standing, or ceding the ' +
        'claim — which ends it MOOT.',
    ).toBe(0);

    const lifts = offersOf(w.runtime, w.attacker, 'withdraw', 'campaign', id);
    expect(lifts.length, 'the declarer must be able to see the way out (§16.6 MUST-13)').toBe(1);
    const lift = lifts[0];
    if (lift === undefined) throw new Error('no lift offer');
    expect(
      lift.max_direct_loss,
      'the loss on a lift is the FORFEIT half, not the whole bond: the salvage comes back, and a menu that ' +
        'quoted the whole bond would make triage look identical to losing.',
    ).toBeLessThan(CAMPAIGN_BOND_MINOR);
    expect(lift.max_direct_loss).toBeGreaterThan(0);

    const accepted = act(w.runtime, w.attacker, 'withdraw', lift.params);
    expect(accepted, `the published lift was refused: ${accepted?.hint ?? ''}`).toBeNull();
    expect(w.runtime.campaigns.require(id).state).toBe('LIFTED');
  });

  it('offers nothing campaign-shaped to a principal with no adjacent claim, and SAYS SO', () => {
    // The negative half, and it is not decoration: a menu offering a campaign with no reachable
    // objective would cost an agent an action every wake, which is the same harm as not offering it
    // at all with the sign flipped.
    const w = campaignWorld('camp-reach-silent');
    expect(offersOf(w.runtime, w.defender, 'build', 'kind', 'CAMPAIGN').length).toBe(0);

    const withheld = observe(w.runtime, w.defender).header.withheld as {
      readonly verbs: readonly string[];
      readonly reason: string;
    };
    expect(
      withheld.verbs,
      'the absence must be ACCOUNTED FOR, per verb. `withheld` closes with "nothing you were eligible for has ' +
        'been dropped without this count", and that promise was measured false once — `trade` was silent in ' +
        '497 of 576 observations with a reachable venue in every one.',
    ).toContain('build');
    expect(withheld.reason).toMatch(/CAMPAIGN/);
    expect(
      withheld.reason,
      'the sentence must name which of the three walls was hit, or an agent cannot act on it',
    ).toMatch(/ONE LANE|COMMONS|holding/);
  });

  it('refuses a Commons objective as INVALID, not merely unavailable (§16.6 MUST-1, A8)', () => {
    // A8 is the one absolute in §16.6, and the refusal has to say INVALID rather than "not right now":
    // an agent told a Commons campaign is unavailable will keep trying, and the sentence is the only
    // thing that tells it nothing will ever make it legal. `CMP-1` then halts the world over a row
    // at either end, so this asserts the gate keeps the row from existing at all.
    const w = campaignWorld('camp-reach-commons');
    const commons = w.runtime.world.map.systemOrder.find(
      (s) => w.runtime.world.map.systems.get(s)?.tier === 'COMMONS',
    );
    if (commons === undefined) throw new Error('the launch map has no COMMONS system');

    const refusal = w.runtime.campaignDeclareRefusalFor(w.attacker, commons, w.runtime.engine.tick);
    expect(refusal, 'a Commons objective must be refused').not.toBeNull();
    expect(refusal?.invariant).toBe('A8');
    expect(
      refusal?.hint,
      'the word INVALID is load-bearing: A8 makes hostile action in the Commons invalid rather than punished, ' +
        'and an agent told "unavailable" will keep spending actions finding out.',
    ).toMatch(/INVALID/);

    expect(act(w.runtime, w.attacker, 'build', { kind: 'CAMPAIGN', system: commons })).not.toBeNull();
    expect(w.runtime.campaigns.size(), 'no row may exist at all').toBe(0);
  });
});
