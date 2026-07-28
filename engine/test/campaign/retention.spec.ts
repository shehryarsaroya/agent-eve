/**
 * ★ **A campaign survives its own war, with `prune` called on every tick.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THIS IS THE HIGHEST-RISK FAILURE MODE IN THE LAYER AND IT IS INVISIBLE WITHOUT THIS FILE.**
 *
 * `Book.prune` has silently destroyed a load-bearing row five times in this repo, every one in
 * production only — the retained rows are always there in a short test. A campaign runs for up to
 * `CAMPAIGN_PULSES` Reckonings, which is **longer than either neighbouring module's window**
 * (`SOVEREIGNTY_RETAINED_RECKONINGS` and `LEVY_RETAINED_RECKONINGS` are both 3). So a retention rule
 * copied from next door would delete a war on its fourth Reckoning, and the symptom would not be an
 * error: the pulse handler would find no due campaigns, nothing would resolve, the bond would stay
 * locked forever, and the SAP would leave the map with an attacker's capital inside it.
 *
 * So this file calls `prune` **on every tick, at a Reckoning index far past the window**, drives a
 * whole campaign to its verdict, and asserts by name that the row, its bond lock and every pulse are
 * still there. It is the test that would notice the window clearing early, and there was no other.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { minor, qty } from '../../src/core/units.js';
import type { PrincipalId, SystemId } from '../../src/core/types.js';
import {
  Book,
  campaignIdFor,
  CAMPAIGN_BOND_MINOR,
  CAMPAIGN_PULSES,
  CAMPAIGN_PULSE_PHASE,
  CAMPAIGN_RETAINED_RECKONINGS,
  checkCmp6,
  isLiveCampaign,
  rebuffsToStand,
  type CampaignRecord,
} from '../../src/campaign/index.js';

function row(over: Partial<CampaignRecord> = {}): CampaignRecord {
  return {
    id: campaignIdFor(0, 0),
    attacker: 'p:atk' as PrincipalId,
    defender: 'p:def' as PrincipalId,
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

describe('★ campaign retention: prune never drops a live war', () => {
  it('is not vacuous: prune DOES drop a decided campaign once its window has passed', () => {
    // The half that proves the guard is a guard. If `prune` dropped nothing ever, the test below would
    // pass on a book that leaks, and INV-26's cap would be the only thing standing between this book
    // and unbounded growth — which is scar #3 exactly.
    const book = new Book();
    book.declare(row({ state: 'REBUFFED', endedAtReckoning: 0, bondEncumbranceId: null }));
    expect(book.size()).toBe(1);
    expect(
      book.prune(CAMPAIGN_RETAINED_RECKONINGS + 1),
      'a campaign that ended at Reckoning 0 must be dropped once the current Reckoning is past the window',
    ).toBe(1);
    expect(book.size()).toBe(0);
  });

  it('keeps a decided campaign INSIDE its window, so the postmortem can render', () => {
    const book = new Book();
    book.declare(row({ state: 'TAKEN', endedAtReckoning: 4, bondEncumbranceId: null }));
    expect(book.prune(4), 'the Reckoning it ended in').toBe(0);
    expect(book.prune(4 + CAMPAIGN_RETAINED_RECKONINGS - 1), 'still inside the window').toBe(0);
    expect(book.size()).toBe(1);
  });

  it('★ NEVER drops an undecided campaign, at any Reckoning, however far past the window', () => {
    // MUTATION: delete the `if (isLiveCampaign(row.state)) continue;` guard from `Book.prune`. RED
    // here, and red in the worked war below — which is the pair that matters: this case proves the
    // rule and that one proves the rule holds through the mechanic that depends on it.
    const book = new Book();
    for (const state of ['MASSING', 'PRESSING'] as const) {
      book.declare(row({ id: campaignIdFor(0, state === 'MASSING' ? 0 : 1), state }));
    }
    expect(book.liveCount()).toBe(2);
    for (const reckoning of [0, 1, 5, 20, 500, 10_000]) {
      expect(
        book.prune(reckoning),
        `an undecided campaign must survive prune at Reckoning ${String(reckoning)}. It is not "retained for N" ` +
          '— it is retained, full stop, because dropping one orphans a live bond lock (INV-4 halts the world) ' +
          "and loses an attacker's capital with no posting.",
      ).toBe(0);
    }
    expect(book.size()).toBe(2);
  });

  it('★ THE WORKED WAR: five pulses, prune every tick, and the row is whole at the verdict', () => {
    // The end-to-end version, and the one that would have caught a window copied from next door. Every
    // pulse advances a Reckoning; `prune` runs at each with the CURRENT Reckoning, which is exactly how
    // the runtime calls it. By the fourth pulse the campaign is older than
    // `SOVEREIGNTY_RETAINED_RECKONINGS` and `LEVY_RETAINED_RECKONINGS`, which is where a copied window
    // would have deleted it.
    const book = new Book();
    const id = campaignIdFor(0, 0);
    book.declare(row({ id }));

    const outcomes = ['REBUFF', 'BREACH', 'REBUFF', 'BREACH', 'BREACH'] as const;
    expect(outcomes.length, 'the war must run the full clock, or the test is shorter than the risk').toBe(
      CAMPAIGN_PULSES,
    );

    for (const [i, outcome] of outcomes.entries()) {
      const tick = CAMPAIGN_PULSE_PHASE + i * 288;
      const reckoning = i;
      book.recordPulse(id, {
        index: i,
        reckoning,
        tick,
        outcome,
        attackerForce: outcome === 'BREACH' ? 3 : 1,
        defenderForce: outcome === 'BREACH' ? 1 : 3,
        terrain: 1,
        materielSpent: qty(3_000),
        attackerHands: outcome === 'BREACH' ? 3 : 1,
        defenderHands: outcome === 'BREACH' ? 0 : 2,
      });
      // Pruned at every step, exactly as the runtime does, with the CURRENT Reckoning.
      expect(book.prune(reckoning), `prune must drop nothing at Reckoning ${String(reckoning)}`).toBe(0);

      const alive = book.get(id);
      expect(
        alive,
        `the campaign row is GONE after pulse ${String(i)} at Reckoning ${String(reckoning)}. A retention window ` +
          'copied from sovereignty or the Levy (both 3) deletes a war on its fourth Reckoning, and the symptom ' +
          'is not an error: no pulse is due, nothing resolves, the bond stays locked forever, and the SAP leaves ' +
          "the map with the attacker's capital inside it.",
      ).toBeDefined();
      expect(alive?.pulses.length, 'and every pulse so far must still be in the log').toBe(i + 1);
      expect(isLiveCampaign(alive?.state ?? 'TAKEN')).toBe(true);

      // CMP-6 audits the rule from the row's own counters, which is a property a truncated log
      // cannot have. Run at every step so a partial loss is caught at the step it happened.
      const violations = checkCmp6({
        book,
        tick,
        tierOf: () => 'MARCHES',
        materielDestroyedFor: () => null,
        lockIsOpen: (lock) => lock === 'enc:bond',
      });
      expect(
        violations,
        `CMP-6 fired at Reckoning ${String(reckoning)}: ${violations.map((v) => v.message).join(' · ')}`,
      ).toEqual([]);
    }

    const finished = book.require(id);
    expect(finished.pulses.length).toBe(CAMPAIGN_PULSES);
    expect(finished.breaches, 'three breaches landed').toBe(3);
    expect(finished.rebuffs, 'two rebuffs stood').toBe(2);
    expect(
      finished.pulses.map((p) => p.outcome),
      'the whole postmortem survives — §16.6 MUST-14 requires a finished war be retellable',
    ).toEqual([...outcomes]);
  });

  it('the retention window is longer than the longest possible campaign', () => {
    // Asserted from the constants rather than from the comment, so a calibration that inverted them
    // fails here as well as at construction. A window shorter than a campaign would let a war's own
    // obituary be pruned before the war it describes.
    expect(
      CAMPAIGN_RETAINED_RECKONINGS,
      'a decided campaign must be retained for longer than a campaign can run, or the postmortem and the war ' +
        'overlap in the drop order',
    ).toBeGreaterThan(CAMPAIGN_PULSES);
  });
});
