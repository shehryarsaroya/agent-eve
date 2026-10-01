/**
 * THE GRAND VENTURE (SPEC §7.6), end to end: announce → form → contest → settle → record.
 *
 * Four stories, each one the engine's own arithmetic rather than a mock of it:
 *
 *   1. **Announced from the season's first tick** — where, when, what it pays and what it costs, in
 *      every agent's `header.season` (A2) and before anything can be done about it.
 *   2. **A clean cooperative FINALE** — a crew forms at the Frontier stage, carries the yield, and the
 *      creator pays every share: the record reads KEPT.
 *   3. **A betrayal through a grant** — a delegate forms the grand venture in its grantor's name under
 *      a mandate whose worst case the grantor was shown, then elects the crew's shares down to nothing
 *      inside the LIMITS. The grantor defaults on every share, and the record names the delegate (A6).
 *   4. **The contest** — two crews; the larger stake carries the yield; the other delivers nothing and
 *      owes nothing (one prize, SSN-5).
 */

import { describe, expect, it } from 'vitest';
import type { PrincipalId } from '../../src/core/types.js';
import { IN_FULL } from '../../src/venture/index.js';
import {
  GRAND_BASE_YIELD_MINOR,
  GRAND_ROLE_STAKE_MINOR,
  GRAND_VENTURE_STATEMENT,
  SEASON_RECKONINGS,
  finaleTickOf,
  grandStageFor,
  type SeasonBlock,
} from '../../src/season/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { setSpeed } from '../../src/core/time.js';
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

describe('the grand venture is announced from the season’s first tick', () => {
  it('publishes the stage, the yield, the window, the stake and the rule in header.season.grand', () => {
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'gv-announce' });
    runtime.seat(P('anna'), 'anna');
    runtime.standing.open(P('anna'));
    tick(runtime);
    const season = observe(runtime, P('anna')).header['season'] as SeasonBlock;
    expect(season.season).toBe(1);
    expect(season.reckoning).toBe(1);
    expect(season.of).toBe(SEASON_RECKONINGS);
    expect(season.reckonings_left).toBe(SEASON_RECKONINGS);
    expect(season.finale_tick).toBe(finaleTickOf(1));
    const g = season.grand;
    expect(g.stage).toBe(grandStageFor(runtime.world.map, 1));
    expect(g.kind).toBe('BUILD');
    expect(g.base_yield).toBe(GRAND_BASE_YIELD_MINOR);
    expect(g.stake_per_role).toBe(GRAND_ROLE_STAKE_MINOR);
    expect(g.opens_tick).toBe(WINDOW.opens_tick);
    expect(g.closes_tick).toBe(WINDOW.closes_tick);
    expect(g.open_now).toBe(false);
    expect(g.rule).toBe(GRAND_VENTURE_STATEMENT);
    // Sited in the least-lawful space: the Frontier, as far from the Commons as the map goes.
    expect(runtime.world.map.systems.get(g.stage ?? ('' as never))?.tier).toBe('FRONTIER');
  });
});

describe('a clean cooperative FINALE', () => {
  it('a crew of four at the Frontier stage carries the yield and the creator pays every share — KEPT', () => {
    const creator = P('wright');
    const crew = [creator, P('carrier'), P('factor'), P('tally')];
    const w = finaleWorld('gv-kept', crew);
    tick(w.runtime);
    const id = formCandidate(w, { creator, crew });
    const v = w.runtime.ventures.require(id);
    expect(v.state).toBe('LIVE');
    expect(v.grand?.season).toBe(1);
    expect(v.resolvesAtTick).toBe(finaleTickOf(1));
    // The creator states IN_FULL on every share it owes — the three it does not hold itself.
    for (const role of v.roles) {
      if (role.filledByPrincipal === creator) continue;
      submit(w.runtime, creator, 'elect', { venture: id, role: role.index, election: IN_FULL }, role.index);
    }
    tick(w.runtime);
    runTo(w.runtime, finaleTickOf(1));
    const verdict = w.runtime.seasons.verdictFor(1);
    expect(verdict?.winner).toBe(id);
    const delivered = w.runtime.deliveryOf(id)?.proceeds ?? 0;
    expect(delivered).toBeGreaterThanOrEqual(GRAND_BASE_YIELD_MINOR * 0.9);
    expect(delivered).toBeLessThanOrEqual(GRAND_BASE_YIELD_MINOR * 1.1);
    const record = w.runtime.seasons.last();
    expect(record?.season).toBe(1);
    expect(record?.grand.outcome).toBe('KEPT');
    expect(record?.grand.creator).toBe(creator);
    expect(record?.grand.crew.every((c) => c.paidMinor === c.dueMinor)).toBe(true);
    expect(w.runtime.seasons.closedThrough).toBe(1);
    expect(w.runtime.ventures.require(id).state).toBe('SETTLED');
  });
});

describe('a betrayal through a grant (A6)', () => {
  it('a steward forms the grand venture in its grantor’s name and elects the crew to nothing — BROKEN, delegate named', () => {
    const grantor = P('patron');
    const steward = P('steward');
    const crew = [P('crewa'), P('crewb'), P('crewc'), P('crewd')];
    const w = finaleWorld('gv-steward', [grantor, steward, ...crew]);
    tick(w.runtime);
    // The grantor signs a mandate whose worst case covers the grand venture's elective ceiling.
    const ceiling = w.runtime.grandElectiveCeiling(1);
    const granted = act(w.runtime, grantor, 'grant', {
      to: steward,
      template: 'steward',
      max_direct_loss: 1_000,
      max_contingent_liability: ceiling,
      expires_tick: w.runtime.engine.tick + 200,
    });
    expect(granted).toBeNull();
    const id = formCandidate(w, { creator: steward, onBehalfOf: grantor, crew });
    const v = w.runtime.ventures.require(id);
    expect(v.creator).toBe(grantor);
    expect(v.actedBy).toBe(steward);
    expect(v.state).toBe('LIVE');
    // The knife: an ordinary `elect`, inside the LIMITS, on every share — of zero.
    for (const role of v.roles) {
      submit(w.runtime, steward, 'elect', { venture: id, role: role.index, election: 0 }, role.index);
    }
    tick(w.runtime);
    runTo(w.runtime, finaleTickOf(1));
    const record = w.runtime.seasons.last();
    expect(record?.grand.outcome).toBe('BROKEN');
    expect(record?.grand.creator).toBe(grantor);
    expect(record?.grand.formedBy).toBe(steward);
    expect(record?.grand.crew.every((c) => c.paidMinor === 0 && c.dueMinor > 0)).toBe(true);
    expect(record?.grand.crew.every((c) => c.electedBy === steward)).toBe(true);
    expect(w.runtime.ventures.require(id).state).toBe('DEFAULTED');
    expect(w.runtime.standing.row(grantor).defaults).toBe(4);
  });
});

describe('the contest — one prize', () => {
  it('the larger stake carries the yield; the other crew delivers nothing and owes nothing', () => {
    const a = [P('ana'), P('anb'), P('anc'), P('and')];
    const b = [P('bea'), P('beb'), P('bec'), P('bed')];
    const w = finaleWorld('gv-contest', [...a, ...b]);
    tick(w.runtime);
    const small = formCandidate(w, { creator: a[0] as PrincipalId, crew: a, stakes: [10_000, 10_000, 10_000, 10_000] });
    const large = formCandidate(w, { creator: b[0] as PrincipalId, crew: b, stakes: [20_000, 20_000, 20_000, 20_000] });
    runTo(w.runtime, finaleTickOf(1));
    const verdict = w.runtime.seasons.verdictFor(1);
    expect(verdict?.winner).toBe(large);
    expect(w.runtime.deliveryOf(small)?.proceeds).toBe(0);
    expect(w.runtime.deliveryOf(large)?.proceeds ?? 0).toBeGreaterThan(0);
    expect(w.runtime.ventures.require(small).state).toBe('SETTLED');
    expect(grandVentures(w.runtime)).toHaveLength(2);
    void WINDOW;
  });
});
