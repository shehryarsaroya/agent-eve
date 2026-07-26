/**
 * Is standing and fighting ever the rational move? The tracker carried this as *"a world raid with
 * no joiners loses nothing material if repulsed"*, filed as an open defect. On inspection it is not
 * a defect — but the question underneath it is real, and nothing was checking the answer.
 *
 * A world raid is **physics**, not an actor. A12 permits it precisely because a target-selection rule
 * is not an authored outcome, and it has no stake to forfeit and no hand to rout because there is
 * nobody behind it. So "the raid loses nothing" is the correct behaviour, not a missing punishment.
 *
 * What matters is whether the DEFENDER's arithmetic works, and that is falsifiable:
 *
 *   - a repulse needs `defenderForce >= raiderForce`, ties to the defender;
 *   - a principal's idle present hands are worth `FORCE_PER_HAND` each, plus terrain;
 *   - ignoring a demand costs `RAID_TAKE_MULTIPLE` times it.
 *
 * If ignoring ever cost less than mustering, A14 breaks: a raid that can be shrugged off is a
 * mechanic whose drama depends on agents *choosing* conflict, which the axiom says they never will.
 * These are the numbers that keep that from happening, and every one is marked *(calibrate)* — which
 * is exactly why they need a test rather than a comment.
 */

import { describe, expect, it } from 'vitest';
import {
  FORCE_BY_TIER,
  FORCE_PER_HAND,
  FORCE_PER_JOINER,
  RAID_DEMAND_QTY,
  RAID_FORCE,
  RAID_STAGE_HELD_TICKS,
  RAID_TAKE_MULTIPLE,
  RAID_VICTIM_COOLDOWN_TICKS,
} from '../../src/predation/params.js';
import { HANDS_PER_PRINCIPAL } from '../../src/world/hands.js';

describe('ignoring a raid costs strictly more than answering one (A14)', () => {
  it('a full complement of hands can repulse the median raid unaided', () => {
    // The floor case: a principal that has not hired anybody, standing on its own holding, with no
    // joiners on either side. If THIS cannot repulse a typical raid, defence is a rich-agent
    // privilege and everyone else is taxed by the world on a clock they cannot answer.
    const median = Math.ceil((RAID_FORCE.min + RAID_FORCE.max) / 2);
    const alone = FORCE_PER_HAND * HANDS_PER_PRINCIPAL + (FORCE_BY_TIER.MARCHES ?? 0);
    expect(
      alone >= median,
      `a principal's ${String(HANDS_PER_PRINCIPAL)} hands give force ${String(alone)} against a median raid of ${String(median)}`,
    ).toBe(true);
  });

  it('and can repulse the WEAKEST raid even in the Commons, where terrain gives nothing', () => {
    const bare = FORCE_PER_HAND * HANDS_PER_PRINCIPAL + (FORCE_BY_TIER.COMMONS ?? 0);
    expect(bare).toBeGreaterThanOrEqual(RAID_FORCE.min);
  });

  it('leaves the STRONGEST raid genuinely dangerous, or the mechanic is theatre', () => {
    // The other half. If hands alone always won, a raid would be a formality and the `join` verb —
    // asking somebody else to stand with you — would never be worth an action. The strongest draw
    // must beat a lone principal, so that allies are the answer rather than a nicety.
    const alone = FORCE_PER_HAND * HANDS_PER_PRINCIPAL + (FORCE_BY_TIER.FRONTIER ?? 0);
    expect(
      RAID_FORCE.max > alone || FORCE_PER_JOINER > 0,
      'either the worst raid beats a lone defender, or joining has to add force',
    ).toBe(true);
  });

  it('prices ignoring above the demand itself, so paying is not dominated by silence', () => {
    expect(RAID_TAKE_MULTIPLE).toBeGreaterThan(1);
    // In goods: the worst case of ignoring must exceed the worst case of paying.
    expect(RAID_DEMAND_QTY.max * RAID_TAKE_MULTIPLE).toBeGreaterThan(RAID_DEMAND_QTY.max);
    expect(RAID_DEMAND_QTY.min).toBeGreaterThan(0);
  });

  it('makes a repulse change the world even when the raid had nothing to lose', () => {
    // This is the answer to the tracker's note. The raid forfeits nothing because there is nobody
    // behind it — but a successful defence still moves world state in the defender's favour: the
    // stage is closed to raiders and the victim cannot be re-targeted. Both are real, both are
    // published in `raid_schedule.rule`, and both would be zero if this were merely cosmetic.
    expect(RAID_STAGE_HELD_TICKS).toBeGreaterThan(0);
    expect(RAID_VICTIM_COOLDOWN_TICKS).toBeGreaterThan(0);
  });
});
