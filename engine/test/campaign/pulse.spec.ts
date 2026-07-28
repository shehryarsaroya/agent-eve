/**
 * The PULSE: every guard, bitten.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **NON-VACUITY FIRST.** Every `describe` below opens by asserting the subject can actually occur,
 * because this repo's signature defect is a check whose subject cannot happen: `INV-22` was green
 * over an empty journal for the project's whole life, and `INV-26` silently counted zero structures.
 * A test that would pass on a book where no pulse ever ran is not a test of the pulse.
 *
 * Each `// MUTATION:` comment names the single edit that turns the assertion below it red. They were
 * run — not written and hoped for — and the two that mattered are recorded in the file:
 * `>` → `>=` on the tie-break, and the ordering of supply against the force read.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import type { ClaimState, HandId, PrincipalId, SystemId } from '../../src/core/types.js';
import { minor, qty } from '../../src/core/units.js';
import {
  BREACHES_TO_TAKE_STRAINED,
  BREACHES_TO_TAKE_SUPPLIED,
  breachesToTake,
  CAMPAIGN_BOND_MINOR,
  CAMPAIGN_PULSES,
  CAMPAIGN_PULSE_PHASE,
  liftEnding,
  PULSE_MATERIEL_QTY,
  readCampaignForce,
  rebuffsToStand,
  resolvePulse,
  STARVES_TO_END,
  type CampaignRecord,
  type PulsePort,
} from '../../src/campaign/index.js';
import { FORCE_BY_TIER } from '../../src/predation/params.js';

const ATTACKER = 'p:atk' as PrincipalId;
const DEFENDER = 'p:def' as PrincipalId;
const OBJECTIVE = 'sys-obj' as SystemId;
const DEPOT = 'sys-dep' as SystemId;

function campaign(over: Partial<CampaignRecord> = {}): CampaignRecord {
  return {
    id: 'campaign:0:0' as CampaignRecord['id'],
    attacker: ATTACKER,
    defender: DEFENDER,
    objective: OBJECTIVE,
    depot: DEPOT,
    bond: CAMPAIGN_BOND_MINOR,
    bondEncumbranceId: 'enc:1',
    breachesNeeded: BREACHES_TO_TAKE_SUPPLIED,
    rebuffsNeeded: rebuffsToStand(BREACHES_TO_TAKE_SUPPLIED),
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

function port(over: {
  readonly claim?: { readonly claimant: PrincipalId; readonly state: ClaimState } | null;
  readonly attackerHands?: number;
  readonly defenderHands?: number;
  readonly otherHands?: number;
  readonly materiel?: number;
} = {}): PulsePort {
  const hands = (n: number, tag: string): readonly HandId[] =>
    Array.from({ length: n }, (_, i) => `${tag}:${String(i)}` as HandId);
  return {
    tierOf: () => 'MARCHES',
    claimAt: () =>
      over.claim === undefined ? { claimant: DEFENDER, state: 'SUPPLIED' as ClaimState } : over.claim,
    handsAt: (principal) =>
      principal === ATTACKER
        ? hands(over.attackerHands ?? 0, 'a')
        : principal === DEFENDER
          ? hands(over.defenderHands ?? 0, 'd')
          : hands(over.otherHands ?? 0, 'o'),
    materielLotsAt: () => {
      const amount = over.materiel ?? PULSE_MATERIEL_QTY;
      return amount <= 0 ? [] : [{ id: 'lot:1', qty: amount }];
    },
  };
}

describe('the pulse force reading is §9\'s rule, and the tie goes to the defender', () => {
  it('is not vacuous: a supplied pulse resolves, and a breach is reachable', () => {
    // Two hands, not one: the very next test measures why — at the MARCHES one hand ties terrain and
    // ties are the defender's. A non-vacuity check written at one hand would have been a *rebuff*
    // dressed as a breach, which is the shape of vacuity this file exists to refuse.
    const plan = resolvePulse(port({ attackerHands: 2, defenderHands: 0 }), campaign(), 216);
    expect(plan.row, 'a supplied pulse must produce a row at all').not.toBeNull();
    expect(plan.row?.outcome).toBe('BREACH');
    expect(plan.destroy.length, 'and it must have spent materiel').toBeGreaterThan(0);
  });

  it('★ REBUFFS AN EQUAL READING — ties go to the defender, and terrain is the tie-maker', () => {
    // MUTATION: change `attackerForce > defenderForce` to `>=` in `resolvePulse`. This goes red on
    // the first case; `CMP-4` then halts the world on the recorded row, which is the second road.
    //
    // MEASURED and worth stating: at the MARCHES, `FORCE_BY_TIER` is 1, so **one attacking hand
    // against an EMPTY objective is force 1 against 1 and REBUFFS.** A lone campaign in the policed
    // zone loses to nobody standing there at all, exactly as a lone `demand` does — the calibration
    // §9 chose, reached here through the same constant rather than a second one.
    expect(FORCE_BY_TIER.MARCHES, 'the tie-maker this test is about').toBe(1);
    const lone = resolvePulse(port({ attackerHands: 1, defenderHands: 0 }), campaign(), 216);
    expect(
      lone.row?.outcome,
      'one hand against an empty MARCHES objective is 1 v 1 (terrain), and a tie is the defender\'s. ' +
        'Taking a defended place needs somebody to stand with you.',
    ).toBe('REBUFF');
    expect(lone.row?.attackerForce).toBe(1);
    expect(lone.row?.defenderForce).toBe(1);

    const two = resolvePulse(port({ attackerHands: 2, defenderHands: 0 }), campaign(), 216);
    expect(two.row?.outcome, 'two hands beats terrain alone').toBe('BREACH');

    const met = resolvePulse(port({ attackerHands: 2, defenderHands: 1 }), campaign(), 216);
    expect(met.row?.outcome, '2 v (1 + 1 terrain) is a tie, and a tie is a REBUFF').toBe('REBUFF');
  });

  it('counts an ALLY\'s hands only where they are actually standing, at the pulse', () => {
    // MUTATION: count a roster row rather than the hands it has present. Red here, because the ally
    // below has joined and has nobody at the objective. That is `readForce`'s `stillThere` hole: a
    // DEFENDER joiner stakes nothing, so a roster row that paid force would be a free rebuff forever.
    const ally = 'p:ally' as PrincipalId;
    const withAlly = campaign({
      parties: [{ principal: ally, side: 'ATTACKER', stake: minor(0), encumbranceId: null, joinedAtTick: 0 }],
    });
    const absent = readCampaignForce(port({ attackerHands: 1, otherHands: 0 }), withAlly);
    expect(absent.attackerForce, 'a joiner with no hands there contributes nothing').toBe(1);
    const present = readCampaignForce(port({ attackerHands: 1, otherHands: 2 }), withAlly);
    expect(present.attackerForce, 'and two hands there contribute two').toBe(3);
  });
});

describe('supply is spent before the force is read, and an unsupplied pulse is a STARVE', () => {
  it('is not vacuous: a stocked depot spends exactly the pulse quantity, all-or-nothing', () => {
    const plan = resolvePulse(port({ attackerHands: 3, materiel: PULSE_MATERIEL_QTY * 3 }), campaign(), 216);
    expect(plan.destroy.reduce((n, l) => n + l.qty, 0)).toBe(PULSE_MATERIEL_QTY);
    expect(plan.row?.materielSpent).toBe(PULSE_MATERIEL_QTY);
  });

  it('★ SPENDS THE MATERIEL EVEN ON A REBUFF — a pulse is a commitment, not reconnaissance', () => {
    // MUTATION: read the force first and skip the destroy on a REBUFF. Red here.
    //
    // This is the clause that prices war correctly. If supply were spent only on a win, every pulse
    // would be free reconnaissance and a campaign would cost nothing on the Reckonings it was losing —
    // so an outnumbered attacker could sit at 0-4 indefinitely and bringing hands would not be the
    // defender's counterplay, it would be a formality.
    const losing = resolvePulse(port({ attackerHands: 0, defenderHands: 3 }), campaign(), 216);
    expect(losing.row?.outcome).toBe('REBUFF');
    expect(
      losing.destroy.reduce((n, l) => n + l.qty, 0),
      'a rebuffed pulse still consumes its materiel. Otherwise a losing war is free.',
    ).toBe(PULSE_MATERIEL_QTY);
  });

  it('starves on an under-stocked depot, spends nothing, and leaves the goods alone', () => {
    // MUTATION: make `takeMateriel` spend what it has instead of returning null. Red here — a partial
    // spend would buy a fraction of a breach, which this design has no arithmetic for, and `CMP-3`
    // halts on a pressed pulse whose spend is not exactly `PULSE_MATERIEL_QTY`.
    const plan = resolvePulse(port({ attackerHands: 5, materiel: PULSE_MATERIEL_QTY - 1 }), campaign(), 216);
    expect(plan.row?.outcome).toBe('STARVED');
    expect(plan.row?.materielSpent).toBe(0);
    expect(plan.destroy, 'an under-stocked depot loses nothing at all').toEqual([]);
    expect(
      plan.row?.attackerForce,
      'a starved pulse presses nothing, so neither force was read and publishing a number would invent one',
    ).toBe(0);
  });

  it(`ends the campaign after ${String(STARVES_TO_END)} consecutive starves, bond forfeit`, () => {
    const nearlyDead = campaign({ state: 'PRESSING', starves: STARVES_TO_END - 1, breaches: 0, rebuffs: 1, pulses: [
      { index: 0, reckoning: 0, tick: 216, outcome: 'STARVED', attackerForce: 0, defenderForce: 0, terrain: 0, materielSpent: qty(0), attackerHands: 0, defenderHands: 0 },
    ] });
    const plan = resolvePulse(port({ materiel: 0 }), nearlyDead, 504);
    expect(plan.endsWith?.state).toBe('STARVED');
    expect(plan.endsWith?.forfeited, 'the whole bond goes to the defender').toBe(CAMPAIGN_BOND_MINOR);
    expect(plan.endsWith?.returned).toBe(0);
    expect(plan.endsWith?.lapseObjective, 'a starved war takes no territory').toBe(false);
  });
});

describe('every ending is reachable and accounts for the whole bond', () => {
  it('★ TAKEN lapses the objective and returns the bond in full', () => {
    // The bond prices FAILURE, not war. §16.6 MUST-20 CUTs a wardec that continues while bills are
    // paid, and a bond taken on a win would be exactly that fee. `CMP-5` halts on a TAKEN that
    // forfeited anything.
    const nearlyWon = campaign({ state: 'PRESSING', breaches: BREACHES_TO_TAKE_SUPPLIED - 1, rebuffs: 0, pulses: [
      { index: 0, reckoning: 0, tick: 216, outcome: 'BREACH', attackerForce: 3, defenderForce: 1, terrain: 1, materielSpent: qty(PULSE_MATERIEL_QTY), attackerHands: 3, defenderHands: 0 },
      { index: 1, reckoning: 1, tick: 504, outcome: 'BREACH', attackerForce: 3, defenderForce: 1, terrain: 1, materielSpent: qty(PULSE_MATERIEL_QTY), attackerHands: 3, defenderHands: 0 },
    ] });
    const plan = resolvePulse(port({ attackerHands: 3, defenderHands: 0 }), nearlyWon, 792);
    expect(plan.row?.outcome).toBe('BREACH');
    expect(plan.endsWith?.state).toBe('TAKEN');
    expect(plan.endsWith?.lapseObjective).toBe(true);
    expect(plan.endsWith?.returned).toBe(CAMPAIGN_BOND_MINOR);
    expect(plan.endsWith?.forfeited).toBe(0);
  });

  it('REBUFFED forfeits the whole bond and takes nothing', () => {
    const nearlyLost = campaign({
      state: 'PRESSING',
      breaches: 0,
      rebuffs: rebuffsToStand(BREACHES_TO_TAKE_SUPPLIED) - 1,
      pulses: Array.from({ length: rebuffsToStand(BREACHES_TO_TAKE_SUPPLIED) - 1 }, (_, i) => ({
        index: i, reckoning: i, tick: 216 + i * 288, outcome: 'REBUFF' as const,
        attackerForce: 1, defenderForce: 3, terrain: 1, materielSpent: qty(PULSE_MATERIEL_QTY),
        attackerHands: 1, defenderHands: 2,
      })),
    });
    const plan = resolvePulse(port({ attackerHands: 1, defenderHands: 3 }), nearlyLost, 1080);
    expect(plan.endsWith?.state).toBe('REBUFFED');
    expect(plan.endsWith?.forfeited).toBe(CAMPAIGN_BOND_MINOR);
    expect(plan.endsWith?.lapseObjective).toBe(false);
  });

  it('★ MOOT when the claim is gone or has changed hands — the defender\'s fire sale', () => {
    // §16.6 MUST-13 lists a fire sale as an ending. Without this branch a losing defender's only
    // options are pay or lose, and an attacker's bond could be forfeited to a principal that never
    // chose to be in the war.
    const gone = resolvePulse(port({ claim: null }), campaign({ state: 'PRESSING' }), 216);
    expect(gone.endsWith?.state).toBe('MOOT');
    expect(gone.endsWith?.returned, 'nobody failed, so the bond comes home whole').toBe(CAMPAIGN_BOND_MINOR);
    expect(gone.destroy, 'and no materiel is spent on a war with no object').toEqual([]);

    const sold = resolvePulse(
      port({ claim: { claimant: 'p:third' as PrincipalId, state: 'SUPPLIED' } }),
      campaign({ state: 'PRESSING' }),
      216,
    );
    expect(sold.endsWith?.state).toBe('MOOT');
    expect(sold.endsWith?.forfeited).toBe(0);
  });

  it('LIFTED returns the salvage and forfeits the rest, and the two sum to the bond', () => {
    const ending = liftEnding(campaign({ state: 'PRESSING', breaches: 1, rebuffs: 1 }), 300);
    expect(ending.state).toBe('LIFTED');
    expect(ending.returned).toBeGreaterThan(0);
    expect(ending.forfeited).toBeGreaterThan(0);
    expect(
      ending.forfeited + ending.returned,
      'CMP-5 halts on an ending that does not account for the whole bond: it would mint or destroy capital',
    ).toBe(CAMPAIGN_BOND_MINOR);
  });

  it('★ ALWAYS ENDS — no combination of outcomes exhausts the clock undecided', () => {
    // The finiteness claim, checked exhaustively rather than argued. `assertCampaignSchedule` refuses a
    // calibration where this could fail, and this is the proof that today's numbers are not one.
    //
    // MUTATION: raise `CAMPAIGN_PULSES` to 7 without moving the two scopes. Red here AND red at
    // construction, which is the point of having both.
    for (const scope of [BREACHES_TO_TAKE_SUPPLIED, BREACHES_TO_TAKE_STRAINED]) {
      const stand = rebuffsToStand(scope);
      expect(
        scope + stand,
        `at ${String(scope)} breaches to take and ${String(stand)} rebuffs to stand, ${String(CAMPAIGN_PULSES)} ` +
          'pulses must not be able to run out with neither side at its number — the engine would have to ' +
          'either leave a bond locked forever or invent a verdict (A12)',
      ).toBeGreaterThan(CAMPAIGN_PULSES);
    }
  });

  it('scopes a STRAINED claim cheaper than a SUPPLIED one, and refuses CONTESTED outright', () => {
    // The A14 hardening: the Charge clock decides when a claim becomes cheap to attack, and nobody
    // controls the Charge clock. And CONTESTED is refused rather than offered because the
    // vulnerability window gives it away free — A2 forbids handing an agent a trap as much as a
    // solved game.
    expect(breachesToTake('SUPPLIED')).toBe(BREACHES_TO_TAKE_SUPPLIED);
    expect(breachesToTake('STRAINED')).toBe(BREACHES_TO_TAKE_STRAINED);
    expect(BREACHES_TO_TAKE_STRAINED).toBeLessThan(BREACHES_TO_TAKE_SUPPLIED);
    expect(breachesToTake('CONTESTED')).toBeNull();
    expect(breachesToTake('LAPSED')).toBeNull();
    expect(breachesToTake('CEDED')).toBeNull();
  });
});
