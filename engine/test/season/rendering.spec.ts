/**
 * A13 — the season renders: THE SEASON LINE (the FINALE countdown and the grand venture's crews) on
 * both frames, THE SEASON RECORD (each FINALE and its champions) on the Reckoning frame, and the
 * client draws all three. And A9 — the frame's season line is a strict subset of what every agent
 * reads, at the same redaction: a crew's stake committed inside the commitment window is a count on
 * every public surface and an amount only to that crew's own parties.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PrincipalId } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';
import { setSpeed, WINDOW_FIRST_PHASE } from '../../src/core/time.js';
import { seasonProblems, type SeasonRecordLine } from '../../src/frames/contract.js';
import { finaleTickOf, grandStageFor, type SeasonBlock } from '../../src/season/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { IN_FULL } from '../../src/venture/index.js';
import { WINDOW, act, finaleWorld, grandVentures, idleAt, observe, runTo, submit, tick } from './fixture.js';

const P = (s: string): PrincipalId => `p:${s}` as PrincipalId;
const CLIENT = (f: string): string => readFileSync(new URL(`../../../client/${f}`, import.meta.url), 'utf8');

describe('THE SEASON LINE', () => {
  it('is on the live frame from the season’s first tick: the countdown and the crown on its stage', () => {
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'render-season-open' });
    tick(runtime);
    const line = runtime.liveFrame().season;
    expect(line?.season).toBe(1);
    expect(line?.reckoningsLeft).toBe(14);
    expect(line?.finaleTick).toBe(finaleTickOf(1));
    expect(line?.inFinale).toBe(false);
    expect(line?.grand.stage).toBe(grandStageFor(runtime.world.map, 1));
    expect(line?.grand.stageName).toBe(runtime.world.map.systems.get(line?.grand.stage ?? ('' as never))?.name);
    expect(line?.grand.openNow).toBe(false);
    expect(line?.grand.candidates).toEqual([]);
  });

  it('seals a crew’s late stake on every public surface and shows it in full only to that crew', () => {
    const crew = [P('ra'), P('rb'), P('rc'), P('rd')];
    const outsider = P('re');
    const late = WINDOW.opens_tick + WINDOW_FIRST_PHASE - 3;
    const w = finaleWorld('render-sealed', [...crew, outsider], { firstTick: late - 2 });
    runTo(w.runtime, late);
    expect(act(w.runtime, crew[0] as PrincipalId, 'create', { kind: 'BUILD', stage: w.stage, grand: true })).toBeNull();
    const id = grandVentures(w.runtime)[0]?.id;
    if (id === undefined) throw new Error('no candidate');
    // One fill before the commitment window opens, three after it.
    expect(
      act(w.runtime, crew[0] as PrincipalId, 'fill_role', {
        venture: id,
        role: 0,
        hand: idleAt(w.runtime, crew[0] as PrincipalId, w.stage),
        stake: 11_000,
      }),
    ).toBeNull();
    runTo(w.runtime, WINDOW.opens_tick + WINDOW_FIRST_PHASE);
    for (const [i, p] of crew.slice(1).entries()) {
      submit(w.runtime, p, 'fill_role', { venture: id, role: i + 1, hand: idleAt(w.runtime, p, w.stage), stake: 20_000 }, i);
    }
    tick(w.runtime);
    const card = w.runtime.liveFrame().season?.grand.candidates.find((c) => c.venture === id);
    expect(card?.rolesFilled).toBe(4);
    expect(card?.staked).toBe(11_000);
    expect(card?.sealedFills).toBe(3);
    expect(Object.keys(card ?? {})).not.toContain('your_crew_staked');
    const party = (observe(w.runtime, crew[2] as PrincipalId).header['season'] as SeasonBlock).grand.candidates[0];
    expect(party?.your_crew_staked).toBe(71_000);
    expect(party?.staked).toBe(11_000);
    const stranger = (observe(w.runtime, outsider).header['season'] as SeasonBlock).grand.candidates[0];
    expect(stranger?.your_crew_staked).toBeUndefined();
    // A9: what the viewer reads, the stranger reads, figure for figure.
    expect(stranger?.staked).toBe(card?.staked);
    expect(stranger?.sealed_fills).toBe(card?.sealedFills);
    expect(stranger?.roles_filled).toBe(card?.rolesFilled);
  });
});

describe('THE SEASON RECORD', () => {
  it('is on the FINALE’s frame — the outcome, the crew line by line, the titles, one legend', () => {
    const crew = [P('sa'), P('sb'), P('sc'), P('sd')];
    const w = finaleWorld('render-record', crew);
    tick(w.runtime);
    expect(act(w.runtime, crew[0] as PrincipalId, 'create', { kind: 'BUILD', stage: w.stage, grand: true })).toBeNull();
    const id = grandVentures(w.runtime)[0]?.id;
    if (id === undefined) throw new Error('no candidate');
    for (const [i, p] of crew.entries()) {
      submit(w.runtime, p, 'fill_role', { venture: id, role: i, hand: idleAt(w.runtime, p, w.stage), stake: 10_000 }, i);
    }
    tick(w.runtime);
    const hash = w.runtime.ventures.require(id).termsHash;
    for (const [i, p] of crew.entries()) submit(w.runtime, p, 'sign', { venture: id, terms_hash: hash }, i);
    tick(w.runtime);
    tick(w.runtime);
    for (const role of [1, 2, 3]) submit(w.runtime, crew[0] as PrincipalId, 'elect', { venture: id, role, election: IN_FULL }, role);
    tick(w.runtime);
    runTo(w.runtime, finaleTickOf(1));
    const frame = w.runtime.reckoningFrame();
    const rec = frame?.seasonRecords[0];
    expect(rec?.season).toBe(1);
    expect(rec?.outcome).toBe('KEPT');
    expect(rec?.creatorHandle).toBe('sa');
    expect(rec?.crew.map((c) => c.handle)).toEqual(['sa', 'sb', 'sc', 'sd']);
    expect(rec?.legend).toBe(`SEASON 1: sa carried ${String(rec?.proceeds)} and paid every share.`);
    expect(rec?.titles.length ?? 0).toBeGreaterThan(0);
    expect(frame?.season?.grand.winner).toBe(id);
  });

  it('refuses a record that would say something false about a real agent (A5′)', () => {
    const base: SeasonRecordLine = {
      season: 1,
      finaleTick: finaleTickOf(1),
      stage: null,
      outcome: 'KEPT',
      venture: null,
      creator: null,
      creatorHandle: null,
      formedBy: null,
      formedByHandle: null,
      proceeds: minor(0),
      crew: [
        { label: 'WRIGHT', principal: P('x'), handle: 'x', due: minor(10), paid: minor(0), electedBy: null, electedByHandle: null },
      ],
      titles: [],
      closedClaims: 0,
      legend: 'SEASON 1: x carried 10 and paid every share.',
    };
    expect(seasonProblems(null, [base]).join(' ')).toContain('reads KEPT with 1 unpaid');
    const paid = { ...base, outcome: 'BROKEN', crew: [{ ...base.crew[0]!, paid: minor(10) }] };
    expect(seasonProblems(null, [paid]).join(' ')).toContain('reads BROKEN with every share paid');
  });
});

describe('the client draws the season', () => {
  it('reads the season line and the records, and draws the countdown, the crown and THE SEASONS', () => {
    const app = CLIENT('app.js');
    const screens = CLIENT('lib/screens.js');
    const map = CLIENT('lib/mapview.js');
    expect(app).toContain('(L && L.season) || R.season');
    // The chrome: Reckonings left before the FINALE, and on the FINALE's own day the Reckoning
    // countdown itself is relabelled (the FINALE is a Reckoning, so it costs the bar no width).
    expect(app).toContain("'FINALE IN ' + SE.reckoningsLeft + 'R'");
    expect(app).toContain("finaleNow ? 'FINALE IN' : 'RECKONING IN'");
    expect(screens).toContain("'the FINALE is tonight'");
    expect(map).toContain('(L && L.season) || R.season');
    expect(screens).toContain("panel('THE SEASONS'");
    expect(screens).toContain("tile('GRAND VENTURE'");
    expect(screens).toContain('c.sealedFills');
    expect(map).toContain("class: 'grand-mk'");
    expect(CLIENT('app.css')).toContain('--gold');
  });
});
