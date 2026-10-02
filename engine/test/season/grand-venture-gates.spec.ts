/**
 * THE GRAND VENTURE's gates and its treasurer (SPEC §7.6, A6, A15).
 *
 * Two halves. **What it costs to contest** — every gate refuses with the engine's own sentence, and
 * the menu offers exactly what the verb accepts (AGT-S2). **Who stated each share** — a treasurer
 * electing under a grant is named on the season's record beside the creator whose defaults they are,
 * and a creator that restates in its own name takes the treasurer's name off that share (A5′: the
 * record names who actually acted, never a guess).
 */

import { describe, expect, it } from 'vitest';
import type { PrincipalId } from '../../src/core/types.js';
import { IN_FULL } from '../../src/venture/index.js';
import { GRAND_ROLE_STAKE_MINOR, finaleTickOf } from '../../src/season/index.js';
import {
  WINDOW,
  act,
  finaleWorld,
  formCandidate,
  grandVentures,
  observe,
  runTo,
  submit,
  tick,
} from './fixture.js';

const P = (s: string): PrincipalId => `p:${s}` as PrincipalId;

describe('a treasurer under a grant (A6) — the record names who stated each share', () => {
  it('the creator forms it itself; its treasurer elects the crew to nothing; the defaults are the creator’s, the statements the treasurer’s', () => {
    const creator = P('captain');
    const treasurer = P('purser');
    const crew = [P('mate'), P('bosun'), P('cook'), P('hand')];
    const w = finaleWorld('gv-treasurer', [creator, treasurer, ...crew]);
    tick(w.runtime);
    const id = formCandidate(w, { creator, crew });
    expect(w.runtime.ventures.require(id).actedBy).toBeNull();
    const ceiling = w.runtime.grandElectiveCeiling(1);
    expect(
      act(w.runtime, creator, 'grant', {
        to: treasurer,
        template: 'treasury-hand',
        max_direct_loss: 0,
        max_contingent_liability: ceiling,
        expires_tick: finaleTickOf(1) + 1,
      }),
    ).toBeNull();
    for (const role of w.runtime.ventures.require(id).roles) {
      submit(w.runtime, treasurer, 'elect', { venture: id, role: role.index, election: 0 }, role.index);
    }
    tick(w.runtime);
    runTo(w.runtime, finaleTickOf(1));
    const record = w.runtime.seasons.last();
    expect(record?.grand.outcome).toBe('BROKEN');
    expect(record?.grand.formedBy).toBeNull();
    expect(record?.grand.crew.map((c) => c.electedBy)).toEqual([treasurer, treasurer, treasurer, treasurer]);
    expect(w.runtime.standing.row(creator).defaults).toBe(4);
    expect(w.runtime.standing.row(treasurer).defaults).toBe(0);
  });

  it('and when the creator restates in its own name, the treasurer’s name comes off that share', () => {
    const creator = P('captain2');
    const treasurer = P('purser2');
    const crew = [P('mate2'), P('bosun2'), P('cook2'), P('hand2')];
    const w = finaleWorld('gv-restate', [creator, treasurer, ...crew]);
    tick(w.runtime);
    const id = formCandidate(w, { creator, crew });
    expect(
      act(w.runtime, creator, 'grant', {
        to: treasurer,
        template: 'treasury-hand',
        max_direct_loss: 0,
        max_contingent_liability: w.runtime.grandElectiveCeiling(1),
        expires_tick: finaleTickOf(1) + 1,
      }),
    ).toBeNull();
    for (const role of w.runtime.ventures.require(id).roles) {
      submit(w.runtime, treasurer, 'elect', { venture: id, role: role.index, election: 0 }, role.index);
    }
    tick(w.runtime);
    // The creator overrules its treasurer on role 0 and pays it.
    expect(act(w.runtime, creator, 'elect', { venture: id, role: 0, election: IN_FULL })).toBeNull();
    runTo(w.runtime, finaleTickOf(1));
    const crewLines = w.runtime.seasons.last()?.grand.crew ?? [];
    expect(crewLines[0]?.electedBy).toBeNull();
    expect(crewLines[0]?.paidMinor).toBe(crewLines[0]?.dueMinor);
    expect(crewLines.slice(1).every((c) => c.electedBy === treasurer && c.paidMinor === 0)).toBe(true);
  });
});

describe('what it costs to contest — every gate refuses with the engine’s own sentence', () => {
  it('refuses a grand create before the FINALE, on the wrong stage, as the wrong kind, or with terms', () => {
    const p = P('early');
    // A Reckoning early: the announcement is public, the window is not open.
    const w = finaleWorld('gv-refuse-early', [p], { firstTick: WINDOW.opens_tick - 300 });
    tick(w.runtime);
    expect(act(w.runtime, p, 'create', { kind: 'BUILD', stage: w.stage, grand: true })?.invariant).toBe('A14');
    runTo(w.runtime, WINDOW.opens_tick);
    const elsewhere = [...w.runtime.world.map.systemOrder].find((s) => s !== w.stage) ?? w.stage;
    expect(act(w.runtime, p, 'create', { kind: 'BUILD', stage: elsewhere, grand: true })?.invariant).toBe('A2');
    expect(act(w.runtime, p, 'create', { kind: 'HAUL', stage: w.stage, grand: true })?.invariant).toBe('PROP-V6');
    expect(
      act(w.runtime, p, 'create', { kind: 'BUILD', stage: w.stage, grand: true, value: 1_000_000 })?.invariant,
    ).toBe('PROP-V5');
    expect(act(w.runtime, p, 'create', { kind: 'BUILD', stage: w.stage, grand: 'yes' })?.invariant).toBe('A2');
    expect(grandVentures(w.runtime)).toHaveLength(0);
  });

  it('refuses a grand create after the last tick that still settles at the FINALE', () => {
    const p = P('late');
    const w = finaleWorld('gv-refuse-late', [p], { firstTick: WINDOW.closes_tick - 2 });
    runTo(w.runtime, WINDOW.closes_tick);
    expect(act(w.runtime, p, 'create', { kind: 'BUILD', stage: w.stage, grand: true })?.invariant).toBe('A14');
  });

  it('refuses a fresh identity as creator: its earned cash is exactly zero (A15)', () => {
    const fresh = P('newkey');
    const w = finaleWorld('gv-refuse-fresh', [fresh], { cash: 0 });
    tick(w.runtime);
    const refused = act(w.runtime, fresh, 'create', { kind: 'BUILD', stage: w.stage, grand: true });
    expect(refused?.invariant).toBe('A15');
    expect(refused?.hint).toContain('EARNED cash');
  });

  it('refuses a fill from a hand that is not at the stage, a stake under the floor, and a stake the endowment would pay', () => {
    const creator = P('owner');
    const away = P('away');
    const poor = P('poor');
    const w = finaleWorld('gv-refuse-fill', [creator, poor]);
    w.runtime.seat(away, 'away');
    w.runtime.standing.open(away);
    tick(w.runtime);
    expect(act(w.runtime, creator, 'create', { kind: 'BUILD', stage: w.stage, grand: true })).toBeNull();
    const id = grandVentures(w.runtime)[0]?.id;
    if (id === undefined) throw new Error('no candidate');
    tick(w.runtime);
    const awayHand = [...w.runtime.world.hands.values()].find((h) => h.principal === away)?.id;
    expect(
      act(w.runtime, away, 'fill_role', { venture: id, role: 0, hand: awayHand, stake: 20_000 })?.invariant,
    ).toBe('INV-9');
    const poorHand = [...w.runtime.world.hands.values()].find(
      (h) => h.principal === poor && h.location === w.stage,
    )?.id;
    expect(
      act(w.runtime, poor, 'fill_role', { venture: id, role: 0, hand: poorHand, stake: 1_000 })?.invariant,
    ).toBe('A15');
    // 300,000 is inside the balance (the endowment plus the earned 200,000) and outside the earned part.
    expect(
      act(w.runtime, poor, 'fill_role', { venture: id, role: 0, hand: poorHand, stake: 300_000 })?.hint,
    ).toContain('EARNED cash');
  });

  it('refuses a principal standing in two crews at once', () => {
    const w = finaleWorld('gv-refuse-two', [P('xa'), P('xb'), P('ya')]);
    tick(w.runtime);
    expect(act(w.runtime, P('xa'), 'create', { kind: 'BUILD', stage: w.stage, grand: true })).toBeNull();
    expect(act(w.runtime, P('ya'), 'create', { kind: 'BUILD', stage: w.stage, grand: true })).toBeNull();
    const first = grandVentures(w.runtime).find((v) => v.creator === P('xa'));
    const second = grandVentures(w.runtime).find((v) => v.creator === P('ya'));
    if (first === undefined || second === undefined) throw new Error('two candidates were not formed');
    const hands = [...w.runtime.world.hands.values()]
      .filter((h) => h.principal === P('xb') && h.state === 'IDLE' && h.location === w.stage)
      .map((h) => h.id);
    expect(act(w.runtime, P('xb'), 'fill_role', { venture: first.id, role: 0, hand: hands[0], stake: 10_000 })).toBeNull();
    // The same principal, a second hand, the other crew: refused, while both are still forming.
    expect(
      act(w.runtime, P('xb'), 'fill_role', { venture: second.id, role: 0, hand: hands[1], stake: 10_000 })?.invariant,
    ).toBe('A15');
    // And a crew member may not open a third.
    expect(act(w.runtime, P('xb'), 'create', { kind: 'BUILD', stage: w.stage, grand: true })?.invariant).toBe('A15');
  });

  it('offers the grand create and fill only to a principal the verb would accept, priced at the worst case', () => {
    const creator = P('offeree');
    const w = finaleWorld('gv-offer', [creator, P('joiner')]);
    tick(w.runtime);
    const offer = observe(w.runtime, creator).affordances.find(
      (a) => a.verb === 'create' && a.params['grand'] === true,
    );
    expect(offer?.params).toEqual({ kind: 'BUILD', stage: w.stage, grand: true });
    expect(offer?.max_direct_loss).toBe(0);
    expect(offer?.max_contingent_liability).toBe(w.runtime.grandElectiveCeiling(1));
    // Taken verbatim, it is accepted.
    expect(act(w.runtime, creator, 'create', offer?.params ?? {})).toBeNull();
    tick(w.runtime);
    const fill = observe(w.runtime, P('joiner')).affordances.find(
      (a) => a.verb === 'fill_role' && grandVentures(w.runtime).some((v) => v.id === a.params['venture']),
    );
    expect(fill?.params['stake']).toBe(GRAND_ROLE_STAKE_MINOR);
    expect(act(w.runtime, P('joiner'), 'fill_role', fill?.params ?? {})).toBeNull();
    // A fresh identity is offered neither, and the create is COUNTED as withheld with its reason.
    const w2 = finaleWorld('gv-offer-fresh', [P('broke')], { cash: 0 });
    tick(w2.runtime);
    const o2 = observe(w2.runtime, P('broke'));
    expect(o2.affordances.some((a) => a.verb === 'create' && a.params['grand'] === true)).toBe(false);
    const withheld = o2.header['withheld'] as { readonly count: number; readonly verbs: readonly string[]; readonly reason: string };
    expect(withheld.verbs).toContain('create');
    expect(withheld.reason).toContain('EARNED cash');
    expect(withheld.count).toBeGreaterThan(0);
  });
});
