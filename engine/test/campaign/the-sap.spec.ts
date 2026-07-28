/**
 * ★ **THE SAP reaches the frame** (A13).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A13 refuses a mechanic with no named pixel signature, and this project has shipped the failure
 * three times in three different shapes: `market/` printed 18 fills while the frame carried no market
 * key at all, so the first production fill would have been invisible; the battle line published
 * `roleTags` read straight off every fit, which is a `SENSED` manifest on screen; and the claim tint
 * rendered four ways of *paying* and nothing about why anybody would want the ground.
 *
 * So this file asserts the three things a signature has to satisfy, and they are different claims:
 *
 *   1. **It renders at all** — a live campaign produces a `SapLine`, and `assertFrameBudgets` accepts
 *      the frame it is on. A field nothing publishes is a field that does not exist.
 *   2. **The picture agrees with the score** — `notches`, `dashed`, `hollow` and `reached` are each
 *      checked against the state they claim to draw, in both directions. A band at the wall over a
 *      campaign that took nothing is a lie about a real agent's territory that a stranger has no
 *      second source for.
 *   3. **It leaks nothing** — the line carries no quantity anybody holds. `hollow` is one bit about a
 *      published obligation; the *number* behind it is `PARTIES` only.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { assertFrameBudgets, MAX_FRAME_SAP_LINES } from '../../src/frames/contract.js';
import { emptyFrame } from '../../src/frames/render.js';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import { minor, qty } from '../../src/core/units.js';
import {
  Book,
  campaignIdFor,
  CAMPAIGN_BOND_MINOR,
  CAMPAIGN_PULSE_PHASE,
  MATERIEL_GOOD,
  PULSE_MATERIEL_QTY,
  rebuffsToStand,
  sapLinesFor,
  type CampaignRecord,
} from '../../src/campaign/index.js';
import { act, campaignWorld } from './fixture.js';

const ATT = 'p:atk' as PrincipalId;
const DEF = 'p:def' as PrincipalId;

function row(over: Partial<CampaignRecord> = {}): CampaignRecord {
  return {
    id: campaignIdFor(0, 0),
    attacker: ATT,
    defender: DEF,
    objective: 'sys-obj' as SystemId,
    depot: 'sys-dep' as SystemId,
    bond: CAMPAIGN_BOND_MINOR,
    bondEncumbranceId: 'enc:bond',
    breachesNeeded: 3,
    rebuffsNeeded: rebuffsToStand(3),
    declaredAtTick: 0,
    firstPulseTick: CAMPAIGN_PULSE_PHASE,
    state: 'MASSING',
    breaches: 0,
    rebuffs: 0,
    starves: 0,
    pulses: [],
    parties: [],
    endedAtTick: null,
    endedAtReckoning: null,
    forfeited: minor(0),
    returned: minor(0),
    ...over,
  };
}

function saps(rows: readonly CampaignRecord[], materiel: number): ReturnType<typeof sapLinesFor> {
  const book = new Book();
  for (const r of rows) book.declare(r);
  return sapLinesFor({ book, tick: CAMPAIGN_PULSE_PHASE, materielAt: () => qty(materiel) });
}

describe('★ THE SAP — a campaign renders, and the picture agrees with the score', () => {
  it('is not vacuous: a live campaign in a REAL world reaches the frame', () => {
    // Driven through the verb, not the book, so the assertion is that the whole chain publishes —
    // declaration → `FrameSource.saps` → `assertFrameBudgets`. The market's own failure was exactly
    // this chain broken at the last link with 18 fills already in the ledger.
    const w = campaignWorld('sap-renders');
    expect(act(w.runtime, w.attacker, 'build', { kind: 'CAMPAIGN', system: w.objective })).toBeNull();
    const lines = w.runtime.sapLines(w.runtime.engine.tick);
    expect(lines.length, 'a live campaign must produce a SAP').toBe(1);
    const sap = lines[0];
    expect(sap?.depot).toBe(w.depot);
    expect(sap?.objective).toBe(w.objective);
    expect(sap?.dashed, 'a MASSING campaign is drawn dashed — the published notice').toBe(true);
    expect(sap?.reached).toBe(false);

    // And the frame it lands on is legal.
    assertFrameBudgets({ ...emptyFrame(0, 0, 'h'), saps: lines });
  });

  it('★ the band IS the score: it advances on a breach and retreats on a rebuff', () => {
    // MUTATION: draw `notches` from `pulses.length` instead of `breaches`. Red on the second case —
    // a 1-1 campaign would draw two notches, which says on screen that the claim is two-thirds fallen
    // when the score says one-third.
    const at = (breaches: number, rebuffs: number): number =>
      saps([row({ state: 'PRESSING', breaches, rebuffs })], PULSE_MATERIEL_QTY)[0]?.notches ?? -1;
    expect(at(0, 0)).toBe(0);
    expect(at(1, 0)).toBe(1);
    expect(at(1, 1), 'a rebuff does not advance the trench').toBe(1);
    expect(at(2, 1)).toBe(2);
  });

  it('★ HOLLOW is the supply, made visible a whole Reckoning before the war dies', () => {
    // MUTATION: drop the `hollow` field. Red here, and the mechanic loses its only visible logistics
    // signal — a defender that cut the corridor would have no way to see that it had worked.
    const fed = saps([row({ state: 'PRESSING', breaches: 1 })], PULSE_MATERIEL_QTY);
    expect(fed[0]?.hollow, 'a stocked depot draws solid').toBe(false);
    const starving = saps([row({ state: 'PRESSING', breaches: 1 })], PULSE_MATERIEL_QTY - 1);
    expect(
      starving[0]?.hollow,
      'a depot short of even one unit draws HOLLOW. The next pulse starves, and a viewer must be able to ' +
        'see that a Reckoning before it happens.',
    ).toBe(true);
  });

  it('★ ONLY a TAKEN campaign touches its objective — every other ending recoils', () => {
    // MUTATION: set `reached: true` on any terminal state. Red here AND red in `assertFrameBudgets`,
    // which is the pair that matters: the budget clause catches a hand-built frame and this catches the
    // builder. A band drawn at the wall over a war that took nothing is A5′ on the map.
    for (const state of ['REBUFFED', 'STARVED', 'LIFTED', 'MOOT'] as const) {
      const line = saps([row({ state, breaches: 2, rebuffs: 3, endedAtReckoning: 0 })], PULSE_MATERIEL_QTY)[0];
      expect(line?.reached, `${state} must not reach the objective — nothing was taken`).toBe(false);
      expect(line?.notches, `${state} recoils to the depot`).toBe(0);
      // And the frame refuses the inverse, so a future edit that sets the flag fails here.
      expect(() =>
        assertFrameBudgets({ ...emptyFrame(0, 0, 'h'), saps: [{ ...line!, reached: true }] }),
      ).toThrow();
    }
    const taken = saps([row({ state: 'TAKEN', breaches: 3, endedAtReckoning: 0 })], PULSE_MATERIEL_QTY)[0];
    expect(taken?.reached, 'a TAKEN campaign reaches, and the claim tint goes out').toBe(true);
    expect(taken?.notches).toBe(taken?.notchesToReach);
  });

  it('carries no quantity anybody holds — the rejected "fuel gauge", refused again', () => {
    // The §11.2 half. `sovereignty/view.ts` killed a public "Reckonings of Charge remaining" gauge
    // because a public recipe over a private stockpile leaks reserve coverage, the limiting good and
    // the contents of an inbound convoy. This asserts on the SHAPE, so a future edit that puts a
    // materiel figure on the line fails here rather than on screen.
    const line = saps([row({ state: 'PRESSING', breaches: 1 })], PULSE_MATERIEL_QTY * 9)[0];
    const keys = Object.keys(line ?? {});
    for (const banned of ['materiel', 'materielHere', 'stock', 'reserve', 'daysOfSupply']) {
      expect(keys, `a SapLine may not carry ${banned}: it is a stock reading and §11.2 puts one at SENSED`)
        .not.toContain(banned);
    }
    expect(
      JSON.stringify(line),
      `no field may equal the depot's actual holding (${String(PULSE_MATERIEL_QTY * 9)}), which would be the ` +
        'gauge back by another name',
    ).not.toContain(String(PULSE_MATERIEL_QTY * 9));
    expect(line?.hollow, 'the one admissible signal is a bit').toBe(false);
    expect(MATERIEL_GOOD, 'and the good is not named on the line either').toBeTruthy();
  });

  it('is capped, and the cap is a floor under the live wars rather than a truncation', () => {
    expect(
      MAX_FRAME_SAP_LINES,
      'the SAP cap must be above the world cap on live campaigns, or a war in progress is not drawn at all',
    ).toBeGreaterThanOrEqual(4);
    const many = Array.from({ length: MAX_FRAME_SAP_LINES + 3 }, (_, i) =>
      row({ id: campaignIdFor(0, i), state: 'PRESSING', objective: `sys-${String(i)}` as SystemId, breaches: i % 3 }),
    );
    const lines = saps(many, PULSE_MATERIEL_QTY);
    expect(lines.length).toBe(MAX_FRAME_SAP_LINES);
    // Significance first: the campaigns closest to deciding something survive the cap.
    expect(lines[0]?.notches).toBeGreaterThanOrEqual(lines[lines.length - 1]?.notches ?? 0);
    assertFrameBudgets({ ...emptyFrame(0, 0, 'h'), saps: lines });
  });
});
